import { describe, expect, it } from 'vitest';
import { View } from '../types';
import {
  BAMBOOK_MODULES,
  BAMBOOK_NAV_GROUP_ORDER,
  getPrimaryNavigationModules,
  groupPrimaryNavigationModules,
  type BambookNavGroup,
} from './moduleRegistry';

const allowAll = () => true;

describe('moduleRegistry 阶段 IA 导航分组契约（PRD 第二十四章）', () => {
  it('每个模块 order 落在自身组段内（防 49.x 补丁式插值回退）', () => {
    const bands = (Object.entries(BAMBOOK_NAV_GROUP_ORDER) as Array<[BambookNavGroup, number]>)
      .sort((a, b) => a[1] - b[1]);
    for (const moduleDefinition of BAMBOOK_MODULES) {
      const bandIndex = bands.findIndex(([group]) => group === moduleDefinition.nav.group);
      expect(bandIndex, `${moduleDefinition.id} 的 group 必须在 BAMBOOK_NAV_GROUP_ORDER 中`).toBeGreaterThanOrEqual(0);
      const bandStart = bands[bandIndex][1];
      const bandEnd = bands[bandIndex + 1]?.[1] ?? Number.POSITIVE_INFINITY;
      expect(
        moduleDefinition.nav.order >= bandStart && moduleDefinition.nav.order < bandEnd,
        `${moduleDefinition.id} order=${moduleDefinition.nav.order} 必须落在组段 [${bandStart}, ${bandEnd})`,
      ).toBe(true);
    }
  });

  it('一级导航按 PRD 24.2 业务流组序渲染（扁平序钉死）', () => {
    const modules = getPrimaryNavigationModules({ isAdmin: true, canAccessView: allowAll });
    expect(modules.map(m => m.view)).toEqual([
      // 经营总览
      View.Dashboard, View.Cockpit, View.Reports,
      // 客户与市场
      View.Relations, View.CRM, View.Suppliers, View.Emails, View.Seasons, View.Marketing,
      // 订单履约
      View.Products, View.Development, View.Quotations, View.Orders, View.Procurement,
      View.Inventory, View.QcWorkbench, View.Shipments, View.Customs,
      // 财务与成本
      View.PaymentVouchers, View.Pricing, View.BOM, View.Risks,
      // 平台
      View.Assistant, View.DataCenter, View.HR, View.BusinessTools, View.AdminPanel,
    ]);
  });

  it('分组切段产出五组，组序/组名/组内模块与扁平序一致', () => {
    const modules = getPrimaryNavigationModules({ isAdmin: true, canAccessView: allowAll });
    const sections = groupPrimaryNavigationModules(modules);
    expect(sections.map(s => s.group)).toEqual(['overview', 'customer', 'fulfillment', 'finance', 'platform']);
    expect(sections.map(s => s.label)).toEqual(['经营总览', '客户与市场', '订单履约', '财务与成本', '平台']);
    expect(sections.flatMap(s => s.modules)).toEqual(modules);
  });

  it('发票管理保持非 primary（deep-link 触达），不进入一级导航', () => {
    const modules = getPrimaryNavigationModules({ isAdmin: true, canAccessView: allowAll });
    expect(modules.some(m => m.view === View.Invoices)).toBe(false);
    expect(modules.some(m => m.view === View.MES)).toBe(false);
    expect(modules.some(m => m.view === View.Settings)).toBe(false);
  });

  it('非管理员不看到管理后台，但五组结构不变', () => {
    const modules = getPrimaryNavigationModules({ isAdmin: false, canAccessView: allowAll });
    expect(modules.some(m => m.view === View.AdminPanel)).toBe(false);
    const sections = groupPrimaryNavigationModules(modules);
    expect(sections.map(s => s.group)).toEqual(['overview', 'customer', 'fulfillment', 'finance', 'platform']);
  });
});
