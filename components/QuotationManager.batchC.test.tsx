import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./QuotationManager.tsx', import.meta.url), 'utf8');

describe('C14 报价砍价修订改价入口（草稿状态编辑按钮）', () => {
  it('草稿状态操作簇提供「编辑」按钮（openEditForm 打开表单）', () => {
    expect(source).toContain('onClick={() => openEditForm(qt)}');
    expect(source).toContain('<span>编辑</span>');
  });

  it('openEditForm 回填头字段与行明细（editingQuotationId 标记编辑态）', () => {
    expect(source).toContain('setEditingQuotationId(qt.id)');
    expect(source).toContain('quotationNumber: qt.quotationNumber ||');
    expect(source).toContain('validUntil: qt.validUntil ||');
    expect(source).toContain('notes: qt.notes ||');
    expect(source).toContain('unitPrice: l.unitPrice != null ? String(l.unitPrice) :');
  });

  it('编辑态提交走 updateQuotation（editingQuotationId 优先于 MOQ 草稿复判），不重复建单', () => {
    expect(source).toContain('const updateTargetId = editingQuotationId || moqDraftId;');
    expect(source).toContain('await apiService.updateQuotation(updateTargetId, input)');
    expect(source).toContain('await apiService.createQuotation(input)');
  });

  it('表单标题/提交按钮随编辑态切换；关闭与保存成功后重置编辑态', () => {
    expect(source).toContain("{editingQuotationId ? '编辑报价单' : '新建报价单'}");
    expect(source).toContain("{editingQuotationId || moqDraftId ? '保存修改' : '创建报价单'}");
    expect(source).toContain('setEditingQuotationId(null)');
  });
});

describe('C16 报价转订单补充信息弹窗（PO 号/工厂/交期/订单类型）', () => {
  it('「转为订单」按钮改为打开弹窗（openConvertModal），不再直接调转换端点', () => {
    expect(source).toContain('onClick={() => openConvertModal(qt)}');
    expect(source).not.toContain("handleAction(qt.id, 'convert')");
  });

  it('弹窗表单收集四字段：PO 号 / 工厂 / 交期 / 订单类型（BDS modal 范式）', () => {
    expect(source).toContain('bds-modal-mask');
    expect(source).toContain('>PO 号</label>');
    expect(source).toContain('>工厂</label>');
    expect(source).toContain('>交期</label>');
    expect(source).toContain('>订单类型</label>');
    expect(source).toContain('<CustomSelect');
    expect(source).toContain("{ value: 'Fabric', label: '面料订单' }");
    expect(source).toContain("{ value: 'Garment', label: '成衣订单' }");
  });

  it('确认后携带 overrides 调 convertQuotationToOrder（poNumber/millName/dueDate/type）', () => {
    expect(source).toContain('await apiService.convertQuotationToOrder(id, {');
    expect(source).toContain('poNumber: convertForm.poNumber.trim() || undefined');
    expect(source).toContain('millName: convertForm.millName.trim() || undefined');
    expect(source).toContain('dueDate: convertForm.dueDate || undefined');
    expect(source).toContain('type: convertForm.type || undefined');
  });

  it('打开弹窗时预填报价号与有效期（PO 号默认沿用报价号）', () => {
    expect(source).toContain('poNumber: qt.quotationNumber ||');
    expect(source).toContain('dueDate: qt.validUntil ||');
  });
});

describe('C17 报价备注输入框（新建/编辑表单）', () => {
  it('基本信息卡含备注 textarea（BDS 语义类，无硬编码样式）', () => {
    expect(source).toContain('>备注</label>');
    expect(source).toContain('value={form.notes}');
    expect(source).toContain('bds-input bds-textarea resize-none min-h-20');
  });

  it('备注随创建/编辑提交后端 notes 字段', () => {
    expect(source).toContain('notes: form.notes || undefined');
  });
});
