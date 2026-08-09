import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('DataCenter layout boot', () => {
  it('hydrates the cached office layout before the first paint', () => {
    const source = readFileSync(new URL('./DataCenter.tsx', import.meta.url), 'utf8');
    const componentSource = source.slice(source.indexOf('const DataCenter: React.FC'));

    expect(componentSource).toContain('readCachedLayoutSnapshot() ?? createDefaultLayoutSnapshot()');
    expect(componentSource).toContain('React.useState<OfficeFrame>(() => ({ ...initialLayout.officeFrame }))');
    expect(componentSource).toContain('React.useState<RoomRect[]>(() => initialLayout.rooms.map');
    expect(componentSource).not.toContain('setOfficeFrame(savedLayout.officeFrame)');
    expect(componentSource).not.toContain('setRooms(savedLayout.rooms)');
  });

  it('treats the data twin layout as data-center system data, not device-only state', () => {
    const source = readFileSync(new URL('./DataCenter.tsx', import.meta.url), 'utf8');
    const loadSource = source.slice(source.indexOf('apiService'), source.indexOf('const pushUndoSnapshot'));
    const saveSource = source.slice(source.indexOf('const saveLayout'), source.indexOf('const fitLayoutView'));

    expect(source).toContain("import { apiService } from '../services/apiService'");
    expect(source).toContain("DATA_TWIN_LAYOUT_PROFILE_KIND = 'data-twin-layout'");
    expect(source).toContain("DATA_TWIN_LAYOUT_PROFILE_ID = 'data-twin-layout:main-office'");
    expect(source).toContain('dataCenterEndpoint?: string');
    expect(loadSource).toContain('.listBusinessProfiles<LayoutSnapshot>');
    expect(loadSource).toContain('DATA_TWIN_LAYOUT_PROFILE_KIND, dataCenterEndpoint');
    expect(loadSource).toContain('applyLayoutSnapshot(snapshot)');
    expect(loadSource).toContain('cacheLayoutSnapshot(snapshot)');
    expect(saveSource).toContain('cacheLayoutSnapshot(snapshot)');
    expect(saveSource).toContain('apiService.saveBusinessProfile<LayoutSnapshot>');
    expect(saveSource).toContain('DATA_TWIN_LAYOUT_PROFILE_ID');
    expect(saveSource).toContain('DATA_TWIN_LAYOUT_PROFILE_KIND');
    expect(saveSource).not.toContain('window.localStorage.setItem(DATA_TWIN_LAYOUT_STORAGE_KEY');
  });
});

describe('DataCenter business hub tabs', () => {
  const readComponent = () => {
    const source = readFileSync(new URL('./DataCenter.tsx', import.meta.url), 'utf8');
    return source.slice(source.indexOf('const DataCenter: React.FC'));
  };

  it('defaults to the overview tab and keeps the digital twin as a secondary tab', () => {
    const componentSource = readComponent();

    expect(componentSource).toContain("useState<DataCenterTab>('overview')");
    expect(componentSource).toContain("switchTab('overview')");
    expect(componentSource).toContain("switchTab('twin')");
    expect(componentSource).toContain("activeTab === 'overview' ?");
    // 离开孪生画布必须退出编辑态，避免隐藏的 Delete/Undo 键盘捕获
    expect(componentSource).toContain('setIsEditingLayout(false)');
  });

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
});
