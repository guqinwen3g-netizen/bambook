/**
 * CommandPalette — D1 全局工作台体验：命令面板（Cmd/Ctrl+K 唤起）
 *
 * 能力：
 *   1. 全局数据搜索：客户/订单/产品/发票/发货/知识/邮件 7 类业务实体，
 *      复用 App 层已加载 state 客户端过滤（零新增端点，离线可用），每类最多 5 条。
 *   2. 快捷指令：全部主导航视图跳转（moduleRegistry productLabel + canAccessView 权限过滤）。
 *   3. 跨模块跳转合约：订单记录直开详情（App 受控 selectedOrder），
 *      其余记录跳转到所属模块视图（视图内可继续模块级搜索）。
 *
 * 键盘：↑↓ 导航（跨分组扁平索引）/ Enter 执行 / Esc 关闭；遮罩点击关闭。
 * RDL flat 纪律：RdlSurface 容器 + 语义 token，零硬编码圆角/hex/阴影。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ArrowRight, CornerDownLeft,
  Users, ShoppingBag, Package, Receipt, Ship, BookOpen, Mail,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { View, Relation, Order, ProductAsset, Invoice, Shipment, KnowledgeItem, Email } from '../types';
import { getPrimaryNavigationModules } from './moduleRegistry';
import { canAccessView, hasRole } from '../services/authService';
import { RdlSurface } from './ui/RDLPrimitives';

/** 面板结果项（扁平化，键盘导航用） */
type PaletteItem =
  | { kind: 'view'; key: string; view: View; label: string; icon: LucideIcon }
  | { kind: 'record'; key: string; domain: RecordDomain; id: string; title: string; subtitle: string; icon: LucideIcon; order?: Order };

/** 数据域中文标签（分组标题 + 记录副标题） */
type RecordDomain = '客户' | '订单' | '产品' | '发票' | '发货' | '知识' | '邮件';

const DOMAIN_ORDER: RecordDomain[] = ['客户', '订单', '产品', '发票', '发货', '知识', '邮件'];
/** 每域最多展示条数（防大列表淹没面板） */
const DOMAIN_LIMIT = 5;
/** 空查询时最多展示的视图指令数 */
const VIEW_LIMIT_IDLE = 12;

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
  relations: Relation[];
  orders: Order[];
  products: ProductAsset[];
  invoices: Invoice[];
  shipments: Shipment[];
  knowledge: KnowledgeItem[];
  emails: Email[];
  onNavigate: (view: View) => void;
  /** 订单记录直开详情（App 受控 selectedOrder） */
  onOpenOrder: (order: Order) => void;
}

const norm = (s: string) => s.toLowerCase().trim();

function matches(query: string, ...fields: Array<string | undefined | null>): boolean {
  const q = norm(query);
  if (!q) return true;
  return fields.some(f => f && norm(String(f)).includes(q));
}

/** 命令面板数据输入（App 层 state 快照） */
export interface PaletteData {
  relations: Relation[];
  orders: Order[];
  products: ProductAsset[];
  invoices: Invoice[];
  shipments: Shipment[];
  knowledge: KnowledgeItem[];
  emails: Email[];
}

/**
 * 数据记录搜索（纯函数，可测）：客户端过滤 7 类业务实体，
 * 软删记录排除，大小写不敏感，每域最多 DOMAIN_LIMIT 条，按 DOMAIN_ORDER 稳定排序。
 * 订单记录携带 order 引用供直开详情；空查询返回空（空查询只展示视图指令）。
 */
export function buildRecordGroups(query: string, data: PaletteData): Array<{ domain: RecordDomain; items: PaletteItem[] }> {
  const q = norm(query);
  if (!q) return [];
  const groups: Array<{ domain: RecordDomain; items: PaletteItem[] }> = [];
  const push = (domain: RecordDomain, items: PaletteItem[]) => {
    if (items.length > 0) groups.push({ domain, items: items.slice(0, DOMAIN_LIMIT) });
  };

  push('客户', data.relations
    .filter(r => !(r as any).deletedAt && matches(q, r.name, r.contactInfo, r.role))
    .map(r => ({
      kind: 'record', domain: '客户', id: r.id, key: `relation:${r.id}`,
      title: r.name, subtitle: r.contactInfo || (r.type === 'Customer' ? '客户' : r.type === 'Supplier' ? '供应商' : '伙伴'),
      icon: Users,
    })));

  push('订单', data.orders
    .filter(o => !(o as any).deletedAt && matches(q, o.poNumber, o.customer, o.product, o.id))
    .map(o => ({
      kind: 'record', domain: '订单', id: o.id, key: `order:${o.id}`,
      title: o.poNumber || o.id, subtitle: `${o.customer} · ${o.product}`,
      icon: ShoppingBag, order: o,
    })));

  push('产品', data.products
    .filter(p => !p.deletedAt && matches(q, p.name, p.sku))
    .map(p => ({
      kind: 'record', domain: '产品', id: p.id, key: `product:${p.id}`,
      title: p.name, subtitle: p.sku,
      icon: Package,
    })));

  push('发票', data.invoices
    .filter(i => !(i as any).deletedAt && matches(q, i.invoiceNumber, i.customerName))
    .map(i => ({
      kind: 'record', domain: '发票', id: i.id, key: `invoice:${i.id}`,
      title: i.invoiceNumber, subtitle: i.customerName || '',
      icon: Receipt,
    })));

  push('发货', data.shipments
    .filter(s => !(s as any).deletedAt && matches(q, s.shipmentNumber))
    .map(s => ({
      kind: 'record', domain: '发货', id: s.id, key: `shipment:${s.id}`,
      title: s.shipmentNumber, subtitle: s.status || '',
      icon: Ship,
    })));

  push('知识', data.knowledge
    .filter(k => !k.deletedAt && matches(q, k.title, k.content))
    .map(k => ({
      kind: 'record', domain: '知识', id: k.id, key: `knowledge:${k.id}`,
      title: k.title, subtitle: k.category,
      icon: BookOpen,
    })));

  push('邮件', data.emails
    .filter(e => matches(q, e.subject, e.sender))
    .map(e => ({
      kind: 'record', domain: '邮件', id: e.id, key: `email:${e.id}`,
      title: e.subject || '(No Subject)', subtitle: e.sender?.split('<')[0]?.trim() || '',
      icon: Mail,
    })));

  return groups;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  isDarkMode = false,
  relations,
  orders,
  products,
  invoices,
  shipments,
  knowledge,
  emails,
  onNavigate,
  onOpenOrder,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时重置并聚焦
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // 等一帧确保渲染完成再聚焦
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 视图指令（权限过滤，与侧边栏同口径）
  const viewItems = useMemo<PaletteItem[]>(() => {
    const modules = getPrimaryNavigationModules({ isAdmin: hasRole('owner', 'admin'), canAccessView });
    return modules
      .filter(m => matches(query, m.productLabel, m.internalName, m.id))
      .slice(0, norm(query) ? modules.length : VIEW_LIMIT_IDLE)
      .map(m => ({
        kind: 'view' as const,
        key: `view:${m.view}`,
        view: m.view,
        label: m.productLabel,
        icon: m.icon,
      }));
  }, [query]);

  // 数据记录搜索（提取为纯函数 buildRecordGroups，见文件上方）
  const recordGroups = useMemo(
    () => buildRecordGroups(query, { relations, orders, products, invoices, shipments, knowledge, emails }),
    [query, relations, orders, products, invoices, shipments, knowledge, emails],
  );

  // 扁平化结果（键盘导航索引）
  const flatItems = useMemo<PaletteItem[]>(() => {
    const records = recordGroups.flatMap(g => g.items);
    return [...records, ...viewItems];
  }, [recordGroups, viewItems]);

  // 查询变化时重置高亮
  useEffect(() => { setActiveIndex(0); }, [query]);

  // 保持高亮项可见
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-palette-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const execute = (item: PaletteItem) => {
    if (item.kind === 'view') {
      onNavigate(item.view);
    } else if (item.kind === 'record' && item.domain === '订单' && item.order) {
      onOpenOrder(item.order);
    } else if (item.kind === 'record') {
      const target: Record<RecordDomain, View> = {
        客户: View.Relations,
        订单: View.Orders,
        产品: View.Products,
        发票: View.Invoices,
        发货: View.Shipments,
        知识: View.DataCenter,
        邮件: View.Emails,
      };
      onNavigate(target[item.domain]);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) execute(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const idleTextClass = 'text-[var(--text-tertiary)]';
  const titleTextClass = 'text-[var(--text-primary)]';
  const activeClass = 'bg-[var(--active-darken)]';

  let flatIndex = -1;
  const renderItem = (item: PaletteItem) => {
    flatIndex += 1;
    const idx = flatIndex;
    const Icon = item.icon;
    const isActive = idx === activeIndex;
    return (
      <button
        key={item.key}
        type="button"
        data-palette-index={idx}
        onMouseEnter={() => setActiveIndex(idx)}
        onClick={() => execute(item)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? activeClass : ''}`}
      >
        <span className={`shrink-0 ${idleTextClass}`}><Icon size={15} strokeWidth={1.5} /></span>
        <span className="flex-1 min-w-0">
          <span className={`block truncate text-[13px] font-light ${titleTextClass}`}>
            {item.kind === 'view' ? item.label : item.title}
          </span>
          {item.kind === 'record' && item.subtitle && (
            <span className={`block truncate text-[11px] font-light ${idleTextClass}`}>{item.subtitle}</span>
          )}
        </span>
        {item.kind === 'view' && (
          <span className={`shrink-0 text-[10px] font-light uppercase tracking-wider ${idleTextClass}`}>前往</span>
        )}
        {isActive && (
          <span className={`shrink-0 ${idleTextClass}`}><CornerDownLeft size={13} strokeWidth={1.5} /></span>
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/20 backdrop-blur-sm flex items-start justify-center pt-[16vh] px-6 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-label="全局搜索"
    >
      <RdlSurface
        tone="panel"
        className="w-full max-w-xl overflow-hidden flex flex-col max-h-[60vh] animate-in zoom-in duration-200"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* 搜索输入 */}
        <div className={`flex items-center gap-3 px-5 py-4 border-b border-[var(--border-c-subtle)]`}>
          <Search size={17} strokeWidth={1.5} className={idleTextClass} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索客户、订单、产品、发票、知识、邮件，或前往模块…"
            className={`flex-1 bg-transparent outline-none text-[15px] font-light placeholder:font-light ${titleTextClass} placeholder:text-[var(--text-tertiary)]`}
          />
          <kbd className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-light bg-[var(--active-darken)] text-[var(--text-tertiary)]`}>ESC</kbd>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-2">
          {flatItems.length === 0 && (
            <div className={`px-5 py-10 text-center text-[13px] font-light ${idleTextClass}`}>
              未找到「{query}」相关结果
            </div>
          )}

          {recordGroups.map(group => (
            <div key={group.domain} className="mb-1">
              <div className={`px-5 pt-2 pb-1 text-[10px] font-light uppercase tracking-widest ${idleTextClass}`}>
                {group.domain}
              </div>
              {group.items.map(renderItem)}
            </div>
          ))}

          {viewItems.length > 0 && (
            <div className="mb-1">
              <div className={`px-5 pt-2 pb-1 text-[10px] font-light uppercase tracking-widest ${idleTextClass}`}>
                模块
              </div>
              {viewItems.map(renderItem)}
            </div>
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className={`flex items-center gap-4 px-5 py-2.5 border-t text-[10px] font-light border-[var(--border-c-subtle)] text-[var(--text-tertiary)]`}>
          <span className="flex items-center gap-1">↑↓ 导航</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={10} strokeWidth={1.5} /> 打开</span>
          <span className="flex-1" />
          <span className="flex items-center gap-1"><ArrowRight size={10} strokeWidth={1.5} /> 订单记录直达详情</span>
        </div>
      </RdlSurface>
    </div>
  );
};

export default CommandPalette;
