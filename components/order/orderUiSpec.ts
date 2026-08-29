/**
 * 订单域 UI 统一规范真源（第一阶段收口）
 *
 * 订单管理页面（列表 / 详情 / 录入 / 导入向导）所有容器、分区头、间距、
 * 按钮、行元素、文字层级的唯一配方来源。订单域任何新 UI 必须从这里取配方，
 * 禁止手写变体；既有组件迁移时以本文件为准。
 *
 * 设计约束（与全局契约对齐）：
 *   - flat 设计：无阴影、无 rim、大圆角；玻璃面板一律走 SidePanelContainer
 *     （raisedCard + spotlight + edgeFadeItem），不允许手写 div 容器并存。
 *   - 内嵌元素（行/子卡/字段）使用 rgba() 任意值类，绕开 flat-experimental
 *     护栏（同时含 rounded 与 bg-white//bg-slate- 等子串会被强制 border:0）。
 *   - 状态色遵守 RDL 中性契约：statusSemanticClass（white/slate opacity 驱动），
 *     禁 emerald/red/amber 等 Tailwind 彩色；accent 蓝仅用于品牌锚点
 *     （当前态/主按钮/可点击 hover），不用于状态语义。
 *   - 字重仅 font-light（300），禁 medium+（全局 Light 300 纪律）。
 */

import {
  Activity, Calendar, ClipboardList, CircleDollarSign, Factory, FileEdit, Hash, History,
  Layers, List, Network, Package, Scissors, Ship, ShoppingCart, Tag, Users, Zap,
  Shirt,
  type LucideIcon,
} from 'lucide-react';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { statusSemanticClass } from '../rdlBusinessStatusTokens';

// ---------------------------------------------------------------------------
// 分区头图标映射 — 每个订单分区（含字段 cluster）有且仅有一个登记图标
// ---------------------------------------------------------------------------

export const ORDER_SECTION_ICONS = {
  // 固定分区
  summary: Activity,
  timeline: Activity,
  fulfillment: Zap,
  related: Network,
  context: Ship,
  changes: FileEdit,
  audit: History,
  pipeline: Factory,
  lines: List,
  lineItem: Tag,
  // 字段 cluster（orderSchema.ORDER_CLUSTERS）
  basic: Hash,
  parties: Users,
  delivery: Calendar,
  fabric: Layers,
  sales: CircleDollarSign,
  shipment: Ship,
  sampleShipment: Package,
  sampleFabric: Scissors,
  purchase: ShoppingCart,
  instructions: ClipboardList,
  garmentProduction: Scissors,
  sampleGarment: Shirt,
} satisfies Record<string, LucideIcon>;

export type OrderSectionIconKey = keyof typeof ORDER_SECTION_ICONS;

// ---------------------------------------------------------------------------
// 配方集 — createOrderUiSpec(isDarkMode) 一次求值，组件内自取所需
// ---------------------------------------------------------------------------

export interface OrderUiSpec {
  /** 玻璃面板布局类（配合 SidePanelContainer/CompiledSurfacePanel，materialRole="raisedCard" spotlight edgeFadeItem）。 */
  panelClass: string;
  panelContentClass: string;
  /** 分区头外壳（mb-4 固定为面板头与内容的唯一间距）。 */
  headerWrap: string;
  headerIcon: string;
  kicker: string;
  sectionTitle: string;
  /** 分区头右侧统计/元信息。 */
  headerMeta: string;
  /** 文字层级：title > primary > secondary > muted > faint。 */
  textTitle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  /** 内嵌子区块（面板内的二级分组卡）。 */
  insetSurface: string;
  insetPadding: string;
  subGroupTitle: string;
  subGroupMeta: string;
  /** 胶囊行元素（关联/全链路/审计记录行）。 */
  rowPill: string;
  rowPillHover: string;
  /** 胶囊行材质（border + bg + 默认文字色，无布局）— 供非 justify-between 布局的行/条目复用同一材质。 */
  rowPillSurface: string;
  /** 行内小状态 chip（中性，全链路条目状态/外协状态等）。 */
  chip: string;
  /** 按钮三档 + 纯图标：统一 h-10 胶囊，文字按钮 min-w-[80px]。 */
  btnBase: string;
  btnGhost: string;
  btnAccentOutline: string;
  /** accent 选中态按钮（分段控件激活态，有 bg 填充以区分选中）。 */
  btnAccentActive: string;
  btnPrimary: string;
  btnIcon: string;
  /** 胶囊字段（recessedField 雕刻质感，与全局唯一 token 源对齐）。 */
  field: string;
  fieldNoSpinner: string;
  /** 字段网格：查阅（档案态松弛）/ 编辑（紧凑）。 */
  gridRead: string;
  gridEdit: string;
  /** 错误/危险横幅（圆角 field 级，statusSemanticClass 中性色）。 */
  bannerDanger: string;
  /** 空态提示文字。 */
  emptyText: string;
  /** Toggle 开关外壳（boolean 字段 h-10 胶囊，与 recessedField 同源）。 */
  toggleShell: string;
  /** 选中态按钮（tab 切换/分段控件激活态，非 accent 语义）。 */
  btnActive: string;
  /** 子组头外壳（圆点 + 标题，mb-3 固定间距）。 */
  subGroupHeaderWrap: string;
  /** 子组头前缀圆点颜色。 */
  subGroupDot: string;
  /** ChevronDown/Up 图标颜色（下拉指示器统一色源）。 */
  chevronColor: string;
  /** 字段提示文字（hint，录入辅助说明）。 */
  fieldHint: string;
  /** 查阅态有值文字（14px/400 档案态正文档）。 */
  fieldReadOnlyValue: string;
  /** 查阅态空值文字（13px/light/italic 降级）。 */
  fieldReadOnlyEmpty: string;
  /** 查阅态有值槽位底色（弱底色档案感）。 */
  fieldSlotFilled: string;
  /** 查阅态空值槽位底色（更淡底色暗示"有字段无值"）。 */
  fieldSlotEmpty: string;

  // ── 第三批补全配方（消除列表页/状态机/时间线/分隔线跨文件手写重复） ──

  /** 列表页表格行主文字（密集阅读场景，比面板内 textPrimary 略亮以保证行级对比度）。 */
  listRowPrimary: string;
  /** 列表页表格行常规文字（次级信息列）。 */
  listRowRegular: string;
  /** 列表页表格行辅助文字（行内副标签）。 */
  listRowSecondary: string;

  /** 状态步骤条按钮 — 当前态（accent 实心填充，步进器视觉锚点）。 */
  stepBtnCurrent: string;
  /** 状态步骤条按钮 — 完成态（accent 描边 + accent 文字，低饱和回述已走路径）。 */
  stepBtnDone: string;
  /** 状态步骤条按钮 — 可推进态（ghost 描边 + hover 变 accent）。 */
  stepBtnActionable: string;
  /** 状态步骤条按钮 — 禁用态（极淡描边 + 极淡文字）。 */
  stepBtnDisabled: string;
  /** 状态步骤条连接线 — 已完成段（accent）。 */
  stepConnectorDone: string;
  /** 状态步骤条连接线 — 未完成段（neutral）。 */
  stepConnectorPending: string;

  /** 时间线圆点 — 默认态（neutral）。 */
  timelineDot: string;
  /** 时间线圆点 — 最新事件态（accent + ring 光晕）。 */
  timelineDotActive: string;
  /** 时间线竖向连接线。 */
  timelineConnector: string;
  /** 时间线"最新"标签（accent 弱底色）。 */
  timelineLatestBadge: string;

  /** Capsule 业务线标签（列表/详情通用，消除 3 处手写重复）。 */
  capsuleTag: string;

  /** 工具栏/标题区竖向分隔线（1px，消除 overlayDividerClass 和多处手写重复）。 */
  divider: string;

  /** 列表行交互暗示文字（"查看详情"等带箭头图标的行内提示，hover 时文字变 accent + 箭头右移）。 */
  listRowActionHint: string;

  // ── 第四批补全配方（消除 OrderManager.tsx 详情覆盖层/工具栏/状态徽章/输入框手写重复） ──

  /** 覆盖层/详情页标题文字色（与 textTitle 同级，独立命名方便语义区分）。 */
  overlayTitleClass: string;
  /** 覆盖层/详情页次级文字色（meta 行、label 等）。 */
  overlayMutedClass: string;
  /** 覆盖层/详情页 kicker 文字色（小字 EN 标签）。 */
  overlayKickerClass: string;
  /** 覆盖层/详情页分隔线色。 */
  overlayDividerClass: string;

  /** Detail Map 面板容器内边距。 */
  overlayMapPanelClass: string;
  /** Detail Map 导航按钮容器内边距。 */
  overlayFormPanelClass: string;
  /** Detail Map 序号胶囊样式（圆形半透明背景 + 极淡描边）。 */
  overlayMapIndexClass: string;
  /** Detail Map 导航按钮（整行可点击，hover 态变 accent）。 */
  overlayMapButtonClass: string;

  /** 工具栏搜索输入框（无描边 recessed 质感）。 */
  toolbarSearchInputClass: string;
  /** 工具栏下拉选择框（无描边 recessed 质感）。 */
  toolbarSelectClass: string;
  /** 工具栏下拉箭头颜色。 */
  toolbarChevronClass: string;
  /** 工具栏控件按钮（未选中态）。 */
  toolbarControlClass: string;
  /** 工具栏控件按钮（选中态）。 */
  toolbarSelectedClass: string;

  /** 状态胶囊：根据订单状态返回语义化 class（neutral/info/active/success/warning）。 */
  statusCapsule: (status: string) => string;

  // ── 第五批：OrderFieldInput 补充颜色 ──
  /** 必填星号颜色（录入约束元信息，查阅态不渲染）。 */
  fieldAsterisk: string;
  /** 货币符号颜色（$ ¥ 等前缀）。 */
  fieldCurrencySymbol: string;
  /** 货币代码颜色（USD/CNY 等后缀）。 */
  fieldCurrencyCode: string;

  // ── 第六批：OrderContextSection 阶段标签 ──
  /** 全链路阶段标签（有内容态文字色）。 */
  stageLabelActive: string;

  // ── 第七批：BottomSheet 卡片/按钮样式 ──
  /** BottomSheet 卡片容器（编辑/归档操作项）。 */
  sheetCard: string;
  /** BottomSheet 图标容器（按钮内嵌 icon 背景）。 */
  sheetIconWrap: string;
  /** BottomSheet 子卡片容器（快速状态变更区）。 */
  sheetSubCard: string;
  /** BottomSheet 子卡片标签文字（快速状态变更标题）。 */
  sheetSubLabel: string;
  /** BottomSheet 删除/归档按钮容器。 */
  sheetDangerCard: string;
  /** BottomSheet 删除图标容器。 */
  sheetDangerIcon: string;

  // ── 第八批：订单类型标签（Fabric/Garment/Other 三色区分） ──
  /** 订单类型标签通用外壳 + Fabric 蓝色态。 */
  typeTagFabric: string;
  /** 订单类型标签通用外壳 + Garment 紫色态。 */
  typeTagGarment: string;
  /** 订单类型标签通用外壳 + Other 琥珀色态。 */
  typeTagOther: string;
  /** 订单类型圆点 Fabric 蓝色。 */
  typeDotFabric: string;
  /** 订单类型圆点 Garment 紫色。 */
  typeDotGarment: string;
  /** 订单类型圆点 Other 琥珀色。 */
  typeDotOther: string;

  // ── 第九批：移动端卡片与空状态样式 ──
  /** 移动端卡片主要文字色（订单号、金额等）。 */
  mobileCardPrimaryText: string;
  /** 移动端卡片次要文字色（工厂名、副标题等）。 */
  mobileCardSecondaryText: string;
  /** 移动端卡片标签文字色（FACTORY/VALUE 等小标签）。 */
  mobileCardLabelText: string;
  /** 移动端卡片更多按钮 hover 背景色。 */
  mobileCardMenuHoverBg: string;
  /** 移动端卡片进度条背景色。 */
  mobileCardProgressBg: string;
  /** 移动端 Capsule 标签边框文字色。 */
  mobileCapsuleTag: string;
  /** 空状态文字色。 */
  emptyStateText: string;
  /** 空状态次级文字色。 */
  emptyStateSubtext: string;
  /** 空状态图标色。 */
  emptyStateIcon: string;
  /** 遮罩背景色（模态框/对话框）。 */
  overlayBg: string;
  /** 分割线色（通用边框）。 */
  borderSubtle: string;

  // ── 第十批：子编辑器统一配方（消除 SizeBreakdown/BomItems/ProductionSteps/GarmentSampleStages 跨文件手写重复） ──
  /** 子编辑器输入框（h-9 胶囊，与 OrderFieldInput 的 h-10 形成层级差，表示嵌套字段）。 */
  subFieldInput: string;
  /** 子编辑器字段 focus 态（统一 focus ring，所有输入框复用）。 */
  subFieldFocus: string;
  /** 删除图标按钮（h-9 w-9 方形，ghost → hover 变红）。 */
  deleteBtn: string;
  /** 添加按钮（dashed border 胶囊，ghost → hover 变 accent）。 */
  addBtn: string;
  /** 快捷添加胶囊按钮（可用态）。 */
  quickAddBtn: string;
  /** 快捷添加胶囊按钮（已添加/禁用态）。 */
  quickAddBtnDisabled: string;
  /** 全宽确认按钮（移动端 BottomSheet 底部，py-5 大触摸区）。 */
  btnFullWidthConfirm: string;
}

export const createOrderUiSpec = (isDarkMode: boolean): OrderUiSpec => {
  const dark = isDarkMode;
  return {
    panelClass: 'scroll-mt-28 p-5',
    panelContentClass: 'relative z-10',

    headerWrap: 'mb-4 flex items-end justify-between gap-4',
    headerIcon: dark ? 'text-white/55' : 'text-slate-500',
    kicker: `text-[11px] font-light uppercase tracking-[0.22em] ${dark ? 'text-white/55' : 'text-slate-500'}`,
    sectionTitle: `mt-1 text-base font-light tracking-wide ${dark ? 'text-slate-50' : 'text-slate-950'}`,
    headerMeta: `shrink-0 text-[12px] font-light ${dark ? 'text-white/60' : 'text-slate-600'}`,

    textTitle: dark ? 'text-slate-50' : 'text-slate-950',
    textPrimary: dark ? 'text-white/85' : 'text-slate-800',
    textSecondary: dark ? 'text-white/68' : 'text-slate-700',
    textMuted: dark ? 'text-white/60' : 'text-slate-500',
    textFaint: dark ? 'text-white/40' : 'text-slate-300',

    insetSurface: dark
      ? 'border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.030)]'
      : 'border-[rgba(148,163,184,0.24)] bg-[rgba(255,255,255,0.40)]',
    insetPadding: 'p-4',
    subGroupTitle: `text-[12px] font-light tracking-wide ${dark ? 'text-white/75' : 'text-slate-700'}`,
    subGroupMeta: `text-[10px] font-light uppercase tracking-[0.18em] ${dark ? 'text-white/50' : 'text-slate-400'}`,

    rowPillSurface: dark
      ? 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.035)] text-white/80'
      : 'border-[rgba(148,163,184,0.28)] bg-[rgba(255,255,255,0.45)] text-slate-800',
    rowPill: `flex w-full items-center justify-between gap-3 rounded-full border px-4 py-2 text-left text-[13px] font-light transition-all ${
      dark
        ? 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.035)] text-white/80'
        : 'border-[rgba(148,163,184,0.28)] bg-[rgba(255,255,255,0.45)] text-slate-800'
    }`,
    rowPillHover: dark
      ? 'hover:border-[rgba(125,196,235,0.35)] hover:text-accent-blue'
      : 'hover:border-action/35 hover:text-link',
    chip: `shrink-0 rounded-full border px-2 py-px text-[10px] font-light ${statusSemanticClass('neutral', dark)}`,

    btnBase:
      'flex h-10 min-w-[80px] shrink-0 items-center justify-center gap-1.5 rounded-full border px-4 text-xs font-light tracking-wide whitespace-nowrap transition-all',
    btnGhost: dark
      ? 'border-[rgba(255,255,255,0.13)] text-white/70 hover:bg-[rgba(255,255,255,0.05)]'
      : 'border-[rgba(148,163,184,0.55)] text-slate-600 hover:bg-[rgba(241,245,249,0.70)]',
    btnAccentOutline: dark
      ? 'border-[rgba(125,196,235,0.35)] text-accent-blue hover:bg-accent-blue/[0.10]'
      : 'border-action/30 text-link hover:bg-action/[0.06]',
    btnAccentActive: dark
      ? 'border-[rgba(125,196,235,0.35)] bg-accent-blue/[0.12] text-accent-blue'
      : 'border-action/30 bg-action/[0.07] text-link',
    btnPrimary: dark
      ? 'border-transparent bg-accent-blue/90 text-slate-950 hover:bg-accent-blue'
      : 'border-transparent bg-action text-white hover:bg-link',
    btnIcon: `flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
      dark
        ? 'border-[rgba(255,255,255,0.13)] text-white/70 hover:bg-[rgba(255,255,255,0.05)]'
        : 'border-[rgba(148,163,184,0.55)] text-slate-600 hover:bg-[rgba(241,245,249,0.70)]'
    }`,

    field: `h-10 w-full rounded-full border px-4 text-xs font-light outline-none transition-all ${
      BAMBOOK_OS.controls.recessedField.base
    }`,
    fieldNoSpinner:
      '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',

    gridRead: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-7',
    gridEdit: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',

    bannerDanger: `flex items-center gap-2 rounded-field border px-3 py-2 text-xs font-light ${statusSemanticClass('danger', dark)}`,
    emptyText: `text-xs font-light ${dark ? 'text-white/42' : 'text-slate-500'}`,

    // ── 第二批补全配方（消除跨文件手写重复） ──
    toggleShell: `flex h-10 w-fit items-center gap-3 rounded-full border px-4 text-xs font-light outline-none transition-all ${
      BAMBOOK_OS.controls.recessedField.base
    }`,
    btnActive: dark
      ? 'border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.08)] text-white/88'
      : 'border-[rgba(100,116,139,0.50)] bg-[rgba(226,232,240,0.70)] text-slate-800',
    subGroupHeaderWrap: 'mb-3 flex items-center gap-2',
    subGroupDot: dark ? 'bg-white/40' : 'bg-slate-400',
    chevronColor: dark ? 'text-white/35' : 'text-slate-400',
    fieldHint: `text-[9px] font-light ml-1 ${dark ? 'text-white/35' : 'text-slate-400'}`,
    fieldReadOnlyValue: `text-[14px] font-light leading-relaxed ${dark ? 'text-white/85' : 'text-slate-800'}`,
    fieldReadOnlyEmpty: `text-[13px] font-light italic leading-relaxed ${dark ? 'text-white/20' : 'text-slate-300/70'}`,
    fieldSlotFilled: dark ? 'bg-white/[0.03]' : 'bg-slate-900/[0.025]',
    fieldSlotEmpty: dark ? 'bg-white/[0.015]' : 'bg-slate-900/[0.015]',

    // ── 第三批补全配方（消除列表页/状态机/时间线/分隔线跨文件手写重复） ──

    // 列表页表格行文字：密集阅读场景，比面板内 textPrimary 略亮（slate-100/slate-950 vs white/85/slate-800）
    listRowPrimary: `truncate text-[13px] font-light leading-[1.25] tracking-normal ${dark ? 'text-slate-100' : 'text-slate-950'}`,
    listRowRegular: `truncate text-[13px] font-light leading-[1.25] tracking-normal ${dark ? 'text-slate-300' : 'text-slate-700'}`,
    listRowSecondary: `mt-1 truncate text-[11px] font-light leading-[1.2] tracking-normal ${dark ? 'text-white/42' : 'text-slate-500'}`,

    // 状态步骤条按钮四态：current=accent实心 / done=accent描边 / actionable=ghost+hover变accent / disabled=极淡
    stepBtnCurrent: dark ? 'border-transparent bg-accent-blue/90 text-slate-950' : 'border-transparent bg-action text-white',
    stepBtnDone: dark ? 'border-[rgba(125,196,235,0.35)] text-accent-blue' : 'border-action/30 text-link',
    stepBtnActionable: dark
      ? 'border-[rgba(255,255,255,0.13)] text-white/70 hover:border-[rgba(125,196,235,0.35)] hover:text-accent-blue'
      : 'border-[rgba(148,163,184,0.55)] text-slate-600 hover:border-action/30 hover:text-link',
    stepBtnDisabled: dark
      ? 'border-[rgba(255,255,255,0.08)] text-white/25 cursor-not-allowed'
      : 'border-[rgba(148,163,184,0.28)] text-slate-300 cursor-not-allowed',
    stepConnectorDone: dark ? 'bg-accent-blue/50' : 'bg-action/35',
    stepConnectorPending: dark ? 'bg-white/[0.08]' : 'bg-slate-200',

    // 时间线：圆点(active=accent+ring / default=neutral) + 连接线 + 最新标签
    timelineDot: dark ? 'bg-[rgba(255,255,255,0.16)]' : 'bg-[rgba(148,163,184,0.40)]',
    timelineDotActive: dark ? 'bg-accent-blue ring-4 ring-accent-blue/15' : 'bg-action ring-4 ring-action/10',
    timelineConnector: dark ? 'bg-white/5' : 'bg-slate-200',
    timelineLatestBadge: dark ? 'bg-accent-blue/[0.14] text-accent-blue' : 'bg-action/[0.08] text-link',

    // Capsule 业务线标签：列表/详情通用，消除 3 处手写重复
    capsuleTag: `shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-light leading-none tracking-wide ${dark ? 'border-[rgba(255,255,255,0.14)] text-white/55' : 'border-[rgba(148,163,184,0.55)] text-slate-500'}`,

    // 竖向分隔线：工具栏/标题区 1px，消除 overlayDividerClass 和多处手写重复
    divider: dark ? 'bg-white/10' : 'bg-slate-300/40',

    // 列表行交互暗示：flex 排版（容纳箭头图标）+ hover 变 accent 色（与行 group-hover 联动）
    listRowActionHint: `mt-1 flex items-center gap-1 text-[11px] font-light leading-[1.2] tracking-normal transition-colors duration-200 ${dark ? 'text-white/42 group-hover:text-accent-blue' : 'text-slate-500 group-hover:text-link'}`,

    // ── 第四批：覆盖层/详情页文字色（消除 overlay* 变量手写重复） ──
    overlayTitleClass: dark ? 'text-slate-50' : 'text-slate-950',
    overlayMutedClass: dark ? 'text-white/42' : 'text-slate-500',
    overlayKickerClass: dark ? 'text-white/40' : 'text-slate-500',
    overlayDividerClass: dark ? 'bg-white/10' : 'bg-slate-300/40',

    // ── 第四批：Detail Map / Form 面板 ──
    overlayMapPanelClass: 'p-4 bambook-relations-form-map-panel',
    overlayFormPanelClass: 'scroll-mt-28 p-5 bambook-relations-form-panel',
    overlayMapIndexClass: dark
      ? 'bg-white/[0.035] border-white/[0.06] text-white/58'
      : 'bg-white/55 border-white/60 text-slate-500',
    overlayMapButtonClass: `w-full text-left rounded-full border px-3 py-3 transition-all ${
      dark
        ? 'border-transparent hover:bg-white/[0.05] hover:border-white/[0.10] text-white/70 hover:text-white/85'
        : 'border-transparent hover:bg-slate-50/70 hover:border-slate-200 text-slate-600 hover:text-slate-900'
    }`,

    // ── 第四批：工具栏输入框/下拉框/控件 ──
    toolbarSearchInputClass: `h-8 min-w-[100px] max-w-[180px] flex-1 rounded-full border-0 px-3.5 text-xs font-light outline-none placeholder:opacity-50 ${
      dark ? 'bg-white/5 text-white/80' : 'bg-slate-100/80 text-slate-700'
    }`,
    toolbarSelectClass: `h-8 w-full appearance-none cursor-pointer whitespace-nowrap rounded-full border-0 pl-3.5 pr-8 text-xs font-light outline-none ${
      dark ? 'bg-white/5 text-white/80' : 'bg-slate-100/80 text-slate-700'
    }`,
    toolbarChevronClass: dark ? 'text-white/35' : 'text-slate-400',
    toolbarControlClass: dark
      ? 'bg-transparent text-white/46 shadow-none hover:bg-transparent hover:text-white/76 active:translate-y-[1px]'
      : 'bg-transparent text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900 active:translate-y-[1px]',
    toolbarSelectedClass: dark
      ? 'bg-white/[0.050] text-white/86 shadow-none'
      : 'bg-white/42 text-slate-950 shadow-none',

    // ── 第四批：状态胶囊统一函数（与 heroStatusCapsuleClass 同构，消除 getStatusStyles/getStatusStylesDesktop 分叉） ──
    statusCapsule: (status: string) => {
      if (status === 'Alert') return statusSemanticClass('warning', dark);
      if (status === 'Delivered') return statusSemanticClass('success', dark);
      if (status === 'Pending') return statusSemanticClass('neutral', dark);
      // Confirmed / Production / Shipping → active/info（进行中 accent 语义）
      return dark
        ? 'border-[rgba(125,196,235,0.30)] bg-accent-blue/[0.12] text-accent-blue'
        : 'border-action/25 bg-action/[0.06] text-link';
    },

    // ── 第五批：OrderFieldInput 补充颜色（第一 batch 已有 fieldReadOnlyValue/fieldReadOnlyEmpty/fieldHint/fieldSlot*/subGroupDot） ──
    fieldAsterisk: dark ? 'text-white/35' : 'text-slate-400',
    fieldCurrencySymbol: dark ? 'text-white/46' : 'text-slate-500',
    fieldCurrencyCode: dark ? 'text-white/35' : 'text-slate-400',

    // ── 第六批：OrderContextSection 阶段标签 ──
    stageLabelActive: dark ? 'text-white/75' : 'text-slate-700',

    // ── 第七批：BottomSheet 卡片/按钮样式 ──
    sheetCard: dark ? 'bg-slate-800/50 text-slate-200' : 'bg-slate-50 text-slate-700',
    sheetIconWrap: dark ? 'bg-white/[0.06] text-slate-500' : 'bg-slate-400/10 text-slate-500',
    sheetSubCard: dark ? 'bg-slate-800/50' : 'bg-slate-50',
    sheetSubLabel: dark ? 'text-white/40' : 'text-slate-400',
    sheetDangerCard: dark ? 'bg-slate-800/40 text-slate-400' : 'bg-slate-100/60 text-slate-600',
    sheetDangerIcon: dark ? 'bg-white/[0.06] text-slate-500' : 'bg-slate-400/10 text-slate-500',

    // ── 第八批：订单类型标签（Fabric/Garment/Other 三色区分） ──
    typeTagFabric: dark
      ? 'rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] font-light tracking-wide text-[var(--accent-text)]'
      : 'rounded-full border border-action/25 bg-action/[0.06] px-2 py-0.5 text-[10px] font-light tracking-wide text-link',
    typeTagGarment: dark
      ? 'rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] font-light tracking-wide text-[var(--accent-text)]'
      : 'rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] font-light tracking-wide text-[var(--accent-text)]',
    typeTagOther: dark
      ? 'rounded-full border border-[var(--warning-border)] bg-[var(--warning-tint)] px-2 py-0.5 text-[10px] font-light tracking-wide text-[var(--warning-text)]'
      : 'rounded-full border border-[var(--warning-border)] bg-[var(--warning-tint)] px-2 py-0.5 text-[10px] font-light tracking-wide text-[var(--warning-text)]',
    typeDotFabric: dark ? 'bg-[var(--accent)]' : 'bg-action',
    typeDotGarment: dark ? 'bg-[var(--accent)]' : 'bg-[var(--accent)]',
    typeDotOther: dark ? 'bg-[var(--warning)]' : 'bg-[var(--warning)]',

    // ── 第九批：移动端卡片与空状态样式 ──
    mobileCardPrimaryText: dark ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]',
    mobileCardSecondaryText: dark ? 'text-[var(--text-secondary)]' : 'text-[var(--text-secondary)]',
    mobileCardLabelText: dark ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-tertiary)]',
    mobileCardMenuHoverBg: dark ? 'hover:bg-[var(--hover-darken)]' : 'hover:bg-[var(--hover-darken)]',
    mobileCardProgressBg: dark ? 'bg-[var(--recessed-bg)]' : 'bg-[var(--recessed-bg)]',
    mobileCapsuleTag: dark
      ? 'border-[var(--border-c-subtle)] text-[var(--text-secondary)]'
      : 'border-[var(--border-c-subtle)] text-[var(--text-secondary)]',
    emptyStateText: dark ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-tertiary)]',
    emptyStateSubtext: dark ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-tertiary)]',
    emptyStateIcon: dark ? 'text-[var(--text-quaternary)]' : 'text-[var(--text-quaternary)]',
    overlayBg: dark ? 'bg-[var(--mask-bg)]' : 'bg-[var(--mask-bg)]',
    borderSubtle: dark ? 'border-[var(--border-c-subtle)]' : 'border-[var(--border-c-subtle)]',

    // ── 第十批：子编辑器统一配方 ──
    subFieldInput: `h-9 px-3 rounded-control border outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all ${
      BAMBOOK_OS.controls.recessedField.base
    }`,
    subFieldFocus: dark
      ? 'focus:border-[var(--border-c-strong)] focus:ring-1 focus:ring-[var(--border-c-strong)]/40'
      : 'focus:border-[var(--border-c-strong)] focus:ring-1 focus:ring-[var(--border-c-strong)]/40',
    deleteBtn: `flex h-9 w-9 shrink-0 items-center justify-center rounded-control border transition-all ${
      dark
        ? 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--danger-tint)] hover:border-[var(--danger-border)] hover:text-[var(--danger-text)]'
        : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--danger-tint)] hover:border-[var(--danger-border)] hover:text-[var(--danger-text)]'
    }`,
    addBtn: `flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[11px] font-light transition-all ${
      dark
        ? 'border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--accent-tint)] hover:border-[var(--accent-border)] hover:text-[var(--accent-text)]'
        : 'border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--accent-tint)] hover:border-[var(--accent-border)] hover:text-[var(--accent-text)]'
    }`,
    quickAddBtn: `rounded-full border px-2.5 py-1 text-[10px] font-light transition-all ${
      dark
        ? 'border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)] hover:border-[var(--border-c-strong)]'
        : 'border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)] hover:border-[var(--border-c-strong)]'
    }`,
    quickAddBtnDisabled: `rounded-full border px-2.5 py-1 text-[10px] font-light ${
      dark
        ? 'border-[var(--border-c-subtle)] text-[var(--text-quaternary)] cursor-not-allowed'
        : 'border-[var(--border-c-subtle)] text-[var(--text-quaternary)] cursor-not-allowed'
    }`,
    btnFullWidthConfirm: `w-full py-5 text-xs font-light uppercase tracking-widest rounded-full mt-4 transition-all ${
      dark
        ? 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--recessed-bg-hover)]'
        : 'bg-[var(--recessed-bg-strong)] border border-[var(--border-c-default)] text-[var(--text-primary)] hover:bg-[var(--recessed-bg-hover)]'
    }`,
  };
};
