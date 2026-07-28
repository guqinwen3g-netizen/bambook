import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCreateOutboxEmail = vi.fn();
const mockCreateReplyOutboxEmail = vi.fn();
vi.mock('../emailOutboxMutationService', () => ({
  createOutboxEmail: (...args: any[]) => mockCreateOutboxEmail(...args),
  createReplyOutboxEmail: (...args: any[]) => mockCreateReplyOutboxEmail(...args),
}));

import { createEmailRouter } from '../route';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/email', createEmailRouter({ prisma: {} as any, requireAuth: false, apiKeys: new Set() }));
  return app;
}

const validBody = { fromAddress: 'me@b.com', to: ['r@t.com'], subject: 'Hi', bodyText: 'Body' };

describe('POST /api/v1/email/outbox route → service contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('compose success → 201 with emailId/mailbox/direction/auditId', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: true, data: { emailId: 'EML__1', auditId: 'alog_1', mailbox: 'Outbox', direction: 'outbound' } });
    const res = await request(makeApp()).post('/api/v1/email/outbox').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.emailId).toBe('EML__1');
    expect(res.body.mailbox).toBe('Outbox');
    expect(res.body.direction).toBe('outbound');
  });

  it('invalid input → 400 MISSING_FROM', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: false, error: { code: 'MISSING_FROM', message: 'fromAddress required' } });
    const res = await request(makeApp()).post('/api/v1/email/outbox').send({ to: ['r@t.com'], subject: 'Hi' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FROM');
  });

  it('CREATE_FAILED → 500', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: false, error: { code: 'CREATE_FAILED', message: 'db error' } });
    const res = await request(makeApp()).post('/api/v1/email/outbox').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_FAILED');
  });

  it('SYNC_REF_FAILED → 500', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: false, error: { code: 'SYNC_REF_FAILED', message: 'sync fail' } });
    const res = await request(makeApp()).post('/api/v1/email/outbox').send(validBody);
    expect(res.status).toBe(500);
  });

  it('AUDIT_FAILED → 500', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: false, error: { code: 'AUDIT_FAILED', message: 'audit fail' } });
    const res = await request(makeApp()).post('/api/v1/email/outbox').send(validBody);
    expect(res.status).toBe(500);
  });

  it('route only calls service once', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: true, data: { emailId: 'EML__1', auditId: 'a', mailbox: 'Outbox', direction: 'outbound' } });
    await request(makeApp()).post('/api/v1/email/outbox').send(validBody);
    expect(mockCreateOutboxEmail).toHaveBeenCalledTimes(1);
  });

  it('password not persisted in response', async () => {
    mockCreateOutboxEmail.mockResolvedValue({ ok: true, data: { emailId: 'EML__1', auditId: 'a', mailbox: 'Outbox', direction: 'outbound' } });
    const res = await request(makeApp()).post('/api/v1/email/outbox').send({ ...validBody, password: 'supersecret' });
    expect(JSON.stringify(res.body)).not.toContain('supersecret');
  });
});

describe('POST /api/v1/email/replies route → service contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reply success → 201', async () => {
    mockCreateReplyOutboxEmail.mockResolvedValue({ ok: true, data: { emailId: 'EML__2', auditId: 'alog_2', mailbox: 'Outbox', direction: 'outbound' } });
    const res = await request(makeApp()).post('/api/v1/email/replies').send({ ...validBody, originalEmailId: 'EML__orig' });
    expect(res.status).toBe(201);
    expect(res.body.emailId).toBe('EML__2');
  });

  it('ORIGINAL_EMAIL_NOT_FOUND → 404', async () => {
    mockCreateReplyOutboxEmail.mockResolvedValue({ ok: false, error: { code: 'ORIGINAL_EMAIL_NOT_FOUND', message: 'not found' } });
    const res = await request(makeApp()).post('/api/v1/email/replies').send({ ...validBody, originalEmailId: 'EML__missing' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORIGINAL_EMAIL_NOT_FOUND');
  });
});
