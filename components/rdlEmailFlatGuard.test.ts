import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const EMAIL_SRC = fs.readFileSync(path.resolve(__dirname, 'EmailManager.tsx'), 'utf8');

// ═══ Part 1: 禁彩色语义 ═══
describe('RDL Email flat [禁彩色语义]', () => {
  it('无 emerald', () => { expect(EMAIL_SRC).not.toContain('emerald'); });
  it('无 rose-', () => { expect(EMAIL_SRC).not.toMatch(/rose-[0-9]/); });
  it('无 red-', () => { expect(EMAIL_SRC).not.toMatch(/red-[0-9]/); });
  it('无 amber-', () => { expect(EMAIL_SRC).not.toMatch(/amber-[0-9]/); });
  it('无 sky-', () => { expect(EMAIL_SRC).not.toMatch(/sky-[0-9]/); });
  it('无 green-', () => { expect(EMAIL_SRC).not.toMatch(/green-[0-9]/); });
  it('无 purple', () => { expect(EMAIL_SRC).not.toContain('purple'); });
  it('无 cyan', () => { expect(EMAIL_SRC).not.toContain('cyan'); });
  it('无 blue-* (Tailwind)', () => { expect(EMAIL_SRC).not.toMatch(/blue-[0-9]/); });
});

// ═══ Part 2: 禁硬编码 hex 蓝/青 ═══
describe('RDL Email flat [禁硬编码hex]', () => {
  it('无 #004AAD', () => { expect(EMAIL_SRC).not.toContain('#004AAD'); });
  it('无 #5DE0E6', () => { expect(EMAIL_SRC).not.toContain('#5DE0E6'); });
  it('无 #2F95CA', () => { expect(EMAIL_SRC).not.toContain('#2F95CA'); });
  it('无 #CFE5FF', () => { expect(EMAIL_SRC).not.toContain('#CFE5FF'); });
  it('无 #2563EB', () => { expect(EMAIL_SRC).not.toContain('#2563EB'); });
});

// ═══ Part 3: 禁 shadow/rim ═══
describe('RDL Email flat [禁 shadow]', () => {
  it('无 shadow-xl', () => { expect(EMAIL_SRC).not.toContain('shadow-xl'); });
  it('无 shadow-lg', () => { expect(EMAIL_SRC).not.toContain('shadow-lg'); });
  it('无 shadow-md', () => { expect(EMAIL_SRC).not.toContain('shadow-md'); });
  it('无 shadow-2xl', () => { expect(EMAIL_SRC).not.toContain('shadow-2xl'); });
  it('无 shadow-sm', () => { expect(EMAIL_SRC).not.toContain('shadow-sm'); });
});

// ═══ Part 4: 禁默认粗字重 ═══
describe('RDL Email flat [Typography]', () => {
  it('无 font-bold', () => { expect(EMAIL_SRC).not.toContain('font-bold'); });
  it('无 font-medium', () => { expect(EMAIL_SRC).not.toContain('font-medium'); });
  it('无 font-semibold', () => { expect(EMAIL_SRC).not.toContain('font-semibold'); });
});

// ═══ Part 5: 业务逻辑不变（边界确认）═══
describe('RDL Email flat [业务逻辑不变]', () => {
  it('保留邮件同步/发信/outbox 关键逻辑', () => {
    expect(EMAIL_SRC).toContain('handleSync');
    expect(EMAIL_SRC).toContain('selectedEmail');
    expect(EMAIL_SRC).toContain('currentBox');
  });
});


// ═══ Part 6: 状态函数精确断言（read/important 非 accent）═══
describe('RDL Email flat [状态非 accent]', () => {
  const extractLine = (src: string, keyword: string): string => {
    const idx = src.indexOf(keyword);
    if (idx === -1) return '';
    return src.slice(idx, idx + 300);
  };

  it('isImportant 状态用中性（非 brand-blue）', () => {
    const line = extractLine(EMAIL_SRC, 'selectedEmail.isImportant ? (isDarkMode');
    expect(line).not.toContain('os-vnext-brand-blue');
    expect(line).not.toContain('brand-blue-strong');
  });

  it('!isRead 状态用中性（非 brand-blue）', () => {
    const line = extractLine(EMAIL_SRC, '!selectedEmail.isRead ? (isDarkMode');
    expect(line).not.toContain('os-vnext-brand-blue');
  });

  it('isImportant fill 用 fill-current（非 brand-blue fill）', () => {
    const line = extractLine(EMAIL_SRC, "isImportant ? 'fill");
    expect(line).not.toContain('brand-blue');
  });
});
