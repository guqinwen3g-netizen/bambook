import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-email-reply-send-runtime-qa: fixture-driven runtime QA
 * 基于 main=9f2b8db 真实源码静态断言 email.reply_and_send contract。
 * 不改后端 contract；不猜字段；不做 SMTP UI。
 */

const fs = require('fs');
const path = require('path');
const EMAIL_FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/emailReplySendFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');

// ═══ Part 1: ProcessDraft 六字段 + 三态 Feedback contract ═══
describe('runtime QA [ProcessDraft]: buildEmailReplySendDraft 严格六字段', () => {
  it('idempotencyKey 格式: email.reply_and_send:${replyToEmailId||new}:${hash}', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/idempotencyKey = `email\.reply_and_send:\$\{replyToEmailId \|\| 'new'\}:\$\{hash\}`/);
  });
  it('impactScope 固定 [emails]', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/impactScope: \['emails'\]/);
  });
  it('irreversible = true（邮件发出不可逆）', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 email.reply_and_send toolId', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/toolId: 'email\.reply_and_send'/);
  });
  it('action = create_outbound_email', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/action: 'create_outbound_email'/);
  });
  it('return 展开 content + idempotencyKey（严格六字段 ProcessDraft）', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/return \{ \.\.\.content, idempotencyKey \}/);
  });
  it('entityId 用 replyToEmailId || new-outbound', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/entityId: replyToEmailId \|\| 'new-outbound'/);
  });
});

describe('runtime QA [Feedback]: EmailReplySendFeedback 三态真实 contract', () => {
  it('Feedback union 含 approval_required/committed/failed 三态', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(EMAIL_FLOW_SRC).toMatch(/status: 'committed'/);
    expect(EMAIL_FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('EmailReplySendCommitted 含 emailId/direction/threadId/transactionId/auditId/idempotencyKey', () => {
    const m = EMAIL_FLOW_SRC.match(/export interface EmailReplySendCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['emailId', 'direction', 'threadId', 'transactionId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

describe('runtime QA [ErrorCode]: EmailReplySendErrorCode 10 值真实 contract', () => {
  const CODES = [
    'APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED',
    'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED',
    'ORIGINAL_EMAIL_NOT_FOUND', 'MISSING_RECIPIENT', 'COMMIT_TRANSACTION_FAILED', 'UNKNOWN_ERROR',
  ];
  for (const code of CODES) {
    it(`error code "${code}" 在 emailReplySendFlow.ts 真实 union 内`, () => {
      expect(EMAIL_FLOW_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 2: Outbox 而非 Sent + sentAt/messageId null ═══
describe('runtime QA [Outbox]: commit 写 Outbox 而非 Sent', () => {
  it('commitEmailReplySend 函数体内 mailbox = Outbox（精确匹配函数体）', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export async function commitEmailReplySend[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/mailbox: 'Outbox'/);
    // 不应写 Sent
    expect(fnMatch![0]).not.toMatch(/mailbox: 'Sent'/);
  });
  it('committed email 不含 sentAt/messageId（未通过 SMTP，不应有发送时间戳/RFC Message-ID）', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export async function commitEmailReplySend[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    // tx.email.create data 内明确 sentAt: null, messageId: null
    expect(fnMatch![0]).toMatch(/messageId: null/);
    expect(fnMatch![0]).toMatch(/sentAt: null/);
  });
  it('direction = outbound（出站邮件）', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export async function commitEmailReplySend[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/direction: 'outbound'/);
  });
});

// ═══ Part 3: reply 不继承 original.fromAddress ═══
describe('runtime QA [reply 边界]: reply 不继承 original.fromAddress（防冒充对方发件）', () => {
  it('fromAddress 用固定 agent@bambook.local（非 original.fromAddress）', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export async function commitEmailReplySend[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/fromAddress = 'agent@bambook\.local'/);
  });
  it('reply 场景只读 original.threadId/messageId（不 select fromAddress）', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export async function commitEmailReplySend[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    // select 字段只含 id/threadId/messageId/deletedAt，不含 fromAddress
    const selectMatch = fnMatch![0].match(/select: \{[^}]+\}/);
    expect(selectMatch).not.toBeNull();
    expect(selectMatch![0]).toContain('threadId');
    expect(selectMatch![0]).toContain('messageId');
    expect(selectMatch![0]).not.toMatch(/fromAddress/);
  });
  it('源码含防冒充注释（不用 original.fromAddress）', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/不用 original\.fromAddress|那是对方\/客户的地址/);
  });
});

// ═══ Part 4: no SMTP invariant（精确检查，排除注释干扰） ═══
describe('runtime QA [no SMTP invariant]: 不 import/call nodemailer/sendMail/SMTP', () => {
  it('emailReplySendFlow.ts 无 import nodemailer', () => {
    expect(EMAIL_FLOW_SRC).not.toMatch(/import.*nodemailer/);
  });
  it('emailReplySendFlow.ts 无 sendMail( 调用（排除注释）', () => {
    // 精确匹配：sendMail 后跟 ( 是调用，注释里的 sendMail 不跟 (
    expect(EMAIL_FLOW_SRC).not.toMatch(/[^/]\s*sendMail\(/);
  });
  it('emailReplySendFlow.ts 无 new SMTP./createTransport（SMTP 客户端实例化）', () => {
    expect(EMAIL_FLOW_SRC).not.toMatch(/new SMTP\.|createTransport/);
  });
  it('commitEmailReplySend 函数体内无 SMTP 调用（contract 边界：只写 Email 记录）', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export async function commitEmailReplySend[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/nodemailer|createTransport/);
  });
});

// ═══ Part 5: toolRuntime email.reply_and_send 分支真实链路 ═══
describe('runtime QA [toolRuntime]: email.reply_and_send 分支真实链路', () => {
  it('toolRuntime 含 email.reply_and_send tool 定义（definition.id === email.reply_and_send）', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'email\.reply_and_send'/);
    expect(TOOL_RUNTIME_SRC).toMatch(/call\.toolId === 'email\.reply_and_send'/);
  });
  it('email.reply_and_send 分支调用 commitEmailReplySend（精确匹配分支体）', () => {
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'email\.reply_and_send'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
    expect(branchMatch![0]).toMatch(/commitEmailReplySend/);
  });
  it('缺 approvalId → APPROVAL_ID_MISSING fail closed', () => {
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'email\.reply_and_send'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
    expect(branchMatch![0]).toMatch(/APPROVAL_ID_MISSING/);
  });
});

// ═══ Part 6: draft-first 防篡改 + 语义校验 ═══
describe('runtime QA [draft-first]: 防篡改 + 语义校验', () => {
  it('verifyEmailReplySendDraftHash 解析 :pd: 前缀', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH', () => {
    expect(EMAIL_FLOW_SRC).toContain("'PROCESS_DRAFT_HASH_MISMATCH'");
  });
  it('validateEmailReplySendDraftSemantics: to 为空 → MISSING_RECIPIENT', () => {
    const fnMatch = EMAIL_FLOW_SRC.match(/export function validateEmailReplySendDraftSemantics[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/MISSING_RECIPIENT/);
  });
  it('recoverEmailPayloadFromDraft 从 subOperations.after 恢复', () => {
    expect(EMAIL_FLOW_SRC).toMatch(/recoverEmailPayloadFromDraft/);
  });
});

// ═══ Part 7: 前端 EmailManager 边界（不伪装已发送） ═══
describe('runtime QA [前端边界]: EmailManager 不伪装已发送', () => {
  const emailMgrPath = path.resolve(__dirname, 'EmailManager.tsx');
  const exists = fs.existsSync(emailMgrPath);
  it('EmailManager.tsx 存在', () => {
    expect(exists).toBe(true);
  });
  if (exists) {
    const src = fs.readFileSync(emailMgrPath, 'utf-8');
    it('EmailManager 不调用 email Agent flow（独立范围）', () => {
      expect(src).not.toMatch(/emailReplySendFlow|commitEmailReplySend|email\.reply_and_send/);
    });
    it('EmailManager 不伪造 sentAt/messageId（不本地写入发送态）', () => {
      // 不应本地写入 sentAt/messageId（这些只能由后端 SMTP commit 写）
      expect(src).not.toMatch(/sentAt\s*[:=]\s*[^n]/);
      expect(src).not.toMatch(/messageId\s*[:=]\s*[^n]/);
    });
  }
});
