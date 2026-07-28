import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEmailRouter } from '../route';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const ownerToken = jwt.sign({ userId: 'u1', roles: ['owner'] }, SECRET);
const apiKeys = new Set(['test-key']);

// mock nodemailer（route 真实调用 SMTP，测试需拦截）
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: '<route-test-msg@bambook.local>' }),
    })),
  },
}));

function makeApp(opts: {
  emailRow?: any;
  updateFail?: boolean;
  auditFail?: boolean;
} = {}) {
  const emailRow = opts.emailRow === undefined ? {
    id: 'EML__1', direction: 'outbound', mailbox: 'Outbox',
    fromAddress: 'a@bambook.local', fromName: 'Bambook',
    toAddresses: JSON.stringify(['c@d.com']), ccAddresses: null,
    subject: 'Test', bodyText: 'Body', bodyHtml: null, messageId: null, sentAt: null,
  } : opts.emailRow;

  const prisma = {
    email: {
      findUnique: vi.fn().mockResolvedValue(emailRow),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (fn: any) => {
      const tx = {
        email: { update: opts.updateFail ? vi.fn().mockRejectedValue(new Error('DB_LOCK')) : vi.fn().mockResolvedValue({}) },
        auditLog: { create: opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({}) },
      };
      return await fn(tx);
    }),
  } as any;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (req.headers.cookie) {
      const cookies: Record<string,string> = {};
      req.headers.cookie.split(';').forEach((c: string) => {
        const [k, v] = c.trim().split('=');
        cookies[k] = v;
      });
      req.cookies = cookies;
    }
    next();
  });
  app.use('/api/v1/email', createEmailRouter({ prisma, requireAuth: true, apiKeys }));
  return { app, prisma };
}

const VALID_BODY = { email: 'test@bambook.com', password: 'pass123' };

describe('task ERP-P1 outbox-send route: POST /api/v1/email/outbox/:id/send', () => {
  it('成功 → 200 + ok:true + messageId', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/email/outbox/EML__1/send').set('Cookie', `bambook_token=${ownerToken}`).send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.messageId).toBeTruthy();
  });

  it('EMAIL_NOT_FOUND → 404', async () => {
    const { app } = makeApp({ emailRow: null });
    const res = await request(app).post('/api/v1/email/outbox/NOPE/send').set('Cookie', `bambook_token=${ownerToken}`).send(VALID_BODY);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMAIL_NOT_FOUND');
  });

  it('EMAIL_NOT_OUTBOUND（inbound）→ 400', async () => {
    const { app } = makeApp({ emailRow: { id: 'E1', direction: 'inbound', mailbox: 'Outbox', toAddresses: '[]', messageId: null, sentAt: null } });
    const res = await request(app).post('/api/v1/email/outbox/E1/send').set('Cookie', `bambook_token=${ownerToken}`).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMAIL_NOT_OUTBOUND');
  });

  it('EMAIL_NOT_OUTBOX（mailbox=Sent）→ 400', async () => {
    const { app } = makeApp({ emailRow: { id: 'E1', direction: 'outbound', mailbox: 'Sent', toAddresses: '[]', messageId: null, sentAt: null } });
    const res = await request(app).post('/api/v1/email/outbox/E1/send').set('Cookie', `bambook_token=${ownerToken}`).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMAIL_NOT_OUTBOX');
  });

  it('MISSING_CREDENTIALS（无 password）→ 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/email/outbox/EML__1/send').set('Cookie', `bambook_token=${ownerToken}`).send({ email: 'test@bambook.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_CREDENTIALS');
  });

  it('DB_UPDATE_FAILED（SMTP 成功但 DB update 失败）→ 500 不静默成功', async () => {
    const { app } = makeApp({ updateFail: true });
    const res = await request(app).post('/api/v1/email/outbox/EML__1/send').set('Cookie', `bambook_token=${ownerToken}`).send(VALID_BODY);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DB_UPDATE_FAILED');
    expect(res.body.error.message).toContain('SMTP sent'); // 提示已发但 DB 没记录
  });

  it('audit reject → DB_UPDATE_FAILED（audit 失败也不静默成功）', async () => {
    const { app } = makeApp({ auditFail: true });
    const res = await request(app).post('/api/v1/email/outbox/EML__1/send').set('Cookie', `bambook_token=${ownerToken}`).send(VALID_BODY);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DB_UPDATE_FAILED');
  });
});
