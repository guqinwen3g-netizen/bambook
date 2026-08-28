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
    // 边缘渐隐已由 useStaticEdgeMask 挂滚动容器自身承接（替代 ScrollEdgeFades JSX）——
    // 主区 96/112 默认档（users tab 不启用）、用户列表 56/72
    expect(source).toContain("import { useStaticEdgeMask } from './ui/useStaticEdgeMask'");
    expect(source).not.toContain('<ScrollEdgeFades');
    expect(source).toContain("useStaticEdgeMask(mainScrollRef, { topFadeEnd: 96, bottomFade: 112, enabled: activeTab !== 'users' })");
    expect(source).toContain("useStaticEdgeMask(userListScrollRef, { topFadeEnd: 56, bottomFade: 72, enabled: activeTab === 'users' })");
  });

  it('uses the Bambook OS glass material for admin surfaces and user fields', () => {
    expect(ADMIN_PANEL_GLASS_DARK_CLASS).toContain('bambook-dashboard-glass-color');
    expect(ADMIN_PANEL_GLASS_LIGHT_CLASS).toContain('bambook-dashboard-glass-color');
    expect(ADMIN_USER_CARD_DARK_CLASS).toContain('bambook-dashboard-glass-color');
    expect(ADMIN_USER_CARD_LIGHT_CLASS).toContain('bambook-dashboard-glass-color');
    // v2.3 字段统一裁决：表单字段真源收敛为 BDS 类（.bds-input 已胶囊化：
    // 36px/可见描边/rounded-control，几何与原 recessedField 配方完全同规格）
    expect(ADMIN_USER_FIELD_DARK_CLASS).toBe('bds-input');
    expect(ADMIN_USER_FIELD_LIGHT_CLASS).toBe('bds-input');
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

describe('AdminPanel REQ2-13 离职一键交接（DR-056）', () => {
  it('用户编辑视图提供离职交接入口（与停用/抹除并列）', () => {
    expect(source).toContain("import { handoverService, HandoverCounts } from '../services/handoverService'");
    expect(source).toContain('<ArrowLeftRight size={14} />离职交接');
    expect(source).toContain('onClick={() => openHandover(editingUser)}');
  });

  it('交接走 BottomSheet 两段式：打开即预览（计数 + 最近交接单），选接收人后刷新预览', () => {
    expect(source).toContain("import BottomSheet from './ui/BottomSheet'");
    expect(source).toContain('title="离职一键交接"');
    expect(source).toContain('handoverService.preview(u.id)');
    expect(source).toContain('handoverService.listRecords(10)');
    expect(source).toContain('refreshHandoverPreview(handoverTarget.id, e.target.value)');
    // 五类资产计数格
    expect(source).toContain("'档主客户'");
    expect(source).toContain("'协同客户'");
    expect(source).toContain("'商机'");
    expect(source).toContain("'跟进记录'");
    expect(source).toContain("'无锚订单'");
    // T-38 自动继承口径说明
    expect(source).toContain('T-38');
  });

  it('接收人选项仅限在职且非离职者本人；警示透出', () => {
    expect(source).toContain("users.filter((u: any) => u.status === 'active' && u.id !== handoverTarget?.id)");
    expect(source).toContain('handoverPreview.warnings.map');
  });

  it('执行前 bdsConfirm 确认（danger），执行后 toast + 用户列表与交接单历史刷新', () => {
    expect(source).toContain("'确认执行离职交接'");
    expect(source).toContain('danger: true');
    expect(source).toContain("handoverService.execute({");
    expect(source).toContain('fromUserId: handoverTarget.id');
    expect(source).toContain('disableAccount: handoverDisable');
    expect(source).toContain("bdsToast.success('离职交接完成，资产已全部移交。')");
    expect(source).toContain("await loadTab('users')");
  });

  it('停用开关联动（ToggleSwitch）+ 执行中防重入（关闭/按钮禁用）', () => {
    expect(source).toContain("import ToggleSwitch from './ui/ToggleSwitch'");
    expect(source).toContain('checked={handoverDisable}');
    expect(source).toContain('onChange={setHandoverDisable}');
    expect(source).toContain('if (handoverExecuting) return;');
    expect(source).toContain('disabled={handoverExecuting || !handoverSuccessorId || handoverPreviewLoading}');
  });

  it('交接单历史渲染 from → to + 停用标记 + 计数摘要（append-only 留痕可见）', () => {
    expect(source).toContain('最近交接记录');
    expect(source).toContain('{r.fromUserName}');
    expect(source).toContain('{r.toUserName}');
    expect(source).toContain("{r.disableAccount ? '已停用' : '未停用'}");
    expect(source).toContain("{r.detail?.relationsOwned ?? 0} 客户 · {r.detail?.opportunities ?? 0} 商机 · {r.detail?.followUpRecords ?? 0} 跟进");
  });
});
