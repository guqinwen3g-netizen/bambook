import React, { useState } from 'react';
import { Check, ClipboardList, Send } from 'lucide-react';
import type { AgentFormBlock as AgentFormBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import CustomSelect from '../ui/CustomSelect';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';
import { bdsToast } from '../ui/bdsToast';

// defaultValue 注入初始值；multiselect 以逗号串声明、还原为数组语义
const initialValuesFromFields = (fields: AgentFormBlockModel['fields']): Record<string, string | string[]> => {
  const initial: Record<string, string | string[]> = {};
  for (const field of fields) {
    if (field.defaultValue === undefined) continue;
    initial[field.key] = field.type === 'multiselect'
      ? field.defaultValue.split(',').map(value => value.trim()).filter(Boolean)
      : field.defaultValue;
  }
  return initial;
};

export const AgentFormBlock: React.FC<AgentBlockComponentProps<AgentFormBlockModel>> = ({ block, isDarkMode, onExecuteAction }) => {
  const [values, setValues] = useState<Record<string, string | string[]>>(() => initialValuesFromFields(block.fields));
  // 提交态派生自 block.formStatus（乐观提交与后端回滚都会驱动 block 更新），
  // 不再持有一次性本地 submitted state —— 后端失败回滚后表单自动恢复可编辑。
  const submitted = block.formStatus !== 'pending';

  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';
  const inputClass = 'bg-[var(--recessed-bg)] text-[var(--text-primary)] border-[var(--border-c-default)] placeholder-[var(--text-tertiary)]';

  const isFieldEmpty = (key: string) => {
    const value = values[key];
    return Array.isArray(value) ? value.length === 0 : !value?.trim();
  };

  const handleChange = (key: string, val: string | string[]) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const handleSubmit = () => {
    const missingRequired = block.fields.filter(f => f.required && isFieldEmpty(f.key));
    if (missingRequired.length > 0) {
      bdsToast.warning(`请填写必填项：${missingRequired.map(f => f.label).join('、')}`);
      return;
    }
    if (!onExecuteAction) {
      bdsToast.danger('表单提交通道未就绪，请刷新页面后重试。');
      return;
    }
    // onExecuteAction 内部乐观把 formStatus 切到 submitted 并异步落库；
    // 提交按钮在下一个渲染即被 submitted 态替换，无需本地 submitting 伪态。
    onExecuteAction({
      actionId: block.formId,
      actionType: 'form_submit',
      payload: { formId: block.formId, values },
      risk: 'low',
      label: block.submitLabel || '提交',
    });
  };

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${borderClass}`}>
          <ClipboardList size={16} className="text-[var(--os-vnext-brand-blue-strong)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '请填写信息'}</div>
          {block.description && (
            <div className={`mt-1 text-xs leading-5 text-[var(--text-secondary)]`}>{block.description}</div>
          )}

          {submitted ? (
            <div className={`mt-3 flex items-center gap-1.5 rounded-compact border px-3 py-2 text-xs ${borderClass} ${quietTextClass}`}>
              <Check size={14} strokeWidth={1.5} className="shrink-0" />
              已提交{block.submittedValues ? `：${Object.entries(block.submittedValues).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('、') : String(v)}`).join(', ')}` : ''}
            </div>
          ) : (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                handleSubmit();
              }}
            >
              {block.fields.map((field) => (
                <div key={field.key}>
                  <label className={`block text-xs font-light text-[var(--text-primary)]`}>
                    {field.label}
                    {field.required && <span className="ml-1 text-[var(--text-tertiary)]">*</span>}
                  </label>
                  {field.helpText && (
                    <p className={`mt-0.5 text-[11px] ${quietTextClass}`}>{field.helpText}</p>
                  )}
                  {field.type === 'textarea' ? (
                    <textarea
                      value={typeof values[field.key] === 'string' ? values[field.key] as string : ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      className={`mt-1 w-full rounded-control border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--os-vnext-brand-blue)]/50 ${inputClass}`}
                    />
                  ) : field.type === 'select' || field.type === 'multiselect' ? (
                    field.type === 'select' ? (
                      <CustomSelect
                        value={typeof values[field.key] === 'string' ? values[field.key] as string : ''}
                        onChange={(v) => handleChange(field.key, v)}
                        surface="form"
                        className="mt-1 w-full"
                        options={[
                          { value: '', label: '请选择...' },
                          ...(field.options?.map(opt => ({ value: opt, label: opt })) ?? []),
                        ]}
                      />
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {field.options?.map(opt => {
                          const selected = Array.isArray(values[field.key]) && (values[field.key] as string[]).includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                const current = Array.isArray(values[field.key]) ? [...values[field.key] as string[]] : [];
                                const idx = current.indexOf(opt);
                                if (idx >= 0) current.splice(idx, 1);
                                else current.push(opt);
                                handleChange(field.key, current);
                              }}
                              className={`min-w-0 max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-colors ${borderClass} ${
                                selected
                                  ? 'bg-[var(--os-vnext-brand-blue-soft)] text-[var(--os-vnext-brand-blue-strong)]'
                                  : 'text-[var(--text-secondary)]'
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <input
                      type="text"
                      value={typeof values[field.key] === 'string' ? values[field.key] as string : ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`mt-1 w-full rounded-control border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--os-vnext-brand-blue)]/50 ${inputClass}`}
                    />
                  )}
                </div>
              ))}
              <button
                type="submit"
                disabled={!onExecuteAction}
                className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-light transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 ${borderClass} bg-[var(--os-vnext-brand-blue-soft)] text-[var(--os-vnext-brand-blue-strong)]`}
              >
                <Send size={14} />
                {block.submitLabel || '提交'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
