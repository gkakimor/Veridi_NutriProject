import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  DiaDaSemana,
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarWeekdayDTO,
} from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Calendário de Produção — PLANNING-CALENDAR-01 e
 * PLANNING-CALENDAR-WEEKLY-SCHEDULE-01.
 *
 * Promessas sob teste:
 *
 * 1. o calendário é UM, e a jornada são SETE linhas que se salvam uma de cada
 *    vez — salvar a sexta não reescreve a segunda;
 * 2. a configuração antiga, de jornada única, chega à semana sem perder nada:
 *    o bloco de backfill da PRÓPRIA migration é executado sobre um calendário
 *    legado e o resultado é conferido;
 * 3. exceção tem motivo E funcionamento: SEM_OPERACAO fecha o dia sem horário
 *    nenhum, HORARIO_ESPECIAL declara a jornada da data;
 * 4. uma exceção por data, e cadastrar de novo a mesma data é conflito
 *    explícito — nunca sobrescrita silenciosa.
 *
 * O calendário é estado GLOBAL: este arquivo roda na faixa serial
 * (`vitest.serial.config.ts`), sem vizinho mexendo nele ao mesmo tempo.
 */

type App = ReturnType<typeof buildTestApp>;
const app: App = buildTestApp("ADMIN");
const leitor: App = buildTestApp("VIEWER");

/** Marca as datas desta rodada, para limpar só o que este arquivo criou. */
const ANO_DE_TESTE = 2031;
const criadas: string[] = [];

const dia = (mes: number, diaDoMes: number) =>
  `${ANO_DE_TESTE}-${String(mes).padStart(2, "0")}-${String(diaDoMes).padStart(2, "0")}`;

const MIGRATION = new URL(
  "../../../prisma/migrations/20260925093023_calendar_weekly_schedule/migration.sql",
  import.meta.url,
);

type Resposta = Awaited<ReturnType<App["inject"]>>;

async function lerCalendario(): Promise<ProductionCalendarDTO> {
  const resposta = await app.inject({ method: "GET", url: "/production-calendar" });
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as ProductionCalendarDTO;
}

function doDia(calendario: ProductionCalendarDTO, weekday: DiaDaSemana): ProductionCalendarWeekdayDTO {
  return calendario.weekdays.find((linha) => linha.weekday === weekday)!;
}

const operando = (
  inicio: number,
  fim: number,
  pausa: [number, number] | null = null,
): Record<string, unknown> => ({
  enabled: true,
  startMinuteOfDay: inicio,
  endMinuteOfDay: fim,
  breakStartMinuteOfDay: pausa ? pausa[0] : null,
  breakEndMinuteOfDay: pausa ? pausa[1] : null,
});

const SEM_OPERAR = { enabled: false };

function salvarDia(weekday: string, payload: Record<string, unknown>, quem: App = app): Promise<Resposta> {
  return quem.inject({ method: "PUT", url: `/production-calendar/weekdays/${weekday}`, payload });
}

/** Seg–qui 08–17 com almoço, sex e sáb 08–12, domingo fechado — a semana da Veridi. */
async function salvarSemanaVeridi() {
  for (const weekday of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"]) {
    expect((await salvarDia(weekday, operando(480, 1020, [720, 780]))).statusCode).toBe(200);
  }
  expect((await salvarDia("FRIDAY", operando(480, 720))).statusCode).toBe(200);
  expect((await salvarDia("SATURDAY", operando(480, 720))).statusCode).toBe(200);
  expect((await salvarDia("SUNDAY", SEM_OPERAR)).statusCode).toBe(200);
}

async function criarExcecao(payload: Record<string, unknown>): Promise<Resposta> {
  const resposta = await app.inject({
    method: "POST",
    url: "/production-calendar/exceptions",
    payload,
  });
  if (resposta.statusCode === 201) {
    criadas.push((resposta.json() as ProductionCalendarExceptionDTO).id);
  }
  return resposta;
}

/**
 * Recoloca o banco no estado de ANTES da migration: calendário de jornada
 * única, sem nenhuma linha de semana — e roda o backfill da migration.
 */
async function migrarCalendarioLegado(legado: {
  inicio: number;
  fim: number;
  pausaMinutos: number;
  pausa: [number, number] | null;
  dias: Record<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday", boolean>;
}) {
  const prisma = getPrisma();
  await prisma.productionCalendar.deleteMany({});
  await prisma.$executeRaw`
    INSERT INTO "production_calendars"
      ("id", "startMinuteOfDay", "endMinuteOfDay", "breakMinutes",
       "breakStartMinuteOfDay", "breakEndMinuteOfDay",
       "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
       "updatedAt", "updatedBy")
    VALUES ('GLOBAL', ${legado.inicio}, ${legado.fim}, ${legado.pausaMinutos},
            ${legado.pausa ? legado.pausa[0] : null}::int, ${legado.pausa ? legado.pausa[1] : null}::int,
            ${legado.dias.monday}, ${legado.dias.tuesday}, ${legado.dias.wednesday},
            ${legado.dias.thursday}, ${legado.dias.friday}, ${legado.dias.saturday},
            ${legado.dias.sunday}, now(), 'Jornada legada')`;
  expect(await prisma.productionCalendarWeekday.count()).toBe(0);

  const sql = readFileSync(MIGRATION, "utf8");
  const inicio = sql.indexOf("-- BACKFILL-SEMANA:INICIO");
  const fim = sql.indexOf("-- BACKFILL-SEMANA:FIM");
  expect(inicio).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(inicio);
  await prisma.$executeRawUnsafe(sql.slice(inicio, fim));
}

beforeAll(async () => {
  await app.ready();
  await leitor.ready();
  const prisma = getPrisma();
  // Rodada limpa: o singleton é estado global, e um resto de execução
  // anterior faria "ainda não configurado" falhar sem motivo. As sete linhas
  // da semana saem junto (ON DELETE CASCADE).
  await prisma.productionCalendar.deleteMany({});
  await prisma.productionCalendarException.deleteMany({
    where: {
      date: {
        gte: new Date(`${ANO_DE_TESTE}-01-01T00:00:00.000Z`),
        lt: new Date(`${ANO_DE_TESTE + 1}-01-01T00:00:00.000Z`),
      },
    },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (criadas.length > 0) {
    await prisma.productionCalendarException.deleteMany({ where: { id: { in: criadas } } });
  }
  await prisma.productionCalendar.deleteMany({});
  await app.close();
  await leitor.close();
});

describe("a jornada semanal — um calendário, sete dias", () => {
  it("antes de configurar, ler devolve a semana sugerida e não cria nada", async () => {
    const calendario = await lerCalendario();
    expect(calendario.configured).toBe(false);
    expect(calendario.weekdays.map((linha) => linha.weekday)).toEqual([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]);
    expect(doDia(calendario, "MONDAY")).toMatchObject({
      enabled: true,
      startMinuteOfDay: 480,
      endMinuteOfDay: 1020,
      unpositionedBreakMinutes: 60,
      workingMinutes: 480,
    });
    expect(doDia(calendario, "SUNDAY")).toMatchObject({ enabled: false, startMinuteOfDay: null });
    expect(calendario.breakPositionWarning).toContain("Segunda-feira");
    const prisma = getPrisma();
    expect(await prisma.productionCalendar.count()).toBe(0);
    expect(await prisma.productionCalendarWeekday.count()).toBe(0);
  });

  it("salvar UM dia cria o calendário com os sete — o salvo como informado, os outros com a sugestão", async () => {
    const resposta = await salvarDia("FRIDAY", operando(480, 720));
    expect(resposta.statusCode).toBe(200);
    const calendario = resposta.json() as ProductionCalendarDTO;
    expect(calendario.configured).toBe(true);
    expect(doDia(calendario, "FRIDAY")).toMatchObject({
      enabled: true,
      startMinuteOfDay: 480,
      endMinuteOfDay: 720,
      breakStartMinuteOfDay: null,
      unpositionedBreakMinutes: null,
      workingMinutes: 240,
    });
    // A segunda continua a sugestão — e o aviso dela continua valendo.
    expect(doDia(calendario, "MONDAY").unpositionedBreakMinutes).toBe(60);
    expect(calendario.breakPositionWarning).toContain("Segunda-feira");
    expect(calendario.breakPositionWarning).not.toContain("Sexta-feira");

    const prisma = getPrisma();
    expect(await prisma.productionCalendar.count()).toBe(1);
    expect(await prisma.productionCalendarWeekday.count()).toBe(7);
  });

  it("o banco recusa um segundo calendário e uma segunda linha do mesmo dia", async () => {
    const prisma = getPrisma();
    await expect(prisma.productionCalendar.create({ data: { id: "OUTRO" } })).rejects.toThrow();
    await expect(
      prisma.productionCalendarWeekday.create({
        data: { calendarId: "GLOBAL", weekday: "FRIDAY", enabled: false },
      }),
    ).rejects.toThrow();
    expect(await prisma.productionCalendarWeekday.count()).toBe(7);
  });

  it("a semana da Veridi, dia a dia: seg–qui longa, sex e sáb curtos, domingo fechado", async () => {
    await salvarSemanaVeridi();
    const calendario = await lerCalendario();

    for (const weekday of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"] as const) {
      expect(doDia(calendario, weekday)).toMatchObject({
        enabled: true,
        startMinuteOfDay: 480,
        endMinuteOfDay: 1020,
        breakStartMinuteOfDay: 720,
        breakEndMinuteOfDay: 780,
        workingMinutes: 480,
      });
    }
    expect(doDia(calendario, "FRIDAY")).toMatchObject({ endMinuteOfDay: 720, workingMinutes: 240 });
    expect(doDia(calendario, "SATURDAY")).toMatchObject({
      enabled: true,
      endMinuteOfDay: 720,
      workingMinutes: 240,
    });
    expect(doDia(calendario, "SUNDAY")).toMatchObject({
      enabled: false,
      startMinuteOfDay: null,
      endMinuteOfDay: null,
      workingMinutes: 0,
    });
    expect(calendario.breakPositionWarning).toBeNull();
    expect(calendario.updatedBy).not.toBeNull();
  });

  it("minutos úteis são derivados — nenhuma coluna guarda o rendimento", async () => {
    const linha = await getPrisma().productionCalendarWeekday.findFirst({
      where: { weekday: "MONDAY" },
    });
    expect(linha).not.toHaveProperty("workingMinutes");
  });

  it("salvar uma linha não altera nenhuma das outras seis", async () => {
    const prisma = getPrisma();
    const antes = await prisma.productionCalendarWeekday.findMany({
      where: { weekday: { not: "WEDNESDAY" } },
      orderBy: { weekday: "asc" },
    });

    const resposta = await salvarDia("WEDNESDAY", operando(420, 960, [690, 720]));
    expect(resposta.statusCode).toBe(200);
    expect(doDia(resposta.json() as ProductionCalendarDTO, "WEDNESDAY").workingMinutes).toBe(510);

    const depois = await prisma.productionCalendarWeekday.findMany({
      where: { weekday: { not: "WEDNESDAY" } },
      orderBy: { weekday: "asc" },
    });
    // Nem o horário, nem quem salvou, nem QUANDO: as seis linhas são as mesmas.
    expect(depois).toEqual(antes);

    expect((await salvarDia("WEDNESDAY", operando(480, 1020, [720, 780]))).statusCode).toBe(200);
  });

  it("dia que deixa de operar é gravado sem horário nenhum", async () => {
    expect((await salvarDia("SATURDAY", SEM_OPERAR)).statusCode).toBe(200);
    const linha = await getPrisma().productionCalendarWeekday.findFirst({
      where: { weekday: "SATURDAY" },
    });
    expect(linha).toMatchObject({
      enabled: false,
      startMinuteOfDay: null,
      endMinuteOfDay: null,
      breakStartMinuteOfDay: null,
      breakEndMinuteOfDay: null,
    });
    expect((await salvarDia("SATURDAY", operando(480, 720))).statusCode).toBe(200);
  });

  it("o dia na URL aceita minúsculas", async () => {
    const resposta = await salvarDia("friday", operando(480, 720));
    expect(resposta.statusCode).toBe(200);
  });
});

describe("dia inválido é recusado, e a recusa não grava nada", () => {
  it("fim antes do início", async () => {
    const resposta = await salvarDia("MONDAY", operando(1020, 480));
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("invalid_calendar_config");
  });

  it("dia que opera sem horário", async () => {
    const resposta = await salvarDia("MONDAY", { enabled: true });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("Informe o horário inicial e o final.");
  });

  it("horário em branco é 'não informado', nunca 00:00", async () => {
    const resposta = await salvarDia("MONDAY", { ...operando(480, 1020), startMinuteOfDay: "" });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("Informe o horário inicial e o final.");

    const excecao = await criarExcecao({
      date: dia(10, 5),
      type: "OUTRO",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: "",
      endMinuteOfDay: 720,
    });
    expect(excecao.statusCode).toBe(400);
    expect(excecao.json().message).toContain("Informe o horário inicial e o final.");
  });

  it("só o início do intervalo", async () => {
    const resposta = await salvarDia("MONDAY", { ...operando(480, 1020), breakStartMinuteOfDay: 720 });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("início E fim");
  });

  it("intervalo fora da jornada", async () => {
    const resposta = await salvarDia("FRIDAY", operando(480, 720, [700, 780]));
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("dentro da jornada");
  });

  it("dia que não opera com horário", async () => {
    const resposta = await salvarDia("SUNDAY", { enabled: false, startMinuteOfDay: 480 });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("não tem horário");
  });

  it("horário fora do dia e dia da semana que não existe", async () => {
    expect((await salvarDia("MONDAY", operando(480, 1441))).json().error).toBe("validation_error");
    const inexistente = await salvarDia("FERIADO", operando(480, 720));
    expect(inexistente.statusCode).toBe(400);
    expect(inexistente.json().error).toBe("validation_error");
  });

  it("desativar o último dia operante é recusado", async () => {
    for (const weekday of ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]) {
      expect((await salvarDia(weekday, SEM_OPERAR)).statusCode).toBe(200);
    }
    const ultimo = await salvarDia("MONDAY", SEM_OPERAR);
    expect(ultimo.statusCode).toBe(400);
    expect(ultimo.json().message).toContain("Ao menos um dia da semana precisa operar");
    // A recusa desfez a transação inteira: a segunda continua operando.
    expect(doDia(await lerCalendario(), "MONDAY").enabled).toBe(true);
  });

  it("nenhuma recusa gravou nada: a semana volta a ser a da Veridi", async () => {
    await salvarSemanaVeridi();
    const calendario = await lerCalendario();
    expect(doDia(calendario, "MONDAY")).toMatchObject({ startMinuteOfDay: 480, endMinuteOfDay: 1020 });
    expect(doDia(calendario, "FRIDAY")).toMatchObject({ endMinuteOfDay: 720 });
  });
});

describe("dado antigo preservado — o backfill da migration sobre a jornada única", () => {
  it("dias marcados copiam jornada e intervalo; desmarcados nascem sem operação e sem horário", async () => {
    await migrarCalendarioLegado({
      inicio: 420,
      fim: 960,
      pausaMinutos: 60,
      pausa: [660, 720],
      dias: {
        monday: true,
        tuesday: true,
        wednesday: false,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: false,
      },
    });
    const calendario = await lerCalendario();
    expect(calendario.configured).toBe(true);
    for (const weekday of ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const) {
      expect(doDia(calendario, weekday)).toMatchObject({
        enabled: true,
        startMinuteOfDay: 420,
        endMinuteOfDay: 960,
        breakStartMinuteOfDay: 660,
        breakEndMinuteOfDay: 720,
        unpositionedBreakMinutes: null,
        workingMinutes: 480,
        updatedBy: "Jornada legada",
      });
    }
    for (const weekday of ["WEDNESDAY", "SUNDAY"] as const) {
      expect(doDia(calendario, weekday)).toMatchObject({
        enabled: false,
        startMinuteOfDay: null,
        endMinuteOfDay: null,
        breakStartMinuteOfDay: null,
        breakEndMinuteOfDay: null,
        workingMinutes: 0,
      });
    }
    expect(calendario.breakPositionWarning).toBeNull();
  });

  it("intervalo com duração e sem horário NÃO vira 'sem intervalo': fica pendente, e rende o mesmo", async () => {
    await migrarCalendarioLegado({
      inicio: 480,
      fim: 1020,
      pausaMinutos: 45,
      pausa: null,
      dias: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      },
    });
    const calendario = await lerCalendario();
    expect(doDia(calendario, "MONDAY")).toMatchObject({
      enabled: true,
      breakStartMinuteOfDay: null,
      unpositionedBreakMinutes: 45,
      // 540 de janela − 45 de pausa: o mesmo que a jornada única rendia.
      workingMinutes: 495,
    });
    expect(calendario.breakPositionWarning).toBe(
      "Defina o horário do intervalo de Segunda-feira, Terça-feira, Quarta-feira, Quinta-feira e Sexta-feira antes de calcular horários de produção.",
    );

    // Salvar a segunda resolve A SEGUNDA — as outras continuam pendentes.
    expect((await salvarDia("MONDAY", operando(480, 1020, [720, 765]))).statusCode).toBe(200);
    const depois = await lerCalendario();
    expect(doDia(depois, "MONDAY").unpositionedBreakMinutes).toBeNull();
    expect(doDia(depois, "TUESDAY").unpositionedBreakMinutes).toBe(45);
    expect(depois.breakPositionWarning).not.toContain("Segunda-feira");
  });

  it("jornada única sem intervalo chega sem intervalo", async () => {
    await migrarCalendarioLegado({
      inicio: 480,
      fim: 720,
      pausaMinutos: 0,
      pausa: null,
      dias: {
        monday: true,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      },
    });
    const calendario = await lerCalendario();
    expect(doDia(calendario, "MONDAY")).toMatchObject({
      enabled: true,
      unpositionedBreakMinutes: null,
      workingMinutes: 240,
    });
    expect(calendario.breakPositionWarning).toBeNull();
    await salvarSemanaVeridi();
  });
});

describe("exceções — motivo e funcionamento", () => {
  let feriado: ProductionCalendarExceptionDTO;

  it("cadastra um feriado SEM OPERAÇÃO — o padrão quando o funcionamento não vem", async () => {
    const resposta = await criarExcecao({ date: dia(12, 25), type: "FERIADO", reason: "Natal" });
    expect(resposta.statusCode).toBe(201);
    feriado = resposta.json() as ProductionCalendarExceptionDTO;
    expect(feriado).toMatchObject({
      date: dia(12, 25),
      type: "FERIADO",
      reason: "Natal",
      operation: "SEM_OPERACAO",
      startMinuteOfDay: null,
      endMinuteOfDay: null,
      breakStartMinuteOfDay: null,
      breakEndMinuteOfDay: null,
      workingMinutes: 0,
    });
    expect(feriado.createdBy).not.toBeNull();
  });

  it("a data guardada é o MARCADOR do dia civil, nunca um instante", async () => {
    const linha = await getPrisma().productionCalendarException.findUnique({
      where: { id: feriado.id },
    });
    expect(linha?.date.toISOString()).toBe(`${dia(12, 25)}T00:00:00.000Z`);
  });

  it("FERIADO com HORÁRIO ESPECIAL: véspera de Natal das 08:00 às 12:00", async () => {
    const resposta = await criarExcecao({
      date: dia(12, 24),
      type: "FERIADO",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 720,
      reason: "Véspera de Natal",
    });
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({
      type: "FERIADO",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 720,
      breakStartMinuteOfDay: null,
      workingMinutes: 240,
      reason: "Véspera de Natal",
    });
  });

  it("horário especial com intervalo próprio", async () => {
    const resposta = await criarExcecao({
      date: dia(12, 27),
      type: "OUTRO",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 1080,
      breakStartMinuteOfDay: 720,
      breakEndMinuteOfDay: 780,
      reason: "Mutirão de inventário",
    });
    expect(resposta.statusCode).toBe(201);
    expect((resposta.json() as ProductionCalendarExceptionDTO).workingMinutes).toBe(540);
  });

  it("SEM OPERAÇÃO com horário é recusado — e o banco confirma", async () => {
    const resposta = await criarExcecao({
      date: dia(11, 2),
      type: "FERIADO",
      operation: "SEM_OPERACAO",
      startMinuteOfDay: 480,
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("invalid_calendar_exception");

    await expect(
      getPrisma().productionCalendarException.create({
        data: {
          date: new Date(`${dia(11, 3)}T00:00:00.000Z`),
          type: "FERIADO",
          operation: "SEM_OPERACAO",
          startMinuteOfDay: 480,
          endMinuteOfDay: 720,
        },
      }),
    ).rejects.toThrow();
  });

  it("HORÁRIO ESPECIAL sem horário, ou com intervalo fora dele, é recusado", async () => {
    const semHorario = await criarExcecao({
      date: dia(11, 4),
      type: "RECESSO",
      operation: "HORARIO_ESPECIAL",
    });
    expect(semHorario.statusCode).toBe(400);
    expect(semHorario.json().message).toContain("Informe o horário inicial e o final.");

    const pausaFora = await criarExcecao({
      date: dia(11, 4),
      type: "RECESSO",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 720,
      breakStartMinuteOfDay: 700,
      breakEndMinuteOfDay: 760,
    });
    expect(pausaFora.statusCode).toBe(400);
  });

  it("uma exceção por data: repetir a mesma data é conflito, não sobrescrita", async () => {
    const resposta = await criarExcecao({
      date: dia(12, 25),
      type: "PARADA_OPERACIONAL",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 720,
    });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("exception_date_taken");
    expect(resposta.json().message).toContain("Feriado");

    const atual = await getPrisma().productionCalendarException.findUnique({
      where: { id: feriado.id },
    });
    expect(atual).toMatchObject({ type: "FERIADO", reason: "Natal", operation: "SEM_OPERACAO" });
  });

  it("editar muda o funcionamento: sem operação vira horário especial e volta, e a data não se move", async () => {
    const especial = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { operation: "HORARIO_ESPECIAL", startMinuteOfDay: 480, endMinuteOfDay: 720 },
    });
    expect(especial.statusCode).toBe(200);
    expect(especial.json()).toMatchObject({
      date: dia(12, 25),
      type: "FERIADO",
      reason: "Natal",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: 720,
    });

    const fechado = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { operation: "SEM_OPERACAO" },
    });
    expect(fechado.statusCode).toBe(200);
    expect(fechado.json()).toMatchObject({
      operation: "SEM_OPERACAO",
      startMinuteOfDay: null,
      endMinuteOfDay: null,
    });
  });

  it("horário sem funcionamento na edição é recusado", async () => {
    const resposta = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { endMinuteOfDay: 700 },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });

  it("editar só o motivo não mexe no funcionamento", async () => {
    const resposta = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { type: "PARADA_OPERACIONAL", reason: "Manutenção elétrica" },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      type: "PARADA_OPERACIONAL",
      reason: "Manutenção elétrica",
      operation: "SEM_OPERACAO",
      date: dia(12, 25),
    });
  });

  it("observação em branco vira null, não string vazia", async () => {
    const resposta = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { reason: "" },
    });
    expect(resposta.statusCode).toBe(200);
    expect((resposta.json() as ProductionCalendarExceptionDTO).reason).toBeNull();
  });

  it("cadastra um recesso de vários dias, uma data por vez, e a lista vem em ordem", async () => {
    for (const diaDoMes of [28, 29, 30]) {
      const resposta = await criarExcecao({
        date: dia(12, diaDoMes),
        type: "RECESSO",
        reason: "Recesso de fim de ano",
      });
      expect(resposta.statusCode).toBe(201);
    }
    const lista = await app.inject({
      method: "GET",
      url: `/production-calendar/exceptions?from=${dia(12, 1)}&to=${dia(12, 31)}`,
    });
    expect(lista.statusCode).toBe(200);
    const { exceptions } = lista.json() as { exceptions: ProductionCalendarExceptionDTO[] };
    expect(exceptions.map((e) => e.date)).toEqual([
      dia(12, 24),
      dia(12, 25),
      dia(12, 27),
      dia(12, 28),
      dia(12, 29),
      dia(12, 30),
    ]);
  });

  it("excluir devolve a data à jornada do dia da semana", async () => {
    const resposta = await app.inject({
      method: "DELETE",
      url: `/production-calendar/exceptions/${feriado.id}`,
    });
    expect(resposta.statusCode).toBe(204);

    const lista = await app.inject({
      method: "GET",
      url: `/production-calendar/exceptions?from=${dia(12, 1)}&to=${dia(12, 31)}`,
    });
    const { exceptions } = lista.json() as { exceptions: ProductionCalendarExceptionDTO[] };
    expect(exceptions.map((e) => e.date)).not.toContain(dia(12, 25));

    // A data livre pode ser cadastrada de novo.
    const recriada = await criarExcecao({ date: dia(12, 25), type: "FERIADO" });
    expect(recriada.statusCode).toBe(201);
  });

  it("exceção inexistente é 404, nunca 500", async () => {
    const inexistente = "00000000-0000-4000-8000-000000000000";
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/production-calendar/exceptions/${inexistente}`,
          payload: { type: "OUTRO" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/production-calendar/exceptions/${inexistente}`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("data inexistente e motivo fora da lista são 400", async () => {
    const data = await app.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: `${ANO_DE_TESTE}-02-30`, type: "FERIADO" },
    });
    expect(data.statusCode).toBe(400);
    expect(data.json().error).toBe("validation_error");

    const tipo = await app.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: dia(11, 15), type: "FOLGA" },
    });
    expect(tipo.statusCode).toBe(400);

    const funcionamento = await app.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: dia(11, 15), type: "FERIADO", operation: "MEIO_DIA" },
    });
    expect(funcionamento.statusCode).toBe(400);
  });
});

describe("permissões — mesmo gate dos Perfis de Produção", () => {
  it("VIEWER lê a jornada e as exceções", async () => {
    expect((await leitor.inject({ method: "GET", url: "/production-calendar" })).statusCode).toBe(
      200,
    );
    expect(
      (await leitor.inject({ method: "GET", url: "/production-calendar/exceptions" })).statusCode,
    ).toBe(200);
  });

  it("VIEWER não salva dia nem cadastra exceção", async () => {
    expect((await salvarDia("MONDAY", operando(480, 1020), leitor)).statusCode).toBe(403);

    const excecao = await leitor.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: dia(11, 20), type: "FERIADO" },
    });
    expect(excecao.statusCode).toBe(403);
  });

  it("a gravação da semana inteira de uma vez deixou de existir", async () => {
    const resposta = await app.inject({ method: "PUT", url: "/production-calendar", payload: {} });
    expect(resposta.statusCode).toBe(404);
  });
});
