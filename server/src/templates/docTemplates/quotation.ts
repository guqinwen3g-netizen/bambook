/**
 * Quotation 报价单 — 服务端单据模板（2026-08-22 B7 报价单服务端化）。
 *
 * 架构裁决：
 *   - 模板真源服务端（docTemplates/ 注册表体系），与 PO/IR 同一真源回链模式：
 *     数据真源=Quotation 业务实时装配（不复制进版本快照）——文档号=quotationNumber，
 *     改业务侧即改文档，重新生成文件幂等覆盖
 *   - sourceRef=Quotation.id，单据中心登记归档（domain=quotation）
 *   - 前端 QuotationManager 的 buildQuotationPrintHtml 同构迁移退役（B7 起渲染真源服务端）
 *   - 行级图片（REQ2-12 DR-053）：imageUrl 相对路径在装配时解析为绝对 URL——
 *     preview.html 同源可直接用，PDF 管线（page.setContent 无基址）必须绝对路径
 */

import { PrismaClient } from '@prisma/client';
import { esc } from '../docPrintBase';
import type { DocExporterProfile } from './packingList';

// ────────────────────────────────────────────────────────────────
// 数据形状（loadQuotationDocData 装配输出）
// ────────────────────────────────────────────────────────────────

export interface QuotationDocLine {
  lineNumber: number;
  fabricCode: string | null;
  description: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number | null;
  notes: string | null;
  /** 绝对 URL（PDF 渲染要求；外链保持原样） */
  imageUrl: string | null;
}

export interface QuotationDocData {
  qt: {
    id: string;
    quotationNumber: string;
    status: string;
    currency: string;
    totalAmount: number;
    issueDate: string;
    validUntil: string | null;
    deliveryTerms: string | null;
    paymentTerms: string | null;
    salesperson: string | null;
    inquiryRef: string | null;
    notes: string | null;
    customerName: string | null;
    customerCode: string | null;
  };
  lines: QuotationDocLine[];
}

// ────────────────────────────────────────────────────────────────
// 数据装配（业务真源实时读取）
// ────────────────────────────────────────────────────────────────

/**
 * 相对图片 URL → 绝对 URL（PDF 渲染管线 page.setContent 无基址，相对路径必挂）。
 * BAMBOOK_PUBLIC_BASE_URL 显式配置优先；兜底本机主 API 端口（与 knowledgeDocumentsRoute 同约定）。
 */
function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.BAMBOOK_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8081}`)
    .trim()
    .replace(/\/$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * 按 Quotation.id 装配文档数据（含行明细）。
 * 单据不存在/软删返回 null（调用方 404）。
 */
export async function loadQuotationDocData(prisma: PrismaClient, quotationId: string): Promise<QuotationDocData | null> {
  const qt = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  if (!qt || qt.deletedAt) return null;

  return {
    qt: {
      id: qt.id,
      quotationNumber: qt.quotationNumber,
      status: qt.status,
      currency: qt.currency,
      totalAmount: Number(qt.totalAmount),
      issueDate: qt.issueDate,
      validUntil: qt.validUntil,
      deliveryTerms: qt.deliveryTerms,
      paymentTerms: qt.paymentTerms,
      salesperson: qt.salesperson,
      inquiryRef: qt.inquiryRef,
      notes: qt.notes,
      customerName: qt.customerName,
      customerCode: qt.customerCode,
    },
    lines: qt.lines.map(l => ({
      lineNumber: l.lineNumber,
      fabricCode: l.fabricCode,
      description: l.description,
      quantity: l.quantity != null ? Number(l.quantity) : null,
      unit: l.unit,
      unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
      amount: l.amount != null ? Number(l.amount) : null,
      notes: l.notes,
      imageUrl: resolveImageUrl(l.imageUrl),
    })),
  };
}

// ────────────────────────────────────────────────────────────────
// 渲染（body 片段；经 buildServerDocument 组装）
// ────────────────────────────────────────────────────────────────

const money = (v: number | null, currency: string): string =>
  v == null ? '—' : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const qty = (v: number | null): string =>
  v == null ? '—' : Number(v).toLocaleString('en-US');

const dash = (v: string | null | undefined): string => (v ? esc(v) : '—');

/** 报价单渲染（body 片段，中英文对照——与 B7 前端版式同构迁移） */
export function renderQuotationBody(data: QuotationDocData, exporter: DocExporterProfile): string {
  const { qt } = data;
  const cur = qt.currency || 'USD';

  // 行级图片（REQ2-12 DR-053-③）：有图行嵌入缩略图；无图行不渲染图片列——版式向后兼容
  const hasAnyImage = data.lines.some(l => l.imageUrl);
  const imageCell = (url: string | null) => url
    ? `<img src="${esc(url)}" alt="" style="width:54px;height:54px;object-fit:contain;border:1px solid #e2e8f0;border-radius:4px" />`
    : '<span style="display:inline-block;width:54px;height:54px"></span>';

  const rows = data.lines.map(l => `
    <tr>
      <td style="text-align:center">${l.lineNumber}</td>
      ${hasAnyImage ? `<td>${imageCell(l.imageUrl)}</td>` : ''}
      <td>${esc([l.fabricCode, l.description].filter(Boolean).join(' · '))}${l.notes ? `<div style="color:#718096;font-size:10px">${esc(l.notes)}</div>` : ''}</td>
      <td style="text-align:right">${qty(l.quantity)}</td>
      <td>${esc(l.unit)}</td>
      <td style="text-align:right">${l.unitPrice == null ? '—' : Number(l.unitPrice).toFixed(4)}</td>
      <td style="text-align:right">${money(l.amount, cur)}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>QUOTATION</h1>
      <div class="subtitle">报 价 单</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(qt.quotationNumber)}</div>
      <div>Date 报价日期: ${esc(qt.issueDate)}</div>
      ${qt.validUntil ? `<div>Valid Until 有效期至: ${esc(qt.validUntil)}</div>` : ''}
      ${qt.inquiryRef ? `<div>Inquiry Ref 询价参考: ${esc(qt.inquiryRef)}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    <div class="doc-party">
      <div class="label">From 报价方</div>
      <div class="name">${esc(exporter.nameEn)}</div>
      ${qt.salesperson ? `<div class="detail">Sales 业务员: ${esc(qt.salesperson)}</div>` : ''}
    </div>
    <div class="doc-party">
      <div class="label">To 致客户</div>
      <div class="name">${dash(qt.customerName)}</div>
      ${qt.customerCode ? `<div class="detail">Code 客户编码: ${esc(qt.customerCode)}</div>` : ''}
    </div>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Quotation Lines 报价明细</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th style="text-align:center">No.<br/>序号</th>
          ${hasAnyImage ? '<th style="width:62px">Photo 图片</th>' : ''}
          <th>Description 品名描述</th>
          <th style="text-align:right">Qty 数量</th>
          <th>Unit 单位</th>
          <th style="text-align:right">Unit Price 单价 (${esc(cur)})</th>
          <th style="text-align:right">Amount 金额 (${esc(cur)})</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="${hasAnyImage ? 6 : 5}">TOTAL 总计 (${esc(cur)})</td>
          <td style="text-align:right">${money(qt.totalAmount, cur)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Terms &amp; Conditions 条款</div>
    <div style="font-size:11px;line-height:1.8">
      ${qt.deliveryTerms ? `<div><strong>Delivery 交货:</strong> ${esc(qt.deliveryTerms)}</div>` : ''}
      ${qt.paymentTerms ? `<div><strong>Payment 付款:</strong> ${esc(qt.paymentTerms)}</div>` : ''}
      ${qt.validUntil ? `<div><strong>Validity 有效期:</strong> ${esc(qt.issueDate)} ~ ${esc(qt.validUntil)}</div>` : ''}
    </div>
  </div>

  ${qt.notes ? `
  <div class="doc-notes">
    <div class="notes-title">Remarks 备注</div>
    ${esc(qt.notes)}
  </div>` : ''}

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">Seller's Signature 卖方签章</div>
      <div class="sig-line">&nbsp;</div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Buyer's Confirmation 买方确认</div>
      <div class="sig-line">&nbsp;</div>
    </div>
  </div>`;
}
