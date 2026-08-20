/**
 * SampleRoomPanel.tsx — REQ2-16 样品间管理面板（DR-057）
 *
 * 挂载：DevelopmentManager 列表视图底部（样品域延伸：开发样→实物样卡库存；
 * App.tsx 冻结至 W5，故不新开页面，W5 后可升级独立页）。
 *
 * 交互：可折叠区块（默认收起）——
 *   样卡列表（状态筛选/搜索/二维码打印）+ 登记表单 + 借出/看样 BottomSheet + 归还/退役
 * 二维码：qrcode 库生成 PNG dataURL（载荷 = 样卡编号，扫码按编号直达详情）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as QRCode from 'qrcode';
import { ChevronDown, ChevronUp, Plus, QrCode, RotateCcw, Search, Archive } from 'lucide-react';
import BottomSheet from '../ui/BottomSheet';
import { bdsToast } from '../ui/bdsToast';
import { bdsConfirm } from '../ui/BdsDialog';
import { sampleRoomService, SampleCardItemView } from '../../services/sampleRoomService';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const CARD_TYPE_LABELS: Record<string, string> = {
  fabric: '面料', garment: '成衣', colorcard: '色卡', trim: '辅料', other: '其他',
};

const STATUS_LABELS: Record<string, string> = {
  in_stock: '在库', borrowed: '在借', retired: '已退役',
};

const STATUS_TONES: Record<string, string> = {
  in_stock: 'success', borrowed: 'info', retired: 'neutral',
};

interface SampleRoomPanelProps { isDarkMode: boolean; }

const EMPTY_ITEM_FORM = { name: '', cardType: 'fabric', colorCardCode: '', location: '', notes: '' };
const EMPTY_LOAN_FORM = { loanType: 'borrow' as 'borrow' | 'viewing', borrowerName: '', relationId: '', dueDate: '', conditionNote: '' };

const SampleRoomPanel: React.FC<SampleRoomPanelProps> = ({ isDarkMode }) => {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<SampleCardItemView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [showItemSheet, setShowItemSheet] = useState(false);
  const [itemForm, setItemForm] = useState({ ...EMPTY_ITEM_FORM });
  const [itemSaving, setItemSaving] = useState(false);

  const [loanTarget, setLoanTarget] = useState<SampleCardItemView | null>(null);
  const [loanForm, setLoanForm] = useState({ ...EMPTY_LOAN_FORM });
  const [loanSaving, setLoanSaving] = useState(false);

  const [qrItem, setQrItem] = useState<SampleCardItemView | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sampleRoomService.listItems({
        status: statusFilter || undefined,
        search: searchTerm.trim() || undefined,
        limit: 100,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (e: any) {
      setError(e.message || '样品间数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    if (expanded) reload();
  }, [expanded, reload]);

  const stats = useMemo(() => ({
    inStock: items.filter(i => i.status === 'in_stock').length,
    borrowed: items.filter(i => i.status === 'borrowed').length,
    overdue: items.filter(i => i.overdue).length,
  }), [items]);

  const handleCreateItem = async () => {
    if (!itemForm.name.trim() || itemSaving) return;
    setItemSaving(true);
    setError('');
    try {
      const item = await sampleRoomService.createItem({
        name: itemForm.name.trim(),
        cardType: itemForm.cardType,
        colorCardCode: itemForm.colorCardCode.trim() || undefined,
        location: itemForm.location.trim() || undefined,
        notes: itemForm.notes.trim() || undefined,
      });
      bdsToast.success(`样卡已登记：${item.code}`);
      setShowItemSheet(false);
      setItemForm({ ...EMPTY_ITEM_FORM });
      await reload();
      // 登记后直出二维码打印（DR-057-③：贴卡即用）
      openQr(item);
    } catch (e: any) {
      setError(e.message || '样卡登记失败');
    } finally {
      setItemSaving(false);
    }
  };

  const openQr = async (item: SampleCardItemView) => {
    setQrItem(item);
    setQrDataUrl('');
    try {
      const url = await QRCode.toDataURL(item.code, { margin: 1, width: 200, errorCorrectionLevel: 'M' });
      setQrDataUrl(url);
    } catch {
      setQrDataUrl('');
    }
  };

  const handleCreateLoan = async () => {
    if (!loanTarget || !loanForm.borrowerName.trim() || loanSaving) return;
    if (loanForm.loanType === 'viewing' && !loanForm.relationId.trim()) {
      setError('看样登记需选择客户');
      return;
    }
    setLoanSaving(true);
    setError('');
    try {
      const dueAt = loanForm.loanType === 'borrow' && loanForm.dueDate
        ? new Date(loanForm.dueDate).getTime()
        : undefined;
      await sampleRoomService.createLoan(loanTarget.id, {
        loanType: loanForm.loanType,
        borrowerName: loanForm.borrowerName.trim(),
        relationId: loanForm.loanType === 'viewing' ? loanForm.relationId.trim() : undefined,
        dueAt,
      });
      bdsToast.success(loanForm.loanType === 'borrow' ? `已借出：${loanTarget.code}` : `看样已登记：${loanTarget.code}`);
      setLoanTarget(null);
      setLoanForm({ ...EMPTY_LOAN_FORM });
      await reload();
    } catch (e: any) {
      setError(e.message || '借出/看样登记失败');
    } finally {
      setLoanSaving(false);
    }
  };

  const handleReturn = async (item: SampleCardItemView) => {
    if (!item.activeLoan) return;
    const note = await bdsConfirm({
      title: '归还登记',
      body: `归还样卡「${item.code} ${item.name}」？可在下方"其他"栏填写归还状态备注（损坏/缺失留痕）。`,
    });
    if (!note) return;
    try {
      await sampleRoomService.returnLoan(item.activeLoan.id);
      bdsToast.success(`已归还：${item.code}`);
      await reload();
    } catch (e: any) {
      bdsToast.danger(e.message || '归还失败');
    }
  };

  const handleRetire = async (item: SampleCardItemView) => {
    if (!(await bdsConfirm({ title: '确认退役', body: `样卡「${item.code} ${item.name}」退役？退役为终态，不可再借出/看样。`, danger: true }))) return;
    try {
      await sampleRoomService.retireItem(item.id);
      bdsToast.success(`已退役：${item.code}`);
      await reload();
    } catch (e: any) {
      bdsToast.danger(e.message || '退役失败');
    }
  };

  return (
    <div className="shrink-0">
      {/* 折叠头 */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="bds-btn bds-btn-ghost w-full justify-between px-4 h-11"
      >
        <span className="flex items-center gap-2 text-xs tracking-[0.14em] text-[var(--text-secondary)]">
          <QrCode size={14} />
          样品间 SAMPLE ROOM
          {expanded && !loading && (
            <span className="text-[10px] font-light text-[var(--text-tertiary)]">
              {total} 张 · 在库 {stats.inStock} · 在借 {stats.borrowed}{stats.overdue > 0 ? ` · 逾期 ${stats.overdue}` : ''}
            </span>
          )}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* 工具行：搜索 + 状态筛选 + 登记 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 max-w-64">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') reload(); }}
                placeholder="样卡名 / 编号 / 架位"
                className="bds-input pl-9 h-9 text-xs"
              />
            </div>
            <select className="bds-select w-28 h-9 text-xs shrink-0" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              <option value="in_stock">在库</option>
              <option value="borrowed">在借</option>
              <option value="retired">已退役</option>
            </select>
            <button type="button" className="bds-btn bds-btn-primary h-9 text-xs" onClick={() => { setShowItemSheet(true); setError(''); }}>
              <Plus size={14} />登记样卡
            </button>
          </div>

          {error && <div className="bds-alert danger text-xs">{error}</div>}
          {loading && <div className="text-xs font-light text-[var(--text-tertiary)] px-1">加载中...</div>}

          {/* 样卡列表 */}
          {!loading && items.length === 0 && (
            <div className="text-xs font-light text-[var(--text-tertiary)] px-1 py-3">
              暂无样卡。登记后自动生成样卡编号（二维码载荷），打印贴卡即用。
            </div>
          )}
          <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1.5">
            {items.map(item => (
              <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-compact bg-[var(--recessed-bg)] px-3 py-2 text-xs">
                <span className="font-light text-[var(--text-primary)] min-w-0 truncate max-w-52">{item.name}</span>
                <span className="text-[10px] font-light text-[var(--text-tertiary)]">{item.code}</span>
                <span className="text-[10px] font-light text-[var(--text-tertiary)]">{CARD_TYPE_LABELS[item.cardType] ?? item.cardType}</span>
                {item.location && <span className="text-[10px] font-light text-[var(--text-tertiary)]">{item.location}</span>}
                <span className={cx('bds-badge', STATUS_TONES[item.status] ?? 'neutral')}>
                  {STATUS_LABELS[item.status] ?? item.status}
                  {item.overdue ? ' · 逾期' : ''}
                </span>
                {item.activeLoan && (
                  <span className="text-[10px] font-light text-[var(--text-tertiary)] truncate max-w-44">
                    {item.activeLoan.borrowerName}{item.activeLoan.dueAt ? ` · 应还 ${new Date(item.activeLoan.dueAt).toLocaleDateString('zh-CN')}` : ''}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" className="bds-btn bds-btn-ghost h-7 px-2 text-[11px]" title="二维码打印" onClick={() => openQr(item)}>
                    <QrCode size={13} />
                  </button>
                  {item.status === 'in_stock' && (
                    <button
                      type="button"
                      className="bds-btn bds-btn-secondary h-7 px-2 text-[11px]"
                      onClick={() => { setLoanTarget(item); setLoanForm({ ...EMPTY_LOAN_FORM }); setError(''); }}
                    >
                      借出/看样
                    </button>
                  )}
                  {item.status === 'borrowed' && item.activeLoan && (
                    <button type="button" className="bds-btn bds-btn-secondary h-7 px-2 text-[11px]" onClick={() => handleReturn(item)}>
                      <RotateCcw size={13} />归还
                    </button>
                  )}
                  {item.status !== 'retired' && (
                    <button type="button" className="bds-btn bds-btn-ghost h-7 px-2 text-[11px]" title="退役" onClick={() => handleRetire(item)}>
                      <Archive size={13} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 登记样卡 BottomSheet */}
      {showItemSheet && (
        <BottomSheet isOpen onClose={() => !itemSaving && setShowItemSheet(false)} title="登记样卡" isDarkMode={isDarkMode}>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">样卡名称 *</label>
              <input value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} placeholder="面料名 / 色卡名 / 成衣款名" className="bds-input sm w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">类型</label>
                <select className="bds-select sm w-full" value={itemForm.cardType} onChange={e => setItemForm(f => ({ ...f, cardType: e.target.value }))}>
                  {Object.entries(CARD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">架位</label>
                <input value={itemForm.location} onChange={e => setItemForm(f => ({ ...f, location: e.target.value }))} placeholder="如 A-01" className="bds-input sm w-full" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">关联 Pantone 色号（可选）</label>
              <input value={itemForm.colorCardCode} onChange={e => setItemForm(f => ({ ...f, colorCardCode: e.target.value }))} placeholder="如 19-4052 TCX" className="bds-input sm w-full" />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">备注</label>
              <input value={itemForm.notes} onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))} placeholder="登记备注" className="bds-input sm w-full" />
            </div>
            <div className="text-[10px] font-light leading-relaxed text-[var(--text-tertiary)]">
              登记后自动生成样卡编号（SC-日期-序号）并弹出二维码，打印贴卡即用；扫码按编号直达样卡。
            </div>
            {error && <div className="bds-alert danger">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" disabled={itemSaving} onClick={() => setShowItemSheet(false)} className="bds-btn bds-btn-ghost">取消</button>
              <button type="button" disabled={itemSaving || !itemForm.name.trim()} onClick={handleCreateItem} className="bds-btn bds-btn-primary">
                {itemSaving ? '登记中...' : '登记并出二维码'}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {/* 借出/看样 BottomSheet */}
      {loanTarget && (
        <BottomSheet isOpen onClose={() => !loanSaving && setLoanTarget(null)} title={`借出 / 看样 · ${loanTarget.code}`} isDarkMode={isDarkMode}>
          <div className="space-y-4 px-6 py-5">
            <div className="flex flex-wrap gap-2">
              {([['borrow', '内部借出'], ['viewing', '客户看样']] as const).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setLoanForm(f => ({ ...f, loanType: type }))}
                  className={cx(loanForm.loanType === type ? 'bds-btn bds-btn-secondary' : 'bds-btn bds-btn-ghost')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">
                {loanForm.loanType === 'borrow' ? '借用人 *' : '看样联系人 *'}
              </label>
              <input value={loanForm.borrowerName} onChange={e => setLoanForm(f => ({ ...f, borrowerName: e.target.value }))} placeholder="姓名" className="bds-input sm w-full" />
            </div>
            {loanForm.loanType === 'viewing' && (
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">看样客户（Relation ID）*</label>
                <input value={loanForm.relationId} onChange={e => setLoanForm(f => ({ ...f, relationId: e.target.value }))} placeholder="客户 Relation ID（REL-xxx）" className="bds-input sm w-full" />
                <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">看样即看即还（不占借出状态），记录挂客户档案。</div>
              </div>
            )}
            {loanForm.loanType === 'borrow' && (
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">预计归还日</label>
                <input type="date" value={loanForm.dueDate} onChange={e => setLoanForm(f => ({ ...f, dueDate: e.target.value }))} className="bds-input sm w-auto" />
                <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">逾期（超过预计归还日未还）在列表标红提醒。</div>
              </div>
            )}
            {error && <div className="bds-alert danger">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" disabled={loanSaving} onClick={() => setLoanTarget(null)} className="bds-btn bds-btn-ghost">取消</button>
              <button type="button" disabled={loanSaving || !loanForm.borrowerName.trim()} onClick={handleCreateLoan} className="bds-btn bds-btn-primary">
                {loanSaving ? '登记中...' : loanForm.loanType === 'borrow' ? '确认借出' : '登记看样'}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {/* 二维码打印 BottomSheet（载荷 = 样卡编号） */}
      {qrItem && (
        <BottomSheet isOpen onClose={() => setQrItem(null)} title="样卡二维码" isDarkMode={isDarkMode}>
          <div className="space-y-4 px-6 py-5">
            <div className="flex flex-col items-center gap-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR ${qrItem.code}`} className="h-48 w-48 rounded-card bg-white p-2" />
              ) : (
                <div className="h-48 w-48 flex items-center justify-center text-xs text-[var(--text-tertiary)]">生成中...</div>
              )}
              <div className="text-center">
                <div className="text-sm font-light text-[var(--text-primary)]">{qrItem.name}</div>
                <div className="text-xs font-light text-[var(--text-tertiary)]">{qrItem.code}</div>
                {qrItem.location && <div className="text-[10px] font-light text-[var(--text-tertiary)]">架位 {qrItem.location}</div>}
              </div>
              <button type="button" className="bds-btn bds-btn-secondary" onClick={() => window.print()}>
                <QrCode size={14} />打印贴卡
              </button>
              <div className="text-[10px] font-light leading-relaxed text-[var(--text-tertiary)] text-center">
                二维码载荷为样卡编号 {qrItem.code}；扫码后在样品间按编号搜索直达该样卡。
              </div>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  );
};

export default SampleRoomPanel;
