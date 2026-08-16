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
} from './orderLifecycleService';
import { logger } from '../lib/logger';
import { createMoqConfigService } from '../moq/moqConfigService';
import { createMoqResolutionService } from '../moq/moqResolutionService';
import { createMoqValidationService, isCapsuleEligible } from '../moq/moqValidationService';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';

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

  // ── 行级权限 where 构造 ──
  async function buildScopeWhere(actor: TokenPayload | null | undefined): Promise<Record<string, unknown>> {
    if (!actor) return { ownerId: '__NOBODY__' };
    const resolver = await permSvc.getDataScopeResolver(actor, 'orders');
    if (resolver.rule.kind === 'all') return {};
    if (resolver.rule.kind === 'self') {
      return { ownerId: actor.userId };
    }
    // department
    const deptIds = resolver.allowedDepartmentIds || [];
    const userIds = resolver.allowedUserIds || [];
    const orParts: any[] = [];
    if (userIds.length > 0) orParts.push({ ownerId: { in: userIds } });
    if (deptIds.length > 0) orParts.push({ departmentId: { in: deptIds } });
    if (orParts.length === 0) return { ownerId: '__NOBODY__' };
    return { OR: orParts };
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

      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
      const offset = Math.max(filter.offset ?? 0, 0);
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
          take: limit,
          skip: offset,
          include: { lines: true },
        }),
        (prisma as any).order.count({ where }),
      ]);

      return {
        ok: true,
        data: {
          items: items.map(serializeOrder),
          total,
          limit,
          offset,
          hasMore: offset + items.length < total,
        },
      };
    } catch (e: any) {
      logger.error('[OrderV2] list failed', { error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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
      // 透传额外的可选字段（moqSnapshot/capsuleExemption* 已在上方显式赋值，客户端注入不会覆盖）
      for (const [k, v] of Object.entries(withDefaults)) {
        if (!payload[k] && v != null) payload[k] = v;
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
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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
      const scopeWhere = await buildScopeWhere(actor);
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

      // 构建 update payload（只更新传入的字段；moqSnapshot 为 writeOnce，绝不在更新路径出现）
      const payload: Record<string, unknown> = {};
      const updatableFields = [
        'customer', 'product', 'type', 'quantity', 'dueDate', 'quoteAmount',
        'currency', 'paymentTerms', 'deliveryTerms', 'customerRelationId',
        'businessLine', 'ownerId', 'departmentId', 'salesPerson', 'merchandiser',
        'supervisor', 'productionBatch', 'productionDate', 'clientDate',
        'specialInstructions', 'poNumber', 'season', 'contactPerson', 'contactPhone',
        'shipToName', 'shipToAddress1', 'shipToAddress2', 'shipToCountry', 'shipToPhone',
        'deliverTo', 'salesContractNumber', 'finalContractNumber',
        'capsuleExemption', 'capsuleExemptionBy', 'capsuleExemptionAt',
      ];
      for (const f of updatableFields) {
        if (input[f] !== undefined) payload[f] = input[f];
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
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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

      const scopeWhere = await buildScopeWhere(actor);
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

      // ── MOQ Confirmed 门禁（§4.3 fail-closed）：低于 MOQ 且无 approved 豁免审批单 → 阻断 ──
      if (newStatus === 'Confirmed') {
        try {
          const moqCheck = await moqValidationSvc.validateCreate({
            type: existing.type,
            businessLine: existing.businessLine,
            capsuleExemption: existing.capsuleExemption === true,
            customerRelationId: existing.customerRelationId ?? null,
            snapshot: existing.moqSnapshot ?? null,
            lines: [{ quantity: Number(existing.quantity) }],
          }, { actor: { userId: actor.userId, roles: actor.roles, roleIds: actor.roleIds, permissions: actor.permissions } });
          if (!moqCheck.ok) {
            const approved = await (prisma as any).approvalRequest?.findFirst?.({
              where: {
                targetType: 'Order', targetId: id,
                actionType: 'order:moq-exemption', status: 'approved',
              },
              select: { id: true },
            });
            if (!approved) {
              const worst = moqCheck.lines[0];
              return {
                ok: false,
                error: {
                  code: 'MOQ_VIOLATION',
                  message: `订单数量 ${Number(existing.quantity)} 低于 MOQ ${worst?.effectiveMoq}（缺口 ${worst?.gapPct}%，快照口径），须先完成 MOQ 豁免审批（DR-007 单人单次）`,
                },
              };
            }
          }
        } catch (e: any) {
          // fail-closed：门禁校验异常 → 阻断 Confirmed 推进
          logger.error('[OrderV2] Confirmed 门禁 MOQ 校验异常（fail-closed 阻断）', { id, error: e?.message });
          return { ok: false, error: { code: 'MOQ_VIOLATION', message: `MOQ 校验失败，请重试或联系管理员：${e?.message}` } };
        }
      }

      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const order = await tx.order.update({
          where: { id },
          data: { status: newStatus, updatedAt: BigInt(Date.now()) },
        });
        // 写状态流转记录
        await tx.orderStatusTransition.create({
          data: {
            id: `OST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            orderId: id,
            fromStatus: currentStatus,
            toStatus: newStatus,
            reason: reason || null,
            actorId: actor.userId,
            createdAt: BigInt(Date.now()),
          },
        });
        return order;
      });

      logger.info('[OrderV2] status transition', { id, from: currentStatus, to: newStatus, reason });
      return { ok: true, data: serializeOrder(updated) };
    } catch (e: any) {
      logger.error('[OrderV2] transition failed', { id, error: e?.message });
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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
      const scopeWhere = await buildScopeWhere(actor);
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
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) } };
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
