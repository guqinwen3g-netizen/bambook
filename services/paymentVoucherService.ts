/**
 * PaymentVoucher API service.
 * Communicates with /api/v1/finance/vouchers endpoints.
 */
import { apiService } from './apiService';
import type { PaymentVoucher, VoucherStatus, VoucherType } from '../types';

type PaymentVoucherListParams = {
  type?: VoucherType;
  status?: VoucherStatus;
  invoiceId?: string;
  orderId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export const paymentVoucherService = {
  async listPaymentVouchers(endpoint?: string, params?: PaymentVoucherListParams): Promise<PaymentVoucher[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/finance/vouchers', base);
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.invoiceId) query.set('invoiceId', params.invoiceId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const apiKey = apiService.getApiKey();

    const res = await fetch(fullUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`listPaymentVouchers failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  async getPaymentVoucher(id: string, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`getPaymentVoucher failed: HTTP ${res.status}`);
    const data = await res.json();
    return data;
  },

  async createPaymentVoucher(input: Partial<PaymentVoucher>, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/finance/vouchers', base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `createPaymentVoucher failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  },

  async updatePaymentVoucher(id: string, input: Partial<PaymentVoucher>, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `updatePaymentVoucher failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  },

  // task_mqyusoio: 消费后端 DELETE /vouchers/:id（task_mqyurxot deleteVoucher service）
  /** 软删付款凭证（调后端 deleteVoucher service，HAS_ALLOCATIONS/NOT_FOUND 阻断） */
  async deletePaymentVoucher(id: string, endpoint?: string): Promise<{ ok: boolean }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error?.code || `deletePaymentVoucher failed: HTTP ${res.status}`);
    return { ok: true };
  },

  /** 作废付款凭证（调后端 cancelVoucher service，HAS_ALLOCATIONS 阻断） */
  async cancelVoucher(id: string, reason?: string, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}/cancel`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ reason }),
    });
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`cancelVoucher failed: HTTP ${res.status} (non-JSON response)`); }
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message || data?.error?.code || `cancelVoucher failed: HTTP ${res.status}`);
    return data.voucher;
  },
};
