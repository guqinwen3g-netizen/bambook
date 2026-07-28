import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseOrderPdf } from '../parseOrderPdf';

const DIR = '/Users/qinwengu/WorkBuddy/Claw/BusinessDocu/00-Entities/Peerless/面料/BULK PO';
const ALL = [
  ['PO#-4500159423-0001.pdf', '4500159423', 4],
  ['PO#-4500159154-0001.pdf', '4500159154', 3],
  ['PO#-4500159120-0001.pdf', '4500159120', 1],
  ['PO#-4500159027-0001.pdf', '4500159027', 3],
  ['PO#-4500158987-0001.pdf', '4500158987', 2],
] as const;

describe('parseOrderPdf — Peerless 5 fixtures', () => {
  it.each(ALL)('%s parses end-to-end', async (file, po, lineCount) => {
    const buf = fs.readFileSync(`${DIR}/${file}`);
    const r = await parseOrderPdf(buf);
    expect(r.detection.customerId).toBe('peerless');
    expect(r.detection.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.order?.poNumber).toBe(po);
    expect(r.order?.lines.length).toBe(lineCount);
    expect(r.error).toBeUndefined();
  });

  it('empty buffer returns error, not throw', async () => {
    const r = await parseOrderPdf(Buffer.from(''));
    expect(r.order).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
});
