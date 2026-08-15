import React, { useEffect, useRef, useState } from 'react';
import type { AgentMermaidBlock as AgentMermaidBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

// Mermaid 是 ESM 默认导出；运行时按需 import 避免初次启动时 800KB 阻塞
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
const loadMermaid = (): Promise<typeof import('mermaid').default> => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => {
      const m = (mod.default ?? (mod as unknown as typeof import('mermaid').default));
      try {
        m.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'inherit',
          flowchart: { htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: true },
        });
      } catch {
        /* noop */
      }
      return m;
    });
  }
  return mermaidPromise;
};

const KIND_LABEL: Record<string, string> = {
  flowchart: '流程图',
  sequence: '时序图',
  class: '类图',
  state: '状态图',
  er: 'ER 图',
  gantt: '甘特图',
  pie: '饼图',
  journey: '旅程图',
  timeline: '时间线',
  mindmap: '思维导图',
  gitgraph: 'Git 图',
};

let renderCounter = 0;
const nextId = () => `bambook-mermaid-${Date.now().toString(36)}-${(++renderCounter).toString(36)}`;

export const AgentMermaidBlock: React.FC<AgentBlockComponentProps<AgentMermaidBlockModel>> = ({ block, isDarkMode }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string>(nextId());

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    if (!block.code || block.code.trim().length === 0) {
      setError('图示源为空');
      return;
    }
    loadMermaid()
      .then(async m => {
        try {
          // 动态主题：暗色用 dark 主题
          try {
            m.initialize({
              startOnLoad: false,
              securityLevel: 'strict',
              theme: isDarkMode ? 'dark' : 'neutral',
              fontFamily: 'inherit',
            });
          } catch {
            /* noop */
          }
          const { svg: rendered } = await m.render(idRef.current, block.code);
          if (!cancelled) {
            setSvg(rendered);
          }
        } catch (err) {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg.slice(0, 240));
          }
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(`加载 mermaid 失败：${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [block.code, isDarkMode]);

  const kindLabel = KIND_LABEL[block.kind] ?? block.kind;

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? kindLabel}</div>
        <div className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest ${borderClass} ${quietTextClass}`}>
          mermaid · {block.kind}
        </div>
      </div>

      {block.caption && (
        <div className={`mt-1.5 text-[11px] ${quietTextClass}`}>{block.caption}</div>
      )}

      <div
        ref={containerRef}
        className={`mt-3 overflow-x-auto rounded-compact border px-3 py-3 ${borderClass} bg-[var(--recessed-bg)] dark:bg-black/20`}
        style={{ minHeight: 80 }}
      >
        {error ? (
          <div className="flex flex-col gap-1 text-[11px]">
            <span className="text-[var(--text-secondary)]">无法渲染 mermaid 图：{error}</span>
            <details>
              <summary className={`cursor-pointer ${quietTextClass}`}>查看源码</summary>
              <pre className={`mt-2 whitespace-pre-wrap text-[10px] ${quietTextClass}`}>{block.code}</pre>
            </details>
          </div>
        ) : svg ? (
          <div
            // eslint-disable-next-line react/no-danger -- mermaid 输出的 SVG 已被 securityLevel:'strict' 转义
            dangerouslySetInnerHTML={{ __html: svg }}
            className="bambook-mermaid-svg [&_svg]:max-w-full [&_svg]:h-auto"
          />
        ) : (
          <div className={`flex h-20 items-center justify-center text-[11px] ${quietTextClass}`}>渲染中…</div>
        )}
      </div>
    </div>
  );
};
