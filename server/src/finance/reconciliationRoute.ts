/**
 * reconciliationRoute.ts — W-B 波次 P2-6 客户四单对账工作台 API
 * 挂载点：/api/v1/reconciliation（server/src/index.ts）
 *
 * 端点：
 *   GET  /orders/:orderId          — 单订单四单勾稽（订单↔出运↔开票↔收款）
 *   GET  /customers/:customerId    — 客户维度批量对账（该客户全部订单 + 汇总）
 *   GET  /discrepancies            — 全量差异清单（severity 排序，分页/筛选）
 *   POST /orders/:orderId/refresh  — 强制重算（当前无缓存，直接重跑引擎；预留缓存失效钩子）
 *
 * 全部只读：对账引擎不写库；refresh 与 GET 同口径（幂等），POST 仅为语义化重算入口。
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { reconcileOrder, reconcileCustomer, listAllDiscrepancies, DiscrepancySeverity } from './reconciliationService';

export interface ReconciliationRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);

export function createReconciliationRouter(options: ReconciliationRouterOptions): Router {
  const { prisma, requireAuth, apiKeys } = options;
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));

  // GET /api/v1/reconciliation/orders/:orderId — 单订单对账
  router.get('/orders/:orderId', async (req: Request, res: Response) => {
    try {
      const result = await reconcileOrder(prisma, req.params.orderId);
      if (!result) {
        res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${req.params.orderId} 不存在` } });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'RECONCILE_FAILED', message: String(err?.message ?? err) } });
    }
  });

  // POST /api/v1/reconciliation/orders/:orderId/refresh — 强制重算（预留缓存失效钩子；当前与 GET 同口径，幂等）
  router.post('/orders/:orderId/refresh', async (req: Request, res: Response) => {
    try {
      const result = await reconcileOrder(prisma, req.params.orderId);
      if (!result) {
        res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${req.params.orderId} 不存在` } });
        return;
      }
      res.json({ refreshed: true, result });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'RECONCILE_FAILED', message: String(err?.message ?? err) } });
    }
  });

  // GET /api/v1/reconciliation/customers/:customerId — 客户维度批量对账
  router.get('/customers/:customerId', async (req: Request, res: Response) => {
    try {
      const { summary, orders } = await reconcileCustomer(prisma, req.params.customerId);
      res.json({ summary, orders });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'RECONCILE_FAILED', message: String(err?.message ?? err) } });
    }
  });

  // GET /api/v1/reconciliation/discrepancies — 全量差异清单（?severity=&type=&customerRelationId=&page=&pageSize=）
  router.get('/discrepancies', async (req: Request, res: Response) => {
    try {
      const severityRaw = req.query.severity ? String(req.query.severity) : undefined;
      if (severityRaw && !VALID_SEVERITIES.has(severityRaw)) {
        res.status(400).json({ error: { code: 'INVALID_SEVERITY', message: `severity 必须是: critical | warning | info` } });
        return;
      }
      const result = await listAllDiscrepancies(prisma, {
        severity: severityRaw as DiscrepancySeverity | undefined,
        type: req.query.type ? String(req.query.type) : undefined,
        customerRelationId: req.query.customerRelationId ? String(req.query.customerRelationId) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'RECONCILE_FAILED', message: String(err?.message ?? err) } });
    }
  });

  return router;
}
