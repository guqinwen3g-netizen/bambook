/*
  Warnings:

  - You are about to drop the column `color` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `materialName` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `pricePerUnit` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `referencePoNumber` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `season` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `shippingMark` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `styleNo` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `totalPrice` on the `OrderLine` table. All the data in the column will be lost.
  - You are about to drop the column `variantSize` on the `OrderLine` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OrderLine" DROP COLUMN "color",
DROP COLUMN "materialName",
DROP COLUMN "pricePerUnit",
DROP COLUMN "referencePoNumber",
DROP COLUMN "season",
DROP COLUMN "shippingMark",
DROP COLUMN "styleNo",
DROP COLUMN "totalPrice",
DROP COLUMN "variantSize",
ADD COLUMN     "category" TEXT,
ADD COLUMN     "cloth" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "exMillDate" TEXT,
ADD COLUMN     "itemNo" TEXT,
ADD COLUMN     "millQuality" TEXT,
ADD COLUMN     "netValue" DOUBLE PRECISION,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "unitPrice" DOUBLE PRECISION,
ADD COLUMN     "via" TEXT,
ADD COLUMN     "weight" TEXT,
ADD COLUMN     "width" TEXT;
