/**
 * orderShipmentBatchService — P0-1 订单分批出运与尾款结算（前端 API 封装）
 *
 * 后端契约：server/src/shipping/route.ts（/api/v1/shipping/order-batches*）
 * 服务真源：server/src/shipping/orderShipmentBatchService.ts
 *
 * 端点：
 *   GET  /order-batches?orderId=…            — 订单批次全景（批次列表 + 计划/出运/结算汇总）
 *   GET  /order-batches/overdue-final        — 尾款到期未结清末批清单
 *   POST /order-batches                      — 批次登记（batchNo 自动递增；单批自动末批）
 *   PUT  /order-batches/:id                  — 批次更新（计划期可改计划；status 仅 planned→cancelled）
 *   POST /order-batches/:id/mark-shipped     — 发运确认（排船回填 + 尾款到期日 + 末批收款门禁）
 *   POST /order-batches/:id/recalc           — 结算进度重算
 */
import { apiService } from './apiService';

export type BatchStatus = 'planned' | 'shipped' | 'cancelled';
export type BatchSettleStatus = 'unsettled' | 'partially_settled' | 'settled';

export interface OrderShipmentBatchView {
  id: string;
  orderId: string;
  shipmentId?: string | null;
  batchNo: number;
  plannedRatio?: number | null;
  plannedQty?: number | null;
  unit?: string | null;
  amount?: number | null;
  currency: string;
  customerRelationId?: string | null;
  customerName?: string | null;
  status: BatchStatus | string;
  shippedAt?: number | null;
  settleStatus: BatchSettleStatus | string;
  invoicedAmount?: number | null;
  paidAmount?: number | null;
  settledAt?: number | null;
  isFinalBatch?: boolean;
  finalPaymentDueDays?: number | null;
  finalPaymentDueDate?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  // 派生（后端 serialize）
  settleProgress?: number | null;
  outstandingAmount?: number | null;
  finalPaymentOverdue?: boolean;
  orderPoNumber?: string | null;
  orderCustomer?: string | null;
}

export interface OrderBatchSummary {
  totalBatches: number;
  shippedBatches: number;
  allShipped: boolean;
  totalPlannedAmount: number;
  totalInvoiced: number;
  totalPaid: number;
}

export interface OrderBatchOverview {
  order: { id: string; poNumber?: string | null; customer?: string | null; currency?: string | null };
  orderAmount: number;
  batches: OrderShipmentBatchView[];
  summary: OrderBatchSummary;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const code = data?.error?.code ?? (typeof data?.error === 'string' ? data.error : undefined);
  const rawMessage = data?.error?.message || data?.message || `${fallback}: HTTP ${res.status}`;
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  const err: any = new Error(code && !message.includes(code) ? `${code}：${message}` : message);
  err.status = res.status;
  err.code = code;
  throw err;
}

function batchUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/shipping/order-batches${path}`, base);
}

export interface BatchCreateInput {
  orderId: string;
  shipmentId?: string;
  plannedRatio?: number;
  plannedQty?: number;
  unit?: string;
  amount?: number;
  currency?: string;
  isFinalBatch?: boolean;
  finalPaymentDueDays?: number;
  notes?: string;
}

export interface BatchUpdateInput {
  shipmentId?: string | null;
  plannedRatio?: number | null;
  plannedQty?: number | null;
  unit?: string | null;
  amount?: number | null;
  isFinalBatch?: boolean;
  finalPaymentDueDays?: number | null;
  notes?: string | null;
  status?: string; // 'cancelled'
}

export const orderShipmentBatchService = {
  /** 订单批次全景（列表 + 汇总） */
  async listByOrder(orderId: string, endpoint?: string): Promise<OrderBatchOverview> {
    const res = await fetch(`${batchUrl('', endpoint)}?orderId=${encodeURIComponent(orderId)}`, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'order batches listByOrder failed');
    return await res.json();
  },

  /** 尾款到期未结清末批清单（看板/watchdog 扫描源） */
  async listOverdueFinal(limit = 100, endpoint?: string): Promise<OrderShipmentBatchView[]> {
    const res = await fetch(`${batchUrl('/overdue-final', endpoint)}?limit=${limit}`, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'order batches listOverdueFinal failed');
    const data = await res.json();
    return Array.isArray(data.batches) ? data.batches : [];
  },

  /** 批次登记（batchNo 自动递增；单批自动末批） */
  async createBatch(input: BatchCreateInput, endpoint?: string): Promise<OrderShipmentBatchView> {
    const res = await fetch(batchUrl('', endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'order batches createBatch failed');
    const data = await res.json();
    return data.batch;
  },

  /** 批次更新（计划期可改；status 仅 planned→cancelled） */
  async updateBatch(batchId: string, input: BatchUpdateInput, endpoint?: string): Promise<OrderShipmentBatchView> {
    const res = await fetch(batchUrl(`/${encodeURIComponent(batchId)}`, endpoint), {
      method: 'PUT',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'order batches updateBatch failed');
    const data = await res.json();
    return data.batch;
  },

  /** 批次取消（planned→cancelled；已发运 409） */
  async cancelBatch(batchId: string, endpoint?: string): Promise<OrderShipmentBatchView> {
    return this.updateBatch(batchId, { status: 'cancelled' }, endpoint);
  },

  /** 发运确认（排船回填 + 尾款到期日计算 + 末批收款门禁；skipGate 管理员豁免留痕） */
  async markShipped(batchId: string, input?: {
    shipmentId?: string;
    shippedAt?: number;
    gateCoverRatio?: number;
    skipGate?: boolean;
  }, endpoint?: string): Promise<OrderShipmentBatchView> {
    const res = await fetch(batchUrl(`/${encodeURIComponent(batchId)}/mark-shipped`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input ?? {}),
    });
    if (!res.ok) await readError(res, 'order batches markShipped failed');
    const data = await res.json();
    return data.batch;
  },

  /** 结算进度重算（发票分配/核销变动后触发） */
  async recalc(batchId: string, endpoint?: string): Promise<OrderShipmentBatchView> {
    const res = await fetch(batchUrl(`/${encodeURIComponent(batchId)}/recalc`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({}),
    });
    if (!res.ok) await readError(res, 'order batches recalc failed');
    const data = await res.json();
    return data.batch;
  },
};
