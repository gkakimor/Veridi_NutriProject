-- PLANNING-CAPACITY-BOARD-01 (B): capacidade do recurso e programacao da OP.
--
-- Duas coisas que faltavam para o planejamento sair do papel:
--
-- 1. QUANTOS de cada recurso existem. `capacityQuantity` NULL = capacidade
--    ainda nao cadastrada, e nao zero: sem o numero o planejamento avisa a
--    lacuna em vez de acusar sobrecarga que ninguem pode conferir. O recurso
--    continua sendo POOL — "Operadores de Producao = 5" sao cinco operadores
--    quaisquer, nunca cinco cadastros de pessoa. Energia nao ocupa capacidade.
--
-- 2. QUANDO a ordem esta prevista. A agenda e snapshot por valor: alterar
--    jornada, intervalo, feriado ou recesso depois NAO reescreve o que ja foi
--    calculado. Capacidade se conta pelos `workSegments` dentro de `steps`,
--    nunca pelo envelope `plannedStartAt`..`plannedEndAt` — uma etapa que
--    comeca sexta 16:00 e termina segunda 09:00 nao ocupa a encapsuladora
--    durante o fim de semana.
--
-- ADITIVA e SEM BACKFILL: nenhuma OP existente ganha agenda, nenhum recurso
-- ganha capacidade. Nada de custo, estoque, reserva, formulacao, faturamento
-- ou promessa de entrega e tocado. `plannedAt` da OP continua sendo o carimbo
-- do ato de planejar, e nao foi reaproveitado.

-- AlterTable
ALTER TABLE "industrial_resources" ADD COLUMN     "capacityQuantity" INTEGER;

-- CreateTable
CREATE TABLE "production_order_schedules" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "plannedStartAt" TIMESTAMP(3) NOT NULL,
    "plannedEndAt" TIMESTAMP(3) NOT NULL,
    "workingMinutes" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "notes" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_order_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_order_schedules_productionOrderId_key" ON "production_order_schedules"("productionOrderId");

-- CreateIndex
CREATE INDEX "production_order_schedules_plannedStartAt_idx" ON "production_order_schedules"("plannedStartAt");

-- CreateIndex
CREATE INDEX "production_order_schedules_plannedEndAt_idx" ON "production_order_schedules"("plannedEndAt");

-- AddForeignKey
ALTER TABLE "production_order_schedules" ADD CONSTRAINT "production_order_schedules_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Capacidade e contagem de recursos simultaneos: pelo menos um, ou NULL.
-- Zero nao descreve recurso nenhum — descreve a ausencia dele, e para isso ja
-- existe `active`.
ALTER TABLE "industrial_resources"
  ADD CONSTRAINT "industrial_resources_capacity_positive_check"
  CHECK ("capacityQuantity" IS NULL OR "capacityQuantity" >= 1);

-- Energia nao ocupa capacidade: ela nao entra em etapa de roteiro e continua
-- no dominio de custo. Guardar um numero aqui criaria uma capacidade que
-- nenhuma tela consulta e que a primeira leitura distraida usaria.
ALTER TABLE "industrial_resources"
  ADD CONSTRAINT "industrial_resources_capacity_type_check"
  CHECK ("type" <> 'ENERGY' OR "capacityQuantity" IS NULL);

-- Envelope coerente e trabalho positivo: uma agenda que termina antes de
-- comecar, ou que nao tem trabalho nenhum, nao e agenda.
ALTER TABLE "production_order_schedules"
  ADD CONSTRAINT "production_order_schedules_window_check"
  CHECK ("plannedEndAt" >= "plannedStartAt" AND "workingMinutes" > 0);
