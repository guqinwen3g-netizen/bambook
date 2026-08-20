/**
 * SampleRoom API service — REQ2-16 样品间管理（DR-057）。
 * Communicates with /api/v1/samples/room endpoints:
 *   POST /room/items            — 样卡登记（编号自动 SC-YYYYMMDD-NNN，二维码载荷）
 *   GET  /room/items            — 列表（状态/类型/搜索/编号直达；附活跃借出与逾期派生）
 *   GET  /room/items/:id        — 详情（含借还历史正序）
 *   POST /room/items/:id/retire — 退役（终态）
 *   POST /room/items/:id/loans  — 借出（borrow）/ 看样登记（viewing）
 *   POST /room/loans/:id/return — 归还（append-only 补记）
 *   GET  /room/loans            — 借还流水（在借/逾期/历史/看样）
 *
 * 类型定义内聚在本文件（root types.ts 为冻结区，禁止编辑）。
 * 设计真源：docs/design/04-模块设计/03-订单与生产/Development-开发/样品间管理.md
 */
import { apiService } from './apiService';

export type SampleCardType = 'fabric' | 'garment' | 'colorcard' | 'trim' | 'other';
export type SampleCardStatus = 'in_stock' | 'borrowed' | 'retired';
export type SampleLoanType = 'borrow' | 'viewing';

export interface SampleCardLoanView {
  id: string;
  itemId: string;
  loanType: SampleLoanType | string;
  borrowerName: string;
  borrowerUserId?: string | null;
  relationId?: string | null;
  relationName?: string | null;
  loanedAt: number;
  dueAt?: number | null;
  returnedAt?: number | null;
  conditionNote?: string | null;
  operatorId?: string | null;
  active: boolean;
  overdue: boolean;
  item?: { id: string; code: string; name: string } | null;
}

export interface SampleCardItemView {
  id: string;
  code: string;
  name: string;
  cardType: SampleCardType | string;
  colorCardCode?: string | null;
  location?: string | null;
  status: SampleCardStatus | string;
  notes?: string | null;
  createdAt: number;
  activeLoan: SampleCardLoanView | null;
  overdue: boolean;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const code = data?.error?.code ?? (typeof data?.error === 'string' ? data.error : undefined);
  const rawMessage = data?.error?.message || data?.message || data?.error || `${fallback}: HTTP ${res.status}`;
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  const err: any = new Error(code && !message.includes(code) ? `${code}：${message}` : message);
  err.status = res.status;
  err.code = code;
  throw err;
}

function roomUrl(path: string, endpoint?: string): string {
  const base = endpoint || apiService.getStoredConfig().cloudEndpoint;
  return apiService.buildApiUrl(`/v1/samples/room${path}`, base);
}

export const sampleRoomService = {
  /** 样卡登记（编号自动生成，二维码载荷 = code） */
  async createItem(input: { name: string; cardType?: string; colorCardCode?: string; location?: string; notes?: string }, endpoint?: string): Promise<SampleCardItemView> {
    const res = await fetch(roomUrl('/items', endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'sample room createItem failed');
    const data = await res.json();
    return data.item;
  },

  /** 列表（状态/类型/搜索/编号直达） */
  async listItems(params: { status?: string; cardType?: string; search?: string; code?: string; limit?: number } = {}, endpoint?: string): Promise<{ items: SampleCardItemView[]; total: number }> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.cardType) query.set('cardType', params.cardType);
    if (params.search) query.set('search', params.search);
    if (params.code) query.set('code', params.code);
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    const res = await fetch(`${roomUrl('/items', endpoint)}${qs ? `?${qs}` : ''}`, { headers: apiService.getAuthHeaders() });
    if (!res.ok) await readError(res, 'sample room listItems failed');
    const data = await res.json();
    return { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total ?? 0) };
  },

  /** 详情（含借还历史正序） */
  async getItem(id: string, endpoint?: string): Promise<{ item: SampleCardItemView; loans: SampleCardLoanView[] }> {
    const res = await fetch(roomUrl(`/items/${encodeURIComponent(id)}`, endpoint), { headers: apiService.getAuthHeaders() });
    if (!res.ok) await readError(res, 'sample room getItem failed');
    return await res.json();
  },

  /** 退役（终态；在借不可退役） */
  async retireItem(id: string, note?: string, endpoint?: string): Promise<SampleCardItemView> {
    const res = await fetch(roomUrl(`/items/${encodeURIComponent(id)}/retire`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ note }),
    });
    if (!res.ok) await readError(res, 'sample room retireItem failed');
    const data = await res.json();
    return data.item;
  },

  /** 借出（borrow）/ 看样登记（viewing，relationId 挂客户） */
  async createLoan(itemId: string, input: {
    loanType: SampleLoanType; borrowerName: string; borrowerUserId?: string; relationId?: string; dueAt?: number;
  }, endpoint?: string): Promise<{ loan: SampleCardLoanView; item: SampleCardItemView }> {
    const res = await fetch(roomUrl(`/items/${encodeURIComponent(itemId)}/loans`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'sample room createLoan failed');
    return await res.json();
  },

  /** 归还（append-only：只补 returnedAt/conditionNote） */
  async returnLoan(loanId: string, conditionNote?: string, endpoint?: string): Promise<{ loan: SampleCardLoanView; item: SampleCardItemView }> {
    const res = await fetch(roomUrl(`/loans/${encodeURIComponent(loanId)}/return`, endpoint), {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ conditionNote }),
    });
    if (!res.ok) await readError(res, 'sample room returnLoan failed');
    return await res.json();
  },

  /** 借还流水（在借/逾期/历史/看样） */
  async listLoans(params: { active?: boolean; overdue?: boolean; loanType?: string; limit?: number } = {}, endpoint?: string): Promise<{ loans: SampleCardLoanView[] }> {
    const query = new URLSearchParams();
    if (params.active === true) query.set('active', 'true');
    if (params.active === false) query.set('active', 'false');
    if (params.overdue === true) query.set('overdue', 'true');
    if (params.loanType) query.set('loanType', params.loanType);
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    const res = await fetch(`${roomUrl('/loans', endpoint)}${qs ? `?${qs}` : ''}`, { headers: apiService.getAuthHeaders() });
    if (!res.ok) await readError(res, 'sample room listLoans failed');
    const data = await res.json();
    return { loans: Array.isArray(data.loans) ? data.loans : [] };
  },
};
