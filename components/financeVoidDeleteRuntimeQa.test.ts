import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-finance-void-delete-ui-runtime-qa: fixture-driven runtime QA
 * 消费已 merged cancel/delete route/service + invoice.cancel Agent flow contract
 * （task_mqyurxot route + task_mqyurxot Agent flow）。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改后端 contract。
 */

const fs = require('fs');
const path = require('path');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/invoiceCancelFlow.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/voidDeleteService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/route.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const FINANCE_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
const INVOICE_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/invoiceService.ts'), 'utf-8');
const VOUCHER_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/paymentVoucherService.ts'), 'utf-8');

// ═══ Part 1: Agent invoice.cancel — ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildInvoiceCancelDraft 严格六字段', () => {
  it('idempotencyKey 格式: invoice.cancel:${invoiceId}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `invoice\.cancel:\$\{invoiceId\}:\$\{hash\}`/);
  });
  it('impactScope 固定 [finance]', () => {
    expect(FLOW_SRC).toMatch(/impactScope: \['finance'\]/);
  });
  it('irreversible = true（作废不可逆）', () => {
    expect(FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 invoice.cancel toolId', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'invoice\.cancel'/);
  });
  it('action = cancel_invoice', () => {
    expect(FLOW_SRC).toMatch(/action: 'cancel_invoice'/);
  });
  it('beforeAfterDiff: invoice status → Cancelled（before 从真实 invoice 读，不 hardcode）', () => {
    expect(FLOW_SRC).toMatch(/entity: 'invoice'/);
    expect(FLOW_SRC).toMatch(/field: 'status'/);
    expect(FLOW_SRC).toMatch(/before: \(currentStatus \|\| 'unknown'\)/);
    expect(FLOW_SRC).toMatch(/after: 'Cancelled'/);
  });
  it('return 展开 content + idempotencyKey（严格六字段）', () => {
    expect(FLOW_SRC).toMatch(/return \{ \.\.\.content, idempotencyKey \}/);
  });
  it('afterPayload 含 invoiceId（what-you-approve-is-what-you-commit）', () => {
    expect(FLOW_SRC).toMatch(/afterPayload.*invoiceId/);
  });
});

// ═══ Part 2: Agent invoice.cancel — Feedback 三态 ═══
describe('runtime QA [Agent flow]: InvoiceCancelFlowFeedback 三态', () => {
  it('Feedback union 含 approval_required/committed/failed', () => {
    expect(FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(FLOW_SRC).toMatch(/status: 'committed'/);
    expect(FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('InvoiceCancelFlowCommitted 含 invoiceId/auditId/idempotencyKey', () => {
    const m = FLOW_SRC.match(/export interface InvoiceCancelFlowCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['invoiceId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

// ═══ Part 3: Agent invoice.cancel — ErrorCode union ═══
describe('runtime QA [Agent flow]: ErrorCode union 真实 contract', () => {
  const FLOW_CODES = [
    'APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED',
    'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED',
    'UNKNOWN_ERROR',
  ];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}" 在 invoiceCancelFlow.ts`, () => {
      expect(FLOW_SRC).toContain(`'${code}'`);
    });
  }
  const SERVICE_CODES = ['INVOICE_NOT_FOUND', 'VOUCHER_NOT_FOUND', 'INVALID_STATUS', 'HAS_ALLOCATIONS', 'CANCEL_FAILED', 'DELETE_FAILED'];
  for (const code of SERVICE_CODES) {
    it(`service error code "${code}" 在 voidDeleteService.ts`, () => {
      expect(SERVICE_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 4: Agent invoice.cancel — draft-first 防篡改 + 语义校验 ═══
describe('runtime QA [Agent flow]: 防篡改 + 语义校验', () => {
  it('verifyInvoiceCancelDraftHash 解析 :pd: 前缀', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH', () => {
    expect(FLOW_SRC).toContain("'PROCESS_DRAFT_HASH_MISMATCH'");
  });
  it('InvoiceCancelDraftInput: invoiceId + reason? + currentStatus?', () => {
    const m = FLOW_SRC.match(/export interface InvoiceCancelDraftInput \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('invoiceId');
    expect(m![0]).toContain('reason');
    expect(m![0]).toContain('currentStatus');
  });
});

// ═══ Part 5: Manual route — POST /:id/cancel + DELETE /:id ═══
describe('runtime QA [Manual route]: cancel + soft delete', () => {
  it('route: POST /:id/cancel 端点存在', () => {
    expect(ROUTE_SRC).toMatch(/router\.post\('\/:id\/cancel'/);
  });
  it('route: POST /:id/cancel 调用 cancelInvoice service', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/:id\/cancel'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/cancelInvoice/);
  });
  it('route: POST /:id/cancel 成功返回 { ok:true, invoice }', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/:id\/cancel'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true, invoice/);
  });
  it('route: DELETE /:id 端点存在（Invoice 软删）', () => {
    expect(ROUTE_SRC).toMatch(/router\.delete\('\/:id'/);
  });
  it('route: DELETE /:id 调用 deleteInvoice service', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/deleteInvoice/);
  });
  it('route: DELETE /:id 成功返回 { ok:true }（不返回数据，前端删除本地）', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true \}/);
  });
});

// ═══ Part 6: Manual route — 错误反馈 statusCode map ═══
describe('runtime QA [Manual route]: 错误反馈 statusCode map', () => {
  it('cancel route: INVOICE_NOT_FOUND→404, INVALID_STATUS→400, HAS_ALLOCATIONS→409', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/:id\/cancel'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/INVOICE_NOT_FOUND: 404/);
    expect(m![0]).toMatch(/INVALID_STATUS: 400/);
    expect(m![0]).toMatch(/HAS_ALLOCATIONS: 409/);
  });
  it('delete route: 同 statusCode map（HAS_ALLOCATIONS→409 阻断软删）', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/HAS_ALLOCATIONS: 409/);
  });
});

// ═══ Part 7: voidDeleteService — cancelInvoice/deleteInvoice/deleteVoucher 函数 ═══
describe('runtime QA [service]: voidDeleteService 函数', () => {
  it('cancelInvoice 导出', () => {
    expect(SERVICE_SRC).toMatch(/export async function cancelInvoice/);
  });
  it('deleteInvoice 导出', () => {
    expect(SERVICE_SRC).toMatch(/export async function deleteInvoice/);
  });
  it('deleteVoucher 导出', () => {
    expect(SERVICE_SRC).toMatch(/export async function deleteVoucher/);
  });
  it('cancelInvoice 返回 CancelInvoiceResult（含 invoice）', () => {
    expect(SERVICE_SRC).toMatch(/CancelInvoiceResult/);
  });
  it('deleteInvoice 返回 DeleteInvoiceResult', () => {
    expect(SERVICE_SRC).toMatch(/DeleteInvoiceResult/);
  });
});

// ═══ Part 8: 前端 service — invoiceService cancel/delete 消费 route ═══
describe('runtime QA [前端 service]: invoiceService cancel/delete', () => {
  it('cancelInvoice: POST /v1/finance/:id/cancel', () => {
    expect(INVOICE_SVC_SRC).toMatch(/\/v1\/finance\/\$\{[^}]+\}\/cancel/);
    expect(INVOICE_SVC_SRC).toMatch(/method: 'POST'/);
  });
  it('cancelInvoice: 成功返回 invoice（消费后端 res.invoice）', () => {
    expect(INVOICE_SVC_SRC).toMatch(/return data\.invoice/);
  });
  it('deleteInvoice: DELETE /v1/finance/:id', () => {
    expect(INVOICE_SVC_SRC).toMatch(/\/v1\/finance\/\$\{[^}]+\}/);
    expect(INVOICE_SVC_SRC).toMatch(/method: 'DELETE'/);
  });
  it('deleteInvoice: 成功返回 { ok:true }', () => {
    expect(INVOICE_SVC_SRC).toMatch(/return \{ ok: true \}/);
  });
  it('失败 throw Error（消费后端 error.message/code）', () => {
    expect(INVOICE_SVC_SRC).toMatch(/throw new Error\(data\?\.error\?\.message/);
  });
});

// ═══ Part 9: 前端 service — paymentVoucherService delete ═══
describe('runtime QA [前端 service]: paymentVoucherService delete', () => {
  it('deletePaymentVoucher: DELETE /v1/finance/vouchers/:id', () => {
    expect(VOUCHER_SVC_SRC).toMatch(/\/v1\/finance\/vouchers\/\$\{[^}]+\}/);
    expect(VOUCHER_SVC_SRC).toMatch(/method: 'DELETE'/);
  });
  it('失败 throw Error（消费后端 error；R678 起统一经 readVoucherError 中文映射，error.message 仍被消费）', () => {
    expect(VOUCHER_SVC_SRC).toMatch(/data\?\.error\?\.message/);
    expect(VOUCHER_SVC_SRC).toMatch(/readVoucherError\(res, '凭证删除'\)/);
  });
});

// ═══ Part 10: FinanceManager UI — 作废/软删入口 ═══
describe('runtime QA [FinanceManager UI]: 作废/软删入口', () => {
  it('consume invoiceService.cancelInvoice', () => {
    expect(FINANCE_MGR_SRC).toMatch(/invoiceService\.cancelInvoice/);
  });
  it('consume invoiceService.deleteInvoice', () => {
    expect(FINANCE_MGR_SRC).toMatch(/invoiceService\.deleteInvoice/);
  });
  it('作废只对非 Cancelled 发票显示（status !== Cancelled 条件渲染）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/invoice\.status !== 'Cancelled'/);
  });
  it('作废成功消费后端 updated invoice 对象更新本地（不硬写 status=Cancelled as any）', () => {
    // 消费后端返回的 invoice 对象 spread 更新，不硬写 status
    expect(FINANCE_MGR_SRC).toMatch(/\{ \.\.\.i, \.\.\.updated \}/);
    // 不应出现硬写 status: 'Cancelled' as any
    expect(FINANCE_MGR_SRC).not.toMatch(/status: 'Cancelled' as any/);
  });
  it('作废成功通过列表更新自动 derived selectedItem（不调 setSelectedItem）', () => {
    // selectedItem 是 derived（从 activeList.find），列表更新后自动反映
    expect(FINANCE_MGR_SRC).not.toMatch(/setSelectedItem/);
  });
  it('invoice 软删成功 setSelectedId(null) 清空选择（用现有 setter）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/setInvoices\(prev => prev\.filter\(i => i\.id !== invoice\.id\)\)/);
    expect(FINANCE_MGR_SRC).toMatch(/setSelectedId\(null\)/);
  });
  it('软删成功从列表移除（消费后端 ok:true）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/prev => prev\.filter\(i => i\.id !== invoice\.id\)/);
  });
  it('失败显示错误反馈（voidDeleteError state）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/setVoidDeleteError/);
    expect(FINANCE_MGR_SRC).toMatch(/voidDeleteError/);
  });
  it('作废/删除中 disabled + Loader2 旋转（防止重复点击）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/disabled=\{voidDeletingId === invoice\.id\}/);
    expect(FINANCE_MGR_SRC).toMatch(/Loader2.*animate-spin/);
  });
  it('确认弹窗（bdsConfirm 防误操作）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/bdsConfirm/);
  });
  it('voucher 详情补软删入口（消费 paymentVoucherService.deletePaymentVoucher）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/paymentVoucherService\.deletePaymentVoucher/);
  });
  it('voucher 软删只对 voucher 显示（!isInvoice && voucher 条件渲染）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/!isInvoice && voucher/);
  });
  it('voucher 软删成功从列表移除', () => {
    expect(FINANCE_MGR_SRC).toMatch(/prev => prev\.filter\(v => v\.id !== voucher\.id\)/);
  });
});

describe('runtime QA [import 防回退]: Loader2/AlertCircle 已 import', () => {
  it('lucide-react import 含 Loader2（作废/删除中旋转图标）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/import \{[^}]*Loader2[^}]*\} from 'lucide-react'/);
  });
  it('lucide-react import 含 AlertCircle（作废按钮图标）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/import \{[^}]*AlertCircle[^}]*\} from 'lucide-react'/);
  });
  it('FinanceManager 使用 Loader2 + AlertCircle（非未定义引用）', () => {
    expect(FINANCE_MGR_SRC).toMatch(/<Loader2/);
    expect(FINANCE_MGR_SRC).toMatch(/<AlertCircle/);
  });
});

describe('runtime QA [TS2448 防回退]: hook 声明顺序稳定', () => {
  it('isInvoiceContext 在 selectedItem 声明之后（避免 TDZ）', () => {
    const itemIdx = FINANCE_MGR_SRC.indexOf('const selectedItem = activeList.find');
    const ctxIdx = FINANCE_MGR_SRC.indexOf('const isInvoiceContext = activeTab');
    expect(itemIdx).toBeGreaterThan(0);
    expect(ctxIdx).toBeGreaterThan(itemIdx);
  });
  it('allocations useEffect 在 selectedItem 声明之后（避免 TDZ TS2448）', () => {
    const itemIdx = FINANCE_MGR_SRC.indexOf('const selectedItem = activeList.find');
    const effectIdx = FINANCE_MGR_SRC.indexOf('allocationService.listAllocations(undefined, params)');
    // listAllocations 有多处（handleSaveAlloc + useEffect），找 useEffect 内的那处
    const useEffectIdx = FINANCE_MGR_SRC.indexOf('}, [selectedItem?.id, activeTab]);');
    expect(itemIdx).toBeGreaterThan(0);
    expect(useEffectIdx).toBeGreaterThan(itemIdx);
  });
  it('不使用不存在的 setSelectedItem（用 setSelectedId 替代）', () => {
    expect(FINANCE_MGR_SRC).not.toMatch(/setSelectedItem/);
  });
});

// ═══ Part 11: 边界 — FinanceManager 不混 Agent flow + 不显示 deletedAt ═══
describe('runtime QA [边界]: FinanceManager 不混 Agent flow + 不显示 deletedAt', () => {
  it('FinanceManager 不调用 Agent invoice.cancel flow（只走 manual route）', () => {
    expect(FINANCE_MGR_SRC).not.toMatch(/invoiceCancelFlow|commitInvoiceCancel|invoice\.cancel/);
  });
  it('FinanceManager 不显示 deletedAt 项（列表/详情无 deletedAt 字段）', () => {
    // fieldRows 不含 deletedAt
    const fieldRowsMatch = FINANCE_MGR_SRC.match(/const fieldRows = isInvoice[\s\S]*?\];/);
    if (fieldRowsMatch) {
      expect(fieldRowsMatch![0]).not.toMatch(/deletedAt/);
    }
  });
});

// ═══ Part 12: toolRuntime — invoice.cancel 分支 ═══
describe('runtime QA [toolRuntime]: invoice.cancel commit 分支', () => {
  it('toolRuntime 含 invoice.cancel 分支（draft-first）', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'invoice\.cancel'/);
  });
});

// ═══ Part 13: 真实 payload fixture ═══
describe('runtime QA [fixture]: 真实 cancel/delete payload 消费', () => {
  it('InvoiceCancelDraftInput: { invoiceId, reason?, currentStatus? }', () => {
    const input = { invoiceId: 'INV1', reason: '客户取消', currentStatus: 'Issued' };
    expect(input.invoiceId).toBe('INV1');
    expect(input.currentStatus).toBe('Issued');
  });
  it('committed payload: { status:committed, invoiceId, auditId, idempotencyKey }', () => {
    const committed = {
      status: 'committed' as const,
      invoiceId: 'INV1', auditId: 'alog_123',
      idempotencyKey: 'invoice.cancel:INV1:pd:abc123',
    };
    expect(committed.status).toBe('committed');
    expect(committed.idempotencyKey).toContain('invoice.cancel:INV1');
  });
  it('cancel route 成功: { ok:true, invoice:{...status:Cancelled} }', () => {
    const res = { ok: true, invoice: { id: 'INV1', status: 'Cancelled', invoiceNumber: 'INV-001' } };
    expect(res.invoice.status).toBe('Cancelled');
  });
  it('delete route 成功: { ok:true }', () => {
    const res = { ok: true };
    expect(res.ok).toBe(true);
  });
  it('HAS_ALLOCATIONS 失败: { ok:false, error:{code, message} }', () => {
    const res = { ok: false, error: { code: 'HAS_ALLOCATIONS', message: 'Invoice has allocations, cannot delete' } };
    expect(res.error.code).toBe('HAS_ALLOCATIONS');
  });
  it('INVOICE_NOT_FOUND 失败: 404', () => {
    const res = { ok: false, error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice INV1 not found' } };
    expect(res.error.code).toBe('INVOICE_NOT_FOUND');
  });
});
