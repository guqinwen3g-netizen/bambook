/**
 * 尺码分配编辑器 — 成衣订单 OrderLine.sizeBreakdown 字段的专用渲染器。
 *
 * 查阅态：柱状图（每尺码一列，柱高度按 qty / maxQty 比例）。
 * 编辑态：尺码行列表（尺码名 + 数量 + 删除）+ 添加按钮 + 实时柱状图预览。
 *
 * 视觉规范唯一真源：components/order/orderUiSpec.ts（stepBtn / timelineDot 配方）。
 * 禁止硬编码彩色 — 所有状态色走 orderSpec 或 statusSemanticClass。
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { createOrderUiSpec } from './orderUiSpec';

interface SizeBreakdownEditorProps {
  value: Record<string, number> | null | undefined;
  isDarkMode?: boolean;
  readOnly?: boolean;
  onChange?: (value: Record<string, number>) => void;
}

const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

const SizeBreakdownEditor: React.FC<SizeBreakdownEditorProps> = ({
  value,
  isDarkMode = false,
  readOnly = true,
  onChange,
}) => {
  const spec = createOrderUiSpec(isDarkMode);
  const entries = value ? Object.entries(value).filter(([, qty]) => qty > 0) : [];

  // ── 查阅态：柱状图 ──
  if (readOnly) {
    if (entries.length === 0) {
      return (
        <div className={`rounded-inset px-4 py-6 text-center text-xs font-light ${spec.fieldReadOnlyEmpty}`}>
          未设置尺码分配
        </div>
      );
    }

    const maxQty = Math.max(...entries.map(([, qty]) => qty));

    return (
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {entries.map(([size, qty]) => {
          const ratio = maxQty > 0 ? qty / maxQty : 0;
          return (
            <div key={size} className="flex flex-col items-center gap-1.5">
              <span className={`text-[10px] font-light tracking-wide ${spec.listRowSecondary}`}>
                {size}
              </span>
              <div className={`h-16 w-full overflow-hidden rounded-control flex items-end ${spec.fieldSlotEmpty}`}>
                <div
                  className={`w-full rounded-t-md transition-all duration-500 ${spec.timelineDotActive}`}
                  style={{ height: `${ratio * 100}%` }}
                />
              </div>
              <span className={`text-xs font-light ${spec.listRowPrimary}`}>{qty}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── 编辑态：行列表 + 实时预览 ──
  const fieldSurfaceCls = isDarkMode
    ? BAMBOOK_OS.controls.recessedField.dark
    : BAMBOOK_OS.controls.recessedField.light;
  const fieldShellCls = `border outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all ${fieldSurfaceCls}`;
  const inputCls = `h-9 px-3 rounded-control ${fieldShellCls}`;

  const allEntries = value ? Object.entries(value) : [];

  const updateEntry = (oldKey: string, newKey: string, newQty: number) => {
    const next = { ...(value ?? {}) };
    delete next[oldKey];
    if (newKey.trim()) {
      next[newKey.trim()] = newQty;
    }
    onChange?.(next);
  };

  const addEntry = (size: string = '') => {
    const next = { ...(value ?? {}) };
    // 避免重复 key
    let key = size || `尺码 ${allEntries.length + 1}`;
    while (next[key] !== undefined) {
      key = `${key}′`;
    }
    next[key] = 0;
    onChange?.(next);
  };

  const removeEntry = (key: string) => {
    const next = { ...(value ?? {}) };
    delete next[key];
    onChange?.(next);
  };

  return (
    <div className="space-y-3">
      {/* 实时柱状图预览 */}
      {entries.length > 0 && (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
          {entries.map(([size, qty]) => {
            const maxQty = Math.max(...entries.map(([, q]) => q), 1);
            const ratio = maxQty > 0 ? qty / maxQty : 0;
            return (
              <div key={size} className="flex flex-col items-center gap-1.5">
                <span className={`text-[10px] font-light tracking-wide ${spec.listRowSecondary}`}>
                  {size}
                </span>
                <div className={`h-14 w-full overflow-hidden rounded-control flex items-end ${spec.fieldSlotEmpty}`}>
                  <div
                    className={`w-full rounded-t-md transition-all duration-300 ${spec.timelineDotActive}`}
                    style={{ height: `${ratio * 100}%` }}
                  />
                </div>
                <span className={`text-xs font-light ${spec.listRowPrimary}`}>{qty}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 尺码行列表 */}
      <div className="space-y-2">
        {allEntries.length === 0 && (
          <div className={`rounded-inset px-4 py-4 text-center text-xs font-light ${spec.fieldReadOnlyEmpty}`}>
            尚未添加尺码，点击下方按钮开始
          </div>
        )}
        {allEntries.map(([size, qty]) => (
          <div key={size} className="flex items-center gap-2">
            <input
              type="text"
              value={size}
              onChange={(e) => updateEntry(size, e.target.value, qty)}
              placeholder="尺码"
              className={`${inputCls} w-20 shrink-0 text-center`}
            />
            <input
              type="number"
              value={qty}
              onChange={(e) => updateEntry(size, size, Number(e.target.value) || 0)}
              placeholder="数量"
              min={0}
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              onClick={() => removeEntry(size)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border transition-all ${
                isDarkMode
                  ? 'border-white/10 text-white/40 hover:bg-white/[0.05] hover:text-white/70'
                  : 'border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
              }`}
              title="删除此尺码"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>

      {/* 添加尺码 — 常用尺码快捷 + 自定义 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`mr-1 text-[10px] font-light ${spec.listRowSecondary}`}>快捷添加：</span>
        {COMMON_SIZES.map((s) => {
          const exists = value?.[s] !== undefined;
          return (
            <button
              key={s}
              type="button"
              disabled={exists}
              onClick={() => addEntry(s)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-light transition-all ${
                exists
                  ? isDarkMode
                    ? 'border-white/5 text-white/20 cursor-not-allowed'
                    : 'border-slate-100 text-slate-300 cursor-not-allowed'
                  : isDarkMode
                    ? 'border-white/15 text-white/70 hover:bg-white/[0.05] hover:border-white/25'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
              }`}
            >
              {s}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => addEntry()}
          className={`ml-1 flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[10px] font-light transition-all ${
            isDarkMode
              ? 'border-white/20 text-white/60 hover:bg-white/[0.05] hover:border-white/30'
              : 'border-slate-300 text-slate-500 hover:bg-slate-100 hover:border-slate-400'
          }`}
        >
          <Plus size={11} strokeWidth={1.5} />
          自定义
        </button>
      </div>
    </div>
  );
};

export default SizeBreakdownEditor;
