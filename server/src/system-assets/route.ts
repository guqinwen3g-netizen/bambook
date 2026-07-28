import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export interface SystemAssetsRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  uploadDir: string;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const ALLOWED_KINDS = new Set(['wallpaper']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function createSystemAssetsRouter(opts: SystemAssetsRouterOptions): Router {
  const router = Router();

  router.get('/:id/file', async (req, res) => {
    try {
      const asset = await (opts.prisma as any).systemAsset.findFirst({
        where: { id: req.params.id, deletedAt: null, hidden: false },
      });
      if (!asset?.filePath) return res.status(404).json({ error: 'NOT_FOUND', message: 'Asset file not found' });
      const fullPath = path.join(opts.uploadDir, asset.filePath);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'FILE_MISSING', message: 'Asset file missing on data center' });
      if (asset.mimeType) res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(fullPath);
    } catch (e: any) {
      console.error('[system-assets/file] failed:', e);
      return res.status(500).json({ error: 'FILE_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!opts.requireAuth) return next();
    const key = req.headers['x-bambook-api-key'] as string | undefined;
    if (!key) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'X-Bambook-API-Key header required' });
    if (!opts.apiKeys.has(key)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API key' });
    return next();
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(opts.uploadDir, 'system', 'wallpapers');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const title = sanitizeFileStem(String(req.body?.title || path.parse(file.originalname).name || '未命名壁纸'));
        const ext = normalizeImageExt(file);
        cb(null, `${title}${ext}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIME_TYPES.has(file.mimetype)) cb(null, true);
      else cb(new Error('Only image files (jpeg, png, webp, gif) are allowed'));
    },
  });

  router.get('/', async (req, res) => {
    try {
      const kind = String(req.query.kind || 'wallpaper');
      if (!ALLOWED_KINDS.has(kind)) {
        return res.status(400).json({ error: 'INVALID_KIND', message: `Unsupported asset kind: ${kind}` });
      }
      const includeHidden = req.query.includeHidden === 'true';
      const assets = await (opts.prisma as any).systemAsset.findMany({
        where: {
          kind,
          deletedAt: null,
          ...(includeHidden ? {} : { hidden: false }),
        },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      });
      return res.json({ ok: true, assets: serializeAssets(assets) });
    } catch (e: any) {
      console.error('[system-assets/list] failed:', e);
      return res.status(500).json({ error: 'LIST_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/wallpapers', upload.single('file'), async (req, res) => {
    try {
      const now = Date.now();
      const file = req.file;
      const id = String(req.body?.id || `wallpaper-${now}`);
      const requestedTitle = cleanText(req.body?.title);
      const title = requestedTitle || (file ? path.parse(file.originalname).name : '经典渐变');
      const group = cleanText(req.body?.group) || '未分组';
      const sortOrder = Number(req.body?.sortOrder ?? 0);
      const hidden = String(req.body?.hidden || '').toLowerCase() === 'true';
      const filePath = file ? path.join('system', 'wallpapers', file.filename) : null;
      const forceMetadata = String(req.body?.forceMetadata || '').toLowerCase() === 'true';
      const existing = await (opts.prisma as any).systemAsset.findUnique({ where: { id } });

      const asset = await (opts.prisma as any).systemAsset.upsert({
        where: { id },
        create: {
          id,
          kind: 'wallpaper',
          title,
          group,
          filePath,
          fileName: file?.originalname || null,
          mimeType: file?.mimetype || null,
          fileSize: file?.size || null,
          sortOrder,
          hidden,
          metadata: {},
          createdAt: BigInt(now),
          updatedAt: BigInt(now),
          deletedAt: null,
        },
        update: {
          title: forceMetadata || !existing ? title : existing.title,
          group: forceMetadata || !existing ? group : existing.group,
          ...(file ? {
            filePath,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
          } : {}),
          sortOrder: forceMetadata || !existing ? sortOrder : existing.sortOrder,
          hidden: forceMetadata || !existing ? hidden : existing.hidden,
          updatedAt: BigInt(now),
          deletedAt: null,
        },
      });

      opts.onDataChange?.({ entity: 'system-assets', action: 'upsert', ids: [id] });
      return res.status(201).json({ ok: true, asset: serializeAsset(asset) });
    } catch (e: any) {
      console.error('[system-assets/upload-wallpaper] failed:', e);
      return res.status(500).json({ error: 'UPLOAD_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body || {};
      const data: Record<string, unknown> = { updatedAt: BigInt(Date.now()) };
      if (body.title !== undefined) data.title = cleanText(body.title) || '未命名壁纸';
      if (body.group !== undefined) data.group = cleanText(body.group) || '未分组';
      if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
      if (body.hidden !== undefined) data.hidden = Boolean(body.hidden);
      if (body.metadata !== undefined) data.metadata = body.metadata || {};

      const asset = await (opts.prisma as any).systemAsset.update({ where: { id }, data });
      opts.onDataChange?.({ entity: 'system-assets', action: 'update', ids: [id] });
      return res.json({ ok: true, asset: serializeAsset(asset) });
    } catch (e: any) {
      console.error('[system-assets/update] failed:', e);
      return res.status(500).json({ error: 'UPDATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const id = req.params.id;
      await (opts.prisma as any).systemAsset.update({
        where: { id },
        data: { deletedAt: BigInt(Date.now()), updatedAt: BigInt(Date.now()) },
      });
      opts.onDataChange?.({ entity: 'system-assets', action: 'delete', ids: [id] });
      return res.json({ ok: true, deleted: id });
    } catch (e: any) {
      console.error('[system-assets/delete] failed:', e);
      return res.status(500).json({ error: 'DELETE_FAILED', message: String(e?.message ?? e) });
    }
  });

  return router;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizeFileStem(value: string): string {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 48) || '未命名壁纸';
}

function normalizeImageExt(file: Express.Multer.File): string {
  const ext = path.extname(file.originalname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext;
  if (file.mimetype === 'image/png') return '.png';
  if (file.mimetype === 'image/webp') return '.webp';
  if (file.mimetype === 'image/gif') return '.gif';
  return '.jpg';
}

function serializeAsset(asset: any) {
  return {
    ...asset,
    createdAt: Number(asset.createdAt),
    updatedAt: Number(asset.updatedAt),
    deletedAt: asset.deletedAt == null ? null : Number(asset.deletedAt),
    fileUrl: asset.filePath ? `/api/v1/system-assets/${encodeURIComponent(asset.id)}/file` : '',
  };
}

function serializeAssets(assets: any[]) {
  return assets.map(serializeAsset);
}
