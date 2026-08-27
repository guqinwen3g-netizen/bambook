import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleService } from '../services/sampleService';
import { qcService } from '../services/qcService';

/**
 * Phase 3 Wave 3.2 Track D — 样品域 + QC 双链域 runtime QA
 *
 * 消费已 merged contract：
 *   /api/v1/samples/*（server/src/samples/sampleRoute.ts：S/S 船样 + RC 匹头样 / 早期生产样 / 服装多轮双门禁）
 *   /api/v1/qc/*（server/src/qc/qcRoute.ts：DR-029 双链评审 + DR-008 门禁 + 报告双签）
 *
 * Part 1: sampleService 运行时契约（mock fetch，对齐 moqThresholdSettingsRuntimeQa 模式）
 * Part 2: qcService 运行时契约（mock fetch）
 * Part 3: UI 源码契约（QcWorkbenchManager 双链隔离 / SampleNodesPanel 双门禁 / DevelopmentManager 接线）
 * Part 4: 设计纪律（无 hex / rounded-[Npx] / box-shadow / 过重字重 / emoji）
 */

const fs = require('fs');
const path = require('path');
const QC_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'QcWorkbenchManager.tsx'), 'utf-8');
const SAMPLE_PANEL_SRC = fs.readFileSync(path.resolve(__dirname, 'development/SampleNodesPanel.tsx'), 'utf-8');
const DEV_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'DevelopmentManager.tsx'), 'utf-8');

const ENDPOINT = 'https://test.example.com';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

function mockFetchOk(payload: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockFetchError(status: number, payload: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: false,
    status,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ═══ Part 1: sampleService runtime（mock fetch） ═══
describe('runtime QA [sampleService]: HTTP contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('listGarmentRounds GET /v1/samples/garment/:caseId/rounds → items + sealedRoundId', async () => {
    const fetchMock = mockFetchOk({ items: [{ id: 'r1', round: 1, status: 'in_progress' }], sealedRoundId: 'r1' });
    const res = await sampleService.listGarmentRounds('case1', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/garment/case1/rounds');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(res.items).toHaveLength(1);
    expect(res.sealedRoundId).toBe('r1');
  });

  it('createGarmentRound POST rounds（purpose/version/materialConfig 必填透传）', async () => {
    const fetchMock = mockFetchOk({ round: { id: 'r1', round: 1, status: 'in_progress' } });
    const input = { purpose: '初样', version: 'V1', materialConfig: '面料A + 工艺B' };
    const round = await sampleService.createGarmentRound('case1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/garment/case1/rounds');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(round.id).toBe('r1');
  });

  it('submitGarmentQcConclusion POST submit-qc（DR-008 内部门禁第一步）', async () => {
    const fetchMock = mockFetchOk({ round: { id: 'r1', status: 'qc_passed', qcStatus: 'passed' } });
    const input = { result: 'passed' as const, qcNote: '尺寸 OK' };
    const round = await sampleService.submitGarmentQcConclusion('r1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/garment/r1/submit-qc');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(round.qcStatus).toBe('passed');
  });

  it('submitGarmentToCustomer POST submit-customer（DR-039 快递要素）', async () => {
    const fetchMock = mockFetchOk({ round: { id: 'r1', status: 'submitted' } });
    const input = { courier: 'DHL', trackingNumber: '123456', recipientName: '客户跟单', sentDate: '2026-08-16' };
    await sampleService.submitGarmentToCustomer('r1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/garment/r1/submit-customer');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it('submitGarmentToCustomer 409 QC_GATE_NOT_PASSED → 透出服务端 message（fail-closed，不伪成功）', async () => {
    mockFetchError(409, { error: { code: 'QC_GATE_NOT_PASSED', message: '内部门禁未通过：请先提交 QC 评审（DR-008 fail-closed）' } });
    await expect(
      sampleService.submitGarmentToCustomer('r1', { courier: 'DHL', trackingNumber: '1', recipientName: '客户' }, ENDPOINT),
    ).rejects.toThrow('内部门禁未通过');
  });

  it('registerGarmentCustomerConfirmation POST register-customer-confirmation（业务员登记）', async () => {
    const fetchMock = mockFetchOk({ round: { id: 'r1', status: 'confirmed', customerStatus: 'approved' } });
    const input = { result: 'approved' as const, confirmationDate: '2026-08-16', channel: 'email' };
    const round = await sampleService.registerGarmentCustomerConfirmation('r1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/garment/r1/register-customer-confirmation');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(round.customerStatus).toBe('approved');
  });

  it('sealGarmentRound POST seal（封存产前样生产基准）', async () => {
    const fetchMock = mockFetchOk({ round: { id: 'r1', status: 'sealed', sealedAt: 1786900000000 } });
    const round = await sampleService.sealGarmentRound('r1', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/garment/r1/seal');
    expect(init?.method).toBe('POST');
    expect(round.status).toBe('sealed');
  });

  it('registerShipmentSample POST /v1/samples/fabric/:orderId/shipment-sample（DR-011 S/S 登记）', async () => {
    const fetchMock = mockFetchOk({ sample: { id: 's1', sampleCode: 'FSS-20260816-001', sampleKind: 'SS' } });
    const input = { sampleQuantity: 2, cuttingDate: '2026-08-16' };
    const sample = await sampleService.registerShipmentSample('ord1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/fabric/ord1/shipment-sample');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(sample.sampleKind).toBe('SS');
  });

  it('registerSampleShipment + registerCustomerConfirmation（S/S 与 RC 共用 /:id/ship /:id/confirm）', async () => {
    const shipMock = mockFetchOk({ sample: { id: 's1', sentToCustomer: true } });
    const shipInput = { courier: 'SF', trackingNumber: 'SF001', recipientName: '客户' };
    await sampleService.registerSampleShipment('s1', shipInput, ENDPOINT);
    const [shipUrl, shipInit] = shipMock.mock.calls[0];
    expect(shipUrl).toContain('/v1/samples/s1/ship');
    expect(shipInit?.method).toBe('POST');
    expect(JSON.parse(String(shipInit?.body))).toEqual(shipInput);

    const confirmMock = mockFetchOk({ sample: { id: 's1', customerStatus: 'approved' } });
    const confirmInput = { result: 'approved' as const, confirmationDate: '2026-08-16', channel: 'wechat' };
    await sampleService.registerCustomerConfirmation('s1', confirmInput, ENDPOINT);
    const [confirmUrl, confirmInit] = confirmMock.mock.calls[0];
    expect(confirmUrl).toContain('/v1/samples/s1/confirm');
    expect(confirmInit?.method).toBe('POST');
    expect(JSON.parse(String(confirmInit?.body))).toEqual(confirmInput);
  });

  it('listOrderSamples GET /v1/samples/fabric/:orderId/samples（含 Exmill 倒计时投影）', async () => {
    const fetchMock = mockFetchOk({ items: [{ id: 's1', sampleKind: 'SS', countdown: { overdue: false } }] });
    const items = await sampleService.listOrderSamples('ord1', ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/samples/fabric/ord1/samples');
    expect(items).toHaveLength(1);
    expect(items[0].countdown.overdue).toBe(false);
  });

  it('createEarlyProductionSample + confirmEarlyProductionSample（DR-028 闭环链）', async () => {
    const createMock = mockFetchOk({ sample: { id: 'e1', sampleCode: 'EPS-20260816-001' } });
    const createInput = { sampleQuantity: 1, cuttingDate: '2026-08-16', productionStage: 'after_dyeing' };
    await sampleService.createEarlyProductionSample('ord1', createInput, ENDPOINT);
    const [createUrl, createInit] = createMock.mock.calls[0];
    expect(createUrl).toContain('/v1/samples/early-production/ord1/rounds');
    expect(createInit?.method).toBe('POST');
    expect(JSON.parse(String(createInit?.body))).toEqual(createInput);

    const feedbackMock = mockFetchOk({ sample: { id: 'e1', customerStatus: 'adjust_and_resend' } });
    const feedbackInput = { result: 'adjust_and_resend' as const, confirmationDate: '2026-08-16', channel: 'email' };
    const sample = await sampleService.confirmEarlyProductionSample('e1', feedbackInput, ENDPOINT);
    const [feedbackUrl, feedbackInit] = feedbackMock.mock.calls[0];
    expect(feedbackUrl).toContain('/v1/samples/early-production/rounds/e1/feedback');
    expect(feedbackInit?.method).toBe('POST');
    expect(JSON.parse(String(feedbackInit?.body))).toEqual(feedbackInput);
    expect(sample.customerStatus).toBe('adjust_and_resend');
  });
});

// ═══ Part 2: qcService runtime（mock fetch） ═══
describe('runtime QA [qcService]: HTTP contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('reviewGarmentSample POST /v1/qc/chain/garment/:orderId/review（文本意见必填）', async () => {
    const fetchMock = mockFetchOk({ report: { id: 'INR__ord1__smp__pp__r1' }, gate: { passed: true } });
    const input = { sampleLevel: 'pp' as const, round: 1, conclusion: 'pass' as const, opinion: '做工良好' };
    const res = await qcService.reviewGarmentSample('ord1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/qc/chain/garment/ord1/review');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(res.gate.passed).toBe(true);
  });

  it('directRejectGarmentSample POST direct-reject（QC-29-A4 rejectReason 透传）', async () => {
    const fetchMock = mockFetchOk({ report: { id: 'r1' }, gate: { passed: false, blockedCode: 'SAMPLE_DIRECTLY_REJECTED' } });
    const input = { round: 2, conclusion: 'fail' as const, opinion: '严重色差', directReject: true, rejectReason: '色差超_acceptance' };
    const res = await qcService.directRejectGarmentSample('ord1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/qc/chain/garment/ord1/direct-reject');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(res.gate.blockedCode).toBe('SAMPLE_DIRECTLY_REJECTED');
  });

  it('reviewFabricSample POST /v1/qc/chain/fabric/:orderId/review（sampleId + factoryAdjustment 透传）', async () => {
    const fetchMock = mockFetchOk({ report: { id: 'INR__ord1__fqc__s1__1' } });
    const input = {
      sampleKind: 'SS' as const,
      sampleId: 's1',
      conclusion: 'conditional' as const,
      opinion: '需复染',
      factoryAdjustment: { requirement: '复染加深 5%', factoryName: '宏润染厂', followUpBy: 'QC 张三' },
    };
    const res = await qcService.reviewFabricSample('ord1', input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/qc/chain/fabric/ord1/review');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(res.report.id).toContain('fqc');
  });

  it('reviewFabricSample 400 FACTORY_ADJUSTMENT_REQUIRED → 透出服务端 message', async () => {
    mockFetchError(400, { error: { code: 'FACTORY_ADJUSTMENT_REQUIRED', message: '评审结论非 pass 时 factoryAdjustment.requirement（对工厂的技术调整要求）必填' } });
    await expect(
      qcService.reviewFabricSample('ord1', { sampleKind: 'SS', sampleId: 's1', conclusion: 'fail', opinion: '不合格' }, ENDPOINT),
    ).rejects.toThrow('factoryAdjustment.requirement');
  });

  it('reviewGarmentSample 409 ROUND_ALREADY_REVIEWED → 透出服务端 message（每轮报告独立不可覆盖）', async () => {
    mockFetchError(409, { error: { code: 'ROUND_ALREADY_REVIEWED', message: '第 1 轮 pp 样品已有 QC 评审报告；每轮报告独立不可覆盖（REL-14-A1）' } });
    await expect(
      qcService.reviewGarmentSample('ord1', { round: 1, conclusion: 'pass', opinion: '重复提交' }, ENDPOINT),
    ).rejects.toThrow('每轮报告独立不可覆盖');
  });

  it('getGarmentSampleGate GET gate?sampleLevel=pp&round=2（DR-008 门禁查询）', async () => {
    const fetchMock = mockFetchOk({ gate: { orderId: 'ord1', sampleLevel: 'pp', round: 2, reviewed: false, passed: false, blockedCode: 'RE_INSPECTION_REQUIRED' } });
    const gate = await qcService.getGarmentSampleGate('ord1', { sampleLevel: 'pp', round: 2 }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/qc/chain/garment/ord1/gate');
    expect(url).toContain('sampleLevel=pp');
    expect(url).toContain('round=2');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(gate.blockedCode).toBe('RE_INSPECTION_REQUIRED');
  });

  it('listChainReports GET /v1/qc/chain/:orderId/reports?chain=fabric（链过滤透传）', async () => {
    const fetchMock = mockFetchOk({ items: [{ id: 'r1', chain: 'fabric', sampleKind: 'ss', round: 1 }] });
    const items = await qcService.listChainReports('ord1', 'fabric', ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/qc/chain/ord1/reports');
    expect(url).toContain('chain=fabric');
    expect(items).toHaveLength(1);
    expect(items[0].chain).toBe('fabric');
  });

  it('signReport POST /v1/qc/reports/:reportId/sign（双签 role 透传）', async () => {
    const fetchMock = mockFetchOk({ item: { id: 'r1', signatures: { qcSignedAt: 1786900000000, qcSignerId: 'usr_qc' } } });
    const report = await qcService.signReport('r1', 'qc', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/qc/reports/r1/sign');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ role: 'qc' });
    expect(report.signatures?.qcSignedAt).toBe(1786900000000);
  });

  it('signReport 400 已签署 → 透出服务端 message（fail-closed）', async () => {
    mockFetchError(400, { error: { code: 'ALREADY_SIGNED', message: '该报告 QC 侧已签署，不可重复签署' } });
    await expect(qcService.signReport('r1', 'qc', ENDPOINT)).rejects.toThrow('已签署');
  });
});

// ═══ Part 3: UI 源码契约 ═══
describe('runtime QA [QcWorkbench UI]: 双链评审 tab 与严格隔离', () => {
  it("sampleChains tab 注册（中英双语标签）", () => {
    expect(QC_MGR_SRC).toContain("'sampleChains'");
    expect(QC_MGR_SRC).toContain("label: '双链评审 Sample Chains'");
    expect(QC_MGR_SRC).toContain('<SampleChainsPanel registerNewAction={registerNewAction} />');
  });
  it('链路由 resolveOrderChain 镜像后端 isGarmentChainOrder / isFabricChainOrder 口径', () => {
    expect(QC_MGR_SRC).toContain('function resolveOrderChain');
    expect(QC_MGR_SRC).toContain("line === 'garment' || line === 'capsule' || type === 'garment'");
    expect(QC_MGR_SRC).toContain("line === 'fabric' || type === 'fabric'");
  });
  it('服装链 / 面料链分组件严格隔离（各自状态机流转，按链路由）', () => {
    expect(QC_MGR_SRC).toContain('function GarmentChainView');
    expect(QC_MGR_SRC).toContain('function FabricChainView');
    expect(QC_MGR_SRC).toContain('<GarmentChainView key={selectedOrder.id} order={selectedOrder} />');
    expect(QC_MGR_SRC).toContain('<FabricChainView key={selectedOrder.id} order={selectedOrder} />');
    expect(QC_MGR_SRC).toContain('chain="garment"');
    expect(QC_MGR_SRC).toContain('chain="fabric"');
  });
  it('服装链消费门禁查询 + 评审 + 直接打回端点', () => {
    expect(QC_MGR_SRC).toContain('qcService.getGarmentSampleGate');
    expect(QC_MGR_SRC).toContain('qcService.reviewGarmentSample');
    expect(QC_MGR_SRC).toContain('qcService.directRejectGarmentSample');
  });
  it('面料链消费样品域候选列表 + 面料链评审端点', () => {
    expect(QC_MGR_SRC).toContain('sampleService.listOrderSamples');
    expect(QC_MGR_SRC).toContain('sampleService.listEarlyProductionRounds');
    expect(QC_MGR_SRC).toContain('qcService.reviewFabricSample');
  });
  it('双签状态展示 + QC / 业务签署入口（InspectionReport.signatures）', () => {
    expect(QC_MGR_SRC).toContain('qcService.signReport');
    expect(QC_MGR_SRC).toContain('qcSignedAt');
    expect(QC_MGR_SRC).toContain('businessSignedAt');
    expect(QC_MGR_SRC).toContain("handleSign(r.id, 'qc')");
    expect(QC_MGR_SRC).toContain("handleSign(r.id, 'business')");
  });
  it('loading / empty / error 三态齐全（无占位符，全接真实 API）', () => {
    expect(QC_MGR_SRC).toContain('门禁查询中');
    expect(QC_MGR_SRC).toContain('样品加载中');
    expect(QC_MGR_SRC).toContain('加载失败');
    expect(QC_MGR_SRC).toContain('重试');
    expect(QC_MGR_SRC).toContain('暂无{CHAIN_LABELS[chain]}评审报告');
    expect(QC_MGR_SRC).toContain('双链样品评审不适用');
  });
});

describe('runtime QA [SampleNodesPanel UI]: 服装多轮样品双门禁', () => {
  it('仅 garment 开发单渲染双门禁区块（caseType 条件渲染）', () => {
    expect(SAMPLE_PANEL_SRC).toContain("caseType === 'garment' && <GarmentSampleGateSection caseId={caseId} />");
  });
  it('双门禁标识：内部门禁（QC）+ 客户确认', () => {
    expect(SAMPLE_PANEL_SRC).toContain('QC_GATE_LABEL');
    expect(SAMPLE_PANEL_SRC).toContain('CUSTOMER_GATE_LABEL');
    expect(SAMPLE_PANEL_SRC).toContain('内部门禁已通过');
    expect(SAMPLE_PANEL_SRC).toContain('客户确认通过');
  });
  it('状态机操作入口：提交内部门禁 / 提交客户 / 登记客户确认 / 封存归档', () => {
    expect(SAMPLE_PANEL_SRC).toContain('提交内部门禁');
    expect(SAMPLE_PANEL_SRC).toContain('提交客户');
    expect(SAMPLE_PANEL_SRC).toContain('登记客户确认');
    expect(SAMPLE_PANEL_SRC).toContain('封存归档');
  });
  it('快递信息展示（DR-039：日期 / 快递商 / 单号 / 收件方 + 随附单据）', () => {
    expect(SAMPLE_PANEL_SRC).toContain('round.shipment.sentDate');
    expect(SAMPLE_PANEL_SRC).toContain('round.shipment.courier');
    expect(SAMPLE_PANEL_SRC).toContain('round.shipment.trackingNumber');
    expect(SAMPLE_PANEL_SRC).toContain('round.shipment.recipientName');
    expect(SAMPLE_PANEL_SRC).toContain('随附单据');
  });
  it('消费 sampleService 服装链五端点', () => {
    expect(SAMPLE_PANEL_SRC).toContain('sampleService.listGarmentRounds');
    expect(SAMPLE_PANEL_SRC).toContain('sampleService.createGarmentRound');
    expect(SAMPLE_PANEL_SRC).toContain('sampleService.submitGarmentQcConclusion');
    expect(SAMPLE_PANEL_SRC).toContain('sampleService.submitGarmentToCustomer');
    expect(SAMPLE_PANEL_SRC).toContain('sampleService.registerGarmentCustomerConfirmation');
    expect(SAMPLE_PANEL_SRC).toContain('sampleService.sealGarmentRound');
  });
});

describe('runtime QA [SampleNodesPanel UI]: 节点动作 BDS 弹窗表单（G6）', () => {
  it('window.prompt 清零（寄样/修改意见/批准意见全部走弹窗表单）', () => {
    expect(SAMPLE_PANEL_SRC).not.toContain('window.prompt');
  });
  it('弹窗宿主为 BDS BottomSheet，按动作出标题', () => {
    expect(SAMPLE_PANEL_SRC).toContain("import BottomSheet from '../ui/BottomSheet'");
    expect(SAMPLE_PANEL_SRC).toContain('<BottomSheet');
    expect(SAMPLE_PANEL_SRC).toContain('NODE_DIALOG_TITLE');
    expect(SAMPLE_PANEL_SRC).toContain('寄出样品');
    expect(SAMPLE_PANEL_SRC).toContain('登记客户修改意见');
    expect(SAMPLE_PANEL_SRC).toContain('批准样品');
  });
  it('三动作弹窗状态机（send / revise / approve）+ 统一提交入口', () => {
    expect(SAMPLE_PANEL_SRC).toContain("setDialog({ kind: 'send', node })");
    expect(SAMPLE_PANEL_SRC).toContain("setDialog({ kind: 'revise', node })");
    expect(SAMPLE_PANEL_SRC).toContain("setDialog({ kind: 'approve', node })");
    expect(SAMPLE_PANEL_SRC).toContain('const submitNodeDialog = useCallback');
  });
  it('寄样弹窗预填既有快递单号/公司，payload 契约与原 prompt 一致（trim || undefined）', () => {
    expect(SAMPLE_PANEL_SRC).toContain('SendSampleDialogForm');
    expect(SAMPLE_PANEL_SRC).toContain('useState(node.trackingNumber ||');
    expect(SAMPLE_PANEL_SRC).toContain('useState(node.courier ||');
    expect(SAMPLE_PANEL_SRC).toContain('trackingNumber: input.trackingNumber.trim() || undefined');
    expect(SAMPLE_PANEL_SRC).toContain('courier: input.courier.trim() || undefined');
  });
  it('DR-039 寄送登记表单支持邮寄费（DR-057 v2.1：非负数值 + 提交透传 + 展示留痕）', () => {
    // ShipForm（garment 双门禁轮次提交客户）邮寄费输入 + 非负校验
    expect(SAMPLE_PANEL_SRC).toContain('placeholder="邮寄费（可留空）"');
    expect(SAMPLE_PANEL_SRC).toContain('shippingFee: parsedFee');
    // 轮次 shipment 展示行补费用留痕
    expect(SAMPLE_PANEL_SRC).toContain('round.shipment.shippingFee != null');
  });
  it('意见弹窗复用（客户修改意见预填既有反馈 / 批准意见空白起步）', () => {
    expect(SAMPLE_PANEL_SRC).toContain('NodeFeedbackDialogForm');
    expect(SAMPLE_PANEL_SRC).toContain('initialValue={dialog.node.feedback ||');
    expect(SAMPLE_PANEL_SRC).toContain("submitNodeDialog({ action: 'revise', feedback: feedback.trim() || undefined })");
    expect(SAMPLE_PANEL_SRC).toContain("submitNodeDialog({ action: 'approve', feedback: feedback.trim() || undefined })");
  });
  it('开始打样仍为直发动作（无弹窗回归）', () => {
    expect(SAMPLE_PANEL_SRC).toContain("act(node, 'start')");
  });
});

describe('runtime QA [DevelopmentManager 接线]: caseType 透传', () => {
  it('SampleNodesPanel 传入 caseType（garment 才渲染双门禁）', () => {
    expect(DEV_MGR_SRC).toContain('<SampleNodesPanel key={selectedCase.id} caseId={selectedCase.id} caseType={selectedCase.type} isDarkMode={isDarkMode} />');
  });
});

// ═══ Part 4: 设计纪律（防回退） ═══
describe('runtime QA [设计纪律]: 双链 UI 无硬编码', () => {
  it('QcWorkbenchManager / SampleNodesPanel 无 hex 颜色 / rounded-[Npx] / box-shadow / 过重字重', () => {
    for (const src of [QC_MGR_SRC, SAMPLE_PANEL_SRC]) {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/rounded-\[[0-9]+px\]/);
      expect(src).not.toMatch(/box-shadow:/);
      expect(src).not.toMatch(/font-(medium|semibold|bold)\b/);
    }
  });
  it('UI 文件无 emoji（UI 纪律）', () => {
    for (const src of [QC_MGR_SRC, SAMPLE_PANEL_SRC]) {
      // eslint-disable-next-line no-control-regex
      expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
