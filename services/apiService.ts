
import {
  KnowledgeItem,
  Order,
  OrderStatusTransition,
  SystemConfig,
  Email,
  Relation,
  ProductAsset,
  ProductAssetDetail,
  ProductSubCategory,
  Invoice,
  PaymentVoucher,
  Shipment,
  DevelopmentCase,
  Insight,
  CreateProductAssetInput,
  BusinessProfile,
  BusinessProfileInput,
  ProductImage,
  SystemAsset,
  PdmlRawFabric,
  PdmlSyncResult,
  PdmlSyncJob,
  PdmlMapResult,
  NotificationItem,
  NotificationStats,
  AutomationRule,
} from '../types';
import { getApiBaseUrl, CORPORATE_MASTER_IP, normalizeDataCenterEndpoint } from './apiBase';

export const DEFAULT_KNOWLEDGE_API_ENDPOINT = 'https://jiangsupanda.com/bambook';
export const DEFAULT_CLOUD_ENDPOINT = 'https://jiangsupanda.com/bambook';

export interface TestResult {
  ok: boolean;
  error?: string;
  detail?: string;
  testedUrl?: string;
  statusCode?: number;
  rawError?: string;
  isCorsIssue?: boolean;
  isProtocolIssue?: boolean;
  isPhysicalDown?: boolean;
}

export interface KnowledgeDocumentRecord {
  id: string;
  title: string;
  content: string;
  category: string | null;
  sourceType: string;
  version: number;
  chunkCount: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
  origin: 'erp' | 'upload';
}

export interface ProductAssetPage {
  assets: ProductAssetDetail[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export { CORPORATE_MASTER_IP, getApiBaseUrl } from './apiBase';

/** 动态获取 API base URL，确保设置变更后立即生效。 */
const getDynamicApiBaseUrl = () => getApiBaseUrl();

const normalizeEndpoint = (endpoint?: string): string => {
  if (!endpoint?.trim()) return getDynamicApiBaseUrl().replace(/\/$/, '');
  let formatted = normalizeDataCenterEndpoint(endpoint);
  if (!formatted.startsWith('http')) formatted = `http://${formatted}`;
  try {
    const url = new URL(formatted);
    if (!url.port && url.pathname === '/') url.port = '8081';
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
  } catch {
    if (!formatted.match(/:\d+$/)) formatted = `${formatted}:8081`;
    return formatted;
  }
};

const buildApiUrl = (path: string, endpoint?: string): string => {
  const base = normalizeEndpoint(endpoint);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (base.endsWith('/api')) {
    return `${base}${cleanPath.startsWith('/api/') ? cleanPath.slice(4) : cleanPath}`;
  }
  return `${base}${cleanPath.startsWith('/api/') ? cleanPath : `/api${cleanPath}`}`;
};

const getApiKey = (): string => {
  const envKey = import.meta.env.VITE_BAMBOOK_API_KEY as string | undefined;
  if (envKey?.trim()) return envKey.trim();
  try {
    const saved = localStorage.getItem('panda_system_config');
    if (!saved) return '';
    return String(JSON.parse(saved)?.sdkApiKey || '').trim();
  } catch {
    return '';
  }
};

const jsonHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['X-Bambook-API-Key'] = key;
  return headers;
};

const requestJson = async <T>(path: string, opts: RequestInit & { endpoint?: string } = {}): Promise<T> => {
  const { endpoint, headers, ...init } = opts;
  const response = await fetch(buildApiUrl(path, endpoint), {
    ...init,
    headers: {
      ...jsonHeaders(),
      ...(headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const serverMessage = data?.message || (typeof data?.error === 'string' ? data.error : data?.error?.message);
    throw new Error(serverMessage || `HTTP ${response.status}`);
  }
  return data as T;
};

const postData = async (url: string, data: any) => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(data),
    });
    return await response.json();
  } catch (error) {
    return { status: 'error', error: String(error) };
  }
};

const getData = async (url: string) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: jsonHeaders(),
    });
    return await response.json();
  } catch (error) {
    return { status: 'error', error: String(error) };
  }
};

// Email API
export const fetchEmails = async (config: any) => {
  return postData(`${getDynamicApiBaseUrl()}/email/fetch`, config);
};

export const fetchEmailDetail = async (config: any, uid: string) => {
  return postData(`${getDynamicApiBaseUrl()}/email/detail`, { ...config, uid });
};

export const sendEmail = async (data: any) => {
  return postData(`${getDynamicApiBaseUrl()}/email/send`, data);
};

export const apiService = {
  getStoredConfig: (): SystemConfig => {
    const saved = localStorage.getItem('panda_system_config');

    const defaultConfig: SystemConfig = {
      // @ts-ignore
      cloudEndpoint: import.meta.env.VITE_CLOUD_ENDPOINT || DEFAULT_CLOUD_ENDPOINT,
      // @ts-ignore
      knowledgeApiEndpoint: import.meta.env.VITE_KNOWLEDGE_API_ENDPOINT || DEFAULT_KNOWLEDGE_API_ENDPOINT,
      knowledgeApiKey: '',
      databaseId: 'panda-node-v1',
      isCloudConnected: false,
      isRootActive: false,
      syncInterval: 15,
      agentName: '竹衍 (Bambook)',
      agentRole: 'Panda Clothing 数字智慧核心，精通全球供应链演化与逻辑推演。',
      // Visuals
      themeMode: 'system',
      compactMode: false,
      systemWallpaperOptions: undefined,
      enableProductionGlobe: true,
      enableLightEffects: true,
      // AI Core（默认与 Assistant 内 MODELS.FAST 一致 = MODELS.AUTO）
      chatModelId: 'ark-code-latest',
      temperature: 0.7,
      maxTokens: 2048,
      enableVision: true,
      // Voice
      ttsProvider: 'Volcengine-TTS',
      voiceSpeed: 1.0,
      // Security
      dataMasking: true,
      // SDK API Defaults
      sdkApiKey: '',
      sdkAuthMode: 'auto'
    };

    if (!saved) return defaultConfig;

    try {
      const parsed = JSON.parse(saved);
      let didMigrateConfig = false;
      const normalizedCloudEndpoint = normalizeDataCenterEndpoint(parsed.cloudEndpoint);
      if (parsed.cloudEndpoint !== normalizedCloudEndpoint) {
        parsed.cloudEndpoint = normalizedCloudEndpoint;
        didMigrateConfig = true;
      }
      if (!parsed.knowledgeApiEndpoint || parsed.knowledgeApiEndpoint.trim() === '') {
        parsed.knowledgeApiEndpoint = defaultConfig.knowledgeApiEndpoint;
        didMigrateConfig = true;
      }
      if (!parsed.chatModelId && parsed.modelProvider) {
        // Migration: map legacy `modelProvider` enum to the current Ark model.
        const legacy: Record<string, string> = {
          'Qwen-Max': 'ark-code-latest',
          'GLM-4-Plus': 'ark-code-latest',
          'GLM-4-Flash': 'ark-code-latest',
          'GLM-4V-Plus': 'ark-code-latest'
        };
        parsed.chatModelId = legacy[parsed.modelProvider] || 'ark-code-latest';
      }
      // Belt-and-suspenders: 升级到新清单时，把已存的过期 chatModelId
      // 也归一到可用模型，避免下拉显示空白 / 后端 404。
      const VALID_MODEL_IDS = new Set([
        'ark-code-latest'
      ]);
      if (parsed.chatModelId && !VALID_MODEL_IDS.has(parsed.chatModelId)) {
        parsed.chatModelId = 'ark-code-latest';
        didMigrateConfig = true;
      }
      const migratedConfig = { ...defaultConfig, ...parsed };
      if (didMigrateConfig) {
        localStorage.setItem('panda_system_config', JSON.stringify(migratedConfig));
      }
      return migratedConfig;
    } catch (e) {
      return defaultConfig;
    }
  },

  saveConfig: (config: SystemConfig) => {
    localStorage.setItem('panda_system_config', JSON.stringify(config));
  },

  async fetchCloudData<T>(path: string, endpoint: string): Promise<T | null> {
    if (!endpoint) return null;
    try {
      const response = await fetch(buildApiUrl(path, endpoint), {
        method: 'GET',
        headers: jsonHeaders(),
      });
      if (!response.ok) throw new Error('Network response was not ok');
      return await response.json();
    } catch (e) {
      return null;
    }
  },

  async postCloudData(path: string, endpoint: string, data: any): Promise<boolean> {
    if (!endpoint) return false;
    try {
      const response = await fetch(buildApiUrl(path, endpoint), {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(data)
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  },

  async probePhysicalLink(ip: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2500);
      const img = new Image();
      img.onload = () => { clearTimeout(timeout); resolve(true); };
      img.onerror = () => { clearTimeout(timeout); resolve(true); };
      // 探测 IP 是否通畅，无视 CORS
      img.src = `http://${ip}:8081/favicon.ico?t=${Date.now()}`;
    });
  },

  async testConnection(endpoint: string): Promise<TestResult> {
    if (!endpoint) return { ok: false, error: 'MISSING_IP', detail: '请输入服务器公网 IP' };

    const cleanIp = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
    const isPageHttps = window.location.protocol === 'https:';
    const testUrl = buildApiUrl('/health', endpoint);
    const isTargetHttp = testUrl.startsWith('http://');

    // 1. 协议检查
    if (isPageHttps && isTargetHttp) {
      return {
        ok: false,
        isProtocolIssue: true,
        testedUrl: testUrl,
        detail: '安全策略阻断 (Mixed Content)：由于你正在通过 HTTPS 访问此应用，浏览器禁止访问 HTTP 后端。请通过 http:// 协议打开应用，或在浏览器设置中允许“不安全内容”。'
      };
    }

    // 2. 物理链路探测仅适用于旧的 HTTP/IP 直连；Cloudflare HTTPS 直接请求健康检查。
    if (isTargetHttp) {
      const isPhysicalUp = await this.probePhysicalLink(cleanIp);
      if (!isPhysicalUp) {
        return {
          ok: false,
          isPhysicalDown: true,
          testedUrl: testUrl,
          detail: '物理链路不通 (Timeout)：无法连接到主数据 API。请检查端口、防火墙或后端进程。'
        };
      }
    }

    // 3. 完整接口测试
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(testUrl, {
        method: 'GET',
        mode: 'cors',
        signal: controller.signal,
        headers: { 'Access-Control-Allow-Private-Network': 'true' }
      });
      if (res.status === 404) {
        return {
          ok: false,
          testedUrl: testUrl,
          statusCode: res.status,
          detail: '主数据健康检查返回 404。若使用 Cloudflare /bambook，请确认 /bambook/api 优先路由到 Mac mini 8081。'
        };
      }
      const data = await res.json();
      if (data.status === 'ok') return { ok: true, testedUrl: testUrl, statusCode: res.status };
      return { ok: false, testedUrl: testUrl, statusCode: res.status, detail: '节点在线但响应数据格式异常。' };
    } catch (e: any) {
      return {
        ok: false,
        isCorsIssue: true,
        testedUrl: testUrl,
        detail: 'CORS、网络重置或超时错误。请确认 Cloudflare 路由、8081 服务、CORS 与数据库连接状态。'
      };
    }
  },

  async fetchEmailDetail(config: any, box: string, uid: string) {
    return postData(`${getDynamicApiBaseUrl()}/email/detail`, { ...config, box, uid });
  },

  buildApiUrl,
  getApiKey,

  subscribeToDataChanges(endpoint: string | undefined, onChange: (event: { entity: string; action: string; ids?: string[]; timestamp: number }) => void): () => void {
    if (typeof EventSource === 'undefined') return () => {};
    const apiKey = getApiKey();
    const url = new URL(buildApiUrl('/v1/events', endpoint), window.location.origin);
    if (apiKey) url.searchParams.set('apiKey', apiKey);

    const source = new EventSource(url.toString());
    source.addEventListener('data-change', (event) => {
      try {
        onChange(JSON.parse((event as MessageEvent).data));
      } catch (error) {
        console.warn('[DataHub] ignored malformed realtime event:', error);
      }
    });
    source.onerror = () => {
      console.warn('[DataHub] realtime stream disconnected; browser will retry automatically');
    };
    return () => source.close();
  },

  async listOrders(endpoint?: string): Promise<Order[]> {
    const data = await requestJson<{ ok: boolean; orders: Order[] }>('/v1/orders', { endpoint, method: 'GET' });
    return Array.isArray(data.orders) ? data.orders : [];
  },

  async getOrderTimeline(orderId: string, endpoint?: string): Promise<OrderStatusTransition[]> {
    const data = await requestJson<{ ok: boolean; timeline?: OrderStatusTransition[] }>(`/v1/orders/${encodeURIComponent(orderId)}/timeline`, { endpoint, method: 'GET' });
    return Array.isArray(data.timeline) ? data.timeline : [];
  },

  async transitionOrderStatus(orderId: string, toStatus: string, operator: string, endpoint?: string): Promise<Order> {
    const data = await requestJson<{ ok: boolean; order?: Order; error?: { message?: string } }>(`/v1/orders/${encodeURIComponent(orderId)}/status-transition`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ toStatus, operator }),
    });
    if (!data.ok || !data.order) throw new Error(data.error?.message || '状态变更失败');
    return data.order;
  },

  async scanProductionAlerts(endpoint?: string): Promise<{ orderId: string; poNumber?: string; customer?: string; alertType: string; deadline: string; message: string; severity: 'critical' | 'high' | 'medium' | 'low' }[]> {
    const data = await requestJson<{ ok: boolean; alerts?: any[] }>('/v1/production/alerts/scan', { endpoint, method: 'GET' });
    return Array.isArray(data.alerts) ? data.alerts : [];
  },

  async listInvoices(endpoint?: string): Promise<Invoice[]> {
    const data = await requestJson<{ items: Invoice[]; total: number }>('/v1/finance', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async listPaymentVouchers(endpoint?: string): Promise<PaymentVoucher[]> {
    const data = await requestJson<{ items: PaymentVoucher[]; total: number }>('/v1/finance/vouchers', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async listShipments(endpoint?: string): Promise<Shipment[]> {
    const data = await requestJson<{ items: Shipment[]; total: number }>('/v1/shipping', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async listDevelopmentCases(endpoint?: string): Promise<DevelopmentCase[]> {
    const data = await requestJson<{ ok: boolean; cases: DevelopmentCase[]; total: number }>('/v1/development', { endpoint, method: 'GET' });
    return Array.isArray(data.cases) ? data.cases : [];
  },

  async listRelations(endpoint?: string): Promise<Relation[]> {
    const data = await requestJson<{ ok: boolean; relations: Relation[] }>('/v1/relations', { endpoint, method: 'GET' });
    return Array.isArray(data.relations) ? data.relations : [];
  },

  async saveRelation(relation: Relation, endpoint?: string): Promise<Relation> {
    const data = await requestJson<{ ok: boolean; relation: Relation }>('/v1/relations', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(relation),
    });
    return data.relation;
  },

  async updateRelation(id: string, relation: Partial<Relation>, endpoint?: string): Promise<Relation> {
    const data = await requestJson<{ ok: boolean; relation: Relation }>(`/v1/relations/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'PUT',
      body: JSON.stringify(relation),
    });
    return data.relation;
  },

  async deleteRelation(id: string, endpoint?: string): Promise<Relation> {
    const data = await requestJson<{ ok: boolean; relation: Relation }>(`/v1/relations/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'DELETE',
    });
    return data.relation;
  },

  async listBusinessProfiles<TPayload = Record<string, unknown>, TAssets = Record<string, unknown>>(
    kind: string,
    endpoint?: string,
  ): Promise<Array<BusinessProfile<TPayload, TAssets>>> {
    const query = new URLSearchParams();
    if (kind) query.set('kind', kind);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await requestJson<{ ok: boolean; profiles: Array<BusinessProfile<TPayload, TAssets>> }>(
      `/v1/business-profiles${suffix}`,
      { endpoint, method: 'GET' },
    );
    return Array.isArray(data.profiles) ? data.profiles : [];
  },

  async saveBusinessProfile<TPayload = Record<string, unknown>, TAssets = Record<string, unknown>>(
    profile: BusinessProfileInput<TPayload, TAssets>,
    endpoint?: string,
  ): Promise<BusinessProfile<TPayload, TAssets>> {
    const data = await requestJson<{ ok: boolean; profile: BusinessProfile<TPayload, TAssets> }>(
      '/v1/business-profiles',
      {
        endpoint,
        method: 'POST',
        body: JSON.stringify(profile),
      },
    );
    return data.profile;
  },

  async deleteBusinessProfile<TPayload = Record<string, unknown>, TAssets = Record<string, unknown>>(
    id: string,
    endpoint?: string,
  ): Promise<BusinessProfile<TPayload, TAssets>> {
    const data = await requestJson<{ ok: boolean; profile: BusinessProfile<TPayload, TAssets> }>(
      `/v1/business-profiles/${encodeURIComponent(id)}`,
      { endpoint, method: 'DELETE' },
    );
    return data.profile;
  },

  async listKnowledge(endpoint?: string): Promise<KnowledgeItem[]> {
    return ((await this.fetchCloudData('/api/knowledge', endpoint || '')) as KnowledgeItem[] | null) || [];
  },

  async listProductAssets(
    endpoint?: string,
    params?: { mainCategory?: string; search?: string; limit?: number; offset?: number },
  ): Promise<ProductAssetDetail[]> {
    const page = await this.listProductAssetsPage(endpoint, params);
    return page.assets;
  },

  async listProductAssetsPage(
    endpoint?: string,
    params?: { mainCategory?: string; search?: string; limit?: number; offset?: number },
  ): Promise<ProductAssetPage> {
    const query = new URLSearchParams();
    if (params?.mainCategory) query.set('mainCategory', params.mainCategory);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await requestJson<{ ok: boolean; assets: ProductAssetDetail[] }>(`/v1/products/assets${suffix}`, {
      endpoint,
      method: 'GET',
    });
    const assets = Array.isArray(data.assets) ? data.assets : [];
    return {
      assets,
      total: Number((data as any).total ?? assets.length),
      limit: Number((data as any).limit ?? params?.limit ?? assets.length),
      offset: Number((data as any).offset ?? params?.offset ?? 0),
      hasMore: Boolean((data as any).hasMore),
    };
  },

  async listAllProductAssets(
    endpoint?: string,
    params?: { mainCategory?: string; search?: string; pageSize?: number },
  ): Promise<ProductAssetDetail[]> {
    const pageSize = Math.min(Math.max(params?.pageSize || 500, 1), 500);
    const all: ProductAssetDetail[] = [];
    let offset = 0;
    for (let page = 0; page < 200; page += 1) {
      const result = await this.listProductAssetsPage(endpoint, {
        mainCategory: params?.mainCategory,
        search: params?.search,
        limit: pageSize,
        offset,
      });
      all.push(...result.assets);
      if (!result.hasMore || result.assets.length === 0) break;
      offset += result.assets.length;
    }
    return all;
  },

  async getProductAsset(id: string, endpoint?: string): Promise<ProductAssetDetail> {
    const data = await requestJson<{ ok: boolean; asset: ProductAssetDetail }>(
      `/v1/products/assets/${encodeURIComponent(id)}`,
      { endpoint, method: 'GET' },
    );
    return data.asset;
  },

  async createProductAsset(input: CreateProductAssetInput, endpoint?: string): Promise<ProductAssetDetail> {
    const data = await requestJson<{ ok: boolean; asset: ProductAssetDetail }>('/v1/products/assets', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(input),
    });
    return data.asset;
  },

  async updateProductAsset(id: string, input: Record<string, any>, endpoint?: string): Promise<ProductAssetDetail> {
    const data = await requestJson<{ ok: boolean; asset: ProductAssetDetail }>(
      `/v1/products/assets/${encodeURIComponent(id)}`,
      { endpoint, method: 'PATCH', body: JSON.stringify(input) },
    );
    return data.asset;
  },

  async deleteProductAsset(id: string, endpoint?: string): Promise<{ ok: boolean; deleted: string }> {
    const data = await requestJson<{ ok: boolean; deleted: string }>(
      `/v1/products/assets/${encodeURIComponent(id)}`,
      { endpoint, method: 'DELETE' },
    );
    return data;
  },

  async listProducts(endpoint?: string): Promise<ProductAsset[]> {
    try {
      const assets = await this.listAllProductAssets(endpoint, { pageSize: 500 });
      if (assets.length > 0) return assets;
      const legacy = await this.fetchCloudData('/api/products', endpoint || '') as ProductAsset[];
      return Array.isArray(legacy) && legacy.length > 0 ? legacy : assets;
    } catch (error) {
      console.warn('[DataHub] v1 products API unavailable, falling back to legacy sync route:', error);
      const legacy = await this.fetchCloudData('/api/products', endpoint || '') as ProductAsset[];
      if (Array.isArray(legacy) && legacy.length > 0) return legacy;
      throw error;
    }
  },

  // ========== Product Images ==========

  async uploadProductImages(productId: string, files: File[], endpoint?: string): Promise<ProductImage[]> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    const url = buildApiUrl(`/v1/products/assets/${encodeURIComponent(productId)}/images`, endpoint);
    const apiKey = getApiKey();
    const headers: Record<string, string> = {};
    if (apiKey) headers['X-Bambook-API-Key'] = apiKey;
    // Note: do NOT set Content-Type for FormData — browser sets it with boundary

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
    return data.images;
  },

  async deleteProductImage(productId: string, imageId: string, endpoint?: string): Promise<void> {
    await requestJson(`/v1/products/assets/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`, {
      endpoint,
      method: 'DELETE',
    });
  },

  async setProductImagePrimary(productId: string, imageId: string, endpoint?: string): Promise<void> {
    await requestJson(`/v1/products/assets/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/primary`, {
      endpoint,
      method: 'PATCH',
    });
  },

  async reorderProductImages(productId: string, orders: Array<{ id: string; sortOrder: number }>, endpoint?: string): Promise<void> {
    await requestJson(`/v1/products/assets/${encodeURIComponent(productId)}/images/reorder`, {
      endpoint,
      method: 'PATCH',
      body: JSON.stringify({ orders }),
    });
  },

  getProductImageUrl(filePath: string): string {
    return buildApiUrl(`/uploads/${filePath}`);
  },

  // ========== System Assets ==========

  async listSystemAssets(kind: 'wallpaper' = 'wallpaper', endpoint?: string, includeHidden = false): Promise<SystemAsset[]> {
    const suffix = `?kind=${encodeURIComponent(kind)}${includeHidden ? '&includeHidden=true' : ''}`;
    const data = await requestJson<{ ok: boolean; assets: SystemAsset[] }>(`/v1/system-assets${suffix}`, { endpoint });
    return Array.isArray(data.assets) ? data.assets : [];
  },

  async uploadSystemWallpaper(
    input: { id?: string; title: string; group: string; sortOrder?: number; hidden?: boolean; file?: File },
    endpoint?: string,
  ): Promise<SystemAsset> {
    const formData = new FormData();
    if (input.id) formData.append('id', input.id);
    formData.append('title', input.title);
    formData.append('group', input.group);
    formData.append('sortOrder', String(input.sortOrder ?? 0));
    formData.append('hidden', String(Boolean(input.hidden)));
    if (input.file) formData.append('file', input.file);

    const apiKey = getApiKey();
    const headers: Record<string, string> = {};
    if (apiKey) headers['X-Bambook-API-Key'] = apiKey;

    const response = await fetch(buildApiUrl('/v1/system-assets/wallpapers', endpoint), {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
    return data.asset;
  },

  async updateSystemAsset(id: string, patch: Partial<Pick<SystemAsset, 'title' | 'group' | 'sortOrder' | 'hidden' | 'metadata'>>, endpoint?: string): Promise<SystemAsset> {
    const data = await requestJson<{ ok: boolean; asset: SystemAsset }>(`/v1/system-assets/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return data.asset;
  },

  async deleteSystemAsset(id: string, endpoint?: string): Promise<void> {
    await requestJson(`/v1/system-assets/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'DELETE',
    });
  },

  getSystemAssetFileUrl(asset: Pick<SystemAsset, 'id' | 'fileUrl'>, endpoint?: string): string {
    return buildApiUrl(asset.fileUrl || `/v1/system-assets/${encodeURIComponent(asset.id)}/file`, endpoint);
  },

  async listProductCategories(endpoint?: string): Promise<ProductSubCategory[]> {
    return ((await this.fetchCloudData('/api/product-categories', endpoint || '')) as ProductSubCategory[] | null) || [];
  },

  async saveProductCategory(category: ProductSubCategory, endpoint?: string): Promise<void> {
    const ok = await this.postCloudData('/api/product-categories', endpoint || '', category);
    if (!ok) throw new Error('产品分类写入数据中心失败');
  },

  async deleteProductCategory(category: ProductSubCategory, endpoint?: string): Promise<void> {
    await this.saveProductCategory({ ...category, deletedAt: category.deletedAt || Date.now() }, endpoint);
  },

  async listPdmlRawFabrics(
    endpoint?: string,
    params?: { limit?: number; offset?: number; search?: string; gsid?: string },
  ): Promise<{ fabrics: PdmlRawFabric[]; total: number; limit: number; offset: number; hasMore: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.search) query.set('search', params.search);
    if (params?.gsid) query.set('gsid', params.gsid);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await requestJson<{ ok: boolean; fabrics: PdmlRawFabric[]; total?: number; limit?: number; offset?: number; hasMore?: boolean }>(`/v1/pdml/raw${suffix}`, {
      endpoint,
      method: 'GET',
    });
    const fabrics = Array.isArray(data.fabrics) ? data.fabrics : [];
    return {
      fabrics,
      total: Number(data.total ?? fabrics.length),
      limit: Number(data.limit ?? params?.limit ?? fabrics.length),
      offset: Number(data.offset ?? params?.offset ?? 0),
      hasMore: Boolean(data.hasMore),
    };
  },

  async listAllPdmlRawFabrics(
    endpoint?: string,
    params?: { search?: string; gsid?: string; pageSize?: number },
  ): Promise<{ fabrics: PdmlRawFabric[]; total: number; syncedAt: number | null }> {
    const pageSize = Math.min(Math.max(params?.pageSize || 500, 1), 500);
    const all: PdmlRawFabric[] = [];
    let offset = 0;
    let total = 0;
    for (let page = 0; page < 200; page += 1) {
      const result = await this.listPdmlRawFabrics(endpoint, {
        limit: pageSize,
        offset,
        search: params?.search,
        gsid: params?.gsid,
      });
      total = result.total;
      all.push(...result.fabrics);
      if (!result.hasMore || result.fabrics.length === 0) break;
      offset += result.fabrics.length;
    }
    return {
      fabrics: all,
      total,
      syncedAt: all[0]?.syncedAt || null,
    };
  },

  async startPdmlRawSync(
    endpoint?: string,
    params?: { limit?: number; pageSize?: number; gsid?: string },
  ): Promise<PdmlSyncJob> {
    return requestJson<PdmlSyncJob>('/v1/pdml/sync', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async getPdmlRawSyncJob(endpoint: string | undefined, jobId: string): Promise<PdmlSyncJob> {
    return requestJson<PdmlSyncJob>(`/v1/pdml/sync/${encodeURIComponent(jobId)}`, {
      endpoint,
      method: 'GET',
    });
  },

  async syncPdmlRawFabrics(
    endpoint?: string,
    params?: { limit?: number; pageSize?: number; gsid?: string; blocking?: boolean },
  ): Promise<PdmlSyncResult> {
    const body = { ...(params || {}), blocking: params?.blocking ?? true };
    return requestJson<PdmlSyncResult>('/v1/pdml/sync', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async mapPdmlRawFabricsToProducts(
    endpoint?: string,
    params?: { limit?: number; offset?: number; gsid?: string },
  ): Promise<PdmlMapResult> {
    return requestJson<PdmlMapResult>('/v1/pdml/map-products', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async listInsights(endpoint?: string): Promise<Insight[]> {
    return ((await this.fetchCloudData('/api/insights', endpoint || '')) as Insight[] | null) || [];
  },

  // ========== ERP 知识文档（Prisma 真源） ==========

  async listKnowledgeDocuments(endpoint?: string): Promise<KnowledgeDocumentRecord[]> {
    const data = await requestJson<{ ok: boolean; documents: KnowledgeDocumentRecord[] }>('/v1/knowledge-documents', {
      endpoint,
      method: 'GET',
    });
    return Array.isArray(data.documents) ? data.documents.filter(d => d.origin === 'erp') : [];
  },

  async ingestKnowledgeText(input: { title: string; text: string; category: string }, endpoint?: string): Promise<{ documentId: string; checksum: string; chunkCount: number; auditId: string }> {
    return requestJson('/v1/knowledge-documents/ingest-text', {
      endpoint,
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        text: input.text,
        sourceType: 'manual',
        scopes: ['company'],
        metadata: { category: input.category },
      }),
    });
  },

  async updateKnowledgeDocument(
    id: string,
    input: { title?: string; text?: string; category?: string },
    endpoint?: string,
  ): Promise<{ documentId: string; version: number; updatedAt: number }> {
    return requestJson(`/v1/knowledge-documents/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteKnowledgeDocument(id: string, endpoint?: string): Promise<{ documentId: string }> {
    return requestJson(`/v1/knowledge-documents/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'DELETE',
    });
  },

  // ========== PO 订单数据库 ==========

  // [DELETED] getPOOrders, getPOOrderDetail, searchPOOrders, getPOItems,
  // getPOCustomers, importPOPdfs — all migrated to /api/v1/orders.

  // ========== 发货通知 ==========

  async generateShippingNotice(data: {
    poNumbers: string[];
    options?: {
      contractNo?: string;
      supplier?: string;
      destinationPort?: string;
      shipmentDate?: string;
      paymentTerms?: string;
      forwarder?: string;
      remarks?: string;
    };
  }): Promise<{
    success: boolean;
    filename?: string;
    downloadUrl?: string;
    data?: any;
    error?: string;
  }> {
    return postData(`${getDynamicApiBaseUrl()}/shipping-notice/generate`, data);
  },

  // 下载发货通知文件
  getShippingNoticeDownloadUrl(filename: string): string {
    const url = new URL(buildApiUrl('/shipping-notice/download'), window.location.origin);
    url.searchParams.set('file', filename);
    const apiKey = getApiKey();
    if (apiKey) url.searchParams.set('apiKey', apiKey);
    return url.toString();
  },

  // ── Notifications ──
  async listNotifications(params: { unreadOnly?: boolean; type?: string; level?: string; limit?: number; offset?: number; endpoint?: string }): Promise<{ items: NotificationItem[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params.unreadOnly) searchParams.set('unreadOnly', 'true');
    if (params.type) searchParams.set('type', params.type);
    if (params.level) searchParams.set('level', params.level);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return requestJson<{ items: NotificationItem[]; total: number }>(`/v1/notifications${query ? `?${query}` : ''}`, { endpoint: params.endpoint, method: 'GET' });
  },

  async getNotificationStats(endpoint?: string): Promise<NotificationStats> {
    return requestJson<NotificationStats>('/v1/notifications/stats', { endpoint, method: 'GET' });
  },

  async markNotificationAsRead(notificationId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/notifications/${encodeURIComponent(notificationId)}/read`, { endpoint, method: 'POST' });
  },

  async markAllNotificationsAsRead(endpoint?: string): Promise<{ count: number }> {
    const data = await requestJson<{ ok: boolean; count: number }>('/v1/notifications/read-all', { endpoint, method: 'POST' });
    return { count: data.count || 0 };
  },

  async deleteNotification(notificationId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/notifications/${encodeURIComponent(notificationId)}`, { endpoint, method: 'DELETE' });
  },

  // ── 自动化规则 ──
  async listAutomationRules(endpoint?: string): Promise<AutomationRule[]> {
    const data = await requestJson<{ rules: AutomationRule[] }>('/v1/automation/rules', { endpoint, method: 'GET' });
    return data.rules || [];
  },

  async updateAutomationRule(ruleId: string, enabled: boolean, endpoint?: string): Promise<AutomationRule> {
    return requestJson<{ rule: AutomationRule }>(`/v1/automation/rules/${encodeURIComponent(ruleId)}`, {
      endpoint,
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }).then(data => data.rule);
  }
};
