/**
 * OrderShipmentBatchPanel — P0-1 订单分批出运与尾款结算面板（订单详情内嵌）
 *
 * 设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P0-1
 * 服务契约：services/orderShipmentBatchService.ts（/api/v1/shipping/order-batches*）
 * schema 真源：server/prisma/schema.prisma model OrderShipmentBatch
 *
 * 核心交互：
 *   - 批次全景：计划占比/数量/金额 + 出运/结算双状态徽章 + 汇总进度条（出运批次进度、收款结算进度）
 *   - 批次登记（计划期）：占比/数量/金额（缺省按占比推导）+ 末批标记 + 尾款账期
 *   - 发运确认：排船回填（shipmentId 下拉取本订单运单）+ 尾款到期日计算 + 末批收款门禁（409 可豁免留痕）
 *   - 批次取消（仅 planned）/ 结算进度重算（发票分配/核销变动后手动触发）
 *
 * 状态机（双正交，与后端镜像）：
 *   status:       planned → shipped | cancelled（出运维度）
 *   settleStatus: unsettled → partially_settled → settled（财务维度，后端聚合派生）
 *
 * 设计：flat 无阴影、BDS 语义类、token 墨色（主题透明零 isDarkMode 分支）。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Loader2, Plus, RefreshCw, Ship } from 'lucide-react';
import {
  orderShipmentBatchService,
  type OrderBatchOverview,
  type OrderShipmentBatchView,
} from '../../services/orderShipmentBatchService';
import { shipmentService } from '../../services/shipmentService';
import type { Shipment } from '../../types';
import { formatYmd } from '../../lib/dateFormat';
import BottomSheet from '../ui/BottomSheet';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import CustomSelect from '../ui/CustomSelect';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const STATUS_LABELS: Record<string, string> = { planned: '待发运', shipped: '已发运', cancelled: '已取消' };
const SETTLE_LABELS: Record<string, string> = {
  unsettled: '未结算',
  partially_settled: '部分结算',
  settled: '已结清',
};

function statusBadgeClass(status: string): string {
  if (status === 'shipped') return 'bds-badge sm success';
  if (status === 'cancelled') return 'bds-badge sm neutral';
  return 'bds-badge sm warning';
}

function settleBadgeClass(settleStatus: string): string {
  if (settleStatus === 'settled') return 'bds-badge sm success';
  if (settleStatus === 'partially_settled') return 'bds-badge sm warning';
  return 'bds-badge sm neutral';
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

interface OrderShipmentBatchPanelProps {
  orderId: string;
  isDarkMode?: boolean;
}

export function OrderShipmentBatchPanel({ orderId, isDarkMode = false }: OrderShipmentBatchPanelProps) {
  const [overview, setOverview] = useState<OrderBatchOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  // 登记批次表单
  const [showCreate, setShowCreate] = useState(false);
  const [formRatio, setFormRatio] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formIsFinal, setFormIsFinal] = useState(true);
  const [formDueDays, setFormDueDays] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // 发运确认表单
  const [shipFor, setShipFor] = useState<OrderShipmentBatchView | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipShipmentId, setShipShipmentId] = useState('');
  const [shipShippedAt, setShipShippedAt] = useState('');
  const [shipGateError, setShipGateError] = useState<string | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-subtle)]';
  const cardBg = 'bg-[var(--recessed-bg)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await orderShipmentBatchService.listByOrder(orderId);
      setOverview(data);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => {
    // 末批智能缺省：订单内尚无有效末批 → 本批默认末批（首个批次单批整单出运场景）
    const hasFinal = (overview?.batches ?? []).some(b => b.isFinalBatch === true && b.status !== 'cancelled');
    setFormIsFinal(!hasFinal);
    setFormRatio(''); setFormQty(''); setFormUnit(''); setFormAmount(''); setFormDueDays(''); setFormNotes('');
    setShowCreate(true);
  }, [overview]);

  const submitCreate = useCallback(async () => {
    if (acting) return;
    const ratio = formRatio.trim() === '' ? undefined : Number(formRatio);
    const qty = formQty.trim() === '' ? undefined : Number(formQty);
    const amount = formAmount.trim() === '' ? undefined : Number(formAmount);
    const dueDays = formDueDays.trim() === '' ? undefined : Number(formDueDays);
    if (ratio != null && !Number.isFinite(ratio)) { bdsToast.warning('计划占比须为数字（如 30 表示 30%）。'); return; }
    if (qty != null && !Number.isFinite(qty)) { bdsToast.warning('计划数量须为数字。'); return; }
    if (amount != null && !Number.isFinite(amount)) { bdsToast.warning('批次金额须为数字。'); return; }
    if (dueDays != null && !Number.isFinite(dueDays)) { bdsToast.warning('尾款账期须为数字（天）。'); return; }
    if (ratio == null && qty == null && amount == null) {
      bdsToast.warning('计划占比 / 计划数量 / 批次金额 至少填一项。');
      return;
    }
    setActing('create');
    try {
      await orderShipmentBatchService.createBatch({
        orderId,
        plannedRatio: ratio,
        plannedQty: qty,
        unit: formUnit.trim() || undefined,
        amount,
        isFinalBatch: formIsFinal,
        finalPaymentDueDays: dueDays,
        notes: formNotes.trim() || undefined,
      });
      bdsToast.success('出运批次已登记。');
      setShowCreate(false);
      await load();
    } catch (e: any) {
      bdsToast.danger(`登记失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [acting, orderId, formRatio, formQty, formUnit, formAmount, formIsFinal, formDueDays, formNotes, load]);

  const openShip = useCallback(async (batch: OrderShipmentBatchView) => {
    setShipFor(batch);
    setShipShipmentId(batch.shipmentId ?? '');
    setShipShippedAt('');
    setShipGateError(null);
    setShipments([]);
    setShipmentsLoading(true);
    try {
      const list = await shipmentService.listShipments(undefined, { orderId });
      setShipments(list.filter(s => s.status !== 'Cancelled'));
    } catch {
      // 运单列表加载失败不阻断：已回填 shipmentId 的批次仍可确认发运
    } finally {
      setShipmentsLoading(false);
    }
  }, [orderId]);

  const submitShip = useCallback(async (skipGate = false) => {
    if (!shipFor || acting) return;
    const shipmentId = shipShipmentId || shipFor.shipmentId || '';
    if (!shipmentId) {
      bdsToast.warning('请选择出运单——发运确认须关联运单（排船回填）。');
      return;
    }
    setActing('ship');
    try {
      await orderShipmentBatchService.markShipped(shipFor.id, {
        shipmentId,
        ...(skipGate ? { skipGate: true } : {}),
        ...(shipShippedAt ? { shippedAt: new Date(`${shipShippedAt}T00:00:00Z`).getTime() } : {}),
      });
      bdsToast.success(skipGate
        ? `批次 #${shipFor.batchNo} 已豁免门禁确认发运（豁免已留痕审计）。`
        : `批次 #${shipFor.batchNo} 已确认发运。`);
      setShipFor(null);
      await load();
    } catch (e: any) {
      // 末批收款门禁拦截（fail-closed）：就地展示原因 + 豁免入口，不走 toast 转瞬即逝
      if (e?.code === 'FINAL_PAYMENT_GATE_BLOCKED') {
        setShipGateError(String(e?.message || e));
      } else {
        bdsToast.danger(`发运确认失败：${e?.message ?? e}`);
      }
    } finally {
      setActing(null);
    }
  }, [shipFor, shipShipmentId, shipShippedAt, acting, load]);

  const confirmSkipGate = useCallback(async () => {
    const ok = await bdsConfirm({
      title: '豁免末批收款门禁',
      body: '订单累计收款未达门禁线。确认豁免并确认发运？豁免操作将写入审计日志留痕（操作人 / 时间 / 豁免原因快照）。',
      danger: true,
    });
    if (!ok) return;
    await submitShip(true);
  }, [submitShip]);

  const cancelBatch = useCallback(async (batch: OrderShipmentBatchView) => {
    const ok = await bdsConfirm({
      title: `取消批次 #${batch.batchNo}`,
      body: '仅计划中的批次可取消；已发运批次不可取消（冲销走变更流程）。确认取消该批次？',
      danger: true,
    });
    if (!ok) return;
    setActing(`cancel-${batch.id}`);
    try {
      await orderShipmentBatchService.cancelBatch(batch.id);
      bdsToast.success(`批次 #${batch.batchNo} 已取消。`);
      await load();
    } catch (e: any) {
      bdsToast.danger(`取消失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [load]);

  const recalcBatch = useCallback(async (batch: OrderShipmentBatchView) => {
    setActing(`recalc-${batch.id}`);
    try {
      await orderShipmentBatchService.recalc(batch.id);
      bdsToast.success(`批次 #${batch.batchNo} 结算进度已重算。`);
      await load();
    } catch (e: any) {
      bdsToast.danger(`重算失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [load]);

  const chipCls = (active: boolean) => cx(
    'rounded-full border px-3 py-1 text-[11px] font-light transition-colors',
    active
      ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
      : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
  );

  const currency = overview?.order?.currency || overview?.batches[0]?.currency || '';
  // 发运确认下拉选项：本订单运单；已回填但不在列表（如列表加载失败）时补占位项保住已选值
  const shipmentOptions = (() => {
    const options = shipments.map(s => ({
      value: s.id,
      label: `${s.shipmentNumber}${s.atd ? ` · ATD ${s.atd}` : s.etd ? ` · ETD ${s.etd}` : ''}${s.vesselOrFlight ? ` · ${s.vesselOrFlight}` : ''}`,
    }));
    if (shipFor?.shipmentId && !shipments.some(s => s.id === shipFor.shipmentId)) {
      options.unshift({ value: shipFor.shipmentId, label: `已回填运单 ${shipFor.shipmentId}` });
    }
    return options;
  })();

  return (
    <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] p-4">
      {/* 面板头 */}
      <div className="flex items-center gap-2">
        <Ship size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>出运批次</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>ORDER BATCHES</span>
        <div className="ml-auto flex items-center gap-2">
          {overview && overview.summary.totalBatches > 0 && (
            <span className={cx('text-[10px] font-light tabular-nums', textFaint)}>
              {overview.summary.totalBatches} 批 · 已发运 {overview.summary.shippedBatches} · 已收款 {fmtMoney(overview.summary.totalPaid)}
            </span>
          )}
          <button type="button" onClick={openCreate} className="bds-btn bds-btn-secondary">
            <Plus size={14} strokeWidth={1.5} />登记批次
          </button>
        </div>
      </div>

      {/* 内容区 */}
      {loading && (
        <div className={cx('flex items-center gap-2 py-8 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" />加载出运批次…
        </div>
      )}
      {!loading && error && (
        <div className="bds-alert warning mt-3">
          <span className="text-xs font-light">出运批次加载失败：{error}</span>
        </div>
      )}
      {!loading && !error && overview && overview.batches.length === 0 && (
        <div className={cx('py-8 text-xs font-light', textFaint)}>
          本订单暂无出运批次 · 登记批次计划后，发运确认与尾款结算在此追踪
        </div>
      )}
      {!loading && !error && overview && overview.batches.length > 0 && (
        <>
          {/* 汇总进度条：出运批次进度 + 收款结算进度 */}
          <div className={cx('mt-3 grid grid-cols-1 gap-4 border-t pt-3 md:grid-cols-2', divider)}>
            <div>
              <div className="flex items-baseline justify-between">
                <span className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>出运批次进度 SHIPMENT</span>
                <span className={cx('text-[11px] font-light tabular-nums', textPrimary)}>
                  {overview.summary.shippedBatches}/{overview.summary.totalBatches} 批
                </span>
              </div>
              <div className="bds-progress mt-2">
                <div
                  className="fill"
                  style={{ width: `${overview.summary.totalBatches > 0 ? Math.round((overview.summary.shippedBatches / overview.summary.totalBatches) * 100) : 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>收款结算进度 SETTLEMENT</span>
                <span className={cx('text-[11px] font-light tabular-nums', textPrimary)}>
                  {fmtMoney(overview.summary.totalPaid)} / {fmtMoney(overview.orderAmount)}
                </span>
              </div>
              <div className={cx('bds-progress mt-2', overview.orderAmount > 0 && overview.summary.totalPaid >= overview.orderAmount - 1e-6 ? 'success' : '')}>
                <div
                  className="fill"
                  style={{ width: `${overview.orderAmount > 0 ? Math.min(100, Math.round((overview.summary.totalPaid / overview.orderAmount) * 100)) : 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className={cx('mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-light tabular-nums', textFaint)}>
            <span>订单额 {fmtMoney(overview.orderAmount)}{currency ? ` ${currency}` : ''}</span>
            <span>批次金额合计 {fmtMoney(overview.summary.totalPlannedAmount)}</span>
            <span>已开票 {fmtMoney(overview.summary.totalInvoiced)}</span>
            <span>已收款 {fmtMoney(overview.summary.totalPaid)}</span>
          </div>

          {/* 批次行 */}
          {overview.batches.map(b => {
            const isCancelled = b.status === 'cancelled';
            const progressPct = b.settleProgress != null ? Math.round(b.settleProgress * 100) : null;
            return (
              <div key={b.id} className={cx('mt-3 rounded-field border p-3', divider, cardBg, isCancelled && 'opacity-50')}>
                {/* 行头：批次号 + 双状态徽章 + 动作 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx('text-xs font-light tabular-nums', textPrimary)}>#{b.batchNo}</span>
                  {b.isFinalBatch === true && <span className="bds-badge sm info">末批</span>}
                  <span className={cx('bds-badge sm uppercase', statusBadgeClass(b.status))}>{STATUS_LABELS[b.status] ?? b.status}</span>
                  <span className={cx('bds-badge sm', settleBadgeClass(b.settleStatus))}>{SETTLE_LABELS[b.settleStatus] ?? b.settleStatus}</span>
                  {b.finalPaymentOverdue === true && <span className="bds-badge sm danger">尾款逾期</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {b.status === 'planned' && (
                      <>
                        <button type="button" disabled={acting !== null} onClick={() => openShip(b)} className="bds-btn bds-btn-ghost">
                          <Ship size={14} strokeWidth={1.5} />发运确认
                        </button>
                        <button type="button" disabled={acting !== null} onClick={() => cancelBatch(b)} className="bds-btn bds-btn-ghost">
                          {acting === `cancel-${b.id}` ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} strokeWidth={1.5} />}取消批次
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => recalcBatch(b)}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="结算进度重算（发票分配/核销变动后手动触发）"
                    >
                      {acting === `recalc-${b.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} strokeWidth={1.5} />}
                    </button>
                  </div>
                </div>

                {/* 计划明细 */}
                <div className={cx('mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-light tabular-nums', textSecondary)}>
                  {b.plannedRatio != null && <span>占比 {b.plannedRatio}%</span>}
                  {b.plannedQty != null && <span>数量 {b.plannedQty.toLocaleString()}{b.unit ? ` ${b.unit}` : ''}</span>}
                  <span>金额 {fmtMoney(b.amount)} {b.currency}</span>
                  {b.shipmentId && <span className={textFaint}>运单 {b.shipmentId}</span>}
                  {b.shippedAt != null && <span className={textFaint}>发运 {formatYmd(Number(b.shippedAt)) || '—'}</span>}
                </div>

                {/* 结算进度 + 尾款到期 */}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="min-w-40 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className={cx('text-[10px] font-light tabular-nums', textFaint)}>
                        已收 {fmtMoney(b.paidAmount)} / {fmtMoney(b.amount)}
                      </span>
                      <span className={cx('text-[10px] font-light tabular-nums', textFaint)}>{progressPct != null ? `${progressPct}%` : '—'}</span>
                    </div>
                    <div className={cx('bds-progress mt-1', b.settleStatus === 'settled' ? 'success' : '')}>
                      <div className="fill" style={{ width: `${progressPct ?? 0}%` }} />
                    </div>
                  </div>
                  {b.isFinalBatch === true && (
                    <div className={cx('text-[10px] font-light tabular-nums', b.finalPaymentOverdue === true ? 'text-[var(--danger-text)]' : textFaint)}>
                      尾款到期 {b.finalPaymentDueDate ?? '发运后计算'}
                      {b.outstandingAmount != null && b.outstandingAmount > 0 && ` · 未收 ${fmtMoney(b.outstandingAmount)} ${b.currency}`}
                    </div>
                  )}
                </div>
                {b.notes && <div className={cx('mt-1.5 text-[11px] font-light', textSecondary)}>{b.notes}</div>}
              </div>
            );
          })}
        </>
      )}

      {/* 登记批次 BottomSheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title="登记出运批次">
        <div className="space-y-4 px-6 py-5">
          <div className={cx('rounded-field border p-3 text-[11px] font-light leading-relaxed', divider, textSecondary)}>
            计划占比 / 计划数量 / 批次金额 至少填一项；金额缺省按「订单额 × 占比」推导。订单内尚无末批时，本批默认标记末批（单批整单出运场景）。
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>计划占比 %</label>
              <input value={formRatio} onChange={e => setFormRatio(e.target.value)} inputMode="decimal" placeholder="如 30" className="bds-input sm w-32" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>计划数量</label>
              <input value={formQty} onChange={e => setFormQty(e.target.value)} inputMode="decimal" placeholder="如 12000" className="bds-input sm w-36" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>单位</label>
              <input value={formUnit} onChange={e => setFormUnit(e.target.value)} placeholder="如 Meter" className="bds-input sm w-28" />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>批次金额（可选）</label>
              <input value={formAmount} onChange={e => setFormAmount(e.target.value)} inputMode="decimal" placeholder="缺省按占比推导" className="bds-input sm w-44" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>尾款账期（天，可选）</label>
              <input value={formDueDays} onChange={e => setFormDueDays(e.target.value)} inputMode="numeric" placeholder="缺省取订单账期" className="bds-input sm w-40" />
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>末批标记 *</label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setFormIsFinal(true)} className={chipCls(formIsFinal)}>末批（尾款锚点）</button>
              <button type="button" onClick={() => setFormIsFinal(false)} className={chipCls(!formIsFinal)}>非末批</button>
            </div>
            <p className={cx('mt-1.5 text-[10px] font-light', textFaint)}>
              末批发运触发收款门禁（尾款前款项收足方可放行）；同订单至多一批可标记末批。
            </p>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注</label>
            <input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="如 分两批出运，头批 60%" className="bds-input sm w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitCreate} className="bds-btn bds-btn-primary">
              {acting === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}登记
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* 发运确认 BottomSheet */}
      <BottomSheet isOpen={shipFor !== null} onClose={() => setShipFor(null)} title={`发运确认 · 批次 #${shipFor?.batchNo ?? ''}`}>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>出运单 *</label>
            {shipmentsLoading ? (
              <div className={cx('flex items-center gap-2 text-xs font-light', textFaint)}>
                <Loader2 size={14} className="animate-spin" />加载本订单出运单…
              </div>
            ) : shipmentOptions.length === 0 ? (
              <div className="bds-alert warning">
                <span className="text-xs font-light">本订单暂无可关联出运单——请先在「出运管理」创建出运单后再确认发运。</span>
              </div>
            ) : (
              <div className="relative w-full max-w-md">
                <CustomSelect
                  surface="field"
                  menuPortal
                  options={shipmentOptions}
                  value={shipShipmentId}
                  onChange={setShipShipmentId}
                  placeholder="选择出运单"
                />
              </div>
            )}
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>发运日期（可选）</label>
            <CapsuleDateInput value={shipShippedAt} onChange={setShipShippedAt} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="缺省取运单 ATD/当日" />
          </div>
          {shipFor?.isFinalBatch === true && (
            <div className="bds-alert warning">
              <span className="text-xs font-light">
                末批发运将校验收款门禁：订单累计已收须覆盖「订单额 − 末批金额」。确认发运后尾款到期日 = 发运日 + 账期。
              </span>
            </div>
          )}
          {shipGateError && (
            <div className="space-y-2">
              <div className="bds-alert danger">
                <span className="text-xs font-light">{shipGateError}</span>
              </div>
              <button type="button" disabled={acting !== null} onClick={confirmSkipGate} className="bds-btn bds-btn-danger">
                <AlertTriangle size={14} strokeWidth={1.5} />豁免门禁并确认发运（留痕审计）
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShipFor(null)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null || shipmentsLoading} onClick={() => submitShip(false)} className="bds-btn bds-btn-primary">
              {acting === 'ship' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.5} />}确认发运
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
