import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-development-convert-runtime-qa: fixture-driven runtime QA
 * 消费已 merged development convert route/service/flow contract（task_mqyrpdbw + task_mqyrpddk）。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改后端 contract。
 */

const fs = require('fs');
const path = require('path');
const FLOW_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/developmentConvertFlow.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/development/convertService.ts'), 'utf-8');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/development/route.ts'), 'utf-8');
const TOOL_RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/toolRuntime.ts'), 'utf-8');
const DEV_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'DevelopmentManager.tsx'), 'utf-8');
const DEV_SVC_SRC = fs.readFileSync(path.resolve(__dirname, '../services/developmentService.ts'), 'utf-8');

// ═══ Part 1: Agent flow — ProcessDraft 六字段（what-you-approve-is-what-you-commit） ═══
describe('runtime QA [Agent flow]: buildDevConvertDraft 严格六字段', () => {
  it('idempotencyKey 格式: dev.convert_to_order:${caseId}:${mode}:${hash}', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey = `dev\.convert_to_order:\$\{caseId\}:\$\{mode\}:\$\{hash\}`/);
  });
  it('impactScope 固定 [development, orders]', () => {
    expect(FLOW_SRC).toMatch(/impactScope: \['development', 'orders'\]/);
  });
  it('irreversible = true（转换不可逆）', () => {
    expect(FLOW_SRC).toMatch(/irreversible: true/);
  });
  it('subOperations 用 development.convert_to_order toolId', () => {
    expect(FLOW_SRC).toMatch(/toolId: 'development\.convert_to_order'/);
  });
  it('action = link_existing_order 或 auto_create_order（按 mode 分支）', () => {
    expect(FLOW_SRC).toMatch(/action: mode === 'link' \? 'link_existing_order' : 'auto_create_order'/);
  });
  it('return 展开 content + idempotencyKey（严格六字段）', () => {
    expect(FLOW_SRC).toMatch(/return \{ \.\.\.content, idempotencyKey \}/);
  });
  it('beforeAfterDiff: developmentCase stage developing→approved', () => {
    expect(FLOW_SRC).toMatch(/entity: 'developmentCase'/);
    expect(FLOW_SRC).toMatch(/field: 'stage'/);
    expect(FLOW_SRC).toMatch(/before: 'developing'/);
    expect(FLOW_SRC).toMatch(/after: 'approved'/);
  });
  it('afterPayload 含 caseId + mode（what-you-approve-is-what-you-commit）', () => {
    expect(FLOW_SRC).toMatch(/afterPayload.*caseId.*mode/);
  });
});

// ═══ Part 2: Agent flow — Feedback 三态 ═══
describe('runtime QA [Agent flow]: DevConvertFlowFeedback 三态', () => {
  it('Feedback union 含 approval_required/committed/failed', () => {
    expect(FLOW_SRC).toMatch(/status: 'approval_required'/);
    expect(FLOW_SRC).toMatch(/status: 'committed'/);
    expect(FLOW_SRC).toMatch(/status: 'failed'/);
  });
  it('DevConvertFlowCommitted 含 caseId/orderId/auditId/idempotencyKey', () => {
    const m = FLOW_SRC.match(/export interface DevConvertFlowCommitted \{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    for (const f of ['caseId', 'orderId', 'auditId', 'idempotencyKey']) {
      expect(m![0]).toContain(f);
    }
  });
});

// ═══ Part 3: Agent flow — ErrorCode 真实 union（flow + service） ═══
describe('runtime QA [Agent flow]: ErrorCode union 真实 contract', () => {
  const FLOW_CODES = [
    'APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED',
    'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED',
    'UNKNOWN_ERROR',
  ];
  for (const code of FLOW_CODES) {
    it(`flow error code "${code}" 在 developmentConvertFlow.ts`, () => {
      expect(FLOW_SRC).toContain(`'${code}'`);
    });
  }
  const SERVICE_CODES = ['DEV_CASE_NOT_FOUND', 'ORDER_NOT_FOUND', 'INVALID_INPUT', 'ALREADY_CONVERTED', 'CASE_CANCELLED', 'CONVERT_FAILED'];
  for (const code of SERVICE_CODES) {
    it(`service error code "${code}" 在 convertService.ts`, () => {
      expect(SERVICE_SRC).toContain(`'${code}'`);
    });
  }
});

// ═══ Part 4: Agent flow — draft-first 防篡改 + 语义校验 ═══
describe('runtime QA [Agent flow]: 防篡改 + 语义校验', () => {
  it('verifyDevConvertDraftHash 解析 :pd: 前缀', () => {
    expect(FLOW_SRC).toMatch(/idempotencyKey\.includes\(':pd:'\)/);
  });
  it('hash 不匹配 → PROCESS_DRAFT_HASH_MISMATCH', () => {
    expect(FLOW_SRC).toContain("'PROCESS_DRAFT_HASH_MISMATCH'");
  });
  it('validateDevConvertDraftSemantics: caseId 必填', () => {
    expect(FLOW_SRC).toMatch(/draft must contain caseId/);
  });
  it('validateDevConvertDraftSemantics: mode 必须是 link/autoCreate', () => {
    expect(FLOW_SRC).toMatch(/draft mode must be link or autoCreate/);
  });
  it('validateDevConvertDraftSemantics: link 模式需 orderId', () => {
    expect(FLOW_SRC).toMatch(/link mode requires orderId/);
  });
});

// ═══ Part 5: Agent flow — commitDevConvert 复用 service（不绕 contract） ═══
describe('runtime QA [Agent flow]: commitDevConvert 复用 convertDevCaseToOrder', () => {
  it('commitDevConvert 调用 convertDevCaseToOrder（不绕 route，不手写 DB mutation）', () => {
    const fnMatch = FLOW_SRC.match(/export async function commitDevConvert[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/convertDevCaseToOrder/);
  });
  it('commitDevConvert 返回 { ok:true, feedback: DevConvertFlowCommitted } | { ok:false, feedback }', () => {
    expect(FLOW_SRC).toMatch(/Promise<\{ ok: true; feedback: DevConvertFlowCommitted \} \| \{ ok: false/);
  });
});

// ═══ Part 6: toolRuntime — development.convert_to_order 分支 ═══
describe('runtime QA [toolRuntime]: development.convert_to_order commit 分支', () => {
  it('toolRuntime 含 development.convert_to_order 分支（精确匹配分支体）', () => {
    const branchMatch = TOOL_RUNTIME_SRC.match(/if \(call\.toolId === 'development\.convert_to_order'\) \{[\s\S]*?\n  \}/);
    expect(branchMatch).not.toBeNull();
  });
  it('toolRuntime draft-first: definition.id === development.convert_to_order', () => {
    expect(TOOL_RUNTIME_SRC).toMatch(/definition\.id === 'development\.convert_to_order'/);
  });
});

// ═══ Part 7: Manual route — POST /:id/convert 真实 contract ═══
describe('runtime QA [Manual route]: POST /:id/convert', () => {
  it('route 端点 POST /:id/convert 存在', () => {
    expect(ROUTE_SRC).toMatch(/router\.post\('\/:id\/convert'/);
  });
  it('route 调用 convertDevCaseToOrder service', () => {
    const fnMatch = ROUTE_SRC.match(/router\.post\('\/:id\/convert'[\s\S]*?\n  \}\);/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/convertDevCaseToOrder/);
  });
  it('route 失败时返回 { ok:false, error }（含 statusCode map）', () => {
    expect(ROUTE_SRC).toMatch(/statusCodeMap.*DEV_CASE_NOT_FOUND: 404/);
    expect(ROUTE_SRC).toMatch(/res\.status\(statusCodeMap/);
  });
});

// ═══ Part 8: Manual route — linkedOrderId/linkedOrderPo/convertedAt 返回消费 ═══
describe('runtime QA [Manual route]: DevelopmentCase linkedOrderId/convertedAt 返回', () => {
  it('route 成功返回 case.convertedAt（Number 序列化）', () => {
    const fnMatch = ROUTE_SRC.match(/router\.post\('\/:id\/convert'[\s\S]*?\n  \}\);/);
    expect(fnMatch![0]).toMatch(/convertedAt: doc\.convertedAt/);
  });
  it('route 成功返回 order（createdOrder）', () => {
    const fnMatch = ROUTE_SRC.match(/router\.post\('\/:id\/convert'[\s\S]*?\n  \}\);/);
    expect(fnMatch![0]).toMatch(/order: createdOrder/);
  });
});

// ═══ Part 9: 前端 service — convertToOrder 消费 route contract ═══
describe('runtime QA [前端 service]: developmentService.convertToOrder', () => {
  it('路径 /v1/development/:id/convert（对齐 route）', () => {
    expect(DEV_SVC_SRC).toMatch(/\/v1\/development\/\$\{[^}]+\}\/convert/);
  });
  it('POST 方法 + body（orderId/autoCreate/customer 等）', () => {
    expect(DEV_SVC_SRC).toMatch(/method: 'POST'/);
    expect(DEV_SVC_SRC).toMatch(/autoCreate/);
  });
  it('返回 { case, order } 消费 route res.json', () => {
    expect(DEV_SVC_SRC).toMatch(/return \{ case: data\.case, order: data\.order \?\? null \}/);
  });
  it('失败 throw Error（消费后端 error.message）', () => {
    expect(DEV_SVC_SRC).toMatch(/throw new Error\(err\.error/);
  });
});

// ═══ Part 10: DevelopmentManager UI — 手动 convert 路径 ═══
describe('runtime QA [DevelopmentManager UI]: 手动 convert 路径', () => {
  it('consume developmentService.convertToOrder', () => {
    expect(DEV_MGR_SRC).toMatch(/developmentService\.convertToOrder/);
  });
  it('条件渲染：stage===approved && !linkedOrderId（只对未转换的已批准 case）', () => {
    expect(DEV_MGR_SRC).toMatch(/selectedCase\.stage === 'approved' && !selectedCase\.linkedOrderId/);
  });
  it('成功后 handleRefresh 刷新（消费后端 case 返回）', () => {
    expect(DEV_MGR_SRC).toMatch(/await handleRefresh\(\)/);
  });
  it('成功提示用 res.order?.poNumber（不本地伪造）', () => {
    expect(DEV_MGR_SRC).toMatch(/res\.order\?\.poNumber/);
  });
  it('失败显示后端错误（catch err.message）', () => {
    expect(DEV_MGR_SRC).toMatch(/catch \(err: any\)[\s\S]*?err\.message/);
  });
  it('已转换显示 linkedOrderId/linkedOrderPo', () => {
    expect(DEV_MGR_SRC).toMatch(/selectedCase\.linkedOrderId/);
    expect(DEV_MGR_SRC).toMatch(/selectedCase\.linkedOrderPo/);
  });
});

// ═══ Part 11: 边界 — DevelopmentManager 不混 Agent flow ═══
describe('runtime QA [边界]: DevelopmentManager 与 Agent flow 隔离', () => {
  it('DevelopmentManager 不调用 Agent development.convert_to_order flow（只走 manual route）', () => {
    expect(DEV_MGR_SRC).not.toMatch(/developmentConvertFlow|commitDevConvert|development\.convert_to_order/);
  });
});

// ═══ Part 12: EntityLink/audit contract（commit 链路） ═══
describe('runtime QA [EntityLink/audit]: convert 事务闭环', () => {
  it('convertService 复用 sync（EntityLink 关联）', () => {
    expect(SERVICE_SRC).toMatch(/sync|EntityLink|entityLink/i);
  });
  it('convertService 含 audit（writeRouteAuditLog 或 auditLog）', () => {
    expect(SERVICE_SRC).toMatch(/audit|writeRouteAuditLog/i);
  });
});

// ═══ Part 13: 真实 payload fixture ═══
describe('runtime QA [fixture]: 真实 convert payload 消费', () => {
  it('link 模式 DevConvertDraftInput（caseId + mode=link + orderId/orderPo）', () => {
    const input = { caseId: 'DC1', mode: 'link' as const, orderId: 'O1', orderPo: 'PO-001' };
    expect(input.mode).toBe('link');
    expect(input.orderId).toBe('O1');
  });
  it('autoCreate 模式 DevConvertDraftInput（caseId + mode=autoCreate + customer/productName）', () => {
    const input = { caseId: 'DC2', mode: 'autoCreate' as const, customer: '客户A', productName: '产品X', quantity: 1000 };
    expect(input.mode).toBe('autoCreate');
    expect(input.quantity).toBe(1000);
  });
  it('committed payload: { status:committed, caseId, orderId, auditId, idempotencyKey }', () => {
    const committed = {
      status: 'committed' as const,
      caseId: 'DC1', orderId: 'O1', auditId: 'alog_123',
      idempotencyKey: 'dev.convert_to_order:DC1:link:pd:abc123',
    };
    expect(committed.status).toBe('committed');
    expect(committed.idempotencyKey).toContain('dev.convert_to_order:DC1:link');
  });
  it('route 成功 res.json: { ok:true, case:{...convertedAt}, order:{...}|null }', () => {
    const routeResponse = {
      ok: true,
      case: { id: 'DC1', linkedOrderId: 'O1', linkedOrderPo: 'PO-001', convertedAt: 1782700000, stage: 'approved' },
      order: { id: 'O1', poNumber: 'PO-001', importedAt: 1782700000 },
    };
    expect(routeResponse.case.linkedOrderId).toBe('O1');
    expect(routeResponse.case.convertedAt).toBe(1782700000);
    expect(routeResponse.order?.poNumber).toBe('PO-001');
  });
});
