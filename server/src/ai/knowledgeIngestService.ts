import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { writeRouteAuditLog } from '../audit/routeAudit';

export type KnowledgeIngestErrorCode =
  | 'INVALID_INPUT'
  | 'DUPLICATE_CHECKSUM'
  | 'CREATE_FAILED'
  | 'AUDIT_FAILED';

export interface KnowledgeIngestError {
  code: KnowledgeIngestErrorCode;
  message: string;
}

export interface KnowledgeIngestInput {
  title: string;
  text: string;
  sourceType?: string;
  sourceUri?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  scopes?: string[];
}

export interface KnowledgeIngestResult {
  documentId: string;
  checksum: string;
  chunkCount: number;
  auditId: string;
}

export interface IngestParams {
  prisma: PrismaClient;
  input: KnowledgeIngestInput;
  actorId?: string;
  ip?: string | null;
  auditSource?: string;
  auditOperation?: string;
}

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 100;
const MAX_TEXT_BYTES = 500_000;
const MAX_TITLE_LEN = 500;

export function computeChecksum(title: string, text: string): string {
  return crypto.createHash('sha256').update(`${title}\n${text}`).digest('hex');
}

function validateInput(input: KnowledgeIngestInput): KnowledgeIngestError | null {
  const title = (input.title || '').trim();
  if (!title) return { code: 'INVALID_INPUT', message: 'title is required' };
  if (title.length > MAX_TITLE_LEN) return { code: 'INVALID_INPUT', message: `title exceeds ${MAX_TITLE_LEN} chars` };

  const text = (input.text || '').trim();
  if (!text) return { code: 'INVALID_INPUT', message: 'text is required' };

  const byteLen = Buffer.byteLength(text, 'utf-8');
  if (byteLen > MAX_TEXT_BYTES) return { code: 'INVALID_INPUT', message: `text exceeds ${MAX_TEXT_BYTES} bytes` };

  return null;
}

function jsonSafe(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object') return null;
  try {
    JSON.parse(JSON.stringify(value));
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function splitChunks(text: string): { content: string; chunkIndex: number }[] {
  const clean = text.trim();
  if (!clean) return [];
  const chunks: { content: string; chunkIndex: number }[] = [];
  let pos = 0;
  let idx = 0;
  while (pos < clean.length) {
    const end = Math.min(pos + CHUNK_SIZE, clean.length);
    chunks.push({ content: clean.slice(pos, end), chunkIndex: idx });
    pos = end === clean.length ? end : pos + CHUNK_SIZE - CHUNK_OVERLAP;
    idx++;
  }
  return chunks;
}

async function withTx<T>(prisma: PrismaClient, tx: any | undefined, fn: (t: any) => Promise<T>): Promise<T> {
  return tx ? await fn(tx) : await (prisma as any).$transaction(fn);
}

export async function ingestKnowledgeDocument(params: IngestParams): Promise<{ ok: true; result: KnowledgeIngestResult } | { ok: false; error: KnowledgeIngestError }> {
  const { prisma, input, actorId, ip } = params;
  const auditSource = params.auditSource || 'route:knowledge-documents:ingest-text';
  const auditOperation = params.auditOperation || 'knowledge_ingest';

  const valErr = validateInput(input);
  if (valErr) return { ok: false, error: valErr };

  const title = input.title.trim();
  const text = input.text.trim();
  const sourceType = (input.sourceType || 'manual').trim();
  const sourceUri = input.sourceUri?.trim() || null;
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  const metadata = jsonSafe(input.metadata);
  const checksum = computeChecksum(title, text);

  try {
    const result = await withTx(prisma, undefined, async (t: any) => {
      const existing = await t.knowledgeDocument.findFirst({
        where: { checksum, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw { code: 'DUPLICATE_CHECKSUM', message: `document with same checksum already exists: ${existing.id}` };
      }

      const documentId = `kd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const doc = await t.knowledgeDocument.create({
        data: {
          id: documentId,
          title,
          sourceType,
          sourceUri,
          checksum,
          status: 'active',
          metadata: metadata ?? undefined,
        },
      });

      const chunks = splitChunks(text);
      if (chunks.length === 0) {
        throw { code: 'INVALID_INPUT', message: 'text produces no chunks' };
      }

      for (const chunk of chunks) {
        await t.knowledgeChunk.create({
          data: {
            id: `kc_${documentId}_${chunk.chunkIndex}`,
            documentId: doc.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tags,
            metadata: metadata ?? undefined,
          },
        });
      }

      const scopes = Array.isArray(input.scopes) ? input.scopes.map(String).filter(Boolean) : [];
      for (const scope of scopes) {
        await t.knowledgeAcl.create({
          data: {
            id: `kacl_${documentId}_${scope}`,
            documentId: doc.id,
            scope,
            access: 'read',
          },
        });
      }

      let auditId: string;
      try {
        auditId = await writeRouteAuditLog({
          prisma: t,
          actorId: actorId || 'system',
          operation: auditOperation,
          targetType: 'KnowledgeDocument',
          targetId: doc.id,
          source: auditSource,
          after: { documentId: doc.id, title, checksum, chunkCount: chunks.length, sourceType },
          ip: ip ?? null,
        });
      } catch (auditErr: any) {
        throw { code: 'AUDIT_FAILED', message: `audit log write failed: ${String(auditErr?.message ?? auditErr)}` };
      }

      return { documentId: doc.id, checksum, chunkCount: chunks.length, auditId };
    });

    return { ok: true, result };
  } catch (e: any) {
    if (e?.code && ['DUPLICATE_CHECKSUM', 'INVALID_INPUT', 'AUDIT_FAILED'].includes(e.code)) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: 'CREATE_FAILED', message: String(e?.message ?? e) } };
  }
}
