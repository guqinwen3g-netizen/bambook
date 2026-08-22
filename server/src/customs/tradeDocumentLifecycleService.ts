/**
 * 贸易单据生命周期服务 Trade Document Lifecycle Service（Wave A1 单据中心）
 *
 * 职责（PRD 19.14 / 11.2 落地）：
 *   1. 自动取号：按 5.6 规则 {类型前缀}-YYYY-NNNN，按年递增、全局唯一、作废不回收
 *     （序号扫描含软删记录，跳号保留审计痕迹）
 *   2. 版本留痕：appendTradeDocumentVersion —— 创建/更新单据时服务端事务内强制
 *      写 DocumentVersion（max+1 单调递增），不依赖客户端自觉（根因式留痕）
 *   3. 生成即登记：generateTradeDocumentsFromShipment —— 复用 shipping
 *      assembleDocumentSetData 装配数据，按选定类型批量创建 Draft 单据 + v1 快照
 *      （快照=装配 JSON，前端 EXPORT_DOC_RENDERERS 可直接渲染），同 shipmentId+type
 *      幂等 skipped，不重复登记
 *   4. 批量打包：packTradeDocumentsByOrder —— 订单全部未删单据 + 各自最新版本快照，
 *      供前端逐个渲染下载（L/C 交单场景）
 */

import { Prisma, PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { logger } from '../lib/logger';
import { assembleDocumentSetData } from '../shipping/documentSetService';
import { nextBusinessNumber } from '../shared/businessNumberService';
import { renderHtmlToPdf } from '../templates/pdf';
import { renderServerDocument } from '../templates/docTemplates/registry';
import { renderInvoiceDocumentHtml } from '../finance/route';
import type { TradeDocumentType } from './customsService';

// ────────────────────────────────────────────────────────────────
// 1. 自动取号
// ────────────────────────────────────────────────────────────────

/** 单据类型 → 编号前缀（5.6 风格：前缀-年-序号） */
export const TRADE_DOC_NUMBER_PREFIX: Record<TradeDocumentType, string> = {
  CommercialInvoice: 'CI',
  PackingList: 'PL',
  CertificateOfOrigin: 'CO',
  BillOfLading: 'BL',
  AirWaybill: 'AWB',
  InsuranceCert: 'INS',
  InspectionCert: 'IC',
  PhytosanitaryCert: 'PC',
  Other: 'DOC',
};

const VALID_TYPES = Object.keys(TRADE_DOC_NUMBER_PREFIX) as TradeDocumentType[];

/** Prisma 客户端或事务句柄 */
type DbLike = Pick<PrismaClient, 'tradeDocument'>;

/**
 * 生成下一单据编号：{PREFIX}-{YYYY}-{NNNN}（4 位补零）。
 * 序号 = 该前缀+年份下既有编号（含软删，作废不回收）最大序号 + 1；
 * 字符串排序在序号超过 4 位后不可靠，故取候选集解析数值取 max。
 */
export async function generateTradeDocumentNumber(db: DbLike, type: TradeDocumentType): Promise<string> {
  const prefix = TRADE_DOC_NUMBER_PREFIX[type];
  if (!prefix) throw new Error(`非法单据类型: ${type}`);
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;

  // 若 db 有 businessSequence 模型（生产环境），走统一编号服务
  if ((db as any).businessSequence) {
    return nextBusinessNumber(db as any, prefix as any);
  }

  // 降级：mock 环境（单元测试）或无 businessSequence 模型，回退到扫描 max+1
  const rows = await db.tradeDocument.findMany({
    where: { documentNumber: { startsWith: stem } },
    select: { documentNumber: true },
  });
  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseInt(row.documentNumber.slice(stem.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${stem}${String(maxSeq + 1).padStart(4, '0')}`;
}

export function isTradeDocumentType(type: string): type is TradeDocumentType {
  return (VALID_TYPES as string[]).includes(type);
}

// ────────────────────────────────────────────────────────────────
// 2. 版本留痕（服务端强制）
// ────────────────────────────────────────────────────────────────

const now = (): bigint => BigInt(Date.now());

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 本地日期 YYYY-MM-DD（issueDate 缺省=生成当天） */
function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** TradeDocument 行 → JSON 安全快照（BigInt/Decimal → number），供 DocumentVersion.content */
export function toTradeDocumentSnapshot(doc: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (value instanceof Prisma.Decimal) out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

/**
 * 事务内追加单据版本（版本号 max+1 防并发跳号）+ 审计日志。
 * 创建/更新单据的服务必须在同一事务内调用，保证留痕与变更原子。
 */
export async function appendTradeDocumentVersion(
  tx: any,
  params: { documentId: string; content: Record<string, unknown>; actorId: string; changeReason?: string | null },
): Promise<void> {
  const last = await tx.documentVersion.findFirst({
    where: { documentId: params.documentId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;
  await tx.documentVersion.create({
    data: {
      id: generateId('DVER'),
      documentId: params.documentId,
      version: nextVersion,
      content: params.content,
      changeReason: params.changeReason?.trim() || null,
      changedBy: params.actorId,
      createdAt: now(),
    },
  });
  await tx.auditLog.create({
    data: {
      id: generateId('AUD'),
      action: 'DOCUMENT_VERSION_CREATE',
      actorId: params.actorId,
      targetType: 'DocumentVersion',
      targetId: params.documentId,
      detail: { version: nextVersion, changeReason: params.changeReason ?? null, source: 'lifecycle' },
    },
  });
}

// ────────────────────────────────────────────────────────────────
// 3. 生成即登记（运单 → 单据草稿）
// ────────────────────────────────────────────────────────────────

export interface GenerateFromShipmentResult {
  created: Array<{ id: string; documentNumber: string; type: string }>;
  skipped: Array<{ type: string; id: string; documentNumber: string; reason: 'EXISTS' }>;
  /** 装配数据完整度提示（透传 documentSetService.missing，供 UI 展示不阻断） */
  missing: string[];
}

export async function generateTradeDocumentsFromShipment(
  prisma: PrismaClient,
  params: { shipmentId: string; types: TradeDocumentType[]; actorId: string },
): Promise<GenerateFromShipmentResult> {
  const { shipmentId, types, actorId } = params;
  if (!shipmentId) throw new Error('shipmentId 必填');
  if (!Array.isArray(types) || types.length === 0) throw new Error('types 必填且非空');
  for (const t of types) {
    if (!isTradeDocumentType(t)) throw new Error(`非法单据类型: ${t}`);
  }

  const assembled = await assembleDocumentSetData(prisma, shipmentId);
  if (!assembled.ok || !assembled.data) {
    throw new Error(assembled.error?.message || '运单数据装配失败');
  }
  const data = assembled.data;

  // relationId：装配数据只带客户名，单据登记补 Relation snapshot FK（经订单解析一次）
  let relationId: string | null = null;
  if (data.order?.id) {
    const order = await prisma.order.findUnique({
      where: { id: data.order.id },
      select: { customerRelationId: true },
    });
    relationId = order?.customerRelationId ?? null;
  }

  const created: GenerateFromShipmentResult['created'] = [];
  const skipped: GenerateFromShipmentResult['skipped'] = [];

  // 财务发票回链（2026-08-21 架构裁决：财务 Invoice 为商业发票唯一真源）：
  // CommercialInvoice 类型生成时按订单分配匹配现有财务发票（Receivable/Proforma 优先），
  // 命中 → sourceInvoiceId 回链 + 单据号直接采用财务发票号（同号裁决：交单号=记账号）。
  let linkedInvoice: { id: string; invoiceNumber: string } | null = null;
  if (types.includes('CommercialInvoice' as TradeDocumentType) && data.order?.id) {
    try {
      const allocs = await (prisma as any).invoiceOrderAllocation.findMany({
        where: { orderId: data.order.id, deletedAt: null },
        select: { invoiceId: true },
      });
      const invoiceIds = allocs.map((a: any) => a.invoiceId);
      if (invoiceIds.length) {
        const inv = await (prisma as any).invoice.findFirst({
          where: { id: { in: invoiceIds }, deletedAt: null, status: { not: 'Cancelled' } },
          orderBy: [{ type: 'asc' }, { createdAt: 'desc' }], // Proforma < Receivable 字典序，取正式应收优先
          select: { id: true, invoiceNumber: true },
        });
        if (inv) linkedInvoice = inv;
      }
    } catch { /* 回链匹配失败退化为独立取号，不阻断生成 */ }
  }

  for (const type of types) {
    const existing = await prisma.tradeDocument.findFirst({
      where: { shipmentId, type, deletedAt: null },
      select: { id: true, documentNumber: true },
    });
    if (existing) {
      skipped.push({ type, id: existing.id, documentNumber: existing.documentNumber, reason: 'EXISTS' });
      continue;
    }

    const ts = now();
    const doc = await prisma.$transaction(async (tx) => {
      // 商业发票：已回链财务发票 → 单据号=财务发票号（同号裁决）；否则独立 CI- 取号
      const documentNumber = (type === 'CommercialInvoice' && linkedInvoice)
        ? linkedInvoice.invoiceNumber
        : await generateTradeDocumentNumber(tx, type);
      const document = await tx.tradeDocument.create({
        data: {
          id: generateId('TD'),
          documentNumber,
          type,
          status: 'Draft',
          shipmentId,
          declarationId: null,
          orderId: data.order?.id ?? null,
          relationId,
          sourceInvoiceId: (type === 'CommercialInvoice' && linkedInvoice) ? linkedInvoice.id : null,
          issueDate: localToday(),
          expiryDate: null,
          issuedBy: null,
          consignee: data.parties.consignee?.name ?? data.parties.customer?.name ?? null,
          consignor: data.customs?.consignor ?? null,
          portOfLoading: data.shipment.portOfLoading ?? null,
          portOfDischarge: data.shipment.portOfDischarge ?? null,
          totalAmount: data.totals.amount != null ? new Prisma.Decimal(data.totals.amount) : null,
          currency: data.totals.currency ?? data.order?.currency ?? data.customs?.currency ?? null,
          filePath: null,
          fileName: null,
          notes: null,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      // v1 快照 = 装配数据 JSON（前端 EXPORT_DOC_RENDERERS 直接消费渲染）
      await appendTradeDocumentVersion(tx, {
        documentId: document.id,
        content: { documentSet: data as unknown as Record<string, unknown> },
        actorId,
        changeReason: '运单生成',
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TRADE_DOCUMENT_CREATE',
          actorId,
          targetType: 'TradeDocument',
          targetId: document.id,
          detail: { documentNumber, type, source: 'generate-from-shipment', shipmentId },
        },
      });
      return document;
    });
    created.push({ id: doc.id, documentNumber: doc.documentNumber, type: doc.type });
  }

  logger.info('[TradeDocumentLifecycle] generate-from-shipment', {
    shipmentId,
    created: created.length,
    skipped: skipped.length,
    actorId,
  });
  return { created, skipped, missing: data.missing };
}

// ────────────────────────────────────────────────────────────────
// 4. 批量打包（订单全部单据 + 最新版本快照）
// ────────────────────────────────────────────────────────────────

export interface TradeDocumentPackItem {
  id: string;
  documentNumber: string;
  type: string;
  status: string;
  issueDate: string | null;
  consignee: string | null;
  consignor: string | null;
  totalAmount: number | null;
  currency: string | null;
  fileName: string | null;
  /** 最新版本号（无版本=null） */
  latestVersion: number | null;
  /** 最新版本快照（含 documentSet，供前端渲染下载；无版本=null） */
  content: Record<string, unknown> | null;
}

export async function packTradeDocumentsByOrder(
  prisma: PrismaClient,
  orderId: string,
): Promise<{ items: TradeDocumentPackItem[]; total: number }> {
  if (!orderId) throw new Error('orderId 必填');
  const docs = await prisma.tradeDocument.findMany({
    where: { orderId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const items: TradeDocumentPackItem[] = [];
  for (const doc of docs) {
    const latest = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id },
      orderBy: { version: 'desc' },
      select: { version: true, content: true },
    });
    items.push({
      id: doc.id,
      documentNumber: doc.documentNumber,
      type: doc.type,
      status: doc.status,
      issueDate: doc.issueDate,
      consignee: doc.consignee,
      consignor: doc.consignor,
      totalAmount: doc.totalAmount != null ? Number(doc.totalAmount) : null,
      currency: doc.currency,
      fileName: doc.fileName,
      latestVersion: latest?.version ?? null,
      content: (latest?.content as Record<string, unknown> | undefined) ?? null,
    });
  }
  return { items, total: items.length };
}

// ────────────────────────────────────────────────────────────────
// 5. 一键生成文件（版本快照 → PDF 落盘归档，TradeDocument.filePath/fileName 回写）
// ────────────────────────────────────────────────────────────────

/** 单据文件落盘根目录（与静态服务根同源：BAMBOOK_UPLOAD_DIR 或 apps/Bambook/uploads——
 *  index.ts 静态服务 /api/uploads 的根；本文件在 server/src/customs/ 下需三级回溯） */
const TRADE_DOC_UPLOAD_DIR = process.env.BAMBOOK_UPLOAD_DIR || path.join(__dirname, '../../../uploads');

/** TradeDocumentType → 服务端模板注册表 kind 映射（B1 起逐类迁移：PL 已服务端真源） */
const TRADE_DOC_TYPE_TO_SERVER_KIND: Partial<Record<string, string>> = {
  PackingList: 'PL',
};

/**
 * 读取单据最新版本快照的 documentSet 装配数据（服务端模板渲染数据源）。
 * 无快照（手工登记）或无 documentSet 返回 null。
 */
async function loadTradeDocumentSetData(prisma: PrismaClient, docId: string): Promise<any | null> {
  const latest = await prisma.documentVersion.findFirst({
    where: { documentId: docId },
    orderBy: { version: 'desc' },
    select: { content: true },
  });
  const ds = (latest?.content as Record<string, unknown> | null | undefined)?.documentSet;
  return ds && typeof ds === 'object' ? ds : null;
}

/**
 * 服务端渲染单据文档 HTML（统一入口，2026-08-22 B1 架构底座）：
 *   - CI 带财务回链 → 财务真源模板（renderInvoiceDocumentHtml）
 *   - 类型映射进服务端注册表（PL 等）→ docTemplates/registry 渲染（版本快照装配数据）
 *   - 其余类型 → null（模板真源暂在前端，前端渲染 html 传入）
 * screen=true → preview.html 预览模式（A4 纸张画布）。
 */
export async function renderTradeDocumentServerHtml(
  prisma: PrismaClient,
  doc: { id: string; type: string; sourceInvoiceId: string | null },
  opts: { screen?: boolean } = {},
): Promise<string | null> {
  // CI 带财务回链 → 财务真源模板（screen 与财务 preview.html 同一份渲染）
  if (doc.type === 'CommercialInvoice' && doc.sourceInvoiceId) {
    return renderInvoiceDocumentHtml(prisma, doc.sourceInvoiceId, opts);
  }
  // 服务端注册表类型（PL 等）
  const kind = TRADE_DOC_TYPE_TO_SERVER_KIND[doc.type];
  if (kind) {
    const data = await loadTradeDocumentSetData(prisma, doc.id);
    if (!data) return null;
    return renderServerDocument(prisma, kind, data, opts);
  }
  return null;
}

/**
 * 生成单据文件 → 服务端 Puppeteer 转 PDF → 落盘 uploads/trade-documents/ →
 * 回写 TradeDocument.filePath/fileName。
 *
 * HTML 来源（按模板真源归属，2026-08-22 B1 起三级优先）：
 *   1. 服务端模板（CI 财务回链 / 注册表类型 PL…）：服务端自渲染（忽略入参 html，防双源漂移）
 *   2. 其余类型：前端渲染的完整 HTML（模板真源暂在前端 EXPORT_DOC_RENDERERS，B6 迁移收尾）
 *
 * 文件命名 `{documentNumber}-v{version}.pdf`：同版本重复生成覆盖（版本快照不变
 * 则文件理应一致，幂等）；跨版本各自留档，与版本留痕语义对齐。
 */
export async function generateTradeDocumentFile(
  prisma: PrismaClient,
  params: { id: string; html?: string; version?: number; actorId: string },
): Promise<{ filePath: string; fileName: string; fileSize: number }> {
  const { id, actorId } = params;
  const html = typeof params.html === 'string' ? params.html : '';
  if (!id) throw new Error('id 必填');

  const doc = await prisma.tradeDocument.findFirst({ where: { id, deletedAt: null } });
  if (!doc) throw new Error(`贸易单据 ${id} 不存在`);

  // 服务端模板优先（CI 财务回链 / 注册表 PL 等）——忽略入参 html 防双源漂移
  let renderHtml = html;
  const serverHtml = await renderTradeDocumentServerHtml(prisma, doc);
  if (serverHtml) renderHtml = serverHtml;
  if (!renderHtml || renderHtml.length < 50) throw new Error('无可渲染内容（版本快照缺失或 html 无效）');
  if (renderHtml.length > 2 * 1024 * 1024) throw new Error('渲染内容过大（>2MB），拒绝执行');

  // 版本号：优先入参（前端点的是具体版本行），兜底最新版本
  let version = params.version;
  if (version == null) {
    const latest = await prisma.documentVersion.findFirst({
      where: { documentId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    version = latest?.version ?? 1;
  }

  const pdf = await renderHtmlToPdf(renderHtml, { format: 'A4' });
  const dir = path.join(TRADE_DOC_UPLOAD_DIR, 'trade-documents');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sanitizedNo = doc.documentNumber.replace(/[^\w.-]/g, '_');
  const fileName = `${sanitizedNo}-v${version}.pdf`;
  const physicalName = `${doc.id}-${fileName}`;
  fs.writeFileSync(path.join(dir, physicalName), pdf.pdf);

  const filePath = `trade-documents/${physicalName}`;
  const ts = BigInt(Date.now());
  await prisma.tradeDocument.update({
    where: { id },
    data: { filePath, fileName, updatedAt: ts },
  });
  await prisma.auditLog.create({
    data: {
      id: generateId('AUD'),
      action: 'TRADE_DOCUMENT_FILE_GENERATED',
      actorId,
      targetType: 'TradeDocument',
      targetId: id,
      detail: { version, fileName, fileSize: pdf.bytes, sha: pdf.sha },
    },
  });

  logger.info('[TradeDocumentLifecycle] generate-file', { id, version, fileName, actorId });
  return { filePath, fileName, fileSize: pdf.bytes };
}
