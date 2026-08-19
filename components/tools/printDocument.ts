/**
 * 共享文档打印工具
 * 在新窗口中写入 HTML 并触发浏览器打印（Electron 中即打印为 PDF）
 * 适用于装箱单、合同等文档生成场景
 */

import { bdsToast } from '../ui/bdsToast';

const BASE_PRINT_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #1a202c;
    background: #fff;
    padding: 40px;
    font-size: 12px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1a202c;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .doc-title-block h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  .doc-title-block .subtitle {
    font-size: 11px;
    color: #718096;
    margin-top: 4px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .doc-meta {
    text-align: right;
    font-size: 11px;
    color: #4a5568;
  }
  .doc-meta .doc-no {
    font-size: 13px;
    font-weight: 600;
    color: #1a202c;
  }
  .doc-section {
    margin-bottom: 20px;
  }
  .doc-section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #a0aec0;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-party-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 20px;
  }
  .doc-party {
    font-size: 11px;
  }
  .doc-party .label {
    font-size: 9px;
    text-transform: uppercase;
    color: #a0aec0;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .doc-party .name {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }
  .doc-party .detail {
    color: #4a5568;
    line-height: 1.5;
  }
  table.doc-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
    font-size: 11px;
  }
  table.doc-table thead th {
    background: #f7fafc;
    color: #4a5568;
    font-weight: 600;
    text-align: left;
    padding: 8px 10px;
    border-bottom: 2px solid #cbd5e0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table.doc-table tbody td {
    padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    color: #2d3748;
  }
  table.doc-table tbody tr:nth-child(even) {
    background: #fafafa;
  }
  table.doc-table tfoot td {
    padding: 10px;
    border-top: 2px solid #cbd5e0;
    font-weight: 600;
    text-align: right;
  }
  .doc-totals {
    margin-left: auto;
    width: 280px;
    font-size: 11px;
  }
  .doc-totals .total-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-totals .total-row.grand {
    font-size: 14px;
    font-weight: 700;
    border-top: 2px solid #1a202c;
    border-bottom: none;
    padding-top: 10px;
    margin-top: 4px;
  }
  .doc-footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
  }
  .doc-signature {
    font-size: 11px;
  }
  .doc-signature .sig-label {
    color: #718096;
    margin-bottom: 24px;
  }
  .doc-signature .sig-line {
    border-top: 1px solid #4a5568;
    padding-top: 4px;
  }
  .doc-signature .sig-name {
    font-weight: 600;
    margin-top: 2px;
  }
  .doc-notes {
    font-size: 10px;
    color: #718096;
    margin-top: 16px;
    line-height: 1.6;
  }
  .doc-notes .notes-title {
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
    color: #a0aec0;
  }
  @media print {
    body { padding: 20px; }
    .no-print { display: none !important; }
  }
`;

export interface PrintDocumentOptions {
  title: string;
  htmlBody: string;
  extraStyles?: string;
}

/**
 * 在新窗口中打开 HTML 文档并触发打印。
 * Electron 环境下，用户可在打印对话框中选择"保存为 PDF"。
 */
export function printHtmlDocument({ title, htmlBody, extraStyles = '' }: PrintDocumentOptions): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    bdsToast.danger('无法打开打印窗口，请检查浏览器弹窗拦截设置。');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${BASE_PRINT_STYLES}${extraStyles}</style>
</head>
<body>
${htmlBody}
<script>
  window.onload = function() { setTimeout(function() { window.print(); }, 300); };
</script>
</body>
</html>`);
  win.document.close();
}

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 格式化数字（千分位 + 固定小数） */
export function formatDocNumber(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** 转义 HTML 特殊字符，防止注入 */
export function escapeHtml(text: string | undefined | null): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
