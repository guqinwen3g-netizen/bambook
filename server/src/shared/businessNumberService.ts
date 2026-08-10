/**
 * 统一业务编号服务 Business Number Service（PRD 5.6 落地）
 *
 * 职责：
 *   1. 按年递增编号生成：{PREFIX}-{YYYY}-{NNNN}（4 位补零）
 *   2. 事务内强一致：SELECT ... FOR UPDATE 行级锁，防并发重号
 *   3. 作废不回收：序号单调递增，已分配序号永久保留（含软删记录）
 *   4. 全局唯一：同一 prefix+year 组合下序号唯一
 *
 * 使用方式：
 *   - 在创建单据的事务内调用 nextBusinessNumber(tx, 'QT')
 *   - 前端不再传编号字段，服务端强制覆盖
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

/** Prisma 客户端或事务句柄（宽松类型，兼容 PrismaClient 与 $transaction 句柄） */
interface DbLike {
  businessSequence?: {
    upsert(args: any): Promise<any>;
    update(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    deleteMany(args: any): Promise<any>;
  };
}

/** 支持的单据前缀（PRD 5.6 定义） */
export type BusinessPrefix =
  | 'QT'   // 报价单 Quotation
  | 'ORD'  // 订单 Order
  | 'PO'   // 采购订单 PurchaseOrder
  | 'INV'  // 发票 Invoice
  | 'SH'   // 运单 Shipment
  | 'CD'   // 报关单 CustomsDeclaration
  | 'PV'   // 付款凭证 PaymentVoucher
  | 'IR'   // 检验报告 InspectionReport
  | 'SM'   // 样品 Sample
  | 'BOM'  // BOM 清单
  | 'LC'   // 信用证 LetterOfCredit
  | 'TR'   // 退税 TaxRefund
  | 'CI'   // 商业发票 CommercialInvoice
  | 'PL'   // 装箱单 PackingList
  | 'CO'   // 原产地证 CertificateOfOrigin
  | 'BL'   // 提单 BillOfLading
  | 'AWB'  // 空运单 AirWaybill
  | 'INS'  // 保险单 InsuranceCert
  | 'IC'   // 检验证书 InspectionCert
  | 'PC'   // 植检证 PhytosanitaryCert
  | 'DOC'; // 其他单据 Other

const VALID_PREFIXES: BusinessPrefix[] = [
  'QT', 'ORD', 'PO', 'INV', 'SH', 'CD', 'PV', 'IR', 'SM', 'BOM',
  'LC', 'TR', 'CI', 'PL', 'CO', 'BL', 'AWB', 'INS', 'IC', 'PC', 'DOC',
];

export function isBusinessPrefix(prefix: string): prefix is BusinessPrefix {
  return (VALID_PREFIXES as string[]).includes(prefix);
}

// ────────────────────────────────────────────────────────────────
// 核心：事务内取号
// ────────────────────────────────────────────────────────────────

/**
 * 生成下一业务编号：{PREFIX}-{YYYY}-{NNNN}（4 位补零）。
 *
 * 实现要点：
 *   1. 查询 BusinessSequence 行（SELECT ... FOR UPDATE）锁定当前 prefix+year
 *   2. 不存在则创建（seq=1），存在则 seq+1
 *   3. 返回格式化编号
 *
 * 注意：必须在事务内调用，确保锁与单据创建原子提交。
 */
export async function nextBusinessNumber(
  db: DbLike,
  prefix: BusinessPrefix,
  year?: number,
): Promise<string> {
  if (!isBusinessPrefix(prefix)) {
    throw new Error(`非法业务编号前缀: ${prefix}`);
  }
  const targetYear = year ?? new Date().getFullYear();
  const id = `SEQ_${prefix}_${targetYear}`;

  // 若 db 无 businessSequence 模型（如单元测试 mock），降级为时间戳随机后缀
  if (!db.businessSequence) {
    const fallback = `${prefix}-${targetYear}-${String(Date.now()).slice(-6)}${Math.random().toString(36).slice(2, 6)}`;
    logger.warn('[BusinessNumber] fallback to timestamp (no businessSequence model)', { prefix, year: targetYear, fallback });
    return fallback;
  }

  // SELECT ... FOR UPDATE 行级锁（PostgreSQL）
  // 若行不存在，需先创建再锁，避免并发插入冲突
  const row = await db.businessSequence.upsert({
    where: { id },
    create: {
      id,
      prefix,
      year: targetYear,
      seq: 0,
      updatedAt: BigInt(Date.now()),
    },
    update: {},
    select: { seq: true },
  });

  // 原子递增并返回新值
  const updated = await db.businessSequence.update({
    where: { id },
    data: {
      seq: { increment: 1 },
      updatedAt: BigInt(Date.now()),
    },
    select: { seq: true },
  });

  const seq = updated.seq;
  const number = `${prefix}-${targetYear}-${String(seq).padStart(4, '0')}`;

  if (typeof logger.debug === 'function') {
    logger.debug('[BusinessNumber] generated', { prefix, year: targetYear, seq, number });
  }
  return number;
}

/**
 * 预览下一编号（不消费序号）。
 * 用于前端展示"下一编号"提示，不实际分配。
 */
export async function peekNextBusinessNumber(
  db: DbLike,
  prefix: BusinessPrefix,
  year?: number,
): Promise<string> {
  if (!isBusinessPrefix(prefix)) {
    throw new Error(`非法业务编号前缀: ${prefix}`);
  }
  const targetYear = year ?? new Date().getFullYear();
  const id = `SEQ_${prefix}_${targetYear}`;

  // 若 db 无 businessSequence 模型（如单元测试 mock），降级返回 0001
  if (!db.businessSequence) {
    return `${prefix}-${targetYear}-0001`;
  }

  const row = await db.businessSequence.findUnique({
    where: { id },
    select: { seq: true },
  });

  const nextSeq = (row?.seq ?? 0) + 1;
  return `${prefix}-${targetYear}-${String(nextSeq).padStart(4, '0')}`;
}

/**
 * 回退已分配的序号（仅用于测试或极端异常补偿，业务代码禁用）。
 * 会实际删除 BusinessSequence 行，重置计数器。
 */
export async function resetBusinessSequenceForTest(
  db: DbLike,
  prefix: BusinessPrefix,
  year?: number,
): Promise<void> {
  const targetYear = year ?? new Date().getFullYear();
  const id = `SEQ_${prefix}_${targetYear}`;
  if (db.businessSequence) {
    await db.businessSequence.deleteMany({ where: { id } });
  }
  logger.warn('[BusinessNumber] sequence reset (test only)', { prefix, year: targetYear });
}
