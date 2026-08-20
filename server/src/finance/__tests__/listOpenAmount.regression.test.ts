import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createFinanceRouter } from '../route';
import { authHeader } from '../../__tests__/authTestHelper';

/**
 * P1-005 回归：发票/凭证列表端点必须附 DR-044 净额派生字段
 *   appliedAmount = Σ InvoiceAllocation.appliedAmount（真源汇总，非快照）
 *   openAmount = 单据金额 − appliedAmount
 * 验收锚点：Peerless $84,000 PartiallyPaid 已核销 $50,000 →
 *   账龄/对账单/KPI 交叉一致（openAmount = $34,000）。
 */
function makeApp(allocations: any[], invoices: any[], vouchers: any[]) {
  const prisma = {
    invoice: {
      findMany: vi.fn().mockResolvedValue(invoices),
      count: vi.fn().mockResolvedValue(invoices.length),
    },
    paymentVoucher: {
      findMany: vi.fn().mockResolvedValue(vouchers),
      count: vi.fn().mockResolvedValue(vouchers.length),
    },
    invoiceAllocation: {
      groupBy: vi.fn().mockResolvedValue(
        allocations.map((a) => ({
          invoiceId: a.invoiceId,
          voucherId: a.voucherId,
          _sum: { appliedAmount: a.appliedAmount },
        })),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(),
  } as any;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/finance', createFinanceRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange: vi.fn() }));
  return { app, prisma };
}

describe('P1-005 列表端点 DR-044 净额派生字段', () => {
  it('发票列表：PartiallyPaid $84,000 已核销 $50,000 → openAmount $34,000（对账单口径一致）', async () => {
    const { app } = makeApp(
      [{ invoiceId: 'INV-PRL', voucherId: 'PAY-1', appliedAmount: new Prisma.Decimal('50000.0000') }],
      [{ id: 'INV-PRL', invoiceNumber: 'INV-2026-PRL-0320', type: 'Receivable', status: 'PartiallyPaid', amount: new Prisma.Decimal('84000.0000'), currency: 'USD', deletedAt: null }],
      [],
    );
    const res = await request(app).get('/api/v1/finance').set(authHeader());
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.appliedAmount).toBe(50000);
    expect(item.openAmount).toBe(34000);
    expect(typeof item.amount).toBe('number'); // Decimal 序列化为 number
  });

  it('发票列表：无核销记录 → appliedAmount 0 / openAmount = 全额', async () => {
    const { app } = makeApp(
      [],
      [{ id: 'INV-ATL', invoiceNumber: 'INV-2026-ATL-0318', type: 'Receivable', status: 'Issued', amount: new Prisma.Decimal('38850.0000'), currency: 'USD', deletedAt: null }],
      [],
    );
    const res = await request(app).get('/api/v1/finance').set(authHeader());
    expect(res.body.items[0].appliedAmount).toBe(0);
    expect(res.body.items[0].openAmount).toBe(38850);
  });

  it('凭证列表：附 voucher 维度 openAmount（DR-044 凭证侧镜像）', async () => {
    const { app } = makeApp(
      [{ invoiceId: 'INV-1', voucherId: 'PAY-1', appliedAmount: new Prisma.Decimal('21600.0000') }],
      [],
      [{ id: 'PAY-1', voucherNumber: 'PAY-2026-NRD-0228', type: 'Receipt', status: 'reconciled', amount: new Prisma.Decimal('21600.0000'), currency: 'USD', deletedAt: null }],
    );
    const res = await request(app).get('/api/v1/finance/vouchers').set(authHeader());
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.appliedAmount).toBe(21600);
    expect(item.openAmount).toBe(0);
  });

  it('凭证列表：空结果不触发 groupBy（items 为空短路）', async () => {
    const { app, prisma } = makeApp([], [], []);
    const res = await request(app).get('/api/v1/finance/vouchers').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(prisma.invoiceAllocation.groupBy).not.toHaveBeenCalled();
  });
});
