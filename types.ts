
export enum View {
  Dashboard = 'dashboard',
  Cockpit = 'cockpit',
  Assistant = 'assistant',
  Relations = 'relations',
  Products = 'products',
  DataCenter = 'data-center',
  Orders = 'orders',
  ProductionBoard = 'production-board',
  Quotations = 'quotations',
  Procurement = 'procurement',
  Inventory = 'inventory',
  BOM = 'bom',
  CRM = 'crm',
  Suppliers = 'suppliers',
  Seasons = 'seasons',
  Risks = 'risks',
  MES = 'mes',
  Customs = 'customs',
  DocumentCenter = 'document-center',
  Invoices = 'invoices',
  PaymentVouchers = 'payment-vouchers',
  Shipments = 'shipments',
  Development = 'development',
  Emails = 'emails',
  Settings = 'settings',
  AccountSettings = 'account-settings',
  SystemSettings = 'system-settings',
  BusinessTools = 'business-tools',
  UiLab = 'ui-lab',
  AdminPanel = 'admin-panel',
  HR = 'hr',
  QcWorkbench = 'qc-workbench',
  Pricing = 'pricing',
  Marketing = 'marketing',
  Reports = 'reports',
}

export interface WallpaperOption {
  id: string;
  title: string;
  url: string;
  group: string;
  hidden?: boolean;
  assetId?: string;
  sortOrder?: number;
}

export interface SystemAsset {
  id: string;
  kind: 'wallpaper';
  title: string;
  group: string;
  filePath?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  sortOrder: number;
  hidden: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  fileUrl: string;
}

export interface SystemConfig {
  /** 预留：助手显示名（当前界面多为固定文案） */
  agentName?: string;
  /** 预留：助手角色描述 */
  agentRole?: string;

  // Cloud & Connectivity
  cloudEndpoint: string;
  knowledgeApiEndpoint?: string;
  knowledgeApiKey?: string;
  databaseId: string;
  isCloudConnected: boolean;
  isRootActive: boolean;
  syncInterval: number;

  // Visuals
  themeMode?: 'system' | 'light' | 'dark';
  compactMode?: boolean;
  backgroundImage?: string;
  systemWallpaperOptions?: WallpaperOption[];
  enableProductionGlobe?: boolean;

  // AI Core — chatModelId 与 lib/ai/client MODELS 中的模型 ID 一致
  chatModelId?: string;
  temperature?: number;
  maxTokens?: number;
  enableVision?: boolean;

  // Voice & Interaction
  ttsProvider?: 'Browser' | 'Volcengine-TTS' | 'OpenAI-TTS';
  voiceSpeed?: number;

  // SDK API - AI 助理集成（本客户端连后端凭据，归宿 Settings「同步/连接」Tab）
  sdkApiKey?: string;
  sdkAuthMode?: 'auto' | 'required' | 'none';
}

export interface BusinessProfile<TPayload = Record<string, unknown>, TAssets = Record<string, unknown>> {
  id: string;
  kind: string;
  name: string;
  payload: TPayload;
  assets?: TAssets | null;
  isActive: boolean;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface BusinessProfileInput<TPayload = Record<string, unknown>, TAssets = Record<string, unknown>> {
  id?: string;
  kind: string;
  name: string;
  payload: TPayload;
  assets?: TAssets | null;
  isActive?: boolean;
}

// [KNOWLEDGE BASE] - 用于业务运行时
// 包含实际的业务数据：产品知识、客户政策、生产流程
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: 'Product' | 'Policy' | 'Customer' | 'Production' | 'Company' | 'Supplier';
  updatedAt: number;
  deletedAt?: number;
  sourceUrl?: string;
}

// ─── C7 知识库深化 ───

/** SOP 结构化步骤 */
export interface SopStep {
  title: string;
  detail?: string;
}

/** SOP 标准作业程序模板（server/src/knowledge/sopTemplateService.ts 契约） */
export interface SopTemplate {
  id: string;
  title: string;
  category: string;
  summary?: string | null;
  content: string;
  steps: SopStep[];
  version: number;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

/** 知识文档 → 业务实体关联（KnowledgeRelation 视图） */
export interface KnowledgeRelationView {
  id: string;
  documentId?: string | null;
  documentTitle?: string | null;
  chunkId?: string | null;
  relationType: string;
  targetType: string;
  targetId: string;
  confidence: number;
  createdAt: number;
}

/** 业务实体 ↔ 业务实体链接（EntityLink 视图） */
export interface EntityLinkView {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  linkKind: string;
  confidence?: number | null;
  source?: string | null;
}

/** 向量检索命中片段（Python knowledge_api /v1/knowledge/search 契约） */
export interface KnowledgeCitation {
  id: string;
  title: string;
  content: string;
  score: number;
}

export type RelationCategory = 'Supplier' | 'Customer' | 'Agent' | 'Partner' | 'Government' | 'Internal' | 'Other';

export interface Relation {
  id: string;
  name: string;
  category: RelationCategory;
  /** 业务子类（自由文本，如 Fabric Mill / Trading Agent / Freight Forwarder）；方向分组一律用 category */
  type: string;
  isOrganization: boolean;
  parentId?: string;
  reportsToId?: string;
  role?: string;
  department?: string;
  tags: string[];
  contactInfo: string;  // 主要联系方式 (email/phone)
  rating: number;
  lastInteraction: number;
  preferences: string;
  deletedAt?: number;

  // ========== 组织专属字段 ==========
  chineseName?: string | null;         // 中文名称
  englishName?: string | null;         // 英文名称
  creditLevel?: string | null;         // 旧字段：信用等级已统一使用 rating/Tier 1-5
  summary?: string | null;             // 组织简介
  primaryContactName?: string | null;  // 主联系对象
  primaryContactEmail?: string | null; // 主联系邮箱
  primaryContactPhone?: string | null; // 主联系电话
  backupContacts?: Array<{
    name?: string;
    email?: string;
    phone?: string;
    note?: string;
    text?: string;
  }>;
  shipToAddresses?: Array<{
    contactName?: string;
    city?: string;
    address?: string;
    phone?: string;
    note?: string;
    text?: string;
  }>;
  financialNotes?: string | null;      // 财务备注 / 付款详细信息
  website?: string;              // 公司官网
  paymentTerms?: string;         // 付款条款 (Net 30, T/T, L/C)
  paymentPreference?: string;    // 付款偏好说明
  currency?: string;             // 交易币种 (USD, CNY, EUR)
  taxId?: string;                // 税号 / 统一社会信用代码
  creditLimit?: number;          // 信用额度

  // 地址信息 (组织专属)
  officialAddress?: string;      // 公司注册地址
  factoryAddresses?: string[];   // 工厂地址列表 (可多个)
  warehouseAddress?: string;     // 仓库地址
  billingAddress?: string;       // 账单地址
  shippingAddress?: string;      // 发货地址
  coordinates?: {                // 实际地理位置 (用于地图展示)
    lat: number;
    lng: number;
  };

  // ========== 联系人专属字段 ==========
  email?: string;                 // 邮箱
  phone?: string;                 // 座机电话
  mobile?: string;                // 手机号码
  wechat?: string;                // 微信号
  whatsapp?: string;              // WhatsApp
  otherContacts?: Array<{         // 动态添加的其他联系方式
    type: string;                 // e.g. 'LinkedIn', 'Telegram', 'Skype'
    value: string;
  }>;
  birthday?: string;              // 生日 (YYYY-MM-DD)
  language?: string;              // 语言偏好 (zh-CN, en-US)
  timezone?: string;              // 时区 (Asia/Shanghai)
  personalNote?: string;          // 个人备注
  // 联系人统一（自 Contact 实体并入）：仅 isOrganization=false 的人物记录消费
  isPrimary?: boolean;            // 主联系人标记（同组织下唯一，独占切换）
  isDecisionMaker?: boolean;      // 决策人标记
  contactStatus?: string;         // 联系人状态 Active | Inactive | Left
}

// [v2.4 Products Architecture]
export type MainCategory = 'Garment' | 'Fabric' | 'Accessories' | 'Trimmings' | 'Merchandise' | 'Other';

export interface ProductSubCategory {
  id: string;
  mainCategory: MainCategory;
  name: string;
  description?: string;
  updatedAt: number;
  deletedAt?: number;
}

export interface ProductAsset {
  id: string;
  sku: string;
  name: string;
  mainCategory: MainCategory;
  subCategoryId: string;
  season: string;
  techPackUrl?: string;
  imageUrl?: string;
  cost: number;
  status: 'Development' | 'Active' | 'Archived' | '开发样' | '产前样' | '大货样';
  updatedAt: number;
  deletedAt?: number;
  fabricProfile?: FabricProfile | null;
  garmentProfile?: GarmentProfile | null;
  trimmingProfile?: TrimmingProfile | null;
  classificationLinks?: ProductClassificationLink[];
  fabricCustomerCodes?: FabricCustomerCode[];
  fabricPrices?: FabricPriceHistory[];
  fabricCertifications?: FabricCertification[];
  compositionLines?: FabricCompositionLine[];
  images?: ProductImage[];
}

export interface ProductImage {
  id: string;
  productAssetId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
  isPrimary: boolean;
  uploadedAt: number;
  deletedAt?: number;
  url?: string;
}

export interface PdmlRawFabric {
  id: string;
  gsid: string;
  sourceId: string;
  rawData: Record<string, unknown>;
  sourceHash: string;
  articleNo?: string | null;
  factoryArticleNo?: string | null;
  colorCode?: string | null;
  factoryColorCode?: string | null;
  supplierName?: string | null;
  productLine?: string | null;
  registeredDate?: string | null;
  imageUrl?: string | null;
  sourceStatus?: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  syncedAt: number;
  deletedAt?: number | null;
}

export interface PdmlSyncResult {
  ok: boolean;
  source: 'PDML V_MLXX';
  gsid: string;
  totalAvailable: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  syncedAt: number;
}

export interface PdmlSyncJob {
  ok: boolean;
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  gsid?: string;
  startedAt?: number;
  finishedAt?: number;
  result?: PdmlSyncResult;
  error?: string;
}

export interface PdmlMapResult {
  ok: boolean;
  source: 'PDML raw cache';
  gsid: string;
  total: number;
  limit: number;
  offset: number;
  mapped: number;
  created: number;
  updated: number;
  skipped: number;
  hasMore: boolean;
  updatedAt: number;
}

export interface FabricProfile {
  id: string;
  productAssetId: string;
  articleNo?: string | null;
  millOrganizationId?: string | null;
  millName?: string | null;
  millQuality?: string | null;
  millColorCode?: string | null;
  colorDescription?: string | null;
  construction?: string | null;
  yarnCount?: string | null;
  pattern?: string | null;
  weightValue?: number | null;
  weightUnit?: string | null;
  widthValue?: number | null;
  widthUnit?: string | null;
  widthText?: string | null;
  productionLeadDays?: number | null;
  referenceBatch?: string | null;
  stockStatus?: string | null;
  stockQuantity?: number | null;
  stockUnit?: string | null;
  moqValue?: number | null;
  factoryMoqValue?: number | null;
  sampleMoqValue?: number | null;
  riskNote?: string | null;
  specialNote?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface GarmentProfile {
  id: string;
  productAssetId: string;
  styleNo?: string | null;
  productName?: string | null;
  garmentCategory?: string | null;
  collection?: string | null;
  customer?: string | null;
  customerRelationId?: string | null;
  factoryRelationId?: string | null;
  brand?: string | null;
  project?: string | null;
  gender?: string | null;
  ageGroup?: string | null;
  tags?: string | null;
  silhouette?: string | null;
  fit?: string | null;
  collarType?: string | null;
  sleeveType?: string | null;
  closureType?: string | null;
  pocketDetails?: string | null;
  hemDetails?: string | null;
  waistbandDetails?: string | null;
  liningStructure?: string | null;
  interlining?: string | null;
  shoulderPad?: string | null;
  stitchDetails?: string | null;
  constructionNote?: string | null;
  mainFabric?: string | null;
  contrastFabric?: string | null;
  liningFabric?: string | null;
  ribFabric?: string | null;
  pocketingFabric?: string | null;
  button?: string | null;
  zipper?: string | null;
  snapsEyelets?: string | null;
  thread?: string | null;
  labelTrims?: string | null;
  packaging?: string | null;
  materialUsage?: string | null;
  substituteMaterials?: string | null;
  sizeRange?: string | null;
  baseSize?: string | null;
  measurementPoints?: string | null;
  sizeSpec?: string | null;
  tolerance?: string | null;
  gradingRule?: string | null;
  shrinkageAllowance?: string | null;
  garmentWeight?: string | null;
  colorways?: string | null;
  customerColorCodes?: string | null;
  fabricColorCodes?: string | null;
  garmentSku?: string | null;
  barcode?: string | null;
  availableSizes?: string | null;
  colorImageNotes?: string | null;
  moq?: string | null;
  sampleVersion?: string | null;
  patternMaker?: string | null;
  merchandiser?: string | null;
  owner?: string | null;
  revisionHistory?: string | null;
  fittingComments?: string | null;
  customerComments?: string | null;
  confirmedDate?: string | null;
  techPackVersion?: string | null;
  factory?: string | null;
  orderQuantity?: string | null;
  deliveryDate?: string | null;
  targetCost?: string | null;
  fobPrice?: string | null;
  exwPrice?: string | null;
  retailPrice?: string | null;
  inspectionStandard?: string | null;
  commonDefects?: string | null;
  washFinishing?: string | null;
  careLabel?: string | null;
  complianceTests?: string | null;
  packingMethod?: string | null;
  cartonSpec?: string | null;
  countryOfOrigin?: string | null;
  qualityNote?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface TrimmingProfile {
  id: string;
  productAssetId: string;
  trimmingCode?: string | null;
  trimmingName?: string | null;
  trimmingCategory?: string | null;
  material?: string | null;
  specification?: string | null;
  size?: string | null;
  color?: string | null;
  colorCode?: string | null;
  finish?: string | null;
  supplier?: string | null;
  supplierRelationId?: string | null;
  factory?: string | null;
  brand?: string | null;
  customer?: string | null;
  applicableProducts?: string | null;
  usagePosition?: string | null;
  unit?: string | null;
  unitConsumption?: string | null;
  moq?: string | null;
  leadTime?: string | null;
  stockStatus?: string | null;
  stockQuantity?: number | null;
  stockUnit?: string | null;
  price?: string | null;
  currency?: string | null;
  complianceTests?: string | null;
  qualityStandard?: string | null;
  riskNote?: string | null;
  packaging?: string | null;
  careRequirement?: string | null;
  notes?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface ProductClassification {
  id: string;
  mainCategory: MainCategory;
  dimension: 'category' | 'supplier' | 'customer' | 'certification' | 'price' | 'status' | string;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface ProductClassificationLink {
  id: string;
  productAssetId: string;
  classificationId: string;
  updatedAt: number;
  deletedAt?: number | null;
  classification?: ProductClassification;
}

export interface MaterialCompositionTerm {
  id: string;
  abbreviation?: string | null;
  chineseName: string;
  englishName?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface FabricCompositionLine {
  id: string;
  productAssetId: string;
  termId: string;
  percentage: number;
  sortOrder: number;
  updatedAt: number;
  deletedAt?: number | null;
  term?: MaterialCompositionTerm;
}

export interface FabricCustomerCode {
  id: string;
  productAssetId: string;
  customerOrganizationId?: string | null;
  customerNameSnapshot?: string | null;
  clientCode: string;
  note?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface FabricPriceHistory {
  id: string;
  productAssetId: string;
  priceType: 'factory' | 'customer' | 'sample' | 'cutting' | string;
  amount: number;
  currency: string;
  unit?: string | null;
  customerOrganizationId?: string | null;
  sourceType?: 'order' | 'sample' | 'manual' | string | null;
  sourceId?: string | null;
  effectiveDate?: string | null;
  note?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface FabricCertification {
  id: string;
  productAssetId: string;
  certification: string;
  certificateNo?: string | null;
  validUntil?: string | null;
  note?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export type ProductAssetDetail = ProductAsset & {
  fabricProfile?: FabricProfile | null;
  garmentProfile?: GarmentProfile | null;
  trimmingProfile?: TrimmingProfile | null;
  classificationLinks: ProductClassificationLink[];
  fabricCustomerCodes: FabricCustomerCode[];
  fabricPrices: FabricPriceHistory[];
  fabricCertifications: FabricCertification[];
  compositionLines: FabricCompositionLine[];
};

export interface CreateProductAssetInput {
  id?: string;
  sku: string;
  name: string;
  mainCategory: MainCategory;
  subCategoryId?: string;
  season?: string;
  techPackUrl?: string | null;
  imageUrl?: string | null;
  cost?: number;
  status?: ProductAsset['status'];
  fabricProfile?: Partial<Omit<FabricProfile, 'id' | 'productAssetId' | 'updatedAt' | 'deletedAt'>> & { id?: string };
  garmentProfile?: Partial<Omit<GarmentProfile, 'id' | 'productAssetId' | 'updatedAt' | 'deletedAt'>> & { id?: string };
  trimmingProfile?: Partial<Omit<TrimmingProfile, 'id' | 'productAssetId' | 'updatedAt' | 'deletedAt'>> & { id?: string };
}

/**
 * Per-field provenance tag. Used by the server to skip overwriting fields the
 * user has manually edited when re-importing the same PO PDF.
 *
 *   'pdf'                  - value originated from PDF import and has not been touched
 *   'manual'               - value was typed/edited by a user (must NOT be overwritten by re-import)
 *   'imported-then-edited' - was imported, then later edited; treated like 'manual' for protection
 */
export type FieldSourceTag = 'pdf' | 'manual' | 'imported-then-edited';

export interface Order {
  id: string;
  customer: string;
  product: string;
  type: 'Fabric' | 'Garment' | 'Other';
  factoryLat?: number;
  factoryLon?: number;
  quantity: number;
  /** 数量单位：面料默认 Meter，成衣默认 Pcs，其他默认 KG。可由录入表单手动选择。 */
  unit?: string;
  status: 'Pending' | 'Confirmed' | 'Production' | 'Shipping' | 'Delivered' | 'Alert';
  dueDate: string; // This is often used as clientDate
  quoteAmount: number; // This is often used as contractAmount
  orderDate?: number;
  updatedAt?: number;
  deletedAt?: number;

  // ========== Per-field provenance (字段级覆盖保护) ==========
  /** PDF re-import will not overwrite a field whose source is 'manual' or 'imported-then-edited'. */
  fieldSources?: Record<string, FieldSourceTag>;

  // ========== Currency split (双币种) ==========
  /** Currency for purchase-side amounts (purchasePrice / supplierInvoiceAmount). Default CNY. */
  purchaseCurrency?: string;
  /** Currency for sales-side amounts (salesPrice / contractAmount / shipmentAmount / actualPaymentAmount). Default USD. */
  salesCurrency?: string;

  // ========== Role: Customer (Peerless 等) ==========
  customerAddress?: string;
  customerRelationId?: string;

  // ========== Role: Mill / 面料工厂 / 供应商（应付侧） ==========
  millName?: string;
  millAddress?: string;
  millContact?: string;
  millPhone?: string;
  millRelationId?: string;

  // ========== Role: Consignee / 服装厂收货方（物流目的地） ==========
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeContact?: string;
  consigneeRelationId?: string;

  // ========== Role: Bill-to / 结款方（服装厂或其代理） ==========
  billToName?: string;
  billToAddress?: string;
  billToContact?: string;
  /** True when bill-to is an agent acting on behalf of consignee. */
  billToIsAgent?: boolean;
  billToRelationId?: string;

  // ========== Internal Team ==========
  salesPerson?: string;
  salesPersonRelationId?: string;
  merchandiser?: string;
  merchandiserRelationId?: string;
  supervisor?: string;
  supervisorRelationId?: string;

  // ========== Contracts ==========
  /** 早期销售合同号（出给客户/Peerless，PO 一确认就出） */
  salesContractNumber?: string;
  /** 最终销售合同号（出货时出给 Bill-to） */
  finalContractNumber?: string;

  // ========== OTS Alignment Fields ==========
  poDate?: string;
  season?: string;
  productionBatch?: string;
  poNumber?: string;
  /** Draft-only/manual-entry helper for creating an OrderLine under this PO. */
  itemNo?: string;
  clientCode?: string; // ZROH Number
  productColorCode?: string;
  referenceBatch?: string;
  
  // Contact Info (from PO import)
  contactPerson?: string;
  contactTelephone?: string;
  asPerson?: string;
  
  // Delivery & Logistics
  productionDate?: string;
  clientDate?: string;
  /** Legacy: use `consigneeName` instead. Kept for backward compat with old form & seed data. */
  consignee?: string;
  shippingDate?: string;
  shippingMethod?: string;
  
  // Financial & Sales
  salesPrice?: number;
  contractAmount?: number;
  /**
   * Legacy: split into `paymentInstrument` (T/T, L/C, O/A) + `paymentTerms` (Net 30, At Sight).
   * Kept as free-text field for backward compat with old form & seed data.
   */
  paymentMethod?: string;
  /** Settlement instrument: T/T, L/C, O/A, D/P, D/A 等 */
  paymentInstrument?: string;
  /** Settlement schedule: Net 30, At Sight 等。也用于承接 PDF 导入的 paymentTerms 字段。 */
  paymentTerms?: string;
  ocDays?: number;
  
  // Samples Tracking
  sampleSentDate?: string;
  sampleTrackingNumber?: string;
  sampleConfirmedDate?: string;
  needShipmentSample?: boolean;
  fabricSampleSentDate?: string;
  fabricSampleTrackingNumber?: string;
  fabricSampleConfirmedDate?: string;
  needHeaderSample?: boolean;
  shipmentSampleComments?: string;
  /** 客户实地验厂计划日（PRD 5.1/7.1；YYYY-MM-DD，到期前 7 天提醒） */
  factoryVisitDate?: string;
  
  // Shipment & Invoice
  invoiceDate?: string;
  invoiceNumber?: string;
  shipmentQuantity?: number;
  shipmentAmount?: number;
  paidSampleQuantity?: number;
  
  // Payment Tracking
  expectedPaymentDate?: string;
  actualPaymentDate?: string;
  actualPaymentAmount?: number;
  
  // Purchase Info
  purchasePrice?: number;
  purchasePaymentDate?: string;
  supplierInvoiceDate?: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceAmount?: number;
  
  specialInstructions?: string;
  orderNotes?: string;  // 订单特别说明（instructions 集群）

  // 物料信息 (Materials - 仅其他类型订单)
  materialCategory?: string;  // 物料分类：辅料/纱线/其他
  materialSpecNotes?: string;  // 物料规格/备注（materials 集群）

  // 面料规格 (Fabric Specs)
  fabricContent?: string;  // 面料成份
  fabricCode?: string;     // 面料编号
  width?: string;          // 门幅 (CM)
  gsm?: string;            // 克重

  // 订单行明细：从后端 OrderLine 拿来的，用于列表里"按行展开"渲染。
  // 一个 PO 可能有多个 line，每个 line 在订单列表里独立成一行。
  lines?: OrderLineLite[];

  /** 业务线快照（fabric | garment | capsule；BusinessLine.code）。Capsule 子视图筛选依据。 */
  businessLine?: string | null;
}

export type OrderLineStatus = 'Pending' | 'Confirmed' | 'Production' | 'Shipping' | 'Delivered' | 'Alert';

export interface OrderLineLite {
  id: string;
  orderId?: string;
  lineNumber: number;
  itemNo?: string | null;
  materialCode?: string | null;   // 客供品号 (ZROH)
  millQuality?: string | null;    // 工厂品色号 (Mill Quality)
  description?: string | null;    // 颜色/描述（BLACK SOLID 等）
  width?: string | null;
  exMillDate?: string | null;     // 出厂日期
  deliveryDate?: string | null;   // 到港日期
  quantity: number;
  unit?: string | null;
  unitPrice?: number | null;
  netValue?: number | null;
  cloth?: string | null;          // 面料
  weight?: string | null;
  status?: OrderLineStatus | null;
  productionBatch?: string | null;
  shippingDate?: string | null;
  shippingMethod?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  shipmentQuantity?: number | null;
  shipmentAmount?: number | null;
  actualPaymentDate?: string | null;
  actualPaymentAmount?: number | null;
  specialInstructions?: string | null;

  // ============ REQ2-03 溢短装条款（±N%，默认 5=行业惯例；0=足量交付） ============
  tolerancePercent?: number | null;

  // Garment extension fields
  sizeBreakdown?: Record<string, number> | null;   // { S: 100, M: 200, L: 200, XL: 100 }
  productionSteps?: ProductionStep[] | null;        // [{ step, status, date }]
  styleNo?: string | null;                          // 款式号
  colorName?: string | null;                        // 色号名称
  bomItems?: BomItem[] | null;                      // [{ type, name, qty, unit }]
  garmentSampleStages?: GarmentSampleStage[] | null; // 成衣样衣阶段 [{ stage, status, sentDate, confirmedDate, comments }]
}

/** A single production step in a garment order line. */
export interface ProductionStep {
  step: 'cutting' | 'sewing' | 'qc' | 'packing' | 'shipping';
  status: 'pending' | 'in_progress' | 'done';
  date?: string;
  note?: string;
}

/** A single BOM item for a garment order line. */
export interface BomItem {
  type: 'fabric' | 'lining' | 'trim' | 'packaging';
  name: string;
  spec?: string;
  qty: number;
  unit: string;
}

/** A single sample stage for a garment order line.
 *  成衣样衣阶段：Proto Sample（开发样）→ Photo Sample（照片样）→ Size Set（尺码样）→ PP Sample（产前样） */
export interface GarmentSampleStage {
  stage: 'proto' | 'photo' | 'sizeSet' | 'pp';
  status: 'pending' | 'sent' | 'confirmed' | 'rejected';
  sentDate?: string;       // 寄出日期
  confirmedDate?: string;  // 确认日期
  comments?: string;       // 意见/反馈
}

export interface OrderLineItem extends OrderLineLite {
  order: Order;
  orderId: string;
  poNumber: string;
  customer: string;
  poDate?: string | null;
  salesCurrency?: string | null;
  displayItemNo: string;
  displayId: string;
  amount: number;
  status: OrderLineStatus;
}

// PO Item (面料明细)
export interface PoItem {
  id?: number;
  poNumber?: string;
  itemNo?: string;
  peerlessNumber?: string;
  zrohNumber?: string;
  qualityDescription?: string;
  fabricCode?: string;
  width?: string;       // 门幅 (CM)
  exmillDate?: string;
  deliveryDate?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  fabricContent?: string;  // 面料成份
  gsm?: string;           // 克重
  netValue?: number;
  shippingMethod?: string;
  category?: string;
}

export interface ResolutionStrategy {
  name: string;
  description: string;
  deliveryConfidence: number;
  costImpact: string;
  marginChange: string;
}

export interface Email {
  id: string;
  sender: string;
  subject: string;
  body: string;
  snippet?: string; // Preview text for list view
  date: string;
  isRead: boolean;
  isStarred?: boolean;
  isImportant?: boolean;
  uid?: string;
  realBox?: string;
  box?: string;
  attachments?: {
    filename: string;
    contentType: string;
    size: number;
    id: string;
  }[];
  // Outbox send 契约（task_mqyqerqb）：direction/mailbox 区分 Inbound/Outbound/Outbox/Sent
  direction?: 'inbound' | 'outbound';
  mailbox?: 'INBOX' | 'Outbox' | 'Sent' | 'Drafts' | string;
  sentAt?: string | null;
  messageId?: string | null;
}

/** Outbox send 响应（消费 POST /api/v1/email/outbox/:id/send contract） */
export interface OutboxSendResult {
  ok: boolean;
  error?: { code: string; message: string; statusCode: number };
  data?: { emailId: string; messageId: string; sentAt: string; auditId: string };
}

export interface Insight {
  id: string;
  fact: string;
  importance: 'High' | 'Medium' | 'Low';
  timestamp: number;
  isPinned?: boolean;
  deletedAt?: number;
}

// ─── Development Management ───

export type DevelopmentType = 'fabric' | 'garment' | 'pp' | 'trim';
export type DevelopmentStage = 'developing' | 'shipping' | 'feedback' | 'revision' | 'approved' | 'cancelled';
export type DevelopmentPriority = 'urgent' | 'high' | 'normal' | 'low';
export type SampleType = 'lab-dip' | 'handloom' | 'yardage' | 'fit-sample' | 'pp-sample' | 'size-set';

export interface DevelopmentCase {
  id: string;
  code: string;
  name: string;
  type: DevelopmentType;
  stage: DevelopmentStage;
  priority: DevelopmentPriority;
  owner?: string;
  customerRelationId?: string;
  customerName?: string;
  supplierRelationId?: string;
  supplierName?: string;
  productAssetId?: string;
  productName?: string;
  currentRound: number;
  nextAction?: string;
  targetDate?: string;
  completedDate?: string;
  sampleType?: SampleType;
  sampleCategory?: string;
  sampleQuantity?: number;
  sampleUnit?: string;
  sampleSentDate?: string;
  sampleTrackingNumber?: string;
  sampleCourier?: string;
  sampleFeedback?: string;
  sampleFeedbackDate?: string;
  linkedOrderId?: string;
  linkedOrderPo?: string;
  convertedAt?: number;
  notes?: string;
  tags: string[];
  attachments?: any;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface DevelopmentCaseCreateInput {
  code: string;
  name: string;
  type: DevelopmentType;
  stage?: DevelopmentStage;
  priority?: DevelopmentPriority;
  owner?: string;
  customerRelationId?: string;
  customerName?: string;
  supplierRelationId?: string;
  supplierName?: string;
  productAssetId?: string;
  productName?: string;
  currentRound?: number;
  nextAction?: string;
  targetDate?: string;
  sampleType?: SampleType;
  sampleCategory?: string;
  sampleQuantity?: number;
  sampleUnit?: string;
  notes?: string;
  tags?: string[];
}

export interface DevelopmentCaseUpdateInput extends Partial<DevelopmentCaseCreateInput> {
  stage?: DevelopmentStage;
  sampleSentDate?: string;
  sampleTrackingNumber?: string;
  sampleCourier?: string;
  sampleFeedback?: string;
  sampleFeedbackDate?: string;
  linkedOrderId?: string;
  linkedOrderPo?: string;
  convertedAt?: number;
  completedDate?: string;
  attachments?: any;
}

// ── Phase B4 三级样衣节点 ──
export type SampleNodeLevel = 'confirmation' | 'pp' | 'top';
export type SampleNodeStatus = 'pending' | 'making' | 'sent' | 'approved' | 'revising';
export type SampleNodeAction = 'start' | 'send' | 'approve' | 'revise';

export interface SampleNode {
  id: string;
  developmentCaseId: string;
  level: SampleNodeLevel;
  round: number;
  status: SampleNodeStatus;
  sentDate?: string | null;
  courier?: string | null;
  trackingNumber?: string | null;
  feedback?: string | null;
  feedbackDate?: string | null;
  approvedAt?: number | null;
  approvedBy?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Status transition audit record for an order. */
export interface OrderStatusTransition {
  id: string;
  orderId: string;
  fromStatus: string;
  toStatus: string;
  note?: string | null;
  operator?: string | null;
  lineId?: string | null;
  createdAt: number;
}

export interface Artifact {
  type: 'excel' | 'contract' | 'pdf' | 'image' | 'knowledge_extraction';
  title: string;
  data: any;
  filename?: string;
}

export interface ChatAttachment {
  mimeType: string;
  data: string;
  name: string;
  previewUrl: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
  content?: string;
}

export type AgentWorkEventPhase =
  // 旧 phase（orchestrator + toolRuntime.runAgentToolCalls 兼容）
  | 'start'
  | 'identity'
  | 'planning'
  | 'tool_call'
  | 'tool_result'
  | 'assessment'
  | 'final'
  | 'error'
  // S2 真 Agent 循环（agentLoop.ts）新增 7 个 phase
  | 'iteration_start'
  | 'thought'
  | 'plan'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'iteration_end'
  | 'final_answer'
  | 'thought_delta'
  | 'thought_end'
  | 'answer_delta'
  | 'answer_end'
  // form 交互 phase（对齐后端 events.ts，修复契约漂移）
  | 'form_request'
  | 'form_resolved';

export type AgentWorkEventStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'blocked'
  | 'failed';

/**
 * agentLoop 事件 metadata 字段约定（与 server/src/agent/events.ts 对齐）。
 * 前端按需消费；不强制必填。
 */
export interface AgentWorkEventMetadata {
  step?: number;
  callId?: string;
  toolId?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  why?: string;
  thought?: string;
  plan?: Array<{ toolId: string; input: unknown; why?: string }>;
  finalAnswer?: string;
  ok?: boolean;
  stopReason?: string;
  forced?: boolean;
  toolCount?: number;
  error?: { code?: string; message: string };
  // 旧 phase 兼容字段
  steps?: Array<Record<string, unknown>>;
  taskGraphId?: string;
  toolCount_legacy?: number;
  [key: string]: unknown;
}

export interface AgentWorkEvent {
  id: string;
  at?: string;
  phase: AgentWorkEventPhase;
  status: AgentWorkEventStatus;
  title: string;
  message: string;
  toolId?: string;
  stepId?: string;
  summary?: string;
  metadata?: AgentWorkEventMetadata;
}

export type AgentResponseBlockStatus = 'streaming' | 'complete' | 'error';

export type AgentResponseBlockType =
  | 'markdown'
  | 'table'
  | 'metric'
  | 'evidence'
  | 'nextActions'
  | 'diagram'
  | 'chart'
  | 'mermaid'
  | 'artifact'
  | 'tool'
  | 'approval'
  | 'form';

export interface AgentResponseBlockSource {
  kind: 'agent' | 'tool' | 'user' | 'system';
  toolRunIds?: string[];
  evidenceRefIds?: string[];
}

export interface AgentResponseBlockPermissions {
  canCopy?: boolean;
  canExport?: boolean;
  canEdit?: boolean;
  canRun?: boolean;
}

export interface AgentResponseBlockBase {
  id: string;
  type: AgentResponseBlockType;
  title?: string;
  status?: AgentResponseBlockStatus;
  createdAt?: string;
  source?: AgentResponseBlockSource;
  permissions?: AgentResponseBlockPermissions;
}

export interface AgentMarkdownBlock extends AgentResponseBlockBase {
  type: 'markdown';
  content: string;
}

export interface AgentTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
}

export interface AgentTableBlock extends AgentResponseBlockBase {
  type: 'table';
  columns: AgentTableColumn[];
  rows: Array<Record<string, unknown>>;
  caption?: string;
}

export interface AgentMetricBlock extends AgentResponseBlockBase {
  type: 'metric';
  metrics: Array<{
    id: string;
    label: string;
    value: string | number;
    delta?: string;
    tone?: 'neutral' | 'positive' | 'negative' | 'warning';
  }>;
}

export type AgentReferenceKind = 'tool_run' | 'document' | 'artifact' | 'database_row' | 'api_response';

export interface AgentReferenceAnchor {
  refId: string;
  kind: AgentReferenceKind;
  label?: string;
  toolRunId?: string;
  blockId?: string;
  sourceId?: string;
  path?: string;
}

export interface AgentEvidenceBlock extends AgentResponseBlockBase {
  type: 'evidence';
  anchors?: AgentReferenceAnchor[];
  items: Array<{
    refId: string;
    label: string;
    summary: string;
    confidence?: 'high' | 'medium' | 'low';
  }>;
}

export interface AgentNextActionsBlock extends AgentResponseBlockBase {
  type: 'nextActions';
  actions: Array<{
    id: string;
    label: string;
    description?: string;
    actionType?: 'prompt' | 'tool' | 'artifact' | 'approval';
    payload?: Record<string, unknown>;
    risk?: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export interface AgentDiagramNode {
  id: string;
  label: string;
  subtitle?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export interface AgentDiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface AgentDiagramBlock extends AgentResponseBlockBase {
  type: 'diagram';
  kind: 'flow' | 'relationship' | 'timeline' | 'process';
  nodes: AgentDiagramNode[];
  edges: AgentDiagramEdge[];
}

export interface AgentChartBlock extends AgentResponseBlockBase {
  type: 'chart';
  chartType: 'bar' | 'line' | 'pie' | 'area';
  dimensions: string[];
  measures: string[];
  data: Array<Record<string, unknown>>;
}

export type AgentMermaidKind =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'gantt'
  | 'pie'
  | 'journey'
  | 'timeline'
  | 'mindmap'
  | 'gitgraph';

export interface AgentMermaidBlock extends AgentResponseBlockBase {
  type: 'mermaid';
  kind: AgentMermaidKind;
  code: string;
  caption?: string;
}

export interface AgentArtifactBlock extends AgentResponseBlockBase {
  type: 'artifact';
  artifactId: string;
  artifactType: 'markdown' | 'html' | 'table' | 'chart' | 'diagram' | 'file';
  version: number;
  preview?: unknown;
  contentRef?: string;
}

export interface AgentToolLifecycleBlock extends AgentResponseBlockBase {
  type: 'tool';
  toolRunId?: string;
  toolId: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  lifecycleStatus: 'planned' | 'parameterized' | 'permission_checked' | 'running' | 'succeeded' | 'failed' | 'blocked';
  reason?: string;
  inputPreview?: Record<string, unknown>;
  outputPreview?: unknown;
  error?: string;
  expandable?: boolean;
  /** P1-C: order.confirm 失败时的稳定 errorFeedback（对齐 server feedbackContract）。 */
  errorPreview?: OrderConfirmErrorFeedback;
  errorCode?: string;
  errorUserAction?: string;
}

export interface AgentProcessDraftSubOperation {
  toolId: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AgentProcessDraftFieldDiff {
  entity: string;
  entityId: string;
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface AgentProcessDraftPostCommitHook {
  type: 'email' | 'sms' | 'webhook' | 'notification';
  payload: Record<string, unknown>;
}

export interface AgentProcessDraft {
  subOperations: AgentProcessDraftSubOperation[];
  beforeAfterDiff: AgentProcessDraftFieldDiff[];
  impactScope: string[];
  irreversible: boolean;
  postCommitHooks: AgentProcessDraftPostCommitHook[];
  idempotencyKey: string;
}

/** P1-C: order.confirm 稳定错误码（对齐 server feedbackContract.ts OrderConfirmErrorCode）。 */
export type OrderConfirmErrorCode =
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_MODIFIED_UNSUPPORTED'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_ID_MISSING'
  | 'PROCESS_DRAFT_MISSING'
  | 'PROCESS_DRAFT_HASH_MISMATCH'
  | 'SEMANTIC_VALIDATION_FAILED'
  | 'PRECONDITIONS_FAILED'
  | 'ORDER_NOT_FOUND'
  | 'STATUS_DRIFT'
  | 'INVOICE_AMOUNT_INVALID'
  | 'INVOICE_CURRENCY_MISSING'
  | 'COMMIT_TRANSACTION_FAILED'
  | 'UNKNOWN_ERROR';

/** P1-C: fail-closed 结构化错误（对齐 server OrderConfirmError）。 */
export interface OrderConfirmErrorFeedback {
  code: OrderConfirmErrorCode;
  message: string;
  userAction: string;
  details?: string[];
  retryable?: boolean;
}

/** P1-C: entity link 写入记录。 */
export interface OrderConfirmEntityLink {
  linkKind: 'aboutOrder' | 'billTo';
  fromType: 'invoice';
  fromId: string;
  toType: 'order' | 'relation.organization';
  toId: string;
}

/** P1-C: order.confirm commit 成功结果（对齐 server CommitResult 成功态 + OrderConfirmCommitted）。
 *  前端通过 ToolLifecycleBlock.outputPreview 消费。 */
export interface OrderConfirmCommitResult {
  ok: boolean;
  committed: boolean;
  status?: string;
  orderId?: string;
  poNumber?: string;
  previousStatus?: string;
  newStatus?: string;
  transactionId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  customerRelationId?: string;
  customerName?: string;
  auditId?: string;
  idempotencyKey?: string;
  entityLinks?: OrderConfirmEntityLink[];
  postCommitQueue?: Array<{
    type: 'email' | 'sms' | 'webhook' | 'notification';
    status: 'queued';
    payload: Record<string, unknown>;
  }>;
  error?: string;
  errorFeedback?: OrderConfirmErrorFeedback;
  audit?: {
    approvalId: string;
    idempotencyKey: string;
    subOperationsSummary: string[];
    impactScope: string[];
  };
}

export interface AgentApprovalBlock extends AgentResponseBlockBase {
  type: 'approval';
  approvalId: string;
  risk: 'medium' | 'high' | 'critical';
  proposedAction: string;
  toolId?: string;
  input?: Record<string, unknown>;
  editableFields?: string[];
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'modified';
  /** P1-A: 后端通过 block_start 实时携带的审批前变更预览（对齐 P0-B ProcessDraft schema）。无此字段时回退旧卡片样式。 */
  processDraft?: AgentProcessDraft;
}

export interface AgentFormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  helpText?: string;
}

export interface AgentFormBlock extends AgentResponseBlockBase {
  type: 'form';
  formId: string;
  title: string;
  description?: string;
  fields: AgentFormField[];
  submitLabel?: string;
  formStatus: 'pending' | 'submitted' | 'cancelled';
  submittedValues?: Record<string, unknown>;
}

export type AgentResponseBlock =
  | AgentMarkdownBlock
  | AgentTableBlock
  | AgentMetricBlock
  | AgentEvidenceBlock
  | AgentNextActionsBlock
  | AgentDiagramBlock
  | AgentChartBlock
  | AgentMermaidBlock
  | AgentArtifactBlock
  | AgentToolLifecycleBlock
  | AgentApprovalBlock
  | AgentFormBlock;

export type AgentSessionState =
  | 'idle'
  | 'running'
  | 'streaming'
  | 'blocked_for_approval'
  // TODO Phase 4: wire when Artifact Workspace supports live editing instructions.
  | 'editing_artifact'
  // TODO Phase 5: wire when non-approval clarification/input requests are implemented.
  | 'awaiting_user_input'
  | 'completed'
  | 'failed';

export type AgentInputMode =
  | 'normal'
  | 'approval_comment'
  | 'approval_parameter_edit'
  | 'artifact_instruction'
  | 'clarification';

export interface AgentSessionContext {
  sessionId: string;
  status: AgentSessionState;
  inputMode: AgentInputMode;
  activeMessageId?: string;
  activeBlockId?: string;
  activeArtifactId?: string;
  pendingApprovalId?: string;
  workspace?:
    | { kind: 'empty' }
    | { kind: 'artifact'; artifactId: string; version: number }
    | { kind: 'toolRun'; toolRunId: string }
    | { kind: 'evidence'; evidenceId: string };
  pendingAction?: {
    kind: 'approve' | 'reject' | 'modify' | 'resume' | 'artifact_edit';
    targetId: string;
    label?: string;
    risk?: 'low' | 'medium' | 'high' | 'critical';
    payload?: Record<string, unknown>;
    editableFields?: string[];
  };
}

export type AgentBlockStreamEvent =
  | { event: 'block_start'; messageId: string; block: AgentResponseBlock }
  | { event: 'block_delta'; messageId: string; blockId: string; delta: string }
  | { event: 'block_patch'; messageId: string; blockId: string; patch: AgentBlockPatch }
  | { event: 'block_end'; messageId: string; blockId: string }
  | { event: 'block_error'; messageId: string; blockId: string; error: { message: string; code?: string } };

export type AgentBlockPatch =
  | { op: 'append_text'; value: string }
  | { op: 'set_columns'; columns: AgentTableColumn[] }
  | { op: 'append_row'; row: Record<string, unknown> }
  | { op: 'replace_row'; rowId: string; row: Record<string, unknown> }
  | { op: 'set_spec'; spec: Record<string, unknown> }
  | { op: 'append_data'; data: Array<Record<string, unknown>> }
  | { op: 'set_version'; version: number }
  | { op: 'replace_content'; contentRef: string }
  | { op: 'set_code'; code: string }
  | { op: 'set_approval_status'; approvalStatus: 'pending' | 'approved' | 'rejected' | 'modified'; decisionNote?: string };

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  artifacts?: Artifact[];
  blocks?: AgentResponseBlock[];
  sources?: GroundingSource[];
  thoughtProcess?: string;
  agentEvents?: AgentWorkEvent[];
  isTyping?: boolean;
}

// ====================================================================
// Import: PDF 解析后的结构化订单 (与 server: src/import/types.ts 同形)
// ====================================================================

export interface ParsedLine {
  itemNo: string;
  materialCode: string;
  millQuality: string;
  description: string;
  width: string;
  exMillDate: string;
  deliveryDate: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  netValue: number;
  via: string;
  cloth: string;
  weight?: string;
  category?: string;
  notes?: string[];
}

export interface ParsedShipTo {
  contactName?: string;
  company?: string;
  addressLines: string[];
  country?: string;
}

export interface ParsedOrder {
  customerId: string; // e.g. 'peerless'
  poNumber: string;
  season: string;
  poDate: string;
  contactPerson: string;
  contactPhone: string;
  currency: string;
  deliveryTerms: string;
  paymentTerms: string;
  shipTo: ParsedShipTo;
  deliverTo?: string;
  lines: ParsedLine[];
  totalNet: number;
  totalActual: number;
}

export interface DetectionResult {
  customerId: string | null;
  confidence: number;
  reasons: string[];
}

export interface ImportFileResult {
  filename: string;
  pages: number;
  detection: DetectionResult;
  order: ParsedOrder | null;
  error: string | null;
}

export interface ImportResponse {
  count: number;
  results: ImportFileResult[];
}

export interface SavedOrderRow {
  id: string;
  poNumber: string | null;
  customer: string;
  customerCode?: string | null;
  product: string;
  type: string;
  millName?: string | null;
  quantity: number;
  status: string;
  dueDate: string;
  quoteAmount: number;
  season?: string | null;
  poDate?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  currency?: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  shipToName?: string | null;
  shipToAddress1?: string | null;
  shipToAddress2?: string | null;
  shipToCountry?: string | null;
  shipToPhone?: string | null;
  deliverTo?: string | null;
  totalNet?: number | null;
  totalActual?: number | null;
  source?: string | null;
  importedAt?: number | null;
  updatedAt?: number | null;
  businessLine?: string | null;
  lines: Array<{
    id: string;
    lineNumber: number;
    itemNo?: string | null;
    materialCode?: string | null;
    millQuality?: string | null;
    description?: string | null;
    width?: string | null;
    exMillDate?: string | null;
    quantity: number;
    unit?: string | null;
    unitPrice?: number | null;
    netValue?: number | null;
    cloth?: string | null;
    weight?: string | null;
    deliveryDate?: string | null;
  }>;
}

export interface PersistImportResponse {
  ok: true;
  created: number;
  updated: number;
  results: Array<{
    poNumber: string;
    orderId: string;
    action: 'created' | 'updated';
    linesSaved: number;
  }>;
  orders: SavedOrderRow[];
}

// ====================================================================
// MODELS (Volcengine Ark Coding Plan model definitions)
// ====================================================================
const DEFAULT_ARK_MODEL = 'ark-code-latest';

export const MODELS = {
    // ========== 实际可用模型 ==========
    ARK_CODE: DEFAULT_ARK_MODEL,
    AUTO: DEFAULT_ARK_MODEL,

    // ========== Semantic Aliases ==========
    FAST: DEFAULT_ARK_MODEL,
    SMART: DEFAULT_ARK_MODEL,
    THINKING: DEFAULT_ARK_MODEL,
    CREATIVE: DEFAULT_ARK_MODEL,
    VISION: DEFAULT_ARK_MODEL,
    CODE: DEFAULT_ARK_MODEL,

    // ========== Deprecated concrete aliases ==========
    MINIMAX: DEFAULT_ARK_MODEL,
    KIMI: DEFAULT_ARK_MODEL,
    GLM_5: DEFAULT_ARK_MODEL,

    // ========== Legacy aliases ==========
    GLM_4_FLASH: DEFAULT_ARK_MODEL,
    GLM_4_PLUS: DEFAULT_ARK_MODEL,
    GLM_4V_PLUS: DEFAULT_ARK_MODEL,
    HUNYUAN_2_0: DEFAULT_ARK_MODEL,
    HUNYUAN_THINKING: DEFAULT_ARK_MODEL,
    HUNYUAN_T1: DEFAULT_ARK_MODEL,
    HUNYUAN_TURBOS: DEFAULT_ARK_MODEL,
    TC_CODE: DEFAULT_ARK_MODEL,
};

export type BambookModelId = typeof MODELS[keyof typeof MODELS];

// ═══════════════════════════════════════════════════════════
// Finance & Logistics types (Invoice / PaymentVoucher / Shipment)
// ═══════════════════════════════════════════════════════════

// ─── Phase 2: 报价管理 ───
export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired';

export interface QuotationLine {
  id: string;
  quotationId: string;
  lineNumber: number;
  fabricCode?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  notes?: string;
  /** REQ2-12 产品图片（行级快照 DR-053-②：档案主图自动带出或手动上传） */
  imageUrl?: string;
  createdAt: string;
}

export interface Quotation {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  currency: string;
  totalAmount: number;
  exchangeRate?: number;
  baseCurrency: string;
  customerRelationId?: string;
  customerName?: string;
  customerCode?: string;
  issueDate: string;
  validUntil?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  salesperson?: string;
  inquiryRef?: string;
  convertedOrderId?: string;
  notes?: string;
  sentAt?: number | null; // 发送时间毫秒时间戳（Draft→Sent 写入；Sent 超 7 天未回复提醒用）
  // ── 双轨定价快照（PRD 8.6；创建时写入的历史快照）──
  trackAMedianUsd?: number | null; // 轨道 A 中位估算美元单价
  trackAUnit?: string | null; // PC（件） | M（米）
  trackBFinalUsd?: number | null; // 轨道 B 终价美元单价
  priceDeviationPercent?: number | null; // 终价偏离估算中位百分比
  priceDeviationLevel?: 'ok' | 'warn' | 'block' | null; // ok | warn（>15% 触发审批） | block（>30% 未审批禁止发送）
  priceApprovalId?: string | null; // 偏差 >15% 时自动生成的 ApprovalRequest id
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  lines?: QuotationLine[];
}

export interface QuotationInput {
  quotationNumber?: string;
  currency: string;
  customerRelationId?: string;
  customerName?: string;
  customerCode?: string;
  issueDate: string;
  validUntil?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  salesperson?: string;
  inquiryRef?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  // ── 双轨定价快照（PRD 8.6；可选，A/B 双轨价齐备时服务端计算偏差并持久化）──
  trackAMedianUsd?: number;
  trackAUnit?: string;
  trackBFinalUsd?: number;
  lines: Array<{
    fabricCode?: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    notes?: string;
    imageUrl?: string;
  }>;
}

// ─── 阶段 P3c：历史报价导入（PRD 16.1/16.2）───
/** 历史报价导入行（仅关键字段；历史归档数据无行明细，totalAmount 直写） */
export interface HistoricalQuotationImportRow {
  quotationNumber?: string;
  customerName?: string;
  amount?: number | string;
  currency?: string;
  issueDate?: string;
  validUntil?: string;
  status?: string;
  salesperson?: string;
  notes?: string;
}

export interface QuotationImportRowError {
  row: number; // 1-based（对齐 Excel 行号语义，不含表头）
  field: string;
  message: string;
}

export interface QuotationImportResult {
  mode: 'preview' | 'commit';
  total: number;
  valid: number;
  created: number;
  skipped: number;
  errors: QuotationImportRowError[];
}

// ─── 阶段 P3b：品牌线 / 沟通日志 / 邮件签名（PRD 12.1/12.3）───
/** 品牌线（客户 360° 下的品牌线档案，同客户下 name 唯一） */
export interface BrandLine {
  id: string;
  relationId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  isActive: boolean;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface BrandLineInput {
  name: string;
  code?: string;
  description?: string;
  isActive?: boolean;
  notes?: string;
}

export type CommunicationType = 'Email' | 'Call' | 'WeChat' | 'Visit' | 'Meeting' | 'Other';
export type CommunicationDirection = 'Inbound' | 'Outbound';

/** 沟通日志（全渠道沟通流水） */
export interface CommunicationLog {
  id: string;
  relationId: string;
  contactId?: string | null;
  type: CommunicationType;
  direction: CommunicationDirection;
  subject?: string | null;
  summary: string;
  occurredAt: string; // YYYY-MM-DD
  emailMessageId?: string | null;
  orderId?: string | null;
  quotationId?: string | null;
  loggedBy?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface CommunicationLogInput {
  contactId?: string;
  type: CommunicationType;
  direction?: CommunicationDirection;
  subject?: string;
  summary: string;
  occurredAt: string;
  emailMessageId?: string;
  orderId?: string;
  quotationId?: string;
  notes?: string;
}

export type SignatureLanguage = 'zh' | 'en' | 'bilingual';

/** 邮件签名（content 支持 {{variable}}，variables 服务端自动解析冗余存储） */
export interface EmailSignature {
  id: string;
  name: string;
  language: SignatureLanguage;
  content: string;
  variables: string[];
  isDefault: boolean;
  isActive: boolean;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface EmailSignatureInput {
  name: string;
  language?: SignatureLanguage;
  content: string;
  isDefault?: boolean;
  isActive?: boolean;
  notes?: string;
}

// ─── 阶段 P3a：单据模板（PRD 11.3 DocumentTemplate）───
export type DocumentTemplateType =
  | 'Quotation' | 'SalesConfirmation' | 'ProformaInvoice' | 'CommercialInvoice'
  | 'PackingList' | 'BillOfLading' | 'AirWaybill' | 'CertificateOfOrigin'
  | 'InsuranceCert' | 'InspectionCert' | 'InspectionReport' | 'Statement' | 'Other';

export type DocumentTemplateLanguage = 'zh' | 'en' | 'bilingual';

/** 单据模板（content 为 HTML，支持 {{variable}} 占位符，variables 服务端自动解析） */
export interface DocumentTemplate {
  id: string;
  type: DocumentTemplateType;
  name: string;
  language: DocumentTemplateLanguage;
  content: string;
  variables: string[];
  isDefault: boolean;
  isActive: boolean;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface DocumentTemplateInput {
  type: DocumentTemplateType;
  name: string;
  language?: DocumentTemplateLanguage;
  content: string;
  isDefault?: boolean;
  isActive?: boolean;
  notes?: string;
}

// ─── Phase 2 B1: 采购管理 ───
export type PurchaseOrderStatus = 'Draft' | 'Sent' | 'Confirmed' | 'PartiallyReceived' | 'Received' | 'Closed' | 'Cancelled';

export interface PurchaseLine {
  id: string;
  purchaseOrderId: string;
  lineNumber: number;
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  receivedQuantity: number;
  rejectedQuantity: number;
  notes?: string;
  createdAt: string;
}

export interface MaterialReceipt {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  status: 'Pending' | 'Inspected' | 'Accepted' | 'Rejected' | 'PartiallyAccepted';
  receivedDate: string;
  receivedBy?: string;
  inspectedBy?: string;
  inspectionDate?: string;
  warehouseId?: string;
  warehouseName?: string;
  totalReceived: number;
  totalAccepted: number;
  totalRejected: number;
  rejectionReason?: string;
  qualityNotes?: string;
  notes?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierRelationId?: string;
  supplierName?: string;
  supplierCode?: string;
  currency: string;
  totalAmount: number;
  exchangeRate?: number;
  baseCurrency: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  shipToAddress?: string;
  orderId?: string;
  quotationId?: string;
  bomId?: string;
  buyer?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  lines?: PurchaseLine[];
  receipts?: MaterialReceipt[];
}

export interface PurchaseOrderInput {
  poNumber: string;
  currency: string;
  supplierRelationId?: string;
  supplierName?: string;
  supplierCode?: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  shipToAddress?: string;
  orderId?: string;
  quotationId?: string;
  bomId?: string;
  buyer?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  lines: Array<{
    materialCode?: string;
    description: string;
    category?: string;
    specification?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    notes?: string;
  }>;
}

export interface MaterialReceiptInput {
  receiptNumber: string;
  receivedDate: string;
  receivedBy?: string;
  warehouseId?: string;
  warehouseName?: string;
  totalReceived: number;
  totalAccepted: number;
  totalRejected: number;
  rejectionReason?: string;
  qualityNotes?: string;
  notes?: string;
}

// ─── Phase 2 B2: 库存管理 ───
export type WarehouseType = 'Main' | 'Auxiliary' | 'Temporary' | 'Virtual';
export type StockMovementType = 'Inbound' | 'Outbound' | 'Transfer' | 'Adjustment' | 'Lock' | 'Unlock';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  address?: string;
  manager?: string;
  phone?: string;
  isActive: boolean;
  sortOrder: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface WarehouseInput {
  code: string;
  name: string;
  type: WarehouseType;
  address?: string;
  manager?: string;
  phone?: string;
  isActive?: boolean;
  sortOrder?: number;
  notes?: string;
}

export interface InventoryItem {
  id: string;
  warehouseId: string;
  warehouse?: Warehouse | null;
  productAssetId?: string;
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  batchNumber?: string;
  locationCode?: string;
  quantity: number;
  lockedQuantity: number;
  availableQuantity: number; // quantity - lockedQuantity（前端计算）
  unit: string;
  unitCost?: number;
  currency: string;
  minStock?: number;
  maxStock?: number;
  lastInDate?: string;
  lastOutDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  movements?: StockMovement[];
}

export interface InventoryItemInput {
  warehouseId: string;
  productAssetId?: string;
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  batchNumber?: string;
  locationCode?: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  currency?: string;
  minStock?: number;
  maxStock?: number;
  notes?: string;
}

export interface StockMovement {
  id: string;
  movementNumber: string;
  type: StockMovementType;
  itemId: string;
  warehouseId: string;
  targetWarehouseId?: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  balanceBefore: number;
  balanceAfter: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  operator?: string;
  movementDate: string;
  notes?: string;
  createdAt: string;
}

export interface StockMovementInput {
  itemId: string;
  type: StockMovementType;
  quantity: number;
  unit?: string;
  unitCost?: number;
  targetWarehouseId?: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  movementDate?: string;
  notes?: string;
}

// ─── Phase 2 B4: BOM / 成本核算 ───
export type BOMStatus = 'Draft' | 'Confirmed' | 'Archived';
export type MaterialType = 'Main' | 'Contrast' | 'Lining' | 'Pocketing' | 'Trimmings' | 'Thread' | 'Packaging' | 'Other';
export type CostType = 'Material' | 'Labor' | 'Overhead' | 'Other';

export interface BOMLine {
  id: string;
  bomId: string;
  lineNumber: number;
  materialType: MaterialType;
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  supplierId?: string;
  quantity: number;
  unit: string;
  wastagePercent: number;
  effectiveQty: number;
  unitCost: number;
  amount: number;
  currency: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CostEstimate {
  id: string;
  bomId: string;
  costType: CostType;
  description: string;
  amount: number;
  currency: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BOM {
  id: string;
  bomNumber: string;
  status: BOMStatus;
  description: string;
  productAssetId?: string;
  orderId?: string;
  quotationId?: string;
  version: number;
  parentBomId?: string;
  totalMaterialCost: number;
  totalLaborCost: number;
  totalOverheadCost: number;
  totalCost: number;
  currency: string;
  sellingPrice?: number;
  profitMargin?: number;
  profitAmount?: number;
  notes?: string;
  attachments?: unknown;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  lines?: BOMLine[];
  costEstimates?: CostEstimate[];
}

export interface BOMLineInput {
  materialType: MaterialType;
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  supplierId?: string;
  quantity: number;
  unit: string;
  wastagePercent?: number;
  unitCost: number;
  notes?: string;
}

export interface CostEstimateInput {
  costType: CostType;
  description: string;
  amount: number;
  notes?: string;
}

export interface CreateBOMInput {
  bomNumber: string;
  description: string;
  productAssetId?: string;
  orderId?: string;
  quotationId?: string;
  currency?: string;
  sellingPrice?: number;
  notes?: string;
  lines: BOMLineInput[];
  costEstimates?: CostEstimateInput[];
}

export interface UpdateBOMInput extends Partial<CreateBOMInput> {
  status?: string;
}

export type InvoiceStatus = 'Draft' | 'Issued' | 'PartiallyPaid' | 'Paid' | 'Cancelled';
export type InvoiceType = 'Receivable' | 'Payable';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: InvoiceType;
  status: InvoiceStatus;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  issueDate?: string;
  dueDate?: string;
  settlementDate?: string;
  currency?: string;
  amount: number;
  /** DR-044 派生字段：Σ InvoiceAllocation.appliedAmount（列表接口附带；缺失=0） */
  appliedAmount?: number;
  /** DR-044 派生字段：未结清余额 = amount − appliedAmount（列表接口附带；缺失时兜底 amount） */
  openAmount?: number;
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  attachments?: unknown;
  /** DR：发票↔订单 多对多——详情接口附带（GET /v1/finance/:id），列表接口缺失 */
  orderAllocations?: InvoiceOrderAllocation[];
  deletedAt?: number | null;
  updatedAt: number;
  createdAt: number;
}

/** 发票↔订单 多对多分配行（消费 GET /v1/finance/:id 的 orderAllocations 契约） */
export interface InvoiceOrderAllocation {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  poNumber?: string | null;
  allocatedAmount?: number | null;
  note?: string | null;
}

/** Invoice.attachments 中的单个附件（上传接口登记后的结构） */
export interface InvoiceAttachment {
  fileName: string;
  url: string;
  mimeType?: string;
  fileSize?: number;
  uploadedAt?: string;
}

/** 发票写操作输入：在现有一致字段基础上支持 orderIds[]（多订单分配，create 插入 / update 全量替换） */
export interface InvoiceWriteInput {
  invoiceNumber?: string;
  type?: InvoiceType;
  status?: InvoiceStatus;
  amount?: number;
  currency?: string;
  customerName?: string;
  customerRelationId?: string;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
  orderId?: string;
  exchangeRate?: number;
  orderIds?: string[];
}

export type VoucherStatus = 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'cancelled';
export type VoucherType = 'Receipt' | 'Disbursement';

export interface PaymentVoucher {
  id: string;
  voucherNumber: string;
  type: VoucherType;
  status: VoucherStatus;
  invoiceId?: string;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  amount: number;
  currency?: string;
  paymentDate?: string;
  paymentMethod?: string;
  bankFee?: number;
  exchangeRate?: number;
  baseCurrency?: string;
  appliedAmount?: number;
  /** DR-044 派生字段：未核销余额 = amount − Σ InvoiceAllocation（列表接口附带；缺失时兜底 amount − appliedAmount） */
  openAmount?: number;
  notes?: string;
  attachments?: unknown;
  deletedAt?: number | null;
  updatedAt: number;
  createdAt: number;
}

// ── Payment Allocation（核销明细，消费后端 /api/v1/finance/allocations contract）──
export interface InvoiceAllocation {
  id: string; // 格式：ALLOC__${invoiceId}__${voucherId}
  invoiceId: string;
  voucherId: string;
  appliedAmount: number;
  appliedDate: string; // YYYY-MM-DD
  createdAt?: number;
  updatedAt?: number;
}

/** POST/PATCH /allocations 响应——含 status 重算结果（前端直接消费） */
export interface AllocationResult {
  allocation: { id: string; invoiceId?: string; voucherId?: string; appliedAmount: number; appliedDate: string };
  newInvoiceStatus: InvoiceStatus;
  newVoucherStatus: VoucherStatus;
}

/** DELETE /allocations/:id 响应 */
export interface AllocationDeleteResult {
  deleted: boolean;
  id: string;
  newInvoiceStatus: InvoiceStatus;
  newVoucherStatus: VoucherStatus;
}

// ── Phase B2: 财务报表（账龄 / 对账单 / 汇率损益，消费 /v1/finance/reports contract）──
export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

export interface AgingRow {
  customerRelationId: string | null;
  customerName: string;
  currency: string;
  invoiceCount: number;
  buckets: AgingBuckets;
}

export interface AgingReport {
  type: 'Receivable' | 'Payable';
  asOf: string;
  rows: AgingRow[];
  totals: Array<{ currency: string } & AgingBuckets>;
}

/** REQ2-08 催款函套件（DR-050）：中英函预览 + 催款记录快照留痕 */
export interface DunningLetterItem {
  invoiceNumber: string;
  open: number;
  dueDate: string | null;
  daysOverdue: number;
  bucket: string;
}

export interface DunningLetterSummary {
  customerName: string;
  currency: string;
  asOf: string;
  invoiceCount: number;
  totalOverdue: number;
  buckets: Record<string, number>;
  items: DunningLetterItem[];
}

export interface DunningLetter {
  zh: { subject: string; body: string };
  en: { subject: string; body: string };
  summary: DunningLetterSummary;
}

export type DunningChannel = 'email' | 'phone' | 'visit' | 'other';
export type DunningResultStatus = 'sent' | 'promised' | 'paid' | 'disputed' | 'no_response';

export interface DunningRecord {
  id: string;
  customerRelationId: string | null;
  customerName: string;
  currency: string;
  totalOverdue: number;
  invoiceCount: number;
  agingBuckets: Record<string, number>;
  channel: DunningChannel;
  result: DunningResultStatus;
  note: string | null;
  operator: string | null;
  createdAt: string;
}

export interface StatementTransaction {
  date: string;
  kind: 'invoice' | 'receipt' | 'payment';
  number: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementSection {
  currency: string;
  openingBalance: number;
  closingBalance: number;
  transactions: StatementTransaction[];
}

export interface CustomerStatement {
  customerRelationId: string;
  customerName: string | null;
  from: string | null;
  to: string | null;
  sections: StatementSection[];
}

/** 供应商对账单（应付侧镜像：Payable 发票为借，Disbursement 凭证为贷） */
export interface SupplierStatement {
  supplierRelationId: string;
  supplierName: string | null;
  from: string | null;
  to: string | null;
  sections: StatementSection[];
}

export interface FxGainLossRow {
  allocationId: string;
  appliedDate: string;
  invoiceNumber: string;
  voucherNumber: string;
  invoiceType: string;
  currency: string;
  appliedAmount: number;
  invoiceRate: number;
  voucherRate: number;
  gainLoss: number;
}

export interface FxGainLossReport {
  from: string | null;
  to: string | null;
  baseCurrency: string;
  rows: FxGainLossRow[];
  totalGainLoss: number;
}

// ── REQ2-03: 溢短装条款（toleranceService 单一真源，±N% 对称条款）──
export type ToleranceVerdict = 'ok' | 'over_limit' | 'under_limit';

export interface ToleranceCheckResult {
  verdict: ToleranceVerdict;
  deviationPct: number;
  allowedMin: number;
  allowedMax: number;
  settlementQty: number;
  settlementAmount: number | null;
  maxLimitAmount: number | null;
  minLimitAmount: number | null;
  warning: string | null;
}

export interface OrderLineToleranceStatus {
  orderLineId: string;
  itemNo: string | null;
  description: string | null;
  unit: string | null;
  contractQty: number;
  shippedQty: number;
  tolerancePercent: number;
  unitPrice: number | null;
  check: ToleranceCheckResult;
}

export interface OrderToleranceStatus {
  orderId: string;
  poNumber: string | null;
  lines: OrderLineToleranceStatus[];
  summary: { total: number; ok: number; overLimit: number; underLimit: number; unshipped: number };
}

// ── REQ2-02: 资金日历与 30 天现金流预测（DR-044 净额口径，与账龄/对账单同源）──
export interface CashCalendarAction {
  invoiceId: string;
  invoiceNumber: string;
  type: 'Receivable' | 'Payable';
  counterparty: string | null;
  currency: string;
  openAmount: number; // 未结清净额 = amount − Σ InvoiceAllocation
  dueDate: string;
  daysOverdue: number; // 0=今日到期；>0=逾期天数
}

export interface CashCalendarForecastRow {
  currency: string;
  overdueInflow: number;
  overdueOutflow: number;
  windowInflow: number;
  windowOutflow: number;
  netWindow: number;
  itemCount: number;
}

export interface FxExposureRow {
  currency: string;
  netReceivable: number; // 非本位币全部未结清应收
  netPayable: number;
}

export interface UnappliedVoucherRow {
  voucherCategory: string; // normal | advance(预收款) | deposit(保证金) | ...
  currency: string;
  unapplied: number; // 凭证未核销余额（DR-045 真源）
  count: number;
}

export interface CashCalendarReport {
  asOf: string;
  days: number;
  windowEnd: string;
  todayActions: CashCalendarAction[];
  upcoming: CashCalendarAction[];
  forecast: CashCalendarForecastRow[];
  fxExposure: FxExposureRow[];
  unappliedVouchers: UnappliedVoucherRow[];
}

// ── Phase F2: 外汇核销闭环（结汇水单 + 台账，消费 /v1/finance/fx-settlements contract）──
// 注意：Decimal 字段经后端 serializeFinanceValue 序列化为 string（保精度），createdAt/updatedAt 为 number
export interface FxSettlement {
  id: string; // 格式：FXS__${shortId}
  settlementNumber: string; // 结汇水单号
  voucherId: string;
  orderId?: string | null;
  customerRelationId?: string | null;
  settleDate: string; // YYYY-MM-DD
  foreignAmount: string; // 结汇外币金额
  currency: string;
  fxRate: string; // 结汇汇率（外币 → CNY）
  cnyAmount: string; // 折合人民币（服务端计算）
  bank?: string | null;
  slipNumber?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

/** GET /v1/finance/vouchers/:id/settlements 响应——凭证核销摘要 */
export interface VoucherSettlementSummary {
  voucherId: string;
  voucherNumber: string;
  voucherAmount: string;
  currency: string;
  settledAmount: string;
  remainingAmount: string;
  fullySettled: boolean;
  settlements: FxSettlement[];
}

/** GET /v1/finance/fx-settlements/ledger 响应——外汇台账（只读聚合） */
export interface FxLedgerRow {
  currency: string;
  receivedTotal: string; // 期间内收汇总额
  settledTotal: string; // 期间内已结汇总额
  unsettledBalance: string; // 未结汇余额（全量口径）
  settlementCount: number;
  weightedAvgSettleRate: string | null; // 加权平均结汇汇率
  fxDiffEstimate: string | null; // 汇兑差额估算（CNY）
}

export interface FxLedgerUnsettledVoucher {
  voucherId: string;
  voucherNumber: string;
  customerName: string | null;
  paymentDate: string;
  currency: string;
  voucherAmount: string;
  remainingAmount: string;
}

export interface FxLedger {
  from: string | null;
  to: string | null;
  rows: FxLedgerRow[];
  unsettledVouchers: FxLedgerUnsettledVoucher[];
}

// ── Phase C6: 付汇水单（OutwardRemittance，消费 /v1/finance/outward-remittances contract）──
// 镜像 FxSettlement 付款侧：仅 Disbursement 外币凭证可付汇；cnyAmount 服务端计算；Decimal 序列化为 string
export type OutwardRemittancePurpose = 'GoodsPayment' | 'Freight' | 'Insurance' | 'Commission' | 'Other';

export interface OutwardRemittance {
  id: string; // 格式：OWR__${shortId}
  remittanceNumber: string; // 付汇水单号
  voucherId: string;
  orderId?: string | null;
  customerRelationId?: string | null;
  remitDate: string; // YYYY-MM-DD
  foreignAmount: string; // 付汇外币金额
  currency: string;
  fxRate: string; // 付汇汇率（外币 → CNY）
  cnyAmount: string; // 折合人民币（服务端计算）
  payeeName?: string | null;
  payeeBank?: string | null;
  payeeSwift?: string | null;
  purpose?: OutwardRemittancePurpose | null;
  bank?: string | null;
  slipNumber?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

/** GET /v1/finance/vouchers/:id/remittances 响应——凭证付汇摘要 */
export interface VoucherRemittanceSummary {
  voucherId: string;
  voucherNumber: string;
  voucherAmount: string;
  currency: string;
  remittedAmount: string;
  remainingAmount: string;
  fullyRemitted: boolean;
  remittances: OutwardRemittance[];
}

// ── Phase C6: 增值税发票（VatInvoice，消费 /v1/finance/vat-invoices contract）──
// 专票全生命周期：Received → Verified → Declared（挂退税申报）→ RedFlushed；Received → Cancelled
export type VatInvoiceStatus = 'Received' | 'Verified' | 'Declared' | 'RedFlushed' | 'Cancelled';
export type VatInvoiceDirection = 'Input' | 'Output';
export type VatInvoiceType = 'Special' | 'Normal';

export interface VatInvoice {
  id: string; // 格式：VAT__${shortId}
  vatCode?: string | null; // 发票代码（纸质票）
  vatNumber: string; // 发票号码
  direction: VatInvoiceDirection;
  invoiceType: VatInvoiceType;
  status: VatInvoiceStatus;
  sellerName: string;
  sellerTaxNo?: string | null;
  buyerName: string;
  buyerTaxNo?: string | null;
  issueDate: string; // YYYY-MM-DD
  netAmount: string; // 不含税金额
  taxRate: string; // 税率（%，如 13）
  taxAmount: string; // 税额
  totalAmount: string; // 价税合计（= netAmount + taxAmount，服务端校验）
  currency: string;
  verifiedDate?: string | null; // 勾选认证日期
  deductionPeriod?: string | null; // 抵扣所属期 YYYY-MM
  taxRefundId?: string | null; // 关联退税申报（Declared 必填）
  redFlushNumber?: string | null; // 红字发票号
  redFlushDate?: string | null;
  invoiceId?: string | null; // 关联业务发票
  orderId?: string | null;
  relationId?: string | null;
  notes?: string | null;
  attachments?: unknown;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

// ── Phase C1: 经营驾驶舱（消费 /v1/dashboard/cockpit contract）──
export interface SalesLeaderboardRow {
  salesPerson: string;
  currency: string;
  orderCount: number;
  salesAmount: number;
  collectedAmount: number;
  collectionRate: number | null;
}

export interface CustomerContributionRow {
  customer: string;
  customerRelationId: string | null;
  currency: string;
  orderCount: number;
  salesAmount: number;
  share: number; // 同币种内占比 0-1
  isNewCustomer: boolean;
  lastOrderDate: string | null;
}

export interface OrderMarginRow {
  orderId: string;
  poNumber: string | null;
  customer: string;
  product: string;
  salesPerson: string | null;
  dueDate: string;
  status: string;
  currency: string;
  revenue: number;
  cost: number | null;
  crossCurrency: boolean;
  margin: number | null;
  marginRate: number | null;
  collectionRate: number | null;
}

export interface OrderMarginTotal {
  currency: string;
  revenue: number;
  cost: number;
  margin: number;
  marginRate: number | null;
  orderCount: number;
}

export interface ArApAlertBucket {
  currency: string;
  overdue: number;
  total: number;
}

export interface OrderStatusBucket {
  status: string;
  count: number;
  salesAmount: number;
  currency: string;
}

export interface DeliveryAlert {
  orderId: string;
  poNumber: string | null;
  customer: string;
  product: string;
  dueDate: string;
  status: string;
  daysUntilDue: number;
  currency: string;
  orderAmount: number;
}

export interface SampleProgressAlert {
  caseId: string;
  caseCode: string;
  caseName: string;
  stage: string;
  priority: string;
  customerName: string | null;
  productName: string | null;
  currentRound: number;
  targetDate: string | null;
  daysOverdue: number | null;
  pendingSampleLevel: string | null;
  pendingSampleStatus: string | null;
}

export interface FxTrendPoint {
  currency: string;
  effectiveDate: string;
  rate: number;
}

export interface FxTrend {
  baseCurrency: string;
  points: FxTrendPoint[];
}

export interface BusinessCockpit {
  from: string | null;
  to: string | null;
  generatedAt: string;
  salesLeaderboard: SalesLeaderboardRow[];
  customerContribution: CustomerContributionRow[];
  orderMargins: { rows: OrderMarginRow[]; totals: OrderMarginTotal[]; excludedCount: number };
  orderStatusDistribution: OrderStatusBucket[];
  deliveryAlerts: DeliveryAlert[];
  sampleProgressAlerts: SampleProgressAlert[];
  fxTrend: FxTrend;
  arApAlerts: {
    receivable: { rows: AgingRow[]; totals: ArApAlertBucket[] };
    payable: { rows: AgingRow[]; totals: ArApAlertBucket[] };
  };
  fxSummary: { baseCurrency: string; totalGainLoss: number; rowCount: number };
}

export type ShipmentStatus = 'Draft' | 'Booked' | 'Loading' | 'Shipped' | 'Arrived' | 'Cleared' | 'Delivered' | 'Cancelled';
export type ShipmentDirection = 'Outbound' | 'Inbound';

export interface ShipmentLine {
  id: string;
  shipmentId: string;
  lineNumber?: number;
  orderId?: string;
  orderPo?: string;
  orderLineId?: string | null; // C4：关联订单行（pull-from-order 带出）
  productId?: string;
  productCode?: string | null;
  productName?: string;
  colorCode?: string | null;
  quantity?: number;
  unit?: string;
  cartons?: number;
  grossWeight?: number;
  netWeight?: number;
  volume?: number;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
  notes?: string;
  deletedAt?: number | null;
}

// ─── C4 发货深化：逐箱装箱 ───
export interface ShipmentCartonItem {
  id: string;
  cartonId: string;
  shipmentLineId: string;
  quantity: number;
}

export interface ShipmentCarton {
  id: string;
  shipmentId: string;
  cartonNo: string;
  description?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  grossWeight?: number | null;
  netWeight?: number | null;
  volume?: number | null;
  items?: ShipmentCartonItem[];
}

export type ShipmentType2 = 'Export' | 'Import' | 'Domestic';

// ─── 出运制单引擎（GET /v1/shipping/:id/document-set） ───

export interface DocumentSetLine {
  lineNumber: number;
  description: string;
  productCode: string | null;
  hsCode: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  cartons: number | null;
  grossWeight: number | null;
  netWeight: number | null;
  volume: number | null;
  originCountry: string | null;
}

export interface DocumentSetParty {
  name: string;
  address: string | null;
  contact: string | null;
}

export interface DocumentSetData {
  shipment: {
    id: string;
    shipmentNumber: string;
    status: string;
    type: string;
    shippingMethod: string | null;
    vesselOrFlight: string | null;
    voyageNumber: string | null;
    portOfLoading: string | null;
    portOfDischarge: string | null;
    containerNumber: string | null;
    sealNumber: string | null;
    bookingDate: string | null;
    etd: string | null;
    atd: string | null;
    eta: string | null;
    totalPackages: number | null;
    grossWeight: number | null;
    netWeight: number | null;
    volume: number | null;
    hsCode: string | null;
    customsDeclarationNumber: string | null;
    notes: string | null;
  };
  order: {
    id: string;
    poNumber: string | null;
    customer: string;
    currency: string | null;
    deliveryTerms: string | null;
    paymentTerms: string | null;
    salesContractNumber: string | null;
    finalContractNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
  } | null;
  customs: {
    declarationNumber: string;
    declarationDate: string | null;
    declarationPort: string | null;
    tradeTerms: string | null;
    totalValue: number | null;
    currency: string | null;
    originCountry: string | null;
    destinationCountry: string | null;
    consignee: string | null;
    consignor: string | null;
  } | null;
  parties: {
    customer: DocumentSetParty | null;
    consignee: DocumentSetParty | null;
    carrier: { name: string } | null;
  };
  lines: DocumentSetLine[];
  totals: {
    quantity: number | null;
    amount: number | null;
    cartons: number | null;
    grossWeight: number | null;
    netWeight: number | null;
    volume: number | null;
    currency: string | null;
  };
  missing: string[];
  /** 阶段 D / D4：Form A / 保险单 / 受益人证明扩展装配 */
  extras: {
    /** Form A 第 8 栏原产地标准（'P' = 完全原产） */
    originCriterion: string;
    insurance: {
      insuredAmount: number | null;
      currency: string | null;
      coverage: string;
      premium: number | null;
      premiumCurrency: string | null;
      insurer: string | null;
    };
    letterOfCredit: {
      lcNumber: string;
      issueBank: string | null;
      issueDate: string | null;
      applicant: string | null;
    } | null;
  };
}

/** 阶段 D / D6：实体级审计日志项（GET /v1/audit/entity 返回） */
export interface EntityAuditLogItem {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  operationType: string | null;
  fieldPath: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  detail: unknown;
  createdAt: string;
  actor: { id: string; displayName: string | null; email: string | null };
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  type?: string; // Export | Import | Domestic
  status: ShipmentStatus;
  shippingMethod?: string; // Sea | Air | Land | Rail | Courier

  // ─── 日期 ───
  bookingDate?: string;
  etd?: string; // 预计离港
  atd?: string; // 实际离港
  eta?: string; // 预计到港
  ata?: string; // 实际到港

  // ─── 运输信息 ───
  vesselOrFlight?: string;
  voyageNumber?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  containerNumber?: string;
  sealNumber?: string;
  trackingNumber?: string; // C4：物流跟踪号（快递单号/集装箱跟踪号）
  carrierTrackingUrl?: string; // C4：承运商跟踪查询链接（前端跳转）

  // ─── 重量/体积 ───
  totalPackages?: number;
  grossWeight?: number;
  netWeight?: number;
  volume?: number;

  // ─── 费用 ───
  freightAmount?: number;
  freightCurrency?: string;
  insuranceAmount?: number;
  insuranceCurrency?: string;
  customsAmount?: number;
  customsCurrency?: string;
  otherCharges?: number;
  otherChargesCurrency?: string;

  // ─── 关联 ───
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  carrierRelationId?: string;
  carrierName?: string;

  // ─── 报关 ───
  hsCode?: string;
  customsBroker?: string;
  customsDeclarationNumber?: string;
  customsClearanceDate?: string;

  // ─── 其他 ───
  notes?: string;
  attachments?: unknown;
  lines?: ShipmentLine[];
  deletedAt?: number | null;
  updatedAt: number;
  createdAt: number;
}

// ── Notifications ──
export type NotificationLevel = 'info' | 'warning' | 'critical';

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  level: NotificationLevel;
  link: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationStats {
  total: number;
  unread: number;
  critical: number;
  byType: Record<string, number>;
}

// ── D2 主动提醒引擎：偏好 + 类型目录 ──
export interface NotificationPreferenceItem {
  notificationType: string;
  label: string;
  isEnabled: boolean;
}

export interface NotificationTypeCatalogItem {
  type: string;
  label: string;
  isEnabled: boolean;
  seenCount: number;
}

// ── 业务审批中心（PRD 19.21；/api/v1/approvals，Agent 工具审批 tool:* 不在此列）──
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequestItem {
  id: string;
  requesterId: string;
  reviewerId?: string | null;
  actionType: string; // 如 quotation:price-deviation
  targetType: string; // 如 Quotation
  targetId?: string | null;
  status: ApprovalRequestStatus;
  risk: string; // low | medium | high
  payload: Record<string, any>;
  decisionNote?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  requester?: { id: string; displayName?: string | null; email?: string | null } | null;
  reviewer?: { id: string; displayName?: string | null; email?: string | null } | null;
}

// ── 自动化规则 ──
export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  eventType: string;
  enabled: boolean;
}

// ── 工作流引擎 ──
export type WorkflowInstanceStatus = 'running' | 'approved' | 'rejected' | 'cancelled';
export type WorkflowStepDecision = 'approved' | 'rejected' | 'skipped';

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string | null;
  entityType: string;
  triggerEvent: string | null;
  steps: WorkflowStepDef[];
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepDef {
  name: string;
  approverRole?: string;
  approverUserId?: string;
  description?: string;
}

export interface WorkflowStepDetail {
  id: string;
  stepIndex: number;
  stepName: string;
  approverRole: string | null;
  approverUserId: string | null;
  decision: WorkflowStepDecision | null;
  decisionNote: string | null;
  decidedById: string | null;
  deciderName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionName: string;
  entityType: string;
  entityId: string;
  status: WorkflowInstanceStatus;
  currentStepIndex: number;
  title: string | null;
  initiatedById: string | null;
  initiatorName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStepDetail[];
}

// ════════════════════════════════════════════════════════════════
// Phase 3 C1: CRM 深化类型
// ════════════════════════════════════════════════════════════════

export interface Contact {
  id: string;
  relationId: string;
  name: string;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  wechat?: string | null;
  whatsapp?: string | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
  birthday?: string | null;
  personalNote?: string | null;
  tags: string[];
  status: string; // Active | Inactive | Left
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface ContactInput {
  name: string;
  title?: string;
  department?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  wechat?: string;
  whatsapp?: string;
  isPrimary?: boolean;
  isDecisionMaker?: boolean;
  birthday?: string;
  personalNote?: string;
  tags?: string[];
}

export interface CreditLimit {
  id: string;
  relationId: string;
  totalLimit: number;
  usedAmount: number;
  currency: string;
  validFrom: string;
  validTo?: string | null;
  status: string; // Active | Frozen | Expired | Revoked
  approvedBy?: string | null;
  approvedAt?: number | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface CreditLimitInput {
  totalLimit: number;
  currency?: string;
  validFrom: string;
  validTo?: string;
  approvedBy?: string;
  notes?: string;
}

export interface FollowUpRecord {
  id: string;
  relationId: string;
  contactId?: string | null;
  type: string; // Visit | Call | Email | WeChat | Meeting | Other
  content: string;
  followUpAt: string;
  nextFollowUpAt?: string | null;
  nextFollowUpTopic?: string | null;
  opportunityId?: string | null;
  orderId?: string | null;
  salesRepId?: string | null;
  salesRepName?: string | null;
  attachments?: unknown;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  contact?: { name: string; title: string | null } | null;
}

export interface FollowUpInput {
  contactId?: string;
  type: string;
  content: string;
  followUpAt: string;
  nextFollowUpAt?: string;
  nextFollowUpTopic?: string;
  opportunityId?: string;
  orderId?: string;
  salesRepId?: string;
  salesRepName?: string;
  attachments?: Record<string, unknown>;
  notes?: string;
}

export type OpportunityStage = 'Prospecting' | 'Qualification' | 'Proposal' | 'Negotiation' | 'ClosedWon' | 'ClosedLost';

export interface Opportunity {
  id: string;
  relationId: string;
  title: string;
  description?: string | null;
  amount: number;
  currency: string;
  stage: OpportunityStage;
  probability: number;
  expectedCloseDate?: string | null;
  source?: string | null;
  orderId?: string | null;
  salesRepId?: string | null;
  salesRepName?: string | null;
  tags: string[];
  notes?: string | null;
  closedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  relation?: { name: string; category: string } | null;
}

export interface OpportunityInput {
  title: string;
  description?: string;
  amount: number;
  currency?: string;
  stage?: OpportunityStage;
  probability?: number;
  expectedCloseDate?: string;
  source?: string;
  salesRepId?: string;
  salesRepName?: string;
  tags?: string[];
  notes?: string;
}

export type CustomerTierLevel = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'VIP';

export interface CustomerTier {
  id: string;
  relationId: string;
  level: CustomerTierLevel;
  criteria?: string | null;
  discountRate?: number | null;
  paymentTermsDays?: number | null;
  creditPriority: string; // High | Normal | Low
  evaluatedAt: string;
  validUntil?: string | null;
  evaluatedBy?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface CustomerTierInput {
  level: CustomerTierLevel;
  criteria?: string;
  discountRate?: number;
  paymentTermsDays?: number;
  creditPriority?: string;
  evaluatedAt: string;
  validUntil?: string;
  evaluatedBy?: string;
  notes?: string;
}

export interface CrmOverview {
  contacts: Contact[];
  activeCreditLimit: CreditLimit | null;
  creditLimitHistory: CreditLimit[];
  pendingFollowUps: FollowUpRecord[];
  opportunities: Opportunity[];
  activeTier: CustomerTier | null;
  tierHistory: CustomerTier[];
}

// ════════════════════════════════════════════════════════════════
// 阶段 H H1: 供应商管理 Supplier Management（PRD 13 / 19.18）
// 身份真源在 Relation（category=Supplier），FactoryProfile 1:1 承载工厂属性
// ════════════════════════════════════════════════════════════════

export type FactoryPriceLevel = 'High' | 'Mid' | 'Low';
export type FactoryEvaluationKind = 'inspection' | 'delivery';

export interface FactoryProfile {
  id: string;
  relationId: string;
  monthlyCapacity?: number | null;
  capacityUnit?: string | null; // PC | M
  equipmentList?: string | null;
  workerCount?: number | null;
  specialties: string[];
  qualityScore: number; // 0-100 缓存分（真源 FactoryEvaluation）
  deliveryScore: number; // 0-100 缓存分
  priceLevel?: FactoryPriceLevel | null;
  firstOrderAt?: string | null; // YYYY-MM-DD
  totalOrders: number;
  totalAmount: number;
  bankName?: string | null;
  bankAccount?: string | null;
  bankSwift?: string | null;
  blacklistedAt?: number | null;
  blacklistReason?: string | null;
  blacklistedById?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  relation?: Relation | null;
  certifications?: FactoryCertification[];
}

export interface FactoryProfileInput {
  relationId: string;
  monthlyCapacity?: number | null;
  capacityUnit?: string | null;
  equipmentList?: string | null;
  workerCount?: number | null;
  specialties?: string[];
  priceLevel?: FactoryPriceLevel | null;
  firstOrderAt?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankSwift?: string | null;
  notes?: string | null;
}

export type FactoryProfilePatch = Partial<Omit<FactoryProfileInput, 'relationId'>>;

export interface FactoryEvaluation {
  id: string;
  factoryId: string;
  kind: FactoryEvaluationKind;
  score: number; // 0-100
  sourceType?: string | null; // inspectionReport | shipment | purchaseOrder | manual
  sourceId?: string | null;
  evaluatedAt: string; // YYYY-MM-DD
  note?: string | null;
  actorId?: string | null;
  createdAt: number;
  deletedAt?: number | null;
}

export interface FactoryEvaluationInput {
  kind: FactoryEvaluationKind;
  score: number;
  sourceType?: string | null;
  sourceId?: string | null;
  evaluatedAt: string;
  note?: string | null;
}

export interface FactoryCertification {
  id: string;
  factoryId: string;
  type: string; // BSCI | SEDEX | WRAP | ISO9001 | ...
  certificateNo?: string | null;
  issuedAt?: string | null;
  validUntil?: string | null; // null = 长期有效
  attachmentPath?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  factory?: FactoryProfile | null;
}

export interface FactoryCertificationInput {
  type: string;
  certificateNo?: string | null;
  issuedAt?: string | null;
  validUntil?: string | null;
  attachmentPath?: string | null;
}

// ── REQ2-06 GRS TC 交易证书链 TcCertificate（DR-048：三段链 + 一键校验） ──

export type TcStage = 'material_input' | 'factory_output' | 'our_sale';

export interface TcCertificateRow {
  id: string;
  tcNo: string;
  orderId: string;
  relationId: string | null;
  relationName: string | null;
  stage: TcStage;
  quantityKg: number;
  issuedAt: string | null;
  validUntil: string | null;
  attachmentPath: string | null;
  notes: string | null;
  parentTcId: string | null;
  createdAt: number;
}

/** REQ2-10 工厂延迟链路影响（DR-052：缓冲侵蚀三级分级 + 沟通建议 + 交期分联动） */
export type DelayImpactLevel = 'critical' | 'warning' | 'info';
export type DelayReason = 'capacity' | 'material' | 'quality_rework' | 'weather' | 'other';

export interface DelayImpactItem {
  orderId: string;
  poNumber: string;
  customer: string | null;
  product: string | null;
  quantity: number | null;
  unit: string | null;
  status: string;
  dueDate: string | null;
  productionPlanDeadline: string | null;
  planDateMissing: boolean;
  newCompletionDate: string | null;
  bufferDays: number | null;
  level: DelayImpactLevel;
}

export interface DelayImpactResult {
  supplierName: string;
  delayDays: number;
  items: DelayImpactItem[];
  summary: { total: number; critical: number; warning: number; info: number; criticalOrderIds: string[] };
  advice: Record<string, string>;
}

export interface FactoryDelayRecord {
  id: string;
  recordNumber: string;
  supplierRelationId: string | null;
  supplierName: string;
  delayDays: number;
  reason: DelayReason | null;
  reasonNote: string | null;
  affectedOrderIds: string[];
  impactSummary: { total: number; critical: number; warning: number; info: number; delayDays?: number } | null;
  registeredBy: string | null;
  createdAt: number;
}

export interface TcStageSummary {
  stage: TcStage;
  label: string;
  count: number;
  totalKg: number;
}

export interface TcChainVerification {
  orderId: string;
  poNumber: string | null;
  verdict: 'complete' | 'warning';
  tcCount: number;
  byStage: { materialKg: number; factoryKg: number; ourKg: number };
  missingStages: Array<{ stage: TcStage; label: string }>;
  tonnageWarnings: string[];
  orderUsage: {
    checked: boolean;
    orderUsageKg: number | null;
    ourSaleKg: number;
    warning: string | null;
  };
  expiredTc: Array<{ id: string; tcNo: string; validUntil: string }>;
}

export interface FactoryCapacity {
  id: string;
  factoryId: string;
  month: string; // YYYY-MM
  capacity: number;
  unit?: string | null; // PC | M
  note?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  /** 服务层实时聚合：在手采购单占用量 */
  occupied?: number;
}

export interface FactoryOverview {
  profile: FactoryProfile;
  evaluations: FactoryEvaluation[];
  certifications: FactoryCertification[];
  capacity: FactoryCapacity[];
}

// ════════════════════════════════════════════════════════════════
// 阶段 H H2: 季节性与趋势管理 Season & Trend Management
// 季度（开发日历 + 季度回顾快照）/ 趋势标签（关联面料）/ 展会（线索 + ROI）
// ════════════════════════════════════════════════════════════════

export type SeasonStatus = 'Planning' | 'Active' | 'Closed';
export type TrendTagType = 'fabric' | 'color' | 'craft' | 'composition';
export type TradeShowStatus = 'Planned' | 'Ongoing' | 'Completed' | 'Cancelled';
export type TradeShowLeadStatus = 'New' | 'Following' | 'Converted' | 'Lost';

export interface SeasonCalendarItem {
  key: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface Season {
  id: string;
  code: string; // 季节代码，如 SS26 / AW26
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  calendar?: SeasonCalendarItem[] | null; // 开发日历节点
  status: SeasonStatus;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  trendTags?: TrendTag[];
  tradeShows?: TradeShow[];
}

export interface SeasonInput {
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  calendar?: SeasonCalendarItem[] | null;
  notes?: string | null;
}

/** code 创建后不可改 */
export type SeasonPatch = Partial<Omit<SeasonInput, 'code'>> & { status?: SeasonStatus };

export interface SeasonReviewTopCustomer {
  customer: string;
  orderCount: number;
  revenue: number;
}

/** 季度回顾快照（服务端聚合生成，前端只读） */
export interface SeasonReview {
  orderCount: number;
  shippedCount: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  topCustomers: SeasonReviewTopCustomer[];
  generatedAt: string;
}

/** 趋势标签关联的面料（FabricProfile 携带 productAsset 展示名/sku） */
export type TrendFabric = FabricProfile & { productAsset?: ProductAsset | null };

export interface TrendTagFabricLink {
  id: string;
  fabricId: string;
  note?: string | null;
  fabric?: TrendFabric | null;
}

export interface TrendTag {
  id: string;
  seasonId?: string | null; // null = 跨季通用
  type: TrendTagType;
  name: string;
  description?: string | null;
  source?: string | null; // 来源说明（如 WGSN / 展会名）
  tradeShowId?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  fabricLinks?: TrendTagFabricLink[];
  tradeShow?: TradeShow | null;
}

export interface TrendTagInput {
  seasonId?: string | null;
  type: TrendTagType;
  name: string;
  description?: string | null;
  source?: string | null;
  tradeShowId?: string | null;
}

export type TrendTagPatch = Partial<TrendTagInput>;

export interface TrendingFabricItem {
  link: TrendTagFabricLink;
  tag: TrendTag;
  fabric: TrendFabric;
}

export interface TradeShow {
  id: string;
  seasonId?: string | null;
  name: string;
  location?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  boothNo?: string | null;
  attendees?: number | null;
  cost?: number | null;
  currency?: string | null;
  notes?: string | null;
  status: TradeShowStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  leads?: TradeShowLead[];
}

export interface TradeShowInput {
  seasonId?: string | null;
  name: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  boothNo?: string | null;
  attendees?: number | null;
  cost?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export type TradeShowPatch = Partial<TradeShowInput> & { status?: TradeShowStatus };

export interface TradeShowLead {
  id: string;
  showId: string;
  customerName: string;
  company?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  demand?: string | null;
  nextFollowUpAt?: string | null; // YYYY-MM-DD
  notes?: string | null;
  status: TradeShowLeadStatus;
  convertedRelationId?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface TradeShowLeadInput {
  customerName: string;
  company?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  demand?: string | null;
  nextFollowUpAt?: string | null;
  notes?: string | null;
}

export type TradeShowLeadPatch = Partial<TradeShowLeadInput> & { status?: TradeShowLeadStatus };

/** 展会 ROI 聚合（服务端实时计算） */
export interface TradeShowROI {
  cost: number;
  currency: string;
  leadsTotal: number;
  leadsConverted: number;
  orderCount: number;
  orderAmount: number;
  roi: number;
}

// ════════════════════════════════════════════════════════════════
// 阶段 H H3: 风险管理与合规 Risk & Compliance
// 统一风险预警中心 / 汇率与锁定 / 客户信用评级 / 合规检查 / 质量疵点趋势
// ════════════════════════════════════════════════════════════════

export type RiskAlertType = 'fx_volatility' | 'credit_frozen' | 'bad_debt' | 'compliance_fail' | 'quality_repeat' | 'sample_deadline' | 'hr_lifecycle' | 'crm_follow_up_overdue' | 'lc_maturity' | 'tax_refund_stall' | 'factory_visit';
export type RiskAlertLevel = 'info' | 'warning' | 'critical';
export type RiskAlertStatus = 'Open' | 'Acknowledged' | 'Resolved';

/** 统一风险预警（各维度预警落地于此，dedupKey 为幂等真源） */
export interface RiskAlert {
  id: string;
  type: RiskAlertType;
  level: RiskAlertLevel;
  title: string;
  content: string;
  relatedType?: string | null;
  relatedId?: string | null;
  dedupKey: string;
  status: RiskAlertStatus;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number | null;
}

/** 风险总览（服务端聚合） */
export interface RiskOverview {
  openByType: Record<string, number>;
  openByLevel: Record<string, number>;
  recent: RiskAlert[];
}

export interface ExchangeRate {
  id: string;
  currency: string; // 归一化大写，如 USD | EUR | HKD
  rate: number; // 1 单位外币兑 CNY
  effectiveDate: string; // YYYY-MM-DD
  source: string; // manual | api
  note?: string | null;
  createdAt: number;
}

export interface ExchangeRateInput {
  currency: string;
  rate: number;
  effectiveDate?: string;
  source?: string;
  note?: string | null;
}

/** 各币种最新一条有效汇率 */
export interface LatestFxRate {
  currency: string;
  rate: number;
  effectiveDate: string;
  source: string;
}

/** 大额订单汇率锁定（锁定期间不受波动影响） */
export interface FxRateLock {
  id: string;
  orderId: string;
  currency: string;
  rate: number;
  lockedAt: number;
  lockedById?: string | null;
  note?: string | null;
  createdAt: number;
}

export interface FxRateLockInput {
  orderId: string;
  currency: string;
  rate?: number; // 缺省取该币种最新汇率
  note?: string | null;
}

export type CreditGrade = 'A' | 'B' | 'C' | 'D';

/** 信用评级因子快照 */
export interface CreditRatingFactors {
  onTimeRate: number | null;
  overdueCount: number;
  maxDaysOverdue: number;
  cooperationYears: number;
  settledCount: number;
}

/** 信用评级（append-only 评估历史，最新一条为当前评级） */
export interface CreditRating {
  id: string;
  relationId: string;
  grade: CreditGrade;
  score: number; // 0-100
  factors: CreditRatingFactors;
  evaluatedAt: number;
  evaluatedBy?: string | null; // null = 系统自动评估
}

export type ComplianceCheckType = 'hs_code' | 'export_control' | 'origin_rule';
export type ComplianceCheckResult = 'pass' | 'warn' | 'fail';

/** 合规检查记录（HS Code / 出口管制 / 原产地规则） */
export interface ComplianceCheck {
  id: string;
  type: ComplianceCheckType;
  targetType: string; // CustomsDeclaration | Order | ProductAsset
  targetId: string;
  result: ComplianceCheckResult;
  summary: string;
  details?: Record<string, unknown> | null;
  checkedById?: string | null; // null = 系统自动
  checkedAt: number;
}

export interface ComplianceCheckInput {
  type: ComplianceCheckType;
  targetType: string;
  targetId: string;
  result: ComplianceCheckResult;
  summary: string;
  details?: Record<string, unknown> | null;
}

export interface DefectKeyword {
  keyword: string;
  count: number;
}

/** 疵点趋势聚合行（按工厂或季度分组） */
export interface DefectTrendItem {
  key: string;
  reports: number;
  failCount: number;
  criticalDefects: number;
  majorDefects: number;
  minorDefects: number;
  defectKeywords: DefectKeyword[];
}

// ════════════════════════════════════════════════════════════════
// Phase 3 C2: 生产 MES 深化类型
// 制造执行系统：工位 / 排产 / 工时 / 计件 / 外协
// ════════════════════════════════════════════════════════════════

export type WorkStationType = 'Sewing' | 'Cutting' | 'Printing' | 'Embroidery' | 'Packing' | 'QC' | 'Other';
export type ProductionPlanStatus = 'Draft' | 'Confirmed' | 'InProgress' | 'Completed' | 'Cancelled';
export type Priority = 'High' | 'Normal' | 'Low';
export type PieceRateStatus = 'Pending' | 'Confirmed' | 'Paid';
export type OutsourcingStatus = 'Draft' | 'Sent' | 'Confirmed' | 'InProduction' | 'Received' | 'Cancelled';
export type OutsourcingProcessType = 'Sewing' | 'Cutting' | 'Washing' | 'Printing' | 'Embroidery' | 'Dyeing' | 'Other';

// ── 工位 WorkStation ──
export interface WorkStation {
  id: string;
  code: string;
  name: string;
  type: WorkStationType;
  capacityPerDay?: number | null;
  capacityUnit?: string | null;
  isActive: boolean;
  sortOrder: number;
  location?: string | null;
  manager?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface WorkStationInput {
  code: string;
  name: string;
  type: WorkStationType;
  capacityPerDay?: number;
  capacityUnit?: string;
  isActive?: boolean;
  location?: string;
  manager?: string;
  sortOrder?: number;
  notes?: string;
}

export interface WorkStationUtilization {
  workStationId: string;
  plannedQty: number;
  capacity: number;
  days: number;
  utilization: number;
}

// ── 排产 ProductionPlan ──
export interface ProductionPlan {
  id: string;
  planNumber: string;
  orderId?: string | null;
  workStationId: string;
  workStation?: { code: string; name: string; type: WorkStationType } | null;
  processType: WorkStationType;
  processSeq: number;
  plannedQuantity: number;
  actualQuantity: number;
  unit: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  status: ProductionPlanStatus;
  priority: Priority;
  assignedTo?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  workHours?: WorkHour[];
}

export interface ProductionPlanInput {
  planNumber: string;
  orderId?: string;
  workStationId: string;
  processType: WorkStationType;
  processSeq?: number;
  plannedQuantity: number;
  unit: string;
  plannedStartDate: string;
  plannedEndDate: string;
  priority?: Priority;
  assignedTo?: string;
  notes?: string;
}

// ── 工时 WorkHour ──
export interface WorkHour {
  id: string;
  productionPlanId: string;
  employeeId?: string | null;
  employeeName?: string | null;
  workDate: string;
  hours: number;
  overtimeHours: number;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkHourInput {
  productionPlanId: string;
  employeeId?: string;
  employeeName?: string;
  workDate: string;
  hours: number;
  overtimeHours?: number;
  notes?: string;
}

export interface WorkHourSummary {
  employeeId: string;
  employeeName: string | null;
  totalHours: number;
  totalOvertime: number;
}

// ── 计件规则 PieceRateRule ──
export interface PieceRateRule {
  id: string;
  code: string;
  name: string;
  processType: WorkStationType;
  productAssetId?: string | null;
  unit: string;
  ratePerUnit: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  description?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface PieceRateRuleInput {
  code: string;
  name: string;
  processType: WorkStationType;
  productAssetId?: string;
  unit: string;
  ratePerUnit: number;
  effectiveFrom: string;
  effectiveTo?: string;
  isActive?: boolean;
  description?: string;
  notes?: string;
}

// ── 计件记录 PieceRateRecord ──
export interface PieceRateRecord {
  id: string;
  pieceRateRuleId: string;
  pieceRateRule?: { code: string; name: string; processType: WorkStationType } | null;
  productionPlanId?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  workDate: string;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  amount: number;
  currency: string;
  status: PieceRateStatus;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PieceRateRecordInput {
  pieceRateRuleId: string;
  productionPlanId?: string;
  employeeId?: string;
  employeeName?: string;
  workDate: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface PieceRateSummary {
  employeeId: string;
  employeeName: string | null;
  totalAmount: number;
  pendingAmount: number;
  confirmedAmount: number;
  paidAmount: number;
}

// ── 外协 OutsourcingOrder ──
export interface OutsourcingLine {
  id: string;
  outsourcingOrderId: string;
  processType: OutsourcingProcessType;
  description: string;
  materialCode?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  createdAt: number;
  updatedAt: number;
}

export interface OutsourcingOrder {
  id: string;
  orderNumber: string;
  supplierId?: string | null;
  orderId?: string | null;
  bomId?: string | null;
  processType: OutsourcingProcessType;
  description?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
  totalAmount: number;
  orderDate: string;
  plannedDeliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  qualityAcceptedQty?: number | null;
  qualityRejectedQty?: number | null;
  status: OutsourcingStatus;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  lines?: OutsourcingLine[];
}

export interface OutsourcingLineInput {
  processType: OutsourcingProcessType;
  description: string;
  materialCode?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  notes?: string;
}

export interface OutsourcingOrderInput {
  orderNumber: string;
  supplierId?: string;
  orderId?: string;
  bomId?: string;
  processType: OutsourcingProcessType;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency?: string;
  orderDate?: string;
  plannedDeliveryDate?: string;
  notes?: string;
  lines?: OutsourcingLineInput[];
}

// ── REQ2-05 面料工序级委外链 OrderProcessNode（DR-047：计划+成本核算层） ──

export type FabricProcessType = 'gray_fabric' | 'dyeing' | 'finishing' | 'coating' | 'other';
export type OrderProcessStatus = 'planned' | 'in_progress' | 'done';

export interface OrderProcessNodeRow {
  id: string;
  orderId: string;
  seq: number;
  processType: FabricProcessType;
  supplierId: string | null;
  supplierName: string | null;
  inputQty: number;
  outputQty: number | null;
  unit: string;
  unitPrice: number;
  currency: string;
  amount: number;
  status: OrderProcessStatus;
  completedAt: number | null;
  notes: string | null;
  outsourcingOrderId: string | null;
  createdAt: number;
}

export interface OrderProcessChainSummary {
  total: number;
  done: number;
  inProgress: number;
  planned: number;
  firstInputQty: number;
  lastOutputQty: number | null;
  /** 累计损耗 =（首道投入 − 末道产出）/ 首道投入（无完工节点为 null——预估态） */
  cumulativeLossPct: number | null;
  /** 加工费合计（完工按产出×单价，未完工按投入预估——BOM/利润表消费口径） */
  totalAmount: number;
  byType: Array<{ type: FabricProcessType; amount: number }>;
}

// ════════════════════════════════════════════════════════════════════════════
// 外贸与报关 Customs (Phase 5 B5 + Phase 3 C6)
// 报关单 / HS编码 / 信用证 / 出口退税 / 贸易单据
// ════════════════════════════════════════════════════════════════════════════

export type CustomsType = 'Export' | 'Import';
export type CustomsDeclarationStatus = 'Draft' | 'Submitted' | 'Declared' | 'Inspecting' | 'Released' | 'Exception' | 'Cancelled';
export type HsCodeCategory = 'Textile' | 'Garment' | 'Accessory' | 'Material' | 'Yarn' | 'Other';
export type LetterOfCreditType = 'Irrevocable' | 'Revocable' | 'Standby' | 'Transferable';
export type LetterOfCreditStatus = 'Issued' | 'Presented' | 'Accepted' | 'Discrepant' | 'Settled' | 'Expired' | 'Cancelled';
export type TaxRefundStatus = 'Draft' | 'Submitted' | 'Reviewing' | 'Approved' | 'Rejected' | 'Refunded' | 'Cancelled';
export type TradeDocumentType = 'CommercialInvoice' | 'PackingList' | 'CertificateOfOrigin' | 'BillOfLading' | 'AirWaybill' | 'InsuranceCert' | 'InspectionCert' | 'PhytosanitaryCert' | 'Other';
export type TradeDocumentStatus = 'Draft' | 'Issued' | 'Submitted' | 'Accepted' | 'Rejected' | 'Cancelled';

// ── 报关单 CustomsDeclaration ──

export interface CustomsDeclarationLine {
  id: string;
  declarationId: string;
  lineNumber: number;
  productCode?: string | null;
  productName: string;
  hsCode?: string | null;
  brandName?: string | null;
  specification?: string | null;
  quantity: string;
  unit: string;
  unitPrice?: string | null;
  totalAmount?: string | null;
  currency?: string | null;
  grossWeight?: string | null;
  netWeight?: string | null;
  originCountry?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CustomsDeclaration {
  id: string;
  declarationNumber: string;
  shipmentId?: string | null;
  orderId?: string | null;
  relationId?: string | null;
  type: CustomsType;
  status: CustomsDeclarationStatus;
  declarationDate?: string | null;
  customsCode?: string | null;
  declarationPort?: string | null;
  tradeTerms?: string | null;
  totalValue?: string | null;
  currency?: string | null;
  totalPackages?: number | null;
  grossWeight?: string | null;
  netWeight?: string | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  consignee?: string | null;
  consignor?: string | null;
  declarant?: string | null;
  agent?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  lines?: CustomsDeclarationLine[];
  _count?: { lines: number };
}

export interface CustomsDeclarationLineInput {
  productCode?: string;
  productName: string;
  hsCode?: string;
  brandName?: string;
  specification?: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalAmount?: number;
  currency?: string;
  grossWeight?: number;
  netWeight?: number;
  originCountry?: string;
  notes?: string;
}

export interface CustomsDeclarationInput {
  declarationNumber: string;
  shipmentId?: string;
  orderId?: string;
  relationId?: string;
  type: CustomsType;
  declarationDate?: string;
  customsCode?: string;
  declarationPort?: string;
  tradeTerms?: string;
  totalValue?: number;
  currency?: string;
  totalPackages?: number;
  grossWeight?: number;
  netWeight?: number;
  originCountry?: string;
  destinationCountry?: string;
  consignee?: string;
  consignor?: string;
  declarant?: string;
  agent?: string;
  notes?: string;
  lines?: CustomsDeclarationLineInput[];
}

// ── HS 编码 HsCode ──

export interface HsCode {
  id: string;
  code: string;
  description: string;
  category: HsCodeCategory;
  exportTaxRebateRate?: string | null;
  importTariffRate?: string | null;
  vatRate?: string | null;
  unit?: string | null;
  supervisionCondition?: string | null;
  inspectionQuarantine?: string | null;
  additionalDuty?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HsCodeInput {
  code: string;
  description: string;
  category: HsCodeCategory;
  exportTaxRebateRate?: number;
  importTariffRate?: number;
  vatRate?: number;
  unit?: string;
  supervisionCondition?: string;
  inspectionQuarantine?: string;
  additionalDuty?: string;
  notes?: string;
  isActive?: boolean;
}

// ── 信用证 LetterOfCredit ──

export interface LetterOfCredit {
  id: string;
  lcNumber: string;
  relationId?: string | null;
  orderId?: string | null;
  type: LetterOfCreditType;
  status: LetterOfCreditStatus;
  issueDate?: string | null;
  issueBank?: string | null;
  advisingBank?: string | null;
  negotiatingBank?: string | null;
  confirmingBank?: string | null;
  applicant?: string | null;
  beneficiary?: string | null;
  amount: string;
  currency: string;
  availableAmount?: string | null;
  expiryDate?: string | null;
  expiryPlace?: string | null;
  presentationDeadline?: string | null;
  shipmentDeadline?: string | null;
  tradeTerms?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  documentsRequired?: string[] | null;
  specialConditions?: string | null;
  discrepancies?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

/** F1：信用证节点事件（时间轴渲染，append-only） */
export interface LcEvent {
  id: string;
  lcId: string;
  fromNode?: LetterOfCreditStatus | null;
  toNode: LetterOfCreditStatus;
  eventDate: string;
  note?: string | null;
  actorId?: string | null;
  createdAt: number;
}

/** F3：运单物流节点事件（时间轴渲染，append-only） */
export interface ShipmentEvent {
  id: string;
  shipmentId: string;
  fromNode?: ShipmentStatus | null;
  toNode: ShipmentStatus;
  eventDate: string;
  note?: string | null;
  actorId?: string | null;
  createdAt: number;
}

export interface LetterOfCreditInput {
  lcNumber: string;
  relationId?: string;
  orderId?: string;
  type: LetterOfCreditType;
  issueDate?: string;
  issueBank?: string;
  advisingBank?: string;
  negotiatingBank?: string;
  confirmingBank?: string;
  applicant?: string;
  beneficiary?: string;
  amount: number;
  currency?: string;
  availableAmount?: number;
  expiryDate?: string;
  expiryPlace?: string;
  presentationDeadline?: string;
  shipmentDeadline?: string;
  tradeTerms?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  documentsRequired?: string[];
  specialConditions?: string;
  discrepancies?: string;
  notes?: string;
}

// ── 出口退税 TaxRefund ──

export interface TaxRefund {
  id: string;
  refundNumber: string;
  declarationId?: string | null;
  orderId?: string | null;
  relationId?: string | null;
  status: TaxRefundStatus;
  exportDate?: string | null;
  declarationDate?: string | null;
  fxRate?: string | null;
  exportAmountFob?: string | null;
  exportAmountFobCurrency?: string | null;
  exportAmountCny?: string | null;
  refundableVat?: string | null;
  refundableRate?: string | null;
  refundAmount?: string | null;
  refundDate?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
  reviewNotes?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface TaxRefundInput {
  refundNumber: string;
  declarationId?: string;
  orderId?: string;
  relationId?: string;
  exportDate?: string;
  declarationDate?: string;
  fxRate?: number;
  exportAmountFob?: number;
  exportAmountFobCurrency?: string;
  exportAmountCny?: number;
  refundableVat?: number;
  refundableRate?: number;
  refundAmount?: number;
  refundDate?: string;
  notes?: string;
}

export interface TaxRefundReviewInput {
  reviewedBy: string;
  decision: 'Approved' | 'Rejected';
  reviewNotes?: string;
  refundAmount?: number;
}

// ── 贸易单据 TradeDocument ──

export interface TradeDocument {
  id: string;
  documentNumber: string;
  type: TradeDocumentType;
  status: TradeDocumentStatus;
  shipmentId?: string | null;
  declarationId?: string | null;
  orderId?: string | null;
  relationId?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  issuedBy?: string | null;
  consignee?: string | null;
  consignor?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  totalAmount?: string | null;
  currency?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface TradeDocumentInput {
  /** 留空自动取号（{类型前缀}-YYYY-NNNN，Wave A1 服务端生成） */
  documentNumber?: string;
  type: TradeDocumentType;
  shipmentId?: string;
  declarationId?: string;
  orderId?: string;
  relationId?: string;
  issueDate?: string;
  expiryDate?: string;
  issuedBy?: string;
  consignee?: string;
  consignor?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  totalAmount?: number;
  currency?: string;
  filePath?: string;
  fileName?: string;
  notes?: string;
  /** 更新时写入 DocumentVersion 的变更原因（仅 update 消费） */
  changeReason?: string;
}

// ── Wave A1 单据中心：版本留痕 / 生成即登记 / 批量打包 ──

export interface DocumentVersionRecord {
  id: string;
  documentId: string;
  version: number;
  /** 变更后快照；运单生成的 v1 为 { documentSet: DocumentSetData }（可直接喂 EXPORT_DOC_RENDERERS） */
  content: Record<string, unknown>;
  changeReason?: string | null;
  changedBy?: string | null;
  createdAt: number;
}

export interface GenerateTradeDocumentsResult {
  created: Array<{ id: string; documentNumber: string; type: string }>;
  skipped: Array<{ type: string; id: string; documentNumber: string; reason: 'EXISTS' }>;
  /** 装配数据完整度提示（不阻断） */
  missing: string[];
}

export interface TradeDocumentPackItem {
  id: string;
  documentNumber: string;
  type: string;
  status: string;
  issueDate: string | null;
  consignee: string | null;
  consignor: string | null;
  totalAmount: number | null;
  currency: string | null;
  fileName: string | null;
  latestVersion: number | null;
  content: Record<string, unknown> | null;
}

// ── 概览 ──

export interface CustomsOverview {
  declarations: { total: number; released: number };
  lettersOfCredit: { pending: number; settled: number };
  taxRefunds: { pending: number; refunded: number; totalRefundedAmount: number };
  tradeDocuments: { total: number };
}

// ════════════════════════════════════════════════════════════════
// 阶段 P0: QC 工作台 + 驻地管理 + 业务线配置
// QC 验货任务分配 / QC 驻地 / 业务线规则（MOQ 校验与报表口径）
// ════════════════════════════════════════════════════════════════

/** BusinessLine：业务线注册表（影响 MOQ 校验 / 生产流程 / 报表口径） */
export interface BusinessLine {
  id: string;
  code: string; // fabric | garment | capsule
  name: string;
  description?: string | null;
  moqValue?: number | null;
  moqUnit?: string | null; // M | PC
  productionCycleDays?: number | null;
  paymentTermsHint?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface BusinessLineInput {
  code: string;
  name: string;
  description?: string | null;
  moqValue?: number | null;
  moqUnit?: string | null;
  productionCycleDays?: number | null;
  paymentTermsHint?: string | null;
  sortOrder?: number;
}

export type BusinessLinePatch = Partial<Omit<BusinessLineInput, 'code'>> & { isActive?: boolean };

/** QCLocation：QC 驻地（温州驻场-服装 / 苏州驻场-面料） */
export interface QCLocation {
  id: string;
  code: string; // wenzhou | suzhou
  name: string;
  region?: string | null;
  focus?: string | null; // 驻地主攻业务线：garment | fabric
  address?: string | null;
  notes?: string | null;
}

export interface QCLocationInput {
  code: string;
  name: string;
  region?: string | null;
  focus?: string | null;
  address?: string | null;
  notes?: string | null;
}

export type QCLocationPatch = Partial<QCLocationInput>;

export type QCInspectionType = 'midline' | 'final';
export type QCAssignmentStatus = 'Assigned' | 'InProgress' | 'Completed' | 'Cancelled';

/** QC 任务上的订单快照（服务端冗余，前端只读展示） */
export interface QCOrderSnapshot {
  poNumber?: string | null;
  customer: string;
  product: string;
  dueDate: string;
  clientDate?: string | null;
  businessLine?: string | null;
}

/** QCAssignment：QC 验货任务分配 */
export interface QCAssignment {
  id: string;
  orderId: string;
  inspectionType: QCInspectionType; // midline 中期验货 | final 终期验货
  qcUserId: string; // UserAccount snapshot FK
  locationId?: string | null;
  factoryRelationId?: string | null;
  status: QCAssignmentStatus;
  dueDate?: string | null; // YYYY-MM-DD
  assignedAt: number;
  assignedById?: string | null;
  completedAt?: number | null;
  reportId?: string | null;
  notes?: string | null;
  location?: QCLocation | null;
  order?: QCOrderSnapshot | null;
}

export interface QCAssignmentInput {
  orderId: string;
  inspectionType: QCInspectionType;
  qcUserId: string;
  locationId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export type QCAssignmentPatch = Partial<Omit<QCAssignmentInput, 'orderId'>>;

/** QC 工作台聚合视图（按状态分组，含订单快照 + 驻地） */
export interface QcWorkbenchData {
  assigned: QCAssignment[];
  inProgress: QCAssignment[];
  completed: QCAssignment[];
}

/** 订单 MOQ 校验结果（业务线软校验，产出警示不阻断） */
export interface QcMoqCheckResult {
  checked: boolean;
  reason?: string;
  businessLine?: string | null;
  moqValue?: number | null;
  moqUnit?: string | null;
  quantity?: number | null;
  compliant?: boolean | null;
  violations?: string[];
}

/** QC 人员选择器选项（UserAccount 最小快照，来自 /api/hr/personnel） */
export interface UserAccountOption {
  id: string;
  displayName: string;
  email?: string | null;
  status?: string | null;
  department?: string | null;
}

// ════════════════════════════════════════════════════════════════
// 阶段 P1: 定价与利润（PRD 8 双轨制 / 6.2 P1）
// TaxRefundRate 退税率表 / PricingCalculation 轨道 B / OrderProfitSheet 利润表 / MaterialPriceHistory 价格历史
// ════════════════════════════════════════════════════════════════

/** TaxRefundRate：出口退税率表（HS Code → 退税率映射，最长前缀命中） */
export interface TaxRefundRate {
  id: string;
  hsCode: string; // 2/4/6/8/10 位
  rate: number; // 退税率百分比（13 = 13%）
  description?: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TaxRefundRateInput {
  hsCode: string;
  rate: number;
  description?: string | null;
  isActive?: boolean;
}

export type TaxRefundRatePatch = Partial<Omit<TaxRefundRateInput, 'hsCode'>>;

/** 轨道 B 试算结果（派生值一律服务端重算） */
export interface TrackBResult {
  netUsdCost: number; // 退税后美元成本
  profitAmount: number;
  commissionAmount: number;
  finalUnitPrice: number; // 终价美元单价
}

// ── 轨道 A 系统推荐估算（PRD 8.1/8.6） ──

export type TrackACategory = 'garment' | 'fabric';
export type TrackASource = 'price_history' | 'industry_benchmark' | 'manual';
export type TrackADataQuality = 'full_history' | 'partial' | 'benchmark_only';
export type PriceDeviationLevel = 'ok' | 'warn' | 'block';

export interface TrackACostLine {
  key: string; // fabric | trimming | cmt | packaging | yarn | weaving | dyeing
  label: string;
  amountCny: number;
  source: TrackASource;
  adjusted?: boolean;
}

export interface TrackAInput {
  category: TrackACategory;
  fabricPriceCny?: number;
  fabricConsumptionM?: number;
  fabricLossRate?: number;
  trimmingCostCny?: number;
  cmtCostCny?: number;
  complexity?: 'simple' | 'standard' | 'complex';
  packagingCostCny?: number;
  yarnPriceCnyPerKg?: number;
  weightGsm?: number;
  widthM?: number;
  weavingCostCny?: number;
  weaveType?: 'plain' | 'twill' | 'jacquard';
  dyeingCostCny?: number;
  profitBenchmark?: number;
  exchangeRate?: number;
  quantity?: number;
  lines?: TrackACostLine[];
  fabricCode?: string; // 命中 MaterialPriceHistory(fabric) 最新价
  yarnCode?: string; // 命中 MaterialPriceHistory(yarn) 最新价
}

export interface TrackAResult {
  category: TrackACategory;
  unit: 'PC' | 'M';
  lines: TrackACostLine[];
  costTotalCny: number;
  profitBenchmark: number;
  priceMedianCny: number;
  priceLowCny: number;
  priceHighCny: number;
  priceMedianUsd: number | null;
  priceLowUsd: number | null;
  priceHighUsd: number | null;
  spreadPercent: number;
  dataQuality: TrackADataQuality;
}

export interface TrackBInput {
  purchaseCostCny: number;
  refundRate: number;
  exchangeRate: number;
  profitMargin: number;
  commissionRate?: number; // 0=无 | 5=E5 | 10=E10
}

export type PricingCalculationStatus = 'Draft' | 'Confirmed' | 'Archived';

/** PricingCalculation：退税美元定价记录（轨道 B） */
export interface PricingCalculation extends TrackBResult {
  id: string;
  purchaseCostCny: number;
  refundRate: number;
  exchangeRate: number;
  profitMargin: number;
  commissionRate: number;
  orderId?: string | null;
  quotationId?: string | null;
  productAssetId?: string | null;
  hsCode?: string | null;
  fxLockId?: string | null;
  commissionRuleId?: string | null; // 佣金率来源规则（P2）；提供时 commissionRate 为规则值快照
  quantity?: number | null;
  status: PricingCalculationStatus;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PricingCalculationInput {
  purchaseCostCny: number;
  refundRate?: number;
  exchangeRate?: number;
  profitMargin: number;
  commissionRate?: number;
  orderId?: string | null;
  quotationId?: string | null;
  productAssetId?: string | null;
  hsCode?: string | null;
  fxLockId?: string | null;
  commissionRuleId?: string | null;
  quantity?: number | null;
  status?: PricingCalculationStatus;
  notes?: string | null;
}

export type PricingCalculationPatch = Partial<PricingCalculationInput>;

// ════════════════════════════════════════════════════════════════
// 阶段 P2：佣金规则 / 电子画册 / 面料推荐
// ════════════════════════════════════════════════════════════════

/** CommissionRule：中间人佣金规则（E5/E10，配置真源） */
export interface CommissionRule {
  id: string;
  name: string;
  rate: number; // 5 = E5 | 10 = E10
  intermediaryRelationId?: string | null; // 空 = 默认规则
  intermediaryName?: string | null;
  isActive: boolean;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CommissionRuleInput {
  name: string;
  rate: number;
  intermediaryRelationId?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type CommissionRulePatch = Partial<CommissionRuleInput>;

/** LookbookCatalog：电子画册（条目为服务端档案真源快照） */
export type LookbookStatus = 'Draft' | 'Published' | 'Archived';

export interface LookbookItemSnapshot {
  productAssetId: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  sortOrder: number;
}

export interface LookbookItemInput {
  productAssetId: string;
  price?: number | null;
  currency?: string | null;
  description?: string | null;
  sortOrder?: number;
}

export interface LookbookCatalog {
  id: string;
  title: string;
  description?: string | null;
  status: LookbookStatus;
  items: LookbookItemSnapshot[];
  publishedAt?: number | null;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** FabricRecommendation：面料推荐（确定性打分，criteria + results 快照） */
export interface RecommendCriteria {
  season?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  compositionKeywords?: string[] | null;
  weightMin?: number | null;
  weightMax?: number | null;
  pattern?: string | null;
  limit?: number | null;
}

export interface RecommendResultItem {
  productAssetId: string;
  sku: string;
  name: string;
  score: number;
  reasons: string[];
  season?: string | null;
  latestPrice?: number | null;
  priceCurrency?: string | null;
  weightValue?: number | null;
  weightUnit?: string | null;
  pattern?: string | null;
  millName?: string | null;
}

export interface FabricRecommendation {
  id: string;
  criteria: RecommendCriteria;
  results: RecommendResultItem[];
  createdBy?: string | null;
  createdAt: number;
}

/** 利润表明细行（归一化至 CNY） */
export interface ProfitLineItem {
  id: string;
  label: string;
  amount: number;
  currency: string;
  rate: number;
  rateSource: 'snapshot' | 'base' | 'latest-rate';
  cnyAmount: number;
}

export interface UnconvertedLine {
  id: string;
  label: string;
  kind: 'sales' | 'purchase' | 'freight' | 'misc';
  amount: number;
  currency: string;
  reason: string;
}

export interface ProfitSheetDetails {
  sales: ProfitLineItem[];
  purchases: ProfitLineItem[];
  freight: ProfitLineItem[];
  misc: ProfitLineItem[];
  unconverted: UnconvertedLine[];
}

/** OrderProfitSheet：订单级利润表（一单一张，重生成覆盖） */
export interface OrderProfitSheet {
  id: string;
  orderId: string;
  baseCurrency: string;
  salesRevenue: number;
  purchaseCost: number;
  freightCost: number;
  miscCost: number;
  grossProfit: number;
  grossMargin?: number | null;
  details: ProfitSheetDetails;
  version: number;
  generatedAt: number;
  createdAt: number;
  updatedAt: number;
}

export type MaterialPriceType = 'yarn' | 'fabric' | 'trimming';
export type MaterialPriceSource = 'manual' | 'purchase-order' | 'quotation';

/** REQ2-14 海运费变动利润重估（DR-054：只读预览，X-04 一屏可见） */
export interface FreightImpactItem {
  orderId: string;
  poNumber: string;
  customer: string | null;
  status: string;
  baseline: { grossProfit: number; grossMargin: number | null; freightCost: number; source: 'persisted' | 'computed' };
  reestimated: { grossProfit: number; grossMargin: number | null; freightCost: number };
  deltaProfit: number;
  deltaMargin: number | null;
  advice: 'renegotiate' | 'warn' | 'ok';
}

export interface FreightImpactResult {
  items: FreightImpactItem[];
  summary: {
    multiplier: number;
    affectedOrders: number;
    baselineProfitTotal: number;
    reestimatedProfitTotal: number;
    deltaProfitTotal: number;
    negativeProfitOrders: number;
    renegotiateOrders: number;
    warnOrders: number;
  };
}

/** MaterialPriceHistory：原材料价格历史（轨道 A 估算校准数据源） */
export interface MaterialPriceHistory {
  id: string;
  materialType: MaterialPriceType;
  materialCode?: string | null;
  name: string;
  specification?: string | null;
  price: number;
  unit: string;
  currency: string;
  priceDate: string; // YYYY-MM-DD
  source: MaterialPriceSource;
  supplierRelationId?: string | null;
  supplierName?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MaterialPriceInput {
  materialType: MaterialPriceType;
  materialCode?: string | null;
  name: string;
  specification?: string | null;
  price: number;
  unit: string;
  currency?: string;
  priceDate: string;
  source?: MaterialPriceSource;
  supplierRelationId?: string | null;
  supplierName?: string | null;
  notes?: string | null;
}

export type MaterialPricePatch = Partial<MaterialPriceInput>;

export interface MaterialPriceTrendPoint {
  priceDate: string;
  price: number;
  unit: string;
  currency: string;
  source: MaterialPriceSource;
  supplierName?: string | null;
}
