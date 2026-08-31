import React from 'react';
import type { AgentResponseBlock } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

export const AgentUnsupportedBlock: React.FC<AgentBlockComponentProps<AgentResponseBlock>> = ({ block, isDarkMode }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3`}>
      <div className={`text-xs uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '暂未支持的内容块'}</div>
      <div className={`mt-1 text-xs ${quietTextClass}`}>类型：{block.type}</div>
    </div>
  );
};
