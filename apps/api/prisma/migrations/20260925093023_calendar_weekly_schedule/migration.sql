-- PLANNING-CALENDAR-WEEKLY-SCHEDULE-01: jornada POR DIA DA SEMANA e excecao
-- com horario especial.
--
-- Ate aqui o calendario tinha UMA jornada (inicio, fim, intervalo) e sete
-- booleanos de dia operante. A fabrica real nao funciona assim: segunda a
-- quinta 08-17 com almoco, sexta e sabado 08-12 sem pausa, domingo fechado.
--
-- ADITIVA. Nenhuma coluna sai:
--
-- 1. `production_calendar_weekdays` — sete linhas por calendario, uma por dia,
--    e a nova fonte canonica da jornada. O BACKFILL copia a jornada unica para
--    cada dia marcado e cria o dia desmarcado como NAO OPERA, sem horario.
--    Intervalo com duracao e sem horario (legado do PLANNING-CALENDAR-01)
--    nao vira "sem intervalo" em silencio: vai para
--    `unpositionedBreakMinutes`, e a agenda continua recusando ate alguem
--    salvar o dia — exatamente como recusava antes.
-- 2. `production_calendar_exceptions` ganha FUNCIONAMENTO: `SEM_OPERACAO`
--    (o que toda excecao era ate hoje, e e o default que as linhas existentes
--    recebem) ou `HORARIO_ESPECIAL`, com a jornada daquela data.
--
-- As colunas de jornada unica de `production_calendars` ficam DEPRECADAS e
-- intactas: nenhum codigo as le mais, e a remocao e o
-- CALENDAR-LEGACY-COLUMNS-CLEANUP-01 do BACKLOG.
--
-- Nada de ProductionOrder, agenda gravada, recurso, custo, estoque ou
-- promessa de entrega e tocado. Agenda gravada continua snapshot.

-- CreateEnum
CREATE TYPE "ProductionCalendarExceptionOperation" AS ENUM ('SEM_OPERACAO', 'HORARIO_ESPECIAL');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "production_calendar_exceptions" ADD COLUMN     "breakEndMinuteOfDay" INTEGER,
ADD COLUMN     "breakStartMinuteOfDay" INTEGER,
ADD COLUMN     "endMinuteOfDay" INTEGER,
ADD COLUMN     "operation" "ProductionCalendarExceptionOperation" NOT NULL DEFAULT 'SEM_OPERACAO',
ADD COLUMN     "startMinuteOfDay" INTEGER;

-- CreateTable
CREATE TABLE "production_calendar_weekdays" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "weekday" "DayOfWeek" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "startMinuteOfDay" INTEGER,
    "endMinuteOfDay" INTEGER,
    "breakStartMinuteOfDay" INTEGER,
    "breakEndMinuteOfDay" INTEGER,
    "unpositionedBreakMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "production_calendar_weekdays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_calendar_weekdays_calendarId_weekday_key" ON "production_calendar_weekdays"("calendarId", "weekday");

-- AddForeignKey
ALTER TABLE "production_calendar_weekdays" ADD CONSTRAINT "production_calendar_weekdays_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "production_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dia que nao opera nao tem horario nenhum: horario guardado num dia fechado
-- seria valor invisivel esperando para ser usado sem ninguem ver.
ALTER TABLE "production_calendar_weekdays"
  ADD CONSTRAINT "production_calendar_weekdays_closed_check"
  CHECK (
    "enabled"
    OR (
      "startMinuteOfDay" IS NULL AND "endMinuteOfDay" IS NULL
      AND "breakStartMinuteOfDay" IS NULL AND "breakEndMinuteOfDay" IS NULL
      AND "unpositionedBreakMinutes" IS NULL
    )
  );

-- Dia que opera tem inicio e fim no dia civil, e o fim vem depois do inicio.
-- 1440 = 24:00, fim legitimo.
ALTER TABLE "production_calendar_weekdays"
  ADD CONSTRAINT "production_calendar_weekdays_window_check"
  CHECK (
    NOT "enabled"
    OR (
      "startMinuteOfDay" IS NOT NULL AND "endMinuteOfDay" IS NOT NULL
      AND "startMinuteOfDay" >= 0
      AND "startMinuteOfDay" < "endMinuteOfDay"
      AND "endMinuteOfDay" <= 1440
    )
  );

-- Intervalo opcional: os dois nulos, ou os dois preenchidos, dentro da jornada
-- e menor que ela. Meia pausa nao descreve intervalo nenhum.
ALTER TABLE "production_calendar_weekdays"
  ADD CONSTRAINT "production_calendar_weekdays_break_check"
  CHECK (
    ("breakStartMinuteOfDay" IS NULL AND "breakEndMinuteOfDay" IS NULL)
    OR (
      "breakStartMinuteOfDay" IS NOT NULL AND "breakEndMinuteOfDay" IS NOT NULL
      AND "breakStartMinuteOfDay" >= "startMinuteOfDay"
      AND "breakStartMinuteOfDay" < "breakEndMinuteOfDay"
      AND "breakEndMinuteOfDay" <= "endMinuteOfDay"
      AND ("breakEndMinuteOfDay" - "breakStartMinuteOfDay") < ("endMinuteOfDay" - "startMinuteOfDay")
    )
  );

-- Legado: pausa com duracao e sem horario so existe sem posicao, positiva e
-- menor que a jornada — o mesmo que o CHECK antigo garantia.
ALTER TABLE "production_calendar_weekdays"
  ADD CONSTRAINT "production_calendar_weekdays_unpositioned_break_check"
  CHECK (
    "unpositionedBreakMinutes" IS NULL
    OR (
      "breakStartMinuteOfDay" IS NULL AND "breakEndMinuteOfDay" IS NULL
      AND "unpositionedBreakMinutes" > 0
      AND "unpositionedBreakMinutes" < ("endMinuteOfDay" - "startMinuteOfDay")
    )
  );

-- SEM_OPERACAO fecha o dia inteiro: horario nenhum.
ALTER TABLE "production_calendar_exceptions"
  ADD CONSTRAINT "production_calendar_exceptions_closed_check"
  CHECK (
    "operation" <> 'SEM_OPERACAO'
    OR (
      "startMinuteOfDay" IS NULL AND "endMinuteOfDay" IS NULL
      AND "breakStartMinuteOfDay" IS NULL AND "breakEndMinuteOfDay" IS NULL
    )
  );

-- HORARIO_ESPECIAL troca a jornada da data: as mesmas regras do dia da semana.
ALTER TABLE "production_calendar_exceptions"
  ADD CONSTRAINT "production_calendar_exceptions_special_window_check"
  CHECK (
    "operation" <> 'HORARIO_ESPECIAL'
    OR (
      "startMinuteOfDay" IS NOT NULL AND "endMinuteOfDay" IS NOT NULL
      AND "startMinuteOfDay" >= 0
      AND "startMinuteOfDay" < "endMinuteOfDay"
      AND "endMinuteOfDay" <= 1440
    )
  );

ALTER TABLE "production_calendar_exceptions"
  ADD CONSTRAINT "production_calendar_exceptions_break_check"
  CHECK (
    ("breakStartMinuteOfDay" IS NULL AND "breakEndMinuteOfDay" IS NULL)
    OR (
      "breakStartMinuteOfDay" IS NOT NULL AND "breakEndMinuteOfDay" IS NOT NULL
      AND "breakStartMinuteOfDay" >= "startMinuteOfDay"
      AND "breakStartMinuteOfDay" < "breakEndMinuteOfDay"
      AND "breakEndMinuteOfDay" <= "endMinuteOfDay"
      AND ("breakEndMinuteOfDay" - "breakStartMinuteOfDay") < ("endMinuteOfDay" - "startMinuteOfDay")
    )
  );

-- BACKFILL-SEMANA:INICIO
-- Para cada calendario existente, os sete dias. Dia marcado copia a jornada
-- unica; dia desmarcado nasce sem operacao e sem horario. Quem salvou e quando
-- vem do calendario: a configuracao e a mesma, so mudou de lugar.
-- `NOT EXISTS` deixa o bloco idempotente — o teste da API o reexecuta sobre um
-- calendario legado para provar que nada se perde.
INSERT INTO "production_calendar_weekdays" (
    "id", "calendarId", "weekday", "enabled",
    "startMinuteOfDay", "endMinuteOfDay",
    "breakStartMinuteOfDay", "breakEndMinuteOfDay",
    "unpositionedBreakMinutes",
    "updatedAt", "updatedBy"
)
SELECT
    gen_random_uuid()::text,
    c."id",
    d."weekday",
    d."enabled",
    CASE WHEN d."enabled" THEN c."startMinuteOfDay" END,
    CASE WHEN d."enabled" THEN c."endMinuteOfDay" END,
    CASE WHEN d."enabled" THEN c."breakStartMinuteOfDay" END,
    CASE WHEN d."enabled" THEN c."breakEndMinuteOfDay" END,
    CASE
      WHEN d."enabled" AND c."breakStartMinuteOfDay" IS NULL AND c."breakMinutes" > 0
      THEN c."breakMinutes"
    END,
    c."updatedAt",
    c."updatedBy"
FROM "production_calendars" c
CROSS JOIN LATERAL (
    VALUES
      ('MONDAY'::"DayOfWeek", c."monday"),
      ('TUESDAY'::"DayOfWeek", c."tuesday"),
      ('WEDNESDAY'::"DayOfWeek", c."wednesday"),
      ('THURSDAY'::"DayOfWeek", c."thursday"),
      ('FRIDAY'::"DayOfWeek", c."friday"),
      ('SATURDAY'::"DayOfWeek", c."saturday"),
      ('SUNDAY'::"DayOfWeek", c."sunday")
) AS d("weekday", "enabled")
WHERE NOT EXISTS (
    SELECT 1 FROM "production_calendar_weekdays" w WHERE w."calendarId" = c."id"
);
-- BACKFILL-SEMANA:FIM
