import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Ruler, ShieldCheck, History, CircleAlert, CircleCheck } from 'lucide-react';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { hasPermission } from '../../services/authService';
import {
  moqService,
  type MoqConfigHistoryItem,
  type MoqFallbackValues,
  type MoqThresholdConfigItem,
  type MoqValidateLineVerdict,
} from '../../services/moqService';

/**
 * MoqThresholdsPanel — AdminPanel「平台规则」Tab 的 MOQ 阈值板块。
 *
 * 2026-08-18 §1A 裁决：平台配置一律迁 AdminPanel（服务端真源 + RBAC），
 * 本组件自 Settings 的 compiledMoqThresholdsPanel 提级重写为普通组件（清 FR-004 compiled 遗留）。
 *
 * 契约（server/src/moq/moqRoute.ts，fail-closed）：
 *   GET  /api/v1/moq/config   — 当前生效配置（登录可读；无 active → fallback 兜底常量）
 *   PUT  /api/v1/moq/config   — 更新（scope settings:moq:write；changeReason ≥5 字；历史留痕）
 *   GET  /api/v1/moq/history  — append-only 变更历史
 *   POST /api/v1/moq/validate — dry-run 预检（不写库、不建审批单）
 *
 * dry-run 影响口径：以「现行阈值」为基准数量、以「拟变更阈值」为 snapshot 口径，
 * 三条探针行（fabric / garment / capsule 豁免档）评估新阈值对同量级单量的合规影响。
 * capsuleMoq 仅在 capsuleExemption 的成衣族行生效（moqResolutionService 层级 0），
 * 故 capsule 探针携带 capsuleExemption: true。
 */

const CHANGE_REASON_MIN = 5;

type LoadState = 'loading' | 'ready' | 'error';

interface DryRunProbe {
  key: 'fabric' | 'garment' | 'capsule';
  label: string;
  unit: string;
  quantity: number;
}

interface DryRunProbeResult {
  probe: DryRunProbe;
  verdict: MoqValidateLineVerdict;
}

const formatDateTime = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { hour12: false });
};

const formatQty = (n: number) => n.toLocaleString('zh-CN');

const severityLabel = (v: MoqValidateLineVerdict): string => {
  if (v.compliant) return '合规';
  if (v.severity === 'high') return '缺口 >80%';
  if (v.severity === 'medium') return '缺口 50-80%';
  return '缺口 ≤50%';
};

export const MoqThresholdsPanel: React.FC = () => {
  const canWrite = hasPermission('settings:moq:write');

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<MoqThresholdConfigItem | null>(null);
  const [fallback, setFallback] = useState<MoqFallbackValues | null>(null);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);

  const [history, setHistory] = useState<MoqConfigHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [fabricInput, setFabricInput] = useState('');
  const [garmentInput, setGarmentInput] = useState('');
  const [capsuleInput, setCapsuleInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');

  const [validating, setValidating] = useState(false);
  const [dryRunResults, setDryRunResults] = useState<DryRunProbeResult[] | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const effective = config ?? fallback;

  const card = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-settings-nested-panel bambook-outer-panel transition-[background,border-color,box-shadow] duration-300`;
  const labelCls = `text-[11px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.tone.text.formLabel}`;
  const inputCls = `w-full h-9 px-4 rounded-control outline-none transition-all ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.controls.recessedField.base}`;
  const actionControlCls = `h-9 rounded-full border text-xs ${BAMBOOK_OS.typography.weight.ui} transition-all ${BAMBOOK_OS.controls.actionControl.bordered}`;
  const primaryTextCls = 'text-[var(--text-primary)]';
  const secondaryTextCls = BAMBOOK_OS.tone.text.quiet;
  const weakTextCls = 'var(--text-tertiary)';
  const weakTextClsClass = 'text-[var(--text-tertiary)]';
  const sectionDividerCls = BAMBOOK_OS.tone.divider.section;
  const iconWellCls = `flex h-9 w-9 shrink-0 items-center justify-center rounded-field border ${BAMBOOK_OS.tone.surface.quietIcon} border-[var(--border-c-subtle)] ${BAMBOOK_OS.tone.text.brandEmphasis}`;

  const loadConfig = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const res = await moqService.getConfig();
      setConfig(res.item);
      setFallback(res.fallback);
      setFallbackMessage(res.message ?? null);
      const eff = res.item ?? res.fallback;
      if (eff) {
        setFabricInput(String(eff.fabricDefaultMoq));
        setGarmentInput(String(eff.garmentDefaultMoq));
        setCapsuleInput(String(eff.capsuleMoq));
      }
      setLoadState('ready');
    } catch (e: any) {
      setLoadError(e?.message || 'MOQ 配置加载失败');
      setLoadState('error');
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setHistory(await moqService.listHistory(50));
    } catch (e: any) {
      setHistory([]);
      setHistoryError(e?.message || '变更历史加载失败');
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadHistory();
  }, [loadConfig, loadHistory]);

  const parsed = useMemo(() => ({
    fabric: Number(fabricInput),
    garment: Number(garmentInput),
    capsule: Number(capsuleInput),
  }), [fabricInput, garmentInput, capsuleInput]);

  const valuesValid = [parsed.fabric, parsed.garment, parsed.capsule]
    .every(v => Number.isInteger(v) && v > 0);
  const reasonValid = reasonInput.trim().length >= CHANGE_REASON_MIN;
  const formValid = valuesValid && reasonValid;
  const valuesChanged = Boolean(effective) && (
    parsed.fabric !== effective!.fabricDefaultMoq
    || parsed.garment !== effective!.garmentDefaultMoq
    || parsed.capsule !== effective!.capsuleMoq
  );

  // 保存前 dry-run：以现行阈值为基准数量、拟变更阈值为 snapshot 口径，三探针行评估影响。
  const handleValidate = async () => {
    if (!effective || !valuesValid || validating) return;
    setValidating(true);
    setDryRunError(null);
    setDryRunResults(null);
    setSaveMsg(null);
    const snapshot = {
      fabricDefaultMoq: parsed.fabric,
      garmentDefaultMoq: parsed.garment,
      capsuleMoq: parsed.capsule,
    };
    const probes: DryRunProbe[] = [
      { key: 'fabric', label: '面料基准量', unit: '米', quantity: effective.fabricDefaultMoq },
      { key: 'garment', label: '成衣基准量', unit: '件', quantity: effective.garmentDefaultMoq },
      { key: 'capsule', label: 'Capsule 基准量', unit: '件', quantity: effective.capsuleMoq },
    ];
    try {
      const results = await Promise.all(probes.map(async (probe) => {
        const res = await moqService.validateDryRun({
          businessLine: probe.key === 'fabric' ? 'fabric' : 'garment',
          capsuleExemption: probe.key === 'capsule',
          snapshot,
          lines: [{ quantity: probe.quantity, unit: probe.unit }],
        });
        return { probe, verdict: res.lines[0] };
      }));
      setDryRunResults(results);
    } catch (e: any) {
      setDryRunError(e?.message || 'dry-run 预检失败');
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!formValid || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await moqService.updateConfig({
        fabricDefaultMoq: parsed.fabric,
        garmentDefaultMoq: parsed.garment,
        capsuleMoq: parsed.capsule,
        changeReason: reasonInput.trim(),
      });
      setSaveMsg({ ok: true, text: 'MOQ 阈值已更新（不追溯已确认单据）' });
      setReasonInput('');
      setDryRunResults(null);
      await Promise.all([loadConfig(), loadHistory()]);
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e?.message || 'MOQ 阈值更新失败' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 板块标题（中英双语） */}
      <div>
        <h3 className={`text-sm font-light ${primaryTextCls}`}>
          MOQ 阈值
          <span className={`ml-2 text-xs ${weakTextClsClass}`}>MOQ Thresholds</span>
        </h3>
        <p className={`mt-1 text-xs leading-relaxed ${weakTextClsClass}`}>
          最小起订量全局治理：面料（米）/ 成衣（件）/ Capsule 豁免档（件）。调整后仅作用于新单据，不追溯已确认单据；每次变更强制留痕。
        </p>
      </div>

      {/* ── 当前生效配置 ── */}
      <div className={card + ' p-5'}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <div className={iconWellCls}>
              <Ruler size={16} strokeWidth={1.5} />
            </div>
            <span className={`text-sm font-light ${primaryTextCls}`}>当前生效配置</span>
          </div>
          <button
            type="button"
            onClick={() => { void loadConfig(); void loadHistory(); }}
            disabled={loadState === 'loading'}
            className={`px-3 inline-flex items-center gap-2 ${actionControlCls} disabled:opacity-50`}
          >
            <RefreshCw size={14} strokeWidth={1.75} className={loadState === 'loading' ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {loadState === 'loading' && (
          <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextClsClass}`}>
            正在读取 MOQ 配置...
          </div>
        )}

        {loadState === 'error' && (
          <div className="rounded-control border px-4 py-3 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)] border-transparent">
            <div className="flex items-center gap-2">
              <CircleAlert size={14} strokeWidth={1.75} />
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => { void loadConfig(); }}
                className={`ml-auto px-3 ${actionControlCls}`}
              >
                重试
              </button>
            </div>
          </div>
        )}

        {loadState === 'ready' && effective && (
          <>
            {fallbackMessage && (
              <div className="mb-4 rounded-control border px-4 py-3 text-xs bg-[var(--warning-tint)] text-[var(--warning-text)] border-transparent">
                <div className="flex items-center gap-2">
                  <CircleAlert size={14} strokeWidth={1.75} />
                  <span>{fallbackMessage}</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {([
                { label: '面料默认 MOQ', unit: '米', value: effective.fabricDefaultMoq },
                { label: '成衣默认 MOQ', unit: '件', value: effective.garmentDefaultMoq },
                { label: 'Capsule MOQ', unit: '件', value: effective.capsuleMoq },
              ]).map(tile => (
                <div key={tile.label} className={`rounded-control border px-4 py-3 ${BAMBOOK_OS.tone.surface.inlinePanel}`}>
                  <div className={labelCls}>{tile.label}</div>
                  <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>
                    <span className="font-mono">{formatQty(tile.value)}</span>
                    <span className={`ml-1 text-[11px] ${weakTextClsClass}`}>{tile.unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className={`mt-4 pt-3 border-t ${sectionDividerCls} grid grid-cols-3 gap-3 text-[11px]`}>
              <div>
                <div className={labelCls}>生效时间</div>
                <div className={`mt-1 font-mono ${secondaryTextCls}`}>{formatDateTime(config?.effectiveFrom)}</div>
              </div>
              <div>
                <div className={labelCls}>最近变更人</div>
                <div className={`mt-1 font-mono ${secondaryTextCls}`}>{config?.changedBy || '-'}</div>
              </div>
              <div>
                <div className={labelCls}>变更原因</div>
                <div className={`mt-1 ${secondaryTextCls}`}>{config?.changeReason || '-'}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 调整阈值（仅 settings:moq:write 持有者可编辑） ── */}
      {canWrite && loadState === 'ready' && effective && (
        <div className={card + ' p-5 space-y-4'}>
          <div className="flex items-center gap-2">
            <div className={iconWellCls}>
              <ShieldCheck size={16} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <div className={`text-sm font-light ${primaryTextCls}`}>调整阈值</div>
              <p className={`mt-0.5 text-[11px] ${weakTextClsClass}`}>
                仅系统管理员可调；变更原因不少于 {CHANGE_REASON_MIN} 字，保存即写入 append-only 历史。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>面料默认 MOQ（米）</label>
              <input
                type="number"
                min={1}
                step={1}
                value={fabricInput}
                onChange={e => { setFabricInput(e.target.value); setDryRunResults(null); }}
                className={inputCls + ' mt-1 font-mono'}
              />
            </div>
            <div>
              <label className={labelCls}>成衣默认 MOQ（件）</label>
              <input
                type="number"
                min={1}
                step={1}
                value={garmentInput}
                onChange={e => { setGarmentInput(e.target.value); setDryRunResults(null); }}
                className={inputCls + ' mt-1 font-mono'}
              />
            </div>
            <div>
              <label className={labelCls}>Capsule MOQ（件）</label>
              <input
                type="number"
                min={1}
                step={1}
                value={capsuleInput}
                onChange={e => { setCapsuleInput(e.target.value); setDryRunResults(null); }}
                className={inputCls + ' mt-1 font-mono'}
              />
            </div>
          </div>
          {!valuesValid && (
            <div className={`text-[11px] text-[var(--danger-text)]`}>三个阈值均须为正整数。</div>
          )}

          <div>
            <label className={labelCls}>变更原因（≥{CHANGE_REASON_MIN} 字，审计强制）</label>
            <textarea
              value={reasonInput}
              onChange={e => setReasonInput(e.target.value)}
              rows={2}
              className={`${inputCls} mt-1 h-auto py-2 resize-none`}
              placeholder="例如：旺季产能调整，面料起订量上调至 900 米"
            />
            {!reasonValid && reasonInput.length > 0 && (
              <div className={`mt-1 text-[11px] text-[var(--danger-text)]`}>
                变更原因至少 {CHANGE_REASON_MIN} 字（当前 {reasonInput.trim().length} 字）。
              </div>
            )}
          </div>

          <div className={`flex items-center gap-2 pt-1 border-t ${sectionDividerCls} pt-4`}>
            <button
              type="button"
              onClick={handleValidate}
              disabled={!valuesValid || validating || saving}
              className={`px-4 inline-flex items-center gap-2 ${actionControlCls} disabled:opacity-50`}
            >
              {validating ? '预检中...' : '预检影响（dry-run）'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!formValid || !valuesChanged || saving || validating}
              className={`px-4 ${actionControlCls} disabled:opacity-50`}
            >
              {saving ? '保存中...' : '保存变更'}
            </button>
            {valuesValid && !valuesChanged && (
              <span className={`text-[11px] ${weakTextClsClass}`}>阈值与当前生效值一致，无需变更。</span>
            )}
          </div>

          {dryRunError && (
            <div className="rounded-control border px-4 py-3 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)] border-transparent">
              <div className="flex items-center gap-2">
                <CircleAlert size={14} strokeWidth={1.75} />
                <span>{dryRunError}</span>
              </div>
            </div>
          )}

          {dryRunResults && (
            <div className={`rounded-control border p-4 space-y-2 ${BAMBOOK_OS.tone.surface.linkedPanel}`}>
              <div className={`text-[11px] ${weakTextClsClass}`}>
                dry-run 不写库、不建审批单：以现行阈值为基准数量，用拟变更阈值口径评估三条业务线。
              </div>
              {dryRunResults.map(({ probe, verdict }) => (
                <div key={probe.key} className="flex items-center gap-3 text-xs">
                  {verdict.compliant
                    ? <CircleCheck size={14} strokeWidth={1.75} className="text-[var(--success-text)] shrink-0" />
                    : <CircleAlert size={14} strokeWidth={1.75} className="text-[var(--danger-text)] shrink-0" />}
                  <span className={secondaryTextCls}>{probe.label}</span>
                  <span className={`font-mono ${weakTextClsClass}`}>
                    {formatQty(verdict.quantity)} {probe.unit} → 新阈值 {formatQty(verdict.effectiveMoq)} {probe.unit}
                  </span>
                  <span className={`ml-auto ${verdict.compliant ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}`}>
                    {verdict.compliant ? '仍合规' : `不再合规（${severityLabel(verdict)}，缺口 ${verdict.gapPct}%）`}
                  </span>
                </div>
              ))}
            </div>
          )}

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
        <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextClsClass}`}>
          当前账号无 settings:moq:write 权限，阈值仅系统管理员可调整；如需变更请联系管理员。
        </div>
      )}

      {/* ── 变更历史（append-only 时间线） ── */}
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
              <button
                type="button"
                onClick={() => { void loadHistory(); }}
                className={`ml-auto px-3 ${actionControlCls}`}
              >
                重试
              </button>
            </div>
          </div>
        )}

        {!historyError && history === null && (
          <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextClsClass}`}>
            正在读取变更历史...
          </div>
        )}

        {!historyError && history !== null && history.length === 0 && (
          <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} ${weakTextClsClass}`}>
            暂无变更记录。
          </div>
        )}

        {!historyError && history !== null && history.length > 0 && (
          <div className="space-y-3">
            {history.map(item => (
              <div key={item.id} className={`rounded-control border p-4 ${BAMBOOK_OS.tone.surface.linkedPanel}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`font-mono text-[11px] ${weakTextClsClass}`}>{formatDateTime(item.changedAt)}</span>
                  <span className={`font-mono text-[11px] ${secondaryTextCls}`}>{item.changedBy}</span>
                </div>
                <div className={`mt-2 grid grid-cols-3 gap-3 text-[11px] ${secondaryTextCls}`}>
                  <div>
                    <span className={weakTextClsClass}>面料（米） </span>
                    <span className="font-mono">{formatQty(item.beforeFabricDefaultMoq)} → {formatQty(item.afterFabricDefaultMoq)}</span>
                  </div>
                  <div>
                    <span className={weakTextClsClass}>成衣（件） </span>
                    <span className="font-mono">{formatQty(item.beforeGarmentDefaultMoq)} → {formatQty(item.afterGarmentDefaultMoq)}</span>
                  </div>
                  <div>
                    <span className={weakTextClsClass}>Capsule（件） </span>
                    <span className="font-mono">{formatQty(item.beforeCapsuleMoq)} → {formatQty(item.afterCapsuleMoq)}</span>
                  </div>
                </div>
                <div className={`mt-2 text-xs ${secondaryTextCls}`}>{item.changeReason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MoqThresholdsPanel;
