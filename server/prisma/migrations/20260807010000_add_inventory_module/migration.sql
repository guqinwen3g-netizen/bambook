-- CreateTable: Warehouse
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" TEXT,
    "manager" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryItem
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productAssetId" TEXT,
    "materialCode" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "specification" TEXT,
    "batchNumber" TEXT,
    "locationCode" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "lockedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "minStock" DECIMAL(18,4),
    "maxStock" DECIMAL(18,4),
    "lastInDate" TEXT,
    "lastOutDate" TEXT,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StockMovement
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "movementNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "targetWarehouseId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(18,4),
    "balanceBefore" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "operator" TEXT,
    "movementDate" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Warehouse
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE INDEX "Warehouse_type_idx" ON "Warehouse"("type");
CREATE INDEX "Warehouse_isActive_idx" ON "Warehouse"("isActive");

-- CreateIndex: InventoryItem
CREATE INDEX "InventoryItem_warehouseId_idx" ON "InventoryItem"("warehouseId");
CREATE INDEX "InventoryItem_productAssetId_idx" ON "InventoryItem"("productAssetId");
CREATE INDEX "InventoryItem_materialCode_idx" ON "InventoryItem"("materialCode");
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");
CREATE INDEX "InventoryItem_batchNumber_idx" ON "InventoryItem"("batchNumber");

-- CreateIndex: StockMovement
CREATE INDEX "StockMovement_itemId_idx" ON "StockMovement"("itemId");
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");
CREATE INDEX "StockMovement_warehouseId_idx" ON "StockMovement"("warehouseId");
CREATE INDEX "StockMovement_movementDate_idx" ON "StockMovement"("movementDate");
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE;
