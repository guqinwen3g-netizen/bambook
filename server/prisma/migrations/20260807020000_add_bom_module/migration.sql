-- ============ Phase 2 B4: BOM / 成本核算 ============

-- CreateTable: BOM
CREATE TABLE "BOM" (
    "id" TEXT NOT NULL,
    "bomNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "productAssetId" TEXT,
    "orderId" TEXT,
    "quotationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentBomId" TEXT,
    "totalMaterialCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalLaborCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalOverheadCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "sellingPrice" DECIMAL(18,4),
    "profitMargin" DECIMAL(8,4),
    "profitAmount" DECIMAL(18,4),
    "notes" TEXT,
    "attachments" JSONB,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    CONSTRAINT "BOM_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BOMLine
CREATE TABLE "BOMLine" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "materialType" TEXT NOT NULL,
    "materialCode" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "specification" TEXT,
    "supplierId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "wastagePercent" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "effectiveQty" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    CONSTRAINT "BOMLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CostEstimate
CREATE TABLE "CostEstimate" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "costType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    CONSTRAINT "CostEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (BOM)
CREATE UNIQUE INDEX "BOM_bomNumber_key" ON "BOM"("bomNumber");
CREATE INDEX "BOM_status_idx" ON "BOM"("status");
CREATE INDEX "BOM_productAssetId_idx" ON "BOM"("productAssetId");
CREATE INDEX "BOM_orderId_idx" ON "BOM"("orderId");
CREATE INDEX "BOM_quotationId_idx" ON "BOM"("quotationId");
CREATE INDEX "BOM_bomNumber_idx" ON "BOM"("bomNumber");

-- CreateIndex (BOMLine)
CREATE INDEX "BOMLine_bomId_idx" ON "BOMLine"("bomId");
CREATE INDEX "BOMLine_materialCode_idx" ON "BOMLine"("materialCode");
CREATE INDEX "BOMLine_materialType_idx" ON "BOMLine"("materialType");
CREATE INDEX "BOMLine_category_idx" ON "BOMLine"("category");

-- CreateIndex (CostEstimate)
CREATE INDEX "CostEstimate_bomId_idx" ON "CostEstimate"("bomId");
CREATE INDEX "CostEstimate_costType_idx" ON "CostEstimate"("costType");

-- AddForeignKey
ALTER TABLE "BOMLine" ADD CONSTRAINT "BOMLine_bomId_fkey"
    FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE CASCADE;

ALTER TABLE "CostEstimate" ADD CONSTRAINT "CostEstimate_bomId_fkey"
    FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE CASCADE;
