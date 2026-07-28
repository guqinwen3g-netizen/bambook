/**
 * ERP OS 横向 smoke pack (task_mr3e5odm)
 *
 * 覆盖 8+ 核心模块的 L1 route / L2 service 事实源（源码契约断言，不连 DB）。
 * 对 Finance/Shipping/Relations/Products/Development 断言 writeRouteAuditLog 或 $transaction/service reuse 边界。
 *
 * 分类口径：
 *   - ERP 独立能力：L1 route 独立可用（本测试覆盖）
 *   - Agent 能力：L3 Agent flow（不在本测试范围，不误写为 ERP 阻断）
 *   - 前端体验：L4 service（不在本测试范围）
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(rel: string): string {
  // __dirname = server/src/__tests__，rel 形如 'finance/route.ts'
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
}

const MODULES = {
  finance: {
    route: read('finance/route.ts'),
    invoiceSvc: read('finance/invoiceMutationService.ts'),
    allocationSvc: read('finance/allocationService.ts'),
    voidDeleteSvc: read('finance/voidDeleteService.ts'),
  },
  shipping: {
    route: read('shipping/route.ts'),
    svc: read('shipping/shipmentMutationService.ts'),
  },
  relations: {
    route: read('relations/route.ts'),
    svc: read('relations/relationMutationService.ts'),
  },
  products: {
    route: read('products/route.ts'),
    svc: read('products/productAssetMutationService.ts'),
  },
  orders: {
    route: read('orders/route.ts'),
    lifecycleSvc: read('orders/orderLifecycleService.ts'),
  },
  development: {
    route: read('development/route.ts'),
    svc: read('development/convertService.ts'),
  },
  email: {
    route: read('email/route.ts'),
  },
  import: {
    route: read('import/route.ts'),
  },
  entities: {
    route: read('entities/route.ts'),
    sync: read('entities/sync.ts'),
  },
  knowledge: {
    route: read('ai/knowledgeDocumentsRoute.ts'),
  },
  index: read('index.ts'),
};

describe('ERP OS 横向 smoke · L1 route 真实挂载（index.ts app.use 事实源，8+ 模块）', () => {
  const IDX = MODULES.index;

  it('Finance: index.ts app.use /api/v1/finance + createFinanceRouter', () => {
    expect(IDX).toContain("'/api/v1/finance'");
    expect(IDX).toContain('createFinanceRouter');
  });

  it('Shipping: index.ts app.use /api/v1/shipping + createShippingRouter', () => {
    expect(IDX).toContain("'/api/v1/shipping'");
    expect(IDX).toContain('createShippingRouter');
  });

  it('Relations: index.ts app.use /api/v1/relations + createRelationsRouter', () => {
    expect(IDX).toContain("'/api/v1/relations'");
    expect(IDX).toContain('createRelationsRouter');
  });

  it('Products: index.ts app.use /api/v1/products + createProductsRouter', () => {
    expect(IDX).toContain("'/api/v1/products'");
    expect(IDX).toContain('createProductsRouter');
  });

  it('Orders: index.ts app.use /api/v1/orders + createOrdersRouter', () => {
    expect(IDX).toContain("'/api/v1/orders'");
    expect(IDX).toContain('createOrdersRouter');
  });

  it('Development: index.ts app.use /api/v1/development + createDevelopmentRouter', () => {
    expect(IDX).toContain("'/api/v1/development'");
    expect(IDX).toContain('createDevelopmentRouter');
  });

  it('Email: index.ts app.use /api/v1/email + createEmailRouter', () => {
    expect(IDX).toContain("'/api/v1/email'");
    expect(IDX).toContain('createEmailRouter');
  });

  it('Import: index.ts app.use /api/v1/import + createImportRouter', () => {
    expect(IDX).toContain("'/api/v1/import'");
    expect(IDX).toContain('createImportRouter');
  });

  it('Entities: index.ts app.use /api/v1/entities + createEntitiesRouter', () => {
    expect(IDX).toContain("'/api/v1/entities'");
    expect(IDX).toContain('createEntitiesRouter');
  });

  it('Knowledge: index.ts app.use knowledge-documents router', () => {
    expect(IDX).toContain("'/api/v1/knowledge-documents'");
    expect(IDX).toMatch(/createKnowledgeDocumentsRouter|knowledgeDocumentsRouter/i);
  });
});

describe('ERP OS 横向 smoke · L2 service 事务/审计边界（5 模块）', () => {

  it('Finance: invoiceMutationService 含 writeRouteAuditLog', () => {
    expect(MODULES.finance.invoiceSvc).toContain('writeRouteAuditLog');
  });

  it('Finance: allocationService 含 writeRouteAuditLog（route + Agent 复用）', () => {
    expect(MODULES.finance.allocationSvc).toContain('writeRouteAuditLog');
  });

  it('Finance: voidDeleteService 存在（voucher/invoice 软删）', () => {
    expect(MODULES.finance.voidDeleteSvc.length).toBeGreaterThan(0);
    expect(MODULES.finance.voidDeleteSvc).toMatch(/deletePaymentVoucher|voidInvoice|writeRouteAuditLog/);
  });

  it('Shipping: shipmentMutationService deleteShipment 含 deactivateEntityLinks + writeRouteAuditLog', () => {
    const svc = MODULES.shipping.svc;
    const idx = svc.indexOf('export async function deleteShipment');
    expect(idx).toBeGreaterThan(-1);
    const section = svc.slice(idx);
    expect(section).toContain('deactivateEntityLinks');
    expect(section).toContain('writeRouteAuditLog');
  });

  it('Relations: relationMutationService delete 含 deactivateEntityLinks', () => {
    const svc = MODULES.relations.svc;
    expect(svc).toContain('deactivateEntityLinks');
  });

  it('Products: productAssetMutationService 含 $transaction 或 withTx', () => {
    const svc = MODULES.products.svc;
    expect(svc.match(/\$transaction|withTx\(/)).toBeTruthy();
  });

  it('Development: route import/调用 convertDevCaseToOrder + service export convertDevCaseToOrder', () => {
    expect(MODULES.development.svc).toContain('export');
    expect(MODULES.development.svc).toMatch(/convertDevCaseToOrder|export.*convert/);
    expect(MODULES.development.route).toMatch(/convertDevCaseToOrder|convertService/);
  });

  it('Orders: orderLifecycleService 含 deactivateEntityLinks（delete 时清理）', () => {
    expect(MODULES.orders.lifecycleSvc).toContain('deactivateEntityLinks');
  });
});

describe('ERP OS 横向 smoke · entities sync 被多模块复用', () => {

  it('entities/sync.ts 导出 syncShipmentReferences / deactivateEntityLinks', () => {
    const sync = MODULES.entities.sync;
    expect(sync).toContain('syncShipmentReferences');
    expect(sync).toContain('deactivateEntityLinks');
  });

  it('shipping + relations + orders 都 import deactivateEntityLinks', () => {
    expect(MODULES.shipping.svc).toContain('deactivateEntityLinks');
    expect(MODULES.relations.svc).toContain('deactivateEntityLinks');
    expect(MODULES.orders.lifecycleSvc).toContain('deactivateEntityLinks');
  });
});
