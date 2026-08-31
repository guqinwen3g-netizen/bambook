import React, { useMemo, useState } from 'react';
import { AlertCircle, FileText, ShieldCheck } from 'lucide-react';
import { ImportFileResult, ParsedOrder, ParsedLine } from '../../types';
import { formatYmd } from '../../lib/dateFormat';
import { statusSemanticClass } from '../rdlBusinessStatusTokens';

interface Props {
  results: ImportFileResult[];
  onResultsChange: (next: ImportFileResult[]) => void;
  isDarkMode: boolean;
}

const StepPreview: React.FC<Props> = ({ results, onResultsChange, isDarkMode }) => {
  const [activeIdx, setActiveIdx] = useState(0);

  const updateOrder = (idx: number, patch: Partial<ParsedOrder>) => {
    onResultsChange(
      results.map((r, i) =>
        i === idx && r.order ? { ...r, order: { ...r.order, ...patch } } : r,
      ),
    );
  };

  const updateLine = (idx: number, lineIdx: number, patch: Partial<ParsedLine>) => {
    onResultsChange(
      results.map((r, i) => {
        if (i !== idx || !r.order) return r;
        const lines = r.order.lines.map((l, li) => (li === lineIdx ? { ...l, ...patch } : l));
        return { ...r, order: { ...r.order, lines } };
      }),
    );
  };

  const active = results[activeIdx];

  if (!active) {
    return <p className="text-sm text-[var(--text-tertiary)]">没有可预览的解析结果。</p>;
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div
        className={`flex gap-2 overflow-x-auto pb-2 -mx-1 px-1`}
      >
        {results.map((r, i) => (
          <button
            key={r.filename + i}
            onClick={() => setActiveIdx(i)}
            className={`flex h-10 items-center gap-2 px-4 rounded-full text-xs whitespace-nowrap transition-colors ${
              i === activeIdx
                ? 'bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue)] border border-[var(--os-vnext-brand-blue)]/30'
                : 'bg-[var(--recessed-bg)] text-[var(--text-secondary)] border border-[var(--border-c-strong)] hover:bg-[var(--recessed-bg-hover)]'
            }`}
          >
            {r.error ? <AlertCircle size={14} /> : <FileText size={14} />}
            <span className="max-w-[14rem] truncate">{r.filename}</span>
            {r.detection.customerId && (
              <span
                className={`text-[10px] uppercase tracking-widest opacity-70`}
              >
                {r.detection.customerId}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {active.error || !active.order ? (
        <div className={`rounded-inset border p-4 flex items-start gap-3 ${statusSemanticClass('danger', isDarkMode)}`}>
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-light">这份 PDF 解析失败</p>
            <p className="text-xs mt-1 opacity-80">
              {active.error ?? '没有解析出订单结构。'}
            </p>
            <p className="text-xs mt-1 opacity-60">
              确认时该文件会被跳过；可返回上一步重新选文件。
            </p>
          </div>
        </div>
      ) : (
        <OrderPreview
          file={active}
          onChangeHeader={(patch) => updateOrder(activeIdx, patch)}
          onChangeLine={(li, patch) => updateLine(activeIdx, li, patch)}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
};

const OrderPreview: React.FC<{
  file: ImportFileResult;
  onChangeHeader: (patch: Partial<ParsedOrder>) => void;
  onChangeLine: (lineIdx: number, patch: Partial<ParsedLine>) => void;
  isDarkMode: boolean;
}> = ({ file, onChangeHeader, onChangeLine, isDarkMode }) => {
  const o = file.order!;
  // rgba() 任意值绕开 flat-experimental 护栏，保持卡片描边与单元格编辑器边框可见；
  // 控件形状与订单域 field 规范一致：胶囊形 rounded-full（抬头字段 h-10 / 表格单元格紧凑 px-3 py-1）。
  const card = 'bds-surface border border-[var(--border-c-default)]';
  const labelCls = 'text-[var(--text-tertiary)]';
  const valueCls = 'text-[var(--text-primary)]';
  const inputBase = `w-full bg-transparent border rounded-full text-sm text-[var(--text-primary)] focus:border-[var(--border-c-strong)] border-[var(--border-c-default)] focus:outline-none focus:ring-1 focus:ring-[var(--border-c-strong)]/40`;
  const inputCls = `${inputBase} h-10 px-4`;
  const cellInputCls = `${inputBase} px-3 py-1`;

  return (
    <div className="space-y-4">
      {/* Detection banner */}
      <div
        className={`rounded-inset px-4 py-3 flex items-center gap-3 text-xs bg-[var(--os-vnext-brand-blue)]/10 border border-[var(--os-vnext-brand-blue)]/30 text-[var(--text-secondary)]`}
      >
        <ShieldCheck size={16} className="text-[var(--os-vnext-brand-blue)]" />
        <span>
          客户识别：<strong>{file.detection.customerId ?? '未知'}</strong> ·
          置信度{' '}
          <strong>{(file.detection.confidence * 100).toFixed(0)}%</strong>
        </span>
        <span className={`ml-auto ${labelCls}`}>{file.pages} 页</span>
      </div>

      {/* Mapping hint — explains how parsed fields land on the unified Order schema */}
      <div
        className={`rounded-inset px-4 py-3 text-xs leading-relaxed bg-[var(--recessed-bg)] border border-[var(--border-c-default)] text-[var(--text-secondary)]`}
      >
        <div className="font-light mb-1">入库后的字段映射：</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>
            <span className="text-[var(--text-primary)]">Ship-to 公司 / 地址 / 联系人</span> → 写入
            <span className="font-mono">consigneeName / consigneeAddress / consigneeContact</span>
          </li>
          <li>
            <span className="text-[var(--text-primary)]">币种</span> → 写入
            <span className="font-mono">salesCurrency</span>（默认 USD）；采购方
            <span className="font-mono">purchaseCurrency</span>
            默认 CNY，可在订单详情手填。
          </li>
          <li>
            面料工厂 (<span className="font-mono">millName</span>) 留空，请在订单详情手填。
          </li>
          <li>
            所有 PDF 字段在数据库里会被标记为 <span className="font-mono">'pdf'</span>；后续手填或手改的字段不会被同 PO 的 PDF 重导覆盖。
          </li>
        </ul>
      </div>

      {/* Header fields */}
      <div className={`rounded-card p-4 ${card}`}>
        <h4 className={`text-xs font-light tracking-widest uppercase mb-3 ${labelCls}`}>
          订单抬头
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="PO 号" v={o.poNumber} onChange={(v) => onChangeHeader({ poNumber: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="季节" v={o.season} onChange={(v) => onChangeHeader({ season: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="PO 日期" v={o.poDate} onChange={(v) => onChangeHeader({ poDate: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="联系人" v={o.contactPerson} onChange={(v) => onChangeHeader({ contactPerson: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="联系电话" v={o.contactPhone} onChange={(v) => onChangeHeader({ contactPhone: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="币种" v={o.currency} onChange={(v) => onChangeHeader({ currency: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="交付条款" v={o.deliveryTerms} onChange={(v) => onChangeHeader({ deliveryTerms: v })} cls={inputCls} labelCls={labelCls} />
          <Field label="付款条款" v={o.paymentTerms} onChange={(v) => onChangeHeader({ paymentTerms: v })} cls={inputCls} labelCls={labelCls} />
          <div className="md:col-span-1">
            <p className={`text-[10px] uppercase tracking-widest ${labelCls}`}>合计 (Net / Actual)</p>
            <p className={`text-sm font-mono ${valueCls}`}>
              {fmtNum(o.totalNet)} / {fmtNum(o.totalActual)} {o.currency}
            </p>
          </div>
        </div>
      </div>

      {/* Ship-to (read-only) */}
      <div className={`rounded-card p-4 ${card}`}>
        <h4 className={`text-xs font-light tracking-widest uppercase mb-3 ${labelCls}`}>
          收货 / 交付
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <p className={`text-[10px] uppercase tracking-widest ${labelCls}`}>Ship-to</p>
            <p className={valueCls}>
              {[o.shipTo.contactName, o.shipTo.company].filter(Boolean).join(' · ')}
            </p>
            {o.shipTo.addressLines.map((l, i) => (
              <p key={i} className={`text-xs ${labelCls}`}>
                {l}
              </p>
            ))}
            {o.shipTo.country && (
              <p className={`text-xs ${labelCls}`}>{o.shipTo.country}</p>
            )}
          </div>
          <div>
            <p className={`text-[10px] uppercase tracking-widest ${labelCls}`}>Deliver-to</p>
            <p className={valueCls}>{o.deliverTo ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className={`rounded-card p-4 ${card}`}>
        <h4 className={`text-xs font-light tracking-widest uppercase mb-3 ${labelCls}`}>
          行项目（{o.lines.length} 条）
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={`text-left ${labelCls} uppercase tracking-widest`}>
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">物料</th>
                <th className="py-2 pr-3">Mill</th>
                <th className="py-2 pr-3">描述</th>
                <th className="py-2 pr-3">数量</th>
                <th className="py-2 pr-3">单价</th>
                <th className="py-2 pr-3">小计</th>
                <th className="py-2 pr-3">出厂/到港</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l, li) => (
                <tr
                  key={l.itemNo + li}
                  className={`border-t border-[var(--border-c-subtle)]`}
                >
                  <td className={`py-2 pr-3 ${valueCls}`}>{`${o.poNumber}-${l.itemNo}`}</td>
                  <td className="py-2 pr-3">
                    <input
                      className={cellInputCls}
                      value={l.materialCode}
                      onChange={(e) => onChangeLine(li, { materialCode: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className={cellInputCls}
                      value={l.millQuality}
                      onChange={(e) => onChangeLine(li, { millQuality: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className={cellInputCls}
                      value={l.description}
                      onChange={(e) => onChangeLine(li, { description: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      className={cellInputCls + ' font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'}
                      value={l.quantity}
                      onChange={(e) => onChangeLine(li, { quantity: Number(e.target.value) })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      step="0.01"
                      className={cellInputCls + ' font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'}
                      value={l.unitPrice}
                      onChange={(e) => onChangeLine(li, { unitPrice: Number(e.target.value) })}
                    />
                  </td>
                  <td className={`py-2 pr-3 font-mono ${valueCls}`}>{fmtNum(l.netValue)}</td>
                  <td className={`py-2 pr-3 ${labelCls}`}>{formatYmd(l.exMillDate) || '—'} / {formatYmd(l.deliveryDate) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  v: string;
  onChange: (v: string) => void;
  cls: string;
  labelCls: string;
}> = ({ label, v, onChange, cls, labelCls }) => (
  <div>
    <p className={`text-[10px] uppercase tracking-widest mb-1 ${labelCls}`}>{label}</p>
    <input className={cls} value={v ?? ''} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const fmtNum = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default StepPreview;
