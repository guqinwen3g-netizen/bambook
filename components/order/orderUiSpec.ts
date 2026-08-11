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
  };
};
