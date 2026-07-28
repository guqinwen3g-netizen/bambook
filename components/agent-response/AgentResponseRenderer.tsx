import React, { useMemo } from 'react';
import type { AgentResponseBlock, AgentResponseBlockType, AgentEvidenceBlock as AgentEvidenceBlockModel, AgentToolLifecycleBlock as AgentToolLifecycleBlockModel } from '../../types';
import { AgentBlockErrorBoundary } from './AgentBlockErrorBoundary';
import { AgentMarkdownBlock, type AgentBlockComponentProps } from './AgentMarkdownBlock';
import { AgentTableBlock } from './AgentTableBlock';
import { AgentMetricBlock } from './AgentMetricBlock';
import { AgentEvidenceBlock } from './AgentEvidenceBlock';
import { AgentNextActionsBlock } from './AgentNextActionsBlock';
import { AgentDiagramBlock } from './AgentDiagramBlock';
import { AgentChartBlock } from './AgentChartBlock';
import { AgentMermaidBlock } from './AgentMermaidBlock';
import { AgentArtifactBlock } from './AgentArtifactBlock';
import { AgentToolLifecycleBlock } from './AgentToolLifecycleBlock';
import { AgentApprovalBlock } from './AgentApprovalBlock';
import { AgentFormBlock } from './AgentFormBlock';
import { AgentUnsupportedBlock } from './AgentUnsupportedBlock';
import { AgentTimelineGroup, type TimelineEntry } from './AgentTimelineGroup';

type AgentBlockRendererComponent = React.ComponentType<AgentBlockComponentProps<any>>;

const blockRegistry: Partial<Record<AgentResponseBlockType, AgentBlockRendererComponent>> = {
  markdown: AgentMarkdownBlock,
  table: AgentTableBlock,
  metric: AgentMetricBlock,
  evidence: AgentEvidenceBlock,
  nextActions: AgentNextActionsBlock,
  diagram: AgentDiagramBlock,
  chart: AgentChartBlock,
  mermaid: AgentMermaidBlock,
  artifact: AgentArtifactBlock,
  tool: AgentToolLifecycleBlock,
  approval: AgentApprovalBlock,
  form: AgentFormBlock,
};

export interface AgentResponseRendererProps {
  blocks: AgentResponseBlock[];
  isDarkMode?: boolean;
  registry?: Partial<Record<AgentResponseBlockType, AgentBlockRendererComponent>>;
  isStreaming?: boolean;
  onExecuteAction?: AgentBlockComponentProps<AgentResponseBlock>['onExecuteAction'];
  onReferenceClick?: AgentBlockComponentProps<AgentResponseBlock>['onReferenceClick'];
  onArtifactClick?: AgentBlockComponentProps<AgentResponseBlock>['onArtifactClick'];
}

// 折叠到 timeline 的 block 类型
const TIMELINE_TYPES: ReadonlySet<AgentResponseBlockType> = new Set(['tool', 'evidence']);

// 完成态时"答案前置"——这些 block 类型属于答案，会被前置到 timeline 之上
const ANSWER_TYPES: ReadonlySet<AgentResponseBlockType> = new Set([
  'markdown', 'table', 'metric', 'chart', 'mermaid', 'diagram', 'artifact', 'nextActions',
]);

interface RenderItem {
  kind: 'single' | 'timeline';
  blocks: AgentResponseBlock[];
}

/**
 * 把 blocks 数组按"是否属于过程时间线"聚合：
 * - 连续的 tool/evidence → 合并为一组 timeline
 * - 其他 block → 各自独立
 * 这样后端不需要分组语义，前端就能呈现"答案前置 + 过程折叠"
 */
const groupBlocks = (blocks: AgentResponseBlock[]): RenderItem[] => {
  const items: RenderItem[] = [];
  let buffer: AgentResponseBlock[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    items.push({ kind: 'timeline', blocks: buffer });
    buffer = [];
  };
  for (const b of blocks) {
    if (TIMELINE_TYPES.has(b.type)) {
      buffer.push(b);
    } else {
      flush();
      items.push({ kind: 'single', blocks: [b] });
    }
  }
  flush();
  return items;
};

export const AgentResponseRenderer: React.FC<AgentResponseRendererProps> = ({ blocks, isDarkMode, registry, isStreaming, onExecuteAction, onReferenceClick, onArtifactClick }) => {
  const resolvedRegistry = registry ? { ...blockRegistry, ...registry } : blockRegistry;
  const items = useMemo(() => groupBlocks(blocks), [blocks]);

  // 答案前置：完成态时把 ANSWER_TYPES 的 single item 移到顶部，timeline + approval 留在原位
  // streaming 时保持原序，让用户感受到"agent 正在执行"
  const reordered = useMemo(() => {
    if (isStreaming) return items;
    const answers: RenderItem[] = [];
    const tail: RenderItem[] = [];
    for (const it of items) {
      if (it.kind === 'single' && ANSWER_TYPES.has(it.blocks[0].type)) {
        answers.push(it);
      } else {
        tail.push(it);
      }
    }
    // 答案保持原相对顺序在前；过程/审批等按原顺序在后
    return [...answers, ...tail];
  }, [items, isStreaming]);

  return (
    <div className="flex flex-col gap-3">
      {reordered.map((item, idx) => {
        if (item.kind === 'timeline') {
          const entries: TimelineEntry[] = item.blocks.map(b => (
            b.type === 'tool'
              ? { kind: 'tool', block: b as AgentToolLifecycleBlockModel }
              : { kind: 'evidence', block: b as AgentEvidenceBlockModel }
          ));
          const groupRunning = !!isStreaming && entries.some(e =>
            e.kind === 'tool' && (e.block.lifecycleStatus === 'running' || e.block.lifecycleStatus === 'planned' || e.block.lifecycleStatus === 'parameterized' || e.block.lifecycleStatus === 'permission_checked')
          );
          return (
            <AgentTimelineGroup
              key={`tl_${idx}_${item.blocks[0]?.id ?? ''}`}
              entries={entries}
              isDarkMode={isDarkMode}
              isStreaming={groupRunning}
              defaultOpen={false}
              onReferenceClick={onReferenceClick}
            />
          );
        }
        const block = item.blocks[0];
        const Renderer = resolvedRegistry[block.type] ?? AgentUnsupportedBlock;
        return (
          <AgentBlockErrorBoundary key={block.id} isDarkMode={isDarkMode}>
            <Renderer
              block={block as any}
              isDarkMode={isDarkMode}
              onExecuteAction={onExecuteAction}
              onReferenceClick={onReferenceClick}
              onArtifactClick={onArtifactClick}
            />
          </AgentBlockErrorBoundary>
        );
      })}
    </div>
  );
};
