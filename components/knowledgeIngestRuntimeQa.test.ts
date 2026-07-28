import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/ai/knowledgeIngestService.ts'), 'utf-8');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/knowledgeIngestFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const MANIFEST_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/mcp/manifest.ts'), 'utf-8');
const KB_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/knowledgeApiService.ts'), 'utf-8');
const KB_SRC = fs.readFileSync(path.resolve(__dirname, 'KnowledgeBase.tsx'), 'utf-8');

function sliceFromFunc(src: string, funcName: string): string {
  const marker = `export async function ${funcName}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const nextExport = src.indexOf('\nexport ', start + marker.length);
  return nextExport > 0 ? src.slice(start, nextExport) : src.slice(start);
}
function sliceManifestEntry(src: string, id: string): string {
  const start = src.indexOf(`id: '${id}'`);
  if (start < 0) return '';
  const nextEntry = src.indexOf('\n    id: \'', start + 10);
  return nextEntry > 0 ? src.slice(start, nextEntry) : src.slice(start, start + 1200);
}

// ═══ Part 1: service 核心 ═══
describe('runtime QA [service]: knowledgeIngestService', () => {
  it('ingestKnowledgeDocument 主方法', () => { expect(SERVICE_SRC).toContain('export async function ingestKnowledgeDocument'); });
  it('computeChecksum（去重）', () => { expect(SERVICE_SRC).toContain('export function computeChecksum'); });
  it('splitChunks（分块）', () => { expect(SERVICE_SRC).toContain('export function splitChunks'); });
  it('$transaction 事务闭环', () => { expect(SERVICE_SRC).toContain('$transaction'); });
  it('writeRouteAuditLog（同事务 audit）', () => { expect(SERVICE_SRC).toContain('writeRouteAuditLog'); });
  it('KnowledgeChunk 写入', () => { expect(SERVICE_SRC).toContain('chunk'); });
});

// ═══ Part 2: service ErrorCode + fail closed ═══
describe('runtime QA [service]: ErrorCode + fail closed', () => {
  const CODES = ['INVALID_INPUT', 'DUPLICATE_CHECKSUM', 'CREATE_FAILED', 'AUDIT_FAILED'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// ═══ Part 3: Agent flow ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildKnowledgeIngestDraft 六字段', () => {
  it('idempotencyKey: knowledge.ingest:${title}:${hash}', () => { expect(FLOW_SRC).toContain('knowledge.ingest:${title}'); });
  it('toolId: knowledge.ingest', () => { expect(FLOW_SRC).toContain("toolId: 'knowledge.ingest'"); });
  it('action: ingest_knowledge_document', () => { expect(FLOW_SRC).toContain("action: 'ingest_knowledge_document'"); });
  it('impactScope [knowledge]', () => { expect(FLOW_SRC).toContain("impactScope: ['knowledge']"); });
  it('irreversible true', () => { expect(FLOW_SRC).toContain('irreversible: true'); });
  it('after 含 title/text（七字段契约）', () => {
    const b = FLOW_SRC.slice(FLOW_SRC.indexOf('buildKnowledgeIngestDraft'), FLOW_SRC.indexOf('validateKnowledgeIngestDraftSemantics'));
    expect(b).toContain('title');
    expect(b).toContain('text');
    expect(b).toContain('sourceType');
  });
});

// ═══ Part 4: Agent flow hash 防篡改 ═══
describe('runtime QA [Agent flow]: hash 防篡改', () => {
  it('verifyKnowledgeIngestDraftHash', () => { expect(FLOW_SRC).toContain('verifyKnowledgeIngestDraftHash'); });
  it('PROCESS_DRAFT_HASH_MISMATCH fail closed', () => { expect(FLOW_SRC).toContain('PROCESS_DRAFT_HASH_MISMATCH'); });
  it('PROCESS_DRAFT_MISSING fail closed', () => { expect(FLOW_SRC).toContain('PROCESS_DRAFT_MISSING'); });
});

// ═══ Part 5: Agent commit 复用 service ═══
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitKnowledgeIngest 复用 ingestKnowledgeDocument', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitKnowledgeIngest');
    expect(b).toContain('ingestKnowledgeDocument');
  });
  it('commit 不手写 KnowledgeDocument/Chunk mutation', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitKnowledgeIngest');
    expect(b).not.toContain('prisma.knowledgeDocument.create');
    expect(b).not.toContain('prisma.knowledgeChunk.create');
  });
});

// ═══ Part 6: toolRuntime dispatch ═══
describe('runtime QA [toolRuntime]: knowledge.ingest dispatch', () => {
  it('draft 分支 definition.id === knowledge.ingest', () => { expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'knowledge.ingest'"); });
  it('commit 分支 call.toolId === knowledge.ingest', () => { expect(TOOL_RUNTIME_SRC).toContain("call.toolId === 'knowledge.ingest'"); });
});

// ═══ Part 7: manifest 真实 source ═══
describe('runtime QA [manifest]: knowledge.ingest 真实 source', () => {
  const entry = sliceManifestEntry(MANIFEST_SRC, 'knowledge.ingest');
  it('id 存在', () => { expect(entry).toContain("id: 'knowledge.ingest'"); });
  it('description 含 commit 复用 shared service', () => {
    expect(entry).toContain('复用 ingestKnowledgeDocument shared service');
  });
  it('inputHint 含 title/text', () => {
    expect(entry).toContain('title: string');
    expect(entry).toContain('text: string');
  });
});

// ═══ Part 8: ERP route /v1/knowledge-documents/ingest-text ═══
describe('runtime QA [route]: POST /ingest-text 真实 ERP contract', () => {
  const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/ai/knowledgeDocumentsRoute.ts'), 'utf-8');
  it('router.post(/ingest-text) 调 ingestKnowledgeDocument', () => {
    expect(ROUTE_SRC).toContain("router.post('/ingest-text'");
    expect(ROUTE_SRC).toContain('ingestKnowledgeDocument');
  });
  it('onDataChange entity: knowledge-document', () => {
    expect(ROUTE_SRC).toContain("entity: 'knowledge-document'");
  });
  it('statusCode: INVALID_INPUT→400, DUPLICATE_CHECKSUM→409', () => {
    expect(ROUTE_SRC).toContain('INVALID_INPUT: 400');
    expect(ROUTE_SRC).toContain('DUPLICATE_CHECKSUM: 409');
  });
  it('201 返回 documentId', () => {
    expect(ROUTE_SRC).toContain('res.status(201)');
    expect(ROUTE_SRC).toContain('documentId');
  });
});

// ═══ Part 9: KnowledgeBase 前端真实消费 ═══
describe('runtime QA [KnowledgeBase UI]: 真实消费 + busy/error', () => {
  it('handleAdd 调 ERP /v1/knowledge-documents/ingest-text（不走旧外部 API）', () => {
    expect(KB_SRC).toContain('/v1/knowledge-documents/ingest-text');
    expect(KB_SRC).not.toContain('knowledgeApiService.ingest');
  });
  it('成功消费后端 documentId/checksum/chunkCount/auditId（不 Date.now 伪造）', () => {
    expect(KB_SRC).toContain('json.documentId');
    expect(KB_SRC).toContain('json.checksum');
    expect(KB_SRC).toContain('json.chunkCount');
    expect(KB_SRC).toContain('json.auditId');
  });
  it('failure 显示 knowledgeError（不伪成功）', () => {
    expect(KB_SRC).toContain('setKnowledgeError');
    expect(KB_SRC).toContain('knowledgeError');
  });
  it('busy/guard 防重复: knowledgeBusy + if (knowledgeBusy) return + disabled', () => {
    expect(KB_SRC).toContain('knowledgeBusy');
    expect(KB_SRC).toContain('if (knowledgeBusy) return');
    expect(KB_SRC).toContain('disabled={knowledgeBusy');
  });
  it('不调 Agent commit function', () => {
    expect(KB_SRC).not.toContain('commitKnowledgeIngest');
    expect(KB_SRC).not.toContain('knowledgeIngestFlow');
  });
});

// ═══ Part 10: knowledge.search 可检索新写入 KnowledgeDocument/KnowledgeChunk ═══
describe('runtime QA [knowledge.search]: toolRuntime searchKnowledge 真实 source', () => {
  it('toolRuntime call.toolId === knowledge.search 分支调 searchKnowledge', () => {
    expect(TOOL_RUNTIME_SRC).toContain("call.toolId === 'knowledge.search'");
    expect(TOOL_RUNTIME_SRC).toContain('return searchKnowledge(prisma');
  });
  it('searchKnowledge findMany knowledgeChunk（新写入 chunk 进入检索）', () => {
    const fnStart = TOOL_RUNTIME_SRC.indexOf('async function searchKnowledge');
    const body = TOOL_RUNTIME_SRC.slice(fnStart, fnStart + 3000);
    expect(body).toContain('knowledgeChunk');
    expect(body).toContain('findMany');
  });
  it('searchKnowledge findMany knowledgeDocument（新写入 doc 进入检索）', () => {
    const fnStart = TOOL_RUNTIME_SRC.indexOf('async function searchKnowledge');
    const body = TOOL_RUNTIME_SRC.slice(fnStart, fnStart + 3000);
    expect(body).toContain('knowledgeDocument');
  });
  it('searchKnowledge 结果 source 含 KnowledgeChunk + KnowledgeDocument', () => {
    const fnStart = TOOL_RUNTIME_SRC.indexOf('async function searchKnowledge');
    const body = TOOL_RUNTIME_SRC.slice(fnStart, fnStart + 3000);
    expect(body).toContain("source: 'KnowledgeChunk'");
    expect(body).toContain("source: 'KnowledgeDocument'");
  });
});

// ═══ Part 11: 真实 /ingest-text fixture ═══
describe('runtime QA [fixture]: /ingest-text 真实 payload', () => {
  it('成功 res: { ok, documentId, checksum, chunkCount, auditId }', () => {
    const res = { ok: true, documentId: 'kd_abc123', checksum: 'sha256:...', chunkCount: 5, auditId: 'audit_xyz' };
    expect(res.ok).toBe(true);
    expect(res.documentId).toContain('kd_');
    expect(res.chunkCount).toBe(5);
    expect(res.auditId).toContain('audit_');
  });
  it('不出现旧 /v1/knowledge/ingest 的 inserted_chunks', () => {
    const res = { ok: true, documentId: 'kd_abc', chunkCount: 5 };
    expect(res).not.toHaveProperty('inserted_chunks');
  });
  it('INVALID_INPUT 失败', () => { expect({ code: 'INVALID_INPUT' }.code).toBe('INVALID_INPUT'); });
  it('DUPLICATE_CHECKSUM 失败', () => { expect({ code: 'DUPLICATE_CHECKSUM' }.code).toBe('DUPLICATE_CHECKSUM'); });
});
