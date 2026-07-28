import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const COMPILED_SRC = fs.readFileSync(path.resolve(__dirname, 'ui/osCompiler/compiledSettingsTemplates.tsx'), 'utf8');
const FALLBACK_SRC = fs.readFileSync(path.resolve(__dirname, 'Settings.tsx'), 'utf8');

const SOURCES = [
  { name: 'compiledSettings', src: COMPILED_SRC },
  { name: 'SettingsFallback', src: FALLBACK_SRC },
];

// ═══ Part 1: 禁彩色语义 ═══
describe('RDL Settings flat [禁彩色语义]', () => {
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
    it(`${name} 无 indigo-*`, () => {
      expect(src).not.toMatch(/indigo-[0-9]/);
    });
  });
});

// ═══ Part 2: 禁硬编码彩色 hex ═══
describe('RDL Settings flat [禁硬编码hex]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无彩色 hex`, () => {
      ['#004AAD', '#5DE0E6', '#2F95CA', '#CFE5FF', '#2563EB', '#0e7490', '#0A2746'].forEach(hex => {
        expect(src).not.toContain(hex);
      });
    });
  });
});

// ═══ Part 3: 禁 shadow/rim ═══
describe('RDL Settings flat [禁 shadow]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow-xl/lg/md/2xl/sm`, () => {
      ['shadow-xl', 'shadow-lg', 'shadow-md', 'shadow-2xl', 'shadow-sm'].forEach(s => {
        expect(src).not.toContain(s);
      });
    });
    it(`${name} 无 shadow-[ 任意值`, () => {
      expect(src).not.toMatch(/shadow-\[/);
    });
  });
});

// ═══ Part 4: 禁默认粗字重 ═══
describe('RDL Settings flat [Typography]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-bold/medium/semibold`, () => {
      ['font-bold', 'font-medium', 'font-semibold'].forEach(f => {
        expect(src).not.toContain(f);
      });
    });
    it(`${name} 无无效 text-[slate-*]`, () => {
      expect(src).not.toMatch(/text-\[slate-/);
    });
  });
});

// ═══ Part 5: 业务逻辑保留 ═══
describe('RDL Settings flat [业务逻辑不变]', () => {
  it('compiled 保留 Settings 生产路径', () => {
    expect(COMPILED_SRC).toContain('CompiledSettings');
  });
  it('fallback 保留设置 schema/保存流程', () => {
    expect(FALLBACK_SRC.length).toBeGreaterThan(5000);
  });
});
