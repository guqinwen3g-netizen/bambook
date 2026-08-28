/**
 * proformaInvoiceService.ts — Phase 1-04 形式发票（PI）服务
 *
 * 业务背景：
 *   外贸标准流程：报价单（Quotation）→ 客户确认 → 卖方开出形式发票（PI）→
 *   客户凭 PI 付预付款（T/T 30% deposit）→ 大货出货后开 Commercial Invoice（正式应收发票）。
 *   PI 不是正式财务发票，不入账，不参与 AR/AP 看板。
 *
 * 设计决策：
 *   - 复用 Invoice 模型，type='Proforma' 标识形式发票（不改 schema，type 是 String 字段）
 *   - PI 状态复用 Invoice 状态机：Draft → Issued → Cancelled
 *   - 转换为正式应收发票时：新建 type='Receivable' Invoice（status=Issued），
 *     原 PI status → 'Cancelled'（notes 标记转换关系，审计可追溯）
 *   - AR/AP 看板排除 type='Proforma'（在 financeServiceV2.getArApSummary 中过滤）
 *   - 报价单行项目快照到 PI attachments（Invoice 模型无 lines 关系）
 *
 * 与现有服务的关系：
 *   - 复用 createSequenceService 生成编号（INV-2026-0001 序列）
 *   - 复用 writeRouteAuditLog 审计日志
 *   - 复用 publishBusinessEvent 业务事件
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createSequenceService } from '../sequence/sequenceService';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { publishBusinessEvent } from '../events/businessEventBus';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────────

export interface ProformaGenerateInput {
  quotationId: string;
  issueDate?: string; // 缺省当天
  dueDate?: string;
  notes?: string;
}

export interface ProformaConvertInput {
  /** 转换后正式应收发票的开票日期，缺省当天 */
  issueDate?: string;
  /** 转换后正式应收发票的到期日 */
  dueDate?: string;
  /** 附加备注 */
  notes?: string;
}

export type ProformaError =
  | 'NOT_FOUND'
  | 'QUOTATION_NOT_FOUND'
  | 'QUOTATION_NOT_ACCEPTED'
  | 'NOT_PROFORMA'
  | 'ALREADY_CONVERTED'
  | 'INVALID_STATUS'
  | 'SEQUENCE_FAILED'
  | 'INTERNAL_ERROR';

export interface ProformaResult<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: ProformaError; message: string };
}

// ────────────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ────────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────────

export function createProformaInvoiceService(prisma: PrismaClient) {
  const db = prisma as any;
  const seqSvc = createSequenceService(prisma);

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function generateId(): string {
    return `INV__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function decimalString(v: any): string | null {
    if (v === undefined || v === null) return null;
    return typeof v?.toString === 'function' ? v.toString() : String(v);
  }

  function serialize(row: any): any {
    const out: any = { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
    }
    for (const k of ['amount', 'exchangeRate']) {
      if (out[k] && typeof out[k] === 'object' && out[k].toString) {
        out[k] = Number(out[k].toString());
      }
    }
    return out;
  }

  /**
   * 从报价单生成形式发票（PI）
   *
   * 业务规则：
   *   - 报价单状态必须为 Accepted（已接受）才能生成 PI
   *   - PI type='Proforma', status='Draft'
   *   - 金额、币种、汇率、客户信息从报价单快照
   *   - 报价单行项目快照到 attachments
   */
  async function generateFromQuotation(
    input: ProformaGenerateInput,
    actorId: string,
    ip?: string | null,
  ): Promise<ProformaResult> {
    try {
      // ── 1. 校验报价单 ──
      const quotation = await db.quotation.findFirst({
        where: { id: input.quotationId, deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!quotation) {
        return { ok: false, error: { code: 'QUOTATION_NOT_FOUND', message: '报价单不存在或已删除' } };
      }
      if (quotation.status !== 'Accepted') {
        return { ok: false, error: { code: 'QUOTATION_NOT_ACCEPTED', message: `报价单状态为 ${quotation.status}，仅 Accepted 状态可生成 PI` } };
      }

      // ── 2. 生成编号 ──
      let invoiceNumber: string;
      try {
        invoiceNumber = await seqSvc.nextNumber(prisma as any, 'invoice', {
          occupied: async (num) => {
            const dup = await prisma.invoice.findFirst({ where: { invoiceNumber: num }, select: { id: true } });
            return dup != null;
          },
        });
      } catch (e: any) {
        return { ok: false, error: { code: 'SEQUENCE_FAILED', message: `编号生成失败: ${e?.message}` } };
      }

      // ── 3. 构造 PI 数据 ──
      const issueDate = input.issueDate || today();
      if (!DATE_RE.test(issueDate)) {
        return { ok: false, error: { code: 'INVALID_STATUS', message: 'issueDate must be YYYY-MM-DD' } };
      }

      const totalAmount = Number(quotation.totalAmount.toString());
      const exchangeRate = quotation.exchangeRate ? Number(quotation.exchangeRate.toString()) : null;

      // 报价单行项目快照
      const linesSnapshot = quotation.lines.map((l: any) => ({
        lineNumber: l.lineNumber,
        fabricCode: l.fabricCode,
        description: l.description,
        quantity: Number(l.quantity.toString()),
        unit: l.unit,
        unitPrice: Number(l.unitPrice.toString()),
        amount: Number(l.amount.toString()),
        notes: l.notes,
      }));

      // 条款信息快照到 notes
      const termsParts: string[] = [`来源报价单: ${quotation.quotationNumber}`];
      if (quotation.deliveryTerms) termsParts.push(`交货条款: ${quotation.deliveryTerms}`);
      if (quotation.paymentTerms) termsParts.push(`付款条款: ${quotation.paymentTerms}`);
      if (quotation.salesperson) termsParts.push(`业务员: ${quotation.salesperson}`);
      if (input.notes) termsParts.push(input.notes);
      const combinedNotes = termsParts.join('; ');

      const now = BigInt(Date.now());
      const pi = await db.invoice.create({
        data: {
          id: generateId(),
          invoiceNumber,
          type: 'Proforma',
          status: 'Draft',
          amount: new Prisma.Decimal(totalAmount.toFixed(4)),
          currency: quotation.currency,
          issueDate,
          dueDate: input.dueDate || null,
          exchangeRate: exchangeRate ? new Prisma.Decimal(exchangeRate.toString()) : null,
          baseCurrency: quotation.baseCurrency || 'CNY',
          orderId: quotation.convertedOrderId || null,
          customerRelationId: quotation.customerRelationId || null,
          customerName: quotation.customerName || null,
          notes: combinedNotes,
          attachments: { quotationId: quotation.id, quotationNumber: quotation.quotationNumber, lines: linesSnapshot },
          ownerId: null,
          departmentId: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      // ── 4. 审计 + 事件 ──
      const auditId = await writeRouteAuditLog({
        prisma: db,
        actorId,
        source: 'proforma-invoice:generate',
        operation: 'generate_proforma_from_quotation',
        targetType: 'Invoice',
        targetId: pi.id,
        before: { quotationId: quotation.id, quotationNumber: quotation.quotationNumber },
        after: {
          invoiceId: pi.id,
          invoiceNumber: pi.invoiceNumber,
          type: 'Proforma',
          amount: decimalString(pi.amount),
          currency: pi.currency,
        },
        ip: ip || null,
      });

      publishBusinessEvent({
        type: 'ProformaInvoiceGenerated',
        sourceEntityType: 'Invoice',
        sourceEntityId: pi.id,
        orderId: pi.orderId || undefined,
        payload: {
          invoiceId: pi.id,
          invoiceNumber: pi.invoiceNumber,
          quotationId: quotation.id,
          quotationNumber: quotation.quotationNumber,
          amount: decimalString(pi.amount),
          currency: pi.currency,
          customerRelationId: pi.customerRelationId,
        },
        actorId,
        transactionId: auditId,
      }).catch(() => { /* event publish failure must not fail business */ });

      logger.info('[ProformaInvoice] generated', {
        invoiceId: pi.id,
        invoiceNumber: pi.invoiceNumber,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        actorId,
      });

      return { ok: true, data: serialize(pi) };
    } catch (e: any) {
      logger.error('[ProformaInvoice] generate failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  /**
   * 将形式发票（PI）转换为正式应收发票（Receivable Invoice）
   *
   * 业务规则：
   *   - 仅 type='Proforma' 的发票可转换
   *   - PI 状态不能是 Cancelled（已作废的 PI 不可转换）
   *   - 转换后：新建 type='Receivable' Invoice（status='Issued'），原 PI → 'Cancelled'
   *   - 原 PI notes 追加转换标记，审计可追溯
   */
  async function convertToReceivable(
    piId: string,
    input: ProformaConvertInput,
    actorId: string,
    ip?: string | null,
  ): Promise<ProformaResult> {
    try {
      // ── 1. 校验 PI ──
      const pi = await db.invoice.findFirst({
        where: { id: piId, deletedAt: null },
      });
      if (!pi) {
        return { ok: false, error: { code: 'NOT_FOUND', message: '发票不存在或已删除' } };
      }
      if (pi.type !== 'Proforma') {
        return { ok: false, error: { code: 'NOT_PROFORMA', message: `发票类型为 ${pi.type}，仅 Proforma 可转换` } };
      }
      if (pi.status === 'Cancelled') {
        return { ok: false, error: { code: 'ALREADY_CONVERTED', message: '该 PI 已作废（可能已转换），不可重复转换' } };
      }

      // ── 2. 生成正式应收发票编号 ──
      let receivableNumber: string;
      try {
        receivableNumber = await seqSvc.nextNumber(prisma as any, 'invoice', {
          occupied: async (num) => {
            const dup = await prisma.invoice.findFirst({ where: { invoiceNumber: num }, select: { id: true } });
            return dup != null;
          },
        });
      } catch (e: any) {
        return { ok: false, error: { code: 'SEQUENCE_FAILED', message: `编号生成失败: ${e?.message}` } };
      }

      // ── 3. 构造正式应收发票 ──
      const issueDate = input.issueDate || today();
      if (!DATE_RE.test(issueDate)) {
        return { ok: false, error: { code: 'INVALID_STATUS', message: 'issueDate must be YYYY-MM-DD' } };
      }

      const amount = Number(pi.amount.toString());
      const exchangeRate = pi.exchangeRate ? Number(pi.exchangeRate.toString()) : null;
      const piAttachments = pi.attachments as any || {};

      const now = BigInt(Date.now());
      const receivable = await db.invoice.create({
        data: {
          id: generateId(),
          invoiceNumber: receivableNumber,
          type: 'Receivable',
          status: 'Issued',
          amount: new Prisma.Decimal(amount.toFixed(4)),
          currency: pi.currency,
          issueDate,
          dueDate: input.dueDate || pi.dueDate || null,
          exchangeRate: exchangeRate ? new Prisma.Decimal(exchangeRate.toString()) : null,
          baseCurrency: pi.baseCurrency || 'CNY',
          orderId: pi.orderId || null,
          customerRelationId: pi.customerRelationId || null,
          customerName: pi.customerName || null,
          notes: `来源形式发票: ${pi.invoiceNumber}${input.notes ? '; ' + input.notes : ''}`,
          attachments: {
            ...piAttachments,
            proformaInvoiceId: pi.id,
            proformaInvoiceNumber: pi.invoiceNumber,
          },
          ownerId: pi.ownerId || null,
          departmentId: pi.departmentId || null,
          createdAt: now,
          updatedAt: now,
        },
      });

      // ── 4. 原 PI → Cancelled（标记已转换） ──
      const piNotesSuffix = `; 已转换为正式应收发票: ${receivableNumber}`;
      await db.invoice.update({
        where: { id: piId },
        data: {
          status: 'Cancelled',
          notes: (pi.notes || '') + piNotesSuffix,
          updatedAt: now,
        },
      });

      // ── 5. 审计 + 事件 ──
      const auditId = await writeRouteAuditLog({
        prisma: db,
        actorId,
        source: 'proforma-invoice:convert',
        operation: 'convert_proforma_to_receivable',
        targetType: 'Invoice',
        targetId: receivable.id,
        before: {
          proformaInvoiceId: pi.id,
          proformaInvoiceNumber: pi.invoiceNumber,
          proformaStatus: pi.status,
        },
        after: {
          receivableInvoiceId: receivable.id,
          receivableInvoiceNumber: receivable.invoiceNumber,
          type: 'Receivable',
          status: 'Issued',
          amount: decimalString(receivable.amount),
        },
        ip: ip || null,
      });

      publishBusinessEvent({
        type: 'ProformaInvoiceConverted',
        sourceEntityType: 'Invoice',
        sourceEntityId: receivable.id,
        orderId: receivable.orderId || undefined,
        payload: {
          proformaInvoiceId: pi.id,
          proformaInvoiceNumber: pi.invoiceNumber,
          receivableInvoiceId: receivable.id,
          receivableInvoiceNumber: receivable.invoiceNumber,
          amount: decimalString(receivable.amount),
          currency: receivable.currency,
        },
        actorId,
        transactionId: auditId,
      }).catch(() => { /* event publish failure must not fail business */ });

      logger.info('[ProformaInvoice] converted', {
        proformaInvoiceId: pi.id,
        proformaInvoiceNumber: pi.invoiceNumber,
        receivableInvoiceId: receivable.id,
        receivableInvoiceNumber: receivable.invoiceNumber,
        actorId,
      });

      return { ok: true, data: serialize(receivable) };
    } catch (e: any) {
      logger.error('[ProformaInvoice] convert failed', { piId, error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  return { generateFromQuotation, convertToReceivable };
}

// ────────────────────────────────────────────────────────────────────
// 单例
// ────────────────────────────────────────────────────────────────────

let _defaultService: ReturnType<typeof createProformaInvoiceService> | null = null;
export function getProformaInvoiceService(prisma: PrismaClient): ReturnType<typeof createProformaInvoiceService> {
  if (!_defaultService) _defaultService = createProformaInvoiceService(prisma);
  return _defaultService;
}
