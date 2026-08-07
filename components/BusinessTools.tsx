import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Receipt,
  FileText,
  Package,
  Calculator,
  TrendingUp,
  ArrowRight,
  ChevronRight,
  Lock,
  LucideIcon,
  Ship,
  Upload,
  Layers,
  Cog
} from 'lucide-react';
import FabricSampleInvoiceGenerator from './tools/FabricSampleInvoiceGenerator';
import ShippingNoticeGenerator from './tools/ShippingNoticeGenerator';
import ExchangeRateTool from './tools/ExchangeRateTool';
import QuoteCalculator from './tools/QuoteCalculator';
import PackingListGenerator from './tools/PackingListGenerator';
import ContractGenerator from './tools/ContractGenerator';
import ShipmentDocumentGenerator from './tools/ShipmentDocumentGenerator';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import {
  CompiledInteractiveCard,
  COMPILED_SIDE_PANEL_BASE_CLASS,
  COMPILED_SIDE_PANEL_DARK_CLASS,
  COMPILED_SIDE_PANEL_LIGHT_CLASS
} from './ui/osCompiler/compiledPrimitives';
import { PageHeader } from './ui/PageHeader';
import {
  SIDEBAR_HOVER_DARK_CLASS,
  SIDEBAR_HOVER_LIGHT_CLASS
} from './ui/osCompiler/compiledSidebarTemplates';
import { Relation, Order, View } from '../types';

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  status: 'available' | 'coming-soon';
  component?: React.ReactNode;
  /** 设置了 targetView 的卡片点击后跳转对应视图（而非打开内嵌面板） */
  targetView?: View;
}

interface BusinessToolsProps {
  isDarkMode: boolean;
  relations?: Relation[];
  orders?: Order[];
  onNavigate?: (view: View) => void;
}

const BusinessTools: React.FC<BusinessToolsProps> = ({ isDarkMode, relations = [], orders = [], onNavigate }) => {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const toolsScrollRef = useRef<HTMLDivElement>(null);
  const toolContentScrollRef = useRef<HTMLDivElement>(null);

  const tools: Tool[] = [
    {
      id: 'po-import',
      name: 'PO 文件导入',
      description: '跳转订单管理页，使用 PO 导入向导',
      icon: Upload,
      status: 'available',
      targetView: View.Orders,
    },
    {
      id: 'mes-console',
      name: '生产执行 MES',
      description: '工位排产 · 工时 · 计件 · 外协加工（可选模块，非核心流程）',
      icon: Cog,
      status: 'available',
      targetView: View.MES,
    },
    {
      id: 'sample-invoice',
      name: '样品发票生成器',
      description: '生成 Panda 面料样品发票',
      icon: Receipt,
      status: 'available',
      component: <FabricSampleInvoiceGenerator isDarkMode={isDarkMode} relations={relations} />
    },
    {
      id: 'shipping-notice',
      name: '发货通知生成器',
      description: '从订单生成发货通知 Excel',
      icon: Ship,
      status: 'available',
      component: <ShippingNoticeGenerator isDarkMode={isDarkMode} relations={relations} orders={orders} />
    },
    {
      id: 'contract-generator',
      name: '合同生成器',
      description: '采购/销售合同模板 · PDF 打印',
      icon: FileText,
      status: 'available',
      component: <ContractGenerator isDarkMode={isDarkMode} relations={relations} orders={orders} />
    },
    {
      id: 'packing-list',
      name: '装箱单生成器',
      description: '生成出口装箱明细单 · PDF 打印',
      icon: Package,
      status: 'available',
      component: <PackingListGenerator isDarkMode={isDarkMode} relations={relations} orders={orders} />
    },
    {
      id: 'shipment-documents',
      name: '出运制单引擎',
      description: '运单一键生成 CI/PL/CO/BL 成套单据',
      icon: Layers,
      status: 'available',
      component: <ShipmentDocumentGenerator isDarkMode={isDarkMode} />
    },
    {
      id: 'quote-calculator',
      name: '报价计算器',
      description: '成本测算 · 利润分析 · FOB/CIF 报价',
      icon: Calculator,
      status: 'available',
      component: <QuoteCalculator isDarkMode={isDarkMode} />
    },
    {
      id: 'exchange-rate',
      name: '退税核算汇率',
      description: '退税换算 · 实时汇率 · 快速算成本',
      icon: TrendingUp,
      status: 'available',
      component: <ExchangeRateTool isDarkMode={isDarkMode} />
    }
  ];

  const handleToolClick = (tool: Tool) => {
    if (tool.targetView) {
      onNavigate?.(tool.targetView);
      return;
    }
    if (tool.status === 'available') {
      setSelectedTool(tool.id);
    }
  };

  const handleBack = () => {
    setSelectedTool(null);
  };

  const cardDarkClass = `${COMPILED_SIDE_PANEL_BASE_CLASS} ${COMPILED_SIDE_PANEL_DARK_CLASS} ${OS_MATERIAL.raisedCard} ${SIDEBAR_HOVER_DARK_CLASS}`;
  const cardLightClass = `${COMPILED_SIDE_PANEL_BASE_CLASS} ${COMPILED_SIDE_PANEL_LIGHT_CLASS} ${OS_MATERIAL.raisedCard} ${SIDEBAR_HOVER_LIGHT_CLASS}`;

  return (
    <div
      data-os-compiler-page="business-tools"
      className="w-full h-full flex flex-col bg-transparent overflow-visible"
    >
      <PageHeader
        title="业务工具箱"
        subtitle="Business Tools"
        isDarkMode={isDarkMode}
      />

      <div className="flex-1 min-h-0 flex flex-col relative">
        <AnimatePresence mode="wait">
          {selectedTool ? (
            <motion.div
              key="tool-content"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 min-h-0 flex flex-col relative px-8 pb-12 pt-3"
            >
              {/* Back Button */}
              <button
                onClick={handleBack}
                className={`mb-4 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-light transition-all duration-300 w-fit
                ${isDarkMode
                  ? 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.05]'
                  : 'bg-white/45 border-black/[0.04] text-slate-500 hover:text-slate-900 hover:bg-white/70'}`}
              >
                <ChevronRight size={14} className="rotate-180" />
                <span>返回工具箱</span>
              </button>

              {/* Tool Content with Fade */}
              <div className="flex-1 min-h-0 relative">
                <ScrollEdgeFades scrollRef={toolContentScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
                <div ref={toolContentScrollRef} className="absolute inset-0 overflow-y-auto custom-scrollbar p-1">
                  {tools.find(t => t.id === selectedTool)?.component}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="tool-grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 min-h-0 flex flex-col relative"
            >
              <ScrollEdgeFades scrollRef={toolsScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
              <div ref={toolsScrollRef} className="absolute inset-0 overflow-y-auto custom-scrollbar px-8 pb-12 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {tools.map((tool, index) => (
                    <motion.div
                      key={tool.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="h-full"
                    >
                      <CompiledInteractiveCard
                        as="div"
                        onClick={tool.status === 'available' ? () => handleToolClick(tool) : undefined}
                        spotlightColor={isDarkMode ? 'rgba(255, 255, 255, 0.04)' : 'rgba(14, 165, 233, 0.12)'}
                        spotlightSize={isDarkMode ? 320 : 260}
                        liquidSpotlight={tool.status === 'available'}
                        liquidSpotlightTone={isDarkMode ? 'dark' : 'light'}
                        idleSpotlightOpacity={0}
                        activeSpotlightOpacity={1}
                        className={`
                          group relative isolate overflow-hidden flex flex-col items-start text-left
                          p-6 h-[220px] rounded-card-lg border transition-all duration-200 select-none
                          ${isDarkMode ? cardDarkClass : cardLightClass}
                          ${tool.status === 'available'
                            ? 'cursor-pointer hover:-translate-y-1'
                            : 'cursor-not-allowed opacity-45 filter grayscale-[40%]' }
                        `}
                        data-glass-edge-mask
                      >
                        {/* Upper Section Icon */}
                        <div className={`
                          relative z-10 -ml-1 -mt-1 mb-4 flex h-10 w-10 items-center justify-center
                          transition-colors duration-300
                          ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)] group-hover:text-slate-100' : 'text-[var(--os-vnext-brand-blue)]'}
                        `}>
                          <tool.icon
                            size={20}
                            strokeWidth={1.5}
                          />
                        </div>

                        {/* Content text */}
                        <h3 className={`relative z-10 text-base font-light tracking-tight ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`}>
                          {tool.name}
                        </h3>
                        <p className={`relative z-10 text-[12px] mt-2 leading-relaxed font-light ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                          {tool.description}
                        </p>

                        {/* Bottom Action Section (Footer) */}
                        <div className={`relative z-10 mt-auto pt-4 border-t w-full flex justify-between items-center ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/50'}`}>
                          <span className={`
                            text-[10px] font-light tracking-wider px-2 py-0.5 rounded-full
                            ${tool.status === 'available'
                              ? 'bg-black/[0.05] dark:bg-white/[0.06] text-slate-600 dark:text-slate-300'
                              : 'bg-black/[0.04] dark:bg-white/[0.04] text-slate-400 dark:text-slate-500'}
                          `}>
                            {tool.status === 'available' ? '可用' : '即将上线'}
                          </span>

                          {tool.status === 'available' ? (
                            <ArrowRight
                              size={14}
                              strokeWidth={1.5}
                              className={`transition-transform duration-300 group-hover:translate-x-1 ${isDarkMode ? 'text-white/30' : 'text-slate-300'}`}
                            />
                          ) : (
                            <Lock
                              size={12}
                              strokeWidth={1.5}
                              className="text-slate-400 dark:text-slate-500"
                            />
                          )}
                        </div>
                      </CompiledInteractiveCard>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default BusinessTools;
