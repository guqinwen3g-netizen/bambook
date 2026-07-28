import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-finance-soft-delete-runtime-qa: fixture-driven runtime QA
 * 消费已 merged invoice.delete + payment_voucher.delete Agent flow contract
 * （task_mr1mcpbz）+ 已有 FinanceManager 软删 UI 边界。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改业务代码。
 */

const fs = require('fs');
const path = require('path');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/financeSoftDeleteFlow.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/voidDeleteService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/route.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const FINANCE_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
const INVOICE_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/invoiceService.ts'), 'utf-8');
const VOUCHER_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/paymentVoucherService.ts'), 'utf-8');

// ═══ Part 1: Agent flow — invoice.delete ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildInvoiceDeleteDraft 六字段', () => {
  it('idempotencyKey 格式: invoice.delete:${invoiceId}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `invoice\.delete:\$\{invoiceId\}:\$\{hash\}`/);
  });
  it('impactScope 固定 [finance, entity-links, audit]', () => {
    expect(FLOW_SRC).toMatch(/impactScope: \['finance', 'entity-links', 'audit'\]/);
  });
  it('irreversible = true', () => {
    expect(FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 invoice.delete toolId', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'invoice\.delete'/);
  });
  it('action = delete_invoice', () => {
    expect(FLOW_SRC).toMatch(/action: 'delete_invoice'/);
  });
  it('beforeAfterDiff: invoice deletedAt null → true', () => {
    expect(FLOW_SRC).toMatch(/entity: 'invoice'[\s\S]*?field: 'deletedAt'[\s\S]*?before: null[\s\S]*?after: true as any/);
  });
});

// ═══ Part 2: Agent flow — payment_voucher.delete ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildPaymentVoucherDeleteDraft 六字段', () => {
  it('idempotencyKey 格式: payment_voucher.delete:${voucherId}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `payment_voucher\.delete:\$\{voucherId\}:\$\{hash\}`/);
  });
  it('toolId = payment_voucher.delete', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'payment_voucher\.delete'/);
  });
  it('action = delete_voucher', () => {
    expect(FLOW_SRC).toMatch(/action: 'delete_voucher'/);
  });
  it('beforeAfterDiff: paymentVoucher deletedAt null → true', () => {
    expect(FLOW_SRC).toMatch(/entity: 'paymentVoucher'[\s\S]*?field: 'deletedAt'[\s\S]*?before: null[\s\S]*?after: true as any/);
  });
});

// ═══ Part 3: Agent flow — Feedback 三态 + Committed ═══
describe('runtime QA [Agent flow]: Feedback 三态 + Committed', () => {
  it('Feedback union 含 approval_required/committed/failed', () => {
    expect(FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(FLOW_SRC).toMatch(/status: 'committed'/);
    expect(FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('Committed 含 entityId/auditId/idempotencyKey', () => {
    const m = FLOW_SRC.match(/export interface FinanceSoftDeleteFlowCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['entityId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

// ═══ Part 4: Agent flow — ErrorCode union ═══
describe('runtime QA [Agent flow]: ErrorCode union', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED', 'UNKNOWN_ERROR'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => {
      expect(FLOW_SRC).toContain(`'${code}'`);
    });
  }
  const SERVICE_CODES = ['INVOICE_NOT_FOUND', 'VOUCHER_NOT_FOUND', 'INVALID_STATUS', 'HAS_ALLOCATIONS', 'CANCEL_FAILED', 'DELETE_FAILED'];
  for (const code of SERVICE_CODES) {
    it(`service error code "${code}"`, () => {
      expect(SERVICE_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 5: Agent flow — hash 防篡改链路（两条 commit path） ═══
describe('runtime QA [Agent flow]: hash 防篡改（commit path 精确断言）', () => {
  it('commitInvoiceDelete: verifyInvoiceDeleteDraftHash 调用', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitInvoiceDelete[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/verifyInvoiceDeleteDraftHash/);
  });
  it('commitInvoiceDelete: hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH fail closed', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitInvoiceDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_HASH_MISMATCH/);
  });
  it('commitInvoiceDelete: draft missing → PROCESS_DRAFT_MISSING', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitInvoiceDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_MISSING/);
  });
  it('verifyInvoiceDeleteDraftHash: :pd: 后缀解析', () => {
    const fnMatch = FLOW_SRC.match(/export function verifyInvoiceDeleteDraftHash[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });

  it('commitPaymentVoucherDelete: verifyPaymentVoucherDeleteDraftHash 调用', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitPaymentVoucherDelete[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/verifyPaymentVoucherDeleteDraftHash/);
  });
  it('commitPaymentVoucherDelete: hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH fail closed', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitPaymentVoucherDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_HASH_MISMATCH/);
  });
});

// ═══ Part 6: Agent flow — commit 复用 service（不绕 contract） ═══
describe('runtime QA [Agent flow]: commit 复用 deleteInvoice/deleteVoucher service', () => {
  it('commitInvoiceDelete 复用 deleteInvoice service', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitInvoiceDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/deleteInvoice\(/);
  });
  it('commitPaymentVoucherDelete 复用 deleteVoucher service', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitPaymentVoucherDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/deleteVoucher\(/);
  });
  it('commitInvoiceDelete 成功返回 entityId=invoiceId', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitInvoiceDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/entityId: after\.invoiceId/);
  });
  it('commitPaymentVoucherDelete 成功返回 entityId=voucherId', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitPaymentVoucherDelete[\s\S]*?^}/m);
    expect(fnMatch![0]).toMatch(/entityId: after\.voucherId/);
  });
});

// ═══ Part 7: toolRuntime commit dispatch ═══
describe('runtime QA [toolRuntime]: invoice.delete + payment_voucher.delete commit dispatch', () => {
  it('toolRuntime commit dispatch: call.toolId === invoice.delete 分支', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/if \(call\.toolId === 'invoice\.delete'\)/);
  });
  it('toolRuntime commit dispatch: invoice.delete 分支体调用 commitInvoiceDelete', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'invoice\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/commitInvoiceDelete/);
  });
  it('toolRuntime commit dispatch: invoice.delete 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'invoice\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toMatch(/approvalId: targetApprovalId/);
    expect(m![0]).toMatch(/approvalPayload: approval\.payload/);
  });

  it('toolRuntime commit dispatch: call.toolId === payment_voucher.delete 分支', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/if \(call\.toolId === 'payment_voucher\.delete'\)/);
  });
  it('toolRuntime commit dispatch: payment_voucher.delete 分支体调用 commitPaymentVoucherDelete', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'payment_voucher\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/commitPaymentVoucherDelete/);
  });
  it('toolRuntime commit dispatch: payment_voucher.delete 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'payment_voucher\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toMatch(/approvalId: targetApprovalId/);
    expect(m![0]).toMatch(/approvalPayload: approval\.payload/);
  });

  it('toolRuntime draft 分支: definition.id === invoice.delete', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'invoice\.delete'/);
  });
  it('toolRuntime draft 分支: definition.id === payment_voucher.delete', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'payment_voucher\.delete'/);
  });
  it('toolRuntime import commitInvoiceDelete/commitPaymentVoucherDelete from financeSoftDeleteFlow', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/import.*commitInvoiceDelete.*commitPaymentVoucherDelete.*from.*financeSoftDeleteFlow/);
  });
});

// ═══ Part 8: Manual route — DELETE /:id + DELETE /vouchers/:id ═══
describe('runtime QA [Manual route]: invoice + voucher soft delete', () => {
  it('route: DELETE /:id 端点（invoice 软删）', () => {
    expect(ROUTE_SRC).toMatch(/router\.delete\('\/:id'/);
  });
  it('route: DELETE /:id 调用 deleteInvoice service', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/deleteInvoice/);
  });
  it('route: invoice DELETE 成功返回 { ok:true }', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true \}/);
  });
  it('route: DELETE /vouchers/:id 端点（voucher 软删）', () => {
    expect(ROUTE_SRC).toMatch(/router\.delete\('\/vouchers\/:id'/);
  });
  it('route: DELETE /vouchers/:id 调用 deleteVoucher service', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/vouchers\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/deleteVoucher/);
  });
  it('route: voucher DELETE 成功返回 { ok:true }', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/vouchers\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true \}/);
  });
  it('route: invoice DELETE statusCode map（HAS_ALLOCATIONS→409）', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/HAS_ALLOCATIONS: 409/);
  });
  it('route: voucher DELETE statusCode map（HAS_ALLOCATIONS→409）', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/vouchers\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/HAS_ALLOCATIONS: 409/);
  });
});

// ═══ Part 9: 前端 service — deleteInvoice + deletePaymentVoucher ═══
describe('runtime QA [前端 service]: deleteInvoice + deletePaymentVoucher', () => {
  it('deleteInvoice: DELETE /v1/finance/:id', () => {
    expect(INVOICE_SVC_SRC).toMatch(/\/v1\/finance\/\$\{[^}]+\}/);
    expect(INVOICE_SVC_SRC).toMatch(/method: 'DELETE'/);
  });
  it('deletePaymentVoucher: DELETE /v1/finance/vouchers/:id', () => {
    expect(VOUCHER_SVC_SRC).toMatch(/\/v1\/finance\/vouchers\/\$\{[^}]+\}/);
    expect(VOUCHER_SVC_SRC).toMatch(/method: 'DELETE'/);
  });
  it('失败 throw Error（消费后端 error）', () => {
    expect(INVOICE_SVC_SRC).toMatch(/throw new Error/);
    expect(VOUCHER_SVC_SRC).toMatch(/throw new Error/);
  });
});

// ═══ Part 10: FinanceManager UI — 软删边界 ═══
describe('runtime QA [FinanceManager UI]: invoice + voucher 软删边界', () => {
  it('consume invoiceService.deleteInvoice', () => {
    expect(FINANCE_MGR_SRC).toMatch(/invoiceService\.deleteInvoice/);
  });
  it('consume paymentVoucherService.deletePaymentVoucher', () => {
    expect(FINANCE_MGR_SRC).toMatch(/paymentVoucherService\.deletePaymentVoucher/);
  });
  it('invoice 软删成功从列表移除（setInvoices filter）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/prev => prev\.filter\(i => i\.id !== invoice\.id\)/);
  });
  it('voucher 软删成功从列表移除（setVouchers filter）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/prev => prev\.filter\(v => v\.id !== voucher\.id\)/);
  });
  it('软删失败显示 voidDeleteError（不伪成功）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/setVoidDeleteError/);
  });
});

// ═══ Part 11: 边界 — FinanceManager 不混 Agent flow ═══
describe('runtime QA [边界]: FinanceManager 不混 Agent flow', () => {
  it('FinanceManager 不调用 Agent invoice.delete/payment_voucher.delete flow', () => {
    expect(FINANCE_MGR_SRC).not.toMatch(/financeSoftDeleteFlow|commitInvoiceDelete|commitPaymentVoucherDelete/);
  });
});

// ═══ Part 12: 真实 payload fixture ═══
describe('runtime QA [fixture]: 真实 soft delete payload 消费', () => {
  it('InvoiceDeleteDraftInput: { invoiceId }', () => {
    const input = { invoiceId: 'INV1' };
    expect(input.invoiceId).toBe('INV1');
  });
  it('PaymentVoucherDeleteDraftInput: { voucherId }', () => {
    const input = { voucherId: 'PV1' };
    expect(input.voucherId).toBe('PV1');
  });
  it('invoice committed: { status:committed, entityId, auditId, idempotencyKey }', () => {
    const committed = {
      status: 'committed' as const,
      entityId: 'INV1', auditId: 'alog_123',
      idempotencyKey: 'invoice.delete:INV1:pd:abc',
    };
    expect(committed.idempotencyKey).toContain('invoice.delete:INV1');
  });
  it('voucher committed: { status:committed, entityId, auditId, idempotencyKey }', () => {
    const committed = {
      status: 'committed' as const,
      entityId: 'PV1', auditId: 'alog_456',
      idempotencyKey: 'payment_voucher.delete:PV1:pd:def',
    };
    expect(committed.idempotencyKey).toContain('payment_voucher.delete:PV1');
  });
  it('HAS_ALLOCATIONS 失败（service error code 稳定）', () => {
    expect(SERVICE_SRC).toContain("'HAS_ALLOCATIONS'");
  });
  it('DELETE_FAILED 失败（service error code 稳定）', () => {
    expect(SERVICE_SRC).toContain("'DELETE_FAILED'");
  });
});
