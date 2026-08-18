import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { createOrderUiSpec, ORDER_SECTION_ICONS, type OrderSectionIconKey } from './orderUiSpec';

interface OrderSectionHeaderProps {
  /** 分区图标 — 优先传 ORDER_SECTION_ICONS 的登记键，保证全域图标唯一来源。 */
  iconKey?: OrderSectionIconKey;
  /** 直接传图标组件（登记键覆盖不到的场景）。 */
  icon?: LucideIcon;
  /** 英文 overline（上位）。 */
  kicker: string;
  /** 中文标题（下位）。 */
  title: string;
  /** 右侧元信息/统计（如 "3/10 阶段已完成"）。 */
  meta?: React.ReactNode;
  isDarkMode: boolean;
  /** 完整替换外壳类（默认 spec.headerWrap 含 mb-4；表格头等自带边框场景传无 mb 变体）。 */
  wrapClassName?: string;
}

/**
 * 订单域统一分区头 — 所有面板/分区标题的唯一渲染器。
 * 结构固定为：icon + [kicker(EN) 上 / title(中文) 下] + 右侧 meta，
 * 与内容间距固定 mb-4。禁止在调用方另写分区头变体（大编号/彩色竖条/
 * 行内英文等均已废除）。
 */
const OrderSectionHeader: React.FC<OrderSectionHeaderProps> = ({
  iconKey,
  icon,
  kicker,
  title,
  meta,
  isDarkMode,
  wrapClassName,
}) => {
  const spec = createOrderUiSpec(isDarkMode);
  const Icon = icon ?? (iconKey ? ORDER_SECTION_ICONS[iconKey] : undefined);
  return (
    <div className={wrapClassName ?? spec.headerWrap}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${spec.headerIcon}`} />}
        <div className="min-w-0">
          <p className={spec.kicker}>{kicker}</p>
          <h3 className={`${spec.sectionTitle} truncate`}>{title}</h3>
        </div>
      </div>
      {meta != null && <div className={spec.headerMeta}>{meta}</div>}
    </div>
  );
};

export default OrderSectionHeader;
