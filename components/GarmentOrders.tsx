import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Scissors, Package, Ruler, Layers, CheckCircle2, Clock, ArrowRight, AlertCircle } from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import { apiService } from '../services/apiService';
import { getAuthState } from '../services/authService';
import type { Order, OrderLineLite, ProductionStep, BomItem, OrderStatusTransition } from '../types';

interface GarmentOrdersProps {
  isDarkMode?: boolean;
  onOrderTypeChange?: (type: 'fabric' | 'garment') => void;
  currentType?: 'fabric' | 'garment';
  orders?: Order[];
}

const STEP_LABELS: Record<ProductionStep['step'], string> = {
  cutting: '裁剪',
  sewing: '缝制',
  qc: '质检',
  packing: '包装',
  shipping: '出货',
};

const STEP_ICONS: Record<ProductionStep['step'], React.ReactNode> = {
  cutting: <Scissors size={12} />,
  sewing: <Layers size={12} />,
  qc: <CheckCircle2 size={12} />,
  packing: <Package size={12} />,
  shipping: <ArrowRight size={12} />,
};

const BOM_TYPE_LABELS: Record<string, string> = {
  fabric: '面料',
  lining: '里料',
  trim: '辅料',
  packaging: '包装',
};

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const GarmentOrders: React.FC<GarmentOrdersProps> = ({
  isDarkMode = false,
  onOrderTypeChange,
  currentType = 'garment',
  orders: propOrders,
}) => {
  const [orders, setOrders] = useState<Order[]>(propOrders ?? []);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<OrderStatusTransition[]>([]);
  const [loading, setLoading] = useState(!propOrders);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transitionBusy, setTransitionBusy] = useState<string | null>(null);

  // Load orders if not provided via props
  useEffect(() => {
    if (propOrders) { setOrders(propOrders); setLoading(false); return; }
    (async () => {
      try {
        const loaded = await apiService.listOrders();
        setOrders(loaded.filter((o: Order) => o.type === 'Garment' && !o.deletedAt));
        setLoadError(null);
      } catch (e: any) {
        // fail closed：加载失败必须显式呈现，禁止静默降级为"暂无数据"假空态
        setLoadError(e?.message || '订单加载失败');
      }
      setLoading(false);
    })();
  }, [propOrders]);

  // Load timeline for selected order（统一 apiService 通道：apiBase 解析 + 认证头）
  useEffect(() => {
    if (!selectedOrderId) { setTimeline([]); setTimelineError(null); return; }
    (async () => {
      try {
        const items = await apiService.getOrderTimeline(selectedOrderId);
        setTimeline(items);
        setTimelineError(null);
      } catch (e: any) {
        setTimeline([]);
        setTimelineError(e?.message || '状态时间线加载失败');
      }
    })();
  }, [selectedOrderId]);

  const garmentOrders = useMemo(
    () => orders.filter(o => o.type === 'Garment' && !o.deletedAt),
    [orders],
  );

  const selectedOrder = garmentOrders.find(o => o.id === selectedOrderId) ?? garmentOrders[0] ?? null;

  // Get the first line with garment extension data
  const garmentLine = useMemo((): (OrderLineLite & { sizeBreakdown?: Record<string, number> | null; productionSteps?: ProductionStep[] | null; styleNo?: string | null; colorName?: string | null; bomItems?: BomItem[] | null }) | null => {
    if (!selectedOrder?.lines?.length) return null;
    return selectedOrder.lines[0] as any;
  }, [selectedOrder]);

  const textPrimaryClass = 'text-[var(--text-primary)]';
  const textSecondaryClass = 'text-[var(--text-tertiary)]';
  // ── 主题自适应单配方（P2 收口）：暗色由 .dark 根 class + token 翻转承载，禁止 isDarkMode 三元拼类 ──
  const surfaceClass = 'bg-[var(--bg-card)] border-[var(--border-c-default)]';
  const orderCardActiveClass = 'bg-[var(--bg-card)] border-[var(--border-c-strong)] shadow-md';
  const orderCardIdleClass = 'bg-[var(--recessed-bg-strong)] border-[var(--border-c-default)] hover:bg-[var(--active-darken)]';
  const errorTextClass = 'text-[var(--danger-text)]';
  const progressTrackClass = 'bg-[var(--recessed-bg-strong)]';
  const sizeBarTrackClass = 'bg-[var(--recessed-bg)]';
  const connectorLineClass = 'bg-[var(--recessed-bg-strong)]';
  const statusBadgeClass: Partial<Record<Order['status'], string>> = {
    Delivered: 'border-success/30 text-success',
    Alert: 'border-danger/30 text-danger',
    Production: 'border-accent/30 text-accent',
  };
  const statusBadgeFallbackClass = 'border-warning/30 text-warning';
  const stepBadgeClass: Record<ProductionStep['status'], string> = {
    done: 'bg-[var(--success-tint)] border-success/30 text-[var(--success-text)]',
    in_progress: 'bg-[var(--warning-tint)] border-warning/30 text-[var(--warning-text)]',
    pending: 'bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-tertiary)]',
  };
  const stepConnectorDoneClass = 'bg-success/30';
  const bomTypeChipClass: Record<string, string> = {
    fabric: 'bg-[var(--accent-tint)] text-[var(--accent-text)]',
    lining: 'bg-[var(--accent-tint-light)] text-accent',
    trim: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  };
  const bomTypeChipFallbackClass = 'bg-[var(--wisteria-tint)] text-[var(--wisteria-text)]';

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className={cx('text-sm', textSecondaryClass)}>加载成衣订单...</div>
      </div>
    );
  }

  if (garmentOrders.length === 0) {
    return (
      <div className="w-full h-full flex flex-col bg-transparent overflow-hidden">
        <PageHeader
          title="成衣订单"
          subtitle="Garment Orders"
          isDarkMode={isDarkMode}
        />
        <div className="flex-1 flex items-center justify-center">
          {loadError ? (
            <div className={cx('flex items-center gap-2 text-sm', errorTextClass)}>
              <AlertCircle size={14} strokeWidth={1.5} />
              <span>订单加载失败：{loadError}</span>
            </div>
          ) : (
            <div className={cx('text-sm', textSecondaryClass)}>暂无成衣订单数据</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-hidden">
      {/* Title Bar */}
      <PageHeader
        title="成衣订单"
        subtitle="Garment Orders"
        contextLabel={`${garmentOrders.length} 笔`}
        isDarkMode={isDarkMode}
      />

      {/* Body */}
      <div className={`${BAMBOOK_OS.layout.desktopSinglePanelBodyClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass} gap-4`}>
        {/* Order List (left) */}
        <div className="w-full lg:w-[45%] min-w-0 flex flex-col gap-2 overflow-y-auto">
          {garmentOrders.map(order => {
            const isActive = selectedOrder?.id === order.id;
            const line = order.lines?.[0] as any;
            const steps = (line?.productionSteps as ProductionStep[] | null) ?? [];
            const doneSteps = steps.filter(s => s.status === 'done').length;
            const progress = steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0;

            return (
              <motion.button
                key={order.id}
                onClick={() => setSelectedOrderId(order.id)}
                className={cx(
                  'text-left rounded-inset border p-4 transition-all duration-200',
                  isActive ? orderCardActiveClass : orderCardIdleClass,
                )}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={cx('text-sm font-light truncate', textPrimaryClass)}>{order.customer}</div>
                    <div className={cx('text-[10px] mt-1 truncate', textSecondaryClass)}>
                      {order.poNumber} · {line?.styleNo || order.product}
                    </div>
                  </div>
                  <span className={cx(
                    'shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-light tracking-wide',
                    statusBadgeClass[order.status] ?? statusBadgeFallbackClass,
                  )}>
                    {order.status}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className={cx('flex justify-between text-[9px] mb-1', textSecondaryClass)}>
                    <span>生产进度</span>
                    <span>{progress}%</span>
                  </div>
                  <div className={cx('h-1 rounded-full overflow-hidden', progressTrackClass)}>
                    <div
                      className={cx(
                        'h-full rounded-full transition-all duration-500',
                        progress === 100 ? 'bg-emerald-500' : progress > 50 ? 'bg-blue-500' : 'bg-amber-500',
                      )}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Detail Panel (right) */}
        {selectedOrder && (
          <div className="w-full lg:w-[55%] min-w-0 flex flex-col gap-4 overflow-y-auto">
            {/* Header */}
            <div className={cx('rounded-inset border p-5', surfaceClass)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={cx('text-lg font-light', textPrimaryClass)}>{selectedOrder.customer}</div>
                  <div className={cx('text-[11px] mt-1', textSecondaryClass)}>
                    {selectedOrder.poNumber} · {(selectedOrder.lines?.[0] as any)?.styleNo || '—'} · {(selectedOrder.lines?.[0] as any)?.colorName || '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cx('text-sm font-light', textPrimaryClass)}>{selectedOrder.quantity} 件</div>
                  <div className={cx('text-[10px]', textSecondaryClass)}>
                    {selectedOrder.dueDate ? `交期 ${selectedOrder.dueDate}` : '无交期'}
                  </div>
                </div>
              </div>
            </div>

            {/* Status Actions */}
            <div className={cx('rounded-inset border p-4', surfaceClass)}>
              <div className={cx('mb-2 text-[10px] font-light uppercase tracking-widest', textSecondaryClass)}>当前状态: {selectedOrder.status}</div>
              {actionError && (
                <div className={cx('mb-2 flex items-center gap-1.5 text-[11px]', errorTextClass)}>
                  <AlertCircle size={12} strokeWidth={1.5} />
                  <span>{actionError}</span>
                </div>
              )}
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {(['Confirmed', 'Production', 'Shipping', 'Delivered'] as const)
                  .filter(st => st !== selectedOrder.status)
                  .map(st => (
                  <button
                    key={st}
                    disabled={transitionBusy !== null}
                    onClick={async () => {
                      if (transitionBusy) return;
                      setTransitionBusy(st);
                      setActionError(null);
                      try {
                        const authUser = getAuthState().user;
                        const operator = authUser?.displayName || authUser?.email || 'local-user';
                        const updated = await apiService.transitionOrderStatus(selectedOrder.id, st, operator);
                        setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
                      } catch (e: any) {
                        // fail closed：错误显式呈现，不伪成功
                        setActionError(e?.message || '状态变更失败');
                      } finally {
                        setTransitionBusy(null);
                      }
                    }}
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[10px] font-light uppercase tracking-wide transition-all hover:opacity-80 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ArrowRight size={10} strokeWidth={1.5} />
                    {transitionBusy === st ? '提交中…' : st}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Breakdown */}
            {garmentLine?.sizeBreakdown && (
              <div className={cx('rounded-inset border p-5', surfaceClass)}>
                <div className="flex items-center gap-2 mb-3">
                  <Ruler size={14} className="text-accent" />
                  <span className={cx('text-[10px] font-light uppercase tracking-widest', textSecondaryClass)}>尺码分配</span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(garmentLine.sizeBreakdown).map(([size, qty]) => {
                    const maxQty = Math.max(...Object.values(garmentLine.sizeBreakdown!));
                    const ratio = maxQty > 0 ? (qty as number) / maxQty : 0;
                    return (
                      <div key={size} className="flex flex-col items-center gap-1">
                        <span className={cx('text-[9px] font-light tracking-wide', textSecondaryClass)}>{size}</span>
                        <div className={cx('w-full h-16 rounded-control overflow-hidden flex items-end', sizeBarTrackClass)}>
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${ratio * 100}%` }}
                            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                            className={cx(
                              'w-full rounded-t-md',
                              'bg-accent/60',
                            )}
                          />
                        </div>
                        <span className={cx('text-xs font-light', textPrimaryClass)}>{qty as number}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Production Steps */}
            {garmentLine?.productionSteps && (
              <div className={cx('rounded-inset border p-5', surfaceClass)}>
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-warning" />
                  <span className={cx('text-[10px] font-light uppercase tracking-widest', textSecondaryClass)}>生产工序</span>
                </div>
                <div className="flex items-center gap-1">
                  {garmentLine.productionSteps.map((step, idx) => (
                    <React.Fragment key={step.step}>
                      <div className="flex flex-col items-center gap-1.5 min-w-[56px]">
                        <div className={cx(
                          'w-8 h-8 rounded-control flex items-center justify-center border transition-all',
                          stepBadgeClass[step.status] ?? stepBadgeClass.pending,
                        )}>
                          {STEP_ICONS[step.step]}
                        </div>
                        <span className={cx('text-[8px] font-light tracking-wide', textSecondaryClass)}>
                          {STEP_LABELS[step.step]}
                        </span>
                        {step.date && (
                          <span className={cx('text-[7px]', textSecondaryClass)}>{step.date}</span>
                        )}
                      </div>
                      {idx < garmentLine.productionSteps!.length - 1 && (
                        <div className={cx(
                          'flex-1 h-px min-w-[8px]',
                          step.status === 'done' ? stepConnectorDoneClass : connectorLineClass,
                        )} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* BOM */}
            {garmentLine?.bomItems && (
              <div className={cx('rounded-inset border p-5', surfaceClass)}>
                <div className="flex items-center gap-2 mb-3">
                  <Package size={14} className="text-[var(--wisteria-text)]" />
                  <span className={cx('text-[10px] font-light uppercase tracking-widest', textSecondaryClass)}>BOM 物料清单</span>
                </div>
                <div className="space-y-2">
                  {garmentLine.bomItems.map((item, idx) => (
                    <div key={idx} className={cx(
                      'flex items-center justify-between rounded-control px-3 py-2',
                      sizeBarTrackClass,
                    )}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cx(
                          'shrink-0 inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-light uppercase tracking-widest',
                          bomTypeChipClass[item.type] ?? bomTypeChipFallbackClass,
                        )}>
                          {BOM_TYPE_LABELS[item.type] || item.type}
                        </span>
                        <span className={cx('text-xs font-light truncate', textPrimaryClass)}>{item.name}</span>
                        {item.spec && <span className={cx('text-[9px]', textSecondaryClass)}>{item.spec}</span>}
                      </div>
                      <span className={cx('text-xs font-light shrink-0 ml-2', textPrimaryClass)}>
                        {item.qty} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Timeline */}
            {timeline.length > 0 && (
              <div className={cx('rounded-inset border p-5', surfaceClass)}>
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-success" />
                  <span className={cx('text-[10px] font-light uppercase tracking-widest', textSecondaryClass)}>状态时间线</span>
                </div>
                <div className="space-y-3">
                  {timeline.map((t, idx) => {
                    const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-CN') : '';
                    return (
                      <div key={t.id} className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div className={cx(
                            'w-2.5 h-2.5 rounded-full shrink-0 mt-1',
                            idx === timeline.length - 1 ? 'bg-success' : connectorLineClass,
                          )} />
                          {idx < timeline.length - 1 && (
                            <div className={cx('w-px h-4', connectorLineClass)} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cx('text-xs font-light', textPrimaryClass)}>
                              {t.fromStatus} → {t.toStatus}
                            </span>
                            <span className={cx('text-[9px]', textSecondaryClass)}>{dateStr}</span>
                          </div>
                          {t.note && <div className={cx('text-[10px] mt-0.5', textSecondaryClass)}>{t.note}</div>}
                          {t.operator && <div className={cx('text-[9px] mt-0.5', textSecondaryClass)}>by {t.operator}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GarmentOrders;
