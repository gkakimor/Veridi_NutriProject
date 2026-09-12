import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProductionCalendarDTO, ProductionCalendarExceptionDTO } from "@veridi/shared";
import { CALENDARIO_PADRAO } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Calendário de Produção — PLANNING-CALENDAR-01.
 *
 * Três promessas sob teste:
 *
 * 1. o calendário é UM. Não há lista, não há id na URL e o banco recusa uma
 *    segunda linha;
 * 2. hora do dia é MINUTO DO DIA, e a jornada não depende de fuso nenhum;
 * 3. uma exceção por data, e cadastrar de novo a mesma data é conflito
 *    explícito — nunca sobrescrita silenciosa.
 */

type App = ReturnType<typeof buildTestApp>;
const app: App = buildTestApp("ADMIN");
const leitor: App = buildTestApp("VIEWER");

/** Marca as datas desta rodada, para limpar só o que este arquivo criou. */
const ANO_DE_TESTE = 2031;
const criadas: string[] = [];

const dia = (mes: number, diaDoMes: number) =>
  `${ANO_DE_TESTE}-${String(mes).padStart(2, "0")}-${String(diaDoMes).padStart(2, "0")}`;

async function lerCalendario(): Promise<ProductionCalendarDTO> {
  const resposta = await app.inject({ method: "GET", url: "/production-calendar" });
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as ProductionCalendarDTO;
}

type Resposta = Awaited<ReturnType<App["inject"]>>;

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

beforeAll(async () => {
  await app.ready();
  await leitor.ready();
  const prisma = getPrisma();
  // Rodada limpa: o singleton é estado global, e um resto de execução
  // anterior faria "ainda não configurado" falhar sem motivo.
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

describe("o calendário é um só", () => {
  it("antes de configurar, ler devolve o padrão sugerido e não cria linha", async () => {
    const calendario = await lerCalendario();
    expect(calendario.configured).toBe(false);
    expect(calendario.startMinuteOfDay).toBe(CALENDARIO_PADRAO.startMinuteOfDay);
    expect(calendario.endMinuteOfDay).toBe(CALENDARIO_PADRAO.endMinuteOfDay);
    expect(calendario.breakMinutes).toBe(CALENDARIO_PADRAO.breakMinutes);
    expect(calendario.weekdays.monday).toBe(true);
    expect(calendario.weekdays.saturday).toBe(false);
    expect(await getPrisma().productionCalendar.count()).toBe(0);
  });

  it("o padrão de calendário novo é segunda a sexta", async () => {
    const { weekdays } = await lerCalendario();
    expect(weekdays).toEqual({
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    });
  });

  it("salvar duas vezes continua com UMA linha, e o banco recusa outro id", async () => {
    const jornada = {
      startMinuteOfDay: 420,
      endMinuteOfDay: 1020,
      breakMinutes: 60,
      weekdays: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: false,
      },
    };
    const primeira = await app.inject({ method: "PUT", url: "/production-calendar", payload: jornada });
    expect(primeira.statusCode).toBe(200);
    const segunda = await app.inject({
      method: "PUT",
      url: "/production-calendar",
      payload: { ...jornada, breakMinutes: 30 },
    });
    expect(segunda.statusCode).toBe(200);

    const prisma = getPrisma();
    expect(await prisma.productionCalendar.count()).toBe(1);

    // O CHECK do banco é a garantia final do singleton.
    await expect(
      prisma.productionCalendar.create({ data: { id: "OUTRO" } }),
    ).rejects.toThrow();
    expect(await prisma.productionCalendar.count()).toBe(1);
  });

  it("depois de salvo, a leitura traz a jornada gravada e quem salvou", async () => {
    const calendario = await lerCalendario();
    expect(calendario.configured).toBe(true);
    expect(calendario.startMinuteOfDay).toBe(420);
    expect(calendario.endMinuteOfDay).toBe(1020);
    expect(calendario.breakMinutes).toBe(30);
    expect(calendario.weekdays.saturday).toBe(true);
    expect(calendario.weekdays.sunday).toBe(false);
    expect(calendario.updatedBy).not.toBeNull();
    expect(calendario.updatedAt).not.toBeNull();
  });

  it("minutos úteis são derivados, nunca uma coluna", async () => {
    // 07:00 às 17:00 são 600 min de janela; com 30 de intervalo, 570 úteis.
    const calendario = await lerCalendario();
    expect(calendario.workingMinutesPerDay).toBe(570);
  });
});

describe("configuração inválida é recusada", () => {
  const base = {
    startMinuteOfDay: 480,
    endMinuteOfDay: 1020,
    breakMinutes: 60,
    weekdays: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    },
  };

  it("fim antes do início", async () => {
    const resposta = await app.inject({
      method: "PUT",
      url: "/production-calendar",
      payload: { ...base, endMinuteOfDay: 300 },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("invalid_calendar_config");
  });

  it("horário fora do dia", async () => {
    const resposta = await app.inject({
      method: "PUT",
      url: "/production-calendar",
      payload: { ...base, endMinuteOfDay: 1441 },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });

  it("intervalo maior que a jornada", async () => {
    const resposta = await app.inject({
      method: "PUT",
      url: "/production-calendar",
      payload: { ...base, breakMinutes: 600 },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("intervalo");
  });

  it("nenhum dia operante", async () => {
    const resposta = await app.inject({
      method: "PUT",
      url: "/production-calendar",
      payload: {
        ...base,
        weekdays: {
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        },
      },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain("dia operante");
  });

  it("uma recusa não grava nada: a jornada anterior continua", async () => {
    expect((await lerCalendario()).startMinuteOfDay).toBe(420);
  });
});

describe("exceções do calendário", () => {
  let feriado: ProductionCalendarExceptionDTO;

  it("cadastra um feriado", async () => {
    const resposta = await criarExcecao({
      date: dia(12, 25),
      type: "FERIADO",
      reason: "Natal",
    });
    expect(resposta.statusCode).toBe(201);
    feriado = resposta.json() as ProductionCalendarExceptionDTO;
    expect(feriado.date).toBe(dia(12, 25));
    expect(feriado.type).toBe("FERIADO");
    expect(feriado.reason).toBe("Natal");
    expect(feriado.createdBy).not.toBeNull();
  });

  it("a data guardada é o MARCADOR do dia civil, nunca um instante", async () => {
    const linha = await getPrisma().productionCalendarException.findUnique({
      where: { id: feriado.id },
    });
    expect(linha?.date.toISOString()).toBe(`${dia(12, 25)}T00:00:00.000Z`);
  });

  it("cadastra um recesso de vários dias, uma data por vez", async () => {
    for (const diaDoMes of [26, 27, 28]) {
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
      dia(12, 25),
      dia(12, 26),
      dia(12, 27),
      dia(12, 28),
    ]);
  });

  it("uma exceção por data: repetir a mesma data é conflito, não sobrescrita", async () => {
    const resposta = await criarExcecao({
      date: dia(12, 25),
      type: "PARADA_OPERACIONAL",
      reason: "Outra coisa",
    });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("exception_date_taken");
    expect(resposta.json().message).toContain("Feriado");

    // O que já estava lá continua intacto.
    const atual = await getPrisma().productionCalendarException.findUnique({
      where: { id: feriado.id },
    });
    expect(atual?.type).toBe("FERIADO");
    expect(atual?.reason).toBe("Natal");
  });

  it("editar troca tipo e motivo, e a data não se move", async () => {
    const resposta = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { type: "PARADA_OPERACIONAL", reason: "Manutenção elétrica" },
    });
    expect(resposta.statusCode).toBe(200);
    const editada = resposta.json() as ProductionCalendarExceptionDTO;
    expect(editada.type).toBe("PARADA_OPERACIONAL");
    expect(editada.reason).toBe("Manutenção elétrica");
    expect(editada.date).toBe(dia(12, 25));
  });

  it("motivo em branco vira null, não string vazia", async () => {
    const resposta = await app.inject({
      method: "PATCH",
      url: `/production-calendar/exceptions/${feriado.id}`,
      payload: { reason: "" },
    });
    expect(resposta.statusCode).toBe(200);
    expect((resposta.json() as ProductionCalendarExceptionDTO).reason).toBeNull();
  });

  it("excluir devolve o dia à regra da semana", async () => {
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

  it("data inexistente no calendário é 400", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: `${ANO_DE_TESTE}-02-30`, type: "FERIADO" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });

  it("tipo fora da lista é 400", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: dia(11, 15), type: "FOLGA" },
    });
    expect(resposta.statusCode).toBe(400);
  });

  it("sem intervalo a lista traz tudo, em ordem de data", async () => {
    const lista = await app.inject({ method: "GET", url: "/production-calendar/exceptions" });
    expect(lista.statusCode).toBe(200);
    const { exceptions } = lista.json() as { exceptions: ProductionCalendarExceptionDTO[] };
    const doAno = exceptions.filter((e) => e.date.startsWith(String(ANO_DE_TESTE)));
    expect(doAno.length).toBeGreaterThanOrEqual(4);
    expect([...doAno].sort((a, b) => a.date.localeCompare(b.date))).toEqual(doAno);
  });
});

describe("permissões — mesmo gate dos Perfis de Produção", () => {
  it("VIEWER lê a jornada e as exceções", async () => {
    expect(
      (await leitor.inject({ method: "GET", url: "/production-calendar" })).statusCode,
    ).toBe(200);
    expect(
      (await leitor.inject({ method: "GET", url: "/production-calendar/exceptions" })).statusCode,
    ).toBe(200);
  });

  it("VIEWER não configura a jornada nem cadastra exceção", async () => {
    const jornada = await leitor.inject({
      method: "PUT",
      url: "/production-calendar",
      payload: {
        startMinuteOfDay: 480,
        endMinuteOfDay: 1020,
        breakMinutes: 60,
        weekdays: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
        },
      },
    });
    expect(jornada.statusCode).toBe(403);

    const excecao = await leitor.inject({
      method: "POST",
      url: "/production-calendar/exceptions",
      payload: { date: dia(11, 20), type: "FERIADO" },
    });
    expect(excecao.statusCode).toBe(403);
  });
});
