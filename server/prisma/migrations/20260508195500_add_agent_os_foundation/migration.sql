CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "primaryDeptId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT,
    "scope" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "memoryScopes" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" BIGINT,
    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT,
    "scope" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "relatedEntity" TEXT,
    "relatedEntityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "mimeType" TEXT,
    "checksum" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "tags" TEXT[],
    "sourceRange" JSONB,
    "embedding" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeRelation" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "chunkId" TEXT,
    "relationType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeAcl" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "roleId" TEXT,
    "departmentId" TEXT,
    "scope" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    CONSTRAINT "KnowledgeAcl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "inputSchema" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentTool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentToolPermission" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'execute',
    "riskMode" TEXT NOT NULL DEFAULT 'direct',
    CONSTRAINT "AgentToolPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentToolRun" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AgentToolRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentSuggestion" (
    "id" TEXT NOT NULL,
    "suggestionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scope" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    CONSTRAINT "AgentSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "risk" TEXT NOT NULL DEFAULT 'high',
    "payload" JSONB NOT NULL,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAccount_email_key" ON "UserAccount"("email");
CREATE INDEX "UserAccount_status_idx" ON "UserAccount"("status");
CREATE INDEX "UserAccount_primaryDeptId_idx" ON "UserAccount"("primaryDeptId");
CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");
CREATE INDEX "Department_status_idx" ON "Department"("status");
CREATE INDEX "Role_isSystem_idx" ON "Role"("isSystem");
CREATE UNIQUE INDEX "UserRole_userId_roleId_departmentId_key" ON "UserRole"("userId", "roleId", "departmentId");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "UserRole_departmentId_idx" ON "UserRole"("departmentId");
CREATE UNIQUE INDEX "Permission_scope_key" ON "Permission"("scope");
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE INDEX "AgentPolicy_roleId_idx" ON "AgentPolicy"("roleId");
CREATE INDEX "AgentPolicy_scope_action_idx" ON "AgentPolicy"("scope", "action");
CREATE INDEX "AgentSession_userId_idx" ON "AgentSession"("userId");
CREATE INDEX "AgentSession_departmentId_idx" ON "AgentSession"("departmentId");
CREATE INDEX "AgentSession_status_idx" ON "AgentSession"("status");
CREATE INDEX "AgentMessage_sessionId_idx" ON "AgentMessage"("sessionId");
CREATE INDEX "AgentMessage_userId_idx" ON "AgentMessage"("userId");
CREATE INDEX "AgentMessage_createdAt_idx" ON "AgentMessage"("createdAt");
CREATE INDEX "AgentMemory_scope_idx" ON "AgentMemory"("scope");
CREATE INDEX "AgentMemory_memoryType_idx" ON "AgentMemory"("memoryType");
CREATE INDEX "AgentMemory_userId_idx" ON "AgentMemory"("userId");
CREATE INDEX "AgentMemory_departmentId_idx" ON "AgentMemory"("departmentId");
CREATE INDEX "AgentMemory_relatedEntity_relatedEntityId_idx" ON "AgentMemory"("relatedEntity", "relatedEntityId");
CREATE INDEX "KnowledgeDocument_sourceType_idx" ON "KnowledgeDocument"("sourceType");
CREATE INDEX "KnowledgeDocument_status_idx" ON "KnowledgeDocument"("status");
CREATE INDEX "KnowledgeDocument_checksum_idx" ON "KnowledgeDocument"("checksum");
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_chunkIndex_key" ON "KnowledgeChunk"("documentId", "chunkIndex");
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");
CREATE INDEX "KnowledgeRelation_documentId_idx" ON "KnowledgeRelation"("documentId");
CREATE INDEX "KnowledgeRelation_chunkId_idx" ON "KnowledgeRelation"("chunkId");
CREATE INDEX "KnowledgeRelation_targetType_targetId_idx" ON "KnowledgeRelation"("targetType", "targetId");
CREATE INDEX "KnowledgeRelation_relationType_idx" ON "KnowledgeRelation"("relationType");
CREATE INDEX "KnowledgeAcl_documentId_idx" ON "KnowledgeAcl"("documentId");
CREATE INDEX "KnowledgeAcl_roleId_idx" ON "KnowledgeAcl"("roleId");
CREATE INDEX "KnowledgeAcl_departmentId_idx" ON "KnowledgeAcl"("departmentId");
CREATE INDEX "KnowledgeAcl_scope_idx" ON "KnowledgeAcl"("scope");
CREATE INDEX "AgentTool_scope_idx" ON "AgentTool"("scope");
CREATE INDEX "AgentTool_risk_idx" ON "AgentTool"("risk");
CREATE INDEX "AgentTool_status_idx" ON "AgentTool"("status");
CREATE UNIQUE INDEX "AgentToolPermission_toolId_roleId_key" ON "AgentToolPermission"("toolId", "roleId");
CREATE INDEX "AgentToolPermission_roleId_idx" ON "AgentToolPermission"("roleId");
CREATE INDEX "AgentToolRun_toolId_idx" ON "AgentToolRun"("toolId");
CREATE INDEX "AgentToolRun_userId_idx" ON "AgentToolRun"("userId");
CREATE INDEX "AgentToolRun_sessionId_idx" ON "AgentToolRun"("sessionId");
CREATE INDEX "AgentToolRun_status_idx" ON "AgentToolRun"("status");
CREATE INDEX "AgentToolRun_idempotencyKey_idx" ON "AgentToolRun"("idempotencyKey");
CREATE INDEX "AgentJob_jobType_idx" ON "AgentJob"("jobType");
CREATE INDEX "AgentJob_status_idx" ON "AgentJob"("status");
CREATE INDEX "AgentJob_priority_idx" ON "AgentJob"("priority");
CREATE INDEX "AgentJob_scheduledAt_idx" ON "AgentJob"("scheduledAt");
CREATE INDEX "AgentSuggestion_suggestionType_idx" ON "AgentSuggestion"("suggestionType");
CREATE INDEX "AgentSuggestion_status_idx" ON "AgentSuggestion"("status");
CREATE INDEX "AgentSuggestion_scope_idx" ON "AgentSuggestion"("scope");
CREATE INDEX "ApprovalRequest_requesterId_idx" ON "ApprovalRequest"("requesterId");
CREATE INDEX "ApprovalRequest_reviewerId_idx" ON "ApprovalRequest"("reviewerId");
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");
CREATE INDEX "ApprovalRequest_actionType_idx" ON "ApprovalRequest"("actionType");

ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserAccount" ADD CONSTRAINT "UserAccount_primaryDeptId_fkey"
    FOREIGN KEY ("primaryDeptId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
    FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentPolicy" ADD CONSTRAINT "AgentPolicy_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAcl" ADD CONSTRAINT "KnowledgeAcl_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAcl" ADD CONSTRAINT "KnowledgeAcl_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAcl" ADD CONSTRAINT "KnowledgeAcl_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentToolPermission" ADD CONSTRAINT "AgentToolPermission_toolId_fkey"
    FOREIGN KEY ("toolId") REFERENCES "AgentTool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentToolPermission" ADD CONSTRAINT "AgentToolPermission_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentToolRun" ADD CONSTRAINT "AgentToolRun_toolId_fkey"
    FOREIGN KEY ("toolId") REFERENCES "AgentTool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentToolRun" ADD CONSTRAINT "AgentToolRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
