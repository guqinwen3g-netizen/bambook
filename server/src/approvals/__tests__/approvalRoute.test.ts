import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createApprovalRouter } from '../approvalRoute';
import { approvalEventBus } from '../../agent/events';

/**
 * 业务审批中心路由契约测试（PRD 19.21 + 9.6）：
 *   - JWT 强制（无 token 401；API-Key 不接受）
 *   - 角色门禁（requireAuth=true 时仅 owner/admin/manager）
 *   - GET / 待办/已办视图 + 排除 tool:* Agent 工具审批
 *   - POST /:id/decide 输入校验 / 404 / 409 重复决策 / 403 自审 / 审计日志
 */

// 可控的 actor mock：默认 manager 角色的 JWT 用户
let mockActor: { userId: string; roles: string[] } | null = { userId: 'u_reviewer', roles: ['manager'] };
vi.mock('../../auth/middleware', () => ({
  extractActorFromRequest: () => mockActor,
}));

function makeApp(opts: {
  existing?: any;
  updateFail?: boolean;
  requireAuth?: boolean;
} = {}) {
  const existing = opts.existing ?? null;

  const approvalFindMany = vi.fn().mockResolvedValue([]);
  const approvalFindUnique = vi.fn().mockImplementation(async ({ where }: any) =>
    where.id === existing?.id ? existing : null);
  const approvalUpdate = opts.updateFail
    ? vi.fn().mockRejectedValue(new Error('UPDATE_BOOM'))
    : vi.fn().mockImplementation(async ({ where, data }: any) => ({
        ...existing,
        ...data,
        id: where.id,
        requester: { id: existing?.requesterId, displayName: '申请人', email: 'req@x.com' },
        reviewer: { id: data.reviewerId, displayName: '审批人', email: 'rev@x.com' },
      }));
  const auditCreate = vi.fn().mockResolvedValue({ id: 'AL-1' });

  const prisma: any = {
    approvalRequest: {
      findMany: approvalFindMany,
      findUnique: approvalFindUnique,
      update: approvalUpdate,
    },
    auditLog: { create: auditCreate },
    // 路由用数组形式 $transaction([update, auditCreate])
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/approvals', createApprovalRouter({
    prisma,
    requireAuth: opts.requireAuth ?? true,
  }));

  return { app, prisma, approvalFindMany, approvalFindUnique, approvalUpdate, auditCreate };
}

const pendingApproval = {
  id: 'ar_1',
  requesterId: 'u_requester',
  reviewerId: null,
  actionType: 'quotation:price-deviation',
  targetType: 'Quotation',
  targetId: 'QT_1',
  status: 'pending',
  risk: 'high',
  payload: { deviationPercent: 35, level: 'block' },
  decisionNote: null,
  createdAt: new Date('2026-08-09T10:00:00Z'),
  decidedAt: null,
};

beforeEach(() => {
  mockActor = { userId: 'u_reviewer', roles: ['manager'] };
});

describe('approvalRoute: 鉴权与角色门禁', () => {
  it('无 JWT → 401（API-Key 亦不接受）', async () => {
    mockActor = null;
    const { app } = makeApp();
    const res = await request(app)
      .get('/api/v1/approvals')
      .set('x-bambook-api-key', 'some-key');
    expect(res.status).toBe(401);
  });

  it('requireAuth=true 且角色不含审批权（sales）→ 403', async () => {
    mockActor = { userId: 'u_sales', roles: ['sales'] };
    const { app } = makeApp({ requireAuth: true });
    const res = await request(app).get('/api/v1/approvals');
    expect(res.status).toBe(403);
  });

  it.each(['owner', 'admin', 'manager'])('角色 %s → 200', async (role) => {
    mockActor = { userId: 'u_reviewer', roles: [role] };
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/approvals');
    expect(res.status).toBe(200);
  });
});

describe('approvalRoute: GET / 待办/已办列表', () => {
  it('默认待办视图：status=pending + 排除 tool:* + 先到先审', async () => {
    const { app, approvalFindMany } = makeApp();
    const res = await request(app).get('/api/v1/approvals');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    const args = approvalFindMany.mock.calls[0][0];
    expect(args.where.status).toBe('pending');
    expect(args.where.actionType).toEqual({ not: { startsWith: 'tool:' } });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('status=done → 已办视图：approved/rejected + 决策时间倒序', async () => {
    const { app, approvalFindMany } = makeApp();
    const res = await request(app).get('/api/v1/approvals?status=done');
    expect(res.status).toBe(200);
    const args = approvalFindMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ['approved', 'rejected'] });
    expect(args.where.actionType).toEqual({ not: { startsWith: 'tool:' } });
    expect(args.orderBy).toEqual({ decidedAt: 'desc' });
  });
});

describe('approvalRoute: POST /:id/decide 输入校验', () => {
  it('status 非法 → 400', async () => {
    const { app } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('rejected 缺 decisionNote → 400（驳回必填意见）', async () => {
    const { app } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'rejected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('审批意见');
  });

  it('审批单不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app)
      .post('/api/v1/approvals/ar_missing/decide')
      .send({ status: 'approved' });
    expect(res.status).toBe(404);
  });

  it('已处理审批单 → 409 不可重复决策', async () => {
    const { app } = makeApp({ existing: { ...pendingApproval, status: 'approved' } });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'rejected', decisionNote: '理由' });
    expect(res.status).toBe(409);
  });

  it('申请人审批自己的单子 → 403 自审禁止', async () => {
    mockActor = { userId: 'u_requester', roles: ['owner'] }; // 与 requesterId 相同
    const { app } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('自审');
  });
});

describe('approvalRoute: POST /:id/decide 跨链路唤醒（approvalEventBus）', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitSpy = vi.spyOn(approvalEventBus, 'emit').mockReturnValue(true);
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('decide approved → emit resolved（agentLoop 按 id 匹配可恢复挂起循环）', async () => {
    const { app } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved', decisionNote: '价格合理' });
    expect(res.status).toBe(200);
    expect(emitSpy).toHaveBeenCalledWith('resolved', 'ar_1', {
      decision: 'approved',
      decisionNote: '价格合理',
    });
  });

  it('decide rejected（含意见）→ emit resolved 携带 decisionNote', async () => {
    const { app } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'rejected', decisionNote: '折扣超限' });
    expect(res.status).toBe(200);
    expect(emitSpy).toHaveBeenCalledWith('resolved', 'ar_1', {
      decision: 'rejected',
      decisionNote: '折扣超限',
    });
  });

  it('409 重复决策 / 403 自审 / 404 不存在 → 不 emit（失败路径零副作用）', async () => {
    const { app: app409 } = makeApp({ existing: { ...pendingApproval, status: 'approved' } });
    await request(app409).post('/api/v1/approvals/ar_1/decide').send({ status: 'approved' });
    const { app: app403 } = makeApp({ existing: pendingApproval });
    mockActor = { userId: 'u_requester', roles: ['manager'] };
    await request(app403).post('/api/v1/approvals/ar_1/decide').send({ status: 'approved' });
    const { app: app404 } = makeApp({ existing: null });
    await request(app404).post('/api/v1/approvals/ar_missing/decide').send({ status: 'approved' });
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('approvalRoute: POST /:id/decide 决策落库', () => {
  it('approved → 200 + 写入 reviewer/decidedAt + 审计日志同事务', async () => {
    const { app, approvalUpdate, auditCreate, prisma } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved', decisionNote: '价格合理' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('approved');

    const updateData = approvalUpdate.mock.calls[0][0].data;
    expect(updateData.status).toBe('approved');
    expect(updateData.reviewerId).toBe('u_reviewer');
    expect(updateData.decisionNote).toBe('价格合理');
    expect(updateData.decidedAt).toBeInstanceOf(Date);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditData = auditCreate.mock.calls[0][0].data;
    expect(auditData.action).toBe('approve_business_request');
    expect(auditData.actorId).toBe('u_reviewer');
    expect(auditData.targetType).toBe('ApprovalRequest');
    expect(auditData.targetId).toBe('ar_1');
    expect(auditData.beforeValue).toBe('pending');
    expect(auditData.afterValue).toBe('approved');
    expect(auditData.detail.actionType).toBe('quotation:price-deviation');
  });

  it('rejected + decisionNote → 200 + 审计 action=reject_business_request', async () => {
    const { app, approvalUpdate, auditCreate } = makeApp({ existing: pendingApproval });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'rejected', decisionNote: '偏差过大，需重谈' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('rejected');
    expect(approvalUpdate.mock.calls[0][0].data.decisionNote).toBe('偏差过大，需重谈');
    expect(auditCreate.mock.calls[0][0].data.action).toBe('reject_business_request');
  });

  it('DB 异常 → 500', async () => {
    const { app } = makeApp({ existing: pendingApproval, updateFail: true });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved' });
    expect(res.status).toBe(500);
  });
});

describe('approvalRoute: POST /:id/decide 决议人归属校验（S3-δ · approvalDecisionService）', () => {
  // DR-007 已指派单：reviewerId 为服务端路由落点（pay_gt5 上抬档场景 = 落点总领导）
  const routedApproval = (reviewerId: string) => ({
    ...pendingApproval,
    reviewerId,
    actionType: 'finance:payment_request',
    payload: { requestNumber: 'PAYR-1', totalAmount: '100000', currency: 'CNY' },
  });

  it('SM 决议路由给总领导档的单（reviewerId=u_gm）→ 403 APPROVAL_NOT_ASSIGNED', async () => {
    mockActor = { userId: 'u_sm', roles: ['manager'] };
    const { app, approvalUpdate } = makeApp({ existing: routedApproval('u_gm') });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('APPROVAL_NOT_ASSIGNED');
    expect(approvalUpdate).not.toHaveBeenCalled();
  });

  it('SM 决议本档位单（reviewerId=本人）→ 放行 200 并落库', async () => {
    mockActor = { userId: 'u_sm', roles: ['manager'] };
    const { app, approvalUpdate } = makeApp({ existing: routedApproval('u_sm') });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved', decisionNote: '本团队小单，同意' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('approved');
    expect(approvalUpdate.mock.calls[0][0].data.reviewerId).toBe('u_sm');
  });

  it('指定 reviewer 的单被其他 manager 决议 → 403', async () => {
    mockActor = { userId: 'u_reviewer', roles: ['manager'] };
    const { app, approvalUpdate } = makeApp({ existing: routedApproval('u_other') });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'rejected', decisionNote: '越权驳回尝试' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('APPROVAL_NOT_ASSIGNED');
    expect(approvalUpdate).not.toHaveBeenCalled();
  });

  it('owner（BOSS 兜底）决议他人单 → 200（与内核 boss-bypass 同一角色口径）', async () => {
    mockActor = { userId: 'u_boss', roles: ['owner'] };
    const { app } = makeApp({ existing: routedApproval('u_gm') });
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved', decisionNote: 'BOSS 兜底决议' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('approved');
  });

  it('legacy 未指派单（reviewerId=null）→ 不额外拦截，角色门禁放行 200', async () => {
    mockActor = { userId: 'u_reviewer', roles: ['manager'] };
    const { app } = makeApp({ existing: pendingApproval }); // reviewerId: null
    const res = await request(app)
      .post('/api/v1/approvals/ar_1/decide')
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
  });
});
