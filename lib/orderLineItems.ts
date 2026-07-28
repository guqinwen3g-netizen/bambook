import type { Order, OrderLineItem, OrderLineLite, OrderLineStatus } from '../types';

const DEFAULT_STATUS: OrderLineStatus = 'Pending';

export function displayItemNo(itemNo: string | null | undefined): string {
  const raw = String(itemNo ?? '').trim();
  if (/^\d{5}$/.test(raw) && raw.startsWith('0')) return raw.slice(1);
  if (/^\d{1,4}$/.test(raw)) return raw.padStart(4, '0');
  return raw || '0010';
}

export function getNextItemNo(existing: Array<string | null | undefined>): string {
  const mainNumbers = existing
    .map(normalizeSequencedItemNo)
    .filter((v): v is string => v != null)
    .filter((v) => /^\d{4}$/.test(v))
    .map((v) => Math.floor(Number(v) / 10) * 10);
  const next = mainNumbers.length === 0 ? 10 : Math.max(...mainNumbers) + 10;
  return String(next).padStart(4, '0');
}

function normalizeSequencedItemNo(itemNo: string | null | undefined): string | null {
  const raw = String(itemNo ?? '').trim();
  if (!raw) return null;
  return displayItemNo(raw);
}

export function flattenOrderLines(orders: Order[]): OrderLineItem[] {
  const items: OrderLineItem[] = [];
  for (const order of orders) {
    if (order.deletedAt) continue;
    const lines = order.lines && order.lines.length > 0
      ? [...order.lines].sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0))
      : [fallbackLine(order)];

    for (const line of lines) {
      const poNumber = order.poNumber || order.id;
      const lineSeq = Number.isFinite(line.lineNumber) && line.lineNumber > 0 ? line.lineNumber : 1;
      const displayNo = displayItemNo(line.itemNo || String(lineSeq * 10));
      const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
      const amount =
        line.netValue ??
        (Number.isFinite(line.unitPrice as number)
          ? (line.unitPrice as number) * quantity
          : order.quoteAmount);
      const status = line.status || order.status || DEFAULT_STATUS;
      items.push({
        ...line,
        order,
        orderId: line.orderId || order.id,
        poNumber,
        customer: order.customer,
        poDate: order.poDate,
        salesCurrency: order.salesCurrency,
        displayItemNo: displayNo,
        displayId: `PO ${poNumber} / ${displayNo}`,
        amount: amount ?? 0,
        status,
      });
    }
  }
  return items;
}

function fallbackLine(order: Order): OrderLineLite {
  return {
    id: `${order.id}__L001`,
    orderId: order.id,
    lineNumber: 1,
    itemNo: '0010',
    materialCode: order.clientCode ?? null,
    millQuality: order.productColorCode ?? null,
    description: order.product || order.fabricContent || null,
    width: order.width ?? null,
    exMillDate: order.clientDate || order.dueDate || null,
    deliveryDate: order.productionDate ?? null,
    quantity: order.quantity ?? 0,
    unit: 'Meter',
    unitPrice: order.salesPrice ?? null,
    netValue: order.contractAmount ?? order.quoteAmount ?? null,
    cloth: order.fabricContent ?? null,
    weight: order.gsm ?? null,
    status: order.status,
  };
}
