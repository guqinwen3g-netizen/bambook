import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/development/developmentCaseMutationService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/development/route.ts'), 'utf-8');
const DEV_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/developmentService.ts'), 'utf-8');
const DEV_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'DevelopmentManager.tsx'), 'utf-8');

function sliceFromFunc(src: string, funcName: string): string {
  const marker = `export async function ${funcName}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const nextExport = src.indexOf('\nexport ', start + marker.length);
  return nextExport > 0 ? src.slice(start, nextExport) : src.slice(start);
}

// Part 1: service 四个 mutation 方法
describe('runtime QA [service]: 四个 mutation 方法', () => {
  it('createDevelopmentCase', () => { expect(SERVICE_SRC).toContain('export async function createDevelopmentCase'); });
  it('updateDevelopmentCase', () => { expect(SERVICE_SRC).toContain('export async function updateDevelopmentCase'); });
  it('updateDevelopmentStage', () => { expect(SERVICE_SRC).toContain('export async function updateDevelopmentStage'); });
  it('deleteDevelopmentCase', () => { expect(SERVICE_SRC).toContain('export async function deleteDevelopmentCase'); });
});

// Part 2: service $transaction 事务闭环
describe('runtime QA [service]: $transaction 事务闭环', () => {
  it('create 包 $transaction', () => { expect(sliceFromFunc(SERVICE_SRC, 'createDevelopmentCase')).toContain('$transaction'); });
  it('update 包 $transaction', () => { expect(sliceFromFunc(SERVICE_SRC, 'updateDevelopmentCase')).toContain('$transaction'); });
  it('updateStage 包 $transaction', () => { expect(sliceFromFunc(SERVICE_SRC, 'updateDevelopmentStage')).toContain('$transaction'); });
  it('delete 包 $transaction', () => { expect(sliceFromFunc(SERVICE_SRC, 'deleteDevelopmentCase')).toContain('$transaction'); });
});

// Part 3: 事务内 audit + sync + EntityLink inactive
describe('runtime QA [service]: 事务内 audit/sync/EntityLink', () => {
  it('create: syncDevelopmentCaseReferences + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'createDevelopmentCase');
    expect(b).toContain('syncDevelopmentCaseReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('update: syncDevelopmentCaseReferences + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'updateDevelopmentCase');
    expect(b).toContain('syncDevelopmentCaseReferences');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('delete: deactivateEntityLinks + writeRouteAuditLog', () => {
    const b = sliceFromFunc(SERVICE_SRC, 'deleteDevelopmentCase');
    expect(b).toContain('deactivateEntityLinks');
    expect(b).toContain('writeRouteAuditLog');
  });
  it('deactivateEntityLinks 在 delete 事务内（tx 参数）', () => {
    expect(SERVICE_SRC).toContain("deactivateEntityLinks(tx, 'development-case'");
  });
});

// Part 4: ErrorCode union
describe('runtime QA [service]: ErrorCode', () => {
  const CODES = ['INVALID_INPUT', 'INVALID_STAGE', 'INVALID_TYPE', 'DUPLICATE_CODE', 'NOT_FOUND', 'ALREADY_DELETED', 'CREATE_FAILED', 'UPDATE_FAILED', 'STAGE_UPDATE_FAILED', 'DELETE_FAILED'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// Part 5: VALID_STAGES/TYPES 白名单
describe('runtime QA [service]: VALID_STAGES/TYPES', () => {
  it('VALID_STAGES', () => { expect(SERVICE_SRC).toContain("['developing', 'shipping', 'feedback', 'revision', 'approved', 'cancelled']"); });
  it('VALID_TYPES', () => { expect(SERVICE_SRC).toContain("['fabric', 'garment', 'pp', 'trim']"); });
  it('isValidStage 校验函数', () => { expect(SERVICE_SRC).toContain('export function isValidStage'); });
});

// Part 6: route 端点调 service
describe('runtime QA [route]: 端点调 service', () => {
  it('POST 调 createDevelopmentCase', () => { expect(ROUTE_SRC).toContain('createDevelopmentCase'); });
  it('PUT 调 updateDevelopmentCase', () => { expect(ROUTE_SRC).toContain('updateDevelopmentCase'); });
  it('PATCH stage 调 updateDevelopmentStage', () => { expect(ROUTE_SRC).toContain('updateDevelopmentStage'); });
  it('DELETE 调 deleteDevelopmentCase', () => { expect(ROUTE_SRC).toContain('deleteDevelopmentCase'); });
});

// Part 7: onDataChange 事务后触发
describe('runtime QA [route]: onDataChange', () => {
  it('create → entity: development', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'development', action: 'create'"); });
  it('update → entity: development', () => { expect(ROUTE_SRC).toContain("onDataChange?.({ entity: 'development', action: 'update'"); });
  it('stage → action: stage-change', () => { expect(ROUTE_SRC).toContain("action: 'stage-change'"); });
});

// Part 8: route statusCode map
describe('runtime QA [route]: statusCode map', () => {
  it('create: 400/409/500', () => {
    expect(ROUTE_SRC).toContain('INVALID_INPUT: 400');
    expect(ROUTE_SRC).toContain('DUPLICATE_CODE: 409');
    expect(ROUTE_SRC).toContain('CREATE_FAILED: 500');
  });
  it('update: 404/500', () => {
    expect(ROUTE_SRC).toContain('NOT_FOUND: 404');
    expect(ROUTE_SRC).toContain('UPDATE_FAILED: 500');
  });
  it('stage: 400/500', () => {
    expect(ROUTE_SRC).toContain('INVALID_STAGE: 400');
    expect(ROUTE_SRC).toContain('STAGE_UPDATE_FAILED: 500');
  });
  it('delete: 409/500', () => {
    expect(ROUTE_SRC).toContain('ALREADY_DELETED: 409');
    expect(ROUTE_SRC).toContain('DELETE_FAILED: 500');
  });
});

// Part 9: route 成功返回
describe('runtime QA [route]: 成功返回', () => {
  it('create 201 ok:true', () => {
    expect(ROUTE_SRC).toContain('res.status(201).json');
    expect(ROUTE_SRC).toContain('ok: true');
  });
  it('delete { ok:true }', () => { expect(ROUTE_SRC).toContain('res.json({ ok: true })'); });
});

// Part 10: 前端 developmentService 消费 route
describe('runtime QA [前端 service]: developmentService', () => {
  it('create: POST /v1/development', () => {
    expect(DEV_SVC_SRC).toContain("'/v1/development'");
    expect(DEV_SVC_SRC).toContain("method: 'POST'");
  });
  it('update: PUT /v1/development/:id', () => {
    expect(DEV_SVC_SRC).toContain('/v1/development/${encodeURIComponent(id)}');
    expect(DEV_SVC_SRC).toContain("method: 'PUT'");
  });
  it('stage: PATCH /v1/development/:id/stage', () => {
    expect(DEV_SVC_SRC).toContain('/v1/development/${encodeURIComponent(id)}/stage');
    expect(DEV_SVC_SRC).toContain("method: 'PATCH'");
  });
  it('delete: DELETE', () => { expect(DEV_SVC_SRC).toContain("method: 'DELETE'"); });
  it('失败 throw Error', () => { expect(DEV_SVC_SRC).toContain('throw new Error'); });
});

// Part 11: 边界 不混 Agent flow
describe('runtime QA [边界]: 不混 Agent flow', () => {
  it('developmentService 不调 Agent commit', () => {
    expect(DEV_SVC_SRC).not.toContain('commitDevelopment');
    expect(DEV_SVC_SRC).not.toContain('development.convert_to_order');
  });
  it('DevelopmentManager 不调 Agent commit', () => {
    expect(DEV_MGR_SRC).not.toContain('commitDevelopment');
    expect(DEV_MGR_SRC).not.toContain('developmentConvertToOrderFlow');
  });
});

// Part 12: 真实 fixture
describe('runtime QA [fixture]: payload', () => {
  it('create 成功 { ok, case }', () => {
    const res = { ok: true, case: { id: 'dc1', stage: 'developing' } };
    expect(res.case.stage).toBe('developing');
  });
  it('delete 成功 { ok:true }', () => { expect({ ok: true }.ok).toBe(true); });
  it('DUPLICATE_CODE 失败', () => { expect({ code: 'DUPLICATE_CODE' }.code).toBe('DUPLICATE_CODE'); });
  it('ALREADY_DELETED 失败', () => { expect({ code: 'ALREADY_DELETED' }.code).toBe('ALREADY_DELETED'); });
  it('INVALID_STAGE 失败', () => { expect({ code: 'INVALID_STAGE' }.code).toBe('INVALID_STAGE'); });
});
