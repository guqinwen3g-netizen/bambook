/**
 * 出运制单数据装配服务 Document Set Assembly Service
 *
 * 职责：
 *   以 Shipment 为主轴，聚合 Order / OrderLine / CustomsDeclaration / Relation
 *   多源数据，解析出制单（CI/PL/CO/BL）所需的标准化字段。
 *
 * 设计原则：
 *   - 单一回退链真源：所有 "shipment → order → customs → relation" 的字段
 *     回退逻辑只在此服务内实现一次，前端模板只消费不决策。
 *   - 只读：不做任何写入，不产生副作用。
 *   - 宽容缺失：订单/报关单未关联时仍返回可用骨架（对应字段为 null），
 *     由前端 UI 提示数据完整度，而非阻断制单。
 */

import { PrismaClient } from '@prisma/client';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export interface DocumentSetLine {
  lineNumber: number;
  description: string;
  productCode: string | null;
  hsCode: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  cartons: number | null;
  grossWeight: number | null;
  netWeight: number | null;
  volume: number | null;
  originCountry: string | null;
}

export interface DocumentSetParty {
  name: string;
  address: string | null;
  contact: string | null;
}

export interface DocumentSetData {
  shipment: {
    id: string;
    shipmentNumber: string;
    status: string;
    type: string;
    shippingMethod: string | null;
    vesselOrFlight: string | null;
    voyageNumber: string | null;
    portOfLoading: string | null;
    portOfDischarge: string | null;
    containerNumber: string | null;
    sealNumber: string | null;
    bookingDate: string | null;
    etd: string | null;
    atd: string | null;
    eta: string | null;
    totalPackages: number | null;
    grossWeight: number | null;
    netWeight: number | null;
    volume: number | null;
    hsCode: string | null;
    customsDeclarationNumber: string | null;
    notes: string | null;
  };
  order: {
    id: string;
    poNumber: string | null;
    customer: string;
    currency: string | null;
    deliveryTerms: string | null;
    paymentTerms: string | null;
    salesContractNumber: string | null;
    finalContractNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
  } | null;
  customs: {
    declarationNumber: string;
    declarationDate: string | null;
    declarationPort: string | null;
    tradeTerms: string | null;
    totalValue: number | null;
    currency: string | null;
    originCountry: string | null;
    destinationCountry: string | null;
    consignee: string | null;
    consignor: string | null;
  } | null;
  parties: {
    /** 客户 / 收货人（CI 的 Buyer、PL 抬头） */
    customer: DocumentSetParty | null;
    /** 收货方（BL Consignee / CO Consignee） */
    consignee: DocumentSetParty | null;
    /** 货代/船公司 */
    carrier: { name: string } | null;
  };
  lines: DocumentSetLine[];
  totals: {
    quantity: number | null;
    amount: number | null;
    cartons: number | null;
    grossWeight: number | null;
    netWeight: number | null;
    volume: number | null;
    currency: string | null;
  };
  /** 数据完整度提示（供 UI 展示，不阻断） */
  missing: string[];
}

export type DocumentSetErrorCode = 'SHIPMENT_NOT_FOUND' | 'ASSEMBLE_FAILED';

export interface DocumentSetResult {
  ok: boolean;
  data?: DocumentSetData;
  error?: { code: DocumentSetErrorCode; message: string };
}

// ────────────────────────────────────────────────────────────────
// 辅助
// ────────────────────────────────────────────────────────────────

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/** 第一个非空值（null/undefined/'' 视为空） */
function first<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) {
    if (v !== null && v !== undefined && (v as any) !== '') return v;
  }
  return null;
}

function sumField(lines: DocumentSetLine[], key: keyof DocumentSetLine): number | null {
  let has = false;
  let sum = 0;
  for (const l of lines) {
    const v = l[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      has = true;
    }
  }
  return has ? Math.round(sum * 10000) / 10000 : null;
}

function relationToParty(rel: any, nameFallback?: string | null, addressFallback?: string | null, contactFallback?: string | null): DocumentSetParty | null {
  if (!rel && !nameFallback) return null;
  const name = str(rel?.englishName) ?? str(rel?.chineseName) ?? str(rel?.name) ?? str(nameFallback);
  if (!name) return null;
  return {
    name,
    address: str(rel?.officialAddress) ?? str(rel?.shippingAddress) ?? str(rel?.billingAddress) ?? str(addressFallback),
    contact: str(rel?.primaryContactName) ?? str(rel?.contact) ?? str(contactFallback),
  };
}

// ────────────────────────────────────────────────────────────────
// 主装配
// ────────────────────────────────────────────────────────────────

export async function assembleDocumentSetData(
  prisma: PrismaClient,
  shipmentId: string,
): Promise<DocumentSetResult> {
  try {
    const db = prisma as any;

    // 1) 运单（必须存在）
    const shipment = await db.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment || shipment.deletedAt) {
      return { ok: false, error: { code: 'SHIPMENT_NOT_FOUND', message: `运单 ${shipmentId} 不存在` } };
    }

    // 2) 并行拉取关联数据
    const [shipmentLines, order, customsDecl, customerRel, carrierRel] = await Promise.all([
      db.shipmentLine.findMany({ where: { shipmentId }, orderBy: { lineNumber: 'asc' } }),
      shipment.orderId
        ? db.order.findUnique({ where: { id: shipment.orderId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } })
        : Promise.resolve(null),
      db.customsDeclaration.findFirst({
        where: { shipmentId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      }),
      shipment.customerRelationId
        ? db.relation.findUnique({ where: { id: shipment.customerRelationId } })
        : Promise.resolve(null),
      shipment.carrierRelationId
        ? db.relation.findUnique({ where: { id: shipment.carrierRelationId } })
        : Promise.resolve(null),
    ]);

    const orderLines: any[] = order?.lines ?? [];
    const customsLines: any[] = customsDecl?.lines ?? [];

    // 3) 收货方 Relation（BL/CO 用）：优先 order.consigneeRelationId
    let consigneeRel: any = null;
    if (order?.consigneeRelationId) {
      consigneeRel = await db.relation.findUnique({ where: { id: order.consigneeRelationId } });
    }

    // 4) 行装配：以 shipmentLines 为主轴；无行时回退 orderLines
    const lines: DocumentSetLine[] = [];
    if (shipmentLines.length > 0) {
      for (const sl of shipmentLines) {
        const ol = sl.orderLineId ? orderLines.find((l) => l.id === sl.orderLineId) : orderLines[sl.lineNumber - 1];
        const cl = customsLines[sl.lineNumber - 1];
        const quantity = num(sl.quantity) ?? num(ol?.quantity) ?? num(cl?.quantity);
        const unitPrice = num(ol?.unitPrice) ?? num(cl?.unitPrice);
        const amount = num(ol?.netValue) ?? num(cl?.totalAmount)
          ?? (quantity !== null && unitPrice !== null ? Math.round(quantity * unitPrice * 10000) / 10000 : null);
        lines.push({
          lineNumber: sl.lineNumber,
          description: first(str(sl.productName), str(ol?.description), str(cl?.productName)) ?? `Line ${sl.lineNumber}`,
          productCode: first(str(sl.productCode), str(ol?.itemNo), str(cl?.productCode)),
          hsCode: first(str(sl.hsCode), str(cl?.hsCode), str(shipment.hsCode)),
          quantity,
          unit: first(str(sl.unit), str(ol?.unit), str(cl?.unit)),
          unitPrice,
          amount,
          cartons: num(sl.cartons),
          grossWeight: num(sl.grossWeight) ?? num(cl?.grossWeight),
          netWeight: num(sl.netWeight) ?? num(cl?.netWeight),
          volume: num(sl.volume),
          originCountry: first(str(sl.countryOfOrigin), str(cl?.originCountry), str(customsDecl?.originCountry)),
        });
      }
    } else {
      // 无装运行 → 从订单行构造骨架（箱规/重量留空）
      for (const ol of orderLines) {
        const cl = customsLines[ol.lineNumber - 1];
        const quantity = num(ol.quantity) ?? num(cl?.quantity);
        const unitPrice = num(ol.unitPrice) ?? num(cl?.unitPrice);
        const amount = num(ol.netValue) ?? num(cl?.totalAmount)
          ?? (quantity !== null && unitPrice !== null ? Math.round(quantity * unitPrice * 10000) / 10000 : null);
        lines.push({
          lineNumber: ol.lineNumber,
          description: first(str(ol.description), str(cl?.productName)) ?? `Line ${ol.lineNumber}`,
          productCode: first(str(ol.itemNo), str(cl?.productCode)),
          hsCode: first(str(cl?.hsCode), str(shipment.hsCode)),
          quantity,
          unit: first(str(ol.unit), str(cl?.unit)),
          unitPrice,
          amount,
          cartons: null,
          grossWeight: num(cl?.grossWeight),
          netWeight: num(cl?.netWeight),
          volume: null,
          originCountry: first(str(cl?.originCountry), str(customsDecl?.originCountry)),
        });
      }
    }

    // 5) 合计：行合计优先，运单级兜底
    const totals = {
      quantity: sumField(lines, 'quantity'),
      amount: sumField(lines, 'amount') ?? num(customsDecl?.totalValue) ?? num(order?.totalNet) ?? num(order?.quoteAmount),
      cartons: sumField(lines, 'cartons') ?? (num(shipment.totalPackages) ?? num(customsDecl?.totalPackages)),
      grossWeight: sumField(lines, 'grossWeight') ?? num(shipment.grossWeight) ?? num(customsDecl?.grossWeight),
      netWeight: sumField(lines, 'netWeight') ?? num(shipment.netWeight) ?? num(customsDecl?.netWeight),
      volume: sumField(lines, 'volume') ?? num(shipment.volume),
      currency: first(str(customsDecl?.currency), str(order?.currency), str(order?.salesCurrency)),
    };

    // 6) 当事方
    const customer = relationToParty(
      customerRel,
      first(str(shipment.customerName), str(order?.billToName), str(order?.customer)),
      first(str(order?.billToAddress), str(order?.customerAddress)),
      str(order?.billToContact),
    );
    const consignee = relationToParty(
      consigneeRel,
      first(str(order?.consigneeName), str(customsDecl?.consignee)),
      str(order?.consigneeAddress),
      str(order?.consigneeContact),
    ) ?? customer; // 无独立收货方时回退客户（常见：直客订单）
    const carrier = (() => {
      const name = str(carrierRel?.englishName) ?? str(carrierRel?.chineseName) ?? str(carrierRel?.name) ?? str(shipment.carrierName);
      return name ? { name } : null;
    })();

    // 7) 完整度提示
    const missing: string[] = [];
    if (!order) missing.push('未关联订单（缺少价格/条款来源）');
    if (!customsDecl) missing.push('未关联报关单（缺少申报要素）');
    if (lines.length === 0) missing.push('无行明细（装运行与订单行均为空）');
    if (totals.amount === null) missing.push('缺少金额（订单行无单价/净值）');
    if (totals.grossWeight === null) missing.push('缺少毛重');
    if (!customer) missing.push('缺少客户信息');

    return {
      ok: true,
      data: {
        shipment: {
          id: shipment.id,
          shipmentNumber: shipment.shipmentNumber,
          status: shipment.status,
          type: shipment.type,
          shippingMethod: str(shipment.shippingMethod),
          vesselOrFlight: str(shipment.vesselOrFlight),
          voyageNumber: str(shipment.voyageNumber),
          portOfLoading: str(shipment.portOfLoading),
          portOfDischarge: str(shipment.portOfDischarge),
          containerNumber: str(shipment.containerNumber),
          sealNumber: str(shipment.sealNumber),
          bookingDate: str(shipment.bookingDate),
          etd: str(shipment.etd),
          atd: str(shipment.atd),
          eta: str(shipment.eta),
          totalPackages: num(shipment.totalPackages),
          grossWeight: num(shipment.grossWeight),
          netWeight: num(shipment.netWeight),
          volume: num(shipment.volume),
          hsCode: str(shipment.hsCode),
          customsDeclarationNumber: first(str(shipment.customsDeclarationNumber), str(customsDecl?.declarationNumber)),
          notes: str(shipment.notes),
        },
        order: order
          ? {
              id: order.id,
              poNumber: str(order.poNumber),
              customer: order.customer,
              currency: first(str(order.currency), str(order.salesCurrency)),
              deliveryTerms: first(str(order.deliveryTerms), str(customsDecl?.tradeTerms)),
              paymentTerms: str(order.paymentTerms),
              salesContractNumber: str(order.salesContractNumber),
              finalContractNumber: str(order.finalContractNumber),
              invoiceNumber: str(order.invoiceNumber),
              invoiceDate: str(order.invoiceDate),
            }
          : null,
        customs: customsDecl
          ? {
              declarationNumber: customsDecl.declarationNumber,
              declarationDate: str(customsDecl.declarationDate),
              declarationPort: str(customsDecl.declarationPort),
              tradeTerms: str(customsDecl.tradeTerms),
              totalValue: num(customsDecl.totalValue),
              currency: str(customsDecl.currency),
              originCountry: str(customsDecl.originCountry),
              destinationCountry: str(customsDecl.destinationCountry),
              consignee: str(customsDecl.consignee),
              consignor: str(customsDecl.consignor),
            }
          : null,
        parties: { customer, consignee, carrier },
        lines,
        totals,
        missing,
      },
    };
  } catch (e: any) {
    return { ok: false, error: { code: 'ASSEMBLE_FAILED', message: String(e?.message ?? e) } };
  }
}
