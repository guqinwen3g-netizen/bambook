/**
 * 阶段 D / D6：实体级审计查询路由（非 admin）
 *
 *   GET /api/v1/audit/entity?targetType=Order&targetId=ORD_1
 *
 * 与 /api/admin/audit-logs（owner/admin 全局查询）的分工：
 *   - 本端点面向业务用户：强制 targetType+targetId（防全表扫描），
 *     按 targetType 映射模块读权限门禁（merchandiser 可读订单审计等），
 *     固定 limit 20 倒序返回。
 *   - admin 全局端点保持不变。
 *
 * 认证：JWT 或 API-Key（复用 createModuleAuthGuard，与 /api/v1/* 一致）；
 * 授权（W-C 权限收口，双层 fail closed）：
 *   第一层 requirePermission('audit:read') —— 审计域读 scope（默认矩阵 Finance/Admin/SuperAdmin；
 *     其他角色需经 DB RolePermission 显式授予后随 JWT permissions 携带）；
 *   第二层 canReadEntityAudit 角色映射 —— 按 targetType 对齐模块读权限（既存 D6 语义，保留）。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { buildAuditLogQuery, canReadEntityAudit } from './entityQuery';

type AuditRouterOptions = {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
};

/** 实体审计固定返回条数（倒序取最近） */
const ENTITY_AUDIT_LIMIT = 20;

export function createAuditRouter(options: AuditRouterOptions) {
  const router = Router();
  const guard = createModuleAuthGuard({ requireAuth: options.requireAuth, apiKeys: options.apiKeys });

  router.get('/entity', guard, requirePermission('audit:read'), async (req: Request, res: Response) => {
    const { targetType, targetId } = req.query as any;

    // 强制两参（防全表扫描；实体审计语义要求精确定位）
    if (!targetType || typeof targetType !== 'string' || !targetId || typeof targetId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'TARGET_REQUIRED',
        message: 'targetType and targetId are both required.',
      });
    }

    // 模块读权限门禁（fail closed）
    const actor = (req as any).actor;
    const actorRoles: string[] = actor?.roles ?? [];
    if (!canReadEntityAudit(actorRoles, targetType)) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: `Insufficient role to read audit history of ${targetType}.`,
      });
    }

    const built = buildAuditLogQuery({ targetType, targetId, limit: String(ENTITY_AUDIT_LIMIT) });
    if (!built.ok) {
      return res.status(built.status).json({ ok: false, error: built.error, message: built.message });
    }

    const logs = await options.prisma.auditLog.findMany({
      where: built.where,
      orderBy: { createdAt: 'desc' },
      take: built.limit,
      include: { actor: { select: { id: true, displayName: true, email: true } } },
    });

    res.json({
      ok: true,
      logs: logs.map(l => ({
        id: l.id,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        operationType: l.operationType,
        fieldPath: l.fieldPath,
        beforeValue: l.beforeValue,
        afterValue: l.afterValue,
        detail: l.detail,
        createdAt: l.createdAt,
        actor: { id: l.actor.id, displayName: l.actor.displayName, email: l.actor.email },
      })),
    });
  });

  return router;
}
