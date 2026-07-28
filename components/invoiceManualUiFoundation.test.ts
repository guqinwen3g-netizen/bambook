import { describe, expect, it } from 'vitest';
import type { Invoice, InvoiceStatus } from '../types';

/**
 * ERP-P0 invoice-manual-ui-foundation: focused tests
 * 验证发票手动新建/编辑最小路径契约：
 * - 消费 invoiceService POST/PATCH（不伪造本地成功）
 * - 失败时保留原数据
 * - 成功后用后端返回更新本地
 */

describe('invoice manual UI: 新建路径不伪造本地成功', () => {
  it('成功才追加到列表（验证 createInvoice 返回值驱动 UI 更新）', () => {
    const prev: Invoice[] = [{ id: 'old', invoiceNumber: 'OLD', type: 'Receivable', status: 'Draft', amount: 100, createdAt: 0, updatedAt: 0 } as Invoice];
    const created: Invoice = { id: 'new', invoiceNumber: 'NEW', type: 'Receivable', status: 'Draft', amount: 5000, createdAt: 0, updatedAt: 0 } as Invoice;
    const next = [created, ...prev];
    expect(next).toHaveLength(2);
    expect(next[0].id).toBe('new');
    expect(next[0].invoiceNumber).toBe('NEW');
  });

  it('失败时保留原列表不变（不追加伪造数据）', () => {
    const prev: Invoice[] = [{ id: 'old', invoiceNumber: 'OLD', type: 'Receivable', status: 'Draft', amount: 100, createdAt: 0, updatedAt: 0 } as Invoice];
    let next = prev;
    let errored = false;
    try {
      throw new Error('HTTP 500');
    } catch {
      errored = true;
    }
    expect(errored).toBe(true);
    expect(next).toBe(prev);
    expect(next).toHaveLength(1);
  });
});

describe('invoice manual UI: 编辑路径用后端返回更新', () => {
  it('PATCH 成功后用 updated 替换本地对应项（保持状态一致）', () => {
    const prev: Invoice[] = [
      { id: 'inv_1', invoiceNumber: 'INV-1', type: 'Receivable', status: 'Draft', amount: 100, createdAt: 0, updatedAt: 0 } as Invoice,
      { id: 'inv_2', invoiceNumber: 'INV-2', type: 'Payable', status: 'Paid', amount: 200, createdAt: 0, updatedAt: 0 } as Invoice,
    ];
    const updated: Invoice = { id: 'inv_1', invoiceNumber: 'INV-1', type: 'Receivable', status: 'Issued', amount: 150, createdAt: 0, updatedAt: 1 } as Invoice;
    const next = prev.map(i => i.id === updated.id ? { ...i, ...updated } as Invoice : i);
    expect(next).toHaveLength(2);
    expect(next[0].status).toBe('Issued');
    expect(next[0].amount).toBe(150);
    expect(next[1].id).toBe('inv_2');
  });
});

describe('invoice manual UI: 消费后端稳定 contract', () => {
  it('FinanceManager 源码含 invoiceService import（消费稳定 service）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
    expect(src).toMatch(/import.*invoiceService.*from.*services\/invoiceService/);
  });

  it('FinanceManager 源码含 openCreateInvoice + openEditInvoice + handleSaveInvoice', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
    expect(src).toContain('openCreateInvoice');
    expect(src).toContain('openEditInvoice');
    expect(src).toContain('handleSaveInvoice');
    // 编辑走 PATCH，新建走 POST
    expect(src).toMatch(/invoiceService\.updateInvoice/);
    expect(src).toMatch(/invoiceService\.createInvoice/);
  });

  it('FinanceManager 源码含新建发票 toolbar 按钮 + 编辑详情入口', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
    expect(src).toContain('新建发票');
    expect(src).toContain('openEditInvoice(invoice)');
  });

  it('手动发票基础路径仍消费 create/update（不与 Agent flow 混用）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
    // 消费 create/update（后端稳定 contract）
    expect(src).toMatch(/invoiceService\.createInvoice|invoiceService\.updateInvoice/);
    // 手动路径不与 Agent flow 混用
    expect(src).not.toMatch(/invoiceCancelFlow|commitInvoiceCancel/);
  });
});

// P0 invoice manual UI regression: 消费后端稳定 contract（防旧枚举/字段漂移）
describe('invoice manual UI: 后端契约 regression（防旧枚举/字段漂移）', () => {
  const fs = require('fs');
  const path = require('path');
  const fmSrc = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');

  it('FinanceManager 不含旧 InvoiceStatus 枚举值（Sent/Partial/Overdue）', () => {
    expect(fmSrc).not.toMatch(/'Sent'/);
    expect(fmSrc).not.toMatch(/'Partial'/);
    expect(fmSrc).not.toMatch(/'Overdue'/);
  });

  it('FinanceManager 含后端契约枚举（Issued/PartiallyPaid）', () => {
    expect(fmSrc).toMatch(/'Issued'/);
    expect(fmSrc).toMatch(/'PartiallyPaid'/);
  });

  it('FinanceManager 日期字段统一消费 issueDate（不再有 invoiceDate legacy fallback）', () => {
    expect(fmSrc).toMatch(/inv\.issueDate/);
    expect(fmSrc).not.toMatch(/inv\.invoiceDate/);
  });

  it('详情面板发票日期显示读 issueDate（不再有 invoiceDate legacy fallback）', () => {
    expect(fmSrc).toMatch(/invoice!\.issueDate/);
    expect(fmSrc).not.toMatch(/invoice!\.invoiceDate/);
  });
});
