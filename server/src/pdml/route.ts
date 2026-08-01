import { Router, Request, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { fetchPdmlRawRows, PdmlFetchResult } from './source';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';

export interface PdmlRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  fetchRows?: (opts: { gsid?: string; limit?: number; pageSize?: number }) => Promise<PdmlFetchResult>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export interface PdmlRawSyncOptions {
  prisma: PrismaClient;
  gsid?: string;
  limit?: number;
  pageSize?: number;
  fetchRows?: (opts: { gsid?: string; limit?: number; pageSize?: number }) => Promise<PdmlFetchResult>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

type PdmlSyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface PdmlSyncJobState {
  ok: true;
  jobId: string;
  status: PdmlSyncJobStatus;
  gsid: string;
  startedAt?: number;
  finishedAt?: number;
  result?: Awaited<ReturnType<typeof syncPdmlRawFabricCache>>;
  error?: string;
}

const pdmlSyncJobs = new Map<string, PdmlSyncJobState>();
const PDML_SYNC_JOB_TTL_MS = 30 * 60 * 1000;

const clean = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const stableStringify = (value: any): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sourceHash = (row: Record<string, any>) => createHash('sha256').update(stableStringify(row)).digest('hex');

const rawFabricId = (gsid: string, sourceId: string) => `PDML-${gsid}-${sourceId}`;

const rowToRawFabric = (row: Record<string, any>, gsid: string, now: bigint, existing?: any) => {
  const sourceId = clean(row.ID);
  if (!sourceId) return null;

  return {
    id: rawFabricId(gsid, sourceId),
    gsid,
    sourceId,
    rawData: row,
    sourceHash: sourceHash(row),
    articleNo: clean(row.GSPH),
    factoryArticleNo: clean(row.GCPH),
    colorCode: clean(row.GSSH),
    factoryColorCode: clean(row.GCSH),
    supplierName: clean(row.GYS),
    productLine: clean(row.CPXL),
    registeredDate: clean(row.DJRQ),
    imageUrl: clean(row.TPDZ),
    sourceStatus: clean(row.ZT),
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    syncedAt: now,
    deletedAt: null,
  };
};

const serializeRawFabric = (row: any) => ({
  ...row,
  firstSeenAt: Number(row.firstSeenAt),
  lastSeenAt: Number(row.lastSeenAt),
  syncedAt: Number(row.syncedAt),
  deletedAt: row.deletedAt == null ? null : Number(row.deletedAt),
});

const safeKey = (value: unknown, fallback = 'UNKNOWN') => {
  const text = clean(value) || fallback;
  const ascii = text
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  if (ascii && ascii !== '-') return ascii.slice(0, 48);
  return createHash('sha1').update(text).digest('hex').slice(0, 12).toUpperCase();
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
};

const strictNumber = (value: unknown) => {
  const text = clean(value)?.replace(/,/g, '');
  if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

const strictInteger = (value: unknown) => {
  const number = strictNumber(value);
  return number == null ? null : Math.trunc(number);
};

const pdmlProductId = (sourceId: string) => `PDML-FAB-${sourceId}`;
const pdmlProfileId = (sourceId: string) => `PDML-FP-${sourceId}`;
const pdmlCategoryId = (productLine: string) => `PDML-FAB-CAT-${safeKey(productLine)}`;
const pdmlTermId = (abbr: string) => `MCT-PDML-${safeKey(abbr)}`;

const statusFromPdml = (status: unknown) => (clean(status) === '通过' ? 'Active' : 'Development');

const pdmlDetailNote = (row: Record<string, any>) => {
  const notePairs: Array<[string, string]> = [
    ['PDML原始ID', 'ID'],
    ['公司色号', 'GSSH'],
    ['工厂色号', 'GCSH'],
    ['公司批号', 'PCH'],
    ['工厂批号', 'GCPCH'],
    ['门幅原值', 'FK'],
    ['门幅单位', 'FKDW'],
    ['起订量', 'QDL'],
    ['工厂起订量', 'GCQDL'],
    ['试样起订量', 'SYQDL'],
    ['样品数量', 'YPSL'],
    ['预计数量', 'YJSL'],
    ['库存数量原值', 'KCSL'],
    ['价格有效期', 'JGYXQ'],
    ['付款条件', 'GCFKTJ'],
    ['登记人', 'ZDR'],
    ['源状态', 'ZT'],
    ['原备注', 'NOTE'],
  ];
  return notePairs
    .map(([label, key]) => {
      const value = clean(row[key]);
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean)
    .join('\n') || null;
};

const parseCompositionLines = (row: Record<string, any>, productAssetId: string, now: number) => {
  const raw = clean(row.CF);
  if (!raw) return [];
  return raw
    .split(/[+/，,]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map((part, idx) => {
      const match = part.match(/^([A-Za-z]+)\s*([0-9]+(?:\.[0-9]+)?)/);
      const abbreviation = match?.[1] || part;
      const percentage = match ? Number(match[2]) : 0;
      const termId = pdmlTermId(abbreviation);
      return {
        term: {
          id: termId,
          abbreviation,
          chineseName: abbreviation,
          englishName: null,
        },
        line: {
          id: `FCL-${productAssetId}-PDML-${idx}`,
          productAssetId,
          termId,
          percentage: Number.isFinite(percentage) ? percentage : 0,
          sortOrder: idx,
          updatedAt: BigInt(now),
          deletedAt: null,
        },
      };
    });
};

const pdmlPrices = (row: Record<string, any>, productAssetId: string, sourceId: string, now: number) => {
  const currency = firstText(row.GCBZ, row.RMB ? 'RMB' : null, row.USD ? 'USD' : null) || 'RMB';
  const entries = [
    { key: 'GCCGDJ', priceType: 'factory', currency },
    { key: 'RMB', priceType: 'customer', currency: 'RMB' },
    { key: 'USD', priceType: 'customer', currency: 'USD' },
    { key: 'SYCGDJ', priceType: 'sample', currency },
  ];
  return entries
    .map(entry => {
      const amount = strictNumber(row[entry.key]);
      if (amount == null) return null;
      return {
        id: `PDML-PRICE-${sourceId}-${entry.priceType}-${entry.key}`,
        productAssetId,
        priceType: entry.priceType,
        amount,
        currency: entry.currency,
        unit: clean(row.KZDW) || null,
        customerOrganizationId: null,
        sourceType: 'pdml',
        sourceId,
        effectiveDate: clean(row.JGYXQ),
        note: `${entry.key} from PDML`,
        updatedAt: BigInt(now),
        deletedAt: null,
      };
    })
    .filter(Boolean);
};

const mapPdmlRowToProduct = (row: Record<string, any>, now: number) => {
  const sourceId = clean(row.ID);
  if (!sourceId) return null;
  const productAssetId = pdmlProductId(sourceId);
  const productLine = firstText(row.CPXL, '庞大未分类')!;
  const articleNo = firstText(row.GSPH, row.GCPH, sourceId);
  const millQuality = firstText(row.GCPH, row.GSPH, sourceId);
  const colorCode = firstText(row.GSSH, row.GCSH);
  const name = [productLine, articleNo, colorCode, clean(row.CF)].filter(Boolean).join(' / ') || `庞大面料 ${sourceId}`;
  const stockQuantity = strictNumber(row.KCSL);
  const cost = strictNumber(row.GCCGDJ) ?? strictNumber(row.RMB) ?? strictNumber(row.USD) ?? 0;

  return {
    sourceId,
    productAssetId,
    category: {
      id: pdmlCategoryId(productLine),
      mainCategory: 'Fabric',
      name: productLine,
      description: '由庞大面料库 CPXL 自动生成',
      updatedAt: BigInt(now),
      deletedAt: null,
    },
    product: {
      id: productAssetId,
      sku: sourceId,
      name,
      mainCategory: 'Fabric',
      subCategoryId: pdmlCategoryId(productLine),
      season: '',
      techPackUrl: null,
      imageUrl: clean(row.TPDZ),
      cost,
      status: statusFromPdml(row.ZT),
      updatedAt: BigInt(now),
      deletedAt: null,
    },
    profile: {
      id: pdmlProfileId(sourceId),
      productAssetId,
      articleNo,
      millOrganizationId: clean(row.GYS),
      millQuality,
      millColorCode: colorCode,
      colorDescription: firstText(row.YS, row.GCSH),
      construction: clean(row.MLZZ),
      yarnCount: clean(row.SZ),
      pattern: clean(row.HX),
      weightValue: strictNumber(row.KZ),
      weightUnit: clean(row.KZDW),
      widthValue: strictNumber(row.FK),
      widthUnit: clean(row.FKDW),
      widthText: clean(row.FK),
      productionLeadDays: strictInteger(row.SYJSTS),
      referenceBatch: firstText(row.PCH, row.GCPCH),
      stockStatus: stockQuantity && stockQuantity > 0 ? '现货' : clean(row.ZT),
      stockQuantity,
      stockUnit: null,
      moqValue: strictNumber(row.QDL),
      factoryMoqValue: strictNumber(row.GCQDL),
      sampleMoqValue: strictNumber(row.SYQDL),
      riskNote: clean(row.ZLBZ),
      specialNote: pdmlDetailNote(row),
      updatedAt: BigInt(now),
      deletedAt: null,
    },
    prices: pdmlPrices(row, productAssetId, sourceId, now),
    compositionLines: parseCompositionLines(row, productAssetId, now),
  };
};

const rebindPdmlProductMapping = (item: any, productAssetId: string) => {
  if (item.productAssetId === productAssetId) return item;
  item.productAssetId = productAssetId;
  item.product.id = productAssetId;
  item.profile.productAssetId = productAssetId;
  item.prices = item.prices.map((price: any) => ({ ...price, productAssetId }));
  item.compositionLines = item.compositionLines.map((entry: any, idx: number) => ({
    ...entry,
    line: {
      ...entry.line,
      id: `FCL-${productAssetId}-PDML-${idx}`,
      productAssetId,
    },
  }));
  return item;
};

export async function mapPdmlRawFabricsToProducts(opts: {
  prisma: PrismaClient;
  gsid?: string;
  limit?: number;
  offset?: number;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}) {
  const gsid = clean(opts.gsid) || process.env.PDML_GSID || '6';
  const limit = Math.min(Math.max(Number(opts.limit || 200), 1), 500);
  const offset = Math.max(Number(opts.offset || 0), 0);
  const where = { gsid, deletedAt: null };
  const [total, rawRows] = await Promise.all([
    (opts.prisma as any).pdmlRawFabric.count({ where }),
    (opts.prisma as any).pdmlRawFabric.findMany({
      where,
      orderBy: [{ registeredDate: 'desc' }, { sourceId: 'desc' }],
      skip: offset,
      take: limit,
    }),
  ]);
  const now = Date.now();
  const mapped = rawRows.map((raw: any) => mapPdmlRowToProduct(raw.rawData || {}, now)).filter(Boolean) as any[];
  const candidateIds = mapped.map(item => item.productAssetId);
  const candidateSkus = mapped.map(item => item.sourceId);
  const existing = mapped.length
    ? await (opts.prisma as any).productAsset.findMany({
        where: {
          OR: [
            { id: { in: candidateIds } },
            { sku: { in: candidateSkus } },
          ],
        },
        select: { id: true, sku: true },
      })
    : [];
  const existingById = new Map(existing.map((item: any) => [item.id, item]));
  const existingBySku = new Map(existing.map((item: any) => [item.sku, item]));
  const existingSet = new Set<string>();

  for (const item of mapped) {
    const matched = (existingBySku.get(item.sourceId) || existingById.get(item.productAssetId)) as any;
    if (!matched) continue;
    existingSet.add(matched.id);
    rebindPdmlProductMapping(item, matched.id);
  }

  let created = 0;
  let updated = 0;
  const touchedIds: string[] = [];

  for (const item of mapped) {
    await (opts.prisma as any).$transaction(async (tx: any) => {
      const categoryUpdate = { ...item.category };
      const productUpdate = { ...item.product };
      const profileUpdate = { ...item.profile };
      delete categoryUpdate.id;
      delete productUpdate.id;
      delete profileUpdate.id;
      delete profileUpdate.productAssetId;

      await tx.productSubCategory.upsert({
        where: { id: item.category.id },
        update: categoryUpdate,
        create: item.category,
      });

      await tx.productAsset.upsert({
        where: { id: item.productAssetId },
        update: productUpdate,
        create: item.product,
      });

      await tx.fabricProfile.upsert({
        where: { productAssetId: item.productAssetId },
        update: profileUpdate,
        create: item.profile,
      });

      await tx.fabricPriceHistory.deleteMany({
        where: { productAssetId: item.productAssetId, sourceType: 'pdml', sourceId: item.sourceId },
      });
      if (item.prices.length > 0) await tx.fabricPriceHistory.createMany({ data: item.prices });

      await tx.fabricCompositionLine.deleteMany({ where: { productAssetId: item.productAssetId } });
      for (const entry of item.compositionLines) {
        const termUpdate = { ...entry.term };
        delete termUpdate.id;
        await tx.materialCompositionTerm.upsert({
          where: { id: entry.term.id },
          update: { ...termUpdate, updatedAt: BigInt(now), deletedAt: null },
          create: { ...entry.term, updatedAt: BigInt(now), deletedAt: null },
        });
        await tx.fabricCompositionLine.create({ data: entry.line });
      }
    });

    if (existingSet.has(item.productAssetId)) updated += 1;
    else created += 1;
    touchedIds.push(item.productAssetId);
  }

  opts.onDataChange?.({ entity: 'products', action: 'pdml-map', ids: touchedIds.slice(0, 100) });

  return {
    ok: true,
    source: 'PDML raw cache' as const,
    gsid,
    total,
    limit,
    offset,
    mapped: mapped.length,
    created,
    updated,
    skipped: rawRows.length - mapped.length,
    hasMore: offset + rawRows.length < total,
    updatedAt: now,
  };
}

export async function syncPdmlRawFabricCache(opts: PdmlRawSyncOptions) {
  const gsid = clean(opts.gsid) || process.env.PDML_GSID || '6';
  const fetchRows = opts.fetchRows || fetchPdmlRawRows;
  const source = await fetchRows({ gsid, limit: opts.limit, pageSize: opts.pageSize });
  const now = BigInt(Date.now());
  const sourceIds = source.rows.map((row) => clean(row.ID)).filter(Boolean) as string[];

  const existingRows = sourceIds.length
    ? await (opts.prisma as any).pdmlRawFabric.findMany({
        where: { gsid: source.gsid, sourceId: { in: sourceIds } },
        select: { id: true, sourceId: true, sourceHash: true, firstSeenAt: true },
      })
    : [];
  const existingBySourceId = new Map<string, any>(existingRows.map((row: any) => [row.sourceId, row]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const touchedIds: string[] = [];
  const ops: any[] = [];

  for (const row of source.rows) {
    const sourceId = clean(row.ID);
    if (!sourceId) continue;
    const existing = existingBySourceId.get(sourceId);
    const data = rowToRawFabric(row, source.gsid, now, existing);
    if (!data) continue;

    touchedIds.push(data.id);
    if (!existing) created += 1;
    else if (existing.sourceHash !== data.sourceHash) updated += 1;
    else unchanged += 1;

    ops.push(
      (opts.prisma as any).pdmlRawFabric.upsert({
        where: { gsid_sourceId: { gsid: source.gsid, sourceId } },
        update: data,
        create: data,
      }),
    );
  }

  for (let i = 0; i < ops.length; i += 100) {
    await (opts.prisma as any).$transaction(ops.slice(i, i + 100));
  }

  opts.onDataChange?.({ entity: 'pdml-raw-fabrics', action: 'sync', ids: touchedIds.slice(0, 100) });

  return {
    ok: true,
    source: 'PDML V_MLXX' as const,
    gsid: source.gsid,
    totalAvailable: source.totalAvailable,
    fetched: source.rows.length,
    created,
    updated,
    unchanged,
    skipped: source.rows.length - touchedIds.length,
    syncedAt: Number(now),
  };
}

const prunePdmlSyncJobs = () => {
  const now = Date.now();
  for (const [jobId, job] of pdmlSyncJobs) {
    const terminalAt = job.finishedAt || job.startedAt || now;
    if (now - terminalAt > PDML_SYNC_JOB_TTL_MS) pdmlSyncJobs.delete(jobId);
  }
};

const runPdmlSyncJob = async (
  jobId: string,
  opts: PdmlRouterOptions,
  params: { gsid: string; limit?: number; pageSize?: number },
) => {
  const job = pdmlSyncJobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const result = await syncPdmlRawFabricCache({
      prisma: opts.prisma,
      gsid: params.gsid,
      limit: params.limit,
      pageSize: params.pageSize,
      fetchRows: opts.fetchRows,
      onDataChange: opts.onDataChange,
    });
    job.status = 'completed';
    job.result = result;
    job.finishedAt = Date.now();
  } catch (e: any) {
    console.error('[pdml/sync-job] failed:', e);
    job.status = 'failed';
    job.error = String(e?.message ?? e);
    job.finishedAt = Date.now();
  }
};

const parsePositiveNumber = (value: unknown, label: string) => {
  if (value == null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return number;
};

export function createPdmlRouter(opts: PdmlRouterOptions): Router {
  const router = Router();

  // 统一认证守卫：JWT（走 jwt.verify 验签）优先，API-Key 次之；API-Key 限只读
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));

  // 写操作必须 JWT（API-Key 不可写）
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });

  router.get('/raw', async (req, res) => {
    try {
      const requestedLimit = Number(req.query.limit || 100);
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 100;
      const requestedOffset = Number(req.query.offset || 0);
      const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
      const gsid = typeof req.query.gsid === 'string' ? req.query.gsid.trim() : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const where = {
        deletedAt: null,
        ...(gsid ? { gsid } : {}),
        ...(search
          ? {
              OR: [
                { sourceId: { contains: search, mode: 'insensitive' } },
                { articleNo: { contains: search, mode: 'insensitive' } },
                { factoryArticleNo: { contains: search, mode: 'insensitive' } },
                { supplierName: { contains: search, mode: 'insensitive' } },
                { productLine: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        (opts.prisma as any).pdmlRawFabric.count({ where }),
        (opts.prisma as any).pdmlRawFabric.findMany({
          where,
          orderBy: [{ registeredDate: 'desc' }, { sourceId: 'desc' }],
          skip: offset,
          take: limit,
        }),
      ]);

      return res.json({
        ok: true,
        fabrics: rows.map(serializeRawFabric),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    } catch (e: any) {
      console.error('[pdml/raw-list] failed:', e);
      return res.status(500).json({ error: 'LIST_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.get('/sync/:jobId', async (req, res) => {
    prunePdmlSyncJobs();
    const job = pdmlSyncJobs.get(String(req.params.jobId || ''));
    if (!job) {
      return res.status(404).json({ error: 'JOB_NOT_FOUND', message: 'PDML sync job not found' });
    }
    return res.json(job);
  });

  router.post('/sync', requireWrite, async (req, res) => {
    try {
      const body = req.body || {};
      const gsid = clean(body.gsid) || process.env.PDML_GSID || '6';
      const limit = parsePositiveNumber(body.limit, 'limit');
      const pageSize = parsePositiveNumber(body.pageSize, 'pageSize');

      if (body.blocking === true) {
        const result = await syncPdmlRawFabricCache({
          prisma: opts.prisma,
          gsid,
          limit,
          pageSize,
          fetchRows: opts.fetchRows,
          onDataChange: opts.onDataChange,
        });
        return res.json(result);
      }

      prunePdmlSyncJobs();
      const jobId = randomUUID();
      const job: PdmlSyncJobState = {
        ok: true,
        jobId,
        status: 'queued',
        gsid,
      };
      pdmlSyncJobs.set(jobId, job);
      setTimeout(() => void runPdmlSyncJob(jobId, opts, { gsid, limit, pageSize }), 0);
      return res.status(202).json(job);
    } catch (e: any) {
      if (String(e?.message || '').includes('must be a positive number')) {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: e.message });
      }
      console.error('[pdml/sync] failed:', e);
      return res.status(500).json({ error: 'SYNC_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/map-products', requireWrite, async (req, res) => {
    try {
      const body = req.body || {};
      const limit = body.limit == null ? undefined : Number(body.limit);
      const offset = body.offset == null ? undefined : Number(body.offset);
      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'limit must be a positive number' });
      }
      if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'offset must be zero or a positive number' });
      }

      const result = await mapPdmlRawFabricsToProducts({
        prisma: opts.prisma,
        gsid: clean(body.gsid) || process.env.PDML_GSID || '6',
        limit,
        offset,
        onDataChange: opts.onDataChange,
      });

      return res.json(result);
    } catch (e: any) {
      console.error('[pdml/map-products] failed:', e);
      return res.status(500).json({ error: 'MAP_FAILED', message: String(e?.message ?? e) });
    }
  });

  return router;
}
