
import React, { useState, useEffect, useRef } from 'react';
import { Email, KnowledgeItem, Order, EmailSignature } from '../types';
import { EmailDB } from '../services/storageService'; // IndexedDB Import
import {
  Mail, Trash2, Star, Archive, Flag,
  SendHorizontal, Loader2,
  Check, X, Paperclip,
  RefreshCcw, Settings, Lock,
  Inbox, Send, FileText, AlertCircle,
  MoreHorizontal, CornerUpLeft, Reply, Forward, Plus, Edit, ChevronDown,
  Clock, CheckCircle2, ShieldAlert, ShieldCheck, Filter, List,
  ReplyAll, MoreVertical, PanelLeftClose, PanelLeft, PenLine,
  Tags, CalendarPlus, Search
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { emailSyncService } from '../services/emailSyncService';
import { emailOutboxService } from '../services/emailOutboxService';
import {
  emailIntelligenceService,
  EmailIntentInfo,
  EmailTemplate,
  EMAIL_TEMPLATE_TYPE_LABELS,
  EMAIL_LABEL_LABELS,
  classifyEmail,
  createFollowUpFromEmail,
  markEmailTemplateUsed,
} from '../services/emailIntelligenceService';
import { getApiBaseUrl } from '../services/apiBase';
import DOMPurify from 'dompurify';
import { EmailList } from './email/EmailList';
import { EmailEditor } from './email/EmailEditor';
import SignatureManager from './email/SignatureManager';
import { cleanHtmlSnippet } from '../utils/emailUtils';
import { PageHeader } from './ui/PageHeader';
import { bdsConfirm } from './ui/BdsDialog';


interface EmailProps {
  emails: Email[];
  setEmails: React.Dispatch<React.SetStateAction<Email[]>>;
  knowledge: KnowledgeItem[];
  orders: Order[];
  onAddKnowledge: (item: KnowledgeItem) => void;
  isDarkMode?: boolean;
  isMobile?: boolean;
}

const getInitials = (sender: string) => {
  if (!sender) return 'U';
  const name = sender.includes('<') ? sender.split('<')[0].replace(/"/g, '') : sender.split('@')[0];
  return name.trim().substring(0, 2).toUpperCase();
};

const formatTime = (dateStr: string | Date) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diff < 48 * 60 * 60 * 1000) {
    return '昨天';
  } else {
    return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
  }
};

const formatFullTime = (dateStr: string | Date) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const emailApiUrl = (path: string) => `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

const EmailManager: React.FC<EmailProps> = ({ emails, setEmails, knowledge, orders, onAddKnowledge, isDarkMode = false, isMobile = false }) => {
  // Mobile Navigation State
  const [mobileView, setMobileView] = useState<'list' | 'detail' | 'compose'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentBox, setCurrentBox] = useState('INBOX');
  // Lightweight State: Separate body from list
  const [selectedEmailBody, setSelectedEmailBody] = useState<string | null>(null);
  const [selectedEmailAttachments, setSelectedEmailAttachments] = useState<any[]>([]);

  // State
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [erpSyncBusy, setErpSyncBusy] = useState(false);
  const [erpSyncResult, setErpSyncResult] = useState<string | null>(null);
  const [erpSyncError, setErpSyncError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Pagination State
  const [hasMore, setHasMore] = useState(true);

  // Reply State
  const [isReplying, setIsReplying] = useState(false);
  const [replyContent, setReplyContent] = useState('');

  // Compose State
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  // F5 模板库 State（PRD 12.1/19.3：插入模板，变量自动填充）
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<EmailTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  // 阶段 P3b：邮件签名 State（PRD 12.1：Compose 插入签名 + 签名管理）
  const [signaturePickerOpen, setSignaturePickerOpen] = useState(false);
  const [emailSignatures, setEmailSignatures] = useState<EmailSignature[]>([]);
  const [signaturesLoaded, setSignaturesLoaded] = useState(false);
  const [signatureManagerOpen, setSignatureManagerOpen] = useState(false);

  // F5 意图可视化 State（PRD 19.3：列表自动分类标签；key = IMAP uid 字符串）
  const [intentByUid, setIntentByUid] = useState<Record<string, EmailIntentInfo>>({});
  const intentFetchBoxRef = useRef('');

  // C8 邮件深化 State（智能分类 / 一键建跟进；反馈复用工具栏展示区）
  const [classifyBusy, setClassifyBusy] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [c8Feedback, setC8Feedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [isSending, setIsSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Use Ref to always have the latest currentBox in async closures (prevents UI leakage)
  const currentBoxRef = useRef(currentBox);
  useEffect(() => {
    currentBoxRef.current = currentBox;
  }, [currentBox]);

  // Keep track of IDs currently being prefetched to avoid duplicate requests
  const pendingPrefetch = useRef(new Set<string>());

  const [emailConfig, setEmailConfig] = useState(() => {
    const saved = localStorage.getItem('aliyun_mail_config');
    // credential 边界：password 不从 localStorage 读取（默认空，需用户重新输入）
    return saved ? { ...JSON.parse(saved), password: '' } : { email: '', password: '' };
  });

  // Filtering & Sorting State
  const [filterType, setFilterType] = useState('All');
  const [sortType, setSortType] = useState('Default');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Auto-responsive folding: Collapse on smaller desktop screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1280) {
        setIsSidebarCollapsed(true);
      } else {
        setIsSidebarCollapsed(false);
      }
    };

    // Initial check
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Folder counts (persistent across folder switches)
  const [folderCounts, setFolderCounts] = useState<{
    [key: string]: { total: number; unread: number };
  }>(() => {
    // Initialize from cache
    const counts: any = {};
    ['INBOX', 'Sent Messages', 'Drafts', 'Trash'].forEach(box => {
      const cached = localStorage.getItem(`nexus_emails_v2_${box}`);
      if (cached) {
        const emails = JSON.parse(cached);
        counts[box] = {
          total: emails.length,
          unread: emails.filter((e: Email) => !e.isRead).length
        };
      } else {
        counts[box] = { total: 0, unread: 0 };
      }
    });
    return counts;
  });

  // Flag to prevent duplicate initial sync
  const hasInitialSyncedRef = useRef(false);

  // Load cache on mount - We use props from App.tsx mostly.
  // If emails prop from App is empty, we try to see if there's a cached view.
  useEffect(() => {
    // Resolve base box for caching (Virtual folders use INBOX data)
    const isVirtual = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox);
    const baseBox = isVirtual ? 'INBOX' : currentBox;

    const cached = localStorage.getItem(`nexus_emails_v2_${baseBox}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Only update if meaningfully different to avoid loops, but strictly for virtual boxes we need to ensure data is loaded
      // Simple check: if emails is empty but cache has data, LOAD IT.
      if (emails.length === 0 && parsed.length > 0) {
        setEmails(parsed);
      } else if (JSON.stringify(parsed) !== JSON.stringify(emails)) {
        // Deep check might be expensive but safer. 
        // Actually, handleBoxChange handles the primary load. 
        // This useEffect is mostly for initial mount or external updates.
        // We'll trust handleBoxChange for switches and only load here if empty.
        if (emails.length === 0) setEmails(parsed);
      }
    } else {
      if (emails.length === 0) setEmails([]);
    }
  }, [currentBox]);

  // Background Sync Timer (every 1 minute for responsive new mail)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSyncing && !isLoadingMore && emailConfig.email && emailConfig.password) {
        console.log('📡 Background check for new emails...');

        // 1. Always sync INBOX to keep the " 收件箱 " badge fresh
        handleSync('INBOX', false, true);

        // 2. If user is in another box, sync that one too
        if (currentBox !== 'INBOX' && !['STARRED', 'IMPORTANT', 'UNREAD'].includes(currentBox)) {
          handleSync(currentBox, false, true);
        }
      }
    }, 60000); // 1 minute
    return () => clearInterval(interval);
  }, [currentBox, emailConfig]);

  // Folder count auto-sync with state
  useEffect(() => {
    setFolderCounts(prev => {
      const currentBoxEmails = emails;
      const unread = currentBoxEmails.filter(e => !e.isRead).length;
      const total = currentBoxEmails.length;

      // Update the current folder count in real-time
      if (['STARRED', 'IMPORTANT', 'UNREAD'].includes(currentBox)) return prev;

      return {
        ...prev,
        [currentBox]: { total, unread }
      };
    });
  }, [emails, currentBox]);

  // Initial Silent Sync for All Critical Boxes (seamless background update)
  useEffect(() => {
    if (emailConfig.email && emailConfig.password && !hasInitialSyncedRef.current) {
      hasInitialSyncedRef.current = true; // Set flag to prevent duplicate runs

      // Silent sync in background - no UI disruption
      console.log("🔇 Starting silent background sync for all boxes...");
      setTimeout(() => {
        // Delay slightly to let UI load first
        Promise.all([
          handleSync('INBOX', false, true),     // silent=true
          handleSync('Sent Messages', false, true),
          handleSync('Drafts', false, true),
          handleSync('Trash', false, true),
          handleSync('Spams', false, true)
        ]);
      }, 1000); // 1 second delay for smooth initial render
    }
  }, [emailConfig]); // Run once when config is ready

  const handleSyncToErp = async () => {
    if (erpSyncBusy) return;
    if (!emailConfig.email || !emailConfig.password) {
      setErpSyncError('请先在邮箱设置中配置 email 和 password');
      return;
    }
    setErpSyncBusy(true);
    setErpSyncError(null);
    setErpSyncResult(null);
    try {
      const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
      const result = await emailSyncService.syncToErp({
        email: emailConfig.email,
        password: emailConfig.password,
        host: emailConfig.host,
        port: emailConfig.port,
        box: physicalBox,
        limit: 100,
      });
      setErpSyncResult(`同步完成：${result.synced} 新增 / ${result.skipped} 跳过 / ${result.errors} 错误（${result.accountMasked}）`);
    } catch (e: any) {
      setErpSyncError(e?.message || 'ERP 同步失败，请稍后重试');
    } finally {
      setErpSyncBusy(false);
    }
  };

  const handleSaveConfig = (config: any) => {
    // credential 边界：不把 password 写入 localStorage 持久缓存（只在内存中持有）
    const { password, ...safeConfig } = config;
    localStorage.setItem('aliyun_mail_config', JSON.stringify(safeConfig));
    setEmailConfig(config);
    setIsConfiguring(false);
    // Trigger sync for all boxes immediately
    setTimeout(() => {
      handleSync('INBOX', false);
      handleSync('Sent Messages', false);
      handleSync('Trash', false);
      handleSync('Spams', false);
    }, 500);
  };

  // Helper: Save lightweight headers to LS (Avoid Quota Exceeded)
  const saveEmailsToLS = (box: string, emails: Email[]) => {
    try {
      const cacheKey = `nexus_emails_v2_${box}`;
      const existingStr = localStorage.getItem(cacheKey);
      const snippetMap = new Map<string, string>();

      if (existingStr) {
        try {
          const existing = JSON.parse(existingStr) as Email[];
          existing.forEach(e => {
            if (e.snippet) snippetMap.set(e.id, e.snippet);
          });
        } catch (e) { }
      }

      const lightweight = emails.map(e => ({
        ...e,
        body: undefined, // Strip body
        attachments: [],
        snippet: (e.body ? cleanHtmlSnippet(e.body) : (e.snippet || snippetMap.get(e.id) || ''))
      }));
      localStorage.setItem(`nexus_emails_v2_${box}`, JSON.stringify(lightweight));

      // Update folder counts
      setFolderCounts(prev => ({
        ...prev,
        [box]: {
          total: emails.length,
          unread: emails.filter(e => !e.isRead).length
        }
      }));
    } catch (e) {
      console.error('LS Save Failed', e);
    }
  };

  const handleSync = async (targetBox?: string, isLoadMore = false, silent = false) => {
    // 1. Resolve logical vs physical box
    const logicalBox = targetBox || currentBox;
    const isVirtual = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(logicalBox);
    const physicalBox = isVirtual ? 'INBOX' : logicalBox;

    if (!emailConfig.email || !emailConfig.password) {
      if (!isLoadMore && currentBox === logicalBox) setIsConfiguring(true);
      return;
    }

    // Silent mode: no loading spinners
    if (!silent) {
      if (isLoadMore) setIsLoadingMore(true);
      else {
        if (logicalBox === currentBox) setIsSyncing(true);
      }
    }

    // For simplicity, Load More only works for current physical box. 
    // Background sync is always offset 0.
    const currentOffset = isLoadMore ? emails.length : 0;

    try {
      const res = await fetch(emailApiUrl('/email/fetch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...emailConfig,
          box: physicalBox,
          limit: 200,
          offset: currentOffset
        })
      });
      const json = await res.json();

      // DEBUG: Log backend response
      if (json.debug) {
        console.log('[EMAIL DEBUG]', {
          requestedLimit: json.debug.limit,
          requestedOffset: json.debug.offset,
          serverFoundTotal: json.debug.foundTotal,
          serverReturnedCount: json.debug.fetchedCount,
          targetBox: json.debug.targetBox,
          availableBoxes: json.debug.availableBoxes,
          clientReceivedCount: json.data?.length
        });

        // Debug log instead of alert
        if (json.data.length === 20 && json.debug.limit === 50) {
          console.warn(`⚠️ 请求了 ${json.debug.limit} 封邮件，但服务器只返回了 ${json.data.length} 封。服务器找到总数: ${json.debug.foundTotal}`);
        }
      }

      if (json.status === 'success') {
        const newEmails = json.data as Email[];

        if (newEmails.length < 50) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }

        // SILENT MODE: Update cache and intelligently update UI if on current box
        if (silent) {
          const isVirtualCurrent = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBoxRef.current);
          const shouldUpdateUI = logicalBox === currentBoxRef.current || (isVirtualCurrent && logicalBox === 'INBOX');

          if (shouldUpdateUI) {
            setEmails(prev => {
              // Merge with PREV state for current box to keep latest snippets
              const emailMap = new Map<string, Email>(prev.map((e: Email) => [e.id, e]));
              let hasNew = false;

              newEmails.forEach(e => {
                const existing = emailMap.get(e.id);
                if (existing) {
                  // Preserve body and snippet, and Optimistically preserve flags (fix disappearing "Important")
                  const bestBody = (existing.body && existing.body !== '' && existing.body !== 'Loading...') ? existing.body : e.body;
                  const bestSnippet = existing.snippet || e.snippet || '';
                  const bestImportant = e.isImportant || existing.isImportant;
                  const bestStarred = e.isStarred || existing.isStarred;

                  emailMap.set(e.id, {
                    ...e,
                    body: bestBody,
                    snippet: bestSnippet,
                    isImportant: bestImportant,
                    isStarred: bestStarred
                  });
                } else {
                  emailMap.set(e.id, e);
                  hasNew = true;
                }
              });

              const updatedList = Array.from(emailMap.values()).sort((a: any, b: any) =>
                new Date(b.date).getTime() - new Date(a.date).getTime()
              ) as Email[];

              if (hasNew) {
                console.log(`📬 New emails detected in background sync for ${logicalBox}`);
              }

              // Trigger prefetch for those still missing snippets
              const needsPrefetch = updatedList
                .filter(e => !e.snippet || e.snippet === '')
                .slice(0, 100)
                .map(e => e.id);

              if (needsPrefetch.length > 0) {
                setTimeout(() => prefetchDetails(needsPrefetch, physicalBox), 100);
              }

              saveEmailsToLS(physicalBox, updatedList);
              return updatedList;
            });
          } else {
            // Not current box - update LS directly
            const cachedEmails = localStorage.getItem(`nexus_emails_v2_${physicalBox}`);
            const oldEmails = cachedEmails ? (JSON.parse(cachedEmails) as Email[]) : [];
            const emailMap = new Map<string, Email>(oldEmails.map((e: Email) => [e.id, e]));

            newEmails.forEach(e => {
              const existing = emailMap.get(e.id);
              if (existing) {
                const bestSnippet = existing.snippet || e.snippet || '';
                emailMap.set(e.id, { ...e, snippet: bestSnippet });
              } else {
                emailMap.set(e.id, e);
              }
            });

            const mergedList = Array.from(emailMap.values()).sort((a: any, b: any) =>
              new Date(b.date).getTime() - new Date(a.date).getTime()
            ) as Email[];

            saveEmailsToLS(physicalBox, mergedList);
          }
          return;
        }

        // NON-SILENT MODE: Handle based on whether it is the current visible box
        const isVirtualCurrent = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBoxRef.current);
        const shouldUpdateUI = logicalBox === currentBoxRef.current || (isVirtualCurrent && logicalBox === 'INBOX');

        if (shouldUpdateUI) {
          setEmails(prevEmails => {
            let updatedList: Email[] = [];
            // Strictly merge only with emails belonging to the physical box 
            const boxPrefix = `${physicalBox}-`;
            const boxRelevantEmails = prevEmails.filter(e => e.id.startsWith(boxPrefix));

            // Smart Merge: Prefer existing full items over new placeholder items
            const smartMerge = (newItems: Email[], oldItems: Email[]) => {
              const resultMap = new Map<string, Email>();

              // First add new items (potentially placeholders)
              newItems.forEach(item => resultMap.set(item.id, item));

              // Then iterate old items. If an old item exists in result map
              // AND the result item is a placeholder BUT old item is full,
              // RESTORE the old item.
              oldItems.forEach(oldItem => {
                const newItem = resultMap.get(oldItem.id);
                if (!newItem) return;

                // Preserve snippet if old has it but new doesn't
                const bestSnippet = newItem.snippet || oldItem.snippet || '';

                const oldHasContent = oldItem.body && oldItem.body !== 'Loading...' && oldItem.body.trim() !== '';
                const newIsPlaceholder = !newItem.body || newItem.body === 'Loading...';

                if (newIsPlaceholder && oldHasContent) {
                  resultMap.set(oldItem.id, {
                    ...newItem,
                    body: oldItem.body,
                    attachments: oldItem.attachments,
                    snippet: bestSnippet,
                    isImportant: newItem.isImportant || oldItem.isImportant,
                    isStarred: newItem.isStarred || oldItem.isStarred
                  });
                } else if (bestSnippet && !newItem.snippet) {
                  resultMap.set(oldItem.id, {
                    ...newItem,
                    snippet: bestSnippet,
                    isImportant: newItem.isImportant || oldItem.isImportant,
                    isStarred: newItem.isStarred || oldItem.isStarred
                  });
                } else {
                  // Even if just updating headers, preserve flags to avoid race conditions
                  resultMap.set(oldItem.id, {
                    ...newItem,
                    isImportant: newItem.isImportant || oldItem.isImportant,
                    isStarred: newItem.isStarred || oldItem.isStarred
                  });
                }
              });
              return resultMap;
            };

            if (isLoadMore) {
              const existingMap = new Map<string, Email>(boxRelevantEmails.map(e => [e.id, e]));
              newEmails.forEach(e => {
                if (!existingMap.has(e.id)) existingMap.set(e.id, e);
              });
              updatedList = Array.from(existingMap.values()) as Email[];
            } else {
              const mergedMap = smartMerge(newEmails, boxRelevantEmails);
              updatedList = newEmails.map(e => mergedMap.get(e.id)!);
              const newIds = new Set(newEmails.map(e => e.id));
              const oldRest = boxRelevantEmails.filter(e => !newIds.has(e.id));
              updatedList = [...updatedList, ...oldRest];
            }

            // Persistence
            saveEmailsToLS(physicalBox, updatedList);

            // Fetch
            const idsToFetch = newEmails.map(e => e.id);
            setTimeout(() => prefetchDetails(idsToFetch.slice(0, 100), physicalBox), 100);

            return updatedList;
          });
        } else {
          // NOT CURRENT BOX (Non-silent) - Just update LocalStorage
          saveEmailsToLS(physicalBox, newEmails);
          console.log(`💾 Background non-silent sync updated cache for ${physicalBox}`);
        }

        // Don't auto-select - let user choose which email to read
        // if (!isLoadMore && newEmails.length > 0 && !selectedId) {
        //   setSelectedId(newEmails[0].id);
        // }
      } else {
        console.error('同步失败: ' + (json.error || '未知错误'));
      }
    } catch (e) {
      console.error('Sync error:', e);
    } finally {
      // Only clear loading states if not silent
      if (!silent) {
        setIsSyncing(false);
        setIsLoadingMore(false);
      }
    }
  };

  // Smart Prefetching System
  const prefetchDetails = async (targetIds: string[], boxName: string) => {
    // IGNORE context emails, use internal state to avoid staleness
    // Filter out those that are already being fetched
    const queue = targetIds.filter(id => !pendingPrefetch.current.has(id));

    if (queue.length === 0) return;

    // Mark as pending
    queue.forEach(id => pendingPrefetch.current.add(id));

    console.log(`[Prefetch] Starting download for ${queue.length} emails in ${boxName}...`);

    // Process in batches (Prioritize local cache check)
    const BATCH_SIZE = 5;

    const processBatch = async (batch: string[]) => {
      const promises = batch.map(async (id) => {
        const uid = id.includes('-') ? id.split('-').pop()! : id;
        const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(boxName) ? 'INBOX' : boxName;

        try {
          // 1. Check Local Cache (IDB) First
          const cached = await EmailDB.getBody(uid);
          if (cached && cached.body) {
            return { id, data: cached };
          }

          // 2. Fetch from Network if not in cache
          const res = await apiService.fetchEmailDetail(emailConfig, physicalBox, uid);
          if (res.status === 'success' && res.data) {
            // Save to IDB immediately
            await EmailDB.saveBody(uid, res.data);
            return { id, data: res.data };
          }
        } catch (e) {
          console.warn(`[Prefetch] Failed for ${id}`, e);
        } finally {
          // Release from pending after some time
          setTimeout(() => pendingPrefetch.current.delete(id), 10000);
        }
        return null;
      });

      const results = await Promise.all(promises);

      // Batch Update State
      setEmails(prev => {
        const next = [...prev];
        let hasChange = false;

        results.forEach(r => {
          if (!r) return;

          if (boxName === currentBoxRef.current) {
            const idx = next.findIndex(e => e.id === r.id);
            if (idx !== -1) {
              const snippet = cleanHtmlSnippet(r.data.body || '');
              next[idx] = {
                ...next[idx],
                snippet: snippet,
                body: '',
                attachments: []
              };
              hasChange = true;
            }
          }
        });

        // Critical: We must update LS for the SPECIFIC box, not just relying on 'next'.
        // If boxName != currentBoxRef.current, we can't update 'setEmails'. We must update LS directly.
        if (boxName !== currentBoxRef.current) {
          const cached = localStorage.getItem(`nexus_emails_v2_${boxName}`);
          if (cached) {
            const cachedList = JSON.parse(cached) as Email[];
            let lsChange = false;
            // Update cache directly
            results.forEach(r => {
              if (!r) return;
              const idx = cachedList.findIndex(e => e.id === r.id);
              if (idx !== -1) {
                cachedList[idx].snippet = cleanHtmlSnippet(r.data.body || '');
                // Ensure body/att are stripped in cache
                cachedList[idx].body = '';
                cachedList[idx].attachments = [];
                lsChange = true;
              }
            });
            if (lsChange) {
              localStorage.setItem(`nexus_emails_v2_${boxName}`, JSON.stringify(cachedList));
              console.log(`💾 Persisted ${results.length} snippets for ${boxName} (background)`);
            }
          }
          return prev; // No state change for current view
        }

        if (hasChange) {
          saveEmailsToLS(boxName, next); // Update LS for current box
        }
        return hasChange ? next : prev;
      });
    };

    // Execution Loop
    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      if (boxName !== currentBoxRef.current) break;
      const batch = queue.slice(i, i + BATCH_SIZE);
      await processBatch(batch);
      await new Promise(r => setTimeout(r, 200));
    }
    console.log("[Prefetch] Batch complete.");
  };

  const handleBoxChange = (box: string) => {
    // 1. Determine the base box. 
    // NOW: We treat 'IMPORTANT', 'STARRED', 'UNREAD' as their own boxes for Fetching/Caching purposes.
    // This allows us to cache the specific list of important emails separately from Inbox.
    // The previous "isVirtual" logic forced them to share Inbox cache, which caused "Missing Email" issues.
    const isVirtual = false; // We now handle all boxes as distinct "fetchable" entities
    const baseBox = box;

    setCurrentBox(box);
    currentBoxRef.current = box;
    setHasMore(true);
    setSelectedId(null);
    setSelectedEmailBody(null);

    // Reset filters to avoid conflicts (e.g. Unread Folder + Read Filter = Empty)
    setFilterType('All');
    setSearchTerm('');

    // 2. Load Base Data from Cache (Virtual folders always look at INBOX cache)
    const cached = localStorage.getItem(`nexus_emails_v2_${baseBox}`);
    let hasCache = false;

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Email[];

        // CACHE CLEANUP: Force clear Spams/Drafts/Trash on load to remove any historical pollution
        // The backend now prevents fallback, so we must remove old "Spams-but-actually-Inbox" data.
        if (['Spams'].includes(box)) {
          console.warn(`⚠️ Force clearing cache for ${box} to ensure data integrity.`);
          localStorage.removeItem(`nexus_emails_v2_${baseBox}`);
          setEmails([]);
        } else if (parsed.length > 0) {
          setEmails(parsed);
          hasCache = true;
          console.log(`🚀 Virtual/Base: Loaded ${parsed.length} from ${baseBox} cache for ${box} view`);
        } else {
          setEmails([]);
        }
      } catch (e) {
        setEmails([]);
      }
    } else {
      setEmails([]);
    }

    // 3. Sync Logic (Always sync the baseBox)
    handleSync(baseBox, false, hasCache);
  };


  const handleDownloadAttachment = (emailItem: Email, filename: string) => {
    const params = new URLSearchParams({
      email: emailConfig.email,
      password: emailConfig.password,
      box: emailItem.realBox || currentBox, // use backend-returned realBox or fallback
      uid: emailItem.uid || (emailItem.id.includes('-') ? emailItem.id.split('-').pop()! : emailItem.id),
      filename: filename
    });
    window.open(`${emailApiUrl('/email/attachment')}?${params.toString()}`, '_blank');
  };

  const handleSelectEmail = async (email: Email) => {
    setSelectedId(email.id);
    setSelectedEmailBody(null); // Show loading
    setSelectedEmailAttachments([]);

    const uid = email.uid || (email.id.includes('-') ? email.id.split('-').pop()! : email.id);
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;

    // 0. IMMEDIATE OPTIMISTIC UPDATE: Mark as read effectively immediately
    if (!email.isRead) {
      setEmails(prev => {
        const newList = prev.map(e => e.id === email.id ? { ...e, isRead: true } : e);
        saveEmailsToLS(physicalBox, newList);
        return newList;
      });
      // Fire and forget server sync
      handleToggleRead(email.id, false); // false = was not read, so make it read
    }

    // 1. Try to load from Cache (IndexedDB) first

    try {
      const cachedBody = await EmailDB.getBody(uid);
      if (cachedBody && cachedBody.body) {
        console.log(`[Cache] ✅ Hit for ${uid}`);
        setSelectedEmailBody(cachedBody.body);
        setSelectedEmailAttachments(cachedBody.attachments || []);
        return;
      }
    } catch (e) {
      console.warn("IDB Check Failed", e);
    }

    // 2. Network Fetch (if body not in IDB) with timeout
    console.log(`[Network] Fetching ${uid}...`);
    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 15s')), 15000)
      );

      const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
      const fetchPromise = apiService.fetchEmailDetail(emailConfig, physicalBox, uid);

      // Race between fetch and timeout
      const res = await Promise.race([fetchPromise, timeoutPromise]) as any;

      if (res.status === 'success' && res.data) {
        setSelectedEmailBody(res.data.body);
        setSelectedEmailAttachments(res.data.attachments || []);

        // SAVE TO IDB
        await EmailDB.saveBody(uid, res.data);

        // Update snippet in list if missing?
        setEmails(prev => {
          const snippet = cleanHtmlSnippet(res.data.body || '');
          const newList = prev.map(e => e.id === email.id ? { ...e, snippet, isRead: true } : e);

          // CRITICAL: Persist the new snippet immediately
          saveEmailsToLS(physicalBox, newList);

          return newList;
        });
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (e: any) {
      console.error(`Failed to load detail for ${uid}:`, e);
      setSelectedEmailBody(`内容加载失败：${e.message || 'Unknown error'}`);
    }

    if (isMobile) {
      setMobileView('detail');
    }
  };



  // ── Outbox send（task_mqyqftn8）：只对 outbound Outbox 邮件触发显式 SMTP 发送 ──
  const [outboxSendingId, setOutboxSendingId] = useState<string | null>(null);
  const [outboxError, setOutboxError] = useState<string | null>(null);

  const handleSendOutbox = async (emailId: string) => {
    if (!emailConfig.email || !emailConfig.password) {
      setOutboxError('请先配置邮箱凭据');
      return;
    }
    setOutboxSendingId(emailId);
    setOutboxError(null);
    try {
      const result = await emailOutboxService.sendOutboxEmail(emailId, {
        user: emailConfig.email,
        pass: emailConfig.password,
      });
      if (!result.ok || !result.data) {
        // 失败：保持 Outbox UI 状态，显示后端错误反馈（不本地伪成功）
        const reason = result.error?.message || result.error?.code || '发送失败';
        setOutboxError(`发送失败：${reason}`);
        return;
      }
      // 成功：消费后端返回的 Sent/sentAt/messageId 更新本地（不本地伪造）
      const { messageId, sentAt } = result.data;
      setEmails(prev => prev.map(e => e.id === emailId
        ? { ...e, mailbox: 'Sent', sentAt, messageId, isRead: true }
        : e));
    } catch (e: any) {
      // 网络异常：保持 Outbox UI 状态
      setOutboxError(`发送异常：${e?.message ?? e}`);
    } finally {
      setOutboxSendingId(null);
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmail || !emailConfig.email) return;
    if (isSending) return;
    setIsSending(true);
    setOutboxError(null);
    try {
      let toAddr = selectedEmail.sender;
      if (toAddr.includes('<')) {
        const matches = toAddr.match(/<([^>]+)>/);
        if (matches) toAddr = matches[1];
      }
      const toAddrs = [toAddr].filter(Boolean);
      // originalEmailId 边界：纯数字 IMAP uid 非 DB id，会 404，需先同步到 ERP
      const emailIdStr = String(selectedEmail.id);
      if (!emailIdStr || !/^EML__/.test(emailIdStr)) {
        setOutboxError('该邮件未同步到 ERP 数据库，请先「同步到 ERP」后再回复');
        return;
      }
      const created = await emailOutboxService.createReplyOutboxEmail({
        originalEmailId: emailIdStr,
        fromAddress: emailConfig.email,
        to: toAddrs,
        subject: selectedEmail.subject.startsWith('Re:') ? selectedEmail.subject : `Re: ${selectedEmail.subject}`,
        bodyText: replyContent,
      });
      // 消费后端事实字段：用 emailId 拉真实 Email 记录
      try {
        const apiKey = apiService.getApiKey();
        const detailRes = await fetch(emailApiUrl(`/v1/email/${created.emailId}`), {
          headers: { ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
        });
        const detail = await detailRes.json();
        if (detail?.ok && detail.data) {
          setEmails(prev => [detail.data, ...prev]);
        }
      } catch { /* best-effort refresh */ }
      setIsReplying(false);
      setReplyContent('');
    } catch (e: any) {
      setOutboxError(e?.message || '回复创建失败，请稍后重试');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendNew = async () => {
    if (!emailConfig.email || !composeTo) return;
    if (isSending) return;
    setIsSending(true);
    setOutboxError(null);
    try {
      const toAddrs = composeTo.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      const created = await emailOutboxService.createOutboxEmail({
        fromAddress: emailConfig.email,
        to: toAddrs,
        subject: composeSubject,
        bodyText: composeBody,
      });
      // 消费后端事实字段：用 emailId 拉真实 Email 记录，不伪造 Sent/sentAt/messageId
      try {
        const apiKey = apiService.getApiKey();
        const detailRes = await fetch(emailApiUrl(`/v1/email/${created.emailId}`), {
          headers: { ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
        });
        const detail = await detailRes.json();
        if (detail?.ok && detail.data) {
          setEmails(prev => [detail.data, ...prev]);
        }
      } catch { /* best-effort refresh */ }
      setIsComposing(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setActiveTemplate(null);
      setTemplateVars({});
      setTemplatePickerOpen(false);
    } catch (e: any) {
      setOutboxError(e?.message || '邮件创建失败，请稍后重试');
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleStar = async (id: string, currentStatus: boolean) => {
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
    const newStatus = !currentStatus;

    // 1. Optimistic UI Update
    setEmails(prev => {
      const newList = prev.map(e => e.id === id ? { ...e, isStarred: newStatus } : e);
      saveEmailsToLS(physicalBox, newList);
      return newList;
    });

    // 2. Server Sync
    try {
      const email = emails.find(e => e.id === id);
      if (!email || !emailConfig.email) return;

      await fetch(emailApiUrl('/email/mark_starred'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...emailConfig,
          box: physicalBox,
          uid: email.uid,
          isStarred: newStatus
        })
      });
    } catch (e) {
      console.error("Failed to sync star status", e);
      // Revert if needed, but for now simple log
    }
  };

  const handleToggleImportant = async (id: string, currentStatus: boolean) => {
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
    const newStatus = !currentStatus;

    // 1. Optimistic UI Update
    setEmails(prev => {
      const newList = prev.map(e => e.id === id ? { ...e, isImportant: newStatus } : e);
      saveEmailsToLS(physicalBox, newList);
      return newList;
    });

    // 2. Server Sync
    try {
      const email = emails.find(e => e.id === id);
      if (!email || !emailConfig.email) return;

      await fetch(emailApiUrl('/email/mark_important'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...emailConfig,
          box: physicalBox,
          uid: email.uid,
          isImportant: newStatus
        })
      });
    } catch (e) {
      console.error("Failed to sync important status", e);
    }
  };

  const handleToggleRead = async (id: string, currentStatus: boolean) => {
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
    const newStatus = !currentStatus;

    // 1. Optimistic UI Update
    setEmails(prev => {
      const newList = prev.map(e => e.id === id ? { ...e, isRead: newStatus } : e);
      saveEmailsToLS(physicalBox, newList);
      return newList;
    });

    // 2. Server Sync
    try {
      const email = emails.find(e => e.id === id);
      if (!email || !emailConfig.email) return;

      await fetch(emailApiUrl('/email/mark_read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...emailConfig,
          box: physicalBox,
          uid: email.uid,
          isRead: newStatus
        })
      });
    } catch (e) {
      console.error("Failed to sync read status", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await bdsConfirm({ title: '移入垃圾箱', body: 'Are you sure you want to move this neural stream to the trash?', danger: true }))) return;
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;

    // 1. Optimistic UI Update
    setEmails(prev => {
      const newList = prev.filter(e => e.id !== id);
      saveEmailsToLS(physicalBox, newList);
      return newList;
    });
    setSelectedId(null);

    // 2. Server Sync
    try {
      const email = emails.find(e => e.id === id);
      if (!email || !emailConfig.email) return;

      await fetch(emailApiUrl('/email/move'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...emailConfig,
          box: physicalBox,
          uid: email.uid,
          toBox: 'Trash'
        })
      });
    } catch (e) {
      console.error("Failed to sync delete (move to trash)", e);
    }
  };

  const handleArchive = (id: string) => {
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
    setEmails(prev => {
      const newList = prev.filter(e => e.id !== id);
      saveEmailsToLS(physicalBox, newList);
      return newList;
    });
    setSelectedId(null);
  };

  const handleSpam = async (id: string) => {
    if (!(await bdsConfirm({ title: '举报垃圾邮件', body: 'Report this as spam?' }))) return;
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;

    // 1. Optimistic UI Update
    setEmails(prev => {
      const newList = prev.filter(e => e.id !== id);
      saveEmailsToLS(physicalBox, newList);
      return newList;
    });
    setSelectedId(null);

    // 2. Server Sync
    try {
      const email = emails.find(e => e.id === id);
      if (!email || !emailConfig.email) return;

      await fetch(emailApiUrl('/email/move'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...emailConfig,
          box: physicalBox,
          uid: email.uid,
          toBox: 'Spams'
        })
      });
    } catch (e) {
      console.error("Failed to sync spam (move to junk)", e);
    }
  };

  const handleReplyAll = () => {
    if (!selectedEmail) return;
    const body = selectedEmailBody || '';
    const date = formatFullTime(selectedEmail.date);
    const quote = `
      <br/><br/>
      <div style="border-left: 2px solid #2563EB; padding-left: 15px; margin-left: 5px; color: #64748b;">
        <div style="margin-bottom: 10px; font-size: 13px;">
          <b>From:</b> ${selectedEmail.sender}<br/>
          <b>Date:</b> ${date}<br/>
          <b>To:</b> Me<br/>
          <b>Subject:</b> ${selectedEmail.subject}
        </div>
        <div>${body}</div>
      </div>
    `;
    setComposeTo(selectedEmail.sender);
    setComposeSubject(`Re: ${selectedEmail.subject}`);
    setComposeBody(quote);
    setIsComposing(true);
  };

  const handleForward = () => {
    if (!selectedEmail) return;
    const body = selectedEmailBody || '';
    const date = formatFullTime(selectedEmail.date);
    const quote = `
      <br/><br/>
      <div style="border-left: 2px solid #CBD5E1; padding-left: 15px; margin-left: 5px; color: #64748b;">
        <div style="margin-bottom: 10px; font-size: 13px;">
          <b style="color: #2563EB;">---------- Forwarded message ----------</b><br/>
          <b>From:</b> ${selectedEmail.sender}<br/>
          <b>Date:</b> ${date}<br/>
          <b>Subject:</b> ${selectedEmail.subject}<br/>
          <b>To:</b> Me
        </div>
        <div>${body}</div>
      </div>
    `;
    setComposeTo('');
    setComposeSubject(`Fwd: ${selectedEmail.subject}`);
    setComposeBody(quote);
    setIsComposing(true);
  };

  const handleStartReply = () => {
    if (!selectedEmail) return;
    const body = selectedEmailBody || '';
    const date = formatFullTime(selectedEmail.date);
    const quote = `
      <br/><br/>
      <div style="border-left: 2px solid #2563EB; padding-left: 15px; margin-left: 5px; color: #64748b;">
         <div style="margin-bottom: 8px; font-size: 12px; opacity: 0.8;">On ${date}, ${selectedEmail.sender} wrote:</div>
         <div>${body}</div>
      </div>
    `;
    setReplyContent(quote);
    setIsReplying(true);
  };

  const selectedEmail = emails.find(e => e.id === selectedId);

  // C8：从 IMAP uid 取 DB 覆盖层（含 DB id / labels / 客户与订单链接），与 EmailList 提取口径一致
  const selectedEmailUid = selectedEmail
    ? String(selectedEmail.uid || (selectedEmail.id.includes('-') ? selectedEmail.id.split('-').pop()! : selectedEmail.id))
    : null;
  const selectedIntentInfo = selectedEmailUid ? intentByUid[selectedEmailUid] : undefined;

  /** C8 智能分类：规则+AI 打标（投诉/紧急服务端自动建跟进），结果回写列表覆盖层 */
  const handleClassifyEmail = async () => {
    if (!selectedIntentInfo?.id || classifyBusy) return;
    setClassifyBusy(true);
    setC8Feedback(null);
    try {
      const result = await classifyEmail(selectedIntentInfo.id, { withAi: true });
      if (selectedEmailUid) {
        setIntentByUid(prev => {
          const cur = prev[selectedEmailUid];
          return cur ? { ...prev, [selectedEmailUid]: { ...cur, labels: result.labels } } : prev;
        });
      }
      const addedText = result.added.map(l => EMAIL_LABEL_LABELS[l] || l).join('、');
      const followUpText = result.followUp?.created ? '；已自动创建跟进任务' : '';
      setC8Feedback({ kind: 'ok', text: result.changed ? `分类完成：${addedText}${followUpText}` : `标签已是最新${followUpText}` });
    } catch (e: any) {
      setC8Feedback({ kind: 'err', text: `分类失败：${e?.message || e}` });
    } finally {
      setClassifyBusy(false);
    }
  };

  /** C8 一键建跟进：幂等生成 CRM 跟进任务（无客户链接服务端返回 409） */
  const handleCreateFollowUp = async () => {
    if (!selectedIntentInfo?.id || followUpBusy) return;
    setFollowUpBusy(true);
    setC8Feedback(null);
    try {
      const result = await createFollowUpFromEmail(selectedIntentInfo.id);
      setC8Feedback({ kind: 'ok', text: result.reused ? '跟进任务已存在（幂等复用）' : '已创建跟进任务' });
    } catch (e: any) {
      setC8Feedback({ kind: 'err', text: `建跟进失败：${e?.message || e}` });
    } finally {
      setFollowUpBusy(false);
    }
  };

  // Filtered & Sorted emails
  const displayEmails = React.useMemo(() => {
    let result = emails.filter(e => {
      // 1. Filter by virtual boxes first
      if (currentBox === 'STARRED') {
        if (!e.isStarred) return false;
      } else if (currentBox === 'IMPORTANT') {
        if (!e.isImportant) return false;
      } else if (currentBox === 'UNREAD') {
        if (e.isRead) return false;
      }

      // 2. Filter by dropdown type
      if (filterType === 'Unread' && e.isRead) return false;
      if (filterType === 'Read' && !e.isRead) return false;
      if (filterType === 'Has Attachment' && (!e.attachments || e.attachments.length === 0)) return false;
      if (filterType === 'Follow-ups' && !e.isStarred) return false;
      if (filterType === 'Completed' && !e.isRead) return false; // Approximation

      // 3. Search term
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return e.subject.toLowerCase().includes(term) ||
        e.sender.toLowerCase().includes(term) ||
        (e.snippet && e.snippet.toLowerCase().includes(term));
    });

    // 4. Sorting
    if (sortType === 'Date') {
      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (sortType === 'From') {
      result.sort((a, b) => a.sender.localeCompare(b.sender));
    } else if (sortType === 'Subject') {
      result.sort((a, b) => a.subject.localeCompare(b.subject));
    }

    return result;
  }, [emails, currentBox, searchTerm, filterType, sortType]);

  // F5 意图可视化：displayEmails 变化时批量拉取 AI 意图徽标（薄覆盖层，失败静默）
  useEffect(() => {
    const physicalBox = ['UNREAD', 'STARRED', 'IMPORTANT'].includes(currentBox) ? 'INBOX' : currentBox;
    // 切物理箱时清空：IMAP uid 仅在单箱内唯一，跨箱残留会错标
    if (intentFetchBoxRef.current !== physicalBox) {
      intentFetchBoxRef.current = physicalBox;
      setIntentByUid({});
      return;
    }
    const missingUids = displayEmails
      .map(e => e.uid || (e.id.includes('-') ? e.id.split('-').pop()! : e.id))
      .filter(uid => uid && /^\d+$/.test(String(uid)) && !(String(uid) in intentByUid));
    if (missingUids.length === 0) return;
    let cancelled = false;
    emailIntelligenceService.fetchEmailIntents(physicalBox, missingUids).then(map => {
      if (cancelled || Object.keys(map).length === 0) return;
      setIntentByUid(prev => ({ ...prev, ...map }));
    });
    return () => { cancelled = true; };
  }, [displayEmails, currentBox]);

  // F5 模板库：Compose 打开时按需拉取一次
  useEffect(() => {
    if (!isComposing || templatesLoaded) return;
    let cancelled = false;
    emailIntelligenceService.fetchEmailTemplates().then(items => {
      if (cancelled) return;
      setEmailTemplates(items);
      setTemplatesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [isComposing, templatesLoaded]);

  // 阶段 P3b 签名库：Compose 打开时按需拉取一次（仅启用中的签名）
  useEffect(() => {
    if (!isComposing || signaturesLoaded) return;
    let cancelled = false;
    apiService.listEmailSignatures().then(items => {
      if (cancelled) return;
      setEmailSignatures(items);
      setSignaturesLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setEmailSignatures([]);
      setSignaturesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [isComposing, signaturesLoaded]);

  /** 选择签名：渲染 {{variable}} 后追加到正文末尾（同语言默认签名优先展示由服务端排序保证） */
  const handleSelectSignature = (sig: EmailSignature) => {
    const autoVars = emailIntelligenceService.deriveTemplateVars({ to: composeTo });
    const rendered = emailIntelligenceService.renderEmailTemplate(sig.content, autoVars);
    setComposeBody(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${rendered}` : rendered));
    setSignaturePickerOpen(false);
  };

  /** 选择模板：变量自动填充（收件人/日期等已知值），subject/body 实时渲染；C8 上报使用统计 */
  const handleSelectTemplate = (tpl: EmailTemplate) => {
    const autoVars = emailIntelligenceService.deriveTemplateVars({ to: composeTo });
    setActiveTemplate(tpl);
    setTemplateVars(autoVars);
    setComposeSubject(emailIntelligenceService.renderEmailTemplate(tpl.subject, autoVars));
    setComposeBody(emailIntelligenceService.renderEmailTemplate(tpl.body, autoVars));
    setTemplatePickerOpen(false);
    void markEmailTemplateUsed(tpl.id);
  };

  /** 变量输入联动：从原始模板重渲染（保留未填变量占位符） */
  const handleTemplateVarChange = (name: string, value: string) => {
    if (!activeTemplate) return;
    const next = { ...templateVars, [name]: value };
    setTemplateVars(next);
    setComposeSubject(emailIntelligenceService.renderEmailTemplate(activeTemplate.subject, next));
    setComposeBody(emailIntelligenceService.renderEmailTemplate(activeTemplate.body, next));
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="邮件中心"
        subtitle="Mail / Signature / Templates"
        contextLabel="Email Workspace"
        isDarkMode={isDarkMode}
      />
      <div
        data-email-workspace="full-bleed"
        className="w-full flex-1 min-h-0 min-w-0 flex relative bg-transparent overflow-hidden text-[var(--text-primary)]"
      >

      {/* 1. Workspace rail: sectioned, not a contained app panel. */}
      <aside
        className="flex-shrink-0 flex flex-col transition-[width] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] z-30 bg-transparent border-r shadow-none border-[var(--border-c-default)]"
        style={{ width: isSidebarCollapsed ? '68px' : '250px' }}
      >
        <div className="h-16 flex items-center px-5 border-b overflow-hidden shrink-0 border-[var(--border-c-default)]">
          {!isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => { setIsComposing(true); }}
              className="bds-btn bds-btn-primary flex-1 group mr-2"
            >
              <Plus size={20} strokeWidth={1} className="group-hover:rotate-90 transition-transform duration-300" />
              <span>Compose</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className={`bds-btn bds-btn-ghost bds-btn-icon ${isSidebarCollapsed ? 'text-[var(--accent)]' : ''}`}
          >
            {isSidebarCollapsed ? <PanelLeft size={20} strokeWidth={1} /> : <PanelLeftClose size={20} strokeWidth={1} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-6">
          {/* Primary Hub Section */}
          <section>
            {!isSidebarCollapsed && <div className="px-4 py-2 text-[10px] font-light text-[var(--text-tertiary)] uppercase tracking-[0.2em]">Primary Hub</div>}
            <div className="space-y-0.5 mt-1">
              <NavItem
                icon={Inbox}
                label="Inbox"
                unreadCount={folderCounts['INBOX']?.unread || 0}
                active={currentBox === 'INBOX'}
                onClick={() => handleBoxChange('INBOX')}
                collapsed={isSidebarCollapsed}
              />
              <NavItem
                icon={Mail}
                label="Unread"
                unreadCount={folderCounts['INBOX']?.unread || 0}
                active={currentBox === 'UNREAD'}
                onClick={() => handleBoxChange('UNREAD')}
                collapsed={isSidebarCollapsed}
              />
              <NavItem
                icon={Flag}
                label="Flagged"
                active={currentBox === 'STARRED'}
                onClick={() => handleBoxChange('STARRED')}
                collapsed={isSidebarCollapsed}
              />
              <NavItem
                icon={Star}
                label="Important"
                active={currentBox === 'IMPORTANT'}
                onClick={() => handleBoxChange('IMPORTANT')}
                collapsed={isSidebarCollapsed}
              />
            </div>
          </section>

          {/* System Folders Section */}
          <section>
            {!isSidebarCollapsed && (
              <div className="px-4 py-2 flex items-center justify-between group cursor-pointer">
                <div className="flex items-center gap-1">
                  <ChevronDown size={12} strokeWidth={1} className="text-[var(--text-tertiary)]" />
                  <span className="text-[10px] font-light text-[var(--text-tertiary)] uppercase tracking-[0.2em]">System</span>
                </div>
              </div>
            )}
            <div className="space-y-0.5 mt-1">
              <NavItem
                icon={FileText}
                label="Drafts"
                active={currentBox === 'Drafts'}
                onClick={() => handleBoxChange('Drafts')}
                collapsed={isSidebarCollapsed}
              />
              <NavItem
                icon={Send}
                label="Sent"
                active={currentBox === 'Sent Messages'}
                onClick={() => handleBoxChange('Sent Messages')}
                collapsed={isSidebarCollapsed}
              />
              <NavItem
                icon={Trash2}
                label="Deleted"
                active={currentBox === 'Trash'}
                onClick={() => handleBoxChange('Trash')}
                collapsed={isSidebarCollapsed}
              />
              <NavItem
                icon={ShieldAlert}
                label="Spams"
                active={currentBox === 'Spams'}
                onClick={() => handleBoxChange('Spams')}
                collapsed={isSidebarCollapsed}
              />
            </div>
          </section>
        </div>

        {/* Config / Sync Button at bottom - REFRESH MOVED TO TOP */}
        <div className="p-4 border-t flex justify-between items-center border-[var(--border-c-default)]">
          <button type="button" onClick={() => setIsConfiguring(true)} className="bds-btn bds-btn-secondary">
            <Settings size={14} strokeWidth={1} /> 邮箱设置
          </button>
          <button
            type="button"
            onClick={handleSyncToErp}
            disabled={erpSyncBusy}
            data-erp-sync-busy={erpSyncBusy}
            className={`bds-btn bds-btn-secondary ${erpSyncBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RefreshCcw size={14} strokeWidth={1} className={erpSyncBusy ? 'animate-spin' : ''} />
            {erpSyncBusy ? '同步中…' : '同步到 ERP'}
          </button>
          {erpSyncError && (
            <div className="text-[10px] mt-1 w-full" style={{ color: 'var(--danger-text)' }}>{erpSyncError}</div>
          )}
          {erpSyncResult && (
            <div className="text-[10px] mt-1 w-full" style={{ color: 'var(--success-text)' }}>{erpSyncResult}</div>
          )}
        </div>
      </aside>

      {/* 2. Email List (Middle Pane) */}
      <div className={`flex flex-col border-r shrink-0 z-10 box-content transition-all duration-300 pointer-events-auto bg-transparent border-[var(--border-c-default)] ${isMobile ? 'w-full absolute inset-0' : 'w-[340px] 3xl:w-[390px] relative'}`}>
        {/* Mobile Header for Folder Selection */}
        {isMobile && (
          <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--border-c-default)] bds-surface">
            <h2 className="text-lg font-light text-[var(--text-primary)]">{currentBox}</h2>
            <div className="flex gap-2">
              <button onClick={() => setIsComposing(true)} className="bds-btn bds-btn-ghost bds-btn-icon">
                <Edit size={18} strokeWidth={1} />
              </button>
              <button onClick={() => handleSync(currentBox)} className={`bds-btn bds-btn-ghost bds-btn-icon ${isSyncing ? 'animate-spin' : ''}`}>
                <RefreshCcw size={18} strokeWidth={1} />
              </button>
            </div>
          </div>
        )}

        {/* Desktop Header for List */}
        {!isMobile && (
          <div data-os-adaptive-container="1" className="h-14 border-b flex items-center justify-between px-5 shrink-0 bg-transparent border-[var(--border-c-default)]">
            <div data-ui-lab-wallpaper-contrast="primary" className="flex items-center gap-2 font-light text-sm text-[var(--text-secondary)]">
              <ChevronDown size={14} strokeWidth={1} className="text-[var(--text-quaternary)]" />
              <span>{currentBox === 'INBOX' ? 'Inbox' : currentBox === 'STARRED' ? 'Flagged' : currentBox === 'IMPORTANT' ? 'Important' : currentBox === 'UNREAD' ? 'Unread Messages' : currentBox === 'Sent Messages' ? 'Sent' : currentBox}</span>
            </div>
            <div className="flex items-center gap-4 text-[var(--text-tertiary)]">
              {/* Filter Dropdown */}
              <div className="relative group">
                <Filter size={16} strokeWidth={1} className={`hover:text-[var(--accent-text)] cursor-pointer transition-colors ${filterType !== 'All' ? 'text-[var(--accent-text)]' : ''}`} />
                <div className="absolute right-0 top-full mt-2 w-44 z-[70] hidden group-hover:block animate-in fade-in slide-in-from-top-1 rounded-card border border-[var(--border-c-subtle)] bg-[var(--bg-raised)] p-2">
                  {['All', 'Unread', 'Read', 'Has Attachment', 'Follow-ups', 'Completed'].map(f => (
                    <button
                      key={f}
                      onClick={() => setFilterType(f)}
                      className={`w-full text-left px-4 py-2 text-xs font-light transition-colors flex items-center justify-between rounded-control ${filterType === f ? 'text-[var(--accent-text)] bg-[var(--accent-tint)]' : 'text-[var(--text-secondary)] hover:bg-[var(--hover-darken)]'}`}
                    >
                      {f}
                      {filterType === f && <Check size={12} strokeWidth={1} />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sort Dropdown */}
              <div className="relative group">
                <div className="hover:text-[var(--accent-text)] cursor-pointer transition-all p-1 flex items-center justify-center">
                  <div className="flex flex-col gap-[3px]">
                    <div className="w-[14px] h-[1.5px] bg-current"></div>
                    <div className="w-[10px] h-[1.5px] bg-current"></div>
                    <div className="w-[6px] h-[1.5px] bg-current"></div>
                  </div>
                </div>
                <div className="absolute right-0 top-full mt-2 w-44 z-[70] hidden group-hover:block animate-in fade-in slide-in-from-top-1 rounded-card border border-[var(--border-c-subtle)] bg-[var(--bg-raised)] p-2">
                  <div className="px-4 py-2 text-[11px] font-light text-[var(--text-tertiary)] mb-1">Sort By</div>
                  {[
                    { id: 'Default', label: 'Default Sort' },
                    { id: 'Date', label: 'Date' },
                    { id: 'From', label: 'From' },
                    { id: 'Subject', label: 'Subject' },
                    { id: 'Size', label: 'Mail size' }
                  ].map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSortType(s.id)}
                      className={`w-full text-left px-4 py-2 text-xs font-light transition-colors flex items-center justify-between rounded-control ${sortType === s.id ? 'text-[var(--accent-text)] bg-[var(--accent-tint)]' : 'text-[var(--text-secondary)] hover:bg-[var(--hover-darken)]'}`}
                    >
                      {s.label}
                      {sortType === s.id && <Check size={12} strokeWidth={1} />}
                    </button>
                  ))}
                </div>
              </div>

              <RefreshCcw
                size={15}
                onClick={() => handleSync(currentBox, false)}
                className={`hover:text-[var(--accent-text)] cursor-pointer transition-colors ${isSyncing ? 'animate-spin' : ''}`}
              />
            </div>
          </div>
        )}

        {/* Desktop Search Bar */}
        {!isMobile && (
          <div className="px-5 py-3 bg-transparent border-b border-[var(--border-c-default)]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
              <input
                type="text"
                className="bds-input sm pl-9"
                placeholder="Search (⌘ + Shift + F)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        )}

        <EmailList
          emails={displayEmails}
          selectedId={selectedId}
          onSelect={handleSelectEmail}
          onItemVisible={(ids) => prefetchDetails(ids, currentBox)}
          loadMore={() => handleSync(currentBox, true)}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          isDarkMode={isDarkMode}
          intentByUid={intentByUid}
        />
      </div>

      {/* 3. Reading Pane (Right Pane) */}
      <div className={`
          flex-col overflow-hidden min-w-0 pointer-events-auto transition-all duration-300 bg-transparent
          ${isMobile
          ? `fixed inset-0 z-[60] bg-background ${mobileView === 'detail' ? 'translate-x-0' : 'translate-x-full'}`
          : 'flex-1 relative z-0 flex'}
      `}>
        {/* Mobile Detail Header */}
        {isMobile && (
          <div className="h-14 px-4 flex items-center gap-3 border-b shrink-0 border-[var(--border-c-default)] bds-surface">
            <button onClick={() => setMobileView('list')} className="p-2 -ml-2 text-[var(--text-secondary)]">
              <ChevronDown size={24} strokeWidth={1} className="rotate-90" />
            </button>
            <span className="font-light text-[var(--text-primary)]">Message</span>
          </div>
        )}

        {selectedEmail ? (
          <>
            {/* Header Actions */}
            <div className="h-14 border-b flex items-center justify-between px-6 shrink-0 bg-transparent border-[var(--border-c-default)]">
              <div className="flex items-center gap-2 max-w-full overflow-x-auto">
                {/* Outbox send（task_mqyqftn8）：只对 outbound Outbox 邮件显示发送入口 */}
                {selectedEmail && emailOutboxService.isSendableOutbox(selectedEmail) && (
                  <button
                    type="button"
                    onClick={() => handleSendOutbox(selectedEmail.id)}
                    disabled={outboxSendingId === selectedEmail.id}
                    className="bds-btn bds-btn-secondary disabled:opacity-50"
                  >
                    {outboxSendingId === selectedEmail.id
                      ? <Loader2 size={14} strokeWidth={1} className="animate-spin" />
                      : <SendHorizontal size={14} strokeWidth={1} />}
                    {outboxSendingId === selectedEmail.id ? '发送中...' : '发送'}
                  </button>
                )}
                <button type="button" onClick={handleStartReply} className="bds-btn bds-btn-secondary">
                  <Reply size={14} strokeWidth={1} className="text-[var(--accent)]" /> Reply
                </button>
                <button type="button" onClick={handleReplyAll} className="bds-btn bds-btn-secondary">
                  <ReplyAll size={14} strokeWidth={1} className="text-[var(--accent)]" /> Reply All
                </button>
                {/* Outbox send 错误反馈（保持 Outbox UI 状态，显示后端错误） */}
                {outboxError && (
                  <span className="flex items-center gap-1 px-2 py-1 text-[11px]" style={{ color: 'var(--danger-text)' }}>
                    <AlertCircle size={12} strokeWidth={1} /> {outboxError}
                  </span>
                )}
                <button type="button" onClick={handleForward} className="bds-btn bds-btn-secondary">
                  <Forward size={14} strokeWidth={1} className="text-[var(--accent)]" /> Forward
                </button>
                <div className="w-px h-4 mx-2 self-center bg-[var(--border-c-strong)]"></div>

                <button type="button" onClick={() => handleDelete(selectedId!)} className="bds-btn bds-btn-ghost bds-btn-icon" title="Delete"><Trash2 size={16} /></button>
                <button type="button" onClick={() => handleArchive(selectedId!)} className="bds-btn bds-btn-ghost bds-btn-icon" title="Archive"><Archive size={16} strokeWidth={1} /></button>
                <button type="button" onClick={() => handleSpam(selectedId!)} className="bds-btn bds-btn-ghost bds-btn-icon" title="Report Spam"><ShieldAlert size={16} strokeWidth={1} /></button>

                <div className="w-px h-4 mx-2 self-center bg-[var(--border-c-strong)]"></div>

                <button
                  type="button"
                  onClick={() => handleToggleStar(selectedId!, selectedEmail.isStarred ?? false)}
                  className={`bds-btn bds-btn-ghost bds-btn-icon ${selectedEmail.isStarred ? 'text-[var(--danger)]' : ''}`}
                  title="Tag Flagged (Standard)"
                >
                  <Flag size={16} strokeWidth={1} className={selectedEmail.isStarred ? 'fill-red-400' : ''} />
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleImportant(selectedId!, !!selectedEmail.isImportant)}
                  className={`bds-btn bds-btn-ghost bds-btn-icon ${selectedEmail.isImportant ? 'text-[var(--accent)]' : ''}`}
                  title="Tag Important"
                >
                  <Star size={16} strokeWidth={1} className={selectedEmail.isImportant ? 'fill-accent-cyan/50' : ''} />
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleRead(selectedId!, selectedEmail.isRead)}
                  className={`bds-btn bds-btn-ghost bds-btn-icon ${!selectedEmail.isRead ? 'text-[var(--accent)]' : ''}`}
                  title={selectedEmail.isRead ? "Mark Unread" : "Mark Read"}
                >
                  <Mail size={16} strokeWidth={1} />
                </button>

                {/* C8 邮件深化：智能分类 + 一键建跟进（仅已同步邮件有 DB id 可操作） */}
                {selectedIntentInfo?.id && (
                  <>
                    <div className="w-px h-4 mx-2 self-center bg-[var(--border-c-strong)]"></div>
                    <button
                      type="button"
                      onClick={handleClassifyEmail}
                      disabled={classifyBusy}
                      className="bds-btn bds-btn-secondary"
                      title="规则 + AI 自动打标（投诉/紧急自动建跟进）"
                    >
                      {classifyBusy
                        ? <Loader2 size={14} strokeWidth={1} className="animate-spin text-[var(--text-tertiary)]" />
                        : <Tags size={14} strokeWidth={1} className="text-[var(--accent)]" />}
                      {classifyBusy ? '分类中...' : '智能分类'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateFollowUp}
                      disabled={followUpBusy}
                      className="bds-btn bds-btn-secondary"
                      title="幂等生成 CRM 跟进任务"
                    >
                      {followUpBusy
                        ? <Loader2 size={14} strokeWidth={1} className="animate-spin text-[var(--text-tertiary)]" />
                        : <CalendarPlus size={14} strokeWidth={1} className="text-[var(--accent)]" />}
                      {followUpBusy ? '创建中...' : '建跟进'}
                    </button>
                  </>
                )}
                {/* C8 操作反馈（成功中性色 / 失败警示色，与 outboxError 同区展示） */}
                {c8Feedback && (
                  <span className="flex items-center gap-1 px-2 py-1 text-[11px]" style={{ color: c8Feedback.kind === 'err' ? 'var(--danger-text)' : 'var(--text-tertiary)' }}>
                    {c8Feedback.kind === 'err' && <AlertCircle size={12} strokeWidth={1} />}
                    {c8Feedback.text}
                  </span>
                )}
              </div>

              <div className="flex gap-2 relative group">
                <button type="button" className="bds-btn bds-btn-ghost bds-btn-icon" title="Move to folder"><MoreHorizontal size={16} strokeWidth={1} /></button>
                <div className="absolute right-0 top-full mt-1 w-48 z-[70] hidden group-hover:block animate-in fade-in slide-in-from-top-2 rounded-card border border-[var(--border-c-subtle)] bg-[var(--bg-raised)] p-2">
                  <div className="px-3 py-2 text-[11px] font-light text-[var(--text-tertiary)] mb-1">Move to</div>
                  <button onClick={() => handleBoxChange('INBOX')} className="w-full text-left px-4 py-2 text-sm transition-colors rounded-control text-[var(--text-secondary)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-text)]">Inbox</button>
                  <button onClick={() => handleBoxChange('Sent Messages')} className="w-full text-left px-4 py-2 text-sm transition-colors rounded-control text-[var(--text-secondary)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-text)]">Sent Items</button>
                  <button onClick={() => handleBoxChange('Drafts')} className="w-full text-left px-4 py-2 text-sm transition-colors rounded-control text-[var(--text-secondary)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-text)]">Drafts</button>
                  <button onClick={() => handleBoxChange('Trash')} className="w-full text-left px-4 py-2 text-sm transition-colors rounded-control text-[var(--text-secondary)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-text)]">Deleted</button>
                </div>
              </div>
            </div>

            {/* Reading Content */}
            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
              <div className="max-w-4xl mx-auto">
                <h1 className="text-2xl font-light mb-6 leading-tight text-[var(--text-primary)]">{selectedEmail.subject}</h1>

                {/* C8 分类标签 + 业务关联标记（已同步邮件的 DB 投影；BDS 语义徽章） */}
                {selectedIntentInfo && (selectedIntentInfo.labels.length > 0 || selectedIntentInfo.relationId || selectedIntentInfo.orderId) && (
                  <div className="flex flex-wrap items-center gap-2 mb-6 -mt-3">
                    {selectedIntentInfo.labels.map(l => (
                      <span
                        key={l}
                        className="bds-badge sm neutral"
                      >
                        {EMAIL_LABEL_LABELS[l] || l}
                      </span>
                    ))}
                    {selectedIntentInfo.relationId && (
                      <span className="bds-badge sm info">
                        已关联客户
                      </span>
                    )}
                    {selectedIntentInfo.orderId && (
                      <span className="bds-badge sm info">
                        已关联订单
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between mb-8 pb-6 border-b border-[var(--border-c-default)]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent-blue to-action flex items-center justify-center text-white font-light text-lg">
                      {getInitials(selectedEmail.sender)}
                    </div>
                    <div>
                      <div className="font-light text-[15px] text-[var(--text-primary)]">{selectedEmail.sender}</div>
                      <div className="text-xs mt-0.5 text-[var(--text-tertiary)]">To: Me</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-light text-[var(--text-primary)]">{formatFullTime(selectedEmail.date)}</div>
                    <div className="text-xs mt-1 flex items-center justify-end gap-1 text-[var(--text-tertiary)]">
                      {selectedEmail.isRead ? 'Read' : 'Unread'}
                      <Lock size={10} strokeWidth={1} /> TLS Encrypted
                    </div>
                  </div>
                </div>

                {/* Body Content */}
                {selectedEmailBody === null ? (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
                    <Loader2 size={32} className="animate-spin mb-4 text-[var(--accent)]" />
                    <p>Loading full message content...</p>
                  </div>
                ) : (
                  <div className="prose prose-slate max-w-none mb-10 text-[var(--text-secondary)]">
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedEmailBody || '') }} />
                  </div>
                )}

                {/* Attachments */}
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-[var(--border-c-default)]">
                    <h3 className="text-sm font-light text-[var(--text-primary)] mb-4 flex items-center gap-2">
                      <Paperclip size={16} strokeWidth={1} />
                      {selectedEmail.attachments.length} Attachments
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {selectedEmail.attachments.map((att, idx) => (
                        <div key={idx} className="rdl-data-row flex items-center p-3 transition-all group cursor-pointer text-[var(--text-secondary)] hover:bg-[var(--hover-darken)]"
                          onClick={() => handleDownloadAttachment(selectedEmail, att.filename)}
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--text-tertiary)] shrink-0 group-hover:text-[var(--accent-text)] transition-colors">
                            <FileText size={20} strokeWidth={1} />
                          </div>
                          <div className="ml-3 min-w-0 flex-1">
                            <div className="text-sm font-light truncate group-hover:text-[var(--accent-text)] text-[var(--text-secondary)]">{att.filename}</div>
                            <div className="text-[11px] mt-0.5 text-[var(--text-tertiary)]">{(att.size / 1024).toFixed(1)} KB</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Reply Bar */}
            {!isReplying && (
              <div className="p-4 border-t mt-auto overflow-hidden shrink-0 border-[var(--border-c-default)]">
                <div className="flex gap-3">
                  <button type="button" onClick={handleStartReply} className="bds-btn bds-btn-secondary">
                    <Reply size={16} strokeWidth={1} /> Reply
                  </button>
                  <button type="button" onClick={handleForward} className="bds-btn bds-btn-secondary">
                    <Forward size={16} strokeWidth={1} /> Forward
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-transparent p-12 text-center select-none">
            <div className="relative mb-8">
              <div className="bds-card relative w-40 h-40 flex items-center justify-center !p-0">
                <div className="absolute inset-0 bg-[var(--accent-tint-light)]"></div>
                <div className="relative z-10 flex flex-col items-center">
                  <Mail size={56} strokeWidth={1} className="absolute -top-4 opacity-20 text-[var(--accent)]" />
                  <ShieldCheck size={64} strokeWidth={1} className="text-[var(--accent)]" />
                </div>
              </div>
              <div className="bds-card absolute -bottom-4 -right-4 w-14 h-14 !rounded-full flex items-center justify-center !p-0 border border-[var(--border-c-subtle)]">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: 'var(--accent)' }}>
                  <Lock size={16} strokeWidth={1} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-light text-[var(--text-primary)]">Message Standby</h3>
              <p className="text-[13px] max-w-[320px] leading-relaxed font-light mx-auto text-[var(--text-tertiary)]">
                Select a mailbox item to inspect content, reply, or sync messages into ERP records.
              </p>
            </div>

            <div className="mt-12 flex gap-6 items-center">
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-action animate-pulse"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse delay-75"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse delay-150"></div>
              </div>
              <span className="text-[10px] font-light text-[var(--text-quaternary)]">Secure Mail Gateway</span>
            </div>
          </div>
        )}
      </div>

      {/* Reply Editor Overlay */}
      {
        isReplying && (
          <div className="bds-card absolute bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom-5 border-t border-[var(--border-c-default)]">
            <div className="max-w-5xl mx-auto flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span className="font-light flex items-center gap-2 text-[var(--text-secondary)]"><CornerUpLeft size={16} strokeWidth={1} /> Replying to {selectedEmail?.sender}</span>
                <button type="button" onClick={() => setIsReplying(false)} className="bds-btn bds-btn-ghost bds-btn-icon"><X size={20} /></button>
              </div>
              <div className="rounded-inset h-60 bds-inset">
                <EmailEditor
                  value={replyContent}
                  onChange={setReplyContent}
                  placeholder="Write your reply..."
                  isDarkMode={isDarkMode}
                />
              </div>
              {outboxError && (
                <div className="mb-2 text-xs text-[var(--danger-text)]">{outboxError}</div>
              )}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsReplying(false)} className="bds-btn bds-btn-secondary">Discard</button>
                <button
                  type="button"
                  onClick={handleSendReply}
                  disabled={isSending}
                  className="bds-btn bds-btn-primary"
                >
                  {isSending ? <Loader2 className="animate-spin" size={16} /> : <SendHorizontal size={16} strokeWidth={1} />}
                  Send Reply
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Compose Modal */}
      {
        isComposing && (
          <div className="bds-modal-mask !absolute !z-[80] animate-in fade-in duration-300">
            <div className="bds-modal w-full overflow-hidden flex flex-col h-[80vh] animate-in zoom-in duration-300 !p-0" style={{ width: '56rem' }}>
              <div className="px-8 py-5 flex items-center justify-between bg-[var(--recessed-bg)]">
                <h3 className="text-lg font-light flex items-center gap-3 text-[var(--text-primary)]">
                  <span className="bds-iconbadge text-[var(--accent-text)]">
                    <SendHorizontal size={18} strokeWidth={1} />
                  </span>
                  New Message
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTemplatePickerOpen(v => !v)}
                    className={`bds-btn bds-btn-secondary ${templatePickerOpen ? 'bg-[var(--recessed-bg)]' : ''}`}
                  >
                    <FileText size={14} strokeWidth={1} className="text-[var(--accent)]" /> 模板
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignaturePickerOpen(v => !v)}
                    className={`bds-btn bds-btn-secondary ${signaturePickerOpen ? 'bg-[var(--recessed-bg)]' : ''}`}
                  >
                    <PenLine size={14} strokeWidth={1} className="text-[var(--accent)]" /> 签名
                  </button>
                  <button type="button" onClick={() => setIsComposing(false)} className="bds-btn bds-btn-ghost bds-btn-icon">
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-8 py-4 space-y-4 border-b border-[var(--border-c-default)]">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-light text-[var(--text-tertiary)] w-12 text-right">To:</span>
                    <input
                      value={composeTo}
                      onChange={e => setComposeTo(e.target.value)}
                      placeholder="Recipient email address..."
                      className="flex-1 bg-transparent outline-none text-sm font-light placeholder:text-[var(--text-quaternary)] text-[var(--text-primary)]"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-light text-[var(--text-tertiary)] w-12 text-right">Subject:</span>
                    <input
                      value={composeSubject}
                      onChange={e => setComposeSubject(e.target.value)}
                      placeholder="Enter subject here..."
                      className="flex-1 bg-transparent outline-none text-sm font-light placeholder:text-[var(--text-quaternary)] text-[var(--text-primary)]"
                    />
                  </div>

                  {/* F5 模板选择面板（PRD 12.1：报价/催款/交期通知/验货报告/节日问候） */}
                  {templatePickerOpen && (
                    <div className="rounded-control border p-3 space-y-2 border-[var(--border-c-default)] bg-[var(--recessed-bg)]">
                      {!templatesLoaded ? (
                        <div className="flex items-center gap-2 text-xs font-light text-[var(--text-tertiary)] px-1 py-2">
                          <Loader2 size={12} className="animate-spin" /> 加载模板库...
                        </div>
                      ) : emailTemplates.length === 0 ? (
                        <div className="text-xs font-light text-[var(--text-tertiary)] px-1 py-2">暂无可用模板，请先在服务端播种标准模板库</div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {emailTemplates.map(tpl => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => handleSelectTemplate(tpl)}
                              className="bds-btn bds-btn-secondary"
                            >
                              <span className="text-[var(--text-tertiary)]">{EMAIL_TEMPLATE_TYPE_LABELS[tpl.type] || tpl.type} · </span>
                              {tpl.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 阶段 P3b 签名选择面板（PRD 12.1：统一公司签名格式，插入时渲染 {{variable}}） */}
                  {signaturePickerOpen && (
                    <div className="rounded-control border p-3 space-y-2 border-[var(--border-c-default)] bg-[var(--recessed-bg)]">
                      {!signaturesLoaded ? (
                        <div className="flex items-center gap-2 text-xs font-light text-[var(--text-tertiary)] px-1 py-2">
                          <Loader2 size={12} className="animate-spin" /> 加载签名库...
                        </div>
                      ) : emailSignatures.length === 0 ? (
                        <div className="flex items-center gap-2 text-xs font-light text-[var(--text-tertiary)] px-1 py-2">
                          <span>暂无可用签名</span>
                          <button
                            type="button"
                            onClick={() => setSignatureManagerOpen(true)}
                            className="underline underline-offset-2 text-[var(--accent-text)] hover:text-[var(--accent)]"
                          >
                            前往创建
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {emailSignatures.map(sig => (
                            <button
                              key={sig.id}
                              type="button"
                              onClick={() => handleSelectSignature(sig)}
                              className="bds-btn bds-btn-secondary"
                            >
                              {sig.isDefault && <Star size={10} className="inline mr-1 fill-current opacity-60" />}
                              {sig.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setSignatureManagerOpen(true)}
                            className="px-3 py-1.5 rounded-full text-xs font-light transition-colors border border-dashed border-[var(--border-c-strong)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]"
                          >
                            管理签名
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* F5 模板变量填写行（选中模板且含变量时显示，输入实时渲染） */}
                  {activeTemplate && activeTemplate.variables.length > 0 && (
                    <div className="rounded-control border px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-[var(--border-c-default)] bg-[var(--recessed-bg)]">
                      <span className="text-[10px] font-light text-[var(--text-tertiary)] uppercase tracking-widest flex items-center gap-2">
                        {activeTemplate.name}
                        <button
                          type="button"
                          onClick={() => setActiveTemplate(null)}
                          className="normal-case tracking-normal text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        >
                          解除联动
                        </button>
                      </span>
                      {activeTemplate.variables.map(name => (
                        <label key={name} className="flex items-center gap-1.5 text-xs font-light">
                          <span className="text-[var(--text-tertiary)]">{name}</span>
                          <input
                            value={templateVars[name] || ''}
                            onChange={e => handleTemplateVarChange(name, e.target.value)}
                            placeholder={`{{${name}}}`}
                            className="bds-input sm !w-32"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <textarea
                  value={composeBody}
                  onChange={e => setComposeBody(e.target.value)}
                  className="flex-1 w-full p-8 outline-none resize-none text-sm leading-relaxed selection:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.30)] bg-[var(--recessed-bg)] text-[var(--text-primary)]"
                  placeholder="Write your message..."
                />
              </div>
              <div className="px-8 py-5 flex justify-end gap-4 bg-[var(--recessed-bg)]">
                <button
                  type="button"
                  onClick={() => setIsComposing(false)}
                  className="bds-btn bds-btn-secondary"
                >
                  Discard
                </button>
                {outboxError && (
                  <div className="flex-1 text-xs px-2 text-[var(--danger-text)]">{outboxError}</div>
                )}
                <button
                  type="button"
                  onClick={handleSendNew}
                  disabled={isSending || !composeTo}
                  className={`bds-btn bds-btn-primary ${isSending || !composeTo ? 'opacity-45 cursor-not-allowed' : ''}`}
                >
                  {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={1} />}
                  Send Message
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* 阶段 P3b：签名管理弹窗（关闭后重置加载标记，下次 Compose 重新拉取） */}
      <SignatureManager
        isOpen={signatureManagerOpen}
        onClose={() => { setSignatureManagerOpen(false); setSignaturesLoaded(false); }}
        isDarkMode={isDarkMode}
      />
      {/* Settings Modal */}
      {
        isConfiguring && (
          <div className="bds-modal-mask !absolute !z-[90] animate-in fade-in duration-300">
            <div className="bds-modal overflow-hidden animate-in zoom-in duration-300" style={{ width: '32rem' }}>
              <div className="space-y-8">
                <div className="text-center space-y-2">
                  <span className="bds-iconbadge text-[var(--accent-text)] mx-auto mb-4" style={{ width: 64, height: 64 }}>
                    <Settings size={32} strokeWidth={1} />
                  </span>
                  <h3 className="text-2xl font-light text-[var(--text-primary)]">Link Mail Account</h3>
                  <p className="text-xs font-light text-[var(--text-tertiary)]">Secure IMAP/SMTP Gateway Connection</p>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2.5">
                    <label className="text-[10px] font-light text-[var(--text-tertiary)] uppercase tracking-widest ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--text-quaternary)' }} />
                      <input
                        type="email"
                        value={emailConfig.email}
                        onChange={e => setEmailConfig({ ...emailConfig, email: e.target.value })}
                        className="bds-input pl-11"
                        placeholder="name@company.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <label className="text-[10px] font-light text-[var(--text-tertiary)] uppercase tracking-widest ml-1">App Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--text-quaternary)' }} />
                      <input
                        type="password"
                        value={emailConfig.password}
                        onChange={e => setEmailConfig({ ...emailConfig, password: e.target.value })}
                        className="bds-input pl-11"
                        placeholder="••••••••••••••"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => handleSaveConfig(emailConfig)}
                    className="bds-btn bds-btn-primary w-full text-[11px]"
                  >
                    <CheckCircle2 size={16} /> Connect Securely
                  </button>
                  <button
                    onClick={() => setIsConfiguring(false)}
                    className="bds-btn bds-btn-secondary w-full mt-3 text-[10px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      </div>
    </div >
  );
};

const NavItem = ({ icon: Icon, label, count, unreadCount, active, onClick, iconColor, collapsed }: any) => (
  <button
    onClick={onClick}
    data-rdl-component="data-row"
    data-interactive="true"
    data-selected={active ? 'true' : 'false'}
    className={`rdl-data-row w-full ${collapsed ? 'justify-center !px-0' : 'justify-between'} min-h-11 text-[13px] group ${active
      ? 'text-[var(--accent-text)]'
      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    title={collapsed ? label : ''}
  >
    <div className={`flex items-center ${collapsed ? 'gap-0' : 'gap-3'}`}>
      <div className={`p-1.5 rounded-full transition-colors ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text-tertiary)]'}`}>
        <Icon size={collapsed ? 20 : 16} className={iconColor} />
      </div>
      {!collapsed && <span className={active ? "font-light" : "font-light"}>{label}</span>}
    </div>
    {!collapsed && (
      <div className="flex items-center gap-2">
        {unreadCount !== undefined && unreadCount > 0 && (
          <span className="bds-badge sm neutral min-w-[20px] justify-center">{unreadCount}</span>
        )}
        {count !== undefined && count > 0 && (
          <span className="bds-badge sm neutral min-w-[20px] justify-center opacity-70">{count}</span>
        )}
      </div>
    )}
    {collapsed && unreadCount !== undefined && unreadCount > 0 && (
      <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }}></div>
    )}
  </button>
)

export default EmailManager;
