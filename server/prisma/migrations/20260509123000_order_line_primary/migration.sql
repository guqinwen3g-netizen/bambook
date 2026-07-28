-- Promote OrderLine into the line-level follow-up entity used by Order Management.
ALTER TABLE "OrderLine" ADD COLUMN "status" TEXT DEFAULT 'Pending';
ALTER TABLE "OrderLine" ADD COLUMN "productionBatch" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shippingDate" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shippingMethod" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "invoiceDate" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shipmentQuantity" DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "shipmentAmount" DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "actualPaymentDate" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "actualPaymentAmount" DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "specialInstructions" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "fieldSources" JSONB;

CREATE INDEX "OrderLine_status_idx" ON "OrderLine"("status");
CREATE UNIQUE INDEX "OrderLine_orderId_itemNo_key" ON "OrderLine"("orderId", "itemNo");
