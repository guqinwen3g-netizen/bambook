/**
 * 服务端单据模板注册表（2026-08-22 全系统文档体系 B1 架构底座 / B2 运营域扩展）。
 *
 * 架构裁决：
 *   - 模板真源统一服务端（前端 EXPORT_DOC_RENDERERS 逐类退役，B6 收尾）
 *   - 每个 docKind 一个注册项：loadData（数据装配）+ renderBody（渲染）
 *     · PL：版本快照 documentSet（customs 域，生成时快照冻结）
 *     · PO/IR：业务真源实时装配（B2 运营域——sourceRef 回链，改业务侧即改文档）
 *   - 组装统一走 buildServerDocument（doc-* 基座），preview.html 用 screen 模式
 *
 * 已注册：PL（B1）/ PO、IR（B2）；后续逐批注册：
 *   Statement 对账单 / Contract / CI（财务真源已就位，此处注册统一入口）/
 *   CO / BL / INS / FORMA / BC / AWB ...
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
}

/** TradeDocumentType → 服务端模板 kind（模板注册地即映射真源） */
const TRADE_DOC_TYPE_TO_KIND: Partial<Record<string, string>> = {
  PackingList: 'PL',
  PurchaseOrder: 'PO',
  InspectionReport: 'IR',
};

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
  PL: { kind: 'PL', title: 'Packing List 装箱单', loadData: loadDocumentSetSnapshot, renderBody: renderPackingListBody },
  PO: { kind: 'PO', title: 'Purchase Order 采购订单', loadData: async (prisma, doc) => (doc.sourceRef ? loadPurchaseOrderDocData(prisma, doc.sourceRef) : null), renderBody: renderPurchaseOrderBody },
  IR: { kind: 'IR', title: 'Inspection Report 验货报告', loadData: async (prisma, doc) => (doc.sourceRef ? loadInspectionReportDocData(prisma, doc.sourceRef) : null), renderBody: renderInspectionReportBody },
  // B3 组合文档（多对一聚合）：loadData 无单据级装配——数据由 compositeDocumentService 聚合后直喂 renderServerDocument
  MERGED_PL: { kind: 'MERGED_PL', title: 'Consolidated Packing List 合并装箱单', loadData: async () => null, renderBody: renderMergedPackingListBody },
  MERGED_IR: { kind: 'MERGED_IR', title: 'Consolidated Inspection Summary 合并验货汇总', loadData: async () => null, renderBody: renderMergedInspectionSummaryBody },
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
 * 未知模板返回 null（fail-closed，调用方 404）。
 */
export async function renderServerDocument(
  prisma: PrismaClient,
  kind: string,
  data: any,
  opts: { screen?: boolean } = {},
): Promise<string | null> {
  const template = SERVER_DOC_TEMPLATES[kind];
  if (!template) return null;
  const exporter = await loadExporterProfile(prisma);
  const body = template.renderBody(data as ServerDocumentSetData, exporter);
  return buildServerDocument(body, opts);
}
