import React from 'react';
import type { Order, Relation } from '../../types';
import type { FieldMeta, OrderClusterMeta, RoleFkTarget } from '../../lib/orderSchema';
import { PARTIES_SUBGROUPS } from '../../lib/orderSchema';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import SidePanelContainer from '../ui/SidePanelContainer';
import OrderFieldInput from './OrderFieldInput';

interface OrderClusterBlockProps {
  cluster: OrderClusterMeta;
  fields: FieldMeta[];
  order: Partial<Order>;
  isDarkMode?: boolean;
  /** Read-only mode renders inputs as disabled. */
  readOnly?: boolean;
  onChange: (patch: Partial<Order>) => void;
  relations?: Relation[];
  onCreateRelation?: (typedName: string, fkTarget: RoleFkTarget) => Promise<{ id: string; name: string } | null> | { id: string; name: string } | null;
  /** Optional accent color id for the cluster header strip. */
  accent?: string;
  /** Compact density (used inside the manual modal to fit more on screen). */
  density?: 'cozy' | 'compact';
  /** Called when a Relation is selected from a combobox, with the full Relation object for auto-fill. */
  onRelationSelected?: (fkField: string, relation: Relation) => void;
}

/**
 * Renders one cluster from the order field dictionary as a card with a
 * header strip and a responsive 2/3-column grid of generic field inputs.
 *
 * When fields have `subGroup` defined (e.g. the 'parties' cluster), they are
 * split into sub-cards, each with its own header and accent color.
 */
const OrderClusterBlock: React.FC<OrderClusterBlockProps> = ({
  cluster,
  fields,
  order,
  isDarkMode = false,
  readOnly = false,
  onChange,
  relations,
  onCreateRelation,
  accent,
  density = 'cozy',
  onRelationSelected,
}) => {
  if (fields.length === 0) return null;

  const sources = (order.fieldSources ?? {}) as Record<string, 'pdf' | 'manual' | 'imported-then-edited'>;

  const gridCls = density === 'compact'
    ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
    : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
  const panelPaddingCls = density === 'compact' ? 'scroll-mt-28 p-5' : 'scroll-mt-28 p-5 md:p-6';
  const sectionOverlineCls = `text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.denseOverline} uppercase ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`;
  const sectionTitleCls = `text-lg ${BAMBOOK_OS.typography.weight.ui} tracking-tight mt-1 ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`;
  const sectionSubtitleCls = `text-xs ${BAMBOOK_OS.typography.weight.ui} mt-2 ${isDarkMode ? 'text-white/42' : 'text-slate-500'}`;
  const subHeadingCls = `text-[11px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} ${isDarkMode ? 'text-white/75' : 'text-slate-700'}`;
  const subMetaCls = `text-[9px] ${BAMBOOK_OS.typography.weight.ui} uppercase ${BAMBOOK_OS.typography.tracking.overline} ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`;

  const hasSubGroups = fields.some((f) => f.subGroup);

  // If no sub-groups, render one shared OS panel.
  if (!hasSubGroups) {
    return (
      <SidePanelContainer
        as="section"
        id={`section-${cluster.id}`}
        materialRole="raisedCard"
        edgeFadeItem
        spotlight
        isDarkMode={isDarkMode}
        className={panelPaddingCls}
        contentClassName="relative z-10 space-y-6"
      >
        <header className="flex items-start justify-between">
          <div>
            <p className={sectionOverlineCls}>Order Section</p>
            <h4 className={sectionTitleCls}>
              {cluster.labelZh}
            </h4>
            <p className={sectionSubtitleCls}>
              {cluster.labelEn}
            </p>
          </div>
          {accent && (
            <span
              aria-hidden
              className="w-1.5 h-8 rounded-full"
              style={{ background: accent }}
            />
          )}
        </header>
        <div className={gridCls}>
          {fields.map((f) => (
            <OrderFieldInput
              key={f.key}
              field={f}
              order={order}
              isDarkMode={isDarkMode}
              disabled={readOnly}
              onChange={onChange}
              relations={relations}
              onCreateRelation={onCreateRelation}
              onRelationSelected={onRelationSelected}
              sourceTag={sources[f.key as string]}
            />
          ))}
        </div>
      </SidePanelContainer>
    );
  }

  // With sub-groups: group fields by subGroup, render each as a sub-card
  const subGroupMap = new Map<string, FieldMeta[]>();
  const noGroup: FieldMeta[] = [];
  for (const f of fields) {
    if (f.subGroup) {
      const list = subGroupMap.get(f.subGroup) ?? [];
      list.push(f);
      subGroupMap.set(f.subGroup, list);
    } else {
      noGroup.push(f);
    }
  }

  const subGroupMeta = (id: string) => PARTIES_SUBGROUPS.find((s) => s.id === id);

  return (
    <SidePanelContainer
      as="section"
      id={`section-${cluster.id}`}
      materialRole="raisedCard"
      edgeFadeItem
      spotlight
      isDarkMode={isDarkMode}
      className={panelPaddingCls}
      contentClassName="relative z-10 space-y-6"
    >
      <header className="flex items-start justify-between">
        <div>
          <p className={sectionOverlineCls}>Order Section</p>
          <h4 className={sectionTitleCls}>
            {cluster.labelZh}
          </h4>
          <p className={sectionSubtitleCls}>
            {cluster.labelEn}
          </p>
        </div>
      </header>

      <div className="space-y-3">
        {[...subGroupMap.entries()].map(([subId, subFields]) => {
          const meta = subGroupMeta(subId);
          return (
            <SidePanelContainer
              key={subId}
              as="section"
              id={`section-parties-${subId}`}
              materialRole="insetSurface"
              materialTone="nested"
              shadowMode="ghost"
              isDarkMode={isDarkMode}
              className="p-4 md:p-5"
              contentClassName="relative z-10"
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span
                  aria-hidden
                  className={`w-1.5 h-4 rounded-full ${meta?.accentColor ?? 'bg-[var(--os-vnext-brand-blue)]'}`}
                />
                <h5 className={subHeadingCls}>
                  {meta?.labelZh ?? subId}
                </h5>
                <span className={subMetaCls}>
                  {meta?.labelEn ?? ''}
                </span>
              </div>
              <div className={gridCls}>
                {subFields.map((f) => (
                  <OrderFieldInput
                    key={f.key}
                    field={f}
                    order={order}
                    isDarkMode={isDarkMode}
                    disabled={readOnly}
                    onChange={onChange}
                    relations={relations}
                    onCreateRelation={onCreateRelation}
                    onRelationSelected={onRelationSelected}
                    sourceTag={sources[f.key as string]}
                  />
                ))}
              </div>
            </SidePanelContainer>
          );
        })}

        {/* Fields without a subGroup (e.g. asPerson) */}
        {noGroup.length > 0 && (
          <div className={gridCls}>
            {noGroup.map((f) => (
              <OrderFieldInput
                key={f.key}
                field={f}
                order={order}
                isDarkMode={isDarkMode}
                disabled={readOnly}
                onChange={onChange}
                relations={relations}
                onCreateRelation={onCreateRelation}
                onRelationSelected={onRelationSelected}
                sourceTag={sources[f.key as string]}
              />
            ))}
          </div>
        )}
      </div>
    </SidePanelContainer>
  );
};

export default OrderClusterBlock;
