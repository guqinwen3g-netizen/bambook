/**
 * SupplierInquiryPanel B2 — 报价供应商档案下拉框（黑名单旁路收口）
 *
 * 背景：询价比价报价表单的供应商名称原为手打文本框，被拉黑供应商可绕过黑名单
 * 直接报价甚至中选（黑名单此前仅在正式建采购单环节拦截）。
 *
 * 修复契约：
 *   ① 报价表单供应商字段 = 下拉框，数据源为供应商档案 /v1/suppliers（blacklisted=false）
 *   ② 选项以 relationId 为值、Relation.name 为展示名（身份真源 Relation → FactoryProfile 1:1）
 *   ③ 提交报价携带 supplierId + 档案派生 supplierName（后端按 supplierId 复核存在且未拉黑）
 *   ④ 手打供应商名称输入框移除（前端无旁路入口）
 *   ⑤ BDS 纪律：bds-select 语义类，无硬编码 hex/rounded-[Npx]
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SupplierInquiryPanel.tsx', import.meta.url), 'utf8');

describe('SupplierInquiryPanel B2 报价供应商档案下拉框', () => {
  it('下拉数据源：供应商档案 listFactoryProfiles（blacklisted=false 过滤黑名单，limit=200）', () => {
    expect(source).toContain('apiService.listFactoryProfiles({ blacklisted: false, limit: 200 })');
    expect(source).toContain('setSupplierOptions(result.items)');
    // 数据源状态承载 FactoryProfile[]（档案真源类型）
    expect(source).toContain('useState<FactoryProfile[]>([])');
  });

  it('报价表单供应商字段为 bds-select 下拉框：relationId 为值、Relation.name 为展示名', () => {
    expect(source).toContain('value={quoteForm.supplierId}');
    expect(source).toContain("onChange={(e) => setQuoteForm({ ...quoteForm, supplierId: e.target.value })}");
    expect(source).toContain('className="bds-select sm"');
    expect(source).toContain('<option value="">请选择供应商档案</option>');
    expect(source).toContain('key={s.relationId} value={s.relationId}');
    expect(source).toContain('s.relation?.name || s.relationId');
  });

  it('提交报价携带 supplierId + 档案派生 supplierName（前端预检 + 后端复核双保险）', () => {
    // 选中档案派生 supplierName（名称真源在 Relation）
    expect(source).toContain('supplierOptions.find(s => s.relationId === quoteForm.supplierId)');
    expect(source).toContain("selectedSupplier.relation?.name?.trim() || selectedSupplier.relationId");
    // 未选择档案供应商时拦截
    expect(source).toContain('请从供应商档案中选择供应商');
    // 提交载荷携带 supplierId
    expect(source).toContain('supplierId: selectedSupplier.relationId');
  });

  it('手打供应商名称输入框已移除（黑名单旁路入口封闭）', () => {
    // 原手打输入框（placeholder="供应商" + 文本型 supplierName 受控输入）不复存在
    expect(source).not.toContain('placeholder="供应商"');
    expect(source).not.toContain('value={quoteForm.supplierName}');
    // 报价表单状态以 supplierId 为唯一供应商身份字段
    expect(source).toContain("supplierId: ''");
    // 编辑存量报价时回填 supplierId（存量手打报价无 supplierId → 强制重选档案）
    expect(source).toContain("supplierId: quote.supplierId || ''");
  });

  it('BDS 设计纪律：供应商下拉用 bds-select 语义类，无硬编码 hex/rounded-[Npx]', () => {
    // 报价表单内下拉框统一 bds-select（币种/单位/供应商）
    const quoteFormSection = source.slice(source.indexOf('添加/编辑报价表单'));
    expect(quoteFormSection).not.toMatch(/rounded-\[\d+px\]/);
    expect(quoteFormSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('SupplierInquiryPanel C9 询价比价撤回（Compared → Open）', () => {
  it('已比价状态操作区有「撤回比价」按钮（Undo2 图标 + loading 态）', () => {
    expect(source).toContain('handleRevertComparison(inquiry.id)');
    expect(source).toContain('<span>撤回比价</span>');
    expect(source).toContain('revert_${inquiry.id}');
  });

  it('撤回走后端状态机：updateSupplierInquiry 携带 status=Open（Compared → Open 撤回分支）', () => {
    expect(source).toContain("apiService.updateSupplierInquiry(inquiryId, { status: 'Open' } as any)");
    // 撤回结果局部刷新列表
    expect(source).toContain('updateInquiryInList(updated)');
  });
});

describe('SupplierInquiryPanel C7 询价一键转采购单', () => {
  it('面板声明 onConvertToPurchaseOrder 可选 prop（宿主 ProcurementManager 提供跳转）', () => {
    expect(source).toContain('onConvertToPurchaseOrder?: (draft: SupplierInquiryConvertDraft) => void');
    expect(source).toContain('export interface SupplierInquiryConvertDraft');
  });

  it('已比价状态操作区有「转采购单」按钮（仅宿主提供 prop 时展示）', () => {
    expect(source).toContain('{onConvertToPurchaseOrder && (');
    expect(source).toContain('handleConvert(inquiry)');
    expect(source).toContain('<span>转采购单</span>');
  });

  it('预填草稿：中选报价供应商/条款 + 询价单币种/行明细（品名/物料编码/数量/单位）', () => {
    expect(source).toContain('quotes.find(q => q.isSelected)');
    expect(source).toContain('supplierRelationId: inquiry.selectedSupplierId ?? selectedQuote?.supplierId');
    expect(source).toContain('deliveryTerms: selectedQuote?.deliveryTerms');
    expect(source).toContain('paymentTerms: selectedQuote?.paymentTerms');
    expect(source).toContain('description: inquiry.description');
    expect(source).toContain('quantity: inquiry.quantity');
  });
});
