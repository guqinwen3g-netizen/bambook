import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRecordGroups, type PaletteData } from './CommandPalette';

const source = readFileSync(new URL('./CommandPalette.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const emptyData: PaletteData = {
  relations: [], orders: [], products: [], invoices: [], shipments: [], knowledge: [], emails: [],
};

const sampleData: PaletteData = {
  relations: [
    { id: 'REL_1', name: 'Alpha Textiles', contactInfo: 'alpha@example.com', type: 'Customer', isOrganization: true, category: 'Client', tags: [], rating: 5 } as any,
    { id: 'REL_2', name: 'Beta Garments', contactInfo: 'beta@example.com', type: 'Supplier', isOrganization: true, category: 'Factory', tags: [], rating: 4 } as any,
    { id: 'REL_3', name: 'Alpha Deleted', contactInfo: 'gone@example.com', type: 'Customer', isOrganization: true, category: 'Client', tags: [], rating: 1, deletedAt: 1 } as any,
  ],
  orders: [
    { id: 'ORD_1', poNumber: 'PO-2026-001', customer: 'Alpha Textiles', product: 'Cotton Twill', type: 'Fabric', quantity: 1000, status: 'Production', dueDate: '2026-09-01', quoteAmount: 5000 } as any,
    { id: 'ORD_2', poNumber: 'PO-2026-002', customer: 'Beta Garments', product: 'Denim Jacket', type: 'Garment', quantity: 200, status: 'Pending', dueDate: '2026-10-01', quoteAmount: 8000 } as any,
  ],
  products: [
    { id: 'PRD_1', sku: 'CTN-TWL-01', name: 'Cotton Twill 21s', mainCategory: 'Fabric', subCategoryId: 'x', season: 'SS26', cost: 10, status: 'Active', updatedAt: 1 } as any,
  ],
  invoices: [
    { id: 'INV_1', invoiceNumber: 'INV-2026-100', customerName: 'Alpha Textiles', type: 'Commercial', status: 'Issued', amount: 5000 } as any,
  ],
  shipments: [
    { id: 'SHP_1', shipmentNumber: 'SHP-001', status: 'Booked' } as any,
  ],
  knowledge: [
    { id: 'KN_1', title: 'Alpha 验货标准', content: 'AQL 2.5', category: 'Policy', updatedAt: 1 } as any,
  ],
  emails: [
    { id: 'EML_1', subject: 'Re: PO-2026-001 交期确认', sender: 'Alpha <alpha@example.com>', date: new Date(), isRead: true } as any,
  ],
};

describe('D1 · buildRecordGroups 全局数据搜索', () => {
  it('空查询返回空分组（空查询只展示视图指令）', () => {
    expect(buildRecordGroups('', sampleData)).toEqual([]);
    expect(buildRecordGroups('   ', sampleData)).toEqual([]);
  });

  it('跨域匹配：一个查询命中客户/订单/发票/知识/邮件', () => {
    const groups = buildRecordGroups('alpha', sampleData);
    const domains = groups.map(g => g.domain);
    expect(domains).toContain('客户');
    expect(domains).toContain('订单');
    expect(domains).toContain('发票');
    expect(domains).toContain('知识');
    expect(domains).toContain('邮件');
    // DOMAIN_ORDER 稳定排序：客户 在 订单 前
    expect(domains.indexOf('客户')).toBeLessThan(domains.indexOf('订单'));
  });

  it('大小写不敏感 + poNumber/单号匹配', () => {
    const ord = buildRecordGroups('po-2026-001', sampleData)[0].items[0];
    expect(ord.kind === 'record' && ord.id).toBe('ORD_1');
    const shp = buildRecordGroups('SHP-001', sampleData)[0].items[0];
    expect(shp.kind === 'record' && shp.id).toBe('SHP_1');
  });

  it('软删记录被排除', () => {
    const groups = buildRecordGroups('alpha', sampleData);
    const customerGroup = groups.find(g => g.domain === '客户')!;
    const ids = customerGroup.items.map(i => (i.kind === 'record' ? i.id : ''));
    expect(ids).not.toContain('REL_3');
  });

  it('每域最多 5 条（防大列表淹没面板）', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `REL_M${i}`, name: `Match Corp ${i}`, contactInfo: '', type: 'Customer', isOrganization: true, category: 'Client', tags: [], rating: 3,
    })) as any[];
    const groups = buildRecordGroups('match', { ...emptyData, relations: many });
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(5);
  });

  it('订单记录携带 order 引用（直开详情合约）', () => {
    const groups = buildRecordGroups('PO-2026-001', sampleData);
    const item = groups[0].items[0];
    expect(item.kind).toBe('record');
    expect((item as any).order?.id).toBe('ORD_1');
  });

  it('无匹配域整体缺席（不渲染空分组标题）', () => {
    const groups = buildRecordGroups('zzzz-nothing', sampleData);
    expect(groups).toEqual([]);
  });
});

describe('D1 · CommandPalette 结构纪律', () => {
  it('键盘契约：↑↓ 导航 / Enter 执行 / Esc 关闭', () => {
    expect(source).toContain("e.key === 'ArrowDown'");
    expect(source).toContain("e.key === 'ArrowUp'");
    expect(source).toContain("e.key === 'Enter'");
    expect(source).toContain("e.key === 'Escape'");
  });

  it('视图指令走 moduleRegistry + canAccessView 权限过滤（与侧边栏同口径）', () => {
    expect(source).toContain('getPrimaryNavigationModules');
    expect(source).toContain('canAccessView');
  });

  it('RDL flat 纪律：RdlSurface 容器，零硬编码圆角/hex/box-shadow', () => {
    expect(source).toContain('RdlSurface');
    expect(source).not.toMatch(/rounded-\[\d+px\]/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toContain('box-shadow');
  });

  it('App 接线：Cmd/Ctrl+K 快捷键 + 面板挂载 + 订单直开回写 selectedOrder', () => {
    expect(appSource).toContain("event.key.toLowerCase() !== 'k'");
    expect(appSource).toContain('setPaletteOpen');
    expect(appSource).toContain('<CommandPalette');
    expect(appSource).toContain('onOpenOrder={(order) => { setPaletteOpen(false); setSelectedOrder(order); handleViewChange(View.Orders); }}');
  });
});
