/**
 * 单据中心 DocumentCenter — Wave A1（PRD 19.14 / 11.2 / 5.6）
 *
 * 贸易单据的登记台账与生命周期枢纽（ canonical TradeDocument UI ）：
 *   - 列表：类型/状态/关键词过滤 + 搜索（编号/收发货人/港口）
 *   - 详情展开：字段快照 + 版本时间线（服务端强制留痕）+ 单据预览/打印
 *   - 创建/编辑：编号留空自动取号（{前缀}-YYYY-NNNN 作废不回收）；编辑强制版本快照
 *   - 状态机：Draft→Issued→Submitted→Accepted/Rejected（Rejected 可退回 Draft）
 *   - 从运单生成：装配运单数据批量登记 Draft 单据（同 shipmentId+type 幂等）
 *   - 订单打包：订单全单据说最新版本快照逐个渲染打印（L/C 交单场景）
 *
 * 预览渲染复用 EXPORT_DOC_RENDERERS（v1 快照 content.documentSet 直接消费）；
 * 无装配快照的单据（手工创建）降级为字段视图，不伪造预览。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  FileOutput,
  History,
  Layers,
  Loader2,
  PackageOpen,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  DocumentSetData,
  DocumentVersionRecord,
  GenerateTradeDocumentsResult,
  TradeDocument,
  TradeDocumentInput,
  TradeDocumentPackItem,
  TradeDocumentStatus,
  TradeDocumentType,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { BdsDialog } from './ui/BdsDialog';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { statusSemanticClass, statusSemanticText, StatusSemantic } from './rdlBusinessStatusTokens';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { EXPORT_DOC_RENDERERS, ExportDocKind } from './tools/exportDocs/exportDocumentTemplates';
import { printHtmlDocument } from './tools/printDocument';

// ==================== 常量 ====================

const DOC_TYPES: Array<{ id: TradeDocumentType; label: string }> = [
  { id: 'CommercialInvoice', label: '商业发票' },
  { id: 'PackingList', label: '装箱单' },
  { id: 'CertificateOfOrigin', label: '原产地证' },
  { id: 'BillOfLading', label: '提单 B/L' },
  { id: 'AirWaybill', label: '空运单 AWB' },
  { id: 'InsuranceCert', label: '保险凭证' },
  { id: 'InspectionCert', label: '检验证书' },
  { id: 'PhytosanitaryCert', label: '植检证书' },
  { id: 'Other', label: '其他' },
];

const DOC_STATUSES: Array<{ id: TradeDocumentStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Issued', label: '已签发', semantic: 'info' },
  { id: 'Submitted', label: '已提交', semantic: 'info' },
  { id: 'Accepted', label: '已接受', semantic: 'success' },
  { id: 'Rejected', label: '已拒绝', semantic: 'danger' },
  { id: 'Cancelled', label: '已取消', semantic: 'neutral' },
];

/** 单据类型 → 外贸单据渲染器（有 documentSet 快照时可预览/打印） */
const TYPE_TO_EXPORT_KIND: Partial<Record<TradeDocumentType, ExportDocKind>> = {
  CommercialInvoice: 'CI',
  PackingList: 'PL',
  CertificateOfOrigin: 'CO',
  BillOfLading: 'BL',
  InsuranceCert: 'INS',
};

/** 状态机（镜像服务端 DOC_TRANSITIONS，fail-closed 不在前端放行非法流转） */
const DOC_TRANSITIONS: Record<TradeDocumentStatus, TradeDocumentStatus[]> = {
  Draft: ['Issued', 'Cancelled'],
  Issued: ['Submitted', 'Cancelled'],
  Submitted: ['Accepted', 'Rejected', 'Cancelled'],
  Accepted: [],
  Rejected: ['Draft'],
  Cancelled: [],
};

const TRANSITION_LABELS: Record<TradeDocumentStatus, string> = {
  Draft: '退回草稿',
  Issued: '签发',
  Submitted: '提交',
  Accepted: '接受',
  Rejected: '拒绝',
  Cancelled: '取消',
};

const CURRENCIES = ['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD'];

// ==================== Prime（跨模块联动：运单页 → 生成单据对话框） ====================

const GENERATE_PRIME_KEY = 'bambook_document_center_generate_prime';

export interface DocumentCenterGeneratePrime {
  shipmentId: string;
}

export const primeDocumentCenterGenerate = (prime: DocumentCenterGeneratePrime) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(GENERATE_PRIME_KEY, JSON.stringify(prime));
  } catch {
    // Dev-preview continuity only; ignore storage failures.
  }
};

const readGeneratePrime = (): DocumentCenterGeneratePrime | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(GENERATE_PRIME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DocumentCenterGeneratePrime>;
    return typeof parsed.shipmentId === 'string' && parsed.shipmentId ? (parsed as DocumentCenterGeneratePrime) : null;
  } catch {
    return null;
  }
};

const clearGeneratePrime = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(GENERATE_PRIME_KEY);
  } catch {
    // ignore
  }
};

// ==================== 工具 ====================

const docTypeLabel = (t: string) => DOC_TYPES.find(d => d.id === t)?.label || t;
const docStatusInfo = (s: TradeDocumentStatus) => DOC_STATUSES.find(d => d.id === s) || DOC_STATUSES[0];

const fmtAmount = (n: string | number | null | undefined) => {
  if (n == null || n === '') return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtTs = (ts?: number | null) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 版本快照 → 可渲染的 documentSet（无则 null，不伪造预览） */
const extractDocumentSet = (content: Record<string, unknown> | null | undefined): DocumentSetData | null => {
  const ds = (content as any)?.documentSet;
  return ds && typeof ds === 'object' ? (ds as DocumentSetData) : null;
};

// ==================== 主组件 ====================

interface DocumentCenterProps {
  isDarkMode: boolean;
}

const DocumentCenter: React.FC<DocumentCenterProps> = ({ isDarkMode }) => {
  const [docs, setDocs] = useState<TradeDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 详情：版本时间线（展开时懒加载）
  const [versionsByDoc, setVersionsByDoc] = useState<Record<string, DocumentVersionRecord[]>>({});
  const [versionsLoadingId, setVersionsLoadingId] = useState<string | null>(null);
  const [previewByKey, setPreviewByKey] = useState<Record<string, string>>({}); // `${docId}:v${n}` → html

  // 弹窗
  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<TradeDocument | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateShipmentId, setGenerateShipmentId] = useState('');
  const [showPack, setShowPack] = useState(false);
  // BdsDialog 状态（替代 window.alert / window.confirm）
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TradeDocument | null>(null);

  // ── 数据拉取 ──
  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listTradeDocuments({
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        search: searchQuery || undefined,
        limit: 200,
      });
      setDocs(result.items);
      setTotal(result.total);
    } catch (e: any) {
      setError(`加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, searchQuery]);

  useEffect(() => { void fetchDocs(); }, [fetchDocs]);

  // prime 消费：运单页跳转 → 自动打开「从运单生成」对话框
  useEffect(() => {
    const prime = readGeneratePrime();
    if (prime) {
      clearGeneratePrime();
      setGenerateShipmentId(prime.shipmentId);
      setShowGenerate(true);
    }
  }, []);

  // ── 展开详情 → 懒加载版本 ──
  const toggleExpand = useCallback(async (doc: TradeDocument) => {
    const next = expandedId === doc.id ? null : doc.id;
    setExpandedId(next);
    if (next && !versionsByDoc[next]) {
      setVersionsLoadingId(next);
      try {
        const result = await apiService.listTradeDocumentVersions(next);
        setVersionsByDoc(prev => ({ ...prev, [next]: result.items }));
      } catch (e: any) {
        setError(`版本加载失败：${e?.message || e}`);
      } finally {
        setVersionsLoadingId(null);
      }
    }
  }, [expandedId, versionsByDoc]);

  // ── 预览（版本快照 → 渲染 HTML）──
  const togglePreview = useCallback((doc: TradeDocument, version: DocumentVersionRecord) => {
    const key = `${doc.id}:v${version.version}`;
    if (previewByKey[key]) {
      setPreviewByKey(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const kind = TYPE_TO_EXPORT_KIND[doc.type];
    const ds = extractDocumentSet(version.content);
    if (!kind || !ds) return;
    const html = EXPORT_DOC_RENDERERS[kind].render(ds);
    setPreviewByKey(prev => ({ ...prev, [key]: html }));
  }, [previewByKey]);

  const printVersion = useCallback((doc: TradeDocument, version: DocumentVersionRecord) => {
    const kind = TYPE_TO_EXPORT_KIND[doc.type];
    const ds = extractDocumentSet(version.content);
    if (!kind || !ds) return;
    printHtmlDocument({ title: `${doc.documentNumber} v${version.version}`, htmlBody: EXPORT_DOC_RENDERERS[kind].render(ds) });
  }, []);

  // ── 状态流转 ──
  const handleTransition = useCallback(async (doc: TradeDocument, toStatus: TradeDocumentStatus) => {
    setActionLoading(doc.id);
    setError(null);
    try {
      const updated = await apiService.transitionTradeDocumentStatus(doc.id, toStatus);
      setDocs(prev => prev.map(d => (d.id === doc.id ? updated : d)));
    } catch (e: any) {
      setAlertMessage(`状态流转失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  // ── 删除（软删，仅 Draft/Cancelled；BdsDialog 确认后执行）──
  const handleDelete = useCallback(async (doc: TradeDocument) => {
    setDeleteTarget(null);
    setActionLoading(doc.id);
    setError(null);
    try {
      await apiService.deleteTradeDocument(doc.id);
      setDocs(prev => prev.filter(d => d.id !== doc.id));
      if (expandedId === doc.id) setExpandedId(null);
    } catch (e: any) {
      setAlertMessage(`删除失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [expandedId]);

  // ── 样式 ──
  const cardClass = `rounded-card border border-[var(--border-c-subtle)] bg-[var(--hover-darken)] ${BAMBOOK_OS.material.glassColor}`;
  const fieldClass = 'w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]';

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="单据中心"
        subtitle="Document Center"
        contextLabel="Trade Documents"
        isDarkMode={isDarkMode}
        actions={(
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setGenerateShipmentId(''); setShowGenerate(true); }}
              className="bds-btn bds-btn-outline"
            >
              <FileOutput size={14} /><span>从运单生成</span>
            </button>
            <button
              onClick={() => setShowPack(true)}
              className="bds-btn bds-btn-outline"
            >
              <PackageOpen size={14} /><span>订单打包</span>
            </button>
            <button
              onClick={() => { setEditingDoc(null); setShowForm(true); }}
              className="bds-btn bds-btn-primary"
            >
              <Plus size={14} /><span>新增单据</span>
            </button>
          </div>
        )}
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* 工具栏（组合嵌套 bar：搜索 + 类型/状态筛选 + 刷新共行，spec §2.1） */}
          <div className="bds-filterbar mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索编号 / 收发货人 / 港口..."
                className="bds-input pl-9"
                onKeyDown={(e) => { if (e.key === 'Enter') void fetchDocs(); }}
              />
            </div>
            <select className="bds-select w-auto min-w-[132px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">全部类型</option>
              {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select className="bds-select w-auto min-w-[116px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {DOC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button
              onClick={() => void fetchDocs()}
              className="bds-btn bds-btn-ghost"
            >
              <RefreshCw size={14} />刷新
            </button>
            <span className="text-xs text-[var(--text-tertiary)] px-2">共 {total} 份</span>
          </div>

          {error && (
            <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 ${statusSemanticClass('danger', isDarkMode)}`}>
              <AlertCircle size={16} className={statusSemanticText('danger', isDarkMode)} />
              <span className="text-sm">{error}</span>
              <button onClick={() => setError(null)} className={`ml-auto p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}>
                <X size={14} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className={`animate-spin text-[var(--text-tertiary)]`} />
            </div>
          ) : docs.length === 0 ? (
            <div className={`text-center py-20 text-sm text-[var(--text-tertiary)]`}>
              暂无贸易单据 — 可「新增单据」手工登记，或「从运单生成」批量建档
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              {docs.map(doc => {
                const si = docStatusInfo(doc.status);
                const isExpanded = expandedId === doc.id;
                const versions = versionsByDoc[doc.id];
                const transitions = DOC_TRANSITIONS[doc.status] || [];
                return (
                  <div key={doc.id} className={`${cardClass} p-3`}>
                    {/* 行概要 */}
                    <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => void toggleExpand(doc)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {isExpanded ? <ChevronDown size={13} className="shrink-0 opacity-60" /> : <ChevronRight size={13} className="shrink-0 opacity-60" />}
                          <span className="text-sm font-light">{doc.documentNumber}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusSemanticClass(si.semantic, isDarkMode)} ${statusSemanticText(si.semantic, isDarkMode)}`}>{si.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-bds-sm bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`}>
                            {docTypeLabel(doc.type)}
                          </span>
                        </div>
                        <div className={`text-xs text-[var(--text-tertiary)]`}>
                          {doc.consignor || '—'} → {doc.consignee || '—'}
                          {doc.portOfLoading && ` · ${doc.portOfLoading} → ${doc.portOfDischarge || '—'}`}
                        </div>
                        <div className={`text-xs mt-0.5 text-[var(--text-tertiary)]`}>
                          签发日: {doc.issueDate || '—'}
                          {doc.shipmentId && ` · 运单 ${doc.shipmentId}`}
                          {doc.orderId && ` · 订单 ${doc.orderId}`}
                          {doc.fileName && ` · 附件 ${doc.fileName}`}
                        </div>
                      </div>
                      {doc.totalAmount && (
                        <div className="text-right shrink-0">
                          <div className="text-sm font-light tabular-nums">{doc.currency || ''} {fmtAmount(doc.totalAmount)}</div>
                        </div>
                      )}
                    </div>

                    {/* 操作行 */}
                    <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      {transitions.map(to => {
                        const variant =
                          to === 'Accepted' ? 'bds-btn-success'
                            : to === 'Rejected' || to === 'Cancelled' || to === 'Draft' ? 'bds-btn-ghost'
                              : 'bds-btn-primary';
                        return (
                          <button
                            key={to}
                            onClick={() => void handleTransition(doc, to)}
                            disabled={!!actionLoading}
                            className={`bds-btn ${variant}`}
                          >
                            {TRANSITION_LABELS[to]}
                          </button>
                        );
                      })}
                      {doc.status === 'Draft' && (
                        <button
                          onClick={() => { setEditingDoc(doc); setShowForm(true); }}
                          disabled={!!actionLoading}
                          className="bds-btn bds-btn-ghost"
                        >
                          编辑
                        </button>
                      )}
                      {(doc.status === 'Draft' || doc.status === 'Cancelled') && (
                        <button
                          onClick={() => setDeleteTarget(doc)}
                          disabled={!!actionLoading}
                          className="bds-btn bds-btn-danger"
                        >
                          <Trash2 size={14} />删除
                        </button>
                      )}
                    </div>

                    {/* 展开详情：字段 + 版本时间线 + 预览 */}
                    {isExpanded && (
                      <div className={`mt-3 pt-3 border-t border-[var(--border-c-subtle)]`}>
                        <div className={`grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs text-[var(--text-tertiary)]`}>
                          <div><span className="opacity-70">签发人</span><div className={`mt-0.5 text-[var(--text-primary)]`}>{doc.issuedBy || '—'}</div></div>
                          <div><span className="opacity-70">有效期至</span><div className={`mt-0.5 text-[var(--text-primary)]`}>{doc.expiryDate || '—'}</div></div>
                          <div><span className="opacity-70">报关单</span><div className={`mt-0.5 text-[var(--text-primary)]`}>{doc.declarationId || '—'}</div></div>
                          <div><span className="opacity-70">档案</span><div className={`mt-0.5 text-[var(--text-primary)]`}>{doc.relationId || '—'}</div></div>
                          {doc.notes && <div className="col-span-2 xl:col-span-4"><span className="opacity-70">备注</span><div className={`mt-0.5 text-[var(--text-primary)]`}>{doc.notes}</div></div>}
                        </div>

                        {/* 版本时间线 */}
                        <div className="mt-4">
                          <div className={`flex items-center gap-1.5 text-xs mb-2 text-[var(--text-tertiary)]`}>
                            <History size={12} /><span>版本留痕</span>
                          </div>
                          {versionsLoadingId === doc.id ? (
                            <div className="flex items-center gap-2 py-3 text-xs opacity-60"><Loader2 size={12} className="animate-spin" />加载版本...</div>
                          ) : !versions || versions.length === 0 ? (
                            <div className={`text-xs py-2 text-[var(--text-tertiary)]`}>暂无版本记录</div>
                          ) : (
                            <div className="space-y-1.5">
                              {versions.map(v => {
                                const key = `${doc.id}:v${v.version}`;
                                const previewHtml = previewByKey[key];
                                const renderable = !!TYPE_TO_EXPORT_KIND[doc.type] && !!extractDocumentSet(v.content);
                                return (
                                  <div key={v.id} className={`rounded-inset border border-[var(--border-c-subtle)] bg-[var(--hover-darken)]`}>
                                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                                      <div className="flex items-center gap-2 min-w-0 text-xs">
                                        <span className={`font-light text-[var(--text-primary)]`}>v{v.version}</span>
                                        <span className="opacity-70">{v.changeReason || '—'}</span>
                                        <span className="opacity-50">{v.changedBy || '—'} · {fmtTs(v.createdAt)}</span>
                                      </div>
                                      {renderable && (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <button onClick={() => togglePreview(doc, v)} className="bds-btn bds-btn-outline">
                                            <Eye size={14} />{previewHtml ? '收起预览' : '预览'}
                                          </button>
                                          <button onClick={() => printVersion(doc, v)} className="bds-btn bds-btn-outline">
                                            <Printer size={14} />打印/PDF
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    {previewHtml && (
                                      <iframe
                                        title={`${doc.documentNumber}-v${v.version}`}
                                        sandbox=""
                                        srcDoc={previewHtml}
                                        className={`w-full h-[420px] border-t border-[var(--border-c-subtle)] bg-[var(--bg-card)]`}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </div>
      </div>

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <DocFormModal
          isDarkMode={isDarkMode}
          doc={editingDoc}
          onClose={() => { setShowForm(false); setEditingDoc(null); }}
          onSaved={() => { setShowForm(false); setEditingDoc(null); setVersionsByDoc({}); void fetchDocs(); }}
        />
      )}

      {/* 从运单生成弹窗 */}
      {showGenerate && (
        <GenerateDialog
          isDarkMode={isDarkMode}
          initialShipmentId={generateShipmentId}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => { setVersionsByDoc({}); void fetchDocs(); }}
        />
      )}

      {/* 订单打包弹窗 */}
      {showPack && (
        <PackDialog isDarkMode={isDarkMode} onClose={() => setShowPack(false)} />
      )}

      {/* BdsDialog：操作失败提示（替代 window.alert） */}
      {alertMessage && (
        <BdsDialog title="操作提示" onConfirm={() => setAlertMessage(null)}>
          {alertMessage}
        </BdsDialog>
      )}

      {/* BdsDialog：删除确认（替代 window.confirm） */}
      {deleteTarget && (
        <BdsDialog
          title="删除单据"
          danger
          confirmLabel="删除"
          loading={actionLoading === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete(deleteTarget)}
        >
          {`确认删除单据 ${deleteTarget.documentNumber}？（软删除，编号不回收）`}
        </BdsDialog>
      )}
    </div>
  );
};

// ==================== 创建/编辑表单 ====================

interface DocFormModalProps {
  isDarkMode: boolean;
  /** null=创建；非 null=编辑（仅 Draft 可编辑，服务端强校验） */
  doc: TradeDocument | null;
  onClose: () => void;
  onSaved: () => void;
}

const DocFormModal: React.FC<DocFormModalProps> = ({ isDarkMode, doc, onClose, onSaved }) => {
  const isEdit = !!doc;
  const [form, setForm] = useState<TradeDocumentInput>(() => isEdit ? {
    type: doc.type,
    shipmentId: doc.shipmentId ?? undefined,
    declarationId: doc.declarationId ?? undefined,
    orderId: doc.orderId ?? undefined,
    relationId: doc.relationId ?? undefined,
    issueDate: doc.issueDate ?? undefined,
    expiryDate: doc.expiryDate ?? undefined,
    issuedBy: doc.issuedBy ?? undefined,
    consignee: doc.consignee ?? undefined,
    consignor: doc.consignor ?? undefined,
    portOfLoading: doc.portOfLoading ?? undefined,
    portOfDischarge: doc.portOfDischarge ?? undefined,
    totalAmount: doc.totalAmount != null ? Number(doc.totalAmount) : undefined,
    currency: doc.currency ?? undefined,
    notes: doc.notes ?? undefined,
    changeReason: '',
  } : { type: 'CommercialInvoice', currency: 'USD' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fieldClass = 'w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]';
  const inputCls = `${fieldClass} py-1.5`;
  const labelClass = 'block text-xs mb-1 text-[var(--text-tertiary)]';

  const set = (patch: Partial<TradeDocumentInput>) => setForm(prev => ({ ...prev, ...patch }));
  const setStr = (key: keyof TradeDocumentInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    set({ [key]: e.target.value.trim() === '' ? undefined : e.target.value } as Partial<TradeDocumentInput>);

  const handleSubmit = async () => {
    setFormError(null);
    if (!form.type) { setFormError('单据类型必填'); return; }
    setSubmitting(true);
    try {
      if (isEdit) {
        await apiService.updateTradeDocument(doc.id, { ...form, changeReason: form.changeReason?.trim() || undefined });
      } else {
        await apiService.createTradeDocument({ ...form, documentNumber: form.documentNumber?.trim() || undefined });
      }
      onSaved();
    } catch (e: any) {
      setFormError(e?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--mask-bg)] backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-[720px] max-w-[94vw] max-h-[88vh] overflow-y-auto custom-scrollbar rounded-card-lg border p-6 bg-[var(--bg-card)] border-[var(--border-c-subtle)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-light">{isEdit ? `编辑单据 ${doc.documentNumber}` : '新增贸易单据'}</h3>
          <button onClick={onClose} className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}><X size={16} /></button>
        </div>

        {formError && (
          <div className={`p-3 rounded-inset border flex items-center gap-2 mb-4 ${statusSemanticClass('danger', isDarkMode)}`}>
            <AlertCircle size={14} className={statusSemanticText('danger', isDarkMode)} />
            <span className="text-xs">{formError}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>单据类型 *</label>
            <select className="bds-select" value={form.type} disabled={isEdit} onChange={(e) => set({ type: e.target.value as TradeDocumentType })}>
              {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>单据编号{isEdit ? '' : '（留空自动取号）'}</label>
            <input className={inputCls} value={isEdit ? doc.documentNumber : (form.documentNumber ?? '')} disabled={isEdit} onChange={setStr('documentNumber')} placeholder="CI-2026-0001" />
          </div>
          <div>
            <label className={labelClass}>签发日期</label>
            <CapsuleDateInput className="bds-input" value={form.issueDate ?? ''} onChange={(v) => set({ issueDate: v || undefined })} isDarkMode={isDarkMode} />
          </div>
          <div>
            <label className={labelClass}>有效期至</label>
            <CapsuleDateInput className="bds-input" value={form.expiryDate ?? ''} onChange={(v) => set({ expiryDate: v || undefined })} isDarkMode={isDarkMode} />
          </div>
          <div><label className={labelClass}>发货人 Consignor</label><input className={inputCls} value={form.consignor ?? ''} onChange={setStr('consignor')} /></div>
          <div><label className={labelClass}>收货人 Consignee</label><input className={inputCls} value={form.consignee ?? ''} onChange={setStr('consignee')} /></div>
          <div><label className={labelClass}>装运港</label><input className={inputCls} value={form.portOfLoading ?? ''} onChange={setStr('portOfLoading')} /></div>
          <div><label className={labelClass}>卸货港</label><input className={inputCls} value={form.portOfDischarge ?? ''} onChange={setStr('portOfDischarge')} /></div>
          <div>
            <label className={labelClass}>总金额</label>
            <input type="number" step="0.01" className={inputCls} value={form.totalAmount ?? ''} onChange={(e) => set({ totalAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div>
            <label className={labelClass}>币种</label>
            <select className="bds-select" value={form.currency ?? ''} onChange={setStr('currency')}>
              <option value="">—</option>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className={labelClass}>关联运单 ID</label><input className={inputCls} value={form.shipmentId ?? ''} onChange={setStr('shipmentId')} placeholder="选填" /></div>
          <div><label className={labelClass}>关联订单 ID</label><input className={inputCls} value={form.orderId ?? ''} onChange={setStr('orderId')} placeholder="选填" /></div>
          <div><label className={labelClass}>签发人</label><input className={inputCls} value={form.issuedBy ?? ''} onChange={setStr('issuedBy')} /></div>
          <div><label className={labelClass}>关联档案 ID</label><input className={inputCls} value={form.relationId ?? ''} onChange={setStr('relationId')} placeholder="选填" /></div>
          {isEdit && (
            <div className="col-span-2">
              <label className={labelClass}>变更原因（写入版本留痕）</label>
              <input className={inputCls} value={form.changeReason ?? ''} onChange={setStr('changeReason')} placeholder="默认：更新" />
            </div>
          )}
          <div className="col-span-2">
            <label className={labelClass}>备注</label>
            <textarea className={`${inputCls} h-16 resize-none`} value={form.notes ?? ''} onChange={setStr('notes')} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="bds-btn bds-btn-primary"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? '保存（自动留痕）' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== 从运单生成 ====================

interface GenerateDialogProps {
  isDarkMode: boolean;
  initialShipmentId: string;
  onClose: () => void;
  onGenerated: () => void;
}

const GenerateDialog: React.FC<GenerateDialogProps> = ({ isDarkMode, initialShipmentId, onClose, onGenerated }) => {
  const [shipmentId, setShipmentId] = useState(initialShipmentId);
  const [selected, setSelected] = useState<Set<TradeDocumentType>>(() => new Set(['CommercialInvoice', 'PackingList']));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateTradeDocumentsResult | null>(null);

  const fieldClass = 'w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]';

  const toggle = (t: TradeDocumentType) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });

  const handleSubmit = async () => {
    setError(null);
    if (!shipmentId.trim()) { setError('运单 ID 必填'); return; }
    if (selected.size === 0) { setError('至少选择一种单据类型'); return; }
    setSubmitting(true);
    try {
      const res = await apiService.generateTradeDocumentsFromShipment({ shipmentId: shipmentId.trim(), types: Array.from(selected) });
      setResult(res);
      if (res.created.length > 0) onGenerated();
    } catch (e: any) {
      setError(e?.message || '生成失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--mask-bg)] backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-[560px] max-w-[94vw] max-h-[88vh] overflow-y-auto custom-scrollbar rounded-card-lg border p-6 bg-[var(--bg-card)] border-[var(--border-c-subtle)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-light flex items-center gap-2"><FileOutput size={15} />从运单生成单据</h3>
          <button onClick={onClose} className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}><X size={16} /></button>
        </div>
        <p className={`text-xs mb-4 text-[var(--text-tertiary)]`}>
          装配运单数据批量登记 Draft 草稿（自动取号 + v1 快照）；同运单同类型已存在则跳过不重复建档。
        </p>

        <label className={`block text-xs mb-1 text-[var(--text-tertiary)]`}>运单 ID *</label>
        <input className={`${fieldClass} py-1.5 mb-4`} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="SHP_..." />

        <label className={`block text-xs mb-1.5 text-[var(--text-tertiary)]`}>单据类型 *</label>
        <div className="bds-toggle-group mb-4">
          {DOC_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`bds-toggle${selected.has(t.id) ? ' active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 ${statusSemanticClass('danger', isDarkMode)}`}>
            <AlertCircle size={14} className={statusSemanticText('danger', isDarkMode)} />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {result && (
          <div className={`rounded-inset border p-3 mb-3 space-y-2 text-xs border-[var(--border-c-subtle)] bg-[var(--hover-darken)]`}>
            {result.created.length > 0 && (
              <div>
                <div className={statusSemanticText('success', isDarkMode)}>已登记 {result.created.length} 份：</div>
                {result.created.map(c => <div key={c.id} className="opacity-80 ml-2">{c.documentNumber}（{docTypeLabel(c.type)}）</div>)}
              </div>
            )}
            {result.skipped.length > 0 && (
              <div>
                <div className="opacity-70">已存在跳过 {result.skipped.length} 份：</div>
                {result.skipped.map(s => <div key={s.type} className="opacity-60 ml-2">{s.documentNumber}（{docTypeLabel(s.type)}）</div>)}
              </div>
            )}
            {result.missing.length > 0 && (
              <div className={statusSemanticText('warning', isDarkMode)}>
                数据完整度提示：{result.missing.join('；')}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="bds-btn bds-btn-ghost">关闭</button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="bds-btn bds-btn-primary"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}生成并登记
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== 订单打包 ====================

interface PackDialogProps {
  isDarkMode: boolean;
  onClose: () => void;
}

const PackDialog: React.FC<PackDialogProps> = ({ isDarkMode, onClose }) => {
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TradeDocumentPackItem[] | null>(null);

  const fieldClass = 'w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]';

  const handleLoad = async () => {
    setError(null);
    if (!orderId.trim()) { setError('订单 ID 必填'); return; }
    setLoading(true);
    try {
      const res = await apiService.packTradeDocumentsByOrder(orderId.trim());
      setItems(res.items);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const printItem = (item: TradeDocumentPackItem) => {
    const kind = TYPE_TO_EXPORT_KIND[item.type as TradeDocumentType];
    const ds = extractDocumentSet(item.content);
    if (!kind || !ds) return;
    printHtmlDocument({ title: item.documentNumber, htmlBody: EXPORT_DOC_RENDERERS[kind].render(ds) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--mask-bg)] backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-[640px] max-w-[94vw] max-h-[88vh] overflow-y-auto custom-scrollbar rounded-card-lg border p-6 bg-[var(--bg-card)] border-[var(--border-c-subtle)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-light flex items-center gap-2"><PackageOpen size={15} />订单单据打包</h3>
          <button onClick={onClose} className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}><X size={16} /></button>
        </div>
        <p className={`text-xs mb-4 text-[var(--text-tertiary)]`}>
          订单全部未删单据 + 最新版本快照，逐份渲染打印（L/C 交单场景）。
        </p>

        <div className="flex items-center gap-2 mb-4">
          <input className={`${fieldClass} py-1.5`} value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="订单 ID" onKeyDown={(e) => { if (e.key === 'Enter') void handleLoad(); }} />
          <button
            onClick={() => void handleLoad()}
            disabled={loading}
            className="bds-btn bds-btn-primary shrink-0"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}加载
          </button>
        </div>

        {error && (
          <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 ${statusSemanticClass('danger', isDarkMode)}`}>
            <AlertCircle size={14} className={statusSemanticText('danger', isDarkMode)} />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {items && (
          items.length === 0 ? (
            <div className={`text-center py-10 text-xs text-[var(--text-tertiary)]`}>该订单暂无已登记单据</div>
          ) : (
            <div className="space-y-1.5">
              {items.map(item => {
                const si = docStatusInfo(item.status as TradeDocumentStatus);
                const renderable = !!TYPE_TO_EXPORT_KIND[item.type as TradeDocumentType] && !!extractDocumentSet(item.content);
                return (
                  <div key={item.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-inset border border-[var(--border-c-subtle)] bg-[var(--hover-darken)]`}>
                    <div className="flex items-center gap-2 min-w-0 text-xs flex-wrap">
                      <span className={`font-light text-[var(--text-primary)]`}>{item.documentNumber}</span>
                      <span className="opacity-70">{docTypeLabel(item.type)}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusSemanticClass(si.semantic, isDarkMode)} ${statusSemanticText(si.semantic, isDarkMode)}`}>{si.label}</span>
                      <span className="opacity-50">{item.latestVersion != null ? `v${item.latestVersion}` : '无版本'}</span>
                    </div>
                    <button
                      onClick={() => printItem(item)}
                      disabled={!renderable}
                      title={renderable ? '渲染最新快照并打印' : '无可渲染快照（手工登记单据请先补录/生成）'}
                      className="bds-btn bds-btn-outline shrink-0"
                    >
                      <Printer size={14} />打印/PDF
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default DocumentCenter;
