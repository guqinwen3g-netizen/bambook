/**
 * 服务端单据模板注册表（2026-08-22 全系统文档体系 B1 架构底座）。
 *
 * 架构裁决：
 *   - 模板真源统一服务端（前端 EXPORT_DOC_RENDERERS 逐类退役，B6 收尾）
 *   - 每个 docKind 一个渲染函数：data（装配器输出）+ exporter（出口方档案）→ HTML body
 *   - 组装统一走 buildServerDocument（doc-* 基座），preview.html 用 screen 模式
 *
 * 已注册：PL（首个迁移样板，B1）；后续 B2-B6 逐批注册：
 *   Statement 对账单 / PurchaseOrder / InspectionReport / Contract /
 *   CI（财务真源已就位，此处注册统一入口）/ CO / BL / INS / FORMA / BC / AWB ...
 */

import { PrismaClient } from '@prisma/client';
import { getSystemConfigService } from '../../config/systemConfigService';
import { DEFAULT_EXPORTER_PROFILE, EXPORTER_PROFILE_CONFIG_KEY } from '../../config/systemConfigRoute';
import { buildServerDocument } from '../docPrintBase';
import { renderPackingListBody, type DocExporterProfile } from './packingList';
import type { ServerDocumentSetData } from './types';

export interface ServerDocTemplate {
  /** 模板标识（与 TradeDocumentType 对齐或扩展） */
  kind: string;
  title: string;
  /** data → HTML body 片段（经 buildServerDocument 组装） */
  renderBody: (data: any, exporter: DocExporterProfile) => string;
}

export const SERVER_DOC_TEMPLATES: Record<string, ServerDocTemplate> = {
  PL: { kind: 'PL', title: 'Packing List 装箱单', renderBody: renderPackingListBody },
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
