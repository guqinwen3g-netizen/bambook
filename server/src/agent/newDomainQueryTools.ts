/**
 * newDomainQueryTools.ts — Phase 4 Track G：Phase 2 八域 Agent 只读查询工具
 *
 * 覆盖域（Phase 2 已落地后端域，与路由同一 service 真源）：
 *   1. MOQ 域            moq.query_config        — 当前生效 MOQ 阈值配置（含兜底常量回落标记）+ 可选变更历史
 *   2. 订单变更域        order_changes.query     — DR-010 变更/取消/暂停申请列表与详情
 *   3. 样品域            samples.query           — 面料寄船样/早期生产样/服装多轮样品（DR-008 双门禁）查询
 *   4. QC 双链域         qc.query_reports        — 订单 QC 报告列表（DR-029 服装链/面料链）+ 可选出运资格
 *   5. 受控例外域        exceptions.query        — DR-013 例外申请列表与详情（惰性对账审批结论）
 *   6. 信用域            credit.query_status     — 客户信用状态（冻结门禁/最大逾期天数）+ 可选历史时间线
 *   7. 内部交易域        internal_trade.query    — DR-005/033 内部供料单列表与详情
 *   8. 付款申请域        payment_requests.query  — DR-017 付款申请列表与详情
 *
 * 铁律：
 *   - 全部只读：risk=low + approvalPolicy=never，不触发审批链、不写库
 *   - 直接调用各域 service 层函数（与路由同一真源），禁止绕过 service 直查 prisma
 *   - 返回结构化数据 + 人类可读 summary（供 agentLoop observation 直接展示）
 *   - import 廉价：域 service 工厂在 handler 内惰性加载（本模块被 toolRegistry/toolRuntime
 *     全图引用，顶层不得传递依赖各域 service 的模块层求值，避免与既有测试的模块级
 *     total-mock 产生导入链耦合）；仅 INTERNAL_TRANSFER_STATUSES 例外（其宿主模块顶层
 *     仅依赖 logger/audit/crypto，且 inputSchema 枚举需在定义期取值）
 */

import type { PrismaClient } from '@prisma/client';
import { registerTool } from './toolDispatchRegistry';
import type { ToolDefinition } from './toolRegistry';
import { INTERNAL_TRANSFER_STATUSES } from '../internalTrade/internalTransferService';

// ───────────────────────────────────────────────────────────────────
// 通用辅助
// ───────────────────────────────────────────────────────────────────

function numberInput(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

function strInput(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}

/** BigInt / Decimal JSON 序列化（与 creditRoute 同口径，保障 agent observation JSON 安全） */
function serializeValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeValue) as T;
  if (typeof value === 'object') {
    if ((value as any).constructor?.name === 'Decimal') return Number((value as any).toString()) as T;
    if (value instanceof Date) return value;
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

/** 依赖 approvalCreateService 的域服务构造（与各域 route 同一线路，仅用于其只读函数；惰性加载） */
async function makeApprovalCreateService(prisma: PrismaClient) {
  const { createApprovalRoutingService } = await import('../approvals/approvalRoutingService');
  const { createApprovalCreateService } = await import('../approvals/approvalCreateService');
  const routingService = createApprovalRoutingService({ prisma });
  return createApprovalCreateService({ prisma, routingService });
}

function failResult(code: string, message: string) {
  return { ok: false, error: message, errorCode: code, summary: message };
}

// ───────────────────────────────────────────────────────────────────
// P0-B ToolDefinition（risk=low + approvalPolicy=never，只读四切片语义）
// ───────────────────────────────────────────────────────────────────

export const NEW_DOMAIN_QUERY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: 'moq.query_config',
    name: 'Query MOQ Config',
    scope: 'settings',
    risk: 'low',
    description: '查询当前生效的 MOQ 最小起订量阈值配置（面料/成衣/Capsule 三档），配置缺失时回落兜底常量并标记来源；可选附带阈值变更历史（append-only）。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        includeHistory: { type: 'boolean', description: '是否附带阈值变更历史（默认 false）' },
        historyLimit: { type: 'number', description: '变更历史条数上限（默认 50，最大 200）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        config: { type: ['object', 'null'] },
        effectiveValues: { type: 'object' },
        source: { type: 'string', enum: ['moq_config', 'fallback_constant'] },
        history: { type: 'array' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'order_changes.query',
    name: 'Query Order Change Requests',
    scope: 'orders',
    risk: 'low',
    description: '查询 DR-010 订单变更/取消/暂停申请：按订单、状态、申请人过滤列表，或按申请 ID 读取单条详情（含关联订单与审批单快照）。用于回答某订单有哪些变更记录、某变更申请审批进度等问题。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '变更申请 ID（提供时返回单条详情）' },
        orderId: { type: 'string', description: '按订单 ID 过滤' },
        status: { type: 'string', description: '按状态过滤（Pending/Approved/Applied/Cancelled 等）' },
        requesterId: { type: 'string', description: '按申请人过滤' },
        limit: { type: 'number', description: '列表条数上限（默认 100，最大 500）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        items: { type: 'array' },
        item: { type: ['object', 'null'] },
        total: { type: 'number' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'samples.query',
    name: 'Query Samples',
    scope: 'samples',
    risk: 'low',
    description: '查询样品记录：fabric_shipment 模式按订单列出面料寄船样/头缸样（含 Exmill 倒计时，可选发货资格判定）；early_production 模式按订单列出投产后早期生产样轮次；garment_rounds 模式按开发案列出服装多轮样品及封样状态（DR-008 双门禁）。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['fabric_shipment', 'early_production', 'garment_rounds'], description: '查询模式（默认 fabric_shipment）' },
        orderId: { type: 'string', description: '订单 ID（fabric_shipment / early_production 模式必填）' },
        caseId: { type: 'string', description: '开发案 ID（garment_rounds 模式必填）' },
        includeEligibility: { type: 'boolean', description: 'fabric_shipment 模式下附带 DR-012 发货资格判定' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        items: { type: 'array' },
        sealedRoundId: { type: ['string', 'null'] },
        eligibility: { type: 'object' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'qc.query_reports',
    name: 'Query QC Reports',
    scope: 'qc',
    risk: 'low',
    description: '按订单查询 QC 报告列表（DR-029 服装链/面料链：报告状态、结论、缺陷统计），可选附带 QC 侧出运资格判定（报告是否齐备/通过）。用于回答某订单验货结果、能否出货等问题。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: '订单 ID（必填）' },
        includeEligibility: { type: 'boolean', description: '附带 QC 出运资格判定（默认 false）' },
      },
      required: ['orderId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        items: { type: 'array' },
        total: { type: 'number' },
        eligibility: { type: 'object' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'exceptions.query',
    name: 'Query Controlled Exceptions',
    scope: 'exceptions',
    risk: 'low',
    description: '查询 DR-013 受控例外申请：按状态、例外类别、申请人过滤列表，或按申请 ID 读取单条详情（惰性对账审批结论后返回）。用于回答某订单是否有生效中的例外放行、某例外申请审批进度等问题。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '例外申请 ID（提供时返回单条详情）' },
        status: { type: 'string', description: '按状态过滤（Pending/ReviewerApproved/BossFinalBypass/Consumed/Expired/Cancelled 等）' },
        exceptionCategory: { type: 'string', description: '按例外类别过滤' },
        requesterId: { type: 'string', description: '按申请人过滤' },
        limit: { type: 'number', description: '列表条数上限（默认 100，最大 500）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        items: { type: 'array' },
        item: { type: ['object', 'null'] },
        total: { type: 'number' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'credit.query_status',
    name: 'Query Customer Credit Status',
    scope: 'credit',
    risk: 'low',
    description: '查询客户信用状态：额度总额/已占用/剩余、冻结门禁标记（creditFrozen）、最大逾期天数；可选附带冻结/解冻/占用释放全事件历史时间线（append-only）。用于回答某客户额度还剩多少、是否被冻结、为何冻结等问题。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        relationId: { type: 'string', description: '客户 Relation ID（必填；只有客户名时先 relations.query 解析）' },
        includeHistory: { type: 'boolean', description: '是否附带信用历史时间线（默认 false）' },
        historyLimit: { type: 'number', description: '历史条数上限（默认 100，最大 500）' },
      },
      required: ['relationId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        status: { type: 'object' },
        history: { type: 'array' },
        historyTotal: { type: 'number' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'internal_trade.query',
    name: 'Query Internal Transfers',
    scope: 'internal_trade',
    risk: 'low',
    description: '查询 DR-005/033 内部供料单（服装部向面料部的内部交易）：按部门、状态、服装订单、面料订单过滤列表，或按供料单 ID 读取单条详情（master + mirror + 解码载荷）。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '内部供料单 ID（提供时返回单条详情）' },
        departmentId: { type: 'string', description: '按申请部门过滤' },
        status: { type: 'string', enum: [...INTERNAL_TRANSFER_STATUSES], description: '按状态过滤' },
        garmentOrderId: { type: 'string', description: '按服装订单过滤' },
        fabricOrderId: { type: 'string', description: '按面料订单过滤' },
        limit: { type: 'number', description: '列表条数上限（默认 100，最大 500）' },
        offset: { type: 'number', description: '列表偏移（默认 0）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        items: { type: 'array' },
        item: { type: ['object', 'null'] },
        total: { type: 'number' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
  {
    id: 'payment_requests.query',
    name: 'Query Payment Requests',
    scope: 'finance',
    risk: 'low',
    description: '查询 DR-017 付款申请（先申请后付款）：按状态、付款性质、申请人过滤列表，或按申请 ID 读取单条详情（含关联审批单与付款凭证快照）。用于回答某供应商付款申请进度、是否已生成付款凭证等问题。只读，无副作用。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '付款申请 ID（提供时返回单条详情）' },
        status: { type: 'string', description: '按状态过滤（Draft/Pending/Approved/Rejected/VoucherIssued/Cancelled）' },
        paymentCategory: { type: 'string', description: '按付款性质过滤（normal/advance/deposit/三类费用）' },
        applicantId: { type: 'string', description: '按申请人过滤' },
        limit: { type: 'number', description: '列表条数上限（默认 100，最大 500）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        items: { type: 'array' },
        item: { type: ['object', 'null'] },
        total: { type: 'number' },
        summary: { type: 'string' },
      },
    },
    approvalPolicy: 'never',
  },
];

// ───────────────────────────────────────────────────────────────────
// Handlers（直接调用各域 service 层函数，与路由同一真源）
// ───────────────────────────────────────────────────────────────────

async function handleMoqQueryConfig(prisma: PrismaClient, input: Record<string, unknown>) {
  const { createMoqConfigService, MOQ_FALLBACK_CONSTANTS } = await import('../moq/moqConfigService');
  const svc = createMoqConfigService({ prisma });
  const config = await svc.getActiveConfig();
  const source = config ? 'moq_config' : 'fallback_constant';
  const effective = config ?? MOQ_FALLBACK_CONSTANTS;
  const includeHistory = input.includeHistory === true;
  const history = includeHistory
    ? await svc.listHistory({ limit: numberInput(input.historyLimit, 50) })
    : undefined;
  const summary = config
    ? `当前生效 MOQ 阈值：面料 ${effective.fabricDefaultMoq} / 成衣 ${effective.garmentDefaultMoq} / Capsule ${effective.capsuleMoq}（${new Date(config.effectiveFrom).toISOString().slice(0, 10)} 起生效，由 ${config.changedBy} 调整）`
    : `MOQ 配置未初始化或读取失败，当前使用兜底常量：面料 ${effective.fabricDefaultMoq} / 成衣 ${effective.garmentDefaultMoq} / Capsule ${effective.capsuleMoq}`;
  return serializeValue({
    ok: true,
    config,
    effectiveValues: {
      fabricDefaultMoq: effective.fabricDefaultMoq,
      garmentDefaultMoq: effective.garmentDefaultMoq,
      capsuleMoq: effective.capsuleMoq,
    },
    source,
    ...(history ? { history } : {}),
    summary,
  });
}

async function handleOrderChangesQuery(prisma: PrismaClient, input: Record<string, unknown>) {
  const { createOrderChangeRequestService } = await import('../orderChanges/orderChangeRequestService');
  const svc = createOrderChangeRequestService({ prisma, approvalCreateService: await makeApprovalCreateService(prisma) });
  const id = strInput(input.id);
  if (id) {
    const { item } = await svc.getChangeRequest(id);
    if (!item) return failResult('NOT_FOUND', `变更申请 ${id} 不存在或已删除`);
    return serializeValue({
      ok: true,
      item,
      summary: `变更申请 ${item.requestNumber}：类型 ${(item.changeTypes ?? []).join('/') || 'other'}，状态 ${item.status}，订单 ${item.order?.poNumber ?? item.orderId}`,
    });
  }
  const { items } = await svc.listChangeRequests({
    orderId: strInput(input.orderId),
    status: strInput(input.status),
    requesterId: strInput(input.requesterId),
    limit: numberInput(input.limit, 100),
  });
  return serializeValue({
    ok: true,
    items,
    total: items.length,
    summary: `共 ${items.length} 条变更申请${items.length > 0 ? `（最新：${items[0].requestNumber}，状态 ${items[0].status}）` : ''}`,
  });
}

async function handleSamplesQuery(prisma: PrismaClient, input: Record<string, unknown>) {
  const mode = strInput(input.mode) ?? 'fabric_shipment';

  if (mode === 'garment_rounds') {
    const caseId = strInput(input.caseId);
    if (!caseId) return failResult('MISSING_CASE_ID', 'garment_rounds 模式必须提供 caseId（开发案 ID）');
    const { createGarmentSampleGateService } = await import('../samples/garmentSampleGateService');
    const svc = createGarmentSampleGateService({ prisma });
    const r = await svc.listRounds({ caseId });
    if (!r.ok) return failResult(r.error.code, r.error.message);
    return serializeValue({
      ok: true,
      items: r.data.items,
      sealedRoundId: r.data.sealedRoundId,
      summary: `开发案 ${caseId} 共 ${r.data.items.length} 轮服装样品${r.data.sealedRoundId ? '，已封样' : '，尚未封样'}`,
    });
  }

  const orderId = strInput(input.orderId);
  if (!orderId) return failResult('MISSING_ORDER_ID', `${mode} 模式必须提供 orderId（订单 ID）`);

  if (mode === 'early_production') {
    const { createEarlyProductionSampleService } = await import('../samples/earlyProductionSampleService');
    const svc = createEarlyProductionSampleService({ prisma });
    const r = await svc.listByOrder({ orderId });
    if (!r.ok) return failResult(r.error.code, r.error.message);
    return serializeValue({
      ok: true,
      items: r.data.items,
      summary: `订单 ${orderId} 共 ${r.data.items.length} 轮早期生产样`,
    });
  }

  // 默认 fabric_shipment：面料寄船样/头缸样
  const { createFabricShipmentSampleService } = await import('../samples/fabricShipmentSampleService');
  const svc = createFabricShipmentSampleService({ prisma });
  const r = await svc.listOrderSamples({ orderId });
  if (!r.ok) return failResult(r.error.code, r.error.message);
  let eligibility: unknown;
  if (input.includeEligibility === true) {
    const e = await svc.computeShipmentEligibility({ orderId });
    if (e.ok) eligibility = e.data.eligibility;
  }
  return serializeValue({
    ok: true,
    items: r.data.items,
    ...(eligibility ? { eligibility } : {}),
    summary: `订单 ${orderId} 共 ${r.data.items.length} 条面料样品记录${eligibility ? `，发货资格：${(eligibility as any).eligible === true ? '具备' : '不具备'}` : ''}`,
  });
}

async function handleQcQueryReports(prisma: PrismaClient, input: Record<string, unknown>) {
  const orderId = strInput(input.orderId);
  if (!orderId) return failResult('MISSING_ORDER_ID', '必须提供 orderId（订单 ID）');
  const { createQcService } = await import('../qc/qcService');
  const svc = createQcService(prisma);
  const { items, total } = await svc.listReportsByOrder(orderId);
  let eligibility: unknown;
  if (input.includeEligibility === true) {
    eligibility = await svc.checkShipmentEligibility(orderId);
  }
  return serializeValue({
    ok: true,
    items,
    total,
    ...(eligibility ? { eligibility } : {}),
    summary: `订单 ${orderId} 共 ${total} 份 QC 报告${eligibility ? `，QC 出运资格：${(eligibility as any).eligible === true ? '具备' : '不具备'}` : ''}`,
  });
}

async function handleExceptionsQuery(prisma: PrismaClient, input: Record<string, unknown>) {
  const { createExceptionService } = await import('../exceptions/exceptionService');
  const svc = createExceptionService({ prisma, approvalCreateService: await makeApprovalCreateService(prisma) });
  const id = strInput(input.id);
  if (id) {
    const r = await svc.getExceptionById(id);
    if (!r.ok) return failResult(r.error.code, r.error.message);
    return serializeValue({
      ok: true,
      item: r.data.exception,
      summary: `例外申请 ${r.data.exception.requestNumber ?? id}：类别 ${r.data.exception.exceptionCategory}，状态 ${r.data.exception.status}`,
    });
  }
  const r = await svc.listExceptions({
    status: strInput(input.status),
    exceptionCategory: strInput(input.exceptionCategory),
    requesterId: strInput(input.requesterId),
    limit: numberInput(input.limit, 100),
  });
  if (!r.ok) return failResult(r.error.code, r.error.message);
  return serializeValue({
    ok: true,
    items: r.data.items,
    total: r.data.items.length,
    summary: `共 ${r.data.items.length} 条例外申请`,
  });
}

async function handleCreditQueryStatus(prisma: PrismaClient, input: Record<string, unknown>) {
  const relationId = strInput(input.relationId);
  if (!relationId) return failResult('MISSING_RELATION_ID', '必须提供 relationId（客户 Relation ID）');
  const { createCreditService } = await import('../credit/creditService');
  const svc = createCreditService({ prisma });
  const status = await svc.getCreditStatus(relationId);
  if (!status) return failResult('NOT_FOUND', `客户 ${relationId} 不存在`);
  let history: unknown;
  let historyTotal: number | undefined;
  if (input.includeHistory === true) {
    const h = await svc.getCreditHistory({ relationId, limit: numberInput(input.historyLimit, 100) });
    if (h.ok) {
      history = h.data.items;
      historyTotal = h.data.total;
    }
  }
  const summary = !status.hasCreditLimit
    ? `客户 ${relationId} 未设置信用额度（最大逾期 ${status.maxOverdueDays} 天）`
    : `客户 ${relationId} 信用状态 ${status.status}：额度 ${status.totalLimit} ${status.currency ?? ''}，已占用 ${status.usedAmount}，剩余 ${status.remaining}${status.creditFrozen ? '（已冻结，禁止新订单）' : ''}，最大逾期 ${status.maxOverdueDays} 天`;
  return serializeValue({
    ok: true,
    status,
    ...(history ? { history, historyTotal } : {}),
    summary,
  });
}

async function handleInternalTradeQuery(prisma: PrismaClient, input: Record<string, unknown>) {
  const { createInternalTransferService } = await import('../internalTrade/internalTransferService');
  const svc = createInternalTransferService({ prisma, approvalCreateService: await makeApprovalCreateService(prisma) });
  const id = strInput(input.id);
  if (id) {
    const r = await svc.getInternalTransferById(id);
    if (!r) return failResult('NOT_FOUND', `内部供料单 ${id} 不存在或已删除`);
    return serializeValue({
      ok: true,
      item: r,
      summary: `内部供料单 ${id}：状态 ${r.payload?.status ?? '未知'}，物料 ${r.payload?.materialCode ?? '-'}`,
    });
  }
  const statusRaw = strInput(input.status);
  const status = statusRaw && (INTERNAL_TRANSFER_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as (typeof INTERNAL_TRANSFER_STATUSES)[number])
    : undefined;
  const { items, total } = await svc.listInternalTransfers({
    departmentId: strInput(input.departmentId),
    status,
    garmentOrderId: strInput(input.garmentOrderId),
    fabricOrderId: strInput(input.fabricOrderId),
    limit: numberInput(input.limit, 100),
    offset: Math.max(0, Number(input.offset) || 0),
  });
  return serializeValue({
    ok: true,
    items,
    total,
    summary: `共 ${total} 条内部供料单（本页 ${items.length} 条）`,
  });
}

async function handlePaymentRequestsQuery(prisma: PrismaClient, input: Record<string, unknown>) {
  const { createPaymentRequestService } = await import('../paymentRequests/paymentRequestService');
  const svc = createPaymentRequestService({ prisma, approvalCreateService: await makeApprovalCreateService(prisma) });
  const id = strInput(input.id);
  if (id) {
    const { item } = await svc.getPaymentRequest(id);
    if (!item) return failResult('NOT_FOUND', `付款申请 ${id} 不存在或已删除`);
    return serializeValue({
      ok: true,
      item,
      summary: `付款申请 ${item.requestNumber}：${item.totalAmount} ${item.currency}，状态 ${item.status}${item.paymentVoucher ? `，已生成凭证 ${item.paymentVoucher.voucherNumber}` : ''}`,
    });
  }
  const { items } = await svc.listPaymentRequests({
    status: strInput(input.status),
    paymentCategory: strInput(input.paymentCategory),
    applicantId: strInput(input.applicantId),
    limit: numberInput(input.limit, 100),
  });
  return serializeValue({
    ok: true,
    items,
    total: items.length,
    summary: `共 ${items.length} 条付款申请${items.length > 0 ? `（最新：${items[0].requestNumber}，状态 ${items[0].status}）` : ''}`,
  });
}

// ───────────────────────────────────────────────────────────────────
// 注册入口（toolRuntime 一次性接线）
// ───────────────────────────────────────────────────────────────────

export function registerNewDomainQueryTools(): void {
  registerTool('moq.query_config', (prisma, input) => handleMoqQueryConfig(prisma, input));
  registerTool('order_changes.query', (prisma, input) => handleOrderChangesQuery(prisma, input));
  registerTool('samples.query', (prisma, input) => handleSamplesQuery(prisma, input));
  registerTool('qc.query_reports', (prisma, input) => handleQcQueryReports(prisma, input));
  registerTool('exceptions.query', (prisma, input) => handleExceptionsQuery(prisma, input));
  registerTool('credit.query_status', (prisma, input) => handleCreditQueryStatus(prisma, input));
  registerTool('internal_trade.query', (prisma, input) => handleInternalTradeQuery(prisma, input));
  registerTool('payment_requests.query', (prisma, input) => handlePaymentRequestsQuery(prisma, input));
}
