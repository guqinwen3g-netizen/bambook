/**
 * Invoice API service.
 * Communicates with /api/v1/finance endpoints (invoices).
 */
import { apiService } from './apiService';
import type { Invoice, InvoiceStatus, InvoiceType } from '../types';

type InvoiceListParams = {
  type?: InvoiceType;
  status?: InvoiceStatus;
  customer?: string;
  orderId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export const invoiceService = {
  async listInvoices(endpoint?: string, params?: InvoiceListParams): Promise<Invoice[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/finance', base);
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.customer) query.set('customer', params.customer);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;

    const res = await fetch(fullUrl, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`listInvoices failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  async getInvoice(id: string, endpoint?: string): Promise<Invoice> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/${encodeURIComponent(id)}`, base);

    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`getInvoice failed: HTTP ${res.status}`);
    const data = await res.json();
    return data;
  },

  async createInvoice(input: Partial<Invoice>, endpoint?: string): Promise<Invoice> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/finance', base);

    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `createInvoice failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  },

  async updateInvoice(id: string, input: Partial<Invoice>, endpoint?: string): Promise<Invoice> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/${encodeURIComponent(id)}`, base);

    const res = await fetch(url, {
      method: 'PATCH',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `updateInvoice failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  },

  // task_mqyusoio: 消费后端 POST /:id/cancel + DELETE /:id（task_mqyurxot voidDeleteService）
  /** 作废发票（调后端 cancelInvoice service，返回更新后 invoice） */
  async cancelInvoice(id: string, reason?: string, endpoint?: string): Promise<any> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/${encodeURIComponent(id)}/cancel`, base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error?.code || `cancelInvoice failed: HTTP ${res.status}`);
    return data.invoice;
  },

  /** 软删发票（调后端 deleteInvoice service，HAS_ALLOCATIONS/NOT_FOUND 阻断） */
  async deleteInvoice(id: string, endpoint?: string): Promise<{ ok: boolean }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: apiService.getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error?.code || `deleteInvoice failed: HTTP ${res.status}`);
    return { ok: true };
  },
};
