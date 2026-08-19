/**
 * permissionService.ts — Phase 0-02 权限服务层（不含 Express 中间件，纯函数+Prisma 查询）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 消费方：
 *   1. auth/route.ts 登录 — getUserPermissionContext → 写入 JWT（scopes 放进 permissions[]，
 *      legacyRoleCodes 放进 roles[] 保证旧 requireRole('owner','admin') 68 处调用持续可用）
 *   2. auth/route.ts GET /permissions — 前端拉取完整上下文
 *   3. permissionGuard.ts (requirePermission 中间件) — hasScope() 实时判断
 *   4. 各业务路由 handler — getDataScopeResolver() 拼 Prisma where 实现 PL-2B 行级过滤
 *   5. 各业务路由 handler — stripSensitive() 输出前遮罩成本/利润/佣金等敏感字段
 * ═══════════════════════════════════════════════════════════════════
 *
 * 向后兼容说明：
 *   - 旧系统用 AgentRole = 'owner'|'admin'|'manager'|'finance'|'sales'|... 字符串
 *   - 新系统用 SYSTEM_ROLE_IDS = 'role-super-admin'|...（8 角色，DR-041 起含 QC/后勤）
 *   - ROLE_ID_TO_LEGACY_AGENT_ROLE 表把新 8 ID 映射到旧字符串，
 *     JWT roles[] 中依旧写旧字符串，不破坏 68 处 requireRole()/roles.some() 调用。
 *   - 以后可逐步把旧 HIGH_RISK_ROLES: AgentRole[] = ['owner','admin','manager']
 *     迁移到 requirePermission('xxx:write') 基于 scope 的更精确校验。
 */
import type { PrismaClient } from '@prisma/client';
import type { AgentRole } from '../agent/types';
import type { TokenPayload } from './service';

// 单一权威真源从 server/src/_shared/rolePermissionMatrix.ts 引用（与 seed 脚本 & 前端共用同一文件内容，
// 通过快照副本绕过 tsconfig rootDir 限制；权威源仍为根 lib/rolePermissionMatrix.ts）
import {
  SYSTEM_ROLE_IDS,
  type PermissionScope,
  type DataScopeRule,
  type SensitiveFieldScope,
  hasPermission as fallbackHasPermission,
  getDataScopeRule,
  canViewSensitive as fallbackCanViewSensitive,
} from '../_shared/rolePermissionMatrix';

// v2.1（DR-042 §5.1）：department 行级规则保留原部门维解析的模块白名单。
// 人事编制域的部门维视野有独立业务意义（主管看本部门员工档案/考勤/编制），
// 不随业务数据域「组为主、部门退出」的口径切换收敛。
const DEPT_SCOPE_EXEMPT_MODULES = new Set(['hr']);

// ───────────────────────────────────────────────────────────────────
// 新 8 角色 ID → 旧 AgentRole 字符串（向后兼容映射，保持旧 HIGH_RISK_ROLES 判断有效）
//   旧语义：owner=最高权限  admin=系统管理员  manager=业务审批/经理级  finance=财务
//   新→旧映射原则：保持 68 处调用的语义不变（HIGH_RISK 路由不能被 sales 直接写）
//   DR-041：QC → viewer（质检写权限走新 scope qc:write，legacy 层不给任何写路由通过）
//           LOGISTICS → logistics（legacy logistics 不在任何 HIGH_RISK 组，写权限走新 scope）
// ───────────────────────────────────────────────────────────────────
export const ROLE_ID_TO_LEGACY_AGENT_ROLE: Record<string, AgentRole> = {
  [SYSTEM_ROLE_IDS.SUPER_ADMIN]: 'owner',       // 最高 → owner（所有 HIGH_RISK 组都包含 owner ✓）
  [SYSTEM_ROLE_IDS.ADMIN]: 'admin',             // 系统管理员 → admin（owner/admin 类路由通过 ✓）
  [SYSTEM_ROLE_IDS.SALES_MANAGER]: 'manager',   // 销售主管 → manager（业务写审批路由用 ['owner','admin','manager'] ✓）
  [SYSTEM_ROLE_IDS.FINANCE_MANAGER]: 'finance', // 财务主管 → finance（finance 模块 HIGH_RISK 含 finance ✓）
  [SYSTEM_ROLE_IDS.FINANCE]: 'finance',         // 普通财务 → finance（同模块 HIGH_RISK 通过 ✓）
  [SYSTEM_ROLE_IDS.SALES]: 'sales',             // 业务员 → sales（写路由 HIGH_RISK 不含 sales → 保持被拒 ✓）
  [SYSTEM_ROLE_IDS.QC]: 'viewer',               // QC → viewer（legacy 层只读；qc:write 走新 scope 链 ✓）
  [SYSTEM_ROLE_IDS.LOGISTICS]: 'logistics',     // 后勤 → logistics（legacy 层非 HIGH_RISK；shipments:write 走新 scope 链 ✓）
};

// ───────────────────────────────────────────────────────────────────
// 类型定义
// ───────────────────────────────────────────────────────────────────
export interface UserPermissionContext {
  userId: string;
  /** 新系统角色 ID（SYSTEM_ROLE_IDS 值，8 枚举之一或更多） */
  roleIds: string[];
  /** 旧 AgentRole 字符串（用于写入 JWT roles[] 向后兼容 requireRole('owner', ...)） */
  legacyRoleCodes: AgentRole[];
  /** 所有权限 scope（DB 聚合）— 直接给 JWT/前端，hasScope 优先走这个集合 */
  scopes: string[];
  /** 用户分配的部门 ID（来自 UserRole.departmentId） */
  departmentIds: string[];
  /** 主部门 */
  primaryDeptId?: string | null;
  /** 扁平化：部门 + 所有子部门后代 ID（SalesManager 含 includeDescendantDepartments=true 时需要） */
  departmentSubtreeIds: string[];
}

type ScopeArg = PermissionScope | PermissionScope[];

export interface PermissionServiceOptions {
  prisma: PrismaClient;
}

// ───────────────────────────────────────────────────────────────────
// 敏感字段遮罩常量（根据字段类型决定遮罩策略）
// ───────────────────────────────────────────────────────────────────
const SENSITIVE_MASK_STRING = '****';
const SENSITIVE_MASK_NUMBER = null as unknown as number; // 数字用 null，前端再决定是否渲染为 "****"

// ───────────────────────────────────────────────────────────────────
// 服务工厂（依赖注入 PrismaClient，与业务路由一致风格）
// ───────────────────────────────────────────────────────────────────
export function createPermissionService(opts: PermissionServiceOptions) {
  const { prisma } = opts;

  // ══════════════════════════════════════════════════════════════════
  // 0. 内部辅助：递归取 dept 子树（BFS 迭代，避免 PG 递归 CTE 复杂度）
  // ══════════════════════════════════════════════════════════════════
  async function collectSubtreeDeptIds(rootIds: string[]): Promise<string[]> {
    if (rootIds.length === 0) return [];
    const seen = new Set<string>(rootIds);
    let frontier = Array.from(rootIds);
    // 最大深度 8（组织架构树正常 <5 层；避免脏数据死循环）
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const children = await prisma.department.findMany({
        where: { parentId: { in: frontier }, status: 'active' },
        select: { id: true },
      });
      frontier = [];
      for (const c of children) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          frontier.push(c.id);
        }
      }
    }
    return Array.from(seen);
  }

  // ══════════════════════════════════════════════════════════════════
  // 1. 从 DB 加载用户完整权限上下文
  //    调用时机：登录、刷新权限、GET /api/auth/permissions
  // ══════════════════════════════════════════════════════════════════
  async function getUserPermissionContext(userId: string): Promise<UserPermissionContext | null> {
    const user = await prisma.userAccount.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        primaryDeptId: true,
        status: true,
        roles: {
          where: { role: { isSystem: true } },
          select: {
            departmentId: true,
            role: {
              select: {
                id: true,
                permissions: { select: { permission: { select: { scope: true } } } },
              },
            },
          },
        },
      },
    });
    if (!user || user.status === 'disabled' || user.status === 'rejected') return null;

    const roleIds: string[] = [];
    const scopes = new Set<string>();
    const directDeptIds = new Set<string>([user.primaryDeptId].filter(Boolean) as string[]);

    for (const ur of user.roles) {
      roleIds.push(ur.role.id);
      if (ur.departmentId) directDeptIds.add(ur.departmentId);
      for (const rp of ur.role.permissions) {
        const scope = rp.permission.scope;
        if (scope) scopes.add(scope);
      }
    }

    // 个人权限覆盖通道（Phase 1 DR-007 扩展）：UserPermissionOverrides 中
    // active + 未软删 + 未过期（expiresAt 为空或将来）的 scope 并入聚合结果。
    // 适用场景：临时授权（如 hr:salary:read 授予指定 HR）、跨角色特批，不改动角色矩阵。
    const overrides = await prisma.userPermissionOverrides.findMany({
      where: {
        userId,
        isActive: true,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { scope: true },
    });
    for (const o of overrides) {
      if (o.scope) scopes.add(o.scope);
    }

    // SuperAdmin 安全网：即使 DB 中 scope 缺失，也补齐全部 scope（避免 seed 未完整跑导致全权限用户被意外拦截）
    if (roleIds.includes(SYSTEM_ROLE_IDS.SUPER_ADMIN)) {
      // fallbackHasPermission 对 SuperAdmin 直接放行，所以这里不用手动枚举 scopes，保持 DB 结果即可
      // （不影响守卫判断）
    }

    const legacyRoleCodes = dedupe(
      roleIds.map((id) => ROLE_ID_TO_LEGACY_AGENT_ROLE[id]).filter(Boolean) as AgentRole[],
    );

    const departmentIds = Array.from(directDeptIds);
    const departmentSubtreeIds = await collectSubtreeDeptIds(departmentIds);

    return {
      userId: user.id,
      roleIds,
      legacyRoleCodes,
      scopes: Array.from(scopes).sort(),
      departmentIds,
      primaryDeptId: user.primaryDeptId,
      departmentSubtreeIds,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. Scope 判断（运行时；JWT 中已有 permissions，避免每次查DB）
  // ══════════════════════════════════════════════════════════════════
  function hasScope(actor: TokenPayload | null | undefined, scope: PermissionScope): boolean {
    if (!actor) return false;
    // 2a. JWT scopes 集合优先（登录时已从 DB 聚合）— O(1) Set.has 性能
    if (actor.permissions && actor.permissions.length > 0) {
      const actorSet = new Set(actor.permissions);
      if (actorSet.has(scope)) return true;
    }
    // 2b. SuperAdmin 特判：roles 中含 legacy 'owner' 字符串（向后兼容）
    //     或包含 SYSTEM_ROLE_IDS.SUPER_ADMIN （如以后 JWT 同时写两种）
    if (actor.roles && actor.roles.length > 0) {
      if (actor.roles.includes('owner' as AgentRole)) return true;
      if (actor.roles.includes(SYSTEM_ROLE_IDS.SUPER_ADMIN as unknown as AgentRole)) return true;
    }
    // 2c. Fallback：根据 roleId 代码级默认矩阵判断（hasPermission 接收 legacy AgentRole 无法直接映射到新矩阵 key，
    //    所以需要 LEGACY_TO_ROLE_ID 反向映射）
    const roleIdsFromLegacy = (actor.roles || [])
      .flatMap((r) => LEGACY_TO_ROLE_ID[r as string] || []) as string[];
    return fallbackHasPermission(roleIdsFromLegacy, scope);
  }

  function hasAnyScope(actor: TokenPayload | null | undefined, scopes: PermissionScope[]): boolean {
    if (!scopes || scopes.length === 0) return true;
    return scopes.some((s) => hasScope(actor, s));
  }

  function ensureScope(actor: TokenPayload | null | undefined, scopeArg: ScopeArg): void {
    const scopes = (Array.isArray(scopeArg) ? scopeArg : [scopeArg]) as PermissionScope[];
    if (!hasAnyScope(actor, scopes)) {
      const err = new Error(`FORBIDDEN: 缺少权限 ${scopes.join('|')}`);
      (err as any).code = 'INSUFFICIENT_PERMISSION';
      (err as any).status = 403;
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. 行级数据范围解析器（返回给调用方拼 Prisma where）
  //    PL-2B：同部门可见/跨部门隔离
  // ══════════════════════════════════════════════════════════════════
  interface DataScopeResolver {
    rule: DataScopeRule;
    /** 允许的部门 ID（含子部门）— 用于有 direct departmentId FK 的实体过滤 */
    allowedDepartmentIds?: string[];
    /** 允许的用户 ID（部门内所有员工 id）— 用于 createdBy/salesPersonId/ownerId 等 creator 字段过滤 */
    allowedUserIds?: string[];
  }

  async function getDataScopeResolver(
    actor: TokenPayload | null | undefined,
    moduleName: string,
  ): Promise<DataScopeResolver> {
    if (!actor) {
      return { rule: { kind: 'self' }, allowedDepartmentIds: [], allowedUserIds: [] };
    }
    // 从 legacy roles → 新 roleId → 默认行级规则
    const roleIdsFromLegacy = (actor.roles || [])
      .flatMap((r) => LEGACY_TO_ROLE_ID[r as string] || []) as string[];
    // 以最高权限角色的 rule 为准（SuperAdmin=all 优先）— 取第一个非 self 的角色
    let rule: DataScopeRule = { kind: 'self' };
    if (roleIdsFromLegacy.includes(SYSTEM_ROLE_IDS.SUPER_ADMIN)) {
      rule = { kind: 'all' };
    } else {
      for (const rid of roleIdsFromLegacy) {
        const r = getDataScopeRule(rid, moduleName);
        if (r.kind === 'all') { rule = r; break; }
        if (r.kind !== 'self') rule = r; // 取第一个非 self 的更宽规则
      }
    }

    if (rule.kind === 'all') {
      return { rule }; // 无过滤 = 全可见
    }

    // v2.1（DR-042 §5.1 组为主）：业务数据模块的 department 规则统一按本人维解析——
    // 协作维度由小组（TeamDataGrant ∪ 本人）承载，部门退出数据权限计算
    // （保留目录展示 + DR-007 审批链用途）。人事编制域（hr）的部门维视野有独立
    // 业务意义（主管看本部门员工档案/考勤），保留原 department 解析。
    if (rule.kind === 'department' && !DEPT_SCOPE_EXEMPT_MODULES.has(moduleName)) {
      return { rule: { kind: 'self' }, allowedUserIds: [actor.userId] };
    }

    if (rule.kind === 'self') {
      return { rule, allowedUserIds: [actor.userId] };
    }

    // department（可能含子部门）
    let deptIds = actor.departmentIds || [];
    if (rule.kind === 'department' && rule.includeDescendantDepartments && deptIds.length > 0) {
      deptIds = await collectSubtreeDeptIds(Array.from(new Set(deptIds)));
    }
    // 然后查这些部门的 userId（active 状态）
    const usersInDept = deptIds.length > 0
      ? await prisma.userAccount.findMany({
          where: { deletedAt: null, status: 'active', primaryDeptId: { in: deptIds } },
          select: { id: true },
        })
      : [];
    const allowedUserIds = usersInDept.map((u) => u.id);
    if (rule.kind === 'department' && rule.own && !allowedUserIds.includes(actor.userId)) {
      allowedUserIds.push(actor.userId);
    }
    return {
      rule,
      allowedDepartmentIds: deptIds,
      allowedUserIds,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. 敏感字段遮罩（读接口返回前调用）
  //    - 字符串字段：显示 "****"
  //    - 数字字段：null（前端可根据 null 渲染 "****" 或隐藏数字）
  //    - 对象/数组字段：null
  // ══════════════════════════════════════════════════════════════════
  function stripSensitive<T extends Record<string, any>>(
    entity: T,
    sensitiveMap: Partial<Record<keyof T, SensitiveFieldScope>>,
    actor: TokenPayload | null | undefined,
  ): T {
    if (!entity) return entity;
    // SuperAdmin / owner legacy 角色全放行
    if (actor?.roles && (actor.roles.includes('owner' as AgentRole) || actor.roles.includes(SYSTEM_ROLE_IDS.SUPER_ADMIN as any))) {
      return { ...entity };
    }
    const copy: Record<string, any> = { ...entity };
    const keys = Object.keys(sensitiveMap) as (keyof T & string)[];
    for (const k of keys) {
      const scopeName = sensitiveMap[k];
      if (!scopeName) continue;
      const visible = canViewSensitiveField(actor, scopeName);
      if (!visible && copy[k] !== undefined && copy[k] !== null) {
        const v = copy[k];
        if (typeof v === 'string') copy[k] = SENSITIVE_MASK_STRING;
        else if (typeof v === 'number') copy[k] = SENSITIVE_MASK_NUMBER;
        else copy[k] = null; // object/array/bigint → null
      }
    }
    return copy as T;
  }

  function stripSensitiveMany<T extends Record<string, any>>(
    list: T[],
    sensitiveMap: Partial<Record<keyof T, SensitiveFieldScope>>,
    actor: TokenPayload | null | undefined,
  ): T[] {
    return list.map((x) => stripSensitive(x, sensitiveMap, actor));
  }

  function canViewSensitiveField(
    actor: TokenPayload | null | undefined,
    field: SensitiveFieldScope,
  ): boolean {
    if (!actor) return false;
    // SuperAdmin legacy → owner
    if (actor.roles?.includes('owner' as AgentRole)) return true;
    // scope 判断
    const scopeName = `sensitive:${field}` as PermissionScope;
    if (actor.permissions?.includes(scopeName)) return true;
    // fallback 矩阵
    const roleIdsFromLegacy = (actor.roles || [])
      .flatMap((r) => LEGACY_TO_ROLE_ID[r as string] || []) as string[];
    return fallbackCanViewSensitive(roleIdsFromLegacy, field);
  }

  return {
    getUserPermissionContext,
    hasScope,
    hasAnyScope,
    ensureScope,
    getDataScopeResolver,
    stripSensitive,
    stripSensitiveMany,
    canViewSensitiveField,
    // Internal (exposed for testing)
    _internal_collectSubtreeDeptIds: collectSubtreeDeptIds,
  };
}

// ───────────────────────────────────────────────────────────────────
// 反向映射：legacy AgentRole string → 新 SYSTEM_ROLE_IDS（用于 hasScope fallback）
// 一个 legacy code 可能对应多个新 role ID（如 finance 对应 FINANCE 和 FINANCE_MANAGER）
// ───────────────────────────────────────────────────────────────────
const LEGACY_TO_ROLE_ID: Record<string, string[]> = {
  owner: [SYSTEM_ROLE_IDS.SUPER_ADMIN],
  admin: [SYSTEM_ROLE_IDS.ADMIN],
  manager: [SYSTEM_ROLE_IDS.SALES_MANAGER],
  finance: [SYSTEM_ROLE_IDS.FINANCE, SYSTEM_ROLE_IDS.FINANCE_MANAGER],
  sales: [SYSTEM_ROLE_IDS.SALES],
  // 剩余 legacy roles（生产中不常用）作为 sales 的降级语义，避免老 JWT 被意外拦截
  merchandiser: [SYSTEM_ROLE_IDS.SALES],
  logistics: [SYSTEM_ROLE_IDS.SALES],
  production_manager: [SYSTEM_ROLE_IDS.SALES_MANAGER],
  factory: [SYSTEM_ROLE_IDS.SALES],
  viewer: [SYSTEM_ROLE_IDS.SALES],
};

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
