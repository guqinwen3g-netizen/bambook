/**
 * BOM 物料清单编辑器 — 成衣订单 OrderLine.bomItems 字段的专用渲染器。
 *
 * 查阅态：行列表（类型标签 + 名称 + 规格 + 数量 + 单位）。
 * 编辑态：表格化输入（类型 select + 名称 input + 规格 input + 数量 input + 单位 input + 删除）+ 添加按钮。
 *
 * 视觉规范唯一真源：components/order/orderUiSpec.ts（chip / rowPillSurface 配方）。
 * 禁止硬编码彩色 — 类型标签用 neutral chip，不用 Tailwind 彩色。
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import type { BomItem } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { createOrderUiSpec } from './orderUiSpec';

interface BomItemsEditorProps {
  value: BomItem[] | null | undefined;
  isDarkMode?: boolean;
  readOnly?: boolean;
  onChange?: (value: BomItem[]) => void;
}

const BOM_TYPE_LABELS: Record<BomItem['type'], string> = {
  fabric: '面料',
  lining: '里料',
  trim: '辅料',
  packaging: '包装',
};

const BOM_TYPE_OPTIONS: Array<{ value: BomItem['type']; label: string }> = [
  { value: 'fabric', label: '面料' },
  { value: 'lining', label: '里料' },
  { value: 'trim', label: '辅料' },
  { value: 'packaging', label: '包装' },
];

const BOM_UNITS = ['meter', 'yard', 'kg', 'piece', 'set', 'roll', 'm²'];

function createEmptyItem(): BomItem {
  return { type: 'fabric', name: '', spec: '', qty: 0, unit: 'meter' };
}

const BomItemsEditor: React.FC<BomItemsEditorProps> = ({
  value,
  isDarkMode = false,
  readOnly = true,
  onChange,
}) => {
  const spec = createOrderUiSpec(isDarkMode);
  const items = value ?? [];

  // ── 查阅态：行列表 ──
  if (readOnly) {
    if (items.length === 0) {
      return (
        <div className={`rounded-inset px-4 py-6 text-center text-xs font-light ${spec.fieldReadOnlyEmpty}`}>
          未设置 BOM 物料
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className={`flex items-center justify-between rounded-control px-3 py-2 ${spec.rowPillSurface}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-light uppercase tracking-widest ${spec.chip}`}>
                {BOM_TYPE_LABELS[item.type] ?? item.type}
              </span>
              <span className={`truncate text-xs font-light ${spec.listRowPrimary}`}>
                {item.name}
              </span>
              {item.spec && (
                <span className={`text-[10px] ${spec.listRowSecondary}`}>{item.spec}</span>
              )}
            </div>
            <span className={`ml-2 shrink-0 text-xs font-light ${spec.listRowPrimary}`}>
              {item.qty} {item.unit}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // ── 编辑态：表格化输入 ──
  const fieldSurfaceCls = isDarkMode
    ? BAMBOOK_OS.controls.recessedField.dark
    : BAMBOOK_OS.controls.recessedField.light;
  const fieldShellCls = `border outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all ${fieldSurfaceCls}`;
  const inputCls = `h-9 px-2.5 rounded-control ${fieldShellCls}`;

  const updateItem = (idx: number, patch: Partial<BomItem>) => {
    const next = items.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    onChange?.(next);
  };

  const addItem = () => {
    onChange?.([...items, createEmptyItem()]);
  };

  const removeItem = (idx: number) => {
    onChange?.(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className={`rounded-inset px-4 py-4 text-center text-xs font-light ${spec.fieldReadOnlyEmpty}`}>
          尚未添加 BOM 物料，点击下方按钮开始
        </div>
      )}

      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          {/* 类型 select */}
          <select
            value={item.type}
            onChange={(e) => updateItem(idx, { type: e.target.value as BomItem['type'] })}
            className={`${inputCls} w-16 shrink-0 cursor-pointer appearance-none pr-6`}
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23888' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 6px center',
            }}
          >
            {BOM_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* 名称 input */}
          <input
            type="text"
            value={item.name}
            onChange={(e) => updateItem(idx, { name: e.target.value })}
            placeholder="物料名称"
            className={`${inputCls} min-w-0 flex-1`}
          />

          {/* 规格 input */}
          <input
            type="text"
            value={item.spec ?? ''}
            onChange={(e) => updateItem(idx, { spec: e.target.value })}
            placeholder="规格"
            className={`${inputCls} w-20 shrink-0`}
          />

          {/* 数量 input */}
          <input
            type="number"
            value={item.qty}
            onChange={(e) => updateItem(idx, { qty: Number(e.target.value) || 0 })}
            placeholder="数量"
            min={0}
            step="0.01"
            className={`${inputCls} w-16 shrink-0 text-right`}
          />

          {/* 单位 select */}
          <select
            value={item.unit}
            onChange={(e) => updateItem(idx, { unit: e.target.value })}
            className={`${inputCls} w-16 shrink-0 cursor-pointer appearance-none pr-5`}
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23888' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 4px center',
            }}
          >
            {BOM_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

          {/* 删除按钮 */}
          <button
            type="button"
            onClick={() => removeItem(idx)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border transition-all ${
              isDarkMode
                ? 'border-white/10 text-white/40 hover:bg-white/[0.05] hover:text-white/70'
                : 'border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
            }`}
            title="删除此物料"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}

      {/* 添加按钮 */}
      <button
        type="button"
        onClick={addItem}
        className={`flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[11px] font-light transition-all ${
          isDarkMode
            ? 'border-white/20 text-white/60 hover:bg-white/[0.05] hover:border-white/30'
            : 'border-slate-300 text-slate-500 hover:bg-slate-100 hover:border-slate-400'
        }`}
      >
        <Plus size={12} strokeWidth={1.5} />
        添加物料
      </button>
    </div>
  );
};

export default BomItemsEditor;
