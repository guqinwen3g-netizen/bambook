/**
 * 双轨偏差提示标（PRD 8.6 双轨联动校验）— 共享组件
 *
 * 口径（与 server/src/pricing/trackAEstimator.ts calculatePriceDeviation 完全一致）：
 *   - 偏差 = (轨道 B 终价 USD − 轨道 A 中位估算 USD) / 轨道 A 中位估算 USD × 100
 *   - |偏差| > 15% → 黄标 warn：保存时自动生成 ApprovalRequest（9.2）
 *   - |偏差| > 30% → 红标 block：禁止直接发送
 *   - 其余 → ok
 *
 * 阈值常量与后端同源（trackAEstimator DEVIATION_WARN/BLOCK_PERCENT），改动需双边同步。
 */

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PriceDeviationLevel } from '../../types';
import { statusSemanticClass, StatusSemantic } from '../rdlBusinessStatusTokens';

export const PRICE_DEVIATION_WARN_PERCENT = 15;
export const PRICE_DEVIATION_BLOCK_PERCENT = 30;

export interface PriceDeviationInfo {
  deviationPercent: number;
  level: PriceDeviationLevel;
}

/** 前端展示用偏差计算（口径同后端 calculatePriceDeviation）；入参缺失/中位非正时返回 null */
export function computePriceDeviation(finalUsd: number | null, medianUsd: number | null): PriceDeviationInfo | null {
  if (finalUsd === null || medianUsd === null || medianUsd <= 0 || !Number.isFinite(finalUsd)) return null;
  const deviationPercent = Math.round(((finalUsd - medianUsd) / medianUsd) * 10000) / 100;
  const abs = Math.abs(deviationPercent);
  const level: PriceDeviationLevel =
    abs > PRICE_DEVIATION_BLOCK_PERCENT ? 'block' : abs > PRICE_DEVIATION_WARN_PERCENT ? 'warn' : 'ok';
  return { deviationPercent, level };
}

const LEVEL_SEMANTIC: Record<PriceDeviationLevel, StatusSemantic> = {
  ok: 'success',
  warn: 'warning',
  block: 'danger',
};

export interface DeviationBadgeProps {
  /** 轨道 B 终价美元单价 */
  finalUsd: number | null;
  /** 轨道 A 中位估算美元单价 */
  medianUsd: number | null;
  /** 估算单位提示（如 PC / M） */
  medianUnit?: string;
  isDarkMode?: boolean;
}

export function DeviationBadge({ finalUsd, medianUsd, medianUnit, isDarkMode }: DeviationBadgeProps) {
  const dev = computePriceDeviation(finalUsd, medianUsd);
  if (!dev) return null;
  const sign = dev.deviationPercent > 0 ? '+' : '';
  const unitHint = medianUnit ? `（$/${medianUnit === 'PC' ? '件' : '米'}）` : '';
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-inset text-xs ${statusSemanticClass(LEVEL_SEMANTIC[dev.level], isDarkMode)}`}>
      {dev.level === 'ok' ? (
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      ) : dev.level === 'warn' ? (
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      ) : (
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      )}
      <span>
        双轨偏差校验：轨道 B 终价 ${finalUsd!.toFixed(4)} vs 轨道 A 中位 ${medianUsd!.toFixed(4)}{unitHint}，
        偏差 {sign}{dev.deviationPercent}%
        {dev.level === 'ok' && '（≤15%，区间内）'}
        {dev.level === 'warn' && '（>15%，保存将触发审批）'}
        {dev.level === 'block' && '（>30%，禁止直接发送）'}
      </span>
    </div>
  );
}

export default DeviationBadge;
