/**
 * Phase 0 Sprint 1 — 通知模板引擎
 *
 * 设计目标：
 *   - 把 BusinessEvent 的 payload 渲染成人类可读的 title/body
 *   - 支持模板变量替换（{poNumber} / {customerName} 等）
 *   - 内置默认模板（无需数据库配置即可工作）
 *   - 后续可扩展为从 NotificationTemplate 表读取自定义模板
 *
 * 不变量：
 *   - 渲染失败必须降级到通用模板，绝不抛错（通知是辅助功能，不能阻断业务）
 *   - 模板变量缺失时显示空字符串，不报错
 */

import type { BusinessEvent, BusinessEventType } from '../events/businessEventBus';

// ────────────────────────────────────────────────────────────────
// 通知级别
// ────────────────────────────────────────────────────────────────
export type NotificationLevel = 'info' | 'warning' | 'critical';

export interface NotificationContent {
  type: string;          // 通知类型 key（与 Notification.type 对应）
  title: string;
  body: string;
  level: NotificationLevel;
  link?: string;         // 前端跳转路由
}

// ────────────────────────────────────────────────────────────────
// 内置默认模板表
// 每个 BusinessEventType 对应一个通知模板
// ────────────────────────────────────────────────────────────────

interface TemplateSpec {
  type: string;
  level: NotificationLevel;
  title: string;
  body: string;
  link?: string;
}

const DEFAULT_TEMPLATES: Record<BusinessEventType, TemplateSpec> = {
  OrderCreated: {
    type: 'order_created',
    level: 'info',
    title: '新订单 {poNumber} 已创建',
    body: '客户 {customerName} 的订单 {poNumber} 已创建，等待确认。',
    link: '/orders?id={orderId}',
  },
  OrderConfirmed: {
    type: 'order_confirmed',
    level: 'info',
    title: '订单 {poNumber} 已确认',
    body: '订单 {poNumber}（客户 {customerName}）已确认，可进入生产环节。',
    link: '/orders?id={orderId}',
  },
  QuotationIssued: {
    type: 'quotation_issued',
    level: 'info',
    title: '报价单 {quotationNumber} 已发送',
    body: '客户 {customerName} 的报价单 {quotationNumber} 已发送，金额 {totalAmount} {currency}，等待客户回复。',
    link: '/quotations?id={quotationId}',
  },
  QuotationAccepted: {
    type: 'quotation_accepted',
    level: 'info',
    title: '报价单 {quotationNumber} 已被接受',
    body: '客户 {customerName} 已接受报价单 {quotationNumber}，金额 {totalAmount} {currency}，可转为正式订单。',
    link: '/quotations?id={quotationId}',
  },
  PurchaseOrderSent: {
    type: 'purchase_order_sent',
    level: 'info',
    title: '采购单 {poNumber} 已发送',
    body: '供应商 {supplierName} 的采购单 {poNumber} 已发送，金额 {totalAmount} {currency}，等待供应商确认。',
    link: '/procurement?id={purchaseOrderId}',
  },
  PurchaseOrderConfirmed: {
    type: 'purchase_order_confirmed',
    level: 'info',
    title: '采购单 {poNumber} 已确认',
    body: '供应商 {supplierName} 已确认采购单 {poNumber}，金额 {totalAmount} {currency}，可安排收料。',
    link: '/procurement?id={purchaseOrderId}',
  },
  MaterialReceived: {
    type: 'material_received',
    level: 'info',
    title: '采购单 {poNumber} 来料 {receiptNumber}',
    body: '供应商 {supplierName} 的采购单 {poNumber} 收料 {totalAccepted}（合格）/ {totalRejected}（不合格），入库仓库 {warehouseName}。',
    link: '/procurement?id={purchaseOrderId}&tab=receipts',
  },
  OrderStatusChanged: {
    type: 'order_status_changed',
    level: 'info',
    title: '订单 {poNumber} 状态变更',
    body: '订单 {poNumber} 状态从 {fromStatus} 变更为 {toStatus}。',
    link: '/orders?id={orderId}',
  },
  ProductionStageAdvanced: {
    type: 'production_stage_advanced',
    level: 'info',
    title: '订单 {poNumber} 生产进度更新',
    body: '订单 {poNumber} 完成阶段：{stageLabel}。',
    link: '/orders?id={orderId}&tab=production',
  },
  ProductionCompleted: {
    type: 'production_completed',
    level: 'info',
    title: '订单 {poNumber} 生产完成',
    body: '订单 {poNumber} 已完成全部生产阶段，可进入发货环节。',
    link: '/orders?id={orderId}&tab=production',
  },
  ShipmentCreated: {
    type: 'shipment_created',
    level: 'info',
    title: '出货单 {shipmentNumber} 已创建',
    body: '订单 {poNumber} 的出货单 {shipmentNumber} 已创建。',
    link: '/shipments?id={shipmentId}',
  },
  ShipmentCompleted: {
    type: 'shipment_completed',
    level: 'info',
    title: '出货单 {shipmentNumber} 已交付',
    body: '订单 {poNumber} 的出货单 {shipmentNumber} 已交付，可开具发票。',
    link: '/shipments?id={shipmentId}',
  },
  ShipmentStatusChanged: {
    type: 'shipment_status_changed',
    level: 'info',
    title: '出货单 {shipmentNumber} 状态变更',
    body: '出货单 {shipmentNumber} 状态变更为 {toStatus}。',
    link: '/shipments?id={shipmentId}',
  },
  InvoiceIssued: {
    type: 'invoice_issued',
    level: 'info',
    title: '发票 {invoiceNumber} 已开具',
    body: '订单 {poNumber} 的发票 {invoiceNumber} 已开具，金额 {amount} {currency}。',
    link: '/finance?tab=invoices&id={invoiceId}',
  },
  InvoiceCancelled: {
    type: 'invoice_cancelled',
    level: 'warning',
    title: '发票 {invoiceNumber} 已作废',
    body: '订单 {poNumber} 的发票 {invoiceNumber} 已作废。原因：{reason}',
    link: '/finance?tab=invoices&id={invoiceId}',
  },
  PaymentVoucherCreated: {
    type: 'payment_voucher_created',
    level: 'info',
    title: '{voucherTypeLabel} {voucherNumber} 已登记',
    body: '凭证 {voucherNumber} 已登记，金额 {amount} {currency}。',
    link: '/finance?tab=vouchers&id={voucherId}',
  },
  PaymentReceived: {
    type: 'payment_received',
    level: 'info',
    title: '收款 {voucherNumber} 已到账',
    body: '订单 {poNumber} 收款 {amount} {currency} 已到账，可进行核销。',
    link: '/finance?tab=vouchers&id={voucherId}',
  },
  AllocationReconciled: {
    type: 'allocation_reconciled',
    level: 'info',
    title: '发票 {invoiceNumber} 核销完成',
    body: '订单 {poNumber} 的发票 {invoiceNumber} 已完成核销。',
    link: '/finance?tab=invoices&id={invoiceId}',
  },
  DevelopmentConverted: {
    type: 'development_converted',
    level: 'info',
    title: '样品 {caseCode} 转大货成功',
    body: '样品开发单 {caseCode} 已转为订单 {poNumber}。',
    link: '/development?id={caseId}',
  },
  RelationOnboarded: {
    type: 'relation_onboarded',
    level: 'info',
    title: '客户/供应商 {relationName} 已录入',
    body: '关系档案 {relationName}（{relationType}）已录入系统。',
    link: '/relations?id={relationId}',
  },
  StockLowAlarm: {
    type: 'stock_low_alarm',
    level: 'warning',
    title: '库存预警：{description}',
    body: '物料 {description}（{materialCode}）在仓库 {warehouseName} 库存不足，当前 {currentQty} {unit}，最低预警线 {minStock} {unit}。',
    link: '/inventory?itemId={itemId}',
  },
  StockOverstockAlarm: {
    type: 'stock_overstock_alarm',
    level: 'warning',
    title: '库存积压：{description}',
    body: '物料 {description}（{materialCode}）在仓库 {warehouseName} 库存积压，当前 {currentQty} {unit}，最高预警线 {maxStock} {unit}。',
    link: '/inventory?itemId={itemId}',
  },
  BOMConfirmed: {
    type: 'bom_confirmed',
    level: 'info',
    title: 'BOM 已确认：{bomNumber}',
    body: 'BOM {bomNumber}（{description}）已确认，总成本 {totalCost} {currency}，物料行 {lineCount} 项。',
    link: '/bom?id={bomId}',
  },
  BOMCostCalculated: {
    type: 'bom_cost_calculated',
    level: 'info',
    title: 'BOM 成本已更新：{bomNumber}',
    body: 'BOM {bomNumber} 成本重新计算完成：总成本 {totalCost}，物料 {totalMaterialCost}，人工 {totalLaborCost}，费用 {totalOverheadCost}。',
    link: '/bom?id={bomId}',
  },
};

// ────────────────────────────────────────────────────────────────
// 模板变量替换
// ────────────────────────────────────────────────────────────────

/**
 * 把 {varName} 占位符替换为 payload 中对应的值。
 * 缺失变量显示空字符串，不抛错。
 * 嵌套字段用点号访问（如 {order.poNumber}）。
 */
export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{([\w.]+)\}/g, (match, key: string) => {
    const value = readPath(payload, key);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `${value.length} 项`;
    return JSON.stringify(value);
  });
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ────────────────────────────────────────────────────────────────
// 通知内容渲染入口
// ────────────────────────────────────────────────────────────────

/**
 * 把 BusinessEvent 渲染为通知内容。
 * 失败时降级到通用模板，绝不抛错。
 */
export function renderNotification(event: BusinessEvent): NotificationContent {
  const spec = DEFAULT_TEMPLATES[event.type];
  if (!spec) {
    // 未知事件类型 → 降级通用通知
    return {
      type: 'unknown_event',
      title: `业务事件：${event.type}`,
      body: `源实体 ${event.sourceEntityType}#${event.sourceEntityId} 触发了 ${event.type} 事件。`,
      level: 'info',
    };
  }

  // payload + 顶层字段都可作为模板变量
  const variables: Record<string, unknown> = {
    ...event.payload,
    eventId: event.id,
    orderId: event.orderId,
    sourceEntityType: event.sourceEntityType,
    sourceEntityId: event.sourceEntityId,
    actorId: event.actorId,
  };

  try {
    const title = renderTemplate(spec.title, variables);
    const body = renderTemplate(spec.body, variables);
    const link = spec.link ? renderTemplate(spec.link, variables) : undefined;
    return {
      type: spec.type,
      title,
      body,
      level: spec.level,
      link,
    };
  } catch {
    // 渲染失败 → 降级
    return {
      type: spec.type,
      title: spec.title,
      body: spec.body,
      level: spec.level,
    };
  }
}
