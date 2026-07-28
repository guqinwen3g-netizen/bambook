-- CreateTable
CREATE TABLE "ProjectMemory" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "timestamp" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    "source" TEXT DEFAULT 'ARCHITECT',
    "status" TEXT DEFAULT 'STABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "factoryName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "quoteAmount" DOUBLE PRECISION NOT NULL,
    "updatedAt" BIGINT,
    "deletedAt" BIGINT,
    "poNumber" TEXT,
    "customerCode" TEXT,
    "season" TEXT,
    "poDate" TEXT,
    "contactPerson" TEXT,
    "contactPhone" TEXT,
    "currency" TEXT,
    "deliveryTerms" TEXT,
    "paymentTerms" TEXT,
    "shipToName" TEXT,
    "shipToAddress1" TEXT,
    "shipToAddress2" TEXT,
    "shipToCountry" TEXT,
    "shipToPhone" TEXT,
    "deliverTo" TEXT,
    "totalNet" DOUBLE PRECISION,
    "totalActual" DOUBLE PRECISION,
    "source" TEXT,
    "importedAt" BIGINT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "styleNo" TEXT,
    "materialCode" TEXT,
    "materialName" TEXT,
    "color" TEXT,
    "variantSize" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "pricePerUnit" DOUBLE PRECISION,
    "totalPrice" DOUBLE PRECISION,
    "deliveryDate" TEXT,
    "season" TEXT,
    "referencePoNumber" TEXT,
    "shippingMark" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isOrganization" BOOLEAN NOT NULL,
    "parentId" TEXT,
    "reportsToId" TEXT,
    "role" TEXT,
    "department" TEXT,
    "tags" TEXT[],
    "contactInfo" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastInteraction" BIGINT NOT NULL,
    "preferences" TEXT,
    "deletedAt" BIGINT,

    CONSTRAINT "Relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAsset" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mainCategory" TEXT NOT NULL,
    "subCategoryId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "techPackUrl" TEXT,
    "imageUrl" TEXT,
    "cost" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "ProductAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSubCategory" (
    "id" TEXT NOT NULL,
    "mainCategory" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "ProductSubCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "importance" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" BIGINT,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMemory_layer_idx" ON "ProjectMemory"("layer");

-- CreateIndex
CREATE INDEX "ProjectMemory_type_idx" ON "ProjectMemory"("type");

-- CreateIndex
CREATE INDEX "KnowledgeItem_category_idx" ON "KnowledgeItem"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Order_poNumber_key" ON "Order"("poNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_factoryName_idx" ON "Order"("factoryName");

-- CreateIndex
CREATE INDEX "Order_customerCode_idx" ON "Order"("customerCode");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "Relation_category_idx" ON "Relation"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAsset_sku_key" ON "ProductAsset"("sku");

-- CreateIndex
CREATE INDEX "ProductAsset_sku_idx" ON "ProductAsset"("sku");

-- CreateIndex
CREATE INDEX "ProductAsset_season_idx" ON "ProductAsset"("season");

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
