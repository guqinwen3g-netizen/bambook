/**
 * 阶段 P3c — 历史报价导入向导（PRD 16.1/16.2）
 *
 * 三步流程：
 *   1. 选择 Excel 文件（.xlsx/.xls/.csv），前端 xlsx 解析为行 JSON（后端不处理文件格式）
 *      - 提供标准模板下载（PRD 16.2：每种数据类型提供标准 Excel 模板，含字段说明和示例）
 *   2. 校验预览：POST /api/v1/quotations/import mode=preview 只校验不写库，错误明细到行/字段
 *   3. 确认导入：mode=commit 合法行落库（幂等：报价号已存在自动跳过），输出导入报告
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Upload,
  ScanLine,
  ShieldCheck,
  Loader2,
  FileSpreadsheet,
  Download,
  AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiService } from '../../services/apiService';
import {
  HistoricalQuotationImportRow,
  QuotationImportResult,
} from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** commit 且有行落库后回调（父级刷新列表） */
  onImported: () => void;
  isDarkMode: boolean;
}

type Step = 1 | 2 | 3;

// ─── 表头映射（PRD 16.4 列级模板：中文表头为主，兼容英文 key）───
const HEADER_ALIASES: Record<keyof HistoricalQuotationImportRow, string[]> = {
  quotationNumber: ['报价号', '报价编号', 'quotationnumber', 'quotation no', 'quotation number', 'qt no'],
  customerName: ['客户', '客户名称', 'customername', 'customer', 'client'],
  amount: ['金额', '总金额', 'amount', 'total amount', 'total'],
  currency: ['币种', 'currency'],
  issueDate: ['报价日期', '日期', 'issuedate', 'issue date', 'date'],
  validUntil: ['有效期', '有效期至', 'validuntil', 'valid until', 'validity'],
  status: ['状态', 'status'],
  salesperson: ['业务员', 'salesperson', 'sales'],
  notes: ['备注', 'notes', 'remark', 'remarks'],
};

const TEMPLATE_HEADERS = ['报价号', '客户', '金额', '币种', '报价日期', '有效期', '状态', '业务员', '备注'];
const TEMPLATE_EXAMPLE = ['Q-2025-001', 'Client A', 12500.5, 'USD', '2025-01-15', '2025-02-15', '已接受', 'Sales A', '历史归档导入'];

const STATUS_ZH_TO_ENUM: Record<string, string> = {
  草稿: 'Draft',
  已发送: 'Sent',
  已接受: 'Accepted',
  已拒绝: 'Rejected',
  已过期: 'Expired',
};

const FIELD_LABELS: Record<string, string> = {
  quotationNumber: '报价号',
  customerName: '客户',
  amount: '金额',
  currency: '币种',
  issueDate: '报价日期',
  validUntil: '有效期',
  status: '状态',
  salesperson: '业务员',
  notes: '备注',
  _row: '整行',
};

const MAX_ROWS = 2000;

/** Excel 单元格 → YYYY-MM-DD 字符串（兼容 Date 对象 / Excel 序列号 / 字符串） */
function normalizeDateCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel 日期序列号（1899-12-30 起算）
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86400000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).trim().replace(/\//g, '-');
}

function normalizeHeaderCell(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 工作表首行表头 → 行 JSON 数组 */
function sheetToRows(sheet: XLSX.WorkSheet): HistoricalQuotationImportRow[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (matrix.length < 2) return [];
  const headers = (matrix[0] as unknown[]).map(normalizeHeaderCell);
  const colIndexByField = new Map<keyof HistoricalQuotationImportRow, number>();
  headers.forEach((h, idx) => {
    if (!h) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (colIndexByField.has(field as keyof HistoricalQuotationImportRow)) continue;
      if (aliases.some(a => a.toLowerCase() === h)) {
        colIndexByField.set(field as keyof HistoricalQuotationImportRow, idx);
      }
    }
  });

  const rows: HistoricalQuotationImportRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] as unknown[];
    const isEmpty = cells.every(c => String(c ?? '').trim() === '');
    if (isEmpty) continue;
    const row: HistoricalQuotationImportRow = {};
    for (const [field, idx] of colIndexByField.entries()) {
      const raw = cells[idx];
      if (field === 'issueDate' || field === 'validUntil') {
        row[field] = normalizeDateCell(raw);
      } else if (field === 'status') {
        const text = String(raw ?? '').trim();
        row.status = STATUS_ZH_TO_ENUM[text] ?? text;
      } else if (field === 'amount') {
        row.amount = typeof raw === 'number' ? raw : String(raw ?? '').trim();
      } else {
        row[field] = String(raw ?? '').trim();
      }
    }
    rows.push(row);
  }
  return rows;
}

const QuotationImportWizard: React.FC<Props> = ({ isOpen, onClose, onImported, isDarkMode }) => {
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<HistoricalQuotationImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0); // 重选同名文件也触发 change
  const [preview, setPreview] = useState<QuotationImportResult | null>(null);
  const [report, setReport] = useState<QuotationImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setFileName(null);
      setRows([]);
      setParseError(null);
      setPreview(null);
      setReport(null);
      setBusy(false);
      setServerError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]);
    sheet['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 16 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '历史报价');
    XLSX.writeFile(book, '历史报价导入模板.xlsx');
  };

  const handleFile = async (file: File) => {
    setParseError(null);
    setRows([]);
    setPreview(null);
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error('文件中没有工作表');
      const parsed = sheetToRows(sheet);
      if (parsed.length === 0) throw new Error('未解析到数据行（首行须为表头：报价号/客户/金额/币种/报价日期…）');
      if (parsed.length > MAX_ROWS) throw new Error(`单次导入不可超过 ${MAX_ROWS} 行（当前 ${parsed.length} 行）`);
      setFileName(file.name);
      setRows(parsed);
    } catch (e: any) {
      setFileName(null);
      setParseError(String(e?.message ?? e));
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const result = await apiService.importHistoricalQuotations(rows, 'preview');
      setPreview(result);
      setStep(2);
    } catch (e: any) {
      setServerError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const result = await apiService.importHistoricalQuotations(rows, 'commit');
      setReport(result);
      setStep(3);
      if (result.created > 0) onImported();
    } catch (e: any) {
      setServerError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const validPreviewRows = useMemo(() => {
    if (!preview) return [];
    const errorRows = new Set(preview.errors.map(e => e.row));
    return rows
      .map((row, idx) => ({ row, rowIndex: idx + 1 }))
      .filter(r => !errorRows.has(r.rowIndex))
      .slice(0, 50);
  }, [preview, rows]);

  const goNext = () => {
    if (step === 1) {
      if (rows.length === 0 || busy) return;
      void runPreview();
      return;
    }
    if (step === 2) {
      if (!preview || preview.valid === 0 || busy) return;
      void runCommit();
      return;
    }
    onClose();
  };

  const canNext = (() => {
    if (step === 1) return rows.length > 0 && !busy;
    if (step === 2) return !!preview && preview.valid > 0 && !busy;
    return true;
  })();

  const nextLabel = step === 1 ? (busy ? '校验中…' : '校验数据') : step === 2 ? (busy ? '导入中…' : '确认导入') : '完成';

  if (!isOpen) return null;

  const mutedText = 'text-[var(--text-tertiary)]';
  const cellBorder = 'border-[var(--border-c-subtle)]';

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        className="absolute inset-0 z-[60] flex items-center justify-center bg-[var(--mask-bg)] backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
      >
        <motion.div
          key="dialog"
          className={`relative w-full max-w-4xl max-h-[88vh] flex flex-col rounded-inset shadow-none overflow-hidden border border-[var(--border-c-default)] text-[var(--text-primary)] bg-[var(--bg-card)]`}
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-6 py-4 border-b border-[var(--border-c-default)]`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-control bg-[var(--os-vnext-brand-blue)]/10`}>
                <FileSpreadsheet size={18} className="text-[var(--os-vnext-brand-blue)]" />
              </div>
              <div>
                <h3 className="font-light">导入历史报价</h3>
                <p className={`text-xs ${mutedText}`}>选择 Excel → 校验预览 → 确认导入（已存在报价号自动跳过）</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={busy}
              className={`p-2 rounded-control transition-colors disabled:opacity-30 text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]`}
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>

          {/* Step indicator */}
          <div className={`flex items-center gap-3 px-6 py-3 border-b border-[var(--border-c-default)] bg-[var(--recessed-bg)]/50`}>
            <StepDot n={1} label="选择文件" active={step >= 1} current={step === 1} icon={<Upload size={14} />} isDarkMode={isDarkMode} />
            <Connector active={step >= 2} isDarkMode={isDarkMode} />
            <StepDot n={2} label="校验预览" active={step >= 2} current={step === 2} icon={<ScanLine size={14} />} isDarkMode={isDarkMode} />
            <Connector active={step >= 3} isDarkMode={isDarkMode} />
            <StepDot n={3} label="导入报告" active={step >= 3} current={step === 3} icon={<ShieldCheck size={14} />} isDarkMode={isDarkMode} />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {serverError && (
              <div className={`mb-4 rounded-inset px-4 py-3 text-sm flex items-center gap-2 bg-[var(--recessed-bg)] border border-[var(--border-c-default)] text-[var(--text-secondary)]`}>
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className={`flex items-center justify-between rounded-inset border px-4 py-3 border-[var(--border-c-default)] bg-[var(--recessed-bg)]/60`}>
                  <div className={`text-xs ${mutedText}`}>
                    模板列：报价号* / 客户*（须匹配客户档案）/ 金额 / 币种 / 报价日期*（YYYY-MM-DD）/ 有效期 / 状态 / 业务员 / 备注
                  </div>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="bds-btn bds-btn-ghost flex-shrink-0"
                  >
                    <Download size={14} />
                    下载模板
                  </button>
                </div>

                <label
                  className={`flex flex-col items-center justify-center gap-2 rounded-inset border border-dashed px-6 py-10 cursor-pointer transition-colors ${
                    'border-[var(--border-c-strong)] hover:border-[var(--accent)] hover:bg-[var(--hover-darken)]'
                  }`}
                >
                  <Upload size={24} className={mutedText} />
                  <span className={`text-sm font-light ${'text-[var(--text-primary)]'}`}>
                    {fileName ?? '点击选择 Excel 文件（.xlsx / .xls / .csv）'}
                  </span>
                  {rows.length > 0 && (
                    <span className={`text-xs ${mutedText}`}>已解析 {rows.length} 行数据</span>
                  )}
                  <input
                    key={fileKey}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                      setFileKey(k => k + 1);
                    }}
                  />
                </label>

                {parseError && (
                  <div className={`rounded-inset px-4 py-3 text-sm flex items-center gap-2 bg-[var(--recessed-bg)] border border-[var(--border-c-default)] text-[var(--text-secondary)]`}>
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span>{parseError}</span>
                  </div>
                )}
              </div>
            )}

            {step === 2 && preview && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <SummaryCard label="总行数" value={preview.total} isDarkMode={isDarkMode} />
                  <SummaryCard label="合法行" value={preview.valid} isDarkMode={isDarkMode} />
                  <SummaryCard label="将跳过（已存在/重复）" value={preview.skipped} isDarkMode={isDarkMode} />
                  <SummaryCard label="错误行" value={preview.errors.length} isDarkMode={isDarkMode} />
                </div>

                {preview.errors.length > 0 && (
                  <div>
                    <p className={`text-xs mb-2 ${mutedText}`}>错误明细（这些行不会被导入，修正后可重新导入）</p>
                    <div className={`rounded-inset border overflow-hidden border-[var(--border-c-default)]`}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">
                            <th className="text-left px-3 py-2 font-light w-16">行号</th>
                            <th className="text-left px-3 py-2 font-light w-24">字段</th>
                            <th className="text-left px-3 py-2 font-light">错误说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.errors.slice(0, 100).map((err, i) => (
                            <tr key={i} className={`border-t ${cellBorder}`}>
                              <td className="px-3 py-1.5 tabular-nums">{err.row}</td>
                              <td className="px-3 py-1.5">{FIELD_LABELS[err.field] ?? err.field}</td>
                              <td className={`px-3 py-1.5 ${mutedText}`}>{err.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.errors.length > 100 && (
                        <p className={`px-3 py-2 text-xs border-t ${cellBorder} ${mutedText}`}>仅展示前 100 条，共 {preview.errors.length} 条</p>
                      )}
                    </div>
                  </div>
                )}

                {validPreviewRows.length > 0 && (
                  <div>
                    <p className={`text-xs mb-2 ${mutedText}`}>合法行预览（前 {validPreviewRows.length} 条）</p>
                    <div className={`rounded-inset border overflow-hidden border-[var(--border-c-default)]`}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">
                            <th className="text-left px-3 py-2 font-light w-16">行号</th>
                            <th className="text-left px-3 py-2 font-light">报价号</th>
                            <th className="text-left px-3 py-2 font-light">客户</th>
                            <th className="text-right px-3 py-2 font-light">金额</th>
                            <th className="text-left px-3 py-2 font-light">报价日期</th>
                            <th className="text-left px-3 py-2 font-light">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validPreviewRows.map(({ row, rowIndex }) => (
                            <tr key={rowIndex} className={`border-t ${cellBorder}`}>
                              <td className="px-3 py-1.5 tabular-nums">{rowIndex}</td>
                              <td className="px-3 py-1.5">{row.quotationNumber}</td>
                              <td className="px-3 py-1.5">{row.customerName}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{row.amount ?? '-'}{row.currency ? ` ${row.currency}` : ''}</td>
                              <td className="px-3 py-1.5 tabular-nums">{row.issueDate}</td>
                              <td className={`px-3 py-1.5 ${mutedText}`}>{row.status || 'Sent'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {preview.valid === 0 && (
                  <p className={`text-sm ${mutedText}`}>没有可导入的合法行，请返回修正文件后重新校验。</p>
                )}
              </div>
            )}

            {step === 3 && report && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <SummaryCard label="总行数" value={report.total} isDarkMode={isDarkMode} />
                  <SummaryCard label="成功导入" value={report.created} isDarkMode={isDarkMode} accent />
                  <SummaryCard label="已跳过（幂等）" value={report.skipped} isDarkMode={isDarkMode} />
                  <SummaryCard label="失败行" value={report.errors.length} isDarkMode={isDarkMode} />
                </div>
                {report.errors.length > 0 && (
                  <div className={`rounded-inset border overflow-hidden border-[var(--border-c-default)]`}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">
                          <th className="text-left px-3 py-2 font-light w-16">行号</th>
                          <th className="text-left px-3 py-2 font-light w-24">字段</th>
                          <th className="text-left px-3 py-2 font-light">错误说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.errors.map((err, i) => (
                          <tr key={i} className={`border-t ${cellBorder}`}>
                            <td className="px-3 py-1.5 tabular-nums">{err.row}</td>
                            <td className="px-3 py-1.5">{FIELD_LABELS[err.field] ?? err.field}</td>
                            <td className={`px-3 py-1.5 ${mutedText}`}>{err.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className={`text-xs ${mutedText}`}>
                  导入记录已写入审计日志；失败/跳过行可在修正后重新执行同一文件导入（幂等，不会重复落库）。
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`flex items-center justify-between px-6 py-4 border-t border-[var(--border-c-default)]`}>
            <button
              type="button"
              onClick={() => setStep(s => (s - 1) as Step)}
              disabled={step === 1 || busy}
              className="bds-btn bds-btn-ghost"
            >
              <ChevronLeft size={14} strokeWidth={1.5} /> 上一步
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="bds-btn bds-btn-ghost"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                className="bds-btn bds-btn-primary"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {nextLabel}
                {!busy && step < 3 && <ChevronRight size={14} strokeWidth={1.5} />}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const SummaryCard: React.FC<{ label: string; value: number; isDarkMode: boolean; accent?: boolean }> = ({ label, value, isDarkMode, accent }) => (
  <div className={`rounded-inset border px-4 py-3 border-[var(--border-c-default)] bg-[var(--recessed-bg)]/60`}>
    <div className={`text-xl font-light tabular-nums ${accent ? 'text-[var(--os-vnext-brand-blue)]' : 'text-[var(--text-primary)]'}`}>{value}</div>
    <div className={`text-[11px] mt-0.5 ${'text-[var(--text-tertiary)]'}`}>{label}</div>
  </div>
);

const StepDot: React.FC<{
  n: number;
  label: string;
  active: boolean;
  current: boolean;
  icon: React.ReactNode;
  isDarkMode: boolean;
}> = ({ n, label, active, current, icon, isDarkMode }) => (
  <div className="flex items-center gap-2">
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-light transition-all ${
        current
          ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-none'
            : active
              ? 'bg-[var(--accent)]/60 text-[var(--on-accent)] shadow-none'
              : 'bg-[var(--recessed-bg)] text-[var(--text-tertiary)]'
      }`}
    >
      {active && !current ? icon : n}
    </div>
    <span className={`text-xs font-light ${current ? 'text-[var(--os-vnext-brand-blue)]' : active ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}`}>
      {label}
    </span>
  </div>
);

const Connector: React.FC<{ active: boolean; isDarkMode: boolean }> = ({ active, isDarkMode }) => (
  <div className={`flex-1 h-px transition-colors ${active ? 'bg-[var(--os-vnext-brand-blue)]/60' : 'bg-[var(--recessed-bg-strong)]'}`} />
);

export default QuotationImportWizard;
