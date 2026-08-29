import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Wrench, X, ChevronRight, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
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
// 从左栏中移出的设置类内容：
// 1. 工具目录（原 AgentToolCatalogRail）
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
  if (approval === 'always') return <ShieldX size={14} strokeWidth={1.5} className={className} />;
  if (approval === 'risk_based') return <ShieldAlert size={14} strokeWidth={1.5} className={className} />;
  return <ShieldCheck size={14} strokeWidth={1.5} className={className} />;
};

const ToolCatalogSection: React.FC<{
  catalog: AgentToolCatalog | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error?: string;
  onRetry: () => void;
  isDarkMode?: boolean;
}> = ({ catalog, status, error, onRetry, isDarkMode }) => {
  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>({});
  const quietText = BAMBOOK_OS.tone.text.quiet;
  const surfaceClass = 'border-[var(--border-c-subtle)]';
  const groups = catalog?.groupedByDomain ?? [];

  if (status === 'idle' || status === 'loading') {
    return <div className={`text-[11px] ${quietText} py-2`}>{status === 'loading' ? '加载中…' : '准备中'}</div>;
  }

  if (status === 'error') {
    return (
      <div className={`text-[11px] py-2 text-[var(--text-secondary)]`}>
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
          <div key={group.domain} className={`rounded-inset border ${surfaceClass}`}>
            <button
              type="button"
              onClick={() => setOpenDomains(prev => ({ ...prev, [group.domain]: !isOpen }))}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--hover-darken)] rounded-inset`}
            >
              <Wrench size={14} strokeWidth={1.5} className="text-[var(--text-tertiary)]" />
              <span className={`text-[11px] font-light flex-1 text-[var(--text-primary)]`}>{meta.label}</span>
              <span className={`text-[10px] ${quietText}`}>{group.tools.length}</span>
              <ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''} ${quietText}`} />
            </button>
            {isOpen && (
              <div className={`border-t ${surfaceClass} px-1.5 py-1 space-y-0.5`}>
                {group.tools.map(tool => (
                  <div key={tool.id} className={`rounded-compact px-2 py-1.5 hover:bg-[var(--hover-darken)]`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-light truncate text-[var(--text-primary)]`}>{tool.name}</span>
                      <span className={`shrink-0 text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded-bds-sm border ${riskPillClass(tool.risk, isDarkMode)}`}>{tool.risk}</span>
                      <ApprovalIcon
                        approval={tool.safety.approval}
                        className={`shrink-0 ml-auto text-[var(--text-secondary)]`}
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
  const bodyBg = 'bg-[var(--bg-card)]';
  const mainText = 'text-[var(--text-primary)]';
  const quietText = BAMBOOK_OS.tone.text.quiet;
  const surfaceClass = 'border-[var(--border-c-subtle)]';

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
            className="fixed inset-0 z-[100] bg-[var(--mask-bg)] backdrop-blur-sm"
            onClick={onClose}
          />
          {/* 抽屉 */}
          <motion.div
            initial={{ x: -288, opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -288, opacity: 0.8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className={`fixed left-0 top-0 bottom-0 z-[101] w-72 ${bodyBg} border-r ${surfaceClass} shadow-none flex flex-col`}
          >
            {/* 头部 */}
            <div className={`shrink-0 flex items-center justify-between px-4 h-12 border-b ${surfaceClass}`}>
              <div className="flex items-center gap-2">
                <Settings size={16} className={quietText} />
                <span className={`text-[13px] font-light ${mainText}`}>设置</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`h-8 w-8 rounded-control flex items-center justify-center transition-colors hover:bg-[var(--recessed-bg-hover)]`}
                aria-label="关闭设置"
              >
                <X size={14} className={quietText} />
              </button>
            </div>

            {/* 内容区：工具目录（当前唯一设置内容，无 tab 栏） */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3">
              <ToolCatalogSection
                catalog={catalog}
                status={catalogStatus}
                error={catalogError}
                onRetry={onRetryCatalog}
                isDarkMode={isDarkMode}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
