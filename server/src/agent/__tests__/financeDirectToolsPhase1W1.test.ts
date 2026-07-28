/**
 * Phase 1 W1 验收测试：Finance Agent 直接工具改写为复用 service
 *
 * 验证 4 个改写点：
 *   1. handleFinanceCreateInvoice → 复用 createInvoice service（含审计/校验/Decimal）
 *   2. handleFinanceCreateVoucher → 复用 createPaymentVoucher service
 *   3. handleFinanceApplyVoucherToInvoice → 复用 applyAllocation service（含币种/额度校验）
 *   4. handleFinanceQueryOutstanding → 扣减已核销金额（Decimal-safe）
 *
 * 铁律：直接工具不再绕过 service 层，统一走审计/校验/Decimal，消除双账本漂移。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { executeTool } from '../toolRuntime';

// ── mock service 层 ──
vi.mock('../../finance/invoiceMutationService', () => ({
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  INVOICE_CREATE_FIELDS: ['id', 'invoiceNumber', 'type', 'status', 'amount', 'currency', 'issueDate', 'dueDate', 'exchangeRate', 'baseCurrency', 'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments'],
  INVOICE_PATCH_FIELDS: ['type', 'status', 'amount', 'currency', 'issueDate', 'dueDate', 'exchangeRate', 'baseCurrency', 'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments'],
}));
vi.mock('../../finance/paymentVoucherMutationService', () => ({
  createPaymentVoucher: vi.fn(),
  updatePaymentVoucher: vi.fn(),
  VALID_PAYMENT_VOUCHER_STATUS: ['unreconciled', 'partially_reconciled', 'reconciled'],
  PAYMENT_VOUCHER_CREATE_FIELDS: ['id', 'voucherNumber', 'type', 'amount', 'currency', 'paymentDate', 'paymentMethod', 'status', 'bankFee', 'exchangeRate', 'baseCurrency', 'invoiceId', 'appliedAmount', 'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments'],
  PAYMENT_VOUCHER_PATCH_FIELDS: ['type', 'amount', 'currency', 'paymentDate', 'paymentMethod', 'status', 'bankFee', 'exchangeRate', 'baseCurrency', 'invoiceId', 'appliedAmount', 'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments'],
}));
vi.mock('../../finance/allocationService', () => ({
  applyAllocation: vi.fn(),
  recalcInvoiceStatus: vi.fn(),
  recalcVoucherStatus: vi.fn(),
  validateAllocationInput: vi.fn(),
  syncAllocationVoucherLinks: vi.fn(),
  isValidAllocationDecimal: vi.fn(),
}));

import { createInvoice } from '../../finance/invoiceMutationService';
import { createPaymentVoucher } from '../../finance/paymentVoucherMutationService';
import { applyAllocation } from '../../finance/allocationService';

// ═══════════════════════════════════════════════════════════════════════
// W1-1: handleFinanceCreateInvoice → 复用 createInvoice service
// ═══════════════════════════════════════════════════════════════════════
describe('Phase 1 W1: finance.create_invoice 直接工具复用 service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('service 成功 → 返回 { ok: true, created, auditId }', async () => {
    const invoice = { id: 'INV__1', invoiceNumber: 'INV-1', status: 'Draft', amount: '100.0000' };
    (createInvoice as any).mockResolvedValue({ ok: true, data: { invoice, auditId: 'AL-1' } });

    const prisma = {} as any;
    const result: any = await executeTool(prisma, {
      toolId: 'finance.create_invoice',
      input: { invoiceNumber: 'INV-1', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-21' },
    } as any);

    expect(result.ok).toBe(true);
    expect(result.created).toEqual(invoice);
    expect(result.auditId).toBe('AL-1');
    expect(createInvoice).toHaveBeenCalledTimes(1);
    const callArgs = (createInvoice as any).mock.calls[0][0];
    expect(callArgs.actorId).toBe('agent');
    expect(callArgs.ip).toBeNull();
    // id 自动生成（input 无 id 时）
    expect(callArgs.input.id).toMatch(/^INV__/);
    expect(callArgs.input.invoiceNumber).toBe('INV-1');
  });

  it('input 已有 id → 透传给 service', async () => {
    (createInvoice as any).mockResolvedValue({ ok: true, data: { invoice: { id: 'INV__CUSTOM' }, auditId: 'AL-2' } });

    await executeTool({} as any, {
      toolId: 'finance.create_invoice',
      input: { id: 'INV__CUSTOM', invoiceNumber: 'INV-2', type: 'Receivable', amount: '200', currency: 'USD', issueDate: '2026-07-21' },
    } as any);

    const callArgs = (createInvoice as any).mock.calls[0][0];
    expect(callArgs.input.id).toBe('INV__CUSTOM');
  });

  it('service 失败 → 返回 { ok: false, error, message }', async () => {
    (createInvoice as any).mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_STATUS', message: 'status must be a non-null string' },
    });

    const result: any = await executeTool({} as any, {
      toolId: 'finance.create_invoice',
      input: { invoiceNumber: 'INV-3', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-21', status: 'Bogus' },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('INVALID_STATUS');
    expect(result.message).toContain('status must be a non-null string');
  });

  it('service 抛错 → 返回 CREATE_FAILED', async () => {
    (createInvoice as any).mockResolvedValue({ ok: false, error: { code: 'CREATE_FAILED', message: 'tx rollback' } });

    const result: any = await executeTool({} as any, {
      toolId: 'finance.create_invoice',
      input: { invoiceNumber: 'INV-4', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-21' },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('CREATE_FAILED');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// W1-1: handleFinanceCreateVoucher → 复用 createPaymentVoucher service
// ═══════════════════════════════════════════════════════════════════════
describe('Phase 1 W1: finance.create_voucher 直接工具复用 service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('service 成功 → 返回 { ok: true, created, auditId }', async () => {
    const voucher = { id: 'PAY__1', voucherNumber: 'PAY-1', amount: '500.0000', status: 'unreconciled' };
    (createPaymentVoucher as any).mockResolvedValue({ ok: true, data: { voucher, auditId: 'AL-3' } });

    const result: any = await executeTool({} as any, {
      toolId: 'finance.create_voucher',
      input: { voucherNumber: 'PAY-1', type: 'Receipt', amount: '500', currency: 'USD', paymentDate: '2026-07-21', paymentMethod: 'TT' },
    } as any);

    expect(result.ok).toBe(true);
    expect(result.created).toEqual(voucher);
    expect(result.auditId).toBe('AL-3');
    expect(createPaymentVoucher).toHaveBeenCalledTimes(1);
    const callArgs = (createPaymentVoucher as any).mock.calls[0][0];
    expect(callArgs.actorId).toBe('agent');
    expect(callArgs.input.id).toMatch(/^PAY__/);
  });

  it('service 失败 → 返回 { ok: false, error, message }', async () => {
    (createPaymentVoucher as any).mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_AMOUNT', message: 'amount must be a valid decimal' },
    });

    const result: any = await executeTool({} as any, {
      toolId: 'finance.create_voucher',
      input: { voucherNumber: 'PAY-2', type: 'Receipt', amount: 'abc', currency: 'USD', paymentDate: '2026-07-21', paymentMethod: 'TT' },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('INVALID_AMOUNT');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// W1-1: handleFinanceApplyVoucherToInvoice → 复用 applyAllocation service
// ═══════════════════════════════════════════════════════════════════════
describe('Phase 1 W1: finance.apply_voucher_to_invoice 直接工具复用 service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('service 成功 → 返回含 newInvoiceStatus/newVoucherStatus/auditId', async () => {
    (applyAllocation as any).mockResolvedValue({
      allocationId: 'ALLOC__INV__1__PAY__1',
      newInvoiceStatus: 'PartiallyPaid',
      newVoucherStatus: 'partially_reconciled',
      voucherAppliedAmount: new Prisma.Decimal('300'),
      auditId: 'AL-4',
    });

    // mock $transaction：直接执行回调
    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn({})),
    } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.apply_voucher_to_invoice',
      input: { voucherId: 'PAY__1', invoiceId: 'INV__1', appliedAmount: '300' },
    } as any);

    expect(result.ok).toBe(true);
    expect(result.voucherId).toBe('PAY__1');
    expect(result.invoiceId).toBe('INV__1');
    expect(result.appliedAmount).toBe(300);
    expect(result.newInvoiceStatus).toBe('PartiallyPaid');
    expect(result.newVoucherStatus).toBe('partially_reconciled');
    expect(result.totalApplied).toBe(300);
    expect(result.auditId).toBe('AL-4');
    expect(applyAllocation).toHaveBeenCalledTimes(1);
    const callArgs = (applyAllocation as any).mock.calls[0][2];
    expect(callArgs.actorId).toBe('agent');
    expect(callArgs.source).toBe('agent:apply_voucher_to_invoice');
    expect(callArgs.auditOperation).toBe('create_allocation');
  });

  it('缺少参数 → 返回错误，service 不调用', async () => {
    const result: any = await executeTool({} as any, {
      toolId: 'finance.apply_voucher_to_invoice',
      input: { voucherId: 'PAY__1' },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('voucherId, invoiceId, and appliedAmount are required');
    expect(applyAllocation).not.toHaveBeenCalled();
  });

  it('service 抛 CURRENCY_MISMATCH → 返回错误码', async () => {
    (applyAllocation as any).mockRejectedValue(Object.assign(new Error('currency mismatch'), { code: 'CURRENCY_MISMATCH' }));
    const prisma = { $transaction: vi.fn(async (fn: any) => fn({})) } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.apply_voucher_to_invoice',
      input: { voucherId: 'PAY__1', invoiceId: 'INV__1', appliedAmount: '100' },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('CURRENCY_MISMATCH');
    expect(result.message).toContain('currency mismatch');
  });

  it('service 抛 AMOUNT_EXCEEDS_INVOICE_REMAINING → 返回错误码', async () => {
    (applyAllocation as any).mockRejectedValue(Object.assign(new Error('exceeds invoice remaining'), { code: 'AMOUNT_EXCEEDS_INVOICE_REMAINING' }));
    const prisma = { $transaction: vi.fn(async (fn: any) => fn({})) } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.apply_voucher_to_invoice',
      input: { voucherId: 'PAY__1', invoiceId: 'INV__1', appliedAmount: '9999' },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('AMOUNT_EXCEEDS_INVOICE_REMAINING');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// W1-2: handleFinanceQueryOutstanding → 扣减已核销金额
// ═══════════════════════════════════════════════════════════════════════
describe('Phase 1 W1: finance.query_outstanding 扣减已核销金额', () => {
  it('outstanding = invoice.amount - Σ allocation.appliedAmount', async () => {
    const invoices = [
      { id: 'INV__1', amount: new Prisma.Decimal('1000'), currency: 'USD', status: 'Issued', dueDate: '2026-08-01', customerRelationId: 'R1', orderId: 'O1' },
      { id: 'INV__2', amount: new Prisma.Decimal('500'), currency: 'USD', status: 'PartiallyPaid', dueDate: '2026-08-15', customerRelationId: 'R1', orderId: 'O2' },
    ];
    const allocations = [
      { invoiceId: 'INV__1', appliedAmount: new Prisma.Decimal('300') },
      { invoiceId: 'INV__2', appliedAmount: new Prisma.Decimal('500') }, // 全额核销
    ];
    const prisma = {
      invoice: { findMany: vi.fn().mockResolvedValue(invoices) },
      invoiceAllocation: { findMany: vi.fn().mockResolvedValue(allocations) },
    } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.query_outstanding',
      input: { type: 'Receivable', scope: { customerRelationId: 'R1' } },
    } as any);

    expect(result.ok).toBe(true);
    expect(result.invoiceCount).toBe(2);
    // totalOutstanding = (1000 - 300) + (500 - 500) = 700
    expect(result.totalOutstanding).toBe('700');
    // INV__1: outstanding = 700
    const inv1 = result.invoices.find((i: any) => i.id === 'INV__1');
    expect(inv1.amount).toBe('1000');
    expect(inv1.allocatedAmount).toBe('300');
    expect(inv1.outstandingAmount).toBe('700');
    // INV__2: outstanding = 0
    const inv2 = result.invoices.find((i: any) => i.id === 'INV__2');
    expect(inv2.outstandingAmount).toBe('0');
    expect(result.earliestDueDate).toBe('2026-08-01');
  });

  it('无 allocation → outstanding = invoice.amount', async () => {
    const invoices = [
      { id: 'INV__3', amount: new Prisma.Decimal('200'), currency: 'USD', status: 'Issued', dueDate: null, customerRelationId: null, orderId: null },
    ];
    const prisma = {
      invoice: { findMany: vi.fn().mockResolvedValue(invoices) },
      invoiceAllocation: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.query_outstanding',
      input: {},
    } as any);

    expect(result.totalOutstanding).toBe('200');
    expect(result.invoices[0].outstandingAmount).toBe('200');
    expect(result.invoices[0].allocatedAmount).toBe('0');
  });

  it('无 invoice → 空结果，不查 allocation', async () => {
    const prisma = {
      invoice: { findMany: vi.fn().mockResolvedValue([]) },
      invoiceAllocation: { findMany: vi.fn() },
    } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.query_outstanding',
      input: {},
    } as any);

    expect(result.ok).toBe(true);
    expect(result.invoiceCount).toBe(0);
    expect(result.totalOutstanding).toBe('0');
    expect(prisma.invoiceAllocation.findMany).not.toHaveBeenCalled();
  });

  it('Decimal-safe 累加（避免 IEEE 754 漂移）', async () => {
    // 模拟 0.1 + 0.2 的 IEEE 754 问题
    const invoices = [
      { id: 'INV__A', amount: new Prisma.Decimal('0.3'), currency: 'USD', status: 'Issued', dueDate: null, customerRelationId: null, orderId: null },
    ];
    const allocations = [
      { invoiceId: 'INV__A', appliedAmount: new Prisma.Decimal('0.1') },
      { invoiceId: 'INV__A', appliedAmount: new Prisma.Decimal('0.2') },
    ];
    const prisma = {
      invoice: { findMany: vi.fn().mockResolvedValue(invoices) },
      invoiceAllocation: { findMany: vi.fn().mockResolvedValue(allocations) },
    } as any;

    const result: any = await executeTool(prisma, {
      toolId: 'finance.query_outstanding',
      input: {},
    } as any);

    // Decimal-safe：0.3 - 0.1 - 0.2 = 0.0（非 IEEE 754 的 0.00000000000000004）
    expect(result.totalOutstanding).toBe('0');
    expect(result.invoices[0].outstandingAmount).toBe('0');
  });
});
