-- PLANNING-CALENDAR-01: calendario GLOBAL de producao — jornada operacional
-- da fabrica (dias operantes, horario inicial/final, intervalo) e excecoes
-- por data civil (feriado, recesso, parada). Absorve OPS-CALENDAR-01 do
-- BACKLOG: um conceito so, nunca dois.
--
-- Aditiva: duas tabelas novas e um enum novo. Nenhum backfill. Nada de
-- ProductionOrder, IndustrialResource, custo, estoque, reserva, faturamento
-- ou promessa de entrega e tocado.

-- CreateEnum
CREATE TYPE "ProductionCalendarExceptionType" AS ENUM ('FERIADO', 'RECESSO', 'PARADA_OPERACIONAL', 'OUTRO');

-- CreateTable
CREATE TABLE "production_calendars" (
    "id" TEXT NOT NULL,
    "startMinuteOfDay" INTEGER NOT NULL DEFAULT 480,
    "endMinuteOfDay" INTEGER NOT NULL DEFAULT 1020,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "monday" BOOLEAN NOT NULL DEFAULT true,
    "tuesday" BOOLEAN NOT NULL DEFAULT true,
    "wednesday" BOOLEAN NOT NULL DEFAULT true,
    "thursday" BOOLEAN NOT NULL DEFAULT true,
    "friday" BOOLEAN NOT NULL DEFAULT true,
    "saturday" BOOLEAN NOT NULL DEFAULT false,
    "sunday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "production_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_calendar_exceptions" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "ProductionCalendarExceptionType" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "production_calendar_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_calendar_exceptions_date_key" ON "production_calendar_exceptions"("date");

-- SINGLETON: existe UM calendario de producao. A chave primaria e o proprio
-- conceito, e o CHECK impede uma segunda linha com outro id — sem coluna
-- `active`, sem indice parcial, sem ambiguidade.
ALTER TABLE "production_calendars"
  ADD CONSTRAINT "production_calendars_singleton_check" CHECK ("id" = 'GLOBAL');

-- Janela do dia em MINUTOS desde a meia-noite civil: comeca no dia, termina
-- depois do inicio, e nao passa das 24 h. 1440 = 24:00 e fim legitimo.
ALTER TABLE "production_calendars"
  ADD CONSTRAINT "production_calendars_window_check"
  CHECK ("startMinuteOfDay" >= 0 AND "startMinuteOfDay" < "endMinuteOfDay" AND "endMinuteOfDay" <= 1440);

-- Intervalo cabe DENTRO da janela: pausa igual ou maior que a jornada deixaria
-- o dia operante com zero minuto util, que e outra coisa — dia nao operante.
ALTER TABLE "production_calendars"
  ADD CONSTRAINT "production_calendars_break_check"
  CHECK ("breakMinutes" >= 0 AND "breakMinutes" < ("endMinuteOfDay" - "startMinuteOfDay"));

-- Ao menos um dia operante: calendario sem nenhum dia nao e uma fabrica
-- parada, e um cadastro sem sentido que travaria todo planejamento futuro.
ALTER TABLE "production_calendars"
  ADD CONSTRAINT "production_calendars_weekday_check"
  CHECK ("monday" OR "tuesday" OR "wednesday" OR "thursday" OR "friday" OR "saturday" OR "sunday");

-- `date` e DATA CIVIL: a meia-noite UTC que MARCA o dia, nunca um instante.
-- O unique da coluna ja garante a decisao do PO — uma excecao por data.
ALTER TABLE "production_calendar_exceptions"
  ADD CONSTRAINT "production_calendar_exceptions_civil_date_check"
  CHECK ("date" = date_trunc('day', "date"));
