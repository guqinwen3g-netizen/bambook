import type { PrismaClient } from '@prisma/client';

type OrderLike = Record<string, any> & { id: string };

const ORDER_RELATION_FIELDS = [
  { fieldKey: 'customer', relationIdKey: 'customerRelationId', targetType: 'relation.organization', linkKind: 'orderedBy' },
  { fieldKey: 'millName', relationIdKey: 'millRelationId', targetType: 'relation.organization', linkKind: 'suppliedBy' },
  { fieldKey: 'consigneeName', relationIdKey: 'consigneeRelationId', targetType: 'relation.organization', linkKind: 'shipsTo' },
  { fieldKey: 'billToName', relationIdKey: 'billToRelationId', targetType: 'relation.organization', linkKind: 'billTo' },
  { fieldKey: 'salesPerson', relationIdKey: 'salesPersonRelationId', targetType: 'relation.person', linkKind: 'handledBy' },
  { fieldKey: 'merchandiser', relationIdKey: 'merchandiserRelationId', targetType: 'relation.person', linkKind: 'merchandisedBy' },
  { fieldKey: 'supervisor', relationIdKey: 'supervisorRelationId', targetType: 'relation.person', linkKind: 'supervisedBy' },
] as const;

export async function syncOrderEntityReferences(
  prisma: PrismaClient,
  order: OrderLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,
): Promise<void> {
  const ctx = tx || prisma;
  if (!order?.id) return;
  const now = options.now?.() ?? Date.now();
  const ops: any[] = [];

  for (const spec of ORDER_RELATION_FIELDS) {
    const relationId = stringOrNull(order[spec.relationIdKey]);
    if (!relationId) continue;
    const snapshot = compact({
      label: order[spec.fieldKey],
      relationId,
      fieldKey: spec.fieldKey,
    });
    const referenceId = referenceIdFor('order', order.id, spec.fieldKey, spec.targetType, relationId);
    const linkId = linkIdFor('order', order.id, spec.targetType, relationId, spec.linkKind);

    ops.push((ctx as any).entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot,
        confidence: 1,
        source: options.source,
        status: 'active',
        updatedAt: BigInt(now),
        deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'order',
        ownerId: order.id,
        fieldKey: spec.fieldKey,
        targetType: spec.targetType,
        targetId: relationId,
        snapshot,
        confidence: 1,
        source: options.source,
        status: 'active',
        createdAt: BigInt(now),
        updatedAt: BigInt(now),
      },
    }));

    ops.push((ctx as any).entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1,
        source: options.source,
        status: 'active',
        updatedAt: BigInt(now),
        deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'order',
        fromId: order.id,
        toType: spec.targetType,
        toId: relationId,
        linkKind: spec.linkKind,
        confidence: 1,
        source: options.source,
        status: 'active',
        createdAt: BigInt(now),
        updatedAt: BigInt(now),
      },
    }));
  }

  if (ops.length > 0) {
    if (tx) {
      for (const op of ops) await op;
    } else {
      await (prisma as any).$transaction(ops);
    }
  }
}

// ---------------------------------------------------------------------------
// DevelopmentCase ↔ Relation / Product sync
//
// Mirrors the Order pattern so the cross-module entity graph stays consistent.
// linkKinds: developFor (customer), developBy (supplier), aboutProduct.
// ---------------------------------------------------------------------------

const DEV_CASE_RELATION_FIELDS = [
  { fieldKey: 'customerName', relationIdKey: 'customerRelationId', targetType: 'relation.organization', linkKind: 'developFor' },
  { fieldKey: 'supplierName', relationIdKey: 'supplierRelationId', targetType: 'relation.organization', linkKind: 'developBy' },
] as const;

type DevCaseLike = Record<string, any> & { id: string };

export async function syncDevelopmentCaseReferences(
  prisma: PrismaClient,
  devCase: DevCaseLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,
): Promise<void> {
  const ctx = tx || prisma;
  if (!devCase?.id) return;
  const now = options.now?.() ?? Date.now();
  const ops: any[] = [];

  for (const spec of DEV_CASE_RELATION_FIELDS) {
    const relationId = stringOrNull(devCase[spec.relationIdKey]);
    if (!relationId) continue;
    const snapshot = compact({
      label: devCase[spec.fieldKey],
      relationId,
      fieldKey: spec.fieldKey,
    });
    const referenceId = referenceIdFor('development-case', devCase.id, spec.fieldKey, spec.targetType, relationId);
    const linkId = linkIdFor('development-case', devCase.id, spec.targetType, relationId, spec.linkKind);

    ops.push((ctx as any).entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'development-case', ownerId: devCase.id,
        fieldKey: spec.fieldKey,
        targetType: spec.targetType, targetId: relationId,
        snapshot, confidence: 1, source: options.source,
        status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push((ctx as any).entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'development-case', fromId: devCase.id,
        toType: spec.targetType, toId: relationId,
        linkKind: spec.linkKind,
        confidence: 1, source: options.source,
        status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  // productAssetId → product (any subtype)
  const productAssetId = stringOrNull(devCase.productAssetId);
  if (productAssetId) {
    const snapshot = compact({
      label: devCase.productName,
      productAssetId,
      fieldKey: 'productAssetId',
    });
    const referenceId = referenceIdFor('development-case', devCase.id, 'productAssetId', 'product', productAssetId);
    const linkId = linkIdFor('development-case', devCase.id, 'product', productAssetId, 'aboutProduct');

    ops.push((ctx as any).entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'development-case', ownerId: devCase.id,
        fieldKey: 'productAssetId',
        targetType: 'product', targetId: productAssetId,
        snapshot, confidence: 1, source: options.source,
        status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push((ctx as any).entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'development-case', fromId: devCase.id,
        toType: 'product', toId: productAssetId,
        linkKind: 'aboutProduct',
        confidence: 1, source: options.source,
        status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  if (ops.length > 0) {
    if (tx) {
      for (const op of ops) await op;
    } else {
      await (prisma as any).$transaction(ops);
    }
  }
}

// ---------------------------------------------------------------------------
// OrderLine ↔ Product sync
//
// linkKind: 'aboutMaterial' for fabric lines, 'aboutGarment' for garment lines.
// We resolve product reference via materialCode (= productAssetId) when present.
// ---------------------------------------------------------------------------

type OrderLineLike = Record<string, any> & { id: string; orderId: string };

export async function syncOrderLineEntityReferences(
  prisma: PrismaClient,
  line: OrderLineLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,
): Promise<void> {
  if (!line?.id) return;
  const productAssetId = stringOrNull(line.materialCode);
  if (!productAssetId) return;
  const now = options.now?.() ?? Date.now();
  const linkKind = line.type === 'garment' ? 'aboutGarment' : 'aboutMaterial';
  const snapshot = compact({
    label: line.description,
    productAssetId,
    fieldKey: 'materialCode',
    orderId: line.orderId,
    lineNumber: line.lineNumber,
  });
  const referenceId = referenceIdFor('orderLine', line.id, 'materialCode', 'product', productAssetId);
  const linkId = linkIdFor('orderLine', line.id, 'product', productAssetId, linkKind);

  if (tx) {
    // tx 模式：逐个 await（Prisma 禁止嵌套 $transaction）
    await tx.entityReference.upsert({
      where: { id: referenceId },
      update: { snapshot, confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: referenceId,
        ownerType: 'orderLine', ownerId: line.id,
        fieldKey: 'materialCode',
        targetType: 'product', targetId: productAssetId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    });
    await tx.entityLink.upsert({
      where: { id: linkId },
      update: { confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: linkId,
        fromType: 'orderLine', fromId: line.id,
        toType: 'product', toId: productAssetId,
        linkKind,
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    });
  } else {
    // 非 tx 模式：$transaction([promise, promise]) 批量
    await (prisma as any).$transaction([
      (prisma as any).entityReference.upsert({
        where: { id: referenceId },
        update: { snapshot, confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
        create: {
          id: referenceId,
          ownerType: 'orderLine', ownerId: line.id,
          fieldKey: 'materialCode',
          targetType: 'product', targetId: productAssetId,
          snapshot, confidence: 1, source: options.source, status: 'active',
          createdAt: BigInt(now), updatedAt: BigInt(now),
        },
      }),
      (prisma as any).entityLink.upsert({
        where: { id: linkId },
        update: { confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
        create: {
          id: linkId,
          fromType: 'orderLine', fromId: line.id,
          toType: 'product', toId: productAssetId,
          linkKind,
          confidence: 1, source: options.source, status: 'active',
          createdAt: BigInt(now), updatedAt: BigInt(now),
        },
      }),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Contact (relation.contact) ↔ Organization (relation.organization) sync
//
// linkKind: 'belongsTo'. We rely on Relation.parentId to express the
// hierarchy (contact's parent is its organization).
// ---------------------------------------------------------------------------

type RelationLike = Record<string, any> & { id: string };

export async function syncRelationEntityReferences(
  prisma: PrismaClient,
  relation: RelationLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,  // task: relations-audit-entitylink-contract: 可选事务上下文
): Promise<void> {
  if (!relation?.id) return;
  // Treat as contact if it has a parent organization. Don't rely on the
  // `type` field casing (DB has 'Contact', UI sometimes uses 'contact').
  if (relation.isOrganization === true) return;
  const parentId = stringOrNull(relation.parentId);
  if (!parentId) return;
  const now = options.now?.() ?? Date.now();
  // task: relations-audit-entitylink-contract: 有 tx 用 tx 构建 ops（事务内执行）
  const ctx = tx || prisma;
  const snapshot = compact({
    label: relation.name,
    parentId,
    fieldKey: 'parentId',
    role: relation.role,
  });
  const referenceId = referenceIdFor('relation.contact', relation.id, 'parentId', 'relation.organization', parentId);
  const linkId = linkIdFor('relation.contact', relation.id, 'relation.organization', parentId, 'belongsTo');

  const ops = [
    ctx.entityReference.upsert({
      where: { id: referenceId },
      update: { snapshot, confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: referenceId,
        ownerType: 'relation.contact', ownerId: relation.id,
        fieldKey: 'parentId',
        targetType: 'relation.organization', targetId: parentId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }),
    ctx.entityLink.upsert({
      where: { id: linkId },
      update: { confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: linkId,
        fromType: 'relation.contact', fromId: relation.id,
        toType: 'relation.organization', toId: parentId,
        linkKind: 'belongsTo',
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }),
  ];

  if (tx) {
    // task: 事务内逐个 await（tx 无 $transaction，禁止嵌套）
    for (const op of ops) await op;
  } else {
    await (prisma as any).$transaction(ops);
  }
}

// ---------------------------------------------------------------------------
// Invoice ↔ Order / Relation sync
//
// linkKinds: aboutOrder (orderId→order), billTo (customerRelationId→relation.organization).
// Mirrors the Order/DevCase pattern — dual-write EntityReference + EntityLink.
// ---------------------------------------------------------------------------

const INVOICE_RELATION_FIELDS = [
  { fieldKey: 'customerName', relationIdKey: 'customerRelationId', targetType: 'relation.organization', linkKind: 'billTo' },
] as const;

type InvoiceLike = Record<string, any> & { id: string };

/**
 * 构建 invoice 的 entityReference/entityLink ops（aboutOrder + billTo 两维度）。
 * 供 commitTransaction 在同一 $transaction 内执行，避免 syncInvoiceReferences 内部嵌套 $transaction。
 * 返回的 ops 是 PrismaPromise，caller 用 await Promise.all(ops) 或逐个 await。
 */
export function buildInvoiceReferenceOps(
  prisma: PrismaClient,
  invoice: InvoiceLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
): any[] {
  if (!invoice?.id) return [];
  const now = options.now?.() ?? Date.now();
  const ops: any[] = [];

  // 1) aboutOrder link — orderId → order
  const orderId = stringOrNull(invoice.orderId);
  if (orderId) {
    const snapshot = compact({
      orderId,
      fieldKey: 'orderId',
      invoiceNumber: invoice.invoiceNumber,
    });
    const referenceId = referenceIdFor('invoice', invoice.id, 'orderId', 'order', orderId);
    const linkId = linkIdFor('invoice', invoice.id, 'order', orderId, 'aboutOrder');

    ops.push((prisma as any).entityReference.upsert({
      where: { id: referenceId },
      update: { snapshot, confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: referenceId, ownerType: 'invoice', ownerId: invoice.id, fieldKey: 'orderId',
        targetType: 'order', targetId: orderId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
    ops.push((prisma as any).entityLink.upsert({
      where: { id: linkId },
      update: { confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: linkId, fromType: 'invoice', fromId: invoice.id, toType: 'order', toId: orderId,
        linkKind: 'aboutOrder', confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  // 2) billTo link — customerRelationId → relation.organization
  for (const spec of INVOICE_RELATION_FIELDS) {
    const relationId = stringOrNull((invoice as any)[spec.relationIdKey]);
    if (!relationId) continue;
    const snapshot = compact({
      label: (invoice as any)[spec.fieldKey],
      relationId,
      fieldKey: spec.fieldKey,
    });
    const referenceId = referenceIdFor('invoice', invoice.id, spec.fieldKey, spec.targetType, relationId);
    const linkId = linkIdFor('invoice', invoice.id, spec.targetType, relationId, spec.linkKind);

    ops.push((prisma as any).entityReference.upsert({
      where: { id: referenceId },
      update: { snapshot, confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: referenceId, ownerType: 'invoice', ownerId: invoice.id, fieldKey: spec.fieldKey,
        targetType: spec.targetType, targetId: relationId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
    ops.push((prisma as any).entityLink.upsert({
      where: { id: linkId },
      update: { confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: linkId, fromType: 'invoice', fromId: invoice.id, toType: spec.targetType, toId: relationId,
        linkKind: spec.linkKind, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  return ops;
}

export async function syncInvoiceReferences(
  prisma: PrismaClient,
  invoice: InvoiceLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,  // task_mqxxxu1g: 可选事务上下文，传入则在事务内逐个 await ops（不嵌套 $transaction）
): Promise<void> {
  // 复用 buildInvoiceReferenceOps（aboutOrder + billTo 两维度），避免逻辑漂移
  // task_mqxxxu1g: 有 tx 时用 tx 构建 ops（事务内执行），无 tx 保持原 $transaction 逻辑
  const ctx = tx || prisma;
  const ops = buildInvoiceReferenceOps(ctx, invoice, options);
  if (ops.length === 0) return;
  if (tx) {
    // 事务内：逐个 await（Prisma 禁止嵌套 $transaction）
    for (const op of ops) await op;
  } else {
    await (prisma as any).$transaction(ops);
  }
}

// ---------------------------------------------------------------------------
// PaymentVoucher ↔ Order / Invoice / Relation sync
//
// linkKinds: aboutOrder (orderId→order), billTo (customerRelationId→relation.organization),
//            settlesInvoice (invoiceId→invoice).
// ---------------------------------------------------------------------------

const PAYMENT_VOUCHER_RELATION_FIELDS = [
  { fieldKey: 'customerName', relationIdKey: 'customerRelationId', targetType: 'relation.organization', linkKind: 'billTo' },
] as const;

type PaymentVoucherLike = Record<string, any> & { id: string };

export async function syncPaymentVoucherReferences(
  prisma: PrismaClient,
  voucher: PaymentVoucherLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,  // task_mqxxxu1g: 可选事务上下文
): Promise<void> {
  if (!voucher?.id) return;
  const now = options.now?.() ?? Date.now();
  const ctx = tx || prisma;  // task_mqxxxu1g: 有 tx 用 tx 构建 ops
  const ops: any[] = [];

  // 1) aboutOrder link — orderId → order
  const orderId = stringOrNull(voucher.orderId);
  if (orderId) {
    const snapshot = compact({
      orderId,
      fieldKey: 'orderId',
      voucherNumber: voucher.voucherNumber,
    });
    const referenceId = referenceIdFor('paymentVoucher', voucher.id, 'orderId', 'order', orderId);
    const linkId = linkIdFor('paymentVoucher', voucher.id, 'order', orderId, 'aboutOrder');

    ops.push(ctx.entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'paymentVoucher', ownerId: voucher.id,
        fieldKey: 'orderId',
        targetType: 'order', targetId: orderId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push(ctx.entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'paymentVoucher', fromId: voucher.id,
        toType: 'order', toId: orderId,
        linkKind: 'aboutOrder',
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  // 2) settlesInvoice link — invoiceId → invoice
  const invoiceId = stringOrNull(voucher.invoiceId);
  if (invoiceId) {
    const snapshot = compact({
      invoiceId,
      fieldKey: 'invoiceId',
      appliedAmount: voucher.appliedAmount,
      voucherNumber: voucher.voucherNumber,
    });
    const referenceId = referenceIdFor('paymentVoucher', voucher.id, 'invoiceId', 'invoice', invoiceId);
    const linkId = linkIdFor('paymentVoucher', voucher.id, 'invoice', invoiceId, 'settlesInvoice');

    ops.push(ctx.entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'paymentVoucher', ownerId: voucher.id,
        fieldKey: 'invoiceId',
        targetType: 'invoice', targetId: invoiceId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push(ctx.entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'paymentVoucher', fromId: voucher.id,
        toType: 'invoice', toId: invoiceId,
        linkKind: 'settlesInvoice',
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  // 3) billTo link — customerRelationId → relation.organization
  for (const spec of PAYMENT_VOUCHER_RELATION_FIELDS) {
    const relationId = stringOrNull(voucher[spec.relationIdKey]);
    if (!relationId) continue;
    const snapshot = compact({
      label: voucher[spec.fieldKey],
      relationId,
      fieldKey: spec.fieldKey,
    });
    const referenceId = referenceIdFor('paymentVoucher', voucher.id, spec.fieldKey, spec.targetType, relationId);
    const linkId = linkIdFor('paymentVoucher', voucher.id, spec.targetType, relationId, spec.linkKind);

    ops.push(ctx.entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'paymentVoucher', ownerId: voucher.id,
        fieldKey: spec.fieldKey,
        targetType: spec.targetType, targetId: relationId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push(ctx.entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'paymentVoucher', fromId: voucher.id,
        toType: spec.targetType, toId: relationId,
        linkKind: spec.linkKind,
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  if (ops.length === 0) return;
  if (tx) {
    // task_mqxxxu1g: 事务内逐个 await（tx 无 $transaction，禁止嵌套）
    for (const op of ops) await op;
  } else {
    await (prisma as any).$transaction(ops);
  }
}

export function referenceIdFor(ownerType: string, ownerId: string, fieldKey: string, targetType: string, targetId: string): string {
  return ['REF', ownerType, ownerId, fieldKey, targetType, targetId].map(safeIdPart).join('__');
}

export function linkIdFor(fromType: string, fromId: string, toType: string, toId: string, linkKind: string): string {
  return ['LINK', fromType, fromId, linkKind, toType, toId].map(safeIdPart).join('__');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeIdPart(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80);
}

export function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

// ---------------------------------------------------------------------------
// Shipment ↔ Order / Relation sync
//
// linkKinds:
//   - aboutOrder (orderId→order): 运单关联订单
//   - billTo (customerRelationId→relation.organization): 运单的收货方/结算对象
//   - shipsVia (carrierRelationId→relation.organization): 运单的货运代理/船公司
//     注：schema 字段为 carrierRelationId/carrierName（与 route/toolRuntime 一致）
// ---------------------------------------------------------------------------

const SHIPMENT_RELATION_FIELDS = [
  { fieldKey: 'customerName', relationIdKey: 'customerRelationId', targetType: 'relation.organization', linkKind: 'billTo' },
  { fieldKey: 'carrierName', relationIdKey: 'carrierRelationId', targetType: 'relation.organization', linkKind: 'shipsVia' },
] as const;

type ShipmentLike = Record<string, any> & { id: string };

export async function syncShipmentReferences(
  prisma: PrismaClient,
  shipment: ShipmentLike,
  options: { source: string; now?: () => number } = { source: 'manual' },
  tx?: any,  // task_mqxxxu3k: 可选事务上下文
): Promise<void> {
  if (!shipment?.id) return;
  const now = options.now?.() ?? Date.now();
  const ctx = tx || prisma;  // task_mqxxxu3k: 有 tx 用 tx 构建 ops
  const ops: any[] = [];

  // 1) aboutOrder link — orderId → order
  const orderId = stringOrNull(shipment.orderId);
  if (orderId) {
    const snapshot = compact({
      orderId,
      fieldKey: 'orderId',
      shipmentNumber: shipment.shipmentNumber,
    });
    const referenceId = referenceIdFor('shipment', shipment.id, 'orderId', 'order', orderId);
    const linkId = linkIdFor('shipment', shipment.id, 'order', orderId, 'aboutOrder');

    ops.push(ctx.entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'shipment', ownerId: shipment.id,
        fieldKey: 'orderId',
        targetType: 'order', targetId: orderId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push(ctx.entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'shipment', fromId: shipment.id,
        toType: 'order', toId: orderId,
        linkKind: 'aboutOrder',
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  // 2) billTo + shipsVia links — customerRelationId / carrierRelationId → relation.organization
  for (const spec of SHIPMENT_RELATION_FIELDS) {
    const relationId = stringOrNull(shipment[spec.relationIdKey]);
    if (!relationId) continue;
    const snapshot = compact({
      label: shipment[spec.fieldKey],
      relationId,
      fieldKey: spec.fieldKey,
    });
    const referenceId = referenceIdFor('shipment', shipment.id, spec.fieldKey, spec.targetType, relationId);
    const linkId = linkIdFor('shipment', shipment.id, spec.targetType, relationId, spec.linkKind);

    ops.push(ctx.entityReference.upsert({
      where: { id: referenceId },
      update: {
        snapshot, confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: referenceId,
        ownerType: 'shipment', ownerId: shipment.id,
        fieldKey: spec.fieldKey,
        targetType: spec.targetType, targetId: relationId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));

    ops.push(ctx.entityLink.upsert({
      where: { id: linkId },
      update: {
        confidence: 1, source: options.source,
        status: 'active', updatedAt: BigInt(now), deletedAt: null,
      },
      create: {
        id: linkId,
        fromType: 'shipment', fromId: shipment.id,
        toType: spec.targetType, toId: relationId,
        linkKind: spec.linkKind,
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    }));
  }

  if (ops.length === 0) return;
  if (tx) {
    // task_mqxxxu3k: 事务内逐个 await（tx 无 $transaction，禁止嵌套）
    for (const op of ops) await op;
  } else {
    await (prisma as any).$transaction(ops);
  }
}


/**
 * ERP-P1-order-lifecycle: 共享 helper（把 owner 发出的所有 active EntityLink + EntityReference 置 inactive）。
 * order/finance 软删共用，避免逻辑漂移。
 */
export async function deactivateEntityLinks(tx: any, ownerType: string, ownerId: string, now: bigint): Promise<void> {
  const links = await tx.entityLink.findMany({
    where: { fromType: ownerType, fromId: ownerId, status: 'active' },
    select: { id: true },
  });
  for (const link of links) {
    await tx.entityLink.update({
      where: { id: link.id },
      data: { status: 'inactive', updatedAt: now, deletedAt: now },
    });
  }
  const refs = await tx.entityReference.findMany({
    where: { ownerType, ownerId, status: 'active' },
    select: { id: true },
  });
  for (const ref of refs) {
    await tx.entityReference.update({
      where: { id: ref.id },
      data: { status: 'inactive', updatedAt: now, deletedAt: now },
    });
  }
}
