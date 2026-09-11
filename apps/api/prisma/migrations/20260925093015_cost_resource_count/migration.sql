-- COST-RESOURCE-MULTIPLIER-01 (PRODUCT_RULES §87): quantidade de recursos
-- equivalentes na linha de recurso da Estrutura de Custos e do Modelo de
-- Estrutura. Aditiva: toda linha existente nasce 1, e 1 x uso = o mesmo uso —
-- nenhum custo existente muda, e nenhuma contagem historica e inferida.

-- AlterTable
ALTER TABLE "industrial_cost_resource_usages" ADD COLUMN     "resourceCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "industrial_cost_template_resource_usages" ADD COLUMN     "resourceCount" INTEGER NOT NULL DEFAULT 1;

-- Inteiro, no minimo 1: zero ou negativo nao significam "nenhum recurso" —
-- recurso nao usado simplesmente nao entra na estrutura.
ALTER TABLE "industrial_cost_resource_usages"
  ADD CONSTRAINT "industrial_cost_resource_usages_resource_count_check" CHECK ("resourceCount" >= 1);
ALTER TABLE "industrial_cost_template_resource_usages"
  ADD CONSTRAINT "industrial_cost_template_resource_usages_resource_count_check" CHECK ("resourceCount" >= 1);
