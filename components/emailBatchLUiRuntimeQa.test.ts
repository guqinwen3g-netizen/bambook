import { describe, expect, it } from 'vitest';

/**
 * 批次 L（L1-L11）— 智能邮箱前端静态契约 QA
 * 基于真实源码静态断言，口径与 emailOutboxComposeUiRuntimeQa 等既有 QA 一致。
 */

const fs = require('fs');
const path = require('path');
const EMAIL_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'EmailManager.tsx'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/route.ts'), 'utf-8');
const SYNC_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/email/emailSyncService.ts'), 'utf-8');

// ═══ L1：回复用覆盖层 DB id ═══
describe('L1 [回复死胡同]: originalEmailId 用覆盖层 DB id', () => {
  const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendReply');
  const fnEnd = EMAIL_MGR_SRC.indexOf('const handleSendNew');
  const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
  it('handleSendReply 取 selectedIntentInfo?.id（覆盖层 DB id）', () => {
    expect(body).toContain('selectedIntentInfo?.id');
    expect(body).toContain('originalEmailId: emailIdStr');
  });
  it('不再用 selectedEmail.id 作为 originalEmailId 来源（INBOX-123 格式会 404）', () => {
    expect(body).not.toContain('const emailIdStr = String(selectedEmail.id)');
  });
  it('EML__ 校验与「未同步到 ERP」提示保留', () => {
    expect(body).toContain('/^EML__/');
    expect(body).toContain('未同步到 ERP');
  });
});

// ═══ L2：一键真发 + 发件箱 ═══
describe('L2 [一键真发]: Send Message 创建后立即 SMTP 发送', () => {
  const fnStart = EMAIL_MGR_SRC.indexOf('const handleSendNew');
  const fnEnd = EMAIL_MGR_SRC.indexOf('const handleToggleStar');
  const body = EMAIL_MGR_SRC.slice(fnStart, fnEnd);
  it('handleSendNew 创建 Outbox 后立即 sendOutboxEmail（真发）', () => {
    expect(body).toContain('emailOutboxService.createOutboxEmail');
    expect(body).toContain('emailOutboxService.sendOutboxEmail(created.emailId');
  });
  it('发送失败保持 Outbox 并提示发件箱重试（不本地伪成功）', () => {
    expect(body).toContain('已存发件箱但发送失败');
    expect(body).toContain('发件箱重试');
  });
  it('事实字段仍走 detail 回读（created.emailId + detail.data）', () => {
    expect(body).toContain('created.emailId');
    expect(body).toContain('detail.data');
  });
});

describe('L2 [发件箱]: 左侧导航 Outbox 文件夹（DB-backed）', () => {
  it('导航含 Outbox 项（handleBoxChange(\'Outbox\')）', () => {
    expect(EMAIL_MGR_SRC).toContain("handleBoxChange('Outbox')");
  });
  it('loadOutboxEmails 拉 ERP DB（mailbox=Outbox&direction=outbound）', () => {
    expect(EMAIL_MGR_SRC).toContain('loadOutboxEmails');
    expect(EMAIL_MGR_SRC).toContain('mailbox=Outbox&direction=outbound');
  });
  it('Outbox 不走 IMAP 同步（handleSync 分流）', () => {
    expect(EMAIL_MGR_SRC).toContain("logicalBox === 'Outbox'");
  });
  it('DB-backed 邮件选中不走 IMAP 详情（EML__ 分支）', () => {
    expect(EMAIL_MGR_SRC).toContain("String(email.id).startsWith('EML__')");
  });
});

// ═══ L3：附件显示和下载 ═══
describe('L3 [附件]: 渲染 selectedEmailAttachments + 同步创建附件记录', () => {
  it('详情附件区渲染 selectedEmailAttachments（非 selectedEmail.attachments）', () => {
    expect(EMAIL_MGR_SRC).toContain('selectedEmailAttachments.map');
    expect(EMAIL_MGR_SRC).not.toContain('selectedEmail.attachments.map');
  });
  it('同步服务创建 EmailAttachment 记录', () => {
    expect(SYNC_SVC_SRC).toContain('emailAttachment.create');
    expect(SYNC_SVC_SRC).toContain('hasAttachments: nonInlineAttachments.length > 0');
  });
});

// ═══ L4：正文入库 ═══
describe('L4 [bodyText]: 同步时正文入库', () => {
  it('emailSyncService 用 simpleParser 解析完整邮件源', () => {
    expect(SYNC_SVC_SRC).toContain("from 'mailparser'");
    expect(SYNC_SVC_SRC).toContain('simpleParser');
  });
  it('email.create 不再硬编码 bodyText 空串', () => {
    expect(SYNC_SVC_SRC).not.toContain("bodyText: ''");
    expect(SYNC_SVC_SRC).toContain('bodyText,');
  });
});

// ═══ L5/L6：移动/归档通知服务器 ═══
describe('L5/L6 [真移动/归档]: 调邮件服务器 API', () => {
  it('Move to 菜单调 handleMoveToFolder（非 handleBoxChange 切视图）', () => {
    expect(EMAIL_MGR_SRC).toContain("handleMoveToFolder(selectedId!, 'INBOX')");
    expect(EMAIL_MGR_SRC).toContain("handleMoveToFolder(selectedId!, 'Trash')");
  });
  it('handleMoveToFolder 调 /email/move（IMAP 真移动）', () => {
    const fnMatch = EMAIL_MGR_SRC.match(/const handleMoveToFolder = [\s\S]*?^  };/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain("'/email/move'");
  });
  it('handleArchive 调 /email/move toBox=Archive（通知服务器）', () => {
    const fnMatch = EMAIL_MGR_SRC.match(/const handleArchive = [\s\S]*?^  };/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain("'/email/move'");
    expect(fnMatch![0]).toContain("toBox: 'Archive'");
  });
  it('后端 BOX_ATTR_MAP 含 Archive → \\ARCHIVE 属性解析', () => {
    expect(ROUTE_SRC).toContain("Archive: '\\\\ARCHIVE'");
  });
});

// ═══ L7：密码从 URL 移除 ═══
describe('L7 [凭据边界]: URL 不含密码', () => {
  it('附件下载改 POST（前端不再 URLSearchParams 拼 password）', () => {
    const fnMatch = EMAIL_MGR_SRC.match(/const handleDownloadAttachment = [\s\S]*?^  };/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toContain('URLSearchParams');
    expect(fnMatch![0]).toContain("method: 'POST'");
  });
  it('后端附件端点改 POST /attachment（不再有 GET /attachment）', () => {
    expect(ROUTE_SRC).toContain("router.post('/attachment'");
    expect(ROUTE_SRC).not.toContain("router.get('/attachment'");
  });
  it('图片代理地址不含密码（imapSessionStore session token）', () => {
    expect(ROUTE_SRC).toContain('putImapSession');
    expect(ROUTE_SRC).toContain('getImapSession');
    expect(ROUTE_SRC).not.toContain('email, password, host, port: String(port)');
  });
});

// ═══ L8：调试残留清理 ═══
describe('L8 [调试残留]: console.log 与 debug 字段清零', () => {
  it('EmailManager 无 console.log（console.error 真实错误保留）', () => {
    expect(EMAIL_MGR_SRC).not.toContain('console.log(');
  });
  it('后端 /fetch 响应不含 debug 字段', () => {
    expect(ROUTE_SRC).not.toContain('debug:');
  });
});

// ═══ L9：邮箱服务商配置 ═══
describe('L9 [服务商配置]: 设置弹窗含服务器/端口', () => {
  it('IMAP Server/Port + SMTP Server/Port 配置项', () => {
    expect(EMAIL_MGR_SRC).toContain('IMAP Server');
    expect(EMAIL_MGR_SRC).toContain('IMAP Port');
    expect(EMAIL_MGR_SRC).toContain('SMTP Server');
    expect(EMAIL_MGR_SRC).toContain('SMTP Port');
    expect(EMAIL_MGR_SRC).toContain('smtpHost');
    expect(EMAIL_MGR_SRC).toContain('smtpPort');
  });
});

// ═══ L11：去掉邮件中心标题 ═══
describe('L11 [标题]: 去掉「邮件中心」PageHeader', () => {
  it('无 邮件中心 标题与 PageHeader 引用', () => {
    expect(EMAIL_MGR_SRC).not.toContain('邮件中心');
    expect(EMAIL_MGR_SRC).not.toContain('PageHeader');
  });
});
