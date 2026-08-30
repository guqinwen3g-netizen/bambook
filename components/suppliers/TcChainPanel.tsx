/**
 * TcChainPanel — REQ2-06 GRS TC 交易证书链面板（订单详情内嵌）
 *
 * 设计真源：docs/design/04-模块设计/06-资源与支撑/Suppliers-供应商/GRS-TC交易证书链.md
 * DR-048：TC 与资质认证分轨；三段链 stage 枚举 + 段位聚合勾稽；
 *         一键校验四检查项（链完整性/段间吨位/订单用量/有效期）——出货门禁消费方调用
 *
 * 核心交互：
 *   - 三段泳道视图（原料 TC → 工厂 TC → 我方 TC：证书号 + 吨位 + 对手方 + 效期徽章）
 *   - 「一键校验」→ verify 结果面板（缺链红标 / 吨位预警黄标 / verdict 徽章）
 *   - 登记 BottomSheet（三段 chips + 吨位 + 证书号 + 对手方下拉）
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { hasPermission } from '../../services/authService';
import type { TcCertificateRow, TcStage, TcChainVerification, Relation } from '../../types';
import BottomSheet from '../ui/BottomSheet';
import CustomSelect from '../ui/CustomSelect';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const STAGE_OPTIONS: Array<{ value: TcStage; label: string; hint: string }> = [
  { value: 'material_input', label: '原料 TC', hint: '上游供应商 → 工厂' },
  { value: 'factory_output', label: '工厂 TC', hint: '工厂 → 我方' },
  { value: 'our_sale', label: '我方 TC', hint: '我方 → 客户' },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGE_OPTIONS.map(o => [o.value, o.label]));

function fmtKg(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

interface TcChainPanelProps {
  orderId: string;
  isDarkMode?: boolean;
  /** 交易对手下拉数据源（供应商 Relation） */
  relations?: Relation[];
}

export function TcChainPanel({ orderId, isDarkMode = false, relations = [] }: TcChainPanelProps) {
  // R6：登记/删除 TC 走 /tc-certificates 写端点（suppliers:write scope 门），无权限隐藏写入口
  const canWrite = hasPermission('suppliers:write');
  const [items, setItems] = useState<TcCertificateRow[]>([]);
  const [byStage, setByStage] = useState<Array<{ stage: TcStage; label: string; count: number; totalKg: number }>>([]);
  const [verification, setVerification] = useState<TcChainVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 登记表单
  const [showCreate, setShowCreate] = useState(false);
  const [formStage, setFormStage] = useState<TcStage>('material_input');
  const [formTcNo, setFormTcNo] = useState('');
  const [formKg, setFormKg] = useState('');
  const [formRelation, setFormRelation] = useState('');
  const [formIssued, setFormIssued] = useState('');
  const [formValid, setFormValid] = useState('');

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-subtle)]';
  const cardBg = 'bg-[var(--recessed-bg)]';

  const counterparties = relations.filter(r => !r.deletedAt);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.listTcCertificates({ orderId });
      setItems(data.items);
      setByStage(data.byStage);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const runVerify = useCallback(async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      setVerification(await apiService.verifyTcChain(orderId));
    } catch (e: any) {
      bdsToast.danger(`校验失败：${e?.message ?? e}`);
    } finally {
      setVerifying(false);
    }
  }, [orderId, verifying]);

  const submitCreate = useCallback(async () => {
    if (acting) return;
    const tcNo = formTcNo.trim();
    const kg = Number(formKg);
    if (!tcNo) { bdsToast.warning('证书编号必填。'); return; }
    if (!Number.isFinite(kg) || kg <= 0) { bdsToast.warning('吨位须为正数（公斤）。'); return; }
    setActing('create');
    try {
      await apiService.createTcCertificate({
        orderId,
        stage: formStage,
        tcNo,
        quantityKg: kg,
        relationId: formRelation || undefined,
        issuedAt: formIssued || undefined,
        validUntil: formValid || undefined,
      });
      bdsToast.success(`${STAGE_LABEL[formStage]} ${tcNo} 已登记。`);
      setShowCreate(false);
      setFormTcNo(''); setFormKg(''); setFormRelation(''); setFormIssued(''); setFormValid('');
      setVerification(null); // 数据变更后旧校验失效
      await load();
    } catch (e: any) {
      bdsToast.danger(`登记失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [acting, orderId, formStage, formTcNo, formKg, formRelation, formIssued, formValid, load]);

  const removeTc = useCallback(async (t: TcCertificateRow) => {
    const ok = await bdsConfirm({ title: '删除 TC 证书', body: `确认删除 ${STAGE_LABEL[t.stage]} ${t.tcNo}（${fmtKg(Number(t.quantityKg))}）？`, danger: true });
    if (!ok) return;
    setActing(`del-${t.id}`);
    try {
      await apiService.deleteTcCertificate(t.id);
      bdsToast.success('已删除。');
      setVerification(null);
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

  const today = new Date().toISOString().slice(0, 10);
  const stageItems = (s: TcStage) => items.filter(t => t.stage === s);

  return (
    <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] p-4">
      {/* 面板头 */}
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>GRS TC 证书链</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>TC CHAIN</span>
        <div className="ml-auto flex items-center gap-2">
          {byStage.length === 3 && (
            <span className={cx('text-[10px] font-light tabular-nums', textFaint)}>
              原料 {byStage[0].totalKg.toLocaleString()} / 工厂 {byStage[1].totalKg.toLocaleString()} / 我方 {byStage[2].totalKg.toLocaleString()} kg
            </span>
          )}
          <button type="button" disabled={verifying} onClick={runVerify} className="bds-btn bds-btn-ghost">
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} strokeWidth={1.5} />}一键校验
          </button>
          {canWrite && (
            <button type="button" onClick={() => setShowCreate(true)} className="bds-btn bds-btn-secondary">
              <Plus size={14} strokeWidth={1.5} />登记 TC
            </button>
          )}
        </div>
      </div>

      {/* 校验结果面板（出货门禁前一键校验——验收锚点①） */}
      {verification && (
        <div className={cx('mt-3 rounded-field border p-3', divider,
          verification.verdict === 'complete' ? 'border-[var(--status-success-border,var(--border-c-default))]' : '')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`bds-badge sm ${verification.verdict === 'complete' ? 'success' : 'warning'}`}>
              {verification.verdict === 'complete' ? '链条完整 可清关' : '存在风险 需处理'}
            </span>
            <span className={cx('text-[11px] font-light tabular-nums', textSecondary)}>
              {verification.tcCount} 张 TC · 原料 {fmtKg(verification.byStage.materialKg)} → 工厂 {fmtKg(verification.byStage.factoryKg)} → 我方 {fmtKg(verification.byStage.ourKg)}
            </span>
          </div>
          {(verification.missingStages.length > 0 || verification.tonnageWarnings.length > 0 || verification.orderUsage.warning || verification.expiredTc.length > 0) && (
            <div className="mt-2 space-y-1.5">
              {verification.missingStages.length > 0 && (
                <div className="bds-alert danger">
                  <span className="text-xs font-light">缺链：{verification.missingStages.map(s => s.label).join('、')}未登记（GRS 出口欧盟 TC 链须三段闭环）</span>
                </div>
              )}
              {verification.tonnageWarnings.map((w, i) => (
                <div key={i} className="bds-alert warning">
                  <span className="text-xs font-light">{w}</span>
                </div>
              ))}
              {verification.orderUsage.warning && (
                <div className="bds-alert warning">
                  <span className="text-xs font-light">订单用量勾稽：{verification.orderUsage.warning}</span>
                </div>
              )}
              {verification.expiredTc.length > 0 && (
                <div className="bds-alert warning">
                  <span className="text-xs font-light">已过期：{verification.expiredTc.map(t => `${t.tcNo}（${t.validUntil}）`).join('、')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className={cx('flex items-center gap-2 py-8 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" />加载 TC 链…
        </div>
      )}
      {!loading && error && (
        <div className="bds-alert warning mt-3">
          <span className="text-xs font-light">TC 链加载失败：{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className={cx('py-8 text-xs font-light', textFaint)}>
          本订单暂无 TC 证书 · GRS 再生订单出口欧盟须登记「原料 TC → 工厂 TC → 我方 TC」三段链
        </div>
      )}

      {/* 三段泳道 */}
      {!loading && !error && items.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {STAGE_OPTIONS.map(so => {
            const stageList = stageItems(so.value);
            const summary = byStage.find(s => s.stage === so.value);
            return (
              <div key={so.value} className={cx('rounded-field border p-3', divider, cardBg)}>
                <div className="flex items-center gap-2">
                  <span className={cx('text-xs font-light', textPrimary)}>{so.label}</span>
                  <span className={cx('text-[10px] font-light', textFaint)}>{so.hint}</span>
                  {summary && summary.count > 0 && (
                    <span className={cx('ml-auto text-[10px] font-light tabular-nums', textSecondary)}>
                      {summary.count} 张 · {summary.totalKg.toLocaleString()} kg
                    </span>
                  )}
                </div>
                {stageList.length === 0 ? (
                  <div className={cx('mt-2 flex items-center gap-1.5 text-[11px] font-light', textFaint)}>
                    <TriangleAlert size={14} strokeWidth={1.5} />未登记（缺链）
                  </div>
                ) : stageList.map(t => {
                  const expired = t.validUntil != null && t.validUntil < today;
                  return (
                    <div key={t.id} className={cx('mt-2 rounded-field border p-2', divider)}>
                      <div className="flex items-center gap-1.5">
                        <span className={cx('text-[11px] font-light tabular-nums', textPrimary)}>{t.tcNo}</span>
                        <span className={cx('bds-badge sm', expired ? 'danger' : 'neutral')}>
                          {expired ? '已过期' : fmtKg(Number(t.quantityKg))}
                        </span>
                        {canWrite && (
                          <button
                            type="button"
                            disabled={acting !== null}
                            onClick={() => removeTc(t)}
                            className="bds-btn bds-btn-ghost bds-btn-icon ml-auto"
                            title="删除"
                          >
                            <Trash2 size={14} strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                      <div className={cx('mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-light', textFaint)}>
                        {t.relationName && <span>{t.relationName}</span>}
                        {t.validUntil && <span>效期至 {t.validUntil}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* 登记 BottomSheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title="登记 TC 证书">
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>链段 *</label>
            <div className="flex flex-wrap gap-1.5">
              {STAGE_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setFormStage(o.value)} className={chipCls(formStage === o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
            <div className={cx('mt-1.5 text-[10px] font-light', textFaint)}>
              {STAGE_OPTIONS.find(o => o.value === formStage)?.hint}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>证书编号 *</label>
              <input value={formTcNo} onChange={e => setFormTcNo(e.target.value)} placeholder="如 TC-2026-08123" className="bds-input sm w-44" autoFocus />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>吨位（kg）*</label>
              <input value={formKg} onChange={e => setFormKg(e.target.value)} placeholder="如 9800" inputMode="decimal" className="bds-input sm w-32" />
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>交易对手</label>
            <CustomSelect
              className="w-full"
              surface="form"
              ariaLabel="选择交易对手"
              value={formRelation}
              onChange={v => setFormRelation(v)}
              options={[
                { value: '', label: '未指定（后补）' },
                ...counterparties.map(r => ({ value: r.id, label: r.chineseName || r.name })),
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>签发日</label>
              <CapsuleDateInput value={formIssued} onChange={setFormIssued} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="签发日" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>有效期至</label>
              <CapsuleDateInput value={formValid} onChange={setFormValid} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="留空=长期有效" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitCreate} className="bds-btn bds-btn-primary">
              {acting === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}登记
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
