import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { addVolcKnowledgeDocument } from './volcKnowledge';
import { PrismaClient } from '@prisma/client';
import { ingestKnowledgeDocument, listKnowledgeDocuments, updateKnowledgeDocument, deleteKnowledgeDocument } from './knowledgeIngestService';
import { actorIdFromRequest } from '../audit/routeAudit';
import { createModuleAuthGuard } from '../auth/moduleGuard';

type KnowledgeDocumentsRouterOptions = {
  uploadDir: string;
  requireAuth: boolean;
  apiKeys: Set<string>;
  prisma: PrismaClient;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
};

type StoredKnowledgeDocument = {
  docId: string;
  docName: string;
  docType: string;
  collectionName: string;
  project: string;
  filePath: string;
  token: string;
  originalName: string;
  mimeType?: string;
  size: number;
  volcRequestId?: string;
  volcResourceId?: string;
  createdAt: string;
};

type DocumentIndex = Record<string, StoredKnowledgeDocument>;

export function createKnowledgeDocumentsRouter(options: KnowledgeDocumentsRouterOptions) {
  const router = Router();
  const storageDir = path.join(options.uploadDir, 'knowledge-documents');
  fs.mkdirSync(storageDir, { recursive: true });

  // Shared module-level auth guard: JWT (cookie/Bearer) or API-key header.
  // Replaces the previous per-route inline `auth()` helper so the download
  // route is no longer reachable without authentication (it previously relied
  // only on a per-doc random token query param).
  const guard = createModuleAuthGuard({ requireAuth: options.requireAuth, apiKeys: options.apiKeys });
  router.use(guard);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, storageDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: Number(process.env.BAMBOOK_KNOWLEDGE_UPLOAD_MAX_BYTES || 50 * 1024 * 1024) },
  });

  router.get('/:docId/download', (req, res) => {
    const index = readIndex(storageDir);
    const record = index[req.params.docId];
    if (!record) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Knowledge document not found.' });
    }
    if (!fs.existsSync(record.filePath)) {
      return res.status(404).json({ error: 'FILE_MISSING', message: 'Knowledge document file is missing.' });
    }
    res.download(record.filePath, record.originalName);
  });

  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'file is required' });
    }

    const collectionName = String(req.body?.collectionName || process.env.BAMBOOK_KNOWLEDGE_DEFAULT_COLLECTION || '').trim();
    if (!collectionName) {
      fs.unlink(file.path, () => undefined);
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'collectionName is required' });
    }

    const project = String(req.body?.project || process.env.BAMBOOK_KNOWLEDGE_PROJECT || 'default').trim();
    const docName = String(req.body?.docName || req.body?.title || file.originalname).trim();
    const docType = resolveDocType(file.originalname);
    const docId = normalizeDocId(String(req.body?.docId || docName));
    const token = crypto.randomBytes(24).toString('hex');
    const publicUrl = buildPublicDownloadUrl(req, docId, token);

    try {
      const volc = await addVolcKnowledgeDocument({
        collectionName,
        project,
        docId,
        docName,
        docType,
        url: publicUrl,
        meta: buildMeta(req.body),
      });

      const index = readIndex(storageDir);
      const previous = index[docId];
      if (previous?.filePath && previous.filePath !== file.path && fs.existsSync(previous.filePath)) {
        fs.unlink(previous.filePath, () => undefined);
      }

      index[docId] = {
        docId,
        docName,
        docType,
        collectionName,
        project,
        filePath: file.path,
        token,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        volcRequestId: volc.request_id,
        volcResourceId: volc.data?.resource_id,
        createdAt: new Date().toISOString(),
      };
      writeIndex(storageDir, index);

      return res.json({
        ok: true,
        docId,
        docName,
        docType,
        collectionName,
        project,
        requestId: volc.request_id,
        volc: volc.data,
      });
    } catch (error: any) {
      fs.unlink(file.path, () => undefined);
      return res.status(502).json({
        ok: false,
        error: 'VOLC_KNOWLEDGE_UPLOAD_FAILED',
        message: error?.message || 'Volc knowledge upload failed',
      });
    }
  });

  // ─── ERP manual ingest: text → KnowledgeDocument + KnowledgeChunk (Prisma, audit) ───
  router.post('/ingest-text', async (req: Request, res: Response) => {
    const outcome = await ingestKnowledgeDocument({
      prisma: options.prisma,
      input: {
        title: String(req.body?.title || ''),
        text: String(req.body?.text || ''),
        sourceType: req.body?.sourceType ? String(req.body.sourceType) : undefined,
        sourceUri: req.body?.sourceUri ? String(req.body.sourceUri) : undefined,
        tags: Array.isArray(req.body?.tags) ? req.body.tags : undefined,
        metadata: typeof req.body?.metadata === 'object' && req.body.metadata ? req.body.metadata : undefined,
        scopes: Array.isArray(req.body?.scopes) ? req.body.scopes : undefined,
      },
      actorId: actorIdFromRequest(req),
      ip: req.ip,
    });

    if (!outcome.ok) {
      const statusMap: Record<string, number> = {
        INVALID_INPUT: 400,
        DUPLICATE_CHECKSUM: 409,
        CREATE_FAILED: 500,
        AUDIT_FAILED: 500,
      };
      const error = outcome.error;
      return res.status(statusMap[error.code] || 500).json({ ok: false, error: error.code, message: error.message });
    }

    if (options.onDataChange) options.onDataChange({ entity: 'knowledge-document', action: 'ingest', ids: [outcome.result.documentId] });
    return res.status(201).json({ ok: true, ...outcome.result });
  });

  // 列表 = 文件索引（upload 通道）+ Prisma（ERP ingest 通道）双源合并，origin 字段区分来源。
  // Prisma 查询失败时降级为仅 upload 列表并显式标记，不静默吞错。
  router.get('/', async (_req, res) => {
    const uploadRecords = Object.values(readIndex(storageDir)).map(({ token: _token, filePath: _filePath, ...record }) => ({
      ...record,
      origin: 'upload' as const,
    }));
    try {
      const erpRecords = (await listKnowledgeDocuments({ prisma: options.prisma })).map(record => ({
        ...record,
        origin: 'erp' as const,
      }));
      res.json({ ok: true, documents: [...erpRecords, ...uploadRecords] });
    } catch (e: any) {
      res.json({ ok: true, documents: uploadRecords, erpListError: String(e?.message ?? e) });
    }
  });

  // 编辑 ERP 知识文档（标题/正文/分类）。正文变更 = 软删旧 chunk + 重建 + 版本递增 + 审计。
  router.patch('/:docId', async (req: Request, res: Response) => {
    const category = req.body?.category != null ? String(req.body.category) : undefined;
    const outcome = await updateKnowledgeDocument({
      prisma: options.prisma,
      documentId: String(req.params.docId || ''),
      input: {
        title: req.body?.title != null ? String(req.body.title) : undefined,
        text: req.body?.text != null ? String(req.body.text) : undefined,
        metadata: category !== undefined ? { category } : undefined,
      },
      actorId: actorIdFromRequest(req),
      ip: req.ip,
    });

    if (!outcome.ok) {
      const statusMap: Record<string, number> = { INVALID_INPUT: 400, NOT_FOUND: 404, UPDATE_FAILED: 500, AUDIT_FAILED: 500 };
      return res.status(statusMap[outcome.error.code] || 500).json({ ok: false, error: outcome.error.code, message: outcome.error.message });
    }

    if (options.onDataChange) options.onDataChange({ entity: 'knowledge-document', action: 'update', ids: [outcome.result.documentId] });
    return res.json({ ok: true, ...outcome.result });
  });

  // 软删除 ERP 知识文档（doc + chunks 打 deletedAt，审计留痕）。
  router.delete('/:docId', async (req: Request, res: Response) => {
    const outcome = await deleteKnowledgeDocument({
      prisma: options.prisma,
      documentId: String(req.params.docId || ''),
      actorId: actorIdFromRequest(req),
      ip: req.ip,
    });

    if (!outcome.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, DELETE_FAILED: 500, AUDIT_FAILED: 500 };
      return res.status(statusMap[outcome.error.code] || 500).json({ ok: false, error: outcome.error.code, message: outcome.error.message });
    }

    if (options.onDataChange) options.onDataChange({ entity: 'knowledge-document', action: 'delete', ids: [outcome.result.documentId] });
    return res.json({ ok: true, ...outcome.result });
  });

  return router;
}

function readIndex(storageDir: string): DocumentIndex {
  const indexPath = path.join(storageDir, 'index.json');
  if (!fs.existsSync(indexPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as DocumentIndex;
  } catch {
    return {};
  }
}

function writeIndex(storageDir: string, index: DocumentIndex) {
  fs.writeFileSync(path.join(storageDir, 'index.json'), JSON.stringify(index, null, 2));
}

function resolveDocType(filename: string) {
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  if (!ext) return 'txt';
  if (ext === 'md') return 'markdown';
  return ext;
}

function normalizeDocId(input: string) {
  const cleaned = input
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const hash = crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
  const base = cleaned || 'document';
  const prefixed = /^[a-zA-Z_]/.test(base) ? base : `doc_${base}`;
  return `${prefixed}_${hash}`.slice(0, 128);
}

function buildPublicDownloadUrl(req: Request, docId: string, token: string) {
  const configured = process.env.BAMBOOK_KNOWLEDGE_PUBLIC_BASE_URL || process.env.BAMBOOK_PUBLIC_BASE_URL;
  const base = configured?.trim()
    ? configured.trim().replace(/\/$/, '')
    : `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  return `${base}/api/v1/knowledge-documents/${encodeURIComponent(docId)}/download?token=${encodeURIComponent(token)}`;
}

function buildMeta(body: any) {
  const rawTags = typeof body?.tags === 'string' ? body.tags.split(',') : [];
  const tags = rawTags.map((tag: string) => tag.trim()).filter(Boolean);
  if (!tags.length) return undefined;
  return tags.map((tag: string) => ({
    field_name: 'tag',
    field_type: 'string',
    field_value: tag,
  }));
}
