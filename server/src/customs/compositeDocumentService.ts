/**
 * 组合文档服务（2026-08-22 B3 多选叠加生成 / B8 扩展 CONTRACT）—— 多对一数据层聚合。
 *
 * 架构裁决：
 *   - 叠加 = 数据聚合而非 PDF 拼页：多业务记录合并为单一数据集 → 单张文档呈现
 *   - 组合文档是即时性汇总产物，不登记 TradeDocument（无单一业务真源可回链，
 *     预览/生成走 composite 端点流式输出，与域单据归档体系互补）
 *   - 聚合复用既有装配器：合并 PL 逐运单调 assembleDocumentSetData（单一回退链
 *     真源不变），合并 IR 逐报告调 loadInspectionReportDocData
 *
 * 已支持组合类型：
 *   MERGED_PL — 多运单合并装箱单（合票出运场景：lines 重编行号 + 跨运单 totals 重算）
 *   MERGED_IR — 多验货报告合并汇总（跨报告合计 + 每报告一节）
 *   CONTRACT — 多订单合并销售合同（B8：订单一览 + 合并明细 + 通用条款；单订单确认走 OC 域单据）
 *   （CI 多订单合票走财务发票 orderIds[] 真源，已有能力，不在此重复）
 */

import { PrismaClient } from '@prisma/client';
import { assembleDocumentSetData } from '../shipping/documentSetService';
import { loadInspectionReportDocData } from '../templates/docTemplates/inspectionReport';
import type { MergedDocumentSetData, MergedDocumentSetLine } from '../templates/docTemplates/mergedPackingList';
import type { MergedInspectionSummaryData } from '../templates/docTemplates/mergedInspectionSummary';
import type { ContractDocData, ContractDocLine, ContractOrderInfo } from '../templates/docTemplates/contract';

/** 组合文档类型（COMPOSITE 注册表 kind——前端组合生成入口按此选择） */
export const COMPOSITE_DOC_KINDS = ['MERGED_PL', 'MERGED_IR', 'CONTRACT'] as const;
export type CompositeDocKind = (typeof COMPOSITE_DOC_KINDS)[number];

export interface CompositeDocInput {
  kind: CompositeDocKind;
  /** MERGED_PL：运单 id 列表（≥2）；MERGED_IR：验货报告 id 列表（≥2）；CONTRACT：订单 id 列表（≥2） */
  sourceIds: string[];
}

export function isCompositeDocKind(kind: string): kind is CompositeDocKind {
  return (COMPOSITE_DOC_KINDS as readonly string[]).includes(kind);
}

// ────────────────────────────────────────────────────────────────
// 1. MERGED_PL：多运单合并装配
// ────────────────────────────────────────────────────────────────

/**
 * 多运单合并装配（合票出运场景）：
 *   - 逐运单调 assembleDocumentSetData（字段回退链真源不变）→ 拼装
 *   - lines 重编行号 1..n，每行标注来源运单（shipmentIndex）
 *   - totals 对合并 lines 重算（与单运单 sumField 同语义），无行数据时运单级兜底相加
 *   - parties 取首个非空（合票通常同客户）；missing 汇总去重
 * 任一运单装配失败（不存在/软删）抛错整体失败（fail-closed，不生成半份合并单）。
 */
export async function assembleMergedDocumentSet(
  prisma: PrismaClient,
  shipmentIds: string[],
): Promise<MergedDocumentSetData> {
  if (!Array.isArray(shipmentIds) || shipmentIds.length < 2) {
    throw new Error('合并装箱单至少需要 2 个运单');
  }

  const results = await Promise.all(
    shipmentIds.map(async (id) => {
      const result = await assembleDocumentSetData(prisma, id);
      if (!result.ok || !result.data) {
        throw new Error(`运单 ${id} 装配失败：${result.error?.message ?? '数据缺失'}`);
      }
      return result.data;
    }),
  );

  const lines: MergedDocumentSetLine[] = [];
  results.forEach((ds, shipmentIndex) => {
    for (const l of ds.lines) {
      lines.push({ ...l, shipmentIndex: shipmentIndex + 1 });
    }
  });

  // totals：合并行求和（round 4），行级缺失时运单级兜底相加
  const sum = (vals: Array<number | null | undefined>, fallbacks: Array<number | null | undefined>): number | null => {
    const lineSum = vals.reduce<number | null>((acc, v) => (v == null ? acc : (acc ?? 0) + v), null);
    if (lineSum != null) return Math.round(lineSum * 10000) / 10000;
    const fallbackSum = fallbacks.reduce<number | null>((acc, v) => (v == null ? acc : (acc ?? 0) + v), null);
    return fallbackSum;
  };

  const currencies = results.map(ds => ds.totals.currency).filter(Boolean);
  const missing = [...new Set(results.flatMap(ds => ds.missing ?? []))];

  const firstParty = <T>(pick: (ds: (typeof results)[number]) => T | null | undefined): T | null => {
    for (const ds of results) {
      const v = pick(ds);
      if (v) return v;
    }
    return null;
  };

  return {
    shipments: results.map(ds => ds.shipment),
    orders: results.map(ds => ds.order),
    parties: {
      customer: firstParty(ds => ds.parties.customer),
      consignee: firstParty(ds => ds.parties.consignee),
      carrier: firstParty(ds => ds.parties.carrier),
    },
    lines,
    totals: {
      quantity: sum(lines.map(l => l.quantity), results.map(ds => ds.shipment.totalPackages)),
      amount: sum(lines.map(l => l.amount), results.map(ds => ds.totals.amount)),
      cartons: sum(lines.map(l => l.cartons), results.map(ds => ds.shipment.totalPackages)),
      grossWeight: sum(lines.map(l => l.grossWeight), results.map(ds => ds.shipment.grossWeight)),
      netWeight: sum(lines.map(l => l.netWeight), results.map(ds => ds.shipment.netWeight)),
      volume: sum(lines.map(l => l.volume), results.map(ds => ds.shipment.volume)),
      currency: currencies[0] ?? null,
    },
    missing,
  };
}

// ────────────────────────────────────────────────────────────────
// 2. MERGED_IR：多验货报告合并汇总
// ────────────────────────────────────────────────────────────────

/**
 * 多验货报告合并汇总装配：逐报告复用 loadInspectionReportDocData（真源实时装配），
 * 汇总缺陷/合格/结论分布。任一报告不存在抛错整体失败（fail-closed）。
 */
export async function loadMergedInspectionSummary(
  prisma: PrismaClient,
  reportIds: string[],
): Promise<MergedInspectionSummaryData> {
  if (!Array.isArray(reportIds) || reportIds.length < 2) {
    throw new Error('合并验货汇总至少需要 2 份报告');
  }

  const reports = await Promise.all(
    reportIds.map(async (id) => {
      const data = await loadInspectionReportDocData(prisma, id);
      if (!data) throw new Error(`验货报告 ${id} 不存在`);
      return data;
    }),
  );

  const totalUnits = reports.reduce((acc, r) => acc + r.report.totalUnits, 0);
  const passedUnits = reports.reduce((acc, r) => acc + r.report.passedUnits, 0);

  return {
    reports,
    summary: {
      count: reports.length,
      totalUnits,
      passedUnits,
      failedUnits: Math.max(0, totalUnits - passedUnits),
      criticalDefects: reports.reduce((acc, r) => acc + r.report.criticalDefects, 0),
      majorDefects: reports.reduce((acc, r) => acc + r.report.majorDefects, 0),
      minorDefects: reports.reduce((acc, r) => acc + r.report.minorDefects, 0),
      passCount: reports.filter(r => r.report.result === 'pass').length,
      conditionalCount: reports.filter(r => r.report.result === 'conditional').length,
      failCount: reports.filter(r => r.report.result === 'fail').length,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// 3. CONTRACT：多订单合并销售合同装配（B8）
// ────────────────────────────────────────────────────────────────

/**
 * 多订单合并合同装配：
 *   - 逐订单读取 Order + lines（真源实时装配），订单一览 + 合并明细（行标订单序号）
 *   - 合同号：首个非空 finalContractNumber / salesContractNumber（跨订单同号场景），
 *     否则 SC-YYYYMMDD-N 临时编号（仅展示用）
 *   - totals：行级 netValue 求和，缺失时订单级 quoteAmount 兜底相加；币种取首个非空
 *   - 客户档案：首个非空 customerRelationId 的 Relation；缺档案回落冗余 customer 名
 * 任一订单不存在/软删抛错整体失败（fail-closed，不生成半份合同）。
 */
export async function assembleContractData(
  prisma: PrismaClient,
  orderIds: string[],
): Promise<ContractDocData> {
  if (!Array.isArray(orderIds) || orderIds.length < 2) {
    throw new Error('合并合同至少需要 2 个订单（单订单确认请用订单确认书）');
  }

  const orders = await Promise.all(
    orderIds.map(async (id) => {
      const o = await prisma.order.findUnique({
        where: { id },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!o || o.deletedAt) throw new Error(`订单 ${id} 不存在`);
      return o;
    }),
  );

  const contractDate = new Date().toISOString().split('T')[0];
  const contractNumber =
    orders.map(o => o.finalContractNumber).find(Boolean) ||
    orders.map(o => o.salesContractNumber).find(Boolean) ||
    `SC-${contractDate.replace(/-/g, '')}-${orders.length}`;

  // 客户档案：首个非空 customerRelationId
  const firstRelationId = orders.map(o => o.customerRelationId).find(Boolean) ?? null;
  const relation = firstRelationId
    ? await prisma.relation.findUnique({ where: { id: firstRelationId } })
    : null;

  const orderInfos: ContractOrderInfo[] = orders.map((o, i) => ({
    index: i + 1,
    orderId: o.id,
    poNumber: o.poNumber,
    customer: o.customer,
    currency: String(o.currency || o.salesCurrency || 'USD'),
    quoteAmount: o.quoteAmount != null ? Number(o.quoteAmount) : null,
    dueDate: o.dueDate,
    deliveryTerms: o.deliveryTerms,
    paymentTerms: o.paymentTerms,
    salesContractNumber: o.salesContractNumber,
    finalContractNumber: o.finalContractNumber,
    lineCount: o.lines.length,
  }));

  const lines: ContractDocLine[] = [];
  orders.forEach((o, orderIdx) => {
    for (const l of o.lines) {
      lines.push({
        lineNumber: lines.length + 1,
        orderIndex: orderIdx + 1,
        itemNo: l.itemNo,
        description: l.description,
        quantity: l.quantity != null ? Number(l.quantity) : null,
        unit: l.unit,
        unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
        netValue: l.netValue != null ? Number(l.netValue) : null,
      });
    }
  });

  const sumNullable = (vals: Array<number | null>): number | null =>
    vals.reduce<number | null>((acc, v) => (v == null ? acc : (acc ?? 0) + v), null);

  const currencies = orderInfos.map(o => o.currency).filter(Boolean);
  const amount = sumNullable(lines.map(l => l.netValue)) ?? sumNullable(orderInfos.map(o => o.quoteAmount));

  return {
    contractNumber,
    contractDate,
    customer: relation
      ? { name: relation.name, englishName: relation.englishName, chineseName: relation.chineseName, contactInfo: relation.contactInfo }
      : null,
    orders: orderInfos,
    lines,
    totals: {
      currency: currencies[0] ?? 'USD',
      amount: amount != null ? Math.round(amount * 10000) / 10000 : null,
      quantity: sumNullable(lines.map(l => l.quantity)),
    },
  };
}

/**
 * 组合文档装配统一入口（route 层用）：
 * 按 kind 分发到对应聚合器，输出直接可喂 renderServerDocument 的数据。
 */
export async function assembleCompositeDocument(
  prisma: PrismaClient,
  input: CompositeDocInput,
): Promise<{ kind: CompositeDocKind; data: unknown }> {
  if (!isCompositeDocKind(input.kind)) throw new Error(`未知组合文档类型: ${input.kind}`);
  if (input.kind === 'MERGED_PL') {
    return { kind: input.kind, data: await assembleMergedDocumentSet(prisma, input.sourceIds) };
  }
  if (input.kind === 'CONTRACT') {
    return { kind: input.kind, data: await assembleContractData(prisma, input.sourceIds) };
  }
  return { kind: input.kind, data: await loadMergedInspectionSummary(prisma, input.sourceIds) };
}
