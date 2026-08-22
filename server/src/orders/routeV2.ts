/**
 * routeV2.ts — Phase 1-02 订单/履约域 V2 路由
 *
 * 挂载点：/api/v2/orders
 *
 * 路由表：
 *   GET    /                  — 列表（带 scope + 筛选 + 分页）
 *   GET    /kanban            — 看板聚合（按 status 分组 count）
 *   GET    /:id               — 详情（带 scope 校验）
 *   POST   /                  — 创建（编号 + 字典 + 配置默认值）
 *   PUT    /:id               — 更新（scope + 字典校验）
 *   PATCH  /:id/status        — 状态流转（状态机校验 + 留痕）
 *   DELETE /:id               — 软删除（scope 校验）
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { extractPdfText } from '../import/extractText';
import { parseTechPackText } from './techPackParser';
import { createOrderServiceV2 } from './orderServiceV2';
import { renderServerDocument } from '../templates/docTemplates/registry';
import { loadOrderConfirmationDocData } from '../templates/docTemplates/orderConfirmation';
import { upsertDomainTradeDocument, generateTradeDocumentFile } from '../customs/tradeDocumentLifecycleService';

/** 上传根目录（与静态服务根同源：BAMBOOK_UPLOAD_DIR 或 apps/Bambook/uploads——
 *  index.ts 静态服务 /api/uploads 的根；本文件在 server/src/orders/ 下需三级回溯） */
const UPLOAD_DIR = process.env.BAMBOOK_UPLOAD_DIR || path.join(__dirname, '../../../uploads');

export interface OrdersV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createOrdersV2Router(opts: OrdersV2RouterOptions): Router {
  const router = Router();

  const guard = createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  router.use(guard);

  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const svc = createOrderServiceV2(opts.prisma);

  function actorOf(req: Request) {
    return extractActorFromRequest(req);
  }

  // ── GET / 列表 ──
  router.get('/', requirePermission('orders:read'), async (req, res) => {
    const actor = actorOf(req);
    const filter = {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      ownerId: typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined,
      departmentId: typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined,
      customerCode: typeof req.query.customerCode === 'string' ? req.query.customerCode : undefined,
      customerRelationId: typeof req.query.customerRelationId === 'string' ? req.query.customerRelationId : undefined,
      businessLine: typeof req.query.businessLine === 'string' ? req.query.businessLine : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
    };
    const result = await svc.listOrders(actor, filter);
    if (!result.ok) return res.status(500).json({ error: result.error!.code, message: result.error!.message });
    return res.json({ ok: true, ...result.data });
  });

  // ── GET /kanban 看板聚合 ──
  router.get('/kanban', requirePermission('orders:read'), async (req, res) => {
    const actor = actorOf(req);
    const filter = {
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      businessLine: typeof req.query.businessLine === 'string' ? req.query.businessLine : undefined,
    };
    const result = await svc.getKanban(actor, filter);
    if (!result.ok) return res.status(500).json({ error: result.error!.code, message: result.error!.message });
    return res.json({ ok: true, ...result.data });
  });

  // ── GET /:id 详情 ──
  router.get('/:id', requirePermission('orders:read'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.getOrder(actor, req.params.id);
    if (!result.ok) {
      const status = result.error!.code === 'NOT_FOUND' ? 404 : 500;
      return res.status(status).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── GET /:id/preview.html — 订单确认书服务端模板预览（B8：实时装配渲染，与生成
  //    PDF 同源排版——所见即所得，无需先登记文档） ──
  router.get('/:id/preview.html', requirePermission('orders:read'), async (req, res) => {
    try {
      const data = await loadOrderConfirmationDocData(opts.prisma, req.params.id);
      if (!data) return res.status(404).json({ error: 'NOT_FOUND', message: '订单不存在' });
      const html = await renderServerDocument(opts.prisma, 'OC', data, { screen: true });
      if (!html) return res.status(500).json({ error: 'RENDER_FAILED', message: 'OC 模板渲染失败' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e: any) {
      res.status(500).json({ error: 'OC_PREVIEW_FAILED', message: e?.message || 'failed to preview order confirmation' });
    }
  });

  // ── POST /:id/generate-document — 登记域单据 + 服务端渲染 PDF 落盘归档（B8）
  //    幂等：domain+type+sourceRef 唯一定位；重复生成刷新头字段并覆盖 PDF（真源实时渲染） ──
  router.post('/:id/generate-document', requireWrite, requirePermission('orders:write'), async (req, res) => {
    try {
      const actor = actorOf(req);
      const order = await opts.prisma.order.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: '订单不存在' });

      const actorId = actor?.userId || 'system';
      const reg = await upsertDomainTradeDocument(opts.prisma, {
        domain: 'orders',
        type: 'OrderConfirmation',
        sourceRef: order.id,
        documentNumber: order.poNumber || undefined, // 文档号=客户 PO 业务单号（缺省 OC- 前缀自动取号）
        orderId: order.id,
        relationId: order.customerRelationId,
        totalAmount: order.quoteAmount != null ? Number(order.quoteAmount) : null,
        currency: order.currency || order.salesCurrency,
        issueDate: order.createdAt ? new Date(Number(order.createdAt)).toISOString().split('T')[0] : undefined,
        actorId,
      });
      const file = await generateTradeDocumentFile(opts.prisma, { id: reg.documentId, actorId });
      return res.json({ ok: true, document: reg, file });
    } catch (e: any) {
      const status = e?.message?.includes('不存在') ? 404 : 500;
      return res.status(status).json({ error: 'OC_GENERATE_FAILED', message: e?.message || 'failed to generate order confirmation document' });
    }
  });

  // ── POST / 创建 ──
  router.post('/', requireWrite, requirePermission('orders:write'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.createOrder(actor, req.body || {});
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, FORBIDDEN: 403, VALIDATION_FAILED: 400, SEQUENCE_FAILED: 500, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── PUT /:id 更新 ──
  router.put('/:id', requireWrite, requirePermission('orders:write'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.updateOrder(actor, req.params.id, req.body || {});
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, FORBIDDEN: 403, VALIDATION_FAILED: 400, NOT_FOUND: 404, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── PATCH /:id/status 状态流转 ──
  router.patch('/:id/status', requireWrite, requirePermission('orders:write'), async (req, res) => {
    const actor = actorOf(req);
    const newStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
    if (!newStatus) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'body.status 必填' });
    const result = await svc.transitionStatus(actor, req.params.id, newStatus, reason);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, VALIDATION_FAILED: 400, NOT_FOUND: 404, INVALID_TRANSITION: 409, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── DELETE /:id 软删除 ──
  router.delete('/:id', requireWrite, requirePermission('orders:delete'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.deleteOrder(actor, req.params.id);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ══════════════════════════════════════════════════════════════════
  // REQ2-18 Tech Pack 结构化解析（DR-059）：上传 PDF（或粘贴文本）→ 规则解析
  // → 预览确认 → 显式勾选回填订单字段。守卫 orders:write。
  // ══════════════════════════════════════════════════════════════════
  const techPackDir = path.join(UPLOAD_DIR, 'techpacks');
  const techPackUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const orderDir = path.join(techPackDir, String(_req.params.id ?? 'unassigned'));
        fs.mkdirSync(orderDir, { recursive: true });
        cb(null, orderDir);
      },
      filename: (_req, file, cb) => {
        const rand = Math.random().toString(36).slice(2, 8);
        cb(null, `${Date.now()}-${rand}${path.extname(file.originalname) || '.pdf'}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
      if (!isPdf) return cb(new Error('UNSUPPORTED_FILE_TYPE'));
      cb(null, true);
    },
  });

  async function parseTechPackForOrder(orderId: string, source: { file?: Express.Multer.File; text?: string }) {
    let text: string;
    let pages = 1;
    let fileName: string | null = null;
    if (source.file) {
      const extracted = await extractPdfText(source.file.buffer);
      text = extracted.text;
      pages = extracted.pages;
      // multipart 通道：先落盘（destination 已按 orderId 分目录），fileName 供保存时登记
      fileName = source.file.filename;
    } else if (typeof source.text === 'string' && source.text.trim()) {
      text = source.text;
    } else {
      return { status: 400, body: { error: 'VALIDATION_FAILED', message: 'multipart file 或 text 二选一必填' } };
    }
    const parsed = parseTechPackText(text);
    if (!parsed.ok) {
      return { status: 422, body: { error: parsed.error!.code, message: parsed.error!.message } };
    }
    return {
      status: 200,
      body: { ok: true, parsed: { ...parsed.snapshot, pages }, fileName, sourceType: source.file ? 'pdf' : 'text' },
    };
  }

  // ── POST /:id/techpack/parse（multipart PDF 或 JSON { text }：解析预览，不落库不回填） ──
  router.post('/:id/techpack/parse', requireWrite, requirePermission('orders:write'), (req, res) => {
    const contentType = String(req.headers['content-type'] ?? '');
    const isMultipart = contentType.includes('multipart/form-data');
    const handler = async () => {
      const order = await (opts.prisma as any).order.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: `订单 ${req.params.id} 不存在` });

      let result: { status: number; body: any };
      if (isMultipart) {
        result = await new Promise(resolve => {
          techPackUpload.single('file')(req, res, async (err: any) => {
            if (err) {
              const code = err.message === 'UNSUPPORTED_FILE_TYPE' ? 'UNSUPPORTED_FILE_TYPE' : 'UPLOAD_FAILED';
              return resolve({ status: 400, body: { error: code, message: err.message } });
            }
            const r = await parseTechPackForOrder(req.params.id, { file: req.file as Express.Multer.File });
            if (r.status !== 200 && req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* 孤儿清理尽力 */ } }
            resolve(r as any);
          });
        });
      } else {
        result = await parseTechPackForOrder(req.params.id, { text: req.body?.text });
      }
      return res.status(result.status).json(result.body);
    };
    handler().catch((e: any) => res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '解析失败' }));
  });

  // ── POST /:id/techpack（保存快照 + 显式 apply 回填） ──
  router.post('/:id/techpack', requireWrite, requirePermission('orders:write'), async (req, res) => {
    try {
      const order = await (opts.prisma as any).order.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: `订单 ${req.params.id} 不存在` });
      const parsed = req.body?.parsed;
      if (!parsed || typeof parsed !== 'object') {
        return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'parsed（解析快照）必填' });
      }
      const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : null;
      const apply = req.body?.apply && typeof req.body.apply === 'object' ? req.body.apply : {};

      const data: Record<string, unknown> = {
        techPack: { ...parsed, uploadedAt: Date.now() },
        techPackFileName: fileName,
      };
      const applied: string[] = [];
      if (apply.product && typeof apply.product === 'string' && apply.product.trim()) { data.product = apply.product.trim(); applied.push('product'); }
      if (apply.quantity != null && Number.isFinite(Number(apply.quantity)) && Number(apply.quantity) > 0) { data.quantity = Math.floor(Number(apply.quantity)); applied.push('quantity'); }
      if (apply.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(apply.dueDate))) { data.dueDate = String(apply.dueDate); applied.push('dueDate'); }
      if (apply.fabricContent && typeof apply.fabricContent === 'string' && apply.fabricContent.trim()) { data.fabricContent = apply.fabricContent.trim(); applied.push('fabricContent'); }
      if (apply.productColorCode && typeof apply.productColorCode === 'string' && apply.productColorCode.trim()) { data.productColorCode = apply.productColorCode.trim(); applied.push('productColorCode'); }

      const updated = await (opts.prisma as any).order.update({ where: { id: req.params.id }, data });
      await writeRouteAuditLog({
        prisma: opts.prisma,
        actorId: actorOf(req)?.userId || 'system',
        source: 'orders-techpack',
        operation: 'techpack_save',
        targetType: 'Order',
        targetId: req.params.id,
        before: { techPack: order.techPack ?? null, quantity: order.quantity, dueDate: order.dueDate, product: order.product },
        after: { fileName, applied, totalQty: parsed.totalQty ?? null },
        ip: req.ip ?? null,
        operationType: 'update',
      });
      return res.json({ ok: true, order: updated, applied });
    } catch (e: any) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '保存失败' });
    }
  });

  // ── GET /:id/techpack（现快照） ──
  router.get('/:id/techpack', requirePermission('orders:read'), async (req, res) => {
    const order = await (opts.prisma as any).order.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: `订单 ${req.params.id} 不存在` });
    return res.json({ ok: true, techPack: order.techPack ?? null, techPackFileName: order.techPackFileName ?? null });
  });

  // ── GET /:id/techpack/file（附件下载） ──
  router.get('/:id/techpack/file', requirePermission('orders:read'), async (req, res) => {
    const order = await (opts.prisma as any).order.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!order || !order.techPackFileName) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '该订单无 Tech Pack 附件' });
    }
    const abs = path.join(techPackDir, String(req.params.id), path.basename(order.techPackFileName));
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '附件文件缺失（可能已被清理）' });
    }
    return res.download(abs, order.techPackFileName.endsWith('.pdf') ? order.techPackFileName : `${order.techPackFileName}.pdf`);
  });

  return router;
}
