/**
 * PaymentRequest API service — DR-017 付款申请（先申请后付款唯一入口）。
 * Communicates with /api/v1/payment-requests endpoints:
 *   POST /              — 创建（scope finance:payment_request:create；创建即 Pending + 生成审批单）
 *   GET  /              — 列表（status / paymentCategory / applicantId 过滤）
 *   GET  /:id           — 详情（附 approvalRequest / paymentVoucher 关联快照）
 *   POST /:id/cancel    — 申请人作废（仅 Draft/Pending，仅本人）
 *
 * 类型定义内聚在本文件（root types.ts 为冻结区，禁止编辑）。
 * 审批决策走审批域既有端点（approvalKernelService.decideApproval → POST /v1/approvals/:id/decide），
 * 本服务不重复封装。
 */
import { apiService } from './apiService';
import { VOUCHER_CATEGORIES, type VoucherCategory } from './paymentVoucherService';

// ── 状态机（镜像后端 PAYMENT_REQUEST_STATUSES） ──
export const PAYMENT_REQUEST_STATUSES = [
  'Draft',
  'Pending',
  'Approved',
  'Rejected',
  'VoucherIssued',
  'Cancelled',
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_REQUEST_STATUS_LABELS: Record<PaymentRequestStatus, string> = {
  Draft: '草稿',
  Pending: '审批中',
  Approved: '已批准',
  Rejected: '已驳回',
  VoucherIssued: '已生成凭证',
  Cancelled: '已作废',
};

/** 付款性质 = PaymentVoucher.voucherCategory 同一枚举真源（镜像后端 VALID_PAYMENT_CATEGORIES） */
export const PAYMENT_CATEGORIES = VOUCHER_CATEGORIES;
export type PaymentCategory = VoucherCategory;

/** 来源单据类型（镜像后端 PAYMENT_REQUEST_SOURCE_TYPES，持久化于 attachments.sourceDocument） */
export const PAYMENT_REQUEST_SOURCE_TYPES = ['purchase_order', 'order', 'expense', 'other'] as const;
export type PaymentRequestSourceType = (typeof PAYMENT_REQUEST_SOURCE_TYPES)[number];

export const PAYMENT_REQUEST_SOURCE_TYPE_LABELS: Record<PaymentRequestSourceType, string> = {
  purchase_order: '采购单',
  order: '订单',
  expense: '费用',
  other: '其他',
};

export interface PaymentRequest {
  id: string;
  requestNumber: string;
  supplierId?: string | null;
  supplierName?: string | null;
  requestDate: string;
  expectedPaymentDate?: string | null;
  totalAmount: number | string;
  currency: string;
  applicantId: string;
  reviewerId?: string | null;
  status: PaymentRequestStatus;
  approvalRequestId?: string | null;
  paymentVoucherId?: string | null;
  paymentCategory: PaymentCategory;
  ownerId?: string | null;
  remark?: string | null;
  attachments?: unknown;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

/** 详情关联的审批单快照（后端 GET /:id 返回） */
export interface PaymentRequestApprovalSnapshot {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  reviewerId?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

/** 详情关联的付款凭证快照（后端 GET /:id 返回） */
export interface PaymentRequestVoucherSnapshot {
  id: string;
  voucherNumber: string;
  type: string;
  voucherCategory?: VoucherCategory;
  amount: number | string;
  currency?: string;
  status: string;
}

export interface PaymentRequestDetail extends PaymentRequest {
  approvalRequest?: PaymentRequestApprovalSnapshot | null;
  paymentVoucher?: PaymentRequestVoucherSnapshot | null;
}

export interface CreatePaymentRequestInput {
  /** 付款对象：供应商 Relation ID 与名称至少其一必填 */
  supplierId?: string;
  supplierName?: string;
  totalAmount: number | string;
  currency: string;
  paymentCategory?: PaymentCategory;
  requestDate?: string;
  expectedPaymentDate?: string;
  sourceType?: PaymentRequestSourceType;
  sourceId?: string;
  remark?: string;
}

export interface PaymentRequestListParams {
  status?: PaymentRequestStatus;
  paymentCategory?: PaymentCategory;
  applicantId?: string;
  limit?: number;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const code = typeof data?.error === 'string' ? data.error : undefined;
  const rawMessage = data?.message || data?.error || `${fallback}: HTTP ${res.status}`;
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  const err: any = new Error(code && data?.message && !message.includes(code) ? `${code}：${message}` : message);
  err.status = res.status;
  err.code = code;
  throw err;
}

function requestUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/payment-requests${path}`, base);
}

export const paymentRequestService = {
  /** 列表（status / paymentCategory / applicantId 过滤，按创建时间倒序） */
  async listPaymentRequests(params?: PaymentRequestListParams, endpoint?: string): Promise<PaymentRequest[]> {
    const url = requestUrl('', endpoint);
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.paymentCategory) query.set('paymentCategory', params.paymentCategory);
    if (params?.applicantId) query.set('applicantId', params.applicantId);
    if (params?.limit) query.set('limit', String(params.limit));
    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const res = await fetch(fullUrl, { headers: apiService.getAuthHeaders() });
    if (!res.ok) await readError(res, 'listPaymentRequests failed');
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  },

  /** 详情（附 approvalRequest / paymentVoucher 关联快照） */
  async getPaymentRequest(id: string, endpoint?: string): Promise<PaymentRequestDetail> {
    const res = await fetch(requestUrl(`/${encodeURIComponent(id)}`, endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'getPaymentRequest failed');
    const data = await res.json();
    return data.item;
  },

  /** 创建（创建即 Pending 并生成审批单；reviewerId 由服务端 DR-007 解析，前端不得传入） */
  async createPaymentRequest(
    input: CreatePaymentRequestInput,
    endpoint?: string,
  ): Promise<{ paymentRequest: PaymentRequest; approvalRequestId: string }> {
    const res = await fetch(requestUrl('', endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'createPaymentRequest failed');
    const data = await res.json();
    return data;
  },

  /** 申请人作废（仅 Draft/Pending，仅本人；关联审批单一并撤回） */
  async cancelPaymentRequest(id: string, endpoint?: string): Promise<PaymentRequest> {
    const res = await fetch(requestUrl(`/${encodeURIComponent(id)}/cancel`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({}),
    });
    if (!res.ok) await readError(res, 'cancelPaymentRequest failed');
    const data = await res.json();
    return data.paymentRequest;
  },
};
