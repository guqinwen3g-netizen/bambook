/**
 * orderServiceV2.ts — Phase 1-02 订单/履约域服务
 *
 * 在现有 route.ts / orderLifecycleService.ts 基础上，接入 Phase 0 平台域 4 大能力：
 *   1. 行级权限 Scope（permissionService.getDataScopeResolver → Prisma where 过滤）
 *   2. 编号发号器（sequenceService.nextNumber → SO-202608-001）
 *   3. 数据字典校验（dataDictionaryService → order_status / order_type 合法性）
 *   4. 系统配置默认值（systemConfigService → 默认币种/付款条款/Incoterms）
 *
 * 状态机复用现有 orderLifecycleService.ts 的 6 状态矩阵：
 *   Pending → Confirmed → Production → Shipping → Delivered（终态）
 *   任意阶段 → Alert（异常旁路）→ 恢复到非终态
 *
 * 与 V1 路由的关系：V1 保持不变（向后兼容），V2 面向新前端页面
 */
import type { PrismaClient } from '@prisma/client';
import type { TokenPayload } from '../auth/service';
import { createPermissionService } from '../auth/permissionService';
import { createSequenceService } from '../sequence/sequenceService';
import { getDataDictionaryService } from '../dictionaries/dataDictionaryService';
import { getSystemConfigService } from '../config/systemConfigService';
import {
  VALID_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  transitionOrderStatus,
} from './orderLifecycleService';
import { logger } from '../lib/logger';
import { createCreditService } from '../credit/creditService';
import { createMoqConfigService } from '../moq/moqConfigService';
import { createMoqResolutionService } from '../moq/moqResolutionService';
import { createMoqValidationService, isCapsuleEligible } from '../moq/moqValidationService';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import { createTeamShareService } from '../teams/teamShareService';

/**
 * Order 模型可选业务字段白名单（创建/更新共用）。
 * 根因修复：此前 createOrder 全量透传客户端字段，任何 Prisma 不认识的字段
 * （如 unitPrice）都会导致 order.create 抛 Unknown argument → 500。
 */
const ORDER_OPTIONAL_FIELDS = [
  'customer', 'product', 'type', 'quantity', 'dueDate', 'quoteAmount',
  'currency', 'paymentTerms', 'deliveryTerms', 'customerRelationId',
  'businessLine', 'ownerId', 'departmentId', 'salesPerson', 'merchandiser',
  'supervisor', 'productionBatch', 'productionDate', 'clientDate',
  'specialInstructions', 'poNumber', 'season', 'contactPerson', 'contactPhone',
  'shipToName', 'shipToAddress1', 'shipToAddress2', 'shipToCountry', 'shipToPhone',
  'deliverTo', 'salesContractNumber', 'finalContractNumber',
  'capsuleExemption', 'capsuleExemptionBy', 'capsuleExemptionAt',
  'salesPrice', 'contractAmount', 'salesCurrency', 'purchaseCurrency',
  'millName', 'millRelationId', 'millContact', 'millPhone', 'millAddress',
  'consigneeName', 'consigneeAddress', 'consigneeContact', 'consigneeRelationId',
  'billToName', 'billToAddress', 'billToContact', 'billToRelationId',
  'salesPersonRelationId', 'merchandiserRelationId', 'supervisorRelationId',
  'customerCode',
] as const;

// ────────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────────
export interface OrderListFilter {
  status?: string;
  type?: string;            // Fabric / Apparel / HomeText / Accessory / Other
  ownerId?: string;
  departmentId?: string;
  customerCode?: string;
  customerRelationId?: string;
  businessLine?: string;
  search?: string;          // customer / product / code / poNumber 模糊搜索
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  sort?: string;            // createdAt / dueDate / status / quoteAmount
  /** Excel 台账导出=true：忽略分页上限全量导出（route 层 format=xlsx 专用） */
  exportAll?: boolean;
}

export interface OrderListResult {
  items: any[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface OrderKanbanResult {
  statuses: Array<{
    status: string;
    label: string;
    count: number;
    color?: string;
  }>;
  total: number;
}

export interface CreateOrderInput {
  customer: string;
  product: string;
  type: string;
  quantity: number;
  status?: string;
  dueDate: string;
  quoteAmount: number;
  ownerId?: string;
  departmentId?: string;
  customerRelationId?: string;
  currency?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  businessLine?: string;
  [key: string]: unknown;
}

export type OrderV2Error =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'SEQUENCE_FAILED'
  | 'MOQ_VIOLATION'
  | 'CREDIT_FROZEN_60_DAYS'
  | 'CREDIT_REVOKED'
  | 'OVERDUE_60_DAYS'
  | 'CREDIT_CHECK_FAILED'
  | 'INTERNAL_ERROR';

export interface OrderV2Result<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: OrderV2Error; message: string; approvalRequestId?: string };
}

// ────────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────────
export function createOrderServiceV2(prisma: PrismaClient) {
  const permSvc = createPermissionService({ prisma });
  const seqSvc = createSequenceService(prisma);
  const dictSvc = getDataDictionaryService(prisma);
  const configSvc = getSystemConfigService(prisma);
  // v2.2（DR-042 §5.1 L2）：订单可见性锚 = 跟进客户 ∪ 团队共享（teamShareSvc 解析）
  const teamShareSvc = createTeamShareService(prisma);
  // MOQ 域服务（配置 → 取数 → 校验；豁免审批单统一经 approvalCreateService，DR-007 服务端解析 reviewerId）
  const moqConfigSvc = createMoqConfigService({ prisma });
  const moqResolutionSvc = createMoqResolutionService({ prisma, configService: moqConfigSvc });
  const moqValidationSvc = createMoqValidationService({
    prisma,
    configService: moqConfigSvc,
    resolutionService: moqResolutionSvc,
    approvalCreateService: createApprovalCreateService({
      prisma,
      routingService: createApprovalRoutingService({ prisma }),
    }),
  });
  // 信用域统一服务（Track F）：建单门禁 fail-closed 接线（W-A 走查 DE-1 修复）
  const creditSvc = createCreditService({ prisma });

  // ── 行级权限 where 构造（v2.2 DR-042 §5.1 L2 换锚）──
  // 订单可见性锚 = 宿主客户的跟进人（followedBy）∪ 团队共享客户 ∪ 真全权角色；
  // 客户转让（ownerId/salesRepIds 变更）后历史订单视野自动继承（T-38）。
  // 无客户锚的遗留订单（customerRelationId=null）回退创建者可见。
  async function buildScopeWhere(actor: TokenPayload | null | undefined): Promise<Record<string, unknown>> {
    if (!actor) return { ownerId: '__NOBODY__' };
    const resolver = await permSvc.getDataScopeResolver(actor, 'orders');
    if (resolver.rule.kind === 'all') return {};
    const visibleRelationIds = await teamShareSvc.resolveVisibleRelationIds(actor);
    return {
      OR: [
        { customerRelationId: { in: visibleRelationIds } },
        { AND: [{ customerRelationId: null }, { ownerId: actor.userId }] },
      ],
    };
  }

  // ── 订单写 scope（v2.2 DR-042 §5.3）：创建者 ∪ 宿主客户跟进人 ∪ 真全权角色 ──
  async function buildOrderWriteScopeWhere(actor: TokenPayload | null | undefined): Promise<Record<string, unknown>> {
    if (!actor) return { ownerId: '__NOBODY__' };
    const resolver = await permSvc.getDataScopeResolver(actor, 'orders');
    if (resolver.rule.kind === 'all') return {};
    const followedIds = await (prisma as any).relation.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: actor.userId }, { salesRepIds: { has: actor.userId } }],
      },
      select: { id: true },
    });
    return {
      OR: [
        { ownerId: actor.userId },
        { customerRelationId: { in: followedIds.map((r: any) => r.id) } },
      ],
    };
  }

  // ── 字典校验 ──
  async function validateDictField(dictCode: string, value: string | undefined): Promise<string | null> {
    if (!value) return null;
    const entries = await dictSvc.getEntries(dictCode, { enabledOnly: false });
    if (entries.length === 0) return null;
    const found = entries.find((e) => e.key === value);
    if (!found) return `值 "${value}" 不在字典 ${dictCode} 的合法枚举中`;
    if (found.disabled) return `值 "${value}" 已被禁用`;
    return null;
  }

  // ── 编号生成 ──
  async function generateOrderCode(): Promise<string | null> {
    try {
      const number = await seqSvc.nextNumber(prisma as any, 'order');
      return number;
    } catch (e: any) {
      logger.error('[OrderV2] 编号生成失败', { error: e?.message });
      return null;
    }
  }

  // ── 配置默认值 ──
  async function applyConfigDefaults(input: CreateOrderInput): Promise<CreateOrderInput> {
    const merged = { ...input };
    if (!merged.currency) {
      merged.currency = await configSvc.getString('finance.defaultTradeCurrency', 'USD');
    }
    if (!merged.paymentTerms) {
      merged.paymentTerms = await configSvc.getString('finance.defaultPaymentTerms', 'TT_30_PRE');
    }
    if (!merged.deliveryTerms) {
      merged.deliveryTerms = await configSvc.getString('logistics.defaultIncoterm', 'FOB');
    }
    return merged;
  }

  // ── BigInt 序列化 ──
  function serializeOrder(row: any): any {
    const out: any = { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
    }
    if (out.quoteAmount && typeof out.quoteAmount === 'object' && out.quoteAmount.toString) {
      out.quoteAmount = Number(out.quoteAmount.toString());
    }
    // Decimal fields
    for (const k of ['totalNet', 'totalActual', 'salesPrice', 'contractAmount', 'actualPaymentAmount',
      'shipmentAmount', 'purchasePrice', 'supplierInvoiceAmount']) {
      if (out[k] && typeof out[k] === 'object' && out[k].toString) {
        out[k] = Number(out[k].toString());
      }
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════
  // 1. 列表查询（带行级权限 + 筛选 + 分页）
  // ══════════════════════════════════════════════════════════════════
  async function listOrders(
    actor: TokenPayload | null | undefined,
    filter: OrderListFilter = {},
  ): Promise<OrderV2Result<OrderListResult>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const where: Record<string, unknown> = {
        deletedAt: null,
        ...scopeWhere,
      };
      if (filter.status) where.status = filter.status;
      if (filter.type) where.type = filter.type;
      if (filter.ownerId) where.ownerId = filter.ownerId;
      if (filter.departmentId) where.departmentId = filter.departmentId;
      if (filter.customerCode) where.customerCode = filter.customerCode;
      if (filter.customerRelationId) where.customerRelationId = filter.customerRelationId;
      if (filter.businessLine) where.businessLine = filter.businessLine;
      if (filter.search) {
        const s = filter.search.trim();
        if (s) {
          (where as any).OR = [
            ...(where.OR ? (where.OR as any[]) : []),
            { customer: { contains: s, mode: 'insensitive' } },
            { product: { contains: s, mode: 'insensitive' } },
            { code: { contains: s, mode: 'insensitive' } },
            { poNumber: { contains: s, mode: 'insensitive' } },
          ];
        }
      }

      const limit = filter.exportAll ? undefined : Math.min(Math.max(filter.limit ?? 50, 1), 500);
      const offset = filter.exportAll ? 0 : Math.max(filter.offset ?? 0, 0);
      const orderBy: any[] = [];
      const sortMap: Record<string, string> = {
        createdAt: 'createdAt',
        dueDate: 'dueDate',
        status: 'status',
        quoteAmount: 'quoteAmount',
      };
      if (filter.sort && sortMap[filter.sort]) {
        orderBy.push({ [sortMap[filter.sort]]: 'desc' });
      } else {
        orderBy.push({ createdAt: 'desc' });
      }

      const [items, total] = await Promise.all([
        (prisma as any).order.findMany({
          where,
          orderBy,
          ...(limit != null ? { take: limit, skip: offset } : {}),
          include: { lines: true },
        }),
        (prisma as any).order.count({ where }),
      ]);

      return {
        ok: true,
        data: {
          items: items.map(serializeOrder),
          total,
          limit: limit ?? items.length,
          offset,
          hasMore: limit != null ? offset + items.length < total : false,
        },
      };
    } catch (e: any) {
      logger.error('[OrderV2] list failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. 详情（带行级权限校验）
  // ══════════════════════════════════════════════════════════════════
  async function getOrder(
    actor: TokenPayload | null | undefined,
    id: string,
  ): Promise<OrderV2Result<any>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const row = await (prisma as any).order.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        include: { lines: true },
      });
      if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: '订单不存在或无权限查看' } };
      return { ok: true, data: serializeOrder(row) };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. 创建（编号生成 + 字典校验 + 配置默认值 + ownerId 自动填充）
  // ══════════════════════════════════════════════════════════════════
  async function createOrder(
    actor: TokenPayload | null | undefined,
    input: CreateOrderInput,
  ): Promise<OrderV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '创建订单需登录' } };
      if (!input.customer?.trim()) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'customer 必填' } };
      if (!input.product?.trim()) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'product 必填' } };
      if (!input.quantity || input.quantity <= 0) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'quantity 必须大于 0' } };

      // 字典校验 type
      if (input.type) {
        const err = await validateDictField('order_type', input.type);
        if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `type ${err}` } };
      }
      // status 校验（复用现有状态枚举 + 字典）
      const status = input.status || 'Pending';
      if (!VALID_ORDER_STATUSES.includes(status as any)) {
        return { ok: false, error: { code: 'VALIDATION_FAILED', message: `status 必须是: ${VALID_ORDER_STATUSES.join(', ')}` } };
      }

      // 配置默认值
      const withDefaults = await applyConfigDefaults(input);

      // v2.2（DR-042 §6.2 T-21）：以客户名义新建订单需为「宿主客户跟进人」（ownerId ∨ salesRepIds）
      // 或真全权角色；小组共享（read / read+followup）不开放下单——防越权（此前 createOrder
      // 未校验 customerRelationId 归属，组员可对共享客户直接下单）。
      if (withDefaults.customerRelationId) {
        const canCreateForCustomer = await teamShareSvc.hasRelationWriteAccess(actor, withDefaults.customerRelationId);
        if (!canCreateForCustomer) {
          return { ok: false, error: { code: 'FORBIDDEN', message: '仅跟进人可对该客户创建订单（DR-042 §6.2 T-21）' } };
        }

        // ── 信用门禁（信用控制规则 §6 #6，fail-closed；W-A 走查 DE-1 修复）──
        // Frozen/Revoked/Net61+ 逾期未结清客户禁止建新单；门禁自身故障同样阻断（不放行）
        try {
          const credit = await creditSvc.checkCreditAvailable({
            relationId: withDefaults.customerRelationId,
            amount: Number(withDefaults.quoteAmount ?? 0) || undefined,
          });
          if (!credit.ok) {
            logger.error('[OrderV2] 信用门禁校验失败（fail-closed 阻断建单）', { relationId: withDefaults.customerRelationId, error: credit.error.message });
            return { ok: false, error: { code: 'CREDIT_CHECK_FAILED', message: `信用门禁校验失败：${credit.error.message}` } };
          }
          const creditData = credit.data as { blocked: boolean; blockCode: string | null; blockReason: string | null };
          if (creditData.blocked) {
            logger.warn('[OrderV2] 信用门禁阻断建单', { relationId: withDefaults.customerRelationId, blockCode: creditData.blockCode, actorId: actor.userId });
            return {
              ok: false,
              error: {
                code: (creditData.blockCode ?? 'CREDIT_FROZEN_60_DAYS') as OrderV2Error,
                message: creditData.blockReason ?? '客户信用门禁阻断，禁止新建订单',
              },
            };
          }
        } catch (e: any) {
          logger.error('[OrderV2] 信用门禁校验异常（fail-closed 阻断建单）', { relationId: withDefaults.customerRelationId, error: e?.message });
          return { ok: false, error: { code: 'CREDIT_CHECK_FAILED', message: `信用门禁校验失败，请重试或联系管理员：${e?.message}` } };
        }
      }

      // 编号生成
      const code = await generateOrderCode();

      // ownerId / departmentId 自动填充
      const ownerId = input.ownerId || actor.userId;
      const departmentId = input.departmentId || actor.departmentIds?.[0] || null;

      const id = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // ── MOQ 快照 writeOnce（不追溯；创建时写入，后续绝不改写） ──
      const moqSnapshot = await moqConfigSvc.buildSnapshot();

      // ── Capsule 豁免（DR-003）：仅成衣订单可勾选，记录操作者/时间（§6 #0） ──
      const capsuleRequested = withDefaults.capsuleExemption === true;
      if (capsuleRequested && !isCapsuleEligible({ type: withDefaults.type, businessLine: withDefaults.businessLine })) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'CAPSULE_NOT_ALLOWED：Capsule 豁免仅适用于服装订单' } };
      }
      const capsuleFields: Record<string, unknown> = capsuleRequested
        ? { capsuleExemption: true, capsuleExemptionBy: actor.userId, capsuleExemptionAt: new Date() }
        : { capsuleExemption: false, capsuleExemptionBy: null, capsuleExemptionAt: null };

      const payload: Record<string, unknown> = {
        id,
        code,
        customer: withDefaults.customer,
        product: withDefaults.product,
        type: withDefaults.type || 'Other',
        quantity: withDefaults.quantity,
        status,
        dueDate: withDefaults.dueDate || '',
        quoteAmount: withDefaults.quoteAmount || 0,
        ownerId,
        departmentId,
        currency: withDefaults.currency,
        paymentTerms: withDefaults.paymentTerms,
        deliveryTerms: withDefaults.deliveryTerms,
        customerRelationId: withDefaults.customerRelationId || null,
        businessLine: withDefaults.businessLine || null,
        updatedAt: BigInt(Date.now()),
        fieldSources: { _origin: 'manual-v2' },
        moqSnapshot,
        ...capsuleFields,
      };
      // 透传白名单内的可选字段（ORDER_OPTIONAL_FIELDS；非法字段（如 unitPrice）不再透传，
      // moqSnapshot/capsuleExemption* 已在上方显式赋值，客户端注入不会覆盖）
      for (const k of ORDER_OPTIONAL_FIELDS) {
        const v = (withDefaults as Record<string, unknown>)[k];
        if (payload[k] === undefined && v != null) payload[k] = v;
      }

      const order = await (prisma as any).order.create({ data: payload, include: { lines: true } });

      // ── MOQ 创建校验（advisory：草稿保存不阻断；Confirmed 门禁/变更门禁 fail-closed 兜底） ──
      let moqCheck: unknown = null;
      try {
        moqCheck = await moqValidationSvc.validateCreate({
          type: payload.type as string,
          businessLine: payload.businessLine as string | null,
          capsuleExemption: payload.capsuleExemption === true,
          customerRelationId: payload.customerRelationId as string | null,
          snapshot: moqSnapshot,
          lines: [{ quantity: Number(withDefaults.quantity) }],
        }, { actor: { userId: actor.userId, roles: actor.roles, roleIds: actor.roleIds, permissions: actor.permissions } });
        if ((moqCheck as any).ok === false) {
          logger.warn('[OrderV2] MOQ 低于阈值（advisory，推进 Confirmed 时需豁免审批）', {
            id, blockedLineIndexes: (moqCheck as any).blockedLineIndexes,
          });
        }
      } catch (e: any) {
        logger.error('[OrderV2] MOQ 创建校验异常（不阻断创建）', { id, error: e?.message });
        moqCheck = null;
      }

      logger.info('[OrderV2] created', { id, code, status, ownerId, snapshotSource: moqSnapshot.source });
      return { ok: true, data: { ...serializeOrder(order), moqCheck } };
    } catch (e: any) {
      logger.error('[OrderV2] create failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. 更新（权限校验 + 字典校验）
  // ══════════════════════════════════════════════════════════════════
  async function updateOrder(
    actor: TokenPayload | null | undefined,
    id: string,
    input: Record<string, unknown>,
  ): Promise<OrderV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '更新订单需登录' } };
      // v2.2（DR-042 §5.3）：订单写 = 创建者 ∪ 宿主客户跟进人
      const scopeWhere = await buildOrderWriteScopeWhere(actor);
      const existing = await (prisma as any).order.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
      });
      if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: '订单不存在或无权限操作' } };

      // 字典校验 type（如果传入）
      if (input.type) {
        const err = await validateDictField('order_type', input.type as string);
        if (err) return { ok: false, error: { code: 'VALIDATION_FAILED', message: `type ${err}` } };
      }

      // ── MOQ 变更门禁（§X fail-closed）：Confirmed+ 订单数量变更须重算 MOQ（取 Order.moqSnapshot 口径） ──
      if (input.quantity !== undefined && Number(input.quantity) !== Number(existing.quantity)) {
        try {
          const moqPatch = await moqValidationSvc.validatePatch({
            orderId: id,
            beforeQty: Number(existing.quantity),
            afterQty: Number(input.quantity),
            actorId: actor.userId,
          });
          if (moqPatch.blocked) {
            return {
              ok: false,
              error: {
                code: 'MOQ_VIOLATION',
                message: `变更后数量 ${input.quantity} 低于 MOQ ${moqPatch.effectiveMoq}（快照口径），需 MOQ 豁免审批`,
                approvalRequestId: moqPatch.approvalRequestId,
              },
            };
          }
          if ((moqPatch.cancelledCount ?? 0) > 0) {
            logger.info('[OrderV2] 数量回升合规，已自动取消挂起 MOQ 豁免单', { id, cancelledCount: moqPatch.cancelledCount });
          }
        } catch (e: any) {
          if (e?.code !== 'MOQ_ORDER_NOT_FOUND') {
            // fail-closed：校验基础设施异常时阻断数量写入（§6 #1 异常分支）
            logger.error('[OrderV2] MOQ 变更校验异常（fail-closed 阻断数量写入）', { id, error: e?.message });
            return { ok: false, error: { code: 'MOQ_VIOLATION', message: `MOQ 校验失败，请重试或联系管理员：${e?.message}` } };
          }
        }
      }

      // ── Capsule 豁免切换（DR-003）：仅成衣订单；勾选/取消均重记操作者与时间 ──
      if (input.capsuleExemption !== undefined) {
        const wantCapsule = input.capsuleExemption === true;
        if (wantCapsule && !isCapsuleEligible({
          type: (input.type as string) ?? existing.type,
          businessLine: (input.businessLine as string) ?? existing.businessLine,
        })) {
          return { ok: false, error: { code: 'FORBIDDEN', message: 'CAPSULE_NOT_ALLOWED：Capsule 豁免仅适用于服装订单' } };
        }
        input.capsuleExemptionBy = actor.userId;
        input.capsuleExemptionAt = new Date();
      }

      // 构建 update payload（只更新白名单内传入的字段；moqSnapshot 为 writeOnce，绝不在更新路径出现）
      const payload: Record<string, unknown> = {};
      for (const f of ORDER_OPTIONAL_FIELDS) {
        if ((input as Record<string, unknown>)[f] !== undefined) payload[f] = (input as Record<string, unknown>)[f];
      }
      payload.updatedAt = BigInt(Date.now());

      const updated = await (prisma as any).order.update({
        where: { id },
        data: payload,
        include: { lines: true },
      });
      logger.info('[OrderV2] updated', { id, fields: Object.keys(payload) });
      return { ok: true, data: serializeOrder(updated) };
    } catch (e: any) {
      logger.error('[OrderV2] update failed', { id, error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. 状态流转（复用现有状态机矩阵）
  // ══════════════════════════════════════════════════════════════════
  async function transitionStatus(
    actor: TokenPayload | null | undefined,
    id: string,
    newStatus: string,
    reason?: string,
  ): Promise<OrderV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '状态流转需登录' } };
      if (!VALID_ORDER_STATUSES.includes(newStatus as any)) {
        return { ok: false, error: { code: 'VALIDATION_FAILED', message: `status 必须是: ${VALID_ORDER_STATUSES.join(', ')}` } };
      }

      // v2.2（DR-042 §5.3）：状态流转写 = 创建者 ∪ 宿主客户跟进人
      const scopeWhere = await buildOrderWriteScopeWhere(actor);
      const existing = await (prisma as any).order.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        select: {
          id: true, status: true, code: true, type: true, businessLine: true,
          quantity: true, capsuleExemption: true, moqSnapshot: true, customerRelationId: true,
        },
      });
      if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: '订单不存在或无权限操作' } };

      // 状态机校验
      const currentStatus = existing.status;
      if (currentStatus === newStatus) {
        return { ok: false, error: { code: 'INVALID_TRANSITION', message: `订单已是 ${currentStatus} 状态，无需变更` } };
      }
      const allowedTargets = ORDER_TRANSITIONS[currentStatus];
      if (!allowedTargets || !allowedTargets.has(newStatus)) {
        return { ok: false, error: { code: 'INVALID_TRANSITION', message: `不允许从 ${currentStatus} → ${newStatus}（合法目标: ${allowedTargets ? [...allowedTargets].join(', ') : '无'}）` } };
      }

      // ── 统一确认引擎（W-A 走查 DE-2/DE-4 修复，方案 a：消除 V1/V2 双轨）──
      // 状态机校验 / DR-010 守卫 / 信用+MOQ 确认门禁 / OrderStatusTransition 留痕 /
      // EntityLink 同步 / 审计 / OrderStatusChanged+OrderConfirmed 事件发布（L1 生产管线、L6 BOM 联动）
      // 全部收敛到 V1 orderLifecycleService.transitionOrderStatus 单引擎，V2 仅保留行级 scope 前置校验。
      const transition = await transitionOrderStatus({
        prisma,
        orderId: id,
        toStatus: newStatus,
        note: reason,
        operator: actor.userId,
        actorId: actor.userId,
      });
      if (!transition.ok) {
        const codeMap: Record<string, OrderV2Error> = {
          ORDER_NOT_FOUND: 'NOT_FOUND',
          INVALID_STATUS: 'VALIDATION_FAILED',
          INVALID_TRANSITION: 'INVALID_TRANSITION',
          NO_CHANGE: 'INVALID_TRANSITION',
          ORDER_LIFECYCLE_GUARDED: 'INVALID_TRANSITION',
          ORDER_ALREADY_CLOSED: 'INVALID_TRANSITION',
          MOQ_VIOLATION: 'MOQ_VIOLATION',
          CREDIT_FROZEN_60_DAYS: 'CREDIT_FROZEN_60_DAYS',
          CREDIT_REVOKED: 'CREDIT_REVOKED',
          OVERDUE_60_DAYS: 'OVERDUE_60_DAYS',
          CREDIT_CHECK_FAILED: 'CREDIT_CHECK_FAILED',
        };
        return {
          ok: false,
          error: {
            code: codeMap[transition.error!.code] ?? 'INTERNAL_ERROR',
            message: transition.error!.message,
            approvalRequestId: transition.error!.approvalRequestId,
          },
        };
      }

      logger.info('[OrderV2] status transition', { id, from: transition.data!.fromStatus, to: newStatus, reason });
      return { ok: true, data: serializeOrder(transition.data!.order) };
    } catch (e: any) {
      logger.error('[OrderV2] transition failed', { id, error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 6. 软删除（权限校验）
  // ══════════════════════════════════════════════════════════════════
  async function deleteOrder(
    actor: TokenPayload | null | undefined,
    id: string,
  ): Promise<OrderV2Result<any>> {
    try {
      if (!actor) return { ok: false, error: { code: 'UNAUTHORIZED', message: '删除订单需登录' } };
      // v2.2（DR-042 §5.3）：删除写 = 创建者 ∪ 宿主客户跟进人
      const scopeWhere = await buildOrderWriteScopeWhere(actor);
      const existing = await (prisma as any).order.findFirst({
        where: { id, deletedAt: null, ...scopeWhere },
        select: { id: true, code: true, customer: true },
      });
      if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: '订单不存在或无权限操作' } };

      const del = await (prisma as any).order.update({
        where: { id },
        data: { deletedAt: BigInt(Date.now()) },
      });
      logger.info('[OrderV2] soft-deleted', { id, code: existing.code });
      return { ok: true, data: serializeOrder(del) };
    } catch (e: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 7. 看板聚合（按 status 分组 count → 前端 Kanban 渲染）
  // ══════════════════════════════════════════════════════════════════
  async function getKanban(
    actor: TokenPayload | null | undefined,
    filter: { type?: string; businessLine?: string } = {},
  ): Promise<OrderV2Result<OrderKanbanResult>> {
    try {
      const scopeWhere = await buildScopeWhere(actor);
      const where: Record<string, unknown> = {
        deletedAt: null,
        ...scopeWhere,
      };
      if (filter.type) where.type = filter.type;
      if (filter.businessLine) where.businessLine = filter.businessLine;

      const rows = await (prisma as any).order.findMany({
        where,
        select: { status: true },
      });
      const statusCounts = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const s = r.status || 'Pending';
        statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
        total++;
      }

      // 从 DataDictionary 获取 status 的 label/color/order
      const entries = await dictSvc.getEntries('order_status', { enabledOnly: false });
      const metaMap = new Map(entries.map((e) => [e.key, e]));
      const allStatuses = entries.length > 0
        ? entries.map((e) => e.key)
        : [...VALID_ORDER_STATUSES];

      const statuses = allStatuses
        .map((key) => {
          const meta = metaMap.get(key);
          return {
            status: key,
            label: meta?.label || key,
            count: statusCounts.get(key) || 0,
            color: meta?.color,
          };
        })
        .sort((a, b) => {
          const oa = metaMap.get(a.status)?.order ?? 99;
          const ob = metaMap.get(b.status)?.order ?? 99;
          return oa - ob;
        });

      return { ok: true, data: { statuses, total } };
    } catch (e: any) {
      logger.error('[OrderV2] kanban failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '订单服务内部错误' } };
    }
  }

  return {
    listOrders,
    getOrder,
    createOrder,
    updateOrder,
    transitionStatus,
    deleteOrder,
    getKanban,
    buildScopeWhere,
  };
}

// ────────────────────────────────────────────────────────────────────
// 单例
// ────────────────────────────────────────────────────────────────────
let _defaultService: ReturnType<typeof createOrderServiceV2> | null = null;
export function getOrderServiceV2(prisma: PrismaClient): ReturnType<typeof createOrderServiceV2> {
  if (!_defaultService) _defaultService = createOrderServiceV2(prisma);
  return _defaultService;
}
