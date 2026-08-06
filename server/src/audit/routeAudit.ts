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
 *
 * Phase 0 Sprint 1 扩展：字段级审计
 *   - operationType: create / update / delete / transition / link / unlink
 *   - fieldPath: 如 "status" 或 "lines[0].quantity"
 *   - beforeValue / afterValue: 单字段前值/后值（与 detail.before/after 互补，
 *     detail 存全量快照，beforeValue/afterValue 存单字段精确追踪）
 *   - transactionId: 关联 OrderStatusTransition / BusinessEvent id，串联同一业务操作
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
  // ── Phase 0 Sprint 1: 字段级审计 ──
  operationType?: string;  // create / update / delete / transition / link / unlink
  fieldPath?: string;       // 如 "status" 或 "lines[0].quantity"
  beforeValue?: unknown;    // 单字段前值
  afterValue?: unknown;     // 单字段后值
  transactionId?: string;  // 关联 OrderStatusTransition / BusinessEvent id
}

/**
 * 写入 route 审计日志。
 * - 成功：写入 AuditLog，detail 含 source/before/after
 * - 失败：抛出（不静默吞），由 route catch 转成 500（高风险财务写入不得伪成功）
 *
 * Phase 0 Sprint 1: 支持字段级审计（operationType/fieldPath/beforeValue/afterValue/transactionId）
 * 向后兼容：新字段全部 optional，已有调用方无需修改。
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
      // 字段级审计（Phase 0 Sprint 1）
      operationType: input.operationType ?? null,
      fieldPath: input.fieldPath ?? null,
      beforeValue: input.beforeValue != null ? (input.beforeValue as any) : null,
      afterValue: input.afterValue != null ? (input.afterValue as any) : null,
      transactionId: input.transactionId ?? null,
    },
  });
  return id;
}

// ────────────────────────────────────────────────────────────────
// 字段级审计便捷 helper
// ────────────────────────────────────────────────────────────────

export interface FieldAuditInput {
  prisma: any;
  actorId: string;
  source: string;
  operation: string;
  targetType: string;
  targetId: string;
  /** 变更字段路径，如 "status" / "amount" / "lines[0].quantity" */
  fieldPath: string;
  /** 变更前值 */
  beforeValue: unknown;
  /** 变更后值 */
  afterValue: unknown;
  /** 操作类型：create / update / delete / transition / link / unlink（默认 update）*/
  operationType?: string;
  /** 关联业务事务 ID（OrderStatusTransition.id / BusinessEvent.id）*/
  transactionId?: string;
  ip?: string | null;
}

/**
 * 字段级审计日志 — 追踪单个字段的 before→after 变更。
 *
 * 适用场景：
 *   - 状态机转移（status: Draft → Issued）
 *   - 金额变更（amount: 1000 → 1500）
 *   - 关联建立/解除（orderId: null → "ord_xxx"）
 *
 * 与 writeRouteAuditLog 的关系：
 *   - writeRouteAuditLog: 全量快照（before/after 存整个记录）
 *   - writeFieldAuditLog: 单字段精确追踪（beforeValue/afterValue 存一个字段的值）
 *   - 两者可同时调用：全量快照 + 关键字段精确追踪
 */
export async function writeFieldAuditLog(input: FieldAuditInput): Promise<string> {
  return writeRouteAuditLog({
    prisma: input.prisma,
    actorId: input.actorId,
    source: input.source,
    operation: input.operation,
    targetType: input.targetType,
    targetId: input.targetId,
    operationType: input.operationType || 'update',
    fieldPath: input.fieldPath,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    transactionId: input.transactionId,
    ip: input.ip,
  });
}

/**
 * 批量字段级审计 — 对比 before/after 快照，自动 diff 出变更字段并逐条记录。
 *
 * 适用场景：一次 PATCH 请求修改了多个字段，需要为每个变更字段单独写审计日志。
 *
 * @returns 写入的审计日志 ID 数组（每个变更字段一条）
 */
export async function writeFieldAuditDiff(params: {
  prisma: any;
  actorId: string;
  source: string;
  operation: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** 仅追踪这些字段（不传则追踪所有变更字段）*/
  trackedFields?: string[];
  operationType?: string;
  transactionId?: string;
  ip?: string | null;
}): Promise<string[]> {
  const { prisma, actorId, source, operation, targetType, targetId, before, after, trackedFields, operationType = 'update', transactionId, ip } = params;
  const ids: string[] = [];

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (trackedFields && !trackedFields.includes(key)) continue;
    const b = before[key];
    const a = after[key];
    // 跳过未变更字段（浅比较）
    if (JSON.stringify(b) === JSON.stringify(a)) continue;

    const id = await writeFieldAuditLog({
      prisma,
      actorId,
      source,
      operation,
      targetType,
      targetId,
      fieldPath: key,
      beforeValue: b ?? null,
      afterValue: a ?? null,
      operationType,
      transactionId,
      ip,
    });
    ids.push(id);
  }

  return ids;
}

export function actorIdFromRequest(req: any): string {
  return req?.actor?.userId || req?.actor?.id || 'api';
}
