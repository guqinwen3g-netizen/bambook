import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./FabricCalculatorPanel.tsx', import.meta.url), 'utf8');
const toolsSource = readFileSync(new URL('../BusinessTools.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../services/apiService.ts', import.meta.url), 'utf8');

describe('FabricCalculatorPanel REQ2-22（DR-062）', () => {
  it('三 Tab 分段：克重与纱支 / 门幅与用料 / 卷装与装柜', () => {
    expect(source).toContain("{ id: 'weight-yarn', label: '克重与纱支' }");
    expect(source).toContain("{ id: 'width-usage', label: '门幅与用料' }");
    expect(source).toContain("{ id: 'roll-container', label: '卷装与装柜' }");
    expect(source).toContain("className={cx('seg', tab === t.id && 'active')}");
  });

  it('六类计算卡片齐备：克重换算/纱支换算/理论克重/门幅与用料/卷装匹长/装柜计算', () => {
    expect(source).toContain('title="克重换算"');
    expect(source).toContain('title="纱支换算"');
    expect(source).toContain('title="理论克重"');
    expect(source).toContain('title="门幅与用料"');
    expect(source).toContain('title="卷装匹长"');
    expect(source).toContain('title="装柜计算"');
  });

  it('DR-062-① 派生值后端单一真源：useFabricCalc 防抖 300ms 调 apiService.calculateFabric，过期响应丢弃', () => {
    expect(source).toContain('apiService.calculateFabric(kind, buildInput())');
    expect(source).toContain('}, 300);');
    expect(source).toContain('if (reqId !== reqIdRef.current) return; // 过期响应丢弃');
    expect(source).toContain('DR-062-①：派生值后端单一真源');
  });

  it('六 kind 与后端契约一致', () => {
    for (const kind of ['weight-convert', 'yarn-convert', 'theoretical-weight', 'width-usage', 'roll-length', 'container-loading']) {
      expect(source).toContain(`'${kind}'`);
    }
  });

  it('公式说明行常驻（行业口径透明）', () => {
    expect(source).toContain('1 oz/yd² = 33.906 g/m²');
    expect(source).toContain('英支 Ne = 590.5 ÷ 旦尼尔 D');
    expect(source).toContain('40×40/133×72 府绸 ≈ 119 g/m²');
    expect(source).toContain('可装卷数 = min(柜实用容积 × 装载率 ÷ 卷体积, 柜载重 ÷ 卷重)');
  });

  it('BDS 控件：bds-input sm（字面类名，tokens 守卫可识别）/ CustomSelect（surface=form+compact 替代 bds-select sm）/ bds-segment seg / bds-alert danger', () => {
    expect(source).toContain("const inputClass = 'bds-input sm w-full'");
    expect(source).toContain('<CustomSelect');
    expect(source).toContain('surface="form"');
    expect(source).not.toContain('<select');
    expect(source).toContain('bds-segment');
    expect(source).toContain('bds-alert danger');
  });

  it('互斥输入联动：克重/码重二选一、卷重/匹长二选一（填一项清另一项）', () => {
    expect(source).toContain("setGsm(v); if (v.trim() !== '') setOzyd('')");
    expect(source).toContain("setRollWeightKg(v); if (v.trim() !== '') setLengthM('')");
  });

  it('BusinessTools 工具卡挂载（icon Ruler + 内嵌 Panel）', () => {
    expect(toolsSource).toContain("id: 'fabric-calculator'");
    expect(toolsSource).toContain('name: \'面料计算器\'');
    expect(toolsSource).toContain('component: <FabricCalculatorPanel isDarkMode={isDarkMode} />');
    expect(toolsSource).toContain('import FabricCalculatorPanel from');
  });

  it('apiService.calculateFabric 契约：POST /v1/tools/fabric-calculator/calculate', () => {
    expect(apiSource).toContain("`/v1/tools/fabric-calculator/calculate`");
    expect(apiSource).toContain('async calculateFabric(kind: string, input: Record<string, unknown>');
  });
});
