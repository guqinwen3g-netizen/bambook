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
import { logger } from '../lib/logger';
import { assembleDocumentSetData } from '../shipping/documentSetService';
import { nextBusinessNumber } from '../shared/businessNumberService';
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
      const documentNumber = await generateTradeDocumentNumber(tx, type);
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
