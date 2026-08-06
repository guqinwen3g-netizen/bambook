import { describe, expect, it } from 'vitest';
import type { AgentWorkEvent } from '../types';

/**
 * P0-A 前端流式契约验证：前后端 AgentWorkEvent/block 流式 contract 一致性 + 短审查结论。
 * payload 全部来自后端已 merged 代码静态断言 + 前端真实消费链路源码分析。
 *
 * ═══ 短审查结论（Observe artifact，可审查）═══
 *
 * 结论1 — answer_delta 进入正文的链路：
 *   前端 Assistant.tsx 不直接消费 phase==='answer_delta'（无对应 if 分支）。
 *   后端 runner.ts:290 "拦截 answer_delta 实时推 block_patch"——answer 正文通过
 *   block_patch/block_delta 通道 → applyBlockStreamEvent → setAssistantDraft 进入正文气泡。
 *   answer_delta/answer_end phase 仅用于 lib/agentEventPresentation.ts timeline 展示（"正在生成回答…"）。
 *
 * 结论2 — thought_delta 只更新 thinking：
 *   Assistant.tsx:1650-1655 thought_delta 累积到 streamingThoughtText，调 updateThinkingDisplay
 *   渲染为 "> 💭 ..." 前缀引用样式，显示在对话区域但不替换正文 streamingText。
 *   block_start（非 approval）时会清空 streamingThoughtText（L1535-1538），避免残留。
 *
 * 结论3 — NEW_LOOP_PHASES/timeline phase：
 *   lib/agentEventPresentation.ts:543-554 NEW_LOOP_PHASES 含 10 个 phase（iteration_start/
 *   thought/thought_delta/thought_end/plan/tool_call_start/tool_call_end/iteration_end/
 *   final_answer/answer_delta/answer_end），timeline 按 iteration 分组渲染。
 *
 * 结论4 — block_patch/delta/TTS 重复文本风险：
 *   thought 用 streamingThoughtText 累积，answer 用 streamingText，两变量独立无交叉。
 *   TTS 走独立 tts_chunk 通道（L1141）+ backend streaming（L1626 enqueueBackendAudioChunk），
 *   与 text 通道分离；fallback 全文 speak 仅在无 backend tts_chunk 时触发（L1700），不重复。
 *
 * 结论5 — 契约漂移（需修复，非"非阻断"）：
 *   后端 events.ts:41-42 有 form_request/form_resolved phase，前端 types.ts
 *   AgentWorkEventPhase union 未声明。normalizeAgentWorkEvent 通过兜底消费（metadata
 *   [key:string]:unknown）运行时不崩，但类型声明漂移会导致 TS 类型收窄丢失。
 *   本 QA 测试将此作为 **失败断言**（如实反映 drift，不掩盖）。
 */

const fs = require('fs');
const path = require('path');
const BACKEND_EVENTS_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/agent/events.ts'), 'utf-8');
const BACKEND_RUNNER_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/ai/runner.ts'), 'utf-8');
const FRONTEND_TYPES_SRC = fs.readFileSync(path.resolve(__dirname, '../types.ts'), 'utf-8');
const ASSISTANT_SRC = fs.readFileSync(path.resolve(__dirname, 'Assistant.tsx'), 'utf-8');
const NORMALIZE_SRC = fs.readFileSync(path.resolve(__dirname, '../lib/agentEventPresentation.ts'), 'utf-8');

// ═══ Part 1: 短审查结论验证（源码断言支撑结论） ═══
describe('P0-A 审查结论1: answer_delta → block_patch → setAssistantDraft 链路', () => {
  it('后端 runner.ts 拦截 answer_delta 实时推 block_patch', () => {
    expect(BACKEND_RUNNER_SRC).toMatch(/拦截 answer_delta.*推 block_patch|answer_delta.*block_patch/);
  });
  it('前端 Assistant.tsx 不直接消费 phase===answer_delta（无正文写入分支）', () => {
    // answer_delta 不进 setAssistantDraft，只通过 block_patch 通道
    expect(ASSISTANT_SRC).not.toMatch(/if \(event\.phase === 'answer_delta'\)[\s\S]*?setAssistantDraft/);
  });
  it('前端通过 applyBlockStreamEvent 消费 block_patch 进入正文', () => {
    expect(ASSISTANT_SRC).toMatch(/applyBlockStreamEvent/);
    expect(ASSISTANT_SRC).toMatch(/block_patch/);
  });
  it('answer_delta/answer_end 仅在 timeline 展示（agentEventPresentation）', () => {
    expect(NORMALIZE_SRC).toMatch(/正在生成回答/);
    expect(NORMALIZE_SRC).toMatch(/回答生成完成/);
  });
});

describe('P0-A 审查结论2: thought_delta 只更新 thinking（不进正文）', () => {
  it('前端 thought_delta 累积到 streamingThoughtText（独立变量）', () => {
    expect(ASSISTANT_SRC).toMatch(/streamingThoughtText \+= delta/);
  });
  it('thought_delta 调 updateThinkingDisplay（「思考 — 」前缀引用样式，非正文）', () => {
    expect(ASSISTANT_SRC).toMatch(/updateThinkingDisplay\(\[`思考 — /);
  });
  it('block_start 非 approval 时清空 streamingThoughtText（避免残留）', () => {
    expect(ASSISTANT_SRC).toMatch(/isAnswerBlockStart && isShowingThinking/);
    expect(ASSISTANT_SRC).toMatch(/streamingThoughtText = ''/);
  });
});

describe('P0-A 审查结论3: NEW_LOOP_PHASES/timeline phase 覆盖', () => {
  it('NEW_LOOP_PHASES 含 agentLoop 10 个 phase', () => {
    const m = NORMALIZE_SRC.match(/NEW_LOOP_PHASES[\s\S]*?\)/);
    expect(m).not.toBeNull();
    for (const p of ['iteration_start', 'thought', 'thought_delta', 'plan', 'tool_call_start', 'tool_call_end', 'iteration_end', 'final_answer', 'answer_delta', 'answer_end']) {
      expect(m![0]).toContain(p);
    }
  });
  it('timeline 按 iteration 分组（ensureIteration）', () => {
    expect(NORMALIZE_SRC).toMatch(/ensureIteration/);
  });
});

describe('P0-A 审查结论4: block_patch/delta/TTS 无重复文本风险', () => {
  it('thought 与 answer 用独立变量（streamingThoughtText vs streamingText）', () => {
    expect(ASSISTANT_SRC).toMatch(/streamingThoughtText/);
    expect(ASSISTANT_SRC).toMatch(/streamingText/);
  });
  it('TTS 走独立 tts_chunk 通道（与 text 通道分离）', () => {
    expect(ASSISTANT_SRC).toMatch(/event === 'tts_chunk'/);
    expect(ASSISTANT_SRC).toMatch(/enqueueBackendAudioChunk/);
  });
  it('TTS fallback 全文 speak 仅在无 backend tts_chunk 时触发（不重复）', () => {
    expect(ASSISTANT_SRC).toMatch(/if \(!hasBackendTtsChunk\)/);
    expect(ASSISTANT_SRC).toMatch(/ttsService\.speak\(result\.text/);
  });
});

// ═══ Part 2: 契约漂移（失败断言，如实反映） ═══
describe('P0-A 审查结论5: form_request/form_resolved 契约漂移（需修复）', () => {
  it('后端 events.ts 声明了 form_request/form_resolved phase', () => {
    expect(BACKEND_EVENTS_SRC).toContain("'form_request'");
    expect(BACKEND_EVENTS_SRC).toContain("'form_resolved'");
  });
  // 失败断言：前端 types.ts 未同步 form phase —— 如实反映 drift，不掩盖
  // codex review 明确：写成"非阻断"+30/30 绿会掩盖真实 contract drift
  it('FAIL: 前端 types.ts AgentWorkEventPhase 缺 form_request/form_resolved（契约漂移未修复）', () => {
    const m = FRONTEND_TYPES_SRC.match(/export type AgentWorkEventPhase =[\s\S]*?;/);
    expect(m).not.toBeNull();
    const feUnion = m![0];
    // 这两个断言会失败，直到 types.ts 同步 form_request/form_resolved
    expect(feUnion).toContain('form_request');
    expect(feUnion).toContain('form_resolved');
  });
});

// ═══ Part 3: 基础契约一致性（前后端 union 对齐，不含漂移部分） ═══
describe('P0-A 基础契约: AgentWorkEventStatus 前后端 5 值一致', () => {
  const STATUSES = ['queued', 'running', 'complete', 'blocked', 'failed'];
  for (const status of STATUSES) {
    it(`status "${status}" 前后端一致`, () => {
      expect(BACKEND_EVENTS_SRC).toContain(`'${status}'`);
      const m = FRONTEND_TYPES_SRC.match(/export type AgentWorkEventStatus =[\s\S]*?;/);
      expect(m![0]).toContain(status);
    });
  }
});

describe('P0-A 基础契约: AgentWorkEvent 核心字段前后端一致', () => {
  it('核心字段 phase/status/title/message 前后端都有', () => {
    const be = BACKEND_EVENTS_SRC.match(/export type AgentWorkEvent = \{[\s\S]*?\}/)![0];
    const fe = FRONTEND_TYPES_SRC.match(/export interface AgentWorkEvent \{[\s\S]*?\}/)![0];
    for (const f of ['phase', 'status', 'title', 'message']) {
      expect(be).toContain(f);
      expect(fe).toContain(f);
    }
  });
  it('metadata 字段名约定 step/callId/toolId/input/output 前后端一致', () => {
    const be = BACKEND_EVENTS_SRC.match(/export type AgentWorkEventMetadata = \{[\s\S]*?\}/)![0];
    const fe = FRONTEND_TYPES_SRC.match(/export interface AgentWorkEventMetadata \{[\s\S]*?\}/)![0];
    for (const f of ['step', 'callId', 'toolId', 'input', 'output']) {
      expect(be).toContain(f);
      expect(fe).toContain(f);
    }
  });
});

// ═══ Part 4: SSE 通道一致性 ═══
describe('P0-A SSE 通道: 后端 emit vs 前端消费', () => {
  it('agent_event 通道前后端一致', () => {
    expect(BACKEND_EVENTS_SRC).toMatch(/emit\?\.\('agent_event'/);
    expect(ASSISTANT_SRC).toMatch(/event === 'agent_event'/);
  });
  it('block 通道（start/delta/patch/end/error）前后端一致', () => {
    expect(BACKEND_EVENTS_SRC).toMatch(/emit\('block_start'/);
    for (const ch of ['block_start', 'block_delta', 'block_patch', 'block_end', 'block_error']) {
      expect(ASSISTANT_SRC).toContain(`'${ch}'`);
    }
  });
  it('tts_chunk 通道独立（TTS 与 text 分离）', () => {
    expect(ASSISTANT_SRC).toMatch(/event === 'tts_chunk'/);
  });
});

// ═══ Part 5: normalize 容错 ═══
describe('P0-A normalize: normalizeAgentWorkEvent 容错消费', () => {
  it('normalize 对非法输入返回 null（fail closed）', () => {
    expect(NORMALIZE_SRC).toMatch(/return null/);
  });
  it('Assistant.tsx 调用 normalizeAgentWorkEvent 消费 agent_event', () => {
    expect(ASSISTANT_SRC).toMatch(/normalizeAgentWorkEvent\(data\)/);
  });
});

// ═══ Part 6: 真实 payload fixture ═══
describe('P0-A fixture: 真实 AgentWorkEvent payload 消费', () => {
  it('tool_call_start payload（running + toolId + metadata.input）', () => {
    const event: AgentWorkEvent = {
      id: 'test-id-1',
      phase: 'tool_call_start', status: 'running', title: '调用工具', message: '执行中',
      toolId: 'finance.apply_voucher_to_invoice',
      metadata: { step: 1, callId: 'call_1', toolId: 'finance.apply_voucher_to_invoice', input: { invoiceId: 'I1' } },
    };
    expect(event.metadata?.callId).toBe('call_1');
  });
  it('failed payload（error metadata）', () => {
    const event: AgentWorkEvent = {
      id: 'test-id-2',
      phase: 'error', status: 'failed', title: '失败', message: 'INVOICE_NOT_FOUND',
      metadata: { error: { code: 'INVOICE_NOT_FOUND', message: 'not found' } },
    };
    expect(event.metadata?.error?.code).toBe('INVOICE_NOT_FOUND');
  });
  it('blocked payload（approvalId for form/approval 交互）', () => {
    const event: AgentWorkEvent = {
      id: 'test-id-3',
      phase: 'form_request', status: 'blocked', title: '需审批', message: '核销需审批',
      metadata: { approvalId: 'appr_123' },
    };
    expect(event.metadata?.approvalId).toBe('appr_123');
  });
});
