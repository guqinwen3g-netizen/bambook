import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const PANEL_SRC = fs.readFileSync(path.resolve(__dirname, 'WorkflowPanel.tsx'), 'utf-8');
const USER_COMBOBOX_SRC = fs.readFileSync(path.resolve(__dirname, 'ui/UserCombobox.tsx'), 'utf-8');
const API_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/apiService.ts'), 'utf-8');
const KERNEL_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/approvalKernelService.ts'), 'utf-8');
const EXC_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/exceptionService.ts'), 'utf-8');
const SERVER_KERNEL_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/approvals/approvalKernelRoute.ts'), 'utf-8');
const SERVER_EXC_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/exceptions/exceptionRoute.ts'), 'utf-8');
const SERVER_INDEX = fs.readFileSync(path.resolve(__dirname, '../server/src/index.ts'), 'utf-8');

// Part 1: 后端挂载点确认（前端 service 路径必须与之对齐）
describe('runtime QA [server]: 端点挂载', () => {
  it('approvals-kernel 挂载 /api/v1/approvals-kernel', () => {
    expect(SERVER_INDEX).toContain("app.use('/api/v1/approvals-kernel'");
  });
  it('exceptions 挂载 /api/v1/exceptions', () => {
    expect(SERVER_INDEX).toContain("app.use('/api/v1/exceptions'");
  });
  it('内核端点：delegate / boss-bypass / resolution-trace', () => {
    expect(SERVER_KERNEL_ROUTE).toContain("router.post('/:id/delegate'");
    expect(SERVER_KERNEL_ROUTE).toContain("router.post('/:id/boss-bypass'");
    expect(SERVER_KERNEL_ROUTE).toContain("router.get('/:id/resolution-trace'");
  });
  it('例外端点：create / list / gate-check / :id / withdraw / boss-bypass', () => {
    expect(SERVER_EXC_ROUTE).toContain("router.post('/',");
    expect(SERVER_EXC_ROUTE).toContain("router.get('/gate-check'");
    expect(SERVER_EXC_ROUTE).toContain("router.get('/:id'");
    expect(SERVER_EXC_ROUTE).toContain("router.post('/:id/withdraw'");
    expect(SERVER_EXC_ROUTE).toContain("router.post('/:id/boss-bypass'");
  });
});

// Part 2: approvalKernelService 端点契约
describe('runtime QA [approvalKernelService]: 端点契约', () => {
  it('listBusinessApprovals 走 /v1/approvals', () => {
    expect(KERNEL_SVC_SRC).toContain('/v1/approvals?status=');
  });
  it('resolution-trace / delegate / boss-bypass 走 /v1/approvals-kernel', () => {
    expect(KERNEL_SVC_SRC).toContain('/v1/approvals-kernel');
    expect(KERNEL_SVC_SRC).toContain('resolution-trace');
    expect(KERNEL_SVC_SRC).toContain('/delegate');
    expect(KERNEL_SVC_SRC).toContain('/boss-bypass');
  });
  it('DR-007 四路径类型齐全 + isFallbackRoute', () => {
    for (const route of ['DEPT_HEAD', 'FALLBACK_DEPT_HEAD_VACANT', 'FALLBACK_SELF_APPLY_SUPERVISOR', 'FALLBACK_ADMIN']) {
      expect(KERNEL_SVC_SRC).toContain(`'${route}'`);
    }
    expect(KERNEL_SVC_SRC).toContain('export function isFallbackRoute');
  });
  it('类型内聚本文件（不从 root types.ts 导入）', () => {
    expect(KERNEL_SVC_SRC).not.toContain("from '../types'");
  });
});

// Part 3: exceptionService 端点契约
describe('runtime QA [exceptionService]: 端点契约', () => {
  it('全部走 /v1/exceptions', () => {
    expect(EXC_SVC_SRC).toContain('/v1/exceptions');
    expect(EXC_SVC_SRC).toContain('/gate-check?');
    expect(EXC_SVC_SRC).toContain('/withdraw');
    expect(EXC_SVC_SRC).toContain('/boss-bypass');
  });
  it('8 类例外类别枚举与后端一致', () => {
    for (const c of ['moq_exemption', 'price_deviation', 'order_change', 'shipment_release', 'qc_fault', 'payment_term', 'sample_skip', 'other']) {
      expect(EXC_SVC_SRC).toContain(`'${c}'`);
    }
  });
  it('7 态状态机与后端一致', () => {
    for (const s of ['Pending', 'ReviewerApproved', 'ReviewerRejected', 'BossFinalBypass', 'Consumed', 'Expired', 'Cancelled']) {
      expect(EXC_SVC_SRC).toContain(`'${s}'`);
    }
  });
  it('门禁入口事件机制（EXCEPTION_ENTRY_EVENT + openExceptionEntry）', () => {
    expect(EXC_SVC_SRC).toContain("EXCEPTION_ENTRY_EVENT = 'bambook:dr013-exception-entry'");
    expect(EXC_SVC_SRC).toContain('export function openExceptionEntry');
    expect(EXC_SVC_SRC).toContain('EXCEPTION_ENTRY_HINT');
  });
  it('类型内聚本文件（不从 root types.ts 导入）', () => {
    expect(EXC_SVC_SRC).not.toContain("from '../types'");
  });
});

// Part 4: WorkflowPanel UI 集成
describe('runtime QA [WorkflowPanel]: 审批中心增强', () => {
  it('三分区：审批单 / 例外申请 / 工作流实例', () => {
    expect(PANEL_SRC).toContain('审批单 Approvals');
    expect(PANEL_SRC).toContain('例外申请 Exceptions');
    expect(PANEL_SRC).toContain('工作流实例 Workflows');
    expect(PANEL_SRC).toContain('审批中心 Approval Center');
  });
  it('路由解析轨迹区块（Resolution Trace + 轨迹链）', () => {
    expect(PANEL_SRC).toContain('路由解析轨迹 Resolution Trace');
    expect(PANEL_SRC).toContain('getResolutionTrace');
    expect(PANEL_SRC).toContain('RESOLVER_ROUTE_LABEL');
    expect(PANEL_SRC).toContain('departmentSnapshotId');
  });
  it('委派入口（仅当前审批人 + reason ≥10 字守卫）', () => {
    expect(PANEL_SRC).toContain('DELEGATE_REASON_MIN = 10');
    expect(PANEL_SRC).toContain('delegateApproval');
    expect(PANEL_SRC).toContain('委派记录');
    expect(PANEL_SRC).toContain('canDelegate');
  });
  it('委派受让人为 BDS 用户选择器（可搜索下拉，非手填 ID）', () => {
    expect(PANEL_SRC).toContain("import UserCombobox from './ui/UserCombobox'");
    expect(PANEL_SRC).toContain('<UserCombobox');
    expect(PANEL_SRC).toContain('value={delegateForm.toUserId}');
    expect(PANEL_SRC).toContain('excludeIds={[item.requesterId, currentUserId].filter(Boolean)}');
    expect(PANEL_SRC).not.toContain('被委派人用户 ID（禁止委派给申请人）');
  });
  it('BOSS 兜底标识与特批（owner 角色 + reason ≥30 字守卫）', () => {
    expect(PANEL_SRC).toContain('BOSS 最终兜底特批');
    expect(PANEL_SRC).toContain('BOSS_REASON_MIN = 30');
    expect(PANEL_SRC).toContain("hasRole('owner')");
    expect(PANEL_SRC).toContain('bossBypassApproval');
    expect(PANEL_SRC).toContain('isFallbackRoute');
    expect(PANEL_SRC).toContain('路由兜底');
  });
  it('DR-013 例外卡片与发起表单（全字段 + 原规则不变提示）', () => {
    expect(PANEL_SRC).toContain('发起 DR-013 受控例外申请');
    expect(PANEL_SRC).toContain('EXCEPTION_CATEGORY_LABEL');
    expect(PANEL_SRC).toContain('EXCEPTION_STATUS_LABEL');
    expect(PANEL_SRC).toContain('responsibleOwnerId');
    expect(PANEL_SRC).toContain('原规则不变');
    expect(PANEL_SRC).toContain('越权门禁');
    expect(PANEL_SRC).toContain('EXCEPTION_REASON_MIN = 30');
  });
  it('门禁查询 gate-check + 入口事件监听 + 撤回', () => {
    expect(PANEL_SRC).toContain('gateCheck');
    expect(PANEL_SRC).toContain('门禁查询 Gate Check');
    expect(PANEL_SRC).toContain('EXCEPTION_ENTRY_EVENT');
    expect(PANEL_SRC).toContain('withdrawException');
  });
  it('loading / empty / error 三态齐全（禁止占位符）', () => {
    expect(PANEL_SRC).toContain('animate-spin');
    expect(PANEL_SRC).toContain('暂无待审批单');
    expect(PANEL_SRC).toContain('暂无例外申请');
    expect(PANEL_SRC).toContain('加载失败');
  });
  it('真实 API（禁止 mock 数据留在生产路径）', () => {
    expect(PANEL_SRC).not.toContain('mockData');
    expect(PANEL_SRC).not.toContain('MOCK_');
    expect(PANEL_SRC).not.toContain('fakeItems');
  });
  it('设计系统纪律：无硬编码 hex / rounded-[Npx] / box-shadow / 过重字重', () => {
    expect(PANEL_SRC).not.toMatch(/rounded-\[\d+px\]/);
    expect(PANEL_SRC).not.toMatch(/(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/);
    expect(PANEL_SRC).not.toContain('box-shadow:');
    expect(PANEL_SRC).not.toMatch(/font-(medium|semibold|bold)\b/);
  });
});

// Part 5: UserCombobox 用户选择器（G3 委派选人）
describe('runtime QA [UserCombobox]: 审批委派用户选择器', () => {
  it('数据源复用 /api/hr/personnel（apiService.listUserAccounts），透出角色快照', () => {
    expect(USER_COMBOBOX_SRC).toContain('apiService.listUserAccounts()');
    expect(API_SVC_SRC).toContain('UserAccountDirectoryOption');
    expect(API_SVC_SRC).toContain('roles: Array.isArray(u.roles) ? u.roles : null');
  });
  it('展示 姓名 + 角色 + 部门，受控值为 userId', () => {
    expect(USER_COMBOBOX_SRC).toContain('onChange: (userId: string) => void');
    expect(USER_COMBOBOX_SRC).toContain('u.displayName');
    expect(USER_COMBOBOX_SRC).toContain("u.roles ?? []");
    expect(USER_COMBOBOX_SRC).toContain('u.department');
    expect(USER_COMBOBOX_SRC).toContain('onChange(u.id)');
  });
  it('可搜索：按姓名 / ID / 部门 / 角色过滤，点击外部关闭', () => {
    expect(USER_COMBOBOX_SRC).toContain("u.displayName.toLowerCase().includes(lower)");
    expect(USER_COMBOBOX_SRC).toContain("u.id.toLowerCase().includes(lower)");
    expect(USER_COMBOBOX_SRC).toContain('document.addEventListener');
  });
  it('excludeIds 排除申请人/当前审批人（服务端仍 fail-closed）', () => {
    expect(USER_COMBOBOX_SRC).toContain('excludeIds');
    expect(USER_COMBOBOX_SRC).toContain('!excluded.has(u.id)');
  });
  it('目录加载失败降级为手工录入用户 ID（QC 人员选择器既定降级范式）', () => {
    expect(USER_COMBOBOX_SRC).toContain('loadFailed');
    expect(USER_COMBOBOX_SRC).toContain('用户目录不可用，请手工输入用户 ID');
  });
  it('设计系统纪律：无硬编码 hex / rounded-[Npx] / box-shadow / 过重字重 / emoji', () => {
    expect(USER_COMBOBOX_SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(USER_COMBOBOX_SRC).not.toMatch(/rounded-\[\d+px\]/);
    expect(USER_COMBOBOX_SRC).not.toContain('box-shadow');
    expect(USER_COMBOBOX_SRC).not.toMatch(/font-(medium|semibold|bold)\b/);
    // eslint-disable-next-line no-control-regex
    expect(USER_COMBOBOX_SRC).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
