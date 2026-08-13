/**
 * Seed RBAC 核心表（Phase 0-01 闭环脚本）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 单一权威真源：lib/rolePermissionMatrix.ts（根目录，与 seed-rbac 同仓库版本）
 *   - 6 系统内置角色定义：SYSTEM_ROLE_IDS / SYSTEM_ROLE_META
 *   - 85+ 权限 scope：PERMISSION_SCOPES（经营总览/客户市场/订单履约/财务成本/平台域/敏感字段）
 *   - 6×85 角色权限矩阵：DEFAULT_ROLE_PERMISSION_MATRIX
 *   - 行级数据范围规则：DEFAULT_DATA_SCOPE_BY_ROLE（运行时用，DB 仅 seed 部门树）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 幂等策略：
 *   - Department / Role / Permission / RolePermission / UserRole 全部 upsert
 *   - 老版本 8 角色（owner/admin/manager/merchandiser/sales/finance/agent_operator/viewer）
 *     先在一个事务里清理（删除关联 RolePermission → 删除 UserRole → 删除 Role），
 *     避免新旧角色并存造成 UI 混乱。
 *
 * 用法（与旧脚本保持一致的命令签名）：
 *   cd server
 *   npx tsx scripts/seed-rbac.ts                         # 仅 RBAC 表（安全，默认不建账号）
 *   BAMBOOK_SEED_SUPER_ADMIN=1 npx tsx scripts/seed-rbac.ts  # 同时初始化默认 SuperAdmin 账号（一次性引导）
 *
 * 可选环境变量：
 *   DATABASE_URL              — 显式覆盖 DB 连接；否则按 .env.local → .env 顺序加载
 *   BAMBOOK_SEED_SUPER_ADMIN  — =1 时创建默认 SuperAdmin 账号（admin@bambook.local / bambook2026）
 */
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// ─── 单一真源导入（从 server/scripts/ 向上两级到根，再进入 lib/）─────────────
import {
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLE_META,
  PERMISSION_SCOPES,
  getDefaultScopeListForRole,
} from '../../lib/rolePermissionMatrix';

// ─── 环境加载（.env.local 高优先级）──────────────────────────────────────────
const SERVER_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env.local') });
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════════════════════
// 0. 旧版本 8 个遗留角色清理（避免与新 6 角色并存）
//    旧 ID 格式：role_owner / role_admin / role_manager / role_merchandiser /
//                role_sales / role_finance / role_agent_operator / role_viewer
// ══════════════════════════════════════════════════════════════════════════════
const LEGACY_ROLE_IDS = [
  'role_owner',
  'role_admin',
  'role_manager',
  'role_merchandiser',
  'role_sales',
  'role_finance',
  'role_agent_operator',
  'role_viewer',
];

async function cleanupLegacyRoles() {
  const affected = await prisma.role.findMany({
    where: { id: { in: LEGACY_ROLE_IDS } },
    select: { id: true, name: true },
  });
  if (affected.length === 0) {
    console.log('[0/6] 遗留角色：DB 中未发现旧 8 角色，跳过清理');
    return;
  }
  const ids = affected.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    // 顺序：RolePermission → UserRole → Role
    await tx.rolePermission.deleteMany({ where: { roleId: { in: ids } } });
    await tx.userRole.deleteMany({ where: { roleId: { in: ids } } });
    await tx.role.deleteMany({ where: { id: { in: ids } } });
  });
  console.log(`[0/6] 遗留角色：已清理 ${ids.length} 个 → ${affected.map((r) => r.name).join('、')}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 默认部门树（4 业务部门 + 1 根公司）
//    行级范围规则 PL-2B（同部门可见、跨部门隔离）依赖部门 ID 存在。
// ══════════════════════════════════════════════════════════════════════════════
interface DeptSeed {
  id: string;
  name: string;
  parentId?: string;
}
const DEFAULT_DEPARTMENTS: DeptSeed[] = [
  { id: 'dept-company', name: '总公司' },
  { id: 'dept-sales', name: '销售部', parentId: 'dept-company' },
  { id: 'dept-finance', name: '财务部', parentId: 'dept-company' },
  { id: 'dept-admin', name: '行政人事部', parentId: 'dept-company' },
  { id: 'dept-management', name: '总经办', parentId: 'dept-company' },
];

async function seedDepartments() {
  for (const d of DEFAULT_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { id: d.id },
      update: { name: d.name, parentId: d.parentId ?? null, status: 'active' },
      create: { id: d.id, name: d.name, parentId: d.parentId ?? null, status: 'active' },
    });
  }
  console.log(`[1/6] 部门：已 upsert ${DEFAULT_DEPARTMENTS.length} 个（根=总公司，下设销售/财务/行政人事/总经办）`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 6 系统内置角色（不可删除，isSystem=true）
// ══════════════════════════════════════════════════════════════════════════════
async function seedRoles() {
  const roleIds: string[] = [];
  for (const id of Object.values(SYSTEM_ROLE_IDS)) {
    const meta = SYSTEM_ROLE_META[id];
    await prisma.role.upsert({
      where: { id },
      update: { name: meta.name, description: meta.description, isSystem: true },
      create: { id, name: meta.name, description: meta.description, isSystem: true },
    });
    roleIds.push(id);
  }
  console.log(`[2/6] 角色：已 upsert 6 个 → ${roleIds.map((id) => `${SYSTEM_ROLE_META[id].name}(${id})`).join('、')}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 85+ 权限 scope（来自 PERMISSION_SCOPES）
// ══════════════════════════════════════════════════════════════════════════════
async function seedPermissions() {
  const scopes = Object.keys(PERMISSION_SCOPES);
  let count = 0;
  for (const scope of scopes) {
    const description = PERMISSION_SCOPES[scope as keyof typeof PERMISSION_SCOPES];
    // Permission.id 生成规则：perm_<scope 中 : 替换为 _>
    const id = `perm_${scope.replace(/[:./]/g, '_')}`;
    // 先查一次：如果按 scope 命中但 id 不匹配（历史遗留规则），先删再建，避免 Prisma "update 中改主键" 报错
    const existing = await prisma.permission.findUnique({ where: { scope }, select: { id: true } });
    if (existing && existing.id !== id) {
      await prisma.rolePermission.deleteMany({ where: { permissionId: existing.id } });
      await prisma.permission.delete({ where: { id: existing.id } });
    }
    await prisma.permission.upsert({
      where: { scope },
      update: { description },
      create: { id, scope, description },
    });
    count++;
  }
  // 顺手删除不在 PERMISSION_SCOPES 里的遗留 Permission（先查再删，避免误删外部扩展 scope）
  const stalePerms = await prisma.permission.findMany({
    where: { scope: { notIn: scopes } },
    select: { id: true, scope: true },
  });
  if (stalePerms.length > 0) {
    // 仅清理 id 形如 perm_*（我们生成的），非系统自定义的保留
    const toDelete = stalePerms.filter((p) => p.id.startsWith('perm_')).map((p) => p.id);
    if (toDelete.length > 0) {
      await prisma.rolePermission.deleteMany({ where: { permissionId: { in: toDelete } } });
      await prisma.permission.deleteMany({ where: { id: { in: toDelete } } });
      console.log(`[3/6] 权限：已 upsert ${count} 个；清理遗留 scope ${toDelete.length} 个`);
      return;
    }
  }
  console.log(`[3/6] 权限：已 upsert ${count} 个`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. RolePermission 关联（按 getDefaultScopeListForRole 展开）
//    SuperAdmin 特殊：DB 中也存入全部 scope，避免守卫 fallback 分支特判有bug
// ══════════════════════════════════════════════════════════════════════════════
async function seedRolePermissions() {
  // 先把 scope → permission.id 建好反向映射
  const allPerms = await prisma.permission.findMany({ select: { id: true, scope: true } });
  const scopeToPermId = new Map(allPerms.map((p) => [p.scope, p.id]));

  let total = 0;
  for (const roleId of Object.values(SYSTEM_ROLE_IDS)) {
    const scopes = getDefaultScopeListForRole(roleId);
    let linked = 0;
    for (const scope of scopes) {
      const permissionId = scopeToPermId.get(scope);
      if (!permissionId) {
        console.warn(`  ⚠  角色 ${roleId} 需要 scope=${scope}，但 Permission 表中未找到，跳过`);
        continue;
      }
      const rpId = `rp_${roleId.replace(/-/g, '_')}__${permissionId}`;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { id: rpId, roleId, permissionId },
      });
      linked++;
    }
    total += linked;
    console.log(`  · ${SYSTEM_ROLE_META[roleId].name}（${roleId}）：${linked} 个权限关联`);
  }
  console.log(`[4/6] 角色权限关联：共 ${total} 条 RolePermission`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. （可选）默认 SuperAdmin 账号初始化
//    仅当 BAMBOOK_SEED_SUPER_ADMIN=1 时执行；若已存在任何 SuperAdmin 用户则跳过。
// ══════════════════════════════════════════════════════════════════════════════
async function seedDefaultSuperAdmin() {
  if (process.env.BAMBOOK_SEED_SUPER_ADMIN !== '1') {
    console.log('[5/6] 默认账号：未设置 BAMBOOK_SEED_SUPER_ADMIN=1，跳过 SuperAdmin 引导');
    return;
  }
  const existingSuperAdmin = await prisma.userAccount.findFirst({
    where: {
      deletedAt: null,
      roles: { some: { roleId: SYSTEM_ROLE_IDS.SUPER_ADMIN } },
    },
    select: { id: true, email: true, displayName: true },
  });
  if (existingSuperAdmin) {
    console.log(
      `[5/6] 默认账号：已存在 SuperAdmin → ${existingSuperAdmin.displayName} (${existingSuperAdmin.email ?? '无邮箱'})，跳过创建`,
    );
    return;
  }
  const passwordHash = await bcrypt.hash('bambook2026', 12);
  const userId = 'usr_super_admin_default';
  await prisma.$transaction(async (tx) => {
    await tx.userAccount.upsert({
      where: { id: userId },
      update: {
        displayName: '超级管理员',
        email: 'admin@bambook.local',
        passwordHash,
        status: 'active',
        primaryDeptId: 'dept-company',
      },
      create: {
        id: userId,
        displayName: '超级管理员',
        email: 'admin@bambook.local',
        passwordHash,
        status: 'active',
        primaryDeptId: 'dept-company',
      },
    });
    await tx.userRole.upsert({
      where: {
        userId_roleId_departmentId: {
          userId,
          roleId: SYSTEM_ROLE_IDS.SUPER_ADMIN,
          departmentId: 'dept-company',
        },
      },
      update: {},
      create: {
        id: `ur_${userId}_${SYSTEM_ROLE_IDS.SUPER_ADMIN}`,
        userId,
        roleId: SYSTEM_ROLE_IDS.SUPER_ADMIN,
        departmentId: 'dept-company',
      },
    });
  });
  console.log(
    '[5/6] 默认账号：已创建 SuperAdmin → admin@bambook.local / bambook2026 （请在首次登录后立即修改密码）',
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. 校验：生成一行摘要统计，确认 seed 结果非空
// ══════════════════════════════════════════════════════════════════════════════
async function verifySeed() {
  const [roleCount, permCount, rpCount, deptCount] = await Promise.all([
    prisma.role.count(),
    prisma.permission.count(),
    prisma.rolePermission.count(),
    prisma.department.count(),
  ]);
  console.log(
    `[6/6] 校验摘要：Role=${roleCount}(≥6)  Permission=${permCount}(≥${Object.keys(PERMISSION_SCOPES).length})  RolePermission=${rpCount}(≥200)  Department=${deptCount}(≥5)`,
  );
  if (roleCount < 6 || permCount < Object.keys(PERMISSION_SCOPES).length) {
    throw new Error('seed-rbac 校验失败：实际数量少于预期，请检查 rollback。');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  console.log(`\n═══ seed-rbac（Phase 0-01）启动 @ ${now} ═══`);
  console.log(`真源：lib/rolePermissionMatrix.ts  ·  权限 scope 数：${Object.keys(PERMISSION_SCOPES).length}`);

  await cleanupLegacyRoles();
  await seedDepartments();
  await seedRoles();
  await seedPermissions();
  await seedRolePermissions();
  await seedDefaultSuperAdmin();
  await verifySeed();

  console.log('══════════════════════ 完成 ══════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ seed-rbac 失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
