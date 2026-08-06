import { describe, expect, it } from 'vitest';

const fs = require('fs');
const path = require('path');

// 收集 agent-response 目录所有 tsx
const dir = path.resolve(__dirname, 'agent-response');
const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.tsx'));
const AGENT_RESPONSE: Record<string, string> = {};
files.forEach((f: string) => {
  AGENT_RESPONSE[f] = fs.readFileSync(path.join(dir, f), 'utf8');
});
const MESSAGE_CARD = fs.readFileSync(path.resolve(__dirname, 'AgentMessageCard.tsx'), 'utf8');

const ALL_SOURCES = [
  ...Object.entries(AGENT_RESPONSE).map(([name, src]) => ({ name: `agent-response/${name}`, src })),
  { name: 'AgentMessageCard', src: MESSAGE_CARD },
];

// ═══ Part 1: 禁彩色语义 ═══
describe('RDL agent-response tone [禁彩色语义]', () => {
  ALL_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 emerald/rose/red/amber/sky/green/purple/cyan`, () => {
      expect(src).not.toContain('emerald');
      expect(src).not.toMatch(/rose-[0-9]/);
      expect(src).not.toMatch(/red-[0-9]/);
      expect(src).not.toMatch(/amber-[0-9]/);
      expect(src).not.toMatch(/sky-[0-9]/);
      expect(src).not.toMatch(/green-[0-9]/);
      expect(src).not.toContain('purple');
      expect(src).not.toContain('cyan');
    });
    it(`${name} 无 blue-* (Tailwind)`, () => {
      expect(src).not.toMatch(/blue-[0-9]/);
    });
    it(`${name} 无 indigo-*`, () => {
      expect(src).not.toMatch(/indigo-[0-9]/);
    });
  });
});

// ═══ Part 2: 禁硬编码彩色 hex ═══
describe('RDL agent-response tone [禁硬编码hex]', () => {
  ALL_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无彩色 hex`, () => {
      ['#004AAD', '#5DE0E6', '#2F95CA', '#CFE5FF', '#2563EB', '#0e7490', '#0A2746'].forEach(hex => {
        expect(src).not.toContain(hex);
      });
    });
  });
});

// ═══ Part 3: 禁 shadow/rim ═══
describe('RDL agent-response tone [禁 shadow]', () => {
  ALL_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 shadow-xl/lg/md/2xl/sm`, () => {
      ['shadow-xl', 'shadow-lg', 'shadow-md', 'shadow-2xl', 'shadow-sm'].forEach(s => {
        expect(src).not.toContain(s);
      });
    });
    it(`${name} 无 shadow-[ 任意值`, () => {
      expect(src).not.toMatch(/shadow-\[/);
    });
  });
});

// ═══ Part 4: 禁默认粗字重 ═══
describe('RDL agent-response tone [Typography]', () => {
  ALL_SOURCES.forEach(({ name, src }) => {
    it(`${name} 无 font-bold/medium/semibold`, () => {
      ['font-bold', 'font-medium', 'font-semibold'].forEach(f => {
        expect(src).not.toContain(f);
      });
    });
  });
});

// ═══ Part 5: 共享 helper 消费 + 无散落 map ═══
describe('RDL agent-response tone [共享 helper]', () => {
  it('agentResponseTone.ts 存在且导出共享 helper', () => {
    const helper = fs.readFileSync(path.resolve(__dirname, 'agent-response/agentResponseTone.ts'), 'utf8');
    expect(helper).toContain('riskToneClass');
    expect(helper).toContain('riskPillClass');
    expect(helper).toContain('metricToneClass');
    expect(helper).toContain('agentNeutralTone');
  });
  it('AgentToolLifecycleBlock 消费共享 helper（无本地 riskClass）', () => {
    expect(AGENT_RESPONSE['AgentToolLifecycleBlock.tsx']).toContain('agentResponseTone');
    expect(AGENT_RESPONSE['AgentToolLifecycleBlock.tsx']).not.toMatch(/const\s+riskClass\s*=/);
    expect(AGENT_RESPONSE['AgentToolLifecycleBlock.tsx']).not.toMatch(/const\s+riskPillClass\s*=/);
  });
  it('AgentApprovalBlock 消费共享 helper（无本地 riskClass）', () => {
    expect(AGENT_RESPONSE['AgentApprovalBlock.tsx']).toContain('agentResponseTone');
    expect(AGENT_RESPONSE['AgentApprovalBlock.tsx']).not.toMatch(/const\s+riskClass\s*=/);
  });
  it('SettingsDrawer 消费共享 helper（无本地 riskPill）', () => {
    expect(AGENT_RESPONSE['SettingsDrawer.tsx']).toContain('agentResponseTone');
    expect(AGENT_RESPONSE['SettingsDrawer.tsx']).not.toMatch(/const\s+riskPill\s*=/);
  });
  it('AgentToolCatalogRail 消费共享 helper（无本地 riskPill）', () => {
    expect(AGENT_RESPONSE['AgentToolCatalogRail.tsx']).toContain('agentResponseTone');
    expect(AGENT_RESPONSE['AgentToolCatalogRail.tsx']).not.toMatch(/const\s+riskPill\s*=/);
  });
  it('AgentMetricBlock 消费共享 helper（无本地 toneClass）', () => {
    expect(AGENT_RESPONSE['AgentMetricBlock.tsx']).toContain('agentResponseTone');
    expect(AGENT_RESPONSE['AgentMetricBlock.tsx']).not.toMatch(/const\s+toneClass\s*=/);
  });
  it('AgentDocumentRenderer statusIcon 消费共享 helper', () => {
    expect(AGENT_RESPONSE['AgentDocumentRenderer.tsx']).toContain('statusIconClass');
  });
  it('AgentTimelineGroup ToolStatusIcon 消费共享 helper', () => {
    expect(AGENT_RESPONSE['AgentTimelineGroup.tsx']).toContain('statusIconClass');
  });
  it('agentResponseTone 导出 status helper', () => {
    const helper = fs.readFileSync(path.resolve(__dirname, 'agent-response/agentResponseTone.ts'), 'utf8');
    expect(helper).toContain('statusIconClass');
    expect(helper).toContain('statusTextClass');
    expect(helper).toContain('runningStatusClass');
  });
  it('AgentDocumentRenderer running spinner 不用 brand-blue', () => {
    const m = AGENT_RESPONSE['AgentDocumentRenderer.tsx'].match(/CircleDashed[^;]*/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('brand-blue');
  });
  it('AgentTimelineGroup running spinner 不用 brand-blue', () => {
    const m = AGENT_RESPONSE['AgentTimelineGroup.tsx'].match(/CircleDashed[^;]*/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('brand-blue');
  });
  it('AgentTimelineGroup live pulse 不用 brand-blue', () => {
    const m = AGENT_RESPONSE['AgentTimelineGroup.tsx'].match(/animate-pulse[^>]*/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('brand-blue');
  });
});
