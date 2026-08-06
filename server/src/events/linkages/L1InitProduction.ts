/**
 * Phase 1 Sprint 3 — 联动执行器 L1
 *
 * 业务规则：订单确认（OrderConfirmed）→ 自动初始化 10 阶段生产管线
 *
 * 设计决策：
 *   - 仅初始化生产阶段骨架，不自动推进任何阶段（阶段推进需人工门禁检查）
 *   - initProductionStages 内部使用 upsert，天然幂等（重复触发无副作用）
 *   - 生产阶段初始化后，订单可进入 Production 状态（由用户手动转换或后续联动）
 *
 * 幂等性：
 *   - in-process: `auto:L1:${orderId}` 去重
 *   - 业务层: upsert（orderId+stageKey 唯一约束）
 */

import { businessEventBus } from '../businessEventBus';
import { initProductionStages } from '../../production/stageService';
import { isLinkageEnabled } from '../../config/automationConfig';
import { logger } from '../../lib/logger';

export function registerL1InitProduction(): void {
  businessEventBus.registerLinkage({
    id: 'L1_init_production',
    eventType: 'OrderConfirmed',
    idempotencyKey: (e) => `auto:L1:${e.orderId ?? e.sourceEntityId}`,
    execute: async (prisma, event) => {
      if (!isLinkageEnabled('L1_init_production')) {
        logger.info('[L1] linkage disabled, skipping', { orderId: event.orderId });
        return { ok: true, created: null, error: 'linkage disabled' };
      }
      const orderId = event.orderId;
      if (!orderId) {
        logger.warn('[L1] OrderConfirmed event missing orderId, skipping', { eventId: event.id });
        return { ok: true, created: null, error: 'no orderId' };
      }

      try {
        await initProductionStages(prisma, orderId);
        logger.info('[L1] production stages initialized', {
          orderId,
          eventId: event.id,
          transitionId: event.transactionId,
        });
        return { ok: true, created: { orderId, stages: 10 } };
      } catch (e: any) {
        logger.error('[L1] initProductionStages failed', {
          error: e?.message,
          orderId,
          eventId: event.id,
        });
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });
}
