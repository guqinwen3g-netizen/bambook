import { ActorContext, ActorContextInput, AgentRole } from './types';

const ROLE_SCOPES: Record<AgentRole, { permissions: string[]; knowledge: string[]; tools: string[] }> = {
  owner: {
    permissions: ['admin', 'knowledge:manage', 'tool:approve', 'memory:company:write'],
    knowledge: ['company', 'owner', 'admin', 'products'],
    tools: ['admin', 'finance', 'orders', 'relations', 'products', 'knowledge', 'automation'],
  },
  admin: {
    permissions: ['admin', 'knowledge:manage', 'tool:approve'],
    knowledge: ['company', 'admin', 'products'],
    tools: ['admin', 'finance', 'orders', 'relations', 'products', 'knowledge', 'automation'],
  },
  manager: {
    permissions: ['team:read', 'tool:approve'],
    knowledge: ['company', 'department', 'products'],
    tools: ['orders', 'relations', 'products', 'knowledge', 'automation'],
  },
  merchandiser: {
    permissions: ['orders:read', 'orders:draft'],
    knowledge: ['company', 'orders', 'suppliers', 'products'],
    tools: ['orders', 'relations', 'products'],
  },
  finance: {
    permissions: ['finance:read', 'invoice:draft'],
    knowledge: ['company', 'finance', 'products'],
    tools: ['finance', 'orders', 'products'],
  },
  sales: {
    permissions: ['sales:read', 'customer:draft'],
    knowledge: ['company', 'sales', 'customers', 'products'],
    tools: ['orders', 'relations', 'products'],
  },
  viewer: {
    permissions: ['read'],
    knowledge: ['company', 'products'],
    tools: ['read', 'products'],
  },
  agent_operator: {
    permissions: ['automation:run'],
    knowledge: ['company', 'products'],
    tools: ['automation', 'read', 'products'],
  },
  logistics: {
    permissions: ['read', 'shipping:read', 'shipping:write'],
    knowledge: ['company', 'products', 'shipping'],
    tools: ['read', 'products', 'shipping'],
  },
  production_manager: {
    permissions: ['production:read', 'production:write', 'production:sign'],
    knowledge: ['company', 'products', 'production'],
    tools: ['production', 'orders', 'products'],
  },
  factory: {
    permissions: ['production:read', 'production:write'],
    knowledge: ['company', 'products', 'production'],
    tools: ['production', 'products'],
  },
};

export function createIdentityService() {
  async function resolveActorContext(input: ActorContextInput): Promise<ActorContext> {
    const roles: AgentRole[] = input.roles?.length ? input.roles : [];
    if (!roles.length) {
      throw new Error('ACTOR_ROLES_REQUIRED: Agent execution requires a trusted actor with explicit roles.');
    }
    const departmentIds = input.departmentIds?.length ? input.departmentIds : ['company'];
    const roleScopes = roles.map(role => ROLE_SCOPES[role]);

    return {
      userId: input.userId,
      displayName: input.displayName,
      roles,
      departmentIds,
      permissionScopes: unique(roleScopes.flatMap(scope => scope.permissions)),
      memoryScopes: unique([
        `personal:${input.userId}`,
        ...roles.map(role => `role:${role}`),
        ...departmentIds.map(departmentId => `department:${departmentId}`),
        'company',
      ]),
      knowledgeScopes: unique([
        ...departmentIds,
        ...roleScopes.flatMap(scope => scope.knowledge),
      ]),
      toolScopes: unique(roleScopes.flatMap(scope => scope.tools)),
    };
  }

  return { resolveActorContext };
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
