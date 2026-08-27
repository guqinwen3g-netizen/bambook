import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./DevelopmentManager.tsx', import.meta.url), 'utf8');

describe('C13 5A 样衣评审入口（详情页评审通过/不通过按钮）', () => {
  it('仅 5A 样衣显示评审按钮（sampleCategory === 5a 条件渲染）', () => {
    expect(source).toContain("(selectedCase as any).sampleCategory === '5a'");
    expect(source).toContain('评审通过');
    expect(source).toContain('评审不通过');
  });

  it('调用后端既有 5A 评审端点 POST /v1/development/:id/review（reviewStatus passed/failed）', () => {
    expect(source).toContain('/v1/development/${encodeURIComponent(selectedCase.id)}/review');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain('body: JSON.stringify({ reviewStatus })');
    expect(source).toContain("handleReview('passed')");
    expect(source).toContain("handleReview('failed')");
  });

  it('评审动作走 bdsConfirm 确认（不通过为 danger 语义），成功后回写 cases 列表状态', () => {
    expect(source).toContain('await bdsConfirm({');
    expect(source).toContain('danger: !passed');
    expect(source).toContain('setCases(prev => prev.map(c => (c.id === updated.id ? { ...c, ...updated } : c)))');
  });

  it('评审提交中防重入（isReviewing 禁用按钮）', () => {
    expect(source).toContain('const [isReviewing, setIsReviewing] = useState(false)');
    expect(source).toContain('disabled={isReviewing}');
  });
});

describe('D4 开发管理客户/供应商从关系智库档案选择', () => {
  it('挂载时加载关系档案（apiService.listRelations 与订单/财务面板同通道）', () => {
    expect(source).toContain('apiService.listRelations().then(setRelations)');
  });

  it('客户/供应商字段使用 RelationCombobox（filterCategories 方向过滤）', () => {
    expect(source).toContain("import RelationCombobox from './ui/RelationCombobox';");
    expect(source).toContain("filterCategories={['Customer']}");
    expect(source).toContain("filterCategories={['Supplier']}");
  });

  it('选中档案同步 FK 快照与名称（customerRelationId/supplierRelationId 表单状态）', () => {
    expect(source).toContain("updateField('customerRelationId', relationId ?? '')");
    expect(source).toContain("updateField('supplierRelationId', relationId ?? '')");
  });

  it('提交载荷携带关系 FK（create/update 链路 customerRelationId/supplierRelationId）', () => {
    expect(source).toContain('customerRelationId: form.customerRelationId.trim()');
    expect(source).toContain('supplierRelationId: form.supplierRelationId.trim()');
  });

  it('编辑回填带 FK（buildInitialForm 从 editingCase 恢复 relationId）', () => {
    expect(source).toContain('customerRelationId: editingCase.customerRelationId ||');
    expect(source).toContain('supplierRelationId: editingCase.supplierRelationId ||');
  });
});
