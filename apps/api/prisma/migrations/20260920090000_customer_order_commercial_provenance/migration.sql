-- Proveniência comercial do Pedido: de qual proposta aceita ele nasceu.
--
-- Tudo aditivo e anulável. Pedido digitado direto continua válido com origem
-- nula, e todo Pedido anterior a esta migração permanece íntegro.
--
-- O UNIQUE em "sourceQuoteVersionId" é o invariante no banco: uma proposta
-- aceita origina no máximo um Pedido. Postgres admite vários NULL num índice
-- único, então os Pedidos manuais não colidem entre si.
--
-- As FKs usam ON DELETE SET NULL: apagar uma proposta jamais pode apagar o
-- Pedido que ela originou. Os campos de código guardam a identidade da origem
-- em texto, de modo que ela continue legível mesmo se o vínculo se perder.

ALTER TABLE "customer_orders"
  ADD COLUMN "sourceQuoteVersionId" TEXT,
  ADD COLUMN "sourceProjectId" TEXT,
  ADD COLUMN "sourceQuoteCode" TEXT,
  ADD COLUMN "sourceQuoteVersionNumber" INTEGER,
  ADD COLUMN "sourceProjectCode" TEXT,
  ADD COLUMN "agreedSubtotalAmount" DECIMAL(14,2),
  ADD COLUMN "agreedDiscountPercent" DECIMAL(7,4),
  ADD COLUMN "agreedTotalAmount" DECIMAL(14,2),
  ADD COLUMN "agreedPaymentSchedule" JSONB;

CREATE UNIQUE INDEX "customer_orders_sourceQuoteVersionId_key"
  ON "customer_orders"("sourceQuoteVersionId");

CREATE INDEX "customer_orders_sourceProjectId_idx"
  ON "customer_orders"("sourceProjectId");

ALTER TABLE "customer_orders"
  ADD CONSTRAINT "customer_orders_sourceQuoteVersionId_fkey"
  FOREIGN KEY ("sourceQuoteVersionId") REFERENCES "quote_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_orders"
  ADD CONSTRAINT "customer_orders_sourceProjectId_fkey"
  FOREIGN KEY ("sourceProjectId") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Preço acordado e sua origem, por linha. O Pedido nunca recalcula preço:
-- precificação ou cálculo de custo novos não reescrevem o que foi aceito.
ALTER TABLE "customer_order_lines"
  ADD COLUMN "sourceQuoteLineId" TEXT,
  ADD COLUMN "agreedUnitPrice" DECIMAL(14,4),
  ADD COLUMN "agreedPriceSource" "QuotePriceSource",
  ADD COLUMN "agreedPricingVersionId" TEXT,
  ADD COLUMN "agreedPricingTierId" TEXT,
  ADD COLUMN "agreedPricingCode" TEXT,
  ADD COLUMN "agreedPricingVersionNumber" INTEGER,
  ADD COLUMN "agreedPricingTierQuantity" DECIMAL(18,6),
  ADD COLUMN "agreedPricingTierUom" TEXT;

CREATE UNIQUE INDEX "customer_order_lines_sourceQuoteLineId_key"
  ON "customer_order_lines"("sourceQuoteLineId");

ALTER TABLE "customer_order_lines"
  ADD CONSTRAINT "customer_order_lines_sourceQuoteLineId_fkey"
  FOREIGN KEY ("sourceQuoteLineId") REFERENCES "quote_lines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_order_lines"
  ADD CONSTRAINT "customer_order_lines_agreedPricingVersionId_fkey"
  FOREIGN KEY ("agreedPricingVersionId") REFERENCES "pricing_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_order_lines"
  ADD CONSTRAINT "customer_order_lines_agreedPricingTierId_fkey"
  FOREIGN KEY ("agreedPricingTierId") REFERENCES "pricing_tiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
