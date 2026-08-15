import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Upload, ScanLine, ShieldCheck, Loader2 } from 'lucide-react';
import StepUpload, { FileEntry } from './StepUpload';
import StepPreview from './StepPreview';
import StepConfirm from './StepConfirm';
import { ImportFileResult, ImportResponse, ParsedOrder } from '../../types';
import { uploadPdfsForParsing } from '../../services/importService';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { statusSemanticClass } from '../rdlBusinessStatusTokens';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when the user clicks "完成" on the last step.
   * `orders` contains only successfully-parsed, possibly-edited orders.
   * Persistence (DB write) is intentionally NOT performed here.
   */
  onConfirm: (orders: ParsedOrder[]) => void;
  isDarkMode: boolean;
  apiKey?: string; // optional, only needed if BAMBOOK_REQUIRE_AUTH=true on server
}

type Step = 1 | 2 | 3;

const ImportWizard: React.FC<Props> = ({ isOpen, onClose, onConfirm, isDarkMode, apiKey }) => {
  const [step, setStep] = useState<Step>(1);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [results, setResults] = useState<ImportFileResult[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Reset on open/close
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setFiles([]);
      setResults([]);
      setParseError(null);
      setIsParsing(false);
    }
  }, [isOpen]);

  // ESC closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const goNext = async () => {
    if (step === 1) {
      if (files.length === 0) return;
      setIsParsing(true);
      setParseError(null);
      setFiles((prev) => prev.map((f) => ({ ...f, status: 'parsing' })));
      try {
        const resp: ImportResponse = await uploadPdfsForParsing(
          files.map((f) => f.file),
          { apiKey },
        );
        // Reorder results to match files order (server preserves input order, but be defensive)
        const byName = new Map<string, ImportFileResult[]>();
        for (const r of resp.results) {
          const arr = byName.get(r.filename) ?? [];
          arr.push(r);
          byName.set(r.filename, arr);
        }
        const ordered: ImportFileResult[] = [];
        const updated: FileEntry[] = files.map((f) => {
          const arr = byName.get(f.file.name);
          const r = arr && arr.shift();
          if (r) {
            ordered.push(r);
            return {
              ...f,
              status: r.error || !r.order ? 'error' : 'done',
              message: r.error ?? undefined,
            };
          }
          return { ...f, status: 'error', message: '服务端没有返回此文件的解析结果' };
        });
        setFiles(updated);
        setResults(ordered);
        setStep(2);
      } catch (e: any) {
        setParseError(String(e?.message ?? e));
        setFiles((prev) => prev.map((f) => ({ ...f, status: 'error' })));
      } finally {
        setIsParsing(false);
      }
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 3) {
      const ok = results.filter((r) => r.order && !r.error).map((r) => r.order!) as ParsedOrder[];
      onConfirm(ok);
      onClose();
    }
  };

  const goBack = () => {
    if (step === 1) return;
    setStep((s) => (s - 1) as Step);
  };

  const canNext = (() => {
    if (step === 1) return files.length > 0 && !isParsing;
    if (step === 2) return results.some((r) => r.order && !r.error);
    return true;
  })();

  const nextLabel =
    step === 1 ? (isParsing ? '解析中…' : '上传并解析') : step === 2 ? '继续' : '完成';

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          key="dialog"
          className={`relative w-full max-w-5xl max-h-[88vh] flex flex-col rounded-floating shadow-none overflow-hidden border border-[var(--border-c-default)] text-[var(--text-primary)] bg-[var(--bg-card)] dark:bg-deep/95`}
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-6 py-4 border-b border-[var(--border-c-default)]`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-control bg-[var(--os-vnext-brand-blue)]/10 dark:bg-[var(--os-vnext-brand-blue)]/20`}
              >
                <Upload size={18} className="text-[var(--os-vnext-brand-blue)]" />
              </div>
              <div>
                <h3 className="font-light">批量导入订单</h3>
                <p
                  className={`text-xs text-[var(--text-tertiary)]`}
                >
                  上传 PDF → 自动识别客户 → 预览并修正 → 完成
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]`}
              aria-label="关闭"
            >
              <X size={17} strokeWidth={1.5} />
            </button>
          </div>

          {/* Step indicator */}
          <div
            className={`flex items-center gap-3 px-6 py-3 border-b border-[var(--border-c-default)] bg-[var(--recessed-bg)]/50 dark:bg-deep/50`}
          >
            <StepDot n={1} label="选择文件" active={step >= 1} current={step === 1} icon={<Upload size={12} />} isDarkMode={isDarkMode} />
            <Connector active={step >= 2} />
            <StepDot n={2} label="预览 / 修正" active={step >= 2} current={step === 2} icon={<ScanLine size={12} />} isDarkMode={isDarkMode} />
            <Connector active={step >= 3} />
            <StepDot n={3} label="确认" active={step >= 3} current={step === 3} icon={<ShieldCheck size={12} />} isDarkMode={isDarkMode} />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {parseError && (
              <div className={`mb-4 flex items-center gap-2 rounded-inset border px-4 py-3 text-xs font-light ${statusSemanticClass('danger', isDarkMode)}`}>
                上传失败：{parseError}
              </div>
            )}

            {step === 1 && (
              <StepUpload
                files={files}
                onFilesChange={setFiles}
                isDarkMode={isDarkMode}
                isParsing={isParsing}
              />
            )}
            {step === 2 && (
              <StepPreview
                results={results}
                onResultsChange={setResults}
                isDarkMode={isDarkMode}
              />
            )}
            {step === 3 && <StepConfirm results={results} isDarkMode={isDarkMode} />}
          </div>

          {/* Footer */}
          <div
            className={`flex items-center justify-between px-6 py-4 border-t border-[var(--border-c-default)]`}
          >
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || isParsing}
              className={`flex h-10 min-w-[96px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-light tracking-wide whitespace-nowrap transition-all disabled:opacity-30 disabled:cursor-not-allowed text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}
            >
              <ChevronLeft size={14} strokeWidth={1.5} /> 上一步
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`flex h-10 min-w-[80px] items-center justify-center rounded-full px-4 text-xs font-light tracking-wide whitespace-nowrap transition-all ${
                  'text-[var(--text-tertiary)] hover:bg-[var(--active-darken)]'
                }`}
              >
                关闭
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                className={`flex h-10 min-w-[96px] items-center justify-center gap-1.5 rounded-full px-5 text-xs font-light tracking-wide whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white`}
              >
                {isParsing && <Loader2 size={14} className="animate-spin" />}
                {nextLabel}
                {!isParsing && <ChevronRight size={14} strokeWidth={1.5} />}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

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
          ? 'bg-[var(--os-vnext-brand-blue)] text-white shadow-none'
          : active
            ? 'bg-[var(--os-vnext-brand-blue)]/60 text-white shadow-none'
            : `${BAMBOOK_OS.controls.actionControl.base} text-[var(--text-tertiary)]`
      }`}
    >
      {active && !current ? icon : n}
    </div>
    <span
      className={`text-xs font-light ${
        current ? 'text-[var(--os-vnext-brand-blue)]' : active ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
      }`}
    >
      {label}
    </span>
  </div>
);

const Connector: React.FC<{ active: boolean }> = ({ active }) => (
  <div
    className={`flex-1 h-px transition-colors ${
      active ? 'bg-[var(--os-vnext-brand-blue)]/60' : 'bg-[var(--recessed-bg-strong)]'
    }`}
  />
);

export default ImportWizard;
