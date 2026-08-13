import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { Order, Relation, RelationCategory } from '../../types';
import type { FieldMeta, RoleFkTarget } from '../../lib/orderSchema';
import { currencySymbol, resolveCurrency } from '../../lib/orderSchema';
import { applyFillPatch, getFieldBinding } from '../../lib/fieldBindings';
import type { EntityCandidate } from '../../lib/entityRegistry';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import SmartLinkedInput from '../ui/SmartLinkedInput';
import RelationCombobox from './RelationCombobox';
import ToggleSwitch from '../ui/ToggleSwitch';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import { formatYmd } from '../../lib/dateFormat';
import { statusSemanticClass } from '../rdlBusinessStatusTokens';
import { createOrderUiSpec } from './orderUiSpec';

interface OrderFieldInputProps {
  field: FieldMeta;
  order: Partial<Order>;
  isDarkMode?: boolean;
  /** Disabled fields render read-only with a subdued style. */
  disabled?: boolean;
  /**
   * Read-only mode renders the field as plain text (no input chrome).
   * Use for the detail-page "查阅模式" so users can visually distinguish
   * "this is the saved value" from "this is an editable field".
   */
  readOnly?: boolean;
  /** Called with a partial patch — host applies it to its draft state. */
  onChange: (patch: Partial<Order>) => void;
  /** Required for relationFk fields. Without it the input falls back to plain text. */
  relations?: Relation[];
  /** Called when the user opts to create a new Relation from a combobox. */
  onCreateRelation?: (typedName: string, fkTarget: RoleFkTarget) => Promise<{ id: string; name: string } | null> | { id: string; name: string } | null;
  /** Optional source tag for the field — drives the small "PDF / 手填" pill next to the label. */
  sourceTag?: 'pdf' | 'manual' | 'imported-then-edited' | undefined;
  /** Layout: 'stacked' (default — label above input) or 'inline' (compact). */
  layout?: 'stacked' | 'inline';
  /** Called when a Relation is selected from a combobox, with the full Relation object for auto-fill. */
  onRelationSelected?: (fkField: string, relation: Relation) => void;
}

const ROLE_TO_CATEGORIES: Record<RoleFkTarget, RelationCategory[]> = {
  customer: ['Customer'],
  mill: ['Supplier'],
  consignee: ['Supplier', 'Partner'],
  billTo: ['Customer', 'Partner', 'Agent'],
  internal: ['Internal'],
};

/**
 * Generic field renderer driven by the order field dictionary.
 *
 * Renders the right input control for `field.type`:
 *   text / longText / number / date / boolean / enum
 *   currency  → text with $/¥ prefix (resolved per `field.currencySide`)
 *   relationFk → RelationCombobox (if `relations` supplied)
 *
 * Writes are surfaced as a partial Order patch through `onChange`. For
 * relation fields the patch contains both the snapshot name (e.g. `millName`)
 * and the FK column (e.g. `millRelationId`).
 */
const OrderFieldInput: React.FC<OrderFieldInputProps> = ({
  field,
  order,
  isDarkMode = false,
  disabled = false,
  readOnly = false,
  onChange,
  relations,
  onCreateRelation,
  sourceTag,
  layout = 'stacked',
  onRelationSelected,
}) => {
  const value = order[field.key as keyof Order];
  const orderSpec = createOrderUiSpec(isDarkMode);
  const fieldSurfaceCls = isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light;
  const labelTextCls = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const disabledCls = disabled ? 'opacity-60 cursor-not-allowed' : '';
  // rounded-full 仅适用于单行控件（input/select/boolean），textarea 多行使用 rounded-inset 保持视觉一致
  const fieldShellCls = `border outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all ${fieldSurfaceCls} ${disabledCls} ${orderSpec.subFieldFocus}`;
  const inputCls = `w-full h-10 px-4 rounded-full ${fieldShellCls}`;
  const textareaCls = `w-full px-4 py-3 rounded-inset ${fieldShellCls} resize-none leading-relaxed`;
  // 隐藏 Chromium number spinner，保持胶囊内排版纯净
  const noSpinnerCls = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
  const fieldSources = (order.fieldSources ?? {}) as Record<string, string>;
  const fieldBinding = getFieldBinding(String(field.key));

  const applyCandidate = (candidate: EntityCandidate) => {
    const patch = candidate.fillPatch
      ? applyFillPatch(order as Record<string, unknown>, candidate.fillPatch, { fieldSources }) as Partial<Order>
      : {};
    onChange({
      ...patch,
      [field.key]: candidate.title,
    } as Partial<Order>);
  };

  const labelEl = (
    <label className={`text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} ${labelTextCls} ml-1 flex items-center gap-2`}>
      <span>
        {field.labelZh}
        {/* 必填星号是录入约束的编辑语境元信息；查阅模式（档案态）不渲染，保持纯净 */}
        {field.required && !readOnly && <span className={`ml-0.5 ${orderSpec.fieldAsterisk}`}>*</span>}
      </span>
      {sourceTag && <SourcePill tag={sourceTag} isDarkMode={isDarkMode} />}
    </label>
  );

  const hintEl = field.hintZh ? (
    <p className={orderSpec.fieldHint}>{field.hintZh}</p>
  ) : null;

  // ---- Read-only: plain text display, no input chrome ----
  // 查阅模式走这条路：让用户一眼看出"这是已保存的值"，而不是一个可点的输入框。
  if (readOnly) {
    const emptyText = '—';
    // 档案态排版：值用 14px / 400 字重（正文档），与 10px caps 标签拉开编辑级层级
    const valueTextCls = orderSpec.fieldReadOnlyValue;
    // 空值语义降级：更小字号 + 轻字重 + 斜体 + 更淡字色，与有值形成视觉差
    const emptyTextCls = orderSpec.fieldReadOnlyEmpty;
    let display: React.ReactNode;
    if (field.type === 'boolean') {
      display = value ? '是' : '否';
    } else if (field.type === 'currency') {
      if (value === undefined || value === null || value === '') {
        display = null;
      } else {
        const code = resolveCurrency(order, field.currencySide ?? 'sales');
        const sym = currencySymbol(code);
        display = `${sym} ${String(value)} ${code}`;
      }
    } else if (field.type === 'longText') {
      display = (value as string | undefined)?.trim() || null;
    } else if (field.type === 'date') {
      display = formatYmd(value as string | undefined) || null;
    } else {
      display = value === undefined || value === null || value === '' ? null : String(value);
    }
    const isEmpty = display === null || display === undefined || display === '';
    // 档案感槽位：弱底色 + 小圆角，有值用稍亮底色，空值用更淡底色（暗示"有字段但无值"）
    const slotCls = isEmpty
      ? orderSpec.fieldSlotEmpty
      : orderSpec.fieldSlotFilled;
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <div className={`min-h-[24px] rounded-inset px-2.5 py-1 ${slotCls} ${field.type === 'longText' ? 'whitespace-pre-wrap' : 'truncate'}`}>
          <span className={isEmpty ? emptyTextCls : valueTextCls}>{isEmpty ? emptyText : display}</span>
        </div>
        {/* 查阅模式不渲染 hintEl：录入辅助说明是编辑语境元信息，档案态保持纯净（来源信息由 SourcePill 承载） */}
      </div>
    );
  }

  // ---- Relation FK: combobox ----
  if (field.relationFk && relations) {
    const fkColumn = `${field.relationFk}RelationId` as keyof Order;
    const relationId = order[fkColumn] as string | undefined;
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <RelationCombobox
          value={(value as string | undefined) ?? ''}
          relationId={relationId}
          relations={relations}
          filterCategories={ROLE_TO_CATEGORIES[field.relationFk]}
          isDarkMode={isDarkMode}
          placeholder={field.placeholder}
          required={field.required}
          inputClassName={`${inputCls} pr-9`}
          onChange={(next) => {
            const patch: Partial<Order> = {};
            (patch as any)[field.key] = next.name;
            (patch as any)[fkColumn] = next.relationId ?? null;
            onChange(patch);
            if (next.relationId && next.relation && onRelationSelected) {
              onRelationSelected(field.relationFk!, next.relation);
            }
          }}
          onCreateNew={
            onCreateRelation
              ? (typed) => onCreateRelation(typed, field.relationFk!)
              : undefined
          }
        />
        {hintEl}
      </div>
    );
  }

  // ---- Boolean: toggle switch ----
  if (field.type === 'boolean') {
    const on = !!value;
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <div className={`flex h-10 w-fit items-center gap-3 rounded-full px-4 ${fieldShellCls}`}>
          <ToggleSwitch
            checked={on}
            disabled={disabled}
            isDarkMode={isDarkMode}
            ariaLabel={field.labelZh}
            onChange={(next) => onChange({ [field.key]: next } as Partial<Order>)}
          />
          <span className="text-xs font-light">{on ? '是' : '否'}</span>
        </div>
        {hintEl}
      </div>
    );
  }

  // ---- Enum: select ----
  if (field.type === 'enum' && field.enumOptions) {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <div className="relative">
          <select
            className={`${inputCls} appearance-none pr-10 ${disabled ? '' : 'cursor-pointer'}`}
            disabled={disabled}
            value={(value as string | undefined) ?? ''}
            onChange={(e) => onChange({ [field.key]: e.target.value || undefined } as Partial<Order>)}
          >
            <option value="">— 请选择 —</option>
            {field.enumOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 ${orderSpec.fieldAsterisk}`}
          />
        </div>
        {hintEl}
      </div>
    );
  }

  // ---- Long text: textarea ----
  if (field.type === 'longText') {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <textarea
          rows={3}
          disabled={disabled}
          placeholder={field.placeholder}
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange({ [field.key]: e.target.value } as Partial<Order>)}
          className={textareaCls}
        />
        {hintEl}
      </div>
    );
  }

  // ---- Number ----
  if (field.type === 'number') {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <input
          type="number"
          disabled={disabled}
          placeholder={field.placeholder}
          value={(value as number | undefined) ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ [field.key]: v === '' ? undefined : Number(v) } as Partial<Order>);
          }}
          className={`${inputCls} ${noSpinnerCls}`}
        />
        {hintEl}
      </div>
    );
  }

  // ---- Date: 统一 YYYY-MM-DD 文本 + 原生 picker 按钮 ----
  if (field.type === 'date') {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <CapsuleDateInput
          value={(value as string | undefined) ?? ''}
          disabled={disabled}
          isDarkMode={isDarkMode}
          className={inputCls}
          onChange={(v) => onChange({ [field.key]: v || undefined } as Partial<Order>)}
        />
        {hintEl}
      </div>
    );
  }

  // ---- Currency ----
  if (field.type === 'currency') {
    const code = resolveCurrency(order, field.currencySide ?? 'sales');
    const sym = currencySymbol(code);
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <div className="relative">
          <span
            className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${BAMBOOK_OS.typography.weight.ui} ${orderSpec.fieldCurrencySymbol}`}
            title={code}
          >
            {sym}
          </span>
          <input
            type="number"
            disabled={disabled}
            placeholder="0.00"
            value={(value as number | undefined) ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ [field.key]: v === '' ? undefined : Number(v) } as Partial<Order>);
            }}
            className={`${inputCls} pl-8 pr-14 ${noSpinnerCls}`}
          />
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[9px] ${BAMBOOK_OS.typography.weight.ui} uppercase ${BAMBOOK_OS.typography.tracking.overline} ${orderSpec.fieldCurrencyCode}`}>
            {code}
          </span>
        </div>
        {hintEl}
      </div>
    );
  }

  // ---- Default: text ----
  if (fieldBinding) {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <SmartLinkedInput
          value={(value as string | undefined) ?? ''}
          fieldKey={String(field.key)}
          entityTypes={fieldBinding.entityTypes}
          isDarkMode={isDarkMode}
          disabled={disabled}
          placeholder={field.placeholder}
          className={inputCls}
          ownerContext={{
            customerRelationId: order.customerRelationId,
          }}
          onChange={(next) => onChange({ [field.key]: next } as Partial<Order>)}
          onCandidateSelected={applyCandidate}
        />
        {hintEl}
      </div>
    );
  }

  return (
    <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
      {labelEl}
      <input
        type="text"
        disabled={disabled}
        placeholder={field.placeholder}
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange({ [field.key]: e.target.value } as Partial<Order>)}
        className={inputCls}
      />
      {hintEl}
    </div>
  );
};

const SourcePill: React.FC<{ tag: 'pdf' | 'manual' | 'imported-then-edited'; isDarkMode: boolean }> = ({ tag, isDarkMode }) => {
  // 来源标签与 spec.chip 同构（px-2 / text-[10px] / font-light），语义色用 info（来源是辅助元信息）
  const label = tag === 'pdf' ? 'PDF' : tag === 'manual' ? '手填' : '手改';
  return (
    <span className={`shrink-0 rounded-full border px-2 py-px text-[10px] font-light ${statusSemanticClass('info', isDarkMode)}`}>{label}</span>
  );
};

export default OrderFieldInput;
