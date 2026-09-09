-- CreateEnum
CREATE TYPE "QuotePriceOrigin" AS ENUM ('INHERITED_AGREEMENT', 'ADJUSTED_AGREEMENT', 'CURRENT_PRICING', 'MANUAL');

-- AlterTable
ALTER TABLE "quote_lines" ADD COLUMN     "adjustmentPercent" DECIMAL(7,4),
ADD COLUMN     "inheritedFromQuoteLineId" TEXT,
ADD COLUMN     "priceOrigin" "QuotePriceOrigin",
ADD COLUMN     "priceOriginReason" TEXT;

-- CreateIndex
CREATE INDEX "quote_lines_inheritedFromQuoteLineId_idx" ON "quote_lines"("inheritedFromQuoteLineId");

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_inheritedFromQuoteLineId_fkey" FOREIGN KEY ("inheritedFromQuoteLineId") REFERENCES "quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
