/**
 * ERP-P1-development-convert-to-order-flow-contract
 *
 * convertDevCaseToOrder service（route + Agent flow 共用契约）。
 * Order create/link + DevCase update + syncDevelopmentCaseReferences + syncOrderEntityReferences + AuditLog
 * 同事务闭环，失败 fail closed。
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { syncDevelopmentCaseReferences, syncOrderEntityReferences } from '../entities/sync';
import { writeRouteAuditLog } from '../audit/routeAudit';

export type DevConvertErrorCode =
  | 'DEV_CASE_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'ALREADY_CONVERTED'
  | 'CASE_CANCELLED'
  | 'CONVERT_FAILED';

export interface DevConvertError {
  code: DevConvertErrorCode;
  message: string;
  existingOrderId?: string;
}

export interface DevConvertParams {
  prisma: PrismaClient;
  caseId: string;
  mode: 'link' | 'autoCreate';
  // link 模式
  orderId?: string;
  orderPo?: string;
  // autoCreate 模式
  customer?: string;
  millName?: string;
  dueDate?: string;
  productName?: string;
  quantity?: number;
  // audit
  actorId?: string;
}

export interface DevConvertResult {
  ok: boolean;
  error?: DevConvertError;
  data?: {
    case: any;
    order: any | null;
    auditId: string;
  };
}

export async function convertDevCaseToOrder(params: DevConvertParams): Promise<DevConvertResult> {
  const { prisma, caseId, mode, orderId, orderPo, customer, millName, dueDate, productName, quantity, actorId } = params;
  const wantAutoCreate = mode === 'autoCreate';

  // 1. 读 DevelopmentCase（fail closed）
  const existing = await prisma.developmentCase.findFirst({
    where: { id: caseId, deletedAt: null },
  });
  if (!existing) {
    return { ok: false, error: { code: 'DEV_CASE_NOT_FOUND', message: `Development case ${caseId} not found` } };
  }
  if (existing.linkedOrderId) {
    return { ok: false, error: { code: 'ALREADY_CONVERTED', message: `Case already linked to order ${existing.linkedOrderId}`, existingOrderId: existing.linkedOrderId } };
  }
  if (existing.stage === 'cancelled') {
    return { ok: false, error: { code: 'CASE_CANCELLED', message: `Cannot convert cancelled case (stage=cancelled)` } };
  }

  // 2. link 模式：校验 order 存在
  if (!wantAutoCreate) {
    const finalOrderIdCheck = String(orderId || '').trim();
    if (!finalOrderIdCheck) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'orderId is required for link mode' } };
    }
    const orderExists = await prisma.order.findUnique({ where: { id: finalOrderIdCheck }, select: { id: true } }).catch(() => null);
    if (!orderExists) {
      return { ok: false, error: { code: 'ORDER_NOT_FOUND', message: `Order ${finalOrderIdCheck} not found` } };
    }
  }

  const now = BigInt(Date.now());
  let finalOrderId = String(orderId || '').trim();
  let finalOrderPo = String(orderPo || '').trim();
  if (wantAutoCreate) {
    const baseTs = Date.now();
    finalOrderId = finalOrderId || `ORD-FROMDEV-${existing.code}-${baseTs}`;
    finalOrderPo = finalOrderPo || `PO-${existing.code}-${baseTs}`;
  }

  // 3. 事务闭环
  let createdOrder: any = null;
  let doc: any = null;
  let auditId = '';
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      if (wantAutoCreate) {
        createdOrder = await tx.order.create({
          data: {
            id: finalOrderId,
            poNumber: finalOrderPo,
            customer: customer ?? existing.customerName ?? '',
            product: existing.productName ?? productName ?? '',
            type: existing.type === 'garment' ? 'garment' : 'fabric',
            quantity: typeof quantity === 'number' ? Math.trunc(quantity) : 0,
            status: 'Pending',
            dueDate: dueDate ?? '',
            quoteAmount: 0,
            customerRelationId: existing.customerRelationId ?? null,
            millName: millName ?? existing.supplierName ?? null,
            millRelationId: existing.supplierRelationId ?? null,
            importedAt: now,
            updatedAt: now,
            source: 'dev-case-convert',
            fieldSources: {} as Prisma.InputJsonValue,
          },
        });
        if (existing.productAssetId || existing.productName || productName) {
          await tx.orderLine.create({
            data: {
              id: `OL-${finalOrderId}-1`,
              orderId: finalOrderId,
              lineNumber: 1,
              materialCode: existing.productAssetId ?? null,
              description: existing.productName ?? productName ?? null,
              quantity: typeof quantity === 'number' ? quantity : 0,
              status: 'Pending',
            },
          });
        }
      }

      doc = await tx.developmentCase.update({
        where: { id: caseId },
        data: {
          linkedOrderId: finalOrderId,
          linkedOrderPo: finalOrderPo,
          convertedAt: now,
          stage: 'approved',
          completedDate: new Date().toISOString().split('T')[0],
          updatedAt: now,
        },
      });

      // sync（同事务，fail closed）
      if (wantAutoCreate) {
        await syncOrderEntityReferences(prisma, createdOrder, { source: 'dev-case-convert' }, tx);
      } else {
        const linkedOrder = await tx.order.findUnique({ where: { id: finalOrderId } });
        if (!linkedOrder) {
          throw new Error(`Order ${finalOrderId} not found in transaction (link mode)`);
        }
        await syncOrderEntityReferences(prisma, linkedOrder, { source: 'dev-case-convert' }, tx);
      }
      await syncDevelopmentCaseReferences(prisma, doc, { source: 'dev-case-convert' }, tx);

      // audit（同事务，用 writeRouteAuditLog 返回真实 id）
      auditId = await writeRouteAuditLog({
        prisma: tx,
        actorId: actorId || 'api',
        source: 'dev:convert',
        operation: 'convert_dev_case',
        targetType: 'DevelopmentCase',
        targetId: doc.id,
        before: { stage: existing.stage, linkedOrderId: null },
        after: { stage: 'approved', linkedOrderId: finalOrderId, orderId: finalOrderId, autoCreated: wantAutoCreate },
      });

      return { doc, createdOrder };
    });
    doc = result.doc;
    createdOrder = result.createdOrder;
  } catch (txErr: any) {
    return { ok: false, error: { code: 'CONVERT_FAILED', message: `Convert transaction failed: ${String(txErr?.message ?? txErr)}` } };
  }

  return { ok: true, data: { case: doc, order: createdOrder, auditId } };
}
