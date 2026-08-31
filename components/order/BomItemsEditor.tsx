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
import { createOrderUiSpec } from './orderUiSpec';
import CustomSelect from '../ui/CustomSelect';

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
  const inputCls = `bds-input sm ${spec.subFieldFocus}`;

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
          <CustomSelect
            options={BOM_TYPE_OPTIONS}
            value={item.type}
            onChange={(v) => updateItem(idx, { type: v as BomItem['type'] })}
            size="compact"
            className="w-16 shrink-0"
          />

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
          <CustomSelect
            options={BOM_UNITS.map((u) => ({ value: u, label: u }))}
            value={item.unit}
            onChange={(v) => updateItem(idx, { unit: v })}
            size="compact"
            className="w-16 shrink-0"
          />

          {/* 删除按钮 */}
          <button
            type="button"
            onClick={() => removeItem(idx)}
            className={spec.deleteBtn}
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
        className={spec.addBtn}
      >
        <Plus size={14} strokeWidth={1.5} />
        添加物料
      </button>
    </div>
  );
};

export default BomItemsEditor;
