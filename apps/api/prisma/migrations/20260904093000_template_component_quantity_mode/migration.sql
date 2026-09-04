-- O template de formulacao carrega a CONFIGURACAO tecnica do componente.
--
-- Sem modo e flags, aplicar um template produzia sempre um componente
-- PHYSICAL_DIRECT, e a intencao de "esta quantidade e teorica, corrija pela
-- pureza" se perdia na copia — o oposto do que um template serve para fazer.
--
-- O default espelha o do componente: PHYSICAL_DIRECT com os dois ajustes
-- desligados. Templates existentes nao mudam de comportamento, porque nenhum
-- deles carregava autorizacao de ajuste antes desta coluna existir.

ALTER TABLE "formulation_template_components"
  ADD COLUMN "quantityMode" "FormulationComponentQuantityMode" NOT NULL DEFAULT 'PHYSICAL_DIRECT',
  ADD COLUMN "applyPurityAdjustment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "applyOverageAdjustment" BOOLEAN NOT NULL DEFAULT false;
