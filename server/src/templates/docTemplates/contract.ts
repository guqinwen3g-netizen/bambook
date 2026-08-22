/**
 * Sales Contract 销售合同 — 服务端单据模板（2026-08-22 B8 多订单组合）。
 *
 * 架构裁决：
 *   - 组合文档模式（同 MERGED_PL/MERGED_IR）：多订单在数据层聚合为一份合同，
 *     而非 PDF 拼页；即时汇总产物不登记 TradeDocument（无单一业务真源可回链）
 *   - 合同号：S/C-{finalContractNumber 首个非空}（跨订单同合同号场景），
 *     否则「SC-YYYYMMDD-N」按当日组合序号临时编号（仅展示用，不落库）
 *   - 单订单正式确认场景走 OC 订单确认书（真源归档），两者互补
 */

import { esc } from '../docPrintBase';
import type { DocExporterProfile } from './packingList';

// ────────────────────────────────────────────────────────────────
// 数据形状（compositeDocumentService.assembleContractData 装配输出）
// ────────────────────────────────────────────────────────────────

export interface ContractOrderInfo {
  index: number;
  orderId: string;
  poNumber: string | null;
  customer: string;
  currency: string;
  quoteAmount: number | null;
  dueDate: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  salesContractNumber: string | null;
  finalContractNumber: string | null;
  lineCount: number;
}

export interface ContractDocLine {
  lineNumber: number;
  orderIndex: number;
  itemNo: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  netValue: number | null;
}

export interface ContractDocData {
  /** 合同号（首个非空 finalContractNumber / salesContractNumber，否则临时编号） */
  contractNumber: string;
  /** 合同日期（生成当日） */
  contractDate: string;
  /** 客户档案（首个非空订单的 Relation；缺档案回落冗余名） */
  customer: { name: string; englishName: string | null; chineseName: string | null; contactInfo: string | null } | null;
  orders: ContractOrderInfo[];
  lines: ContractDocLine[];
  totals: {
    currency: string;
    amount: number | null;
    quantity: number | null;
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

const linesToHtml = (text: string | null | undefined): string =>
  text ? String(text).split(/\r?\n/).map(esc).join('<br>') : '';

/** 销售合同渲染（body 片段，中英文对照——订单一览 + 合并明细 + 通用条款 + 双签） */
export function renderContractBody(data: ContractDocData, exporter: DocExporterProfile): string {
  const cur = data.totals.currency;
  const customerName = data.customer
    ? (data.customer.englishName || data.customer.chineseName || data.customer.name)
    : (data.orders[0]?.customer ?? '—');

  const orderRows = data.orders.map(o => `
    <tr>
      <td style="text-align:center">${o.index}</td>
      <td>${dash(o.poNumber)}</td>
      <td>${esc(o.customer)}</td>
      <td style="text-align:right">${money(o.quoteAmount, o.currency)}</td>
      <td>${dash(o.dueDate)}</td>
      <td style="text-align:center">${o.lineCount}</td>
    </tr>`).join('');

  const lineRows = data.lines.map(l => `
    <tr>
      <td style="text-align:center">${l.lineNumber}</td>
      <td style="text-align:center">O${l.orderIndex}</td>
      <td>${dash(l.itemNo)}</td>
      <td>${dash(l.description)}</td>
      <td style="text-align:right">${qty(l.quantity)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
      <td style="text-align:right">${l.unitPrice == null ? '—' : Number(l.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
      <td style="text-align:right">${money(l.netValue, cur)}</td>
    </tr>`).join('');

  const first = data.orders[0];
  const deliveryTerms = first?.deliveryTerms;
  const paymentTerms = first?.paymentTerms;

  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>SALES CONTRACT</h1>
      <div class="subtitle">销售合同</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(data.contractNumber)}</div>
      <div>Date 合同日期: ${esc(data.contractDate)}</div>
      <div>Orders 订单数: ${data.orders.length}</div>
    </div>
  </div>

  <div class="doc-party-grid">
    <div class="doc-party">
      <div class="label">Seller 卖方</div>
      <div class="name">${esc(exporter.nameEn)}</div>
      <div class="detail">${linesToHtml(exporter.addressEn)}</div>
    </div>
    <div class="doc-party">
      <div class="label">Buyer 买方</div>
      <div class="name">${esc(customerName)}</div>
      ${data.customer?.contactInfo ? `<div class="detail">${linesToHtml(data.customer.contactInfo)}</div>` : ''}
    </div>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Order Summary 订单一览</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th style="text-align:center">#</th>
          <th>P/O No. 订单号</th>
          <th>Customer 客户</th>
          <th style="text-align:right">Amount 金额</th>
          <th>Due Date 交期</th>
          <th style="text-align:center">Lines 行数</th>
        </tr>
      </thead>
      <tbody>${orderRows}</tbody>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Contract Lines 合并明细（O# = 订单序号）</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th style="text-align:center">#</th>
          <th style="text-align:center">O#</th>
          <th>Item No.</th>
          <th>Description 品名描述</th>
          <th style="text-align:right">Quantity 数量</th>
          <th style="text-align:right">Unit Price 单价</th>
          <th style="text-align:right">Amount 金额</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="6">TOTAL 合计</td>
          <td style="text-align:right">${money(data.totals.amount, cur)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="doc-section">
    <div class="doc-section-title">Terms &amp; Conditions 条款</div>
    <div style="font-size:11px;line-height:1.8">
      ${deliveryTerms ? `<div><strong>Delivery 交货:</strong> ${esc(deliveryTerms)}</div>` : ''}
      ${paymentTerms ? `<div><strong>Payment 付款:</strong> ${esc(paymentTerms)}</div>` : ''}
      <div><strong>Quantity Tolerance 溢短装:</strong> 按各订单行级溢短装条款执行（默认 ±5%，行业惯例）。</div>
      <div><strong>General 一般条款:</strong> 本合同项下各订单的品名、数量、单价与交期以「订单一览」与「合并明细」为准；
      如与订单原始文件冲突，以买卖双方书面确认的最新版本为准。</div>
    </div>
  </div>

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">For and on behalf of ${esc(exporter.nameEn)} (Seller 卖方签章)</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Buyer 买方签章</div>
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">Authorized Signature</div>
    </div>
  </div>`;
}
