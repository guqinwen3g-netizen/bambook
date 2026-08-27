import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');

/**
 * 批次二 · 人事管理 K1-K3 runtime QA
 *
 * K1 工资保密门禁：HRManager 薪资工资 tab 按 sensitive:salary 隐藏；
 *    后端 hr/route.ts 薪酬接口（salary-structures/payroll-runs/payroll-items）
 *    在 hr:read|write 之上叠加 sensitive:salary 敏感 scope。
 * K2 离职自动停账号：hrService.recordEmploymentEvent 进入终态（Resigned/Terminated）
 *    自动停用 UserAccount 并使 accountStatusGuard 缓存即时失效。
 * K3 岗位管理入口：HRManager 组织架构 tab 岗位设置区新建/改/删，
 *    直通后端 positions CRUD；写操作按 hr:write 门控显隐。
 *
 * 模式对齐 financePaymentCreditRuntimeQa.test.ts：源码静态断言为主（node 环境，
 * 不运行时导入含 apiService 依赖的模块）。后端行为由 server vitest 覆盖：
 *   server/src/hr/route.test.ts（K1 越权 403/授权 200）
 *   server/src/hr/__tests__/hrService.test.ts（K2 停用/幂等）
 */

const HR_MANAGER = fs.readFileSync(path.resolve(__dirname, 'HRManager.tsx'), 'utf-8');
const HR_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/hr/route.ts'), 'utf-8');
const HR_SERVICE = fs.readFileSync(path.resolve(__dirname, '../server/src/hr/hrService.ts'), 'utf-8');

describe('K1 · 工资保密门禁（前端显隐 + 后端敏感 scope 门）', () => {
  it('前端按 sensitive:salary 判定薪酬可见性', () => {
    expect(HR_MANAGER).toContain("hasPermission('sensitive:salary')");
  });
  it('薪资工资 tab 无权限时不出现在 tab 栏', () => {
    expect(HR_MANAGER).toContain("v.id !== 'payroll' || canViewSalary");
  });
  it('PayrollTab 渲染受 canViewSalary 门控（直达防御）', () => {
    expect(HR_MANAGER).toContain("activeView === 'payroll' && canViewSalary");
  });
  it('后端薪酬三族路径叠加 sensitive:salary 门禁', () => {
    expect(HR_ROUTE).toContain("requirePermission('sensitive:salary')");
    expect(HR_ROUTE).toContain("'/salary-structures', '/payroll-runs', '/payroll-items'");
  });
});

describe('K2 · 离职自动停账号（复用 handover 停用语义）', () => {
  it('终态事件（Resigned/Terminated）触发账号停用', () => {
    expect(HR_SERVICE).toContain("targetStatus === 'Resigned' || targetStatus === 'Terminated'");
    expect(HR_SERVICE).toContain("status: 'disabled'");
  });
  it('停用后即时失效 accountStatusGuard 缓存（未过期 JWT 立即 401）', () => {
    expect(HR_SERVICE).toContain('invalidateAccountStatusCache');
  });
  it('停用留痕：disabledBy/disabledReason/employmentEventId 落 metadata', () => {
    expect(HR_SERVICE).toContain('disabledBy: actorId');
    expect(HR_SERVICE).toContain('disabledReason');
    expect(HR_SERVICE).toContain('employmentEventId: event.id');
  });
  it('幂等：已停用账号不重复写（先交接停用后补登记离职）', () => {
    expect(HR_SERVICE).toContain("user.status !== 'disabled'");
  });
});

describe('K3 · 岗位管理入口（组织架构 tab 岗位设置区）', () => {
  it('岗位写操作按 hr:write 门控显隐（与后端写门同口径）', () => {
    expect(HR_MANAGER).toContain("hasPermission('hr:write')");
    expect(HR_MANAGER).toContain('canManagePositions');
  });
  it('前端 handlers：openPositionForm / submitPosition / deletePosition', () => {
    for (const fn of ['openPositionForm', 'submitPosition', 'deletePosition', 'closePositionForm']) {
      expect(HR_MANAGER).toContain(fn);
    }
  });
  it('前端直通后端 positions CRUD（POST/PATCH/DELETE）', () => {
    expect(HR_MANAGER).toContain("hrSend('positions', body)");
    expect(HR_MANAGER).toContain("hrSend(`positions/${editingPositionId}`, body, 'PATCH')");
    expect(HR_MANAGER).toContain("hrSend(`positions/${id}`, {}, 'DELETE')");
  });
  it('后端岗位 CRUD 三端点齐备（既有能力，前端此前无入口）', () => {
    expect(HR_ROUTE).toContain("router.post('/positions'");
    expect(HR_ROUTE).toContain("router.patch('/positions/:id'");
    expect(HR_ROUTE).toContain("router.delete('/positions/:id'");
  });
  it('岗位表单字段：名称/部门（树序下拉）/编制/描述', () => {
    expect(HR_MANAGER).toContain('positionForm.title');
    expect(HR_MANAGER).toContain('departmentOptions');
    expect(HR_MANAGER).toContain('positionForm.headcount');
    expect(HR_MANAGER).toContain('positionForm.description');
  });
});
