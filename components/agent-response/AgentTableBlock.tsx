import React from 'react';
import type { AgentTableBlock as AgentTableBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

const formatCellValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  // 对象/数组不能裸转字符串（会得到 [object Object]），JSON 化呈现
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const alignClass = (align?: 'left' | 'center' | 'right') => {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
};

export const AgentTableBlock: React.FC<AgentBlockComponentProps<AgentTableBlockModel>> = ({ block, isDarkMode, onReferenceClick }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';
  const toolRunIds = block.source?.toolRunIds?.filter(Boolean) ?? [];

  return (
    <div className={`${OS_MATERIAL.insetSurface} overflow-hidden rounded-inset border ${borderClass}`}>
      {(block.title || block.caption) && (
        <div className={`border-b px-4 py-3 ${borderClass}`}>
          {block.title && <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title}</div>}
          {block.caption && <div className={`mt-1 text-xs ${quietTextClass}`}>{block.caption}</div>}
          {toolRunIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {toolRunIds.slice(0, 3).map(toolRunId => (
                <button
                  key={toolRunId}
                  type="button"
                  onClick={() => onReferenceClick?.({
                    refId: `ref_${toolRunId}`,
                    kind: 'tool_run',
                    label: '数据来源',
                    toolRunId,
                    blockId: block.id,
                  })}
                  disabled={!onReferenceClick}
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest transition-opacity ${onReferenceClick ? 'hover:opacity-80' : 'cursor-default'} ${borderClass} ${quietTextClass}`}
                >
                  source: {toolRunId}
                </button>
              ))}
              {toolRunIds.length > 3 && <span className={`text-[10px] ${quietTextClass}`}>+{toolRunIds.length - 3}</span>}
            </div>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--recessed-bg)]">
              {block.columns.map(column => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={`border-b px-3 py-2 font-normal ${alignClass(column.align)} ${borderClass} ${labelTextClass}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(block.columns.length, 1)} className={`px-3 py-6 text-center ${quietTextClass}`}>
                  暂无数据
                </td>
              </tr>
            )}
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-[var(--recessed-bg)]' : undefined}>
                {block.columns.map(column => (
                  <td key={column.key} className={`border-b px-3 py-2 ${alignClass(column.align)} ${borderClass} text-[var(--text-primary)]`}>
                    {formatCellValue(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
