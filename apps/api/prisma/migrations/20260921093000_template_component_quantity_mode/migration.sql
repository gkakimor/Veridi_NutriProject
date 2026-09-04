-- Era 20260904093000_template_component_quantity_mode. Renomeada em
-- 2026-09-04 porque altera "formulation_template_components", criada so em
-- 20260921090000_formulation_templates: num banco VAZIO, que aplica na ordem
-- dos nomes, ela rodava antes da tabela existir e quebrava a reconstrucao.
-- O conteudo e o mesmo; so ganhou IF NOT EXISTS nas colunas para ser
-- idempotente. Em banco onde ja rodou com o nome antigo (producao, dev), o
-- `migrate deploy` aplica este nome uma vez como no-op — nenhuma coluna e
-- recriada, nenhum dado e tocado — e a linha antiga em _prisma_migrations
-- pode ficar ou ser removida numa limpeza coordenada; o Prisma tolera as duas.
--
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
  ADD COLUMN IF NOT EXISTS "quantityMode" "FormulationComponentQuantityMode" NOT NULL DEFAULT 'PHYSICAL_DIRECT',
  ADD COLUMN IF NOT EXISTS "applyPurityAdjustment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "applyOverageAdjustment" BOOLEAN NOT NULL DEFAULT false;
