import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const FINANCE_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
const SHIPMENT_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf-8');
const DEV_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'DevelopmentManager.tsx'), 'utf-8');
const RELATIONS_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'RelationsManager.tsx'), 'utf-8');
const ALLOC_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/allocationService.ts'), 'utf-8');
const INV_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/invoiceService.ts'), 'utf-8');
const SHIP_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/shipmentService.ts'), 'utf-8');
const DEV_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/developmentService.ts'), 'utf-8');

/**
 * ERP-P1-frontend-operator-flow-smoke
 * 覆盖 5 个前端操作流，对每个流断言：service 调用 / success 后列表更新 / failure 显示错误不伪成功 / busy/disabled 防重复 / 不调 Agent commit
 *
 * 选择理由：① Finance allocation（资金核销，最易 Decimal/status 漂移）② Finance invoice（发票 create/update + 校验）
 * ③ Shipping create/update/delete（运单完整流）④ Development create/update/delete（开发单完整流）⑤ Relations save/delete（最近补 wiring 的）
 */

// ═══ Flow 1: Finance allocation（核销）═══
describe('operator flow smoke [Finance allocation]', () => {
  it('service 调用: allocationService.createAllocation + updateAllocation', () => {
    expect(FINANCE_MGR_SRC).toContain('allocationService.createAllocation');
    expect(FINANCE_MGR_SRC).toContain('allocationService.updateAllocation');
  });
  it('success 后列表更新: applyRecalcResult + result.allocation', () => {
    expect(FINANCE_MGR_SRC).toContain('applyRecalcResult');
    expect(FINANCE_MGR_SRC).toContain('result.allocation');
  });
  it('failure 显示错误: catch + setAllocError', () => {
    expect(FINANCE_MGR_SRC).toContain('setAllocError');
    expect(FINANCE_MGR_SRC).toContain('核销失败');
  });
  it('mutationOk flag 防伪成功: refresh 独立 try/catch', () => {
    expect(FINANCE_MGR_SRC).toContain('mutationOk');
  });
  it('busy/guard 防重复: allocSaving state + if (allocSaving) return', () => {
    expect(FINANCE_MGR_SRC).toContain('allocSaving');
    expect(FINANCE_MGR_SRC).toContain('if (allocSaving) return');
  });
  it('不调 Agent commit function', () => {
    expect(FINANCE_MGR_SRC).not.toContain('commitPaymentReconcile');
    expect(FINANCE_MGR_SRC).not.toContain('reconcileFlow');
  });
});

// ═══ Flow 2: Finance invoice（发票 create/update）═══
describe('operator flow smoke [Finance invoice]', () => {
  it('service 调用: invoiceService.createInvoice + updateInvoice', () => {
    expect(FINANCE_MGR_SRC).toContain('invoiceService.createInvoice');
    expect(FINANCE_MGR_SRC).toContain('invoiceService.updateInvoice');
  });
  it('success 后列表更新: setInvoices(prev => [created | map])', () => {
    expect(FINANCE_MGR_SRC).toContain('setInvoices(prev => [created');
    expect(FINANCE_MGR_SRC).toContain('setInvoices(prev => prev.map');
  });
  it('failure 显示错误: catch + setInvoiceError', () => {
    expect(FINANCE_MGR_SRC).toContain('setInvoiceError');
    expect(FINANCE_MGR_SRC).toContain('保存失败');
  });
  it('前端校验: 发票号和金额必填', () => {
    expect(FINANCE_MGR_SRC).toContain('发票号和金额为必填项');
  });
  it('busy/guard 防重复: invoiceSaving state + if (invoiceSaving) return', () => {
    expect(FINANCE_MGR_SRC).toContain('invoiceSaving');
    expect(FINANCE_MGR_SRC).toContain('if (invoiceSaving) return');
  });
  it('不调 Agent commit function', () => {
    expect(FINANCE_MGR_SRC).not.toContain('commitInvoiceCreate');
    expect(FINANCE_MGR_SRC).not.toContain('invoiceMutationFlow');
  });
});

// ═══ Flow 3: Shipping create/update/delete ═══
describe('operator flow smoke [Shipping create/update/delete]', () => {
  it('service 调用: shipmentService.createShipment + updateShipment + deleteShipment', () => {
    expect(SHIPMENT_MGR_SRC).toContain('shipmentService.createShipment');
    expect(SHIPMENT_MGR_SRC).toContain('shipmentService.updateShipment');
    expect(SHIPMENT_MGR_SRC).toContain('shipmentService.deleteShipment');
  });
  it('success 后列表更新: setShipments persisted + map/spread', () => {
    expect(SHIPMENT_MGR_SRC).toContain('const persisted');
    expect(SHIPMENT_MGR_SRC).toContain('setShipments(prev => prev.map');
    expect(SHIPMENT_MGR_SRC).toContain('setShipments(prev => [persisted');
  });
  it('failure 显示错误: catch + setErrorMessage', () => {
    expect(SHIPMENT_MGR_SRC).toContain('catch');
    expect(SHIPMENT_MGR_SRC).toContain('setErrorMessage');
  });
  it('前端校验: 运单号必填', () => {
    expect(SHIPMENT_MGR_SRC).toContain('请填写运单号');
  });
  it('busy/guard 防重复: isSaving state + if (isSaving) return + disabled={isSaving}', () => {
    expect(SHIPMENT_MGR_SRC).toContain('isSaving');
    expect(SHIPMENT_MGR_SRC).toContain('if (isSaving) return');
    expect(SHIPMENT_MGR_SRC).toContain('disabled={isSaving}');
  });
  it('delete busy/guard 防重复: deletingId state + if (deletingId) return + finally + disabled', () => {
    expect(SHIPMENT_MGR_SRC).toContain('deletingId');
    expect(SHIPMENT_MGR_SRC).toContain('if (deletingId) return');
    expect(SHIPMENT_MGR_SRC).toContain('setDeletingId(null)');
    expect(SHIPMENT_MGR_SRC).toContain('disabled={deletingId !== null}');
  });
  it('不调 Agent commit function', () => {
    expect(SHIPMENT_MGR_SRC).not.toContain('commitOrderShip');
    expect(SHIPMENT_MGR_SRC).not.toContain('orderShipFlow');
  });
});

// ═══ Flow 4: Development create/update/delete ═══
describe('operator flow smoke [Development create/update/delete]', () => {
  it('service 调用: developmentService.createDevelopmentCase + updateDevelopmentCase + deleteDevelopmentCase', () => {
    expect(DEV_MGR_SRC).toContain('developmentService.createDevelopmentCase');
    expect(DEV_MGR_SRC).toContain('developmentService.updateDevelopmentCase');
    expect(DEV_MGR_SRC).toContain('developmentService.deleteDevelopmentCase');
  });
  it('success 后列表更新: setCases map/spread/filter', () => {
    expect(DEV_MGR_SRC).toContain('setCases(prev => prev.map');
    expect(DEV_MGR_SRC).toContain('setCases(prev => [created');
    expect(DEV_MGR_SRC).toContain('setCases(prev => prev.filter');
  });
  it('failure 显示错误: catch + alert（删除）', () => {
    expect(DEV_MGR_SRC).toContain('删除失败');
  });
  it('busy/guard 防重复: isSubmitting state + if (isSubmitting) return + disabled', () => {
    expect(DEV_MGR_SRC).toContain('isSubmitting');
    expect(DEV_MGR_SRC).toContain('if (isSubmitting) return');
    expect(DEV_MGR_SRC).toContain('disabled={isSubmitting');
  });
  it('handleFormSubmit useCallback deps 含 isSubmitting（guard 可靠，不捕获 stale false）', () => {
    expect(DEV_MGR_SRC).toContain('closeFormModal, isSubmitting]);');
  });
  it('不调 Agent commit function', () => {
    expect(DEV_MGR_SRC).not.toContain('commitDevelopment');
  });
});

// ═══ Flow 5: Relations save/delete（最近补 wiring 的）═══
describe('operator flow smoke [Relations save/delete]', () => {
  it('service 调用: apiService.saveRelation + updateRelation + deleteRelation', () => {
    expect(RELATIONS_MGR_SRC).toContain('apiService.saveRelation');
    expect(RELATIONS_MGR_SRC).toContain('apiService.updateRelation');
    expect(RELATIONS_MGR_SRC).toContain('apiService.deleteRelation');
  });
  it('success 后列表更新: persisted / deletedRelation.id filter', () => {
    expect(RELATIONS_MGR_SRC).toContain('const persisted');
    expect(RELATIONS_MGR_SRC).toContain('deletedRelation.id');
  });
  it('failure 显示错误: catch + setRelationSaveError', () => {
    expect(RELATIONS_MGR_SRC).toContain('setRelationSaveError');
    expect(RELATIONS_MGR_SRC).toContain('保存失败');
  });
  it('busy/disabled 防重复: if (relationBusy) return + disabled={relationBusy}', () => {
    expect(RELATIONS_MGR_SRC).toContain('if (relationBusy) return');
    expect(RELATIONS_MGR_SRC).toContain('disabled={relationBusy}');
  });
  it('不调 Agent commit function', () => {
    expect(RELATIONS_MGR_SRC).not.toContain('commitRelationUpdate');
    expect(RELATIONS_MGR_SRC).not.toContain('commitRelationDelete');
  });
});

// ═══ Cross-flow: service 层 method 覆盖 ═══
describe('operator flow smoke [service 层 method 覆盖]', () => {
  it('allocationService: createAllocation + updateAllocation + deleteAllocation', () => {
    expect(ALLOC_SVC_SRC).toContain('async createAllocation');
    expect(ALLOC_SVC_SRC).toContain('async updateAllocation');
    expect(ALLOC_SVC_SRC).toContain('async deleteAllocation');
  });
  it('invoiceService: createInvoice + updateInvoice', () => {
    expect(INV_SVC_SRC).toContain('async createInvoice');
    expect(INV_SVC_SRC).toContain('async updateInvoice');
  });
  it('shipmentService: createShipment + updateShipment + deleteShipment', () => {
    expect(SHIP_SVC_SRC).toContain('async createShipment');
    expect(SHIP_SVC_SRC).toContain('async updateShipment');
    expect(SHIP_SVC_SRC).toContain('async deleteShipment');
  });
  it('developmentService: createDevelopmentCase + updateDevelopmentCase + deleteDevelopmentCase', () => {
    expect(DEV_SVC_SRC).toContain('async createDevelopmentCase');
    expect(DEV_SVC_SRC).toContain('async updateDevelopmentCase');
    expect(DEV_SVC_SRC).toContain('async deleteDevelopmentCase');
  });
  it('所有 service 失败 throw Error（不静默吞错误）', () => {
    expect(ALLOC_SVC_SRC).toContain('throw new Error');
    expect(INV_SVC_SRC).toContain('throw new Error');
    expect(SHIP_SVC_SRC).toContain('throw new Error');
    expect(DEV_SVC_SRC).toContain('throw new Error');
  });
});
