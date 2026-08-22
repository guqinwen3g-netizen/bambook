/**
 * 服务端单据模板注册表（2026-08-22 全系统文档体系 B1 架构底座 / B2 运营域扩展）。
 *
 * 架构裁决：
 *   - 模板真源统一服务端（前端 EXPORT_DOC_RENDERERS 逐类退役，B6 收尾）
 *   - 每个 docKind 一个注册项：loadData（数据装配）+ renderBody（渲染）
 *     · PL：版本快照 documentSet（customs 域，生成时快照冻结）
 *     · PO/IR/QUOT/OC：业务真源实时装配（运营域——sourceRef 回链，改业务侧即改文档）
 *     · FIN_CI/STMT：完整文档形态（renderDocument，自带 doc-* 头部样式）——
 *       B11 收编：财务发票从 finance/route.ts 原位提取入注册表，此处为全站模板唯一目录
 *   - 组装统一走 buildServerDocument（doc-* 基座），preview.html 用 screen 模式
 *
 * 已注册（B1-B9）：PL/PO/IR/CI/CO/BL/INS/FORMA/BC/QUOT/OC/CONTRACT/MERGED_PL/MERGED_IR/STMT/FIN_CI
 * 待注册：AWB 空运单（B11+，schema 枚举已留位）
 */

import { PrismaClient } from '@prisma/client';
import { getSystemConfigService } from '../../config/systemConfigService';
import { DEFAULT_EXPORTER_PROFILE, EXPORTER_PROFILE_CONFIG_KEY } from '../../config/systemConfigRoute';
import { buildServerDocument } from '../docPrintBase';
import { renderPackingListBody, type DocExporterProfile } from './packingList';
import { renderPurchaseOrderBody, loadPurchaseOrderDocData } from './purchaseOrder';
import { renderInspectionReportBody, loadInspectionReportDocData } from './inspectionReport';
import { renderMergedPackingListBody } from './mergedPackingList';
import { renderMergedInspectionSummaryBody } from './mergedInspectionSummary';
import { renderCertificateOfOriginBody, renderBillOfLadingBody, renderInsurancePolicyBody, renderCommercialInvoiceBody, renderFormABody, renderBeneficiaryCertificateBody, renderAirWaybillBody } from './customsDocs';
import { renderQuotationBody, loadQuotationDocData } from './quotation';
import { renderOrderConfirmationBody, loadOrderConfirmationDocData } from './orderConfirmation';
import { renderContractBody } from './contract';
import { renderStatementBody } from './statement';
import { renderFinanceInvoiceDocument } from './financeInvoice';
import type { ServerDocumentSetData } from './types';

/** 注册表渲染上下文：单据定位信息（loadData 按各自真源装配） */
export interface ServerDocContext {
  id: string;
  type: string;
  sourceRef: string | null;
}

export interface ServerDocTemplate {
  /** 模板标识（与 TradeDocumentType 对齐或扩展） */
  kind: string;
  title: string;
  /** 数据装配：按模板各自真源（版本快照 / 业务外链）读取，失败返回 null（调用方 404） */
  loadData: (prisma: PrismaClient, doc: ServerDocContext) => Promise<any | null>;
  /** data → HTML body 片段（经 buildServerDocument 组装） */
  renderBody: (data: any, exporter: DocExporterProfile) => string;
  /**
   * 完整文档渲染器（自带 doc-* 头部样式 + screen 画布壳的模板，如财务发票）——
   * 设置后 renderServerDocument 直接返回其输出，不走 renderBody 片段路径。
   * B11 收编：财务发票从 finance/route.ts 原位提取，注册表成为全站模板唯一目录。
   */
  renderDocument?: (prisma: PrismaClient, ctx: ServerDocContext, opts: { screen?: boolean }) => Promise<string | null>;
}

/** TradeDocumentType → 服务端模板 kind（模板注册地即映射真源） */
const TRADE_DOC_TYPE_TO_KIND: Partial<Record<string, string>> = {
  CommercialInvoice: 'CI', // documentSet 快照版（带财务回链的 CI 在 lifecycleService 优先走财务真源模板）
  PackingList: 'PL',
  CertificateOfOrigin: 'CO',
  BillOfLading: 'BL',
  AirWaybill: 'AWB',
  InsuranceCert: 'INS',
  PurchaseOrder: 'PO',
  InspectionReport: 'IR',
  Quotation: 'QUOT',
  OrderConfirmation: 'OC',
};

/** 出运制单 kind 集合（ShipmentDocumentGenerator 按运单渲染入口用——B6 前端模板退役；B11 增 AWB） */
export const SHIPMENT_DOC_KINDS = ['CI', 'PL', 'CO', 'BL', 'AWB', 'FORMA', 'INS', 'BC'] as const;
export type ShipmentDocKind = (typeof SHIPMENT_DOC_KINDS)[number];

export function isShipmentDocKind(kind: string): kind is ShipmentDocKind {
  return (SHIPMENT_DOC_KINDS as readonly string[]).includes(kind);
}

/** 按单据类型查服务端模板 kind（未迁移类型返回 null——前端本地渲染兜底） */
export function serverKindForType(type: string): string | null {
  return TRADE_DOC_TYPE_TO_KIND[type] ?? null;
}

/** PL 数据装配：最新版本快照的 documentSet（customs 域——生成时快照冻结，无快照返回 null） */
async function loadDocumentSetSnapshot(prisma: PrismaClient, doc: ServerDocContext): Promise<any | null> {
  const latest = await prisma.documentVersion.findFirst({
    where: { documentId: doc.id },
    orderBy: { version: 'desc' },
    select: { content: true },
  });
  const ds = (latest?.content as Record<string, unknown> | null | undefined)?.documentSet;
  return ds && typeof ds === 'object' ? ds : null;
}

export const SERVER_DOC_TEMPLATES: Record<string, ServerDocTemplate> = {
  CI: { kind: 'CI', title: 'Commercial Invoice 商业发票', loadData: loadDocumentSetSnapshot, renderBody: renderCommercialInvoiceBody },
  PL: { kind: 'PL', title: 'Packing List 装箱单', loadData: loadDocumentSetSnapshot, renderBody: renderPackingListBody },
  CO: { kind: 'CO', title: 'Certificate of Origin 原产地证', loadData: loadDocumentSetSnapshot, renderBody: renderCertificateOfOriginBody },
  BL: { kind: 'BL', title: 'Bill of Lading 提单补料', loadData: loadDocumentSetSnapshot, renderBody: renderBillOfLadingBody },
  AWB: { kind: 'AWB', title: 'Air Waybill 空运单', loadData: loadDocumentSetSnapshot, renderBody: renderAirWaybillBody },
  INS: { kind: 'INS', title: 'Insurance Policy 保险单', loadData: loadDocumentSetSnapshot, renderBody: renderInsurancePolicyBody },
  FORMA: { kind: 'FORMA', title: 'GSP Form A 普惠制原产地证', loadData: loadDocumentSetSnapshot, renderBody: renderFormABody },
  BC: { kind: 'BC', title: "Beneficiary's Certificate 受益人证明", loadData: loadDocumentSetSnapshot, renderBody: renderBeneficiaryCertificateBody },
  PO: { kind: 'PO', title: 'Purchase Order 采购订单', loadData: async (prisma, doc) => (doc.sourceRef ? loadPurchaseOrderDocData(prisma, doc.sourceRef) : null), renderBody: renderPurchaseOrderBody },
  IR: { kind: 'IR', title: 'Inspection Report 验货报告', loadData: async (prisma, doc) => (doc.sourceRef ? loadInspectionReportDocData(prisma, doc.sourceRef) : null), renderBody: renderInspectionReportBody },
  QUOT: { kind: 'QUOT', title: 'Quotation 报价单', loadData: async (prisma, doc) => (doc.sourceRef ? loadQuotationDocData(prisma, doc.sourceRef) : null), renderBody: renderQuotationBody },
  OC: { kind: 'OC', title: 'Order Confirmation 订单确认书', loadData: async (prisma, doc) => (doc.sourceRef ? loadOrderConfirmationDocData(prisma, doc.sourceRef) : null), renderBody: renderOrderConfirmationBody },
  // B3/B8 组合文档（多对一聚合）：loadData 无单据级装配——数据由 compositeDocumentService 聚合后直喂 renderServerDocument
  MERGED_PL: { kind: 'MERGED_PL', title: 'Consolidated Packing List 合并装箱单', loadData: async () => null, renderBody: renderMergedPackingListBody },
  MERGED_IR: { kind: 'MERGED_IR', title: 'Consolidated Inspection Summary 合并验货汇总', loadData: async () => null, renderBody: renderMergedInspectionSummaryBody },
  CONTRACT: { kind: 'CONTRACT', title: 'Sales Contract 销售合同（多订单合并）', loadData: async () => null, renderBody: renderContractBody },
  // B9 财务域报表模板：数据由 finance 路由实时装配直喂（周期性报表，非 TradeDocument 归档体系）
  STMT: { kind: 'STMT', title: 'Statement of Account 客户对账单', loadData: async () => null, renderBody: renderStatementBody },
  // B11 结构收编：财务发票（商业发票唯一真源）入注册表——完整文档模板形态
  // （sourceRef=Invoice.id；lifecycleService 的 CI 财务回链分支等价于此入口）
  FIN_CI: {
    kind: 'FIN_CI',
    title: 'Commercial Invoice 商业发票（财务真源）',
    loadData: async () => null, // 数据装配在 renderDocument 内完成（loadInvoiceDoc）
    renderBody: () => '',
    renderDocument: async (_prisma, ctx, opts) => (ctx.sourceRef ? renderFinanceInvoiceDocument(_prisma, ctx.sourceRef, opts) : null),
  },
};

/**
 * 读取出口方档案（SystemConfig 真源，30s TTL 缓存 → DEFAULT_EXPORTER_PROFILE 兜底）。
 * 与 finance/route.ts loadInvoiceDoc 同语义；读取失败不阻断渲染（走默认档案）。
 */
export async function loadExporterProfile(prisma: PrismaClient): Promise<DocExporterProfile> {
  try {
    const found = await getSystemConfigService(prisma).get(EXPORTER_PROFILE_CONFIG_KEY);
    if (found?.value && typeof found.value === 'object') {
      return { ...DEFAULT_EXPORTER_PROFILE, ...(found.value as object) } as DocExporterProfile;
    }
  } catch { /* 配置读取失败走默认档案 */ }
  return { ...DEFAULT_EXPORTER_PROFILE };
}

/**
 * 按模板标识渲染完整单据文档（服务端统一入口）。
 * screen=true → preview.html 预览模式（灰底 A4 纸张画布）；false → 裸打印（renderHtmlToPdf 用）。
 * 完整文档模板（renderDocument 形态，如 FIN_CI）自带头部样式，ctx.sourceRef 定位业务真源。
 * 未知模板返回 null（fail-closed，调用方 404）。
 */
export async function renderServerDocument(
  prisma: PrismaClient,
  kind: string,
  data: any,
  opts: { screen?: boolean } = {},
  ctx?: ServerDocContext,
): Promise<string | null> {
  const template = SERVER_DOC_TEMPLATES[kind];
  if (!template) return null;
  if (template.renderDocument) {
    return template.renderDocument(prisma, ctx ?? { id: '', type: '', sourceRef: null }, opts);
  }
  const exporter = await loadExporterProfile(prisma);
  const body = template.renderBody(data as ServerDocumentSetData, exporter);
  return buildServerDocument(body, opts);
}
