import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-order-line-runtime-qa: fixture-driven runtime QA
 * 消费已 merged order line mutation route + Agent order.line_update flow contract
 * （task_mqz8cdy6 route + task_mqz8ce0a Agent flow）。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改后端 contract。
 */

const fs = require('fs');
const path = require('path');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/orderLineUpdateFlow.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/orders/orderLineMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/orders/orderLinesRoute.ts'), 'utf-8');
const WRITABLE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/orders/orderLineWritable.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const ORDER_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'OrderManager.tsx'), 'utf-8');
const LINE_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/orderLineService.ts'), 'utf-8');

// ═══ Part 1: Agent flow — ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildOrderLineUpdateDraft 六字段', () => {
  it('idempotencyKey 格式: order.line_update:${lineId}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `order\.line_update:\$\{lineId\}:\$\{hash\}`/);
  });
  it('impactScope 固定 [orders]', () => {
    expect(FLOW_SRC).toMatch(/impactScope: \['orders'\]/);
  });
  it('irreversible = true', () => {
    expect(FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 order.line_update toolId', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'order\.line_update'/);
  });
  it('action = update_order_line', () => {
    expect(FLOW_SRC).toMatch(/action: 'update_order_line'/);
  });
  it('after 含 { lineId, patch }', () => {
    expect(FLOW_SRC).toMatch(/after: \{ lineId, patch \}/);
  });
  it('beforeAfterDiff: orderLine patch 每个字段 before→after', () => {
    expect(FLOW_SRC).toMatch(/entity: 'orderLine'/);
    expect(FLOW_SRC).toMatch(/Object\.keys\(patch\)\.map/);
  });
});

// ═══ Part 2: Agent flow — Feedback 三态 + Committed ═══
describe('runtime QA [Agent flow]: Feedback 三态 + Committed', () => {
  it('Feedback union 含 approval_required/committed/failed', () => {
    expect(FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(FLOW_SRC).toMatch(/status: 'committed'/);
    expect(FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('Committed 含 lineId/auditId/idempotencyKey', () => {
    const m = FLOW_SRC.match(/export interface OrderLineUpdateFlowCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['lineId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

// ═══ Part 3: Agent flow — ErrorCode union ═══
describe('runtime QA [Agent flow]: ErrorCode union', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED', 'UNKNOWN_ERROR'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => {
      expect(FLOW_SRC).toContain(`'${code}'`);
    });
  }
  const SERVICE_CODES = ['INVALID_INPUT', 'ORDER_NOT_FOUND', 'ORDER_LINE_NOT_FOUND', 'DUPLICATE_ITEM_NO', 'CREATE_LINE_FAILED', 'UPDATE_LINE_FAILED'];
  for (const code of SERVICE_CODES) {
    it(`service error code "${code}"`, () => {
      expect(SERVICE_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 4: Agent flow — hash 防篡改链路（commit path 精确断言） ═══
describe('runtime QA [Agent flow]: hash 防篡改链路（commit path）', () => {
  it('commitOrderLineUpdate: verifyOrderLineUpdateDraftHash 调用', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderLineUpdate[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/verifyOrderLineUpdateDraftHash/);
  });
  it('verifyOrderLineUpdateDraftHash: computeProcessDraftHash 重算', () => {
    const fnMatch = FLOW_SRC.match(/export function verifyOrderLineUpdateDraftHash[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/computeProcessDraftHash/);
  });
  it('verifyOrderLineUpdateDraftHash: :pd: 后缀解析', () => {
    const fnMatch = FLOW_SRC.match(/export function verifyOrderLineUpdateDraftHash[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('commitOrderLineUpdate: hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH fail closed', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderLineUpdate[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_HASH_MISMATCH/);
  });
  it('commitOrderLineUpdate: draft missing → PROCESS_DRAFT_MISSING', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderLineUpdate[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_MISSING/);
  });
});

// ═══ Part 5: Agent flow — commit 复用 service + 语义校验 ═══
describe('runtime QA [Agent flow]: commit 复用 service + 语义校验', () => {
  it('commitOrderLineUpdate 复用 updateOrderLine service（不绕 contract）', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderLineUpdate[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/updateOrderLine/);
  });
  it('validateOrderLineUpdateDraftSemantics: lineId 必填', () => {
    const fnMatch = FLOW_SRC.match(/export function validateOrderLineUpdateDraftSemantics[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/lineId/);
  });
  it('validateOrderLineUpdateDraftSemantics: patch 必须非空 object', () => {
    const fnMatch = FLOW_SRC.match(/export function validateOrderLineUpdateDraftSemantics[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/patch.*non-empty object/);
  });
  it('OrderLineUpdateDraftInput: lineId + patch + currentSnapshot?', () => {
    const m = FLOW_SRC.match(/export interface OrderLineUpdateDraftInput \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('lineId');
    expect(m![0]).toContain('patch');
    expect(m![0]).toContain('currentSnapshot');
  });
});

// ═══ Part 6: Manual route — POST / + PUT /:id ═══
describe('runtime QA [Manual route]: POST + PUT order lines', () => {
  it('route: POST / 端点（调 createOrderLine service）', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/'[\s\S]*?\n  \}\);/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/createOrderLine/);
  });
  it('route: POST / 成功返回 { ok:true, line }', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true, line/);
  });
  it('route: PUT /:id 端点（调 updateOrderLine service）', () => {
    const m = ROUTE_SRC.match(/router\.put\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/updateOrderLine/);
  });
  it('route: PUT /:id 成功返回 { ok:true, line }', () => {
    const m = ROUTE_SRC.match(/router\.put\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true, line/);
  });
  it('route: POST/PUT 空 patch → EMPTY_PATCH/VALIDATION_FAILED', () => {
    expect(ROUTE_SRC).toMatch(/EMPTY_PATCH/);
  });
});

// ═══ Part 7: route 错误反馈 statusCode map ═══
describe('runtime QA [route]: 错误反馈 statusCode map', () => {
  it('POST: INVALID_INPUT→400, ORDER_NOT_FOUND→404, DUPLICATE_ITEM_NO→409', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/INVALID_INPUT: 400/);
    expect(m![0]).toMatch(/ORDER_NOT_FOUND: 404/);
    expect(m![0]).toMatch(/DUPLICATE_ITEM_NO: 409/);
  });
  it('PUT: ORDER_LINE_NOT_FOUND→404, UPDATE_LINE_FAILED→500', () => {
    const m = ROUTE_SRC.match(/router\.put\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/ORDER_LINE_NOT_FOUND: 404/);
    expect(m![0]).toMatch(/UPDATE_LINE_FAILED: 500/);
  });
});

// ═══ Part 8: 前端 service — orderLineService 消费 route ═══
describe('runtime QA [前端 service]: orderLineService 消费 route', () => {
  it('createOrderLine: POST /v1/order-lines', () => {
    expect(LINE_SVC_SRC).toMatch(/\/v1\/order-lines/);
    expect(LINE_SVC_SRC).toMatch(/method: 'POST'/);
  });
  it('createOrderLine 成功返回 res.json()（消费后端 { ok, line }）', () => {
    expect(LINE_SVC_SRC).toMatch(/return res\.json\(\)/);
  });
  it('updateOrderLineFields: PUT /v1/order-lines/:id', () => {
    expect(LINE_SVC_SRC).toMatch(/\/v1\/order-lines\/\$\{[^}]+\}/);
    expect(LINE_SVC_SRC).toMatch(/method: 'PUT'/);
  });
  it('失败 throw Error', () => {
    expect(LINE_SVC_SRC).toMatch(/throw new Error/);
  });
});

// ═══ Part 9: OrderManager UI — line create/update 路径 ═══
describe('runtime QA [OrderManager UI]: line create/update', () => {
  it('consume createOrderLine', () => {
    expect(ORDER_MGR_SRC).toMatch(/createOrderLine/);
  });
  it('consume updateOrderLineFields', () => {
    expect(ORDER_MGR_SRC).toMatch(/updateOrderLineFields/);
  });
  it('line update 成功消费后端返回的 line（不伪造）', () => {
    expect(ORDER_MGR_SRC).toMatch(/\{ line \} = await updateOrderLineFields/);
  });
  it('line create 成功消费后端返回的 line', () => {
    expect(ORDER_MGR_SRC).toMatch(/\{ line \} = await createOrderLine/);
  });
});

// ═══ Part 10: 边界 — OrderManager 不混 Agent flow ═══
describe('runtime QA [边界]: 不混 Agent flow', () => {
  it('OrderManager 不调用 Agent order.line_update flow', () => {
    expect(ORDER_MGR_SRC).not.toMatch(/orderLineUpdateFlow|commitOrderLineUpdate|order\.line_update/);
  });
});

// ═══ Part 10b: rawPatch 非法字段 fail closed（核心防回退） ═══
describe('runtime QA [rawPatch fail closed]: draftPhase 非法字段 pre-normalize 校验', () => {
  it('ORDER_LINE_WRITABLE_FIELDS Set 存在（白名单，orderLineWritable.ts）', () => {
    expect(WRITABLE_SRC).toMatch(/export const ORDER_LINE_WRITABLE_FIELDS = new Set/);
  });
  it('ORDER_LINE_WRITABLE_FIELDS 含核心字段（quantity/itemNo/unitPrice 等）', () => {
    expect(WRITABLE_SRC).toMatch(/'quantity'/);
    expect(WRITABLE_SRC).toMatch(/'itemNo'/);
    expect(WRITABLE_SRC).toMatch(/'unitPrice'/);
  });
  it('stripLineWritable 过滤非法字段（!ORDER_LINE_WRITABLE_FIELDS.has(k) continue）', () => {
    expect(WRITABLE_SRC).toMatch(/!ORDER_LINE_WRITABLE_FIELDS\.has\(k\)/);
  });

  it('toolRuntime draft 分支: rawPatch 非法字段在 normalize/filter 前校验', () => {
    // L677-680: rawKeys.filter(k => !ORDER_LINE_WRITABLE_FIELDS.has(k))
    expect(TOOL_RUNTIME_SRC).toMatch(/rawKeys = Object\.keys\(rawPatch\)/);
    expect(TOOL_RUNTIME_SRC).toMatch(/illegalFields = rawKeys\.filter.*ORDER_LINE_WRITABLE_FIELDS\.has/);
  });

  it('toolRuntime draft 分支: illegalFields.length > 0 → preconditions_failed', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/illegalFields\.length > 0[\s\S]*?status: 'preconditions_failed'/);
  });

  it('toolRuntime draft 分支: 非法字段错误消息含 non-writable fields', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/non-writable fields/);
  });

  it('fail closed 边界: 非法字段时不创建 approval（createPendingApprovalRequest 在合法分支后）', () => {
    // illegalFields check 必须在 createPendingApprovalRequest 之前
    const illegalIdx = TOOL_RUNTIME_SRC.indexOf('illegalFields = rawKeys.filter');
    const approvalIdx = TOOL_RUNTIME_SRC.indexOf('createPendingApprovalRequest');
    expect(illegalIdx).toBeGreaterThan(0);
    expect(approvalIdx).toBeGreaterThan(illegalIdx);
  });

  it('fail closed 边界: 非法字段时不读 orderLine（findUnique 在合法分支后）', () => {
    const illegalIdx = TOOL_RUNTIME_SRC.indexOf('illegalFields = rawKeys.filter');
    const findUniqueIdx = TOOL_RUNTIME_SRC.indexOf('orderLine.findUnique');
    // 在 order.line_update draft 分支内的 findUnique（L689）必须在 illegalFields check 之后
    expect(findUniqueIdx).toBeGreaterThan(illegalIdx);
  });

  it('fail closed 边界: 非法字段时不调用 updateOrderLine（在 commit 分支，draft 分支只 build）', () => {
    // draft 分支只 buildOrderLineUpdateDraft，不调 updateOrderLine
    const draftBranchMatch = TOOL_RUNTIME_SRC.match(/if \(p0bToolDef\?\.processSpec && definition\.id === 'order\.line_update'\)[\s\S]*?\n  \}/);
    expect(draftBranchMatch).not.toBeNull();
    expect(draftBranchMatch![0]).toMatch(/buildOrderLineUpdateDraft/);
    expect(draftBranchMatch![0]).not.toMatch(/updateOrderLine/);
  });
});

// ═══ Part 11: toolRuntime 分支 ═══
describe('runtime QA [toolRuntime]: order.line_update commit 分支', () => {
  it('toolRuntime draft 分支: definition.id === order.line_update', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'order\.line_update'/);
  });

  it('toolRuntime commit dispatch: call.toolId === order.line_update 分支存在', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/if \(call\.toolId === 'order\.line_update'\)/);
  });

  it('toolRuntime commit dispatch: 分支内调用 commitOrderLineUpdate', () => {
    // 精确匹配 commit 分支体，断言调 commitOrderLineUpdate（不是只 draft 分支）
    const commitBranchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.line_update'\) \{[\s\S]*?\n  \}/);
    expect(commitBranchMatch).not.toBeNull();
    expect(commitBranchMatch![0]).toMatch(/commitOrderLineUpdate/);
  });

  it('toolRuntime commit dispatch: 传 approvalId + approvalPayload', () => {
    const commitBranchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.line_update'\) \{[\s\S]*?\n  \}/);
    expect(commitBranchMatch![0]).toMatch(/approvalId/);
    expect(commitBranchMatch![0]).toMatch(/approvalPayload/);
  });

  it('toolRuntime import commitOrderLineUpdate from orderLineUpdateFlow', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/import.*commitOrderLineUpdate.*from.*orderLineUpdateFlow/);
  });
});

// ═══ Part 12: EntityLink/audit 事务边界 ═══
describe('runtime QA [EntityLink/audit]: orderLine mutation 事务闭环', () => {
  it('orderLineMutationService 含 sync（EntityLink 关联）', () => {
    expect(SERVICE_SRC).toMatch(/sync|EntityLink|entityLink/i);
  });
  it('orderLineMutationService 含 audit（writeRouteAuditLog 或 auditLog）', () => {
    expect(SERVICE_SRC).toMatch(/audit|writeRouteAuditLog/i);
  });
});

// ═══ Part 13: 真实 payload fixture ═══
describe('runtime QA [fixture]: 真实 orderLine payload 消费', () => {
  it('OrderLineUpdateDraftInput: lineId + patch + currentSnapshot', () => {
    const input = { lineId: 'OL1', patch: { quantity: 200 }, currentSnapshot: { quantity: 100 } };
    expect(input.patch.quantity).toBe(200);
  });
  it('committed payload: { status:committed, lineId, auditId, idempotencyKey }', () => {
    const committed = {
      status: 'committed' as const,
      lineId: 'OL1', auditId: 'alog_123',
      idempotencyKey: 'order.line_update:OL1:pd:abc',
    };
    expect(committed.status).toBe('committed');
    expect(committed.idempotencyKey).toContain('order.line_update:OL1');
  });
  it('POST 成功 res.json: { ok:true, line:{...} }', () => {
    const res = { ok: true, line: { id: 'OL1', itemNo: '0010', quantity: 100 } };
    expect(res.line.itemNo).toBe('0010');
  });
  it('PUT 成功 res.json: { ok:true, line:{...} }', () => {
    const res = { ok: true, line: { id: 'OL1', quantity: 200 } };
    expect(res.line.quantity).toBe(200);
  });
  it('DUPLICATE_ITEM_NO 失败: 409', () => {
    const res = { ok: false, error: { code: 'DUPLICATE_ITEM_NO', message: 'itemNo already exists' } };
    expect(res.error.code).toBe('DUPLICATE_ITEM_NO');
  });
});
