/**
 * OrderLine 级字段渲染分发器。
 *
 * 当 FieldMeta.level === 'line' 时，OrderClusterBlock 调用本组件而非 OrderFieldInput。
 * 根据 FieldMeta.type 分发到对应的渲染器：
 *   - text      → OrderFieldInput（传入模拟 order 对象，读取 line 的值）
 *   - json*     → 对应的专用 Editor
 *
 * lineScope: 'first' 策略：取 order.lines[0] 的值（沿用历史 GarmentOrders 行为口径）。
 */

import React from 'react';
import type { OrderLineLite } from '../../types';
import type { FieldMeta } from '../../lib/orderSchema';
import type { Relation } from '../../types';
import type { RoleFkTarget } from '../../lib/orderSchema';
import OrderFieldInput from './OrderFieldInput';
import SizeBreakdownEditor from './SizeBreakdownEditor';
import ProductionStepsEditor from './ProductionStepsEditor';
import BomItemsEditor from './BomItemsEditor';
import GarmentSampleStagesEditor from './GarmentSampleStagesEditor';

interface OrderLineFieldRendererProps {
  field: FieldMeta;
  line: Partial<OrderLineLite> | null | undefined;
  isDarkMode?: boolean;
  readOnly?: boolean;
  onChangeLine?: (patch: Partial<OrderLineLite>) => void;
  relations?: Relation[];
  onCreateRelation?: (typedName: string, fkTarget: RoleFkTarget) => Promise<{ id: string; name: string } | null> | { id: string; name: string } | null;
  onRelationSelected?: (fkField: string, relation: Relation) => void;
  sourceTag?: 'pdf' | 'manual' | 'imported-then-edited';
}

const OrderLineFieldRenderer: React.FC<OrderLineFieldRendererProps> = ({
  field,
  line,
  isDarkMode = false,
  readOnly = true,
  onChangeLine,
  relations,
  onCreateRelation,
  onRelationSelected,
  sourceTag,
}) => {
  const key = field.key as keyof OrderLineLite;

  // text 类型：复用 OrderFieldInput，传入模拟 order（将 line 的值映射为 order 属性）
  if (field.type === 'text' || field.type === 'longText') {
    // 构造一个 Partial<Order> 兼容对象，让 OrderFieldInput 能读取 line 上的值
    const fakeOrder = { [field.key]: (line?.[key] ?? '') as any } as any;
    const fakeOnChange = (patch: Partial<any>) => {
      const val = patch[field.key];
      onChangeLine?.({ [key]: val } as any);
    };
    return (
      <OrderFieldInput
        field={field}
        order={fakeOrder}
        isDarkMode={isDarkMode}
        readOnly={readOnly}
        onChange={fakeOnChange}
        relations={relations}
        onCreateRelation={onCreateRelation}
        onRelationSelected={onRelationSelected}
        sourceTag={sourceTag}
      />
    );
  }

  // json 类型：分发到专用 Editor
  const value = line?.[key] as any;

  switch (field.type) {
    case 'jsonSizeBreakdown':
      return (
        <SizeBreakdownEditor
          value={value}
          isDarkMode={isDarkMode}
          readOnly={readOnly}
          onChange={(v) => onChangeLine?.({ [key]: v } as any)}
        />
      );
    case 'jsonProductionSteps':
      return (
        <ProductionStepsEditor
          value={value}
          isDarkMode={isDarkMode}
          readOnly={readOnly}
          onChange={(v) => onChangeLine?.({ [key]: v } as any)}
        />
      );
    case 'jsonBomItems':
      return (
        <BomItemsEditor
          value={value}
          isDarkMode={isDarkMode}
          readOnly={readOnly}
          onChange={(v) => onChangeLine?.({ [key]: v } as any)}
        />
      );
    case 'jsonGarmentSampleStages':
      return (
        <GarmentSampleStagesEditor
          value={value}
          isDarkMode={isDarkMode}
          readOnly={readOnly}
          onChange={(v) => onChangeLine?.({ [key]: v } as any)}
        />
      );
    default:
      return null;
  }
};

export default OrderLineFieldRenderer;
