/**
 * 共享文档打印工具
 * 在新窗口中写入 HTML 并触发浏览器打印（Electron 中即打印为 PDF）
 * 适用于装箱单、合同等文档生成场景
 */

import { bdsToast } from '../ui/bdsToast';

/**
 * 全站单据打印样式基座（doc-* 类体系）。
 * ⚠️ 双端同步纪律：与服务端 finance/route.ts DOC_PRINT_BASE_STYLES 同源副本，
 *    任一侧修改必须同步另一侧。发票/合同/装箱单/CI 全部单据统一此气质。
 */
export const BASE_PRINT_STYLES = `
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

/**
 * 组装完整打印文档（body 片段 + 基座样式 → 完整 HTML 文档）。
 * 与财务发票 preview.html（服务端自组装）同构：单据中心「生成文件」
 * 把组装结果交服务端 renderHtmlToPdf 落盘归档（模板真源在前端渲染器）。
 *
 * screen=true → 打印预览模式（与财务 preview.html screenShell 同构）：
 * 灰底画布 + A4 纸张（.paper 210mm 固定纸宽 + 阴影 + @media print 还原），
 * 所见即所得——预览排版与落盘 PDF 一致。
 */
export function buildFullPrintDocument(htmlBody: string, extraStyles = '', opts: { screen?: boolean } = {}): string {
  const screenStyles = opts.screen
    ? `
    body { background: #525659; display: block; padding: 24px 0; text-align: center; }
    .paper {
      width: 210mm; min-height: 297mm; padding: 40px 48px;
      background: #fff; color: #1a202c; margin: 0 auto; text-align: left;
      box-shadow: 0 2px 12px rgba(0,0,0,.35);
      display: inline-block;
      break-after: page;
    }
    .paper + .paper { margin-top: 16px; }
    @media print { body { background: #fff; padding: 0; } .paper { box-shadow: none; display: block; margin: 0; } }
  `
    : '';
  const paperOpen = opts.screen ? '<div class="paper">' : '';
  const paperClose = opts.screen ? '</div>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_PRINT_STYLES}${extraStyles}${screenStyles}${opts.screen ? 'body { padding: 0 !important; }' : ''}</style></head><body>${paperOpen}${htmlBody}${paperClose}</body></html>`;
}

/**
 * 打印一份完整的 HTML 文档（自带 <!doctype>/<style> 的服务端同源模板，
 * 如财务发票 preview.html）。与 printHtmlDocument（body 片段 + 基座样式）互补。
 */
export function printFullHtmlDocument(html: string, title: string): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    bdsToast.danger('无法打开打印窗口，请检查浏览器弹窗拦截设置。');
    return;
  }
  const doc = html.replace(/<\/head>/i, `<title>${title}</title></head>`);
  win.document.write(doc);
  win.document.close();
  win.onload = () => { setTimeout(() => { try { win.print(); } catch { /* 窗口已被用户关闭 */ } }, 300); };
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
