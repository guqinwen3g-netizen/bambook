import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Contact,
  CreditCard,
  Database,
  Factory,
  FileCheck,
  Files,
  FileSignature,
  FileText,
  Gauge,
  LayoutDashboard,
  Library,
  Mail,
  PackageCheck,
  Boxes,
  Calculator,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  UserCog,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { View } from '../types';
import {
  getViewPermission as getSharedViewPermission,
  getViewPermissionDefinition,
  isDevOnlyView as isSharedDevOnlyView,
  type ViewPermissionPolicy,
} from '../lib/modulePermissions';

export type MainCompilerSurface =
  | 'sidebar'
  | 'dashboard'
  | 'relations'
  | 'products'
  | 'settings'
  | 'assistant'
  | 'development'
  | 'dataCenter'
  | 'orders'
  | 'quotations'
  | 'procurement'
  | 'inventory'
  | 'bom'
  | 'crm'
  | 'mes'
  | 'customs'
  | 'invoices'
  | 'paymentVouchers'
  | 'shipments'
  | 'emails'
  | 'businessTools'
  | 'adminPanel'
  | 'hr';

export type ModuleCompilerProvenance = 'accepted' | 'provisional' | 'legacy-only';

export type ModuleRuntimeSurface =
  | 'desktop'
  | 'electron'
  | 'mobile'
  | 'ui-lab'
  | 'ui-lab-2'
  | 'server'
  | 'ops';

export type ModulePermissionPolicy = ViewPermissionPolicy;

/**
 * 阶段 IA（信息架构）导航分组 — PRD 第二十四章权威定义。
 * order 组段分配（防 49.x 补丁式插值回退）：
 *   overview 10-19 / customer 20-39 / fulfillment 40-69 / finance 70-89 / platform 90-119
 */
export type BambookNavGroup = 'overview' | 'customer' | 'fulfillment' | 'finance' | 'platform';

export const BAMBOOK_NAV_GROUP_ORDER: Record<BambookNavGroup, number> = {
  overview: 10,
  customer: 20,
  fulfillment: 40,
  finance: 70,
  platform: 90,
};

export const BAMBOOK_NAV_GROUP_LABELS: Record<BambookNavGroup, string> = {
  overview: '经营总览',
  customer: '客户与市场',
  fulfillment: '订单履约',
  finance: '财务与成本',
  platform: '平台',
};

export type MainCompilerSurfaceConfig = {
  queryKey: string;
  storageKey: string;
};

export type ModuleSubView = {
  id: string;
  label: string;
  description?: string;
  view?: View;
  localStateKey?: string;
};

export type BambookModuleDefinition = {
  id: string;
  view: View;
  productLabel: string;
  internalName: string;
  icon: LucideIcon;
  nav: {
    primary: boolean;
    adminOnly?: boolean;
    order: number;
    group: BambookNavGroup;
  };
  permissions: {
    policy: ModulePermissionPolicy;
    required?: string;
    roles?: readonly string[];
  };
  compiler?: {
    surface: MainCompilerSurface;
    queryKey: string;
    storageKey: string;
    provenance: ModuleCompilerProvenance;
  };
  runtime: {
    surfaces: readonly ModuleRuntimeSurface[];
    rootScope?: string;
  };
  entry: {
    current: string;
    compiled?: string;
    fallback?: string;
  };
  subViews?: readonly ModuleSubView[];
  cleanup?: {
    namingDebt?: string;
    migrationNotes?: readonly string[];
  };
};

export const BAMBOOK_MAIN_COMPILER_SURFACES: readonly MainCompilerSurface[] = [
  'sidebar',
  'dashboard',
  'relations',
  'products',
  'settings',
  'assistant',
  'development',
  'dataCenter',
  'orders',
  'quotations',
  'procurement',
  'inventory',
  'bom',
  'crm',
  'mes',
  'customs',
  'invoices',
  'paymentVouchers',
  'shipments',
  'emails',
  'businessTools',
  'adminPanel',
  'hr',
];

export const BAMBOOK_MAIN_COMPILER_SURFACE_CONFIGS: Record<MainCompilerSurface, MainCompilerSurfaceConfig> = {
  sidebar: {
    queryKey: 'sidebarCompiler',
    storageKey: 'bambook_sidebar_compiler_enabled',
  },
  dashboard: {
    queryKey: 'dashboardCompiler',
    storageKey: 'bambook_dashboard_compiler_enabled',
  },
  relations: {
    queryKey: 'relationsCompiler',
    storageKey: 'bambook_relations_compiler_enabled',
  },
  products: {
    queryKey: 'productsCompiler',
    storageKey: 'bambook_products_compiler_enabled',
  },
  settings: {
    queryKey: 'settingsCompiler',
    storageKey: 'bambook_settings_compiler_enabled',
  },
  assistant: {
    queryKey: 'assistantCompiler',
    storageKey: 'bambook_assistant_compiler_enabled',
  },
  development: {
    queryKey: 'developmentCompiler',
    storageKey: 'bambook_development_compiler_enabled',
  },
  dataCenter: {
    queryKey: 'dataCenterCompiler',
    storageKey: 'bambook_data_center_compiler_enabled',
  },
  orders: {
    queryKey: 'ordersCompiler',
    storageKey: 'bambook_orders_compiler_enabled',
  },
  quotations: {
    queryKey: 'quotationsCompiler',
    storageKey: 'bambook_quotations_compiler_enabled',
  },
  procurement: {
    queryKey: 'procurementCompiler',
    storageKey: 'bambook_procurement_compiler_enabled',
  },
  inventory: {
    queryKey: 'inventoryCompiler',
    storageKey: 'bambook_inventory_compiler_enabled',
  },
  bom: {
    queryKey: 'bomCompiler',
    storageKey: 'bambook_bom_compiler_enabled',
  },
  crm: {
    queryKey: 'crmCompiler',
    storageKey: 'bambook_crm_compiler_enabled',
  },
  mes: {
    queryKey: 'mesCompiler',
    storageKey: 'bambook_mes_compiler_enabled',
  },
  customs: {
    queryKey: 'customsCompiler',
    storageKey: 'bambook_customs_compiler_enabled',
  },
  invoices: {
    queryKey: 'invoicesCompiler',
    storageKey: 'bambook_invoices_compiler_enabled',
  },
  paymentVouchers: {
    queryKey: 'paymentVouchersCompiler',
    storageKey: 'bambook_payment_vouchers_compiler_enabled',
  },
  shipments: {
    queryKey: 'shipmentsCompiler',
    storageKey: 'bambook_shipments_compiler_enabled',
  },
  emails: {
    queryKey: 'emailsCompiler',
    storageKey: 'bambook_emails_compiler_enabled',
  },
  businessTools: {
    queryKey: 'businessToolsCompiler',
    storageKey: 'bambook_business_tools_compiler_enabled',
  },
  adminPanel: {
    queryKey: 'adminPanelCompiler',
    storageKey: 'bambook_admin_panel_compiler_enabled',
  },
  hr: {
    queryKey: 'hrCompiler',
    storageKey: 'bambook_hr_compiler_enabled',
  },
};

const compiler = (
  surface: MainCompilerSurface,
  provenance: ModuleCompilerProvenance,
): NonNullable<BambookModuleDefinition['compiler']> => ({
  surface,
  ...BAMBOOK_MAIN_COMPILER_SURFACE_CONFIGS[surface],
  provenance,
});

const desktopRuntime = {
  surfaces: ['desktop', 'electron'] as const,
  rootScope: '.bambook-os-root',
};

export const BAMBOOK_MODULES: readonly BambookModuleDefinition[] = [
  {
    id: 'dashboard',
    view: View.Dashboard,
    productLabel: '全景看板',
    internalName: 'Dashboard',
    icon: LayoutDashboard,
    nav: { primary: true, order: 10, group: 'overview' },
    permissions: getViewPermissionDefinition(View.Dashboard),
    compiler: compiler('dashboard', 'accepted'),
    runtime: desktopRuntime,
    entry: {
      current: 'CompiledDashboardPage / Dashboard',
      compiled: 'components/ui/osCompiler/compiledDashboardTemplates.tsx',
      fallback: 'components/Dashboard.tsx',
    },
  },
  {
    id: 'cockpit',
    view: View.Cockpit,
    productLabel: '经营驾驶舱',
    internalName: 'Cockpit',
    icon: Gauge,
    nav: { primary: true, order: 12, group: 'overview' },
    permissions: getViewPermissionDefinition(View.Cockpit),
    runtime: desktopRuntime,
    entry: { current: 'components/CockpitManager.tsx' },
  },
  {
    id: 'assistant',
    view: View.Assistant,
    productLabel: 'AI 助手',
    internalName: 'Assistant',
    icon: Sparkles,
    nav: { primary: true, order: 90, group: 'platform' },
    permissions: getViewPermissionDefinition(View.Assistant),
    compiler: compiler('assistant', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/Assistant.tsx' },
  },
  {
    id: 'relations',
    view: View.Relations,
    productLabel: '关系智库',
    internalName: 'Relations',
    icon: Users,
    nav: { primary: true, order: 20, group: 'customer' },
    permissions: getViewPermissionDefinition(View.Relations),
    compiler: compiler('relations', 'accepted'),
    runtime: desktopRuntime,
    entry: {
      current: 'CompiledRelationsPage / RelationsManager',
      compiled: 'components/ui/osCompiler/compiledRelationsTemplates.tsx',
      fallback: 'components/RelationsManager.tsx',
    },
  },
  {
    id: 'products',
    view: View.Products,
    productLabel: '数字档案',
    internalName: 'Products',
    icon: Library,
    nav: { primary: true, order: 40, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Products),
    compiler: compiler('products', 'accepted'),
    runtime: desktopRuntime,
    entry: {
      current: 'CompiledProductsPage / ProductsManager',
      compiled: 'components/ui/osCompiler/compiledProductsTemplates.tsx',
      fallback: 'components/ProductsManager.tsx',
    },
    subViews: [
      { id: 'module-settings', label: '数字档案设置', localStateKey: 'isProductModuleSettingsWorkspaceOpen' },
    ],
  },
  {
    id: 'orders',
    view: View.Orders,
    productLabel: '生产管理',
    internalName: 'Orders',
    icon: Factory,
    nav: { primary: true, order: 46, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Orders),
    compiler: compiler('orders', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/OrderManager.tsx / components/GarmentOrders.tsx' },
    subViews: [
      { id: 'fabric-orders', label: '面料订单', localStateKey: 'orderType' },
      { id: 'garment-orders', label: '成衣订单', localStateKey: 'orderType' },
    ],
  },
  {
    id: 'quotations',
    view: View.Quotations,
    productLabel: '报价管理',
    internalName: 'Quotations',
    icon: FileSignature,
    nav: { primary: true, order: 44, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Quotations),
    compiler: compiler('quotations', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/QuotationManager.tsx' },
  },
  {
    id: 'procurement',
    view: View.Procurement,
    productLabel: '采购管理',
    internalName: 'Procurement',
    icon: PackageCheck,
    nav: { primary: true, order: 48, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Procurement),
    compiler: compiler('procurement', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/ProcurementManager.tsx' },
  },
  {
    id: 'inventory',
    view: View.Inventory,
    productLabel: '库存管理',
    internalName: 'Inventory',
    icon: Boxes,
    nav: { primary: true, order: 50, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Inventory),
    compiler: compiler('inventory', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/InventoryManager.tsx' },
  },
  {
    id: 'bom',
    view: View.BOM,
    productLabel: 'BOM 成本核算',
    internalName: 'BOM',
    icon: Calculator,
    nav: { primary: true, order: 74, group: 'finance' },
    permissions: getViewPermissionDefinition(View.BOM),
    compiler: compiler('bom', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/BomManager.tsx' },
  },
  {
    id: 'crm',
    view: View.CRM,
    productLabel: '客户关系管理',
    internalName: 'CRM',
    icon: Contact,
    nav: { primary: true, order: 22, group: 'customer' },
    permissions: getViewPermissionDefinition(View.CRM),
    compiler: compiler('crm', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/CrmManager.tsx' },
  },
  {
    id: 'suppliers',
    view: View.Suppliers,
    productLabel: '供应商管理',
    internalName: 'Suppliers',
    icon: Building2,
    nav: { primary: true, order: 24, group: 'customer' },
    permissions: getViewPermissionDefinition(View.Suppliers),
    runtime: desktopRuntime,
    entry: { current: 'components/SuppliersManager.tsx' },
  },
  {
    id: 'seasons',
    view: View.Seasons,
    productLabel: '季节性与趋势',
    internalName: 'Seasons',
    icon: CalendarRange,
    nav: { primary: true, order: 28, group: 'customer' },
    permissions: getViewPermissionDefinition(View.Seasons),
    runtime: desktopRuntime,
    entry: { current: 'components/SeasonsManager.tsx' },
  },
  {
    id: 'risks',
    view: View.Risks,
    productLabel: '风险管理与合规',
    internalName: 'Risks',
    icon: ShieldAlert,
    nav: { primary: true, order: 76, group: 'finance' },
    permissions: getViewPermissionDefinition(View.Risks),
    runtime: desktopRuntime,
    entry: { current: 'components/RisksManager.tsx' },
  },
  {
    id: 'qc-workbench',
    view: View.QcWorkbench,
    productLabel: 'QC 工作台',
    internalName: 'QcWorkbench',
    icon: ClipboardCheck,
    nav: { primary: true, order: 52, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.QcWorkbench),
    runtime: desktopRuntime,
    entry: { current: 'components/QcWorkbenchManager.tsx' },
    subViews: [
      { id: 'assignments', label: '验货任务', localStateKey: 'qcTab' },
      { id: 'locations', label: '驻地管理', localStateKey: 'qcTab' },
      { id: 'business-lines', label: '业务线配置', localStateKey: 'qcTab' },
    ],
  },
  {
    id: 'pricing',
    view: View.Pricing,
    productLabel: '定价与利润',
    internalName: 'Pricing',
    icon: TrendingUp,
    nav: { primary: true, order: 72, group: 'finance' },
    permissions: getViewPermissionDefinition(View.Pricing),
    runtime: desktopRuntime,
    entry: { current: 'components/PricingManager.tsx' },
    subViews: [
      { id: 'calculator', label: '定价计算器', localStateKey: 'pricingTab' },
      { id: 'profit-sheets', label: '利润表', localStateKey: 'pricingTab' },
      { id: 'tax-rates', label: '退税率', localStateKey: 'pricingTab' },
      { id: 'price-history', label: '价格历史', localStateKey: 'pricingTab' },
      { id: 'commission-rules', label: '佣金规则', localStateKey: 'pricingTab' },
    ],
  },
  {
    id: 'marketing',
    view: View.Marketing,
    productLabel: '营销推广',
    internalName: 'Marketing',
    icon: BookOpen,
    nav: { primary: true, order: 30, group: 'customer' },
    permissions: getViewPermissionDefinition(View.Marketing),
    runtime: desktopRuntime,
    entry: { current: 'components/MarketingManager.tsx' },
    subViews: [
      { id: 'lookbooks', label: '电子画册', localStateKey: 'marketingTab' },
      { id: 'fabric-recommend', label: '面料推荐', localStateKey: 'marketingTab' },
    ],
  },
  {
    id: 'mes',
    view: View.MES,
    productLabel: '生产执行 MES',
    internalName: 'MES',
    icon: Cog,
    // 业务边界决策（2026-08-07）：工厂端加工执行（工位/排产/工时/计件）不是贸易公司
    // 的必要工作流，降级为可选模块 —— 不进主导航，经「业务工具」页进入；外协加工
    // （OutsourcingOrder）属贸易侧能力，仍由该模块承载。后续若接入合作/自有工厂
    // 数据可重新评估。
    nav: { primary: false, order: 97, group: 'platform' },
    permissions: getViewPermissionDefinition(View.MES),
    compiler: compiler('mes', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/MesManager.tsx' },
  },
  {
    id: 'customs',
    view: View.Customs,
    productLabel: '外贸与报关',
    internalName: 'Customs',
    icon: FileCheck,
    nav: { primary: true, order: 56, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Customs),
    compiler: compiler('customs', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/CustomsManager.tsx' },
  },
  {
    id: 'document-center',
    view: View.DocumentCenter,
    productLabel: '单据中心',
    internalName: 'DocumentCenter',
    icon: Files,
    nav: { primary: true, order: 57, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.DocumentCenter),
    runtime: desktopRuntime,
    entry: { current: 'components/DocumentCenter.tsx' },
  },
  {
    id: 'invoices',
    view: View.Invoices,
    productLabel: '发票管理',
    internalName: 'Invoices',
    icon: FileText,
    nav: { primary: false, order: 71, group: 'finance' },
    permissions: getViewPermissionDefinition(View.Invoices),
    compiler: compiler('invoices', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/FinanceManager.tsx' },
  },
  {
    id: 'payment-vouchers',
    view: View.PaymentVouchers,
    productLabel: '财务管理',
    internalName: 'PaymentVouchers',
    icon: CreditCard,
    nav: { primary: true, order: 70, group: 'finance' },
    permissions: getViewPermissionDefinition(View.PaymentVouchers),
    compiler: compiler('paymentVouchers', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/FinanceManager.tsx' },
  },
  {
    id: 'reports',
    view: View.Reports,
    productLabel: '报表中心',
    internalName: 'Reports',
    icon: BarChart3,
    nav: { primary: true, order: 14, group: 'overview' },
    permissions: getViewPermissionDefinition(View.Reports),
    runtime: desktopRuntime,
    entry: { current: 'components/ReportCenter.tsx' },
  },
  {
    id: 'shipments',
    view: View.Shipments,
    productLabel: '货运管理',
    internalName: 'Shipments',
    icon: Truck,
    nav: { primary: true, order: 54, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Shipments),
    compiler: compiler('shipments', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/ShipmentManager.tsx' },
  },
  {
    id: 'development',
    view: View.Development,
    productLabel: '开发管理',
    internalName: 'Development',
    icon: ClipboardList,
    nav: { primary: true, order: 42, group: 'fulfillment' },
    permissions: getViewPermissionDefinition(View.Development),
    compiler: compiler('development', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/DevelopmentManager.tsx' },
  },
  {
    id: 'emails',
    view: View.Emails,
    productLabel: '智能邮箱',
    internalName: 'Emails',
    icon: Mail,
    nav: { primary: true, order: 26, group: 'customer' },
    permissions: getViewPermissionDefinition(View.Emails),
    compiler: compiler('emails', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/EmailManager.tsx' },
  },
  {
    id: 'data-center',
    view: View.DataCenter,
    productLabel: '数据中心',
    internalName: 'DataCenter',
    icon: Database,
    nav: { primary: true, order: 92, group: 'platform' },
    permissions: getViewPermissionDefinition(View.DataCenter),
    compiler: compiler('dataCenter', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/DataCenter.tsx' },
  },
  {
    id: 'settings',
    view: View.Settings,
    productLabel: '设置',
    internalName: 'Settings',
    icon: Shield,
    nav: { primary: false, order: 118, group: 'platform' },
    permissions: getViewPermissionDefinition(View.Settings),
    compiler: compiler('settings', 'accepted'),
    runtime: desktopRuntime,
    entry: {
      current: 'CompiledSettingsPage / Settings',
      compiled: 'components/ui/osCompiler/compiledSettingsTemplates.tsx',
      fallback: 'components/Settings.tsx',
    },
    subViews: [
      { id: 'account', label: '账号设置', view: View.AccountSettings },
      { id: 'system', label: '系统设置', view: View.SystemSettings },
    ],
  },
  {
    id: 'business-tools',
    view: View.BusinessTools,
    productLabel: '业务工具',
    internalName: 'BusinessTools',
    icon: Wrench,
    nav: { primary: true, order: 96, group: 'platform' },
    permissions: getViewPermissionDefinition(View.BusinessTools),
    compiler: compiler('businessTools', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/BusinessTools.tsx' },
  },
  {
    id: 'admin',
    view: View.AdminPanel,
    productLabel: '管理后台',
    internalName: 'AdminPanel',
    icon: Shield,
    nav: { primary: true, adminOnly: true, order: 110, group: 'platform' },
    permissions: getViewPermissionDefinition(View.AdminPanel),
    compiler: compiler('adminPanel', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/AdminPanel.tsx' },
    cleanup: {
      migrationNotes: ['Navigation also gates this module by owner/admin role; render permission uses users:read.'],
    },
  },
  {
    id: 'hr',
    view: View.HR,
    productLabel: '人事管理',
    internalName: 'HR',
    icon: UserCog,
    nav: { primary: true, order: 94, group: 'platform' },
    permissions: getViewPermissionDefinition(View.HR),
    compiler: compiler('hr', 'provisional'),
    runtime: desktopRuntime,
    entry: { current: 'components/HRManager.tsx' },
    subViews: [
      { id: 'personnel', label: '人员概览', localStateKey: 'hrTab' },
      { id: 'teams', label: '团队管理', localStateKey: 'hrTab' },
      { id: 'projects', label: '项目管理', localStateKey: 'hrTab' },
      { id: 'assignments', label: '工作分配', localStateKey: 'hrTab' },
    ],
  },
];

const modulesByView = new Map<View, BambookModuleDefinition>();

for (const moduleDefinition of BAMBOOK_MODULES) {
  modulesByView.set(moduleDefinition.view, moduleDefinition);
  for (const subView of moduleDefinition.subViews ?? []) {
    if (subView.view) modulesByView.set(subView.view, moduleDefinition);
  }
}

export function getModuleByView(view: View): BambookModuleDefinition | undefined {
  return modulesByView.get(view);
}

export function getPrimaryNavigationModules(options: {
  isAdmin: boolean;
  canAccessView: (view: View) => boolean;
  allowedViews?: readonly View[];
}): BambookModuleDefinition[] {
  const allowedViewSet = options.allowedViews ? new Set<View>(options.allowedViews) : null;
  return BAMBOOK_MODULES
    .filter(moduleDefinition => moduleDefinition.nav.primary)
    .filter(moduleDefinition => !moduleDefinition.nav.adminOnly || options.isAdmin)
    .filter(moduleDefinition => options.canAccessView(moduleDefinition.view))
    .filter(moduleDefinition => !allowedViewSet || allowedViewSet.has(moduleDefinition.view))
    .slice()
    .sort((a, b) => a.nav.order - b.nav.order);
}

export type PrimaryNavigationSection = {
  group: BambookNavGroup;
  label: string;
  modules: BambookModuleDefinition[];
};

/**
 * 阶段 IA：把已排序的一级导航模块按 nav.group 切段（组序 = BAMBOOK_NAV_GROUP_ORDER）。
 * 仅侧栏展开态使用；CommandPalette 等扁平消费方继续用 getPrimaryNavigationModules。
 */
export function groupPrimaryNavigationModules(
  modules: readonly BambookModuleDefinition[],
): PrimaryNavigationSection[] {
  const byGroup = new Map<BambookNavGroup, BambookModuleDefinition[]>();
  for (const moduleDefinition of modules) {
    const list = byGroup.get(moduleDefinition.nav.group);
    if (list) list.push(moduleDefinition);
    else byGroup.set(moduleDefinition.nav.group, [moduleDefinition]);
  }
  return (Object.keys(BAMBOOK_NAV_GROUP_ORDER) as BambookNavGroup[])
    .sort((a, b) => BAMBOOK_NAV_GROUP_ORDER[a] - BAMBOOK_NAV_GROUP_ORDER[b])
    .filter(group => byGroup.has(group))
    .map(group => ({
      group,
      label: BAMBOOK_NAV_GROUP_LABELS[group],
      modules: byGroup.get(group) as BambookModuleDefinition[],
    }));
}

export function getCompilerSurfaceForView(view: View): MainCompilerSurface | undefined {
  return getModuleByView(view)?.compiler?.surface;
}

export function getCompilerSurfaceConfig(surface: MainCompilerSurface): MainCompilerSurfaceConfig {
  return BAMBOOK_MAIN_COMPILER_SURFACE_CONFIGS[surface];
}

export function getViewPermission(view: View): string | undefined {
  return getSharedViewPermission(view);
}

export function isDevOnlyView(view: View): boolean {
  return isSharedDevOnlyView(view);
}

export function resolveSettingsMode(view: View): 'account' | 'system' | null {
  if (view === View.AccountSettings) return 'account';
  if (view === View.Settings || view === View.SystemSettings) return 'system';
  return null;
}
