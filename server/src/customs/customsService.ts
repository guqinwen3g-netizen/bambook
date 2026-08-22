/**
 * 外贸与报关服务 — Phase 5 B5 + Phase 3 C6
 *
 * 职责：
 *   1. CustomsDeclaration：报关单 CRUD + 状态机（Draft→Submitted→Declared→Inspecting→Released/Exception/Cancelled）+ 明细行
 *   2. HsCode：HS 编码库 CRUD（参考数据，无软删除）
 *   3. LetterOfCredit：信用证 CRUD + 状态机（Issued→Presented→Accepted→Settled/Discrepant/Expired/Cancelled）
 *   4. TaxRefund：出口退税 CRUD + 状态机（Draft→Submitted→Reviewing→Approved/Rejected→Refunded/Cancelled）+ 审核
 *   5. TradeDocument：贸易单据 CRUD + 状态机（Draft→Issued→Submitted→Accepted/Rejected/Cancelled）
 *
 * 设计原则：
 *   - 软删除（deletedAt BigInt），HsCode 参考数据用 isActive 标记
 *   - 事务内创建主表 + 行明细 + 审计日志
 *   - 状态转换有严格校验（非法转换抛错，fail-closed）
 *   - 退税金额自动计算：refundAmount = exportAmountCny × refundableRate
 *   - 事件发布失败不阻断业务（fire-and-forget）
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';
import { businessEventBus } from '../events/businessEventBus';
import { deactivateEntityLinks, syncCustomsDeclarationReferences, syncLetterOfCreditReferences, syncTaxRefundReferences } from '../entities/sync';
import { appendTradeDocumentVersion, generateTradeDocumentNumber, toTradeDocumentSnapshot } from './tradeDocumentLifecycleService';
import { nextBusinessNumber } from '../shared/businessNumberService';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export type CustomsType = 'Export' | 'Import';
export type CustomsDeclarationStatus = 'Draft' | 'Submitted' | 'Declared' | 'Inspecting' | 'Released' | 'Exception' | 'Cancelled';
export type TradeTerms = 'FOB' | 'CIF' | 'EXW' | 'DDP' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'CFR';

export type HsCodeCategory = 'Textile' | 'Garment' | 'Accessory' | 'Material' | 'Yarn' | 'Other';

export type LetterOfCreditType = 'Irrevocable' | 'Revocable' | 'Standby' | 'Transferable';
export type LetterOfCreditStatus = 'Issued' | 'Presented' | 'Accepted' | 'Discrepant' | 'Settled' | 'Expired' | 'Cancelled';

export type TaxRefundStatus = 'Draft' | 'Submitted' | 'Reviewing' | 'Approved' | 'Rejected' | 'Refunded' | 'Cancelled';

export type TradeDocumentType =
  | 'CommercialInvoice'
  | 'PackingList'
  | 'CertificateOfOrigin'
  | 'BillOfLading'
  | 'AirWaybill'
  | 'InsuranceCert'
  | 'InspectionCert'
  | 'PhytosanitaryCert'
  | 'Other'
  // ── B2 运营域单据类型（2026-08-22 全系统单据枢纽：各业务域就地生成，非手动入口可建）──
  | 'PurchaseOrder'      // 采购订单（procurement 域，sourceRef=PurchaseOrder.id）
  | 'InspectionReport'   // 验货报告（qc 域，sourceRef=InspectionReport.id）
  | 'Quotation'          // 报价单（quotation 域，B7 sourceRef=Quotation.id）
  | 'OrderConfirmation'  // 订单确认书（orders 域，B8 sourceRef=Order.id）
  | 'Contract';          // 合同（contract 域，占位——多订单合并合同走 CONTRACT 组合文档即时生成）
export type TradeDocumentStatus = 'Draft' | 'Issued' | 'Submitted' | 'Accepted' | 'Rejected' | 'Cancelled';

// ─── Input 类型 ───

export interface CustomsDeclarationInput {
  /** 报关单号（可选，服务端自动生成 CD-YYYY-NNNN；传入时优先使用传入值并校验唯一性） */
  declarationNumber?: string;
  shipmentId?: string;
  orderId?: string;
  relationId?: string;
  type: CustomsType;
  declarationDate?: string;
  customsCode?: string;
  declarationPort?: string;
  tradeTerms?: string;
  totalValue?: number;
  currency?: string;
  totalPackages?: number;
  grossWeight?: number;
  netWeight?: number;
  originCountry?: string;
  destinationCountry?: string;
  consignee?: string;
  consignor?: string;
  declarant?: string;
  agent?: string;
  notes?: string;
  lines?: CustomsDeclarationLineInput[];
}

export interface CustomsDeclarationLineInput {
  productCode?: string;
  productName: string;
  hsCode?: string;
  brandName?: string;
  specification?: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalAmount?: number;
  currency?: string;
  grossWeight?: number;
  netWeight?: number;
  originCountry?: string;
  notes?: string;
}

export interface HsCodeInput {
  code: string;
  description: string;
  category: HsCodeCategory;
  exportTaxRebateRate?: number;
  importTariffRate?: number;
  vatRate?: number;
  unit?: string;
  supervisionCondition?: string;
  inspectionQuarantine?: string;
  additionalDuty?: string;
  notes?: string;
  isActive?: boolean;
}

export interface LetterOfCreditInput {
  /** 信用证号（可选，服务端自动生成 LC-YYYY-NNNN；传入时优先使用传入值并校验唯一性） */
  lcNumber?: string;
  relationId?: string;
  orderId?: string;
  type: LetterOfCreditType;
  issueDate?: string;
  issueBank?: string;
  advisingBank?: string;
  negotiatingBank?: string;
  confirmingBank?: string;
  applicant?: string;
  beneficiary?: string;
  amount: number;
  currency?: string;
  availableAmount?: number;
  expiryDate?: string;
  expiryPlace?: string;
  presentationDeadline?: string;
  shipmentDeadline?: string;
  tradeTerms?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  documentsRequired?: string[];
  specialConditions?: string;
  discrepancies?: string;
  notes?: string;
}

export interface TaxRefundInput {
  /** 退税编号（可选，服务端自动生成 TR-YYYY-NNNN；传入时优先使用传入值并校验唯一性） */
  refundNumber?: string;
  declarationId?: string;
  orderId?: string;
  relationId?: string;
  exportDate?: string;
  declarationDate?: string;
  fxRate?: number;
  exportAmountFob?: number;
  exportAmountFobCurrency?: string;
  exportAmountCny?: number;
  refundableVat?: number;
  refundableRate?: number;
  refundAmount?: number;
  refundDate?: string;
  notes?: string;
}

export interface TaxRefundReviewInput {
  reviewedBy: string;
  decision: 'Approved' | 'Rejected';
  reviewNotes?: string;
  refundAmount?: number;
}

export interface TradeDocumentInput {
  /** 留空自动取号（{类型前缀}-YYYY-NNNN，按年递增、作废不回收，见 tradeDocumentLifecycleService） */
  documentNumber?: string;
  type: TradeDocumentType;
  shipmentId?: string;
  declarationId?: string;
  orderId?: string;
  relationId?: string;
  issueDate?: string;
  expiryDate?: string;
  issuedBy?: string;
  consignee?: string;
  consignor?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  totalAmount?: number;
  currency?: string;
  filePath?: string;
  fileName?: string;
  notes?: string;
  /** 更新时写入 DocumentVersion 的变更原因（服务端自动留痕，仅 update 消费） */
  changeReason?: string;
}

// ────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────

const now = (): bigint => BigInt(Date.now());

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const VALID_CUSTOMS_TYPES: CustomsType[] = ['Export', 'Import'];
const VALID_DECLARATION_STATUSES: CustomsDeclarationStatus[] = ['Draft', 'Submitted', 'Declared', 'Inspecting', 'Released', 'Exception', 'Cancelled'];
const VALID_HS_CATEGORIES: HsCodeCategory[] = ['Textile', 'Garment', 'Accessory', 'Material', 'Yarn', 'Other'];
const VALID_LC_TYPES: LetterOfCreditType[] = ['Irrevocable', 'Revocable', 'Standby', 'Transferable'];
const VALID_LC_STATUSES: LetterOfCreditStatus[] = ['Issued', 'Presented', 'Accepted', 'Discrepant', 'Settled', 'Expired', 'Cancelled'];
const VALID_TAX_REFUND_STATUSES: TaxRefundStatus[] = ['Draft', 'Submitted', 'Reviewing', 'Approved', 'Rejected', 'Refunded', 'Cancelled'];
const VALID_DOC_TYPES: TradeDocumentType[] = ['CommercialInvoice', 'PackingList', 'CertificateOfOrigin', 'BillOfLading', 'AirWaybill', 'InsuranceCert', 'InspectionCert', 'PhytosanitaryCert', 'Other', 'PurchaseOrder', 'InspectionReport', 'Contract'];
/** 手动可创建类型（单据中心 UI 创建入口）：仅 customs 交单类型——域单据（PO/IR/Contract）
 * 由各业务模块带 sourceRef 就地生成，手动建域单据无业务真源可引用，fail-closed 拒绝 */
const MANUALLY_CREATABLE_DOC_TYPES: TradeDocumentType[] = ['CommercialInvoice', 'PackingList', 'CertificateOfOrigin', 'BillOfLading', 'AirWaybill', 'InsuranceCert', 'InspectionCert', 'PhytosanitaryCert', 'Other'];
const VALID_DOC_STATUSES: TradeDocumentStatus[] = ['Draft', 'Issued', 'Submitted', 'Accepted', 'Rejected', 'Cancelled'];

function validateCustomsType(type: string): asserts type is CustomsType {
  if (!VALID_CUSTOMS_TYPES.includes(type as CustomsType)) throw new Error(`非法报关类型: ${type}`);
}
function validateDeclarationStatus(status: string): asserts status is CustomsDeclarationStatus {
  if (!VALID_DECLARATION_STATUSES.includes(status as CustomsDeclarationStatus)) throw new Error(`非法报关单状态: ${status}`);
}
function validateHsCategory(cat: string): asserts cat is HsCodeCategory {
  if (!VALID_HS_CATEGORIES.includes(cat as HsCodeCategory)) throw new Error(`非法 HS 编码类别: ${cat}`);
}
function validateLcType(type: string): asserts type is LetterOfCreditType {
  if (!VALID_LC_TYPES.includes(type as LetterOfCreditType)) throw new Error(`非法信用证类型: ${type}`);
}
function validateLcStatus(status: string): asserts status is LetterOfCreditStatus {
  if (!VALID_LC_STATUSES.includes(status as LetterOfCreditStatus)) throw new Error(`非法信用证状态: ${status}`);
}
function validateTaxRefundStatus(status: string): asserts status is TaxRefundStatus {
  if (!VALID_TAX_REFUND_STATUSES.includes(status as TaxRefundStatus)) throw new Error(`非法退税状态: ${status}`);
}
function validateDocType(type: string): asserts type is TradeDocumentType {
  if (!VALID_DOC_TYPES.includes(type as TradeDocumentType)) throw new Error(`非法单据类型: ${type}`);
}
function validateDocStatus(status: string): asserts status is TradeDocumentStatus {
  if (!VALID_DOC_STATUSES.includes(status as TradeDocumentStatus)) throw new Error(`非法单据状态: ${status}`);
}

// ─── 状态转换规则 ───

const DECLARATION_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Declared', 'Exception', 'Cancelled'],
  Declared: ['Inspecting', 'Exception', 'Cancelled'],
  Inspecting: ['Released', 'Exception'],
  Released: [],
  Exception: ['Submitted', 'Cancelled'],
  Cancelled: [],
};

const LC_TRANSITIONS: Record<string, string[]> = {
  Issued: ['Presented', 'Expired', 'Cancelled'],
  Presented: ['Accepted', 'Discrepant', 'Cancelled'],
  Accepted: ['Settled', 'Cancelled'],
  Discrepant: ['Presented', 'Cancelled'],
  Settled: [],
  Expired: [],
  Cancelled: [],
};

const TAX_REFUND_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Reviewing', 'Rejected', 'Cancelled'],
  Reviewing: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Refunded'],
  Rejected: ['Draft'],
  Refunded: [],
  Cancelled: [],
};

const DOC_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Issued', 'Cancelled'],
  Issued: ['Submitted', 'Cancelled'],
  Submitted: ['Accepted', 'Rejected', 'Cancelled'],
  Accepted: [],
  Rejected: ['Draft'],
  Cancelled: [],
};

/** 非 customs 域（procurement/qc/contract/finance）文档生命周期状态机：
 * 简化 Draft → Issued → Cancelled——域单据内容随业务真源实时渲染，
 * 无交单流转语义（customs 交单状态机不适用）。 */
const SIMPLE_DOC_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Issued', 'Cancelled'],
  Issued: ['Cancelled'],
  Cancelled: [],
};

/** 按业务域的单据状态机（schema TradeDocument.status 注释引用的真源）：
 * customs=交单状态机；其余域=简化文档生命周期。未知 domain fail-closed 拒绝。 */
export const DOC_DOMAIN_STATUS_TRANSITIONS: Record<string, Record<string, string[]>> = {
  customs: DOC_TRANSITIONS,
  procurement: SIMPLE_DOC_TRANSITIONS,
  qc: SIMPLE_DOC_TRANSITIONS,
  contract: SIMPLE_DOC_TRANSITIONS,
  finance: SIMPLE_DOC_TRANSITIONS,
  quotation: SIMPLE_DOC_TRANSITIONS,
  orders: SIMPLE_DOC_TRANSITIONS,
};

/** 按域取状态机（未知域 fail-closed——不允许无状态机的域建单据） */
export function docStatusTransitionsFor(domain: string): Record<string, string[]> {
  const transitions = DOC_DOMAIN_STATUS_TRANSITIONS[domain];
  if (!transitions) throw new Error(`非法单据业务域: ${domain}`);
  return transitions;
}

function validateTransition(transitions: Record<string, string[]>, from: string, to: string, entityName: string): void {
  const allowed = transitions[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`非法${entityName}状态转换: ${from} → ${to}（允许: ${allowed.join(', ') || '无'}）`);
  }
}

// ─── C4 关单闭环 ───
// 报关单关联运单（shipmentId）时，事务内回填 Shipment 关单字段：
//   - 创建报关单 → customsDeclarationNumber（免手工双录，运单详情即时可见）
//   - 放行（Released）→ customsDeclarationNumber（防漏补写）+ customsClearanceDate（当日 YYYY-MM-DD）
// 运单不存在/已软删时静默跳过（shipmentId 为 snapshot FK，不阻断报关单主流程）。
async function backfillShipmentCustoms(
  tx: any,
  decl: { shipmentId: string | null; declarationNumber: string },
  cleared: boolean,
): Promise<void> {
  if (!decl.shipmentId) return;
  const shipment = await tx.shipment.findUnique({ where: { id: decl.shipmentId }, select: { id: true, deletedAt: true } });
  if (!shipment || shipment.deletedAt) return;
  const data: Record<string, unknown> = {
    customsDeclarationNumber: decl.declarationNumber,
    updatedAt: now(),
  };
  if (cleared) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    data.customsClearanceDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  await tx.shipment.update({ where: { id: shipment.id }, data });
}

/** 信用证创建可写字段白名单（route / Agent Flow 共用真源；字段定义见 LetterOfCreditInput） */
export const LETTER_OF_CREDIT_CREATE_FIELDS: readonly string[] = [
  'lcNumber', 'relationId', 'orderId', 'type', 'issueDate', 'issueBank', 'advisingBank',
  'negotiatingBank', 'confirmingBank', 'applicant', 'beneficiary', 'amount', 'currency',
  'availableAmount', 'expiryDate', 'expiryPlace', 'presentationDeadline', 'shipmentDeadline',
  'tradeTerms', 'portOfLoading', 'portOfDischarge', 'documentsRequired', 'specialConditions',
  'discrepancies', 'notes',
];

/**
 * 报关单更新可 patch 字段白名单（仅 Draft 可编辑；status 走状态机流转，不在 update 通道内；
 * lines 不在 patch 通道内）
 */
export const CUSTOMS_DECLARATION_UPDATE_FIELDS: readonly string[] = [
  'declarationNumber', 'shipmentId', 'orderId', 'relationId', 'type', 'declarationDate',
  'customsCode', 'declarationPort', 'tradeTerms', 'totalValue', 'currency', 'totalPackages',
  'grossWeight', 'netWeight', 'originCountry', 'destinationCountry', 'consignee', 'consignor',
  'declarant', 'agent', 'notes',
];

// ════════════════════════════════════════════════════════════════
// Service Factory
// ════════════════════════════════════════════════════════════════

export function createCustomsService(prisma: PrismaClient) {
  // ────────────────────────────────────────────────────────────
  // 1. CustomsDeclaration（报关单）
  // ────────────────────────────────────────────────────────────

  async function createDeclaration(input: CustomsDeclarationInput, actorId: string) {
    validateCustomsType(input.type);

    // PRD 5.6：服务端自动生成报关单号（CD-YYYY-NNNN），传入时优先使用传入值并校验唯一性
    const declarationNumber = input.declarationNumber || await nextBusinessNumber(prisma, 'CD');
    const existing = await prisma.customsDeclaration.findFirst({
      where: { declarationNumber, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new Error(`报关单号 ${declarationNumber} 已存在`);

    const ts = now();
    const declaration = await prisma.$transaction(async (tx) => {
      const decl = await tx.customsDeclaration.create({
        data: {
          id: generateId('CD'),
          declarationNumber,
          shipmentId: input.shipmentId ?? null,
          orderId: input.orderId ?? null,
          relationId: input.relationId ?? null,
          type: input.type,
          status: 'Draft',
          declarationDate: input.declarationDate ?? null,
          customsCode: input.customsCode ?? null,
          declarationPort: input.declarationPort ?? null,
          tradeTerms: input.tradeTerms ?? null,
          totalValue: input.totalValue != null ? new Prisma.Decimal(input.totalValue) : null,
          currency: input.currency ?? null,
          totalPackages: input.totalPackages ?? null,
          grossWeight: input.grossWeight != null ? new Prisma.Decimal(input.grossWeight) : null,
          netWeight: input.netWeight != null ? new Prisma.Decimal(input.netWeight) : null,
          originCountry: input.originCountry ?? null,
          destinationCountry: input.destinationCountry ?? null,
          consignee: input.consignee ?? null,
          consignor: input.consignor ?? null,
          declarant: input.declarant ?? null,
          agent: input.agent ?? null,
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });

      // 创建明细行
      if (input.lines && input.lines.length > 0) {
        for (let i = 0; i < input.lines.length; i++) {
          const line = input.lines[i];
          await tx.customsDeclarationLine.create({
            data: {
              id: generateId('CDL'),
              declarationId: decl.id,
              lineNumber: i + 1,
              productCode: line.productCode ?? null,
              productName: line.productName,
              hsCode: line.hsCode ?? null,
              brandName: line.brandName ?? null,
              specification: line.specification ?? null,
              quantity: new Prisma.Decimal(line.quantity),
              unit: line.unit,
              unitPrice: line.unitPrice != null ? new Prisma.Decimal(line.unitPrice) : null,
              totalAmount: line.totalAmount != null ? new Prisma.Decimal(line.totalAmount) : null,
              currency: line.currency ?? null,
              grossWeight: line.grossWeight != null ? new Prisma.Decimal(line.grossWeight) : null,
              netWeight: line.netWeight != null ? new Prisma.Decimal(line.netWeight) : null,
              originCountry: line.originCountry ?? null,
              notes: line.notes ?? null,
              createdAt: ts,
              updatedAt: ts,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'CUSTOMS_DECLARATION_CREATE',
          actorId,
          targetType: 'CustomsDeclaration',
          targetId: decl.id,
          detail: { declarationNumber: decl.declarationNumber, type: decl.type },
        },
      });

      // EntityLink 图谱：clearsShipment / aboutOrder / declaredFor
      await syncCustomsDeclarationReferences(prisma, decl, { source: 'api:customs' }, tx);

      // C4 关单闭环：回填运单报关单号
      await backfillShipmentCustoms(tx, decl, false);

      return decl;
    });

    // 事件发布（fire-and-forget）
    try {
      businessEventBus.publish({
        type: 'CustomsDeclarationCreated',
        sourceEntityType: 'CustomsDeclaration',
        sourceEntityId: declaration.id,
        actorId,
        payload: { declarationNumber: declaration.declarationNumber, type: declaration.type },
        timestamp: Date.now(),
      } as any);
    } catch (e) {
      logger.warn('[CustomsService] event publish failed', { error: (e as Error)?.message });
    }

    logger.info('[CustomsService] declaration created', { id: declaration.id, declarationNumber: declaration.declarationNumber, actorId });
    return getDeclaration(declaration.id);
  }

  async function updateDeclaration(id: string, input: Partial<CustomsDeclarationInput>, actorId: string) {
    const existing = await prisma.customsDeclaration.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`报关单 ${id} 不存在`);
    if (existing.status !== 'Draft') throw new Error(`报关单状态 ${existing.status} 不可编辑（仅 Draft 可编辑）`);

    if (input.type) validateCustomsType(input.type);

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const decl = await tx.customsDeclaration.update({
        where: { id },
        data: {
          ...(input.declarationNumber && input.declarationNumber !== existing.declarationNumber
            ? { declarationNumber: input.declarationNumber }
            : {}),
          ...(input.shipmentId !== undefined ? { shipmentId: input.shipmentId } : {}),
          ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
          ...(input.relationId !== undefined ? { relationId: input.relationId } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.declarationDate !== undefined ? { declarationDate: input.declarationDate } : {}),
          ...(input.customsCode !== undefined ? { customsCode: input.customsCode } : {}),
          ...(input.declarationPort !== undefined ? { declarationPort: input.declarationPort } : {}),
          ...(input.tradeTerms !== undefined ? { tradeTerms: input.tradeTerms } : {}),
          ...(input.totalValue !== undefined ? { totalValue: input.totalValue != null ? new Prisma.Decimal(input.totalValue) : null } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.totalPackages !== undefined ? { totalPackages: input.totalPackages } : {}),
          ...(input.grossWeight !== undefined ? { grossWeight: input.grossWeight != null ? new Prisma.Decimal(input.grossWeight) : null } : {}),
          ...(input.netWeight !== undefined ? { netWeight: input.netWeight != null ? new Prisma.Decimal(input.netWeight) : null } : {}),
          ...(input.originCountry !== undefined ? { originCountry: input.originCountry } : {}),
          ...(input.destinationCountry !== undefined ? { destinationCountry: input.destinationCountry } : {}),
          ...(input.consignee !== undefined ? { consignee: input.consignee } : {}),
          ...(input.consignor !== undefined ? { consignor: input.consignor } : {}),
          ...(input.declarant !== undefined ? { declarant: input.declarant } : {}),
          ...(input.agent !== undefined ? { agent: input.agent } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'CUSTOMS_DECLARATION_UPDATE',
          actorId,
          targetType: 'CustomsDeclaration',
          targetId: id,
          detail: { fields: Object.keys(input) },
        },
      });

      // EntityLink 图谱：FK 快照随 update 同步
      await syncCustomsDeclarationReferences(prisma, decl, { source: 'api:customs' }, tx);

      return decl;
    });

    logger.info('[CustomsService] declaration updated', { id, actorId });
    return getDeclaration(updated.id);
  }

  async function deleteDeclaration(id: string, actorId: string) {
    const existing = await prisma.customsDeclaration.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`报关单 ${id} 不存在`);
    if (existing.status !== 'Draft' && existing.status !== 'Cancelled') {
      throw new Error(`报关单状态 ${existing.status} 不可删除（仅 Draft/Cancelled 可删除）`);
    }

    const ts = now();
    await prisma.$transaction(async (tx) => {
      await tx.customsDeclaration.update({
        where: { id },
        data: { deletedAt: ts, updatedAt: ts },
      });
      // EntityLink 图谱：软删同步失效发出的关联
      await deactivateEntityLinks(tx, 'customsDeclaration', id, ts);
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'CUSTOMS_DECLARATION_DELETE',
          actorId,
          targetType: 'CustomsDeclaration',
          targetId: id,
        },
      });
    });

    logger.info('[CustomsService] declaration deleted', { id, actorId });
    return { id, deleted: true };
  }

  async function listDeclarations(params: {
    type?: string;
    status?: string;
    shipmentId?: string;
    orderId?: string;
    relationId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: Prisma.CustomsDeclarationWhereInput = { deletedAt: null };
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.shipmentId) where.shipmentId = params.shipmentId;
    if (params.orderId) where.orderId = params.orderId;
    if (params.relationId) where.relationId = params.relationId;
    if (params.search) {
      where.OR = [
        { declarationNumber: { contains: params.search, mode: 'insensitive' } },
        { consignee: { contains: params.search, mode: 'insensitive' } },
        { consignor: { contains: params.search, mode: 'insensitive' } },
        { agent: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      prisma.customsDeclaration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { _count: { select: { lines: true } } },
      }),
      prisma.customsDeclaration.count({ where }),
    ]);

    return { items, total };
  }

  async function getDeclaration(id: string) {
    const decl = await prisma.customsDeclaration.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!decl) throw new Error(`报关单 ${id} 不存在`);
    return decl;
  }

  async function transitionDeclarationStatus(id: string, toStatus: CustomsDeclarationStatus, actorId: string) {
    validateDeclarationStatus(toStatus);
    const existing = await prisma.customsDeclaration.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`报关单 ${id} 不存在`);

    validateTransition(DECLARATION_TRANSITIONS, existing.status, toStatus, '报关单');

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const decl = await tx.customsDeclaration.update({
        where: { id },
        data: { status: toStatus, updatedAt: ts },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'CUSTOMS_DECLARATION_TRANSITION',
          actorId,
          targetType: 'CustomsDeclaration',
          targetId: id,
          detail: { from: existing.status, to: toStatus },
        },
      });
      // C4 关单闭环：放行时回填运单报关单号 + 清关日期
      if (toStatus === 'Released') {
        await backfillShipmentCustoms(tx, decl, true);
      }
      return decl;
    });

    // 事件发布
    try {
      businessEventBus.publish({
        type: 'CustomsDeclarationStatusChanged',
        sourceEntityType: 'CustomsDeclaration',
        sourceEntityId: id,
        actorId,
        payload: { from: existing.status, to: toStatus },
        timestamp: Date.now(),
      } as any);
      if (toStatus === 'Released') {
        businessEventBus.publish({
          type: 'CustomsCleared',
          sourceEntityType: 'CustomsDeclaration',
          sourceEntityId: id,
          actorId,
          payload: { declarationNumber: existing.declarationNumber },
          timestamp: Date.now(),
        } as any);
      }
    } catch (e) {
      logger.warn('[CustomsService] event publish failed', { error: (e as Error)?.message });
    }

    logger.info('[CustomsService] declaration transition', { id, from: existing.status, to: toStatus, actorId });
    return updated;
  }

  // ────────────────────────────────────────────────────────────
  // 2. HsCode（HS 编码库）
  // ────────────────────────────────────────────────────────────

  async function createHsCode(input: HsCodeInput, actorId: string) {
    validateHsCategory(input.category);

    const existing = await prisma.hsCode.findUnique({ where: { code: input.code } });
    if (existing) throw new Error(`HS 编码 ${input.code} 已存在`);

    const ts = now();
    const hsCode = await prisma.$transaction(async (tx) => {
      const code = await tx.hsCode.create({
        data: {
          id: generateId('HS'),
          code: input.code,
          description: input.description,
          category: input.category,
          exportTaxRebateRate: input.exportTaxRebateRate != null ? new Prisma.Decimal(input.exportTaxRebateRate) : null,
          importTariffRate: input.importTariffRate != null ? new Prisma.Decimal(input.importTariffRate) : null,
          vatRate: input.vatRate != null ? new Prisma.Decimal(input.vatRate) : null,
          unit: input.unit ?? null,
          supervisionCondition: input.supervisionCondition ?? null,
          inspectionQuarantine: input.inspectionQuarantine ?? null,
          additionalDuty: input.additionalDuty ?? null,
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'HS_CODE_CREATE',
          actorId,
          targetType: 'HsCode',
          targetId: code.id,
          detail: { code: code.code },
        },
      });
      return code;
    });

    logger.info('[CustomsService] hsCode created', { id: hsCode.id, code: input.code, actorId });
    return hsCode;
  }

  async function updateHsCode(id: string, input: Partial<HsCodeInput>, actorId: string) {
    const existing = await prisma.hsCode.findUnique({ where: { id } });
    if (!existing) throw new Error(`HS 编码 ${id} 不存在`);

    if (input.category) validateHsCategory(input.category);

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const code = await tx.hsCode.update({
        where: { id },
        data: {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.exportTaxRebateRate !== undefined ? { exportTaxRebateRate: input.exportTaxRebateRate != null ? new Prisma.Decimal(input.exportTaxRebateRate) : null } : {}),
          ...(input.importTariffRate !== undefined ? { importTariffRate: input.importTariffRate != null ? new Prisma.Decimal(input.importTariffRate) : null } : {}),
          ...(input.vatRate !== undefined ? { vatRate: input.vatRate != null ? new Prisma.Decimal(input.vatRate) : null } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.supervisionCondition !== undefined ? { supervisionCondition: input.supervisionCondition } : {}),
          ...(input.inspectionQuarantine !== undefined ? { inspectionQuarantine: input.inspectionQuarantine } : {}),
          ...(input.additionalDuty !== undefined ? { additionalDuty: input.additionalDuty } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'HS_CODE_UPDATE',
          actorId,
          targetType: 'HsCode',
          targetId: id,
        },
      });
      return code;
    });

    logger.info('[CustomsService] hsCode updated', { id, actorId });
    return updated;
  }

  async function deleteHsCode(id: string, actorId: string) {
    const existing = await prisma.hsCode.findUnique({ where: { id } });
    if (!existing) throw new Error(`HS 编码 ${id} 不存在`);

    // 参考数据用 deactivate 而非物理删除
    const ts = now();
    await prisma.$transaction(async (tx) => {
      await tx.hsCode.update({
        where: { id },
        data: { isActive: false, updatedAt: ts },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'HS_CODE_DEACTIVATE',
          actorId,
          targetType: 'HsCode',
          targetId: id,
        },
      });
    });

    logger.info('[CustomsService] hsCode deactivated', { id, actorId });
    return { id, deactivated: true };
  }

  async function listHsCodes(params: {
    category?: string;
    search?: string;
    isActive?: boolean;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: Prisma.HsCodeWhereInput = {};
    if (params.category) where.category = params.category;
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.OR = [
        { code: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      prisma.hsCode.findMany({
        where,
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.hsCode.count({ where }),
    ]);

    return { items, total };
  }

  async function getHsCodeByCode(code: string) {
    const hsCode = await prisma.hsCode.findUnique({ where: { code } });
    if (!hsCode) throw new Error(`HS 编码 ${code} 不存在`);
    return hsCode;
  }

  // ────────────────────────────────────────────────────────────
  // 3. LetterOfCredit（信用证）
  // ────────────────────────────────────────────────────────────

  async function createLetterOfCredit(input: LetterOfCreditInput, actorId: string) {
    validateLcType(input.type);

    // PRD 5.6：服务端自动生成信用证号（LC-YYYY-NNNN），传入时优先使用传入值并校验唯一性
    const lcNumber = input.lcNumber || await nextBusinessNumber(prisma, 'LC');
    const existing = await prisma.letterOfCredit.findFirst({
      where: { lcNumber, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new Error(`信用证号 ${lcNumber} 已存在`);

    const ts = now();
    const lc = await prisma.$transaction(async (tx) => {
      const letterOfCredit = await tx.letterOfCredit.create({
        data: {
          id: generateId('LC'),
          lcNumber,
          relationId: input.relationId ?? null,
          orderId: input.orderId ?? null,
          type: input.type,
          status: 'Issued',
          issueDate: input.issueDate ?? null,
          issueBank: input.issueBank ?? null,
          advisingBank: input.advisingBank ?? null,
          negotiatingBank: input.negotiatingBank ?? null,
          confirmingBank: input.confirmingBank ?? null,
          applicant: input.applicant ?? null,
          beneficiary: input.beneficiary ?? null,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency ?? 'USD',
          availableAmount: input.availableAmount != null ? new Prisma.Decimal(input.availableAmount) : new Prisma.Decimal(input.amount),
          expiryDate: input.expiryDate ?? null,
          expiryPlace: input.expiryPlace ?? null,
          presentationDeadline: input.presentationDeadline ?? null,
          shipmentDeadline: input.shipmentDeadline ?? null,
          tradeTerms: input.tradeTerms ?? null,
          portOfLoading: input.portOfLoading ?? null,
          portOfDischarge: input.portOfDischarge ?? null,
          documentsRequired: input.documentsRequired ?? Prisma.JsonNull,
          specialConditions: input.specialConditions ?? null,
          discrepancies: input.discrepancies ?? null,
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'LC_CREATE',
          actorId,
          targetType: 'LetterOfCredit',
          targetId: letterOfCredit.id,
          detail: { lcNumber: letterOfCredit.lcNumber, type: letterOfCredit.type, amount: input.amount },
        },
      });
      // F1：首节点事件（开证登记）+ 图谱入链，同事务保证节点可追溯
      await tx.lcEvent.create({
        data: {
          id: generateId('LCE'),
          lcId: letterOfCredit.id,
          fromNode: null,
          toNode: 'Issued',
          eventDate: input.issueDate ?? new Date().toISOString().slice(0, 10),
          note: null,
          actorId,
          createdAt: ts,
        },
      });
      await syncLetterOfCreditReferences(prisma, letterOfCredit, { source: 'api:customs' }, tx);
      return letterOfCredit;
    });

    logger.info('[CustomsService] letterOfCredit created', { id: lc.id, lcNumber, actorId });
    return lc;
  }

  async function updateLetterOfCredit(id: string, input: Partial<LetterOfCreditInput>, actorId: string) {
    const existing = await prisma.letterOfCredit.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`信用证 ${id} 不存在`);
    if (existing.status !== 'Issued') throw new Error(`信用证状态 ${existing.status} 不可编辑（仅 Issued 可编辑）`);

    if (input.type) validateLcType(input.type);

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const lc = await tx.letterOfCredit.update({
        where: { id },
        data: {
          ...(input.relationId !== undefined ? { relationId: input.relationId } : {}),
          ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.issueDate !== undefined ? { issueDate: input.issueDate } : {}),
          ...(input.issueBank !== undefined ? { issueBank: input.issueBank } : {}),
          ...(input.advisingBank !== undefined ? { advisingBank: input.advisingBank } : {}),
          ...(input.negotiatingBank !== undefined ? { negotiatingBank: input.negotiatingBank } : {}),
          ...(input.confirmingBank !== undefined ? { confirmingBank: input.confirmingBank } : {}),
          ...(input.applicant !== undefined ? { applicant: input.applicant } : {}),
          ...(input.beneficiary !== undefined ? { beneficiary: input.beneficiary } : {}),
          ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.availableAmount !== undefined ? { availableAmount: input.availableAmount != null ? new Prisma.Decimal(input.availableAmount) : null } : {}),
          ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
          ...(input.expiryPlace !== undefined ? { expiryPlace: input.expiryPlace } : {}),
          ...(input.presentationDeadline !== undefined ? { presentationDeadline: input.presentationDeadline } : {}),
          ...(input.shipmentDeadline !== undefined ? { shipmentDeadline: input.shipmentDeadline } : {}),
          ...(input.tradeTerms !== undefined ? { tradeTerms: input.tradeTerms } : {}),
          ...(input.portOfLoading !== undefined ? { portOfLoading: input.portOfLoading } : {}),
          ...(input.portOfDischarge !== undefined ? { portOfDischarge: input.portOfDischarge } : {}),
          ...(input.documentsRequired !== undefined ? { documentsRequired: input.documentsRequired ?? Prisma.JsonNull } : {}),
          ...(input.specialConditions !== undefined ? { specialConditions: input.specialConditions } : {}),
          ...(input.discrepancies !== undefined ? { discrepancies: input.discrepancies } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'LC_UPDATE',
          actorId,
          targetType: 'LetterOfCredit',
          targetId: id,
        },
      });
      // F1：关联（relationId/orderId）可能变更，事务内重建图谱链接
      await syncLetterOfCreditReferences(prisma, lc, { source: 'api:customs' }, tx);
      return lc;
    });

    logger.info('[CustomsService] letterOfCredit updated', { id, actorId });
    return updated;
  }

  async function deleteLetterOfCredit(id: string, actorId: string) {
    const existing = await prisma.letterOfCredit.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`信用证 ${id} 不存在`);
    if (existing.status !== 'Issued' && existing.status !== 'Cancelled') {
      throw new Error(`信用证状态 ${existing.status} 不可删除（仅 Issued/Cancelled 可删除）`);
    }

    const ts = now();
    await prisma.$transaction(async (tx) => {
      await tx.letterOfCredit.update({
        where: { id },
        data: { deletedAt: ts, updatedAt: ts },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'LC_DELETE',
          actorId,
          targetType: 'LetterOfCredit',
          targetId: id,
        },
      });
      // F1：软删同步停用图谱链接（LcEvent 节点历史保留，append-only 不删）
      await deactivateEntityLinks(tx, 'letterOfCredit', id, ts);
    });

    logger.info('[CustomsService] letterOfCredit deleted', { id, actorId });
    return { id, deleted: true };
  }

  async function listLettersOfCredit(params: {
    status?: string;
    relationId?: string;
    orderId?: string;
    issuingBank?: string;
    expiringBefore?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: Prisma.LetterOfCreditWhereInput = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.relationId) where.relationId = params.relationId;
    if (params.orderId) where.orderId = params.orderId;
    if (params.issuingBank) where.issueBank = { contains: params.issuingBank, mode: 'insensitive' };
    // 到期预警：expiryDate 为 YYYY-MM-DD 字符串，字典序比较与全项目日期口径一致
    if (params.expiringBefore) where.expiryDate = { not: null, lt: params.expiringBefore };
    if (params.search) {
      where.OR = [
        { lcNumber: { contains: params.search, mode: 'insensitive' } },
        { applicant: { contains: params.search, mode: 'insensitive' } },
        { beneficiary: { contains: params.search, mode: 'insensitive' } },
        { issueBank: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      prisma.letterOfCredit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.letterOfCredit.count({ where }),
    ]);

    return { items, total };
  }

  async function getLetterOfCredit(id: string) {
    const lc = await prisma.letterOfCredit.findFirst({
      where: { id, deletedAt: null },
    });
    if (!lc) throw new Error(`信用证 ${id} 不存在`);
    return lc;
  }

  async function getLetterOfCreditByNumber(lcNumber: string) {
    const lc = await prisma.letterOfCredit.findFirst({
      where: { lcNumber, deletedAt: null },
    });
    if (!lc) throw new Error(`信用证 ${lcNumber} 不存在`);
    return lc;
  }

  async function transitionLcStatus(id: string, toStatus: LetterOfCreditStatus, actorId: string, discrepancies?: string) {
    validateLcStatus(toStatus);
    const existing = await prisma.letterOfCredit.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`信用证 ${id} 不存在`);

    validateTransition(LC_TRANSITIONS, existing.status, toStatus, '信用证');

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const lc = await tx.letterOfCredit.update({
        where: { id },
        data: {
          status: toStatus,
          ...(discrepancies !== undefined && toStatus === 'Discrepant' ? { discrepancies } : {}),
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'LC_TRANSITION',
          actorId,
          targetType: 'LetterOfCredit',
          targetId: id,
          detail: { from: existing.status, to: toStatus },
        },
      });
      // F1：节点事件入时间轴（同事务）；不符点内容落入 note，便于时间轴直接展示
      await tx.lcEvent.create({
        data: {
          id: generateId('LCE'),
          lcId: id,
          fromNode: existing.status,
          toNode: toStatus,
          eventDate: new Date().toISOString().slice(0, 10),
          note: toStatus === 'Discrepant' ? (discrepancies ?? existing.discrepancies ?? null) : null,
          actorId,
          createdAt: ts,
        },
      });
      return lc;
    });

    // F1：状态变更事件（事务提交后发布，fire-and-forget 不阻断业务）
    try {
      businessEventBus.publish({
        type: 'LcStatusChanged',
        sourceEntityType: 'LetterOfCredit',
        sourceEntityId: id,
        actorId,
        payload: { lcId: id, lcNumber: existing.lcNumber, from: existing.status, to: toStatus },
        timestamp: Date.now(),
      } as any);
    } catch (e) {
      logger.warn('[CustomsService] event publish failed', { error: (e as Error)?.message });
    }

    logger.info('[CustomsService] letterOfCredit transition', { id, from: existing.status, to: toStatus, actorId });
    return updated;
  }

  /** F1：信用证节点时间轴（按业务日期 + 创建时间升序，append-only 全量返回） */
  async function listLcEvents(lcId: string) {
    const lc = await prisma.letterOfCredit.findFirst({
      where: { id: lcId, deletedAt: null },
      select: { id: true },
    });
    if (!lc) throw new Error(`信用证 ${lcId} 不存在`);
    const items = await prisma.lcEvent.findMany({
      where: { lcId },
      orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }],
    });
    return { items, total: items.length };
  }

  // ────────────────────────────────────────────────────────────
  // 4. TaxRefund（出口退税）
  // ────────────────────────────────────────────────────────────

  async function createTaxRefund(input: TaxRefundInput, actorId: string) {
    // PRD 5.6：服务端自动生成退税编号（TR-YYYY-NNNN），传入时优先使用传入值并校验唯一性
    const refundNumber = input.refundNumber || await nextBusinessNumber(prisma, 'TR');
    const existing = await prisma.taxRefund.findFirst({
      where: { refundNumber, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new Error(`退税编号 ${refundNumber} 已存在`);

    // 自动计算退税额：refundAmount = exportAmountCny × refundableRate
    let refundAmount = input.refundAmount;
    if (refundAmount == null && input.exportAmountCny != null && input.refundableRate != null) {
      refundAmount = Math.round(input.exportAmountCny * input.refundableRate * 10000) / 10000;
    }

    const ts = now();
    const refund = await prisma.$transaction(async (tx) => {
      const tr = await tx.taxRefund.create({
        data: {
          id: generateId('TR'),
          refundNumber,
          declarationId: input.declarationId ?? null,
          orderId: input.orderId ?? null,
          relationId: input.relationId ?? null,
          status: 'Draft',
          exportDate: input.exportDate ?? null,
          declarationDate: input.declarationDate ?? null,
          fxRate: input.fxRate != null ? new Prisma.Decimal(input.fxRate) : null,
          exportAmountFob: input.exportAmountFob != null ? new Prisma.Decimal(input.exportAmountFob) : null,
          exportAmountFobCurrency: input.exportAmountFobCurrency ?? null,
          exportAmountCny: input.exportAmountCny != null ? new Prisma.Decimal(input.exportAmountCny) : null,
          refundableVat: input.refundableVat != null ? new Prisma.Decimal(input.refundableVat) : null,
          refundableRate: input.refundableRate != null ? new Prisma.Decimal(input.refundableRate) : null,
          refundAmount: refundAmount != null ? new Prisma.Decimal(refundAmount) : null,
          refundDate: input.refundDate ?? null,
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TAX_REFUND_CREATE',
          actorId,
          targetType: 'TaxRefund',
          targetId: tr.id,
          detail: { refundNumber: tr.refundNumber },
        },
      });
      // EntityLink 图谱：refundsDeclaration / aboutOrder / refundTo
      await syncTaxRefundReferences(prisma, tr, { source: 'api:customs' }, tx);
      return tr;
    });

    logger.info('[CustomsService] taxRefund created', { id: refund.id, refundNumber: input.refundNumber, actorId });
    return refund;
  }

  async function updateTaxRefund(id: string, input: Partial<TaxRefundInput>, actorId: string) {
    const existing = await prisma.taxRefund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`退税记录 ${id} 不存在`);
    if (existing.status !== 'Draft') throw new Error(`退税状态 ${existing.status} 不可编辑（仅 Draft 可编辑）`);

    // 重新计算退税额
    let refundAmount = input.refundAmount;
    const exportAmountCny = input.exportAmountCny != null ? input.exportAmountCny : Number(existing.exportAmountCny);
    const refundableRate = input.refundableRate != null ? input.refundableRate : Number(existing.refundableRate);
    if (refundAmount == null && exportAmountCny != null && refundableRate != null) {
      refundAmount = Math.round(exportAmountCny * refundableRate * 10000) / 10000;
    }

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const tr = await tx.taxRefund.update({
        where: { id },
        data: {
          ...(input.declarationId !== undefined ? { declarationId: input.declarationId } : {}),
          ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
          ...(input.relationId !== undefined ? { relationId: input.relationId } : {}),
          ...(input.exportDate !== undefined ? { exportDate: input.exportDate } : {}),
          ...(input.declarationDate !== undefined ? { declarationDate: input.declarationDate } : {}),
          ...(input.fxRate !== undefined ? { fxRate: input.fxRate != null ? new Prisma.Decimal(input.fxRate) : null } : {}),
          ...(input.exportAmountFob !== undefined ? { exportAmountFob: input.exportAmountFob != null ? new Prisma.Decimal(input.exportAmountFob) : null } : {}),
          ...(input.exportAmountFobCurrency !== undefined ? { exportAmountFobCurrency: input.exportAmountFobCurrency } : {}),
          ...(input.exportAmountCny !== undefined ? { exportAmountCny: input.exportAmountCny != null ? new Prisma.Decimal(input.exportAmountCny) : null } : {}),
          ...(input.refundableVat !== undefined ? { refundableVat: input.refundableVat != null ? new Prisma.Decimal(input.refundableVat) : null } : {}),
          ...(input.refundableRate !== undefined ? { refundableRate: input.refundableRate != null ? new Prisma.Decimal(input.refundableRate) : null } : {}),
          ...(refundAmount !== undefined && refundAmount != null ? { refundAmount: new Prisma.Decimal(refundAmount) } : {}),
          ...(input.refundDate !== undefined ? { refundDate: input.refundDate } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TAX_REFUND_UPDATE',
          actorId,
          targetType: 'TaxRefund',
          targetId: id,
        },
      });
      // EntityLink 图谱：FK 快照随 update 同步
      await syncTaxRefundReferences(prisma, tr, { source: 'api:customs' }, tx);
      return tr;
    });

    logger.info('[CustomsService] taxRefund updated', { id, actorId });
    return updated;
  }

  async function deleteTaxRefund(id: string, actorId: string) {
    const existing = await prisma.taxRefund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`退税记录 ${id} 不存在`);
    if (existing.status !== 'Draft' && existing.status !== 'Cancelled') {
      throw new Error(`退税状态 ${existing.status} 不可删除（仅 Draft/Cancelled 可删除）`);
    }

    const ts = now();
    await prisma.$transaction(async (tx) => {
      await tx.taxRefund.update({
        where: { id },
        data: { deletedAt: ts, updatedAt: ts },
      });
      // EntityLink 图谱：软删同步失效发出的关联
      await deactivateEntityLinks(tx, 'taxRefund', id, ts);
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TAX_REFUND_DELETE',
          actorId,
          targetType: 'TaxRefund',
          targetId: id,
        },
      });
    });

    logger.info('[CustomsService] taxRefund deleted', { id, actorId });
    return { id, deleted: true };
  }

  async function listTaxRefunds(params: {
    status?: string;
    declarationId?: string;
    orderId?: string;
    relationId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: Prisma.TaxRefundWhereInput = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.declarationId) where.declarationId = params.declarationId;
    if (params.orderId) where.orderId = params.orderId;
    if (params.relationId) where.relationId = params.relationId;
    if (params.search) {
      where.OR = [
        { refundNumber: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      prisma.taxRefund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.taxRefund.count({ where }),
    ]);

    return { items, total };
  }

  async function getTaxRefund(id: string) {
    const tr = await prisma.taxRefund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tr) throw new Error(`退税记录 ${id} 不存在`);
    return tr;
  }

  async function transitionTaxRefundStatus(id: string, toStatus: TaxRefundStatus, actorId: string) {
    validateTaxRefundStatus(toStatus);
    const existing = await prisma.taxRefund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`退税记录 ${id} 不存在`);

    validateTransition(TAX_REFUND_TRANSITIONS, existing.status, toStatus, '退税');

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const tr = await tx.taxRefund.update({
        where: { id },
        data: { status: toStatus, updatedAt: ts },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TAX_REFUND_TRANSITION',
          actorId,
          targetType: 'TaxRefund',
          targetId: id,
          detail: { from: existing.status, to: toStatus },
        },
      });
      return tr;
    });

    // 退税到账事件
    if (toStatus === 'Refunded') {
      try {
        businessEventBus.publish({
          type: 'TaxRefundCompleted',
          sourceEntityType: 'TaxRefund',
          sourceEntityId: id,
          actorId,
          payload: { refundNumber: existing.refundNumber },
          timestamp: Date.now(),
        } as any);
      } catch (e) {
        logger.warn('[CustomsService] event publish failed', { error: (e as Error)?.message });
      }
    }

    logger.info('[CustomsService] taxRefund transition', { id, from: existing.status, to: toStatus, actorId });
    return updated;
  }

  async function reviewTaxRefund(id: string, input: TaxRefundReviewInput, actorId: string) {
    const existing = await prisma.taxRefund.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`退税记录 ${id} 不存在`);
    if (existing.status !== 'Reviewing') throw new Error(`退税状态 ${existing.status} 不可审核（仅 Reviewing 可审核）`);

    const toStatus = input.decision === 'Approved' ? 'Approved' : 'Rejected';
    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const tr = await tx.taxRefund.update({
        where: { id },
        data: {
          status: toStatus,
          reviewedBy: input.reviewedBy,
          reviewedAt: ts,
          reviewNotes: input.reviewNotes ?? null,
          ...(input.refundAmount != null ? { refundAmount: new Prisma.Decimal(input.refundAmount) } : {}),
          updatedAt: ts,
        },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TAX_REFUND_REVIEW',
          actorId,
          targetType: 'TaxRefund',
          targetId: id,
          detail: { decision: input.decision, reviewedBy: input.reviewedBy },
        },
      });
      return tr;
    });

    logger.info('[CustomsService] taxRefund reviewed', { id, decision: input.decision, actorId });
    return updated;
  }

  /**
   * 从报关单自动核算生成退税申报草稿（B1 收汇→结汇→退税闭环核心）
   *
   * 数据装配（单一回退链）：
   *   - FOB 金额：行明细 totalAmount 合计 → 回退报关单 totalValue
   *   - 汇率快照：应收发票 exchangeRate（开票当日） → 回收款凭证 exchangeRate（实际收汇日）
   *   - 出口日期：关联运单 atd（实际离港） → 回退申报日期
   *   - 退税率：按行 HS 编码查 HsCode.exportTaxRebateRate，加权汇总 refundableVat
   *
   * 幂等：同一报关单仅允许一份未删除退税申报（业务层去重，L10 联动与手动触发共用）
   */
  async function createTaxRefundFromDeclaration(declarationId: string, actorId: string) {
    const dup = await prisma.taxRefund.findFirst({
      where: { declarationId, deletedAt: null },
      select: { id: true, refundNumber: true },
    });
    if (dup) throw new Error(`报关单已存在退税申报 ${dup.refundNumber}，不可重复生成`);

    const decl = await prisma.customsDeclaration.findFirst({
      where: { id: declarationId, deletedAt: null },
      include: { lines: true },
    });
    if (!decl) throw new Error(`报关单 ${declarationId} 不存在`);

    // 汇率快照 + 出口日期（并行取数）
    const [invoice, voucher, shipment] = await Promise.all([
      decl.orderId
        ? prisma.invoice.findFirst({
            where: { orderId: decl.orderId, type: 'Receivable', deletedAt: null, status: { not: 'Cancelled' } },
            orderBy: { createdAt: 'desc' },
            select: { exchangeRate: true },
          })
        : null,
      decl.orderId
        ? prisma.paymentVoucher.findFirst({
            where: { orderId: decl.orderId, type: 'Receipt', deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { exchangeRate: true },
          })
        : null,
      decl.shipmentId
        ? prisma.shipment.findUnique({ where: { id: decl.shipmentId }, select: { atd: true, etd: true } })
        : null,
    ]);

    const fxRate = invoice?.exchangeRate != null ? Number(invoice.exchangeRate)
      : voucher?.exchangeRate != null ? Number(voucher.exchangeRate)
      : null;

    // FOB 金额：行明细合计优先，回退报关总额
    const lineSum = decl.lines.reduce((sum, l) => sum + (l.totalAmount != null ? Number(l.totalAmount) : 0), 0);
    const exportAmountFob = lineSum > 0 ? lineSum
      : decl.totalValue != null ? Number(decl.totalValue)
      : null;
    const exportAmountCny = exportAmountFob != null && fxRate != null
      ? Math.round(exportAmountFob * fxRate * 10000) / 10000
      : null;

    // 退税率：按行 HS 编码加权核算
    const hsCodes = [...new Set(decl.lines.map(l => l.hsCode).filter((c): c is string => !!c))];
    const hsRows = hsCodes.length > 0
      ? await prisma.hsCode.findMany({
          where: { code: { in: hsCodes }, isActive: true },
          select: { code: true, exportTaxRebateRate: true },
        })
      : [];
    const rebateMap = new Map(hsRows.map(h => [h.code, h.exportTaxRebateRate != null ? Number(h.exportTaxRebateRate) : null]));

    let refundableVat: number | null = null;
    if (exportAmountCny != null && fxRate != null) {
      let sum = 0;
      let covered = false;
      for (const l of decl.lines) {
        const rate = l.hsCode ? rebateMap.get(l.hsCode) : undefined;
        if (rate == null || l.totalAmount == null) continue;
        sum += Number(l.totalAmount) * fxRate * rate;
        covered = true;
      }
      if (covered) refundableVat = Math.round(sum * 10000) / 10000;
    }

    const refundableRate = refundableVat != null && exportAmountCny != null && exportAmountCny > 0
      ? Math.round((refundableVat / exportAmountCny) * 1000000) / 1000000
      : null;

    const refund = await createTaxRefund({
      refundNumber: `TRA-${decl.declarationNumber}`,
      declarationId: decl.id,
      orderId: decl.orderId ?? undefined,
      relationId: decl.relationId ?? undefined,
      exportDate: shipment?.atd ?? shipment?.etd ?? decl.declarationDate ?? undefined,
      declarationDate: decl.declarationDate ?? undefined,
      fxRate: fxRate ?? undefined,
      exportAmountFob: exportAmountFob ?? undefined,
      exportAmountFobCurrency: decl.currency ?? undefined,
      exportAmountCny: exportAmountCny ?? undefined,
      refundableVat: refundableVat ?? undefined,
      refundableRate: refundableRate ?? undefined,
      refundAmount: refundableVat ?? undefined,
      notes: `由报关单 ${decl.declarationNumber} 放行自动核算生成`,
    }, actorId);

    logger.info('[CustomsService] taxRefund auto-created from declaration', {
      id: refund.id,
      declarationId,
      exportAmountFob,
      fxRate,
      refundableVat,
    });
    return refund;
  }

  // ────────────────────────────────────────────────────────────
  // 5. TradeDocument（贸易单据）
  // ────────────────────────────────────────────────────────────

  async function createTradeDocument(input: TradeDocumentInput, actorId: string) {
    validateDocType(input.type);
    // 手动入口仅允许 customs 交单类型——域单据（PO/IR/Contract）由业务模块带 sourceRef 就地生成
    if (!MANUALLY_CREATABLE_DOC_TYPES.includes(input.type)) {
      throw new Error(`单据类型 ${input.type} 由业务模块就地生成，不支持手动创建`);
    }

    const manualNumber = input.documentNumber?.trim() || '';
    if (manualNumber) {
      const existing = await prisma.tradeDocument.findFirst({
        where: { documentNumber: manualNumber, deletedAt: null },
        select: { id: true },
      });
      if (existing) throw new Error(`单据编号 ${manualNumber} 已存在`);
    }

    // 自动取号（留空时）+ unique 冲突重试：并发下同号则重取，最多 3 次
    for (let attempt = 0; attempt < 3; attempt++) {
      const ts = now();
      try {
        const doc = await prisma.$transaction(async (tx) => {
          const documentNumber = manualNumber || await generateTradeDocumentNumber(tx, input.type);
          const document = await tx.tradeDocument.create({
            data: {
              id: generateId('TD'),
              documentNumber,
              type: input.type,
              status: 'Draft',
              shipmentId: input.shipmentId ?? null,
              declarationId: input.declarationId ?? null,
              orderId: input.orderId ?? null,
              relationId: input.relationId ?? null,
              issueDate: input.issueDate ?? null,
              expiryDate: input.expiryDate ?? null,
              issuedBy: input.issuedBy ?? null,
              consignee: input.consignee ?? null,
              consignor: input.consignor ?? null,
              portOfLoading: input.portOfLoading ?? null,
              portOfDischarge: input.portOfDischarge ?? null,
              totalAmount: input.totalAmount != null ? new Prisma.Decimal(input.totalAmount) : null,
              currency: input.currency ?? null,
              filePath: input.filePath ?? null,
              fileName: input.fileName ?? null,
              notes: input.notes ?? null,
              createdAt: ts,
              updatedAt: ts,
            },
          });
          // 服务端强制留痕：创建即 v1（整行字段快照），不依赖客户端自觉
          await appendTradeDocumentVersion(tx, {
            documentId: document.id,
            content: toTradeDocumentSnapshot(document),
            actorId,
            changeReason: '创建',
          });
          await tx.auditLog.create({
            data: {
              id: generateId('AUD'),
              action: 'TRADE_DOCUMENT_CREATE',
              actorId,
              targetType: 'TradeDocument',
              targetId: document.id,
              detail: { documentNumber: document.documentNumber, type: document.type },
            },
          });
          return document;
        });

        logger.info('[CustomsService] tradeDocument created', { id: doc.id, documentNumber: doc.documentNumber, actorId });
        return doc;
      } catch (e: any) {
        // 仅自动取号路径对 unique 冲突重试；手动编号冲突直接抛「已存在」语义外的错误
        const isUniqueConflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!manualNumber && isUniqueConflict && attempt < 2) continue;
        throw e;
      }
    }
    throw new Error('单据编号生成失败，请重试');
  }

  async function updateTradeDocument(id: string, input: Partial<TradeDocumentInput>, actorId: string) {
    const existing = await prisma.tradeDocument.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`贸易单据 ${id} 不存在`);
    if (existing.status !== 'Draft') throw new Error(`单据状态 ${existing.status} 不可编辑（仅 Draft 可编辑）`);

    if (input.type) validateDocType(input.type);

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const doc = await tx.tradeDocument.update({
        where: { id },
        data: {
          ...(input.type ? { type: input.type } : {}),
          ...(input.shipmentId !== undefined ? { shipmentId: input.shipmentId } : {}),
          ...(input.declarationId !== undefined ? { declarationId: input.declarationId } : {}),
          ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
          ...(input.relationId !== undefined ? { relationId: input.relationId } : {}),
          ...(input.issueDate !== undefined ? { issueDate: input.issueDate } : {}),
          ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
          ...(input.issuedBy !== undefined ? { issuedBy: input.issuedBy } : {}),
          ...(input.consignee !== undefined ? { consignee: input.consignee } : {}),
          ...(input.consignor !== undefined ? { consignor: input.consignor } : {}),
          ...(input.portOfLoading !== undefined ? { portOfLoading: input.portOfLoading } : {}),
          ...(input.portOfDischarge !== undefined ? { portOfDischarge: input.portOfDischarge } : {}),
          ...(input.totalAmount !== undefined ? { totalAmount: input.totalAmount != null ? new Prisma.Decimal(input.totalAmount) : null } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
          ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: ts,
        },
      });
      // 服务端强制留痕：字段更新后整行快照（max+1），不依赖客户端自觉
      await appendTradeDocumentVersion(tx, {
        documentId: doc.id,
        content: toTradeDocumentSnapshot(doc),
        actorId,
        changeReason: input.changeReason ?? '更新',
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TRADE_DOCUMENT_UPDATE',
          actorId,
          targetType: 'TradeDocument',
          targetId: id,
        },
      });
      return doc;
    });

    logger.info('[CustomsService] tradeDocument updated', { id, actorId });
    return updated;
  }

  async function deleteTradeDocument(id: string, actorId: string) {
    const existing = await prisma.tradeDocument.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`贸易单据 ${id} 不存在`);
    if (existing.status !== 'Draft' && existing.status !== 'Cancelled') {
      throw new Error(`单据状态 ${existing.status} 不可删除（仅 Draft/Cancelled 可删除）`);
    }

    const ts = now();
    await prisma.$transaction(async (tx) => {
      await tx.tradeDocument.update({
        where: { id },
        data: { deletedAt: ts, updatedAt: ts },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TRADE_DOCUMENT_DELETE',
          actorId,
          targetType: 'TradeDocument',
          targetId: id,
        },
      });
    });

    logger.info('[CustomsService] tradeDocument deleted', { id, actorId });
    return { id, deleted: true };
  }

  async function listTradeDocuments(params: {
    type?: string;
    status?: string;
    /** 业务域过滤（B4：customs/procurement/qc/contract/finance——单据中心域视图） */
    domain?: string;
    shipmentId?: string;
    declarationId?: string;
    orderId?: string;
    relationId?: string;
    /** 财务发票回链反查（CI 引用财务 Invoice 真源，发票详情查交单状态用） */
    sourceInvoiceId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: Prisma.TradeDocumentWhereInput = { deletedAt: null };
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.domain) where.domain = params.domain;
    if (params.shipmentId) where.shipmentId = params.shipmentId;
    if (params.declarationId) where.declarationId = params.declarationId;
    if (params.orderId) where.orderId = params.orderId;
    if (params.relationId) where.relationId = params.relationId;
    if (params.sourceInvoiceId) where.sourceInvoiceId = params.sourceInvoiceId;
    if (params.search) {
      where.OR = [
        { documentNumber: { contains: params.search, mode: 'insensitive' } },
        { consignee: { contains: params.search, mode: 'insensitive' } },
        { consignor: { contains: params.search, mode: 'insensitive' } },
        { issuedBy: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      prisma.tradeDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.tradeDocument.count({ where }),
    ]);

    return { items, total };
  }

  async function getTradeDocument(id: string) {
    const doc = await prisma.tradeDocument.findFirst({
      where: { id, deletedAt: null },
    });
    if (!doc) throw new Error(`贸易单据 ${id} 不存在`);
    return doc;
  }

  async function transitionTradeDocumentStatus(id: string, toStatus: TradeDocumentStatus, actorId: string) {
    validateDocStatus(toStatus);
    const existing = await prisma.tradeDocument.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new Error(`贸易单据 ${id} 不存在`);

    // 按业务域选状态机（B2：customs 交单状态机 / 其余域简化文档生命周期；
    // domain 空值回退 customs——schema default 保证非空，此为历史行防御）
    validateTransition(docStatusTransitionsFor(existing.domain || 'customs'), existing.status, toStatus, '单据');

    const ts = now();
    const updated = await prisma.$transaction(async (tx) => {
      const doc = await tx.tradeDocument.update({
        where: { id },
        data: { status: toStatus, updatedAt: ts },
      });
      await tx.auditLog.create({
        data: {
          id: generateId('AUD'),
          action: 'TRADE_DOCUMENT_TRANSITION',
          actorId,
          targetType: 'TradeDocument',
          targetId: id,
          detail: { from: existing.status, to: toStatus },
        },
      });
      return doc;
    });

    logger.info('[CustomsService] tradeDocument transition', { id, from: existing.status, to: toStatus, actorId });
    return updated;
  }

  // ────────────────────────────────────────────────────────────
  // 概览统计
  // ────────────────────────────────────────────────────────────

  async function getCustomsOverview() {
    const [
      declarationCount,
      releasedCount,
      pendingLcCount,
      settledLcCount,
      pendingRefundCount,
      refundedCount,
      docCount,
    ] = await Promise.all([
      prisma.customsDeclaration.count({ where: { deletedAt: null } }),
      prisma.customsDeclaration.count({ where: { deletedAt: null, status: 'Released' } }),
      prisma.letterOfCredit.count({ where: { deletedAt: null, status: { in: ['Issued', 'Presented', 'Accepted', 'Discrepant'] } } }),
      prisma.letterOfCredit.count({ where: { deletedAt: null, status: 'Settled' } }),
      prisma.taxRefund.count({ where: { deletedAt: null, status: { in: ['Draft', 'Submitted', 'Reviewing', 'Approved'] } } }),
      prisma.taxRefund.count({ where: { deletedAt: null, status: 'Refunded' } }),
      prisma.tradeDocument.count({ where: { deletedAt: null } }),
    ]);

    // 退税总额
    const refundedAgg = await prisma.taxRefund.aggregate({
      where: { deletedAt: null, status: 'Refunded', refundAmount: { not: null } },
      _sum: { refundAmount: true },
    });

    return {
      declarations: { total: declarationCount, released: releasedCount },
      lettersOfCredit: { pending: pendingLcCount, settled: settledLcCount },
      taxRefunds: { pending: pendingRefundCount, refunded: refundedCount, totalRefundedAmount: refundedAgg._sum.refundAmount ? Number(refundedAgg._sum.refundAmount) : 0 },
      tradeDocuments: { total: docCount },
    };
  }

  return {
    // CustomsDeclaration
    createDeclaration,
    updateDeclaration,
    deleteDeclaration,
    listDeclarations,
    getDeclaration,
    transitionDeclarationStatus,
    // HsCode
    createHsCode,
    updateHsCode,
    deleteHsCode,
    listHsCodes,
    getHsCodeByCode,
    // LetterOfCredit
    createLetterOfCredit,
    updateLetterOfCredit,
    deleteLetterOfCredit,
    listLettersOfCredit,
    getLetterOfCredit,
    getLetterOfCreditByNumber,
    transitionLcStatus,
    listLcEvents,
    // TaxRefund
    createTaxRefund,
    updateTaxRefund,
    deleteTaxRefund,
    listTaxRefunds,
    getTaxRefund,
    transitionTaxRefundStatus,
    reviewTaxRefund,
    createTaxRefundFromDeclaration,
    // TradeDocument
    createTradeDocument,
    updateTradeDocument,
    deleteTradeDocument,
    listTradeDocuments,
    getTradeDocument,
    transitionTradeDocumentStatus,
    // Overview
    getCustomsOverview,
  };
}

export type CustomsService = ReturnType<typeof createCustomsService>;
