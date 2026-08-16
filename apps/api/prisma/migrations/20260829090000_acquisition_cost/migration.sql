-- Effective acquisition cost per stock unit, captured at receiving.
-- NEVER auto-copied from PurchaseOrderLine.unitPrice (that is only the
-- expected/negotiated price) and never confused with an actual payment
-- (future financial layer). NULL means unknown; 0 is an explicitly
-- informed value and must never be reinterpreted as unknown.
ALTER TABLE "receipt_lines" ADD COLUMN "actualUnitCost" DECIMAL(14,4);
ALTER TABLE "receipt_lines" ADD COLUMN "costUpdatedAt" TIMESTAMP(3);
ALTER TABLE "receipt_lines" ADD COLUMN "costUpdatedBy" TEXT;
ALTER TABLE "receipt_lines" ADD COLUMN "costNote" TEXT;

-- Feeds the weighted-average cost windows (30d/90d/last real cost), which
-- filter on rows where the cost is actually known.
CREATE INDEX "receipt_lines_itemId_actualUnitCost_idx" ON "receipt_lines"("itemId", "actualUnitCost");

-- No data backfill: copying PO prices into real costs would violate the
-- price != cost != payment semantics.
