/**
 * FabricCalculatorPanel — REQ2-22 面料计算器（IND-07 L1→L3，DR-062）
 *
 * 六类面料行业换算/估算：克重换算 / 纱支换算 / 理论克重 / 门幅与用料 / 卷装匹长 / 装柜计算。
 * DR-062-①：派生值一律后端单一真源（apiService.calculateFabric），前端只做输入与展示。
 * 设计真源：docs/design/04-模块设计/09-业务工具/BusinessTools-业务工具/面料计算器.md
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiService } from '../../services/apiService';
import CustomSelect from '../ui/CustomSelect';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type TabId = 'weight-yarn' | 'width-usage' | 'roll-container';
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'weight-yarn', label: '克重与纱支' },
  { id: 'width-usage', label: '门幅与用料' },
  { id: 'roll-container', label: '卷装与装柜' },
];

// ── 通用小组件 ─────────────────────────────────────────────────────

const labelClass = 'mb-1 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]';
const inputClass = 'bds-input sm w-full';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <div className="mt-1 text-[10px] font-light text-[var(--text-quaternary)]">{hint}</div>}
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      inputMode="decimal"
      placeholder={placeholder}
      className={inputClass}
    />
  );
}

function ResultRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-compact bg-[var(--recessed-bg-strong)] px-3 py-1.5 text-xs">
      <span className="font-light text-[var(--text-tertiary)]">{label}</span>
      <span className="font-light text-[var(--text-primary)]">
        {value}
        {unit && <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">{unit}</span>}
      </span>
    </div>
  );
}

/** 计算卡片骨架：标题 + 公式说明 + 内容（输入区/结果区由 CalcInputs/CalcResults 组合） */
function CalcCard({ title, formula, busy, error, children }: {
  title: string; formula?: string; busy?: boolean; error?: string | null; children: React.ReactNode;
}) {
  return (
    <section className="p-4 rounded-card bg-[var(--recessed-bg)]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-light text-[var(--text-primary)]">{title}</h3>
        {busy && <Loader2 size={14} className="animate-spin text-[var(--text-quaternary)]" />}
      </div>
      {formula && <p className="mb-3 text-[10px] leading-relaxed font-light text-[var(--text-quaternary)]">{formula}</p>}
      {children}
      {error && <div className="mt-3 bds-alert danger text-xs">{error}</div>}
    </section>
  );
}

/** 输入区：字段横排自适应换行 */
function CalcInputs({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

/** 结果区：只读展示后端返回值（DR-062-① 派生值单一真源） */
function CalcResults({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 space-y-1.5">{children}</div>;
}

/** 防抖后端计算 hook（DR-062-①：派生值后端单一真源） */
function useFabricCalc(kind: string, enabled: boolean, buildInput: () => Record<string, unknown>, token: string) {
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) { setResult(null); setError(null); return; }
    const timer = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      setBusy(true);
      try {
        const r = await apiService.calculateFabric(kind, buildInput());
        if (reqId !== reqIdRef.current) return; // 过期响应丢弃
        setResult(r);
        setError(null);
      } catch (e: any) {
        if (reqId !== reqIdRef.current) return;
        setResult(null);
        setError(e?.message ?? '计算失败');
      } finally {
        if (reqId === reqIdRef.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, enabled, token]);

  return { result, error, busy };
}

const fmt = (v: unknown, unit?: string): string => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit ?? ''}`;
};

// ── Tab 1：克重与纱支 ──────────────────────────────────────────────

function WeightConvertCard() {
  const [gsm, setGsm] = useState('180');
  const [ozyd, setOzyd] = useState('');
  const [widthCm, setWidthCm] = useState('150');
  const useGsm = gsm.trim() !== '';
  const input = useMemo(() => ({
    ...(useGsm ? { gsm: Number(gsm) } : { ozyd: Number(ozyd) }),
    ...(widthCm.trim() !== '' ? { widthCm: Number(widthCm) } : {}),
  }), [useGsm, gsm, ozyd, widthCm]);
  const token = `${useGsm}|${gsm}|${ozyd}|${widthCm}`;
  const { result, error, busy } = useFabricCalc('weight-convert', useGsm || ozyd.trim() !== '', () => input, token);
  return (
    <CalcCard title="克重换算" busy={busy} error={error}
      formula="1 oz/yd² = 33.906 g/m²；每米重量 = 克重 × 门幅(m)；公斤米数 = 1000 ÷ 每米重量">
      <CalcInputs>
      <Field label="克重 GSM *">
        <NumInput value={gsm} onChange={v => { setGsm(v); if (v.trim() !== '') setOzyd(''); }} placeholder="g/m²" />
      </Field>
      <Field label="码重 OZ">
        <NumInput value={ozyd} onChange={v => { setOzyd(v); if (v.trim() !== '') setGsm(''); }} placeholder="oz/yd²（与克重二选一）" />
      </Field>
      <Field label="门幅 CM">
        <NumInput value={widthCm} onChange={setWidthCm} placeholder="如 150" />
      </Field>
      </CalcInputs>
      <CalcResults>
        <ResultRow label="克重" value={fmt(result?.gsm)} unit="g/m²" />
        <ResultRow label="码重" value={fmt(result?.ozyd)} unit="oz/yd²" />
        <ResultRow label="每米重量" value={fmt(result?.gPerM)} unit="g/m" />
        <ResultRow label="每公斤米数" value={fmt(result?.mPerKg)} unit="m/kg" />
        <ResultRow label="每磅码数" value={fmt(result?.ydPerLb)} unit="yd/lb" />
      </CalcResults>
    </CalcCard>
  );
}

function YarnConvertCard() {
  const [value, setValue] = useState('40');
  const [from, setFrom] = useState('Ne');
  const enabled = value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
  const token = `${value}|${from}`;
  const { result, error, busy } = useFabricCalc('yarn-convert', enabled, () => ({ value: Number(value), from }), token);
  return (
    <CalcCard title="纱支换算" busy={busy} error={error}
      formula="英支 Ne = 590.5 ÷ 旦尼尔 D；公支 Nm = 1000 ÷ D；特克斯 tex = D ÷ 9">
      <CalcInputs>
      <Field label="纱支数值 *">
        <NumInput value={value} onChange={setValue} placeholder="如 40" />
      </Field>
      <Field label="输入制式 *">
        <CustomSelect
          surface="form"
          size="compact"
          className="w-full"
          value={from}
          onChange={v => setFrom(v)}
          ariaLabel="输入制式"
          options={[
            { value: 'Ne', label: '英支 Ne' },
            { value: 'D', label: '旦尼尔 D' },
            { value: 'Nm', label: '公支 Nm' },
            { value: 'tex', label: '特克斯 tex' },
          ]}
        />
      </Field>
      </CalcInputs>
      <CalcResults>
        <ResultRow label="英支" value={fmt(result?.results?.Ne)} unit="Ne" />
        <ResultRow label="旦尼尔" value={fmt(result?.results?.D)} unit="D" />
        <ResultRow label="公支" value={fmt(result?.results?.Nm)} unit="Nm" />
        <ResultRow label="特克斯" value={fmt(result?.results?.tex)} unit="tex" />
      </CalcResults>
    </CalcCard>
  );
}

function TheoreticalWeightCard() {
  const [warpDensity, setWarpDensity] = useState('133');
  const [weftDensity, setWeftDensity] = useState('72');
  const [densityUnit, setDensityUnit] = useState('per-in');
  const [warpYarn, setWarpYarn] = useState('40');
  const [weftYarn, setWeftYarn] = useState('40');
  const [yarnUnit, setYarnUnit] = useState('Ne');
  const [shrinkFactor, setShrinkFactor] = useState('1');
  const nums = [warpDensity, weftDensity, warpYarn, weftYarn].map(s => Number(s));
  const enabled = nums.every(n => Number.isFinite(n) && n > 0);
  const input = useMemo(() => ({
    warpDensity: Number(warpDensity), weftDensity: Number(weftDensity), densityUnit,
    warpYarn: Number(warpYarn), weftYarn: Number(weftYarn), yarnUnit,
    ...(shrinkFactor.trim() !== '' ? { shrinkFactor: Number(shrinkFactor) } : {}),
  }), [warpDensity, weftDensity, densityUnit, warpYarn, weftYarn, yarnUnit, shrinkFactor]);
  const token = `${warpDensity}|${weftDensity}|${densityUnit}|${warpYarn}|${weftYarn}|${yarnUnit}|${shrinkFactor}`;
  const { result, error, busy } = useFabricCalc('theoretical-weight', enabled, () => input, token);
  return (
    <CalcCard title="理论克重" busy={busy} error={error}
      formula="oz/yd² = (经密/经纱支 + 纬密/纬纱支) × 24/35；g/m² = oz/yd² × 33.906 × 织缩系数（实证：40×40/133×72 府绸 ≈ 119 g/m²）">
      <CalcInputs>
      <Field label="经密 *">
        <NumInput value={warpDensity} onChange={setWarpDensity} placeholder="如 133" />
      </Field>
      <Field label="纬密 *">
        <NumInput value={weftDensity} onChange={setWeftDensity} placeholder="如 72" />
      </Field>
      <Field label="密度单位">
        <CustomSelect
          surface="form"
          size="compact"
          className="w-full"
          value={densityUnit}
          onChange={v => setDensityUnit(v)}
          ariaLabel="密度单位"
          options={[
            { value: 'per-in', label: '根/英寸' },
            { value: 'per-10cm', label: '根/10cm' },
          ]}
        />
      </Field>
      <Field label="经纱支 *">
        <NumInput value={warpYarn} onChange={setWarpYarn} placeholder="如 40" />
      </Field>
      <Field label="纬纱支 *">
        <NumInput value={weftYarn} onChange={setWeftYarn} placeholder="如 40" />
      </Field>
      <Field label="纱支制式">
        <CustomSelect
          surface="form"
          size="compact"
          className="w-full"
          value={yarnUnit}
          onChange={v => setYarnUnit(v)}
          ariaLabel="纱支制式"
          options={[
            { value: 'Ne', label: '英支 Ne' },
            { value: 'D', label: '旦尼尔 D' },
          ]}
        />
      </Field>
      <Field label="织缩系数" hint="实际/理论，默认 1.0">
        <NumInput value={shrinkFactor} onChange={setShrinkFactor} placeholder="1.0" />
      </Field>
      </CalcInputs>
      <CalcResults>
        <ResultRow label="理论克重" value={fmt(result?.theoreticalGsm)} unit="g/m²" />
        <ResultRow label="理论码重" value={fmt(result?.theoreticalOzyd)} unit="oz/yd²" />
      </CalcResults>
    </CalcCard>
  );
}

// ── Tab 2：门幅与用料 ──────────────────────────────────────────────

function WidthUsageCard() {
  const [widthCm, setWidthCm] = useState('150');
  const [edgeLossCm, setEdgeLossCm] = useState('3');
  const [gsm, setGsm] = useState('180');
  const [lengthPerPieceM, setLengthPerPieceM] = useState('1.65');
  const [pieceAreaM2, setPieceAreaM2] = useState('');
  const nums = [widthCm, gsm, lengthPerPieceM].map(s => Number(s));
  const enabled = nums.every(n => Number.isFinite(n) && n > 0);
  const input = useMemo(() => ({
    widthCm: Number(widthCm), gsm: Number(gsm), lengthPerPieceM: Number(lengthPerPieceM),
    ...(edgeLossCm.trim() !== '' ? { edgeLossCm: Number(edgeLossCm) } : {}),
    ...(pieceAreaM2.trim() !== '' ? { pieceAreaM2: Number(pieceAreaM2) } : {}),
  }), [widthCm, edgeLossCm, gsm, lengthPerPieceM, pieceAreaM2]);
  const token = `${widthCm}|${edgeLossCm}|${gsm}|${lengthPerPieceM}|${pieceAreaM2}`;
  const { result, error, busy } = useFabricCalc('width-usage', enabled, () => input, token);
  return (
    <CalcCard title="门幅与用料" busy={busy} error={error}
      formula="可裁门幅 = 门幅 − 边损（默认 3cm）；单件用量 = 每米重量 × 用料长 ÷ 1000；排料利用率 = 净裁片面积 ÷ (可裁门幅 × 用料长)">
      <CalcInputs>
      <Field label="门幅 CM *">
        <NumInput value={widthCm} onChange={setWidthCm} placeholder="如 150" />
      </Field>
      <Field label="边损 CM" hint="双边合计，默认 3">
        <NumInput value={edgeLossCm} onChange={setEdgeLossCm} placeholder="3" />
      </Field>
      <Field label="克重 GSM *">
        <NumInput value={gsm} onChange={setGsm} placeholder="如 180" />
      </Field>
      <Field label="单件用料长 M *">
        <NumInput value={lengthPerPieceM} onChange={setLengthPerPieceM} placeholder="如 1.65" />
      </Field>
      <Field label="净裁片面积 M²" hint="选填，用于排料利用率">
        <NumInput value={pieceAreaM2} onChange={setPieceAreaM2} placeholder="选填" />
      </Field>
      </CalcInputs>
      <CalcResults>
        <ResultRow label="可裁门幅" value={fmt(result?.usableWidthCm)} unit="cm" />
        <ResultRow label="每米重量" value={fmt(result?.gPerM)} unit="g/m" />
        <ResultRow label="每公斤米数" value={fmt(result?.mPerKg)} unit="m/kg" />
        <ResultRow label="单件用量" value={fmt(result?.pieceWeightKg)} unit="kg" />
        <ResultRow label="千件用量" value={fmt(result?.perThousandKg)} unit="kg" />
        <ResultRow label="千件用料长" value={fmt(result?.perThousandM)} unit="m" />
        {result?.utilizationPct !== null && result?.utilizationPct !== undefined && (
          <ResultRow label="排料利用率" value={fmt(result?.utilizationPct)} unit="%" />
        )}
      </CalcResults>
    </CalcCard>
  );
}

// ── Tab 3：卷装与装柜 ──────────────────────────────────────────────

function RollLengthCard() {
  const [gsm, setGsm] = useState('180');
  const [widthCm, setWidthCm] = useState('150');
  const [rollWeightKg, setRollWeightKg] = useState('30');
  const [lengthM, setLengthM] = useState('');
  const baseNums = [gsm, widthCm].map(s => Number(s));
  const byWeight = rollWeightKg.trim() !== '' && lengthM.trim() === '';
  const byLength = lengthM.trim() !== '' && rollWeightKg.trim() === '';
  const enabled = baseNums.every(n => Number.isFinite(n) && n > 0) && (byWeight || byLength);
  const input = useMemo(() => ({
    gsm: Number(gsm), widthCm: Number(widthCm),
    ...(byWeight ? { rollWeightKg: Number(rollWeightKg) } : {}),
    ...(byLength ? { lengthM: Number(lengthM) } : {}),
  }), [gsm, widthCm, byWeight, rollWeightKg, byLength, lengthM]);
  const token = `${gsm}|${widthCm}|${byWeight}|${rollWeightKg}|${byLength}|${lengthM}`;
  const { result, error, busy } = useFabricCalc('roll-length', enabled, () => input, token);
  return (
    <CalcCard title="卷装匹长" busy={busy} error={error}
      formula="匹长 = 卷重 × 1000 ÷ (克重 × 门幅m)；卷重与匹长二选一，另一项由系统推算">
      <CalcInputs>
      <Field label="克重 GSM *">
        <NumInput value={gsm} onChange={setGsm} placeholder="如 180" />
      </Field>
      <Field label="门幅 CM *">
        <NumInput value={widthCm} onChange={setWidthCm} placeholder="如 150" />
      </Field>
      <Field label="卷重 KG" hint="与匹长二选一">
        <NumInput value={rollWeightKg} onChange={v => { setRollWeightKg(v); if (v.trim() !== '') setLengthM(''); }} placeholder="如 30" />
      </Field>
      <Field label="匹长 M" hint="与卷重二选一">
        <NumInput value={lengthM} onChange={v => { setLengthM(v); if (v.trim() !== '') setRollWeightKg(''); }} placeholder="如 100" />
      </Field>
      </CalcInputs>
      <CalcResults>
        <ResultRow label="匹长" value={fmt(result?.lengthM)} unit="m" />
        <ResultRow label="匹长（码）" value={fmt(result?.lengthYd)} unit="yd" />
        <ResultRow label="卷重" value={fmt(result?.rollWeightKg)} unit="kg" />
        <ResultRow label="卷重（磅）" value={fmt(result?.rollWeightLb)} unit="lb" />
        <ResultRow label="每米重量" value={fmt(result?.gPerM)} unit="g/m" />
      </CalcResults>
    </CalcCard>
  );
}

function ContainerLoadingCard() {
  const [containerType, setContainerType] = useState('20GP');
  const [rollDiameterCm, setRollDiameterCm] = useState('60');
  const [rollWidthCm, setRollWidthCm] = useState('152');
  const [rollWeightKg, setRollWeightKg] = useState('25');
  const [gsm, setGsm] = useState('');
  const [widthCm, setWidthCm] = useState('');
  const [loadingEfficiency, setLoadingEfficiency] = useState('0.9');
  const nums = [rollDiameterCm, rollWidthCm, rollWeightKg].map(s => Number(s));
  const hasLen = gsm.trim() !== '' && widthCm.trim() !== '';
  const enabled = nums.every(n => Number.isFinite(n) && n > 0);
  const input = useMemo(() => ({
    containerType,
    rollDiameterCm: Number(rollDiameterCm), rollWidthCm: Number(rollWidthCm), rollWeightKg: Number(rollWeightKg),
    ...(hasLen ? { gsm: Number(gsm), widthCm: Number(widthCm) } : {}),
    ...(loadingEfficiency.trim() !== '' ? { loadingEfficiency: Number(loadingEfficiency) } : {}),
  }), [containerType, rollDiameterCm, rollWidthCm, rollWeightKg, hasLen, gsm, widthCm, loadingEfficiency]);
  const token = `${containerType}|${rollDiameterCm}|${rollWidthCm}|${rollWeightKg}|${hasLen}|${gsm}|${widthCm}|${loadingEfficiency}`;
  const { result, error, busy } = useFabricCalc('container-loading', enabled, () => input, token);
  const bindLabel = result?.bindingConstraint === 'weight' ? '受载重约束' : '受容积约束';
  return (
    <CalcCard title="装柜计算" busy={busy} error={error}
      formula="卷体积 = π/4 × 卷径² × 卷宽（圆柱近似）；可装卷数 = min(柜实用容积 × 装载率 ÷ 卷体积, 柜载重 ÷ 卷重)；提供克重/门幅时联动匹长估算总米数">
      <CalcInputs>
      <Field label="柜型 *">
        <CustomSelect
          surface="form"
          size="compact"
          className="w-full"
          value={containerType}
          onChange={v => setContainerType(v)}
          ariaLabel="柜型"
          options={[
            { value: '20GP', label: '20GP（28m³ / 21.7t）' },
            { value: '40GP', label: '40GP（58m³ / 26.7t）' },
            { value: '40HQ', label: '40HQ（68m³ / 26.6t）' },
          ]}
        />
      </Field>
      <Field label="卷径 CM *">
        <NumInput value={rollDiameterCm} onChange={setRollDiameterCm} placeholder="如 60" />
      </Field>
      <Field label="卷宽 CM *">
        <NumInput value={rollWidthCm} onChange={setRollWidthCm} placeholder="如 152" />
      </Field>
      <Field label="卷重 KG *">
        <NumInput value={rollWeightKg} onChange={setRollWeightKg} placeholder="如 25" />
      </Field>
      <Field label="克重 GSM" hint="选填，与门幅一起推匹长">
        <NumInput value={gsm} onChange={setGsm} placeholder="选填" />
      </Field>
      <Field label="门幅 CM" hint="选填，与克重一起推匹长">
        <NumInput value={widthCm} onChange={setWidthCm} placeholder="选填" />
      </Field>
      <Field label="装载率" hint="0-1，默认 0.9">
        <NumInput value={loadingEfficiency} onChange={setLoadingEfficiency} placeholder="0.9" />
      </Field>
      </CalcInputs>
      <CalcResults>
        <ResultRow label="单卷体积" value={fmt(result?.rollVolumeM3)} unit="m³" />
        <ResultRow label="按体积可装" value={fmt(result?.byVolume)} unit="卷" />
        <ResultRow label="按重量可装" value={fmt(result?.byWeight)} unit="卷" />
        <ResultRow label="建议装载数" value={fmt(result?.recommendedRolls)} unit={`卷（${bindLabel}）`} />
        {result?.totalLengthM !== null && result?.totalLengthM !== undefined && (
          <ResultRow label="总米数" value={fmt(result?.totalLengthM)} unit="m" />
        )}
        <ResultRow label="总重量" value={fmt(result?.totalWeightKg)} unit="kg" />
        <ResultRow label="总体积" value={fmt(result?.totalVolumeM3)} unit="m³" />
      </CalcResults>
    </CalcCard>
  );
}

// ── 面板主体 ──────────────────────────────────────────────────────

interface FabricCalculatorPanelProps { isDarkMode: boolean; }

const FabricCalculatorPanel: React.FC<FabricCalculatorPanelProps> = () => {
  const [tab, setTab] = useState<TabId>('weight-yarn');
  return (
    <div className="w-full pb-6" data-os-compiler-page="fabric-calculator">
      {/* 标题行：中英组合 + 工具定位说明 */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-light text-[var(--text-primary)]">面料计算器</h2>
        <span className="text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">FABRIC CALCULATOR</span>
        <span className="text-[10px] font-light text-[var(--text-quaternary)]">克重/纱支/门幅/卷装/装柜 行业换算（结果由服务端计算）</span>
      </div>

      {/* 三 Tab 分段 */}
      <div className="bds-segment mb-4 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx('seg', tab === t.id && 'active')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="space-y-4">
        {tab === 'weight-yarn' && (
          <>
            <WeightConvertCard />
            <YarnConvertCard />
            <TheoreticalWeightCard />
          </>
        )}
        {tab === 'width-usage' && <WidthUsageCard />}
        {tab === 'roll-container' && (
          <>
            <RollLengthCard />
            <ContainerLoadingCard />
          </>
        )}
      </div>
    </div>
  );
};

export default FabricCalculatorPanel;
