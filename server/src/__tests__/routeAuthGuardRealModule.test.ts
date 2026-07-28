/**
 * Real module API-key-only→401 regression (task_mrcex1at review_changes round 2)
 *
 * Verifies that real module routers (not simulated) reject API-key-only write requests.
 * At least 1 entry per module: finance/shipping/development/email.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFinanceRouter } from '../finance/route';
import { createShippingRouter } from '../shipping/route';
import { createDevelopmentRouter } from '../development/route';
import { createEmailRouter } from '../email/route';

const validApiKey = 'test-api-key';
const apiKeys = new Set([validApiKey]);

function makeMockPrisma() {
  return {
    invoice: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), count: vi.fn(async () => 0) },
    paymentVoucher: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    allocation: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    shipment: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(async () => 0) },
    developmentCase: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(async () => 0) },
    email: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), update: vi.fn(), create: vi.fn(), count: vi.fn(async () => 0) },
    auditLog: { create: vi.fn(async () => ({ id: 'alog' })) },
    entityLink: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({})),
  } as any;
}

function mountRouter(routerFactory: any, opts: any) {
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
  app.use('/test', routerFactory(opts));
  return app;
}

describe('Real module auth · API-key-only write → 401', () => {

  it('Finance POST / → 401 with API-key only (no JWT)', async () => {
    const app = mountRouter(createFinanceRouter, { prisma: makeMockPrisma(), requireAuth: true, apiKeys });
    const res = await request(app)
      .post('/test')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT/);
  });

  it('Shipping POST / → 401 with API-key only', async () => {
    const app = mountRouter(createShippingRouter, { prisma: makeMockPrisma(), requireAuth: true, apiKeys });
    const res = await request(app)
      .post('/test')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT/);
  });

  it('Development POST / → 401 with API-key only', async () => {
    const app = mountRouter(createDevelopmentRouter, { prisma: makeMockPrisma(), requireAuth: true, apiKeys });
    const res = await request(app)
      .post('/test')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT/);
  });

  it('Email PATCH /:id → 401 with API-key only', async () => {
    const app = mountRouter(createEmailRouter, { prisma: makeMockPrisma(), requireAuth: true, apiKeys });
    const res = await request(app)
      .patch('/test/some-id')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT/);
  });
});

describe('Real module auth · no-auth GET → 401, API-key GET → passes guard', () => {

  it('Finance GET / → 401 when no auth', async () => {
    const app = mountRouter(createFinanceRouter, { prisma: makeMockPrisma(), requireAuth: true, apiKeys });
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
  });

  it('Finance GET / → passes guard (not 401/403) with valid API-key', async () => {
    const app = mountRouter(createFinanceRouter, { prisma: makeMockPrisma(), requireAuth: true, apiKeys });
    const res = await request(app).get('/test').set('x-bambook-api-key', validApiKey);
    // Should pass auth (may be 200 or 500 due to mock prisma, but NOT 401/403)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
