import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');

/**
 * W3 旁路回归 — S-FE 批 A-F 收编区守卫缺口补底
 *
 * 背景：批 A-F（raw 语义色 / 遮罩 / 嵌套实色块 / 裸 rounded / 手写主按钮 / font-black）
 * 共触 39 文件，其中 18 个已被既有 rdl*Guard 覆盖。本文件补底剩余 21 个未覆盖文件。
 *
 * 断言策略：
 *   - 17 个干净文件：硬零断言（禁新增任何违规）
 *   - 5 个手写主按钮基线残留文件：计数基线断言（只允许单调下降，对齐 check-design-tokens.sh）
 *   - ProductionGlobe：3D WebGL overlay 豁免区，仅防 font-black 回退（批F 已收编）
 *
 * 基线口径与 scripts/check-design-tokens.sh 完全一致（出现次数口径）。
 */

const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

// ── 文件分组 ──
const CLEAN_FILES: Array<{ name: string; p: string }> = [
  { name: 'AutomationRulesSection', p: 'AutomationRulesSection.tsx' },
  { name: 'CommandPalette', p: 'CommandPalette.tsx' },
  { name: 'DataCenter', p: 'DataCenter.tsx' },
  { name: 'KnowledgeBase', p: 'KnowledgeBase.tsx' },
  { name: 'ProcurementManager', p: 'ProcurementManager.tsx' },
  { name: 'QuotationManager', p: 'QuotationManager.tsx' },
  { name: 'WorkflowPanel', p: 'WorkflowPanel.tsx' },
  { name: 'SampleNodesPanel', p: 'development/SampleNodesPanel.tsx' },
  { name: 'SignatureManager', p: 'email/SignatureManager.tsx' },
  { name: 'FinanceReportsPanel', p: 'finance/FinanceReportsPanel.tsx' },
  { name: 'ContractGenerator', p: 'tools/ContractGenerator.tsx' },
  { name: 'DocumentTemplateManager', p: 'tools/DocumentTemplateManager.tsx' },
  { name: 'PackingListGenerator', p: 'tools/PackingListGenerator.tsx' },
  { name: 'crmRelationSections', p: 'ui/crm/crmRelationSections.tsx' },
  { name: 'compiledSettingsTemplates', p: 'Settings.tsx' },
];

// 手写主按钮基线残留（rounded-full + bg-[var(--os-vnext-brand-blue)] 组合）
// 计数 = 正向 + 反向两序合计，与 check-design-tokens.sh BASELINE_HANDWRITTEN_BTN 口径一致
const HANDWRITTEN_BTN_BASELINE: Array<{ name: string; p: string; max: number }> = [
  { name: 'NotificationCenter', p: 'NotificationCenter.tsx', max: 1 },
  { name: 'DocumentCenter', p: 'DocumentCenter.tsx', max: 1 },
  { name: 'ReportCenter', p: 'ReportCenter.tsx', max: 2 },
  { name: 'QuotationImportWizard', p: 'import/QuotationImportWizard.tsx', max: 1 },
  { name: 'compiledProductsTemplates', p: 'ProductsManager.tsx', max: 3 },
];

const CLEAN_SOURCES = CLEAN_FILES.map(({ name, p }) => ({ name, src: read(p) }));
const BTN_SOURCES = HANDWRITTEN_BTN_BASELINE.map(({ name, p, max }) => ({ name, src: read(p), max }));
const GLOBE_SRC = read('ProductionGlobe.tsx');

const RAW_SEMANTIC_RE = /(text|bg|border)-(red|emerald|blue|rose|amber|orange|yellow|green|sky|purple|cyan|indigo|fuchsia)-[0-9]/;
const MASK_RE = /bg-black\/[0-9]/;
const SHADOW_RE = /shadow-(xl|lg|md|2xl|sm)/;
const HW_BTN_FWD_RE = /rounded-full[^"']*bg-\[var\(--os-vnext-brand-blue\)\]/g;
const HW_BTN_REV_RE = /bg-\[var\(--os-vnext-brand-blue\)\][^"']*rounded-full/g;

const countMatches = (src: string, re: RegExp): number => (src.match(re) || []).length;

// ═══ Part 1: 干净文件 — 批A raw 语义色零断言 ═══
describe('W3 旁路回归 [批A: raw 语义色零断言]', () => {
  CLEAN_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 raw 语义色`, () => {
      expect(src).not.toMatch(RAW_SEMANTIC_RE);
    });
  });
});

// ═══ Part 2: 干净文件 — 批B 遮罩零断言 ═══
describe('W3 旁路回归 [批B: 自造遮罩零断言]', () => {
  CLEAN_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 bg-black/N 自造遮罩`, () => {
      expect(src).not.toMatch(MASK_RE);
    });
  });
});

// ═══ Part 3: 干净文件 — 阴影零断言（flat 铁律）═══
describe('W3 旁路回归 [flat: 阴影零断言]', () => {
  CLEAN_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow-xl/lg/md/2xl/sm`, () => {
      expect(src).not.toMatch(SHADOW_RE);
    });
  });
});

// ═══ Part 4: 干净文件 — 批F font-black 零断言 ═══
describe('W3 旁路回归 [批F: font-black 零断言]', () => {
  CLEAN_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-black`, () => {
      expect(src).not.toContain('font-black');
    });
  });
});

// ═══ Part 5: 干净文件 — 批E 手写主按钮零断言 ═══
describe('W3 旁路回归 [批E: 手写主按钮零断言]', () => {
  CLEAN_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 rounded-full+brand-blue 手写主按钮`, () => {
      expect(countMatches(src, HW_BTN_FWD_RE)).toBe(0);
      expect(countMatches(src, HW_BTN_REV_RE)).toBe(0);
    });
  });
});

// ═══ Part 6: 基线残留文件 — 手写主按钮只减不增 ═══
describe('W3 旁路回归 [批E: 手写主按钮基线只减不增]', () => {
  BTN_SOURCES.forEach(({ name, src, max }) => {
    it(`${name} 手写主按钮 ≤ ${max}（基线单调下降）`, () => {
      const total = countMatches(src, HW_BTN_FWD_RE) + countMatches(src, HW_BTN_REV_RE);
      expect(total).toBeLessThanOrEqual(max);
    });
  });
});

// ═══ Part 7: 基线残留文件 — 其余维度零断言 ═══
describe('W3 旁路回归 [基线文件其余维度]', () => {
  BTN_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 raw 语义色`, () => {
      expect(src).not.toMatch(RAW_SEMANTIC_RE);
    });
    it(`${name} 无自造遮罩`, () => {
      expect(src).not.toMatch(MASK_RE);
    });
    it(`${name} 无 shadow`, () => {
      expect(src).not.toMatch(SHADOW_RE);
    });
    it(`${name} 无 font-black`, () => {
      expect(src).not.toContain('font-black');
    });
  });
});

// ═══ Part 8: ProductionGlobe — 3D 豁免区防 font-black 回退 ═══
describe('W3 旁路回归 [ProductionGlobe 3D 豁免区]', () => {
  it('BeamTooltip font-black 已收编为 font-light（批F 防回退）', () => {
    expect(GLOBE_SRC).not.toContain('font-black');
  });
  it('BeamTooltip 保留 3D overlay 豁免色（bg-blue-950/90 border-blue-400/50）', () => {
    // 3D WebGL overlay 属豁免清单（评审报告豁免：3D 地球 WebGL 色值）
    expect(GLOBE_SRC).toContain('bg-blue-950/90');
    expect(GLOBE_SRC).toContain('border-blue-400/50');
  });
  it('BeamTooltip 无新增手写主按钮', () => {
    expect(countMatches(GLOBE_SRC, HW_BTN_FWD_RE)).toBe(0);
    expect(countMatches(GLOBE_SRC, HW_BTN_REV_RE)).toBe(0);
  });
  it('BeamTooltip 无自造遮罩', () => {
    expect(GLOBE_SRC).not.toMatch(MASK_RE);
  });
});
