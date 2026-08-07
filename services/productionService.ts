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
}

export const productionService = {
  async getPipeline(orderId: string, endpoint?: string): Promise<ProductionPipeline> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      headers: { ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || `getPipeline failed: HTTP ${res.status}`);
    return { stages: data.stages || [], checklist: data.checklist || null, inspection: data.inspection || null, inspections: data.inspections || [] };
  },

  async advanceStage(orderId: string, stageKey: string, note?: string, endpoint?: string): Promise<PipelineStage> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/advance/${encodeURIComponent(stageKey)}`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
      body: JSON.stringify({ note }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || data?.error?.code || `advanceStage failed: HTTP ${res.status}`);
    return data.stage;
  },

  async saveChecklist(orderId: string, data: Partial<PreCutChecklist>, endpoint?: string): Promise<PreCutChecklist> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/checklist`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error?.message || `saveChecklist failed: HTTP ${res.status}`);
    return json.checklist;
  },

  async saveInspection(orderId: string, data: Partial<InspectionReport>, endpoint?: string): Promise<InspectionReport> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/inspection`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error?.message || `saveInspection failed: HTTP ${res.status}`);
    return json.inspection;
  },

  async signStage(orderId: string, stageKey: string, signType: 'production' | 'business', signerId?: string, endpoint?: string): Promise<PipelineStage> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/production/${encodeURIComponent(orderId)}/sign/${encodeURIComponent(stageKey)}`, base);
    const apiKey = apiService.getApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
      body: JSON.stringify({ signType, signerId }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error?.message || `signStage failed: HTTP ${res.status}`);
    return json.stage;
  },
};
