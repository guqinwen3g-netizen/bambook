/**
 * 阶段 P3b — 邮件签名管理（PRD 12.1 EmailSignature）
 *
 * 统一公司签名格式（联系方式/地址/银行信息）：
 *   - 列表：名称 / 语言 / 默认标记 / 自动解析的变量
 *   - 新建/编辑：content 支持 {{variable}}（如 {{senderName}}），服务端自动解析变量冗余存储
 *   - 同语言下 isDefault 唯一（服务端事务保证）
 *   - 写操作需 JWT（未登录时给出明确提示，降级为只读列表）
 */

import React, { useEffect, useState } from 'react';
import { X, Plus, Loader2, PenLine, Trash2, Star, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { EmailSignature, EmailSignatureInput, SignatureLanguage } from '../../types';
import { RdlSurface, RdlPill } from '../ui/RDLPrimitives';
import { ErrorBanner } from '../ui/primitives/layoutPrimitives';
import { bdsConfirm } from '../ui/BdsDialog';
import CustomSelect from '../ui/CustomSelect';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

const LANGUAGE_LABELS: Record<SignatureLanguage, string> = {
  zh: '中文',
  en: '英文',
  bilingual: '中英双语',
};
const LANGUAGES: SignatureLanguage[] = ['zh', 'en', 'bilingual'];

interface DraftForm {
  id: string | null; // null = 新建
  name: string;
  language: SignatureLanguage;
  content: string;
  isDefault: boolean;
  notes: string;
}

const emptyDraft = (): DraftForm => ({ id: null, name: '', language: 'bilingual', content: '', isDefault: false, notes: '' });

const SignatureManager: React.FC<Props> = ({ isOpen, onClose, isDarkMode }) => {
  const [items, setItems] = useState<EmailSignature[] | null>(null);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const list = await apiService.listEmailSignatures({ includeInactive: true });
      setItems(list);
    } catch (e: any) {
      setError(`签名加载失败：${e?.message || e}`);
      setItems([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setItems(null);
    setDraft(null);
    setError(null);
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim() || !draft.content.trim()) {
      setError('签名名称与内容必填');
      return;
    }
    setBusy(true);
    setError(null);
    const input: EmailSignatureInput = {
      name: draft.name.trim(),
      language: draft.language,
      content: draft.content,
      isDefault: draft.isDefault,
      notes: draft.notes.trim() || undefined,
    };
    try {
      if (draft.id) {
        await apiService.updateEmailSignature(draft.id, input);
      } else {
        await apiService.createEmailSignature(input);
      }
      setDraft(null);
      await fetchAll();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg.includes('401') || msg.includes('authentication') ? '签名写操作需要登录态（JWT），请先登录系统' : `保存失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    const target = items?.find(s => s.id === id);
    if (!(await bdsConfirm({
      title: '删除签名',
      body: `确认删除签名「${target?.name || id}」？该操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    }))) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.deleteEmailSignature(id);
      await fetchAll();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg.includes('401') || msg.includes('authentication') ? '签名写操作需要登录态（JWT），请先登录系统' : `删除失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const fieldClass = `w-full px-3 py-2 rounded-control text-sm font-light outline-none border transition-colors bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]`;

  return (
    <div className="absolute inset-0 bg-[var(--mask-bg)] backdrop-blur-sm z-[90] flex items-center justify-center p-6 animate-in fade-in duration-300">
      <RdlSurface tone="panel" className="w-full max-w-2xl overflow-hidden flex flex-col h-[70vh] animate-in zoom-in duration-300">
        {/* 头部 */}
        <div className="bds-pagehead shrink-0 backdrop-blur-md bg-[var(--recessed-bg)]">
          <div className="ph-main">
            <h3 className="ph-title flex items-center gap-3 text-[var(--text-primary)]">
              <RdlSurface tone="inset" className="w-10 h-10 flex items-center justify-center text-[var(--os-vnext-brand-blue-strong)]">
                <PenLine size={18} strokeWidth={1.75} />
              </RdlSurface>
              邮件签名管理
              <span className="en">Signature Manager</span>
            </h3>
          </div>
          <div className="ph-side">
            {draft === null && (
              <RdlPill onClick={() => { setDraft(emptyDraft()); setError(null); }} className="min-h-8 px-3 text-xs">
                <Plus size={14} strokeWidth={1.75} className="text-[var(--accent-text)]" /> 新建签名
              </RdlPill>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="bds-btn bds-btn-ghost bds-btn-icon"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-5 space-y-3">
          {error && (
            <ErrorBanner icon={<AlertCircle size={14} strokeWidth={1.75} />}>{error}</ErrorBanner>
          )}

          {draft !== null ? (
            /* 新建/编辑表单 */
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={`block text-xs mb-1 text-[var(--text-tertiary)]`}>签名名称</label>
                  <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="如：默认英文签名" className={fieldClass} />
                </div>
                <div className="w-36">
                  <label className={`block text-xs mb-1 text-[var(--text-tertiary)]`}>语言</label>
                  <CustomSelect
                    surface="form"
                    value={draft.language}
                    onChange={v => setDraft({ ...draft, language: v as SignatureLanguage })}
                    options={LANGUAGES.map(l => ({ value: l, label: LANGUAGE_LABELS[l] }))}
                  />
                </div>
              </div>
              <div>
                <label className={`block text-xs mb-1 text-[var(--text-tertiary)]`}>
                  签名内容（支持 {'{{variable}}'} 占位符，如 {'{{senderName}}'}）
                </label>
                <textarea
                  value={draft.content}
                  onChange={e => setDraft({ ...draft, content: e.target.value })}
                  rows={8}
                  placeholder={'Best regards,\n{{senderName}}\nBambook Textile Co., Ltd.'}
                  className={`${fieldClass} resize-none leading-relaxed`}
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-light cursor-pointer">
                  <input type="checkbox" checked={draft.isDefault} onChange={e => setDraft({ ...draft, isDefault: e.target.checked })} className="accent-[var(--os-vnext-brand-blue)]" />
                  <span className="text-[var(--text-secondary)]">设为该语言默认签名</span>
                </label>
                <input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="备注（可选）" className={`flex-1 ${fieldClass}`} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <RdlPill onClick={() => { setDraft(null); setError(null); }} className="text-xs">取消</RdlPill>
                <RdlPill tone="accent" active onClick={handleSave} disabled={busy} className={`text-xs ${busy ? 'opacity-45 cursor-not-allowed' : ''}`}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  {draft.id ? '保存修改' : '创建签名'}
                </RdlPill>
              </div>
            </div>
          ) : items === null ? (
            <div className="flex items-center gap-2 text-xs font-light text-[var(--text-tertiary)] py-4">
              <Loader2 size={14} className="animate-spin" /> 加载签名列表...
            </div>
          ) : items.length === 0 ? (
            <div className={`text-xs font-light py-4 text-[var(--text-tertiary)]`}>
              暂无签名，点击右上角「新建签名」创建统一公司签名格式
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map(sig => (
                <li
                  key={sig.id}
                  className="rounded-inset border px-4 py-3 flex items-center gap-3 border-[var(--border-c-subtle)] bg-[var(--recessed-bg)]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-light truncate text-[var(--text-primary)]">{sig.name}</span>
                      {sig.isDefault && (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-bds-sm text-[10px] bg-[var(--warning-tint)] text-[var(--warning-text)]`}>
                          <Star size={14} /> 默认
                        </span>
                      )}
                      {!sig.isActive && (
                        <span className={`text-[10px] text-[var(--text-tertiary)]`}>已停用</span>
                      )}
                    </div>
                    <div className={`text-[11px] mt-0.5 text-[var(--text-tertiary)]`}>
                      {LANGUAGE_LABELS[sig.language] ?? sig.language}
                      {sig.variables.length > 0 && ` · 变量: ${sig.variables.map(v => `{{${v}}}`).join(' ')}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setDraft({ id: sig.id, name: sig.name, language: sig.language, content: sig.content, isDefault: sig.isDefault, notes: sig.notes || '' }); setError(null); }}
                    className="shrink-0 h-7 px-2.5 rounded-control text-[11px] font-light transition-colors bg-[var(--recessed-bg)] hover:bg-[var(--active-darken)] text-[var(--text-secondary)]"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(sig.id)}
                    disabled={busy}
                    className={`shrink-0 h-7 w-7 rounded-control flex items-center justify-center transition-colors disabled:opacity-40 text-[var(--text-tertiary)] hover:bg-[var(--danger-tint)] hover:text-danger`}
                    title="删除签名"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </RdlSurface>
    </div>
  );
};

export default SignatureManager;
