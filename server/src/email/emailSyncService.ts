import { PrismaClient } from '@prisma/client';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { syncEmailReferences } from './sync';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import {
  computeEmailLinkUpdates,
  loadOrderCandidates,
  loadRelationAddressIndex,
  type OrderCandidate,
  type RelationCandidate,
} from './emailLinkService';
import { classifyEmailByRules } from './emailClassificationService';
import { createNotificationService } from '../notifications/notificationService';

export type EmailSyncErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'IMAP_CONNECT_FAILED'
  | 'SYNC_FAILED'
  | 'DB_WRITE_FAILED'
  | 'SYNC_REF_FAILED'
  | 'AUDIT_FAILED'
  | 'UNKNOWN_ERROR';

export interface EmailSyncError { code: EmailSyncErrorCode; message: string; }
export interface EmailSyncResult {
  ok: boolean;
  error?: EmailSyncError;
  data?: { synced: number; skipped: number; errors: number; accountMasked: string; auditIds: string[] };
}

const STATUS_CODE_MAP: Record<EmailSyncErrorCode, number> = {
  MISSING_CREDENTIALS: 400,
  IMAP_CONNECT_FAILED: 502,
  SYNC_FAILED: 500,
  DB_WRITE_FAILED: 500,
  SYNC_REF_FAILED: 500,
  AUDIT_FAILED: 500,
  UNKNOWN_ERROR: 500,
};

export function buildEmailSyncError(code: EmailSyncErrorCode, message: string): EmailSyncError {
  return { code, message: sanitizeMessage(message) };
}

function sanitizeMessage(msg: string): string {
  return String(msg || '').replace(/password[=:]\s*[^\s;,)]+/gi, 'password=***').replace(/pass[=:]\s*[^\s;,)]+/gi, 'pass=***').replace(/authorization:\s*bearer\s+[^\s]+/gi, 'authorization: Bearer ***').trim();
}

export function maskAccount(account: string): string {
  if (!account || !account.includes('@')) return '***';
  const [local, domain] = account.split('@');
  const masked = local.length > 2 ? local.slice(0, 2) + '***' : '***';
  return `${masked}@${domain}`;
}

export interface EmailSyncParams {
  prisma: PrismaClient;
  credentials: { user: string; pass: string; host?: string; port?: number };
  box?: string;
  limit?: number;
  actorId?: string;
  imapConnect?: typeof imaps.connect;
  /** L3：附件落盘器（默认写 server/uploads/email-attachments；测试注入 stub 避免真实磁盘写入） */
  saveAttachment?: EmailAttachmentSaver;
}

// ─── L3 附件落盘 ──────────────────────────────────────────────

const SERVER_ROOT = path.resolve(__dirname, '../..');
const EMAIL_ATTACHMENT_DIR = path.join(SERVER_ROOT, 'uploads', 'email-attachments');

/** 返回相对 SERVER_ROOT 的存储路径（与 /api/v1/email/attachments/:id/download 的 path.join(SERVER_ROOT, filePath) 口径一致）；失败返回 null */
export type EmailAttachmentSaver = (emailId: string, attachment: { filename: string; content: Buffer }) => string | null;

export const defaultEmailAttachmentSaver: EmailAttachmentSaver = (emailId, attachment) => {
  try {
    if (!Buffer.isBuffer(attachment.content) || attachment.content.length === 0) return null;
    if (!fs.existsSync(EMAIL_ATTACHMENT_DIR)) fs.mkdirSync(EMAIL_ATTACHMENT_DIR, { recursive: true });
    const safeName = String(attachment.filename || 'unnamed').replace(/[\\/:*?"<>|]/g, '_').slice(-120) || 'unnamed';
    const relPath = path.join('uploads', 'email-attachments', `${emailId}_${crypto.randomBytes(4).toString('hex')}_${safeName}`);
    fs.writeFileSync(path.join(SERVER_ROOT, relPath), attachment.content);
    return relPath;
  } catch (e: any) {
    logger.warn('[email-sync] attachment save failed (metadata still recorded)', { error: sanitizeMessage(String(e?.message || e)) });
    return null;
  }
};

interface ParsedAttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
  content: Buffer | null;
}

interface ParsedBody {
  text: string;
  html: string | null;
  attachments: ParsedAttachmentMeta[];
}

/** L4：解析完整邮件源（simpleParser）；失败返回 null 由调用方降级 */
async function parseFullMessage(raw: unknown): Promise<ParsedBody | null> {
  const isUsable = typeof raw === 'string' ? raw.length > 0 : Buffer.isBuffer(raw) && raw.length > 0;
  if (!isUsable) return null;
  try {
    const parsed = await simpleParser(raw as string | Buffer);
    const text = (parsed.text || '').trim();
    const html = typeof parsed.html === 'string' && parsed.html.length > 0 ? parsed.html : null;
    const attachments: ParsedAttachmentMeta[] = (parsed.attachments || []).map((att: any) => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      size: typeof att.size === 'number' ? att.size : (att.content?.length ?? 0),
      contentId: att.contentId ? String(att.contentId).replace(/[<>]/g, '') : null,
      isInline: att.contentDisposition === 'inline',
      content: Buffer.isBuffer(att.content) ? att.content : null,
    }));
    return { text, html, attachments };
  } catch (e: any) {
    logger.warn('[email-sync] full message parse failed; fallback to header-only', { error: sanitizeMessage(String(e?.message || e)) });
    return null;
  }
}

export async function syncEmailsFromImap(params: EmailSyncParams): Promise<EmailSyncResult> {
  const { prisma, credentials, box = 'INBOX', limit = 100, actorId, imapConnect } = params;
  const saveAttachment = params.saveAttachment || defaultEmailAttachmentSaver;

  if (!credentials?.user || !credentials?.pass) {
    return { ok: false, error: buildEmailSyncError('MISSING_CREDENTIALS', 'email and password are required') };
  }

  const account = credentials.user;
  const accountMasked = maskAccount(account);

  const config = {
    imap: {
      user: account,
      password: credentials.pass,
      host: credentials.host || 'imap.qiye.aliyun.com',
      port: credentials.port || 993,
      tls: true,
      authTimeout: 15000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  const connect = imapConnect || imaps.connect;
  let connection: any = null;

  try {
    try {
      connection = await connect(config);
    } catch (e: any) {
      return { ok: false, error: buildEmailSyncError('IMAP_CONNECT_FAILED', `IMAP connect failed: ${sanitizeMessage(e?.message || String(e))}`) };
    }

    try {
      const physicalBox = await resolvePhysicalBox(connection, box);
      await connection.openBox(physicalBox);

      const results = await connection.search(['ALL'], { bodies: [], struct: false });
      const sorted = results.sort((a: any, b: any) => {
        const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
        const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
        return dateB - dateA;
      });

      const toSync = sorted.slice(0, limit);
      if (toSync.length === 0) {
        return { ok: true, data: { synced: 0, skipped: 0, errors: 0, accountMasked, auditIds: [] } };
      }

      const uids = toSync.map((m: any) => m.attributes.uid);
      // L3/L4：除 header 外同时拉取完整邮件源（'' = full message），用于 bodyText 入库与附件记录
      const fullMessages = await connection.search([['UID', ...uids]], {
        bodies: ['HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO CONTENT-TYPE)', ''],
        markSeen: false,
        struct: true,
      });

      let synced = 0, skipped = 0, errors = 0;
      const auditIds: string[] = [];
      const physicalBoxFinal = physicalBox;

      // C2 自动归档：客户/订单匹配索引每批次加载一次（避免逐封全表扫描）；
      // 索引加载失败降级为不链接，不阻断同步主流程
      let relationIndex: Map<string, RelationCandidate> = new Map();
      let orderCandidates: OrderCandidate[] = [];
      try {
        [relationIndex, orderCandidates] = await Promise.all([
          loadRelationAddressIndex(prisma),
          loadOrderCandidates(prisma),
        ]);
      } catch (idxErr: any) {
        logger.warn('[email-sync] Auto-link index load failed; sync continues without auto-link', { error: sanitizeMessage(String(idxErr?.message || idxErr)) });
      }

      for (const item of fullMessages) {
        try {
          const headerPart = item.parts.find((p: any) => p.which !== '');
          const headers = (headerPart && headerPart.body) || {};
          const messageId = headers['message-id']?.[0]?.replace(/[<>]/g, '') || null;
          const uid = item.attributes.uid;

          if (messageId) {
            const existing = await prisma.email.findFirst({ where: { messageId } });
            if (existing) { skipped++; continue; }
          }

          // L4：解析完整邮件源（'' part）→ bodyText/bodyHtml/附件；解析失败降级为 header-only（原行为）
          const rawPart = item.parts.find((p: any) => p.which === '');
          const parsedBody = await parseFullMessage(rawPart?.body);
          const nonInlineAttachments = (parsedBody?.attachments || []).filter(a => !a.isInline);

          const sender = headers.from?.[0] || 'Unknown';
          const fromMatch = sender.match(/^(.+?)\s*<(.+?)>$/) || [null, null, sender];
          const fromName = fromMatch[1]?.trim() || null;
          const fromAddress = fromMatch[2]?.trim() || sender;
          const toAddresses = JSON.stringify(headers.to || []);
          const ccAddresses = headers.cc ? JSON.stringify(headers.cc) : null;
          const bccAddresses = headers.bcc ? JSON.stringify(headers.bcc) : null;
          const subject = headers.subject?.[0] || '(No Subject)';
          const dateStr = headers.date?.[0] || new Date().toISOString();
          const direction = box === 'Sent Messages' || box === 'Sent' || box === 'Sent Items' ? 'outbound' : 'inbound';
          const status = item.attributes.flags?.includes('\\Seen') ? 'read' : 'new';
          const references = headers.references?.[0] || headers['in-reply-to']?.[0] || null;
          const threadId = references ? crypto.createHash('md5').update(references).digest('hex').slice(0, 12) : null;
          const now = BigInt(Date.now());
          const emailId = generateId('EML');
          // L4：snippet 优先取 bodyText 前 200 字（schema 注释口径），无正文时维持原 subject 口径
          const snippet = parsedBody?.text
            ? parsedBody.text.replace(/\s+/g, ' ').trim().slice(0, 200)
            : subject.slice(0, 200);
          const bodyText = parsedBody?.text || '';
          const bodyHtml = parsedBody?.html || null;

          // C2 自动归档：create 前确定性地算出客户/订单链接，随 create 一并写入
          // （新邮件 relationId/orderId 必为空，无需担心覆盖手工链接）
          const linkUpdates = computeEmailLinkUpdates(
            { relationId: null, orderId: null, direction, fromAddress, toAddresses, subject, snippet },
            relationIndex,
            orderCandidates,
          );

          // C8 智能分类：规则层内联（零 LLM 成本），新邮件落库即带业务标签；
          // AI 增强由分类端点按需触发，不在批量同步路径调用
          const ruleLabels = classifyEmailByRules({
            direction, fromAddress, subject, snippet,
            relationId: linkUpdates.relationId ?? null,
            hasAttachments: nonInlineAttachments.length > 0,
          });

          await (prisma as any).$transaction(async (tx: any) => {
            const createdEmail = await tx.email.create({
              data: {
                id: emailId, messageId, direction, status, fromAddress, fromName, toAddresses, ccAddresses, bccAddresses,
                subject, bodyText, bodyHtml, snippet,
                mailbox: physicalBoxFinal, uid, uidValidity: null, threadId, sentAt: dateStr, receivedAt: dateStr,
                hasAttachments: nonInlineAttachments.length > 0, attachmentCount: nonInlineAttachments.length,
                labels: ruleLabels, createdAt: now, updatedAt: now, syncedAt: now,
                ...linkUpdates,
              },
            });

            // L3：同步时创建附件记录（元数据入库 + 内容落盘，供 /attachments/:id/download）
            for (const att of parsedBody?.attachments || []) {
              const filePath = att.content ? saveAttachment(emailId, { filename: att.filename, content: att.content }) : null;
              const attachmentId = generateId('EMLATT');
              await tx.emailAttachment.create({
                data: {
                  id: attachmentId, emailId,
                  filename: att.filename, contentType: att.contentType, fileSize: att.size,
                  contentId: att.contentId, filePath,
                  fileUrl: `/api/v1/email/attachments/${attachmentId}/download`,
                  isInline: att.isInline, createdAt: now, updatedAt: now,
                },
              });
            }

            try {
              await syncEmailReferences(prisma, createdEmail, { source: 'email-sync', tx });
            } catch (syncErr: any) {
              throw Object.assign(new Error('syncEmailReferences failed'), { code: 'SYNC_REF_FAILED', inner: syncErr });
            }

            try {
              const aId = await writeRouteAuditLog({
                prisma: tx, actorId: actorId || 'system', source: 'route:email:sync',
                operation: 'imap_sync_email', targetType: 'Email', targetId: emailId,
                after: { messageId, subject, fromAddress, mailbox: physicalBoxFinal },
              });
              auditIds.push(aId);
            } catch (auditErr: any) {
              throw Object.assign(new Error('audit failed'), { code: 'AUDIT_FAILED', inner: auditErr });
            }
          });
          synced++;

          // PRD 7.1「新邮件含询价关键词」：入站邮件规则层命中 inquiry → 提醒业务员
          // 触发点在同步事务落库之后；同步幂等（messageId/uid 去重）保证同一封邮件只通知一次
          if (direction === 'inbound' && ruleLabels.includes('inquiry')) {
            try {
              const notificationService = createNotificationService(prisma);
              const customerLabel = linkUpdates.relationName ?? fromName ?? fromAddress;
              await notificationService.broadcastNotification({
                type: 'email_inquiry',
                title: `客户 ${customerLabel} 发来新询价`,
                body: `${customerLabel}（${fromAddress}）发来询价邮件「${subject}」${linkUpdates.orderPo ? `，疑似关联订单 ${linkUpdates.orderPo}` : ''}，请及时跟进报价。`,
                level: 'info',
                link: `/inbox?id=${emailId}`,
                metadata: { stuckKey: `email:inquiry:${emailId}`, entityType: 'Email', entityId: emailId, fromAddress, relationId: linkUpdates.relationId ?? null, orderId: linkUpdates.orderId ?? null },
              });
            } catch (notifyErr: any) {
              // 通知失败不阻断同步主流程
              logger.warn('[email-sync] inquiry notification failed (non-blocking)', { error: sanitizeMessage(String(notifyErr?.message || notifyErr)) });
            }
          }
        } catch (err: any) {
          if (err?.code === 'P2002') { skipped++; continue; }
          if (err?.code === 'SYNC_REF_FAILED' || err?.code === 'AUDIT_FAILED') throw err;
          logger.error('[email-sync] Error processing message', { error: sanitizeMessage(String(err?.message || err)) });
          errors++;
        }
      }

      if (synced === 0 && skipped === 0 && errors > 0) {
        return { ok: false, error: buildEmailSyncError('DB_WRITE_FAILED', `All ${errors} messages failed to write`) };
      }

      return { ok: true, data: { synced, skipped, errors, accountMasked, auditIds } };
    } catch (e: any) {
      if (e?.code === 'SYNC_REF_FAILED') return { ok: false, error: buildEmailSyncError('SYNC_REF_FAILED', sanitizeMessage(String(e?.inner?.message || e?.message || e))) };
      if (e?.code === 'AUDIT_FAILED') return { ok: false, error: buildEmailSyncError('AUDIT_FAILED', sanitizeMessage(String(e?.inner?.message || e?.message || e))) };
      return { ok: false, error: buildEmailSyncError('SYNC_FAILED', sanitizeMessage(e?.message || String(e))) };
    }
  } catch (e: any) {
    return { ok: false, error: buildEmailSyncError('UNKNOWN_ERROR', sanitizeMessage(e?.message || String(e))) };
  } finally {
    if (connection) { try { await connection.end(); } catch {} }
  }
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
  Sent: '\\SENT', Trash: '\\TRASH', Drafts: '\\DRAFTS', Spams: '\\JUNK', Junk: '\\JUNK',
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
  } catch {}
  return targetBox;
}

function generateId(prefix: string): string {
  const short = crypto.randomBytes(6).toString('base64url').toUpperCase();
  return `${prefix}__${short}`;
}
