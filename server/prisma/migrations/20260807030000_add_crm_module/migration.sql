-- ============ Phase 3 C1: CRM 深化（联系人/信用/跟进/商机/分层）============

-- CreateTable: Contact
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "wechat" TEXT,
    "whatsapp" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "birthday" TEXT,
    "personalNote" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditLimit
CREATE TABLE "CreditLimit" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "totalLimit" DECIMAL(18,4) NOT NULL,
    "usedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "approvedBy" TEXT,
    "approvedAt" BIGINT,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "CreditLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable: FollowUpRecord
CREATE TABLE "FollowUpRecord" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "contactId" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "followUpAt" TEXT NOT NULL,
    "nextFollowUpAt" TEXT,
    "nextFollowUpTopic" TEXT,
    "opportunityId" TEXT,
    "orderId" TEXT,
    "salesRepId" TEXT,
    "salesRepName" TEXT,
    "attachments" JSONB,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "FollowUpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Opportunity
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "stage" TEXT NOT NULL DEFAULT 'Prospecting',
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expectedCloseDate" TEXT,
    "source" TEXT,
    "orderId" TEXT,
    "salesRepId" TEXT,
    "salesRepName" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "closedAt" BIGINT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerTier
CREATE TABLE "CustomerTier" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "criteria" TEXT,
    "discountRate" DECIMAL(5,2),
    "paymentTermsDays" INTEGER,
    "creditPriority" TEXT NOT NULL DEFAULT 'Normal',
    "evaluatedAt" TEXT NOT NULL,
    "validUntil" TEXT,
    "evaluatedBy" TEXT,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "CustomerTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Contact
CREATE INDEX "Contact_relationId_idx" ON "Contact"("relationId");
CREATE INDEX "Contact_isPrimary_idx" ON "Contact"("isPrimary");
CREATE INDEX "Contact_status_idx" ON "Contact"("status");

-- CreateIndex: CreditLimit
CREATE INDEX "CreditLimit_relationId_idx" ON "CreditLimit"("relationId");
CREATE INDEX "CreditLimit_status_idx" ON "CreditLimit"("status");

-- CreateIndex: FollowUpRecord
CREATE INDEX "FollowUpRecord_relationId_idx" ON "FollowUpRecord"("relationId");
CREATE INDEX "FollowUpRecord_contactId_idx" ON "FollowUpRecord"("contactId");
CREATE INDEX "FollowUpRecord_followUpAt_idx" ON "FollowUpRecord"("followUpAt");
CREATE INDEX "FollowUpRecord_nextFollowUpAt_idx" ON "FollowUpRecord"("nextFollowUpAt");

-- CreateIndex: Opportunity
CREATE INDEX "Opportunity_relationId_idx" ON "Opportunity"("relationId");
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");
CREATE INDEX "Opportunity_expectedCloseDate_idx" ON "Opportunity"("expectedCloseDate");
CREATE INDEX "Opportunity_salesRepId_idx" ON "Opportunity"("salesRepId");

-- CreateIndex: CustomerTier
CREATE INDEX "CustomerTier_relationId_idx" ON "CustomerTier"("relationId");
CREATE INDEX "CustomerTier_level_idx" ON "CustomerTier"("level");

-- AddForeignKey: Contact → Relation
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_relationId_fkey"
    FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CreditLimit → Relation
ALTER TABLE "CreditLimit" ADD CONSTRAINT "CreditLimit_relationId_fkey"
    FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: FollowUpRecord → Relation
ALTER TABLE "FollowUpRecord" ADD CONSTRAINT "FollowUpRecord_relationId_fkey"
    FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: FollowUpRecord → Contact
ALTER TABLE "FollowUpRecord" ADD CONSTRAINT "FollowUpRecord_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Opportunity → Relation
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_relationId_fkey"
    FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CustomerTier → Relation
ALTER TABLE "CustomerTier" ADD CONSTRAINT "CustomerTier_relationId_fkey"
    FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
