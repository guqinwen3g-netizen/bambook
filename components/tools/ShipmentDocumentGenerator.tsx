/**
 * 出运制单引擎 ShipmentDocumentGenerator
 * 阶段 A-P0：Shipment + Order + CustomsDeclaration → CI/PL/CO/BL 成套生成
 *
 * 数据流：选择运单 → GET /v1/shipping/:id/document-set（服务端多源装配）
 *        → 勾选单据类型 → printHtmlDocument 输出 PDF
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Package,
  ScrollText,
  Ship,
  Award,
  ShieldCheck,
  BadgeCheck,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  Printer,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { apiService } from '../../services/apiService';
import { Shipment, DocumentSetData } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { printHtmlDocument } from './printDocument';
import { EXPORT_DOC_RENDERERS, ExportDocKind } from './exportDocs/exportDocumentTemplates';

interface ShipmentDocumentGeneratorProps {
  isDarkMode: boolean;
}

const DOC_OPTIONS: Array<{ kind: ExportDocKind; label: string; sub: string; icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }> }> = [
  { kind: 'CI', label: '商业发票', sub: 'Commercial Invoice', icon: FileText },
  { kind: 'PL', label: '装箱单', sub: 'Packing List', icon: Package },
  { kind: 'CO', label: '原产地证', sub: 'Certificate of Origin', icon: ScrollText },
  { kind: 'BL', label: '提单补料', sub: 'Bill of Lading Draft', icon: Ship },
  // 阶段 D / D4：按需单据（GSP 目的国 / CIF 投保 / LC 交单时勾选）
  { kind: 'FORMA', label: '普惠制产地证', sub: 'GSP Form A', icon: Award },
  { kind: 'INS', label: '保险单', sub: 'Insurance Policy', icon: ShieldCheck },
  { kind: 'BC', label: '受益人证明', sub: "Beneficiary's Cert.", icon: BadgeCheck },
];

const ShipmentDocumentGenerator: React.FC<ShipmentDocumentGeneratorProps> = ({ isDarkMode }) => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docSet, setDocSet] = useState<DocumentSetData | null>(null);
  const [loadingDocSet, setLoadingDocSet] = useState(false);
  // 阶段 D / D4：CI/PL/CO/BL 常规默认勾选；FORMA/INS/BC 按需（GSP/CIF/LC 场景）
  const [selectedDocs, setSelectedDocs] = useState<Record<ExportDocKind, boolean>>({ CI: true, PL: true, CO: true, BL: true, FORMA: false, INS: false, BC: false });
  const [generating, setGenerating] = useState(false);

  // ── 运单列表 ──
  const fetchShipments = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const items = await apiService.listShipments();
      setShipments(items.filter(s => !s.deletedAt));
    } catch (e: any) {
      setError(String(e?.message || e || '加载运单失败'));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { fetchShipments(); }, [fetchShipments]);

  const filteredShipments = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    if (!kw) return shipments;
    return shipments.filter(s =>
      s.shipmentNumber?.toLowerCase().includes(kw) ||
      s.customerName?.toLowerCase().includes(kw) ||
      s.portOfDischarge?.toLowerCase().includes(kw)
    );
  }, [shipments, searchQuery]);

  // ── 选中运单 → 拉取制单数据 ──
  const handleSelectShipment = useCallback(async (id: string) => {
    setSelectedId(id);
    setDocSet(null);
    setLoadingDocSet(true);
    setError(null);
    try {
      const data = await apiService.getShipmentDocumentSet(id);
      setDocSet(data);
      // 阶段 D / D4：按需单据智能预勾选——CIF/CIP 保额可推断 → 保险单；存在信用证 → 受益人证明
      setSelectedDocs(prev => ({
        ...prev,
        INS: data.extras.insurance.insuredAmount !== null,
        BC: data.extras.letterOfCredit !== null,
      }));
    } catch (e: any) {
      setError(String(e?.message || e || '装配制单数据失败'));
    } finally {
      setLoadingDocSet(false);
    }
  }, []);

  // ── 生成打印 ──
  const handleGenerate = useCallback(() => {
    if (!docSet) return;
    setGenerating(true);
    try {
      const kinds = (Object.keys(selectedDocs) as ExportDocKind[]).filter(k => selectedDocs[k]);
      kinds.forEach((kind, i) => {
        const { title, render } = EXPORT_DOC_RENDERERS[kind];
        // 多文档连续打开窗口，错开避免浏览器合并弹窗
        setTimeout(() => {
          printHtmlDocument({
            title: `${title} - ${docSet.shipment.shipmentNumber}`,
            htmlBody: render(docSet),
          });
        }, i * 350);
      });
    } finally {
      setGenerating(false);
    }
  }, [docSet, selectedDocs]);

  const selectedCount = (Object.keys(selectedDocs) as ExportDocKind[]).filter(k => selectedDocs[k]).length;

  // ── 主题样式 ──
  const cardClass = isDarkMode
    ? `rounded-card border border-white/[0.055] bg-white/[0.018] ${BAMBOOK_OS.material.glassColor}`
    : `rounded-card border border-white/45 bg-white/24 ${BAMBOOK_OS.material.glassColor}`;
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const textPrimary = isDarkMode ? 'text-white' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const hoverRow = isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-white/50';

  return (
    <div className="w-full flex flex-col gap-4">
      {/* 运单选择区 */}
      <div className={`p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-3">
          <Ship size={14} className="text-[var(--os-vnext-brand-blue)]" />
          <h3 className={`text-xs font-light uppercase tracking-wider ${textSecondary}`}>选择运单 Select Shipment</h3>
          <button onClick={fetchShipments} className={`ml-auto p-1 rounded-control transition-colors ${textSecondary} ${hoverRow}`} title="刷新">
            <RefreshCw size={13} className={loadingList ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="relative mb-3">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索运单号 / 客户 / 目的港..."
            className={`${fieldClass} pl-9`}
          />
        </div>

        <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1">
          {loadingList ? (
            <div className={`flex items-center justify-center py-6 ${textSecondary}`}>
              <Loader2 size={16} className="animate-spin mr-2" /><span className="text-xs">加载运单...</span>
            </div>
          ) : filteredShipments.length === 0 ? (
            <div className={`text-center py-6 text-xs ${textSecondary}`}>无匹配运单</div>
          ) : (
            filteredShipments.map(s => (
              <button
                key={s.id}
                onClick={() => handleSelectShipment(s.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-left transition-colors ${
                  selectedId === s.id
                    ? 'bg-[var(--os-vnext-brand-blue)]/15 border border-[var(--os-vnext-brand-blue)]/40'
                    : `border border-transparent ${hoverRow}`
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-light truncate ${textPrimary}`}>{s.shipmentNumber}</div>
                  <div className={`text-[11px] font-light truncate ${textSecondary}`}>
                    {s.customerName || '—'} · {s.portOfLoading || '—'} → {s.portOfDischarge || '—'}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-light flex-shrink-0 ${
                  isDarkMode ? 'bg-white/[0.06] text-slate-300' : 'bg-black/[0.05] text-slate-600'
                }`}>{s.status}</span>
                <ChevronRight size={13} className={textSecondary} />
              </button>
            ))
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className={`flex items-start gap-2 p-3 rounded-card border ${isDarkMode ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-600'}`}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="text-xs font-light">{error}</span>
        </div>
      )}

      {/* 制单数据摘要 + 单据选择 */}
      <AnimatePresence>
        {loadingDocSet && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`flex items-center justify-center py-8 ${textSecondary}`}>
            <Loader2 size={16} className="animate-spin mr-2" /><span className="text-xs">装配制单数据...</span>
          </motion.div>
        )}

        {docSet && !loadingDocSet && (
          <motion.div key={docSet.shipment.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
            {/* 数据完整度 */}
            {docSet.missing.length > 0 && (
              <div className={`p-3 rounded-card border ${isDarkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={13} />
                  <span className="text-xs">数据完整度提示（仍可生成，缺失字段显示为 —）</span>
                </div>
                <ul className="text-[11px] font-light ml-5 list-disc space-y-0.5">
                  {docSet.missing.map(m => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}

            {/* 摘要 */}
            <div className={`p-4 ${cardClass}`}>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={14} className="text-[var(--os-vnext-brand-blue)]" />
                <h3 className={`text-xs font-light uppercase tracking-wider ${textSecondary}`}>制单数据摘要 Document Set</h3>
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2 text-[11px] font-light">
                <div><span className={textSecondary}>运单：</span><span className={textPrimary}>{docSet.shipment.shipmentNumber}</span></div>
                <div><span className={textSecondary}>订单：</span><span className={textPrimary}>{docSet.order?.poNumber || '—'}</span></div>
                <div><span className={textSecondary}>报关单：</span><span className={textPrimary}>{docSet.customs?.declarationNumber || '—'}</span></div>
                <div><span className={textSecondary}>客户：</span><span className={textPrimary}>{docSet.parties.customer?.name || '—'}</span></div>
                <div><span className={textSecondary}>行明细：</span><span className={textPrimary}>{docSet.lines.length} 行</span></div>
                <div><span className={textSecondary}>总金额：</span><span className={textPrimary}>{docSet.totals.amount !== null ? `${docSet.totals.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${docSet.totals.currency || ''}` : '—'}</span></div>
                <div><span className={textSecondary}>毛重：</span><span className={textPrimary}>{docSet.totals.grossWeight !== null ? `${docSet.totals.grossWeight} KGS` : '—'}</span></div>
                <div><span className={textSecondary}>体积：</span><span className={textPrimary}>{docSet.totals.volume !== null ? `${docSet.totals.volume} CBM` : '—'}</span></div>
              </div>
            </div>

            {/* 单据选择 */}
            <div className={`p-4 ${cardClass}`}>
              <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${textSecondary}`}>选择单据 Select Documents</h3>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {DOC_OPTIONS.map(({ kind, label, sub, icon: Icon }) => (
                  <button
                    key={kind}
                    onClick={() => setSelectedDocs(prev => ({ ...prev, [kind]: !prev[kind] }))}
                    className={`flex flex-col items-start gap-2 p-3 rounded-card border text-left transition-all ${
                      selectedDocs[kind]
                        ? 'border-[var(--os-vnext-brand-blue)]/50 bg-[var(--os-vnext-brand-blue)]/10'
                        : isDarkMode
                          ? 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                          : 'border-black/[0.05] bg-white/30 hover:bg-white/50'
                    }`}
                  >
                    <Icon size={16} strokeWidth={1.5} className={selectedDocs[kind] ? 'text-[var(--os-vnext-brand-blue)]' : textSecondary} />
                    <div>
                      <div className={`text-sm font-light ${textPrimary}`}>{label}</div>
                      <div className={`text-[10px] font-light ${textSecondary}`}>{sub}</div>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerate}
                disabled={selectedCount === 0 || generating}
                className={`mt-4 h-9 px-5 rounded-control text-xs font-light inline-flex items-center gap-2 transition-colors disabled:opacity-40 ${
                  isDarkMode
                    ? 'bg-[var(--os-vnext-brand-blue)]/80 hover:bg-[var(--os-vnext-brand-blue)] text-white'
                    : 'bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue)]/90 text-white'
                }`}
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                <span>生成并打印（{selectedCount} 份）</span>
              </button>
              <p className={`mt-2 text-[10px] font-light ${textSecondary}`}>
                每份单据将在独立窗口打开打印对话框，可选择"另存为 PDF"。
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ShipmentDocumentGenerator;
