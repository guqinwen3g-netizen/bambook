/**
 * S3 走查阶段二修复 — pricing 域敏感字段服务端遮罩（β 车道 P0）
 *
 * 背景实锤：GET /api/v1/pricing/profit-sheets 仅校验 pricing:read，对未持
 * sensitive:cost / sensitive:profit 的角色（sales 等）明文返回 purchaseCost /
 * grossProfit / grossMargin 等敏感字段。文档铁律：敏感字段按 sensitive:* scope 遮罩。
 *
 * 遮罩惯例（与 auth/permissionService.ts stripSensitive 同口径）：
 *   - 数字敏感字段 → null（前端 formatMoney(null) 渲染 '—'；relations 域 creditLimit
 *     同款 null 遮罩，前端渲染 ****）
 *   - 明细行数组 → []（保形渲染「无明细」；遮罩为 null 会崩前端 lines.length/map）
 *   - 字符串敏感字段 → '****'（本域响应暂无字符串类敏感字段，预留口径）
 *
 * scope 判定复用 permissionGuard.hasScopeOnRequest（JWT permissions → owner 直通 →
 * legacy 角色 fallback 默认矩阵），与 stripSensitive 的 canViewSensitiveField 语义一致。
 *
 * 覆盖响应形态：
 *   利润表（list / generate / get-by-order 行 + details JSON 嵌套）、freight-impact
 * 重估（baseline / reestimated / delta / summary）、定价计算行、track-a/track-b 试算
 * 结果、佣金规则行与 lookup 命中、原材料价格行。
 *   注：tax-refund-rates 的 rate 为法定出口退税率注册表（公开信息），pricing 域响应
 * 无「进项税/退税计税底值」字段，故 sensitive:tax_base 在本域无遮罩对象。
 */

import type { Request } from 'express';
import { hasScopeOnRequest } from '../auth/permissionGuard';

export interface PricingSensitiveVisibility {
  /** sensitive:cost — 成本/采购价/BOM成本 */
  cost: boolean;
  /** sensitive:profit — 毛利/毛利率/利润率 */
  profit: boolean;
  /** sensitive:commission — 佣金率/佣金金额 */
  commission: boolean;
}

export function pricingSensitiveVisibility(req: Request): PricingSensitiveVisibility {
  return {
    cost: hasScopeOnRequest(req, 'sensitive:cost'),
    profit: hasScopeOnRequest(req, 'sensitive:profit'),
    commission: hasScopeOnRequest(req, 'sensitive:commission'),
  };
}

/** 数字遮罩：已有 null/undefined 原样保留，其余 → null（与 stripSensitive 数字口径一致） */
function maskNum(v: unknown): unknown {
  return v === undefined || v === null ? v : null;
}

// ────────────────────────────────────────────────────────────────
// 订单利润表（OrderProfitSheet 行 + details JSON 嵌套）
// ────────────────────────────────────────────────────────────────

const COST_KINDS = new Set(['purchase', 'freight', 'misc']);

function maskProfitSheetDetails(details: any, vis: PricingSensitiveVisibility): any {
  if (!details || typeof details !== 'object') return details;
  const d: any = { ...details };
  if (!vis.cost) {
    // 成本明细行数组遮罩为空数组（保形；明细标签本身即成本链单据，整组不可见）
    for (const k of ['purchases', 'freight', 'misc']) {
      if (Array.isArray(d[k])) d[k] = [];
    }
    // 未折算行中成本类金额同为成本泄露面
    if (Array.isArray(d.unconverted)) {
      d.unconverted = d.unconverted.map((u: any) =>
        u && COST_KINDS.has(u.kind) ? { ...u, amount: null } : u);
    }
  }
  if (d.internalTrade && typeof d.internalTrade === 'object') {
    const t: any = { ...d.internalTrade };
    if (!vis.cost) {
      t.internalPurchaseAmount = maskNum(t.internalPurchaseAmount);
      t.internalSalesAmount = maskNum(t.internalSalesAmount);
      t.consolidatedAdjustment = maskNum(t.consolidatedAdjustment);
    }
    if (!vis.profit) t.departmentProfit = maskNum(t.departmentProfit);
    d.internalTrade = t;
  }
  return d;
}

export function maskProfitSheetRow<T extends Record<string, any>>(row: T, vis: PricingSensitiveVisibility): T {
  if (!row || typeof row !== 'object') return row;
  const r: any = { ...row };
  if (!vis.cost) {
    r.purchaseCost = maskNum(r.purchaseCost);
    r.freightCost = maskNum(r.freightCost);
    r.miscCost = maskNum(r.miscCost);
  }
  if (!vis.profit) {
    r.grossProfit = maskNum(r.grossProfit);
    r.grossMargin = maskNum(r.grossMargin);
  }
  r.details = maskProfitSheetDetails(r.details, vis);
  return r as T;
}

// ────────────────────────────────────────────────────────────────
// REQ2-14 海运费变动利润重估（freight-impact）
// ────────────────────────────────────────────────────────────────

export function maskFreightImpactResult<T extends Record<string, any>>(result: T, vis: PricingSensitiveVisibility): T {
  if (!result || typeof result !== 'object') return result;
  const r: any = { ...result };
  if (Array.isArray(r.items)) {
    r.items = r.items.map((it: any) => {
      if (!it || typeof it !== 'object') return it;
      const item: any = { ...it };
      if (item.baseline && typeof item.baseline === 'object') {
        const b: any = { ...item.baseline };
        if (!vis.cost) b.freightCost = maskNum(b.freightCost);
        if (!vis.profit) { b.grossProfit = maskNum(b.grossProfit); b.grossMargin = maskNum(b.grossMargin); }
        item.baseline = b;
      }
      if (item.reestimated && typeof item.reestimated === 'object') {
        const e: any = { ...item.reestimated };
        if (!vis.cost) e.freightCost = maskNum(e.freightCost);
        if (!vis.profit) { e.grossProfit = maskNum(e.grossProfit); e.grossMargin = maskNum(e.grossMargin); }
        item.reestimated = e;
      }
      if (!vis.profit) {
        item.deltaProfit = maskNum(item.deltaProfit);
        item.deltaMargin = maskNum(item.deltaMargin);
      }
      return item;
    });
  }
  if (r.summary && typeof r.summary === 'object' && !vis.profit) {
    const s: any = { ...r.summary };
    s.baselineProfitTotal = maskNum(s.baselineProfitTotal);
    s.reestimatedProfitTotal = maskNum(s.reestimatedProfitTotal);
    s.deltaProfitTotal = maskNum(s.deltaProfitTotal);
    r.summary = s;
  }
  return r as T;
}

// ────────────────────────────────────────────────────────────────
// 定价计算（PricingCalculation 行）
// ────────────────────────────────────────────────────────────────

export function maskCalculationRow<T extends Record<string, any>>(row: T, vis: PricingSensitiveVisibility): T {
  if (!row || typeof row !== 'object') return row;
  const r: any = { ...row };
  if (!vis.cost) {
    r.purchaseCostCny = maskNum(r.purchaseCostCny);
    r.netUsdCost = maskNum(r.netUsdCost);
  }
  if (!vis.profit) {
    r.profitMargin = maskNum(r.profitMargin);
    r.profitAmount = maskNum(r.profitAmount);
  }
  if (!vis.commission) {
    r.commissionRate = maskNum(r.commissionRate);
    r.commissionAmount = maskNum(r.commissionAmount);
  }
  return r as T;
}

// ────────────────────────────────────────────────────────────────
// 轨道 B / 轨道 A 纯试算结果
// ────────────────────────────────────────────────────────────────

export function maskTrackBResult<T extends Record<string, any>>(result: T, vis: PricingSensitiveVisibility): T {
  if (!result || typeof result !== 'object') return result;
  const r: any = { ...result };
  if (!vis.cost) r.netUsdCost = maskNum(r.netUsdCost);
  if (!vis.profit) r.profitAmount = maskNum(r.profitAmount);
  if (!vis.commission) r.commissionAmount = maskNum(r.commissionAmount);
  return r as T;
}

export function maskTrackAResult<T extends Record<string, any>>(result: T, vis: PricingSensitiveVisibility): T {
  if (!result || typeof result !== 'object') return result;
  const r: any = { ...result };
  if (!vis.cost) {
    r.costTotalCny = maskNum(r.costTotalCny);
    if (Array.isArray(r.lines)) {
      r.lines = r.lines.map((l: any) => (l && typeof l === 'object' ? { ...l, amountCny: maskNum(l.amountCny) } : l));
    }
  }
  if (!vis.profit) r.profitBenchmark = maskNum(r.profitBenchmark);
  return r as T;
}

// ────────────────────────────────────────────────────────────────
// 佣金规则（CommissionRule 行 / lookup 命中）
// ────────────────────────────────────────────────────────────────

export function maskCommissionRuleRow<T extends Record<string, any>>(row: T, vis: PricingSensitiveVisibility): T {
  if (!row || typeof row !== 'object') return row;
  if (vis.commission) return row;
  return { ...row, rate: maskNum((row as any).rate) } as T;
}

export function maskCommissionLookupHit<T extends Record<string, any> | null>(hit: T, vis: PricingSensitiveVisibility): T {
  if (!hit || typeof hit !== 'object') return hit;
  if (vis.commission) return hit;
  return { ...hit, rate: maskNum((hit as any).rate) } as T;
}

// ────────────────────────────────────────────────────────────────
// 原材料价格（MaterialPriceHistory 行；price = 采购价 → sensitive:cost）
// ────────────────────────────────────────────────────────────────

export function maskMaterialPriceRow<T extends Record<string, any>>(row: T, vis: PricingSensitiveVisibility): T {
  if (!row || typeof row !== 'object') return row;
  if (vis.cost) return row;
  return { ...row, price: maskNum((row as any).price) } as T;
}
