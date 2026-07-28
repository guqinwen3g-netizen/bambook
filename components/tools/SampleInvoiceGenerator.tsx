import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  Download,
  FileCode,
  Loader2,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Building2
} from 'lucide-react';
import CustomerSearchInput from '../ui/CustomerSearchInput';
import { Relation } from '../../types';

// ==================== 发票数据接口 ====================
interface InvoiceItem {
  id: string;
  zroh: string;
  description: string;
  qty: number;
  unitPrice: number;
}

interface CustomerOption {
  value: string;
  label: string;
  description?: string;
  billingAddress?: string;
  shippingAddress?: string;
  relation: Relation;
}

// ==================== 公司配置 (复用 invoice-generator.js) ====================
const COMPANY_INFO = {
  name: 'Jiangsu Panda Clothing Co.,Ltd.',
  address: 'ROOM A1028 WUYUE PLAZA',
  city: 'ZHANGJIAGANG CITY,215600 PR',
  country: 'CHINA'
};

const BANK_INFO = {
  name: 'BANK OF CHINA ZHANGJIAGANG SUB-BRANCH',
  swift: 'BKCHCNBJ95L',
  account: '467668133096',
  currency: 'USD'
};

// ==================== 工具函数 ====================
const generateInvoiceNumber = (date: Date): string => {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 90) + 10);
  return `PDAS${yy}${mm}${dd}${seq}`;
};

const formatDate = (date: Date): string => {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${date.getFullYear()} ${months[date.getMonth()]} ${date.getDate()}`;
};

const createEmptyItem = (): InvoiceItem => ({
  id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  zroh: '',
  description: '',
  qty: 0,
  unitPrice: 0
});

// ==================== 组件 ====================
interface SampleInvoiceGeneratorProps {
  isDarkMode: boolean;
  relations?: Relation[];
}

const SampleInvoiceGenerator: React.FC<SampleInvoiceGeneratorProps> = ({ isDarkMode, relations = [] }) => {
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | undefined>();
  const [poNumber, setPoNumber] = useState<string>('');
  const [items, setItems] = useState<InvoiceItem[]>([createEmptyItem()]);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // 初始化日期和发票号
  useEffect(() => {
    const today = new Date();
    setInvoiceDate(today.toISOString().split('T')[0]);
    setInvoiceNumber(generateInvoiceNumber(today));
  }, []);

  // 实时计算总金额
  const calculateTotal = useCallback(() => {
    return items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
  }, [items]);

  // 添加样品行
  const handleAddItem = () => {
    setItems([...items, createEmptyItem()]);
  };

  // 删除样品行
  const handleRemoveItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  // 更新样品行
  const handleItemChange = (id: string, field: keyof InvoiceItem, value: string | number) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  // 客户选择变化
  const handleCustomerChange = (value: string, option?: CustomerOption) => {
    setSelectedCustomer(option);
  };

  // 生成 HTML 预览
  const generatePreview = () => {
    const billTo = selectedCustomer?.billingAddress || selectedCustomer?.label || 'N/A';
    const shipTo = selectedCustomer?.shippingAddress || selectedCustomer?.billingAddress || selectedCustomer?.label || 'N/A';
    const total = calculateTotal();
    const date = invoiceDate ? new Date(invoiceDate) : new Date();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Sample Invoice - ${invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; padding: 40px; background: #fff; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid var(--os-vnext-brand-blue); }
    .company-name { font-size: 18px; font-weight: bold; color: #1a1a1a; }
    .company-address { font-size: 11px; color: #666; margin-top: 8px; }
    .invoice-title { font-size: 18px; font-weight: bold; margin: 20px 0; text-align: center; color: var(--os-vnext-brand-blue); }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .info-block { margin-bottom: 15px; }
    .info-label { font-weight: bold; color: #333; }
    .address-block { margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #f8f9fa; font-weight: bold; color: #333; }
    .text-right { text-align: right; }
    .total { font-size: 16px; font-weight: bold; text-align: right; margin: 20px 0; color: var(--os-vnext-brand-blue); }
    .footer { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 20px; }
    .footer p { margin: 5px 0; font-size: 11px; color: #666; }
    .footer .bank-info { margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-name">${COMPANY_INFO.name}</div>
    <div class="company-address">
      ${COMPANY_INFO.address}<br>
      ${COMPANY_INFO.city}<br>
      ${COMPANY_INFO.country}
    </div>
  </div>

  <div class="invoice-title">SAMPLE INVOICE</div>

  <div class="info-row">
    <div>
      <div class="info-block"><span class="info-label">Invoice Number:</span> ${invoiceNumber}</div>
      <div class="info-block"><span class="info-label">Date:</span> ${formatDate(date)}</div>
    </div>
  </div>

  ${billTo !== 'N/A' ? `
  <div class="address-block">
    <span class="info-label">BILL TO:</span><br>
    ${selectedCustomer?.label || ''}<br>
    ${billTo.replace(/\n/g, '<br>')}
  </div>
  ` : ''}

  ${shipTo !== billTo && shipTo !== 'N/A' ? `
  <div class="address-block">
    <span class="info-label">SHIP TO:</span><br>
    ${selectedCustomer?.label || ''}<br>
    ${shipTo.replace(/\n/g, '<br>')}
  </div>
  ` : ''}

  ${!selectedCustomer ? `
  <div class="address-block">
    <span class="info-label">BILL TO:</span><br>
    ${billTo}
  </div>
  ` : ''}

  ${poNumber ? `<div class="info-block"><span class="info-label">PO Number:</span> ${poNumber}</div>` : ''}

  <table>
    <thead>
      <tr>
        <th style="width: 15%">ZROH#</th>
        <th style="width: 45%">DESCRIPTION</th>
        <th class="text-right" style="width: 12%">QTY (M)</th>
        <th class="text-right" style="width: 13%">UNIT PRICE (USD)</th>
        <th class="text-right" style="width: 15%">AMOUNT (USD)</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
      <tr>
        <td>${item.zroh || '-'}</td>
        <td>${item.description || '-'}</td>
        <td class="text-right">${item.qty || '-'}</td>
        <td class="text-right">$${(item.unitPrice || 0).toFixed(2)}</td>
        <td class="text-right">$${((item.qty || 0) * (item.unitPrice || 0)).toFixed(2)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="total">TOTAL: $${total.toFixed(2)} USD</div>

  <div class="footer">
    <p><span class="info-label">Payment Terms:</span> AS PER AGREEMENT</p>
    <div class="bank-info">
      <p><span class="info-label">Bank Information:</span></p>
      <p>${BANK_INFO.name}</p>
      <p>SWIFT CODE: ${BANK_INFO.swift}</p>
      <p>${BANK_INFO.currency} ACCOUNT: ${BANK_INFO.account}</p>
    </div>
  </div>
</body>
</html>`;

    setPreviewHtml(html);
    return html;
  };

  // 生成发票
  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationStatus('idle');

    try {
      generatePreview();
      setGenerationStatus('success');
    } catch (error) {
      console.error('发票生成失败:', error);
      setGenerationStatus('error');
    } finally {
      setIsGenerating(false);
    }
  };

  // 下载 HTML
  const handleDownload = () => {
    if (!previewHtml) {
      generatePreview();
    }

    const blob = new Blob([previewHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const total = calculateTotal();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="relative z-30 flex-shrink-0">
        <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
          样品发票生成器
        </h2>
        <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          生成 PDAS 格式样品发票文档
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pb-4">
        {/* Form Section */}
        <div className="space-y-3">
          {/* Invoice Info */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
            <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              发票信息
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-[10px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  发票编号
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className={`
                    w-full px-3 py-2 rounded-lg text-sm font-mono
                    ${isDarkMode
                      ? 'bg-white/5 border border-white/10 text-white focus:border-[var(--os-vnext-brand-blue)]/50'
                      : 'bg-white border border-slate-200 text-slate-900 focus:border-[var(--os-vnext-brand-blue)]'}
                    focus:outline-none transition-colors
                  `}
                />
              </div>
              <div>
                <label className={`block text-[10px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  日期
                </label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className={`
                    w-full px-3 py-2 rounded-lg text-sm
                    ${isDarkMode
                      ? 'bg-white/5 border border-white/10 text-white focus:border-[var(--os-vnext-brand-blue)]/50'
                      : 'bg-white border border-slate-200 text-slate-900 focus:border-[var(--os-vnext-brand-blue)]'}
                    focus:outline-none transition-colors
                  `}
                />
              </div>
            </div>
          </div>

          {/* Customer Info */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
            <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              客户信息
            </h3>
            <div className="space-y-3">
              <div>
                <label className={`block text-[10px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  搜索客户
                </label>
                <CustomerSearchInput
                  relations={relations}
                  value={selectedCustomer?.value || ''}
                  onChange={handleCustomerChange}
                  placeholder="输入客户名称搜索..."
                  isDarkMode={isDarkMode}
                />
              </div>

              {/* 显示选中的客户地址信息 */}
              {selectedCustomer && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/5 border border-white/10' : 'bg-slate-50 border border-slate-200'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 size={14} className="text-[var(--os-vnext-brand-blue)]" />
                    <span className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                      {selectedCustomer.label}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {selectedCustomer.billingAddress && (
                      <div className="flex items-start gap-2">
                        <MapPin size={12} className={`mt-0.5 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
                        <div>
                          <span className={`text-[10px] font-light uppercase ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            Bill To
                          </span>
                          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                            {selectedCustomer.billingAddress}
                          </p>
                        </div>
                      </div>
                    )}
                    {selectedCustomer.shippingAddress && (
                      <div className="flex items-start gap-2">
                        <MapPin size={12} className={`mt-0.5 ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`} />
                        <div>
                          <span className={`text-[10px] font-light uppercase ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`}>
                            Ship To
                          </span>
                          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                            {selectedCustomer.shippingAddress}
                          </p>
                        </div>
                      </div>
                    )}
                    {!selectedCustomer.billingAddress && !selectedCustomer.shippingAddress && (
                      <p className={`text-xs italic ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        暂无地址信息，请到关系智库完善
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              <div>
                <label className={`block text-[10px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  PO Number
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="4500159326"
                  className={`
                    w-full px-3 py-2 rounded-lg text-sm
                    ${isDarkMode
                      ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:border-[var(--os-vnext-brand-blue)]/50'
                      : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[var(--os-vnext-brand-blue)]'}
                    focus:outline-none transition-colors
                  `}
                />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-xs font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                样品明细
              </h3>
              <button
                onClick={handleAddItem}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-light
                  transition-all duration-300
                  ${isDarkMode
                    ? 'bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue)]/20'
                    : 'bg-blue-50 text-[var(--os-vnext-brand-blue)] hover:bg-blue-100'}
                `}
              >
                <Plus size={12} />
                添加样品
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="grid grid-cols-12 gap-2 items-end"
                >
                  <div className="col-span-2">
                    <label className={`block text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      ZROH#
                    </label>
                    <input
                      type="text"
                      value={item.zroh}
                      onChange={(e) => handleItemChange(item.id, 'zroh', e.target.value)}
                      placeholder="156111"
                      className={`
                        w-full px-2 py-1.5 rounded-lg text-xs
                        ${isDarkMode
                          ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600'
                          : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'}
                        focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                      `}
                    />
                  </div>
                  <div className="col-span-5">
                    <label className={`block text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      面料描述
                    </label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                      placeholder="70%WOOL/27%POLYESTER..."
                      className={`
                        w-full px-2 py-1.5 rounded-lg text-xs
                        ${isDarkMode
                          ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600'
                          : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'}
                        focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                      `}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={`block text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      数量(M)
                    </label>
                    <input
                      type="number"
                      value={item.qty || ''}
                      onChange={(e) => handleItemChange(item.id, 'qty', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      min="0"
                      className={`
                        w-full px-2 py-1.5 rounded-lg text-xs text-right
                        ${isDarkMode
                          ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600'
                          : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'}
                        focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                      `}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={`block text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      单价(USD)
                    </label>
                    <input
                      type="number"
                      value={item.unitPrice || ''}
                      onChange={(e) => handleItemChange(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className={`
                        w-full px-2 py-1.5 rounded-lg text-xs text-right
                        ${isDarkMode
                          ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600'
                          : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'}
                        focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                      `}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={items.length === 1}
                      className={`
                        p-1.5 rounded-lg transition-all duration-300
                        ${items.length === 1
                          ? 'opacity-30 cursor-not-allowed'
                          : isDarkMode
                            ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-400/10'
                            : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'}
                      `}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Total */}
            <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-light ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  合计金额
                </span>
                <span className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                  <span className="text-xs opacity-50">$</span>
                  {total.toFixed(2)}
                  <span className="text-xs ml-1 opacity-50">USD</span>
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`
                flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-light
                transition-all duration-300
                ${isDarkMode
                  ? 'bg-[var(--os-vnext-brand-blue)] text-white hover:bg-[var(--os-vnext-brand-blue)]/90'
                  : 'bg-[var(--os-vnext-brand-blue)] text-white hover:bg-[var(--os-vnext-brand-blue)]/90'}
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <FileCode size={16} />
                  生成发票
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              disabled={!previewHtml}
              className={`
                flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-light
                transition-all duration-300
                ${previewHtml
                  ? isDarkMode
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'opacity-50 cursor-not-allowed'}
              `}
            >
              <Download size={16} />
              下载
            </button>
          </div>

          {/* Status */}
          {generationStatus !== 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`
                flex items-center gap-2 p-3 rounded-xl text-sm
                ${generationStatus === 'success'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-rose-500/10 text-rose-500'}
              `}
            >
              {generationStatus === 'success' ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span>{generationStatus === 'success' ? '发票生成成功！' : '生成失败，请重试'}</span>
            </motion.div>
          )}
        </div>

        {/* Preview Section */}
        <div className={`rounded-xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
          <div className={`px-4 py-3 border-b flex-shrink-0 ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
            <h3 className={`text-xs font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              预览区域
            </h3>
          </div>
          <div className="flex-1 min-h-0">
            {previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                title="Invoice Preview"
                className="w-full h-full border-0"
              />
            ) : (
              <div className={`
                flex flex-col items-center justify-center h-full
                ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}
              `}>
                <FileCode size={48} strokeWidth={0.5} className="mb-4 opacity-30" />
                <p className="text-sm">填写表单后点击"生成发票"预览</p>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default SampleInvoiceGenerator;
