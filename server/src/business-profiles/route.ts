import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

export interface BusinessProfilesRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const serializeProfile = (row: any) => ({
  ...row,
  updatedAt: Number(row.updatedAt),
  deletedAt: row.deletedAt == null ? null : Number(row.deletedAt),
});

export function createBusinessProfilesRouter(opts: BusinessProfilesRouterOptions): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!opts.requireAuth) return next();
    const key = req.headers['x-bambook-api-key'] as string | undefined;
    if (!key) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'X-Bambook-API-Key header required' });
    if (!opts.apiKeys.has(key)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API key' });
    return next();
  });

  router.get('/', async (req, res) => {
    try {
      const kind = typeof req.query.kind === 'string' ? req.query.kind.trim() : '';
      const rows = await (opts.prisma as any).businessProfile.findMany({
        where: {
          deletedAt: null,
          ...(kind ? { kind } : {}),
        },
        orderBy: [{ updatedAt: 'desc' }],
      });
      return res.json({ ok: true, profiles: rows.map(serializeProfile) });
    } catch (e: any) {
      console.error('[business-profiles/list] failed:', e);
      return res.status(500).json({ error: 'LIST_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      const now = BigInt(Date.now());
      const id = String(body.id || `BPROF-${Date.now()}`);
      const kind = String(body.kind || '').trim();
      const name = String(body.name || '').trim();

      if (!kind || !name) {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'kind and name are required' });
      }

      const saved = await (opts.prisma as any).businessProfile.upsert({
        where: { id },
        update: {
          kind,
          name,
          payload: body.payload || {},
          assets: body.assets || {},
          isActive: body.isActive !== false,
          updatedAt: now,
          deletedAt: null,
        },
        create: {
          id,
          kind,
          name,
          payload: body.payload || {},
          assets: body.assets || {},
          isActive: body.isActive !== false,
          updatedAt: now,
          deletedAt: null,
        },
      });

      opts.onDataChange?.({ entity: 'business-profiles', action: 'upsert', ids: [saved.id] });
      return res.json({ ok: true, profile: serializeProfile(saved) });
    } catch (e: any) {
      console.error('[business-profiles/upsert] failed:', e);
      return res.status(500).json({ error: 'UPSERT_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'id is required' });

      const saved = await (opts.prisma as any).businessProfile.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: BigInt(Date.now()),
          updatedAt: BigInt(Date.now()),
        },
      });

      opts.onDataChange?.({ entity: 'business-profiles', action: 'delete', ids: [id] });
      return res.json({ ok: true, profile: serializeProfile(saved) });
    } catch (e: any) {
      console.error('[business-profiles/delete] failed:', e);
      return res.status(500).json({ error: 'DELETE_FAILED', message: String(e?.message ?? e) });
    }
  });

  return router;
}
