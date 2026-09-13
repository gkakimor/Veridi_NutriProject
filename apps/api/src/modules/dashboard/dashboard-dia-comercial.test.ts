import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hojeComercial, limitesDoDiaComercial } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { dashboardQuerySchema } from "./dashboard.schemas.js";

/**
 * Dashboard — o período é o DIA da Veridi (DASHBOARD-BUSINESS-DATE-01).
 *
 * A tela mandava os limites já em instantes ISO, montados no navegador, e a
 * rota os usava como vinham. O contrato passou a ser o dia (`from`/`to` em
 * `YYYY-MM-DD`), aberto no schema no dia comercial de São Paulo, com o fim
 * inclusivo que o serviço sempre leu.
 *
 * Aqui se prova o servidor: "hoje" às 01:30 UTC é 12/09 com a máquina em UTC,
 * UTC-07 ou São Paulo; as bordas do dia numa coluna de instante; mesmo dia e
 * intervalo sem off-by-one; ponta vazia como hoje; e a recusa do instante no
 * lugar do dia. A tela mandando o MESMO dia nos três fusos é de
 * `web pages/dashboard-dia-comercial.test.tsx`.
 *
 * E a barra do gráfico de movimentações (DASHBOARD-MOVEMENT-BUSINESS-DAY-01):
 * `occurredAt` é instante, e a barra em que ele entra é o dia comercial dele —
 * não o dia UTC que `occurredAt.toISOString().slice(0, 10)` dava, em que o
 * movimento das 22:30 de São Paulo aparecia no dia seguinte.
 *
 * Fora da faixa serial de `dashboard.test.ts` de propósito: o agregado medido
 * é o de um dia histórico sorteado, em que nenhum outro arquivo escreve.
 */

type App = ReturnType<typeof buildTestApp>;

/** As três máquinas, com o deslocamento que cada uma tem em 12/09. */
const FUSOS = [
  { fuso: "UTC", deslocamentoEmMinutos: 0 },
  { fuso: "Etc/GMT+7", deslocamentoEmMinutos: 420 },
  { fuso: "America/Sao_Paulo", deslocamentoEmMinutos: 180 },
];

/** Roda `corpo` com o processo no fuso pedido — e confere que o fuso pegou. */
async function naMaquinaEm<T>(
  { fuso, deslocamentoEmMinutos }: (typeof FUSOS)[number],
  corpo: () => Promise<T> | T,
): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = fuso;
  try {
    // Sem isto o teste passaria sem nunca ter mudado de fuso.
    expect(new Date("2026-09-12T12:00:00.000Z").getTimezoneOffset()).toBe(deslocamentoEmMinutos);
    return await corpo();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Dia histórico sorteado por execução, entre 2020 e 2023. O Brasil não tem
 * horário de verão desde 2019: São Paulo é UTC-03 o ano inteiro, e as bordas
 * podem ser escritas por extenso.
 */
const BASE = Date.UTC(2020, 0, 2) + Math.floor(Math.random() * 1400) * DAY_MS;
const dia = (deslocamento: number) => new Date(BASE + deslocamento * DAY_MS).toISOString().slice(0, 10);
const [VESPERA, DIA, SEGUINTE] = [dia(-1), dia(0), dia(1)];

/** Instantes de borda, em UTC, e o dia a que pertencem em São Paulo. */
const BORDAS = {
  ANTES: `${DIA}T02:59:59.999Z`, // véspera 23:59:59.999
  INICIO: `${DIA}T03:00:00.000Z`, // DIA 00:00
  VIRADA_UTC: `${SEGUINTE}T01:30:00.000Z`, // DIA 22:30 — em UTC já é o dia seguinte
  ULTIMO: `${SEGUINTE}T02:59:59.999Z`, // DIA 23:59:59.999
  DEPOIS: `${SEGUINTE}T03:00:00.000Z`, // dia seguinte 00:00
} as const;

const criados = { clientes: [] as string[], pedidos: [] as string[], itens: [] as string[] };

let app: App;

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await app.close();
});

function marcador(): string {
  return `DSH${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

afterEach(() => {
  vi.useRealTimers();
});

async function consulta(params: Record<string, string>) {
  const response = await app.inject({ method: "GET", url: `/dashboard?${new URLSearchParams(params)}` });
  expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
  return response.json();
}

function comoTexto(periodo: { from: Date; to: Date }): [string, string] {
  return [periodo.from.toISOString(), periodo.to.toISOString()];
}

describe("hoje comercial — o relógio da máquina não decide", () => {
  it("às 01:30 UTC de 13/09, hoje é 12/09 inteiro com a máquina em UTC, UTC-07 ou São Paulo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-13T01:30:00.000Z"));
    for (const fuso of FUSOS) {
      await naMaquinaEm(fuso, () => {
        // Sem período, período limpo e o dia pedido explicitamente: a mesma janela.
        for (const query of [{}, { from: "", to: "" }, { from: "2026-09-12", to: "2026-09-12" }]) {
          expect(comoTexto(dashboardQuerySchema.parse(query)), `${fuso} ${JSON.stringify(query)}`).toEqual([
            "2026-09-12T03:00:00.000Z",
            "2026-09-13T02:59:59.999Z",
          ]);
        }
      });
    }
  });

  it("intervalo 11/09 → 12/09 vai do começo do dia 11 ao fim do dia 12, em qualquer máquina", async () => {
    for (const fuso of FUSOS) {
      await naMaquinaEm(fuso, () => {
        expect(comoTexto(dashboardQuerySchema.parse({ from: "2026-09-11", to: "2026-09-12" }))).toEqual([
          "2026-09-11T03:00:00.000Z",
          "2026-09-13T02:59:59.999Z",
        ]);
      });
    }
  });
});

describe("bordas do dia comercial numa coluna de instante", () => {
  it("o mesmo dia cobre 00:00 a 23:59:59.999 em São Paulo, e 01:30 UTC do dia seguinte ainda é dele", async () => {
    const prisma = getPrisma();
    const m = marcador();
    const cliente = await prisma.customer.create({
      data: { code: `CLI-${m}`, legalName: `Cliente Painel Dia Comercial ${m}`, active: true },
    });
    criados.clientes.push(cliente.id);
    const pedidos = await prisma.customerOrder.createManyAndReturn({
      data: (Object.keys(BORDAS) as (keyof typeof BORDAS)[]).map((borda) => ({
        code: `PED-${m}-${borda}`,
        customerId: cliente.id,
        createdAt: new Date(BORDAS[borda]),
      })),
      select: { id: true },
    });
    criados.pedidos.push(...pedidos.map((pedido) => pedido.id));

    const periodo = async (from: string, to: string) => (await consulta({ from, to })).period;

    // O mesmo dia nas duas pontas é o dia INTEIRO — e só ele.
    const mesmoDia = await periodo(DIA, DIA);
    expect(mesmoDia.customerOrdersCreated).toBe(3);
    // O eco é o dia comercial com o fim inclusivo de sempre.
    expect([mesmoDia.from, mesmoDia.to]).toEqual([BORDAS.INICIO, BORDAS.ULTIMO]);
    // Cada ponta anda um dia, sem off-by-one.
    expect((await periodo(VESPERA, DIA)).customerOrdersCreated).toBe(4);
    expect((await periodo(DIA, SEGUINTE)).customerOrdersCreated).toBe(4);
    expect((await periodo(VESPERA, SEGUINTE)).customerOrdersCreated).toBe(5);
  });
});

describe("gráfico de movimentações — a barra é o dia comercial do `occurredAt`", () => {
  /** Um evento por borda, cada um de um tipo: dá para ver em que barra cada um entrou. */
  const EVENTOS = [
    { borda: "ANTES", type: "ADJUSTMENT_OUT", sourceType: "MANUAL_ADJUSTMENT" },
    { borda: "INICIO", type: "RECEIPT_IN", sourceType: "RECEIPT" },
    { borda: "VIRADA_UTC", type: "LOSS", sourceType: "MANUAL_LOSS" },
    { borda: "ULTIMO", type: "ADJUSTMENT_IN", sourceType: "MANUAL_ADJUSTMENT" },
    { borda: "DEPOIS", type: "SAMPLE_CONSUMPTION", sourceType: "PROJECT_SAMPLE" },
  ] as const;

  const ZERADO = {
    receiptIn: 0,
    productionConsumption: 0,
    sampleConsumption: 0,
    finishedGoodProduction: 0,
    shipmentOut: 0,
    adjustments: 0,
    loss: 0,
  };

  beforeAll(async () => {
    const prisma = getPrisma();
    const m = marcador();
    const item = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-${m}`,
        name: `Movimento Painel ${m}`,
        unitCode: "kg",
        controlsLot: false,
        controlsExpiry: false,
        requiresQualityRelease: false,
      },
    });
    criados.itens.push(item.id);
    await prisma.inventoryMovement.createMany({
      data: EVENTOS.map(({ borda, type, sourceType }) => ({
        itemId: item.id,
        type,
        sourceType,
        quantity: "1",
        occurredAt: new Date(BORDAS[borda]),
      })),
    });
  });

  it("22:30 de São Paulo (01:30 UTC do dia seguinte) fica na barra do próprio dia, com a máquina em UTC, UTC-07 ou São Paulo", async () => {
    const series: string[] = [];
    for (const fuso of FUSOS) {
      series.push(
        await naMaquinaEm(fuso, async () => JSON.stringify((await consulta({ from: DIA, to: DIA })).movementActivity)),
      );
    }
    expect(new Set(series).size).toBe(1);
    expect(JSON.parse(series[0]!)).toEqual([{ date: DIA, ...ZERADO, receiptIn: 1, loss: 1, adjustments: 1 }]);
  });

  it("00:00 e 23:59:59.999 de São Paulo ficam no dia; o instante antes vai para a véspera, o seguinte para o outro dia", async () => {
    const painel = await consulta({ from: VESPERA, to: SEGUINTE });
    expect(painel.movementActivity).toEqual([
      { date: VESPERA, ...ZERADO, adjustments: 1 },
      { date: DIA, ...ZERADO, receiptIn: 1, loss: 1, adjustments: 1 },
      { date: SEGUINTE, ...ZERADO, sampleConsumption: 1 },
    ]);
    // A série conta os mesmos eventos do resumo, só que repartidos por dia.
    const somados = { ...ZERADO };
    for (const ponto of painel.movementActivity as (typeof ZERADO)[]) {
      for (const chave of Object.keys(ZERADO) as (keyof typeof ZERADO)[]) somados[chave] += ponto[chave];
    }
    expect(somados).toEqual(painel.movementSummary);
  });

  it("dia sem movimento continua sem barra: cinco dias de janela, três barras", async () => {
    const painel = await consulta({ from: dia(-3), to: SEGUINTE });
    expect((painel.movementActivity as { date: string }[]).map((ponto) => ponto.date)).toEqual([
      VESPERA,
      DIA,
      SEGUINTE,
    ]);
  });

  it("guarda estrutural: a barra não volta a sair do dia UTC", () => {
    const pasta = fileURLToPath(new URL("./", import.meta.url));
    // Sem comentários: a explicação do bug pode citar o padrão; o código, não.
    const servico = readFileSync(join(pasta, "dashboard.service.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(servico).toMatch(/diaCivil\(movement\.occurredAt, FUSO_COMERCIAL\)/);
    expect(servico).not.toMatch(/occurredAt\.toISOString\(\)\.slice\(/);
    expect(servico).not.toMatch(/occurredAt\.getUTC(FullYear|Month|Date)\(/);
  });
});

describe("contrato — o período é dia, nunca instante", () => {
  it("recusa a meia-noite do navegador e o dia em outro formato, nas duas pontas", async () => {
    // O primeiro é exatamente o que a tela mandava de um navegador em São Paulo.
    for (const valor of ["2026-09-12T03:00:00.000Z", "12/09/2026", "2026-02-30"]) {
      for (const ponta of ["from", "to"]) {
        const response = await app.inject({
          method: "GET",
          url: `/dashboard?${new URLSearchParams({ [ponta]: valor })}`,
        });
        expect(response.statusCode, `${ponta}=${valor}`).toBe(400);
      }
    }
  });

  it("ponta vazia ou ausente é o dia comercial de hoje, sem exceção", async () => {
    const antes = hojeComercial();
    const vazio = (await consulta({ from: "", to: "" })).period;
    const ausente = (await consulta({})).period;
    const depois = hojeComercial();
    // Dois candidatos só para a execução que atravessa a meia-noite de São Paulo.
    const hoje = [antes, depois].map((d) => comoTexto({ from: limitesDoDiaComercial(d).inicio, to: limitesDoDiaComercial(d).fim }));
    expect(hoje).toContainEqual([vazio.from, vazio.to]);
    expect(hoje).toContainEqual([ausente.from, ausente.to]);
  });

  it("guarda estrutural: `from`/`to` são dias, abertos no schema", () => {
    const pasta = fileURLToPath(new URL("./", import.meta.url));
    const schemas = readFileSync(join(pasta, "dashboard.schemas.ts"), "utf8");
    expect(schemas).toMatch(/from:\s*diaCivilDeFiltroSchema/);
    expect(schemas).toMatch(/to:\s*diaCivilDeFiltroSchema/);
    // `z.coerce.date` lê `2026-09-12` como meia-noite UTC — 21h do dia 11 em São Paulo.
    expect(schemas).not.toMatch(/coerce\.date|requiredDateSchema/);
  });
});
