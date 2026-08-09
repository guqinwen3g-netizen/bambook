/**
 * QC 工作台 QcWorkbenchManager
 * 阶段 P0：QC 工作台 + 驻地管理 + 业务线配置前端
 *
 * 功能：
 *   1. 验货任务 Assignments — QC 人员筛选 / 看板三列（Assigned / InProgress / Completed）/
 *      开始·完成（可关联验货报告）·取消·删除 / 新建任务（订单搜索选择器）
 *   2. 驻地管理 Locations — 驻地卡片 CRUD（删除被任务引用时展示后端拒绝原因）
 *   3. 业务线 Business Lines — 业务线规则表（MOQ / 生产周期 / 付款条件 / 启停开关）CRUD
 *
 * 设计原则：
 *   - 任务看板数据来自服务端聚合 /qc/workbench，订单信息为服务端快照，前端只读展示
 *   - QC 人员选择器复用 /api/hr/personnel（owner/admin），无权限时降级为手工录入 qcUserId
 *   - RDL flat 设计：statusSemanticClass 中性色阶，无阴影，大圆角
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck,
  MapPin,
  Layers,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  X,
  Play,
  CheckCheck,
  Ban,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Order,
  BusinessLine,
  BusinessLineInput,
  BusinessLinePatch,
  QCLocation,
  QCLocationInput,
  QCAssignment,
  QCAssignmentInput,
  QCInspectionType,
  QCAssignmentStatus,
  QcWorkbenchData,
  UserAccountOption,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, StatusSemantic } from './rdlBusinessStatusTokens';

// ==================== 常量 ====================

type ModuleTab = 'assignments' | 'locations' | 'businessLines';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'assignments', label: '验货任务 Assignments', icon: ClipboardCheck },
  { id: 'locations', label: '驻地管理 Locations', icon: MapPin },
  { id: 'businessLines', label: '业务线 Business Lines', icon: Layers },
];

const QC_STATUS_LABELS: Record<QCAssignmentStatus, string> = {
  Assigned: '已分配',
  InProgress: '进行中',
  Completed: '已完成',
  Cancelled: '已取消',
};

const QC_STATUS_SEMANTIC: Record<QCAssignmentStatus, StatusSemantic> = {
  Assigned: 'info',
  InProgress: 'active',
  Completed: 'success',
  Cancelled: 'neutral',
};

const INSPECTION_TYPE_LABELS: Record<QCInspectionType, string> = {
  midline: '中期',
  final: '终期',
};

const LOCATION_FOCUS_LABELS: Record<string, string> = {
  garment: '服装',
  fabric: '面料',
};

const MOQ_UNITS = ['M', 'PC'];

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return dateStr;
}

function formatTs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

// ── 阶段 IA-3：订单详情下游动作 prime（发起验货预填订单，与 Suppliers preview 同模式） ──
const QC_ASSIGNMENT_PRIME_KEY = 'bambook_qc_assignment_prime';

export const primeQcAssignmentFromOrder = (orderId: string) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(QC_ASSIGNMENT_PRIME_KEY, JSON.stringify({ orderId }));
  } catch {
    // Dev-preview continuity only; ignore storage failures.
  }
};

const readQcAssignmentPrime = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(QC_ASSIGNMENT_PRIME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { orderId?: unknown };
    return typeof parsed.orderId === 'string' && parsed.orderId ? parsed.orderId : null;
  } catch {
    return null;
  }
};

const clearQcAssignmentPrime = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(QC_ASSIGNMENT_PRIME_KEY);
  } catch {
    // ignore
  }
};

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（本地时区）
}

function isOverdue(a: QCAssignment): boolean {
  if (!a.dueDate) return false;
  if (a.status === 'Completed' || a.status === 'Cancelled') return false;
  return a.dueDate < todayLocal();
}

// ==================== 共享样式 ====================

const inputClass = "w-full bg-surface-primary text-text-primary text-sm rounded-control px-3 py-2 border border-border-subtle outline-none focus:border-border-action";
const actionButtonClass = "flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-text-tertiary mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-surface-elevated rounded-panel w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ==================== 组件 Props ====================

interface QcWorkbenchManagerProps {
  isDarkMode?: boolean;
}

// ==================== 主组件 ====================

export default function QcWorkbenchManager({ isDarkMode }: QcWorkbenchManagerProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('assignments');

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="QC 工作台" subtitle="QC Workbench" />

      {/* 模块 Tab 栏 */}
      <div className="px-7 flex items-center gap-1 border-b border-border-subtle shrink-0">
        {MODULE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-control transition-colors ${
                isActive
                  ? 'text-text-primary bg-surface-elevated border-b-2 border-border-action'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容（切换即重挂载，保证数据新鲜） */}
      <div className="flex-1 min-h-0 px-7 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="h-full min-h-0"
          >
            {activeTab === 'assignments' && <AssignmentsPanel isDarkMode={isDarkMode} />}
            {activeTab === 'locations' && <LocationsPanel isDarkMode={isDarkMode} />}
            {activeTab === 'businessLines' && <BusinessLinesPanel isDarkMode={isDarkMode} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 验货任务 Panel ====================

function AssignmentsPanel({ isDarkMode }: { isDarkMode?: boolean }) {
  const [workbench, setWorkbench] = useState<QcWorkbenchData>({ assigned: [], inProgress: [], completed: [] });
  const [loading, setLoading] = useState(true);
  const [qcUserFilter, setQcUserFilter] = useState('');
  const [users, setUsers] = useState<UserAccountOption[]>([]);
  const [usersLoadFailed, setUsersLoadFailed] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [completingAssignment, setCompletingAssignment] = useState<QCAssignment | null>(null);

  // 阶段 IA-3：订单详情「发起验货」prime —— 挂载时自动打开新建任务表单并预选订单
  const [primedOrderId, setPrimedOrderId] = useState<string | null>(() => {
    const orderId = readQcAssignmentPrime();
    if (orderId) clearQcAssignmentPrime();
    return orderId;
  });

  useEffect(() => {
    if (primedOrderId) setShowForm(true);
  }, [primedOrderId]);

  // ── 加载 QC 人员列表（选择器数据源；无权限时降级为手工录入） ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listUserAccounts();
        if (!cancelled) setUsers(list);
      } catch (e) {
        console.error('[QcWorkbenchManager] listUserAccounts failed', e);
        if (!cancelled) setUsersLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 加载工作台（服务端按状态聚合） ──
  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    try {
      setWorkbench(await apiService.getQcWorkbench(qcUserFilter || undefined));
    } catch (e) {
      console.error('[QcWorkbenchManager] getQcWorkbench failed', e);
    } finally {
      setLoading(false);
    }
  }, [qcUserFilter]);

  useEffect(() => {
    loadWorkbench();
  }, [loadWorkbench]);

  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => map.set(u.id, u.displayName));
    return map;
  }, [users]);

  const totalCount = workbench.assigned.length + workbench.inProgress.length + workbench.completed.length;

  // ── 任务操作 ──
  const handleStart = async (a: QCAssignment) => {
    setUpdatingId(a.id);
    try {
      await apiService.startQcAssignment(a.id);
      await loadWorkbench();
    } catch (e: any) {
      alert(`开始任务失败：${e?.message || e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleComplete = async (reportId?: string) => {
    if (!completingAssignment) return;
    setUpdatingId(completingAssignment.id);
    try {
      await apiService.completeQcAssignment(completingAssignment.id, reportId || undefined);
      setCompletingAssignment(null);
      await loadWorkbench();
    } catch (e: any) {
      alert(`完成任务失败：${e?.message || e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCancel = async (a: QCAssignment) => {
    const label = a.order?.poNumber || a.orderId;
    if (!confirm(`确认取消订单「${label}」的${INSPECTION_TYPE_LABELS[a.inspectionType] || ''}验货任务？`)) return;
    setUpdatingId(a.id);
    try {
      await apiService.cancelQcAssignment(a.id);
      await loadWorkbench();
    } catch (e: any) {
      alert(`取消任务失败：${e?.message || e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (a: QCAssignment) => {
    const label = a.order?.poNumber || a.orderId;
    if (!confirm(`确认删除订单「${label}」的验货任务？该操作不可恢复。`)) return;
    try {
      await apiService.deleteQcAssignment(a.id);
      await loadWorkbench();
    } catch (e: any) {
      alert(`删除失败：${e?.message || e}`);
    }
  };

  const handleCreate = async (input: QCAssignmentInput) => {
    try {
      await apiService.createQcAssignment(input);
      setShowForm(false);
      await loadWorkbench();
    } catch (e: any) {
      alert(`新建验货任务失败：${e?.message || e}`);
    }
  };

  const columns: Array<{ status: QCAssignmentStatus; items: QCAssignment[] }> = [
    { status: 'Assigned', items: workbench.assigned },
    { status: 'InProgress', items: workbench.inProgress },
    { status: 'Completed', items: workbench.completed },
  ];

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      {/* 操作条：QC 人员筛选 + 刷新 + 新建 */}
      <div className="shrink-0 rounded-panel bg-surface-primary border border-border-subtle px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-text-tertiary shrink-0">QC 人员</span>
        <select
          value={qcUserFilter}
          onChange={(e) => setQcUserFilter(e.target.value)}
          className="bg-surface-elevated text-text-primary text-xs rounded-control px-2 py-1.5 border border-border-subtle outline-none focus:border-border-action"
        >
          <option value="">全部</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName}</option>
          ))}
        </select>
        {usersLoadFailed && (
          <span className="text-[11px] text-text-tertiary">人员列表需管理角色权限，当前仅支持查看全部任务</span>
        )}
        <button
          onClick={loadWorkbench}
          className="p-1 rounded-control hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] text-text-tertiary">共 {totalCount} 项任务</span>
        <button
          onClick={() => setShowForm(true)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          新建任务
        </button>
      </div>

      {/* 看板三列 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center rounded-panel bg-surface-primary border border-border-subtle">
          <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
        </div>
      ) : totalCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-panel bg-surface-primary border border-border-subtle text-text-tertiary px-4">
          <ClipboardCheck className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm text-center">
            {qcUserFilter ? '该 QC 人员暂无验货任务' : '暂无验货任务，点击「新建任务」开始分配'}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
          {columns.map((col) => (
            <div key={col.status} className="flex flex-col min-h-0 rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-control border ${statusSemanticClass(QC_STATUS_SEMANTIC[col.status], isDarkMode)}`}>
                  {QC_STATUS_LABELS[col.status]}
                </span>
                <span className="text-[11px] text-text-tertiary ml-auto">{col.items.length} 项</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {col.items.length === 0 ? (
                  <div className="text-center py-8 text-text-tertiary text-xs bg-surface-elevated rounded-card">
                    暂无{QC_STATUS_LABELS[col.status]}任务
                  </div>
                ) : (
                  col.items.map((a) => {
                    const overdue = isOverdue(a);
                    const canOperate = a.status === 'Assigned' || a.status === 'InProgress';
                    return (
                      <div key={a.id} className="bg-surface-elevated rounded-card p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-primary font-medium truncate flex-1">
                            {a.order?.poNumber || a.orderId}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('info', isDarkMode)}`}>
                            {INSPECTION_TYPE_LABELS[a.inspectionType] || a.inspectionType}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(QC_STATUS_SEMANTIC[a.status] ?? 'neutral', isDarkMode)}`}>
                            {QC_STATUS_LABELS[a.status] || a.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-text-secondary truncate">
                          {a.order ? `${a.order.customer} · ${a.order.product}` : a.orderId}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary flex-wrap">
                          <span className={overdue ? `px-1.5 py-0.5 rounded-control border ${statusSemanticClass('danger', isDarkMode)}` : ''}>
                            要求 {formatDate(a.dueDate)}{overdue ? '（已过期）' : ''}
                          </span>
                          {a.location?.name && (
                            <span className="flex items-center gap-0.5 truncate">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {a.location.name}
                            </span>
                          )}
                          <span className="truncate">{userNameById.get(a.qcUserId) ?? a.qcUserId}</span>
                        </div>
                        {a.status === 'Completed' && a.completedAt != null && (
                          <div className="mt-1 text-[11px] text-text-tertiary">
                            完成于 {formatTs(a.completedAt)}{a.reportId ? ` · 报告 ${a.reportId}` : ''}
                          </div>
                        )}
                        {a.notes && (
                          <div className="mt-1.5 text-[11px] text-text-tertiary whitespace-pre-wrap">{a.notes}</div>
                        )}
                        <div className="mt-2 flex items-center gap-1.5">
                          {a.status === 'Assigned' && (
                            <button onClick={() => handleStart(a)} disabled={updatingId === a.id} className={actionButtonClass}>
                              {updatingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                              开始
                            </button>
                          )}
                          {canOperate && (
                            <button onClick={() => setCompletingAssignment(a)} disabled={updatingId === a.id} className={actionButtonClass}>
                              <CheckCheck className="w-3.5 h-3.5" />
                              完成
                            </button>
                          )}
                          {canOperate && (
                            <button onClick={() => handleCancel(a)} disabled={updatingId === a.id} className={actionButtonClass}>
                              <Ban className="w-3.5 h-3.5" />
                              取消
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(a)}
                            className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors ml-auto"
                            title="删除任务"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 弹窗 */}
      <AnimatePresence>
        {showForm && (
          <AssignmentForm
            users={users}
            usersLoadFailed={usersLoadFailed}
            initialOrderId={primedOrderId}
            onSave={handleCreate}
            onClose={() => { setShowForm(false); setPrimedOrderId(null); }}
          />
        )}
        {completingAssignment && (
          <CompleteAssignmentForm
            assignment={completingAssignment}
            saving={updatingId === completingAssignment.id}
            onSave={handleComplete}
            onClose={() => setCompletingAssignment(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 新建验货任务表单 ───

function AssignmentForm({
  users,
  usersLoadFailed,
  initialOrderId,
  onSave,
  onClose,
}: {
  users: UserAccountOption[];
  usersLoadFailed: boolean;
  initialOrderId?: string | null;
  onSave: (input: QCAssignmentInput) => void;
  onClose: () => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderQuery, setOrderQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [inspectionType, setInspectionType] = useState<QCInspectionType>('final');
  const [qcUserId, setQcUserId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<QCLocation[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listOrders();
        if (!cancelled) {
          const active = list.filter((o) => !o.deletedAt);
          setOrders(active);
          // 阶段 IA-3：prime 订单预选（订单详情「发起验货」直达）
          if (initialOrderId) {
            const hit = active.find((o) => o.id === initialOrderId);
            if (hit) setSelectedOrder(hit);
          }
        }
      } catch (e) {
        console.error('[QcWorkbenchManager] load orders failed', e);
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    })();
    (async () => {
      try {
        const list = await apiService.listQcLocations();
        if (!cancelled) setLocations(list);
      } catch (e) {
        console.error('[QcWorkbenchManager] load qc locations failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [initialOrderId]);

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    if (!q) return [];
    return orders
      .filter((o) =>
        (o.poNumber || '').toLowerCase().includes(q)
        || (o.customer || '').toLowerCase().includes(q)
        || (o.product || '').toLowerCase().includes(q)
        || o.id.toLowerCase().includes(q))
      .slice(0, 10);
  }, [orders, orderQuery]);

  const handleSubmit = () => {
    if (!selectedOrder) {
      alert('请搜索并选择订单');
      return;
    }
    if (!qcUserId.trim()) {
      alert('请选择执行 QC');
      return;
    }
    onSave({
      orderId: selectedOrder.id,
      inspectionType,
      qcUserId: qcUserId.trim(),
      locationId: locationId || null,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <ModalShell title="新建验货任务" onClose={onClose}>
      {/* 订单搜索选择器 */}
      <Field label="订单 *">
        {selectedOrder ? (
          <div className="flex items-center gap-2 bg-surface-primary rounded-control px-3 py-2 border border-border-subtle">
            <span className="text-sm text-text-primary truncate flex-1">
              {selectedOrder.poNumber || selectedOrder.id} · {selectedOrder.customer} · {selectedOrder.product}
            </span>
            <button
              onClick={() => setSelectedOrder(null)}
              className="p-1 rounded-control text-text-tertiary hover:text-text-primary transition-colors shrink-0"
              title="重新选择"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 bg-surface-primary rounded-control px-2.5 py-1.5 border border-border-subtle focus-within:border-border-action">
              <Search className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
              <input
                type="text"
                placeholder="搜索 PO 号 / 客户 / 产品..."
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                className="bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none flex-1 min-w-0"
              />
              {ordersLoading && <Loader2 className="w-3 h-3 animate-spin text-text-tertiary shrink-0" />}
            </div>
            {filteredOrders.length > 0 && (
              <div className="mt-1.5 bg-surface-primary rounded-control border border-border-subtle divide-y divide-border-subtle max-h-40 overflow-y-auto">
                {filteredOrders.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => { setSelectedOrder(o); setOrderQuery(''); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-elevated"
                  >
                    <span className="text-xs text-text-primary truncate flex-1">{o.poNumber || o.id}</span>
                    <span className="text-[10px] text-text-tertiary truncate shrink-0">{o.customer} · {o.product}</span>
                  </button>
                ))}
              </div>
            )}
            {!ordersLoading && orders.length === 0 && (
              <div className="text-[11px] text-text-tertiary mt-1">暂无可选订单，请先在「生产管理」创建订单</div>
            )}
          </>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="验货类型 *">
          <select className={inputClass} value={inspectionType} onChange={(e) => setInspectionType(e.target.value as QCInspectionType)}>
            {(Object.keys(INSPECTION_TYPE_LABELS) as QCInspectionType[]).map((t) => (
              <option key={t} value={t}>{INSPECTION_TYPE_LABELS[t]}验货</option>
            ))}
          </select>
        </Field>
        <Field label="执行 QC *">
          {users.length > 0 ? (
            <select className={inputClass} value={qcUserId} onChange={(e) => setQcUserId(e.target.value)}>
              <option value="">选择 QC 人员...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}{u.department ? `（${u.department}）` : ''}</option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              value={qcUserId}
              onChange={(e) => setQcUserId(e.target.value)}
              placeholder={usersLoadFailed ? '人员列表不可用，请输入 QC 用户 ID' : '输入 QC 用户 ID'}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="所属驻地">
          <select className={inputClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">不指定驻地</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
        <Field label="要求完成日期">
          <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field label="备注">
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ─── 完成任务表单（可关联验货报告） ───

function CompleteAssignmentForm({
  assignment,
  saving,
  onSave,
  onClose,
}: {
  assignment: QCAssignment;
  saving: boolean;
  onSave: (reportId?: string) => void;
  onClose: () => void;
}) {
  const [reportId, setReportId] = useState('');

  return (
    <ModalShell title={`完成验货任务 ${assignment.order?.poNumber || assignment.orderId}`} onClose={onClose}>
      <div className="mb-3 px-3 py-2 rounded-card bg-surface-primary border border-border-subtle text-xs text-text-tertiary">
        {INSPECTION_TYPE_LABELS[assignment.inspectionType] || assignment.inspectionType}验货 · {assignment.order ? `${assignment.order.customer} · ${assignment.order.product}` : assignment.orderId}
      </div>
      <Field label="验货报告 ID">
        <input
          className={inputClass}
          value={reportId}
          onChange={(e) => setReportId(e.target.value)}
          placeholder="可选，完成后关联 InspectionReport"
        />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={() => onSave(reportId.trim() || undefined)}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all disabled:opacity-50"
        >
          {saving ? '提交中...' : '确认完成'}
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 驻地管理 Panel ====================

function LocationsPanel({ isDarkMode }: { isDarkMode?: boolean }) {
  const [locations, setLocations] = useState<QCLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<QCLocation | null>(null);

  const loadLocations = useCallback(async () => {
    setLoading(true);
    try {
      setLocations(await apiService.listQcLocations());
    } catch (e) {
      console.error('[QcWorkbenchManager] listQcLocations failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const handleSave = async (input: QCLocationInput, id?: string) => {
    try {
      if (id) {
        const { code: _code, ...patch } = input;
        await apiService.updateQcLocation(id, patch);
      } else {
        await apiService.createQcLocation(input);
      }
      setShowForm(false);
      setEditingLocation(null);
      await loadLocations();
    } catch (e: any) {
      alert(`保存驻地失败：${e?.message || e}`);
    }
  };

  const handleDelete = async (location: QCLocation) => {
    if (!confirm(`确认删除驻地「${location.name}」？`)) return;
    try {
      await apiService.deleteQcLocation(location.id);
      await loadLocations();
    } catch (e: any) {
      // 后端拒绝（如仍有验货任务引用）时直接展示后端错误消息
      alert(`删除失败：${e?.message || e}`);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
      {/* 操作条 */}
      <div className="p-3 border-b border-border-subtle flex items-center gap-2">
        <span className="text-[11px] text-text-tertiary">QC 常驻验货驻地（如 温州驻场-服装 / 苏州驻场-面料）</span>
        <button
          onClick={loadLocations}
          className="p-1 rounded-control hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setEditingLocation(null); setShowForm(true); }}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          新建驻地
        </button>
      </div>

      {/* 驻地卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        ) : locations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <MapPin className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">暂无驻地，点击「新建驻地」配置 QC 常驻验货点</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {locations.map((location) => (
              <div key={location.id} className="bg-surface-elevated rounded-card p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary font-medium truncate flex-1">{location.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('neutral', isDarkMode)}`}>
                    {location.code}
                  </span>
                  {location.focus && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('info', isDarkMode)}`}>
                      {LOCATION_FOCUS_LABELS[location.focus] || location.focus}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary flex-wrap">
                  {location.region && <span>区域 {location.region}</span>}
                  {location.address && <span className="truncate">地址 {location.address}</span>}
                </div>
                {location.notes && (
                  <div className="mt-1.5 text-[11px] text-text-tertiary whitespace-pre-wrap">{location.notes}</div>
                )}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <button
                    onClick={() => { setEditingLocation(location); setShowForm(true); }}
                    className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(location)}
                    className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors ml-auto"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-text-tertiary">
        共 {locations.length} 个驻地
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showForm && (
          <LocationForm
            location={editingLocation}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingLocation(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 驻地表单（新建 / 编辑，code 创建后不可修改） ───

function LocationForm({
  location,
  onSave,
  onClose,
}: {
  location: QCLocation | null;
  onSave: (input: QCLocationInput, id?: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(location?.code ?? '');
  const [name, setName] = useState(location?.name ?? '');
  const [region, setRegion] = useState(location?.region ?? '');
  const [focus, setFocus] = useState(location?.focus ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [notes, setNotes] = useState(location?.notes ?? '');

  const handleSubmit = () => {
    if (!location && !code.trim()) {
      alert('驻地代码必填');
      return;
    }
    if (!name.trim()) {
      alert('驻地名称必填');
      return;
    }
    onSave({
      code: code.trim(),
      name: name.trim(),
      region: region.trim() || null,
      focus: focus || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    }, location?.id);
  };

  return (
    <ModalShell title={location ? `编辑驻地 ${location.name}` : '新建驻地'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="驻地代码 *">
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="wenzhou"
            disabled={!!location}
          />
          {!location && (
            <div className="text-[11px] text-text-tertiary mt-1">如 wenzhou / suzhou，创建后不可修改</div>
          )}
        </Field>
        <Field label="驻地名称 *">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="温州驻场" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="区域">
          <input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="浙江 · 温州" />
        </Field>
        <Field label="主攻业务线">
          <select className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">通用</option>
            <option value="garment">服装</option>
            <option value="fabric">面料</option>
          </select>
        </Field>
      </div>
      <Field label="地址">
        <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label="备注">
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 业务线 Panel ====================

function BusinessLinesPanel({ isDarkMode }: { isDarkMode?: boolean }) {
  const [lines, setLines] = useState<BusinessLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLine, setEditingLine] = useState<BusinessLine | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadLines = useCallback(async () => {
    setLoading(true);
    try {
      setLines(await apiService.listBusinessLines());
    } catch (e) {
      console.error('[QcWorkbenchManager] listBusinessLines failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLines();
  }, [loadLines]);

  const handleSave = async (input: BusinessLineInput | BusinessLinePatch, id?: string) => {
    try {
      if (id) {
        await apiService.updateBusinessLine(id, input as BusinessLinePatch);
      } else {
        await apiService.createBusinessLine(input as BusinessLineInput);
      }
      setShowForm(false);
      setEditingLine(null);
      await loadLines();
    } catch (e: any) {
      alert(`保存业务线失败：${e?.message || e}`);
    }
  };

  const handleToggleActive = async (line: BusinessLine) => {
    setTogglingId(line.id);
    try {
      await apiService.updateBusinessLine(line.id, { isActive: !line.isActive });
      await loadLines();
    } catch (e: any) {
      alert(`更新业务线状态失败：${e?.message || e}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (line: BusinessLine) => {
    if (!confirm(`确认删除业务线「${line.code} ${line.name}」？`)) return;
    try {
      await apiService.deleteBusinessLine(line.id);
      await loadLines();
    } catch (e: any) {
      // 后端拒绝（如仍有订单引用）时直接展示后端错误消息
      alert(`删除失败：${e?.message || e}`);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
      {/* 表头说明 + 操作条 */}
      <div className="p-3 border-b border-border-subtle flex items-center gap-2">
        <span className="text-[11px] text-text-tertiary">业务线影响 MOQ 校验与报表口径</span>
        <button
          onClick={loadLines}
          className="p-1 rounded-control hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setEditingLine(null); setShowForm(true); }}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          新建业务线
        </button>
      </div>

      {/* 规则表格 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
        </div>
      ) : lines.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary px-4">
          <Layers className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm text-center">暂无业务线，点击「新建业务线」配置 MOQ 与生产周期基准</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-[0.8fr_1.2fr_1fr_0.9fr_1.1fr_0.7fr_auto] gap-2 px-4 py-2 border-b border-border-subtle text-[11px] text-text-tertiary sticky top-0 bg-surface-primary">
            <span>代码</span>
            <span>名称</span>
            <span>MOQ</span>
            <span>生产周期</span>
            <span>付款条件</span>
            <span>启用</span>
            <span className="text-right">操作</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {lines.map((line) => (
              <div key={line.id} className="grid grid-cols-[0.8fr_1.2fr_1fr_0.9fr_1.1fr_0.7fr_auto] gap-2 px-4 py-2.5 items-center">
                <span className="text-sm text-text-primary font-medium truncate">{line.code}</span>
                <span className="text-sm text-text-secondary truncate" title={line.description || undefined}>{line.name}</span>
                <span className="text-sm text-text-secondary">
                  {line.moqValue != null ? `${formatNumber(line.moqValue)} ${line.moqUnit || ''}`.trim() : '—'}
                </span>
                <span className="text-sm text-text-secondary">
                  {line.productionCycleDays != null ? `${line.productionCycleDays} 天` : '—'}
                </span>
                <span className="text-xs text-text-tertiary truncate" title={line.paymentTermsHint || undefined}>
                  {line.paymentTermsHint || '—'}
                </span>
                <span>
                  <button
                    onClick={() => handleToggleActive(line)}
                    disabled={togglingId === line.id}
                    className={`text-[10px] px-1.5 py-0.5 rounded-control border transition-all disabled:opacity-50 ${statusSemanticClass(line.isActive ? 'success' : 'neutral', isDarkMode)}`}
                    title={line.isActive ? '点击停用' : '点击启用'}
                  >
                    {togglingId === line.id ? '...' : line.isActive ? '启用中' : '已停用'}
                  </button>
                </span>
                <span className="flex items-center gap-0.5 justify-end">
                  <button
                    onClick={() => { setEditingLine(line); setShowForm(true); }}
                    className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(line)}
                    className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-text-tertiary">
        共 {lines.length} 条业务线
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showForm && (
          <BusinessLineForm
            line={editingLine}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingLine(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 业务线表单（新建 / 编辑，code 创建后不可修改） ───

function BusinessLineForm({
  line,
  onSave,
  onClose,
}: {
  line: BusinessLine | null;
  onSave: (input: BusinessLineInput | BusinessLinePatch, id?: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(line?.code ?? '');
  const [name, setName] = useState(line?.name ?? '');
  const [description, setDescription] = useState(line?.description ?? '');
  const [moqValue, setMoqValue] = useState(line?.moqValue?.toString() ?? '');
  const [moqUnit, setMoqUnit] = useState(line?.moqUnit ?? 'M');
  const [productionCycleDays, setProductionCycleDays] = useState(line?.productionCycleDays?.toString() ?? '');
  const [paymentTermsHint, setPaymentTermsHint] = useState(line?.paymentTermsHint ?? '');
  const [sortOrder, setSortOrder] = useState(line?.sortOrder?.toString() ?? '0');

  const handleSubmit = () => {
    if (!line && !code.trim()) {
      alert('业务线代码必填');
      return;
    }
    if (!name.trim()) {
      alert('业务线名称必填');
      return;
    }
    if (moqValue && !(Number(moqValue) >= 0)) {
      alert('MOQ 需为不小于 0 的数字');
      return;
    }
    if (productionCycleDays && !(Number(productionCycleDays) >= 0)) {
      alert('生产周期需为不小于 0 的天数');
      return;
    }
    const base = {
      name: name.trim(),
      description: description.trim() || null,
      moqValue: moqValue ? Number(moqValue) : null,
      moqUnit: moqUnit || null,
      productionCycleDays: productionCycleDays ? Number(productionCycleDays) : null,
      paymentTermsHint: paymentTermsHint.trim() || null,
    };
    if (line) {
      onSave(base, line.id);
    } else {
      onSave({
        ...base,
        code: code.trim(),
        sortOrder: sortOrder ? Number(sortOrder) : 0,
      });
    }
  };

  return (
    <ModalShell title={line ? `编辑业务线 ${line.code}` : '新建业务线'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="业务线代码 *">
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="fabric"
            disabled={!!line}
          />
          {!line && (
            <div className="text-[11px] text-text-tertiary mt-1">如 fabric / garment / capsule，创建后不可修改</div>
          )}
        </Field>
        <Field label="业务线名称 *">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="面料大货" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="MOQ 基准">
          <input type="number" min={0} className={inputClass} value={moqValue} onChange={(e) => setMoqValue(e.target.value)} placeholder="如 1000" />
        </Field>
        <Field label="MOQ 单位">
          <select className={inputClass} value={moqUnit} onChange={(e) => setMoqUnit(e.target.value)}>
            {MOQ_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="生产周期（天）">
          <input type="number" min={0} className={inputClass} value={productionCycleDays} onChange={(e) => setProductionCycleDays(e.target.value)} placeholder="如 70" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="付款条件提示">
          <input className={inputClass} value={paymentTermsHint} onChange={(e) => setPaymentTermsHint(e.target.value)} placeholder="如 T/T 30 天" />
        </Field>
        {!line && (
          <Field label="排序">
            <input type="number" className={inputClass} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="描述">
        <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}
