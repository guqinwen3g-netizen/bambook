import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../services/apiService';
import { statusSemanticClass, statusSemanticText } from './rdlBusinessStatusTokens';
import SidePanelContainer from './ui/SidePanelContainer';
import { createOrderUiSpec } from './order/orderUiSpec';

const cx = (...args: any[]) => args.filter(Boolean).join(' ');

interface ProdAlert {
  orderId: string;
  poNumber?: string;
  customer?: string;
  alertType: string;
  deadline: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface ProductionAlertsProps {
  isDarkMode?: boolean;
  onSelectOrder?: (orderId: string) => void;
}

/**
 * 列表页顶部生产预警条 — 紧凑可折叠通知，与订单域规范体系同源。
 *
 * 设计语境：这不是详情页分区面板，而是列表表格之上的临时预警通知，
 * 因此保持紧凑 padding（p-3）而非详情面板的 p-5。但所有颜色/文字/行元素
 * 走 orderUiSpec 配方 + statusSemanticClass 语义 token，确保与全域视觉一致。
 */
export const ProductionAlerts: React.FC<ProductionAlertsProps> = ({ isDarkMode = false, onSelectOrder }) => {
  const [alerts, setAlerts] = useState<ProdAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const spec = createOrderUiSpec(isDarkMode);

  // 统一 apiService 通道：apiBase 解析 + 认证头（原相对路径裸 fetch 在 Electron file:// 下必失败且静默）
  const fetchAlerts = useCallback(async () => {
    try {
      const items = await apiService.scanProductionAlerts();
      setAlerts(items);
      setLoadError(null);
    } catch (e: any) {
      // fail closed：扫描失败显式呈现，不静默吞错
      setLoadError(e?.message || '预警扫描失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAlerts(); const t = setInterval(fetchAlerts, 60000); return () => clearInterval(t); }, [fetchAlerts]);

  // R678⑥：loading 不再 return null 完全隐藏——渲染紧凑骨架占位条（与加载后面板同构单条高度，防布局跳动）
  if (loading) {
    return (
      <div
        className="mb-3 rounded-card border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] p-3 animate-pulse"
        aria-hidden="true"
        data-testid="production-alerts-skeleton"
      >
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 rounded-full bg-[var(--hover-darken)]" />
          <div className="h-3 w-44 rounded-full bg-[var(--hover-darken)]" />
          <div className="ml-auto h-3 w-8 rounded-full bg-[var(--hover-darken)]" />
        </div>
      </div>
    );
  }
  if (alerts.length === 0 && !loadError) return null;

  if (loadError) {
    return (
      <div className={cx('mb-3', spec.bannerDanger)}>
        <AlertCircle size={14} className="shrink-0" />
        <span>生产预警扫描失败：{loadError}</span>
      </div>
    );
  }

  const critical = alerts.filter(a => a.severity === 'critical').length;
  const high = alerts.filter(a => a.severity === 'high').length;
  const visibleCount = expanded ? alerts.length : Math.min(alerts.length, 3);

  // RDL 语义 token：critical→danger / high→warning / 其余→neutral（中性 opacity 驱动）
  const sevColor = (sev: string) => {
    if (sev === 'critical') return statusSemanticClass('danger', isDarkMode);
    if (sev === 'high') return statusSemanticClass('warning', isDarkMode);
    return statusSemanticClass('neutral', isDarkMode);
  };
  const sevLabel = (sev: string) => sev === 'critical' ? '紧急' : sev === 'high' ? '高' : '中';

  return (
    <SidePanelContainer
      isDarkMode={isDarkMode}
      materialRole="raisedCard"
      spotlight
      edgeFadeItem
      className="mb-3 overflow-hidden"
      contentClassName="relative z-10 p-3"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className={statusSemanticText('danger', isDarkMode)} />
          <span className={cx('text-[11px] font-light tracking-wide', spec.textSecondary)}>
            生产预警 ({critical} 紧急 / {high} 高)
          </span>
        </div>
        {expanded
          ? <ChevronUp size={14} className={spec.chevronColor} />
          : <ChevronDown size={14} className={spec.chevronColor} />}
      </button>

      <div className="mt-2 space-y-1.5">
        {alerts.slice(0, visibleCount).map((alert, idx) => (
          <div
            key={`${alert.orderId}-${idx}`}
            onClick={() => onSelectOrder?.(alert.orderId)}
            className={cx(
              'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] font-light transition-colors duration-200',
              spec.rowPillHover,
              sevColor(alert.severity),
            )}
          >
            <span className={cx('shrink-0 rounded-full border px-2 py-px text-[10px] font-light', sevColor(alert.severity))}>
              {sevLabel(alert.severity)}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate">{alert.message}</span>
            </div>
            <span className={cx('shrink-0 text-[10px]', spec.textFaint)}>{alert.customer || alert.orderId.slice(-8)}</span>
          </div>
        ))}
        {!expanded && alerts.length > 3 && (
          <div className={cx('pt-1 text-center text-[10px] font-light', spec.textFaint)}>
            +{alerts.length - 3} 更多预警...
          </div>
        )}
      </div>
    </SidePanelContainer>
  );
};
