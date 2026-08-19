/**
 * approvalKernelRoute.ts — Phase 1 共享内核：DR-007 审批内核操作 API
 *
 * 与 approvalRoute.ts（业务审批中心列表/decide）的关系：
 *   本路由是独立新增能力，不改现有 decide 流程；挂载点由主代理在 index.ts 收口。
 *
 * 端点：
 *   POST /:id/delegate         — 审批人主动转派（BASE-39-B2 / DR7-B2）
 *   POST /:id/boss-bypass      — BOSS 最终兜底特批（BASE-39-B3 / DR-041 绝密级）
 *   GET  /:id/resolution-trace — DR-007 解析路径审计字段只读视图
 *
 * 权限（服务端强制执行，fail-closed）：
 *   - 全部端点仅 JWT（extractActorFromRequest），无 token 401
 *   - delegate：仅当前 reviewerId 本人可调用；禁止委派给申请人（防自审）；reason ≥10 字
 *   - boss-bypass：仅 actor.roles 含 'owner'（SUPER_ADMIN legacy 映射）；reason ≥30 字
 *   - resolution-trace：owner / admin / manager 角色可读
 *   - delegate / boss-bypass 仅 status='pending' 可操作（409 otherwise）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import { approvalEventBus } from '../agent/events';

// 内核读操作可见角色（与业务审批中心一致）
const KERNEL_READ_ROLES = ['owner', 'admin', 'manager'];
// BOSS 最终兜底特批：仅 owner（SUPER_ADMIN legacy 映射，BASE-39-B3：系统管理员 Z 也不得写）
const BOSS_BYPASS_ROLES = ['owner'];

const DELEGATE_REASON_MIN = 10;   // 委托理由最少 10 字（BASE-39-B2 建议值，服务端强制）
const BOSS_REASON_MIN = 30;       // BOSS 兜底理由最少 30 字（BASE-39-B3 fail-closed 强制）

export interface ApprovalKernelRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
}

export function createApprovalKernelRouter(options: ApprovalKernelRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth } = options;

  // ── 鉴权：仅 JWT；返回 actor（含 roles 供各端点做角色检查） ──
  const authenticate = (req: Request, res: Response): { userId: string; roles: string[] } | null => {
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) {
      res.status(401).json({ error: 'authentication required（审批内核仅接受 JWT 登录）' });
      return null;
    }
    return { userId: actor.userId, roles: actor.roles ?? [] };
  };

  const hasAnyRole = (roles: string[], allowed: string[]) => roles.some((r) => allowed.includes(r));

  // ── 内部：审计日志 ID ──
  const auditId = () => `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ── POST /:id/delegate — 审批人主动转派 ──
  router.post('/:id/delegate', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const { toUserId, reason } = req.body || {};
      const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
      if (trimmedReason.length < DELEGATE_REASON_MIN) {
        return res.status(400).json({ error: `delegateReason 至少 ${DELEGATE_REASON_MIN} 字（审计强制）` });
      }
      const targetUserId = typeof toUserId === 'string' ? toUserId.trim() : '';
      if (!targetUserId) {
        return res.status(400).json({ error: 'toUserId 必填' });
      }

      const existing = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: `审批单 ${req.params.id} 不存在` });
      if (existing.status !== 'pending') {
        return res.status(409).json({ error: `审批单已处理（${existing.status}），不可转派` });
      }
      // BASE-39-B2：只有原 reviewerId 本人可写委托字段（申请人/被委托人抢单均 403）
      if (existing.reviewerId !== auth.userId) {
        return res.status(403).json({ error: 'DELEGATION_NOT_BY_REVIEWER：仅当前审批人本人可发起转派' });
      }
      if (targetUserId === auth.userId) {
        return res.status(400).json({ error: 'toUserId 与当前审批人相同，无需转派' });
      }
      // 防委派给申请人自审（fail-closed）
      if (targetUserId === existing.requesterId) {
        return res.status(403).json({ error: '禁止转派给申请人本人（会形成自审）' });
      }
      const targetUser = await prisma.userAccount.findFirst({
        where: { id: targetUserId, status: 'active', deletedAt: null },
        select: { id: true },
      });
      if (!targetUser) {
        return res.status(400).json({ error: 'toUserId 用户不存在或已停用' });
      }

      const now = new Date();
      const [updated] = await prisma.$transaction([
        prisma.approvalRequest.update({
          where: { id: existing.id },
          data: {
            delegatedBy: existing.reviewerId,
            delegatedAt: now,
            delegateReason: trimmedReason,
            reviewerId: targetUserId,
          },
        }),
        prisma.auditLog.create({
          data: {
            id: auditId(),
            actorId: auth.userId,
            action: 'delegate_approval',
            targetType: 'ApprovalRequest',
            targetId: existing.id,
            detail: {
              source: 'api:approvals-kernel',
              actionType: existing.actionType,
              delegatedTo: targetUserId,
              delegateReason: trimmedReason,
            } as any,
            ip: req.ip ?? null,
            operationType: 'transition',
            fieldPath: 'reviewerId',
            beforeValue: existing.reviewerId ?? undefined,
            afterValue: targetUserId,
            transactionId: null,
          },
        }),
      ]);

      logger.info('[ApprovalKernel] approval delegated', {
        id: existing.id, from: existing.reviewerId, to: targetUserId,
      });
      res.json({ item: updated });
    } catch (e: any) {
      logger.error('[ApprovalKernel] POST delegate failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to delegate approval' });
    }
  });

  // ── POST /:id/boss-bypass — BOSS 最终兜底特批 ──
  router.post('/:id/boss-bypass', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    // BASE-39-B3：仅 BOSS 容器（owner）；系统管理员 admin 一律 403 BOSS_BYPASS_REQUIRES_OWNER
    if (!hasAnyRole(auth.roles, BOSS_BYPASS_ROLES)) {
      return res.status(403).json({ error: 'BOSS_BYPASS_REQUIRES_OWNER：仅超级管理员（BOSS）可最终兜底特批' });
    }
    try {
      const { reason } = req.body || {};
      const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
      if (trimmedReason.length < BOSS_REASON_MIN) {
        return res.status(400).json({ error: `bossFinalBypassReason 至少 ${BOSS_REASON_MIN} 字（绝密级审计强制，fail-closed）` });
      }

      const existing = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: `审批单 ${req.params.id} 不存在` });
      if (existing.status !== 'pending') {
        return res.status(409).json({ error: `审批单已处理（${existing.status}），不可兜底特批` });
      }

      const now = new Date();
      const [updated] = await prisma.$transaction([
        prisma.approvalRequest.update({
          where: { id: existing.id },
          data: {
            status: 'approved',
            decidedAt: now,
            decisionNote: `[BOSS_FINAL_BYPASS] ${trimmedReason}`,
            bossFinalBypassBy: auth.userId,
            bossFinalBypassAt: now,
            bossFinalBypassReason: trimmedReason,
          },
        }),
        prisma.auditLog.create({
          data: {
            id: auditId(),
            actorId: auth.userId,
            action: 'boss_final_bypass',
            targetType: 'ApprovalRequest',
            targetId: existing.id,
            detail: {
              source: 'api:approvals-kernel',
              actionType: existing.actionType,
              originalReviewerId: existing.reviewerId,
              bossFinalBypassReason: trimmedReason,
            } as any,
            ip: req.ip ?? null,
            operationType: 'transition',
            fieldPath: 'status',
            beforeValue: 'pending',
            afterValue: 'approved',
            transactionId: null,
          },
        }),
      ]);

      logger.warn('[ApprovalKernel] boss final bypass approved', { id: existing.id, bossId: auth.userId, actionType: existing.actionType });

      // 跨链路唤醒：与 approvalRoute decide / agent resolve 同一事件契约（agentLoop 按 id 匹配恢复）
      approvalEventBus.emit('resolved', existing.id, {
        decision: 'approved',
        decisionNote: `[BOSS_FINAL_BYPASS] ${trimmedReason}`,
      });

      res.json({ item: updated });
    } catch (e: any) {
      logger.error('[ApprovalKernel] POST boss-bypass failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to boss-bypass approval' });
    }
  });

  // ── GET /:id/resolution-trace — DR-007 解析路径审计字段只读视图 ──
  router.get('/:id/resolution-trace', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (requireAuth && !hasAnyRole(auth.roles, KERNEL_READ_ROLES)) {
      return res.status(403).json({ error: 'forbidden：仅管理层 / 部门主管可查看解析轨迹' });
    }
    try {
      const existing = await prisma.approvalRequest.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          status: true,
          actionType: true,
          requesterId: true,
          reviewerId: true,
          reviewerResolverRoute: true,
          departmentSnapshotId: true,
          delegatedBy: true,
          delegatedAt: true,
          delegateReason: true,
          clientReviewerIdSupplied: true,
          bossFinalBypassBy: true,
          bossFinalBypassAt: true,
          bossFinalBypassReason: true,
          bypassedApprovalId: true,
        },
      });
      if (!existing) return res.status(404).json({ error: `审批单 ${req.params.id} 不存在` });
      res.json({ item: existing });
    } catch (e: any) {
      logger.error('[ApprovalKernel] GET resolution-trace failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to load resolution trace' });
    }
  });

  return router;
}
