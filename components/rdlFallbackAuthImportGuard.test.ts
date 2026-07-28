import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const FILES = [
  { name: 'Register', p: 'Register.tsx' },
  { name: 'Login', p: 'Login.tsx' },
  { name: 'ImageUploader', p: 'ImageUploader.tsx' },
  { name: 'MarkdownRenderer', p: 'MarkdownRenderer.tsx' },
  { name: 'RelationsManager', p: 'RelationsManager.tsx' },
  { name: 'ImportWizard', p: 'import/ImportWizard.tsx' },
  { name: 'StepUpload', p: 'import/StepUpload.tsx' },
  { name: 'StepPreview', p: 'import/StepPreview.tsx' },
  { name: 'StepConfirm', p: 'import/StepConfirm.tsx' },
  { name: 'RelationCombobox', p: 'order/RelationCombobox.tsx' },
  { name: 'OrderFieldInput', p: 'order/OrderFieldInput.tsx' },
  { name: 'CustomerSearchInput', p: 'ui/CustomerSearchInput.tsx' },
  { name: 'EmailList', p: 'email/EmailList.tsx' },
];

const SOURCES = FILES.map(({ name, p }) => ({
  name,
  src: fs.readFileSync(path.resolve(__dirname, p), 'utf8'),
}));

describe('RDL fallback-auth-import flat [禁彩色语义]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无语义彩色`, () => {
      expect(src).not.toContain('emerald');
      expect(src).not.toMatch(/rose-[0-9]/);
      expect(src).not.toMatch(/red-[0-9]/);
      expect(src).not.toMatch(/amber-[0-9]/);
      expect(src).not.toMatch(/sky-[0-9]/);
      expect(src).not.toMatch(/green-[0-9]/);
      expect(src).not.toContain('purple');
      expect(src).not.toContain('cyan');
      expect(src).not.toMatch(/blue-[0-9]/);
      expect(src).not.toMatch(/orange-[0-9]/);
      expect(src).not.toMatch(/indigo-[0-9]/);
      expect(src).not.toContain('fuchsia');
    });
  });
});

describe('RDL fallback-auth-import flat [禁硬编码hex]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无彩色 hex`, () => {
      ['#004AAD', '#5DE0E6', '#2F95CA', '#CFE5FF', '#2563EB', '#2563eb',
       '#0e7490', '#0A2746', '#3a7bd5', '#4a9eff', '#4A90E2', '#7DB7FF', '#126DCC', '#3B7BD4'
      ].forEach(hex => {
        expect(src).not.toContain(hex);
      });
    });
  });
});

describe('RDL fallback-auth-import flat [禁 shadow]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow`, () => {
      ['shadow-xl', 'shadow-lg', 'shadow-md', 'shadow-2xl', 'shadow-sm'].forEach(s => {
        expect(src).not.toContain(s);
      });
      expect(src).not.toMatch(/shadow-\[/);
    });
  });
});

describe('RDL fallback-auth-import flat [Typography]', () => {
  SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-bold/medium/semibold`, () => {
      ['font-bold', 'font-medium', 'font-semibold'].forEach(f => {
        expect(src).not.toContain(f);
      });
    });
  });
});
