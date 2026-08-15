import { describe, expect, it } from 'vitest';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import {
  ADMIN_PANEL_BODY_CLASS,
  ADMIN_PANEL_GLASS_DARK_CLASS,
  ADMIN_PANEL_GLASS_LIGHT_CLASS,
  ADMIN_PANEL_SCROLL_CLASS,
  ADMIN_PANEL_SURFACE_CLASS,
  ADMIN_USER_CARD_DARK_CLASS,
  ADMIN_USER_CARD_LIGHT_CLASS,
  ADMIN_USER_FIELD_DARK_CLASS,
  ADMIN_USER_FIELD_LIGHT_CLASS,
  ADMIN_USER_LIST_SCROLL_CLASS,
} from './AdminPanel';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AdminPanel.tsx', import.meta.url), 'utf8');

describe('AdminPanel layout bounds', () => {
  it('keeps the admin sidebar and main surface ending inside the viewport', () => {
    expect(ADMIN_PANEL_BODY_CLASS).toContain(BAMBOOK_OS.layout.desktopPanelRowClass);
    expect(ADMIN_PANEL_BODY_CLASS).toContain(BAMBOOK_OS.layout.desktopPageCanvasClass);
    expect(ADMIN_PANEL_BODY_CLASS).toContain('bambook-main-panel-bottom-inset');
    expect(ADMIN_PANEL_SURFACE_CLASS).toContain('h-full');
  });

  it('separates the bordered surface from the scrolling content', () => {
    expect(ADMIN_PANEL_SURFACE_CLASS).toContain('overflow-hidden');
    expect(ADMIN_PANEL_SCROLL_CLASS).toContain('overflow-y-auto');
    expect(ADMIN_USER_LIST_SCROLL_CLASS).toContain('flex-1');
    expect(ADMIN_USER_LIST_SCROLL_CLASS).toContain('overflow-y-auto');
    expect(source).toContain("activeTab === 'users' ? 'h-full min-h-0 overflow-hidden' : ADMIN_PANEL_SCROLL_CLASS");
    expect(source).toContain('ref={userListScrollRef}');
    expect(source).toContain('scrollRef={userListScrollRef}');
  });

  it('uses the Bambook OS glass material for admin surfaces and user fields', () => {
    expect(ADMIN_PANEL_GLASS_DARK_CLASS).toContain('bambook-dashboard-glass-color');
    expect(ADMIN_PANEL_GLASS_LIGHT_CLASS).toContain('bambook-dashboard-glass-color');
    expect(ADMIN_USER_CARD_DARK_CLASS).toContain('bambook-dashboard-glass-color');
    expect(ADMIN_USER_CARD_LIGHT_CLASS).toContain('bambook-dashboard-glass-color');
    // recessedField 已演进为 flat 雕刻配方并收编至 BDS token 真源：var() 任意值绕开 flat 护栏
    // （border:0 !important 误伤），可见描边是字段语义的必要组成，故禁用 backdrop-blur/shadow 触发子串
    expect(ADMIN_USER_FIELD_DARK_CLASS).toContain('!bg-none');
    expect(ADMIN_USER_FIELD_DARK_CLASS).toContain('border-[color:var(--border-c-default)]');
    expect(ADMIN_USER_FIELD_LIGHT_CLASS).toContain('!bg-none');
    expect(ADMIN_USER_FIELD_LIGHT_CLASS).toContain('border-[color:var(--border-c-default)]');
  });

  it('keeps admin page status color language constrained to brand blue, neutral, and danger', () => {
    expect(source).not.toMatch(/amber|emerald|green|bg-blue|text-blue|border-blue/);
  });

  it('does not ask admins to type a new user id', () => {
    expect(source).toContain('用户 ID 将自动生成');
    expect(source).not.toContain('newUser.id');
    expect(source).not.toContain('user-001');
    expect(source).toContain('createAdminGeneratedUserId(newUser.email, newUser.displayName)');
  });

  it('keeps detailed account information inside the edit view', () => {
    expect(source).not.toContain('账号资料已隐藏，进入编辑后查看完整信息');
    expect(source).toContain("['用户', '状态', '角色', '']");
    expect(source).toContain('{editingUser.id}');
    expect(source).toContain('value={userDraft.displayName}');
    expect(source).toContain('value={userDraft.email}');
    expect(source).toContain('value={userDraft.departmentId}');
    expect(source).toContain('value={userDraft.status}');
    expect(source).toContain('formatAdminDate(editingUser.lastLoginAt)');
    expect(source).toContain('formatAdminDate(editingUser.createdAt)');
    expect(source).toContain('已加密保存，不能查看原密码');
    expect(source).toContain('maskAdminEmail(u.email)');
    expect(source).not.toContain('passwordHash');
  });

  it('hydrates admin tabs from session cache before refreshing from the server', () => {
    expect(source).toContain("ADMIN_PANEL_SESSION_CACHE_KEY = 'bambook_admin_panel_session_cache_v1'");
    expect(source).toContain('readAdminPanelCache');
    expect(source).toContain('writeAdminPanelCache(tab, d)');
    expect(source).toContain('hydrateAdminTabFromCache(activeTab)');
    expect(source).toContain('const hasCachedView = hydrateAdminTabFromCache(tab)');
    expect(source).toContain('setLoading(!hasCachedView)');
  });

  it('edits account details and role through one save action', () => {
    expect(source).toContain('const [userDraft, setUserDraft]');
    expect(source).toContain('postAdmin(`users/${userId}`, { displayName, email, departmentId: departmentId || null, status: userDraft.status }, \'PATCH\')');
    expect(source).toContain('postAdmin(`users/${userId}/roles`, { roles: [role] }, \'PATCH\')');
    expect(source).toContain('value={userDraft.role}');
    expect(source).toContain('保存账号');
    expect(source).not.toContain('toggleRoleDraft');
    expect(source).not.toContain('saveRoleEdit');
  });

  it('marks admin and owner accounts with a crown in the user list', () => {
    expect(source).toContain('Crown');
    expect(source).toContain("roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : null");
    expect(source).toContain('aria-label={privilegedRole === \'owner\' ? \'Owner account\' : \'Admin account\'}');
  });

  it('uses the shared circular user avatar component in user lists', () => {
    expect(source).toContain("import UserAvatar from './ui/UserAvatar'");
    expect(source).toContain('avatarUrl={u.avatarUrl}');
    expect(source).not.toContain("(u.displayName || '?')[0].toUpperCase()");
  });

  it('uses disable and erase wording instead of ambiguous account deletion', () => {
    expect(source).toContain('disableAccount');
    expect(source).toContain('disable-account');
    expect(source).toContain('停用账号');
    expect(source).toContain('抹除个人数据');
    expect(source).not.toContain('删除账号');
  });

  it('keeps role values stable while rendering role options in Chinese', () => {
    expect(source).toContain('ROLE_LABELS');
    expect(source).toContain("owner: '所有者'");
    expect(source).toContain("admin: '管理员'");
    expect(source).toContain("agent_operator: '智能体操作员'");
    expect(source).toContain('formatRoleLabel(role)');
    expect(source).toContain('formatRoleLabel(r.name)');
    expect(source).toContain('formatRoleLabel(acl.roleName)');
    expect(source).toContain('formatRoleLabel(p.roleName)');
  });

  it('renders permission and access options in Chinese while keeping stable scope values', () => {
    expect(source).toContain('PERMISSION_LABELS');
    expect(source).toContain("'ai:chat': '使用 AI 对话'");
    expect(source).toContain("'tools:execute': '使用智能工具'");
    expect(source).toContain('ACCESS_LABELS');
    expect(source).toContain('RISK_MODE_LABELS');
    expect(source).toContain('formatPermissionLabel(p.scope)');
    expect(source).toContain('formatPermissionLabel(p)');
    expect(source).toContain('formatAccessLabel(acl.access)');
    expect(source).toContain('formatRiskModeLabel(p.riskMode)');
  });
});
