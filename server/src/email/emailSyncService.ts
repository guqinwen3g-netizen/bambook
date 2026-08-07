import { PrismaClient } from '@prisma/client';
import imaps from 'imap-simple';
import crypto from 'crypto';
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
}

export async function syncEmailsFromImap(params: EmailSyncParams): Promise<EmailSyncResult> {
  const { prisma, credentials, box = 'INBOX', limit = 100, actorId, imapConnect } = params;

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
      const fullMessages = await connection.search([['UID', ...uids]], {
        bodies: ['HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO CONTENT-TYPE)'],
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
          const snippet = subject.slice(0, 200);

          // C2 自动归档：create 前确定性地算出客户/订单链接，随 create 一并写入
          // （新邮件 relationId/orderId 必为空，无需担心覆盖手工链接）
          const linkUpdates = computeEmailLinkUpdates(
            { relationId: null, orderId: null, direction, fromAddress, toAddresses, subject, snippet },
            relationIndex,
            orderCandidates,
          );

          await (prisma as any).$transaction(async (tx: any) => {
            const createdEmail = await tx.email.create({
              data: {
                id: emailId, messageId, direction, status, fromAddress, fromName, toAddresses, ccAddresses, bccAddresses,
                subject, bodyText: '', bodyHtml: null, snippet,
                mailbox: physicalBoxFinal, uid, uidValidity: null, threadId, sentAt: dateStr, receivedAt: dateStr,
                hasAttachments: false, attachmentCount: 0, createdAt: now, updatedAt: now, syncedAt: now,
                ...linkUpdates,
              },
            });

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
