import { Response } from 'express';

export interface DataChangeEvent {
  entity: string;
  action: string;
  ids?: string[];
  timestamp?: number;
}

// Phase 0 Sprint 1: 通知事件（业务事件触发，推送给前端 NotificationCenter）
export interface NotificationEvent {
  type: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
  link?: string;
  eventId: string;
  eventType: string;
  orderId?: string;
  recipientIds: string[];
  timestamp?: number;
}

const clients = new Set<Response>();

export function addRealtimeClient(res: Response): () => void {
  clients.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

  return () => {
    clients.delete(res);
  };
}

export function publishDataChange(event: DataChangeEvent) {
  const payload = JSON.stringify({ ...event, timestamp: event.timestamp ?? Date.now() });
  for (const client of clients) {
    client.write(`event: data-change\ndata: ${payload}\n\n`);
  }
}

/**
 * Phase 0 Sprint 1: 向所有在线客户端推送通知事件。
 *
 * 前端 NotificationCenter 订阅 'notification' SSE 事件，收到后：
 *   1. 增加未读徽章计数
 *   2. 显示 toast 提醒
 *   3. 用户点击打开抽屉查看详情
 *
 * 注意：SSE 推送失败只影响实时性，不重试（落库已成功，用户刷新可见）。
 */
export function publishNotificationEvent(event: NotificationEvent) {
  const payload = JSON.stringify({ ...event, timestamp: event.timestamp ?? Date.now() });
  for (const client of clients) {
    try {
      client.write(`event: notification\ndata: ${payload}\n\n`);
    } catch {
      // 客户端连接已断开，忽略
    }
  }
}

