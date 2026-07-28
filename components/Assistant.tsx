
import React, { useState, useRef, useEffect } from 'react';
import { KnowledgeItem, Order, Relation, Insight, ChatMessage, ChatAttachment, AgentArtifactBlock, AgentWorkEvent, AgentWorkEventPhase, AgentWorkEventStatus, AgentBlockStreamEvent, AgentReferenceAnchor, AgentResponseBlock, AgentSessionContext, MODELS } from '../types';
import { getAgentRuntimeApiBaseUrl, getAgentRuntimeDevHeaders } from '../services/apiBase';
import { getAuthState } from '../services/authService';
import { assistantSessionService, AssistantSessionSummary } from '../services/assistantSessionService';
import { ttsService } from '../services/ttsService';
import {
  ArrowLeft, ArrowRight,
  Send, Paperclip, Cpu, MessageSquare,
  RefreshCw, Search, StopCircle, Globe, Volume2, VolumeX,
  Plus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Archive, Check, Copy, Maximize2, Mic, Minimize2, Pencil, Trash2, X,
  ChevronDown, ChevronRight,
  Sparkles, Languages, BarChart3, Mail, ShoppingBag, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentMessageCard } from './AgentMessageCard';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import { CompiledInteractiveCard } from './ui/osCompiler/compiledPrimitives';
import { localSttService } from '../services/localSttService';
import BambookLowercaseWordmark from './BambookLowercaseWordmark';
import {
  buildAgentThoughtProcessText,
  compactAgentText,
  describeAgentTool,
  finalizeAgentEvents,
  getAgentLiveStatusText,
  getAgentRunStatusText,
  normalizeAgentWorkEvent,
} from '../lib/agentEventPresentation';
import { normalizeAgentBlockStreamEvent, reduceAgentBlocks } from '../lib/agentBlockStream';
import { useStickyScroll } from '../lib/useStickyScroll';
import { normalizeAgentManifestResponse, type AgentToolCatalog } from '../lib/agentManifest';
import { AgentToolCatalogRail } from './agent-response/AgentToolCatalogRail';
import { SettingsDrawer } from './agent-response/SettingsDrawer';

interface AssistantProps {
  knowledge: KnowledgeItem[];
  orders: Order[];
  relations: Relation[];
  insights: Insight[];
  onUpdateOrders: (orders: Order[]) => void;
  onUpdateKnowledge: (knowledge: KnowledgeItem[]) => void;
  onUpdateInsights: (insights: Insight[]) => void;
  isDarkMode?: boolean;
  /** 与设置中的「主对话模型」一致 */
  chatModelId?: string;
  /** 采样温度，与设置一致 */
  temperature?: number;
  /** 自动朗读语速 */
  voiceSpeed?: number;
}

type RuntimeChatResult = {
  text: string;
  sources?: any[];
  thoughtProcess?: string;
};

type TtsChunkDebug = {
  segmentId?: number;
  chars?: number;
  firstDeltaServerAt?: number;
  queuedAt?: number;
  synthesisStartAt?: number;
  chunkServerAt?: number;
  queuedToSynthesisStartMs?: number;
  synthesisMs?: number;
  firstDeltaToSynthesisStartMs?: number | null;
  firstDeltaToChunkServerMs?: number | null;
};

type BackendTtsChunk = {
  segmentId: number;
  audioBase64: string;
  contentType?: string;
  text?: string;
  ttsDebug?: TtsChunkDebug;
};

const ASSISTANT_WORKSPACE_STATE_KEY = 'bambook:assistant-workspace-state:v2';
const ASSISTANT_SESSIONS_CACHE_KEY = 'bambook:assistant-sessions:cache';
const SEND_LOCK_DUPLICATE_WINDOW_MS = 1200;
const WORKSPACE_SEARCH_PAGE_SIZE = 30;

type AssistantWorkspaceState = {
  isAgentFullscreen?: boolean;
  isWorkspaceOpen?: boolean;
  isHistoryOpen?: boolean;
  workspaceWidth?: number;
};

type AssistantWorkspaceItemKind = 'image' | 'pdf' | 'file' | 'browser' | 'terminal' | 'review' | 'reference' | 'artifact';

type WorkspaceEntitySearchItem = {
  entityType: string;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  confidence?: number;
  sourceModel?: string;
  fillPatch?: Record<string, unknown>;
  links?: Array<{ targetType: string; targetId: string; linkKind: string }>;
};

type AgentToolRunDetail = {
  id: string;
  toolId: string;
  userId?: string | null;
  actorId?: string | null;
  actorDisplayName?: string | null;
  actorRoles?: unknown;
  sessionId?: string | null;
  requestSource?: string | null;
  approvalId?: string | null;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  risk?: string | null;
  idempotencyKey?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

type AssistantWorkspaceItem = {
  id: string;
  kind: AssistantWorkspaceItemKind;
  title: string;
  subtitle?: string;
  mimeType?: string;
  data?: string;
  previewUrl?: string;
  url?: string;
  attachmentName?: string;
  entity?: WorkspaceEntitySearchItem;
  referenceAnchor?: AgentReferenceAnchor;
  artifactBlock?: AgentArtifactBlock;
  toolRunDetail?: AgentToolRunDetail;
  referenceHydration?: {
    status: 'loading' | 'loaded' | 'error';
    error?: string;
  };
  entityHydration?: {
    status: 'loading' | 'loaded' | 'error';
    error?: string;
  };
};

const readAssistantWorkspaceState = (): AssistantWorkspaceState => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ASSISTANT_WORKSPACE_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const saveAssistantWorkspaceState = (patch: AssistantWorkspaceState) => {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readAssistantWorkspaceState(), ...patch };
    window.localStorage.setItem(ASSISTANT_WORKSPACE_STATE_KEY, JSON.stringify(next));
  } catch {
    // Workspace memory is local personalization; failure should not block the assistant.
  }
};

const readSessionsCache = (): AssistantSessionSummary[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ASSISTANT_SESSIONS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveSessionsCache = (items: AssistantSessionSummary[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ASSISTANT_SESSIONS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Session cache is non-critical optimization
  }
};

const readMessagesCache = (sessionId: string): ChatMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`bambook:assistant-session-messages:${sessionId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveMessagesCache = (sessionId: string, messages: ChatMessage[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`bambook:assistant-session-messages:${sessionId}`, JSON.stringify(messages));
  } catch {
    // Session cache is non-critical optimization
  }
};

const WORKSPACE_ENTITY_TYPE_LABELS: Record<string, string> = {
  'relation.organization': '关系智库',
  'relation.person': '联系人',
  'product.asset': '数字档案',
  'product.fabricProfile': '面料档案',
  'product.customerCode': '客户编码',
  'order.line': '订单行',
};

const getWorkspaceEntityTypeLabel = (type?: string) => {
  if (!type) return 'Bambook 对象';
  return WORKSPACE_ENTITY_TYPE_LABELS[type] || type;
};

const formatReferenceJson = (value: unknown): string => {
  if (value === undefined || value === null) return '无';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getToolRunDurationLabel = (toolRun?: AgentToolRunDetail) => {
  if (!toolRun?.startedAt || !toolRun.completedAt) return '';
  const started = new Date(toolRun.startedAt).getTime();
  const completed = new Date(toolRun.completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return '';
  return `${completed - started} ms`;
};

export type AssistantRuntimeSnapshot = {
  messages: ChatMessage[];
  isLoading: boolean;
  thinkingLogs: string[];
  agentEvents: AgentWorkEvent[];
  agentSessionContext?: { pendingApprovalId?: string };
};

export const assistantRuntimeStore = (() => {
  let snapshot: AssistantRuntimeSnapshot = {
    messages: [],
    isLoading: false,
    thinkingLogs: [],
    agentEvents: [],
  };
  let controller: AbortController | null = null;
  const listeners = new Set<(next: AssistantRuntimeSnapshot) => void>();

  const notify = () => listeners.forEach(listener => listener(snapshot));
  const set = (patch: Partial<AssistantRuntimeSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    notify();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (next: AssistantRuntimeSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    set,
    setController(next: AbortController | null) {
      controller = next;
    },
    stop() {
      controller?.abort();
      controller = null;
      if (snapshot.isLoading) {
        set({
          isLoading: false,
          thinkingLogs: [...snapshot.thinkingLogs, '已停止当前回复'],
          agentEvents: [
            ...snapshot.agentEvents,
            {
              id: `agent_stop_${Date.now()}`,
              at: new Date().toISOString(),
              phase: 'error',
              status: 'blocked',
              title: '任务已停止',
              message: '当前任务已停止。',
            },
          ],
        });
      }
    },
    reset() {
      controller?.abort();
      controller = null;
      set({ messages: [], isLoading: false, thinkingLogs: [], agentEvents: [] });
    }
  };
})();

const AGENTS = [
  { id: 'translation', name: '翻译助手', desc: '多语言翻译与润色', icon: Languages },
  { id: 'analysis', name: '数据分析', desc: '订单与关系库分析', icon: BarChart3 },
  { id: 'email', name: '邮件秘书', desc: '商务邮件起草与修改', icon: Mail },
  { id: 'order', name: '订单管家', desc: '出货跟进与订单检索', icon: ShoppingBag },
];

const Assistant: React.FC<AssistantProps> = ({
  knowledge, orders, relations, insights,
  onUpdateOrders, onUpdateKnowledge, onUpdateInsights,
  isDarkMode = false,
  chatModelId,
  temperature = 0.7,
  voiceSpeed = 1
}) => {
  const [input, setInput] = useState('');
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<AssistantRuntimeSnapshot>(assistantRuntimeStore.getSnapshot());
  const messages = runtimeSnapshot.messages;
  const isLoading = runtimeSnapshot.isLoading;
  const thinkingLogs = runtimeSnapshot.thinkingLogs;
  const agentEvents = runtimeSnapshot.agentEvents;
  const [selectedModel, setSelectedModel] = useState<string>(chatModelId || MODELS.FAST);
  const [sessions, setSessions] = useState<AssistantSessionSummary[]>(() => readSessionsCache());
  const [historyError, setHistoryError] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | number | null>(null);
  const [activeAgentId, setActiveAgentId] = useState('default');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useEffect(() => {
    saveSessionsCache(sessions);
  }, [sessions]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  const selectAgent = (agentId: string) => {
    setActiveAgentId(agentId);
    ttsService.stop();
    cancelTypingAnimation(false);
    assistantRuntimeStore.reset();
    setInput('');
    setAttachments([]);
    setHistoryError('');
    cancelRenameSession();
    const next = `assistant-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    sessionIdRef.current = next;
    activeSessionIdRef.current = next;
    setActiveSessionId(next);
    try {
      sessionStorage.setItem('bambookAiSessionId', next);
    } catch {
      // ignore
    }
  };

  const [isAgentFullscreen, setIsAgentFullscreen] = useState(() => readAssistantWorkspaceState().isAgentFullscreen === true);
  const sessionIdRef = useRef<string>(
    (() => {
      try {
        const existing = sessionStorage.getItem('bambookAiSessionId');
        if (existing) return existing;
        const next = `assistant-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        sessionStorage.setItem('bambookAiSessionId', next);
        return next;
      } catch {
        return `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
    })()
  );
  const [activeSessionId, setActiveSessionId] = useState(sessionIdRef.current);
  const [agentSessionContext, setAgentSessionContext] = useState<AgentSessionContext>(() => ({
    sessionId: sessionIdRef.current,
    status: 'idle',
    inputMode: 'normal',
    workspace: { kind: 'empty' },
  }));

  const patchAgentSessionContext = (patch: Partial<AgentSessionContext>) => {
    setAgentSessionContext(prev => ({
      ...prev,
      ...patch,
      sessionId: Object.prototype.hasOwnProperty.call(patch, 'sessionId') ? patch.sessionId || prev.sessionId : prev.sessionId,
      workspace: Object.prototype.hasOwnProperty.call(patch, 'workspace') ? patch.workspace : prev.workspace,
      pendingAction: Object.prototype.hasOwnProperty.call(patch, 'pendingAction') ? patch.pendingAction : prev.pendingAction,
    }));
  };

  useEffect(() => {
    if (chatModelId) setSelectedModel(chatModelId);
  }, [chatModelId]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<AssistantWorkspaceItem[]>([]);
  const [activeWorkspaceItemId, setActiveWorkspaceItemId] = useState<string | null>(null);
  const [isWorkspaceFinderOpen, setIsWorkspaceFinderOpen] = useState(false);
  const [workspaceFinderQuery, setWorkspaceFinderQuery] = useState('');
  const [workspaceFileSource, setWorkspaceFileSource] = useState<'bambook' | 'local'>('bambook');
  const [workspaceAddressInput, setWorkspaceAddressInput] = useState('');
  const [workspaceSearchResults, setWorkspaceSearchResults] = useState<WorkspaceEntitySearchItem[]>([]);
  const [workspaceSearchTotal, setWorkspaceSearchTotal] = useState<number | null>(null);
  const [workspaceSearchOffset, setWorkspaceSearchOffset] = useState(0);
  const [workspaceSearchHasMore, setWorkspaceSearchHasMore] = useState(false);
  const [workspaceSearchError, setWorkspaceSearchError] = useState('');
  const [isWorkspaceSearching, setIsWorkspaceSearching] = useState(false);
  const [isWorkspaceAppending, setIsWorkspaceAppending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingAnimationRef = useRef<{
    id: string;
    fullMessage: ChatMessage;
    resolve: (completed: boolean) => void;
  } | null>(null);
  const sendLockRef = useRef<{ key: string; startedAt: number } | null>(null);
  const voiceBaseTextRef = useRef('');

  useEffect(() => {
    if (activeSessionId) {
      saveMessagesCache(activeSessionId, messages);
    }
  }, [messages, activeSessionId]);

  const getWorkspaceKindForAttachment = (mimeType: string): AssistantWorkspaceItemKind => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.includes('pdf')) return 'pdf';
    return 'file';
  };

  const workspaceBindingFromItem = (item: AssistantWorkspaceItem): AgentSessionContext['workspace'] => {
    if (item.kind === 'artifact' && item.artifactBlock) {
      return { kind: 'artifact', artifactId: item.artifactBlock.artifactId, version: item.artifactBlock.version };
    }
    if (item.kind === 'reference' && item.referenceAnchor) {
      if (item.referenceAnchor.kind === 'artifact') return { kind: 'artifact', artifactId: item.referenceAnchor.sourceId || item.referenceAnchor.refId, version: 1 };
      if (item.referenceAnchor.kind === 'tool_run' && item.referenceAnchor.toolRunId) return { kind: 'toolRun', toolRunId: item.referenceAnchor.toolRunId };
      return { kind: 'evidence', evidenceId: item.referenceAnchor.refId };
    }
    return { kind: 'empty' };
  };

  const openWorkspaceItem = (item: AssistantWorkspaceItem) => {
    setIsWorkspaceFinderOpen(false);
    setWorkspaceItems(prev => {
      const existing = prev.find(entry => entry.id === item.id);
      if (existing) return prev.map(entry => entry.id === item.id ? { ...entry, ...item } : entry);
      return [...prev, item];
    });
    setActiveWorkspaceItemId(item.id);
    patchAgentSessionContext({
      workspace: workspaceBindingFromItem(item),
      activeArtifactId: item.artifactBlock?.artifactId || (item.referenceAnchor?.kind === 'artifact' ? item.referenceAnchor.sourceId || item.referenceAnchor.refId : undefined),
    });
    if (!isWorkspaceOpen) setIsWorkspaceOpen(true);
  };

  const closeWorkspaceItem = (itemId: string) => {
    setWorkspaceItems(prev => {
      const next = prev.filter(item => item.id !== itemId);
      setActiveWorkspaceItemId(current => {
        if (current !== itemId) return current;
        const nextActiveId = next.length > 0 ? next[next.length - 1].id : null;
        const nextActiveItem = nextActiveId ? next.find(item => item.id === nextActiveId) : null;
        patchAgentSessionContext({ workspace: nextActiveItem ? workspaceBindingFromItem(nextActiveItem) : { kind: 'empty' } });
        return nextActiveId;
      });
      return next;
    });
  };

  const openWorkspaceFinder = () => {
    setWorkspaceFileSource('bambook');
    setIsWorkspaceFinderOpen(true);
    if (!isWorkspaceOpen) setIsWorkspaceOpen(true);
  };

  const dispatchAgentAction = (action: { actionId: string; actionType?: string; payload?: Record<string, unknown>; risk?: 'low' | 'medium' | 'high' | 'critical'; label?: string }) => {
    const risk = action.risk || 'low';
    if ((risk === 'high' || risk === 'critical') && action.actionType !== 'approval') {
      patchAgentSessionContext({
        status: 'blocked_for_approval',
        inputMode: 'approval_comment',
        pendingAction: { kind: 'approve', targetId: action.actionId },
        pendingApprovalId: action.actionId,
      });
      setInput(action.label ? `请确认是否执行：${action.label}` : '请确认是否执行此高风险动作');
      return;
    }

    if (action.actionType === 'prompt') {
      const prompt = typeof action.payload?.prompt === 'string' ? action.payload.prompt : action.label || '';
      setInput(prompt);
      patchAgentSessionContext({ status: 'awaiting_user_input', inputMode: 'clarification', pendingAction: { kind: 'resume', targetId: action.actionId } });
      return;
    }

    if (action.actionType === 'artifact') {
      const artifactId = typeof action.payload?.artifactId === 'string' ? action.payload.artifactId : agentSessionContext.activeArtifactId;
      if (artifactId) {
        patchAgentSessionContext({ status: 'editing_artifact', inputMode: 'artifact_instruction', activeArtifactId: artifactId, pendingAction: { kind: 'artifact_edit', targetId: artifactId } });
      }
      return;
    }

    if (action.actionType === 'approval') {
      const decision = action.payload?.decision;
      const approvalId = typeof action.payload?.approvalId === 'string' ? action.payload.approvalId : action.actionId;
      patchAgentSessionContext({
        status: decision === 'modified' ? 'awaiting_user_input' : 'running',
        inputMode: decision === 'modified' ? 'approval_parameter_edit' : 'normal',
        pendingApprovalId: approvalId,
        pendingAction: {
          kind: decision === 'rejected' ? 'reject' : decision === 'modified' ? 'modify' : 'approve',
          targetId: approvalId,
        },
      });
      if (decision === 'modified') setInput('请描述要修改的参数或补充条件');
      // Phase 7-58: 真实落库到 /api/agent/approvals/:id/resolve（Phase 6 已实现）+ 前端乐观 patch
      // 'modified' 决议先打开输入框等用户提供参数，确认后由提交流程二次调用 resolve；
      // 'approved' / 'rejected' 直接调 resolve。
      if (decision === 'approved' || decision === 'rejected') {
        void resolveAgentApproval({
          approvalId,
          decision,
          decisionNote: typeof action.payload?.decisionNote === 'string' ? action.payload.decisionNote : undefined,
        });
      }
      return;
    }

    if (action.actionType === 'form_submit') {
      const formId = typeof action.payload?.formId === 'string' ? action.payload.formId : action.actionId;
      const values = (action.payload?.values && typeof action.payload.values === 'object'
        ? action.payload.values as Record<string, unknown>
        : {});
      patchAgentSessionContext({ status: 'running', inputMode: 'normal' });
      void submitAgentForm({ formId, values });
      return;
    }

    patchAgentSessionContext({ status: 'awaiting_user_input', inputMode: 'clarification', pendingAction: { kind: 'resume', targetId: action.actionId } });
    setInput(action.label || '请继续');
  };

  const openUrlInWorkspace = (rawUrl?: string) => {
    if (typeof window === 'undefined') return;
    const urlSource = rawUrl ?? window.prompt('输入要打开的链接');
    if (!urlSource) return;
    const normalizedUrl = /^https?:\/\//i.test(urlSource.trim()) ? urlSource.trim() : `https://${urlSource.trim()}`;
    openWorkspaceItem({
      id: `workspace-browser-${normalizedUrl}`,
      kind: 'browser',
      title: normalizedUrl,
      subtitle: normalizedUrl,
      url: normalizedUrl
    });
  };

  const submitWorkspaceAddress = (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = workspaceAddressInput.trim();
    if (!query) return;
    const looksLikeUrl = /^https?:\/\//i.test(query) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(query);
    if (looksLikeUrl) {
      openUrlInWorkspace(query);
      return;
    }
    setWorkspaceFinderQuery(query);
    openWorkspaceFinder();
    void searchWorkspaceEntities(query, { offset: 0 });
  };

  const getWorkspaceAuthHeaders = (): Record<string, string> => {
    const apiKey = getRuntimeApiKey();
    const authToken = getStoredAuthToken();
    const devHeaders = getAgentRuntimeDevHeaders();
    return {
      ...devHeaders,
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {}),
    };
  };

  const searchWorkspaceEntities = async (
    rawQuery = workspaceFinderQuery,
    options: { append?: boolean; offset?: number } = {},
  ) => {
    const query = rawQuery.trim();
    if (!query) return;
    const append = Boolean(options.append);
    const offset = Math.max(0, options.offset ?? 0);
    setWorkspaceFileSource('bambook');
    setIsWorkspaceFinderOpen(true);
    setWorkspaceSearchError('');
    if (!append) {
      setWorkspaceSearchResults([]);
      setWorkspaceSearchTotal(null);
      setWorkspaceSearchOffset(0);
      setWorkspaceSearchHasMore(false);
    }
    setIsWorkspaceSearching(!append);
    setIsWorkspaceAppending(append);
    try {
      const response = await fetch(`${getRuntimeApiBase()}/v1/entities/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getWorkspaceAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          query,
          limit: WORKSPACE_SEARCH_PAGE_SIZE,
          offset,
          include: { fillPatch: true, links: true },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `搜索失败 (${response.status})`);
      }
      const nextItems: WorkspaceEntitySearchItem[] = Array.isArray(data?.items) ? data.items : [];
      const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : null;
      const uniqueItems = append
        ? nextItems.filter(item => !workspaceSearchResults.some(existing => `${existing.entityType}:${existing.id}` === `${item.entityType}:${item.id}`))
        : nextItems;
      setWorkspaceSearchResults(prev => append ? [...prev, ...uniqueItems] : nextItems);
      const nextOffset = offset + nextItems.length;
      setWorkspaceSearchTotal(total);
      setWorkspaceSearchOffset(nextOffset);
      const backendHasMore = Boolean(data?.hasMore);
      const inferredHasMore = total !== null
        ? nextOffset < total
        : nextItems.length >= WORKSPACE_SEARCH_PAGE_SIZE;
      setWorkspaceSearchHasMore((backendHasMore || inferredHasMore) && (!append || uniqueItems.length > 0));
    } catch (error: any) {
      if (!append) {
        setWorkspaceSearchResults([]);
        setWorkspaceSearchTotal(null);
        setWorkspaceSearchOffset(0);
        setWorkspaceSearchError(error?.message || '无法搜索 Bambook 内容');
      }
      setWorkspaceSearchHasMore(false);
    } finally {
      setIsWorkspaceSearching(false);
      setIsWorkspaceAppending(false);
    }
  };

  const loadMoreWorkspaceEntities = () => {
    if (isWorkspaceSearching || isWorkspaceAppending || !workspaceFinderQuery.trim()) return;
    void searchWorkspaceEntities(workspaceFinderQuery, { append: true, offset: workspaceSearchOffset });
  };

  const openEntityInWorkspace = (entity: WorkspaceEntitySearchItem) => {
    const workspaceId = `workspace-entity-${entity.entityType}-${entity.id}`;
    openWorkspaceItem({
      id: workspaceId,
      kind: 'review',
      title: entity.title,
      subtitle: entity.subtitle || entity.entityType,
      entity,
      entityHydration: { status: 'loading' },
    });
    void hydrateWorkspaceEntity(workspaceId, entity);
  };

  const openArtifactInWorkspace = (artifactBlock: AgentArtifactBlock) => {
    openWorkspaceItem({
      id: `workspace-artifact-${artifactBlock.artifactId}`,
      kind: 'artifact',
      title: artifactBlock.title || artifactBlock.artifactId,
      subtitle: `${artifactBlock.artifactType} · v${artifactBlock.version}`,
      artifactBlock,
    });
    patchAgentSessionContext({
      status: 'editing_artifact',
      inputMode: 'artifact_instruction',
      activeArtifactId: artifactBlock.artifactId,
      workspace: { kind: 'artifact', artifactId: artifactBlock.artifactId, version: artifactBlock.version },
    });
  };

  const openReferenceInWorkspace = (anchor: AgentReferenceAnchor) => {
    const title = anchor.label || anchor.sourceId || anchor.toolRunId || anchor.refId;
    const workspaceId = `workspace-reference-${anchor.refId}`;
    openWorkspaceItem({
      id: workspaceId,
      kind: 'reference',
      title,
      subtitle: anchor.kind,
      referenceAnchor: anchor,
      referenceHydration: anchor.kind === 'tool_run' && anchor.toolRunId ? { status: 'loading' } : undefined,
    });
    if (anchor.kind === 'tool_run' && anchor.toolRunId) {
      void hydrateReferenceToolRun(workspaceId, anchor.toolRunId);
    }
  };

  const hydrateReferenceToolRun = async (workspaceId: string, toolRunId: string) => {
    try {
      const response = await fetch(`${getRuntimeApiBase()}/agent/tool-runs/${encodeURIComponent(toolRunId)}`, {
        method: 'GET',
        headers: getWorkspaceAuthHeaders(),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `读取工具运行详情失败 (${response.status})`);
      }
      const toolRun = data?.toolRun as AgentToolRunDetail | undefined;
      setWorkspaceItems(prev => prev.map(item => item.id === workspaceId ? {
        ...item,
        title: toolRun?.toolId || item.title,
        subtitle: toolRun ? `${toolRun.status}${toolRun.risk ? ` · ${toolRun.risk}` : ''}` : item.subtitle,
        toolRunDetail: toolRun,
        referenceHydration: { status: toolRun ? 'loaded' : 'error', error: toolRun ? undefined : '没有读取到工具运行详情' },
      } : item));
    } catch (error: any) {
      setWorkspaceItems(prev => prev.map(item => item.id === workspaceId ? {
        ...item,
        referenceHydration: { status: 'error', error: error?.message || '工具运行详情读取失败' },
      } : item));
    }
  };

  /**
   * Phase 7-58: 真实把审批决议落库到后端 + 乐观更新前端 approval block。
   *
   * 流程：
   *   1) 立即对当前流式消息里 approvalId 匹配的 approval block 应用 set_approval_status patch
   *      （pending → 决议）—— 用户立刻看到对勾/叉，无 lag
   *   2) POST /agent/approvals/:id/resolve，等响应
   *   3) 失败时回滚到 pending 并提示
   *
   * decision='modified' 不在这里直接落库 —— 它由 chat 提交流程消费 approval_parameter_edit
   * 输入模式后再由后端把"修改后的参数"作为新工具入参，下一轮 ApprovalRequest 由后端在拒绝
   * 旧 approval 后重建。
   */
  const resolveAgentApproval = async (params: { approvalId: string; decision: 'approved' | 'rejected' | 'modified'; decisionNote?: string; modifiedInput?: Record<string, unknown> }) => {
    const { approvalId, decision, decisionNote, modifiedInput } = params;
    const applyApprovalPatch = (status: 'pending' | 'approved' | 'rejected' | 'modified') => {
      const current = assistantRuntimeStore.getSnapshot();
      assistantRuntimeStore.set({
        messages: current.messages.map(message => {
          if (!Array.isArray(message.blocks)) return message;
          let touched = false;
          const nextBlocks: AgentResponseBlock[] = message.blocks.map((block): AgentResponseBlock => {
            if (block.type !== 'approval' || block.approvalId !== approvalId) return block;
            touched = true;
            return {
              ...block,
              approvalStatus: status,
              status: status === 'pending' ? 'streaming' as const : 'complete' as const,
            };
          });
          return touched ? { ...message, blocks: nextBlocks } : message;
        }),
      });
    };
    // 先乐观更新
    applyApprovalPatch(decision);
    try {
      const response = await fetch(`${getRuntimeApiBase()}/agent/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getWorkspaceAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          decision,
          decisionNote,
          modifiedInput: decision === 'modified' ? modifiedInput : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `审批落库失败 (${response.status})`);
      }
      // 后端返回的最终 status（如已被他人改过）以服务端为准
      const serverStatus = data?.approval?.status;
      if (serverStatus && serverStatus !== decision) {
        applyApprovalPatch(serverStatus);
      }
      // 审批决议已成功发送后端
      // 卡片状态会变为 approved/rejected/modified
      // 接下来静静等待后端 SSE 唤醒继续吐出内容即可
    } catch (error: any) {
      console.error("[Antigravity Debug] resolveAgentApproval 报错:", error);
      if (typeof window !== 'undefined') {
        window.alert(`【Antigravity 错误捕捉】审批落库失败：${error?.message || '未知错误'}`);
      }
      // 回滚
      applyApprovalPatch('pending');
      patchAgentSessionContext({ status: 'blocked_for_approval', pendingApprovalId: approvalId, inputMode: 'approval_comment' });
      // 把错误提示挂到当前 streaming 消息（轻量提示，不弹 toast 以免干扰）
      const current = assistantRuntimeStore.getSnapshot();
      const lastMessage = current.messages[current.messages.length - 1];
      if (lastMessage?.role === 'model') {
        const note = `\n\n> 审批落库失败：${error?.message || '未知错误'}`;
        assistantRuntimeStore.set({
          messages: current.messages.map((message, idx) => idx === current.messages.length - 1
            ? { ...message, text: (message.text || '') + note }
            : message),
        });
      }
    }
  };

  /**
   * 表单提交：把用户填写的 values 落到后端 formEventBus，唤醒挂起的 agentLoop 继续。
   *
   * 与 resolveAgentApproval 同构：
   *   1) 乐观把 form block 的 formStatus 切到 'submitted' + 记录 submittedValues
   *   2) POST /agent/forms/:id/submit（携带 X-Bambook-API-Key + Authorization）
   *   3) 失败时回滚到 pending
   */
  const submitAgentForm = async (params: { formId: string; values: Record<string, unknown> }) => {
    const { formId, values } = params;
    const applyFormPatch = (status: 'pending' | 'submitted', submittedValues?: Record<string, unknown>) => {
      const current = assistantRuntimeStore.getSnapshot();
      assistantRuntimeStore.set({
        messages: current.messages.map(message => {
          if (!Array.isArray(message.blocks)) return message;
          let touched = false;
          const nextBlocks: AgentResponseBlock[] = message.blocks.map((block): AgentResponseBlock => {
            if (block.type !== 'form' || block.formId !== formId) return block;
            touched = true;
            return {
              ...block,
              formStatus: status,
              submittedValues,
              status: status === 'submitted' ? 'complete' as const : 'streaming' as const,
            };
          });
          return touched ? { ...message, blocks: nextBlocks } : message;
        }),
      });
    };
    applyFormPatch('submitted', values);
    try {
      const response = await fetch(`${getRuntimeApiBase()}/agent/forms/${encodeURIComponent(formId)}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getWorkspaceAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ values }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `表单提交失败 (${response.status})`);
      }
    } catch (error: any) {
      console.error('[Bambook Form] submitAgentForm 报错:', error);
      applyFormPatch('pending');
      if (typeof window !== 'undefined') {
        window.alert(`表单提交失败：${error?.message || '未知错误'}`);
      }
    }
  };

  const hydrateWorkspaceEntity = async (workspaceId: string, entity: WorkspaceEntitySearchItem) => {
    try {
      const response = await fetch(`${getRuntimeApiBase()}/v1/entities/hydrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getWorkspaceAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          refs: [{ entityType: entity.entityType, id: entity.id }],
          include: { fillPatch: true, links: true },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `读取详情失败 (${response.status})`);
      }
      const hydrated = Array.isArray(data?.items) ? data.items[0] : null;
      setWorkspaceItems(prev => prev.map(item => item.id === workspaceId ? {
        ...item,
        title: hydrated?.title || item.title,
        subtitle: hydrated?.subtitle || item.subtitle,
        entity: hydrated ? { ...entity, ...hydrated } : entity,
        entityHydration: { status: hydrated ? 'loaded' : 'error', error: hydrated ? undefined : '没有读取到详情' },
      } : item));
    } catch (error: any) {
      setWorkspaceItems(prev => prev.map(item => item.id === workspaceId ? {
        ...item,
        entityHydration: { status: 'error', error: error?.message || '无法读取详情' },
      } : item));
    }
  };

  const openAttachmentInWorkspace = (attachment: ChatAttachment) => {
    const existing = workspaceItems.find(item => item.previewUrl === attachment.previewUrl);
    if (existing) {
      setActiveWorkspaceItemId(existing.id);
      if (!isWorkspaceOpen) setIsWorkspaceOpen(true);
      return;
    }
    openWorkspaceItem({
      id: `workspace-file-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      kind: getWorkspaceKindForAttachment(attachment.mimeType),
      title: attachment.name,
      subtitle: attachment.mimeType || '文件',
      mimeType: attachment.mimeType,
      data: attachment.data,
      previewUrl: attachment.previewUrl,
      attachmentName: attachment.name
    });
  };

  const getWorkspaceContextAttachments = (): ChatAttachment[] => {
    const fileItems = workspaceItems
      .filter(item => item.data && item.mimeType && ['image', 'pdf', 'file'].includes(item.kind));
    const orderedItems = activeWorkspaceItemId
      ? [
        ...fileItems.filter(item => item.id === activeWorkspaceItemId),
        ...fileItems.filter(item => item.id !== activeWorkspaceItemId),
      ]
      : fileItems;
    return orderedItems.slice(0, 5).map(item => ({
      name: item.attachmentName || item.title,
      mimeType: item.mimeType || 'application/octet-stream',
      data: item.data || '',
      previewUrl: item.previewUrl || ''
    }));
  };

  const mergeAttachmentContext = (pendingAttachments: ChatAttachment[], workspaceAttachments: ChatAttachment[]) => {
    const seen = new Set<string>();
    return [...pendingAttachments, ...workspaceAttachments].filter(attachment => {
      const key = `${attachment.name}:${attachment.mimeType}:${attachment.data.slice(0, 48)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const buildSendLockKey = (text: string, requestAttachments: ChatAttachment[]) => [
    activeSessionIdRef.current,
    text.trim(),
    requestAttachments.map(attachment => `${attachment.name}:${attachment.mimeType}:${attachment.data.slice(0, 48)}`).join('|'),
  ].join('\n');

  const isDuplicateSendLocked = (key: string) => {
    const lock = sendLockRef.current;
    if (!lock) return false;
    return lock.key === key || Date.now() - lock.startedAt < SEND_LOCK_DUPLICATE_WINDOW_MS;
  };


  // Enable TTS by default as requested
  const [isTTSEnabled, setIsTTSEnabled] = useState(true);
  const isTTSEnabledRef = useRef(isTTSEnabled);
  const activeSessionIdRef = useRef(sessionIdRef.current);

  // Tool Progress State - Enhanced for P2

  useEffect(() => assistantRuntimeStore.subscribe(setRuntimeSnapshot), []);

  const clearTypingTimeout = () => {
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const updateTypingMessage = (id: string, text: string, isTyping: boolean) => {
    const snapshot = assistantRuntimeStore.getSnapshot();
    assistantRuntimeStore.set({
      messages: snapshot.messages.map(message => (
        message.id === id ? { ...message, text, isTyping } : message
      )),
    });
  };

  const cancelTypingAnimation = (revealFull = false) => {
    const active = typingAnimationRef.current;
    if (!active) return;
    clearTypingTimeout();
    if (revealFull) {
      updateTypingMessage(active.id, active.fullMessage.text, false);
    }
    typingAnimationRef.current = null;
    active.resolve(false);
  };

  const revealAssistantMessage = (message: ChatMessage) => new Promise<boolean>((resolve) => {
    cancelTypingAnimation(false);
    const id = message.id || `assistant-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fullMessage = { ...message, id, isTyping: false };
    const draftMessage = { ...fullMessage, text: '', isTyping: true };
    const afterRun = assistantRuntimeStore.getSnapshot().messages;
    assistantRuntimeStore.set({ messages: [...afterRun, draftMessage] });

    const segments = Array.from(fullMessage.text);
    const chunkSize = segments.length > 1000 ? 8 : segments.length > 520 ? 5 : 3;
    const delay = segments.length > 1000 ? 8 : segments.length > 520 ? 12 : 18;
    let cursor = 0;
    typingAnimationRef.current = { id, fullMessage, resolve };

    const tick = () => {
      const active = typingAnimationRef.current;
      if (!active || active.id !== id) {
        resolve(false);
        return;
      }
      cursor = Math.min(cursor + chunkSize, segments.length);
      updateTypingMessage(id, segments.slice(0, cursor).join(''), cursor < segments.length);
      if (cursor >= segments.length) {
        typingAnimationRef.current = null;
        resolve(true);
        return;
      }
      typingTimeoutRef.current = window.setTimeout(tick, delay);
    };

    typingTimeoutRef.current = window.setTimeout(tick, delay);
  });

  useEffect(() => () => cancelTypingAnimation(false), []);

  const refreshSessions = async () => {
    if (!getStoredAuthToken()) {
      setSessions([]);
      setHistoryError('');
      setIsHistoryLoading(false);
      return;
    }
    setIsHistoryLoading(true);
    setHistoryError('');
    try {
      const items = await assistantSessionService.listSessions();
      setSessions(items);
    } catch (error: any) {
      setHistoryError(error?.message || '无法加载历史');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    refreshSessions();
  }, []);

  const getRuntimeApiKey = () => {
    const envKey = import.meta.env.VITE_BAMBOOK_API_KEY as string | undefined;
    if (envKey?.trim()) return envKey.trim();
    try {
      const raw = localStorage.getItem('panda_system_config');
      if (!raw) return '';
      const cfg = JSON.parse(raw);
      return cfg?.sdkApiKey || '';
    } catch {
      return '';
    }
  };

  const getStoredAuthToken = () => {
    try {
      return localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token') || '';
    } catch {
      return '';
    }
  };

  const getRuntimeApiBase = () => {
    return getAgentRuntimeApiBaseUrl();
  };

  const getTtsApiBase = () => {
    const localTtsBase = import.meta.env.VITE_BAMBOOK_TTS_API_BASE as string | undefined;
    if (localTtsBase?.trim()) return localTtsBase.trim().replace(/\/$/, '');
    return getRuntimeApiBase();
  };

  const readSseResponse = async (
    response: Response,
    onStep: (step: string) => void,
    onDelta?: (text: string) => void,
    onTtsChunk?: (chunk: BackendTtsChunk) => void,
    onAgentEvent?: (event: AgentWorkEvent) => void,
    onBlockEvent?: (event: AgentBlockStreamEvent) => void,
  ): Promise<RuntimeChatResult> => {
    if (!response.body) throw new Error('AI Runtime did not return a stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: RuntimeChatResult | null = null;
    let runtimeError = '';

    const handleBlock = (block: string) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
      const dataRaw = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataRaw) return false;
      const data = JSON.parse(dataRaw);
      // ── Debug: log ALL SSE events for diagnosis ──
      const blockType = data?.block?.type || '';
      const toolId = data?.block?.toolId || data?.toolId || '';
      const lifecycle = data?.block?.lifecycleStatus || data?.status || '';
      console.info(`[Bambook SSE] event=${event} type=${blockType} toolId=${toolId} lifecycle=${lifecycle}`);
      if (event === 'agent_event' && data && typeof data === 'object') {
        const workEvent = normalizeAgentWorkEvent(data);
        if (workEvent) onAgentEvent?.(workEvent);
      }
      if ((event === 'block_start' || event === 'block_delta' || event === 'block_patch' || event === 'block_end' || event === 'block_error') && data && typeof data === 'object') {
        const blockEvent = normalizeAgentBlockStreamEvent({ ...data, event });
        if (blockEvent) onBlockEvent?.(blockEvent);
        else if (event === 'block_start') console.warn('[Bambook SSE] block_start normalized to null (dropped):', JSON.stringify(data).slice(0, 200));
      }
      if (event === 'delta' && data.text) onDelta?.(String(data.text));
      if (event === 'tts_chunk' && typeof data.audioBase64 === 'string') {
        onTtsChunk?.({
          segmentId: Number(data.segmentId),
          audioBase64: String(data.audioBase64),
          contentType: typeof data.contentType === 'string' ? data.contentType : undefined,
          text: typeof data.text === 'string' ? data.text : undefined,
          ttsDebug: data.ttsDebug && typeof data.ttsDebug === 'object' ? data.ttsDebug : undefined,
        });
      }
      if (event === 'final') {
        finalResult = {
          text: String(data.text || ''),
          sources: data.sources || [],
          thoughtProcess: data.thoughtProcess || ''
        };
        return true;
      }
      if (event === 'error') runtimeError = String(data.error || 'AI Runtime failed');
      return false;
    };

    let receivedFinal = false;
    let chunkCount = 0;
    let totalBlocksParsed = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) { console.info(`[Bambook SSE] Stream done. chunks=${chunkCount} blocks=${totalBlocksParsed} final=${receivedFinal}`); break; }
      chunkCount++;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        totalBlocksParsed++;
        receivedFinal = handleBlock(block) || receivedFinal;
        if (receivedFinal) break;
      }
      if (receivedFinal) {
        console.info(`[Bambook SSE] Final received after chunk ${chunkCount}, blocks parsed ${totalBlocksParsed}. Canceling reader.`);
        await reader.cancel().catch(() => {});
        break;
      }
    }
    if (!receivedFinal && buffer.trim()) handleBlock(buffer);
    if (runtimeError) throw new Error(runtimeError);
    if (!finalResult) throw new Error('AI Runtime stream ended without final response');
    return finalResult;
  };

  const runRuntimeChat = async (
    userMsg: ChatMessage,
    history: Array<{ role: string; content: string; parts: Array<{ text: string }> }>,
    onStep: (step: string) => void,
    onDelta: (text: string) => void,
    onTtsChunk: (chunk: BackendTtsChunk) => void,
    onAgentEvent: (event: AgentWorkEvent) => void,
    onBlockEvent: (event: AgentBlockStreamEvent) => void,
    signal: AbortSignal
  ) => {
    const apiBase = getRuntimeApiBase();
    const apiKey = getRuntimeApiKey();
    const auth = getAuthState();
    const devHeaders = getAgentRuntimeDevHeaders();
    const authToken = localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token');

    let modifiedMessage = userMsg.text;
    if (activeAgentId === 'translation') {
      modifiedMessage = `[System instructions: You are the Translation Agent. Focus ONLY on translating the user's input to the requested language or polishing their text. Keep explanations brief.]\n\n${userMsg.text}`;
    } else if (activeAgentId === 'analysis') {
      modifiedMessage = `[System instructions: You are the Data Analyst Agent. Use your tools to explore and analyze the user's orders, relationships, database, etc. Deliver professional data analysis.]\n\n${userMsg.text}`;
    } else if (activeAgentId === 'email') {
      modifiedMessage = `[System instructions: You are the Email Assistant. Help the user draft, edit, and reply to business emails. Maintain a professional tone.]\n\n${userMsg.text}`;
    } else if (activeAgentId === 'order') {
      modifiedMessage = `[System instructions: You are the Order Manager. Help the user track, search, and analyze their fabric/garment orders.]\n\n${userMsg.text}`;
    }

    const requestUrl = `${apiBase}/ai/chat`;
    const authMode = !Object.keys(devHeaders).length && authToken ? 'Bearer' : apiKey ? 'API-Key' : 'none';
    console.info('[Bambook Chat] POST', requestUrl, 'authMode:', authMode, 'userId:', auth.user?.id || 'default-user');
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...devHeaders,
        ...(!Object.keys(devHeaders).length && authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(apiKey ? { 'X-Bambook-API-Key': apiKey } : {})
      },
      credentials: 'include',
      signal,
      body: JSON.stringify({
        sessionId: activeSessionIdRef.current,
        userId: auth.user?.id || 'default-user',
        displayName: auth.user?.displayName,
        roles: auth.user?.roles || [],
        departmentIds: auth.user?.departmentIds || [],
        message: modifiedMessage,
        history,
        attachments: userMsg.attachments || [],
        model: selectedModel,
        temperature,
        tts: {
          enabled: isTTSEnabledRef.current,
          voice: 'melo',
          speed: voiceSpeed,
        }
      })
    });
    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) throw new Error('缺少 Bambook API Key，请在设置里填写 SDK API Key。');
      if (response.status === 403) throw new Error('Bambook API Key 不正确，请检查设置里的 SDK API Key。');
      throw new Error(error || `AI Runtime HTTP ${response.status}`);
    }
    return readSseResponse(response, onStep, onDelta, onTtsChunk, onAgentEvent, onBlockEvent);
  };

  const appendAgentEvent = (event: AgentWorkEvent) => {
    const current = assistantRuntimeStore.getSnapshot();
    const nextEvents = current.agentEvents.some(item => item.id === event.id)
      ? current.agentEvents.map(item => item.id === event.id ? event : item)
      : [...current.agentEvents, event];
    // S3 修复：真 Agent 循环每步会发 4-7 个 phase 事件（thought/plan/tool_call_start/end/iteration_*），
    // 13 个工具的多步推理可能轻易超过 18 条；放宽到 200 条避免丢早期 thought/plan。
    assistantRuntimeStore.set({ agentEvents: nextEvents.slice(-200) });
  };

  const getAgentEventToneClass = (event: AgentWorkEvent) => {
    if (event.status === 'complete') {
      return isDarkMode
        ? 'text-white/70'
        : 'text-slate-600';
    }
    if (event.status === 'failed' || event.status === 'blocked') {
      return isDarkMode
        ? 'text-white/55'
        : 'text-slate-500';
    }
    return isDarkMode
      ? 'text-white/70'
      : 'text-slate-600';
  };

  useEffect(() => {
    ttsService.setProvider('custom', getRuntimeApiKey(), `${getTtsApiBase()}/ai/tts/speech`);
    ttsService.setAuthToken(getStoredAuthToken());
  }, []);

  useEffect(() => {
    isTTSEnabledRef.current = isTTSEnabled;
  }, [isTTSEnabled]);

  // Handle TTS Toggle
  const toggleTTS = () => {
    const newState = !isTTSEnabled;
    isTTSEnabledRef.current = newState;
    setIsTTSEnabled(newState);
    if (!newState) {
      // If turning OFF, immediately stop
      ttsService.stop();
    } else {
      // If turning ON, ensure AudioContext is active
      ttsService.resume();
    }
  };

  // [AUTOPLAY FIX] Global One-Time Interaction Listener
  useEffect(() => {
    const unlockAudio = () => {
      // Resume the audio context on first user interaction
      ttsService.resume();
      // Clean up listeners
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Phase 10：粘性自动滚动 —— 用户在底部时跟随新内容；上滚阅读历史时不打断
  const { isPinnedToBottom: isMainPinned, scrollToBottom: scrollMainToBottom } = useStickyScroll(scrollRef, [
    messages,
    thinkingLogs.length,
    agentEvents.length,
  ]);


  const startNewConversation = () => {
    cancelTypingAnimation(false);
    ttsService.stop();
    assistantRuntimeStore.reset();
    setInput('');
    setAttachments([]);
    setHistoryError('');
    cancelRenameSession();
    const next = `assistant-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    sessionIdRef.current = next;
    activeSessionIdRef.current = next;
    setActiveSessionId(next);
    try {
      sessionStorage.setItem('bambookAiSessionId', next);
    } catch {
      // Session persistence is best effort.
    }
  };

  const stopCurrentRun = () => {
    cancelTypingAnimation(true);
    ttsService.stop();
    assistantRuntimeStore.stop();
  };

  const mergeVoiceTextIntoInput = (baseText: string, voiceText: string) => {
    const trimmedBase = baseText.trimEnd();
    const trimmedVoice = voiceText.trim();
    if (!trimmedVoice) return baseText;
    return trimmedBase ? `${trimmedBase}\n${trimmedVoice}` : trimmedVoice;
  };

  const startVoiceInput = async () => {
    if (isLoading || isVoiceRecording) return;
    voiceBaseTextRef.current = input;
    setVoiceStatus('准备语音输入');
    try {
      await localSttService.start({
        onPartial: (text) => {
          setInput(mergeVoiceTextIntoInput(voiceBaseTextRef.current, text));
          setVoiceStatus('正在听写');
        },
        onFinal: (text) => {
          setInput(mergeVoiceTextIntoInput(voiceBaseTextRef.current, text));
          setVoiceStatus(text ? '语音已写入' : '没有识别到内容');
        },
        onStatus: (_status, detail) => {
          if (detail) setVoiceStatus(detail);
        },
      });
      setIsVoiceRecording(true);
    } catch (error: any) {
      setIsVoiceRecording(false);
      setVoiceStatus(error?.message || '语音输入启动失败');
    }
  };

  const stopVoiceInput = async () => {
    if (!isVoiceRecording) return;
    setIsVoiceRecording(false);
    try {
      await localSttService.stop({
        onFinal: (text) => {
          setInput(mergeVoiceTextIntoInput(voiceBaseTextRef.current, text));
          setVoiceStatus(text ? '语音已写入' : '没有识别到内容');
        },
        onStatus: (_status, detail) => {
          if (detail) setVoiceStatus(detail);
        },
      });
    } catch (error: any) {
      setVoiceStatus(error?.message || '语音输入停止失败');
    }
  };

  const toggleVoiceInput = () => {
    if (isVoiceRecording) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  };

  useEffect(() => () => {
    localSttService.cancel();
  }, []);

  const handleSend = async (manualText?: string) => {
    if (isVoiceRecording) return;
    const workspaceContextAttachments = getWorkspaceContextAttachments();
    const requestAttachments = mergeAttachmentContext(attachments, workspaceContextAttachments);
    const textToSend = (manualText || input).trim() || (requestAttachments.length > 0 ? '请读取并处理当前工作区打开的资料。' : '');
    const sendLockKey = buildSendLockKey(textToSend, requestAttachments);
    if ((!textToSend.trim() && requestAttachments.length === 0) || assistantRuntimeStore.getSnapshot().isLoading || isDuplicateSendLocked(sendLockKey)) return;

    sendLockRef.current = { key: sendLockKey, startedAt: Date.now() };

    const userMsg: ChatMessage = {
      role: 'user',
      text: textToSend,
      timestamp: Date.now(),
      attachments: requestAttachments
    };
    const baseMessages = assistantRuntimeStore.getSnapshot().messages;

    setInput('');
    setAttachments([]);
    assistantRuntimeStore.set({
      messages: [...baseMessages, userMsg],
      isLoading: true,
      thinkingLogs: [],
      agentEvents: []
    });

    let currentSessionId = activeSessionIdRef.current;
    const canPersistHistory = Boolean(getStoredAuthToken() && getAuthState().isAuthenticated && getAuthState().user?.id);
    let shouldPersistHistory = canPersistHistory;
    if (canPersistHistory && !sessions.some(session => session.id === currentSessionId)) {
      try {
        const session = await assistantSessionService.createSession(textToSend);
        currentSessionId = session.id;
        activeSessionIdRef.current = session.id;
        sessionIdRef.current = session.id;
        setActiveSessionId(session.id);
        setSessions(prev => [session, ...prev.filter(item => item.id !== session.id)]);
      } catch (error: any) {
        shouldPersistHistory = false;
        setHistoryError(error?.message || '无法创建历史对话');
      }
    }

    const controller = new AbortController();
    assistantRuntimeStore.setController(controller);

    // streamingAssistantId 在 finally 兜底里也要用，提到 try 外。
    const streamingAssistantId = `assistant-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    patchAgentSessionContext({
      sessionId: activeSessionIdRef.current,
      status: 'running',
      inputMode: 'normal',
      activeMessageId: streamingAssistantId,
      activeBlockId: undefined,
      pendingAction: undefined,
    });

    try {
      window.bambookAgent?.publishActivity?.({ active: true, label: '正在思考...', source: 'assistant' }).catch(() => {});

      // Prepare history for API
      const history = baseMessages.map(m => ({
        role: m.role,
        content: m.text,
        parts: [{ text: m.text }]
      }));
      let streamingText = '';
      let hasAssistantMessage = false;
      let hasBackendTtsChunk = false;
      let firstDeltaClientAt = 0;
      let firstTtsChunkClientAt = 0;
      let firstTtsChunkDebug: TtsChunkDebug | undefined;
      let firstAudioStartLogged = false;
      let isShowingThinking = false; // 当 Agent 思考过程正在显示时为 true
      let streamingThoughtText = '';
      // ── 实时过程文本流 ──
      // Phase 11: agent-process 注释行流已退役，过程信息由 Phase 1 SSE block 协议（tool/evidence block）唯一权威呈现。
      const setAssistantDraft = (text: string, isTyping = true, patch: Partial<ChatMessage> = {}) => {
        const current = assistantRuntimeStore.getSnapshot();
        if (!hasAssistantMessage) {
          hasAssistantMessage = true;
          assistantRuntimeStore.set({
            messages: [
              ...current.messages,
              {
                id: streamingAssistantId,
                role: 'model',
                text,
                timestamp: Date.now(),
                isTyping,
                ...patch,
              } as ChatMessage,
            ],
          });
          return;
        }
        assistantRuntimeStore.set({
          messages: current.messages.map(message => (
            message.id === streamingAssistantId
              ? { ...message, text, isTyping, ...patch }
              : message
          )),
        });
      };

      const applyBlockStreamEvent = (blockEvent: AgentBlockStreamEvent) => {
        // ── Debug: log every block event for approval diagnosis ──
        if (blockEvent.event === 'block_start') {
          console.info('[Bambook Block]', blockEvent.event, (blockEvent.block as any)?.type, (blockEvent.block as any)?.toolId ?? '', (blockEvent.block as any)?.approvalId ?? '');
        }
        const isAnswerBlockStart = blockEvent.event === 'block_start' && blockEvent.block.type !== 'approval';
        if (isAnswerBlockStart && isShowingThinking) {
          streamingText = '';
          streamingThoughtText = '';
          isShowingThinking = false;
        }
        if (!hasAssistantMessage) {
          setAssistantDraft(streamingText, true);
        }
        const approvalBlock = blockEvent.event === 'block_start' && blockEvent.block.type === 'approval'
          ? blockEvent.block
          : null;
        if (approvalBlock) {
          console.info('[Bambook Approval] Setting blocked_for_approval, approvalId:', approvalBlock.approvalId);
        }
        // 关键修复：patchAgentSessionContext 做 {...prev, ...patch}，
        // 如果 patch 里有 status: undefined，会把之前的 blocked_for_approval 覆盖为 undefined！
        // 所以非 approval block 的 patch 绝不包含 status/inputMode/pendingApprovalId 键。
        const patchObj: Partial<AgentSessionContext> = {
          activeMessageId: streamingAssistantId,
          activeBlockId: 'blockId' in blockEvent ? blockEvent.blockId : blockEvent.block.id,
        };
        if (blockEvent.event === 'block_start' && blockEvent.block.type === 'artifact') {
          patchObj.activeArtifactId = blockEvent.block.artifactId;
        }
        if (approvalBlock) {
          patchObj.pendingApprovalId = approvalBlock.approvalId;
          patchObj.status = 'blocked_for_approval';
          patchObj.inputMode = 'approval_comment';
        }
        patchAgentSessionContext(patchObj);
        const current = assistantRuntimeStore.getSnapshot();
        assistantRuntimeStore.set({
          messages: current.messages.map(message => (
            message.id === streamingAssistantId
              ? {
                ...message,
                blocks: reduceAgentBlocks(message.blocks ?? [], blockEvent),
                isTyping: true,
              }
              : message
          )),
        });
      };
      if (isTTSEnabledRef.current) {
        ttsService.setAuthToken(getStoredAuthToken());
        ttsService.beginBackendStreaming({
          onAudioStart: (info) => {
            if (firstAudioStartLogged || !firstDeltaClientAt) return;
            firstAudioStartLogged = true;
            const round = (value: number | null | undefined) => (
              typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
            );
            console.info('[TTS Sync]', {
              segmentId: info.segmentId,
              chars: firstTtsChunkDebug?.chars ?? null,
              clientDeltaToFirstChunkMs: round(firstTtsChunkClientAt ? firstTtsChunkClientAt - firstDeltaClientAt : null),
              clientDeltaToAudioStartMs: round(info.estimatedAudioStartClientAt - firstDeltaClientAt),
              clientChunkToAudioStartMs: round(firstTtsChunkClientAt ? info.estimatedAudioStartClientAt - firstTtsChunkClientAt : null),
              serverDeltaToSynthesisStartMs: round(firstTtsChunkDebug?.firstDeltaToSynthesisStartMs),
              serverDeltaToChunkMs: round(firstTtsChunkDebug?.firstDeltaToChunkServerMs),
              serverQueuedToSynthesisStartMs: round(firstTtsChunkDebug?.queuedToSynthesisStartMs),
              serverSynthesisMs: round(firstTtsChunkDebug?.synthesisMs),
            });
          },
        });
      }

      const result = await runRuntimeChat(
        userMsg,
        history,
        (step) => {
          const current = assistantRuntimeStore.getSnapshot();
          assistantRuntimeStore.set({ thinkingLogs: [...current.thinkingLogs, step] });
        },
        (delta) => {
          if (!firstDeltaClientAt) firstDeltaClientAt = performance.now();
          // 最终回答到达时，清空思考过程，从空白开始写最终回答
          if (isShowingThinking) {
            streamingText = '';
            isShowingThinking = false;
          }
          streamingText += delta;
          setAssistantDraft(streamingText, true);
        },
        (chunk) => {
          if (!isTTSEnabledRef.current) return;
          hasBackendTtsChunk = true;
          if (!firstTtsChunkClientAt) {
            firstTtsChunkClientAt = performance.now();
            firstTtsChunkDebug = chunk.ttsDebug;
          }
          ttsService.enqueueBackendAudioChunk(chunk);
        },
        (event) => {
          appendAgentEvent(event);
          // 透传给悬浮宠物：tool_call_start（agentLoop 路径）/ tool_call（旧 orchestrator 路径）→ 显示工具名；
          // 工具执行结束（tool_call_end / tool_result）→ 回到"正在思考..."。
          if ((event.phase === 'tool_call_start' || event.phase === 'tool_call') && event.toolId) {
            window.bambookAgent?.publishActivity?.({ active: true, label: `执行技能: ${event.toolId}`, source: 'assistant' }).catch(() => {});
          } else if (event.phase === 'tool_call_end' || event.phase === 'tool_result') {
            window.bambookAgent?.publishActivity?.({ active: true, label: '正在思考...', source: 'assistant' }).catch(() => {});
          }

          // ── agentLoop 思考过程实时显示 ──
          // agentLoop 的 thought/plan/tool_call 事件没有对应 block_start，
          // 把 LLM 的思考内容实时显示在对话区域，让用户看到 Agent 在"想什么、做什么"。
          // 这不是机械的状态码，而是 Agent 的自然语言叙述。
          const updateThinkingDisplay = (lines: string[]) => {
            if (lines.length === 0) return;
            const narrative = lines.map(line => `> ${line}`).join('\n');
            streamingText = narrative + '\n';
            isShowingThinking = true;
            setAssistantDraft(streamingText, true);
          };

          if (event.phase === 'thought_delta') {
            const delta = String(event.metadata?.delta ?? event.message ?? '');
            if (delta) {
              streamingThoughtText += delta;
              updateThinkingDisplay([`💭 ${streamingThoughtText.trim()}`]);
            }
          }
          if (event.phase === 'thought' && event.message) {
            const thoughtText = event.message.trim();
            if (thoughtText) {
              streamingThoughtText = thoughtText;
              updateThinkingDisplay([`💭 ${thoughtText}`]);
            }
          }
          if (event.phase === 'plan' && event.metadata?.plan) {
            const planItems = event.metadata.plan as Array<{ toolId: string; why?: string }>;
            if (planItems.length > 0) {
              updateThinkingDisplay(planItems.map(item =>
                `🔧 准备调用 ${item.toolId}${item.why ? ' — ' + item.why : ''}`,
              ));
            }
          }
          if (event.phase === 'tool_call_start' && event.toolId) {
            const why = (event as any).message || event.metadata?.why || '';
            updateThinkingDisplay([`⏳ 正在执行 ${event.toolId}${why ? ' — ' + why : ''}`]);
          }
          if (event.phase === 'tool_call_end' && event.toolId) {
            if (event.status === 'complete') {
              const summary = (event as any).summary || event.metadata?.outputSummary || '已完成';
              updateThinkingDisplay([`✅ ${event.toolId} 完成 — ${summary}`]);
            } else if (event.status === 'failed') {
              const errMsg = (event as any).message || event.metadata?.error?.message || '执行失败';
              updateThinkingDisplay([`❌ ${event.toolId} 失败 — ${errMsg}`]);
            }
          }
        },
        applyBlockStreamEvent,
        controller.signal
      );
      if (isTTSEnabledRef.current) {
        ttsService.endBackendStreaming();
        if (!hasBackendTtsChunk) {
          if (firstDeltaClientAt) {
            console.info('[TTS Sync]', {
              mode: 'fallback-full-text',
              reason: 'no backend tts_chunk received before final',
              clientDeltaToFinalBeforeFallbackMs: Math.round(performance.now() - firstDeltaClientAt),
            });
          }
          ttsService.setAuthToken(getStoredAuthToken());
          ttsService.speak(result.text, { voiceSpeed }).catch(e => console.error("TTS fallback auto-read failed", e));
        }
      }

      const finalEvent: AgentWorkEvent = {
        id: `agent_final_client_${Date.now()}`,
        at: new Date().toISOString(),
        phase: 'final',
        status: 'complete',
        title: '任务完成',
        message: '本轮任务已经完成。',
      };
      appendAgentEvent(finalEvent);
      // S3 修复：把所有残留 running 事件强制收敛为 complete，避免历史消息卡片
      // 一直显示"初始化任务上下文 / 规划执行步骤"在转圈。
      const completedEvents = finalizeAgentEvents(
        assistantRuntimeStore.getSnapshot().agentEvents,
        { force: true },
      );
      const currentStreamingMessage = assistantRuntimeStore.getSnapshot().messages.find(message => message.id === streamingAssistantId);
      const thoughtProcess = result.thoughtProcess || buildAgentThoughtProcessText(completedEvents, assistantRuntimeStore.getSnapshot().thinkingLogs);
      const aiMsg: ChatMessage = {
        id: streamingAssistantId,
        role: 'model',
        text: result.text,
        timestamp: Date.now(),
        blocks: currentStreamingMessage?.blocks,
        sources: result.sources,
        thoughtProcess,
        agentEvents: completedEvents.length > 0 ? completedEvents : undefined
      };

      // 检查当前是否有待审批的 block —— 如果有，保持 blocked_for_approval 状态
      const snapshotBeforePatch = assistantRuntimeStore.getSnapshot();
      const hasPendingApproval = snapshotBeforePatch.agentSessionContext?.pendingApprovalId
        || (currentStreamingMessage?.blocks ?? []).some(b => b.type === 'approval' && (b as any).approvalStatus === 'pending');

      if (hasPendingApproval) {
        // 审批拦截：不要覆盖 blocked_for_approval 状态
        patchAgentSessionContext({
          status: 'blocked_for_approval',
          inputMode: 'approval_comment',
          activeMessageId: streamingAssistantId,
          // 保留 pendingApprovalId 和 pendingAction，不覆盖
        });
      } else {
        patchAgentSessionContext({
          status: 'completed',
          inputMode: 'normal',
          activeMessageId: streamingAssistantId,
          activeBlockId: undefined,
          pendingApprovalId: undefined,
          pendingAction: undefined,
        });
      }

      if (shouldPersistHistory) refreshSessions();
      if (hasAssistantMessage) {
        const current = assistantRuntimeStore.getSnapshot();
        assistantRuntimeStore.set({
          messages: current.messages.map(message => (
            message.id === streamingAssistantId ? { ...aiMsg, isTyping: false } : message
          )),
        });
      } else {
        await revealAssistantMessage(aiMsg);
      }

    } catch (error) {
      if (isTTSEnabledRef.current) {
        ttsService.stop();
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        const snapshot = assistantRuntimeStore.getSnapshot();
        // S3 修复：中止时同样强制收敛 running 事件，避免最后一条历史消息卡转圈。
        const stoppedEvents = finalizeAgentEvents(snapshot.agentEvents, { force: true });
        assistantRuntimeStore.set({
          messages: snapshot.messages.map((message, index, list) => (
            index === list.length - 1 && message.role === 'model' && message.isTyping
              ? {
                ...message,
                isTyping: false,
                thoughtProcess: message.thoughtProcess || buildAgentThoughtProcessText(stoppedEvents, snapshot.thinkingLogs),
                agentEvents: stoppedEvents.length > 0 ? stoppedEvents : message.agentEvents,
              }
              : message
          )),
        });
        patchAgentSessionContext({ status: 'idle', inputMode: 'normal', activeBlockId: undefined, pendingAction: undefined });
        return;
      }
      const errorMsg: ChatMessage = {
        role: 'model',
        text: error instanceof Error && error.message ? error.message : '连接不稳定。请稍后再试。',
        timestamp: Date.now()
      };
      appendAgentEvent({
        id: `agent_error_${Date.now()}`,
        at: new Date().toISOString(),
        phase: 'error',
        status: 'failed',
        title: '执行失败',
        message: errorMsg.text,
      });
      const current = assistantRuntimeStore.getSnapshot().messages;
      assistantRuntimeStore.set({ messages: [...current, errorMsg] });
      patchAgentSessionContext({ status: 'failed', inputMode: 'normal', activeBlockId: undefined, pendingAction: undefined });
      if (shouldPersistHistory) refreshSessions();
    } finally {
      assistantRuntimeStore.set({ isLoading: false });
      assistantRuntimeStore.setController(null);
      if (sendLockRef.current?.key === sendLockKey) sendLockRef.current = null;
      window.bambookAgent?.publishActivity?.({ active: false, source: 'assistant' }).catch(() => {});

      // S3 修复：提供最底层的兜底机制，确保不论报错还是提前中断，只要结束了，
      // 流式消息必定取消 isTyping 且其 agentEvents 收敛掉所有残留 running，彻底消灭转圈 Bug。
      const finalSnapshot = assistantRuntimeStore.getSnapshot();
      assistantRuntimeStore.set({
        messages: finalSnapshot.messages.map((m) => {
          if (m.id !== streamingAssistantId) return m;
          if (!m.isTyping && (!m.agentEvents || !m.agentEvents.some(e => e.status === 'running'))) return m;
          return {
            ...m,
            isTyping: false,
            agentEvents: m.agentEvents
              ? finalizeAgentEvents(m.agentEvents, { force: true })
              : m.agentEvents,
          };
        }),
      });
    }
  };

  const loadSession = async (sessionId: string) => {
    if (isLoading) return;
    setActiveAgentId('default');
    cancelTypingAnimation(false);
    ttsService.stop();
    setHistoryError('');

    // 1. 同步乐观读取本地缓存消息，实现零延迟“秒开”
    const cachedMessages = readMessagesCache(sessionId);
    activeSessionIdRef.current = sessionId;
    sessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    try {
      sessionStorage.setItem('bambookAiSessionId', sessionId);
    } catch {
      // Session persistence is best effort.
    }

    // 若有缓存立即渲染；若无缓存则清空，等待网络同步
    assistantRuntimeStore.set({
      messages: cachedMessages,
      thinkingLogs: [],
      agentEvents: [],
      isLoading: false
    });

    // 2. 异步向后端拉取最新的消息数据，静默覆盖并更新缓存
    try {
      const data = await assistantSessionService.loadMessages(sessionId);
      
      // 确认在异步返回时，用户仍留在当前选中的会话上
      if (activeSessionIdRef.current === sessionId) {
        assistantRuntimeStore.set({
          messages: data.messages,
          thinkingLogs: [],
          agentEvents: [],
          isLoading: false
        });
        saveMessagesCache(sessionId, data.messages);
        setSessions(prev => prev.map(item => item.id === data.session.id ? data.session : item));
      }
    } catch (error: any) {
      // 仅在本地没有任何缓存的情况下，才将网络错误抛给 UI（增强弱网下的韧性）
      if (cachedMessages.length === 0) {
        setHistoryError(error?.message || '无法加载历史对话');
      } else {
        console.warn('Silent messages sync failed:', error);
      }
    }
  };

  const beginRenameSession = (session: AssistantSessionSummary) => {
    setHistoryError('');
    setSessionMenuId(null);
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title || '未命名对话');
  };

  const cancelRenameSession = () => {
    setEditingSessionId(null);
    setEditingSessionTitle('');
  };

  const submitRenameSession = async (sessionId: string) => {
    const nextTitle = editingSessionTitle.trim();
    if (!nextTitle) {
      setHistoryError('标题不能为空');
      return;
    }
    setSessionActionId(sessionId);
    setHistoryError('');
    try {
      const updated = await assistantSessionService.updateSessionTitle(sessionId, nextTitle);
      setSessions(prev => prev.map(item => item.id === sessionId ? updated : item));
      cancelRenameSession();
    } catch (error: any) {
      setHistoryError(error?.message || '无法重命名历史对话');
    } finally {
      setSessionActionId(null);
    }
  };

  const archiveSession = async (sessionId: string) => {
    if (isLoading) return;
    setSessionActionId(sessionId);
    setSessionMenuId(null);
    setHistoryError('');
    try {
      await assistantSessionService.archiveSession(sessionId);
      setSessions(prev => prev.filter(item => item.id !== sessionId));
      try {
        localStorage.removeItem(`bambook:assistant-session-messages:${sessionId}`);
      } catch {}
      if (sessionId === activeSessionId) startNewConversation();
    } catch (error: any) {
      setHistoryError(error?.message || '无法归档历史对话');
    } finally {
      setSessionActionId(null);
    }
  };

  const copyMessageText = async (messageKey: string | number, text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
          textarea.select();
          document.execCommand('copy');
        } finally {
          document.body.removeChild(textarea);
        }
      }
      setCopiedMessageKey(messageKey);
      window.setTimeout(() => {
        setCopiedMessageKey(current => current === messageKey ? null : current);
      }, 1400);
    } catch {
      setHistoryError('复制失败，请手动选择文本复制');
    }
  };

  // 编辑用户提问：截断该消息之后的历史（含对应 AI 回复 / 工具记录），
  // 再以新文本复用 handleSend 重新生成 —— 与 ChatGPT / Claude 的"编辑并重新发送"一致。
  // 注意：后端 session 持久化层目前只有"追加消息"和"整段归档"，没有单条截断 API，
  // 所以重发后 AI 拿到的 history 是正确的（前端截断后构造），但后端 session 会保留旧分支。
  const editUserMessage = async (messageKey: string | number, newText: string) => {
    // 若有正在进行的流式请求，先中断，避免双发
    assistantRuntimeStore.stop();

    const snapshot = assistantRuntimeStore.getSnapshot();
    const editedIndex = snapshot.messages.findIndex((m, i) => (m.id ?? i) === messageKey);
    if (editedIndex === -1) return;

    assistantRuntimeStore.set({
      messages: snapshot.messages.slice(0, editedIndex),
      agentEvents: [],
      thinkingLogs: [],
    });

    // 重置发送锁，避免窗口期内被 isDuplicateSendLocked 误判为重复发送
    sendLockRef.current = null;

    void handleSend(newText);
  };

  useEffect(() => {
    if (isLoading || messages.length > 0 || sessions.length === 0) return;
    if (!sessions.some(session => session.id === activeSessionId)) return;
    loadSession(activeSessionId);
  }, [activeSessionId, sessions, isLoading, messages.length]);

  useEffect(() => {
    if (!sessionMenuId) return;
    const closeMenu = () => setSessionMenuId(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', closeMenu);
    };
  }, [sessionMenuId]);

  useEffect(() => {
    if (!isAgentFullscreen) return;
    const exitFullscreen = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAgentFullscreen(false);
    };
    window.addEventListener('keydown', exitFullscreen);
    return () => window.removeEventListener('keydown', exitFullscreen);
  }, [isAgentFullscreen]);

  useEffect(() => {
    saveAssistantWorkspaceState({ isAgentFullscreen });
  }, [isAgentFullscreen]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const previewUrl = event.target.result as string;
          const workspaceId = `workspace-file-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
          const base64 = (event.target.result as string).split(',')[1];
          const attachment = {
            name: file.name,
            mimeType: file.type,
            data: base64,
            previewUrl
          };
          setAttachments(prev => [...prev, attachment]);
          openWorkspaceItem({
            id: workspaceId,
            kind: getWorkspaceKindForAttachment(file.type),
            title: file.name,
            subtitle: file.type || '本地文件',
            mimeType: file.type,
            data: base64,
            previewUrl,
            attachmentName: file.name
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const activeAttachment =
    attachments[0] ||
    [...messages].reverse().find(message => message.attachments?.length)?.attachments?.[0] ||
    null;
  const activeWorkspaceItem =
    workspaceItems.find(item => item.id === activeWorkspaceItemId) ||
    workspaceItems[0] ||
    null;

  useEffect(() => {
    if (isWorkspaceFinderOpen) return;
    if (activeWorkspaceItem?.url) {
      setWorkspaceAddressInput(activeWorkspaceItem.url);
      return;
    }
    if (activeWorkspaceItem?.title) {
      setWorkspaceAddressInput(activeWorkspaceItem.title);
      return;
    }
    setWorkspaceAddressInput('');
  }, [activeWorkspaceItem?.id, activeWorkspaceItem?.title, activeWorkspaceItem?.url, isWorkspaceFinderOpen]);

  const activeObjectType = activeAttachment?.mimeType?.includes('pdf')
    ? 'PDF'
    : activeAttachment?.mimeType?.startsWith('image/')
      ? 'Image'
      : 'Document';
  const currentAgentStatusText = getAgentLiveStatusText(agentEvents, isLoading);
  const currentAgentEvent = agentEvents[agentEvents.length - 1];
  const titleTextClass = isDarkMode ? 'text-white' : 'text-slate-900';
  const bodyTextClass = isDarkMode ? 'text-white/72' : 'text-slate-700';
  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const labelTextClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const panelDividerClass = isDarkMode ? BAMBOOK_OS.tone.divider.panelDark : BAMBOOK_OS.tone.divider.panelLight;
  const sectionDividerClass = isDarkMode ? BAMBOOK_OS.tone.divider.sectionDark : BAMBOOK_OS.tone.divider.sectionLight;
  const actionControlClass = isDarkMode ? BAMBOOK_OS.controls.actionControl.borderedDark : BAMBOOK_OS.controls.actionControl.borderedLight;
  const fieldClass = isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light;
  const inlineSurfaceClass = `${OS_MATERIAL.insetSurface} rounded-inset border`;
  const workspaceTabClass = (selected: boolean) => selected
    ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light)
    : `border-transparent ${isDarkMode ? 'text-white/50 hover:text-white/82 hover:bg-white/[0.04]' : 'text-slate-500 hover:text-slate-900 hover:bg-white/35'}`;
  const agentFullscreenBackgroundClass = isDarkMode ? 'bg-[#070D15]' : 'bg-[#D8DEE7]';
  const agentRootClass = isAgentFullscreen
    ? `fixed inset-0 z-[420] flex h-dvh min-h-0 flex-col overflow-hidden ${agentFullscreenBackgroundClass}`
    : 'flex h-full min-h-0 w-full flex-col overflow-hidden';
  const agentPanelRowClass = isAgentFullscreen
    ? 'flex flex-1 min-h-0 w-full'
    : 'flex h-full min-h-0 w-full overflow-hidden';
  const agentPanelClass = isAgentFullscreen
    ? 'bambook-agent-fullscreen-surface flex-1 min-w-0 h-full'
    : 'flex-1 min-w-0 h-full';
  const formatSessionTime = (value: string) => {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return '';
    const today = new Date();
    const isToday = time.toDateString() === today.toDateString();
    if (isToday) {
      return time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return time.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  };

  // State for workspace sidebar
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(() => readAssistantWorkspaceState().isWorkspaceOpen ?? false);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => readAssistantWorkspaceState().workspaceWidth ?? 480);
  const [isResizing, setIsResizing] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => readAssistantWorkspaceState().isHistoryOpen ?? true);
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);

  // Phase 7 / Task 59 — Agent 工具 manifest（左栏工具栏数据源）
  const [agentToolCatalog, setAgentToolCatalog] = useState<AgentToolCatalog | null>(null);
  const [agentToolCatalogStatus, setAgentToolCatalogStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [agentToolCatalogError, setAgentToolCatalogError] = useState<string | undefined>(undefined);

  const loadAgentToolCatalog = React.useCallback(async () => {
    setAgentToolCatalogStatus('loading');
    setAgentToolCatalogError(undefined);
    try {
      const response = await fetch(`${getRuntimeApiBase()}/agent/mcp/manifest`, {
        method: 'GET',
        headers: getWorkspaceAuthHeaders(),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || `manifest 加载失败 (${response.status})`);
      }
      const catalog = normalizeAgentManifestResponse(data);
      if (!catalog) {
        throw new Error('manifest 响应格式无效');
      }
      setAgentToolCatalog(catalog);
      setAgentToolCatalogStatus('loaded');
    } catch (error: any) {
      setAgentToolCatalog(null);
      setAgentToolCatalogStatus('error');
      setAgentToolCatalogError(error?.message || '工具目录加载失败');
    }
  }, []);

  useEffect(() => {
    void loadAgentToolCatalog();
  }, [loadAgentToolCatalog]);


  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    
    const startX = e.clientX;
    const startWidth = workspaceWidth;
    let currentWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const newWidth = startWidth - dx;
      
      const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const isLg = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
      const sidebarWidth = (isLg && isHistoryOpen) ? 224 : 0;
      const minDialogueWidth = 400; // 对话区域最小宽度限制
      const maxWorkspaceWidth = Math.max(320, containerWidth - sidebarWidth - minDialogueWidth - 5);
      const maxLimit = Math.min(800, maxWorkspaceWidth);

      if (newWidth >= 320 && newWidth <= maxLimit) {
        currentWidth = newWidth;
        setWorkspaceWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      saveAssistantWorkspaceState({ workspaceWidth: currentWidth });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    saveAssistantWorkspaceState({ isWorkspaceOpen });
  }, [isWorkspaceOpen]);

  useEffect(() => {
    saveAssistantWorkspaceState({ isHistoryOpen });
  }, [isHistoryOpen]);

  return (
    <motion.div
      layout
      transition={BAMBOOK_OS.motion.layoutTransition}
      className={agentRootClass}
      data-agent-fullscreen={isAgentFullscreen ? 'true' : 'false'}
    >
      {/* 设置抽屉 — 从左栏齿轮按钮触发 */}
      <SettingsDrawer
        isOpen={isSettingsDrawerOpen}
        onClose={() => setIsSettingsDrawerOpen(false)}
        catalog={agentToolCatalog}
        catalogStatus={agentToolCatalogStatus}
        catalogError={agentToolCatalogError}
        onRetryCatalog={() => void loadAgentToolCatalog()}
        isDarkMode={isDarkMode}
      />
      <motion.div
        layout
        transition={BAMBOOK_OS.motion.layoutTransition}
        className={agentPanelRowClass}
      >
        <div className={`${agentPanelClass} relative z-10 flex min-h-0 flex-row overflow-hidden`}>
          {/* Left Column: History */}
          <div className={`order-1 shrink-0 flex flex-col border-r hidden lg:flex transition-all duration-300 ease-in-out overflow-hidden ${isHistoryOpen ? 'w-56 opacity-100' : 'w-0 opacity-0 border-none'} ${panelDividerClass}`}>
            <div className="w-56 flex flex-col h-full min-h-0">
              <div
                className={`min-h-12 shrink-0 border-b px-3.5 py-1.5 flex items-center ${panelDividerClass} ${isAgentFullscreen ? 'pl-16' : ''}`}
                style={isAgentFullscreen ? { WebkitAppRegion: 'drag' } as React.CSSProperties : { WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <BambookLowercaseWordmark
                  isDarkMode={isDarkMode}
                  className="h-7 w-auto select-none pointer-events-none"
                  style={{ marginLeft: '2px' }}
                />
              </div>
	              <div className="flex-1 flex flex-col space-y-4 px-2.5 py-3 min-h-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveAgentId('default');
                        startNewConversation();
                      }}
                      className={`-mt-[10px] w-[calc(100%-4px)] mx-auto h-8 shrink-0 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-light transition-all no-drag ${actionControlClass}`}
                      title="新建对话"
                    >
                      <Plus size={13} strokeWidth={1.5} className="shrink-0" />
                      <span>新建对话</span>
                    </button>

                    <div className="-mt-[8px] flex flex-col min-h-0 shrink-0 space-y-1.5 no-drag">
                      <div className={`px-2 text-[10px] uppercase ${BAMBOOK_OS.typography.tracking.overline} font-light ${labelTextClass}`}>Agent 功能</div>
                      <div className="relative min-h-0">
                        <ScrollEdgeFades scrollRef={agentScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
                        <div ref={agentScrollRef} className="max-h-[180px] overflow-y-auto custom-scrollbar space-y-1 pr-0.5">
                          {AGENTS.map(agent => {
                            const Icon = agent.icon;
                            const isActive = activeAgentId === agent.id;
                            return (
                              <button
                                key={agent.id}
                                type="button"
                                onClick={() => selectAgent(agent.id)}
                                className={`w-full rounded-xl px-2.5 py-2 flex items-center gap-3 text-left transition-all ${
                                  isActive
                                    ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light)
                                    : `hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-slate-600 dark:text-slate-300`
                                }`}
                              >
                                <Icon size={14} strokeWidth={1.35} className={`shrink-0 ${
                                  isActive
                                    ? (isDarkMode ? 'text-white' : 'text-slate-800')
                                    : 'text-slate-400 dark:text-slate-500'
                                }`} />
                                <div className="min-w-0 flex-1">
                                  <div className={`text-[12px] font-light leading-4 ${isActive ? (isDarkMode ? 'text-white' : 'text-slate-900') : 'text-slate-700 dark:text-slate-200'}`}>{agent.name}</div>
                                  <div className={`text-[10px] font-light leading-3 truncate ${isActive ? (isDarkMode ? 'text-white/60' : 'text-slate-500') : 'text-slate-400 dark:text-slate-500'}`}>{agent.desc}</div>
                                </div>
                              </button>
                            );
                          })}
                          <div className="pt-1 px-0.5">
                            <button
                              type="button"
                              onClick={() => showToast('Agent 功能商店即将上线，敬请期待！')}
                              className={`w-full h-8 shrink-0 rounded-xl border border-dashed flex items-center justify-center gap-1.5 text-[11px] font-light transition-all no-drag ${actionControlClass}`}
                            >
                              <Plus size={12} strokeWidth={1.5} className="shrink-0" />
                              <span>添加 Agent 功能</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 flex flex-col min-h-0 mt-[20px] pt-3 border-t border-dashed border-slate-200 dark:border-slate-800 no-drag">
                      <div className={`px-2 text-[10px] uppercase ${BAMBOOK_OS.typography.tracking.overline} font-light mb-1.5 shrink-0 ${labelTextClass}`}>最近对话</div>
                      {isHistoryLoading && sessions.length === 0 && (
                        <div className={`rounded-xl border px-2.5 py-2 text-[11px] shrink-0 ${actionControlClass}`}>正在加载...</div>
                      )}
                      {!isHistoryLoading && historyError && (
                        <div className={`rounded-xl border px-2.5 py-2 text-[11px] leading-4 shrink-0 ${isDarkMode ? 'border-white/10 bg-white/5 text-white/55' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                          {historyError === 'Login required.' ? '登录后显示个人历史对话。' : historyError}
                        </div>
                      )}
                      {!isHistoryLoading && !historyError && sessions.length === 0 && (
                        <div className={`rounded-xl border px-2.5 py-2 text-[11px] leading-4 shrink-0 ${actionControlClass}`}>还没有历史对话。</div>
                      )}
                      <div className="relative flex-1 min-h-0">
                        <ScrollEdgeFades scrollRef={historyScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
                        <div ref={historyScrollRef} className="absolute inset-0 overflow-y-auto custom-scrollbar space-y-1 pr-0.5">
                          {sessions.map(session => {
                            const isActive = session.id === activeSessionId;
                            const isEditing = editingSessionId === session.id;
                            const isActing = sessionActionId === session.id;
                            return (
                              <CompiledInteractiveCard
                                key={session.id}
                                as="div"
                                compilerRole="history-item"
                                source="Assistant.history"
                                idleSpotlightOpacity={0}
                                className={`w-full rounded-xl text-left transition-all ${isActive ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light) : ''}`}
                              >
                                {isEditing ? (
                                  <div className="p-2">
                                    <input
                                      value={editingSessionTitle}
                                      onChange={(event) => setEditingSessionTitle(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          submitRenameSession(session.id);
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          cancelRenameSession();
                                        }
                                      }}
                                      autoFocus
                                      className={`h-7 w-full rounded-[12px] border bg-transparent px-2 text-[12px] font-light outline-none ${fieldClass}`}
                                    />
                                    <div className="mt-1.5 flex justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={cancelRenameSession}
                                        className={`h-6 w-6 rounded-[10px] border flex items-center justify-center ${actionControlClass}`}
                                        title="取消"
                                      >
                                        <X size={12} strokeWidth={1.4} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isActing}
                                        onClick={() => submitRenameSession(session.id)}
                                        className={`h-6 w-6 rounded-[10px] border flex items-center justify-center disabled:opacity-40 ${actionControlClass}`}
                                        title="保存名称"
                                      >
                                        <Check size={12} strokeWidth={1.4} />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="group relative">
                                    <button
                                      type="button"
                                      onClick={() => loadSession(session.id)}
                                      className="block min-h-10 w-full py-1.5 pl-2.5 pr-[32px] text-left"
                                    >
                                      <div className={`truncate text-[12px] font-light leading-4 ${isDarkMode ? 'text-white/[0.84]' : 'text-slate-800'}`}>{session.title}</div>
                                      <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] font-light leading-3 ${quietTextClass}`}>
                                        <span>{formatSessionTime(session.updatedAt)}</span>
                                        {typeof session.messageCount === 'number' && <span className="truncate">{session.messageCount} 条</span>}
                                      </div>
                                    </button>
                                    <div className={`absolute right-1.5 top-0 bottom-0 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${isActive ? 'group-hover:opacity-100' : ''}`}>
                                       <button
                                         type="button"
                                         onClick={(e) => { e.stopPropagation(); beginRenameSession(session); }}
                                         className={`p-0.5 transition-colors ${isDarkMode ? 'text-white/40 hover:text-white/80' : 'text-slate-400 hover:text-slate-700'}`}
                                         title="重命名"
                                       >
                                         <Pencil size={11} strokeWidth={1.4} />
                                       </button>
                                       <button
                                         type="button"
                                         disabled={isActing}
                                         onClick={(e) => { e.stopPropagation(); archiveSession(session.id); }}
                                         className={`p-0.5 transition-colors disabled:opacity-40 ${isDarkMode ? 'text-white/40 hover:text-white/55' : 'text-slate-400 hover:text-slate-500'}`}
                                         title="删除"
                                       >
                                         <Trash2 size={11} strokeWidth={1.4} />
                                       </button>
                                     </div>
                                     {isActive && (
                                       <div className="absolute right-1.5 top-0 bottom-0 flex items-center pointer-events-none group-hover:opacity-0 transition-opacity">
                                         <ChevronRight size={14} strokeWidth={1.25} className={isDarkMode ? 'text-white/[0.45]' : 'text-slate-400'} />
                                       </div>
                                     )}
                                  </div>
                                )}
                              </CompiledInteractiveCard>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 底部设置按钮 */}
                  <div className={`shrink-0 border-t px-2.5 py-2 flex items-center gap-2 ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/70'}`}>
                    <button
                      type="button"
                      onClick={() => setIsSettingsDrawerOpen(true)}
                      className={`w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors no-drag ${isDarkMode ? 'hover:bg-white/[0.04] text-white/50' : 'hover:bg-slate-100 text-slate-500'}`}
                      title="设置"
                    >
                      <Settings size={14} strokeWidth={1.4} className="shrink-0" />
                      <span className="text-[11px] font-light">设置</span>
                    </button>
                  </div>
                </div>
          </div>

          {/* Resize Handler / Splitter between Dialogue and Workspace */}
          {isWorkspaceOpen && (
            <div
              className="order-3 w-[5px] shrink-0 h-full cursor-col-resize transition-all relative group z-[50] no-drag"
              onMouseDown={handleResizeStart}
            >
              {/* Inner visual separator line */}
              <div className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] group-hover:w-[2px] group-active:w-[2px] transition-all ${isDarkMode ? 'bg-white/10 group-hover:bg-[var(--os-vnext-brand-blue-soft)]' : 'bg-slate-200 group-hover:bg-[var(--os-vnext-brand-blue-strong)]'}`} />
            </div>
          )}

          {/* Right Column (when open): Workspace */}
          <div
            className={`order-4 flex flex-col overflow-hidden ${isResizing ? 'transition-none' : 'transition-[width,opacity] duration-300 ease-in-out'} ${isWorkspaceOpen ? 'shrink-0 border-l ' + panelDividerClass + ' opacity-100' : 'opacity-0 border-none'}`}
            style={{ width: isWorkspaceOpen ? `${workspaceWidth}px` : '0px' }}
          >
            <div className="w-full min-w-0 h-full flex flex-col">
              <div
                className={`shrink-0 border-b ${panelDividerClass}`}
                style={isAgentFullscreen ? { WebkitAppRegion: 'drag' } as React.CSSProperties : { WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <div className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                  <div className="flex shrink-0 items-center gap-1 no-drag">
                    <button
                      type="button"
                      disabled
                      className={`h-8 w-8 rounded-compact border flex items-center justify-center opacity-45 ${actionControlClass}`}
                      title="后退"
                      aria-label="后退"
                    >
                      <ArrowLeft size={15} strokeWidth={1.25} />
                    </button>
                    <button
                      type="button"
                      disabled
                      className={`h-8 w-8 rounded-compact border flex items-center justify-center opacity-45 ${actionControlClass}`}
                      title="前进"
                      aria-label="前进"
                    >
                      <ArrowRight size={15} strokeWidth={1.25} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeWorkspaceItem?.url) openUrlInWorkspace(activeWorkspaceItem.url);
                      }}
                      className={`h-8 w-8 rounded-compact border flex items-center justify-center transition-all ${actionControlClass}`}
                      title="刷新"
                      aria-label="刷新"
                    >
                      <RefreshCw size={14} strokeWidth={1.25} />
                    </button>
                  </div>
                  <form onSubmit={submitWorkspaceAddress} className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-compact border px-3 no-drag ${fieldClass}`}>
                    <Search size={14} strokeWidth={1.25} className={`shrink-0 ${quietTextClass}`} />
                    <input
                      value={workspaceAddressInput}
                      onChange={(event) => setWorkspaceAddressInput(event.target.value)}
                      placeholder="搜索 Bambook 或输入网址"
                      className={`min-w-0 flex-1 bg-transparent text-sm font-light outline-none ${bodyTextClass}`}
                    />
                  </form>
                  <button
                    type="button"
                    onClick={() => {
                      setIsWorkspaceOpen(false);
                      patchAgentSessionContext({ workspace: { kind: 'empty' } });
                    }}
                    className={`h-8 w-8 shrink-0 rounded-compact border flex items-center justify-center transition-all no-drag ${actionControlClass}`}
                    title="收起工作区"
                    aria-label="收起工作区"
                  >
                    <X size={15} strokeWidth={1.25} />
                  </button>
                </div>
                {workspaceItems.length > 0 && (
                  <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar px-3 pb-2">
                    {workspaceItems.map(item => {
                      const selected = activeWorkspaceItem?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setActiveWorkspaceItemId(item.id);
                            patchAgentSessionContext({ workspace: workspaceBindingFromItem(item) });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setActiveWorkspaceItemId(item.id);
                              patchAgentSessionContext({ workspace: workspaceBindingFromItem(item) });
                            }
                          }}
                          className={`group flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-[12px] border px-2.5 text-xs font-light transition-all ${workspaceTabClass(selected)}`}
                          title={item.title}
                        >
                          <span className="truncate">{item.title}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeWorkspaceItem(item.id);
                            }}
                            className={`ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-slate-900/10'}`}
                            aria-label={`关闭 ${item.title}`}
                            title="关闭"
                          >
                            <X size={10} strokeWidth={1.4} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

                <div className={`flex-1 min-h-0 overflow-hidden ${isResizing ? 'pointer-events-none' : ''}`}>
                  {activeWorkspaceItem ? (
                    <div className="h-full min-h-0">
                        {activeWorkspaceItem.kind === 'image' && activeWorkspaceItem.previewUrl ? (
                          <img src={activeWorkspaceItem.previewUrl} alt={activeWorkspaceItem.title} className="h-full w-full object-contain" />
                        ) : activeWorkspaceItem.kind === 'pdf' && activeWorkspaceItem.previewUrl ? (
                          <object
                            data={activeWorkspaceItem.previewUrl}
                            type={activeWorkspaceItem.mimeType}
                            className="h-full w-full"
                            aria-label={activeWorkspaceItem.title}
                          >
                            <div className={`flex h-full flex-col items-center justify-center gap-3 text-xs ${quietTextClass}`}>
                              <Paperclip size={28} strokeWidth={1.2} />
                              <span>{activeWorkspaceItem.title}</span>
                            </div>
                          </object>
                        ) : activeWorkspaceItem.kind === 'browser' && activeWorkspaceItem.url ? (
                          <iframe
                            src={activeWorkspaceItem.url}
                            title={activeWorkspaceItem.title}
                            className="h-full w-full border-0 bg-transparent"
                            sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
                          />
                        ) : activeWorkspaceItem.kind === 'artifact' && activeWorkspaceItem.artifactBlock ? (
                          <div className="h-full overflow-y-auto p-5 custom-scrollbar">
                            <div className={`mx-auto max-w-3xl rounded-control border px-5 py-4 text-left ${OS_MATERIAL.insetSurface}`}>
                              <div className={`text-[11px] font-light ${quietTextClass}`}>Artifact Workspace</div>
                              <div className="mt-2 flex items-start justify-between gap-3">
                                <div>
                                  <div className={`text-lg font-light ${bodyTextClass}`}>{activeWorkspaceItem.artifactBlock.title || activeWorkspaceItem.artifactBlock.artifactId}</div>
                                  <div className={`mt-1 text-sm font-light ${quietTextClass}`}>{activeWorkspaceItem.artifactBlock.artifactType} · version {activeWorkspaceItem.artifactBlock.version}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => patchAgentSessionContext({
                                    status: 'editing_artifact',
                                    inputMode: 'artifact_instruction',
                                    activeArtifactId: activeWorkspaceItem.artifactBlock!.artifactId,
                                    workspace: { kind: 'artifact', artifactId: activeWorkspaceItem.artifactBlock!.artifactId, version: activeWorkspaceItem.artifactBlock!.version },
                                  })}
                                  className={`h-8 shrink-0 rounded-compact border px-3 text-xs font-light transition-all ${actionControlClass}`}
                                >
                                  继续编辑
                                </button>
                              </div>
                              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {Object.entries({
                                  artifactId: activeWorkspaceItem.artifactBlock.artifactId,
                                  artifactType: activeWorkspaceItem.artifactBlock.artifactType,
                                  version: activeWorkspaceItem.artifactBlock.version,
                                  contentRef: activeWorkspaceItem.artifactBlock.contentRef,
                                  status: activeWorkspaceItem.artifactBlock.status,
                                }).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => (
                                  <div key={key} className={`rounded-compact border px-3 py-2 ${actionControlClass}`}>
                                    <div className={`text-[10px] font-light ${quietTextClass}`}>{key}</div>
                                    <div className={`mt-1 truncate text-xs font-light ${bodyTextClass}`}>{String(value ?? '')}</div>
                                  </div>
                                ))}
                              </div>
                              <div className={`mt-4 rounded-compact border px-3 py-3 ${actionControlClass}`}>
                                <div className={`text-[11px] font-light ${quietTextClass}`}>Preview</div>
                                <pre className={`mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-xs font-light leading-5 ${bodyTextClass}`}>
                                  {formatReferenceJson(activeWorkspaceItem.artifactBlock.preview ?? activeWorkspaceItem.artifactBlock.contentRef ?? '当前 artifact 仅包含引用信息，后续阶段可通过 contentRef 拉取完整产物内容。')}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ) : activeWorkspaceItem.kind === 'reference' && activeWorkspaceItem.referenceAnchor ? (
                          <div className="h-full overflow-y-auto p-5 custom-scrollbar">
                            <div className={`mx-auto max-w-3xl rounded-control border px-5 py-4 text-left ${OS_MATERIAL.insetSurface}`}>
                              <div className={`text-[11px] font-light ${quietTextClass}`}>Reference Anchor</div>
                              <div className="mt-2 flex items-start justify-between gap-3">
                                <div>
                                  <div className={`text-lg font-light ${bodyTextClass}`}>{activeWorkspaceItem.title}</div>
                                  <div className={`mt-1 text-sm font-light ${quietTextClass}`}>{activeWorkspaceItem.referenceAnchor.kind}</div>
                                </div>
                                {activeWorkspaceItem.referenceAnchor.kind === 'tool_run' && activeWorkspaceItem.referenceAnchor.toolRunId && (
                                  <button
                                    type="button"
                                    onClick={() => hydrateReferenceToolRun(activeWorkspaceItem.id, activeWorkspaceItem.referenceAnchor!.toolRunId!)}
                                    className={`h-8 shrink-0 rounded-compact border px-3 text-xs font-light transition-all ${actionControlClass}`}
                                  >
                                    刷新审计
                                  </button>
                                )}
                              </div>
                              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {Object.entries({
                                  refId: activeWorkspaceItem.referenceAnchor.refId,
                                  kind: activeWorkspaceItem.referenceAnchor.kind,
                                  label: activeWorkspaceItem.referenceAnchor.label,
                                  toolRunId: activeWorkspaceItem.referenceAnchor.toolRunId,
                                  blockId: activeWorkspaceItem.referenceAnchor.blockId,
                                  sourceId: activeWorkspaceItem.referenceAnchor.sourceId,
                                  path: activeWorkspaceItem.referenceAnchor.path,
                                }).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => (
                                  <div key={key} className={`rounded-compact border px-3 py-2 ${actionControlClass}`}>
                                    <div className={`text-[10px] font-light ${quietTextClass}`}>{key}</div>
                                    <div className={`mt-1 truncate text-xs font-light ${bodyTextClass}`}>{String(value ?? '')}</div>
                                  </div>
                                ))}
                              </div>
                              {activeWorkspaceItem.referenceHydration?.status === 'loading' && (
                                <div className={`mt-4 rounded-compact border px-3 py-2 text-xs font-light ${actionControlClass}`}>正在读取工具运行审计详情...</div>
                              )}
                              {activeWorkspaceItem.referenceHydration?.status === 'error' && (
                                <div className={`mt-4 rounded-compact border px-3 py-2 text-xs font-light ${isDarkMode ? 'border-white/10 text-white/55' : 'border-slate-200 text-slate-500'}`}>
                                  {activeWorkspaceItem.referenceHydration.error || '审计详情读取失败'}
                                </div>
                              )}
                              {activeWorkspaceItem.toolRunDetail ? (
                                <div className="mt-4 space-y-3">
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                                    {Object.entries({
                                      toolId: activeWorkspaceItem.toolRunDetail.toolId,
                                      status: activeWorkspaceItem.toolRunDetail.status,
                                      risk: activeWorkspaceItem.toolRunDetail.risk,
                                      duration: getToolRunDurationLabel(activeWorkspaceItem.toolRunDetail),
                                    }).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => (
                                      <div key={key} className={`rounded-compact border px-3 py-2 ${actionControlClass}`}>
                                        <div className={`text-[10px] font-light ${quietTextClass}`}>{key}</div>
                                        <div className={`mt-1 truncate text-xs font-light ${bodyTextClass}`}>{String(value)}</div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                    <div className={`rounded-compact border px-3 py-3 ${actionControlClass}`}>
                                      <div className={`text-[11px] font-light ${quietTextClass}`}>Input</div>
                                      <pre className={`mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs font-light leading-5 ${bodyTextClass}`}>{formatReferenceJson(activeWorkspaceItem.toolRunDetail.input)}</pre>
                                    </div>
                                    <div className={`rounded-compact border px-3 py-3 ${actionControlClass}`}>
                                      <div className={`text-[11px] font-light ${quietTextClass}`}>Output</div>
                                      <pre className={`mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs font-light leading-5 ${bodyTextClass}`}>{formatReferenceJson(activeWorkspaceItem.toolRunDetail.output)}</pre>
                                    </div>
                                  </div>
                                  {activeWorkspaceItem.toolRunDetail.error && (
                                    <div className={`rounded-compact border px-3 py-2 text-xs font-light leading-6 ${isDarkMode ? 'border-white/10 text-white/55' : 'border-slate-200 text-slate-500'}`}>
                                      {activeWorkspaceItem.toolRunDetail.error}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className={`mt-4 rounded-compact border px-3 py-2 text-xs font-light leading-6 ${actionControlClass}`}>
                                  {activeWorkspaceItem.referenceAnchor.kind === 'tool_run' && '这是工具运行引用。若 toolRunId 可用，系统会读取 AgentToolRun 审计详情并展示 input/output、耗时和错误信息。'}
                                  {activeWorkspaceItem.referenceAnchor.kind === 'database_row' && '这是业务数据行引用。后续将通过 sourceId/path 打开对应业务记录详情。'}
                                  {activeWorkspaceItem.referenceAnchor.kind === 'artifact' && '这是产物引用。后续将切换到 Artifact Workspace，展示版本、预览和编辑历史。'}
                                  {activeWorkspaceItem.referenceAnchor.kind === 'document' && '这是文档来源引用。后续将打开原始文档片段和引用上下文。'}
                                  {activeWorkspaceItem.referenceAnchor.kind === 'api_response' && '这是接口响应引用。后续将展示请求摘要、响应片段和权限范围。'}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : activeWorkspaceItem.kind === 'review' && activeWorkspaceItem.entity ? (
                          <div className="h-full overflow-y-auto p-5 custom-scrollbar">
                            <div className={`mx-auto max-w-2xl rounded-control border px-5 py-4 text-left ${OS_MATERIAL.insetSurface}`}>
                              <div className={`text-[11px] font-light ${quietTextClass}`}>
                                {getWorkspaceEntityTypeLabel(activeWorkspaceItem.entity.entityType)}
                                {activeWorkspaceItem.entity.sourceModel && ` · ${activeWorkspaceItem.entity.sourceModel}`}
                              </div>
                              <div className="mt-2 flex items-start justify-between gap-3">
                                <div className={`min-w-0 flex-1 text-lg font-light ${bodyTextClass}`}>{activeWorkspaceItem.entity.title}</div>
                                <button
                                  type="button"
                                  onClick={() => hydrateWorkspaceEntity(activeWorkspaceItem.id, activeWorkspaceItem.entity!)}
                                  className={`h-8 shrink-0 rounded-compact border px-3 text-xs font-light transition-all ${actionControlClass}`}
                                >
                                  刷新详情
                                </button>
                              </div>
                              {activeWorkspaceItem.entity.subtitle && (
                                <div className={`mt-1 text-sm font-light ${quietTextClass}`}>{activeWorkspaceItem.entity.subtitle}</div>
                              )}
                              <div className={`mt-3 flex flex-wrap items-center gap-2 text-[11px] font-light ${quietTextClass}`}>
                                <span>{activeWorkspaceItem.entity.entityType}</span>
                                <span>{activeWorkspaceItem.entity.id}</span>
                                {activeWorkspaceItem.entity.confidence !== undefined && (
                                  <span>匹配度 {Math.round(Number(activeWorkspaceItem.entity.confidence) * 100)}%</span>
                                )}
                                {activeWorkspaceItem.entityHydration?.status === 'loading' && <span>正在读取详情...</span>}
                                {activeWorkspaceItem.entityHydration?.status === 'loaded' && <span>详情已读取</span>}
                                {activeWorkspaceItem.entityHydration?.status === 'error' && (
                                  <span className={isDarkMode ? 'text-white/55' : 'text-slate-500'}>
                                    {activeWorkspaceItem.entityHydration.error || '详情读取失败'}
                                  </span>
                                )}
                              </div>
                              {activeWorkspaceItem.entity.snippet && (
                                <div className={`mt-4 rounded-compact border px-3 py-2 text-sm font-light leading-6 ${actionControlClass}`}>
                                  {activeWorkspaceItem.entity.snippet}
                                </div>
                              )}
                              {activeWorkspaceItem.entity.fillPatch && Object.keys(activeWorkspaceItem.entity.fillPatch).length > 0 && (
                                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {Object.entries(activeWorkspaceItem.entity.fillPatch).slice(0, 10).map(([key, value]) => (
                                    <div key={key} className={`rounded-compact border px-3 py-2 ${actionControlClass}`}>
                                      <div className={`text-[10px] font-light ${quietTextClass}`}>{key}</div>
                                      <div className={`mt-1 truncate text-xs font-light ${bodyTextClass}`}>{String(value ?? '')}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {activeWorkspaceItem.entity.links && activeWorkspaceItem.entity.links.length > 0 && (
                                <div className="mt-4">
                                  <div className={`text-[11px] font-light ${quietTextClass}`}>关联对象</div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {activeWorkspaceItem.entity.links.slice(0, 12).map((link, index) => (
                                      <div key={`${link.targetType}:${link.targetId}:${index}`} className={`rounded-compact border px-3 py-1.5 text-xs font-light ${actionControlClass}`}>
                                        {link.linkKind} · {link.targetType}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className={`flex h-full flex-col items-center justify-center gap-3 text-xs ${quietTextClass}`}>
                            <Paperclip size={28} strokeWidth={1.2} />
                            <span>{activeWorkspaceItem.title}</span>
                          </div>
                        )}
                    </div>
                  ) : isWorkspaceFinderOpen ? (
                    <div className="flex h-full flex-col p-4">
                      <div className="flex shrink-0 items-center justify-between gap-2">
                        <div className={`flex h-9 shrink-0 items-center rounded-compact border p-1 ${fieldClass}`}>
                          <button
                            type="button"
                            onClick={() => setWorkspaceFileSource('bambook')}
                            className={`h-7 rounded-[11px] px-3 text-xs font-light transition-all ${workspaceFileSource === 'bambook' ? (isDarkMode ? 'bg-white/12 text-white' : 'bg-slate-900/10 text-slate-900') : quietTextClass}`}
                          >
                            Bambook 内容
                          </button>
                          <button
                            type="button"
                            onClick={() => setWorkspaceFileSource('local')}
                            className={`h-7 rounded-[11px] px-3 text-xs font-light transition-all ${workspaceFileSource === 'local' ? (isDarkMode ? 'bg-white/12 text-white' : 'bg-slate-900/10 text-slate-900') : quietTextClass}`}
                          >
                            本地文件
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsWorkspaceFinderOpen(false)}
                          className={`h-9 rounded-compact border px-3 text-xs font-light transition-all ${actionControlClass}`}
                        >
                          返回
                        </button>
                      </div>
                      {workspaceFileSource === 'bambook' ? (
                        <>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void searchWorkspaceEntities();
                            }}
                            className="mt-3 flex shrink-0 items-center gap-2"
                          >
                            <input
                              value={workspaceFinderQuery}
                              onChange={(event) => setWorkspaceFinderQuery(event.target.value)}
                              autoFocus
                              placeholder="搜索文件名、客户、订单号、SKU"
                              className={`h-10 min-w-0 flex-1 rounded-compact border bg-transparent px-3 text-sm font-light outline-none ${fieldClass}`}
                            />
                            <button
                              type="submit"
                              disabled={isWorkspaceSearching || isWorkspaceAppending || !workspaceFinderQuery.trim()}
                              className={`h-10 rounded-compact border px-3 text-xs font-light transition-all disabled:opacity-45 ${actionControlClass}`}
                            >
                              搜索
                            </button>
                          </form>
                          <div className={`mt-3 flex-1 overflow-y-auto rounded-field border px-3 py-3 text-left text-xs font-light leading-6 custom-scrollbar ${OS_MATERIAL.insetSurface} ${quietTextClass}`}>
                            <div className={`mb-2 flex items-center justify-between border-b pb-2 ${sectionDividerClass}`}>
                              <span>
                                {isWorkspaceSearching
                                  ? '正在搜索'
                                  : workspaceSearchError
                                    ? '搜索失败'
                                    : workspaceFinderQuery.trim()
                                      ? workspaceSearchTotal !== null
                                        ? `显示 ${workspaceSearchResults.length} / 共 ${workspaceSearchTotal} 条`
                                        : `显示 ${workspaceSearchResults.length} 条候选`
                                      : 'Bambook 内容'}
                              </span>
                              {workspaceFinderQuery.trim() && !isWorkspaceSearching && !workspaceSearchError && (
                                <span className="truncate max-w-[55%]">{workspaceFinderQuery.trim()}</span>
                              )}
                            </div>
                            {isWorkspaceSearching ? (
                              <div>正在搜索数据中心...</div>
                            ) : workspaceSearchError ? (
                              <div className={isDarkMode ? 'text-white/55' : 'text-slate-500'}>{workspaceSearchError}</div>
                            ) : workspaceSearchResults.length > 0 ? (
                              <div className="space-y-2">
                                {workspaceSearchResults.map(item => (
                                  <button
                                    key={`${item.entityType}:${item.id}`}
                                    type="button"
                                    onClick={() => openEntityInWorkspace(item)}
                                    className={`block w-full rounded-compact border px-3 py-2 text-left transition-all ${actionControlClass}`}
                                  >
                                    <div className={`text-[10px] font-light ${quietTextClass}`}>{getWorkspaceEntityTypeLabel(item.entityType)}</div>
                                    <div className={`mt-1 truncate text-sm font-light ${bodyTextClass}`}>{item.title}</div>
                                    {(item.subtitle || item.snippet) && (
                                      <div className={`mt-1 line-clamp-2 text-xs font-light leading-5 ${quietTextClass}`}>
                                        {item.subtitle || item.snippet}
                                      </div>
                                    )}
                                  </button>
                                ))}
                                {workspaceSearchHasMore && (
                                  <div className="flex justify-center pt-2">
                                    <button
                                      type="button"
                                      onClick={loadMoreWorkspaceEntities}
                                      disabled={isWorkspaceAppending}
                                      className={`h-9 rounded-compact border px-4 text-xs font-light transition-all disabled:opacity-45 ${actionControlClass}`}
                                    >
                                      {isWorkspaceAppending ? '加载中...' : '加载更多'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : workspaceFinderQuery.trim() ? (
                              <div>没有命中结果。</div>
                            ) : (
                              <div>从数据中心查找公司文档、订单附件、图片、PDF、客户、订单和数字档案。</div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-1 items-center justify-center">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className={`h-12 rounded-field border px-5 text-sm font-light transition-all ${actionControlClass}`}
                          >
                            选择本地文件
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center px-6">
                      <div className="flex w-full max-w-[360px] flex-col items-center gap-3">
                        <button
                          type="button"
                          onClick={openWorkspaceFinder}
                          className={`h-12 w-full rounded-field border px-4 text-sm font-light transition-all ${actionControlClass}`}
                        >
                          打开文件
                        </button>
                        <button
                          type="button"
                          onClick={() => openUrlInWorkspace()}
                          className={`h-10 rounded-compact border px-4 text-xs font-light transition-all ${actionControlClass}`}
                        >
                          打开链接
                        </button>
                      </div>
                    </div>
                  )}
                </div>
            </div>
          </div>

          {/* Center Column: Dialogue */}
          <div className={`order-2 flex flex-col transition-all duration-300 ease-in-out overflow-hidden flex-1 min-w-[320px] sm:min-w-[400px] ${isDarkMode ? 'bg-black/10' : 'bg-white/10'}`}>
          <div
            className={`min-h-12 shrink-0 border-b px-4 py-1.5 flex items-center justify-between gap-2 ${panelDividerClass} ${isAgentFullscreen && !isHistoryOpen ? 'pl-16' : ''}`}
            style={isAgentFullscreen ? { WebkitAppRegion: 'drag' } as React.CSSProperties : { WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-2 min-w-0 ml-1 no-drag">
              <button
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                className={`h-8 w-8 shrink-0 rounded-compact border flex items-center justify-center transition-all ${actionControlClass}`}
                title={isHistoryOpen ? "收起历史" : "展开历史"}
                aria-label={isHistoryOpen ? "收起历史" : "展开历史"}
              >
                {isHistoryOpen ? <PanelLeftClose size={15} strokeWidth={1.25} /> : <PanelLeftOpen size={15} strokeWidth={1.25} />}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 no-drag">
              <button
                type="button"
                onClick={() => setIsWorkspaceOpen(!isWorkspaceOpen)}
                className={`h-8 w-8 shrink-0 rounded-compact border flex items-center justify-center transition-all ${actionControlClass} ${isWorkspaceOpen ? (isDarkMode ? 'text-[var(--os-vnext-brand-blue-soft)]' : 'text-[var(--os-vnext-brand-blue-strong)]') : ''}`}
                title={isWorkspaceOpen ? "收起工作区" : "展开工作区"}
                aria-label={isWorkspaceOpen ? "收起工作区" : "展开工作区"}
              >
                {isWorkspaceOpen ? <PanelRightClose size={15} strokeWidth={1.25} /> : <PanelRightOpen size={15} strokeWidth={1.25} />}
              </button>
              <button
                type="button"
                onClick={toggleTTS}
                className={`h-8 w-8 shrink-0 rounded-compact border flex items-center justify-center transition-all ${actionControlClass} ${isTTSEnabled ? (isDarkMode ? 'text-[var(--os-vnext-brand-blue-soft)]' : 'text-[var(--os-vnext-brand-blue-strong)]') : ''}`}
                title={isTTSEnabled ? '关闭自动朗读' : '开启自动朗读'}
                aria-label={isTTSEnabled ? '关闭自动朗读' : '开启自动朗读'}
              >
                {isTTSEnabled ? <Volume2 size={14} strokeWidth={1.35} /> : <VolumeX size={14} strokeWidth={1.35} />}
              </button>
              <button
                type="button"
                onClick={() => setIsAgentFullscreen(!isAgentFullscreen)}
                title={isAgentFullscreen ? "退出全屏 Agent" : "全屏 Agent"}
                aria-label={isAgentFullscreen ? "退出全屏 Agent" : "全屏 Agent"}
                className={`h-8 w-8 shrink-0 rounded-compact border flex items-center justify-center transition-all ${actionControlClass}`}
              >
                {isAgentFullscreen ? <Minimize2 size={15} strokeWidth={1.25} /> : <Maximize2 size={15} strokeWidth={1.25} />}
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <ScrollEdgeFades scrollRef={scrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} />
            {/* Phase 10：用户上滚阅读历史时浮出 FAB，点击回到底部并恢复跟随 */}
            {!isMainPinned && (
              <button
                type="button"
                onClick={() => scrollMainToBottom('smooth')}
                className={`absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1.5 text-[11px] font-light shadow-none transition-opacity ${
                  isDarkMode
                    ? 'border-white/10 bg-black/60 text-white/80 hover:bg-black/75'
                    : 'border-slate-200 bg-white/85 text-slate-700 hover:bg-white'
                }`}
                aria-label="滚动到最新"
              >
                ↓ 跳到最新
              </button>
            )}
            <div ref={scrollRef} className={`${BAMBOOK_OS.layout.desktopMainScrollViewportClass} !px-4 !py-5 md:!px-5 md:!py-6 space-y-4`}>
              {activeAttachment && (
                <section className={`${inlineSurfaceClass} px-4 py-3`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`h-10 w-10 shrink-0 rounded-inset border flex items-center justify-center overflow-hidden ${isDarkMode ? 'border-white/[0.06] text-white/45' : 'border-slate-200/45 text-slate-500'}`}>
                      {activeAttachment.mimeType.startsWith('image/') ? (
                        <img src={activeAttachment.previewUrl} alt={activeAttachment.name} className="h-full w-full object-cover" />
                      ) : (
                        <Paperclip size={17} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-light ${bodyTextClass}`}>{activeAttachment.name}</div>
                      <div className={`mt-0.5 text-[11px] ${quietTextClass}`}>{activeObjectType} context attached</div>
                    </div>
                  </div>
                </section>
              )}

              {messages.length === 0 && !isLoading && (() => {
                const currentAgent = activeAgentId === 'default'
                  ? { id: 'default', name: 'Bambook AI', desc: '全能 AI 助手', icon: MessageSquare }
                  : (AGENTS.find(a => a.id === activeAgentId) || AGENTS[0]);
                const AgentIcon = currentAgent.icon;
                return (
                  <div className="flex min-h-[320px] flex-col items-center justify-center text-center px-4">
                    <div className="mb-4 text-os-adaptive-brand">
                      <AgentIcon size={32} strokeWidth={1.2} />
                    </div>
                    <div className={`text-sm font-light ${bodyTextClass}`}>{currentAgent.name}</div>
                    <div className={`mt-1 text-xs font-light ${quietTextClass}`}>{currentAgent.desc}</div>
                    <div className={`mt-4 max-w-sm text-xs leading-5 ${quietTextClass} border border-dashed rounded-xl p-3 bg-slate-500/[0.02]`}>
                      {activeAgentId === 'default' && '我是您的全能助手。可以直接提问，或上传文档、订单进行分析与处理。'}
                      {activeAgentId === 'translation' && '支持中英日韩等十余种语言互译，以及学术/商务格式化润色。可以直接发送你想翻译的段落。'}
                      {activeAgentId === 'analysis' && '已为您连接 Bambook 数据中心。可以输入例如“分析上个月销量最好的三个服装款式”或“生成客户关系图表”。'}
                      {activeAgentId === 'email' && '支持写开发信、催款信、回复客户问询等。可以直接输入“帮我写一封向客户催收货款的邮件，态度要委婉”。'}
                      {activeAgentId === 'order' && '已对接订单数据库。可以输入“帮我查询订单 OD-202606 的出货状态”或“有哪些即将超期未发货的订单”。'}
                    </div>
                  </div>
                );
              })()}

              {messages.map((message, idx) => {
                // 找到当前 model 消息之前最近的 user 消息，用于"复制工作流"
                let userPrompt: string | undefined;
                if (message.role === 'model') {
                  for (let j = idx - 1; j >= 0; j--) {
                    if (messages[j].role === 'user') {
                      userPrompt = messages[j].text;
                      break;
                    }
                  }
                }
                return (
                <AgentMessageCard
                  key={message.id ?? idx}
                  message={message}
                  index={idx}
                  userName={getAuthState().user?.displayName}
                  isLatestModelMessage={message.role === 'model' && idx === messages.length - 1}
                  runtimeEvents={agentEvents}
                  isRuntimeLoading={isLoading}
                  isDarkMode={isDarkMode}
                  copiedMessageKey={copiedMessageKey}
                  onCopy={copyMessageText}
                  onCopyFull={copyMessageText}
                  onExecuteAction={dispatchAgentAction}
                  onEditUserMessage={editUserMessage}
                  userPrompt={userPrompt}
                  onOpenWorkspace={(payload) => {
                    if (payload.kind === 'review' && payload.referenceAnchor) {
                      openReferenceInWorkspace(payload.referenceAnchor);
                    } else if (payload.kind === 'artifact' && payload.artifactBlock) {
                      openArtifactInWorkspace(payload.artifactBlock);
                    } else if (payload.kind === 'browser') {
                      openWorkspaceItem({
                        id: `workspace-browser-${payload.url}`,
                        kind: 'browser',
                        title: payload.title || payload.url || '',
                        subtitle: payload.url || '',
                        url: payload.url,
                      });
                    } else if (payload.attachmentName && payload.previewUrl) {
                      openWorkspaceItem({
                        id: `workspace-file-${payload.attachmentName}`,
                        kind: payload.kind,
                        title: payload.attachmentName,
                        subtitle: payload.attachmentName,
                        previewUrl: payload.previewUrl,
                        mimeType: payload.mimeType,
                        data: payload.data,
                      });
                    }
                  }}
                />
                );
              })}
            </div>
          </div>

          <footer className="shrink-0 px-4 pb-4 pt-2 flex justify-center">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className={`${OS_MATERIAL.insetSurface} rounded-card border px-3 py-3 w-full max-w-4xl`}
            >
              {attachments.length > 0 && (
                <div className={`mb-2 flex gap-2 overflow-x-auto border-b px-1 pb-2 ${sectionDividerClass}`}>
                  {attachments.map((att, i) => (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={() => openAttachmentInWorkspace(att)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openAttachmentInWorkspace(att);
                        }
                      }}
                      className={`${OS_MATERIAL.insetSurface} relative h-12 min-w-12 rounded-inset overflow-hidden border flex items-center justify-center ${quietTextClass}`}
                      title={att.name}
                    >
                      {att.mimeType.startsWith('image/') ? <img src={att.previewUrl} alt={att.name} className="w-full h-full object-cover" /> : <Paperclip size={16} />}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setAttachments(prev => prev.filter((_, idx) => idx !== i));
                        }}
                        className={`absolute right-0 top-0 rounded-bl-xl p-0.5 ${isDarkMode ? 'bg-black/35 text-white/78' : 'bg-slate-900/70 text-white'}`}
                      >
                        <Plus size={11} className="rotate-45" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {isLoading && currentAgentStatusText && (
                <div className={`mb-2 flex min-w-0 items-center gap-2 px-1 text-[11px] ${currentAgentEvent ? getAgentEventToneClass(currentAgentEvent) : quietTextClass}`}>
                  <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-current animate-pulse" />
                  <span className="min-w-0 flex-1 truncate">{currentAgentStatusText}</span>

                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isLoading}
                placeholder="输入任务，或添加 PDF / 图片让 Agent 处理..."
                rows={3}
                className={`block w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none disabled:opacity-50 ${isDarkMode ? 'text-white/78 placeholder-white/32' : 'text-slate-800 placeholder-slate-400'}`}
              />
              {voiceStatus && (
                <div className={`mt-1 px-1 text-[11px] ${isVoiceRecording
                  ? (isDarkMode ? 'text-white/70' : 'text-slate-600')
                  : quietTextClass}`}
                >
                  {voiceStatus}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`h-8 w-8 rounded-field border transition-all ${actionControlClass}`}
                  title="添加 PDF / 图片"
                >
                  <Plus size={18} strokeWidth={1.25} />
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={isLoading}
                  className={`h-8 w-8 rounded-field border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${isVoiceRecording
                    ? (isDarkMode ? 'border-white/15 bg-white/10 text-white/80' : 'border-slate-300 bg-slate-100 text-slate-600')
                    : actionControlClass}`}
                  title={isVoiceRecording ? '停止语音输入' : '本地语音输入'}
                  aria-label={isVoiceRecording ? '停止语音输入' : '本地语音输入'}
                >
                  <Mic size={16} strokeWidth={1.3} />
                </button>
                <div className="min-w-0 flex-1" />
                <div className={`relative h-8 rounded-field border ${fieldClass}`}>
                  <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                    <Cpu size={13} className={isDarkMode ? 'text-white/42' : 'text-slate-400'} />
                  </div>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={`h-full max-w-[132px] appearance-none bg-transparent pl-8 pr-7 text-[11px] outline-none ${isDarkMode ? 'text-white/70' : 'text-slate-600'} [&>option]:text-black`}
                  >
                    <option value={MODELS.ARK_CODE}>Ark Code</option>
                  </select>
                  <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                    <ChevronDown size={10} className={isDarkMode ? 'text-white/34' : 'text-slate-400'} />
                  </div>
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleFileSelect} />
                <button
                  type="button"
                  onClick={() => {
                    if (isLoading) {
                      stopCurrentRun();
                    } else {
                      handleSend();
                    }
                  }}
                  disabled={!isLoading && (isVoiceRecording || (!input.trim() && attachments.length === 0))}
                  title={isLoading ? '停止当前任务' : '运行任务'}
                  className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed ${isLoading
                    ? (isDarkMode ? 'bg-white/10 text-white/55 hover:bg-white/16' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
                    : (isDarkMode ? 'bg-white text-slate-950 hover:bg-white/90' : 'bg-slate-950 text-white hover:bg-slate-800')}`}
                >
                  {isLoading ? <StopCircle size={16} /> : <Send size={16} />}
                </button>
              </div>
            </form>
          </footer>
        </div>
        </div>
      </motion.div>
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded-xl shadow-none border text-xs font-light flex items-center gap-2 ${
              isDarkMode 
                ? 'bg-slate-900/90 border-slate-700/50 text-white' 
                : 'bg-white/95 border-slate-200 text-slate-800'
            }`}
          >
            <Sparkles size={13} className="text-os-adaptive-brand animate-pulse" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

};

export default Assistant;
