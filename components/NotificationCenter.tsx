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
  MessageSquare, ClipboardList, Info, Settings2, ArrowLeft, UserPlus,
  Stamp, Loader2, AlertCircle,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { NotificationItem, NotificationStats, NotificationTypeCatalogItem, ApprovalRequestItem } from '../types';

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
const LEVEL_COLOR_MAP: Record<string, string> = {
  info: 'text-link',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

const LEVEL_BG_MAP: Record<string, string> = {
  info: 'bg-[rgb(var(--bambook-brand-link-rgb)/0.08)]',
  warning: 'bg-amber-400/8',
  critical: 'bg-red-400/10',
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

// ── 组件 ──
export interface NotificationCenterProps {
  isDarkMode?: boolean;
  endpoint?: string;
}

export function NotificationCenter({ isDarkMode = false, endpoint }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
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

  // ── 获取列表 ──
  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: list } = await apiService.listNotifications({ limit: 50, endpoint });
      setItems(list);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
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

  // ── D2 原生推送点击回跳：主进程聚焦窗口后回发 link，此处执行路由跳转 ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.bambookNotification) return;
    return window.bambookNotification.onOpenLink((link) => {
      if (link) window.location.hash = link;
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
      // 通过 hash 路由跳转
      window.location.hash = item.link;
      setIsOpen(false);
    }
  }, [handleMarkAsRead]);

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
      fetchApprovals();
    } catch (e: any) {
      setApprovalsError(String(e?.message || '决策失败'));
    } finally {
      setDecidingId(null);
    }
  }, [rejectNote, endpoint, fetchApprovals]);

  const hasUnread = unreadCount > 0;

  return (
    <>
      {/* ── 铃铛按钮 ── */}
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        aria-label={isOpen ? '关闭通知中心' : '打开通知中心'}
        className={`fixed right-6 top-6 z-[70] flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-xl transition-all duration-300
          ${isDarkMode
            ? 'bg-[rgb(var(--bambook-bg-deep-rgb)/0.45)] text-white/80 hover:bg-[rgb(var(--bambook-bg-deep-rgb)/0.6)] hover:text-white'
            : 'bg-[rgb(var(--bambook-bg-deep-rgb)/0.08)] text-deep/70 hover:bg-[rgb(var(--bambook-bg-deep-rgb)/0.14)] hover:text-deep'}
          ${isOpen ? 'scale-90 opacity-80' : 'scale-100'}
        `}
      >
        <Bell size={18} strokeWidth={1.4} />
        {/* 未读徽章 */}
        {hasUnread && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none text-white
              ${unreadCount > 99 ? 'bg-red-500' : unreadCount > 9 ? 'bg-red-500' : 'bg-red-500'}
              ${stats?.critical && stats.critical > 0 ? 'ring-2 ring-red-400/30' : ''}
            `}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {/* critical 脉冲提示 */}
        {stats?.critical && stats.critical > 0 && !isOpen && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-red-500/60" />
        )}
      </button>

      {/* ── 抽屉面板 ── */}
      {isOpen && (
        <>
          {/* 背景遮罩（点击关闭） */}
          <div
            className="fixed inset-0 z-[85] bg-black/10 backdrop-blur-[1px] transition-opacity duration-300"
            onClick={() => setIsOpen(false)}
          />

          {/* 抽屉主体 */}
          <div
            ref={drawerRef}
            className={`fixed right-0 top-0 z-[90] flex h-full w-[420px] flex-col overflow-hidden rounded-l-panel backdrop-blur-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
              ${isDarkMode
                ? 'bg-[rgb(var(--bambook-bg-deep-rgb)/0.82)] text-white/90'
                : 'bg-[rgb(var(--bambook-bg-deep-rgb)/0.88)] text-white/95'}
            `}
            style={{
              backdropFilter: 'blur(32px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
            }}
          >
            {/* ── 头部 ── */}
            <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-7">
              <div className="flex items-baseline gap-3">
                {view === 'prefs' && (
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className="mr-1 flex h-7 w-7 items-center justify-center self-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white/90"
                    aria-label="返回通知列表"
                  >
                    <ArrowLeft size={15} strokeWidth={1.5} />
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
                      className={`text-lg tracking-tight transition-colors ${view === 'list' ? 'font-light text-white/95' : 'font-light text-white/40 hover:text-white/70'}`}
                    >
                      通知
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('approvals')}
                      className={`text-lg tracking-tight transition-colors ${view === 'approvals' ? 'font-light text-white/95' : 'font-light text-white/40 hover:text-white/70'}`}
                    >
                      审批
                    </button>
                  </div>
                )}
                {view === 'list' && hasUnread && (
                  <span className="text-xs font-light text-white/50">
                    {unreadCount} 条未读
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {view === 'list' && hasUnread && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-light text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
                    title="全部标记已读"
                  >
                    <CheckCheck size={14} strokeWidth={1.4} />
                    全部已读
                  </button>
                )}
                {view === 'list' && (
                  <button
                    type="button"
                    onClick={() => setView('prefs')}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white/90"
                    aria-label="提醒偏好设置"
                    title="提醒偏好设置"
                  >
                    <Settings2 size={16} strokeWidth={1.5} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white/90"
                  aria-label="关闭通知中心"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* ── D2 偏好面板 ── */}
            {view === 'prefs' && (
              <div className="flex-1 overflow-y-auto px-4 pb-6 scroll-smooth">
                <p className="mb-3 px-2 text-[11px] font-light leading-relaxed text-white/40">
                  关闭的类型将不再为你生成通知（不影响其他成员）。
                </p>
                {prefsLoading && !catalog ? (
                  <div className="flex h-40 items-center justify-center">
                    <div className="text-sm font-light text-white/40">加载中...</div>
                  </div>
                ) : !catalog || catalog.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <Bell size={24} strokeWidth={1} className="text-white/20" />
                    <div className="text-sm font-light text-white/40">暂无通知类型</div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {catalog.map((entry) => {
                      const Icon = TYPE_ICON_MAP[entry.type] || Info;
                      return (
                        <div
                          key={entry.type}
                          className="flex items-center gap-3 rounded-control px-4 py-3 transition-colors duration-200 hover:bg-white/4"
                        >
                          <div className={`shrink-0 ${entry.isEnabled ? 'text-white/70' : 'text-white/25'}`}>
                            <Icon size={17} strokeWidth={1.3} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm ${entry.isEnabled ? 'font-light text-white/90' : 'font-light text-white/40'}`}>
                              {entry.label}
                            </div>
                            <div className="mt-0.5 text-[10px] font-light text-white/30">
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
                              ${entry.isEnabled ? 'bg-link/70' : 'bg-white/12'}`}
                          >
                            <span
                              className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-transform duration-200
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
                        ${approvalView === v ? 'bg-white/10 text-white/90' : 'text-white/40 hover:bg-white/5 hover:text-white/70'}`}
                    >
                      {v === 'pending' ? '待办' : '已办'}
                    </button>
                  ))}
                </div>
                {approvalsLoading && !approvals ? (
                  <div className="flex h-40 items-center justify-center">
                    <div className="text-sm font-light text-white/40">加载中...</div>
                  </div>
                ) : approvalsError && !approvals ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <Stamp size={24} strokeWidth={1} className="text-white/20" />
                    <div className="text-sm font-light text-white/40">{approvalsError}</div>
                  </div>
                ) : !approvals || approvals.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <Stamp size={24} strokeWidth={1} className="text-white/20" />
                    <div className="text-sm font-light text-white/40">{approvalView === 'pending' ? '暂无待办审批' : '暂无已办记录'}</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {approvals.map((item) => {
                      const p = item.payload || {};
                      const isPriceDeviation = item.actionType === 'quotation:price-deviation';
                      const deciding = decidingId === item.id;
                      const rejecting = rejectingId === item.id;
                      return (
                        <div key={item.id} className="rounded-card bg-white/4 px-4 py-3.5">
                          {/* 标题行：上下文摘要 + 风险徽章 */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              {isPriceDeviation ? (
                                <>
                                  <div className="text-sm font-light text-white/90">
                                    报价单 {p.quotationNumber || item.targetId || ''} 双轨偏差审批
                                  </div>
                                  <div className="mt-1 text-xs font-light leading-relaxed text-white/50">
                                    轨道 A 中位 ${Number(p.trackAMedianUsd ?? 0).toFixed(4)}/{p.trackAUnit === 'PC' ? '件' : '米'}
                                    {' · '}轨道 B 终价 ${Number(p.trackBFinalUsd ?? 0).toFixed(4)}
                                    {' · '}偏差 <span className={p.level === 'block' ? 'text-red-400' : 'text-amber-400'}>
                                      {(p.deviationPercent ?? 0) > 0 ? '+' : ''}{p.deviationPercent}%
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-sm font-light text-white/90">{item.actionType}</div>
                                  <div className="mt-1 text-xs font-light text-white/50">
                                    {item.targetType}{item.targetId ? ` · ${item.targetId}` : ''}
                                  </div>
                                </>
                              )}
                              <div className="mt-1.5 text-[10px] font-light text-white/30">
                                {item.requester?.displayName || item.requester?.email || '申请人'} · {formatRelativeTime(item.createdAt)}
                                {item.status !== 'pending' && item.reviewer && (
                                  <> · {item.status === 'approved' ? '由' : '被'} {item.reviewer.displayName || item.reviewer.email} {item.status === 'approved' ? '通过' : '驳回'}</>
                                )}
                              </div>
                              {/* 已办：决策意见 */}
                              {item.status !== 'pending' && item.decisionNote && (
                                <div className="mt-1.5 rounded-control bg-white/5 px-2.5 py-1.5 text-[11px] font-light text-white/55">
                                  审批意见：{item.decisionNote}
                                </div>
                              )}
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-light
                              ${item.status === 'approved' ? 'bg-emerald-400/10 text-emerald-300'
                                : item.status === 'rejected' ? 'bg-red-400/10 text-red-300'
                                : item.risk === 'high' ? 'bg-red-400/10 text-red-300'
                                : 'bg-amber-400/10 text-amber-300'}`}>
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
                                    className="w-full resize-none rounded-control bg-white/6 px-3 py-2 text-xs font-light text-white/90 placeholder-white/25 outline-none focus:bg-white/8"
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={deciding || !rejectNote.trim()}
                                      onClick={() => handleDecideApproval(item, 'rejected')}
                                      className="flex items-center gap-1.5 rounded-control bg-red-400/15 px-3 py-1.5 text-xs font-light text-red-300 transition-colors hover:bg-red-400/20 disabled:opacity-40"
                                    >
                                      {deciding ? <Loader2 size={12} className="animate-spin" /> : <AlertCircle size={12} strokeWidth={1.5} />}
                                      确认驳回
                                    </button>
                                    <button
                                      type="button"
                                      disabled={deciding}
                                      onClick={() => { setRejectingId(null); setRejectNote(''); }}
                                      className="rounded-control px-3 py-1.5 text-xs font-light text-white/50 transition-colors hover:bg-white/8"
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
                                    className="flex items-center gap-1.5 rounded-control bg-emerald-400/15 px-3 py-1.5 text-xs font-light text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:opacity-40"
                                  >
                                    {deciding ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={1.5} />}
                                    通过
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deciding}
                                    onClick={() => { setRejectingId(item.id); setRejectNote(''); }}
                                    className="flex items-center gap-1.5 rounded-control bg-white/6 px-3 py-1.5 text-xs font-light text-white/60 transition-colors hover:bg-white/10 disabled:opacity-40"
                                  >
                                    <X size={12} strokeWidth={1.5} />
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
                  <div className="text-sm font-light text-white/40">加载中...</div>
                </div>
              ) : error ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2">
                  <AlertTriangle size={20} strokeWidth={1.2} className="text-red-400/70" />
                  <div className="text-sm font-light text-white/50">{error}</div>
                  <button
                    type="button"
                    onClick={fetchItems}
                    className="mt-1 rounded-control px-3 py-1.5 text-xs font-light text-link hover:bg-white/10"
                  >
                    重试
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3">
                  <Bell size={24} strokeWidth={1} className="text-white/20" />
                  <div className="text-sm font-light text-white/40">暂无通知</div>
                </div>
              ) : (
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = TYPE_ICON_MAP[item.type] || Info;
                    const isUnread = !item.readAt;
                    const levelColor = LEVEL_COLOR_MAP[item.level] || 'text-link';
                    const levelBg = LEVEL_BG_MAP[item.level] || LEVEL_BG_MAP.info;

                    return (
                      <div
                        key={item.id}
                        onClick={() => handleItemClick(item)}
                        className={`group relative flex cursor-pointer items-start gap-3 rounded-control px-4 py-3.5 transition-colors duration-200
                          ${isUnread
                            ? `${levelBg} hover:bg-white/6`
                            : 'hover:bg-white/4'}
                        `}
                      >
                        {/* 未读标记条 */}
                        {isUnread && (
                          <span className={`absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${item.level === 'critical' ? 'bg-red-400' : 'bg-link'}`} />
                        )}

                        {/* 类型图标 */}
                        <div className={`mt-0.5 shrink-0 ${isUnread ? levelColor : 'text-white/30'}`}>
                          <Icon size={18} strokeWidth={1.3} />
                        </div>

                        {/* 内容 */}
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm leading-snug ${isUnread ? 'font-normal text-white/95' : 'font-light text-white/55'}`}>
                            {item.title}
                          </div>
                          <div className={`mt-1 line-clamp-2 text-xs leading-relaxed ${isUnread ? 'text-white/65' : 'text-white/35'}`}>
                            {item.body}
                          </div>
                          <div className="mt-1.5 text-[10px] font-light text-white/30">
                            {formatRelativeTime(item.createdAt)}
                          </div>
                          {/* D2 转跟进行内反馈 */}
                          {followUpFeedback[item.id] && (
                            <div className="mt-1 text-[10px] font-light text-link/80">
                              {followUpFeedback[item.id]}
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
                              className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-link"
                              title="转为跟进任务"
                            >
                              <UserPlus size={13} strokeWidth={1.5} />
                            </button>
                          )}
                          {isUnread && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(item.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                              title="标记已读"
                            >
                              <Check size={13} strokeWidth={1.5} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-red-400/80"
                            title="删除"
                          >
                            <Trash2 size={13} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default NotificationCenter;
