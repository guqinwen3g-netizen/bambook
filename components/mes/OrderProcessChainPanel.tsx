/**
 * OrderProcessChainPanel — REQ2-05 面料工序级委外链面板（订单详情内嵌）
 *
 * 设计真源：docs/design/04-模块设计/03-订单与生产/ProductionBoard-生产看板/面料工序级委外链.md
 * DR-047：工序链 = 计划+成本核算层（外协单 = 执行单据层，可选关联不耦合）；
 *         加工费为成本口径（BOM/利润表消费），按产出量计费（染厂出缸量惯例）
 *
 * 核心交互：
 *   - 登记工序节点（序号/工序类型/承接工厂/投入量/单价）
 *   - 开工（planned → in_progress）→ 完工登记产出量（自动损耗率 + 金额重算）
 *   - 汇总头：N 道工序 · 完成 x/N · 累计损耗 y%（首道投入→末道产出）· 加工费合计
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Factory, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { apiService } from '../../services/apiService';
import type { OrderProcessNodeRow, OrderProcessChainSummary, Relation } from '../../types';
import BottomSheet from '../ui/BottomSheet';
import CustomSelect from '../ui/CustomSelect';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const PROCESS_TYPE_OPTIONS = [
  { value: 'gray_fabric', label: '坯布织造' },
  { value: 'dyeing', label: '染整' },
  { value: 'finishing', label: '后整理' },
  { value: 'coating', label: '涂层' },
  { value: 'other', label: '其他' },
] as const;
const TYPE_LABEL: Record<string, string> = Object.fromEntries(PROCESS_TYPE_OPTIONS.map(o => [o.value, o.label]));

function statusBadge(status: string): string {
  if (status === 'done') return 'bds-badge sm success';
  if (status === 'in_progress') return 'bds-badge sm warning';
  return 'bds-badge sm neutral';
}
const STATUS_LABEL: Record<string, string> = { planned: '待开工', in_progress: '进行中', done: '已完工' };

function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtAmount(n: number): string {
  return `¥${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface OrderProcessChainPanelProps {
  orderId: string;
  isDarkMode?: boolean;
  /** 供应商下拉数据源（Relation category='Supplier'） */
  relations?: Relation[];
}

export function OrderProcessChainPanel({ orderId, relations = [] }: OrderProcessChainPanelProps) {
  const [nodes, setNodes] = useState<OrderProcessNodeRow[]>([]);
  const [summary, setSummary] = useState<OrderProcessChainSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 登记表单
  const [showCreate, setShowCreate] = useState(false);
  const [formSeq, setFormSeq] = useState(1);
  const [formType, setFormType] = useState<string>('gray_fabric');
  const [formSupplier, setFormSupplier] = useState('');
  const [formInputQty, setFormInputQty] = useState('');
  const [formUnit, setFormUnit] = useState('M');
  const [formPrice, setFormPrice] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // 完工登记
  const [completeFor, setCompleteFor] = useState<OrderProcessNodeRow | null>(null);
  const [formOutputQty, setFormOutputQty] = useState('');
  const [formActualPrice, setFormActualPrice] = useState('');

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-subtle)]';
  const cardBg = 'bg-[var(--recessed-bg)]';

  const suppliers = relations.filter(r => r.category === 'Supplier' && !r.deletedAt);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.listOrderProcessChain(orderId);
      setNodes(data.nodes);
      setSummary(data.summary);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const submitCreate = useCallback(async () => {
    if (acting) return;
    const inputQty = Number(formInputQty);
    const unitPrice = Number(formPrice);
    if (!Number.isInteger(formSeq) || formSeq < 1) { bdsToast.warning('工序序号须为正整数。'); return; }
    if (!Number.isFinite(inputQty) || inputQty <= 0) { bdsToast.warning('投入量须为正数。'); return; }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) { bdsToast.warning('加工费单价须为非负数。'); return; }
    setActing('create');
    try {
      await apiService.createOrderProcessNode({
        orderId,
        seq: formSeq,
        processType: formType,
        supplierId: formSupplier || undefined,
        inputQty,
        unit: formUnit,
        unitPrice,
        notes: formNotes || undefined,
      });
      bdsToast.success(`工序 ${formSeq}（${TYPE_LABEL[formType]}）已登记。`);
      setShowCreate(false);
      setFormSeq(nodes.length + 1); setFormType('gray_fabric'); setFormSupplier(''); setFormInputQty(''); setFormPrice(''); setFormNotes('');
      await load();
    } catch (e: any) {
      bdsToast.danger(`登记失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [acting, orderId, formSeq, formType, formSupplier, formInputQty, formUnit, formPrice, formNotes, nodes.length, load]);

  const startNode = useCallback(async (n: OrderProcessNodeRow) => {
    if (acting) return;
    setActing(`start-${n.id}`);
    try {
      await apiService.startOrderProcessNode(n.id);
      bdsToast.success(`工序 ${n.seq}（${TYPE_LABEL[n.processType] ?? n.processType}）已开工。`);
      await load();
    } catch (e: any) {
      bdsToast.danger(`开工失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [acting, load]);

  const submitComplete = useCallback(async () => {
    if (!completeFor || acting) return;
    const outputQty = Number(formOutputQty);
    if (!Number.isFinite(outputQty) || outputQty <= 0) { bdsToast.warning('产出量须为正数。'); return; }
    if (outputQty > Number(completeFor.inputQty)) { bdsToast.warning(`产出量不可超过投入量 ${completeFor.inputQty}。`); return; }
    setActing('complete');
    try {
      const r = await apiService.completeOrderProcessNode(completeFor.id, {
        outputQty,
        actualUnitPrice: formActualPrice ? Number(formActualPrice) : undefined,
      });
      bdsToast.success(`工序 ${completeFor.seq} 完工：损耗 ${r.lossPct}%，金额 ${fmtAmount(Number(r.node.amount))}。`);
      setCompleteFor(null); setFormOutputQty(''); setFormActualPrice('');
      await load();
    } catch (e: any) {
      bdsToast.danger(`完工登记失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [completeFor, acting, formOutputQty, formActualPrice, load]);

  const removeNode = useCallback(async (n: OrderProcessNodeRow) => {
    const ok = await bdsConfirm({ title: '删除工序节点', body: `确认删除工序 ${n.seq}（${TYPE_LABEL[n.processType] ?? n.processType}）？仅待开工状态可删除。`, danger: true });
    if (!ok) return;
    setActing(`del-${n.id}`);
    try {
      await apiService.deleteOrderProcessNode(n.id);
      bdsToast.success('已删除。');
      await load();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message ?? e}`);
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

  return (
    <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] p-4">
      {/* 面板头 */}
      <div className="flex items-center gap-2">
        <Factory size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>工序委外链</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>PROCESS CHAIN</span>
        <div className="ml-auto flex items-center gap-2">
          {summary && (
            <span className={cx('text-[10px] font-light tabular-nums', textFaint)}>
              {summary.total} 道工序 · 完成 {summary.done}/{summary.total}
              {summary.cumulativeLossPct != null ? ` · 累计损耗 ${summary.cumulativeLossPct}%` : ''}
              {summary.totalAmount > 0 ? ` · 加工费 ${fmtAmount(summary.totalAmount)}` : ''}
            </span>
          )}
          <button type="button" onClick={() => { setFormSeq(nodes.length + 1); setShowCreate(true); }} className="bds-btn bds-btn-secondary">
            <Plus size={14} strokeWidth={1.5} />登记工序
          </button>
        </div>
      </div>

      {loading && (
        <div className={cx('flex items-center gap-2 py-8 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" />加载工序链…
        </div>
      )}
      {!loading && error && (
        <div className="bds-alert warning mt-3">
          <span className="text-xs font-light">工序链加载失败：{error}</span>
        </div>
      )}
      {!loading && !error && nodes.length === 0 && (
        <div className={cx('py-8 text-xs font-light', textFaint)}>
          本订单暂无工序链 · 登记坯布→染整→后整理（→涂层）各环节投入产出与加工费
        </div>
      )}

      {/* 工序链卡片流 */}
      {!loading && !error && nodes.map((n, idx) => {
        const lossPct = n.outputQty != null
          ? Math.round(((Number(n.inputQty) - Number(n.outputQty)) / Number(n.inputQty)) * 10000) / 100
          : null;
        const estimate = n.status !== 'done';
        return (
          <div key={n.id}>
            <div className={cx('mt-3 rounded-field border p-3', divider, cardBg)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('text-xs font-light tabular-nums', textPrimary)}>{n.seq}</span>
                <span className="bds-badge sm neutral">{TYPE_LABEL[n.processType] ?? n.processType}</span>
                <span className={cx('bds-badge sm uppercase', statusBadge(n.status))}>{STATUS_LABEL[n.status]}</span>
                {n.supplierName && <span className={cx('text-[11px] font-light', textSecondary)}>{n.supplierName}</span>}
                <span className={cx('ml-auto text-[11px] font-light tabular-nums', textPrimary)}>
                  {fmtAmount(Number(n.amount))}{estimate ? <span className={textFaint}>（预估）</span> : null}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-light tabular-nums">
                <span className={textSecondary}>投入 {fmtQty(Number(n.inputQty))} {n.unit}</span>
                <ArrowRight size={14} strokeWidth={1.5} className={textFaint} />
                <span className={textSecondary}>产出 {n.outputQty != null ? `${fmtQty(Number(n.outputQty))} ${n.unit}` : '—'}</span>
                {lossPct != null && (
                  <span className={cx(lossPct > 5 ? 'bds-badge sm warning' : 'bds-badge sm neutral')}>损耗 {lossPct}%</span>
                )}
                <span className={textFaint}>单价 {Number(n.unitPrice).toFixed(2)}/{n.unit}</span>
                {n.notes && <span className={textFaint}>{n.notes}</span>}
                <div className="ml-auto flex items-center gap-1.5">
                  {n.status === 'planned' && (
                    <>
                      <button type="button" disabled={acting !== null} onClick={() => startNode(n)} className="bds-btn bds-btn-ghost">
                        <Play size={14} strokeWidth={1.5} />开工
                      </button>
                      <button type="button" disabled={acting !== null} onClick={() => removeNode(n)} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </>
                  )}
                  {n.status !== 'done' && (
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => { setCompleteFor(n); setFormOutputQty(''); setFormActualPrice(''); }}
                      className="bds-btn bds-btn-ghost"
                    >
                      <CheckCircle2 size={14} strokeWidth={1.5} />完工登记
                    </button>
                  )}
                </div>
              </div>
            </div>
            {/* 链路连接线（最后一道不渲染） */}
            {idx < nodes.length - 1 && (
              <div className="ml-4 h-2 w-px" style={{ background: 'var(--border-c-subtle)' }} />
            )}
          </div>
        );
      })}

      {/* 登记工序 BottomSheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title="登记工序节点">
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>工序序号 *</label>
              <input
                type="number" min={1} value={formSeq}
                onChange={e => setFormSeq(Number(e.target.value))}
                className="bds-input sm w-20"
              />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>单位 *</label>
              <div className="flex gap-1.5">
                {['M', 'YD', 'KG'].map(u => (
                  <button key={u} type="button" onClick={() => setFormUnit(u)} className={chipCls(formUnit === u)}>{u}</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>工序类型 *</label>
            <div className="flex flex-wrap gap-1.5">
              {PROCESS_TYPE_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setFormType(o.value)} className={chipCls(formType === o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>承接工厂</label>
            <CustomSelect
              surface="form"
              className="w-full"
              ariaLabel="选择承接工厂"
              value={formSupplier}
              onChange={v => setFormSupplier(v)}
              options={[
                { value: '', label: '未指定（后补）' },
                ...suppliers.map(s => ({
                  value: s.id,
                  label: `${s.chineseName || s.name}${s.name && s.chineseName && s.name !== s.chineseName ? ` (${s.name})` : ''}`,
                })),
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>投入量 *（{formUnit}）</label>
              <input value={formInputQty} onChange={e => setFormInputQty(e.target.value)} placeholder="如 10500" inputMode="decimal" className="bds-input sm w-36" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>加工费单价 *（CNY/{formUnit}）</label>
              <input value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder="按产出量计费" inputMode="decimal" className="bds-input sm w-44" />
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注</label>
            <input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="如 21S/2 环锭纺白坯" className="bds-input sm w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitCreate} className="bds-btn bds-btn-primary">
              {acting === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}登记
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* 完工登记 BottomSheet */}
      <BottomSheet isOpen={completeFor !== null} onClose={() => setCompleteFor(null)} title={`完工登记 · 工序 ${completeFor?.seq ?? ''}（${completeFor ? TYPE_LABEL[completeFor.processType] : ''}）`}>
        <div className="space-y-4 px-6 py-5">
          <div className={cx('text-[11px] font-light tabular-nums', textSecondary)}>
            投入量 {completeFor ? fmtQty(Number(completeFor.inputQty)) : '—'} {completeFor?.unit} · 计划单价 {completeFor ? Number(completeFor.unitPrice).toFixed(2) : '—'} CNY
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>产出量 *（{completeFor?.unit ?? 'M'}）</label>
              <input value={formOutputQty} onChange={e => setFormOutputQty(e.target.value)} placeholder="实际出缸/成品量" inputMode="decimal" className="bds-input sm w-40" autoFocus />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>实际单价（CNY，留空按计划）</label>
              <input value={formActualPrice} onChange={e => setFormActualPrice(e.target.value)} placeholder={completeFor ? String(Number(completeFor.unitPrice)) : ''} inputMode="decimal" className="bds-input sm w-40" />
            </div>
          </div>
          {formOutputQty && completeFor && Number(formOutputQty) <= Number(completeFor.inputQty) && (
            <div className={cx('text-[11px] font-light tabular-nums', textSecondary)}>
              预计损耗 {((Number(completeFor.inputQty) - Number(formOutputQty)) / Number(completeFor.inputQty) * 100).toFixed(2)}% ·
              金额 {(Number(formOutputQty) * (formActualPrice ? Number(formActualPrice) : Number(completeFor.unitPrice))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CNY
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCompleteFor(null)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitComplete} className="bds-btn bds-btn-primary">
              {acting === 'complete' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.5} />}确认完工
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
