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
  MessageSquare, ClipboardList, Info,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { NotificationItem, NotificationStats } from '../types';

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
  const drawerRef = useRef<HTMLDivElement>(null);

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
                <h2 className="text-lg font-light tracking-tight">通知</h2>
                {hasUnread && (
                  <span className="text-xs font-light text-white/50">
                    {unreadCount} 条未读
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {hasUnread && (
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

            {/* ── 列表 ── */}
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
                        </div>

                        {/* 操作按钮（hover 显示） */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
          </div>
        </>
      )}
    </>
  );
}

export default NotificationCenter;
