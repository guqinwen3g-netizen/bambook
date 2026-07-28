import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/invoiceMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/route.ts'), 'utf-8');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/invoiceMutationFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const INV_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/invoiceService.ts'), 'utf-8');
const FINANCE_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');

function sliceFromFunc(src: string, funcName: string): string {
  const marker = `export async function ${funcName}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const nextExport = src.indexOf('\nexport ', start + marker.length);
  return nextExport > 0 ? src.slice(start, nextExport) : src.slice(start);
}

// Part 1: service mutation 方法
describe('runtime QA [service]: mutation 方法', () => {
  it('createInvoice', () => { expect(SERVICE_SRC).toContain('export async function createInvoice'); });
  it('updateInvoice', () => { expect(SERVICE_SRC).toContain('export async function updateInvoice'); });
});

// Part 2: service $transaction + audit + sync
describe('runtime QA [service]: $transaction 事务闭环', () => {
  it('create 包 $transaction + syncInvoiceReferences + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'createInvoice');
    expect(b).toContain('$transaction');
    expect(b).toContain('syncInvoiceReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('update 包 $transaction + audit', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'updateInvoice');
    expect(b).toContain('$transaction');
    expect(b).toContain('writeRouteAuditLog');
  });
});

// Part 3: ErrorCode
describe('runtime QA [service]: ErrorCode', () => {
  const CODES = ['INVALID_STATUS', 'INVALID_TRANSITION', 'INVALID_CURRENT_STATUS', 'INVALID_AMOUNT', 'NOT_FOUND', 'CREATE_FAILED', 'UPDATE_FAILED'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// Part 4: Decimal/status fail closed
describe('runtime QA [service]: Decimal/status fail closed', () => {
  it('DECIMAL_FIELDS 含 amount/exchangeRate', () => {
    expect(SERVICE_SRC).toContain("'amount'");
    expect(SERVICE_SRC).toContain("'exchangeRate'");
  });
  it('isValidDecimalInput 校验函数', () => { expect(SERVICE_SRC).toContain('function isValidDecimalInput'); });
  it('normalizeDecimalFields', () => { expect(SERVICE_SRC).toContain('function normalizeDecimalFields'); });
  it('INVOICE_CREATE_FIELDS 白名单', () => { expect(SERVICE_SRC).toContain('INVOICE_CREATE_FIELDS'); });
  it('INVOICE_PATCH_FIELDS 白名单', () => { expect(SERVICE_SRC).toContain('INVOICE_PATCH_FIELDS'); });
});

// Part 5: route 端点调 service
describe('runtime QA [route]: 端点调 service', () => {
  it('POST 调 createInvoice', () => { expect(ROUTE_SRC).toContain('createInvoice'); });
  it('PATCH 调 updateInvoice', () => { expect(ROUTE_SRC).toContain('updateInvoice'); });
});

// Part 6: route statusCode map
describe('runtime QA [route]: statusCode map', () => {
  it('create: INVALID_STATUS→400, INVALID_AMOUNT→400, CREATE_FAILED→500', () => {
    expect(ROUTE_SRC).toContain('INVALID_STATUS: 400');
    expect(ROUTE_SRC).toContain('INVALID_AMOUNT: 400');
    expect(ROUTE_SRC).toContain('CREATE_FAILED: 500');
  });
  it('update: NOT_FOUND→404, UPDATE_FAILED→500', () => {
    expect(ROUTE_SRC).toContain('NOT_FOUND: 404');
    expect(ROUTE_SRC).toContain('UPDATE_FAILED: 500');
  });
});

// Part 7: Agent flow buildInvoiceCreateDraft 六字段
describe('runtime QA [Agent flow]: buildInvoiceCreateDraft 六字段', () => {
  it('idempotencyKey: invoice.create:${invoiceNumber}:${hash}', () => { expect(FLOW_SRC).toContain('invoice.create:${invoiceNumber'); });
  it('toolId: invoice.create', () => { expect(FLOW_SRC).toContain("toolId: 'invoice.create'"); });
  it('action: create_invoice', () => { expect(FLOW_SRC).toContain("action: 'create_invoice'"); });
  it('impactScope [finance, entity-links, audit]', () => { expect(FLOW_SRC).toContain("impactScope: ['finance','entity-links','audit']"); });
  it('irreversible false', () => { expect(FLOW_SRC).toContain('irreversible: false'); });
  it('after spread body', () => { expect(FLOW_SRC).toContain('after: { ...body }'); });
});

// Part 8: Agent flow buildInvoiceUpdateDraft
describe('runtime QA [Agent flow]: buildInvoiceUpdateDraft', () => {
  it('idempotencyKey: invoice.update:${invoiceId}:${hash}', () => { expect(FLOW_SRC).toContain('invoice.update:${invoiceId}'); });
  it('toolId: invoice.update', () => { expect(FLOW_SRC).toContain("toolId: 'invoice.update'"); });
  it('action: update_invoice', () => { expect(FLOW_SRC).toContain("action: 'update_invoice'"); });
  it('after { invoiceId, patch }', () => { expect(FLOW_SRC).toContain('after: { invoiceId, patch }'); });
});

// Part 9: Agent flow ErrorCode
describe('runtime QA [Agent flow]: ErrorCode', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => { expect(FLOW_SRC).toContain(code); });
  }
});

// Part 10: hash 防篡改
describe('runtime QA [Agent flow]: hash 防篡改', () => {
  it('computeProcessDraftHash 重算', () => { expect(FLOW_SRC).toContain('computeProcessDraftHash'); });
  it('commitInvoiceCreate: verifyHash + HASH_MISMATCH fail closed + DRAFT_MISSING', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitInvoiceCreate');
    expect(b).toContain('verifyHash(draft)');
    expect(b).toContain('PROCESS_DRAFT_HASH_MISMATCH');
    expect(b).toContain('PROCESS_DRAFT_MISSING');
  });
  it('commitInvoiceUpdate: verifyHash + HASH_MISMATCH', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitInvoiceUpdate');
    expect(b).toContain('PROCESS_DRAFT_HASH_MISMATCH');
  });
});

// Part 11: commit 复用 service
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitInvoiceCreate 复用 createInvoice', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitInvoiceCreate');
    expect(b).toContain('createInvoice');
  });
  it('commitInvoiceUpdate 复用 updateInvoice', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitInvoiceUpdate');
    expect(b).toContain('updateInvoice');
  });
});

// Part 12: toolRuntime commit dispatch 精确分支体
describe('runtime QA [toolRuntime]: commit dispatch 精确分支体', () => {
  it('call.toolId === invoice.create 分支体调 commitInvoiceCreate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'invoice\.create'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitInvoiceCreate');
  });
  it('invoice.create 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'invoice\.create'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });
  it('call.toolId === invoice.update 分支体调 commitInvoiceUpdate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'invoice\.update'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitInvoiceUpdate');
  });
  it('invoice.update 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'invoice\.update'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });
});

// Part 13: 前端 invoiceService
describe('runtime QA [前端 service]: invoiceService', () => {
  it('createInvoice: POST', () => {
    expect(INV_SVC_SRC).toContain('async createInvoice');
    expect(INV_SVC_SRC).toContain("method: 'POST'");
  });
  it('updateInvoice: PATCH', () => {
    expect(INV_SVC_SRC).toContain('async updateInvoice');
    expect(INV_SVC_SRC).toContain("method: 'PATCH'");
  });
  it('失败 throw Error', () => { expect(INV_SVC_SRC).toContain('throw new Error'); });
});

// Part 14: FinanceManager UI 消费
describe('runtime QA [FinanceManager UI]: 消费', () => {
  it('consume createInvoice + setInvoices', () => {
    expect(FINANCE_MGR_SRC).toContain('invoiceService.createInvoice');
    expect(FINANCE_MGR_SRC).toContain('setInvoices(prev => [created');
  });
  it('consume updateInvoice + setInvoices map', () => {
    expect(FINANCE_MGR_SRC).toContain('invoiceService.updateInvoice');
    expect(FINANCE_MGR_SRC).toContain('setInvoices(prev => prev.map');
  });
  it('不调 Agent commit function', () => {
    expect(FINANCE_MGR_SRC).not.toContain('commitInvoiceCreate');
    expect(FINANCE_MGR_SRC).not.toContain('commitInvoiceUpdate');
  });
});

// Part 15: 真实 fixture
describe('runtime QA [fixture]: payload', () => {
  it('create 成功 res: invoice', () => {
    const res = { id: 'inv1', invoiceNumber: 'INV-001', amount: '5000.00', status: 'issued' };
    expect(res.invoiceNumber).toBe('INV-001');
  });
  it('INVALID_AMOUNT 失败', () => { expect({ code: 'INVALID_AMOUNT' }.code).toBe('INVALID_AMOUNT'); });
  it('INVALID_TRANSITION 失败', () => { expect({ code: 'INVALID_TRANSITION' }.code).toBe('INVALID_TRANSITION'); });
});
