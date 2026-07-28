import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { resolveRelationCoordinates } from './geoResolve';
import { expandRelation, getRelation, queryRelations } from './query';
import { actorIdFromRequest } from '../audit/routeAudit';
import { createRelation, updateRelation, deleteRelation } from './relationMutationService';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';

// task_mqy2aqkz: category 7 选 1 合法枚举（与 Agent relation.create 对齐）
const VALID_CATEGORIES = new Set(['Customer', 'Supplier', 'Agent', 'Partner', 'Government', 'Internal', 'Other']);

export interface RelationsRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const PEERLESS_RELATION = {
  id: 'REL-PEERLESS-CLOTHING',
  name: 'Peerless Clothing',
  category: 'Customer',
  type: 'Customer',
  isOrganization: true,
  parentId: null,
  reportsToId: null,
  role: null,
  department: null,
  tags: ['customer', 'sample-invoice', 'canada', 'peerless-canada'],
  contactInfo: '',
  rating: 4,
  lastInteraction: BigInt(Date.now()),
  preferences: 'Peerless Canada belongs to Peerless Clothing. Sample invoice bill-to customer. Source: Panda sample invoice reference.',
  deletedAt: null,
  website: null,
  chineseName: null,
  englishName: 'Peerless Clothing',
  creditLevel: null,
  summary: 'Peerless Canada belongs to Peerless Clothing. Sample invoice bill-to customer.',
  primaryContactName: null,
  primaryContactEmail: null,
  primaryContactPhone: null,
  backupContacts: [],
  shipToAddresses: [{
    contactName: 'Peerless Clothing',
    city: 'Montreal',
    address: '8888 PIE IX Boulevard\nMONTREAL QC CA H1Z 4J5',
  }],
  financialNotes: null,
  paymentTerms: 'AS PER AGREEMENT',
  paymentPreference: null,
  currency: 'USD',
  taxId: null,
  creditLimit: null,
  officialAddress: '8888 PIE IX Boulevard\nMONTREAL QC CA H1Z 4J5',
  factoryAddresses: [],
  warehouseAddress: null,
  billingAddress: '8888 PIE IX Boulevard\nMONTREAL QC CA H1Z 4J5',
  shippingAddress: '8888 PIE IX Boulevard\nMONTREAL QC CA H1Z 4J5',
  coordinatesLat: null,
  coordinatesLng: null,
  phone: null,
  mobile: null,
  wechat: null,
  whatsapp: null,
  email: null,
  otherContacts: [],
  birthday: null,
  language: null,
  timezone: null,
  personalNote: null,
};

const PEERLESS_ALIASES = new Set([
  'rel-peerless-clothing',
  'rel-peerless-clothing-canada',
  'peerless clothing',
  'peerless clothing canada',
  'peerless canada',
]);

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
      await ensureDefaultRelations(opts.prisma);
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
      console.error('[relations/list] failed:', e);
      return res.status(500).json({ error: 'LIST_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/query', async (req, res) => {
    try {
      const result = await queryRelations(opts.prisma, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (e: any) {
      console.error('[relations/query] failed:', e);
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
      console.error('[relations/expand] failed:', e);
      return res.status(500).json({ error: 'EXPAND_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const result = await getRelation(opts.prisma, { id: req.params.id });
      if (!(result as any).found) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relation not found' });
      return res.json({ ok: true, relation: (result as any).item });
    } catch (e: any) {
      console.error('[relations/detail] failed:', e);
      return res.status(500).json({ error: 'DETAIL_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req, res) => {
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

  router.put('/:id', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req, res) => {
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

export async function ensureDefaultRelations(prisma: PrismaClient): Promise<void> {
  const relation = (prisma as any).relation;
  const existing = await relation.findMany();
  const peerlessRows = existing.filter((item: any) =>
    PEERLESS_ALIASES.has(String(item.id || '').trim().toLowerCase()) ||
    PEERLESS_ALIASES.has(String(item.name || '').trim().toLowerCase())
  );

  const activePeerlessRows = peerlessRows.filter((item: any) => !item.deletedAt);

  if (activePeerlessRows.length === 0 && peerlessRows.length > 0) {
    return;
  }

  const base = activePeerlessRows.find((item: any) => String(item.name || '').trim().toLowerCase() === 'peerless clothing') || activePeerlessRows[0];
  const merged = base
    ? {
        ...PEERLESS_RELATION,
        ...base,
        id: PEERLESS_RELATION.id,
        name: PEERLESS_RELATION.name,
        isOrganization: true,
        category: base.category || PEERLESS_RELATION.category,
        type: base.type || PEERLESS_RELATION.type,
        contactInfo: base.contactInfo || PEERLESS_RELATION.contactInfo,
        rating: Number(base.rating || PEERLESS_RELATION.rating),
        lastInteraction: BigInt(Number(base.lastInteraction || Date.now())),
        preferences: base.preferences || PEERLESS_RELATION.preferences,
        tags: Array.from(new Set([...(base.tags || []), ...PEERLESS_RELATION.tags])),
        officialAddress: base.officialAddress || PEERLESS_RELATION.officialAddress,
        billingAddress: base.billingAddress || PEERLESS_RELATION.billingAddress,
        shippingAddress: base.shippingAddress || PEERLESS_RELATION.shippingAddress,
        paymentTerms: base.paymentTerms || PEERLESS_RELATION.paymentTerms,
        currency: base.currency || PEERLESS_RELATION.currency,
      }
    : PEERLESS_RELATION;

  await relation.upsert({
    where: { id: PEERLESS_RELATION.id },
    update: merged,
    create: { ...merged, deletedAt: null },
  });

  const duplicateIds = peerlessRows
    .map((item: any) => item.id)
    .filter((id: string) => id && id !== PEERLESS_RELATION.id);

  if (duplicateIds.length > 0) {
    await relation.updateMany({
      where: { parentId: { in: duplicateIds } },
      data: { parentId: PEERLESS_RELATION.id },
    });
    await relation.updateMany({
      where: { id: { in: duplicateIds } },
      data: { deletedAt: BigInt(Date.now()) },
    });
  }
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
