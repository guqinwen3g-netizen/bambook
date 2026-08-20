
import {
  KnowledgeItem,
  SopTemplate,
  SopStep,
  KnowledgeRelationView,
  EntityLinkView,
  KnowledgeCitation,
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
  Quotation,
  QuotationInput,
  HistoricalQuotationImportRow,
  QuotationImportResult,
  BrandLine,
  BrandLineInput,
  CommunicationLog,
  CommunicationLogInput,
  EmailSignature,
  EmailSignatureInput,
  DocumentTemplate,
  DocumentTemplateInput,
  PurchaseOrder,
  PurchaseOrderInput,
  MaterialReceipt,
  MaterialReceiptInput,
  Warehouse,
  WarehouseInput,
  InventoryItem,
  InventoryItemInput,
  StockMovement,
  StockMovementInput,
  BOM,
  CreateBOMInput,
  UpdateBOMInput,
  Shipment,
  DocumentSetData,
  EntityAuditLogItem,
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
  NotificationTypeCatalogItem,
  ApprovalRequestItem,
  ApprovalRequestStatus,
  AutomationRule,
  WorkflowDefinition,
  WorkflowInstance,
  // CRM
  Contact,
  ContactInput,
  CreditLimit,
  CreditLimitInput,
  FollowUpRecord,
  FollowUpInput,
  Opportunity,
  OpportunityInput,
  CustomerTier,
  CustomerTierInput,
  CrmOverview,
  // 供应商管理（阶段 H H1）
  FactoryProfile,
  FactoryProfileInput,
  FactoryProfilePatch,
  FactoryEvaluation,
  FactoryEvaluationInput,
  FactoryCertification,
  FactoryCertificationInput,
  FactoryCapacity,
  FactoryOverview,
  // 季节性与趋势管理（阶段 H H2）
  Season,
  SeasonInput,
  SeasonPatch,
  SeasonReview,
  TrendTag,
  TrendTagInput,
  TrendTagPatch,
  TrendTagFabricLink,
  TrendingFabricItem,
  TradeShow,
  TradeShowInput,
  TradeShowPatch,
  TradeShowROI,
  TradeShowLead,
  TradeShowLeadInput,
  TradeShowLeadPatch,
  // 风险管理与合规（阶段 H H3）
  RiskAlert,
  RiskAlertStatus,
  RiskOverview,
  ExchangeRate,
  ExchangeRateInput,
  LatestFxRate,
  FxRateLock,
  FxRateLockInput,
  CreditRating,
  ComplianceCheck,
  ComplianceCheckInput,
  DefectTrendItem,
  // QC 工作台 + 驻地管理 + 业务线配置（阶段 P0）
  BusinessLine,
  BusinessLineInput,
  BusinessLinePatch,
  QCLocation,
  QCLocationInput,
  QCLocationPatch,
  QCAssignment,
  QCAssignmentInput,
  QCAssignmentPatch,
  QcWorkbenchData,
  QcMoqCheckResult,
  UserAccountOption,
  // MES
  WorkStation,
  WorkStationInput,
  WorkStationUtilization,
  ProductionPlan,
  ProductionPlanInput,
  ProductionPlanStatus,
  WorkHour,
  WorkHourInput,
  WorkHourSummary,
  PieceRateRule,
  PieceRateRuleInput,
  PieceRateRecord,
  PieceRateRecordInput,
  PieceRateStatus,
  PieceRateSummary,
  OutsourcingOrder,
  OutsourcingOrderInput,
  OrderProcessNodeRow,
  OrderProcessChainSummary,
  TcCertificateRow,
  TcStageSummary,
  TcChainVerification,
  TcStage,
  OutsourcingStatus,
  // Customs
  CustomsType,
  CustomsDeclaration,
  CustomsDeclarationInput,
  CustomsDeclarationLine,
  CustomsDeclarationLineInput,
  CustomsDeclarationStatus,
  HsCode,
  HsCodeInput,
  HsCodeCategory,
  LetterOfCredit,
  LetterOfCreditInput,
  LetterOfCreditType,
  LetterOfCreditStatus,
  LcEvent,
  TaxRefund,
  TaxRefundInput,
  TaxRefundReviewInput,
  TaxRefundStatus,
  TradeDocument,
  TradeDocumentInput,
  TradeDocumentType,
  TradeDocumentStatus,
  DocumentVersionRecord,
  GenerateTradeDocumentsResult,
  TradeDocumentPackItem,
  CustomsOverview,
  // Finance Reports (Phase B2)
  AgingReport,
  CashCalendarReport,
  CustomerStatement,
  SupplierStatement,
  FxGainLossReport,
  BusinessCockpit,
  // 定价与利润（阶段 P1）
  TaxRefundRate,
  TaxRefundRateInput,
  TaxRefundRatePatch,
  TrackBInput,
  TrackBResult,
  TrackAInput,
  TrackAResult,
  PricingCalculation,
  PricingCalculationInput,
  PricingCalculationPatch,
  OrderProfitSheet,
  MaterialPriceHistory,
  MaterialPriceInput,
  MaterialPricePatch,
  MaterialPriceTrendPoint,
  // 营销工具（阶段 P2）
  CommissionRule,
  CommissionRuleInput,
  CommissionRulePatch,
  LookbookCatalog,
  LookbookItemInput,
  FabricRecommendation,
  RecommendCriteria,
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
  // 本地 Web dev（VITE_API_BASE_URL 相对基座，如 '/api'）为硬路由，
  // 优先于调用方显式传入的 endpoint（默认为生产 cloudEndpoint）——
  // 与 authService.getAuthApiBase 的 env 优先级语义对齐，避免
  // 「登录走本地、业务数据却写往生产」的割裂路由。
  const envBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (envBase.startsWith('/')) return envBase.replace(/\/$/, '');
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

/** JWT 头（写操作需 JWT 的路由使用，如 email-signatures；token 取自登录态存储） */
const jwtAuthHeaders = (): Record<string, string> => {
  try {
    const token = localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

/**
 * requestJson 默认超时（ms）：弱网/服务无响应时避免界面无限挂起。
 * 大文件上传/流式（SSE/TTS）走独立 fetch 不经此入口；批量导入等长操作调用方传 timeoutMs 覆盖。
 */
const REQUEST_JSON_DEFAULT_TIMEOUT_MS = 30_000;

const requestJson = async <T>(path: string, opts: RequestInit & { endpoint?: string; timeoutMs?: number } = {}): Promise<T> => {
  const { endpoint, headers, timeoutMs = REQUEST_JSON_DEFAULT_TIMEOUT_MS, signal, ...init } = opts;
  // 已登录会话携带 JWT：后端写操作审计（AuditLog.actorId 外键）要求真实用户身份，
  // 仅 API key 时 actor 回退 'system' 会触发外键冲突；JWT 优先于 API key。
  //
  // 超时治理：调用方自带 signal（可取消操作）时不叠加超时；timeoutMs <= 0 显式关闭。
  // 优先 AbortSignal.timeout（原生实现不阻塞事件循环）；缺失环境回退 controller+timer（finally 清理）。
  let timeoutSignal: AbortSignal | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  if (!signal && timeoutMs > 0) {
    if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
      timeoutSignal = (AbortSignal as any).timeout(timeoutMs) as AbortSignal;
    } else {
      const controller = new AbortController();
      timeoutTimer = setTimeout(() => {
        try {
          controller.abort(new DOMException(`timeout after ${timeoutMs}ms`, 'TimeoutError'));
        } catch {
          controller.abort();
        }
      }, timeoutMs);
      timeoutSignal = controller.signal;
    }
  }
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path, endpoint), {
      ...init,
      signal: signal ?? timeoutSignal ?? undefined,
      headers: {
        ...jsonHeaders(),
        ...jwtAuthHeaders(),
        ...(headers || {}),
      },
    });
  } catch (e: any) {
    // 超时：本入口自建的超时 signal 已中止，或原生 TimeoutError → 语义化超时错误
    if (timeoutSignal?.aborted || e?.name === 'TimeoutError') {
      throw Object.assign(
        new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）：服务器无响应或网络不稳定，请稍后重试`),
        { code: 'REQUEST_TIMEOUT' },
      );
    }
    // 调用方主动取消：保持原语义上抛，不吞掉 AbortError
    if (e?.name === 'AbortError') throw e;
    // 其余传输层失败（DNS/断网/证书）→ 语义化网络错误
    throw Object.assign(
      new Error('网络请求失败：无法连接到服务器，请检查网络连接或服务地址配置'),
      { code: 'NETWORK_ERROR', cause: e },
    );
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const serverMessage = data?.message || (typeof data?.error === 'string' ? data.error : data?.error?.message);
    throw new Error(serverMessage || `HTTP ${response.status}`);
  }
  return data as T;
};

/** HR 模块统一通道：复用 requestJson 的 endpoint 解析 / API key / 错误信封；JWT Bearer 优先，无 token 时回退 cookie 会话。 */
const hrRequest = async <T>(path: string, opts: RequestInit & { endpoint?: string } = {}): Promise<T> => {
  const token = localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token');
  return requestJson<T>(`/hr/${path.replace(/^\/+/, '')}`, {
    ...opts,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    credentials: token ? 'omit' : 'include',
  });
};

/** 用户目录选项（/api/hr/personnel 聚合视图）：在 UserAccountOption 之上透出角色快照，供审批委派等选人控件展示 */
export interface UserAccountDirectoryOption extends UserAccountOption {
  roles?: string[] | null;
}

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

// ── 平台配置：公司档案（W7 设置域 §1A 裁决）类型契约：对齐 server/src/config/systemConfigRoute.ts ──
export interface CompanyExporterProfileValue {
  /** 公司英文名（单据抬头，必填） */
  nameEn: string;
  beneficiary?: string;
  addressEn?: string;
  bankName?: string;
  swiftCode?: string;
  bankAddress?: string;
  usdAccountNumber?: string;
}

export interface CompanyExporterProfileResponse {
  ok: boolean;
  key: string;
  value: CompanyExporterProfileValue;
  version: number;
  /** true = 服务端未配置，返回代码默认值（未落库） */
  isDefault: boolean;
  updatedAt?: number;
  updatedBy?: string | null;
}

export interface CompanyExporterProfileUpdateResponse {
  ok: boolean;
  key: string;
  value: CompanyExporterProfileValue;
  version: number;
  updatedAt: number;
}

export interface CompanyExporterProfileHistoryItem {
  id: string;
  configId: string;
  versionFrom: number;
  versionTo: number;
  valueFrom: CompanyExporterProfileValue | null;
  valueTo: CompanyExporterProfileValue | null;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

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
  /** 统一认证头：Content-Type + API key + 登录会话 JWT（写操作必需，后端审计/角色校验依赖真实用户身份） */
  getAuthHeaders: (): Record<string, string> => ({ ...jsonHeaders(), ...jwtAuthHeaders() }),

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

  /**
   * 订阅实时通知 SSE 事件（Phase 0 Sprint 1 通知系统实时链路）
   *
   * 后端 publishNotificationEvent 推送 `event: notification` SSE 事件，
   * 前端收到后增量更新未读徽章 + 抽屉列表，无需等待 30s 轮询。
   *
   * 返回 cleanup 函数，组件卸载时调用以关闭 EventSource。
   */
  subscribeToNotifications(endpoint: string | undefined, onNotification: (event: { type: string; title: string; body: string; level: string; link?: string; eventId: string; eventType: string; orderId?: string; recipientIds: string[]; timestamp: number }) => void): () => void {
    if (typeof EventSource === 'undefined') return () => {};
    const apiKey = getApiKey();
    const url = new URL(buildApiUrl('/v1/events', endpoint), window.location.origin);
    if (apiKey) url.searchParams.set('apiKey', apiKey);

    const source = new EventSource(url.toString());
    source.addEventListener('notification', (event) => {
      try {
        onNotification(JSON.parse((event as MessageEvent).data));
      } catch (error) {
        console.warn('[NotificationCenter] ignored malformed notification event:', error);
      }
    });
    source.onerror = () => {
      console.warn('[NotificationCenter] realtime stream disconnected; browser will retry automatically');
    };
    return () => source.close();
  },

  /**
   * 订单列表（V2 行级口径，DR-042 v2.2 L2 换锚）：可见性锚 = 宿主客户的跟进人 ∪ 团队共享 ∪ 管理角色。
   * 旧 V1 端点无行级过滤，已切换至 V2；客户转让后历史订单视野自动继承。
   */
  async listOrders(endpoint?: string): Promise<Order[]> {
    const data = await requestJson<{ ok: boolean; items: Order[]; total: number }>('/v2/orders?limit=500', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async getOrderTimeline(orderId: string, endpoint?: string): Promise<OrderStatusTransition[]> {
    const data = await requestJson<{ ok: boolean; timeline?: OrderStatusTransition[] }>(`/v1/orders/${encodeURIComponent(orderId)}/timeline`, { endpoint, method: 'GET' });
    return Array.isArray(data.timeline) ? data.timeline : [];
  },

  async transitionOrderStatus(orderId: string, toStatus: string, operator: string, note?: string, endpoint?: string): Promise<Order> {
    const data = await requestJson<{ ok: boolean; order?: Order; error?: { message?: string } }>(`/v1/orders/${encodeURIComponent(orderId)}/status-transition`, {
      endpoint,
      method: 'POST',
      headers: jwtAuthHeaders(),
      body: JSON.stringify({ toStatus, operator, ...(note ? { note } : {}) }),
    });
    if (!data.ok || !data.order) throw new Error(data.error?.message || '状态变更失败');
    return data.order;
  },

  async deleteOrderRemote(orderId: string, endpoint?: string): Promise<Order> {
    const data = await requestJson<{ ok: boolean; order?: Order; error?: { message?: string } }>(`/v1/orders/${encodeURIComponent(orderId)}`, {
      endpoint,
      method: 'DELETE',
      headers: jwtAuthHeaders(),
    });
    if (!data.ok || !data.order) throw new Error(data.error?.message || '订单删除失败');
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

  // ── Phase B2: 财务报表 API（账龄 / 对账单 / 汇率损益，只读）──
  async getAgingReport(type: 'Receivable' | 'Payable', asOf?: string, endpoint?: string): Promise<AgingReport> {
    const query = new URLSearchParams({ type });
    if (asOf) query.set('asOf', asOf);
    return requestJson<AgingReport>(`/v1/finance/reports/aging?${query.toString()}`, { endpoint, method: 'GET' });
  },

  /** REQ2-02 资金日历与 30 天现金流预测（DR-044 净额口径） */
  async getCashCalendar(params: { asOf?: string; days?: number } = {}, endpoint?: string): Promise<CashCalendarReport> {
    const query = new URLSearchParams();
    if (params.asOf) query.set('asOf', params.asOf);
    if (params.days) query.set('days', String(params.days));
    const qs = query.toString();
    return requestJson<CashCalendarReport>(`/v1/finance/reports/cash-calendar${qs ? `?${qs}` : ''}`, { endpoint, method: 'GET' });
  },

  async getCustomerStatement(params: { customerRelationId: string; from?: string; to?: string }, endpoint?: string): Promise<CustomerStatement> {
    const query = new URLSearchParams({ customerRelationId: params.customerRelationId });
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    return requestJson<CustomerStatement>(`/v1/finance/reports/statement?${query.toString()}`, { endpoint, method: 'GET' });
  },

  async getSupplierStatement(params: { supplierRelationId: string; from?: string; to?: string }, endpoint?: string): Promise<SupplierStatement> {
    const query = new URLSearchParams({ supplierRelationId: params.supplierRelationId });
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    return requestJson<SupplierStatement>(`/v1/finance/reports/supplier-statement?${query.toString()}`, { endpoint, method: 'GET' });
  },

  async getFxGainLoss(params?: { from?: string; to?: string }, endpoint?: string): Promise<FxGainLossReport> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return requestJson<FxGainLossReport>(`/v1/finance/reports/fx-gain-loss${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  // ── Phase C1: 经营驾驶舱 API（只读聚合）──
  async getBusinessCockpit(params?: { from?: string; to?: string; marginRowLimit?: number }, endpoint?: string): Promise<BusinessCockpit> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.marginRowLimit) query.set('marginRowLimit', String(params.marginRowLimit));
    const qs = query.toString();
    return requestJson<BusinessCockpit>(`/v1/dashboard/cockpit${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  async listShipments(endpoint?: string): Promise<Shipment[]> {
    const data = await requestJson<{ items: Shipment[]; total: number }>('/v1/shipping', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  /** 出运制单数据装配（CI/PL/CO/BL 成套生成数据源，只读） */
  async getShipmentDocumentSet(shipmentId: string, endpoint?: string): Promise<DocumentSetData> {
    return requestJson<DocumentSetData>(`/v1/shipping/${encodeURIComponent(shipmentId)}/document-set`, { endpoint, method: 'GET' });
  },

  /** 阶段 D / D6：实体级审计历史（模块读权限门禁，最近 20 条倒序） */
  async getEntityAuditLogs(targetType: string, targetId: string, endpoint?: string): Promise<EntityAuditLogItem[]> {
    const query = new URLSearchParams({ targetType, targetId });
    const data = await requestJson<{ ok: boolean; logs: EntityAuditLogItem[] }>(`/v1/audit/entity?${query.toString()}`, { endpoint, method: 'GET' });
    return Array.isArray(data.logs) ? data.logs : [];
  },

  // ── Phase 2: 报价管理 API ──
  async listQuotations(params?: { status?: string; customerRelationId?: string; search?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: Quotation[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.customerRelationId) query.set('customerRelationId', params.customerRelationId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const path = `/v1/quotations${qs ? '?' + qs : ''}`;
    return requestJson<{ items: Quotation[]; total: number }>(path, { endpoint, method: 'GET' });
  },

  async getQuotation(id: string, endpoint?: string): Promise<Quotation | null> {
    try {
      const data = await requestJson<{ quotation: Quotation }>(`/v1/quotations/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.quotation;
    } catch { return null; }
  },

  async createQuotation(input: QuotationInput, endpoint?: string): Promise<Quotation> {
    const data = await requestJson<{ quotation: Quotation }>('/v1/quotations', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.quotation;
  },

  async updateQuotation(id: string, input: Partial<QuotationInput>, endpoint?: string): Promise<Quotation> {
    const data = await requestJson<{ quotation: Quotation }>(`/v1/quotations/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.quotation;
  },

  async deleteQuotation(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/quotations/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async sendQuotation(id: string, endpoint?: string): Promise<Quotation> {
    const data = await requestJson<{ quotation: Quotation }>(`/v1/quotations/${encodeURIComponent(id)}/send`, { endpoint, method: 'POST' });
    return data.quotation;
  },

  async acceptQuotation(id: string, note?: string, endpoint?: string): Promise<Quotation> {
    const data = await requestJson<{ quotation: Quotation }>(`/v1/quotations/${encodeURIComponent(id)}/accept`, { endpoint, method: 'POST', body: JSON.stringify({ note }) });
    return data.quotation;
  },

  async rejectQuotation(id: string, note?: string, endpoint?: string): Promise<Quotation> {
    const data = await requestJson<{ quotation: Quotation }>(`/v1/quotations/${encodeURIComponent(id)}/reject`, { endpoint, method: 'POST', body: JSON.stringify({ note }) });
    return data.quotation;
  },

  async convertQuotationToOrder(id: string, overrides?: { poNumber?: string; millName?: string; type?: string; dueDate?: string }, endpoint?: string): Promise<{ orderId: string; quotation: Quotation }> {
    const data = await requestJson<{ orderId: string; quotation: Quotation }>(`/v1/quotations/${encodeURIComponent(id)}/convert-to-order`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify(overrides || {}),
    });
    return data;
  },

  // ── 阶段 P3c：历史报价导入（PRD 16.1；preview 只校验，commit 导入合法行）──
  async importHistoricalQuotations(rows: HistoricalQuotationImportRow[], mode: 'preview' | 'commit', endpoint?: string): Promise<QuotationImportResult> {
    return requestJson<QuotationImportResult>('/v1/quotations/import', {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ rows, mode }),
      // commit 模式逐行落库（历史报价批量导入可能数百行），放宽超时；preview 只解析用默认值
      timeoutMs: mode === 'commit' ? 120_000 : 30_000,
    });
  },

  // ── Phase 2 B1: 采购管理 API ──
  async listPurchaseOrders(params?: { status?: string; supplierRelationId?: string; dateFrom?: string; dateTo?: string; search?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: PurchaseOrder[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.supplierRelationId) query.set('supplierRelationId', params.supplierRelationId);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.search) query.set('search', params.search);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const path = `/v1/procurement${qs ? '?' + qs : ''}`;
    return requestJson<{ items: PurchaseOrder[]; total: number }>(path, { endpoint, method: 'GET' });
  },

  async getPurchaseOrder(id: string, endpoint?: string): Promise<PurchaseOrder | null> {
    try {
      const data = await requestJson<{ purchaseOrder: PurchaseOrder }>(`/v1/procurement/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.purchaseOrder;
    } catch { return null; }
  },

  async createPurchaseOrder(input: PurchaseOrderInput, endpoint?: string): Promise<PurchaseOrder> {
    const data = await requestJson<{ purchaseOrder: PurchaseOrder }>('/v1/procurement', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.purchaseOrder;
  },

  async updatePurchaseOrder(id: string, input: Partial<PurchaseOrderInput>, endpoint?: string): Promise<PurchaseOrder> {
    const data = await requestJson<{ purchaseOrder: PurchaseOrder }>(`/v1/procurement/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.purchaseOrder;
  },

  async deletePurchaseOrder(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/procurement/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async sendPurchaseOrder(id: string, endpoint?: string): Promise<PurchaseOrder> {
    const data = await requestJson<{ purchaseOrder: PurchaseOrder }>(`/v1/procurement/${encodeURIComponent(id)}/send`, { endpoint, method: 'POST' });
    return data.purchaseOrder;
  },

  async confirmPurchaseOrder(id: string, endpoint?: string): Promise<PurchaseOrder> {
    const data = await requestJson<{ purchaseOrder: PurchaseOrder }>(`/v1/procurement/${encodeURIComponent(id)}/confirm`, { endpoint, method: 'POST' });
    return data.purchaseOrder;
  },

  async cancelPurchaseOrder(id: string, reason?: string, endpoint?: string): Promise<PurchaseOrder> {
    const data = await requestJson<{ purchaseOrder: PurchaseOrder }>(`/v1/procurement/${encodeURIComponent(id)}/cancel`, { endpoint, method: 'POST', body: JSON.stringify({ reason }) });
    return data.purchaseOrder;
  },

  async closePurchaseOrder(id: string, endpoint?: string): Promise<PurchaseOrder> {
    const data = await requestJson<{ purchaseOrder: PurchaseOrder }>(`/v1/procurement/${encodeURIComponent(id)}/close`, { endpoint, method: 'POST' });
    return data.purchaseOrder;
  },

  async listMaterialReceipts(purchaseOrderId: string, endpoint?: string): Promise<MaterialReceipt[]> {
    const data = await requestJson<{ receipts: MaterialReceipt[] }>(`/v1/procurement/${encodeURIComponent(purchaseOrderId)}/receipts`, { endpoint, method: 'GET' });
    return Array.isArray(data.receipts) ? data.receipts : [];
  },

  async createMaterialReceipt(purchaseOrderId: string, input: MaterialReceiptInput, endpoint?: string): Promise<MaterialReceipt> {
    const data = await requestJson<{ receipt: MaterialReceipt }>(`/v1/procurement/${encodeURIComponent(purchaseOrderId)}/receipts`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.receipt;
  },

  // ── Phase 2 B2: 库存管理 API ──
  async listWarehouses(includeInactive = false, endpoint?: string): Promise<Warehouse[]> {
    const data = await requestJson<{ warehouses: Warehouse[] }>(`/v1/inventory/warehouses${includeInactive ? '?includeInactive=true' : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.warehouses) ? data.warehouses : [];
  },

  async createWarehouse(input: WarehouseInput, endpoint?: string): Promise<Warehouse> {
    const data = await requestJson<{ warehouse: Warehouse }>('/v1/inventory/warehouses', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.warehouse;
  },

  async updateWarehouse(id: string, input: Partial<WarehouseInput>, endpoint?: string): Promise<Warehouse> {
    const data = await requestJson<{ warehouse: Warehouse }>(`/v1/inventory/warehouses/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.warehouse;
  },

  async deleteWarehouse(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/inventory/warehouses/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async listInventoryItems(params?: { warehouseId?: string; category?: string; materialCode?: string; search?: string; lowStockOnly?: boolean; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: InventoryItem[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
    if (params?.category) query.set('category', params.category);
    if (params?.materialCode) query.set('materialCode', params.materialCode);
    if (params?.search) query.set('search', params.search);
    if (params?.lowStockOnly) query.set('lowStockOnly', 'true');
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const path = `/v1/inventory/items${qs ? '?' + qs : ''}`;
    return requestJson<{ items: InventoryItem[]; total: number }>(path, { endpoint, method: 'GET' });
  },

  async getInventoryItem(id: string, endpoint?: string): Promise<InventoryItem | null> {
    try {
      const data = await requestJson<{ item: InventoryItem }>(`/v1/inventory/items/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.item;
    } catch { return null; }
  },

  async createInventoryItem(input: InventoryItemInput, endpoint?: string): Promise<InventoryItem> {
    const data = await requestJson<{ item: InventoryItem }>('/v1/inventory/items', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateInventoryItem(id: string, input: Partial<InventoryItemInput>, endpoint?: string): Promise<InventoryItem> {
    const data = await requestJson<{ item: InventoryItem }>(`/v1/inventory/items/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteInventoryItem(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/inventory/items/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async listStockMovements(params?: { itemId?: string; warehouseId?: string; type?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: StockMovement[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.itemId) query.set('itemId', params.itemId);
    if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
    if (params?.type) query.set('type', params.type);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const path = `/v1/inventory/movements${qs ? '?' + qs : ''}`;
    return requestJson<{ items: StockMovement[]; total: number }>(path, { endpoint, method: 'GET' });
  },

  async createStockMovement(input: StockMovementInput, endpoint?: string): Promise<StockMovement> {
    const data = await requestJson<{ movement: StockMovement }>('/v1/inventory/movements', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.movement;
  },

  async getLowStockAlerts(endpoint?: string): Promise<InventoryItem[]> {
    const data = await requestJson<{ items: InventoryItem[]; total: number }>('/v1/inventory/alerts/low-stock', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  // ── Phase 2 B4: BOM / 成本核算 API ──
  async listBOMs(params?: { status?: string; productAssetId?: string; orderId?: string; quotationId?: string; search?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: BOM[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.productAssetId) query.set('productAssetId', params.productAssetId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.quotationId) query.set('quotationId', params.quotationId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const path = `/v1/bom${qs ? '?' + qs : ''}`;
    return requestJson<{ items: BOM[]; total: number }>(path, { endpoint, method: 'GET' });
  },

  async getBOM(id: string, endpoint?: string): Promise<BOM | null> {
    try {
      const data = await requestJson<{ bom: BOM }>(`/v1/bom/${id}`, { endpoint, method: 'GET' });
      return data.bom;
    } catch {
      return null;
    }
  },

  async createBOM(input: CreateBOMInput, endpoint?: string): Promise<BOM> {
    const data = await requestJson<{ bom: BOM }>('/v1/bom', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.bom;
  },

  async updateBOM(id: string, input: UpdateBOMInput, endpoint?: string): Promise<BOM> {
    const data = await requestJson<{ bom: BOM }>(`/v1/bom/${id}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.bom;
  },

  async deleteBOM(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/bom/${id}`, { endpoint, method: 'DELETE' });
  },

  async confirmBOM(id: string, endpoint?: string): Promise<BOM> {
    const data = await requestJson<{ bom: BOM }>(`/v1/bom/${id}/confirm`, { endpoint, method: 'POST' });
    return data.bom;
  },

  async archiveBOM(id: string, endpoint?: string): Promise<BOM> {
    const data = await requestJson<{ bom: BOM }>(`/v1/bom/${id}/archive`, { endpoint, method: 'POST' });
    return data.bom;
  },

  async recalculateBOMCost(id: string, endpoint?: string): Promise<BOM> {
    const data = await requestJson<{ bom: BOM }>(`/v1/bom/${id}/recalculate`, { endpoint, method: 'POST' });
    return data.bom;
  },

  // ════════════════════════════════════════
  // Phase 3 C2: 生产 MES 深化 API
  // ════════════════════════════════════════

  // ── 工位 WorkStation ──
  async listWorkStations(params?: { type?: string; isActive?: boolean }, endpoint?: string): Promise<WorkStation[]> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    const qs = query.toString();
    const data = await requestJson<{ items: WorkStation[] }>(`/v1/mes/work-stations${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async getWorkStation(id: string, endpoint?: string): Promise<WorkStation | null> {
    try {
      const data = await requestJson<{ item: WorkStation }>(`/v1/mes/work-stations/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.item;
    } catch { return null; }
  },

  async getWorkStationUtilization(id: string, startDate: string, endDate: string, endpoint?: string): Promise<WorkStationUtilization | null> {
    try {
      const data = await requestJson<{ utilization: WorkStationUtilization }>(`/v1/mes/work-stations/${encodeURIComponent(id)}/utilization?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, { endpoint, method: 'GET' });
      return data.utilization;
    } catch { return null; }
  },

  async createWorkStation(input: WorkStationInput, endpoint?: string): Promise<WorkStation> {
    const data = await requestJson<{ item: WorkStation }>('/v1/mes/work-stations', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateWorkStation(id: string, input: Partial<WorkStationInput>, endpoint?: string): Promise<WorkStation> {
    const data = await requestJson<{ item: WorkStation }>(`/v1/mes/work-stations/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteWorkStation(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/work-stations/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 排产 ProductionPlan ──
  async listProductionPlans(params?: { orderId?: string; workStationId?: string; status?: string; processType?: string; dateFrom?: string; dateTo?: string }, endpoint?: string): Promise<ProductionPlan[]> {
    const query = new URLSearchParams();
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.workStationId) query.set('workStationId', params.workStationId);
    if (params?.status) query.set('status', params.status);
    if (params?.processType) query.set('processType', params.processType);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    const data = await requestJson<{ items: ProductionPlan[] }>(`/v1/mes/plans${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async getProductionPlan(id: string, endpoint?: string): Promise<ProductionPlan | null> {
    try {
      const data = await requestJson<{ item: ProductionPlan }>(`/v1/mes/plans/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.item;
    } catch { return null; }
  },

  async createProductionPlan(input: ProductionPlanInput, endpoint?: string): Promise<ProductionPlan> {
    const data = await requestJson<{ item: ProductionPlan }>('/v1/mes/plans', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateProductionPlan(id: string, input: Partial<ProductionPlanInput>, endpoint?: string): Promise<ProductionPlan> {
    const data = await requestJson<{ item: ProductionPlan }>(`/v1/mes/plans/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteProductionPlan(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/plans/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async transitionPlanStatus(id: string, toStatus: ProductionPlanStatus, endpoint?: string): Promise<ProductionPlan> {
    const data = await requestJson<{ item: ProductionPlan }>(`/v1/mes/plans/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStatus }) });
    return data.item;
  },

  async updatePlanProgress(id: string, actualQuantity: number, endpoint?: string): Promise<ProductionPlan> {
    const data = await requestJson<{ item: ProductionPlan }>(`/v1/mes/plans/${encodeURIComponent(id)}/progress`, { endpoint, method: 'POST', body: JSON.stringify({ actualQuantity }) });
    return data.item;
  },

  // ── 工时 WorkHour ──
  async listWorkHours(params?: { productionPlanId?: string; employeeId?: string; dateFrom?: string; dateTo?: string }, endpoint?: string): Promise<WorkHour[]> {
    const query = new URLSearchParams();
    if (params?.productionPlanId) query.set('productionPlanId', params.productionPlanId);
    if (params?.employeeId) query.set('employeeId', params.employeeId);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    const data = await requestJson<{ items: WorkHour[] }>(`/v1/mes/work-hours${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async getWorkHourSummary(params?: { productionPlanId?: string; dateFrom?: string; dateTo?: string }, endpoint?: string): Promise<WorkHourSummary[]> {
    const query = new URLSearchParams();
    if (params?.productionPlanId) query.set('productionPlanId', params.productionPlanId);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    const data = await requestJson<{ summary: WorkHourSummary[] }>(`/v1/mes/work-hours/summary${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.summary) ? data.summary : [];
  },

  async createWorkHour(input: WorkHourInput, endpoint?: string): Promise<WorkHour> {
    const data = await requestJson<{ item: WorkHour }>('/v1/mes/work-hours', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteWorkHour(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/work-hours/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 计件规则 PieceRateRule ──
  async listPieceRateRules(params?: { processType?: string; productAssetId?: string; isActive?: boolean }, endpoint?: string): Promise<PieceRateRule[]> {
    const query = new URLSearchParams();
    if (params?.processType) query.set('processType', params.processType);
    if (params?.productAssetId) query.set('productAssetId', params.productAssetId);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    const qs = query.toString();
    const data = await requestJson<{ items: PieceRateRule[] }>(`/v1/mes/piece-rate-rules${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async createPieceRateRule(input: PieceRateRuleInput, endpoint?: string): Promise<PieceRateRule> {
    const data = await requestJson<{ item: PieceRateRule }>('/v1/mes/piece-rate-rules', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updatePieceRateRule(id: string, input: Partial<PieceRateRuleInput>, endpoint?: string): Promise<PieceRateRule> {
    const data = await requestJson<{ item: PieceRateRule }>(`/v1/mes/piece-rate-rules/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deletePieceRateRule(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/piece-rate-rules/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 计件记录 PieceRateRecord ──
  async listPieceRateRecords(params?: { pieceRateRuleId?: string; productionPlanId?: string; employeeId?: string; status?: string; dateFrom?: string; dateTo?: string }, endpoint?: string): Promise<PieceRateRecord[]> {
    const query = new URLSearchParams();
    if (params?.pieceRateRuleId) query.set('pieceRateRuleId', params.pieceRateRuleId);
    if (params?.productionPlanId) query.set('productionPlanId', params.productionPlanId);
    if (params?.employeeId) query.set('employeeId', params.employeeId);
    if (params?.status) query.set('status', params.status);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    const data = await requestJson<{ items: PieceRateRecord[] }>(`/v1/mes/piece-rate-records${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async getPieceRateSummary(params?: { employeeId?: string; status?: string; dateFrom?: string; dateTo?: string }, endpoint?: string): Promise<PieceRateSummary[]> {
    const query = new URLSearchParams();
    if (params?.employeeId) query.set('employeeId', params.employeeId);
    if (params?.status) query.set('status', params.status);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    const data = await requestJson<{ summary: PieceRateSummary[] }>(`/v1/mes/piece-rate-records/summary${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.summary) ? data.summary : [];
  },

  async createPieceRateRecord(input: PieceRateRecordInput, endpoint?: string): Promise<PieceRateRecord> {
    const data = await requestJson<{ item: PieceRateRecord }>('/v1/mes/piece-rate-records', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async transitionPieceRateStatus(id: string, toStatus: PieceRateStatus, endpoint?: string): Promise<PieceRateRecord> {
    const data = await requestJson<{ item: PieceRateRecord }>(`/v1/mes/piece-rate-records/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStatus }) });
    return data.item;
  },

  async deletePieceRateRecord(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/piece-rate-records/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 外协 OutsourcingOrder ──
  async listOutsourcingOrders(params?: { supplierId?: string; orderId?: string; status?: string; processType?: string }, endpoint?: string): Promise<OutsourcingOrder[]> {
    const query = new URLSearchParams();
    if (params?.supplierId) query.set('supplierId', params.supplierId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.status) query.set('status', params.status);
    if (params?.processType) query.set('processType', params.processType);
    const qs = query.toString();
    const data = await requestJson<{ items: OutsourcingOrder[] }>(`/v1/mes/outsourcing${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async getOutsourcingOrder(id: string, endpoint?: string): Promise<OutsourcingOrder | null> {
    try {
      const data = await requestJson<{ item: OutsourcingOrder }>(`/v1/mes/outsourcing/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.item;
    } catch { return null; }
  },

  async createOutsourcingOrder(input: OutsourcingOrderInput, endpoint?: string): Promise<OutsourcingOrder> {
    const data = await requestJson<{ item: OutsourcingOrder }>('/v1/mes/outsourcing', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateOutsourcingOrder(id: string, input: Partial<OutsourcingOrderInput>, endpoint?: string): Promise<OutsourcingOrder> {
    const data = await requestJson<{ item: OutsourcingOrder }>(`/v1/mes/outsourcing/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteOutsourcingOrder(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/outsourcing/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async transitionOutsourcingStatus(id: string, toStatus: OutsourcingStatus, endpoint?: string): Promise<OutsourcingOrder> {
    const data = await requestJson<{ item: OutsourcingOrder }>(`/v1/mes/outsourcing/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStatus }) });
    return data.item;
  },

  async receiveOutsourcing(id: string, opts: { qualityAcceptedQty: number; qualityRejectedQty?: number }, endpoint?: string): Promise<OutsourcingOrder> {
    const data = await requestJson<{ item: OutsourcingOrder }>(`/v1/mes/outsourcing/${encodeURIComponent(id)}/receive`, { endpoint, method: 'POST', body: JSON.stringify(opts) });
    return data.item;
  },

  // ── REQ2-05 面料工序级委外链 OrderProcessNode（DR-047：计划+成本核算层） ──
  async listOrderProcessChain(orderId: string, endpoint?: string): Promise<{ nodes: OrderProcessNodeRow[]; summary: OrderProcessChainSummary }> {
    const data = await requestJson<{ nodes: OrderProcessNodeRow[]; summary: OrderProcessChainSummary }>(
      `/v1/mes/order-processes?orderId=${encodeURIComponent(orderId)}`, { endpoint, method: 'GET' });
    return { nodes: data.nodes ?? [], summary: data.summary };
  },

  async createOrderProcessNode(input: {
    orderId: string; seq: number; processType: string; supplierId?: string;
    inputQty: number; unit?: string; unitPrice: number; notes?: string; outsourcingOrderId?: string;
  }, endpoint?: string): Promise<OrderProcessNodeRow> {
    const data = await requestJson<{ node: OrderProcessNodeRow }>('/v1/mes/order-processes', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.node;
  },

  async updateOrderProcessNode(id: string, patch: {
    supplierId?: string | null; inputQty?: number; unit?: string; unitPrice?: number; notes?: string;
  }, endpoint?: string): Promise<OrderProcessNodeRow> {
    const data = await requestJson<{ node: OrderProcessNodeRow }>(`/v1/mes/order-processes/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.node;
  },

  async startOrderProcessNode(id: string, endpoint?: string): Promise<OrderProcessNodeRow> {
    const data = await requestJson<{ node: OrderProcessNodeRow }>(`/v1/mes/order-processes/${encodeURIComponent(id)}/start`, { endpoint, method: 'POST', body: '{}' });
    return data.node;
  },

  async completeOrderProcessNode(id: string, input: { outputQty: number; actualUnitPrice?: number }, endpoint?: string): Promise<{ node: OrderProcessNodeRow; lossPct: number | null }> {
    const data = await requestJson<{ node: OrderProcessNodeRow; lossPct: number | null }>(`/v1/mes/order-processes/${encodeURIComponent(id)}/complete`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return { node: data.node, lossPct: data.lossPct };
  },

  async deleteOrderProcessNode(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/mes/order-processes/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── Phase 3 C1: CRM 深化 API ──
  // Contact
  async listContacts(relationId: string, endpoint?: string): Promise<Contact[]> {
    const data = await requestJson<{ contacts: Contact[] }>(`/v2/crm/${encodeURIComponent(relationId)}/contacts`, { endpoint, method: 'GET' });
    return data.contacts ?? [];
  },
  async createContact(relationId: string, input: ContactInput, endpoint?: string): Promise<Contact> {
    const data = await requestJson<{ contact: Contact }>(`/v2/crm/${encodeURIComponent(relationId)}/contacts`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.contact;
  },
  async updateContact(id: string, input: Partial<ContactInput>, endpoint?: string): Promise<Contact> {
    const data = await requestJson<{ contact: Contact }>(`/v2/crm/contacts/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.contact;
  },
  async deleteContact(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v2/crm/contacts/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // CreditLimit
  async getActiveCreditLimit(relationId: string, endpoint?: string): Promise<CreditLimit | null> {
    try {
      const data = await requestJson<{ creditLimit: CreditLimit | null }>(`/v2/crm/${encodeURIComponent(relationId)}/credit-limit`, { endpoint, method: 'GET' });
      return data.creditLimit;
    } catch { return null; }
  },
  async listCreditLimitHistory(relationId: string, endpoint?: string): Promise<CreditLimit[]> {
    const data = await requestJson<{ history: CreditLimit[] }>(`/v2/crm/${encodeURIComponent(relationId)}/credit-limit/history`, { endpoint, method: 'GET' });
    return data.history ?? [];
  },
  async setCreditLimit(relationId: string, input: CreditLimitInput, endpoint?: string): Promise<CreditLimit> {
    const data = await requestJson<{ creditLimit: CreditLimit }>(`/v2/crm/${encodeURIComponent(relationId)}/credit-limit`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.creditLimit;
  },
  async updateCreditLimitStatus(id: string, status: string, endpoint?: string): Promise<CreditLimit> {
    const data = await requestJson<{ creditLimit: CreditLimit }>(`/v2/crm/credit-limit/${encodeURIComponent(id)}/status`, { endpoint, method: 'PATCH', body: JSON.stringify({ status }) });
    return data.creditLimit;
  },

  // FollowUp
  async listFollowUps(relationId: string, opts?: { limit?: number; includeCompleted?: boolean }, endpoint?: string): Promise<FollowUpRecord[]> {
    const query = new URLSearchParams();
    if (opts?.limit != null) query.set('limit', String(opts.limit));
    if (opts?.includeCompleted) query.set('includeCompleted', 'true');
    const qs = query.toString();
    const data = await requestJson<{ followUps: FollowUpRecord[] }>(`/v2/crm/${encodeURIComponent(relationId)}/follow-ups${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.followUps ?? [];
  },

  // ══════════════════════════════════════════════════════════════
  // DR-042 小组数据共享（设计真源：docs/design/03-业务规则/小组与业务数据共享.md）
  // ══════════════════════════════════════════════════════════════

  /** 客户档案被共享给的小组（chips）+ 当前用户访问档位（owner/team-followup/team-read/none） */
  async getRelationTeamShares(relationId: string, endpoint?: string): Promise<{ teamShares: Array<{ grantId: string; teamId: string; teamName: string; permission: string; grantedBy: string; grantedAt: string }>; accessMode: string }> {
    const data = await requestJson<{ teamShares: any[]; accessMode: string }>(`/v2/relations/${encodeURIComponent(relationId)}/team-shares`, { endpoint, method: 'GET' });
    return { teamShares: data.teamShares ?? [], accessMode: data.accessMode ?? 'none' };
  },

  /**
   * 当前用户 scope 内可见的客户档案列表（v2 行级口径：本人 ∪ 小组共享 / all 全量）。
   * 组管理的共享选择器数据源——列出可选客户，授权资格由服务端双重门禁把关。
   */
  async listRelationsV2(limit = 500, endpoint?: string): Promise<Array<{ id: string; name: string; code: string | null; stage: string | null }>> {
    const data = await requestJson<{ ok: boolean; items: any[] }>(`/v2/relations?limit=${limit}`, { endpoint, method: 'GET' });
    return (data.items ?? []).map((r: any) => ({ id: r.id, name: r.name, code: r.code ?? null, stage: r.stage ?? null }));
  },

  /** 详情页就地共享客户档案给小组（档位 read / read+followup） */
  async shareRelationToTeams(relationId: string, teamIds: string[], permission: 'read' | 'read+followup' = 'read+followup', endpoint?: string): Promise<{ granted: number }> {
    const data = await requestJson<{ ok: boolean; granted: number }>(`/v2/relations/${encodeURIComponent(relationId)}/team-shares`, {
      endpoint, method: 'POST', body: JSON.stringify({ teamIds, permission }),
    });
    return data;
  },

  /** 就地移除共享（reason 审计留痕必填） */
  async unshareRelationFromTeam(relationId: string, teamId: string, reason: string, endpoint?: string): Promise<{ revoked: boolean }> {
    const data = await requestJson<{ ok: boolean; revoked: boolean }>(`/v2/relations/${encodeURIComponent(relationId)}/team-shares/${encodeURIComponent(teamId)}`, {
      endpoint, method: 'DELETE', body: JSON.stringify({ reason }),
    });
    return data;
  },
  async createFollowUp(relationId: string, input: FollowUpInput, endpoint?: string): Promise<FollowUpRecord> {
    const data = await requestJson<{ followUp: FollowUpRecord }>(`/v2/crm/${encodeURIComponent(relationId)}/follow-ups`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.followUp;
  },
  async updateFollowUp(id: string, input: Partial<FollowUpInput>, endpoint?: string): Promise<FollowUpRecord> {
    const data = await requestJson<{ followUp: FollowUpRecord }>(`/v2/crm/follow-ups/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.followUp;
  },
  async deleteFollowUp(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v2/crm/follow-ups/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async listOverdueFollowUps(daysAhead?: number, endpoint?: string): Promise<FollowUpRecord[]> {
    const query = daysAhead != null ? `?daysAhead=${daysAhead}` : '';
    const data = await requestJson<{ overdueFollowUps: FollowUpRecord[] }>(`/v2/crm/follow-ups/overdue${query}`, { endpoint, method: 'GET' });
    return data.overdueFollowUps ?? [];
  },

  // ── 阶段 P3b：品牌线 BrandLine（PRD 6.2，客户 360°）──
  // ⚠️ DR-042 v2.2 遗留：brand-lines / comm-logs 仍在 V1 端点（crmRouteV2 未覆盖，
  // 无 L2 行级门禁）——待 Phase 3 V2 化补齐后切换（文档 §12 Phase 3 锚定扩展）。
  async listBrandLines(relationId: string, opts?: { includeInactive?: boolean }, endpoint?: string): Promise<BrandLine[]> {
    const qs = opts?.includeInactive ? '?includeInactive=1' : '';
    const data = await requestJson<{ items: BrandLine[]; total: number }>(`/v1/crm/${encodeURIComponent(relationId)}/brand-lines${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createBrandLine(relationId: string, input: BrandLineInput, endpoint?: string): Promise<BrandLine> {
    const data = await requestJson<{ item: BrandLine }>(`/v1/crm/${encodeURIComponent(relationId)}/brand-lines`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateBrandLine(id: string, input: Partial<BrandLineInput>, endpoint?: string): Promise<BrandLine> {
    const data = await requestJson<{ item: BrandLine }>(`/v1/crm/brand-lines/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },
  async deleteBrandLine(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/crm/brand-lines/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P3b：沟通日志 CommunicationLog（PRD 12.3，全渠道沟通流水）──
  async listCommLogs(relationId: string, opts?: { type?: string; direction?: string; limit?: number; offset?: number }, endpoint?: string): Promise<CommunicationLog[]> {
    const query = new URLSearchParams();
    if (opts?.type) query.set('type', opts.type);
    if (opts?.direction) query.set('direction', opts.direction);
    if (opts?.limit != null) query.set('limit', String(opts.limit));
    if (opts?.offset != null) query.set('offset', String(opts.offset));
    const qs = query.toString();
    const data = await requestJson<{ items: CommunicationLog[]; total: number }>(`/v1/crm/${encodeURIComponent(relationId)}/comm-logs${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createCommLog(relationId: string, input: CommunicationLogInput, endpoint?: string): Promise<CommunicationLog> {
    const data = await requestJson<{ item: CommunicationLog }>(`/v1/crm/${encodeURIComponent(relationId)}/comm-logs`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateCommLog(id: string, input: Partial<CommunicationLogInput>, endpoint?: string): Promise<CommunicationLog> {
    const data = await requestJson<{ item: CommunicationLog }>(`/v1/crm/comm-logs/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },
  async deleteCommLog(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/crm/comm-logs/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P3b：邮件签名 EmailSignature（PRD 12.1；写操作需 JWT）──
  async listEmailSignatures(opts?: { language?: string; includeInactive?: boolean }, endpoint?: string): Promise<EmailSignature[]> {
    const query = new URLSearchParams();
    if (opts?.language) query.set('language', opts.language);
    if (opts?.includeInactive) query.set('includeInactive', '1');
    const qs = query.toString();
    const data = await requestJson<{ items: EmailSignature[]; total: number }>(`/v1/email-signatures${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createEmailSignature(input: EmailSignatureInput, endpoint?: string): Promise<EmailSignature> {
    const data = await requestJson<{ item: EmailSignature }>(`/v1/email-signatures`, { endpoint, method: 'POST', headers: jwtAuthHeaders(), body: JSON.stringify(input) });
    return data.item;
  },
  async updateEmailSignature(id: string, input: Partial<EmailSignatureInput>, endpoint?: string): Promise<EmailSignature> {
    const data = await requestJson<{ item: EmailSignature }>(`/v1/email-signatures/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', headers: jwtAuthHeaders(), body: JSON.stringify(input) });
    return data.item;
  },
  async deleteEmailSignature(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/email-signatures/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE', headers: jwtAuthHeaders() });
  },

  // ── 阶段 P3a：单据模板 DocumentTemplate（PRD 11.3；写操作需 JWT）──
  async listDocumentTemplates(opts?: { type?: string; language?: string; includeInactive?: boolean }, endpoint?: string): Promise<DocumentTemplate[]> {
    const query = new URLSearchParams();
    if (opts?.type) query.set('type', opts.type);
    if (opts?.language) query.set('language', opts.language);
    if (opts?.includeInactive) query.set('includeInactive', '1');
    const qs = query.toString();
    const data = await requestJson<{ items: DocumentTemplate[]; total: number }>(`/v1/document-templates${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createDocumentTemplate(input: DocumentTemplateInput, endpoint?: string): Promise<DocumentTemplate> {
    const data = await requestJson<{ item: DocumentTemplate }>(`/v1/document-templates`, { endpoint, method: 'POST', headers: jwtAuthHeaders(), body: JSON.stringify(input) });
    return data.item;
  },
  async updateDocumentTemplate(id: string, input: Partial<DocumentTemplateInput>, endpoint?: string): Promise<DocumentTemplate> {
    const data = await requestJson<{ item: DocumentTemplate }>(`/v1/document-templates/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', headers: jwtAuthHeaders(), body: JSON.stringify(input) });
    return data.item;
  },
  async deleteDocumentTemplate(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/document-templates/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE', headers: jwtAuthHeaders() });
  },

  // Opportunity
  async listOpportunities(params?: { relationId?: string; stage?: string; salesRepId?: string }, endpoint?: string): Promise<Opportunity[]> {
    const query = new URLSearchParams();
    if (params?.relationId) query.set('relationId', params.relationId);
    if (params?.stage) query.set('stage', params.stage);
    if (params?.salesRepId) query.set('salesRepId', params.salesRepId);
    const qs = query.toString();
    const data = await requestJson<{ opportunities: Opportunity[] }>(`/v2/crm/opportunities${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.opportunities ?? [];
  },
  async createOpportunity(relationId: string, input: OpportunityInput, endpoint?: string): Promise<Opportunity> {
    const data = await requestJson<{ opportunity: Opportunity }>(`/v2/crm/${encodeURIComponent(relationId)}/opportunities`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.opportunity;
  },
  async getOpportunity(id: string, endpoint?: string): Promise<Opportunity | null> {
    try {
      const data = await requestJson<{ opportunity: Opportunity }>(`/v2/crm/opportunities/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.opportunity;
    } catch { return null; }
  },
  async updateOpportunity(id: string, input: Partial<OpportunityInput>, endpoint?: string): Promise<Opportunity> {
    const data = await requestJson<{ opportunity: Opportunity }>(`/v2/crm/opportunities/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.opportunity;
  },
  async transitionOpportunity(id: string, toStage: string, endpoint?: string): Promise<Opportunity> {
    const data = await requestJson<{ opportunity: Opportunity }>(`/v1/crm/opportunities/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStage }) });
    return data.opportunity;
  },
  async deleteOpportunity(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v2/crm/opportunities/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async getOpportunityPipelineSummary(salesRepId?: string, endpoint?: string): Promise<Record<string, { count: number; totalAmount: number }>> {
    const query = salesRepId ? `?salesRepId=${encodeURIComponent(salesRepId)}` : '';
    const data = await requestJson<{ pipeline: Record<string, { count: number; totalAmount: number }> }>(`/v2/crm/opportunities/pipeline/summary${query}`, { endpoint, method: 'GET' });
    return data.pipeline ?? {};
  },

  // CustomerTier
  async getActiveCustomerTier(relationId: string, endpoint?: string): Promise<CustomerTier | null> {
    try {
      const data = await requestJson<{ customerTier: CustomerTier | null }>(`/v2/crm/${encodeURIComponent(relationId)}/customer-tier`, { endpoint, method: 'GET' });
      return data.customerTier;
    } catch { return null; }
  },
  async listCustomerTierHistory(relationId: string, endpoint?: string): Promise<CustomerTier[]> {
    const data = await requestJson<{ history: CustomerTier[] }>(`/v2/crm/${encodeURIComponent(relationId)}/customer-tier/history`, { endpoint, method: 'GET' });
    return data.history ?? [];
  },
  async assignCustomerTier(relationId: string, input: CustomerTierInput, endpoint?: string): Promise<CustomerTier> {
    const data = await requestJson<{ customerTier: CustomerTier }>(`/v2/crm/${encodeURIComponent(relationId)}/customer-tier`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.customerTier;
  },
  async deleteCustomerTier(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v2/crm/customer-tier/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // CRM Overview
  async getCrmOverview(relationId: string, endpoint?: string): Promise<CrmOverview | null> {
    try {
      const data = await requestJson<CrmOverview>(`/v2/crm/${encodeURIComponent(relationId)}/overview`, { endpoint, method: 'GET' });
      return data;
    } catch { return null; }
  },

  // ── 阶段 H H1: 供应商管理 Supplier Management API ──
  // FactoryProfile 档案
  async listFactoryProfiles(params?: { search?: string; blacklisted?: boolean; sort?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: FactoryProfile[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.blacklisted !== undefined) query.set('blacklisted', String(params.blacklisted));
    if (params?.sort) query.set('sort', params.sort);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const data = await requestJson<{ items: FactoryProfile[]; total: number }>(`/v1/suppliers${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return { items: data.items ?? [], total: data.total ?? 0 };
  },
  async getFactoryProfile(id: string, endpoint?: string): Promise<FactoryProfile | null> {
    try {
      const data = await requestJson<{ item: FactoryProfile }>(`/v1/suppliers/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.item;
    } catch { return null; }
  },
  async createFactoryProfile(input: FactoryProfileInput, endpoint?: string): Promise<FactoryProfile> {
    const data = await requestJson<{ item: FactoryProfile }>(`/v1/suppliers`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateFactoryProfile(id: string, patch: FactoryProfilePatch, endpoint?: string): Promise<FactoryProfile> {
    const data = await requestJson<{ item: FactoryProfile }>(`/v1/suppliers/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteFactoryProfile(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/suppliers/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async blacklistFactory(id: string, reason: string, endpoint?: string): Promise<FactoryProfile> {
    const data = await requestJson<{ item: FactoryProfile }>(`/v1/suppliers/${encodeURIComponent(id)}/blacklist`, { endpoint, method: 'POST', body: JSON.stringify({ reason }) });
    return data.item;
  },
  async unblacklistFactory(id: string, endpoint?: string): Promise<FactoryProfile> {
    const data = await requestJson<{ item: FactoryProfile }>(`/v1/suppliers/${encodeURIComponent(id)}/blacklist`, { endpoint, method: 'DELETE' });
    return data.item;
  },

  // FactoryEvaluation 评估
  async listFactoryEvaluations(factoryId: string, kind?: string, endpoint?: string): Promise<FactoryEvaluation[]> {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const data = await requestJson<{ items: FactoryEvaluation[] }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/evaluations${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async addFactoryEvaluation(factoryId: string, input: FactoryEvaluationInput, endpoint?: string): Promise<FactoryEvaluation> {
    const data = await requestJson<{ item: FactoryEvaluation }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/evaluations`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  // FactoryCertification 认证
  async listFactoryCertifications(factoryId: string, endpoint?: string): Promise<FactoryCertification[]> {
    const data = await requestJson<{ items: FactoryCertification[] }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/certifications`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async addFactoryCertification(factoryId: string, input: FactoryCertificationInput, endpoint?: string): Promise<FactoryCertification> {
    const data = await requestJson<{ item: FactoryCertification }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/certifications`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateFactoryCertification(certId: string, patch: Partial<FactoryCertificationInput>, endpoint?: string): Promise<FactoryCertification> {
    const data = await requestJson<{ item: FactoryCertification }>(`/v1/suppliers/certifications/${encodeURIComponent(certId)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteFactoryCertification(certId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/suppliers/certifications/${encodeURIComponent(certId)}`, { endpoint, method: 'DELETE' });
  },
  async listExpiringCertifications(days?: number, endpoint?: string): Promise<FactoryCertification[]> {
    const qs = days != null ? `?days=${days}` : '';
    const data = await requestJson<{ items: FactoryCertification[]; total: number }>(`/v1/suppliers/expiring-certifications${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },

  // ── REQ2-06 GRS TC 交易证书链 TcCertificate（DR-048：三段链 + 一键校验） ──
  async listTcCertificates(params: { orderId?: string; relationId?: string }, endpoint?: string): Promise<{ items: TcCertificateRow[]; byStage: TcStageSummary[] }> {
    const query = new URLSearchParams();
    if (params.orderId) query.set('orderId', params.orderId);
    if (params.relationId) query.set('relationId', params.relationId);
    const data = await requestJson<{ items: TcCertificateRow[]; byStage: TcStageSummary[] }>(
      `/v1/suppliers/tc-certificates?${query.toString()}`, { endpoint, method: 'GET' });
    return { items: data.items ?? [], byStage: data.byStage ?? [] };
  },
  async createTcCertificate(input: {
    orderId: string; stage: TcStage; tcNo: string; quantityKg: number;
    relationId?: string; issuedAt?: string; validUntil?: string; notes?: string; parentTcId?: string;
  }, endpoint?: string): Promise<TcCertificateRow> {
    const data = await requestJson<{ tc: TcCertificateRow }>('/v1/suppliers/tc-certificates', { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.tc;
  },
  async verifyTcChain(orderId: string, endpoint?: string): Promise<TcChainVerification> {
    const data = await requestJson<{ verification: TcChainVerification }>(
      `/v1/suppliers/tc-certificates/verify?orderId=${encodeURIComponent(orderId)}`, { endpoint, method: 'GET' });
    return data.verification;
  },
  async updateTcCertificate(id: string, patch: {
    quantityKg?: number; issuedAt?: string; validUntil?: string; notes?: string;
  }, endpoint?: string): Promise<TcCertificateRow> {
    const data = await requestJson<{ tc: TcCertificateRow }>(`/v1/suppliers/tc-certificates/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.tc;
  },
  async deleteTcCertificate(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/suppliers/tc-certificates/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // FactoryCapacity 产能日历
  async listFactoryCapacity(factoryId: string, endpoint?: string): Promise<FactoryCapacity[]> {
    const data = await requestJson<{ items: FactoryCapacity[] }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/capacity`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async upsertFactoryCapacity(factoryId: string, month: string, input: { capacity: number; unit?: string | null; note?: string | null }, endpoint?: string): Promise<FactoryCapacity> {
    const data = await requestJson<{ item: FactoryCapacity }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/capacity/${encodeURIComponent(month)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },
  async deleteFactoryCapacity(factoryId: string, month: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/suppliers/${encodeURIComponent(factoryId)}/capacity/${encodeURIComponent(month)}`, { endpoint, method: 'DELETE' });
  },

  // 工厂 360° 总览
  async getFactoryOverview(factoryId: string, endpoint?: string): Promise<FactoryOverview | null> {
    try {
      const data = await requestJson<FactoryOverview>(`/v1/suppliers/${encodeURIComponent(factoryId)}/overview`, { endpoint, method: 'GET' });
      return data;
    } catch { return null; }
  },

  // ── 阶段 H H2: 季节性与趋势管理 Season & Trend Management API ──
  // Season 季度
  async listSeasons(params?: { status?: string; search?: string }, endpoint?: string): Promise<{ items: Season[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    const data = await requestJson<{ items: Season[]; total: number }>(`/v1/seasons${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return { items: data.items ?? [], total: data.total ?? 0 };
  },
  async createSeason(input: SeasonInput, endpoint?: string): Promise<Season> {
    const data = await requestJson<{ ok: boolean; item: Season }>(`/v1/seasons`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async getSeason(id: string, endpoint?: string): Promise<Season | null> {
    try {
      const data = await requestJson<{ item: Season }>(`/v1/seasons/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
      return data.item;
    } catch { return null; }
  },
  async updateSeason(id: string, patch: SeasonPatch, endpoint?: string): Promise<Season> {
    const data = await requestJson<{ ok: boolean; item: Season }>(`/v1/seasons/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteSeason(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/seasons/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async getSeasonReview(id: string, endpoint?: string): Promise<SeasonReview | null> {
    try {
      const data = await requestJson<{ review: SeasonReview | null }>(`/v1/seasons/${encodeURIComponent(id)}/review`, { endpoint, method: 'GET' });
      return data.review;
    } catch { return null; }
  },
  async generateSeasonReview(id: string, endpoint?: string): Promise<SeasonReview> {
    const data = await requestJson<{ ok: boolean; review: SeasonReview }>(`/v1/seasons/${encodeURIComponent(id)}/review`, { endpoint, method: 'POST' });
    return data.review;
  },

  // TrendTag 趋势标签
  async listTrendTags(params?: { seasonId?: string; type?: string }, endpoint?: string): Promise<TrendTag[]> {
    const query = new URLSearchParams();
    if (params?.seasonId) query.set('seasonId', params.seasonId);
    if (params?.type) query.set('type', params.type);
    const qs = query.toString();
    const data = await requestJson<{ items: TrendTag[]; total?: number }>(`/v1/seasons/trends${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createTrendTag(input: TrendTagInput, endpoint?: string): Promise<TrendTag> {
    const data = await requestJson<{ ok: boolean; item: TrendTag }>(`/v1/seasons/trends`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateTrendTag(tagId: string, patch: TrendTagPatch, endpoint?: string): Promise<TrendTag> {
    const data = await requestJson<{ ok: boolean; item: TrendTag }>(`/v1/seasons/trends/${encodeURIComponent(tagId)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteTrendTag(tagId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/seasons/trends/${encodeURIComponent(tagId)}`, { endpoint, method: 'DELETE' });
  },
  async linkTrendFabric(tagId: string, input: { fabricId: string; note?: string | null }, endpoint?: string): Promise<TrendTagFabricLink> {
    const data = await requestJson<{ ok: boolean; item: TrendTagFabricLink }>(`/v1/seasons/trends/${encodeURIComponent(tagId)}/fabrics`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async unlinkTrendFabric(tagId: string, fabricId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/seasons/trends/${encodeURIComponent(tagId)}/fabrics/${encodeURIComponent(fabricId)}`, { endpoint, method: 'DELETE' });
  },
  async listTrendingFabrics(seasonId?: string, endpoint?: string): Promise<TrendingFabricItem[]> {
    const qs = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : '';
    const data = await requestJson<{ items: TrendingFabricItem[] }>(`/v1/seasons/trending-fabrics${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },

  // TradeShow 展会
  async listTradeShows(params?: { seasonId?: string; status?: string }, endpoint?: string): Promise<TradeShow[]> {
    const query = new URLSearchParams();
    if (params?.seasonId) query.set('seasonId', params.seasonId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    const data = await requestJson<{ items: TradeShow[]; total?: number }>(`/v1/seasons/shows${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createTradeShow(input: TradeShowInput, endpoint?: string): Promise<TradeShow> {
    const data = await requestJson<{ ok: boolean; item: TradeShow }>(`/v1/seasons/shows`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async getTradeShow(showId: string, endpoint?: string): Promise<{ item: TradeShow; roi: TradeShowROI } | null> {
    try {
      const data = await requestJson<{ item: TradeShow; roi: TradeShowROI }>(`/v1/seasons/shows/${encodeURIComponent(showId)}`, { endpoint, method: 'GET' });
      return data;
    } catch { return null; }
  },
  async updateTradeShow(showId: string, patch: TradeShowPatch, endpoint?: string): Promise<TradeShow> {
    const data = await requestJson<{ ok: boolean; item: TradeShow }>(`/v1/seasons/shows/${encodeURIComponent(showId)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteTradeShow(showId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/seasons/shows/${encodeURIComponent(showId)}`, { endpoint, method: 'DELETE' });
  },
  async getTradeShowROI(showId: string, endpoint?: string): Promise<TradeShowROI | null> {
    try {
      const data = await requestJson<TradeShowROI>(`/v1/seasons/shows/${encodeURIComponent(showId)}/roi`, { endpoint, method: 'GET' });
      return data;
    } catch { return null; }
  },

  // TradeShowLead 展会线索
  async addTradeShowLead(showId: string, input: TradeShowLeadInput, endpoint?: string): Promise<TradeShowLead> {
    const data = await requestJson<{ ok: boolean; item: TradeShowLead }>(`/v1/seasons/shows/${encodeURIComponent(showId)}/leads`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateTradeShowLead(leadId: string, patch: TradeShowLeadPatch, endpoint?: string): Promise<TradeShowLead> {
    const data = await requestJson<{ ok: boolean; item: TradeShowLead }>(`/v1/seasons/leads/${encodeURIComponent(leadId)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteTradeShowLead(leadId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/seasons/leads/${encodeURIComponent(leadId)}`, { endpoint, method: 'DELETE' });
  },
  async convertTradeShowLead(leadId: string, relationId: string, endpoint?: string): Promise<TradeShowLead> {
    const data = await requestJson<{ ok: boolean; item: TradeShowLead }>(`/v1/seasons/leads/${encodeURIComponent(leadId)}/convert`, { endpoint, method: 'POST', body: JSON.stringify({ relationId }) });
    return data.item;
  },

  // ── 阶段 H H3: 风险管理与合规 Risk & Compliance API ──
  // 预警中心 RiskAlert
  async getRiskOverview(endpoint?: string): Promise<RiskOverview> {
    const data = await requestJson<RiskOverview>(`/v1/risk/overview`, { endpoint, method: 'GET' });
    return { openByType: data.openByType ?? {}, openByLevel: data.openByLevel ?? {}, recent: data.recent ?? [] };
  },
  async listRiskAlerts(params?: { type?: string; level?: string; status?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: RiskAlert[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.level) query.set('level', params.level);
    if (params?.status) query.set('status', params.status);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    const data = await requestJson<{ items: RiskAlert[]; total: number }>(`/v1/risk/alerts${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return { items: data.items ?? [], total: data.total ?? 0 };
  },
  async updateRiskAlertStatus(id: string, status: RiskAlertStatus, endpoint?: string): Promise<RiskAlert> {
    const data = await requestJson<{ ok: boolean; item: RiskAlert }>(`/v1/risk/alerts/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify({ status }) });
    return data.item;
  },

  // ExchangeRate 汇率
  async listExchangeRates(params?: { currency?: string; limit?: number }, endpoint?: string): Promise<ExchangeRate[]> {
    const query = new URLSearchParams();
    if (params?.currency) query.set('currency', params.currency);
    if (params?.limit != null) query.set('limit', String(params.limit));
    const qs = query.toString();
    const data = await requestJson<{ items: ExchangeRate[]; total?: number }>(`/v1/risk/fx-rates${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async getLatestFxRates(endpoint?: string): Promise<LatestFxRate[]> {
    const data = await requestJson<{ items: LatestFxRate[] }>(`/v1/risk/fx-rates-latest`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async addExchangeRate(input: ExchangeRateInput, endpoint?: string): Promise<ExchangeRate> {
    const data = await requestJson<{ ok: boolean; item: ExchangeRate }>(`/v1/risk/fx-rates`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  // FxRateLock 汇率锁定
  async listFxLocks(orderId?: string, endpoint?: string): Promise<FxRateLock[]> {
    const qs = orderId ? `?orderId=${encodeURIComponent(orderId)}` : '';
    const data = await requestJson<{ items: FxRateLock[]; total?: number }>(`/v1/risk/fx-locks${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async lockFxRate(input: FxRateLockInput, endpoint?: string): Promise<FxRateLock> {
    const data = await requestJson<{ ok: boolean; item: FxRateLock }>(`/v1/risk/fx-locks`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async deleteFxLock(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/risk/fx-locks/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // CreditRating 信用评级
  async listCreditRatings(params?: { relationId?: string; latestOnly?: boolean }, endpoint?: string): Promise<CreditRating[]> {
    const query = new URLSearchParams();
    if (params?.relationId) query.set('relationId', params.relationId);
    if (params?.latestOnly != null) query.set('latestOnly', String(params.latestOnly));
    const qs = query.toString();
    const data = await requestJson<{ items: CreditRating[]; total?: number }>(`/v1/risk/credit-ratings${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async evaluateCreditRating(relationId: string, endpoint?: string): Promise<CreditRating> {
    const data = await requestJson<{ ok: boolean; item: CreditRating }>(`/v1/risk/credit-ratings/evaluate`, { endpoint, method: 'POST', body: JSON.stringify({ relationId }) });
    return data.item;
  },
  async runCreditRiskScan(endpoint?: string): Promise<{ frozenCount: number; badDebtCount: number }> {
    const data = await requestJson<{ ok: boolean; frozenCount: number; badDebtCount: number }>(`/v1/risk/credit-risk-scan`, { endpoint, method: 'POST' });
    return { frozenCount: data.frozenCount ?? 0, badDebtCount: data.badDebtCount ?? 0 };
  },

  // ComplianceCheck 合规检查
  async listComplianceChecks(params?: { type?: string; result?: string; targetType?: string; targetId?: string }, endpoint?: string): Promise<ComplianceCheck[]> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.result) query.set('result', params.result);
    if (params?.targetType) query.set('targetType', params.targetType);
    if (params?.targetId) query.set('targetId', params.targetId);
    const qs = query.toString();
    const data = await requestJson<{ items: ComplianceCheck[]; total?: number }>(`/v1/risk/compliance-checks${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async runHsCodeCheck(declarationId: string, endpoint?: string): Promise<ComplianceCheck> {
    const data = await requestJson<{ ok: boolean; item: ComplianceCheck }>(`/v1/risk/compliance-checks/hs-code`, { endpoint, method: 'POST', body: JSON.stringify({ declarationId }) });
    return data.item;
  },
  async runExportControlCheck(declarationId: string, endpoint?: string): Promise<ComplianceCheck> {
    const data = await requestJson<{ ok: boolean; item: ComplianceCheck }>(`/v1/risk/compliance-checks/export-control`, { endpoint, method: 'POST', body: JSON.stringify({ declarationId }) });
    return data.item;
  },
  async addComplianceCheck(input: ComplianceCheckInput, endpoint?: string): Promise<ComplianceCheck> {
    const data = await requestJson<{ ok: boolean; item: ComplianceCheck }>(`/v1/risk/compliance-checks`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  // 质量 Quality 疵点趋势
  async getDefectTrends(groupBy: 'factory' | 'quarter', endpoint?: string): Promise<DefectTrendItem[]> {
    const data = await requestJson<{ items: DefectTrendItem[] }>(`/v1/risk/quality/defect-trends?groupBy=${encodeURIComponent(groupBy)}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async runQualityRepeatScan(endpoint?: string): Promise<{ alerted: number }> {
    const data = await requestJson<{ ok: boolean; alerted: number }>(`/v1/risk/quality/repeat-scan`, { endpoint, method: 'POST' });
    return { alerted: data.alerted ?? 0 };
  },

  // ── 阶段 P0: 业务线配置 BusinessLine API ──
  async listBusinessLines(endpoint?: string): Promise<BusinessLine[]> {
    const data = await requestJson<{ items: BusinessLine[]; total?: number }>(`/v1/business-lines`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createBusinessLine(input: BusinessLineInput, endpoint?: string): Promise<BusinessLine> {
    const data = await requestJson<{ ok: boolean; item: BusinessLine }>(`/v1/business-lines`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateBusinessLine(id: string, patch: BusinessLinePatch, endpoint?: string): Promise<BusinessLine> {
    const data = await requestJson<{ ok: boolean; item: BusinessLine }>(`/v1/business-lines/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteBusinessLine(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/business-lines/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async setOrderBusinessLine(orderId: string, businessLine: string | null, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/business-lines/order/${encodeURIComponent(orderId)}`, { endpoint, method: 'PUT', body: JSON.stringify({ businessLine }) });
  },
  async checkOrderMoq(orderId: string, endpoint?: string): Promise<QcMoqCheckResult> {
    return requestJson<QcMoqCheckResult>(`/v1/business-lines/order/${encodeURIComponent(orderId)}/moq-check`, { endpoint, method: 'GET' });
  },

  // ── 阶段 P0: QC 驻地 QCLocation API ──
  async listQcLocations(endpoint?: string): Promise<QCLocation[]> {
    const data = await requestJson<{ items: QCLocation[]; total?: number }>(`/v1/qc/locations`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createQcLocation(input: QCLocationInput, endpoint?: string): Promise<QCLocation> {
    const data = await requestJson<{ ok: boolean; item: QCLocation }>(`/v1/qc/locations`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateQcLocation(id: string, patch: QCLocationPatch, endpoint?: string): Promise<QCLocation> {
    const data = await requestJson<{ ok: boolean; item: QCLocation }>(`/v1/qc/locations/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteQcLocation(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/qc/locations/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P0: QC 验货任务 QCAssignment API ──
  async listQcAssignments(params?: { qcUserId?: string; status?: string; orderId?: string; locationId?: string; dueBefore?: string }, endpoint?: string): Promise<QCAssignment[]> {
    const query = new URLSearchParams();
    if (params?.qcUserId) query.set('qcUserId', params.qcUserId);
    if (params?.status) query.set('status', params.status);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.locationId) query.set('locationId', params.locationId);
    if (params?.dueBefore) query.set('dueBefore', params.dueBefore);
    const qs = query.toString();
    const data = await requestJson<{ items: QCAssignment[]; total?: number }>(`/v1/qc/assignments${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createQcAssignment(input: QCAssignmentInput, endpoint?: string): Promise<QCAssignment> {
    const data = await requestJson<{ ok: boolean; item: QCAssignment }>(`/v1/qc/assignments`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateQcAssignment(id: string, patch: QCAssignmentPatch, endpoint?: string): Promise<QCAssignment> {
    const data = await requestJson<{ ok: boolean; item: QCAssignment }>(`/v1/qc/assignments/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteQcAssignment(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/qc/assignments/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async startQcAssignment(id: string, endpoint?: string): Promise<QCAssignment> {
    const data = await requestJson<{ ok: boolean; item: QCAssignment }>(`/v1/qc/assignments/${encodeURIComponent(id)}/start`, { endpoint, method: 'POST' });
    return data.item;
  },
  async completeQcAssignment(id: string, reportId?: string, endpoint?: string): Promise<QCAssignment> {
    const data = await requestJson<{ ok: boolean; item: QCAssignment }>(`/v1/qc/assignments/${encodeURIComponent(id)}/complete`, { endpoint, method: 'POST', body: JSON.stringify({ reportId: reportId ?? null }) });
    return data.item;
  },
  async cancelQcAssignment(id: string, endpoint?: string): Promise<QCAssignment> {
    const data = await requestJson<{ ok: boolean; item: QCAssignment }>(`/v1/qc/assignments/${encodeURIComponent(id)}/cancel`, { endpoint, method: 'POST' });
    return data.item;
  },
  async getQcWorkbench(qcUserId?: string, endpoint?: string): Promise<QcWorkbenchData> {
    const qs = qcUserId ? `?qcUserId=${encodeURIComponent(qcUserId)}` : '';
    const data = await requestJson<{ assigned: QCAssignment[]; inProgress: QCAssignment[]; completed: QCAssignment[] }>(`/v1/qc/workbench${qs}`, { endpoint, method: 'GET' });
    return { assigned: data.assigned ?? [], inProgress: data.inProgress ?? [], completed: data.completed ?? [] };
  },

  // ── HR 模块（组织架构/团队/项目/工作分配）统一通道 ──
  async hrGet<T>(path: string, endpoint?: string): Promise<T> {
    return hrRequest<T>(path, { endpoint, method: 'GET' });
  },

  async hrSend<T>(path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', endpoint?: string): Promise<T> {
    return hrRequest<T>(path, { endpoint, method, body: JSON.stringify(body) });
  },

  // QC 人员选择器 / 审批委派选人：最小方法，复用已挂载的 /api/hr/personnel（UserAccount 聚合视图）
  // 该端点要求 owner/admin 角色；调用方需在失败时降级为手工录入用户 ID
  async listUserAccounts(endpoint?: string): Promise<UserAccountDirectoryOption[]> {
    const data = await hrRequest<{
      ok: boolean;
      personnel?: Array<{ id: string; displayName: string; email?: string | null; status?: string | null; department?: string | null; roles?: string[] | null }>;
    }>('personnel', { endpoint, method: 'GET' });
    const personnel = Array.isArray(data.personnel) ? data.personnel : [];
    return personnel
      .filter((u) => u && u.id && u.status !== 'disabled')
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email ?? null,
        status: u.status ?? null,
        department: u.department ?? null,
        roles: Array.isArray(u.roles) ? u.roles : null,
      }));
  },

  // ── 阶段 P1: 退税率表 TaxRefundRate API ──
  async listTaxRefundRates(includeInactive = false, endpoint?: string): Promise<TaxRefundRate[]> {
    const qs = includeInactive ? '?includeInactive=true' : '';
    const data = await requestJson<{ items: TaxRefundRate[]; total?: number }>(`/v1/pricing/tax-refund-rates${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createTaxRefundRate(input: TaxRefundRateInput, endpoint?: string): Promise<TaxRefundRate> {
    const data = await requestJson<{ ok: boolean; item: TaxRefundRate }>(`/v1/pricing/tax-refund-rates`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateTaxRefundRate(id: string, patch: TaxRefundRatePatch, endpoint?: string): Promise<TaxRefundRate> {
    const data = await requestJson<{ ok: boolean; item: TaxRefundRate }>(`/v1/pricing/tax-refund-rates/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteTaxRefundRate(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/pricing/tax-refund-rates/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async lookupTaxRefundRate(hsCode: string, endpoint?: string): Promise<{ hsCode: string; rate: number } | null> {
    const data = await requestJson<{ hit: { hsCode: string; rate: number } | null }>(`/v1/pricing/tax-refund-rates/lookup?hsCode=${encodeURIComponent(hsCode)}`, { endpoint, method: 'GET' });
    return data.hit ?? null;
  },

  // ── 阶段 P2: 轨道 A 系统估算 API（PRD 8.1/8.6） ──
  async previewTrackA(input: TrackAInput, endpoint?: string): Promise<TrackAResult> {
    return requestJson<TrackAResult>(`/v1/pricing/track-a-preview`, { endpoint, method: 'POST', body: JSON.stringify(input) });
  },

  // ── 阶段 P1: 轨道 B 定价 PricingCalculation API ──
  async previewTrackB(input: TrackBInput, endpoint?: string): Promise<TrackBResult> {
    return requestJson<TrackBResult>(`/v1/pricing/track-b-preview`, { endpoint, method: 'POST', body: JSON.stringify(input) });
  },
  async listPricingCalculations(params?: { orderId?: string; quotationId?: string; status?: string }, endpoint?: string): Promise<PricingCalculation[]> {
    const query = new URLSearchParams();
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.quotationId) query.set('quotationId', params.quotationId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    const data = await requestJson<{ items: PricingCalculation[]; total?: number }>(`/v1/pricing/calculations${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createPricingCalculation(input: PricingCalculationInput, endpoint?: string): Promise<PricingCalculation> {
    const data = await requestJson<{ ok: boolean; item: PricingCalculation }>(`/v1/pricing/calculations`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updatePricingCalculation(id: string, patch: PricingCalculationPatch, endpoint?: string): Promise<PricingCalculation> {
    const data = await requestJson<{ ok: boolean; item: PricingCalculation }>(`/v1/pricing/calculations/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deletePricingCalculation(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/pricing/calculations/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P1: 订单利润表 OrderProfitSheet API ──
  async listProfitSheets(endpoint?: string): Promise<OrderProfitSheet[]> {
    const data = await requestJson<{ items: OrderProfitSheet[]; total?: number }>(`/v1/pricing/profit-sheets`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async generateProfitSheet(orderId: string, endpoint?: string): Promise<OrderProfitSheet> {
    const data = await requestJson<{ ok: boolean; item: OrderProfitSheet }>(`/v1/pricing/profit-sheets/generate/${encodeURIComponent(orderId)}`, { endpoint, method: 'POST' });
    return data.item;
  },
  async getProfitSheetByOrder(orderId: string, endpoint?: string): Promise<OrderProfitSheet | null> {
    try {
      const data = await requestJson<{ item: OrderProfitSheet }>(`/v1/pricing/profit-sheets/order/${encodeURIComponent(orderId)}`, { endpoint, method: 'GET' });
      return data.item ?? null;
    } catch {
      return null;
    }
  },
  async deleteProfitSheet(orderId: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/pricing/profit-sheets/order/${encodeURIComponent(orderId)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P1: 原材料价格 MaterialPriceHistory API ──
  async listMaterialPrices(params?: { materialType?: string; materialCode?: string; from?: string; to?: string }, endpoint?: string): Promise<MaterialPriceHistory[]> {
    const query = new URLSearchParams();
    if (params?.materialType) query.set('materialType', params.materialType);
    if (params?.materialCode) query.set('materialCode', params.materialCode);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    const data = await requestJson<{ items: MaterialPriceHistory[]; total?: number }>(`/v1/pricing/material-prices${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createMaterialPrice(input: MaterialPriceInput, endpoint?: string): Promise<MaterialPriceHistory> {
    const data = await requestJson<{ ok: boolean; item: MaterialPriceHistory }>(`/v1/pricing/material-prices`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateMaterialPrice(id: string, patch: MaterialPricePatch, endpoint?: string): Promise<MaterialPriceHistory> {
    const data = await requestJson<{ ok: boolean; item: MaterialPriceHistory }>(`/v1/pricing/material-prices/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteMaterialPrice(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/pricing/material-prices/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },
  async getMaterialPriceTrend(params: { materialType: string; materialCode?: string; from?: string; to?: string }, endpoint?: string): Promise<MaterialPriceTrendPoint[]> {
    const query = new URLSearchParams({ materialType: params.materialType });
    if (params.materialCode) query.set('materialCode', params.materialCode);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    const data = await requestJson<{ items: MaterialPriceTrendPoint[] }>(`/v1/pricing/material-prices/trend?${query.toString()}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },

  // ── 阶段 P2: 佣金规则 CommissionRule API ──
  async listCommissionRules(includeInactive = false, endpoint?: string): Promise<CommissionRule[]> {
    const qs = includeInactive ? '?includeInactive=true' : '';
    const data = await requestJson<{ items: CommissionRule[]; total?: number }>(`/v1/pricing/commission-rules${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createCommissionRule(input: CommissionRuleInput, endpoint?: string): Promise<CommissionRule> {
    const data = await requestJson<{ ok: boolean; item: CommissionRule }>(`/v1/pricing/commission-rules`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async updateCommissionRule(id: string, patch: CommissionRulePatch, endpoint?: string): Promise<CommissionRule> {
    const data = await requestJson<{ ok: boolean; item: CommissionRule }>(`/v1/pricing/commission-rules/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async deleteCommissionRule(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/pricing/commission-rules/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P2: 电子画册 LookbookCatalog API ──
  async listLookbooks(params?: { status?: string }, endpoint?: string): Promise<LookbookCatalog[]> {
    const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
    const data = await requestJson<{ items: LookbookCatalog[]; total?: number }>(`/v1/lookbooks${qs}`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async createLookbook(input: { title: string; description?: string | null }, endpoint?: string): Promise<LookbookCatalog> {
    const data = await requestJson<{ ok: boolean; item: LookbookCatalog }>(`/v1/lookbooks`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },
  async getLookbook(id: string, endpoint?: string): Promise<LookbookCatalog> {
    const data = await requestJson<{ item: LookbookCatalog }>(`/v1/lookbooks/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
    return data.item;
  },
  async updateLookbook(id: string, patch: { title?: string; description?: string | null }, endpoint?: string): Promise<LookbookCatalog> {
    const data = await requestJson<{ ok: boolean; item: LookbookCatalog }>(`/v1/lookbooks/${encodeURIComponent(id)}`, { endpoint, method: 'PATCH', body: JSON.stringify(patch) });
    return data.item;
  },
  async setLookbookItems(id: string, items: LookbookItemInput[], endpoint?: string): Promise<LookbookCatalog> {
    const data = await requestJson<{ ok: boolean; item: LookbookCatalog }>(`/v1/lookbooks/${encodeURIComponent(id)}/items`, { endpoint, method: 'PUT', body: JSON.stringify({ items }) });
    return data.item;
  },
  async transitionLookbook(id: string, action: 'publish' | 'unpublish' | 'archive', endpoint?: string): Promise<LookbookCatalog> {
    const data = await requestJson<{ ok: boolean; item: LookbookCatalog }>(`/v1/lookbooks/${encodeURIComponent(id)}/${action}`, { endpoint, method: 'POST' });
    return data.item;
  },
  async deleteLookbook(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/lookbooks/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // ── 阶段 P2: 面料推荐 FabricRecommendation API ──
  async recommendFabrics(criteria: RecommendCriteria, endpoint?: string): Promise<FabricRecommendation> {
    const data = await requestJson<{ ok: boolean; item: FabricRecommendation }>(`/v1/fabric-recommendations/recommend`, { endpoint, method: 'POST', body: JSON.stringify(criteria) });
    return data.item;
  },
  async listFabricRecommendations(endpoint?: string): Promise<FabricRecommendation[]> {
    const data = await requestJson<{ items: FabricRecommendation[]; total?: number }>(`/v1/fabric-recommendations`, { endpoint, method: 'GET' });
    return data.items ?? [];
  },
  async deleteFabricRecommendation(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/fabric-recommendations/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async listDevelopmentCases(endpoint?: string): Promise<DevelopmentCase[]> {
    const data = await requestJson<{ ok: boolean; cases: DevelopmentCase[]; total: number }>('/v1/development', { endpoint, method: 'GET' });
    return Array.isArray(data.cases) ? data.cases : [];
  },

  /**
   * 客户档案列表（V2 三层视野，DR-042 v2.2）：L1 档案图书馆化——
   * normal 档案全公司可查 + confidential 仅本人维；条目携带 sensitivity 与 teamShares 徽章数据。
   * 旧 V1 端点无行级过滤（未设防的全可见），已切换至 V2 设计过的图书馆口径。
   * bizScope='mine'：L2 业务口径（P1-001）——followedBy ∪ teamGranted，
   * 供 CRM 等业务页下拉使用，防止默认选中无权客户触发 403。
   */
  async listRelations(endpoint?: string, params?: { bizScope?: 'mine' }): Promise<Relation[]> {
    const qs = params?.bizScope === 'mine' ? '&bizScope=mine' : '';
    const data = await requestJson<{ ok: boolean; items: Relation[]; total: number }>(`/v2/relations?limit=500${qs}`, { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  /**
   * 新建客户档案（V2 行级口径）：服务端自动填充归属三键——
   * ownerId=当前登录人、departmentId=归属部门、salesRepIds=[owner]、code=CUS-xxxxx。
   * 旧 V1 端点不填归属，建档后创建者在本人维视野里看不到自己的客户（已废弃）。
   */
  async saveRelation(relation: Relation, endpoint?: string): Promise<Relation> {
    const data = await requestJson<{ ok: boolean; relation: Relation }>('/v2/relations', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(relation),
    });
    return data.relation;
  },

  /** 更新客户档案（V2 行级口径：写 scope 校验——本人/全权角色可改，组共享只读） */
  async updateRelation(id: string, relation: Partial<Relation>, endpoint?: string): Promise<Relation> {
    const data = await requestJson<{ ok: boolean; relation: Relation }>(`/v2/relations/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'PUT',
      body: JSON.stringify(relation),
    });
    return data.relation;
  },

  async deleteRelation(id: string, endpoint?: string): Promise<Relation> {
    const data = await requestJson<{ ok: boolean; relation: Relation }>(`/v2/relations/${encodeURIComponent(id)}`, {
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

  async ingestKnowledgeText(input: { title: string; text: string; category: string; sourceType?: string; sourceUri?: string }, endpoint?: string): Promise<{ documentId: string; checksum: string; chunkCount: number; auditId: string }> {
    return requestJson('/v1/knowledge-documents/ingest-text', {
      endpoint,
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        text: input.text,
        sourceType: input.sourceType || 'manual',
        sourceUri: input.sourceUri || undefined,
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

  // ========== C7 知识库深化：SOP 模板 / 知识关联 / 智能问答 ==========

  async listSopTemplates(params?: { category?: string; status?: string }, endpoint?: string): Promise<SopTemplate[]> {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    const data = await requestJson<{ ok: boolean; items: SopTemplate[] }>(`/v1/knowledge/sop-templates${qs ? `?${qs}` : ''}`, {
      endpoint,
      method: 'GET',
    });
    return data.items || [];
  },

  async createSopTemplate(input: { title: string; category: string; summary?: string; content: string; steps?: SopStep[] }, endpoint?: string): Promise<SopTemplate> {
    const data = await requestJson<{ ok: boolean; item: SopTemplate }>('/v1/knowledge/sop-templates', {
      endpoint,
      method: 'POST',
      body: JSON.stringify(input),
    });
    return data.item;
  },

  async updateSopTemplate(id: string, input: Partial<{ title: string; category: string; summary: string | null; content: string; steps: SopStep[]; status: string }>, endpoint?: string): Promise<SopTemplate> {
    const data = await requestJson<{ ok: boolean; item: SopTemplate }>(`/v1/knowledge/sop-templates/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return data.item;
  },

  async deleteSopTemplate(id: string, endpoint?: string): Promise<void> {
    await requestJson(`/v1/knowledge/sop-templates/${encodeURIComponent(id)}`, {
      endpoint,
      method: 'DELETE',
    });
  },

  /** SOP 实例化：模板 → 知识文档（服务端渲染 + ingest 管线，sourceType='sop'） */
  async instantiateSopTemplate(id: string, endpoint?: string): Promise<{ documentId: string; checksum: string; chunkCount: number; templateVersion: number }> {
    return requestJson(`/v1/knowledge/sop-templates/${encodeURIComponent(id)}/instantiate`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /** 知识文档的实体关联（正向） */
  async listKnowledgeDocumentRelations(docId: string, endpoint?: string): Promise<KnowledgeRelationView[]> {
    const data = await requestJson<{ ok: boolean; items: KnowledgeRelationView[] }>(`/v1/knowledge/graph/document/${encodeURIComponent(docId)}/relations`, {
      endpoint,
      method: 'GET',
    });
    return data.items || [];
  },

  /** 业务实体的知识关联 + 实体链接（反向） */
  async listKnowledgeEntityRelations(targetType: string, targetId: string, endpoint?: string): Promise<{ knowledge: KnowledgeRelationView[]; entityLinks: EntityLinkView[] }> {
    return requestJson(`/v1/knowledge/graph/entity/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/relations`, {
      endpoint,
      method: 'GET',
    });
  },

  /** 向量检索（Python knowledge_api 直调，Bearer 鉴权）— 问答引用片段 */
  async searchKnowledgeBase(query: string, topK?: number): Promise<KnowledgeCitation[]> {
    const config = this.getStoredConfig();
    const base = (config.knowledgeApiEndpoint || '').replace(/\/$/, '');
    const res = await fetch(`${base}/v1/knowledge/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.knowledgeApiKey ? { Authorization: `Bearer ${config.knowledgeApiKey}` } : {}),
      },
      body: JSON.stringify({ query, top_k: topK }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || `knowledge search failed: HTTP ${res.status}`);
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((r: any) => ({
      id: String(r?.id ?? ''),
      title: String(r?.source_title ?? '未命名片段'),
      content: String(r?.content ?? ''),
      score: typeof r?.score === 'number' ? r.score : 0,
    }));
  },

  /** 智能问答（Python knowledge_api /v1/chat，RAG + DeepSeek 流式）；onChunk 逐段回调 */
  async askKnowledgeBase(message: string, onChunk: (piece: string) => void): Promise<void> {
    const config = this.getStoredConfig();
    const base = (config.knowledgeApiEndpoint || '').replace(/\/$/, '');
    const res = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.knowledgeApiKey ? { Authorization: `Bearer ${config.knowledgeApiKey}` } : {}),
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || `knowledge chat failed: HTTP ${res.status}`);
    }
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = decoder.decode(value, { stream: true });
      if (piece) onChunk(piece);
    }
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

  // ── Phase 5 B5 + Phase 3 C6: 外贸与报关 API ──

  // CustomsDeclaration（报关单）
  async listCustomsDeclarations(params?: {
    type?: string;
    status?: string;
    shipmentId?: string;
    orderId?: string;
    relationId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }, endpoint?: string): Promise<{ items: CustomsDeclaration[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.shipmentId) query.set('shipmentId', params.shipmentId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.relationId) query.set('relationId', params.relationId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return requestJson<{ items: CustomsDeclaration[]; total: number }>(`/v1/customs/declarations${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  async getCustomsDeclaration(id: string, endpoint?: string): Promise<CustomsDeclaration> {
    const data = await requestJson<{ item: CustomsDeclaration }>(`/v1/customs/declarations/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
    return data.item;
  },

  async createCustomsDeclaration(input: CustomsDeclarationInput, endpoint?: string): Promise<CustomsDeclaration> {
    const data = await requestJson<{ item: CustomsDeclaration }>(`/v1/customs/declarations`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateCustomsDeclaration(id: string, input: Partial<CustomsDeclarationInput>, endpoint?: string): Promise<CustomsDeclaration> {
    const data = await requestJson<{ item: CustomsDeclaration }>(`/v1/customs/declarations/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteCustomsDeclaration(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/customs/declarations/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async transitionCustomsDeclarationStatus(id: string, toStatus: CustomsDeclarationStatus, endpoint?: string): Promise<CustomsDeclaration> {
    const data = await requestJson<{ item: CustomsDeclaration }>(`/v1/customs/declarations/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStatus }) });
    return data.item;
  },

  // HsCode（HS 编码库）
  async listHsCodes(params?: { category?: string; search?: string; isActive?: boolean; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: HsCode[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return requestJson<{ items: HsCode[]; total: number }>(`/v1/customs/hs-codes${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  async getHsCodeByCode(code: string, endpoint?: string): Promise<HsCode> {
    const data = await requestJson<{ item: HsCode }>(`/v1/customs/hs-codes/${encodeURIComponent(code)}`, { endpoint, method: 'GET' });
    return data.item;
  },

  async createHsCode(input: HsCodeInput, endpoint?: string): Promise<HsCode> {
    const data = await requestJson<{ item: HsCode }>(`/v1/customs/hs-codes`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateHsCode(id: string, input: Partial<HsCodeInput>, endpoint?: string): Promise<HsCode> {
    const data = await requestJson<{ item: HsCode }>(`/v1/customs/hs-codes/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteHsCode(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/customs/hs-codes/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  // LetterOfCredit（信用证）
  async listLettersOfCredit(params?: { status?: string; relationId?: string; orderId?: string; search?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: LetterOfCredit[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.relationId) query.set('relationId', params.relationId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return requestJson<{ items: LetterOfCredit[]; total: number }>(`/v1/customs/letters-of-credit${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  async getLetterOfCredit(id: string, endpoint?: string): Promise<LetterOfCredit> {
    const data = await requestJson<{ item: LetterOfCredit }>(`/v1/customs/letters-of-credit/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
    return data.item;
  },

  async createLetterOfCredit(input: LetterOfCreditInput, endpoint?: string): Promise<LetterOfCredit> {
    const data = await requestJson<{ item: LetterOfCredit }>(`/v1/customs/letters-of-credit`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateLetterOfCredit(id: string, input: Partial<LetterOfCreditInput>, endpoint?: string): Promise<LetterOfCredit> {
    const data = await requestJson<{ item: LetterOfCredit }>(`/v1/customs/letters-of-credit/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteLetterOfCredit(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/customs/letters-of-credit/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async transitionLetterOfCreditStatus(id: string, toStatus: LetterOfCreditStatus, discrepancies?: string, endpoint?: string): Promise<LetterOfCredit> {
    const body: Record<string, string> = { toStatus };
    if (discrepancies !== undefined) body.discrepancies = discrepancies;
    const data = await requestJson<{ item: LetterOfCredit }>(`/v1/customs/letters-of-credit/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify(body) });
    return data.item;
  },

  /** F1：信用证节点时间轴 */
  async listLetterOfCreditEvents(id: string, endpoint?: string): Promise<{ items: LcEvent[]; total: number }> {
    return requestJson<{ items: LcEvent[]; total: number }>(`/v1/customs/letters-of-credit/${encodeURIComponent(id)}/events`, { endpoint, method: 'GET' });
  },

  // TaxRefund（出口退税）
  async listTaxRefunds(params?: { status?: string; declarationId?: string; orderId?: string; relationId?: string; search?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: TaxRefund[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.declarationId) query.set('declarationId', params.declarationId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.relationId) query.set('relationId', params.relationId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return requestJson<{ items: TaxRefund[]; total: number }>(`/v1/customs/tax-refunds${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  async getTaxRefund(id: string, endpoint?: string): Promise<TaxRefund> {
    const data = await requestJson<{ item: TaxRefund }>(`/v1/customs/tax-refunds/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
    return data.item;
  },

  async createTaxRefund(input: TaxRefundInput, endpoint?: string): Promise<TaxRefund> {
    const data = await requestJson<{ item: TaxRefund }>(`/v1/customs/tax-refunds`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateTaxRefund(id: string, input: Partial<TaxRefundInput>, endpoint?: string): Promise<TaxRefund> {
    const data = await requestJson<{ item: TaxRefund }>(`/v1/customs/tax-refunds/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteTaxRefund(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/customs/tax-refunds/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async transitionTaxRefundStatus(id: string, toStatus: TaxRefundStatus, endpoint?: string): Promise<TaxRefund> {
    const data = await requestJson<{ item: TaxRefund }>(`/v1/customs/tax-refunds/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStatus }) });
    return data.item;
  },

  async reviewTaxRefund(id: string, input: TaxRefundReviewInput, endpoint?: string): Promise<TaxRefund> {
    const data = await requestJson<{ item: TaxRefund }>(`/v1/customs/tax-refunds/${encodeURIComponent(id)}/review`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  // TradeDocument（贸易单据）
  async listTradeDocuments(params?: { type?: string; status?: string; shipmentId?: string; declarationId?: string; orderId?: string; relationId?: string; search?: string; limit?: number; offset?: number }, endpoint?: string): Promise<{ items: TradeDocument[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.shipmentId) query.set('shipmentId', params.shipmentId);
    if (params?.declarationId) query.set('declarationId', params.declarationId);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.relationId) query.set('relationId', params.relationId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return requestJson<{ items: TradeDocument[]; total: number }>(`/v1/customs/trade-documents${qs ? '?' + qs : ''}`, { endpoint, method: 'GET' });
  },

  async getTradeDocument(id: string, endpoint?: string): Promise<TradeDocument> {
    const data = await requestJson<{ item: TradeDocument }>(`/v1/customs/trade-documents/${encodeURIComponent(id)}`, { endpoint, method: 'GET' });
    return data.item;
  },

  async createTradeDocument(input: TradeDocumentInput, endpoint?: string): Promise<TradeDocument> {
    const data = await requestJson<{ item: TradeDocument }>(`/v1/customs/trade-documents`, { endpoint, method: 'POST', body: JSON.stringify(input) });
    return data.item;
  },

  async updateTradeDocument(id: string, input: Partial<TradeDocumentInput>, endpoint?: string): Promise<TradeDocument> {
    const data = await requestJson<{ item: TradeDocument }>(`/v1/customs/trade-documents/${encodeURIComponent(id)}`, { endpoint, method: 'PUT', body: JSON.stringify(input) });
    return data.item;
  },

  async deleteTradeDocument(id: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/customs/trade-documents/${encodeURIComponent(id)}`, { endpoint, method: 'DELETE' });
  },

  async transitionTradeDocumentStatus(id: string, toStatus: TradeDocumentStatus, endpoint?: string): Promise<TradeDocument> {
    const data = await requestJson<{ item: TradeDocument }>(`/v1/customs/trade-documents/${encodeURIComponent(id)}/transition`, { endpoint, method: 'POST', body: JSON.stringify({ toStatus }) });
    return data.item;
  },

  // ── Wave A1 单据中心：版本 / 生成即登记 / 批量打包 ──

  async listTradeDocumentVersions(id: string, endpoint?: string): Promise<{ items: DocumentVersionRecord[]; total: number }> {
    return requestJson<{ items: DocumentVersionRecord[]; total: number }>(`/v1/customs/trade-documents/${encodeURIComponent(id)}/versions`, { endpoint, method: 'GET' });
  },

  async getTradeDocumentVersion(id: string, version: number, endpoint?: string): Promise<DocumentVersionRecord> {
    const data = await requestJson<{ item: DocumentVersionRecord }>(`/v1/customs/trade-documents/${encodeURIComponent(id)}/versions/${version}`, { endpoint, method: 'GET' });
    return data.item;
  },

  async generateTradeDocumentsFromShipment(params: { shipmentId: string; types: TradeDocumentType[] }, endpoint?: string): Promise<GenerateTradeDocumentsResult> {
    return requestJson<GenerateTradeDocumentsResult>(`/v1/customs/trade-documents/generate-from-shipment`, { endpoint, method: 'POST', body: JSON.stringify(params) });
  },

  async packTradeDocumentsByOrder(orderId: string, endpoint?: string): Promise<{ items: TradeDocumentPackItem[]; total: number }> {
    return requestJson<{ items: TradeDocumentPackItem[]; total: number }>(`/v1/customs/trade-documents/pack?orderId=${encodeURIComponent(orderId)}`, { endpoint, method: 'GET' });
  },

  // Customs Overview
  async getCustomsOverview(endpoint?: string): Promise<CustomsOverview> {
    return requestJson<CustomsOverview>('/v1/customs/overview', { endpoint, method: 'GET' });
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

  // PRD 7.1「忽略需填原因」：忽略通知（乐观移除由调用方处理；原因用于推送准确率优化）
  async dismissNotification(notificationId: string, reason: string, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/notifications/${encodeURIComponent(notificationId)}/dismiss`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // ── D2 主动提醒引擎：偏好控制面 + 转跟进闭环 ──
  async getNotificationTypeCatalog(endpoint?: string): Promise<NotificationTypeCatalogItem[]> {
    const data = await requestJson<{ items: NotificationTypeCatalogItem[] }>('/v1/notifications/catalog', { endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async upsertNotificationPreference(notificationType: string, isEnabled: boolean, endpoint?: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/v1/notifications/preferences/${encodeURIComponent(notificationType)}`, {
      endpoint,
      method: 'PUT',
      body: JSON.stringify({ isEnabled }),
    });
  },

  async convertNotificationToFollowUp(notificationId: string, endpoint?: string): Promise<{ reused: boolean; followUpId?: string; nextFollowUpAt?: string | null }> {
    const data = await requestJson<{ ok: boolean; reused?: boolean; followUpId?: string; nextFollowUpAt?: string | null; error?: string; message?: string }>(
      `/v1/notifications/${encodeURIComponent(notificationId)}/convert-to-followup`,
      { endpoint, method: 'POST' },
    );
    if (!data.ok) throw new Error(data.message || data.error || '转跟进失败');
    return { reused: data.reused ?? false, followUpId: data.followUpId, nextFollowUpAt: data.nextFollowUpAt ?? null };
  },

  // ── 业务审批中心（PRD 19.21；JWT+角色门禁由服务端强制，未登录/无权限时抛错由 UI 降级处理）──
  async listApprovals(params?: { status?: 'pending' | 'done'; endpoint?: string }): Promise<ApprovalRequestItem[]> {
    const query = params?.status === 'done' ? '?status=done' : '';
    const data = await requestJson<{ items: ApprovalRequestItem[] }>(`/v1/approvals${query}`, { endpoint: params?.endpoint, method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  },

  async decideApproval(approvalId: string, status: Exclude<ApprovalRequestStatus, 'pending'>, decisionNote?: string, endpoint?: string): Promise<ApprovalRequestItem> {
    const data = await requestJson<{ item: ApprovalRequestItem }>(`/v1/approvals/${encodeURIComponent(approvalId)}/decide`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ status, decisionNote }),
    });
    return data.item;
  },

  // ── 平台配置：公司档案（W7 设置域 §1A 裁决；真源服务端 SystemConfig global::company.exporterProfile）──
  async getCompanyExporterProfile(endpoint?: string): Promise<CompanyExporterProfileResponse> {
    return requestJson<CompanyExporterProfileResponse>('/v1/config/company.exporterProfile', { endpoint, method: 'GET' });
  },

  async updateCompanyExporterProfile(
    payload: { value: CompanyExporterProfileValue; reason?: string },
    endpoint?: string,
  ): Promise<CompanyExporterProfileUpdateResponse> {
    return requestJson<CompanyExporterProfileUpdateResponse>('/v1/config/company.exporterProfile', {
      endpoint,
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async listCompanyExporterProfileHistory(
    params: { limit?: number } = {},
    endpoint?: string,
  ): Promise<CompanyExporterProfileHistoryItem[]> {
    const query = params.limit ? `?limit=${encodeURIComponent(String(params.limit))}` : '';
    const data = await requestJson<{ items: CompanyExporterProfileHistoryItem[] }>(
      `/v1/config/company.exporterProfile/history${query}`,
      { endpoint, method: 'GET' },
    );
    return Array.isArray(data.items) ? data.items : [];
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
  },

  // ── 工作流引擎 ──
  async listWorkflowDefinitions(endpoint?: string): Promise<WorkflowDefinition[]> {
    const data = await requestJson<{ definitions: WorkflowDefinition[] }>('/v1/workflow/definitions', { endpoint, method: 'GET' });
    return data.definitions || [];
  },

  async listWorkflowInstances(params: {
    status?: string;
    entityType?: string;
    entityId?: string;
    pendingApproverUserId?: string;
    pendingApproverRole?: string;
    limit?: number;
    offset?: number;
    endpoint?: string;
  } = {}): Promise<{ items: WorkflowInstance[]; total: number }> {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const path = query ? `/v1/workflow/instances?${query}` : '/v1/workflow/instances';
    return requestJson<{ items: WorkflowInstance[]; total: number }>(path, {
      endpoint: params.endpoint,
      method: 'GET',
    });
  },

  async getWorkflowInstance(instanceId: string, endpoint?: string): Promise<WorkflowInstance> {
    const data = await requestJson<{ instance: WorkflowInstance }>(`/v1/workflow/instances/${encodeURIComponent(instanceId)}`, { endpoint, method: 'GET' });
    return data.instance;
  },

  async createWorkflowInstance(params: {
    definitionId: string;
    entityType: string;
    entityId: string;
    title?: string;
    endpoint?: string;
  }): Promise<WorkflowInstance> {
    const data = await requestJson<{ instance: WorkflowInstance }>('/v1/workflow/instances', {
      endpoint: params.endpoint,
      method: 'POST',
      body: JSON.stringify({
        definitionId: params.definitionId,
        entityType: params.entityType,
        entityId: params.entityId,
        title: params.title,
      }),
    });
    return data.instance;
  },

  async approveWorkflowStep(instanceId: string, note?: string, endpoint?: string): Promise<WorkflowInstance> {
    const data = await requestJson<{ instance: WorkflowInstance }>(`/v1/workflow/instances/${encodeURIComponent(instanceId)}/approve`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    return data.instance;
  },

  async rejectWorkflowStep(instanceId: string, note?: string, endpoint?: string): Promise<WorkflowInstance> {
    const data = await requestJson<{ instance: WorkflowInstance }>(`/v1/workflow/instances/${encodeURIComponent(instanceId)}/reject`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    return data.instance;
  },

  async cancelWorkflowInstance(instanceId: string, reason?: string, endpoint?: string): Promise<WorkflowInstance> {
    const data = await requestJson<{ instance: WorkflowInstance }>(`/v1/workflow/instances/${encodeURIComponent(instanceId)}/cancel`, {
      endpoint,
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return data.instance;
  },

  async getEntityWorkflowHistory(entityType: string, entityId: string, endpoint?: string): Promise<WorkflowInstance[]> {
    const data = await requestJson<{ instances: WorkflowInstance[] }>(`/v1/workflow/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, { endpoint, method: 'GET' });
    return data.instances || [];
  },
};
