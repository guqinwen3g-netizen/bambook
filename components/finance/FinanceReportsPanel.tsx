/**
 * FinanceReportsPanel — 财务报表面板（Phase B2 + 阶段 F / F2 + DR-005/DR-033）
 *
 * 七个子视图：
 *   1. 账龄分析 Aging — 应收/应付五桶（未到期/1-30/31-60/61-90/90+），按客户×币种分组
 *   2. 客户对账单 Statement — 期初余额 + 开票/收款流水 + running balance，多币种分节
 *   3. 供应商对账单 Supplier Statement — 应付侧镜像：收票（借）/付款（贷）流水 + running balance
 *   4. 汇率损益 FX Gain/Loss — 核销维度（收款汇率 vs 开票汇率），收益/损失汇总
 *   5. 外汇台账 FX Ledger — 收汇/已结汇/未结汇按币种聚合 + 未结汇凭证清单（F2 外汇核销闭环）
 *   6. 合并利润 Consolidated Profit — DR-005 公司合并视图：抵销内部采购/内部销售，
 *      仅计客户外部收入 + 真实面料成本；合并视图 / 部门视角（DR-043 双口径）切换；
 *      from/to 日期范围可选（省略=全量），响应 range 回显当前口径
 *   7. 内部供料 Internal Supply — DR-033 内部供料单：列表（关联服装/面料订单、金额、状态、交付进度）
 *      + 写操作（新建申请 / 面料部确认生效 / 交付登记 / 取消，按状态机显隐，错误码透传内联展示）
 *
 * 数据源：GET /v1/finance/reports/* + GET /v1/finance/fx-settlements/ledger
 *   + GET /v1/finance/reports/consolidated-profit?from&to + GET|POST /v1/internal-trade（多币种不折算汇总）
 * 设计：flat 无阴影、RDL 原语、tabular-nums 数字对齐
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, FileText, ArrowLeftRight, Loader2, AlertCircle, Plus, X, Mail } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { fxSettlementService } from '../../services/fxSettlementService';
import { shipmentService } from '../../services/shipmentService';
import DunningSheet from './DunningSheet';
import {
  INTERNAL_TRANSFER_STATUSES,
  INTERNAL_TRANSFER_STATUS_LABEL,
  internalTradeService,
  toAmount,
} from '../../services/internalTradeService';
import type {
  ConsolidatedProfitReport,
  InternalTransferListItem,
  InternalTransferStatus,
} from '../../services/internalTradeService';
import { RdlMetricCard, RdlPill, RdlSurface, RdlToolbar } from '../ui/RDLPrimitives';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import type { AgingBuckets, AgingReport, CustomerStatement, FxGainLossReport, FxLedger, Order, Relation, Shipment, StatementSection, SupplierStatement } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ReportTabId = 'aging' | 'statement' | 'supplier-statement' | 'fx' | 'fx-ledger' | 'consolidated' | 'internal-trade';

/** YYYY-MM-DD（与 server internalTrade DATE_RE 一致） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── G9 深链通道：报表中心等外部入口请求定位到指定子视图 ──
// 与 exceptionService openExceptionEntry 同一 CustomEvent 惯例；模块级待消费意图保证
// 「先跳转后挂载」时初始 tab 仍能命中（面板挂载即在 useState 初始值中消费）。
const FINANCE_REPORT_TAB_EVENT = 'bambook:finance-reports-tab';
let pendingReportTab: ReportTabId | null = null;

export function requestFinanceReportTab(tab: ReportTabId): void {
  pendingReportTab = tab;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ReportTabId>(FINANCE_REPORT_TAB_EVENT, { detail: tab }));
  }
}

const REPORT_TABS: Array<{ id: ReportTabId; label: string; en: string }> = [
  { id: 'aging', label: '账龄分析', en: 'Aging' },
  { id: 'statement', label: '客户对账单', en: 'Statement' },
  { id: 'supplier-statement', label: '供应商对账单', en: 'Supplier' },
  { id: 'fx', label: '汇率损益', en: 'FX Gain/Loss' },
  { id: 'fx-ledger', label: '外汇台账', en: 'FX Ledger' },
  { id: 'consolidated', label: '合并利润', en: 'Consolidated' },
  { id: 'internal-trade', label: '内部供料', en: 'Internal Supply' },
];

function formatAmount(amount: number, currency?: string): string {
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

interface FinanceReportsPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
}

export function FinanceReportsPanel({ isDarkMode, endpoint }: FinanceReportsPanelProps) {
  // 初始 tab 消费外部深链意图（如报表中心「合并利润」入口）；无意图时默认账龄
  const [tab, setTab] = useState<ReportTabId>(() => {
    const initial = pendingReportTab;
    pendingReportTab = null;
    return initial ?? 'aging';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已挂载时响应外部深链事件（未挂载则由上方初始值消费 pendingReportTab）
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent<ReportTabId>).detail;
      if (target) setTab(target);
    };
    window.addEventListener(FINANCE_REPORT_TAB_EVENT, handler);
    return () => window.removeEventListener(FINANCE_REPORT_TAB_EVENT, handler);
  }, []);

  // ── 账龄 ──
  const [agingType, setAgingType] = useState<'Receivable' | 'Payable'>('Receivable');
  const [aging, setAging] = useState<AgingReport | null>(null);
  // ── 催款（REQ2-08，DR-050-③：一键发起挂账龄行，选中即上下文）──
  const [dunningRow, setDunningRow] = useState<{ customerRelationId: string | null; customerName: string; currency: string } | null>(null);

  // ── 对账单 ──
  const [relations, setRelations] = useState<Relation[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [stmtFrom, setStmtFrom] = useState(firstDayOfMonth());
  const [stmtTo, setStmtTo] = useState(today());
  const [statement, setStatement] = useState<CustomerStatement | null>(null);

  // ── 供应商对账单（应付侧镜像）──
  const [supplierRelations, setSupplierRelations] = useState<Relation[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [supFrom, setSupFrom] = useState(firstDayOfMonth());
  const [supTo, setSupTo] = useState(today());
  const [supplierStatement, setSupplierStatement] = useState<SupplierStatement | null>(null);

  // ── 汇率损益 ──
  const [fxFrom, setFxFrom] = useState(firstDayOfMonth());
  const [fxTo, setFxTo] = useState(today());
  const [fx, setFx] = useState<FxGainLossReport | null>(null);

  // ── 外汇台账（F2）──
  const [ledgerFrom, setLedgerFrom] = useState(firstDayOfMonth());
  const [ledgerTo, setLedgerTo] = useState(today());
  const [ledger, setLedger] = useState<FxLedger | null>(null);

  // ── 合并利润（DR-005）──
  const [consolidated, setConsolidated] = useState<ConsolidatedProfitReport | null>(null);
  const [consolidatedMode, setConsolidatedMode] = useState<'company' | 'department'>('company');
  // 口径范围（'' = 未设界；双空 = 全量）
  const [conFrom, setConFrom] = useState('');
  const [conTo, setConTo] = useState('');

  // ── 内部供料单（DR-033）──
  const [transfers, setTransfers] = useState<InternalTransferListItem[] | null>(null);
  const [transferStatus, setTransferStatus] = useState<InternalTransferStatus | ''>('');
  const [expandedTransferId, setExpandedTransferId] = useState<string | null>(null);

  // ── 内部供料单写操作（G7：新建 / 确认生效 / 交付登记 / 取消）──
  const [transferDialog, setTransferDialog] = useState<
    | { mode: 'create' }
    | { mode: 'confirm'; item: InternalTransferListItem }
    | { mode: 'delivery'; item: InternalTransferListItem }
    | { mode: 'cancel'; item: InternalTransferListItem }
    | null
  >(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferDialogError, setTransferDialogError] = useState<string | null>(null);
  const [orderOptions, setOrderOptions] = useState<Order[] | null>(null);
  const [orderOptionsError, setOrderOptionsError] = useState<string | null>(null);
  const [shipmentOptions, setShipmentOptions] = useState<Shipment[] | null>(null);
  const [createForm, setCreateForm] = useState({
    garmentOrderId: '', fabricOrderId: '',
    requestDepartmentId: 'dept_garment', supplyDepartmentId: 'dept_fabric',
    materialCode: '', quantity: '', unit: 'm', settlementPrice: '', dueDate: '', memo: '',
  });
  const [confirmForm, setConfirmForm] = useState({ confirmedQuantity: '', confirmedDueDate: '' });
  const [deliveryForm, setDeliveryForm] = useState({ shipmentId: '', quantity: '', deliveryDate: '', receivedQuantity: '', receivedDate: '' });
  const [cancelReason, setCancelReason] = useState('');

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-default)]';

  // ── 数据加载 ──
  const loadAging = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAging(await apiService.getAgingReport(agingType, undefined, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [agingType, endpoint]);

  const loadStatement = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      setStatement(await apiService.getCustomerStatement({ customerRelationId: customerId, from: stmtFrom || undefined, to: stmtTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [customerId, stmtFrom, stmtTo, endpoint]);

  const loadSupplierStatement = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      setSupplierStatement(await apiService.getSupplierStatement({ supplierRelationId: supplierId, from: supFrom || undefined, to: supTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [supplierId, supFrom, supTo, endpoint]);

  const loadFx = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFx(await apiService.getFxGainLoss({ from: fxFrom || undefined, to: fxTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [fxFrom, fxTo, endpoint]);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLedger(await fxSettlementService.getFxLedger({ from: ledgerFrom || undefined, to: ledgerTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [ledgerFrom, ledgerTo, endpoint]);

  const loadConsolidated = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConsolidated(await internalTradeService.getConsolidatedProfitReport(
        { from: conFrom || undefined, to: conTo || undefined },
        endpoint,
      ));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [conFrom, conTo, endpoint]);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await internalTradeService.listInternalTransfers(
        { status: transferStatus || undefined, limit: 200 },
        endpoint,
      );
      setTransfers(result.items);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [transferStatus, endpoint]);

  // 初次进入各 tab 时加载
  useEffect(() => {
    if (tab === 'aging' && !aging) loadAging();
    if (tab === 'fx' && !fx) loadFx();
    if (tab === 'fx-ledger' && !ledger) loadLedger();
    if (tab === 'statement' && relations.length === 0) {
      apiService.listRelations(endpoint).then(list => {
        // 方向分组以 category 为准（type 是自由文本子类，如 Fabric Mill）；保留 type 回退兼容旧档案
        const customers = list.filter(r => !r.deletedAt && (r.category === 'Customer' || r.type === 'Customer'));
        setRelations(customers);
        if (customers.length > 0 && !customerId) setCustomerId(customers[0].id);
      }).catch(() => {});
    }
    if (tab === 'supplier-statement' && supplierRelations.length === 0) {
      apiService.listRelations(endpoint).then(list => {
        const suppliers = list.filter(r => !r.deletedAt && (r.category === 'Supplier' || r.type === 'Supplier'));
        setSupplierRelations(suppliers);
        if (suppliers.length > 0 && !supplierId) setSupplierId(suppliers[0].id);
      }).catch(() => {});
    }
  }, [tab, aging, fx, ledger, relations.length, supplierRelations.length, customerId, supplierId, endpoint, loadAging, loadFx, loadLedger]);

  // 合并利润：进入 tab 即加载；日期范围变更后（合法 YYYY-MM-DD 或清空）自动重新拉取
  useEffect(() => {
    if (tab !== 'consolidated') return;
    const settled = (v: string) => v === '' || DATE_RE.test(v);
    if (!settled(conFrom) || !settled(conTo)) return;
    loadConsolidated();
  }, [tab, conFrom, conTo, loadConsolidated]);

  // 内部供料单：进入 tab 或状态筛选变化时加载
  useEffect(() => {
    if (tab === 'internal-trade') loadTransfers();
  }, [tab, loadTransfers]);

  // 客户选定后自动加载对账单
  useEffect(() => {
    if (tab === 'statement' && customerId) loadStatement();
  }, [tab, customerId, loadStatement]);

  // 供应商选定后自动加载对账单
  useEffect(() => {
    if (tab === 'supplier-statement' && supplierId) loadSupplierStatement();
  }, [tab, supplierId, loadSupplierStatement]);

  const inputCls = cx(
    'h-8 rounded-field border bg-transparent px-2.5 text-[11px] font-light outline-none tabular-nums',
    divider, textPrimary,
  );

  // ── 内部供料单写操作（状态机显隐以 server ALLOWED_TRANSITIONS 为准： ──
  //    确认=PendingConfirm；交付=Effective/Delivering；取消=Draft/PendingConfirm）──
  const closeTransferDialog = () => {
    if (transferSubmitting) return;
    setTransferDialog(null);
    setTransferDialogError(null);
  };

  const openCreateTransfer = () => {
    setCreateForm({
      garmentOrderId: '', fabricOrderId: '',
      requestDepartmentId: 'dept_garment', supplyDepartmentId: 'dept_fabric',
      materialCode: '', quantity: '', unit: 'm', settlementPrice: '', dueDate: '', memo: '',
    });
    setTransferDialogError(null);
    setOrderOptionsError(null);
    setTransferDialog({ mode: 'create' });
    if (!orderOptions) {
      apiService.listOrders(endpoint)
        .then(list => setOrderOptions(list.filter(o => !o.deletedAt)))
        .catch(e => setOrderOptionsError(String(e?.message || e)));
    }
  };

  const openConfirmTransfer = (item: InternalTransferListItem) => {
    setConfirmForm({ confirmedQuantity: '', confirmedDueDate: '' });
    setTransferDialogError(null);
    setTransferDialog({ mode: 'confirm', item });
  };

  const openDeliveryTransfer = (item: InternalTransferListItem) => {
    setDeliveryForm({ shipmentId: '', quantity: '', deliveryDate: today(), receivedQuantity: '', receivedDate: '' });
    setTransferDialogError(null);
    setShipmentOptions(null);
    setTransferDialog({ mode: 'delivery', item });
    const fabricOrderId = item.payload?.fabricOrderId;
    if (fabricOrderId) {
      shipmentService.listShipments(endpoint, { orderId: fabricOrderId })
        .then(list => setShipmentOptions(list.filter(s => s.status !== 'Cancelled')))
        .catch(() => setShipmentOptions([]));
    } else {
      // 无关联面料订单（异常数据）：直接降级为手工输入运单 ID
      setShipmentOptions([]);
    }
  };

  const openCancelTransfer = (item: InternalTransferListItem) => {
    setCancelReason('');
    setTransferDialogError(null);
    setTransferDialog({ mode: 'cancel', item });
  };

  const submitTransferDialog = async () => {
    if (!transferDialog) return;
    setTransferDialogError(null);
    try {
      if (transferDialog.mode === 'create') {
        const f = createForm;
        const missing: string[] = [];
        if (!f.garmentOrderId) missing.push('服装订单');
        if (!f.fabricOrderId) missing.push('面料订单');
        if (!f.requestDepartmentId.trim()) missing.push('申请部门');
        if (!f.supplyDepartmentId.trim()) missing.push('供料部门');
        if (!f.materialCode.trim()) missing.push('物料');
        if (!f.dueDate) missing.push('交期');
        if (missing.length > 0) { setTransferDialogError(`请填写：${missing.join('、')}`); return; }
        const quantity = Number(f.quantity);
        const settlementPrice = Number(f.settlementPrice);
        if (!Number.isFinite(quantity) || quantity <= 0) { setTransferDialogError('数量必须为正数'); return; }
        if (!Number.isFinite(settlementPrice) || settlementPrice <= 0) { setTransferDialogError('内部结算价必须为正数'); return; }
        if (!DATE_RE.test(f.dueDate)) { setTransferDialogError('交期必须为 YYYY-MM-DD'); return; }
        if (f.garmentOrderId === f.fabricOrderId) { setTransferDialogError('服装订单与面料订单不得为同一订单'); return; }
        setTransferSubmitting(true);
        const result = await internalTradeService.createInternalTransfer({
          requestDepartmentId: f.requestDepartmentId.trim(),
          supplyDepartmentId: f.supplyDepartmentId.trim(),
          garmentOrderId: f.garmentOrderId,
          fabricOrderId: f.fabricOrderId,
          materialCode: f.materialCode.trim(),
          quantity,
          unit: f.unit.trim() || undefined,
          settlementPrice,
          dueDate: f.dueDate,
          memo: f.memo.trim() || undefined,
        }, endpoint);
        setTransferDialog(null);
        setExpandedTransferId(result.transfer.id);
        await loadTransfers();
        return;
      }

      const { item } = transferDialog;
      if (transferDialog.mode === 'confirm') {
        const qtyRaw = confirmForm.confirmedQuantity.trim();
        const dateRaw = confirmForm.confirmedDueDate.trim();
        let confirmedQuantity: number | undefined;
        if (qtyRaw) {
          confirmedQuantity = Number(qtyRaw);
          if (!Number.isFinite(confirmedQuantity) || confirmedQuantity <= 0) { setTransferDialogError('确认数量必须为正数'); return; }
        }
        if (dateRaw && !DATE_RE.test(dateRaw)) { setTransferDialogError('确认交期必须为 YYYY-MM-DD'); return; }
        setTransferSubmitting(true);
        await internalTradeService.confirmInternalTransfer(item.record.id, {
          confirmedQuantity,
          confirmedDueDate: dateRaw || undefined,
        }, endpoint);
      } else if (transferDialog.mode === 'delivery') {
        const quantity = Number(deliveryForm.quantity);
        if (!deliveryForm.shipmentId.trim()) { setTransferDialogError('请选择或输入运单'); return; }
        if (!Number.isFinite(quantity) || quantity <= 0) { setTransferDialogError('交付数量必须为正数'); return; }
        if (!DATE_RE.test(deliveryForm.deliveryDate)) { setTransferDialogError('交付日期必须为 YYYY-MM-DD'); return; }
        let receivedQuantity: number | undefined;
        const recvRaw = deliveryForm.receivedQuantity.trim();
        if (recvRaw) {
          receivedQuantity = Number(recvRaw);
          if (!Number.isFinite(receivedQuantity) || receivedQuantity < 0) { setTransferDialogError('到货数量必须为非负数字'); return; }
        }
        const recvDate = deliveryForm.receivedDate.trim();
        if (recvDate && !DATE_RE.test(recvDate)) { setTransferDialogError('到货日期必须为 YYYY-MM-DD'); return; }
        setTransferSubmitting(true);
        await internalTradeService.registerDelivery(item.record.id, {
          shipmentId: deliveryForm.shipmentId.trim(),
          quantity,
          deliveryDate: deliveryForm.deliveryDate,
          receivedQuantity,
          receivedDate: recvDate || undefined,
        }, endpoint);
      } else {
        setTransferSubmitting(true);
        await internalTradeService.cancelInternalTransfer(item.record.id, cancelReason.trim() || undefined, endpoint);
      }
      setTransferDialog(null);
      await loadTransfers();
    } catch (e: any) {
      setTransferDialogError(String(e?.message || e));
    } finally {
      setTransferSubmitting(false);
    }
  };

  // ── 账龄视图 ──
  const renderAging = () => {
    if (!aging) return null;
    const bucketCols: Array<{ key: keyof AgingBuckets; label: string }> = [
      { key: 'current', label: '未到期' },
      { key: 'd1_30', label: '1-30 天' },
      { key: 'd31_60', label: '31-60 天' },
      { key: 'd61_90', label: '61-90 天' },
      { key: 'd90plus', label: '90 天以上' },
    ];
    const gridCls = 'grid w-full min-w-0 grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(0,0.75fr))_auto]';
    // 逾期未结清 = 总额 − 未到期（催款针对逾期部分；应付侧无催款）
    const canDun = (row: typeof aging.rows[number]) =>
      agingType === 'Receivable' && (row.buckets.total - row.buckets.current) > 0.005;
    return (
      <>
        {/* 汇总卡片 */}
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          {aging.totals.map(t => (
            <RdlMetricCard key={t.currency} className="px-4 py-3">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>
                {agingType === 'Receivable' ? '应收未收' : '应付未付'} · {t.currency}
              </div>
              <div className={cx('mt-1.5 text-lg font-light tabular-nums', textPrimary)}>{formatAmount(t.total, t.currency)}</div>
              <div className={cx('mt-1 text-[10px] font-light tabular-nums', t.d90plus > 0 ? 'text-[var(--danger-text)]' : textFaint)}>
                90 天以上 {formatAmount(t.d90plus, t.currency)}
              </div>
            </RdlMetricCard>
          ))}
          {aging.totals.length === 0 && (
            <div className={cx('col-span-full py-6 text-center text-xs font-light', textFaint)}>暂无未核销{agingType === 'Receivable' ? '应收' : '应付'}账款</div>
          )}
        </div>

        {/* 明细表 */}
        <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
          <div className={cx(gridCls, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
            <div>客户 / 币种</div>
            {bucketCols.map(c => <div key={c.key} className="text-right">{c.label}</div>)}
            <div className="text-right">合计</div>
            <div className="text-right">操作</div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
            {aging.rows.map(row => (
              <div key={`${row.customerRelationId ?? row.customerName}-${row.currency}`} className={cx(gridCls, 'items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
                <div className="min-w-0">
                  <div className={cx('truncate font-light', textPrimary)}>{row.customerName}</div>
                  <div className={cx('text-[10px] font-light', textFaint)}>{row.currency} · {row.invoiceCount} 张发票</div>
                </div>
                {bucketCols.map(c => (
                  <div key={c.key} className={cx('text-right font-light tabular-nums', row.buckets[c.key] > 0 && c.key === 'd90plus' ? 'text-[var(--danger-text)]' : textPrimary)}>
                    {row.buckets[c.key] > 0 ? formatAmount(row.buckets[c.key], row.currency) : '—'}
                  </div>
                ))}
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(row.buckets.total, row.currency)}</div>
                <div className="flex justify-end pl-3">
                  {canDun(row) && (
                    <button
                      type="button"
                      onClick={() => setDunningRow({ customerRelationId: row.customerRelationId, customerName: row.customerName, currency: row.currency })}
                      className={cx('flex items-center gap-1 rounded-control px-2.5 py-1.5 text-[11px] font-light transition-colors hover:bg-[var(--recessed-bg-hover)]', textSecondary)}
                      aria-label={`对 ${row.customerName} 发起催款`}
                    >
                      <Mail size={14} strokeWidth={1.5} /> 催款
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </RdlSurface>
      </>
    );
  };

  // ── 对账单视图（客户/供应商共用，仅借贷列文案与流水类型标签不同）──
  const renderStatementSections = (opts: {
    partyName: string | null;
    partyFallback: string;
    sections: StatementSection[];
    debitLabel: string;
    creditLabel: string;
    creditKindLabel: string;
    emptyText: string;
  }) => (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {opts.sections.map(sec => (
        <RdlSurface key={sec.currency} tone="panel" padding="compact" className="flex flex-col">
          <div className={cx('flex items-baseline justify-between border-b px-4 pb-2 pt-2', divider)}>
            <div className={cx('text-xs font-light', textPrimary)}>{opts.partyName ?? opts.partyFallback} · {sec.currency}</div>
            <div className={cx('text-[10px] font-light tabular-nums', textSecondary)}>
              期初 {formatAmount(sec.openingBalance, sec.currency)} → 期末 <span className={textPrimary}>{formatAmount(sec.closingBalance, sec.currency)}</span>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] px-4 pb-1 pt-1.5 text-[10px] font-light tracking-[0.14em]">
            <div className={textSecondary}>日期</div>
            <div className={textSecondary}>单号</div>
            <div className={cx('text-right', textSecondary)}>{opts.debitLabel}</div>
            <div className={cx('text-right', textSecondary)}>{opts.creditLabel}</div>
            <div className={cx('text-right', textSecondary)}>余额</div>
          </div>
          <div className="space-y-0.5 px-1 pb-2 text-xs">
            {sec.transactions.length === 0 && (
              <div className={cx('py-4 text-center font-light', textFaint)}>该期间无流水</div>
            )}
            {sec.transactions.map((t, i) => (
              <div key={`${t.number}-${i}`} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] items-center rounded-control px-3 py-1.5">
                <div className={cx('font-light tabular-nums', textSecondary)}>{t.date}</div>
                <div className={cx('truncate font-light', textPrimary)}>
                  {t.number}
                  <span className={cx('ml-2 text-[10px]', textFaint)}>{t.kind === 'invoice' ? '发票' : opts.creditKindLabel}</span>
                </div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{t.debit > 0 ? formatAmount(t.debit, sec.currency) : '—'}</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{t.credit > 0 ? formatAmount(t.credit, sec.currency) : '—'}</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(t.balance, sec.currency)}</div>
              </div>
            ))}
          </div>
        </RdlSurface>
      ))}
      {opts.sections.length === 0 && (
        <div className={cx('py-6 text-center text-xs font-light', textFaint)}>{opts.emptyText}</div>
      )}
    </div>
  );

  const renderStatement = () => {
    if (!statement) return null;
    return renderStatementSections({
      partyName: statement.customerName,
      partyFallback: '客户',
      sections: statement.sections,
      debitLabel: '开票',
      creditLabel: '收款',
      creditKindLabel: '收款',
      emptyText: '该客户暂无发票/收款记录',
    });
  };

  const renderSupplierStatement = () => {
    if (!supplierStatement) return null;
    return renderStatementSections({
      partyName: supplierStatement.supplierName,
      partyFallback: '供应商',
      sections: supplierStatement.sections,
      debitLabel: '收票',
      creditLabel: '付款',
      creditKindLabel: '付款',
      emptyText: '该供应商暂无应付发票/付款记录',
    });
  };

  // ── 汇率损益视图 ──
  const renderFx = () => {
    if (!fx) return null;
    const isGain = fx.totalGainLoss >= 0;
    return (
      <>
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>汇兑净{isGain ? '收益' : '损失'} · {fx.baseCurrency}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', isGain ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]')}>
              {isGain ? '+' : ''}{formatAmount(fx.totalGainLoss, fx.baseCurrency)}
            </div>
            <div className={cx('mt-1 text-[10px] font-light', textFaint)}>{fx.rows.length} 笔核销</div>
          </RdlMetricCard>
        </div>
        <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
          <div className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)] px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
            <div>核销日期</div>
            <div>发票</div>
            <div>凭证</div>
            <div className="text-right">核销额</div>
            <div className="text-right">开票汇率</div>
            <div className="text-right">收付汇率</div>
            <div className="text-right">损益 ({fx.baseCurrency})</div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
            {fx.rows.map(row => (
              <div key={row.allocationId} className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)] items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
                <div className={cx('font-light tabular-nums', textSecondary)}>{row.appliedDate}</div>
                <div className={cx('truncate font-light', textPrimary)}>
                  {row.invoiceNumber}
                  <span className={cx('ml-1.5 text-[10px]', textFaint)}>{row.invoiceType === 'Payable' ? '应付' : '应收'}</span>
                </div>
                <div className={cx('truncate font-light', textPrimary)}>{row.voucherNumber}</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(row.appliedAmount, row.currency)}</div>
                <div className={cx('text-right font-light tabular-nums', textSecondary)}>{row.invoiceRate}</div>
                <div className={cx('text-right font-light tabular-nums', textSecondary)}>{row.voucherRate}</div>
                <div className={cx('text-right font-light tabular-nums', row.gainLoss >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]')}>
                  {row.gainLoss >= 0 ? '+' : ''}{formatAmount(row.gainLoss, fx.baseCurrency)}
                </div>
              </div>
            ))}
            {fx.rows.length === 0 && (
              <div className={cx('py-6 text-center font-light', textFaint)}>该期间无含双边汇率的核销记录</div>
            )}
          </div>
        </RdlSurface>
      </>
    );
  };

  // ── 外汇台账视图（F2）──
  const renderFxLedger = () => {
    if (!ledger) return null;
    const gridCls = 'grid w-full min-w-0 grid-cols-[minmax(0,0.55fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.45fr)_minmax(0,0.7fr)_minmax(0,0.8fr)]';
    const formatRate = (rate: string | null) => (rate == null ? '—' : Number(rate).toFixed(4));
    const formatDiff = (diff: string | null) => {
      if (diff == null) return { text: '—', cls: textFaint };
      const n = Number(diff);
      return { text: `${n >= 0 ? '+' : ''}${formatAmount(n, 'CNY')}`, cls: n >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]' };
    };
    return (
      <>
        {/* 未结汇余额汇总卡片（待办导向：还有多少外币躺在账上） */}
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          {ledger.rows.map(row => (
            <RdlMetricCard key={row.currency} className="px-4 py-3">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>未结汇余额 · {row.currency}</div>
              <div className={cx('mt-1.5 text-lg font-light tabular-nums', Number(row.unsettledBalance) > 0 ? 'text-[var(--warning-text)]' : textPrimary)}>
                {formatAmount(Number(row.unsettledBalance), row.currency)}
              </div>
              <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>
                期间收汇 {formatAmount(Number(row.receivedTotal), row.currency)} · 已结汇 {formatAmount(Number(row.settledTotal), row.currency)}
              </div>
            </RdlMetricCard>
          ))}
          {ledger.rows.length === 0 && (
            <div className={cx('col-span-full py-6 text-center text-xs font-light', textFaint)}>该期间无外币收汇/结汇记录</div>
          )}
        </div>

        {/* 币种聚合表 */}
        {ledger.rows.length > 0 && (
          <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
            <div className={cx(gridCls, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
              <div>币种</div>
              <div className="text-right">期间收汇</div>
              <div className="text-right">期间结汇</div>
              <div className="text-right">未结汇余额</div>
              <div className="text-right">笔数</div>
              <div className="text-right">加权汇率</div>
              <div className="text-right">汇兑差额估算 (CNY)</div>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
              {ledger.rows.map(row => {
                const diff = formatDiff(row.fxDiffEstimate);
                return (
                  <div key={row.currency} className={cx(gridCls, 'items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
                    <div className={cx('font-light', textPrimary)}>{row.currency}</div>
                    <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(Number(row.receivedTotal), row.currency)}</div>
                    <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(Number(row.settledTotal), row.currency)}</div>
                    <div className={cx('text-right font-light tabular-nums', Number(row.unsettledBalance) > 0 ? 'text-[var(--warning-text)]' : textPrimary)}>
                      {formatAmount(Number(row.unsettledBalance), row.currency)}
                    </div>
                    <div className={cx('text-right font-light tabular-nums', textSecondary)}>{row.settlementCount}</div>
                    <div className={cx('text-right font-light tabular-nums', textSecondary)}>{formatRate(row.weightedAvgSettleRate)}</div>
                    <div className={cx('text-right font-light tabular-nums', diff.cls)}>{diff.text}</div>
                  </div>
                );
              })}
            </div>
          </RdlSurface>
        )}

        {/* 未结汇凭证清单（行动导向） */}
        {ledger.unsettledVouchers.length > 0 && (
          <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
            <div className={cx('flex items-baseline justify-between px-4 pb-2 pt-1')}>
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>未结汇凭证（{ledger.unsettledVouchers.length} 笔待处理）</div>
              <div className={cx('text-[10px] font-light', textFaint)}>可在「收付款」tab 选中凭证后点「结汇」登记</div>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
              {ledger.unsettledVouchers.map(v => (
                <div key={v.voucherId} className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
                  <div className={cx('font-light tabular-nums', textSecondary)}>{v.paymentDate}</div>
                  <div className={cx('truncate font-light', textPrimary)}>{v.voucherNumber}</div>
                  <div className={cx('truncate font-light', textSecondary)}>{v.customerName || '—'}</div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(Number(v.voucherAmount), v.currency)}</div>
                  <div className={cx('text-right font-light tabular-nums', 'text-[var(--warning-text)]')}>{formatAmount(Number(v.remainingAmount), v.currency)}</div>
                </div>
              ))}
            </div>
          </RdlSurface>
        )}
      </>
    );
  };

  // ── 合并利润视图（DR-005：合并视图 / 部门视角双模式，数据同源服务端聚合投影）──
  const renderConsolidated = () => {
    if (!consolidated) return null;
    const r = consolidated;
    const cur = r.baseCurrency;
    // 口径回显：以服务端 range 回声为准（from/to 请求参数的实际生效口径；双 null = 全量）
    const rangeFrom = r.range?.from ?? null;
    const rangeTo = r.range?.to ?? null;
    const renderRangeLine = () => (
      <div className={cx('shrink-0 text-[10px] font-light tabular-nums', textFaint)}>
        口径范围：{rangeFrom ?? '—'} ~ {rangeTo ?? '—'}
        {!rangeFrom && !rangeTo ? '（全量，未设日期边界）' : ''}
        <span className="ml-2">口径过滤仅作用于本次聚合，不改写任何单据</span>
      </div>
    );
    if (r.orders.externalCount === 0 && r.orders.internalCount === 0) {
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
          {renderRangeLine()}
          <div className={cx('py-10 text-center text-xs font-light', textFaint)}>
            暂无订单利润表数据 — 合并报表在利润表生成后自动聚合（仅读，不改写任何单据）
          </div>
        </div>
      );
    }
    const profitCls = (n: number) => (n >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]');

    // 抵销过程可视化（内部采购合计 / 内部销售合计 / 抵销净额 + 双边口径差异透明披露）
    const renderElimination = () => (
      <RdlSurface tone="panel" padding="compact" className="flex flex-col">
        <div className={cx('border-b px-4 pb-2 pt-2 text-[10px] font-light tracking-[0.14em]', divider, textSecondary)}>
          抵销过程 · Elimination（DR-005 单边口径）
        </div>
        <div className="space-y-1 px-2 py-2 text-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
            <div className={cx('font-light', textPrimary)}>
              内部采购合计
              <span className={cx('ml-2 text-[10px]', textFaint)}>服装部 · 生效内部供料（incoming）</span>
            </div>
            <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.elimination.internalPurchase, cur)}</div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
            <div className={cx('font-light', textPrimary)}>
              内部销售合计
              <span className={cx('ml-2 text-[10px]', textFaint)}>面料部 · 生效内部供料（outgoing）</span>
            </div>
            <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.elimination.internalSales, cur)}</div>
          </div>
          <div className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5', 'bg-[var(--recessed-bg)]')}>
            <div className={cx('font-light', textPrimary)}>
              抵销净额
              <span className={cx('ml-2 text-[10px]', textFaint)}>不计入公司收入与成本</span>
            </div>
            <div className={cx('text-right font-light tabular-nums', 'text-[var(--warning-text)]')}>-{formatAmount(r.elimination.amount, cur)}</div>
          </div>
          {r.elimination.discrepancy !== 0 && (
            <div className={cx('rounded-control px-2 py-1.5 text-[10px] font-light', 'text-[var(--warning-text)]')}>
              双边口径不一致披露：内部销售 − 内部采购 = {formatAmount(r.elimination.discrepancy, cur)}（应≈0，请核对内部供料单双边登记）
            </div>
          )}
          <div className={cx('px-2 pt-1 text-[10px] font-light', textFaint)}>
            内部采购价 = 面料部内部销售收入，合并时全额抵销；仅生效（已生效/交付中/已关闭）内部供料单计入
          </div>
        </div>
        {r.unconverted.length > 0 && (
          <div className={cx('border-t px-4 pb-2 pt-2', divider)}>
            <div className={cx('pb-1 text-[10px] font-light tracking-[0.14em]', 'text-[var(--warning-text)]')}>
              未折算内部交易披露（{r.unconverted.length} 笔，排除在抵销外）
            </div>
            <div className="space-y-0.5 text-[11px]">
              {r.unconverted.map(u => (
                <div key={u.transferId} className="flex items-baseline justify-between gap-2">
                  <span className={cx('min-w-0 truncate font-light', textSecondary)}>{u.transferId} · {u.direction === 'incoming' ? '内部采购' : '内部销售'}</span>
                  <span className={cx('shrink-0 font-light tabular-nums', textPrimary)}>{formatAmount(u.amount, u.currency)}</span>
                </div>
              ))}
              <div className={cx('pt-0.5 text-[10px] font-light', textFaint)}>非本位币内部交易，报表不做汇率假设，透明披露</div>
            </div>
          </div>
        )}
      </RdlSurface>
    );

    if (consolidatedMode === 'department') {
      const deptSum = r.departments.garment.profit + r.departments.fabric.profit;
      const identityGap = deptSum - r.consolidatedProfit;
      const departments: Array<{ key: 'garment' | 'fabric'; label: string; en: string; caliber: string }> = [
        { key: 'garment', label: '服装部', en: 'Garment', caliber: '收入含外部客户收入；成本含内部面料采购价（部门利润已扣内部采购）' },
        { key: 'fabric', label: '面料部', en: 'Fabric', caliber: '收入含内部面料销售；成本为真实面料成本（保留内部面料利润）' },
      ];
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
          {renderRangeLine()}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {departments.map(d => {
              const dept = r.departments[d.key];
              return (
                <RdlSurface key={d.key} tone="panel" padding="compact" className="flex flex-col">
                  <div className={cx('border-b px-4 pb-2 pt-2', divider)}>
                    <div className={cx('text-xs font-light', textPrimary)}>{d.label} · {d.en}</div>
                    <div className={cx('mt-0.5 text-[10px] font-light', textFaint)}>{d.caliber}</div>
                  </div>
                  <div className="space-y-1 px-2 py-2 text-xs">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                      <div className={cx('font-light', textSecondary)}>部门收入</div>
                      <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(dept.revenue, cur)}</div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                      <div className={cx('font-light', textSecondary)}>部门成本</div>
                      <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(dept.cost, cur)}</div>
                    </div>
                    <div className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5', 'bg-[var(--recessed-bg)]')}>
                      <div className={cx('font-light', textPrimary)}>部门利润</div>
                      <div className={cx('text-right font-light tabular-nums', profitCls(dept.profit))}>{formatAmount(dept.profit, cur)}</div>
                    </div>
                  </div>
                </RdlSurface>
              );
            })}
          </div>
          <RdlSurface tone="panel" padding="compact" className="flex flex-col">
            <div className={cx('border-b px-4 pb-2 pt-2 text-[10px] font-light tracking-[0.14em]', divider, textSecondary)}>
              恒等式校验 · Σ 部门利润 = 合并利润
            </div>
            <div className="space-y-1 px-2 py-2 text-xs">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                <div className={cx('font-light', textSecondary)}>Σ 部门利润（服装部 + 面料部）</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(deptSum, cur)}</div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                <div className={cx('font-light', textSecondary)}>合并利润（抵销后）</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedProfit, cur)}</div>
              </div>
              <div className={cx('px-2 pt-1 text-[10px] font-light', identityGap === 0 ? 'text-[var(--success-text)]' : 'text-[var(--warning-text)]')}>
                {identityGap === 0
                  ? '恒等成立 — 抵销不改变公司利润，仅在部门间重新归属'
                  : `差额披露：${formatAmount(identityGap, cur)}（对应抵销过程的双边口径差异，请核对内部供料单登记）`}
              </div>
            </div>
          </RdlSurface>
          {renderElimination()}
        </div>
      );
    }

    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {/* 汇总卡片 */}
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>客户外部收入 · {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedRevenue, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>外部订单 {r.orders.externalCount} 张（内部面料销售不计入）</div>
          </RdlMetricCard>
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>合并成本 · {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedCost, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>含真实面料成本 {formatAmount(r.costBreakdown.realFabricCost, cur)}</div>
          </RdlMetricCard>
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>公司利润（抵销后）· {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', profitCls(r.consolidatedProfit))}>{formatAmount(r.consolidatedProfit, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>外部收入 − 合并成本</div>
          </RdlMetricCard>
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>合并抵销额 · {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', 'text-[var(--warning-text)]')}>-{formatAmount(r.elimination.amount, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>内部面料订单 {r.orders.internalCount} 张参与抵销</div>
          </RdlMetricCard>
        </div>

        {/* 成本构成 + 抵销过程 */}
        <RdlSurface tone="panel" padding="compact" className="flex flex-col">
          <div className={cx('border-b px-4 pb-2 pt-2 text-[10px] font-light tracking-[0.14em]', divider, textSecondary)}>
            合并成本构成 · Cost Breakdown
          </div>
          <div className="space-y-1 px-2 py-2 text-xs">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textPrimary)}>
                外部采购成本
                <span className={cx('ml-2 text-[10px]', textFaint)}>已剔除内部采购加价</span>
              </div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.externalPurchaseNetOfInternal, cur)}</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textPrimary)}>
                真实面料成本
                <span className={cx('ml-2 text-[10px]', textFaint)}>内部面料订单自身采购成本</span>
              </div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.realFabricCost, cur)}</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textSecondary)}>运费</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.freightCost, cur)}</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textSecondary)}>杂费</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.miscCost, cur)}</div>
            </div>
            <div className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5', 'bg-[var(--recessed-bg)]')}>
              <div className={cx('font-light', textPrimary)}>合并成本合计</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedCost, cur)}</div>
            </div>
          </div>
        </RdlSurface>
        {renderElimination()}
      </div>
    );
  };

  // ── 内部供料单视图（DR-033：双向关联独立核算，列表仅 incoming 主单）──
  const renderTransfers = () => {
    if (!transfers) return null;
    const gridCls = 'grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)]';
    const statusCls = (s: InternalTransferStatus | undefined): string => {
      switch (s) {
        case 'PendingConfirm': return 'text-[var(--warning-text)]';
        case 'Effective': return 'text-[var(--success-text)]';
        case 'Delivering': return 'text-[var(--warning-text)]';
        case 'Closed': return textPrimary;
        case 'Cancelled': return 'text-[var(--danger-text)]';
        default: return textFaint;
      }
    };
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
        <div className={cx(gridCls, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
          <div>供料单号</div>
          <div>物料</div>
          <div className="text-right">数量</div>
          <div className="text-right">结算价</div>
          <div className="text-right">金额</div>
          <div>服装订单</div>
          <div>面料订单</div>
          <div>交期</div>
          <div>状态</div>
          <div className="text-right">交付进度</div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
          {transfers.length === 0 && (
            <div className={cx('py-6 text-center font-light', textFaint)}>
              {transferStatus ? `暂无「${INTERNAL_TRANSFER_STATUS_LABEL[transferStatus]}」状态的内部供料单` : '暂无内部供料单 — 由服装部基于服装订单发起，经结算价审批与面料部确认后生效'}
            </div>
          )}
          {transfers.map(({ record, payload }) => {
            const amount = toAmount(record.transferAmount);
            const delivered = payload ? payload.deliveries.reduce((acc, d) => acc + d.quantity, 0) : 0;
            const confirmedQty = payload ? (payload.confirmedQuantity ?? payload.quantity) : 0;
            const expanded = expandedTransferId === record.id;
            return (
              <div key={record.id} className={cx('rounded-control', 'bg-[var(--recessed-bg)]')}>
                <button
                  type="button"
                  onClick={() => setExpandedTransferId(expanded ? null : record.id)}
                  className={cx(gridCls, 'w-full items-center px-4 py-2.5 text-left')}
                  aria-expanded={expanded}
                >
                  <div className={cx('truncate font-light', textPrimary)}>{record.id}</div>
                  <div className={cx('truncate font-light', textPrimary)}>{payload?.materialCode ?? '—'}</div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>
                    {payload ? `${payload.quantity.toLocaleString('zh-CN')} ${payload.unit}` : '—'}
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>
                    {payload ? formatAmount(payload.settlementPrice, record.transferCurrency) : '—'}
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(amount, record.transferCurrency)}</div>
                  <div className={cx('truncate font-light', textSecondary)}>{payload?.garmentOrderId ?? record.orderId}</div>
                  <div className={cx('truncate font-light', textSecondary)}>{payload?.fabricOrderId ?? '—'}</div>
                  <div className={cx('font-light tabular-nums', textSecondary)}>{payload?.dueDate ?? record.transferDate}</div>
                  <div className={cx('font-light', statusCls(payload?.status))}>
                    {payload ? INTERNAL_TRANSFER_STATUS_LABEL[payload.status] : (record.recognizedAt ? '已认账（历史）' : '未生效（历史）')}
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textSecondary)}>
                    {payload ? `${delivered.toLocaleString('zh-CN')} / ${confirmedQty.toLocaleString('zh-CN')} ${payload.unit}` : '—'}
                  </div>
                </button>
                {expanded && payload && (
                  <div className={cx('mx-2 mb-2 space-y-2 rounded-control px-3 py-2', 'bg-[var(--hover-darken)]')}>
                    <div className={cx('grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-light xl:grid-cols-4', textSecondary)}>
                      <div>申请部门：<span className={textPrimary}>{payload.requestDepartmentId}</span></div>
                      <div>供料部门：<span className={textPrimary}>{payload.supplyDepartmentId}</span></div>
                      <div>结算价审批单：<span className={textPrimary}>{payload.settlementApprovalId}</span></div>
                      <div>
                        确认数量/交期：
                        <span className={textPrimary}>
                          {payload.confirmedQuantity !== null ? `${payload.confirmedQuantity.toLocaleString('zh-CN')} ${payload.unit}` : '—'}
                          {' / '}{payload.confirmedDueDate ?? '—'}
                        </span>
                      </div>
                    </div>
                    {payload.deliveries.length > 0 && (
                      <div>
                        <div className={cx('pb-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>交付记录（分批出运/到货/差异）</div>
                        <div className="space-y-0.5">
                          {payload.deliveries.map(d => (
                            <div key={d.id} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.5fr)] items-center px-1 py-1 text-[11px]">
                              <div className={cx('font-light tabular-nums', textSecondary)}>{d.deliveryDate}</div>
                              <div className={cx('truncate font-light', textPrimary)}>{d.shipmentNumber ?? d.shipmentId}</div>
                              <div className={cx('text-right font-light tabular-nums', textPrimary)}>出运 {d.quantity.toLocaleString('zh-CN')}</div>
                              <div className={cx('text-right font-light tabular-nums', textPrimary)}>
                                {d.receivedQuantity !== null ? `到货 ${d.receivedQuantity.toLocaleString('zh-CN')}` : '到货 —'}
                              </div>
                              <div className={cx('text-right font-light tabular-nums', d.variance !== null && d.variance !== 0 ? 'text-[var(--warning-text)]' : textFaint)}>
                                {d.variance !== null ? `差异 ${d.variance >= 0 ? '+' : ''}${d.variance.toLocaleString('zh-CN')}` : '差异 —'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {payload.history.length > 0 && (
                      <div>
                        <div className={cx('pb-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>状态流转</div>
                        <div className="space-y-0.5">
                          {payload.history.map((h, i) => (
                            <div key={`${h.at}-${i}`} className="flex items-baseline gap-2 px-1 py-0.5 text-[11px]">
                              <span className={cx('shrink-0 font-light tabular-nums', textFaint)}>{h.at.slice(0, 16).replace('T', ' ')}</span>
                              <span className={cx('shrink-0 font-light', statusCls(h.to))}>
                                {h.from ? `${INTERNAL_TRANSFER_STATUS_LABEL[h.from]} → ` : ''}{INTERNAL_TRANSFER_STATUS_LABEL[h.to]}
                              </span>
                              <span className={cx('min-w-0 truncate font-light', textSecondary)}>{h.note ?? ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 写操作：按 server ALLOWED_TRANSITIONS 显隐（确认=PendingConfirm；交付=Effective/Delivering；取消=Draft/PendingConfirm） */}
                    {(payload.status === 'PendingConfirm' || payload.status === 'Effective' || payload.status === 'Delivering' || payload.status === 'Draft') && (
                      <div className={cx('flex items-center gap-2 border-t pt-2', divider)}>
                        {payload.status === 'PendingConfirm' && (
                          <RdlPill type="button" tone="accent" onClick={() => openConfirmTransfer({ record, payload })} className="min-h-8 px-3 text-[11px]">
                            面料部确认生效
                          </RdlPill>
                        )}
                        {(payload.status === 'Effective' || payload.status === 'Delivering') && (
                          <RdlPill type="button" tone="accent" onClick={() => openDeliveryTransfer({ record, payload })} className="min-h-8 px-3 text-[11px]">
                            交付登记
                          </RdlPill>
                        )}
                        {(payload.status === 'Draft' || payload.status === 'PendingConfirm') && (
                          <RdlPill type="button" onClick={() => openCancelTransfer({ record, payload })} className="min-h-8 px-3 text-[11px]">
                            取消申请
                          </RdlPill>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </RdlSurface>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* 子 tab + 过滤器 */}
      <div className="flex min-h-0 shrink-0 items-center gap-2">
        <RdlToolbar density="compact">
          {REPORT_TABS.map(t => (
            <RdlPill key={t.id} type="button" onClick={() => setTab(t.id)} active={tab === t.id} className="min-h-8 px-4 text-[11px]">
              {t.label}
            </RdlPill>
          ))}
        </RdlToolbar>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'aging' && (
            <>
              <RdlPill type="button" active={agingType === 'Receivable'} onClick={() => setAgingType('Receivable')} className="min-h-8 px-3 text-[11px]">应收</RdlPill>
              <RdlPill type="button" active={agingType === 'Payable'} onClick={() => setAgingType('Payable')} className="min-h-8 px-3 text-[11px]">应付</RdlPill>
              <RdlPill type="button" active tone="accent" onClick={loadAging} className="min-h-8 px-3 text-[11px]">刷新</RdlPill>
            </>
          )}
          {tab === 'statement' && (
            <>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="bds-select sm min-w-40" aria-label="选择客户">
                {relations.length === 0 && <option value="">加载客户...</option>}
                {relations.map(r => <option key={r.id} value={r.id}>{r.chineseName || r.name}</option>)}
              </select>
              <CapsuleDateInput value={stmtFrom} onChange={setStmtFrom} isDarkMode={isDarkMode} className={inputCls} placeholder="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <CapsuleDateInput value={stmtTo} onChange={setStmtTo} isDarkMode={isDarkMode} className={inputCls} placeholder="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadStatement} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
            </>
          )}
          {tab === 'supplier-statement' && (
            <>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="bds-select sm min-w-40" aria-label="选择供应商">
                {supplierRelations.length === 0 && <option value="">加载供应商...</option>}
                {supplierRelations.map(r => <option key={r.id} value={r.id}>{r.chineseName || r.name}</option>)}
              </select>
              <CapsuleDateInput value={supFrom} onChange={setSupFrom} isDarkMode={isDarkMode} className={inputCls} placeholder="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <CapsuleDateInput value={supTo} onChange={setSupTo} isDarkMode={isDarkMode} className={inputCls} placeholder="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadSupplierStatement} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
            </>
          )}
          {tab === 'fx' && (
            <>
              <CapsuleDateInput value={fxFrom} onChange={setFxFrom} isDarkMode={isDarkMode} className={inputCls} placeholder="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <CapsuleDateInput value={fxTo} onChange={setFxTo} isDarkMode={isDarkMode} className={inputCls} placeholder="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadFx} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
            </>
          )}
          {tab === 'fx-ledger' && (
            <>
              <CapsuleDateInput value={ledgerFrom} onChange={setLedgerFrom} isDarkMode={isDarkMode} className={inputCls} placeholder="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <CapsuleDateInput value={ledgerTo} onChange={setLedgerTo} isDarkMode={isDarkMode} className={inputCls} placeholder="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadLedger} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
            </>
          )}
          {tab === 'consolidated' && (
            <>
              <CapsuleDateInput
                value={conFrom}
                onChange={setConFrom}
                isDarkMode={isDarkMode}
                className={cx(inputCls, 'w-32')}
                placeholder="开始日期"
              />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <CapsuleDateInput
                value={conTo}
                onChange={setConTo}
                isDarkMode={isDarkMode}
                className={cx(inputCls, 'w-32')}
                placeholder="结束日期"
              />
              {(conFrom || conTo) && (
                <RdlPill type="button" onClick={() => { setConFrom(''); setConTo(''); }} className="min-h-8 px-3 text-[11px]">清空</RdlPill>
              )}
              <RdlPill type="button" active={consolidatedMode === 'company'} onClick={() => setConsolidatedMode('company')} className="min-h-8 px-3 text-[11px]">合并视图</RdlPill>
              <RdlPill type="button" active={consolidatedMode === 'department'} onClick={() => setConsolidatedMode('department')} className="min-h-8 px-3 text-[11px]">部门视角</RdlPill>
              <RdlPill type="button" active tone="accent" onClick={loadConsolidated} className="min-h-8 px-3 text-[11px]">刷新</RdlPill>
            </>
          )}
          {tab === 'internal-trade' && (
            <>
              <select
                value={transferStatus}
                onChange={e => setTransferStatus(e.target.value as InternalTransferStatus | '')}
                className="bds-select sm min-w-36"
                aria-label="状态筛选"
              >
                <option value="">全部状态</option>
                {INTERNAL_TRANSFER_STATUSES.map(s => (
                  <option key={s} value={s}>{INTERNAL_TRANSFER_STATUS_LABEL[s]}</option>
                ))}
              </select>
              <RdlPill type="button" active tone="accent" onClick={loadTransfers} className="min-h-8 px-3 text-[11px]">刷新</RdlPill>
              <RdlPill type="button" tone="accent" onClick={openCreateTransfer} className="min-h-8 px-3 text-[11px]">
                <span className="inline-flex items-center gap-1"><Plus size={14} strokeWidth={1.5} />新建申请</span>
              </RdlPill>
            </>
          )}
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={18} strokeWidth={1.5} className={cx('animate-spin', textFaint)} />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <AlertCircle size={18} strokeWidth={1.5} className="text-[var(--danger-text)] opacity-70" />
          <div className={cx('text-xs font-light', textSecondary)}>{error}</div>
        </div>
      ) : (
        <>
          {tab === 'aging' && renderAging()}
          {tab === 'statement' && renderStatement()}
          {tab === 'supplier-statement' && renderSupplierStatement()}
          {tab === 'fx' && renderFx()}
          {tab === 'fx-ledger' && renderFxLedger()}
          {tab === 'consolidated' && renderConsolidated()}
          {tab === 'internal-trade' && renderTransfers()}
        </>
      )}

      {/* ── 内部供料单写操作弹窗（G7：新建 / 确认生效 / 交付登记 / 取消）── */}
      {transferDialog && (
        <div className="bds-modal-mask" onClick={closeTransferDialog}>
          <div className="bds-modal" style={{ width: transferDialog.mode === 'create' ? '32rem' : '26rem' }} onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className={cx('text-[13px] font-light tracking-[0.02em]', textPrimary)}>
                {transferDialog.mode === 'create' && '发起内部供料申请'}
                {transferDialog.mode === 'confirm' && '面料部确认生效'}
                {transferDialog.mode === 'delivery' && '交付登记'}
                {transferDialog.mode === 'cancel' && '取消内部供料申请'}
              </h2>
              <button
                type="button"
                onClick={closeTransferDialog}
                disabled={transferSubmitting}
                aria-label="关闭"
                className={cx('rounded-control p-1 transition-colors hover:bg-[var(--recessed-bg-hover)] disabled:opacity-40', textFaint)}
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-3">
              {/* 目标单摘要（非新建模式） */}
              {transferDialog.mode !== 'create' && (
                <div className={cx('rounded-inset px-3 py-2 text-[11px] font-light', 'bg-[var(--recessed-bg)]', textSecondary)}>
                  供料单 <span className={textPrimary}>{transferDialog.item.record.id}</span>
                  {transferDialog.item.payload && (
                    <>
                      {' · '}物料 <span className={textPrimary}>{transferDialog.item.payload.materialCode}</span>
                      {' · '}申请 <span className={cx('tabular-nums', textPrimary)}>{transferDialog.item.payload.quantity.toLocaleString('zh-CN')} {transferDialog.item.payload.unit}</span>
                      {' · '}交期 <span className={cx('tabular-nums', textPrimary)}>{transferDialog.item.payload.dueDate}</span>
                    </>
                  )}
                </div>
              )}

              {transferDialog.mode === 'create' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>服装订单 *</label>
                      <select
                        value={createForm.garmentOrderId}
                        onChange={e => setCreateForm(f => ({ ...f, garmentOrderId: e.target.value }))}
                        className="bds-select"
                        disabled={!orderOptions}
                      >
                        <option value="">{orderOptions ? '请选择服装订单' : '加载订单...'}</option>
                        {(orderOptions ?? []).filter(o => o.type === 'Garment').map(o => (
                          <option key={o.id} value={o.id}>{o.id} · {o.customer} · {o.product}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>面料订单 *</label>
                      <select
                        value={createForm.fabricOrderId}
                        onChange={e => setCreateForm(f => ({ ...f, fabricOrderId: e.target.value }))}
                        className="bds-select"
                        disabled={!orderOptions}
                      >
                        <option value="">{orderOptions ? '请选择面料订单' : '加载订单...'}</option>
                        {(orderOptions ?? []).filter(o => o.type === 'Fabric').map(o => (
                          <option key={o.id} value={o.id}>{o.id} · {o.customer} · {o.product}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {orderOptionsError && (
                    <div className="bds-alert danger">订单列表加载失败：{orderOptionsError}（可关闭弹窗重试）</div>
                  )}
                  {orderOptions && (
                    <div className={cx('text-[10px] font-light', textFaint)}>
                      面料订单须为已标记内部面料交易（isInternalFabricTrade）的订单，服务端 fail-closed 校验
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>申请部门 *</label>
                      <input value={createForm.requestDepartmentId} onChange={e => setCreateForm(f => ({ ...f, requestDepartmentId: e.target.value }))} className="bds-input sm" />
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>供料部门 *</label>
                      <input value={createForm.supplyDepartmentId} onChange={e => setCreateForm(f => ({ ...f, supplyDepartmentId: e.target.value }))} className="bds-input sm" />
                    </div>
                  </div>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>物料编码 *</label>
                    <input value={createForm.materialCode} onChange={e => setCreateForm(f => ({ ...f, materialCode: e.target.value }))} placeholder="如 FAB-COTTON-40S" className="bds-input sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>数量 *</label>
                      <input type="number" value={createForm.quantity} onChange={e => setCreateForm(f => ({ ...f, quantity: e.target.value }))} className="bds-input sm" />
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>单位</label>
                      <input value={createForm.unit} onChange={e => setCreateForm(f => ({ ...f, unit: e.target.value }))} className="bds-input sm" />
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>内部结算价 *</label>
                      <input type="number" value={createForm.settlementPrice} onChange={e => setCreateForm(f => ({ ...f, settlementPrice: e.target.value }))} className="bds-input sm" />
                    </div>
                  </div>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>交期 *</label>
                    <CapsuleDateInput value={createForm.dueDate} onChange={v => setCreateForm(f => ({ ...f, dueDate: v }))} isDarkMode={isDarkMode} className="bds-input sm" />
                  </div>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>备注</label>
                    <input value={createForm.memo} onChange={e => setCreateForm(f => ({ ...f, memo: e.target.value }))} className="bds-input sm" />
                  </div>
                  <div className={cx('text-[10px] font-light', textFaint)}>
                    提交后生成结算价审批单（DR-006），审批通过且面料部确认后方可生效
                  </div>
                </>
              )}

              {transferDialog.mode === 'confirm' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>确认数量（缺省=申请数量）</label>
                      <input
                        type="number"
                        value={confirmForm.confirmedQuantity}
                        onChange={e => setConfirmForm(f => ({ ...f, confirmedQuantity: e.target.value }))}
                        placeholder={transferDialog.item.payload ? String(transferDialog.item.payload.quantity) : ''}
                        className="bds-input sm"
                      />
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>确认交期（缺省=申请交期）</label>
                      <CapsuleDateInput
                        value={confirmForm.confirmedDueDate}
                        onChange={v => setConfirmForm(f => ({ ...f, confirmedDueDate: v }))}
                        isDarkMode={isDarkMode}
                        className="bds-input sm"
                      />
                    </div>
                  </div>
                  <div className={cx('text-[10px] font-light', textFaint)}>
                    确认后单据生效并计入部门核算与合并抵销；前置条件：结算价审批已通过（服务端校验）
                  </div>
                </>
              )}

              {transferDialog.mode === 'delivery' && (
                <>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>关联运单 *（面料订单名下非取消运单）</label>
                    {shipmentOptions && shipmentOptions.length > 0 ? (
                      <select
                        value={deliveryForm.shipmentId}
                        onChange={e => setDeliveryForm(f => ({ ...f, shipmentId: e.target.value }))}
                        className="bds-select"
                      >
                        <option value="">请选择运单</option>
                        {shipmentOptions.map(s => (
                          <option key={s.id} value={s.id}>{s.shipmentNumber || s.id} · {s.status}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={deliveryForm.shipmentId}
                        onChange={e => setDeliveryForm(f => ({ ...f, shipmentId: e.target.value }))}
                        placeholder={shipmentOptions === null ? '加载运单...' : '该面料订单暂无可选运单，请手工输入运单 ID'}
                        disabled={shipmentOptions === null}
                        className="bds-input sm"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>交付数量 *</label>
                      <input type="number" value={deliveryForm.quantity} onChange={e => setDeliveryForm(f => ({ ...f, quantity: e.target.value }))} className="bds-input sm" />
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>交付日期 *</label>
                      <CapsuleDateInput value={deliveryForm.deliveryDate} onChange={v => setDeliveryForm(f => ({ ...f, deliveryDate: v }))} isDarkMode={isDarkMode} className="bds-input sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>到货数量（可后补）</label>
                      <input type="number" value={deliveryForm.receivedQuantity} onChange={e => setDeliveryForm(f => ({ ...f, receivedQuantity: e.target.value }))} className="bds-input sm" />
                    </div>
                    <div>
                      <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>到货日期</label>
                      <CapsuleDateInput value={deliveryForm.receivedDate} onChange={v => setDeliveryForm(f => ({ ...f, receivedDate: v }))} isDarkMode={isDarkMode} className="bds-input sm" />
                    </div>
                  </div>
                  <div className={cx('text-[10px] font-light', textFaint)}>
                    累计交付满确认数量自动关闭；分批交付进入「交付中」；差异 = 到货 − 出运透明披露
                  </div>
                </>
              )}

              {transferDialog.mode === 'cancel' && (
                <>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>取消原因</label>
                    <input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="记入状态流转历史" className="bds-input sm" />
                  </div>
                  <div className={cx('text-[10px] font-light', textFaint)}>
                    仅草稿 / 待确认状态可取消；生效后须走订单变更或 DR-013 例外链
                  </div>
                </>
              )}

              {transferDialogError && <div className="bds-alert danger">{transferDialogError}</div>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={transferSubmitting} onClick={closeTransferDialog} className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" disabled={transferSubmitting} onClick={submitTransferDialog} className="bds-btn bds-btn-primary">
                {transferSubmitting
                  ? '提交中...'
                  : transferDialog.mode === 'create'
                    ? '提交申请'
                    : transferDialog.mode === 'confirm'
                      ? '确认生效'
                      : transferDialog.mode === 'delivery'
                        ? '登记交付'
                        : '确认取消'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REQ2-08 催款函 BottomSheet（DR-050：中英函预览/打印/登记/历史）── */}
      {dunningRow && (
        <DunningSheet
          open={!!dunningRow}
          onClose={() => setDunningRow(null)}
          customerRelationId={dunningRow.customerRelationId}
          customerName={dunningRow.customerName}
          currency={dunningRow.currency}
          asOf={aging?.asOf}
          endpoint={endpoint}
        />
      )}
    </div>
  );
}

export default FinanceReportsPanel;
