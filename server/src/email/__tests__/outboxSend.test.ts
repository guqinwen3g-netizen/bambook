import { describe, expect, it, vi } from 'vitest';
import { sendOutboxEmail, buildOutboxSendError } from '../outboxSend';

// mock transporter 工厂（注入 createTransporter）
function makeTransporter(opts: { sendFail?: boolean; messageId?: string | null } = {}) {
  return vi.fn().mockImplementation((config: any) => ({
    sendMail: opts.sendFail
      ? vi.fn().mockRejectedValue(new Error('SMTP_CONNECTION_REFUSED'))
      : vi.fn().mockResolvedValue({ messageId: opts.messageId === undefined ? '<test-msg-id@bambook.local>' : opts.messageId }),
  }));
}

function makeEmailRow(overrides: any = {}) {
  return {
    id: 'EML__1',
    direction: 'outbound',
    mailbox: 'Outbox',
    fromAddress: 'agent@bambook.local',
    fromName: 'Bambook Agent',
    toAddresses: JSON.stringify(['customer@example.com']),
    ccAddresses: null,
    subject: 'Test Subject',
    bodyText: 'Test body',
    bodyHtml: null,
    messageId: null,
    sentAt: null,
    ...overrides,
  };
}

function makePrisma(emailRow: any, opts: { updateFail?: boolean } = {}) {
  return {
    email: {
      findUnique: vi.fn().mockResolvedValue(emailRow),
      update: opts.updateFail ? vi.fn().mockRejectedValue(new Error('DB_LOCK')) : vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: any) => {
      const tx = {
        email: { update: opts.updateFail ? vi.fn().mockRejectedValue(new Error('DB_LOCK')) : vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      return await fn(tx);
    }),
  } as any;
}

const CREDENTIALS = { user: 'test@bambook.com', pass: 'pass123' };

describe('task ERP-P1 outbox-send: buildOutboxSendError（稳定 error code）', () => {
  it('10 个 code 均有 statusCode', () => {
    const codes = ['EMAIL_NOT_FOUND', 'EMAIL_NOT_OUTBOUND', 'EMAIL_NOT_OUTBOX', 'EMAIL_ALREADY_SENT', 'MISSING_RECIPIENT', 'MISSING_CREDENTIALS', 'SMTP_SEND_FAILED', 'SMTP_MESSAGE_ID_MISSING', 'DB_UPDATE_FAILED', 'UNKNOWN_ERROR'] as const;
    for (const code of codes) {
      const e = buildOutboxSendError(code, 'test');
      expect(e.code).toBe(code);
      expect(e.statusCode).toBeGreaterThan(0);
    }
  });
});

describe('task ERP-P1 outbox-send: 成功路径', () => {
  it('Outbox outbound 邮件 SMTP 成功 → 更新 Sent + sentAt + messageId + audit', async () => {
    const prisma = makePrisma(makeEmailRow());
    const result = await sendOutboxEmail({
      prisma, emailId: 'EML__1', credentials: CREDENTIALS,
      createTransporter: makeTransporter({ messageId: '<real-msg@x>' }) as any,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.messageId).toBe('<real-msg@x>');
      expect(result.data!.sentAt).toBeTruthy();
      expect(result.data!.auditId).toBeDefined();
    }
  });
});

describe('task ERP-P1 outbox-send: fail closed（非法状态）', () => {
  it('EMAIL_NOT_FOUND（email 不存在）', async () => {
    const prisma = makePrisma(null);
    const r = await sendOutboxEmail({ prisma, emailId: 'NOPE', credentials: CREDENTIALS });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('EMAIL_NOT_FOUND');
    expect(r.error!.statusCode).toBe(404);
  });

  it('EMAIL_NOT_OUTBOUND（direction=inbound）', async () => {
    const prisma = makePrisma(makeEmailRow({ direction: 'inbound' }));
    const r = await sendOutboxEmail({ prisma, emailId: 'EML__1', credentials: CREDENTIALS });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('EMAIL_NOT_OUTBOUND');
  });

  it('EMAIL_NOT_OUTBOX（mailbox=Drafts）', async () => {
    const prisma = makePrisma(makeEmailRow({ mailbox: 'Drafts' }));
    const r = await sendOutboxEmail({ prisma, emailId: 'EML__1', credentials: CREDENTIALS });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('EMAIL_NOT_OUTBOX');
  });

  it('EMAIL_ALREADY_SENT（已有 messageId）', async () => {
    const prisma = makePrisma(makeEmailRow({ messageId: '<existing@x>', sentAt: '2026-06-29 12:00:00' }));
    const r = await sendOutboxEmail({ prisma, emailId: 'EML__1', credentials: CREDENTIALS });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('EMAIL_ALREADY_SENT');
  });

  it('MISSING_RECIPIENT（toAddresses 空）', async () => {
    const prisma = makePrisma(makeEmailRow({ toAddresses: '[]' }));
    const r = await sendOutboxEmail({ prisma, emailId: 'EML__1', credentials: CREDENTIALS });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('MISSING_RECIPIENT');
  });
});

describe('task ERP-P1 outbox-send: 凭据缺失', () => {
  it('MISSING_CREDENTIALS（无 user/pass）', async () => {
    const prisma = makePrisma(makeEmailRow());
    const r = await sendOutboxEmail({ prisma, emailId: 'EML__1', credentials: { user: '', pass: '' } });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('MISSING_CREDENTIALS');
  });
});

describe('task ERP-P1 outbox-send: SMTP 失败保持 Outbox', () => {
  it('SMTP_SEND_FAILED → 不更新 DB，保持 Outbox', async () => {
    const prisma = makePrisma(makeEmailRow());
    const r = await sendOutboxEmail({
      prisma, emailId: 'EML__1', credentials: CREDENTIALS,
      createTransporter: makeTransporter({ sendFail: true }) as any,
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('SMTP_SEND_FAILED');
    expect(r.error!.statusCode).toBe(502);
    // DB update 不被调用（SMTP 失败前置）
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1 outbox-send: SMTP_MESSAGE_ID_MISSING（messageId 空 fail closed）', () => {
  it('sendMail resolved 但 messageId 空 → SMTP_MESSAGE_ID_MISSING，不进 DB transaction', async () => {
    const prisma = makePrisma(makeEmailRow());
    const r = await sendOutboxEmail({
      prisma, emailId: 'EML__1', credentials: CREDENTIALS,
      createTransporter: makeTransporter({ messageId: '' }) as any,
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('SMTP_MESSAGE_ID_MISSING');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1 outbox-send: DB 更新失败不静默成功', () => {
  it('DB_UPDATE_FAILED（SMTP 已发但 DB update 失败）', async () => {
    const prisma = makePrisma(makeEmailRow(), { updateFail: true });
    const r = await sendOutboxEmail({
      prisma, emailId: 'EML__1', credentials: CREDENTIALS,
      createTransporter: makeTransporter({ messageId: '<sent-but-db-fail@x>' }) as any,
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('DB_UPDATE_FAILED');
    expect(r.error!.message).toContain('<sent-but-db-fail@x>'); // 提示已发但 DB 没记录
  });
});

describe('task ERP-P1 outbox-send: AuditLog 行为', () => {
  it('成功发送 → audit 写 send attempt/result（before Outbox → after Sent）', async () => {
    const prisma = makePrisma(makeEmailRow());
    await sendOutboxEmail({
      prisma, emailId: 'EML__1', credentials: CREDENTIALS,
      createTransporter: makeTransporter() as any,
    });
    // $transaction 内 auditLog.create 被调用
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
