/**
 * 贸易单据生命周期服务单元测试 — Wave A1 单据中心
 *
 * 覆盖：
 *   1. 自动取号：{前缀}-YYYY-NNNN、含软删取 max+1、超 4 位数值比较、非法类型 fail-closed
 *   2. 版本留痕：v1 起始、max+1 递增、审计日志同事务
 *   3. 生成即登记：运单 → 单据草稿（created/skipped 幂等、relationId 解析、missing 透传、装配失败抛错）
 *   4. 批量打包：订单全部单据 + 最新版本快照、Decimal→number、空订单 total=0
 *   5. 快照序列化：BigInt/Decimal → number
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  appendTradeDocumentVersion,
  generateTradeDocumentNumber,
  generateTradeDocumentFile,
  generateTradeDocumentsFromShipment,
  packTradeDocumentsByOrder,
  toTradeDocumentSnapshot,
  upsertDomainTradeDocument,
  TRADE_DOC_NUMBER_PREFIX,
} from '../tradeDocumentLifecycleService';

// ── Mock 声明（vi.hoisted：vi.mock 工厂提升后在 import 阶段即可安全引用）──
const { assembleMock, pdfMock, invoiceHtmlMock, fsMock } = vi.hoisted(() => ({
  assembleMock: vi.fn(),
  pdfMock: vi.fn(),
  invoiceHtmlMock: vi.fn(),
  fsMock: { existsSync: vi.fn(() => true), mkdirSync: vi.fn(), writeFileSync: vi.fn() },
}));

// ── Mock 装配服务（不触真实 DB，返回固定 documentSet 数据）──
vi.mock('../../shipping/documentSetService', () => ({
  assembleDocumentSetData: (...args: any[]) => assembleMock(...args),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Mock PDF 渲染（不启 Puppeteer）+ 财务发票模板（CI 真源分支）+ fs 落盘 ──
vi.mock('../../templates/pdf', () => ({
  renderHtmlToPdf: (...args: any[]) => pdfMock(...args),
}));
vi.mock('../../templates/docTemplates/financeInvoice', () => ({
  // B11 收编：财务发票模板从 finance/route.ts 提取至 docTemplates/financeInvoice.ts
  renderFinanceInvoiceDocument: (...args: any[]) => invoiceHtmlMock(...args),
}));
vi.mock('fs', () => ({ ...fsMock, default: fsMock }));

// ── Mock customsService（upsertDomainTradeDocument 动态 import 的域校验；真实语义副本）──
vi.mock('../customsService', () => ({
  docStatusTransitionsFor: (domain: string) => {
    const transitions: Record<string, Record<string, string[]>> = {
      customs: {}, procurement: {}, qc: {}, contract: {}, finance: {},
    };
    if (!transitions[domain]) throw new Error(`非法单据业务域: ${domain}`);
    return transitions[domain];
  },
}));

const YEAR = new Date().getFullYear();

function makeAssembled(overrides: Record<string, any> = {}) {
  return {
    ok: true,
    data: {
      order: { id: 'ord_1', currency: 'USD' },
      parties: { consignee: { name: 'ACME LTD' }, customer: { name: 'ACME LTD' } },
      customs: { consignor: 'BAMBOOK CO', currency: 'USD' },
      shipment: { portOfLoading: 'SHANGHAI', portOfDischarge: 'HAMBURG' },
      totals: { amount: 12345.67, currency: 'USD' },
      missing: ['缺少毛重'],
      ...overrides,
    },
  };
}

function makePrisma(overrides: Record<string, any> = {}) {
  const tx: any = {
    tradeDocument: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, deletedAt: null })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      findMany: overrides.docFindMany ?? vi.fn().mockResolvedValue([]),
      findFirst: overrides.docFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    documentVersion: {
      findFirst: overrides.verFindFirst ?? vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    ...tx,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    order: {
      findUnique: overrides.orderFindUnique ?? vi.fn().mockResolvedValue({ customerRelationId: 'rel_1' }),
    },
    // BusinessSequence mock（统一编号服务依赖，支持 seq 递增）
    businessSequence: overrides.businessSequence ?? {
      upsert: vi.fn().mockImplementation(async ({ where, create }: any) => ({ ...create, seq: 0 })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const current = (prisma as any)._seq ?? 0;
        (prisma as any)._seq = current + 1;
        return { seq: current + 1 };
      }),
      findUnique: vi.fn().mockImplementation(async () => ({ seq: (prisma as any)._seq ?? 0 })),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    _tx: tx,
  };
  return prisma;
}

beforeEach(() => {
  assembleMock.mockReset();
});

describe('generateTradeDocumentNumber', () => {
  it('无既有编号 → 0001 起始', async () => {
    const prisma = makePrisma();
    const num = await generateTradeDocumentNumber(prisma, 'CommercialInvoice');
    expect(num).toBe(`CI-${YEAR}-0001`);
  });

  it('统一编号服务：同类型 seq 递增（作废不回收）', async () => {
    const prisma = makePrisma();
    const num1 = await generateTradeDocumentNumber(prisma, 'PackingList');
    expect(num1).toBe(`PL-${YEAR}-0001`);
    const num2 = await generateTradeDocumentNumber(prisma, 'PackingList');
    expect(num2).toBe(`PL-${YEAR}-0002`);
  });

  it('降级路径：无 businessSequence 时扫描既有记录（mock 测试场景兼容）', async () => {
    const prisma = makePrisma({
      docFindMany: vi.fn().mockResolvedValue([
        { documentNumber: `CI-${YEAR}-9999` },
        { documentNumber: `CI-${YEAR}-10000` },
      ]),
    });
    // 显式移除 businessSequence，触发降级路径
    delete prisma.businessSequence;
    const num = await generateTradeDocumentNumber(prisma, 'CommercialInvoice');
    expect(num).toBe(`CI-${YEAR}-10001`);
  });

  it('非法类型 fail-closed', async () => {
    const prisma = makePrisma();
    await expect(generateTradeDocumentNumber(prisma, 'Nope' as any)).rejects.toThrow('非法单据类型');
  });

  it('14 类前缀映射齐备（customs 9 类 + 运营域 PO/IR/QT/OC/CT）', () => {
    expect(Object.keys(TRADE_DOC_NUMBER_PREFIX)).toHaveLength(14);
    expect(TRADE_DOC_NUMBER_PREFIX.BillOfLading).toBe('BL');
    expect(TRADE_DOC_NUMBER_PREFIX.PurchaseOrder).toBe('PO');
    expect(TRADE_DOC_NUMBER_PREFIX.InspectionReport).toBe('IR');
    expect(TRADE_DOC_NUMBER_PREFIX.Quotation).toBe('QT');
    expect(TRADE_DOC_NUMBER_PREFIX.OrderConfirmation).toBe('OC');
    expect(TRADE_DOC_NUMBER_PREFIX.Contract).toBe('CT');
  });
});

describe('appendTradeDocumentVersion', () => {
  it('无既有版本 → v1 + 审计', async () => {
    const prisma = makePrisma();
    await appendTradeDocumentVersion(prisma._tx, {
      documentId: 'TD_1',
      content: { a: 1 },
      actorId: 'user_1',
      changeReason: '创建',
    });
    expect(prisma._tx.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ documentId: 'TD_1', version: 1, changedBy: 'user_1', changeReason: '创建' }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_VERSION_CREATE' }) }),
    );
  });

  it('既有版本 → max+1 递增', async () => {
    const prisma = makePrisma({ verFindFirst: vi.fn().mockResolvedValue({ version: 3 }) });
    await appendTradeDocumentVersion(prisma._tx, {
      documentId: 'TD_1',
      content: {},
      actorId: 'user_1',
    });
    expect(prisma._tx.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 4 }) }),
    );
  });

  it('changeReason 空白 → null', async () => {
    const prisma = makePrisma();
    await appendTradeDocumentVersion(prisma._tx, {
      documentId: 'TD_1',
      content: {},
      actorId: 'user_1',
      changeReason: '   ',
    });
    expect(prisma._tx.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changeReason: null }) }),
    );
  });
});

describe('generateTradeDocumentsFromShipment', () => {
  it('批量创建 Draft 单据：自动取号 + v1 快照 + relationId 解析 + missing 透传', async () => {
    assembleMock.mockResolvedValue(makeAssembled());
    const prisma = makePrisma();
    const result = await generateTradeDocumentsFromShipment(prisma, {
      shipmentId: 'shp_1',
      types: ['CommercialInvoice', 'PackingList'],
      actorId: 'user_1',
    });

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.missing).toEqual(['缺少毛重']);
    expect(result.created[0].documentNumber).toBe(`CI-${YEAR}-0001`);
    expect(result.created[1].documentNumber).toBe(`PL-${YEAR}-0001`);

    // 单据字段：装配数据映射 + relationId + Draft
    const createData = prisma._tx.tradeDocument.create.mock.calls[0][0].data;
    expect(createData.status).toBe('Draft');
    expect(createData.shipmentId).toBe('shp_1');
    expect(createData.orderId).toBe('ord_1');
    expect(createData.relationId).toBe('rel_1');
    expect(createData.consignee).toBe('ACME LTD');
    expect(createData.portOfLoading).toBe('SHANGHAI');
    expect(Number(createData.totalAmount)).toBeCloseTo(12345.67);

    // v1 快照含 documentSet
    const verData = prisma._tx.documentVersion.create.mock.calls[0][0].data;
    expect(verData.version).toBe(1);
    expect(verData.content.documentSet).toBeDefined();
    expect(verData.changeReason).toBe('运单生成');
  });

  it('同 shipmentId+type 已存在 → skipped 幂等不重复登记', async () => {
    assembleMock.mockResolvedValue(makeAssembled());
    const prisma = makePrisma({
      docFindFirst: vi.fn().mockResolvedValue({ id: 'TD_ex', documentNumber: `CI-${YEAR}-0001` }),
    });
    const result = await generateTradeDocumentsFromShipment(prisma, {
      shipmentId: 'shp_1',
      types: ['CommercialInvoice'],
      actorId: 'user_1',
    });
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual([{ type: 'CommercialInvoice', id: 'TD_ex', documentNumber: `CI-${YEAR}-0001`, reason: 'EXISTS' }]);
    expect(prisma._tx.tradeDocument.create).not.toHaveBeenCalled();
  });

  it('types 空数组 / 非法类型 → 400 语义抛错', async () => {
    const prisma = makePrisma();
    await expect(
      generateTradeDocumentsFromShipment(prisma, { shipmentId: 'shp_1', types: [], actorId: 'u' }),
    ).rejects.toThrow('types 必填');
    await expect(
      generateTradeDocumentsFromShipment(prisma, { shipmentId: 'shp_1', types: ['Nope' as any], actorId: 'u' }),
    ).rejects.toThrow('非法单据类型');
  });

  it('装配失败（运单不存在）→ 抛错不建档', async () => {
    assembleMock.mockResolvedValue({ ok: false, error: { code: 'SHIPMENT_NOT_FOUND', message: '运单 shp_x 不存在' } });
    const prisma = makePrisma();
    await expect(
      generateTradeDocumentsFromShipment(prisma, { shipmentId: 'shp_x', types: ['PackingList'], actorId: 'u' }),
    ).rejects.toThrow('运单 shp_x 不存在');
    expect(prisma._tx.tradeDocument.create).not.toHaveBeenCalled();
  });
});

describe('packTradeDocumentsByOrder', () => {
  it('订单全部单据 + 最新版本快照，Decimal→number', async () => {
    const prisma = makePrisma({
      docFindMany: vi.fn().mockResolvedValue([
        {
          id: 'TD_1',
          documentNumber: `CI-${YEAR}-0001`,
          type: 'CommercialInvoice',
          status: 'Issued',
          issueDate: '2026-08-01',
          consignee: 'ACME',
          consignor: 'BAMBOOK',
          totalAmount: new Prisma.Decimal(999.5),
          currency: 'USD',
          fileName: null,
        },
        {
          id: 'TD_2',
          documentNumber: `PL-${YEAR}-0002`,
          type: 'PackingList',
          status: 'Draft',
          issueDate: null,
          consignee: null,
          consignor: null,
          totalAmount: null,
          currency: null,
          fileName: 'pl.pdf',
        },
      ]),
      verFindFirst: vi
        .fn()
        .mockResolvedValueOnce({ version: 3, content: { documentSet: { x: 1 } } })
        .mockResolvedValueOnce(null),
    });
    const { items, total } = await packTradeDocumentsByOrder(prisma, 'ord_1');
    expect(total).toBe(2);
    expect(items[0].latestVersion).toBe(3);
    expect(items[0].content).toEqual({ documentSet: { x: 1 } });
    expect(items[0].totalAmount).toBe(999.5);
    expect(items[1].latestVersion).toBeNull();
    expect(items[1].content).toBeNull();
  });

  it('空订单 → total=0；orderId 缺失 → 抛错', async () => {
    const prisma = makePrisma();
    const { items, total } = await packTradeDocumentsByOrder(prisma, 'ord_empty');
    expect(total).toBe(0);
    expect(items).toEqual([]);
    await expect(packTradeDocumentsByOrder(prisma, '')).rejects.toThrow('orderId 必填');
  });
});

describe('toTradeDocumentSnapshot', () => {
  it('BigInt/Decimal → number，其余原样', () => {
    const snap = toTradeDocumentSnapshot({
      id: 'TD_1',
      createdAt: BigInt(1723000000000),
      totalAmount: new Prisma.Decimal('12.34'),
      notes: null,
      status: 'Draft',
    });
    expect(snap.createdAt).toBe(1723000000000);
    expect(snap.totalAmount).toBe(12.34);
    expect(snap.notes).toBeNull();
    expect(snap.status).toBe('Draft');
  });
});

describe('generateTradeDocumentFile', () => {
  const DOC_HTML = '<!doctype html><html><head><style>body{}</style></head><body>PACKING LIST CONTENT</body></html>';

  beforeEach(() => {
    pdfMock.mockReset().mockResolvedValue({ pdf: Buffer.from('%PDF-1.4 fake'), sha: 'abc123', bytes: 20 });
    invoiceHtmlMock.mockReset().mockResolvedValue('<!doctype html><html>COMMERCIAL INVOICE FROM FINANCE</html>');
    fsMock.writeFileSync.mockReset();
    fsMock.existsSync.mockReset().mockReturnValue(true);
    fsMock.mkdirSync.mockReset();
  });

  function makeDocPrisma(doc: any) {
    const update = vi.fn().mockImplementation(async ({ data }: any) => ({ id: doc.id, ...data }));
    const prisma = makePrisma({
      docFindFirst: vi.fn().mockResolvedValue(doc),
      verFindFirst: vi.fn().mockResolvedValue({ version: 2, content: {} }),
    });
    prisma.tradeDocument.update = update;
    return { prisma, update };
  }

  it('CI 带财务回链 → 服务端财务真源模板自渲染（忽略入参 html）+ 落盘 + 回写 + 审计', async () => {
    const { prisma, update } = makeDocPrisma({
      id: 'TD_CI_1',
      documentNumber: `CI-${YEAR}-0001`,
      type: 'CommercialInvoice',
      sourceInvoiceId: 'INV_9',
      deletedAt: null,
    });
    const result = await generateTradeDocumentFile(prisma, {
      id: 'TD_CI_1',
      html: '<!doctype html><html>前端伪造模板</html>', // 应被忽略——单一真源防双模板漂移
      version: 2,
      actorId: 'user_1',
    });
    // B1 起 renderInvoiceDocumentHtml 带 opts 参数（generate 路径 = {} 非 screen；preview.html = { screen: true }）
    expect(invoiceHtmlMock).toHaveBeenCalledWith(prisma, 'INV_9', {});
    expect(pdfMock).toHaveBeenCalledWith(
      '<!doctype html><html>COMMERCIAL INVOICE FROM FINANCE</html>',
      { format: 'A4' },
    );
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(result.fileName).toBe(`CI-${YEAR}-0001-v2.pdf`);
    expect(result.filePath).toContain('trade-documents/TD_CI_1-CI');
    expect(result.fileSize).toBe(20);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'TD_CI_1' }, data: expect.objectContaining({ fileName: `CI-${YEAR}-0001-v2.pdf` }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'TRADE_DOCUMENT_FILE_GENERATED', targetId: 'TD_CI_1' }) }),
    );
  });

  it('非 CI（前端模板真源）→ 用入参 html 渲染落盘', async () => {
    const { prisma, update } = makeDocPrisma({
      id: 'TD_PL_1',
      documentNumber: `PL-${YEAR}-0003`,
      type: 'PackingList',
      sourceInvoiceId: null,
      deletedAt: null,
    });
    const result = await generateTradeDocumentFile(prisma, { id: 'TD_PL_1', html: DOC_HTML, version: 1, actorId: 'user_1' });
    expect(invoiceHtmlMock).not.toHaveBeenCalled();
    expect(pdfMock).toHaveBeenCalledWith(DOC_HTML, { format: 'A4' });
    expect(result.fileName).toBe(`PL-${YEAR}-0003-v1.pdf`);
    expect(update).toHaveBeenCalled();
  });

  it('版本号缺省 → 兜底最新版本；单据不存在/无渲染内容 → 抛错', async () => {
    const { prisma } = makeDocPrisma({
      id: 'TD_PL_2',
      documentNumber: `PL-${YEAR}-0004`,
      type: 'PackingList',
      sourceInvoiceId: null,
      deletedAt: null,
    });
    const r = await generateTradeDocumentFile(prisma, { id: 'TD_PL_2', html: DOC_HTML, actorId: 'u' });
    expect(r.fileName).toBe(`PL-${YEAR}-0004-v2.pdf`); // verFindFirst 兜底 version=2

    const missing = makePrisma({ docFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(generateTradeDocumentFile(missing, { id: 'TD_X', html: DOC_HTML, actorId: 'u' })).rejects.toThrow('不存在');

    const noHtml = makeDocPrisma({ id: 'TD_PL_3', documentNumber: 'PL-1', type: 'PackingList', sourceInvoiceId: null, deletedAt: null });
    await expect(generateTradeDocumentFile(noHtml.prisma, { id: 'TD_PL_3', html: '', actorId: 'u' })).rejects.toThrow('无可渲染内容');
  });
});

// ══════════════════════════════════════════════════════════════
// B2 运营域单据登记（upsertDomainTradeDocument）
// ══════════════════════════════════════════════════════════════

describe('upsertDomainTradeDocument', () => {
  it('首次登记 → created：文档号=入参业务单号 + v1 轻量快照（sourceRef 元数据）', async () => {
    const prisma = makePrisma();
    const result = await upsertDomainTradeDocument(prisma, {
      domain: 'procurement',
      type: 'PurchaseOrder',
      sourceRef: 'PO_abc123',
      documentNumber: 'PO-20260806-001',
      orderId: 'ord_1',
      totalAmount: 12345.67,
      currency: 'USD',
      issueDate: '2026-08-06',
      actorId: 'user_1',
    });
    expect(result).toEqual({ documentId: expect.any(String), documentNumber: 'PO-20260806-001', outcome: 'created' });

    const create = prisma._tx.tradeDocument.create.mock.calls[0][0].data;
    expect(create.domain).toBe('procurement');
    expect(create.type).toBe('PurchaseOrder');
    expect(create.sourceRef).toBe('PO_abc123');
    expect(create.status).toBe('Draft');
    expect(create.totalAmount.toString()).toBe('12345.67');
    // v1 快照记录真源外链（渲染走业务真源实时装配，不复制内容）
    const verCreate = prisma._tx.documentVersion.create.mock.calls[0][0].data;
    expect(verCreate.version).toBe(1);
    expect(verCreate.content).toMatchObject({ source: 'domain', domain: 'procurement', sourceRef: 'PO_abc123' });
  });

  it('文档号缺省 → 自动取号（IR 前缀）', async () => {
    const prisma = makePrisma();
    const result = await upsertDomainTradeDocument(prisma, {
      domain: 'qc',
      type: 'InspectionReport',
      sourceRef: 'INR__ord_1',
      actorId: 'user_1',
    });
    expect(result.outcome).toBe('created');
    expect(result.documentNumber).toBe(`IR-${YEAR}-0001`);
  });

  it('重复登记 → updated：不新建文档，刷新头字段 + 审计', async () => {
    const prisma = makePrisma({
      docFindFirst: vi.fn().mockResolvedValue({ id: 'TD_EXIST', documentNumber: 'PO-20260806-001' }),
    });
    const result = await upsertDomainTradeDocument(prisma, {
      domain: 'procurement',
      type: 'PurchaseOrder',
      sourceRef: 'PO_abc123',
      documentNumber: 'PO-20260806-001',
      totalAmount: 9999,
      currency: 'USD',
      actorId: 'user_1',
    });
    expect(result).toMatchObject({ documentId: 'TD_EXIST', outcome: 'updated' });
    expect(prisma._tx.tradeDocument.create).not.toHaveBeenCalled();
    expect(prisma._tx.tradeDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'TD_EXIST' }, data: expect.objectContaining({ currency: 'USD' }) }),
    );
    const audit = prisma._tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('TRADE_DOCUMENT_DOMAIN_REFRESH');
  });

  it('未知 domain → fail-closed 抛错（域状态机未注册）', async () => {
    const prisma = makePrisma();
    await expect(upsertDomainTradeDocument(prisma, {
      domain: 'unknown_domain',
      type: 'PurchaseOrder',
      sourceRef: 'PO_x',
      actorId: 'user_1',
    })).rejects.toThrow('非法单据业务域');
  });
});
