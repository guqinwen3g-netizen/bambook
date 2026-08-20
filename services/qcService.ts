/**
 * QC API service — QC 双链域（DR-029）+ 验货报告双签（质量门禁 §9.3-②）。
 * Communicates with /api/v1/qc endpoints.
 *
 * 双链严格隔离（镜像后端 server/src/qc/qcChainService.ts 契约，root types.ts 冻结区
 * 禁止编辑，类型全部内聚在本文件）：
 *   - 服装链（工厂→QC→业务员→客户）：每轮新样必须重新 QC 评审后才可寄客户（DR-008
 *     内部门禁，fail-closed）；QC 可直接打回工厂重做（DIRECT_REJECT，QC-29-A4）
 *   - 面料链（业务员→QC→工厂→业务员）：客户不通过 → 业务员转 QC → QC 向工厂提技术
 *     调整 → 工厂新样 → 业务员再寄客户
 *   - 验货报告双签：signatures JSONB（qcSignedAt/qcSignerId/businessSignedAt/businessSignerId）
 */

import { apiService } from './apiService';

// ══════════════════════════════════════════════════════════════
// 常量与类型
// ══════════════════════════════════════════════════════════════

/** 服装链需 QC 内部门禁的样品级别（confirmation/FIT 开发样按 DR-027 排除） */
export const GARMENT_QC_SAMPLE_LEVELS = ['pp', 'top'] as const;
export type GarmentQcSampleLevel = (typeof GARMENT_QC_SAMPLE_LEVELS)[number];

/** 面料链可转 QC 的样品类型（S/S 船样 / RC 匹头样 / 投产后早期生产样） */
export const FABRIC_QC_SAMPLE_KINDS = ['SS', 'RC', 'EARLY_PRODUCTION'] as const;
export type FabricQcSampleKind = (typeof FABRIC_QC_SAMPLE_KINDS)[number];

/** 链评审结论处置 */
export const CHAIN_DISPOSITIONS = ['STANDARD', 'DIRECT_REJECT', 'REQUIRES_FACTORY_TECH_ADJUST'] as const;
export type ChainDisposition = (typeof CHAIN_DISPOSITIONS)[number];

export const CHAIN_CONCLUSION_LABELS: Record<string, string> = {
  pass: '通过',
  conditional: '有条件通过',
  fail: '不通过',
};

export const CHAIN_DISPOSITION_LABELS: Record<ChainDisposition, string> = {
  STANDARD: '标准流转',
  DIRECT_REJECT: '直接打回工厂重做',
  REQUIRES_FACTORY_TECH_ADJUST: '需工厂技术调整',
};

/** 服装链评审输入（DR-029：QC 文本评审意见不得压缩为机械二值） */
export interface GarmentSampleReviewInput {
  sampleLevel?: GarmentQcSampleLevel;   // pp | top（默认 pp）
  round?: number;                       // 样品轮次（>=1；客户不通过工厂重做后 round+1）
  conclusion?: 'pass' | 'conditional' | 'fail';
  opinion?: string;                     // QC 文本评审意见
  criticalDefects?: number;
  majorDefects?: number;
  minorDefects?: number;
  defectSummary?: string;
  evidence?: unknown[];
  inspectionDate?: string;              // YYYY-MM-DD
  directReject?: boolean;               // QC-29-A4：直接打回工厂重做
  rejectReason?: string;                // directReject=true 时必填
}

/** 面料链评审输入（conclusion≠pass 时 factoryAdjustment.requirement 必填） */
export interface FabricSampleReviewInput {
  sampleKind?: FabricQcSampleKind;
  sampleId?: string;                    // FabricShipmentSample.id / EarlyProductionSample.id
  conclusion?: 'pass' | 'conditional' | 'fail';
  opinion?: string;                     // QC 专业意见（对工厂的技术调整说明）
  criticalDefects?: number;
  majorDefects?: number;
  minorDefects?: number;
  defectSummary?: string;
  evidence?: unknown[];
  inspectionDate?: string;
  factoryAdjustment?: {
    requirement?: string;               // 调整要求（染整/后整理/修布等）
    parameters?: unknown;
    factoryName?: string;
    followUpBy?: string;
    evidence?: unknown[];
  };
}

/** DR-008 / QC-29-A3 服装样品寄送门禁查询结果 */
export interface GarmentSampleGate {
  orderId: string;
  sampleLevel: string;
  round: number;
  reviewed: boolean;
  passed: boolean;
  conclusion: string | null;
  disposition: ChainDisposition | null;
  reportId: string | null;
  blockedCode: 'RE_INSPECTION_REQUIRED' | 'SAMPLE_QC_GATE_NOT_PASSED' | 'SAMPLE_DIRECTLY_REJECTED' | null;
  blockedMessage: string | null;
}

/** InspectionReport 双签（signatures JSONB；chain 命名空间与双签字段平级共存） */
export interface InspectionReportSignatures {
  qcSignedAt?: number | null;
  qcSignerId?: string | null;
  businessSignedAt?: number | null;
  businessSignerId?: string | null;
  chain?: {
    disposition?: ChainDisposition;
    rejectReason?: string;
    factoryAdjustment?: { requirement?: string; factoryName?: string; followUpBy?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 验货报告行（链报告列表附加 chain/sampleKind/round 解析字段） */
export interface QcInspectionReport {
  id: string;
  orderId: string;
  inspectionType: string;               // final | midline | sample_pp__r1 | fabric_ss__r2 ...
  inspectionDate: string | null;
  inspectorOrg: string | null;
  result: string | null;                // pass | conditional | fail
  criticalDefects: number;
  majorDefects: number;
  minorDefects: number;
  defectSummary: string | null;
  inspectedBy: string | null;
  approvedByBusiness: boolean;
  businessApprover: string | null;
  notes: string | null;
  signatures: InspectionReportSignatures | null;
  createdAt: number;
  updatedAt: number;
  // listChainReports 附加（parseChainInspectionType 解析）
  chain?: 'garment' | 'fabric';
  sampleKind?: string;
  round?: number;
}

/** DR-014 面料出运三条件并行视图（QC ∥ S/S ∥ RC） */
export interface QcShipmentEligibility {
  orderId: string;
  applicable: boolean;
  eligible: boolean;
  conditions: {
    bulkQc: { satisfied: boolean; reportId?: string | null; result?: string | null; inspectedBy?: string | null; inspectionDate?: string | null };
    ss: { satisfied: boolean; sampleId?: string | null; sampleCode?: string | null; customerStatus?: string | null; customerFeedbackDate?: string | null };
    rc: { enabled: boolean; satisfied: boolean; sentDate?: string | null; confirmedDate?: string | null };
  };
  missingGates: Array<'BULK_QC_NOT_PASSED' | 'SS_NOT_CONFIRMED' | 'RC_NOT_CONFIRMED'>;
  reason?: string;
}

export type ReportSignRole = 'qc' | 'business';

// ══════════════════════════════════════════════════════════════
// 内部辅助
// ══════════════════════════════════════════════════════════════

async function parseError(res: Response, fallback: string): Promise<never> {
  const err = await res.json().catch(() => ({}));
  // server 信封：{ error: { code, message } }（qcRoute 风格），兼容平铺 { error: 'CODE' }
  const code = typeof err?.error?.code === 'string' ? err.error.code
    : typeof err?.error === 'string' ? err.error
      : undefined;
  const message = err?.error?.message || (typeof err?.error === 'string' ? err.error : null) || `${fallback}: HTTP ${res.status}`;
  const error: any = new Error(code && message !== code && !String(message).includes(code) ? `${code}：${message}` : message);
  error.status = res.status;
  error.code = code;
  throw error;
}

function qcUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/qc${path}`, base);
}

async function postJson<T>(path: string, body: unknown, endpoint?: string, fallback = 'request failed', method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
  const res = await fetch(qcUrl(path, endpoint), {
    method,
    headers: apiService.getAuthHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) await parseError(res, fallback);
  return res.json();
}

async function getJson<T>(path: string, endpoint?: string, fallback = 'request failed'): Promise<T> {
  const res = await fetch(qcUrl(path, endpoint), {
    headers: apiService.getAuthHeaders(),
  });
  if (!res.ok) await parseError(res, fallback);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// REQ2-04 第三方测试管理（TestRequest — 订单级实验室检测委托）
// ══════════════════════════════════════════════════════════════

/** 测试项目枚举（镜像后端 testRequestService.TEST_ITEMS） */
export const TEST_ITEMS = [
  'color_fastness', 'shrinkage', 'tensile', 'ph', 'formaldehyde', 'azo', 'gsm', 'width', 'other',
] as const;
export const TEST_ITEM_LABELS: Record<string, string> = {
  color_fastness: '色牢度', shrinkage: '缩水率', tensile: '强力', ph: 'pH 值',
  formaldehyde: '甲醛', azo: '偶氮', gsm: '克重', width: '幅宽', other: '其他',
};

export const TEST_AGENCIES = ['sgs', 'its', 'bv', 'other'] as const;
export const TEST_AGENCY_LABELS: Record<string, string> = { sgs: 'SGS', its: 'ITS', bv: 'BV', other: '其他机构' };
export const TEST_RESULT_LABELS: Record<string, string> = { pending: '待报告', pass: '通过', fail: '不合格' };

export interface TestReportFileRow {
  id: string;
  testRequestId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: number;
}

export interface TestCorrectiveActionRow {
  id: string;
  testRequestId: string;
  failItem: string;
  action: string;
  owner: string | null;
  dueDate: string | null;
  status: 'open' | 'closed';
  closedAt: number | null;
  closeNote: string | null;
}

export interface TestRequestRow {
  id: string;
  trNo: string;
  orderId: string;
  testItems: string[];
  agency: string;
  sentDate: string | null;
  expectedDate: string | null;
  notes: string | null;
  result: 'pending' | 'pass' | 'fail';
  reportNo: string | null;
  reportDate: string | null;
  failItems: string[];
  createdAt: number;
  files: TestReportFileRow[];
  correctiveActions: TestCorrectiveActionRow[];
}

export interface TestRequestSummary {
  total: number;
  pass: number;
  fail: number;
  pending: number;
  openCorrectiveActions: number;
}

// ══════════════════════════════════════════════════════════════
// service
// ══════════════════════════════════════════════════════════════

export const qcService = {
  // ── DR-029 双链样品 QC 评审（服装链 / 面料链 强制边界） ──

  /** 服装链评审（qc:garment_chain:write；每轮新样必须重新评审后才可寄客户） */
  async reviewGarmentSample(orderId: string, input: GarmentSampleReviewInput, endpoint?: string): Promise<{ report: QcInspectionReport; gate: GarmentSampleGate }> {
    return postJson(`/chain/garment/${encodeURIComponent(orderId)}/review`, input, endpoint, 'reviewGarmentSample failed');
  },

  /** QC-29-A4：直接打回工厂重做（该批不得寄客户，系统通知业务员） */
  async directRejectGarmentSample(orderId: string, input: GarmentSampleReviewInput, endpoint?: string): Promise<{ report: QcInspectionReport; gate: GarmentSampleGate }> {
    return postJson(`/chain/garment/${encodeURIComponent(orderId)}/direct-reject`, input, endpoint, 'directRejectGarmentSample failed');
  },

  /** 面料链评审（qc:fabric_chain:write；QC 向工厂提技术调整要求） */
  async reviewFabricSample(orderId: string, input: FabricSampleReviewInput, endpoint?: string): Promise<{ report: QcInspectionReport }> {
    return postJson(`/chain/fabric/${encodeURIComponent(orderId)}/review`, input, endpoint, 'reviewFabricSample failed');
  },

  /** DR-008 内部门禁查询（样品域提交客户前消费；fail-closed） */
  async getGarmentSampleGate(orderId: string, params: { sampleLevel?: GarmentQcSampleLevel; round: number }, endpoint?: string): Promise<GarmentSampleGate> {
    const query = new URLSearchParams();
    if (params.sampleLevel) query.set('sampleLevel', params.sampleLevel);
    query.set('round', String(params.round));
    const data = await getJson<{ gate: GarmentSampleGate }>(
      `/chain/garment/${encodeURIComponent(orderId)}/gate?${query.toString()}`, endpoint, 'getGarmentSampleGate failed');
    return data.gate;
  },

  /** 链报告列表（样品链与大货 final/midline 天然隔离；chain 缺省返回全部链报告） */
  async listChainReports(orderId: string, chain?: 'garment' | 'fabric', endpoint?: string): Promise<QcInspectionReport[]> {
    const query = chain ? `?chain=${chain}` : '';
    const data = await getJson<{ items: QcInspectionReport[] }>(
      `/chain/${encodeURIComponent(orderId)}/reports${query}`, endpoint, 'listChainReports failed');
    return data.items || [];
  },

  // ── DR-014 出运资格 + 报告读取 ──

  /** DR-014 面料出运三条件并行视图（QC ∥ S/S ∥ RC） */
  async getOrderShipmentEligibility(orderId: string, endpoint?: string): Promise<QcShipmentEligibility> {
    return getJson(`/orders/${encodeURIComponent(orderId)}/shipment-eligibility`, endpoint, 'getOrderShipmentEligibility failed');
  },

  /** 订单全部验货报告（含大货 final/midline 与样品链报告） */
  async listOrderReports(orderId: string, endpoint?: string): Promise<QcInspectionReport[]> {
    const data = await getJson<{ items: QcInspectionReport[]; total: number }>(
      `/orders/${encodeURIComponent(orderId)}/reports`, endpoint, 'listOrderReports failed');
    return data.items || [];
  },

  /** 单条验货报告 */
  async getReport(reportId: string, endpoint?: string): Promise<QcInspectionReport> {
    const data = await getJson<{ item: QcInspectionReport }>(
      `/reports/${encodeURIComponent(reportId)}`, endpoint, 'getReport failed');
    return data.item;
  },

  /** 报告双签（role=qc|business；已签署侧不可重复签署，fail-closed） */
  async signReport(reportId: string, role: ReportSignRole, endpoint?: string): Promise<QcInspectionReport> {
    const data = await postJson<{ item: QcInspectionReport }>(
      `/reports/${encodeURIComponent(reportId)}/sign`, { role }, endpoint, 'signReport failed');
    return data.item;
  },

  // ── REQ2-04 第三方测试管理 ──

  /** 登记测试委托 {orderId, testItems[], agency, sentDate?, expectedDate?, notes?} */
  async createTestRequest(input: {
    orderId: string;
    testItems: string[];
    agency: string;
    sentDate?: string;
    expectedDate?: string;
    notes?: string;
  }, endpoint?: string): Promise<{ request: TestRequestRow }> {
    const data = await postJson<{ request: TestRequestRow }>(
      '/test-requests', input, endpoint, 'createTestRequest failed');
    return { request: data.request };
  },

  /** 订单维度全景（附件+整改+summary，3 击数据源） */
  async listTestRequests(orderId: string, endpoint?: string): Promise<{ items: TestRequestRow[]; summary: TestRequestSummary }> {
    const data = await getJson<{ items: TestRequestRow[]; summary: TestRequestSummary }>(
      `/test-requests?orderId=${encodeURIComponent(orderId)}`, endpoint, 'listTestRequests failed');
    return { items: data.items || [], summary: data.summary };
  },

  /** 结论登记（fail 门禁：failItems + correctiveAction 必传或已有 open 整改） */
  async updateTestRequest(id: string, patch: {
    result?: 'pass' | 'fail';
    reportNo?: string;
    reportDate?: string;
    failItems?: string[];
    notes?: string;
    sentDate?: string;
    expectedDate?: string;
    correctiveAction?: { failItem: string; action: string; owner?: string; dueDate?: string };
  }, endpoint?: string): Promise<{ request: TestRequestRow }> {
    const data = await postJson<{ request: TestRequestRow }>(
      `/test-requests/${encodeURIComponent(id)}`, patch, endpoint, 'updateTestRequest failed', 'PATCH');
    return { request: data.request };
  },

  /** 软删委托（仅 pending） */
  async deleteTestRequest(id: string, endpoint?: string): Promise<void> {
    await postJson(`/test-requests/${encodeURIComponent(id)}`, {}, endpoint, 'deleteTestRequest failed', 'DELETE');
  },

  /** 上传报告 PDF（multipart；PDF only ≤10MB） */
  async uploadTestReport(id: string, files: File[], endpoint?: string): Promise<{ files: TestReportFileRow[] }> {
    const url = qcUrl(`/test-requests/${encodeURIComponent(id)}/files`, endpoint);
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch(url, { method: 'POST', body: form, headers: apiService.getAuthHeaders() });
    if (!res.ok) await parseError(res, 'uploadTestReport failed');
    const data = await res.json();
    return { files: data.files || [] };
  },

  /** 报告下载 URL（新窗口打开/预览） */
  testReportDownloadUrl(id: string, fileId: string, endpoint?: string): string {
    return qcUrl(`/test-requests/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, endpoint);
  },

  /** 追加整改记录（仅 fail 单；failItem ∈ failItems） */
  async addCorrectiveAction(id: string, input: {
    failItem: string; action: string; owner?: string; dueDate?: string;
  }, endpoint?: string): Promise<{ correctiveAction: TestCorrectiveActionRow }> {
    const data = await postJson<{ correctiveAction: TestCorrectiveActionRow }>(
      `/test-requests/${encodeURIComponent(id)}/corrective-actions`, input, endpoint, 'addCorrectiveAction failed');
    return { correctiveAction: data.correctiveAction };
  },

  /** 整改闭环（open→closed） */
  async closeCorrectiveAction(caId: string, closeNote?: string, endpoint?: string): Promise<{ correctiveAction: TestCorrectiveActionRow }> {
    const data = await postJson<{ correctiveAction: TestCorrectiveActionRow }>(
      `/test-requests/corrective-actions/${encodeURIComponent(caId)}/close`, { closeNote }, endpoint, 'closeCorrectiveAction failed');
    return { correctiveAction: data.correctiveAction };
  },
};
