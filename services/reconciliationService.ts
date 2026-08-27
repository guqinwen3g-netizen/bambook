/**
 * Reconciliation API service — W-B 波次 P2-6 客户四单对账（订单↔出运↔开票↔收款）。
 * Communicates with /api/v1/reconciliation endpoints:
 *   GET  /orders/:orderId          — 单订单四单勾稽
 *   GET  /customers/:customerId    — 客户维度批量对账 + 汇总
 *   GET  /discrepancies            — 全量差异清单（severity 排序，分页/筛选）
 *   POST /orders/:orderId/refresh  — 强制重算（幂等，与 GET 同口径）
 *
 * 类型定义内聚在本文件（root types.ts 为冻结区，禁止编辑）。
 */
import { apiService } from './apiService';

export type DiscrepancySeverity = 'critical' | 'warning' | 'info';

export type DiscrepancyType =
  | 'quantity_mismatch'
  | 'invoice_amount_mismatch'
  | 'payment_mismatch'
  | 'status_inconsistency'
  | 'currency_mismatch'
  | 'manual_payment_field_drift';

export interface ReconciliationDiscrepancy {
  type: DiscrepancyType;
  field: string;
  expected: string;
  actual: string;
  severity: DiscrepancySeverity;
  message: string;
}

export interface OrderReconciliation {
  orderId: string;
  orderCode: string | null;
  poNumber: string | null;
  customerName: string | null;
  customerRelationId: string | null;
  currency: string | null;
  orderAmount: number;
  orderStatus: string;
  orderedQty: number;
  shippedQty: number;
  delivered: boolean;
  invoicedAmount: number;
  invoiceCount: number;
  paidAmount: number;
  referenceActualPaymentAmount: number | null;
  discrepancies: ReconciliationDiscrepancy[];
}

export interface CustomerReconciliationSummary {
  customerRelationId: string;
  totalOrders: number;
  discrepancyOrders: number;
  totalOrderAmount: number;
  totalInvoicedAmount: number;
  totalPaidAmount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export interface DiscrepancyListItem extends ReconciliationDiscrepancy {
  orderId: string;
  orderCode: string | null;
  poNumber: string | null;
  customerName: string | null;
  customerRelationId: string | null;
  currency: string | null;
  orderAmount: number;
}

export const DISCREPANCY_TYPE_LABELS: Record<DiscrepancyType, string> = {
  quantity_mismatch: '数量差异',
  invoice_amount_mismatch: '开票差异',
  payment_mismatch: '收款差异',
  status_inconsistency: '状态不一致',
  currency_mismatch: '币种不一致',
  manual_payment_field_drift: '手工实收漂移',
};

export const SEVERITY_LABELS: Record<DiscrepancySeverity, string> = {
  critical: '严重',
  warning: '警示',
  info: '提示',
};

async function readError(res: Response, fallback: string): Promise<never> {
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  const rawMessage = data?.error?.message ?? data?.message ?? `${fallback} (HTTP ${res.status})`;
  const code = data?.error?.code ?? data?.code;
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  const err: any = new Error(code && data?.message && !message.includes(code) ? `${code}：${message}` : message);
  err.status = res.status;
  err.code = code;
  throw err;
}

function reconciliationUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/reconciliation${path}`, base);
}

export const reconciliationService = {
  /** 单订单四单勾稽 */
  async reconcileOrder(orderId: string, endpoint?: string): Promise<OrderReconciliation> {
    const res = await fetch(reconciliationUrl(`/orders/${encodeURIComponent(orderId)}`, endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'reconcileOrder failed');
    return res.json();
  },

  /** 强制重算（幂等，与 GET 同口径；预留缓存失效语义） */
  async refreshOrder(orderId: string, endpoint?: string): Promise<OrderReconciliation> {
    const res = await fetch(reconciliationUrl(`/orders/${encodeURIComponent(orderId)}/refresh`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'refreshOrder failed');
    const data = await res.json();
    return data.result as OrderReconciliation;
  },

  /** 客户维度批量对账 */
  async reconcileCustomer(
    customerId: string,
    endpoint?: string,
  ): Promise<{ summary: CustomerReconciliationSummary; orders: OrderReconciliation[] }> {
    const res = await fetch(reconciliationUrl(`/customers/${encodeURIComponent(customerId)}`, endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'reconcileCustomer failed');
    return res.json();
  },

  /** 全量差异清单（severity 排序，分页/筛选） */
  async listDiscrepancies(
    params: { severity?: DiscrepancySeverity | ''; type?: DiscrepancyType | ''; customerRelationId?: string; page?: number; pageSize?: number } = {},
    endpoint?: string,
  ): Promise<{ items: DiscrepancyListItem[]; total: number; page: number; pageSize: number }> {
    const query = new URLSearchParams();
    if (params.severity) query.set('severity', params.severity);
    if (params.type) query.set('type', params.type);
    if (params.customerRelationId) query.set('customerRelationId', params.customerRelationId);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    const qs = query.toString();
    const res = await fetch(`${reconciliationUrl('/discrepancies', endpoint)}${qs ? `?${qs}` : ''}`, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'listDiscrepancies failed');
    const data = await res.json();
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total ?? 0),
      page: Number(data.page ?? 1),
      pageSize: Number(data.pageSize ?? 50),
    };
  },
};
