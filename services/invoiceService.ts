/**
 * Invoice API service.
 * Communicates with /api/v1/finance endpoints (invoices).
 */
import { apiService } from './apiService';
import type { Invoice, InvoiceAttachment, InvoiceOrderAllocation, InvoiceStatus, InvoiceType, InvoiceWriteInput } from '../types';

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

  // DR：详情——GET /v1/finance/:id，返回附带 orderAllocations[]（发票↔订单多对多）
  async getInvoice(id: string, endpoint?: string): Promise<Invoice & { orderAllocations?: InvoiceOrderAllocation[] }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, { headers: apiService.getAuthHeaders() });
    if (!res.ok) throw new Error(`getInvoice failed: HTTP ${res.status}`);
    const data = await res.json();
    return data as Invoice & { orderAllocations?: InvoiceOrderAllocation[] };
  },

  /** POST /v1/finance —— 创建发票（支持 orderIds[] 多订单分配） */
  async createInvoice(input: Partial<Invoice> & InvoiceWriteInput, endpoint?: string): Promise<Invoice> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/finance', base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMessage = typeof err.error === 'object'
        ? JSON.stringify(err.error)
        : (err.error || `createInvoice failed: HTTP ${res.status}`);
      throw new Error(errorMessage);
    }
    const data = await res.json();
    return data;
  },

  /** PATCH /v1/finance/:id —— 更新发票（orderIds[] 时后端按 replace 语义重写分配） */
  async updateInvoice(id: string, input: Partial<Invoice> & InvoiceWriteInput, endpoint?: string): Promise<Invoice> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/finance/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMessage = typeof err.error === 'object'
        ? JSON.stringify(err.error)
        : (err.error || `updateInvoice failed: HTTP ${res.status}`);
      throw new Error(errorMessage);
    }
    const data = await res.json();
    return data;
  },

  /** 导出发票 PDF（下载到本地） */
  async renderInvoicePdf(id: string, endpoint?: string): Promise<void> {
    return apiService.renderInvoicePdf(id, endpoint);
  },

  /** 发票预览 HTML（与导出 PDF 同源渲染 + screen 页边距，所见即所得） */
  async getInvoicePreviewHtml(id: string, endpoint?: string): Promise<string> {
    return apiService.getInvoicePreviewHtml(id, endpoint);
  },

  /** 上传发票真实文件（multipart），返回登记后的附件结构 */
  async uploadInvoiceAttachment(id: string, file: File, endpoint?: string): Promise<InvoiceAttachment> {
    return apiService.uploadInvoiceAttachment(id, file, endpoint);
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
