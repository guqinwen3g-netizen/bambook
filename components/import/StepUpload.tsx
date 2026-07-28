import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export type FileStatus = 'pending' | 'parsing' | 'done' | 'error';

export interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  message?: string;
}

interface Props {
  files: FileEntry[];
  onFilesChange: (files: FileEntry[]) => void;
  isDarkMode: boolean;
  isParsing: boolean;
}

const StepUpload: React.FC<Props> = ({ files, onFilesChange, isDarkMode, isParsing }) => {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (list.length === 0) return;
      const next: FileEntry[] = [
        ...files,
        ...list.map((f, i) => ({
          id: `${Date.now()}-${i}-${f.name}`,
          file: f,
          status: 'pending' as FileStatus,
        })),
      ];
      onFilesChange(next);
    },
    [files, onFilesChange],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  };

  const removeOne = (id: string) => onFilesChange(files.filter((f) => f.id !== id));
  const clearAll = () => onFilesChange([]);

  const dropzoneBase = isDarkMode
    ? 'border-white/15 bg-white/5 text-slate-400'
    : 'border-slate-300 bg-white/60 text-slate-500';
  const dropzoneActive = 'border-[var(--os-vnext-brand-blue)] bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue)]';

  return (
    <div className="space-y-4">
      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        whileHover={{ scale: 1.005 }}
        className={`cursor-pointer rounded-inset border-2 border-dashed transition-colors p-10 flex flex-col items-center justify-center text-center ${
          dragOver ? dropzoneActive : dropzoneBase
        }`}
      >
        <Upload size={36} strokeWidth={1.2} />
        <p className="mt-4 text-sm font-light">
          拖拽 PDF 到此处，或点击选择文件
        </p>
        <p className="mt-1 text-xs opacity-70">支持多选；仅接收 PDF 格式</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      </motion.div>

      {files.length > 0 && (
        <div
          className={`rounded-xl ${
            isDarkMode ? 'bg-deep/40 border border-white/10' : 'bg-white/70 border border-slate-200'
          } overflow-hidden`}
        >
          <div
            className={`flex items-center justify-between px-4 py-2 text-[11px] uppercase tracking-widest ${
              isDarkMode ? 'text-slate-400 border-b border-white/10' : 'text-slate-500 border-b border-slate-200'
            }`}
          >
            <span>已选择 {files.length} 个文件</span>
            <button
              type="button"
              onClick={clearAll}
              disabled={isParsing}
              className="text-slate-500 hover:text-slate-400 disabled:opacity-30"
            >
              全部清空
            </button>
          </div>
          <ul>
            <AnimatePresence initial={false}>
              {files.map((f) => (
                <motion.li
                  key={f.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'
                  } border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}
                >
                  <FileText
                    size={18}
                    className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm truncate ${
                        isDarkMode ? 'text-slate-200' : 'text-slate-800'
                      }`}
                    >
                      {f.file.name}
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                      {(f.file.size / 1024).toFixed(1)} KB
                      {f.message ? ` · ${f.message}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={f.status} />
                  <button
                    type="button"
                    onClick={() => removeOne(f.id)}
                    disabled={isParsing}
                    className={`p-1 rounded transition-colors disabled:opacity-30 ${
                      isDarkMode
                        ? 'text-slate-400 hover:bg-white/10 hover:text-white'
                        : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                    aria-label="移除"
                  >
                    <X size={16} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: FileStatus }> = ({ status }) => {
  switch (status) {
    case 'parsing':
      return (
        <span className="text-slate-500 flex items-center gap-1 text-xs">
          <Loader2 size={14} className="animate-spin" /> 解析中
        </span>
      );
    case 'done':
      return (
        <span className="text-slate-600 flex items-center gap-1 text-xs">
          <CheckCircle2 size={14} /> 完成
        </span>
      );
    case 'error':
      return (
        <span className="text-slate-500 flex items-center gap-1 text-xs">
          <AlertCircle size={14} /> 失败
        </span>
      );
    default:
      return <span className="text-slate-400 text-xs">待处理</span>;
  }
};

export default StepUpload;
