/**
 * rolePermissionMatrix.test.ts — DR-041 QC/后勤角色容器内置回归测试
 *
 * 锁定契约：
 *   1. 8 个系统内置角色（含 QC/后勤）在 SYSTEM_ROLE_META / DEFAULT_ROLE_PERMISSION_MATRIX /
 *      DEFAULT_DATA_SCOPE_BY_ROLE 三处注册完整
 *   2. QC_BASE / LOGISTICS_BASE 引用的 scope 全部存在于 PERMISSION_SCOPES（否则 seed 静默跳过）
 *   3. ROLE_ID_TO_LEGACY_AGENT_ROLE 覆盖全部 8 个系统角色（登录写 JWT legacy roles 链路闭合）
 *   4. SYSTEM_ROLE_META 描述无 "≤5万 / >5万" 阈值残留（审批阈值分级已废止，统一走审批策略）
 *   5. 双文件逐字同步守卫（GAP-R2）：根 lib/rolePermissionMatrix.ts 与
 *      server/src/_shared/rolePermissionMatrix.ts 自 SYSTEM_ROLE_IDS 定义起至文件末尾逐字一致
 *      —— 此前发生过副本漂移导致 seed 与运行时守卫判定冲突，此处固化为测试断言
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLE_META,
  PERMISSION_SCOPES,
  DEFAULT_ROLE_PERMISSION_MATRIX,
  DEFAULT_DATA_SCOPE_BY_ROLE,
  getDefaultScopeListForRole,
  type SystemRoleId,
} from '../../_shared/rolePermissionMatrix';
import { ROLE_ID_TO_LEGACY_AGENT_ROLE } from '../permissionService';

const ALL_SYSTEM_ROLE_IDS = Object.values(SYSTEM_ROLE_IDS) as SystemRoleId[];

describe('DR-041 QC/后勤角色容器内置', () => {
  it('系统内置角色共 8 个（含 role-qc / role-logistics）', () => {
    expect(ALL_SYSTEM_ROLE_IDS).toHaveLength(8);
    expect(SYSTEM_ROLE_IDS.QC).toBe('role-qc');
    expect(SYSTEM_ROLE_IDS.LOGISTICS).toBe('role-logistics');
  });

  it('8 角色在 META / 权限矩阵 / 行级范围三处注册完整', () => {
    for (const roleId of ALL_SYSTEM_ROLE_IDS) {
      expect(SYSTEM_ROLE_META[roleId], `SYSTEM_ROLE_META 缺 ${roleId}`).toBeDefined();
      expect(DEFAULT_ROLE_PERMISSION_MATRIX[roleId], `DEFAULT_ROLE_PERMISSION_MATRIX 缺 ${roleId}`).toBeDefined();
      expect(DEFAULT_DATA_SCOPE_BY_ROLE[roleId], `DEFAULT_DATA_SCOPE_BY_ROLE 缺 ${roleId}`).toBeDefined();
    }
  });

  it('QC 容器：qc:read/write 可写 + 订单/产品/生产/运单/报关只读', () => {
    const scopes = getDefaultScopeListForRole(SYSTEM_ROLE_IDS.QC);
    expect(scopes).toContain('qc:read');
    expect(scopes).toContain('qc:write');
    for (const ro of ['orders:read', 'products:read', 'production:read', 'shipments:read', 'customs:read']) {
      expect(scopes).toContain(ro);
    }
    // 业务域不可写
    for (const denied of ['orders:write', 'shipments:write', 'customs:write']) {
      expect(scopes).not.toContain(denied);
    }
  });

  it('后勤容器：shipments:write + customs:write 可写 + 订单/产品/生产只读', () => {
    const scopes = getDefaultScopeListForRole(SYSTEM_ROLE_IDS.LOGISTICS);
    for (const w of ['shipments:read', 'shipments:write', 'customs:read', 'customs:write']) {
      expect(scopes).toContain(w);
    }
    for (const ro of ['orders:read', 'products:read', 'production:read']) {
      expect(scopes).toContain(ro);
    }
    expect(scopes).not.toContain('orders:write');
    expect(scopes).not.toContain('qc:write');
  });

  it('QC/后勤矩阵引用的 scope 全部存在于 PERMISSION_SCOPES（seed 不得静默跳过）', () => {
    for (const roleId of [SYSTEM_ROLE_IDS.QC, SYSTEM_ROLE_IDS.LOGISTICS] as SystemRoleId[]) {
      for (const scope of getDefaultScopeListForRole(roleId)) {
        expect(
          Object.prototype.hasOwnProperty.call(PERMISSION_SCOPES, scope),
          `角色 ${roleId} 引用未定义 scope：${scope}`,
        ).toBe(true);
      }
    }
  });

  it('ROLE_ID_TO_LEGACY_AGENT_ROLE 覆盖全部 8 个系统角色', () => {
    for (const roleId of ALL_SYSTEM_ROLE_IDS) {
      expect(ROLE_ID_TO_LEGACY_AGENT_ROLE[roleId], `legacy 映射缺 ${roleId}`).toBeDefined();
    }
    expect(ROLE_ID_TO_LEGACY_AGENT_ROLE[SYSTEM_ROLE_IDS.QC]).toBe('viewer');
    expect(ROLE_ID_TO_LEGACY_AGENT_ROLE[SYSTEM_ROLE_IDS.LOGISTICS]).toBe('logistics');
  });

  it('SYSTEM_ROLE_META 描述无 ≤5万/>5万 阈值残留', () => {
    for (const roleId of ALL_SYSTEM_ROLE_IDS) {
      const { description } = SYSTEM_ROLE_META[roleId];
      expect(description, `${roleId} description 残留阈值`).not.toMatch(/[≤＞>]?\s*5\s*万/);
      expect(description).not.toContain('≤5万');
      expect(description).not.toContain('>5万');
    }
  });
});

describe('GAP-R2 双文件逐字同步守卫', () => {
  it('根 lib 真源与 server/_shared 副本自 SYSTEM_ROLE_IDS 起逐字一致', () => {
    // server/src/auth/__tests__/ → 仓库根：向上 4 级（__tests__→auth→src→server→根）
    const repoRoot = path.resolve(__dirname, '../../../..');
    const rootFile = readFileSync(path.join(repoRoot, 'lib/rolePermissionMatrix.ts'), 'utf8');
    const sharedFile = readFileSync(path.join(repoRoot, 'server/src/_shared/rolePermissionMatrix.ts'), 'utf8');
    const MARKER = 'export const SYSTEM_ROLE_IDS';
    const rootBody = rootFile.slice(rootFile.indexOf(MARKER));
    const sharedBody = sharedFile.slice(sharedFile.indexOf(MARKER));
    expect(rootBody.length).toBeGreaterThan(0);
    expect(sharedBody).toBe(rootBody);
  });
});
