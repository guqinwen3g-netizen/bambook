import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { resolveRelationCoordinates } from './geoResolve';
import { expandRelation, getRelation, queryRelations } from './query';
import { actorIdFromRequest } from '../audit/routeAudit';
import { createRelation, updateRelation, deleteRelation } from './relationMutationService';
import { requireRole } from '../auth/middleware';
import { requirePermission } from '../auth/permissionGuard';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { logger } from '../lib/logger';

// task_mqy2aqkz: category 7 选 1 合法枚举（与 Agent relation.create 对齐）
const VALID_CATEGORIES = new Set(['Customer', 'Supplier', 'Agent', 'Partner', 'Government', 'Internal', 'Other']);

export interface RelationsRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createRelationsRouter(opts: RelationsRouterOptions): Router {
  const router = Router();

  // Shared module-level auth guard: JWT (cookie/Bearer) or API-key header.
  const guard = createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];

  // 写操作需要 JWT 认证（API key 仅用于只读）
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });

  router.get('/', async (_req, res) => {
    try {
      const rows = await (opts.prisma as any).relation.findMany({
        where: { deletedAt: null },
        orderBy: [
          { isOrganization: 'desc' },
          { lastInteraction: 'desc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
      });
      return res.json({ ok: true, relations: rows.map(serializeRelation) });
    } catch (e: any) {
      logger.error('[relations/list] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'LIST_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/query', async (req, res) => {
    try {
      const result = await queryRelations(opts.prisma, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[relations/query] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'QUERY_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.get('/:id/expand', async (req, res) => {
    try {
      const include = typeof req.query.include === 'string'
        ? req.query.include.split(',').map(item => item.trim()).filter(Boolean)
        : undefined;
      const result = await expandRelation(opts.prisma, {
        id: req.params.id,
        include,
        limit: req.query.limit,
      });
      if (!(result as any).found) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relation context not found' });
      return res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[relations/expand] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'EXPAND_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const result = await getRelation(opts.prisma, { id: req.params.id });
      if (!(result as any).found) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relation not found' });
      return res.json({ ok: true, relation: (result as any).item });
    } catch (e: any) {
      logger.error('[relations/detail] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'DETAIL_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/', requireWrite, requirePermission('relations:write'), async (req, res) => {
    const result = await createRelation({
      prisma: opts.prisma,
      input: req.body || {},
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_CATEGORY: 400, VALIDATION_FAILED: 400, NOT_FOUND: 404, CREATE_FAILED: 500, UPDATE_FAILED: 500, DELETE_FAILED: 500 };
      return res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    const saved = result.data!.relation;
    opts.onDataChange?.({ entity: 'relations', action: 'upsert', ids: [saved.id] });
    return res.json({ ok: true, relation: serializeRelation(saved) });
  });

  router.put('/:id', requireWrite, requirePermission('relations:write'), async (req, res) => {
    const result = await updateRelation({
      prisma: opts.prisma,
      relationId: req.params.id,
      input: req.body || {},
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_CATEGORY: 400, VALIDATION_FAILED: 400, NOT_FOUND: 404, CREATE_FAILED: 500, UPDATE_FAILED: 500, DELETE_FAILED: 500 };
      return res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    const saved = result.data!.relation;
    opts.onDataChange?.({ entity: 'relations', action: 'update', ids: [saved.id] });
    return res.json({ ok: true, relation: serializeRelation(saved) });
  });

  router.delete('/:id', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req, res) => {
    const result = await deleteRelation({
      prisma: opts.prisma,
      relationId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_CATEGORY: 400, VALIDATION_FAILED: 400, NOT_FOUND: 404, CREATE_FAILED: 500, UPDATE_FAILED: 500, DELETE_FAILED: 500 };
      return res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    const saved = result.data!.relation;
    opts.onDataChange?.({ entity: 'relations', action: 'delete', ids: [saved.id] });
    return res.json({ ok: true, relation: serializeRelation(saved) });
  });

  return router;
}

function toDbPayload(input: any): Record<string, unknown> {
  const coordinates = input.coordinates || {};

  // Auto-resolve coordinates when not provided
  let lat: number | null = coordinates.lat ?? null;
  let lng: number | null = coordinates.lng ?? null;

  if (lat == null || lng == null) {
    const resolved = resolveRelationCoordinates({
      officialAddress: input.officialAddress,
      factoryAddresses: Array.isArray(input.factoryAddresses) ? input.factoryAddresses.map(String) : [],
      shipToAddresses: normalizeJsonArray(input.shipToAddresses) as Array<{ city?: string; address?: string }>,
      shippingAddress: input.shippingAddress,
      country: input.country,
    });
    if (resolved) {
      if (lat == null) lat = resolved.lat;
      if (lng == null) lng = resolved.lng;
    }
  }

  return {
    id: String(input.id || `REL-${Date.now()}`),
    name: String(input.name || ''),
    category: String(input.category || 'Other'),
    type: String(input.type || input.category || 'Other'),
    isOrganization: Boolean(input.isOrganization),
    parentId: input.parentId || null,
    reportsToId: input.reportsToId || null,
    role: input.role || null,
    department: input.department || null,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    contactInfo: String(input.contactInfo || ''),
    rating: Number(input.rating || 3),
    lastInteraction: BigInt(Number(input.lastInteraction || Date.now())),
    preferences: input.preferences || '',
    deletedAt: input.deletedAt ? BigInt(Number(input.deletedAt)) : null,
    website: input.website || null,
    chineseName: input.chineseName || null,
    englishName: input.englishName || null,
    creditLevel: null,
    summary: input.summary || null,
    primaryContactName: input.primaryContactName || null,
    primaryContactEmail: input.primaryContactEmail || null,
    primaryContactPhone: input.primaryContactPhone || null,
    backupContacts: normalizeJsonArray(input.backupContacts),
    shipToAddresses: normalizeJsonArray(input.shipToAddresses),
    financialNotes: input.financialNotes || null,
    paymentTerms: input.paymentTerms || null,
    paymentPreference: input.paymentPreference || null,
    currency: input.currency || null,
    taxId: input.taxId || null,
    creditLimit: input.creditLimit ? Number(input.creditLimit) : null,
    officialAddress: input.officialAddress || null,
    factoryAddresses: Array.isArray(input.factoryAddresses) ? input.factoryAddresses.map(String) : [],
    warehouseAddress: input.warehouseAddress || null,
    billingAddress: input.billingAddress || null,
    shippingAddress: input.shippingAddress || null,
    coordinatesLat: lat,
    coordinatesLng: lng,
    phone: input.phone || null,
    mobile: input.mobile || null,
    wechat: input.wechat || null,
    whatsapp: input.whatsapp || null,
    email: input.email || null,
    otherContacts: normalizeJsonArray(input.otherContacts),
    birthday: input.birthday || null,
    language: input.language || null,
    timezone: input.timezone || null,
    personalNote: input.personalNote || null,
  };
}

function normalizeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ text: line }));
  }
}

function serializeRelation(row: any) {
  const out: any = { ...row };
  if (typeof out.lastInteraction === 'bigint') out.lastInteraction = Number(out.lastInteraction);
  if (typeof out.deletedAt === 'bigint') out.deletedAt = Number(out.deletedAt);
  if (out.coordinatesLat !== null && out.coordinatesLat !== undefined && out.coordinatesLng !== null && out.coordinatesLng !== undefined) {
    out.coordinates = { lat: out.coordinatesLat, lng: out.coordinatesLng };
  }
  delete out.coordinatesLat;
  delete out.coordinatesLng;
  return out;
}
