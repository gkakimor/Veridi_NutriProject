import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FUSO_COMERCIAL, diaCivil, hojeComercial, limitesDoDiaComercial } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { dashboardQuerySchemaEm } from "./dashboard.schemas.js";

/**
 * Período invertido do Painel é recusa, não "zero resultados"
 * (DASHBOARD-INVERTED-PERIOD-01).
 *
 * Ponta vazia é hoje comercial (DASHBOARD-BUSINESS-DATE-01), e só essa regra já
 * fabricava janela invertida: "De" vazio com "Até" no passado virava `from` hoje
 * e `to` no passado, e `gte hoje`/`lte passado` respondia 200 com todos os KPIs
 * em zero — pergunta inválida lida como "nada aconteceu". O mesmo com "De"
 * preenchido depois de "Até". Agora o schema completa a ponta vazia e SÓ ENTÃO
 * compara: `from` depois de `to` é 400 `validation_error`, com a frase que a tela
 * mostra.
 *
 * O "hoje" é o do instante da requisição, no dia comercial de São Paulo: às
 * 01:30 UTC ainda é a véspera, com a máquina em qualquer fuso. A tela está em
 * `web pages/dashboard-periodo-invertido.test.tsx`.
 */

type App = ReturnType<typeof buildTestApp>;

const DATA_INICIAL_DEPOIS = "A data inicial não pode ser posterior à data final.";
const SEM_DATA_INICIAL = "Sem data inicial, o período começa hoje — a data final não pode ser anterior a hoje.";
const SEM_DATA_FINAL = "Sem data final, o período termina hoje — a data inicial não pode ser posterior a hoje.";

/** 12:00 de 13/09 em São Paulo. */
const AGORA = new Date("2026-09-13T15:00:00.000Z");
const HOJE = "2026-09-13";

/** O que o schema faz com a query: os dias da janela, ou as recusas. */
function periodo(query: Record<string, string>, agora = AGORA) {
  const parsed = dashboardQuerySchemaEm(agora).safeParse(query);
  if (parsed.success) {
    return { dias: [diaCivil(parsed.data.from, FUSO_COMERCIAL), diaCivil(parsed.data.to, FUSO_COMERCIAL)] };
  }
  return { recusa: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

describe("schema — a ponta vazia vira hoje, e só então o período se compara", () => {
  it("De antes de Até, e o mesmo dia nas duas pontas: consulta normal", () => {
    expect(periodo({ from: "2026-09-12", to: HOJE })).toEqual({ dias: ["2026-09-12", HOJE] });
    expect(periodo({ from: "2026-09-12", to: "2026-09-12" })).toEqual({ dias: ["2026-09-12", "2026-09-12"] });
  });

  it("De depois de Até: recusa, com a frase da data inicial", () => {
    expect(periodo({ from: HOJE, to: "2026-09-12" })).toEqual({
      recusa: [{ path: "from", message: DATA_INICIAL_DEPOIS }],
    });
  });

  it("as duas vazias ou ausentes: hoje a hoje, como antes", () => {
    expect(periodo({})).toEqual({ dias: [HOJE, HOJE] });
    expect(periodo({ from: "", to: "" })).toEqual({ dias: [HOJE, HOJE] });
  });

  it("De vazio: Até hoje ou depois consulta a partir de hoje; Até no passado é recusa, não janela invertida", () => {
    expect(periodo({ from: "", to: HOJE })).toEqual({ dias: [HOJE, HOJE] });
    expect(periodo({ to: "2026-09-20" })).toEqual({ dias: [HOJE, "2026-09-20"] });
    for (const query of [{ from: "", to: "2026-09-12" }, { to: "2026-09-12" }]) {
      expect(periodo(query), JSON.stringify(query)).toEqual({ recusa: [{ path: "to", message: SEM_DATA_INICIAL }] });
    }
  });

  it("Até vazio: De no passado ou hoje consulta até hoje; De no futuro é recusa", () => {
    expect(periodo({ from: "2026-09-01", to: "" })).toEqual({ dias: ["2026-09-01", HOJE] });
    expect(periodo({ from: HOJE })).toEqual({ dias: [HOJE, HOJE] });
    expect(periodo({ from: "2026-09-14", to: "" })).toEqual({ recusa: [{ path: "from", message: SEM_DATA_FINAL }] });
  });

  it("às 01:30 UTC de 13/09 hoje ainda é 12/09 — com a máquina em UTC, UTC-07 ou São Paulo", () => {
    const virada = new Date("2026-09-13T01:30:00.000Z");
    const original = process.env.TZ;
    try {
      for (const [fuso, deslocamento] of [["UTC", 0], ["Etc/GMT+7", 420], ["America/Sao_Paulo", 180]] as const) {
        process.env.TZ = fuso;
        // Sem isto o teste passaria sem nunca ter mudado de fuso.
        expect(new Date("2026-09-12T12:00:00.000Z").getTimezoneOffset()).toBe(deslocamento);
        // Pelo dia da máquina em UTC (13/09), o primeiro seria recusa e o segundo passaria.
        expect(periodo({ to: "2026-09-12" }, virada), fuso).toEqual({ dias: ["2026-09-12", "2026-09-12"] });
        expect(periodo({ from: "2026-09-13" }, virada), fuso).toEqual({
          recusa: [{ path: "from", message: SEM_DATA_FINAL }],
        });
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Dia histórico sorteado por execução, entre 2001 e 2004 — faixa em que nenhum
 * outro teste do Painel escreve. O pedido é criado ao meio-dia UTC, que cai no
 * mesmo dia em São Paulo com ou sem o horário de verão daqueles anos.
 */
const BASE = Date.UTC(2001, 0, 2) + Math.floor(Math.random() * 1400) * DAY_MS;
const dia = (deslocamento: number) => new Date(BASE + deslocamento * DAY_MS).toISOString().slice(0, 10);
const [DIA, SEGUINTE] = [dia(0), dia(1)];

const criados = { clientes: [] as string[], pedidos: [] as string[] };
let app: App;

beforeAll(async () => {
  app = buildTestApp();
  await app.ready();
  const prisma = getPrisma();
  const m = `DSHINV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const cliente = await prisma.customer.create({
    data: { code: `CLI-${m}`, legalName: `Cliente Painel Período Invertido ${m}`, active: true },
  });
  criados.clientes.push(cliente.id);
  const pedido = await prisma.customerOrder.create({
    data: { code: `PED-${m}`, customerId: cliente.id, createdAt: new Date(BASE + 12 * 60 * 60 * 1000) },
  });
  criados.pedidos.push(pedido.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await app.close();
});

function painel(params: Record<string, string>) {
  return app.inject({ method: "GET", url: `/dashboard?${new URLSearchParams(params)}` });
}

describe("rota — chamada direta à API", () => {
  it("from=2026-09-13&to=2026-09-12 responde 400 validation_error, não 200 vazio", async () => {
    const response = await painel({ from: "2026-09-13", to: "2026-09-12" });
    expect(response.statusCode, response.body.slice(0, 200)).toBe(400);
    expect(response.json()).toEqual({
      error: "validation_error",
      issues: [{ path: "from", message: DATA_INICIAL_DEPOIS }],
    });
  });

  it("o dia que tem pedido conta o pedido; o mesmo dia invertido é recusa, e não um zero", async () => {
    const mesmoDia = await painel({ from: DIA, to: DIA });
    expect(mesmoDia.statusCode).toBe(200);
    expect(mesmoDia.json().period.customerOrdersCreated).toBeGreaterThanOrEqual(1);

    const invertido = await painel({ from: SEGUINTE, to: DIA });
    expect(invertido.statusCode, invertido.body.slice(0, 200)).toBe(400);
    expect(invertido.json().issues).toEqual([{ path: "from", message: DATA_INICIAL_DEPOIS }]);
  });

  it("De vazio e Até no passado: 400 com a frase, e não 200 com os KPIs zerados", async () => {
    for (const params of [{ from: "", to: DIA }, { to: DIA }]) {
      const response = await painel(params);
      expect(response.statusCode, `${JSON.stringify(params)} ${response.body.slice(0, 200)}`).toBe(400);
      expect(response.json().issues).toEqual([{ path: "to", message: SEM_DATA_INICIAL }]);
    }
  });

  it("De no futuro e Até vazio: 400 com a frase da data final", async () => {
    const response = await painel({ from: "2999-01-01", to: "" });
    expect(response.statusCode, response.body.slice(0, 200)).toBe(400);
    expect(response.json().issues).toEqual([{ path: "from", message: SEM_DATA_FINAL }]);
  });

  it("De no passado e Até vazio: consulta do dia pedido até o fim de hoje", async () => {
    const antes = hojeComercial();
    const response = await painel({ from: DIA, to: "" });
    const depois = hojeComercial();
    expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
    const { period } = response.json();
    expect(period.from).toBe(limitesDoDiaComercial(DIA).inicio.toISOString());
    // Dois candidatos só para a execução que atravessa a meia-noite de São Paulo.
    expect([antes, depois].map((d) => limitesDoDiaComercial(d).fim.toISOString())).toContain(period.to);
    expect(period.customerOrdersCreated).toBeGreaterThanOrEqual(1);
  });
});
