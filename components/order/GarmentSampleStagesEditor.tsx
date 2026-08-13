/**
 * 成衣样衣阶段编辑器 — 成衣订单 OrderLine.garmentSampleStages 字段的专用渲染器。
 *
 * 四阶段流程：Proto Sample（开发样）→ Photo Sample（照片样）→ Size Set（尺码样）→ PP Sample（产前样）
 *
 * 查阅态：水平步进器（4 步），显示状态颜色 + 寄出/确认日期。
 * 编辑态：点击步骤按钮循环切换状态（pending → sent → confirmed → rejected）+ 每阶段寄出日期 + 确认日期 + 意见。
 *
 * 视觉规范唯一真源：components/order/orderUiSpec.ts（stepBtn / stepConnector 配方）。
 * 禁止硬编码彩色 — 所有状态色走 orderSpec。
 */

import React from 'react';
import { Shirt, Camera, Ruler, ClipboardCheck } from 'lucide-react';
import type { GarmentSampleStage } from '../../types';
import { createOrderUiSpec } from './orderUiSpec';

interface GarmentSampleStagesEditorProps {
  value: GarmentSampleStage[] | null | undefined;
  isDarkMode?: boolean;
  readOnly?: boolean;
  onChange?: (value: GarmentSampleStage[]) => void;
}

const STAGE_LABELS_EN: Record<GarmentSampleStage['stage'], string> = {
  proto: 'Proto',
  photo: 'Photo',
  sizeSet: 'Size Set',
  pp: 'PP',
};

const STAGE_LABELS_ZH: Record<GarmentSampleStage['stage'], string> = {
  proto: '开发样',
  photo: '照片样',
  sizeSet: '尺码样',
  pp: '产前样',
};

const STAGE_ICONS: Record<GarmentSampleStage['stage'], React.ReactNode> = {
  proto: <Shirt size={12} />,
  photo: <Camera size={12} />,
  sizeSet: <Ruler size={12} />,
  pp: <ClipboardCheck size={12} />,
};

const STAGE_ORDER: GarmentSampleStage['stage'][] = ['proto', 'photo', 'sizeSet', 'pp'];
const STATUS_CYCLE: GarmentSampleStage['status'][] = ['pending', 'sent', 'confirmed', 'rejected'];

const STATUS_LABELS: Record<GarmentSampleStage['status'], string> = {
  pending: '待寄出',
  sent: '已寄出',
  confirmed: '已确认',
  rejected: '已退回',
};

/** 确保四个阶段都存在（编辑态初始化时补全缺失阶段）。 */
function ensureAllStages(value: GarmentSampleStage[] | null | undefined): GarmentSampleStage[] {
  const existing = new Map(value?.map((s) => [s.stage, s]) ?? []);
  return STAGE_ORDER.map((stage) => existing.get(stage) ?? { stage, status: 'pending' as const });
}

/** 根据状态返回对应的 stepBtn 样式类。 */
function statusBtnCls(
  status: GarmentSampleStage['status'],
  spec: ReturnType<typeof createOrderUiSpec>,
): string {
  switch (status) {
    case 'sent':
      return spec.stepBtnCurrent;
    case 'confirmed':
      return spec.stepBtnDone;
    case 'rejected':
      // rejected 用 actionable 样式 + 删除线，表示需要重做
      return `${spec.stepBtnActionable} line-through`;
    default:
      return spec.stepBtnActionable;
  }
}

const GarmentSampleStagesEditor: React.FC<GarmentSampleStagesEditorProps> = ({
  value,
  isDarkMode = false,
  readOnly = true,
  onChange,
}) => {
  const spec = createOrderUiSpec(isDarkMode);

  // ── 查阅态：仅显示已有阶段 ──
  if (readOnly) {
    const stages = value ?? [];
    if (stages.length === 0) {
      return (
        <div className={`rounded-inset px-4 py-6 text-center text-xs font-light ${spec.fieldReadOnlyEmpty}`}>
          未设置样衣阶段
        </div>
      );
    }

    const sorted = [...stages].sort(
      (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
    );

    return (
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
        {sorted.map((stage, idx) => {
          const btnCls = statusBtnCls(stage.status, spec);
          const connectorCls =
            stage.status === 'confirmed' ? spec.stepConnectorDone : spec.stepConnectorPending;

          return (
            <React.Fragment key={stage.stage}>
              <div className="flex min-w-[68px] flex-col items-center gap-1.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-control border transition-all ${btnCls}`}>
                  {STAGE_ICONS[stage.stage]}
                </div>
                <span className={`text-[10px] font-light tracking-wide ${spec.listRowSecondary}`}>
                  {STAGE_LABELS_EN[stage.stage]}
                </span>
                <span className={`text-[10px] font-light ${spec.listRowSecondary}`}>
                  {STATUS_LABELS[stage.status]}
                </span>
                {stage.sentDate && (
                  <span className={`text-[10px] ${spec.listRowSecondary}`}>寄：{stage.sentDate}</span>
                )}
                {stage.confirmedDate && (
                  <span className={`text-[10px] ${spec.listRowSecondary}`}>确：{stage.confirmedDate}</span>
                )}
              </div>
              {idx < sorted.length - 1 && (
                <div className={`h-px min-w-[8px] flex-1 ${connectorCls}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── 编辑态：四步全显，可点击切换状态 + 日期/意见编辑 ──
  const stages = ensureAllStages(value);

  const cycleStatus = (stageName: GarmentSampleStage['stage']) => {
    const current = stages.find((s) => s.stage === stageName);
    if (!current) return;
    const currentIdx = STATUS_CYCLE.indexOf(current.status);
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];
    const next = stages.map((s) =>
      s.stage === stageName ? { ...s, status: nextStatus } : s,
    );
    onChange?.(next);
  };

  const updateField = (
    stageName: GarmentSampleStage['stage'],
    field: 'sentDate' | 'confirmedDate' | 'comments',
    val: string,
  ) => {
    const next = stages.map((s) =>
      s.stage === stageName ? { ...s, [field]: val || undefined } : s,
    );
    onChange?.(next);
  };

  const dateInputCls = `${spec.subFieldInput} ${spec.subFieldFocus} w-[92px] shrink-0`;
  const textInputCls = `${spec.subFieldInput} ${spec.subFieldFocus} flex-1 min-w-0`;

  return (
    <div className="space-y-3">
      {/* 步进器 — 可点击切换状态 */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
        {stages.map((stage, idx) => {
          const btnCls = statusBtnCls(stage.status, spec);
          const connectorCls =
            stage.status === 'confirmed' ? spec.stepConnectorDone : spec.stepConnectorPending;

          return (
            <React.Fragment key={stage.stage}>
              <div className="flex min-w-[72px] flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => cycleStatus(stage.stage)}
                  title={`${STAGE_LABELS_ZH[stage.stage]}（${STAGE_LABELS_EN[stage.stage]} Sample）— 当前：${STATUS_LABELS[stage.status]}，点击切换`}
                  className={`flex h-9 w-9 items-center justify-center rounded-control border transition-all hover:scale-105 ${btnCls}`}
                >
                  {STAGE_ICONS[stage.stage]}
                </button>
                <span className={`text-[10px] font-light tracking-wide ${spec.listRowSecondary}`}>
                  {STAGE_LABELS_EN[stage.stage]}
                </span>
                <span className={`text-[10px] font-light ${spec.listRowSecondary}`}>
                  {STATUS_LABELS[stage.status]}
                </span>
              </div>
              {idx < stages.length - 1 && (
                <div className={`h-px min-w-[8px] flex-1 ${connectorCls}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 每阶段详细编辑：寄出日期 + 确认日期 + 意见 */}
      <div className="space-y-2 rounded-inset px-3 py-2.5">
        {stages.map((stage) => (
          <div key={`edit-${stage.stage}`} className="flex items-center gap-2">
            {/* 阶段标签 */}
            <span className={`w-14 shrink-0 text-[10px] font-light ${spec.listRowSecondary}`}>
              {STAGE_LABELS_ZH[stage.stage]}
            </span>

            {/* 寄出日期 */}
            <input
              type="date"
              value={stage.sentDate ?? ''}
              onChange={(e) => updateField(stage.stage, 'sentDate', e.target.value)}
              placeholder="寄出"
              className={`${dateInputCls} shrink-0`}
              title="寄出日期"
            />

            {/* 确认日期 */}
            <input
              type="date"
              value={stage.confirmedDate ?? ''}
              onChange={(e) => updateField(stage.stage, 'confirmedDate', e.target.value)}
              placeholder="确认"
              className={`${dateInputCls} shrink-0`}
              title="确认日期"
            />

            {/* 意见 */}
            <input
              type="text"
              value={stage.comments ?? ''}
              onChange={(e) => updateField(stage.stage, 'comments', e.target.value)}
              placeholder="意见/反馈"
              className={textInputCls}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default GarmentSampleStagesEditor;
