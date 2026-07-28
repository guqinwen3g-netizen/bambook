import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const FILES = [
  { name: 'BottomSheet', p: 'ui/BottomSheet.tsx' },
  { name: 'FolderTabCard', p: 'ui/FolderTabCard.tsx' },
  { name: 'DesignTuner', p: 'dev/DesignTuner.tsx' },
];

const SOURCES = FILES.map(({ name, p }) => ({ name, src: fs.readFileSync(path.resolve(__dirname, p), 'utf8') }));

describe('RDL shared UI micro flat [禁彩色/shadow/font]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无语义彩色`, () => {
      ['emerald','purple','cyan'].forEach(c => expect(src).not.toContain(c));
      ['rose','red','amber','sky','green','blue','orange','indigo','yellow'].forEach(c => {
        expect(src).not.toMatch(new RegExp(`${c}-[0-9]`));
      });
    });
    it(`${name} 无 shadow`, () => {
      ['shadow-xl','shadow-lg','shadow-md','shadow-2xl','shadow-sm'].forEach(s => expect(src).not.toContain(s));
      expect(src).not.toMatch(/shadow-\[/);
    });
    it(`${name} 无 font-bold/medium/semibold`, () => {
      ['font-bold','font-medium','font-semibold'].forEach(f => expect(src).not.toContain(f));
    });
    it(`${name} 无 inline drop-shadow/filter shadow`, () => {
      expect(src).not.toMatch(/drop-shadow\(/);
      expect(src).not.toMatch(/filter:\s*['"]drop-shadow/);
    });
  });
});
