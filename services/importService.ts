import { ImportResponse, Order, ParsedOrder, PersistImportResponse } from '../types';
import { apiService } from './apiService';

/**
 * Upload one or more PDF files to the Bambook server for parse-only.
 *
 * Endpoint: POST /api/v1/import/order  (vite dev proxy → http://127.0.0.1:8081)
 * Field name: "files" (repeatable)
 *
 * Optional API key: pass `apiKey` to send X-Bambook-API-Key.
 *   - In open mode (BAMBOOK_REQUIRE_AUTH != 'true' on server) you can omit it.
 */
export async function uploadPdfsForParsing(
  files: File[],
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<ImportResponse> {
  if (files.length === 0) {
    throw new Error('No files selected');
  }
  const fd = new FormData();
  for (const f of files) fd.append('files', f);

  const headers: Record<string, string> = {};
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

  const res = await fetch(apiService.buildApiUrl('/v1/import/order'), {
    method: 'POST',
    body: fd,
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
    throw new Error(`Import failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json() as Promise<ImportResponse>;
}

/**
 * Persist a batch of (already-parsed and possibly user-edited) orders into the
 * Order table. Idempotent by `poNumber`: re-saving the same PO updates that row.
 *
 * Endpoint: POST /api/v1/orders/import (vite dev proxy → http://127.0.0.1:8081)
 */
export async function saveParsedOrders(
  orders: ParsedOrder[],
  opts: { apiKey?: string; signal?: AbortSignal; overwriteExisting?: boolean } = {},
): Promise<PersistImportResponse> {
  if (orders.length === 0) {
    throw new Error('No orders to save');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

  const res = await fetch(apiService.buildApiUrl('/v1/orders/import'), {
    method: 'POST',
    body: JSON.stringify({ orders, overwriteExisting: opts.overwriteExisting ?? true }),
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
    throw new Error(`Save failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json() as Promise<PersistImportResponse>;
}

/**
 * Create a manual (non-PDF) order on the server. Every supplied field is
 * tagged `'manual'` in `fieldSources`, so a future PDF import for the same
 * `poNumber` will not overwrite anything the user typed.
 *
 * Endpoint: POST /api/v1/orders
 */
export async function createManualOrder(
  order: Partial<Order>,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; order: Order }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

  const res = await fetch(apiService.buildApiUrl('/v1/orders'), {
    method: 'POST',
    body: JSON.stringify(order),
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
    throw new Error(`Create failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

/**
 * Patch an existing order from the detail-card edit flow. Each supplied
 * scalar field gets tagged `'manual'` (or `'imported-then-edited'` if it was
 * previously `'pdf'`) on the server so PDF re-imports respect the change.
 *
 * Endpoint: PUT /api/v1/orders/:id
 */
export async function updateOrderFields(
  id: string,
  patch: Partial<Order>,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; order: Order }> {
  if (!id) throw new Error('updateOrderFields: id required');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

  const res = await fetch(apiService.buildApiUrl(`/v1/orders/${encodeURIComponent(id)}`), {
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
    throw new Error(`Update failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

export async function deleteOrder(
  id: string,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; order: Order }> {
  if (!id) throw new Error('deleteOrder: id required');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

  const res = await fetch(apiService.buildApiUrl(`/v1/orders/${encodeURIComponent(id)}`), {
    method: 'DELETE',
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
    throw new Error(`Delete failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}
