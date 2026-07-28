/**
 * ERP-P1-email-outbox-send-route-foundation
 *
 * Outbox Email 显式 SMTP 发送地基。
 * 只能发送已存在的 Email(direction=outbound, mailbox=Outbox) 事实行。
 * SMTP 成功后才把同一 Email 更新为 Sent 并写 sentAt/messageId；SMTP 失败保持 Outbox。
 * 不修改 email.reply_and_send / invoice.issue 的 commit 边界（它们仍只写 Outbox）。
 */

import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import { writeRouteAuditLog } from '../audit/routeAudit';

export type OutboxSendErrorCode =
  | 'EMAIL_NOT_FOUND'
  | 'EMAIL_NOT_OUTBOUND'
  | 'EMAIL_NOT_OUTBOX'
  | 'EMAIL_ALREADY_SENT'
  | 'MISSING_RECIPIENT'
  | 'MISSING_CREDENTIALS'
  | 'SMTP_SEND_FAILED'
  | 'SMTP_MESSAGE_ID_MISSING'
  | 'DB_UPDATE_FAILED'
  | 'UNKNOWN_ERROR';

export interface OutboxSendError {
  code: OutboxSendErrorCode;
  message: string;
  statusCode: number;
}

export interface OutboxSendResult {
  ok: boolean;
  error?: OutboxSendError;
  data?: {
    emailId: string;
    messageId: string;
    sentAt: string;
    auditId: string;
  };
}

export function buildOutboxSendError(code: OutboxSendErrorCode, message: string): OutboxSendError {
  const statusCodeMap: Record<OutboxSendErrorCode, number> = {
    EMAIL_NOT_FOUND: 404,
    EMAIL_NOT_OUTBOUND: 400,
    EMAIL_NOT_OUTBOX: 400,
    EMAIL_ALREADY_SENT: 409,
    MISSING_RECIPIENT: 400,
    MISSING_CREDENTIALS: 400,
    SMTP_SEND_FAILED: 502,
    SMTP_MESSAGE_ID_MISSING: 502,
    DB_UPDATE_FAILED: 500,
    UNKNOWN_ERROR: 500,
  };
  return { code, message, statusCode: statusCodeMap[code] };
}

export interface OutboxSendParams {
  prisma: PrismaClient;
  emailId: string;
  credentials: {
    user: string;
    pass: string;
    host?: string;
    port?: number;
  };
  actorId?: string;
  createTransporter?: typeof nodemailer.createTransport;
}

export async function sendOutboxEmail(params: OutboxSendParams): Promise<OutboxSendResult> {
  const { prisma, emailId, credentials, actorId, createTransporter } = params;
  const transporterFactory = createTransporter || nodemailer.createTransport;

  // 1. 读 DB 事实行（fail closed）
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    select: { id: true, direction: true, mailbox: true, fromAddress: true, fromName: true, toAddresses: true, ccAddresses: true, subject: true, bodyText: true, bodyHtml: true, messageId: true, sentAt: true },
  }).catch(() => null);

  if (!email) return { ok: false, error: buildOutboxSendError('EMAIL_NOT_FOUND', `Email ${emailId} not found`) };
  if (email.direction !== 'outbound') return { ok: false, error: buildOutboxSendError('EMAIL_NOT_OUTBOUND', `Email ${emailId} direction="${email.direction}" is not outbound`) };
  if (email.mailbox !== 'Outbox') return { ok: false, error: buildOutboxSendError('EMAIL_NOT_OUTBOX', `Email ${emailId} mailbox="${email.mailbox}" is not Outbox`) };
  if (email.messageId || email.sentAt) return { ok: false, error: buildOutboxSendError('EMAIL_ALREADY_SENT', `Email ${emailId} already sent`) };

  let toArray: string[] = [];
  try { toArray = JSON.parse(email.toAddresses || '[]'); } catch { toArray = []; }
  if (!Array.isArray(toArray) || toArray.length === 0) return { ok: false, error: buildOutboxSendError('MISSING_RECIPIENT', `Email ${emailId} has no valid recipients`) };

  if (!credentials?.user || !credentials?.pass) return { ok: false, error: buildOutboxSendError('MISSING_CREDENTIALS', 'SMTP credentials (user/pass) required') };

  // 2. SMTP 发送（fail closed：失败保持 Outbox）
  let smtpMessageId: string;
  try {
    const transporter = transporterFactory({
      host: credentials.host || 'smtp.qiye.aliyun.com',
      port: credentials.port || 465,
      secure: true,
      auth: { user: credentials.user, pass: credentials.pass },
    } as any);

    let ccArray: string[] = [];
    try { ccArray = JSON.parse(email.ccAddresses || '[]'); } catch { ccArray = []; }

    const mailOptions: any = {
      from: email.fromName ? `"${email.fromName}" <${email.fromAddress}>` : email.fromAddress,
      to: toArray.join(','),
      cc: ccArray.length ? ccArray.join(',') : undefined,
      subject: email.subject,
    };
    if (email.bodyHtml) { mailOptions.html = email.bodyHtml; mailOptions.text = email.bodyText || undefined; }
    else if (email.bodyText) { mailOptions.text = email.bodyText; }

    const info = await transporter.sendMail(mailOptions);
    // fail closed：SMTP resolved 但 messageId 为空 → 不伪成功，不进 DB transaction
    if (!info?.messageId) {
      return { ok: false, error: buildOutboxSendError('SMTP_MESSAGE_ID_MISSING', `SMTP send resolved but messageId is empty`) };
    }
    smtpMessageId = info.messageId;
  } catch (e: any) {
    return { ok: false, error: buildOutboxSendError('SMTP_SEND_FAILED', `SMTP send failed: ${String(e?.message ?? e)}`) };
  }

  // 3. SMTP 成功后更新 DB（Sent + sentAt + messageId）+ audit（事务内）
  const sentAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let auditId = '';
  try {
    auditId = await prisma.$transaction(async (tx: any) => {
      await tx.email.update({
        where: { id: emailId },
        data: { mailbox: 'Sent', messageId: smtpMessageId, sentAt, updatedAt: BigInt(Date.now()) },
      });
      return await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:email:outbox_send',
        operation: 'outbox_email_sent', targetType: 'Email', targetId: emailId,
        before: { mailbox: 'Outbox', messageId: null, sentAt: null },
        after: { mailbox: 'Sent', messageId: smtpMessageId, sentAt, smtpResult: 'success' },
      });
    });
  } catch (e: any) {
    return { ok: false, error: buildOutboxSendError('DB_UPDATE_FAILED', `SMTP sent (messageId=${smtpMessageId}) but DB update/audit failed: ${String(e?.message ?? e)}`) };
  }

  return { ok: true, data: { emailId, messageId: smtpMessageId, sentAt, auditId } };
}
