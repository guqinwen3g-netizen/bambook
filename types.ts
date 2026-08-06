
export enum View {
  Dashboard = 'dashboard',
  Assistant = 'assistant',
  Relations = 'relations',
  Products = 'products',
  KnowledgeBase = 'knowledge-base',
  Orders = 'orders',
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
  // 控制全局光效（spotlight 跟随光、liquid edge 边缘光晕）。默认开启；关闭后玻璃材质 / 边框 / 阴影保持不变。
  enableLightEffects?: boolean;

  // AI Core — chatModelId 与 lib/ai/client MODELS 中的模型 ID 一致
  chatModelId?: string;
  temperature?: number;
  maxTokens?: number;
  enableVision?: boolean;

  // Voice & Interaction
  ttsProvider?: 'Browser' | 'Volcengine-TTS' | 'OpenAI-TTS';
  voiceSpeed?: number;

  // Privacy & Security
  dataMasking?: boolean;

  // SDK API - AI 助理集成
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

export type RelationCategory = 'Supplier' | 'Customer' | 'Agent' | 'Partner' | 'Government' | 'Internal' | 'Other';

export interface Relation {
  id: string;
  name: string;
  category: RelationCategory;
  type: 'Supplier' | 'Customer' | 'Partner';
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
  type: 'Fabric' | 'Garment';
  factoryLat?: number;
  factoryLon?: number;
  quantity: number;
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

  // 面料规格 (Fabric Specs)
  fabricContent?: string;  // 面料成份
  fabricCode?: string;     // 面料编号
  width?: string;          // 门幅 (CM)
  gsm?: string;            // 克重

  // 订单行明细：从后端 OrderLine 拿来的，用于列表里"按行展开"渲染。
  // 一个 PO 可能有多个 line，每个 line 在订单列表里独立成一行。
  lines?: OrderLineLite[];
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

  // Garment extension fields
  sizeBreakdown?: Record<string, number> | null;   // { S: 100, M: 200, L: 200, XL: 100 }
  productionSteps?: ProductionStep[] | null;        // [{ step, status, date }]
  styleNo?: string | null;                          // 款式号
  colorName?: string | null;                        // 色号名称
  bomItems?: BomItem[] | null;                      // [{ type, name, qty, unit }]
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
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  attachments?: unknown;
  deletedAt?: number | null;
  updatedAt: number;
  createdAt: number;
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

export type ShipmentStatus = 'Draft' | 'Booked' | 'Loading' | 'Shipped' | 'Arrived' | 'Cleared' | 'Delivered' | 'Cancelled';
export type ShipmentDirection = 'Outbound' | 'Inbound';

export interface ShipmentLine {
  id: string;
  shipmentId: string;
  orderId?: string;
  orderPo?: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  unit?: string;
  cartons?: number;
  grossWeight?: number;
  netWeight?: number;
  volume?: number;
  notes?: string;
  deletedAt?: number | null;
}

export type ShipmentType2 = 'Export' | 'Import' | 'Domestic';

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
