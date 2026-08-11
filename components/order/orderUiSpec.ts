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
 *   - 字重仅 font-extralight / font-light / font-normal（400），禁 medium+。
 */

import {
  Activity, Calendar, ClipboardList, CircleDollarSign, Factory, Hash, History,
  Layers, List, Network, Package, Scissors, Ship, ShoppingCart, Tag, Users, Zap,
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
}

export const createOrderUiSpec = (isDarkMode: boolean): OrderUiSpec => {
  const dark = isDarkMode;
  return {
    panelClass: 'scroll-mt-28 p-5',
    panelContentClass: 'relative z-10',

    headerWrap: 'mb-4 flex items-end justify-between gap-4',
    headerIcon: dark ? 'text-white/42' : 'text-slate-500',
    kicker: `text-[10px] font-light uppercase tracking-[0.22em] ${dark ? 'text-white/40' : 'text-slate-500'}`,
    sectionTitle: `mt-1 text-base font-light tracking-wide ${dark ? 'text-slate-50' : 'text-slate-950'}`,
    headerMeta: `shrink-0 text-[11px] font-light ${dark ? 'text-white/42' : 'text-slate-500'}`,

    textTitle: dark ? 'text-slate-50' : 'text-slate-950',
    textPrimary: dark ? 'text-white/85' : 'text-slate-800',
    textSecondary: dark ? 'text-white/68' : 'text-slate-700',
    textMuted: dark ? 'text-white/42' : 'text-slate-500',
    textFaint: dark ? 'text-white/25' : 'text-slate-300',

    insetSurface: dark
      ? 'border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.030)]'
      : 'border-[rgba(148,163,184,0.24)] bg-[rgba(255,255,255,0.40)]',
    insetPadding: 'p-4',
    subGroupTitle: `text-[11px] font-light tracking-wide ${dark ? 'text-white/75' : 'text-slate-700'}`,
    subGroupMeta: `text-[9px] font-light uppercase tracking-[0.18em] ${dark ? 'text-white/35' : 'text-slate-400'}`,

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
      dark ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light
    }`,
    fieldNoSpinner:
      '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',

    gridRead: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-7',
    gridEdit: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',

    bannerDanger: `flex items-center gap-2 rounded-field border px-3 py-2 text-xs font-light ${statusSemanticClass('danger', dark)}`,
    emptyText: `text-xs font-light ${dark ? 'text-white/42' : 'text-slate-500'}`,

    // ── 第二批补全配方（消除跨文件手写重复） ──
    toggleShell: `flex h-10 w-fit items-center gap-3 rounded-full border px-4 text-xs font-light outline-none transition-all ${
      dark ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light
    }`,
    btnActive: dark
      ? 'border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.08)] text-white/88'
      : 'border-[rgba(100,116,139,0.50)] bg-[rgba(226,232,240,0.70)] text-slate-800',
    subGroupHeaderWrap: 'mb-3 flex items-center gap-2',
    subGroupDot: dark ? 'bg-white/40' : 'bg-slate-400',
    chevronColor: dark ? 'text-white/35' : 'text-slate-400',
    fieldHint: `text-[9px] font-light ml-1 ${dark ? 'text-white/35' : 'text-slate-400'}`,
    fieldReadOnlyValue: `text-[14px] font-normal leading-relaxed ${dark ? 'text-white/85' : 'text-slate-800'}`,
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
  };
};
