import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const FABRIC = fs.readFileSync(path.resolve(__dirname, 'tools/FabricSampleInvoiceGenerator.tsx'), 'utf8');
const SHIPPING = fs.readFileSync(path.resolve(__dirname, 'tools/ShippingNoticeGenerator.tsx'), 'utf8');
const EXCHANGE = fs.readFileSync(path.resolve(__dirname, 'tools/ExchangeRateTool.tsx'), 'utf8');

// ═══ Part 1: safe decoration 已清理 ═══
describe('RDL tools safe decoration [已清理]', () => {
  it('Fabric 无 rgba 装饰 boxShadow', () => {
    expect(FABRIC).not.toContain('rgba(15, 23, 42, 0.2)');
    expect(FABRIC).not.toContain('rgba(15, 23, 42, 0.25)');
  });
  it('Fabric MapPin 无 emerald 装饰色', () => {
    expect(FABRIC).not.toMatch(/MapPin.*emerald/);
  });
  it('Shipping 无 #3B7BD4 硬编码', () => {
    expect(SHIPPING).not.toContain('#3B7BD4');
  });
  it('ExchangeRateTool 无 light raw blue 装饰 (blue-50/100/200/400)', () => {
    expect(EXCHANGE).not.toContain('from-blue-50');
    expect(EXCHANGE).not.toContain('border-blue-100');
    expect(EXCHANGE).not.toContain('bg-blue-50');
    expect(EXCHANGE).not.toContain('text-blue-400');
  });
  it('Shipping 无 hover shadow', () => {
    expect(SHIPPING).not.toContain('hover:shadow');
  });
  it('Fabric 添加样品无 light raw blue (blue-50/100)', () => {
    expect(FABRIC).not.toContain('bg-blue-50');
    expect(FABRIC).not.toContain('hover:bg-blue-100');
  });
});

// ═══ Part 2: 业务语义色未被误清（冻结项保留）═══
describe('RDL tools safe decoration [业务语义保留]', () => {
  it('ExchangeRateTool 退税概念色/实时脉冲保留 (emerald)', () => {
    expect(EXCHANGE).toContain('REBATE_RATE');
    expect(EXCHANGE).toContain('bg-emerald-400'); // 实时脉冲
    expect(EXCHANGE).toContain('bg-emerald-500');
  });
  it('Fabric status banner/destructive 保留 (emerald/rose)', () => {
    expect(FABRIC).toContain('bg-emerald-500/10');
    expect(FABRIC).toContain('bg-rose-500/10');
    expect(FABRIC).toContain('hover:text-rose-400');
  });
  it('Shipping destructive 保留 (red/rose)', () => {
    expect(SHIPPING).toContain('text-rose-500');
    expect(SHIPPING).toContain('border-rose-200');
  });
});
