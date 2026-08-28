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
 *   - 已指派 reviewerId 的单仅该审批人本人可决议（owner BOSS 兜底除外），
 *     归属判定唯一真源 approvalDecisionService.evaluateDecideOwnership（403 APPROVAL_NOT_ASSIGNED）
 *   - 仅 pending 可决策，重复决策 409
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import { approvalEventBus } from '../agent/events';
import { evaluateDecideOwnership } from './approvalDecisionService';

// 业务审批可见/可决策角色：管理层（owner/admin）+ 部门主管（manager）
const APPROVER_ROLES = ['owner', 'admin', 'manager'];

// Agent 工具审批走 Assistant resolve 流程，不在业务审批中心展示
const EXCLUDED_ACTION_PREFIX = 'tool:';

export interface ApprovalRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  /**
   * 审批决策落库后的同步钩子（P0-003 审批→业务单据联动）。
   * targetType=OrderChangeRequest 等业务单据在此同步自身状态；
   * 钩子失败仅记日志（审批结果已生效，不回滚），供人工介入。
   */
  onDecided?: (approval: {
    id: string; actionType: string; targetType: string; targetId: string | null;
    status: 'approved' | 'rejected'; reviewerId: string; decisionNote?: string;
  }) => Promise<void>;
}

const personSelect = { id: true, displayName: true, email: true } as const;

export function createApprovalRouter(options: ApprovalRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, onDecided } = options;

  // ── 鉴权 + 角色门禁：仅 JWT 且具备审批角色 ──
  const authenticate = (req: Request, res: Response): { userId: string; roles: string[] } | null => {
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) {
      res.status(401).json({ error: 'authentication required（业务审批仅接受 JWT 登录）' });
      return null;
    }
    if (requireAuth && !actor.roles?.some(r => APPROVER_ROLES.includes(r))) {
      res.status(403).json({ error: 'forbidden：仅管理层 / 部门主管可处理业务审批' });
      return null;
    }
    return { userId: actor.userId, roles: actor.roles ?? [] };
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
      // 决议人归属校验（service 层唯一真源）：已指派 reviewer 的单仅本人可决，
      // owner BOSS 兜底除外；SM 不可决议路由给总领导档（如 pay_gt5 上抬）的单
      const ownership = evaluateDecideOwnership(existing, auth);
      if (!ownership.ok) {
        return res.status(403).json({ error: ownership.message });
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

      // 跨链路唤醒：Agent 挂起中的审批（如经通知链接从审批中心直接决议 tool:* 单）
      // 依赖 approvalEventBus 'resolved' 事件恢复循环；与 agent/route.ts resolve 端点同一事件契约。
      // 无监听者时 emit 无副作用（业务审批常规路径不受影响）。
      approvalEventBus.emit('resolved', existing.id, {
        decision: status,
        decisionNote: note || undefined,
      });

      // 审批→业务单据状态同步（P0-003）：OrderChangeRequest 等在钩子内同步
      // 审批结果已落库生效，钩子失败仅记日志（不回滚审批），供人工介入。
      if (onDecided) {
        try {
          await onDecided({
            id: existing.id,
            actionType: existing.actionType,
            targetType: existing.targetType,
            targetId: existing.targetId,
            status,
            reviewerId: auth.userId,
            decisionNote: note || undefined,
          });
        } catch (syncErr: any) {
          logger.error('[ApprovalRoute] onDecided 同步钩子失败（审批已生效，需人工介入）', {
            approvalId: existing.id, targetType: existing.targetType, error: syncErr?.message,
          });
        }
      }

      res.json({ item: updated });
    } catch (e: any) {
      logger.error('[ApprovalRoute] POST decide failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to decide approval' });
    }
  });

  return router;
}
