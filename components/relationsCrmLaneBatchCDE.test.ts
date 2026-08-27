import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 功能修复任务包批次 C/D/E —— 关系智库 + CRM 车道源码断言
 *
 * 覆盖七项（任务书包拍板）：
 *   C1 关系智库客户导出按钮（GET /v2/relations/export.csv 受控导出）
 *   C2 联系人离职状态入口（名片 hover「标记离职/恢复在职」→ Relation.contactStatus）
 *   C3 沟通日志字段补全（方向/主题/关联订单/报价）
 *   C4 品牌线启用/停用切换（isActive，includeInactive 拉取）
 *   C5 CRM 跟进记录/商机管线 搜索+筛选+排序
 *   D1 档案表单信用额度标注「仅备注，不控制订单信用」（拍板方案二）
 *   E1 名片/品牌线/沟通日志删除统一 bdsConfirm
 *
 * 风格对齐 ShipmentManager.test.tsx / RelationsManager.test.tsx：readFileSync 源码断言。
 */

const relationsManagerSource = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
const crmManagerSource = readFileSync(new URL('./CrmManager.tsx', import.meta.url), 'utf8');
const detailPanelSource = readFileSync(new URL('./ui/DetailPanel.tsx', import.meta.url), 'utf8');
const crmSectionsSource = readFileSync(new URL('./ui/crm/crmRelationSections.tsx', import.meta.url), 'utf8');
const apiServiceSource = readFileSync(new URL('../services/apiService.ts', import.meta.url), 'utf8');

describe('C1 关系智库客户导出按钮', () => {
  it('apiService 提供 exportRelationsCsv 封装，走受控导出端点', () => {
    expect(apiServiceSource).toContain('async exportRelationsCsv(');
    expect(apiServiceSource).toContain('/v2/relations/export.csv');
    // 403 等失败解析服务端 JSON 错误文案（data:export:full 门禁常态）
    expect(apiServiceSource).toContain('关系档案导出失败：');
  });

  it('列表页工具栏渲染导出按钮并调用封装（带当前分类口径）', () => {
    expect(relationsManagerSource).toContain('const handleExportRelations = async ()');
    expect(relationsManagerSource).toContain('apiService.exportRelationsCsv(');
    expect(relationsManagerSource).toContain('aria-label="导出组织档案 CSV"');
    expect(relationsManagerSource).toContain('onClick={handleExportRelations}');
    expect(relationsManagerSource).toContain('disabled={relationExportBusy}');
  });
});

describe('C2 联系人离职状态入口', () => {
  it('名片行提供标记离职/恢复在职入口，写 Relation.contactStatus', () => {
    expect(crmSectionsSource).toContain('const handleSetStatus = async (c: Contact, status:');
    expect(crmSectionsSource).toContain("apiService.updateRelation(c.id, { contactStatus: status })");
    expect(crmSectionsSource).toContain('title="标记离职"');
    expect(crmSectionsSource).toContain('title="恢复在职"');
    expect(crmSectionsSource).toContain("handleSetStatus(c, 'Left')");
    expect(crmSectionsSource).toContain("handleSetStatus(c, 'Active')");
  });
});

describe('C3 沟通日志字段补全', () => {
  it('表单包含方向/主题/关联订单/关联报价并随创建提交', () => {
    expect(detailPanelSource).toContain('direction: commLogForm.direction');
    expect(detailPanelSource).toContain('subject: commLogForm.subject.trim() || undefined');
    expect(detailPanelSource).toContain('orderId: commLogForm.orderId || undefined');
    expect(detailPanelSource).toContain('quotationId: commLogForm.quotationId || undefined');
    // 方向下拉（客户发起/我方发起）
    expect(detailPanelSource).toContain('COMM_DIRECTION_LABELS[d]');
    // 主题输入 + 订单/报价下拉
    expect(detailPanelSource).toContain('placeholder="主题(可选)"');
    expect(detailPanelSource).toContain('不关联订单');
    expect(detailPanelSource).toContain('不关联报价');
  });

  it('关联单证下拉按组织维度取数（联系人布局取所属组织）', () => {
    expect(detailPanelSource).toContain("const commLinkRelationId = isOrg ? data.id : (organization?.id ?? null);");
    expect(detailPanelSource).toContain('apiService.listQuotations({ customerRelationId: commLinkRelationId');
    expect(detailPanelSource).toContain('o.customerRelationId === commLinkRelationId');
  });

  it('列表行可读化方向与主题', () => {
    expect(detailPanelSource).toContain('COMM_DIRECTION_LABELS[cl.direction] ?? cl.direction');
    expect(detailPanelSource).toContain('{cl.subject && (');
  });
});

describe('C4 品牌线停用切换', () => {
  it('拉取含停用行（否则停用即消失无法恢复）', () => {
    expect(detailPanelSource).toContain('apiService.listBrandLines(data.id, { includeInactive: true })');
  });

  it('行内切换按钮走 updateBrandLine isActive', () => {
    expect(detailPanelSource).toContain('const handleToggleBrandLine = async (bl: BrandLine)');
    expect(detailPanelSource).toContain('apiService.updateBrandLine(bl.id, { isActive: !bl.isActive })');
    expect(detailPanelSource).toContain("title={bl.isActive ? '停用品牌线' : '启用品牌线'}");
  });
});

describe('C5 CRM 列表搜索/筛选/排序', () => {
  it('跟进记录 Tab：搜索 + 类型筛选 + 排序（组合 bar，icon 内嵌）', () => {
    expect(crmManagerSource).toContain('const visibleFollowUps = useMemo(() => {');
    expect(crmManagerSource).toContain('placeholder="搜索跟进内容/主题/联系人..."');
    expect(crmManagerSource).toContain('全部类型');
    expect(crmManagerSource).toContain('跟进日期 新→旧');
    expect(crmManagerSource).toContain('下次跟进 近→远');
    expect(crmManagerSource).toContain('{visibleFollowUps.map((fu) => {');
    // 筛选后空态
    expect(crmManagerSource).toContain('无匹配的跟进记录');
  });

  it('商机管线 Tab：搜索 + 阶段筛选 + 排序（列内排序）', () => {
    expect(crmManagerSource).toContain('const visibleOpportunities = useMemo(() => {');
    expect(crmManagerSource).toContain('placeholder="搜索商机标题/来源/销售..."');
    expect(crmManagerSource).toContain('全部阶段');
    expect(crmManagerSource).toContain('金额 高→低');
    expect(crmManagerSource).toContain('预计成交 近→远');
    expect(crmManagerSource).toContain('const stageOpps = visibleOpportunities.filter((o) => o.stage === stage.id);');
    expect(crmManagerSource).toContain('{visibleStages.map((stage) => {');
  });
});

describe('D1 信用额度仅备注标注（拍板方案二）', () => {
  it('档案表单信用额度框保留并标注不控制订单信用', () => {
    expect(relationsManagerSource).toContain('name="creditLimit"');
    expect(relationsManagerSource).toContain('仅备注，不控制订单信用');
  });
});

describe('E1 删除确认统一（bdsConfirm）', () => {
  it('联系人名片删除经 bdsConfirm danger 确认', () => {
    expect(crmSectionsSource).toContain("import { bdsConfirm } from '../BdsDialog';");
    expect(crmSectionsSource).toContain("bdsConfirm({ title: '确认删除', body: '确认删除此联系人名片？', danger: true })");
  });

  it('品牌线/沟通日志删除经 bdsConfirm danger 确认', () => {
    expect(detailPanelSource).toContain("import { bdsConfirm } from './BdsDialog';");
    expect(detailPanelSource).toContain("bdsConfirm({ title: '确认删除', body: '确认删除此品牌线？', danger: true })");
    expect(detailPanelSource).toContain("bdsConfirm({ title: '确认删除', body: '确认删除此沟通日志？', danger: true })");
  });
});
