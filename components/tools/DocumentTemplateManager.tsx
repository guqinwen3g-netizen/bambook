/**
 * 阶段 P3a — 单据模板管理（PRD 11.3 DocumentTemplate）
 *
 * 单据中心模板编辑范式：
 *   - 左列：单据类型筛选 + 模板列表（名称/语言/默认标记/变量）
 *   - 右列：模板编辑器（类型/名称/语言/HTML 内容/默认标记/备注）
 *   - content 支持 {{variable}} 占位符（如 {{orderNo}}），服务端自动解析变量冗余存储
 *   - 同 type+language 下 isDefault 唯一（服务端事务保证）
 *   - 写操作需 JWT（未登录时明确提示，列表只读降级）
 */

import React, { useEffect, useState } from 'react';
import { Plus, Loader2, FileText, Trash2, Star, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { DocumentTemplate, DocumentTemplateInput, DocumentTemplateType, DocumentTemplateLanguage } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';

interface Props {
  isDarkMode: boolean;
}

const TYPE_LABELS: Record<DocumentTemplateType, string> = {
  Quotation: '报价单',
  SalesConfirmation: '销售确认书',
  ProformaInvoice: '形式发票',
  CommercialInvoice: '商业发票',
  PackingList: '装箱单',
  BillOfLading: '海运提单',
  AirWaybill: '空运单',
  CertificateOfOrigin: '原产地证',
  InsuranceCert: '保险单',
  InspectionCert: '检验证书',
  InspectionReport: '验货报告',
  Statement: '对账单',
  Other: '其他',
};
const TYPES = Object.keys(TYPE_LABELS) as DocumentTemplateType[];

const LANGUAGE_LABELS: Record<DocumentTemplateLanguage, string> = {
  zh: '中文',
  en: '英文',
  bilingual: '中英双语',
};
const LANGUAGES: DocumentTemplateLanguage[] = ['zh', 'en', 'bilingual'];

interface DraftForm {
  id: string | null; // null = 新建
  type: DocumentTemplateType;
  name: string;
  language: DocumentTemplateLanguage;
  content: string;
  isDefault: boolean;
  notes: string;
}

const DocumentTemplateManager: React.FC<Props> = ({ isDarkMode }) => {
  const [typeFilter, setTypeFilter] = useState<DocumentTemplateType | 'all'>('all');
  const [items, setItems] = useState<DocumentTemplate[] | null>(null);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const list = await apiService.listDocumentTemplates({
        type: typeFilter === 'all' ? undefined : typeFilter,
        includeInactive: true,
      });
      setItems(list);
    } catch (e: any) {
      setError(`模板加载失败：${e?.message || e}`);
      setItems([]);
    }
  };

  useEffect(() => {
    setItems(null);
    setError(null);
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  const openCreate = (type: DocumentTemplateType) => {
    setDraft({ id: null, type, name: '', language: 'bilingual', content: '', isDefault: false, notes: '' });
    setError(null);
  };

  const openEdit = (tpl: DocumentTemplate) => {
    setDraft({ id: tpl.id, type: tpl.type, name: tpl.name, language: tpl.language, content: tpl.content, isDefault: tpl.isDefault, notes: tpl.notes || '' });
    setError(null);
  };

  const handleSave = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim() || !draft.content.trim()) {
      setError('模板名称与内容必填');
      return;
    }
    setBusy(true);
    setError(null);
    const input: DocumentTemplateInput = {
      type: draft.type,
      name: draft.name.trim(),
      language: draft.language,
      content: draft.content,
      isDefault: draft.isDefault,
      notes: draft.notes.trim() || undefined,
    };
    try {
      if (draft.id) {
        await apiService.updateDocumentTemplate(draft.id, input);
      } else {
        await apiService.createDocumentTemplate(input);
      }
      setDraft(null);
      await fetchAll();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg.includes('401') || msg.includes('authentication') ? '模板写操作需要登录态（JWT），请先登录系统' : `保存失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.deleteDocumentTemplate(id);
      if (draft?.id === id) setDraft(null);
      await fetchAll();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg.includes('401') || msg.includes('authentication') ? '模板写操作需要登录态（JWT），请先登录系统' : `删除失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const panelClass = isDarkMode
    ? `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurfaceDark}`
    : `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurfaceLight}`;
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm font-light outline-none border transition-colors ${
    isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-500' : 'bg-white/70 border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 左列：类型筛选 + 模板列表 */}
      <div className={`w-80 shrink-0 flex flex-col rounded-card border overflow-hidden ${panelClass}`}>
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-900/[0.055]'}`}>
          <span className={`text-xs font-light uppercase tracking-[0.18em] ${isDarkMode ? 'text-white/60' : 'text-slate-600'}`}>单据模板</span>
          <button
            type="button"
            onClick={() => openCreate(typeFilter === 'all' ? 'CommercialInvoice' : typeFilter)}
            className={`h-7 px-2.5 rounded-control text-[11px] font-light inline-flex items-center gap-1 transition-colors ${isDarkMode ? 'bg-white/[0.06] hover:bg-white/10 text-slate-200' : 'bg-white/70 hover:bg-white text-slate-600'}`}
          >
            <Plus size={12} /> 新建
          </button>
        </div>
        {/* 类型筛选 */}
        <div className={`px-3 py-2 flex flex-wrap gap-1.5 border-b ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-900/[0.055]'}`}>
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-2 py-1 rounded-full text-[11px] font-light transition-colors ${typeFilter === 'all' ? 'bg-[var(--os-vnext-brand-blue)] text-white' : isDarkMode ? 'bg-white/[0.06] text-slate-300 hover:bg-white/10' : 'bg-white/60 text-slate-600 hover:bg-white'}`}
          >
            全部
          </button>
          {TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-full text-[11px] font-light transition-colors ${typeFilter === t ? 'bg-[var(--os-vnext-brand-blue)] text-white' : isDarkMode ? 'bg-white/[0.06] text-slate-300 hover:bg-white/10' : 'bg-white/60 text-slate-600 hover:bg-white'}`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {/* 列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
          {items === null ? (
            <div className="flex items-center gap-2 text-xs font-light text-slate-400 px-2 py-3">
              <Loader2 size={13} className="animate-spin" /> 加载模板...
            </div>
          ) : items.length === 0 ? (
            <div className={`text-xs font-light px-2 py-3 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              暂无模板，点击「新建」创建
            </div>
          ) : (
            items.map(tpl => (
              <div
                key={tpl.id}
                className={`group rounded-inset border px-3 py-2 cursor-pointer transition-colors ${draft?.id === tpl.id
                  ? isDarkMode ? 'border-[var(--os-vnext-brand-blue)]/40 bg-[var(--os-vnext-brand-blue)]/10' : 'border-[var(--os-vnext-brand-blue)]/40 bg-[var(--os-vnext-brand-blue)]/5'
                  : isDarkMode ? 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]' : 'border-slate-200/80 bg-white/50 hover:bg-white/70'}`}
                onClick={() => openEdit(tpl)}
              >
                <div className="flex items-center gap-1.5">
                  <FileText size={12} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} />
                  <span className={`text-xs font-light truncate ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{tpl.name}</span>
                  {tpl.isDefault && <Star size={10} className="shrink-0 text-amber-500" />}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleDelete(tpl.id); }}
                    disabled={busy}
                    className={`ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'text-slate-500 hover:text-red-300' : 'text-slate-400 hover:text-red-500'}`}
                    title="删除模板"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  {TYPE_LABELS[tpl.type]} · {LANGUAGE_LABELS[tpl.language]}
                  {!tpl.isActive && ' · 已停用'}
                  {tpl.variables.length > 0 && ` · ${tpl.variables.length} 个变量`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右列：编辑器 */}
      <div className={`flex-1 min-w-0 flex flex-col rounded-card border overflow-hidden ${panelClass}`}>
        {error && (
          <div className={`mx-4 mt-4 p-3 rounded-inset border flex items-center gap-2 text-xs ${isDarkMode ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-600'}`}>
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {draft === null ? (
          <div className={`flex-1 flex flex-col items-center justify-center gap-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            <FileText size={28} strokeWidth={1} />
            <p className="text-xs font-light">选择左侧模板进行编辑，或点击「新建」创建模板</p>
            <p className="text-[11px] font-light">内容支持 {'{{variable}}'} 占位符，保存时服务端自动解析变量清单</p>
          </div>
        ) : (
          <>
            <div className={`px-5 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-900/[0.055]'}`}>
              <span className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {draft.id ? '编辑模板' : '新建模板'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setDraft(null); setError(null); }}
                  className={`h-8 px-3 rounded-control text-xs font-light transition-colors ${isDarkMode ? 'text-slate-400 hover:bg-white/[0.06] hover:text-white' : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'}`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy}
                  className="h-8 px-4 rounded-control bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  {draft.id ? '保存修改' : '创建模板'}
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-4">
              <div className="flex gap-3">
                <div className="w-44">
                  <label className={labelClass}>单据类型</label>
                  <select
                    value={draft.type}
                    onChange={e => setDraft({ ...draft, type: e.target.value as DocumentTemplateType })}
                    disabled={!!draft.id}
                    className={`${fieldClass} disabled:opacity-50`}
                  >
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={labelClass}>模板名称</label>
                  <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="如：商业发票标准模板-中英" className={fieldClass} />
                </div>
                <div className="w-36">
                  <label className={labelClass}>语言</label>
                  <select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value as DocumentTemplateLanguage })} className={fieldClass}>
                    {LANGUAGES.map(l => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>
                  模板内容（HTML，支持 {'{{variable}}'} 占位符，如 {'{{orderNo}}'} / {'{{customerName}}'}）
                </label>
                <textarea
                  value={draft.content}
                  onChange={e => setDraft({ ...draft, content: e.target.value })}
                  rows={16}
                  placeholder={'<h1>Commercial Invoice</h1>\n<p>Order: {{orderNo}}</p>\n<p>Customer: {{customerName}}</p>'}
                  className={`${fieldClass} resize-none leading-relaxed font-mono text-xs`}
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-light cursor-pointer">
                  <input type="checkbox" checked={draft.isDefault} onChange={e => setDraft({ ...draft, isDefault: e.target.checked })} className="accent-[var(--os-vnext-brand-blue)]" />
                  <span className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>设为该类型+语言默认模板</span>
                </label>
                <input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="备注（可选）" className={`flex-1 ${fieldClass}`} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DocumentTemplateManager;
