/**
 * 营销推广 MarketingManager
 * 阶段 P2：电子画册 Lookbook + 面料推荐 FabricRecommendation（PRD 6.2）
 *
 * 功能：
 *   1. 电子画册 Lookbooks — 画册 CRUD + 条目管理（服务端档案真源快照）+
 *      状态机流转（Draft → Published → Archived）+ 软删除
 *   2. 面料推荐 Fabric Recommendation — 确定性打分（季节/预算/成分/克重/花型/现货），
 *      criteria + results 快照落库，历史记录可回看
 *
 * 设计原则：
 *   - 条目快照以服务端返回为准（sku/name/imageUrl 服务端重取，防客户端数据不一致）
 *   - BDS v2.1 组件族（bds-card/bds-btn/bds-input/bds-modal 等）
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Wand2,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  X,
  Upload,
  Archive,
  RotateCcw,
  ListOrdered,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  LookbookCatalog,
  LookbookStatus,
  LookbookItemInput,
  FabricRecommendation,
  RecommendCriteria,
  ProductAsset,
} from '../types';
import { PageHeader } from './ui/PageHeader';

// ==================== 常量 ====================

type ModuleTab = 'lookbooks' | 'fabricRecommend';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'lookbooks', label: '电子画册 Lookbooks', icon: BookOpen },
  { id: 'fabricRecommend', label: '面料推荐 Fabric Recommend', icon: Wand2 },
];

const LOOKBOOK_STATUS_LABELS: Record<LookbookStatus, string> = {
  Draft: '草稿',
  Published: '已发布',
  Archived: '已归档',
};

// BDS 徽章语义变体映射（bds-badge：neutral/info/success/danger/warning）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';
const LOOKBOOK_STATUS_BADGE: Record<LookbookStatus, BadgeVariant> = {
  Draft: 'neutral',
  Published: 'success',
  Archived: 'neutral',
};

function formatTs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatMoney(value: number | null | undefined, currency = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const text = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency ? `${currency} ${text}` : text;
}

function parseNum(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** 推荐条件概要（历史列表展示用） */
function summarizeCriteria(c: RecommendCriteria): string {
  const parts: string[] = [];
  if (c.season) parts.push(`季节 ${c.season}`);
  if (c.budgetMin != null || c.budgetMax != null) {
    parts.push(`预算 ${c.budgetMin ?? '—'}~${c.budgetMax ?? '—'} ${c.currency ?? 'USD'}`);
  }
  if (c.compositionKeywords && c.compositionKeywords.length > 0) parts.push(`成分 ${c.compositionKeywords.join('/')}`);
  if (c.weightMin != null || c.weightMax != null) parts.push(`克重 ${c.weightMin ?? '—'}~${c.weightMax ?? '—'}`);
  if (c.pattern) parts.push(`花型 ${c.pattern}`);
  return parts.length > 0 ? parts.join(' · ') : '无条件（全量打分）';
}

// ==================== 共享样式 ====================

const inputClass = "bds-input";
const selectClass = "bds-select";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
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
        style={{ width: wide ? '48rem' : '32rem', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="bds-empty">
      <div className="title">{text}</div>
    </div>
  );
}

// ==================== 主组件 ====================

interface MarketingManagerProps {
  isDarkMode?: boolean;
}

// ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
// isDarkMode 仅保留在 props 签名与解构中兼容调用方，组件内不再使用
export default function MarketingManager({ isDarkMode }: MarketingManagerProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('lookbooks');

  // ── H2/V9：无状态依赖的新建类主操作统一收 PageHeader（QC ref 注册模式） ──
  // fabricRecommend 面板内已有绑定面板状态的任务区 primary（运行推荐），PageHeader 不再重复
  const newActionRef = useRef<(() => void) | null>(null);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="营销推广"
        subtitle="Marketing"
        actions={
          activeTab === 'lookbooks' ? (
            <button onClick={() => newActionRef.current?.()} className="bds-btn bds-btn-primary">
              <Plus size={14} />
              <span>新建画册</span>
            </button>
          ) : undefined
        }
      />

      {/* 模块 Tab 栏（BDS Tabs 下划线式） */}
      <div className="px-7 shrink-0">
        <div className="bds-tabs">
          {MODULE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`bds-tab flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容（切换即重挂载，保证数据新鲜） */}
      <div className="flex-1 min-h-0 px-7 py-5 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="h-full min-h-0"
          >
            {activeTab === 'lookbooks' && <LookbooksPanel registerNewAction={(fn) => { newActionRef.current = fn; }} />}
            {activeTab === 'fabricRecommend' && <FabricRecommendPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 电子画册 Panel ====================

function LookbooksPanel({ registerNewAction }: { registerNewAction?: (fn: (() => void) | null) => void }) {
  const [items, setItems] = useState<LookbookCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | LookbookStatus>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LookbookCatalog | null>(null);
  const [itemsEditing, setItemsEditing] = useState<LookbookCatalog | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ── H2/V9：新建主操作注册到 PageHeader（无状态依赖，卡片头不再重复） ──
  useEffect(() => {
    registerNewAction?.(() => { setEditing(null); setShowForm(true); });
    return () => registerNewAction?.(null);
  }, [registerNewAction]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiService.listLookbooks(statusFilter ? { status: statusFilter } : undefined));
    } catch (e) {
      console.error('[MarketingManager] listLookbooks failed', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTransition = async (item: LookbookCatalog, action: 'publish' | 'unpublish' | 'archive') => {
    setUpdatingId(item.id);
    try {
      await apiService.transitionLookbook(item.id, action);
      await load();
    } catch (e) {
      console.error('[MarketingManager] transitionLookbook failed', e);
      alert(`操作失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该画册？')) return;
    setUpdatingId(id);
    try {
      await apiService.deleteLookbook(id);
      await load();
    } catch (e) {
      console.error('[MarketingManager] deleteLookbook failed', e);
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bds-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>画册列表</h3>
            <div className="bds-segment">
              {(['', 'Draft', 'Published', 'Archived'] as const).map((s) => (
                <button
                  key={s || 'all'}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`seg ${statusFilter === s ? 'active' : ''}`}
                >
                  {s === '' ? '全部' : LOOKBOOK_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="bds-btn bds-btn-secondary">
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-quaternary)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint text="暂无画册，点击「新建画册」开始" />
        ) : (
          <div className="rounded-inset" style={{ background: 'var(--bg-panel)' }}>
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: 'var(--border-subtle)' }}>
              <span className="col-span-3">标题</span>
              <span className="col-span-1">条目</span>
              <span className="col-span-1">状态</span>
              <span className="col-span-2">发布时间</span>
              <span className="col-span-2">更新时间</span>
              <span className="col-span-3 text-right">操作</span>
            </div>
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="col-span-3 truncate" style={{ color: 'var(--text-primary)' }} title={item.description || undefined}>
                  {item.title}
                </span>
                <span className="col-span-1 bds-tnum" style={{ color: 'var(--text-secondary)' }}>{item.items.length}</span>
                <span className="col-span-1">
                  <span className={`bds-badge sm ${LOOKBOOK_STATUS_BADGE[item.status]}`}>
                    {LOOKBOOK_STATUS_LABELS[item.status]}
                  </span>
                </span>
                <span className="col-span-2" style={{ color: 'var(--text-secondary)' }}>{formatTs(item.publishedAt)}</span>
                <span className="col-span-2" style={{ color: 'var(--text-secondary)' }}>{formatTs(item.updatedAt)}</span>
                <span className="col-span-3 flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => setItemsEditing(item)}
                    disabled={updatingId === item.id || item.status === 'Archived'}
                    className="bds-btn bds-btn-secondary"
                    title={item.status === 'Archived' ? '已归档画册不可修改条目' : '管理条目'}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    条目
                  </button>
                  <button
                    onClick={() => { setEditing(item); setShowForm(true); }}
                    disabled={updatingId === item.id || item.status === 'Archived'}
                    className="bds-btn bds-btn-ghost bds-btn-icon"
                    title={item.status === 'Archived' ? '已归档画册不可编辑' : '编辑'}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {item.status !== 'Published' ? (
                    <button
                      onClick={() => handleTransition(item, 'publish')}
                      disabled={updatingId === item.id || item.status === 'Archived'}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="发布"
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleTransition(item, 'unpublish')}
                      disabled={updatingId === item.id}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="撤回为草稿"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.status !== 'Archived' && (
                    <button
                      onClick={() => handleTransition(item, 'archive')}
                      disabled={updatingId === item.id}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="归档"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(item.id)} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <LookbookForm
            editing={editing}
            onSave={async (input) => {
              try {
                if (editing) {
                  await apiService.updateLookbook(editing.id, input);
                } else {
                  await apiService.createLookbook(input);
                }
                setShowForm(false);
                await load();
              } catch (e) {
                console.error('[MarketingManager] saveLookbook failed', e);
                alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
            onClose={() => setShowForm(false)}
          />
        )}
        {itemsEditing && (
          <LookbookItemsEditor
            lookbook={itemsEditing}
            onClose={() => setItemsEditing(null)}
            onSaved={async () => {
              setItemsEditing(null);
              await load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function LookbookForm({
  editing,
  onSave,
  onClose,
}: {
  editing: LookbookCatalog | null;
  onSave: (input: { title: string; description?: string | null }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(editing?.title || '');
  const [description, setDescription] = useState(editing?.description || '');

  const handleSubmit = () => {
    if (!title.trim()) {
      alert('画册标题必填');
      return;
    }
    onSave({ title: title.trim(), description: description.trim() || null });
  };

  return (
    <ModalShell title={editing ? `编辑画册 ${editing.title}` : '新建画册'} onClose={onClose}>
      <Field label="画册标题">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 2026AW 精纺羊毛画册" />
      </Field>
      <Field label="描述（可选）">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="目标客户 / 季节 / 用途说明" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

/** 条目编辑器：本地维护条目数组，保存时整表替换（PUT /items，服务端重取快照） */
function LookbookItemsEditor({
  lookbook,
  onClose,
  onSaved,
}: {
  lookbook: LookbookCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<LookbookItemInput[]>(
    lookbook.items.map((it) => ({
      productAssetId: it.productAssetId,
      price: it.price ?? null,
      currency: it.currency ?? null,
      description: it.description ?? null,
      sortOrder: it.sortOrder,
    })),
  );
  const [products, setProducts] = useState<ProductAsset[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [pickId, setPickId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProductsLoading(true);
      try {
        const list = await apiService.listProductAssets(undefined, { limit: 500 });
        if (!cancelled) setProducts(list);
      } catch (e) {
        console.error('[MarketingManager] listProductAssets failed', e);
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const snapshotOf = (productAssetId: string) => lookbook.items.find((it) => it.productAssetId === productAssetId);
  const pickedSet = new Set(drafts.map((d) => d.productAssetId));
  const available = products.filter((p) => !pickedSet.has(p.id) && !p.deletedAt);

  const handleAdd = () => {
    if (!pickId || pickedSet.has(pickId)) return;
    setDrafts([...drafts, { productAssetId: pickId, sortOrder: drafts.length }]);
    setPickId('');
  };

  const handlePatch = (productAssetId: string, patch: Partial<LookbookItemInput>) => {
    setDrafts(drafts.map((d) => (d.productAssetId === productAssetId ? { ...d, ...patch } : d)));
  };

  const handleRemove = (productAssetId: string) => {
    setDrafts(drafts.filter((d) => d.productAssetId !== productAssetId));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiService.setLookbookItems(lookbook.id, drafts);
      onSaved();
    } catch (e) {
      console.error('[MarketingManager] setLookbookItems failed', e);
      alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`管理条目 · ${lookbook.title}`} onClose={onClose} wide>
      {/* 添加产品 */}
      <div className="flex items-center gap-2 mb-4">
        <select
          className={selectClass}
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          disabled={productsLoading}
        >
          <option value="">{productsLoading ? '产品加载中…' : '选择产品加入画册'}</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </select>
        <button onClick={handleAdd} disabled={!pickId} className="bds-btn bds-btn-secondary shrink-0">
          <Plus className="w-3.5 h-3.5" />
          添加
        </button>
      </div>

      {drafts.length === 0 ? (
        <EmptyHint text="暂无条目，从上方选择产品加入" />
      ) : (
        <div className="rounded-inset mb-4" style={{ background: 'var(--bg-panel)' }}>
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: 'var(--border-subtle)' }}>
            <span className="col-span-4">产品</span>
            <span className="col-span-2">展示价格</span>
            <span className="col-span-1">币种</span>
            <span className="col-span-4">展示描述</span>
            <span className="col-span-1 text-right">操作</span>
          </div>
          {drafts.map((d, idx) => {
            const snap = snapshotOf(d.productAssetId);
            const prod = products.find((p) => p.id === d.productAssetId);
            const label = snap ? `${snap.sku} · ${snap.name}` : prod ? `${prod.sku} · ${prod.name}` : d.productAssetId;
            return (
              <div
                key={d.productAssetId}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="col-span-4 truncate" style={{ color: 'var(--text-primary)' }} title={label}>{label}</span>
                <span className="col-span-2">
                  <input
                    className="bds-input sm"
                    value={d.price ?? ''}
                    onChange={(e) => handlePatch(d.productAssetId, { price: parseNum(e.target.value) })}
                    placeholder="留空不展示"
                    inputMode="decimal"
                  />
                </span>
                <span className="col-span-1">
                  <select
                    className={selectClass}
                    style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}
                    value={d.currency ?? ''}
                    onChange={(e) => handlePatch(d.productAssetId, { currency: e.target.value || null })}
                  >
                    <option value="">—</option>
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                    <option value="EUR">EUR</option>
                  </select>
                </span>
                <span className="col-span-4">
                  <input
                    className="bds-input sm"
                    value={d.description ?? ''}
                    onChange={(e) => handlePatch(d.productAssetId, { description: e.target.value || null })}
                    placeholder="面向客户的展示描述"
                  />
                </span>
                <span className="col-span-1 flex justify-end">
                  <button onClick={() => handleRemove(d.productAssetId)} className="bds-btn bds-btn-ghost bds-btn-icon" title="移除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        保存后服务端将按数字档案真源重新生成条目快照（SKU / 名称 / 主图），此处仅维护选择依据与展示参数。
      </p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bds-btn bds-btn-primary"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          保存条目
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 面料推荐 Panel ====================

function FabricRecommendPanel() {
  const [season, setSeason] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [compositionText, setCompositionText] = useState('');
  const [weightMin, setWeightMin] = useState('');
  const [weightMax, setWeightMax] = useState('');
  const [pattern, setPattern] = useState('');
  const [limit, setLimit] = useState('10');

  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<FabricRecommendation | null>(null);
  const [history, setHistory] = useState<FabricRecommendation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await apiService.listFabricRecommendations());
    } catch (e) {
      console.error('[MarketingManager] listFabricRecommendations failed', e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleRun = async () => {
    const criteria: RecommendCriteria = {
      season: season.trim() || null,
      budgetMin: parseNum(budgetMin),
      budgetMax: parseNum(budgetMax),
      currency,
      compositionKeywords: compositionText.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      weightMin: parseNum(weightMin),
      weightMax: parseNum(weightMax),
      pattern: pattern.trim() || null,
      limit: parseNum(limit) ?? 10,
    };
    setRunning(true);
    setLatest(null);
    try {
      const rec = await apiService.recommendFabrics(criteria);
      setLatest(rec);
      await loadHistory();
    } catch (e) {
      console.error('[MarketingManager] recommendFabrics failed', e);
      alert(`推荐失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该推荐记录？')) return;
    setDeletingId(id);
    try {
      await apiService.deleteFabricRecommendation(id);
      if (latest?.id === id) setLatest(null);
      await loadHistory();
    } catch (e) {
      console.error('[MarketingManager] deleteFabricRecommendation failed', e);
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 推荐条件 */}
      <div className="bds-card">
        <h3 className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>推荐条件</h3>
        <div className="grid grid-cols-4 gap-3">
          <Field label="季节">
            <input className={inputClass} value={season} onChange={(e) => setSeason(e.target.value)} placeholder="如 2026AW" />
          </Field>
          <Field label="预算下限">
            <input className={inputClass} value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="如 5" inputMode="decimal" />
          </Field>
          <Field label="预算上限">
            <input className={inputClass} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="如 8" inputMode="decimal" />
          </Field>
          <Field label="预算币种">
            <select className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
          <Field label="成分关键词（逗号分隔）">
            <input className={inputClass} value={compositionText} onChange={(e) => setCompositionText(e.target.value)} placeholder="如 羊毛, 羊绒" />
          </Field>
          <Field label="克重下限">
            <input className={inputClass} value={weightMin} onChange={(e) => setWeightMin(e.target.value)} placeholder="如 200" inputMode="decimal" />
          </Field>
          <Field label="克重上限">
            <input className={inputClass} value={weightMax} onChange={(e) => setWeightMax(e.target.value)} placeholder="如 320" inputMode="decimal" />
          </Field>
          <Field label="花型">
            <input className={inputClass} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="如 格纹" />
          </Field>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>返回条数</label>
            <input className={inputClass} style={{ width: 80 }} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
          </div>
          <button
            onClick={handleRun}
            disabled={running}
            className="bds-btn bds-btn-primary"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            执行推荐
          </button>
        </div>
      </div>

      {/* 最新推荐结果 */}
      {latest && (
        <div className="bds-card">
          <h3 className="bds-overline mb-1" style={{ color: 'var(--text-tertiary)' }}>
            推荐结果（命中 {latest.results.length} 条）
          </h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>{summarizeCriteria(latest.criteria)} · {formatTs(latest.createdAt)}</p>
          {latest.results.length === 0 ? (
            <EmptyHint text="无候选命中，请放宽条件" />
          ) : (
            <div className="rounded-inset" style={{ background: 'var(--bg-panel)' }}>
              {latest.results.map((r, idx) => (
                <div
                  key={r.productAssetId}
                  className="px-3 py-2.5"
                  style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      {r.sku} · {r.name}
                    </span>
                    <span className={`bds-badge sm ${r.score >= 60 ? 'success' : r.score >= 30 ? 'warning' : 'neutral'}`}>
                      {r.score} 分
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {r.millName && <span>{r.millName}</span>}
                    {r.latestPrice != null && <span className="bds-tnum">{formatMoney(r.latestPrice, r.priceCurrency ?? '')}</span>}
                    {r.weightValue != null && <span className="bds-tnum">{r.weightValue}{r.weightUnit ?? ''}</span>}
                    {r.season && <span>{r.season}</span>}
                  </div>
                  {r.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {r.reasons.map((reason, i) => (
                        <span key={i} className="bds-badge sm neutral">
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 历史记录 */}
      <div className="bds-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>推荐历史</h3>
          <button onClick={loadHistory} className="bds-btn bds-btn-secondary">
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </button>
        </div>
        {historyLoading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-quaternary)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <EmptyHint text="暂无推荐记录" />
        ) : (
          <div className="rounded-inset" style={{ background: 'var(--bg-panel)' }}>
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: 'var(--border-subtle)' }}>
              <span className="col-span-6">推荐条件</span>
              <span className="col-span-1">命中</span>
              <span className="col-span-3">时间</span>
              <span className="col-span-2 text-right">操作</span>
            </div>
            {history.map((rec, idx) => (
              <div
                key={rec.id}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="col-span-6 truncate" style={{ color: 'var(--text-secondary)' }} title={summarizeCriteria(rec.criteria)}>
                  {summarizeCriteria(rec.criteria)}
                </span>
                <span className="col-span-1 bds-tnum" style={{ color: 'var(--text-primary)' }}>{rec.results.length}</span>
                <span className="col-span-3" style={{ color: 'var(--text-secondary)' }}>{formatTs(rec.createdAt)}</span>
                <span className="col-span-2 flex items-center justify-end gap-1.5">
                  <button onClick={() => setLatest(rec)} className="bds-btn bds-btn-secondary" title="查看结果">
                    查看
                  </button>
                  <button onClick={() => handleDelete(rec.id)} disabled={deletingId === rec.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
