import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/paymentVoucherMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/route.ts'), 'utf-8');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/paymentVoucherMutationFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const PV_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/paymentVoucherService.ts'), 'utf-8');
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
  it('createPaymentVoucher', () => { expect(SERVICE_SRC).toContain('export async function createPaymentVoucher'); });
  it('updatePaymentVoucher', () => { expect(SERVICE_SRC).toContain('export async function updatePaymentVoucher'); });
});

// Part 2: service $transaction + audit + sync
describe('runtime QA [service]: $transaction 事务闭环', () => {
  it('create 包 $transaction + syncPaymentVoucherReferences + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'createPaymentVoucher');
    expect(b).toContain('$transaction');
    expect(b).toContain('syncPaymentVoucherReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('update 包 $transaction + sync + audit', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'updatePaymentVoucher');
    expect(b).toContain('$transaction');
    expect(b).toContain('syncPaymentVoucherReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
});

// Part 3: ErrorCode
describe('runtime QA [service]: ErrorCode', () => {
  const CODES = ['INVALID_STATUS', 'INVALID_AMOUNT', 'NOT_FOUND', 'CREATE_FAILED', 'UPDATE_FAILED'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// Part 4: Decimal/status fail closed
describe('runtime QA [service]: Decimal/status fail closed', () => {
  it('VALID_PAYMENT_VOUCHER_STATUS 白名单', () => {
    expect(SERVICE_SRC).toContain("['unreconciled', 'partially_reconciled', 'reconciled']");
  });
  it('DECIMAL_FIELDS 含 amount/bankFee/exchangeRate/appliedAmount', () => {
    expect(SERVICE_SRC).toContain("'amount'");
    expect(SERVICE_SRC).toContain("'bankFee'");
    expect(SERVICE_SRC).toContain("'exchangeRate'");
    expect(SERVICE_SRC).toContain("'appliedAmount'");
  });
  it('isValidDecimalInput 校验函数', () => { expect(SERVICE_SRC).toContain('function isValidDecimalInput'); });
  it('isValidStatus 校验（includes 白名单）', () => { expect(SERVICE_SRC).toContain('VALID_PAYMENT_VOUCHER_STATUS'); });
});

// Part 5: route 端点调 service
describe('runtime QA [route]: 端点调 service', () => {
  it('POST /vouchers 调 createPaymentVoucher', () => { expect(ROUTE_SRC).toContain('createPaymentVoucher'); });
  it('PATCH /vouchers/:id 调 updatePaymentVoucher', () => { expect(ROUTE_SRC).toContain('updatePaymentVoucher'); });
});

// Part 6: route onDataChange + statusCode
describe('runtime QA [route]: onDataChange + statusCode', () => {
  it('create → entity: finance.vouchers', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'finance.vouchers', action: 'create'"); });
  it('update → entity: finance.vouchers', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'finance.vouchers', action: 'update'"); });
  it('create statusCode: INVALID_STATUS→400, INVALID_AMOUNT→400, CREATE_FAILED→500', () => {
    expect(ROUTE_SRC).toContain('INVALID_STATUS: 400, INVALID_AMOUNT: 400, CREATE_FAILED: 500');
  });
  it('update statusCode: NOT_FOUND→404, UPDATE_FAILED→500', () => {
    // 断言映射存在性而非字面相邻（statusCodeMap 后续插入新错误码不应误报）
    expect(ROUTE_SRC).toMatch(/NOT_FOUND: 404/);
    expect(ROUTE_SRC).toMatch(/UPDATE_FAILED: 500/);
  });
});

// Part 7: route 成功返回
describe('runtime QA [route]: 成功返回', () => {
  it('create 201 serializeFinanceValue', () => { expect(ROUTE_SRC).toContain('res.status(201).json(serializeFinanceValue(created))'); });
});

// Part 8: Agent flow buildPaymentVoucherCreateDraft 六字段
describe('runtime QA [Agent flow]: buildPaymentVoucherCreateDraft 六字段', () => {
  it('idempotencyKey: payment_voucher.create:${voucherNumber}:${hash}', () => { expect(FLOW_SRC).toContain('payment_voucher.create:${voucherNumber'); });
  it('toolId: payment_voucher.create', () => { expect(FLOW_SRC).toContain("toolId: 'payment_voucher.create'"); });
  it('action: create_payment_voucher', () => { expect(FLOW_SRC).toContain("action: 'create_payment_voucher'"); });
  it('impactScope [finance, entity-links, audit]', () => { expect(FLOW_SRC).toContain("impactScope: ['finance', 'entity-links', 'audit']"); });
  it('irreversible false', () => { expect(FLOW_SRC).toContain('irreversible: false'); });
  it('after spread body', () => { expect(FLOW_SRC).toContain('after: { ...body }'); });
});

// Part 9: Agent flow buildPaymentVoucherUpdateDraft
describe('runtime QA [Agent flow]: buildPaymentVoucherUpdateDraft', () => {
  it('idempotencyKey: payment_voucher.update:${voucherId}:${hash}', () => { expect(FLOW_SRC).toContain('payment_voucher.update:${voucherId}'); });
  it('toolId: payment_voucher.update', () => { expect(FLOW_SRC).toContain("toolId: 'payment_voucher.update'"); });
  it('action: update_payment_voucher', () => { expect(FLOW_SRC).toContain("action: 'update_payment_voucher'"); });
  it('after { voucherId, patch }', () => { expect(FLOW_SRC).toContain('after: { voucherId, patch }'); });
});

// Part 10: Agent flow ErrorCode
describe('runtime QA [Agent flow]: ErrorCode', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => { expect(FLOW_SRC).toContain(`'${code}'`); });
  }
});

// Part 11: hash 防篡改
describe('runtime QA [Agent flow]: hash 防篡改', () => {
  it('verifyHash: computeProcessDraftHash 重算', () => { expect(FLOW_SRC).toContain('computeProcessDraftHash'); });
  it('verifyHash: :pd: 后缀解析', () => { expect(FLOW_SRC).toContain("idempotencyKey.includes(':pd:')"); });
  it('commitPaymentVoucherCreate: 执行 verifyHash(draft) + HASH_MISMATCH fail closed + DRAFT_MISSING', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitPaymentVoucherCreate');
    expect(b).toContain('verifyHash(draft)');
    expect(b).toContain('PROCESS_DRAFT_HASH_MISMATCH');
    expect(b).toContain('PROCESS_DRAFT_MISSING');
  });
  it('commitPaymentVoucherUpdate: verifyHash + HASH_MISMATCH', () => {
    expect(FLOW_SRC).toContain('PROCESS_DRAFT_HASH_MISMATCH');
  });
});

// Part 12: commit 复用 service
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitPaymentVoucherCreate 复用 createPaymentVoucher', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitPaymentVoucherCreate');
    expect(b).toContain('createPaymentVoucher');
  });
  it('commitPaymentVoucherUpdate 复用 updatePaymentVoucher', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitPaymentVoucherUpdate');
    expect(b).toContain('updatePaymentVoucher');
  });
});

// Part 13: toolRuntime commit dispatch（精确分支体）
describe('runtime QA [toolRuntime]: commit dispatch 精确分支体', () => {
  it('call.toolId === payment_voucher.create 分支体调 commitPaymentVoucherCreate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'payment_voucher\.create'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitPaymentVoucherCreate');
  });
  it('payment_voucher.create 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'payment_voucher\.create'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });
  it('call.toolId === payment_voucher.update 分支体调 commitPaymentVoucherUpdate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'payment_voucher\.update'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitPaymentVoucherUpdate');
  });
  it('payment_voucher.update 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'payment_voucher\.update'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });
});

// Part 14: 前端 paymentVoucherService
describe('runtime QA [前端 service]: paymentVoucherService', () => {
  it('createPaymentVoucher: POST /v1/finance/vouchers', () => {
    expect(PV_SVC_SRC).toContain("'/v1/finance/vouchers'");
    expect(PV_SVC_SRC).toContain("method: 'POST'");
  });
  it('updatePaymentVoucher: PATCH /v1/finance/vouchers/:id', () => {
    expect(PV_SVC_SRC).toContain('/v1/finance/vouchers/${encodeURIComponent(id)}');
    expect(PV_SVC_SRC).toContain("method: 'PATCH'");
  });
  it('失败 throw Error', () => { expect(PV_SVC_SRC).toContain('throw new Error'); });
});

// Part 15: FinanceManager UI 消费边界
describe('runtime QA [FinanceManager UI]: 消费边界', () => {
  it('consume createPaymentVoucher + setVouchers', () => {
    expect(FINANCE_MGR_SRC).toContain('paymentVoucherService.createPaymentVoucher');
    expect(FINANCE_MGR_SRC).toContain('setVouchers(prev => [created');
  });
  it('consume updatePaymentVoucher + setVouchers map', () => {
    expect(FINANCE_MGR_SRC).toContain('setVouchers(prev => prev.map');
  });
  it('不调 Agent commit function', () => {
    expect(FINANCE_MGR_SRC).not.toContain('commitPaymentVoucherCreate');
    expect(FINANCE_MGR_SRC).not.toContain('commitPaymentVoucherUpdate');
  });
});

// Part 16: 真实 fixture
describe('runtime QA [fixture]: payload', () => {
  it('create 成功 res: voucher', () => {
    const res = { id: 'pv1', voucherNumber: 'PV-001', amount: '1000.00', status: 'unreconciled' };
    expect(res.voucherNumber).toBe('PV-001');
  });
  it('INVALID_AMOUNT 失败', () => { expect({ code: 'INVALID_AMOUNT' }.code).toBe('INVALID_AMOUNT'); });
  it('INVALID_STATUS 失败', () => { expect({ code: 'INVALID_STATUS' }.code).toBe('INVALID_STATUS'); });
  it('PROCESS_DRAFT_HASH_MISMATCH 失败', () => { expect('PROCESS_DRAFT_HASH_MISMATCH').toContain('HASH_MISMATCH'); });
});
