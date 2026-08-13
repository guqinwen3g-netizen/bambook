/**
 * 外贸出运单据模板（CI / PL / CO / BL / Form A / 保险单 / 受益人证明）
 *
 * 纯函数渲染器：DocumentSetData → HTML body 字符串。
 * 样式复用 printDocument.ts 的 BASE_PRINT_STYLES（.doc-header / .doc-table 等），
 * 通过 printHtmlDocument 在独立打印窗口输出 PDF。
 *
 * 模板样式为打印文档上下文（独立 window，无应用 CSS 变量），
 * 与 printDocument.ts 既有模式一致，属设计 token 豁免范畴。
 */

import { DocumentSetData, DocumentSetLine } from '../../../types';
import { escapeHtml, formatDate, formatDocNumber } from '../printDocument';
import { getExporterProfile } from './exporterProfile';

// ────────────────────────────────────────────────────────────────
// 共用辅助
// ────────────────────────────────────────────────────────────────

function linesToHtml(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).split(/\r?\n/).map(escapeHtml).join('<br>');
}

function dash(v: string | null | undefined): string {
  return v ? escapeHtml(v) : '—';
}

function fmtQty(n: number | null): string {
  return n === null ? '—' : formatDocNumber(n, 0).replace(/\.00$/, '') === '0' && n !== 0 ? formatDocNumber(n, 2) : formatDocNumber(n, n % 1 === 0 ? 0 : 2);
}

function fmtW(n: number | null): string {
  return n === null ? '—' : formatDocNumber(n, 2);
}

function fmtMoney(n: number | null, currency: string | null): string {
  if (n === null) return '—';
  return `${formatDocNumber(n, 2)}${currency ? ' ' + escapeHtml(currency) : ''}`;
}

/** 英文金额大写（CI "SAY TOTAL" 行；支持到 billion，两位小数） */
export function amountInWords(amount: number, currency: string | null): string {
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
      const chunk = Math.floor(intPart / scale);
      parts.push(`${threeDigits(chunk)} ${label}`);
      intPart %= scale;
    }
  }
  if (intPart > 0) parts.push(threeDigits(intPart));
  const intWords = parts.join(' ').replace(/\s+/g, ' ').trim() || 'ZERO';

  const currencyName = currency === 'USD' ? 'US DOLLARS' : currency === 'EUR' ? 'EUROS' : currency === 'CNY' ? 'CHINESE YUAN' : (currency || '');
  const centsWords = cents > 0 ? ` AND CENTS ${twoDigits(cents)}` : '';
  return `SAY TOTAL ${currencyName} ${intWords}${centsWords} ONLY`.replace(/\s+/g, ' ').trim();
}

/** 默认唛头（数据模型无唛头字段时的通用占位） */
function shippingMarks(data: DocumentSetData): string {
  const po = data.order?.poNumber;
  const dest = data.shipment.portOfDischarge;
  const pkgs = data.totals.cartons ?? data.shipment.totalPackages;
  if (!po && !dest) return 'N/M';
  return [po, dest ? `${dest}` : null, pkgs ? `C/NO. 1-${pkgs}` : null].filter(Boolean).map(escapeHtml).join('<br>');
}

function partyBlock(label: string, name: string | null | undefined, address?: string | null, contact?: string | null): string {
  return `
  <div class="doc-party">
    <div class="label">${escapeHtml(label)}</div>
    <div class="name">${name ? escapeHtml(name) : '—'}</div>
    <div class="detail">
      ${address ? linesToHtml(address) + '<br>' : ''}
      ${contact ? 'Attn: ' + escapeHtml(contact) : ''}
    </div>
  </div>`;
}

function exporterBlock(label: string): string {
  return `
  <div class="doc-party">
    <div class="label">${escapeHtml(label)}</div>
    <div class="name">${escapeHtml(getExporterProfile().nameEn)}</div>
    <div class="detail">${linesToHtml(getExporterProfile().addressEn)}</div>
  </div>`;
}

function resolvedInvoiceNo(data: DocumentSetData): string {
  return data.order?.invoiceNumber || `INV-${data.shipment.shipmentNumber}`;
}

function resolvedInvoiceDate(data: DocumentSetData): string {
  return data.order?.invoiceDate || formatDate(new Date());
}

function tradeTerms(data: DocumentSetData): string {
  return data.order?.deliveryTerms || data.customs?.tradeTerms || 'FOB SHANGHAI';
}

// ────────────────────────────────────────────────────────────────
// CI — Commercial Invoice 商业发票
// ────────────────────────────────────────────────────────────────

export function renderCommercialInvoiceHtml(data: DocumentSetData): string {
  const currency = data.totals.currency || data.order?.currency || 'USD';
  const invoiceNo = resolvedInvoiceNo(data);
  const invoiceDate = resolvedInvoiceDate(data);

  const rows = data.lines.map((l: DocumentSetLine) => `
    <tr>
      <td>${escapeHtml(l.description)}${l.hsCode ? `<br><span style="color:#718096;font-size:10px">HS: ${escapeHtml(l.hsCode)}</span>` : ''}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + escapeHtml(l.unit) : ''}</td>
      <td style="text-align:right">${l.unitPrice !== null ? formatDocNumber(l.unitPrice, 4).replace(/0+$/, '').replace(/\.$/, '.00') : '—'}</td>
      <td style="text-align:right">${fmtMoney(l.amount, null)}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>COMMERCIAL INVOICE</h1>
      <div class="subtitle">商业发票</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${escapeHtml(invoiceNo)}</div>
      <div>Date: ${escapeHtml(invoiceDate)}</div>
      ${data.order?.poNumber ? `<div>P/O No.: ${escapeHtml(data.order.poNumber)}</div>` : ''}
      ${data.order?.finalContractNumber || data.order?.salesContractNumber ? `<div>S/C No.: ${escapeHtml(data.order.finalContractNumber || data.order.salesContractNumber || '')}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('Seller / Exporter 卖方')}
    ${partyBlock('Buyer / Consignee 买方', data.parties.customer?.name, data.parties.customer?.address, data.parties.customer?.contact)}
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Shipment 运输信息</div>
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>From 起运港</strong></td>
          <td style="width:25%">${dash(data.shipment.portOfLoading)}</td>
          <td style="width:25%"><strong>To 目的港</strong></td>
          <td style="width:25%">${dash(data.shipment.portOfDischarge)}</td>
        </tr>
        <tr>
          <td><strong>Vessel/Voyage 船名航次</strong></td>
          <td>${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : ''}</td>
          <td><strong>ETD 离港日</strong></td>
          <td>${dash(data.shipment.atd || data.shipment.etd)}</td>
        </tr>
        <tr>
          <td><strong>Terms of Delivery 贸易条款</strong></td>
          <td>${escapeHtml(tradeTerms(data))}</td>
          <td><strong>Terms of Payment 付款方式</strong></td>
          <td>${dash(data.order?.paymentTerms)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Goods 货物明细</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th>Marks & Nos.</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>${shippingMarks(data)}</td></tr>
      </tbody>
    </table>
    <table class="doc-table">
      <thead>
        <tr>
          <th>Description of Goods 品名</th>
          <th style="text-align:right">Quantity 数量</th>
          <th style="text-align:right">Unit Price 单价 (${escapeHtml(currency)})</th>
          <th style="text-align:right">Amount 金额 (${escapeHtml(currency)})</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3">TOTAL 合计</td>
          <td style="text-align:right">${fmtMoney(data.totals.amount, null)}</td>
        </tr>
      </tfoot>
    </table>
    ${data.totals.amount !== null ? `<div class="doc-notes"><div class="notes-title">Amount in Words</div>${escapeHtml(amountInWords(data.totals.amount, currency))}</div>` : ''}
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Beneficiary Bank 收款银行</div>
    <div class="doc-party">
      <div class="detail">
        Beneficiary: ${escapeHtml(getExporterProfile().beneficiary)}<br>
        Bank: ${escapeHtml(getExporterProfile().bankName)}<br>
        Address: ${escapeHtml(getExporterProfile().bankAddress)}<br>
        SWIFT: ${escapeHtml(getExporterProfile().swiftCode)}<br>
        A/C No.: ${escapeHtml(getExporterProfile().usdAccountNumber)}
      </div>
    </div>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">For and on behalf of ${escapeHtml(getExporterProfile().nameEn)} (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// PL — Packing List 装箱单
// ────────────────────────────────────────────────────────────────

export function renderPackingListHtml(data: DocumentSetData): string {
  const invoiceNo = resolvedInvoiceNo(data);
  const invoiceDate = resolvedInvoiceDate(data);

  const rows = data.lines.map((l: DocumentSetLine) => `
    <tr>
      <td>${escapeHtml(l.description)}${l.productCode ? `<br><span style="color:#718096;font-size:10px">${escapeHtml(l.productCode)}</span>` : ''}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + escapeHtml(l.unit) : ''}</td>
      <td style="text-align:right">${l.cartons ?? '—'}</td>
      <td style="text-align:right">${fmtW(l.grossWeight)}</td>
      <td style="text-align:right">${fmtW(l.netWeight)}</td>
      <td style="text-align:right">${l.volume !== null ? formatDocNumber(l.volume, 3) : '—'}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>PACKING LIST</h1>
      <div class="subtitle">装箱单</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${escapeHtml(invoiceNo)}</div>
      <div>Date: ${escapeHtml(invoiceDate)}</div>
      ${data.order?.poNumber ? `<div>P/O No.: ${escapeHtml(data.order.poNumber)}</div>` : ''}
      ${data.shipment.customsDeclarationNumber ? `<div>报关单号: ${escapeHtml(data.shipment.customsDeclarationNumber)}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('Shipper / Exporter 发货人')}
    ${partyBlock('Consignee 收货人', data.parties.consignee?.name, data.parties.consignee?.address, data.parties.consignee?.contact)}
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Shipment 运输信息</div>
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>Vessel/Voyage 船名航次</strong></td>
          <td style="width:25%">${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : ''}</td>
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
        <tr><th>Marks & Nos.</th></tr>
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
          <td style="text-align:right">${data.totals.volume !== null ? formatDocNumber(data.totals.volume, 3) : '—'}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">For and on behalf of ${escapeHtml(getExporterProfile().nameEn)} (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// CO — Certificate of Origin 原产地证明
// ────────────────────────────────────────────────────────────────

export function renderCertificateOfOriginHtml(data: DocumentSetData): string {
  const origin = data.customs?.originCountry || data.lines.find(l => l.originCountry)?.originCountry || 'CHINA';
  const destination = data.customs?.destinationCountry || '';
  const transport = [
    data.shipment.shippingMethod ? `BY ${data.shipment.shippingMethod.toUpperCase() === 'SEA' ? 'SEA' : escapeHtml(data.shipment.shippingMethod.toUpperCase())}` : null,
    data.shipment.vesselOrFlight ? escapeHtml(data.shipment.vesselOrFlight) + (data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : '') : null,
    data.shipment.portOfLoading && data.shipment.portOfDischarge ? `FROM ${escapeHtml(data.shipment.portOfLoading)} TO ${escapeHtml(data.shipment.portOfDischarge)}` : null,
  ].filter(Boolean).join(' / ') || '—';

  const rows = data.lines.map((l: DocumentSetLine) => `
    <tr>
      <td>${l.cartons ?? '—'} CTNS</td>
      <td>${escapeHtml(l.description)}</td>
      <td>${dash(l.hsCode)}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + escapeHtml(l.unit) : ''}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>CERTIFICATE OF ORIGIN</h1>
      <div class="subtitle">原产地证明书</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">CO-${escapeHtml(data.shipment.shipmentNumber)}</div>
      <div>Date: ${escapeHtml(formatDate(new Date()))}</div>
      <div>Invoice No.: ${escapeHtml(resolvedInvoiceNo(data))}</div>
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('1. Exporter 出口商')}
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
      <strong>${escapeHtml(origin)}</strong> and that they comply with the origin requirements specified for those goods
      in the Generalized System of Preferences for goods exported to the importing country.
      <br><br>
      兹声明上述货物均产于<strong>${escapeHtml(origin === 'CHINA' ? '中华人民共和国' : origin)}</strong>，所列内容属实无误。
    </div>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">Declaration by the Exporter 出口商声明</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">${escapeHtml(getExporterProfile().nameEn)}</div>
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

export function renderBillOfLadingHtml(data: DocumentSetData): string {
  // 运费条款推断：FOB/EXW/FCA → COLLECT；CIF/CIP/CFR/CPT/DDP/DAP → PREPAID
  const terms = (tradeTerms(data) || '').toUpperCase();
  const freightPrepaid = /CIF|CIP|CFR|CPT|DDP|DAP|DPU/.test(terms);

  const rows = data.lines.map((l: DocumentSetLine) => `
    <tr>
      <td>${l.cartons ?? '—'} CTNS</td>
      <td>${escapeHtml(l.description)}</td>
      <td style="text-align:right">${fmtW(l.grossWeight)}</td>
      <td style="text-align:right">${l.volume !== null ? formatDocNumber(l.volume, 3) : '—'}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>BILL OF LADING</h1>
      <div class="subtitle">海运提单补料 (Shipper's Draft / SI)</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">B/L DRAFT-${escapeHtml(data.shipment.shipmentNumber)}</div>
      <div>Booking Date: ${dash(data.shipment.bookingDate)}</div>
      <div>ETD: ${dash(data.shipment.etd)}</div>
    </div>
  </div>

  <div class="doc-party-grid">
    ${exporterBlock('Shipper 托运人')}
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
          <td style="width:25%">${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : ''}</td>
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
          <td style="text-align:right">${data.totals.volume !== null ? formatDocNumber(data.totals.volume, 3) : '—'}</td>
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
      <div class="sig-name">${escapeHtml(getExporterProfile().nameEn)}</div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Carrier / Agent 承运人/代理 (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">For the Carrier</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// Form A — GSP 普惠制原产地证（官方 12 栏格式草稿）
// ────────────────────────────────────────────────────────────────

export function renderFormAHtml(data: DocumentSetData): string {
  const origin = data.customs?.originCountry || data.lines.find(l => l.originCountry)?.originCountry || 'CHINA';
  const transport = [
    data.shipment.vesselOrFlight ? escapeHtml(data.shipment.vesselOrFlight) + (data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : '') : null,
    data.shipment.etd || data.shipment.atd ? `ON/ABOUT ${escapeHtml(data.shipment.atd || data.shipment.etd || '')}` : null,
    data.shipment.portOfLoading && data.shipment.portOfDischarge ? `FROM ${escapeHtml(data.shipment.portOfLoading)}, CHINA TO ${escapeHtml(data.shipment.portOfDischarge)}` : null,
    data.shipment.shippingMethod ? `BY ${data.shipment.shippingMethod.toUpperCase() === 'SEA' ? 'SEA' : escapeHtml(data.shipment.shippingMethod.toUpperCase())}` : null,
  ].filter(Boolean).join('<br>') || '—';

  const rows = data.lines.map((l: DocumentSetLine, i: number) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${i === 0 ? shippingMarks(data) : ''}</td>
      <td>${l.cartons ?? '—'} CTNS<br>${escapeHtml(l.description)}</td>
      <td style="text-align:center">${escapeHtml(data.extras.originCriterion)}</td>
      <td style="text-align:right">${fmtW(l.grossWeight)} KGS</td>
      <td>${i === 0 ? escapeHtml(resolvedInvoiceNo(data)) + '<br>' + escapeHtml(resolvedInvoiceDate(data)) : ''}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>GENERALIZED SYSTEM OF PREFERENCES<br>CERTIFICATE OF ORIGIN</h1>
      <div class="subtitle">FORM A · 普惠制原产地证 (Combined declaration and certificate)</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">FA-${escapeHtml(data.shipment.shipmentNumber)}</div>
      <div>Issued in ${escapeHtml(origin === 'CHINA' ? "THE PEOPLE'S REPUBLIC OF CHINA" : origin)}</div>
      <div>Country of destination: ${dash(data.customs?.destinationCountry)}</div>
    </div>
  </div>

  <table class="doc-table">
    <tbody>
      <tr>
        <td style="width:50%;vertical-align:top">
          <strong>1. Goods consigned from (Exporter's business name, address, country)</strong><br><br>
          ${escapeHtml(getExporterProfile().nameEn)}<br>${linesToHtml(getExporterProfile().addressEn)}
        </td>
        <td style="width:50%;vertical-align:top">
          <strong>Reference No.</strong><br>
          FA-${escapeHtml(data.shipment.shipmentNumber)}
        </td>
      </tr>
      <tr>
        <td style="vertical-align:top">
          <strong>2. Goods consigned to (Consignee's name, address, country)</strong><br><br>
          ${data.parties.consignee?.name ? escapeHtml(data.parties.consignee.name) : '—'}<br>
          ${data.parties.consignee?.address ? linesToHtml(data.parties.consignee.address) : ''}
        </td>
        <td style="vertical-align:top;color:#4a5568">
          <strong>4. For official use</strong><br><br>
          &nbsp;
        </td>
      </tr>
      <tr>
        <td colspan="2" style="vertical-align:top">
          <strong>3. Means of transport and route (as far as known)</strong><br><br>
          ${transport}
        </td>
      </tr>
    </tbody>
  </table>

  <div class="doc-section">
    <table class="doc-table">
      <thead>
        <tr>
          <th style="width:6%">5. Item No.</th>
          <th style="width:16%">6. Marks &amp; Nos.</th>
          <th>7. No. &amp; kind of packages; description of goods</th>
          <th style="width:8%">8. Origin criterion</th>
          <th style="width:14%;text-align:right">9. Gross weight</th>
          <th style="width:14%">10. No. &amp; date of invoices</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <table class="doc-table">
    <tbody>
      <tr>
        <td style="width:50%;vertical-align:top">
          <strong>11. Certification</strong><br>
          It is hereby certified, on the basis of control carried out, that the declaration by the exporter is correct.
          <br><br><br><br>
          <div style="color:#4a5568">Place and date, signature and stamp of certifying authority</div>
        </td>
        <td style="width:50%;vertical-align:top">
          <strong>12. Declaration by the exporter</strong><br>
          The undersigned hereby declares that the above details and statements are correct; that all the goods were produced in
          <strong>${escapeHtml(origin === 'CHINA' ? 'CHINA' : origin)}</strong> and that they comply with the origin requirements
          specified for those goods in the Generalized System of Preferences for goods exported to the importing country.
          <br><br><br><br>
          <div style="color:#4a5568">Place and date, signature of authorized signatory</div>
        </td>
      </tr>
    </tbody>
  </table>`;
}

// ────────────────────────────────────────────────────────────────
// INS — Insurance Policy / Certificate 保险单
// ────────────────────────────────────────────────────────────────

export function renderInsurancePolicyHtml(data: DocumentSetData): string {
  const ins = data.extras.insurance;
  const lc = data.extras.letterOfCredit;
  const claimsAt = data.shipment.portOfDischarge || data.customs?.destinationCountry || '—';

  const rows = data.lines.map((l: DocumentSetLine) => `
    <tr>
      <td>${l.cartons ?? '—'} CTNS</td>
      <td>${escapeHtml(l.description)}</td>
      <td style="text-align:right">${fmtQty(l.quantity)}${l.unit ? ' ' + escapeHtml(l.unit) : ''}</td>
    </tr>`).join('');

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>INSURANCE POLICY / CERTIFICATE</h1>
      <div class="subtitle">货物运输保险单</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">POLICY-${escapeHtml(data.shipment.shipmentNumber)}</div>
      <div>Invoice No.: ${escapeHtml(resolvedInvoiceNo(data))}</div>
      ${lc ? `<div>L/C No.: ${escapeHtml(lc.lcNumber)}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    <div class="doc-party">
      <div class="label">Insured / Beneficiary 被保险人</div>
      <div class="name">${escapeHtml(getExporterProfile().beneficiary)}</div>
      <div class="detail">${linesToHtml(getExporterProfile().addressEn)}</div>
    </div>
    <div class="doc-party">
      <div class="label">Insurer 保险人</div>
      <div class="name">${dash(ins.insurer)}</div>
      <div class="detail">Claims payable at 赔付地点: ${escapeHtml(claimsAt)}</div>
    </div>
  </div>

  <div class="doc-section">
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>Amount Insured 保险金额</strong></td>
          <td style="width:25%"><strong>${fmtMoney(ins.insuredAmount, ins.currency)}</strong></td>
          <td style="width:25%"><strong>Premium 保费</strong></td>
          <td style="width:25%">${ins.premium !== null ? fmtMoney(ins.premium, ins.premiumCurrency) : 'PAID 已付'}</td>
        </tr>
        <tr>
          <td><strong>Conveyance 运输工具</strong></td>
          <td>${dash(data.shipment.vesselOrFlight)}${data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : ''}</td>
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
          <td colspan="3">${escapeHtml(ins.coverage)}</td>
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
    ${ins.insuredAmount !== null ? `<div class="doc-notes"><div class="notes-title">Amount in Words</div>${escapeHtml(amountInWords(ins.insuredAmount, ins.currency))}</div>` : ''}
  </div>

  ${lc ? `
  <div class="doc-section">
    <div class="doc-section-title">L/C Reference 信用证引用</div>
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>L/C No. 信用证号</strong></td>
          <td style="width:25%">${escapeHtml(lc.lcNumber)}</td>
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
      <div class="sig-name">${escapeHtml(getExporterProfile().nameEn)}</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// BC — Beneficiary's Certificate 受益人证明
// ────────────────────────────────────────────────────────────────

export function renderBeneficiaryCertificateHtml(data: DocumentSetData): string {
  const lc = data.extras.letterOfCredit;
  const today = formatDate(new Date());

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>BENEFICIARY'S CERTIFICATE</h1>
      <div class="subtitle">受益人证明</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">BC-${escapeHtml(data.shipment.shipmentNumber)}</div>
      <div>Date: ${escapeHtml(today)}</div>
      <div>Invoice No.: ${escapeHtml(resolvedInvoiceNo(data))}</div>
    </div>
  </div>

  <div class="doc-section">
    <table class="doc-table">
      <tbody>
        <tr>
          <td style="width:25%"><strong>To 致</strong></td>
          <td style="width:75%">${lc?.applicant ? escapeHtml(lc.applicant) : data.parties.customer?.name ? escapeHtml(data.parties.customer.name) : '—'}</td>
        </tr>
        ${lc ? `
        <tr>
          <td><strong>L/C No. 信用证号</strong></td>
          <td>${escapeHtml(lc.lcNumber)}${lc.issueBank ? ` issued by ${escapeHtml(lc.issueBank)}` : ''}${lc.issueDate ? ` dated ${escapeHtml(lc.issueDate)}` : ''}</td>
        </tr>` : ''}
        <tr>
          <td><strong>S/C or P/O No. 合同/订单号</strong></td>
          <td>${escapeHtml(data.order?.finalContractNumber || data.order?.salesContractNumber || data.order?.poNumber || '—')}</td>
        </tr>
        <tr>
          <td><strong>B/L or Shipment 运单号</strong></td>
          <td>${escapeHtml(data.shipment.shipmentNumber)}${data.shipment.vesselOrFlight ? ` per ${escapeHtml(data.shipment.vesselOrFlight)}` : ''}${data.shipment.voyageNumber ? ' ' + escapeHtml(data.shipment.voyageNumber) : ''}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Certification 声明</div>
    <div class="doc-notes" style="color:#2d3748;font-size:12px;line-height:1.9">
      WE, ${escapeHtml(getExporterProfile().beneficiary)}, HEREBY CERTIFY THAT:
      <br><br>
      1. ONE FULL SET OF NON-NEGOTIABLE SHIPPING DOCUMENTS (INCLUDING COPY OF BILL OF LADING,
      COMMERCIAL INVOICE AND PACKING LIST) HAS BEEN SENT DIRECTLY TO THE APPLICANT BY COURIER
      IMMEDIATELY AFTER SHIPMENT.
      <br>
      2. ALL DOCUMENTS PRESENTED CONFORM TO THE TERMS AND CONDITIONS OF THE RELATIVE LETTER OF CREDIT
      AND THE GOODS SHIPPED ARE IN STRICT ACCORDANCE WITH THE CONTRACT SPECIFICATIONS.
      <br><br>
      我司兹证明：船运后已立即以快递方式向开证申请人直接寄送全套副本装运单据（含提单副本、商业发票与装箱单），
      且所提交单据均符合相关信用证条款，所装货物与合同规格严格相符。
    </div>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">For and on behalf of ${escapeHtml(getExporterProfile().nameEn)} (签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Beneficiary's Authorized Signature · ${escapeHtml(today)}</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// 注册表
// ────────────────────────────────────────────────────────────────

export type ExportDocKind = 'CI' | 'PL' | 'CO' | 'BL' | 'FORMA' | 'INS' | 'BC';

export const EXPORT_DOC_RENDERERS: Record<ExportDocKind, { title: string; render: (d: DocumentSetData) => string }> = {
  CI: { title: 'Commercial Invoice 商业发票', render: renderCommercialInvoiceHtml },
  PL: { title: 'Packing List 装箱单', render: renderPackingListHtml },
  CO: { title: 'Certificate of Origin 原产地证', render: renderCertificateOfOriginHtml },
  BL: { title: 'Bill of Lading 提单补料', render: renderBillOfLadingHtml },
  FORMA: { title: 'GSP Form A 普惠制原产地证', render: renderFormAHtml },
  INS: { title: 'Insurance Policy 保险单', render: renderInsurancePolicyHtml },
  BC: { title: "Beneficiary's Certificate 受益人证明", render: renderBeneficiaryCertificateHtml },
};
