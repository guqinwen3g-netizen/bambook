/**
 * rolePermissionMatrix.ts — 服务器端使用的角色权限矩阵副本（Phase 0-01）
 *
 * ⚠️ 单一权威真源是：/lib/rolePermissionMatrix.ts（根目录下 lib 文件夹）。
 *    此文件是为了绕过 server/tsconfig.json 的 rootDir=./src 限制而做的快照副本，
 *    当修改 /lib/rolePermissionMatrix.ts 时 必须 同步更新此文件内容。
 *    否则：seed 脚本（用 workspace lib 真源）与 服务器守卫（此副本）矩阵不一致。
 *
 * 设计原则：
 *   - 所有权限字符串都在此文件定义为 TS 常量/枚举，绝不允许业务代码手写 'orders:write' 等字符串
 *   - 7 个系统内置角色（GAP-R11 已收口：Sales/SalesManager/Finance/Admin/QC/Logistics/SuperAdmin；
 *     FinanceManager 已删除收编——付款审批权上抬 SM/总领导，退税审批归 Finance，见其位移注释）
 *     的 默认模块权限位（R/W/D/A + 敏感字段 + 行级数据范围） 全部在此硬编码，
 *     DB 中的 Role/Permission/RolePermission 表运行时可以 UI 调整，
 *     但初始化 seed 和 代码级判断的 fallback 默认值 必须 从这里取。
 *   - 决策依据来源：PL-1A（贸易公司典型矩阵） + PL-2B（同部门互相可见，跨部门隔离）
 *     ＋ 10 处和推荐不一致的用户选择 已全部对齐。
 *
 * 服务器端本文件被两处消费：
 *   1. server/src/auth/permissionService.ts — 运行时 scope fallback + 行级范围 + 敏感字段遮罩
 *   2. server/src/auth/permissionGuard.ts   — 守卫中间件 fallback 判断
 *
 * (seed-rbac.ts 使用根目录 lib 真源而非此副本)
 */

import { View } from './_typesView';

// ═══════════════════════════════════════════════════════════════════
// 1. 系统内置角色（不可删除，isSystem=true，DB Role 表 seed 时对应 id）
// ═══════════════════════════════════════════════════════════════════

export const SYSTEM_ROLE_IDS = {
  SALES: 'role-sales',
  SALES_MANAGER: 'role-sales-manager',
  FINANCE: 'role-finance',
  ADMIN: 'role-admin',
  QC: 'role-qc',
  LOGISTICS: 'role-logistics',
  SUPER_ADMIN: 'role-super-admin',
} as const;

export type SystemRoleId = (typeof SYSTEM_ROLE_IDS)[keyof typeof SYSTEM_ROLE_IDS];

export const SYSTEM_ROLE_META: Record<SystemRoleId, { name: string; description: string; rank: number }> = {
  [SYSTEM_ROLE_IDS.SALES]: {
    name: '业务员',
    description: '业务部一线跟单/报价/开发；仅本人及同部门数据',
    rank: 1,
  },
  [SYSTEM_ROLE_IDS.SALES_MANAGER]: {
    name: '销售主管',
    description: '业务部小团队负责人；本团队变更审批权',
    rank: 2,
  },
  [SYSTEM_ROLE_IDS.FINANCE]: {
    name: '财务',
    description: '财务部会计/出纳；全公司财务数据可读写，业务域只读',
    rank: 2,
  },
  [SYSTEM_ROLE_IDS.ADMIN]: {
    name: '系统管理员',
    description: '普通管理员；用户/角色/权限/字典配置可改；无权审批财务流和查看佣金/利润',
    rank: 3,
  },
  [SYSTEM_ROLE_IDS.QC]: {
    name: 'QC',
    description: '质检专员；QC 疵点录入/验货任务执行，业务域只读',
    rank: 2,
  },
  [SYSTEM_ROLE_IDS.LOGISTICS]: {
    name: '后勤',
    description: '物流/单证专员；运单/装箱/报关单证管理，业务域只读',
    rank: 2,
  },
  [SYSTEM_ROLE_IDS.SUPER_ADMIN]: {
    name: '超级管理员',
    description: '最高权限；所有模块 R/W/D/A，权限配置，审计日志全可见，不可删除此角色账户',
    rank: 10,
  },
};

// ═══════════════════════════════════════════════════════════════════
// 2. 模块权限位 (R=读 W=写 D=删 A=审批) + 敏感字段可见位 (S)
// ═══════════════════════════════════════════════════════════════════

export type ModulePermissionBit = 'R' | 'W' | 'D' | 'A' | 'S';
/** 敏感字段可见 (S) 的细粒度：把模块内多个敏感字段拆成独立 scope 可分别授权 */
export type SensitiveFieldScope =
  | 'cost'        // 采购价/BOM成本/PO金额等采购侧成本
  | 'profit'      // 毛利/毛利率/利润率等利润数据
  | 'commission'  // 佣金率/佣金金额
  | 'salary'      // 薪资/HR薪酬
  | 'tax_base';   // 进项税/退税基数等税务底值
type PermissionBitsSet = Partial<Record<ModulePermissionBit, true>>;

// ═══════════════════════════════════════════════════════════════════
// 3. 权限 scope 字符串常量（和 Permission.scope DB 字段一致）
//    命名约定：<module-or-domain>:<action>
// ═══════════════════════════════════════════════════════════════════

export const PERMISSION_SCOPES = {
  // --- 经营总览域 ---
  'dashboard:read': '全景看板查看',
  'cockpit:read': '经营驾驶舱查看（含财务敏感KPI）',
  'reports:read': '报表中心查看与运行',
  'reports:write': '报表设计器/保存自定义报表',
  'reports:admin': '报表订阅推送/全员模板管理',
  'ai:chat': 'AI助手对话（含只读查询）',
  'ai:write:low': 'AI助手执行低风险写入（登记跟进/加标签）',
  'ai:write:medium': 'AI助手执行中风险写入（需确认）',
  'ai:write:high': 'AI助手执行高风险写入（需二次验证）',

  // --- 客户与市场域 ---
  'relations:read': '业务伙伴档案查看',
  'relations:write': '业务伙伴档案新增/编辑',
  'relations:delete': '业务伙伴档案删除（高危）',
  'relations:admin': '客户等级ABC/信用评级人工调整',
  'crm:read': 'CRM跟进记录查看',
  'crm:write': 'CRM跟进记录登记/编辑',
  'suppliers:read': '供应商档案查看',
  'suppliers:write': '供应商档案新增/编辑',
  'suppliers:admin': '供应商评级调整/暂停新单/解除',
  'seasons:read': '季节/季度看板查看',
  'seasons:write': '季节项目创建/编辑',
  'marketing:read': '营销活动与ROI查看',
  'marketing:write': '营销活动创建/编辑',
  'emails:read': '业务邮件查看',
  'emails:write': '邮件发送/草稿编辑',
  'emails:admin': '邮件账户绑定/全局分类规则配置',

  // --- 订单履约域 ---
  'orders:read': '订单管理查看',
  'orders:write': '订单创建/编辑（Draft/Confirmed阶段）',
  'orders:delete': '订单删除',
  'orders:approve:change_delivery': '订单变更-交期（≤7天由SM，>7天总监）审批',
  'orders:approve:change_qty': '订单变更-数量（±10%内SM，超总监）审批',
  'orders:approve:change_price': '订单变更-价格 双签（FinMan+SM）审批',
  'orders:approve:cancel': '订单取消 三签审批',
  'quotations:read': '报价单查看',
  'quotations:write': '报价单创建/编辑',
  'quotations:approve': '报价单审批（偏差block级）',
  'quotations:convert': '报价单转化为订单',
  'products:read': '产品数字档案查看',
  'products:write': '产品档案新增/编辑',
  'bom:read': 'BOM成本核算查看',
  'bom:write': 'BOM创建/编辑（Draft态）',
  'bom:admin': 'BOM版本状态变更（Active/Obsolete）+ 新增自定义计算模型',
  'production:read': '生产跟踪/阶段看板查看',
  'production:write': '生产阶段登记/QC疵点录入',
  'shipments:read': '运单与发货查看',
  'shipments:write': '运单创建/装箱/发货登记',
  'shipments:approve': '发货放行审批（大货最终放行）',
  'customs:read': '报关单证/外贸单证查看',
  'customs:write': '单证签发/修正案创建',
  'customs:admin': '单证模板/公司抬头签章配置',
  'qc:read': '质检工作台/疵点记录查看',
  'qc:write': 'QC疵点录入/QC结果登记',
  'aftersales:read': '售后客诉登记查看',
  'aftersales:write': '客诉登记/扣赔处理录入',
  'aftersales:approve': '客诉扣赔/折让审批（影响应收金额）',
  'procurement:read': '采购订单PO查看',
  'procurement:write': '采购订单PO创建/编辑',
  'procurement:approve': '采购订单PO审批+首单供应商+1级审批',

  // --- 财务与成本域 ---
  'finance:read': '财务看板/账龄/报表查看',
  'invoices:read': '应收应付发票查看',
  'invoices:write': '发票创建/签发（Commercial Invoice）',
  'invoices:reconcile': '发票核销（收付款分配到发票）',
  'invoices:approve:writeoff': '坏账核销/发票作废审批',
  'vouchers:read': '收付款凭证查看',
  'vouchers:write': '收付款凭证录入',
  'vouchers:approve:pay_lt5': '付款申请审批（≤5万RMB，财务主管）',
  'vouchers:approve:pay_gt5': '付款申请审批（>5万RMB，总监）',
  'vouchers:approve:pay_new_supplier': '首单付款+1级审批（总经理级）',
  'pricing:read': '定价与利润/退税率表查看',
  'pricing:write': '退税率表维护/定价记录创建',
  'pricing:admin': '默认利润率/客户等级调整%/佣金规则配置',
  'vat:read': '增值税发票/进项/销项查看',
  'vat:write': 'VAT发票登记/勾选认证',
  'tax:read': '出口退税申报查看',
  'tax:write': '退税申报录入',
  'tax:approve': '退税申报提交审批',
  'remit:read': '付汇水单/外汇业务查看',
  'remit:write': '付汇水单登记',
  'fx:lock': '汇率锁定（远期结售汇）登记/分配',
  'risk:read': '风险管理-预警/信用/合规/质量 总览查看',
  'risk:write': '预警确认/解决/信用评级录入',
  'risk:admin': '信用额度调整/合规豁免（高危，总监级）',

  // --- 平台域 ---
  'knowledge:read': '知识库/数据中心看板查看',
  'knowledge:write': '知识库文档创建/草稿',
  'knowledge:approve': '知识库文档发布审核',
  'knowledge:admin': '归档/恢复/全库ACL配置',
  'tools:execute': '业务工具（8个小工具）使用权限',
  'settings:account': '个人账户设置（密码/通知偏好/头像）',
  'settings:system:read': '系统设置查看（仅Admin可见内容）',
  'users:read': '后台管理-用户/角色/部门查看',
  'users:write': '后台管理-用户创建/编辑/角色分配',
  'users:admin': '用户删除/权限矩阵修改/SuperAdmin角色授予（仅SuperAdmin）',
  'audit:read': '审计日志查看',
  'audit:export': '审计日志导出CSV（仅FinanceMan+/Admin+）',
  'dictionary:write': '数据字典（枚举值真源）增删改',
  'hr:read': 'HR人事-员工档案/考勤/薪酬查看',
  'hr:write': 'HR人事-员工/入职/调动编辑',
  'hr:salary:read': '薪酬明细查看（极敏感，仅SuperAdmin + 指定HR）',
  'data:import': 'Excel批量导入（订单/产品/客户/供应商）',
  'data:export:full': '全量数据导出/迁移（高危，仅SuperAdmin）',

  // --- 敏感字段查看权限（细粒度，单独scope而不是简单模块S位）---
  'sensitive:cost': '敏感-成本/采购价/BOM成本 查看（S:cost）',
  'sensitive:profit': '敏感-毛利/毛利率/利润率 查看（S:profit）',
  'sensitive:commission': '敏感-佣金率/佣金金额 查看（S:commission）',
  'sensitive:salary': '敏感-员工薪酬明细 查看（S:salary）',
  'sensitive:tax_base': '敏感-进项税/退税计税底值 查看（S:tax_base）',

  // --- Phase 1 预分配（DR-007 审批组织归属 + Phase 2 全域模块 scope，避免并行代理抢改本文件）---
  'settings:moq:write': 'MOQ 阈值配置写入（设置后台）',
  'moq:line_override': 'MOQ 行级覆盖申请（订单行降级/调整）',
  'moq:capsule_exemption:write': 'MOQ Capsule 档豁免审批/写入',
  'order:change_request:create': '订单变更申请创建（交期/数量/价格）',
  'order:change_request:apply': '订单变更申请审批通过后的生效执行',
  'sample:early_production:write': '早期生产样登记/写入（DR-015）',
  'sample:shipment:write': '船样登记/写入（S/S）',
  'sample:color_batch:write': '打色批次登记/客户判定写入（REQ2-01 色差管理）',
  'sample:room:write': '样品间样卡登记/借出/归还/看样登记（REQ2-16）',
  'exception:dr013:create': 'DR-013 受控例外申请创建',
  'finance:payment_request:create': '付款申请创建',
  'finance:payment_request:approve': '付款申请审批',
  'credit:freeze:write': '客户信用冻结（高危）',
  'credit:thaw:write': '客户信用解冻（高危）',
  'order:internal_trade:write': '内部交易（内部面料结算价 DR-006）写入',
  'qc:fabric_chain:write': 'QC 面料链（DR-029）业务登记写入',
  'qc:garment_chain:write': 'QC 成衣链业务登记写入',
  'settings:automation:write': '自动化规则配置写入（后台管理）',
} as const satisfies Record<string, string>;

export type PermissionScope = keyof typeof PERMISSION_SCOPES;

// ═══════════════════════════════════════════════════════════════════
// 4. 模块 → 主权限 scope 映射（读/写/删/审批 各对应哪个scope）
//    View 枚举已经在 types.ts 有36个视图，这里把视图和主scope绑定
// ═══════════════════════════════════════════════════════════════════

export interface ViewPermissionScopes {
  read: PermissionScope;      // R
  write?: PermissionScope;    // W
  delete?: PermissionScope;   // D
  approve?: PermissionScope;  // A 主审批（具体子审批另有scope）
  sensitive?: Partial<Record<SensitiveFieldScope, PermissionScope>>;
}

export const VIEW_TO_MAIN_SCOPES: Record<View, ViewPermissionScopes> = {
  [View.Dashboard]:     { read: 'dashboard:read' },
  [View.Cockpit]:       { read: 'cockpit:read', sensitive: { cost: 'sensitive:cost', profit: 'sensitive:profit' } },
  [View.Assistant]:     { read: 'ai:chat' },
  [View.Reports]:       { read: 'reports:read', write: 'reports:write', approve: 'reports:admin' },
  [View.Relations]:     { read: 'relations:read', write: 'relations:write', delete: 'relations:delete', approve: 'relations:admin' },
  [View.CRM]:           { read: 'crm:read', write: 'crm:write' },
  [View.Suppliers]:     { read: 'suppliers:read', write: 'suppliers:write', approve: 'suppliers:admin' },
  [View.Seasons]:       { read: 'seasons:read', write: 'seasons:write' },
  [View.Marketing]:     { read: 'marketing:read', write: 'marketing:write' },
  [View.Emails]:        { read: 'emails:read', write: 'emails:write', approve: 'emails:admin' },
  [View.Products]:      { read: 'products:read', write: 'products:write' },
  [View.BOM]:           { read: 'bom:read', write: 'bom:write', approve: 'bom:admin' },
  [View.Orders]:        { read: 'orders:read', write: 'orders:write', delete: 'orders:delete' },
  [View.Quotations]:    { read: 'quotations:read', write: 'quotations:write', approve: 'quotations:approve' },
  [View.Procurement]:   { read: 'procurement:read', write: 'procurement:write', approve: 'procurement:approve' },
  [View.ProductionBoard]: { read: 'production:read', write: 'production:write' },
  [View.Shipments]:     { read: 'shipments:read', write: 'shipments:write', approve: 'shipments:approve' },
  [View.Customs]:       { read: 'customs:read', write: 'customs:write', approve: 'customs:admin' },
  [View.QcWorkbench]:   { read: 'qc:read', write: 'qc:write' },
  // 售后客诉暂挂在 Orders 下（没独立View），用 scope 直接控
  [View.Invoices]:      { read: 'invoices:read', write: 'invoices:write', approve: 'invoices:approve:writeoff' },
  [View.PaymentVouchers]:{ read: 'vouchers:read', write: 'vouchers:write' },
  [View.Pricing]:       { read: 'pricing:read', write: 'pricing:write', approve: 'pricing:admin',
                          sensitive: { cost: 'sensitive:cost', profit: 'sensitive:profit', commission: 'sensitive:commission', tax_base: 'sensitive:tax_base' } },
  [View.Risks]:         { read: 'risk:read', write: 'risk:write', approve: 'risk:admin' },
  // VAT/退税/付汇 暂时挂在FinanceManager/Invoices（没独立View）
  [View.DataCenter]:    { read: 'knowledge:read', write: 'knowledge:write', approve: 'knowledge:approve' },
  [View.BusinessTools]: { read: 'tools:execute' },
  [View.Development]:   { read: 'products:read', write: 'products:write' },
  [View.Inventory]:     { read: 'orders:read' },
  [View.DocumentCenter]:{ read: 'customs:read', write: 'customs:write' },
  [View.MES]:           { read: 'production:read' }, // MES搁置，但权限先定义
  [View.Settings]:      { read: 'settings:account' },
  [View.AccountSettings]: { read: 'settings:account' },
  [View.SystemSettings]:{ read: 'settings:system:read', write: 'dictionary:write', approve: 'users:admin' },
  [View.AdminPanel]:    { read: 'users:read', write: 'users:write', delete: 'audit:read' },
  [View.HR]:            { read: 'hr:read', write: 'hr:write',
                          sensitive: { salary: 'sensitive:salary' } },
  [View.UiLab]:         { read: 'dashboard:read' }, // dev-only 视图在modulePermissions.ts里另有限制
};

// ═══════════════════════════════════════════════════════════════════
// 5. 行级数据范围过滤 默认规则（PL-2B：同部门互相可见，跨部门隔离）
//    注意：SalesManager 和 Sales 同属一个部门范围，Finance/Admin/SuperAdmin 全公司
// ═══════════════════════════════════════════════════════════════════

export type DataScopeRule =
  | { kind: 'all'; write?: 'all' | 'department' | 'self' }                   // 全公司可见（v2.2 DR-042 §4.4：write 可独立收窄，缺省 = 'all'）
  | { kind: 'department'; own: boolean; includeDescendantDepartments?: boolean } // 仅本部门（默认跨部门隔离）
  | { kind: 'team' }                                                         // 仅本Team（预留更细粒度，目前按department够用）
  | { kind: 'self' };                                                        // 仅自己（ownerId=me，暂时不启用因为CM-2选了无唯一owner，以后可开）

/**
 * v2.2（DR-042 §4.4 读写分离）：解析规则的写侧 kind。
 * - { kind: 'all' } 缺省 write = 'all'（真全权角色：财务/QC/后勤/admin/超管）
 * - { kind: 'all', write: 'self' }：读全量、写本人维（sales 档案图书馆化口径）
 * - 其余 kind：写侧 = 读侧 kind（原语义）
 */
export function resolveWriteKind(rule: DataScopeRule): 'all' | 'department' | 'team' | 'self' {
  return rule.kind === 'all' ? (rule.write ?? 'all') : rule.kind;
}

export const DEFAULT_DATA_SCOPE_BY_ROLE: Record<
  SystemRoleId,
  /** 每个模块单独可以设，不设 = fallback 到 '*' 通配 */
  { '*': DataScopeRule } & Partial<Record<string, DataScopeRule>>
> = {
  // --- 业务员/销售主管：PL-2B 同部门互相可见，跨部门隔离 ---
  [SYSTEM_ROLE_IDS.SALES]: {
    '*': { kind: 'department', own: true, includeDescendantDepartments: false },
    // v2.2（DR-042 §5.1 L1 档案图书馆化）：读全公司（normal 档案全公司可查，
    // confidential 由服务层收窄为本人维），写本人维（跟进人）
    relations: { kind: 'all', write: 'self' },
    crm: { kind: 'all', write: 'self' },
    // 财务域：业务员只能看自己/同部门经手的订单关联的发票/凭证，不能看全公司
    invoices: { kind: 'department', own: true },
    vouchers: { kind: 'department', own: true },
    // HR：业务员只能看自己
    hr: { kind: 'self' },
  },
  [SYSTEM_ROLE_IDS.SALES_MANAGER]: {
    '*': { kind: 'department', own: true, includeDescendantDepartments: true }, // 主管可以看到子部门
    relations: { kind: 'department', own: true, includeDescendantDepartments: true },
    crm: { kind: 'department', own: true, includeDescendantDepartments: true },
    invoices: { kind: 'department', own: true, includeDescendantDepartments: true },
    vouchers: { kind: 'department', own: true, includeDescendantDepartments: true },
    hr: { kind: 'department', own: true }, // 主管看本部门员工基本信息，薪酬明细仍要单独敏感scope
  },
  // --- 财务：财务域全公司，业务域只读全公司 ---
  [SYSTEM_ROLE_IDS.FINANCE]: {
    '*': { kind: 'all' }, // 财务看所有模块全公司范围
    // 但 HR 的薪酬明细仍要敏感 salary scope 才能看
  },
  // --- 系统管理员：配置看全公司，业务/财务数据按需要给scope但默认行级all（方便配置）---
  [SYSTEM_ROLE_IDS.ADMIN]: {
    '*': { kind: 'all' },
  },
  // --- QC：QC 域可写，其余业务域只读（全公司）---
  [SYSTEM_ROLE_IDS.QC]: {
    '*': { kind: 'all' },
  },
  // --- 后勤：物流/单证域可写，其余业务域只读（全公司）---
  [SYSTEM_ROLE_IDS.LOGISTICS]: {
    '*': { kind: 'all' },
  },
  // --- 超级管理员：无条件all，所有scope全开 ---
  [SYSTEM_ROLE_IDS.SUPER_ADMIN]: {
    '*': { kind: 'all' },
  },
};

// ═══════════════════════════════════════════════════════════════════
// 6. 6 系统角色 × 权限 scope → true/false 默认矩阵
//    这是 seed 数据的唯一真源；True=拥有该scope，False/undefined=没有
// ═══════════════════════════════════════════════════════════════════

type RolePermissionMatrix = Partial<Record<PermissionScope, true>>;

const SALES_BASE: RolePermissionMatrix = {
  // 经营总览
  'dashboard:read': true,
  'cockpit:read': true, // 可以看驾驶舱（但成本/利润敏感scope没给=自动遮罩显示****）
  'reports:read': true,
  'reports:write': true,
  'ai:chat': true,
  'ai:write:low': true,    // AI-1选C：低风险写（登记跟进/加标签）无确认
  'ai:write:medium': true, // 中风险需要确认框的（前端UI再弹窗），后端有scope就允许执行（确认框是前端UX）
  // 客户市场
  'relations:read': true,
  'relations:write': true,
  'crm:read': true,
  'crm:write': true,
  'suppliers:read': true,
  'seasons:read': true,
  'seasons:write': true,
  'marketing:read': true,
  'emails:read': true,
  'emails:write': true,
  // 订单履约
  'orders:read': true,
  'orders:write': true,
  'quotations:read': true,
  'quotations:write': true,
  'quotations:convert': true,
  'products:read': true,
  'products:write': true,
  'bom:read': true,
  'production:read': true,
  'production:write': true, // QC/疵点业务员自己登
  'shipments:read': true,
  'shipments:write': true,
  'customs:read': true,
  'qc:read': true,
  'qc:write': true,
  'aftersales:read': true,
  'aftersales:write': true,
  'procurement:read': true,
  // 财务（业务员只读自己的应收/应付情况，不能登账）
  'finance:read': true,
  'invoices:read': true,
  'vouchers:read': true,
  'pricing:read': true,
  'risk:read': true,
  // 平台域
  'knowledge:read': true,
  'knowledge:write': true,
  'tools:execute': true,
  'settings:account': true,
  'data:import': true,
  // Phase 1 预分配：业务员申请侧 scope（DR-007 审批路由发起人）
  'moq:line_override': true,
  'order:change_request:create': true,
  'sample:early_production:write': true,
  'sample:shipment:write': true,
  'sample:color_batch:write': true,
  'sample:room:write': true,
  'exception:dr013:create': true,
  'finance:payment_request:create': true,
};

const SALES_MANAGER_BASE: RolePermissionMatrix = {
  ...SALES_BASE, // 继承业务员所有权限
  // 额外：变更审批（SM 级审批权）
  'orders:approve:change_delivery': true,
  'orders:approve:change_qty': true,
  'quotations:approve': true,
  'shipments:approve': true,
  // 客户/供应商评级
  'relations:admin': true,
  'suppliers:admin': true,
  // 报价转化已有，再给风险处理
  'risk:write': true,
  // 报表订阅推送管理
  'reports:admin': true,
  // 客诉处理审批
  'aftersales:approve': true,
  // 采购PO审批（DR-007 组织归属解析；首单自动上抬总领导）
  'procurement:approve': true,
  // GAP-R11 FinMan 位移：本团队小单付款审批（大单/跨团队自动上抬总领导）
  'vouchers:approve:pay_lt5': true,
  // GAP-R11 FinMan 位移：订单变更-价格 双签之一（另一签总领导）
  'orders:approve:change_price': true,
  // GAP-R11 FinMan 位移：BOM 版本/计算模型管理（与 QC 共享）
  'bom:admin': true,
  // GAP-R11 FinMan 位移：付款申请审批（DR-017 本团队档）
  'finance:payment_request:approve': true,
  // Phase 1 预分配：销售主管审批侧 scope（继承 SALES 申请侧；此处为 SM 独有增量）
  'moq:capsule_exemption:write': true,
  'order:change_request:apply': true,
  'qc:fabric_chain:write': true,
  'qc:garment_chain:write': true,
};

const FINANCE_BASE: RolePermissionMatrix = {
  // 经营总览：全部（含驾驶舱敏感数字可见scope）
  'dashboard:read': true,
  'cockpit:read': true,
  'reports:read': true,
  'reports:write': true,
  'reports:admin': true,
  'ai:chat': true,
  'ai:write:low': true,
  'ai:write:medium': true,
  // 敏感字段：财务可见成本/利润/税基/佣金（做账发薪必需；GAP-R11 FinMan 位移）
  'sensitive:cost': true,
  'sensitive:profit': true,
  'sensitive:tax_base': true,
  'sensitive:commission': true,
  // 客户市场：只读（不做编辑）
  'relations:read': true,
  'crm:read': true,
  'suppliers:read': true,
  'seasons:read': true,
  'marketing:read': true,
  'emails:read': true,
  // 订单履约：只读（不允许直接改订单/报价，走变更审批流程）
  'orders:read': true,
  'quotations:read': true,
  'products:read': true,
  'bom:read': true,
  'production:read': true,
  'shipments:read': true,
  'customs:read': true,
  'qc:read': true,
  'aftersales:read': true,
  'procurement:read': true,
  // 财务域：可写+核销
  'finance:read': true,
  'invoices:read': true,
  'invoices:write': true,
  'invoices:reconcile': true,
  'vouchers:read': true,
  'vouchers:write': true,
  'pricing:read': true,
  'pricing:write': true,
  'vat:read': true,
  'vat:write': true,
  'tax:read': true,
  'tax:write': true,
  // GAP-R11 FinMan 位移：退税申报审批 = 财务专业合规工作（不归业务审批链）
  'tax:approve': true,
  'remit:read': true,
  'remit:write': true,
  'fx:lock': true,
  'risk:read': true,
  'risk:write': true,
  // 平台域
  'knowledge:read': true,
  'knowledge:write': true,
  'tools:execute': true,
  'settings:account': true,
  'audit:read': true,  // 财务可以看审计日志
  'hr:read': true,     // HR基本信息可见（发薪对象等）
  // Phase 1 预分配：财务申请侧 scope
  'finance:payment_request:create': true,
  'exception:dr013:create': true,
};

const ADMIN_BASE: RolePermissionMatrix = {
  // 配置后台 + 用户管理
  'settings:system:read': true,
  'users:read': true,
  'users:write': true, // 但不能授予/撤销 SuperAdmin 角色（users:admin scope），要下面那个
  'dictionary:write': true,
  // 知识库审核/归档
  'knowledge:approve': true,
  'knowledge:admin': true,
  // 数据字典/BOM自定义插件添加（低风险配置项）
  'tools:execute': true,
  'settings:account': true,
  // 知识库/AI助手
  'knowledge:read': true,
  'knowledge:write': true,
  'ai:chat': true,
  'ai:write:low': true,
  'ai:write:medium': true,
  // 报表中心
  'reports:read': true,
  'reports:write': true,
  'reports:admin': true,
  // 审计日志查看（导出归总领导/SuperAdmin）
  'audit:read': true,
  // GAP-R11 FinMan 位移：总领导兜底审批档（大单付款/首单+1级/坏账核销/订单取消/价格双签另一签）
  'vouchers:approve:pay_gt5': true,
  'vouchers:approve:pay_new_supplier': true,
  'invoices:approve:writeoff': true,
  'orders:approve:cancel': true,
  // GAP-R11 FinMan 位移：风控总监级 + 定价管理员级 + 审计导出
  'risk:admin': true,
  'pricing:admin': true,
  'audit:export': true,
  // 看所有业务域只读（Admin要能排障，不能两眼一抹黑）
  'dashboard:read': true,
  'cockpit:read': true,
  'relations:read': true,
  'crm:read': true,
  'suppliers:read': true,
  'seasons:read': true,
  'emails:read': true,
  'orders:read': true,
  'quotations:read': true,
  'products:read': true,
  'bom:read': true,
  'production:read': true,
  'shipments:read': true,
  'customs:read': true,
  'qc:read': true,
  'aftersales:read': true,
  'procurement:read': true,
  'finance:read': true,
  'invoices:read': true,
  'vouchers:read': true,
  'pricing:read': true,
  'vat:read': true,
  'tax:read': true,
  'remit:read': true,
  'risk:read': true,
  // HR：管理员看基本信息，看不了薪酬
  'hr:read': true,
  // 但是！Admin 不给敏感scope（成本/利润/佣金/薪酬/税基全不给）
  // 避免Admin权限过高看不该看的财务机密，敏感scope保留给Finance及以上
  // Phase 1 预分配：Admin 获得全部 15 个新 scope（配置/排障兜底；SUPER_ADMIN 代码级全放行）
  'settings:moq:write': true,
  'moq:line_override': true,
  'moq:capsule_exemption:write': true,
  'order:change_request:create': true,
  'order:change_request:apply': true,
  'sample:early_production:write': true,
  'sample:shipment:write': true,
  'sample:color_batch:write': true,
  'sample:room:write': true,
  'exception:dr013:create': true,
  'finance:payment_request:create': true,
  'finance:payment_request:approve': true,
  'credit:freeze:write': true,
  'credit:thaw:write': true,
  'order:internal_trade:write': true,
  'qc:fabric_chain:write': true,
  'qc:garment_chain:write': true,
  'settings:automation:write': true,
};

const QC_BASE: RolePermissionMatrix = {
  // 经营总览
  'dashboard:read': true,
  'reports:read': true,
  'ai:chat': true,
  // 订单履约（只读）
  'orders:read': true,
  'products:read': true,
  'production:read': true,
  'shipments:read': true,
  'customs:read': true,
  // 财务 KPI 层只读（敏感字段遮罩；W-C 视图门禁对齐文档 §6.4）
  'finance:read': true,
  // QC 域（可写）
  'qc:read': true,
  'qc:write': true,
  // BOM 版本/工艺模型管理（与 SM 共享；GAP-R11 FinMan 位移）
  'bom:admin': true,
  // 平台域
  'knowledge:read': true,
  'tools:execute': true,
  'settings:account': true,
};

const LOGISTICS_BASE: RolePermissionMatrix = {
  // 经营总览
  'dashboard:read': true,
  'reports:read': true,
  'ai:chat': true,
  // 订单履约（只读）
  'orders:read': true,
  'products:read': true,
  'production:read': true,
  // 物流/单证域（可写）
  'shipments:read': true,
  'shipments:write': true,
  'customs:read': true,
  'customs:write': true,
  // 单证模板/公司签章配置（GAP-R11 FinMan 位移）
  'customs:admin': true,
  // 财务只读（KPI/商业发票做报关/水单核对；W-C 视图门禁对齐文档 §6.5）
  'finance:read': true,
  'invoices:read': true,
  'vouchers:read': true,
  // 平台域
  'knowledge:read': true,
  'tools:execute': true,
  'settings:account': true,
};

const SUPER_ADMIN_BASE: RolePermissionMatrix = {};
// 超级管理员：ALL SCOPES = TRUE （运行时用 `role === SUPER_ADMIN` 直接放行，不查表）
// 这里不展开所有scope，代码级判断时：
//   if roleId === SYSTEM_ROLE_IDS.SUPER_ADMIN => return true for any scope

export const DEFAULT_ROLE_PERMISSION_MATRIX: Record<SystemRoleId, RolePermissionMatrix> = {
  [SYSTEM_ROLE_IDS.SALES]: SALES_BASE,
  [SYSTEM_ROLE_IDS.SALES_MANAGER]: SALES_MANAGER_BASE,
  [SYSTEM_ROLE_IDS.FINANCE]: FINANCE_BASE,
  [SYSTEM_ROLE_IDS.ADMIN]: ADMIN_BASE,
  [SYSTEM_ROLE_IDS.QC]: QC_BASE,
  [SYSTEM_ROLE_IDS.LOGISTICS]: LOGISTICS_BASE,
  [SYSTEM_ROLE_IDS.SUPER_ADMIN]: SUPER_ADMIN_BASE,
};

// ═══════════════════════════════════════════════════════════════════
// 7. 前端/守卫辅助工具函数（纯函数，不依赖DB，fallback判断用）
// ═══════════════════════════════════════════════════════════════════

/** 判断一个系统角色是否拥有某scope（先看DB拉取的用户权限集，没有或为空时fallback到默认矩阵） */
export function hasPermission(
  roleId: string | string[] | null | undefined,
  scope: PermissionScope,
  runtimeUserScopes?: Set<string> | null,
): boolean {
  // 运行时给的集合优先（服务端/前端拉取后放入 Set 最快）
  if (runtimeUserScopes && runtimeUserScopes.size > 0) {
    if (runtimeUserScopes.has(scope)) return true;
  }
  // 角色数组（多角色用户）
  const roles = Array.isArray(roleId) ? roleId : roleId ? [roleId] : [];
  for (const r of roles) {
    if (r === SYSTEM_ROLE_IDS.SUPER_ADMIN) return true;
    const matrix = DEFAULT_ROLE_PERMISSION_MATRIX[r as SystemRoleId];
    if (matrix && matrix[scope] === true) return true;
  }
  return false;
}

/** 某个敏感字段scope是否可见（和普通scope走相同权限，只是语义单独分组） */
export function canViewSensitive(
  roleId: string | string[] | null | undefined,
  field: SensitiveFieldScope,
  runtimeUserScopes?: Set<string> | null,
): boolean {
  const scope = `sensitive:${field}` as PermissionScope;
  return hasPermission(roleId, scope, runtimeUserScopes);
}

/** 根据模块获取默认行级范围过滤规则（代码级fallback） */
export function getDataScopeRule(
  roleId: string | null | undefined,
  moduleOrView?: string,
): DataScopeRule {
  if (!roleId) return { kind: 'self' }; // 无角色=仅自己
  if (roleId === SYSTEM_ROLE_IDS.SUPER_ADMIN) return { kind: 'all' };
  const roleRules = DEFAULT_DATA_SCOPE_BY_ROLE[roleId as SystemRoleId];
  if (!roleRules) return { kind: 'self' };
  if (moduleOrView && moduleOrView in roleRules) {
    return (roleRules as Record<string, DataScopeRule>)[moduleOrView];
  }
  return roleRules['*'];
}

/** 给指定角色返回全部默认 scope 字符串数组（seed 用） */
export function getDefaultScopeListForRole(roleId: SystemRoleId): string[] {
  if (roleId === SYSTEM_ROLE_IDS.SUPER_ADMIN) {
    // SuperAdmin 在守卫里特判，DB 里 seed 也给他 ALL SCOPES 防止有bug
    return Object.keys(PERMISSION_SCOPES);
  }
  const matrix = DEFAULT_ROLE_PERMISSION_MATRIX[roleId];
  return Object.entries(matrix)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}
