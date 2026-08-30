/**
 * company-sim/trade-docs.ts — 订单→出运→报关→单据归档（联动④）
 *
 * 剧情（确定性）：
 *   - 全部已出运订单（Delivered 34 + Shipping 4 = 38 票）每票一张出口报关单
 *     （SIM-CD-xxxx，status=Released，行级 hsCode 按品类）+ 报关行/口岸/毛净重对齐 Shipment；
 *   - 每票归档 3 张单据中心 TradeDocument（domain='customs'，status=Issued）：
 *     BillOfLading（提单）/ CommercialInvoice（sourceInvoiceId=财务 Invoice，引用不复制）/ PackingList，
 *     各挂 DocumentVersion v1 内容快照；
 *   - 回填 Shipment.customsDeclarationNumber / customsClearanceDate。
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { isoDate, createManyLogged } from './common';
import { CUSTOMERS } from './master-data';
import type { OrderPlan } from './orders';

const DAY = 24 * 3600 * 1000;
const HS_BY_CATEGORY: Record<string, string> = { Dress: '6204.43.00', Blouse: '6206.40.00', 'Knit Top': '6110.20.99' };
const CONSIGNOR = '竹衍服饰有限公司（PandaClothing）';

interface ShipmentSnap {
  id: string;
  totalPackages: number;
  grossWeight: Prisma.Decimal;
  netWeight: Prisma.Decimal;
  portOfLoading: string;
  portOfDischarge: string;
  carrierName: string | null;
  customsBroker: string | null;
}

export async function seedTradeDocs(prisma: PrismaClient, plans: OrderPlan[]): Promise<void> {
  console.log('── 报关单 + 单据中心归档（38 票已出运订单） ──');

  // reset-dev-business-data 的 DELETE_PLAN 未包含 documentVersion（遗留缺口）：
  // 历史会话的孤儿版本会跨 reset 存活，此处清空后由本次归档重建，保证「版本表 ↔ 单据表」一致。
  const purged = await prisma.documentVersion.deleteMany({});
  if (purged.count > 0) console.log(`  DocumentVersion 预清理（reset 缺口/历史孤儿）: ${purged.count} 行`);

  const shipped = plans.filter((p) => p.fate === 'Delivered' || p.fate === 'Shipping');
  const orderIds = shipped.map((p) => p.id);

  const shipments = await prisma.shipment.findMany({
    where: { orderId: { in: orderIds }, deletedAt: null },
    select: {
      id: true, orderId: true, totalPackages: true, grossWeight: true, netWeight: true,
      portOfLoading: true, portOfDischarge: true, carrierName: true, customsBroker: true,
    },
  });
  const shipByOrder = new Map<string, ShipmentSnap>(
    shipments.map((s) => [s.orderId, {
      id: s.id, totalPackages: s.totalPackages, grossWeight: s.grossWeight, netWeight: s.netWeight,
      portOfLoading: s.portOfLoading, portOfDischarge: s.portOfDischarge,
      carrierName: s.carrierName, customsBroker: s.customsBroker,
    }] as const),
  );
  const invoices = await prisma.invoice.findMany({
    where: { orderId: { in: orderIds }, deletedAt: null },
    select: { id: true, orderId: true },
  });
  const invoiceIdByOrder = new Map(invoices.map((i) => [i.orderId, i.id] as const));

  const cdRows: Prisma.CustomsDeclarationUncheckedCreateInput[] = [];
  const cdlRows: Prisma.CustomsDeclarationLineUncheckedCreateInput[] = [];
  const tdRows: Prisma.TradeDocumentUncheckedCreateInput[] = [];
  const dverRows: Prisma.DocumentVersionUncheckedCreateInput[] = [];
  const shipmentUpdates: Array<{ id: string; declarationNumber: string; clearanceDate: string; updatedAt: number }> = [];

  shipped.forEach((p, si) => {
    const ship = shipByOrder.get(p.id);
    if (!ship) throw new Error(`订单 ${p.id} 缺少 Shipment，无法铺报关链`);
    const shipMs = p.shipMs ?? p.createdAtMs;
    const cust = CUSTOMERS[p.idx % 8];
    const cdId = `SIM-CD-${String(si + 1).padStart(3, '0')}`;
    const declarationNumber = `SIM-CD-2026-${String(si + 1).padStart(4, '0')}`;

    cdRows.push({
      id: cdId, declarationNumber,
      shipmentId: ship.id, orderId: p.id, relationId: p.customerId,
      type: 'Export', status: 'Released',
      declarationDate: isoDate(shipMs), customsCode: '2201', declarationPort: 'Shanghai',
      tradeTerms: 'FOB',
      totalValue: new Prisma.Decimal(p.amount), currency: p.currency,
      totalPackages: ship.totalPackages, grossWeight: ship.grossWeight, netWeight: ship.netWeight,
      originCountry: 'China', destinationCountry: cust.country,
      consignee: p.customerName, consignor: CONSIGNOR,
      declarant: 'Hank Zheng', agent: ship.customsBroker ?? '上海华港报关行',
      notes: null, createdAt: BigInt(shipMs - 2 * DAY), updatedAt: BigInt(shipMs), deletedAt: null,
    });
    p.linePlans.forEach((l, li) => {
      cdlRows.push({
        id: `${cdId}-L${li + 1}`, declarationId: cdId, lineNumber: li + 1,
        productCode: l.styleNo, productName: `Ladies' ${l.category}`,
        hsCode: HS_BY_CATEGORY[l.category] ?? '6204.43.00',
        brandName: null, specification: `${l.color} / SS26`,
        quantity: new Prisma.Decimal(l.qty), unit: 'PCS',
        unitPrice: new Prisma.Decimal(l.price), totalAmount: new Prisma.Decimal(l.netValue),
        currency: p.currency,
        grossWeight: new Prisma.Decimal(Math.round(l.qty * 0.38 * 100) / 100),
        netWeight: new Prisma.Decimal(Math.round(l.qty * 0.33 * 100) / 100),
        originCountry: 'China', notes: null,
        createdAt: BigInt(shipMs - 2 * DAY), updatedAt: BigInt(shipMs),
      });
    });
    shipmentUpdates.push({
      id: ship.id, declarationNumber, clearanceDate: isoDate(shipMs), updatedAt: shipMs,
    });

    // 单据中心归档：每票 3 张（B/L / CommercialInvoice / PackingList）
    const invoiceId = invoiceIdByOrder.get(p.id) ?? null;
    const docDefs: Array<{
      type: string; issueDate: string; issuedBy: string;
      totalAmount: Prisma.Decimal | null; currency: string | null;
      sourceInvoiceId: string | null; notes: string | null;
    }> = [
      {
        type: 'BillOfLading', issueDate: isoDate(shipMs), issuedBy: ship.carrierName ?? '货代签发',
        totalAmount: null, currency: null, sourceInvoiceId: null,
        notes: `提单随船签发（${ship.portOfLoading} → ${ship.portOfDischarge}）`,
      },
      {
        type: 'CommercialInvoice', issueDate: isoDate(shipMs), issuedBy: CONSIGNOR,
        totalAmount: new Prisma.Decimal(p.amount), currency: p.currency,
        sourceInvoiceId: invoiceId,
        notes: invoiceId ? '交单号=财务发票号（引用不复制）' : '财务发票缺失（SIM 兜底）',
      },
      {
        type: 'PackingList', issueDate: isoDate(shipMs - 1 * DAY), issuedBy: CONSIGNOR,
        totalAmount: null, currency: null, sourceInvoiceId: null,
        notes: `箱数 ${ship.totalPackages}，毛重 ${Number(ship.grossWeight)}kg，净重 ${Number(ship.netWeight)}kg`,
      },
    ];
    docDefs.forEach((d) => {
      const tdSeq = tdRows.length + 1;
      const tdId = `SIM-TD-${String(tdSeq).padStart(4, '0')}`;
      tdRows.push({
        id: tdId, documentNumber: tdId, domain: 'customs', type: d.type, status: 'Issued',
        shipmentId: ship.id, declarationId: cdId, orderId: p.id, relationId: p.customerId,
        sourceInvoiceId: d.sourceInvoiceId, sourceRef: null,
        issueDate: d.issueDate, expiryDate: null, issuedBy: d.issuedBy,
        consignee: p.customerName, consignor: CONSIGNOR,
        portOfLoading: ship.portOfLoading, portOfDischarge: ship.portOfDischarge,
        totalAmount: d.totalAmount, currency: d.currency,
        filePath: null, fileName: null, notes: d.notes,
        createdAt: BigInt(shipMs - 2 * DAY), updatedAt: BigInt(shipMs), deletedAt: null,
      });
      dverRows.push({
        id: `${tdId}-V1`, documentId: tdId, version: 1,
        content: {
          documentNumber: tdId, domain: 'customs', type: d.type, status: 'Issued',
          shipmentId: ship.id, declarationId: cdId, orderId: p.id,
          issueDate: d.issueDate, issuedBy: d.issuedBy,
          consignee: p.customerName, consignor: CONSIGNOR,
          portOfLoading: ship.portOfLoading, portOfDischarge: ship.portOfDischarge,
          totalAmount: d.totalAmount === null ? null : Number(d.totalAmount),
          currency: d.currency, notes: d.notes,
        },
        changeReason: null, changedBy: 'Hank Zheng', createdAt: BigInt(shipMs),
      });
    });
  });

  await createManyLogged(prisma, 'customsDeclaration', 'CustomsDeclaration', cdRows);
  await createManyLogged(prisma, 'customsDeclarationLine', 'CustomsDeclarationLine', cdlRows);
  await createManyLogged(prisma, 'tradeDocument', 'TradeDocument', tdRows);
  await createManyLogged(prisma, 'documentVersion', 'DocumentVersion', dverRows);

  // 回填 Shipment 报关单号 + 清关日期
  for (const u of shipmentUpdates) {
    await prisma.shipment.update({
      where: { id: u.id },
      data: {
        customsDeclarationNumber: u.declarationNumber,
        customsClearanceDate: u.clearanceDate,
        updatedAt: BigInt(u.updatedAt),
      },
    });
  }
  console.log(`  Shipment 回填（报关单号/清关日期）: ${shipmentUpdates.length} 票`);
}
