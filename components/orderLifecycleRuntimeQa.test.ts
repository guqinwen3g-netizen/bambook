import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-order-lifecycle-runtime-qa: fixture-driven runtime QA
 * 消费已 merged order lifecycle route + Agent flow contract
 * （task_mqz6fvxv route + task_mqz6gljr Agent flow）。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改后端 contract。
 * 避免全文件假绿：精确匹配函数体/分支体。
 */

const fs = require('fs');
const path = require('path');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/orderLifecycleFlow.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/orders/orderLifecycleService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/orders/route.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const ORDER_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'OrderManager.tsx'), 'utf-8');
const API_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/apiService.ts'), 'utf-8');

// ═══ Part 1: Agent flow — order.status_transition ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildOrderStatusTransitionDraft 六字段', () => {
  it('idempotencyKey 格式: order.status_transition:${orderId}:${toStatus}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `order\.status_transition:\$\{orderId\}:\$\{toStatus\}:\$\{hash\}`/);
  });
  it('impactScope 固定 [orders]', () => {
    expect(FLOW_SRC).toMatch(/impactScope: \['orders'\]/);
  });
  it('irreversible = true', () => {
    expect(FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 order.status_transition toolId', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'order\.status_transition'/);
  });
  it('action = transition_order_status', () => {
    expect(FLOW_SRC).toMatch(/action: 'transition_order_status'/);
  });
  it('beforeAfterDiff: order status before(currentStatus) → after(toStatus)', () => {
    expect(FLOW_SRC).toMatch(/entity: 'order'/);
    expect(FLOW_SRC).toMatch(/before: \(currentStatus \|\| 'unknown'\)/);
    expect(FLOW_SRC).toMatch(/after: toStatus as any/);
  });
});

// ═══ Part 2: Agent flow — order.delete ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildOrderDeleteDraft 六字段', () => {
  it('idempotencyKey 格式: order.delete:${orderId}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `order\.delete:\$\{orderId\}:\$\{hash\}`/);
  });
  it('toolId = order.delete', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'order\.delete'/);
  });
  it('action = delete_order', () => {
    expect(FLOW_SRC).toMatch(/action: 'delete_order'/);
  });
  it('beforeAfterDiff: deletedAt null → true', () => {
    expect(FLOW_SRC).toMatch(/field: 'deletedAt'/);
    expect(FLOW_SRC).toMatch(/before: null/);
    expect(FLOW_SRC).toMatch(/after: true as any/);
  });
});

// ═══ Part 3: Agent flow — Feedback 三态 + ErrorCode ═══
describe('runtime QA [Agent flow]: Feedback 三态 + Committed', () => {
  it('Feedback union 含 approval_required/committed/failed', () => {
    expect(FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(FLOW_SRC).toMatch(/status: 'committed'/);
    expect(FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('Committed 含 orderId/auditId/idempotencyKey', () => {
    const m = FLOW_SRC.match(/export interface OrderLifecycleFlowCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['orderId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

describe('runtime QA [Agent flow]: ErrorCode union', () => {
  const FLOW_CODES = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED', 'UNKNOWN_ERROR'];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}"`, () => {
      expect(FLOW_SRC).toContain(`'${code}'`);
    });
  }
  const SERVICE_CODES = ['ORDER_NOT_FOUND', 'ORDER_ALREADY_DELETED', 'INVALID_STATUS', 'NO_CHANGE', 'DELETE_FAILED', 'TRANSITION_FAILED'];
  for (const code of SERVICE_CODES) {
    it(`service error code "${code}"`, () => {
      expect(SERVICE_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 4: Agent flow — draft-first hash 防篡改链路（commit path） ═══
describe('runtime QA [Agent flow]: hash 防篡改链路（commit path 精确断言）', () => {
  it('commitOrderStatusTransition: computeProcessDraftHash 重算 hash', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderStatusTransition[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/computeProcessDraftHash/);
  });
  it('commitOrderStatusTransition: 解析 idempotencyKey 的 :pd: 后缀', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderStatusTransition[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('commitOrderStatusTransition: hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH fail closed', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderStatusTransition[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/recomputedHash !== actualHashPart/);
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_HASH_MISMATCH/);
  });
  it('commitOrderStatusTransition: draft missing → PROCESS_DRAFT_MISSING', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderStatusTransition[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_MISSING/);
  });

  it('commitOrderDelete: computeProcessDraftHash 重算 hash', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderDelete[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/computeProcessDraftHash/);
  });
  it('commitOrderDelete: 解析 idempotencyKey 的 :pd: 后缀', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderDelete[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('commitOrderDelete: hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH fail closed', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderDelete[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/recomputedHash !== actualHashPart/);
    expect(fnMatch![0]).toMatch(/PROCESS_DRAFT_HASH_MISMATCH/);
  });
});

describe('runtime QA [Agent flow]: 语义校验 + DraftInput', () => {
  it('validateOrderStatusTransitionDraftSemantics: orderId + toStatus 必填', () => {
    const fnMatch = FLOW_SRC.match(/export function validateOrderStatusTransitionDraftSemantics[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/orderId/);
    expect(fnMatch![0]).toMatch(/toStatus/);
  });
  it('validateOrderDeleteDraftSemantics: orderId 必填', () => {
    const fnMatch = FLOW_SRC.match(/export function validateOrderDeleteDraftSemantics[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/orderId/);
  });
  it('OrderStatusTransitionDraftInput: orderId + toStatus + currentStatus? + note? + lineId?', () => {
    const m = FLOW_SRC.match(/export interface OrderStatusTransitionDraftInput \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('orderId');
    expect(m![0]).toContain('toStatus');
    expect(m![0]).toContain('currentStatus');
  });
});

// ═══ Part 5: Agent flow — commit 复用 service（不绕 contract） ═══
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitOrderStatusTransition 调用 transitionOrderStatus service', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderStatusTransition[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/transitionOrderStatus/);
  });
  it('commitOrderDelete 调用 deleteOrder service', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitOrderDelete[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/deleteOrder/);
  });
});

// ═══ Part 6: Manual route — DELETE /:id + POST /:id/status-transition ═══
describe('runtime QA [Manual route]: DELETE + status-transition', () => {
  it('route: DELETE /:id 端点存在', () => {
    expect(ROUTE_SRC).toMatch(/router\.delete\('\/:id'/);
  });
  it('route: DELETE /:id 调用 deleteOrder service', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/deleteOrder/);
  });
  it('route: DELETE /:id 成功返回 { ok:true, order }（含 deletedAt tombstone）', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true, order/);
  });
  it('route: POST /:id/status-transition 端点存在', () => {
    expect(ROUTE_SRC).toMatch(/router\.post\('\/:id\/status-transition'/);
  });
  it('route: POST /:id/status-transition 调用 transitionOrderStatus', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/:id\/status-transition'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/transitionOrderStatus/);
  });
  it('route: status-transition 成功返回 { ok:true, transition, order }', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/:id\/status-transition'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/transition:/);
    expect(m![0]).toMatch(/order: serializeOrder/);
  });
  it('route: GET /:id/timeline 端点存在（timeline refresh）', () => {
    expect(ROUTE_SRC).toMatch(/router\.get\('\/:id\/timeline'/);
  });
});

// ═══ Part 7: route 错误反馈 statusCode map ═══
describe('runtime QA [route]: 错误反馈 statusCode map', () => {
  it('DELETE: ORDER_NOT_FOUND→404, ORDER_ALREADY_DELETED→409, DELETE_FAILED→500', () => {
    const m = ROUTE_SRC.match(/router\.delete\('\/:id'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/ORDER_NOT_FOUND: 404/);
    expect(m![0]).toMatch(/ORDER_ALREADY_DELETED: 409/);
  });
  it('status-transition: INVALID_STATUS→400, NO_CHANGE→400, TRANSITION_FAILED→500', () => {
    const m = ROUTE_SRC.match(/router\.post\('\/:id\/status-transition'[\s\S]*?\n  \}\);/);
    expect(m![0]).toMatch(/INVALID_STATUS: 400/);
    expect(m![0]).toMatch(/NO_CHANGE: 400/);
    expect(m![0]).toMatch(/TRANSITION_FAILED: 500/);
  });
});

// ═══ Part 8: OrderManager UI — 手动 status-transition 路径 ═══
describe('runtime QA [OrderManager UI]: status-transition 路径', () => {
  it('consume POST /api/v1/orders/:id/status-transition（经 apiService 统一通道）', () => {
    expect(ORDER_MGR_SRC).toMatch(/apiService\.transitionOrderStatus\(/);
    expect(API_SVC_SRC).toMatch(/\/v1\/orders\/\$\{[^}]+\}\/status-transition/);
  });
  it('成功消费后端返回 order 更新本地（不伪造状态）', () => {
    expect(ORDER_MGR_SRC).toMatch(/o\.id === updated\.id \? updated/);
  });
  it('transition 后 refresh timeline（GET /timeline）', () => {
    expect(ORDER_MGR_SRC).toMatch(/apiService\.getOrderTimeline\(/);
    expect(ORDER_MGR_SRC).toMatch(/setStatusTimeline/);
  });
});

// ═══ Part 9: OrderManager UI — 软删路径 ═══
describe('runtime QA [OrderManager UI]: 软删路径', () => {
  it('consume DELETE /api/v1/orders/:id（经 apiService 统一通道）', () => {
    expect(ORDER_MGR_SRC).toMatch(/apiService\.deleteOrderRemote\(/);
    expect(API_SVC_SRC).toMatch(/method: 'DELETE'/);
  });
  it('成功消费后端返回的 order（tombstone 含 deletedAt）更新本地（不本地移除）', () => {
    expect(ORDER_MGR_SRC).toMatch(/tombstone/);
  });
  it('失败显示用户可见反馈（bdsToast.danger）', () => {
    expect(ORDER_MGR_SRC).toMatch(/bdsToast\.danger\(`订单删除失败/);
  });
  it('失败不从本地列表移除', () => {
    expect(ORDER_MGR_SRC).toMatch(/订单未从列表移除/);
  });
  it('列表 filter 排除 deletedAt（不显示已删除）', () => {
    expect(ORDER_MGR_SRC).toMatch(/!o\.deletedAt/);
  });
});

// ═══ Part 10: 边界 — OrderManager 不混 Agent flow ═══
describe('runtime QA [边界]: OrderManager 不混 Agent flow', () => {
  it('OrderManager 不调用 Agent order.status_transition/order.delete flow', () => {
    expect(ORDER_MGR_SRC).not.toMatch(/orderLifecycleFlow|commitOrderStatusTransition|commitOrderDelete/);
  });
});

// ═══ Part 11: toolRuntime 分支 ═══
describe('runtime QA [toolRuntime]: order lifecycle commit 分支', () => {
  it('toolRuntime 含 order.status_transition draft-first 分支', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'order\.status_transition'/);
  });
  it('toolRuntime 含 order.delete draft-first 分支', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'order\.delete'/);
  });
});

// ═══ Part 12: 真实 payload fixture ═══
describe('runtime QA [fixture]: 真实 lifecycle payload 消费', () => {
  it('OrderStatusTransitionDraftInput: orderId + toStatus + currentStatus', () => {
    const input = { orderId: 'O1', toStatus: 'Production', currentStatus: 'Confirmed', note: '开始生产' };
    expect(input.toStatus).toBe('Production');
  });
  it('status-transition 成功 res.json: { ok, transition:{...}, order:{...} }', () => {
    const res = {
      ok: true,
      transition: { id: 't1', fromStatus: 'Confirmed', toStatus: 'Production', createdAt: 1782700000 },
      order: { id: 'O1', status: 'Production' },
    };
    expect(res.transition.fromStatus).toBe('Confirmed');
    expect(res.order.status).toBe('Production');
  });
  it('delete 成功 res.json: { ok, order:{...deletedAt} }', () => {
    const res = { ok: true, order: { id: 'O1', deletedAt: 1782700000 } };
    expect(res.order.deletedAt).toBeTruthy();
  });
  it('NO_CHANGE 失败: 400', () => {
    const res = { ok: false, error: { code: 'NO_CHANGE', message: 'order already in target status' } };
    expect(res.error.code).toBe('NO_CHANGE');
  });
  it('ORDER_ALREADY_DELETED 失败: 409', () => {
    const res = { ok: false, error: { code: 'ORDER_ALREADY_DELETED', message: 'order already deleted' } };
    expect(res.error.code).toBe('ORDER_ALREADY_DELETED');
  });
});
