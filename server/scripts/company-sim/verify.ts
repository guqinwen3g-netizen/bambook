/**
 * company-sim/verify.ts — seed 自检：逐表 count 清单 + 抽 1 单 Delivered 全链完整性断言
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
}
