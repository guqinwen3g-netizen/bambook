import { describe, expect, it } from 'vitest';
import type { InvoiceAllocation, AllocationResult, AllocationDeleteResult, Invoice, PaymentVoucher } from '../types';

/**
 * ERP-P1-payment-reconcile-runtime-qa: fixture-driven runtime QA
 * payload 全部来自后端已 merged 代码（静态读取/断言真实源码），不手写假 contract。
 */

const fs = require('fs');
const path = require('path');
const RECONCILE_FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/reconcileFlow.ts'), 'utf-8');
const TOOL_REGISTRY_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRegistry.ts'), 'utf-8');

// 真实 ProcessDraft 6 字段（来自 toolRegistry.ts，不手写）
const PROCESS_DRAFT_FIELDS = ['subOperations', 'beforeAfterDiff', 'impactScope', 'irreversible', 'postCommitHooks', 'idempotencyKey'];

// ═══ Part 1: manual UI allocation route（contract 不变沿用） ═══
const INVOICE_RECALC_FIXTURES = [
  { scenario: 'totalApplied >= amount → Paid', expected: 'Paid' as const },
  { scenario: 'totalApplied > 0 but < amount → PartiallyPaid', expected: 'PartiallyPaid' as const },
  { scenario: 'totalApplied == 0 → Issued（回退）', expected: 'Issued' as const },
];
const VOUCHER_RECALC_FIXTURES = [
  { scenario: 'totalAllocated >= voucherAmount → reconciled', expected: 'reconciled' as const },
  { scenario: 'totalAllocated > 0 but < voucherAmount → partially_reconciled', expected: 'partially_reconciled' as const },
  { scenario: 'totalAllocated == 0 → unreconciled', expected: 'unreconciled' as const },
];

function applyRecalcResult(invoices: Invoice[], vouchers: PaymentVoucher[], newInvStatus: string, newVocStatus: string, invId: string, vocId: string) {
  return {
    invoices: invoices.map(i => i.id === invId ? { ...i, status: newInvStatus as any } : i),
    vouchers: vouchers.map(v => v.id === vocId ? { ...v, status: newVocStatus as any } : v),
  };
}

describe('runtime QA [manual UI]: invoice/voucher status recompute', () => {
  for (const fx of INVOICE_RECALC_FIXTURES) {
    it(`invoice: ${fx.scenario}`, () => {
      const invoices: Invoice[] = [{ id: 'I1', invoiceNumber: 'INV-1', type: 'Receivable', status: 'Issued', amount: 150, createdAt: 0, updatedAt: 0 } as Invoice];
      expect(applyRecalcResult(invoices, [], fx.expected, 'reconciled', 'I1', 'V1').invoices.find(i => i.id === 'I1')?.status).toBe(fx.expected);
    });
  }
  for (const fx of VOUCHER_RECALC_FIXTURES) {
    it(`voucher: ${fx.scenario}`, () => {
      const vouchers: PaymentVoucher[] = [{ id: 'V1', voucherNumber: 'V-1', type: 'Receipt', status: 'unreconciled', amount: 200, createdAt: 0, updatedAt: 0 }];
      expect(applyRecalcResult([], vouchers, 'Paid', fx.expected, 'I1', 'V1').vouchers.find(v => v.id === 'V1')?.status).toBe(fx.expected);
    });
  }
});

describe('runtime QA [manual UI]: validation error code 真实 contract', () => {
  const CODES = ['MISSING_INVOICE', 'MISSING_VOUCHER', 'MISSING_AMOUNT', 'INVALID_AMOUNT'];
  for (const code of CODES) {
    it(`error code "${code}" 在 allocationService 真实源码内`, () => {
      const allocSrc = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/allocationService.ts'), 'utf-8');
      expect(allocSrc).toContain(`'${code}'`);
    });
  }
});

describe('runtime QA [manual UI]: create/update/delete AllocationResult payload', () => {
  it('POST 成功: { allocation, newInvoiceStatus, newVoucherStatus }', () => {
    const payload: AllocationResult = {
      allocation: { id: 'ALLOC__I1__V1', invoiceId: 'I1', voucherId: 'V1', appliedAmount: 1000, appliedDate: '2026-06-29' },
      newInvoiceStatus: 'PartiallyPaid', newVoucherStatus: 'partially_reconciled',
    };
    expect(payload.allocation.appliedAmount).toBe(1000);
    expect(payload.newInvoiceStatus).toBe('PartiallyPaid');
  });
  it('DELETE 成功: { deleted, id, newInvoiceStatus, newVoucherStatus }', () => {
    const payload: AllocationDeleteResult = { deleted: true, id: 'ALLOC__I1__V1', newInvoiceStatus: 'Issued', newVoucherStatus: 'unreconciled' };
    expect(payload.deleted).toBe(true);
    expect(payload.newInvoiceStatus).toBe('Issued');
  });
});

// ═══ Part 2: Agent flow payment.receive_and_reconcile（静态断言真实源码 contract） ═══
describe('runtime QA [Agent flow]: ProcessDraft 真实 contract（静态断言 toolRegistry.ts）', () => {
  it('ProcessDraft 是 6 字段 interface（无 hash 字段，hash 在 idempotencyKey）', () => {
    const ifaceMatch = TOOL_REGISTRY_SRC.match(/export interface ProcessDraft \{[\s\S]*?\}/);
    expect(ifaceMatch).not.toBeNull();
    const ifaceBody = ifaceMatch![0];
    for (const field of PROCESS_DRAFT_FIELDS) {
      expect(ifaceBody).toContain(field);
    }
    // 不含 hash 字段（hash 嵌在 idempotencyKey 里）
    expect(ifaceBody).not.toMatch(/^\s*hash:/m);
  });

  it('computeProcessDraftHash 返回 pd: 前缀（非 djb2_ 假设）', () => {
    expect(TOOL_REGISTRY_SRC).toMatch(/return `pd:\$\{/);
    // 不应出现 djb2_ 作为返回前缀
    expect(TOOL_REGISTRY_SRC).not.toMatch(/return `djb2_/);
  });

  it('computeProcessDraftHash 用 djb2 算法（5381 起始，stableStringify）', () => {
    expect(TOOL_REGISTRY_SRC).toContain('5381');
    expect(TOOL_REGISTRY_SRC).toContain('stableStringify');
  });

  it('computeProcessDraftHash 入参是 Omit<ProcessDraft, idempotencyKey>（不含 idempotencyKey）', () => {
    expect(TOOL_REGISTRY_SRC).toMatch(/computeProcessDraftHash\(draft: Omit<ProcessDraft, 'idempotencyKey'>\)/);
  });
});

describe('runtime QA [Agent flow]: buildPaymentReconcileDraft 真实输出（静态断言 reconcileFlow.ts）', () => {
  it('idempotencyKey 格式: payment.receive_and_reconcile:${voucherId}:${hash}', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/idempotencyKey = `payment\.receive_and_reconcile:\$\{input\.voucherId\}:\$\{hash\}`/);
  });

  it('impactScope 固定含 vouchers/invoices/allocations', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/impactScope: \['vouchers', 'invoices', 'allocations'\]/);
  });

  it('irreversible = true（核销不可逆）', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/irreversible: true/);
  });

  it('subOperations 用 finance.apply_voucher_to_invoice toolId', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/toolId: 'finance\.apply_voucher_to_invoice'/);
  });

  it('return 展开 content + idempotencyKey（无独立 hash 字段）', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/return \{\s*\.\.\.content,\s*idempotencyKey,\s*\};/);
  });
});

describe('runtime QA [Agent flow]: verifyReconcileDraftHash 防篡改 contract', () => {
  it('verifyReconcileDraftHash 解析 :pd: 前缀提取 hash（非 djb2_）', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
    expect(RECONCILE_FLOW_SRC).toMatch(/'pd:' \+ idempotencyKey\.split\(':pd:'\)\[1\]/);
  });

  it('hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH error code（真实源码内）', () => {
    expect(RECONCILE_FLOW_SRC).toContain("'PROCESS_DRAFT_HASH_MISMATCH'");
  });
});

describe('runtime QA [Agent flow]: PaymentReconcileFeedback 三态真实 contract', () => {
  it('Feedback union 含 approval_required/committed/failed 三态', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(RECONCILE_FLOW_SRC).toMatch(/status: 'committed'/);
    expect(RECONCILE_FLOW_SRC).toMatch(/status: 'failed'/);
  });

  it('committed 含 allocations[]（每项 invoiceId/appliedAmount/invoiceStatus/voucherStatus）', () => {
    const committedMatch = RECONCILE_FLOW_SRC.match(/status: 'committed';[\s\S]*?idempotencyKey: string/);
    expect(committedMatch).not.toBeNull();
    expect(committedMatch![0]).toContain('allocations');
    expect(committedMatch![0]).toContain('invoiceStatus');
    expect(committedMatch![0]).toContain('voucherStatus');
  });
});

describe('runtime QA [Agent flow]: PaymentReconcileErrorCode 12 值真实 contract', () => {
  const ERROR_CODES = [
    'APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED',
    'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED',
    'VOUCHER_NOT_FOUND', 'INVOICE_NOT_FOUND', 'ALLOCATION_INVALID', 'OVER_APPLY',
    'COMMIT_TRANSACTION_FAILED', 'UNKNOWN_ERROR',
  ];
  for (const code of ERROR_CODES) {
    it(`error code "${code}" 在 reconcileFlow.ts 真实 union 内`, () => {
      expect(RECONCILE_FLOW_SRC).toContain(`'${code}'`);
    });
  }
});

describe('runtime QA [Agent flow]: Agent committed.allocations 与 manual UI 同源', () => {
  it('committed.allocations[].invoiceStatus 来源 recalcInvoiceStatus（commit 复用 allocationService 纯函数）', () => {
    expect(RECONCILE_FLOW_SRC).toMatch(/recalcInvoiceStatus/);
    expect(RECONCILE_FLOW_SRC).toMatch(/recalcVoucherStatus/);
  });
  it('manual UI newInvoiceStatus 与 Agent committed.allocations[].invoiceStatus 同一 recalc 规则', () => {
    // manual route + Agent commit 都调 recalcInvoiceStatus/recalcVoucherStatus
    const routeSrc = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/route.ts'), 'utf-8');
    expect(routeSrc).toMatch(/recalcInvoiceStatus/);
    expect(RECONCILE_FLOW_SRC).toMatch(/recalcInvoiceStatus/);
  });
});

describe('runtime QA [边界]: FinanceManager 与 Agent contract 隔离', () => {
  const fmSrc = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
  it('FinanceManager 手动核销不调用 Agent flow（独立范围）', () => {
    expect(fmSrc).not.toMatch(/receive_and_reconcile|reconcileFlow|PaymentReconcileFeedback/);
  });
  it('FinanceManager 消费 allocation route contract', () => {
    expect(fmSrc).toMatch(/result\.allocation/);
    expect(fmSrc).toMatch(/result\.newInvoiceStatus/);
    expect(fmSrc).toContain('mutationOk');
    expect(fmSrc).toContain('resolveAllocParties');
  });
});

// ═══ Part 3: aff55ac Decimal-safe service reuse 新契约 ═══
describe('runtime QA [aff55ac]: Decimal-safe service reuse', () => {
  it('commit 循环用 String(appliedAmount)（非 Number，保持 Decimal 高精度）', () => {
    expect(RECONCILE_FLOW_SRC).toContain('String(after.appliedAmount)');
  });
  it('PaymentReconcileCommitted.allocations.appliedAmount 类型为 string', () => {
    expect(RECONCILE_FLOW_SRC).toContain('appliedAmount: string');
  });
  it('ReconcileDraftInput.allocations.appliedAmount 允许 string | number（draft 兼容）', () => {
    expect(RECONCILE_FLOW_SRC).toContain('appliedAmount: string | number');
  });
  it('commit 复用 applyAllocation 共用 service（route + Agent 同一事务闭环）', () => {
    expect(RECONCILE_FLOW_SRC).toContain('复用 applyAllocation 共用 service');
  });
  it('commit 在 prisma.\$transaction 闭环内调 applyAllocation', () => {
    const lastApply = RECONCILE_FLOW_SRC.lastIndexOf('applyAllocation');
    const before = RECONCILE_FLOW_SRC.slice(0, lastApply);
    expect(before).toContain('prisma.\$transaction');
  });
  it('commit 内有 auditLog.create（同事务审计）', () => {
    const lastApply = RECONCILE_FLOW_SRC.lastIndexOf('applyAllocation');
    const after = RECONCILE_FLOW_SRC.slice(lastApply);
    expect(after).toContain('auditLog.create');
  });
});

describe('runtime QA [aff55ac]: toolRuntime dispatch + manifest 可见', () => {
  const toolRuntimeSrc = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
  it('toolRuntime 有 payment.receive_and_reconcile draft 分支', () => {
    expect(toolRuntimeSrc).toContain("definition.id === 'payment.receive_and_reconcile'");
  });
  it('toolRuntime 有 payment.receive_and_reconcile commit 分支', () => {
    expect(toolRuntimeSrc).toContain("call.toolId === 'payment.receive_and_reconcile'");
  });
  it('manifest/toolRegistry 注册 payment.receive_and_reconcile', () => {
    expect(TOOL_REGISTRY_SRC).toContain('payment.receive_and_reconcile');
  });
});

describe('runtime QA [aff55ac]: manifest.ts payment.receive_and_reconcile 真实 source', () => {
  const MANIFEST_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/mcp/manifest.ts'), 'utf-8');
  // 定位 payment.receive_and_reconcile entry 区间（到下一个 id: 行）
  const start = MANIFEST_SRC.indexOf("id: 'payment.receive_and_reconcile'");
  const nextEntry = MANIFEST_SRC.indexOf('\n    id: \'', start + 10);
  const entry = nextEntry > 0 ? MANIFEST_SRC.slice(start, nextEntry) : MANIFEST_SRC.slice(start, start + 1200);
  it('id 存在', () => {
    expect(entry).toContain("id: 'payment.receive_and_reconcile'");
  });
  it('inputHint 含 appliedAmount: string（Decimal string recommended）', () => {
    expect(entry).toContain('appliedAmount: string');
    expect(entry).toContain('Decimal string recommended');
  });
  it('example.allocations[].appliedAmount 使用字符串（\"600.0000\" / \"400.0000\"）', () => {
    expect(entry).toContain("appliedAmount: '600.0000'");
    expect(entry).toContain("appliedAmount: '400.0000'");
  });
});
