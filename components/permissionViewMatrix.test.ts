/**
 * permissionViewMatrix.test.ts — W-C 批三-C 交付物 1：视图层「角色默认矩阵 × 视图门禁」一致性反向断言
 *
 * 双真源对照：
 *   - 期望侧：lib/rolePermissionMatrix.ts（7 系统角色 × 默认 scope 矩阵 + VIEW_TO_MAIN_SCOPES 视图→read scope）
 *     ·某角色对某 View 的「期望可访问性」= 该角色默认 scope 集含 VIEW_TO_MAIN_SCOPES[view].read
 *   - 实际侧：lib/modulePermissions.ts（36 View × policy 定义，canAccessView 的判定真源）
 *     ·public-authenticated → 全角色 true（任务规则：登录即可达）
 *     ·permission → 角色默认 scope 集含 def.required
 *     ·dev-only / role → 不走 scope 判定，记录跳过并说明
 *
 * 发现「按默认矩阵应可访问但视图门禁拒绝」（锁出合规角色）或反向（无权 scope 却放行）时，
 * 断言保持「正确期望」——测试红 = 走查发现的真实漂移，清单见文件末尾汇总用例的输出，
 * 不为了让测试绿而改期望。修复被测实现不在本文件租约内。
 */
import { describe, expect, it } from 'vitest';
import { View } from '../types';
import {
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLE_META,
  VIEW_TO_MAIN_SCOPES,
  getDefaultScopeListForRole,
  type SystemRoleId,
} from '../lib/rolePermissionMatrix';
import { getViewPermissionDefinition } from '../lib/modulePermissions';

const ALL_ROLES = Object.values(SYSTEM_ROLE_IDS) as SystemRoleId[];
const ALL_VIEWS = Object.values(View) as View[];

/** 期望侧：按角色默认矩阵，该角色应可访问此视图（null = 该 policy 不参与 scope 判定，跳过） */
function expectedAccessByMatrix(roleId: SystemRoleId, view: View): boolean | null {
  const def = getViewPermissionDefinition(view);
  if (def.policy === 'dev-only' || def.policy === 'role') return null;
  if (def.policy === 'public-authenticated') return true; // 任务规则：public 视图全角色期望 true
  const scopes = getDefaultScopeListForRole(roleId);
  return scopes.includes(VIEW_TO_MAIN_SCOPES[view].read);
}

/** 实际侧：modulePermissions policy 的判定结果（与 services/authService.canAccessView 同语义） */
function actualAccessByPolicy(roleId: SystemRoleId, view: View): boolean | null {
  const def = getViewPermissionDefinition(view);
  if (def.policy === 'dev-only' || def.policy === 'role') return null;
  if (def.policy === 'public-authenticated') return true;
  const scopes = getDefaultScopeListForRole(roleId);
  return scopes.includes(def.required!);
}

// ── 跳过我说明 ──
// dev-only（UiLab）：canAccessView 走 import.meta.env.DEV，与角色 scope 无关，不纳入矩阵断言。
// role policy：当前 36 视图无此 policy 定义；若未来新增，需单独评审其 roles 列表，同样不纳入。
const SKIPPED_VIEWS = ALL_VIEWS.filter((v) => {
  const p = getViewPermissionDefinition(v).policy;
  return p === 'dev-only' || p === 'role';
});

interface DriftEntry {
  role: SystemRoleId;
  roleName: string;
  view: View;
  matrixReadScope: string;
  gatePolicy: string;
  gateRequired?: string;
  expected: boolean;
  actual: boolean;
  kind: 'LOCKED_OUT' | 'OVER_ALLOWED';
}

const drifts: DriftEntry[] = [];

for (const roleId of ALL_ROLES) {
  describe(`视图门禁 × 角色 ${SYSTEM_ROLE_META[roleId].name}（${roleId}）`, () => {
    for (const view of ALL_VIEWS) {
      const expected = expectedAccessByMatrix(roleId, view);
      const actual = actualAccessByPolicy(roleId, view);
      if (expected === null || actual === null) {
        it.skip(`${view} — policy=${getViewPermissionDefinition(view).policy} 不走 scope 判定，跳过（见文件头说明）`, () => {});
        continue;
      }
      it(`${view} — 矩阵期望 ${expected ? '可访问' : '拒绝'} ⇔ 门禁实际 ${actual ? '放行' : '拒绝'}`, () => {
        const def = getViewPermissionDefinition(view);
        if (expected !== actual) {
          drifts.push({
            role: roleId,
            roleName: SYSTEM_ROLE_META[roleId].name,
            view,
            matrixReadScope: VIEW_TO_MAIN_SCOPES[view].read,
            gatePolicy: def.policy,
            gateRequired: def.required,
            expected,
            actual,
            kind: expected && !actual ? 'LOCKED_OUT' : 'OVER_ALLOWED',
          });
        }
        expect(
          actual,
          [
            `漂移：角色=${roleId}(${SYSTEM_ROLE_META[roleId].name}) 视图=${view}`,
            `矩阵 read scope=${VIEW_TO_MAIN_SCOPES[view].read} → 期望 ${expected}`,
            `门禁 policy=${def.policy} required=${def.required ?? '-'} → 实际 ${actual}`,
            expected && !actual
              ? '类型=锁出合规角色（角色持矩阵 read scope 但视图门禁拒绝）'
              : '类型=越权放行（角色无矩阵 read scope 但视图门禁放行）',
          ].join(' | '),
        ).toBe(expected);
      });
    }
  });
}

// ── 定义层基线（只减不增，与 scripts/check-design-tokens.sh 同思路）──
// VIEW_PERMISSION_DEFINITIONS(permission).required 与 VIEW_TO_MAIN_SCOPES.read 的定义级不一致清单。
// 2026-08-27 W-C 根修：modulePermissions 改为从 VIEW_TO_MAIN_SCOPES 派生 required，
// 定义层不一致已机制性归零（双源漂移根因消除）。基线清空并锁定——新增任何不一致立即红。
const DEFINITION_MISMATCH_BASELINE: readonly View[] = [];

describe('定义层：permission 视图门禁 scope 与矩阵 read scope 对齐基线（只减不增）', () => {
  it('definition mismatch 集合与基线一致（修复则收缩基线，新增漂移立即红）', () => {
    const actual = ALL_VIEWS.filter((v) => {
      const def = getViewPermissionDefinition(v);
      return def.policy === 'permission' && def.required !== VIEW_TO_MAIN_SCOPES[v].read;
    }).sort();
    expect(
      actual,
      `定义层不一致集合发生变化。\n实际=${JSON.stringify(actual)}\n基线=${JSON.stringify([...DEFINITION_MISMATCH_BASELINE].sort())}\n` +
        '若是修复了漂移 → 把该 View 从 DEFINITION_MISMATCH_BASELINE 移除；若是新增不一致 → 禁止，需对齐。',
    ).toEqual([...DEFINITION_MISMATCH_BASELINE].sort());
  });

  it('public-authenticated 视图中不存在「矩阵 read scope 非全角色持有」的隐式放开', () => {
    // SystemSettings 特案已于 2026-08-27 W-C 根修关闭（policy 派生为 permission: settings:system:read）。
    // 现存 public-authenticated 仅 Dashboard/Settings/AccountSettings（矩阵 read 全角色持有，非隐式放开）。
    // 本断言锁定「不再出现新的隐式放开」。
    const implicitOpens = ALL_VIEWS.filter((v) => {
      const def = getViewPermissionDefinition(v);
      if (def.policy !== 'public-authenticated') return false;
      const readScope = VIEW_TO_MAIN_SCOPES[v].read;
      return ALL_ROLES.some((r) => !getDefaultScopeListForRole(r).includes(readScope));
    }).sort();
    expect(implicitOpens).toEqual([]);
  });
});

describe('走查汇总', () => {
  it('跳过清单符合预期（仅 UiLab dev-only，无 role policy 视图）', () => {
    expect(SKIPPED_VIEWS).toEqual([View.UiLab]);
  });

  it('角色×视图 漂移清单（期望全绿；红则输出完整走查成果表）', () => {
    const table = drifts
      .map(
        (d) =>
          `${d.kind === 'LOCKED_OUT' ? '锁出' : '越权'} | ${d.roleName}(${d.role}) × ${d.view} | ` +
          `矩阵 scope=${d.matrixReadScope} 期望=${d.expected} | 门禁 required=${d.gateRequired} 实际=${d.actual}`,
      )
      .join('\n');
    expect(drifts.length, `\n共 ${drifts.length} 处视图层漂移：\n${table}\n`).toBe(0);
  });
});
