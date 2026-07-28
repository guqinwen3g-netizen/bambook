/**
 * 发货通知生成器
 * 从 PO 数据库获取订单数据生成发货通知 Excel
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Package,
  Search,
  Plus,
  Trash2,
  Download,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Ship,
  RefreshCw
} from 'lucide-react';
import { apiService } from '../../services/apiService';
import { Order, Relation } from '../../types';
import { statusSemanticClass, statusSemanticText } from '../rdlBusinessStatusTokens';

// ==================== 类型定义 ====================
interface POOrder {
  id: number;
  po_number: string;
  season: string;
  order_date: string;
  customer_name: string;
  supplier_name: string;
  contact_person: string;
  delivery_terms: string;
  payment_terms: string;
  currency: string;
  total_amount: number;
  status: string;
  source_file: string;
}

interface POItem {
  id: number;
  po_number: string;
  item_no: string;
  peerless_number: string;
  zroh_number: string;
  quality_description: string;
  fabric_code: string;
  width: string;
  exmill_date: string;
  delivery_date: string;
  quantity: number;
  unit: string;
  unit_price: number;
  fabric_content: string;
  gsm: string;
  net_value: number;
  shipping_method: string;
  category: string;
}

interface ShippingOptions {
  destinationPort: string;
  shipmentDate: string;
  paymentTerms: string;
  shippingMethod: string;
  forwarder: string;
  remarks: string;
}

// ==================== 常用目的港选项 ====================
const DESTINATION_PORTS = [
  'SURABAYA (印尼泗水)',
  'JAKARTA (印尼雅加达)',
  'HO CHI MINH (越南胡志明)',
  'BANGKOK (泰国曼谷)',
  'PORT KLANG (马来西亚巴生港)',
  'MANILA (菲律宾马尼拉)',
  'CHITTAGONG (孟加拉吉大港)',
  'CHENNAI (印度金奈)',
  'COLOMBO (斯里兰卡科伦坡)',
];

const PAYMENT_TERMS_OPTIONS = [
  'TT 30DAYS',
  'TT 45DAYS',
  'TT 60DAYS',
  'L/C AT SIGHT',
  'L/C 30DAYS',
  'D/P',
];

const SHIPPING_METHODS = ['海运', '空运', '海空联运'];

// ==================== 组件 ====================
interface ShippingNoticeGeneratorProps {
  isDarkMode: boolean;
  relations?: Relation[];
  orders?: Order[];
}

const ShippingNoticeGenerator: React.FC<ShippingNoticeGeneratorProps> = ({
  isDarkMode,
  relations = [],
  orders = []
}) => {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedPOs, setSelectedPOs] = useState<POOrder[]>([]);
  const [availablePOs, setAvailablePOs] = useState<POOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [options, setOptions] = useState<ShippingOptions>({
    destinationPort: '',
    shipmentDate: new Date().toISOString().split('T')[0],
    paymentTerms: '',
    shippingMethod: '海运',
    forwarder: '指定货代，等通知',
    remarks: '',
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // 加载订单列表（从 props 传入的 orders，不再调后端 PO 接口）
  const loadOrders = useCallback(async (keyword: string = '') => {
    setIsLoading(true);
    try {
      const keywordLower = keyword.toLowerCase();
      const filtered = orders
        .filter(o => !o.deletedAt && o.poNumber)
        .filter(o => !keyword || 
          (o.poNumber && o.poNumber.toLowerCase().includes(keywordLower)) ||
          (o.customer && o.customer.toLowerCase().includes(keywordLower)) ||
          (o.clientCode && o.clientCode.toLowerCase().includes(keywordLower))
        )
        .map((o, index) => ({
          id: index + 1,
          po_number: o.poNumber || '',
          season: o.season || '',
          customer_name: o.customer || '',
          supplier_name: o.millName || '',
          contact_person: o.clientCode || '',
          delivery_terms: '',
          payment_terms: '',
          order_date: o.poDate || '',
          total_amount: o.quoteAmount || 0,
          currency: 'USD',
          status: o.status,
          source_file: '',
        }));
      const selectedPOsSet = new Set(selectedPOs.map(p => p.po_number));
      setAvailablePOs(filtered.filter(po => !selectedPOsSet.has(po.po_number)));
    } catch (error) {
      console.error('加载订单失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [orders, selectedPOs]);

  // 初始加载和搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      loadOrders(searchKeyword);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchKeyword, loadOrders]);

  // 添加 PO 到选中列表
  const handleAddPO = (po: POOrder) => {
    setSelectedPOs([...selectedPOs, po]);
    setAvailablePOs(availablePOs.filter(p => p.po_number !== po.po_number));
    setSearchKeyword('');
  };

  // 从选中列表移除
  const handleRemovePO = (poNumber: string) => {
    const po = selectedPOs.find(p => p.po_number === poNumber);
    if (po) {
      setAvailablePOs([...availablePOs, po]);
    }
    setSelectedPOs(selectedPOs.filter(p => p.po_number !== poNumber));
  };

  // 全选
  const handleSelectAll = () => {
    const newSelected = availablePOs.slice(0, 10);
    setSelectedPOs([...selectedPOs, ...newSelected]);
    setAvailablePOs(availablePOs.filter(p => !newSelected.some(s => s.po_number === p.po_number)));
  };

  // 生成发货通知
  const handleGenerate = async () => {
    if (selectedPOs.length === 0) {
      setErrorMessage('请至少选择一个订单');
      setGenerationStatus('error');
      return;
    }

    if (!options.destinationPort) {
      setErrorMessage('请选择目的港');
      setGenerationStatus('error');
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('idle');
    setErrorMessage('');

    try {
      const result = await apiService.generateShippingNotice({
        poNumbers: selectedPOs.map(po => po.po_number),
        options: {
          destinationPort: options.destinationPort,
          shipmentDate: options.shipmentDate,
          paymentTerms: options.paymentTerms,
          forwarder: options.forwarder,
          remarks: options.remarks,
        }
      });

      if (result.success) {
        setGenerationStatus('success');
        // 触发下载
        if (result.downloadUrl) {
          window.open(result.downloadUrl, '_blank');
        }
      } else {
        setErrorMessage(result.error || '生成失败');
        setGenerationStatus('error');
      }
    } catch (error: any) {
      console.error('发货通知生成失败:', error);
      setErrorMessage('生成失败: ' + (error.message || '请检查后端服务'));
      setGenerationStatus('error');
    } finally {
      setIsGenerating(false);
    }
  };

  // 重置
  const handleReset = () => {
    setSelectedPOs([]);
    setSearchKeyword('');
    setOptions({
      destinationPort: '',
      shipmentDate: new Date().toISOString().split('T')[0],
      paymentTerms: '',
      shippingMethod: '海运',
      forwarder: '指定货代，等通知',
      remarks: '',
    });
    setGenerationStatus('idle');
    loadOrders();
  };

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="relative z-30 flex-shrink-0 flex items-end justify-between pb-1">
        <div>
          <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            发货通知生成器
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            从 PO 数据库生成标准发货通知 Excel
          </p>
        </div>
        <button
          onClick={handleReset}
          className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
          title="重置"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pb-4">
          {/* Left Column - PO Selection */}
          <div className="space-y-3">
            {/* PO Search */}
            <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
              <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                订单选择
              </h3>

              {/* Search Input */}
              <div className="relative mb-3">
                <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="搜索 PO 号、客户或供应商..."
                  className={`
                    w-full pl-9 pr-3 py-2 rounded-lg text-sm
                    ${isDarkMode
                      ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-500'
                      : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'}
                    focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                  `}
                />
              </div>

              {/* Available POs */}
              <div className="space-y-2 max-h-[180px] overflow-y-auto">
                {isLoading ? (
                  <div className={`text-center py-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                    <span className="text-xs">加载中...</span>
                  </div>
                ) : availablePOs.length > 0 ? (
                  <>
                    <div className="flex justify-between items-center">
                      <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        可选订单 ({availablePOs.length})
                      </span>
                      <button
                        onClick={handleSelectAll}
                        className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)] hover:bg-white/5' : 'text-[var(--os-vnext-brand-blue)] hover:bg-slate-100/60'}`}
                      >
                        全选
                      </button>
                    </div>
                    {availablePOs.slice(0, 15).map(po => (
                      <motion.button
                        key={po.po_number}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => handleAddPO(po)}
                        className={`
                          w-full p-3 rounded-lg text-left transition-all
                          ${isDarkMode
                            ? 'bg-white/5 hover:bg-white/10 border border-white/5'
                            : 'bg-slate-50 hover:bg-slate-100 border border-slate-200'}
                        `}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className={`text-sm font-mono font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                              {po.po_number}
                            </span>
                            <span className={`text-xs ml-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                              {po.customer_name}
                            </span>
                          </div>
                          <Plus size={14} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} />
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs ${isDarkMode ? 'text-slate-600' : 'text-slate-500'}`}>
                            {po.supplier_name}
                          </span>
                          <span className={`text-xs ${isDarkMode ? 'text-slate-700' : 'text-slate-400'}`}>
                            ${po.total_amount?.toLocaleString()}
                          </span>
                        </div>
                      </motion.button>
                    ))}
                  </>
                ) : (
                  <div className={`text-center py-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    <Package size={24} className="mx-auto mb-2 opacity-30" />
                    <span className="text-xs">无匹配订单</span>
                  </div>
                )}
              </div>
            </div>

            {/* Selected POs */}
            {selectedPOs.length > 0 && (
              <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
                <div className="flex justify-between items-center mb-3">
                  <h3 className={`text-xs font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    已选订单 ({selectedPOs.length})
                  </h3>
                </div>
                <div className="space-y-2 max-h-[150px] overflow-y-auto">
                  {selectedPOs.map(po => (
                    <div
                      key={po.po_number}
                      className={`
                        flex items-center justify-between p-2 rounded-lg
                        ${isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/10 border border-[var(--os-vnext-brand-blue)]/20' : 'bg-[var(--os-vnext-brand-blue)]/[0.05] border border-[var(--os-vnext-brand-blue)]/20'}
                      `}
                    >
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          {po.po_number}
                        </span>
                        <span className={`text-xs ml-2 truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {po.customer_name}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemovePO(po.po_number)}
                        className={`p-1 rounded ${statusSemanticText('destructive', isDarkMode)} ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-slate-100/60'}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Shipping Options */}
          <div className="space-y-3">
            {/* Basic Info */}
            <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
              <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                发货信息
              </h3>
              <div className="space-y-3">
                {/* Destination Port */}
                <div>
                  <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    目的港 *
                  </label>
                  <select
                    value={options.destinationPort}
                    onChange={(e) => setOptions({ ...options, destinationPort: e.target.value })}
                    className={`
                      w-full px-3 py-2 rounded-lg text-sm
                      ${isDarkMode
                        ? 'bg-white/5 border border-white/10 text-white'
                        : 'bg-white border border-slate-200 text-slate-900'}
                      focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                    `}
                  >
                    <option value="">选择目的港...</option>
                    {DESTINATION_PORTS.map(port => (
                      <option key={port} value={port}>{port}</option>
                    ))}
                  </select>
                </div>

                {/* Shipment Date */}
                <div>
                  <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    装船期限
                  </label>
                  <input
                    type="date"
                    value={options.shipmentDate}
                    onChange={(e) => setOptions({ ...options, shipmentDate: e.target.value })}
                    className={`
                      w-full px-3 py-2 rounded-lg text-sm
                      ${isDarkMode
                        ? 'bg-white/5 border border-white/10 text-white'
                        : 'bg-white border border-slate-200 text-slate-900'}
                      focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                    `}
                  />
                </div>

                {/* Payment Terms */}
                <div>
                  <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    付款方式
                  </label>
                  <select
                    value={options.paymentTerms}
                    onChange={(e) => setOptions({ ...options, paymentTerms: e.target.value })}
                    className={`
                      w-full px-3 py-2 rounded-lg text-sm
                      ${isDarkMode
                        ? 'bg-white/5 border border-white/10 text-white'
                        : 'bg-white border border-slate-200 text-slate-900'}
                      focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                    `}
                  >
                    <option value="">选择付款方式...</option>
                    {PAYMENT_TERMS_OPTIONS.map(term => (
                      <option key={term} value={term}>{term}</option>
                    ))}
                  </select>
                </div>

                {/* Shipping Method */}
                <div>
                  <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    运输方式
                  </label>
                  <div className="flex gap-2">
                    {SHIPPING_METHODS.map(method => (
                      <button
                        key={method}
                        onClick={() => setOptions({ ...options, shippingMethod: method })}
                        className={`
                          flex-1 py-2 rounded-lg text-sm transition-colors
                          ${options.shippingMethod === method
                            ? 'bg-[var(--os-vnext-brand-blue)] text-white'
                            : isDarkMode
                              ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                        `}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Forwarder */}
                <div>
                  <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    联系货代
                  </label>
                  <input
                    type="text"
                    value={options.forwarder}
                    onChange={(e) => setOptions({ ...options, forwarder: e.target.value })}
                    className={`
                      w-full px-3 py-2 rounded-lg text-sm
                      ${isDarkMode
                        ? 'bg-white/5 border border-white/10 text-white'
                        : 'bg-white border border-slate-200 text-slate-900'}
                      focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                    `}
                  />
                </div>

                {/* Remarks */}
                <div>
                  <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    备注
                  </label>
                  <textarea
                    value={options.remarks}
                    onChange={(e) => setOptions({ ...options, remarks: e.target.value })}
                    rows={2}
                    className={`
                      w-full px-3 py-2 rounded-lg text-sm resize-none
                      ${isDarkMode
                        ? 'bg-white/5 border border-white/10 text-white'
                        : 'bg-white border border-slate-200 text-slate-900'}
                      focus:outline-none focus:border-[var(--os-vnext-brand-blue)] transition-colors
                    `}
                  />
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <div className="space-y-2">
              {/* Status Messages */}
              {generationStatus === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg border flex items-center gap-2 ${statusSemanticClass('success', isDarkMode)}`}
                >
                  <CheckCircle2 size={16} className={statusSemanticText('success', isDarkMode)} />
                  <span className="text-sm">
                    发货通知已生成并下载
                  </span>
                </motion.div>
              )}

              {generationStatus === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg border flex items-center gap-2 ${statusSemanticClass('danger', isDarkMode)}`}
                >
                  <AlertCircle size={16} className={statusSemanticText('danger', isDarkMode)} />
                  <span className="text-sm">
                    {errorMessage}
                  </span>
                </motion.div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || selectedPOs.length === 0}
                className={`
                  w-full py-3 rounded-xl font-light text-sm flex items-center justify-center gap-2
                  transition-all duration-300
                  ${isGenerating
                    ? 'bg-slate-500 cursor-not-allowed'
                    : selectedPOs.length === 0
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)]'}
                  text-white
                `}
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <Ship size={16} />
                    <span>生成发货通知</span>
                    {selectedPOs.length > 0 && (
                      <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                        {selectedPOs.length} 个订单
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShippingNoticeGenerator;
