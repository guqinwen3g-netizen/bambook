import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./QuotationManager.tsx', import.meta.url), 'utf8');

describe('QuotationManager B4：建单/改单 MOQ 行级提醒', () => {
  it('消费后端返回值附带的 moqCheck（ok=false → 过滤不合规行，不再等到发送才被拦）', () => {
    expect(source).toContain('saved.moqCheck && saved.moqCheck.ok === false');
    expect(source).toContain("(saved.moqCheck.lines ?? []).filter(l => !l.compliant)");
  });

  it('表单行级提醒文案：第 X 行低于起订量（当前 Y 单位，要求 Z 单位）+ 发送时需审批豁免', () => {
    expect(source).toContain('行低于起订量（当前 {w.quantity} {w.unit}，要求 {w.effectiveMoq} {w.unit}）');
    expect(source).toContain('发送时需审批豁免');
    expect(source).toContain('第 {w.lineIndex + 1} 行');
  });

  it('提醒区块用 BDS warning 语义组件（bds-alert warning + role=alert），无硬编码色值', () => {
    expect(source).toContain('role="alert" className="bds-alert warning items-start"');
    expect(source).not.toMatch(/moqWarnings[\s\S]{0,400}#[0-9a-fA-F]{3,6}/);
  });

  it('低于起订量时表单保持打开并留存草稿 id，再次提交走 updateQuotation 复判（不重复建单）', () => {
    expect(source).toContain('setMoqDraftId(saved.id)');
    expect(source).toContain('setMoqWarnings(belowMoqLines)');
    expect(source).toContain('await apiService.updateQuotation(moqDraftId, input)');
    expect(source).toContain("await apiService.createQuotation(input)");
    expect(source).toContain("{moqDraftId ? '保存修改' : '创建报价单'}");
  });

  it('行内容编辑后清除过时提醒；表单关闭/保存成功后重置 MOQ 状态', () => {
    expect(source).toContain('const clearMoqWarnings = () => setMoqWarnings(prev => (prev ? null : prev));');
    // 关闭表单（返回列表）时一并重置草稿跟踪
    expect(source).toContain('setShowCreateForm(false); setMoqWarnings(null); setMoqDraftId(null);');
  });
});
