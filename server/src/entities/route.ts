import { Router, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ENTITY_REGISTRY_VERSION, ENTITY_TYPES } from './registry';
import { countEntities, hydrateEntities, searchEntities } from './search';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { logger } from '../lib/logger';

export interface EntitiesRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createEntitiesRouter(opts: EntitiesRouterOptions): Router {
  const router = Router();

  // Shared module-level auth guard: JWT (cookie/Bearer) or API-key header.
  // Entity graph queries (links/neighbors) expose potentially sensitive
  // cross-module relationships — guard at module boundary like other ERP modules.
  const guard = createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  router.use(guard);

  router.get('/registry', (_req, res) => {
    return res.json({
      ok: true,
      registryVersion: ENTITY_REGISTRY_VERSION,
      entityTypes: ENTITY_TYPES,
    });
  });

  router.post('/search', async (req, res) => {
    try {
      const request = req.body || {};
      const [items, total] = await Promise.all([
        searchEntities(opts.prisma, request),
        countEntities(opts.prisma, request),
      ]);
      const limit = Math.max(1, Math.min(Number(request.limit || 10), 30));
      const offset = Math.max(0, Math.min(Number(request.offset || 0), 4970));
      const safeTotal = Math.max(total, offset + items.length);
      return res.json({
        ok: true,
        items,
        total: safeTotal,
        limit,
        offset,
        hasMore: offset + items.length < safeTotal,
      });
    } catch (e: any) {
      logger.error('[entities/search] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'ENTITY_SEARCH_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/hydrate', async (req, res) => {
    try {
      const items = await hydrateEntities(opts.prisma, req.body || {});
      return res.json({ ok: true, items });
    } catch (e: any) {
      logger.error('[entities/hydrate] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'ENTITY_HYDRATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/resolve-batch', async (req, res) => {
    try {
      const inputs = Array.isArray(req.body?.inputs) ? req.body.inputs : [];
      const results: Array<{ fieldKey: any; query: any; items: any }> = [];
      for (const input of inputs) {
        const items = await searchEntities(opts.prisma, input || {});
        results.push({ fieldKey: input?.fieldKey, query: input?.query, items });
      }
      return res.json({ ok: true, results });
    } catch (e: any) {
      logger.error('[entities/resolve-batch] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'ENTITY_RESOLVE_BATCH_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ---------------------------------------------------------------------------
  // EntityLink graph queries
  //
  // GET /api/v1/entities/links?fromType=order&fromId=ABC
  //   → all outgoing links (this entity → others)
  //
  // GET /api/v1/entities/links?toType=relation.organization&toId=XYZ
  //   → all incoming links (others → this entity)
  //
  // GET /api/v1/entities/links?type=order&id=ABC
  //   → both directions, useful for "show everything related to X"
  //
  // Optional filters: linkKind, status (default 'active'), limit (default 100).
  // Optional ?expand=1 fetches snapshot fields from EntityReference for both
  // sides so the client/Agent can display labels without secondary lookups.
  // ---------------------------------------------------------------------------
  router.get('/links', async (req, res) => {
    try {
      const fromType = trimOrUndef(req.query.fromType);
      const fromId = trimOrUndef(req.query.fromId);
      const toType = trimOrUndef(req.query.toType);
      const toId = trimOrUndef(req.query.toId);
      const anyType = trimOrUndef(req.query.type);
      const anyId = trimOrUndef(req.query.id);
      const linkKind = trimOrUndef(req.query.linkKind);
      const status = trimOrUndef(req.query.status) ?? 'active';
      const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
      const expand = String(req.query.expand ?? '').toLowerCase() === '1'
        || String(req.query.expand ?? '').toLowerCase() === 'true';

      // Resolve direction filter
      const orClauses: any[] = [];
      if (fromType && fromId) orClauses.push({ fromType, fromId });
      if (toType && toId) orClauses.push({ toType, toId });
      if (anyType && anyId) {
        orClauses.push({ fromType: anyType, fromId: anyId });
        orClauses.push({ toType: anyType, toId: anyId });
      }
      if (orClauses.length === 0) {
        return res.status(400).json({
          error: 'BAD_QUERY',
          message: 'provide either (fromType,fromId), (toType,toId), or (type,id)',
        });
      }

      const where: any = {
        OR: orClauses,
        status,
        deletedAt: null,
      };
      if (linkKind) where.linkKind = linkKind;

      const links = await (opts.prisma as any).entityLink.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });

      const serialized = links.map((l: any) => bigintToNumber(l));

      let snapshots: Record<string, any> = {};
      if (expand && serialized.length > 0) {
        // Collect every (type,id) pair appearing on either end and fetch the
        // most recent snapshot we have for it. EntityReference uses a per-(owner,
        // field, target) row, so we fall back to the most recent reference per
        // (type,id) pair by ordering on updatedAt.
        const targets = new Set<string>();
        for (const l of serialized) {
          targets.add(`${l.fromType}::${l.fromId}`);
          targets.add(`${l.toType}::${l.toId}`);
        }
        const refs = await (opts.prisma as any).entityReference.findMany({
          where: {
            OR: Array.from(targets).map((key) => {
              const [t, id] = key.split('::');
              return { targetType: t, targetId: id, status: 'active' };
            }),
          },
          orderBy: { updatedAt: 'desc' },
          take: targets.size * 4, // a few rows per target is enough; we dedup below
        });
        for (const r of refs) {
          const key = `${r.targetType}::${r.targetId}`;
          if (!snapshots[key]) {
            snapshots[key] = bigintToNumber(r).snapshot ?? null;
          }
        }
      }

      return res.json({
        ok: true,
        links: serialized,
        snapshots: expand ? snapshots : undefined,
        total: serialized.length,
      });
    } catch (e: any) {
      logger.error('[entities/links] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'ENTITY_LINKS_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/entities/neighbors?type=relation.organization&id=ORG-1
  //   → grouped by linkKind for easy "see all orders / all dev cases / all
  //     contacts attached to this customer" panels.
  // ---------------------------------------------------------------------------
  router.get('/neighbors', async (req, res) => {
    try {
      const type = trimOrUndef(req.query.type);
      const id = trimOrUndef(req.query.id);
      const status = trimOrUndef(req.query.status) ?? 'active';
      const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 500));
      if (!type || !id) {
        return res.status(400).json({ error: 'BAD_QUERY', message: 'type and id are required' });
      }
      const links = await (opts.prisma as any).entityLink.findMany({
        where: {
          OR: [
            { fromType: type, fromId: id },
            { toType: type, toId: id },
          ],
          status,
          deletedAt: null,
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });

      const groups: Record<string, Array<{ direction: 'out' | 'in'; type: string; id: string; linkKind: string; updatedAt: number }>> = {};
      for (const l of links) {
        const obj = bigintToNumber(l);
        const direction: 'out' | 'in' = (obj.fromType === type && obj.fromId === id) ? 'out' : 'in';
        const otherType = direction === 'out' ? obj.toType : obj.fromType;
        const otherId = direction === 'out' ? obj.toId : obj.fromId;
        const bucket = obj.linkKind || 'related';
        if (!groups[bucket]) groups[bucket] = [];
        groups[bucket].push({
          direction,
          type: otherType,
          id: otherId,
          linkKind: obj.linkKind,
          updatedAt: obj.updatedAt,
        });
      }

      return res.json({ ok: true, type, id, neighbors: groups, total: links.length });
    } catch (e: any) {
      logger.error('[entities/neighbors] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'ENTITY_NEIGHBORS_FAILED', message: String(e?.message ?? e) });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function trimOrUndef(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function bigintToNumber<T extends Record<string, any>>(row: T): T {
  const out: any = { ...row };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  }
  return out;
}
