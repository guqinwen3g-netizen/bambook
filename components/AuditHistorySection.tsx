/**
 * 阶段 D / D6：AuditHistorySection — 实体变更历史通用面板
 *
 * 数据源：GET /api/v1/audit/entity?targetType&targetId（模块读权限门禁，最近 20 条倒序）。
 *
 * 设计哲学（与 RelatedEntitiesPanel 一致）：保持被动——只渲染服务端返回的审计记录，
 * 不在前端做权限预判；403 优雅降级为"无权限查看"提示而非报错。
 */

import React, { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { apiService } from '../services/apiService';
import type { EntityAuditLogItem } from '../types';

export interface AuditHistorySectionProps {
  /** AuditLog.targetType，如 "Order" / "Relation" / "Invoice" */
  targetType: string;
  /** AuditLog.targetId */
  targetId: string;
  /** 标题覆盖；默认 "变更历史" */
  title?: string;
  isDarkMode?: boolean;
  /** 宿主保存实体后 bump 触发重取 */
  refreshKey?: number;
}

/** 动作可读化（通用规则，非逐 action 字典）：create_/update_/delete_/cancel_ 前缀 → 创建/更新/删除/作废 */
function actionLabel(action: string): string {
  if (action.startsWith('create_')) return `创建 · ${action.slice(7)}`;
  if (action.startsWith('update_')) return `更新 · ${action.slice(7)}`;
  if (action.startsWith('delete_')) return `删除 · ${action.slice(7)}`;
  if (action.startsWith('cancel_')) return `作废 · ${action.slice(7)}`;
  return action;
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  } catch {
    return String(v);
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 摘要行：字段级审计优先（fieldPath: before → after），否则回退 action */
function summaryOf(log: EntityAuditLogItem): string {
  if (log.fieldPath) {
    return `${log.fieldPath}: ${valueText(log.beforeValue)} → ${valueText(log.afterValue)}`;
  }
  return actionLabel(log.action);
}

export const AuditHistorySection: React.FC<AuditHistorySectionProps> = ({
  targetType,
  targetId,
  title = '变更历史',
  isDarkMode = false,
  refreshKey = 0,
}) => {
  const [logs, setLogs] = useState<EntityAuditLogItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!targetType || !targetId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    apiService.getEntityAuditLogs(targetType, targetId)
      .then(items => {
        if (cancelled) return;
        setLogs(items);
      })
      .catch((err: any) => {
        if (cancelled) return;
        const msg = String(err?.message ?? err ?? '');
        if (msg.includes('403') || msg.includes('FORBIDDEN')) {
          setForbidden(true);
        } else {
          setError(msg || '加载失败');
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [targetType, targetId, refreshKey]);

  const containerStyle: React.CSSProperties = {
    border: `1px solid ${isDarkMode ? 'var(--bambook-gray-700)' : 'var(--bambook-gray-200)'}`,
    borderRadius: 12,
    background: isDarkMode ? 'var(--bambook-gray-900)' : 'var(--bambook-gray-50)',
    padding: 16,
  };

  const mutedColor = isDarkMode ? 'var(--bambook-gray-400)' : 'var(--bambook-gray-500)';

  return (
    <div style={containerStyle}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        color: isDarkMode ? 'var(--bambook-gray-200)' : 'var(--bambook-gray-900)',
        fontWeight: 600, fontSize: 14,
      }}>
        <History size={16} />
        <span>{title}</span>
        {logs && logs.length > 0 ? (
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: mutedColor }}>
            {logs.length} 条记录
          </span>
        ) : null}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: mutedColor, fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" />
          加载变更记录…
        </div>
      )}

      {forbidden && !loading && (
        <div style={{ color: mutedColor, fontSize: 13, fontStyle: 'italic' }}>
          当前角色无权限查看该模块的变更记录
        </div>
      )}

      {error && !loading && !forbidden && (
        <div
          className={isDarkMode ? 'text-red-400 bg-red-500/10' : 'text-red-600 bg-red-50'}
          style={{ fontSize: 13, padding: 8, borderRadius: 8 }}
        >
          变更记录加载失败：{error}
        </div>
      )}

      {!loading && !error && !forbidden && logs && logs.length === 0 && (
        <div style={{ color: mutedColor, fontSize: 13, fontStyle: 'italic' }}>
          暂无变更记录
        </div>
      )}

      {!loading && !error && !forbidden && logs && logs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {logs.map(log => (
            <div
              key={log.id}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                padding: '6px 10px',
                background: isDarkMode ? 'var(--bambook-gray-800)' : 'var(--bambook-gray-50)',
                border: `1px solid ${isDarkMode ? 'var(--bambook-gray-700)' : 'var(--bambook-gray-200)'}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <span style={{ color: mutedColor, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {formatTime(log.createdAt)}
              </span>
              <span style={{
                color: isDarkMode ? 'var(--bambook-gray-300)' : 'var(--bambook-gray-700)',
                whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 500,
              }}>
                {log.actor.displayName || log.actor.email || log.actor.id}
              </span>
              <span style={{
                color: isDarkMode ? 'var(--bambook-gray-200)' : 'var(--bambook-gray-900)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={summaryOf(log)}>
                {summaryOf(log)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditHistorySection;
