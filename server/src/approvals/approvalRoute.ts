/**
 * 业务审批中心 API — /api/v1/approvals
 *
 * PRD 19.21（通知与审批中心 · 审批 Tab）+ 9.2 价格审批规则落地：
 *   - 第九章业务规则命中的审批（如 quotation:price-deviation 双轨偏差）集中在此处理
 *   - 与 Agent 工具审批（Assistant 内 resolve 流程，actionType 为 tool:*）分离：
 *     本路由只服务业务审批，工具审批不出现在列表
 *
 * 端点：
 *   GET  /?status=pending|done  — 待办 / 已办（含 requester/reviewer 摘要）
 *   POST /:id/decide            — 决策 { status: approved|rejected, decisionNote? }
 *
 * 权限（服务端强制执行，PRD 9.6）：
 *   - 仅 JWT（owner / admin / manager）；API-Key 一律 401
 *   - 驳回必须填 decisionNote（PRD 19.21「驳回必填意见」）
 *   - 申请人不可审批自己的单子（自审 403）
 *   - 仅 pending 可决策，重复决策 409
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';

// 业务审批可见/可决策角色：管理层（owner/admin）+ 部门主管（manager）
const APPROVER_ROLES = ['owner', 'admin', 'manager'];

// Agent 工具审批走 Assistant resolve 流程，不在业务审批中心展示
const EXCLUDED_ACTION_PREFIX = 'tool:';

export interface ApprovalRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
}

const personSelect = { id: true, displayName: true, email: true } as const;

export function createApprovalRouter(options: ApprovalRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth } = options;

  // ── 鉴权 + 角色门禁：仅 JWT 且具备审批角色 ──
  const authenticate = (req: Request, res: Response): { userId: string } | null => {
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) {
      res.status(401).json({ error: 'authentication required（业务审批仅接受 JWT 登录）' });
      return null;
    }
    if (requireAuth && !actor.roles?.some(r => APPROVER_ROLES.includes(r))) {
      res.status(403).json({ error: 'forbidden：仅管理层 / 部门主管可处理业务审批' });
      return null;
    }
    return { userId: actor.userId };
  };

  // ── GET / — 待办 / 已办列表 ──
  router.get('/', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const view = req.query.status === 'done' ? 'done' : 'pending';
      const where: any = view === 'pending'
        ? { status: 'pending', actionType: { not: { startsWith: EXCLUDED_ACTION_PREFIX } } }
        : { status: { in: ['approved', 'rejected'] }, actionType: { not: { startsWith: EXCLUDED_ACTION_PREFIX } } };
      const items = await prisma.approvalRequest.findMany({
        where,
        orderBy: view === 'pending' ? { createdAt: 'asc' } : { decidedAt: 'desc' }, // 待办按先到先审；已办按决策时间倒序
        take: 100,
        include: { requester: { select: personSelect }, reviewer: { select: personSelect } },
      });
      res.json({ items });
    } catch (e: any) {
      logger.error('[ApprovalRoute] GET list failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list approvals' });
    }
  });

  // ── POST /:id/decide — 决策（通过 / 驳回） ──
  router.post('/:id/decide', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const { status, decisionNote } = req.body || {};
      if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ error: 'status 须为 approved 或 rejected' });
      }
      const note = typeof decisionNote === 'string' ? decisionNote.trim() : '';
      if (status === 'rejected' && !note) {
        return res.status(400).json({ error: '驳回必须填写审批意见（decisionNote）' });
      }

      const existing = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: `审批单 ${req.params.id} 不存在` });
      if (existing.status !== 'pending') {
        return res.status(409).json({ error: `审批单已处理（${existing.status}），不可重复决策` });
      }
      if (existing.requesterId === auth.userId) {
        return res.status(403).json({ error: '申请人不可审批自己的单子（自审禁止）' });
      }

      const now = new Date();
      const [updated] = await prisma.$transaction([
        prisma.approvalRequest.update({
          where: { id: existing.id },
          data: { status, reviewerId: auth.userId, decisionNote: note || null, decidedAt: now },
          include: { requester: { select: personSelect }, reviewer: { select: personSelect } },
        }),
        prisma.auditLog.create({
          data: {
            id: `alog_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
            actorId: auth.userId,
            action: status === 'approved' ? 'approve_business_request' : 'reject_business_request',
            targetType: 'ApprovalRequest',
            targetId: existing.id,
            detail: {
              source: 'api:approvals',
              actionType: existing.actionType,
              targetEntity: { type: existing.targetType, id: existing.targetId },
              decisionNote: note || null,
            } as any,
            ip: req.ip ?? null,
            operationType: 'transition',
            fieldPath: 'status',
            beforeValue: 'pending',
            afterValue: status,
            transactionId: null,
          },
        }),
      ]);

      logger.info('[ApprovalRoute] approval decided', { id: existing.id, actionType: existing.actionType, status, reviewerId: auth.userId });
      res.json({ item: updated });
    } catch (e: any) {
      logger.error('[ApprovalRoute] POST decide failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to decide approval' });
    }
  });

  return router;
}
