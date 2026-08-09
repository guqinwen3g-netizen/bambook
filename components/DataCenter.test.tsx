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
