
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { KnowledgeItem, Insight, SopTemplate, SopStep, KnowledgeRelationView, KnowledgeCitation } from '../types';
import {
  Plus, Search, Trash2, X, Database, Edit2, Save,
  AlertTriangle, Send, Loader2, ListChecks, Link2, Archive, FileText
} from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import { apiService } from '../services/apiService';

const KB_CATEGORIES = ['Product', 'Policy', 'Customer', 'Production', 'Company', 'Supplier'] as const;
type KbCategory = KnowledgeItem['category'];
const toKbCategory = (value: string | null | undefined): KbCategory =>
  (KB_CATEGORIES as readonly string[]).includes(value || '') ? (value as KbCategory) : 'Product';

type KbTab = 'official' | 'memory' | 'qa' | 'sop';

interface KBProps {
  knowledge: KnowledgeItem[];
  setKnowledge: (k: KnowledgeItem[], addedOrModified?: KnowledgeItem) => void;
  insights: Insight[];
  setInsights: (i: Insight[]) => void;
  isDarkMode?: boolean;
}

const KnowledgeBase: React.FC<KBProps> = ({ knowledge, setKnowledge, insights, setInsights, isDarkMode = false }) => {
  const [activeTab, setActiveTab] = useState<KbTab>('official');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [newItem, setNewItem] = useState({ title: '', content: '', category: 'Product' as any });
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // C7 — 文档详情 + 实体关联（图谱只读视图）
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [viewingRelations, setViewingRelations] = useState<KnowledgeRelationView[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);

  // C7 — 智能问答（Python knowledge_api /v1/chat 流式 + /v1/knowledge/search 引用）
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [qaCitations, setQaCitations] = useState<KnowledgeCitation[]>([]);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaArchiveCategory, setQaArchiveCategory] = useState<KbCategory>('Company');
  const [qaArchived, setQaArchived] = useState(false);
  const [qaArchiving, setQaArchiving] = useState(false);

  // C7 — SOP 模板
  const [sopTemplates, setSopTemplates] = useState<SopTemplate[]>([]);
  const [sopLoading, setSopLoading] = useState(false);
  const [sopError, setSopError] = useState<string | null>(null);
  const [sopBusy, setSopBusy] = useState(false);
  const [sopDetail, setSopDetail] = useState<SopTemplate | null>(null);
  const [sopEditing, setSopEditing] = useState<SopTemplate | null>(null);
  const [sopShowNew, setSopShowNew] = useState(false);
  const [sopDeleteId, setSopDeleteId] = useState<string | null>(null);
  const [sopInstantiatedMsg, setSopInstantiatedMsg] = useState('');
  const emptySopDraft = () => ({ title: '', category: 'Production' as string, summary: '', content: '', steps: [] as SopStep[] });
  const [sopDraft, setSopDraft] = useState(emptySopDraft);

  // 挂载时从服务端真源（Prisma KnowledgeDocument）拉取列表并与本地快照合并：
  // 服务端条目为准，本地独有条目（未同步/离线创建）保留。离线时静默降级为本地视图。
  const knowledgeRef = useRef(knowledge);
  knowledgeRef.current = knowledge;
  const serverLoadedRef = useRef(false);
  useEffect(() => {
    if (serverLoadedRef.current) return;
    serverLoadedRef.current = true;
    (async () => {
      try {
        const docs = await apiService.listKnowledgeDocuments();
        const serverItems: KnowledgeItem[] = docs.map(d => ({
          id: d.id,
          title: d.title,
          content: d.content,
          category: toKbCategory(d.category),
          updatedAt: d.updatedAt,
          sourceUrl: `checksum:${d.checksum}|chunks:${d.chunkCount}|version:${d.version}`,
        }));
        const serverIds = new Set(serverItems.map(i => i.id));
        const localOnly = knowledgeRef.current.filter(k => !serverIds.has(k.id));
        setKnowledge([...serverItems, ...localOnly]);
      } catch {
        // 离线/未认证：本地 IndexedDB 快照即降级视图，不打扰用户
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // C7 — SOP tab 首次进入时加载（失败显式提示，区别于知识列表的静默降级：SOP 无本地快照可降）
  const sopLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'sop' || sopLoadedRef.current) return;
    sopLoadedRef.current = true;
    setSopLoading(true);
    apiService.listSopTemplates()
      .then(setSopTemplates)
      .catch(e => setSopError(e?.message || 'SOP 模板加载失败'))
      .finally(() => setSopLoading(false));
  }, [activeTab]);

  // C7 — 详情打开时加载实体关联（仅 ERP 真源文档有图谱数据；失败静默为空区块）
  const viewingItemId = viewingItem?.id;
  useEffect(() => {
    if (!viewingItemId) { setViewingRelations([]); return; }
    let cancelled = false;
    setRelationsLoading(true);
    apiService.listKnowledgeDocumentRelations(viewingItemId)
      .then(r => { if (!cancelled) setViewingRelations(r); })
      .catch(() => { if (!cancelled) setViewingRelations([]); })
      .finally(() => { if (!cancelled) setRelationsLoading(false); });
    return () => { cancelled = true; };
  }, [viewingItemId]);

  const isNotFoundError = (e: any) => /not_found|not found|HTTP 404/i.test(String(e?.message || e || ''));

  const handleAdd = async () => {
    if (!newItem.title || !newItem.content) return;
    if (knowledgeBusy) return;
    setKnowledgeBusy(true);
    setKnowledgeError(null);
    try {
      const json = await apiService.ingestKnowledgeText({ title: newItem.title, text: newItem.content, category: newItem.category });
      const item: KnowledgeItem = {
        id: json.documentId,
        title: newItem.title,
        content: newItem.content,
        category: newItem.category,
        updatedAt: Date.now(),
        sourceUrl: `checksum:${json.checksum}|chunks:${json.chunkCount}|audit:${json.auditId}`,
      };
      setKnowledge([item, ...knowledgeRef.current], item);
      setNewItem({ title: '', content: '', category: 'Product' });
      setShowAddModal(false);
    } catch (e: any) {
      setKnowledgeError(e?.message || '知识写入失败，请稍后重试');
    } finally {
      setKnowledgeBusy(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingItem || knowledgeBusy) return;
    setKnowledgeBusy(true);
    setKnowledgeError(null);
    const applyLocal = (updatedAt: number) => {
      const saved = { ...editingItem, updatedAt };
      setKnowledge(knowledgeRef.current.map(k => (k.id === saved.id ? saved : k)), saved);
      setEditingItem(null);
    };
    try {
      const result = await apiService.updateKnowledgeDocument(editingItem.id, {
        title: editingItem.title,
        text: editingItem.content,
        category: editingItem.category,
      });
      applyLocal(result.updatedAt);
    } catch (e: any) {
      // 本地遗留条目（从未写入服务端真源）：降级为仅本地更新
      if (isNotFoundError(e)) applyLocal(Date.now());
      else setKnowledgeError(e?.message || '知识修正失败，请稍后重试');
    } finally {
      setKnowledgeBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId || knowledgeBusy) return;
    const targetId = deleteConfirmId;
    setKnowledgeBusy(true);
    setKnowledgeError(null);
    const applyTombstone = () => {
      const target = knowledgeRef.current.find(k => k.id === targetId);
      if (target) {
        const tombstone = { ...target, deletedAt: Date.now() };
        setKnowledge(knowledgeRef.current.map(k => (k.id === targetId ? tombstone : k)), tombstone);
      }
      setDeleteConfirmId(null);
    };
    try {
      await apiService.deleteKnowledgeDocument(targetId);
      applyTombstone();
    } catch (e: any) {
      // 本地遗留条目：降级为仅本地墓碑
      if (isNotFoundError(e)) applyTombstone();
      else setKnowledgeError(e?.message || '移除失败，请稍后重试');
    } finally {
      setKnowledgeBusy(false);
    }
  };

  const handleSolidifyMemory = (insight: Insight) => {
    setNewItem({
      title: insight.fact.slice(0, 15).trim() + (insight.fact.length > 15 ? '...' : ''),
      content: insight.fact,
      category: 'Policy'
    });
    setShowAddModal(true);
  };

  // ─── C7 智能问答 ───

  const handleAsk = async () => {
    const q = qaQuestion.trim();
    if (!q || qaBusy) return;
    setQaBusy(true);
    setQaError(null);
    setQaAnswer('');
    setQaCitations([]);
    setQaArchived(false);
    try {
      // 引用检索与流式回答并行：search 出引用片段，chat 流式出答案（两次嵌入可接受，零服务端改动）
      const searchPromise = apiService.searchKnowledgeBase(q).then(setQaCitations).catch(() => setQaCitations([]));
      await apiService.askKnowledgeBase(q, piece => setQaAnswer(prev => prev + piece));
      await searchPromise;
    } catch (e: any) {
      setQaError(e?.message || '问答服务暂不可用，请稍后重试');
    } finally {
      setQaBusy(false);
    }
  };

  const handleArchiveQa = async () => {
    const q = qaQuestion.trim();
    const a = qaAnswer.trim();
    if (!q || !a || qaArchiving || qaArchived) return;
    setQaArchiving(true);
    setQaError(null);
    try {
      const title = `问答：${q.slice(0, 40)}${q.length > 40 ? '…' : ''}`;
      const text = `问题：${q}\n\n回答：${a}`;
      const json = await apiService.ingestKnowledgeText({ title, text, category: qaArchiveCategory, sourceType: 'qa' });
      const item: KnowledgeItem = {
        id: json.documentId,
        title,
        content: text,
        category: qaArchiveCategory,
        updatedAt: Date.now(),
        sourceUrl: `checksum:${json.checksum}|chunks:${json.chunkCount}|audit:${json.auditId}`,
      };
      setKnowledge([item, ...knowledgeRef.current], item);
      setQaArchived(true);
    } catch (e: any) {
      setQaError(e?.message || '归档失败，请稍后重试');
    } finally {
      setQaArchiving(false);
    }
  };

  // ─── C7 SOP 模板 ───

  const openNewSop = () => {
    setSopEditing(null);
    setSopDraft(emptySopDraft());
    setSopShowNew(true);
    setSopError(null);
  };

  const openEditSop = (tpl: SopTemplate) => {
    setSopEditing(tpl);
    setSopDraft({
      title: tpl.title,
      category: tpl.category,
      summary: tpl.summary || '',
      content: tpl.content,
      steps: tpl.steps.map(s => ({ ...s })),
    });
    setSopShowNew(true);
    setSopError(null);
  };

  const handleSaveSop = async () => {
    if (sopBusy) return;
    const title = sopDraft.title.trim();
    const content = sopDraft.content.trim();
    if (!title || !content) { setSopError('标题与正文为必填项'); return; }
    const steps = sopDraft.steps
      .map(s => ({ title: s.title.trim(), ...(s.detail?.trim() ? { detail: s.detail.trim() } : {}) }))
      .filter(s => s.title);
    setSopBusy(true);
    setSopError(null);
    try {
      if (sopEditing) {
        const updated = await apiService.updateSopTemplate(sopEditing.id, {
          title,
          category: sopDraft.category,
          summary: sopDraft.summary.trim() || null,
          content,
          steps,
        });
        setSopTemplates(prev => prev.map(t => (t.id === updated.id ? updated : t)));
        if (sopDetail?.id === updated.id) setSopDetail(updated);
      } else {
        const created = await apiService.createSopTemplate({
          title,
          category: sopDraft.category,
          summary: sopDraft.summary.trim() || undefined,
          content,
          steps,
        });
        setSopTemplates(prev => [created, ...prev]);
      }
      setSopShowNew(false);
      setSopEditing(null);
    } catch (e: any) {
      setSopError(e?.message || 'SOP 保存失败');
    } finally {
      setSopBusy(false);
    }
  };

  const handleDeleteSop = async () => {
    if (!sopDeleteId || sopBusy) return;
    setSopBusy(true);
    setSopError(null);
    try {
      await apiService.deleteSopTemplate(sopDeleteId);
      setSopTemplates(prev => prev.filter(t => t.id !== sopDeleteId));
      if (sopDetail?.id === sopDeleteId) setSopDetail(null);
      setSopDeleteId(null);
    } catch (e: any) {
      setSopError(e?.message || 'SOP 删除失败');
    } finally {
      setSopBusy(false);
    }
  };

  const handleInstantiateSop = async (tpl: SopTemplate) => {
    if (sopBusy) return;
    setSopBusy(true);
    setSopError(null);
    setSopInstantiatedMsg('');
    try {
      const r = await apiService.instantiateSopTemplate(tpl.id);
      // 本地同步知识列表（渲染规则与服务端 renderSopTemplateText 保持一致：摘要 + 编号步骤 + 正文）
      const stepsText = tpl.steps.length > 0
        ? tpl.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? `\n   ${s.detail}` : ''}`).join('\n')
        : '';
      const text = [tpl.summary?.trim(), stepsText, tpl.content.trim()].filter(Boolean).join('\n\n');
      const item: KnowledgeItem = {
        id: r.documentId,
        title: `SOP：${tpl.title}`,
        content: text,
        category: toKbCategory(tpl.category),
        updatedAt: Date.now(),
        sourceUrl: `checksum:${r.checksum}|chunks:${r.chunkCount}`,
      };
      setKnowledge([item, ...knowledgeRef.current], item);
      setSopInstantiatedMsg(`已入库为知识文档（v${r.templateVersion}，${r.chunkCount} 个分块）`);
    } catch (e: any) {
      setSopError(e?.message || '实例化失败（同一模板同一版本仅可入库一次）');
    } finally {
      setSopBusy(false);
    }
  };

  const filteredOfficial = knowledge.filter(k =>
    !k.deletedAt && (
      k.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      k.content.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const tabButtonClass = (tab: KbTab) =>
    `px-6 py-1.5 rounded-compact text-[11px] font-light tracking-wide transition-all ${activeTab === tab ? BAMBOOK_OS.controls.selectedSurface.base : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`;

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-hidden">
      <PageHeader
        title="策略文库"
        subtitle="Knowledge Base"
        contextLabel="Knowledge Library"
        isDarkMode={isDarkMode}
        actions={(
          <div className="flex items-center gap-4 shrink-0">
            <div className="relative group">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${'text-[var(--text-quaternary)] group-focus-within:text-[var(--text-link)]'}`} size={14} />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索资产..."
                className={`pl-9 pr-4 py-2 border rounded-control outline-none font-normal text-xs transition-all w-64 ${'bg-[var(--recessed-bg)] border-[var(--border-c-default)] focus:ring-2 focus:ring-[var(--border-c-default)]'}`}
              />
            </div>
            <button onClick={() => setShowAddModal(true)} className={`px-4 py-2 rounded-full flex items-center gap-2 transition-all text-[11px] font-light tracking-wide ${'bg-[var(--recessed-bg)] border border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]'}`}>
              <Plus size={14} strokeWidth={1} /> 新增资产
            </button>
          </div>
        )}
      />

      <div className={`${BAMBOOK_OS.layout.desktopSinglePanelBodyClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`}>
      {/* Tab Bar - Fixed Height */}
      <div className={`${BAMBOOK_OS.layout.desktopSubtoolbarClass} justify-center bg-transparent`}>
        <div className={`inline-flex p-1 rounded-full ${BAMBOOK_OS.controls.actionControl.base}`}>
          <button onClick={() => setActiveTab('official')} className={tabButtonClass('official')}>官方知识库 ({filteredOfficial.length})</button>
          <button onClick={() => setActiveTab('memory')} className={tabButtonClass('memory')}>智脑神经记忆 ({insights.length})</button>
          <button onClick={() => setActiveTab('qa')} className={tabButtonClass('qa')}>智能问答</button>
          <button onClick={() => setActiveTab('sop')} className={tabButtonClass('sop')}>SOP 模板 ({sopTemplates.length})</button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto py-4">
        {activeTab === 'official' && (
          <motion.div layout className="grid grid-cols-[repeat(auto-fill,340px)] gap-6 md:gap-8 justify-center content-start">
            {filteredOfficial.map(item => (
              <motion.div layout key={item.id} data-os-adaptive-container="1" onClick={() => setViewingItem(item)} className={`shrink-0 w-[340px] p-6 flex flex-col group relative overflow-hidden cursor-pointer ${BAMBOOK_OS.material.card} transition-all duration-300 ${'bg-[var(--recessed-bg)] hover:bg-[var(--hover-darken)]'}`}>
                <div className="absolute top-5 right-5 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={(e) => { e.stopPropagation(); setEditingItem(item); }} className={`p-2.5 border rounded-control transition-all ${BAMBOOK_OS.controls.actionControl.base}`}>
                    <Edit2 size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(item.id); }} className={`p-2.5 border rounded-control transition-all ${BAMBOOK_OS.controls.actionControl.base} hover:text-[var(--danger-text)]`}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mb-4">
                  <span className={`px-2.5 py-1 text-[9px] font-light tracking-wide rounded-full border ${BAMBOOK_OS.controls.actionControl.base}`}>
                    {item.category}
                  </span>
                </div>
                <h4 data-ui-lab-wallpaper-contrast="primary" className={`text-base font-light mb-2 text-[var(--text-primary)]`}>{item.title}</h4>
                <p data-ui-lab-wallpaper-contrast="secondary" className={`text-[13px] line-clamp-4 font-light leading-relaxed flex-1 ${'text-[var(--text-tertiary)]'}`}>{item.content}</p>
                <div className={`mt-6 pt-4 border-t flex items-center justify-between border-[var(--border-c-default)]`}>
                  <span className={`text-[10px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>{new Date(item.updatedAt).toLocaleDateString()}</span>
                  <Database size={14} strokeWidth={1} className="text-[var(--text-quaternary)]" />
                </div>
              </motion.div>
            ))}
            {filteredOfficial.length === 0 && (
              <div className={`w-full py-20 flex flex-col items-center justify-center ${'text-[var(--text-quaternary)]'}`}>
                <Database size={60} strokeWidth={1} className="opacity-10 mb-4" />
                <p className="text-xs font-light tracking-wide">暂无检索匹配的资产档案</p>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'memory' && (
          <motion.div layout className="grid grid-cols-[repeat(auto-fill,340px)] gap-6 md:gap-8 justify-center content-start">
            {insights.map(insight => (
              <motion.div layout key={insight.id} className={`shrink-0 w-[340px] p-6 flex flex-col ${BAMBOOK_OS.material.card} transition-all duration-300 ${'bg-[var(--recessed-bg)] hover:bg-[var(--hover-darken)]'}`}>
                <div className="flex-1">
                  <p className={`text-[14px] font-light leading-relaxed italic ${'text-[var(--text-secondary)]'}`}>"{insight.fact}"</p>
                </div>
                <div className={`mt-6 pt-4 border-t flex items-center justify-between border-[var(--border-c-default)]`}>
                  <span className={`text-[9px] font-light tracking-wide ${'text-[var(--text-link)]'}`}>{insight.importance} PRIORITY</span>
                  <button onClick={() => handleSolidifyMemory(insight)} className={`px-4 py-2 rounded-full text-[10px] font-light transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}>
                    固化入库
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {activeTab === 'qa' && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {/* 提问区 */}
            <div className={`p-6 ${BAMBOOK_OS.material.card} ${'bg-[var(--recessed-bg)]'}`}>
              <textarea
                rows={3}
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                placeholder="向知识库提问，如：面料尾期验货的抽样标准是什么？"
                className={`w-full px-5 py-4 border rounded-control outline-none font-light resize-none text-sm leading-relaxed transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
              />
              <div className="mt-4 flex items-center justify-between">
                <span className={`text-[10px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>向量检索知识语料 + LLM 流式回答，命中片段在下方列出</span>
                <button
                  onClick={handleAsk}
                  disabled={qaBusy || !qaQuestion.trim()}
                  className={`px-5 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border disabled:opacity-50 ${BAMBOOK_OS.controls.actionControl.base}`}
                >
                  {qaBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.2} />}
                  {qaBusy ? '检索回答中…' : '提问'}
                </button>
              </div>
            </div>

            {qaError && (
              <div className={`px-5 py-3 rounded-control border text-xs font-light ${'border-danger/30 bg-[var(--danger-tint)] text-[var(--danger-text)]'}`}>{qaError}</div>
            )}

            {/* 回答区 */}
            {(qaAnswer || qaBusy) && (
              <div className={`p-6 ${BAMBOOK_OS.material.card} ${'bg-[var(--recessed-bg)]'}`}>
                <div className={`mb-3 text-[10px] font-light tracking-[0.18em] ${'text-[var(--text-quaternary)]'}`}>回答</div>
                <p className={`whitespace-pre-wrap text-[13px] font-light leading-relaxed ${'text-[var(--text-secondary)]'}`}>
                  {qaAnswer}
                  {qaBusy && <span className="inline-block w-2 h-4 ml-0.5 align-middle animate-pulse bg-current opacity-40" />}
                </p>
                {!qaBusy && qaAnswer.trim() && (
                  <div className={`mt-5 pt-4 border-t flex items-center justify-end gap-3 border-[var(--border-c-default)]`}>
                    {qaArchived ? (
                      <span className={`text-[11px] font-light ${'text-[var(--success-text)]'}`}>已归档到官方知识库</span>
                    ) : (
                      <>
                        <select
                          value={qaArchiveCategory}
                          onChange={(e) => setQaArchiveCategory(e.target.value as KbCategory)}
                          className={`px-3 py-2 border rounded-control outline-none text-[11px] font-light appearance-none ${BAMBOOK_OS.controls.recessedField.base}`}
                        >
                          {KB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button
                          onClick={handleArchiveQa}
                          disabled={qaArchiving}
                          className={`px-4 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border disabled:opacity-50 ${BAMBOOK_OS.controls.actionControl.base}`}
                        >
                          {qaArchiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} strokeWidth={1.2} />}
                          归档此问答
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 引用片段 */}
            {qaCitations.length > 0 && (
              <div className={`p-6 ${BAMBOOK_OS.material.card} ${'bg-[var(--recessed-bg)]'}`}>
                <div className={`mb-3 text-[10px] font-light tracking-[0.18em] ${'text-[var(--text-quaternary)]'}`}>命中片段 ({qaCitations.length})</div>
                <div className="space-y-3">
                  {qaCitations.map(c => (
                    <div key={c.id} className={`rounded-control border px-4 py-3 ${'border-[var(--border-c-default)] bg-[var(--recessed-bg)]'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-[11px] font-light truncate ${'text-[var(--text-tertiary)]'}`}>{c.title}</span>
                        <span className={`shrink-0 text-[9px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>{Math.round(c.score * 100)}%</span>
                      </div>
                      <p className={`mt-1 line-clamp-2 text-[11px] font-light leading-relaxed ${'text-[var(--text-quaternary)]'}`}>{c.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'sop' && (
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-5 flex items-center justify-between">
              <span className={`text-[10px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>标准作业程序模板，可一键实例化为知识文档进入检索语料</span>
              <button onClick={openNewSop} className={`px-4 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}>
                <Plus size={13} strokeWidth={1} /> 新建模板
              </button>
            </div>
            {sopError && (
              <div className={`mb-4 px-5 py-3 rounded-control border text-xs font-light ${'border-danger/30 bg-[var(--danger-tint)] text-[var(--danger-text)]'}`}>{sopError}</div>
            )}
            {sopLoading ? (
              <div className={`py-16 flex items-center justify-center gap-2 ${'text-[var(--text-quaternary)]'}`}>
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs font-light">模板加载中…</span>
              </div>
            ) : (
              <motion.div layout className="grid grid-cols-[repeat(auto-fill,340px)] gap-6 justify-center content-start">
                {sopTemplates.map(tpl => (
                  <motion.div layout key={tpl.id} onClick={() => { setSopDetail(tpl); setSopInstantiatedMsg(''); setSopError(null); }} className={`shrink-0 w-[340px] p-6 flex flex-col cursor-pointer ${BAMBOOK_OS.material.card} transition-all duration-300 ${'bg-[var(--recessed-bg)] hover:bg-[var(--hover-darken)]'}`}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`px-2.5 py-1 text-[9px] font-light tracking-wide rounded-full border ${BAMBOOK_OS.controls.actionControl.base}`}>{tpl.category}</span>
                      <span className={`text-[9px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>v{tpl.version}</span>
                    </div>
                    <h4 className={`text-base font-light mb-2 text-[var(--text-primary)]`}>{tpl.title}</h4>
                    <p className={`text-[12px] line-clamp-3 font-light leading-relaxed flex-1 ${'text-[var(--text-tertiary)]'}`}>{tpl.summary || tpl.content}</p>
                    <div className={`mt-5 pt-4 border-t flex items-center justify-between border-[var(--border-c-default)]`}>
                      <span className={`flex items-center gap-1.5 text-[10px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>
                        <ListChecks size={12} strokeWidth={1.2} /> {tpl.steps.length} 步骤
                      </span>
                      <span className={`text-[10px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>{new Date(tpl.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </motion.div>
                ))}
                {sopTemplates.length === 0 && !sopLoading && (
                  <div className={`w-full py-20 flex flex-col items-center justify-center ${'text-[var(--text-quaternary)]'}`}>
                    <ListChecks size={60} strokeWidth={1} className="opacity-10 mb-4" />
                    <p className="text-xs font-light tracking-wide">暂无 SOP 模板</p>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* 新增/编辑知识 Modal */}
      {(showAddModal || editingItem) && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-[70] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${BAMBOOK_OS.material.glassColor} ${'bg-[var(--bg-card)]'} w-full max-w-xl overflow-hidden scale-in-center rounded-card border border-transparent shadow-none backdrop-saturate-[104%]`}>
            <div className={`px-12 py-8 border-b flex items-center justify-between ${'border-[var(--border-c-default)]'}`}>
              <h3 className={`text-lg font-light text-[var(--text-primary)]`}>{editingItem ? '修正资产档案' : '录入新资产'}</h3>
              <button onClick={() => { setShowAddModal(false); setEditingItem(null); }} className={`p-2 rounded-full ${BAMBOOK_OS.controls.actionControl.base}`}><X size={18} /></button>
            </div>
            <div className="p-12 space-y-8">
              <div className="space-y-4">
                <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">资产标题</label>
                <input
                  type="text"
                  value={editingItem ? editingItem.title : newItem.title}
                  onChange={(e) => editingItem ? setEditingItem({ ...editingItem, title: e.target.value }) : setNewItem({ ...newItem, title: e.target.value })}
                  className={`w-full px-7 py-5 border rounded-full outline-none font-light transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                  placeholder="如：Panda AW25 辅料质检协议"
                />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">资产类型</label>
                <select
                  value={editingItem ? editingItem.category : newItem.category}
                  onChange={(e) => editingItem ? setEditingItem({ ...editingItem, category: e.target.value as any }) : setNewItem({ ...newItem, category: e.target.value as any })}
                  className={`w-full px-7 py-5 border rounded-full outline-none font-light text-sm transition-all appearance-none ${BAMBOOK_OS.controls.recessedField.base}`}
                >
                  <option value="Product">Product - 产品知识</option>
                  <option value="Policy">Policy - 商务政策</option>
                  <option value="Customer">Customer - 客户偏好</option>
                  <option value="Production">Production - 生产流程</option>
                  <option value="Company">Company - 集团制度</option>
                  <option value="Supplier">Supplier - 供应商档案</option>
                </select>
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">核心摘要</label>
                <textarea
                  rows={5}
                  value={editingItem ? editingItem.content : newItem.content}
                  onChange={(e) => editingItem ? setEditingItem({ ...editingItem, content: e.target.value }) : setNewItem({ ...newItem, content: e.target.value })}
                  className={`w-full px-7 py-5 border rounded-full outline-none font-light resize-none leading-relaxed transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                  placeholder="请输入核心知识点内容..."
                />
              </div>
            </div>
            <div className={`px-12 py-10 flex justify-end gap-6 bg-[var(--recessed-bg)]`}>
              {knowledgeError && (
                <div className="mr-auto text-xs text-[var(--danger-text)]">{knowledgeError}</div>
              )}
              <button
                onClick={editingItem ? handleEditSave : handleAdd}
                disabled={knowledgeBusy}
                data-knowledge-busy={knowledgeBusy}
                className={`px-10 py-4 text-[11px] font-light tracking-wide rounded-full flex items-center gap-3 border transition-all ${knowledgeBusy ? 'opacity-50 cursor-not-allowed' : BAMBOOK_OS.controls.actionControl.base}`}
              >
                <Save size={16} strokeWidth={1} /> {knowledgeBusy ? '同步中…' : editingItem ? '固化修正' : '确认存入并即时同步'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C7 — 知识文档详情 + 实体关联 Modal */}
      {viewingItem && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-[70] flex items-center justify-center p-6 animate-in fade-in duration-300" onClick={(e) => { if (e.target === e.currentTarget) setViewingItem(null); }}>
          <div className={`${BAMBOOK_OS.material.glassColor} ${'bg-[var(--bg-card)]'} w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden scale-in-center rounded-card border border-transparent shadow-none backdrop-saturate-[104%]`}>
            <div className={`px-10 py-6 border-b flex items-center justify-between shrink-0 ${'border-[var(--border-c-default)]'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className={`shrink-0 px-2.5 py-1 text-[9px] font-light tracking-wide rounded-full border ${BAMBOOK_OS.controls.actionControl.base}`}>{viewingItem.category}</span>
                <h3 className={`text-lg font-light truncate text-[var(--text-primary)]`}>{viewingItem.title}</h3>
              </div>
              <button onClick={() => setViewingItem(null)} className={`p-2 rounded-full shrink-0 ${BAMBOOK_OS.controls.actionControl.base}`}><X size={18} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-10 py-6 space-y-6">
              <p className={`whitespace-pre-wrap text-[13px] font-light leading-relaxed ${'text-[var(--text-secondary)]'}`}>{viewingItem.content}</p>
              <div>
                <div className={`mb-3 flex items-center gap-2 text-[10px] font-light tracking-[0.18em] ${'text-[var(--text-quaternary)]'}`}>
                  <Link2 size={12} strokeWidth={1.2} /> 实体关联
                </div>
                {relationsLoading ? (
                  <div className={`flex items-center gap-2 py-3 ${'text-[var(--text-quaternary)]'}`}>
                    <Loader2 size={13} className="animate-spin" />
                    <span className="text-[11px] font-light">关联加载中…</span>
                  </div>
                ) : viewingRelations.length > 0 ? (
                  <div className="space-y-2">
                    {viewingRelations.map(rel => (
                      <div key={rel.id} className={`flex items-center justify-between gap-3 rounded-control border px-4 py-2.5 ${'border-[var(--border-c-default)] bg-[var(--recessed-bg)]'}`}>
                        <div className="flex items-center gap-2 min-w-0 text-[11px] font-light">
                          <span className={'text-[var(--text-tertiary)]'}>{rel.relationType}</span>
                          <span className="text-[var(--text-quaternary)]">→</span>
                          <span className={`truncate ${'text-[var(--text-tertiary)]'}`}>{rel.targetType} / {rel.targetId}</span>
                        </div>
                        <span className={`shrink-0 text-[9px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>{Math.round(rel.confidence * 100)}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={`text-[11px] font-light ${'text-[var(--text-quaternary)]'}`}>暂无实体关联记录（关联由知识抽取管线自动建立）</p>
                )}
              </div>
            </div>
            <div className={`px-10 py-5 shrink-0 flex items-center justify-between bg-[var(--recessed-bg)]`}>
              <span className={`text-[10px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>更新于 {new Date(viewingItem.updatedAt).toLocaleDateString()}</span>
              <button onClick={() => { setEditingItem(viewingItem); setViewingItem(null); }} className={`px-5 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}>
                <Edit2 size={12} /> 编辑
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C7 — SOP 详情 Modal */}
      {sopDetail && !sopShowNew && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-[70] flex items-center justify-center p-6 animate-in fade-in duration-300" onClick={(e) => { if (e.target === e.currentTarget) setSopDetail(null); }}>
          <div className={`${BAMBOOK_OS.material.glassColor} ${'bg-[var(--bg-card)]'} w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden scale-in-center rounded-card border border-transparent shadow-none backdrop-saturate-[104%]`}>
            <div className={`px-10 py-6 border-b flex items-center justify-between shrink-0 ${'border-[var(--border-c-default)]'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className={`shrink-0 px-2.5 py-1 text-[9px] font-light tracking-wide rounded-full border ${BAMBOOK_OS.controls.actionControl.base}`}>{sopDetail.category}</span>
                <h3 className={`text-lg font-light truncate text-[var(--text-primary)]`}>{sopDetail.title}</h3>
                <span className={`shrink-0 text-[9px] font-light tracking-wide ${'text-[var(--text-quaternary)]'}`}>v{sopDetail.version}</span>
              </div>
              <button onClick={() => setSopDetail(null)} className={`p-2 rounded-full shrink-0 ${BAMBOOK_OS.controls.actionControl.base}`}><X size={18} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-10 py-6 space-y-6">
              {sopDetail.summary && (
                <p className={`text-[13px] font-light leading-relaxed ${'text-[var(--text-tertiary)]'}`}>{sopDetail.summary}</p>
              )}
              {sopDetail.steps.length > 0 && (
                <div className="space-y-3">
                  {sopDetail.steps.map((step, i) => (
                    <div key={i} className={`rounded-control border px-4 py-3 ${'border-[var(--border-c-default)] bg-[var(--recessed-bg)]'}`}>
                      <div className={`text-[12px] font-light text-[var(--text-secondary)]`}>{i + 1}. {step.title}</div>
                      {step.detail && <div className={`mt-1 text-[11px] font-light leading-relaxed ${'text-[var(--text-quaternary)]'}`}>{step.detail}</div>}
                    </div>
                  ))}
                </div>
              )}
              <p className={`whitespace-pre-wrap text-[13px] font-light leading-relaxed ${'text-[var(--text-secondary)]'}`}>{sopDetail.content}</p>
            </div>
            <div className={`px-10 py-5 shrink-0 flex items-center justify-end gap-3 bg-[var(--recessed-bg)]`}>
              {sopInstantiatedMsg && <span className={`mr-auto text-[11px] font-light ${'text-[var(--success-text)]'}`}>{sopInstantiatedMsg}</span>}
              {sopError && <span className="mr-auto text-[11px] font-light text-[var(--danger-text)]">{sopError}</span>}
              <button onClick={() => setSopDeleteId(sopDetail.id)} className={`px-5 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base} hover:text-[var(--danger-text)]`}>
                <Trash2 size={12} /> 删除
              </button>
              <button onClick={() => openEditSop(sopDetail)} className={`px-5 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}>
                <Edit2 size={12} /> 编辑
              </button>
              <button
                onClick={() => handleInstantiateSop(sopDetail)}
                disabled={sopBusy}
                className={`px-5 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border disabled:opacity-50 ${BAMBOOK_OS.controls.actionControl.base}`}
              >
                {sopBusy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} strokeWidth={1.2} />}
                实例化入库
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C7 — SOP 新建/编辑 Modal */}
      {sopShowNew && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-[80] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${BAMBOOK_OS.material.glassColor} ${'bg-[var(--bg-card)]'} w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden scale-in-center rounded-card border border-transparent shadow-none backdrop-saturate-[104%]`}>
            <div className={`px-10 py-6 border-b flex items-center justify-between shrink-0 ${'border-[var(--border-c-default)]'}`}>
              <h3 className={`text-lg font-light text-[var(--text-primary)]`}>{sopEditing ? '编辑 SOP 模板' : '新建 SOP 模板'}</h3>
              <button onClick={() => { setSopShowNew(false); setSopEditing(null); }} className={`p-2 rounded-full ${BAMBOOK_OS.controls.actionControl.base}`}><X size={18} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-10 py-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">模板标题 *</label>
                  <input
                    type="text"
                    value={sopDraft.title}
                    onChange={(e) => setSopDraft({ ...sopDraft, title: e.target.value })}
                    placeholder="如：大货跟单标准流程"
                    className={`w-full px-5 py-3 border rounded-control outline-none font-light text-sm transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">分类 *</label>
                  <select
                    value={sopDraft.category}
                    onChange={(e) => setSopDraft({ ...sopDraft, category: e.target.value })}
                    className={`w-full px-5 py-3 border rounded-control outline-none font-light text-sm appearance-none transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                  >
                    {KB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">摘要</label>
                <input
                  type="text"
                  value={sopDraft.summary}
                  onChange={(e) => setSopDraft({ ...sopDraft, summary: e.target.value })}
                  placeholder="一句话说明适用范围与目标"
                  className={`w-full px-5 py-3 border rounded-control outline-none font-light text-sm transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">结构化步骤</label>
                  <button onClick={() => setSopDraft({ ...sopDraft, steps: [...sopDraft.steps, { title: '' }] })} className={`px-3 py-1 rounded-full text-[10px] font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}>
                    + 添加步骤
                  </button>
                </div>
                {sopDraft.steps.length === 0 && (
                  <p className={`text-[11px] font-light ${'text-[var(--text-quaternary)]'}`}>可选。步骤将以编号列表渲染进知识文档。</p>
                )}
                <div className="space-y-2">
                  {sopDraft.steps.map((step, i) => (
                    <div key={i} className={`flex items-start gap-2 rounded-control border p-3 ${'border-[var(--border-c-default)] bg-[var(--recessed-bg)]'}`}>
                      <span className={`shrink-0 pt-2 text-[10px] font-light w-5 text-center ${'text-[var(--text-quaternary)]'}`}>{i + 1}</span>
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={step.title}
                          onChange={(e) => setSopDraft({ ...sopDraft, steps: sopDraft.steps.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)) })}
                          placeholder="步骤标题"
                          className={`w-full px-3 py-2 border rounded-control outline-none font-light text-xs transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                        />
                        <input
                          type="text"
                          value={step.detail || ''}
                          onChange={(e) => setSopDraft({ ...sopDraft, steps: sopDraft.steps.map((s, j) => (j === i ? { ...s, detail: e.target.value } : s)) })}
                          placeholder="步骤细节（可选）"
                          className={`w-full px-3 py-2 border rounded-control outline-none font-light text-xs transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                        />
                      </div>
                      <button onClick={() => setSopDraft({ ...sopDraft, steps: sopDraft.steps.filter((_, j) => j !== i) })} className={`shrink-0 p-1.5 rounded-control transition-all ${'text-[var(--text-quaternary)] hover:text-[var(--danger-text)]'}`}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-light text-[var(--text-quaternary)] tracking-wide ml-1">正文 *</label>
                <textarea
                  rows={6}
                  value={sopDraft.content}
                  onChange={(e) => setSopDraft({ ...sopDraft, content: e.target.value })}
                  placeholder="适用范围、判定标准、责任要点等完整说明"
                  className={`w-full px-5 py-4 border rounded-control outline-none font-light resize-none text-sm leading-relaxed transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
                />
              </div>
            </div>
            <div className={`px-10 py-5 shrink-0 flex justify-end gap-4 bg-[var(--recessed-bg)]`}>
              {sopError && <span className="mr-auto text-[11px] font-light text-[var(--danger-text)]">{sopError}</span>}
              <button
                onClick={handleSaveSop}
                disabled={sopBusy}
                className={`px-8 py-3 text-[11px] font-light tracking-wide rounded-full flex items-center gap-2 border transition-all disabled:opacity-50 ${BAMBOOK_OS.controls.actionControl.base}`}
              >
                {sopBusy ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} strokeWidth={1} />}
                {sopEditing ? '保存修改' : '创建模板'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C7 — SOP 删除确认 */}
      {sopDeleteId && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${BAMBOOK_OS.material.glassColor} ${'bg-[var(--bg-card)] border border-transparent'} rounded-card w-full max-w-md shadow-none overflow-hidden animate-in zoom-in duration-300 backdrop-saturate-[104%]`}>
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border ${'bg-[var(--danger-tint)] text-[var(--danger-text)] border-danger/30'}`}>
                <AlertTriangle size={32} strokeWidth={1} />
              </div>
              <div className="space-y-2">
                <h3 className={`text-lg font-light text-[var(--text-primary)]`}>删除 SOP 模板？</h3>
                <p className="text-sm text-[var(--text-quaternary)] font-light leading-relaxed">模板将被移除（已实例化入库的知识文档不受影响）。</p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                {sopError && <div className="text-xs text-[var(--danger-text)]">{sopError}</div>}
                <button
                  onClick={handleDeleteSop}
                  disabled={sopBusy}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all shadow-none ${sopBusy ? 'opacity-50 cursor-not-allowed ' : ''}bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--active-darken)]`}
                >
                  {sopBusy ? '处理中…' : '确认删除'}
                </button>
                <button onClick={() => setSopDeleteId(null)} className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 知识删除确认 */}
      {deleteConfirmId && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${BAMBOOK_OS.material.glassColor} ${'bg-[var(--bg-card)] border border-transparent'} rounded-card w-full max-w-md shadow-none overflow-hidden animate-in zoom-in duration-300 backdrop-saturate-[104%]`}>
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border ${'bg-[var(--danger-tint)] text-[var(--danger-text)] border-danger/30'}`}>
                <AlertTriangle size={32} strokeWidth={1} />
              </div>
              <div className="space-y-2">
                <h3 className={`text-lg font-light text-[var(--text-primary)]`}>移除业务资产？</h3>
                <p className="text-sm text-[var(--text-quaternary)] font-light leading-relaxed">
                  确定要将此业务资产移入回收站吗？云端副本也将同步标记并从主视图中移除。
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                {knowledgeError && (
                  <div className="text-xs text-[var(--danger-text)]">{knowledgeError}</div>
                )}
                <button
                  onClick={handleDelete}
                  disabled={knowledgeBusy}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all shadow-none ${knowledgeBusy ? 'opacity-50 cursor-not-allowed ' : ''}bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--active-darken)]`}
                >
                  {knowledgeBusy ? '同步中…' : '确认移除'}
                </button>
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all border ${BAMBOOK_OS.controls.actionControl.base}`}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
