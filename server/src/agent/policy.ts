import { ActorContext, KnowledgeAccessTarget, PolicyDecision, ToolAccessTarget } from './types';

const HIGH_RISK_APPROVERS = new Set(['owner', 'admin', 'manager']);

export function createPolicyService() {
  function canAccessKnowledge(actor: ActorContext, target: KnowledgeAccessTarget): boolean {
    const scopes = target.scopes?.length ? target.scopes : ['company'];
    return scopes.some(scope => actor.knowledgeScopes.includes(scope) || actor.departmentIds.includes(scope));
  }

  function canUseTool(actor: ActorContext, target: ToolAccessTarget): PolicyDecision {
    if (!actor.toolScopes.includes(target.scope)) {
      return { allowed: false, requiresApproval: false, reason: 'ROLE_NOT_ALLOWED' };
    }

    if (target.risk === 'high' && !actor.roles.some(role => HIGH_RISK_APPROVERS.has(role))) {
      return { allowed: true, requiresApproval: true, reason: 'APPROVAL_REQUIRED' };
    }

    return { allowed: true, requiresApproval: false };
  }

  return { canAccessKnowledge, canUseTool };
}
