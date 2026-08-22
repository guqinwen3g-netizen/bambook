/**
 * Packing List 装箱单 — 服务端单据模板（2026-08-22 B1 架构底座：首个从前端迁移的真源模板）。
 *
 * 模板真源裁决：服务端统一。本函数为 PL 唯一渲染真源——前端 EXPORT_DOC_RENDERERS.PL
 * 将在 B6 退役；数据装配真源在 shipping/documentSetService（单一回退链）。
 * 版式：doc-* 基座（templates/docPrintBase.ts），与发票/合同同一气质。
 */

import { esc } from '../docPrintBase';
import type { ServerDocumentSetData } from './types';

/** 出口方档案（与 DEFAULT_EXPORTER_PROFILE 同构） */
export interface DocExporterProfile {
  nameEn: string;
  addressEn: string;
  beneficiary?: string;
  bankName?: string;
  swiftCode?: string;
  bankAddress?: string;
  usdAccountNumber?: string;
}

// ── 共用辅助（与前端 renderPackingListHtml 同语义迁移） ──

const linesToHtml = (text: string | null | undefined): string =>
  text ? String(text).split(/\r?\n/).map(esc).join('<br>') : '';

const dash = (v: string | null | undefined): string => (v ? esc(v) : '—');

const fmtQty = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  const fixed = n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  return Number(fixed).toLocaleString('en-US');
};

const fmtW = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const fmtVol = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

const formatDate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 默认唛头（数据模型无唛头字段时的通用占位） */
function shippingMarks(data: ServerDocumentSetData): string {
  const po = data.order?.poNumber;
  const dest = data.shipment.portOfDischarge;
  const pkgs = data.totals.cartons ?? data.shipment.totalPackages;
  if (!po && !dest) return 'N/M';
  return [po, dest ? `${dest}` : null, pkgs ? `C/NO. 1-${pkgs}` : null].filter(Boolean).map(esc).join('<br>');
}

function partyBlock(label: string, name: string | null | undefined, address?: string | null, contact?: string | null): string {
  return `
  <div class="doc-party">
    <div class="label">${esc(label)}</div>
    <div class="name">${name ? esc(name) : '—'}</div>
    <div class="detail">
      ${address ? linesToHtml(address) + '<br>' : ''}
      ${contact ? 'Attn: ' + esc(contact) : ''}
    </div>
  </div>`;
}

function exporterBlock(label: string, exporter: DocExporterProfile): string {
  return `
  <div class="doc-party">
    <div class="label">${esc(label)}</div>
    <div class="name">${esc(exporter.nameEn)}</div>
    <div class="detail">${linesToHtml(exporter.addressEn)}</div>
  </div>`;
}

const resolvedInvoiceNo = (data: ServerDocumentSetData): string =>
  data.order?.invoiceNumber || `INV-${data.shipment.shipmentNumber}`;

const resolvedInvoiceDate = (data: ServerDocumentSetData): string =>
  data.order?.invoiceDate || formatDate(new Date());

/** PL 装箱单渲染（body 片段；经 buildServerDocument 组装完整文档） */
export function renderPackingListBody(data: ServerDocumentSetData, exporter: DocExporterProfile): string {
  const invoiceNo = resolvedInvoiceNo(data);
  const invoiceDate = resolvedInvoiceDate(data);

  const rows = data.lines.map((l) => `
    <tr>
      <td>${esc(l.description)}${l.productCode ? `<br><span style="color:#718096;font-size:10px">${esc(l.productCode)}</span>` : ''}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
      <td style="text-align:right">${l.cartons ?? '—'}</td>
      <td style="text-align:right">${fmtW(l.grossWeight)}</td>
      <td style="text-align:right">${fmtW(l.netWeight)}</td>
      <td style="text-align:right">${fmtVol(l.volume)}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>PACKING LIST</h1>
      <div class="subtitle">装箱单</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(invoiceNo)}</div>
      <div>Date: ${esc(invoiceDate)}</div>
      ${data.order?.poNumber ? `<div>P/O No.: ${esc(data.order.poNumber)}</div>` : ''}
      ${data.shipment.customsDeclarationNumber ? `<div>报关单号: ${esc(data.shipment.customsDeclarationNumber)}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('Shipper / Exporter 发货人', exporter)}
    ${partyBlock('Consignee 收货人', data.parties.consignee?.name, data.parties.consignee?.address, data.parties.consignee?.contact)}
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Shipment 运输信息</div>
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>Vessel/Voyage 船名航次</strong></td>
          <td style="width:25%">${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + esc(data.shipment.voyageNumber) : ''}</td>
          <td style="width:25%"><strong>Container/Seal 柜号/封号</strong></td>
          <td style="width:25%">${dash(data.shipment.containerNumber)} / ${dash(data.shipment.sealNumber)}</td>
        </tr>
        <tr>
          <td><strong>From 起运港</strong></td>
          <td>${dash(data.shipment.portOfLoading)}</td>
          <td><strong>To 目的港</strong></td>
          <td>${dash(data.shipment.portOfDischarge)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Packing Details 装箱明细</div>
    <table class="doc-table">
      <thead>
        <tr><th>Marks &amp; Nos.</th></tr>
      </thead>
      <tbody><tr><td>${shippingMarks(data)}</td></tr></tbody>
    </table>
    <table class="doc-table">
      <thead>
        <tr>
          <th>Description 品名</th>
          <th style="text-align:right">Quantity 数量</th>
          <th style="text-align:right">Cartons 箱数</th>
          <th style="text-align:right">G.W. (KGS)</th>
          <th style="text-align:right">N.W. (KGS)</th>
          <th style="text-align:right">Meas. (CBM)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td>TOTAL 合计</td>
          <td style="text-align:right">${fmtQty(data.totals.quantity)}</td>
          <td style="text-align:right">${data.totals.cartons ?? '—'}</td>
          <td style="text-align:right">${fmtW(data.totals.grossWeight)}</td>
          <td style="text-align:right">${fmtW(data.totals.netWeight)}</td>
          <td style="text-align:right">${fmtVol(data.totals.volume)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">For and on behalf of ${esc(exporter.nameEn)} (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
  </div>`;
}
