-- Migration: InvoiceAllocation + PaymentVoucher.status (task_mqxwgafj)
-- 1) PaymentVoucher.status 字段：核销状态（unreconciled/partially_reconciled/reconciled）
-- 2) InvoiceAllocation 中间表：1:N 销销账地基（硬删除语义，调整=delete+insert）

-- 1) Add status column to PaymentVoucher
ALTER TABLE "PaymentVoucher" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'unreconciled';
CREATE INDEX "PaymentVoucher_status_idx" ON "PaymentVoucher"("status");

-- 2) Create InvoiceAllocation table (硬删除，无 deletedAt)
CREATE TABLE "InvoiceAllocation" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "appliedAmount" DECIMAL(18,4) NOT NULL,
    "appliedDate" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,

    CONSTRAINT "InvoiceAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceAllocation_invoiceId_voucherId_key" ON "InvoiceAllocation"("invoiceId", "voucherId");
CREATE INDEX "InvoiceAllocation_invoiceId_idx" ON "InvoiceAllocation"("invoiceId");
CREATE INDEX "InvoiceAllocation_voucherId_idx" ON "InvoiceAllocation"("voucherId");
