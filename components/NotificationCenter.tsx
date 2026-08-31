/**
 * NotificationCenter — 业务事件通知中心
 *
 * 功能：
 *   1. 铃铛按钮（固定右上角）+ 未读徽章
 *   2. 抽屉面板（右侧滑出，磨砂玻璃材质）
 *   3. 通知列表（类型图标 + 标题 + 正文 + 时间 + 操作）
 *   4. 标记已读 / 全部已读 / 删除
 *   5. 轮询统计（30s）+ 实时 SSE 增量
 *
 * 设计：flat 无阴影、大圆角（rounded-card/rounded-control）、半透明膜色（backdrop-blur）
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell, X, Check, CheckCheck, Trash2,
  PackageCheck, Package, Factory, Truck, FileText, FileX,
  Receipt, DollarSign, CheckCircle, AlertTriangle, Clock,
  MessageSquare, ClipboardList, Info, Settings2, ArrowLeft, ArrowRight, UserPlus,
  Stamp, Loader2, AlertCircle, BellOff,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { NotificationItem, NotificationStats, NotificationTypeCatalogItem, ApprovalRequestItem } from '../types';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { bdsToast } from './ui/bdsToast';
import { statusSemanticClass, statusSemanticText, statusSemanticBg } from './rdlBusinessStatusTokens';

// D2 主动提醒引擎 — Electron 原生推送桥（preload.ts exposeInMainWorld）。
// Web 浏览器环境下为 undefined，相关能力自动降级为仅应用内提醒。
declare global {
  interface Window {
    bambookNotification?: {
      showNative: (payload: { title: string; body?: string; link?: string }) => Promise<{ ok: boolean; reason?: string }>;
      onOpenLink: (cb: (link: string) => void) => () => void;
    };
  }
}

// ── 通知类型 → 图标映射 ──
const TYPE_ICON_MAP: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  order_confirmed: PackageCheck,
  order_status_changed: Package,
  production_stage_advanced: Factory,
  production_completed: Factory,
  shipment_created: Truck,
  shipment_status_changed: Truck,
  shipment_completed: PackageCheck,
  invoice_issued: FileText,
  invoice_cancelled: FileX,
  payment_voucher_created: Receipt,
  payment_received: DollarSign,
  allocation_reconciled: CheckCircle,
  stock_low: AlertTriangle,
  payment_overdue: Clock,
  agent_message: MessageSquare,
  briefing: ClipboardList,
  // 卡滞业务流程检测（scheduler 每小时扫描，warning/critical 级别）
  stuck_order: AlertTriangle,
  stuck_shipment: AlertTriangle,
  stuck_invoice: Clock,
  stuck_voucher: Clock,
  // LC / 退税到期预警（expiry_watchdog，分级 info/warning/critical）
  lc_expiry: AlertTriangle,
  lc_shipment_deadline: Truck,
  lc_presentation_deadline: FileText,
  tax_refund_deadline: Receipt,
  // 出运延误预警（shipment_delay_detector，warning/critical）
  shipment_delay: Truck,
  // 工作流引擎审批通知
  workflow_pending: ClipboardList,
  workflow_approved: CheckCircle,
  workflow_rejected: AlertTriangle,
};

// ── 通知级别 → 颜色映射 ──
// RDL 语义 token，抽屉跟随主题（light/dark 双模式）；info 保留品牌 accent 蓝。
const levelColorFor = (level: string, dark: boolean): string => {
  if (level === 'critical') return statusSemanticText('danger', dark);
  if (level === 'warning') return statusSemanticText('warning', dark);
  return 'text-link';
};

const levelBgFor = (level: string, dark: boolean): string => {
  if (level === 'critical' || level === 'warning') return 'bg-[var(--recessed-bg)]';
  return dark ? 'bg-[rgb(var(--bambook-brand-link-rgb)/0.08)]' : 'bg-[rgb(var(--bambook-brand-link-rgb)/0.06)]';
};

// ── 时间格式化（相对时间）──
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ── 通知中心 Context ──
// 将 isOpen/toggle/unreadCount 等状态暴露给 Trigger 组件，
// 使通知按钮可以集成到各页面 header 中，而非 fixed 定位。
interface NotificationContextValue {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  unreadCount: number;
  criticalCount: number;
  isDarkMode: boolean;
}

const NotificationContext = React.createContext<NotificationContextValue | null>(null);

export function useNotificationCenter(): NotificationContextValue | null {
  return React.useContext(NotificationContext);
}

// ── 通知铃铛按钮（可集成到任意 header 中）──
// 替代原 fixed 定位按钮，通过 Context 获取状态，自然融入页面 header 布局。
export interface NotificationCenterTriggerProps {
  className?: string;
  iconSize?: number;
  iconStrokeWidth?: number;
  /** default：56px 大圆角方块（Dashboard 冻结区沿用）；header：40px 圆形胶囊（PageHeader 标题栏节奏） */
  variant?: 'default' | 'header';
}

export function NotificationCenterTrigger({
  className,
  iconSize,
  iconStrokeWidth = 1.3,
  variant = 'default',
}: NotificationCenterTriggerProps) {
  const ctx = React.useContext(NotificationContext);
  if (!ctx) return null;
  const { isOpen, toggle, unreadCount, criticalCount } = ctx;
  const hasUnread = unreadCount > 0;
  const pillClass = BAMBOOK_OS.controls.actionControl.base;
  const sizeClass = variant === 'header'
    ? 'h-10 w-10 rounded-full'
    : 'h-14 w-14 rounded-card-lg';
  const resolvedIconSize = iconSize ?? (variant === 'header' ? 16 : 19);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? '关闭通知中心' : '打开通知中心'}
      className={`relative flex shrink-0 items-center justify-center border ${sizeClass} ${pillClass} text-os-adaptive-primary transition-colors duration-200
        ${isOpen ? 'scale-90 opacity-80' : ''}
        ${className ?? ''}
      `}
    >
      <Bell size={resolvedIconSize} strokeWidth={iconStrokeWidth} />
      {hasUnread && (
        /* 未读数字气泡：BDS 实底配方（danger/accent 实底 + on-accent 恒白字，与 btn-primary 同源，深浅模式同配方） */
        <span className="absolute -right-1 -top-1 flex items-center justify-center">
          {criticalCount > 0 && !isOpen && (
            /* 危急呼吸光晕：与徽章同心同形（inset-0 跟随轮廓），微弱呼吸垫在数字层之下，永不盖字 */
            <span className="absolute inset-0 rounded-full bg-[var(--danger)] bds-breathe" />
          )}
          <span
            className={`relative flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-light leading-none
              ${criticalCount > 0
                ? 'bg-[var(--danger)] text-[var(--on-accent)] ring-2 ring-[var(--border-c-strong)]'
                : 'bg-[var(--accent)] text-[var(--on-accent)]'}
            `}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        </span>
      )}
    </button>
  );
}

// ── 组件 ──
export interface NotificationCenterProps {
  isDarkMode?: boolean;
  endpoint?: string;
  children?: React.ReactNode;
  /**
   * 通知 link 打开回调（App 层路由）：点击带 link 的通知项 / D2 桌面推送回跳时触发。
   * App 侧解析 link（parseNotificationLink）后切视图 + 定位 tab / 直达单据详情。
   * 未提供时降级为写 window.location.hash（保留旧行为，无消费者时不产生导航）。
   */
  onOpenLink?: (link: string) => void;
}

export function NotificationCenter({ isDarkMode = false, endpoint, children, onOpenLink }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  // R3：服务端 total + 追加加载（limit 50/页，「加载更多」按钮 offset 拉取）
  const [itemsTotal, setItemsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D2: 偏好面板视图 + 类型目录
  const [view, setView] = useState<'list' | 'prefs' | 'approvals'>('list');
  const [catalog, setCatalog] = useState<NotificationTypeCatalogItem[] | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  // PRD 19.21 业务审批中心：待办/已办 + 决策行内状态
  const [approvalView, setApprovalView] = useState<'pending' | 'done'>('pending');
  const [approvals, setApprovals] = useState<ApprovalRequestItem[] | null>(null);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [approvalsError, setApprovalsError] = useState<string | null>(null); // 401/403 → 无权限降级文案
  const [rejectingId, setRejectingId] = useState<string | null>(null); // 展开驳回意见输入的审批 id
  const [rejectNote, setRejectNote] = useState('');
  const [decidingId, setDecidingId] = useState<string | null>(null);
  // D2: 转跟进行内反馈（notificationId → 提示文案）
  const [followUpFeedback, setFollowUpFeedback] = useState<Record<string, string>>({});
  // PRD 7.1「忽略需填原因」：行内忽略输入状态
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [dismissError, setDismissError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // 用 ref 跟踪抽屉开关状态，避免 SSE 订阅因 isOpen 变化而重建连接
  const isOpenRef = useRef(false);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  const unreadCount = stats?.unread ?? 0;

  // ── 获取统计 ──
  const fetchStats = useCallback(async () => {
    try {
      const s = await apiService.getNotificationStats(endpoint);
      setStats(s);
    } catch {
      // 静默失败 — 通知不可用不应影响主界面
    }
  }, [endpoint]);

  // ── 获取列表（R3：offset>0 为「加载更多」追加页，否则为首屏替换） ──
  const fetchItems = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const { items: list, total } = await apiService.listNotifications({ limit: 50, offset, endpoint });
      setItems(prev => (offset > 0 ? [...prev, ...list] : list));
      setItemsTotal(total);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [endpoint]);

  // ── 轮询统计（30s）──
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ── 实时 SSE 通知订阅（增量更新，无需等待轮询）──
  // 订阅仅在 endpoint 变化时重建，不随抽屉开关 flapping
  useEffect(() => {
    const unsubscribe = apiService.subscribeToNotifications(endpoint, (sseEvent) => {
      // 增量更新未读徽章统计
      setStats(prev => prev ? {
        ...prev,
        total: prev.total + 1,
        unread: prev.unread + 1,
        critical: sseEvent.level === 'critical' ? prev.critical + 1 : prev.critical,
        byType: {
          ...prev.byType,
          [sseEvent.type]: (prev.byType[sseEvent.type] ?? 0) + 1,
        },
      } : prev);

      // D2 桌面原生推送：warning/critical 预警在窗口不可见时通过 OS 通知中心
      // 触达（窗口可见时应用内徽章/抽屉已足够，避免双重打扰）。Web 环境桥不
      // 存在，自动跳过。
      if (
        sseEvent.level !== 'info'
        && typeof document !== 'undefined'
        && document.hidden
        && typeof window !== 'undefined'
        && window.bambookNotification
      ) {
        window.bambookNotification.showNative({
          title: sseEvent.title,
          body: sseEvent.body,
          link: sseEvent.link,
        }).catch(() => { /* 推送失败不影响应用内链路 */ });
      }

      // 若抽屉已打开，将新通知增量插入列表头部（通过 ref 读取最新值，避免闭包陈旧）
      if (isOpenRef.current) {
        const newItem: NotificationItem = {
          id: sseEvent.eventId,
          userId: '', // SSE 推送不携带当前用户 ID，落库记录已有真实 userId
          type: sseEvent.type,
          title: sseEvent.title,
          body: sseEvent.body,
          level: sseEvent.level as 'info' | 'warning' | 'critical',
          link: sseEvent.link ?? null,
          metadata: { eventId: sseEvent.eventId, eventType: sseEvent.eventType, orderId: sseEvent.orderId ?? null },
          readAt: null,
          createdAt: new Date(sseEvent.timestamp ?? Date.now()).toISOString(),
        };
        setItems(prev => [newItem, ...prev]);
      }
    });
    return unsubscribe;
  }, [endpoint]);

  // ── D2 原生推送点击回跳：主进程聚焦窗口后回发 link，经 onOpenLink 走 App 路由 ──
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  useEffect(() => {
    if (typeof window === 'undefined' || !window.bambookNotification) return;
    return window.bambookNotification.onOpenLink((link) => {
      if (!link) return;
      if (onOpenLinkRef.current) onOpenLinkRef.current(link);
      else window.location.hash = link;
    });
  }, []);

  // ── 抽屉打开时获取列表 ──
  useEffect(() => {
    if (isOpen) fetchItems();
  }, [isOpen, fetchItems]);

  // ── ESC 关闭抽屉 ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  // ── 操作：标记已读 ──
  const handleMarkAsRead = useCallback(async (id: string) => {
    // 乐观更新
    setItems(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    setStats(prev => prev ? { ...prev, unread: Math.max(0, prev.unread - 1) } : prev);
    try {
      await apiService.markNotificationAsRead(id, endpoint);
    } catch {
      // 回滚
      setItems(prev => prev.map(n => n.id === id ? { ...n, readAt: null } : n));
      setStats(prev => prev ? { ...prev, unread: prev.unread + 1 } : prev);
    }
  }, [endpoint]);

  // ── 操作：全部已读 ──
  const handleMarkAllRead = useCallback(async () => {
    setItems(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setStats(prev => prev ? { ...prev, unread: 0 } : prev);
    try {
      await apiService.markAllNotificationsAsRead(endpoint);
    } catch {
      fetchStats();
      fetchItems();
    }
  }, [endpoint, fetchStats, fetchItems]);

  // ── 操作：删除 ──
  const handleDelete = useCallback(async (id: string) => {
    const prev = items;
    const prevStats = stats;
    setItems(items.filter(n => n.id !== id));
    const wasUnread = items.find(n => n.id === id)?.readAt === null;
    if (wasUnread && stats) {
      setStats({ ...stats, unread: Math.max(0, stats.unread - 1), total: Math.max(0, stats.total - 1) });
    }
    try {
      await apiService.deleteNotification(id, endpoint);
    } catch {
      setItems(prev);
      setStats(prevStats);
    }
  }, [items, stats, endpoint]);

  // ── 操作：点击通知项（跳转 + 标记已读）──
  const handleItemClick = useCallback((item: NotificationItem) => {
    if (!item.readAt) handleMarkAsRead(item.id);
    if (item.link) {
      // 跳转经 onOpenLink 走 App 层 React 路由（切视图 + tab/详情定位）；
      // 未提供回调时降级写 hash（旧链路，App 不消费 hash 时不产生导航）
      if (onOpenLink) onOpenLink(item.link);
      else window.location.hash = item.link;
      setIsOpen(false);
    }
  }, [handleMarkAsRead, onOpenLink]);

  // ── D2 偏好面板：进入时加载类型目录 ──
  useEffect(() => {
    if (!isOpen || view !== 'prefs') return;
    setPrefsLoading(true);
    apiService.getNotificationTypeCatalog(endpoint)
      .then(setCatalog)
      .catch(() => setCatalog([]))
      .finally(() => setPrefsLoading(false));
  }, [isOpen, view, endpoint]);

  // ── D2 偏好面板：启用/静音某类型（乐观更新，失败回滚）──
  const handleTogglePreference = useCallback(async (type: string, nextEnabled: boolean) => {
    const prev = catalog;
    setCatalog(cur => cur ? cur.map(c => c.type === type ? { ...c, isEnabled: nextEnabled } : c) : cur);
    try {
      await apiService.upsertNotificationPreference(type, nextEnabled, endpoint);
    } catch {
      setCatalog(prev);
    }
  }, [catalog, endpoint]);

  // ── D2 通知转 CRM 跟进任务（幂等；NO_RELATION 时行内提示）──
  const handleConvertToFollowUp = useCallback(async (item: NotificationItem) => {
    setFollowUpFeedback(prev => ({ ...prev, [item.id]: '创建中...' }));
    try {
      const result = await apiService.convertNotificationToFollowUp(item.id, endpoint);
      setFollowUpFeedback(prev => ({
        ...prev,
        [item.id]: result.reused ? '已建过跟进任务' : `已创建跟进（${result.nextFollowUpAt ?? '明天'}再跟进）`,
      }));
    } catch (e: any) {
      setFollowUpFeedback(prev => ({ ...prev, [item.id]: String(e?.message || '转跟进失败') }));
    }
  }, [endpoint]);

  // ── PRD 7.1 忽略通知（必填原因；乐观移除，失败回滚）──
  const handleDismiss = useCallback(async (item: NotificationItem) => {
    const reason = dismissReason.trim();
    if (!reason) {
      setDismissError('请填写忽略原因');
      return;
    }
    const prev = items;
    const prevStats = stats;
    setItems(prev.filter(n => n.id !== item.id));
    if (!item.readAt && stats) {
      setStats({ ...stats, unread: Math.max(0, stats.unread - 1), total: Math.max(0, stats.total - 1) });
    }
    setDismissingId(null);
    setDismissReason('');
    setDismissError(null);
    try {
      await apiService.dismissNotification(item.id, reason, endpoint);
    } catch (e: any) {
      setItems(prev);
      setStats(prevStats);
      setDismissError(String(e?.message || '忽略失败'));
    }
  }, [items, stats, dismissReason, endpoint]);

  // ── PRD 19.21 业务审批：列表加载（401/403 降级为无权限文案，不影响通知）──
  const fetchApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    setApprovalsError(null);
    try {
      const list = await apiService.listApprovals({ status: approvalView, endpoint });
      setApprovals(list);
    } catch (e: any) {
      const msg = String(e?.message || e);
      // 未登录/无审批角色 → 友好降级（审批中心仅对管理层开放）
      setApprovalsError(/401|403|authentication|forbidden|登录|审批/i.test(msg) ? '当前账号无业务审批权限' : msg);
      setApprovals(null);
    } finally {
      setApprovalsLoading(false);
    }
  }, [approvalView, endpoint]);

  useEffect(() => {
    if (!isOpen || view !== 'approvals') return;
    fetchApprovals();
  }, [isOpen, view, approvalView, fetchApprovals]);

  // ── PRD 19.21 业务审批：决策（通过 / 驳回；驳回必填意见，服务端强制）──
  const handleDecideApproval = useCallback(async (item: ApprovalRequestItem, status: 'approved' | 'rejected') => {
    const note = status === 'rejected' ? rejectNote.trim() : '';
    if (status === 'rejected' && !note) return; // 输入框为空时不发起（按钮已 disabled，双保险）
    setDecidingId(item.id);
    try {
      await apiService.decideApproval(item.id, status, note || undefined, endpoint);
      setRejectingId(null);
      setRejectNote('');
      bdsToast.success(status === 'approved' ? '已通过该审批。' : '已驳回该审批。');
      fetchApprovals();
    } catch (e: any) {
      setApprovalsError(String(e?.message || '决策失败'));
    } finally {
      setDecidingId(null);
    }
  }, [rejectNote, endpoint, fetchApprovals]);

  const hasUnread = unreadCount > 0;

  // ── 主题配方：抽屉跟随主题（dark=深膜 / light=亮膜），文字/表面/控件层级统一收口 ──
  const dk = isDarkMode;
  const ui = {
    /** Tab 选中态 / 面板标题 */
    title: 'text-[var(--text-primary)]',
    tabIdle: 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
    /** 一级正文（通知标题未读、审批标题） */
    primary: 'text-[var(--text-primary)]',
    /** 二级正文（通知正文未读） */
    body: 'text-[var(--text-secondary)]',
    /** 三级辅助（meta/说明） */
    muted: 'text-[var(--text-tertiary)]',
    faint: 'text-[var(--text-tertiary)]',
    ghost: 'text-[var(--text-quaternary)]',
    /** 空态大图标 */
    iconEmpty: 'text-[var(--text-quaternary)]',
    /** 已读态 */
    readTitle: 'font-light text-[var(--text-tertiary)]',
    readBody: 'text-[var(--text-tertiary)]',
    /** 行/条目 hover */
    rowHover: 'hover:bg-[var(--hover-darken)]',
    /** 未读行 hover（底色之上再加深） */
    rowHoverUnread: 'hover:bg-[var(--recessed-bg-hover)]',
    /** 审批卡片 / 决策意见底板 */
    card: 'bg-[var(--hover-darken)]',
    chipSurface: 'bg-[var(--recessed-bg)]',
    /** 待办/已办 小 Tab */
    tabPillActive: 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]',
    tabPillIdle: 'text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-secondary)]',
    /** 头部/行内图标按钮 */
    iconBtn: 'text-[var(--text-tertiary)] hover:bg-[var(--active-darken)] hover:text-[var(--text-primary)]',
    iconBtnRow: 'text-[var(--text-tertiary)] hover:bg-[var(--active-darken)]',
    /** 文本按钮（全部已读） */
    textBtn: 'text-[var(--text-tertiary)] hover:bg-[var(--active-darken)] hover:text-[var(--text-primary)]',
    /** 中性小按钮（取消/驳回） */
    ghostBtn: 'text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]',
    /** 输入控件（忽略原因/驳回意见） */
    input: 'bg-[var(--recessed-bg)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:bg-[var(--recessed-bg-hover)]',
    /** 语义按钮 hover 加深（通过/驳回/确认忽略：statusSemanticClass 之上） */
    semanticBtnHover: 'hover:bg-[var(--active-darken)]',
    /** 开关关闭态轨道 */
    switchOff: 'bg-[var(--recessed-bg-strong)]',
  };

  // Context value — 仅暴露 Trigger 所需的最小状态，避免 stats 轮询导致全局 re-render
  const ctxValue = React.useMemo<NotificationContextValue>(() => ({
    isOpen,
    toggle: () => setIsOpen(open => !open),
    close: () => setIsOpen(false),
    unreadCount,
    criticalCount: stats?.critical ?? 0,
    isDarkMode,
  }), [isOpen, unreadCount, stats?.critical, isDarkMode]);

  return (
    <NotificationContext.Provider value={ctxValue}>
      {children}

      {/* ── 抽屉面板 ── */}
      {isOpen && (
        <>
          {/* 背景遮罩（点击关闭） */}
          <div
            className="fixed inset-0 z-[85] bg-[var(--mask-bg)] transition-opacity duration-300"
            onClick={() => setIsOpen(false)}
          />

          {/* 抽屉主体（跟随主题：dark=深膜 / light=亮膜，hairline 左边线分隔页面） */}
          {/* bds-ok: 通知抽屉面板宽度 420px，功能性固定面板宽，无刻度对应 */}
          <div
            ref={drawerRef}
            className={`bds-frosted fixed right-0 top-0 z-[90] flex h-full w-[26.25rem] flex-col overflow-hidden rounded-l-panel transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] text-[var(--text-primary)]
            `}
          >
            {/* ── 头部 ── */}
            <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-7">
              <div className="flex items-baseline gap-3">
                {view === 'prefs' && (
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className={`mr-1 flex h-7 w-7 items-center justify-center self-center rounded-full transition-colors ${ui.iconBtn}`}
                    aria-label="返回通知列表"
                  >
                    <ArrowLeft size={16} strokeWidth={1.5} />
                  </button>
                )}
                {view === 'prefs' ? (
                  <h2 className="text-lg font-light tracking-tight">提醒偏好</h2>
                ) : (
                  /* 通知 / 审批 Tab（PRD 19.21 通知与审批中心） */
                  <div className="flex items-baseline gap-4">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className={`text-lg tracking-tight transition-colors ${view === 'list' ? `font-light ${ui.title}` : `font-light ${ui.tabIdle}`}`}
                    >
                      通知
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('approvals')}
                      className={`text-lg tracking-tight transition-colors ${view === 'approvals' ? `font-light ${ui.title}` : `font-light ${ui.tabIdle}`}`}
                    >
                      审批
                    </button>
                  </div>
                )}
                {view === 'list' && hasUnread && (
                  <span className={`text-xs font-light ${ui.muted}`}>
                    {unreadCount} 条未读
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {view === 'list' && hasUnread && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className={`flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-light transition-colors ${ui.textBtn}`}
                    title="全部标记已读"
                  >
                    <CheckCheck size={14} strokeWidth={1.5} />
                    全部已读
                  </button>
                )}
                {view === 'list' && (
                  <button
                    type="button"
                    onClick={() => setView('prefs')}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${ui.iconBtn}`}
                    aria-label="提醒偏好设置"
                    title="提醒偏好设置"
                  >
                    <Settings2 size={16} strokeWidth={1.5} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${ui.iconBtn}`}
                  aria-label="关闭通知中心"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* ── D2 偏好面板 ── */}
            {view === 'prefs' && (
              <div className="flex-1 overflow-y-auto px-4 pb-6 scroll-smooth">
                <p className={`mb-3 px-2 text-xs font-light leading-relaxed ${ui.faint}`}>
                  关闭的类型将不再为你生成通知（不影响其他成员）。
                </p>
                {prefsLoading && !catalog ? (
                  <div className="flex h-40 items-center justify-center">
                    <div className={`text-sm font-light ${ui.faint}`}>加载中...</div>
                  </div>
                ) : !catalog || catalog.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <Bell size={24} strokeWidth={1.25} className={ui.iconEmpty} />
                    <div className={`text-sm font-light ${ui.faint}`}>暂无通知类型</div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {catalog.map((entry) => {
                      const Icon = TYPE_ICON_MAP[entry.type] || Info;
                      return (
                        <div
                          key={entry.type}
                          className={`flex items-center gap-3 rounded-control px-4 py-3 transition-colors duration-200 ${ui.rowHover}`}
                        >
                          <div className={`shrink-0 ${entry.isEnabled ? 'text-[var(--text-secondary)]' : (dk ? 'text-[var(--text-quaternary)]' : 'text-[var(--text-tertiary)]')}`}>
                            <Icon size={18} strokeWidth={1.25} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm ${entry.isEnabled ? `font-light ${ui.primary}` : `font-light ${ui.faint}`}`}>
                              {entry.label}
                            </div>
                            <div className={`mt-0.5 text-[10px] font-light ${ui.ghost}`}>
                              {entry.seenCount > 0 ? `已收到 ${entry.seenCount} 条` : '暂未收到过'}
                            </div>
                          </div>
                          {/* 开关 */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={entry.isEnabled}
                            aria-label={`${entry.label}通知开关`}
                            onClick={() => handleTogglePreference(entry.type, !entry.isEnabled)}
                            className={`relative h-5.5 w-10 shrink-0 rounded-full transition-colors duration-200
                              ${entry.isEnabled ? 'bg-link/70' : ui.switchOff}`}
                          >
                            <span
                              className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-[var(--on-accent)] transition-transform duration-200
                                ${entry.isEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── PRD 19.21 业务审批面板 ── */}
            {view === 'approvals' && (
              <div className="flex-1 overflow-y-auto px-4 pb-6 scroll-smooth">
                {/* 待办 / 已办 子视图 */}
                <div className="mb-3 flex items-center gap-1 px-2">
                  {(['pending', 'done'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setApprovalView(v)}
                      className={`rounded-control px-3 py-1.5 text-xs font-light transition-colors
                        ${approvalView === v ? ui.tabPillActive : ui.tabPillIdle}`}
                    >
                      {v === 'pending' ? '待办' : '已办'}
                    </button>
                  ))}
                </div>
                {approvalsLoading && !approvals ? (
                  <div className="flex h-40 items-center justify-center">
                    <div className={`text-sm font-light ${ui.faint}`}>加载中...</div>
                  </div>
                ) : approvalsError && !approvals ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <Stamp size={24} strokeWidth={1.25} className={ui.iconEmpty} />
                    <div className={`text-sm font-light ${ui.faint}`}>{approvalsError}</div>
                  </div>
                ) : !approvals || approvals.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <Stamp size={24} strokeWidth={1.25} className={ui.iconEmpty} />
                    <div className={`text-sm font-light ${ui.faint}`}>{approvalView === 'pending' ? '暂无待办审批' : '暂无已办记录'}</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {approvals.map((item) => {
                      const p = item.payload || {};
                      const isPriceDeviation = item.actionType === 'quotation:price-deviation';
                      const deciding = decidingId === item.id;
                      const rejecting = rejectingId === item.id;
                      return (
                        <div key={item.id} className={`rounded-card px-4 py-3.5 ${ui.card}`}>
                          {/* 标题行：上下文摘要 + 风险徽章 */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              {isPriceDeviation ? (
                                <>
                                  <div className={`text-sm font-light ${ui.primary}`}>
                                    报价单 {p.quotationNumber || item.targetId || ''} 双轨偏差审批
                                  </div>
                                  <div className={`mt-1 text-xs font-light leading-relaxed ${ui.muted}`}>
                                    轨道 A 中位 ${Number(p.trackAMedianUsd ?? 0).toFixed(4)}/{p.trackAUnit === 'PC' ? '件' : '米'}
                                    {' · '}轨道 B 终价 ${Number(p.trackBFinalUsd ?? 0).toFixed(4)}
                                    {' · '}偏差 <span className={p.level === 'block' ? statusSemanticText('danger', dk) : statusSemanticText('warning', dk)}>
                                      {(p.deviationPercent ?? 0) > 0 ? '+' : ''}{p.deviationPercent}%
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className={`text-sm font-light ${ui.primary}`}>{item.actionType}</div>
                                  <div className={`mt-1 text-xs font-light ${ui.muted}`}>
                                    {item.targetType}{item.targetId ? ` · ${item.targetId}` : ''}
                                  </div>
                                </>
                              )}
                              <div className={`mt-1.5 text-[10px] font-light ${ui.ghost}`}>
                                {item.requester?.displayName || item.requester?.email || '申请人'} · {formatRelativeTime(item.createdAt)}
                                {item.status !== 'pending' && item.reviewer && (
                                  <> · {item.status === 'approved' ? '由' : '被'} {item.reviewer.displayName || item.reviewer.email} {item.status === 'approved' ? '通过' : '驳回'}</>
                                )}
                              </div>
                              {/* 已办：决策意见 */}
                              {item.status !== 'pending' && item.decisionNote && (
                                <div className={`mt-1.5 rounded-control px-2.5 py-1.5 text-xs font-light ${ui.chipSurface} ${dk ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>
                                  审批意见：{item.decisionNote}
                                </div>
                              )}
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-light
                              ${item.status === 'approved' ? statusSemanticClass('success', dk)
                                : item.status === 'rejected' ? statusSemanticClass('danger', dk)
                                : item.risk === 'high' ? statusSemanticClass('danger', dk)
                                : statusSemanticClass('warning', dk)}`}>
                              {item.status === 'approved' ? '已通过'
                                : item.status === 'rejected' ? '已驳回'
                                : item.risk === 'high' ? '高风险' : '待审批'}
                            </span>
                          </div>
                          {/* 待办操作区 */}
                          {item.status === 'pending' && (
                            <div className="mt-3">
                              {rejecting ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={rejectNote}
                                    onChange={(e) => setRejectNote(e.target.value)}
                                    placeholder="驳回意见（必填）"
                                    rows={2}
                                    className={`w-full resize-none rounded-control px-3 py-2 text-xs font-light outline-none ${ui.input}`}
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={deciding || !rejectNote.trim()}
                                      onClick={() => handleDecideApproval(item, 'rejected')}
                                      className={`flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-light transition-colors ${ui.semanticBtnHover} disabled:opacity-40 ${statusSemanticClass('danger', dk)}`}
                                    >
                                      {deciding ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} strokeWidth={1.5} />}
                                      确认驳回
                                    </button>
                                    <button
                                      type="button"
                                      disabled={deciding}
                                      onClick={() => { setRejectingId(null); setRejectNote(''); }}
                                      className={`rounded-control px-3 py-1.5 text-xs font-light transition-colors ${ui.ghostBtn}`}
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={deciding}
                                    onClick={() => handleDecideApproval(item, 'approved')}
                                    className={`flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-light transition-colors ${ui.semanticBtnHover} disabled:opacity-40 ${statusSemanticClass('success', dk)}`}
                                  >
                                    {deciding ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={1.5} />}
                                    通过
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deciding}
                                    onClick={() => { setRejectingId(item.id); setRejectNote(''); }}
                                    className={`flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-light transition-colors disabled:opacity-40 bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)]`}
                                  >
                                    <X size={14} strokeWidth={1.5} />
                                    驳回
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── 列表 ── */}
            {view === 'list' && (
            <div className="flex-1 overflow-y-auto px-4 pb-6 scroll-smooth">
              {loading && items.length === 0 ? (
                <div className="flex h-40 items-center justify-center">
                  <div className={`text-sm font-light ${ui.faint}`}>加载中...</div>
                </div>
              ) : error ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2">
                  <AlertTriangle size={20} strokeWidth={1.25} className={statusSemanticText('danger', dk)} />
                  <div className={`text-sm font-light ${ui.muted}`}>{error}</div>
                  <button
                    type="button"
                    onClick={() => fetchItems()}
                    className={`mt-1 rounded-control px-3 py-1.5 text-xs font-light text-link hover:bg-[var(--active-darken)]`}
                  >
                    重试
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3">
                  <Bell size={24} strokeWidth={1.25} className={ui.iconEmpty} />
                  <div className={`text-sm font-light ${ui.faint}`}>暂无通知</div>
                </div>
              ) : (
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = TYPE_ICON_MAP[item.type] || Info;
                    const isUnread = !item.readAt;
                    const levelColor = levelColorFor(item.level, dk);
                    const levelBg = levelBgFor(item.level, dk);

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${item.title}（${isUnread ? '未读' : '已读'}）`}
                        onClick={() => handleItemClick(item)}
                        onKeyDown={(e) => {
                          // 仅当焦点在条目本体时响应；内部按钮/输入框的 Enter/Space 不冒泡触发跳转
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleItemClick(item);
                          }
                        }}
                        className={`group relative flex cursor-pointer items-start gap-3 rounded-control px-4 py-3.5 transition-colors duration-200
                          ${isUnread
                            ? `${levelBg} ${ui.rowHoverUnread}`
                            : ui.rowHover}
                        `}
                      >
                        {/* 未读标记条 */}
                        {isUnread && (
                          <span className={`absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${item.level === 'critical' ? statusSemanticBg('danger', dk) : 'bg-link'}`} />
                        )}

                        {/* 类型图标 */}
                        <div className={`mt-0.5 shrink-0 ${isUnread ? levelColor : ui.ghost}`}>
                          <Icon size={18} strokeWidth={1.25} />
                        </div>

                        {/* 内容 */}
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm leading-snug ${isUnread ? `font-normal ${ui.title}` : ui.readTitle}`}>
                            {item.title}
                          </div>
                          <div className={`mt-1 line-clamp-2 text-xs leading-relaxed ${isUnread ? ui.body : ui.readBody}`}>
                            {item.body}
                          </div>
                          <div className={`mt-1.5 flex items-center gap-1.5 text-[10px] font-light ${ui.ghost}`}>
                            {formatRelativeTime(item.createdAt)}
                            {/* 可跳转提示：点击整行跳转目标模块（onOpenLink → App 路由） */}
                            {item.link && (
                              <span className="flex items-center gap-0.5 text-link/80">
                                <ArrowRight size={14} strokeWidth={1.5} />
                                前往
                              </span>
                            )}
                          </div>
                          {/* D2 转跟进行内反馈 */}
                          {followUpFeedback[item.id] && (
                            <div className="mt-1 text-[10px] font-light text-link/80">
                              {followUpFeedback[item.id]}
                            </div>
                          )}
                          {/* PRD 7.1 忽略原因行内输入（必填） */}
                          {dismissingId === item.id && (
                            <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                autoFocus
                                value={dismissReason}
                                onChange={(e) => { setDismissReason(e.target.value); setDismissError(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleDismiss(item); if (e.key === 'Escape') { setDismissingId(null); setDismissReason(''); setDismissError(null); } }}
                                placeholder="忽略原因（必填，用于优化推送准确率）"
                                maxLength={500}
                                className={`w-full rounded-control px-2.5 py-1.5 text-xs font-light outline-none ${ui.input}`}
                              />
                              {dismissError && dismissingId === item.id && (
                                <div className={`text-[10px] font-light ${statusSemanticText('danger', dk)}`}>{dismissError}</div>
                              )}
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDismiss(item)}
                                  className={`rounded-control border px-2.5 py-1 text-[10px] font-light transition-colors ${ui.semanticBtnHover} ${statusSemanticClass('warning', dk)}`}
                                >
                                  确认忽略
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setDismissingId(null); setDismissReason(''); setDismissError(null); }}
                                  className={`rounded-control px-2.5 py-1 text-[10px] font-light transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]`}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 操作按钮（hover 显示） */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          {/* D2 转跟进：仅当 metadata 携带可解析的客户线索时显示 */}
                          {Boolean(item.metadata?.relationId || item.metadata?.orderId || item.metadata?.entityId) && !followUpFeedback[item.id] && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConvertToFollowUp(item);
                              }}
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:text-link ${ui.iconBtnRow}`}
                              title="转为跟进任务"
                            >
                              <UserPlus size={14} strokeWidth={1.5} />
                            </button>
                          )}
                          {isUnread && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(item.id);
                              }}
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${ui.iconBtnRow} hover:text-[var(--text-primary)]`}
                              title="标记已读"
                            >
                              <Check size={14} strokeWidth={1.5} />
                            </button>
                          )}
                          {/* PRD 7.1 忽略（需填原因） */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDismissingId(dismissingId === item.id ? null : item.id);
                              setDismissReason('');
                              setDismissError(null);
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${ui.iconBtnRow} hover:text-[var(--text-secondary)]`}
                            title="忽略（需填原因）"
                          >
                            <BellOff size={14} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${ui.iconBtnRow} ${dk ? 'hover:text-[var(--text-secondary)]' : 'hover:text-[var(--text-primary)]'}`}
                            title="删除"
                          >
                            <Trash2 size={14} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {/* R3：加载更多（已加载 < 服务端 total 时显示，offset 追加） */}
                  {items.length < itemsTotal && (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => fetchItems(items.length)}
                        disabled={loadingMore}
                        className={`rounded-control px-4 py-1.5 text-xs font-light transition-colors ${ui.ghostBtn} disabled:opacity-50`}
                      >
                        {loadingMore ? '加载中…' : `加载更多（已显示 ${items.length} / 共 ${itemsTotal} 条）`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </>
      )}
    </NotificationContext.Provider>
  );
}

export default NotificationCenter;
