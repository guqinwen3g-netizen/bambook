/**
 * company-sim/common.ts — 13 周公司数据模拟共享工具
 *
 * 公司设定：竹衍服饰（PandaClothing）女装出口商
 * 时间线：13 周 = 2026-06-08（周一）~ 2026-08-30（今天）
 * ID 约定：所有确定性 ID / 单据编号统一 SIM- 前缀（与发号器区间避让）
 */

import { PrismaClient } from '@prisma/client';

// ─── 时间基线（UTC 构造，确定性不受运行时区影响） ───
export const W1_START = Date.UTC(2026, 5, 8); // 2026-06-08 周一
export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const DAY_MS = 24 * 3600 * 1000;
export const SIM_END = Date.UTC(2026, 7, 30); // 2026-08-30

/** 第 w 周（1-based）周一起的偏移毫秒；dayOfWeek 1=周一 … 7=周日 */
export function weekStart(w: number): number {
  return W1_START + (w - 1) * WEEK_MS;
}
/** 第 w 周第 d 天（1=周一）的某时刻（h 点 m 分，业务工作时间） */
export function at(w: number, d: number, h = 10, m = 0): number {
  return weekStart(w) + (d - 1) * DAY_MS + h * 3600 * 1000 + m * 60 * 1000;
}
/** epoch ms → 'YYYY-MM-DD'（UTC 口径） */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
/** epoch ms → 'YYYY-MM-DD HH:mm:ss'（Email.sentAt 口径） */
export function isoDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// ─── 确定性伪随机（mulberry32，种子固定保证可重放） ───
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = mulberry32(20260608);
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
export function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ─── 金额工具 ───
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── 内部人员（AuditLog actor / ownerId，全部为库内既有账号 + SIM 补充跟单） ───
export const USERS = {
  boss: 'usr_demo_boss', // Jason Shen — 总经理
  gm: 'usr_demo_gm', // Raymond Lin — 审批/分管副总
  salesManager: 'usr_demo_sales_manager', // Vivian Chen — 销售主管
  salesA: 'usr_demo_sales_a', // Chloe Su — 业务员
  salesB: 'usr_demo_sales_b', // Marcus Zhou — 业务员
  financeManager: 'usr_demo_finance_manager', // Melissa Zhao — 财务经理
  finance: 'usr_demo_finance', // Charlie Qian — 会计
  qc: 'usr_demo_qc', // Wilson Wu — QC 主管
  logistics: 'usr_demo_logistics', // Hank Zheng — 物流主管
} as const;

/** SIM 补充账号（EmployeeProfile 挂载用，seed 幂等 upsert，不改动既有账号） */
export const SIM_EXTRA_ACCOUNTS = [
  { id: 'SIM-usr-merch-1', displayName: 'Grace Liu', email: 'grace.liu@pandaclothing.local' },
  { id: 'SIM-usr-merch-2', displayName: 'Tony Fang', email: 'tony.fang@pandaclothing.local' },
  { id: 'SIM-usr-merch-3', displayName: 'Ivy Zhang', email: 'ivy.zhang@pandaclothing.local' },
] as const;

export const SALES_POOL = [USERS.salesManager, USERS.salesA, USERS.salesB] as const;
export const SALES_NAME: Record<string, string> = {
  [USERS.salesManager]: 'Vivian Chen',
  [USERS.salesA]: 'Chloe Su',
  [USERS.salesB]: 'Marcus Zhou',
};

// ─── 通用 Prisma 生成器 ───
export function newPrisma(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient: PC } = require('@prisma/client');
  return new PC();
}

/** 统一批量建行 + 打印 */
export async function createManyLogged(
  prisma: PrismaClient,
  delegate: string,
  label: string,
  rows: unknown[],
): Promise<number> {
  if (!rows.length) return 0;
  const model = (prisma as any)[delegate];
  if (typeof model.createMany === 'function') {
    const r = await model.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ${label}: ${r.count}`);
    return r.count;
  }
  // 无 createMany 的模型（如 PaymentVoucher 等带 unique 约束均可；兜底逐行）
  for (const row of rows) await model.create({ data: row });
  console.log(`  ${label}: ${rows.length}`);
  return rows.length;
}
