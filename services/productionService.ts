/**
 * Production Pipeline API service.
 * Communicates with /api/v1/production endpoints.
 */
import { apiService } from './apiService';

export interface PipelineStage {
  id: string;
  orderId: string;
  stageKey: string;
  stageSeq: number;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  note?: string | null;
  operator?: string | null;
  startedAt?: number | null;
  doneAt?: number | null;
  signedByProduction?: string | null;
  signedByBusiness?: string | null;
  signedAtProduction?: number | null;
  signedAtBusiness?: number | null;
}

export interface PreCutChecklist {
  orderId: string;
  gradingConfirmed: boolean;
  consumptionConfirmed: boolean;
  patternConfirmed: boolean;
  preProductionMeeting: boolean;
  meetingNote?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: number | null;
}

export type InspectionType = 'midline' | 'final';

export interface InspectionReport {
  orderId: string;
  inspectionType?: InspectionType;
  totalUnits: number;
  passedUnits: number;
  passRate: number;
  defectRate: number;
  inspectionDate?: string | null;
  inspectorOrg?: string | null;
  aqlLevel?: string | null;
  lotSize?: number | null;
  sampleSize?: number | null;
  criticalDefects?: number;
  majorDefects?: number;
  minorDefects?: number;
  defectSummary?: string | null;
  result?: 'pass' | 'conditional' | 'fail' | null;
  shipmentId?: string | null;
  reportFile?: string | null;
  inspectedBy?: string | null;
  approvedByBusiness: boolean;
  businessApprover?: string | null;
  approvedAt?: number | null;
  notes?: string | null;
}

export interface ProductionPipeline {
  stages: PipelineStage[];
  checklist: PreCutChecklist | null;
  inspection: InspectionReport | null;
  inspections?: InspectionReport[];
  outsourcing?: OutsourcingProgress[];
}

/** 阶段 D / D5：外协进度只读视图（真源 OutsourcingOrder，管理 UI 在 MES 可选模块） */
export interface OutsourcingProgress {
  id: string;
  orderNumber: string;
  supplierId?: string | null;
  supplierName?: string | null;
  processType: string;
  status: string;
  quantity: number;
  unit: string;
  plannedDeliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  qualityAcceptedQty: number;
  qualityRejectedQty: number;
}

/** PRD 19.8：生产跟单泳道看板聚合项（GET /v1/production/board） */
export interface ProductionBoardItem {
  order: {
    id: string;
    poNumber: string | null;
    customer: string;
    quantity: number;
    status: string;
    dueDate: string;
    businessLine: string | null;
    merchandiser: string | null;
    millName: string | null;
  };
  stages: Array<{ stageKey: string; stageSeq: number; status: string }>;
  currentStageKey: string | null;
  blockedCount: number;
}

export const productionService = {
  async getBoard(endpoint?: string): Promise<ProductionBoardItem[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/board`, base);
    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || `getBoard failed: HTTP ${res.status}`);
    return data.items || [];
  },

  async getPipeline(orderId: string, endpoint?: string): Promise<ProductionPipeline> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}`, base);
    const res = await fetch(url, {
      headers: apiService.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || `getPipeline failed: HTTP ${res.status}`);
    return { stages: data.stages || [], checklist: data.checklist || null, inspection: data.inspection || null, inspections: data.inspections || [], outsourcing: data.outsourcing || [] };
  },

  async advanceStage(orderId: string, stageKey: string, note?: string, endpoint?: string): Promise<PipelineStage> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/advance/${encodeURIComponent(stageKey)}`, base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ note }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || data?.error?.code || `advanceStage failed: HTTP ${res.status}`);
    return data.stage;
  },

  async saveChecklist(orderId: string, data: Partial<PreCutChecklist>, endpoint?: string): Promise<PreCutChecklist> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/checklist`, base);
    const res = await fetch(url, {
      method: 'PUT',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error?.message || `saveChecklist failed: HTTP ${res.status}`);
    return json.checklist;
  },

  async saveInspection(orderId: string, data: Partial<InspectionReport>, endpoint?: string): Promise<InspectionReport> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/inspection`, base);
    const res = await fetch(url, {
      method: 'PUT',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error?.message || `saveInspection failed: HTTP ${res.status}`);
    return json.inspection;
  },

  async signStage(orderId: string, stageKey: string, signType: 'production' | 'business', signerId?: string, endpoint?: string): Promise<PipelineStage> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/sign/${encodeURIComponent(stageKey)}`, base);
    const res = await fetch(url, {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ signType, signerId }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error?.message || `signStage failed: HTTP ${res.status}`);
    return json.stage;
  },
};
