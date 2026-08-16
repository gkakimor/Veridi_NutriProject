-- Reallocation can split the remaining quantity across several lots, so one
-- original reservation line may be replaced by N new lines — drop the unique
-- constraint in favour of a plain index (1:N instead of 1:1).
DROP INDEX IF EXISTS "customer_order_reservation_lines_replacesLineId_key";
CREATE INDEX IF NOT EXISTS "customer_order_reservation_lines_replacesLineId_idx" ON "customer_order_reservation_lines"("replacesLineId");
