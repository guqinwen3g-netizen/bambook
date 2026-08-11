import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  entityLinksService,
  labelForLinkKind,
  type NeighborsResponse,
  type NeighborRow,
} from '../services/entityLinksService';
import SidePanelContainer from './ui/SidePanelContainer';
import OrderSectionHeader from './order/OrderSectionHeader';
import { createOrderUiSpec } from './order/orderUiSpec';

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
  /**
   * Additional type codes for the same entity (graph code aliasing).
   * The EntityLink graph historically uses more than one type code for the
   * same row — e.g. a Relation contact owns links as "relation.contact" but
   * is targeted by order sales/merchandiser roles as "relation.person".
   * Neighbors from all listed codes are merged by linkKind.
   */
  additionalTypes?: string[];
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
  additionalTypes,
  title = '关联视图',
  onSelectNeighbor,
  isDarkMode = false,
  limit = 200,
  refreshKey = 0,
}) => {
  const [data, setData] = useState<NeighborsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const additionalTypesKey = (additionalTypes ?? []).join('|');

  useEffect(() => {
    if (!type || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const typeCodes = [type, ...(additionalTypes ?? [])];
    Promise.all(
      typeCodes.map((t) => entityLinksService.getNeighbors({ type: t, id, limit })),
    )
      .then((responses) => {
        if (cancelled) return;
        // 多 type code 结果按 linkKind 合并（图谱别名场景）
        const merged: Record<string, NeighborRow[]> = {};
        let total = 0;
        for (const res of responses) {
          total += res.total ?? 0;
          for (const [kind, rows] of Object.entries(res.neighbors ?? {})) {
            merged[kind] = [...(merged[kind] ?? []), ...rows];
          }
        }
        setData({ ok: true, type, id, total, neighbors: merged });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, limit, refreshKey, additionalTypesKey]);

  // ── 统一规范真源（orderUiSpec）：玻璃面板 + 胶囊行，与详情页所有面板同构 ──
  const spec = createOrderUiSpec(isDarkMode);
  const mutedCls = spec.textMuted;
  const rowCls = `${spec.rowPill} ${onSelectNeighbor ? spec.rowPillHover : 'cursor-default'}`;

  const groups = data?.neighbors ?? {};
  const groupKeys = Object.keys(groups).sort();

  return (
    <SidePanelContainer
      materialRole="raisedCard"
      edgeFadeItem
      spotlight
      isDarkMode={isDarkMode}
      className={spec.panelClass}
      contentClassName={spec.panelContentClass}
    >
      <OrderSectionHeader
        iconKey="related"
        kicker="Entity Links"
        title={title}
        meta={data ? `${data.total} 条关联` : undefined}
        isDarkMode={isDarkMode}
      />

      {loading && (
        <div className={`flex items-center gap-2 ${spec.emptyText}`}>
          <Loader2 size={14} className="animate-spin" />
          加载关联…
        </div>
      )}

      {error && !loading && (
        <div className={spec.bannerDanger}>
          关联加载失败：{error}
        </div>
      )}

      {!loading && !error && groupKeys.length === 0 && (
        <div className={`${spec.emptyText} italic`}>
          暂无关联
        </div>
      )}

      {!loading && !error && groupKeys.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {groupKeys.map((kind) => {
            const items = groups[kind] ?? [];
            return (
              <div key={kind}>
                <div className={`mb-2 flex items-center gap-2 ${spec.kicker}`}>
                  <span>{labelForLinkKind(kind)}</span>
                  <span className={spec.textFaint}>× {items.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {items.map((n) => (
                    <button
                      key={`${n.type}-${n.id}-${n.direction}`}
                      type="button"
                      onClick={() => onSelectNeighbor?.(n)}
                      title={`${n.label || n.id}（${n.type} · ${n.direction === 'out' ? '指向' : '被指向'}）`}
                      className={rowCls}
                    >
                      <span className="truncate text-[13px] font-light">{n.label || n.id}</span>
                      <span className={`flex shrink-0 items-center gap-2 text-[10px] font-light ${mutedCls}`}>
                        {n.type} · {n.direction === 'out' ? '指向' : '被指向'}
                        {onSelectNeighbor && <ExternalLink size={12} strokeWidth={1.5} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SidePanelContainer>
  );
};

export default RelatedEntitiesPanel;
