import { describe, expect, it } from 'vitest';
import type { Order } from '../types';
import { displayItemNo, getNextItemNo, flattenOrderLines } from './orderLineItems';

describe('order line item numbering', () => {
  it('displays imported five-digit SAP item numbers as four-digit business numbers', () => {
    expect(displayItemNo('00010')).toBe('0010');
    expect(displayItemNo('00020')).toBe('0020');
    expect(displayItemNo('0011')).toBe('0011');
    expect(displayItemNo('ABC')).toBe('ABC');
  });

  it('generates ten-step default item numbers and ignores revision variants', () => {
    expect(getNextItemNo([])).toBe('0010');
    expect(getNextItemNo(['0010'])).toBe('0020');
    expect(getNextItemNo(['0010', '0011'])).toBe('0020');
    expect(getNextItemNo(['00010', '00020'])).toBe('0030');
  });

  it('skips blank item numbers when generating the next number', () => {
    expect(getNextItemNo([null])).toBe('0010');
    expect(getNextItemNo([null, null])).toBe('0010');
    expect(getNextItemNo(['', undefined, '0010'])).toBe('0020');
  });

  it('skips nonnumeric item numbers when generating the next number', () => {
    expect(getNextItemNo(['ABC'])).toBe('0010');
    expect(getNextItemNo(['ABC', '0010'])).toBe('0020');
  });
});

describe('flattenOrderLines', () => {
  it('creates one line-first item per order line', () => {
    const order: Order = {
      id: 'PO-4500159423',
      customer: 'Peerless',
      product: 'Imported PO',
      type: 'Fabric',
      quantity: 300,
      status: 'Pending',
      dueDate: '2026/07/01',
      quoteAmount: 900,
      poNumber: '4500159423',
      poDate: '2026/03/31',
      salesCurrency: 'USD',
      lines: [
        {
          id: 'L1',
          lineNumber: 1,
          itemNo: '00010',
          materialCode: '144749',
          millQuality: 'RD7302',
          description: 'CHARCOAL SOLID',
          width: '147 CM',
          exMillDate: '2026/07/01',
          deliveryDate: '2026/08/15',
          quantity: 300,
          unit: 'Meter',
          unitPrice: 3,
          netValue: 900,
          cloth: '70% Wool',
          weight: '186GSM',
          status: 'Production',
        },
      ],
    };

    expect(flattenOrderLines([order])).toEqual([
      expect.objectContaining({
        id: 'L1',
        orderId: 'PO-4500159423',
        poNumber: '4500159423',
        displayItemNo: '0010',
        displayId: 'PO 4500159423 / 0010',
        status: 'Production',
        customer: 'Peerless',
        amount: 900,
      }),
    ]);
  });
});
