/**
 * Seed RBAC tables: Role, Permission, RolePermission, and Department.
 *
 * Usage（自动加载 server/.env.local 与 server/.env，也可显式传入 DATABASE_URL 覆盖）:
 *   npx tsx scripts/seed-rbac.ts
 *
 * Default owner creation is intentionally opt-in:
 *   BAMBOOK_SEED_DEFAULT_OWNER=1 npx tsx scripts/seed-rbac.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// 统一 seed 脚本环境加载约定（与 seed-demo-data-v2.ts 一致）：
// .env.local 优先，.env 兜底；显式传入的 DATABASE_URL 环境变量优先级最高（dotenv 不覆盖已有值）。
const SERVER_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env.local') });
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

const prisma = new PrismaClient();

const ROLES = [
  { name: 'owner', description: '超级管理员，拥有全部权限', isSystem: true },
  { name: 'admin', description: '系统管理员，管理用户和配置', isSystem: true },
  { name: 'manager', description: '业务经理，审批和查看全部业务数据', isSystem: true },
  { name: 'merchandiser', description: '跟单员，管理订单和生产', isSystem: true },
  { name: 'sales', description: '销售，查看客户和报价', isSystem: true },
  { name: 'finance', description: '财务，查看账款和发票', isSystem: true },
  { name: 'agent_operator', description: 'AI Agent 操作员，使用工具和知识库', isSystem: true },
  { name: 'viewer', description: '只读查看者', isSystem: true },
];

const PERMISSIONS = [
  { scope: 'users:read', description: '查看用户列表' },
  { scope: 'users:write', description: '创建/编辑用户' },
  { scope: 'users:delete', description: '删除/停用用户' },
  { scope: 'roles:read', description: '查看角色和权限' },
  { scope: 'roles:write', description: '编辑角色权限' },
  { scope: 'orders:read', description: '查看订单' },
  { scope: 'orders:write', description: '创建/编辑订单' },
  { scope: 'orders:delete', description: '删除订单' },
  { scope: 'products:read', description: '查看产品' },
  { scope: 'products:write', description: '创建/编辑产品' },
  { scope: 'relations:read', description: '查看关系人脉' },
  { scope: 'relations:write', description: '创建/编辑关系人脉' },
  { scope: 'knowledge:read', description: '查看数据中心' },
  { scope: 'knowledge:write', description: '编辑数据中心' },
  { scope: 'knowledge:admin', description: '管理数据中心权限' },
  { scope: 'tools:execute', description: '使用Agent工具' },
  { scope: 'tools:admin', description: '管理工具权限' },
  { scope: 'finance:read', description: '查看财务数据' },
  { scope: 'finance:write', description: '编辑财务数据' },
  { scope: 'ai:chat', description: '使用AI对话' },
  { scope: 'ai:agent', description: '使用AI Agent' },
  { scope: 'emails:read', description: '查看邮件' },
  { scope: 'emails:write', description: '发送邮件' },
  { scope: 'settings:read', description: '查看系统设置' },
  { scope: 'settings:write', description: '修改系统设置' },
  { scope: 'audit:read', description: '查看审计日志' },
  { scope: 'approvals:read', description: '查看审批请求' },
  { scope: 'approvals:write', description: '审批决策' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: '*', // all
  admin: ['users:read', 'users:write', 'users:delete', 'roles:read', 'roles:write', 'orders:read', 'orders:write', 'products:read', 'products:write', 'relations:read', 'relations:write', 'knowledge:read', 'knowledge:write', 'knowledge:admin', 'tools:execute', 'tools:admin', 'finance:read', 'ai:chat', 'ai:agent', 'emails:read', 'emails:write', 'settings:read', 'settings:write', 'audit:read', 'approvals:read', 'approvals:write'],
  manager: ['users:read', 'orders:read', 'orders:write', 'products:read', 'products:write', 'relations:read', 'relations:write', 'knowledge:read', 'knowledge:write', 'tools:execute', 'finance:read', 'finance:write', 'ai:chat', 'ai:agent', 'emails:read', 'emails:write', 'settings:read', 'audit:read', 'approvals:read', 'approvals:write'],
  merchandiser: ['orders:read', 'orders:write', 'products:read', 'relations:read', 'knowledge:read', 'tools:execute', 'ai:chat', 'ai:agent', 'emails:read'],
  sales: ['orders:read', 'products:read', 'relations:read', 'relations:write', 'knowledge:read', 'tools:execute', 'ai:chat', 'emails:read', 'emails:write'],
  finance: ['orders:read', 'finance:read', 'finance:write', 'knowledge:read', 'tools:execute', 'ai:chat', 'emails:read'],
  agent_operator: ['orders:read', 'products:read', 'knowledge:read', 'tools:execute', 'ai:chat', 'ai:agent'],
  viewer: ['orders:read', 'products:read', 'relations:read', 'knowledge:read', 'ai:chat'],
};

async function main() {
  console.log('Seeding RBAC tables...');

  // 1. Upsert departments
  const dept = await prisma.department.upsert({
    where: { id: 'company' },
    update: {},
    create: { id: 'company', name: 'Company', status: 'active' },
  });
  console.log('Department:', dept.id, dept.name);

  // 2. Upsert roles
  const roleMap: Record<string, string> = {};
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { id: `role_${r.name}` },
      update: { description: r.description, isSystem: r.isSystem },
      create: { id: `role_${r.name}`, name: r.name, description: r.description, isSystem: r.isSystem },
    });
    roleMap[r.name] = role.id;
    console.log('Role:', role.id, role.name);
  }

  // 3. Upsert permissions
  const permMap: Record<string, string> = {};
  for (const p of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { scope: p.scope },
      update: { description: p.description },
      create: { id: `perm_${p.scope.replace(/[:.]/g, '_')}`, scope: p.scope, description: p.description },
    });
    permMap[p.scope] = perm.id;
  }
  console.log(`Permissions: ${PERMISSIONS.length} upserted`);

  // 4. Upsert role-permission links
  let rpCount = 0;
  for (const [roleName, scopes] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;
    const effectiveScopes = scopes === '*' ? PERMISSIONS.map(p => p.scope) : scopes;
    for (const scope of effectiveScopes) {
      const permissionId = permMap[scope];
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { id: `rp_${roleId}_${permissionId}`, roleId, permissionId },
      });
      rpCount++;
    }
  }
  console.log(`RolePermissions: ${rpCount} upserted`);

  // 5. Optional bootstrap owner. Normal account data must come from the data center.
  if (process.env.BAMBOOK_SEED_DEFAULT_OWNER === '1') {
    const existingOwner = await prisma.userAccount.findFirst({
      where: { roles: { some: { roleId: roleMap['owner'] } }, deletedAt: null },
    });
    if (existingOwner) {
      console.log('Owner user already exists:', existingOwner.id, existingOwner.email);
    } else {
      const passwordHash = await bcrypt.hash('bambook2026', 12);
      const owner = await prisma.userAccount.create({
        data: {
          id: 'usr_owner_default',
          displayName: 'Admin',
          email: 'admin@bambook.local',
          passwordHash,
          status: 'active',
          primaryDeptId: 'company',
        },
      });
      await prisma.userRole.create({
        data: {
          id: `ur_${owner.id}_${roleMap['owner']}`,
          userId: owner.id,
          roleId: roleMap['owner'],
          departmentId: 'company',
        },
      });
      console.log('Created opt-in owner user:', owner.id, owner.email, '(password: bambook2026)');
    }
  } else {
    console.log('Skipped default owner user. Set BAMBOOK_SEED_DEFAULT_OWNER=1 only for explicit bootstrap.');
  }

  console.log('Done!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
