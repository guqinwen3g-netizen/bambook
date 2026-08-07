/**
 * SampleNodesPanel — 三级样衣节点面板（Phase B4）
 *
 * 每个开发单固定三级：确认样 → 产前样 → 大货样。
 * 状态机：pending → making → sent → approved / revising（revising 可 start 进入下一轮，round+1）。
 *
 * 设计：flat 无阴影、RDL/compiled 风格、按当前状态渲染下一动作按钮。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PackageCheck, RotateCcw, Send, Scissors } from 'lucide-react';
import { developmentService } from '../../services/developmentService';
import type { SampleNode, SampleNodeLevel, SampleNodeStatus } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const LEVELS: Array<{ id: SampleNodeLevel; label: string; en: string }> = [
  { id: 'confirmation', label: '确认样', en: 'Approval' },
  { id: 'pp', label: '产前样', en: 'PP Sample' },
  { id: 'top', label: '大货样', en: 'TOP' },
];

const STATUS_LABEL: Record<SampleNodeStatus, string> = {
  pending: '待打样',
  making: '制作中',
  sent: '已寄出',
  approved: '已批准',
  revising: '需修改',
};

interface SampleNodesPanelProps {
  caseId: string;
  isDarkMode: boolean;
}

export function SampleNodesPanel({ caseId, isDarkMode }: SampleNodesPanelProps) {
  const [nodes, setNodes] = useState<SampleNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textPrimary = isDarkMode ? 'text-white/86' : 'text-slate-950';
  const textSecondary = isDarkMode ? 'text-white/52' : 'text-slate-500';
  const textFaint = isDarkMode ? 'text-white/35' : 'text-slate-400';
  const cardCls = isDarkMode
    ? 'border-white/[0.06] bg-white/[0.028]'
    : 'border-slate-300/28 bg-white/38';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNodes(await developmentService.listSampleNodes(caseId));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (node: SampleNode, action: 'start' | 'send' | 'approve' | 'revise') => {
    const key = `${node.level}:${action}`;
    if (acting) return;
    setActing(key);
    setError(null);
    try {
      let payload: any = { action };
      if (action === 'send') {
        const trackingNumber = window.prompt('快递单号（可留空）', node.trackingNumber || '') ?? undefined;
        if (trackingNumber === undefined) { setActing(null); return; }
        const courier = trackingNumber.trim() ? (window.prompt('快递公司（可留空）', node.courier || '') ?? '') : '';
        payload = { action, trackingNumber: trackingNumber.trim() || undefined, courier: courier.trim() || undefined };
      }
      if (action === 'revise') {
        const feedback = window.prompt('客户修改意见', node.feedback || '');
        if (feedback === null) { setActing(null); return; }
        payload = { action, feedback: feedback.trim() || undefined };
      }
      if (action === 'approve') {
        const feedback = window.prompt('批准意见（可留空）', '') ?? '';
        payload = { action, feedback: feedback.trim() || undefined };
      }
      const updated = await developmentService.advanceSampleNode(caseId, node.level, payload);
      setNodes(prev => prev.map(n => (n.id === updated.id ? updated : n)));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setActing(null);
    }
  }, [acting, caseId]);

  if (loading) {
    return (
      <div className={cx('flex items-center gap-2 py-4 text-[11px] font-light', textFaint)}>
        <Loader2 size={13} strokeWidth={1.4} className="animate-spin" /> 加载样衣节点…
      </div>
    );
  }

  const actionBtnCls = isDarkMode
    ? 'border-white/10 text-white/64 hover:bg-white/8 hover:text-white/88'
    : 'border-slate-300/40 text-slate-500 hover:bg-white/60 hover:text-slate-800';

  return (
    <div>
      <div className={cx('mb-2 text-[10px] font-light tracking-[0.18em]', textSecondary)}>三级样衣节点</div>
      {error && <div className="mb-2 text-[11px] font-light text-red-400">{error}</div>}
      <div className="space-y-2">
        {LEVELS.map(({ id, label, en }) => {
          const node = nodes.find(n => n.level === id);
          if (!node) return null;
          const approved = node.status === 'approved';
          return (
            <div key={id} className={cx('rounded-inset border px-3 py-2.5', cardCls)}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={cx('truncate text-xs font-light', textPrimary)}>
                    {label} <span className={cx('text-[10px]', textFaint)}>{en}{node.round > 1 ? ` · R${node.round}` : ''}</span>
                  </div>
                  <div className={cx('mt-0.5 text-[10px] font-light', approved ? 'text-emerald-400' : textSecondary)}>
                    {STATUS_LABEL[node.status]}
                    {node.sentDate ? ` · 寄出 ${node.sentDate}` : ''}
                    {node.trackingNumber ? ` · ${node.trackingNumber}` : ''}
                  </div>
                  {node.feedback && (
                    <div className={cx('mt-1 truncate text-[10px] font-light', textFaint)} title={node.feedback}>
                      反馈：{node.feedback}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {node.status === 'pending' && (
                    <button type="button" disabled={!!acting} onClick={() => act(node, 'start')}
                      className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                      <Scissors size={10} strokeWidth={1.4} /> 开始打样
                    </button>
                  )}
                  {node.status === 'revising' && (
                    <button type="button" disabled={!!acting} onClick={() => act(node, 'start')}
                      className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                      <RotateCcw size={10} strokeWidth={1.4} /> 重新打样
                    </button>
                  )}
                  {node.status === 'making' && (
                    <>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'send')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                        <Send size={10} strokeWidth={1.4} /> 寄出
                      </button>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'revise')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                        <RotateCcw size={10} strokeWidth={1.4} /> 需修改
                      </button>
                    </>
                  )}
                  {node.status === 'sent' && (
                    <>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'approve')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors',
                          isDarkMode
                            ? 'border-emerald-400/25 text-emerald-300/80 hover:bg-emerald-400/10'
                            : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10')}>
                        <CheckCircle2 size={10} strokeWidth={1.4} /> 批准
                      </button>
                      <button type="button" disabled={!!acting} onClick={() => act(node, 'revise')}
                        className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light transition-colors', actionBtnCls)}>
                        <RotateCcw size={10} strokeWidth={1.4} /> 需修改
                      </button>
                    </>
                  )}
                  {approved && <PackageCheck size={13} strokeWidth={1.2} className="text-emerald-400/80" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SampleNodesPanel;
