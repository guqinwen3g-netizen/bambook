import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const CONTRACT = fs.readFileSync(path.resolve(__dirname, '../docs/design-system/rdl-status-token-contract.md'), 'utf8');

const SHIPMENT = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf8');
const ORDERS = fs.readFileSync(path.resolve(__dirname, 'OrderManager.tsx'), 'utf8');
const ORDER_SPEC = fs.readFileSync(path.resolve(__dirname, 'order/orderUiSpec.ts'), 'utf8');
const FINANCE = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf8');
const DEV = fs.readFileSync(path.resolve(__dirname, 'DevelopmentManager.tsx'), 'utf8');

// 精确抽取函数体（从定义到顶层 '};' 闭合）
const extractFn = (src: string, fnName: string): string => {
  // 先尝试 const fnName = ... 形式
  let needle = `const ${fnName}`;
  let idx = src.indexOf(needle);
  // 再尝试属性: ( ... ) => { 形式（对象内箭头函数）
  if (idx === -1) {
    needle = `${fnName}: (`;
    idx = src.indexOf(needle);
  }
  if (idx === -1) return '';
  const chunk = src.slice(idx, idx + 1000);
  // 找最后一个 default: 后的闭合（处理 switch 嵌套）
  const lastDefault = chunk.lastIndexOf('default:');
  if (lastDefault > 0) return chunk.slice(0, lastDefault + 80);
  // 非 switch 函数：找第一个顶层 '};'
  let depth = 0;
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === '{') depth++;
    if (chunk[i] === '}') { depth--; if (depth === 0) return chunk.slice(0, i + 2); }
  }
  return chunk;
};

// ═══ Part 1: 契约完整性 ═══
describe('RDL status token contract [完整性]', () => {
  it('定义 accent vs status 边界', () => {
    expect(CONTRACT).toContain('Accent vs Status 边界');
    expect(CONTRACT).toContain('var(--os-vnext-brand-blue)');
  });
  it('定义 3 档状态层级', () => {
    expect(CONTRACT).toContain('inactive');
    expect(CONTRACT).toContain('normal');
    expect(CONTRACT).toContain('active');
  });
  it('定义禁用色清单', () => {
    expect(CONTRACT).toContain('emerald');
    expect(CONTRACT).toContain('#5DE0E6');
    expect(CONTRACT).toContain('#2F95CA');
    expect(CONTRACT).toContain('#CFE5FF');
    expect(CONTRACT).toContain('blue-*');
  });
  it('定义 Batch2/3 使用方式', () => {
    expect(CONTRACT).toContain('Batch2');
    expect(CONTRACT).toContain('Batch3');
  });
  it('契约不含矛盾口径（statusTone 不允许 accent）', () => {
    expect(CONTRACT).not.toContain('中性 opacity 或 accent token');
    expect(CONTRACT).not.toContain('允许: var(--os-vnext-brand-blue)');
  });
});

// ═══ Part 2: statusTone 函数体精确断言（禁 accent/gradient/#CFE5FF）═══
describe('RDL status token [statusTone 函数体中性]', () => {
  it('orderUiSpec.statusCapsule 函数体无 accent/gradient/#CFE5FF', () => {
    const body = extractFn(ORDER_SPEC, 'statusCapsule');
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain('os-vnext-brand-blue');
    expect(body).not.toContain('gradient-to-r');
    expect(body).not.toContain('#CFE5FF');
  });

  it('ShipmentManager.statusTone 函数体无 accent/gradient/#CFE5FF', () => {
    const body = extractFn(SHIPMENT, 'statusTone');
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain('os-vnext-brand-blue');
    expect(body).not.toContain('gradient-to-r');
    expect(body).not.toContain('#CFE5FF');
  });

  it('DevelopmentManager.stageTone 函数体无 accent/gradient/#CFE5FF', () => {
    const body = extractFn(DEV, 'stageTone');
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain('os-vnext-brand-blue');
    expect(body).not.toContain('gradient-to-r');
    expect(body).not.toContain('#CFE5FF');
  });

  it('FinanceManager.financeStatusTone 函数体无 accent/gradient/#CFE5FF', () => {
    const body = extractFn(FINANCE, 'financeStatusTone');
    expect(body).not.toContain('os-vnext-brand-blue');
    expect(body).not.toContain('gradient-to-r');
    expect(body).not.toContain('#CFE5FF');
  });
});

// ═══ Part 3: 全文件禁彩色（防回退）═══
describe('RDL status token [全文件禁彩色]', () => {
  const sources = [
    { name: 'ShipmentManager', src: SHIPMENT },
    { name: 'OrderManager', src: ORDERS },
    { name: 'DevelopmentManager', src: DEV },
    { name: 'FinanceManager', src: FINANCE },
  ];
  sources.forEach(({ name, src }) => {
    it(`${name} 无 emerald/rose/red/amber/sky/green/cyan`, () => {
      expect(src).not.toContain('emerald');
      expect(src).not.toMatch(/rose-[0-9]/);
      expect(src).not.toMatch(/red-[0-9]/);
      expect(src).not.toMatch(/amber-[0-9]/);
      expect(src).not.toMatch(/sky-[0-9]/);
      expect(src).not.toMatch(/green-[0-9]/);
      expect(src).not.toContain('cyan');
    });
    it(`${name} 无硬编码 hex 蓝/青`, () => {
      expect(src).not.toContain('#5DE0E6');
      expect(src).not.toContain('#2F95CA');
      expect(src).not.toContain('#CFE5FF');
    });
  });
});
