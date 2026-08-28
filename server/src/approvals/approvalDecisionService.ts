/**
 * approvalDecisionService.ts — 审批决议人归属判定（service 层唯一真源，route 保持薄）
 *
 * 设计真源：
 *   - DR-007：reviewerId 由 approvalRoutingService.resolveReviewerByDepartment 服务端解析
 *     （组织归属路由，createOnce 写入；付款/大单/跨团队上抬档实质 = reviewerId 落点上抬）
 *   - docs/design/01-产品总览/6. 角色与权限矩阵.md：审批链去阈值化——
 *     vouchers:approve:pay_lt5 / pay_gt5 仅为兼容保留 scope 名，运行时不判断金额阈值；
 *     「SM 本团队档 / 总领导兜底档」由 DR-007 路由落点承载，决议侧只需校验归属
 *
 * 铁律（fail-closed）：
 *   1. 审批单已指派 reviewerId → 仅该 reviewer 本人可决议；唯一例外是 owner
 *      （BOSS_BYPASS 兜底，与 approvalKernelRoute BOSS_BYPASS_ROLES 同一角色口径）
 *   2. reviewerId 为 null（DR-007 三步法过渡期 legacy 未指派单）→ 不额外拦截，
 *      由路由层审批角色门禁（owner/admin/manager）兜底
 *   3. 判定失败返回 APPROVAL_NOT_ASSIGNED（路由层映射 403）
 */

export const APPROVAL_NOT_ASSIGNED = 'APPROVAL_NOT_ASSIGNED';

export interface DecideActor {
  userId: string;
  roles: string[];
}

export interface DecideTargetApproval {
  reviewerId: string | null;
}

/** BOSS 兜底角色（与 approvalKernelRoute BOSS_BYPASS_ROLES 同一口径：仅 owner） */
const BOSS_BYPASS_ROLES = ['owner'];

export type DecideOwnershipVerdict =
  | { ok: true }
  | { ok: false; code: typeof APPROVAL_NOT_ASSIGNED; message: string };

export function evaluateDecideOwnership(
  approval: DecideTargetApproval,
  actor: DecideActor,
): DecideOwnershipVerdict {
  // legacy 未指派单：无归属可判，放行给路由层审批角色门禁
  if (!approval.reviewerId) return { ok: true };
  // 归属命中：审批人本人
  if (approval.reviewerId === actor.userId) return { ok: true };
  // BOSS 最终兜底（与内核 boss-bypass 同一角色口径）
  if (actor.roles.some((r) => BOSS_BYPASS_ROLES.includes(r))) return { ok: true };
  return {
    ok: false,
    code: APPROVAL_NOT_ASSIGNED,
    message: `${APPROVAL_NOT_ASSIGNED}：本审批单已指派审批人，仅该审批人本人（或 BOSS 兜底）可决议`,
  };
}
