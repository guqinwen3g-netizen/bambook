/**
 * relationServiceV2.ts — Phase 1-01 客户/市场域服务
 *
 * 在现有 relationMutationService.ts 基础上，接入 Phase 0 平台域 4 大能力：
 *   1. 行级权限 Scope（permissionService.getDataScopeResolver → Prisma where 过滤）
 *   2. 编号发号器（sequenceService.nextNumber → CUS-00001 / SUP-00001）
 *   3. 数据字典校验（dataDictionaryService → stage/tier 合法性）
 *   4. 系统配置默认值（systemConfigService → 默认币种/付款条款）
 *
 * DR-042 小组数据共享接入（设计真源：docs/design/03-业务规则/小组与业务数据共享.md v2.2）：
 *   - v2.2 三层视野：L1 档案图书馆化——normal 档案全公司可查；confidential 仅本人维+真全权角色
 *     （写侧解析 rule.write ?? kind：sales = all + write:self → 读图书馆、写本人维，§4.4）
 *   - L1 不消费组授权：TeamDataGrant 价值升格为 L2 业务子树互见 + 协作跟进（§5.3，
 *     消费点迁至 crmRouteV2 / orderServiceV2 / traceabilityService 的 hasBizReadAccess）
 *   - 列表项携带 teamShares 徽章（用户所在组的共享来源，§8.2）
 *   - 详情携带 accessMode（owner/team-followup/team-read，§6.2 档位）
 *     + bizVisible（v2.2 L2 业务 Tab 门控：非跟进且非团队 → 业务子树置空）
 *   - 详情页就地共享 API（shareRelationToTeams / unshareRelation / getRelationTeamShares）
 *
 * 并新增：销售漏斗聚合（按 stage 分组 count → 前端 Kanban/漏斗图渲染）
 *
 * 与现有 route.ts / relationMutationService.ts 的关系：
 *   - 现有 route.ts 的 CRUD 保持不变（向后兼容旧前端 + Agent tool 调用）
 *   - 本服务提供 V2 API（/api/v2/relations/*），面向新前端页面
 *   - V2 写操作复用 relationMutationService 的 toRelationDbPayload/toRelationUpdatePayload
 *     + 在此层叠加 scope 校验 / 编号生成 / 字典校验
 */
import type { PrismaClient } from '@prisma/client';
import type { TokenPayload } from '../auth/service';
import { createPermissionService } from '../auth/permissionService';
import { createSequenceService } from '../sequence/sequenceService';
import { getDataDictionaryService } from '../dictionaries/dataDictionaryService';
import { getSystemConfigService } from '../config/systemConfigService';
import {
  toRelationDbPayload,
  toRelationUpdatePayload,
  serializeRelation,
  VALID_RELATION_CATEGORIES,
} from '../relations/relationMutationService';
import { createTeamShareService } from '../teams/teamShareService';
import { resolveWriteKind } from '../_shared/rolePermissionMatrix';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────────
export interface RelationListFilter {
  category?: string;       // Customer / Supplier / Agent / ...
  stage?: string;          // Lead / Opportunity / Customer / Churned ...
  tier?: string;           // S / A / B / C / D / Z
  ownerId?: string;
  departmentId?: string;
  search?: string;         // name / englishName / chineseName / code 模糊搜索
  isOrganization?: boolean;
  teamId?: string;         // DR-042 §8.2 组筛选器：只看某个组的共享数据
  limit?: number;
  offset?: number;
  sort?: string;           // name / lastInteraction / rating / createdAt
}

export interface RelationListResult {
  items: any[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SalesFunnelResult {
  stages: Array<{
    stage: string;
    label: string;
    count: number;
    color?: string;
  }>;
  total: number;
  filter: { category?: string; tier?: string };
}

export interface CreateRelationInput {
  name: string;
  category: string;       // Customer / Supplier / Agent / Partner / Government / Internal / Other
  type?: string;
  isOrganization?: boolean;
  stage?: string;
  tier?: string;
  ownerId?: string;
  departmentId?: string;
  // ...其余字段透传 toRelationDbPayload
  [key: string]: unknown;
}

export interface UpdateRelationInput {
  stage?: string;
  tier?: string;
  ownerId?: string;
  departmentId?: string;
  [key: string]: unknown;
}

export type RelationV2Error =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'SEQUENCE_FAILED'
  | 'INTERNAL_ERROR';

export interface RelationV2Result<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: RelationV2Error; message: string };
}

// ────────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────────
export function createRelationServiceV2(prisma: PrismaClient) {
  const permSvc = createPermissionService({ prisma });
  const seqSvc = createSequenceService(prisma);
  const dictSvc = getDataDictionaryService(prisma);
  const configSvc = getSystemConfigService(prisma);
  const teamShareSvc = createTeamShareService(prisma);

  // ── 行级权限 where 构造（v2.2 DR-042 §5.1 三层视野）──
  // L1 档案层（图书馆）：normal 档案全公司可查；confidential 仅本人维 + 真全权角色。
  // 真全权角色 = 写侧 kind 为 all（财务/QC/后勤/admin/超管）；sales = all+write:self
  // → 图书馆全可见 + confidential 收窄 + 写本人维。
  // L1 不消费组授权（组授权价值已升格为 L2 业务子树互见 + 协作跟进，§5.3）。
  async function buildScopeWhere(actor: TokenPayload | null | undefined): Promise<Record<string, unknown>> {
    if (!actor) return { ownerId: '__NOBODY__' }; // 未登录 → 看不到任何数据
    const resolver = await permSvc.getDataScopeResolver(actor, 'relations');
    if (resolveWriteKind(resolver.rule) === 'all') return {}; // 真全权角色：全量（含 confidential）
    // 图书馆口径：normal 全查 + confidential 仅跟进人可见（T-33/T-34）
    //（sensitivity 非 nullable 且 db push 已回填 'normal'，无需 null 历史分支）
    return {
      OR: [
        { sensitivity: 'normal' },
        {
          AND: [
            { sensitivity: 'confidential' },
            { OR: [{ ownerId: actor.userId }, { salesRepIds: { has: actor.userId } }] },
          ],
        },
      ],
    };
  }

  /**
   * 写 scope（v2.2 DR-042 §4.4 读写分离）：解析 rule.write ?? kind。
   * 真全权角色 → 全量可写；sales/self → 跟进人（ownerId ∨ salesRepIds）；
   * department 分支保留仅防 resolver 口径回退（防御性）。
   * 读写的分离是防越权核心：图书馆可见 ≠ 可改（T-40）。
   */
  async function buildWriteScopeWhere(actor: TokenPayload | null | undefined): Promise<Record<string, unknown>> {
    if (!actor) return { ownerId: '__NOBODY__' };
    const resolver = await permSvc.getDataScopeResolver(actor, 'relations');
    const writeKind = resolveWriteKind(resolver.rule);
    if (writeKind === 'all') return {};
    if (writeKind === 'self') {
      return { OR: [{ ownerId: actor.userId }, { salesRepIds: { has: actor.userId } }] };
    }
    // department（防御分支：仅当 hr 豁免口径被误用到 relations 时仍按部门维兜底）
    const deptIds = resolver.allowedDepartmentIds || [];
    const userIds = resolver.allowedUserIds || [];
    const orParts: any[] = [];
    if (userIds.length > 0) {
      orParts.push({ ownerId: { in: userIds } });
      orParts.push({ salesRepIds: { hasSome: userIds } });
    }
    if (deptIds.length > 0) {
      orParts.push({ departmentId: { in: deptIds } });
    }
    if (orParts.length === 0) return { ownerId: '__NOBODY__' };
    return { OR: orParts };
  }

  // ── 字典校验 ──
  async function validateDictField(dictCode: string, value: string | undefined): Promise<string | null> {
    if (!value) return null;
    const entries = await dictSvc.getEntries(dictCode, { enabledOnly: false });
    if (entries.length === 0) return null; // 字典尚未 seed → 跳过校验（fail open，避免阻塞）
    const found = entries.find((e) => e.key === value);
    if (!found) return `值 "${value}" 不在字典 ${dictCode} 的合法枚举中`;
    if (found.disabled) return `值 "${value}" 已被禁用`;
    return null;
  }

  // ── 编号生成 ──
  async function generateRelationCode(category: string): Promise<string | null> {
    try {
      const seqType = category === 'Supplier' || category === 'Factory' ? 'supplier' : 'customer';
      const number = await seqSvc.nextNumber(prisma as any, seqType);
      return number;
    } catch (e: any) {
      logger.error('[RelationV2] 编号生成失败，回退 null', { category, error: e?.message });
      return null;
    }
  }

  // ── 系统配置默认值 ──
  async function applyConfigDefaults(input: CreateRelationInput): Promise<CreateRelationInput> {
    const merged = { ...input };
    if (!merged.currency) {
      const cfg = await configSvc.getString('finance.defaultCurrency', 'CNY');
      merged.currency = cfg;
    }
    if (!merged.paymentTerms) {
      const cfg = await configSvc.getString('finance.defaultPaymentTerms', 'TT_30_PRE');
      merged.paymentTerms = cfg;
    }
    return merged;
  }

  // ══════════════════════════════════════════════════════════════════
  // 1. 列表查询（带行级权限 + 筛选 + 分页）
  // ══════════════════════════════════════════════════════════════════
  async function listRelations(
    actor: TokenPayload | null | undefined,
    filter: RelationListFilter = {},
  ): Promise<RelationV2Result<RelationListResult>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const where: Record<string, unknown> = {
        deletedAt: null,
        ...scopeWhere,
      };
      if (filter.category) where.category = filter.category;
      if (filter.stage) where.stage = filter.stage;
      if (filter.tier) where.tier = filter.tier;
      if (filter.ownerId) where.ownerId = filter.ownerId;
      if (filter.departmentId) where.departmentId = filter.departmentId;
      if (filter.teamId) {
        // DR-042 §8.2 组筛选器：只看某个组的共享数据（与 scope 求交）
        const teamGrantIds = await (prisma as any).teamDataGrant.findMany({
          where: { teamId: filter.teamId, entityType: 'relation', revokedAt: null, team: { deletedAt: null } },
          select: { entityId: true },
        });
        where.id = { in: teamGrantIds.map((g: any) => g.entityId) };
      }
      if (filter.isOrganization !== undefined) where.isOrganization = filter.isOrganization;
      if (filter.search) {
        const s = filter.search.trim();
        if (s) {
          (where as any).OR = [
            ...(where.OR ? (where.OR as any[]) : []),
            { name: { contains: s, mode: 'insensitive' } },
            { englishName: { contains: s, mode: 'insensitive' } },
            { chineseName: { contains: s, mode: 'insensitive' } },
            { code: { contains: s, mode: 'insensitive' } },
          ];
        }
      }

      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
      const offset = Math.max(filter.offset ?? 0, 0);
      const orderBy: any[] = [];
      const sortMap: Record<string, string> = {
        name: 'name',
        lastInteraction: 'lastInteraction',
        rating: 'rating',
        createdAt: 'createdAt',
      };
      if (filter.sort && sortMap[filter.sort]) {
        orderBy.push({ [sortMap[filter.sort]]: 'desc' });
      } else {
        orderBy.push({ isOrganization: 'desc' }, { lastInteraction: 'desc' }, { name: 'asc' });
      }

      const [items, total] = await Promise.all([
        (prisma as any).relation.findMany({ where, orderBy, take: limit, skip: offset }),
        (prisma as any).relation.count({ where }),
      ]);

      // DR-042 §8.2 徽章：标注每项经用户所在组的共享来源（部门维项为空数组=显示「本部门」）
      const serialized = items.map(serializeRelation);
      let annotated = serialized;
      try {
        if (actor) {
          const itemIds = serialized.map((i: any) => i.id).filter(Boolean);
          const shareMap = await teamShareSvc.getMyTeamSharesForEntities(actor.userId, 'relation', itemIds);
          annotated = serialized.map((i: any) => ({
            ...i,
            teamShares: (shareMap.get(i.id) || []).map(chip => ({
              teamId: chip.teamId, teamName: chip.teamName, permission: chip.permission,
            })),
          }));
        }
      } catch (e: any) {
        logger.warn('[RelationV2] teamShares badge annotate failed（不影响列表）', { error: e?.message });
      }

      return {
        ok: true,
        data: {
          items: annotated,
          total,
          limit,
          offset,
          hasMore: offset + items.length < total,
        },
      };
    } catch (e: any) {
      logger.error('[RelationV2] list failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. 详情（带行级权限校验）
  // ══════════════════════════════════════════════════════════════════
  async function getRelation(
    actor: TokenPayload | null | undefined,
    id: string,
  ): Promise<RelationV2Result<any>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const row = await (prisma as any).relation.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
      });
      if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: '客户/实体不存在或无权限查看' } };
      // DR-042 §6.2/§8.3：访问档位（前端按档位渲染跟进输入框）+ 共享 chips。
      // 档位解析失败按最严格档（none）——写门禁 fail-closed；chips 失败降级为空——展示元数据 fail-soft。
      let accessMode = 'none';
      let teamShares: any[] = [];
      try { accessMode = await teamShareSvc.resolveRelationAccess(actor, id); } catch { /* fail-closed */ }
      try { teamShares = await teamShareSvc.getEntityTeamShares('relation', id); } catch { /* fail-soft */ }
      return { ok: true, data: { ...serializeRelation(row), accessMode, teamShares } };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. 创建（编号生成 + 字典校验 + 配置默认值 + ownerId 自动填充）
  // ══════════════════════════════════════════════════════════════════
  async function createRelation(
    actor: TokenPayload | null | undefined,
    input: CreateRelationInput,
  ): Promise<RelationV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '创建客户需登录' } };
      if (!input.name?.trim()) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'name 必填' } };
      const category = input.category?.trim() || 'Customer';
      if (!VALID_RELATION_CATEGORIES.has(category)) {
        return { ok: false, error: { code: 'VALIDATION_FAILED', message: `category 必须是: ${[...VALID_RELATION_CATEGORIES].join(', ')}` } };
      }

      // 字典校验 stage / tier
      if (input.stage) {
        const err = await validateDictField('relation_stage', input.stage);
        if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `stage ${err}` } };
      }
      if (input.tier) {
        const err = await validateDictField('relation_tier', input.tier);
        if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `tier ${err}` } };
      }

      // 配置默认值
      const withDefaults = await applyConfigDefaults(input);

      // 编号生成（如果 input.code 未传则自动生成）
      let code = (input as any).code || null;
      if (!code) {
        code = await generateRelationCode(category);
      }

      // ownerId / departmentId 自动填充（从 actor）
      const ownerId = input.ownerId || actor.userId;
      const departmentId = input.departmentId || actor.departmentIds?.[0] || null;
      const stage = input.stage || 'Customer';

      // 构建 payload（复用现有 toRelationDbPayload）
      const payload = toRelationDbPayload({ ...withDefaults, category, code, ownerId, departmentId, stage });
      if (!payload.id || payload.id === `REL-${Date.now()}`) {
        payload.id = `REL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
      payload.tier = input.tier || null;
      payload.salesRepIds = Array.isArray((input as any).salesRepIds) ? (input as any).salesRepIds : (ownerId ? [ownerId] : []);

      const rel = await (prisma as any).relation.upsert({
        where: { id: payload.id },
        update: payload,
        create: payload,
      });

      logger.info('[RelationV2] created', { id: rel.id, code, category, stage, ownerId });
      return { ok: true, data: serializeRelation(rel) };
    } catch (e: any) {
      logger.error('[RelationV2] create failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. 更新（权限校验 + 字典校验）
  // ══════════════════════════════════════════════════════════════════
  async function updateRelation(
    actor: TokenPayload | null | undefined,
    id: string,
    input: UpdateRelationInput,
  ): Promise<RelationV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '更新客户需登录' } };

      // 权限校验：写 scope（DR-042 §6.2 仅部门维——组共享不开放本体写，T-19）
      const scopeWhere = await buildWriteScopeWhere(actor);
      const existing = await (prisma as any).relation.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
      });
      if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: '客户/实体不存在或无权限操作' } };

      // 字典校验
      if (input.stage) {
        const err = await validateDictField('relation_stage', input.stage);
        if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `stage ${err}` } };
      }
      if (input.tier) {
        const err = await validateDictField('relation_tier', input.tier);
        if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `tier ${err}` } };
      }

      // 复用现有 toRelationUpdatePayload + 叠加新字段
      const payload = toRelationUpdatePayload(input);
      if (input.stage !== undefined) payload.stage = input.stage;
      if (input.tier !== undefined) payload.tier = input.tier;
      if (input.ownerId !== undefined) payload.ownerId = input.ownerId || null;
      if (input.departmentId !== undefined) payload.departmentId = input.departmentId || null;
      if (input.salesRepIds !== undefined) payload.salesRepIds = Array.isArray(input.salesRepIds) ? input.salesRepIds.map(String) : [];

      // v2.2（DR-042 §4.4）：敏感标记变更审计（relation_sensitivity_change，含新旧值）
      if (input.sensitivity !== undefined) {
        const before = String((existing as any).sensitivity || 'normal');
        const after = input.sensitivity === 'confidential' ? 'confidential' : 'normal';
        if (before !== after) {
          await (prisma as any).auditLog.create({
            data: {
              id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              actorId: actor.userId,
              action: 'relation_sensitivity_change',
              targetType: 'Relation',
              targetId: id,
              detail: { from: before, to: after },
            },
          }).catch(() => undefined);
        }
      }

      const updated = await (prisma as any).relation.update({ where: { id }, data: payload });
      logger.info('[RelationV2] updated', { id, stage: input.stage, tier: input.tier });
      return { ok: true, data: serializeRelation(updated) };
    } catch (e: any) {
      logger.error('[RelationV2] update failed', { id, error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. 删除（软删除 + 权限校验）
  // ══════════════════════════════════════════════════════════════════
  async function deleteRelation(
    actor: TokenPayload | null | undefined,
    id: string,
  ): Promise<RelationV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '删除客户需登录' } };
      // 写 scope（DR-042 §6.2 仅部门维）
      const scopeWhere = await buildWriteScopeWhere(actor);
      const existing = await (prisma as any).relation.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        select: { id: true, name: true, code: true },
      });
      if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: '客户/实体不存在或无权限操作' } };

      const now = BigInt(Date.now());
      const del = await (prisma as any).relation.update({ where: { id }, data: { deletedAt: now } });
      logger.info('[RelationV2] soft-deleted', { id, name: existing.name });
      return { ok: true, data: serializeRelation(del) };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 6. 销售漏斗聚合（按 stage 分组 count）
  // ══════════════════════════════════════════════════════════════════
  async function getSalesFunnel(
    actor: TokenPayload | null | undefined,
    filter: { category?: string; tier?: string } = {},
  ): Promise<RelationV2Result<SalesFunnelResult>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const where: Record<string, unknown> = {
        deletedAt: null,
        category: filter.category || 'Customer',
        ...scopeWhere,
      };
      if (filter.tier) where.tier = filter.tier;

      // 按 stage 分组 count
      const rows = await (prisma as any).relation.findMany({
        where,
        select: { stage: true },
      });
      const stageCounts = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const s = r.stage || 'Customer';
        stageCounts.set(s, (stageCounts.get(s) || 0) + 1);
        total++;
      }

      // 从 DataDictionary 获取 stage 的 label/color/order
      const entries = await dictSvc.getEntries('relation_stage', { enabledOnly: false });
      const stageOrderMap = new Map(entries.map((e) => [e.key, e]));
      const allStages = entries.length > 0
        ? entries.map((e) => e.key)
        : ['Lead', 'Opportunity', 'Quotation', 'TrialOrder', 'Customer', 'Key', 'Churned'];

      const stages = allStages
        .map((key) => {
          const meta = stageOrderMap.get(key);
          return {
            stage: key,
            label: meta?.label || key,
            count: stageCounts.get(key) || 0,
            color: meta?.color,
          };
        })
        .sort((a, b) => {
          const oa = stageOrderMap.get(a.stage)?.order ?? 99;
          const ob = stageOrderMap.get(b.stage)?.order ?? 99;
          return oa - ob;
        });

      return {
        ok: true,
        data: { stages, total, filter: { category: filter.category, tier: filter.tier } },
      };
    } catch (e: any) {
      logger.error('[RelationV2] salesFunnel failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 7. 阶段变更（拖拽 Kanban → 移动客户到新阶段）
  // ══════════════════════════════════════════════════════════════════
  async function changeStage(
    actor: TokenPayload | null | undefined,
    id: string,
    newStage: string,
  ): Promise<RelationV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '变更阶段需登录' } };
      // 字典校验
      const err = await validateDictField('relation_stage', newStage);
      if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `stage ${err}` } };

      // 写 scope（DR-042 §6.2 仅部门维——组员不可拖拽共享客户的阶段，T-19）
      const scopeWhere = await buildWriteScopeWhere(actor);
      const existing = await (prisma as any).relation.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        select: { id: true, stage: true, name: true },
      });
      if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: '客户不存在或无权限操作' } };

      const updated = await (prisma as any).relation.update({
        where: { id },
        data: { stage: newStage, lastInteraction: BigInt(Date.now()) },
      });
      logger.info('[RelationV2] stage changed', { id, from: existing.stage, to: newStage });
      return { ok: true, data: serializeRelation(updated) };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 8. 360° 客户视图（跨域聚合：Relation + Contacts + FollowUps +
  //    Opportunities + CreditLimit + CustomerTier + Orders + Invoices + Payments）
  // ══════════════════════════════════════════════════════════════════
  async function get360View(
    actor: TokenPayload | null | undefined,
    id: string,
  ): Promise<RelationV2Result<any>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const rel = await (prisma as any).relation.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        include: {
          contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
          creditLimits: { where: { deletedAt: null, status: 'active' }, take: 1, orderBy: { createdAt: 'desc' } },
          followUpRecords: { where: { deletedAt: null }, take: 20, orderBy: { followUpAt: 'desc' } },
          opportunities: { where: { deletedAt: null }, take: 20, orderBy: { createdAt: 'desc' } },
          customerTiers: { where: { deletedAt: null }, take: 1, orderBy: { createdAt: 'desc' } },
          factoryProfile: true,
        },
      });
      if (!rel) return { ok: false, error: { code: 'NOT_FOUND', message: '客户不存在或无权限查看' } };

      // v2.2（DR-042 §5.1）：360 视图分层——档案本体随 L1 图书馆可见；
      // 业务子树（订单/发票/收付/跟进/商机/联系人/信用）随 L2 跟进客户锚定，
      // 非跟进且非团队 → 业务数据置空 + bizVisible=false（前端渲染空态，T-37）
      const bizVisible = actor
        ? await teamShareSvc.hasBizReadAccess(actor, id).catch(() => false)
        : false;

      // 跨域聚合：订单 + 发票 + 收付款（仅 L2 可见时查询）
      const [orders, invoices, payments] = bizVisible ? await Promise.all([
        (prisma as any).order.findMany({
          where: { customerRelationId: id, deletedAt: null },
          select: { id: true, code: true, status: true, type: true, product: true, quantity: true, quoteAmount: true, dueDate: true, createdAt: true },
          take: 50,
          orderBy: { createdAt: 'desc' },
        }),
        (prisma as any).invoice.findMany({
          where: { customerRelationId: id, deletedAt: null },
          select: { id: true, invoiceNumber: true, type: true, status: true, amount: true, currency: true, issueDate: true, dueDate: true },
          take: 50,
          orderBy: { createdAt: 'desc' },
        }),
        (prisma as any).paymentVoucher.findMany({
          where: { customerRelationId: id, deletedAt: null },
          select: { voucherNumber: true, type: true, status: true, amount: true, currency: true, paymentDate: true },
          take: 50,
          orderBy: { createdAt: 'desc' },
        }),
      ]) : [[], [], []];

      // 统计汇总
      const orderCount = orders.length;
      const totalOrderAmount = orders.reduce((sum: number, o: any) => sum + Number(o.quoteAmount?.toString?.() || o.quoteAmount || 0), 0);
      const arInvoices = invoices.filter((i: any) => i.type === 'Receivable');
      const arTotal = arInvoices.reduce((sum: number, i: any) => sum + Number(i.amount?.toString?.() || i.amount || 0), 0);
      const receipts = payments.filter((p: any) => p.type === 'Receipt');
      const receiptTotal = receipts.reduce((sum: number, p: any) => sum + Number(p.amount?.toString?.() || p.amount || 0), 0);
      const outstanding = Math.max(0, arTotal - receiptTotal);

      // 跟进统计
      const pendingFollowUps = rel.followUpRecords?.filter((f: any) => f.nextFollowUpAt && new Date(f.nextFollowUpAt) < new Date()) || [];
      const activeOpportunities = rel.opportunities?.filter((o: any) => !['Won', 'Lost'].includes(o.stage)) || [];

      // DR-042 §6.2/§8.3：访问档位 + 共享 chips（跟进输入框按 accessMode 渲染；
      // 档位解析失败按最严格档——写门禁 fail-closed；chips 失败降级为空——fail-soft）
      let accessMode = 'none';
      let teamShares: any[] = [];
      try { accessMode = await teamShareSvc.resolveRelationAccess(actor, id); } catch { /* fail-closed */ }
      try { teamShares = await teamShareSvc.getEntityTeamShares('relation', id); } catch { /* fail-soft */ }

      // 序列化 BigInt/Decimal
      const serializeRow = (row: any) => {
        const out: any = { ...row };
        for (const k of Object.keys(out)) {
          if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
          if (out[k] && typeof out[k] === 'object' && out[k].toString) out[k] = Number(out[k].toString());
        }
        return out;
      };

      return {
        ok: true,
        data: {
          relation: serializeRow(rel),
          accessMode,       // DR-042 v2.1：owner / team-followup / team-read
          teamShares,       // DR-042：详情页共享 chips
          bizVisible,       // v2.2（DR-042 §5.1）：L2 业务 Tab 门控（false → 前端空态「仅跟进人与协作组可见」）
          contacts: bizVisible ? (rel.contacts || []).map(serializeRow) : [],
          creditLimit: bizVisible && rel.creditLimits?.[0] ? serializeRow(rel.creditLimits[0]) : null,
          customerTier: bizVisible && rel.customerTiers?.[0] ? serializeRow(rel.customerTiers[0]) : null,
          factoryProfile: bizVisible && rel.factoryProfile ? serializeRow(rel.factoryProfile) : null,
          recentFollowUps: bizVisible ? (rel.followUpRecords || []).map(serializeRow) : [],
          recentOpportunities: bizVisible ? (rel.opportunities || []).map(serializeRow) : [],
          orders: orders.map(serializeRow),
          invoices: invoices.map(serializeRow),
          payments: payments.map(serializeRow),
          summary: bizVisible ? {
            orderCount,
            totalOrderAmount,
            arTotal,
            receiptTotal,
            outstanding,
            pendingFollowUpCount: pendingFollowUps.length,
            activeOpportunityCount: activeOpportunities.length,
            contactCount: rel.contacts?.length || 0,
          } : null,
        },
      };
    } catch (e: any) {
      logger.error('[RelationV2] 360view failed', { id, error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 9. 批量阶段变更（Kanban 拖拽多选）
  // ══════════════════════════════════════════════════════════════════
  async function batchChangeStage(
    actor: TokenPayload | null | undefined,
    ids: string[],
    newStage: string,
  ): Promise<RelationV2Result<{ updated: number; failed: number }>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '批量变更需登录' } };
      const err = await validateDictField('relation_stage', newStage);
      if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `stage ${err}` } };

      // 写 scope（DR-042 §6.2 仅部门维）
      const scopeWhere = await buildWriteScopeWhere(actor);
      let updated = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const existing = await (prisma as any).relation.findFirst({
            where: { id, deletedAt: null, ...scopeWhere },
            select: { id: true },
          });
          if (!existing) { failed++; continue; }
          await (prisma as any).relation.update({
            where: { id },
            data: { stage: newStage, lastInteraction: BigInt(Date.now()) },
          });
          updated++;
        } catch { failed++; }
      }
      logger.info('[RelationV2] batch stage change', { ids: ids.length, newStage, updated, failed });
      return { ok: true, data: { updated, failed } };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 10. DR-042 小组共享（详情页就地共享 API，§7）
  // ══════════════════════════════════════════════════════════════════

  /** 反查该客户共享给了哪些组（chips 数据；权限=该数据可见者） */
  async function getRelationTeamShares(
    actor: TokenPayload | null | undefined,
    id: string,
  ): Promise<RelationV2Result<any>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const row = await (prisma as any).relation.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        select: { id: true },
      });
      if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: '客户/实体不存在或无权限查看' } };
      const shares = await teamShareSvc.getEntityTeamShares('relation', id);
      return { ok: true, data: shares };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  /**
   * 详情页就地共享：等价 grants 批量接口的便捷封装（§7 POST /:id/team-shares）。
   * 多组共享 = 逐组调用授权引擎（单组内部事务整批回滚；跨组首个失败即中止，
   * 已成功组保持生效——授权幂等，重试安全）。
   */
  async function shareRelationToTeams(
    actor: TokenPayload | null | undefined,
    id: string,
    input: { teamIds: string[]; permission?: 'read' | 'read+followup' },
    ip?: string | null,
  ): Promise<RelationV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '共享客户需登录' } };
      const teamIds = Array.isArray(input?.teamIds) ? input.teamIds.filter(Boolean) : [];
      if (teamIds.length === 0) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'teamIds 必填' } };
      const permission = input.permission || 'read+followup';

      let granted = 0;
      for (const teamId of teamIds) {
        const result = await teamShareSvc.grantEntitiesToTeam(
          actor, teamId,
          [{ entityType: 'relation', entityId: id, permission }],
          ip,
        );
        if (!result.ok) {
          const code = result.error!.code as RelationV2Error;
          const msg = granted > 0
            ? `${result.error!.message}（前 ${granted} 个组已生效，重试安全）`
            : result.error!.message;
          return { ok: false, error: { code, message: msg } };
        }
        granted += result.data?.granted || 0;
      }
      return { ok: true, data: { granted } };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  /** 详情页就地移除共享（§8.3 chips ✕） */
  async function unshareRelationFromTeam(
    actor: TokenPayload | null | undefined,
    id: string,
    teamId: string,
    reason: string,
    ip?: string | null,
  ): Promise<RelationV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '移除共享需登录' } };
      const result = await teamShareSvc.revokeGrant(actor, teamId, 'relation', id, reason, ip);
      if (!result.ok) {
        const code = result.error!.code as RelationV2Error;
        return { ok: false, error: { code, message: result.error!.message } };
      }
      return { ok: true, data: result.data };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
    }
  }

  return {
    listRelations,
    getRelation,
    createRelation,
    updateRelation,
    deleteRelation,
    getSalesFunnel,
    changeStage,
    get360View,
    batchChangeStage,
    // DR-042 小组共享
    getRelationTeamShares,
    shareRelationToTeams,
    unshareRelationFromTeam,
    // 供路由直接调用
    buildScopeWhere,
    buildWriteScopeWhere,
    validateDictField,
  };
}

// ────────────────────────────────────────────────────────────────────
// 单例
// ────────────────────────────────────────────────────────────────────
let _defaultService: ReturnType<typeof createRelationServiceV2> | null = null;
export function getRelationServiceV2(prisma: PrismaClient): ReturnType<typeof createRelationServiceV2> {
  if (!_defaultService) _defaultService = createRelationServiceV2(prisma);
  return _defaultService;
}
