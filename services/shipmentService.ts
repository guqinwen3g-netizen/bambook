/**
 * Shipment API service.
 * Communicates with /api/v1/shipping endpoints.
 */
import { apiService } from './apiService';
import type { Shipment, ShipmentStatus } from '../types';

type ShipmentListParams = {
  status?: ShipmentStatus;
  orderId?: string;
  carrier?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export const shipmentService = {
  async listShipments(endpoint?: string, params?: ShipmentListParams): Promise<Shipment[]> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/shipping', base);
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.orderId) query.set('orderId', params.orderId);
    if (params?.carrier) query.set('carrierName', params.carrier);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;
    const apiKey = apiService.getApiKey();

    const res = await fetch(fullUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`listShipments failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  async getShipment(id: string, endpoint?: string): Promise<Shipment> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) throw new Error(`getShipment failed: HTTP ${res.status}`);
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`getShipment failed: HTTP ${res.status} (non-JSON response)`); }
    return data.shipment || data;
  },

  async createShipment(input: Partial<Shipment>, endpoint?: string): Promise<Shipment> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl('/v1/shipping', base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`createShipment failed: HTTP ${res.status} (non-JSON response)`); }
    if (!res.ok) {
      throw new Error(data?.error?.message || data?.error || `createShipment failed: HTTP ${res.status}`);
    }
    return data.shipment || data;
  },

  async updateShipment(id: string, input: Partial<Shipment>, endpoint?: string): Promise<Shipment> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    let data: any;
    try { data = await res.json(); } catch { throw new Error(`updateShipment failed: HTTP ${res.status} (non-JSON response)`); }
    if (!res.ok) {
      throw new Error(data?.error?.message || data?.error || `updateShipment failed: HTTP ${res.status}`);
    }
    return data.shipment || data;
  },

  async deleteShipment(id: string, endpoint?: string): Promise<void> {
    const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
    const url = apiService.buildApiUrl(`/v1/shipping/${encodeURIComponent(id)}`, base);
    const apiKey = apiService.getApiKey();

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `deleteShipment failed: HTTP ${res.status}`);
    }
  },
};
