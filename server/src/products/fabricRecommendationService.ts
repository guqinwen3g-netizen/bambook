/**
 * 阶段 P2 — 面料推荐引擎（PRD 6.2 P2 / 7.2，确定性打分，非 LLM）
 *
 * 职责：
 *   基于客户需求（季节 / 预算 / 成分 / 克重 / 花型）对面料档案确定性打分，
 *   输出排序推荐列表并落库 FabricRecommendation（criteria + results 快照，可审计追溯）。
 *
 * 打分口径（纯函数 scoreFabricCandidate，可解释，每项命中写入 reasons）：
 *   季节匹配        +30   ProductAsset.season 与 criteria.season 相同或互相包含
 *   预算匹配        +30   最新 FOB 价落在 [budgetMin, budgetMax]；边界外 20% 内 +15；无价格记录 +0
 *   成分关键词      +10/个 命中 MaterialCompositionTerm（中/英/缩写，大小写不敏感），至多 3 个
 *   克重范围        +20   FabricProfile.weightValue ∈ [weightMin, weightMax]
 *   花型匹配        +10   FabricProfile.pattern 包含 criteria.pattern（大小写不敏感）
 *   现货            +5    stockStatus 含 in stock / 现货
 *
 * 设计原则与 pricing 模块一致：服务工厂 / 软删除 / 中文校验错误消息。
 */

import { PrismaClient, FabricRecommendation } from '@prisma/client';
import { logger } from '../lib/logger';
import crypto from 'crypto';

export interface RecommendCriteria {
  season?: string | null; // 如 "2026AW"
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null; // 预算币种，默认 USD；与价格记录 currency 不一致的候选价格不参与预算打分
  compositionKeywords?: string[] | null; // 如 ["羊毛", "wool"]
  weightMin?: number | null;
  weightMax?: number | null;
  pattern?: string | null;
  limit?: number | null; // 默认 10，上限 50
}

export interface RecommendResultItem {
  productAssetId: string;
  sku: string;
  name: string;
  score: number;
  reasons: string[];
  season: string | null;
  latestPrice: number | null;
  priceCurrency: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  pattern: string | null;
  millName: string | null;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_KEYWORDS = 3;
const BUDGET_NEAR_TOLERANCE = 0.2; // 边界外 20% 内给半分

function generateId(prefix: string): string {
  return `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

// ────────────────────────────────────────────────────────────────
// 候选打分纯函数（导出供测试）
// ────────────────────────────────────────────────────────────────

export interface FabricCandidate {
  productAssetId: string;
  sku: string;
  name: string;
  season: string | null;
  latestPrice: number | null;
  priceCurrency: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  pattern: string | null;
  stockStatus: string | null;
  millName: string | null;
  compositions: Array<{ term: string; percentage: number }>; // term 已归一化（中/英/缩写拼接）
}

export function scoreFabricCandidate(candidate: FabricCandidate, criteria: RecommendCriteria): RecommendResultItem {
  let score = 0;
  const reasons: string[] = [];

  // 季节
  const wantSeason = criteria.season?.trim().toLowerCase();
  const haveSeason = candidate.season?.trim().toLowerCase();
  if (wantSeason && haveSeason && (haveSeason === wantSeason || haveSeason.includes(wantSeason) || wantSeason.includes(haveSeason))) {
    score += 30;
    reasons.push(`季节匹配 ${candidate.season}`);
  }

  // 预算（仅当候选有同币种价格记录时打分）
  const currency = (criteria.currency?.trim() || 'USD').toUpperCase();
  const hasBudget = criteria.budgetMin != null || criteria.budgetMax != null;
  if (hasBudget && candidate.latestPrice != null && candidate.priceCurrency?.toUpperCase() === currency) {
    const min = criteria.budgetMin ?? 0;
    const max = criteria.budgetMax ?? Number.POSITIVE_INFINITY;
    const price = candidate.latestPrice;
    if (price >= min && price <= max) {
      score += 30;
      reasons.push(`预算内 ${price} ${currency}`);
    } else {
      const near =
        (criteria.budgetMin != null && price < min && price >= min * (1 - BUDGET_NEAR_TOLERANCE)) ||
        (criteria.budgetMax != null && price > max && price <= max * (1 + BUDGET_NEAR_TOLERANCE));
      if (near) {
        score += 15;
        reasons.push(`接近预算 ${price} ${currency}`);
      }
    }
  }

  // 成分关键词（大小写不敏感，至多计 MAX_KEYWORDS 个）
  const keywords = (criteria.compositionKeywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  if (keywords.length > 0) {
    let hits = 0;
    const hitTerms: string[] = [];
    for (const kw of keywords) {
      if (hits >= MAX_KEYWORDS) break;
      const hit = candidate.compositions.find(c => c.term.toLowerCase().includes(kw));
      if (hit) {
        hits += 1;
        hitTerms.push(hit.term);
        score += 10;
      }
    }
    if (hitTerms.length > 0) reasons.push(`成分命中 ${hitTerms.join(' / ')}`);
  }

  // 克重
  if ((criteria.weightMin != null || criteria.weightMax != null) && candidate.weightValue != null) {
    const min = criteria.weightMin ?? 0;
    const max = criteria.weightMax ?? Number.POSITIVE_INFINITY;
    if (candidate.weightValue >= min && candidate.weightValue <= max) {
      score += 20;
      reasons.push(`克重 ${candidate.weightValue}${candidate.weightUnit ?? ''} 符合`);
    }
  }

  // 花型
  const wantPattern = criteria.pattern?.trim().toLowerCase();
  if (wantPattern && candidate.pattern?.toLowerCase().includes(wantPattern)) {
    score += 10;
    reasons.push(`花型匹配 ${candidate.pattern}`);
  }

  // 现货
  const stock = candidate.stockStatus?.toLowerCase() ?? '';
  if (stock && (stock.includes('stock') || stock.includes('现货'))) {
    score += 5;
    reasons.push('有现货');
  }

  return {
    productAssetId: candidate.productAssetId,
    sku: candidate.sku,
    name: candidate.name,
    score,
    reasons,
    season: candidate.season,
    latestPrice: candidate.latestPrice,
    priceCurrency: candidate.priceCurrency,
    weightValue: candidate.weightValue,
    weightUnit: candidate.weightUnit,
    pattern: candidate.pattern,
    millName: candidate.millName,
  };
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createFabricRecommendationService(prisma: PrismaClient) {
  const db = prisma as any;
  const now = () => Date.now();

  function assertCriteria(criteria: RecommendCriteria): void {
    const hasAny =
      criteria.season?.trim() ||
      criteria.budgetMin != null || criteria.budgetMax != null ||
      (criteria.compositionKeywords ?? []).some(k => k?.trim()) ||
      criteria.weightMin != null || criteria.weightMax != null ||
      criteria.pattern?.trim();
    if (!hasAny) throw new Error('推荐条件至少提供一项');
    for (const [k, v] of Object.entries({ budgetMin: criteria.budgetMin, budgetMax: criteria.budgetMax, weightMin: criteria.weightMin, weightMax: criteria.weightMax })) {
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(`${k} 非法`);
    }
    if (criteria.budgetMin != null && criteria.budgetMax != null && criteria.budgetMin > criteria.budgetMax) {
      throw new Error('预算下限不可大于上限');
    }
    if (criteria.weightMin != null && criteria.weightMax != null && criteria.weightMin > criteria.weightMax) {
      throw new Error('克重下限不可大于上限');
    }
  }

  /** 装配候选集：面料类档案 + 最新价格 + 成分行 */
  async function loadCandidates(currency: string): Promise<FabricCandidate[]> {
    const profiles = await db.fabricProfile.findMany({
      where: { deletedAt: null, productAsset: { deletedAt: null } },
      include: {
        productAsset: {
          include: {
            fabricPrices: { where: { deletedAt: null }, orderBy: { updatedAt: 'desc' } },
            compositionLines: { where: { deletedAt: null }, include: { term: true } },
          },
        },
      },
    });

    return profiles.map((p: any) => {
      const asset = p.productAsset;
      const prices = (asset.fabricPrices ?? []) as any[];
      const sameCcy = prices.filter(pr => pr.currency?.toUpperCase() === currency);
      const latest = (sameCcy.length > 0 ? sameCcy : prices)[0] ?? null;
      return {
        productAssetId: asset.id,
        sku: asset.sku,
        name: asset.name,
        season: asset.season ?? null,
        latestPrice: latest ? Number(latest.amount) : null,
        priceCurrency: latest?.currency ?? null,
        weightValue: p.weightValue ?? null,
        weightUnit: p.weightUnit ?? null,
        pattern: p.pattern ?? null,
        stockStatus: p.stockStatus ?? null,
        millName: p.millName ?? null,
        compositions: ((asset.compositionLines ?? []) as any[])
          .filter(l => l.term && l.term.deletedAt == null)
          .map(l => ({
            term: [l.term.chineseName, l.term.englishName, l.term.abbreviation].filter(Boolean).join(' '),
            percentage: Number(l.percentage),
          })),
      } satisfies FabricCandidate;
    });
  }

  async function recommend(criteria: RecommendCriteria, actorId: string): Promise<FabricRecommendation> {
    assertCriteria(criteria);
    const currency = (criteria.currency?.trim() || 'USD').toUpperCase();
    const limit = Math.min(Math.max(criteria.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const candidates = await loadCandidates(currency);
    const scored = candidates
      .map(c => scoreFabricCandidate(c, { ...criteria, currency }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || a.sku.localeCompare(b.sku))
      .slice(0, limit);

    const ts = now();
    const row = await db.fabricRecommendation.create({
      data: {
        id: generateId('FR'),
        criteria: { ...criteria, currency, limit },
        results: scored,
        createdBy: actorId,
        createdAt: BigInt(ts),
        deletedAt: null,
      },
    });
    logger.info('[FabricRecommendation] recommend executed', {
      id: row.id, candidateCount: candidates.length, hitCount: scored.length, actorId,
    });
    return row;
  }

  async function listRecommendations(query: { limit?: number; offset?: number }) {
    const where: any = { deletedAt: null };
    const take = Math.min(query.limit || 50, 200);
    const skip = query.offset || 0;
    const [items, total] = await Promise.all([
      db.fabricRecommendation.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      db.fabricRecommendation.count({ where }),
    ]);
    return { items, total };
  }

  async function getRecommendation(id: string): Promise<FabricRecommendation> {
    const row = await db.fabricRecommendation.findUnique({ where: { id } });
    if (!row || row.deletedAt !== null) throw new Error('推荐记录不存在');
    return row;
  }

  async function deleteRecommendation(id: string, actorId: string): Promise<void> {
    const row = await getRecommendation(id);
    await db.fabricRecommendation.update({
      where: { id: row.id },
      data: { deletedAt: BigInt(now()) },
    });
    logger.info('[FabricRecommendation] soft-deleted', { id: row.id, actorId });
  }

  return { recommend, listRecommendations, getRecommendation, deleteRecommendation };
}

export type FabricRecommendationService = ReturnType<typeof createFabricRecommendationService>;
