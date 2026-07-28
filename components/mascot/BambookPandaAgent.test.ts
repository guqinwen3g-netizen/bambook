import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentPath = new URL('./BambookPandaAgent.tsx', import.meta.url);
const assistantPath = new URL('../Assistant.tsx', import.meta.url);

describe('BambookPandaAgent rig contract', () => {
  it('defines a reusable rig with skins and motion states', () => {
    expect(existsSync(componentPath)).toBe(true);

    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain('export type BambookPandaSkin');
    expect(source).toContain("'tech'");
    expect(source).toContain("'polo'");
    expect(source).toContain('export type BambookPandaState');
    expect(source).toContain("'idle'");
    expect(source).toContain("'thinking'");
    expect(source).toContain("'wave'");
    expect(source).toContain('export const BAMBOOK_PANDA_RIG');
    expect(source).toContain('head');
    expect(source).toContain('torso');
    expect(source).toContain('leftUpperArm');
    expect(source).toContain('rightUpperArm');
    expect(source).toContain('leftLeg');
    expect(source).toContain('rightLeg');
    expect(source).toContain('BAMBOOK_PANDA_SKINS');
    expect(source).toContain('BAMBOOK_PANDA_MOTIONS');
  });

  it('is used as the assistant avatar instead of the old static brand mark', () => {
    const source = readFileSync(assistantPath, 'utf8');

    expect(source).toContain("import BambookPandaAgent from './mascot/BambookPandaAgent'");
    expect(source).toContain('<AssistantAvatar');
    expect(source).not.toContain('BambookIcon size={24}');
  });
});
