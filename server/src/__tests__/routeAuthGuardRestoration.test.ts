/**
 * Route auth guard restoration source contract (task_mrcex1at)
 *
 * 验证 4 个模块（finance/shipping/development/email）的 auth guard 已恢复，
 * 且高风险路由有 requireRole 中间件。
 *
 * Source-level 契约断言，不连真实 DB。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
}

const FINANCE = read('finance/route.ts');
const SHIPPING = read('shipping/route.ts');
const DEVELOPMENT = read('development/route.ts');
const EMAIL = read('email/route.ts');
const INDEX = read('index.ts');

describe('Auth guard restoration · finance', () => {
  it('imports requireRole from auth/middleware', () => {
    expect(FINANCE).toContain("requireRole");
    expect(FINANCE).toContain("from '../auth/middleware'");
    expect(FINANCE).toContain('createModuleAuthGuard');
  });

  it('destructures requireAuth + apiKeys from options (not silently dropped)', () => {
    expect(FINANCE).toContain('requireAuth');
    expect(FINANCE).toContain('apiKeys');
    expect(FINANCE).not.toMatch(/const \{ prisma, onDataChange \} = options/);
    expect(FINANCE).toContain('requireWrite');
  });

  it('uses shared createModuleAuthGuard (not inline copy)', () => {
    expect(FINANCE).toContain('createModuleAuthGuard');
    expect(FINANCE).toContain("requireAuth, apiKeys");
  });

  it('high-risk routes have requireRole: cancel invoice + delete invoice + delete voucher', () => {
    expect(FINANCE).toContain("requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {");
    const cancelIdx = FINANCE.indexOf("router.post('/:id/cancel'");
    expect(FINANCE.slice(cancelIdx, cancelIdx + 100)).toContain('requireRole');
    const delIdx = FINANCE.indexOf("router.delete('/:id',");
    expect(FINANCE.slice(delIdx, delIdx + 100)).toContain('requireRole');
    const delVoucherIdx = FINANCE.indexOf("router.delete('/vouchers/:id',");
    expect(FINANCE.slice(delVoucherIdx, delVoucherIdx + 100)).toContain('requireRole');
  });
});

describe('Auth guard restoration · shipping', () => {
  it('imports requireRole + destructures auth options', () => {
    expect(SHIPPING).toContain("requireRole");
    expect(SHIPPING).toContain('requireAuth');
    expect(SHIPPING).toContain('apiKeys');
  });

  it('uses shared createModuleAuthGuard (not inline copy)', () => {
    expect(SHIPPING).toContain('createModuleAuthGuard');
  });

  it('high-risk DELETE /:id has requireRole', () => {
    const delIdx = SHIPPING.indexOf("router.delete('/:id',");
    expect(delIdx).toBeGreaterThan(-1);
    expect(SHIPPING.slice(delIdx, delIdx + 100)).toContain('requireRole');
  });
});

describe('Auth guard restoration · development', () => {
  it('imports requireRole + destructures auth options', () => {
    expect(DEVELOPMENT).toContain("requireRole");
    expect(DEVELOPMENT).toContain('requireAuth');
    expect(DEVELOPMENT).toContain('apiKeys');
  });

  it('uses shared createModuleAuthGuard (not inline copy)', () => {
    expect(DEVELOPMENT).toContain('createModuleAuthGuard');
  });

  it('high-risk POST /:id/convert + DELETE /:id have requireRole', () => {
    const convertIdx = DEVELOPMENT.indexOf("router.post('/:id/convert',");
    expect(convertIdx).toBeGreaterThan(-1);
    expect(DEVELOPMENT.slice(convertIdx, convertIdx + 100)).toContain('requireRole');
    const delIdx = DEVELOPMENT.indexOf("router.delete('/:id',");
    expect(DEVELOPMENT.slice(delIdx, delIdx + 100)).toContain('requireRole');
  });
});

describe('Auth guard restoration · email', () => {
  it('factory signature accepts EmailRouterOptions (not bare prisma)', () => {
    expect(EMAIL).toContain('EmailRouterOptions');
    expect(EMAIL).toContain('requireAuth');
    expect(EMAIL).toContain('apiKeys');
    expect(EMAIL).not.toMatch(/createEmailRouter\(prisma:/);
  });

  it('uses shared createModuleAuthGuard (not inline copy)', () => {
    expect(EMAIL).toContain('createModuleAuthGuard');
  });

  it('high-risk POST /outbox/:id/send + POST /sync have requireRole', () => {
    expect(EMAIL).toContain("requireRole");
    const sendIdx = EMAIL.indexOf("router.post('/outbox/:id/send',");
    expect(sendIdx).toBeGreaterThan(-1);
    expect(EMAIL.slice(sendIdx, sendIdx + 100)).toContain('requireRole');
    const syncIdx = EMAIL.indexOf("router.post('/sync',");
    expect(syncIdx).toBeGreaterThan(-1);
    expect(EMAIL.slice(syncIdx, syncIdx + 100)).toContain('requireRole');
  });
});

describe('Auth guard restoration · index.ts mount', () => {
  it('email mount passes requireAuth + apiKeys (not bare prisma)', () => {
    expect(INDEX).toContain("createEmailRouter({");
    expect(INDEX).toMatch(/createEmailRouter\(\{[\s\S]*requireAuth/);
    expect(INDEX).toMatch(/createEmailRouter\(\{[\s\S]*apiKeys/);
  });
});
