import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createAuthService } from './service';
import { AgentRole } from '../agent/types';
import { EmailService, buildVerificationEmail, createEmailService } from './email';
import { VerificationStore, createVerificationStore } from './verification';
import { logger } from '../lib/logger';
import { ROLE_ID_TO_LEGACY_AGENT_ROLE } from './permissionService';
import { createLoginRateLimiter } from './loginRateLimiter';

type AuthRouterOptions = {
  prisma: PrismaClient;
  email?: EmailService;
  verification?: VerificationStore;
  requireEmailVerification?: boolean;
  /**
   * 登录防爆破限流配置（默认：同一 IP+账号 15 分钟内最多 5 次失败）。
   * 传 false 显式关闭（测试场景）；亦可用环境变量 BAMBOOK_LOGIN_RATE_LIMIT_DISABLED=1 关闭，
   * 或用 BAMBOOK_LOGIN_RATE_LIMIT_WINDOW_MS / BAMBOOK_LOGIN_RATE_LIMIT_MAX_FAILURES 调整阈值。
   */
  loginRateLimit?: { windowMs?: number; maxFailures?: number } | false;
};

const COOKIE_NAME = 'bambook_token';
const COOKIE_MAX_AGE = 7 * 24 * 3600 * 1000;
const AVATAR_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeLoginIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 新 RBAC 角色 id → 旧 AgentRole 字符串列表的映射（兼容旧 requireRole 调用）。
 * - 角色 id 匹配系统内置 7 种（role-sales / role-sales-manager / role-qc / role-logistics 等）时走 ROLE_ID_TO_LEGACY_AGENT_ROLE
 * - 其他自定义角色（isSystem=false）退回到 role.name 作为 legacy 字符串
 * - 返回 AgentRole[]（GAP-R11 后系统内置角色与 legacy 一一对应，无一对多）
 */
function userRolesToLegacyAgentRoles(
  userRoles: Array<{ roleId: string; role?: { name?: string | null; isSystem?: boolean | null } }>,
): { legacy: AgentRole[]; newRoleIds: string[] } {
  const legacy = new Set<AgentRole>();
  const newRoleIds: string[] = [];
  for (const ur of userRoles) {
    if (!ur.roleId) continue;
    newRoleIds.push(ur.roleId);
    const mapped = ROLE_ID_TO_LEGACY_AGENT_ROLE[ur.roleId];
    if (mapped) {
      // 'owner' 同时包含 owner + admin（owner 级权限应该同时拥有 admin 范围的检查）
      legacy.add(mapped);
      if (mapped === 'owner') legacy.add('admin');
      if (mapped === 'finance') legacy.add('finance');
    } else {
      // 自定义角色，fallback：role.name 可能是之前旧种子里的 legacy code 字符串
      const name = ur.role?.name?.trim();
      if (name) {
        const accepted: AgentRole[] = ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser', 'logistics', 'production_manager', 'factory', 'agent_operator', 'viewer'];
        if (accepted.includes(name as AgentRole)) {
          legacy.add(name as AgentRole);
        }
      }
    }
  }
  return { legacy: Array.from(legacy), newRoleIds };
}

function collectPermissionScopes(roles: Array<{ role?: { permissions?: Array<{ permission?: { scope?: string | null } }> } }>): string[] {
  const scopes = new Set<string>();
  for (const userRole of roles) {
    for (const rolePermission of userRole.role?.permissions || []) {
      const scope = rolePermission.permission?.scope;
      if (scope) scopes.add(scope);
    }
  }
  return Array.from(scopes).sort();
}

function serializeAuthUser(user: any, roles: AgentRole[], permissions: string[], departmentIds: string[], extra?: { newRoleIds?: string[] }) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: (user as any).avatarUrl || null,
    roles,
    roleIds: extra?.newRoleIds || [],
    permissions,
    departmentIds: departmentIds.length ? departmentIds : [user.primaryDeptId || 'company'],
    department: user.primaryDepartment?.name || null,
  };
}

export function createAuthRouter(options: AuthRouterOptions) {
  const router = Router();
  const auth = createAuthService();
  const email = options.email || createEmailService();
  const verification = options.verification || createVerificationStore();

  const envWindowMs = Number(process.env.BAMBOOK_LOGIN_RATE_LIMIT_WINDOW_MS);
  const envMaxFailures = Number(process.env.BAMBOOK_LOGIN_RATE_LIMIT_MAX_FAILURES);
  const loginRateLimiter =
    options.loginRateLimit === false || process.env.BAMBOOK_LOGIN_RATE_LIMIT_DISABLED === '1'
      ? null
      : createLoginRateLimiter({
          windowMs: (options.loginRateLimit && options.loginRateLimit.windowMs) || envWindowMs || undefined,
          maxFailures: (options.loginRateLimit && options.loginRateLimit.maxFailures) || envMaxFailures || undefined,
        });

  router.post('/login', async (req: Request, res: Response) => {
    const { email, identifier, password } = req.body || {};
    const loginIdentifier = normalizeLoginIdentifier(identifier || email);
    if (!loginIdentifier || !password) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Name/email and password are required.' });
    }

    // 防爆破：同一 IP 对同一账号的失败尝试计入滑动窗口，超限直接 429（不查库）
    const rateLimitKey = `${req.ip || 'unknown'}|${loginIdentifier.toLowerCase()}`;
    if (loginRateLimiter) {
      const verdict = loginRateLimiter.check(rateLimitKey);
      if (verdict.blocked) {
        return res.status(429).json({
          ok: false,
          error: 'RATE_LIMITED',
          message: '登录失败次数过多，请稍后重试。',
          retryAfterMs: verdict.retryAfterMs,
        });
      }
    }

    const normalizedEmail = normalizeEmail(loginIdentifier);
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    const user = await options.prisma.userAccount.findFirst({
      where: {
        deletedAt: null,
        OR: looksLikeEmail
          ? [{ email: { equals: normalizedEmail, mode: 'insensitive' } }]
          : [
              { displayName: { equals: loginIdentifier, mode: 'insensitive' } },
              { email: { equals: normalizedEmail, mode: 'insensitive' } },
            ],
      },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    if (!user || !user.passwordHash) {
      loginRateLimiter?.recordFailure(rateLimitKey);
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Invalid name/email or password.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ ok: false, error: 'PENDING_APPROVAL', message: '账号待管理员审批，请联系管理员。' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ ok: false, error: 'REJECTED', message: '账号申请已被拒绝。' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ ok: false, error: 'DISABLED', message: '账号已被停用。' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'INACTIVE', message: '账号当前不可用。' });
    }

    const valid = await auth.verifyPassword(password, user.passwordHash);
    if (!valid) {
      loginRateLimiter?.recordFailure(rateLimitKey);
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Invalid name/email or password.' });
    }

    // 登录成功：清除该 IP+账号的失败计数
    loginRateLimiter?.reset(rateLimitKey);

    const { legacy: roles, newRoleIds } = userRolesToLegacyAgentRoles(
      user.roles.map((ur: any) => ({ roleId: ur.roleId, role: { name: ur.role?.name, isSystem: ur.role?.isSystem } })),
    );
    const permissions = collectPermissionScopes(user.roles);
    const departmentIds = user.roles.map(ur => ur.departmentId).filter(Boolean) as string[];

    const token = auth.signToken({
      userId: user.id,
      displayName: user.displayName,
      roles,
      roleIds: newRoleIds,
      permissions,
      departmentIds: departmentIds.length ? departmentIds : [user.primaryDeptId || 'company'],
    });

    await options.prisma.userAccount.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.ip || null },
    });

    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: user.id, action: 'login', ip: req.ip },
    }).catch(() => undefined);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return res.json({
      ok: true,
      user: serializeAuthUser(user, roles, permissions, departmentIds, { newRoleIds }),
      token,
    });
  });

  router.post('/send-code', async (req: Request, res: Response) => {
    try {
      const { email: targetEmail, purpose } = req.body || {};
      if (!targetEmail || typeof targetEmail !== 'string') {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请提供邮箱。' });
      }
      const normalizedEmail = normalizeEmail(targetEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ ok: false, error: 'INVALID_EMAIL', message: '邮箱格式不正确。' });
      }
      const finalPurpose = purpose === 'reset_password' ? 'reset_password' : 'register';

      if (finalPurpose === 'register') {
        const existing = await options.prisma.userAccount.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
        });
        if (existing) {
          return res.status(409).json({ ok: false, error: 'DUPLICATE', message: '该邮箱已注册或正在审批中。' });
        }
      }

      const issued = verification.issueCode(normalizedEmail, finalPurpose);
      if (issued.ok === false) {
        return res.status(429).json({ ok: false, error: issued.error, message: issued.message, retryAfterMs: issued.retryAfterMs });
      }

      const message = buildVerificationEmail(issued.code, finalPurpose);
      message.to = normalizedEmail;
      try {
        await email.send(message);
      } catch (err) {
        logger.error('[send-code] email send failed', { error: err instanceof Error ? err.message : String(err) });
        if (email.isReal) {
          const detail = err instanceof Error ? err.message : String(err);
          return res.status(502).json({ ok: false, error: 'EMAIL_FAILED', message: `邮件发送失败：${detail}` });
        }
      }

      return res.json({
        ok: true,
        message: `验证码已发送至 ${normalizedEmail}，10 分钟内有效。`,
        expiresAt: issued.expiresAt.toISOString(),
        cooldownMs: issued.cooldownMs,
        transport: email.describe(),
      });
    } catch (err) {
      logger.error('[send-code] unexpected failure', { error: err instanceof Error ? err.message : String(err) });
      const detail = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: 'SEND_CODE_FAILED', message: `验证码发送服务异常：${detail}` });
    }
  });

  router.post('/register', async (req: Request, res: Response) => {
    const { email, password, displayName, requestedDepartment, code } = req.body || {};
    if (!email || !password || !displayName) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '邮箱、密码与姓名为必填项。' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: '密码至少 6 位。' });
    }
    const normalizedEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ ok: false, error: 'INVALID_EMAIL', message: '邮箱格式不正确。' });
    }

    if (options.requireEmailVerification !== false) {
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ ok: false, error: 'MISSING_CODE', message: '请输入邮箱验证码。' });
      }
      const verifyResult = verification.verifyCode(normalizedEmail, code, 'register');
      if (verifyResult.ok === false) {
        return res.status(400).json({ ok: false, error: verifyResult.error, message: verifyResult.message });
      }
    }

    const existing = await options.prisma.userAccount.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'DUPLICATE', message: '该邮箱已注册或正在审批中。' });
    }

    const passwordHash = await auth.hashPassword(password);
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const user = await options.prisma.userAccount.create({
      data: {
        id,
        displayName,
        email: normalizedEmail,
        passwordHash,
        status: 'pending',
        metadata: {
          requestedDepartment: typeof requestedDepartment === 'string' ? requestedDepartment : null,
          emailVerified: options.requireEmailVerification !== false,
          registeredAt: new Date().toISOString(),
          registeredIp: req.ip || null,
        },
      },
    });

    await options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: user.id,
        action: 'register',
        targetType: 'UserAccount',
        targetId: user.id,
        detail: { requestedDepartment: requestedDepartment || null },
        ip: req.ip,
      },
    }).catch(() => undefined);

    return res.json({
      ok: true,
      message: '注册成功，账号已提交审批，管理员通过后即可登录。',
      user: { id: user.id, email: user.email, displayName: user.displayName, status: user.status },
    });
  });

  router.get('/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    const token = req.cookies?.[COOKIE_NAME] || bearer;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    }
    try {
      const payload = auth.verifyToken(token);
      const user = await options.prisma.userAccount.findUnique({
        where: { id: payload.userId },
        include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, primaryDepartment: true },
      });
      if (!user || user.status !== 'active') {
        res.clearCookie(COOKIE_NAME, { path: '/' });
        return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Account disabled.' });
      }
      const { legacy: roles, newRoleIds } = userRolesToLegacyAgentRoles(
        user.roles.map((ur: any) => ({ roleId: ur.roleId, role: { name: ur.role?.name, isSystem: ur.role?.isSystem } })),
      );
      const permissions = collectPermissionScopes(user.roles);
      const departmentIds = user.roles.map(ur => ur.departmentId).filter(Boolean) as string[];
      return res.json({
        ok: true,
        user: serializeAuthUser(user, roles, permissions, departmentIds, { newRoleIds }),
      });
    } catch {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ ok: true });
  });

  router.patch('/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    const token = req.cookies?.[COOKIE_NAME] || bearer;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    }

    try {
      const payload = auth.verifyToken(token);
      const data: any = {};
      const { avatarUrl, displayName } = req.body || {};
      if (displayName !== undefined) {
        const nextName = String(displayName).trim();
        if (!nextName) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Display name cannot be empty.' });
        data.displayName = nextName;
      }
      if (avatarUrl !== undefined) {
        if (avatarUrl !== null && typeof avatarUrl !== 'string') {
          return res.status(400).json({ ok: false, error: 'INVALID_AVATAR', message: 'Avatar must be a data URL or null.' });
        }
        if (typeof avatarUrl === 'string') {
          if (!AVATAR_DATA_URL_RE.test(avatarUrl) || avatarUrl.length > 700_000) {
            return res.status(400).json({ ok: false, error: 'INVALID_AVATAR', message: '头像必须是 512KB 以内的图片。' });
          }
        }
        data.avatarUrl = avatarUrl;
      }

      const user = await options.prisma.userAccount.update({
        where: { id: payload.userId },
        data,
        include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, primaryDepartment: true },
      });
      const { legacy: roles, newRoleIds } = userRolesToLegacyAgentRoles(
        user.roles.map((ur: any) => ({ roleId: ur.roleId, role: { name: ur.role?.name, isSystem: ur.role?.isSystem } })),
      );
      const permissions = collectPermissionScopes(user.roles);
      const departmentIds = user.roles.map(ur => ur.departmentId).filter(Boolean) as string[];
      await options.prisma.auditLog.create({
        data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: user.id, action: 'update_profile', targetType: 'UserAccount', targetId: user.id, ip: req.ip },
      }).catch(() => undefined);
      return res.json({ ok: true, user: serializeAuthUser(user, roles, permissions, departmentIds, { newRoleIds }) });
    } catch {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  router.post('/refresh', (req: Request, res: Response) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'No token to refresh.' });
    }
    try {
      const refreshed = auth.refreshToken(token);
      res.cookie(COOKIE_NAME, refreshed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
      });
      const payload = auth.verifyToken(refreshed);
      return res.json({ ok: true, user: payload });
    } catch {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  router.post('/change-password', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    const token = req.cookies?.[COOKIE_NAME] || bearer;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: 'New password must be at least 6 characters.' });
    }
    try {
      const payload = auth.verifyToken(token);
      const user = await options.prisma.userAccount.findUnique({ where: { id: payload.userId } });
      if (!user || !user.passwordHash) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'User not found.' });
      }
      const valid = await auth.verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
      }
      const newHash = await auth.hashPassword(newPassword);
      await options.prisma.userAccount.update({ where: { id: payload.userId }, data: { passwordHash: newHash } });
      return res.json({ ok: true });
    } catch {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  return router;
}
