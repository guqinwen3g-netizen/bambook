import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';
import { createProductAsset, updateProductAsset, deleteProductAsset } from './productAssetMutationService';
import { resolveProductAssets, checkExclusivityForAssets, validateExclusiveCodes } from './fabricExclusivityService';
import { syncProductAssetReferences } from '../entities/sync';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { logger } from '../lib/logger';

// task ERP-P1: Decimal 输入校验（非法 cost/amount fail closed，不进 $transaction）
function isValidDecimal(v: any): boolean {
  if (v === undefined || v === null) return true; // 可选字段，未传视为合法
  // 严格校验：数字 或 合法数字字符串（正则 + isFinite）
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
    try {
      const d = new Prisma.Decimal(v);
      return d.isFinite();
    } catch {
      return false;
    }
  }
  return false;
}
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export interface ProductsRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  uploadDir: string;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createProductsRouter(opts: ProductsRouterOptions): Router {
  const router = Router();

  const fabricProfileWritableKeys = [
    'id', 'articleNo', 'millOrganizationId', 'millName', 'millQuality', 'millColorCode',
    'colorDescription', 'construction', 'yarnCount', 'pattern',
    'weightValue', 'weightUnit', 'widthValue', 'widthUnit', 'widthText',
    'productionLeadDays', 'referenceBatch', 'stockStatus',
    'stockQuantity', 'stockUnit', 'moqValue', 'factoryMoqValue',
    'sampleMoqValue', 'riskNote', 'specialNote',
  ] as const;

  const garmentProfileWritableKeys = [
    'id', 'styleNo', 'productName', 'garmentCategory', 'collection', 'customer',
    'customerRelationId', 'factoryRelationId',
    'brand', 'project', 'gender', 'ageGroup', 'tags', 'silhouette', 'fit',
    'collarType', 'sleeveType', 'closureType', 'pocketDetails', 'hemDetails',
    'waistbandDetails', 'liningStructure', 'interlining', 'shoulderPad',
    'stitchDetails', 'constructionNote', 'mainFabric', 'contrastFabric',
    'liningFabric', 'ribFabric', 'pocketingFabric', 'button', 'zipper',
    'snapsEyelets', 'thread', 'labelTrims', 'packaging', 'materialUsage',
    'substituteMaterials', 'sizeRange', 'baseSize', 'measurementPoints',
    'sizeSpec', 'tolerance', 'gradingRule', 'shrinkageAllowance',
    'garmentWeight', 'colorways', 'customerColorCodes', 'fabricColorCodes',
    'garmentSku', 'barcode', 'availableSizes', 'colorImageNotes', 'moq',
    'sampleVersion', 'patternMaker', 'merchandiser', 'owner',
    'revisionHistory', 'fittingComments', 'customerComments', 'confirmedDate',
    'techPackVersion', 'factory', 'orderQuantity', 'deliveryDate',
    'targetCost', 'fobPrice', 'exwPrice', 'retailPrice', 'inspectionStandard',
    'commonDefects', 'washFinishing', 'careLabel', 'complianceTests',
    'packingMethod', 'cartonSpec', 'countryOfOrigin', 'qualityNote',
  ] as const;

  const trimmingProfileWritableKeys = [
    'id', 'trimmingCode', 'trimmingName', 'trimmingCategory', 'material',
    'specification', 'size', 'color', 'colorCode', 'finish', 'supplier',
    'supplierRelationId',
    'factory', 'brand', 'customer', 'applicableProducts', 'usagePosition',
    'unit', 'unitConsumption', 'moq', 'leadTime', 'stockStatus',
    'stockQuantity', 'stockUnit', 'price', 'currency', 'complianceTests',
    'qualityStandard', 'riskNote', 'packaging', 'careRequirement', 'notes',
  ] as const;

  const sanitizeFabricProfileInput = (input: any = {}) => {
    const out: Record<string, any> = {};
    for (const key of fabricProfileWritableKeys) {
      if (input?.[key] !== undefined) out[key] = input[key];
    }
    return out;
  };

  const sanitizeGarmentProfileInput = (input: any = {}) => {
    const out: Record<string, any> = {};
    for (const key of garmentProfileWritableKeys) {
      if (input?.[key] !== undefined) out[key] = input[key];
    }
    return out;
  };

  const sanitizeTrimmingProfileInput = (input: any = {}) => {
    const out: Record<string, any> = {};
    for (const key of trimmingProfileWritableKeys) {
      if (input?.[key] !== undefined) out[key] = input[key];
    }
    return out;
  };

  const saveProductCollections = async (
    prisma: any,
    productAssetId: string,
    body: any,
    now: number,
    replaceExisting: boolean,
  ) => {
    const saveCollection = async (
      model: string,
      items: any[] | undefined,
      mapItem: (item: any, idx: number) => any,
    ) => {
      if (items === undefined) return;
      if (replaceExisting) {
        await prisma[model].deleteMany({ where: { productAssetId } });
      }
      if (items.length > 0) {
        await prisma[model].createMany({
          data: items.map((item, idx) => mapItem(item, idx)),
        });
      }
    };

    // P1-3 专属标记校验：isExclusive 行必须有属主锚（fail-closed 400）
    const exclusiveOwnerError = validateExclusiveCodes(body.fabricCustomerCodes ?? []);
    if (exclusiveOwnerError) {
      throw Object.assign(new Error(exclusiveOwnerError), { code: 'EXCLUSIVE_OWNER_REQUIRED', statusCode: 400 });
    }

    await saveCollection('fabricCustomerCode', body.fabricCustomerCodes, (c: any, i: number) => ({
      id: c.id || `FCC-${productAssetId}-${i}`,
      productAssetId,
      clientCode: c.clientCode ?? '',
      customerOrganizationId: c.customerOrganizationId || null,
      customerNameSnapshot: c.customerNameSnapshot || null,
      isExclusive: c.isExclusive === true,
      note: c.note || null,
      updatedAt: BigInt(now),
      deletedAt: null,
    }));

    await saveCollection('fabricCertification', body.fabricCertifications, (c: any, i: number) => ({
      id: c.id || `FCERT-${productAssetId}-${i}`,
      productAssetId,
      certification: c.certification ?? '',
      certificateNo: c.certificateNo || null,
      validUntil: c.validUntil || null,
      note: c.note || null,
      updatedAt: BigInt(now),
      deletedAt: null,
    }));

    await saveCollection('fabricPriceHistory', body.fabricPrices, (p: any, i: number) => ({
      id: p.id || `FPRICE-${productAssetId}-${i}-${now}`,
      productAssetId,
      priceType: p.priceType ?? 'factory',
      amount: new Prisma.Decimal(p.amount ?? 0),
      currency: p.currency || 'USD',
      unit: p.unit || null,
      customerOrganizationId: p.customerOrganizationId || null,
      sourceType: p.sourceType || null,
      sourceId: p.sourceId || null,
      effectiveDate: p.effectiveDate || null,
      note: p.note || null,
      updatedAt: BigInt(now),
      deletedAt: null,
    }));

    if (body.compositionLines !== undefined) {
      if (replaceExisting) {
        await prisma.fabricCompositionLine.deleteMany({ where: { productAssetId } });
      }
      for (const [i, line] of body.compositionLines.entries()) {
        const term = line.term || {};
        const termId = String(line.termId || term.id || `MCT-${productAssetId}-${i}`);
        await prisma.materialCompositionTerm.upsert({
          where: { id: termId },
          update: {
            abbreviation: term.abbreviation ?? null,
            chineseName: term.chineseName || term.englishName || term.abbreviation || termId,
            englishName: term.englishName ?? null,
            updatedAt: BigInt(now),
            deletedAt: null,
          },
          create: {
            id: termId,
            abbreviation: term.abbreviation ?? null,
            chineseName: term.chineseName || term.englishName || term.abbreviation || termId,
            englishName: term.englishName ?? null,
            updatedAt: BigInt(now),
            deletedAt: null,
          },
        });
        await prisma.fabricCompositionLine.create({
          data: {
            id: line.id || `FCL-${productAssetId}-${i}`,
            productAssetId,
            termId,
            percentage: Number(line.percentage ?? 0),
            sortOrder: i,
            updatedAt: BigInt(now),
            deletedAt: null,
          },
        });
      }
    }
  };

  // 统一认证守卫：JWT（cookie/Bearer，走 jwt.verify 验签）优先，API-Key 次之
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));

  // 写操作必须 JWT（API-Key 不可写）—— 修复原 requireWrite 仅检查 token 是否存在、不验签的漏洞
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });

  router.get('/assets', async (req, res) => {
    try {
      const mainCategory = typeof req.query.mainCategory === 'string' ? req.query.mainCategory : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 500;
      const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

      const where = {
        deletedAt: null,
        ...(mainCategory ? { mainCategory } : {}),
        ...(search
          ? {
              OR: [
                { sku: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { fabricProfile: { is: { millQuality: { contains: search, mode: 'insensitive' } } } },
                { fabricProfile: { is: { articleNo: { contains: search, mode: 'insensitive' } } } },
                { garmentProfile: { is: { styleNo: { contains: search, mode: 'insensitive' } } } },
                { garmentProfile: { is: { garmentCategory: { contains: search, mode: 'insensitive' } } } },
                { garmentProfile: { is: { customer: { contains: search, mode: 'insensitive' } } } },
                { trimmingProfile: { is: { trimmingCode: { contains: search, mode: 'insensitive' } } } },
                { trimmingProfile: { is: { trimmingName: { contains: search, mode: 'insensitive' } } } },
                { trimmingProfile: { is: { trimmingCategory: { contains: search, mode: 'insensitive' } } } },
                { trimmingProfile: { is: { supplier: { contains: search, mode: 'insensitive' } } } },
                { fabricCustomerCodes: { some: { clientCode: { contains: search, mode: 'insensitive' }, deletedAt: null } } },
              ],
            }
          : {}),
      };

      const [assets, total] = await Promise.all([
        (opts.prisma as any).productAsset.findMany({
          where,
          include: productAssetInclude(),
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        (opts.prisma as any).productAsset.count({ where }),
      ]);

      return res.json({
        ok: true,
        assets: serializeBigInts(assets),
        total,
        limit,
        offset,
        hasMore: offset + assets.length < total,
      });
    } catch (e: any) {
      logger.error('[products/list] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'LIST_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ── P1-3 客户专属面料预检（只读；前端行级警示用，写路径校验走 fabricExclusivityService） ──
  router.post('/fabric-exclusivity/check', async (req, res) => {
    try {
      const body = req.body || {};
      const fabricCode = String(body.fabricCode ?? '').trim();
      const keys: any = {
        productAssetId: body.productAssetId ?? null,
        sku: fabricCode || (body.sku ?? null),
        articleNo: fabricCode || (body.articleNo ?? null),
        millQuality: body.millQuality ?? null,
        clientCode: body.clientCode ?? (fabricCode || null),
        clientCodeCustomerHint: body.customerRelationId ?? null,
        clientCodeGlobalFallback: false, // 预检宽语义：不做全局客供品号兜底，防异义碰撞误报
      };
      const assets = await resolveProductAssets(opts.prisma, keys);
      const violations = await checkExclusivityForAssets(
        opts.prisma,
        assets.map((a: any) => a.id),
        { customerRelationId: body.customerRelationId ?? null, customerName: body.customerName ?? null },
      );
      return res.json({ ok: true, allowed: violations.length === 0, violations, matchedAssets: serializeBigInts(assets) });
    } catch (e: any) {
      logger.error('[products/fabric-exclusivity/check] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'CHECK_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/assets/query', async (req, res) => {
    try {
      const normalized = normalizeProductAssetQuery(req.body || {});
      const where = buildProductAssetQueryWhere(normalized);
      const orderBy = productAssetQueryOrderBy(normalized.sort);
      const aggregate = normalized.aggregate;

      if (aggregate === 'count') {
        const total = await (opts.prisma as any).productAsset.count({ where });
        return res.json({
          ok: true,
          dataSource: 'bambook-data-center',
          entity: 'ProductAsset',
          aggregate,
          count: total,
          filters: normalized.filters,
          sort: normalized.sort,
        });
      }

      const [assets, total] = await Promise.all([
        (opts.prisma as any).productAsset.findMany({
          where,
          include: productAssetInclude(),
          orderBy,
          take: normalized.limit,
          skip: normalized.offset,
        }),
        (opts.prisma as any).productAsset.count({ where }),
      ]);

      return res.json({
        ok: true,
        dataSource: 'bambook-data-center',
        entity: 'ProductAsset',
        aggregate,
        assets: serializeBigInts(assets),
        total,
        count: assets.length,
        limit: normalized.limit,
        offset: normalized.offset,
        hasMore: normalized.offset + assets.length < total,
        filters: normalized.filters,
        sort: normalized.sort,
      });
    } catch (e: any) {
      logger.error('[products/query] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'QUERY_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.get('/assets/:id', async (req, res) => {
    try {
      const asset = await (opts.prisma as any).productAsset.findFirst({
        where: { id: req.params.id, deletedAt: null },
        include: {
          ...productAssetInclude(),
          classificationLinks: {
            where: { deletedAt: null },
            include: { classification: true },
          },
        },
      });

      if (!asset) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product asset not found' });
      }

      // 通过 millQuality 反查关联的订单行
      let relatedOrderLines: any[] = [];
      const mq = asset.fabricProfile?.millQuality;
      if (mq && (opts.prisma as any).orderLine) {
        try {
          relatedOrderLines = await (opts.prisma as any).orderLine.findMany({
            where: {
              millQuality: mq,
              order: { deletedAt: null },
            },
            include: { order: { select: { id: true, poNumber: true, customer: true, dueDate: true, status: true } } },
            orderBy: { lineNumber: 'asc' },
            take: 50,
          });
        } catch {
          // orderLine 表可能不存在于当前测试/迁移状态
        }
      }

      return res.json({ ok: true, asset: serializeBigInts(asset), relatedOrderLines: serializeBigInts(relatedOrderLines) });
    } catch (e: any) {
      logger.error('[products/detail] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'DETAIL_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/assets', requireWrite, async (req, res) => {
    try {
      const now = Date.now();
      const body = req.body || {};
      const sku = String(body.sku || '').trim();
      const name = String(body.name || '').trim();
      const mainCategory = String(body.mainCategory || '').trim();

      if (!sku || !name || !mainCategory) {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'sku, name and mainCategory are required' });
      }
      // task ERP-P1: cost Decimal 校验（事务前 fail closed）
      if (!isValidDecimal(body.cost)) {
        return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'cost must be a valid decimal' });
      }
      // task ERP-P1: fabricPrices amount 校验（事务前 fail closed）
      if (Array.isArray(body.fabricPrices)) {
        for (const p of body.fabricPrices) {
          if (!isValidDecimal(p?.amount)) {
            return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'fabricPrices[].amount must be a valid decimal' });
          }
        }
      }

      const fabricProfileInput = sanitizeFabricProfileInput(body.fabricProfile);
      const garmentProfileInput = sanitizeGarmentProfileInput(body.garmentProfile);
      const trimmingProfileInput = sanitizeTrimmingProfileInput(body.trimmingProfile);
      const asset = await (opts.prisma as any).$transaction(async (tx: any) => {
        // task Agent-P1: 复用 createProductAsset service（route + Agent 共用，不手写 DB mutation）
        const svcResult = await createProductAsset({ prisma: opts.prisma, body, actorId: actorIdFromRequest(req), ip: req.ip, tx });
        if (!svcResult.ok) throw new Error(svcResult.error!.message);
        const created = svcResult.data!.asset;
        // route-specific: 嵌套 profile create（Agent flow 不涉及，route 专属扩展）
        if (body.fabricProfile) {
          await tx.fabricProfile.create({ data: { id: String(fabricProfileInput.id || `FAB-${now}`), productAssetId: created.id, ...fabricProfileInput, updatedAt: BigInt(now), deletedAt: null } });
        }
        if (body.garmentProfile) {
          await tx.garmentProfile.create({ data: { id: String(garmentProfileInput.id || `GAR-${now}`), productAssetId: created.id, ...garmentProfileInput, updatedAt: BigInt(now), deletedAt: null } });
        }
        if (body.trimmingProfile) {
          await tx.trimmingProfile.create({ data: { id: String(trimmingProfileInput.id || `TRIM-${now}`), productAssetId: created.id, ...trimmingProfileInput, updatedAt: BigInt(now), deletedAt: null } });
        }
        await saveProductCollections(tx, created.id, body, now, false);
        const createdAsset = await tx.productAsset.findFirst({
          where: { id: created.id, deletedAt: null },
          include: productAssetInclude(),
        });
        // 阶段 D / D2：产品↔Relation FK 入图（EntityLink），与档案写入同事务
        await syncProductAssetReferences(opts.prisma, createdAsset, { source: 'api:products' }, tx);
        return createdAsset;
      });

      opts.onDataChange?.({ entity: 'products', action: 'create', ids: [asset.id] });
      return res.status(201).json({ ok: true, asset: serializeBigInts(asset) });
    } catch (e: any) {
      logger.error('[products/create] failed', { error: e?.message || String(e) });
      // P1-3 专属属主缺失等业务校验 → 透传 statusCode（默认 500）
      return res.status(e?.statusCode ?? 500).json({ error: e?.code ?? 'CREATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ── PATCH /assets/:id — 部分更新产品及其面料档案 ──────────────
  router.patch('/assets/:id', requireWrite, async (req, res) => {
    try {
      const now = Date.now();
      const existing = await (opts.prisma as any).productAsset.findFirst({
        where: { id: req.params.id, deletedAt: null },
        include: productAssetInclude(),
      });
      if (!existing) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product asset not found' });
      }

      const body = req.body || {};
      // task ERP-P1: cost Decimal 校验（事务前 fail closed）
      if (!isValidDecimal(body.cost)) {
        return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'cost must be a valid decimal' });
      }
      // task ERP-P1: fabricPrices amount 校验（事务前 fail closed）
      if (Array.isArray(body.fabricPrices)) {
        for (const p of body.fabricPrices) {
          if (!isValidDecimal(p?.amount)) {
            return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'fabricPrices[].amount must be a valid decimal' });
          }
        }
      }

      // task ERP-P1: PATCH 全部包 $transaction（业务写入 + 嵌套集合 + AuditLog 同事务，fail closed）
      const refreshed = await (opts.prisma as any).$transaction(async (tx: any) => {
        // ── FabricProfile ─────────────────────────────────────────
        if (body.fabricProfile && existing.fabricProfile) {
          const fp: Record<string, any> = { updatedAt: BigInt(now) };
          const fpKeys = [
            'articleNo', 'millOrganizationId', 'millName', 'millQuality', 'millColorCode',
            'colorDescription', 'construction', 'yarnCount', 'pattern',
            'weightValue', 'weightUnit', 'widthValue', 'widthUnit', 'widthText',
            'productionLeadDays', 'referenceBatch', 'stockStatus',
            'stockQuantity', 'stockUnit', 'moqValue', 'factoryMoqValue',
            'sampleMoqValue', 'riskNote', 'specialNote',
          ] as const;
          for (const key of fpKeys) {
            if (body.fabricProfile[key] !== undefined) fp[key] = body.fabricProfile[key];
          }
          await tx.fabricProfile.update({
            where: { productAssetId: existing.id },
            data: fp,
          });
        } else if (body.fabricProfile && !existing.fabricProfile) {
          const fabricProfileInput = sanitizeFabricProfileInput(body.fabricProfile);
          await tx.fabricProfile.create({
            data: {
              id: fabricProfileInput.id || `FAB-${now}`,
              productAssetId: existing.id,
              ...fabricProfileInput,
              updatedAt: BigInt(now),
              deletedAt: null,
            },
          });
        }

        // ── GarmentProfile ────────────────────────────────────────
        if (body.garmentProfile && existing.garmentProfile) {
          const gp: Record<string, any> = { updatedAt: BigInt(now) };
          const garmentProfileInput = sanitizeGarmentProfileInput(body.garmentProfile);
          for (const key of garmentProfileWritableKeys) {
            if (key !== 'id' && garmentProfileInput[key] !== undefined) gp[key] = garmentProfileInput[key];
          }
          await tx.garmentProfile.update({
            where: { productAssetId: existing.id },
            data: gp,
          });
        } else if (body.garmentProfile && !existing.garmentProfile) {
          const garmentProfileInput = sanitizeGarmentProfileInput(body.garmentProfile);
          await tx.garmentProfile.create({
            data: {
              id: garmentProfileInput.id || `GAR-${now}`,
              productAssetId: existing.id,
              ...garmentProfileInput,
              updatedAt: BigInt(now),
              deletedAt: null,
            },
          });
        }

        // ── TrimmingProfile ───────────────────────────────────────
        if (body.trimmingProfile && existing.trimmingProfile) {
          const tp: Record<string, any> = { updatedAt: BigInt(now) };
          const trimmingProfileInput = sanitizeTrimmingProfileInput(body.trimmingProfile);
          for (const key of trimmingProfileWritableKeys) {
            if (key !== 'id' && trimmingProfileInput[key] !== undefined) tp[key] = trimmingProfileInput[key];
          }
          await tx.trimmingProfile.update({
            where: { productAssetId: existing.id },
            data: tp,
          });
        } else if (body.trimmingProfile && !existing.trimmingProfile) {
          const trimmingProfileInput = sanitizeTrimmingProfileInput(body.trimmingProfile);
          await tx.trimmingProfile.create({
            data: {
              id: trimmingProfileInput.id || `TRIM-${now}`,
              productAssetId: existing.id,
              ...trimmingProfileInput,
              updatedAt: BigInt(now),
              deletedAt: null,
            },
          });
        }

        // ── 嵌套集合：先删旧的，再插新的（全量替换策略）─────────
        await saveProductCollections(tx, existing.id, body, now, true);

        // ── 主表最后更新 ──────────────────────────────────────────
        // task Agent-P1: 复用 updateProductAsset service（route + Agent 共用）
        const patchFields: Record<string, unknown> = {};
        for (const key of ['sku', 'name', 'mainCategory', 'subCategoryId', 'season', 'techPackUrl', 'imageUrl', 'status'] as const) {
          if (body[key] !== undefined) patchFields[key] = body[key];
        }
        if (body.cost !== undefined) patchFields.cost = body.cost;
        const svcResult = await updateProductAsset({ prisma: opts.prisma, assetId: existing.id, patch: patchFields, actorId: actorIdFromRequest(req), ip: req.ip, tx });
        if (!svcResult.ok) throw new Error(svcResult.error!.message);

        // 回传更新后的完整记录
        const refreshedAsset = await tx.productAsset.findFirst({
          where: { id: existing.id, deletedAt: null },
          include: productAssetInclude(),
        });
        // 阶段 D / D2：产品↔Relation FK 入图（EntityLink），与档案写入同事务
        await syncProductAssetReferences(opts.prisma, refreshedAsset, { source: 'api:products' }, tx);
        return refreshedAsset;
      });

      opts.onDataChange?.({ entity: 'products', action: 'update', ids: [existing.id] });
      return res.json({ ok: true, asset: serializeBigInts(refreshed) });
    } catch (e: any) {
      logger.error('[products/update] failed', { error: e?.message || String(e) });
      // P1-3 专属属主缺失等业务校验 → 透传 statusCode（默认 500）
      return res.status(e?.statusCode ?? 500).json({ error: e?.code ?? 'UPDATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ── DELETE /assets/:id — 软删除产品 ─────────────────────────
  router.delete('/assets/:id', requireWrite, async (req, res) => {
    try {
      const now = BigInt(Date.now());
      const existing = await (opts.prisma as any).productAsset.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!existing) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product asset not found' });
      }

      // task ERP-P1: DELETE 包 $transaction（软删主表 + Profile + 嵌套集合 + AuditLog 同事务，fail closed）
      await (opts.prisma as any).$transaction(async (tx: any) => {
        // task Agent-P1: 复用 deleteProductAsset service（route + Agent 共用主表软删 + AuditLog）
        const svcResult = await deleteProductAsset({ prisma: opts.prisma, assetId: existing.id, actorId: actorIdFromRequest(req), ip: req.ip, tx });
        if (!svcResult.ok) throw new Error(svcResult.error!.message);

        // 读 existing 的 include（findFirst 没带 include，需单独查 fabricProfile 是否存在）
        const withProfile = await tx.productAsset.findFirst({ where: { id: existing.id }, include: { fabricProfile: true } });
        if (withProfile?.fabricProfile) {
          await tx.fabricProfile.updateMany({
            where: { productAssetId: existing.id },
            data: { deletedAt: now, updatedAt: now },
          });
        }
        await tx.garmentProfile.updateMany({
          where: { productAssetId: existing.id },
          data: { deletedAt: now, updatedAt: now },
        });
        await tx.trimmingProfile.updateMany({
          where: { productAssetId: existing.id },
          data: { deletedAt: now, updatedAt: now },
        });

        for (const model of ['fabricCustomerCode', 'fabricPriceHistory', 'fabricCertification', 'fabricCompositionLine']) {
          await tx[model].updateMany({
            where: { productAssetId: existing.id },
            data: { deletedAt: now, updatedAt: now },
          });
        }
      });

      opts.onDataChange?.({ entity: 'products', action: 'delete', ids: [existing.id] });
      return res.json({ ok: true, deleted: existing.id });
    } catch (e: any) {
      logger.error('[products/delete] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'DELETE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ── Image upload/delete/reorder/primary ────────────────────────

  const imageUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, file, cb) => {
        const dir = path.join(opts.uploadDir, 'products', _req.params.id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error('Only image files (jpeg, png, webp, gif) are allowed'));
    },
  });

  // POST /assets/:id/images — upload one or more images
  router.post('/assets/:id/images', requireWrite, imageUpload.array('files', 10), async (req, res) => {
    try {
      const productId = req.params.id;
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'NO_FILES', message: 'No image files provided' });
      }

      const existing = await (opts.prisma as any).productAsset.findFirst({
        where: { id: productId, deletedAt: null },
      });
      if (!existing) {
        // Clean up uploaded files
        for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* best-effort cleanup */ } }
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product asset not found' });
      }

      const now = Date.now();
      let created: any[] = [];
      try {
        created = await (opts.prisma as any).$transaction(async (tx: any) => {
          // Count existing images for sortOrder
          const existingCount = await tx.productImage.count({
            where: { productAssetId: productId, deletedAt: null },
          });

          const imgs: any[] = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const filePath = path.join('products', productId, f.filename);
            const isPrimary = existingCount === 0 && i === 0;
            const img = await tx.productImage.create({
              data: {
                id: `IMG-${productId}-${now}-${i}`,
                productAssetId: productId,
                filePath,
                fileName: f.originalname,
                mimeType: f.mimetype,
                fileSize: f.size,
                sortOrder: existingCount + i,
                isPrimary,
                uploadedAt: BigInt(now),
              },
            });
            imgs.push(img);
          }

          // Update imageUrl on ProductAsset to the primary image
          const primary = imgs.find((img: any) => img.isPrimary);
          if (primary) {
            await tx.productAsset.update({
              where: { id: productId },
              data: { imageUrl: `/api/uploads/${primary.filePath}` },
            });
          }

          // task ERP-P1: AuditLog 同事务闭环（fail closed）
          await writeRouteAuditLog({
            prisma: tx, actorId: actorIdFromRequest(req), source: 'route:product-image:upload',
            operation: 'upload_product_images', targetType: 'ProductImage', targetId: productId,
            after: { productAssetId: productId, uploadedCount: imgs.length, imageIds: imgs.map((im: any) => im.id) },
            ip: req.ip,
          });

          return imgs;
        });
      } catch (txErr: any) {
        // task ERP-P1: DB/audit 失败 → best-effort 清理本次上传文件，不留下 ProductImage DB 行
        for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
        logger.error('[products/upload-image] tx failed', { error: txErr?.message || String(txErr) });
        return res.status(500).json({ error: 'UPLOAD_FAILED', message: String(txErr?.message ?? txErr) });
      }

      opts.onDataChange?.({ entity: 'products', action: 'update', ids: [productId] });
      return res.status(201).json({ ok: true, images: serializeBigInts(created) });
    } catch (e: any) {
      // 外层 catch：multer 已落盘但 productId 校验等失败，清理文件
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
      logger.error('[products/upload-image] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'UPLOAD_FAILED', message: String(e?.message ?? e) });
    }
  });

  // DELETE /assets/:id/images/:imageId — soft-delete an image
  router.delete('/assets/:id/images/:imageId', requireWrite, async (req, res) => {
    try {
      const { id: productId, imageId } = req.params;
      const img = await (opts.prisma as any).productImage.findFirst({
        where: { id: imageId, productAssetId: productId, deletedAt: null },
      });
      if (!img) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Image not found' });
      }

      const now = BigInt(Date.now());
      // task ERP-P1: 包 $transaction（soft-delete + primary promotion + imageUrl + AuditLog 同事务，fail closed）
      await (opts.prisma as any).$transaction(async (tx: any) => {
        await tx.productImage.update({
          where: { id: imageId },
          data: { deletedAt: now },
        });

        // If deleted image was primary, promote the next one
        if (img.isPrimary) {
          const nextPrimary = await tx.productImage.findFirst({
            where: { productAssetId: productId, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          });
          if (nextPrimary) {
            await tx.productImage.update({
              where: { id: nextPrimary.id },
              data: { isPrimary: true },
            });
            await tx.productAsset.update({
              where: { id: productId },
              data: { imageUrl: `/api/uploads/${nextPrimary.filePath}` },
            });
          } else {
            await tx.productAsset.update({
              where: { id: productId },
              data: { imageUrl: null },
            });
          }
        }

        // AuditLog 同事务闭环（fail closed）
        await writeRouteAuditLog({
          prisma: tx, actorId: actorIdFromRequest(req), source: 'route:product-image:delete',
          operation: 'delete_product_image', targetType: 'ProductImage', targetId: imageId,
          before: { id: imageId, productAssetId: productId, isPrimary: img.isPrimary },
          after: { id: imageId, deletedAt: Number(now) },
          ip: req.ip,
        });
      });

      // task ERP-P1: 文件删除保持 DB 事务成功后 best-effort（不把文件系统失败伪装成 DB 回滚）
      const fullPath = path.join(opts.uploadDir, img.filePath);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch { /* ignore - best effort */ }
      }

      opts.onDataChange?.({ entity: 'products', action: 'update', ids: [productId] });
      return res.json({ ok: true, deleted: imageId });
    } catch (e: any) {
      logger.error('[products/delete-image] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'DELETE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // PATCH /assets/:id/images/:imageId/primary — set as primary image
  router.patch('/assets/:id/images/:imageId/primary', requireWrite, async (req, res) => {
    try {
      const { id: productId, imageId } = req.params;
      const img = await (opts.prisma as any).productImage.findFirst({
        where: { id: imageId, productAssetId: productId, deletedAt: null },
      });
      if (!img) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Image not found' });
      }

      // task ERP-P1: 包 $transaction（unset old primary + set new + imageUrl + AuditLog 同事务）
      await (opts.prisma as any).$transaction(async (tx: any) => {
        // Unset all other primary images for this product
        await tx.productImage.updateMany({
          where: { productAssetId: productId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });

        // Set this one as primary
        await tx.productImage.update({
          where: { id: imageId },
          data: { isPrimary: true },
        });

        // Update imageUrl on ProductAsset
        await tx.productAsset.update({
          where: { id: productId },
          data: { imageUrl: `/api/uploads/${img.filePath}` },
        });

        // AuditLog 同事务闭环（fail closed）
        await writeRouteAuditLog({
          prisma: tx, actorId: actorIdFromRequest(req), source: 'route:product-image:set-primary',
          operation: 'set_primary_product_image', targetType: 'ProductImage', targetId: imageId,
          before: { id: imageId, isPrimary: img.isPrimary },
          after: { id: imageId, isPrimary: true, productAssetId: productId },
          ip: req.ip,
        });
      });

      opts.onDataChange?.({ entity: 'products', action: 'update', ids: [productId] });
      return res.json({ ok: true });
    } catch (e: any) {
      logger.error('[products/set-primary] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'UPDATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // PATCH /assets/:id/images/reorder — batch update sortOrder
  router.patch('/assets/:id/images/reorder', requireWrite, async (req, res) => {
    try {
      const productId = req.params.id;
      const { orders }: { orders: Array<{ id: string; sortOrder: number }> } = req.body;
      if (!Array.isArray(orders)) {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'orders array required' });
      }

      // task ERP-P1: 包 $transaction（批量 reorder + AuditLog 同事务）
      await (opts.prisma as any).$transaction(async (tx: any) => {
        for (const item of orders) {
          await tx.productImage.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder },
          });
        }

        // AuditLog 同事务闭环（fail closed）
        await writeRouteAuditLog({
          prisma: tx, actorId: actorIdFromRequest(req), source: 'route:product-image:reorder',
          operation: 'reorder_product_images', targetType: 'ProductImage', targetId: productId,
          after: { productAssetId: productId, orders },
          ip: req.ip,
        });
      });

      opts.onDataChange?.({ entity: 'products', action: 'update', ids: [productId] });
      return res.json({ ok: true });
    } catch (e: any) {
      logger.error('[products/reorder-images] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'UPDATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  return router;
}

function productAssetInclude() {
  return {
    fabricProfile: true,
    garmentProfile: true,
    trimmingProfile: true,
    fabricCustomerCodes: { where: { deletedAt: null } },
    fabricPrices: { where: { deletedAt: null }, orderBy: { updatedAt: 'desc' } },
    fabricCertifications: { where: { deletedAt: null } },
    compositionLines: {
      where: { deletedAt: null },
      include: { term: true },
      orderBy: { sortOrder: 'asc' },
    },
    images: {
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    },
  };
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  // Prisma Decimal 是带 s/e/d 的 object，直接 JSON 化会变成 {s,e,d} 结构——
  // 前端 String(percentage) 会得到 "[object Object]"（成分合计 NaN → 保存按钮禁用）。
  // 统一转 number（与 finance 序列化口径一致）。
  if (value instanceof Prisma.Decimal) return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serializeBigInts(item);
    }
    return out as T;
  }
  return value;
}

function normalizeProductAssetQuery(input: any) {
  const filters = input && typeof input.filters === 'object' ? input.filters : {};
  const sort = input && typeof input.sort === 'object' ? input.sort : {};
  return {
    entity: cleanText(input.entity) || 'ProductAsset',
    aggregate: cleanText(input.aggregate) === 'count' ? 'count' : 'list',
    query: cleanText(input.query),
    mainCategory: cleanText(input.mainCategory),
    filters: {
      certifications: arrayOfText(filters.certifications),
      stockStatus: cleanText(filters.stockStatus),
      supplier: cleanText(filters.supplier),
      color: cleanText(filters.color),
      compositionTerms: arrayOfText(filters.compositionTerms),
      weightMin: finiteNumber(filters.weightMin),
      weightMax: finiteNumber(filters.weightMax),
      fieldFilters: normalizeProductFieldFilters(filters.fieldFilters),
    },
    sort: {
      field: cleanText(sort.field) || 'updatedAt',
      direction: cleanText(sort.direction).toLowerCase() === 'asc' ? 'asc' : 'desc',
    },
    limit: numberInput(input.limit, 20, 1, 500),
    offset: numberInput(input.offset, 0, 0, 1_000_000),
  };
}

function buildProductAssetQueryWhere(input: ReturnType<typeof normalizeProductAssetQuery>) {
  if (input.entity !== 'ProductAsset') {
    return { AND: [{ deletedAt: null }, { id: '__unsupported_entity__' }] };
  }
  const and: any[] = [{ deletedAt: null }];
  if (input.mainCategory) {
    and.push({ mainCategory: { contains: input.mainCategory, mode: 'insensitive' } });
  }
  if (input.query) {
    const textContains = { contains: input.query, mode: 'insensitive' };
    and.push({
      OR: [
        { id: input.query },
        { sku: textContains },
        { name: textContains },
        { mainCategory: textContains },
        { subCategoryId: textContains },
        { fabricProfile: { is: { articleNo: textContains } } },
        { fabricProfile: { is: { millQuality: textContains } } },
        { fabricProfile: { is: { millColorCode: textContains } } },
        { fabricProfile: { is: { colorDescription: textContains } } },
        { garmentProfile: { is: { styleNo: textContains } } },
        { garmentProfile: { is: { productName: textContains } } },
        { trimmingProfile: { is: { trimmingCode: textContains } } },
        { trimmingProfile: { is: { trimmingName: textContains } } },
        { fabricCustomerCodes: { some: { deletedAt: null, clientCode: textContains } } },
        { fabricCertifications: { some: { deletedAt: null, certification: textContains } } },
      ],
    });
  }
  for (const certification of input.filters.certifications) {
    and.push({ fabricCertifications: { some: { deletedAt: null, certification: { contains: certification, mode: 'insensitive' } } } });
  }
  if (input.filters.stockStatus) {
    and.push({
      OR: [
        { status: { contains: input.filters.stockStatus, mode: 'insensitive' } },
        { fabricProfile: { is: { stockStatus: { contains: input.filters.stockStatus, mode: 'insensitive' } } } },
        { trimmingProfile: { is: { stockStatus: { contains: input.filters.stockStatus, mode: 'insensitive' } } } },
      ],
    });
  }
  if (input.filters.supplier) {
    and.push({
      OR: [
        { fabricProfile: { is: { millOrganizationId: { contains: input.filters.supplier, mode: 'insensitive' } } } },
        { trimmingProfile: { is: { supplier: { contains: input.filters.supplier, mode: 'insensitive' } } } },
        { trimmingProfile: { is: { factory: { contains: input.filters.supplier, mode: 'insensitive' } } } },
      ],
    });
  }
  if (input.filters.color) {
    and.push({
      OR: [
        { fabricProfile: { is: { millColorCode: { contains: input.filters.color, mode: 'insensitive' } } } },
        { fabricProfile: { is: { colorDescription: { contains: input.filters.color, mode: 'insensitive' } } } },
        { trimmingProfile: { is: { color: { contains: input.filters.color, mode: 'insensitive' } } } },
        { trimmingProfile: { is: { colorCode: { contains: input.filters.color, mode: 'insensitive' } } } },
      ],
    });
  }
  for (const term of input.filters.compositionTerms) {
    and.push({
      compositionLines: {
        some: {
          deletedAt: null,
          term: {
            is: {
              OR: [
                { abbreviation: { contains: term, mode: 'insensitive' } },
                { chineseName: { contains: term, mode: 'insensitive' } },
                { englishName: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
        },
      },
    });
  }
  const weightWhere: any = {};
  if (input.filters.weightMin != null) weightWhere.gte = input.filters.weightMin;
  if (input.filters.weightMax != null) weightWhere.lte = input.filters.weightMax;
  if (Object.keys(weightWhere).length) {
    and.push({ fabricProfile: { is: { weightValue: weightWhere } } });
  }
  for (const filter of input.filters.fieldFilters) {
    const where = productAssetFieldFilterWhere(filter);
    if (where) and.push(where);
  }
  return and.length === 1 ? and[0] : { AND: and };
}

function productAssetQueryOrderBy(sort: { field: string; direction: string }) {
  const direction = sort.direction === 'asc' ? 'asc' : 'desc';
  if (sort.field === 'sku') return { sku: direction };
  if (sort.field === 'name') return { name: direction };
  if (sort.field === 'status') return { status: direction };
  return { updatedAt: direction };
}

function productAssetFieldFilterWhere(filter: { path: string; operator: string; value: unknown }) {
  const textValue = cleanText(filter.value);
  const numericValue = finiteNumber(filter.value);
  const textScalar = filter.operator === 'equals'
    ? { equals: textValue, mode: 'insensitive' }
    : { contains: textValue, mode: 'insensitive' };
  const numberScalar = filter.operator === 'gte'
    ? { gte: numericValue }
    : filter.operator === 'lte'
      ? { lte: numericValue }
      : numericValue;

  switch (filter.path) {
    case 'sku':
    case 'name':
    case 'mainCategory':
    case 'subCategoryId':
    case 'season':
    case 'status':
      return textValue ? { [filter.path]: textScalar } : null;
    case 'updatedAt':
      return numericValue == null ? null : { updatedAt: numberScalar };
    case 'fabric.articleNo':
      return textValue ? { fabricProfile: { is: { articleNo: textScalar } } } : null;
    case 'fabric.millQuality':
      return textValue ? { fabricProfile: { is: { millQuality: textScalar } } } : null;
    case 'fabric.millOrganizationId':
      return textValue ? { fabricProfile: { is: { millOrganizationId: textScalar } } } : null;
    case 'fabric.millColorCode':
      return textValue ? { fabricProfile: { is: { millColorCode: textScalar } } } : null;
    case 'fabric.colorDescription':
      return textValue ? { fabricProfile: { is: { colorDescription: textScalar } } } : null;
    case 'fabric.weightValue':
      return numericValue == null ? null : { fabricProfile: { is: { weightValue: numberScalar } } };
    case 'fabric.stockStatus':
      return textValue ? { fabricProfile: { is: { stockStatus: textScalar } } } : null;
    case 'fabric.certification':
      return textValue ? { fabricCertifications: { some: { deletedAt: null, certification: textScalar } } } : null;
    case 'fabric.customerCode':
      return textValue ? { fabricCustomerCodes: { some: { deletedAt: null, OR: [{ clientCode: textScalar }, { customerNameSnapshot: textScalar }] } } } : null;
    case 'fabric.compositionTerm':
      return textValue ? { compositionLines: { some: { deletedAt: null, term: { is: { OR: [{ abbreviation: textScalar }, { chineseName: textScalar }, { englishName: textScalar }] } } } } } : null;
    case 'fabric.compositionPercentage':
      return numericValue == null ? null : { compositionLines: { some: { deletedAt: null, percentage: numberScalar } } };
    case 'garment.styleNo':
      return textValue ? { garmentProfile: { is: { styleNo: textScalar } } } : null;
    case 'garment.customer':
      return textValue ? { garmentProfile: { is: { customer: textScalar } } } : null;
    case 'trimming.trimmingCode':
      return textValue ? { trimmingProfile: { is: { trimmingCode: textScalar } } } : null;
    case 'trimming.supplier':
      return textValue ? { trimmingProfile: { is: { supplier: textScalar } } } : null;
    default:
      return null;
  }
}

function normalizeProductFieldFilters(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item: any) => ({
    path: cleanText(item?.path),
    operator: normalizeProductOperator(item?.operator),
    value: item?.value,
  })).filter(item => item.path && item.value !== undefined && item.value !== null && item.value !== '').slice(0, 16);
}

function normalizeProductOperator(value: unknown) {
  const operator = cleanText(value).toLowerCase();
  if (operator === 'equals' || operator === 'gte' || operator === 'lte') return operator;
  return 'contains';
}

function arrayOfText(value: unknown) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean).slice(0, 20) : [];
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function finiteNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function numberInput(value: unknown, fallback: number, min: number, max: number) {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, min), max);
}
