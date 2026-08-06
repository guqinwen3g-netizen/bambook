/**
 * WorkflowEngine — 工作流引擎核心服务
 *
 * 职责：
 *   1. 创建工作流实例（从定义模板实例化所有步骤）
 *   2. 推进步骤（approve → 自动前进到下一步或完成实例）
 *   3. 驳回步骤（reject → 终止整个实例）
 *   4. 取消实例
 *   5. 查询实例列表（支持按状态/实体/待审批人过滤）
 *
 * 状态机：
 *   running ──approve(last)──→ approved
 *   running ──reject──────────→ rejected
 *   running ──cancel─────────→ cancelled
 *   running ──approve(mid)──→ running (currentStepIndex++)
 *
 * 通知集成：
 *   - 实例创建时通知第一步审批人
 *   - 步骤推进时通知下一步审批人
 *   - 实例完成时通知发起人
 *
 * 幂等性：
 *   - 同一实体 + 同一定义 + running 状态 → 拒绝重复创建
 */

import { PrismaClient, WorkflowDefinition, WorkflowInstance, WorkflowStep } from '@prisma/client';
import { createNotificationService } from '../notifications/notificationService';
import { logger } from '../lib/logger';
import { StepDef, CreateInstanceParams, DecideStepParams, WorkflowInstanceFilter, WorkflowInstanceDetail, WorkflowStepDetail, DefaultWorkflowDefinition } from './workflowTypes';

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class WorkflowEngine {
  constructor(private prisma: PrismaClient) {}

  // ── 列出活跃的工作流定义 ──
  async listDefinitions(): Promise<WorkflowDefinition[]> {
    return this.prisma.workflowDefinition.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── 获取定义详情 ──
  async getDefinition(id: string): Promise<WorkflowDefinition | null> {
    return this.prisma.workflowDefinition.findUnique({ where: { id } });
  }

  // ── 创建工作流定义 ──
  async createDefinition(params: {
    id?: string;
    name: string;
    description?: string;
    entityType: string;
    triggerEvent?: string;
    steps: StepDef[];
  }): Promise<WorkflowDefinition> {
    const id = params.id || generateId('wf_def');
    return this.prisma.workflowDefinition.create({
      data: {
        id,
        name: params.name,
        description: params.description || null,
        entityType: params.entityType,
        triggerEvent: params.triggerEvent || null,
        steps: params.steps as any,
        isActive: true,
      },
    });
  }

  // ── 创建工作流实例 ──
  async createInstance(params: CreateInstanceParams): Promise<WorkflowInstanceDetail> {
    const def = await this.prisma.workflowDefinition.findUnique({ where: { id: params.definitionId } });
    if (!def) throw new Error(`工作流定义 ${params.definitionId} 不存在`);
    if (!def.isActive) throw new Error(`工作流定义 ${params.definitionId} 已停用`);

    const steps = def.steps as unknown as StepDef[];
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error(`工作流定义 ${params.definitionId} 步骤为空`);
    }

    // 幂等：同一实体 + 同一定义 + running 状态 → 返回已有实例
    const existing = await this.prisma.workflowInstance.findFirst({
      where: {
        definitionId: params.definitionId,
        entityType: params.entityType,
        entityId: params.entityId,
        status: 'running',
      },
      include: { steps: { orderBy: { stepIndex: 'asc' } } },
    });
    if (existing) {
      return this.toDetail(existing, def.name, existing.steps);
    }

    const instanceId = generateId('wf_inst');
    const result = await this.prisma.workflowInstance.create({
      data: {
        id: instanceId,
        definitionId: params.definitionId,
        entityType: params.entityType,
        entityId: params.entityId,
        status: 'running',
        currentStepIndex: 0,
        title: params.title || null,
        initiatedById: params.initiatedById || null,
        steps: {
          create: steps.map((step, idx) => ({
            id: generateId('wf_step'),
            stepIndex: idx,
            stepName: step.name,
            approverRole: step.approverRole || null,
            approverUserId: step.approverUserId || null,
            decision: null,
          })),
        },
      },
      include: { steps: { orderBy: { stepIndex: 'asc' } } },
    });

    // 通知第一步审批人
    await this.notifyCurrentApprover(result, def.name);

    logger.info('[WorkflowEngine] instance created', {
      instanceId,
      definitionId: params.definitionId,
      entityType: params.entityType,
      entityId: params.entityId,
    });

    return this.toDetail(result, def.name, result.steps);
  }

  // ── 审批决策（approve / reject）──
  async decideStep(params: DecideStepParams): Promise<WorkflowInstanceDetail> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: params.instanceId },
      include: { steps: { orderBy: { stepIndex: 'asc' } }, definition: true },
    });
    if (!instance) throw new Error(`工作流实例 ${params.instanceId} 不存在`);
    if (instance.status !== 'running') {
      throw new Error(`工作流实例 ${params.instanceId} 状态为 ${instance.status}，无法审批`);
    }

    const currentStep = instance.steps.find(s => s.stepIndex === instance.currentStepIndex);
    if (!currentStep) throw new Error(`实例 ${params.instanceId} 未找到当前步骤 ${instance.currentStepIndex}`);
    if (currentStep.decision !== null) {
      throw new Error(`步骤 ${currentStep.stepName} 已决策（${currentStep.decision}）`);
    }

    // 更新当前步骤
    const updatedStep = await this.prisma.workflowStep.update({
      where: { id: currentStep.id },
      data: {
        decision: params.decision,
        decisionNote: params.note || null,
        decidedById: params.decidedById,
        decidedAt: new Date(),
      },
    });

    const defName = instance.definition?.name || '';
    let newStatus = instance.status;
    let newStepIndex = instance.currentStepIndex;

    if (params.decision === 'rejected') {
      // 驳回 → 实例终止
      newStatus = 'rejected';
      await this.prisma.workflowInstance.update({
        where: { id: params.instanceId },
        data: { status: newStatus, completedAt: new Date() },
      });
      // 通知发起人
      await this.notifyInitiator(instance, defName, 'rejected');
    } else {
      // 通过 → 前进到下一步或完成
      const nextStep = instance.steps.find(s => s.stepIndex === instance.currentStepIndex + 1);
      if (nextStep) {
        newStepIndex = instance.currentStepIndex + 1;
        await this.prisma.workflowInstance.update({
          where: { id: params.instanceId },
          data: { currentStepIndex: newStepIndex },
        });
        // 通知下一步审批人
        const updatedInstance = await this.prisma.workflowInstance.findUnique({
          where: { id: params.instanceId },
          include: { steps: { orderBy: { stepIndex: 'asc' } } },
        });
        if (updatedInstance) {
          await this.notifyCurrentApprover(updatedInstance, defName);
        }
      } else {
        // 最后一步通过 → 实例完成
        newStatus = 'approved';
        await this.prisma.workflowInstance.update({
          where: { id: params.instanceId },
          data: { status: newStatus, completedAt: new Date() },
        });
        // 通知发起人
        await this.notifyInitiator(instance, defName, 'approved');
      }
    }

    logger.info('[WorkflowEngine] step decided', {
      instanceId: params.instanceId,
      stepIndex: instance.currentStepIndex,
      decision: params.decision,
      newStatus,
      newStepIndex,
    });

    // 重新查询返回最新状态
    const finalInstance = await this.prisma.workflowInstance.findUnique({
      where: { id: params.instanceId },
      include: { steps: { orderBy: { stepIndex: 'asc' } }, definition: true },
    });
    if (!finalInstance) throw new Error(`实例 ${params.instanceId} 查询失败`);
    return this.toDetail(finalInstance, finalInstance.definition?.name || '', finalInstance.steps);
  }

  // ── 取消实例 ──
  async cancelInstance(instanceId: string, reason?: string): Promise<WorkflowInstanceDetail> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: { steps: { orderBy: { stepIndex: 'asc' } }, definition: true },
    });
    if (!instance) throw new Error(`工作流实例 ${instanceId} 不存在`);
    if (instance.status !== 'running') {
      throw new Error(`工作流实例 ${instanceId} 状态为 ${instance.status}，无法取消`);
    }

    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    logger.info('[WorkflowEngine] instance cancelled', { instanceId, reason });

    // 重新查询返回最新状态
    const updated = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: { steps: { orderBy: { stepIndex: 'asc' } }, definition: true, initiator: true },
    });
    if (!updated) throw new Error(`实例 ${instanceId} 查询失败`);
    return this.toDetailWithNames(updated, updated.definition?.name || '', updated.steps || [], updated.initiator?.displayName || null, new Map());
  }

  // ── 获取实例详情 ──
  async getInstance(instanceId: string): Promise<WorkflowInstanceDetail | null> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: {
        steps: { orderBy: { stepIndex: 'asc' } },
        definition: true,
        initiator: true,
      },
    });
    if (!instance) return null;

    // 批量查询步骤决策人名称
    const deciderIds = instance.steps
      .map(s => s.decidedById)
      .filter((id): id is string => id !== null);
    const deciders = deciderIds.length > 0
      ? await this.prisma.userAccount.findMany({
          where: { id: { in: deciderIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const deciderMap = new Map(deciders.map(d => [d.id, d.displayName]));

    return this.toDetailWithNames(
      instance,
      instance.definition?.name || '',
      instance.steps,
      instance.initiator?.displayName || null,
      deciderMap,
    );
  }

  // ── 列出实例（支持过滤）──
  async listInstances(filter: WorkflowInstanceFilter): Promise<{ items: WorkflowInstanceDetail[]; total: number }> {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.initiatedById) where.initiatedById = filter.initiatedById;

    // 待我审批：当前步骤的 approverRole 或 approverUserId 匹配
    if (filter.pendingApproverUserId || filter.pendingApproverRole) {
      where.status = 'running';
      // 通过子查询过滤 — 当前步骤的审批人匹配
      where.steps = {
        some: {
          decision: null,
          stepIndex: { equals: where.currentStepIndex }, // Prisma 不支持直接引用 currentStepIndex
        },
      };
      // 实际上 Prisma 不支持跨字段比较，这里用两步查询
    }

    const limit = filter.limit || 50;
    const offset = filter.offset || 0;

    const [instances, total] = await Promise.all([
      this.prisma.workflowInstance.findMany({
        where,
        include: {
          steps: { orderBy: { stepIndex: 'asc' } },
          definition: true,
          initiator: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.workflowInstance.count({ where }),
    ]);

    // 如果有待审批人过滤，在内存中二次过滤
    let filtered = instances;
    if (filter.pendingApproverUserId || filter.pendingApproverRole) {
      filtered = instances.filter(inst => {
        const currentStep = inst.steps.find(s => s.stepIndex === inst.currentStepIndex);
        if (!currentStep || currentStep.decision !== null) return false;
        if (filter.pendingApproverUserId && currentStep.approverUserId === filter.pendingApproverUserId) return true;
        if (filter.pendingApproverRole && currentStep.approverRole === filter.pendingApproverRole) return true;
        return false;
      });
    }

    // 批量查询决策人名称
    const allDeciderIds = filtered
      .flatMap(inst => inst.steps.map(s => s.decidedById))
      .filter((id): id is string => id !== null);
    const deciders = allDeciderIds.length > 0
      ? await this.prisma.userAccount.findMany({
          where: { id: { in: [...new Set(allDeciderIds)] } },
          select: { id: true, displayName: true },
        })
      : [];
    const deciderMap = new Map(deciders.map(d => [d.id, d.displayName]));

    return {
      items: filtered.map(inst => this.toDetailWithNames(
        inst,
        inst.definition?.name || '',
        inst.steps,
        inst.initiator?.displayName || null,
        deciderMap,
      )),
      total: filter.pendingApproverUserId || filter.pendingApproverRole ? filtered.length : total,
    };
  }

  // ── 获取实体的工作流历史 ──
  async getInstancesForEntity(entityType: string, entityId: string): Promise<WorkflowInstanceDetail[]> {
    const { items } = await this.listInstances({ entityType, entityId, limit: 50 });
    return items;
  }

  // ── 通知当前步骤审批人 ──
  private async notifyCurrentApprover(instance: any, definitionName: string): Promise<void> {
    try {
      const currentStep = instance.steps?.find((s: any) => s.stepIndex === instance.currentStepIndex);
      if (!currentStep) return;

      const notificationService = createNotificationService(this.prisma);
      const title = `${definitionName}：${currentStep.stepName} 待审批`;
      const body = instance.title
        ? `「${instance.title}」需要您审批`
        : `${instance.entityType} ${instance.entityId} 需要您审批`;

      // 指定用户 → 单播；否则角色 → 广播（该角色所有用户都能看到）
      if (currentStep.approverUserId) {
        await notificationService.sendToUser({
          userId: currentStep.approverUserId,
          type: 'workflow_pending',
          title,
          body,
          level: 'info',
          link: `/workflow?id=${instance.id}`,
          metadata: {
            instanceId: instance.id,
            stepIndex: instance.currentStepIndex,
            entityType: instance.entityType,
            entityId: instance.entityId,
          },
        });
      } else if (currentStep.approverRole) {
        await notificationService.broadcastToRole({
          role: currentStep.approverRole,
          type: 'workflow_pending',
          title,
          body,
          level: 'info',
          link: `/workflow?id=${instance.id}`,
          metadata: {
            instanceId: instance.id,
            stepIndex: instance.currentStepIndex,
            entityType: instance.entityType,
            entityId: instance.entityId,
          },
        });
      }
    } catch (e: any) {
      // 通知失败不应阻断工作流推进
      logger.warn('[WorkflowEngine] notify approver failed', { error: e?.message });
    }
  }

  // ── 通知发起人结果 ──
  private async notifyInitiator(instance: any, definitionName: string, result: 'approved' | 'rejected'): Promise<void> {
    if (!instance.initiatedById) return;
    try {
      const notificationService = createNotificationService(this.prisma);
      const title = result === 'approved'
        ? `${definitionName} 已通过`
        : `${definitionName} 被驳回`;
      const body = instance.title
        ? `「${instance.title}」${result === 'approved' ? '审批通过' : '审批被驳回'}`
        : `${instance.entityType} ${instance.entityId} ${result === 'approved' ? '审批通过' : '审批被驳回'}`;

      await notificationService.sendToUser({
        userId: instance.initiatedById,
        type: result === 'approved' ? 'workflow_approved' : 'workflow_rejected',
        title,
        body,
        level: result === 'approved' ? 'info' : 'warning',
        link: `/workflow?id=${instance.id}`,
        metadata: {
          instanceId: instance.id,
          entityType: instance.entityType,
          entityId: instance.entityId,
        },
      });
    } catch (e: any) {
      logger.warn('[WorkflowEngine] notify initiator failed', { error: e?.message });
    }
  }

  // ── 映射函数 ──
  private toDetail(instance: any, definitionName: string, steps: WorkflowStep[] | null | undefined): WorkflowInstanceDetail {
    const stepList = Array.isArray(steps) ? steps : [];
    return {
      id: instance.id,
      definitionId: instance.definitionId,
      definitionName,
      entityType: instance.entityType,
      entityId: instance.entityId,
      status: instance.status,
      currentStepIndex: instance.currentStepIndex,
      title: instance.title,
      initiatedById: instance.initiatedById,
      initiatorName: null,
      completedAt: instance.completedAt,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      steps: stepList.map(s => this.toStepDetail(s)),
    };
  }

  private toDetailWithNames(
    instance: any,
    definitionName: string,
    steps: WorkflowStep[] | null | undefined,
    initiatorName: string | null,
    deciderMap: Map<string, string>,
  ): WorkflowInstanceDetail {
    const stepList = Array.isArray(steps) ? steps : [];
    return {
      id: instance.id,
      definitionId: instance.definitionId,
      definitionName,
      entityType: instance.entityType,
      entityId: instance.entityId,
      status: instance.status,
      currentStepIndex: instance.currentStepIndex,
      title: instance.title,
      initiatedById: instance.initiatedById,
      initiatorName,
      completedAt: instance.completedAt,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      steps: stepList.map(s => this.toStepDetail(s, deciderMap.get(s.decidedById || ''))),
    };
  }

  private toStepDetail(step: WorkflowStep, deciderName?: string): WorkflowStepDetail {
    return {
      id: step.id,
      stepIndex: step.stepIndex,
      stepName: step.stepName,
      approverRole: step.approverRole,
      approverUserId: step.approverUserId,
      decision: step.decision as WorkflowStepDetail['decision'],
      decisionNote: step.decisionNote,
      decidedById: step.decidedById,
      deciderName: deciderName || null,
      decidedAt: step.decidedAt,
      createdAt: step.createdAt,
    };
  }
}

// ── 默认工作流定义（首次启动时 seed）──
export const DEFAULT_WORKFLOW_DEFINITIONS: DefaultWorkflowDefinition[] = [
  {
    id: 'wf_def_order_approval',
    name: '订单确认审批',
    description: '订单确认前需经销售经理审批（大额订单可扩展为多步）',
    entityType: 'Order',
    steps: [
      { name: '销售经理审批', approverRole: 'manager', description: '确认订单价格、交期、付款条款' },
    ],
  },
  {
    id: 'wf_def_invoice_issuance',
    name: '开票审批',
    description: '开具发票前需经财务审批',
    entityType: 'Invoice',
    triggerEvent: 'ShipmentCompleted',
    steps: [
      { name: '财务审批', approverRole: 'finance', description: '确认开票金额、税号、币种' },
    ],
  },
  {
    id: 'wf_def_devcase_5a_review',
    name: '5A 样衣评审',
    description: '5A 重点样衣需经生产部评审',
    entityType: 'DevelopmentCase',
    steps: [
      { name: '生产经理评审', approverRole: 'production_manager', description: '评审样衣质量、工艺可行性' },
    ],
  },
];

/** 首次启动时 seed 默认工作流定义（已存在则跳过） */
export async function seedDefaultWorkflowDefinitions(prisma: PrismaClient): Promise<void> {
  for (const def of DEFAULT_WORKFLOW_DEFINITIONS) {
    const existing = await prisma.workflowDefinition.findUnique({ where: { id: def.id } });
    if (existing) continue;
    await prisma.workflowDefinition.create({
      data: {
        id: def.id,
        name: def.name,
        description: def.description,
        entityType: def.entityType,
        triggerEvent: def.triggerEvent || null,
        steps: def.steps as any,
        isActive: true,
      },
    });
    logger.info('[WorkflowEngine] seeded default definition', { id: def.id, name: def.name });
  }
}
