/**
 * Agent-P1: ProductAsset mutation service（route + Agent flow 共用契约）。
 * 每个 mutation 内部 $transaction + AuditLog 同事务闭环，fail closed。
 * 支持 optional tx 参数：route 传 tx 共用同事务，Agent 不传则 service 自开 $transaction。
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';

export type ProductAssetMutationErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_AMOUNT'
  | 'NOT_FOUND'
  | 'ALREADY_DELETED'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED';

function isValidDecimal(v: any): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
    try { return new Prisma.Decimal(v).isFinite(); } catch { return false; }
  }
  return false;
}

export interface ProductAssetMutationResult {
  ok: boolean;
  data?: { asset?: any; auditId: string };
  error?: { code: ProductAssetMutationErrorCode; message: string };
}

// ─── CREATE ────────────────────────────────────────────────────────
export async function createProductAsset(
  params: { prisma: PrismaClient; body: any; actorId: string; ip?: string; tx?: any },
): Promise<ProductAssetMutationResult> {
  const { prisma, body, actorId, ip } = params;
  const tx = params.tx;
  const now = Date.now();
  const sku = String(body.sku || '').trim();
  const name = String(body.name || '').trim();
  const mainCategory = String(body.mainCategory || '').trim();
  if (!sku || !name || !mainCategory) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'sku, name, mainCategory required' } };
  }
  if (!isValidDecimal(body.cost)) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'cost must be valid decimal' } };
  }
  const doCreate = async (cn: any) => {
    const created = await cn.productAsset.create({
      data: {
        id: String(body.id || `PROD-${now}`),
        sku, name, mainCategory,
        subCategoryId: body.subCategoryId || 'uncategorized',
        season: body.season || '',
        cost: new Prisma.Decimal(body.cost ?? 0),
        status: body.status || 'Development',
        techPackUrl: body.techPackUrl || null,
        imageUrl: body.imageUrl || null,
        updatedAt: BigInt(now),
        deletedAt: null,
      },
    });
    const auditId = await writeRouteAuditLog({
      prisma: cn, actorId, source: 'mutation-service:create_product_asset',
      operation: 'create_product_asset', targetType: 'ProductAsset', targetId: created.id,
      after: { id: created.id, sku, name, mainCategory },
      ip: ip || null,
    });
    return { asset: created, auditId };
  };
  try {
    const asset = tx ? await doCreate(tx) : await (prisma as any).$transaction(doCreate);
    return { ok: true, data: asset };
  } catch (e: any) {
    return { ok: false, error: { code: 'CREATE_FAILED', message: String(e?.message ?? e) } };
  }
}

// ─── UPDATE ────────────────────────────────────────────────────────
export async function updateProductAsset(
  params: { prisma: PrismaClient; assetId: string; patch: Record<string, unknown>; actorId: string; ip?: string; tx?: any },
): Promise<ProductAssetMutationResult> {
  const { prisma, assetId, patch, actorId, ip } = params;
  const tx = params.tx;
  const existing = await (prisma as any).productAsset.findFirst({ where: { id: assetId, deletedAt: null } }).catch(() => null);
  if (!existing) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `product asset ${assetId} not found or deleted` } };
  }
  if (!isValidDecimal(patch.cost)) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'cost must be valid decimal' } };
  }
  const now = Date.now();
  const doUpdate = async (cn: any) => {
    const data: Record<string, unknown> = { updatedAt: BigInt(now) };
    for (const k of ['sku', 'name', 'mainCategory', 'subCategoryId', 'season', 'status', 'techPackUrl', 'imageUrl']) {
      if (patch[k] !== undefined) data[k] = patch[k];
    }
    if (patch.cost !== undefined) data.cost = new Prisma.Decimal(patch.cost as any);
    const updated = await cn.productAsset.update({ where: { id: assetId }, data });
    const auditId = await writeRouteAuditLog({
      prisma: cn, actorId, source: 'mutation-service:update_product_asset',
      operation: 'update_product_asset', targetType: 'ProductAsset', targetId: assetId,
      before: { id: assetId, sku: existing.sku, name: existing.name },
      after: { id: assetId, ...data },
      ip: ip || null,
    });
    return { asset: updated, auditId };
  };
  try {
    const result = tx ? await doUpdate(tx) : await (prisma as any).$transaction(doUpdate);
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: { code: 'UPDATE_FAILED', message: String(e?.message ?? e) } };
  }
}

// ─── DELETE (soft) ─────────────────────────────────────────────────
export async function deleteProductAsset(
  params: { prisma: PrismaClient; assetId: string; actorId: string; ip?: string; tx?: any },
): Promise<ProductAssetMutationResult> {
  const { prisma, assetId, actorId, ip } = params;
  const tx = params.tx;
  const existing = await (prisma as any).productAsset.findFirst({ where: { id: assetId, deletedAt: null } }).catch(() => null);
  if (!existing) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `product asset ${assetId} not found or already deleted` } };
  }
  const now = BigInt(Date.now());
  const doDelete = async (cn: any) => {
    await cn.productAsset.update({ where: { id: assetId }, data: { deletedAt: now, updatedAt: now } });
    const auditId = await writeRouteAuditLog({
      prisma: cn, actorId, source: 'mutation-service:delete_product_asset',
      operation: 'delete_product_asset', targetType: 'ProductAsset', targetId: assetId,
      before: { id: assetId, deletedAt: null },
      after: { id: assetId, deletedAt: Number(now) },
      ip: ip || null,
    });
    return { asset: { id: assetId }, auditId };
  };
  try {
    const result = tx ? await doDelete(tx) : await (prisma as any).$transaction(doDelete);
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: { code: 'DELETE_FAILED', message: String(e?.message ?? e) } };
  }
}
