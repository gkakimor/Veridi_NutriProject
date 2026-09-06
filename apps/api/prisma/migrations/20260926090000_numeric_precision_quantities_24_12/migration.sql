-- PREC-MIG-A — quantidades e grandezas técnicas inequívocas para DECIMAL(24,12).
--
-- BACKLOG #19: `Decimal(18,6)` zerava quantidade física derivada em
-- microdosagem. O componente MP-000147 declara 0,000048 kg sobre base 1000;
-- produzir de 1 a 10 unidades dá 4,8e-8 a 4,8e-7 kg, e `requiredQuantity`
-- persistia 0,000000 — a Ordem de Produção afirmava que o material não era
-- necessário. Matriz de tipos em PRODUCT_RULES.md §58.
--
-- SOMENTE widening de precisão. Zero backfill, zero UPDATE, zero recálculo.
-- Ampliar o scale preserva o valor existente e o reescreve com zeros à
-- direita: 0.123457 vira 0.123457000000. A parte inteira NÃO muda — 18,6 e
-- 24,12 comportam os mesmos 12 dígitos inteiros —, então nenhum valor
-- existente pode estourar.
--
-- O diff gerado pelo Prisma trazia junto 86 blocos de drift conhecido
-- (BACKLOG #14: chaves estrangeiras RESTRICT/SET NULL, renomeação de índices
-- e constraints). Todos foram removidos na revisão linha a linha exigida por
-- TECH_BASELINE.md, "Migration order". Esta migration não os aplica.
--
-- FORA desta migration, de propósito:
--   FormulationComponent.legacyTotalQuantity  — dado importado do legado
--   FormulationComponent.legacyBatchUnits     — dado importado do legado
--   QuoteLine.industrialCostPerUnitSnapshot   — inventário classifica como
--     PREC-MIG-B junto dos demais snapshots de precificação da QuoteLine

ALTER TABLE "billing_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "customer_order_lines" ALTER COLUMN "orderedQuantity" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "agreedPricingTierQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "customer_order_reservation_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "formulation_components" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "formulation_template_components" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "formulation_template_versions" ALTER COLUMN "basisQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "formulation_versions" ALTER COLUMN "basisQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "industrial_cost_calculations" ALTER COLUMN "costPerUnit" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "referenceOutputQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "industrial_cost_resource_usages" ALTER COLUMN "usageQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "industrial_cost_template_resource_usages" ALTER COLUMN "usageQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "industrial_cost_template_versions" ALTER COLUMN "referenceOutputQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "industrial_cost_versions" ALTER COLUMN "referenceOutputQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "inventory_movements" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "lots" ALTER COLUMN "initialReceivedQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "material_reservation_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "pricing_policy_template_tiers" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "pricing_tiers" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "costPerUnitSnapshot" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "production_consumptions" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "production_order_cost_snapshots" ALTER COLUMN "producedQuantity" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "costPerProducedUnit" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "production_order_requirements" ALTER COLUMN "formulaQuantity" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "requiredQuantity" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "theoreticalQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "production_orders" ALTER COLUMN "plannedQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "production_outputs" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "products" ALTER COLUMN "doseAmount" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "minimumBatchQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "project_samples" ALTER COLUMN "outputQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "projects" ALTER COLUMN "doseAmount" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "minimumBatchQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "purchase_order_lines" ALTER COLUMN "orderedQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "quote_lines" ALTER COLUMN "quotedQuantity" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "pricingTierQuantitySnapshot" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "receipt_lines" ALTER COLUMN "receivedQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "recipe_weighings" ALTER COLUMN "plannedQuantitySnapshot" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "actualQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "sample_consumptions" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "shipment_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "supplier_item_offers" ALTER COLUMN "minimumOrderQuantity" SET DATA TYPE DECIMAL(24,12);

ALTER TABLE "units_of_measure" ALTER COLUMN "toBaseFactor" SET DATA TYPE DECIMAL(24,12);
