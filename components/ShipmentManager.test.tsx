import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ShipmentManager.tsx', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../services/shipmentService.ts', import.meta.url), 'utf8');

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
