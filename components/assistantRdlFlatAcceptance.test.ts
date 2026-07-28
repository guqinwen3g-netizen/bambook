import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const ASSISTANT_SRC = fs.readFileSync(path.resolve(__dirname, 'Assistant.tsx'), 'utf8');

// ═══ Part 1: 禁彩色语义 ═══
describe('Assistant RDL flat [禁彩色语义]', () => {
  it('无 emerald', () => { expect(ASSISTANT_SRC).not.toContain('emerald'); });
  it('无 rose-', () => { expect(ASSISTANT_SRC).not.toMatch(/rose-[0-9]/); });
  it('无 red-（错误/停止中性化）', () => { expect(ASSISTANT_SRC).not.toMatch(/red-[0-9]/); });
  it('无 amber-', () => { expect(ASSISTANT_SRC).not.toMatch(/amber-[0-9]/); });
  it('无 sky-', () => { expect(ASSISTANT_SRC).not.toMatch(/sky-[0-9]/); });
  it('无 green-', () => { expect(ASSISTANT_SRC).not.toMatch(/green-[0-9]/); });
  it('无 purple', () => { expect(ASSISTANT_SRC).not.toContain('purple'); });
  it('无 cyan（语音录制用单一 accent）', () => { expect(ASSISTANT_SRC).not.toContain('cyan'); });
});

// ═══ Part 2: 禁 shadow/rim ═══
describe('Assistant RDL flat [禁 shadow]', () => {
  it('无 shadow-xl', () => { expect(ASSISTANT_SRC).not.toContain('shadow-xl'); });
  it('无 shadow-lg', () => { expect(ASSISTANT_SRC).not.toContain('shadow-lg'); });
  it('无 shadow-md', () => { expect(ASSISTANT_SRC).not.toContain('shadow-md'); });
  it('无 shadow-2xl', () => { expect(ASSISTANT_SRC).not.toContain('shadow-2xl'); });
});

// ═══ Part 3: 禁默认粗字重 ═══
describe('Assistant RDL flat [Typography]', () => {
  it('无 font-medium 默认', () => { expect(ASSISTANT_SRC).not.toContain('font-medium'); });
  it('无 font-semibold', () => { expect(ASSISTANT_SRC).not.toContain('font-semibold'); });
  it('无 font-bold', () => { expect(ASSISTANT_SRC).not.toContain('font-bold'); });
});

// ═══ Part 4: status indicator 中性 ═══
describe('Assistant RDL flat [status 中性]', () => {
  it('getAgentEventToneClass complete/failed 中性（非 emerald/rose）', () => {
    const idx = ASSISTANT_SRC.indexOf('getAgentEventToneClass');
    const body = ASSISTANT_SRC.slice(idx, idx + 400);
    expect(body).not.toContain('emerald');
    expect(body).not.toContain('rose-');
  });
  it('停止按钮中性 surface（非 red）', () => {
    expect(ASSISTANT_SRC).not.toContain('bg-red-500');
    expect(ASSISTANT_SRC).not.toContain('bg-red-50');
  });
});

// ═══ Part 5: Agent runtime 不变（边界确认）═══
describe('Assistant RDL flat [runtime 不变]', () => {
  it('保留 streaming/tool execution 关键逻辑', () => {
    expect(ASSISTANT_SRC).toContain('isLoading');
    expect(ASSISTANT_SRC).toContain('AgentWorkEvent');
  });
});
