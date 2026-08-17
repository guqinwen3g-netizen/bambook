import React from 'react';
import { Archive, Loader2, Send, Sparkles } from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import { apiService } from '../services/apiService';
import { KnowledgeCitation } from '../types';

/** 问答归档分类（与策略文库 KnowledgeItem.category 同一枚举语义） */
const QA_ARCHIVE_CATEGORIES = ['Company', 'Policy', 'Production', 'Product', 'Customer', 'Supplier'] as const;

/** 数据看板快捷提问：面向纺织外贸主业务的示例问题，点击填入提问框 */
const QA_SUGGESTED_QUESTIONS = [
  '面料尾期验货的抽样标准是什么？',
  '产前样需要哪两方签字确认？',
  'T/T 30 天付款条款在合同里怎么表述？',
] as const;

type DataCenterProps = {
  isDarkMode?: boolean;
  dataCenterEndpoint?: string;
};

const DataCenter: React.FC<DataCenterProps> = ({ isDarkMode = false }) => {
  // RAG 智能问答状态（与策略文库 QA 同一 knowledge_api 契约）
  const [qaQuestion, setQaQuestion] = React.useState('');
  const [qaAnswer, setQaAnswer] = React.useState('');
  const [qaCitations, setQaCitations] = React.useState<KnowledgeCitation[]>([]);
  const [qaBusy, setQaBusy] = React.useState(false);
  const [qaError, setQaError] = React.useState<string | null>(null);
  const [qaArchiveCategory, setQaArchiveCategory] = React.useState<string>('Company');
  const [qaArchived, setQaArchived] = React.useState(false);
  const [qaArchiving, setQaArchiving] = React.useState(false);

  /** RAG 智能问答：引用检索与流式回答并行 */
  const handleAsk = React.useCallback(async () => {
    const q = qaQuestion.trim();
    if (!q || qaBusy) return;
    setQaBusy(true);
    setQaError(null);
    setQaAnswer('');
    setQaCitations([]);
    setQaArchived(false);
    try {
      const searchPromise = apiService.searchKnowledgeBase(q).then(setQaCitations).catch(() => setQaCitations([]));
      await apiService.askKnowledgeBase(q, (piece) => setQaAnswer((prev) => prev + piece));
      await searchPromise;
    } catch (error: any) {
      setQaError(error?.message || '问答服务暂不可用，请稍后重试');
    } finally {
      setQaBusy(false);
    }
  }, [qaBusy, qaQuestion]);

  /** 问答归档：沉淀为知识文档进入检索语料，反哺后续问答 */
  const handleArchiveQa = React.useCallback(async () => {
    const q = qaQuestion.trim();
    const a = qaAnswer.trim();
    if (!q || !a || qaArchiving || qaArchived) return;
    setQaArchiving(true);
    setQaError(null);
    try {
      const title = `问答：${q.slice(0, 40)}${q.length > 40 ? '…' : ''}`;
      await apiService.ingestKnowledgeText({ title, text: `问题：${q}\n\n回答：${a}`, category: qaArchiveCategory, sourceType: 'qa' });
      setQaArchived(true);
    } catch (error: any) {
      setQaError(error?.message || '归档失败，请稍后重试');
    } finally {
      setQaArchiving(false);
    }
  }, [qaAnswer, qaArchived, qaArchiving, qaArchiveCategory, qaQuestion]);

  return (
    <div className={`w-full h-full flex flex-col bg-transparent overflow-hidden text-[var(--text-primary)]`}>
      <PageHeader
        title="数据中心"
        subtitle="Data Center"
        contextLabel="Data Hub"
        isDarkMode={isDarkMode}
      />

      <div className={`${BAMBOOK_OS.layout.desktopSinglePanelBodyClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`}>
        <div className="flex-1 min-h-0 overflow-y-auto py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {/* 看板简介 */}
            <div className="flex items-start gap-3 px-1">
              <Sparkles size={18} strokeWidth={1.2} className={`mt-0.5 shrink-0 text-[var(--text-tertiary)]`} />
              <div className="min-w-0">
                <h2 className={`text-base font-light text-[var(--text-primary)]`}>企业知识智能问答</h2>
                <p className={`mt-1 text-[11px] font-light leading-relaxed text-[var(--text-tertiary)]`}>
                  向量检索企业知识语料（邮件 / 文档 / SOP / 历史问答），LLM 流式生成回答并列出命中片段；有价值的一键归档回知识库。
                </p>
              </div>
            </div>

            {/* 提问区 */}
            <div className={`p-6 ${BAMBOOK_OS.material.card} bg-[var(--recessed-bg)]`}>
              <textarea
                rows={3}
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                placeholder="向企业知识库提问，如：面料尾期验货的抽样标准是什么？"
                className={`w-full px-5 py-4 border rounded-control outline-none font-light resize-none text-sm leading-relaxed transition-all ${BAMBOOK_OS.controls.recessedField.base}`}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {QA_SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQaQuestion(q)}
                    className={`px-3 py-1.5 rounded-full border text-[10px] font-light tracking-wide transition-all border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className={`text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>向量检索知识语料 + LLM 流式回答，命中片段在下方列出</span>
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
              <div className={`px-5 py-3 rounded-control border text-xs font-light border-danger/30 bg-[var(--danger-tint)] text-[var(--danger-text)]`}>{qaError}</div>
            )}

            {/* 回答区 */}
            {(qaAnswer || qaBusy) && (
              <div className={`p-6 ${BAMBOOK_OS.material.card} bg-[var(--recessed-bg)]`}>
                <div className={`mb-3 text-[10px] font-light tracking-[0.18em] text-[var(--text-tertiary)]`}>回答</div>
                <p className={`whitespace-pre-wrap text-[13px] font-light leading-relaxed text-[var(--text-secondary)]`}>
                  {qaAnswer}
                  {qaBusy && <span className="inline-block w-2 h-4 ml-0.5 align-middle animate-pulse bg-current opacity-40" />}
                </p>
                {!qaBusy && qaAnswer.trim() && (
                  <div className={`mt-5 pt-4 border-t flex items-center justify-end gap-3 border-[var(--border-c-default)]`}>
                    {qaArchived ? (
                      <span className={`text-[11px] font-light text-[var(--success-text)]`}>已归档到企业知识库</span>
                    ) : (
                      <>
                        <select
                          value={qaArchiveCategory}
                          onChange={(e) => setQaArchiveCategory(e.target.value)}
                          className={`px-3 py-2 border rounded-control outline-none text-[11px] font-light appearance-none ${BAMBOOK_OS.controls.recessedField.base}`}
                        >
                          {QA_ARCHIVE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
              <div className={`p-6 ${BAMBOOK_OS.material.card} bg-[var(--recessed-bg)]`}>
                <div className={`mb-3 text-[10px] font-light tracking-[0.18em] text-[var(--text-tertiary)]`}>命中片段 ({qaCitations.length})</div>
                <div className="space-y-3">
                  {qaCitations.map((c) => (
                    <div key={c.id} className={`rounded-control border px-4 py-3 border-[var(--border-c-subtle)] bg-[var(--recessed-bg)]`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-[11px] font-light truncate text-[var(--text-secondary)]`}>{c.title}</span>
                        <span className={`shrink-0 text-[9px] font-light tracking-wide text-[var(--text-tertiary)]`}>{Math.round(c.score * 100)}%</span>
                      </div>
                      <p className={`mt-1 line-clamp-2 text-[11px] font-light leading-relaxed text-[var(--text-tertiary)]`}>{c.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataCenter;
