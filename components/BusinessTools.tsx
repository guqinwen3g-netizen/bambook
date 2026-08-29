/**
 * 业务工具箱 BusinessTools
 * 阶段 IA-2 收编后定位：只保留「真正无主」的工具——
 *   · 报价计算器 / 退税汇率 → 已收编至 定价与利润（Pricing）对应 tab，此处为跳转卡
 *   · 出运制单 / 单据模板   → 已收编至 外贸与报关（Customs）对应 tab，此处为跳转卡
 *   · 样品发票 / 发货通知 / 合同 / 装箱单生成器 → 以订单/关系为输入的制单小组件，暂留本页
 *   · PO 导入 / MES → 跳转卡
 */

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
  LucideIcon,
  Ship,
  Upload,
  Layers,
  Cog,
  Ruler
} from 'lucide-react';
import FabricSampleInvoiceGenerator from './tools/FabricSampleInvoiceGenerator';
import FabricCalculatorPanel from './tools/FabricCalculatorPanel';
import ShippingNoticeGenerator from './tools/ShippingNoticeGenerator';
import PackingListGenerator from './tools/PackingListGenerator';
import ContractGenerator from './tools/ContractGenerator';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';
import { CompiledInteractiveCard } from './ui/primitives/compiledPrimitives';
import { PageHeader } from './ui/PageHeader';
import { SIDEBAR_HOVER_CLASS } from './ui/sidebarConstants';
import { Relation, Order, View } from '../types';

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  component?: React.ReactNode;
  /** 设置了 targetView 的卡片点击后跳转对应视图（而非打开内嵌面板） */
  targetView?: View;
  /** 阶段 IA-2：跳转落点模块内 tab（经 moduleTabOverrides 深链） */
  targetTab?: string;
}

interface BusinessToolsProps {
  isDarkMode: boolean;
  relations?: Relation[];
  orders?: Order[];
  onNavigate?: (view: View, tab?: string) => void;
}

const BusinessTools: React.FC<BusinessToolsProps> = ({ isDarkMode, relations = [], orders = [], onNavigate }) => {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const toolsScrollRef = useRef<HTMLDivElement>(null);
  const toolContentScrollRef = useRef<HTMLDivElement>(null);
  // 边缘渐隐：固定 mask 挂滚动容器自身（12px 轻微渐隐，与 ScrollEdgeFades 原参数同口径）
  useStaticEdgeMask(toolsScrollRef, { topFadeEnd: 12, bottomFade: 12, enabled: !selectedTool });
  useStaticEdgeMask(toolContentScrollRef, { topFadeEnd: 12, bottomFade: 12, enabled: !!selectedTool });

  const tools: Tool[] = [
    {
      id: 'po-import',
      name: 'PO 文件导入',
      description: '跳转订单管理页，使用 PO 导入向导',
      icon: Upload,
      targetView: View.Orders,
    },
    {
      id: 'mes-console',
      name: '生产执行 MES',
      description: '工位排产 · 工时 · 计件 · 外协加工（可选模块，非核心流程）',
      icon: Cog,
      targetView: View.MES,
    },
    {
      id: 'sample-invoice',
      name: '样品发票生成器',
      description: '生成 Panda 面料样品发票',
      icon: Receipt,
      component: <FabricSampleInvoiceGenerator isDarkMode={isDarkMode} relations={relations} />
    },
    {
      id: 'fabric-calculator',
      name: '面料计算器',
      description: '克重/纱支/门幅/卷装/装柜 行业换算（服务端计算）',
      icon: Ruler,
      component: <FabricCalculatorPanel isDarkMode={isDarkMode} />
    },
    {
      id: 'shipping-notice',
      name: '发货通知生成器',
      description: '从订单生成发货通知 Excel',
      icon: Ship,
      component: <ShippingNoticeGenerator isDarkMode={isDarkMode} relations={relations} orders={orders} />
    },
    {
      id: 'contract-generator',
      name: '合同生成器',
      description: '采购/销售合同模板 · PDF 打印',
      icon: FileText,
      component: <ContractGenerator isDarkMode={isDarkMode} relations={relations} orders={orders} />
    },
    {
      id: 'packing-list',
      name: '装箱单生成器',
      description: '生成出口装箱明细单 · PDF 打印',
      icon: Package,
      component: <PackingListGenerator isDarkMode={isDarkMode} relations={relations} orders={orders} />
    },
    {
      id: 'shipment-documents',
      name: '出运制单引擎',
      description: '已收编至 外贸与报关 · 出运制单：运单一键生成 CI/PL/CO/BL 成套单据',
      icon: Layers,
      targetView: View.Customs,
      targetTab: 'docGenerator',
    },
    {
      id: 'document-templates',
      name: '单据模板管理',
      description: '已收编至 外贸与报关 · 单据模板：13 类外贸单据 HTML 模板 · 变量占位符',
      icon: FileText,
      targetView: View.Customs,
      targetTab: 'docTemplates',
    },
    {
      id: 'quote-calculator',
      name: '报价计算器',
      description: '已收编至 定价与利润 · 定价计算器：退税美元定价试算 · 记录保存',
      icon: Calculator,
      targetView: View.Pricing,
      targetTab: 'calculator',
    },
    {
      id: 'exchange-rate',
      name: '退税核算汇率',
      description: '已收编至 定价与利润 · 退税率：HS Code 退税率表 · 前缀命中测试',
      icon: TrendingUp,
      targetView: View.Pricing,
      targetTab: 'taxRates',
    }
  ];

  const handleToolClick = (tool: Tool) => {
    if (tool.targetView) {
      onNavigate?.(tool.targetView, tool.targetTab);
      return;
    }
    setSelectedTool(tool.id);
  };

  const handleBack = () => {
    setSelectedTool(null);
  };

  // BDS 收编：bds-surface 单写自适应承载双主题（半透膜 + blur，无 rim），
  // SIDEBAR_HOVER_CLASS 提供 hover 反馈（真源 controls.listRow.hover）。
  const cardClass = `bds-surface ${SIDEBAR_HOVER_CLASS}`;

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
              className="flex-1 min-h-0 flex flex-col relative px-7 pb-12 pt-3"
            >
              {/* Back Button */}
              <button
                onClick={handleBack}
                className={`mb-4 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-light transition-colors duration-200 w-fit
                bg-[var(--recessed-bg-strong)] border-[var(--border-c-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--active-darken)]`}
              >
                <ChevronRight size={14} className="rotate-180" />
                <span>返回工具箱</span>
              </button>

              {/* Tool Content with Fade */}
              <div className="flex-1 min-h-0 relative">
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
                        onClick={() => handleToolClick(tool)}
                        spotlightColor={isDarkMode ? 'rgba(255, 255, 255, 0.04)' : 'rgba(14, 165, 233, 0.12)'}
                        spotlightSize={isDarkMode ? 320 : 260}
                        liquidSpotlight
                        liquidSpotlightTone={isDarkMode ? 'dark' : 'light'}
                        idleSpotlightOpacity={0}
                        activeSpotlightOpacity={1}
                        className={`
                          group relative isolate overflow-hidden flex flex-col items-start text-left
                          p-6 h-full rounded-card-lg transition-colors duration-200 select-none
                          cursor-pointer hover:-translate-y-1
                          ${cardClass}
                        `}
                        data-glass-edge-mask
                      >
                        {/* Upper Section Icon */}
                        <div className={`
                          relative z-10 -ml-1 -mt-1 mb-4 flex h-10 w-10 items-center justify-center
                          transition-colors duration-300
                          text-[var(--os-vnext-brand-blue)] group-hover:text-[var(--text-primary)]
                        `}>
                          <tool.icon
                            size={20}
                            strokeWidth={1.5}
                          />
                        </div>

                        {/* Content text */}
                        <h3 className="relative z-10 text-base font-light tracking-tight text-[var(--text-primary)]">
                          {tool.name}
                        </h3>
                        <p className="relative z-10 text-[12px] mt-2 leading-relaxed font-light text-[var(--text-tertiary)]">
                          {tool.description}
                        </p>

                        {/* Bottom Action Section (Footer) */}
                        <div className={`relative z-10 mt-auto pt-4 border-t w-full flex justify-end items-center border-[var(--border-c-default)]`}>
                          <ArrowRight
                            size={14}
                            strokeWidth={1.5}
                            className={`transition-transform duration-300 group-hover:translate-x-1 text-[var(--text-tertiary)]`}
                          />
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
