-- CreateTable
CREATE TABLE "AgentCheckpoint" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "scratchpad" JSONB NOT NULL,
    "iterations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCheckpoint_conversationId_key" ON "AgentCheckpoint"("conversationId");

-- CreateIndex
CREATE INDEX "AgentCheckpoint_conversationId_idx" ON "AgentCheckpoint"("conversationId");

-- CreateIndex
CREATE INDEX "AgentCheckpoint_createdAt_idx" ON "AgentCheckpoint"("createdAt");
