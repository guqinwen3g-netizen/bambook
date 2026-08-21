/**
 * 跨模块导航接入面契约测试（源码扫描式，与仓库测试惯例一致）
 *
 * 保证「关联业务」入口指向的每个目标 Manager 都消费了导航协议
 * （consumeCrossModuleNav + 筛选 chip），新增目标页或重构时防回退。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

/** 列表型目标页：挂载消费协议 + 顶部筛选提示 chip */
const LIST_TARGETS = [
  'OrderManager.tsx',
  'DevelopmentManager.tsx',
  'QuotationManager.tsx',
  'ProcurementManager.tsx',
  'ShipmentManager.tsx',
  'FinanceManager.tsx',
  'CustomsManager.tsx',
  'MesManager.tsx',
] as const;

describe('cross-module nav wiring (productized Links)', () => {
  it('entry hub primes nav context before switching views', () => {
    const source = read('./ui/RelatedWorkspacesSection.tsx');
    expect(source).toContain('primeCrossModuleNav');
    expect(source).toContain('onNavigate(entry.view)');
    // 入口卡片携带筛选上下文——关系源用 relationId 锚，产品源用 productId 锚
    expect(source).toMatch(/filter:\s*(isProduct\s*\?\s*\{[^}]*productId|\{[^}]*relationId)/);
    expect(source).toContain("anchor: 'relation'");
    expect(source).toContain("anchor: 'product'");
  });

  it('entry hub covers all business domains promised by related-summary API', () => {
    const source = read('./ui/RelatedWorkspacesSection.tsx');
    const serviceSource = read('../services/entityLinksService.ts');
    // RelatedSummary 的每个业务域 key 都要有入口（结汇/付汇为操作流，无独立列表页，允许缺省）
    const summaryBlock = serviceSource.match(/export interface RelatedSummary \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const summaryKeys = [...summaryBlock.matchAll(/^\s{2}(\w+):\s*number;/gm)].map((m) => m[1]);
    expect(summaryKeys.length).toBeGreaterThanOrEqual(13);
    const allowedMissing = new Set(['fxSettlements', 'outwardRemittances']);
    for (const key of summaryKeys) {
      if (allowedMissing.has(key)) continue;
      expect(source).toContain(`key: '${key}'`);
    }
  });

  it.each(LIST_TARGETS)('%s consumes nav context and offers a clearable filter chip', (file) => {
    const source = read(`./${file}`);
    expect(source).toContain('consumeCrossModuleNav');
    expect(source).toContain('NavRelationFilterChip');
  });

  it('CrmManager (relation-centric page) lands nav as preselected relation', () => {
    const source = read('./CrmManager.tsx');
    expect(source).toContain('consumeCrossModuleNav');
    // 导航目标客户作为初始选中项（lazy state init，避免被首客户自动选中覆盖）
    expect(source).toMatch(/useState<string \| null>\(navRelationId\)/);
  });

  it('backend summary endpoint exists with business-table counts (route contract)', () => {
    const routeSource = read('../server/src/entities/route.ts');
    expect(routeSource).toContain("router.get('/related-summary'");
    // 计数走业务表真实关联字段，而非 EntityLink 图谱边
    for (const field of ['customerRelationId', 'supplierRelationId', 'supplierId']) {
      expect(routeSource).toContain(field);
    }
  });
});
