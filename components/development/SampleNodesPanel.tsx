/**
 * SampleNodesPanel — 三级样衣节点面板（Phase B4）+ 服装多轮样品双门禁（DR-008/029/039）
 *
 * 每个开发单固定三级：确认样 → 产前样 → 大货样。
 * 状态机：pending → making → sent → approved / revising（revising 可 start 进入下一轮，round+1）。
 *
 * 服装（garment）开发单额外渲染「多轮样品双门禁」区块（DR-008）：
 *   - 状态机：in_progress → qc_passed → submitted → confirmed → sealed（旧轮次 superseded；客户不通过 rejected）
 *   - 双门禁标识：内部门禁（QC 通过才允许提交客户，fail-closed）+ 客户确认（业务员登记，不加审批）
 *   - 每轮快递信息（DR-039：快递商/单号/日期/收件方 + 随附单据）与封存归档入口
 *
 * 设计：flat 无阴影、RDL/compiled 风格、按当前状态渲染下一动作按钮。
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Loader2,
  PackageCheck,
  Plus,
  RotateCcw,
  Scissors,
  Send,
  ShieldCheck,
  Truck,
  UserCheck,
} from 'lucide-react';
import { developmentService } from '../../services/developmentService';
import {
  sampleService,
  GARMENT_ROUND_STATUS_LABELS,
  type GarmentSampleRound,
  type GarmentRoundStatus,
} from '../../services/sampleService';
import type { SampleNode, SampleNodeLevel, SampleNodeStatus } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const LEVELS: Array<{ id: SampleNodeLevel; label: string; en: string }> = [
  { id: 'confirmation', label: '确认样', en: 'Approval' },
  { id: 'pp', label: '产前样', en: 'PP Sample' },
  { id: 'top', label: '大货样', en: 'TOP' },
];

const STATUS_LABEL: Record<SampleNodeStatus, string> = {
  pending: '待打样',
  making: '制作中',
  sent: '已寄出',
  approved: '已批准',
  revising: '需修改',
};

interface SampleNodesPanelProps {
  caseId: string;
  isDarkMode: boolean;
  /** 开发单类型（DevelopmentCase.type）；仅 garment 渲染 DR-008 双门禁区块 */
  caseType?: string;
}

export function SampleNodesPanel({ caseId, isDarkMode, caseType }: SampleNodesPanelProps) {
  const [nodes, setNodes] = useState<SampleNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const cardCls = 'border-[var(--border-c-default)] bg-[var(--recessed-bg)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNodes(await developmentService.listSampleNodes(caseId));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (node: SampleNode, action: 'start' | 'send' | 'approve' | 'revise') => {
    const key = `${node.level}:${action}`;
    if (acting) return;
    setActing(key);
    setError(null);
    try {
      let payload: any = { action };
      if (action === 'send') {
        const trackingNumber = window.prompt('快递单号（可留空）', node.trackingNumber || '') ?? undefined;
        if (trackingNumber === undefined) { setActing(null); return; }
        const courier = trackingNumber.trim() ? (window.prompt('快递公司（可留空）', node.courier || '') ?? '') : '';
        payload = { action, trackingNumber: trackingNumber.trim() || undefined, courier: courier.trim() || undefined };
      }
      if (action === 'revise') {
        const feedback = window.prompt('客户修改意见', node.feedback || '');
        if (feedback === null) { setActing(null); return; }
        payload = { action, feedback: feedback.trim() || undefined };
      }
      if (action === 'approve') {
        const feedback = window.prompt('批准意见（可留空）', '') ?? '';
        payload = { action, feedback: feedback.trim() || undefined };
      }
      const updated = await developmentService.advanceSampleNode(caseId, node.level, payload);
      setNodes(prev => prev.map(n => (n.id === updated.id ? updated : n)));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setActing(null);
    }
  }, [acting, caseId]);

  if (loading) {
    return (
      <div className={cx('flex items-center gap-2 py-4 text-[11px] font-light', textFaint)}>
        <Loader2 size={13} strokeWidth={1.4} className="animate-spin" /> 加载样衣节点…
      </div>
    );
  }

  const actionBtnCls = 'border-[var(--border-c-strong)] dark:border-[var(--border-c-default)] text-[var(--text-tertiary)] dark:text-[var(--text-secondary)] hover:bg-[var(--hover-darken)] hover:text-[var(--text-primary)]';

  return (
    <div>
      <div className={cx('mb-2 text-[10px] font-light tracking-[0.18em]', textSecondary)}>三级样衣节点</div>
      {error && <div className="mb-2 text-[11px] font-light text-red-400">{error}</div>}
      <div className="space-y-2">
        {LEVELS.map(({ id, label, en }) => {
          const node = nodes.find(n => n.level === id);
          if (!node) return null;
          const approved = node.status === 'approved';
          return (
            <div key={id} className={cx('rounded-inset border px-3 py-2.5', cardCls)}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={cx('truncate text-xs font-light', textPrimary)}>
                    {label} <span className={cx('text-[10px]', textFaint)}>{en}{node.round > 1 ? ` · R${node.round}` : ''}</span>
                  </div>
                  <div className={cx('mt-0.5 text-[10px] font-light', approved ? 'text-emerald-400' : textSecondary)}>
                    {STATUS_LABEL[node.status]}
                    {node.sentDate ? ` · 寄出 ${node.sentDate}` : ''}
                    {node.trackingNumber ? ` · ${node.trackingNumber}` : ''}
                  </div>
                  {node.feedback && (
                    <div className={cx('mt-1 truncate text-[10px] font-light', textFaint)} title={node.feedback}>
                      反馈：{node.feedback}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {node.status === 'pending' && (
                    <button type="button" disabled={!!acting} onClick={() => act(node, 'start')}
                      className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                      <Scissors size={10} strokeWidth={1.4} /> 开始打样
                    </button>
                  )}
                  {node.status === 'revising' && (
                    <button type="button" disabled={!!acting} onClick={() => act(node, 'start')}
                      className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                      <RotateCcw size={10} strokeWidth={1.4} /> 重新打样
                    </button>
                  )}
                  {node.status === 'making' && (
                    <>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'send')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                        <Send size={10} strokeWidth={1.4} /> 寄出
                      </button>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'revise')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                        <RotateCcw size={10} strokeWidth={1.4} /> 需修改
                      </button>
                    </>
                  )}
                  {node.status === 'sent' && (
                    <>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'approve')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors',
                          'border-success/30 text-[var(--success-text)] hover:bg-[var(--success-tint)]')}>
                        <CheckCircle2 size={10} strokeWidth={1.4} /> 批准
                      </button>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'revise')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                        <RotateCcw size={10} strokeWidth={1.4} /> 需修改
                      </button>
                    </>
                  )}
                  {approved && <PackageCheck size={13} strokeWidth={1.2} className="text-emerald-400/80" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {caseType === 'garment' && <GarmentSampleGateSection caseId={caseId} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DR-008 服装多轮样品双门禁（内部门禁 + 客户确认 → 封存归档）
// ══════════════════════════════════════════════════════════════

/** 状态机 → badge 语义变体 */
const ROUND_BADGE_VARIANT: Record<GarmentRoundStatus, string> = {
  in_progress: 'info',
  qc_passed: 'info',
  submitted: 'warning',
  confirmed: 'success',
  sealed: 'success',
  superseded: 'neutral',
  rejected: 'danger',
};

const QC_GATE_LABEL: Record<GarmentSampleRound['qcStatus'], string> = {
  none: '门禁未送审',
  passed: '内部门禁已通过',
  failed: '内部门禁未通过',
};

const CUSTOMER_GATE_LABEL: Record<GarmentSampleRound['customerStatus'], string> = {
  pending: '客户待确认',
  approved: '客户确认通过',
  rejected: '客户已拒绝',
  needs_revision: '客户要求修改',
};

type GateFormState =
  | { kind: 'create' }
  | { kind: 'qc'; roundId: string }
  | { kind: 'ship'; roundId: string }
  | { kind: 'confirm'; roundId: string }
  | null;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function GarmentSampleGateSection({ caseId }: { caseId: string }) {
  const [rounds, setRounds] = useState<GarmentSampleRound[]>([]);
  const [sealedRoundId, setSealedRoundId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [form, setForm] = useState<GateFormState>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const cardCls = 'border-[var(--border-c-default)] bg-[var(--recessed-bg)]';
  const actionBtnCls = 'border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)] hover:text-[var(--text-primary)]';
  const inputCls = 'bds-input sm';
  const selectCls = 'bds-select sm';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sampleService.listGarmentRounds(caseId);
      setRounds(data.items);
      setSealedRoundId(data.sealedRoundId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (acting) return;
    setActing(true);
    setError(null);
    try {
      await fn();
      setForm(null);
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setActing(false);
    }
  }, [acting, load]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>多轮样品双门禁 · DR-008</div>
        <button
          type="button"
          disabled={acting || form?.kind === 'create'}
          onClick={() => setForm({ kind: 'create' })}
          className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}
        >
          <Plus size={10} strokeWidth={1.4} /> 新建轮次
        </button>
      </div>
      {error && <div className="mt-2 text-[11px] font-light text-red-400">{error}</div>}

      {loading ? (
        <div className={cx('flex items-center gap-2 py-4 text-[11px] font-light', textFaint)}>
          <Loader2 size={13} strokeWidth={1.4} className="animate-spin" /> 加载样品轮次…
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {form?.kind === 'create' && (
            <CreateRoundForm
              busy={acting}
              inputCls={inputCls}
              onCancel={() => setForm(null)}
              onSubmit={(input) => run(() => sampleService.createGarmentRound(caseId, input))}
            />
          )}
          {rounds.length === 0 && form?.kind !== 'create' && (
            <div className={cx('rounded-inset border px-3 py-4 text-center text-[11px] font-light', cardCls, textFaint)}>
              暂无样品轮次，点击「新建轮次」记录第一轮样品（目的 / 版本 / 材料工艺配置必填）
            </div>
          )}
          {rounds.map((round) => (
            <RoundCard
              key={round.id}
              round={round}
              isSealedBase={round.id === sealedRoundId}
              acting={acting}
              form={form}
              setForm={setForm}
              run={run}
              cardCls={cardCls}
              actionBtnCls={actionBtnCls}
              inputCls={inputCls}
              selectCls={selectCls}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              textFaint={textFaint}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RoundCardProps {
  round: GarmentSampleRound;
  isSealedBase: boolean;
  acting: boolean;
  form: GateFormState;
  setForm: (f: GateFormState) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  cardCls: string;
  actionBtnCls: string;
  inputCls: string;
  selectCls: string;
  textPrimary: string;
  textSecondary: string;
  textFaint: string;
}

function RoundCard(props: RoundCardProps) {
  const { round, isSealedBase, acting, form, setForm, run } = props;
  const { cardCls, actionBtnCls, inputCls, selectCls, textPrimary, textSecondary, textFaint } = props;
  const btn = 'inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors';

  return (
    <div className={cx('rounded-inset border px-3 py-2.5', cardCls)}>
      {/* 标题行：轮次 + 版本 + 状态机徽章 */}
      <div className="flex items-center justify-between gap-2">
        <div className={cx('min-w-0 truncate text-xs font-light', textPrimary)}>
          第 {round.round} 轮 <span className={cx('text-[10px]', textFaint)}>{round.version}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isSealedBase && <span className="bds-badge sm success">生产基准</span>}
          <span className={`bds-badge sm ${ROUND_BADGE_VARIANT[round.status] ?? 'neutral'}`}>
            {GARMENT_ROUND_STATUS_LABELS[round.status] ?? round.status}
          </span>
        </div>
      </div>
      <div className={cx('mt-0.5 truncate text-[10px] font-light', textSecondary)} title={`${round.purpose} · ${round.materialConfig}`}>
        {round.purpose} · {round.materialConfig}
      </div>

      {/* 双门禁标识：内部门禁（QC）+ 客户确认 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className={cx(
            'inline-flex items-center gap-1 rounded-compact border px-1.5 py-0.5 text-[10px] font-light',
            round.qcStatus === 'passed'
              ? 'border-success/30 text-[var(--success-text)]'
              : round.qcStatus === 'failed'
                ? 'border-danger/30 text-[var(--danger-text)]'
                : 'border-[var(--border-c-default)] text-[var(--text-quaternary)]',
          )}
        >
          <ShieldCheck size={10} strokeWidth={1.4} /> {QC_GATE_LABEL[round.qcStatus]}
        </span>
        <span
          className={cx(
            'inline-flex items-center gap-1 rounded-compact border px-1.5 py-0.5 text-[10px] font-light',
            round.customerStatus === 'approved'
              ? 'border-success/30 text-[var(--success-text)]'
              : round.customerStatus === 'rejected'
                ? 'border-danger/30 text-[var(--danger-text)]'
                : 'border-[var(--border-c-default)] text-[var(--text-quaternary)]',
          )}
        >
          <UserCheck size={10} strokeWidth={1.4} /> {CUSTOMER_GATE_LABEL[round.customerStatus]}
        </span>
      </div>

      {/* 快递信息（DR-039）+ 随附单据（样品发票/运费凭证） */}
      {round.shipment && (
        <div className={cx('mt-1.5 flex items-center gap-1 text-[10px] font-light', textSecondary)}>
          <Truck size={10} strokeWidth={1.4} className="shrink-0" />
          <span className="truncate">
            寄出 {round.shipment.sentDate} · {round.shipment.courier} · {round.shipment.trackingNumber} · 收件 {round.shipment.recipientName}
            {Array.isArray(round.shipment.documents) && round.shipment.documents.length > 0
              ? ` · 随附单据 ${round.shipment.documents.length} 份`
              : ''}
          </span>
        </div>
      )}
      {round.confirmation && (
        <div className={cx('mt-1 truncate text-[10px] font-light', textSecondary)} title={round.confirmation.note ?? undefined}>
          确认 {round.confirmation.date} · 渠道 {round.confirmation.channel}
          {round.confirmation.note ? ` · ${round.confirmation.note}` : ''}
        </div>
      )}
      {round.modifications.length > 0 && (
        <div className={cx('mt-1 truncate text-[10px] font-light', textFaint)} title={round.modifications.join('；')}>
          修改项：{round.modifications.join('；')}
        </div>
      )}

      {/* 状态机操作入口：提交内部门禁 / 提交客户 / 登记客户确认 / 封存归档 */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {(round.status === 'in_progress' || round.status === 'qc_passed') && (
          <button type="button" disabled={acting} onClick={() => setForm({ kind: 'qc', roundId: round.id })}
            className={cx(btn, actionBtnCls)}>
            <ShieldCheck size={10} strokeWidth={1.4} /> 提交内部门禁
          </button>
        )}
        {round.status === 'qc_passed' && (
          <button type="button" disabled={acting} onClick={() => setForm({ kind: 'ship', roundId: round.id })}
            className={cx(btn, actionBtnCls)}>
            <Send size={10} strokeWidth={1.4} /> 提交客户
          </button>
        )}
        {round.status === 'submitted' && (
          <button type="button" disabled={acting} onClick={() => setForm({ kind: 'confirm', roundId: round.id })}
            className={cx(btn, actionBtnCls)}>
            <UserCheck size={10} strokeWidth={1.4} /> 登记客户确认
          </button>
        )}
        {round.status === 'confirmed' && (
          <button
            type="button"
            disabled={acting}
            onClick={() => {
              if (!window.confirm(`封存 ${round.version}（第 ${round.round} 轮）为产前样生产基准？\n封存后不可变，任何改动须开新轮重新走 QC→客户确认→封存链（DR-008）。`)) return;
              void run(() => sampleService.sealGarmentRound(round.id));
            }}
            className={cx(btn, 'border-success/30 text-[var(--success-text)] hover:bg-[var(--success-tint)]')}
          >
            <Archive size={10} strokeWidth={1.4} /> 封存归档
          </button>
        )}
      </div>

      {/* 内联表单 */}
      {form?.kind === 'qc' && form.roundId === round.id && (
        <QcGateForm
          busy={acting}
          inputCls={inputCls}
          selectCls={selectCls}
          onCancel={() => setForm(null)}
          onSubmit={(input) => run(() => sampleService.submitGarmentQcConclusion(round.id, input))}
        />
      )}
      {form?.kind === 'ship' && form.roundId === round.id && (
        <ShipForm
          busy={acting}
          inputCls={inputCls}
          onCancel={() => setForm(null)}
          onSubmit={(input) => run(() => sampleService.submitGarmentToCustomer(round.id, input))}
        />
      )}
      {form?.kind === 'confirm' && form.roundId === round.id && (
        <ConfirmForm
          busy={acting}
          inputCls={inputCls}
          selectCls={selectCls}
          onCancel={() => setForm(null)}
          onSubmit={(input) => run(() => sampleService.registerGarmentCustomerConfirmation(round.id, input))}
        />
      )}
    </div>
  );
}

// ── 内联表单（必填校验与后端 fail-closed 契约对齐） ──

const formWrapCls = 'mt-2 space-y-1.5 border-t border-[var(--border-c-subtle)] pt-2';
const formBtnCls = 'inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors';
const submitBtnCls = 'border-success/30 text-[var(--success-text)] hover:bg-[var(--success-tint)]';
const cancelBtnCls = 'border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)]';

function FormButtons({ busy, onCancel, submitLabel }: { busy: boolean; onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex items-center gap-1 pt-0.5">
      <button type="submit" disabled={busy} className={cx(formBtnCls, submitBtnCls)}>
        {busy ? <Loader2 size={10} strokeWidth={1.4} className="animate-spin" /> : <CheckCircle2 size={10} strokeWidth={1.4} />}
        {submitLabel}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className={cx(formBtnCls, cancelBtnCls)}>
        取消
      </button>
    </div>
  );
}

function CreateRoundForm({ busy, inputCls, onCancel, onSubmit }: {
  busy: boolean;
  inputCls: string;
  onCancel: () => void;
  onSubmit: (input: { purpose: string; version: string; materialConfig: string; notes?: string }) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState('');
  const [version, setVersion] = useState('');
  const [materialConfig, setMaterialConfig] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <form
      className={cx('rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] px-3 py-2.5', 'space-y-1.5')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!purpose.trim() || !version.trim() || !materialConfig.trim()) return;
        void onSubmit({ purpose: purpose.trim(), version: version.trim(), materialConfig: materialConfig.trim(), notes: notes.trim() || undefined });
      }}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <input className={inputCls} placeholder="本轮目的 *" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <input className={inputCls} placeholder="客户侧版本号 *（如 V1）" value={version} onChange={(e) => setVersion(e.target.value)} />
      </div>
      <input className={inputCls} placeholder="材料/工艺配置 *" value={materialConfig} onChange={(e) => setMaterialConfig(e.target.value)} />
      <input className={inputCls} placeholder="备注（可留空）" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="创建轮次" />
    </form>
  );
}

function QcGateForm({ busy, inputCls, selectCls, onCancel, onSubmit }: {
  busy: boolean;
  inputCls: string;
  selectCls: string;
  onCancel: () => void;
  onSubmit: (input: { result: 'passed' | 'failed'; qcNote?: string; qcInspectionReportId?: string }) => Promise<void>;
}) {
  const [result, setResult] = useState<'passed' | 'failed'>('passed');
  const [qcNote, setQcNote] = useState('');
  const [reportId, setReportId] = useState('');
  return (
    <form
      className={formWrapCls}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ result, qcNote: qcNote.trim() || undefined, qcInspectionReportId: reportId.trim() || undefined });
      }}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <select className={selectCls} value={result} onChange={(e) => setResult(e.target.value as 'passed' | 'failed')}>
          <option value="passed">QC 评审通过</option>
          <option value="failed">QC 评审不通过</option>
        </select>
        <input className={inputCls} placeholder="关联验货报告 ID（可留空）" value={reportId} onChange={(e) => setReportId(e.target.value)} />
      </div>
      <input className={inputCls} placeholder="QC 内部评审意见（可留空）" value={qcNote} onChange={(e) => setQcNote(e.target.value)} />
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="登记 QC 结论" />
    </form>
  );
}

function ShipForm({ busy, inputCls, onCancel, onSubmit }: {
  busy: boolean;
  inputCls: string;
  onCancel: () => void;
  onSubmit: (input: { courier: string; trackingNumber: string; recipientName: string; recipientContact?: string; sentDate?: string }) => Promise<void>;
}) {
  const [courier, setCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientContact, setRecipientContact] = useState('');
  const [sentDate, setSentDate] = useState(todayYmd());
  return (
    <form
      className={formWrapCls}
      onSubmit={(e) => {
        e.preventDefault();
        if (!courier.trim() || !trackingNumber.trim() || !recipientName.trim()) return;
        void onSubmit({
          courier: courier.trim(),
          trackingNumber: trackingNumber.trim(),
          recipientName: recipientName.trim(),
          recipientContact: recipientContact.trim() || undefined,
          sentDate: sentDate || undefined,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <input className={inputCls} placeholder="快递服务商 *（DR-039）" value={courier} onChange={(e) => setCourier(e.target.value)} />
        <input className={inputCls} placeholder="快递单号 *" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input className={inputCls} placeholder="收件方 *" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
        <input className={inputCls} placeholder="收件联系方式（可留空）" value={recipientContact} onChange={(e) => setRecipientContact(e.target.value)} />
      </div>
      <input type="date" className={inputCls} value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="提交客户" />
    </form>
  );
}

function ConfirmForm({ busy, inputCls, selectCls, onCancel, onSubmit }: {
  busy: boolean;
  inputCls: string;
  selectCls: string;
  onCancel: () => void;
  onSubmit: (input: { result: 'approved' | 'rejected' | 'needs_revision'; confirmationDate: string; channel: string; note?: string; modifications?: string[] }) => Promise<void>;
}) {
  const [result, setResult] = useState<'approved' | 'rejected' | 'needs_revision'>('approved');
  const [confirmationDate, setConfirmationDate] = useState(todayYmd());
  const [channel, setChannel] = useState('');
  const [note, setNote] = useState('');
  const [modifications, setModifications] = useState('');
  return (
    <form
      className={formWrapCls}
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirmationDate || !channel.trim()) return;
        void onSubmit({
          result,
          confirmationDate,
          channel: channel.trim(),
          note: note.trim() || undefined,
          modifications: modifications.trim() ? modifications.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean) : undefined,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <select className={selectCls} value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
          <option value="approved">客户确认通过</option>
          <option value="rejected">客户拒绝</option>
          <option value="needs_revision">客户要求修改</option>
        </select>
        <input className={inputCls} placeholder="确认渠道 *（email/电话/微信…）" value={channel} onChange={(e) => setChannel(e.target.value)} />
      </div>
      <input type="date" className={inputCls} value={confirmationDate} onChange={(e) => setConfirmationDate(e.target.value)} />
      <input className={inputCls} placeholder="客户意见（可留空）" value={note} onChange={(e) => setNote(e.target.value)} />
      <input className={inputCls} placeholder="修改项（逗号分隔，可留空）" value={modifications} onChange={(e) => setModifications(e.target.value)} />
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="登记客户确认" />
    </form>
  );
}

export default SampleNodesPanel;
