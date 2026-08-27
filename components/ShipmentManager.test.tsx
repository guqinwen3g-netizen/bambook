import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getShipmentFormStatusOptions } from './ShipmentManager';

const source = readFileSync(new URL('./ShipmentManager.tsx', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../services/shipmentService.ts', import.meta.url), 'utf8');
const transitionSource = readFileSync(new URL('../server/src/statusTransition.ts', import.meta.url), 'utf8');

describe('ShipmentManager REQ2-20（DR-061）旺季舱位预警', () => {
  it('预警区块：标题 + 待订舱计数徽章 + 规则口径（旺季月份/提前天数/平时天数）', () => {
    expect(source).toContain('舱位预警 BOOKING');
    expect(source).toContain('{bookingReminders.items.length} 单待订舱');
    expect(source).toContain('规则：旺季（{bookingReminders.rule.peakMonths.map(m => `${m} 月`).join(\'/\')}）提前 {bookingReminders.rule.peakDays} 天 · 平时提前 {bookingReminders.rule.normalDays} 天');
  });

  it('数据加载：getBookingReminders 挂载即拉取，失败静默不阻断主列表，卸载防泄漏', () => {
    expect(source).toContain('shipmentService.getBookingReminders()');
    expect(source).toContain('预警加载失败不阻断主列表');
    expect(source).toContain('let cancelled = false');
  });

  it('分级徽章语义变体：overdue→danger 已过交期 / urgent→warning 紧急 / 其余→neutral 待订舱', () => {
    expect(source).toContain("item.level === 'overdue' ? 'danger' : item.level === 'urgent' ? 'warning' : 'neutral'");
    expect(source).toContain("item.level === 'overdue' ? '已过交期' : item.level === 'urgent' ? '紧急' : '待订舱'");
  });

  it('行内容：客户 + PO + 交期 + 旺季标记 + 建议文案；无出运安排为空的订单不渲染区块', () => {
    expect(source).toContain('{item.customer}');
    expect(source).toContain('{item.poNumber &&');
    expect(source).toContain('交期 {item.dueDate}');
    expect(source).toContain('{item.isPeak && <span className="bds-badge info">旺季</span>}');
    expect(source).toContain('{item.suggestion}');
    expect(source).toContain('bookingReminders.items.length > 0 && (');
  });

  it('service 层契约：GET /v1/shipping/booking-reminders（rule + items 结构化返回）', () => {
    expect(serviceSource).toContain("buildApiUrl('/v1/shipping/booking-reminders', base)");
    expect(serviceSource).toContain('async getBookingReminders');
    expect(serviceSource).toContain('leadDays: number; isPeak: boolean; requiredByDate: string; remainingDays: number');
  });
});

// ────────────────────────────────────────────────────────────────
// 批次 F（2026-08-27 功能修复任务包批次二）：F1 费用字段 / F2 分批+合票入口 / F3 状态引导 / F4 删除权限 / F5 承运人去重
// ────────────────────────────────────────────────────────────────

describe('F1 运单表单费用字段（运费/保险/报关/其他，金额+币种）', () => {
  it('表单新增「费用信息」分区，含四组金额+币种字段', () => {
    expect(source).toContain("id: 'shipment-fees'");
    expect(source).toContain("title: '费用信息'");
    for (const name of ['freightAmount', 'freightCurrency', 'insuranceAmount', 'insuranceCurrency', 'customsAmount', 'customsCurrency', 'otherCharges', 'otherChargesCurrency']) {
      expect(source).toContain(`name: '${name}'`);
    }
  });

  it('draft 三件套覆盖费用字段（类型/createEmptyDraft/draftFromShipment）', () => {
    expect(source).toMatch(/freightAmount: string;\s*\n\s*freightCurrency: string;/);
    expect(source).toContain("freightCurrency: 'USD'");
    expect(source).toContain("s.freightAmount != null ? String(s.freightAmount) : ''");
  });

  it('buildPayload 提交费用字段（币种仅在填了金额时提交）', () => {
    expect(source).toContain('freightAmount: numOrUndef(d.freightAmount) as any');
    expect(source).toContain('freightCurrency: d.freightAmount.trim() ? maybe(d.freightCurrency) : undefined');
    expect(source).toContain('otherCharges: numOrUndef(d.otherCharges) as any');
  });

  it('详情面板展示已保存费用（运费/保险费/报关费/其他费用）', () => {
    expect(source).toContain("{ label: '运费', value:");
    expect(source).toContain("{ label: '保险费', value:");
    expect(source).toContain("{ label: '报关费', value:");
    expect(source).toContain("{ label: '其他费用', value:");
  });
});

describe('F2 分批出运/合票出运入口', () => {
  it('详情面板有「分批出运」入口（有关联订单时），复用订单 OrderShipmentBatchPanel', () => {
    expect(source).toContain("import { OrderShipmentBatchPanel } from './orders/OrderShipmentBatchPanel'");
    expect(source).toContain('分批出运');
    expect(source).toContain('setShowBatchPanel(true)');
    expect(source).toContain('<OrderShipmentBatchPanel orderId={selectedShipment.orderId}');
  });

  it('详情面板有「合票出运」入口，AllocationEditorModal 消费票内分配 API', () => {
    expect(source).toContain('合票出运');
    expect(source).toContain('setShowAllocationPanel(true)');
    expect(source).toContain('function AllocationEditorModal(');
    expect(source).toContain('shipmentService.listShipmentAllocations(shipment.id)');
    expect(source).toContain('shipmentService.createShipmentAllocation(shipment.id');
  });

  it('service 层契约：GET/POST /v1/shipping/:id/allocations（DR-016 合票建模）', () => {
    expect(serviceSource).toContain('async listShipmentAllocations');
    expect(serviceSource).toContain('async createShipmentAllocation');
    expect(serviceSource).toContain('`/v1/shipping/${encodeURIComponent(id)}/allocations`');
    expect(serviceSource).toContain('export interface ShipmentAllocation');
  });
});

describe('F3 运单状态引导下拉（镜像后端 SHIPMENT_TRANSITIONS）', () => {
  it('create：仅合法初始态（不含终态 Delivered/Cancelled）', () => {
    const opts = getShipmentFormStatusOptions('create');
    expect(opts).toEqual(['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared']);
    expect(opts).not.toContain('Delivered');
    expect(opts).not.toContain('Cancelled');
  });

  it('edit：当前态 + 状态机合法下一步（Draft → Booked/Cancelled）', () => {
    expect(getShipmentFormStatusOptions('edit', 'Draft')).toEqual(['Draft', 'Booked', 'Cancelled']);
  });

  it('edit：Shipped → 仅 Arrived/Cancelled（不能跳 Delivered/回退 Draft）', () => {
    expect(getShipmentFormStatusOptions('edit', 'Shipped')).toEqual(['Shipped', 'Arrived', 'Cancelled']);
  });

  it('edit：终态（Delivered/Cancelled）仅保留当前态', () => {
    expect(getShipmentFormStatusOptions('edit', 'Delivered')).toEqual(['Delivered']);
    expect(getShipmentFormStatusOptions('edit', 'Cancelled')).toEqual(['Cancelled']);
  });

  it('edit：未知/脏状态回退 Draft 集合（与后端 fail-closed 口径一致）', () => {
    expect(getShipmentFormStatusOptions('edit', null)).toEqual(['Draft', 'Booked', 'Cancelled']);
    expect(getShipmentFormStatusOptions('edit', 'Weird' as any)).toEqual(['Draft', 'Booked', 'Cancelled']);
  });

  it('转移表与后端 server/src/statusTransition.ts 全量对齐（防漂移）', () => {
    const edges: Array<[string, string[]]> = [
      ['Draft', ['Booked', 'Cancelled']],
      ['Booked', ['Loading', 'Shipped', 'Cancelled']],
      ['Loading', ['Shipped', 'Cancelled']],
      ['Shipped', ['Arrived', 'Cancelled']],
      ['Arrived', ['Cleared', 'Cancelled']],
      ['Cleared', ['Delivered', 'Cancelled']],
      ['Delivered', []],
      ['Cancelled', []],
    ];
    for (const [from, tos] of edges) {
      expect(getShipmentFormStatusOptions('edit', from as any)).toEqual([from, ...tos]);
      // 后端同一条边必须存在（源文件级防漂移；终态后端写作 new Set()）
      const backendSet = tos.length > 0 ? `new Set([${tos.map(t => `'${t}'`).join(', ')}])` : 'new Set()';
      expect(transitionSource).toContain(`${from}: ${backendSet}`);
    }
  });

  it('表单状态字段渲染时动态替换 options（不再静态全量）', () => {
    expect(source).toContain("const options = field.name === 'status' ? statusFieldOptions : field.options;");
    expect(source).toContain('getShipmentFormStatusOptions(');
  });
});

describe('F4 删除按钮权限控制（对齐后端 requireRole owner/admin/manager）', () => {
  it('按 hasRole(owner/admin/manager) 条件渲染删除按钮', () => {
    expect(source).toContain("import { hasRole } from '../services/authService'");
    expect(source).toContain("hasRole('owner', 'admin', 'manager')");
    expect(source).toContain('{canDeleteShipment && (');
  });

  it('后端 DELETE /shipping/:id 确实限 owner/admin/manager（契约锚）', () => {
    const routeSource = readFileSync(new URL('../server/src/shipping/route.ts', import.meta.url), 'utf8');
    expect(routeSource).toContain("const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager']");
    expect(routeSource).toContain("router.delete('/:id', requireRole(...HIGH_RISK_ROLES)");
  });
});

describe('F5 承运人字段不重复', () => {
  it('全文件仅「物流信息」区保留一个承运人字段（收货信息区重复已删除）', () => {
    const matches = source.match(/\{ name: 'carrierName', label: '承运人'/g) || [];
    expect(matches).toHaveLength(1);
    expect(source).toContain("id: 'shipment-logistics'");
  });
});
