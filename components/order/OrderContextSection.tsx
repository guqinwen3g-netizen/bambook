import React, { useEffect, useState } from 'react';
import {
  FileText, FlaskConical, ClipboardList, ShoppingCart, Factory,
  Scissors, Ship, Receipt, Loader2, ChevronRight,
} from 'lucide-react';
import { orderContextService, type OrderContext } from '../../services/orderContextService';
import { View } from '../../types';
import SidePanelContainer from '../ui/SidePanelContainer';
import OrderSectionHeader from './OrderSectionHeader';
import { createOrderUiSpec } from './orderUiSpec';

/**
 * 阶段 D / D3：订单详情「全链路」区块。
 *
 * 一站式呈现订单完整生命周期（只读）：
 *   报价 → 开发 → BOM → 采购 → 生产 → 外协 → 出运(报关/退税) → 财务(发票/核销/凭证)
 * 数据源：GET /api/v1/orders/:id/context（直接查表制，与 EntityLink 图谱双轨互补）。
 * 空阶段显示"未启动"灰态而非隐藏 —— 让用户看到流程全貌。
 * 点击卡片经 onNavigate 跳转对应模块。
 */

interface OrderContextSectionProps {
  orderId: string;
  isDarkMode?: boolean;
  onNavigate?: (view: View) => void;
  /** 变更触发重取（如订单刚保存后） */
  refreshKey?: number;
}

// ── 状态中文化（未收录的 status 原样显示） ──
const STATUS_LABELS: Record<string, string> = {
  Draft: '草稿', Sent: '已发送', Accepted: '已接受', Rejected: '已拒绝', Expired: '已过期',
  Confirmed: '已确认', PartiallyReceived: '部分到货', Received: '全部到货', Closed: '已关闭', Cancelled: '已取消',
  Issued: '已开票', PartiallyPaid: '部分销账', Paid: '已结清',
  Booked: '已订舱', Loading: '装货中', Shipped: '已发运', Arrived: '已到港', Cleared: '已清关', Delivered: '已交付',
  Submitted: '已提交', Declared: '已申报', Inspecting: '查验中', Released: '已放行', Exception: '异常',
  Reviewing: '审核中', Approved: '已批准', Refunded: '已退税',
  InProduction: '生产中',
  pending: '待启动', in_progress: '进行中', done: '已完成', blocked: '阻塞',
  developing: '开发中', shipping: '寄样中', feedback: '待反馈', revision: '修改中', approved: '已批准', cancelled: '已取消',
  unreconciled: '未核销', partially_reconciled: '部分核销', reconciled: '已核销',
  pass: '通过', conditional: '有条件通过', fail: '不通过',
  making: '制作中', sent: '已寄出', revising: '需修改',
};

const PROCESS_TYPE_LABELS: Record<string, string> = {
  Sewing: '缝制', Cutting: '裁剪', Washing: '水洗', Printing: '印花', Embroidery: '绣花', Dyeing: '染色', Other: '其他',
};

const SAMPLE_LEVEL_LABELS: Record<string, string> = {
  confirmation: '确认样', pp: '产前样', top: '大货样',
};

const PRODUCTION_STAGE_LABELS: Record<string, string> = {
  order_placed: '业务下单', materials_confirmed: '面辅料确认', production_planned: '生产计划',
  in_production: '货期管理', materials_arrived: '面辅料到厂', pre_cut_checked: '裁剪前检查',
  pp_sample_approved: '产前样确认', manufacturing: '生产过程', final_review: '成品确认', qc_shipped: '验货发货',
};

const statusLabel = (s?: string | null) => (s ? STATUS_LABELS[s] ?? s : '—');
const processLabel = (s?: string | null) => (s ? PROCESS_TYPE_LABELS[s] ?? s : '—');
const fmtAmount = (n?: number | null, c?: string | null) =>
  n == null ? '' : `${c ?? ''} ${Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`.trim();

interface StageDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  view?: View;
  count: number;
  items: Array<{ id: string; primary: string; secondary?: string; status?: string | null }>;
}

export const OrderContextSection: React.FC<OrderContextSectionProps> = ({
  orderId,
  isDarkMode = false,
  onNavigate,
  refreshKey = 0,
}) => {
  const [ctx, setCtx] = useState<OrderContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    orderContextService.getOrderContext(orderId)
      .then((data) => { if (!cancelled) setCtx(data); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, refreshKey]);

  // ── 统一规范真源（orderUiSpec）：玻璃面板 + 胶囊条目，与详情页所有面板同构 ──
  const spec = createOrderUiSpec(isDarkMode);
  const mutedCls = spec.textMuted;
  const faintCls = spec.textFaint;

  const stages: StageDef[] = ctx ? buildStages(ctx) : [];

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
        iconKey="context"
        kicker="Fulfillment Chain"
        title="订单全链路"
        meta={ctx ? `${stages.filter((s) => s.count > 0).length}/${stages.length} 阶段已启动` : undefined}
        isDarkMode={isDarkMode}
      />

      {loading && (
        <div className={`flex items-center gap-2 ${spec.emptyText}`}>
          <Loader2 size={14} className="animate-spin" /> 加载全链路…
        </div>
      )}
      {error && !loading && (
        <div className={spec.bannerDanger}>
          全链路加载失败：{error}
        </div>
      )}

      {!loading && !error && ctx && (
        <div className="flex flex-col gap-2.5">
          {stages.map((stage) => (
            <div key={stage.key} className="flex items-start gap-3">
              {/* 阶段标签列 */}
              <div className={`flex w-[76px] shrink-0 items-center gap-1.5 pt-1.5 text-xs ${stage.count > 0 ? `font-normal ${spec.stageLabelActive}` : `font-light ${faintCls}`}`}>
                {stage.icon}
                <span>{stage.label}</span>
              </div>
              {/* 内容列 */}
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {stage.count === 0 ? (
                  <span className={`py-1 text-xs font-light italic ${faintCls}`}>未启动</span>
                ) : (
                  stage.items.map((item) => {
                    const clickable = !!stage.view && !!onNavigate;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!clickable}
                        onClick={() => stage.view && onNavigate?.(stage.view)}
                        title={item.secondary ? `${item.primary} · ${item.secondary}` : item.primary}
                        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 text-left text-xs font-light transition-all ${spec.rowPillSurface} ${clickable ? spec.rowPillHover : 'cursor-default'}`}
                      >
                        <span className="truncate font-normal">{item.primary}</span>
                        {item.secondary && (
                          <span className={`truncate ${mutedCls}`}>{item.secondary}</span>
                        )}
                        {item.status && (
                          <span className={spec.chip}>
                            {statusLabel(item.status)}
                          </span>
                        )}
                        {clickable && <ChevronRight size={12} strokeWidth={1.5} className={`shrink-0 ${faintCls}`} />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SidePanelContainer>
  );
};

function buildStages(ctx: OrderContext): StageDef[] {
  const doneStages = ctx.production.stages.filter((s) => s.status === 'done').length;
  const totalStages = ctx.production.stages.length;
  const productionItems: StageDef['items'] = [];
  if (totalStages > 0) {
    const current = ctx.production.stages.find((s) => s.status !== 'done');
    productionItems.push({
      id: 'pipeline',
      primary: `管线 ${doneStages}/${totalStages}`,
      secondary: current ? `当前:${PRODUCTION_STAGE_LABELS[current.stageKey] ?? current.stageKey}` : '全部完成',
      status: current ? current.status : 'done',
    });
  }
  for (const insp of ctx.production.inspections) {
    productionItems.push({
      id: insp.id,
      primary: insp.inspectionType === 'midline' ? '中期验货' : '终期验货',
      secondary: [insp.inspectionDate, insp.aqlLevel ? `AQL ${insp.aqlLevel}` : null].filter(Boolean).join(' · ') || undefined,
      status: insp.result,
    });
  }

  const shipmentItems: StageDef['items'] = [];
  for (const s of ctx.shipments) {
    const decls = s.customsDeclarations;
    const refundCount = decls.reduce((n, d) => n + d.taxRefunds.length, 0);
    shipmentItems.push({
      id: s.id,
      primary: s.shipmentNumber,
      secondary: [
        s.etd ? `ETD ${s.etd}` : null,
        decls.length > 0 ? `报关${decls.length}` : null,
        refundCount > 0 ? `退税${refundCount}` : null,
      ].filter(Boolean).join(' · ') || undefined,
      status: s.status,
    });
  }
  for (const d of ctx.customsDeclarations) {
    shipmentItems.push({
      id: d.id,
      primary: d.declarationNumber,
      secondary: d.taxRefunds.length > 0 ? `退税${d.taxRefunds.length}` : undefined,
      status: d.status,
    });
  }
  for (const r of ctx.taxRefunds) {
    shipmentItems.push({ id: r.id, primary: r.refundNumber, secondary: fmtAmount(r.refundAmount, 'CNY') || undefined, status: r.status });
  }

  const financeItems: StageDef['items'] = [];
  for (const inv of ctx.finance.invoices) {
    financeItems.push({
      id: inv.id,
      primary: inv.invoiceNumber,
      secondary: [
        inv.type === 'Receivable' ? '应收' : inv.type === 'Payable' ? '应付' : inv.type,
        fmtAmount(inv.amount, inv.currency),
        inv.allocations.length > 0 ? `核销${inv.allocations.length}笔` : null,
      ].filter(Boolean).join(' · '),
      status: inv.status,
    });
  }
  for (const v of ctx.finance.vouchers) {
    financeItems.push({
      id: v.id,
      primary: v.voucherNumber,
      secondary: [v.type === 'Receipt' ? '收款' : v.type === 'Disbursement' ? '付款' : v.type, fmtAmount(v.amount, v.currency), v.paymentDate].filter(Boolean).join(' · '),
      status: v.status,
    });
  }

  return [
    {
      key: 'quotation', label: '报价', icon: <FileText size={13} />, view: View.Quotations,
      count: ctx.quotation.length,
      items: ctx.quotation.map((q) => ({
        id: q.id, primary: q.quotationNumber,
        secondary: [fmtAmount(q.totalAmount, q.currency), q.issueDate].filter(Boolean).join(' · ') || undefined,
        status: q.status,
      })),
    },
    {
      key: 'development', label: '开发', icon: <FlaskConical size={13} />, view: View.Development,
      count: ctx.developmentCase.length,
      items: ctx.developmentCase.map((c) => ({
        id: c.id, primary: c.code,
        secondary: [
          c.name,
          c.sampleNodes.length > 0
            ? c.sampleNodes.map((n) => `${SAMPLE_LEVEL_LABELS[n.level] ?? n.level}${statusLabel(n.status)}`).join('/')
            : null,
        ].filter(Boolean).join(' · '),
        status: c.stage,
      })),
    },
    {
      key: 'bom', label: 'BOM', icon: <ClipboardList size={13} />, view: View.BOM,
      count: ctx.bom.length,
      items: ctx.bom.map((b) => ({
        id: b.id, primary: b.bomNumber,
        secondary: [`v${b.version}`, fmtAmount(b.totalCost, b.currency)].filter(Boolean).join(' · '),
        status: b.status,
      })),
    },
    {
      key: 'procurement', label: '采购', icon: <ShoppingCart size={13} />, view: View.Procurement,
      count: ctx.procurement.length,
      items: ctx.procurement.map((p) => ({
        id: p.id, primary: p.poNumber,
        secondary: [p.supplierName, fmtAmount(p.totalAmount, p.currency), p.expectedDeliveryDate ? `交期 ${p.expectedDeliveryDate}` : null].filter(Boolean).join(' · ') || undefined,
        status: p.status,
      })),
    },
    {
      key: 'production', label: '生产', icon: <Factory size={13} />,
      count: productionItems.length,
      items: productionItems,
    },
    {
      key: 'outsourcing', label: '外协', icon: <Scissors size={13} />, view: View.MES,
      count: ctx.outsourcing.length,
      items: ctx.outsourcing.map((o) => ({
        id: o.id, primary: o.orderNumber,
        secondary: [
          processLabel(o.processType),
          `${o.quantity} ${o.unit}`,
          o.plannedDeliveryDate ? `交期 ${o.plannedDeliveryDate}` : null,
          o.qualityAcceptedQty > 0 ? `合格 ${o.qualityAcceptedQty}` : null,
        ].filter(Boolean).join(' · '),
        status: o.status,
      })),
    },
    {
      key: 'shipment', label: '出运', icon: <Ship size={13} />, view: View.Shipments,
      count: shipmentItems.length,
      items: shipmentItems,
    },
    {
      key: 'finance', label: '财务', icon: <Receipt size={13} />, view: View.Invoices,
      count: financeItems.length,
      items: financeItems,
    },
  ];
}

export default OrderContextSection;
