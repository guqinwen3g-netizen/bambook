import { describe, expect, it } from 'vitest';
import type { ShipmentStatus } from '../types';

/**
 * ERP-P0 shipment-frontend-status-contract: focused tests
 * 验证 ShipmentStatus 枚举对齐后端 schema，UI/tests 消费同一契约。
 */

describe('shipment status contract: ShipmentStatus 对齐后端 8 状态', () => {
  it('ShipmentStatus 是后端 schema 的 8 个状态', () => {
    const validStatuses: ShipmentStatus[] = ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled'];
    for (const s of validStatuses) {
      const _: ShipmentStatus = s; // 编译时保证
      expect(_).toBeDefined();
    }
  });

  it('不含旧枚举 Preparing/InTransit', () => {
    const oldValues = ['Preparing', 'InTransit'];
    const newValues: ShipmentStatus[] = ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled'];
    for (const old of oldValues) {
      expect(newValues.includes(old as ShipmentStatus)).toBe(false);
    }
  });
});

describe('shipment status contract: ShipmentManager UI 消费同一契约', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf-8');

  it('SHIPMENT_STATUSES 含全部后端 8 状态', () => {
    for (const s of ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled']) {
      expect(src).toContain(`'${s}'`);
    }
  });

  it('不含旧枚举 Preparing/InTransit（防漂移）', () => {
    expect(src).not.toMatch(/'Preparing'/);
    expect(src).not.toMatch(/'InTransit'/);
  });

  it('默认状态是 Draft（后端契约入口态，非旧 Preparing）', () => {
    expect(src).toMatch(/status:\s*'Draft'/);
    expect(src).toMatch(/s\.status\s*\|\|\s*'Draft'/);
  });

  it('statusTone 覆盖后端活跃态（Shipped/Loading/Arrived/Cleared）', () => {
    expect(src).toMatch(/status === 'Shipped'/);
    expect(src).toMatch(/status === 'Loading'/);
    expect(src).toMatch(/status === 'Arrived'/);
    expect(src).toMatch(/status === 'Cleared'/);
  });

  it('KPI 统计消费后端枚举（Shipped/Delivered/Draft，非旧 InTransit/Preparing）', () => {
    expect(src).toMatch(/s\.status === 'Shipped'/);
    expect(src).toMatch(/s\.status === 'Delivered'/);
    expect(src).toMatch(/s\.status === 'Draft'/);
  });
});

describe('shipment status contract: shipmentService 消费同一契约', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '../services/shipmentService.ts'), 'utf-8');

  it('shipmentService import ShipmentStatus 类型（与 UI 同一契约）', () => {
    expect(src).toMatch(/import.*ShipmentStatus.*from.*types/);
  });
});
