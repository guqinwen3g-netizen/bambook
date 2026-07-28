import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Wrench, X, Bot, Cat, ChevronRight, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import {
  type AgentToolCatalog,
  type AgentToolManifestEntry,
  getDomainLabel,
} from '../../lib/agentManifest';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { riskPillClass } from './agentResponseTone';

// ─────────────────────────────────────────────────────────────────────────────
// 左栏底部设置抽屉
// ─────────────────────────────────────────────────────────────────────────────
// 从左栏中移出的所有设置类内容：
// 1. 工具目录（原 AgentToolCatalogRail）
// 2. Agent 设置（占位）
// 3. Pet 悬浮窗开关
// 设计：左栏底部齿轮按钮 → 从左侧滑出覆盖抽屉

type SettingsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  catalog: AgentToolCatalog | null;
  catalogStatus: 'idle' | 'loading' | 'loaded' | 'error';
  catalogError?: string;
  onRetryCatalog: () => void;
  isDarkMode?: boolean;
};

const ApprovalIcon: React.FC<{ approval: AgentToolManifestEntry['safety']['approval']; className: string }> = ({ approval, className }) => {
  if (approval === 'always') return <ShieldX size={11} strokeWidth={1.5} className={className} />;
  if (approval === 'risk_based') return <ShieldAlert size={11} strokeWidth={1.5} className={className} />;
  return <ShieldCheck size={11} strokeWidth={1.5} className={className} />;
};

const ToolCatalogSection: React.FC<{
  catalog: AgentToolCatalog | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error?: string;
  onRetry: () => void;
  isDarkMode?: boolean;
}> = ({ catalog, status, error, onRetry, isDarkMode }) => {
  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>({});
  const quietText = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const surfaceClass = isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/70';
  const groups = catalog?.groupedByDomain ?? [];

  if (status === 'idle' || status === 'loading') {
    return <div className={`text-[11px] ${quietText} py-2`}>{status === 'loading' ? '加载中…' : '准备中'}</div>;
  }

  if (status === 'error') {
    return (
      <div className={`text-[11px] py-2 ${isDarkMode ? 'text-white/75' : 'text-slate-600'}`}>
        {error || '加载失败'}
        <button type="button" onClick={onRetry} className="ml-2 underline">重试</button>
      </div>
    );
  }

  if (!catalog || catalog.tools.length === 0) {
    return <div className={`text-[11px] ${quietText} py-2`}>暂无可用工具</div>;
  }

  return (
    <div className="space-y-1.5">
      <div className={`text-[10px] ${quietText}`}>
        共 {catalog.summary.total} 个工具 · schema {catalog.schemaVersion}
      </div>
      {groups.map(group => {
        const meta = getDomainLabel(group.domain);
        const isOpen = openDomains[group.domain] ?? false;
        return (
          <div key={group.domain} className={`rounded-xl border ${surfaceClass}`}>
            <button
              type="button"
              onClick={() => setOpenDomains(prev => ({ ...prev, [group.domain]: !isOpen }))}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${isDarkMode ? 'hover:bg-white/[0.03]' : 'hover:bg-black/[0.03]'} rounded-xl`}
            >
              <Wrench size={11} strokeWidth={1.5} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} />
              <span className={`text-[11px] font-light flex-1 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{meta.label}</span>
              <span className={`text-[10px] ${quietText}`}>{group.tools.length}</span>
              <ChevronRight size={12} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''} ${quietText}`} />
            </button>
            {isOpen && (
              <div className={`border-t ${surfaceClass} px-1.5 py-1 space-y-0.5`}>
                {group.tools.map(tool => (
                  <div key={tool.id} className={`rounded-lg px-2 py-1.5 ${isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.03]'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-light truncate ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{tool.name}</span>
                      <span className={`shrink-0 text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded border ${riskPillClass(tool.risk, isDarkMode)}`}>{tool.risk}</span>
                      <ApprovalIcon
                        approval={tool.safety.approval}
                        className={`shrink-0 ml-auto ${
                          tool.safety.approval === 'always' ? (isDarkMode ? 'text-white/70' : 'text-slate-600')
                          : tool.safety.approval === 'risk_based' ? (isDarkMode ? 'text-white/70' : 'text-slate-600')
                          : (isDarkMode ? 'text-white/70' : 'text-slate-600')
                        }`}
                      />
                    </div>
                    <div className={`mt-0.5 text-[10px] leading-3.5 ${quietText} truncate`}>{tool.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  catalog,
  catalogStatus,
  catalogError,
  onRetryCatalog,
  isDarkMode,
}) => {
  const [activeSection, setActiveSection] = useState<'tools' | 'agent' | 'pet'>('tools');
  const bodyBg = isDarkMode ? 'bg-slate-950' : 'bg-white';
  const mainText = isDarkMode ? 'text-white/85' : 'text-slate-800';
  const quietText = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const surfaceClass = isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/70';

  const sections = [
    { key: 'tools' as const, icon: Wrench, label: '工具目录' },
    { key: 'agent' as const, icon: Bot, label: 'Agent 设置' },
    { key: 'pet' as const, icon: Cat, label: '悬浮宠物' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/20"
            onClick={onClose}
          />
          {/* 抽屉 */}
          <motion.div
            initial={{ x: -224, opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -224, opacity: 0.8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className={`fixed left-0 top-0 bottom-0 z-[101] w-[280px] ${bodyBg} border-r ${surfaceClass} shadow-none flex flex-col`}
          >
            {/* 头部 */}
            <div className={`shrink-0 flex items-center justify-between px-4 h-12 border-b ${surfaceClass}`}>
              <div className="flex items-center gap-2">
                <Settings size={15} className={quietText} />
                <span className={`text-[13px] font-light ${mainText}`}>设置</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-white/[0.06]' : 'hover:bg-slate-100'}`}
                aria-label="关闭设置"
              >
                <X size={14} className={quietText} />
              </button>
            </div>

            {/* 左侧 tab 列表 + 右侧内容 */}
            <div className="flex-1 flex min-h-0">
              {/* Tab 列表 */}
              <div className={`w-[88px] shrink-0 border-r ${surfaceClass} py-3 space-y-0.5`}>
                {sections.map(sec => {
                  const Icon = sec.icon;
                  const active = activeSection === sec.key;
                  return (
                    <button
                      key={sec.key}
                      type="button"
                      onClick={() => setActiveSection(sec.key)}
                      className={`w-full flex flex-col items-center gap-1 py-2 px-1 text-[10px] font-light transition-colors ${
                        active
                          ? (isDarkMode ? 'bg-white/[0.06] text-white/90' : 'bg-slate-100 text-slate-900')
                          : (isDarkMode ? 'text-white/40 hover:bg-white/[0.03]' : 'text-slate-500 hover:bg-slate-50')
                      }`}
                    >
                      <Icon size={16} strokeWidth={1.4} />
                      <span>{sec.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 内容区 */}
              <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-3 py-3">
                {activeSection === 'tools' && (
                  <ToolCatalogSection
                    catalog={catalog}
                    status={catalogStatus}
                    error={catalogError}
                    onRetry={onRetryCatalog}
                    isDarkMode={isDarkMode}
                  />
                )}
                {activeSection === 'agent' && (
                  <div className={`text-[12px] font-light leading-5 ${quietText} py-4`}>
                    <div className={`text-[13px] font-light ${mainText} mb-3`}>Agent 配置</div>
                    <p>Agent 运行时参数配置即将上线。</p>
                    <p className="mt-2">当前 Agent 使用规则化 planner 路径，manifest schemaVersion <span className="font-mono text-[11px]">2026-06-runtime-2.0</span>。</p>
                  </div>
                )}
                {activeSection === 'pet' && (
                  <div className={`text-[12px] font-light leading-5 ${quietText} py-4`}>
                    <div className={`text-[13px] font-light ${mainText} mb-3`}>悬浮宠物</div>
                    <p>桌面悬浮宠物窗口的开关和外观配置即将上线。</p>
                    <p className="mt-2">当前宠物在 Agent 工作时自动显示执行状态。</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
