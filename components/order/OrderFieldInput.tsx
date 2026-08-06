import React from 'react';
import type { Order, Relation, RelationCategory } from '../../types';
import type { FieldMeta, RoleFkTarget } from '../../lib/orderSchema';
import { currencySymbol, resolveCurrency } from '../../lib/orderSchema';
import { applyFillPatch, getFieldBinding } from '../../lib/fieldBindings';
import type { EntityCandidate } from '../../lib/entityRegistry';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import SmartLinkedInput from '../ui/SmartLinkedInput';
import RelationCombobox from './RelationCombobox';

interface OrderFieldInputProps {
  field: FieldMeta;
  order: Partial<Order>;
  isDarkMode?: boolean;
  /** Disabled fields render read-only with a subdued style. */
  disabled?: boolean;
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
  onChange,
  relations,
  onCreateRelation,
  sourceTag,
  layout = 'stacked',
  onRelationSelected,
}) => {
  const value = order[field.key as keyof Order];
  const fieldSurfaceCls = isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light;
  const labelTextCls = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const disabledCls = disabled ? 'opacity-60 cursor-not-allowed' : '';
  const fieldShellCls = `border rounded-full outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all ${fieldSurfaceCls} ${disabledCls}`;
  const inputCls = `w-full h-9 px-3 ${fieldShellCls}`;
  const textareaCls = `w-full px-3 py-3 ${fieldShellCls} resize-none leading-relaxed`;
  const relationComboboxCls = '[&_input]:h-9 [&_input]:rounded-full [&_input]:py-0 [&_input]:font-light [&_input]:transition-all';
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
        {field.required && <span className="text-slate-400 ml-0.5">*</span>}
      </span>
      {sourceTag && <SourcePill tag={sourceTag} isDarkMode={isDarkMode} />}
    </label>
  );

  const hintEl = field.hintZh ? (
    <p className={`text-[9px] ${BAMBOOK_OS.typography.weight.ui} ml-1 ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>{field.hintZh}</p>
  ) : null;

  // ---- Relation FK: combobox ----
  if (field.relationFk && relations) {
    const fkColumn = `${field.relationFk}RelationId` as keyof Order;
    const relationId = order[fkColumn] as string | undefined;
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <div className={relationComboboxCls}>
          <RelationCombobox
            value={(value as string | undefined) ?? ''}
            relationId={relationId}
            relations={relations}
            filterCategories={ROLE_TO_CATEGORIES[field.relationFk]}
            isDarkMode={isDarkMode}
            placeholder={field.placeholder}
            required={field.required}
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
        </div>
        {hintEl}
      </div>
    );
  }

  // ---- Boolean: checkbox ----
  if (field.type === 'boolean') {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <label className={`flex h-9 items-center gap-2 px-3 rounded-full cursor-pointer ${fieldShellCls}`}>
          <input
            type="checkbox"
            checked={!!value}
            disabled={disabled}
            onChange={(e) => onChange({ [field.key]: e.target.checked } as Partial<Order>)}
          />
          <span className="text-xs font-light">{value ? '是' : '否'}</span>
        </label>
        {hintEl}
      </div>
    );
  }

  // ---- Enum: select ----
  if (field.type === 'enum' && field.enumOptions) {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <select
          className={inputCls}
          disabled={disabled}
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange({ [field.key]: e.target.value || undefined } as Partial<Order>)}
        >
          <option value="">— 请选择 —</option>
          {field.enumOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
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
          className={inputCls}
        />
        {hintEl}
      </div>
    );
  }

  // ---- Date ----
  if (field.type === 'date') {
    return (
      <div className={layout === 'stacked' ? 'space-y-1.5' : 'flex items-center gap-2'}>
        {labelEl}
        <input
          type="date"
          disabled={disabled}
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange({ [field.key]: e.target.value || undefined } as Partial<Order>)}
          className={inputCls}
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
            className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${BAMBOOK_OS.typography.weight.ui} ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}
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
            className={`${inputCls} pl-8`}
          />
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[9px] ${BAMBOOK_OS.typography.weight.ui} uppercase ${BAMBOOK_OS.typography.tracking.overline} ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
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
  const styles =
    tag === 'pdf'
      ? isDarkMode
        ? 'bg-white/10 text-white/70 border-white/15'
        : 'bg-slate-100 text-slate-600 border-slate-200'
      : tag === 'manual'
        ? isDarkMode
          ? 'bg-white/10 text-white/70 border-white/15'
          : 'bg-slate-100 text-slate-600 border-slate-200'
        : isDarkMode
          ? 'bg-white/10 text-white/70 border-white/15'
          : 'bg-slate-100 text-slate-600 border-slate-200';
  const label = tag === 'pdf' ? 'PDF' : tag === 'manual' ? '手填' : '手改';
  return (
    <span className={`px-1.5 py-px rounded-full text-[8px] font-light tracking-wider border ${styles}`}>{label}</span>
  );
};

export default OrderFieldInput;
