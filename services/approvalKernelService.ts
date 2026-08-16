/**
 * Approval Kernel API service — Phase 1 审批内核（DR-007 路由 / 委派 / BOSS 兜底 / 解析轨迹）
 *
 * 消费后端：
 *   GET  /v1/approvals                              — 业务审批中心列表（既有，含内核审计字段）
 *   POST /v1/approvals/:id/decide                   — 既有决策端点
 *   POST /v1/approvals-kernel/:id/delegate          — 审批人主动转派（reason ≥10 字）
 *   POST /v1/approvals-kernel/:id/boss-bypass       — BOSS 最终兜底特批（仅 owner，reason ≥30 字）
 *   GET  /v1/approvals-kernel/:id/resolution-trace  — DR-007 解析路径审计只读视图
 *
 * 类型定义内聚在本文件（root types.ts 为冻结区，禁止编辑）。
 */
import { apiService } from './apiService';

// ── DR-007 解析路径（与 server approvalRoutingService ReviewerResolverRoute 一致） ──
export type ReviewerResolverRoute =
  | 'DEPT_HEAD'                        // 正常：部门主管
  | 'FALLBACK_DEPT_HEAD_VACANT'        // 部门无主管 → 本部门 SALES_MANAGER → ADMIN 兜底
  | 'FALLBACK_SELF_APPLY_SUPERVISOR'   // 申请人本人是部门主管 → 上级部门主管 → ADMIN 兜底
  | 'FALLBACK_ADMIN';                  // 无部门/无任何候选 → ADMIN 兜底

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalPersonRef {
  id: string;
  displayName?: string | null;
  email?: string | null;
}

/** 业务审批列表项（/v1/approvals 返回完整 ApprovalRequest 行 + requester/reviewer 摘要） */
export interface ApprovalKernelListItem {
  id: string;
  requesterId: string;
  reviewerId?: string | null;
  actionType: string;
  targetType: string;
  targetId?: string | null;
  status: ApprovalStatus;
  risk: string;
  payload: Record<string, any>;
  decisionNote?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  requester?: ApprovalPersonRef | null;
  reviewer?: ApprovalPersonRef | null;
  // 内核审计字段（DR-007/委派/BOSS 兜底；旧数据可能缺省）
  reviewerResolverRoute?: ReviewerResolverRoute | null;
  departmentSnapshotId?: string | null;
  delegatedBy?: string | null;
  delegatedAt?: string | null;
  delegateReason?: string | null;
  clientReviewerIdSupplied?: boolean | null;
  bossFinalBypassBy?: string | null;
  bossFinalBypassAt?: string | null;
  bossFinalBypassReason?: string | null;
  bypassedApprovalId?: string | null;
}

/** GET /v1/approvals-kernel/:id/resolution-trace 返回的解析轨迹视图 */
export interface ApprovalResolutionTrace {
  id: string;
  status: ApprovalStatus;
  actionType: string;
  requesterId: string;
  reviewerId: string | null;
  reviewerResolverRoute: ReviewerResolverRoute | null;
  departmentSnapshotId: string | null;
  delegatedBy: string | null;
  delegatedAt: string | null;
  delegateReason: string | null;
  clientReviewerIdSupplied: boolean | null;
  bossFinalBypassBy: string | null;
  bossFinalBypassAt: string | null;
  bossFinalBypassReason: string | null;
  bypassedApprovalId: string | null;
}

/** 解析路径 → 人类可读轨迹链标签（请求人部门 → 解析命中节点） */
export const RESOLVER_ROUTE_LABEL: Record<ReviewerResolverRoute, string> = {
  DEPT_HEAD: '部门主管',
  FALLBACK_DEPT_HEAD_VACANT: '部门主管空缺兜底（本部门销售主管 / ADMIN）',
  FALLBACK_SELF_APPLY_SUPERVISOR: '自申请阻断兜底（上级部门主管 / ADMIN）',
  FALLBACK_ADMIN: 'ADMIN 兜底（无部门 / 无候选）',
};

/** 路由是否触发了兜底链（非直命中部门主管） */
export function isFallbackRoute(route: ReviewerResolverRoute | null | undefined): boolean {
  return Boolean(route && route !== 'DEPT_HEAD');
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const code = typeof data?.error === 'string' ? data.error : undefined;
  const rawMessage = data?.message || data?.error || `${fallback}: HTTP ${res.status}`;
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  const err: any = new Error(code && data?.message && !message.includes(code) ? `${code}：${message}` : message);
  err.status = res.status;
  err.code = code;
  throw err;
}

function kernelUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/approvals-kernel${path}`, base);
}

export const approvalKernelService = {
  /** 业务审批列表（pending 待办 / done 已办） */
  async listBusinessApprovals(view: 'pending' | 'done' = 'pending', endpoint?: string): Promise<ApprovalKernelListItem[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/approvals?status=${view}`, base);
    const res = await fetch(url, { headers: apiService.getAuthHeaders() });
    if (!res.ok) await readError(res, 'listBusinessApprovals failed');
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  },

  /** 既有决策端点（通过 / 驳回；驳回必填 decisionNote） */
  async decideApproval(
    id: string,
    status: 'approved' | 'rejected',
    decisionNote?: string,
    endpoint?: string,
  ): Promise<ApprovalKernelListItem> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/approvals/${encodeURIComponent(id)}/decide`, base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ status, decisionNote }),
    });
    if (!res.ok) await readError(res, 'decideApproval failed');
    const data = await res.json();
    return data.item;
  },

  /** DR-007 解析轨迹只读视图（owner/admin/manager 可读） */
  async getResolutionTrace(id: string, endpoint?: string): Promise<ApprovalResolutionTrace> {
    const res = await fetch(kernelUrl(`/${encodeURIComponent(id)}/resolution-trace`, endpoint), {
      headers: apiService.getAuthHeaders(),
    });
    if (!res.ok) await readError(res, 'getResolutionTrace failed');
    const data = await res.json();
    return data.item;
  },

  /** 委派（仅当前 reviewerId 本人；reason ≥10 字；禁止委派给申请人） */
  async delegateApproval(
    id: string,
    input: { toUserId: string; reason: string },
    endpoint?: string,
  ): Promise<ApprovalKernelListItem> {
    const res = await fetch(kernelUrl(`/${encodeURIComponent(id)}/delegate`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ toUserId: input.toUserId, reason: input.reason }),
    });
    if (!res.ok) await readError(res, 'delegateApproval failed');
    const data = await res.json();
    return data.item;
  },

  /** BOSS 最终兜底特批（仅 owner；reason ≥30 字） */
  async bossBypassApproval(id: string, reason: string, endpoint?: string): Promise<ApprovalKernelListItem> {
    const res = await fetch(kernelUrl(`/${encodeURIComponent(id)}/boss-bypass`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) await readError(res, 'bossBypassApproval failed');
    const data = await res.json();
    return data.item;
  },
};
