-- AlterTable
ALTER TABLE "DevelopmentCase" ADD COLUMN     "fabricSpec" TEXT,
ADD COLUMN     "processSpec" TEXT,
ADD COLUMN     "sampleInvoiceId" TEXT,
ADD COLUMN     "sampleRecipientAddress" TEXT,
ADD COLUMN     "sampleRecipientCompany" TEXT,
ADD COLUMN     "sampleRecipientName" TEXT,
ADD COLUMN     "sampleRecipientPhone" TEXT,
ADD COLUMN     "sampleShippingFee" DOUBLE PRECISION,
ADD COLUMN     "sizeSpec" TEXT,
ADD COLUMN     "styleSpec" TEXT;

-- AlterTable
ALTER TABLE "FabricShipmentSample" ADD COLUMN     "shippingFee" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SampleCardItem" ADD COLUMN     "availableQty" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "devCaseId" TEXT,
ADD COLUMN     "maxStock" INTEGER,
ADD COLUMN     "minStock" INTEGER,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "productAssetId" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unit" TEXT DEFAULT '张',
ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "SampleCardLoan" ADD COLUMN     "loanQuantity" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SupplierInquiry" (
    "id" TEXT NOT NULL,
    "inquiryNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "materialCode" TEXT,
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "currency" TEXT NOT NULL,
    "expectedDeliveryDate" TEXT,
    "orderId" TEXT,
    "bomId" TEXT,
    "buyer" TEXT,
    "supplierQuotes" JSONB,
    "selectedSupplierId" TEXT,
    "selectedSupplierName" TEXT,
    "decisionNote" TEXT,
    "notes" TEXT,
    "attachments" JSONB,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "SupplierInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInquiry_inquiryNumber_key" ON "SupplierInquiry"("inquiryNumber");

-- CreateIndex
CREATE INDEX "SupplierInquiry_status_idx" ON "SupplierInquiry"("status");

-- CreateIndex
CREATE INDEX "SupplierInquiry_inquiryNumber_idx" ON "SupplierInquiry"("inquiryNumber");

-- CreateIndex
CREATE INDEX "SupplierInquiry_materialCode_idx" ON "SupplierInquiry"("materialCode");

-- CreateIndex
CREATE INDEX "SupplierInquiry_orderId_idx" ON "SupplierInquiry"("orderId");

-- CreateIndex
CREATE INDEX "SupplierInquiry_selectedSupplierId_idx" ON "SupplierInquiry"("selectedSupplierId");

-- CreateIndex
CREATE INDEX "SampleCardItem_warehouseId_idx" ON "SampleCardItem"("warehouseId");

-- CreateIndex
CREATE INDEX "SampleCardItem_devCaseId_idx" ON "SampleCardItem"("devCaseId");

-- CreateIndex
CREATE INDEX "SampleCardItem_orderId_idx" ON "SampleCardItem"("orderId");

-- CreateIndex
CREATE INDEX "SampleCardItem_productAssetId_idx" ON "SampleCardItem"("productAssetId");

