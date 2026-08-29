/**
 * 生产工序编辑器 — 成衣订单 OrderLine.productionSteps 字段的专用渲染器。
 *
 * 查阅态：水平步进器（5 步：cutting → sewing → qc → packing → shipping）。
 * 编辑态：点击步骤按钮循环切换状态（pending → in_progress → done → pending）+ 日期 input。
 *
 * 视觉规范唯一真源：components/order/orderUiSpec.ts（stepBtn / stepConnector 配方）。
 * 禁止硬编码彩色 — 所有状态色走 orderSpec。
 */

import React from 'react';
import { Scissors, Layers, CheckCircle2, Package, ArrowRight } from 'lucide-react';
import type { ProductionStep } from '../../types';
import { createOrderUiSpec } from './orderUiSpec';
import CapsuleDateInput from '../ui/CapsuleDateInput';

interface ProductionStepsEditorProps {
  value: ProductionStep[] | null | undefined;
  isDarkMode?: boolean;
  readOnly?: boolean;
  onChange?: (value: ProductionStep[]) => void;
}

const STEP_LABELS: Record<ProductionStep['step'], string> = {
  cutting: '裁剪',
  sewing: '缝制',
  qc: '质检',
  packing: '包装',
  shipping: '出货',
};

const STEP_ICONS: Record<ProductionStep['step'], React.ReactNode> = {
  cutting: <Scissors size={14} />,
  sewing: <Layers size={14} />,
  qc: <CheckCircle2 size={14} />,
  packing: <Package size={14} />,
  shipping: <ArrowRight size={14} />,
};

const STEP_ORDER: ProductionStep['step'][] = ['cutting', 'sewing', 'qc', 'packing', 'shipping'];
const STATUS_CYCLE: ProductionStep['status'][] = ['pending', 'in_progress', 'done'];

/**
 * 确保五个步骤都存在（编辑态初始化时补全缺失步骤）。
 */
function ensureAllSteps(value: ProductionStep[] | null | undefined): ProductionStep[] {
  const existing = new Map(value?.map((s) => [s.step, s]) ?? []);
  return STEP_ORDER.map((step) => existing.get(step) ?? { step, status: 'pending' as const });
}

const ProductionStepsEditor: React.FC<ProductionStepsEditorProps> = ({
  value,
  isDarkMode = false,
  readOnly = true,
  onChange,
}) => {
  const spec = createOrderUiSpec(isDarkMode);

  // ── 查阅态：仅显示已有步骤 ──
  if (readOnly) {
    const steps = value ?? [];
    if (steps.length === 0) {
      return (
        <div className={`rounded-inset px-4 py-6 text-center text-xs font-light ${spec.fieldReadOnlyEmpty}`}>
          未设置生产工序
        </div>
      );
    }

    const sorted = [...steps].sort(
      (a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step),
    );

    return (
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
        {sorted.map((step, idx) => {
          const btnCls =
            step.status === 'done' ? spec.stepBtnDone :
            step.status === 'in_progress' ? spec.stepBtnCurrent :
            spec.stepBtnDisabled;
          const connectorCls =
            step.status === 'done' ? spec.stepConnectorDone : spec.stepConnectorPending;

          return (
            <React.Fragment key={step.step}>
              <div className="flex min-w-14 flex-col items-center gap-1.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-control border transition-colors duration-200 ${btnCls}`}>
                  {STEP_ICONS[step.step]}
                </div>
                <span className={`text-[10px] font-light tracking-wide ${spec.listRowSecondary}`}>
                  {STEP_LABELS[step.step]}
                </span>
                {step.date && (
                  <span className={`text-[10px] ${spec.listRowSecondary}`}>{step.date}</span>
                )}
              </div>
              {idx < sorted.length - 1 && (
                <div className={`h-px min-w-2 flex-1 ${connectorCls}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── 编辑态：五步全显，可点击切换状态 + 日期 input ──
  const steps = ensureAllSteps(value);

  const cycleStatus = (stepName: ProductionStep['step']) => {
    const current = steps.find((s) => s.step === stepName);
    if (!current) return;
    const currentIdx = STATUS_CYCLE.indexOf(current.status);
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];
    const next = steps.map((s) =>
      s.step === stepName ? { ...s, status: nextStatus } : s,
    );
    onChange?.(next);
  };

  const updateDate = (stepName: ProductionStep['step'], date: string) => {
    const next = steps.map((s) =>
      s.step === stepName ? { ...s, date: date || undefined } : s,
    );
    onChange?.(next);
  };

  const dateInputCls = `${spec.subFieldInput} ${spec.subFieldFocus} w-28 shrink-0`;

  return (
    <div className="space-y-3">
      {/* 步进器 — 可点击切换状态 */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
        {steps.map((step, idx) => {
          const btnCls =
            step.status === 'done' ? spec.stepBtnDone :
            step.status === 'in_progress' ? spec.stepBtnCurrent :
            spec.stepBtnActionable;
          const connectorCls =
            step.status === 'done' ? spec.stepConnectorDone : spec.stepConnectorPending;
          const statusLabel =
            step.status === 'done' ? '已完成' :
            step.status === 'in_progress' ? '进行中' : '待开始';

          return (
            <React.Fragment key={step.step}>
              <div className="flex min-w-16 flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => cycleStatus(step.step)}
                  title={`点击切换状态（当前：${statusLabel}）`}
                  className={`flex h-9 w-9 items-center justify-center rounded-control border transition-all duration-200 hover:scale-105 ${btnCls}`}
                >
                  {STEP_ICONS[step.step]}
                </button>
                <span className={`text-[10px] font-light tracking-wide ${spec.listRowSecondary}`}>
                  {STEP_LABELS[step.step]}
                </span>
                <span className={`text-[10px] font-light ${spec.listRowSecondary}`}>
                  {statusLabel}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`h-px min-w-2 flex-1 ${connectorCls}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 日期输入行 — 横向排列 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-inset px-3 py-2.5">
        {steps.map((step) => (
          <div key={`date-${step.step}`} className="flex items-center gap-1.5">
            <span className={`text-[10px] font-light ${spec.listRowSecondary}`}>
              {STEP_LABELS[step.step]}
            </span>
            <CapsuleDateInput
              value={step.date ?? ''}
              onChange={(v) => updateDate(step.step, v)}
              isDarkMode={isDarkMode}
              className={dateInputCls}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductionStepsEditor;
