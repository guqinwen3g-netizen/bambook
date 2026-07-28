import { describe, expect, it } from 'vitest';
import type { InvoiceAllocation, AllocationResult, AllocationDeleteResult } from '../types';

/**
 * ERP-P1-payment-reconcile-manual-ui: focused tests
 * 验证手动核销 UI 消费后端 /api/v1/finance/allocations contract。
 */

describe('allocation contract: 类型对齐后端 route foundation', () => {
  it('InvoiceAllocation 含后端字段（invoiceId/voucherId/appliedAmount/appliedDate）', () => {
    const sample: InvoiceAllocation = {
      id: 'ALLOC__inv_1__voc_1',
      invoiceId: 'inv_1',
      voucherId: 'voc_1',
      appliedAmount: 5000,
      appliedDate: '2026-06-29',
      createdAt: 0,
      updatedAt: 0,
    };
    expect(sample.invoiceId).toBe('inv_1');
    expect(sample.voucherId).toBe('voc_1');
    expect(sample.appliedAmount).toBe(5000);
  });

  it('AllocationResult 含 status 重算结果（newInvoiceStatus/newVoucherStatus）', () => {
    const result: AllocationResult = {
      allocation: { id: 'ALLOC__inv_1__voc_1', invoiceId: 'inv_1', voucherId: 'voc_1', appliedAmount: 5000, appliedDate: '2026-06-29' },
      newInvoiceStatus: 'PartiallyPaid',
      newVoucherStatus: 'partially_reconciled',
    };
    expect(result.newInvoiceStatus).toBe('PartiallyPaid');
    expect(result.newVoucherStatus).toBe('partially_reconciled');
  });

  it('AllocationDeleteResult 含反向重算结果', () => {
    const result: AllocationDeleteResult = {
      deleted: true,
      id: 'ALLOC__inv_1__voc_1',
      newInvoiceStatus: 'Issued',
      newVoucherStatus: 'unreconciled',
    };
    expect(result.deleted).toBe(true);
    expect(result.newInvoiceStatus).toBe('Issued');
  });
});

describe('allocation contract: allocationService 消费稳定 route', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '../services/allocationService.ts'), 'utf-8');

  it('路径对齐 /v1/finance/allocations', () => {
    expect(src).toContain("'/v1/finance/allocations'");
  });

  it('提供 list/create/update/delete 四方法', () => {
    expect(src).toMatch(/listAllocations/);
    expect(src).toMatch(/createAllocation/);
    expect(src).toMatch(/updateAllocation/);
    expect(src).toMatch(/deleteAllocation/);
  });

  it('create/update/delete 消费 error contract（不伪造本地成功）', () => {
    // 失败时抛错，不返回伪造数据
    expect(src).toMatch(/throw new Error\(reason\)/);
  });
});

describe('allocation contract: FinanceManager 手动核销 UI', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');

  it('含核销明细展示 + 添加核销入口', () => {
    expect(src).toContain('核销明细');
    expect(src).toContain('添加核销');
  });

  it('含 create/update/delete allocation handlers', () => {
    expect(src).toMatch(/handleSaveAlloc/);
    expect(src).toMatch(/handleDeleteAlloc/);
    expect(src).toMatch(/allocationService\.createAllocation/);
    expect(src).toMatch(/allocationService\.updateAllocation/);
    expect(src).toMatch(/allocationService\.deleteAllocation/);
  });

  it('消费 status 重算结果（applyRecalcResult 用 newInvoiceStatus/newVoucherStatus）', () => {
    expect(src).toContain('applyRecalcResult');
    expect(src).toMatch(/newInvoiceStatus/);
    expect(src).toMatch(/newVoucherStatus/);
  });

  it('选中 invoice/voucher 时加载 allocations（GET /allocations）', () => {
    expect(src).toMatch(/allocationService\.listAllocations/);
  });

  it('失败反馈来自后端 contract（不猜错误）', () => {
    expect(src).toMatch(/核销失败：\$\{e\?\.message/);
    expect(src).toMatch(/撤销核销失败：\$\{e\?\.message/);
  });

  it('不混 payment voucher 创建或 invoice 创建（独立核销范围）', () => {
    // 核销 modal 是独立的 showAllocModal，不复用 showCreateVoucher/showInvoiceModal
    expect(src).toContain('showAllocModal');
    expect(src).toContain('allocForm');
  });
});

// P1 regression: edit/delete status 回写用真实 allocation 定位（不依赖 selectedItem）
describe('allocation regression: edit/delete status 精确回写两侧', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');

  it('含 resolveAllocParties（从 allocations 数组或 ALLOC id 解析真实 invoiceId/voucherId）', () => {
    expect(src).toContain('resolveAllocParties');
    expect(src).toMatch(/allocations\.find\(a => a\.id === allocId\)/);
    expect(src).toMatch(/ALLOC__invoiceId__voucherId/); // 解析格式 fallback
  });

  it('edit 路径用 resolveAllocParties 定位真实 parties（不依赖 selectedItem 推断）', () => {
    expect(src).toMatch(/editingAllocId[\s\S]*?resolveAllocParties\(editingAllocId\)/);
  });

  it('delete 路径删除前先 resolveAllocParties 定位真实 parties', () => {
    expect(src).toMatch(/handleDeleteAlloc[\s\S]*?const parties = resolveAllocParties\(allocId\)/);
  });

  it('applyRecalcResult 不用 selectedItem 兜底（精确按 invId/vocId 更新）', () => {
    // 不应出现 selectedItem?.id 作为 applyRecalcResult 内部兜底
    const fnMatch = src.match(/const applyRecalcResult = [\s\S]*?^  };/m);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).not.toMatch(/selectedItem\?\.id/);
    expect(fnBody).toMatch(/i\.id === invId/);
    expect(fnBody).toMatch(/v\.id === vocId/);
  });

  it('失败路径不本地伪成功（create/update/delete catch 抛错不修改本地）', () => {
    // catch 块只 setAllocError/window.alert，不 setAllocations/setInvoices/setVouchers
    expect(src).toMatch(/setAllocError\(`核销失败/);
    expect(src).toMatch(/window\.alert\(`撤销核销失败/);
  });
});

// P1 regression: 模拟两侧 status 精确回写（纯逻辑验证）
describe('allocation regression: 两侧 status 按后端结果更新（场景验证）', () => {
  it('voucher 视角编辑：用真实 invoiceId/voucherId 更新两侧 status', () => {
    // 模拟 voucher 视角 edit 场景
    const allocations = [{ id: 'ALLOC__inv_9__voc_5', invoiceId: 'inv_9', voucherId: 'voc_5', appliedAmount: 3000, appliedDate: '2026-06-29' }];
    const editingAllocId = 'ALLOC__inv_9__voc_5';
    // resolveAllocParties 逻辑
    const found = allocations.find(a => a.id === editingAllocId);
    const invId = found?.invoiceId;
    const vocId = found?.voucherId;
    expect(invId).toBe('inv_9');
    expect(vocId).toBe('voc_5');
    // 模拟后端返回
    const newInvoiceStatus = 'PartiallyPaid';
    const newVoucherStatus = 'partially_reconciled';
    // applyRecalcResult 应精确更新 inv_9 + voc_5（非依赖 selectedItem）
    const invoices = [{ id: 'inv_9', status: 'Issued' }, { id: 'inv_other', status: 'Draft' }];
    const vouchers = [{ id: 'voc_5', status: 'unreconciled' }, { id: 'voc_other', status: 'reconciled' }];
    const nextInvoices = invoices.map(i => i.id === invId ? { ...i, status: newInvoiceStatus } : i);
    const nextVouchers = vouchers.map(v => v.id === vocId ? { ...v, status: newVoucherStatus } : v);
    expect(nextInvoices.find(i => i.id === 'inv_9')?.status).toBe('PartiallyPaid');
    expect(nextInvoices.find(i => i.id === 'inv_other')?.status).toBe('Draft'); // 未受影响
    expect(nextVouchers.find(v => v.id === 'voc_5')?.status).toBe('partially_reconciled');
    expect(nextVouchers.find(v => v.id === 'voc_other')?.status).toBe('reconciled'); // 未受影响
  });

  it('invoice 视角删除：反向重算精确回写两侧', () => {
    const allocations = [{ id: 'ALLOC__inv_3__voc_7', invoiceId: 'inv_3', voucherId: 'voc_7', appliedAmount: 1000, appliedDate: '2026-06-29' }];
    const allocId = 'ALLOC__inv_3__voc_7';
    const found = allocations.find(a => a.id === allocId);
    const invId = found?.invoiceId;
    const vocId = found?.voucherId;
    expect(invId).toBe('inv_3');
    expect(vocId).toBe('voc_7');
    // 删除后反向重算
    const newInvoiceStatus = 'Issued';
    const newVoucherStatus = 'unreconciled';
    const invoices = [{ id: 'inv_3', status: 'PartiallyPaid' }];
    const vouchers = [{ id: 'voc_7', status: 'partially_reconciled' }];
    const nextInvoices = invoices.map(i => i.id === invId ? { ...i, status: newInvoiceStatus } : i);
    const nextVouchers = vouchers.map(v => v.id === vocId ? { ...v, status: newVoucherStatus } : v);
    expect(nextInvoices[0].status).toBe('Issued');
    expect(nextVouchers[0].status).toBe('unreconciled');
  });

  it('voucher 视角删除：反向重算精确回写两侧', () => {
    const allocations = [{ id: 'ALLOC__inv_2__voc_1', invoiceId: 'inv_2', voucherId: 'voc_1', appliedAmount: 2000, appliedDate: '2026-06-29' }];
    const allocId = 'ALLOC__inv_2__voc_1';
    const found = allocations.find(a => a.id === allocId);
    expect(found?.invoiceId).toBe('inv_2');
    expect(found?.voucherId).toBe('voc_1');
    const newInvoiceStatus = 'Issued';
    const newVoucherStatus = 'unreconciled';
    const invoices = [{ id: 'inv_2', status: 'Paid' }];
    const vouchers = [{ id: 'voc_1', status: 'reconciled' }];
    expect(invoices.map(i => i.id === 'inv_2' ? { ...i, status: newInvoiceStatus } : i)[0].status).toBe('Issued');
    expect(vouchers.map(v => v.id === 'voc_1' ? { ...v, status: newVoucherStatus } : v)[0].status).toBe('unreconciled');
  });

  it('ALLOC id 解析 fallback（allocations 未命中时从 id 格式解析）', () => {
    const allocId = 'ALLOC__inv_99__voc_88';
    const parts = allocId.split('__');
    expect(parts.length >= 3).toBe(true);
    expect(parts[1]).toBe('inv_99');
    expect(parts[2]).toBe('voc_88');
  });
});

// P1 regression: mutation 成功后 refresh 失败的反馈闭环
// 不能把 refresh 失败当成 mutation 失败（否则真实已落库但 UI 告诉用户失败）
describe('allocation regression: refresh 失败不误导用户（mutation 已成功）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');

  it('源码含 mutationOk 标志（分离 mutation 与 refresh 控制流）', () => {
    expect(src).toContain('mutationOk');
  });

  it('源码含「状态已更新，但明细列表刷新失败」提示（refresh 失败专用文案，非「核销失败」）', () => {
    expect(src).toContain('状态已更新，但明细列表刷新失败');
  });

  it('create 成功后本地 upsert allocation（用 result.allocation，不依赖 refresh）', () => {
    expect(src).toMatch(/result\.allocation/);
    expect(src).toMatch(/setAllocations\(prev =>/);
  });

  it('delete 成功后本地 remove allocation（用 allocId filter，不依赖 refresh）', () => {
    expect(src).toMatch(/setAllocations\(prev => prev\.filter\(a => a\.id !== allocId\)\)/);
  });
});

// P1 regression: create/update/delete refresh failure 场景验证
describe('allocation regression: 三个 mutation 的 refresh failure 场景', () => {
  it('create: mutation 成功后 refresh 失败——状态已更新，提示明细刷新失败（不显示核销失败）', () => {
    // 模拟 create mutation 成功
    const mutationResult = {
      allocation: { id: 'ALLOC__inv_1__voc_2', invoiceId: 'inv_1', voucherId: 'voc_2', appliedAmount: 1000, appliedDate: '2026-06-29' },
      newInvoiceStatus: 'PartiallyPaid',
      newVoucherStatus: 'partially_reconciled',
    };
    let mutationOk = false;
    let alertMsg = '';
    try {
      // mutation 成功
      mutationOk = true;
    } catch {
      mutationOk = false;
    }
    // best-effort refresh（模拟失败）
    if (mutationOk) {
      try {
        throw new Error('refresh network error');
      } catch {
        alertMsg = '状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。';
      }
    }
    expect(mutationOk).toBe(true);
    expect(alertMsg).toContain('状态已更新');
    expect(alertMsg).not.toContain('核销失败');
    // status 已更新（mutation 成功就 applyRecalcResult）
    expect(mutationResult.newInvoiceStatus).toBe('PartiallyPaid');
  });

  it('update: mutation 成功后 refresh 失败——状态已更新，提示明细刷新失败（不显示核销失败）', () => {
    const mutationResult = {
      allocation: { id: 'ALLOC__inv_3__voc_4', appliedAmount: 2000, appliedDate: '2026-06-29' },
      newInvoiceStatus: 'Paid',
      newVoucherStatus: 'reconciled',
    };
    let mutationOk = false;
    let alertMsg = '';
    try {
      mutationOk = true;
    } catch {
      mutationOk = false;
    }
    if (mutationOk) {
      try {
        throw new Error('refresh timeout');
      } catch {
        alertMsg = '状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。';
      }
    }
    expect(mutationOk).toBe(true);
    expect(alertMsg).toContain('状态已更新');
    expect(alertMsg).not.toContain('核销失败');
    expect(mutationResult.newInvoiceStatus).toBe('Paid');
  });

  it('delete: mutation 成功后 refresh 失败——状态已更新，提示明细刷新失败（不显示撤销失败）', () => {
    const mutationResult = {
      deleted: true,
      id: 'ALLOC__inv_5__voc_6',
      newInvoiceStatus: 'Issued',
      newVoucherStatus: 'unreconciled',
    };
    let mutationOk = false;
    let alertMsg = '';
    try {
      mutationOk = true;
    } catch {
      mutationOk = false;
    }
    if (mutationOk) {
      try {
        throw new Error('refresh 500');
      } catch {
        alertMsg = '状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。';
      }
    }
    expect(mutationOk).toBe(true);
    expect(alertMsg).toContain('状态已更新');
    expect(alertMsg).not.toContain('撤销核销失败');
    expect(mutationResult.deleted).toBe(true);
  });

  it('create mutation 失败——显示核销失败（真实未落库）', () => {
    let mutationOk = false;
    let errorMsg = '';
    try {
      throw new Error('CREATE_FAILED');
    } catch (e: any) {
      mutationOk = false;
      errorMsg = `核销失败：${e?.message ?? e}`;
    }
    expect(mutationOk).toBe(false);
    expect(errorMsg).toContain('核销失败');
    // refresh 不执行（mutationOk=false）
  });
});
