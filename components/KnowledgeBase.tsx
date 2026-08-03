
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { KnowledgeItem, Insight } from '../types';
import {
  Plus, Search, Trash2, X, Database, Edit2, Save,
  AlertTriangle
} from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import { apiService } from '../services/apiService';

const KB_CATEGORIES = ['Product', 'Policy', 'Customer', 'Production', 'Company', 'Supplier'] as const;
type KbCategory = KnowledgeItem['category'];
const toKbCategory = (value: string | null | undefined): KbCategory =>
  (KB_CATEGORIES as readonly string[]).includes(value || '') ? (value as KbCategory) : 'Product';

interface KBProps {
  knowledge: KnowledgeItem[];
  setKnowledge: (k: KnowledgeItem[], addedOrModified?: KnowledgeItem) => void;
  insights: Insight[];
  setInsights: (i: Insight[]) => void;
  isDarkMode?: boolean;
}

const KnowledgeBase: React.FC<KBProps> = ({ knowledge, setKnowledge, insights, setInsights, isDarkMode = false }) => {
  const [activeTab, setActiveTab] = useState<'official' | 'memory'>('official');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [newItem, setNewItem] = useState({ title: '', content: '', category: 'Product' as any });
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  const filteredOfficial = knowledge.filter(k =>
    !k.deletedAt && (
      k.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      k.content.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

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
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${isDarkMode ? 'text-slate-500 group-focus-within:text-slate-300' : 'text-slate-400 group-focus-within:text-blue-500'}`} size={14} />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索资产..."
                className={`pl-9 pr-4 py-2 border rounded-xl outline-none font-normal text-xs transition-all w-64 shadow-sm ${isDarkMode ? 'bg-deep/60 border-white/10 text-white placeholder-slate-500 focus:ring-2 focus:ring-white/10' : 'bg-white/30 border-white/30 focus:ring-2 focus:ring-blue-500/20'}`}
              />
            </div>
            <button onClick={() => setShowAddModal(true)} className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all text-[11px] font-light tracking-wide ${isDarkMode ? 'bg-deep/80 text-white/80 border border-white/10 hover:bg-deep' : 'bg-white/70 border border-slate-200/60 text-slate-600 hover:bg-white/90'}`}>
              <Plus size={14} strokeWidth={1} /> 新增资产
            </button>
          </div>
        )}
      />

      <div className={`${BAMBOOK_OS.layout.desktopSinglePanelBodyClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`}>
      {/* Tab Bar - Fixed Height */}
      <div className={`${BAMBOOK_OS.layout.desktopSubtoolbarClass} justify-center bg-transparent`}>
        <div className={`inline-flex p-1 rounded-full ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}>
          <button onClick={() => setActiveTab('official')} className={`px-6 py-1.5 rounded-compact text-[11px] font-light tracking-wide transition-all ${activeTab === 'official' ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light) : (isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700')}`}>官方知识库 ({filteredOfficial.length})</button>
          <button onClick={() => setActiveTab('memory')} className={`px-6 py-1.5 rounded-compact text-[11px] font-light tracking-wide transition-all ${activeTab === 'memory' ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light) : (isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700')}`}>智脑神经记忆 ({insights.length})</button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {activeTab === 'official' ? (
          <motion.div layout className="grid grid-cols-[repeat(auto-fill,340px)] gap-6 md:gap-8 justify-center content-start">
            {filteredOfficial.map(item => (
              <motion.div layout key={item.id} data-os-adaptive-container="1" className={`shrink-0 w-[340px] p-6 flex flex-col group relative overflow-hidden ${BAMBOOK_OS.material.cardLight} transition-all duration-300 ${isDarkMode ? 'bg-deep/48' : 'bg-white/46 hover:bg-white/56'}`}>
                <div className="absolute top-5 right-5 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => setEditingItem(item)} className={`p-2.5 border rounded-xl transition-all ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}>
                    <Edit2 size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(item.id); }} className={`p-2.5 border rounded-xl transition-all ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light} hover:text-red-500`}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mb-4">
                  <span className={`px-2.5 py-1 text-[9px] font-light tracking-wide rounded-xl border ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}>
                    {item.category}
                  </span>
                </div>
                <h4 data-ui-lab-wallpaper-contrast="primary" className={`text-base font-light mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.title}</h4>
                <p data-ui-lab-wallpaper-contrast="secondary" className={`text-[13px] line-clamp-4 font-light leading-relaxed flex-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{item.content}</p>
                <div className={`mt-6 pt-4 border-t flex items-center justify-between ${isDarkMode ? 'border-white/10' : 'border-white/30'}`}>
                  <span className={`text-[10px] font-light tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(item.updatedAt).toLocaleDateString()}</span>
                  <Database size={14} strokeWidth={1} className={isDarkMode ? 'text-slate-600' : 'text-slate-300'} />
                </div>
              </motion.div>
            ))}
            {filteredOfficial.length === 0 && (
              <div className={`w-full py-20 flex flex-col items-center justify-center ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`}>
                <Database size={60} strokeWidth={1} className="opacity-10 mb-4" />
                <p className="text-xs font-light tracking-wide">暂无检索匹配的资产档案</p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div layout className="grid grid-cols-[repeat(auto-fill,340px)] gap-6 md:gap-8 justify-center content-start">
            {insights.map(insight => (
              <motion.div layout key={insight.id} className={`shrink-0 w-[340px] p-6 flex flex-col ${BAMBOOK_OS.material.cardLight} transition-all duration-300 ${isDarkMode ? 'bg-deep/48' : 'bg-white/46 hover:bg-white/56'}`}>
                <div className="flex-1">
                  <p className={`text-[14px] font-light leading-relaxed italic ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>"{insight.fact}"</p>
                </div>
                <div className={`mt-6 pt-4 border-t flex items-center justify-between ${isDarkMode ? 'border-white/10' : 'border-white/30'}`}>
                  <span className={`text-[9px] font-light tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-blue-500'}`}>{insight.importance} PRIORITY</span>
                  <button onClick={() => handleSolidifyMemory(insight)} className={`px-4 py-2 rounded-xl text-[10px] font-light transition-all border ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}>
                    固化入库
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
      </div>

      {/* 新增/编辑 Modal */}
      {(showAddModal || editingItem) && (
        <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-sm z-[70] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${BAMBOOK_OS.material.glassColor} ${isDarkMode ? 'bg-deep/72' : 'bg-white/64'} w-full max-w-xl overflow-hidden scale-in-center rounded-card border border-transparent shadow-none backdrop-saturate-[104%]`}>
            <div className={`px-12 py-8 border-b flex items-center justify-between ${isDarkMode ? 'border-white/[0.055]' : 'border-white/35'}`}>
              <h3 className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{editingItem ? '修正资产档案' : '录入新资产'}</h3>
              <button onClick={() => { setShowAddModal(false); setEditingItem(null); }} className={`p-2 rounded-full ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}><X size={18} /></button>
            </div>
            <div className="p-12 space-y-8">
              <div className="space-y-4">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">资产标题</label>
                <input
                  type="text"
                  value={editingItem ? editingItem.title : newItem.title}
                  onChange={(e) => editingItem ? setEditingItem({ ...editingItem, title: e.target.value }) : setNewItem({ ...newItem, title: e.target.value })}
                  className={`w-full px-7 py-5 border rounded-full outline-none font-light transition-all ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
                  placeholder="如：Panda AW25 辅料质检协议"
                />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">资产类型</label>
                <select
                  value={editingItem ? editingItem.category : newItem.category}
                  onChange={(e) => editingItem ? setEditingItem({ ...editingItem, category: e.target.value as any }) : setNewItem({ ...newItem, category: e.target.value as any })}
                  className={`w-full px-7 py-5 border rounded-full outline-none font-light text-sm transition-all appearance-none ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
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
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">核心摘要</label>
                <textarea
                  rows={5}
                  value={editingItem ? editingItem.content : newItem.content}
                  onChange={(e) => editingItem ? setEditingItem({ ...editingItem, content: e.target.value }) : setNewItem({ ...newItem, content: e.target.value })}
                  className={`w-full px-7 py-5 border rounded-full outline-none font-light resize-none leading-relaxed transition-all ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
                  placeholder="请输入核心知识点内容..."
                />
              </div>
            </div>
            <div className={`px-12 py-10 flex justify-end gap-6 ${isDarkMode ? 'bg-white/[0.025]' : 'bg-white/24'}`}>
              {knowledgeError && (
                <div className="mr-auto text-xs text-red-500">{knowledgeError}</div>
              )}
              <button
                onClick={editingItem ? handleEditSave : handleAdd}
                disabled={knowledgeBusy}
                data-knowledge-busy={knowledgeBusy}
                className={`px-10 py-4 text-[11px] font-light tracking-wide rounded-full flex items-center gap-3 border transition-all ${knowledgeBusy ? 'opacity-50 cursor-not-allowed' : isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}
              >
                <Save size={16} strokeWidth={1} /> {knowledgeBusy ? '同步中…' : editingItem ? '固化修正' : '确认存入并即时同步'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmId && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${BAMBOOK_OS.material.glassColor} ${isDarkMode ? 'bg-deep/72 border border-transparent' : 'bg-white/64 border border-transparent'} rounded-card w-full max-w-md shadow-none overflow-hidden animate-in zoom-in duration-300 backdrop-saturate-[104%]`}>
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border ${isDarkMode ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-red-50 text-red-500 border-red-100'}`}>
                <AlertTriangle size={32} strokeWidth={1} />
              </div>
              <div className="space-y-2">
                <h3 className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>移除业务资产？</h3>
                <p className="text-sm text-slate-400 font-light leading-relaxed">
                  确定要将此业务资产移入回收站吗？云端副本也将同步标记并从主视图中移除。
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                {knowledgeError && (
                  <div className="text-xs text-red-500">{knowledgeError}</div>
                )}
                <button
                  onClick={handleDelete}
                  disabled={knowledgeBusy}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all shadow-none ${knowledgeBusy ? 'opacity-50 cursor-not-allowed ' : ''}${isDarkMode ? 'bg-slate-500 text-white hover:bg-slate-600' : 'bg-slate-500 text-white hover:bg-slate-600'}`}
                >
                  {knowledgeBusy ? '同步中…' : '确认移除'}
                </button>
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all border ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}
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
