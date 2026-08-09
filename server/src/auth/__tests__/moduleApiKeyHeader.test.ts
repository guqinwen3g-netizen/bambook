/**
 * 认证头一致性回归测试
 *
 * 背景：前端 apiService 统一发送 X-Bambook-API-Key 头，但 6 个历史模块路由
 * （procurement/crm/quotations/bom/mes/inventory）的手写 authenticate 只认
 * x-api-key 头，导致带正确 API key 的客户端收到 401 'authentication required'。
 *
 * 本测试锁定契约：这 6 个路由必须接受标准 X-Bambook-API-Key 头（兼容旧 x-api-key）。
 * 认证在 prisma 之前执行，因此带 key 的请求绝不应返回 401（后续业务错误允许）。
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createProcurementRouter } from '../../procurement/procurementRoute';
import { createCrmRouter } from '../../crm/crmRoute';
import { createQuotationRouter } from '../../quotations/quotationRoute';
import { createBOMRouter } from '../../bom/bomRoute';
import { createMesRouter } from '../../mes/mesRoute';
import { createInventoryRouter } from '../../inventory/inventoryRoute';

const TEST_KEY = 'test-api-key-0123456789abcdef';

/** 通用 prisma 桩：任何模型访问都返回空结果（认证先于业务执行，业务深浅不影响断言） */
const modelStub = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'count') return async () => 0;
    if (prop === 'findUnique' || prop === 'findFirst') return async () => null;
    return async () => [];
  },
});
const prismaStub = new Proxy({}, { get: () => modelStub }) as any;

const ROUTERS: Array<{ name: string; listPath: string; create: (opts: any) => express.Router }> = [
  { name: 'procurement', listPath: '/', create: createProcurementRouter },
  { name: 'crm', listPath: '/REL__1/contacts', create: createCrmRouter },
  { name: 'quotations', listPath: '/', create: createQuotationRouter },
  { name: 'bom', listPath: '/', create: createBOMRouter },
  { name: 'mes', listPath: '/plans', create: createMesRouter },
  { name: 'inventory', listPath: '/items', create: createInventoryRouter },
];

function makeApp(create: (opts: any) => express.Router) {
  const app = express();
  app.use(express.json());
  app.use('/', create({ prisma: prismaStub, requireAuth: true, apiKeys: new Set([TEST_KEY]) }));
  return app;
}

describe('module routers accept canonical X-Bambook-API-Key header', () => {
  for (const { name, listPath, create } of ROUTERS) {
    it(`${name}: rejects request without credentials`, async () => {
      const res = await request(makeApp(create)).get(listPath);
      expect(res.status).toBe(401);
    });

    it(`${name}: accepts X-Bambook-API-Key header (frontend apiService contract)`, async () => {
      const res = await request(makeApp(create)).get(listPath).set('X-Bambook-API-Key', TEST_KEY);
      expect(res.status).not.toBe(401);
    });

    it(`${name}: still accepts legacy x-api-key header (backward compat)`, async () => {
      const res = await request(makeApp(create)).get(listPath).set('x-api-key', TEST_KEY);
      expect(res.status).not.toBe(401);
    });

    it(`${name}: rejects wrong API key`, async () => {
      const res = await request(makeApp(create)).get(listPath).set('X-Bambook-API-Key', 'wrong-key');
      expect(res.status).toBe(401);
    });
  }
});
