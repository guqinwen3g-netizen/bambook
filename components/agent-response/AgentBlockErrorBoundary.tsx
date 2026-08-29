import React from 'react';
import { OS_MATERIAL } from '../ui/osMaterial';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';

interface AgentBlockErrorBoundaryProps {
  children: React.ReactNode;
  isDarkMode?: boolean;
  /** block 更新信号（如 status 翻转）：变化时重置错误态，给修复后的 block 一次重渲机会 */
  resetKey?: unknown;
}

interface AgentBlockErrorBoundaryState {
  hasError: boolean;
}

export class AgentBlockErrorBoundary extends React.Component<AgentBlockErrorBoundaryProps, AgentBlockErrorBoundaryState> {
  state: AgentBlockErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AgentBlockErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: AgentBlockErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: unknown) {
    console.error('[AgentBlockErrorBoundary]', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
    const quietTextClass = BAMBOOK_OS.tone.text.quiet;
    const borderClass = 'border-[var(--border-c-default)]';

    return (
      <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
        <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>渲染失败</div>
        <div className={`mt-1 text-xs ${quietTextClass}`}>该内容块暂时无法显示，其他内容不受影响。</div>
      </div>
    );
  }
}
