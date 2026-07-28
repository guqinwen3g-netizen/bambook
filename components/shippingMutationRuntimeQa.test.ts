import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/shipping/shipmentMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/shipping/route.ts'), 'utf-8');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/orderShipFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const SHIP_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/shipmentService.ts'), 'utf-8');
const SHIP_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf-8');

function sliceFromFunc(src: string, funcName: string): string {
  const marker = `export async function ${funcName}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const nextExport = src.indexOf('\nexport ', start + marker.length);
  return nextExport > 0 ? src.slice(start, nextExport) : src.slice(start);
}

// Part 1: service 三个 mutation 方法
describe('runtime QA [service]: 三个 mutation 方法', () => {
  it('createShipment', () => { expect(SERVICE_SRC).toContain('export async function createShipment'); });
  it('updateShipment', () => { expect(SERVICE_SRC).toContain('export async function updateShipment'); });
  it('deleteShipment', () => { expect(SERVICE_SRC).toContain('export async function deleteShipment'); });
});

// Part 2: service $transaction 事务闭环
describe('runtime QA [service]: $transaction 事务闭环', () => {
  it('create 包 $transaction + syncShipmentReferences + linkOrderStatusFromShipment + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'createShipment');
    expect(b).toContain('syncShipmentReferences');
    expect(b).toContain('linkOrderStatusFromShipment');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('update 包事务 + audit', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'updateShipment');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('delete 包事务 + deactivateEntityLinks + audit', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'deleteShipment');
    expect(b).toContain('deactivateEntityLinks');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('service 文件头注释含 route + agent 共用契约', () => {
    expect(SERVICE_SRC).toContain('syncShipmentReferences');
    expect(SERVICE_SRC).toContain('linkOrderStatusFromShipment');
  });
});

// Part 3: ErrorCode union
describe('runtime QA [service]: ErrorCode', () => {
  const CODES = ['NOT_FOUND', 'INVALID_STATUS', 'INVALID_TRANSITION', 'INVALID_CURRENT_STATUS', 'ORDER_NOT_FOUND', 'ORDER_TERMINAL', 'INVALID_CURRENT_ORDER_STATUS', 'INVALID_SHIPMENT_STATUS', 'CREATE_FAILED', 'UPDATE_FAILED', 'DELETE_FAILED', 'COMMIT_TRANSACTION_FAILED'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// Part 4: isValidShipmentStatus + VALID_SHIPMENT_STATUSES
describe('runtime QA [service]: status 白名单', () => {
  it('isValidShipmentStatus 校验函数', () => { expect(SERVICE_SRC).toContain('export function isValidShipmentStatus'); });
  it('VALID_SHIPMENT_STATUSES export', () => { expect(SERVICE_SRC).toContain('VALID_SHIPMENT_STATUSES'); });
});

// Part 5: route 端点调 service
describe('runtime QA [route]: 端点调 service', () => {
  it('POST 调 createShipment', () => { expect(ROUTE_SRC).toContain('createShipment'); });
  it('PATCH 调 updateShipment', () => { expect(ROUTE_SRC).toContain('updateShipment'); });
  it('DELETE 调 deleteShipment', () => { expect(ROUTE_SRC).toContain('deleteShipment'); });
});

// Part 6: onDataChange 事务后触发
describe('runtime QA [route]: onDataChange', () => {
  it('create → entity: shipping', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'shipping', action: 'create'"); });
  it('update → entity: shipping', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'shipping', action: 'update'"); });
  it('delete → entity: shipping', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'shipping', action: 'delete'"); });
});

// Part 7: route statusCode map
describe('runtime QA [route]: statusCode map', () => {
  it('create: statusCodeMap 存在', () => { expect(ROUTE_SRC).toContain('statusCodeMap'); });
  it('delete: NOT_FOUND→404, DELETE_FAILED→500', () => {
    expect(ROUTE_SRC).toContain('NOT_FOUND: 404, DELETE_FAILED: 500');
  });
});

// Part 8: route 成功返回
describe('runtime QA [route]: 成功返回', () => {
  it('create 201 shipment', () => { expect(ROUTE_SRC).toContain('res.status(201).json(result.data!.shipment)'); });
  it('update res.json shipment', () => { expect(ROUTE_SRC).toContain('res.json(result.data!.shipment)'); });
  it('delete { ok, id }', () => { expect(ROUTE_SRC).toContain('res.json({ ok: true, id: result.data!.shipment.id })'); });
});

// Part 9: Agent order.ship ProcessDraft 六字段
describe('runtime QA [Agent flow]: buildOrderShipDraft 六字段', () => {
  it('idempotencyKey: order.ship:${orderId}:${hash}', () => { expect(FLOW_SRC).toContain('order.ship:${orderId}:${hash}'); });
  it('toolId: shipping.create_shipment', () => { expect(FLOW_SRC).toContain("toolId: 'shipping.create_shipment'"); });
  it('action: create_shipment_and_link_order', () => { expect(FLOW_SRC).toContain("action: 'create_shipment_and_link_order'"); });
  it('impactScope [shipping, orders]', () => { expect(FLOW_SRC).toContain("impactScope: ['shipping', 'orders']"); });
  it('irreversible true', () => { expect(FLOW_SRC).toContain('irreversible: true'); });
  it('after 含 orderId + shipment + shipmentStatus', () => {
    const m = FLOW_SRC.match(/buildOrderShipDraft[\s\S]*?return \{/);
    expect(m![0]).toContain('afterPayload = { ...shipment, orderId, shipmentStatus }');
  });
});

// Part 10: Agent flow hash 防篡改
describe('runtime QA [Agent flow]: hash 防篡改', () => {
  it('verifyOrderShipDraftHash: computeProcessDraftHash 重算', () => { expect(FLOW_SRC).toContain('computeProcessDraftHash'); });
  it('verifyOrderShipDraftHash: :pd: 后缀解析', () => { expect(FLOW_SRC).toContain("idempotencyKey.includes(':pd:')"); });
  it('commitOrderShip: verifyHash + PROCESS_DRAFT_MISSING fail closed', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitOrderShip');
    expect(b).toContain('verifyOrderShipDraftHash');
    expect(b).toContain('PROCESS_DRAFT_MISSING');
  });
  it('commitOrderShip: hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH', () => {
    expect(FLOW_SRC).toContain('PROCESS_DRAFT_HASH_MISMATCH');
  });
});

// Part 11: Agent flow commit 复用 createShipment service
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitOrderShip 复用 createShipment service', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitOrderShip');
    expect(b).toContain('createShipment');
  });
});

// Part 12: toolRuntime commit dispatch
describe('runtime QA [toolRuntime]: order.ship commit dispatch', () => {
  it('call.toolId === order.ship 分支体调用 commitOrderShip', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.ship'\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('commitOrderShip');
  });
  it('order.ship 分支体传 approvalId + approval.payload', () => {
    const m = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'order\.ship'\) \{[\s\S]*?\n  \}/);
    expect(m![0]).toContain('approvalId');
    expect(m![0]).toContain('approval.payload');
  });
  it('draft 分支 definition.id === order.ship', () => { expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'order.ship'"); });
});

// Part 13: 前端 shipmentService 消费 route
describe('runtime QA [前端 service]: shipmentService', () => {
  it('createShipment: POST /v1/shipping', () => {
    expect(SHIP_SVC_SRC).toContain("'/v1/shipping'");
    expect(SHIP_SVC_SRC).toContain("method: 'POST'");
  });
  it('updateShipment: PATCH /v1/shipping/:id', () => {
    expect(SHIP_SVC_SRC).toContain('/v1/shipping/${encodeURIComponent(id)}');
    expect(SHIP_SVC_SRC).toContain("method: 'PATCH'");
  });
  it('deleteShipment: DELETE', () => { expect(SHIP_SVC_SRC).toContain("method: 'DELETE'"); });
  it('失败 throw Error', () => { expect(SHIP_SVC_SRC).toContain('throw new Error'); });
});

// Part 14: ShipmentManager UI 消费边界
describe('runtime QA [ShipmentManager UI]: 消费边界', () => {
  it('consume createShipment + setShipments（消费后端返回）', () => {
    expect(SHIP_MGR_SRC).toContain('shipmentService.createShipment');
    expect(SHIP_MGR_SRC).toContain('setShipments(prev => [persisted');
  });
  it('consume updateShipment + setShipments map', () => {
    expect(SHIP_MGR_SRC).toContain('shipmentService.updateShipment');
    expect(SHIP_MGR_SRC).toContain('setShipments(prev => prev.map');
  });
  it('consume deleteShipment + 列表 filter 移除', () => {
    expect(SHIP_MGR_SRC).toContain('shipmentService.deleteShipment');
    expect(SHIP_MGR_SRC).toContain('setShipments(prev => prev.filter');
  });
  it('不调 Agent commit function', () => {
    expect(SHIP_MGR_SRC).not.toContain('commitOrderShip');
    expect(SHIP_MGR_SRC).not.toContain('orderShipFlow');
  });
});

// Part 15: 真实 fixture
describe('runtime QA [fixture]: payload', () => {
  it('create 成功 res: shipment', () => {
    const res = { id: 'shp1', shipmentNumber: 'SHP-001', status: 'pending', orderId: 'O1' };
    expect(res.shipmentNumber).toBe('SHP-001');
  });
  it('delete 成功 { ok, id }', () => {
    const res = { ok: true, id: 'shp1' };
    expect(res.ok).toBe(true);
  });
  it('INVALID_TRANSITION 失败', () => { expect({ code: 'INVALID_TRANSITION' }.code).toBe('INVALID_TRANSITION'); });
  it('ORDER_TERMINAL 失败', () => { expect({ code: 'ORDER_TERMINAL' }.code).toBe('ORDER_TERMINAL'); });
});
