/**
 * P1-4 物料退换货 — 前端契约测试
 *
 * 覆盖：
 *   1. apiService 契约（fetch mock）：退换货列表 GET / 登记 POST body / 状态推进四端点
 *   2. ProcurementManager 源码契约：退换入口按钮（不合格来料）/ 退换货记录动作簇 /
 *      登记表单（类型 chips + 校验）/ 展开加载
 *   3. 路由源码契约：/material-returns 六端点且字面路由先于 /:id 参数路由
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiService } from '../services/apiService';

const ENDPOINT = 'https://test.example.com';
const pmSource = readFileSync(new URL('./ProcurementManager.tsx', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../server/src/procurement/procurementRoute.ts', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

describe('apiService P1-4 退换货契约（fetch mock）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('listMaterialReturns GET 过滤参数（purchaseOrderId 透传）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ ok: true, items: [{ id: 'MATRET_1', returnNumber: 'RT-2026-0001', type: 'return', status: 'pending', quantity: 100 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await apiService.listMaterialReturns({ purchaseOrderId: 'PO-1', status: 'pending' }, ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/procurement/material-returns?purchaseOrderId=PO-1&status=pending');
    expect(items).toHaveLength(1);
    expect(items[0].returnNumber).toBe('RT-2026-0001');
  });

  it('createMaterialReturn POST body（type/quantity/amount 契约）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ ok: true, materialReturn: { id: 'MATRET_2', returnNumber: 'RT-2026-0002', status: 'pending' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const row = await apiService.createMaterialReturn({
      receiptId: 'MR-1', type: 'claim', quantity: 0, amount: 200, currency: 'USD', reason: '索赔 200 USD',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/procurement/material-returns');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      receiptId: 'MR-1', type: 'claim', quantity: 0, amount: 200, currency: 'USD', reason: '索赔 200 USD',
    });
    expect(row.returnNumber).toBe('RT-2026-0002');
  });

  it('状态推进四端点（mark-shipped 返回 skipStockReason；confirm 返回 claimInvoiceId）', async () => {
    const fetchMock = vi.fn(async (url: string, ..._rest: any[]) => ({
      ok: true,
      json: async () => String(url).includes('mark-shipped')
        ? { ok: true, materialReturn: { id: 'R1', status: 'shipped' }, skipStockReason: '物料 X 无在库库存项' }
        : String(url).includes('confirm')
          ? { ok: true, materialReturn: { id: 'R1', status: 'confirmed' }, claimInvoiceId: 'INV_CLM' }
          : { ok: true, materialReturn: { id: 'R1' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const shipped = await apiService.markMaterialReturnShipped('R1', ENDPOINT);
    expect(shipped.skipStockReason).toContain('无在库库存项');
    expect(shipped.materialReturn.status).toBe('shipped');

    const confirmed = await apiService.confirmMaterialReturn('R1', ENDPOINT);
    expect(confirmed.claimInvoiceId).toBe('INV_CLM');

    await apiService.settleMaterialReturn('R1', ENDPOINT);
    expect(fetchMock.mock.calls[2][0]).toContain('/material-returns/R1/settle');
    await apiService.cancelMaterialReturn('R1', ENDPOINT);
    expect(fetchMock.mock.calls[3][0]).toContain('/material-returns/R1/cancel');
  });
});

describe('ProcurementManager P1-4（源码契约）', () => {
  it('退换入口：不合格来料行显示「退换/索赔」按钮（数量预填不合格量 + 原因快照）', () => {
    expect(pmSource).toContain('Number(rc.totalRejected) > 0 && (');
    expect(pmSource).toContain('退换/索赔');
    expect(pmSource).toContain('quantity: String(Number(rc.totalRejected))');
    expect(pmSource).toContain('reason: rc.rejectionReason ?? \'\'');
  });

  it('登记表单：类型 chips（退货/换货/索赔）+ claim 必填金额校验 + 展开加载', () => {
    expect(pmSource).toContain("(['return', 'exchange', 'claim'] as const).map(t =>");
    expect(pmSource).toContain('索赔必须填写索赔金额（正数）');
    expect(pmSource).toContain('退货物料编码（库存联动锚点）');
    expect(pmSource).toContain('fetchMaterialReturns(poId)');
  });

  it('退换货记录动作簇：发运确认/供应商确认/结算/取消 + 索赔贷项标识', () => {
    expect(pmSource).toContain('退换货 / 索赔');
    expect(pmSource).toContain("handleReturnAction(po.id, ret, 'mark-shipped')");
    expect(pmSource).toContain("handleReturnAction(po.id, ret, 'confirm')");
    expect(pmSource).toContain("handleReturnAction(po.id, ret, 'settle')");
    expect(pmSource).toContain("handleReturnAction(po.id, ret, 'cancel')");
    expect(pmSource).toContain('索赔贷项已生成');
    expect(pmSource).toContain('MATERIAL_RETURN_STATUS_LABELS[ret.status]');
  });
});

describe('路由 P1-4（源码契约）', () => {
  it('/material-returns 六端点注册（字面路由先于 /:id 参数路由）', () => {
    expect(routeSource).toContain("import { createMaterialReturnService } from './materialReturnService'");
    expect(routeSource).toContain("router.get('/material-returns'");
    expect(routeSource).toContain("router.post('/material-returns'");
    expect(routeSource).toContain("router.post('/material-returns/:id/mark-shipped'");
    expect(routeSource).toContain("router.post('/material-returns/:id/confirm'");
    expect(routeSource).toContain("router.post('/material-returns/:id/settle'");
    expect(routeSource).toContain("router.post('/material-returns/:id/cancel'");
    // 字面路由在参数路由之前（material-returns < /:id 注册位置）
    expect(routeSource.indexOf("'/material-returns'")).toBeLessThan(routeSource.indexOf("router.get('/:id'"));
  });
});
