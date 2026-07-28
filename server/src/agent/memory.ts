import { ActorContext } from './types';

type MemoryRecord = {
  id: string;
  actorId: string;
  scope: string;
  memoryType: string;
  content: string;
  createdAt: Date;
};

type RememberInput = {
  actor: ActorContext;
  scope: string;
  memoryType: string;
  content: string;
};

export function createMemoryService() {
  const memories: MemoryRecord[] = [];

  async function remember(input: RememberInput) {
    const record: MemoryRecord = {
      id: `mem_${memories.length + 1}`,
      actorId: input.actor.userId,
      scope: input.scope,
      memoryType: input.memoryType,
      content: input.content,
      createdAt: new Date(),
    };
    memories.push(record);
    return record;
  }

  async function recall(input: { actor: ActorContext; scope?: string; query?: string }) {
    const allowedScopes = new Set(input.actor.memoryScopes);
    return memories.filter(memory => {
      const scopeAllowed = allowedScopes.has(memory.scope);
      const scopeMatches = input.scope ? memory.scope === input.scope : true;
      const queryMatches = input.query ? memory.content.includes(input.query) : true;
      return scopeAllowed && scopeMatches && queryMatches;
    });
  }

  function stats() {
    return {
      memories: memories.length,
      scopes: Array.from(new Set(memories.map(memory => memory.scope))).length,
    };
  }

  return { remember, recall, stats };
}
