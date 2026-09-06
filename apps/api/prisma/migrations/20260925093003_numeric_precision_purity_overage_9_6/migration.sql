-- PREC-MIG-C — pureza e overage para DECIMAL(9,6).
--
-- BACKLOG #19 / PRODUCT_RULES.md §58: PERCENTAGE (pureza/overage) em
-- `DECIMAL(9,6)`. Um laudo de ensaio entrega 99,9995% de pureza; em
-- `DECIMAL(6,3)` o PostgreSQL arredondava isso para `100.000` na hora de
-- gravar, sem aviso — o operador digitava um número e o banco guardava outro,
-- e "100% puro" é uma afirmação diferente da que o laudo faz. O mesmo corte
-- zerava um overage de 0,000001%.
--
-- Medido contra este servidor antes da migration:
--   99.9995    ::decimal(6,3) -> 100.000     ::decimal(9,6) -> 99.999500
--   99.999999  ::decimal(6,3) -> 100.000     ::decimal(9,6) -> 99.999999
--   98.123456  ::decimal(6,3) -> 98.123      ::decimal(9,6) -> 98.123456
--   0.000001   ::decimal(6,3) -> 0.000       ::decimal(9,6) -> 0.000001
--
-- SOMENTE widening de precisão. Zero backfill, zero UPDATE, zero recálculo.
-- A parte inteira NÃO muda — três dígitos em `6,3` e três dígitos em `9,6` —,
-- então nenhum valor existente pode estourar: só o scale cresce, de 3 para 6
-- casas. `98.500` continua matematicamente `98.500000`; a representação ganha
-- zeros à direita e mais nada. Casa que nunca foi persistida não se
-- reconstrói, e nenhuma Formulação, FormulaVersion, OP, ProductionOrderRequirement
-- ou snapshot histórico é recalculado por esta migration.
--
-- O range de negócio NÃO muda com o tipo. Pureza continua `0 < x <= 100` e
-- overage continua `>= 0`, validados na fronteira da API; o schema suportar
-- 999,999999 não é autorização para gravar 999.
--
-- Acima de 6 casas o PostgreSQL voltaria a arredondar em silêncio
-- (`99.9999999` -> `100.000000`), então a validação da API recusa antes de
-- chegar aqui, em vez de deixar o banco decidir.
--
-- O diff gerado pelo Prisma trazia junto o drift conhecido de BACKLOG #14
-- (chaves estrangeiras RESTRICT/SET NULL, renomeação de índices e
-- constraints). Todos foram removidos na revisão linha a linha exigida por
-- TECH_BASELINE.md, "Migration order". Esta migration não os aplica.
--
-- FORA desta migration, de propósito — são outra categoria, não PURITY/OVERAGE:
--   percentuais comerciais em 7,4 (desconto, margem, imposto)   PERCENTAGE comercial
--   composição de custo e de CMV em 14,4 e 14,6                 PREC-MIG-D residual
--   PurchaseOrderLine.unitPrice e demais UNIT_PRICE             PREC-MIG-P

ALTER TABLE "items" ALTER COLUMN "defaultPurityPercent" SET DATA TYPE DECIMAL(9,6);

ALTER TABLE "formulation_components" ALTER COLUMN "purityPercentApplied" SET DATA TYPE DECIMAL(9,6);
ALTER TABLE "formulation_components" ALTER COLUMN "overagePercent" SET DATA TYPE DECIMAL(9,6);

ALTER TABLE "production_order_requirements" ALTER COLUMN "purityPercentApplied" SET DATA TYPE DECIMAL(9,6);
ALTER TABLE "production_order_requirements" ALTER COLUMN "overagePercent" SET DATA TYPE DECIMAL(9,6);

ALTER TABLE "formulation_template_components" ALTER COLUMN "purityPercentApplied" SET DATA TYPE DECIMAL(9,6);
ALTER TABLE "formulation_template_components" ALTER COLUMN "overagePercent" SET DATA TYPE DECIMAL(9,6);
