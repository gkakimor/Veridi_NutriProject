-- PLANNING-CAPACITY-BOARD-01 (A): o intervalo do calendario ganha HORARIO.
--
-- Ate aqui a jornada sabia QUANTO o intervalo dura ("60 min") e nao ONDE ele
-- cai. Isso responde "quanto rende um dia", mas nao permite dizer que uma
-- etapa comeca as 11:40 e termina as 13:20: sem a posicao da pausa, o calculo
-- ou conta a hora do almoco como producao ou inventa um horario.
--
-- ADITIVA e SEM BACKFILL, de proposito. Todo calendario existente chega aqui
-- com as duas colunas NULAS — inclusive o que ja tem `breakMinutes` = 60. Nada
-- e inferido: 12:00-13:00 seria a jornada de uma fabrica que ninguem
-- consultou. O calendario continua valido para o resto; so a agenda com
-- horario exato e que recusa ate a posicao ser configurada (fail-closed).
--
-- Nada de ProductionOrder, IndustrialResource, custo, estoque ou promessa de
-- entrega e tocado.

-- AlterTable
ALTER TABLE "production_calendars" ADD COLUMN     "breakEndMinuteOfDay" INTEGER,
ADD COLUMN     "breakStartMinuteOfDay" INTEGER;

-- Os dois nulos ou os dois preenchidos: meia pausa — inicio sem fim — nao
-- descreve intervalo nenhum, e seria pior que a ausencia dele.
ALTER TABLE "production_calendars"
  ADD CONSTRAINT "production_calendars_break_pair_check"
  CHECK (
    ("breakStartMinuteOfDay" IS NULL AND "breakEndMinuteOfDay" IS NULL)
    OR ("breakStartMinuteOfDay" IS NOT NULL AND "breakEndMinuteOfDay" IS NOT NULL)
  );

-- A pausa comeca antes de terminar, cabe dentro da jornada do dia, e a
-- duracao dela e exatamente `breakMinutes`: duas verdades sobre a mesma pausa
-- fariam o rendimento do dia divergir do relogio.
ALTER TABLE "production_calendars"
  ADD CONSTRAINT "production_calendars_break_window_check"
  CHECK (
    "breakStartMinuteOfDay" IS NULL
    OR (
      "breakStartMinuteOfDay" >= "startMinuteOfDay"
      AND "breakStartMinuteOfDay" < "breakEndMinuteOfDay"
      AND "breakEndMinuteOfDay" <= "endMinuteOfDay"
      AND "breakEndMinuteOfDay" - "breakStartMinuteOfDay" = "breakMinutes"
    )
  );
