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
 *   - BDS v2.1：视觉层已迁移至 bds 组件族（bds-tabs/bds-card/bds-badge/bds-input/bds-modal 等），
 *     状态徽章走语义变体映射（主题透明，无 isDarkMode 样式分支），暗色由 tokens.css 统一覆盖
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

// BDS v2.1：状态 → bds-badge 语义变体（主题透明，替代 statusSemanticClass 拼装）
const QC_STATUS_BADGE_VARIANT: Record<QCAssignmentStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  Assigned: 'info',
  InProgress: 'warning',
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

// ==================== 共享表单原语 ====================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
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
      className="bds-modal-mask"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bds-modal"
        style={{ width: '32rem', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="bds-text-lg" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} className="bds-btn bds-btn-ghost bds-btn-icon" title="关闭">
            <X size={16} />
          </button>
        </div>
        {children}
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
      <div className="bds-tabs px-7 shrink-0">
        {MODULE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`bds-tab flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} />
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
            {activeTab === 'assignments' && <AssignmentsPanel />}
            {activeTab === 'locations' && <LocationsPanel />}
            {activeTab === 'businessLines' && <BusinessLinesPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 验货任务 Panel ====================

function AssignmentsPanel() {
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
      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>QC 人员</span>
        <select
          value={qcUserFilter}
          onChange={(e) => setQcUserFilter(e.target.value)}
          className="bds-select"
          style={{ width: 'auto', height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}
        >
          <option value="">全部</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName}</option>
          ))}
        </select>
        {usersLoadFailed && (
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>人员列表需管理角色权限，当前仅支持查看全部任务</span>
        )}
        <button
          onClick={loadWorkbench}
          className="bds-btn bds-btn-ghost"
          style={{ padding: '0 var(--space-2)' }}
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>共 {totalCount} 项任务</span>
        <button
          onClick={() => setShowForm(true)}
          className="ml-auto bds-btn bds-btn-primary"
        >
          <Plus size={14} />
          <span>新建任务</span>
        </button>
      </div>

      {/* 看板三列 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
        </div>
      ) : totalCount === 0 ? (
        <div className="bds-empty flex-1 justify-center">
          <div className="glyph"><ClipboardCheck size={24} /></div>
          <div className="title">
            {qcUserFilter ? '该 QC 人员暂无验货任务' : '暂无验货任务，点击「新建任务」开始分配'}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
          {columns.map((col) => (
            <div key={col.status} className="bds-card flex flex-col min-h-0" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: 'var(--border-subtle)' }}>
                <span className={`bds-badge sm ${QC_STATUS_BADGE_VARIANT[col.status]}`}>
                  {QC_STATUS_LABELS[col.status]}
                </span>
                <span className="text-[11px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>{col.items.length} 项</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {col.items.length === 0 ? (
                  <div className="bds-card flat text-center text-xs" style={{ padding: 'var(--space-8) var(--space-4)', color: 'var(--text-tertiary)' }}>
                    暂无{QC_STATUS_LABELS[col.status]}任务
                  </div>
                ) : (
                  col.items.map((a) => {
                    const overdue = isOverdue(a);
                    const canOperate = a.status === 'Assigned' || a.status === 'InProgress';
                    return (
                      <div key={a.id} className="bds-card flat" style={{ padding: 'var(--space-3)' }}>
                        <div className="flex items-center gap-2">
                          <span className="bds-mono text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                            {a.order?.poNumber || a.orderId}
                          </span>
                          <span className="bds-badge sm info shrink-0">
                            {INSPECTION_TYPE_LABELS[a.inspectionType] || a.inspectionType}
                          </span>
                          <span className={`bds-badge sm shrink-0 ${QC_STATUS_BADGE_VARIANT[a.status] ?? 'neutral'}`}>
                            {QC_STATUS_LABELS[a.status] || a.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                          {a.order ? `${a.order.customer} · ${a.order.product}` : a.orderId}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                          <span className={overdue ? 'bds-badge sm danger' : ''}>
                            要求 {formatDate(a.dueDate)}{overdue ? '（已过期）' : ''}
                          </span>
                          {a.location?.name && (
                            <span className="flex items-center gap-0.5 truncate">
                              <MapPin size={12} className="shrink-0" />
                              {a.location.name}
                            </span>
                          )}
                          <span className="truncate">{userNameById.get(a.qcUserId) ?? a.qcUserId}</span>
                        </div>
                        {a.status === 'Completed' && a.completedAt != null && (
                          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            完成于 {formatTs(a.completedAt)}{a.reportId ? ` · 报告 ${a.reportId}` : ''}
                          </div>
                        )}
                        {a.notes && (
                          <div className="mt-1.5 text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-tertiary)' }}>{a.notes}</div>
                        )}
                        <div className="mt-2 flex items-center gap-1.5">
                          {a.status === 'Assigned' && (
                            <button onClick={() => handleStart(a)} disabled={updatingId === a.id} className="bds-btn bds-btn-primary">
                              {updatingId === a.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                              <span>开始</span>
                            </button>
                          )}
                          {canOperate && (
                            <button onClick={() => setCompletingAssignment(a)} disabled={updatingId === a.id} className="bds-btn bds-btn-secondary">
                              <CheckCheck size={14} />
                              <span>完成</span>
                            </button>
                          )}
                          {canOperate && (
                            <button onClick={() => handleCancel(a)} disabled={updatingId === a.id} className="bds-btn bds-btn-ghost">
                              <Ban size={14} />
                              <span>取消</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(a)}
                            className="bds-btn bds-btn-ghost bds-btn-icon ml-auto"
                            title="删除任务"
                          >
                            <Trash2 size={14} />
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
          <div className="bds-card flat flex items-center gap-2" style={{ padding: 'var(--space-2) var(--space-3)' }}>
            <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>
              {selectedOrder.poNumber || selectedOrder.id} · {selectedOrder.customer} · {selectedOrder.product}
            </span>
            <button
              onClick={() => setSelectedOrder(null)}
              className="bds-btn bds-btn-ghost bds-btn-icon shrink-0"
              title="重新选择"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
              <input
                type="text"
                placeholder="搜索 PO 号 / 客户 / 产品..."
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                className="bds-input sm pl-9"
              />
              {ordersLoading && (
                <Loader2 size={12} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              )}
            </div>
            {filteredOrders.length > 0 && (
              <div className="bds-card flat mt-1.5 max-h-40 overflow-y-auto" style={{ padding: 'var(--space-1)' }}>
                <div className="bds-listrows">
                  {filteredOrders.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => { setSelectedOrder(o); setOrderQuery(''); }}
                      className="bds-listrow w-full text-left"
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <span className="lr-main bds-mono text-xs" style={{ color: 'var(--text-primary)' }}>{o.poNumber || o.id}</span>
                      <span className="lr-sub truncate shrink-0">{o.customer} · {o.product}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!ordersLoading && orders.length === 0 && (
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>暂无可选订单，请先在「订单管理」创建订单</div>
            )}
          </>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="验货类型 *">
          <select className="bds-select" value={inspectionType} onChange={(e) => setInspectionType(e.target.value as QCInspectionType)}>
            {(Object.keys(INSPECTION_TYPE_LABELS) as QCInspectionType[]).map((t) => (
              <option key={t} value={t}>{INSPECTION_TYPE_LABELS[t]}验货</option>
            ))}
          </select>
        </Field>
        <Field label="执行 QC *">
          {users.length > 0 ? (
            <select className="bds-select" value={qcUserId} onChange={(e) => setQcUserId(e.target.value)}>
              <option value="">选择 QC 人员...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}{u.department ? `（${u.department}）` : ''}</option>
              ))}
            </select>
          ) : (
            <input
              className="bds-input"
              value={qcUserId}
              onChange={(e) => setQcUserId(e.target.value)}
              placeholder={usersLoadFailed ? '人员列表不可用，请输入 QC 用户 ID' : '输入 QC 用户 ID'}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="所属驻地">
          <select className="bds-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">不指定驻地</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
        <Field label="要求完成日期">
          <input type="date" className="bds-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field label="备注">
        <textarea className="bds-input bds-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">
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
      <div className="bds-card flat mb-3 text-xs" style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-tertiary)' }}>
        {INSPECTION_TYPE_LABELS[assignment.inspectionType] || assignment.inspectionType}验货 · {assignment.order ? `${assignment.order.customer} · ${assignment.order.product}` : assignment.orderId}
      </div>
      <Field label="验货报告 ID">
        <input
          className="bds-input"
          value={reportId}
          onChange={(e) => setReportId(e.target.value)}
          placeholder="可选，完成后关联 InspectionReport"
        />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={() => onSave(reportId.trim() || undefined)}
          disabled={saving}
          className="bds-btn bds-btn-primary"
        >
          {saving ? '提交中...' : '确认完成'}
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 驻地管理 Panel ====================

function LocationsPanel() {
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
    <div className="bds-card h-full flex flex-col min-h-0" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 操作条 */}
      <div className="p-3 flex items-center gap-2" style={{ borderBottom: 'var(--border-subtle)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>QC 常驻验货驻地（如 温州驻场-服装 / 苏州驻场-面料）</span>
        <button
          onClick={loadLocations}
          className="bds-btn bds-btn-ghost"
          style={{ padding: '0 var(--space-2)' }}
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => { setEditingLocation(null); setShowForm(true); }}
          className="ml-auto bds-btn bds-btn-primary"
        >
          <Plus size={14} />
          <span>新建驻地</span>
        </button>
      </div>

      {/* 驻地卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : locations.length === 0 ? (
          <div className="bds-empty">
            <div className="glyph"><MapPin size={24} /></div>
            <div className="title">暂无驻地，点击「新建驻地」配置 QC 常驻验货点</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {locations.map((location) => (
              <div key={location.id} className="bds-card flat">
                <div className="flex items-center gap-2">
                  <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>{location.name}</span>
                  <span className="bds-badge sm neutral shrink-0">
                    {location.code}
                  </span>
                  {location.focus && (
                    <span className="bds-badge sm info shrink-0">
                      {LOCATION_FOCUS_LABELS[location.focus] || location.focus}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                  {location.region && <span>区域 {location.region}</span>}
                  {location.address && <span className="truncate">地址 {location.address}</span>}
                </div>
                {location.notes && (
                  <div className="mt-1.5 text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-tertiary)' }}>{location.notes}</div>
                )}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <button
                    onClick={() => { setEditingLocation(location); setShowForm(true); }}
                    className="bds-btn bds-btn-ghost bds-btn-icon"
                    title="编辑"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(location)}
                    className="bds-btn bds-btn-ghost bds-btn-icon ml-auto"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-2 text-[11px]" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
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
            className="bds-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="wenzhou"
            disabled={!!location}
          />
          {!location && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>如 wenzhou / suzhou，创建后不可修改</div>
          )}
        </Field>
        <Field label="驻地名称 *">
          <input className="bds-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="温州驻场" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="区域">
          <input className="bds-input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="浙江 · 温州" />
        </Field>
        <Field label="主攻业务线">
          <select className="bds-select" value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">通用</option>
            <option value="garment">服装</option>
            <option value="fabric">面料</option>
          </select>
        </Field>
      </div>
      <Field label="地址">
        <input className="bds-input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label="备注">
        <textarea className="bds-input bds-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 业务线 Panel ====================

function BusinessLinesPanel() {
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
    <div className="bds-card h-full flex flex-col min-h-0" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 表头说明 + 操作条 */}
      <div className="p-3 flex items-center gap-2" style={{ borderBottom: 'var(--border-subtle)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>业务线影响 MOQ 校验与报表口径</span>
        <button
          onClick={loadLines}
          className="bds-btn bds-btn-ghost"
          style={{ padding: '0 var(--space-2)' }}
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => { setEditingLine(null); setShowForm(true); }}
          className="ml-auto bds-btn bds-btn-primary"
        >
          <Plus size={14} />
          <span>新建业务线</span>
        </button>
      </div>

      {/* 规则表格 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
        </div>
      ) : lines.length === 0 ? (
        <div className="bds-empty flex-1 justify-center">
          <div className="glyph"><Layers size={24} /></div>
          <div className="title">暂无业务线，点击「新建业务线」配置 MOQ 与生产周期基准</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="bds-table">
            <thead className="sticky top-0" style={{ background: 'var(--bg-card)' }}>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th className="num">MOQ</th>
                <th className="num">生产周期</th>
                <th>付款条件</th>
                <th>启用</th>
                <th className="num">操作</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td><span className="bds-mono" style={{ color: 'var(--text-primary)' }}>{line.code}</span></td>
                  <td style={{ color: 'var(--text-secondary)', maxWidth: '14rem' }}>
                    <span className="block truncate" title={line.description || undefined}>{line.name}</span>
                  </td>
                  <td className="num" style={{ color: 'var(--text-secondary)' }}>
                    {line.moqValue != null ? `${formatNumber(line.moqValue)} ${line.moqUnit || ''}`.trim() : '—'}
                  </td>
                  <td className="num" style={{ color: 'var(--text-secondary)' }}>
                    {line.productionCycleDays != null ? `${line.productionCycleDays} 天` : '—'}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--text-tertiary)', maxWidth: '12rem' }}>
                    <span className="block truncate" title={line.paymentTermsHint || undefined}>{line.paymentTermsHint || '—'}</span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleToggleActive(line)}
                      disabled={togglingId === line.id}
                      className={`bds-badge sm ${line.isActive ? 'success' : 'neutral'}`}
                      style={{ cursor: 'pointer', border: 'none', opacity: togglingId === line.id ? 0.5 : 1 }}
                      title={line.isActive ? '点击停用' : '点击启用'}
                    >
                      {togglingId === line.id ? '...' : line.isActive ? '启用中' : '已停用'}
                    </button>
                  </td>
                  <td className="num">
                    <span className="flex items-center gap-0.5 justify-end">
                      <button
                        onClick={() => { setEditingLine(line); setShowForm(true); }}
                        className="bds-btn bds-btn-ghost bds-btn-icon"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(line)}
                        className="bds-btn bds-btn-ghost bds-btn-icon"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 py-2 text-[11px]" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
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
            className="bds-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="fabric"
            disabled={!!line}
          />
          {!line && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>如 fabric / garment / capsule，创建后不可修改</div>
          )}
        </Field>
        <Field label="业务线名称 *">
          <input className="bds-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="面料大货" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="MOQ 基准">
          <input type="number" min={0} className="bds-input" value={moqValue} onChange={(e) => setMoqValue(e.target.value)} placeholder="如 1000" />
        </Field>
        <Field label="MOQ 单位">
          <select className="bds-select" value={moqUnit} onChange={(e) => setMoqUnit(e.target.value)}>
            {MOQ_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="生产周期（天）">
          <input type="number" min={0} className="bds-input" value={productionCycleDays} onChange={(e) => setProductionCycleDays(e.target.value)} placeholder="如 70" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="付款条件提示">
          <input className="bds-input" value={paymentTermsHint} onChange={(e) => setPaymentTermsHint(e.target.value)} placeholder="如 T/T 30 天" />
        </Field>
        {!line && (
          <Field label="排序">
            <input type="number" className="bds-input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="描述">
        <textarea className="bds-input bds-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">
          保存
        </button>
      </div>
    </ModalShell>
  );
}
