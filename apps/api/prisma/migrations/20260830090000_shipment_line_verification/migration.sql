-- Physical lot verification on the shipment line, done while the shipment is
-- still DRAFT. This is audit only: verifying a lot never creates an
-- InventoryMovement and never changes On Hand / Reserved / Available. The
-- physical write-off keeps happening exclusively on shipment confirmation.
--
-- Deliberately NOT a generic ScanEvent table: the fact being recorded is
-- "this shipment line had its lot physically verified", which belongs to the
-- line itself.
ALTER TABLE "shipment_lines" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "shipment_lines" ADD COLUMN "verifiedBy" TEXT;

-- No backfill: shipments confirmed before this feature were verified by the
-- operator outside the system, and inventing a verification timestamp would
-- fake an audit trail that never happened.
