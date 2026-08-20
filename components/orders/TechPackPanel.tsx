/**
 * TechPackPanel.tsx — REQ2-18 Tech Pack 结构化解析面板（DR-059，订单详情内嵌 Garment）
 *
 * 交互：上传 PDF（或粘贴文本）→ 解析预览（六类字段 + 置信度徽章 + 现值对照勾选）→ 保存（显式 apply 回填）。
 * 现快照常显（六格摘要 + 尺码分布 + 附件下载）；图片型 PDF 422 明示需 OCR。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, Loader2, Save, ClipboardPaste } from 'lucide-react';
import { techPackService, TechPackSnapshot, TechPackApply } from '../../services/techPackService';
import { bdsToast } from '../ui/bdsToast';
import { bdsConfirm } from '../ui/BdsDialog';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const CONFIDENCE_TONES: Record<string, string> = { high: 'success', low: 'warning', absent: 'neutral' };
const CONFIDENCE_LABELS: Record<string, string> = { high: '高置信', low: '推断', absent: '未检出' };

interface TechPackPanelProps {
  orderId: string;
  isDarkMode: boolean;
  /** 现值对照（订单当前 product/quantity/dueDate/fabricContent/productColorCode） */
  order?: { product?: string | null; quantity?: number | null; dueDate?: string | null; fabricContent?: string | null; productColorCode?: string | null } | null;
  onOrderUpdated?: () => void;
}

const EMPTY_PARSED: TechPackSnapshot & { fileName?: string | null } = {};

export function TechPackPanel({ orderId, order, onOrderUpdated }: TechPackPanelProps) {
  const [saved, setSaved] = useState<TechPackSnapshot | null>(null);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<TechPackSnapshot | null>(null);
  const [parseFileName, setParseFileName] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [apply, setApply] = useState<TechPackApply>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await techPackService.get(orderId);
      setSaved(data.techPack);
      setSavedFileName(data.techPackFileName);
    } catch {
      /* 无快照属正常态 */
    }
  }, [orderId]);

  useEffect(() => { reload(); }, [reload]);

  const doParse = async (input: { file?: File; text?: string }) => {
    setParsing(true);
    setError('');
    try {
      const r = await techPackService.parse(orderId, input);
      setParsed(r.parsed);
      setParseFileName(r.fileName);
      // 默认勾选：现值为空的字段（不盲写——已有值须用户主动勾选覆盖）
      const def: TechPackApply = {};
      if (r.parsed.styleNo && !order?.product) def.product = r.parsed.styleNo;
      if (r.parsed.totalQty && !order?.quantity) def.quantity = r.parsed.totalQty;
      if (r.parsed.deliveryDate && !order?.dueDate) def.dueDate = r.parsed.deliveryDate;
      if (r.parsed.fabricComposition?.length && !order?.fabricContent) {
        def.fabricContent = r.parsed.fabricComposition.map(c => `${c.pct}% ${c.fiber}`).join(' ');
      }
      if (r.parsed.colors?.length === 1 && !order?.productColorCode) def.productColorCode = r.parsed.colors[0];
      setApply(def);
      bdsToast.success('解析完成，请核对字段后保存回填');
    } catch (e: any) {
      setError(e.message || '解析失败');
    } finally {
      setParsing(false);
    }
  };

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('仅支持 PDF 规格书（文本层）；文本可直接粘贴');
      return;
    }
    doParse({ file });
  };

  const handleSave = async () => {
    if (!parsed || saving) return;
    const willOverwrite = Object.entries(apply).filter(([k, v]) => v != null && v !== '' && (order as any)?.[k] != null && (order as any)?.[k] !== '');
    const confirmed = await bdsConfirm({
      title: '保存 Tech Pack 并回填',
      body: willOverwrite.length > 0
        ? `将覆盖现有字段：${willOverwrite.map(([k]) => k).join('、')}。解析快照将更新（历史经审计留痕）。`
        : '保存解析快照并回填勾选字段？解析快照将更新（历史经审计留痕）。',
    });
    if (!confirmed) return;
    setSaving(true);
    setError('');
    try {
      const r = await techPackService.save(orderId, { parsed, fileName: parseFileName, apply });
      bdsToast.success(`Tech Pack 已保存${r.applied.length > 0 ? `，回填 ${r.applied.length} 个字段` : ''}`);
      setParsed(null);
      setApply({});
      setPasteText('');
      await reload();
      onOrderUpdated?.();
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const compText = parsed?.fabricComposition?.map(c => `${c.pct}% ${c.fiber}`).join(' ') ?? null;
  const sizes = parsed?.sizeBreakdown ?? saved?.sizeBreakdown ?? null;

  const renderFieldRow = (label: string, key: keyof TechPackApply, value: string | number | null | undefined, current?: string | number | null, confKey?: string) => {
    const conf = parsed?.confidence?.[confKey ?? ''] ?? null;
    const hasValue = value != null && value !== '';
    const checked = apply[key] != null && apply[key] !== '';
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
        <span className="w-20 shrink-0 text-[10px] tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
        <span className={cx('min-w-0 flex-1 truncate font-light', hasValue ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
          {hasValue ? String(value) : '未检出'}
        </span>
        {conf && <span className={cx('bds-badge', CONFIDENCE_TONES[conf] ?? 'neutral')}>{CONFIDENCE_LABELS[conf] ?? conf}</span>}
        {parsed && hasValue && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-light text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => setApply(prev => {
                const next = { ...prev };
                if (e.target.checked) (next as any)[key] = value as any;
                else delete (next as any)[key];
                return next;
              })}
            />
            回填{current != null && current !== '' ? `（覆盖现值 ${String(current)}）` : ''}
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs tracking-[0.14em] text-[var(--text-secondary)]">
          <FileUp size={14} />
          TECH PACK 规格
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => { handleFile(e.target.files?.[0]); e.currentTarget.value = ''; }}
          />
          <button type="button" className="bds-btn bds-btn-secondary h-8 text-[11px]" disabled={parsing} onClick={() => fileInputRef.current?.click()}>
            {parsing ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            上传规格书解析
          </button>
          <button type="button" className="bds-btn bds-btn-ghost h-8 text-[11px]" onClick={() => setShowPaste(v => !v)}>
            <ClipboardPaste size={14} />
            粘贴文本
          </button>
          {savedFileName && (
            <a className="bds-btn bds-btn-ghost h-8 text-[11px]" href={techPackService.fileUrl(orderId)} target="_blank" rel="noreferrer">
              下载附件
            </a>
          )}
        </div>
      </div>

      {showPaste && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="粘贴规格书文本（邮件正文/已提取文本）——款号/尺码表/颜色/数量/成分/交期"
            className="bds-input bds-textarea min-h-24 w-full text-xs"
          />
          <button type="button" className="bds-btn bds-btn-secondary h-8 text-[11px]" disabled={parsing || !pasteText.trim()} onClick={() => doParse({ text: pasteText })}>
            {parsing ? <Loader2 size={14} className="animate-spin" /> : null}
            解析文本
          </button>
        </div>
      )}

      {error && <div className="bds-alert danger text-xs">{error}</div>}

      {/* 解析预览（未保存） */}
      {parsed && (
        <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)]">
          <div className="px-3 py-2 text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">解析预览（保存前不落库）</div>
          <div className="divide-y divide-[var(--border-c-subtle)]">
            {renderFieldRow('款号', 'product', parsed.styleNo, order?.product, 'styleNo')}
            {renderFieldRow('数量', 'quantity', parsed.totalQty, order?.quantity, 'totalQty')}
            {renderFieldRow('交期', 'dueDate', parsed.deliveryDate, order?.dueDate, 'deliveryDate')}
            {renderFieldRow('成分', 'fabricContent', compText, order?.fabricContent, 'fabricComposition')}
            {renderFieldRow('颜色', 'productColorCode', parsed.colors?.length === 1 ? parsed.colors[0] : parsed.colors?.join(' / '), order?.productColorCode, 'colors')}
          </div>
          {sizes && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span className="w-20 shrink-0 text-[10px] tracking-[0.1em] text-[var(--text-tertiary)]">尺码分布</span>
              {Object.entries(sizes).map(([size, qty]) => (
                <span key={size} className="bds-badge neutral">{size} × {qty}</span>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 px-3 py-2">
            <button type="button" className="bds-btn bds-btn-ghost h-8 text-[11px]" disabled={saving} onClick={() => { setParsed(null); setApply({}); }}>取消</button>
            <button type="button" className="bds-btn bds-btn-primary h-8 text-[11px]" disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存并回填
            </button>
          </div>
        </div>
      )}

      {/* 已存快照 */}
      {!parsed && saved && (
        <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)]">
          <div className="flex items-center gap-2 px-3 py-2 text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">
            已存快照{saved.uploadedAt ? ` · ${new Date(saved.uploadedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 pb-3 text-xs font-light sm:grid-cols-3">
            <div><span className="text-[var(--text-tertiary)]">款号 </span><span className="text-[var(--text-primary)]">{saved.styleNo ?? '—'}</span></div>
            <div><span className="text-[var(--text-tertiary)]">季型 </span><span className="text-[var(--text-primary)]">{saved.season ?? '—'}</span></div>
            <div><span className="text-[var(--text-tertiary)]">数量 </span><span className="text-[var(--text-primary)]">{saved.totalQty ?? '—'}</span></div>
            <div><span className="text-[var(--text-tertiary)]">交期 </span><span className="text-[var(--text-primary)]">{saved.deliveryDate ?? '—'}</span></div>
            <div className="col-span-2"><span className="text-[var(--text-tertiary)]">成分 </span><span className="text-[var(--text-primary)]">{saved.fabricComposition?.map(c => `${c.pct}% ${c.fiber}`).join(' ') ?? '—'}</span></div>
            <div className="col-span-2 sm:col-span-3"><span className="text-[var(--text-tertiary)]">颜色 </span><span className="text-[var(--text-primary)]">{saved.colors?.join(' / ') ?? '—'}</span></div>
          </div>
          {saved.sizeBreakdown && (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-xs">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)]">尺码分布</span>
              {Object.entries(saved.sizeBreakdown).map(([size, qty]) => (
                <span key={size} className="bds-badge neutral">{size} × {qty}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {!parsed && !saved && !error && (
        <div className="px-1 text-[11px] font-light leading-relaxed text-[var(--text-tertiary)]">
          上传客户 Tech Pack（PDF 文本层）或粘贴文本，自动解析款号/尺码表/颜色/数量/成分/交期，核对后勾选回填订单字段。扫描件（无文本层）需 OCR，当前版本明示不支持。
        </div>
      )}
    </div>
  );
}

export default TechPackPanel;
