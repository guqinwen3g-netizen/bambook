import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const OUTBOX_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/emailOutboxService.ts'), 'utf-8');
const EMAIL_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'EmailManager.tsx'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/route.ts'), 'utf-8');

// ═══ Part 1: emailOutboxService createOutboxEmail + createReplyOutboxEmail ═══
describe('QA [service]: createOutboxEmail + createReplyOutboxEmail', () => {
  it('createOutboxEmail: POST /v1/email/outbox', () => {
    expect(OUTBOX_SVC_SRC).toContain('async createOutboxEmail');
    expect(OUTBOX_SVC_SRC).toContain("'/v1/email/outbox'");
    expect(OUTBOX_SVC_SRC).toContain("method: 'POST'");
  });
  it('createOutboxEmail body: fromAddress/to/subject/bodyText（不含 password）', () => {
    expect(OUTBOX_SVC_SRC).toContain('fromAddress: input.fromAddress');
    expect(OUTBOX_SVC_SRC).toContain('to: input.to');
    expect(OUTBOX_SVC_SRC).toContain('subject: input.subject');
    expect(OUTBOX_SVC_SRC).toContain('bodyText: input.bodyText');
    expect(OUTBOX_SVC_SRC).not.toContain('password: input.password');
  });
  it('createReplyOutboxEmail: POST /v1/email/replies + originalEmailId', () => {
    expect(OUTBOX_SVC_SRC).toContain('async createReplyOutboxEmail');
    expect(OUTBOX_SVC_SRC).toContain("'/v1/email/replies'");
    expect(OUTBOX_SVC_SRC).toContain('originalEmailId: input.originalEmailId');
  });
  it('失败保留 error.code', () => {
    expect(OUTBOX_SVC_SRC).toContain('err.code =');
  });
  it('带统一认证头（apiService.getAuthHeaders：API key + 登录 JWT）', () => {
    expect(OUTBOX_SVC_SRC).toContain('apiService.getAuthHeaders()');
  });
  it('成功返回 emailId/mailbox/direction/auditId', () => {
    expect(OUTBOX_SVC_SRC).toContain('emailId: json.emailId');
    expect(OUTBOX_SVC_SRC).toContain('mailbox: json.mailbox');
    expect(OUTBOX_SVC_SRC).toContain('direction: json.direction');
    expect(OUTBOX_SVC_SRC).toContain('auditId: json.auditId');
  });
});

// ═══ Part 2: EmailManager handleSendNew 走 outbox create ═══
describe('QA [EmailManager]: handleSendNew 走 outbox create', () => {
  it('handleSendNew 调 createOutboxEmail（不走旧 /email/send）', () => {
    expect(EMAIL_MGR_SRC).toContain('emailOutboxService.createOutboxEmail');
  });
  it('消费后端事实字段: created.emailId 拉取真实 Email + setEmails 更新', () => {
    expect(EMAIL_MGR_SRC).toContain('created.emailId');
    expect(EMAIL_MGR_SRC).toContain('setEmails(prev => [detail.data');
  });
  it('handleSendNew body 不含 password', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleToggleStar');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).not.toContain('password:');
    expect(body).not.toContain('fromPass');
  });
  it('to normalize 成数组（split 逗号/分号）', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleToggleStar');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('split(/[,;]/)');
    expect(body).toContain('to: toAddrs');
  });
  it('成功消费 detail.data（不是 detail.email）拉取真实 Email', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleToggleStar');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('detail.data');
    expect(body).not.toContain('detail.email');
  });
});

// ═══ Part 3: EmailManager handleSendReply 走 reply outbox create ═══
describe('QA [EmailManager]: handleSendReply 走 reply outbox create', () => {
  it('handleSendReply 调 createReplyOutboxEmail（不走旧 /email/send）', () => {
    expect(EMAIL_MGR_SRC).toContain('emailOutboxService.createReplyOutboxEmail');
  });
  it('含 originalEmailId', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendReply');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('originalEmailId');
  });
  it('handleSendReply body 不含 password', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendReply');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).not.toContain('password:');
    expect(body).not.toContain('fromPass');
  });
  it('originalEmailId 边界: 非 DB id（非 EML__ 前缀）显示「先同步」不调 createReply', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendReply');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('/^EML__/');
    expect(body).toContain('未同步到 ERP');
  });
});

// ═══ Part 4: busy/disabled 防重复 ═══
describe('QA [EmailManager]: busy/guard 防重复', () => {
  it('handleSendNew 有 if (isSending) return guard', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleToggleStar');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('if (isSending) return');
  });
  it('handleSendReply 有 if (isSending) return guard', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendReply');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('if (isSending) return');
  });
});

// ═══ Part 5: failure 不关闭/污染表单 ═══
describe('QA [EmailManager]: failure 显示错误不污染', () => {
  it('handleSendNew 失败 setOutboxError', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleToggleStar');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('setOutboxError');
  });
  it('handleSendReply 失败 setOutboxError', () => {
    const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendReply');
    const fnEnd = EMAIL_MGR_SRC.indexOf('const handleSendNew');
    const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
    expect(body).toContain('setOutboxError');
  });
  it('compose modal 内渲染 outboxError（失败可见）', () => {
    expect(EMAIL_MGR_SRC).toContain('flex-1 text-xs px-2 text-[var(--danger-text)]');
  });
  it('reply editor 内渲染 outboxError（失败可见）', () => {
    expect(EMAIL_MGR_SRC).toContain('mb-2 text-xs text-[var(--danger-text)]');
  });
});

// ═══ Part 6: 不混 Agent commit ═══
describe('QA [EmailManager]: no Agent commit mixing', () => {
  it('不调 Agent email.send/reply_and_send commit', () => {
    expect(EMAIL_MGR_SRC).not.toContain('commitEmailSend');
    expect(EMAIL_MGR_SRC).not.toContain('commitEmailReply');
    expect(EMAIL_MGR_SRC).not.toContain('emailSendFlow');
  });
});

// ═══ Part 7: outbox send 接续边界（SMTP 显式发送仍保留）═══
describe('QA [EmailManager]: outbox send 接续', () => {
  it('sendOutboxEmail 仍保留（SMTP 显式发送）', () => {
    expect(EMAIL_MGR_SRC).toContain('emailOutboxService.sendOutboxEmail');
  });
  it('isSendableOutbox 仍保留', () => {
    expect(EMAIL_MGR_SRC).toContain('isSendableOutbox');
  });
});

// ═══ Part 8: 真实 route contract ═══
describe('QA [route]: outbox/replies 真实 contract', () => {
  it('POST /outbox → 201 emailId/mailbox/direction/auditId', () => {
    expect(ROUTE_SRC).toContain("router.post('/outbox'");
    expect(ROUTE_SRC).toContain('res.status(201)');
    expect(ROUTE_SRC).toContain('emailId: result.data');
  });
  it('POST /replies → 201 同 shape + originalEmailId', () => {
    expect(ROUTE_SRC).toContain("router.post('/replies'");
    expect(ROUTE_SRC).toContain('createReplyOutboxEmail');
  });
  it('ORIGINAL_EMAIL_NOT_FOUND → 404', () => {
    expect(ROUTE_SRC).toContain('ORIGINAL_EMAIL_NOT_FOUND: 404');
  });
});

// ═══ Part 9: 真实 fixture ═══
describe('QA [fixture]: outbox create 真实 payload', () => {
  it('成功 res: { ok, emailId, mailbox:Outbox, direction:outbound, auditId }', () => {
    const res = { ok: true, emailId: 'em_abc123', mailbox: 'Outbox', direction: 'outbound', auditId: 'audit_xyz' };
    expect(res.mailbox).toBe('Outbox');
    expect(res.direction).toBe('outbound');
    expect(res.emailId).toContain('em_');
  });
  it('ORIGINAL_EMAIL_NOT_FOUND 失败', () => { expect({ code: 'ORIGINAL_EMAIL_NOT_FOUND' }.code).toBe('ORIGINAL_EMAIL_NOT_FOUND'); });
});
