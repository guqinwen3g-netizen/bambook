import React from 'react';
import { OS_MATERIAL } from '../ui/osMaterial';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';

interface AgentBlockErrorBoundaryProps {
  children: React.ReactNode;
  isDarkMode?: boolean;
}

interface AgentBlockErrorBoundaryState {
  hasError: boolean;
}

export class AgentBlockErrorBoundary extends React.Component<AgentBlockErrorBoundaryProps, AgentBlockErrorBoundaryState> {
  state: AgentBlockErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AgentBlockErrorBoundaryState {
    return { hasError: true };
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
