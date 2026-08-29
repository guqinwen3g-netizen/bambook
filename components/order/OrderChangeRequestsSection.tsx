import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, ShieldCheck, ShieldPlus, Undo2,
} from 'lucide-react';
import type { Order } from '../../types';
import {
  GATE_BLOCKED_CODE,
  openExceptionEntry,
  type ExceptionEntryDetail,
} from '../../services/exceptionService';
import {
  ORDER_CHANGE_REASON_MIN,
  ORDER_CHANGE_IMPACT_MIN,
  ORDER_CHANGE_STATUS_LABELS,
  ORDER_CHANGE_TYPES,
  ORDER_CHANGE_TYPE_LABELS,
  buildChangeRequestDraft,
  isApprovedOrderStatus,
  isGuardedOrderStatus,
  orderChangeService,
  readOrderCapsuleExemption,
  readOrderMoqSnapshot,
  resolveOrderChangeType,
  type ChangeFormValues,
  type ControlledFieldEdit,
  type MoqValidateResult,
  type OrderChangeRequest,
  type OrderChangeRequestDetail,
  type OrderChangeType,
} from '../../services/orderChangeService';
import { statusSemanticClass } from '../rdlBusinessStatusTokens';
import { formatYmd } from '../../lib/dateFormat';
import SidePanelContainer from '../ui/SidePanelContainer';
import CustomSelect from '../ui/CustomSelect';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import OrderSectionHeader from './OrderSectionHeader';
import RelationCombobox from './RelationCombobox';
import { createOrderUiSpec } from './orderUiSpec';
import type { Relation } from '../../types';

/**
 * 订单详情「变更申请 / Change Requests」区块（DR-010 审批链 UI 落点）。
 *
 * 职责：
 *   1. 列出该订单的变更申请（7 类；状态机 待审批/已批准/已拒绝/已应用/已撤回）；
 *   2. 发起新变更申请（表单按变更类型动态出字段；客户端校验镜像服务端下限，服务端仍为权威）；
 *   3. 展开查看审批进度（GET /:id 惰性加载 approvalRequest）；
 *   4. Pending 可撤回、Approved 可生效（服务端 fail-closed 守卫，错误内联展示）；
 *   5. 数量变更支持 MOQ dry-run 预检（/api/v1/moq/validate，不写库不建审批单）；
 *   6. 编辑门禁引导：已批准订单直改受控字段被拦截后，经 gatePrefill 自动打开并预填表单；
 *   7. 门禁阻断入口：受控字段拦截 / MOQ 预检不合规 / 服务端 GATE_BLOCKED 错误处提供
 *      「申请受控例外」入口（openExceptionEntry → 审批中心例外 Tab 预填，DR-013 通用机制）。
 *
 * 同文件导出：
 *   OrderMoqSnapshotBlock  — moqSnapshot 只读条（创建时快照，不随配置变更追溯）
 *   CapsuleExemptionBadge  — Capsule MOQ 豁免小徽章（DR-003）
 */

/** 编辑门禁拦截产物：OrderManager 直改受控字段被拦截后传入，用于预填变更申请 */
export interface ChangeRequestGatePrefill {
  edits: ControlledFieldEdit[];
}

interface OrderChangeRequestsSectionProps {
  order: Order;
  isDarkMode: boolean | undefined;
  /** 外部变更（如订单保存后）触发重取 */
  refreshKey?: number;
  gatePrefill?: ChangeRequestGatePrefill | null;
  onGatePrefillConsumed?: () => void;
  /** 关系档案列表（客户变更表单的 RelationCombobox 数据源；宿主 OrderManager 传入） */
  relations?: Relation[];
  /** apply 生效后通知宿主刷新订单本体（数量/金额/交期/客户等已写回 Order，仅 reload 列表会留下陈旧详情） */
  onOrderUpdated?: () => void;
}

// ── 展示映射 ──

const CHANGE_STATUS_BADGE_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  Pending: 'warning',
  Approved: 'info',
  Rejected: 'danger',
  Applied: 'success',
  Cancelled: 'neutral',
};

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  cancelled: '已撤回',
};

const BEFORE_AFTER_FIELD_LABELS: Record<string, string> = {
  quantity: '数量',
  unitPrice: '金额',
  deliveryDate: '交期',
  dueDate: '交期',
  customer: '客户',
  customerRelationId: '客户关联',
  product: '产品',
  status: '订单状态',
};

const ORDER_STATUS_ZH: Record<string, string> = {
  Pending: '待确认',
  Confirmed: '已确认',
  Production: '生产中',
  Shipping: '出运中',
  Delivered: '已交付',
  Alert: '异常',
  CancelRequested: '取消申请中',
  PauseRequested: '暂停申请中',
  Closing: '结案处理中',
  Paused: '暂停中',
  Cancelled: '已关闭',
};

const MOQ_SOURCE_LABELS: Record<string, string> = {
  moq_config: 'MOQ 配置记录',
  fallback_constant: '兜底常量',
};

const fmtSnapshotValue = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('zh-CN');
  const s = String(v);
  return ORDER_STATUS_ZH[s] ?? s;
};

const EMPTY_FORM: ChangeFormValues = {
  changeType: 'quantity',
  afterQuantity: '',
  afterAmount: '',
  afterDeliveryDate: '',
  afterCustomer: '',
  afterCustomerRelationId: '',
  afterProduct: '',
  pauseReason: '',
  pauseOwnerId: '',
  expectedResumeDate: '',
  changeReason: '',
  impactSummary: '',
};

/** 门禁拦截的单条受控改动 → 预填变更申请表单（按 changeType 映射到对应 after 字段） */
const prefillFormFromGateEdit = (edit: ControlledFieldEdit): ChangeFormValues => {
  const next: ChangeFormValues = { ...EMPTY_FORM, changeType: edit.changeType };
  if (edit.changeType === 'quantity') next.afterQuantity = String(edit.after ?? '');
  if (edit.changeType === 'price') next.afterAmount = String(edit.after ?? '');
  if (edit.changeType === 'delivery') next.afterDeliveryDate = formatYmd(edit.after as string) || String(edit.after ?? '');
  if (edit.changeType === 'customer') next.afterCustomer = String(edit.after ?? '');
  if (edit.changeType === 'product') next.afterProduct = String(edit.after ?? '');
  return next;
};

// ───────────────────────────────────────────────────────────────────
// Capsule MOQ 豁免徽章（小元素范式；DR-003）
// ───────────────────────────────────────────────────────────────────

export const CapsuleExemptionBadge: React.FC<{ order: unknown }> = ({ order }) => {
  if (!readOrderCapsuleExemption(order)) return null;
  return (
    <span
      className="bds-badge sm info shrink-0"
      title="Capsule MOQ 豁免（DR-003）：按 Capsule 档校验最小起订量"
    >
      MOQ 豁免
    </span>
  );
};

// ───────────────────────────────────────────────────────────────────
// MOQ 快照只读条（创建时快照 writeOnce，不随配置变更追溯）
// ───────────────────────────────────────────────────────────────────

export const OrderMoqSnapshotBlock: React.FC<{ order: unknown; isDarkMode: boolean | undefined }> = ({
  order,
  isDarkMode,
}) => {
  const snapshot = readOrderMoqSnapshot(order);
  const spec = createOrderUiSpec(isDarkMode === true);
  if (!snapshot) return null;
  const tiers = [
    { label: '面料档', value: snapshot.fabricDefaultMoq },
    { label: '成衣档', value: snapshot.garmentDefaultMoq },
    { label: 'Capsule 档', value: snapshot.capsuleMoq },
  ];
  return (
    <div className={`mt-2 border-t px-4 pt-3 ${spec.borderSubtle}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${spec.textFaint}`}>MOQ Snapshot</p>
          <p className={`mt-0.5 text-xs font-light ${spec.textMuted}`}>MOQ 快照 · 创建时快照，不随配置变更追溯</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tiers.map((t) => (
            <span key={t.label} className={spec.chip} title={`${t.label}最小起订量`}>
              {t.label} ≥ {t.value.toLocaleString('zh-CN')}
            </span>
          ))}
          <span className={`text-[10px] font-light ${spec.textFaint}`}>
            快照于 {formatYmd(snapshot.snapshotAt) || snapshot.snapshotAt} · 来源 {MOQ_SOURCE_LABELS[snapshot.source] ?? snapshot.source}
          </span>
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// 变更申请区块
// ───────────────────────────────────────────────────────────────────

export const OrderChangeRequestsSection: React.FC<OrderChangeRequestsSectionProps> = ({
  order,
  isDarkMode,
  refreshKey = 0,
  gatePrefill = null,
  onGatePrefillConsumed,
  relations = [],
  onOrderUpdated,
}) => {
  const spec = useMemo(() => createOrderUiSpec(isDarkMode === true), [isDarkMode]);
  const dark = isDarkMode === true;

  const [items, setItems] = useState<OrderChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState<ChangeFormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [gateNote, setGateNote] = useState<string[]>([]);
  const [gateEdits, setGateEdits] = useState<ControlledFieldEdit[]>([]);
  // 多类型受控改动队列：一次保存检测到多类受控改动时，按类型建队，逐类发起申请单
  const [gateQueue, setGateQueue] = useState<OrderChangeType[]>([]);
  const [gateQueueIndex, setGateQueueIndex] = useState(0);

  const [moqChecking, setMoqChecking] = useState(false);
  const [moqResult, setMoqResult] = useState<MoqValidateResult | null>(null);
  const [moqError, setMoqError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, OrderChangeRequestDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorCode, setActionErrorCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await orderChangeService.listChangeRequests({ orderId: order.id });
      setItems(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    orderChangeService.listChangeRequests({ orderId: order.id })
      .then((list) => { if (!cancelled) setItems(list); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [order.id, refreshKey]);

  // 编辑门禁引导：受控字段直改被拦截 → 自动打开表单并按类型建队预填（多类型队列逐类发起）
  useEffect(() => {
    if (!gatePrefill || gatePrefill.edits.length === 0) return;
    const typeQueue = Array.from(new Set(gatePrefill.edits.map((e) => e.changeType)));
    const firstEdit = gatePrefill.edits.find((e) => e.changeType === typeQueue[0]) ?? gatePrefill.edits[0];
    setGateNote(typeQueue.map((t) => ORDER_CHANGE_TYPE_LABELS[t]));
    setGateEdits(gatePrefill.edits);
    setGateQueue(typeQueue);
    setGateQueueIndex(0);
    setForm(prefillFormFromGateEdit(firstEdit));
    setSubmitError(null);
    setSubmitErrorCode(null);
    setMoqResult(null);
    setMoqError(null);
    setComposerOpen(true);
    onGatePrefillConsumed?.();
  }, [gatePrefill, onGatePrefillConsumed]);

  const canRequest = isApprovedOrderStatus(order.status);
  const guarded = isGuardedOrderStatus(order.status);

  // DR-013 门禁阻断 → 例外申请入口（targetType/targetId 精确锁定当前订单，审批中心例外 Tab 预填）
  const openOrderException = (detail: Omit<ExceptionEntryDetail, 'targetType' | 'targetId'>) => {
    openExceptionEntry({ targetType: 'Order', targetId: order.id, ...detail });
  };

  const resetGateQueue = () => {
    setGateNote([]);
    setGateEdits([]);
    setGateQueue([]);
    setGateQueueIndex(0);
  };

  const openComposer = () => {
    setForm(EMPTY_FORM);
    resetGateQueue();
    setSubmitError(null);
    setSubmitErrorCode(null);
    setMoqResult(null);
    setMoqError(null);
    setComposerOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitErrorCode(null);
    const built = buildChangeRequestDraft(order, form);
    if (!built.ok) {
      setSubmitError(built.error);
      return;
    }
    setSubmitting(true);
    try {
      const res = await orderChangeService.createChangeRequest(built.payload);
      // 队列推进：提交类型与队列头一致且还有下一类 → 保留表单并预填下一类型，引导逐类发起直至队列清空；
      // 用户手动改换了变更类型则视为脱离队列，按普通提交收口（队列重置，防串单）
      const nextIndex = gateQueueIndex + 1;
      const onQueueTrack = gateQueue.length > 0 && form.changeType === gateQueue[gateQueueIndex];
      if (onQueueTrack && nextIndex < gateQueue.length) {
        const nextType = gateQueue[nextIndex];
        const nextEdit = gateEdits.find((e) => e.changeType === nextType);
        const remainingLabels = gateQueue.slice(nextIndex).map((t) => ORDER_CHANGE_TYPE_LABELS[t]);
        setGateQueueIndex(nextIndex);
        setForm(nextEdit ? prefillFormFromGateEdit(nextEdit) : { ...EMPTY_FORM, changeType: nextType });
        setMoqResult(null);
        setMoqError(null);
        setSuccessNote(
          `变更申请 ${res.changeRequest.requestNumber} 已提交；还有 ${remainingLabels.length} 类改动待分别发起（${remainingLabels.join('、')}），已为你预填「${ORDER_CHANGE_TYPE_LABELS[nextType]}」申请。`,
        );
      } else {
        setComposerOpen(false);
        resetGateQueue();
        setSuccessNote(`变更申请 ${res.changeRequest.requestNumber} 已提交，进入审批链`);
      }
      await reload();
    } catch (e: any) {
      setSubmitError(e?.message ?? String(e));
      setSubmitErrorCode(typeof e?.code === 'string' ? e.code : null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMoqCheck = async () => {
    setMoqError(null);
    setMoqResult(null);
    const qty = Number(form.afterQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMoqError('请先填写有效的变更后数量');
      return;
    }
    setMoqChecking(true);
    try {
      const firstLine = order.lines?.[0];
      const result = await orderChangeService.validateMoq({
        type: order.type ?? null,
        businessLine: order.businessLine ?? null,
        capsuleExemption: readOrderCapsuleExemption(order),
        snapshot: readOrderMoqSnapshot(order),
        lines: [{ quantity: qty, unit: firstLine?.unit ?? undefined, styleNo: firstLine?.styleNo ?? null, materialCode: firstLine?.materialCode ?? null }],
      });
      setMoqResult(result);
    } catch (e: any) {
      setMoqError(e?.message ?? String(e));
    } finally {
      setMoqChecking(false);
    }
  };

  const toggleExpand = async (cr: OrderChangeRequest) => {
    setDetailError(null);
    if (expandedId === cr.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(cr.id);
    if (details[cr.id]) return;
    setDetailLoading(true);
    try {
      const detail = await orderChangeService.getChangeRequest(cr.id);
      setDetails((prev) => ({ ...prev, [cr.id]: detail }));
    } catch (e: any) {
      setDetailError(e?.message ?? String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleWithdraw = async (cr: OrderChangeRequest) => {
    setActionError(null);
    setActionErrorCode(null);
    setActionBusyId(cr.id);
    try {
      await orderChangeService.withdrawChangeRequest(cr.id);
      await reload();
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
      setActionErrorCode(typeof e?.code === 'string' ? e.code : null);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleApply = async (cr: OrderChangeRequest) => {
    setActionError(null);
    setActionErrorCode(null);
    setActionBusyId(cr.id);
    try {
      await orderChangeService.applyChangeRequest(cr.id);
      await reload();
      // apply 已把改动写回订单本体（数量/金额/交期/客户/状态等），通知宿主刷新详情避免陈旧读
      onOrderUpdated?.();
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
      setActionErrorCode(typeof e?.code === 'string' ? e.code : null);
    } finally {
      setActionBusyId(null);
    }
  };

  const changeType = form.changeType;
  const moqVerdict = moqResult?.lines?.[0] ?? null;

  return (
    <SidePanelContainer
      materialRole="raisedCard"
      edgeFadeItem
      spotlight
      isDarkMode={isDarkMode === true}
      className={spec.panelClass}
      contentClassName={spec.panelContentClass}
    >
      <OrderSectionHeader
        iconKey="changes"
        kicker="Change Requests"
        title="变更申请"
        isDarkMode={dark}
        meta={(
          <div className="flex flex-wrap items-center gap-2">
            {items.length > 0 && <span>{items.length} 条申请</span>}
            {canRequest && !guarded && (
              <button type="button" onClick={openComposer} className="bds-btn bds-btn-secondary">
                <Plus size={14} strokeWidth={1.5} />发起变更申请
              </button>
            )}
          </div>
        )}
      />

      {/* 状态门禁提示（服务端 fail-closed，前端仅作可行动性说明） */}
      {guarded && (
        <div className={`mb-3 ${spec.bannerDanger}`}>
          <AlertCircle size={14} />
          <span>订单处于「{ORDER_STATUS_ZH[order.status ?? ''] ?? order.status}」，存在进行中的变更/取消/暂停申请，待其完结后方可发起新申请。</span>
        </div>
      )}
      {!canRequest && !guarded && (
        <p className={`mb-3 text-xs font-light ${spec.textMuted}`}>
          当前状态可直接编辑；仅已批准订单（已确认/生产中/出运中/已交付）的受控字段变更需走本审批链。
        </p>
      )}

      {successNote && (
        <div className={`mb-3 flex items-center gap-2 rounded-field border px-3 py-2 text-xs font-light ${statusSemanticClass('success', dark)}`}>
          <CheckCircle2 size={14} />
          <span>{successNote}</span>
        </div>
      )}
      {actionError && (
        <div className={`mb-3 ${spec.bannerDanger}`}>
          <AlertCircle size={14} />
          <span className="min-w-0 flex-1">{actionError}</span>
          {actionErrorCode === GATE_BLOCKED_CODE && (
            <button
              type="button"
              onClick={() => openOrderException({ action: 'order:change', exceptionCategory: 'order_change', gate: 'order_change', blockingReasons: [GATE_BLOCKED_CODE] })}
              className="bds-btn bds-btn-outline sm ml-auto shrink-0"
              title="门禁阻断（GATE_BLOCKED）：按 DR-013 发起受控例外申请，审批中心自动预填本订单上下文"
            >
              <ShieldPlus size={14} strokeWidth={1.5} />
              申请受控例外
            </button>
          )}
        </div>
      )}

      {/* ── 发起表单（按变更类型动态出字段） ── */}
      {composerOpen && (
        <div className={`mb-4 rounded-inset border p-4 ${spec.insetSurface}`}>
          <p className={spec.subGroupTitle}>新建变更申请</p>

          {gateNote.length > 0 && (
            <div className={`mt-2 flex items-start gap-2 rounded-field border px-3 py-2 text-xs font-light ${statusSemanticClass('warning', dark)}`}>
              <AlertCircle size={14} className="mt-px shrink-0" />
              <span className="min-w-0 flex-1">
                检测到受控字段直改（{gateNote.join('、')}）——已批准订单的受控字段变更需经审批，已为你预填「{ORDER_CHANGE_TYPE_LABELS[form.changeType]}」申请；
                {gateQueue.length > 1
                  ? `改动队列进度 ${gateQueueIndex + 1}/${gateQueue.length}：提交本单后自动预填下一类型，直至 ${gateQueue.length} 类改动全部发起。`
                  : '请补充变更理由与影响说明后提交。'}
              </span>
              <button
                type="button"
                onClick={() => openOrderException({
                  action: 'order:change',
                  exceptionCategory: 'order_change',
                  gate: 'order_change',
                  blockingReasons: gateEdits.map((e) => `CONTROLLED_FIELD_DIRECT_EDIT:${e.field}`),
                })}
                className="bds-btn bds-btn-outline sm shrink-0 self-center"
                title="正常路径为变更申请审批链；确需绕过变更控制时，按 DR-013 发起受控例外申请（审批中心自动预填本订单上下文）"
              >
                <ShieldPlus size={14} strokeWidth={1.5} />
                申请受控例外
              </button>
            </div>
          )}

          {/* 改动队列进度条：多类型受控改动逐类发起（队列清空前进度常显） */}
          {gateQueue.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {gateQueue.map((t, idx) => (
                <span
                  key={t}
                  className={idx < gateQueueIndex ? spec.chip : idx === gateQueueIndex ? `bds-badge sm info` : `${spec.chip} opacity-50`}
                >
                  {idx < gateQueueIndex ? '已提交 · ' : idx === gateQueueIndex ? '进行中 · ' : ''}{ORDER_CHANGE_TYPE_LABELS[t]}
                </span>
              ))}
              {gateQueueIndex < gateQueue.length - 1 && (
                <span className={`text-[10px] font-light ${spec.textFaint}`}>
                  还有 {gateQueue.length - gateQueueIndex - 1} 类改动待分别发起
                </span>
              )}
            </div>
          )}

          <div className={`mt-3 ${spec.gridEdit}`}>
            <div className="space-y-1.5">
              <span className={`ml-1 ${spec.subGroupMeta}`}>变更类型</span>
              <CustomSelect
                options={ORDER_CHANGE_TYPES.map((t) => ({ value: t, label: ORDER_CHANGE_TYPE_LABELS[t] }))}
                value={changeType}
                onChange={(v) => { setForm((p) => ({ ...p, changeType: v as OrderChangeType })); setMoqResult(null); setMoqError(null); }}
                isDarkMode={dark}
                surface="field"
              />
            </div>

            {changeType === 'quantity' && (
              <div className="space-y-1.5">
                <span className={`ml-1 ${spec.subGroupMeta}`}>变更后数量（当前 {order.quantity ?? 0}）</span>
                <input
                  type="number"
                  className={`${spec.field} ${spec.fieldNoSpinner}`}
                  value={form.afterQuantity ?? ''}
                  onChange={(e) => { setForm((p) => ({ ...p, afterQuantity: e.target.value })); setMoqResult(null); }}
                  placeholder="正数"
                />
              </div>
            )}
            {changeType === 'price' && (
              <div className="space-y-1.5">
                <span className={`ml-1 ${spec.subGroupMeta}`}>变更后金额（当前 {(order.quoteAmount ?? order.contractAmount ?? 0).toLocaleString('zh-CN')}）</span>
                <input
                  type="number"
                  className={`${spec.field} ${spec.fieldNoSpinner}`}
                  value={form.afterAmount ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, afterAmount: e.target.value }))}
                  placeholder="非负数字"
                />
              </div>
            )}
            {changeType === 'delivery' && (
              <div className="space-y-1.5">
                <span className={`ml-1 ${spec.subGroupMeta}`}>变更后交期（当前 {formatYmd(order.dueDate || order.clientDate) || '—'}）</span>
                <CapsuleDateInput
                  value={form.afterDeliveryDate ?? ''}
                  onChange={(v) => setForm((p) => ({ ...p, afterDeliveryDate: v }))}
                  isDarkMode={dark}
                  className={spec.field}
                />
              </div>
            )}
            {changeType === 'customer' && (
              <div className="space-y-1.5">
                <span className={`ml-1 ${spec.subGroupMeta}`}>变更后客户（当前 {order.customer || '—'}）</span>
                <RelationCombobox
                  value={form.afterCustomer ?? ''}
                  relationId={form.afterCustomerRelationId || undefined}
                  relations={relations}
                  filterCategories={['Customer']}
                  isDarkMode={dark}
                  placeholder="搜索并选择新客户（客户类别档案；可直接键入新名称）"
                  inputClassName={`${spec.field} pr-9`}
                  onChange={(next) => setForm((p) => ({
                    ...p,
                    afterCustomer: next.name,
                    afterCustomerRelationId: next.relationId ?? '',
                  }))}
                />
              </div>
            )}
            {changeType === 'product' && (
              <div className="space-y-1.5">
                <span className={`ml-1 ${spec.subGroupMeta}`}>变更后产品（当前 {order.product || '—'}）</span>
                <input
                  className={spec.field}
                  value={form.afterProduct ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, afterProduct: e.target.value }))}
                  placeholder="新产品/规格描述"
                />
              </div>
            )}
            {changeType === 'pause' && (
              <>
                <div className="space-y-1.5">
                  <span className={`ml-1 ${spec.subGroupMeta}`}>暂停原因</span>
                  <input
                    className={spec.field}
                    value={form.pauseReason ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, pauseReason: e.target.value }))}
                    placeholder="缺省回落为变更理由"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className={`ml-1 ${spec.subGroupMeta}`}>责任人 ID</span>
                  <input
                    className={spec.field}
                    value={form.pauseOwnerId ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, pauseOwnerId: e.target.value }))}
                    placeholder="暂停期间责任人"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className={`ml-1 ${spec.subGroupMeta}`}>预计恢复日期</span>
                  <CapsuleDateInput
                    value={form.expectedResumeDate ?? ''}
                    onChange={(v) => setForm((p) => ({ ...p, expectedResumeDate: v }))}
                    isDarkMode={dark}
                    className={spec.field}
                  />
                </div>
              </>
            )}
            {changeType === 'cancel' && (
              <p className={`self-end text-xs font-light ${spec.textMuted}`}>
                取消批准后：无不可逆承诺直接结案关闭；有承诺进入「结案处理中」，处置完成后关闭。
              </p>
            )}
          </div>

          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <span className={`ml-1 ${spec.subGroupMeta}`}>变更理由（≥{ORDER_CHANGE_REASON_MIN} 字，当前 {form.changeReason.trim().length} 字）</span>
              <textarea
                className={`w-full resize-none rounded-inset border px-4 py-3 text-xs font-light leading-relaxed outline-none transition-colors duration-200 ${spec.insetSurface} ${spec.textPrimary} ${spec.subFieldFocus}`}
                rows={2}
                value={form.changeReason}
                onChange={(e) => setForm((p) => ({ ...p, changeReason: e.target.value }))}
                placeholder="说明为什么需要本次变更（审计强制留痕）"
              />
            </div>
            <div className="space-y-1.5">
              <span className={`ml-1 ${spec.subGroupMeta}`}>影响说明（≥{ORDER_CHANGE_IMPACT_MIN} 字，当前 {form.impactSummary.trim().length} 字）</span>
              <textarea
                className={`w-full resize-none rounded-inset border px-4 py-3 text-xs font-light leading-relaxed outline-none transition-colors duration-200 ${spec.insetSurface} ${spec.textPrimary} ${spec.subFieldFocus}`}
                rows={2}
                value={form.impactSummary}
                onChange={(e) => setForm((p) => ({ ...p, impactSummary: e.target.value }))}
                placeholder="说明对成本/交期/回款/生产等的影响"
              />
            </div>
          </div>

          {/* MOQ dry-run 预检（数量变更；不写库、不建审批单） */}
          {changeType === 'quantity' && (
            <div className="mt-3">
              <button type="button" onClick={handleMoqCheck} disabled={moqChecking} className="bds-btn bds-btn-outline">
                {moqChecking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} strokeWidth={1.5} />}
                MOQ 预检
              </button>
              {moqError && (
                <div className={`mt-2 ${spec.bannerDanger}`}>
                  <AlertCircle size={14} />
                  <span>{moqError}</span>
                </div>
              )}
              {moqVerdict && (
                <div className={`mt-2 flex items-start gap-2 rounded-field border px-3 py-2 text-xs font-light ${statusSemanticClass(moqVerdict.compliant ? 'success' : 'warning', dark)}`}>
                  {moqVerdict.compliant ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <AlertCircle size={14} className="mt-px shrink-0" />}
                  <span className="min-w-0 flex-1">
                    {moqVerdict.compliant
                      ? `MOQ 预检通过：有效起订量 ${moqVerdict.effectiveMoq.toLocaleString('zh-CN')}，变更后数量 ${moqVerdict.quantity.toLocaleString('zh-CN')} 合规。`
                      : `MOQ 预检不合规：有效起订量 ${moqVerdict.effectiveMoq.toLocaleString('zh-CN')}，缺口 ${moqVerdict.gapPct}%（${moqVerdict.severity}）；变更生效时将触发 MOQ 豁免审批链。`}
                    {moqResult?.capsuleActive ? ' Capsule 档豁免生效中。' : ''}
                  </span>
                  {!moqVerdict.compliant && (
                    <button
                      type="button"
                      onClick={() => openOrderException({
                        action: 'order:moq-exemption',
                        exceptionCategory: 'moq_exemption',
                        gate: 'moq_exemption',
                        blockingReasons: ['MOQ_BELOW_EFFECTIVE_MIN'],
                      })}
                      className="bds-btn bds-btn-outline sm shrink-0 self-center"
                      title="MOQ fail-closed 阻断：正常路径为 MOQ 豁免审批链；确需例外放行时，按 DR-013 发起受控例外申请（审批中心自动预填本订单上下文）"
                    >
                      <ShieldPlus size={14} strokeWidth={1.5} />
                      申请 MOQ 豁免例外
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {submitError && (
            <div className={`mt-3 ${spec.bannerDanger}`}>
              <AlertCircle size={14} />
              <span className="min-w-0 flex-1">{submitError}</span>
              {submitErrorCode === GATE_BLOCKED_CODE && (
                <button
                  type="button"
                  onClick={() => openOrderException({ action: 'order:change', exceptionCategory: 'order_change', gate: 'order_change', blockingReasons: [GATE_BLOCKED_CODE] })}
                  className="bds-btn bds-btn-outline sm ml-auto shrink-0"
                  title="门禁阻断（GATE_BLOCKED）：按 DR-013 发起受控例外申请，审批中心自动预填本订单上下文"
                >
                  <ShieldPlus size={14} strokeWidth={1.5} />
                  申请受控例外
                </button>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setComposerOpen(false); resetGateQueue(); }} disabled={submitting} className="bds-btn bds-btn-ghost">
              取消
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="bds-btn bds-btn-primary">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}
              提交申请
            </button>
          </div>
        </div>
      )}

      {/* ── 列表三态 ── */}
      {loading && (
        <div className={`flex items-center gap-2 ${spec.emptyText}`}>
          <Loader2 size={14} className="animate-spin" /> 加载变更申请…
        </div>
      )}
      {!loading && error && (
        <div className={spec.bannerDanger}>
          <AlertCircle size={14} />
          <span>变更申请加载失败:{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <p className={spec.emptyText}>暂无变更申请</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {items.map((cr) => {
            const type = resolveOrderChangeType(cr);
            const expanded = expandedId === cr.id;
            const detail = details[cr.id];
            const before = (cr.beforeSnapshot ?? {}) as Record<string, unknown>;
            const after = (cr.afterDelta ?? {}) as Record<string, unknown>;
            const diffKeys = Object.keys(after);
            const pauseMeta = (cr.attachments as { pause?: Record<string, unknown> } | null | undefined)?.pause ?? null;
            const busy = actionBusyId === cr.id;
            return (
              <div key={cr.id} className={`rounded-inset border p-3.5 ${spec.insetSurface}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={`font-mono text-xs font-normal ${spec.textPrimary}`}>{cr.requestNumber}</span>
                    <span className={spec.chip}>{ORDER_CHANGE_TYPE_LABELS[type]}</span>
                    <span className={`bds-badge sm ${CHANGE_STATUS_BADGE_VARIANT[cr.status] ?? 'neutral'}`}>
                      {ORDER_CHANGE_STATUS_LABELS[cr.status] ?? cr.status}
                    </span>
                  </div>
                  <span className={`shrink-0 text-[10px] font-light ${spec.textMuted}`}>{formatYmd(cr.createdAt) || '—'}</span>
                </div>

                {/* before → after 留痕 */}
                {diffKeys.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {diffKeys.map((k) => (
                      <span key={k} className={spec.chip}>
                        {BEFORE_AFTER_FIELD_LABELS[k] ?? k}:{fmtSnapshotValue(before[k])} → {fmtSnapshotValue(after[k])}
                      </span>
                    ))}
                  </div>
                )}

                <p className={`mt-2 text-xs font-light ${spec.textSecondary}`}>{cr.changeReason}</p>
                {cr.notes && <p className={`mt-1 text-[11px] font-light ${spec.textMuted}`}>影响:{cr.notes}</p>}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(cr)}
                    className={`inline-flex items-center gap-1 text-[11px] font-light ${spec.textMuted} hover:text-link`}
                  >
                    {expanded ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
                    审批进度
                  </button>
                  {cr.status === 'Pending' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleWithdraw(cr)}
                      className="bds-btn bds-btn-ghost sm"
                      title="申请人撤回（仅待审批状态可撤回）"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} strokeWidth={1.5} />}
                      撤回
                    </button>
                  )}
                  {cr.status === 'Approved' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleApply(cr)}
                      className="bds-btn bds-btn-outline sm"
                      title="审批通过后生效（幂等）"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.5} />}
                      生效
                    </button>
                  )}
                </div>

                {/* 审批进度（惰性加载详情） */}
                {expanded && (
                  <div className={`mt-3 border-t pt-3 ${spec.borderSubtle}`}>
                    {detailLoading && !detail && (
                      <div className={`flex items-center gap-2 ${spec.emptyText}`}>
                        <Loader2 size={14} className="animate-spin" /> 加载审批进度…
                      </div>
                    )}
                    {detailError && !detail && (
                      <div className={spec.bannerDanger}>
                        <AlertCircle size={14} />
                        <span>{detailError}</span>
                      </div>
                    )}
                    {detail && (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={spec.subGroupMeta}>审批单</span>
                          <span className={spec.chip}>
                            {APPROVAL_STATUS_LABELS[detail.approvalRequest?.status ?? ''] ?? detail.approvalRequest?.status ?? '未关联'}
                          </span>
                          {detail.approvalRequest?.reviewerId && (
                            <span className={`text-[10px] font-light ${spec.textMuted}`}>审批人 {detail.approvalRequest.reviewerId}</span>
                          )}
                          {detail.approvalRequest?.decidedAt && (
                            <span className={`text-[10px] font-light ${spec.textMuted}`}>决定时间 {formatYmd(detail.approvalRequest.decidedAt) || detail.approvalRequest.decidedAt}</span>
                          )}
                        </div>
                        {detail.approvalRequest?.decisionNote && (
                          <p className={`text-[11px] font-light ${spec.textMuted}`}>审批意见:{detail.approvalRequest.decisionNote}</p>
                        )}
                        {detail.appliedAt && (
                          <p className={`text-[11px] font-light ${spec.textMuted}`}>
                            已于 {formatYmd(detail.appliedAt) || detail.appliedAt} 生效{detail.appliedBy ? `（操作人 ${detail.appliedBy}）` : ''}
                          </p>
                        )}
                        {pauseMeta && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={spec.chip}>预计恢复 {String(pauseMeta.expectedResumeDate ?? '—')}</span>
                            {pauseMeta.pauseOwnerId != null && <span className={spec.chip}>责任人 {String(pauseMeta.pauseOwnerId)}</span>}
                            {pauseMeta.resumeReminderFlagged === true && <span className={`bds-badge sm warning`}>恢复到期提醒已标记</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SidePanelContainer>
  );
};

export default OrderChangeRequestsSection;
