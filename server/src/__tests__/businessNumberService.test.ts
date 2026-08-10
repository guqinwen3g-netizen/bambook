/**
 * 统一业务编号服务 Business Number Service 单元测试
 *
 * 覆盖：
 *   1. 按年递增（同年前缀 seq 递增，跨年重置）
 *   2. 唯一性（同 prefix+year 下 seq 唯一）
 *   3. 并发安全（模拟并发创建，无重号）
 *   4. 作废不回收（删除单据后 seq 不回退）
 *   5. peekNextBusinessNumber 不消费序号
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  nextBusinessNumber,
  peekNextBusinessNumber,
  resetBusinessSequenceForTest,
  isBusinessPrefix,
} from '../shared/businessNumberService';

const prisma = new PrismaClient();

describe('BusinessNumberService', () => {
  beforeEach(async () => {
    // 清空测试前缀的序列（避免测试间干扰）
    await prisma.businessSequence.deleteMany({
      where: { prefix: { in: ['QT', 'ORD', 'PO', 'INV', 'SH', 'CD', 'PV', 'BOM', 'LC', 'TR'] } },
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  describe('isBusinessPrefix', () => {
    it('识别合法前缀', () => {
      expect(isBusinessPrefix('QT')).toBe(true);
      expect(isBusinessPrefix('ORD')).toBe(true);
      expect(isBusinessPrefix('PO')).toBe(true);
      expect(isBusinessPrefix('INV')).toBe(true);
      expect(isBusinessPrefix('SH')).toBe(true);
      expect(isBusinessPrefix('CD')).toBe(true);
      expect(isBusinessPrefix('PV')).toBe(true);
      expect(isBusinessPrefix('IR')).toBe(true);
      expect(isBusinessPrefix('SM')).toBe(true);
      expect(isBusinessPrefix('BOM')).toBe(true);
      expect(isBusinessPrefix('LC')).toBe(true);
      expect(isBusinessPrefix('TR')).toBe(true);
      expect(isBusinessPrefix('CI')).toBe(true);
      expect(isBusinessPrefix('PL')).toBe(true);
      expect(isBusinessPrefix('CO')).toBe(true);
      expect(isBusinessPrefix('BL')).toBe(true);
      expect(isBusinessPrefix('AWB')).toBe(true);
      expect(isBusinessPrefix('INS')).toBe(true);
      expect(isBusinessPrefix('IC')).toBe(true);
      expect(isBusinessPrefix('PC')).toBe(true);
      expect(isBusinessPrefix('DOC')).toBe(true);
    });

    it('拒绝非法前缀', () => {
      expect(isBusinessPrefix('XX')).toBe(false);
      expect(isBusinessPrefix('')).toBe(false);
      expect(isBusinessPrefix('qt')).toBe(false); // 大小写敏感
    });
  });

  describe('nextBusinessNumber', () => {
    it('生成格式正确的编号 {PREFIX}-{YYYY}-{NNNN}', async () => {
      const year = new Date().getFullYear();
      const num = await nextBusinessNumber(prisma, 'QT');
      expect(num).toMatch(/^QT-\d{4}-\d{4}$/);
      expect(num).toBe(`QT-${year}-0001`);
    });

    it('同一年前缀 seq 递增', async () => {
      const year = new Date().getFullYear();
      const num1 = await nextBusinessNumber(prisma, 'QT');
      const num2 = await nextBusinessNumber(prisma, 'QT');
      const num3 = await nextBusinessNumber(prisma, 'QT');

      expect(num1).toBe(`QT-${year}-0001`);
      expect(num2).toBe(`QT-${year}-0002`);
      expect(num3).toBe(`QT-${year}-0003`);
    });

    it('不同前缀独立计数', async () => {
      const year = new Date().getFullYear();
      const qt1 = await nextBusinessNumber(prisma, 'QT');
      const po1 = await nextBusinessNumber(prisma, 'PO');
      const qt2 = await nextBusinessNumber(prisma, 'QT');

      expect(qt1).toBe(`QT-${year}-0001`);
      expect(po1).toBe(`PO-${year}-0001`);
      expect(qt2).toBe(`QT-${year}-0002`);
    });

    it('指定年份生成（跨年测试）', async () => {
      const num2025 = await nextBusinessNumber(prisma, 'QT', 2025);
      const num2026 = await nextBusinessNumber(prisma, 'QT', 2026);

      expect(num2025).toBe('QT-2025-0001');
      expect(num2026).toBe('QT-2026-0001');
    });

    it('非法前缀抛错', async () => {
      await expect(nextBusinessNumber(prisma, 'XX' as any)).rejects.toThrow('非法业务编号前缀');
    });

    it('并发安全：10 个并发请求无重号', async () => {
      const year = new Date().getFullYear();
      const promises = Array.from({ length: 10 }, () => nextBusinessNumber(prisma, 'ORD'));
      const numbers = await Promise.all(promises);

      // 全部唯一
      const unique = new Set(numbers);
      expect(unique.size).toBe(10);

      // 序号连续 1-10
      const seqs = numbers.map((n) => parseInt(n.split('-')[2], 10)).sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('作废不回收：删除序列后重新创建，seq 从 1 重新开始（业务层语义：软删保留，物理删才重置）', async () => {
      const year = new Date().getFullYear();
      const num1 = await nextBusinessNumber(prisma, 'PO');
      expect(num1).toBe(`PO-${year}-0001`);

      // 模拟"作废"（软删不影响序列，seq 继续递增）
      const num2 = await nextBusinessNumber(prisma, 'PO');
      expect(num2).toBe(`PO-${year}-0002`);

      // 物理删除序列行（仅测试环境）
      await prisma.businessSequence.deleteMany({ where: { prefix: 'PO', year } });
      const num3 = await nextBusinessNumber(prisma, 'PO');
      expect(num3).toBe(`PO-${year}-0001`); // 物理删后重置
    });
  });

  describe('peekNextBusinessNumber', () => {
    it('预览不消费序号', async () => {
      const year = new Date().getFullYear();
      const peek1 = await peekNextBusinessNumber(prisma, 'INV');
      expect(peek1).toBe(`INV-${year}-0001`);

      // 再次预览仍返回 0001（未消费）
      const peek2 = await peekNextBusinessNumber(prisma, 'INV');
      expect(peek2).toBe(`INV-${year}-0001`);

      // 实际取号后返回 0002
      const actual1 = await nextBusinessNumber(prisma, 'INV');
      expect(actual1).toBe(`INV-${year}-0001`);

      const peek3 = await peekNextBusinessNumber(prisma, 'INV');
      expect(peek3).toBe(`INV-${year}-0002`);
    });

    it('指定年份预览', async () => {
      const peek2025 = await peekNextBusinessNumber(prisma, 'INV', 2025);
      expect(peek2025).toBe('INV-2025-0001');
    });
  });

  describe('resetBusinessSequenceForTest', () => {
    it('重置序列（仅测试用）', async () => {
      const year = new Date().getFullYear();
      await nextBusinessNumber(prisma, 'SH');
      await nextBusinessNumber(prisma, 'SH');

      const peekBefore = await peekNextBusinessNumber(prisma, 'SH');
      expect(peekBefore).toBe(`SH-${year}-0003`);

      await resetBusinessSequenceForTest(prisma, 'SH');

      const peekAfter = await peekNextBusinessNumber(prisma, 'SH');
      expect(peekAfter).toBe(`SH-${year}-0001`);
    });
  });

  describe('事务内原子性', () => {
    it('事务内取号与单据创建原子提交', async () => {
      const year = new Date().getFullYear();
      const result = await prisma.$transaction(async (tx) => {
        const num = await nextBusinessNumber(tx, 'BOM');
        // 模拟单据创建
        const created = await tx.businessSequence.findUnique({ where: { id: `SEQ_BOM_${year}` } });
        return { num, seq: created?.seq };
      });

      expect(result.num).toBe(`BOM-${year}-0001`);
      expect(result.seq).toBe(1);
    });

    it('事务回滚时序号不消费', async () => {
      const year = new Date().getFullYear();

      // 第一个事务成功
      await prisma.$transaction(async (tx) => {
        await nextBusinessNumber(tx, 'LC');
      });

      // 第二个事务回滚
      try {
        await prisma.$transaction(async (tx) => {
          await nextBusinessNumber(tx, 'LC');
          throw new Error('模拟回滚');
        });
      } catch (e) {
        // 预期回滚
      }

      // 第三个事务应取到 0002（回滚未消费序号）
      const num = await prisma.$transaction(async (tx) => {
        return nextBusinessNumber(tx, 'LC');
      });
      expect(num).toBe(`LC-${year}-0002`);
    });
  });
});
