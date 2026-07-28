import { ChatMessage } from '../types';
import { getAgentRuntimeApiBaseUrl, getAgentRuntimeDevHeaders } from './apiBase';

export type AssistantSessionSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
};

const AUTH_TOKEN_KEY = 'bambook_auth_token';

function getRuntimeApiBase() {
  return getAgentRuntimeApiBaseUrl();
}

function authHeaders(extra: Record<string, string> = {}) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
  const devHeaders = getAgentRuntimeDevHeaders();
  if (Object.keys(devHeaders).length) return { ...devHeaders, ...extra };
  return token ? { ...devHeaders, ...extra, Authorization: `Bearer ${token}` } : { ...devHeaders, ...extra };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  }
  return data as T;
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (networkErr) {
    throw new Error(`网络连接失败，请检查服务是否可用: ${(networkErr as Error)?.message || 'unknown'}`);
  }
}

export const assistantSessionService = {
  async listSessions(): Promise<AssistantSessionSummary[]> {
    const response = await safeFetch(`${getRuntimeApiBase()}/agent/sessions`, {
      headers: authHeaders(),
      credentials: 'include',
    });
    const data = await readJson<{ sessions: AssistantSessionSummary[] }>(response);
    return data.sessions || [];
  },

  async createSession(title = '新对话'): Promise<AssistantSessionSummary> {
    const response = await safeFetch(`${getRuntimeApiBase()}/agent/sessions`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ title }),
    });
    const data = await readJson<{ session: AssistantSessionSummary }>(response);
    return data.session;
  },

  async loadMessages(sessionId: string): Promise<{ session: AssistantSessionSummary; messages: ChatMessage[] }> {
    const response = await safeFetch(`${getRuntimeApiBase()}/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
      headers: authHeaders(),
      credentials: 'include',
    });
    return readJson(response);
  },

  async saveMessage(sessionId: string, message: ChatMessage): Promise<void> {
    await safeFetch(`${getRuntimeApiBase()}/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({
        role: message.role,
        text: message.text,
        attachments: message.attachments || [],
        sources: message.sources || [],
        thoughtProcess: message.thoughtProcess,
      }),
    }).then(readJson);
  },

  async updateSessionTitle(sessionId: string, title: string): Promise<AssistantSessionSummary> {
    const response = await safeFetch(`${getRuntimeApiBase()}/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ title }),
    });
    const data = await readJson<{ session: AssistantSessionSummary }>(response);
    return data.session;
  },

  async archiveSession(sessionId: string): Promise<void> {
    await safeFetch(`${getRuntimeApiBase()}/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
      credentials: 'include',
    }).then(readJson);
  },
};
