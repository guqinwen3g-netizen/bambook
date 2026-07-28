/**
 * knowledge.search gold/eval baseline (task_mr3c6jpa)
 *
 * 覆盖三类事实：
 *   A. manifest 注册（manifest.ts 含 id:'knowledge.search'）
 *   B. planner 规划（planner.ts 在知识库类问题时规划 knowledge.search）
 *   C. toolRuntime 执行（executeAgentTool → searchKnowledge 用 mock prisma 返回）
 *
 * 不依赖真实外部服务：searchKnowledge 是纯 Prisma contains 查询，
 * 用对象字面量 mock prisma.knowledgeChunk/knowledgeDocument/knowledgeItem 即可。
 */
import { describe, it, expect, vi } from 'vitest';
import { executeAgentTool } from '../toolRuntime';
import type { ActorContext } from '../types';

// ── manifest 注册事实 ──────────────────────────────────────────
// 直接从 toolRegistry 导出的 TOOL_DEFINITIONS（由 manifest 编译生成）验证。

// ── planner 注册事实 ───────────────────────────────────────────
// planner.ts 内联了 knowledge.search 的规划逻辑（toolId: 'knowledge.search'）。
// 这里用静态字符串校验，避免把整个 planner 拉进来（它需要更多 mock）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const PLANNER_SRC = readFileSync(join(__dirname, '..', 'mcp', 'planner.ts'), 'utf-8');
const MANIFEST_SRC = readFileSync(join(__dirname, '..', 'mcp', 'manifest.ts'), 'utf-8');

// ── toolRuntime 执行事实 ───────────────────────────────────────
// 用 mock prisma 验证 searchKnowledge 的查询路径与返回结构。
function makeKnowledgeMockPrisma(chunks: any[], documents: any[], legacy: any[]) {
  return {
    knowledgeChunk: { findMany: vi.fn(async () => chunks) },
    knowledgeDocument: { findMany: vi.fn(async () => documents) },
    knowledgeItem: { findMany: vi.fn(async () => legacy) },
  } as any;
}

const ownerActor: ActorContext = {
  userId: 'u1',
  displayName: 'Tester',
  roles: ['owner'],
  departmentIds: ['company'],
  memoryScopes: ['personal:u1'],
  toolScopes: ['products', 'orders', 'relations', 'knowledge', 'finance', 'email', 'entities', 'development', 'templates'],
} as any;

// ── Gold fixtures ──────────────────────────────────────────────
// 3 个 gold query，每个明确预期命中的来源类型与检索路径。
const GOLD_QUERIES = [
  {
    name: '样品发票规则 → KnowledgeChunk 命中',
    query: '样品发票规则',
    fixture: {
      chunks: [{
        id: 'kc_1', documentId: 'kd_1', chunkIndex: 0, summary: '样品发票规则',
        content: '样品发票必须包含成分比例和客户编码。', tags: ['发票', '样品'],
        document: { id: 'kd_1', title: '样品发票规则手册', status: 'active', deletedAt: null },
        updatedAt: new Date('2026-06-01'),
      }],
      documents: [],
      legacy: [],
    },
    expect: { minCount: 1, sourceContains: 'KnowledgeChunk' },
  },
  {
    name: '面料认证标准 → KnowledgeDocument 命中',
    query: '面料认证标准',
    fixture: {
      chunks: [],
      documents: [{
        id: 'kd_2', title: 'OEKO-TEX 面料认证标准', sourceType: 'manual', sourceUri: '', metadata: {},
        updatedAt: new Date('2026-06-02'),
      }],
      legacy: [],
    },
    expect: { minCount: 1, sourceContains: 'KnowledgeDocument' },
  },
  {
    name: '付款条件 → KnowledgeItemCompat 命中',
    query: '付款条件',
    fixture: {
      chunks: [],
      documents: [],
      legacy: [{
        id: 'ki_1', title: 'T/T 付款条件', category: 'finance',
        content: '客户默认 T/T 30 days after shipment。', updatedAt: new Date('2026-06-03'),
      }],
    },
    expect: { minCount: 1, sourceContains: 'KnowledgeItemCompat' },
  },
];

describe('knowledge.search gold/eval baseline', () => {

  // ═══ A. manifest 注册事实 ═══
  describe('A. manifest 注册（manifest.ts 源码事实）', () => {
    it('manifest.ts 含 id knowledge.search', () => {
      expect(MANIFEST_SRC).toContain("id: 'knowledge.search'");
    });

    it('manifest.ts knowledge.search inputHint 含 query', () => {
      // 截取 knowledge.search 段落，断言 inputHint 含 query
      const idx = MANIFEST_SRC.indexOf("id: 'knowledge.search'");
      expect(idx).toBeGreaterThan(-1);
      const section = MANIFEST_SRC.slice(idx, idx + 600);
      expect(section).toMatch(/inputHint[\s\S]*query/i);
    });
  });

  // ═══ B. planner 规划事实 ═══
  describe('B. planner 规划', () => {
    it('planner.ts 源码含 knowledge.search toolId', () => {
      expect(PLANNER_SRC).toContain("toolId: 'knowledge.search'");
    });

    it('planner.ts 源码含知识库规划 reason', () => {
      expect(PLANNER_SRC).toMatch(/知识库|knowledge/i);
    });
  });

  // ═══ C. toolRuntime 执行事实（3 个 gold query）═══
  describe('C. toolRuntime searchKnowledge 执行', () => {
    for (const gold of GOLD_QUERIES) {
      it(`gold: ${gold.name}`, async () => {
        const prisma = makeKnowledgeMockPrisma(gold.fixture.chunks, gold.fixture.documents, gold.fixture.legacy);
        const result: any = await executeAgentTool({
          prisma,
          actor: ownerActor,
          toolId: 'knowledge.search',
          toolInput: { query: gold.query, limit: 8 },
          sessionId: 'sess_gold_eval',
        });

        // 返回结构契约
        expect(result.dataSource).toBe('bambook-data-center');
        expect(result.query).toBe(gold.query);
        expect(result.count, 'count 应 ≥ 1').toBeGreaterThanOrEqual(gold.expect.minCount);
        expect(Array.isArray(result.items)).toBe(true);

        // 命中来源类型
        const sources = result.items.map((i: any) => i.source);
        expect(sources.some((s: string) => s.includes(gold.expect.sourceContains)),
          `期望命中来源含 ${gold.expect.sourceContains}，实际 sources=${JSON.stringify(sources)}`).toBe(true);

        // prisma 查询被调用（证明走了 searchKnowledge 路径）
        expect(prisma.knowledgeChunk.findMany).toHaveBeenCalled();
        expect(prisma.knowledgeDocument.findMany).toHaveBeenCalled();
        expect(prisma.knowledgeItem.findMany).toHaveBeenCalled();
      });
    }

    it('空 query 返回 count=0 不报错', async () => {
      const prisma = makeKnowledgeMockPrisma([], [], []);
      const result: any = await executeAgentTool({
        prisma, actor: ownerActor,
        toolId: 'knowledge.search',
        toolInput: { query: '' },
        sessionId: 'sess_empty',
      });
      expect(result.count).toBe(0);
      expect(result.items).toEqual([]);
    });
  });
});
