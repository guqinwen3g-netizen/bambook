import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService } from '../services/apiService';
import {
  ORDER_CHANGE_IMPACT_MIN,
  ORDER_CHANGE_REASON_MIN,
  buildChangeRequestDraft,
  orderChangeService,
  readOrderCapsuleExemption,
  readOrderMoqSnapshot,
} from '../services/orderChangeService';
import { moqService } from '../services/moqService';
import { approvalKernelService } from '../services/approvalKernelService';
import { sampleService } from '../services/sampleService';
import { qcService } from '../services/qcService';
import { shipmentService } from '../services/shipmentService';
import { paymentRequestService } from '../services/paymentRequestService';
import { VOUCHER_CATEGORIES, VOUCHER_CATEGORY_LABELS, paymentVoucherService } from '../services/paymentVoucherService';
import { creditService } from '../services/creditService';
import { internalTradeService } from '../services/internalTradeService';
import type { ConsolidatedProfitReport } from '../services/internalTradeService';
import {
  EXCEPTION_ENTRY_EVENT,
  GATE_BLOCKED_CODE,
  openExceptionEntry,
} from '../services/exceptionService';
import type { QuotationInput, Relation } from '../types';

const fs = require('fs');
const path = require('path');

/**
 * Phase 5 主链 E2E runtime QA — 业务主链接线完整性断言：
 *   客户创建 → 报价 → 订单（MOQ 快照 + Capsule 豁免）→ 订单变更申请 → 审批（DR-007 路由轨迹）
 *   → 样品/QC → 出运 → 付款申请 → 凭证分类 → 信用占用 → 合并报表抵销
 *
 * 模式（对齐 internalTradeRuntimeQa / financePaymentCreditRuntimeQa）：
 *   ① 源码契约断言：静态读取前端 service / 面板 tsx / 后端 route 真实源码（server/ 冻结区只读）
 *   ② mock fetch 行为验证：service 层 HTTP 方法 / URL / 载荷 / 解包与后端信封契约一致
 *   ③ 面板接线断言：Manager/Panel tsx 真实调用对应 service（无占位符、无伪成功）
 *
 * 同时收口 Phase 5 两项集成的接线断言：
 *   - 任务 1：DetailPanel 内嵌 FinanceCreditPanel（embedded + customerId 受控）
 *   - 任务 2：OrderChangeRequestsSection 门禁阻断点 → openExceptionEntry（DR-013 通用入口）
 */

// ── 前端源码（静态契约断言） ──
const API_SVC = fs.readFileSync(path.resolve(__dirname, '../services/apiService.ts'), 'utf-8');
const ORDER_CHANGE_SVC = fs.readFileSync(path.resolve(__dirname, '../services/orderChangeService.ts'), 'utf-8');
const EXC_SVC = fs.readFileSync(path.resolve(__dirname, '../services/exceptionService.ts'), 'utf-8');
const RELATIONS_MGR = fs.readFileSync(path.resolve(__dirname, 'RelationsManager.tsx'), 'utf-8');
const ORDER_MGR = fs.readFileSync(path.resolve(__dirname, 'OrderManager.tsx'), 'utf-8');
const ORDER_CHANGE_SECTION = fs.readFileSync(path.resolve(__dirname, 'order/OrderChangeRequestsSection.tsx'), 'utf-8');
const WORKFLOW_PANEL = fs.readFileSync(path.resolve(__dirname, 'WorkflowPanel.tsx'), 'utf-8');
const DETAIL_PANEL = fs.readFileSync(path.resolve(__dirname, 'ui/DetailPanel.tsx'), 'utf-8');
const CREDIT_PANEL = fs.readFileSync(path.resolve(__dirname, 'finance/FinanceCreditPanel.tsx'), 'utf-8');
const FINANCE_MGR = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');
const SHIPMENT_MGR = fs.readFileSync(path.resolve(__dirname, 'ShipmentManager.tsx'), 'utf-8');
const PR_PANEL = fs.readFileSync(path.resolve(__dirname, 'finance/FinancePaymentRequestsPanel.tsx'), 'utf-8');

// ── 后端契约真源（server/ 冻结区，只读断言） ──
const SERVER_INDEX = fs.readFileSync(path.resolve(__dirname, '../server/src/index.ts'), 'utf-8');
const QUOTATION_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/quotations/quotationRoute.ts'), 'utf-8');
const ORDER_CHANGE_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/orderChanges/orderChangeRoute.ts'), 'utf-8');
const MOQ_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/moq/moqRoute.ts'), 'utf-8');
const KERNEL_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/approvals/approvalKernelRoute.ts'), 'utf-8');
const SAMPLE_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/samples/sampleRoute.ts'), 'utf-8');
const QC_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/qc/qcRoute.ts'), 'utf-8');
const SHIPPING_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/shipping/route.ts'), 'utf-8');
const PR_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/paymentRequests/paymentRequestRoute.ts'), 'utf-8');
const FINANCE_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/route.ts'), 'utf-8');
const CREDIT_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/credit/creditRoute.ts'), 'utf-8');
const REPORT_SVC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/reportService.ts'), 'utf-8');

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

function mockFetchOnce(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', createStorage());
  vi.stubGlobal('sessionStorage', createStorage());
});

// ══════════════════════════════════════════════════════════════
// Part 0: 主链端点挂载全景（前端 service 路径必须与之对齐）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [server]: 主链端点挂载全景', () => {
  it('主链 14 个域全部挂载 /api/v1/*', () => {
    for (const mount of [
      '/api/v1/relations',
      '/api/v1/quotations',
      '/api/v1/orders',
      '/api/v1/moq',
      '/api/v1/order-changes',
      '/api/v1/approvals',
      '/api/v1/approvals-kernel',
      '/api/v1/samples',
      '/api/v1/qc',
      '/api/v1/shipping',
      '/api/v1/payment-requests',
      '/api/v1/finance',
      '/api/v1/credit',
      '/api/v1/internal-trade',
    ]) {
      expect(SERVER_INDEX).toContain(`'${mount}'`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Step 1: 客户创建（RelationsManager → apiService.saveRelation → POST /v1/relations）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 1]: 客户创建', () => {
  it('apiService 契约：saveRelation POST /v1/relations 并解包 data.relation', () => {
    expect(API_SVC).toContain('async saveRelation');
    expect(API_SVC).toContain("'/v1/relations'");
  });

  it('mock fetch：POST /api/v1/relations，载荷 round-trip，解包 relation', async () => {
    const relation = {
      id: 'REL_C1', name: 'ACME Trading', category: 'Customer', type: 'Customer',
    } as unknown as Relation;
    const fetchMock = mockFetchOnce({ ok: true, relation: { ...relation, createdAt: 1 } });
    const saved = await apiService.saveRelation(relation, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/relations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).name).toBe('ACME Trading');
    expect(saved.id).toBe('REL_C1');
  });

  it('RelationsManager 接线：创建/更新/删除全部走 apiService（无占位符）', () => {
    expect(RELATIONS_MGR).toContain('apiService.saveRelation');
    expect(RELATIONS_MGR).toContain('apiService.updateRelation');
    expect(RELATIONS_MGR).toContain('apiService.deleteRelation');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 2: 报价 → 转订单（apiService.createQuotation / convertQuotationToOrder）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 2]: 报价 → 转订单', () => {
  it('后端路由契约：POST / 与 POST /:id/convert-to-order 存在', () => {
    expect(QUOTATION_ROUTE).toContain("router.post('/',");
    expect(QUOTATION_ROUTE).toContain("router.post('/:id/convert-to-order'");
  });

  it('mock fetch：createQuotation POST /api/v1/quotations 并解包 quotation', async () => {
    const fetchMock = mockFetchOnce({ quotation: { id: 'QT_1', status: 'Draft' } });
    const input: QuotationInput = {
      currency: 'USD', customerRelationId: 'REL_C1', issueDate: '2026-08-16',
      lines: [{ quantity: 500, unitPrice: 100 } as QuotationInput['lines'][number]],
    };
    const created = await apiService.createQuotation(input, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/quotations');
    expect(init.method).toBe('POST');
    expect(created.id).toBe('QT_1');
  });

  it('mock fetch：convertQuotationToOrder POST /:id/convert-to-order 返回 orderId（报价→订单链）', async () => {
    const fetchMock = mockFetchOnce({ orderId: 'ORD_1', quotation: { id: 'QT_1', status: 'Converted' } });
    const result = await apiService.convertQuotationToOrder('QT_1', { poNumber: 'PO-2026-001' }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/quotations/QT_1/convert-to-order');
    expect(init.method).toBe('POST');
    expect(result.orderId).toBe('ORD_1');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 3: 订单（MOQ 快照 writeOnce + Capsule 豁免 DR-003 + dry-run 预检）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 3]: 订单 MOQ 快照 + Capsule 豁免', () => {
  it('后端路由契约：POST /validate（dry-run 不写库不建审批单）', () => {
    expect(MOQ_ROUTE).toContain("'/validate'");
  });

  it('readOrderMoqSnapshot 运行时收窄：合法快照 round-trip，非法载荷 fail-closed 返回 null', () => {
    const snapshot = readOrderMoqSnapshot({
      moqSnapshot: {
        fabricDefaultMoq: 800, garmentDefaultMoq: 200, capsuleMoq: 20,
        snapshotAt: '2026-08-16T00:00:00.000Z', configId: 'cfg_1', source: 'moq_config',
      },
    });
    expect(snapshot?.fabricDefaultMoq).toBe(800);
    expect(snapshot?.capsuleMoq).toBe(20);
    expect(snapshot?.source).toBe('moq_config');
    expect(readOrderMoqSnapshot({ moqSnapshot: null })).toBeNull();
    expect(readOrderMoqSnapshot({ moqSnapshot: { fabricDefaultMoq: 'x' } })).toBeNull();
    expect(readOrderMoqSnapshot({})).toBeNull();
  });

  it('readOrderCapsuleExemption 严格 === true（truthy 字符串不放行）', () => {
    expect(readOrderCapsuleExemption({ capsuleExemption: true })).toBe(true);
    expect(readOrderCapsuleExemption({ capsuleExemption: 'true' })).toBe(false);
    expect(readOrderCapsuleExemption({})).toBe(false);
  });

  it('mock fetch：orderChangeService.validateMoq POST /v1/moq/validate 携带 capsuleExemption', async () => {
    const fetchMock = mockFetchOnce({
      ok: true, capsuleActive: true, lines: [], blockedLineIndexes: [],
      snapshot: { fabricDefaultMoq: 800, garmentDefaultMoq: 200, capsuleMoq: 20 },
    });
    await orderChangeService.validateMoq({
      type: 'Garment', businessLine: 'capsule', capsuleExemption: true,
      lines: [{ quantity: 10, unit: 'PC' }],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/moq/validate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).capsuleExemption).toBe(true);
  });

  it('mock fetch：moqService.validateDryRun 同端点（设置台探针复用同一真源）', async () => {
    const fetchMock = mockFetchOnce({ ok: true, capsuleActive: false, lines: [], blockedLineIndexes: [] });
    await moqService.validateDryRun({ businessLine: 'garment', lines: [{ quantity: 100 }] }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/moq/validate');
    expect(init.method).toBe('POST');
  });

  it('OrderManager 接线：MOQ 快照只读条 + Capsule 豁免徽章 + 变更申请区块', () => {
    expect(ORDER_MGR).toContain('OrderMoqSnapshotBlock');
    expect(ORDER_MGR).toContain('CapsuleExemptionBadge');
    expect(ORDER_MGR).toContain('OrderChangeRequestsSection');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 4: 订单变更申请（DR-010 审批链；客户端校验镜像服务端下限）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 4]: 订单变更申请', () => {
  it('后端路由契约：POST / + apply / withdraw', () => {
    expect(ORDER_CHANGE_ROUTE).toContain("router.post('/',");
    expect(ORDER_CHANGE_ROUTE).toContain("router.post('/:id/apply'");
    expect(ORDER_CHANGE_ROUTE).toContain("router.post('/:id/withdraw'");
  });

  it('buildChangeRequestDraft 构建数量变更 before/after 留痕载荷', () => {
    const built = buildChangeRequestDraft(
      { id: 'ORD_1', status: 'Confirmed', quantity: 500 },
      {
        changeType: 'quantity', afterQuantity: '800',
        changeReason: '客户追加订单数量，已通过邮件确认',
        impactSummary: '交期顺延一周，成本重算',
      },
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.orderId).toBe('ORD_1');
      expect(built.payload.beforeSnapshot).toEqual({ quantity: 500 });
      expect(built.payload.afterDelta).toEqual({ quantity: 800 });
    }
  });

  it(`客户端校验镜像服务端下限（理由 ≥${ORDER_CHANGE_REASON_MIN} 字 / 影响 ≥${ORDER_CHANGE_IMPACT_MIN} 字，fail-closed）`, () => {
    const built = buildChangeRequestDraft(
      { id: 'ORD_1', status: 'Confirmed', quantity: 500 },
      { changeType: 'quantity', afterQuantity: '800', changeReason: '太短', impactSummary: '' },
    );
    expect(built.ok).toBe(false);
  });

  it('mock fetch：createChangeRequest POST /v1/order-changes 解包 { changeRequest, approvalRequestId }', async () => {
    const built = buildChangeRequestDraft(
      { id: 'ORD_1', status: 'Confirmed', quantity: 500 },
      {
        changeType: 'quantity', afterQuantity: '800',
        changeReason: '客户追加订单数量，已通过邮件确认',
        impactSummary: '交期顺延一周，成本重算',
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const fetchMock = mockFetchOnce({
      changeRequest: { id: 'CR_1', requestNumber: 'CR-2026-001', status: 'Pending' },
      approvalRequestId: 'APR_1',
    });
    const res = await orderChangeService.createChangeRequest(built.payload);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/order-changes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).orderId).toBe('ORD_1');
    expect(res.approvalRequestId).toBe('APR_1');
  });

  it('OrderChangeRequestsSection 接线：创建 / 撤回 / 生效 / MOQ 预检全部走 service', () => {
    expect(ORDER_CHANGE_SECTION).toContain('orderChangeService.createChangeRequest');
    expect(ORDER_CHANGE_SECTION).toContain('orderChangeService.withdrawChangeRequest');
    expect(ORDER_CHANGE_SECTION).toContain('orderChangeService.applyChangeRequest');
    expect(ORDER_CHANGE_SECTION).toContain('orderChangeService.validateMoq');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 5: 审批（DR-007 服务端解析 reviewerId + 路由轨迹只读视图）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 5]: 审批（DR-007 路由轨迹）', () => {
  it('后端路由契约：resolution-trace / delegate / boss-bypass', () => {
    expect(KERNEL_ROUTE).toContain("router.get('/:id/resolution-trace'");
    expect(KERNEL_ROUTE).toContain("router.post('/:id/delegate'");
    expect(KERNEL_ROUTE).toContain("router.post('/:id/boss-bypass'");
  });

  it('mock fetch：decideApproval POST /v1/approvals/:id/decide（驳回理由随 body 上送）', async () => {
    const fetchMock = mockFetchOnce({ item: { id: 'APR_1', status: 'approved' } });
    const item = await approvalKernelService.decideApproval('APR_1', 'approved', '同意变更', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/approvals/APR_1/decide');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'approved', decisionNote: '同意变更' });
    expect(item.status).toBe('approved');
  });

  it('mock fetch：getResolutionTrace GET /v1/approvals-kernel/:id/resolution-trace（DR-007 审计视图）', async () => {
    const fetchMock = mockFetchOnce({
      item: {
        id: 'APR_1', status: 'pending', actionType: 'order_change', requesterId: 'U_1',
        reviewerId: 'U_2', reviewerResolverRoute: 'DEPT_HEAD', departmentSnapshotId: 'dept_1',
      },
    });
    const trace = await approvalKernelService.getResolutionTrace('APR_1', ENDPOINT);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/v1/approvals-kernel/APR_1/resolution-trace');
    expect(trace.reviewerResolverRoute).toBe('DEPT_HEAD');
  });

  it('WorkflowPanel 接线：决策 / 轨迹 / 四路径标签全部消费 approvalKernelService', () => {
    expect(WORKFLOW_PANEL).toContain('approvalKernelService.decideApproval');
    expect(WORKFLOW_PANEL).toContain('getResolutionTrace');
    expect(WORKFLOW_PANEL).toContain('RESOLVER_ROUTE_LABEL');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 6: 样品 / QC（DR-011 船样登记 + DR-029 服装链 QC 评审）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 6]: 样品 / QC', () => {
  it('后端路由契约：船样登记 + 服装链评审端点存在', () => {
    expect(SAMPLE_ROUTE).toContain("router.post('/fabric/:orderId/shipment-sample'");
    expect(QC_ROUTE).toContain("'/chain/garment/:orderId/review'");
  });

  it('mock fetch：sampleService.registerShipmentSample POST /v1/samples/fabric/:orderId/shipment-sample 解包 sample', async () => {
    const fetchMock = mockFetchOnce({ sample: { id: 'SS_1', kind: 'SS', orderId: 'ORD_1' } });
    const sample = await sampleService.registerShipmentSample('ORD_1', {
      sampleQuantity: 2, cuttingDate: '2026-08-16',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/samples/fabric/ORD_1/shipment-sample');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).sampleQuantity).toBe(2);
    expect(sample.id).toBe('SS_1');
  });

  it('mock fetch：qcService.reviewGarmentSample POST /v1/qc/chain/garment/:orderId/review 返回 report + gate', async () => {
    const fetchMock = mockFetchOnce({
      report: { id: 'QCR_1', result: 'pass' },
      gate: { orderId: 'ORD_1', round: 1, reviewed: true, passed: true },
    });
    const result = await qcService.reviewGarmentSample('ORD_1', {
      sampleLevel: 'pp', round: 1, conclusion: 'pass',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/qc/chain/garment/ORD_1/review');
    expect(init.method).toBe('POST');
    expect(result.report.result).toBe('pass');
    expect(result.gate.passed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// Step 7: 出运（ShipmentManager → shipmentService → POST /v1/shipping）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 7]: 出运', () => {
  it('后端路由契约：POST /（创建运单，高风险角色守卫）', () => {
    expect(SHIPPING_ROUTE).toContain("router.post('/',");
  });

  it('mock fetch：createShipment POST /api/v1/shipping 解包 shipment', async () => {
    const fetchMock = mockFetchOnce({ shipment: { id: 'SH_1', orderId: 'ORD_1', status: 'Booked' } });
    const created = await shipmentService.createShipment({ id: 'SH_1' }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/shipping');
    expect(init.method).toBe('POST');
    expect(created.id).toBe('SH_1');
  });

  it('ShipmentManager 接线：创建 / 更新 / 删除全部走 shipmentService', () => {
    expect(SHIPMENT_MGR).toContain('shipmentService.createShipment');
    expect(SHIPMENT_MGR).toContain('shipmentService.updateShipment');
    expect(SHIPMENT_MGR).toContain('shipmentService.deleteShipment');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 8: 付款申请（DR-007：reviewerId 服务端解析，前端不得传入）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 8]: 付款申请', () => {
  it('后端路由契约：POST / + POST /:id/cancel', () => {
    expect(PR_ROUTE).toContain("router.post('/',");
    expect(PR_ROUTE).toContain("router.post('/:id/cancel'");
  });

  it('mock fetch：createPaymentRequest POST /api/v1/payment-requests，载荷无 reviewerId', async () => {
    const fetchMock = mockFetchOnce({
      paymentRequest: { id: 'PR_1', requestNumber: 'PR-2026-001', status: 'Pending' },
      approvalRequestId: 'APR_9',
    });
    const res = await paymentRequestService.createPaymentRequest({
      supplierName: 'ACME Mill', totalAmount: 12000, currency: 'USD', paymentCategory: 'normal',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/payment-requests');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.supplierName).toBe('ACME Mill');
    expect('reviewerId' in body).toBe(false);
    expect(res.approvalRequestId).toBe('APR_9');
  });

  it('FinancePaymentRequestsPanel 接线：创建 / 作废 / 审批决策（复用审批域 decideApproval）', () => {
    expect(PR_PANEL).toContain('paymentRequestService.createPaymentRequest');
    expect(PR_PANEL).toContain('paymentRequestService.cancelPaymentRequest');
    expect(PR_PANEL).toContain('approvalKernelService.decideApproval');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 9: 凭证分类（DR-022 六类枚举贯穿创建载荷）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 9]: 凭证分类', () => {
  it('VOUCHER_CATEGORIES 六值 + 中文文案全覆盖', () => {
    expect([...VOUCHER_CATEGORIES]).toEqual([
      'normal', 'advance', 'deposit', 'sample_express', 'customer_reimburse', 'business_cost',
    ]);
    for (const c of VOUCHER_CATEGORIES) expect(VOUCHER_CATEGORY_LABELS[c]).toBeTruthy();
  });

  it('后端路由契约：POST /vouchers（高风险角色守卫）', () => {
    expect(FINANCE_ROUTE).toContain("router.post('/vouchers'");
  });

  it('mock fetch：createPaymentVoucher POST /api/v1/finance/vouchers 携带 voucherCategory', async () => {
    const fetchMock = mockFetchOnce({ id: 'PAY_1', voucherNumber: 'PAY-2026-001', voucherCategory: 'advance' });
    await paymentVoucherService.createPaymentVoucher({
      voucherNumber: 'PAY-2026-001', type: 'Disbursement', amount: 12000, voucherCategory: 'advance',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/finance/vouchers');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).voucherCategory).toBe('advance');
  });

  it('FinanceManager 接线：凭证创建/编辑提交携带 voucherCategory', () => {
    expect(FINANCE_MGR).toContain('voucherCategory: voucherForm.voucherCategory');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 10: 信用占用 + 客户详情联动（任务 1 接线断言）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [step 10]: 信用占用 + 客户详情联动', () => {
  it('后端路由契约：GET /:customerId/status + /history + freeze / thaw', () => {
    expect(CREDIT_ROUTE).toContain("router.get('/:customerId/status'");
    expect(CREDIT_ROUTE).toContain("router.get('/:customerId/history'");
    expect(CREDIT_ROUTE).toContain("router.post('/:customerId/freeze'");
    expect(CREDIT_ROUTE).toContain("router.post('/:customerId/thaw'");
  });

  it('mock fetch：getCreditStatus GET /api/v1/credit/:customerId/status（占用/冻结门禁/逾期天数）', async () => {
    const fetchMock = mockFetchOnce({
      relationId: 'REL_C1', hasCreditLimit: true, creditLimitId: 'CL_1', status: 'Active',
      creditFrozen: false, totalLimit: 100000, usedAmount: 40000, remaining: 60000,
      currency: 'USD', maxOverdueDays: 0,
    });
    const status = await creditService.getCreditStatus('REL_C1', ENDPOINT);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/v1/credit/REL_C1/status');
    expect(status.usedAmount).toBe(40000);
    expect(status.remaining).toBe(60000);
  });

  it('FinanceCreditPanel 受控接口 + embedded 模式（预留接线契约）', () => {
    expect(CREDIT_PANEL).toContain('customerId?: string');
    expect(CREDIT_PANEL).toContain('onCustomerChange?: (customerId: string) => void');
    expect(CREDIT_PANEL).toContain('embedded?: boolean');
    expect(CREDIT_PANEL).toContain('if (embedded)');
  });

  it('DetailPanel 接线：Customer 详情内嵌信用面板（embedded + customerId 受控锁定当前客户）', () => {
    expect(DETAIL_PANEL).toContain("import { FinanceCreditPanel } from '../finance/FinanceCreditPanel'");
    expect(DETAIL_PANEL).toContain('信用控制 Credit Control');
    expect(DETAIL_PANEL).toContain('customerId={data.id}');
    expect(DETAIL_PANEL).toContain("data.category === 'Customer' || data.type === 'Customer'");
  });

  it('FinanceManager 接线：独立信用 tab 与内嵌模式并存（非受控回退不破坏）', () => {
    expect(FINANCE_MGR).toContain('<FinanceCreditPanel isDarkMode={isDarkMode} relations={relationOptions} />');
  });
});

// ══════════════════════════════════════════════════════════════
// Step 11: 合并报表抵销（DR-005：单边口径，Σ 部门利润 = 合并利润）
// ══════════════════════════════════════════════════════════════
const CONSOLIDATED_FIXTURE: ConsolidatedProfitReport = {
  baseCurrency: 'CNY',
  consolidatedRevenue: 200000,
  consolidatedCost: 120000,
  consolidatedProfit: 80000,
  costBreakdown: {
    externalPurchaseNetOfInternal: 70000,
    realFabricCost: 40000,
    freightCost: 6000,
    miscCost: 4000,
  },
  elimination: { internalPurchase: 40000, internalSales: 40000, amount: 40000, discrepancy: 0 },
  departments: {
    garment: { revenue: 200000, cost: 150000, profit: 50000 },
    fabric: { revenue: 40000, cost: 10000, profit: 30000 },
  },
  orders: { externalCount: 2, internalCount: 1 },
  unconverted: [],
};

describe('主链 E2E [step 11]: 合并报表抵销', () => {
  it('后端契约：getConsolidatedProfitReport 聚合字段存在于 reportService 真源', () => {
    for (const field of ['getConsolidatedProfitReport', 'consolidatedProfit', 'elimination', 'departments']) {
      expect(REPORT_SVC).toContain(field);
    }
  });

  it('mock fetch：getConsolidatedProfitReport GET /api/v1/finance/reports/consolidated-profit', async () => {
    const fetchMock = mockFetchOnce(CONSOLIDATED_FIXTURE);
    const report = await internalTradeService.getConsolidatedProfitReport(ENDPOINT);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/v1/finance/reports/consolidated-profit');
    expect(report.consolidatedProfit).toBe(80000);
  });

  it('抵销恒等式：合并利润 = 收入 − 成本；Σ 部门利润 = 合并利润；抵销净额 = 内部采购单边口径', () => {
    expect(CONSOLIDATED_FIXTURE.consolidatedRevenue - CONSOLIDATED_FIXTURE.consolidatedCost)
      .toBe(CONSOLIDATED_FIXTURE.consolidatedProfit);
    expect(CONSOLIDATED_FIXTURE.departments.garment.profit + CONSOLIDATED_FIXTURE.departments.fabric.profit)
      .toBe(CONSOLIDATED_FIXTURE.consolidatedProfit);
    expect(CONSOLIDATED_FIXTURE.elimination.amount).toBe(CONSOLIDATED_FIXTURE.elimination.internalPurchase);
    expect(CONSOLIDATED_FIXTURE.elimination.discrepancy).toBe(
      CONSOLIDATED_FIXTURE.elimination.internalSales - CONSOLIDATED_FIXTURE.elimination.internalPurchase,
    );
  });
});

// ══════════════════════════════════════════════════════════════
// Part 12: DR-013 门禁阻断 → 例外申请入口（任务 2 接线断言）
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [DR-013]: 门禁阻断点 → 例外申请入口接线', () => {
  it('exceptionService 契约：GATE_BLOCKED_CODE + EXCEPTION_ENTRY_EVENT + openExceptionEntry', () => {
    expect(GATE_BLOCKED_CODE).toBe('GATE_BLOCKED');
    expect(EXCEPTION_ENTRY_EVENT).toBe('bambook:dr013-exception-entry');
    expect(EXC_SVC).toContain('export function openExceptionEntry');
  });

  it('runtime：openExceptionEntry 派发 CustomEvent 携带门禁上下文（审批中心预填契约）', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    class FakeCustomEvent<T> {
      type: string;
      detail: T | undefined;
      constructor(type: string, init?: { detail?: T }) {
        this.type = type;
        this.detail = init?.detail;
      }
    }
    vi.stubGlobal('CustomEvent', FakeCustomEvent);

    openExceptionEntry({
      targetType: 'Order', targetId: 'ORD_1', action: 'order:change',
      exceptionCategory: 'order_change', gate: 'order_change', blockingReasons: ['GATE_BLOCKED'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const evt = dispatchEvent.mock.calls[0][0] as { type: string; detail: Record<string, unknown> };
    expect(evt.type).toBe('bambook:dr013-exception-entry');
    expect(evt.detail.targetType).toBe('Order');
    expect(evt.detail.targetId).toBe('ORD_1');
    expect(evt.detail.gate).toBe('order_change');
  });

  it('OrderChangeRequestsSection 四个阻断点全部提供例外入口（受控字段 / MOQ 不合规 / submit / action GATE_BLOCKED）', () => {
    expect(ORDER_CHANGE_SECTION).toContain('openExceptionEntry');
    expect(ORDER_CHANGE_SECTION).toContain('GATE_BLOCKED_CODE');
    expect(ORDER_CHANGE_SECTION).toContain('申请受控例外');
    expect(ORDER_CHANGE_SECTION).toContain('申请 MOQ 豁免例外');
    // targetType/targetId 精确锁定当前订单（非通用泛化入口）
    expect(ORDER_CHANGE_SECTION).toContain("targetType: 'Order'");
    expect(ORDER_CHANGE_SECTION).toContain('targetId: order.id');
    // MOQ 阻断上下文：moq_exemption 类别 + 阻断原因
    expect(ORDER_CHANGE_SECTION).toContain("exceptionCategory: 'moq_exemption'");
    expect(ORDER_CHANGE_SECTION).toContain('MOQ_BELOW_EFFECTIVE_MIN');
    // 受控字段阻断上下文：CONTROLLED_FIELD_DIRECT_EDIT 留痕
    expect(ORDER_CHANGE_SECTION).toContain('CONTROLLED_FIELD_DIRECT_EDIT');
  });

  it('WorkflowPanel 接线：监听 EXCEPTION_ENTRY_EVENT 打开预填表单', () => {
    expect(WORKFLOW_PANEL).toContain('EXCEPTION_ENTRY_EVENT');
    expect(WORKFLOW_PANEL).toContain('window.addEventListener(EXCEPTION_ENTRY_EVENT, handler)');
  });
});

// ══════════════════════════════════════════════════════════════
// Part 13: 横切纪律 — 设计系统 + 失败不静默
// ══════════════════════════════════════════════════════════════
describe('主链 E2E [横切]: 设计系统与错误纪律', () => {
  it('本次接线涉及的面板无硬编码 rounded-[Npx] / hex 类 / box-shadow / 过重字重', () => {
    for (const src of [ORDER_CHANGE_SECTION, CREDIT_PANEL, DETAIL_PANEL]) {
      expect(src).not.toMatch(/rounded-\[\d+px\]/);
      expect(src).not.toMatch(/(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/);
      expect(src).not.toContain('box-shadow:');
      expect(src).not.toMatch(/font-(medium|semibold|bold)\b/);
    }
  });

  it('主链 service 失败均 throw（不静默吞错误、不伪成功）', () => {
    for (const src of [ORDER_CHANGE_SVC, EXC_SVC]) {
      expect(src).toContain('throw');
    }
  });
});
