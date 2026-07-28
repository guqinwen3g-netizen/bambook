-- Add authentication fields to UserAccount
ALTER TABLE "UserAccount" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UserAccount" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "UserAccount" ADD COLUMN "lastLoginIp" TEXT;

-- Create AuditLog table
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
