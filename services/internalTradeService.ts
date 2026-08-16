/**
 * DR-005/DR-033 内部面料交易 API service — /v1/internal-trade + /v1/finance/reports/consolidated-profit
 *
 * 后端契约（server/src/internalTrade/internalTradeRoute.ts + server/src/finance/reportService.ts，冻结）：
 *   GET /v1/internal-trade                 — 内部供料单列表（departmentId / status / garmentOrderId / fabricOrderId 过滤）
 *   GET /v1/internal-trade/:id             — 详情（master + mirror + 解码载荷）
 *   GET /v1/finance/reports/consolidated-profit — 公司合并利润视图（DR-005 抵销，无查询参数，只读聚合）
 *
 * 契约要点：
 *   - 双向记录拓扑：master=incoming（服装订单侧，权威载荷）/ mirror=outgoing（面料订单侧，镜像）；
 *     列表端点仅返回 incoming 主单，合并抵销仅取单边，禁止双边重复计入
 *   - DR-033 扩展单据内容以类型化 JSON 存于 memo 列（docType='DR033_INTERNAL_FABRIC_SUPPLY'），
 *     decodeInternalTransferPayload 为前端唯一解码入口（fail-safe，非法载荷返回 null）
 *   - 生效状态（Effective/Delivering/Closed）才计入核算；Draft/PendingConfirm/Cancelled 不计
 *   - transferAmount 为 Prisma Decimal，JSON 序列化可能是 string，统一 toAmount 归一
 *   - 合并报表为全量聚合投影（服务端 getConsolidatedProfitReport 无日期/部门参数），
 *     部门双视角（DR-043）由响应内 departments 字段承载，前端不做任何口径再计算
 */
import { apiService } from './apiService';

// ────────────────────────────────────────────────────────────────
// 状态机（与 server INTERNAL_TRANSFER_STATUSES 一致）
// ────────────────────────────────────────────────────────────────
export const INTERNAL_TRANSFER_STATUSES = [
  'Draft',
  'PendingConfirm',
  'Effective',
  'Delivering',
  'Closed',
  'Cancelled',
] as const;
export type InternalTransferStatus = (typeof INTERNAL_TRANSFER_STATUSES)[number];

export const INTERNAL_TRANSFER_STATUS_LABEL: Record<InternalTransferStatus, string> = {
  Draft: '草稿',
  PendingConfirm: '待面料部确认',
  Effective: '已生效',
  Delivering: '交付中',
  Closed: '已关闭',
  Cancelled: '已取消',
};

/** 计入核算（服装部成本 / 面料部收入 / 合并抵销）的生效状态集合 */
export const INTERNAL_TRANSFER_ACCOUNTING_STATUSES: readonly InternalTransferStatus[] = [
  'Effective',
  'Delivering',
  'Closed',
];

// ────────────────────────────────────────────────────────────────
// DR-033 载荷（memo JSON，schema 冻结期载体；与 server payload 契约一致）
// ────────────────────────────────────────────────────────────────
export interface InternalTransferPackingLine {
  cartonNo: string;
  quantity: number;
  grossWeight?: number;
  netWeight?: number;
}

export interface InternalTransferDelivery {
  id: string;
  shipmentId: string;
  shipmentNumber: string | null;
  quantity: number;
  deliveryDate: string;
  receivedQuantity: number | null;
  receivedDate: string | null;
  /** 差异 = 到货 − 出运（null = 尚未登记到货） */
  variance: number | null;
  packingLines: InternalTransferPackingLine[];
  registeredBy: string;
  registeredAt: string;
}

export interface InternalTransferHistoryEntry {
  from: InternalTransferStatus | null;
  to: InternalTransferStatus;
  actorId: string;
  at: string;
  note?: string;
}

export interface InternalTransferPayload {
  docType: 'DR033_INTERNAL_FABRIC_SUPPLY';
  role: 'master' | 'mirror';
  masterId: string;
  mirrorId: string | null;
  requestDepartmentId: string;
  supplyDepartmentId: string;
  garmentOrderId: string;
  fabricOrderId: string;
  materialCode: string;
  quantity: number;
  unit: string;
  settlementPrice: number;
  settlementApprovalId: string;
  dueDate: string;
  status: InternalTransferStatus;
  confirmedQuantity: number | null;
  confirmedDueDate: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  deliveries: InternalTransferDelivery[];
  history: InternalTransferHistoryEntry[];
  memo?: string;
}

/** 解码 memo 载荷；非 DR-033 载荷/非法 JSON 返回 null（fail-safe，不抛错） */
export function decodeInternalTransferPayload(memo: string | null | undefined): InternalTransferPayload | null {
  if (!memo) return null;
  try {
    const parsed = JSON.parse(memo);
    if (parsed && parsed.docType === 'DR033_INTERNAL_FABRIC_SUPPLY') {
      return parsed as InternalTransferPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// 列表/详情记录（Prisma 行序列化；Decimal 可能为 string）
// ────────────────────────────────────────────────────────────────
export interface InternalTransferRecord {
  id: string;
  orderId: string;
  transferDirection: 'incoming' | 'outgoing';
  counterpartyId: string | null;
  ourDepartmentId: string | null;
  transferAmount: number | string;
  transferCurrency: string;
  transferDate: string;
  memo: string | null;
  recognizedBy: string | null;
  recognizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET / 列表项：record 为 DB 行，payload 为服务端已解码的 DR-033 载荷（可能为 null） */
export interface InternalTransferListItem {
  record: InternalTransferRecord;
  payload: InternalTransferPayload | null;
}

export interface InternalTransferListResult {
  items: InternalTransferListItem[];
  total: number;
}

export interface InternalTransferDetail {
  item: InternalTransferRecord;
  mirror: InternalTransferRecord | null;
  payload: InternalTransferPayload | null;
}

// ────────────────────────────────────────────────────────────────
// 公司合并利润视图（DR-005；与 server reportService.ConsolidatedProfitReport 一致）
// ────────────────────────────────────────────────────────────────
export interface ConsolidatedProfitDepartment {
  revenue: number;
  cost: number;
  profit: number;
}

export interface ConsolidatedProfitReport {
  baseCurrency: string;
  consolidatedRevenue: number;
  consolidatedCost: number;
  consolidatedProfit: number;
  costBreakdown: {
    /** 外部订单采购成本（已剔除内部采购加价） */
    externalPurchaseNetOfInternal: number;
    /** 真实面料成本（内部面料订单自身采购成本） */
    realFabricCost: number;
    freightCost: number;
    miscCost: number;
  };
  elimination: {
    /** 服装部内部面料采购成本合计（生效 incoming） */
    internalPurchase: number;
    /** 面料部内部面料销售收入合计（生效 outgoing） */
    internalSales: number;
    /** 抵销额 = internalPurchase（单边口径） */
    amount: number;
    /** internalSales − internalPurchase（应≈0；非 0 透明披露双边口径不一致） */
    discrepancy: number;
  };
  departments: {
    garment: ConsolidatedProfitDepartment;
    fabric: ConsolidatedProfitDepartment;
  };
  orders: { externalCount: number; internalCount: number };
  /** 非 CNY 生效内部交易：不折算不假设汇率，透明披露并排除在抵额外 */
  unconverted: Array<{ transferId: string; orderId: string; direction: string; amount: number; currency: string; reason: string }>;
}

// ────────────────────────────────────────────────────────────────
// 请求基础（与 exceptionService 相同的错误透传语义：CODE：message）
// ────────────────────────────────────────────────────────────────
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

function apiUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(path, base);
}

/** Decimal 序列化归一（string | number → number） */
export function toAmount(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export const internalTradeService = {
  /** 内部供料单列表（仅 incoming 主单；状态过滤由服务端在载荷层执行） */
  async listInternalTransfers(
    filter: {
      departmentId?: string;
      status?: InternalTransferStatus;
      garmentOrderId?: string;
      fabricOrderId?: string;
      limit?: number;
      offset?: number;
    } = {},
    endpoint?: string,
  ): Promise<InternalTransferListResult> {
    const query = new URLSearchParams();
    if (filter.departmentId) query.set('departmentId', filter.departmentId);
    if (filter.status) query.set('status', filter.status);
    if (filter.garmentOrderId) query.set('garmentOrderId', filter.garmentOrderId);
    if (filter.fabricOrderId) query.set('fabricOrderId', filter.fabricOrderId);
    if (filter.limit) query.set('limit', String(filter.limit));
    if (filter.offset) query.set('offset', String(filter.offset));
    const suffix = query.toString() ? `/?${query.toString()}` : '/';
    const res = await fetch(apiUrl(`/v1/internal-trade${suffix}`, endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'listInternalTransfers failed');
    const data = await res.json();
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || 0,
    };
  },

  /** 内部供料单详情（master + mirror + 解码载荷） */
  async getInternalTransfer(id: string, endpoint?: string): Promise<InternalTransferDetail> {
    const res = await fetch(apiUrl(`/v1/internal-trade/${encodeURIComponent(id)}`, endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'getInternalTransfer failed');
    return res.json();
  },

  /**
   * 公司合并利润视图（DR-005 抵销，只读全量聚合，无查询参数）。
   * 合并收入仅计外部客户收入；合并成本 = 外部采购（剔除内部采购加价）+ 真实面料成本 + 运费 + 杂费；
   * 抵销取单边生效内部交易额，恒等式 Σ 部门利润 = 合并利润。
   */
  async getConsolidatedProfitReport(endpoint?: string): Promise<ConsolidatedProfitReport> {
    const res = await fetch(apiUrl('/v1/finance/reports/consolidated-profit', endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'getConsolidatedProfitReport failed');
    return res.json();
  },
};
