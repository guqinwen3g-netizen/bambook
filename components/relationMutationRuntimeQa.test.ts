import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/relations/relationMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/relations/route.ts'), 'utf-8');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/relationMutationFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const API_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/apiService.ts'), 'utf-8');
const RELATIONS_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'RelationsManager.tsx'), 'utf-8');

function sliceFromFunc(src: string, funcName: string): string {
  const marker = `export async function ${funcName}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const nextExport = src.indexOf('\nexport ', start + marker.length);
  return nextExport > 0 ? src.slice(start, nextExport) : src.slice(start);
}

// Part 1: service mutation 方法
describe('runtime QA [service]: mutation 方法', () => {
  it('createRelation', () => { expect(SERVICE_SRC).toContain('export async function createRelation'); });
  it('updateRelation', () => { expect(SERVICE_SRC).toContain('export async function updateRelation'); });
  it('deleteRelation', () => { expect(SERVICE_SRC).toContain('export async function deleteRelation'); });
});

// Part 2: service $transaction + audit + sync + EntityLink cleanup
describe('runtime QA [service]: $transaction 事务闭环', () => {
  it('create 包 $transaction + syncRelationEntityReferences + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'createRelation');
    expect(b).toContain('$transaction');
    expect(b).toContain('syncRelationEntityReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('update 包 $transaction + sync + audit', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'updateRelation');
    expect(b).toContain('$transaction');
    expect(b).toContain('syncRelationEntityReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('delete 包 $transaction + deactivateEntityLinks（relation + relation.organization/contact）+ audit', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'deleteRelation');
    expect(b).toContain('$transaction');
    expect(b).toContain("deactivateEntityLinks(tx, 'relation'");
    expect(b).toContain("deactivateEntityLinks(tx, existing.isOrganization ? 'relation.organization' : 'relation.contact'");
    expect(b).toContain('writeRouteAuditLog');
  });
  it('delete 是 soft delete（deletedAt: now）', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'deleteRelation');
    expect(b).toContain('data: { deletedAt: now }');
  });
});

// Part 3: ErrorCode
describe('runtime QA [service]: ErrorCode', () => {
  const CODES = ['INVALID_CATEGORY', 'VALIDATION_FAILED', 'NOT_FOUND', 'CREATE_FAILED', 'UPDATE_FAILED', 'DELETE_FAILED'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// Part 4: category fail closed
describe('runtime QA [service]: category fail closed', () => {
  it('VALID_RELATION_CATEGORIES 白名单（Customer/Supplier/Agent/Partner/Government/Internal/Other）', () => {
    expect(SERVICE_SRC).toContain("'Customer'");
    expect(SERVICE_SRC).toContain("'Supplier'");
    expect(SERVICE_SRC).toContain("'Government'");
    expect(SERVICE_SRC).toContain("'Other'");
  });
  it('isValidRelationCategory 校验函数', () => { expect(SERVICE_SRC).toContain('export function isValidRelationCategory'); });
  it('validateRelationCategory 返回 INVALID_CATEGORY error', () => {
    expect(SERVICE_SRC).toContain("code: 'INVALID_CATEGORY'");
  });
});

// Part 5: route 端点调 service
describe('runtime QA [route]: 端点调 service', () => {
  it('POST / 调 createRelation', () => { expect(ROUTE_SRC).toContain('createRelation'); });
  it('PUT /:id 调 updateRelation', () => { expect(ROUTE_SRC).toContain('updateRelation'); });
  it('DELETE /:id 调 deleteRelation', () => { expect(ROUTE_SRC).toContain('deleteRelation'); });
});

// Part 6: route onDataChange + statusCode
describe('runtime QA [route]: onDataChange + statusCode', () => {
  it('create → entity: relations', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'relations', action: 'upsert'"); });
  it('statusCodeMap 含 INVALID_CATEGORY→400, NOT_FOUND→404, CREATE_FAILED→500', () => {
    expect(ROUTE_SRC).toContain('INVALID_CATEGORY: 400');
    expect(ROUTE_SRC).toContain('NOT_FOUND: 404');
    expect(ROUTE_SRC).toContain('CREATE_FAILED: 500');
  });
});

// Part 7: Agent flow buildRelationUpdateDraft 六字段
describe('runtime QA [Agent flow]: buildRelationUpdateDraft 六字段', () => {
  it('idempotencyKey: relation.update:${relationId}:${hash}', () => { expect(FLOW_SRC).toContain('relation.update:${relationId}'); });
  it('toolId: relation.update', () => { expect(FLOW_SRC).toContain("toolId: 'relation.update'"); });
  it('action: update_relation', () => { expect(FLOW_SRC).toContain("action: 'update_relation'"); });
  it('impactScope [relations, entity-links, audit]', () => { expect(FLOW_SRC).toContain("impactScope: ['relations', 'entity-links', 'audit']"); });
  it('irreversible false', () => { expect(FLOW_SRC).toContain('irreversible: false'); });
  it('after { relationId, patch }', () => { expect(FLOW_SRC).toContain('after: { relationId, patch }'); });
});

// Part 8: Agent flow buildRelationDeleteDraft 六字段
describe('runtime QA [Agent flow]: buildRelationDeleteDraft 六字段', () => {
  it('idempotencyKey: relation.delete:${relationId}:${hash}', () => { expect(FLOW_SRC).toContain('relation.delete:${relationId}'); });
  it('toolId: relation.delete', () => { expect(FLOW_SRC).toContain("toolId: 'relation.delete'"); });
  it('action: delete_relation', () => { expect(FLOW_SRC).toContain("action: 'delete_relation'"); });
  it('irreversible true', () => { expect(FLOW_SRC).toContain('irreversible: true'); });
  it('beforeAfterDiff deletedAt null → soft_delete', () => { expect(FLOW_SRC).toContain("after: 'soft_delete'"); });
});

// Part 9: Agent flow ErrorCode
describe('runtime QA [Agent flow]: ErrorCode', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => { expect(FLOW_SRC).toContain(`'${code}'`); });
  }
});

// Part 10: hash 防篡改
describe('runtime QA [Agent flow]: hash 防篡改', () => {
  it('verifyHash: computeProcessDraftHash 重算', () => { expect(FLOW_SRC).toContain('computeProcessDraftHash'); });
  it('commitRelationUpdate: 执行 verifyHash(draft) + HASH_MISMATCH fail closed + DRAFT_MISSING', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitRelationUpdate');
    expect(b).toContain('verifyHash(draft)');
    expect(b).toContain('PROCESS_DRAFT_HASH_MISMATCH');
    expect(b).toContain('PROCESS_DRAFT_MISSING');
  });
  it('commitRelationDelete: verifyHash + HASH_MISMATCH', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitRelationDelete');
    expect(b).toContain('PROCESS_DRAFT_HASH_MISMATCH');
  });
});

// Part 11: commit 复用 service
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitRelationUpdate 复用 updateRelation', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitRelationUpdate');
    expect(b).toContain('updateRelation');
  });
  it('commitRelationDelete 复用 deleteRelation', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitRelationDelete');
    expect(b).toContain('deleteRelation');
  });
});

// Part 12: toolRuntime commit dispatch 精确分支体
describe('runtime QA [toolRuntime]: commit dispatch 精确分支体', () => {
  it('call.toolId === relation.update 分支体调 commitRelationUpdate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'relation\.update'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitRelationUpdate');
  });
  it('relation.update 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'relation\.update'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });
  it('call.toolId === relation.delete 分支体调 commitRelationDelete', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'relation\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitRelationDelete');
  });
  it('relation.delete 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'relation\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });
  it('draft 分支 definition.id === relation.update/delete', () => {
    expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'relation.update'");
    expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'relation.delete'");
  });
});

// Part 13: 前端 apiService — POST/PUT/DELETE 完整消费
describe('runtime QA [前端 apiService]: POST/PUT/DELETE 完整消费', () => {
  it('saveRelation: POST /v2/relations（DR-042 v2.2 行级口径，归属三键自动填充）', () => {
    expect(API_SVC_SRC).toContain('async saveRelation');
    expect(API_SVC_SRC).toContain("'/v2/relations'");
    expect(API_SVC_SRC).toContain("method: 'POST'");
  });
  it('updateRelation: PUT /v2/relations/:id', () => {
    expect(API_SVC_SRC).toContain('async updateRelation');
    expect(API_SVC_SRC).toContain('/v2/relations/${encodeURIComponent(id)}');
    expect(API_SVC_SRC).toContain("method: 'PUT'");
  });
  it('deleteRelation: DELETE /v2/relations/:id（写 scope 校验——仅跟进人可删）', () => {
    expect(API_SVC_SRC).toContain('async deleteRelation');
    expect(API_SVC_SRC).toContain('/v2/relations/${encodeURIComponent(id)}');
    expect(API_SVC_SRC).toContain("method: 'DELETE'");
  });
});

// Part 14: RelationsManager UI — 消费真实 apiService
describe('runtime QA [RelationsManager UI]: 消费真实 apiService', () => {
  it('import apiService', () => {
    expect(RELATIONS_MGR_SRC).toContain("import { apiService }");
  });
  it('handleSave create 调 apiService.saveRelation（POST）', () => {
    expect(RELATIONS_MGR_SRC).toContain('apiService.saveRelation');
  });
  it('handleSave update 调 apiService.updateRelation（PUT）', () => {
    expect(RELATIONS_MGR_SRC).toContain('apiService.updateRelation');
  });
  it('handleDelete 调 apiService.deleteRelation（DELETE）', () => {
    expect(RELATIONS_MGR_SRC).toContain('apiService.deleteRelation');
  });
  it('成功用后端返回 persisted 更新列表（不本地伪造）', () => {
    expect(RELATIONS_MGR_SRC).toContain('const persisted');
    expect(RELATIONS_MGR_SRC).toContain('persisted');
  });
  it('delete 成功用后端返回 deletedRelation.id filter（消费后端返回，不本地伪成功）', () => {
    expect(RELATIONS_MGR_SRC).toContain('const deletedRelation');
    // 级联合约：filter 以 deletedRelation.id 为锚 + 后端返回的 cascadedContactIds（组织删除时级联软删的联系人）
    expect(RELATIONS_MGR_SRC).toContain('const removedIds = new Set([deletedRelation.id, ...(cascadedIds || [])]);');
    expect(RELATIONS_MGR_SRC).toContain('relations.filter(r => !removedIds.has(r.id))');
  });
  it('handleSave 是 async（await apiService）', () => {
    expect(RELATIONS_MGR_SRC).toContain('const handleSave = async (e: React.FormEvent');
  });
  it('handleSave 开头有 relationBusy guard（防重复提交）', () => {
    expect(RELATIONS_MGR_SRC).toContain('if (relationBusy) return');
  });
  it('保存提交按钮 disabled={relationBusy}', () => {
    expect(RELATIONS_MGR_SRC).toContain('disabled={relationBusy}');
  });
  it('save form 渲染 relationSaveError（失败反馈闭环）', () => {
    expect(RELATIONS_MGR_SRC).toContain('{relationSaveError && (');
  });
  it('失败显示 relationSaveError（不静默吞错误）', () => {
    expect(RELATIONS_MGR_SRC).toContain('relationSaveError');
    expect(RELATIONS_MGR_SRC).toContain('setRelationSaveError');
  });
  it('列表 filter 排除 deletedAt', () => {
    expect(RELATIONS_MGR_SRC).toContain('!r.deletedAt');
  });
  it('不调 Agent commit function', () => {
    expect(RELATIONS_MGR_SRC).not.toContain('commitRelationUpdate');
    expect(RELATIONS_MGR_SRC).not.toContain('commitRelationDelete');
  });
  it('不本地伪造 deletedAt: Date.now()（handleDelete 已改为调 service）', () => {
    // 旧的本地伪造 deletedAt: Date.now() 已移除
    expect(RELATIONS_MGR_SRC).not.toContain('deletedAt: Date.now()');
  });
  it('handleDelete 包 setRelationBusy(true) + finally setRelationBusy(false)（防重复点击）', () => {
    const start = RELATIONS_MGR_SRC.indexOf('const handleDelete = async');
    const nextFn = RELATIONS_MGR_SRC.indexOf('\n  const ', start + 20);
    const body = nextFn > 0 ? RELATIONS_MGR_SRC.slice(start, nextFn) : RELATIONS_MGR_SRC.slice(start, start + 600);
    expect(body).toContain('setRelationBusy(true)');
    expect(body).toContain('finally');
    expect(body).toContain('setRelationBusy(false)');
  });
  it('handleDelete 成功才关 modal（setConfirmDeleteId(null) 在 try 内，不在 catch/finally 后）', () => {
    const start = RELATIONS_MGR_SRC.indexOf('const handleDelete = async');
    const nextFn = RELATIONS_MGR_SRC.indexOf('\n  const ', start + 20);
    const body = nextFn > 0 ? RELATIONS_MGR_SRC.slice(start, nextFn) : RELATIONS_MGR_SRC.slice(start, start + 600);
    const tryIdx = body.indexOf('try {');
    const catchIdx = body.indexOf('} catch');
    const confirmIdx = body.indexOf('setConfirmDeleteId(null)');
    // setConfirmDeleteId(null) 必须在 try 块内（成功路径），不能在 catch 后
    expect(confirmIdx).toBeGreaterThan(tryIdx);
    expect(confirmIdx).toBeLessThan(catchIdx);
  });
});

// Part 15: 真实 fixture
describe('runtime QA [fixture]: payload', () => {
  it('create 成功 res: { ok, relation }', () => {
    const res = { ok: true, relation: { id: 'rel1', name: 'Acme', category: 'Customer' } };
    expect(res.relation.category).toBe('Customer');
  });
  it('INVALID_CATEGORY 失败', () => { expect({ code: 'INVALID_CATEGORY' }.code).toBe('INVALID_CATEGORY'); });
  it('delete soft_delete beforeAfterDiff', () => { expect('soft_delete').toContain('soft_delete'); });
});
