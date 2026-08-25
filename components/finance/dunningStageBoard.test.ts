/**
 * P0-2 催款分级状态机 — 前端契约测试
 *
 * 覆盖：
 *   1. apiService 契约（fetch mock）：分级看板 GET / 分级调整 POST / 分级函 stage 透传 / 登记 stage 快照
 *   2. DunningStageBoardPanel 源码契约：四列看板 / 升降级表单（目标档位 + 原因必填 + 解除钉住）/ 催款带档位
 *   3. DunningSheet 源码契约：分级 chips 切档预览 / 登记随档位快照 / 历史分级徽章
 *   4. FinanceReportsPanel 源码契约：分级看板挂载（应收侧）/ 催款函 stage 上下文透传
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiService } from '../../services/apiService';

const ENDPOINT = 'https://test.example.com';
const boardPanelSource = readFileSync(new URL('./DunningStageBoardPanel.tsx', import.meta.url), 'utf8');
const sheetSource = readFileSync(new URL('./DunningSheet.tsx', import.meta.url), 'utf8');
const reportsPanelSource = readFileSync(new URL('./FinanceReportsPanel.tsx', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

describe('apiService P0-2 分级契约（fetch mock）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('getDunningStageBoard GET /finance/dunning/stages', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({
        ok: true, asOf: '2026-08-25',
        rows: [{ scopeKey: 'rel:REL-1:USD', customerName: 'Peerless', currency: 'USD', stage: 'firm', stageSource: 'auto' }],
        summary: { reminder: { count: 0, amount: 0 }, firm: { count: 1, amount: 20000 } },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const board = await apiService.getDunningStageBoard(undefined, ENDPOINT);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/finance/dunning/stages');
    expect(board.rows[0].stage).toBe('firm');
    expect(board.summary.firm.count).toBe(1);
  });

  it('setDunningStageManual POST body（stage/reason/ownerName）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ ok: true, profile: { scopeKey: 'rel:REL-1:USD', stage: 'firm', stageSource: 'manual' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiService.setDunningStageManual({
      customerRelationId: 'REL-1', customerName: 'Peerless', currency: 'USD',
      stage: 'firm', reason: '客户长期失联', ownerName: '赵美玲',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/finance/dunning/stages/manual');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      customerRelationId: 'REL-1', customerName: 'Peerless', currency: 'USD',
      stage: 'firm', reason: '客户长期失联', ownerName: '赵美玲',
    });
  });

  it('setDunningStageManual 失败透传 error.message', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'REASON_REQUIRED', message: '升降级必须填写原因' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiService.setDunningStageManual({
      customerName: 'Peerless', currency: 'USD', stage: 'firm',
    }, ENDPOINT)).rejects.toThrow();
  });

  it('buildDunningLetter 透传 stage；recordDunning 携带 stage 快照', async () => {
    const fetchMock = vi.fn(async (url: string, ..._rest: any[]) => ({
      ok: true,
      json: async () => String(url).includes('/dunning/letter')
        ? { ok: true, zh: { subject: 's', body: 'b' }, en: { subject: 's', body: 'b' }, stage: 'urgent', summary: { invoiceCount: 1, totalOverdue: 1, buckets: {}, items: [] } }
        : { ok: true, record: { id: 'DUN__1', stage: 'urgent' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const letter = await apiService.buildDunningLetter({ customerName: 'Peerless', currency: 'USD', stage: 'urgent' }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/finance/dunning/letter');
    expect(JSON.parse(String(init?.body)).stage).toBe('urgent');
    expect(letter.stage).toBe('urgent');

    const record = await apiService.recordDunning({
      customerName: 'Peerless', currency: 'USD', totalOverdue: 1, invoiceCount: 1,
      channel: 'email', result: 'sent', stage: 'urgent',
    }, ENDPOINT);
    const [, recordInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(recordInit?.body)).stage).toBe('urgent');
    expect(record.stage).toBe('urgent');
  });
});

describe('DunningStageBoardPanel P0-2（UI 契约）', () => {
  it('四列分级看板（提醒/催款/严催/法务准备；none 不上板）', () => {
    expect(boardPanelSource).toContain("STAGE_COLUMNS: Array<{ stage: DunningStage; tone: string }>");
    expect(boardPanelSource).toContain("{ stage: 'reminder', tone: 'neutral' }");
    expect(boardPanelSource).toContain("{ stage: 'firm', tone: 'warning' }");
    expect(boardPanelSource).toContain("{ stage: 'urgent', tone: 'danger' }");
    expect(boardPanelSource).toContain("{ stage: 'legal', tone: 'danger' }");
    expect(boardPanelSource).toContain("rows.filter(r => r.stage !== 'none')");
  });

  it('P0-1 尾款喂入行展示：含逾期尾款金额', () => {
    expect(boardPanelSource).toContain('row.finalPaymentOverdue');
    expect(boardPanelSource).toContain('含逾期尾款');
    expect(boardPanelSource).toContain('finalPaymentOutstanding');
  });

  it('分级调整表单：目标档位（含解除钉住）+ 原因必填 + 责任人', () => {
    expect(boardPanelSource).toContain("{ value: 'none', label: '解除钉住' }");
    expect(boardPanelSource).toContain('分级调整必须填写原因');
    expect(boardPanelSource).toContain('apiService.setDunningStageManual');
    expect(boardPanelSource).toContain('责任人（可选；升级预警通知对象）');
  });

  it('行级停驻时长与人工钉住标记；催款带档位上下文', () => {
    expect(boardPanelSource).toContain('本级 {row.stageDays} 天');
    expect(boardPanelSource).toContain("row.stageSource === 'manual'");
    expect(boardPanelSource).toContain('apiService.getDunningStageBoard');
    expect(boardPanelSource).toContain('stage: row.stage');
  });
});

describe('DunningSheet P0-2（UI 契约）', () => {
  it('分级 chips 切档预览（重取该档语气函）', () => {
    expect(sheetSource).toContain("LETTER_STAGE_OPTIONS: Array<DunningStage> = ['reminder', 'firm', 'urgent', 'legal']");
    expect(sheetSource).toContain('switchStage');
    expect(sheetSource).toContain('stage: next');
  });

  it('登记随当前档位快照（letterStage）', () => {
    expect(sheetSource).toContain('...(letterStage ? { stage: letterStage } : {})');
  });

  it('历史记录分级徽章（rec.stage）', () => {
    expect(sheetSource).toContain('rec.stage &&');
    expect(sheetSource).toContain('DUNNING_STAGE_LABELS[rec.stage]');
  });
});

describe('FinanceReportsPanel 挂载 P0-2（源码契约）', () => {
  it('分级看板挂载于账龄分析（应收侧）', () => {
    expect(reportsPanelSource).toContain("import DunningStageBoardPanel from './DunningStageBoardPanel'");
    expect(reportsPanelSource).toContain("agingType === 'Receivable' && (");
    expect(reportsPanelSource).toContain('<DunningStageBoardPanel');
    expect(reportsPanelSource).toContain('P0-2 催款分级看板');
  });

  it('催款函 stage 上下文透传（看板行档位 → 函生成档位）', () => {
    expect(reportsPanelSource).toContain('stage={dunningRow.stage}');
    expect(reportsPanelSource).toContain("stage?: DunningStage");
  });
});
