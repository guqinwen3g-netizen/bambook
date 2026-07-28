import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrderLine, updateOrderLineFields } from './orderLineService';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, line: { id: 'L1', itemNo: '0010' } }),
  })));
});

describe('orderLineService', () => {
  it('creates one fabric item', async () => {
    await createOrderLine({ poNumber: 'PO-1', itemNo: '0010', quantity: 1 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/order-lines'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"poNumber":"PO-1"'),
      }),
    );
  });

  it('updates one fabric item', async () => {
    await updateOrderLineFields('L1', { status: 'Shipping' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/order-lines/L1'),
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"status":"Shipping"'),
      }),
    );
  });
});
