import React, { useEffect, useState } from 'react';
import { Network, ExternalLink, Loader2 } from 'lucide-react';
import {
  entityLinksService,
  labelForLinkKind,
  type NeighborsResponse,
  type NeighborRow,
} from '../services/entityLinksService';

/**
 * RelatedEntitiesPanel
 *
 * Generic "related entities" card for detail panels. Works for any entity
 * type registered in the EntityLink graph: order, development-case,
 * relation.organization, relation.person, product, etc.
 *
 * Place it in a detail sidebar — pass the entity (type,id) and the panel
 * fetches neighbors, groups them by linkKind, and renders each group with
 * a click handler so the user can drill across modules.
 *
 * Design philosophy: stays passive. It does not load the target entity
 * itself; it only shows pointers. The parent decides what to do when the
 * user clicks (open a different module, scroll to record, etc.).
 */

export interface RelatedEntitiesPanelProps {
  /** EntityLink type code: e.g. "order", "development-case", "relation.organization", "product" */
  type: string;
  /** Entity id */
  id: string;
  /** Title override; defaults to "关联视图" */
  title?: string;
  /** Click handler — receives the neighbor row so the host can navigate. */
  onSelectNeighbor?: (n: NeighborRow) => void;
  /** Visual theme; defaults to light. */
  isDarkMode?: boolean;
  /** Max neighbors to fetch; defaults to 200. */
  limit?: number;
  /**
   * Re-fetch trigger — bump this number whenever the host knows the graph
   * may have changed (e.g. just saved the entity).
   */
  refreshKey?: number;
}

export const RelatedEntitiesPanel: React.FC<RelatedEntitiesPanelProps> = ({
  type,
  id,
  title = '关联视图',
  onSelectNeighbor,
  isDarkMode = false,
  limit = 200,
  refreshKey = 0,
}) => {
  const [data, setData] = useState<NeighborsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!type || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    entityLinksService
      .getNeighbors({ type, id, limit })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, limit, refreshKey]);

  const containerStyle: React.CSSProperties = {
    border: `1px solid ${isDarkMode ? 'var(--bambook-gray-700)' : 'var(--bambook-gray-200)'}`,
    borderRadius: 12,
    background: isDarkMode ? '#1a1c20' : '#ffffff',
    padding: 16,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    color: isDarkMode ? 'var(--bambook-gray-200)' : 'var(--bambook-gray-900)',
    fontWeight: 600,
    fontSize: 14,
  };

  const groups = data?.neighbors ?? {};
  const groupKeys = Object.keys(groups).sort();

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <Network size={16} />
        <span>{title}</span>
        {data ? (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 500,
              color: isDarkMode ? 'var(--bambook-gray-400)' : 'var(--bambook-gray-500)',
            }}
          >
            {data.total} 条关联
          </span>
        ) : null}
      </div>

      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: isDarkMode ? 'var(--bambook-gray-400)' : 'var(--bambook-gray-500)',
            fontSize: 13,
          }}
        >
          <Loader2 size={14} className="animate-spin" />
          加载关联…
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            color: '#dc2626',
            fontSize: 13,
            background: isDarkMode ? '#2a1818' : '#fef2f2',
            padding: 8,
            borderRadius: 8,
          }}
        >
          关联加载失败：{error}
        </div>
      )}

      {!loading && !error && groupKeys.length === 0 && (
        <div
          style={{
            color: isDarkMode ? 'var(--bambook-gray-500)' : 'var(--bambook-gray-400)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          暂无关联
        </div>
      )}

      {!loading && !error && groupKeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupKeys.map((kind) => {
            const items = groups[kind] ?? [];
            return (
              <div key={kind}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: isDarkMode ? 'var(--bambook-gray-400)' : 'var(--bambook-gray-500)',
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>{labelForLinkKind(kind)}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: isDarkMode ? 'var(--bambook-gray-500)' : 'var(--bambook-gray-400)',
                    }}
                  >
                    × {items.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {items.map((n) => (
                    <button
                      key={`${n.type}-${n.id}-${n.direction}`}
                      type="button"
                      onClick={() => onSelectNeighbor?.(n)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        background: isDarkMode ? '#23262c' : '#f9fafb',
                        border: `1px solid ${isDarkMode ? 'var(--bambook-gray-700)' : 'var(--bambook-gray-200)'}`,
                        borderRadius: 8,
                        cursor: onSelectNeighbor ? 'pointer' : 'default',
                        color: isDarkMode ? 'var(--bambook-gray-200)' : 'var(--bambook-gray-900)',
                        fontSize: 13,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {n.label || n.id}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? 'var(--bambook-gray-500)' : 'var(--bambook-gray-400)',
                          }}
                        >
                          {n.type} · {n.direction === 'out' ? '指向' : '被指向'}
                        </span>
                      </div>
                      {onSelectNeighbor && <ExternalLink size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RelatedEntitiesPanel;
