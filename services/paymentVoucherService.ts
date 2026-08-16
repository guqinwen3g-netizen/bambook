/**
 * PaymentVoucher API service.
 * Communicates with /api/v1/finance/vouchers endpoints.
 */
import { apiService } from './apiService';
import type { PaymentVoucher, VoucherStatus, VoucherType } from '../types';

/**
 * P0-9 / DR-022 凭证分类枚举真源（镜像后端 VALID_VOUCHER_CATEGORIES，
 * server/src/finance/paymentVoucherMutationService.ts fail-closed 校验）。
 * root types.ts 为冻结区（禁止编辑），VoucherCategory 内聚在本文件。
 */
export const VOUCHER_CATEGORIES = [
  'normal',
  'advance',
  'deposit',
  'sample_express',
  'customer_reimburse',
  'business_cost',
] as const;
export type VoucherCategory = (typeof VOUCHER_CATEGORIES)[number];

/** 凭证分类中文文案（设计真源：Prisma缺口清单与迁移方案.md P0-9 / 财务域模型组.md §2.2） */
export const VOUCHER_CATEGORY_LABELS: Record<VoucherCategory, string> = {
  normal: '常规',
  advance: '预收/预付',
  deposit: '保证金',
  sample_express: '样品快递费',
  customer_reimburse: '客户报销',
  business_cost: '业务成本',
};

export const voucherCategoryLabel = (category?: string | null): string =>
  category && (VOUCHER_CATEGORIES as readonly string[]).includes(category)
    ? VOUCHER_CATEGORY_LABELS[category as VoucherCategory]
    : (category || '—');

/** 列表/详情运行时行可能携带 voucherCategory（types.ts PaymentVoucher 冻结未含此列） */
export type PaymentVoucherWithCategory = PaymentVoucher & { voucherCategory?: VoucherCategory };

/** 创建/编辑输入允许携带 voucherCategory（后端 schema default('normal') 兜底） */
export type PaymentVoucherMutationInput = Partial<PaymentVoucher> & { voucherCategory?: VoucherCategory };

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

    const res = await fetch(fullUrl, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`listPaymentVouchers failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  async getPaymentVoucher(id: string, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}`, base);

    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`getPaymentVoucher failed: HTTP ${res.status}`);
    const data = await res.json();
    return data;
  },

  async createPaymentVoucher(input: PaymentVoucherMutationInput, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/finance/vouchers', base);

    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMessage = typeof err.error === 'object'
        ? JSON.stringify(err.error)
        : (err.error || `createPaymentVoucher failed: HTTP ${res.status}`);
      throw new Error(errorMessage);
    }
    const data = await res.json();
    return data;
  },

  async updatePaymentVoucher(id: string, input: PaymentVoucherMutationInput, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}`, base);

    const res = await fetch(url, {
      method: 'PATCH',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMessage = typeof err.error === 'object'
        ? JSON.stringify(err.error)
        : (err.error || `updatePaymentVoucher failed: HTTP ${res.status}`);
      throw new Error(errorMessage);
    }
    const data = await res.json();
    return data;
  },

  // task_mqyusoio: 消费后端 DELETE /vouchers/:id（task_mqyurxot deleteVoucher service）
  /** 软删付款凭证（调后端 deleteVoucher service，HAS_ALLOCATIONS/NOT_FOUND 阻断） */
  async deletePaymentVoucher(id: string, endpoint?: string): Promise<{ ok: boolean }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: apiService.getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error?.code || `deletePaymentVoucher failed: HTTP ${res.status}`);
    return { ok: true };
  },

  /** 作废付款凭证（调后端 cancelVoucher service，HAS_ALLOCATIONS 阻断） */
  async cancelVoucher(id: string, reason?: string, endpoint?: string): Promise<PaymentVoucher> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/vouchers/${encodeURIComponent(id)}/cancel`, base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`cancelVoucher failed: HTTP ${res.status} (non-JSON response)`); }
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message || data?.error?.code || `cancelVoucher failed: HTTP ${res.status}`);
    return data.voucher;
  },
};
