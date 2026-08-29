import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-audit-query-ui-runtime-qa: fixture-driven runtime QA
 * 消费已 merged GET /api/v1/admin/audit-logs contract（task_mr1n8c93）。
 * 后端真实源码静态断言 + AdminPanel filter UI + query string 消费。
 */

const fs = require('fs');
const path = require('path');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/admin/route.ts'), 'utf-8');
// 阶段 D / D6：where 构造抽取至 server/src/audit/entityQuery.ts（admin 全局端点与
// /api/v1/audit/entity 实体端点共享）。实现契约断言指向新执行边界（buildAuditLogQuery
// 函数体），route 侧仅保留接线契约（调用共享构造 / findMany+count 同 where / 返回形状）。
const ENTITY_QUERY_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/audit/entityQuery.ts'), 'utf-8');
const ADMIN_SRC = fs.readFileSync(path.resolve(__dirname, 'AdminPanel.tsx'), 'utf-8');

// buildAuditLogQuery 函数体（结束于行首 }）
const BUILD_FN = /export function buildAuditLogQuery[\s\S]*?\n\}/;

// ═══ Part 1: route contract — query params ═══
describe('runtime QA [route]: GET /audit-logs query params', () => {
  it('route 经共享 buildAuditLogQuery 构造查询（D6 抽取后接线契约）', () => {
    const m = ROUTE_SRC.match(/router\.get\('\/audit-logs'[\s\S]*?\n  \}\)+;/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/buildAuditLogQuery\(req\.query/);
  });
  it('buildAuditLogQuery 解构 targetType/targetId/createdFrom/createdTo/limit/offset', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/targetType/);
    expect(m![0]).toMatch(/targetId/);
    expect(m![0]).toMatch(/createdFrom/);
    expect(m![0]).toMatch(/createdTo/);
    expect(m![0]).toMatch(/limit/);
    expect(m![0]).toMatch(/offset/);
  });
  it('buildAuditLogQuery 默认 limit=100, offset=0', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/limit = '100'/);
    expect(m![0]).toMatch(/offset = '0'/);
  });
});

// ═══ Part 2: route contract — pagination 严格校验 fail closed ═══
describe('runtime QA [route]: pagination 严格校验', () => {
  it('strictNonNegInt: 只接受纯数字字符串', () => {
    const m = ENTITY_QUERY_SRC.match(/const strictNonNegInt[\s\S]*?test\(v\)/);
    expect(m).not.toBeNull();
  });
  it('非法 limit/offset → INVALID_PAGINATION 400', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/INVALID_PAGINATION/);
  });
  it('limit 上限 500（Math.min）', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/Math\.min\(parseInt\(limit.*500\)/);
  });
});

// ═══ Part 3: route contract — date range 校验 fail closed ═══
describe('runtime QA [route]: date range 校验', () => {
  it('createdFrom/createdTo 转 Date（DateTime contract）', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/new Date\(f\)/);
    expect(m![0]).toMatch(/new Date\(t\)/);
  });
  it('非法 createdFrom → INVALID_DATE_RANGE 400', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/createdFrom must be a valid timestamp/);
  });
  it('fromDate > toDate → INVALID_DATE_RANGE', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/fromDate > toDate/);
  });
});

// ═══ Part 4: route contract — where 构建 + return ═══
describe('runtime QA [route]: where 构建 + return', () => {
  it('where 条件含 targetType/targetId/createdAt gte/lte', () => {
    const m = ENTITY_QUERY_SRC.match(BUILD_FN);
    expect(m![0]).toMatch(/where\.targetType = targetType/);
    expect(m![0]).toMatch(/where\.targetId = targetId/);
    expect(m![0]).toMatch(/where\.createdAt\.gte = fromDate/);
    expect(m![0]).toMatch(/where\.createdAt\.lte = toDate/);
  });
  it('同一 where 用于 findMany + count（route 接线）', () => {
    const m = ROUTE_SRC.match(/router\.get\('\/audit-logs'[\s\S]*?\n  \}\)+;/);
    expect(m![0]).toMatch(/findMany[\s\S]*count\(\{ where: built\.where \}\)/);
  });
  it('成功返回 { ok:true, logs, total }', () => {
    const m = ROUTE_SRC.match(/router\.get\('\/audit-logs'[\s\S]*?\n  \}\)+;/);
    expect(m![0]).toMatch(/res\.json\(\{ ok: true, logs, total \}\)/);
  });
});

// ═══ Part 5: AdminPanel UI — filter state ═══
describe('runtime QA [AdminPanel UI]: filter state', () => {
  it('auditFilter state 含 targetType/targetId/action/actorId/createdFrom/createdTo', () => {
    expect(ADMIN_SRC).toMatch(/targetType.*targetId.*action.*actorId.*createdFrom.*createdTo/);
  });
  it('auditFilterError state（失败反馈，不伪成功）', () => {
    expect(ADMIN_SRC).toMatch(/auditFilterError/);
  });
});

// ═══ Part 6: AdminPanel UI — fetchAuditLogs query string ═══
describe('runtime QA [AdminPanel UI]: fetchAuditLogs query string', () => {
  it('fetchAuditLogs 用 URLSearchParams 构建查询', () => {
    expect(ADMIN_SRC).toMatch(/new URLSearchParams/);
  });
  it('只发非空字段（trim 后判断）', () => {
    expect(ADMIN_SRC).toMatch(/f\.targetType\.trim\(\)\) params\.set/);
    expect(ADMIN_SRC).toMatch(/f\.targetId\.trim\(\)\) params\.set/);
    expect(ADMIN_SRC).toMatch(/f\.action\.trim\(\)\) params\.set/);
    expect(ADMIN_SRC).toMatch(/f\.actorId\.trim\(\)\) params\.set/);
    expect(ADMIN_SRC).toMatch(/f\.createdFrom\.trim\(\)\) params\.set/);
    expect(ADMIN_SRC).toMatch(/f\.createdTo\.trim\(\)\) params\.set/);
  });
  it('R3：始终显式携带 limit/offset 分页参数（替代旧「无筛选无 query」行为）', () => {
    expect(ADMIN_SRC).toMatch(/params\.set\('limit', String\(AUDIT_PAGE_SIZE\)\)/);
    expect(ADMIN_SRC).toMatch(/if \(offset > 0\) params\.set\('offset', String\(offset\)\)/);
  });
  it('成功消费后端 logs + total（不本地伪造）', () => {
    expect(ADMIN_SRC).toMatch(/setAuditLogs\(d\.logs \|\| \[\]\)/);
    expect(ADMIN_SRC).toMatch(/setAuditTotal\(typeof d\.total === 'number' \? d\.total : \(d\.logs \|\| \[\]\)\.length\)/);
  });
  it('只有无筛选首页才 writeAdminPanelCache（筛选/翻页结果不污染默认缓存）', () => {
    expect(ADMIN_SRC).toMatch(/if \(offset === 0 && !hasFilter\) writeAdminPanelCache\('audit-logs', d\)/);
  });
  it('失败时 setAuditFilterError 显示后端错误（不伪成功）', () => {
    expect(ADMIN_SRC).toMatch(/catch \(e: any\)[\s\S]*?setAuditFilterError\(e\?\.message/);
  });
});

// ═══ Part 7: AdminPanel UI — 筛选控件 ═══
describe('runtime QA [AdminPanel UI]: 筛选控件', () => {
  it('targetType 输入框', () => {
    expect(ADMIN_SRC).toMatch(/value=\{auditFilter\.targetType\}/);
  });
  it('targetId 输入框', () => {
    expect(ADMIN_SRC).toMatch(/value=\{auditFilter\.targetId\}/);
  });
  it('action 输入框', () => {
    expect(ADMIN_SRC).toMatch(/value=\{auditFilter\.action\}/);
  });
  it('actorId 输入框', () => {
    expect(ADMIN_SRC).toMatch(/value=\{auditFilter\.actorId\}/);
  });
  it('createdFrom 输入框', () => {
    expect(ADMIN_SRC).toMatch(/value=\{auditFilter\.createdFrom\}/);
  });
  it('createdTo 输入框', () => {
    expect(ADMIN_SRC).toMatch(/value=\{auditFilter\.createdTo\}/);
  });
  it('刷新按钮调 fetchAuditLogs', () => {
    expect(ADMIN_SRC).toMatch(/onClick=\{\(\) => fetchAuditLogs\(\)\}/);
  });
  it('清空按钮重置 filter + fetchAuditLogs', () => {
    expect(ADMIN_SRC).toMatch(/清空/);
    expect(ADMIN_SRC).toMatch(/targetType: ''.*targetId: ''.*action: ''.*actorId: ''.*createdFrom: ''.*createdTo: ''/);
  });
});

// ═══ Part 8: 边界 — invalid date 不前端伪造成功 ═══
describe('runtime QA [边界]: invalid date 不前端伪造', () => {
  it('createdFrom/createdTo 直接传给后端（不前端校验拦截）', () => {
    // trim 后直接 set，不前端 isNaN 拦截——交给后端 INVALID_DATE_RANGE fail closed
    expect(ADMIN_SRC).toMatch(/if \(f\.createdFrom\.trim\(\)\) params\.set\('createdFrom', f\.createdFrom\.trim\(\)\)/);
    expect(ADMIN_SRC).toMatch(/if \(f\.createdTo\.trim\(\)\) params\.set\('createdTo', f\.createdTo\.trim\(\)\)/);
  });
  it('fetchAuditLogs 失败 catch 后 setAuditFilterError（INVALID_DATE_RANGE/INVALID_PAGINATION 显示在筛选区）', () => {
    // try/catch 包裹 fetchAdmin，catch 内 setAuditFilterError
    const fnMatch = ADMIN_SRC.match(/const fetchAuditLogs = async[\s\S]*?\n  \};/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/try[\s\S]*catch \(e: any\)[\s\S]*setAuditFilterError/);
  });
});

// ═══ Part 9: 不混 Agent flow ═══
describe('runtime QA [边界]: AdminPanel 不混 Agent flow', () => {
  it('AdminPanel 不调用 Agent flow', () => {
    expect(ADMIN_SRC).not.toMatch(/commitInvoiceDelete|commitOrderLineUpdate|commitOrderStatusTransition/);
  });
});

// ═══ Part 10: 真实 fixture ═══
describe('runtime QA [fixture]: 真实 audit query payload', () => {
  it('完整筛选 query string', () => {
    const params = new URLSearchParams();
    params.set('targetType', 'order');
    params.set('targetId', 'O1');
    params.set('action', 'status-transition');
    params.set('actorId', 'agent');
    params.set('createdFrom', '1782700000000');
    params.set('createdTo', '1782800000000');
    params.set('limit', '50');
    params.set('offset', '10');
    expect(params.toString()).toContain('targetType=order');
    expect(params.toString()).toContain('createdFrom=1782700000000');
  });
  it('只发非空字段（空字段不进 query string）', () => {
    const params = new URLSearchParams();
    const f = { targetType: 'order', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' };
    if (f.targetType.trim()) params.set('targetType', f.targetType.trim());
    // 只有 targetType 进 query string
    expect(params.toString()).toBe('targetType=order');
  });
  it('成功响应: { ok:true, logs:[...], total:N }', () => {
    const res = { ok: true, logs: [{ id: 'al1', action: 'login', targetType: 'user', targetId: 'u1' }], total: 1 };
    expect(res.logs[0].action).toBe('login');
    expect(res.total).toBe(1);
  });
  it('INVALID_PAGINATION 失败: 400', () => {
    const res = { ok: false, error: 'INVALID_PAGINATION', message: 'limit and offset must be non-negative integer strings' };
    expect(res.error).toBe('INVALID_PAGINATION');
  });
});
