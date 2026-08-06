-- CreateEnum (procurement 状态枚举由应用层管理，DB 用 TEXT)

-- CreateTable: PurchaseOrder
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "supplierRelationId" TEXT,
    "supplierName" TEXT,
    "supplierCode" TEXT,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "exchangeRate" DECIMAL(18,4),
    "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "orderDate" TEXT NOT NULL,
    "expectedDeliveryDate" TEXT,
    "actualDeliveryDate" TEXT,
    "deliveryTerms" TEXT,
    "paymentTerms" TEXT,
    "shipToAddress" TEXT,
    "orderId" TEXT,
    "quotationId" TEXT,
    "bomId" TEXT,
    "buyer" TEXT,
    "notes" TEXT,
    "attachments" JSONB,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseLine
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "materialCode" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "specification" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "receivedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MaterialReceipt
CREATE TABLE "MaterialReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedDate" TEXT NOT NULL,
    "receivedBy" TEXT,
    "inspectedBy" TEXT,
    "inspectionDate" TEXT,
    "warehouseId" TEXT,
    "warehouseName" TEXT,
    "totalReceived" DECIMAL(18,4) NOT NULL,
    "totalAccepted" DECIMAL(18,4) NOT NULL,
    "totalRejected" DECIMAL(18,4) NOT NULL,
    "rejectionReason" TEXT,
    "qualityNotes" TEXT,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "MaterialReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
CREATE INDEX "PurchaseOrder_supplierRelationId_idx" ON "PurchaseOrder"("supplierRelationId");
CREATE INDEX "PurchaseOrder_poNumber_idx" ON "PurchaseOrder"("poNumber");
CREATE INDEX "PurchaseOrder_orderDate_idx" ON "PurchaseOrder"("orderDate");
CREATE INDEX "PurchaseOrder_orderId_idx" ON "PurchaseOrder"("orderId");

CREATE INDEX "PurchaseLine_purchaseOrderId_idx" ON "PurchaseLine"("purchaseOrderId");
CREATE INDEX "PurchaseLine_materialCode_idx" ON "PurchaseLine"("materialCode");

CREATE INDEX "MaterialReceipt_purchaseOrderId_idx" ON "MaterialReceipt"("purchaseOrderId");
CREATE INDEX "MaterialReceipt_status_idx" ON "MaterialReceipt"("status");
CREATE INDEX "MaterialReceipt_receivedDate_idx" ON "MaterialReceipt"("receivedDate");

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE;

ALTER TABLE "MaterialReceipt" ADD CONSTRAINT "MaterialReceipt_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE;
