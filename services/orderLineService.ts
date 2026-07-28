import type { OrderLineItem, OrderLineLite } from '../types';
import { apiService } from './apiService';

export async function createOrderLine(
  line: Partial<OrderLineLite> & { poNumber: string; customer?: string; salesCurrency?: string; purchaseCurrency?: string },
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; line: OrderLineItem }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

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
