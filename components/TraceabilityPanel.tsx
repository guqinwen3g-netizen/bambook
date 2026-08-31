/**
 * TraceabilityPanel — 一键溯源可视化面板
 *
 * 后端数据源：GET /api/v2/trace/:scenario/:rootId
 * 6 大场景：客户全景 / 订单履约链 / 报价到发货链 / 供应商全景 / 产品成本链 / 退税链
 *
 * 展示模式：
 *   1. summary 统计卡片（KVP）
 *   2. 节点按 type 分组卡片
 *   3. 边关系连线列表
 *
 * 设计：flat 无阴影、RDL 原语、tabular-nums
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, Search, GitBranch, ArrowRight, Boxes } from 'lucide-react';
import { RdlSurface, RdlPill } from './ui/RDLPrimitives';
import { PageHeader } from './ui/PageHeader';
import { apiService } from '../services/apiService';
import type { Relation } from '../types';
import RelationCombobox from './ui/RelationCombobox';
import {
  traceabilityService,
  TRACE_SCENARIOS,
  type TraceScenario,
  type TraceResult,
  type TraceNode,
} from '../services/traceabilityService';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ── 节点类型 → 显示标签 + 色调（BDS §4.5 雾化分类色板 mask-* 文字元，饱和 45%；共 10 色相，
//    2026-08-31 用户裁决 14 并组到 10：sky→blue / olive→emerald·amber / teal→green / indigo→blue，
//    同族实体取同族同色系，靠文字标签区分）──
const NODE_TYPE_META: Record<string, { label: string; tone: string }> = {
  Relation:            { label: '业务伙伴', tone: 'text-[var(--mask-blue-text)]' },
  Order:               { label: '订单',     tone: 'text-[var(--mask-violet-text)]' },
  OrderLine:           { label: '订单行',   tone: 'text-[var(--mask-violet-soft-text)]' },
  Quotation:           { label: '报价单',   tone: 'text-[var(--mask-pink-text)]' },
  Invoice:             { label: '发票',     tone: 'text-[var(--mask-emerald-text)]' },
  PaymentVoucher:      { label: '收付款',   tone: 'text-[var(--mask-amber-text)]' },
  Shipment:            { label: '出货',     tone: 'text-[var(--mask-cyan-text)]' },
  CustomsDeclaration:  { label: '报关',     tone: 'text-[var(--mask-rose-text)]' },
  ProductionStage:     { label: '生产阶段', tone: 'text-[var(--mask-emerald-text)]' },
  SampleNode:          { label: '样品',     tone: 'text-[var(--mask-orange-text)]' },
  InspectionReport:    { label: '检验报告', tone: 'text-[var(--mask-green-text)]' },
  TradeDocument:       { label: '贸易单据', tone: 'text-[var(--mask-blue-text)]' },
  TaxRefund:           { label: '退税',     tone: 'text-[var(--mask-green-text)]' },
  Product:             { label: '产品',     tone: 'text-[var(--mask-blue-text)]' },
  // W-C A1 采购库存链（采购族=浅紫 / 收货=物流青 / 库存=流水琥珀·物料蓝）
  PurchaseOrder:       { label: '采购单',   tone: 'text-[var(--mask-violet-soft-text)]' },
  MaterialReceipt:     { label: '收货单',   tone: 'text-[var(--mask-cyan-text)]' },
  StockMovement:       { label: '库存变动', tone: 'text-[var(--mask-amber-text)]' },
  InventoryItem:       { label: '库存物料', tone: 'text-[var(--mask-blue-text)]' },
  Warehouse:           { label: '仓库',     tone: 'text-[var(--mask-amber-text)]' },
};

function nodeTypeLabel(type: string): string {
  return NODE_TYPE_META[type]?.label || type;
}

function nodeTypeTone(type: string): string {
  return NODE_TYPE_META[type]?.tone || 'text-[var(--text-secondary)]';
}

// ── 边关系 → 中文标签 ──
const EDGE_LABELS: Record<string, string> = {
  has_order: '下单',
  has_order_line: '包含行',
  has_invoice: '开票',
  has_payment: '收款',
  has_shipment: '出货',
  has_customs: '报关',
  has_production: '生产',
  has_sample: '打样',
  has_inspection: '检验',
  has_document: '单据',
  has_tax_refund: '退税',
  has_quotation: '报价',
  has_product: '产品',
  has_bom: 'BOM',
  has_cost: '成本',
  has_relation: '关联',
  // W-C A1 采购库存链
  has_receipt: '收货',
  has_stock_movement: '库存变动',
  moves_item: '出入库',
};

function edgeLabel(relation: string): string {
  return EDGE_LABELS[relation] || relation;
}

// ── summary 格式化 ──
function formatSummaryValue(value: any): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('zh-CN');
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function formatSummaryKey(key: string): string {
  const map: Record<string, string> = {
    totalOrders: '订单总数',
    totalInvoices: '发票总数',
    totalPayments: '收款总数',
    totalAmount: '总金额',
    totalPaid: '已回款',
    totalUnpaid: '未回款',
    totalShipped: '已出货',
    totalCustoms: '报关单',
    totalProduction: '生产阶段',
    totalSamples: '样品数',
    totalInspections: '检验报告',
    totalDocuments: '贸易单据',
    totalTaxRefund: '退税总额',
    totalQuotations: '报价单数',
    totalProducts: '产品数',
    arBalance: '应收余额',
    apBalance: '应付余额',
    paymentRate: '回款率',
    orderCount: '订单数',
    invoiceCount: '发票数',
    paymentCount: '收款数',
    shipCount: '出货数',
    overdue: '逾期数',
    // R678-9 purchaseToStock 场景汇总键（后端 traceabilityService 双入口：采购单正向 + 库存物料反向）
    poNumber: '采购单号',
    poStatus: '采购单状态',
    receiptCount: '收货单数',
    totalAccepted: '累计验收数量',
    movementCount: '库存变动数',
    itemCount: '库存物料数',
    poCount: '关联采购单数',
    currentQty: '当前库存量',
    materialCode: '物料编码',
    itemDescription: '物料描述',
    pending: '待处理',
    completed: '已完成',
    inProgress: '进行中',
  };
  return map[key] || key;
}

// ════════════════════════════════════════════════════════════════════
// 组件
// ════════════════════════════════════════════════════════════════════

export interface TraceabilityPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
  /** 嵌入模式：预设场景和 rootId，跳过选择器直接查询 */
  presetScenario?: TraceScenario;
  presetRootId?: string;
  /** 嵌入模式不显示 PageHeader */
  embedded?: boolean;
}

export function TraceabilityPanel({
  isDarkMode,
  endpoint,
  presetScenario,
  presetRootId,
  embedded = false,
}: TraceabilityPanelProps) {
  const [scenario, setScenario] = useState<TraceScenario>(presetScenario || 'customerPanorama');
  const [rootId, setRootId] = useState(presetRootId || '');
  // R678-3 Relation 根场景：档案检索下拉（免手输 ID）——rootLabelText 为显示名，rootId 为实际查询 ID
  const [rootLabelText, setRootLabelText] = useState('');
  const [rootRelations, setRootRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);

  const activeScenarioMeta = TRACE_SCENARIOS.find((s) => s.id === scenario);
  const isRelationRootScenario = activeScenarioMeta?.rootType === 'Relation';

  // 仅在选择器可见（非嵌入预设）且场景根为 Relation 时加载档案列表
  useEffect(() => {
    if (presetScenario || !isRelationRootScenario) return;
    let cancelled = false;
    apiService.listRelations()
      .then((list) => { if (!cancelled) setRootRelations(list); })
      .catch(() => { /* 档案列表加载失败不阻断其余场景的手输路径 */ });
    return () => { cancelled = true; };
  }, [presetScenario, isRelationRootScenario]);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-default)]';
  const rowBg = 'bg-[var(--recessed-bg)]';
  const inputBg = 'bg-[var(--recessed-bg)] border-[var(--border-c-default)]';

  const runTrace = useCallback(async (sc: TraceScenario, id: string) => {
    if (!id.trim()) {
      setError(TRACE_SCENARIOS.find((s) => s.id === sc)?.rootType === 'Relation' ? '请先搜索并选择溯源档案' : '请输入溯源根 ID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await traceabilityService.trace(sc, id.trim(), endpoint);
      setResult(res);
    } catch (e: any) {
      setError(e?.message || '溯源查询失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  // 嵌入模式自动查询
  useEffect(() => {
    if (presetScenario && presetRootId) {
      runTrace(presetScenario, presetRootId);
    }
  }, [presetScenario, presetRootId, runTrace]);

  // ── 按 type 分组节点 ──
  const groupedNodes = React.useMemo(() => {
    if (!result) return new Map<string, TraceNode[]>();
    const map = new Map<string, TraceNode[]>();
    for (const node of result.nodes) {
      const list = map.get(node.type) || [];
      list.push(node);
      map.set(node.type, list);
    }
    return map;
  }, [result]);

  // ── 构建 node id → node 映射（用于边展示）──
  const nodeMap = React.useMemo(() => {
    if (!result) return new Map<string, TraceNode>();
    return new Map(result.nodes.map((n) => [n.id, n]));
  }, [result]);

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* ── 场景选择器 + rootId 输入 ── */}
      {!presetScenario && (
        <RdlSurface tone="panel" padding="compact" className="space-y-3">
          {/* 场景 pills */}
          <div className="flex flex-wrap gap-1.5">
            {TRACE_SCENARIOS.map((s) => (
              <RdlPill
                key={s.id}
                active={scenario === s.id}
                onClick={() => {
                  // R678-9 切换场景清空旧结果与旧根——避免上一场景的结果/根 ID 挂在
                  // 新场景下被误读（根实体类型随场景变化，旧 ID 在新场景下无意义）
                  setScenario(s.id);
                  setResult(null);
                  setError(null);
                  setRootId('');
                  setRootLabelText('');
                }}
              >
                {s.label}
              </RdlPill>
            ))}
          </div>
          {/* 当前场景描述 */}
          <div className={cx('text-xs font-light', textSecondary)}>
            {TRACE_SCENARIOS.find((s) => s.id === scenario)?.description}
          </div>
          {/* rootId 输入 + 查询按钮：Relation 根场景用档案检索下拉（免手输 ID），其余场景保留 ID 输入 */}
          <div className="flex items-center gap-2">
            {isRelationRootScenario ? (
              <div className="flex-1 min-w-0">
                <RelationCombobox
                  value={rootLabelText}
                  relationId={rootId || undefined}
                  relations={rootRelations}
                  placeholder="搜索并选择档案..."
                  inputClassName={cx('h-9 w-full rounded-field border px-3 text-xs font-light outline-none', inputBg, textPrimary)}
                  onChange={({ name, relationId: nextId }) => {
                    setRootLabelText(name);
                    setRootId(nextId || '');
                  }}
                />
              </div>
            ) : (
              <input
                type="text"
                value={rootId}
                onChange={(e) => setRootId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runTrace(scenario, rootId); }}
                placeholder={activeScenarioMeta?.rootLabel || '输入 ID...'}
                className={cx('h-9 flex-1 rounded-field border px-3 text-xs font-light outline-none', inputBg, textPrimary)}
              />
            )}
            <button
              onClick={() => runTrace(scenario, rootId)}
              disabled={loading}
              className={cx(
                'flex h-9 items-center gap-1.5 rounded-field px-4 text-xs font-light transition-colors',
                'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]',
                loading && 'opacity-50',
              )}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              溯源
            </button>
          </div>
        </RdlSurface>
      )}

      {/* ── 错误提示 ── */}
      {error && (
        <div className={cx('flex items-center gap-2 rounded-card px-3 py-2 text-xs font-light bg-[var(--danger-tint)] text-[var(--danger-text)]')}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* ── 加载中 ── */}
      {loading && (
        <div className={cx('flex items-center justify-center gap-2 py-12 text-xs font-light', textSecondary)}>
          <Loader2 size={16} className="animate-spin" />
          正在查询溯源链路...
        </div>
      )}

      {/* ── 溯源结果 ── */}
      {result && !loading && (
        <>
          {/* summary 统计卡片 */}
          {Object.keys(result.summary).length > 0 && (
            <div>
              <div className={cx('mb-1.5 flex items-center gap-1.5 text-[10px] font-light tracking-[0.14em]', textFaint)}>
                <Boxes size={14} />
                汇总 SUMMARY
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(result.summary).map(([key, value]) => (
                  <RdlSurface key={key} tone="card" padding="compact" className="space-y-0.5">
                    <div className={cx('text-[10px] font-light', textFaint)}>{formatSummaryKey(key)}</div>
                    <div className={cx('text-sm font-light tabular-nums', textPrimary)}>{formatSummaryValue(value)}</div>
                  </RdlSurface>
                ))}
              </div>
            </div>
          )}

          {/* 节点分组展示 */}
          <div>
            <div className={cx('mb-1.5 flex items-center gap-1.5 text-[10px] font-light tracking-[0.14em]', textFaint)}>
              <GitBranch size={14} />
              节点 NODES ({result.nodes.length})
            </div>
            <div className="space-y-2">
              {Array.from(groupedNodes.entries()).map(([type, nodes]) => (
                <RdlSurface key={type} tone="card" padding="compact" className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={cx('text-xs font-light', nodeTypeTone(type))}>
                      {nodeTypeLabel(type)}
                    </span>
                    <span className={cx('text-[10px] font-light', textFaint)}>
                      {nodes.length} 项
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {nodes.map((node) => (
                      <div key={node.id} className={cx('flex items-center justify-between rounded-control px-2 py-1.5', rowBg)}>
                        <div className="min-w-0 flex-1">
                          <div className={cx('truncate text-xs font-light', textPrimary)}>
                            {node.label || node.id}
                          </div>
                          {node.data?.number && (
                            <div className={cx('truncate text-[10px] font-light', textFaint)}>
                              {node.data.number}
                            </div>
                          )}
                        </div>
                        {node.data?.status && (
                          <span className={cx('ml-2 shrink-0 text-[10px] font-light', textSecondary)}>
                            {node.data.status}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </RdlSurface>
              ))}
            </div>
          </div>

          {/* 边关系列表 */}
          {result.edges.length > 0 && (
            <div>
              <div className={cx('mb-1.5 flex items-center gap-1.5 text-[10px] font-light tracking-[0.14em]', textFaint)}>
                <ArrowRight size={14} />
                关联 EDGES ({result.edges.length})
              </div>
              <RdlSurface tone="card" padding="compact">
                <div className="space-y-0.5">
                  {result.edges.map((edge) => {
                    const fromNode = nodeMap.get(edge.from);
                    const toNode = nodeMap.get(edge.to);
                    return (
                      // R678-9 复合 key（from+relation+to）：索引 key 在结果集变化时错位复用行状态
                      <div key={`${edge.from}|${edge.relation}|${edge.to}`} className={cx('flex items-center gap-2 rounded-control px-2 py-1.5 text-xs', rowBg)}>
                        <span className={cx('min-w-0 flex-1 truncate font-light', textPrimary)}>
                          {fromNode?.label || edge.from}
                        </span>
                        <span className={cx('shrink-0 rounded-control px-1.5 py-0.5 text-[9px] font-light', 'bg-[var(--recessed-bg-strong)]', 'text-[var(--text-secondary)]')}>
                          {edgeLabel(edge.relation)}
                        </span>
                        <ArrowRight size={14} className={cx('shrink-0', textFaint)} />
                        <span className={cx('min-w-0 flex-1 truncate text-right font-light', textPrimary)}>
                          {toNode?.label || edge.to}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </RdlSurface>
            </div>
          )}

          {/* 空结果 */}
          {result.nodes.length === 0 && (
            <div className={cx('py-12 text-center text-xs font-light', textFaint)}>
              未找到溯源链路数据
            </div>
          )}
        </>
      )}

      {/* ── 初始空状态 ── */}
      {!result && !loading && !error && !presetScenario && (
        <div className={cx('flex flex-col items-center justify-center gap-2 py-20 text-xs font-light', textFaint)}>
          <GitBranch size={24} className="opacity-40" />
          <div>{isRelationRootScenario ? '选择场景并搜索选择档案开始溯源' : '选择场景并输入 ID 开始溯源查询'}</div>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return <div className="flex h-full flex-col">{content}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="一键溯源"
        subtitle="Traceability"
        contextLabel="Trace Panel"
        isDarkMode={isDarkMode}
      />
      {content}
    </div>
  );
}
