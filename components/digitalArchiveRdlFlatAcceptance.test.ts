import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const ARCHIVE_SRC = fs.readFileSync(path.resolve(__dirname, 'ui/osCompiler/compiledRelationsTemplates.tsx'), 'utf-8');

// ═══ Part 1: 禁彩色语义 ═══
describe('digital archive RDL flat [禁彩色语义]', () => {
  it('无 emerald', () => { expect(ARCHIVE_SRC).not.toContain('emerald'); });
  it('无 amber-', () => { expect(ARCHIVE_SRC).not.toMatch(/amber-[0-9]/); });
  it('无 red-（删除/破坏性中性化）', () => { expect(ARCHIVE_SRC).not.toMatch(/red-[0-9]/); });
  it('无 rose-', () => { expect(ARCHIVE_SRC).not.toMatch(/rose-[0-9]/); });
  it('无 sky-', () => { expect(ARCHIVE_SRC).not.toMatch(/sky-[0-9]/); });
  it('无 green-', () => { expect(ARCHIVE_SRC).not.toMatch(/green-[0-9]/); });
  it('category icons 中性（非 blue/cyan/emerald/amber 彩色）', () => {
    expect(ARCHIVE_SRC).not.toContain('text-emerald-600 bg-emerald-50');
    expect(ARCHIVE_SRC).not.toContain('text-amber-600 bg-amber-50');
    expect(ARCHIVE_SRC).toContain('text-[var(--text-secondary)] bg-[var(--recessed-bg)]');
  });
});

// ═══ Part 2: 禁 shadow/rim ═══
describe('digital archive RDL flat [禁 shadow]', () => {
  it('无 shadow-2xl', () => { expect(ARCHIVE_SRC).not.toContain('shadow-2xl'); });
  it('无 shadow-xl', () => { expect(ARCHIVE_SRC).not.toContain('shadow-xl'); });
  it('无 shadow-lg', () => { expect(ARCHIVE_SRC).not.toContain('shadow-lg'); });
});

// ═══ Part 3: 禁默认粗字重 ═══
describe('digital archive RDL flat [Typography]', () => {
  it('无 font-medium 默认', () => { expect(ARCHIVE_SRC).not.toContain('font-medium'); });
  it('无 font-semibold', () => { expect(ARCHIVE_SRC).not.toContain('font-semibold'); });
  it('无 font-bold', () => { expect(ARCHIVE_SRC).not.toContain('font-bold'); });
});

// ═══ Part 4: 删除/破坏性中性化 ═══
describe('digital archive RDL flat [删除中性]', () => {
  it('移除按钮中性（无 red hover）', () => {
    expect(ARCHIVE_SRC).not.toContain('hover:bg-red-50');
    expect(ARCHIVE_SRC).not.toContain('hover:bg-red-500/10');
  });
  it('确认移除按钮非红色（bg-[var(--accent)] 非 bg-red-500）', () => {
    expect(ARCHIVE_SRC).not.toContain('bg-red-500 hover:bg-red-600');
    expect(ARCHIVE_SRC).toContain('text-white bg-[var(--accent)] hover:opacity-90');
  });
  it('删除弹窗图标容器中性', () => {
    expect(ARCHIVE_SRC).not.toContain('bg-red-500/20 text-red-400');
  });
});

// ═══ Part 5: 权威文件确认（不误改 Data Center）═══
describe('digital archive RDL flat [权威文件]', () => {
  it('compiledRelationsTemplates 是数字档案权威源', () => {
    expect(ARCHIVE_SRC).toContain('CompiledRelationsPage');
    expect(ARCHIVE_SRC).toContain('source: \'RelationsManager.ui-lab-1.0');
  });
});
