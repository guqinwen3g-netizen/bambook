import type { OrderLineItem, OrderLineLite, OrderToleranceStatus } from '../types';
import { apiService } from './apiService';

export async function createOrderLine(
  line: Partial<OrderLineLite> & { poNumber: string; customer?: string; salesCurrency?: string; purchaseCurrency?: string },
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; line: OrderLineItem }> {
  const headers = apiService.getAuthHeaders();
  if (opts.apiKey) headers['X-Bambook-API-Key'] = opts.apiKey;

  const res = await fetch(apiService.buildApiUrl('/v1/order-lines'), {
    method: 'POST',
    body: JSON.stringify(line),
    headers,
    signal: opts.signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.message ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(`Create line failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

export async function updateOrderLineFields(
  id: string,
  patch: Partial<OrderLineLite>,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; line: OrderLineItem }> {
  if (!id) throw new Error('updateOrderLineFields: id required');
  const headers = apiService.getAuthHeaders();
  if (opts.apiKey) headers['X-Bambook-API-Key'] = opts.apiKey;

  const res = await fetch(apiService.buildApiUrl(`/v1/order-lines/${encodeURIComponent(id)}`), {
    method: 'PUT',
    body: JSON.stringify(patch),
    headers,
    signal: opts.signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.message ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(`Update line failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

/**
 * REQ2-03 溢短装状态：全部行已发量 vs 合同量（±N% 条款校验，只读）。
 * GET /v1/orders/:id/tolerance-status
 */
export async function fetchOrderToleranceStatus(
  orderId: string,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<OrderToleranceStatus> {
  if (!orderId) throw new Error('fetchOrderToleranceStatus: orderId required');
  const headers = apiService.getAuthHeaders();
  if (opts.apiKey) headers['X-Bambook-API-Key'] = opts.apiKey;

  const res = await fetch(apiService.buildApiUrl(`/v1/orders/${encodeURIComponent(orderId)}/tolerance-status`), {
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(`Fetch tolerance status failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  return data as OrderToleranceStatus;
}
