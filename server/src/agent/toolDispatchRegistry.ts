/**
 * Tool Dispatch Registry — 工具分发注册表
 *
 * 将 executeTool 中 77 个 if 分支替换为 Map 注册表模式。
 * 新增工具只需 registerTool()，无需修改 executeTool 函数体。
 *
 * 设计原则:
 *   1. 渐进式迁移——先注册简单工具（直接 return），复合流程暂留原路径
 *   2. 类型安全——ToolHandler 接口约束输入输出
 *   3. 可扩展——支持同步/异步 handler
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface PlannedToolCall {
  toolId: string;
  input: Record<string, unknown>;
  approvalId?: string;
}

export interface ToolHandlerResult {
  ok: boolean;
  [key: string]: unknown;
}

export type ToolHandler = (
  prisma: PrismaClient,
  input: Record<string, unknown>,
  call?: PlannedToolCall,
) => Promise<ToolHandlerResult> | ToolHandlerResult;

// ─── 注册表核心 ───
const toolHandlers = new Map<string, ToolHandler>();

export function registerTool(toolId: string, handler: ToolHandler): void {
  if (toolHandlers.has(toolId)) {
    logger.warn(`[toolDispatchRegistry] Duplicate registration for ${toolId}, overwriting`);
  }
  toolHandlers.set(toolId, handler);
}

export function hasToolHandler(toolId: string): boolean {
  return toolHandlers.has(toolId);
}

export function getToolHandler(toolId: string): ToolHandler | undefined {
  return toolHandlers.get(toolId);
}

export function getRegisteredToolIds(): string[] {
  return Array.from(toolHandlers.keys()).sort();
}

export function getRegisteredToolCount(): number {
  return toolHandlers.size;
}

/**
 * 尝试通过注册表分发工具调用。
 * 返回 true 表示命中注册表（result 已填充），false 表示未注册（需走原 if 链）。
 */
export async function dispatchFromRegistry(
  prisma: PrismaClient,
  call: PlannedToolCall,
): Promise<{ hit: true; result: ToolHandlerResult } | { hit: false }> {
  const handler = toolHandlers.get(call.toolId);
  if (!handler) return { hit: false };
  const result = await handler(prisma, call.input, call);
  return { hit: true, result };
}

// ─── 批量注册辅助 ───
export function registerTools(tools: Record<string, ToolHandler>): void {
  for (const [id, handler] of Object.entries(tools)) {
    registerTool(id, handler);
  }
}


// ─── Commit Tool 注册辅助 ───
// 复合流程工具（需要 approval/draft/commit 闭环）的通用注册器。
// 所有 25 个 commit 工具共享相同的 7 步 boilerplate：
//   1. 提取 approvalId
//   2. 校验 approvalId 存在
//   3. 查 approvalRequest
//   4. 校验 status === 'approved'
//   5. 提取 payload
//   6. 调用具体 commit 函数
//   7. 返回结果

export interface CommitContext {
  prisma: PrismaClient;
  approvalId: string;
  approvalPayload: Record<string, unknown> | null;
  call: PlannedToolCall;
}

export type CommitHandler = (ctx: CommitContext) => Promise<ToolHandlerResult>;

/**
 * 注册一个复合 commit 工具。
 * 自动处理 approval 校验 boilerplate，开发者只需提供具体的 commit 逻辑。
 *
 * @param toolId 工具 ID（如 'order.confirm'）
 * @param commitFn 具体的 commit 函数，接收 CommitContext（含 prisma + approvalId + payload）
 */
export function registerCommitTool(toolId: string, commitFn: CommitHandler): void {
  registerTool(toolId, async (prisma, _input, call) => {
    const targetApprovalId = String(call?.approvalId || '');
    if (!targetApprovalId) {
      const message = `COMMIT_FAILED: approvalId not provided for ${toolId} commit`;
      return {
        ok: false,
        committed: false,
        error: message,
        errorFeedback: {
          code: 'APPROVAL_ID_MISSING',
          message,
          retryable: false,
        },
      };
    }

    const approval = await (prisma as any).approvalRequest
      .findUnique({ where: { id: targetApprovalId } })
      .catch(() => null);

    if (!approval) {
      const message = `COMMIT_FAILED: approval ${targetApprovalId} not found or not approved (status=null)`;
      return {
        ok: false,
        committed: false,
        error: message,
        errorFeedback: {
          code: 'APPROVAL_NOT_FOUND',
          message,
          retryable: false,
        },
      };
    }

    if (approval.status === 'pending') {
      const message = 'COMMIT_FAILED: approval not yet approved (status=pending)';
      return {
        ok: false,
        committed: false,
        error: message,
        errorFeedback: {
          code: 'APPROVAL_PENDING',
          message,
          retryable: false,
        },
      };
    }

    if (approval.status !== 'approved') {
      const message = approval.status === 'modified'
        ? `COMMIT_FAILED: ${toolId} does not support modified approval (status=modified). Regenerate the draft and re-approve.`
        : `COMMIT_FAILED: approval ${targetApprovalId} not approved (status=${approval.status})`;
      return {
        ok: false,
        committed: false,
        error: message,
        errorFeedback: {
          code: 'APPROVAL_MODIFIED_UNSUPPORTED',
          message,
          retryable: false,
        },
      };
    }

    const payload = approval.payload as Record<string, unknown> | null;
    return commitFn({ prisma, approvalId: targetApprovalId, approvalPayload: payload, call: call! });
  });
}

/**
 * 批量注册 commit 工具
 */
export function registerCommitTools(tools: Record<string, CommitHandler>): void {
  for (const [id, handler] of Object.entries(tools)) {
    registerCommitTool(id, handler);
  }
}
