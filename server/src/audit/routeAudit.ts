// routeAudit 接收 prisma 或 tx（any 类型，支持事务内审计）
/**
 * task_mqxv9giu (finance-route-audit-contract): finance route 审计日志契约。
 *
 * 失败契约（高风险财务写入）：
 *   - AuditLog 写入失败必须抛出/传播，不能静默吞（fail closed）。
 *   - 高风险财务写入若审计无法落盘，必须让请求失败，不得伪成功。
 *
 * 原则：
 *   1. 仅在业务变更成功后写入（validation 失败/业务错误不写，避免误导审计）
 *   2. AuditLog 失败 → 抛出（由 route catch 转成 500，不伪成功）
 *   3. 必含 actor/source/entityType/entityId/operation + before/after 或 payload
 */

export interface RouteAuditInput {
  prisma: any;  // PrismaClient 或 $transaction tx（支持事务内审计）
  actorId: string;
  source: string;
  operation: string;
  targetType: string;
  targetId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * 写入 route 审计日志。
 * - 成功：写入 AuditLog，detail 含 source/before/after
 * - 失败：抛出（不静默吞），由 route catch 转成 500（高风险财务写入不得伪成功）
 */
export async function writeRouteAuditLog(input: RouteAuditInput): Promise<string> {
  const id = `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const detail: Record<string, unknown> = { source: input.source };
  if (input.before != null) detail.before = input.before;
  if (input.after != null) detail.after = input.after;

  await input.prisma.auditLog.create({
    data: {
      id,
      actorId: input.actorId || 'system',
      action: input.operation,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: detail as any,
      ip: input.ip ?? null,
    },
  });
  return id;
}

export function actorIdFromRequest(req: any): string {
  return req?.actor?.userId || req?.actor?.id || 'api';
}
