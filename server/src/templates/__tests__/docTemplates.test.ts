/**
 * B2 运营域单据模板测试 — PO 采购订单 / IR 验货报告
 *
 * 覆盖：
 *   1. renderPurchaseOrderBody：标题/单号/供应商/条款/行明细/合计/双签区
 *   2. renderInspectionReportBody：标题/结果徽章/抽样与缺陷/双签状态（含未签占位）
 *   3. loadInspectionReportDocData：装配（Decimal→number 不适用此处为 Int；签名时间戳→日期；驻地/订单联查）
 *   4. registry：serverKindForType 映射 + PO/IR loadData 按 sourceRef 装配 + 无 sourceRef fail-closed
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { renderPurchaseOrderBody, loadPurchaseOrderDocData } from '../docTemplates/purchaseOrder';
import { renderInspectionReportBody, loadInspectionReportDocData } from '../docTemplates/inspectionReport';
import { renderCertificateOfOriginBody, renderBillOfLadingBody, renderInsurancePolicyBody } from '../docTemplates/customsDocs';
import { serverKindForType, SERVER_DOC_TEMPLATES } from '../docTemplates/registry';

const EXPORTER = {
  nameEn: 'BAMBOOK TRADING CO., LTD.',
  addressEn: 'No. 88 Nanjing Road, Shanghai, China',
  beneficiary: 'BAMBOOK TRADING',
  bankName: 'Bank of Shanghai',
  swiftCode: 'BOSHCNSH',
  bankAddress: 'Shanghai Main Branch',
  usdAccountNumber: '1234567890',
};

// ── PO 渲染 ──

const PO_DATA = {
  po: {
    id: 'PO_1',
    poNumber: 'PO-20260806-001',
    status: 'Confirmed',
    orderDate: '2026-08-06',
    expectedDeliveryDate: '2026-09-15',
    currency: 'USD',
    totalAmount: 16850.5,
    deliveryTerms: 'FOB Shanghai',
    paymentTerms: 'T/T 30% deposit',
    shipToAddress: 'Hamburg Warehouse, Germany',
    buyer: 'Alice',
    notes: '首单试产，注意色差管控',
  },
  supplier: { name: 'Nantong Textile Mill', code: 'SUP-0001', englishName: 'Nantong Textile Mill Co., Ltd.', chineseName: '南通纺织厂', contactInfo: 'Tel: 0513-8888888' },
  salesOrder: { poNumber: 'CUS-PO-77', customer: 'ACME GmbH' },
  lines: [
    { lineNumber: 1, materialCode: 'FAB-001', description: 'Cotton Poplin 40x40', category: 'Fabric', specification: '110x76 44"', quantity: 12000, unit: 'YD', unitPrice: 1.2, amount: 14400 },
    { lineNumber: 2, materialCode: 'TRM-002', description: 'Sewing Thread', category: 'Trimmings', specification: null, quantity: 500, unit: 'PC', unitPrice: 4.9, amount: 2450.5 },
  ],
};

describe('renderPurchaseOrderBody', () => {
  it('渲染 PO 标题/单号/供应商/条款/行明细/合计/双签区', () => {
    const html = renderPurchaseOrderBody(PO_DATA as any, EXPORTER);
    expect(html).toContain('PURCHASE ORDER');
    expect(html).toContain('采购订单');
    expect(html).toContain('PO-20260806-001');
    expect(html).toContain('Nantong Textile Mill Co., Ltd.');
    expect(html).toContain('南通纺织厂');
    expect(html).toContain('BAMBOOK TRADING CO., LTD.');
    expect(html).toContain('FOB Shanghai');
    expect(html).toContain('Cotton Poplin 40x40');
    expect(html).toContain('面料 Fabric');
    expect(html).toContain('辅料 Trimmings');
    expect(html).toContain('12,000 YD');
    expect(html).toContain('16,850.50 USD'); // 合计
    expect(html).toContain('Ref S/O: CUS-PO-77');
    expect(html).toContain('首单试产，注意色差管控');
    // 双签区：采购方签章 + 供应商确认
    expect(html).toContain('Buyer 采购方签章');
    expect(html).toContain('Supplier Confirmation 供应商确认');
  });

  it('缺供应商/条款 → 破折号占位不渲染报错', () => {
    const html = renderPurchaseOrderBody({ ...PO_DATA, supplier: null, po: { ...PO_DATA.po, deliveryTerms: null, paymentTerms: null } } as any, EXPORTER);
    expect(html).toContain('—');
    expect(html).not.toContain('FOB Shanghai');
  });
});

// ── IR 渲染 ──

const IR_DATA = {
  report: {
    id: 'INR__ord_1',
    inspectionType: 'final',
    inspectionDate: '2026-08-20',
    inspectorOrg: 'SGS',
    aqlLevel: 'AQL 2.5',
    lotSize: 5000,
    sampleSize: 200,
    totalUnits: 200,
    passedUnits: 196,
    criticalDefects: 0,
    majorDefects: 1,
    minorDefects: 3,
    defectSummary: '1 处主要缺陷：袖口缝线跳针\n3 处次要缺陷：线头',
    result: 'pass',
    inspectedBy: 'QC Zhang',
    notes: null,
    qcSignedAt: '2026-08-21',
    businessSignedAt: null,
  },
  order: { poNumber: 'CUS-PO-77', customer: 'ACME GmbH', product: 'Men Shirt', quantity: 5000, dueDate: '2026-09-30' },
  locationName: 'Nantong QC Station',
};

describe('renderInspectionReportBody', () => {
  it('渲染 IR 标题/结果徽章/抽样/缺陷明细/双签状态', () => {
    const html = renderInspectionReportBody(IR_DATA as any, EXPORTER);
    expect(html).toContain('INSPECTION REPORT');
    expect(html).toContain('验货报告');
    expect(html).toContain('Final Inspection 最终验货');
    expect(html).toContain('PASS 合格');
    expect(html).toContain('AQL 2.5');
    expect(html).toContain('5000');
    expect(html).toContain('SGS');
    expect(html).toContain('QC Zhang');
    expect(html).toContain('Nantong QC Station');
    expect(html).toContain('袖口缝线跳针');
    expect(html).toContain('Signed 2026-08-21');      // QC 已签
    expect(html).toContain('Pending 待签');            // 业务未签
    expect(html).toContain('CUS-PO-77');
  });

  it('fail 结果 → FAIL 徽章 + 缺陷红色强调', () => {
    const html = renderInspectionReportBody({
      ...IR_DATA,
      report: { ...IR_DATA.report, result: 'fail', criticalDefects: 2 },
    } as any, EXPORTER);
    expect(html).toContain('FAIL 不合格');
  });

  it('result 为 null → PENDING 兜底徽章不报错', () => {
    const html = renderInspectionReportBody({
      ...IR_DATA,
      report: { ...IR_DATA.report, result: null },
    } as any, EXPORTER);
    expect(html).toContain('PENDING');
  });
});

// ── IR 数据装配（mock prisma 联查） ──

describe('loadInspectionReportDocData', () => {
  function makePrisma(overrides: Record<string, any> = {}): PrismaClient {
    return {
      inspectionReport: { findUnique: vi.fn().mockResolvedValue(overrides.report ?? null) },
      order: { findUnique: vi.fn().mockResolvedValue(overrides.order ?? null) },
      qCAssignment: { findFirst: vi.fn().mockResolvedValue(overrides.assignment ?? null) },
      qCLocation: { findUnique: vi.fn().mockResolvedValue(overrides.location ?? null) },
    } as any;
  }

  it('装配报告 + 订单 + 驻地；签名时间戳（毫秒）→ YYYY-MM-DD', async () => {
    const ts = Date.UTC(2026, 7, 21, 3, 0, 0); // 2026-08-21
    const prisma = makePrisma({
      report: {
        id: 'INR__ord_1', orderId: 'ord_1', inspectionType: 'final',
        totalUnits: 200, passedUnits: 196, criticalDefects: 0, majorDefects: 1, minorDefects: 3,
        defectSummary: null, result: 'pass', inspectedBy: 'QC Zhang', notes: null,
        inspectionDate: '2026-08-20', inspectorOrg: 'SGS', aqlLevel: 'AQL 2.5', lotSize: 5000, sampleSize: 200,
        signatures: { qcSignedAt: ts, businessSignedAt: null },
      },
      order: { poNumber: 'CUS-PO-77', customer: 'ACME', product: 'Shirt', quantity: 5000, dueDate: '2026-09-30' },
      assignment: { locationId: 'QCL_1' },
      location: { name: 'Nantong QC Station' },
    });
    const data = await loadInspectionReportDocData(prisma, 'INR__ord_1');
    expect(data).not.toBeNull();
    expect(data!.report.qcSignedAt).toBe('2026-08-21');
    expect(data!.report.businessSignedAt).toBeNull();
    expect(data!.locationName).toBe('Nantong QC Station');
    expect(data!.order?.customer).toBe('ACME');
  });

  it('报告不存在 → null（调用方 404）', async () => {
    const prisma = makePrisma({ report: null });
    expect(await loadInspectionReportDocData(prisma, 'INR__missing')).toBeNull();
  });
});

// ── PO 数据装配（mock prisma 联查） ──

describe('loadPurchaseOrderDocData', () => {
  function makePrisma(overrides: Record<string, any> = {}): PrismaClient {
    return {
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(overrides.po ?? null) },
      relation: { findUnique: vi.fn().mockResolvedValue(overrides.supplier ?? null) },
      order: { findUnique: vi.fn().mockResolvedValue(overrides.salesOrder ?? null) },
    } as any;
  }

  it('装配 PO 头 + 行明细 + 供应商 + 销售订单（Decimal→number）', async () => {
    const prisma = makePrisma({
      po: {
        id: 'PO_1', poNumber: 'PO-20260806-001', status: 'Confirmed', deletedAt: null,
        orderDate: '2026-08-06', expectedDeliveryDate: null, currency: 'USD',
        totalAmount: 16850.5,
        deliveryTerms: 'FOB', paymentTerms: null, shipToAddress: null, buyer: 'Alice', notes: null,
        orderId: 'ord_1', supplierRelationId: 'rel_1',
        lines: [
          { lineNumber: 1, materialCode: 'FAB-001', description: 'Poplin', category: 'Fabric', specification: null, quantity: 12000, unit: 'YD', unitPrice: 1.2, amount: 14400 },
        ],
      },
      supplier: { name: 'Nantong Mill', code: 'SUP-1', englishName: null, chineseName: '南通厂', contactInfo: '' },
      salesOrder: { poNumber: 'CUS-PO-77', customer: 'ACME' },
    });
    const data = await loadPurchaseOrderDocData(prisma, 'PO_1');
    expect(data).not.toBeNull();
    expect(data!.po.poNumber).toBe('PO-20260806-001');
    expect(data!.lines).toHaveLength(1);
    expect(data!.lines[0].quantity).toBe(12000);
    expect(data!.supplier?.chineseName).toBe('南通厂');
    expect(data!.salesOrder?.poNumber).toBe('CUS-PO-77');
  });

  it('PO 不存在/软删 → null', async () => {
    const prisma = makePrisma({ po: null });
    expect(await loadPurchaseOrderDocData(prisma, 'PO_missing')).toBeNull();
  });
});

// ── 注册表映射 ──

describe('serverKindForType / SERVER_DOC_TEMPLATES', () => {
  it('PO/IR/PL/CO/BL/INS 类型映射正确且模板已注册', () => {
    expect(serverKindForType('PurchaseOrder')).toBe('PO');
    expect(serverKindForType('InspectionReport')).toBe('IR');
    expect(serverKindForType('PackingList')).toBe('PL');
    expect(serverKindForType('CertificateOfOrigin')).toBe('CO');
    expect(serverKindForType('BillOfLading')).toBe('BL');
    expect(serverKindForType('InsuranceCert')).toBe('INS');
    expect(serverKindForType('AirWaybill')).toBeNull(); // 未迁移类型 → 前端本地渲染兜底
    expect(SERVER_DOC_TEMPLATES.PO.title).toContain('Purchase Order');
    expect(SERVER_DOC_TEMPLATES.IR.title).toContain('Inspection Report');
    expect(SERVER_DOC_TEMPLATES.CO.title).toContain('原产地证');
    expect(SERVER_DOC_TEMPLATES.BL.title).toContain('提单');
    expect(SERVER_DOC_TEMPLATES.INS.title).toContain('保险单');
  });

  it('PO/IR loadData 无 sourceRef → null（fail-closed，无业务真源不渲染）', async () => {
    const prisma = {} as PrismaClient;
    expect(await SERVER_DOC_TEMPLATES.PO.loadData(prisma, { id: 'TD_1', type: 'PurchaseOrder', sourceRef: null })).toBeNull();
    expect(await SERVER_DOC_TEMPLATES.IR.loadData(prisma, { id: 'TD_2', type: 'InspectionReport', sourceRef: null })).toBeNull();
  });
});

// ── B5 customs 域模板（CO / BL / INS）──

function makeCustomsDocSet(overrides: Record<string, any> = {}) {
  return {
    shipment: {
      id: 'SHP_1', shipmentNumber: 'SHP-2026-0001', status: 'Shipped',
      shippingMethod: 'SEA', vesselOrFlight: 'MSC ANNA', voyageNumber: '023W',
      portOfLoading: 'SHANGHAI', portOfDischarge: 'HAMBURG',
      containerNumber: 'MSCU1234567', sealNumber: 'S1234',
      bookingDate: '2026-08-01', etd: '2026-08-10', atd: '2026-08-11', eta: null,
      totalPackages: 100, grossWeight: 1000, netWeight: 900, volume: 2.5,
      notes: 'Handle with care', type: 'Sea', hsCode: null, customsDeclarationNumber: 'CD-1',
    },
    order: { id: 'ord_1', poNumber: 'CUS-PO-77', customer: 'ACME GmbH', currency: 'USD', deliveryTerms: 'CIF HAMBURG', paymentTerms: 'T/T', salesContractNumber: 'SC-1', finalContractNumber: null, invoiceNumber: 'INV-2026-001', invoiceDate: '2026-08-10' },
    customs: { declarationNumber: 'CD-1', declarationDate: '2026-08-09', declarationPort: 'SHANGHAI', tradeTerms: 'CIF HAMBURG', totalValue: 20000, currency: 'USD', originCountry: 'CHINA', destinationCountry: 'GERMANY', consignee: 'ACME', consignor: 'BAMBOOK' },
    parties: { customer: { name: 'ACME GmbH' }, consignee: { name: 'ACME GmbH', address: 'Hamburg, Germany' }, carrier: { name: 'MSC' } },
    lines: [
      { lineNumber: 1, description: 'Men Cotton Shirt', productCode: 'SHIRT-01', hsCode: '6205.20', quantity: 5000, unit: 'PCS', unitPrice: 4, amount: 20000, cartons: 100, grossWeight: 1000, netWeight: 900, volume: 2.5, originCountry: 'CHINA' },
    ],
    totals: { quantity: 5000, amount: 20000, cartons: 100, grossWeight: 1000, netWeight: 900, volume: 2.5, currency: 'USD' },
    missing: [],
    extras: {
      originCriterion: 'P',
      insurance: { insurer: 'PICC', insuredAmount: 22000, currency: 'USD', premium: null, premiumCurrency: null, coverage: 'ALL RISKS' },
      letterOfCredit: { lcNumber: 'LC-2026-88', issueBank: 'Deutsche Bank', issueDate: '2026-07-01', applicant: 'ACME GmbH' },
    },
    ...overrides,
  };
}

describe('B5 customs 域模板（CO / BL / INS，版本快照数据）', () => {
  it('CO 原产地证：标题/出口商/运输路线/HS Code/声明/原产国', () => {
    const html = renderCertificateOfOriginBody(makeCustomsDocSet() as any, EXPORTER);
    expect(html).toContain('CERTIFICATE OF ORIGIN');
    expect(html).toContain('原产地证明书');
    expect(html).toContain('BAMBOOK TRADING CO., LTD.');
    expect(html).toContain('FROM SHANGHAI TO HAMBURG');
    expect(html).toContain('6205.20');
    expect(html).toContain('CHINA');
    expect(html).toContain('中华人民共和国');
    expect(html).toContain('Declaration by the Exporter 出口商声明');
  });

  it('BL 提单补料：CIF → FREIGHT PREPAID；柜号封号/唛头/合计/双签', () => {
    const html = renderBillOfLadingBody(makeCustomsDocSet() as any, EXPORTER);
    expect(html).toContain('BILL OF LADING');
    expect(html).toContain("Shipper's Draft / SI");
    expect(html).toContain('FREIGHT PREPAID 运费预付'); // CIF 条款推断
    expect(html).toContain('MSCU1234567');
    expect(html).toContain('S1234');
    expect(html).toContain('TOTAL 合计');
    expect(html).toContain('SHIPPER\'S LOAD, COUNT AND SEAL');
    expect(html).toContain('For the Carrier');
  });

  it('BL FOB → FREIGHT COLLECT（运费条款推断反向）', () => {
    const data = makeCustomsDocSet();
    data.order.deliveryTerms = 'FOB SHANGHAI';
    data.customs.tradeTerms = 'FOB SHANGHAI';
    const html = renderBillOfLadingBody(data as any, EXPORTER);
    expect(html).toContain('FREIGHT COLLECT 运费到付');
  });

  it('INS 保险单：保额/险别/信用证引用/被保险人', () => {
    const html = renderInsurancePolicyBody(makeCustomsDocSet() as any, EXPORTER);
    expect(html).toContain('INSURANCE POLICY / CERTIFICATE');
    expect(html).toContain('货物运输保险单');
    expect(html).toContain('22,000.00 USD'); // 保险金额（货值 110%）
    expect(html).toContain('PICC');
    expect(html).toContain('ALL RISKS');
    expect(html).toContain('LC-2026-88');
    expect(html).toContain('Deutsche Bank');
    expect(html).toContain('Insured / Beneficiary 被保险人'); // 被保险人=出口商 beneficiary
  });

  it('INS extras 缺失 → 默认险别兜底不报错', () => {
    const data = makeCustomsDocSet({ extras: {} });
    const html = renderInsurancePolicyBody(data as any, EXPORTER);
    expect(html).toContain('INSURANCE POLICY');
    expect(html).toContain('ALL RISKS'); // 默认险别
  });
});
