-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('leader', 'member');

-- AlterTable: Department gets reverse relations (no actual column, just FK from other tables)

-- CreateTable: JobPosition
CREATE TABLE "JobPosition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "description" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "JobPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Team
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "leaderId" TEXT,
    "departmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TeamMember
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Project
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "teamId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "startDate" TEXT,
    "endDate" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProjectMember
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WorkAssignment
CREATE TABLE "WorkAssignment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "assignerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueDate" TEXT,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "WorkAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPosition_departmentId_idx" ON "JobPosition"("departmentId");
CREATE INDEX "JobPosition_status_idx" ON "JobPosition"("status");
CREATE INDEX "Team_departmentId_idx" ON "Team"("departmentId");
CREATE INDEX "Team_status_idx" ON "Team"("status");
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");
CREATE INDEX "WorkAssignment_userId_idx" ON "WorkAssignment"("userId");
CREATE INDEX "WorkAssignment_projectId_idx" ON "WorkAssignment"("projectId");
CREATE INDEX "WorkAssignment_status_idx" ON "WorkAssignment"("status");

-- Unique constraints
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "JobPosition" ADD CONSTRAINT "JobPosition_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkAssignment" ADD CONSTRAINT "WorkAssignment_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
