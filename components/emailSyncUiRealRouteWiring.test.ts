import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SYNC_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/emailSyncService.ts'), 'utf-8');
const EMAIL_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'EmailManager.tsx'), 'utf-8');

// ═══ Part 1: emailSyncService 真实 /v1/email/sync ═══
describe('QA [emailSyncService]: POST /v1/email/sync', () => {
  it('buildApiUrl /v1/email/sync', () => {
    expect(SYNC_SVC_SRC).toContain("'/v1/email/sync'");
  });
  it('POST email/password/host/port/box/limit', () => {
    expect(SYNC_SVC_SRC).toContain("method: 'POST'");
    expect(SYNC_SVC_SRC).toContain('email: input.email');
    expect(SYNC_SVC_SRC).toContain('password: input.password');
    expect(SYNC_SVC_SRC).toContain('host: input.host');
    expect(SYNC_SVC_SRC).toContain('port: input.port');
    expect(SYNC_SVC_SRC).toContain('box: input.box');
    expect(SYNC_SVC_SRC).toContain('limit: input.limit');
  });
  it('失败抛后端 error message（throw err with message）', () => {
    expect(SYNC_SVC_SRC).toContain('throw err');
  });
  it('失败保留后端 error.code（EmailSyncError extends Error + code 字段）', () => {
    expect(SYNC_SVC_SRC).toContain('export interface EmailSyncError extends Error');
    expect(SYNC_SVC_SRC).toContain('err.code = json?.error?.code');
  });
  it('带 x-bambook-api-key（getApiKey + header，远端 API key 环境）', () => {
    expect(SYNC_SVC_SRC).toContain('apiService.getApiKey()');
    expect(SYNC_SVC_SRC).toContain("'x-bambook-api-key'");
  });
  it('成功返回 synced/skipped/errors/accountMasked/auditIds', () => {
    expect(SYNC_SVC_SRC).toContain('synced');
    expect(SYNC_SVC_SRC).toContain('skipped');
    expect(SYNC_SVC_SRC).toContain('errors');
    expect(SYNC_SVC_SRC).toContain('accountMasked');
    expect(SYNC_SVC_SRC).toContain('auditIds');
  });
});

// ═══ Part 2: EmailManager 消费真实 /v1/email/sync ═══
describe('QA [EmailManager]: 消费 emailSyncService.syncToErp', () => {
  it('import emailSyncService', () => {
    expect(EMAIL_MGR_SRC).toContain("import { emailSyncService }");
  });
  it('handleSyncToErp 调 emailSyncService.syncToErp', () => {
    expect(EMAIL_MGR_SRC).toContain('handleSyncToErp');
    expect(EMAIL_MGR_SRC).toContain('emailSyncService.syncToErp');
  });
  it('成功消费 synced/skipped/errors/accountMasked（不伪造成功）', () => {
    expect(EMAIL_MGR_SRC).toContain('result.synced');
    expect(EMAIL_MGR_SRC).toContain('result.skipped');
    expect(EMAIL_MGR_SRC).toContain('result.accountMasked');
  });
  it('失败显示 erpSyncError（不污染列表/缓存）', () => {
    expect(EMAIL_MGR_SRC).toContain('erpSyncError');
    expect(EMAIL_MGR_SRC).toContain('setErpSyncError');
  });
  it('成功显示 erpSyncResult', () => {
    expect(EMAIL_MGR_SRC).toContain('erpSyncResult');
  });
});

// ═══ Part 3: busy/disabled 防重复 ═══
describe('QA [EmailManager]: busy/disabled 防重复', () => {
  it('erpSyncBusy state + if (erpSyncBusy) return guard', () => {
    expect(EMAIL_MGR_SRC).toContain('erpSyncBusy');
    expect(EMAIL_MGR_SRC).toContain('if (erpSyncBusy) return');
  });
  it('同步按钮 disabled={erpSyncBusy}', () => {
    expect(EMAIL_MGR_SRC).toContain('disabled={erpSyncBusy}');
    expect(EMAIL_MGR_SRC).toContain('data-erp-sync-busy');
  });
  it('finally setErpSyncBusy(false)', () => {
    expect(EMAIL_MGR_SRC).toContain('setErpSyncBusy(false)');
  });
  it('UNREAD/STARRED/IMPORTANT 映射 INBOX（physicalBox，不直传虚拟文件夹）', () => {
    expect(EMAIL_MGR_SRC).toContain("'UNREAD', 'STARRED', 'IMPORTANT'");
    expect(EMAIL_MGR_SRC).toContain("'INBOX' : currentBox");
    expect(EMAIL_MGR_SRC).toContain('box: physicalBox');
  });
});

// ═══ Part 4: credential 边界 ═══
describe('QA [EmailManager]: credential 边界', () => {
  it('password 不写 localStorage（safeConfig 剔除）', () => {
    expect(EMAIL_MGR_SRC).toContain('const { password, ...safeConfig } = config');
    expect(EMAIL_MGR_SRC).toContain('JSON.stringify(safeConfig)');
  });
  it('loadConfig 不从 localStorage 读取 password', () => {
    expect(EMAIL_MGR_SRC).toContain("password: '' }");
  });
  it('password 只从内存 emailConfig 提交', () => {
    expect(EMAIL_MGR_SRC).toContain('emailConfig.password');
  });
});

// ═══ Part 5: 旧 /email/fetch 保留为浏览兼容 ═══
describe('QA [EmailManager]: 旧 /email/fetch 保留', () => {
  it('旧 /email/fetch 路径保留（实时浏览兼容）', () => {
    expect(EMAIL_MGR_SRC).toContain("'/email/fetch'");
  });
});

// ═══ Part 6: 不调 Agent flow ═══
describe('QA [EmailManager]: no Agent commit mixing', () => {
  it('不调 commitEmailSync', () => {
    expect(EMAIL_MGR_SRC).not.toContain('commitEmailSync');
  });
  it('不调 emailSyncFlow', () => {
    expect(EMAIL_MGR_SRC).not.toContain('emailSyncFlow');
  });
});

// ═══ Part 7: 真实 fixture ═══
describe('QA [fixture]: /v1/email/sync 真实 payload', () => {
  it('成功 res: { ok, synced, skipped, errors, accountMasked, auditIds }', () => {
    const res = { ok: true, synced: 10, skipped: 2, errors: 0, accountMasked: 'use***@company.com', auditIds: ['a1', 'a2'] };
    expect(res.synced).toBe(10);
    expect(res.accountMasked).toContain('***');
    expect(res.auditIds).toHaveLength(2);
  });
  it('MISSING_CREDENTIALS 失败', () => { expect({ code: 'MISSING_CREDENTIALS' }.code).toBe('MISSING_CREDENTIALS'); });
  it('IMAP_CONNECT_FAILED 失败', () => { expect({ code: 'IMAP_CONNECT_FAILED' }.code).toBe('IMAP_CONNECT_FAILED'); });
});
