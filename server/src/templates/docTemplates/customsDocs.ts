/**
 * customs 域单据模板（CO / BL / INS）— 服务端真源（2026-08-22 B5 模板迁移）。
 *
 * 迁移裁决：前端 EXPORT_DOC_RENDERERS 的 CO/BL/INS 三类（有 TradeDocumentType 映射的）
 * 迁服务端注册表——模板真源统一服务端；前端渲染器保留为 501 回退兜底（B6 退役）。
 * FORMA/BC 无 TradeDocumentType 映射（仅运单文档集打印工具使用），暂留前端。
 * 版式与前端模板逐行同构迁移（doc-* 基座）。
 */

import { esc } from '../docPrintBase';
import type { DocExporterProfile } from './packingList';
import type { ServerDocumentSetData, ServerDocumentSetLine } from './types';

// ────────────────────────────────────────────────────────────────
// extras 形状（documentSetService 装配的扩展块）
// ────────────────────────────────────────────────────────────────

interface InsuranceExtras {
  insurer: string;
  insuredAmount: number | null;
  currency: string | null;
  premium: number | null;
  premiumCurrency: string | null;
  coverage: string;
}

interface LetterOfCreditExtras {
  lcNumber: string;
  issueBank: string | null;
  issueDate: string | null;
  applicant: string | null;
}

// ────────────────────────────────────────────────────────────────
// 共用辅助（与前端模板同语义迁移）
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

const fmtMoney = (n: number | null | undefined, currency: string | null): string => {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ' ' + esc(currency) : ''}`;
};

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  data.order?.invoiceDate || localToday();

const tradeTerms = (data: ServerDocumentSetData): string =>
  data.order?.deliveryTerms || data.customs?.tradeTerms || 'FOB SHANGHAI';

// ────────────────────────────────────────────────────────────────
// CO — Certificate of Origin 原产地证明书
// ────────────────────────────────────────────────────────────────

export function renderCertificateOfOriginBody(data: ServerDocumentSetData, exporter: DocExporterProfile): string {
  const origin = data.customs?.originCountry || data.lines.find(l => l.originCountry)?.originCountry || 'CHINA';
  const destination = data.customs?.destinationCountry || '';
  const transport = [
    data.shipment.shippingMethod ? `BY ${data.shipment.shippingMethod.toUpperCase() === 'SEA' ? 'SEA' : esc(data.shipment.shippingMethod.toUpperCase())}` : null,
    data.shipment.vesselOrFlight ? esc(data.shipment.vesselOrFlight) + (data.shipment.voyageNumber ? ' ' + esc(data.shipment.voyageNumber) : '') : null,
    data.shipment.portOfLoading && data.shipment.portOfDischarge ? `FROM ${esc(data.shipment.portOfLoading)} TO ${esc(data.shipment.portOfDischarge)}` : null,
  ].filter(Boolean).join(' / ') || '—';

  const rows = data.lines.map((l: ServerDocumentSetLine) => `
    <tr>
      <td>${l.cartons ?? '—'} CTNS</td>
      <td>${esc(l.description)}</td>
      <td>${dash(l.hsCode)}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>CERTIFICATE OF ORIGIN</h1>
      <div class="subtitle">原产地证明书</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">CO-${esc(data.shipment.shipmentNumber)}</div>
      <div>Date: ${esc(localToday())}</div>
      <div>Invoice No.: ${esc(resolvedInvoiceNo(data))}</div>
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('1. Exporter 出口商', exporter)}
    ${partyBlock('2. Consignee 收货人', data.parties.consignee?.name, data.parties.consignee?.address, data.parties.consignee?.contact)}
  </div>

  <div class="doc-section">
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:50%"><strong>3. Means of Transport and Route 运输方式及路线</strong><br>${transport}</td>
          <td style="width:50%"><strong>4. Country/Region of Destination 目的国</strong><br>${dash(destination)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">5. Marks &amp; Nos. 唛头</div>
    <div class="doc-party"><div class="detail">${shippingMarks(data)}</div></div>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">6/7/8. Packages, Description, HS Code, Quantity</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th>No. & Kind of Packages</th>
          <th>Description of Goods 品名</th>
          <th>HS Code</th>
          <th style="text-align:right">Quantity 数量</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Declaration 声明</div>
    <div class="doc-notes" style="color:#2d3748;font-size:11px">
      The undersigned hereby declares that the above details and statements are correct, that all the goods were produced in
      <strong>${esc(origin)}</strong> and that they comply with the origin requirements specified for those goods
      in the Generalized System of Preferences for goods exported to the importing country.
      <br><br>
      兹声明上述货物均产于<strong>${esc(origin === 'CHINA' ? '中华人民共和国' : origin)}</strong>，所列内容属实无误。
    </div>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">Declaration by the Exporter 出口商声明</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">${esc(exporter.nameEn)}</div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Certification 签证机构证明</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Issuing Authority (盖章)</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// BL — Bill of Lading 提单补料（Shipper 草稿）
// ────────────────────────────────────────────────────────────────

export function renderBillOfLadingBody(data: ServerDocumentSetData, exporter: DocExporterProfile): string {
  // 运费条款推断：FOB/EXW/FCA → COLLECT；CIF/CIP/CFR/CPT/DDP/DAP → PREPAID
  const terms = (tradeTerms(data) || '').toUpperCase();
  const freightPrepaid = /CIF|CIP|CFR|CPT|DDP|DAP|DPU/.test(terms);

  const rows = data.lines.map((l: ServerDocumentSetLine) => `
    <tr>
      <td>${l.cartons ?? '—'} CTNS</td>
      <td>${esc(l.description)}</td>
      <td style="text-align:right">${fmtW(l.grossWeight)}</td>
      <td style="text-align:right">${fmtVol(l.volume)}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>BILL OF LADING</h1>
      <div class="subtitle">海运提单补料 (Shipper's Draft / SI)</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">B/L DRAFT-${esc(data.shipment.shipmentNumber)}</div>
      <div>Booking Date: ${dash(data.shipment.bookingDate)}</div>
      <div>ETD: ${dash(data.shipment.etd)}</div>
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('Shipper 托运人', exporter)}
    ${partyBlock('Consignee 收货人', data.parties.consignee?.name, data.parties.consignee?.address, data.parties.consignee?.contact)}
  </div>
  <div class="doc-party-grid">
    ${partyBlock('Notify Party 通知方', data.parties.consignee?.name, data.parties.consignee?.address, data.parties.consignee?.contact)}
    ${partyBlock('Carrier / Forwarder 承运人/货代', data.parties.carrier?.name)}
  </div>

  <div class="doc-section">
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>Vessel/Voyage 船名航次</strong></td>
          <td style="width:25%">${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + esc(data.shipment.voyageNumber) : ''}</td>
          <td style="width:25%"><strong>Freight 运费条款</strong></td>
          <td style="width:25%"><strong>${freightPrepaid ? 'FREIGHT PREPAID 运费预付' : 'FREIGHT COLLECT 运费到付'}</strong></td>
        </tr>
        <tr>
          <td><strong>Port of Loading 起运港</strong></td>
          <td>${dash(data.shipment.portOfLoading)}</td>
          <td><strong>Port of Discharge 卸货港</strong></td>
          <td>${dash(data.shipment.portOfDischarge)}</td>
        </tr>
        <tr>
          <td><strong>Container No. 柜号</strong></td>
          <td>${dash(data.shipment.containerNumber)}</td>
          <td><strong>Seal No. 封号</strong></td>
          <td>${dash(data.shipment.sealNumber)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Marks &amp; Nos. 唛头</div>
    <div class="doc-party"><div class="detail">${shippingMarks(data)}</div></div>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Cargo Particulars 货物明细</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th>No. of Packages 件数</th>
          <th>Description of Goods 货名</th>
          <th style="text-align:right">Gross Weight (KGS)</th>
          <th style="text-align:right">Measurement (CBM)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td>${data.totals.cartons ?? data.shipment.totalPackages ?? '—'} CTNS</td>
          <td>TOTAL 合计</td>
          <td style="text-align:right">${fmtW(data.totals.grossWeight)}</td>
          <td style="text-align:right">${fmtVol(data.totals.volume)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="doc-notes">
      <div class="notes-title">Remarks 备注</div>
      SHIPPER'S LOAD, COUNT AND SEAL. SAID TO CONTAIN. 托运人自装、自点、自封。
      ${data.shipment.notes ? '<br>' + linesToHtml(data.shipment.notes) : ''}
    </div>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">Shipper 托运人 (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">${esc(exporter.nameEn)}</div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Carrier / Agent 承运人/代理 (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">For the Carrier</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// INS — Insurance Policy / Certificate 保险单
// ────────────────────────────────────────────────────────────────

export function renderInsurancePolicyBody(data: ServerDocumentSetData, exporter: DocExporterProfile): string {
  const ins = (data.extras?.insurance ?? { insurer: '', insuredAmount: null, currency: null, premium: null, premiumCurrency: null, coverage: 'ALL RISKS' }) as InsuranceExtras;
  const lc = data.extras?.letterOfCredit as LetterOfCreditExtras | undefined;
  const claimsAt = data.shipment.portOfDischarge || data.customs?.destinationCountry || '—';

  const rows = data.lines.map((l: ServerDocumentSetLine) => `
    <tr>
      <td>${l.cartons ?? '—'} CTNS</td>
      <td>${esc(l.description)}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>INSURANCE POLICY / CERTIFICATE</h1>
      <div class="subtitle">货物运输保险单</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">POLICY-${esc(data.shipment.shipmentNumber)}</div>
      <div>Invoice No.: ${esc(resolvedInvoiceNo(data))}</div>
      ${lc ? `<div>L/C No.: ${esc(lc.lcNumber)}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    <div class="doc-party">
      <div class="label">Insured / Beneficiary 被保险人</div>
      <div class="name">${esc(exporter.beneficiary || exporter.nameEn)}</div>
      <div class="detail">${linesToHtml(exporter.addressEn)}</div>
    </div>
    <div class="doc-party">
      <div class="label">Insurer 保险人</div>
      <div class="name">${dash(ins.insurer)}</div>
      <div class="detail">Claims payable at 赔付地点: ${esc(claimsAt)}</div>
    </div>
  </div>

  <div class="doc-section">
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>Amount Insured 保险金额</strong></td>
          <td style="width:25%"><strong>${fmtMoney(ins.insuredAmount, ins.currency)}</strong></td>
          <td style="width:25%"><strong>Premium 保费</strong></td>
          <td style="width:25%">${ins.premium != null ? fmtMoney(ins.premium, ins.premiumCurrency) : 'PAID 已付'}</td>
        </tr>
        <tr>
          <td><strong>Conveyance 运输工具</strong></td>
          <td>${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + esc(data.shipment.voyageNumber) : ''}</td>
          <td><strong>Sailing on/about 开航日</strong></td>
          <td>${dash(data.shipment.atd || data.shipment.etd)}</td>
        </tr>
        <tr>
          <td><strong>From 起运港</strong></td>
          <td>${dash(data.shipment.portOfLoading)}</td>
          <td><strong>To 目的港</strong></td>
          <td>${dash(data.shipment.portOfDischarge)}</td>
        </tr>
        <tr>
          <td><strong>Conditions 承保险别</strong></td>
          <td colspan="3">${esc(ins.coverage)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Subject-matter Insured 保险标的</div>
    <table class="doc-table">
      <thead><tr><th>Marks &amp; Nos.</th></tr></thead>
      <tbody><tr><td>${shippingMarks(data)}</td></tr></tbody>
    </table>
    <table class="doc-table">
      <thead>
        <tr>
          <th>No. of Packages 件数</th>
          <th>Description of Goods 货名</th>
          <th style="text-align:right">Quantity 数量</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  ${lc ? `
  <div class="doc-section">
    <div class="doc-section-title">L/C Reference 信用证引用</div>
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>L/C No. 信用证号</strong></td>
          <td style="width:25%">${esc(lc.lcNumber)}</td>
          <td style="width:25%"><strong>Issuing Bank 开证行</strong></td>
          <td style="width:25%">${dash(lc.issueBank)}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">Insurer / Authorized Agent 保险人签章</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Insured 被保险人 (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">${esc(exporter.nameEn)}</div>
    </div>
  </div>`;
}
