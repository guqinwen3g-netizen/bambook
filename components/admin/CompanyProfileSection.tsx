/**
 * CompanyProfileSection — AdminPanel「公司档案」Tab。
 *
 * 2026-08-18 §1A 裁决：exporterProfile 唯一真源 = 服务端 SystemConfig global::company.exporterProfile。
 * 写入口唯一 = AdminPanel（RBAC：仅 SUPER_ADMIN/ADMIN），本地 localStorage 降级为只读缓存。
 *
 * 铁律：本组件只读服务端，禁止写 localStorage 作为真源。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, RefreshCw, ShieldCheck, History, CircleAlert,
  Save,
} from 'lucide-react';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { hasPermission } from '../../services/authService';
import {
  apiService,
  type CompanyExporterProfileValue,
  type CompanyExporterProfileHistoryItem,
} from '../../services/apiService';
import { refreshExporterProfile } from '../tools/exportDocs/exporterProfile';

const BANK_FIELDS = ['bankName', 'swiftCode', 'bankAddress', 'usdAccountNumber'] as const;

type LoadState = 'loading' | 'ready' | 'error';

const formatDateTime = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { hour12: false });
};

export const CompanyProfileSection: React.FC = () => {
  const canWrite = hasPermission('admin:write');

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CompanyExporterProfileValue | null>(null);
  const [version, setVersion] = useState(0);
  const [isDefault, setIsDefault] = useState(false);

  const [history, setHistory] = useState<CompanyExporterProfileHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [form, setForm] = useState<CompanyExporterProfileValue>({
    nameEn: '', beneficiary: '', addressEn: '',
    bankName: '', swiftCode: '', bankAddress: '', usdAccountNumber: '',
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const card = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-settings-nested-panel bambook-outer-panel transition-[background,border-color,box-shadow] duration-300`;
  const labelCls = `text-xs ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.tone.text.formLabel}`;
  const inputCls = `w-full h-9 px-4 rounded-control outline-none transition-colors duration-200 ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.controls.recessedField.base}`;
  const actionControlCls = `h-9 rounded-full border text-xs ${BAMBOOK_OS.typography.weight.ui} transition-colors duration-200 ${BAMBOOK_OS.controls.actionControl.bordered}`;
  const primaryTextCls = 'text-[var(--text-primary)]';
  const secondaryTextCls = BAMBOOK_OS.tone.text.quiet;
  const weakTextCls = 'text-[var(--text-tertiary)]';
  const sectionDividerCls = BAMBOOK_OS.tone.divider.section;
  const iconWellCls = `flex h-9 w-9 shrink-0 items-center justify-center rounded-field border ${BAMBOOK_OS.tone.surface.quietIcon} border-[var(--border-c-subtle)] ${BAMBOOK_OS.tone.text.brandEmphasis}`;

  const loadProfile = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const res = await apiService.getCompanyExporterProfile();
      const v = res.value;
      setProfile(v);
      setVersion(res.version);
      setIsDefault(res.isDefault);
      setForm({
        nameEn: v.nameEn || '',
        beneficiary: v.beneficiary || '',
        addressEn: v.addressEn || '',
        bankName: v.bankName || '',
        swiftCode: v.swiftCode || '',
        bankAddress: v.bankAddress || '',
        usdAccountNumber: v.usdAccountNumber || '',
      });
      setLoadState('ready');
    } catch (e: any) {
      setLoadError(e?.message || '公司档案加载失败');
      setLoadState('error');
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const items = await apiService.listCompanyExporterProfileHistory({ limit: 50 });
      setHistory(items);
    } catch (e: any) {
      setHistory([]);
      setHistoryError(e?.message || '变更历史加载失败');
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadHistory();
  }, [loadProfile, loadHistory]);

  const nameEnValid = form.nameEn.trim().length > 0;

  const bankChanged = useMemo(() => {
    if (!profile) return false;
    return BANK_FIELDS.some(f => form[f] !== (profile[f] ?? ''));
  }, [form, profile]);

  const reasonRequired = bankChanged && reason.trim().length === 0;
  const formValid = nameEnValid && !reasonRequired;
  const valuesChanged = useMemo(() => {
    if (!profile) return false;
    return (Object.keys(form) as Array<keyof CompanyExporterProfileValue>)
      .some(k => form[k] !== (profile[k] ?? ''));
  }, [form, profile]);

  const handleSave = async () => {
    if (!formValid || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: { value: CompanyExporterProfileValue; reason?: string } = { value: form };
      if (bankChanged || reason.trim().length > 0) payload.reason = reason.trim();
      const res = await apiService.updateCompanyExporterProfile(payload);
      setVersion(res.version);
      setSaveMsg({ ok: true, text: '公司档案已更新（全公司生效）' });
      setReason('');
      await Promise.all([loadProfile(), loadHistory()]);
      void refreshExporterProfile(true);
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e?.message || '公司档案更新失败' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className={`text-sm font-light ${primaryTextCls}`}>
          公司档案
          <span className={`ml-2 text-xs ${weakTextCls}`}>Company Profile</span>
        </h3>
        <p className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>
          出口方信息与银行信息，用于 CI/PL/Contract/报价单等外贸单据。修改后全公司即时生效，每台客户端下次拉取时同步。
        </p>
      </div>

      {/* 当前配置 */}
      <div className={card + ' p-5'}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <div className={iconWellCls}>
              <Building2 size={16} strokeWidth={1.5} />
            </div>
            <span className={`text-sm font-light ${primaryTextCls}`}>当前配置</span>
            {isDefault && (
              <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--warning-tint)] text-[var(--warning-text)]">
                默认值（未自定义）
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { void loadProfile(); void loadHistory(); }}
            disabled={loadState === 'loading'}
            className={`px-3 inline-flex items-center gap-2 ${actionControlCls} disabled:opacity-50`}
          >
            <RefreshCw size={14} strokeWidth={1.75} className={loadState === 'loading' ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {loadState === 'loading' && (
          <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextCls}`}>
            正在读取公司档案...
          </div>
        )}

        {loadState === 'error' && (
          <div className="rounded-control border px-4 py-3 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)] border-transparent">
            <div className="flex items-center gap-2">
              <CircleAlert size={14} strokeWidth={1.75} />
              <span>{loadError}</span>
              <button type="button" onClick={() => { void loadProfile(); }} className={`ml-auto px-3 ${actionControlCls}`}>
                重试
              </button>
            </div>
          </div>
        )}

        {loadState === 'ready' && profile && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className={labelCls}>公司英文名（单据抬头）</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{profile.nameEn || '-'}</div>
            </div>
            <div>
              <div className={labelCls}>受益人名（银行/保险单据）</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{profile.beneficiary || '-'}</div>
            </div>
            <div className="sm:col-span-2">
              <div className={labelCls}>公司英文地址</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls} whitespace-pre-wrap`}>{profile.addressEn || '-'}</div>
            </div>
            <div>
              <div className={labelCls}>银行名称</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{profile.bankName || '-'}</div>
            </div>
            <div>
              <div className={labelCls}>SWIFT Code</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{profile.swiftCode || '-'}</div>
            </div>
            <div className="sm:col-span-2">
              <div className={labelCls}>银行地址</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{profile.bankAddress || '-'}</div>
            </div>
            <div>
              <div className={labelCls}>USD 账号</div>
              <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{profile.usdAccountNumber || '-'}</div>
            </div>
            <div>
              <div className={labelCls}>版本</div>
              <div className={`mt-1 font-mono text-xs ${secondaryTextCls}`}>v{version}</div>
            </div>
          </div>
        )}
      </div>

      {/* 编辑表单（仅管理员） */}
      {canWrite && loadState === 'ready' && (
        <div className={card + ' p-5 space-y-4'}>
          <div className="flex items-center gap-2">
            <div className={iconWellCls}>
              <ShieldCheck size={16} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <div className={`text-sm font-light ${primaryTextCls}`}>编辑档案</div>
              <p className={`mt-0.5 text-xs ${weakTextCls}`}>
                银行信息变更须填写变更理由（审计要求）。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>公司英文名（必填）</span>
              <input
                className={inputCls}
                value={form.nameEn}
                onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))}
                placeholder="JIANGSU PANDA CLOTHING CO.,LTD."
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>受益人名</span>
              <input
                className={inputCls}
                value={form.beneficiary}
                onChange={e => setForm(f => ({ ...f, beneficiary: e.target.value }))}
                placeholder="JIANGSU PANDA CLOTHING CO.,LTD."
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={labelCls}>公司英文地址</span>
              <textarea
                className={`${inputCls} min-h-[60px] resize-y`}
                value={form.addressEn}
                onChange={e => setForm(f => ({ ...f, addressEn: e.target.value }))}
                placeholder="ROOM A1028 WUYUE PLAZA,&#10;ZHANGJIAGANG CITY, 215600 PR&#10;CHINA"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>银行名称</span>
              <input
                className={inputCls}
                value={form.bankName}
                onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                placeholder="BANK OF CHINA ZHANGJIAGANG SUB-BRANCH"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>SWIFT Code</span>
              <input
                className={inputCls}
                value={form.swiftCode}
                onChange={e => setForm(f => ({ ...f, swiftCode: e.target.value }))}
                placeholder="BKCHCNBJ95L"
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={labelCls}>银行地址</span>
              <input
                className={inputCls}
                value={form.bankAddress}
                onChange={e => setForm(f => ({ ...f, bankAddress: e.target.value }))}
                placeholder="111 MIDDLE RENMIN ROAD, ZHANGJIAGANG CITY, SUZHOU, JIANGSU PROV., P.R.CHINA."
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>USD 账号</span>
              <input
                className={inputCls}
                value={form.usdAccountNumber}
                onChange={e => setForm(f => ({ ...f, usdAccountNumber: e.target.value }))}
                placeholder="467668133096"
              />
            </label>
          </div>

          <div>
            <label className={labelCls}>
              变更理由
              {bankChanged && <span className="ml-1 text-[var(--danger-text)]">*</span>}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              className={`${inputCls} mt-1 h-auto py-2 resize-none`}
              placeholder={bankChanged ? '银行信息变更须填写变更理由（审计要求）' : '如未变更银行信息，可留空'}
            />
            {reasonRequired && (
              <div className="mt-1 text-xs text-[var(--danger-text)]">
                银行信息变更必须填写变更理由。
              </div>
            )}
          </div>

          <div className={`flex items-center gap-2 pt-4 border-t ${sectionDividerCls}`}>
            <button
              type="button"
              onClick={handleSave}
              disabled={!formValid || !valuesChanged || saving}
              className={`px-4 inline-flex items-center gap-2 ${actionControlCls} disabled:opacity-50`}
            >
              <Save size={14} strokeWidth={1.75} />
              {saving ? '保存中...' : '保存变更'}
            </button>
            {formValid && !valuesChanged && (
              <span className={`text-xs ${weakTextCls}`}>配置与当前生效值一致，无需变更。</span>
            )}
          </div>

          {saveMsg && (
            <div className={`text-xs rounded-control px-3 py-2 border ${saveMsg.ok
              ? 'text-[var(--success-text)] bg-[var(--success-tint)] border-transparent'
              : 'text-[var(--danger-text)] bg-[var(--danger-tint)] border-transparent'}`}>
              {saveMsg.text}
            </div>
          )}
        </div>
      )}

      {!canWrite && loadState === 'ready' && (
        <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextCls}`}>
          当前账号无管理员权限，公司档案仅 SUPER_ADMIN/ADMIN 可编辑。
        </div>
      )}

      {/* 变更历史 */}
      <div className={card + ' p-5'}>
        <div className="flex items-center gap-2 mb-4">
          <div className={iconWellCls}>
            <History size={16} strokeWidth={1.5} />
          </div>
          <span className={`text-sm font-light ${primaryTextCls}`}>变更历史</span>
        </div>

        {historyError && (
          <div className="rounded-control border px-4 py-3 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)] border-transparent">
            <div className="flex items-center gap-2">
              <CircleAlert size={14} strokeWidth={1.75} />
              <span>{historyError}</span>
              <button type="button" onClick={() => { void loadHistory(); }} className={`ml-auto px-3 ${actionControlCls}`}>
                重试
              </button>
            </div>
          </div>
        )}

        {!historyError && history === null && (
          <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextCls}`}>
            正在读取变更历史...
          </div>
        )}

        {!historyError && history !== null && history.length === 0 && (
          <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextCls}`}>
            暂无变更记录。
          </div>
        )}

        {!historyError && history !== null && history.length > 0 && (
          <div className="space-y-3">
            {history.map(item => (
              <div key={item.id} className={`rounded-control border p-4 ${BAMBOOK_OS.tone.surface.linkedPanel}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`font-mono text-xs ${weakTextCls}`}>{formatDateTime(item.createdAt)}</span>
                  <span className={`font-mono text-xs ${secondaryTextCls}`}>{item.actorId || 'system'}</span>
                </div>
                <div className={`mt-2 text-xs ${secondaryTextCls}`}>
                  v{item.versionFrom} → v{item.versionTo}
                </div>
                <div className={`mt-1 text-xs ${weakTextCls}`}>
                  {item.reason || '无变更理由'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyProfileSection;
