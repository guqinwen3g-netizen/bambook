/**
 * Email Outbox send service.
 * 消费后端 POST /api/v1/email/outbox/:id/send contract（task_mqyqerqb）。
 * 不使用旧 /api/email/send 任意邮件体路径。
 */
import { apiService } from './apiService';
import type { OutboxSendResult } from '../types';

export interface OutboxSendCredentials {
  user: string;
  pass: string;
  host?: string;
  port?: number;
}

export const emailOutboxService = {
  /**
   * 发送 Outbox Email（只对 direction=outbound, mailbox=Outbox 的邮件）。
   * 成功返回 { ok:true, data:{emailId,messageId,sentAt,auditId} }。
   * 失败返回 { ok:false, error:{code,message,statusCode} }——保持 Outbox UI 状态。
   */
  async sendOutboxEmail(emailId: string, credentials: OutboxSendCredentials, endpoint?: string): Promise<OutboxSendResult> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/email/outbox/${encodeURIComponent(emailId)}/send`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        email: credentials.user,
        password: credentials.pass,
        host: credentials.host,
        port: credentials.port,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: { code: 'UNKNOWN_ERROR', message: `HTTP ${res.status}`, statusCode: res.status } }));
    return data as OutboxSendResult;
  },

  /** 判断邮件是否为可发送的 Outbox 邮件（direction=outbound && mailbox=Outbox && 未发送） */
  isSendableOutbox(email: { direction?: string; mailbox?: string; sentAt?: string | null; messageId?: string | null }): boolean {
    return email.direction === 'outbound'
      && email.mailbox === 'Outbox'
      && !email.sentAt
      && !email.messageId;
  },

  /** 创建 Outbox Email（create route，不含 password） */
  async createOutboxEmail(input: { fromAddress: string; to: string[]; subject: string; bodyText: string; fromName?: string; threadId?: string }, endpoint?: string): Promise<{ ok: true; emailId: string; mailbox: string; direction: string; auditId: string }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/email/outbox', base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
        threadId: input.threadId,
      }),
    });
    let json: any;
    try { json = await res.json(); } catch { throw new Error(`create outbox failed: HTTP ${res.status} (non-JSON response)`) as Error & { code: string }; }
    if (!res.ok || !json?.ok) {
      const err = new Error(json?.error?.message || json?.message || `create outbox failed: HTTP ${res.status}`) as Error & { code: string };
      err.code = json?.error?.code || `HTTP_${res.status}`;
      throw err;
    }
    return { ok: true, emailId: json.emailId, mailbox: json.mailbox, direction: json.direction, auditId: json.auditId };
  },

  /** 创建 Reply Outbox Email（reply route，含 originalEmailId，不含 password） */
  async createReplyOutboxEmail(input: { originalEmailId: string; fromAddress: string; to: string[]; subject: string; bodyText: string; fromName?: string; threadId?: string }, endpoint?: string): Promise<{ ok: true; emailId: string; mailbox: string; direction: string; auditId: string }> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/email/replies', base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        originalEmailId: input.originalEmailId,
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
        threadId: input.threadId,
      }),
    });
    let json: any;
    try { json = await res.json(); } catch { throw new Error(`create reply outbox failed: HTTP ${res.status} (non-JSON response)`) as Error & { code: string }; }
    if (!res.ok || !json?.ok) {
      const err = new Error(json?.error?.message || json?.message || `create reply outbox failed: HTTP ${res.status}`) as Error & { code: string };
      err.code = json?.error?.code || `HTTP_${res.status}`;
      throw err;
    }
    return { ok: true, emailId: json.emailId, mailbox: json.mailbox, direction: json.direction, auditId: json.auditId };
  },
};
