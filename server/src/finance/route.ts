/**
 * 财务管理 API — /api/v1/finance
 *
 * 由 scaffold-module.ts 生成于 2026-06-15T00:39:31.882Z.
 * 生成器只搭骨架，业务校验/字段白名单/审计需要人工补全。
 *
 * 契约钩子（来自 docs/MODULE_CONTRACT.md）：
 *   - L2.2 输入校验：在每个 mutation 入口加 zod / 手写白名单
 *   - L3.1 EntityLink 同步：mutation 必须调用 syncFinanceReferences
 *   - L4 审批：高风险 mutation 默认走 manifest.safety.approval=required
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { logger } from '../lib/logger';
import { Prisma, PrismaClient } from '@prisma/client';
import { renderHtmlToPdf } from '../templates/pdf';
import { syncInvoiceReferences, syncPaymentVoucherReferences } from '../entities/sync';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';
import { cancelInvoice, cancelVoucher, deleteInvoice, deleteVoucher } from './voidDeleteService';
import { recalcInvoiceStatus, recalcVoucherStatus, validateAllocationInput, syncAllocationVoucherLinks, applyAllocation, listInvoiceAllocations } from './allocationService';
import { createAllocation, updateAllocation, deleteAllocation } from './allocationMutationService';
import { validateStatusTransition } from '../statusTransition';
import { createPaymentVoucher, updatePaymentVoucher } from './paymentVoucherMutationService';
import { createInvoice, updateInvoice } from './invoiceMutationService';
import { getAgingReport, getCustomerStatement, getSupplierStatement, getFxGainLoss, getConsolidatedProfitReport, getCashCalendar } from './reportService';
import { createDunningService } from './dunningService';
import { createFxSettlement, deleteFxSettlement, getFxLedger, getVoucherSettlementSummary } from './fxSettlementService';
import { createOutwardRemittance, deleteOutwardRemittance, getVoucherRemittanceSummary, listOutwardRemittances } from './outwardRemittanceService';
import { createVatInvoice, updateVatInvoice, transitionVatInvoiceStatus, deleteVatInvoice, listVatInvoices, getVatInvoice } from './vatInvoiceService';
import { getSystemConfigService } from '../config/systemConfigService';
import { DEFAULT_EXPORTER_PROFILE, EXPORTER_PROFILE_CONFIG_KEY } from '../config/systemConfigRoute';

/** 发票附件上传根目录（与静态服务根同源：BAMBOOK_UPLOAD_DIR 或 apps/Bambook/uploads——
 *  index.ts 静态服务 /api/uploads 的根；本文件在 server/src/finance/ 下需三级回溯） */
const FINANCE_UPLOAD_DIR = process.env.BAMBOOK_UPLOAD_DIR || path.join(__dirname, '../../../uploads');

function ensureDir(p: string): void { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

const money = (v: any, currency: string | null = '') => `${v == null ? '0.00' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** 发票单据渲染上下文（loadInvoiceDoc 装配） */
interface InvoiceDoc {
  invoice: any;
  allocs: Array<any>;
  exporter: { nameEn: string; addressEn: string; beneficiary: string; bankName: string; swiftCode: string; bankAddress: string; usdAccountNumber: string };
  relation: any | null;
  /** orderId → 订单（贸易条款/付款条款/ShipTo） */
  ordersById: Map<string, any>;
  /** orderId → 订单行明细（无行时缺省） */
  linesByOrder: Map<string, any[]>;
  /** 分配订单关联的出运单（装运信息：船名/港口/件数/毛净重） */
  shipment: any | null;
}

/** 英文金额大写（CI "SAY TOTAL" 行；与前端 exportDocumentTemplates.amountInWords 同算法，支持到 billion） */
function amountInWords(amount: number, currency: string | null): string {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const scales: Array<[number, string]> = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']];
  const twoDigits = (n: number): string => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? '-' + ones[n % 10] : ''}`);
  const threeDigits = (n: number): string => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return `${h ? ones[h] + ' HUNDRED' : ''}${h && rest ? ' AND ' : ''}${rest ? twoDigits(rest) : ''}`.trim();
  };
  let intPart = Math.floor(amount);
  const cents = Math.round((amount - intPart) * 100);
  const parts: string[] = [];
  for (const [scale, label] of scales) {
    if (intPart >= scale) {
      parts.push(`${threeDigits(Math.floor(intPart / scale))} ${label}`);
      intPart %= scale;
    }
  }
  if (intPart > 0) parts.push(threeDigits(intPart));
  const intWords = parts.join(' ').replace(/\s+/g, ' ').trim() || 'ZERO';
  const currencyName = currency === 'USD' ? 'US DOLLARS' : currency === 'EUR' ? 'EUROS' : currency === 'CNY' ? 'CHINESE YUAN' : (currency || '');
  const centsWords = cents > 0 ? ` AND CENTS ${twoDigits(cents)}` : '';
  return `SAY TOTAL ${currencyName} ${intWords}${centsWords} ONLY`.replace(/\s+/g, ' ').trim();
}

/**
 * 全站单据打印样式基座（2026-08-21 架构裁决：一份样式，所有单据）。
 * ⚠️ 双端同步纪律：与前端 components/tools/printDocument.ts BASE_PRINT_STYLES 同源副本，
 *    任一侧修改必须同步另一侧。发票/合同/装箱单/CI 全部单据统一此气质。
 */
const DOC_PRINT_BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1a202c; background: #fff; padding: 40px; font-size: 12px; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a202c; padding-bottom: 16px; margin-bottom: 24px; }
  .doc-title-block h1 { font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }
  .doc-title-block .subtitle { font-size: 11px; color: #718096; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase; }
  .doc-meta { text-align: right; font-size: 11px; color: #4a5568; line-height: 1.7; }
  .doc-meta .doc-no { font-size: 13px; font-weight: 600; color: #1a202c; }
  .doc-party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .doc-party { font-size: 11px; }
  .doc-party .label { font-size: 9px; text-transform: uppercase; color: #a0aec0; letter-spacing: 1px; margin-bottom: 4px; }
  .doc-party .name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .doc-party .detail { color: #4a5568; line-height: 1.5; }
  table.doc-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
  table.doc-table thead th { background: #f7fafc; color: #4a5568; font-weight: 600; text-align: left; padding: 8px 10px; border-bottom: 2px solid #cbd5e0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  table.doc-table tbody td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; color: #2d3748; }
  table.doc-table tbody tr:nth-child(even) { background: #fafafa; }
  table.doc-table tfoot td { padding: 10px; border-top: 2px solid #cbd5e0; font-weight: 600; text-align: right; }
  .doc-section { margin-bottom: 20px; }
  .doc-section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #a0aec0; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
  .doc-totals { margin-left: auto; width: 280px; font-size: 11px; }
  .doc-totals .total-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
  .doc-totals .total-row.grand { font-size: 14px; font-weight: 700; border-top: 2px solid #1a202c; border-bottom: none; padding-top: 10px; margin-top: 4px; }
  .doc-footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .doc-signature { font-size: 11px; }
  .doc-signature .sig-label { color: #718096; margin-bottom: 24px; }
  .doc-signature .sig-line { border-top: 1px solid #4a5568; padding-top: 4px; }
  .doc-signature .sig-name { font-weight: 600; margin-top: 2px; }
  .doc-notes { font-size: 10px; color: #718096; margin-top: 16px; line-height: 1.6; }
  .doc-notes .notes-title { text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; color: #a0aec0; }
`;

/**
 * 发票单据模板——doc-* 基座体系（2026-08-21 统一裁决：与合同/装箱单/出运 CI 同一版式基因）。
 * 结构：doc-header（标题+编号组）→ doc-party-grid 双方栏（名称/地址/税号/联系人）→
 * Shipment & Terms 条款组（doc-table 标签-内容式）→ 货品明细 doc-table → 合计+金额大写 →
 * 收款银行 → doc-footer 双签章（sig 三段式）→ E&OE 尾注。
 *  screen=true 供浏览器预览端点（/:id/preview.html）：A4 纸张画布（.paper 210mm 宽）。
 */
function invoicePdfHtml(doc: InvoiceDoc, opts: { screen?: boolean } = {}): string {
  const { invoice, allocs, exporter, relation, ordersById, linesByOrder, shipment } = doc;
  const isProforma = invoice.type === 'Proforma';
  const isPayable = invoice.type === 'Payable';
  const titleEn = isProforma ? 'PROFORMA INVOICE' : isPayable ? 'INVOICE' : 'COMMERCIAL INVOICE';
  const titleZh = isProforma ? '形式发票' : isPayable ? '应付发票' : '商业发票';
  const currency = invoice.currency || '';

  // 交易双方（吸收合同模板结构：名称 + 地址 + 税号 + 联系人）：
  // 应收/形式发票 我方为卖方；应付发票 对方为卖方（我方采购）
  const buyerName = relation?.englishName || relation?.name || invoice.customerName || '';
  const partyDetail = (detail: string, extra?: string): string =>
    `${detail ? esc(detail).replace(/\n/g, '<br>') : ''}${extra ? `<br>${extra}` : ''}`;
  const exporterDetail = partyDetail(exporter.addressEn);
  const relationContact = relation
    ? [
        relation.primaryContactName ? `Contact: ${relation.primaryContactName}` : '',
        relation.primaryContactEmail ? `Email: ${relation.primaryContactEmail}` : '',
      ].filter(Boolean).join('<br>')
    : '';
  const relationDetail = partyDetail(relation?.contactInfo || '', relationContact || undefined);
  const seller = isPayable
    ? { name: buyerName || '—', detail: relationDetail }
    : { name: exporter.nameEn, detail: exporterDetail };
  const buyer = isPayable
    ? { name: exporter.nameEn, detail: exporterDetail }
    : { name: buyerName || '—', detail: relationDetail };

  const partyBlock = (label: string, p: { name: string; detail: string }): string => `
    <div class="doc-party">
      <div class="label">${esc(label)}</div>
      <div class="name">${esc(p.name)}</div>
      ${p.detail ? `<div class="detail">${p.detail}</div>` : ''}
    </div>`;

  // 订单/PO 引用行（多订单合并开票）
  const poRefs = (allocs ?? []).map(a => a.poNumber).filter(Boolean);
  const orderRefs = (allocs ?? []).map(a => a.orderNumber).filter(Boolean);

  // ── 运输与条款（合同式标签-内容表）：从订单/出运单聚合 ──
  const primaryOrder = (allocs ?? []).length ? ordersById.get(allocs[0].orderId) : null;
  const anyOrder = primaryOrder || [...ordersById.values()][0] || null;
  const terms = anyOrder?.deliveryTerms || null;
  const paymentTerms = anyOrder?.paymentTerms || null;
  const shipTo = anyOrder?.shipToName
    ? [anyOrder.shipToName, anyOrder.shipToAddress1, anyOrder.shipToAddress2, anyOrder.shipToCountry].filter(Boolean).join(', ')
    : null;
  const vessel = shipment?.vesselOrFlight ? `${shipment.vesselOrFlight}${shipment.voyageNumber ? ' / ' + shipment.voyageNumber : ''}` : null;
  const pol = shipment?.portOfLoading || null;
  const pod = shipment?.portOfDischarge || null;
  const etd = shipment?.atd || shipment?.etd || null;
  const pkgs = shipment?.totalPackages ?? null;
  const gwt = shipment?.grossWeight ?? null;
  const nwt = shipment?.netWeight ?? null;
  const termRow = (label: string, value: string | null): string =>
    value ? `<tr><td style="padding:6px 0;width:150px;color:#718096;vertical-align:top">${esc(label)}</td><td style="padding:6px 0">${esc(value)}</td></tr>` : '';
  const shipmentRows = [
    termRow('Terms of Delivery 贸易条款', terms),
    termRow('Terms of Payment 付款方式', paymentTerms),
    termRow('Country of Origin 原产国', 'CHINA'),
    termRow('Vessel / Voyage 船名航次', vessel),
    termRow('Port of Loading 装货港', pol),
    termRow('Port of Discharge 目的港', pod),
    termRow('ETD 离港日', etd),
    pkgs != null ? termRow('Packages 件数', `${pkgs} CTNS`) : '',
    (gwt != null || nwt != null)
      ? termRow('Gross / Net Weight 毛重/净重', `${gwt != null ? `${Number(gwt).toLocaleString('en-US', { maximumFractionDigits: 3 })} KGS` : '—'} / ${nwt != null ? `${Number(nwt).toLocaleString('en-US', { maximumFractionDigits: 3 })} KGS` : '—'}`)
      : '',
    termRow('Ship To 收货地', shipTo),
  ].filter(Boolean).join('');
  const shipmentGroup = shipmentRows ? `
    <div class="doc-section">
      <div class="doc-section-title">Shipment &amp; Terms 运输与条款</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">${shipmentRows}</table>
    </div>` : '';

  // 货品明细：任一分配订单有行明细 → 分组行明细；无分配时空态占位（禁止 TOTAL 悬空）
  const hasLines = (allocs ?? []).some(a => (linesByOrder.get(a.orderId) || []).length > 0);
  let goodsRows: string;
  if (hasLines) {
    goodsRows = (allocs ?? []).map((a) => {
      const lines = linesByOrder.get(a.orderId) || [];
      const head = `
        <tr style="background:#f7fafc"><td colspan="4" style="font-weight:600;color:#4a5568">Order ${esc(a.orderNumber ?? a.orderId)}${a.poNumber ? ` &nbsp;·&nbsp; P/O ${esc(a.poNumber)}` : ''}</td></tr>`;
      const rows = lines.map((l: any) => `
        <tr>
          <td>${esc(l.itemNo ? `${l.itemNo} ` : '')}${esc(l.description || '')}</td>
          <td style="text-align:right">${l.quantity != null ? `${Number(l.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 })}${l.unit ? ' ' + esc(l.unit) : ''}` : '—'}</td>
          <td style="text-align:right">${l.unitPrice != null ? Number(l.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td>
          <td style="text-align:right">${l.netValue != null ? money(l.netValue, null) : '—'}</td>
        </tr>`).join('');
      return head + rows;
    }).join('');
  } else if ((allocs ?? []).length) {
    goodsRows = (allocs ?? []).map((a) => `
        <tr>
          <td>Order ${esc(a.orderNumber ?? a.orderId)}${a.poNumber ? ` · P/O ${esc(a.poNumber)}` : ''}</td>
          <td style="text-align:right">—</td>
          <td style="text-align:right">—</td>
          <td style="text-align:right">${a.allocatedAmount != null ? money(a.allocatedAmount, null) : money(invoice.amount, null)}</td>
        </tr>`).join('');
  } else {
    goodsRows = `
        <tr><td colspan="4" style="color:#a0aec0;font-style:italic;text-align:center;padding:70px 10px">— No order lines allocated. 请在发票详情中分配订单后生成货品明细 —</td></tr>`;
  }

  const amountNum = Number(invoice.amount == null ? 0 : invoice.amount);

  // 收款银行：应收/形式发票（我方收款）展示受益人银行；应付发票无对手方银行数据则省略
  const bankBlock = !isPayable ? `
    <div class="doc-section">
      <div class="doc-section-title">Beneficiary Bank 收款银行</div>
      <div class="doc-party" style="font-size:11px">
        <div class="detail">
          Beneficiary: ${esc(exporter.beneficiary)}<br>
          Bank: ${esc(exporter.bankName)}<br>
          Address: ${esc(exporter.bankAddress)}<br>
          SWIFT: ${esc(exporter.swiftCode)}<br>
          A/C No.: ${esc(exporter.usdAccountNumber)}
        </div>
      </div>
    </div>` : '';

  // screen 预览 = 固定 A4 纸张画布（.paper 210mm 宽，多页自动分页）；
  // PDF 渲染走无画布裸文档（renderHtmlToPdf 的 A4 + 12mm margin 自行分页）。
  const screenShell = opts.screen
    ? `<style>
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
    </style><div class="paper">`
    : '';
  const screenShellEnd = opts.screen ? '</div>' : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_PRINT_BASE_STYLES}
    ${opts.screen ? `
    /* screen 模式覆盖基座 body padding（纸张自带内边距） */
    body { padding: 0 !important; }
    ` : ''}
  </style></head><body>
    ${screenShell}
    <div class="doc-header">
      <div class="doc-title-block">
        <h1>${titleEn}</h1>
        <div class="subtitle">${titleZh}</div>
      </div>
      <div class="doc-meta">
        <div class="doc-no">${esc(invoice.invoiceNumber)}</div>
        <div>Date: ${esc(invoice.issueDate ?? '—')}</div>
        ${invoice.dueDate ? `<div>Due: ${esc(invoice.dueDate)}</div>` : ''}
        <div>ORIGINAL</div>
      </div>
    </div>

    <div class="doc-party-grid">
      ${partyBlock('Seller / Exporter 卖方', seller)}
      ${partyBlock('Buyer / Consignee 买方', buyer)}
    </div>

    ${(orderRefs.length || poRefs.length) ? `
    <div class="doc-notes" style="margin-top:0;margin-bottom:16px">
      ${orderRefs.length ? `<div><b>Order No.:</b> ${esc(orderRefs.join(' / '))}</div>` : ''}
      ${poRefs.length ? `<div><b>P/O No.:</b> ${esc(poRefs.join(' / '))}</div>` : ''}
    </div>` : ''}

    ${shipmentGroup}

    <table class="doc-table">
      <thead><tr><th>Description of Goods 品名</th><th style="text-align:right">Quantity 数量</th><th style="text-align:right">Unit Price 单价${currency ? ` (${esc(currency)})` : ''}</th><th style="text-align:right">Amount 金额${currency ? ` (${esc(currency)})` : ''}</th></tr></thead>
      <tbody>${goodsRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:right">TOTAL 合计</td>
          <td>${money(invoice.amount, null)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="doc-notes">
      <div class="notes-title">Amount in Words 金额大写</div>
      <div style="color:#1a202c;font-size:11px">${esc(amountInWords(amountNum, invoice.currency))}</div>
    </div>

    ${bankBlock}

    ${invoice.notes ? `<div class="doc-notes"><div class="notes-title">Remarks 备注</div><div>${esc(invoice.notes).replace(/\n/g, '<br>')}</div></div>` : ''}

    <div class="doc-footer">
      <div class="doc-signature">
        <div class="sig-label">For ${esc(seller.name)} (签章)</div>
        <div class="sig-line" style="margin-top:36px"></div>
        <div class="sig-name">${esc(seller.name)}</div>
        <div style="font-size:10px;color:#718096;margin-top:2px">Authorized Signature / Date</div>
      </div>
      <div class="doc-signature">
        <div class="sig-label">For Buyer 买方确认 (签章)</div>
        <div class="sig-line" style="margin-top:36px"></div>
        <div class="sig-name">${esc(buyer.name)}</div>
        <div style="font-size:10px;color:#718096;margin-top:2px">Confirmed by / Date</div>
      </div>
    </div>

    <div class="doc-notes" style="margin-top:20px">
      E. &amp; O. E. · ${esc(titleEn)} · ${esc(invoice.invoiceNumber)}
    </div>
    ${screenShellEnd}
  </body></html>`;
}

/** 装配发票单据上下文（发票 + 订单分配 + 出口商档案 + 交易对手 + 订单 + 订单行明细 + 出运单）；发票不存在/已删返回 null */
async function loadInvoiceDoc(prisma: PrismaClient, id: string): Promise<InvoiceDoc | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice || invoice.deletedAt) return null;
  const allocs = await (prisma as any).invoiceOrderAllocation.findMany({ where: { invoiceId: invoice.id, deletedAt: null }, orderBy: { createdAt: 'asc' } }) || [];
  // 出口商档案：SystemConfig 真源（30s TTL 缓存）→ 默认值兜底；读取失败不阻断单据渲染
  let exporter: InvoiceDoc['exporter'] = { ...DEFAULT_EXPORTER_PROFILE };
  try {
    const found = await getSystemConfigService(prisma).get(EXPORTER_PROFILE_CONFIG_KEY);
    if (found?.value && typeof found.value === 'object') {
      exporter = { ...DEFAULT_EXPORTER_PROFILE, ...(found.value as object) } as InvoiceDoc['exporter'];
    }
  } catch { /* 配置读取失败走默认档案 */ }
  // 交易对手档案（买方/供应商名称与联系地址）
  let relation: any = null;
  if (invoice.customerRelationId) {
    try { relation = await (prisma as any).relation.findUnique({ where: { id: invoice.customerRelationId } }); } catch { /* 快照字段兜底 invoice.customerName */ }
  }
  // 分配订单（贸易/付款条款、ShipTo 快照）+ 订单行明细（分组展示）
  const orderIds = allocs.map((a: any) => a.orderId).filter(Boolean);
  const ordersById = new Map<string, any>();
  const linesByOrder = new Map<string, any[]>();
  if (orderIds.length) {
    try {
      const orders = await (prisma as any).order.findMany({ where: { id: { in: orderIds }, deletedAt: null } }) || [];
      for (const o of orders) ordersById.set(o.id, o);
    } catch { /* 订单查询失败条款组隐藏 */ }
    try {
      const lines = await (prisma as any).orderLine.findMany({ where: { orderId: { in: orderIds } }, orderBy: { orderId: 'asc', lineNumber: 'asc' } }) || [];
      for (const l of lines) {
        const arr = linesByOrder.get(l.orderId) || [];
        arr.push(l);
        linesByOrder.set(l.orderId, arr);
      }
    } catch { /* 行明细查询失败退化到分配行 */ }
  }
  // 分配订单关联出运单（首条，装运信息：船名/港口/件数/毛净重）
  let shipment: any = null;
  if (orderIds.length) {
    try {
      shipment = await (prisma as any).shipment.findFirst({ where: { orderId: { in: orderIds }, deletedAt: null } });
    } catch { /* 出运单查询失败装运组隐藏 */ }
  }
  return { invoice, allocs, exporter, relation, ordersById, linesByOrder, shipment };
}

/**
 * 供单据中心 generate-file 复用：财务发票单据 HTML（CI 唯一真源模板，
 * 非 screen 裸文档——与 GET /:id/render.pdf 同一份渲染）。
 * 发票不存在/已删返回 null。
 */
export async function renderInvoiceDocumentHtml(prisma: PrismaClient, invoiceId: string): Promise<string | null> {
  const doc = await loadInvoiceDoc(prisma, invoiceId);
  return doc ? invoicePdfHtml(doc) : null;
}

export interface FinanceRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

type FinanceCreateInput = {
  invoiceNumber: string;
  type: string;
  status?: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  notes?: string;
  attachments?: any;
};

type VoucherCreateInput = {
  voucherNumber: string;
  type: string;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethod: string;
  status?: string; // task_mqxwgafj: unreconciled|partially_reconciled|reconciled
  bankFee?: number;
  exchangeRate?: number;
  baseCurrency?: string;
  invoiceId?: string;
  appliedAmount?: number;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  notes?: string;
  attachments?: any;
};

/** Whitelisted fields for PATCH updates on Invoice */
const INVOICE_PATCH_FIELDS = [
  'type', 'status', 'amount', 'currency', 'issueDate', 'dueDate',
  'exchangeRate', 'baseCurrency', 'orderId', 'customerRelationId',
  'customerName', 'notes', 'attachments',
] as const;

/** Whitelisted fields for PATCH updates on PaymentVoucher */
const VOUCHER_PATCH_FIELDS = [
  'type', 'amount', 'currency', 'paymentDate', 'paymentMethod', 'bankFee',
  'exchangeRate', 'baseCurrency', 'invoiceId', 'appliedAmount',
  'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments',
] as const;

function pickFields(body: Record<string, any>, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

function serializeFinanceValue<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeFinanceValue) as T;
  if (value && typeof value === 'object') {
    // instanceof 判定（constructor.name 在打包压缩后不可靠）；与 index.ts 全局
    // Decimal.prototype.toJSON=Number 补丁对齐 —— GET 直出路径金额均为 number，
    // 此处统一序列化契约为 number，避免创建/更新响应与列表响应类型分裂。
    if (value instanceof Prisma.Decimal) return Number(value) as T;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = serializeFinanceValue(item as any);
    return out as T;
  }
  return value;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * DR-044 净额口径：按 InvoiceAllocation 真源批量汇总已核销金额。
 * 列表响应附派生字段 appliedAmount（已核销合计）/ openAmount（未结清余额 =
 * 单据金额 − 已核销），KPI/账龄/对账单跨模块同口径，不消费可能过期的
 * PaymentVoucher.appliedAmount 快照（DR-045：快照仅为向后兼容展示）。
 */
async function attachAllocationDerivedFields(
  prisma: PrismaClient,
  items: any[],
  scope: 'invoice' | 'voucher',
): Promise<any[]> {
  if (items.length === 0) return items;
  const ids = items.map(i => i.id);
  const allocSums = await (prisma as any).invoiceAllocation.groupBy({
    by: [scope === 'invoice' ? 'invoiceId' : 'voucherId'],
    where: scope === 'invoice' ? { invoiceId: { in: ids } } : { voucherId: { in: ids } },
    _sum: { appliedAmount: true },
  });
  const appliedMap = new Map<string, number>(
    allocSums.map((a: any) => [
      scope === 'invoice' ? a.invoiceId : a.voucherId,
      a._sum.appliedAmount != null ? Number(a._sum.appliedAmount) : 0,
    ]),
  );
  return items.map(item => {
    const applied = appliedMap.get(item.id) ?? 0;
    return { ...item, appliedAmount: round4(applied), openAmount: round4(Number(item.amount) - applied) };
  });
}

export function createFinanceRouter(options: FinanceRouterOptions): Router {
  const { prisma, onDataChange, requireAuth, apiKeys } = options;
  const router = Router();

  // Shared auth guard: JWT or API-key (restored — was silently dropped by scaffold)
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager', 'finance'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const dunningService = createDunningService(prisma);

  // High-risk role guard: owner/admin/manager only

  // GET /api/v1/finance — list / search
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const where: any = { deletedAt: null };
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.orderId) where.orderId = String(req.query.orderId);
    if (req.query.customerRelationId) where.customerRelationId = String(req.query.customerRelationId);
    if (req.query.customer) where.customerName = { contains: String(req.query.customer), mode: 'insensitive' };
    if (req.query.search) {
      const q = String(req.query.search);
      const qInsensitive = { contains: q, mode: 'insensitive' };
      where.OR = [{ invoiceNumber: qInsensitive }, { customerName: qInsensitive }];
    }
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      prisma.invoice.count({ where }),
    ]);
    // DR-044 净额口径：附 appliedAmount/openAmount（InvoiceAllocation 真源派生）
    const itemsWithOpen = await attachAllocationDerivedFields(prisma, items as any[], 'invoice');
    res.json({ items: serializeFinanceValue(itemsWithOpen), total });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance — create (high risk, approval upstream)
  router.post('/', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createInvoice({
      prisma,
      input: req.body as FinanceCreateInput,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STATUS: 400, INVALID_TRANSITION: 400, INVALID_CURRENT_STATUS: 400, INVALID_AMOUNT: 400, INVALID_VOUCHER_CATEGORY: 400, CREATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const created = result.data!.invoice;
    onDataChange?.({ entity: 'finance', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // ────────────────────────────────────────────────────────────────
  // 收付款凭证（PaymentVoucher） — /api/v1/finance/vouchers
  // ⚠️ 字面路由 /vouchers 必须在参数路由 /:id 之前，否则 Express 会
  //    把 /vouchers 匹配到 /:id（id='vouchers'）导致 404。
  // ────────────────────────────────────────────────────────────────

  // GET /api/v1/finance/vouchers — list / search
  router.get('/vouchers', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const where: any = { deletedAt: null };
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.orderId) where.orderId = String(req.query.orderId);
    if (req.query.invoiceId) where.invoiceId = String(req.query.invoiceId);
    if (req.query.customer) where.customerName = { contains: String(req.query.customer), mode: 'insensitive' };
    if (req.query.search) {
      const q = String(req.query.search);
      const qInsensitive = { contains: q, mode: 'insensitive' };
      where.OR = [{ voucherNumber: qInsensitive }, { customerName: qInsensitive }];
    }
    const [items, total] = await Promise.all([
      (prisma as any).paymentVoucher.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      (prisma as any).paymentVoucher.count({ where }),
    ]);
    // DR-044 净额口径：附 appliedAmount/openAmount（InvoiceAllocation 真源派生）
    const itemsWithOpen = await attachAllocationDerivedFields(prisma, items as any[], 'voucher');
    res.json({ items: serializeFinanceValue(itemsWithOpen), total });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/vouchers/:id
  router.get('/vouchers/:id', async (req: Request, res: Response) => {
    try {
      const item = await (prisma as any).paymentVoucher.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '收付款凭证不存在' } });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/vouchers — create (high risk, approval upstream)
  router.post('/vouchers', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    // task ERP-P1-payment-voucher-mutation-shared-service-foundation: route 只调用 service
    const result = await createPaymentVoucher({
      prisma,
      input: req.body as VoucherCreateInput,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STATUS: 400, INVALID_AMOUNT: 400, CREATE_FAILED: 500 };
      const error = result.error;
      res.status(statusCodeMap[error.code] || 500).json({ error });
      return;
    }
    const created = result.data!.voucher;
    onDataChange?.({ entity: 'finance.vouchers', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // PATCH /api/v1/finance/vouchers/:id
  router.patch('/vouchers/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    // task ERP-P1-payment-voucher-mutation-shared-service-foundation: route 只调用 service
    const result = await updatePaymentVoucher({
      prisma,
      voucherId: req.params.id,
      input: req.body as any,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STATUS: 400, INVALID_AMOUNT: 400, INVALID_VOUCHER_CATEGORY: 400, NOT_FOUND: 404, STATUS_NOT_MANUAL_SETTABLE: 400, UPDATE_FAILED: 500 };
      const error = result.error;
      res.status(statusCodeMap[error.code] || 500).json({ error });
      return;
    }
    const updated = result.data!.voucher;
    onDataChange?.({ entity: 'finance.vouchers', action: 'update', ids: [updated.id] });
    res.json(serializeFinanceValue(updated));
  });


  // ────────────────────────────────────────────────────────────────
  // 收付款核销明细（InvoiceAllocation） — /api/v1/finance/allocations
  // task ERP-P1-payment-allocation-route-foundation
  // 业务写入 + status 重算 + AuditLog 同事务闭环（fail closed）
  // ────────────────────────────────────────────────────────────────

  // task ERP-P1: DELETE /vouchers/:id — Voucher 软删（调 voidDeleteService，allocation 阻断）
  // POST /api/v1/finance/vouchers/:id/cancel — cancel (void) voucher
  router.post('/vouchers/:id/cancel', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await cancelVoucher({
      prisma,
      voucherId: req.params.id,
      actorId: actorIdFromRequest(req),
      reason: req.body?.reason,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { VOUCHER_NOT_FOUND: 404, HAS_ALLOCATIONS: 400, INVALID_STATUS: 400, CANCEL_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    res.json({ ok: true, voucher: result.data!.voucher });
  });

  router.delete('/vouchers/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const result = await deleteVoucher({
        prisma, voucherId: req.params.id, actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, INVALID_STATUS: 400, HAS_ALLOCATIONS: 409, CANCEL_FAILED: 500, DELETE_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'finance', action: 'delete_voucher', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('[finance] DELETE /vouchers/:id failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/allocations — list/query
  router.get('/allocations', async (req: Request, res: Response) => {
    try {
      const { items, total } = await listInvoiceAllocations(prisma, {
        invoiceId: req.query.invoiceId ? String(req.query.invoiceId) : undefined,
        voucherId: req.query.voucherId ? String(req.query.voucherId) : undefined,
        limit: Number(req.query.limit) || 200,
      });
      res.json({ items, total });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/allocations — create（apply voucher to invoice）
  router.post('/allocations', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createAllocation({ prisma, input: req.body, actorId: actorIdFromRequest(req), ip: req.ip || null });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { MISSING_INVOICE: 400, MISSING_VOUCHER: 400, MISSING_AMOUNT: 400, INVALID_AMOUNT: 400, INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, NOT_FOUND: 404, CONFLICT: 409, CREATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const allocId = result.data!.allocation.id;
    onDataChange?.({ entity: 'finance.allocations', action: 'create', ids: [allocId] });
    res.status(201).json(result.data);
  });

  // PATCH /api/v1/finance/allocations/:id — update + status 重算
  router.patch('/allocations/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await updateAllocation({ prisma, allocationId: req.params.id, input: req.body, actorId: actorIdFromRequest(req), ip: req.ip || null });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_AMOUNT: 400, NOT_FOUND: 404, CONFLICT: 409, UPDATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.allocations', action: 'update', ids: [req.params.id] });
    res.json(result.data);
  });

  // DELETE /api/v1/finance/allocations/:id — delete（撤销核销）+ status 反向重算
  router.delete('/allocations/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteAllocation({ prisma, allocationId: req.params.id, actorId: actorIdFromRequest(req), ip: req.ip || null });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, CONFLICT: 409, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.allocations', action: 'delete', ids: [req.params.id] });
    res.json(result.data);
  });

  // ────────────────────────────────────────────────────────────────
  // 结汇水单（FxSettlement） — /api/v1/finance/fx-settlements
  // 阶段 F / F2 外汇核销闭环：收汇凭证 → 结汇 → 台账
  // ⚠️ 字面路由 /fx-settlements 必须在参数路由 /:id 之前注册。
  // ────────────────────────────────────────────────────────────────

  // GET /api/v1/finance/fx-settlements/ledger — 外汇台账（只读聚合）
  router.get('/fx-settlements/ledger', async (req: Request, res: Response) => {
    try {
      const ledger = await getFxLedger(prisma, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(serializeFinanceValue(ledger));
    } catch (err: any) {
      logger.error('[finance] GET /fx-settlements/ledger failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'LEDGER_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/fx-settlements — list / search
  router.get('/fx-settlements', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const where: any = { deletedAt: null };
      if (req.query.voucherId) where.voucherId = String(req.query.voucherId);
      if (req.query.orderId) where.orderId = String(req.query.orderId);
      if (req.query.customerRelationId) where.customerRelationId = String(req.query.customerRelationId);
      if (req.query.currency) where.currency = String(req.query.currency);
      if (req.query.from) where.settleDate = { ...(where.settleDate || {}), gte: String(req.query.from) };
      if (req.query.to) where.settleDate = { ...(where.settleDate || {}), lte: String(req.query.to) };
      const [items, total] = await Promise.all([
        (prisma as any).fxSettlement.findMany({ where, take: limit, skip: offset, orderBy: { settleDate: 'desc' } }),
        (prisma as any).fxSettlement.count({ where }),
      ]);
      res.json(serializeFinanceValue({ items, total }));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/fx-settlements/:id
  router.get('/fx-settlements/:id', async (req: Request, res: Response) => {
    try {
      const item = await (prisma as any).fxSettlement.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '结汇水单不存在' } });
      res.json(serializeFinanceValue(item));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/fx-settlements — create（核销校验 + cnyAmount 服务端计算）
  router.post('/fx-settlements', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createFxSettlement({
      prisma,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        INVALID_INPUT: 400, INVALID_AMOUNT: 400, INVALID_DATE: 400,
        VOUCHER_NOT_FOUND: 404, NOT_A_RECEIPT: 400, CNY_VOUCHER_NO_SETTLEMENT: 400,
        CURRENCY_MISMATCH: 400, OVER_SETTLEMENT: 409, CREATE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const created = result.data!.settlement;
    onDataChange?.({ entity: 'finance.fx-settlements', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // DELETE /api/v1/finance/fx-settlements/:id — 软删（回滚核销余额）
  router.delete('/fx-settlements/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteFxSettlement({
      prisma,
      settlementId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { SETTLEMENT_NOT_FOUND: 404, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.fx-settlements', action: 'delete', ids: [req.params.id] });
    res.json({ ok: true });
  });

  // GET /api/v1/finance/vouchers/:id/settlements — 凭证核销摘要（已结汇/余额/明细）
  router.get('/vouchers/:id/settlements', async (req: Request, res: Response) => {
    const result = await getVoucherSettlementSummary(prisma, req.params.id);
    if (!result.ok) {
      res.status(result.error!.code === 'VOUCHER_NOT_FOUND' ? 404 : 500).json({ error: result.error });
      return;
    }
    res.json(serializeFinanceValue(result.data));
  });

  // ────────────────────────────────────────────────────────────────
  // 付汇水单（OutwardRemittance） — /api/v1/finance/outward-remittances
  // 阶段 C6：付款凭证 → 购汇/自有外汇 → 境外付汇（镜像 fx-settlements 付款侧）
  // ⚠️ 字面路由必须在参数路由 /:id 之前注册。
  // ────────────────────────────────────────────────────────────────

  // GET /api/v1/finance/outward-remittances — list / search
  router.get('/outward-remittances', async (req: Request, res: Response) => {
    try {
      const result = await listOutwardRemittances(prisma, {
        voucherId: req.query.voucherId ? String(req.query.voucherId) : undefined,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(serializeFinanceValue(result));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/outward-remittances — create（余额校验 + cnyAmount 服务端计算）
  router.post('/outward-remittances', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createOutwardRemittance({
      prisma,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        INVALID_INPUT: 400, INVALID_AMOUNT: 400, INVALID_DATE: 400, INVALID_PURPOSE: 400,
        VOUCHER_NOT_FOUND: 404, NOT_A_DISBURSEMENT: 400, CNY_VOUCHER_NO_REMITTANCE: 400,
        CURRENCY_MISMATCH: 400, OVER_REMITTANCE: 409, CREATE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const created = result.data!.remittance;
    onDataChange?.({ entity: 'finance.outward-remittances', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // DELETE /api/v1/finance/outward-remittances/:id — 软删（回滚未付余额）
  router.delete('/outward-remittances/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteOutwardRemittance({
      prisma,
      remittanceId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { REMITTANCE_NOT_FOUND: 404, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.outward-remittances', action: 'delete', ids: [req.params.id] });
    res.json({ ok: true });
  });

  // GET /api/v1/finance/vouchers/:id/remittances — 凭证付汇摘要（已付汇/余额/明细）
  router.get('/vouchers/:id/remittances', async (req: Request, res: Response) => {
    const result = await getVoucherRemittanceSummary(prisma, req.params.id);
    if (!result.ok) {
      res.status(result.error!.code === 'VOUCHER_NOT_FOUND' ? 404 : 500).json({ error: result.error });
      return;
    }
    res.json(serializeFinanceValue(result.data));
  });

  // ────────────────────────────────────────────────────────────────
  // 增值税发票（VatInvoice） — /api/v1/finance/vat-invoices
  // 阶段 C6：专票全生命周期（收票→认证→申报退税→红冲/作废）
  // ────────────────────────────────────────────────────────────────

  // GET /api/v1/finance/vat-invoices — list / search
  router.get('/vat-invoices', async (req: Request, res: Response) => {
    try {
      const result = await listVatInvoices(prisma, {
        status: req.query.status ? String(req.query.status) : undefined,
        direction: req.query.direction ? String(req.query.direction) : undefined,
        relationId: req.query.relationId ? String(req.query.relationId) : undefined,
        taxRefundId: req.query.taxRefundId ? String(req.query.taxRefundId) : undefined,
        invoiceId: req.query.invoiceId ? String(req.query.invoiceId) : undefined,
        orderId: req.query.orderId ? String(req.query.orderId) : undefined,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(serializeFinanceValue(result));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/vat-invoices — create（金额三栏校验 + 查重）
  router.post('/vat-invoices', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createVatInvoice({
      prisma,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        INVALID_INPUT: 400, INVALID_AMOUNT: 400, INVALID_DATE: 400,
        AMOUNT_MISMATCH: 400, TAX_MISMATCH: 400,
        DUPLICATE_VAT_INVOICE: 409, CREATE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const created = result.data!.vatInvoice;
    onDataChange?.({ entity: 'finance.vat-invoices', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // GET /api/v1/finance/vat-invoices/:id
  router.get('/vat-invoices/:id', async (req: Request, res: Response) => {
    const result = await getVatInvoice(prisma, req.params.id);
    if (!result.ok) {
      res.status(result.error!.code === 'NOT_FOUND' ? 404 : 500).json({ error: result.error });
      return;
    }
    res.json(serializeFinanceValue(result.data.vatInvoice));
  });

  // PATCH /api/v1/finance/vat-invoices/:id — 票面修正（Declared/RedFlushed/Cancelled 不可改）
  router.patch('/vat-invoices/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await updateVatInvoice({
      prisma,
      vatInvoiceId: req.params.id,
      patch: req.body ?? {},
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        NOT_FOUND: 404, INVALID_STATUS: 409, INVALID_INPUT: 400, INVALID_AMOUNT: 400,
        INVALID_DATE: 400, AMOUNT_MISMATCH: 400, TAX_MISMATCH: 400, UPDATE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.vat-invoices', action: 'update', ids: [req.params.id] });
    res.json(serializeFinanceValue(result.data!.vatInvoice));
  });

  // POST /api/v1/finance/vat-invoices/:id/transition — 状态机（认证/申报退税/红冲/作废）
  router.post('/vat-invoices/:id/transition', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await transitionVatInvoiceStatus({
      prisma,
      vatInvoiceId: req.params.id,
      input: req.body ?? {},
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        NOT_FOUND: 404, INVALID_STATUS: 400, INVALID_TRANSITION: 409, INVALID_DATE: 400,
        NOT_INPUT_SPECIAL: 400, TAX_REFUND_REQUIRED: 400, TAX_REFUND_NOT_FOUND: 404,
        TRANSITION_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.vat-invoices', action: 'transition', ids: [req.params.id] });
    res.json(serializeFinanceValue(result.data!.vatInvoice));
  });

  // DELETE /api/v1/finance/vat-invoices/:id — 软删（Declared 禁删，仅可红冲）
  router.delete('/vat-invoices/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteVatInvoice({
      prisma,
      vatInvoiceId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, DELETE_FORBIDDEN: 409, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.vat-invoices', action: 'delete', ids: [req.params.id] });
    res.json({ ok: true });
  });

  // task ERP-P1: POST /:id/cancel — Invoice 作废（调 voidDeleteService）
  router.post('/:id/cancel', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const result = await cancelInvoice({
        prisma, invoiceId: req.params.id,
        actorId: actorIdFromRequest(req), reason: req.body?.reason,
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, INVALID_STATUS: 400, HAS_ALLOCATIONS: 409, CANCEL_FAILED: 500, DELETE_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'finance', action: 'cancel', ids: [req.params.id] });
      res.json({ ok: true, invoice: result.data!.invoice });
    } catch (err: any) {
      logger.error('[finance] POST /:id/cancel failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'CANCEL_FAILED', message: err.message } });
    }
  });

  // task ERP-P1: DELETE /:id — Invoice 软删（调 voidDeleteService，allocation 阻断）
  router.delete('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const result = await deleteInvoice({
        prisma, invoiceId: req.params.id, actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, INVALID_STATUS: 400, HAS_ALLOCATIONS: 409, CANCEL_FAILED: 500, DELETE_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'finance', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('[finance] DELETE /:id failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: err.message } });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // REQ2-08 催款函套件 — /api/v1/finance/dunning（DR-050）
  // 字面路由 /dunning 须在参数路由 /:id 之前注册。
  // ────────────────────────────────────────────────────────────────

  // POST /api/v1/finance/dunning/letter — 中英催款函生成（账龄明细注入，只读预览）
  router.post('/dunning/letter', async (req: Request, res: Response) => {
    const result = await dunningService.buildLetter((req.body ?? {}) as any);
    if (!result.ok) {
      return res.status(result.error.status).json({ error: { code: result.error.code, message: result.error.message } });
    }
    return res.json({ ok: true, ...result.data });
  });

  // POST /api/v1/finance/dunning — 登记催款记录（快照留痕）
  router.post('/dunning', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await dunningService.recordDunning((req.body ?? {}) as any);
    if (!result.ok) {
      return res.status(result.error.status).json({ error: { code: result.error.code, message: result.error.message } });
    }
    return res.status(201).json({ ok: true, record: result.data.record });
  });

  // GET /api/v1/finance/dunning?customerRelationId=|customerName= — 催款历史
  router.get('/dunning', async (req: Request, res: Response) => {
    const result = await dunningService.listDunning({
      customerRelationId: req.query.customerRelationId ? String(req.query.customerRelationId) : undefined,
      customerName: req.query.customerName ? String(req.query.customerName) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    if (!result.ok) {
      return res.status(result.error.status).json({ error: { code: result.error.code, message: result.error.message } });
    }
    return res.json({ ok: true, ...result.data });
  });

  // ────────────────────────────────────────────────────────────────
  // 财务报表（只读） — /api/v1/finance/reports
  // ⚠️ 字面路由 /reports 必须在参数路由 /:id 之前注册。
  // ────────────────────────────────────────────────────────────────

  // GET /api/v1/finance/reports/aging?type=Receivable|Payable&asOf=YYYY-MM-DD
  router.get('/reports/aging', async (req: Request, res: Response) => {
    try {
      const type = String(req.query.type ?? 'Receivable');
      if (type !== 'Receivable' && type !== 'Payable') {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'type 必须为 Receivable 或 Payable' } });
      }
      const report = await getAgingReport(prisma, { type, asOf: req.query.asOf ? String(req.query.asOf) : undefined });
      res.json(report);
    } catch (err: any) {
      logger.error('[finance] GET /reports/aging failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'REPORT_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/reports/statement?customerRelationId=xx&from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/reports/statement', async (req: Request, res: Response) => {
    try {
      const customerRelationId = String(req.query.customerRelationId ?? '');
      if (!customerRelationId) {
        return res.status(400).json({ error: { code: 'MISSING_CUSTOMER', message: 'customerRelationId is required' } });
      }
      const report = await getCustomerStatement(prisma, {
        customerRelationId,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(report);
    } catch (err: any) {
      logger.error('[finance] GET /reports/statement failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'REPORT_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/reports/supplier-statement?supplierRelationId=xx&from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/reports/supplier-statement', async (req: Request, res: Response) => {
    try {
      const supplierRelationId = String(req.query.supplierRelationId ?? '');
      if (!supplierRelationId) {
        return res.status(400).json({ error: { code: 'MISSING_SUPPLIER', message: 'supplierRelationId is required' } });
      }
      const report = await getSupplierStatement(prisma, {
        supplierRelationId,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(report);
    } catch (err: any) {
      logger.error('[finance] GET /reports/supplier-statement failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'REPORT_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/reports/fx-gain-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/reports/fx-gain-loss', async (req: Request, res: Response) => {
    try {
      const report = await getFxGainLoss(prisma, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(report);
    } catch (err: any) {
      logger.error('[finance] GET /reports/fx-gain-loss failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'REPORT_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/reports/cash-calendar?asOf=YYYY-MM-DD&days=30 — REQ2-02 资金日历
  router.get('/reports/cash-calendar', async (req: Request, res: Response) => {
    try {
      const report = await getCashCalendar(prisma, {
        asOf: req.query.asOf ? String(req.query.asOf) : undefined,
        days: req.query.days ? Number(req.query.days) : undefined,
      });
      res.json(report);
    } catch (err: any) {
      logger.error('[finance] GET /reports/cash-calendar failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'REPORT_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/reports/consolidated-profit — DR-005/DR-033 公司合并视图（抵销内部交易）
  // 支持 ?from=&to= 按订单日期（Order.poDate）过滤报表范围，响应回显 from/to 元数据
  router.get('/reports/consolidated-profit', async (req: Request, res: Response) => {
    try {
      const from = typeof req.query.from === 'string' && req.query.from.trim() ? req.query.from.trim() : undefined;
      const to = typeof req.query.to === 'string' && req.query.to.trim() ? req.query.to.trim() : undefined;
      const report = await getConsolidatedProfitReport(prisma, { from, to });
      res.json(report);
    } catch (err: any) {
      logger.error('[finance] GET /reports/consolidated-profit failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'REPORT_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/:id — 必须放在 /vouchers 字面路由之后
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const item = await prisma.invoice.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '发票不存在' } });
      // DR：发票 ↔ 订单 多对多——附带该发票的订单分配列表（含订单号/PO 快照）
      const orderAllocations = await (prisma as any).invoiceOrderAllocation.findMany({
        where: { invoiceId: item.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      res.json({
        ...serializeFinanceValue(item),
        orderAllocations: (orderAllocations ?? []).map((a: any) => ({
          id: a.id, orderId: a.orderId, orderNumber: a.orderNumber ?? null,
          poNumber: a.poNumber ?? null, allocatedAmount: a.allocatedAmount != null ? Number(a.allocatedAmount) : null, note: a.note ?? null,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/:id/render.pdf — 导出发票 PDF（CI 级模板：买卖双方/货品明细/金额大写/收款银行）
  router.get('/:id/render.pdf', async (req: Request, res: Response) => {
    try {
      const doc = await loadInvoiceDoc(prisma, req.params.id);
      if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '发票不存在' } });
      const pdf = await renderHtmlToPdf(invoicePdfHtml(doc), { format: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.invoice.invoiceNumber}.pdf"`);
      res.send(pdf.pdf);
    } catch (err: any) {
      logger.error('[finance] GET /:id/render.pdf failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'PDF_FAILED', message: err?.message || String(err) } });
    }
  });

  // GET /api/v1/finance/:id/preview.html — 发票预览（与 render.pdf 同源 HTML + screen 页边距，所见即所得）
  router.get('/:id/preview.html', async (req: Request, res: Response) => {
    try {
      const doc = await loadInvoiceDoc(prisma, req.params.id);
      if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '发票不存在' } });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(invoicePdfHtml(doc, { screen: true }));
    } catch (err: any) {
      logger.error('[finance] GET /:id/preview.html failed', { error: err?.message || String(err) });
      res.status(500).json({ error: { code: 'PREVIEW_FAILED', message: err?.message || String(err) } });
    }
  });

  // POST /api/v1/finance/:id/attachments — 上传真实发票文件（multer 落盘 uploads/invoices/），登记 Invoice.attachments
  const invoiceAttachmentUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => { const dir = path.join(FINANCE_UPLOAD_DIR, 'invoices'); ensureDir(dir); cb(null, dir); },
      filename: (_req, file, cb) => { cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname) || '.pdf'}`); },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb: any) => {
      const ok = /\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i.test(file.originalname);
      cb(ok ? null : new Error('UNSUPPORTED_FILE_TYPE'), ok);
    },
  });
  router.post('/:id/attachments', invoiceAttachmentUpload.single('file'), async (req: any, res: Response) => {
    try {
      const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
      if (!invoice || invoice.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '发票不存在' } });
      if (!req.file) return res.status(400).json({ error: { code: 'INVALID_FILE', message: 'file 必填' } });
      const url = `/api/uploads/invoices/${req.file.filename}`;
      const prev = Array.isArray(invoice.attachments) ? invoice.attachments : [];
      const next = [...prev, { fileName: req.file.originalname, url, mimeType: req.file.mimetype, fileSize: req.file.size, uploadedAt: new Date().toISOString() }];
      await prisma.invoice.update({ where: { id: invoice.id }, data: { attachments: next as any, updatedAt: BigInt(Date.now()) } });
      onDataChange?.({ entity: 'finance', action: 'update', ids: [invoice.id] });
      res.status(201).json({ ok: true, attachment: next[next.length - 1] });
    } catch (e: any) {
      logger.error('[finance] POST /:id/attachments failed', { error: e?.message || String(e) });
      res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: e?.message || String(e) } });
    }
  });

  // PATCH /api/v1/finance/:id
  router.patch('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await updateInvoice({
      prisma,
      invoiceId: req.params.id,
      input: req.body as any,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 400, INVALID_TRANSITION: 400, INVALID_CURRENT_STATUS: 400, INVALID_AMOUNT: 400, STATUS_NOT_MANUAL_SETTABLE: 400, UPDATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const updated = result.data!.invoice;
    onDataChange?.({ entity: 'finance', action: 'update', ids: [updated.id] });
    res.json(serializeFinanceValue(updated));
  });

  return router;
}
