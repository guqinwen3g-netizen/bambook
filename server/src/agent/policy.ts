import { ActorContext, KnowledgeAccessTarget, PolicyDecision, ToolAccessTarget } from './types';

const HIGH_RISK_APPROVERS = new Set(['owner', 'admin', 'manager']);

export function createPolicyService() {
  function canAccessKnowledge(actor: ActorContext, target: KnowledgeAccessTarget): boolean {
    const scopes = target.scopes?.length ? target.scopes : ['company'];
    return scopes.some(scope => actor.knowledgeScopes.includes(scope) || actor.departmentIds.includes(scope));
  }

  function canUseTool(actor: ActorContext, target: ToolAccessTarget): PolicyDecision {
    // W-C 批三-F：owner（SUPER_ADMIN 的 legacy 映射）与 hasPermission 的 SUPER_ADMIN 特判同哲学——
    // 全工具域放行。修复 identity.ROLE_SCOPES 手写清单滞后工具注册表扩张（qc/samples 等域）
    // 导致的 owner 全通破裂；对 legacy-only owner actor 同样生效。
    const isOwner = actor.roles.includes('owner');
    if (!isOwner && !actor.toolScopes.includes(target.scope)) {
      return { allowed: false, requiresApproval: false, reason: 'ROLE_NOT_ALLOWED' };
    }

    if (target.risk === 'high' && !actor.roles.some(role => HIGH_RISK_APPROVERS.has(role))) {
      return { allowed: true, requiresApproval: true, reason: 'APPROVAL_REQUIRED' };
    }

    return { allowed: true, requiresApproval: false };
  }

  return { canAccessKnowledge, canUseTool };
}
