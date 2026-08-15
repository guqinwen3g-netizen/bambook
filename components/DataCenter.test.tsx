import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('DataCenter overview hub', () => {
  const readComponent = () => {
    const source = readFileSync(new URL('./DataCenter.tsx', import.meta.url), 'utf8');
    return source.slice(source.indexOf('const DataCenter: React.FC'));
  };

  it('wires the RAG QA loop through the knowledge api contract (search + stream chat + archive)', () => {
    const componentSource = readComponent();

    // 引用检索与流式回答并行
    expect(componentSource).toContain('apiService.searchKnowledgeBase(q)');
    expect(componentSource).toContain('apiService.askKnowledgeBase(q');
    // 问答可归档回知识语料
    expect(componentSource).toContain('apiService.ingestKnowledgeText({');
    expect(componentSource).toContain("sourceType: 'qa'");
    // 命中片段以 KnowledgeCitation 契约渲染
    expect(componentSource).toContain('useState<KnowledgeCitation[]>([])');
    expect(componentSource).toContain('Math.round(c.score * 100)');
  });

  it('renders the standard PageHeader instead of a custom floating header', () => {
    const componentSource = readComponent();

    expect(componentSource).toContain('<PageHeader');
    expect(componentSource).toContain('title="数据中心"');
    expect(componentSource).not.toContain('pointer-events-none absolute left-12 right-12 top-8');
  });

  it('does not contain the digital twin layout editor after its removal', () => {
    const source = readFileSync(new URL('./DataCenter.tsx', import.meta.url), 'utf8');

    // 数字孪生 tab 与平面图已整体下线
    expect(source).not.toContain("'twin'");
    expect(source).not.toContain('数字孪生');
    expect(source).not.toContain('DATA_TWIN_LAYOUT');
    expect(source).not.toContain('TwinObject');
    expect(source).not.toContain('OfficeFrame');
    expect(source).not.toContain('WallSegment');
    expect(source).not.toContain('createDefaultLayoutSnapshot');
    expect(source).not.toContain('readCachedLayoutSnapshot');
    expect(source).not.toContain('saveBusinessProfile');
    expect(source).not.toContain('listBusinessProfiles');
  });
});
