/**
 * DataMigrationPanel — REQ2-07 历史数据批量迁移面板（管理后台「数据迁移」tab）
 *
 * 设计真源：docs/design/04-模块设计/08-设置与后台/Settings-设置/历史数据迁移.md
 * DR-049：校验与落库两段式（validate 零落库 → commit 二次校验落库）；
 *         四类模板英文 key 契约；整批回滚软删（entityIds 真源）
 *
 * 交互流：四类模板 chips → 下载模板 → 上传校验（错误行表：行号+原因）→ 确认导入
 *        → 批次卡 → 批次列表（回滚按钮）
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Database, Download, FileUp, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const TYPE_OPTIONS = [
  { value: 'customers', label: '客户' },
  { value: 'suppliers', label: '供应商' },
  { value: 'orders', label: '订单' },
  { value: 'invoices', label: '发票' },
] as const;
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(o => [o.value, o.label]));

interface ValidatedRow {
  lineNo: number;
  data: Record<string, string>;
  valid: boolean;
  reason?: string;
}

interface ImportBatchRow {
  id: string;
  type: string;
  fileName: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  entityIds: string[];
  status: 'committed' | 'rolled_back';
  createdAt: number;
}

export function DataMigrationPanel() {
  const [type, setType] = useState<string>('customers');
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rows, setRows] = useState<ValidatedRow[] | null>(null);
  const [stats, setStats] = useState<{ totalRows: number; validCount: number; errorCount: number } | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-subtle)]';
  const cardBg = 'bg-[var(--recessed-bg)]';

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const data = await apiService.listImportBatches();
      setBatches(data);
    } catch {
      setBatches([]);
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const downloadTemplate = useCallback(async () => {
    try {
      const blob = await apiService.downloadMigrationTemplate(type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bambook-${type}-template.csv`;
      a.click();
      URL.revokeObjectURL(url);
      bdsToast.success(`模板已下载：bambook-${type}-template.csv（表头 + 中文示例行，按示例填写后上传）`);
    } catch (e: any) {
      bdsToast.danger(`模板下载失败：${e?.message ?? e}`);
    }
  }, [type]);

  const handleFilePicked = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setLastFile(file);
    setValidating(true);
    setRows(null); setStats(null);
    try {
      const data = await apiService.validateMigrationFile(type, file);
      setRows(data.rows);
      setStats({ totalRows: data.totalRows, validCount: data.validCount, errorCount: data.errorCount });
    } catch (e: any) {
      bdsToast.danger(`校验失败：${e?.message ?? e}`);
    } finally {
      setValidating(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [type]);

  const commit = useCallback(async () => {
    if (!lastFile || committing) return;
    const ok = await bdsConfirm({
      title: '确认导入',
      body: `将导入 ${type === 'orders' || type === 'invoices' ? '' : ''}${TYPE_LABEL[type]}数据：校验通过行落库，错误行跳过。导入后可在批次列表整批回滚。`,
    });
    if (!ok) return;
    setCommitting(true);
    try {
      const data = await apiService.commitMigrationFile(type, lastFile);
      bdsToast.success(`导入完成：成功 ${data.imported} 行 / 跳过 ${data.skipped} 行（批次 ${data.batch.id}）。`);
      setRows(null); setStats(null); setLastFile(null);
      await loadBatches();
    } catch (e: any) {
      bdsToast.danger(`导入失败：${e?.message ?? e}`);
    } finally {
      setCommitting(false);
    }
  }, [lastFile, committing, type, loadBatches]);

  const rollback = useCallback(async (b: ImportBatchRow) => {
    const ok = await bdsConfirm({
      title: '整批回滚',
      body: `确认回滚批次 ${b.id}（${TYPE_LABEL[b.type]} · ${b.importedRows} 行）？该批导入的记录将被软删除。`,
      danger: true,
    });
    if (!ok) return;
    setRollingBack(b.id);
    try {
      await apiService.rollbackImportBatch(b.id);
      bdsToast.success('批次已回滚（记录软删除，可追溯）。');
      await loadBatches();
    } catch (e: any) {
      bdsToast.danger(`回滚失败：${e?.message ?? e}`);
    } finally {
      setRollingBack(null);
    }
  }, [loadBatches]);

  const chipCls = (active: boolean) => cx(
    'rounded-full border px-3 py-1 text-xs font-light transition-colors',
    active
      ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
      : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
  );

  const errorRows = (rows ?? []).filter(r => !r.valid);
  const validPreview = (rows ?? []).filter(r => r.valid).slice(0, 20);

  return (
    <div className="space-y-4">
      {/* 模板类型 + 下载 + 上传 */}
      <div className={cx('rounded-inset border p-4', divider, cardBg)}>
        <div className="flex items-center gap-2">
          <Database size={14} strokeWidth={1.5} className={textFaint} />
          <span className={cx('text-xs font-light', textPrimary)}>历史数据迁移</span>
          <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>DATA MIGRATION</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {TYPE_OPTIONS.map(o => (
              <button key={o.value} type="button" onClick={() => { setType(o.value); setRows(null); setStats(null); setLastFile(null); }} className={chipCls(type === o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={downloadTemplate} className="bds-btn bds-btn-ghost">
              <Download size={14} strokeWidth={1.5} />下载模板
            </button>
            <button type="button" disabled={validating} onClick={() => fileInputRef.current?.click()} className="bds-btn bds-btn-secondary">
              {validating ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} strokeWidth={1.5} />}上传校验
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={e => handleFilePicked(e.target.files)}
        />
        <div className={cx('mt-2 text-[10px] font-light', textFaint)}>
          流程：下载模板 → 照示例填 3 年历史数据 → 上传校验（错误行定位修正重传）→ 确认导入（错误行自动跳过）→ 可整批回滚
        </div>
      </div>

      {/* 校验结果 */}
      {stats && (
        <div className={cx('rounded-inset border p-4', divider, cardBg)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('text-xs font-light', textPrimary)}>{lastFile?.name ?? '校验结果'}</span>
            <span className={`bds-badge sm ${stats.errorCount === 0 ? 'success' : 'warning'}`}>
              通过 {stats.validCount} / 错误 {stats.errorCount} / 共 {stats.totalRows} 行
            </span>
            {stats.validCount > 0 && (
              <button type="button" disabled={committing} onClick={commit} className="bds-btn bds-btn-primary ml-auto">
                {committing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.5} />}确认导入（{stats.validCount} 行）
              </button>
            )}
          </div>

          {errorRows.length > 0 && (
            <div className="mt-3">
              <div className={cx('mb-1.5 flex items-center gap-1.5 text-xs font-light', textSecondary)}>
                <TriangleAlert size={14} strokeWidth={1.5} className="text-[var(--text-tertiary)]" />错误行（修正后重传；行号=Excel 数据行）
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {errorRows.map(r => (
                  <div key={r.lineNo} className={cx('flex flex-wrap items-center gap-2 rounded-field border px-2 py-1 text-xs font-light', divider)}>
                    <span className="bds-badge sm danger">第 {r.lineNo} 行</span>
                    <span className={textPrimary}>{r.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {validPreview.length > 0 && (
            <div className="mt-3">
              <div className={cx('mb-1.5 text-xs font-light', textSecondary)}>有效行预览（前 {validPreview.length} 行）</div>
              <div className="max-h-40 overflow-x-auto overflow-y-auto">
                <table className="w-full text-left text-[10px] font-light">
                  <thead>
                    <tr className={textSecondary}>
                      <th className="px-2 py-1">行号</th>
                      {Object.keys(validPreview[0].data).map(k => (
                        <th key={k} className="px-2 py-1 whitespace-nowrap">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validPreview.map(r => (
                      <tr key={r.lineNo} className={cx('border-t', divider)}>
                        <td className={cx('px-2 py-1 tabular-nums', textFaint)}>{r.lineNo}</td>
                        {Object.values(r.data).map((v, i) => (
                          <td key={i} className={cx('px-2 py-1 whitespace-nowrap', textPrimary)}>{v || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 批次列表 */}
      <div className={cx('rounded-inset border p-4', divider, cardBg)}>
        <div className="flex items-center gap-2">
          <span className={cx('text-xs font-light', textPrimary)}>导入批次</span>
          <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>BATCHES</span>
          <span className={cx('ml-auto text-[10px] font-light', textFaint)}>{batches.length} 批</span>
        </div>
        {batchesLoading ? (
          <div className={cx('flex items-center gap-2 py-4 text-xs font-light', textFaint)}>
            <Loader2 size={14} className="animate-spin" />加载批次…
          </div>
        ) : batches.length === 0 ? (
          <div className={cx('py-4 text-xs font-light', textFaint)}>暂无导入批次</div>
        ) : (
          <div className="mt-2 space-y-1.5">
            {batches.map(b => (
              <div key={b.id} className={cx('flex flex-wrap items-center gap-2 rounded-field border px-2 py-1.5 text-xs font-light', divider)}>
                <span className={`bds-badge sm ${b.status === 'committed' ? 'success' : 'neutral'}`}>
                  {b.status === 'committed' ? '已导入' : '已回滚'}
                </span>
                <span className={cx('tabular-nums', textPrimary)}>{b.id}</span>
                <span className="bds-badge sm neutral">{TYPE_LABEL[b.type] ?? b.type}</span>
                <span className={cx('tabular-nums', textSecondary)}>
                  导入 {b.importedRows} / 跳过 {b.skippedRows} / 共 {b.totalRows} 行
                </span>
                <span className={cx('truncate', textFaint)}>{b.fileName}</span>
                <span className={cx('ml-auto text-[10px] tabular-nums', textFaint)}>
                  {new Date(Number(b.createdAt)).toLocaleString('zh-CN')}
                </span>
                {b.status === 'committed' && (
                  <button
                    type="button"
                    disabled={rollingBack !== null}
                    onClick={() => rollback(b)}
                    className="bds-btn bds-btn-ghost"
                  >
                    {rollingBack === b.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} strokeWidth={1.5} />}回滚
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
