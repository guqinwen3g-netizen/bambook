/**
 * 合同生成器
 * 生成服装外贸采购/销售合同 HTML → 打印/PDF
 * 支持中英双语条款、买卖双方信息、商品明细与标准外贸条款
 */

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash2,
  Search,
  Settings2,
} from 'lucide-react';
import { Order, Relation } from '../../types';
import { statusSemanticClass, statusSemanticText } from '../rdlBusinessStatusTokens';
import { printHtmlDocument, formatDate, formatDocNumber, escapeHtml } from './printDocument';
import { getExporterProfile } from './exportDocs/exporterProfile';

// ==================== 类型 ====================
interface ContractLine {
  id: string;
  description: string;
  fabricCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

interface ContractGeneratorProps {
  isDarkMode: boolean;
  relations?: Relation[];
  orders?: Order[];
}

type ContractType = 'sales' | 'purchase';

const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'] as const;

const PAYMENT_TERMS_OPTIONS = [
  'T/T 30% deposit, 70% before shipment',
  'T/T 100% in advance',
  'L/C at sight',
  'L/C 30 days',
  'D/P at sight',
  'Net 30 days',
  'Net 60 days',
];

const DELIVERY_TERMS_OPTIONS = [
  'FOB Shanghai',
  'FOB Ningbo',
  'CIF destination port',
  'CFR destination port',
  'EXW factory',
  'DDP destination',
];

let lineIdCounter = 0;
const newLineId = () => `ct_line_${Date.now()}_${++lineIdCounter}`;

const createEmptyLine = (): ContractLine => ({
  id: newLineId(),
  description: '',
  fabricCode: '',
  quantity: '',
  unit: 'YD',
  unitPrice: '',
});

const ContractGenerator: React.FC<ContractGeneratorProps> = ({
  isDarkMode,
  relations = [],
  orders = [],
}) => {
  const [contractType, setContractType] = useState<ContractType>('sales');
  const [contractNo, setContractNo] = useState('');
  const [signDate, setSignDate] = useState(new Date().toISOString().split('T')[0]);
  const [signPlace, setSignPlace] = useState('Suzhou, China');
  const [sellerId, setSellerId] = useState('');
  const [buyerId, setBuyerId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [lines, setLines] = useState<ContractLine[]>([createEmptyLine()]);
  const [currency, setCurrency] = useState('USD');
  const [paymentTerms, setPaymentTerms] = useState(PAYMENT_TERMS_OPTIONS[0]);
  const [deliveryTerms, setDeliveryTerms] = useState(DELIVERY_TERMS_OPTIONS[0]);
  const [qualityClause, setQualityClause] = useState('按买卖双方确认的样品品质为准，允许 ±5% 公差。');
  const [packingClause, setPackingClause] = useState('卷装出口，每卷 100 YD，外用编织袋包装，适合长途海运。');
  const [inspectionClause, setInspectionClause] = useState('买方须在货到后 15 天内提出品质/数量异议，逾期视为接受。');
  const [forceMajeure, setForceMajeure] = useState('因战争、自然灾害等不可抗力导致无法履约，双方免除责任。');
  const [arbitration, setArbitration] = useState('凡因本合同引起的争议，提交中国国际经济贸易仲裁委员会（CIETAC）按其规则仲裁。');
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // 关系选项
  const relationOptions = useMemo(() => {
    return relations
      .filter(r => !r.deletedAt)
      .map(r => ({
        id: r.id,
        label: r.englishName || r.chineseName || r.name,
        chineseName: r.chineseName || r.name,
        englishName: r.englishName || r.name,
        address: r.officialAddress || r.billingAddress || '',
        taxId: r.taxId || '',
        paymentTerms: r.paymentTerms || '',
        contact: r.primaryContactName || '',
        email: r.primaryContactEmail || r.email || '',
        phone: r.primaryContactPhone || r.contactInfo || '',
      }));
  }, [relations]);

  const filteredOrders = useMemo(() => {
    const kw = searchKeyword.toLowerCase();
    return orders
      .filter(o => !o.deletedAt && o.poNumber)
      .filter(o => !kw ||
        (o.poNumber && o.poNumber.toLowerCase().includes(kw)) ||
        (o.customer && o.customer.toLowerCase().includes(kw))
      )
      .slice(0, 20);
  }, [orders, searchKeyword]);

  const seller = useMemo(() => relationOptions.find(r => r.id === sellerId), [relationOptions, sellerId]);
  const buyer = useMemo(() => relationOptions.find(r => r.id === buyerId), [relationOptions, buyerId]);
  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId), [orders, selectedOrderId]);

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    const order = orders.find(o => o.id === orderId);
    if (order) {
      setLines(prev => prev.map((line, i) =>
        i === 0 ? {
          ...line,
          description: order.customer || '',
        } : line
      ));
      if (order.salesCurrency) setCurrency(order.salesCurrency);
      if (order.paymentTerms) setPaymentTerms(order.paymentTerms);
    }
  };

  const updateLine = (id: string, field: keyof ContractLine, value: string) => {
    setLines(prev => prev.map(l => (l.id === id ? { ...l, [field]: value } : l)));
  };
  const addLine = () => setLines(prev => [...prev, createEmptyLine()]);
  const removeLine = (id: string) => setLines(prev => (prev.length > 1 ? prev.filter(l => l.id !== id) : prev));

  // 合计
  const totals = useMemo(() => {
    const parseNum = (s: string) => (Number.isFinite(parseFloat(s)) ? parseFloat(s) : 0);
    const totalAmount = lines.reduce((sum, l) => sum + parseNum(l.quantity) * parseNum(l.unitPrice), 0);
    const totalQty = lines.reduce((sum, l) => sum + parseNum(l.quantity), 0);
    return { totalAmount, totalQty };
  }, [lines]);

  // 生成合同 HTML
  const handleGenerate = async () => {
    if (!seller && !buyer) {
      setErrorMessage('请至少选择卖方或买方');
      setGenerationStatus('error');
      return;
    }
    const validLines = lines.filter(l => l.description || l.quantity);
    if (validLines.length === 0) {
      setErrorMessage('请至少填写一行商品明细');
      setGenerationStatus('error');
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('idle');
    setErrorMessage('');

    try {
      const docNo = contractNo || `SC-${Date.now().toString(36).toUpperCase()}`;
      const today = formatDate(signDate);
      const isSales = contractType === 'sales';
      const titleCn = isSales ? '销售合同' : '采购合同';
      const titleEn = isSales ? 'SALES CONTRACT' : 'PURCHASE CONTRACT';

      const sellerName = seller?.englishName || seller?.chineseName || getExporterProfile().nameEn;
      const sellerCn = seller?.chineseName || getExporterProfile().nameEn;
      const buyerName = buyer?.englishName || buyer?.chineseName || selectedOrder?.customer || '';
      const buyerCn = buyer?.chineseName || selectedOrder?.customer || '';

      const rowsHtml = validLines.map((l, i) => {
        const qty = parseFloat(l.quantity) || 0;
        const price = parseFloat(l.unitPrice) || 0;
        const amount = qty * price;
        return `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${escapeHtml(l.fabricCode)}</td>
          <td>${escapeHtml(l.description)}</td>
          <td style="text-align:right">${formatDocNumber(qty, 2)}</td>
          <td style="text-align:center">${escapeHtml(l.unit)}</td>
          <td style="text-align:right">${formatDocNumber(price, 4)}</td>
          <td style="text-align:right">${formatDocNumber(amount, 2)}</td>
        </tr>`;
      }).join('');

      const htmlBody = `
        <div class="doc-header">
          <div class="doc-title-block">
            <h1>${titleEn}</h1>
            <div class="subtitle">${titleCn}</div>
          </div>
          <div class="doc-meta">
            <div class="doc-no">No: ${escapeHtml(docNo)}</div>
            <div>Date: ${escapeHtml(today)}</div>
            <div>Place: ${escapeHtml(signPlace)}</div>
          </div>
        </div>

        <div class="doc-party-grid">
          <div class="doc-party">
            <div class="label">${isSales ? 'Seller 卖方' : 'Supplier 供货方'}</div>
            <div class="name">${escapeHtml(sellerName)}</div>
            <div class="detail">
              ${escapeHtml(sellerCn)}<br>
              ${seller?.address ? escapeHtml(seller.address) + '<br>' : ''}
              ${seller?.taxId ? 'Tax ID: ' + escapeHtml(seller.taxId) + '<br>' : ''}
              ${seller?.contact ? 'Contact: ' + escapeHtml(seller.contact) : ''}
            </div>
          </div>
          <div class="doc-party">
            <div class="label">${isSales ? 'Buyer 买方' : 'Purchaser 采购方'}</div>
            <div class="name">${escapeHtml(buyerName)}</div>
            <div class="detail">
              ${escapeHtml(buyerCn)}<br>
              ${buyer?.address ? escapeHtml(buyer.address) + '<br>' : ''}
              ${buyer?.taxId ? 'Tax ID: ' + escapeHtml(buyer.taxId) + '<br>' : ''}
              ${buyer?.contact ? 'Contact: ' + escapeHtml(buyer.contact) : ''}
            </div>
          </div>
        </div>

        <p style="font-size:11px;color:#4a5568;margin-bottom:16px">
          This Contract is made and entered into on <strong>${escapeHtml(today)}</strong>
          by and between <strong>${escapeHtml(sellerName)}</strong> (hereinafter "Seller")
          and <strong>${escapeHtml(buyerName)}</strong> (hereinafter "Buyer").
          The Seller agrees to sell and the Buyer agrees to purchase the under-mentioned goods
          subject to the terms and conditions stipulated below.
        </p>

        <table class="doc-table">
          <thead>
            <tr>
              <th style="width:30px">No.</th>
              <th>Code 编码</th>
              <th>Description 品名</th>
              <th style="text-align:right">Qty 数量</th>
              <th style="text-align:center">Unit</th>
              <th style="text-align:right">Unit Price</th>
              <th style="text-align:right">Amount 金额</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align:right">TOTAL 合计</td>
              <td style="text-align:right">${formatDocNumber(totals.totalQty, 2)}</td>
              <td></td>
              <td></td>
              <td style="text-align:right">${formatDocNumber(totals.totalAmount, 2)} ${escapeHtml(currency)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="font-size:11px;color:#4a5568;margin-bottom:20px">
          Total Amount (in words): <strong>${escapeHtml(numberToWords(totals.totalAmount))} ${escapeHtml(currency)} ONLY</strong>
        </div>

        <div class="doc-section">
          <div class="doc-section-title">Terms & Conditions 合同条款</div>
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr>
              <td style="padding:6px 0;width:140px;color:#718096;vertical-align:top">Payment 付款方式</td>
              <td style="padding:6px 0">${escapeHtml(paymentTerms)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#718096;vertical-align:top">Delivery 交货条款</td>
              <td style="padding:6px 0">${escapeHtml(deliveryTerms)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#718096;vertical-align:top">Quality 品质条款</td>
              <td style="padding:6px 0">${escapeHtml(qualityClause)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#718096;vertical-align:top">Packing 包装条款</td>
              <td style="padding:6px 0">${escapeHtml(packingClause)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#718096;vertical-align:top">Inspection 检验条款</td>
              <td style="padding:6px 0">${escapeHtml(inspectionClause)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#718096;vertical-align:top">Force Majeure 不可抗力</td>
              <td style="padding:6px 0">${escapeHtml(forceMajeure)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#718096;vertical-align:top">Arbitration 仲裁</td>
              <td style="padding:6px 0">${escapeHtml(arbitration)}</td>
            </tr>
          </table>
        </div>

        <div class="doc-notes">
          <div class="notes-title">Additional Remarks 附加说明</div>
          <div>This Contract is made in duplicate, each party holding one copy, both being equally valid.</div>
          <div>本合同一式两份，买卖双方各执一份，具有同等法律效力。</div>
        </div>

        <div class="doc-footer">
          <div class="doc-signature">
            <div class="sig-label">${isSales ? 'For Seller 卖方' : 'For Supplier 供货方'} (签章)</div>
            <div class="sig-line" style="margin-top:40px"></div>
            <div class="sig-name">${escapeHtml(sellerName)}</div>
            <div style="font-size:10px;color:#718096;margin-top:2px">Authorized Signature / Date</div>
          </div>
          <div class="doc-signature">
            <div class="sig-label">${isSales ? 'For Buyer 买方' : 'For Purchaser 采购方'} (签章)</div>
            <div class="sig-line" style="margin-top:40px"></div>
            <div class="sig-name">${escapeHtml(buyerName)}</div>
            <div style="font-size:10px;color:#718096;margin-top:2px">Authorized Signature / Date</div>
          </div>
        </div>
      `;

      printHtmlDocument({ title: `${titleCn}-${docNo}`, htmlBody });
      setGenerationStatus('success');
    } catch (error: any) {
      console.error('合同生成失败:', error);
      setErrorMessage('生成失败: ' + (error.message || '未知错误'));
      setGenerationStatus('error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setContractType('sales');
    setContractNo('');
    setSignDate(new Date().toISOString().split('T')[0]);
    setSignPlace('Suzhou, China');
    setSellerId('');
    setBuyerId('');
    setSelectedOrderId('');
    setSearchKeyword('');
    setLines([createEmptyLine()]);
    setCurrency('USD');
    setPaymentTerms(PAYMENT_TERMS_OPTIONS[0]);
    setDeliveryTerms(DELIVERY_TERMS_OPTIONS[0]);
    setGenerationStatus('idle');
    setErrorMessage('');
  };

  // 主题样式
  const panelClass = isDarkMode ? 'bg-white/5 border border-white/10' : 'bg-white/80 border border-slate-200';
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm transition-colors focus:outline-none focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-500' : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;
  const sectionTitleClass = `text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="relative z-30 flex-shrink-0 flex items-end justify-between pb-1">
        <div>
          <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            合同生成器
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            采购/销售合同模板 · 中英双语 · PDF 打印
          </p>
        </div>
        <button
          onClick={handleReset}
          className={`p-2 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
          title="重置"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3">
        <div className="space-y-3 pb-4">
          {/* ── 合同类型与编号 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <h3 className={sectionTitleClass}>合同基本信息</h3>
            <div className="flex gap-2 mb-3">
              {(['sales', 'purchase'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setContractType(type)}
                  className={`flex-1 py-2 rounded-full text-sm transition-colors ${
                    contractType === type
                      ? 'bg-[var(--os-vnext-brand-blue)] text-white'
                      : isDarkMode
                        ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {type === 'sales' ? '销售合同 Sales' : '采购合同 Purchase'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>合同编号</label>
                <input
                  type="text"
                  value={contractNo}
                  onChange={(e) => setContractNo(e.target.value)}
                  placeholder="留空自动生成"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>签订日期</label>
                <input
                  type="date"
                  value={signDate}
                  onChange={(e) => setSignDate(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>签订地点</label>
                <input
                  type="text"
                  value={signPlace}
                  onChange={(e) => setSignPlace(e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
          </div>

          {/* ── 买卖双方 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <h3 className={sectionTitleClass}>{contractType === 'sales' ? '卖方 / 买方' : '供货方 / 采购方'}</h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{contractType === 'sales' ? '卖方 Seller' : '供货方 Supplier'}</label>
                <select
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">选择卖方...</option>
                  {relationOptions.map(r => (
                    <option key={r.id} value={r.id}>{r.label} ({r.chineseName})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{contractType === 'sales' ? '买方 Buyer' : '采购方 Purchaser'}</label>
                <select
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">选择买方...</option>
                  {relationOptions.map(r => (
                    <option key={r.id} value={r.id}>{r.label} ({r.chineseName})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 关联订单 */}
            <div className="mt-3">
              <label className={labelClass}>关联订单（选填，用于预填信息）</label>
              <div className="relative">
                <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="搜索 PO 号或客户..."
                  className={`${fieldClass} pl-9`}
                />
              </div>
              {searchKeyword && filteredOrders.length > 0 && (
                <div className={`mt-1 max-h-32 overflow-y-auto rounded-inset border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
                  {filteredOrders.map(o => (
                    <button
                      key={o.id}
                      onClick={() => { handleSelectOrder(o.id); setSearchKeyword(''); }}
                      className={`w-full px-3 py-2 text-left text-xs hover:bg-[var(--os-vnext-brand-blue)]/10 transition-colors ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}
                    >
                      <span className="font-mono">{o.poNumber}</span>
                      <span className="ml-2 opacity-60">{o.customer}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 商品明细 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass.replace('mb-3', '')}>商品明细</h3>
              <button
                onClick={addLine}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors flex items-center gap-1 ${
                  isDarkMode ? 'text-[var(--os-vnext-brand-blue)] hover:bg-white/5' : 'text-[var(--os-vnext-brand-blue)] hover:bg-slate-100/60'
                }`}
              >
                <Plus size={12} /> 添加行
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <motion.div
                  key={line.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/5' : 'bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>#{index + 1}</span>
                    {lines.length > 1 && (
                      <button
                        onClick={() => removeLine(line.id)}
                        className={`p-1 rounded text-xs ${isDarkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}
                        title="删除行"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
                    <input
                      type="text"
                      value={line.fabricCode}
                      onChange={(e) => updateLine(line.id, 'fabricCode', e.target.value)}
                      placeholder="面料编码"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                      placeholder="品名描述"
                      className={`${fieldClass} py-1.5 text-xs xl:col-span-2`}
                    />
                    <input
                      type="number"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                      placeholder="数量"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                    <select
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, 'unit', e.target.value)}
                      className={`${fieldClass} py-1.5 text-xs`}
                    >
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.id, 'unitPrice', e.target.value)}
                      placeholder="单价"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
            <div className={`mt-3 pt-3 border-t flex items-center justify-end gap-4 text-xs ${isDarkMode ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
              <span>币种:
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`ml-1 px-2 py-0.5 rounded text-xs ${isDarkMode ? 'bg-white/5 text-white' : 'bg-white text-slate-700'}`}>
                  {['USD', 'CNY', 'EUR'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </span>
              <span>合计: <strong className={isDarkMode ? 'text-white' : 'text-slate-900'}>{formatDocNumber(totals.totalAmount, 2)} {currency}</strong></span>
            </div>
          </div>

          {/* ── 条款 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <div className="flex items-center gap-2 mb-3">
              <Settings2 size={12} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
              <h3 className={sectionTitleClass.replace('mb-3', '')}>合同条款</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>付款方式 Payment Terms</label>
                <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={fieldClass}>
                  {PAYMENT_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>交货条款 Delivery Terms</label>
                <select value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} className={fieldClass}>
                  {DELIVERY_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>品质条款 Quality Clause</label>
                <textarea value={qualityClause} onChange={(e) => setQualityClause(e.target.value)} rows={2} className={`${fieldClass} resize-none`} />
              </div>
              <div>
                <label className={labelClass}>包装条款 Packing Clause</label>
                <textarea value={packingClause} onChange={(e) => setPackingClause(e.target.value)} rows={2} className={`${fieldClass} resize-none`} />
              </div>
              <div>
                <label className={labelClass}>检验条款 Inspection Clause</label>
                <textarea value={inspectionClause} onChange={(e) => setInspectionClause(e.target.value)} rows={2} className={`${fieldClass} resize-none`} />
              </div>
              <div>
                <label className={labelClass}>不可抗力 Force Majeure</label>
                <textarea value={forceMajeure} onChange={(e) => setForceMajeure(e.target.value)} rows={2} className={`${fieldClass} resize-none`} />
              </div>
              <div>
                <label className={labelClass}>仲裁 Arbitration</label>
                <textarea value={arbitration} onChange={(e) => setArbitration(e.target.value)} rows={2} className={`${fieldClass} resize-none`} />
              </div>
            </div>
          </div>

          {/* ── 生成按钮 ── */}
          <div className="space-y-2">
            {generationStatus === 'success' && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-3 rounded-inset border flex items-center gap-2 ${statusSemanticClass('success', isDarkMode)}`}
              >
                <CheckCircle2 size={16} className={statusSemanticText('success', isDarkMode)} />
                <span className="text-sm">合同已生成，请在打印对话框中选择"保存为 PDF"</span>
              </motion.div>
            )}
            {generationStatus === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-3 rounded-inset border flex items-center gap-2 ${statusSemanticClass('danger', isDarkMode)}`}
              >
                <AlertCircle size={16} className={statusSemanticText('danger', isDarkMode)} />
                <span className="text-sm">{errorMessage}</span>
              </motion.div>
            )}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`w-full py-3 rounded-full font-light text-sm flex items-center justify-center gap-2 transition-all duration-300 ${
                isGenerating
                  ? 'bg-slate-500 cursor-not-allowed'
                  : 'bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)]'
              } text-white`}
            >
              {isGenerating ? (
                <><Loader2 size={16} className="animate-spin" /><span>生成中...</span></>
              ) : (
                <><Download size={16} /><span>生成合同 PDF</span></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** 简单的数字转英文单词（用于合同金额大写） */
function numberToWords(num: number): string {
  if (num === 0) return 'ZERO';
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
  const teens = ['TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const scales = ['', 'THOUSAND', 'MILLION', 'BILLION'];

  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);

  const convertInt = (n: number): string => {
    if (n === 0) return '';
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' AND ' + convertInt(n % 100) : '');
    for (let i = scales.length - 1; i >= 0; i--) {
      const scale = Math.pow(1000, i);
      if (n >= scale) {
        return convertInt(Math.floor(n / scale)) + ' ' + scales[i] + (n % scale ? ' ' + convertInt(n % scale) : '');
      }
    }
    return '';
  };

  let result = convertInt(intPart);
  if (decPart > 0) {
    result += ' AND ' + convertInt(decPart) + ' CENTS';
  }
  return result || 'ZERO';
}

export default ContractGenerator;
