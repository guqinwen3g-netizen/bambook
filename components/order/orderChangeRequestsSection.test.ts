import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * ERP-P3-order-change-section-runtime-qa: fixture-driven runtime QA
 * 「变更申请 / Change Requests」区块 + MOQ 快照条 + Capsule 豁免徽章 +
 * OrderManager 编辑门禁引导链路的源码级契约断言（项目无 @testing-library，
 * 遵循 OrderManager.glass.test.tsx / orderLifecycleRuntimeQa.test.ts 既定模式）。
 */

const SECTION_SRC = readFileSync(new URL('./OrderChangeRequestsSection.tsx', import.meta.url), 'utf8');
const SERVICE_SRC = readFileSync(new URL('../../services/orderChangeService.ts', import.meta.url), 'utf8');
const ORDER_MGR_SRC = readFileSync(new URL('../OrderManager.tsx', import.meta.url), 'utf8');
const UI_SPEC_SRC = readFileSync(new URL('./orderUiSpec.ts', import.meta.url), 'utf8');

// ═══ Part 1: 区块消费六个真实端点（经 orderChangeService 统一封装） ═══
describe('runtime QA [区块 → 端点]: 六个端点全消费', () => {
  it('service 封装 DR-010 五端点 + MOQ dry-run', () => {
    expect(SERVICE_SRC).toContain("/v1/order-changes");
    expect(SERVICE_SRC).toMatch(/\/v1\/order-changes\/\$\{encodeURIComponent\(id\)\}/);
    expect(SERVICE_SRC).toMatch(/\/v1\/order-changes\/\$\{encodeURIComponent\(id\)\}\/withdraw/);
    expect(SERVICE_SRC).toMatch(/\/v1\/order-changes\/\$\{encodeURIComponent\(id\)\}\/apply/);
    expect(SERVICE_SRC).toContain("/v1/moq/validate");
  });
  it('区块调用 list/get/create/withdraw/apply/validateMoq 全方法', () => {
    for (const m of ['listChangeRequests', 'getChangeRequest', 'createChangeRequest', 'withdrawChangeRequest', 'applyChangeRequest', 'validateMoq']) {
      expect(SECTION_SRC).toContain(`orderChangeService.${m}(`);
    }
  });
  it('列表按 orderId 过滤（订单详情作用域）', () => {
    expect(SECTION_SRC).toMatch(/listChangeRequests\(\{ orderId: order\.id \}\)/);
  });
});

// ═══ Part 2: 变更类型七类 + 表单按类型动态出字段 ═══
describe('runtime QA [表单]: 七类变更动态字段', () => {
  it('ORDER_CHANGE_TYPES 固定七类（DR-010 无阈值分级）', () => {
    expect(SERVICE_SRC).toMatch(/ORDER_CHANGE_TYPES = \['price', 'quantity', 'delivery', 'customer', 'product', 'cancel', 'pause'\]/);
  });
  it('七类中文标签齐全', () => {
    for (const label of ['金额变更', '数量变更', '交期变更', '客户变更', '产品变更', '取消订单', '暂停订单']) {
      expect(SERVICE_SRC).toContain(`'${label}'`);
    }
  });
  it('表单按 changeType 动态分支出字段', () => {
    for (const t of ['quantity', 'price', 'delivery', 'customer', 'product', 'pause', 'cancel']) {
      expect(SECTION_SRC).toContain(`changeType === '${t}'`);
    }
  });
  it('客户端校验镜像服务端下限（reason ≥15 / impact ≥10）', () => {
    expect(SERVICE_SRC).toMatch(/ORDER_CHANGE_REASON_MIN = 15/);
    expect(SERVICE_SRC).toMatch(/ORDER_CHANGE_IMPACT_MIN = 10/);
    expect(SECTION_SRC).toMatch(/buildChangeRequestDraft\(order, form\)/);
  });
});

// ═══ Part 3: 状态机五态徽章 + 三态齐全 ═══
describe('runtime QA [状态机 + 三态]', () => {
  it('五态中文标签齐全（待审批/已批准/已拒绝/已应用/已撤回）', () => {
    for (const s of ['Pending', 'Approved', 'Rejected', 'Applied', 'Cancelled']) {
      expect(SERVICE_SRC).toContain(`${s}:`);
    }
    for (const label of ['待审批', '已批准', '已拒绝', '已应用', '已撤回']) {
      expect(SERVICE_SRC).toContain(`'${label}'`);
    }
  });
  it('五态徽章变体映射齐全（bds-badge 小元素范式）', () => {
    const m = SECTION_SRC.match(/CHANGE_STATUS_BADGE_VARIANT[^=]*= \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const s of ['Pending', 'Approved', 'Rejected', 'Applied', 'Cancelled']) {
      expect(m![0]).toContain(`${s}:`);
    }
    expect(SECTION_SRC).toContain('bds-badge sm');
  });
  it('loading / error / empty 三态齐全，无占位符', () => {
    expect(SECTION_SRC).toContain('加载变更申请');
    expect(SECTION_SRC).toContain('变更申请加载失败');
    expect(SECTION_SRC).toContain('暂无变更申请');
  });
  it('守卫态横幅：进行中申请阻断并发发起（服务端 fail-closed，前端可行动性说明）', () => {
    expect(SECTION_SRC).toMatch(/isGuardedOrderStatus\(order\.status\)/);
    expect(SECTION_SRC).toContain('待其完结后方可发起新申请');
  });
});

// ═══ Part 4: 审批进度（惰性加载详情） ═══
describe('runtime QA [审批进度]', () => {
  it('展开时惰性 GET /:id 拉取 approvalRequest', () => {
    expect(SECTION_SRC).toMatch(/setExpandedId\(cr\.id\)/);
    expect(SECTION_SRC).toMatch(/getChangeRequest\(cr\.id\)/);
    expect(SECTION_SRC).toContain('加载审批进度');
  });
  it('审批状态/审批人/决定时间/审批意见/生效留痕全展示', () => {
    for (const frag of ['approvalRequest?.status', 'approvalRequest?.reviewerId', 'approvalRequest?.decidedAt', 'approvalRequest?.decisionNote', 'appliedAt', 'appliedBy']) {
      expect(SECTION_SRC).toContain(frag);
    }
  });
  it('Pending 可撤回 / Approved 可生效（错误内联展示）', () => {
    expect(SECTION_SRC).toMatch(/cr\.status === 'Pending'/);
    expect(SECTION_SRC).toMatch(/cr\.status === 'Approved'/);
    expect(SECTION_SRC).toContain('handleWithdraw');
    expect(SECTION_SRC).toContain('handleApply');
  });
  it('暂停申请元信息（预计恢复/责任人/恢复到期提醒）', () => {
    expect(SECTION_SRC).toContain('expectedResumeDate');
    expect(SECTION_SRC).toContain('pauseOwnerId');
    expect(SECTION_SRC).toContain('resumeReminderFlagged');
  });
});

// ═══ Part 5: MOQ dry-run 预检 ═══
describe('runtime QA [MOQ 预检]', () => {
  it('数量变更表单内触发 validateMoq（带业务线/豁免/快照上下文）', () => {
    expect(SECTION_SRC).toContain('MOQ 预检');
    expect(SECTION_SRC).toMatch(/validateMoq\(\{/);
    expect(SECTION_SRC).toContain('businessLine: order.businessLine');
    expect(SECTION_SRC).toContain('capsuleExemption: readOrderCapsuleExemption(order)');
    expect(SECTION_SRC).toContain('snapshot: readOrderMoqSnapshot(order)');
  });
  it('预检结果合规/不合规双文案 + Capsule 豁免生效提示', () => {
    expect(SECTION_SRC).toContain('MOQ 预检通过');
    expect(SECTION_SRC).toContain('MOQ 预检不合规');
    expect(SECTION_SRC).toContain('Capsule 档豁免生效中');
  });
});

// ═══ Part 6: MOQ 快照只读条 ═══
describe('runtime QA [MOQ 快照条]', () => {
  it('OrderMoqSnapshotBlock 导出 + readOrderMoqSnapshot 门控（无快照不渲染）', () => {
    expect(SECTION_SRC).toMatch(/export const OrderMoqSnapshotBlock/);
    expect(SECTION_SRC).toMatch(/if \(!snapshot\) return null/);
  });
  it('三档阈值 + 快照时间 + 来源全展示', () => {
    for (const frag of ['面料档', '成衣档', 'Capsule 档', 'fabricDefaultMoq', 'garmentDefaultMoq', 'capsuleMoq', 'snapshotAt', 'moq_config', 'fallback_constant']) {
      expect(SECTION_SRC).toContain(frag);
    }
  });
  it('标注「创建时快照，不随配置变更追溯」（writeOnce 契约可见性）', () => {
    expect(SECTION_SRC).toContain('创建时快照，不随配置变更追溯');
  });
});

// ═══ Part 7: Capsule MOQ 豁免徽章 ═══
describe('runtime QA [Capsule 豁免徽章]', () => {
  it('CapsuleExemptionBadge 导出 + 严格 true 门控（false 不渲染）', () => {
    expect(SECTION_SRC).toMatch(/export const CapsuleExemptionBadge/);
    expect(SECTION_SRC).toMatch(/if \(!readOrderCapsuleExemption\(order\)\) return null/);
  });
  it('徽章小元素范式（bds-badge sm）+ DR-003 title 说明', () => {
    const m = SECTION_SRC.match(/export const CapsuleExemptionBadge[\s\S]*?\};/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('bds-badge sm');
    expect(m![0]).toContain('MOQ 豁免');
    expect(m![0]).toContain('DR-003');
  });
});

// ═══ Part 8: 编辑门禁引导（受控字段直改 → 变更申请，非静默失败） ═══
describe('runtime QA [编辑门禁引导]', () => {
  it('受控字段清单覆盖数量/金额/交期/客户/产品', () => {
    const m = SERVICE_SRC.match(/CONTROLLED_FIELDS[\s\S]*?\];/);
    expect(m).not.toBeNull();
    for (const f of ['quantity', 'salesPrice', 'contractAmount', 'dueDate', 'clientDate', 'customer', 'product']) {
      expect(m![0]).toContain(`field: '${f}'`);
    }
  });
  it('OrderManager 保存时侦测受控字段改动（仅已批准订单）', () => {
    expect(ORDER_MGR_SRC).toMatch(/isApprovedOrderStatus\(selectedOrder\.status\)/);
    expect(ORDER_MGR_SRC).toMatch(/collectControlledFieldEdits\(/);
  });
  it('被拦截字段还原原值 + 不进入持久化 patch（防绕审批链 + 防误标 manual）', () => {
    expect(ORDER_MGR_SRC).toMatch(/\[edit\.field\] = \(selectedOrder as unknown as Record<string, unknown>\)\[edit\.field\]/);
    expect(ORDER_MGR_SRC).toMatch(/delete \(patch as Record<string, unknown>\)\[edit\.field\]/);
  });
  it('拦截后预填变更申请并滚动到区块（引导而非静默失败）', () => {
    expect(ORDER_MGR_SRC).toMatch(/setChangeGatePrefill\(\{ edits: controlledEdits \}\)/);
    expect(ORDER_MGR_SRC).toContain("document.getElementById('order-detail-changes')?.scrollIntoView");
    expect(ORDER_MGR_SRC).toContain('id="order-detail-changes"');
  });
  it('区块消费 gatePrefill：自动开表单 + 预填 + 消费回调', () => {
    expect(SECTION_SRC).toMatch(/if \(!gatePrefill \|\| gatePrefill\.edits\.length === 0\) return/);
    expect(SECTION_SRC).toMatch(/setComposerOpen\(true\)/);
    expect(SECTION_SRC).toMatch(/onGatePrefillConsumed\?\.\(\)/);
    expect(SECTION_SRC).toContain('检测到受控字段直改');
  });
});

// ═══ Part 8b: 多类型受控改动队列（G4：一次保存多类型 → 逐类发起，队列进度可见） ═══
describe('runtime QA [受控改动队列]: 多类型逐类发起', () => {
  it('门禁引导按类型建队（gateQueue + gateQueueIndex）', () => {
    expect(SECTION_SRC).toContain('const [gateQueue, setGateQueue] = useState<OrderChangeType[]>([])');
    expect(SECTION_SRC).toContain('const [gateQueueIndex, setGateQueueIndex] = useState(0)');
    expect(SECTION_SRC).toMatch(/Array\.from\(new Set\(gatePrefill\.edits\.map\(\(e\) => e\.changeType\)\)\)/);
  });
  it('预填逻辑收敛为 prefillFormFromGateEdit（建队与队列推进共用）', () => {
    expect(SECTION_SRC).toContain('const prefillFormFromGateEdit');
    expect(SECTION_SRC).toMatch(/setForm\(prefillFormFromGateEdit\(firstEdit\)\)/);
    expect(SECTION_SRC).toMatch(/setForm\(nextEdit \? prefillFormFromGateEdit\(nextEdit\)/);
  });
  it('提交成功后队列推进：保留表单 + 预填下一类型 + 剩余数量提示', () => {
    expect(SECTION_SRC).toMatch(/const nextIndex = gateQueueIndex \+ 1/);
    expect(SECTION_SRC).toContain('类改动待分别发起（');
    expect(SECTION_SRC).toContain('已为你预填「');
  });
  it('队列进度可见：进度文案 + 逐类状态徽章（已提交/进行中/待发起）', () => {
    expect(SECTION_SRC).toContain('改动队列进度');
    expect(SECTION_SRC).toContain('已提交 · ');
    expect(SECTION_SRC).toContain('进行中 · ');
    expect(SECTION_SRC).toContain('还有 {gateQueue.length - gateQueueIndex - 1} 类改动待分别发起');
  });
  it('手动发起 / 取消 / 队列清空均重置队列（防串单）', () => {
    expect(SECTION_SRC).toContain('const resetGateQueue = () => {');
    expect(SECTION_SRC).toMatch(/onClick=\{\(\) => \{ setComposerOpen\(false\); resetGateQueue\(\); \}\}/);
  });
});

// ═══ Part 8c: 客户变更 RelationCombobox（G5：新客户选型体验，限客户类别） ═══
describe('runtime QA [客户变更选型]: RelationCombobox 替换手填关联 ID', () => {
  it('客户变更分支消费 RelationCombobox（订单域共享路径），限制客户类别', () => {
    expect(SECTION_SRC).toContain("import RelationCombobox from './RelationCombobox'");
    expect(SECTION_SRC).toContain('<RelationCombobox');
    expect(SECTION_SRC).toContain("filterCategories={['Customer']}");
  });
  it('选中档案同时写入新客户名称 + 关联 ID（契约字段不变）', () => {
    expect(SECTION_SRC).toContain('afterCustomer: next.name');
    expect(SECTION_SRC).toContain("afterCustomerRelationId: next.relationId ?? ''");
    expect(SECTION_SRC).toContain('relationId={form.afterCustomerRelationId || undefined}');
  });
  it('手填「新客户关联 ID」输入框已移除', () => {
    expect(SECTION_SRC).not.toContain('新客户关联 ID');
    expect(SECTION_SRC).not.toContain('Relation ID，缺省按名称');
  });
  it('区块接收 relations prop + OrderManager 透传 relations', () => {
    expect(SECTION_SRC).toContain('relations = [],');
    expect(SECTION_SRC).toContain('relations?: Relation[]');
    expect(ORDER_MGR_SRC).toMatch(/<OrderChangeRequestsSection[\s\S]*?relations=\{relations\}/);
  });
});

// ═══ Part 9: OrderManager 集成落点 ═══
describe('runtime QA [OrderManager 集成]', () => {
  it('导入并渲染变更申请区块（详情页锚点 order-detail-changes）', () => {
    expect(ORDER_MGR_SRC).toMatch(/import OrderChangeRequestsSection, \{[\s\S]*?\} from '\.\/order\/OrderChangeRequestsSection'/);
    expect(ORDER_MGR_SRC).toMatch(/<OrderChangeRequestsSection/);
    expect(ORDER_MGR_SRC).toMatch(/gatePrefill=\{changeGatePrefill\}/);
  });
  it('MOQ 快照条挂在订单详情 summary 面板内', () => {
    expect(ORDER_MGR_SRC).toMatch(/<OrderMoqSnapshotBlock order=\{selectedOrder\} isDarkMode=\{isDarkMode\} \/>/);
  });
  it('Capsule 豁免徽章覆盖列表行与详情头部', () => {
    const matches = ORDER_MGR_SRC.match(/<CapsuleExemptionBadge order=/g);
    expect(matches).not.toBeNull();
    // DR-049 移动端退役后落点为 2：桌面表格行 + 详情头部（原移动卡片视图已删除）
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
  it('分区图标登记入 ORDER_SECTION_ICONS（全域图标唯一来源）', () => {
    expect(UI_SPEC_SRC).toMatch(/changes: FileEdit/);
  });
});

// ═══ Part 10: 设计系统铁律（违反即返工） ═══
describe('runtime QA [设计系统合规]', () => {
  it('新区块/新服务无硬编码 rounded-[Npx] / hex 颜色 / box-shadow', () => {
    for (const src of [SECTION_SRC, SERVICE_SRC]) {
      expect(src).not.toMatch(/rounded-\[\d+px\]/);
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/box-shadow/);
    }
  });
  it('字重 ≤ font-normal（全局 ≤300 契约：无 medium/semibold/bold）', () => {
    expect(SECTION_SRC).not.toMatch(/font-(medium|semibold|bold|black)/);
  });
  it('UI 无 emoji（badge/banner/按钮纯图标 + 文字）', () => {
    // eslint-disable-next-line no-control-regex
    expect(SECTION_SRC).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
  it('面板走 SidePanelContainer raisedCard 范式（flat：无手写 div 容器并存）', () => {
    expect(SECTION_SRC).toMatch(/<SidePanelContainer/);
    expect(SECTION_SRC).toContain('materialRole="raisedCard"');
    expect(SECTION_SRC).toContain('spotlight');
    expect(SECTION_SRC).toContain('edgeFadeItem');
  });
  it('标题中英双语分区头（kicker="Change Requests" + title="变更申请"）', () => {
    expect(SECTION_SRC).toContain('kicker="Change Requests"');
    expect(SECTION_SRC).toContain('title="变更申请"');
  });
});
