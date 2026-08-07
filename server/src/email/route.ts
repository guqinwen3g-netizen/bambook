/**
 * Email Module Route — 邮件接收 + 附件存储 + Agent 可查询 (Phase 4a)
 *
 * 路由分两大类：
 *   1. DB-backed 端点（/api/v1/email/...）— 查询已同步到 DB 的邮件
 *   2. IMAP-proxy 端点（/api/email/...）— 向 IMAP 实时代理（前端兼容保留）
 *
 * Phase 4a 新增：
 *   - GET  /api/v1/email          — DB 查询邮件列表（分页/过滤/搜索）
 *   - GET  /api/v1/email/:id      — DB 查询单封邮件详情（含附件）
 *   - POST /api/v1/email/sync     — 触发 IMAP→DB 同步
 *   - GET  /api/v1/email/attachments/:id/download — 下载附件
 *   - PATCH /api/v1/email/:id     — 更新邮件状态（read/starred/important/labels）
 *
 * Phase C2 新增（邮件→客户/订单自动归档）：
 *   - POST /api/v1/email/backfill-links   — 批量回填缺失链接（owner/admin/manager）
 *   - POST /api/v1/email/:id/auto-link    — 单封重算补缺链接
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireRole, extractActorFromRequest } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { PrismaClient } from '@prisma/client';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { sendOutboxEmail } from './outboxSend';
import { syncEmailsFromImap } from './emailSyncService';
import { autoLinkEmailById, backfillEmailLinks } from './emailLinkService';
import { createOutboxEmail, createReplyOutboxEmail } from './emailOutboxMutationService';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SERVER_ROOT = path.resolve(__dirname, '../..');
const UPLOAD_DIR = path.join(SERVER_ROOT, 'uploads', 'email-attachments');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Shared IMAP Helpers ──────────────────────────────────────────

function makeImapConfig(email: string, password: string, host?: string, port = 993) {
  return {
    imap: {
      user: email,
      password,
      host: host || 'imap.qiye.aliyun.com',
      port,
      tls: true,
      authTimeout: 15000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };
}

function findBoxByAttr(boxList: any, attr: string): string | null {
  for (const key in boxList) {
    const mailbox = boxList[key];
    if (mailbox.attribs && mailbox.attribs.some((a: string) => a.toUpperCase() === attr.toUpperCase())) return key;
    if (mailbox.children) {
      const child = findBoxByAttr(mailbox.children, attr);
      if (child) return key + mailbox.delimiter + child;
    }
  }
  return null;
}

const BOX_ATTR_MAP: Record<string, string> = {
  Sent: '\\SENT',
  Trash: '\\TRASH',
  Drafts: '\\DRAFTS',
  Spams: '\\JUNK',
  Junk: '\\JUNK',
};

async function resolvePhysicalBox(connection: any, box: string): Promise<string> {
  let targetBox = box;
  try {
    if (Object.keys(BOX_ATTR_MAP).some((k) => box.startsWith(k))) {
      const boxes = await connection.getBoxes();
      const flag = Object.keys(BOX_ATTR_MAP).find((k) => box.startsWith(k));
      if (flag) {
        const real = findBoxByAttr(boxes, BOX_ATTR_MAP[flag]);
        if (real) targetBox = real;
      }
    }
  } catch (_) {}
  return targetBox;
}

function generateId(prefix: string): string {
  const short = crypto.randomBytes(6).toString('base64url').toUpperCase();
  return `${prefix}__${short}`;
}

// ─── Route Factory ──────────────────────────────────────────────

const EMAIL_OUTBOX_STATUS_MAP: Record<string, number> = { INVALID_INPUT: 400, MISSING_RECIPIENT: 400, MISSING_SUBJECT: 400, MISSING_BODY: 400, MISSING_FROM: 400, ORIGINAL_EMAIL_NOT_FOUND: 404, CREATE_FAILED: 500, SYNC_REF_FAILED: 500, AUDIT_FAILED: 500 };

const EMAIL_SYNC_STATUS_MAP: Record<string, number> = { MISSING_CREDENTIALS: 400, IMAP_CONNECT_FAILED: 502, SYNC_FAILED: 500, DB_WRITE_FAILED: 500, SYNC_REF_FAILED: 500, AUDIT_FAILED: 500, UNKNOWN_ERROR: 500 };

export interface EmailRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createEmailRouter(options: EmailRouterOptions) {
  const { prisma, requireAuth, apiKeys } = options;
  const router = Router();

  // Shared auth guard: JWT or API-key
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  // IMAP GET 端点（/attachment、/image）涉及邮箱凭证查询，必须 JWT 强制（API-Key 不足）
  const requireJwt = (req: Request, res: Response, next: NextFunction) => {
    if (!requireAuth) return next();
    const actor = extractActorFromRequest(req);
    if (actor) {
      (req as any).actor = actor;
      return next();
    }
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'IMAP endpoints require JWT login (API key insufficient).' });
  };


  // ══════════════════════════════════════════════════════════════
  // DB-backed endpoints (/api/v1/email)
  // ══════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/email — 查询 DB 中的邮件列表
   * Query params: mailbox, direction, status, fromAddress, subject, orderId, relationId, limit, offset
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const {
        mailbox,
        direction,
        status,
        fromAddress,
        subject,
        orderId,
        relationId,
        limit = '50',
        offset = '0',
      } = req.query as Record<string, string>;

      const where: any = { deletedAt: null };
      if (mailbox) where.mailbox = mailbox;
      if (direction) where.direction = direction;
      if (status) where.status = status;
      if (fromAddress) where.fromAddress = { contains: fromAddress, mode: 'insensitive' };
      if (subject) where.subject = { contains: subject, mode: 'insensitive' };
      if (orderId) where.orderId = orderId;
      if (relationId) where.relationId = relationId;

      const [items, total] = await Promise.all([
        prisma.email.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: Number(offset),
          take: Number(limit),
          include: {
            attachments: {
              select: { id: true, filename: true, contentType: true, fileSize: true, isInline: true },
            },
          },
        }),
        prisma.email.count({ where }),
      ]);

      res.json({ ok: true, items, total });
    } catch (e: any) {
      logger.error('[email] list error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /**
   * PATCH /api/v1/email/:id — 更新邮件状态/标签
   */
  router.patch('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const EMAIL_PATCH_FIELDS = ['status', 'isRead', 'isStarred', 'isImportant', 'labels', 'orderId', 'relationId', 'orderPo', 'invoiceId', 'invoiceNumber', 'aiSummary'];
      const data: any = {};
      for (const key of EMAIL_PATCH_FIELDS) {
        if (req.body[key] !== undefined) data[key] = req.body[key];
      }
      data.updatedAt = BigInt(Date.now());

      // Map boolean flags to status string for backward compat
      if (req.body.isRead !== undefined) {
        data.status = req.body.isRead ? 'read' : 'new';
      }
      if (req.body.isStarred === true) data.status = 'starred';
      if (req.body.isImportant === true) data.status = 'important';

      const email = await prisma.email.update({
        where: { id: req.params.id },
        data,
      });
      res.json({ ok: true, data: email });
    } catch (e: any) {
      logger.error('[email] patch error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /**
   * POST /api/v1/email/sync — 触发 IMAP→DB 同步
   */
  router.post('/sync', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const { email, password, host, port, box, limit } = req.body || {};
    const result = await syncEmailsFromImap({
      prisma,
      credentials: { user: email || '', pass: password || '', host, port },
      box: box || 'INBOX',
      limit: limit || 100,
      actorId: actorIdFromRequest(req),
    });
    if (!result.ok) {
      return res.status(EMAIL_SYNC_STATUS_MAP[result.error!.code]).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, ...result.data! });
  });

  /**
   * POST /api/v1/email/backfill-links — C2 批量回填邮件→客户/订单链接
   * 扫描 relationId/orderId 缺失的邮件，按确定性口径（地址匹配 + PO 包含）补链；
   * 手工已设置的链接绝不覆盖。批量写操作，限 owner/admin/manager。
   */
  router.post('/backfill-links', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const limit = Number((req.body || {}).limit) || undefined;
      const result = await backfillEmailLinks(prisma, { limit, actorId: actorIdFromRequest(req) });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[email] backfill-links error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'BACKFILL_FAILED', message: String(e?.message ?? e) } });
    }
  });

  /**
   * POST /api/v1/email/:id/auto-link — C2 单封邮件自动归档（重算并补缺链接）
   * 已同时具有 relationId + orderId 的邮件直接返回 alreadyLinked。
   */
  router.post('/:id/auto-link', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await autoLinkEmailById(prisma, req.params.id, { actorId: actorIdFromRequest(req) });
      if ('error' in result) {
        return res.status(404).json({ ok: false, error: { code: result.error, message: 'Email not found' } });
      }
      res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[email] auto-link error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'AUTO_LINK_FAILED', message: String(e?.message ?? e) } });
    }
  });

  /**
   * POST /api/v1/email/outbox — 手动 compose 创建 Outbox Email（shared service）
   */
  router.post('/outbox', requireWrite, async (req: Request, res: Response) => {
    const { fromAddress, fromName, to, cc, bcc, subject, bodyText, bodyHtml, threadId, relationId, relationName, orderId, orderPo, invoiceId, invoiceNumber } = req.body || {};
    const result = await createOutboxEmail({
      prisma,
      input: { fromAddress, fromName, to, cc, bcc, subject, bodyText, bodyHtml, threadId, relationId, relationName, orderId, orderPo, invoiceId, invoiceNumber },
      actorId: actorIdFromRequest(req),
      ip: req.ip,
    });
    if (!result.ok) {
      return res.status(EMAIL_OUTBOX_STATUS_MAP[result.error!.code]).json({ ok: false, error: result.error });
    }
    res.status(201).json({ ok: true, emailId: result.data!.emailId, mailbox: result.data!.mailbox, direction: result.data!.direction, auditId: result.data!.auditId });
  });

  /**
   * POST /api/v1/email/replies — 手动 reply 创建 Outbox Email（shared service，threading from original）
   */
  router.post('/replies', requireWrite, async (req: Request, res: Response) => {
    const { originalEmailId, fromAddress, fromName, to, cc, bcc, subject, bodyText, bodyHtml, threadId, relationId, relationName, orderId, orderPo, invoiceId, invoiceNumber } = req.body || {};
    const result = await createReplyOutboxEmail({
      prisma,
      input: { originalEmailId, fromAddress, fromName, to, cc, bcc, subject, bodyText, bodyHtml, threadId, relationId, relationName, orderId, orderPo, invoiceId, invoiceNumber },
      actorId: actorIdFromRequest(req),
      ip: req.ip,
    });
    if (!result.ok) {
      return res.status(EMAIL_OUTBOX_STATUS_MAP[result.error!.code]).json({ ok: false, error: result.error });
    }
    res.status(201).json({ ok: true, emailId: result.data!.emailId, mailbox: result.data!.mailbox, direction: result.data!.direction, auditId: result.data!.auditId });
  });

  /**
   * POST /api/v1/email/outbox/:id/send — Outbox Email 显式 SMTP 发送
   * 只能发送已存在的 Email(direction=outbound, mailbox=Outbox)。
   * SMTP 成功后更新 Sent + sentAt + messageId；失败保持 Outbox。
   */
  router.post('/outbox/:id/send', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const emailId = req.params.id;
      const { email, password, host, port } = req.body || {};
      const result = await sendOutboxEmail({
        prisma,
        emailId,
        credentials: { user: email, pass: password, host, port },
        actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        return res.status(result.error!.statusCode).json({ ok: false, error: result.error });
      }
      res.json({ ok: true, ...result.data! });
    } catch (e: any) {
      logger.error('[email] outbox send error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'UNKNOWN_ERROR', message: String(e?.message ?? e), statusCode: 500 } });
    }
  });

  /**
   * GET /api/v1/email/attachments/:id/download — 下载附件
   */
  router.get('/attachments/:id/download', async (req: Request, res: Response) => {
    try {
      const att = await prisma.emailAttachment.findUnique({ where: { id: req.params.id } });
      if (!att || !att.filePath) return res.status(404).send('Attachment not found');

      const fullPath = path.join(SERVER_ROOT, att.filePath);
      if (!fs.existsSync(fullPath)) return res.status(404).send('File not found on disk');

      const safeFilename = encodeURIComponent(att.filename || 'download');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Content-Type', att.contentType);
      res.sendFile(fullPath);
    } catch (e: any) {
      logger.error('[email] attachment download error', { error: e?.message || String(e) });
      res.status(500).send('Download failed');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // IMAP-proxy endpoints (/api/email) — 兼容旧前端
  // ══════════════════════════════════════════════════════════════

  /**
   * POST /api/email/fetch — IMAP 实时获取邮件列表（兼容旧前端）
   */
  router.post('/fetch', requireWrite, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', limit = 50, offset = 0 } = req.body;
    let targetBox = box;
    let availableBoxes: string[] = [];

    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const config = makeImapConfig(email, password, host, port);

    try {
      const connection = await imaps.connect(config);

      let searchCriteria: any[] = ['ALL'];
      let isVirtual = false;

      if (box === 'IMPORTANT') {
        targetBox = 'INBOX';
        searchCriteria = [['OR', 'KEYWORD', 'Important', ['OR', 'KEYWORD', '$Important', 'KEYWORD', '\\Important']]];
        isVirtual = true;
      } else if (box === 'STARRED') {
        targetBox = 'INBOX';
        searchCriteria = ['FLAGGED'];
        isVirtual = true;
      } else if (box === 'UNREAD') {
        targetBox = 'INBOX';
        searchCriteria = ['UNSEEN'];
        isVirtual = true;
      }

      if (!isVirtual) {
        try {
          const boxes = await connection.getBoxes();
          availableBoxes = Object.keys(boxes);
          if (['Sent Messages', 'Sent', 'Trash', 'Drafts', 'Spams', 'Junk'].includes(box)) {
            targetBox = await resolvePhysicalBox(connection, box);
          }
        } catch (_) {}
      }

      try { await connection.openBox(targetBox); }
      catch (err: any) { throw new Error(`Box not found: ${targetBox}`); }

      const metaMessages = await connection.search(searchCriteria, { bodies: [], struct: false });
      const sortedMeta = metaMessages.sort((a: any, b: any) => {
        const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
        const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
        return dateB - dateA;
      });

      const total = sortedMeta.length;
      const targetMeta = sortedMeta.slice(Number(offset), Number(offset) + Number(limit));

      if (targetMeta.length === 0) {
        connection.end();
        return res.json({ status: 'success', data: [], total, debug: { limit, offset, foundTotal: total, targetBox } });
      }

      const targetUids = targetMeta.map((m: any) => m.attributes.uid);
      const fullMessages = await connection.search([['UID', ...targetUids]], {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE CONTENT-TYPE)'],
        markSeen: false,
        struct: true,
      });

      const messageMap = new Map();
      for (const msg of fullMessages) messageMap.set(msg.attributes.uid, msg);

      const emails = targetMeta.map((meta: any) => {
        const item = messageMap.get(meta.attributes.uid);
        if (!item) return null;
        const id = item.attributes.uid;
        const headerPart = item.parts.find((p: any) => p.which !== '');
        const headers = (headerPart && headerPart.body) || {};
        const sender = headers.from?.[0] || 'Unknown';
        const subject = headers.subject?.[0] || '(No Subject)';
        const dateStr = headers.date?.[0] || new Date().toISOString();

        return {
          id: `${box}-${id}`, uid: id, box, realBox: targetBox, sender, subject,
          body: '', snippet: '', date: new Date(dateStr),
          isRead: item.attributes.flags?.includes('\\Seen'),
          isStarred: item.attributes.flags?.includes('\\Flagged'),
          isImportant: item.attributes.flags?.includes('\\Important') || item.attributes.flags?.includes('$Important'),
          attachments: [],
        };
      });

      connection.end();
      res.json({
        status: 'success', data: emails.filter(Boolean), total,
        debug: { limit, offset, foundTotal: total, targetBox, availableBoxes },
      });
    } catch (err: any) {
      res.status(500).json({ error: '邮箱连接失败: ' + err.message });
    }
  });

  /**
   * POST /api/email/send — 发送邮件
   */
  router.post('/send', requireWrite, async (req: Request, res: Response) => {
    const { email, password, to, subject, body, text, host, port = 465 } = req.body;
    if (!email || !password || !to) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const transporter = nodemailer.createTransport({
        host: host || 'smtp.qiye.aliyun.com', port, secure: true,
        auth: { user: email, pass: password },
      });

      const mailOptions: any = { from: `"${email}" <${email}>`, to, subject };
      if (text) mailOptions.text = text;
      else if (body) { mailOptions.text = body; mailOptions.html = body.replace(/\n/g, '<br>'); }

      const info = await transporter.sendMail(mailOptions);
      res.json({ status: 'success', messageId: info.messageId });
    } catch (e: any) {
      res.status(500).json({ error: '邮件发送失败: ' + e.message });
    }
  });

  /**
   * POST /api/email/mark_read
   */
  router.post('/mark_read', requireWrite, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', uid, isRead = true } = req.body;
    if (!email || !password || !uid) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, port));
      const targetBox = await resolvePhysicalBox(connection, box);
      await connection.openBox(targetBox);
      if (isRead) await connection.addFlags(uid, '\\Seen');
      else await connection.delFlags(uid, '\\Seen');
      connection.end();
      res.json({ status: 'success' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/email/mark_starred
   */
  router.post('/mark_starred', requireWrite, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', uid, isStarred = true } = req.body;
    if (!email || !password || !uid) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, port));
      const targetBox = await resolvePhysicalBox(connection, box);
      await connection.openBox(targetBox);
      if (isStarred) await connection.addFlags(uid, '\\Flagged');
      else await connection.delFlags(uid, '\\Flagged');
      connection.end();
      res.json({ status: 'success' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/email/mark_important
   */
  router.post('/mark_important', requireWrite, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', uid, isImportant = true } = req.body;
    if (!email || !password || !uid) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, port));
      const targetBox = await resolvePhysicalBox(connection, box);
      await connection.openBox(targetBox);
      if (isImportant) await connection.addFlags(uid, ['\\Important', '$Important']);
      else await connection.delFlags(uid, ['\\Important', '$Important']);
      connection.end();
      res.json({ status: 'success' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/email/move
   */
  router.post('/move', requireWrite, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', uid, toBox } = req.body;
    if (!email || !password || !uid || !toBox) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, port));
      let sourceBox = await resolvePhysicalBox(connection, box);
      let destinationBox = await resolvePhysicalBox(connection, toBox);

      await connection.openBox(sourceBox);
      await connection.moveMessage(uid, destinationBox);
      connection.end();
      res.json({ status: 'success' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/email/attachment — 下载附件（IMAP 实时代理）
   */
  router.get('/attachment', requireJwt, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', uid, filename } = req.query as Record<string, string>;
    if (!email || !password || !uid || !filename) return res.status(400).send('Missing parameters');

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, Number(port)));
      await connection.openBox(box);
      const messages = await connection.search([['UID', uid]], { bodies: [''], markSeen: false, struct: true });
      if (messages.length === 0) { connection.end(); return res.status(404).send('Message not found'); }

      const all = messages[0].parts.find((part: any) => part.which === '');
      if (!all) { connection.end(); return res.status(404).send('Message body not found'); }
      const parsed = await simpleParser(all.body);
      const attachment = parsed.attachments.find((att: any) => att.filename === filename || att.checksum === filename);

      if (!attachment) { connection.end(); return res.status(404).send('Attachment not found'); }

      const safeFilename = encodeURIComponent(attachment.filename || 'download');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Content-Type', attachment.contentType);
      res.send(attachment.content);
      connection.end();
    } catch (e: any) {
      res.status(500).send('Download failed: ' + e.message);
    }
  });

  /**
   * GET /api/email/image — 获取邮件内嵌图片
   */
  router.get('/image', requireJwt, async (req: Request, res: Response) => {
    const { email, password, host, port, box, uid, cid } = req.query as Record<string, string>;
    if (!email || !password || !uid || !cid) return res.status(400).send('Missing parameters');

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, Number(port) || 993));
      await connection.openBox(box);
      const messages = await connection.search([['UID', uid]], { bodies: [''], markSeen: false, struct: true });
      if (messages.length === 0) { connection.end(); return res.status(404).send('Not found'); }

      const all = messages[0].parts.find((part: any) => part.which === '');
      if (!all) { connection.end(); return res.status(404).send('Not found'); }
      const parsed = await simpleParser(all.body);
      const image = parsed.attachments.find((att: any) => att.contentId && att.contentId.replace(/[<>]/g, '') === cid);

      if (!image) { connection.end(); return res.status(404).send('Image not found'); }

      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(image.content);
      connection.end();
    } catch (_) {
      res.status(500).end();
    }
  });

  /**
   * POST /api/email/detail — 获取单封邮件完整详情
   */
  router.post('/detail', requireWrite, async (req: Request, res: Response) => {
    const { email, password, host, port = 993, box = 'INBOX', uid } = req.body;
    if (!email || !password || !uid) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const connection = await imaps.connect(makeImapConfig(email, password, host, port));
      let targetBox = box;

      try { await connection.openBox(targetBox); }
      catch (_) {
        if (box === 'Sent Messages' || box === 'Sent') targetBox = 'Sent Items';
        await connection.openBox(targetBox);
      }

      const messages = await connection.search([['UID', uid]], {
        bodies: ['HEADER', 'TEXT', ''],
        markSeen: true,
        struct: true,
      });

      if (messages.length === 0) { connection.end(); return res.status(404).json({ error: 'Message not found' }); }

      const item = messages[0];
      const all = item.parts.find((part: any) => part.which === '') || { body: '' };

      let parsed: any;
      try { parsed = await simpleParser(all.body); }
      catch (_) { parsed = { subject: '(Parse Error)', date: new Date(), text: '' }; }

      let htmlBody = parsed.html || parsed.textAsHtml || '';
      const attachmentsMeta: any[] = [];

      if (parsed.attachments) {
        parsed.attachments.forEach((att: any) => {
          const rawCid = att.contentId ? att.contentId.replace(/[<>]/g, '') : null;
          if (rawCid && htmlBody.includes(`cid:${rawCid}`)) {
            const params = new URLSearchParams({ email, password, host, port: String(port), box: targetBox, uid: String(uid), cid: rawCid });
            const proxyUrl = `/api/email/image?${params.toString()}`;
            htmlBody = htmlBody.split(`cid:${rawCid}`).join(proxyUrl);
          } else if (att.contentDisposition === 'inline') {
            // Skip inline images
          } else {
            attachmentsMeta.push({
              filename: att.filename || 'Untitled',
              contentType: att.contentType,
              size: att.size,
              id: att.checksum,
            });
          }
        });
      }

      const fullEmail = {
        id: `${box}-${uid}`, uid, box,
        sender: parsed.from?.text || 'Unknown',
        subject: parsed.subject || '(No Subject)',
        body: htmlBody || parsed.text || '',
        date: parsed.date || new Date(),
        isRead: true,
        attachments: attachmentsMeta,
      };

      connection.end();
      res.json({ status: 'success', data: fullEmail });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/v1/email/:id — 查询单封邮件详情
   *
   * 注意：此通配路由必须放在所有具名 GET 路由（/attachment、/image 等）之后，
   * 否则动态参数 /:id 会遮蔽具名路由（task A2 安全修复：IMAP 端点 requireJwt 才能生效）。
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const email = await prisma.email.findFirst({
        where: { id: req.params.id, deletedAt: null },
        include: { attachments: true },
      });
      if (!email) return res.status(404).json({ ok: false, error: 'Email not found' });
      res.json({ ok: true, data: email });
    } catch (e: any) {
      logger.error('[email] get error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
