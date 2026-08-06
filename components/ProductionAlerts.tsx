import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../services/apiService';

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

export const ProductionAlerts: React.FC<ProductionAlertsProps> = ({ isDarkMode = false, onSelectOrder }) => {
  const [alerts, setAlerts] = useState<ProdAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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

  if (loading) return null;
  if (alerts.length === 0 && !loadError) return null;

  if (loadError) {
    return (
      <div className={cx(
        'mb-3 flex items-center gap-2 rounded-card border p-3',
        isDarkMode ? 'bg-red-500/[0.06] border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600',
      )}>
        <AlertCircle size={14} className="shrink-0" />
        <span className="text-[11px] font-light tracking-wide">生产预警扫描失败：{loadError}</span>
      </div>
    );
  }

  const critical = alerts.filter(a => a.severity === 'critical').length;
  const high = alerts.filter(a => a.severity === 'high').length;
  const visibleCount = expanded ? alerts.length : Math.min(alerts.length, 3);

  const sevColor = (sev: string) => {
    if (sev === 'critical') return isDarkMode ? 'bg-red-500/15 text-red-400 border-red-500/20' : 'bg-red-50 text-red-600 border-red-200';
    if (sev === 'high') return isDarkMode ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' : 'bg-amber-50 text-amber-600 border-amber-200';
    return isDarkMode ? 'bg-white/5 text-white/60 border-white/10' : 'bg-slate-50 text-slate-600 border-slate-200';
  };
  const sevLabel = (sev: string) => sev === 'critical' ? '紧急' : sev === 'high' ? '高' : '中';

  return (
    <div className={cx(
      'mb-3 rounded-card border p-3',
      isDarkMode ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-white border-slate-200/60',
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className={isDarkMode ? 'text-red-400' : 'text-red-500'} />
          <span className={cx('text-[11px] font-light tracking-wide', isDarkMode ? 'text-white/70' : 'text-slate-700')}>
            生产预警 ({critical} 紧急 / {high} 高)
          </span>
        </div>
        {expanded ? <ChevronUp size={14} className={isDarkMode ? 'text-white/40' : 'text-slate-400'} />
          : <ChevronDown size={14} className={isDarkMode ? 'text-white/40' : 'text-slate-400'} />}
      </button>

      <div className="mt-2 space-y-1.5">
        {alerts.slice(0, visibleCount).map((alert, idx) => (
          <div
            key={`${alert.orderId}-${idx}`}
            onClick={() => onSelectOrder?.(alert.orderId)}
            className={cx(
              'flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1.5 transition-all hover:opacity-80',
              sevColor(alert.severity),
            )}
          >
            <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-normal uppercase tracking-wide">
              {sevLabel(alert.severity)}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-light">{alert.message}</span>
            </div>
            <span className="shrink-0 text-[10px] opacity-60">{alert.customer || alert.orderId.slice(-8)}</span>
          </div>
        ))}
        {!expanded && alerts.length > 3 && (
          <div className={cx('pt-1 text-center text-[10px]', isDarkMode ? 'text-white/30' : 'text-slate-400')}>
            +{alerts.length - 3} 更多预警...
          </div>
        )}
      </div>
    </div>
  );
};
