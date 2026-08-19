/**
 * QC 工作台 QcWorkbenchManager
 * 阶段 P0：QC 工作台 + 驻地管理 + 业务线配置前端
 *
 * 功能：
 *   1. 验货任务 Assignments — QC 人员筛选 / 看板三列（Assigned / InProgress / Completed）/
 *      开始·完成（可关联验货报告）·取消·删除 / 新建任务（订单搜索选择器）
 *   2. 双链评审 Sample Chains（DR-029）— 服装链（工厂→QC→业务员→客户，DR-008 内部门禁
 *      查询 + 评审/直接打回）与面料链（业务员→QC→工厂→业务员，样品级评审 + 工厂技术调整
 *      要求）严格隔离；链报告列表展示双签状态并支持 QC/业务签署
 *   3. 驻地管理 Locations — 驻地卡片 CRUD（删除被任务引用时展示后端拒绝原因）
 *   4. 业务线 Business Lines — 业务线规则表（MOQ / 生产周期 / 付款条件 / 启停开关）CRUD
 *
 * 设计原则：
 *   - 任务看板数据来自服务端聚合 /qc/workbench，订单信息为服务端快照，前端只读展示
 *   - QC 人员选择器复用 /api/hr/personnel（owner/admin），无权限时降级为手工录入 qcUserId
 *   - BDS v2.1：视觉层已迁移至 bds 组件族（bds-tabs/bds-card/bds-badge/bds-input/bds-modal 等），
 *     状态徽章走语义变体映射（主题透明，无 isDarkMode 样式分支），暗色由 tokens.css 统一覆盖
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  ShieldCheck,
  PenLine,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  qcService,
  CHAIN_CONCLUSION_LABELS,
  CHAIN_DISPOSITION_LABELS,
  type GarmentSampleGate,
  type QcInspectionReport,
  type GarmentQcSampleLevel,
  type FabricQcSampleKind,
  type ReportSignRole,
} from '../services/qcService';
import {
  sampleService,
  FABRIC_SAMPLE_STATUS_LABELS,
  EARLY_PRODUCTION_STATUS_LABELS,
} from '../services/sampleService';
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
import CapsuleDateInput from './ui/CapsuleDateInput';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';

// ==================== 常量 ====================

type ModuleTab = 'assignments' | 'sampleChains' | 'locations' | 'businessLines';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'assignments', label: '验货任务 Assignments', icon: ClipboardCheck },
  { id: 'sampleChains', label: '双链评审 Sample Chains', icon: ShieldCheck },
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
  // 主操作上收 PageHeader（H2 裁决）：当前 Panel mount 时注册其「新建」触发器，卸载注销。
  // Panel 切换即重挂载，ref 始终指向当前 tab 的新建动作；form state 保留在 Panel 内不搬动。
  const newActionRef = useRef<(() => void) | null>(null);
  const registerNewAction = useCallback((fn: (() => void) | null) => {
    newActionRef.current = fn;
  }, []);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="QC 工作台"
        subtitle="QC Workbench"
        actions={
          activeTab !== 'sampleChains' ? (
            <button onClick={() => newActionRef.current?.()} className="bds-btn bds-btn-primary">
              <Plus size={14} />
              <span>{activeTab === 'locations' ? '新建驻地' : activeTab === 'businessLines' ? '新建业务线' : '新建任务'}</span>
            </button>
          ) : undefined
        }
      />

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
            {activeTab === 'assignments' && <AssignmentsPanel registerNewAction={registerNewAction} />}
            {activeTab === 'sampleChains' && <SampleChainsPanel registerNewAction={registerNewAction} />}
            {activeTab === 'locations' && <LocationsPanel registerNewAction={registerNewAction} />}
            {activeTab === 'businessLines' && <BusinessLinesPanel registerNewAction={registerNewAction} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 验货任务 Panel ====================

function AssignmentsPanel({ registerNewAction }: { registerNewAction: (fn: (() => void) | null) => void }) {
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

  // 主操作上收 PageHeader：注册「新建任务」触发器（Panel 卸载即注销）
  useEffect(() => {
    registerNewAction(() => setShowForm(true));
    return () => registerNewAction(null);
  }, [registerNewAction]);

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
      bdsToast.danger(`开始任务失败：${e?.message || e}`);
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
      bdsToast.danger(`完成任务失败：${e?.message || e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCancel = async (a: QCAssignment) => {
    const label = a.order?.poNumber || a.orderId;
    if (!(await bdsConfirm({ title: '确认取消', body: `确认取消订单「${label}」的${INSPECTION_TYPE_LABELS[a.inspectionType] || ''}验货任务？` }))) return;
    setUpdatingId(a.id);
    try {
      await apiService.cancelQcAssignment(a.id);
      await loadWorkbench();
    } catch (e: any) {
      bdsToast.danger(`取消任务失败：${e?.message || e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (a: QCAssignment) => {
    const label = a.order?.poNumber || a.orderId;
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除订单「${label}」的验货任务？该操作不可恢复。`, danger: true }))) return;
    try {
      await apiService.deleteQcAssignment(a.id);
      await loadWorkbench();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message || e}`);
    }
  };

  const handleCreate = async (input: QCAssignmentInput) => {
    try {
      await apiService.createQcAssignment(input);
      setShowForm(false);
      await loadWorkbench();
    } catch (e: any) {
      bdsToast.danger(`新建验货任务失败：${e?.message || e}`);
    }
  };

  const columns: Array<{ status: QCAssignmentStatus; items: QCAssignment[] }> = [
    { status: 'Assigned', items: workbench.assigned },
    { status: 'InProgress', items: workbench.inProgress },
    { status: 'Completed', items: workbench.completed },
  ];

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      {/* 操作条：QC 人员筛选 + 刷新 + 新建（bds-filterbar：内控 40px 等高 + pill 同形） */}
      <div className="shrink-0 bds-filterbar flex-wrap">
        <span className="text-[11px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>QC 人员</span>
        <select
          className="bds-select"
          value={qcUserFilter}
          onChange={(e) => setQcUserFilter(e.target.value)}
          style={{ width: 'auto', fontSize: 'var(--text-xs)' }}
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
                              <MapPin size={14} className="shrink-0" />
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
                            <button onClick={() => handleStart(a)} disabled={updatingId === a.id} className="bds-btn bds-btn-secondary">
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
      bdsToast.warning('请搜索并选择订单');
      return;
    }
    if (!qcUserId.trim()) {
      bdsToast.warning('请选择执行 QC');
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
                <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
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
          <CapsuleDateInput className="bds-input" value={dueDate} onChange={setDueDate} />
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

function LocationsPanel({ registerNewAction }: { registerNewAction: (fn: (() => void) | null) => void }) {
  const [locations, setLocations] = useState<QCLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<QCLocation | null>(null);

  // 主操作上收 PageHeader：注册「新建驻地」触发器（Panel 卸载即注销）
  useEffect(() => {
    registerNewAction(() => { setEditingLocation(null); setShowForm(true); });
    return () => registerNewAction(null);
  }, [registerNewAction]);

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
      bdsToast.danger(`保存驻地失败：${e?.message || e}`);
    }
  };

  const handleDelete = async (location: QCLocation) => {
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除驻地「${location.name}」？`, danger: true }))) return;
    try {
      await apiService.deleteQcLocation(location.id);
      await loadLocations();
    } catch (e: any) {
      // 后端拒绝（如仍有验货任务引用）时直接展示后端错误消息
      bdsToast.danger(`删除失败：${e?.message || e}`);
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
      bdsToast.warning('驻地代码必填');
      return;
    }
    if (!name.trim()) {
      bdsToast.warning('驻地名称必填');
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

function BusinessLinesPanel({ registerNewAction }: { registerNewAction: (fn: (() => void) | null) => void }) {
  const [lines, setLines] = useState<BusinessLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLine, setEditingLine] = useState<BusinessLine | null>(null);

  // 主操作上收 PageHeader：注册「新建业务线」触发器（Panel 卸载即注销）
  useEffect(() => {
    registerNewAction(() => { setEditingLine(null); setShowForm(true); });
    return () => registerNewAction(null);
  }, [registerNewAction]);
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
      bdsToast.danger(`保存业务线失败：${e?.message || e}`);
    }
  };

  const handleToggleActive = async (line: BusinessLine) => {
    setTogglingId(line.id);
    try {
      await apiService.updateBusinessLine(line.id, { isActive: !line.isActive });
      await loadLines();
    } catch (e: any) {
      bdsToast.danger(`更新业务线状态失败：${e?.message || e}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (line: BusinessLine) => {
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除业务线「${line.code} ${line.name}」？`, danger: true }))) return;
    try {
      await apiService.deleteBusinessLine(line.id);
      await loadLines();
    } catch (e: any) {
      // 后端拒绝（如仍有订单引用）时直接展示后端错误消息
      bdsToast.danger(`删除失败：${e?.message || e}`);
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
      bdsToast.warning('业务线代码必填');
      return;
    }
    if (!name.trim()) {
      bdsToast.warning('业务线名称必填');
      return;
    }
    if (moqValue && !(Number(moqValue) >= 0)) {
      bdsToast.warning('MOQ 需为不小于 0 的数字');
      return;
    }
    if (productionCycleDays && !(Number(productionCycleDays) >= 0)) {
      bdsToast.warning('生产周期需为不小于 0 的天数');
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

// ==================== 双链评审 Sample Chains（DR-029 服装链 / 面料链严格隔离） ====================

type ChainId = 'garment' | 'fabric';

const CHAIN_LABELS: Record<ChainId, string> = {
  garment: '服装链 Garment',
  fabric: '面料链 Fabric',
};

const CHAIN_FLOW_HINTS: Record<ChainId, string> = {
  garment: '工厂 → QC → 业务员 → 客户',
  fabric: '业务员 → QC → 工厂 → 业务员',
};

const GARMENT_SAMPLE_LEVEL_LABELS: Record<GarmentQcSampleLevel, string> = {
  pp: 'PP 产前样',
  top: 'TOP 头样',
};

const FABRIC_SAMPLE_KIND_LABELS: Record<FabricQcSampleKind, string> = {
  SS: 'S/S 船样',
  RC: 'RC 匹头样',
  EARLY_PRODUCTION: '早期生产样',
};

/** 链报告 inspectionType 解析出的 sampleKind（小写）→ 展示名 */
const SAMPLE_KIND_LABELS: Record<string, string> = {
  pp: 'PP 产前样',
  top: 'TOP 头样',
  ss: 'S/S 船样',
  rc: 'RC 匹头样',
  early_production: '早期生产样',
};

const REPORT_RESULT_BADGE_VARIANT: Record<string, 'neutral' | 'success' | 'danger' | 'warning'> = {
  pass: 'success',
  conditional: 'warning',
  fail: 'danger',
};

/** 镜像后端 isGarmentChainOrder / isFabricChainOrder（server/src/qc/qcChainService.ts 口径） */
function resolveOrderChain(order: Order): ChainId | null {
  const line = String(order.businessLine ?? '').toLowerCase();
  const type = String(order.type ?? '').toLowerCase();
  if (line === 'garment' || line === 'capsule' || type === 'garment') return 'garment';
  if (line === 'fabric' || type === 'fabric') return 'fabric';
  return null;
}

function SampleChainsPanel({ registerNewAction }: { registerNewAction: (fn: (() => void) | null) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersLoadFailed, setOrdersLoadFailed] = useState(false);
  const [orderQuery, setOrderQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // 双链评审无主操作（PageHeader 不渲染新建按钮），显式注销避免悬空引用
  useEffect(() => {
    registerNewAction(null);
    return () => registerNewAction(null);
  }, [registerNewAction]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersLoadFailed(false);
    try {
      const list = await apiService.listOrders();
      setOrders(list.filter((o) => !o.deletedAt));
    } catch (e) {
      console.error('[QcWorkbenchManager] sampleChains load orders failed', e);
      setOrders([]);
      setOrdersLoadFailed(true);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

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

  const chain = selectedOrder ? resolveOrderChain(selectedOrder) : null;

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      {/* 订单选择条（链路由：按订单 type / businessLine 判定服装链或面料链） */}
      <div className="shrink-0 bds-card flat" style={{ padding: 'var(--space-3)' }}>
        {selectedOrder ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bds-mono text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {selectedOrder.poNumber || selectedOrder.id}
            </span>
            <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              {selectedOrder.customer} · {selectedOrder.product}
            </span>
            {chain ? (
              <span className={`bds-badge sm shrink-0 ${chain === 'garment' ? 'info' : 'warning'}`}>
                {CHAIN_LABELS[chain]}
              </span>
            ) : (
              <span className="bds-badge sm neutral shrink-0">非双链订单</span>
            )}
            <button
              onClick={() => setSelectedOrder(null)}
              className="bds-btn bds-btn-ghost bds-btn-icon ml-auto shrink-0"
              title="重新选择订单"
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
                <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
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
            {!ordersLoading && ordersLoadFailed && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>订单列表加载失败</span>
                <button onClick={loadOrders} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="重试">
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
            {!ordersLoading && !ordersLoadFailed && orders.length === 0 && (
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>暂无可选订单，请先在「订单管理」创建订单</div>
            )}
          </>
        )}
      </div>

      {/* 链视图（服装链 / 面料链严格隔离，按订单路由渲染，绝不混排） */}
      {!selectedOrder ? (
        <div className="bds-empty flex-1 justify-center">
          <div className="glyph"><ShieldCheck size={24} /></div>
          <div className="title">搜索并选择订单后，系统按订单类型路由到服装链或面料链评审台</div>
        </div>
      ) : !chain ? (
        <div className="bds-empty flex-1 justify-center">
          <div className="glyph"><Ban size={24} /></div>
          <div className="title">
            该订单不属于服装链或面料链（type={selectedOrder.type || '—'}），双链样品评审不适用
          </div>
        </div>
      ) : chain === 'garment' ? (
        <GarmentChainView key={selectedOrder.id} order={selectedOrder} />
      ) : (
        <FabricChainView key={selectedOrder.id} order={selectedOrder} />
      )}
    </div>
  );
}

// ─── 服装链视图（DR-008 内部门禁 + DR-029 评审 / QC-29-A4 直接打回） ───

function GarmentChainView({ order }: { order: Order }) {
  const [sampleLevel, setSampleLevel] = useState<GarmentQcSampleLevel>('pp');
  const [round, setRound] = useState('1');
  const [gate, setGate] = useState<GarmentSampleGate | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [conclusion, setConclusion] = useState<'pass' | 'conditional' | 'fail'>('pass');
  const [opinion, setOpinion] = useState('');
  const [criticalDefects, setCriticalDefects] = useState('0');
  const [majorDefects, setMajorDefects] = useState('0');
  const [minorDefects, setMinorDefects] = useState('0');
  const [defectSummary, setDefectSummary] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [directReject, setDirectReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reportsReloadKey, setReportsReloadKey] = useState(0);

  const roundNum = Number(round);

  const loadGate = useCallback(async () => {
    if (!Number.isInteger(roundNum) || roundNum < 1) {
      setGate(null);
      setGateError(null);
      return;
    }
    setGateLoading(true);
    setGateError(null);
    try {
      setGate(await qcService.getGarmentSampleGate(order.id, { sampleLevel, round: roundNum }));
    } catch (e: any) {
      setGate(null);
      setGateError(e?.message || String(e));
    } finally {
      setGateLoading(false);
    }
  }, [order.id, sampleLevel, roundNum]);

  useEffect(() => {
    loadGate();
  }, [loadGate]);

  const handleSubmit = async () => {
    if (!Number.isInteger(roundNum) || roundNum < 1) {
      bdsToast.warning('轮次必须是 >=1 的整数');
      return;
    }
    if (!opinion.trim()) {
      bdsToast.warning('请填写 QC 文本评审意见（DR-029：评审结论不得压缩为机械二值）');
      return;
    }
    if (directReject && !rejectReason.trim()) {
      bdsToast.warning('直接打回工厂重做必须填写打回原因（QC-29-A4，须对业务员与工厂可追溯）');
      return;
    }
    setSubmitting(true);
    const input = {
      sampleLevel,
      round: roundNum,
      conclusion,
      opinion: opinion.trim(),
      criticalDefects: Number(criticalDefects) || 0,
      majorDefects: Number(majorDefects) || 0,
      minorDefects: Number(minorDefects) || 0,
      defectSummary: defectSummary.trim() || undefined,
      inspectionDate: inspectionDate || undefined,
      ...(directReject ? { directReject: true, rejectReason: rejectReason.trim() } : {}),
    };
    try {
      if (directReject) {
        await qcService.directRejectGarmentSample(order.id, input);
      } else {
        await qcService.reviewGarmentSample(order.id, input);
      }
      setOpinion('');
      setDefectSummary('');
      setRejectReason('');
      setDirectReject(false);
      setReportsReloadKey((k) => k + 1);
      await loadGate();
    } catch (e: any) {
      bdsToast.danger(`提交服装链评审失败：${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
      {/* 左列：内部门禁 + 评审表单 */}
      <div className="flex flex-col min-h-0 gap-4 overflow-y-auto">
        {/* DR-008 内部门禁状态 */}
        <div className="bds-card shrink-0" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>内部门禁 Gate</span>
            <span className="text-[11px] ml-auto truncate" style={{ color: 'var(--text-tertiary)' }}>
              {CHAIN_FLOW_HINTS.garment}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="样品级别">
              <select
                className="bds-select"
                value={sampleLevel}
                onChange={(e) => setSampleLevel(e.target.value as GarmentQcSampleLevel)}
              >
                {(Object.keys(GARMENT_SAMPLE_LEVEL_LABELS) as GarmentQcSampleLevel[]).map((lv) => (
                  <option key={lv} value={lv}>{GARMENT_SAMPLE_LEVEL_LABELS[lv]}</option>
                ))}
              </select>
            </Field>
            <Field label="样品轮次">
              <input
                type="number"
                min={1}
                step={1}
                className="bds-input"
                value={round}
                onChange={(e) => setRound(e.target.value)}
              />
            </Field>
          </div>
          {gateLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>门禁查询中...</span>
            </div>
          ) : gateError ? (
            <div className="bds-card flat flex items-center gap-2" style={{ padding: 'var(--space-2) var(--space-3)' }}>
              <span className="bds-badge sm danger shrink-0">查询失败</span>
              <span className="text-[11px] truncate flex-1" style={{ color: 'var(--text-tertiary)' }}>{gateError}</span>
              <button onClick={loadGate} className="bds-btn bds-btn-ghost bds-btn-icon shrink-0" title="重试">
                <RefreshCw size={14} />
              </button>
            </div>
          ) : gate ? (
            <div className="bds-card flat" style={{ padding: 'var(--space-3)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`bds-badge sm ${gate.passed ? 'success' : gate.reviewed ? 'danger' : 'warning'}`}>
                  {gate.passed ? '门禁通过，可寄客户' : gate.reviewed ? '门禁拦截' : '待 QC 评审'}
                </span>
                {gate.conclusion && (
                  <span className={`bds-badge sm ${REPORT_RESULT_BADGE_VARIANT[gate.conclusion] ?? 'neutral'}`}>
                    {CHAIN_CONCLUSION_LABELS[gate.conclusion] ?? gate.conclusion}
                  </span>
                )}
                {gate.disposition && gate.disposition !== 'STANDARD' && (
                  <span className="bds-badge sm warning">{CHAIN_DISPOSITION_LABELS[gate.disposition] ?? gate.disposition}</span>
                )}
              </div>
              {gate.blockedMessage && (
                <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{gate.blockedMessage}</div>
              )}
              {gate.reportId && (
                <div className="mt-1 text-[11px] bds-mono truncate" style={{ color: 'var(--text-quaternary)' }}>
                  报告 {gate.reportId}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] py-1" style={{ color: 'var(--text-tertiary)' }}>
              输入有效轮次后自动查询门禁（fail-closed：未评审 / 未通过 / 已打回均禁止寄客户）
            </div>
          )}
        </div>

        {/* 评审表单 */}
        <div className="bds-card shrink-0" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck size={16} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
              提交评审 — 第 {Number.isInteger(roundNum) && roundNum >= 1 ? roundNum : '—'} 轮 {GARMENT_SAMPLE_LEVEL_LABELS[sampleLevel]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="评审结论 *">
              <select
                className="bds-select"
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value as 'pass' | 'conditional' | 'fail')}
              >
                <option value="pass">通过</option>
                <option value="conditional">有条件通过</option>
                <option value="fail">不通过</option>
              </select>
            </Field>
            <Field label="检验日期">
              <CapsuleDateInput className="bds-input" value={inspectionDate} onChange={setInspectionDate} />
            </Field>
          </div>
          <Field label="QC 评审意见 *">
            <textarea
              className="bds-input bds-textarea"
              rows={2}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
              placeholder="文本评审意见（DR-029：不得压缩为机械二值）"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="致命缺陷">
              <input type="number" min={0} step={1} className="bds-input" value={criticalDefects} onChange={(e) => setCriticalDefects(e.target.value)} />
            </Field>
            <Field label="严重缺陷">
              <input type="number" min={0} step={1} className="bds-input" value={majorDefects} onChange={(e) => setMajorDefects(e.target.value)} />
            </Field>
            <Field label="轻微缺陷">
              <input type="number" min={0} step={1} className="bds-input" value={minorDefects} onChange={(e) => setMinorDefects(e.target.value)} />
            </Field>
          </div>
          <Field label="缺陷摘要">
            <input
              className="bds-input"
              value={defectSummary}
              onChange={(e) => setDefectSummary(e.target.value)}
              placeholder="缺陷位置 / 类型 / 程度"
            />
          </Field>
          <div className="mb-3">
            <label className="bds-check">
              <input
                type="checkbox"
                checked={directReject}
                onChange={(e) => setDirectReject(e.target.checked)}
              />
              <span className="box" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                直接打回工厂重做（QC-29-A4：该批不得寄客户，系统通知业务员）
              </span>
            </label>
          </div>
          {directReject && (
            <Field label="打回原因 *">
              <textarea
                className="bds-input bds-textarea"
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="打回原因须对业务员与工厂可追溯"
              />
            </Field>
          )}
          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={submitting} className="bds-btn bds-btn-primary">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : directReject ? <Ban size={14} /> : <CheckCheck size={14} />}
              <span>{directReject ? '确认直接打回' : '提交评审'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 右列：服装链报告（与大货 final/midline 天然隔离） */}
      <div className="min-h-0">
        <ChainReportsList orderId={order.id} chain="garment" reloadKey={reportsReloadKey} />
      </div>
    </div>
  );
}

// ─── 面料链视图（DR-029：业务员 → QC → 工厂 → 业务员，QC 向工厂提技术调整） ───

function FabricChainView({ order }: { order: Order }) {
  const [sampleKind, setSampleKind] = useState<FabricQcSampleKind>('SS');
  const [sampleOptions, setSampleOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [samplesLoading, setSamplesLoading] = useState(true);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState('');

  const [conclusion, setConclusion] = useState<'pass' | 'conditional' | 'fail'>('pass');
  const [opinion, setOpinion] = useState('');
  const [criticalDefects, setCriticalDefects] = useState('0');
  const [majorDefects, setMajorDefects] = useState('0');
  const [minorDefects, setMinorDefects] = useState('0');
  const [defectSummary, setDefectSummary] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [adjRequirement, setAdjRequirement] = useState('');
  const [adjFactoryName, setAdjFactoryName] = useState('');
  const [adjFollowUpBy, setAdjFollowUpBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reportsReloadKey, setReportsReloadKey] = useState(0);

  // ── 加载可评审样品候选（SS/RC → FabricShipmentSample；EARLY_PRODUCTION → EarlyProductionSample） ──
  const loadSampleOptions = useCallback(async () => {
    setSamplesLoading(true);
    setSamplesError(null);
    try {
      if (sampleKind === 'EARLY_PRODUCTION') {
        const rows = await sampleService.listEarlyProductionRounds(order.id);
        setSampleOptions(rows.map((r) => ({
          id: r.id,
          label: `${r.sampleCode} · ${EARLY_PRODUCTION_STATUS_LABELS[r.customerStatus] ?? r.customerStatus}`,
        })));
      } else {
        const rows = await sampleService.listOrderSamples(order.id);
        setSampleOptions(
          rows
            .filter((r) => r.sampleKind === sampleKind)
            .map((r) => ({
              id: r.id,
              label: `${r.sampleCode} · ${FABRIC_SAMPLE_STATUS_LABELS[r.customerStatus] ?? r.customerStatus}`,
            })),
        );
      }
    } catch (e: any) {
      setSampleOptions([]);
      setSamplesError(e?.message || String(e));
    } finally {
      setSamplesLoading(false);
    }
  }, [order.id, sampleKind]);

  useEffect(() => {
    setSampleId('');
    loadSampleOptions();
  }, [loadSampleOptions]);

  const handleSubmit = async () => {
    if (!sampleId) {
      bdsToast.warning('请选择要评审的样品记录（面料链 QC 评审必须关联具体样品）');
      return;
    }
    if (!opinion.trim()) {
      bdsToast.warning('请填写 QC 专业意见（对工厂的技术调整说明）');
      return;
    }
    if (conclusion !== 'pass' && !adjRequirement.trim()) {
      bdsToast.warning('评审结论非通过时必须填写对工厂的技术调整要求（DR-029 面料链）');
      return;
    }
    setSubmitting(true);
    try {
      await qcService.reviewFabricSample(order.id, {
        sampleKind,
        sampleId,
        conclusion,
        opinion: opinion.trim(),
        criticalDefects: Number(criticalDefects) || 0,
        majorDefects: Number(majorDefects) || 0,
        minorDefects: Number(minorDefects) || 0,
        defectSummary: defectSummary.trim() || undefined,
        inspectionDate: inspectionDate || undefined,
        ...(conclusion !== 'pass'
          ? {
              factoryAdjustment: {
                requirement: adjRequirement.trim(),
                factoryName: adjFactoryName.trim() || undefined,
                followUpBy: adjFollowUpBy.trim() || undefined,
              },
            }
          : {}),
      });
      setOpinion('');
      setDefectSummary('');
      setAdjRequirement('');
      setAdjFactoryName('');
      setAdjFollowUpBy('');
      setReportsReloadKey((k) => k + 1);
    } catch (e: any) {
      bdsToast.danger(`提交面料链评审失败：${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
      {/* 左列：评审对象 + 评审表单 */}
      <div className="flex flex-col min-h-0 gap-4 overflow-y-auto">
        <div className="bds-card shrink-0" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Truck size={16} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>评审对象 Sample</span>
            <span className="text-[11px] ml-auto truncate" style={{ color: 'var(--text-tertiary)' }}>
              {CHAIN_FLOW_HINTS.fabric}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="样品类型">
              <select
                className="bds-select"
                value={sampleKind}
                onChange={(e) => setSampleKind(e.target.value as FabricQcSampleKind)}
              >
                {(Object.keys(FABRIC_SAMPLE_KIND_LABELS) as FabricQcSampleKind[]).map((k) => (
                  <option key={k} value={k}>{FABRIC_SAMPLE_KIND_LABELS[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="样品记录 *">
              {samplesLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>样品加载中...</span>
                </div>
              ) : samplesError ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] truncate flex-1" style={{ color: 'var(--text-tertiary)' }}>样品列表加载失败</span>
                  <button onClick={loadSampleOptions} className="bds-btn bds-btn-ghost bds-btn-icon shrink-0" title="重试">
                    <RefreshCw size={14} />
                  </button>
                </div>
              ) : (
                <select className="bds-select" value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
                  <option value="">选择样品...</option>
                  {sampleOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {!samplesLoading && !samplesError && sampleOptions.length === 0 && (
            <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              该订单暂无{FABRIC_SAMPLE_KIND_LABELS[sampleKind]}记录，请先由业务员在样品域登记
            </div>
          )}
        </div>

        <div className="bds-card shrink-0" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck size={16} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>提交评审 Review</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="评审结论 *">
              <select
                className="bds-select"
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value as 'pass' | 'conditional' | 'fail')}
              >
                <option value="pass">通过</option>
                <option value="conditional">有条件通过</option>
                <option value="fail">不通过</option>
              </select>
            </Field>
            <Field label="检验日期">
              <CapsuleDateInput className="bds-input" value={inspectionDate} onChange={setInspectionDate} />
            </Field>
          </div>
          <Field label="QC 专业意见 *">
            <textarea
              className="bds-input bds-textarea"
              rows={2}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
              placeholder="对工厂的技术调整说明（DR-029）"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="致命缺陷">
              <input type="number" min={0} step={1} className="bds-input" value={criticalDefects} onChange={(e) => setCriticalDefects(e.target.value)} />
            </Field>
            <Field label="严重缺陷">
              <input type="number" min={0} step={1} className="bds-input" value={majorDefects} onChange={(e) => setMajorDefects(e.target.value)} />
            </Field>
            <Field label="轻微缺陷">
              <input type="number" min={0} step={1} className="bds-input" value={minorDefects} onChange={(e) => setMinorDefects(e.target.value)} />
            </Field>
          </div>
          <Field label="缺陷摘要">
            <input
              className="bds-input"
              value={defectSummary}
              onChange={(e) => setDefectSummary(e.target.value)}
              placeholder="缺陷位置 / 类型 / 程度"
            />
          </Field>
          {conclusion !== 'pass' && (
            <>
              <Field label="工厂技术调整要求 *">
                <textarea
                  className="bds-input bds-textarea"
                  rows={2}
                  value={adjRequirement}
                  onChange={(e) => setAdjRequirement(e.target.value)}
                  placeholder="染整 / 后整理 / 修布等调整要求（可追溯）"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="责任工厂">
                  <input
                    className="bds-input"
                    value={adjFactoryName}
                    onChange={(e) => setAdjFactoryName(e.target.value)}
                  />
                </Field>
                <Field label="跟进人">
                  <input
                    className="bds-input"
                    value={adjFollowUpBy}
                    onChange={(e) => setAdjFollowUpBy(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={submitting} className="bds-btn bds-btn-primary">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
              <span>提交评审</span>
            </button>
          </div>
        </div>
      </div>

      {/* 右列：面料链报告 */}
      <div className="min-h-0">
        <ChainReportsList orderId={order.id} chain="fabric" reloadKey={reportsReloadKey} />
      </div>
    </div>
  );
}

// ─── 链报告列表（双签状态展示 + QC / 业务签署，REL-14-A4 与大货报告天然隔离） ───

function ChainReportsList({ orderId, chain, reloadKey }: { orderId: string; chain: ChainId; reloadKey: number }) {
  const [reports, setReports] = useState<QcInspectionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingKey, setSigningKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await qcService.listChainReports(orderId, chain));
    } catch (e: any) {
      setReports([]);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [orderId, chain]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const handleSign = async (reportId: string, role: ReportSignRole) => {
    setSigningKey(`${reportId}:${role}`);
    try {
      await qcService.signReport(reportId, role);
      await load();
    } catch (e: any) {
      bdsToast.danger(`签署失败：${e?.message || e}`);
    } finally {
      setSigningKey(null);
    }
  };

  return (
    <div className="bds-card flex flex-col min-h-0 h-full" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="px-4 py-2.5 flex items-center gap-2 shrink-0" style={{ borderBottom: 'var(--border-subtle)' }}>
        <span className={`bds-badge sm ${chain === 'garment' ? 'info' : 'warning'}`}>{CHAIN_LABELS[chain]}</span>
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>链评审报告 Reports</span>
        <span className="text-[11px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>{reports.length} 条</span>
        <button onClick={load} className="bds-btn bds-btn-ghost bds-btn-icon shrink-0" title="刷新">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : error ? (
          <div className="bds-card flat text-center" style={{ padding: 'var(--space-6) var(--space-4)' }}>
            <span className="bds-badge sm danger">加载失败</span>
            <div className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{error}</div>
            <button onClick={load} className="bds-btn bds-btn-ghost mt-2">
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        ) : reports.length === 0 ? (
          <div className="bds-card flat text-center text-xs" style={{ padding: 'var(--space-8) var(--space-4)', color: 'var(--text-tertiary)' }}>
            暂无{CHAIN_LABELS[chain]}评审报告
          </div>
        ) : (
          reports.map((r) => {
            const sig = r.signatures ?? null;
            const qcSigned = !!sig?.qcSignedAt;
            const bizSigned = !!sig?.businessSignedAt;
            const disposition = sig?.chain?.disposition;
            const rejectReason = sig?.chain?.rejectReason;
            const factoryAdjustment = sig?.chain?.factoryAdjustment;
            return (
              <div key={r.id} className="bds-card flat" style={{ padding: 'var(--space-3)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bds-badge sm info shrink-0">
                    {SAMPLE_KIND_LABELS[r.sampleKind ?? ''] ?? r.sampleKind ?? '样品'}
                  </span>
                  {typeof r.round === 'number' && (
                    <span className="bds-badge sm neutral shrink-0">R{r.round}</span>
                  )}
                  <span className={`bds-badge sm shrink-0 ${REPORT_RESULT_BADGE_VARIANT[r.result ?? ''] ?? 'neutral'}`}>
                    {CHAIN_CONCLUSION_LABELS[r.result ?? ''] ?? r.result ?? '—'}
                  </span>
                  {disposition && disposition !== 'STANDARD' && (
                    <span className="bds-badge sm warning shrink-0">
                      {CHAIN_DISPOSITION_LABELS[disposition] ?? disposition}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  检验日期 {formatDate(r.inspectionDate)} · 缺陷 致命 {r.criticalDefects} / 严重 {r.majorDefects} / 轻微 {r.minorDefects}
                </div>
                {r.defectSummary && (
                  <div className="mt-1 text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-tertiary)' }}>
                    {r.defectSummary}
                  </div>
                )}
                {rejectReason && (
                  <div className="mt-1 text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-tertiary)' }}>
                    打回原因：{rejectReason}
                  </div>
                )}
                {factoryAdjustment?.requirement && (
                  <div className="mt-1 text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-tertiary)' }}>
                    工厂调整要求：{factoryAdjustment.requirement}
                    {factoryAdjustment.factoryName ? `（${factoryAdjustment.factoryName}）` : ''}
                  </div>
                )}
                {/* 双签状态（InspectionReport.signatures 后端已落；已签署侧不可重复签署） */}
                <div className="mt-2 pt-2 flex items-center gap-2 flex-wrap" style={{ borderTop: 'var(--border-subtle)' }}>
                  <span className={`bds-badge sm ${qcSigned ? 'success' : 'neutral'}`}>
                    QC {qcSigned ? `已签 ${formatTs(sig?.qcSignedAt)}` : '未签'}
                  </span>
                  <span className={`bds-badge sm ${bizSigned ? 'success' : 'neutral'}`}>
                    业务 {bizSigned ? `已签 ${formatTs(sig?.businessSignedAt)}` : '未签'}
                  </span>
                  {!qcSigned && (
                    <button
                      onClick={() => handleSign(r.id, 'qc')}
                      disabled={signingKey !== null}
                      className="bds-btn bds-btn-ghost ml-auto"
                      style={{ padding: '0 var(--space-2)' }}
                    >
                      {signingKey === `${r.id}:qc` ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
                      <span>QC 签署</span>
                    </button>
                  )}
                  {!bizSigned && (
                    <button
                      onClick={() => handleSign(r.id, 'business')}
                      disabled={signingKey !== null}
                      className={`bds-btn bds-btn-ghost ${qcSigned ? 'ml-auto' : ''}`}
                      style={{ padding: '0 var(--space-2)' }}
                    >
                      {signingKey === `${r.id}:business` ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
                      <span>业务签署</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
