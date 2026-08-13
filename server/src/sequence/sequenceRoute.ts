/**
 * sequenceRoute.ts — Phase 0-03 编号发号器路由（管理员/超级管理员）
 *
 * 接口清单（所有接口挂 `/api/system/sequences`，需登录）：
 *   GET  /                          → 列出全部 11 类编号序列当前状态（currentSeq / nextSeqPreview / periodKey…）
 *   GET  /:seqType/status           → 查看单类编号状态
 *   GET  /:seqType/peek-next        → 预览下一编号（不消费，不加锁，用于表单默认预填展示）
 *   POST /:seqType/consume          → 手动取号（谨慎使用！正常应由业务接口在事务里调用 nextNumber）
 *                                       — scope: sequences:write
 *   GET  /voided/list               → 作废单号查询（支持 seqType / periodKey / 日期区间 / 操作人 / 单据ID 过滤）
 *                                       — scope: sequences:read
 *   POST /voided/mark               → 手工标记作废（管理员操作权限）
 *                                       — scope: sequences:write
 *
 * 与旧 shared/businessNumberService 的关系：
 *   - 旧路由继续存在且功能不变；本路由为新统一 Sequence 引擎服务
 *   - 若业务尚未迁移，此接口仅展示 / 管理新 11 类序列即可，互不干扰
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { createSequenceService, ALL_SEQUENCE_TYPES, isSequenceType, type SequenceType, SEQUENCE_TYPE_CONFIGS } from '../sequence/sequenceService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const seqSvc = createSequenceService(prisma);

const router = Router();

// ------------------ 守卫：本模块全部要求 JWT 登录 ------------------
router.use(requireAuth as any);

// helper：取出 actorId
function getActorId(req: Request): string {
  const anyReq = req as any;
  return anyReq.actor?.id || anyReq.user?.id || anyReq.actorId || 'anonymous';
}

// ================================================================
// 1. 列出全部 11 类编号状态
// ================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const statuses = await seqSvc.listSequenceStatuses(prisma as any);
    res.json({ ok: true, data: statuses });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ================================================================
// 2. 单类 seqType 当前状态
// ================================================================
router.get('/:seqType/status', async (req: Request, res: Response) => {
  try {
    const { seqType } = req.params;
    if (!isSequenceType(seqType)) return res.status(400).json({ ok: false, error: `未知 seqType，合法值：${ALL_SEQUENCE_TYPES.join(' | ')}` });
    const dateStr = (req.query.date as string | undefined);
    const date = dateStr ? new Date(dateStr) : new Date();
    const st = await seqSvc.getSequenceStatus(prisma as any, seqType as SequenceType, { date });
    res.json({ ok: true, data: st });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ================================================================
// 3. 预览下一号（不消费，不加锁，供前端表单默认值展示）
// ================================================================
router.get('/:seqType/peek-next', async (req: Request, res: Response) => {
  try {
    const { seqType } = req.params;
    if (!isSequenceType(seqType)) return res.status(400).json({ ok: false, error: `未知 seqType：${seqType}` });
    const dateStr = (req.query.date as string | undefined);
    const date = dateStr ? new Date(dateStr) : new Date();
    const preview = await seqSvc.peekNextNumber(prisma as any, seqType as SequenceType, { date });
    res.json({ ok: true, data: { preview } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ================================================================
// 4. 手动取号（非事务环境谨慎使用！正常业务应在其事务内调用 nextNumber）
// ================================================================
router.post('/:seqType/consume', async (req: Request, res: Response) => {
  try {
    const { seqType } = req.params;
    if (!isSequenceType(seqType)) return res.status(400).json({ ok: false, error: `未知 seqType：${seqType}` });
    const dateStr = (req.body?.date as string | undefined);
    const date = dateStr ? new Date(dateStr) : new Date();

    const number = await prisma.$transaction(async (tx) => {
      return seqSvc.nextNumber(tx as any, seqType as SequenceType, { date });
    });

    const actorId = getActorId(req);
    res.json({ ok: true, data: { seqType, number, consumedAt: new Date().toISOString(), by: actorId } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ================================================================
// 5. 作废单号列表查询
// ================================================================
router.get('/voided/list', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const seqType = q.seqType as string | undefined;
    if (seqType && !isSequenceType(seqType)) {
      return res.status(400).json({ ok: false, error: `未知 seqType：${seqType}` });
    }
    const list = await seqSvc.listVoided(prisma as any, {
      seqType: seqType as SequenceType | undefined,
      periodKey: (q.periodKey as string) || undefined,
      sourceDocType: (q.sourceDocType as string) || undefined,
      sourceDocId: (q.sourceDocId as string) || undefined,
      voidedBy: (q.voidedBy as string) || undefined,
      fromDate: (q.fromDate as string) || undefined,
      toDate: (q.toDate as string) || undefined,
      limit:  q.limit  ? parseInt(q.limit as string, 10) : undefined,
      offset: q.offset ? parseInt(q.offset as string, 10) : undefined,
    });
    res.json({ ok: true, data: list });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ================================================================
// 6. 手工标记作废（管理员操作，建议与 Phase0-04 audit log 联用）
// ================================================================
router.post('/voided/mark', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { seqType, number, reason, sourceDocId, sourceDocType, periodKey } = body;
    if (!isSequenceType(seqType)) {
      return res.status(400).json({ ok: false, error: `未知或缺失 seqType` });
    }
    if (!number || typeof number !== 'string' || !number.trim()) {
      return res.status(400).json({ ok: false, error: `缺失参数 number（完整编号字符串）` });
    }
    const actorId = getActorId(req);
    const metadata = {
      ip: (req as any).ip,
      ua: req.headers['user-agent'] || null,
      markedAt: new Date().toISOString(),
      ...(typeof body.metadata === 'object' && body.metadata ? body.metadata : {}),
    };
    const cfg = SEQUENCE_TYPE_CONFIGS[seqType as SequenceType];
    const finalPeriodKey = periodKey || (cfg.period === 'none' ? '__global__' : undefined);
    const result = await prisma.$transaction(async (tx) =>
      seqSvc.markVoided(tx as any, {
        seqType: seqType as SequenceType,
        number: (number as string).trim(),
        reason: reason || null,
        voidedBy: actorId,
        sourceDocId: sourceDocId || null,
        sourceDocType: sourceDocType || null,
        periodKey: finalPeriodKey,
        metadata,
      }),
    );
    res.json({ ok: true, data: result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export const sequenceRouter = router;
export default router;
