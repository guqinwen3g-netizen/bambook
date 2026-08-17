import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const FILES = [
  { name: 'OrderClusterBlock', p: 'order/OrderClusterBlock.tsx' },
  { name: 'DetailPanel', p: 'ui/DetailPanel.tsx' },
  { name: 'SmartLinkedInput', p: 'ui/SmartLinkedInput.tsx' },
  { name: 'RelationsManager', p: 'RelationsManager.tsx' },
  { name: 'compiledMaterialLibraryTemplates', p: 'ui/osCompiler/compiledMaterialLibraryTemplates.tsx' },
  { name: 'ProductsManager', p: 'ProductsManager.tsx' },
  { name: 'compiledSurfacePrimitives', p: 'ui/primitives/compiledSurfacePrimitives.tsx' },
  { name: 'AgentProcessPanel', p: 'AgentProcessPanel.tsx' },
  { name: 'AgentLiveStatusBar', p: 'AgentLiveStatusBar.tsx' },
  { name: 'Assistant', p: 'Assistant.tsx' },
  { name: 'PandaLab', p: 'mascot/PandaLab.tsx' },
  { name: 'EmailEditor', p: 'email/EmailEditor.tsx' },
  { name: 'BusinessTools', p: 'BusinessTools.tsx' },
];

const SOURCES = FILES.map(({ name, p }) => ({ name, src: fs.readFileSync(path.resolve(__dirname, p), 'utf8') }));

describe('RDL low-residue UI flat [禁彩色语义]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无语义彩色`, () => {
      ['emerald','purple','cyan'].forEach(c => expect(src).not.toContain(c));
      ['rose','red','amber','sky','green','blue','orange','indigo','yellow'].forEach(c => {
        expect(src).not.toMatch(new RegExp(`${c}-[0-9]`));
      });
    });
  });
});

describe('RDL low-residue UI flat [禁 shadow]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow`, () => {
      ['shadow-xl','shadow-lg','shadow-md','shadow-2xl','shadow-sm'].forEach(s => expect(src).not.toContain(s));
      expect(src).not.toMatch(/shadow-\[/);
    });
  });
});

describe('RDL low-residue UI flat [Typography]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-bold/medium/semibold`, () => {
      ['font-bold','font-medium','font-semibold'].forEach(f => expect(src).not.toContain(f));
    });
  });
});

// ═══ Part 4: destructive/status 非 accent ═══
describe('RDL low-residue UI flat [destructive/status 非 accent]', () => {
  it('RelationsManager 确认移除按钮不用 brand-blue', () => {
    const compiledRelations = SOURCES.find(s => s.name === 'RelationsManager');
    const m = compiledRelations!.src.match(/确认移除.*?<\/button>/s);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('os-vnext-brand-blue');
  });
  it('AgentLiveStatusBar 无 brand-blue accent', () => {
    const liveBar = SOURCES.find(s => s.name === 'AgentLiveStatusBar');
    expect(liveBar!.src).not.toContain('os-vnext-brand-blue');
  });
  it('Assistant event status 默认态不用 brand-blue', () => {
    const assistant = SOURCES.find(s => s.name === 'Assistant');
    const m = assistant!.src.match(/getAgentEventToneClass[\s\S]*?\n  \}/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('os-vnext-brand-blue');
  });
  it('RelationsManager Tier badge 不用 brand-blue', () => {
    const compiled = SOURCES.find(s => s.name === 'RelationsManager');
    const m = compiled!.src.match(/tierLabel\(org\.rating\)[\s\S]*?<\/span>/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('os-vnext-brand-blue');
  });
  it('RelationsManager category icon 默认态不用 brand-blue', () => {
    const compiled = SOURCES.find(s => s.name === 'RelationsManager');
    const m = compiled!.src.match(/relationCategoryIconClass[\s\S]*?<\/div>/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('os-vnext-brand-blue');
  });
});
