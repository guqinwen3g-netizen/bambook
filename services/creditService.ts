/**
 * Credit API service — 信用控制域（客户额度冻结/解冻/状态/历史时间线）。
 * Communicates with /api/v1/credit endpoints（:customerId = 客户 Relation.id）:
 *   POST /:customerId/freeze   — 人工冻结（scope credit:freeze:write，理由必填）
 *   POST /:customerId/thaw     — 主管手动解冻（scope credit:thaw:write，理由必填，记录 thawedReason）
 *   GET  /:customerId/status   — 信用状态（含门禁标记 creditFrozen / 最大逾期天数）
 *   GET  /:customerId/history  — 历史时间线（冻结/解冻/占用释放全事件，append-only）
 *
 * 类型定义内聚在本文件（root types.ts 为冻结区，禁止编辑）。
 * 设计真源：docs/design/03-业务规则/信用控制规则.md §2.4 / §6 #5/#6。
 */
import { apiService } from './apiService';

// ── 额度状态（CreditLimit.status；冻结门禁以 Frozen 为唯一真源） ──
export type CreditLimitStatus = 'Active' | 'Frozen' | 'Expired' | 'Revoked' | string;

export const CREDIT_LIMIT_STATUS_LABELS: Record<string, string> = {
  Active: '正常',
  Frozen: '已冻结',
  Expired: '已过期',
  Revoked: '已吊销',
};

/** 系统自动冻结/解冻身份（镜像后端 SYSTEM_CREDIT_ACTOR） */
export const SYSTEM_CREDIT_ACTOR = 'system_credit_scan';

/** 60 天逾期冻结阈值（镜像后端 OVERDUE_FREEZE_THRESHOLD_DAYS） */
export const OVERDUE_FREEZE_THRESHOLD_DAYS = 60;

/** GET /:customerId/status 返回的信用状态视图 */
export interface CreditStatus {
  relationId: string;
  hasCreditLimit: boolean;
  creditLimitId: string | null;
  status: CreditLimitStatus | null;
  /** 门禁标记：Frozen/Revoked → true（新订单阻断结论） */
  creditFrozen: boolean;
  totalLimit: number | null;
  usedAmount: number | null;
  remaining: number | null;
  currency: string | null;
  frozenAt: string | null;
  frozenBy: string | null;
  thawedReason: string | null;
  lastAutoScanDate: string | null;
  /** 未结清应收发票的最大逾期天数（Net 30 推定口径，与后端同源） */
  maxOverdueDays: number;
}

/** CreditLimitHistory 时间线条目（append-only） */
export interface CreditHistoryItem {
  id: string;
  creditLimitId: string;
  relationId: string;
  beforeUsedAmount: number;
  afterUsedAmount: number;
  /** after - before（正=占用，负=释放，0=冻结/解冻状态迁移留痕） */
  delta: number;
  /** payment_allocate | order_confirm | order_cancel | manual_adjust | credit_freeze | credit_thaw */
  triggerType: string;
  triggerId: string | null;
  triggerBy: string | null;
  remark: string | null;
  createdAt: string;
}

export const CREDIT_TRIGGER_TYPE_LABELS: Record<string, string> = {
  payment_allocate: '收款核销',
  order_confirm: '订单确认',
  order_cancel: '订单取消',
  manual_adjust: '手动调整',
  credit_freeze: '信用冻结',
  credit_thaw: '信用解冻',
};

export const creditTriggerTypeLabel = (triggerType?: string | null): string =>
  (triggerType && CREDIT_TRIGGER_TYPE_LABELS[triggerType]) || triggerType || '—';

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

function creditUrl(customerId: string, path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/credit/${encodeURIComponent(customerId)}${path}`, base);
}

export const creditService = {
  /** 客户信用状态（含门禁标记 creditFrozen / 最大逾期天数） */
  async getCreditStatus(customerId: string, endpoint?: string): Promise<CreditStatus> {
    const res = await fetch(creditUrl(customerId, '/status', endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'getCreditStatus failed');
    const data = await res.json();
    return data;
  },

  /** 历史时间线（冻结/解冻/占用释放全事件，append-only，按时间倒序） */
  async getCreditHistory(
    customerId: string,
    params?: { limit?: number; offset?: number },
    endpoint?: string,
  ): Promise<{ items: CreditHistoryItem[]; total: number }> {
    const url = creditUrl(customerId, '/history', endpoint);
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const res = await fetch(fullUrl, { headers: apiService.getAuthHeaders() });
    if (!res.ok) await readError(res, 'getCreditHistory failed');
    const data = await res.json();
    return { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total ?? 0) };
  },

  /** 人工冻结（scope credit:freeze:write；理由必填，审计强制） */
  async freezeCredit(customerId: string, reason: string, endpoint?: string): Promise<{ frozen: string[] }> {
    const res = await fetch(creditUrl(customerId, '/freeze', endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) await readError(res, 'freezeCredit failed');
    const data = await res.json();
    return { frozen: Array.isArray(data.frozen) ? data.frozen : [] };
  },

  /** 主管手动解冻（scope credit:thaw:write；理由必填，记录 thawedReason） */
  async thawCredit(customerId: string, reason: string, endpoint?: string): Promise<{ thawed: string[] }> {
    const res = await fetch(creditUrl(customerId, '/thaw', endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) await readError(res, 'thawCredit failed');
    const data = await res.json();
    return { thawed: Array.isArray(data.thawed) ? data.thawed : [] };
  },
};
