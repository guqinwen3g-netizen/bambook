import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const COMPILED_SRC = fs.readFileSync(path.resolve(__dirname, 'ProductsManager.tsx'), 'utf8');
const MANAGER_SRC = fs.readFileSync(path.resolve(__dirname, 'ProductsManager.tsx'), 'utf8');

const SOURCES = [
  { name: 'compiledProducts', src: COMPILED_SRC },
  { name: 'ProductsManager', src: MANAGER_SRC },
];

// ═══ Part 1: 禁彩色语义 ═══
describe('RDL Products batch3 [禁彩色语义]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 emerald/rose/red/amber/sky/green/purple/cyan`, () => {
      expect(src).not.toContain('emerald');
      expect(src).not.toMatch(/rose-[0-9]/);
      expect(src).not.toMatch(/red-[0-9]/);
      expect(src).not.toMatch(/amber-[0-9]/);
      expect(src).not.toMatch(/sky-[0-9]/);
      expect(src).not.toMatch(/green-[0-9]/);
      expect(src).not.toContain('purple');
      expect(src).not.toContain('cyan');
    });
    it(`${name} 无 blue-* (Tailwind)`, () => {
      expect(src).not.toMatch(/blue-[0-9]/);
    });
  });
});

// ═══ Part 2: 禁硬编码 hex 蓝/青 ═══
describe('RDL Products batch3 [禁硬编码hex]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 #004AAD/#5DE0E6/#2F95CA/#CFE5FF/#2563EB`, () => {
      expect(src).not.toContain('#004AAD');
      expect(src).not.toContain('#5DE0E6');
      expect(src).not.toContain('#2F95CA');
      expect(src).not.toContain('#CFE5FF');
      expect(src).not.toContain('#2563EB');
    });
    it(`${name} 无通用彩色 hex (#0e7490/#0A2746 等)`, () => {
      expect(src).not.toContain('#0e7490');
      expect(src).not.toContain('#0A2746');
      expect(src).not.toContain('#0a2746');
    });
  });
});

// ═══ Part 3: 禁 shadow/rim ═══
describe('RDL Products batch3 [禁 shadow]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow-xl/lg/md/2xl/sm`, () => {
      expect(src).not.toContain('shadow-xl');
      expect(src).not.toContain('shadow-lg');
      expect(src).not.toContain('shadow-md');
      expect(src).not.toContain('shadow-2xl');
      expect(src).not.toContain('shadow-sm');
    });
    it(`${name} 无 shadow-[ 任意值（rim/内描边）`, () => {
      expect(src).not.toMatch(/shadow-\[/);
    });
  });
});

// ═══ Part 4: 禁默认粗字重 ═══
describe('RDL Products batch3 [Typography]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-bold/medium/semibold`, () => {
      expect(src).not.toContain('font-bold');
      expect(src).not.toContain('font-medium');
      expect(src).not.toContain('font-semibold');
    });
  });
});

// ═══ Part 5: 业务逻辑保留（锚点）═══
describe('RDL Products batch3 [业务逻辑不变]', () => {
  it('compiled 保留 Products 生产路径', () => {
    expect(COMPILED_SRC).toContain('CompiledProducts');
  });
  it('Manager 保留产品 API/状态流', () => {
    expect(MANAGER_SRC).toContain('ProductAsset');
  });
});
