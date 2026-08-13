/**
 * 装箱单生成器
 * 从订单数据生成出口装箱明细单（Packing List）HTML → 打印/PDF
 */

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Package,
  Plus,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Order, Relation } from '../../types';
import { statusSemanticClass, statusSemanticText } from '../rdlBusinessStatusTokens';
import { printHtmlDocument, formatDate, formatDocNumber, escapeHtml } from './printDocument';
import { getExporterProfile } from './exportDocs/exporterProfile';

// ==================== 类型 ====================
interface PackingLine {
  id: string;
  poNumber: string;
  description: string;
  fabricCode: string;
  quantity: string;
  unit: string;
  cartons: string;
  qtyPerCarton: string;
  grossWeight: string;
  netWeight: string;
  cartonDimensions: string;
}

interface PackingListGeneratorProps {
  isDarkMode: boolean;
  relations?: Relation[];
  orders?: Order[];
}

const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'] as const;

let lineIdCounter = 0;
const newLineId = () => `pl_line_${Date.now()}_${++lineIdCounter}`;

const createEmptyLine = (poNumber = ''): PackingLine => ({
  id: newLineId(),
  poNumber,
  description: '',
  fabricCode: '',
  quantity: '',
  unit: 'YD',
  cartons: '',
  qtyPerCarton: '',
  grossWeight: '',
  netWeight: '',
  cartonDimensions: '',
});

const PackingListGenerator: React.FC<PackingListGeneratorProps> = ({
  isDarkMode,
  relations = [],
  orders = [],
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedRelationId, setSelectedRelationId] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [lines, setLines] = useState<PackingLine[]>([createEmptyLine()]);
  const [destinationPort, setDestinationPort] = useState('');
  const [shippingMark, setShippingMark] = useState('');
  const [shipper, setShipper] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // 客户/供应商选项
  const relationOptions = useMemo(() => {
    return relations
      .filter(r => !r.deletedAt && (r.type === 'Customer' || r.type === 'Supplier'))
      .map(r => ({
        id: r.id,
        label: r.englishName || r.chineseName || r.name,
        chineseName: r.chineseName || r.name,
        address: r.shippingAddress || r.officialAddress || r.billingAddress || '',
      }));
  }, [relations]);

  // 订单搜索
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

  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId), [orders, selectedOrderId]);
  const selectedRelation = useMemo(() => relations.find(r => r.id === selectedRelationId), [relations, selectedRelationId]);

  // 选择订单时自动填充第一行
  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    const order = orders.find(o => o.id === orderId);
    if (order) {
      setLines(prev => prev.map((line, i) =>
        i === 0 ? {
          ...line,
          poNumber: order.poNumber || '',
          description: order.customer || '',
        } : line
      ));
    }
  };

  const updateLine = (id: string, field: keyof PackingLine, value: string) => {
    setLines(prev => prev.map(l => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const addLine = () => {
    setLines(prev => [...prev, createEmptyLine(selectedOrder?.poNumber || '')]);
  };

  const removeLine = (id: string) => {
    setLines(prev => (prev.length > 1 ? prev.filter(l => l.id !== id) : prev));
  };

  // 汇总计算
  const totals = useMemo(() => {
    const parseNum = (s: string) => (Number.isFinite(parseFloat(s)) ? parseFloat(s) : 0);
    return {
      totalCartons: lines.reduce((sum, l) => sum + parseNum(l.cartons), 0),
      totalQuantity: lines.reduce((sum, l) => sum + parseNum(l.quantity), 0),
      totalGrossWeight: lines.reduce((sum, l) => sum + parseNum(l.grossWeight), 0),
      totalNetWeight: lines.reduce((sum, l) => sum + parseNum(l.netWeight), 0),
    };
  }, [lines]);

  // 生成装箱单 HTML 并打印
  const handleGenerate = async () => {
    const validLines = lines.filter(l => l.description || l.quantity || l.cartons);
    if (validLines.length === 0) {
      setErrorMessage('请至少填写一行装箱明细');
      setGenerationStatus('error');
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('idle');
    setErrorMessage('');

    try {
      const docNo = `PL-${Date.now().toString(36).toUpperCase()}`;
      const today = formatDate(new Date());

      const buyerName = selectedRelation?.englishName || selectedRelation?.chineseName || selectedRelation?.name || selectedOrder?.customer || '';
      const buyerAddress = selectedRelation?.shippingAddress || selectedRelation?.officialAddress || '';

      const rowsHtml = validLines.map((l, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(l.poNumber)}</td>
          <td>${escapeHtml(l.fabricCode)}</td>
          <td>${escapeHtml(l.description)}</td>
          <td style="text-align:center">${escapeHtml(l.qtyPerCarton)}</td>
          <td style="text-align:center">${escapeHtml(l.cartons)}</td>
          <td style="text-align:right">${escapeHtml(l.quantity)}</td>
          <td style="text-align:center">${escapeHtml(l.unit)}</td>
          <td style="text-align:right">${escapeHtml(l.netWeight)}</td>
          <td style="text-align:right">${escapeHtml(l.grossWeight)}</td>
          <td style="text-align:center">${escapeHtml(l.cartonDimensions)}</td>
        </tr>
      `).join('');

      const htmlBody = `
        <div class="doc-header">
          <div class="doc-title-block">
            <h1>PACKING LIST</h1>
            <div class="subtitle">装箱单 · 装箱明细单</div>
          </div>
          <div class="doc-meta">
            <div class="doc-no">${escapeHtml(docNo)}</div>
            <div>Date: ${escapeHtml(today)}</div>
            ${invoiceNumber ? `<div>Invoice No: ${escapeHtml(invoiceNumber)}</div>` : ''}
          </div>
        </div>

        <div class="doc-party-grid">
          <div class="doc-party">
            <div class="label">Shipper / Consignor 发货方</div>
            <div class="name">${escapeHtml(shipper || getExporterProfile().nameEn)}</div>
            <div class="detail">${escapeHtml(getExporterProfile().addressEn.replace(/\n/g, ', '))}</div>
          </div>
          <div class="doc-party">
            <div class="label">Consignee / Buyer 收货方</div>
            <div class="name">${escapeHtml(buyerName)}</div>
            <div class="detail">${escapeHtml(buyerAddress)}</div>
          </div>
        </div>

        ${destinationPort ? `
        <div class="doc-section">
          <div class="doc-section-title">Shipping Information 装运信息</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:11px">
            <div><strong>Destination Port 目的港:</strong> ${escapeHtml(destinationPort)}</div>
            ${shippingMark ? `<div><strong>Shipping Mark 唛头:</strong> ${escapeHtml(shippingMark)}</div>` : ''}
          </div>
        </div>` : ''}

        <table class="doc-table">
          <thead>
            <tr>
              <th style="width:30px">No.</th>
              <th>PO No.</th>
              <th>Fabric Code</th>
              <th>Description</th>
              <th style="text-align:center">Qty/Ctn</th>
              <th style="text-align:center">Ctns</th>
              <th style="text-align:right">Quantity</th>
              <th style="text-align:center">Unit</th>
              <th style="text-align:right">N.W.(kg)</th>
              <th style="text-align:right">G.W.(kg)</th>
              <th style="text-align:center">Carton Dim</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="5" style="text-align:right">TOTAL 合计</td>
              <td style="text-align:center">${formatDocNumber(totals.totalCartons, 0)}</td>
              <td style="text-align:right">${formatDocNumber(totals.totalQuantity, 2)}</td>
              <td></td>
              <td style="text-align:right">${formatDocNumber(totals.totalNetWeight, 2)}</td>
              <td style="text-align:right">${formatDocNumber(totals.totalGrossWeight, 2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div class="doc-notes">
          <div class="notes-title">Remarks 备注</div>
          <div>This packing list is computer-generated and is valid without signature.</div>
          <div>本装箱单由系统自动生成，无需签字即生效。</div>
        </div>

        <div class="doc-footer">
          <div class="doc-signature">
            <div class="sig-label">For Shipper 发货方签字</div>
            <div class="sig-line"></div>
            <div class="sig-name">Authorized Signature</div>
          </div>
          <div class="doc-signature">
            <div class="sig-label">For Consignee 收货方签字</div>
            <div class="sig-line"></div>
            <div class="sig-name">Received in Good Condition</div>
          </div>
        </div>
      `;

      printHtmlDocument({ title: `装箱单-${docNo}`, htmlBody });
      setGenerationStatus('success');
    } catch (error: any) {
      console.error('装箱单生成失败:', error);
      setErrorMessage('生成失败: ' + (error.message || '未知错误'));
      setGenerationStatus('error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setSelectedOrderId('');
    setSelectedRelationId('');
    setSearchKeyword('');
    setLines([createEmptyLine()]);
    setDestinationPort('');
    setShippingMark('');
    setShipper('');
    setInvoiceNumber('');
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
            装箱单生成器
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            生成出口装箱明细单 · 支持 PDF 打印
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
          {/* ── 订单与客户选择 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <h3 className={sectionTitleClass}>订单与客户</h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {/* 订单搜索选择 */}
              <div>
                <label className={labelClass}>选择订单</label>
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
                {selectedOrder && (
                  <div className={`mt-1 px-3 py-1.5 rounded-inset text-xs ${isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/10 text-slate-300' : 'bg-[var(--os-vnext-brand-blue)]/5 text-slate-700'}`}>
                    已选: {selectedOrder.poNumber} — {selectedOrder.customer}
                  </div>
                )}
              </div>

              {/* 客户选择 */}
              <div>
                <label className={labelClass}>收货方（客户）</label>
                <select
                  value={selectedRelationId}
                  onChange={(e) => setSelectedRelationId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">选择客户...</option>
                  {relationOptions.map(r => (
                    <option key={r.id} value={r.id}>{r.label} ({r.chineseName})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 装运信息 */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className={labelClass}>目的港</label>
                <input
                  type="text"
                  value={destinationPort}
                  onChange={(e) => setDestinationPort(e.target.value)}
                  placeholder="如 SURABAYA"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>发票号（选填）</label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="INV-2026-001"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>发货方名称</label>
                <input
                  type="text"
                  value={shipper}
                  onChange={(e) => setShipper(e.target.value)}
                  placeholder="留空使用默认公司"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>唛头（Shipping Mark）</label>
                <input
                  type="text"
                  value={shippingMark}
                  onChange={(e) => setShippingMark(e.target.value)}
                  placeholder="如 PANDA / SURABAYA / 1-UP"
                  className={fieldClass}
                />
              </div>
            </div>
          </div>

          {/* ── 装箱明细行 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass.replace('mb-3', '')}>装箱明细</h3>
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
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={line.poNumber}
                      onChange={(e) => updateLine(line.id, 'poNumber', e.target.value)}
                      placeholder="PO 号"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
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
                      value={line.qtyPerCarton}
                      onChange={(e) => updateLine(line.id, 'qtyPerCarton', e.target.value)}
                      placeholder="每箱数量"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                    <input
                      type="number"
                      value={line.cartons}
                      onChange={(e) => updateLine(line.id, 'cartons', e.target.value)}
                      placeholder="箱数"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                    <input
                      type="number"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                      placeholder="总数量"
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
                      value={line.netWeight}
                      onChange={(e) => updateLine(line.id, 'netWeight', e.target.value)}
                      placeholder="净重 kg"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={line.grossWeight}
                      onChange={(e) => updateLine(line.id, 'grossWeight', e.target.value)}
                      placeholder="毛重 kg"
                      className={`${fieldClass} py-1.5 text-xs`}
                    />
                    <input
                      type="text"
                      value={line.cartonDimensions}
                      onChange={(e) => updateLine(line.id, 'cartonDimensions', e.target.value)}
                      placeholder="箱规 L×W×H"
                      className={`${fieldClass} py-1.5 text-xs xl:col-span-2`}
                    />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* 合计 */}
            <div className={`mt-3 pt-3 border-t flex items-center justify-around text-xs ${isDarkMode ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
              <span>总箱数: <strong className={isDarkMode ? 'text-white' : 'text-slate-900'}>{formatDocNumber(totals.totalCartons, 0)}</strong></span>
              <span>总数量: <strong className={isDarkMode ? 'text-white' : 'text-slate-900'}>{formatDocNumber(totals.totalQuantity, 2)}</strong></span>
              <span>总净重: <strong className={isDarkMode ? 'text-white' : 'text-slate-900'}>{formatDocNumber(totals.totalNetWeight, 2)} kg</strong></span>
              <span>总毛重: <strong className={isDarkMode ? 'text-white' : 'text-slate-900'}>{formatDocNumber(totals.totalGrossWeight, 2)} kg</strong></span>
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
                <span className="text-sm">装箱单已生成，请在打印对话框中选择"保存为 PDF"</span>
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
                <><Download size={16} /><span>生成装箱单 PDF</span></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PackingListGenerator;
