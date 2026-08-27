/**
 * 阶段 P1 — 定价与利润模块路由（PRD 8 / 6.2 P1），挂载于 /api/v1/pricing
 *
 * 端点：
 *   退税率表：
 *   - GET    /tax-refund-rates              — 列表（?includeInactive=true）
 *   - POST   /tax-refund-rates              — 注册 {hsCode, rate, ...}
 *   - GET    /tax-refund-rates/lookup       — 最长前缀命中查询 ?hsCode=
 *   - PATCH  /tax-refund-rates/:id          — 更新（hsCode 不可改）
 *   - DELETE /tax-refund-rates/:id          — 软删
 *   轨道 A 估算：
 *   - POST   /track-a-preview               — 纯试算（不落库；面料/纱线价可按编号命中价格历史）
 *   轨道 B 定价：
 *   - POST   /track-b-preview               — 纯试算（不落库）
 *   - GET    /calculations                  — 列表（?orderId=&quotationId=&status=）
 *   - POST   /calculations                  — 创建（派生值服务端重算）
 *   - PATCH  /calculations/:id              — 更新（重算）
 *   - DELETE /calculations/:id              — 软删
 *   订单利润表：
 *   - GET    /profit-sheets                 — 列表
 *   - POST   /profit-sheets/generate/:orderId — 生成/重生成（幂等覆盖）
 *   - GET    /profit-sheets/order/:orderId  — 按订单查询
 *   - DELETE /profit-sheets/order/:orderId  — 删除（硬删，重生成可恢复）
 *   原材料价格：
 *   - GET    /material-prices               — 列表（?materialType=&materialCode=&from=&to=）
 *   - POST   /material-prices               — 录入
 *   - GET    /material-prices/trend         — 趋势 ?materialType=&materialCode=
 *   - GET    /material-prices/latest        — 最新价 ?materialType=&materialCode=
 *   - PATCH  /material-prices/:id           — 更新
 *   - DELETE /material-prices/:id           — 软删
 *   佣金规则（P2）：
 *   - GET    /commission-rules              — 列表（?includeInactive=true）
 *   - POST   /commission-rules              — 创建（同中间人启用中规则唯一）
 *   - GET    /commission-rules/lookup       — 命中查询 ?intermediaryRelationId=
 *   - PATCH  /commission-rules/:id          — 更新
 *   - DELETE /commission-rules/:id          — 软删
 *
 * 服务端门禁（W-C 权限收口）：认证门 createModuleAuthGuard 之上叠加 scope 门——
 *   读类端点（GET + track-a/track-b 纯试算）→ requirePermission('pricing:read')；
 *   写端点 → requireJwtForWrite + requirePermission('pricing:write')（JWT-only，API-Key 拒）。
 * 佣金字段（commissionRate/commissionAmount）涉管理层+财务可见域（PRD 9.6），
 * 本路由不做字段级过滤——由服务端 pricing:read/pricing:write scope 门禁（不再依赖前端 modulePermissions）。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { serializeValue } from '../lib/serializeValue';
import { createPricingService, PricingCalculationInput, TaxRefundRateInput, TrackAPreviewInput, TrackBInput } from './pricingService';
import { createProfitSheetService } from './profitSheetService';
import { createMaterialPriceService, MaterialPriceInput } from './materialPriceService';
import { createCommissionService, CommissionRuleInput } from './commissionService';

export interface PricingRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createPricingRouter(options: PricingRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const pricing = createPricingService(prisma);
  const profitSheets = createProfitSheetService(prisma);
  const materialPrices = createMaterialPriceService(prisma);
  const commissions = createCommissionService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'pricing', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[PricingRoute] ${code}`, { error: msg });
    const isClient =
      msg.includes('必填') || msg.includes('非法') || msg.includes('必须') ||
      msg.includes('已存在') || msg.includes('不可修改') || msg.includes('大于 0') ||
      msg.includes('之间') || msg.includes('缺失') || msg.includes('无退税率映射') ||
      msg.includes('仅允许') || msg.includes('已归档');
    const isNotFound = msg.includes('不存在');
    res.status(isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  // ══════════════════════════════════════════════════════════════
  // 退税率表
  // ══════════════════════════════════════════════════════════════

  router.get('/tax-refund-rates', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await pricing.listTaxRefundRates({ includeInactive: req.query.includeInactive === 'true' });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'TRR_LIST_FAILED');
    }
  });

  router.post('/tax-refund-rates', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await pricing.createTaxRefundRate(req.body as TaxRefundRateInput, actorIdFromRequest(req));
      notify('create_tax_refund_rate', [row.id]);
      res.status(201).json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'TRR_CREATE_FAILED');
    }
  });

  // 字面路由 lookup 须在 /:id 前
  router.get('/tax-refund-rates/lookup', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const hsCode = String(req.query.hsCode ?? '');
      if (!hsCode.trim()) {
        res.status(400).json({ error: { code: 'TRR_LOOKUP_FAILED', message: 'hsCode 必填' } });
        return;
      }
      const hit = await pricing.lookupRefundRate(hsCode);
      res.json(serializeValue({ hit }));
    } catch (e: any) {
      handleError(res, e, 'TRR_LOOKUP_FAILED');
    }
  });

  router.patch('/tax-refund-rates/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await pricing.updateTaxRefundRate(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_tax_refund_rate', [row.id]);
      res.json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'TRR_UPDATE_FAILED');
    }
  });

  router.delete('/tax-refund-rates/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      await pricing.deleteTaxRefundRate(req.params.id, actorIdFromRequest(req));
      notify('delete_tax_refund_rate', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'TRR_DELETE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 轨道 A 估算（纯试算，不落库；守卫口径同 track-b-preview）
  // ══════════════════════════════════════════════════════════════

  router.post('/track-a-preview', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await pricing.estimateTrackA(req.body as TrackAPreviewInput);
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'TRACK_A_PREVIEW_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 轨道 B 定价
  // ══════════════════════════════════════════════════════════════

  router.post('/track-b-preview', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = pricing.calculateTrackB(req.body as TrackBInput);
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'TRACK_B_PREVIEW_FAILED');
    }
  });

  router.get('/calculations', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await pricing.listCalculations({
        orderId: req.query.orderId as string | undefined,
        quotationId: req.query.quotationId as string | undefined,
        status: req.query.status as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'CALC_LIST_FAILED');
    }
  });

  router.post('/calculations', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await pricing.createCalculation(req.body as PricingCalculationInput, actorIdFromRequest(req));
      notify('create_pricing_calculation', [row.id]);
      res.status(201).json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'CALC_CREATE_FAILED');
    }
  });

  router.patch('/calculations/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await pricing.updateCalculation(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_pricing_calculation', [row.id]);
      res.json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'CALC_UPDATE_FAILED');
    }
  });

  router.delete('/calculations/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      await pricing.deleteCalculation(req.params.id, actorIdFromRequest(req));
      notify('delete_pricing_calculation', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'CALC_DELETE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 订单利润表
  // ══════════════════════════════════════════════════════════════

  router.get('/profit-sheets', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await profitSheets.listProfitSheets({
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'PROFIT_LIST_FAILED');
    }
  });

  router.post('/profit-sheets/generate/:orderId', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const sheet = await profitSheets.generateOrderProfitSheet(req.params.orderId, actorIdFromRequest(req));
      notify('generate_profit_sheet', [req.params.orderId]);
      res.json(serializeValue({ ok: true, item: sheet }));
    } catch (e: any) {
      handleError(res, e, 'PROFIT_GENERATE_FAILED');
    }
  });

  router.get('/profit-sheets/order/:orderId', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const sheet = await profitSheets.getProfitSheetByOrder(req.params.orderId);
      if (!sheet) {
        res.status(404).json({ error: { code: 'PROFIT_GET_FAILED', message: '利润表不存在' } });
        return;
      }
      res.json(serializeValue({ item: sheet }));
    } catch (e: any) {
      handleError(res, e, 'PROFIT_GET_FAILED');
    }
  });

  router.delete('/profit-sheets/order/:orderId', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      await profitSheets.deleteProfitSheet(req.params.orderId, actorIdFromRequest(req));
      notify('delete_profit_sheet', [req.params.orderId]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'PROFIT_DELETE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // REQ2-14 海运费变动利润重估（DR-054：只读预览不落库，X-04 一屏可见）
  // ══════════════════════════════════════════════════════════════

  router.get('/freight-impact', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await profitSheets.reestimateFreightImpact({
        multiplier: req.query.multiplier,
        orderId: req.query.orderId,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'FREIGHT_IMPACT_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 原材料价格
  // ══════════════════════════════════════════════════════════════

  router.get('/material-prices', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await materialPrices.listMaterialPrices({
        materialType: req.query.materialType as string | undefined,
        materialCode: req.query.materialCode as string | undefined,
        source: req.query.source as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'MP_LIST_FAILED');
    }
  });

  router.post('/material-prices', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await materialPrices.createMaterialPrice(req.body as MaterialPriceInput, actorIdFromRequest(req));
      notify('create_material_price', [row.id]);
      res.status(201).json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'MP_CREATE_FAILED');
    }
  });

  // 字面路由 trend / latest 须在 /:id 前
  router.get('/material-prices/trend', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const items = await materialPrices.getPriceTrend({
        materialType: String(req.query.materialType ?? ''),
        materialCode: req.query.materialCode as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      res.json(serializeValue({ items }));
    } catch (e: any) {
      handleError(res, e, 'MP_TREND_FAILED');
    }
  });

  router.get('/material-prices/latest', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const materialType = String(req.query.materialType ?? '');
      const materialCode = String(req.query.materialCode ?? '');
      if (!materialCode.trim()) {
        res.status(400).json({ error: { code: 'MP_LATEST_FAILED', message: 'materialCode 必填' } });
        return;
      }
      const item = await materialPrices.getLatestPrice({ materialType, materialCode });
      res.json(serializeValue({ item }));
    } catch (e: any) {
      handleError(res, e, 'MP_LATEST_FAILED');
    }
  });

  router.patch('/material-prices/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await materialPrices.updateMaterialPrice(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_material_price', [row.id]);
      res.json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'MP_UPDATE_FAILED');
    }
  });

  router.delete('/material-prices/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      await materialPrices.deleteMaterialPrice(req.params.id, actorIdFromRequest(req));
      notify('delete_material_price', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'MP_DELETE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 佣金规则（P2：任意百分比费率，中间人精确命中优先，默认规则兜底）
  // ══════════════════════════════════════════════════════════════

  router.get('/commission-rules', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const result = await commissions.listCommissionRules({ includeInactive: req.query.includeInactive === 'true' });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'CR_LIST_FAILED');
    }
  });

  router.post('/commission-rules', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await commissions.createCommissionRule(req.body as CommissionRuleInput, actorIdFromRequest(req));
      notify('create_commission_rule', [row.id]);
      res.status(201).json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'CR_CREATE_FAILED');
    }
  });

  // 字面路由 lookup 须在 /:id 前；无命中返回 { hit: null }（= 无佣金）
  router.get('/commission-rules/lookup', requirePermission('pricing:read'), async (req: Request, res: Response) => {
    try {
      const hit = await commissions.lookupCommissionRate(req.query.intermediaryRelationId as string | undefined);
      res.json(serializeValue({ hit }));
    } catch (e: any) {
      handleError(res, e, 'CR_LOOKUP_FAILED');
    }
  });

  router.patch('/commission-rules/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      const row = await commissions.updateCommissionRule(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_commission_rule', [row.id]);
      res.json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'CR_UPDATE_FAILED');
    }
  });

  router.delete('/commission-rules/:id', requireWrite, requirePermission('pricing:write'), async (req: Request, res: Response) => {
    try {
      await commissions.deleteCommissionRule(req.params.id, actorIdFromRequest(req));
      notify('delete_commission_rule', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'CR_DELETE_FAILED');
    }
  });

  return router;
}
