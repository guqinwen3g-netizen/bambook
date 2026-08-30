/**
 * company-sim/verify.ts — seed 自检：逐表 count 清单 + 抽 1 单 Delivered 全链完整性断言
 *   + 二期联动抽链（采购→来料→入库余额 / 报价→订单→报关→归档 / 测试 fail→整改闭环）
 */

import { PrismaClient } from '@prisma/client';

const COUNTED_TABLES: Array<[string, string]> = [
  // 主数据
  ['relation', 'Relation 关系档案'], ['contact', 'Contact 联系人'], ['creditLimit', 'CreditLimit 信用额度'],
  ['customerTier', 'CustomerTier 客户分层'], ['followUpRecord', 'FollowUpRecord 跟进'], ['opportunity', 'Opportunity 商机'],
  ['productAsset', 'ProductAsset 产品档案'], ['fabricProfile', 'FabricProfile'], ['garmentProfile', 'GarmentProfile'],
  ['trimmingProfile', 'TrimmingProfile'], ['fabricCompositionLine', 'FabricCompositionLine'],
  ['materialCompositionTerm', 'MaterialCompositionTerm'], ['fabricPriceHistory', 'FabricPriceHistory'],
  ['fabricCertification', 'FabricCertification'], ['productSubCategory', 'ProductSubCategory'],
  // 订单链
  ['order', 'Order 订单'], ['orderLine', 'OrderLine 行'], ['orderStatusTransition', 'OrderStatusTransition 流转审计'],
  ['productionStage', 'ProductionStage 生产阶段'], ['preCutChecklist', 'PreCutChecklist 裁前检查'],
  ['inspectionReport', 'InspectionReport QC 报告'],
  // 出运
  ['shipment', 'Shipment 运单'], ['shipmentLine', 'ShipmentLine'], ['shipmentOrderAllocation', 'ShipmentOrderAllocation'],
  ['orderShipmentBatch', 'OrderShipmentBatch 批次'], ['shipmentEvent', 'ShipmentEvent'], ['shipmentCarton', 'ShipmentCarton'],
  ['shipmentCartonItem', 'ShipmentCartonItem'], ['qCAssignment', 'QCAssignment'],
  // 财务
  ['invoice', 'Invoice 发票'], ['invoiceOrderAllocation', 'InvoiceOrderAllocation'], ['paymentVoucher', 'PaymentVoucher 凭证'],
  ['invoiceAllocation', 'InvoiceAllocation 核销'], ['dunningRecord', 'DunningRecord 催款'], ['dunningProfile', 'DunningProfile'],
  // 报价 / 采购库存（二期联动）
  ['quotation', 'Quotation 报价'], ['quotationLine', 'QuotationLine 报价行'], ['quotationVersion', 'QuotationVersion 报价版本'],
  ['warehouse', 'Warehouse 仓库'], ['purchaseOrder', 'PurchaseOrder 采购单'], ['purchaseLine', 'PurchaseLine 采购行'],
  ['materialReceipt', 'MaterialReceipt 来料检验'], ['inventoryItem', 'InventoryItem 库存项'],
  ['stockMovement', 'StockMovement 库存流水'], ['materialReturn', 'MaterialReturn 物料退换'],
  // 报关 / 单据归档（二期联动）
  ['customsDeclaration', 'CustomsDeclaration 报关单'], ['customsDeclarationLine', 'CustomsDeclarationLine 报关行'],
  ['tradeDocument', 'TradeDocument 单据归档'], ['documentVersion', 'DocumentVersion 单据版本'],
  // QC 指派 / 第三方测试（二期联动）
  ['testRequest', 'TestRequest 第三方测试'], ['testCorrectiveAction', 'TestCorrectiveAction 测试整改'],
  // 开发案 / 审批
  ['developmentCase', 'DevelopmentCase 开发案'], ['sampleNode', 'SampleNode'], ['approvalRequest', 'ApprovalRequest'],
  // CRM/HR/KB/邮件/洞察
  ['employeeProfile', 'EmployeeProfile 员工'], ['employmentEvent', 'EmploymentEvent'],
  ['performanceCycle', 'PerformanceCycle'], ['performanceReview', 'PerformanceReview'],
  ['knowledgeDocument', 'KnowledgeDocument'], ['knowledgeChunk', 'KnowledgeChunk'],
  ['insight', 'Insight 洞察'], ['email', 'Email 邮件'], ['auditLog', 'AuditLog 审计'],
];

async function countOf(prisma: PrismaClient, delegate: string): Promise<number> {
  const model = (prisma as any)[delegate];
  if (!model) return -1;
  return model.count();
}

async function assert(cond: boolean, label: string, detail?: unknown): Promise<void> {
  if (!cond) throw new Error(`❌ 全链自检失败: ${label}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`);
  console.log(`  ✓ ${label}`);
}

/** 抽 SIM-ORD-001（Delivered 全链样单）核对：订单→批次→出运→发票→回款各 ≥1 关联行 */
async function verifyFullChain(prisma: PrismaClient): Promise<void> {
  console.log('\n── 抽单全链核对：SIM-ORD-001（Delivered） ──');
  const orderId = 'SIM-ORD-001';
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert(!!order, 'Order 存在');
  assert(order!.status === 'Delivered', `Order.status=${order!.status}（期望 Delivered）`);
  assert((order!.code ?? '').startsWith('SIM-'), `Order.code=${order!.code}（SIM- 前缀避让发号器）`);

  const lines = await prisma.orderLine.findMany({ where: { orderId } });
  assert(lines.length >= 1, `OrderLine ${lines.length} 行（≥1）`);

  const transitions = await prisma.orderStatusTransition.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  assert(transitions.length === 4, `OrderStatusTransition ${transitions.length} 行（Pending→Confirmed→Production→Shipping→Delivered）`);
  assert(
    transitions.map((t) => t.toStatus).join('→') === 'Confirmed→Production→Shipping→Delivered',
    `流转链 = ${transitions.map((t) => t.toStatus).join('→')}`,
  );

  const stages = await prisma.productionStage.findMany({ where: { orderId } });
  assert(stages.length === 10, `ProductionStage ${stages.length} 行（10 阶段全量）`);
  assert(stages.every((s) => s.status === 'done'), 'ProductionStage 全部 done');

  const inspection = await prisma.inspectionReport.findFirst({ where: { orderId, inspectionType: 'final' } });
  assert(!!inspection && inspection.result === 'pass', 'InspectionReport final=pass（出运放行门禁）');

  const batches = await prisma.orderShipmentBatch.findMany({ where: { orderId } });
  assert(batches.length === 1, `OrderShipmentBatch ${batches.length} 批`);
  assert(batches[0].status === 'shipped', '批次 status=shipped');

  const shipments = await prisma.shipment.findMany({ where: { orderId, deletedAt: null } });
  assert(shipments.length === 1, `Shipment ${shipments.length} 票`);
  const shipment = shipments[0];
  assert(shipment.status === 'Delivered', `Shipment.status=${shipment.status}`);

  const shipLines = await prisma.shipmentLine.findMany({ where: { shipmentId: shipment.id } });
  assert(shipLines.length >= lines.length, `ShipmentLine ${shipLines.length} 行（≥OrderLine）`);
  const allocs = await prisma.shipmentOrderAllocation.findMany({ where: { shipmentId: shipment.id } });
  assert(allocs.length === 1 && allocs[0].status === 'Fulfilled', 'ShipmentOrderAllocation 1 行 Fulfilled');
  const events = await prisma.shipmentEvent.findMany({ where: { shipmentId: shipment.id } });
  assert(events.length >= 6, `ShipmentEvent ${events.length} 节点（订舱→…→签收）`);
  const cartons = await prisma.shipmentCarton.findMany({ where: { shipmentId: shipment.id } });
  const cartonItems = await prisma.shipmentCartonItem.findMany({ where: { cartonId: { in: cartons.map((c) => c.id) } } });
  assert(cartons.length >= 1 && cartonItems.length >= 1, `ShipmentCarton ${cartons.length} 箱 / CartonItem ${cartonItems.length} 行`);

  const invoices = await prisma.invoice.findMany({ where: { orderId, deletedAt: null } });
  assert(invoices.length === 1, `Invoice ${invoices.length} 张`);
  const invoice = invoices[0];
  assert(invoice.status === 'Paid', `Invoice.status=${invoice.status}`);
  const ioa = await prisma.invoiceOrderAllocation.findMany({ where: { invoiceId: invoice.id } });
  assert(ioa.length === 1 && ioa[0].batchId === batches[0].id, 'InvoiceOrderAllocation 1 行且挂批次');
  const vouchers = await prisma.paymentVoucher.findMany({ where: { invoiceId: invoice.id, deletedAt: null } });
  assert(vouchers.length === 1 && vouchers[0].status === 'reconciled', 'PaymentVoucher 1 张已核销');
  const vAllocs = await prisma.invoiceAllocation.findMany({ where: { invoiceId: invoice.id } });
  assert(vAllocs.length === 1, `InvoiceAllocation ${vAllocs.length} 行`);

  const audits = await prisma.auditLog.findMany({ where: { targetId: orderId } });
  assert(audits.length >= 8, `AuditLog ${audits.length} 条（建单→确认→生产→QC→出运→交付→开票→回款）`);
  console.log('\n✅ 抽单全链核对通过（SIM-ORD-001）。');
}

const close = (n: number, m: number): boolean => Math.abs(n - m) < 0.01;

/** 二期联动①：抽 1 张 PO 断言 PO→Receipt→StockMovement(Inbound)→InventoryItem 余额一致 + 来料退换闭环 */
async function verifyProcurementChain(prisma: PrismaClient): Promise<void> {
  console.log('\n── 二期抽链：采购→来料→入库→余额（SIM-PO-2001） ──');
  const po = await prisma.purchaseOrder.findUnique({ where: { id: 'SIM-PO-2001' }, include: { lines: true } });
  assert(!!po, 'PurchaseOrder 存在');
  assert(po!.status === 'Received', `PO.status=${po!.status}（期望 Received）`);
  assert(po!.orderId === 'SIM-ORD-001', `PO.orderId=${po!.orderId}（期望 SIM-ORD-001）`);

  const receipt = await prisma.materialReceipt.findFirst({ where: { purchaseOrderId: po!.id } });
  assert(!!receipt && receipt.status === 'Accepted', `MaterialReceipt 存在且 status=${receipt?.status}`);

  // L8 幂等口径：referenceType='PurchaseOrder' + referenceId=receipt.id
  const inMovements = await prisma.stockMovement.findMany({
    where: { referenceType: 'PurchaseOrder', referenceId: receipt!.id },
  });
  assert(inMovements.length >= 1 && inMovements.every((m) => m.type === 'Inbound'),
    `Inbound 流水 ${inMovements.length} 条（referenceType=PurchaseOrder/referenceId=receipt，L8 痕迹一致）`);

  const itemId = inMovements[0].itemId;
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  assert(!!item, `InventoryItem 存在（${itemId}）`);

  const movements = await prisma.stockMovement.findMany({
    where: { itemId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  let running = 0;
  let continuous = true;
  for (const m of movements) {
    if (!close(Number(m.balanceBefore), running) || !close(Number(m.balanceAfter), running + Number(m.quantity))) {
      continuous = false;
      break;
    }
    running = Number(m.balanceAfter);
  }
  assert(continuous, `流水 balanceBefore/After 连续（${movements.length} 条）`);
  assert(close(running, Number(item!.quantity)), `InventoryItem.quantity=${Number(item!.quantity)} = 流水期末余额 ${running}（入库-领料一致）`);

  // 来料退换闭环：totalRejected>0 的收料单挂 MaterialReturn(return, shipped, stockItemId 回填)
  const badReceipt = await prisma.materialReceipt.findFirst({ where: { totalRejected: { gt: 0 } } });
  assert(!!badReceipt && badReceipt.status === 'PartiallyAccepted', '存在 totalRejected>0 的收料单（PartiallyAccepted）');
  const ret = await prisma.materialReturn.findFirst({ where: { receiptId: badReceipt!.id } });
  assert(!!ret && ret.type === 'return' && ret.status === 'shipped' && !!ret.stockItemId,
    `MaterialReturn(return/shipped/stockItemId) 挂接正确（${ret?.returnNumber}）`);
  console.log('\n✅ 采购→来料→入库抽链核对通过。');
}

/** 二期联动③④：抽 1 张 Delivered 订单断言 Quotation(convertedOrderId)→Order→CustomsDeclaration→TradeDocument 链通 */
async function verifyQuotationCustomsChain(prisma: PrismaClient): Promise<void> {
  console.log('\n── 二期抽链：报价→订单→报关→归档（SIM-ORD-001） ──');
  const orderId = 'SIM-ORD-001';
  const quote = await prisma.quotation.findFirst({ where: { convertedOrderId: orderId, status: 'Accepted' } });
  assert(!!quote, 'Quotation(Accepted, convertedOrderId) 存在');
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert(order!.source === 'quotation-convert', `Order.source=${order!.source}（期望 quotation-convert）`);
  assert(close(Number(order!.quoteAmount), Number(quote!.totalAmount)), `Order.quoteAmount = Quotation.totalAmount = ${Number(quote!.totalAmount)}`);

  const qVersion = await prisma.quotationVersion.findFirst({ where: { quotationId: quote!.id, version: 1 } });
  assert(!!qVersion && !!qVersion.linesSnapshot, 'QuotationVersion v1（headerSnapshot/linesSnapshot）存在');

  const cd = await prisma.customsDeclaration.findFirst({ where: { orderId } });
  assert(!!cd && cd.status === 'Released', `CustomsDeclaration 存在且 status=${cd?.status}`);
  const shipment = await prisma.shipment.findFirst({ where: { orderId, deletedAt: null } });
  assert(shipment!.customsDeclarationNumber === cd!.declarationNumber, 'Shipment.customsDeclarationNumber 回填一致');
  assert(!!shipment!.customsClearanceDate, 'Shipment.customsClearanceDate 已回填');

  const tds = await prisma.tradeDocument.findMany({ where: { orderId } });
  const types = new Set(tds.map((t) => t.type));
  assert(tds.length >= 3 && types.has('BillOfLading') && types.has('CommercialInvoice') && types.has('PackingList'),
    `TradeDocument ${tds.length} 张，含 B/L + CommercialInvoice + PackingList`);
  assert(tds.some((t) => t.declarationId === cd!.id), 'TradeDocument.declarationId ↔ CustomsDeclaration 链通');
  const ci = tds.find((t) => t.type === 'CommercialInvoice');
  const invoice = await prisma.invoice.findFirst({ where: { orderId, deletedAt: null } });
  assert(!!ci && ci.sourceInvoiceId === invoice!.id, 'CommercialInvoice.sourceInvoiceId ↔ 财务 Invoice 链通');
  const dvers = await prisma.documentVersion.findMany({ where: { documentId: { in: tds.map((t) => t.id) } } });
  assert(dvers.length === tds.length && dvers.every((v) => v.version === 1 && !!v.content),
    `DocumentVersion v1 ${dvers.length}/${tds.length} 张齐全`);
  console.log('\n✅ 报价→订单→报关→归档抽链核对通过。');
}

/** 二期联动⑤：抽 1 张 fail TestRequest 断言 CorrectiveAction 存在且 closed */
async function verifyTestRequestChain(prisma: PrismaClient): Promise<void> {
  console.log('\n── 二期抽链：第三方测试 fail→整改闭环 ──');
  const failTr = await prisma.testRequest.findFirst({ where: { result: 'fail' } });
  assert(!!failTr, '存在 result=fail 的 TestRequest');
  assert((failTr!.failItems ?? []).length > 0, `failItems 已填（${(failTr!.failItems ?? []).join('/')}）`);
  const ca = await prisma.testCorrectiveAction.findFirst({ where: { testRequestId: failTr!.id } });
  assert(!!ca && ca.status === 'closed' && !!ca.closedAt, `TestCorrectiveAction status=${ca?.status}（closed 闭环）`);
  assert(ca!.failItem === failTr!.failItems[0], 'CorrectiveAction.failItem ↔ TestRequest.failItems 对应');
  const qc = await prisma.qCAssignment.findFirst({ where: { reportId: { not: null }, status: 'Completed' } });
  assert(!!qc, 'QCAssignment(Completed) 关联 InspectionReport 存在');
  console.log('\n✅ 第三方测试 fail→整改闭环抽链核对通过。');
}

export async function verifySeed(prisma: PrismaClient): Promise<void> {
  console.log('\n════════ 各表 count 清单 ════════');
  let fail = false;
  for (const [delegate, label] of COUNTED_TABLES) {
    const n = await countOf(prisma, delegate);
    if (n < 0) {
      console.log(`  ⚠ ${label}: delegate 缺失`);
      fail = true;
      continue;
    }
    console.log(`  ${String(n).padStart(6)}  ${label}`);
  }
  if (fail) throw new Error('部分表无法统计，请检查 delegate 命名');

  // 剧情分布断言
  const byStatus = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  console.log('\n── 订单状态分布 ──');
  const expect: Record<string, number> = { Delivered: 34, Shipping: 4, Production: 9, Confirmed: 6, Pending: 3 };
  const totalOrders = byStatus.reduce((s, g) => s + g._count._all, 0);
  assert(totalOrders === 56, `订单总数 = ${totalOrders}（期望 56）`);
  for (const g of byStatus) {
    console.log(`  ${g.status.padEnd(12)} ${g._count._all}`);
    if (expect[g.status] !== undefined) {
      assert(g._count._all === expect[g.status], `状态 ${g.status} = ${g._count._all}（期望 ${expect[g.status]}）`);
    }
  }
  // Pending 单均在最近一周（W13 起 2026-08-24）
  const pendings = await prisma.order.findMany({ where: { status: 'Pending' }, select: { createdAt: true, code: true } });
  const w13 = Date.UTC(2026, 7, 24);
  assert(pendings.every((p) => p.createdAt.getTime() >= w13), '3 单 Pending 均创建于最近一周（≥2026-08-24）');
  // 无非 SIM 编号
  const foreign = await prisma.order.count({ where: { code: { not: { startsWith: 'SIM-' } } } });
  assert(foreign === 0, `无非 SIM- 编号订单残留（${foreign}）`);

  await verifyFullChain(prisma);
  await verifyProcurementChain(prisma);
  await verifyQuotationCustomsChain(prisma);
  await verifyTestRequestChain(prisma);
  console.log('\n✅ 二期联动抽链核对全部通过（采购库存 / 报价报关 / 测试整改）。');
}
