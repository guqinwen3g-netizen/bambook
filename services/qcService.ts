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
  const message = err?.error?.message || (typeof err?.error === 'string' ? err.error : null) || `${fallback}: HTTP ${res.status}`;
  throw new Error(message);
}

function qcUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/qc${path}`, base);
}

async function postJson<T>(path: string, body: unknown, endpoint?: string, fallback = 'request failed'): Promise<T> {
  const res = await fetch(qcUrl(path, endpoint), {
    method: 'POST',
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
};
