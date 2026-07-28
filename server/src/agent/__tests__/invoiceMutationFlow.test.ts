import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildInvoiceCreateDraft, commitInvoiceCreate, buildInvoiceUpdateDraft, commitInvoiceUpdate } from '../invoiceMutationFlow';
vi.mock('../../finance/invoiceMutationService', () => ({ createInvoice: vi.fn(), updateInvoice: vi.fn(), INVOICE_CREATE_FIELDS: ['invoiceNumber','type','status','amount','currency','issueDate','dueDate','exchangeRate','baseCurrency','orderId','customerRelationId','customerName','notes','attachments'], INVOICE_PATCH_FIELDS: ['type','status','amount','currency','issueDate','dueDate','exchangeRate','baseCurrency','orderId','customerRelationId','customerName','notes','attachments'] }));
import { createInvoice, updateInvoice } from '../../finance/invoiceMutationService';
const input = { invoiceNumber: 'INV-1', type: 'Receivable', amount: '100.0000', currency: 'USD', issueDate: '2026-07-02' };
describe('invoiceMutationFlow', () => {
  beforeEach(() => vi.clearAllMocks());
  it('create draft + commit 复用 createInvoice', async () => {
    const draft = buildInvoiceCreateDraft({ input });
    expect(draft.subOperations[0].toolId).toBe('invoice.create');
    expect(draft.beforeAfterDiff.length).toBeGreaterThan(0);
    (createInvoice as any).mockResolvedValue({ ok: true, data: { invoice: { id: 'INV__1' }, auditId: 'AL-1' } });
    const r = await commitInvoiceCreate({ prisma: {} as any, approvalId: 'AP-1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(true);
    expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({ input, actorId: 'agent' }));
  });
  it('create hash mismatch 不调用 service', async () => {
    const draft = buildInvoiceCreateDraft({ input });
    const tampered = { ...draft, subOperations: [{ ...draft.subOperations[0], after: { ...input, amount: '999' } }] };
    const r = await commitInvoiceCreate({ prisma: {} as any, approvalId: 'AP-1', approvalPayload: { processDraft: tampered } });
    expect(r.ok).toBe(false);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it('update draft + commit 复用 updateInvoice', async () => {
    const draft = buildInvoiceUpdateDraft({ invoiceId: 'INV__1', patch: { amount: '120.0000' }, currentSnapshot: { amount: '100.0000' } });
    (updateInvoice as any).mockResolvedValue({ ok: true, data: { invoice: { id: 'INV__1' }, auditId: 'AL-2' } });
    const r = await commitInvoiceUpdate({ prisma: {} as any, approvalId: 'AP-1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(true);
    expect(updateInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'INV__1', input: { amount: '120.0000' }, actorId: 'agent' }));
  });
  it('update hash mismatch 不调用 service', async () => {
    const draft = buildInvoiceUpdateDraft({ invoiceId: 'INV__1', patch: { amount: '120.0000' }, currentSnapshot: { amount: '100.0000' } });
    const tampered = { ...draft, subOperations: [{ ...draft.subOperations[0], after: { invoiceId: 'INV__1', patch: { amount: '999' } } }] };
    const r = await commitInvoiceUpdate({ prisma: {} as any, approvalId: 'AP-1', approvalPayload: { processDraft: tampered } });
    expect(r.ok).toBe(false);
    expect(updateInvoice).not.toHaveBeenCalled();
  });
});
