-- Workflow Engine: multi-step approval / countersign / conditional branching
-- Phase 0 Sprint 2 — 工作流引擎（多步审批状态机）

-- WorkflowDefinition: reusable approval flow template
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "triggerEvent" TEXT,
    "steps" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowDefinition_entityType_idx" ON "WorkflowDefinition"("entityType");
CREATE INDEX "WorkflowDefinition_triggerEvent_idx" ON "WorkflowDefinition"("triggerEvent");
CREATE INDEX "WorkflowDefinition_isActive_idx" ON "WorkflowDefinition"("isActive");

-- WorkflowInstance: a concrete approval flow bound to a business entity
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "initiatedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowInstance_definitionId_idx" ON "WorkflowInstance"("definitionId");
CREATE INDEX "WorkflowInstance_entityType_entityId_idx" ON "WorkflowInstance"("entityType", "entityId");
CREATE INDEX "WorkflowInstance_status_idx" ON "WorkflowInstance"("status");
CREATE INDEX "WorkflowInstance_initiatedById_idx" ON "WorkflowInstance"("initiatedById");

ALTER TABLE "WorkflowInstance"
    ADD CONSTRAINT "WorkflowInstance_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowInstance"
    ADD CONSTRAINT "WorkflowInstance_initiatedById_fkey"
    FOREIGN KEY ("initiatedById") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- WorkflowStep: individual step in a workflow instance
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "approverRole" TEXT,
    "approverUserId" TEXT,
    "decision" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowStep_instanceId_idx" ON "WorkflowStep"("instanceId");
CREATE INDEX "WorkflowStep_decision_idx" ON "WorkflowStep"("decision");
CREATE INDEX "WorkflowStep_approverRole_idx" ON "WorkflowStep"("approverRole");

ALTER TABLE "WorkflowStep"
    ADD CONSTRAINT "WorkflowStep_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowStep"
    ADD CONSTRAINT "WorkflowStep_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
