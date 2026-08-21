/**
 * NavRelationFilterChip — 跨模块导航筛选提示条
 *
 * 目标模块经 consumeCrossModuleNav 收到关联筛选后，在列表顶部显示
 * 「正在查看：{relationName} 的{label} ✕」——让用户明确知道当前是
 * 跨模块跳转的筛选态，点 ✕ 回到全量视图。
 */
import React from 'react';
import { X } from 'lucide-react';
import type { CrossModuleNavFilter } from '../../services/crossModuleNav';

interface NavRelationFilterChipProps {
  filter: CrossModuleNavFilter | null;
  /** 业务域标签（如「订单」「报价」） */
  label: string;
  onClear: () => void;
}

export const NavRelationFilterChip: React.FC<NavRelationFilterChipProps> = ({ filter, label, onClear }) => {
  if (!filter) return null;
  const isProduct = filter.anchor === 'product';
  const name = isProduct
    ? filter.productName || filter.productId || ''
    : filter.relationName || filter.relationId || '';
  const roleSuffix = !isProduct && filter.relationRole === 'supplier'
    ? '（供应商）'
    : isProduct
      ? '（产品档案）'
      : '';
  return (
    <div className="flex items-center gap-2 px-3 h-8 rounded-control border border-[color:var(--border-c-default)] bg-[var(--recessed-bg)]">
      <span className="text-xs font-light text-[var(--text-secondary)]">
        正在查看：
        <span className="text-[var(--text-primary)]">{name}</span>
        <span className="text-[var(--text-tertiary)]"> 的{label}{roleSuffix}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        title="清除筛选，查看全部"
        className="flex items-center justify-center w-5 h-5 rounded-full transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-darken)]"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
};

export default NavRelationFilterChip;
