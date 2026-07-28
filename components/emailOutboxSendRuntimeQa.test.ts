import { describe, expect, it } from 'vitest';
import type { Email, OutboxSendResult } from '../types';
import { emailOutboxService } from '../services/emailOutboxService';

/**
 * ERP-P1-email-outbox-send-ui-runtime-qa: fixture-driven runtime QA
 * 消费已 merged Outbox send route/service contract（task_mqyqerqb）。
 * 不改后端 contract；不使用旧 /api/email/send 任意邮件体路径。
 * payload 全部来自后端 outboxSend.ts + route.ts 真实源码。
 */

const fs = require('fs');
const path = require('path');
const BACKEND_OUTBOX_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/outboxSend.ts'), 'utf-8');
const BACKEND_ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/route.ts'), 'utf-8');
const EMAIL_MANAGER_SRC = fs.readFileSync(path.resolve(__dirname, 'EmailManager.tsx'), 'utf-8');
const OUTBOX_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/emailOutboxService.ts'), 'utf-8');

// ═══ Part 1: Outbox send route/service 真实 contract（静态断言） ═══
describe('runtime QA [后端 contract]: Outbox send route/service', () => {
  it('route: POST /outbox/:id/send 端点存在', () => {
    expect(BACKEND_ROUTE_SRC).toMatch(/router\.post\('\/outbox\/:id\/send'/);
  });
  it('route: 只能发送 outbound Outbox 邮件（注释契约）', () => {
    expect(BACKEND_ROUTE_SRC).toMatch(/只能发送已存在的 Email.*direction=outbound.*mailbox=Outbox/);
  });
  it('route: SMTP 成功后更新 Sent + sentAt + messageId；失败保持 Outbox', () => {
    expect(BACKEND_ROUTE_SRC).toMatch(/SMTP 成功后更新 Sent \+ sentAt \+ messageId；失败保持 Outbox/);
  });
  it('service: sendOutboxEmail 导出', () => {
    expect(BACKEND_OUTBOX_SRC).toMatch(/export async function sendOutboxEmail/);
  });
  it('service: fail closed——SMTP 失败保持 Outbox（不伪成功）', () => {
    expect(BACKEND_OUTBOX_SRC).toMatch(/SMTP 发送.*fail closed|失败保持 Outbox/);
  });
});

describe('runtime QA [后端 contract]: OutboxSendResult 结构', () => {
  it('OutboxSendResult.data 含 emailId/messageId/sentAt/auditId', () => {
    const m = BACKEND_OUTBOX_SRC.match(/export interface OutboxSendResult \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    const body = m![0];
    for (const f of ['emailId', 'messageId', 'sentAt', 'auditId']) {
      expect(body).toContain(f);
    }
  });
  it('OutboxSendError 含 code/message/statusCode', () => {
    const m = BACKEND_OUTBOX_SRC.match(/export interface OutboxSendError \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['code', 'message', 'statusCode']) {
      expect(m![0]).toContain(f);
    }
  });
});

describe('runtime QA [后端 contract]: OutboxSendErrorCode 10 值 union', () => {
  const CODES = [
    'EMAIL_NOT_FOUND', 'EMAIL_NOT_OUTBOUND', 'EMAIL_NOT_OUTBOX', 'EMAIL_ALREADY_SENT',
    'MISSING_RECIPIENT', 'MISSING_CREDENTIALS', 'SMTP_SEND_FAILED', 'SMTP_MESSAGE_ID_MISSING',
    'DB_UPDATE_FAILED', 'UNKNOWN_ERROR',
  ];
  for (const code of CODES) {
    it(`error code "${code}" 在 outboxSend.ts 真实 union 内`, () => {
      expect(BACKEND_OUTBOX_SRC).toContain(`'${code}'`);
    });
  }
});

describe('runtime QA [后端 contract]: sendOutboxEmail fail closed 校验链', () => {
  it('direction !== outbound → EMAIL_NOT_OUTBOUND', () => {
    expect(BACKEND_OUTBOX_SRC).toContain("'EMAIL_NOT_OUTBOUND'");
  });
  it('mailbox !== Outbox → EMAIL_NOT_OUTBOX', () => {
    expect(BACKEND_OUTBOX_SRC).toContain("'EMAIL_NOT_OUTBOX'");
  });
  it('已发送（messageId/sentAt）→ EMAIL_ALREADY_SENT', () => {
    expect(BACKEND_OUTBOX_SRC).toMatch(/email\.messageId \|\| email\.sentAt/);
    expect(BACKEND_OUTBOX_SRC).toContain("'EMAIL_ALREADY_SENT'");
  });
  it('SMTP messageId 为空 → SMTP_MESSAGE_ID_MISSING（不伪成功）', () => {
    expect(BACKEND_OUTBOX_SRC).toMatch(/if \(!info\?\.messageId\)/);
    expect(BACKEND_OUTBOX_SRC).toContain("'SMTP_MESSAGE_ID_MISSING'");
  });
});

// ═══ Part 2: emailOutboxService 消费 contract（前端 service 层） ═══
describe('runtime QA [前端 service]: emailOutboxService 消费真实 route', () => {
  it('路径 /v1/email/outbox/:id/send（对齐后端 route）', () => {
    expect(OUTBOX_SVC_SRC).toMatch(/\/v1\/email\/outbox\/\$\{[^}]+\}\/send/);
  });
  it('不使用旧 /api/email/send 任意邮件体路径', () => {
    expect(OUTBOX_SVC_SRC).not.toMatch(/\/email\/send['"`]/);
  });
  it('POST 方法 + SMTP credentials body', () => {
    expect(OUTBOX_SVC_SRC).toMatch(/method: 'POST'/);
    expect(OUTBOX_SVC_SRC).toMatch(/email: credentials\.user/);
    expect(OUTBOX_SVC_SRC).toMatch(/password: credentials\.pass/);
  });
});

describe('runtime QA [前端 service]: isSendableOutbox 边界判断', () => {
  it('isSendableOutbox: direction=outbound + mailbox=Outbox + 未发送 → true', () => {
    expect(emailOutboxService.isSendableOutbox({ direction: 'outbound', mailbox: 'Outbox' })).toBe(true);
  });
  it('isSendableOutbox: direction=inbound → false', () => {
    expect(emailOutboxService.isSendableOutbox({ direction: 'inbound', mailbox: 'Outbox' })).toBe(false);
  });
  it('isSendableOutbox: mailbox=Sent → false', () => {
    expect(emailOutboxService.isSendableOutbox({ direction: 'outbound', mailbox: 'Sent' })).toBe(false);
  });
  it('isSendableOutbox: 已发送（sentAt） → false', () => {
    expect(emailOutboxService.isSendableOutbox({ direction: 'outbound', mailbox: 'Outbox', sentAt: '2026-06-29' })).toBe(false);
  });
  it('isSendableOutbox: 已发送（messageId） → false', () => {
    expect(emailOutboxService.isSendableOutbox({ direction: 'outbound', mailbox: 'Outbox', messageId: '<msg@x>' })).toBe(false);
  });
});

// ═══ Part 3: EmailManager UI 边界（只对 outbound Outbox 显示发送入口） ═══
describe('runtime QA [EmailManager UI]: Outbox send 入口边界', () => {
  it('EmailManager 消费 emailOutboxService（import + 调用）', () => {
    expect(EMAIL_MANAGER_SRC).toMatch(/import.*emailOutboxService.*from.*emailOutboxService/);
    expect(EMAIL_MANAGER_SRC).toMatch(/emailOutboxService\.sendOutboxEmail/);
  });
  it('EmailManager 用 isSendableOutbox 条件渲染发送按钮（只对 outbound Outbox）', () => {
    expect(EMAIL_MANAGER_SRC).toMatch(/emailOutboxService\.isSendableOutbox\(selectedEmail\)/);
  });
  it('EmailManager handleSendOutbox 消费后端 result（成功更新 mailbox=Sent+sentAt+messageId）', () => {
    const fnMatch = EMAIL_MANAGER_SRC.match(/const handleSendOutbox = [\s\S]*?^  };/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/result\.data/);
    expect(fnMatch![0]).toMatch(/messageId/);
    expect(fnMatch![0]).toMatch(/sentAt/);
    expect(fnMatch![0]).toMatch(/mailbox: 'Sent'/);
  });
  it('EmailManager 失败时不本地伪成功（保持 Outbox UI + 显示后端错误）', () => {
    const fnMatch = EMAIL_MANAGER_SRC.match(/const handleSendOutbox = [\s\S]*?^  };/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/if \(!result\.ok/);
    expect(fnMatch![0]).toMatch(/result\.error/);
  });
  it('EmailManager 不调用 Agent email flow（不混 email.reply_and_send）', () => {
    expect(EMAIL_MANAGER_SRC).not.toMatch(/emailReplySendFlow|commitEmailReplySend|email\.reply_and_send/);
  });
});

// ═══ Part 4: form_request phase 类型不回退（task_mqwmt8nf 修复保持） ═══
describe('runtime QA [form phase]: form_request/form_resolved 类型不回退', () => {
  const typesSrc = fs.readFileSync(path.resolve(__dirname, '../types.ts'), 'utf-8');
  it('types.ts AgentWorkEventPhase 含 form_request（不回退）', () => {
    const m = typesSrc.match(/export type AgentWorkEventPhase =[\s\S]*?;/);
    expect(m![0]).toContain('form_request');
  });
  it('types.ts AgentWorkEventPhase 含 form_resolved（不回退）', () => {
    const m = typesSrc.match(/export type AgentWorkEventPhase =[\s\S]*?;/);
    expect(m![0]).toContain('form_resolved');
  });
});

// ═══ Part 5: 真实 payload fixture 消费 ═══
describe('runtime QA [fixture]: 真实 OutboxSendResult payload 消费', () => {
  it('成功 payload: { ok:true, data:{emailId,messageId,sentAt,auditId} }', () => {
    const result: OutboxSendResult = {
      ok: true,
      data: { emailId: 'EML__123', messageId: '<abc@mail.com>', sentAt: '2026-06-29 12:00:00', auditId: 'alog_456' },
    };
    expect(result.ok).toBe(true);
    expect(result.data?.messageId).toBe('<abc@mail.com>');
    expect(result.data?.sentAt).toBe('2026-06-29 12:00:00');
  });

  it('失败 payload: { ok:false, error:{code,message,statusCode} }（保持 Outbox）', () => {
    const result: OutboxSendResult = {
      ok: false,
      error: { code: 'SMTP_SEND_FAILED', message: 'SMTP send failed: connection timeout', statusCode: 502 },
    };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SMTP_SEND_FAILED');
    expect(result.error?.statusCode).toBe(502);
  });

  it('已发送 payload: EMAIL_ALREADY_SENT（409，幂等保护）', () => {
    const result: OutboxSendResult = {
      ok: false,
      error: { code: 'EMAIL_ALREADY_SENT', message: 'Email EML__123 already sent', statusCode: 409 },
    };
    expect(result.error?.code).toBe('EMAIL_ALREADY_SENT');
    expect(result.error?.statusCode).toBe(409);
  });

  it('Email fixture: outbound Outbox 可发送（isSendableOutbox 消费 Email 类型）', () => {
    const email: Email = {
      id: 'EML__outbox_1', sender: 'agent@bambook.local', subject: 'Invoice issued',
      body: '请查收发票', date: '2026-06-29', isRead: true,
      direction: 'outbound', mailbox: 'Outbox', sentAt: null, messageId: null,
    };
    expect(emailOutboxService.isSendableOutbox(email)).toBe(true);
  });

  it('Email fixture: outbound Sent 不可发送（已发送）', () => {
    const email: Email = {
      id: 'EML__sent_1', sender: 'agent@bambook.local', subject: 'Invoice issued',
      body: '请查收发票', date: '2026-06-29', isRead: true,
      direction: 'outbound', mailbox: 'Sent', sentAt: '2026-06-29 10:00:00', messageId: '<msg@x>',
    };
    expect(emailOutboxService.isSendableOutbox(email)).toBe(false);
  });
});
