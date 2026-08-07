import { PrismaClient, Prisma } from '@prisma/client';

export type StructuredOrderQueryInput = Record<string, unknown>;

export async function queryOrders(prisma: PrismaClient, input: StructuredOrderQueryInput = {}) {
  const normalized = normalizeOrderQuery(input);
  const where = buildOrderQueryWhere(normalized);
  const orderBy = orderQueryOrderBy(normalized.sort);

  if (normalized.aggregate === 'count') {
    const count = await prisma.order.count({ where });
    return {
      dataSource: 'bambook-data-center',
      entity: 'Order',
      aggregate: 'count',
      count,
      filters: normalized.filters,
      sort: normalized.sort,
    };
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy,
      take: normalized.limit,
      skip: normalized.offset,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    dataSource: 'bambook-data-center',
    entity: 'Order',
    aggregate: normalized.aggregate,
    query: normalized.query,
    filters: normalized.filters,
    sort: normalized.sort,
    total,
    count: orders.length,
    limit: normalized.limit,
    offset: normalized.offset,
    hasMore: normalized.offset + orders.length < total,
    items: orders.map(order => formatOrder(order)),
  };
}

export async function getOrder(prisma: PrismaClient, input: StructuredOrderQueryInput = {}) {
  const id = cleanText(input.id);
  const poNumber = cleanText(input.poNumber || input.po);
  const where = id
    ? { deletedAt: null, OR: [{ id }, { poNumber: id }] }
    : poNumber
      ? { poNumber, deletedAt: null }
      : null;
  if (!where) return { dataSource: 'bambook-data-center', found: false, reason: 'MISSING_ORDER_IDENTIFIER', input };
  const order = await prisma.order.findFirst({
    where: where as any,
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  return order
    ? { dataSource: 'bambook-data-center', found: true, item: formatOrder(order, true) }
    : { dataSource: 'bambook-data-center', found: false, input };
}

// ---------------------------------------------------------------------------
// 阶段 D / D3：订单全链路聚合（只读，直接查表制）
// 按业务阶段分组返回订单生命周期的全部关联实体摘要：
//   报价 → 开发 → BOM → 采购 → 生产(阶段+验货) → 外协 → 出运(报关+退税) → 财务(发票+核销+凭证)
// 各段只取摘要字段（id/编号/状态/金额/日期），不做全字段展开。
// 双轨制：EntityLink 图谱服务"关联面板"横向发现；本函数服务"全链路视图"纵向生命周期。
// ---------------------------------------------------------------------------

export async function getOrderContext(prisma: PrismaClient, orderIdRaw: unknown) {
  const id = cleanText(orderIdRaw);
  if (!id) return { found: false as const, reason: 'MISSING_ORDER_IDENTIFIER' };

  const order = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id }, { poNumber: id }] },
    select: { id: true, poNumber: true },
  });
  if (!order) return { found: false as const };

  const orderId = order.id;
  const active = { deletedAt: null } as const;

  const [
    quotations,
    developmentCases,
    boms,
    purchaseOrders,
    productionStages,
    inspections,
    outsourcingOrders,
    shipments,
    invoices,
    vouchers,
  ] = await Promise.all([
    (prisma as any).quotation.findMany({
      where: { ...active, convertedOrderId: orderId },
      select: { id: true, quotationNumber: true, status: true, currency: true, totalAmount: true, issueDate: true },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).developmentCase.findMany({
      where: { ...active, linkedOrderId: orderId },
      select: { id: true, code: true, name: true, type: true, stage: true, currentRound: true },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).bOM.findMany({
      where: { ...active, orderId },
      select: { id: true, bomNumber: true, status: true, version: true, totalCost: true, currency: true },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).purchaseOrder.findMany({
      where: { ...active, orderId },
      select: {
        id: true, poNumber: true, status: true, supplierName: true,
        currency: true, totalAmount: true, orderDate: true, expectedDeliveryDate: true, actualDeliveryDate: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).productionStage.findMany({
      where: { orderId },
      select: { id: true, stageKey: true, stageSeq: true, status: true, startedAt: true, doneAt: true },
      orderBy: { stageSeq: 'asc' },
    }),
    (prisma as any).inspectionReport.findMany({
      where: { orderId },
      select: {
        id: true, inspectionType: true, result: true, inspectionDate: true, aqlLevel: true,
        criticalDefects: true, majorDefects: true, minorDefects: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    (prisma as any).outsourcingOrder.findMany({
      where: { ...active, orderId },
      select: {
        id: true, orderNumber: true, processType: true, status: true, quantity: true, unit: true,
        plannedDeliveryDate: true, actualDeliveryDate: true, qualityAcceptedQty: true, qualityRejectedQty: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).shipment.findMany({
      where: { ...active, orderId },
      select: {
        id: true, shipmentNumber: true, status: true, shippingMethod: true,
        etd: true, atd: true, eta: true, ata: true, portOfLoading: true, portOfDischarge: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).invoice.findMany({
      where: { ...active, orderId },
      select: {
        id: true, invoiceNumber: true, type: true, status: true, amount: true, currency: true,
        issueDate: true, dueDate: true, settlementDate: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).paymentVoucher.findMany({
      where: { ...active, orderId },
      select: {
        id: true, voucherNumber: true, type: true, status: true, amount: true, currency: true,
        paymentDate: true, invoiceId: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // 二级查询：样衣节点 / 报关单 / 退税 / 核销明细
  const caseIds = developmentCases.map((c: any) => c.id);
  const shipmentIds = shipments.map((s: any) => s.id);
  const invoiceIds = invoices.map((i: any) => i.id);

  const [sampleNodes, customsDeclarations, allocations] = await Promise.all([
    caseIds.length
      ? (prisma as any).sampleNode.findMany({
          where: { deletedAt: null, developmentCaseId: { in: caseIds } },
          select: { id: true, developmentCaseId: true, level: true, round: true, status: true, sentDate: true, approvedAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    (prisma as any).customsDeclaration.findMany({
      where: { ...active, OR: [{ orderId }, { shipmentId: { in: shipmentIds } }] },
      select: {
        id: true, declarationNumber: true, status: true, shipmentId: true,
        declarationDate: true, totalValue: true, currency: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    invoiceIds.length
      ? (prisma as any).invoiceAllocation.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: { id: true, invoiceId: true, voucherId: true, appliedAmount: true, appliedDate: true },
          orderBy: { createdAt: 'asc' },
        })
      : [],
  ]);

  const declarationIds = customsDeclarations.map((d: any) => d.id);
  // 退税按 orderId 或 declarationId 双路匹配（declarationId 空集时 `in: []` 不命中，无副作用）
  const taxRefunds = await (prisma as any).taxRefund.findMany({
    where: { ...active, OR: [{ orderId }, { declarationId: { in: declarationIds } }] },
    select: {
      id: true, refundNumber: true, status: true, declarationId: true,
      exportAmountFob: true, exportAmountFobCurrency: true, refundAmount: true, refundDate: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // 嵌套装配：样衣节点 → 开发案；报关单 → 运单；退税 → 报关单；核销 → 发票
  const nodesByCase = new Map<string, any[]>();
  for (const n of sampleNodes as any[]) {
    const list = nodesByCase.get(n.developmentCaseId) ?? [];
    list.push(n);
    nodesByCase.set(n.developmentCaseId, list);
  }
  const refundsByDeclaration = new Map<string, any[]>();
  const orphanRefunds: any[] = [];
  for (const r of taxRefunds as any[]) {
    if (r.declarationId && declarationIds.includes(r.declarationId)) {
      const list = refundsByDeclaration.get(r.declarationId) ?? [];
      list.push(r);
      refundsByDeclaration.set(r.declarationId, list);
    } else {
      orphanRefunds.push(r);
    }
  }
  const declarationsByShipment = new Map<string, any[]>();
  const orphanDeclarations: any[] = [];
  for (const d of customsDeclarations as any[]) {
    const withRefunds = { ...d, taxRefunds: refundsByDeclaration.get(d.id) ?? [] };
    if (d.shipmentId && shipmentIds.includes(d.shipmentId)) {
      const list = declarationsByShipment.get(d.shipmentId) ?? [];
      list.push(withRefunds);
      declarationsByShipment.set(d.shipmentId, list);
    } else {
      orphanDeclarations.push(withRefunds);
    }
  }
  const allocationsByInvoice = new Map<string, any[]>();
  for (const a of allocations as any[]) {
    const list = allocationsByInvoice.get(a.invoiceId) ?? [];
    list.push(a);
    allocationsByInvoice.set(a.invoiceId, list);
  }

  return serializeBigInts({
    found: true as const,
    order: { id: order.id, poNumber: order.poNumber },
    quotation: quotations,
    developmentCase: (developmentCases as any[]).map((c) => ({ ...c, sampleNodes: nodesByCase.get(c.id) ?? [] })),
    bom: boms,
    procurement: purchaseOrders,
    production: { stages: productionStages, inspections },
    outsourcing: outsourcingOrders,
    shipments: (shipments as any[]).map((s) => ({ ...s, customsDeclarations: declarationsByShipment.get(s.id) ?? [] })),
    customsDeclarations: orphanDeclarations,
    taxRefunds: orphanRefunds,
    finance: {
      invoices: (invoices as any[]).map((i) => ({ ...i, allocations: allocationsByInvoice.get(i.id) ?? [] })),
      vouchers,
    },
  });
}


export function describeOrderSchema() {
  return {
    entity: 'Order',
    sourceOfTruth: 'Bambook backend database',
    purpose: '让 Agent 像订单页面一样按订单号、客户、供应商、交期、状态、发票、样品和生产字段做只读查询。',
    tools: {
      query: { id: 'orders.query', useWhen: '需要 count/list/detail 模式、筛选、排序和分页读取订单。' },
      get: { id: 'orders.get', useWhen: '已有订单 id 或 PO，需要读取单条订单与订单行。' },
    },
    fields: [
      'id', 'poNumber', 'customer', 'customerCode', 'status', 'product', 'type',
      'dueDate', 'clientDate', 'productionDate', 'shipmentDate', 'invoiceNumber',
      'supplierInvoiceNumber', 'millName', 'billToName', 'consigneeName',
      'paymentTerms', 'salesCurrency', 'purchaseCurrency', 'sampleSentDate',
      'fabricSampleSentDate', 'productionBatch', 'fabricCode', 'fabricContent',
      'lines.materialCode', 'lines.millQuality', 'lines.description', 'lines.deliveryDate',
    ],
    aggregateModes: ['count', 'list', 'detail'],
    writableNow: false,
  };
}

function normalizeOrderQuery(input: StructuredOrderQueryInput) {
  const filters = input && typeof input.filters === 'object' && input.filters ? input.filters as Record<string, unknown> : {};
  const sort = input && typeof input.sort === 'object' && input.sort ? input.sort as Record<string, unknown> : {};
  return {
    aggregate: cleanText(input.aggregate) === 'count' ? 'count' : cleanText(input.aggregate) === 'detail' ? 'detail' : 'list',
    query: cleanText(input.query),
    filters: {
      statuses: arrayOfText(filters.statuses || filters.status),
      customer: cleanText(filters.customer),
      supplier: cleanText(filters.supplier || filters.millName),
      poNumber: cleanText(filters.poNumber || filters.po),
      dueDateFrom: cleanDate(filters.dueDateFrom),
      dueDateTo: cleanDate(filters.dueDateTo),
      createdAtFrom: cleanDate(filters.createdAtFrom || filters.createdFrom),
      createdAtTo: cleanDate(filters.createdAtTo || filters.createdTo),
      missingFields: arrayOfText(filters.missingFields),
      fieldFilters: normalizeFieldFilters(filters.fieldFilters),
    },
    sort: {
      field: cleanText(sort.field) || 'updatedAt',
      direction: cleanText(sort.direction).toLowerCase() === 'asc' ? 'asc' : 'desc',
    },
    limit: numberInput(input.limit, cleanText(input.aggregate) === 'detail' ? 1 : 20, 1, 200),
    offset: numberInput(input.offset, 0, 0, 1_000_000),
  };
}

function buildOrderQueryWhere(input: ReturnType<typeof normalizeOrderQuery>) {
  const and: any[] = [{ deletedAt: null }];
  const textContains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

  if (input.query) {
    and.push({
      OR: [
        { id: input.query },
        { poNumber: textContains(input.query) },
        { customer: textContains(input.query) },
        { customerCode: textContains(input.query) },
        { product: textContains(input.query) },
        { millName: textContains(input.query) },
        { billToName: textContains(input.query) },
        { consigneeName: textContains(input.query) },
        { invoiceNumber: textContains(input.query) },
        { supplierInvoiceNumber: textContains(input.query) },
        { fabricCode: textContains(input.query) },
        { fabricContent: textContains(input.query) },
        { lines: { some: { materialCode: textContains(input.query) } } },
        { lines: { some: { millQuality: textContains(input.query) } } },
        { lines: { some: { description: textContains(input.query) } } },
      ],
    });
  }
  if (input.filters.poNumber) and.push({ poNumber: textContains(input.filters.poNumber) });
  if (input.filters.customer) {
    and.push({
      OR: [
        { customer: textContains(input.filters.customer) },
        { billToName: textContains(input.filters.customer) },
        { customerCode: textContains(input.filters.customer) },
      ],
    });
  }
  if (input.filters.supplier) {
    and.push({
      OR: [
        { millName: textContains(input.filters.supplier) },
        { millRelationId: textContains(input.filters.supplier) },
        { lines: { some: { millQuality: textContains(input.filters.supplier) } } },
      ],
    });
  }
  if (input.filters.statuses.length) {
    and.push({ OR: input.filters.statuses.map(status => ({ status: textContains(status) })) });
  }
  if (input.filters.dueDateFrom) and.push({ dueDate: { gte: input.filters.dueDateFrom } });
  if (input.filters.dueDateTo) and.push({ dueDate: { lte: input.filters.dueDateTo } });
  if (input.filters.createdAtFrom) {
    const ts = Date.parse(input.filters.createdAtFrom);
    if (Number.isFinite(ts)) and.push({ createdAt: { gte: BigInt(ts) } });
  }
  if (input.filters.createdAtTo) {
    const ts = Date.parse(input.filters.createdAtTo);
    if (Number.isFinite(ts)) and.push({ createdAt: { lte: BigInt(ts) } });
  }
  for (const field of input.filters.missingFields) {
    const mapped = ORDER_QUERY_FIELDS[field] || field;
    if (ORDER_QUERY_FIELDS[field] || SAFE_ORDER_FIELDS.has(mapped)) {
      and.push({ OR: [{ [mapped]: null }, { [mapped]: '' }] });
    }
  }
  for (const filter of input.filters.fieldFilters) {
    const where = orderFieldFilterWhere(filter);
    if (where) and.push(where);
  }
  return and.length === 1 ? and[0] : { AND: and };
}

function orderFieldFilterWhere(filter: { path: string; operator: string; value: unknown }) {
  const mapped = ORDER_QUERY_FIELDS[filter.path] || filter.path;
  if (!SAFE_ORDER_FIELDS.has(mapped)) return null;
  const value = cleanText(filter.value);
  if (!value) return null;
  if (filter.operator === 'equals') return { [mapped]: { equals: value, mode: 'insensitive' as const } };
  if (filter.operator === 'missing') return { OR: [{ [mapped]: null }, { [mapped]: '' }] };
  return { [mapped]: { contains: value, mode: 'insensitive' as const } };
}

function orderQueryOrderBy(sort: { field: string; direction: string }) {
  const direction = sort.direction === 'asc' ? 'asc' : 'desc';
  const field = ORDER_SORT_FIELDS.has(sort.field) ? sort.field : 'updatedAt';
  return { [field]: direction };
}

function formatOrder(order: any, full = false) {
  const base = serializeBigInts({
    id: order.id,
    poNumber: order.poNumber,
    customer: order.customer,
    customerCode: order.customerCode,
    product: order.product,
    type: order.type,
    quantity: order.quantity,
    status: order.status,
    dueDate: order.dueDate,
    clientDate: order.clientDate,
    productionDate: order.productionDate,
    shipmentDate: order.shipmentDate,
    invoiceNumber: order.invoiceNumber,
    supplierInvoiceNumber: order.supplierInvoiceNumber,
    millName: order.millName,
    billToName: order.billToName,
    consigneeName: order.consigneeName,
    paymentTerms: order.paymentTerms,
    salesCurrency: order.salesCurrency,
    purchaseCurrency: order.purchaseCurrency,
    updatedAt: order.updatedAt,
    importedAt: order.importedAt,
  });
  if (!full) {
    return {
      ...base,
      lines: Array.isArray(order.lines) ? order.lines.slice(0, 5).map(formatOrderLine) : [],
    };
  }
  return serializeBigInts({ ...order, lines: Array.isArray(order.lines) ? order.lines.map(formatOrderLine) : [] });
}

function formatOrderLine(line: any) {
  return serializeBigInts({
    id: line.id,
    lineNumber: line.lineNumber,
    itemNo: line.itemNo,
    materialCode: line.materialCode,
    millQuality: line.millQuality,
    description: line.description,
    deliveryDate: line.deliveryDate,
    quantity: line.quantity,
    status: line.status,
    invoiceNumber: line.invoiceNumber,
  });
}

function normalizeFieldFilters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map(item => ({
      path: cleanText(item!.path),
      operator: cleanText(item!.operator) || 'contains',
      value: item!.value,
    }))
    .filter(item => item.path)
    .slice(0, 20);
}

function arrayOfText(value: unknown) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map(cleanText).filter(Boolean).slice(0, 20);
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function numberInput(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  if (Prisma.Decimal.isDecimal(value)) return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = serializeBigInts(item);
    return out as T;
  }
  return value;
}

const ORDER_QUERY_FIELDS: Record<string, string> = {
  po: 'poNumber',
  customerName: 'customer',
  supplier: 'millName',
  supplierInvoice: 'supplierInvoiceNumber',
  invoice: 'invoiceNumber',
  exmill: 'clientDate',
};

const SAFE_ORDER_FIELDS = new Set([
  'id', 'poNumber', 'customer', 'customerCode', 'product', 'type', 'status',
  'dueDate', 'clientDate', 'productionDate', 'shipmentDate', 'invoiceNumber',
  'supplierInvoiceNumber', 'millName', 'billToName', 'consigneeName',
  'paymentTerms', 'salesCurrency', 'purchaseCurrency', 'fabricCode',
  'fabricContent', 'productionBatch', 'sampleSentDate', 'fabricSampleSentDate',
]);

const ORDER_SORT_FIELDS = new Set(['updatedAt', 'importedAt', 'dueDate', 'clientDate', 'customer', 'status', 'poNumber']);
