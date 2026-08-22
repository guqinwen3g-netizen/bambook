/**
 * A4DocumentPreviewModal — 全站统一 A4 纸张文档预览弹窗（2026-08-22 全系统文档体系 B1 架构底座）。
 *
 * 从 FinanceManager 发票预览弹窗提取为共享组件：固定 210mm 纸宽（794px @96dpi）、
 * 按视窗等比缩放（transform scale）、纸张比例恒定不随容器拉伸——与导出 PDF 尺寸一致。
 * 消费方：财务发票预览、单据中心单据预览、后续对账单/PO/QC 报告等全系统文档预览。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';

export interface A4DocumentPreviewModalProps {
  /** 弹窗标题（如「发票预览 · INV-2026-0001」） */
  title: string;
  /** 副标题（如「A4 · 与导出 PDF 同源渲染，所见即所得」） */
  subtitle?: string;
  /** 完整 HTML 文档（自带 <!doctype>/<style> 的服务端同源模板） */
  html: string | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  /** 弹窗内打印按钮（缺省显示；传 null 隐藏） */
  onPrint?: (() => void) | null;
  /** 打印按钮文案 */
  printLabel?: string;
}

const A4DocumentPreviewModal: React.FC<A4DocumentPreviewModalProps> = ({
  title,
  subtitle,
  html,
  loading,
  error,
  onClose,
  onPrint,
  printLabel = '打印',
}) => {
  // A4 纸张等比缩放：视窗宽 / 794px（96dpi 下 210mm），封顶 1（放大超出纸宽无意义）
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || loading) return;
    const compute = () => {
      // 视窗左右各留 24px 呼吸边
      setScale(Math.min(1, Math.max(0.3, (el.clientWidth - 48) / 794)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  return (
    <div className="bds-modal-mask" onClick={() => !loading && onClose()}>
      <div
        className="bds-modal flex h-[92vh] max-h-[92vh] w-[min(68rem,94vw)] flex-col !p-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-c-default)] px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-light tracking-[0.02em] text-[var(--text-primary)]">
              {title}
            </h2>
            {subtitle && (
              <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">{subtitle}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onPrint !== null && onPrint && (
              <button
                type="button"
                disabled={loading}
                onClick={onPrint}
                className="bds-btn bds-btn-primary"
              >
                <Printer size={14} strokeWidth={1.75} />
                {printLabel}
              </button>
            )}
            <button type="button" onClick={onClose} className="bds-btn bds-btn-secondary">
              关闭
            </button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className="relative min-h-0 flex-1 overflow-auto rounded-b-[var(--r-modal)] bg-[var(--recessed-bg)]"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs font-light text-[var(--text-secondary)]">
              <Loader2 size={16} className="animate-spin" />
              正在生成预览...
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-4">
              <div className="bds-alert danger w-full">{error}</div>
            </div>
          ) : (
            <div className="flex justify-center px-6 py-5">
              {/* A4 逻辑宽 794px（96dpi 下 210mm）；scale 由视窗宽等比计算，纸张比例恒定 */}
              <div style={{ width: 794 * scale, height: 0 }} aria-hidden />
              <div
                style={{
                  width: 794,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top center',
                }}
              >
                <iframe
                  title={title}
                  srcDoc={html ?? ''}
                  sandbox=""
                  className="block border-0 bg-white"
                  style={{ width: 794, height: Math.ceil(1123 / Math.max(scale, 0.01)) }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border-c-default)] px-6 py-2.5 text-[10px] font-light text-[var(--text-secondary)]">
          <span>A4 · 210 × 297 mm</span>
          <span>{Math.round(scale * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

export default A4DocumentPreviewModal;
