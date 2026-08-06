-- Phase 2: 报价管理 Quotation Management
-- 外贸「接单起点」：报价单是订单的前置环节，accepted 状态可转为 Order

-- Quotation: 报价单头（客户、币种、金额、条款、有效期）
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "exchangeRate" DECIMAL(18,4),
    "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "customerRelationId" TEXT,
    "customerName" TEXT,
    "customerCode" TEXT,
    "issueDate" TEXT NOT NULL,
    "validUntil" TEXT,
    "deliveryTerms" TEXT,
    "paymentTerms" TEXT,
    "salesperson" TEXT,
    "inquiryRef" TEXT,
    "convertedOrderId" TEXT,
    "notes" TEXT,
    "attachments" JSONB,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "deletedAt" BIGINT,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");
CREATE INDEX "Quotation_customerRelationId_idx" ON "Quotation"("customerRelationId");
CREATE INDEX "Quotation_issueDate_idx" ON "Quotation"("issueDate");
CREATE INDEX "Quotation_validUntil_idx" ON "Quotation"("validUntil");

-- QuotationLine: 报价行明细（面料、数量、单价、金额）
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "fabricCode" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");
CREATE INDEX "QuotationLine_fabricCode_idx" ON "QuotationLine"("fabricCode");

-- 外键约束：行级联删除（报价单删除时行一并删除）
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey"
    FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE;
