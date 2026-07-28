/**
 * 订单字段词典 — 三处 UI（订单详情卡 / 手动录入弹窗 / PDF 导入预览）共享的唯一真源。
 *
 * 历史问题：三处各自手写字段列表与中英文标签，导致同一概念在不同入口里：
 *   - 名字不同（millName）
 *   - 顺序/分组不同
 *   - 有的入口完全漏字段（如手动录入连 PO# 都没有 → 按钮哑火）
 *
 * 修复方式：所有可写字段在这里登记一次。三处 UI 通过 `shownInDetail` /
 * `shownInImportPreview` / `shownInManualForm` 三个布尔过滤本入口该渲染哪些字段，
 * 再按 `cluster` 分组、按本数组的顺序渲染。
 *
 * 任何新增字段都先在这里登记，再在 types.ts `Order` 接口里加列；编译器会用
 * `keyof Order` 约束保证不跑偏。
 */

import type { Order } from '../types';

// ---------------------------------------------------------------------------
// Cluster definitions — UI 渲染时的分组顺序与标签
// ---------------------------------------------------------------------------

export type OrderFieldCluster =
  | 'basic'           // 基础生产档案：PO#/PO Date/Season/Batch/Item Code 等
  | 'parties'         // 买卖四方：Customer / Mill / Consignee / Bill-to
  | 'delivery'        // 交期与物流：生产交期/出厂交期/收货方
  | 'fabric'          // 面料规格：成份/门幅/克重
  | 'sales'           // 销售/收汇：销售单价、合同金额、收汇日期
  | 'shipment'        // 出货与发票：发票号、出货数量金额
  | 'sampleShipment'  // 大货船样
  | 'sampleFabric'    // 匹头样
  | 'purchase'        // 采购与供应商发票
  | 'instructions';   // 特别说明

export interface OrderClusterMeta {
  id: OrderFieldCluster;
  labelZh: string;
  labelEn: string;
  /** Detail card 的 cluster 顺序（越小越靠前）。 */
  detailOrder: number;
  /** 手动录入弹窗的 cluster 顺序。 */
  manualOrder: number;
}

export const ORDER_CLUSTERS: OrderClusterMeta[] = [
  { id: 'basic',          labelZh: '基础档案',       labelEn: 'Basic',           detailOrder: 1, manualOrder: 1 },
  { id: 'parties',        labelZh: '买卖四方',       labelEn: 'Parties',         detailOrder: 2, manualOrder: 2 },
  { id: 'delivery',       labelZh: '交期与物流',     labelEn: 'Delivery',        detailOrder: 3, manualOrder: 3 },
  { id: 'fabric',         labelZh: '面料规格',       labelEn: 'Fabric Specs',    detailOrder: 4, manualOrder: 4 },
  { id: 'sales',          labelZh: '销售与收汇',     labelEn: 'Sales',           detailOrder: 5, manualOrder: 5 },
  { id: 'shipment',       labelZh: '出货与发票',     labelEn: 'Shipment',        detailOrder: 6, manualOrder: 99 },
  { id: 'sampleShipment', labelZh: '大货船样',       labelEn: 'Shipment Sample', detailOrder: 7, manualOrder: 99 },
  { id: 'sampleFabric',   labelZh: '匹头样',         labelEn: 'Fabric Sample',   detailOrder: 8, manualOrder: 99 },
  { id: 'purchase',       labelZh: '采购与供应商',   labelEn: 'Procurement',     detailOrder: 9, manualOrder: 6 },
  { id: 'instructions',   labelZh: '特别说明',       labelEn: 'Instructions',    detailOrder: 10, manualOrder: 7 },
];

// ---------------------------------------------------------------------------
// Sub-group definitions — within a cluster, sub-groups split into sub-cards
// ---------------------------------------------------------------------------

export interface SubGroupMeta {
  id: string;
  labelZh: string;
  labelEn: string;
  accentColor: string; // Tailwind bg class for accent bar
}

export const PARTIES_SUBGROUPS: SubGroupMeta[] = [
  { id: 'customer',  labelZh: '客户',       labelEn: 'Customer',   accentColor: 'bg-blue-500' },
  { id: 'mill',      labelZh: '面料工厂',   labelEn: 'Mill',       accentColor: 'bg-amber-500' },
  { id: 'consignee', labelZh: '收货方',     labelEn: 'Consignee',  accentColor: 'bg-emerald-500' },
  { id: 'billTo',    labelZh: '结款方',     labelEn: 'Bill-to',    accentColor: 'bg-purple-500' },
  { id: 'internal',  labelZh: '内部团队',   labelEn: 'Internal',   accentColor: 'bg-rose-500' },
];

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

export type OrderFieldType = 'text' | 'longText' | 'number' | 'date' | 'enum' | 'currency' | 'boolean';

export type OrderFieldSource = 'pdf' | 'manual' | 'both';

export type RoleFkTarget = 'customer' | 'mill' | 'consignee' | 'billTo' | 'internal';

/**
 * Compile-time guarantee that every metadata entry's `key` resolves to an
 * actual property on the `Order` interface. If you remove a field from
 * `types.ts`, TypeScript will flag the row in this dictionary.
 */
export type OrderFieldKey = keyof Order;

export interface FieldMeta {
  /** Must be a key on the `Order` interface. */
  key: OrderFieldKey;
  labelZh: string;
  labelEn: string;
  cluster: OrderFieldCluster;
  type: OrderFieldType;
  /** For 'currency' fields, decides ¥ vs $ prefix and which currency column to read. */
  currencySide?: 'sales' | 'purchase';
  /** For 'enum' fields, the allowed values. */
  enumOptions?: ReadonlyArray<string>;
  /** Where this field can come from: PDF only, manual only, or both. */
  source: OrderFieldSource;
  shownInDetail: boolean;
  shownInImportPreview: boolean;
  shownInManualForm: boolean;
  /** When set, this field stores the *name snapshot* of a Relation entity. */
  relationFk?: RoleFkTarget;
  /** True when manual form should require this field before allowing save. */
  required?: boolean;
  /** Optional short hint shown under the input. */
  hintZh?: string;
  /** Optional placeholder. */
  placeholder?: string;
  /** Sub-group within a cluster (e.g. 'customer', 'mill' within 'parties'). */
  subGroup?: string;
  /** When a Relation FK is selected, auto-fill this field from the Relation's properties. */
  autoFillFrom?: {
    fkField: string;
    mapping: Record<string, string>;
  };
}

/**
 * The single source of truth for what fields exist and how they render.
 *
 * Order in this array determines render order *within each cluster*.
 */
export const ORDER_FIELDS: ReadonlyArray<FieldMeta> = [
  // ============ Cluster: basic — 基础档案 ============
  { key: 'poNumber',         labelZh: '订单号 (PO#)',     labelEn: 'PO Number',     cluster: 'basic', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, required: true, placeholder: 'PE25-1234' },
  { key: 'itemNo',           labelZh: 'PO Item 编号',      labelEn: 'PO Item',       cluster: 'basic', type: 'text', source: 'manual', shownInDetail: false, shownInImportPreview: false, shownInManualForm: true, placeholder: '0010', hintZh: '同一 PO 下自动按 0010 / 0020 递增，可手动改成 0011 等修订号' },
  { key: 'poDate',           labelZh: 'PO 日期',          labelEn: 'PO Date',       cluster: 'basic', type: 'date', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true },
  { key: 'season',           labelZh: '季节',             labelEn: 'Season',        cluster: 'basic', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, placeholder: 'SS26' },
  { key: 'productionBatch',  labelZh: '生产批次',         labelEn: 'Prod Batch',    cluster: 'basic', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, placeholder: 'B001' },
  { key: 'productColorCode', labelZh: '品/色号',          labelEn: 'Item/Color',    cluster: 'basic', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, hintZh: '从首行 millQuality 自动带出' },
  { key: 'clientCode',       labelZh: '客户编码 (Client Code)', labelEn: 'Client Code',   cluster: 'basic', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, hintZh: '客户给产品的编码，从首行 materialCode 自动带出' },
  { key: 'referenceBatch',   labelZh: '参考批次',         labelEn: 'Ref Batch',     cluster: 'basic', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'quantity',         labelZh: '订单数量',         labelEn: 'Order Qty',     cluster: 'basic', type: 'number', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, required: true },

  // ============ Cluster: parties — 买卖四方 + 内部团队 ============
  // --- Sub-group: customer ---
  { key: 'customer',         labelZh: '客户 (Customer)',     labelEn: 'Customer',         cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, relationFk: 'customer', required: true, placeholder: 'Peerless', hintZh: '下单方，对应 Relations 里的 Customer 实体', subGroup: 'customer' },
  { key: 'customerAddress',  labelZh: '客户地址',             labelEn: 'Customer Address', cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'customer', autoFillFrom: { fkField: 'customer', mapping: { officialAddress: 'customerAddress' } } },
  { key: 'contactPerson',    labelZh: '客户联系人',          labelEn: 'Contact',          cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, subGroup: 'customer', autoFillFrom: { fkField: 'customer', mapping: { primaryContactName: 'contactPerson' } } },
  { key: 'contactTelephone', labelZh: '客户联系电话',        labelEn: 'Contact Tel',      cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, subGroup: 'customer', autoFillFrom: { fkField: 'customer', mapping: { primaryContactPhone: 'contactTelephone' } } },

  // --- Sub-group: mill ---
  { key: 'millName',         labelZh: '面料工厂 (Mill)',     labelEn: 'Mill / Supplier',  cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, relationFk: 'mill', required: true, hintZh: '我方采购对象，应付侧', subGroup: 'mill' },
  { key: 'millAddress',      labelZh: '面料工厂地址',        labelEn: 'Mill Address',     cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'mill', autoFillFrom: { fkField: 'mill', mapping: { factoryAddresses: 'millAddress' } } },
  { key: 'millContact',      labelZh: '面料工厂联系人',      labelEn: 'Mill Contact',     cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'mill', autoFillFrom: { fkField: 'mill', mapping: { primaryContactName: 'millContact' } } },
  { key: 'millPhone',        labelZh: '面料工厂电话',        labelEn: 'Mill Phone',       cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'mill', autoFillFrom: { fkField: 'mill', mapping: { primaryContactPhone: 'millPhone' } } },

  // --- Sub-group: consignee ---
  { key: 'consigneeName',    labelZh: '收货方 (服装厂)',     labelEn: 'Consignee',        cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, relationFk: 'consignee', hintZh: 'PDF ship-to 公司，物流目的地', subGroup: 'consignee' },
  { key: 'consigneeAddress', labelZh: '收货方地址',          labelEn: 'Consignee Address', cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, subGroup: 'consignee', autoFillFrom: { fkField: 'consignee', mapping: { officialAddress: 'consigneeAddress' } } },
  { key: 'consigneeContact', labelZh: '收货方联系人',        labelEn: 'Consignee Contact', cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'consignee', autoFillFrom: { fkField: 'consignee', mapping: { primaryContactName: 'consigneeContact' } } },

  // --- Sub-group: billTo ---
  { key: 'billToName',       labelZh: '结款方 (Bill-to)',    labelEn: 'Bill-to',          cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, relationFk: 'billTo', hintZh: '默认等于服装厂；有代理时填代理名', subGroup: 'billTo' },
  { key: 'billToAddress',    labelZh: '结款方地址',          labelEn: 'Bill-to Address',  cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'billTo', autoFillFrom: { fkField: 'billTo', mapping: { officialAddress: 'billToAddress' } } },
  { key: 'billToContact',    labelZh: '结款方联系人',        labelEn: 'Bill-to Contact',  cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'billTo', autoFillFrom: { fkField: 'billTo', mapping: { primaryContactName: 'billToContact' } } },
  { key: 'billToIsAgent',    labelZh: '结款方是代理',        labelEn: 'Bill-to is Agent', cluster: 'parties', type: 'boolean', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, subGroup: 'billTo' },

  // --- Sub-group: internal ---
  { key: 'salesPerson',      labelZh: '销售 (Sales)',        labelEn: 'Sales',            cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, relationFk: 'internal', hintZh: '公司内部销售人员', subGroup: 'internal' },
  { key: 'merchandiser',     labelZh: '跟单员 (Merchandiser)', labelEn: 'Merchandiser',   cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, relationFk: 'internal', hintZh: '公司内部跟单员', subGroup: 'internal' },
  { key: 'supervisor',       labelZh: '主管 (Manager)',      labelEn: 'Manager',          cluster: 'parties', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, relationFk: 'internal', hintZh: '公司内部主管', subGroup: 'internal' },

  { key: 'asPerson',         labelZh: 'A/S 联络人',          labelEn: 'A/S Person',       cluster: 'parties', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, hintZh: '售后/跟单接口人' },

  // ============ Cluster: delivery — 交期与物流 ============
  { key: 'productionDate',   labelZh: '生产交期',         labelEn: 'Prod Deadline',  cluster: 'delivery', type: 'date', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, hintZh: '从首行 deliveryDate 带出' },
  { key: 'clientDate',       labelZh: '出厂交期 (Exmill)', labelEn: 'Exmill Date',   cluster: 'delivery', type: 'date', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, hintZh: '从首行 exMillDate 带出' },
  { key: 'shippingDate',     labelZh: '实际发货日',       labelEn: 'Ship Date',      cluster: 'delivery', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'shippingMethod',   labelZh: '运输方式',         labelEn: 'Ship Method',    cluster: 'delivery', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },

  // ============ Cluster: fabric — 面料规格 ============
  { key: 'fabricCode',       labelZh: '面料编号',         labelEn: 'Fabric Code',    cluster: 'fabric', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true },
  { key: 'fabricContent',    labelZh: '成份',             labelEn: 'Content',        cluster: 'fabric', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, placeholder: '100% Cotton' },
  { key: 'width',            labelZh: '门幅 (Width CM)',  labelEn: 'Width',          cluster: 'fabric', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, placeholder: '150 CM' },
  { key: 'gsm',              labelZh: '克重 (GSM)',       labelEn: 'GSM',            cluster: 'fabric', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, placeholder: '180 GSM' },
  { key: 'product',          labelZh: '品名/规格',        labelEn: 'Product',        cluster: 'fabric', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, placeholder: 'Cotton Jersey' },

  // ============ Cluster: sales — 销售与收汇 ============
  { key: 'salesContractNumber', labelZh: '早期销售合同号', labelEn: 'Sales Contract #', cluster: 'sales', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true, hintZh: 'PO 确认即出，给客户' },
  { key: 'finalContractNumber', labelZh: '最终销售合同号', labelEn: 'Final Contract #', cluster: 'sales', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false, hintZh: '出货时出，给 Bill-to' },
  { key: 'salesPrice',          labelZh: '销售单价',       labelEn: 'Unit Price',       cluster: 'sales', type: 'currency', currencySide: 'sales', source: 'both', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true },
  { key: 'contractAmount',      labelZh: '销售合同金额',   labelEn: 'Contract Amount',  cluster: 'sales', type: 'currency', currencySide: 'sales', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true },
  { key: 'paymentInstrument',   labelZh: '付款方式',       labelEn: 'Pay Instrument',   cluster: 'sales', type: 'enum', enumOptions: ['T/T', 'L/C', 'O/A', 'D/P', 'D/A', 'Other'], source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true },
  { key: 'paymentTerms',        labelZh: '付款条件',       labelEn: 'Pay Terms',        cluster: 'sales', type: 'text', source: 'both', shownInDetail: true, shownInImportPreview: true, shownInManualForm: true, placeholder: 'Net 30 / At Sight' },
  { key: 'expectedPaymentDate', labelZh: '预计付款日',     labelEn: 'Expected Pay',     cluster: 'sales', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'actualPaymentDate',   labelZh: '实际付款日',     labelEn: 'Actual Pay',       cluster: 'sales', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'actualPaymentAmount', labelZh: '实际收汇金额',   labelEn: 'Actual Recv',      cluster: 'sales', type: 'currency', currencySide: 'sales', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },

  // ============ Cluster: shipment — 出货与发票 ============
  { key: 'invoiceNumber',    labelZh: '发票号',           labelEn: 'Invoice #',      cluster: 'shipment', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'invoiceDate',      labelZh: '发票日期',         labelEn: 'Invoice Date',   cluster: 'shipment', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'shipmentQuantity', labelZh: '出货数量',         labelEn: 'Ship Qty',       cluster: 'shipment', type: 'number', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'shipmentAmount',   labelZh: '出货金额',         labelEn: 'Ship Amount',    cluster: 'shipment', type: 'currency', currencySide: 'sales', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },

  // ============ Cluster: sampleShipment — 大货船样 ============
  { key: 'sampleSentDate',         labelZh: '船样寄出日期', labelEn: 'S/Sample Sent', cluster: 'sampleShipment', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'sampleConfirmedDate',    labelZh: '船样确认日期', labelEn: 'S/Sample Conf', cluster: 'sampleShipment', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'shipmentSampleComments', labelZh: '船样意见',     labelEn: 'S/Sample Note', cluster: 'sampleShipment', type: 'longText', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },

  // ============ Cluster: sampleFabric — 匹头样 ============
  { key: 'fabricSampleSentDate',      labelZh: '匹头样寄出日期', labelEn: 'H/Sample Sent', cluster: 'sampleFabric', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'fabricSampleConfirmedDate', labelZh: '匹头样确认日期', labelEn: 'H/Sample Conf', cluster: 'sampleFabric', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'paidSampleQuantity',        labelZh: '收费样品数量',   labelEn: 'Paid Sample',   cluster: 'sampleFabric', type: 'number', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },

  // ============ Cluster: purchase — 采购与供应商 ============
  { key: 'purchasePrice',          labelZh: '采购单价',     labelEn: 'Purchase Cost',     cluster: 'purchase', type: 'currency', currencySide: 'purchase', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true },
  { key: 'purchasePaymentDate',    labelZh: '采购付款日',   labelEn: 'Purchase Pay Date', cluster: 'purchase', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'supplierInvoiceNumber',  labelZh: '供应商发票号', labelEn: 'Supplier Inv #',    cluster: 'purchase', type: 'text', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'supplierInvoiceDate',    labelZh: '供应商发票日', labelEn: 'Supplier Inv Date', cluster: 'purchase', type: 'date', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },
  { key: 'supplierInvoiceAmount',  labelZh: '供应商发票金额', labelEn: 'Supplier Inv Amt', cluster: 'purchase', type: 'currency', currencySide: 'purchase', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: false },

  // ============ Cluster: instructions — 特别说明 ============
  { key: 'specialInstructions', labelZh: '特别说明', labelEn: 'Special Instructions', cluster: 'instructions', type: 'longText', source: 'manual', shownInDetail: true, shownInImportPreview: false, shownInManualForm: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fields shown in the detail card, grouped by cluster, in display order. */
export function fieldsForDetail(): Array<{ cluster: OrderClusterMeta; fields: FieldMeta[] }> {
  return groupByCluster(ORDER_FIELDS.filter((f) => f.shownInDetail), 'detailOrder');
}

/** Fields shown in the manual entry modal, grouped by cluster. */
export function fieldsForManualForm(): Array<{ cluster: OrderClusterMeta; fields: FieldMeta[] }> {
  return groupByCluster(ORDER_FIELDS.filter((f) => f.shownInManualForm), 'manualOrder');
}

/** Fields shown in the import preview header. */
export function fieldsForImportPreview(): FieldMeta[] {
  return ORDER_FIELDS.filter((f) => f.shownInImportPreview);
}

/** Required keys for manual entry — used by `handleAddOrder` validation. */
export function requiredKeysForManual(): OrderFieldKey[] {
  return ORDER_FIELDS.filter((f) => f.shownInManualForm && f.required).map((f) => f.key);
}

export function fieldMetaByKey(key: OrderFieldKey | string): FieldMeta | undefined {
  return ORDER_FIELDS.find((field) => String(field.key) === String(key));
}

function groupByCluster(
  fields: ReadonlyArray<FieldMeta>,
  orderKey: 'detailOrder' | 'manualOrder',
): Array<{ cluster: OrderClusterMeta; fields: FieldMeta[] }> {
  const byId = new Map<OrderFieldCluster, FieldMeta[]>();
  for (const f of fields) {
    const list = byId.get(f.cluster) ?? [];
    list.push(f);
    byId.set(f.cluster, list);
  }
  return [...ORDER_CLUSTERS]
    .filter((c) => byId.has(c.id))
    .sort((a, b) => a[orderKey] - b[orderKey])
    .map((c) => ({ cluster: c, fields: byId.get(c.id)! }));
}

// ---------------------------------------------------------------------------
// Auto-fill: when a Relation FK is selected, auto-fill related fields
// ---------------------------------------------------------------------------

/**
 * Given a Relation that was just selected for an FK field (e.g. 'customer'),
 * return a partial Order patch that auto-fills all fields whose `autoFillFrom`
 * references that FK field.
 *
 * Special handling: arrays use the first non-empty value, and address fields
 * fall back through role-appropriate Relation address columns.
 */
export function computeAutoFillPatch(
  fkField: string,
  relation: Record<string, any>,
): Partial<Order> {
  const patch: Partial<Order> = {};
  for (const field of ORDER_FIELDS) {
    if (!field.autoFillFrom || field.autoFillFrom.fkField !== fkField) continue;
    for (const [relProp, orderKey] of Object.entries(field.autoFillFrom.mapping)) {
      let val = pickRelationValue(relation, relProp);
      if (typeof val === 'string' && val.trim()) {
        (patch as any)[orderKey] = val;
      }
    }
  }
  return patch;
}

function pickRelationValue(relation: Record<string, any>, relProp: string): string | undefined {
  const raw = relation[relProp];
  if (Array.isArray(raw)) {
    return raw.find((item) => typeof item === 'string' && item.trim()) || raw.find((item) => typeof item?.address === 'string' && item.address.trim())?.address;
  }
  if (typeof raw === 'string' && raw.trim()) return raw;

  if (relProp === 'officialAddress') {
    return relation.officialAddress
      || relation.billingAddress
      || relation.shippingAddress
      || relation.warehouseAddress
      || relation.shipToAddresses?.find((item: any) => item?.address)?.address;
  }
  if (relProp === 'factoryAddresses') {
    return relation.factoryAddresses?.find((item: string) => item?.trim())
      || relation.officialAddress
      || relation.shippingAddress
      || relation.warehouseAddress;
  }
  if (relProp === 'primaryContactName') {
    return relation.primaryContactName || relation.backupContacts?.find((item: any) => item?.name)?.name;
  }
  if (relProp === 'primaryContactPhone') {
    return relation.primaryContactPhone || relation.phone || relation.contactInfo || relation.backupContacts?.find((item: any) => item?.phone)?.phone;
  }
  return undefined;
}

/**
 * Resolve the currency string for a `currency` field, falling back to defaults.
 * Sales side defaults to USD, purchase side to CNY.
 */
export function resolveCurrency(order: Partial<Order> | null | undefined, side: 'sales' | 'purchase'): string {
  if (!order) return side === 'purchase' ? 'CNY' : 'USD';
  if (side === 'purchase') return order.purchaseCurrency || 'CNY';
  return order.salesCurrency || 'USD';
}

/**
 * Currency symbol for UI prefixes. Keep small — extend as new currencies appear.
 */
export function currencySymbol(code: string): string {
  switch (code.toUpperCase()) {
    case 'USD': return '$';
    case 'CNY':
    case 'RMB': return '¥';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    case 'HKD': return 'HK$';
    default: return code + ' ';
  }
}

// ---------------------------------------------------------------------------
// Runtime integrity guard
// ---------------------------------------------------------------------------
//
// TypeScript already protects us from typos via `key: OrderFieldKey`, but it
// cannot catch duplicate entries, dangling cluster references, or missing
// `enumOptions`/`currencySide` for fields that need them. This IIFE runs once
// on module load and throws loudly so the dev never ships a broken dictionary.
//
// In production builds the JS engine still pays the one-time cost (~O(n)
// where n = ORDER_FIELDS.length ≈ 60), which is negligible.
(function assertOrderFieldsIntegrity(): void {
  const seenKeys = new Set<string>();
  const knownClusters = new Set<OrderFieldCluster>(ORDER_CLUSTERS.map((c) => c.id));
  const errors: string[] = [];

  for (const f of ORDER_FIELDS) {
    if (seenKeys.has(f.key as string)) {
      errors.push(`duplicate field key "${String(f.key)}" in ORDER_FIELDS`);
    }
    seenKeys.add(f.key as string);

    if (!knownClusters.has(f.cluster)) {
      errors.push(`field "${String(f.key)}" references unknown cluster "${f.cluster}"`);
    }
    if (f.type === 'enum' && (!f.enumOptions || f.enumOptions.length === 0)) {
      errors.push(`field "${String(f.key)}" is type:'enum' but has no enumOptions`);
    }
    if (f.type === 'currency' && !f.currencySide) {
      errors.push(`field "${String(f.key)}" is type:'currency' but has no currencySide`);
    }
    if (f.required && !f.shownInManualForm) {
      errors.push(`field "${String(f.key)}" is required but not shown in the manual form — required validation would always fail silently`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[orderSchema] ORDER_FIELDS integrity check failed:\n  - ${errors.join('\n  - ')}`,
    );
  }
})();
