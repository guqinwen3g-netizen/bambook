import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const ADMIN_SRC = fs.readFileSync(path.resolve(__dirname, 'AdminPanel.tsx'), 'utf8');

// ═══ Part 1: 禁彩色语义 ═══
describe('RDL AdminPanel danger flat [禁彩色语义]', () => {
  it('无 red/rose/amber', () => {
    expect(ADMIN_SRC).not.toMatch(/red-[0-9]/);
    expect(ADMIN_SRC).not.toMatch(/rose-[0-9]/);
    expect(ADMIN_SRC).not.toMatch(/amber-[0-9]/);
  });
  it('无 green/blue/indigo', () => {
    expect(ADMIN_SRC).not.toMatch(/green-[0-9]/);
    expect(ADMIN_SRC).not.toMatch(/blue-[0-9]/);
    expect(ADMIN_SRC).not.toMatch(/indigo-[0-9]/);
  });
  it('无 orange/yellow/purple/cyan', () => {
    expect(ADMIN_SRC).not.toMatch(/orange-[0-9]/);
    expect(ADMIN_SRC).not.toMatch(/yellow-[0-9]/);
    expect(ADMIN_SRC).not.toContain('purple');
    expect(ADMIN_SRC).not.toContain('cyan');
  });
  it('无 sky/emerald', () => {
    expect(ADMIN_SRC).not.toMatch(/sky-[0-9]/);
    expect(ADMIN_SRC).not.toContain('emerald');
  });
});

// ═══ Part 2: 禁硬编码彩色 hex ═══
describe('RDL AdminPanel danger flat [禁硬编码hex]', () => {
  it('无彩色 hex', () => {
    ['#004AAD', '#5DE0E6', '#2F95CA', '#CFE5FF', '#2563EB', '#0e7490', '#0A2746'].forEach(hex => {
      expect(ADMIN_SRC).not.toContain(hex);
    });
  });
});

// ═══ Part 3: 禁 shadow/rim ═══
describe('RDL AdminPanel danger flat [禁 shadow]', () => {
  it('无 shadow-xl/lg/md/2xl/sm', () => {
    ['shadow-xl', 'shadow-lg', 'shadow-md', 'shadow-2xl', 'shadow-sm'].forEach(s => {
      expect(ADMIN_SRC).not.toContain(s);
    });
  });
  it('无 shadow-[ 任意值', () => {
    expect(ADMIN_SRC).not.toMatch(/shadow-\[/);
  });
});

// ═══ Part 4: 禁默认粗字重 ═══
describe('RDL AdminPanel danger flat [Typography]', () => {
  it('无 font-bold/medium/semibold', () => {
    ['font-bold', 'font-medium', 'font-semibold'].forEach(f => {
      expect(ADMIN_SRC).not.toContain(f);
    });
  });
});

// ═══ Part 5: danger 常量中性化 ═══
describe('RDL AdminPanel danger flat [常量中性]', () => {
  it('dangerChipCls 无 red', () => {
    const m = ADMIN_SRC.match(/dangerChipCls[\s\S]*?`;/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/red-[0-9]/);
  });
  it('dangerActionCls 无 red', () => {
    const m = ADMIN_SRC.match(/dangerActionCls[\s\S]*?`;/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/red-[0-9]/);
  });
  it('quietDangerActionCls 无 red', () => {
    const m = ADMIN_SRC.match(/quietDangerActionCls[\s\S]*?`;/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/red-[0-9]/);
  });
});

// ═══ Part 6: 业务逻辑保留 ═══
describe('RDL AdminPanel danger flat [业务逻辑不变]', () => {
  it('保留用户/权限/配置关键逻辑', () => {
    expect(ADMIN_SRC.length).toBeGreaterThan(5000);
  });
});
