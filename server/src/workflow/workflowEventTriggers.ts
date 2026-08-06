/**
 * Workflow Event Triggers — 事件总线自动触发工作流实例
 *
 * 启动时查询所有有 triggerEvent 的活跃 WorkflowDefinition，
 * 订阅对应事件，事件触发时自动创建工作流实例。
 *
 * 映射规则：
 *   event.sourceEntityType → instance.entityType
 *   event.sourceEntityId   → instance.entityId
 *
 * 幂等性：
 *   createInstance 内部已做去重（同实体+同定义+running → 返回已有实例）
 */

import { PrismaClient } from '@prisma/client';
import { businessEventBus, BusinessEventType } from '../events/businessEventBus';
import { WorkflowEngine } from './workflowEngine';
import { logger } from '../lib/logger';

const subscribedEvents = new Set<string>();

export function registerWorkflowEventTriggers(prisma: PrismaClient): void {
  // 异步初始化：查询所有有 triggerEvent 的活跃定义
  void (async () => {
    try {
      const defs = await prisma.workflowDefinition.findMany({
        where: { isActive: true, triggerEvent: { not: null } },
        select: { id: true, name: true, entityType: true, triggerEvent: true },
      });

      const engine = new WorkflowEngine(prisma);
      const triggerEvents = new Set<string>();

      for (const def of defs) {
        if (!def.triggerEvent) continue;
        triggerEvents.add(def.triggerEvent);
      }

      // 为每个唯一的 triggerEvent 订阅一次
      for (const eventType of triggerEvents) {
        if (subscribedEvents.has(eventType)) continue;
        subscribedEvents.add(eventType);

        businessEventBus.subscribe(eventType as BusinessEventType, async (event) => {
          try {
            // 找到该事件对应的所有定义（可能有多个工作流定义监听同一事件）
            const matchingDefs = defs.filter(d => d.triggerEvent === eventType);
            for (const def of matchingDefs) {
              // 事件 → 实体映射
              const entityType = event.sourceEntityType || def.entityType;
              const entityId = event.sourceEntityId;
              if (!entityId) {
                logger.warn('[WorkflowTrigger] event missing sourceEntityId, skipping', {
                  eventType,
                  defId: def.id,
                });
                continue;
              }

              await engine.createInstance({
                definitionId: def.id,
                entityType,
                entityId,
                title: `${def.name}：${entityType} ${entityId}`,
                initiatedById: event.actorId,
              });

              logger.info('[WorkflowTrigger] auto-created instance', {
                defId: def.id,
                defName: def.name,
                eventType,
                entityType,
                entityId,
              });
            }
          } catch (e: any) {
            // 通知失败不应阻断事件总线
            logger.error('[WorkflowTrigger] auto-create failed', {
              eventType,
              error: e?.message,
            });
          }
        });
      }

      logger.info('[WorkflowTrigger] registered', {
        definitionCount: defs.length,
        triggerEvents: Array.from(triggerEvents),
      });
    } catch (e: any) {
      logger.error('[WorkflowTrigger] initialization failed', { error: e?.message });
    }
  })();
}
