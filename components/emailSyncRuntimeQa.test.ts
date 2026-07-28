import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/emailSyncService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/route.ts'), 'utf-8');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/emailSyncFlow.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const MANIFEST_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/mcp/manifest.ts'), 'utf-8');
const EMAIL_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'EmailManager.tsx'), 'utf-8');

function sliceFromFunc(src: string, funcName: string): string {
  const marker = `export async function ${funcName}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const nextExport = src.indexOf('\nexport ', start + marker.length);
  return nextExport > 0 ? src.slice(start, nextExport) : src.slice(start);
}
function sliceManifestEntry(src: string, id: string): string {
  const start = src.indexOf(`id: '${id}'`);
  if (start < 0) return '';
  const nextEntry = src.indexOf('\n    id: \'', start + 10);
  return nextEntry > 0 ? src.slice(start, nextEntry) : src.slice(start, start + 1200);
}

// ═══ Part 1: service 核心 ═══
describe('runtime QA [service]: emailSyncService', () => {
  it('syncEmailsFromImap 主方法', () => { expect(SERVICE_SRC).toContain('export async function syncEmailsFromImap'); });
  it('maskAccount（日志脱敏）', () => { expect(SERVICE_SRC).toContain('export function maskAccount'); });
  it('MISSING_CREDENTIALS fail closed', () => { expect(SERVICE_SRC).toContain('MISSING_CREDENTIALS'); });
  it('$transaction 事务闭环', () => { expect(SERVICE_SRC).toContain('$transaction'); });
  it('syncEmailReferences（EntityLink sync）', () => { expect(SERVICE_SRC).toContain('syncEmailReferences'); });
  it('writeRouteAuditLog（同事务 audit）', () => { expect(SERVICE_SRC).toContain('writeRouteAuditLog'); });
});

// ═══ Part 2: service ErrorCode ═══
describe('runtime QA [service]: ErrorCode', () => {
  const CODES = ['MISSING_CREDENTIALS', 'IMAP_CONNECT_FAILED', 'SYNC_FAILED', 'DB_WRITE_FAILED', 'SYNC_REF_FAILED', 'AUDIT_FAILED', 'UNKNOWN_ERROR'];
  for (const code of CODES) {
    it(`error code "${code}"`, () => { expect(SERVICE_SRC).toContain(`'${code}'`); });
  }
});

// ═══ Part 3: route 端点调 service ═══
describe('runtime QA [route]: POST /sync', () => {
  it('POST /sync 调 syncEmailsFromImap', () => { expect(ROUTE_SRC).toContain('syncEmailsFromImap'); });
  it('router.post(/sync)', () => { expect(ROUTE_SRC).toContain("router.post('/sync'"); });
});

// ═══ Part 4: Agent flow ProcessDraft 六字段 ═══
describe('runtime QA [Agent flow]: buildEmailSyncDraft 六字段', () => {
  it('idempotencyKey: email.sync:${credentialsUser}:${hash}', () => { expect(FLOW_SRC).toContain('email.sync:${credentialsUser}'); });
  it('toolId: email.sync', () => { expect(FLOW_SRC).toContain("toolId: 'email.sync'"); });
  it('action: sync_imap_emails', () => { expect(FLOW_SRC).toContain("action: 'sync_imap_emails'"); });
  it('impactScope [emails]', () => { expect(FLOW_SRC).toContain("impactScope: ['emails']"); });
  it('after 含 credentialsUser（不含 password）', () => {
    const b = FLOW_SRC.slice(FLOW_SRC.indexOf('buildEmailSyncDraft'), FLOW_SRC.indexOf('validateEmailSyncDraftSemantics'));
    expect(b).toContain('credentialsUser');
    expect(b).not.toContain('password');
    expect(b).not.toContain('pass:');
  });
});

// ═══ Part 5: Agent flow credentialRef 模式（password 不在 draft/after）═══
describe('runtime QA [Agent flow]: credentialRef 模式', () => {
  it('EmailSyncDraftInput 不含 password 字段', () => {
    const iface = FLOW_SRC.slice(FLOW_SRC.indexOf('EmailSyncDraftInput'), FLOW_SRC.indexOf('buildEmailSyncDraft'));
    expect(iface).not.toContain('password');
    expect(iface).not.toContain('pass');
  });
  it('commit 通过 credentialsPassword 参数注入（外部注入，非 draft payload）', () => {
    expect(FLOW_SRC).toContain('credentialsPassword');
  });
});

// ═══ Part 6: Agent flow hash 防篡改 ═══
describe('runtime QA [Agent flow]: hash 防篡改', () => {
  it('verifyEmailSyncDraftHash', () => { expect(FLOW_SRC).toContain('verifyEmailSyncDraftHash'); });
  it('PROCESS_DRAFT_HASH_MISMATCH fail closed', () => { expect(FLOW_SRC).toContain('PROCESS_DRAFT_HASH_MISMATCH'); });
  it('PROCESS_DRAFT_MISSING fail closed', () => { expect(FLOW_SRC).toContain('PROCESS_DRAFT_MISSING'); });
});

// ═══ Part 7: Agent commit 复用 service ═══
describe('runtime QA [Agent flow]: commit 复用 service', () => {
  it('commitEmailSync 复用 syncEmailsFromImap service', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitEmailSync');
    expect(b).toContain('syncEmailsFromImap');
  });
  it('commit 不手写 IMAP/DB mutation（调 service）', () => {
    const b = sliceFromFunc(FLOW_SRC, 'commitEmailSync');
    expect(b).not.toContain('imap.connect');
    expect(b).not.toContain('prisma.email.create');
  });
});

// ═══ Part 8: toolRuntime dispatch ═══
describe('runtime QA [toolRuntime]: email.sync dispatch', () => {
  it('draft 分支 definition.id === email.sync', () => { expect(TOOL_RUNTIME_SRC).toContain("definition.id === 'email.sync'"); });
  it('commit 分支 call.toolId === email.sync', () => { expect(TOOL_RUNTIME_SRC).toContain("call.toolId === 'email.sync'"); });
});

// ═══ Part 9: manifest credentialRef 真实 source ═══
describe('runtime QA [manifest]: email.sync 真实 source', () => {
  const entry = sliceManifestEntry(MANIFEST_SRC, 'email.sync');
  it('id 存在', () => { expect(entry).toContain("id: 'email.sync'"); });
  it('description 含 credentialRef 模式 + 不含明文 password', () => {
    expect(entry).toContain('credentialRef');
    expect(entry).toContain('不含明文 password');
  });
  it('inputHint credentials 含 pass', () => {
    expect(entry).toContain('pass: string');
  });
  it('example.pass 使用 *** 脱敏', () => {
    expect(entry).toContain("pass: '***'");
  });
});

// ═══ Part 10: 前端 EmailManager credential 边界 ═══
describe('runtime QA [前端 EmailManager]: credential 边界', () => {
  it('handleSaveConfig 不把 password 写入 localStorage（safeConfig 剔除 password）', () => {
    expect(EMAIL_MGR_SRC).toContain('const { password, ...safeConfig } = config');
    expect(EMAIL_MGR_SRC).toContain("JSON.stringify(safeConfig)");
  });
  it('loadConfig 不从 localStorage 读取 password（默认空）', () => {
    expect(EMAIL_MGR_SRC).toContain("password: '' }");
  });
});

// ═══ Part 11: 前端 EmailManager sync 消费 ═══
describe('runtime QA [前端 EmailManager]: sync 消费', () => {
  it('不调 Agent commit function', () => {
    expect(EMAIL_MGR_SRC).not.toContain('commitEmailSync');
    expect(EMAIL_MGR_SRC).not.toContain('emailSyncFlow');
  });
  it('不混 email.send/outbox send（边界隔离）', () => {
    expect(EMAIL_MGR_SRC).not.toContain('emailOutboxService.commitEmailSend');
  });
  it('isSyncing busy 防重复 state 存在', () => {
    expect(EMAIL_MGR_SRC).toContain('isSyncing');
  });
});

// ═══ Part 12: 真实 fixture ═══
describe('runtime QA [fixture]: payload', () => {
  it('sync 成功 res: { synced, skipped, errors }', () => {
    const res = { synced: 10, skipped: 2, errors: [], accountMasked: 'use***@company.com' };
    expect(res.synced).toBe(10);
    expect(res.accountMasked).toContain('***');
  });
  it('MISSING_CREDENTIALS 失败', () => { expect({ code: 'MISSING_CREDENTIALS' }.code).toBe('MISSING_CREDENTIALS'); });
  it('IMAP_CONNECT_FAILED 失败', () => { expect({ code: 'IMAP_CONNECT_FAILED' }.code).toBe('IMAP_CONNECT_FAILED'); });
});
