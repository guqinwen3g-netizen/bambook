/**
 * Phase 0 Sprint 1 — 业务事件总线（BusinessEventBus）
 *
 * 设计目标：
 *   1. 跨模块事件驱动：订单确认/生产完成/发货完成/开票/收款 等业务事件自动通知订阅者
 *   2. 持久化恢复：事件落 AgentJob 表（jobType=`bev:${type}`），调度器扫描未消费事件可重放
 *   3. 幂等消费：LinkageHandler 通过 idempotencyKey 去重（in-process Set + AgentCommitReceipt）
 *   4. 失败隔离：publish 永不抛错（业务操作不能因事件发布失败而 fail）；订阅者失败仅记录日志
 *
 * 关键不变量：
 *   - publish 必须在业务事务提交后调用（绝不在事务内调用，避免脏事件）
 *   - 订阅者执行失败不会影响其他订阅者或业务主流程
 *   - 事件 payload 必须 JSON 可序列化（持久化到 AgentJob.payload Json 字段）
 *
 * 使用方式：
 *   // 发布
 *   await publishBusinessEvent({
 *     type: 'OrderConfirmed',
 *     sourceEntityType: 'Order',
 *     sourceEntityId: orderId,
 *     orderId,
 *     payload: { poNumber, customerName },
 *     actorId,
 *     transactionId: result.transitionId,
 *   });
 *
 *   // 订阅
 *   businessEventBus.subscribe('OrderConfirmed', async (event) => {
 *     await notificationService.notifyOrderConfirmed(event);
 *   });
 *
 *   // 注册联动（Phase 1 Sprint 3 用）
 *   businessEventBus.registerLinkage({
 *     id: 'L1_create_production',
 *     eventType: 'OrderConfirmed',
 *     idempotencyKey: (e) => `auto:L1:${e.orderId}`,
 *     execute: async (prisma, event) => { ... },
 *   });
 */

import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────
// 事件类型 — 业务事件总线支持的全部事件类型
// ────────────────────────────────────────────────────────────────
export type BusinessEventType =
  | 'OrderCreated'
  | 'OrderConfirmed'
  | 'QuotationIssued'
  | 'QuotationAccepted'
  | 'PurchaseOrderSent'
  | 'PurchaseOrderConfirmed'
  | 'MaterialReceived'
  | 'OrderStatusChanged'
  | 'ProductionStageAdvanced'
  | 'ProductionCompleted'
  | 'ShipmentCreated'
  | 'ShipmentCompleted'
  | 'ShipmentStatusChanged'
  | 'InvoiceIssued'
  | 'InvoiceCancelled'
  | 'PaymentVoucherCreated'
  | 'PaymentReceived'
  | 'AllocationReconciled'
  | 'DevelopmentConverted'
  | 'RelationOnboarded'
  | 'StockLowAlarm'
  | 'StockOverstockAlarm'
  | 'BOMConfirmed'
  | 'BOMCostCalculated'
  | 'CreditLimitExceeded'
  | 'FollowUpOverdue'
  | 'OpportunityStageChanged'
  | 'OpportunityClosedWon'
  | 'OpportunityClosedLost'
  | 'CustomerTierAssigned'
  | 'CustomsDeclarationCreated'
  | 'CustomsDeclarationStatusChanged'
  | 'CustomsCleared'
  | 'TaxRefundCompleted'
  | 'FxSettlementCreated'
  | 'LcStatusChanged'
  | 'SupplierBlacklisted'
  | 'FactoryEvaluationAdded'
  | 'FactoryCertificationExpiring';

export interface BusinessEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  /** 事件唯一 ID，用于幂等持久化与重放去重 */
  id: string;
  /** 事件类型 */
  type: BusinessEventType;
  /** 源实体类型：'Order' / 'Shipment' / 'Invoice' / 'PaymentVoucher' 等 */
  sourceEntityType: string;
  /** 源实体 ID */
  sourceEntityId: string;
  /** 便捷字段：大多数业务事件都是订单维度 */
  orderId?: string;
  /** 事件 payload（必须 JSON 可序列化） */
  payload: T;
  /** 事件发生时间（epoch ms） */
  occurredAt: number;
  /** 触发者 ID（userId 或 'api' / 'system'） */
  actorId: string;
  /** 关联业务事务 ID（如 OrderStatusTransition.id），用于审计串联 */
  transactionId?: string;
}

export type BusinessEventHandler<T extends Record<string, unknown> = Record<string, unknown>> = (
  event: BusinessEvent<T>,
) => void | Promise<void>;

export interface LinkageHandler<T extends Record<string, unknown> = Record<string, unknown>> {
  /** 联动 ID（唯一标识） */
  id: string;
  /** 监听的事件类型 */
  eventType: BusinessEventType;
  /** 幂等 key 生成器：相同 key 的事件只执行一次 */
  idempotencyKey: (event: BusinessEvent<T>) => string;
  /** 执行器：调用下游 service 完成业务联动 */
  execute: (
    prisma: PrismaClient,
    event: BusinessEvent<T>,
  ) => Promise<{ ok: boolean; created?: unknown; error?: string }>;
}

// ────────────────────────────────────────────────────────────────
// BusinessEventBus 单例
// ────────────────────────────────────────────────────────────────

class BusinessEventBus {
  private emitter = new EventEmitter();
  private prisma?: PrismaClient;
  /** in-process 幂等去重（用于 LinkageHandler） */
  private processedKeys = new Set<string>();
  /** 已注册的联动处理器（id => handler） */
  private linkageHandlers = new Map<string, LinkageHandler>();

  constructor() {
    // 业务事件类型多样，避免 MaxListeners 警告
    this.emitter.setMaxListeners(100);
  }

  /**
   * 注入 Prisma 客户端（必须在 server 启动时调用，用于持久化事件）
   */
  setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  /**
   * 发布业务事件。
   *
   * 契约：
   *   - 持久化到 AgentJob（jobType=`bev:${type}`）用于崩溃恢复
   *   - in-process 同步 emit 给订阅者
   *   - 永不抛错：持久化/订阅失败仅记录日志，不影响业务主流程
   *
   * 必须在业务事务提交后调用，避免发布未提交的脏事件。
   */
  async publish<T extends Record<string, unknown>>(event: BusinessEvent<T>): Promise<void> {
    // 1. 持久化（best-effort，永不抛错）
    if (this.prisma) {
      try {
        await this.prisma.agentJob.create({
          data: {
            id: event.id,
            jobType: `bev:${event.type}`,
            status: 'queued',
            priority: 5,
            payload: event as any,
            scheduledAt: new Date(event.occurredAt),
          },
        });
      } catch (e: any) {
        // P2002 = unique constraint（事件已持久化，幂等 publish 可接受）
        const isDuplicate = e?.code === 'P2002' || String(e?.message || '').includes('Unique constraint');
        if (!isDuplicate) {
          logger.error('[BusinessEventBus] persist failed', {
            error: e?.message,
            eventId: event.id,
            eventType: event.type,
          });
        }
      }
    }

    // 2. in-process emit — 逐个订阅者错误隔离
    // Node EventEmitter.emit() 在同步订阅者抛错时会中断后续订阅者，
    // 这里手动遍历 listeners 并对每个订阅者 try/catch，确保单个订阅者失败
    // 不影响其他订阅者（核心不变量：订阅者失败不阻断业务主流程）。
    const emitToListeners = (eventType: string) => {
      const listeners = this.emitter.listeners(eventType);
      for (const listener of listeners) {
        try {
          const result = listener(event);
          // 异步订阅者：catch rejected promise（fire-and-forget，不阻塞 publish）
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((e: any) => {
              logger.error('[BusinessEventBus] async subscriber failed', {
                error: e?.message,
                eventId: event.id,
                eventType: event.type,
              });
            });
          }
        } catch (e: any) {
          // 同步订阅者失败：隔离，不影响其他订阅者
          logger.error('[BusinessEventBus] subscriber failed', {
            error: e?.message,
            eventId: event.id,
            eventType: event.type,
          });
        }
      }
    };

    emitToListeners(event.type);
    emitToListeners('*');
  }

  /**
   * 订阅特定事件类型（或 '*' 监听全部）。
   * 返回取消订阅函数。
   */
  subscribe<T extends Record<string, unknown> = Record<string, unknown>>(
    eventType: BusinessEventType | '*',
    handler: BusinessEventHandler<T>,
  ): () => void {
    const wrapped = handler as BusinessEventHandler;
    this.emitter.on(eventType, wrapped);
    return () => {
      this.emitter.off(eventType, wrapped);
    };
  }

  /**
   * 注册联动处理器（Phase 1 Sprint 3 用，本 Sprint 1 暂不调用）。
   * 幂等性：
   *   - in-process Set 去重（同进程内重复事件不重复执行）
   *   - execute() 内部应通过 AgentCommitReceipt 做跨进程/重启幂等
   * 失败恢复：执行失败会从 processedKeys 移除，调度器可重试。
   */
  registerLinkage<T extends Record<string, unknown>>(handler: LinkageHandler<T>): void {
    const key = `${handler.eventType}:${handler.id}`;
    if (this.linkageHandlers.has(key)) {
      logger.warn(`[BusinessEventBus] linkage ${key} already registered, skipping`);
      return;
    }
    this.linkageHandlers.set(key, handler as unknown as LinkageHandler);

    this.emitter.on(handler.eventType, async (event: BusinessEvent<T>) => {
      const idempKey = handler.idempotencyKey(event);
      if (this.processedKeys.has(idempKey)) {
        return;
      }
      this.processedKeys.add(idempKey);

      try {
        if (this.prisma) {
          const result = await (handler as LinkageHandler<T>).execute(this.prisma, event);
          if (!result.ok) {
            logger.warn(`[BusinessEventBus] linkage ${handler.id} returned not-ok`, {
              error: result.error,
              eventId: event.id,
            });
            // 失败时移除 key，允许调度器重试
            this.processedKeys.delete(idempKey);
          }
        }
      } catch (e: any) {
        logger.error(`[BusinessEventBus] linkage ${handler.id} failed`, {
          error: e?.message,
          eventId: event.id,
        });
        this.processedKeys.delete(idempKey);
      }
    });
  }

  /**
   * 重置所有订阅与状态（仅供测试使用）
   */
  reset(): void {
    this.emitter.removeAllListeners();
    this.processedKeys.clear();
    this.linkageHandlers.clear();
  }

  /**
   * 调试/监控统计
   */
  stats(): { processedKeys: number; linkageHandlers: number; listenerCount: number } {
    return {
      processedKeys: this.processedKeys.size,
      linkageHandlers: this.linkageHandlers.size,
      listenerCount: this.emitter.listenerCount('OrderConfirmed') + this.emitter.listenerCount('*'),
    };
  }
}

export const businessEventBus = new BusinessEventBus();

// ────────────────────────────────────────────────────────────────
// 便捷工具函数
// ────────────────────────────────────────────────────────────────

/**
 * 生成稳定唯一的事件 ID。
 * 格式：`bev_<type>_<timestamp>_<random>`
 */
export function generateEventId(type: string): string {
  const safeType = type.replace(/[^a-zA-Z0-9_]/g, '_');
  return `bev_${safeType}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 便捷发布函数：在业务事务提交后调用。
 *
 * 用法：
 *   const result = await transitionOrderStatus({ ... });
 *   if (result.ok) {
 *     await publishBusinessEvent({
 *       type: 'OrderConfirmed',
 *       sourceEntityType: 'Order',
 *       sourceEntityId: orderId,
 *       orderId,
 *       payload: { poNumber: result.data.order.poNumber, fromStatus, toStatus },
 *       actorId,
 *       transactionId: result.data.transitionId,
 *     });
 *   }
 */
export async function publishBusinessEvent<T extends Record<string, unknown>>(params: {
  type: BusinessEventType;
  sourceEntityType: string;
  sourceEntityId: string;
  orderId?: string;
  payload: T;
  actorId: string;
  transactionId?: string;
  occurredAt?: number;
  eventId?: string;
}): Promise<void> {
  const event: BusinessEvent<T> = {
    id: params.eventId || generateEventId(params.type),
    type: params.type,
    sourceEntityType: params.sourceEntityType,
    sourceEntityId: params.sourceEntityId,
    orderId: params.orderId,
    payload: params.payload,
    occurredAt: params.occurredAt ?? Date.now(),
    actorId: params.actorId,
    transactionId: params.transactionId,
  };
  await businessEventBus.publish(event);
}
