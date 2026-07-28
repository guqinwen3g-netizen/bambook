import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const docsRoot = resolve(repoRoot, 'docs/design-system');
const readDoc = (file: string) => readFileSync(resolve(docsRoot, file), 'utf8');

describe('Bambook OS compiler documentation', () => {
  it('documents compiler-level fidelity, provenance, and layout/material ownership', () => {
    expect(existsSync(resolve(docsRoot, 'design-compiler.md'))).toBe(true);

    const readme = readDoc('README.md');
    const compiler = readDoc('design-compiler.md');
    const generation = readDoc('page-generation.md');
    const governance = readDoc('governance.md');

    expect(readme).toContain('design-compiler.md');
    expect(readme).toContain('UI Lab 2.0');
    expect(compiler).toContain('Fidelity Gate');
    expect(compiler).toContain('accepted');
    expect(compiler).toContain('provisional');
    expect(compiler).toContain('experimental');
    expect(compiler).toContain('retired');
    expect(compiler).toContain('layout');
    expect(compiler).toContain('material');
    expect(compiler).toContain('slot contract');
    expect(compiler).toContain('page-local');
    expect(generation).toContain('Design Compiler');
    expect(generation).toContain('A page does not choose layout');
    expect(governance).toContain('Compiler Fidelity Gate');
    expect(governance).toContain('dev-ui-lab-2.html');
    expect(governance).toContain('dev-ui-lab-2-reference.html');
    expect(governance).toContain('must not mount compiler reference overlays');
  });
});
