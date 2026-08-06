import React, { useState } from 'react';
import { Check, ClipboardList, Send } from 'lucide-react';
import type { AgentFormBlock as AgentFormBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

export const AgentFormBlock: React.FC<AgentBlockComponentProps<AgentFormBlockModel>> = ({ block, isDarkMode, onExecuteAction }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(block.formStatus !== 'pending');

  const labelTextClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const borderClass = isDarkMode ? 'border-white/[0.08]' : 'border-slate-200/70';
  const inputClass = isDarkMode
    ? 'bg-white/[0.04] text-white/90 placeholder-white/30 border-white/[0.08]'
    : 'bg-slate-50 text-slate-800 placeholder-slate-400 border-slate-200/70';

  const handleChange = (key: string, val: string) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async () => {
    const missingRequired = block.fields.filter(f => f.required && !values[f.key]?.trim());
    if (missingRequired.length > 0) {
      alert(`请填写必填项：${missingRequired.map(f => f.label).join('、')}`);
      return;
    }
    if (!onExecuteAction) {
      alert('表单提交通道未就绪，请刷新页面后重试。');
      return;
    }
    setSubmitting(true);
    try {
      onExecuteAction({
        actionId: block.formId,
        actionType: 'form_submit',
        payload: { formId: block.formId, values },
        risk: 'low',
        label: block.submitLabel || '提交',
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${borderClass}`}>
          <ClipboardList size={16} className={isDarkMode ? 'text-[var(--os-vnext-brand-blue-soft)]' : 'text-[var(--os-vnext-brand-blue-strong)]'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '请填写信息'}</div>
          {block.description && (
            <div className={`mt-1 text-xs leading-5 ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>{block.description}</div>
          )}

          {submitted ? (
            <div className={`mt-3 flex items-center gap-1.5 rounded-compact border px-3 py-2 text-xs ${borderClass} ${quietTextClass}`}>
              <Check size={12} strokeWidth={1.5} className="shrink-0" />
              已提交{block.submittedValues ? `：${Object.entries(block.submittedValues).map(([k, v]) => `${k}=${String(v)}`).join(', ')}` : ''}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {block.fields.map((field) => (
                <div key={field.key}>
                  <label className={`block text-xs font-light ${isDarkMode ? 'text-white/80' : 'text-slate-700'}`}>
                    {field.label}
                    {field.required && <span className="ml-1 text-slate-500">*</span>}
                  </label>
                  {field.helpText && (
                    <p className={`mt-0.5 text-[11px] ${quietTextClass}`}>{field.helpText}</p>
                  )}
                  {field.type === 'textarea' ? (
                    <textarea
                      value={values[field.key] ?? ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      className={`mt-1 w-full rounded-control border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--os-vnext-brand-blue)]/50 ${inputClass}`}
                    />
                  ) : field.type === 'select' || field.type === 'multiselect' ? (
                    field.type === 'select' ? (
                      <select
                        value={values[field.key] ?? ''}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        className={`mt-1 w-full rounded-control border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--os-vnext-brand-blue)]/50 ${inputClass}`}
                      >
                        <option value="">请选择...</option>
                        {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {field.options?.map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              const current = (values[field.key] || '').split(',').filter(Boolean);
                              const idx = current.indexOf(opt);
                              if (idx >= 0) current.splice(idx, 1);
                              else current.push(opt);
                              handleChange(field.key, current.join(','));
                            }}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${borderClass} ${
                              (values[field.key] || '').includes(opt)
                                ? (isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/20 text-[var(--os-vnext-brand-blue-soft)]' : 'bg-[var(--os-vnext-brand-blue-soft)] text-[var(--os-vnext-brand-blue-strong)]')
                                : (isDarkMode ? 'text-white/60' : 'text-slate-600')
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <input
                      type="text"
                      value={values[field.key] ?? ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`mt-1 w-full rounded-control border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--os-vnext-brand-blue)]/50 ${inputClass}`}
                    />
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !onExecuteAction}
                className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-light transition-opacity ${
                  submitting ? 'cursor-wait opacity-60' : 'hover:opacity-80'
                } ${borderClass} ${isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/15 text-[var(--os-vnext-brand-blue-soft)]' : 'bg-[var(--os-vnext-brand-blue-soft)] text-[var(--os-vnext-brand-blue-strong)]'}`}
              >
                <Send size={13} />
                {submitting ? '提交中...' : (block.submitLabel || '提交')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
