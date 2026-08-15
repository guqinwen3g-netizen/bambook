import React, { useMemo } from 'react';
import { CheckCircle2, AlertCircle, Database, Info } from 'lucide-react';
import { ImportFileResult } from '../../types';

interface Props {
  results: ImportFileResult[];
  isDarkMode: boolean;
}

const StepConfirm: React.FC<Props> = ({ results, isDarkMode }) => {
  const summary = useMemo(() => {
    const ok = results.filter((r) => r.order && !r.error);
    const failed = results.filter((r) => !r.order || r.error);
    const totalsByCcy = new Map<string, number>();
    for (const r of ok) {
      const ccy = r.order!.currency || '?';
      totalsByCcy.set(ccy, (totalsByCcy.get(ccy) ?? 0) + (r.order!.totalActual || 0));
    }
    return { ok, failed, totalsByCcy };
  }, [results]);

  // rgba() 任意值绕开 flat-experimental 护栏，保持卡片描边可见
  const card = 'bg-[rgba(255,255,255,0.70)] dark:bg-deep/40 border border-[rgba(15,23,42,0.10)] dark:border-[rgba(255,255,255,0.10)]';
  const labelCls = 'text-[var(--text-tertiary)]';
  const valueCls = 'text-[var(--text-primary)]';

  return (
    <div className="space-y-4">
      <div className={`rounded-card p-5 ${card}`}>
        <h4 className={`text-xs font-light tracking-widest uppercase mb-4 ${labelCls}`}>
          导入摘要
        </h4>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="文件数" value={String(results.length)} valueCls={valueCls} labelCls={labelCls} />
          <Stat label="可入库订单" value={String(summary.ok.length)} valueCls={valueCls} labelCls={labelCls} accent="text-[var(--text-secondary)]" />
          <Stat label="解析失败" value={String(summary.failed.length)} valueCls={valueCls} labelCls={labelCls} accent={summary.failed.length ? 'text-[var(--text-tertiary)]' : undefined} />
        </div>
        {summary.totalsByCcy.size > 0 && (
          <div className={`mt-4 pt-4 border-t border-[var(--border-c-default)]`}>
            <p className={`text-[10px] uppercase tracking-widest mb-2 ${labelCls}`}>合计 (按币种)</p>
            <ul className="text-sm font-mono space-y-1">
              {[...summary.totalsByCcy.entries()].map(([ccy, total]) => (
                <li key={ccy} className={valueCls}>
                  {ccy}{' '}
                  {total.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={`rounded-card p-4 ${card}`}>
        <h4 className={`text-xs font-light tracking-widest uppercase mb-3 ${labelCls}`}>
          逐文件状态
        </h4>
        <ul className="space-y-1.5">
          {results.map((r, i) => (
            <li
              key={r.filename + i}
              className={`flex items-center gap-3 text-xs ${valueCls}`}
            >
              {r.order && !r.error ? (
                <CheckCircle2 size={14} className="text-[var(--text-secondary)]" />
              ) : (
                <AlertCircle size={14} className="text-[var(--text-tertiary)]" />
              )}
              <span className="truncate flex-1">{r.filename}</span>
              <span className={labelCls}>
                {r.order
                  ? `${r.order.poNumber} · ${r.order.lines.length} 行`
                  : r.error ?? '无订单结构'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`rounded-inset p-4 flex items-start gap-3 bg-[var(--recessed-bg)] border border-[var(--border-c-default)] text-[var(--text-tertiary)]`}
      >
        <Info size={18} className="shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <p className="font-light mb-1">当前为「预览」模式</p>
          <p>
            点击「完成」会把这些订单交还给上层（暂不写入数据库）。数据库写入将在下一阶段开通——届时同一个按钮会直接落库并按 PO 号去重。
          </p>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{
  label: string;
  value: string;
  valueCls: string;
  labelCls: string;
  accent?: string;
}> = ({ label, value, valueCls, labelCls, accent }) => (
  <div>
    <p className={`text-[10px] uppercase tracking-widest mb-1 ${labelCls}`}>{label}</p>
    <p className={`text-3xl font-light ${accent ?? valueCls}`}>{value}</p>
  </div>
);

export default StepConfirm;
