import React from 'react';
import type { Order, OrderLineLite, Relation } from '../../types';
import type { FieldMeta, OrderClusterMeta, RoleFkTarget } from '../../lib/orderSchema';
import { PARTIES_SUBGROUPS } from '../../lib/orderSchema';
import SidePanelContainer from '../ui/SidePanelContainer';
import OrderFieldInput from './OrderFieldInput';
import OrderLineFieldRenderer from './OrderLineFieldRenderer';
import OrderSectionHeader from './OrderSectionHeader';
import { createOrderUiSpec, type OrderSectionIconKey } from './orderUiSpec';

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
  /** Compact density (used inside the manual modal to fit more on screen). */
  density?: 'cozy' | 'compact';
  /** Called when a Relation is selected from a combobox, with the full Relation object for auto-fill. */
  onRelationSelected?: (fkField: string, relation: Relation) => void;
  /** OrderLine 级字段（level='line'）的数据源；lineScope='first' 时取首行。 */
  orderLine?: Partial<OrderLineLite> | null;
  /** OrderLine 级字段变更回调。 */
  onLineChange?: (patch: Partial<OrderLineLite>) => void;
}

/**
 * Renders one cluster from the order field dictionary as a card with the
 * unified OrderSectionHeader and a responsive grid of generic field inputs.
 *
 * When fields have `subGroup` defined (e.g. the 'parties' cluster), they are
 * split into neutral inset sub-cards (no colored accent bars — RDL neutral
 * contract), each with a text-only sub-group header.
 *
 * 视觉规范唯一真源：components/order/orderUiSpec.ts。
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
  density = 'cozy',
  onRelationSelected,
  orderLine,
  onLineChange,
}) => {
  if (fields.length === 0) return null;

  const spec = createOrderUiSpec(isDarkMode);
  const sources = (order.fieldSources ?? {}) as Record<string, 'pdf' | 'manual' | 'imported-then-edited'>;

  // 网格统一自规范真源：查阅态松弛（档案节奏）/ 编辑态紧凑；
  // compact 仅用于移动端录入 BottomSheet（与桌面详情不共享密度）
  const gridCls = density === 'compact'
    ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
    : readOnly
      ? spec.gridRead
      : spec.gridEdit;

  // 统一分区头：icon + kicker(EN) + title(中文)，与详情页所有面板同构
  const headerEl = (
    <OrderSectionHeader
      iconKey={cluster.id as OrderSectionIconKey}
      kicker={cluster.labelEn}
      title={cluster.labelZh}
      isDarkMode={isDarkMode}
    />
  );

  const renderField = (f: FieldMeta) => {
    // OrderLine 级字段（如成衣生产跟单：styleNo/sizeBreakdown/productionSteps/bomItems）
    if (f.level === 'line') {
      return (
        <OrderLineFieldRenderer
          key={f.key}
          field={f}
          line={orderLine}
          isDarkMode={isDarkMode}
          readOnly={readOnly}
          onChangeLine={onLineChange}
          relations={relations}
          onCreateRelation={onCreateRelation}
          onRelationSelected={onRelationSelected}
          sourceTag={sources[f.key as string]}
        />
      );
    }
    // Order 级字段：走标准 OrderFieldInput
    return (
      <OrderFieldInput
        key={f.key}
        field={f}
        order={order}
        isDarkMode={isDarkMode}
        readOnly={readOnly}
        onChange={onChange}
        relations={relations}
        onCreateRelation={onCreateRelation}
        onRelationSelected={onRelationSelected}
        sourceTag={sources[f.key as string]}
      />
    );
  };

  // If no sub-groups, render one shared OS panel.
  if (!fields.some((f) => f.subGroup)) {
    return (
      <SidePanelContainer
        as="section"
        id={`section-${cluster.id}`}
        materialRole="raisedCard"
        edgeFadeItem
        spotlight
        isDarkMode={isDarkMode}
        className={spec.panelClass}
        contentClassName={spec.panelContentClass}
      >
        {headerEl}
        <div className={gridCls}>
          {fields.map(renderField)}
        </div>
      </SidePanelContainer>
    );
  }

  // With sub-groups: group fields by subGroup, render each as an inset sub-card
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
      className={spec.panelClass}
      contentClassName={spec.panelContentClass}
    >
      {headerEl}

      <div className="space-y-4">
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
              className={spec.insetPadding}
              contentClassName={spec.panelContentClass}
            >
              {/* 子组头：小圆点前缀 + 中文标题（去掉 EN，避免与字段标签的 EN kicker 重复） */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`h-1 w-1 shrink-0 rounded-full ${spec.subGroupDot}`} />
                <h5 className={spec.subGroupTitle}>
                  {meta?.labelZh ?? subId}
                </h5>
              </div>
              <div className={gridCls}>
                {subFields.map(renderField)}
              </div>
            </SidePanelContainer>
          );
        })}

        {/* Fields without a subGroup (e.g. asPerson) */}
        {noGroup.length > 0 && (
          <div className={gridCls}>
            {noGroup.map(renderField)}
          </div>
        )}
      </div>
    </SidePanelContainer>
  );
};

export default OrderClusterBlock;
