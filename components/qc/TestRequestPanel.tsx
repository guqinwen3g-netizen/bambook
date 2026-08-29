/**
 * TestRequestPanel — REQ2-04 第三方测试管理面板（订单详情内嵌）
 *
 * 设计真源：docs/design/04-模块设计/03-订单与生产/QcWorkbench-QC质检中心/第三方测试管理.md
 *
 * 核心交互（3 击查看全部测试报告）：
 *   - 登记委托（测试项目 chips 多选 + 机构 + 送样日）
 *   - 报告 PDF 上传归档（D4 锚点）+ 点击下载/预览
 *   - 结论登记 pending→pass/fail（fail 强制：失败项多选 + 整改措施——100% 跟踪闭环锚点）
 *   - 整改追加与闭环（open→closed + 闭环说明）
 *
 * 设计：flat 无阴影、BDS 语义类、结论徽章 success/warning/danger 变体。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileText, FlaskConical, Loader2, Plus, Trash2, Upload, XCircle } from 'lucide-react';
import {
  qcService,
  TEST_AGENCIES,
  TEST_AGENCY_LABELS,
  TEST_ITEMS,
  TEST_ITEM_LABELS,
  type TestRequestRow,
  type TestRequestSummary,
} from '../../services/qcService';
import BottomSheet from '../ui/BottomSheet';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

function resultBadgeClass(result: string): string {
  if (result === 'pass') return 'bds-badge sm success';
  if (result === 'fail') return 'bds-badge sm danger';
  return 'bds-badge sm warning';
}

const RESULT_LABELS: Record<string, string> = { pending: '待报告', pass: '通过', fail: '不合格' };

interface TestRequestPanelProps {
  orderId: string;
  isDarkMode?: boolean;
}

export function TestRequestPanel({ orderId, isDarkMode = false }: TestRequestPanelProps) {
  const [items, setItems] = useState<TestRequestRow[]>([]);
  const [summary, setSummary] = useState<TestRequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 登记委托表单
  const [showCreate, setShowCreate] = useState(false);
  const [formItems, setFormItems] = useState<string[]>([]);
  const [formAgency, setFormAgency] = useState('sgs');
  const [formSent, setFormSent] = useState('');
  const [formExpected, setFormExpected] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // 结论登记表单
  const [concludeFor, setConcludeFor] = useState<TestRequestRow | null>(null);
  const [formResult, setFormResult] = useState<'pass' | 'fail'>('pass');
  const [formReportNo, setFormReportNo] = useState('');
  const [formReportDate, setFormReportDate] = useState('');
  const [formFailItems, setFormFailItems] = useState<string[]>([]);
  const [formCaFailItem, setFormCaFailItem] = useState('');
  const [formCaAction, setFormCaAction] = useState('');
  const [formCaOwner, setFormCaOwner] = useState('');
  const [formCaDue, setFormCaDue] = useState('');

  // 追加整改
  const [addCaFor, setAddCaFor] = useState<TestRequestRow | null>(null);
  const [caFailItem, setCaFailItem] = useState('');
  const [caAction, setCaAction] = useState('');
  const [caOwner, setCaOwner] = useState('');
  const [caDue, setCaDue] = useState('');

  // 整改闭环
  const [closeCa, setCloseCa] = useState<{ caId: string; trId: string } | null>(null);
  const [closeNote, setCloseNote] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadForRef = useRef<string | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-subtle)]';
  const cardBg = 'bg-[var(--recessed-bg)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await qcService.listTestRequests(orderId);
      setItems(data.items);
      setSummary(data.summary);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const toggleFormItem = (item: string) =>
    setFormItems(prev => (prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]));
  const toggleFailItem = (item: string) =>
    setFormFailItems(prev => (prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]));

  // R678⑧：登记委托弹层关闭时重置表单（原取消仅 setShowCreate(false)，重开残留上次输入）
  const closeCreate = useCallback(() => {
    setShowCreate(false);
    setFormItems([]); setFormAgency('sgs'); setFormSent(''); setFormExpected(''); setFormNotes('');
  }, []);

  /** R678⑧：表单 Enter 提交（input 内回车触发；textarea/按钮不触发，防误提交） */
  const enterToSubmit = (submit: () => void) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (!(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    submit();
  };

  const submitCreate = useCallback(async () => {
    if (acting) return;
    if (formItems.length === 0) { bdsToast.warning('请至少选择一个测试项目。'); return; }
    setActing('create');
    try {
      await qcService.createTestRequest({
        orderId,
        testItems: formItems,
        agency: formAgency,
        sentDate: formSent || undefined,
        expectedDate: formExpected || undefined,
        notes: formNotes || undefined,
      });
      bdsToast.success('测试委托已登记。');
      setShowCreate(false);
      setFormItems([]); setFormAgency('sgs'); setFormSent(''); setFormExpected(''); setFormNotes('');
      await load();
    } catch (e: any) {
      bdsToast.danger(`登记失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [acting, orderId, formItems, formAgency, formSent, formExpected, formNotes, load]);

  const openConclude = (r: TestRequestRow) => {
    setConcludeFor(r);
    setFormResult('pass');
    setFormReportNo(r.reportNo ?? '');
    setFormReportDate(r.reportDate ?? '');
    setFormFailItems([]);
    setFormCaFailItem(''); setFormCaAction(''); setFormCaOwner(''); setFormCaDue('');
  };

  const submitConclude = useCallback(async () => {
    if (!concludeFor || acting) return;
    if (formResult === 'fail') {
      if (formFailItems.length === 0) { bdsToast.warning('fail 结论必须勾选失败项。'); return; }
      if (!formCaFailItem) { bdsToast.warning('请选择整改挂载的失败项。'); return; }
      if (!formCaAction.trim()) { bdsToast.warning('整改措施必填（失败项 100% 跟踪闭环）。'); return; }
    }
    setActing('conclude');
    try {
      await qcService.updateTestRequest(concludeFor.id, {
        result: formResult,
        reportNo: formReportNo || undefined,
        reportDate: formReportDate || undefined,
        failItems: formResult === 'fail' ? formFailItems : undefined,
        correctiveAction: formResult === 'fail' ? {
          failItem: formCaFailItem,
          action: formCaAction.trim(),
          owner: formCaOwner || undefined,
          dueDate: formCaDue || undefined,
        } : undefined,
      });
      bdsToast.success(formResult === 'pass' ? '结论已登记：通过。' : '结论已登记：不合格 + 整改跟踪已建立。');
      setConcludeFor(null);
      await load();
    } catch (e: any) {
      bdsToast.danger(`结论登记失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [concludeFor, acting, formResult, formReportNo, formReportDate, formFailItems, formCaFailItem, formCaAction, formCaOwner, formCaDue, load]);

  const triggerUpload = (trId: string) => {
    uploadForRef.current = trId;
    fileInputRef.current?.click();
  };

  const handleFilesPicked = useCallback(async (files: FileList | null) => {
    const trId = uploadForRef.current;
    if (!trId || !files || files.length === 0) return;
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) { bdsToast.warning('仅支持 PDF 报告文件。'); return; }
    setActing(`upload-${trId}`);
    try {
      await qcService.uploadTestReport(trId, pdfs);
      bdsToast.success(`已归档 ${pdfs.length} 份报告。`);
      await load();
    } catch (e: any) {
      bdsToast.danger(`上传失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [load]);

  const submitAddCa = useCallback(async () => {
    if (!addCaFor || acting) return;
    if (!caFailItem) { bdsToast.warning('请选择失败项。'); return; }
    if (!caAction.trim()) { bdsToast.warning('整改措施必填。'); return; }
    setActing('add-ca');
    try {
      await qcService.addCorrectiveAction(addCaFor.id, {
        failItem: caFailItem, action: caAction.trim(), owner: caOwner || undefined, dueDate: caDue || undefined,
      });
      bdsToast.success('整改记录已追加。');
      setAddCaFor(null); setCaFailItem(''); setCaAction(''); setCaOwner(''); setCaDue('');
      await load();
    } catch (e: any) {
      bdsToast.danger(`追加失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [addCaFor, acting, caFailItem, caAction, caOwner, caDue, load]);

  const submitCloseCa = useCallback(async () => {
    if (!closeCa || acting) return;
    setActing('close-ca');
    try {
      await qcService.closeCorrectiveAction(closeCa.caId, closeNote || undefined);
      bdsToast.success('整改已闭环。');
      setCloseCa(null); setCloseNote('');
      await load();
    } catch (e: any) {
      bdsToast.danger(`闭环失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [closeCa, acting, closeNote, load]);

  const removeRequest = useCallback(async (r: TestRequestRow) => {
    const ok = await bdsConfirm({ title: '删除测试委托', body: `确认删除委托 ${r.trNo}？仅待报告状态可删除。`, danger: true });
    if (!ok) return;
    setActing(`del-${r.id}`);
    try {
      await qcService.deleteTestRequest(r.id);
      bdsToast.success('已删除。');
      await load();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message ?? e}`);
    } finally {
      setActing(null);
    }
  }, [load]);

  const chipCls = (active: boolean) => cx(
    'rounded-full border px-3 py-1 text-[11px] font-light transition-colors',
    active
      ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
      : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
  );

  return (
    <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] p-4">
      {/* 面板头 */}
      <div className="flex items-center gap-2">
        <FlaskConical size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>第三方测试</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>TEST REQUESTS</span>
        <div className="ml-auto flex items-center gap-2">
          {summary && (
            <span className={cx('text-[10px] font-light tabular-nums', textFaint)}>
              {summary.total} 项 · 通过 {summary.pass} / 不合格 {summary.fail} / 待报告 {summary.pending}
              {summary.openCorrectiveActions > 0 ? ` · 未闭环整改 ${summary.openCorrectiveActions}` : ''}
            </span>
          )}
          <button type="button" onClick={() => setShowCreate(true)} className="bds-btn bds-btn-secondary">
            <Plus size={14} strokeWidth={1.5} />登记委托
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={e => handleFilesPicked(e.target.files)}
      />

      {/* 内容区 */}
      {loading && (
        <div className={cx('flex items-center gap-2 py-8 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" />加载测试委托…
        </div>
      )}
      {!loading && error && (
        <div className="bds-alert warning mt-3">
          <span className="text-xs font-light">测试委托加载失败：{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className={cx('py-8 text-xs font-light', textFaint)}>
          本订单暂无第三方测试委托 · 登记 SGS/ITS/BV 送样检测后报告在此归档
        </div>
      )}
      {!loading && !error && items.map(r => {
        const openCas = r.correctiveActions.filter(c => c.status === 'open');
        return (
          <div key={r.id} className={cx('mt-3 rounded-field border p-3', divider, cardBg)}>
            {/* 委托行 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('text-xs font-light tabular-nums', textPrimary)}>{r.trNo}</span>
              <span className="bds-badge sm neutral">{TEST_AGENCY_LABELS[r.agency] ?? r.agency}</span>
              <span className={cx('bds-badge sm uppercase', resultBadgeClass(r.result))}>{RESULT_LABELS[r.result]}</span>
              {r.reportNo && <span className={cx('text-[11px] font-light tabular-nums', textSecondary)}>报告 {r.reportNo}</span>}
              <div className="ml-auto flex items-center gap-1.5">
                {r.result === 'pending' && (
                  <>
                    <button type="button" disabled={acting !== null} onClick={() => openConclude(r)} className="bds-btn bds-btn-ghost">
                      <CheckCircle2 size={14} strokeWidth={1.5} />登记结论
                    </button>
                    <button type="button" disabled={acting !== null} onClick={() => removeRequest(r)} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </>
                )}
                <button type="button" disabled={acting !== null} onClick={() => triggerUpload(r.id)} className="bds-btn bds-btn-ghost">
                  {acting === `upload-${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} strokeWidth={1.5} />}上传报告
                </button>
              </div>
            </div>

            {/* 项目 chips + 日期 */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.testItems.map(t => (
                <span key={t} className={cx('bds-badge sm', r.failItems.includes(t) ? 'danger' : 'neutral')}>
                  {TEST_ITEM_LABELS[t] ?? t}{r.failItems.includes(t) ? ' ✕' : ''}
                </span>
              ))}
              <span className={cx('ml-auto text-[10px] font-light', textFaint)}>
                送样 {r.sentDate ?? '—'} · 预计 {r.expectedDate ?? '—'}
              </span>
            </div>
            {r.notes && <div className={cx('mt-1.5 text-[11px] font-light', textSecondary)}>{r.notes}</div>}

            {/* 报告附件 */}
            {r.files.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {r.files.map(f => (
                  <a
                    key={f.id}
                    href={qcService.testReportDownloadUrl(r.id, f.id)}
                    target="_blank"
                    rel="noreferrer"
                    className={cx('bds-btn bds-btn-ghost', textSecondary)}
                    title={`${f.fileName}（${(f.fileSize / 1024).toFixed(0)} KB）`}
                  >
                    <FileText size={14} strokeWidth={1.5} />{f.fileName}
                  </a>
                ))}
              </div>
            )}

            {/* 整改记录 */}
            {r.correctiveActions.length > 0 && (
              <div className={cx('mt-2 space-y-1.5 border-t pt-2', divider)}>
                {r.correctiveActions.map(c => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                    <span className={cx('bds-badge sm', c.status === 'open' ? 'warning' : 'success')}>
                      {c.status === 'open' ? '整改中' : '已闭环'}
                    </span>
                    <span className={cx('text-[11px] font-light', textPrimary)}>
                      {TEST_ITEM_LABELS[c.failItem] ?? c.failItem}：{c.action}
                    </span>
                    {c.owner && <span className={cx('text-[10px] font-light', textFaint)}>by {c.owner}</span>}
                    {c.dueDate && <span className={cx('text-[10px] font-light', textFaint)}>期限 {c.dueDate}</span>}
                    {c.status === 'open' && (
                      <button
                        type="button"
                        disabled={acting !== null}
                        onClick={() => { setCloseCa({ caId: c.id, trId: r.id }); setCloseNote(''); }}
                        className="bds-btn bds-btn-ghost ml-auto"
                      >
                        <XCircle size={14} strokeWidth={1.5} />闭环
                      </button>
                    )}
                    {c.status === 'closed' && c.closeNote && (
                      <span className={cx('text-[10px] font-light', textFaint)}>闭环说明：{c.closeNote}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* fail 单：追加整改入口 */}
            {r.result === 'fail' && (
              <div className="mt-2">
                <button
                  type="button"
                  disabled={acting !== null}
                  onClick={() => { setAddCaFor(r); setCaFailItem(r.failItems[0] ?? ''); setCaAction(''); setCaOwner(''); setCaDue(''); }}
                  className="bds-btn bds-btn-ghost"
                >
                  <Plus size={14} strokeWidth={1.5} />追加整改
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* 登记委托 BottomSheet */}
      <BottomSheet isOpen={showCreate} onClose={closeCreate} title="登记测试委托">
        <div className="space-y-4 px-6 py-5" onKeyDown={enterToSubmit(submitCreate)}>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>测试项目 *</label>
            <div className="flex flex-wrap gap-1.5">
              {TEST_ITEMS.map((t, i) => (
                <button key={t} type="button" autoFocus={i === 0} onClick={() => toggleFormItem(t)} className={chipCls(formItems.includes(t))}>
                  {TEST_ITEM_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>委托机构 *</label>
            <div className="flex flex-wrap gap-1.5">
              {TEST_AGENCIES.map(a => (
                <button key={a} type="button" onClick={() => setFormAgency(a)} className={chipCls(formAgency === a)}>
                  {TEST_AGENCY_LABELS[a]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>送样日</label>
              <CapsuleDateInput value={formSent} onChange={setFormSent} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="送样日" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>预计报告日</label>
              <CapsuleDateInput value={formExpected} onChange={setFormExpected} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="预计报告日" />
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注</label>
            <input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="样品描述 / 客户特殊要求" className="bds-input sm w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeCreate} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitCreate} className="bds-btn bds-btn-primary">
              {acting === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}登记
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* 结论登记 BottomSheet */}
      <BottomSheet isOpen={concludeFor !== null} onClose={() => setConcludeFor(null)} title={`登记结论 · ${concludeFor?.trNo ?? ''}`}>
        <div className="space-y-4 px-6 py-5" onKeyDown={enterToSubmit(submitConclude)}>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>结论 *</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setFormResult('pass')} className={chipCls(formResult === 'pass')}>通过</button>
              <button type="button" onClick={() => setFormResult('fail')} className={chipCls(formResult === 'fail')}>不合格</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>报告编号</label>
              <input autoFocus value={formReportNo} onChange={e => setFormReportNo(e.target.value)} placeholder="如 SGS-RPT-001" className="bds-input sm w-56" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>报告日期</label>
              <CapsuleDateInput value={formReportDate} onChange={setFormReportDate} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="报告日期" />
            </div>
          </div>

          {formResult === 'fail' && concludeFor && (
            <>
              <div>
                <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>失败项 *（多选）</label>
                <div className="flex flex-wrap gap-1.5">
                  {concludeFor.testItems.map(t => (
                    <button key={t} type="button" onClick={() => toggleFailItem(t)} className={chipCls(formFailItems.includes(t))}>
                      {TEST_ITEM_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div className={cx('rounded-field border p-3', divider)}>
                <div className={cx('mb-2 text-[10px] tracking-[0.14em]', textSecondary)}>整改措施 *（失败项 100% 跟踪闭环）</div>
                <div className="space-y-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {formFailItems.map(t => (
                      <button key={t} type="button" onClick={() => setFormCaFailItem(t)} className={chipCls(formCaFailItem === t)}>
                        挂 {TEST_ITEM_LABELS[t]}
                      </button>
                    ))}
                    {formFailItems.length === 0 && <span className={cx('text-[11px] font-light', textFaint)}>先勾选失败项</span>}
                  </div>
                  <input value={formCaAction} onChange={e => setFormCaAction(e.target.value)} placeholder="如：面料返工修整后送 SGS 复测" className="bds-input sm w-full" />
                  <div className="flex flex-wrap gap-3">
                    <input value={formCaOwner} onChange={e => setFormCaOwner(e.target.value)} placeholder="责任人（如跟单小王）" className="bds-input sm w-44" />
                    <CapsuleDateInput value={formCaDue} onChange={setFormCaDue} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="整改期限" />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setConcludeFor(null)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitConclude} className="bds-btn bds-btn-primary">
              {acting === 'conclude' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.5} />}登记结论
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* 追加整改 BottomSheet */}
      <BottomSheet isOpen={addCaFor !== null} onClose={() => setAddCaFor(null)} title={`追加整改 · ${addCaFor?.trNo ?? ''}`}>
        <div className="space-y-4 px-6 py-5" onKeyDown={enterToSubmit(submitAddCa)}>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>失败项 *</label>
            <div className="flex flex-wrap gap-1.5">
              {(addCaFor?.failItems ?? []).map((t, i) => (
                <button key={t} type="button" autoFocus={i === 0} onClick={() => setCaFailItem(t)} className={chipCls(caFailItem === t)}>
                  {TEST_ITEM_LABELS[t] ?? t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>整改措施 *</label>
            <input value={caAction} onChange={e => setCaAction(e.target.value)} placeholder="如：让步接收 + 客户书面确认" className="bds-input sm w-full" />
          </div>
          <div className="flex flex-wrap gap-3">
            <input value={caOwner} onChange={e => setCaOwner(e.target.value)} placeholder="责任人" className="bds-input sm w-44" />
            <CapsuleDateInput value={caDue} onChange={setCaDue} isDarkMode={isDarkMode} className="bds-input sm w-auto" placeholder="整改期限" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAddCaFor(null)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitAddCa} className="bds-btn bds-btn-primary">
              {acting === 'add-ca' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}追加
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* 整改闭环 BottomSheet */}
      <BottomSheet isOpen={closeCa !== null} onClose={() => setCloseCa(null)} title="整改闭环">
        <div className="space-y-4 px-6 py-5" onKeyDown={enterToSubmit(submitCloseCa)}>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>闭环说明</label>
            <input autoFocus value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder="如：复测通过 pH 6.8" className="bds-input sm w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCloseCa(null)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={acting !== null} onClick={submitCloseCa} className="bds-btn bds-btn-primary">
              {acting === 'close-ca' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.5} />}确认闭环
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
