/**
 * Consolidated Packing List 合并装箱单 — 组合文档模板（2026-08-22 B3 多选叠加生成）。
 *
 * 架构裁决：
 *   - 多对一数据聚合（非 PDF 拼页）：多运单数据在装配层合并为单一数据集，
 *     单张 A4 文档呈现——lines 重编行号、totals 跨运单重算、每行标注来源运单
 *   - 组合文档是即时性汇总产物，不登记 TradeDocument（无单一业务真源可回链），
 *     预览/生成走 composite 端点流式输出
 *   - 版式：doc-* 基座，与单运单 PL 同一气质（header 增加 Consolidated 标识 + 运单一览）
 */

import { esc } from '../docPrintBase';
import type { DocExporterProfile } from './packingList';
import type { ServerDocumentSetData, ServerDocumentSetLine } from './types';

// ────────────────────────────────────────────────────────────────
// 数据形状（compositeDocumentService.assembleMergedDocumentSet 输出）
// ────────────────────────────────────────────────────────────────

export interface MergedDocumentSetLine extends ServerDocumentSetLine {
  /** 来源运单序号（1 起，对应 shipments 下标+1） */
  shipmentIndex: number;
}

export interface MergedDocumentSetData {
  /** 参与合并的运单（装配顺序） */
  shipments: ServerDocumentSetData['shipment'][];
  /** 各运单关联订单（与 shipments 同序，可空） */
  orders: Array<ServerDocumentSetData['order'] | null>;
  parties: ServerDocumentSetData['parties'];
  lines: MergedDocumentSetLine[];
  totals: ServerDocumentSetData['totals'];
  missing: string[];
}

// ────────────────────────────────────────────────────────────────
// 渲染（body 片段；经 buildServerDocument 组装）
// ────────────────────────────────────────────────────────────────

const linesToHtml = (text: string | null | undefined): string =>
  text ? String(text).split(/\r?\n/).map(esc).join('<br>') : '';

const dash = (v: string | null | undefined): string => (v ? esc(v) : '—');

const fmtQty = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  return Number(n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)).toLocaleString('en-US');
};

const fmtW = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtVol = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function exporterBlock(label: string, exporter: DocExporterProfile): string {
  return `
  <div class="doc-party">
    <div class="label">${esc(label)}</div>
    <div class="name">${esc(exporter.nameEn)}</div>
    <div class="detail">${linesToHtml(exporter.addressEn)}</div>
  </div>`;
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

const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 合并装箱单渲染（body 片段） */
export function renderMergedPackingListBody(data: MergedDocumentSetData, exporter: DocExporterProfile): string {
  const shipmentCount = data.shipments.length;

  // 运单一览表（每运单号/船名/起运-目的港/件毛净体）
  const shipmentRows = data.shipments.map((s, i) => {
    const order = data.orders[i];
    return `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td class="mono">${esc(s.shipmentNumber)}</td>
      <td>${dash(order?.poNumber)}</td>
      <td>${dash(s.vesselOrFlight)}${s.voyageNumber ? ' ' + esc(s.voyageNumber) : ''}</td>
      <td>${dash(s.portOfLoading)} → ${dash(s.portOfDischarge)}</td>
      <td style="text-align:right">${fmtQty(s.totalPackages)}</td>
      <td style="text-align:right">${fmtW(s.grossWeight)}</td>
      <td style="text-align:right">${fmtVol(s.volume)}</td>
    </tr>`;
  }).join('');

  // 合并明细（每行标注来源运单号；行号 1..n 重编）
  const rows = data.lines.map((l, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td class="mono" style="color:#718096;font-size:10px">${esc(data.shipments[l.shipmentIndex - 1]?.shipmentNumber ?? '—')}</td>
      <td>${esc(l.description)}${l.productCode ? `<br><span style="color:#718096;font-size:10px">${esc(l.productCode)}</span>` : ''}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
      <td style="text-align:right">${l.cartons ?? '—'}</td>
      <td style="text-align:right">${fmtW(l.grossWeight)}</td>
      <td style="text-align:right">${fmtW(l.netWeight)}</td>
      <td style="text-align:right">${fmtVol(l.volume)}</td>
    </tr>`).join('');

  // 合并唛头：各运单 PO + 目的港 + 连续箱号
  const marksHtml = data.shipments.map((s, i) => {
    const po = data.orders[i]?.poNumber;
    const dest = s.portOfDischarge;
    const pkgs = s.totalPackages;
    if (!po && !dest) return null;
    return [po, dest ? String(dest) : null, pkgs ? `C/NO. 1-${pkgs}` : null]
      .filter(Boolean).map(esc).join('<br>');
  }).filter(Boolean).join('<br>') || 'N/M';

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>PACKING LIST</h1>
      <div class="subtitle">装箱单（Consolidated · ${shipmentCount} Shipments 合并）</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">CONSOLIDATED</div>
      <div>Date: ${today()}</div>
      <div>Shipments: ${shipmentCount}</div>
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('Shipper / Exporter 发货人', exporter)}
    ${partyBlock('Consignee 收货人', data.parties.consignee?.name, data.parties.consignee?.address, data.parties.consignee?.contact)}
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Shipments 运单一览（${shipmentCount}）</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th style="text-align:center">#</th>
          <th>Shipment No. 运单号</th>
          <th>P/O No.</th>
          <th>Vessel / Voyage 船名航次</th>
          <th>Route 航线</th>
          <th style="text-align:right">Packages 件数</th>
          <th style="text-align:right">G.W. (KGS)</th>
          <th style="text-align:right">Meas. (CBM)</th>
        </tr>
      </thead>
      <tbody>${shipmentRows}</tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Marks &amp; Nos. 唛头</div>
    <table class="doc-table">
      <tbody><tr><td>${marksHtml}</td></tr></tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Consolidated Packing Details 合并装箱明细</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th style="text-align:center">#</th>
          <th>Shipment 来源运单</th>
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
          <td colspan="3">TOTAL 合计（${shipmentCount} 运单）</td>
          <td style="text-align:right">${fmtQty(data.totals.quantity)}</td>
          <td style="text-align:right">${data.totals.cartons ?? '—'}</td>
          <td style="text-align:right">${fmtW(data.totals.grossWeight)}</td>
          <td style="text-align:right">${fmtW(data.totals.netWeight)}</td>
          <td style="text-align:right">${fmtVol(data.totals.volume)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  ${data.missing.length > 0 ? `
  <div class="doc-notes">
    <div class="notes-title">Data Notice 数据提示</div>
    ${data.missing.map(esc).join('；')}
  </div>` : ''}

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">For and on behalf of ${esc(exporter.nameEn)} (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
  </div>`;
}
