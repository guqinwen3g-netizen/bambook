import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const ORDERS_SRC = fs.readFileSync(path.resolve(__dirname, 'OrderManager.tsx'), 'utf8');
const SHIPPING_SRC = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf8');
const DEV_SRC = fs.readFileSync(path.resolve(__dirname, 'DevelopmentManager.tsx'), 'utf8');

const SOURCES = [
  { name: 'OrderManager', src: ORDERS_SRC },
  { name: 'ShipmentManager', src: SHIPPING_SRC },
  { name: 'DevelopmentManager', src: DEV_SRC },
];

// ═══ Part 1: 禁彩色语义 ═══
describe('RDL global batch1 [禁彩色语义]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 emerald`, () => { expect(src).not.toContain('emerald'); });
    it(`${name} 无 rose-`, () => { expect(src).not.toMatch(/rose-[0-9]/); });
    it(`${name} 无 red-`, () => { expect(src).not.toMatch(/red-[0-9]/); });
    it(`${name} 无 amber-`, () => { expect(src).not.toMatch(/amber-[0-9]/); });
    it(`${name} 无 sky-`, () => { expect(src).not.toMatch(/sky-[0-9]/); });
    it(`${name} 无 green-`, () => { expect(src).not.toMatch(/green-[0-9]/); });
    it(`${name} 无 purple`, () => { expect(src).not.toContain('purple'); });
    it(`${name} 无 cyan`, () => { expect(src).not.toContain('cyan'); });
    it(`${name} 无硬编码 hex 蓝/青 (#5DE0E6/#2F95CA)`, () => {
      expect(src).not.toContain('#5DE0E6');
      expect(src).not.toContain('#5de0e6');
      expect(src).not.toContain('#2F95CA');
      expect(src).not.toContain('#2f95ca');
    });
    it(`${name} 无 Tailwind blue-* (用 accent token)`, () => {
      expect(src).not.toMatch(/blue-[0-9]/);
    });
  });
});

// ═══ Part 2: 禁 shadow/rim ═══
describe('RDL global batch1 [禁 shadow]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow-xl`, () => { expect(src).not.toContain('shadow-xl'); });
    it(`${name} 无 shadow-lg`, () => { expect(src).not.toContain('shadow-lg'); });
    it(`${name} 无 shadow-md`, () => { expect(src).not.toContain('shadow-md'); });
    it(`${name} 无 shadow-2xl`, () => { expect(src).not.toContain('shadow-2xl'); });
  });
});

// ═══ Part 3: 禁默认粗字重 ═══
describe('RDL global batch1 [Typography]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-medium`, () => { expect(src).not.toContain('font-medium'); });
    it(`${name} 无 font-semibold`, () => { expect(src).not.toContain('font-semibold'); });
    it(`${name} 无 font-bold`, () => { expect(src).not.toContain('font-bold'); });
  });
});


// ═══ Part 4: statusTone 函数体专项（截取函数体断言）═══
describe('RDL global batch1 [statusTone 函数体中性]', () => {
  const extractFunction = (src: string, fnName: string): string => {
    const idx = src.indexOf('const ' + fnName);
    if (idx === -1) return '';
    const end = src.indexOf('\n};', idx);
    return src.slice(idx, end + 3);
  };

  it('OrderManager.getStatusStyles 函数体无 accent token / gradient / #CFE5FF', () => {
    // getStatusStyles 从定义到第一个 'default:' 闭合后的顶层 '};'
    const idx = ORDERS_SRC.indexOf('getStatusStyles');
    const body = ORDERS_SRC.slice(idx, idx + 1200);
    // 截取到第二个 switch 块结束
    const lastDefault = body.lastIndexOf('default:');
    const fnBody = body.slice(0, lastDefault + 80);
    expect(fnBody).not.toContain('os-vnext-brand-blue');
    expect(fnBody).not.toContain('gradient-to-r');
    expect(fnBody).not.toContain('#CFE5FF');
  });

  it('ShipmentManager.statusTone 函数体无 accent token / gradient / #CFE5FF', () => {
    const body = extractFunction(SHIPPING_SRC, 'statusTone');
    expect(body).not.toContain('os-vnext-brand-blue');
    expect(body).not.toContain('gradient-to-r');
    expect(body).not.toContain('#CFE5FF');
  });

  it('DevelopmentManager.stageTone 函数体无 accent token / gradient / #CFE5FF', () => {
    const body = extractFunction(DEV_SRC, 'stageTone');
    expect(body).not.toContain('os-vnext-brand-blue');
    expect(body).not.toContain('gradient-to-r');
    expect(body).not.toContain('#CFE5FF');
  });
});
