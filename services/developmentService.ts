/**
 * Development Management API service.
 * Communicates with /api/v1/development endpoints.
 */
import { apiService } from './apiService';
import type {
  DevelopmentCase,
  DevelopmentCaseCreateInput,
  DevelopmentCaseUpdateInput,
  DevelopmentType,
  DevelopmentStage,
  DevelopmentPriority,
  SampleNode,
  SampleNodeLevel,
  SampleNodeAction,
} from '../types';

type DevelopmentListParams = {
  type?: DevelopmentType;
  stage?: DevelopmentStage;
  customer?: string;
  supplier?: string;
  owner?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export const developmentService = {
  /**
   * List development cases with optional filters.
   */
  async listDevelopmentCases(endpoint?: string, params?: DevelopmentListParams): Promise<DevelopmentCase[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/development', base);
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.stage) query.set('stage', params.stage);
    if (params?.customer) query.set('customer', params.customer);
    if (params?.supplier) query.set('supplier', params.supplier);
    if (params?.owner) query.set('owner', params.owner);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const apiKey = apiService.getApiKey();

    const res = await fetch(fullUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`listDevelopmentCases failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.cases || [];
  },

  /**
   * Get a single development case by ID.
   */
  async getDevelopmentCase(id: string, endpoint?: string): Promise<DevelopmentCase> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/development/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`getDevelopmentCase failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.case;
  },

  /**
   * Create a new development case.
   */
  async createDevelopmentCase(input: DevelopmentCaseCreateInput, endpoint?: string): Promise<DevelopmentCase> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/development', base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `createDevelopmentCase failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.case;
  },

  /**
   * Update a development case.
   */
  async updateDevelopmentCase(id: string, input: DevelopmentCaseUpdateInput, endpoint?: string): Promise<DevelopmentCase> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/development/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `updateDevelopmentCase failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.case;
  },

  /**
   * Update stage with validation.
   */
  async updateStage(id: string, stage: DevelopmentStage, nextAction?: string, endpoint?: string): Promise<DevelopmentCase> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/development/${encodeURIComponent(id)}/stage`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ stage, nextAction }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `updateStage failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.case;
  },

  /**
   * Convert development case to order.
   *
   * Two modes:
   *   - Pass `{ orderId, orderPo }` to link this dev case to an existing order.
   *   - Pass `{ autoCreate: true, ... }` (or omit orderId/orderPo) to ask the
   *     server to auto-create a new Order seeded from the dev case (customer,
   *     supplier, product all carried over via cross-module entity links).
   * Returns both the updated dev case and the new/linked order.
   */
  async convertToOrder(
    id: string,
    body: {
      orderId?: string;
      orderPo?: string;
      autoCreate?: boolean;
      customer?: string;
      millName?: string;
      dueDate?: string;
      productName?: string;
      quantity?: number;
    } | { orderId: string; orderPo: string },
    endpoint?: string,
  ): Promise<{ case: DevelopmentCase; order: any | null }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/development/${encodeURIComponent(id)}/convert`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `convertToOrder failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return { case: data.case, order: data.order ?? null };
  },

  /**
   * Soft delete a development case.
   */
  async deleteDevelopmentCase(id: string, endpoint?: string): Promise<void> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/development/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`deleteDevelopmentCase failed: HTTP ${res.status}`);
  },

  // ── Phase B4 三级样衣节点 ──

  /** 获取三级样衣节点（若无则自动 ensure 创建） */
  async listSampleNodes(caseId: string, endpoint?: string): Promise<SampleNode[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const apiKey = apiService.getApiKey();
    const headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
    };
    // 写权限接口 ensure 幂等创建 + 返回最新列表（一次往返）
    const res = await fetch(apiService.buildApiUrl(`/v1/development/${encodeURIComponent(caseId)}/sample-nodes/ensure`, base), {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `ensureSampleNodes failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.nodes || [];
  },

  /** 推进样衣节点状态机 */
  async advanceSampleNode(
    caseId: string,
    level: SampleNodeLevel,
    input: {
      action: SampleNodeAction;
      sentDate?: string;
      courier?: string;
      trackingNumber?: string;
      feedback?: string;
      feedbackDate?: string;
      notes?: string;
    },
    endpoint?: string,
  ): Promise<SampleNode> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/development/${encodeURIComponent(caseId)}/sample-nodes/${encodeURIComponent(level)}`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `advanceSampleNode failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.node;
  },
};
