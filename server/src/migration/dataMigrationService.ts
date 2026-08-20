/**
 * dataMigrationService.ts — REQ2-07 历史数据批量迁移（四类模板 + 两段式导入 + 整批回滚）
 *
 * 设计真源：docs/design/04-模块设计/08-设置与后台/Settings-设置/历史数据迁移.md
 *
 * DR-049 三决策：
 *   ① 校验与落库两段式：validate 无副作用可反复；commit 自带二次校验
 *      （validate→commit 间库内新增重复 → 跳过计 skipped，不硬失败）
 *   ② 四类模板列契约（英文 key 表头）：customers/suppliers→Relation、
 *      orders→Order（source='data-migration'）、invoices→Invoice；
 *      查重双层：文件内 + 库内
 *   ③ 整批回滚走软删（ImportBatch.entityIds 是回滚真源）
 *
 * 解析通道：xlsx 包（.xlsx 与 .csv 同一 XLSX.read 通道——前端 QuotationImportWizard 同款）
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────────
// 模板契约（DR-049-②）
// ────────────────────────────────────────────────────────────────────

export const MIGRATION_TYPES = ['customers', 'suppliers', 'orders', 'invoices'] as const;
export type MigrationType = (typeof MIGRATION_TYPES)[number];

interface ColumnSpec {
  key: string;
  label: string;
  required?: boolean;
}

const COLUMN_SPECS: Record<MigrationType, ColumnSpec[]> = {
  customers: [
    { key: 'name', label: '客户名称（必填）' },
    { key: 'contactInfo', label: '联系方式' },
    { key: 'tags', label: '标签（逗号分隔）' },
  ],
  suppliers: [
    { key: 'name', label: '供应商名称（必填）' },
    { key: 'contactInfo', label: '联系方式' },
    { key: 'tags', label: '标签（逗号分隔）' },
  ],
  orders: [
    { key: 'poNumber', label: 'PO号（必填，唯一）' },
    { key: 'customer', label: '客户名称（必填）' },
    { key: 'product', label: '产品描述（必填）' },
    { key: 'type', label: '类型 Fabric/Garment/Other（必填）' },
    { key: 'quantity', label: '数量（必填，正整数）' },
    { key: 'dueDate', label: '交期 YYYY-MM-DD（必填）' },
    { key: 'quoteAmount', label: '订单金额（必填，正数）' },
    { key: 'status', label: '状态（默认 Pending）' },
    { key: 'currency', label: '币种（默认 USD）' },
    { key: 'salesPerson', label: '业务员' },
  ],
  invoices: [
    { key: 'invoiceNumber', label: '发票号（必填，唯一）' },
    { key: 'type', label: '类型 Receivable/Payable（必填）' },
    { key: 'amount', label: '金额（必填，正数）' },
    { key: 'currency', label: '币种 USD/CNY/EUR（必填）' },
    { key: 'issueDate', label: '开票日 YYYY-MM-DD（必填）' },
    { key: 'status', label: '状态（默认 Issued）' },
    { key: 'dueDate', label: '到期日 YYYY-MM-DD' },
    { key: 'orderId', label: '关联订单ID' },
    { key: 'customerName', label: '客户名称' },
  ],
};

const ORDER_TYPES = ['Fabric', 'Garment', 'Other'];
const INVOICE_TYPES = ['Receivable', 'Payable'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 判别联合 */
export type MigrationResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };

const fail = (code: string, message: string, status = 400): MigrationResult<never> =>
  ({ ok: false, error: { code, message, status } });

export interface ValidatedRow {
  lineNo: number; // 数据行行号（表头=第1行，首个数据行=第2行）
  data: Record<string, string>; // 原始单元格（错误定位展示用）
  valid: boolean;
  reason?: string;
}

// ────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────

export function createDataMigrationService(prisma: PrismaClient) {
  const db = prisma as any;

  // ── 模板 CSV（表头 + 中文示例行） ──
  function getTemplateCsv(type: string): MigrationResult<{ csv: string; fileName: string }> {
    if (!(MIGRATION_TYPES as readonly string[]).includes(type)) {
      return fail('INVALID_TYPE', `type 须为 ${MIGRATION_TYPES.join(' | ')}`);
    }
    const spec = COLUMN_SPECS[type as MigrationType];
    const header = spec.map(c => c.key).join(',');
    const example = spec.map(c => c.label).join(',');
    const csv = `\uFEFF${header}\n${example}\n`; // BOM：Excel 打开中文不乱码
    return { ok: true, data: { csv, fileName: `bambook-${type}-template.csv` } };
  }

  // ── 解析（.xlsx/.csv → 行数组；表头英文 key） ──
  function parseRows(buffer: Buffer, type: MigrationType): MigrationResult<{ rows: Record<string, string>[] }> {
    let wb: XLSX.WorkBook;
    try {
      // 通道分流：.xlsx 是 zip 二进制（PK 魔数）走 buffer；CSV 是文本走 UTF-8 字符串——
      // Node 下 XLSX 对无 BOM 的 CSV buffer 会按二进制误读致中文乱码（实测 tags mojibake）；
      // 字符串通道剥 BOM（Excel 导出 CSV 常带 \uFEFF，不剥则首个表头变 "\uFEFFpoNumber"）
      const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // 'PK'
      if (isZip) {
        wb = XLSX.read(buffer, { type: 'buffer', raw: true });
      } else {
        const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
        wb = XLSX.read(text, { type: 'string', raw: true });
      }
    } catch (e: any) {
      return fail('PARSE_FAILED', `文件解析失败：${e?.message ?? e}（支持 .xlsx / .csv）`);
    }
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return fail('EMPTY_FILE', '文件无工作表');
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[sheetName], { defval: '' });
    return { ok: true, data: { rows } };
  }

  // ── 单行校验（纯函数：类型/必填/格式） ──
  function validateRow(type: MigrationType, row: Record<string, string>): string | null {
    const spec = COLUMN_SPECS[type];
    for (const col of spec) {
      const v = String(row[col.key] ?? '').trim();
      if (col.required !== false && specRequired(type, col.key) && !v) {
        return `缺少必填列 ${col.key}`;
      }
    }
    if (type === 'orders') {
      if (!ORDER_TYPES.includes(String(row.type).trim())) return `type 须为 ${ORDER_TYPES.join('/')}`;
      const qty = Number(row.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return 'quantity 须为正整数';
      const amt = Number(row.quoteAmount);
      if (!Number.isFinite(amt) || amt <= 0) return 'quoteAmount 须为正数';
      if (!DATE_RE.test(String(row.dueDate).trim())) return 'dueDate 须为 YYYY-MM-DD';
    }
    if (type === 'invoices') {
      if (!INVOICE_TYPES.includes(String(row.type).trim())) return `type 须为 ${INVOICE_TYPES.join('/')}`;
      const amt = Number(row.amount);
      if (!Number.isFinite(amt) || amt <= 0) return 'amount 须为正数';
      if (!String(row.currency).trim()) return 'currency 必填';
      if (!DATE_RE.test(String(row.issueDate).trim())) return 'issueDate 须为 YYYY-MM-DD';
      if (row.dueDate && !DATE_RE.test(String(row.dueDate).trim())) return 'dueDate 须为 YYYY-MM-DD';
    }
    if ((type === 'customers' || type === 'suppliers') && !String(row.name ?? '').trim()) {
      return '缺少必填列 name';
    }
    return null;
  }

  /** 该列是否必填（orders/invoices 全列必填按 spec required 标记；customers/suppliers 仅 name） */
  function specRequired(type: MigrationType, key: string): boolean {
    if (type === 'customers' || type === 'suppliers') return key === 'name';
    // orders/invoices：spec 标签含「必填」的列
    const col = COLUMN_SPECS[type].find(c => c.key === key);
    return !!col?.label.includes('必填');
  }

  /** 行的库内查重键 */
  function dupKey(type: MigrationType, row: Record<string, string>): string | null {
    if (type === 'orders') return String(row.poNumber ?? '').trim() || null;
    if (type === 'invoices') return String(row.invoiceNumber ?? '').trim() || null;
    if (type === 'customers' || type === 'suppliers') return String(row.name ?? '').trim() || null;
    return null;
  }

  // ── 逐行校验（无副作用；文件内重复 + 库内重复双层） ──
  async function validateFile(type: string, buffer: Buffer): Promise<MigrationResult<{
    rows: ValidatedRow[]; totalRows: number; validCount: number; errorCount: number;
  }>> {
    if (!(MIGRATION_TYPES as readonly string[]).includes(type)) {
      return fail('INVALID_TYPE', `type 须为 ${MIGRATION_TYPES.join(' | ')}`);
    }
    const t = type as MigrationType;
    const parsed = parseRows(buffer, t);
    if (!parsed.ok) return parsed as any;
    const rawRows = parsed.data.rows;

    // 库内已存在键（一次查全，避免逐行查库）
    const existingKeys = new Set<string>();
    const keys = rawRows.map(r => dupKey(t, r)).filter(Boolean) as string[];
    if (keys.length > 0) {
      if (t === 'orders') {
        const found = await db.order.findMany({ where: { poNumber: { in: keys }, deletedAt: null }, select: { poNumber: true } });
        found.forEach((o: any) => existingKeys.add(o.poNumber));
      } else if (t === 'invoices') {
        const found = await db.invoice.findMany({ where: { invoiceNumber: { in: keys }, deletedAt: null }, select: { invoiceNumber: true } });
        found.forEach((i: any) => existingKeys.add(i.invoiceNumber));
      } else {
        const category = t === 'customers' ? 'Customer' : 'Supplier';
        const found = await db.relation.findMany({ where: { name: { in: keys }, category, deletedAt: null }, select: { name: true } });
        found.forEach((r: any) => existingKeys.add(r.name));
      }
    }

    const seenInFile = new Set<string>();
    const rows: ValidatedRow[] = rawRows.map((raw, idx) => {
      const lineNo = idx + 2; // 表头为第 1 行
      let reason = validateRow(t, raw);
      if (!reason) {
        const key = dupKey(t, raw)!;
        if (seenInFile.has(key)) reason = `文件内重复：${key}`;
        else if (existingKeys.has(key)) reason = `系统中已存在：${key}`;
        else seenInFile.add(key);
      }
      const data: Record<string, string> = {};
      for (const c of COLUMN_SPECS[t]) data[c.key] = String(raw[c.key] ?? '').trim();
      return { lineNo, data, valid: !reason, reason: reason ?? undefined };
    });

    return {
      ok: true,
      data: {
        rows,
        totalRows: rows.length,
        validCount: rows.filter(r => r.valid).length,
        errorCount: rows.filter(r => !r.valid).length,
      },
    };
  }

  // ── 确认导入（重新解析校验 → valid 且非库内重复行落库 + 批次留痕） ──
  async function commitFile(type: string, buffer: Buffer, fileName: string): Promise<MigrationResult<{
    batch: any; imported: number; skipped: number;
  }>> {
    const validated = await validateFile(type, buffer);
    if (!validated.ok) return validated as any;
    const t = type as MigrationType;
    const { rows, totalRows, validCount } = validated.data;
    const ts = Date.now();
    const entityIds: string[] = [];
    let imported = 0;
    let skipped = totalRows - validCount; // 校验错误行

    // 软删孪生行预取（DR：poNumber/invoiceNumber 有 DB 唯一约束，软删行仍占键——
    // 回滚后重导入须复活更新而非 create（P2002 实测）。业务身份一致：同号=同一单据。
    const keys = rows.filter(r => r.valid).map(r => dupKey(t, r.data)).filter(Boolean) as string[];
    const softDeletedByKey = new Map<string, any>();
    if (keys.length > 0 && (t === 'orders' || t === 'invoices')) {
      const isOrder = t === 'orders';
      const where = isOrder
        ? { poNumber: { in: keys }, deletedAt: { not: null } }
        : { invoiceNumber: { in: keys }, deletedAt: { not: null } };
      const found = await (isOrder ? db.order : db.invoice).findMany({
        where,
        select: isOrder ? { id: true, poNumber: true } : { id: true, invoiceNumber: true },
      });
      for (const f of found) {
        softDeletedByKey.set(String(isOrder ? f.poNumber : f.invoiceNumber), f);
      }
    }

    for (const row of rows) {
      if (!row.valid) continue;
      const d = row.data;
      try {
        if (t === 'customers' || t === 'suppliers') {
          const category = t === 'customers' ? 'Customer' : 'Supplier';
          const id = `REL__MIG${ts.toString(36).toUpperCase()}${entityIds.length.toString(36)}`;
          await db.relation.create({
            data: {
              id,
              name: d.name,
              category,
              type: category,
              isOrganization: true,
              contactInfo: d.contactInfo || '',
              tags: d.tags ? d.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
              rating: 0,
              lastInteraction: ts,
              preferences: '',
            },
          });
          entityIds.push(id);
        } else if (t === 'orders') {
          const orderData = {
            customer: d.customer,
            product: d.product,
            type: d.type,
            quantity: Number(d.quantity),
            status: d.status || 'Pending',
            dueDate: d.dueDate,
            quoteAmount: Number(d.quoteAmount),
            poNumber: d.poNumber,
            currency: d.currency || 'USD',
            salesCurrency: d.currency || 'USD',
            salesPerson: d.salesPerson || null,
            source: 'data-migration',
            fieldSources: { _manual: true } as any,
            importedAt: BigInt(ts),
            updatedAt: BigInt(ts),
          };
          const twin = softDeletedByKey.get(d.poNumber);
          if (twin) {
            // 软删孪生复活（同 PO 号 = 同一业务单据）：update + 清 deletedAt
            await db.order.update({ where: { id: twin.id }, data: { ...orderData, deletedAt: null } });
            entityIds.push(twin.id);
          } else {
            const id = `PO-${String(d.poNumber).replace(/[^A-Za-z0-9_-]/g, '-')}`;
            await db.order.create({ data: { id, ...orderData } });
            entityIds.push(id);
          }
        } else if (t === 'invoices') {
          const invoiceData = {
            invoiceNumber: d.invoiceNumber,
            type: d.type,
            status: d.status || 'Issued',
            amount: Number(d.amount),
            currency: d.currency,
            issueDate: d.issueDate,
            dueDate: d.dueDate || null,
            orderId: d.orderId || null,
            customerName: d.customerName || null,
            baseCurrency: 'CNY',
            updatedAt: BigInt(ts),
          };
          const twin = softDeletedByKey.get(d.invoiceNumber);
          if (twin) {
            await db.invoice.update({ where: { id: twin.id }, data: { ...invoiceData, deletedAt: null } });
            entityIds.push(twin.id);
          } else {
            const id = `INV__MIG${ts.toString(36).toUpperCase()}${entityIds.length.toString(36)}`;
            await db.invoice.create({ data: { id, ...invoiceData, createdAt: BigInt(ts) } });
            entityIds.push(id);
          }
        }
        imported++;
      } catch (e: any) {
        // commit 时库内重复（validate→commit 间竞态）等 → 跳过计 skipped，不硬失败
        skipped++;
        logger.warn('[DataMigration] row skipped at commit', { type: t, lineNo: row.lineNo, error: e?.message });
      }
    }

    const batch = await db.importBatch.create({
      data: {
        id: `IMB__${ts.toString(36).toUpperCase()}`,
        type: t,
        fileName: fileName || 'unknown',
        totalRows,
        importedRows: imported,
        skippedRows: skipped,
        entityIds,
        status: 'committed',
        createdAt: BigInt(ts),
        updatedAt: BigInt(ts),
      },
    });
    logger.info('[DataMigration] batch committed', { id: batch.id, type: t, imported, skipped });
    return { ok: true, data: { batch, imported, skipped } };
  }

  // ── 批次列表 ──
  async function listBatches(): Promise<MigrationResult<{ items: any[] }>> {
    const items = await db.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return { ok: true, data: { items } };
  }

  // ── 整批回滚（entityIds 软删分发） ──
  async function rollbackBatch(batchId: string): Promise<MigrationResult<{ rolledBack: number }>> {
    const batch = await db.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) return fail('BATCH_NOT_FOUND', `批次 ${batchId} 不存在`, 404);
    if (batch.status === 'rolled_back') return fail('ALREADY_ROLLED_BACK', '该批次已回滚', 409);

    const ts = Date.now();
    const ids: string[] = batch.entityIds ?? [];
    let rolledBack = 0;
    if (batch.type === 'customers' || batch.type === 'suppliers') {
      const r = await db.relation.updateMany({ where: { id: { in: ids } }, data: { deletedAt: BigInt(ts) } });
      rolledBack = r.count;
    } else if (batch.type === 'orders') {
      const r = await db.order.updateMany({ where: { id: { in: ids } }, data: { deletedAt: BigInt(ts) } });
      rolledBack = r.count;
    } else if (batch.type === 'invoices') {
      const r = await db.invoice.updateMany({ where: { id: { in: ids } }, data: { deletedAt: BigInt(ts) } });
      rolledBack = r.count;
    }

    await db.importBatch.update({
      where: { id: batchId },
      data: { status: 'rolled_back', rolledBackAt: BigInt(ts), updatedAt: BigInt(ts) },
    });
    logger.info('[DataMigration] batch rolled back', { batchId, rolledBack });
    return { ok: true, data: { rolledBack } };
  }

  return { getTemplateCsv, validateFile, commitFile, listBatches, rollbackBatch };
}
