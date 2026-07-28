import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { extractPdfText } from '../extractText';
import { parsePeerless } from '../parsers/peerless';

const DIR = '/Users/qinwengu/WorkBuddy/Claw/BusinessDocu/00-Entities/Peerless/面料/BULK PO';

async function load(file: string) {
  const buf = fs.readFileSync(`${DIR}/${file}`);
  const { text } = await extractPdfText(buf);
  return parsePeerless(text);
}

describe('parsePeerless — header', () => {
  it('PO 4500159423', async () => {
    const o = await load('PO#-4500159423-0001.pdf');
    expect(o.poNumber).toBe('4500159423');
    expect(o.season).toBe('F26-INSTOCK');
    expect(o.poDate).toBe('2026/03/31');
    expect(o.contactPerson).toBe('Sonya Catalano');
    expect(o.contactPhone).toBe('514-593-9300 EXT:1510');
    expect(o.currency).toBe('USD');
    expect(o.deliveryTerms).toMatch(/FOB.*CHINA/);
    expect(o.paymentTerms).toMatch(/To be confirmed/i);
  });

  it.each([
    ['PO#-4500159154-0001.pdf', '4500159154', '2026/03/03'],
    ['PO#-4500159120-0001.pdf', '4500159120', '2026/02/25'],
    ['PO#-4500159027-0001.pdf', '4500159027', '2026/02/17'],
    ['PO#-4500158987-0001.pdf', '4500158987', '2026/02/11'],
  ] as const)('%s header', async (file, po, date) => {
    const o = await load(file);
    expect(o.poNumber).toBe(po);
    expect(o.poDate).toBe(date);
    expect(o.season).toBe('F26-INSTOCK');
    expect(o.currency).toBe('USD');
  });
});

describe('parsePeerless — line items', () => {
  it('PO 4500159423 has 4 lines and the first line matches the PDF', async () => {
    const o = await load('PO#-4500159423-0001.pdf');
    expect(o.lines).toHaveLength(4);

    const l1 = o.lines[0];
    expect(l1.itemNo).toBe('00010');
    expect(l1.materialCode).toBe('144749');
    expect(l1.millQuality).toBe('RD7302_PCHR');
    expect(l1.description).toBe('CHARCOAL SOLID');
    expect(l1.width).toBe('147 CM');
    expect(l1.exMillDate).toBe('2026/07/01');
    expect(l1.deliveryDate).toBe('2026/08/15');
    expect(l1.quantity).toBeCloseTo(3600, 6);
    expect(l1.unit).toBe('Meter');
    expect(l1.unitPrice).toBeCloseTo(8.1, 6);
    expect(l1.netValue).toBeCloseTo(29160, 6);
    expect(l1.via).toBe('SEA');
    expect(l1.cloth).toBe('70% Wool/25% Polyester/5% Spandex');
    expect(l1.weight).toBe('186GSM');
    expect(l1.category).toBe('SUITS SEPARATES');
  });

  it.each([
    ['PO#-4500159154-0001.pdf', 3],
    ['PO#-4500159120-0001.pdf', 1],
    ['PO#-4500159027-0001.pdf', 3],
    ['PO#-4500158987-0001.pdf', 2],
  ] as const)('%s line count', async (file, expectedCount) => {
    const o = await load(file);
    expect(o.lines).toHaveLength(expectedCount);
  });
});

describe('parsePeerless — ship-to & totals', () => {
  it.each([
    ['PO#-4500159423-0001.pdf', 103680],
    ['PO#-4500159154-0001.pdf', 93150],
    ['PO#-4500159120-0001.pdf', 40500],
    ['PO#-4500159027-0001.pdf', 125550],
    ['PO#-4500158987-0001.pdf', 42930],
  ] as const)('%s totals', async (file, expected) => {
    const o = await load(file);
    expect(o.totalNet).toBeCloseTo(expected, 2);
    expect(o.totalActual).toBeCloseTo(expected, 2);
  });

  it.each([
    'PO#-4500159423-0001.pdf',
    'PO#-4500159154-0001.pdf',
    'PO#-4500159120-0001.pdf',
    'PO#-4500159027-0001.pdf',
    'PO#-4500158987-0001.pdf',
  ])('%s ship-to is Panda Clothing in CHINA', async (file) => {
    const o = await load(file);
    expect(o.shipTo.contactName).toBe('Richard Gu');
    expect(o.shipTo.company).toMatch(/Jiangsu Panda Clothing/);
    expect(o.shipTo.country).toBe('CHINA');
    expect(o.shipTo.addressLines.length).toBeGreaterThan(0);
  });
});
