/**
 * 批次 C/D 供应商+采购车道 — ProcurementManager 前端契约测试
 *
 * 覆盖：
 *   C7 询价一键转采购单（宿主侧）：onConvertToPurchaseOrder 接线 + 预填表单 + 切视图
 *   D5 采购收货仓库手填生效：收货表单仓库字段 = 仓库列表下拉（warehouseId + 名称快照提交）
 *   D6 采购收货行级明细：收货表单按采购行逐行填本次合格/不合格，
 *      行级为真源派生单头合计并提交 lineReceipts（后端按明细精确回写）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ProcurementManager.tsx', import.meta.url), 'utf8');

describe('ProcurementManager C7 询价一键转采购单（宿主接线）', () => {
  it('SupplierInquiryPanel 注入 onConvertToPurchaseOrder', () => {
    expect(source).toContain('onConvertToPurchaseOrder={handleConvertInquiry}');
    expect(source).toContain("import SupplierInquiryPanel, { SupplierInquiryConvertDraft } from './SupplierInquiryPanel'");
  });

  it('预填：供应商/币种/条款/行明细 + 关联询价备注，切回采购单视图并打开新建表单', () => {
    expect(source).toContain('supplierRelationId: draft.supplierRelationId');
    expect(source).toContain('currency: draft.currency || prev.currency');
    expect(source).toContain('deliveryTerms: draft.deliveryTerms || prev.deliveryTerms');
    expect(source).toContain('paymentTerms: draft.paymentTerms || prev.paymentTerms');
    expect(source).toContain('来自询价单 ${draft.inquiryNumber}');
    expect(source).toContain('description: draft.line.description');
    expect(source).toContain("setViewMode('orders')");
    expect(source).toContain('setShowCreateForm(true)');
  });
});

describe('ProcurementManager D5 收货仓库手填生效', () => {
  it('挂载时拉取仓库列表作为下拉数据源', () => {
    expect(source).toContain('apiService.listWarehouses().then(setWarehouses)');
    expect(source).toContain('useState<Warehouse[]>([])');
  });

  it('收货表单仓库字段为 bds-select 下拉（不再手打文本），提交 warehouseId + 名称快照', () => {
    expect(source).toContain('value={receiptForm.warehouseId}');
    expect(source).toContain('className="bds-select sm"');
    expect(source).toContain('<option value="">入库仓库（默认主仓）</option>');
    expect(source).toContain('warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)');
    // 手打仓库名输入框已移除
    expect(source).not.toContain('receiptForm.warehouseName');
    // 提交载荷：warehouseId + warehouseName（后端落库并随 MaterialReceived 事件透传）
    expect(source).toContain('warehouseId: warehouse?.id || undefined');
    expect(source).toContain('warehouseName: warehouse?.name || undefined');
  });
});

describe('ProcurementManager D6 采购收货行级明细', () => {
  it('打开收货表单时按采购行初始化行级输入态', () => {
    expect(source).toContain("setReceiptLines(Object.fromEntries((po.lines ?? []).map(l => [l.id, { accepted: '', rejected: '' }])))");
  });

  it('收货表单含行级明细区：每行填本次合格/本次不合格（bds-input sm）', () => {
    expect(source).toContain('行级收货明细（本次合格 / 本次不合格）');
    expect(source).toContain("(po.lines ?? []).map(line => {");
    expect(source).toContain('placeholder="本次合格"');
    expect(source).toContain('placeholder="本次不合格"');
    expect(source).toContain('setReceiptLines(prev => ({ ...prev, [line.id]: { ...draft, accepted: e.target.value } }))');
  });

  it('行级为真源：合计由行级累加派生并展示，提交 lineReceipts + 派生总数', () => {
    expect(source).toContain('const receiptTotals = useMemo');
    expect(source).toContain('合计：合格');
    expect(source).toContain('lineReceipts.push({ lineId: line.id, accepted: acc, rejected: rej })');
    expect(source).toContain('const totalAccepted = lineReceipts.reduce((s, l) => s + l.accepted, 0)');
    expect(source).toContain('const totalRejected = lineReceipts.reduce((s, l) => s + l.rejected, 0)');
    expect(source).toContain('lineReceipts,');
  });

  it('校验：至少一行有数量；行数量非法拦截', () => {
    expect(source).toContain("请至少填写一行的本次收货数量");
    expect(source).toContain('收货数量非法（须为非负数字）');
  });

  it('BDS 设计纪律：收货表单段无硬编码 hex/rounded-[Npx]', () => {
    const receiptSection = source.slice(source.indexOf('登记来料检验'));
    expect(receiptSection).not.toMatch(/rounded-\[\d+px\]/);
    expect(receiptSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
