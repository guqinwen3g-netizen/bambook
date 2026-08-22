/**
 * Finance Invoice 财务发票模板 — 服务端单据模板（2026-08-22 B11 结构收编）。
 *
 * 架构裁决：
 *   - 财务 Invoice 是商业发票唯一真源（2026-08-21 裁决）；本模块从 finance/route.ts
 *     原位提取（invoicePdfHtml / loadInvoiceDoc / renderInvoiceDocumentHtml），
 *     消除「路由文件持模板」的结构性错位——模板归 docTemplates/ 注册表体系
 *   - 完整文档模板（自带 doc-* 头部样式 + screen A4 画布壳），与注册表
 *     body 片段模板（renderBody → buildServerDocument 组装）是两种形态；
 *     经注册表 FIN_CI kind 的 renderDocument 分发（统一入口）
 *   - 行为零变更：finance 路由 preview.html / render.pdf 与单据中心 CI 财务回链
 *     渲染路径输出与提取前逐字节一致
 */

import { PrismaClient } from '@prisma/client';
import { DOC_PRINT_BASE_STYLES, esc, money } from '../docPrintBase';
import { getSystemConfigService } from '../../config/systemConfigService';
import { DEFAULT_EXPORTER_PROFILE, EXPORTER_PROFILE_CONFIG_KEY } from '../../config/systemConfigRoute';
import { amountInWords } from './customsDocs';

/** 发票单据渲染上下文（loadInvoiceDoc 装配） */
export interface InvoiceDoc {
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

/**
 * 发票单据模板——doc-* 基座体系（2026-08-21 统一裁决：与合同/装箱单/出运 CI 同一版式基因）。
 * 结构：doc-header（标题+编号组）→ doc-party-grid 双方栏（名称/地址/税号/联系人）→
 * Shipment & Terms 条款组（doc-table 标签-内容式）→ 货品明细 doc-table → 合计+金额大写 →
 * 收款银行 → doc-footer 双签章（sig 三段式）→ E&OE 尾注。
 *  screen=true 供浏览器预览端点（/:id/preview.html）：A4 纸张画布（.paper 210mm 宽）。
 */
export function invoicePdfHtml(doc: InvoiceDoc, opts: { screen?: boolean } = {}): string {
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
export async function loadInvoiceDoc(prisma: PrismaClient, id: string): Promise<InvoiceDoc | null> {
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
 * 财务发票单据 HTML（CI 唯一真源模板）。
 * screen=true → A4 纸张画布预览模式（与 GET /:id/preview.html 同一份渲染）；
 * 默认裸文档（与 GET /:id/render.pdf 同一份）。发票不存在/已删返回 null。
 */
export async function renderFinanceInvoiceDocument(prisma: PrismaClient, invoiceId: string, opts: { screen?: boolean } = {}): Promise<string | null> {
  const doc = await loadInvoiceDoc(prisma, invoiceId);
  return doc ? invoicePdfHtml(doc, opts) : null;
}
