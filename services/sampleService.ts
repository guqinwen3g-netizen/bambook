/**
 * Sample API service — 样品域（DR-008/011/012/026/028/039）。
 * Communicates with /api/v1/samples endpoints.
 *
 * 覆盖三条链路（镜像后端 server/src/samples/ 契约，root types.ts 冻结区禁止编辑，
 * 类型全部内聚在本文件）：
 *   1. 面料 S/S 船样 + RC 匹头样（DR-011/012/039）：登记 → 寄送 → 客户确认 → 发货资格判定
 *   2. 投产后早期生产样（DR-028）：不限轮次闭环链（previousSampleId 链入上一轮）
 *   3. 服装多轮样品双门禁（DR-008/029）：内部门禁（QC 通过才允许提交客户）+ 客户确认 → 封存
 */

import { apiService } from './apiService';

// ══════════════════════════════════════════════════════════════
// 共享：寄送 / 确认 / 倒计时
// ══════════════════════════════════════════════════════════════

/** DR-039 寄送登记（快递商/单号/日期/收件方 + 随附单据） */
export interface SampleShipmentInput {
  sentDate?: string;          // YYYY-MM-DD，默认今天
  courier: string;            // 必填：快递服务商
  trackingNumber: string;     // 必填：快递单号
  recipientName: string;      // 必填：收件方
  recipientContact?: string;
  documents?: unknown[];      // 随附单据（样品发票/快递运费凭证等）
}

/** 客户确认登记（客户不登录系统，业务员登记结果/日期/渠道/意见/证据） */
export interface SampleConfirmationInput {
  result: 'approved' | 'rejected' | 'needs_revision';
  confirmationDate: string;   // 必填 YYYY-MM-DD
  channel: string;            // 必填：确认渠道（email/phone/wechat/...）
  note?: string;
  evidence?: unknown[];
}

/** DR-011 Exmill 倒计时（后端 computeSampleCountdown 投影） */
export interface SampleCountdown {
  kind: 'SS' | 'RC';
  exmillDate: string | null;
  deadlineDays: number;
  deadlineOverridden: boolean;
  confirmDeadline: string | null;
  daysToDeadline: number | null;   // 负值 = 已逾期
  overdue: boolean;
  sent: boolean;
  confirmed: boolean;
  customerStatus: string;
}

// ══════════════════════════════════════════════════════════════
// 面料 S/S 船样 + RC 匹头样（DR-011/012）
// ══════════════════════════════════════════════════════════════

export const FABRIC_SAMPLE_CUSTOMER_STATUSES = ['pending', 'approved', 'rejected', 'needs_revision'] as const;
export type FabricSampleCustomerStatus = (typeof FABRIC_SAMPLE_CUSTOMER_STATUSES)[number];

export const FABRIC_SAMPLE_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  approved: '已确认',
  rejected: '已拒绝',
  needs_revision: '需修改',
};

/** FabricShipmentSample 行（后端 listOrderSamples 输出：行 + sampleKind + countdown） */
export interface FabricShipmentSampleRow {
  id: string;
  sampleCode: string;                    // FSS-YYYYMMDD-001 / FRC-YYYYMMDD-001
  orderId: string;
  shipmentId: string;
  fabricProfileId: string | null;
  sampleQuantity: number;
  sampleUnit: string;
  batchNo: string | null;
  rollNos: string[];
  cuttingDate: string;
  sentToCustomer: boolean;
  sentDate: string | null;
  courier: string | null;
  trackingNumber: string | null;
  recipientName: string | null;
  recipientContact: string | null;
  customerStatus: FabricSampleCustomerStatus;
  customerFeedbackDate: string | null;
  customerFeedbackNote: string | null;
  qcInspectionReportId: string | null;
  notes: string | null;
  attachments?: {
    sampleKind?: 'SS' | 'RC';
    rc?: { enabledReason?: string; deadlineOverrideDays?: number; deadlineOverrideReason?: string };
    lastShipment?: { courier?: string; trackingNumber?: string; recipientName?: string; sentDate?: string };
    shipmentDocuments?: unknown[];
    confirmations?: Array<{ result: string; date: string; channel: string; note?: string | null }>;
    [key: string]: unknown;
  } | null;
  sampleKind: 'SS' | 'RC';
  countdown: SampleCountdown;
}

export interface RegisterShipmentSampleInput {
  fabricProfileId?: string;
  shipmentId?: string;
  sampleQuantity: number;   // 必填：取样长度（米）
  sampleUnit?: string;
  batchNo?: string;
  rollNos?: string[];
  cuttingDate: string;      // 必填 YYYY-MM-DD
  notes?: string;
}

export interface EnableHeadSampleInput {
  enabledReason: string;          // 必填：启用原因留痕
  deadlineOverrideDays?: number;  // 客户/合同明确时限覆盖（带 override 时 reason 必填）
  deadlineOverrideReason?: string;
  fabricProfileId?: string;
  sampleQuantity?: number;
  cuttingDate?: string;
  notes?: string;
}

/** DR-012 样品链发货资格判定（出运域消费） */
export interface ShipmentEligibility {
  orderId: string;
  exmillDate: string | null;
  evaluatedAt: string;
  eligibleForNormalShipment: boolean;
  blockingReasons: Array<'SS_NOT_REGISTERED' | 'SS_NOT_SENT' | 'SS_NOT_CONFIRMED' | 'SS_REJECTED' | 'RC_NOT_SENT' | 'RC_NOT_CONFIRMED'>;
  gates: {
    ss: { required: boolean; total: number; satisfied: boolean; anySent: boolean; latestSampleId: string | null; countdown: SampleCountdown | null };
    rc: { enabled: boolean; satisfied: boolean; anySent: boolean; latestSampleId: string | null; countdown: SampleCountdown | null };
  };
}

// ══════════════════════════════════════════════════════════════
// 投产后早期生产样（DR-028）
// ══════════════════════════════════════════════════════════════

export const EARLY_PRODUCTION_CUSTOMER_STATUSES = ['pending', 'approved', 'rejected', 'adjust_and_resend'] as const;
export type EarlyProductionCustomerStatus = (typeof EARLY_PRODUCTION_CUSTOMER_STATUSES)[number];

export const EARLY_PRODUCTION_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  approved: '已通过',
  rejected: '已拒绝',
  adjust_and_resend: '调整重发',
};

export interface EarlyProductionSampleRow {
  id: string;
  sampleCode: string;   // EPS-YYYYMMDD-001
  orderId: string;
  fabricProfileId: string | null;
  millName: string | null;
  sampleQuantity: number;
  sampleUnit: string;
  productionStage: string | null;   // greige_out_of_loom | after_dyeing | after_finishing
  producedMeterage: number | null;
  cuttingDate: string;
  previousSampleId: string | null;  // 调整重发链：指向上一轮
  sentToCustomer: boolean;
  sentDate: string | null;
  courier: string | null;
  trackingNumber: string | null;
  recipientName: string | null;
  customerStatus: EarlyProductionCustomerStatus;
  customerFeedbackDate: string | null;
  customerFeedbackNote: string | null;
  qcInspectionReportId: string | null;
  notes: string | null;
  attachments?: Record<string, unknown> | null;
}

export interface CreateEarlyProductionSampleInput {
  fabricProfileId?: string;
  millName?: string;
  sampleQuantity: number;   // 必填
  sampleUnit?: string;
  productionStage?: string;
  producedMeterage?: number;
  cuttingDate: string;      // 必填 YYYY-MM-DD
  notes?: string;
  previousSampleId?: string;
}

export interface ConfirmEarlyProductionSampleInput {
  result: 'approved' | 'rejected' | 'adjust_and_resend';
  confirmationDate: string;
  channel: string;
  note?: string;
  evidence?: unknown[];
  qcInspectionReportId?: string;
  qcAdjustmentNote?: string;
}

// ══════════════════════════════════════════════════════════════
// 服装多轮样品双门禁（DR-008/029）
// ══════════════════════════════════════════════════════════════

/** 轮次状态机：in_progress → qc_passed → submitted → confirmed → sealed（旧轮次 superseded；客户不通过 rejected） */
export const GARMENT_ROUND_STATUSES = [
  'in_progress',
  'qc_passed',
  'submitted',
  'confirmed',
  'sealed',
  'superseded',
  'rejected',
] as const;
export type GarmentRoundStatus = (typeof GARMENT_ROUND_STATUSES)[number];

export const GARMENT_ROUND_STATUS_LABELS: Record<GarmentRoundStatus, string> = {
  in_progress: '进行中',
  qc_passed: 'QC 已通过',
  submitted: '已提交客户',
  confirmed: '客户已确认',
  sealed: '已封存',
  superseded: '已被新轮取代',
  rejected: '已终止',
};

export interface GarmentSampleRound {
  id: string;
  developmentCaseId: string;
  round: number;
  purpose: string;          // 本轮目的
  version: string;          // 客户侧版本号（V1/V2/...）
  materialConfig: string;   // 材料/工艺配置
  // ── 内部门禁（DR-008）──
  qcStatus: 'none' | 'passed' | 'failed';
  qcInspectionReportId: string | null;
  qcReviewedBy: string | null;
  qcReviewedAt: number | null;
  qcNote: string | null;
  // ── 提交客户（DR-039 寄送记录）──
  submittedAt: number | null;
  submittedBy: string | null;
  shipment: {
    sentDate: string;
    courier: string;
    trackingNumber: string;
    recipientName: string;
    recipientContact?: string | null;
    documents?: unknown[];
  } | null;
  // ── 客户确认 ──
  customerStatus: 'pending' | 'approved' | 'rejected' | 'needs_revision';
  confirmation: {
    result: string;
    date: string;
    channel: string;
    note?: string | null;
    evidence?: unknown[];
    registeredBy?: string;
    registeredAt?: number;
  } | null;
  modifications: string[];
  evidence: unknown[];
  notes: string | null;
  status: GarmentRoundStatus;
  sealedAt: number | null;
  sealedBy: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateGarmentRoundInput {
  purpose: string;          // 必填
  version: string;          // 必填
  materialConfig: string;   // 必填
  notes?: string;
  evidence?: unknown[];
}

export interface SubmitGarmentQcInput {
  result: 'passed' | 'failed';
  qcInspectionReportId?: string;
  qcNote?: string;
}

export interface RegisterGarmentConfirmationInput {
  result: 'approved' | 'rejected' | 'needs_revision';
  confirmationDate: string;   // 必填 YYYY-MM-DD
  channel: string;            // 必填
  note?: string;
  modifications?: string[];
  evidence?: unknown[];
}

// ══════════════════════════════════════════════════════════════
// 内部辅助
// ══════════════════════════════════════════════════════════════

async function parseError(res: Response, fallback: string): Promise<never> {
  const err = await res.json().catch(() => ({}));
  // server 信封：{ error: { code, message } }（sampleRoute/qcRoute 风格），兼容平铺 { error: 'CODE' }
  const code = typeof err?.error?.code === 'string' ? err.error.code
    : typeof err?.error === 'string' ? err.error
      : undefined;
  const message = err?.error?.message || (typeof err?.error === 'string' ? err.error : null) || `${fallback}: HTTP ${res.status}`;
  const error: any = new Error(code && message !== code && !String(message).includes(code) ? `${code}：${message}` : message);
  error.status = res.status;
  error.code = code;
  throw error;
}

function samplesUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/samples${path}`, base);
}

async function postJson<T>(path: string, body: unknown, endpoint?: string, fallback = 'request failed'): Promise<T> {
  const res = await fetch(samplesUrl(path, endpoint), {
    method: 'POST',
    headers: apiService.getAuthHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) await parseError(res, fallback);
  return res.json();
}

async function getJson<T>(path: string, endpoint?: string, fallback = 'request failed'): Promise<T> {
  const res = await fetch(samplesUrl(path, endpoint), {
    headers: apiService.getAuthHeaders(),
  });
  if (!res.ok) await parseError(res, fallback);
  return res.json();
}

/** POST/PATCH/DELETE 通用发送（色差批次判定/软删） */
async function sendJson<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, endpoint?: string, fallback = 'request failed'): Promise<T> {
  const res = await fetch(samplesUrl(path, endpoint), {
    method,
    headers: apiService.getAuthHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) await parseError(res, fallback);
  return res.json();
}

// ══════════════════════════════════════════════════════════════
// 4. REQ2-01 打色批次（色差管理体系：缸号级色差证据链）
// ══════════════════════════════════════════════════════════════

export const COLOR_BATCH_DEFECT_CAUSES = ['red_cast', 'blue_cast', 'lighter', 'darker'] as const;
export type ColorBatchDefectCause = (typeof COLOR_BATCH_DEFECT_CAUSES)[number];

export const COLOR_BATCH_DEFECT_LABELS: Record<ColorBatchDefectCause, string> = {
  red_cast: '偏红', blue_cast: '偏蓝', lighter: '色浅', darker: '色深',
};

export const COLOR_BATCH_CUSTOMER_STATUSES = ['pending', 'approved', 'rejected', 'needs_recast'] as const;
export type ColorBatchCustomerStatus = (typeof COLOR_BATCH_CUSTOMER_STATUSES)[number];

export const COLOR_BATCH_STATUS_LABELS: Record<ColorBatchCustomerStatus, string> = {
  pending: '待客户判定', approved: '客户通过', rejected: '客户拒绝', needs_recast: '要求重打',
};

/** 4-5 级制评级语义（色差灰卡口径） */
export const COLOR_RATING_LABELS: Record<number, string> = {
  5: '与标样一致', 4: '轻微差异', 3: '明显差异', 2: '严重偏离', 1: '完全不符',
};

/** SampleColorBatch 行（镜像后端 schema；两态：lab_dip 挂开发案 / bulk 挂订单） */
export interface SampleColorBatchRow {
  id: string;
  batchCode: string;                    // SCB-YYYYMMDD-001
  stage: 'lab_dip' | 'bulk';
  developmentCaseId: string | null;
  roundNo: number | null;
  orderId: string | null;
  dyeLotNo: string;                     // 缸号
  batchNo: string | null;
  rollNos: string[];
  colorRating: number;                  // 主评级 1-5
  sideDiff: number | null;              // 左右色差 1-5
  endDiff: number | null;               // 前后色差 1-5
  defectCauses: ColorBatchDefectCause[];
  customerStatus: ColorBatchCustomerStatus;
  approvedAsSealed: boolean;            // 封样基准（同 scope 唯一）
  customerFeedbackNote: string | null;
  customerFeedbackDate: string | null;
  supplierRelationId: string | null;
  supplierName: string | null;
  photos: Array<{ name: string; url: string; uploadedAt?: string }> | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateColorBatchInput {
  stage: 'lab_dip' | 'bulk';
  developmentCaseId?: string;           // lab_dip 必填
  orderId?: string;                     // bulk 必填
  dyeLotNo: string;
  batchNo?: string;
  rollNos?: string[];
  colorRating: number;
  sideDiff?: number;
  endDiff?: number;
  defectCauses?: ColorBatchDefectCause[];
  supplierRelationId?: string;
  photos?: Array<{ name: string; url: string }>;
  notes?: string;
}

/** 取证聚合（3 分钟 SLA：缸号×批次×批色记录×封样基准一次成型） */
export interface ColorBatchEvidence {
  scope: { developmentCaseId?: string; caseCode?: string; caseName?: string; orderId?: string; poNumber?: string; customerName: string | null };
  sealedBasis: SampleColorBatchRow | null;
  batches: SampleColorBatchRow[];
  summary: {
    total: number; approved: number; rejected: number; needsRecast: number; pending: number;
    defectCauseCount: Partial<Record<ColorBatchDefectCause, number>>;
  };
}

// ══════════════════════════════════════════════════════════════
// service
// ══════════════════════════════════════════════════════════════

export const sampleService = {
  // ── 面料 S/S 船样 + RC 匹头样 ──

  /** S/S 船样登记（DR-011：面料订单必须管理） */
  async registerShipmentSample(orderId: string, input: RegisterShipmentSampleInput, endpoint?: string): Promise<FabricShipmentSampleRow> {
    const data = await postJson<{ sample: FabricShipmentSampleRow }>(
      `/fabric/${encodeURIComponent(orderId)}/shipment-sample`, input, endpoint, 'registerShipmentSample failed');
    return data.sample;
  },

  /** RC 匹头样启用（DR-011：业务员决定并留痕，同订单不可重复启用） */
  async enableHeadSample(orderId: string, input: EnableHeadSampleInput, endpoint?: string): Promise<FabricShipmentSampleRow> {
    const data = await postJson<{ sample: FabricShipmentSampleRow }>(
      `/fabric/${encodeURIComponent(orderId)}/head-sample`, input, endpoint, 'enableHeadSample failed');
    return data.sample;
  },

  /** 样品寄送登记（DR-039；S/S 与 RC 共用通用 /:id/ship） */
  async registerSampleShipment(sampleId: string, input: SampleShipmentInput, endpoint?: string): Promise<FabricShipmentSampleRow> {
    const data = await postJson<{ sample: FabricShipmentSampleRow }>(
      `/${encodeURIComponent(sampleId)}/ship`, input, endpoint, 'registerSampleShipment failed');
    return data.sample;
  },

  /** 客户确认登记（DR-012：标准发货门禁） */
  async registerCustomerConfirmation(sampleId: string, input: SampleConfirmationInput, endpoint?: string): Promise<FabricShipmentSampleRow> {
    const data = await postJson<{ sample: FabricShipmentSampleRow }>(
      `/${encodeURIComponent(sampleId)}/confirm`, input, endpoint, 'registerCustomerConfirmation failed');
    return data.sample;
  },

  /** 订单样品列表（含 Exmill 倒计时/逾期标记） */
  async listOrderSamples(orderId: string, endpoint?: string): Promise<FabricShipmentSampleRow[]> {
    const data = await getJson<{ items: FabricShipmentSampleRow[] }>(
      `/fabric/${encodeURIComponent(orderId)}/samples`, endpoint, 'listOrderSamples failed');
    return data.items || [];
  },

  /** DR-012 样品链发货资格判定 */
  async computeShipmentEligibility(orderId: string, endpoint?: string): Promise<ShipmentEligibility> {
    const data = await getJson<{ eligibility: ShipmentEligibility }>(
      `/fabric/${encodeURIComponent(orderId)}/shipment-eligibility`, endpoint, 'computeShipmentEligibility failed');
    return data.eligibility;
  },

  // ── 投产后早期生产样（DR-028） ──

  /** 登记新一轮（previousSampleId 链入上一轮，adjust_and_resend 闭环） */
  async createEarlyProductionSample(orderId: string, input: CreateEarlyProductionSampleInput, endpoint?: string): Promise<EarlyProductionSampleRow> {
    const data = await postJson<{ sample: EarlyProductionSampleRow }>(
      `/early-production/${encodeURIComponent(orderId)}/rounds`, input, endpoint, 'createEarlyProductionSample failed');
    return data.sample;
  },

  /** 早期生产样寄送登记 */
  async sendEarlyProductionSample(sampleId: string, input: Partial<SampleShipmentInput>, endpoint?: string): Promise<EarlyProductionSampleRow> {
    const data = await postJson<{ sample: EarlyProductionSampleRow }>(
      `/early-production/rounds/${encodeURIComponent(sampleId)}/ship`, input, endpoint, 'sendEarlyProductionSample failed');
    return data.sample;
  },

  /** 客户反馈登记（approved 闭环；其余转 QC 迭代） */
  async confirmEarlyProductionSample(sampleId: string, input: ConfirmEarlyProductionSampleInput, endpoint?: string): Promise<EarlyProductionSampleRow> {
    const data = await postJson<{ sample: EarlyProductionSampleRow }>(
      `/early-production/rounds/${encodeURIComponent(sampleId)}/feedback`, input, endpoint, 'confirmEarlyProductionSample failed');
    return data.sample;
  },

  /** 早期生产样链式列表 */
  async listEarlyProductionRounds(orderId: string, endpoint?: string): Promise<EarlyProductionSampleRow[]> {
    const data = await getJson<{ items: EarlyProductionSampleRow[] }>(
      `/early-production/${encodeURIComponent(orderId)}/rounds`, endpoint, 'listEarlyProductionRounds failed');
    return data.items || [];
  },

  // ── 服装多轮样品双门禁（DR-008） ──

  /** 创建轮次（目的/版本/材料工艺配置必填；不限轮数） */
  async createGarmentRound(caseId: string, input: CreateGarmentRoundInput, endpoint?: string): Promise<GarmentSampleRound> {
    const data = await postJson<{ round: GarmentSampleRound }>(
      `/garment/${encodeURIComponent(caseId)}/rounds`, input, endpoint, 'createGarmentRound failed');
    return data.round;
  },

  /** QC 评审结论登记（内部门禁第一步；引用 InspectionReport 只读） */
  async submitGarmentQcConclusion(roundId: string, input: SubmitGarmentQcInput, endpoint?: string): Promise<GarmentSampleRound> {
    const data = await postJson<{ round: GarmentSampleRound }>(
      `/garment/${encodeURIComponent(roundId)}/submit-qc`, input, endpoint, 'submitGarmentQcConclusion failed');
    return data.round;
  },

  /** 提交客户（内部门禁 fail-closed：QC 未通过 → 409 QC_GATE_NOT_PASSED） */
  async submitGarmentToCustomer(roundId: string, input: SampleShipmentInput, endpoint?: string): Promise<GarmentSampleRound> {
    const data = await postJson<{ round: GarmentSampleRound }>(
      `/garment/${encodeURIComponent(roundId)}/submit-customer`, input, endpoint, 'submitGarmentToCustomer failed');
    return data.round;
  },

  /** 登记客户确认（业务员登记，不加主管审批） */
  async registerGarmentCustomerConfirmation(roundId: string, input: RegisterGarmentConfirmationInput, endpoint?: string): Promise<GarmentSampleRound> {
    const data = await postJson<{ round: GarmentSampleRound }>(
      `/garment/${encodeURIComponent(roundId)}/register-customer-confirmation`, input, endpoint, 'registerGarmentCustomerConfirmation failed');
    return data.round;
  },

  /** 封存产前样（不可变生产基准；pp 节点投影 approved） */
  async sealGarmentRound(roundId: string, endpoint?: string): Promise<GarmentSampleRound> {
    const data = await postJson<{ round: GarmentSampleRound }>(
      `/garment/${encodeURIComponent(roundId)}/seal`, {}, endpoint, 'sealGarmentRound failed');
    return data.round;
  },

  /** 轮次列表（含当前封存基准） */
  async listGarmentRounds(caseId: string, endpoint?: string): Promise<{ items: GarmentSampleRound[]; sealedRoundId: string | null }> {
    const data = await getJson<{ items: GarmentSampleRound[]; sealedRoundId: string | null }>(
      `/garment/${encodeURIComponent(caseId)}/rounds`, endpoint, 'listGarmentRounds failed');
    return { items: data.items || [], sealedRoundId: data.sealedRoundId ?? null };
  },

  // ── REQ2-01 打色批次（色差管理体系） ──

  /** 打色批次登记（A5 ≤2min：缸号/评级必填；疵点原因选填） */
  async createColorBatch(input: CreateColorBatchInput, endpoint?: string): Promise<{ batch: SampleColorBatchRow; qualityScoreLinked?: boolean }> {
    const data = await postJson<{ batch: SampleColorBatchRow }>(
      '/color-batches', input, endpoint, 'createColorBatch failed');
    return data.batch as any;
  },

  /** 批次列表（developmentCaseId 与 orderId 二选一） */
  async listColorBatches(params: { developmentCaseId?: string; orderId?: string }, endpoint?: string): Promise<SampleColorBatchRow[]> {
    const qs = params.developmentCaseId
      ? `developmentCaseId=${encodeURIComponent(params.developmentCaseId)}`
      : `orderId=${encodeURIComponent(params.orderId!)}`;
    const data = await getJson<{ items: SampleColorBatchRow[] }>(
      `/color-batches?${qs}`, endpoint, 'listColorBatches failed');
    return data.items || [];
  },

  /** 客户判定（批色即封样 + 疵点自动入供应商质量分） */
  async recordColorBatchFeedback(batchId: string, input: { status: 'approved' | 'rejected' | 'needs_recast'; note?: string; asSealed?: boolean }, endpoint?: string): Promise<{ batch: SampleColorBatchRow; qualityScoreLinked: boolean }> {
    return sendJson(`/color-batches/${encodeURIComponent(batchId)}/customer-feedback`, 'POST', input, endpoint, 'recordColorBatchFeedback failed');
  },

  /** 批次软删 */
  async deleteColorBatch(batchId: string, endpoint?: string): Promise<void> {
    await sendJson(`/color-batches/${encodeURIComponent(batchId)}`, 'DELETE', {}, endpoint, 'deleteColorBatch failed');
  },

  /** 色差取证聚合（缸号×批次×批色记录×封样基准，导出打印数据源） */
  async getColorBatchEvidence(params: { developmentCaseId?: string; orderId?: string }, endpoint?: string): Promise<ColorBatchEvidence> {
    const qs = params.developmentCaseId
      ? `developmentCaseId=${encodeURIComponent(params.developmentCaseId)}`
      : `orderId=${encodeURIComponent(params.orderId!)}`;
    return getJson<ColorBatchEvidence>(`/color-batches/evidence?${qs}`, endpoint, 'getColorBatchEvidence failed');
  },
};
