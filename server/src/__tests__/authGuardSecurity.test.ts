/**
 * Security regression suite (Phase 0 · 任务 A3)
 *
 * 攻击向量覆盖（全部必须返回 401/403）：
 *   1. 伪造 token（非 JWT 格式 / 错误签名）→ 401
 *   2. 无 token 写操作 → 401
 *   3. 过期 token（exp 已过）→ 401
 *   4. API-Key 越权写（API-Key 不可写，仅 JWT 可写）→ 401
 *   5. IMAP 端点未认证 / API-Key 访问 → 401（IMAP 涉及邮箱凭证，必须 JWT）
 *
 * 正向回归：有效 JWT 通过写守卫，有效 API-Key 通过读守卫（确保守卫未误伤）。
 *
 * 测试使用真实模块 router（非模拟），mock prisma 避免连 DB。
 * 守卫机制：createModuleAuthGuard（JWT 走 jwt.verify 验签）+ requireJwtForWrite（写操作强制 JWT）。
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createProductsRouter } from '../products/route';
import { createBusinessProfilesRouter } from '../business-profiles/route';
import { createPdmlRouter } from '../pdml/route';
import { createSystemAssetsRouter } from '../system-assets/route';
import { createEmailRouter } from '../email/route';

const validApiKey = 'test-api-key-secure';
const apiKeys = new Set([validApiKey]);

// 与 middleware.ts 模块级单例 createAuthService() 一致的默认 secret
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';

/** 有效 JWT token（owner 角色，1h 有效）—— 用于正向回归 */
function makeValidToken(): string {
  return jwt.sign(
    { userId: 'usr_security_test', displayName: 'Security Tester', roles: ['owner'], permissions: [], departmentIds: ['company'] },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

/** 过期 JWT token（exp 设为 1 小时前，签名正确但已过期）—— 验签时抛 TokenExpiredError */
function makeExpiredToken(): string {
  return jwt.sign(
    { userId: 'usr_security_test', roles: ['owner'], permissions: [], departmentIds: ['company'] },
    JWT_SECRET,
    { expiresIn: '-1s' } as any,
  );
}

/** 伪造 token（非 JWT 格式，任意字符串）—— 原漏洞：requireWrite 仅检查 token 存在即放行 */
const FORGED_TOKEN = 'forged.token.signature.should.be.rejected';

/** 伪造 JWT（JWT 格式但用错误 secret 签名）—— 验签失败 */
function makeWrongSecretToken(): string {
  return jwt.sign(
    { userId: 'usr_security_test', roles: ['owner'], permissions: [], departmentIds: ['company'] },
    'completely-wrong-secret',
    { expiresIn: '1h' },
  );
}

function mountRouter(routerFactory: any, opts: any): express.Express {
  const app = express();
  app.use(express.json());
  // 简易 cookie 解析（moduleGuard 支持从 cookie 读 bambook_token）
  app.use((req: any, _res: any, next: any) => {
    if (req.headers.cookie) {
      const cookies: Record<string, string> = {};
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

function makeMockPrisma(): any {
  return {
    productAsset: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'pa1' })),
      update: vi.fn(async () => ({ id: 'pa1' })),
      delete: vi.fn(async () => ({})),
    },
    fabricProfile: { upsert: vi.fn(async () => ({})) },
    garmentProfile: { upsert: vi.fn(async () => ({})) },
    trimmingProfile: { upsert: vi.fn(async () => ({})) },
    businessProfile: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ id: 'b1' })),
      update: vi.fn(async () => ({ id: 'b1' })),
    },
    pdmlRawFabric: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
    },
    systemAsset: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    email: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    },
    emailAttachment: { findUnique: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({ id: 'alog' })) },
    $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn({}) : fn)),
  } as any;
}

const baseOpts = { prisma: makeMockPrisma(), requireAuth: true, apiKeys };

// ══════════════════════════════════════════════════════════════
// 攻击向量 1-3：伪造 token / 无 token / 过期 token → 401
// 重点验证 products 模块（原 requireWrite 不验签漏洞的修复）
// ══════════════════════════════════════════════════════════════
describe('Security · products 写操作 token 攻击 → 401', () => {
  it('伪造 token（任意字符串）POST /assets → 401（修复原不验签漏洞）', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .post('/test/assets')
      .set('Authorization', `Bearer ${FORGED_TOKEN}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('伪造 JWT（错误 secret 签名）POST /assets → 401', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .post('/test/assets')
      .set('Authorization', `Bearer ${makeWrongSecretToken()}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('无 token POST /assets → 401', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app).post('/test/assets').send({});
    expect(res.status).toBe(401);
  });

  it('过期 token POST /assets → 401', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .post('/test/assets')
      .set('Authorization', `Bearer ${makeExpiredToken()}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('伪造 token DELETE /assets/:id → 401', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .delete('/test/assets/pa-1')
      .set('Authorization', `Bearer ${FORGED_TOKEN}`);
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════
// 攻击向量 4：API-Key 越权写 → 401（API-Key 限只读，写操作必须 JWT）
// 覆盖 4 个原 API-Key 可写漏洞模块
// ══════════════════════════════════════════════════════════════
describe('Security · API-Key 越权写 → 401', () => {
  it('products POST /assets API-Key → 401', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .post('/test/assets')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT|Write/);
  });

  it('business-profiles POST / API-Key → 401', async () => {
    const app = mountRouter(createBusinessProfilesRouter, baseOpts);
    const res = await request(app)
      .post('/test')
      .set('x-bambook-api-key', validApiKey)
      .send({ kind: 'supplier', name: 'attacker' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT|Write/);
  });

  it('business-profiles DELETE /:id API-Key → 401', async () => {
    const app = mountRouter(createBusinessProfilesRouter, baseOpts);
    const res = await request(app)
      .delete('/test/bp-1')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).toBe(401);
  });

  it('pdml POST /sync API-Key → 401', async () => {
    const app = mountRouter(createPdmlRouter, baseOpts);
    const res = await request(app)
      .post('/test/sync')
      .set('x-bambook-api-key', validApiKey)
      .send({ blocking: true });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT|Write/);
  });

  it('pdml POST /map-products API-Key → 401', async () => {
    const app = mountRouter(createPdmlRouter, baseOpts);
    const res = await request(app)
      .post('/test/map-products')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
  });

  it('system-assets POST /wallpapers API-Key → 401', async () => {
    const app = mountRouter(createSystemAssetsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .post('/test/wallpapers')
      .set('x-bambook-api-key', validApiKey)
      .field('title', 'attacker-wallpaper');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT|Write/);
  });

  it('system-assets PATCH /:id API-Key → 401', async () => {
    const app = mountRouter(createSystemAssetsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .patch('/test/wallpaper-1')
      .set('x-bambook-api-key', validApiKey)
      .send({ title: 'hijacked' });
    expect(res.status).toBe(401);
  });

  it('system-assets DELETE /:id API-Key → 401', async () => {
    const app = mountRouter(createSystemAssetsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .delete('/test/wallpaper-1')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════
// 攻击向量 5：email IMAP 端点未认证 → 401
// IMAP 端点涉及邮箱凭证查询，必须 JWT（API-Key 不足）
// ══════════════════════════════════════════════════════════════
describe('Security · email IMAP 端点未认证 → 401', () => {
  it('GET /attachment 无认证 → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app).get('/test/attachment');
    expect(res.status).toBe(401);
  });

  it('GET /attachment API-Key → 401（IMAP 必须 JWT）', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app)
      .get('/test/attachment')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/JWT|IMAP/);
  });

  it('GET /attachment 伪造 token → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app)
      .get('/test/attachment')
      .set('Authorization', `Bearer ${FORGED_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it('GET /image 无认证 → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app).get('/test/image');
    expect(res.status).toBe(401);
  });

  it('GET /image API-Key → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app)
      .get('/test/image')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).toBe(401);
  });

  it('POST /fetch 无认证 → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app).post('/test/fetch').send({});
    expect(res.status).toBe(401);
  });

  it('POST /fetch API-Key → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app)
      .post('/test/fetch')
      .set('x-bambook-api-key', validApiKey)
      .send({});
    expect(res.status).toBe(401);
  });

  it('POST /send 无认证 → 401', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app).post('/test/send').send({});
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════
// 正向回归：有效凭证通过守卫（确保守卫未误伤合法访问）
// ══════════════════════════════════════════════════════════════
describe('Security · 正向回归（有效凭证通过守卫）', () => {
  it('products GET /assets 有效 API-Key → 通过守卫（非 401/403）', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .get('/test/assets')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('products GET /assets 有效 JWT → 通过守卫（非 401/403）', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .get('/test/assets')
      .set('Authorization', `Bearer ${makeValidToken()}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('products POST /assets 有效 JWT → 通过写守卫（非 401/403，修复后 JWT 可写）', async () => {
    const app = mountRouter(createProductsRouter, { ...baseOpts, uploadDir: '/tmp/test-sec' });
    const res = await request(app)
      .post('/test/assets')
      .set('Authorization', `Bearer ${makeValidToken()}`)
      .send({});
    // 有效 JWT 应通过 requireJwtForWrite（可能 400/500 因 mock prisma，但不应是 401/403）
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('business-profiles GET / 有效 API-Key → 通过守卫（非 401/403）', async () => {
    const app = mountRouter(createBusinessProfilesRouter, baseOpts);
    const res = await request(app)
      .get('/test')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('pdml GET /raw 有效 API-Key → 通过守卫（非 401/403）', async () => {
    const app = mountRouter(createPdmlRouter, baseOpts);
    const res = await request(app)
      .get('/test/raw')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('email GET / 有效 API-Key → 通过守卫（非 401/403，DB 端点允许 API-Key 读）', async () => {
    const app = mountRouter(createEmailRouter, baseOpts);
    const res = await request(app)
      .get('/test')
      .set('x-bambook-api-key', validApiKey);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
