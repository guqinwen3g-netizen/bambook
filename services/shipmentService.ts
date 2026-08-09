/**
 * Shipment API service.
 * Communicates with /api/v1/shipping endpoints.
 */
import { apiService } from './apiService';
import type { Shipment, ShipmentStatus, ShipmentEvent, ShipmentLine, ShipmentCarton } from '../types';

type ShipmentListParams = {
  status?: ShipmentStatus;
  orderId?: string;
  carrier?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

/** Phase B3 — 准交率统计（与 server/src/shipping/shipmentStatsService.ts 契约一致） */
export interface OnTimeBucket {
  total: number;
  onTime: number;
  late: number;
  pending: number;
  rate: number | null; // onTime / (total - pending)；无可判定样本时为 null
}

export interface OnTimeStats {
  from: string | null;
  to: string | null;
  shipment: OnTimeBucket; // 运单准点率（ata ≤ eta）
  order: OnTimeBucket; // 订单准交率（最后一票 ata ≤ dueDate）
}

/** C4 — 运输方式维度统计（与 server/src/shipping/shipmentStatsService.ts getMethodStats 契约一致） */
export interface MethodBucket {
  method: string;
  total: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  judged: number;
  onTime: number;
  late: number;
  onTimeRate: number | null;
}

export interface MethodStats {
  from: string | null;
  to: string | null;
  methods: MethodBucket[];
}

/** C4 — 装运行写入载荷（镜像 server shipmentPackingService.ShipmentLineInput；null 清空字段） */
export interface ShipmentLineInput {
  orderLineId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  colorCode?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  cartons?: number | null;
  grossWeight?: number | string | null;
  netWeight?: number | string | null;
  volume?: number | string | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
}

/** C4 — 逐箱写入载荷（镜像 server shipmentPackingService.ShipmentCartonInput） */
export interface ShipmentCartonInput {
  cartonNo: string;
  description?: string | null;
  length?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  grossWeight?: number | string | null;
  netWeight?: number | string | null;
  volume?: number | string | null;
  items?: Array<{ shipmentLineId: string; quantity: number | string }>;
}

export const shipmentService = {
  async listShipments(endpoint?: string, params?: ShipmentListParams): Promise<Shipment[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/shipping', base);
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.carrier) query.set('carrierName', params.carrier);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const res = await fetch(fullUrl, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`listShipments failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  async getShipment(id: string, endpoint?: string): Promise<Shipment> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`getShipment failed: HTTP ${res.status}`);
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`getShipment failed: HTTP ${res.status} (non-JSON response)`); }
    return data.shipment || data;
  },

  async createShipment(input: Partial<Shipment>, endpoint?: string): Promise<Shipment> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/shipping', base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`createShipment failed: HTTP ${res.status} (non-JSON response)`); }
    if (!res.ok) {
      throw new Error(data?.error?.message || data?.error || `createShipment failed: HTTP ${res.status}`);
    }
    return data.shipment || data;
  },

  async updateShipment(id: string, input: Partial<Shipment>, endpoint?: string): Promise<Shipment> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`updateShipment failed: HTTP ${res.status} (non-JSON response)`); }
    if (!res.ok) {
      throw new Error(data?.error?.message || data?.error || `updateShipment failed: HTTP ${res.status}`);
    }
    return data.shipment || data;
  },

  async deleteShipment(id: string, endpoint?: string): Promise<void> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}`, base);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `deleteShipment failed: HTTP ${res.status}`);
    }
  },

  /** F3 — 物流节点时间轴（GET /v1/shipping/:id/events，升序全量） */
  async listShipmentEvents(id: string, endpoint?: string): Promise<ShipmentEvent[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}/events`, base);
    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`listShipmentEvents failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  /** Phase B3 — 准交率统计（GET /v1/shipping/stats/on-time） */
  async getOnTimeStats(params?: { from?: string; to?: string }, endpoint?: string): Promise<OnTimeStats> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/shipping/stats/on-time', base);
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const res = await fetch(fullUrl, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`getOnTimeStats failed: HTTP ${res.status}`);
    return res.json();
  },

  // ────────────────────────────────────────────────────────────
  // C4 发货深化：装运行 / 逐箱 / 方式统计
  // ────────────────────────────────────────────────────────────

  /** C4 — 装运行列表（GET /v1/shipping/:id/lines） */
  async listShipmentLines(id: string, endpoint?: string): Promise<ShipmentLine[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}/lines`, base);
    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`listShipmentLines failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  /** C4 — 装运行整组替换（PUT /v1/shipping/:id/lines，幂等） */
  async replaceShipmentLines(id: string, lines: ShipmentLineInput[], endpoint?: string): Promise<ShipmentLine[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}/lines`, base);
    const res = await fetch(url, {
      method: 'PUT',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ lines }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `replaceShipmentLines failed: HTTP ${res.status}`);
    return data.lines || [];
  },

  /** C4 — 从订单重新带出装运行（POST /v1/shipping/:id/lines/pull-from-order） */
  async pullLinesFromOrder(id: string, endpoint?: string): Promise<ShipmentLine[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}/lines/pull-from-order`, base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `pullLinesFromOrder failed: HTTP ${res.status}`);
    return data.lines || [];
  },

  /** C4 — 逐箱装箱列表（GET /v1/shipping/:id/cartons，含箱内分配） */
  async listShipmentCartons(id: string, endpoint?: string): Promise<ShipmentCarton[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}/cartons`, base);
    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`listShipmentCartons failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  /** C4 — 逐箱整组替换（PUT /v1/shipping/:id/cartons，幂等） */
  async replaceShipmentCartons(id: string, cartons: ShipmentCartonInput[], endpoint?: string): Promise<ShipmentCarton[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}/cartons`, base);
    const res = await fetch(url, {
      method: 'PUT',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ cartons }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `replaceShipmentCartons failed: HTTP ${res.status}`);
    return data.cartons || [];
  },

  /** C4 — 运输方式维度统计（GET /v1/shipping/stats/by-method） */
  async getMethodStats(params?: { from?: string; to?: string }, endpoint?: string): Promise<MethodStats> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/shipping/stats/by-method', base);
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const res = await fetch(fullUrl, {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`getMethodStats failed: HTTP ${res.status}`);
    return res.json();
  },
};
