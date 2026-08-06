/**
 * Phase 1 Sprint 3 — 联动执行器注册入口
 *
 * 在 server 启动时调用 registerAllLinkages()，
 * 把 5 个核心业务联动挂到 businessEventBus。
 *
 * 调用时序：
 *   1. initializeNotificationBindings(prisma)  — 注入 prisma + 通知订阅
 *   2. registerAllLinkages()                    — 注册联动执行器
 *
 * 联动清单：
 *   L1: OrderConfirmed       → initProductionStages   （初始化生产管线）
 *   L2: ProductionCompleted   → createShipmentDraft   （创建发货单草稿）
 *   L3: ShipmentCompleted    → createInvoiceDraft     （创建应收发票草稿）
 *   L5: PaymentVoucherCreated → autoAllocate          （自动核销到关联发票）
 *
 * L4 (InvoiceIssued → payment todo) 由通知系统覆盖，无需独立联动。
 *
 * 不变量：
 *   - 联动执行失败不阻断业务（businessEventBus 保证 fire-and-forget）
 *   - 失败时 idempotencyKey 从 processedKeys 移除，允许后续重试
 *   - 所有联动创建的都是 Draft 状态，需人工审核后推进
 */

import { logger } from '../../lib/logger';
import { registerL1InitProduction } from './L1InitProduction';
import { registerL2CreateShipment } from './L2CreateShipment';
import { registerL3IssueInvoice } from './L3IssueInvoice';
import { registerL5AutoAllocate } from './L5AutoAllocate';

export function registerAllLinkages(): void {
  // registerLinkage 内部通过 linkageHandlers.has(key) 去重，
  // 重复调用安全（reset 后可重新注册，用于测试）
  registerL1InitProduction();
  registerL2CreateShipment();
  registerL3IssueInvoice();
  registerL5AutoAllocate();

  logger.info('[Linkages] linkage handlers registration attempted', {
    linkages: ['L1_init_production', 'L2_create_shipment', 'L3_issue_invoice', 'L5_auto_allocate'],
  });
}
