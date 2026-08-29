/**
 * RelatedWorkspacesSection — 详情页「关联业务」导航枢纽（产品化 Links）
 *
 * 取代原 RelatedEntitiesPanel 的图谱边表展示：按业务域显示入口卡片
 * （`订单 6 笔 →`），点击 → primeCrossModuleNav 写入筛选上下文 →
 * onNavigate 切换到目标模块 → 目标页挂载时消费上下文自动筛选为该实体的数据。
 *
 * 支持双源实体：
 *   - sourceType='relation'：客户/供应商组织（relationId 锚，13 个业务域）
 *   - sourceType='product'：产品档案（productId 锚，订单/报价/采购/开发/库存/BOM/出运）
 *
 * 计数来自 /api/v1/entities/related-summary（业务表真实字段 count——
 * relation 按客户/供应商字段；product 按 productAssetId 精确 + 单据行编码集合匹配）。
 */
import React, { useEffect, useState } from 'react';
import {
  ClipboardList, FlaskConical, FileText, ShoppingCart,
  Receipt, CreditCard, BookOpenText, Ship, Landmark,
  RotateCcw, Banknote, TrendingUp, Factory,
  ArrowRight, Loader2, Package, Layers,
} from 'lucide-react';
import { View } from '../../types';
import { entityLinksService, type RelatedSummary } from '../../services/entityLinksService';
import { primeCrossModuleNav } from '../../services/crossModuleNav';
import { CompiledSurfacePanel } from './primitives/compiledSurfacePrimitives';

export type LinksSourceType = 'relation' | 'product';

interface RelatedWorkspacesSectionProps {
  /** ── relation 源 ── */
  relationId?: string;
  relationName?: string;
  relationRole?: 'customer' | 'supplier';
  /** ── product 源 ── */
  productId?: string;
  productName?: string;
  productCodes?: string[];
  /** 源实体类型（缺省 relation） */
  sourceType?: LinksSourceType;
  /** 视图切换回调（App 层 handleViewChange 透传） */
  onNavigate?: (view: View) => void;
  isDarkMode?: boolean;
}

interface WorkspaceEntry {
  key: keyof RelatedSummary;
  view: View;
  tab?: string;
  label: string;
  icon: React.ReactNode;
}

/** relation 源入口全集（13 域，按外贸业务动线排列）。
 *  结汇/付汇是凭证详情内的操作流（非独立列表页），不设入口。 */
const RELATION_ENTRIES: WorkspaceEntry[] = [
  { key: 'orders', view: View.Orders, label: '订单', icon: <ClipboardList size={16} strokeWidth={1.5} /> },
  { key: 'developments', view: View.Development, label: '开发', icon: <FlaskConical size={16} strokeWidth={1.5} /> },
  { key: 'quotations', view: View.Quotations, label: '报价', icon: <FileText size={16} strokeWidth={1.5} /> },
  { key: 'purchaseOrders', view: View.Procurement, label: '采购', icon: <ShoppingCart size={16} strokeWidth={1.5} /> },
  { key: 'invoices', view: View.Invoices, label: '发票', icon: <Receipt size={16} strokeWidth={1.5} /> },
  { key: 'paymentVouchers', view: View.PaymentVouchers, label: '收付款', icon: <CreditCard size={16} strokeWidth={1.5} /> },
  { key: 'vatInvoices', view: View.Invoices, tab: 'vatInvoices', label: '增值税发票', icon: <BookOpenText size={16} strokeWidth={1.5} /> },
  { key: 'shipments', view: View.Shipments, label: '出运', icon: <Ship size={16} strokeWidth={1.5} /> },
  { key: 'customsDeclarations', view: View.Customs, label: '报关', icon: <Landmark size={16} strokeWidth={1.5} /> },
  { key: 'taxRefunds', view: View.Customs, tab: 'taxRefunds', label: '退税', icon: <RotateCcw size={16} strokeWidth={1.5} /> },
  { key: 'lettersOfCredit', view: View.Customs, tab: 'lettersOfCredit', label: '信用证', icon: <Banknote size={16} strokeWidth={1.5} /> },
  { key: 'opportunities', view: View.CRM, tab: 'opportunities', label: '商机', icon: <TrendingUp size={16} strokeWidth={1.5} /> },
  { key: 'outsourcingOrders', view: View.MES, tab: 'outsourcing', label: '外协', icon: <Factory size={16} strokeWidth={1.5} /> },
];

/** 产品源入口全集：仅产品维度有业务语义的域（订单/报价/采购/开发/库存/BOM/出运）。 */
const PRODUCT_ENTRIES: WorkspaceEntry[] = [
  { key: 'orders', view: View.Orders, label: '订单', icon: <ClipboardList size={16} strokeWidth={1.5} /> },
  { key: 'quotations', view: View.Quotations, label: '报价', icon: <FileText size={16} strokeWidth={1.5} /> },
  { key: 'purchaseOrders', view: View.Procurement, label: '采购', icon: <ShoppingCart size={16} strokeWidth={1.5} /> },
  { key: 'developments', view: View.Development, label: '开发', icon: <FlaskConical size={16} strokeWidth={1.5} /> },
  { key: 'inventory', view: View.Inventory, label: '库存', icon: <Package size={16} strokeWidth={1.5} /> },
  { key: 'boms', view: View.BOM, label: 'BOM 成本', icon: <Layers size={16} strokeWidth={1.5} /> },
  { key: 'shipments', view: View.Shipments, label: '出运', icon: <Ship size={16} strokeWidth={1.5} /> },
];

export const RelatedWorkspacesSection: React.FC<RelatedWorkspacesSectionProps> = ({
  relationId,
  relationName,
  relationRole = 'customer',
  productId,
  productName,
  productCodes,
  sourceType = 'relation',
  onNavigate,
  isDarkMode = false,
}) => {
  const [summary, setSummary] = useState<RelatedSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  // R4 三态补全：getRelatedSummary 失败不再静默吞掉（原 catch(()=>setLoaded(true)) 把失败伪装成
  // 「暂无关联业务记录」）——置 error 态并给重试入口；retryKey 自增驱动 effect 重跑
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const isProduct = sourceType === 'product';
  const anchorId = isProduct ? (productId ?? '') : (relationId ?? '');
  const apiType = isProduct ? 'product' : 'relation.organization';
  const entries = isProduct ? PRODUCT_ENTRIES : RELATION_ENTRIES;
  const displayName = isProduct ? (productName ?? '') : (relationName ?? '');

  useEffect(() => {
    if (!anchorId) {
      setLoaded(true);
      setLoadError(false);
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setLoadError(false);
    entityLinksService.getRelatedSummary({ type: apiType, id: anchorId })
      .then((s) => { if (!cancelled) { setSummary(s); setLoaded(true); } })
      .catch(() => { if (!cancelled) { setLoadError(true); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [anchorId, apiType, retryKey]);

  const handleClick = (entry: WorkspaceEntry) => {
    if (!onNavigate) return;
    primeCrossModuleNav({
      view: entry.view,
      tab: entry.tab,
      filter: isProduct
        ? { anchor: 'product', productId: anchorId, productName: displayName, productCodes }
        : { anchor: 'relation', relationId: anchorId, relationName: displayName, relationRole },
    });
    onNavigate(entry.view);
  };

  const quietText = 'text-[var(--text-tertiary)]';
  const entryBase = 'group flex items-center gap-2.5 px-3 h-10 rounded-control transition-colors';
  const entryIdle = 'border border-transparent bg-transparent hover:bg-[var(--hover-darken)] active:scale-[0.99] active:bg-[var(--active-darken)]';
  const entryMuted = 'opacity-45 hover:opacity-70';

  return (
    <CompiledSurfacePanel
      as="section"
      isDarkMode={isDarkMode}
      materialRole="insetSurface"
      materialTone="nested"
      className="p-3.5 !rounded-inset"
      contentClassName="relative z-10"
      compilerRole="related-workspaces-panel"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <p className={`text-[10px] font-light uppercase tracking-[0.18em] ${quietText}`}>Links</p>
          <p className="text-xs font-light text-[var(--text-primary)]">关联业务</p>
        </div>
        {!loaded && <Loader2 size={14} className={`animate-spin ${quietText}`} />}
      </div>

      {!loaded ? (
        <p className={`text-xs ${quietText} py-1`}>加载中…</p>
      ) : loadError ? (
        /* R4：加载失败明示 + 重试，不把失败伪装成空数据 */
        <div className="flex items-center gap-2 py-1">
          <p className={`text-xs ${quietText}`}>关联业务加载失败</p>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            className="flex items-center gap-1 text-xs font-light text-link hover:underline"
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            重试
          </button>
        </div>
      ) : !anchorId || !summary || entries.every(e => !Number(summary[e.key])) ? (
        <p className={`text-xs ${quietText} py-1`}>暂无关联业务记录</p>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          {entries.map((entry) => {
            const count = Number(summary?.[entry.key] ?? 0);
            if (!count) {
              return (
                <div key={entry.key} className={`${entryBase} ${entryIdle} ${entryMuted} cursor-default`} aria-disabled>
                  <span className={quietText}>{entry.icon}</span>
                  <span className={`text-xs font-light ${quietText}`}>{entry.label}</span>
                  <span className={`ml-auto text-[10px] font-light ${quietText}`}>0</span>
                </div>
              );
            }
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => handleClick(entry)}
                title={`查看${displayName ? ` ${displayName} 的` : '该档案的'}${entry.label}记录`}
                className={`${entryBase} ${entryIdle}`}
              >
                <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">{entry.icon}</span>
                <span className="text-xs font-light text-[var(--text-primary)]">{entry.label}</span>
                <span className="ml-auto flex items-center gap-1">
                  <span className="text-[10px] font-light tabular-nums px-1.5 py-0.5 rounded-full text-[var(--text-secondary)] bg-[var(--recessed-bg)]">{count}</span>
                  <ArrowRight size={14} strokeWidth={1.5} className={`${quietText} opacity-0 group-hover:opacity-100 transition-opacity`} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </CompiledSurfacePanel>
  );
};

export default RelatedWorkspacesSection;