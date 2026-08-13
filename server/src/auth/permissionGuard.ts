/**
 * permissionGuard.ts — Phase 0-02 Express 权限中间件工厂
 *
 * 定位：与已有的 createModuleAuthGuard / requireAuth / requireRole 并列共存，
 *      面向新业务路由的 scope 级精细校验。旧 requireRole('owner','admin','manager')
 *      调用不做迁移（兼容策略），新代码优先使用 requirePermission。
 *
 * 核心中间件导出：
 *   1. requirePermission(scope)              — 单 scope 必选
 *      requirePermission([s1, s2, ...])      — 多个 scopes OR 关系（有一个满足即可）
 *   2. requireJwtForWriteIfHighRisk(scope)   — 可手动调用，已在 requirePermission 内自动启用
 *      （针对 :write/:delete/:approve/:admin 等写/审批类 scope，要求 JWT cookie/bearer，
 *       API key 通道仅允许只读）
 *
 * 与上游 moduleGuard 的衔接：
 *   - requirePermission 依赖 req.actor (TokenPayload) 已由上游设置
 *     → 请确保 router.use(createModuleAuthGuard({ requireAuth: true, ... })) 在前
 *     → 或 router.use(requireAuth) 在前（旧模式也可）
 *   - 若上游 requireAuth=false（dev模式）+ req.actor 不存在，则视为未登录，scope 校验失败
 *
 * 失败返回统一格式（与 moduleGuard 保持一致的 error/message 风格）：
 *   401 { error: 'UNAUTHORIZED', message: '...' } — 未登录/需 JWT 而非 API key
 *   403 { error: 'FORBIDDEN', message: 'INSUFFICIENT_SCOPE xxx:write' } — 无对应权限
 */
import { Request, Response, NextFunction } from 'express';
import type { PermissionScope } from '../_shared/rolePermissionMatrix';
import type { TokenPayload } from './service';
import {
  createPermissionService,
  ROLE_ID_TO_LEGACY_AGENT_ROLE,
} from './permissionService';
import { PrismaClient } from '@prisma/client';

type ScopeArg = PermissionScope | PermissionScope[];

// 写/审批/高危类 scope 判定（用于强制 JWT，不接受 API key）
// 命中即表示必须是 user-session JWT 身份，不能只靠 API key
const WRITE_SCOPE_SUFFIXES = [':write', ':delete', ':approve', ':admin', ':reconcile', ':lock'];
const WRITE_SCOPE_EXACT = new Set<PermissionScope>([
  'data:import',
  'data:export:full',
  'audit:export',
  'dictionary:write',
  'users:write',
  'users:admin',
  'quotations:convert',
  'knowledge:approve',
  'invoices:approve:writeoff',
  'vouchers:approve:pay_lt5',
  'vouchers:approve:pay_gt5',
  'vouchers:approve:pay_new_supplier',
  'customs:admin',
  'bom:admin',
  'risk:admin',
  'pricing:admin',
  'tax:approve',
  'emails:admin',
  'relations:admin',
  'suppliers:admin',
  'knowledge:admin',
  'reports:admin',
]);

function isWriteOrHighRiskScope(scope: string): boolean {
  for (const suf of WRITE_SCOPE_SUFFIXES) if (scope.endsWith(suf)) return true;
  return WRITE_SCOPE_EXACT.has(scope as PermissionScope);
}

// actorFromRequest: 统一从 req 取 actor，兼容 moduleGuard 写入的 (req as any).actor 和 requireAuth 写入的
function getActor(req: Request): TokenPayload | null | undefined {
  return (req as any).actor as TokenPayload | null | undefined;
}
function getAuthSource(req: Request): 'user-session' | 'api-key' | 'dev' | undefined {
  return (req as any).authSource;
}

/**
 * Express 中间件：检查请求者是否持有所需 scope。
 * 单 scope = 必须拥有；多 scopes 数组 = OR 关系拥有其中一个即可。
 *
 * 示例：
 *   router.use(requirePermission('relations:read'));                 // 所有子路由都需要读权限
 *   router.post('/', requirePermission(['relations:write', 'users:admin']), handler); // 两个scope有一个就行
 */
export function requirePermission(
  scope: ScopeArg,
  permissionService?: ReturnType<typeof createPermissionService>,
  // 注：permissionService 是可选的；仅当调用方想把服务注入时使用（否则用 in-memory fallback）。
  // 运行时 hasScope 判断主要靠 req.actor.permissions 数组（JWT 内已携带），不需要数据库。
) {
  const scopes = (Array.isArray(scope) ? scope : [scope]) as PermissionScope[];
  const hasWriteRisk = scopes.some((s) => isWriteOrHighRiskScope(s));

  return (req: Request, res: Response, next: NextFunction) => {
    const actor = getActor(req);
    const authSource = getAuthSource(req);

    // 1) 基本身份：必须已有 actor（由上游 requireAuth / createModuleAuthGuard(requireAuth=true) 保证）
    if (!actor) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Login (JWT cookie or Bearer) required before scope check.',
      });
    }

    // 2) 写/审批类 scope → 必须 JWT (authSource='user-session')，不能只靠 API key
    if (hasWriteRisk) {
      if (authSource === 'api-key') {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: `Write/approve scope ${scopes.join('|')} requires JWT user session (API key insufficient).`,
        });
      }
      // dev actor 模式也允许（本地 requireAuth=false 时用）
    }

    // 3) scope 校验：优先走 actor.permissions（JWT 携带），fallback 通过 legacy roleId 映射走 rolePermissionMatrix 默认矩阵
    const hasAny = scopes.some((s) => actorHasScope(actor, s));
    if (hasAny) return next();

    return res.status(403).json({
      error: 'FORBIDDEN',
      message: `INSUFFICIENT_SCOPE: need one of [${scopes.join(', ')}].`,
    });
  };
}

/**
 * 判断单个 scope 是否在 JWT actor 权限里（纯函数，不查 DB；依赖 JWT.permissions 数组 + 映射 fallback）。
 * 从 permissionService.hasScope 复制过来但避免了对 PrismaClient 的依赖，因为这个守卫在运行时走 hot path。
 */
function actorHasScope(actor: TokenPayload, scope: PermissionScope): boolean {
  if (!actor) return false;
  // 1) JWT.permissions 数组直查
  if (actor.permissions?.includes(scope)) return true;
  // 2) SuperAdmin legacy code → owner
  if (actor.roles?.includes('owner' as any)) return true;
  if (actor.roles?.includes('role-super-admin' as any)) return true;
  // 3) 映射回新 roleId，走 fallbackHasPermission 需要真正的 import — 这里因为守卫要轻量，
  //    用 permissionService 的内部实现复用：我们通过 import 直接调。
  //    但是为了避免循环依赖，用 hasPermissionFallbackInline：
  return inlineFallbackHasScope(actor, scope);
}

// Inline copy of key fallback logic (keeps middleware light, no cross-file deep call chains needed
// at runtime — since TS already compiles this to JS, duplication is minimal and hot-path fast.)
import {
  SYSTEM_ROLE_IDS,
  DEFAULT_ROLE_PERMISSION_MATRIX,
  hasPermission as fallbackFromLib,
} from '../_shared/rolePermissionMatrix';
function inlineFallbackHasScope(actor: TokenPayload, scope: PermissionScope): boolean {
  // legacy roles → new role ids map (copied small subset here for hot-path speed;
  // source of truth is still permissionService.ts's LEGACY_TO_ROLE_ID)
  const LEGACY_TO_ROLE_ID: Record<string, string[]> = {
    owner: [SYSTEM_ROLE_IDS.SUPER_ADMIN],
    admin: [SYSTEM_ROLE_IDS.ADMIN],
    manager: [SYSTEM_ROLE_IDS.SALES_MANAGER],
    finance: [SYSTEM_ROLE_IDS.FINANCE, SYSTEM_ROLE_IDS.FINANCE_MANAGER],
    sales: [SYSTEM_ROLE_IDS.SALES],
    merchandiser: [SYSTEM_ROLE_IDS.SALES],
    logistics: [SYSTEM_ROLE_IDS.SALES],
    production_manager: [SYSTEM_ROLE_IDS.SALES_MANAGER],
    factory: [SYSTEM_ROLE_IDS.SALES],
    viewer: [SYSTEM_ROLE_IDS.SALES],
  };
  const roleIds: string[] = [];
  for (const r of actor.roles || []) {
    const mapped = LEGACY_TO_ROLE_ID[r as string];
    if (mapped) roleIds.push(...mapped);
  }
  return fallbackFromLib(roleIds, scope, null);
}

/**
 * 向后兼容工具：把新 roleId 列表映射成旧 AgentRole 字符串列表（供登录时写入 JWT.roles[]）。
 * 从 permissionService 再导出一份，避免路由文件需要 import 两个模块。
 */
export { ROLE_ID_TO_LEGACY_AGENT_ROLE as roleIdToLegacyAgentRole };

/**
 * 可选：手工检查中间件（不调用 next 继续，直接调用 hasScope 返回布尔给 handler 内部做 if 判断）。
 * 示例：
 *   const canApprove = hasScopeOnRequest(req, 'shipments:approve');
 */
export function hasScopeOnRequest(req: Request, scope: PermissionScope): boolean {
  const actor = getActor(req);
  if (!actor) return false;
  return actorHasScope(actor, scope);
}
