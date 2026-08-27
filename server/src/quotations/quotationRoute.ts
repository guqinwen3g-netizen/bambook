/**
 * 报价管理 API — /api/v1/quotations
 *
 * 端点：
 *   GET    /              — 列表（支持 status/customer/date/search 过滤）
 *   GET    /:id           — 详情（含行明细）
 *   POST   /              — 创建报价单（Draft 状态）
 *   PUT    /:id           — 更新报价单（仅 Draft）
 *   DELETE /:id           — 软删除报价单（仅 Draft）
 *   POST   /:id/send      — 发送报价单（Draft → Sent + 发布 QuotationIssued 事件）
 *   POST   /:id/accept    — 接受报价单（Sent → Accepted + 发布 QuotationAccepted 事件）
 *   POST   /:id/reject    — 拒绝报价单（Sent → Rejected）
 *   POST   /:id/expire    — 标记过期（Draft/Sent → Expired）
 *
 * 鉴权：统一 createModuleAuthGuard（JWT 或 API-Key）；写操作必须 JWT（requireJwtForWrite，API-Key 不足）
 *       ＋ requirePermission('quotations:write') scope 授权门（W-C 批三-E 族B 收口；
 *       持有面 = SALES/SALES_MANAGER＋SuperAdmin 特判，见 _shared/rolePermissionMatrix）
 * 审计：所有 mutation 写入 AuditLog（字段级审计）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { actorIdFromRequest, writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { createQuotationService, CreateQuotationInput, UpdateQuotationInput } from './quotationService';
import { createQuotationImportService, HistoricalQuotationRow } from './quotationImportService';
import { renderServerDocument } from '../templates/docTemplates/registry';
import { loadQuotationDocData } from '../templates/docTemplates/quotation';
import { buildXlsx, xlsxDownloadHeaders, type XlsxSheet } from '../templates/xlsxExport';
import { upsertDomainTradeDocument, generateTradeDocumentFile } from '../customs/tradeDocumentLifecycleService';

/** 报价状态 → 台账中文标签（与 QuotationManager 展示口径一致） */
const QUOTATION_STATUS_LABEL: Record<string, string> = {
  Draft: '草稿', Sent: '已发客户', Accepted: '客户已接受', Rejected: '客户已拒绝', Expired: '已过期',
};

export interface QuotationRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  /** 上传根目录（index.ts UPLOAD_DIR；行图片落 quotations/ 子目录） */
  uploadDir?: string;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createQuotationRouter(options: QuotationRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createQuotationService(prisma);
  const importService = createQuotationImportService(prisma);

  // ── 统一模块鉴权（JWT 或 API-Key；写操作另行要求 JWT + quotations:write scope） ──
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const requireQuotationWrite = requirePermission('quotations:write');

  // ── REQ2-12 报价行图片上传（DR-053：multer 落盘 quotations/，URL 由前端随行 imageUrl 提交） ──
  const lineImageUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, file, cb) => {
        const dir = path.join(options.uploadDir ?? path.join(process.cwd(), 'uploads'), 'quotations');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `qt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error('仅支持 jpeg/png/webp/gif 图片'));
    },
  });

  // POST /line-image — 上传面料照片/色卡图 → { url }（行级 imageUrl 提交时携带）
  router.post('/line-image', requireWrite, requireQuotationWrite, lineImageUpload.single('file'), (req: Request, res: Response) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: { code: 'NO_FILE', message: '未提供图片文件' } });
    const url = `/api/uploads/quotations/${f.filename}`;
    logger.info('[QuotationRoute] line image uploaded', { url, size: f.size, actor: actorIdFromRequest(req) });
    res.status(201).json({ ok: true, url });
  });

  // ── GET / — 列表（format=xlsx → 全量台账 Excel 导出） ──
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { status, customerRelationId, dateFrom, dateTo, search, limit, offset } = req.query;
      const exportAll = req.query.format === 'xlsx';
      const result = await service.listQuotations({
        status: status as string | undefined,
        customerRelationId: customerRelationId as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
        search: search as string | undefined,
        limit: exportAll || !limit ? undefined : parseInt(limit as string, 10),
        offset: exportAll || !offset ? undefined : parseInt(offset as string, 10),
        ...(exportAll ? { exportAll: true } : {}),
      });
      if (exportAll) {
        const sheet: XlsxSheet = {
          name: '报价台账',
          columnLabels: ['报价号', '客户', '状态', '币种', '金额', '版本', '报价日期', '有效期至', '业务员'],
          columns: ['quotationNumber', 'customerName', 'status', 'currency', 'totalAmount', 'version', 'issueDate', 'validUntil', 'salesperson'],
          rows: result.items.map(q => ({
            quotationNumber: q.quotationNumber,
            customerName: q.customerName,
            status: QUOTATION_STATUS_LABEL[q.status] ?? q.status,
            currency: q.currency,
            totalAmount: q.totalAmount != null ? Number(q.totalAmount) : null,
            version: q.version,
            issueDate: q.issueDate,
            validUntil: q.validUntil,
            salesperson: q.salesperson,
          })),
        };
        const today = new Date().toISOString().slice(0, 10);
        res.set(xlsxDownloadHeaders(`报价台账_${today}.xlsx`)).send(buildXlsx([sheet]));
        return;
      }
      res.json(result);
    } catch (e: any) {
      logger.error('[QuotationRoute] GET list failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list quotations' });
    }
  });

  // ── REQ2-19（DR-060-②）：GET /price-profile?relationId= — 客户砍价画像 ──
  // 字面路由：必须在参数路由 GET /:id 之前注册（否则被当作 id 吞掉）
  router.get('/price-profile', async (req: Request, res: Response) => {
    try {
      const relationId = typeof req.query.relationId === 'string' ? req.query.relationId : '';
      if (!relationId) {
        return res.status(400).json({ error: 'relationId 必填（客户砍价画像按客户维度聚合）' });
      }
      const profile = await service.getPriceProfile(relationId);
      res.json(profile);
    } catch (e: any) {
      logger.error('[QuotationRoute] GET price-profile failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to build price profile' });
    }
  });

  // ── GET /:id — 详情 ──
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const quotation = await service.getQuotation(req.params.id);
      if (!quotation) {
        return res.status(404).json({ error: '报价单不存在' });
      }
      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] GET detail failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get quotation' });
    }
  });

  // ── GET /:id/preview.html — 报价单服务端模板预览（B7：实时装配渲染，与生成 PDF
  //    同源排版——所见即所得，无需先登记文档；前端 buildQuotationPrintHtml 同构退役） ──
  router.get('/:id/preview.html', async (req: Request, res: Response) => {
    try {
      const data = await loadQuotationDocData(prisma, req.params.id);
      if (!data) return res.status(404).json({ error: '报价单不存在' });
      const html = await renderServerDocument(prisma, 'QUOT', data, { screen: true });
      if (!html) return res.status(500).json({ error: 'QUOT 模板渲染失败' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e: any) {
      logger.error('[QuotationRoute] GET preview.html failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to preview quotation' });
    }
  });

  // ── POST /:id/generate-document — 登记域单据 + 服务端渲染 PDF 落盘归档（B7）
  //    幂等：domain+type+sourceRef 唯一定位；重复生成刷新头字段并覆盖 PDF（真源实时渲染） ──
  router.post('/:id/generate-document', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actorId = actorIdFromRequest(req);
      const qt = await prisma.quotation.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!qt) return res.status(404).json({ error: '报价单不存在' });

      const reg = await upsertDomainTradeDocument(prisma, {
        domain: 'quotation',
        type: 'Quotation',
        sourceRef: qt.id,
        documentNumber: qt.quotationNumber, // 文档号=业务单号裁决（与 PO/CI 财务回链同语义）
        relationId: qt.customerRelationId,
        totalAmount: qt.totalAmount != null ? Number(qt.totalAmount) : null,
        currency: qt.currency,
        issueDate: qt.issueDate,
        actorId,
      });
      const file = await generateTradeDocumentFile(prisma, { id: reg.documentId, actorId });
      res.json({ document: reg, file });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST generate-document failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : 500;
      res.status(status).json({ error: e?.message || 'failed to generate quotation document' });
    }
  });

  // ── POST / — 创建 ──
  router.post('/', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const input = req.body as CreateQuotationInput;

      // 基本校验
      if (!input.currency || !input.issueDate) {
        return res.status(400).json({ error: '缺少必填字段：currency / issueDate' });
      }
      if (!input.lines || input.lines.length === 0) {
        return res.status(400).json({ error: '至少需要一行报价明细' });
      }
      for (const line of input.lines) {
        if (!line.description || !line.unit || line.quantity == null || line.unitPrice == null) {
          return res.status(400).json({ error: '报价行缺少必填字段：description / unit / quantity / unitPrice' });
        }
      }

      // 检查报价号唯一性（仅在传入报价号时检查；未传入时由服务端自动生成 QT-YYYY-NNNN）
      if (input.quotationNumber) {
        const existing = await prisma.quotation.findUnique({ where: { quotationNumber: input.quotationNumber } });
        if (existing) {
          return res.status(409).json({ error: `报价号 ${input.quotationNumber} 已存在` });
        }
      }

      const quotation = await service.createQuotation(input, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'create', ids: [quotation.id] });

      res.status(201).json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST create failed', { error: e?.message });
      // P1-3 专属面料阻断等业务冲突 → 透传 statusCode（默认 500）
      res.status(e?.statusCode ?? 500).json({ error: e?.message || 'failed to create quotation' });
    }
  });

  // ── POST /import — 历史报价导入（阶段 P3c，PRD 16.1；mode=preview 只校验，mode=commit 导入合法行）──
  // 注意：须注册在 /:id 之前，避免 'import' 被 :id 捕获
  router.post('/import', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const rows = req.body?.rows as HistoricalQuotationRow[];
      const mode = req.body?.mode === 'commit' ? 'commit' : 'preview';
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: 'rows 须为数组' });
      }
      const result = await importService.importHistoricalQuotations(rows, mode, actor?.userId || 'system');
      if (mode === 'commit' && result.created > 0) {
        onDataChange?.({ entity: 'Quotation', action: 'import', ids: [] });
      }
      res.json(result);
    } catch (e: any) {
      logger.error('[QuotationRoute] POST import failed', { error: e?.message });
      const msg = e?.message || '';
      res.status(msg.includes('为空') || msg.includes('不可超过') || msg.includes('数组') ? 400 : 500)
        .json({ error: msg || 'failed to import quotations' });
    }
  });

  // ── PUT /:id — 更新（仅 Draft） ──
  router.put('/:id', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const input = req.body as UpdateQuotationInput;
      const quotation = await service.updateQuotation(req.params.id, input, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'update', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] PUT update failed', { error: e?.message });
      // P1-3 专属面料阻断等显式 statusCode 优先；否则按既有语义映射
      const status = e?.statusCode ?? (e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft') ? 409 : 400);
      res.status(status).json({ error: e?.message || 'failed to update quotation' });
    }
  });

  // ── DELETE /:id — 软删除（仅 Draft） ──
  router.delete('/:id', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      await service.deleteQuotation(req.params.id, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'delete', ids: [req.params.id] });

      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[QuotationRoute] DELETE failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to delete quotation' });
    }
  });

  // ── POST /:id/send — 发送报价单（Draft → Sent） ──
  router.post('/:id/send', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const quotation = await service.sendQuotation(req.params.id, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'send', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST send failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404 : msg.includes('非法') || msg.includes('门禁') ? 409 : 400;
      // DE-6 统一透传：门禁已发起审批单时回传 id，供前端提示「请至审批中心处理」
      res.status(status).json({
        error: msg || 'failed to send quotation',
        ...(e?.code ? { code: e.code } : {}),
        ...(e?.approvalRequestId ? { approvalRequestId: e.approvalRequestId } : {}),
      });
    }
  });

  // ── POST /:id/accept — 接受报价单（Sent → Accepted） ──
  router.post('/:id/accept', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const { note } = req.body;
      const quotation = await service.acceptQuotation(req.params.id, actor?.userId || 'system', note);

      onDataChange?.({ entity: 'Quotation', action: 'accept', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST accept failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to accept quotation' });
    }
  });

  // ── POST /:id/reject — 拒绝报价单（Sent → Rejected） ──
  router.post('/:id/reject', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const { note } = req.body;
      const quotation = await service.rejectQuotation(req.params.id, actor?.userId || 'system', note);

      onDataChange?.({ entity: 'Quotation', action: 'reject', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST reject failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to reject quotation' });
    }
  });

  // ── POST /:id/expire — 标记过期 ──
  router.post('/:id/expire', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const quotation = await service.expireQuotation(req.params.id, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'expire', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST expire failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : 400;
      res.status(status).json({ error: e?.message || 'failed to expire quotation' });
    }
  });

  // ── REQ2-19（DR-060-①）：POST /:id/revise — 显式修订（砍价重报：快照当前版 + version+1 + 回 Draft） ──
  router.post('/:id/revise', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const { changeReason } = req.body || {};
      const quotation = await service.reviseQuotation(req.params.id, changeReason, actor?.userId || 'system');
      onDataChange?.({ entity: 'Quotation', action: 'revise', ids: [quotation.id] });
      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST revise failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft/Sent') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to revise quotation' });
    }
  });

  // ── REQ2-19（DR-060-②）：GET /:id/versions — 版本历史（append-only 正序） ──
  router.get('/:id/versions', async (req: Request, res: Response) => {
    try {
      const versions = await service.listQuotationVersions(req.params.id);
      res.json({ versions });
    } catch (e: any) {
      logger.error('[QuotationRoute] GET versions failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list versions' });
    }
  });

  // ── POST /:id/convert-to-order — 转为正式订单（Accepted → Order） ──
  router.post('/:id/convert-to-order', requireWrite, requireQuotationWrite, async (req: Request, res: Response) => {
    try {
      const actor = (req as any).actor;
      const { poNumber, millName, type, dueDate } = req.body || {};
      const result = await service.convertToOrder(
        req.params.id,
        actor?.userId || 'system',
        { poNumber, millName, type, dueDate },
      );

      onDataChange?.({ entity: 'Quotation', action: 'convert', ids: [result.quotation.id] });
      onDataChange?.({ entity: 'orders', action: 'create', ids: [result.orderId] });

      res.status(201).json(result);
    } catch (e: any) {
      logger.error('[QuotationRoute] POST convert-to-order failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('已转为') ? 409
        : msg.includes('仅 Accepted') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to convert quotation to order' });
    }
  });

  return router;
}
