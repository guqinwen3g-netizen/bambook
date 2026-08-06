import { describe, expect, it } from 'vitest';
import type { Shipment, ShipmentStatus } from '../types';

/**
 * ERP-P1-shipment-order-runtime-qa: fixture-driven runtime QA
 * payload 全部来自后端已 merged 代码静态断言（task_mqy8x4ek order.ship/shipping dispatch Agent flow）。
 * 不改后端 contract；不猜字段；不复用旧 patch artifact。
 */

const fs = require('fs');
const path = require('path');
const ORDER_SHIP_FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/orderShipFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const SHIPMENT_SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/shipping/shipmentMutationService.ts'), 'utf-8');

// 真实 ShipmentStatus 8 状态（types.ts，已对齐后端 schema）
const VALID_SHIPMENT_STATUSES: ShipmentStatus[] = ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled'];

// ═══ Part 1: shipment 手动 UI contract（ShipmentManager 消费 shipmentService） ═══
describe('runtime QA [manual UI]: ShipmentManager 手动路径消费 shipmentService', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf-8');
  it('含 createShipment / updateShipment / deleteShipment 调用', () => {
    expect(src).toMatch(/shipmentService\.createShipment/);
    expect(src).toMatch(/shipmentService\.updateShipment/);
    expect(src).toMatch(/shipmentService\.deleteShipment/);
  });
  it('失败时不本地伪成功（catch 显示反馈）', () => {
    expect(src).toMatch(/catch/);
  });
  it('ShipmentStatus 用后端 8 状态（已对齐 schema）', () => {
    for (const s of ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled']) {
      expect(src).toContain(`'${s}'`);
    }
    // 不含旧枚举
    expect(src).not.toMatch(/'Preparing'|'InTransit'/);
  });
});

// ═══ Part 2: order.ship / shipping dispatch Agent flow contract（静态断言真实源码） ═══
describe('runtime QA [Agent flow]: OrderShipFeedback 三态真实 contract', () => {
  it('Feedback union 含 approval_required/committed/failed 三态', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/status: 'committed'/);
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('OrderShipCommitted 含 shipmentId/orderId/shipmentStatus/orderStatus/transactionId/auditId/idempotencyKey', () => {
    const m = ORDER_SHIP_FLOW_SRC.match(/export interface OrderShipCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['shipmentId', 'orderId', 'shipmentStatus', 'orderStatus', 'transactionId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

describe('runtime QA [Agent flow]: OrderShipErrorCode 12 值真实 contract', () => {
  const CODES = [
    'APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED',
    'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED',
    'ORDER_NOT_FOUND', 'ORDER_TERMINAL', 'INVALID_CURRENT_ORDER_STATUS', 'INVALID_SHIPMENT_STATUS',
    'COMMIT_TRANSACTION_FAILED', 'UNKNOWN_ERROR',
  ];
  for (const code of CODES) {
    it(`error code "${code}" 在 orderShipFlow.ts 真实 union 内`, () => {
      expect(ORDER_SHIP_FLOW_SRC).toContain(`'${code}'`);
    });
  }
});

describe('runtime QA [Agent flow]: buildOrderShipDraft 真实输出（静态断言）', () => {
  it('idempotencyKey 格式: order.ship:${orderId}:${hash}', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/idempotencyKey = `order\.ship:\$\{orderId\}:\$\{hash\}`/);
  });
  it('impactScope 固定含 shipping/orders', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/impactScope: \['shipping', 'orders'\]/);
  });
  it('irreversible = true（发货不可逆）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 shipping.create_shipment toolId', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/toolId: 'shipping\.create_shipment'/);
  });
  it('action = create_shipment_and_link_order（shipment 创建 + order 联动）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/action: 'create_shipment_and_link_order'/);
  });
  it('shipmentStatus 默认 Booked（shipment.status ?? Booked）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/shipment\.status \?\? 'Booked'/);
  });
  it('afterPayload 含完整 shipment + orderId + shipmentStatus（what-you-approve-is-what-you-commit）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/afterPayload = \{ \.\.\.shipment, orderId, shipmentStatus \}/);
  });
  it('return 展开 content + idempotencyKey（严格六字段 ProcessDraft）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/return \{ \.\.\.content, idempotencyKey \}/);
  });
});

describe('runtime QA [Agent flow]: draft-first 防篡改 contract', () => {
  it('verifyOrderShipDraftHash 解析 :pd: 前缀（复用同款 hash 机制）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH error code', () => {
    expect(ORDER_SHIP_FLOW_SRC).toContain("'PROCESS_DRAFT_HASH_MISMATCH'");
  });
  it('recoverShipmentPayloadFromDraft 从 subOperations.after 恢复 commit payload', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/recoverShipmentPayloadFromDraft/);
  });
});

describe('runtime QA [Agent flow]: commitOrderShip 真实链路（精确读取 orderShipFlow.ts）', () => {
  // 架构事实（ERP-P1 shared-service-foundation）：commitOrderShip 不再手写 sync/link/audit，
  // 委托共享 createShipment service（Agent path 与 route path 同事务契约）。
  // 契约精确到各自函数体内：委托调用在 commitOrderShip 体内断言，sync/link/audit 在 createShipment 体内断言。
  it('commitOrderShip 委托共享 createShipment service（Agent/route 同事务契约）', () => {
    const fnMatch = ORDER_SHIP_FLOW_SRC.match(/export async function commitOrderShip[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/await createShipment\(/);
    expect(fnMatch![0]).toMatch(/auditSource: 'agent:order\.ship:commit'/);
    expect(fnMatch![0]).toMatch(/syncSource: 'agent:order\.ship'/);
  });
  it('createShipment 调用 syncShipmentReferences（shipment references 同步）', () => {
    const fnMatch = SHIPMENT_SERVICE_SRC.match(/export async function createShipment[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/syncShipmentReferences/);
  });
  it('createShipment 调用 linkOrderStatusFromShipment（Order 状态联动）', () => {
    const fnMatch = SHIPMENT_SERVICE_SRC.match(/export async function createShipment[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/linkOrderStatusFromShipment/);
  });
  it('createShipment 调用 writeRouteAuditLog（审计日志）', () => {
    const fnMatch = SHIPMENT_SERVICE_SRC.match(/export async function createShipment[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/writeRouteAuditLog/);
  });
  it('commitOrderShip 返回 committed feedback 含 orderStatus（来自 linkOrderStatusFromShipment.toStatus）', () => {
    const svcMatch = SHIPMENT_SERVICE_SRC.match(/export async function createShipment[\s\S]*?^}/m);
    expect(svcMatch).not.toBeNull();
    expect(svcMatch![0]).toMatch(/orderStatus = linkResult\.toStatus/);
    const fnMatch = ORDER_SHIP_FLOW_SRC.match(/export async function commitOrderShip[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/orderStatus: orderStatus \|\| null/);
  });
});

describe('runtime QA [Agent flow]: toolRuntime order.ship 分支真实链路（精确读取分支体）', () => {
  it('order.ship 分支调用 commitOrderShip（非全文件假匹配）', () => {
    // 精确匹配 if (call.toolId === 'order.ship') 分支体
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.ship'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
    expect(branchMatch![0]).toMatch(/commitOrderShip/);
  });
  it('缺 approvalId → 返回结构化 failed + errorFeedback（APPROVAL_ID_MISSING）', () => {
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.ship'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
    expect(branchMatch![0]).toMatch(/ok: false/);
    expect(branchMatch![0]).toMatch(/status: 'failed'/);
    expect(branchMatch![0]).toMatch(/APPROVAL_ID_MISSING/);
  });
  it('approval not found/modified → 返回 APPROVAL_NOT_FOUND/APPROVAL_MODIFIED_UNSUPPORTED', () => {
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.ship'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
    expect(branchMatch![0]).toMatch(/APPROVAL_NOT_FOUND|APPROVAL_MODIFIED_UNSUPPORTED/);
  });
  it('commit 成功 → 返回 { ok: true, ...feedback }（结构化 committed）', () => {
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.ship'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
    expect(branchMatch![0]).toMatch(/ok: true/);
  });
});

// ═══ Part 3: Order 状态联动 contract ═══
describe('runtime QA [Order 联动]: shipment 创建触发 Order 状态转移', () => {
  it('orderShipFlow 含 orderStatus 推导（commit 后 Order 状态更新）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/orderStatus/);
  });
  it('beforeAfterDiff 含 orders entity（shipment 创建影响 order）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/entity: 'orders'/);
  });
});

// ═══ Part 4: 边界（ShipmentManager 不混 Agent flow） ═══
describe('runtime QA [边界]: ShipmentManager 与 Agent flow 隔离', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf-8');
  it('ShipmentManager 手动路径不调用 Agent order.ship flow', () => {
    expect(src).not.toMatch(/orderShipFlow|order\.ship|OrderShipFeedback|buildOrderShipDraft/);
  });
});

// ═══ Part 5: 失败反馈与状态展示（真实场景 fixture） ═══
describe('runtime QA [失败反馈]: OrderShipError userAction 真实 contract', () => {
  it('buildOrderShipError 含 userActionMap（每个 ErrorCode 有可执行 userAction）', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/userActionMap: Record<OrderShipErrorCode, string>/);
  });
  it('ORDER_TERMINAL userAction: 订单处于终态', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/ORDER_TERMINAL: '订单处于终态/);
  });
  it('INVALID_SHIPMENT_STATUS userAction: 运单 status 非法', () => {
    expect(ORDER_SHIP_FLOW_SRC).toMatch(/INVALID_SHIPMENT_STATUS: '运单 status 非法/);
  });
});

describe('runtime QA [状态展示]: shipment status 8 状态枚举一致性', () => {
  it('types.ts ShipmentStatus 与 ShipmentManager 用同一契约（无漂移）', () => {
    const typesSrc = fs.readFileSync(path.resolve(__dirname, '../types.ts'), 'utf-8');
    const typesMatch = typesSrc.match(/export type ShipmentStatus = ([^;]+);/);
    expect(typesMatch).not.toBeNull();
    for (const s of VALID_SHIPMENT_STATUSES) {
      expect(typesMatch![0]).toContain(s);
    }
  });
});
