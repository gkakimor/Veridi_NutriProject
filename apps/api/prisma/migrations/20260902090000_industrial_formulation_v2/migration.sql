-- Capacidade 34 — Formulação Industrial v2 (dose, pureza e overage).
--
-- A fórmula real da Veridi é declarada POR DOSE, e o peso que a fábrica
-- coloca na balança é a necessidade teórica corrigida pela pureza do insumo
-- e pelo overage de processo. O modelo FIXED_BASIS original continua
-- válido: colunas novas são nullable e os defaults preservam exatamente o
-- comportamento das versões já existentes.

CREATE TYPE "FormulationCalculationMode" AS ENUM ('FIXED_BASIS', 'PER_DOSE');

-- Uma versão PER_DOSE tem ingredientes por dose E embalagem por unidade
-- acabada: a base é declarada por COMPONENTE, sem engine de expressão.
CREATE TYPE "FormulationComponentBasis" AS ENUM ('FIXED_BASIS', 'PER_DOSE', 'PER_FINISHED_UNIT');

ALTER TABLE "formulation_versions"
  ADD COLUMN "calculationMode" "FormulationCalculationMode" NOT NULL DEFAULT 'FIXED_BASIS';
ALTER TABLE "formulation_versions" ADD COLUMN "dosesPerPackage" INTEGER;

ALTER TABLE "formulation_components"
  ADD COLUMN "basis" "FormulationComponentBasis" NOT NULL DEFAULT 'FIXED_BASIS';

-- Pureza aplicada é SNAPSHOT da formulação: alterar `Item.defaultPurityPercent`
-- depois nunca reescreve uma versão existente. NULL = desconhecida, e nesse
-- caso nenhuma correção é aplicada (nunca se assume 100% implicitamente).
ALTER TABLE "formulation_components" ADD COLUMN "purityPercentApplied" DECIMAL(6,3);
ALTER TABLE "formulation_components" ADD COLUMN "overagePercent" DECIMAL(6,3);

-- Referência histórica da planilha; nunca participa do cálculo.
ALTER TABLE "formulation_components" ADD COLUMN "legacyTotalQuantity" DECIMAL(18,6);
ALTER TABLE "formulation_components" ADD COLUMN "legacyTotalUnitCode" TEXT;
ALTER TABLE "formulation_components" ADD COLUMN "legacyBatchUnits" DECIMAL(18,6);

-- A necessidade da OP passa a congelar também o teórico e os fatores
-- aplicados, para auditoria: o "por quê" do peso fica no documento.
ALTER TABLE "production_order_requirements" ADD COLUMN "theoreticalQuantity" DECIMAL(18,6);
ALTER TABLE "production_order_requirements" ADD COLUMN "purityPercentApplied" DECIMAL(6,3);
ALTER TABLE "production_order_requirements" ADD COLUMN "overagePercent" DECIMAL(6,3);

-- Complemento da capacidade 33: chave do sistema legado para reconciliar a
-- importação das planilhas. Não substitui o código interno (CLI-/MP-/…).
ALTER TABLE "customers" ADD COLUMN "externalCode" TEXT;
ALTER TABLE "items" ADD COLUMN "externalCode" TEXT;

-- Índices de reconciliação. NÃO são UNIQUE: o validador do corpus reporta
-- duplicidades reais antes de qualquer decisão de unicidade.
CREATE INDEX "customers_externalCode_idx" ON "customers"("externalCode");
CREATE INDEX "items_externalCode_idx" ON "items"("externalCode");
