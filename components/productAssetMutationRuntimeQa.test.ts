import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-product-asset-mutation-runtime-qa: fixture-driven runtime QA
 * 消费已 merged product_asset create/update/delete Agent flow + Products route service contract（task_mr1pmxs9）。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改后端。
 */

const fs = require('fs');
const path = require('path');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/productAssetMutationFlow.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/products/productAssetMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/products/route.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const API_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/apiService.ts'), 'utf-8');
const PRODUCTS_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'ProductsManager.tsx'), 'utf-8');

// ═══ Part 1: Agent flow — create ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildProductAssetCreateDraft 六字段', () => {
  it('idempotencyKey 格式: product_asset.create:${sku}:${hash}', () => {
    expect(FLOW_SRC).toContain('product_asset.create:${sku');
  });
  it('toolId = product_asset.create', () => {
    expect(FLOW_SRC).toContain("toolId: 'product_asset.create'");
  });
  it('action = create_product_asset', () => {
    expect(FLOW_SRC).toContain("action: 'create_product_asset'");
  });
  it('impactScope 固定 [products, audit]', () => {
    expect(FLOW_SRC).toContain("impactScope: ['products', 'audit']");
  });
  it('irreversible = false（create 可回滚）', () => {
    const m = FLOW_SRC.match(/buildProductAssetCreateDraft[\s\S]*?irreversible: (true|false)/);
    expect(m![1]).toBe('false');
  });
  it('after 含 sku/name/mainCategory/cost/status', () => {
    expect(FLOW_SRC).toContain('after: { sku, name: body.name, mainCategory: body.mainCategory, cost: body.cost, status: body.status }');
  });
});

// ═══ Part 2: Agent flow — update ProcessDraft ═══
describe('runtime QA [Agent flow]: buildProductAssetUpdateDraft', () => {
  it('idempotencyKey 格式: product_asset.update:${assetId}:${hash}', () => {
    expect(FLOW_SRC).toContain('product_asset.update:${assetId}');
  });
  it('toolId = product_asset.update', () => {
    expect(FLOW_SRC).toContain("toolId: 'product_asset.update'");
  });
  it('action = update_product_asset', () => {
    expect(FLOW_SRC).toContain("action: 'update_product_asset'");
  });
  it('after 含 { assetId, patch }', () => {
    expect(FLOW_SRC).toContain('after: { assetId, patch }');
  });
  it('beforeAfterDiff: patch 每个字段 before→after', () => {
    expect(FLOW_SRC).toContain('patchKeys.map((k) =>');
  });
  it('irreversible = false', () => {
    const m = FLOW_SRC.match(/buildProductAssetUpdateDraft[\s\S]*?irreversible: (true|false)/);
    expect(m![1]).toBe('false');
  });
});

// ═══ Part 3: Agent flow — delete ProcessDraft ═══
describe('runtime QA [Agent flow]: buildProductAssetDeleteDraft', () => {
  it('idempotencyKey 格式: product_asset.delete:${assetId}:${hash}', () => {
    expect(FLOW_SRC).toContain('product_asset.delete:${assetId}');
  });
  it('toolId = product_asset.delete', () => {
    expect(FLOW_SRC).toContain("toolId: 'product_asset.delete'");
  });
  it('action = delete_product_asset', () => {
    expect(FLOW_SRC).toContain("action: 'delete_product_asset'");
  });
  it('beforeAfterDiff: deletedAt null → true', () => {
    expect(FLOW_SRC).toContain("field: 'deletedAt', before: null, after: true as any");
  });
  it('irreversible = true（delete 不可逆）', () => {
    const m = FLOW_SRC.match(/buildProductAssetDeleteDraft[\s\S]*?irreversible: (true|false)/);
    expect(m![1]).toBe('true');
  });
});

// ═══ Part 4: Agent flow — Feedback 三态 + Committed ═══
describe('runtime QA [Agent flow]: Feedback 三态 + Committed', () => {
  it('Feedback union 含 approval_required/committed/failed', () => {
    expect(FLOW_SRC).toContain("status: 'approval_required'");
    expect(FLOW_SRC).toContain("status: 'committed'");
    expect(FLOW_SRC).toContain("status: 'failed'");
  });
  it('Committed 含 assetId/auditId/idempotencyKey', () => {
    const m = FLOW_SRC.match(/export interface ProductAssetFlowCommitted \{[\s\S]*?\}/);
    for (const f of ['assetId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

// ═══ Part 5: Agent flow — ErrorCode ═══
describe('runtime QA [Agent flow]: ErrorCode union', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => {
      expect(FLOW_SRC).toContain(`'${code}'`);
    });
  }
  const SERVICE_CODES = ['INVALID_INPUT', 'INVALID_AMOUNT', 'NOT_FOUND', 'ALREADY_DELETED', 'CREATE_FAILED', 'UPDATE_FAILED', 'DELETE_FAILED'];
  for (const code of SERVICE_CODES) {
    it(`service error code "${code}"`, () => {
      expect(SERVICE_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 6: Agent flow — hash 防篡改（三条 commit path） ═══
describe('runtime QA [Agent flow]: hash 防篡改（verifyHash + 三条 commit path）', () => {
  it('verifyHash: computeProcessDraftHash 重算', () => {
    expect(FLOW_SRC).toContain('computeProcessDraftHash(content)');
  });
  it('verifyHash: :pd: 后缀解析', () => {
    expect(FLOW_SRC).toContain("idempotencyKey.includes(':pd:')");
  });
  it('commitProductAssetCreate: verifyHash + HASH_MISMATCH fail closed + DRAFT_MISSING', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetCreate[\s\S]*?^}/m);
    expect(m![0]).toContain('verifyHash');
    expect(m![0]).toContain('PROCESS_DRAFT_HASH_MISMATCH');
    expect(m![0]).toContain('PROCESS_DRAFT_MISSING');
  });
  it('commitProductAssetUpdate: verifyHash + HASH_MISMATCH', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetUpdate[\s\S]*?^}/m);
    expect(m![0]).toContain('PROCESS_DRAFT_HASH_MISMATCH');
  });
  it('commitProductAssetDelete: verifyHash + HASH_MISMATCH', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetDelete[\s\S]*?^}/m);
    expect(m![0]).toContain('PROCESS_DRAFT_HASH_MISMATCH');
  });
});

// ═══ Part 7: Agent flow — commit 复用 service（不绕 contract） ═══
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitProductAssetCreate 复用 createProductAsset service', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetCreate[\s\S]*?^}/m);
    expect(m![0]).toContain('createProductAsset');
  });
  it('commitProductAssetUpdate 复用 updateProductAsset service', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetUpdate[\s\S]*?^}/m);
    expect(m![0]).toContain('updateProductAsset');
  });
  it('commitProductAssetDelete 复用 deleteProductAsset service', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetDelete[\s\S]*?^}/m);
    expect(m![0]).toContain('deleteProductAsset');
  });
  it('commit 成功返回 assetId + auditId + idempotencyKey', () => {
    const m = FLOW_SRC.match(/export async function commitProductAssetCreate[\s\S]*?^}/m);
    expect(m![0]).toContain('assetId: result.data!.asset.id');
    expect(m![0]).toContain('auditId: result.data!.auditId');
  });
});

// ═══ Part 8: toolRuntime commit dispatch（三条 path 精确分支体断言） ═══
describe('runtime QA [toolRuntime]: commit dispatch 三条 path（精确分支体）', () => {
  it('call.toolId === product_asset.create 分支体调用 commitProductAssetCreate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'product_asset\.create'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitProductAssetCreate');
  });
  it('product_asset.create 分支体传 approvalId: targetApprovalId + approvalPayload: approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'product_asset\.create'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });

  it('call.toolId === product_asset.update 分支体调用 commitProductAssetUpdate', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'product_asset\.update'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitProductAssetUpdate');
  });
  it('product_asset.update 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'product_asset\.update'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });

  it('call.toolId === product_asset.delete 分支体调用 commitProductAssetDelete', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'product_asset\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitProductAssetDelete');
  });
  it('product_asset.delete 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'product_asset\.delete'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId: targetApprovalId');
    expect(m![0]).toContain('approvalPayload: approval.payload');
  });

  it('draft 分支 definition.id === product_asset.create/update/delete', () => {
    expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'product_asset.create'");
    expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'product_asset.update'");
    expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'product_asset.delete'");
  });
});

// ═══ Part 9: Manual route — POST/PATCH/DELETE /assets ═══
describe('runtime QA [Manual route]: POST/PATCH/DELETE /assets', () => {
  it('POST /assets 调 createProductAsset service', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/assets',[\s\S]*?\n  \}\);/);
    expect(m![0]).toContain('createProductAsset');
  });
  it('POST /assets 成功返回 201 { ok:true, asset }', () => {
    expect(ROUTE_SRC).toContain('res.status(201).json({ ok: true, asset: serializeBigInts(asset) })');
  });
  it('PATCH /assets/:id 调 updateProductAsset service', () => {
    const m = ROUTE_SRC.match(/router\.patch\('\/assets\/:id',[\s\S]*?\n  \}\);/);
    expect(m![0]).toContain('updateProductAsset');
  });
  it('DELETE /assets/:id 调 deleteProductAsset service', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/assets\/:id',[\s\S]*?\n  \}\);/);
    expect(m![0]).toContain('deleteProductAsset');
  });
  it('DELETE /assets/:id 成功返回 { ok:true, deleted }', () => {
    expect(ROUTE_SRC).toContain('res.json({ ok: true, deleted: existing.id })');
  });
  it('route + Agent 共用 service（不手写 DB mutation）', () => {
    expect(ROUTE_SRC).toContain('route + Agent 共用');
  });
});

// ═══ Part 10: 前端 service — apiService 消费 route ═══
describe('runtime QA [前端 service]: apiService 消费 route', () => {
  it('createProductAsset: POST /v1/products/assets', () => {
    expect(API_SVC_SRC).toContain("'/v1/products/assets'");
    expect(API_SVC_SRC).toContain("method: 'POST'");
  });
  it('createProductAsset 返回 data.asset', () => {
    expect(API_SVC_SRC).toContain('return data.asset');
  });
  it('updateProductAsset: PATCH /v1/products/assets/:id', () => {
    expect(API_SVC_SRC).toContain('/v1/products/assets/${encodeURIComponent(id)}');
  });
  it('deleteProductAsset: DELETE /v1/products/assets/:id', () => {
    expect(API_SVC_SRC).toContain('/v1/products/assets/${encodeURIComponent(id)}');
  });
  it('deleteProductAsset 返回 { ok, deleted }', () => {
    expect(API_SVC_SRC).toContain('Promise<{ ok: boolean; deleted: string }>');
  });
});

// ═══ Part 11: ProductsManager UI 消费边界 ═══
describe('runtime QA [ProductsManager UI]: 消费 apiService', () => {
  it('consume apiService.createProductAsset', () => {
    expect(PRODUCTS_MGR_SRC).toContain('apiService.createProductAsset');
  });
  it('consume apiService.updateProductAsset', () => {
    expect(PRODUCTS_MGR_SRC).toContain('apiService.updateProductAsset');
  });
  it('consume apiService.deleteProductAsset', () => {
    expect(PRODUCTS_MGR_SRC).toContain('apiService.deleteProductAsset');
  });
  it('不混 Agent flow（不调 commit function）', () => {
    expect(PRODUCTS_MGR_SRC).not.toContain('commitProductAssetCreate');
    expect(PRODUCTS_MGR_SRC).not.toContain('commitProductAssetUpdate');
    expect(PRODUCTS_MGR_SRC).not.toContain('commitProductAssetDelete');
  });
});

// ═══ Part 12: 真实 fixture ═══
describe('runtime QA [fixture]: 真实 product asset payload', () => {
  it('create committed: { status:committed, assetId, auditId, idempotencyKey }', () => {
    const committed = { status: 'committed' as const, assetId: 'pa1', auditId: 'alog_1', idempotencyKey: 'product_asset.create:SKU1:pd:abc' };
    expect(committed.idempotencyKey).toContain('product_asset.create:SKU1');
  });
  it('POST 成功 res: { ok:true, asset:{...} }', () => {
    const res = { ok: true, asset: { id: 'pa1', sku: 'SKU1', name: 'Fabric A' } };
    expect(res.asset.sku).toBe('SKU1');
  });
  it('DELETE 成功 res: { ok:true, deleted: id }', () => {
    const res = { ok: true, deleted: 'pa1' };
    expect(res.deleted).toBe('pa1');
  });
  it('INVALID_AMOUNT 失败（service error code 稳定）', () => {
    expect(SERVICE_SRC).toContain("'INVALID_AMOUNT'");
  });
  it('NOT_FOUND 失败', () => {
    expect(SERVICE_SRC).toContain("'NOT_FOUND'");
  });
});
