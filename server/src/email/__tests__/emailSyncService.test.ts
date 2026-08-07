import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncEmailsFromImap, buildEmailSyncError, maskAccount } from '../emailSyncService';

vi.mock('../sync', () => ({ syncEmailReferences: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../audit/routeAudit', () => ({ writeRouteAuditLog: vi.fn().mockResolvedValue('alog_test_1') }));
import { syncEmailReferences } from '../sync';
import { writeRouteAuditLog } from '../../audit/routeAudit';

function makeImapConnect(opts: { connectFail?: boolean; openBoxFail?: boolean; searchFail?: boolean; messages?: any[] } = {}) {
  const messages = opts.messages ?? [{
    attributes: { uid: 100, date: new Date(), flags: [] },
    parts: [{ which: '', body: {} }, {
      which: 'HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO CONTENT-TYPE)',
      body: { 'message-id': ['<test@test.com>'], from: ['Sender <sender@test.com>'], to: [['recipient@test.com']], subject: ['Test Subject'], date: ['2026-07-02T10:00:00Z'] },
    }],
  }];
  const connection = {
    openBox: opts.openBoxFail ? vi.fn().mockRejectedValue(new Error('openBox failed')) : vi.fn().mockResolvedValue({}),
    search: opts.searchFail ? vi.fn().mockRejectedValue(new Error('search failed')) : vi.fn().mockResolvedValue(messages),
    getBoxes: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue({}),
  };
  return vi.fn().mockResolvedValue(opts.connectFail ? Promise.reject(new Error('Connection refused')) : connection);
}

function makePrisma(opts: { existingEmails?: Record<string, any>; createFail?: boolean } = {}) {
  const emailCreate = opts.createFail ? vi.fn().mockRejectedValue(new Error('DB write failed')) : vi.fn().mockImplementation(async ({ data }: any) => ({ ...data }));
  const txEmail = { findFirst: vi.fn().mockImplementation(async ({ where }: any) => opts.existingEmails?.[where.messageId] || null), create: emailCreate };
  return {
    email: txEmail,
    $transaction: vi.fn(async (fn: any) => fn({ email: txEmail, auditLog: { create: vi.fn() }, entityReference: { upsert: vi.fn() }, entityLink: { upsert: vi.fn() } })),
  } as any;
}

describe('emailSyncService: success path', () => {
  beforeEach(() => vi.clearAllMocks());
  it('syncs emails and returns masked account', async () => {
    const prisma = makePrisma();
    const imapConnect = makeImapConnect();
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'testuser@bambook.com', pass: 'secret123' }, imapConnect });
    expect(result.ok).toBe(true);
    expect(result.data?.synced).toBe(1);
    expect(result.data?.skipped).toBe(0);
    expect(result.data?.accountMasked).toBe('te***@bambook.com');
  });

  it('dedup by messageId → skipped', async () => {
    const prisma = makePrisma({ existingEmails: { 'test@test.com': { id: 'EML__1' } } });
    const imapConnect = makeImapConnect();
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(true);
    expect(result.data?.skipped).toBe(1);
    expect(result.data?.synced).toBe(0);
  });

  it('empty results → synced 0', async () => {
    const prisma = makePrisma();
    const imapConnect = makeImapConnect({ messages: [] });
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(true);
    expect(result.data?.synced).toBe(0);
  });
});

describe('emailSyncService: fail-closed error codes', () => {
  beforeEach(() => vi.clearAllMocks());
  it('MISSING_CREDENTIALS — no user/pass', async () => {
    const result = await syncEmailsFromImap({ prisma: {} as any, credentials: { user: '', pass: '' } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('MISSING_CREDENTIALS');
  });

  it('IMAP_CONNECT_FAILED — connect rejects', async () => {
    const imapConnect = makeImapConnect({ connectFail: true });
    const result = await syncEmailsFromImap({ prisma: {} as any, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('IMAP_CONNECT_FAILED');
  });

  it('SYNC_FAILED — openBox rejects', async () => {
    const imapConnect = makeImapConnect({ openBoxFail: true });
    const result = await syncEmailsFromImap({ prisma: {} as any, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SYNC_FAILED');
  });

  it('SYNC_FAILED — search rejects', async () => {
    const imapConnect = makeImapConnect({ searchFail: true });
    const result = await syncEmailsFromImap({ prisma: {} as any, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SYNC_FAILED');
  });

  it('DB_WRITE_FAILED — all create rejects', async () => {
    const prisma = makePrisma({ createFail: true });
    const imapConnect = makeImapConnect();
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('DB_WRITE_FAILED');
  });

  it('credential not leaked in error message', async () => {
    const imapConnect = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED password=mysecret123 user=a@b.com'));
    const result = await syncEmailsFromImap({ prisma: {} as any, credentials: { user: 'a@b.com', pass: 'mysecret123' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.error)).not.toContain('mysecret123');
  });
});

describe('emailSyncService: syncEmailReferences + writeRouteAuditLog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('success path calls syncEmailReferences + writeRouteAuditLog', async () => {
    const prisma = makePrisma();
    const imapConnect = makeImapConnect();
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(true);
    expect(syncEmailReferences).toHaveBeenCalledTimes(1);
    expect(writeRouteAuditLog).toHaveBeenCalledTimes(1);
    expect(result.data?.auditIds).toHaveLength(1);
    expect(result.data?.auditIds[0]).toBe('alog_test_1');
  });

  it('SYNC_REF_FAILED — syncEmailReferences rejects → fail closed', async () => {
    vi.mocked(syncEmailReferences).mockRejectedValueOnce(new Error('sync ref fail'));
    const prisma = makePrisma();
    const imapConnect = makeImapConnect();
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SYNC_REF_FAILED');
  });

  it('AUDIT_FAILED — writeRouteAuditLog rejects → fail closed', async () => {
    vi.mocked(writeRouteAuditLog).mockRejectedValueOnce(new Error('audit fail'));
    const prisma = makePrisma();
    const imapConnect = makeImapConnect();
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AUDIT_FAILED');
  });
});

describe('emailSyncService: helpers', () => {
  it('maskAccount masks local part', () => {
    expect(maskAccount('testuser@domain.com')).toBe('te***@domain.com');
    expect(maskAccount('a@domain.com')).toBe('***@domain.com');
    expect(maskAccount('')).toBe('***');
  });

  it('buildEmailSyncError sanitizes password', () => {
    const e = buildEmailSyncError('IMAP_CONNECT_FAILED', 'connect failed password=secret123');
    expect(e.message).not.toContain('secret123');
    expect(e.code).toBe('IMAP_CONNECT_FAILED');
  });
});

describe('emailSyncService: C2 自动归档集成', () => {
  beforeEach(() => vi.clearAllMocks());

  function makePrismaWithLinks() {
    const emailCreate = vi.fn().mockImplementation(async ({ data }: any) => ({ ...data }));
    const txEmail = { findFirst: vi.fn().mockResolvedValue(null), create: emailCreate };
    return {
      prisma: {
        email: txEmail,
        relation: { findMany: vi.fn().mockResolvedValue([
          { id: 'REL__1', name: 'Acme', chineseName: null, email: 'sender@test.com', primaryContactEmail: null, isOrganization: true, rating: 1 },
        ]) },
        order: { findMany: vi.fn().mockResolvedValue([
          { id: 'ORD__1', poNumber: 'PO-7788', customerRelationId: 'REL__1' },
        ]) },
        $transaction: vi.fn(async (fn: any) => fn({ email: txEmail, auditLog: { create: vi.fn() }, entityReference: { upsert: vi.fn() }, entityLink: { upsert: vi.fn() } })),
      } as any,
      emailCreate,
    };
  }

  const linkMessage = {
    attributes: { uid: 200, date: new Date(), flags: [] },
    parts: [{ which: '', body: {} }, {
      which: 'HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO CONTENT-TYPE)',
      body: { 'message-id': ['<link@test.com>'], from: ['Acme <sender@test.com>'], to: [['me@bambook.com']], subject: ['PO-7788 shipping docs'], date: ['2026-08-07T10:00:00Z'] },
    }],
  };

  it('地址+PO 命中 → create data 直接携带 relationId/orderId', async () => {
    const { prisma, emailCreate } = makePrismaWithLinks();
    const imapConnect = makeImapConnect({ messages: [linkMessage] });
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(true);
    expect(emailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relationId: 'REL__1', relationName: 'Acme', orderId: 'ORD__1', orderPo: 'PO-7788' }),
    }));
  });

  it('索引加载失败 → 降级不链接，同步主流程不受影响', async () => {
    const { prisma, emailCreate } = makePrismaWithLinks();
    prisma.relation.findMany.mockRejectedValue(new Error('relation table gone'));
    const imapConnect = makeImapConnect({ messages: [linkMessage] });
    const result = await syncEmailsFromImap({ prisma, credentials: { user: 'a@b.com', pass: 'x' }, imapConnect });
    expect(result.ok).toBe(true);
    expect(result.data?.synced).toBe(1);
    expect(emailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ relationId: expect.anything() }),
    }));
  });
});
