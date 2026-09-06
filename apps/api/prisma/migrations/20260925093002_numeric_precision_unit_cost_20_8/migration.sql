-- PREC-MIG-B — custo unitário para DECIMAL(20,8).
--
-- BACKLOG #19 / PRODUCT_RULES.md §58: UNIT_COST em `DECIMAL(20,8)`. Quatro
-- casas em reais bastam para insumo comprado por quilo; para insumo comprado
-- por grama ou miligrama, quatro casas na unidade pequena são grosseiras, e
-- `ReceiptLine.actualUnitCost` é a origem de TODO custo real do sistema — média
-- ponderada 30d/90d, último custo real e custo do lote consumido saem dele.
--
-- SOMENTE widening de precisão. Zero backfill, zero UPDATE, zero recálculo.
-- A parte inteira CRESCE de 10 para 12 dígitos (14,4 -> 20,8), então nenhum
-- valor existente pode estourar; o valor gravado permanece o mesmo e passa a
-- ser reescrito com zeros à direita.
--
-- O diff gerado pelo Prisma trazia junto 86 blocos de drift conhecido
-- (BACKLOG #14: chaves estrangeiras RESTRICT/SET NULL, renomeação de índices e
-- constraints). Todos foram removidos na revisão linha a linha exigida por
-- TECH_BASELINE.md, "Migration order". Esta migration não os aplica.
--
-- FORA desta migration, de propósito — são outra categoria, não UNIT_COST:
--   PurchaseOrderLine.unitPrice      UNIT_PRICE      — aguarda decisão própria
--   QuoteLine.unitPrice              UNIT_PRICE      — contratual, §58
--   CustomerOrderLine.agreedUnitPrice, BillingLine.*  UNIT_PRICE contratual
--   IndustrialResourceRate.rateValue e demais rateValue  RATE
--   PricingTier.manualUnitPrice e snapshots de preço  UNIT_PRICE técnico
--   composição de custo e de CMV em 14,4              TECHNICAL_RESULT, PREC-MIG-D

ALTER TABLE "item_cost_references" ALTER COLUMN "unitCost" SET DATA TYPE DECIMAL(20,8);

ALTER TABLE "receipt_lines" ALTER COLUMN "actualUnitCost" SET DATA TYPE DECIMAL(20,8);

ALTER TABLE "supplier_item_offers" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(20,8);
