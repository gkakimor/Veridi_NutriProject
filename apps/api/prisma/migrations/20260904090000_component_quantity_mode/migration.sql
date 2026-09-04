-- Quantidade fisica canonica do componente: modo explicito e flags de ajuste.
--
-- O motor JA aplica pureza e overage (lib/formulation-math.ts). O que faltava
-- era dizer, no dado, se a quantidade declarada e teorica ou ja fisica — duas
-- semanticas que convivem hoje e sao indistinguiveis pelo valor.
--
-- O BACKFILL ESPELHA O COMPORTAMENTO DO MOTOR, nao a presenca do campo.
-- `applyPurityAndOverage` aplica pureza quando `purity IS NOT NULL AND
-- purity > 0`, e aplica overage quando `overage IS NOT NULL AND overage >= 0`.
-- Reproduzir exatamente essas duas condicoes e o que garante que nenhuma
-- receita mude de resultado: usar "campo preenchido" trataria pureza = 0 como
-- ativa, e ela nao e.
--
-- Componentes sem ajuste algum vao para PHYSICAL_DIRECT, onde a quantidade
-- declarada ja e a fisica. Os que recebem ajuste hoje vao para
-- THEORETICAL_WITH_ADJUSTMENTS com as flags correspondentes, preservando a
-- necessidade fisica atual — que em cinco formulacoes ativas chega a ser 2,4x
-- a quantidade declarada. Baixar isso silenciosamente faria a fabrica separar
-- menos material do que a receita exige.

CREATE TYPE "FormulationComponentQuantityMode" AS ENUM ('PHYSICAL_DIRECT', 'THEORETICAL_WITH_ADJUSTMENTS');

ALTER TABLE "formulation_components"
  ADD COLUMN "quantityMode" "FormulationComponentQuantityMode" NOT NULL DEFAULT 'PHYSICAL_DIRECT',
  ADD COLUMN "applyPurityAdjustment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "applyOverageAdjustment" BOOLEAN NOT NULL DEFAULT false;

-- Flags primeiro, cada uma com a condicao do motor.
UPDATE "formulation_components"
   SET "applyPurityAdjustment" = true
 WHERE "purityPercentApplied" IS NOT NULL
   AND "purityPercentApplied" > 0;

UPDATE "formulation_components"
   SET "applyOverageAdjustment" = true
 WHERE "overagePercent" IS NOT NULL
   AND "overagePercent" >= 0;

-- O modo deriva das flags: quem recebe algum ajuste tem quantidade teorica.
UPDATE "formulation_components"
   SET "quantityMode" = 'THEORETICAL_WITH_ADJUSTMENTS'
 WHERE "applyPurityAdjustment" = true
    OR "applyOverageAdjustment" = true;
