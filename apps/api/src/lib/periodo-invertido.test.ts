import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodEffects, ZodObject } from "zod";
import type { ZodTypeAny } from "zod";
import { MENSAGEM_DE_PERIODO_INVERTIDO } from "@veridi/shared";
import { buildTestApp } from "../test-support/authenticated-app.js";
import { getPrisma } from "../db/prisma.js";
import { listCsvExports } from "../modules/exports/list-exports.js";
import { reportCsvExports } from "../modules/exports/report-exports.js";
import { marcadorDoDiaCivil } from "./business-day.js";

/**
 * Período invertido é recusa em toda lista, relatório e exportação — e ponta
 * vazia continua ABERTA (PERIOD-RANGE-VALIDATION-WAVE-01).
 *
 * `/billings?dateFrom=2026-09-13&dateTo=2026-09-12` e
 * `/reports/inventory/movements?from=2026-09-13&to=2026-09-12` respondiam 200
 * vazios: `intervaloDeDiasComerciais` monta cada ponta sozinha e ninguém as
 * comparava. Pergunta inválida lida como "nada no período". Agora as duas pontas
 * preenchidas e invertidas são 400 `validation_error` na ponta inicial, com a
 * frase que a tela mostra — no JSON e no CSV, que é também a fonte do PDF.
 *
 * O Painel é outra regra (ponta vazia é hoje): `dashboard-periodo-invertido.test.ts`.
 * Aqui, "só a inicial" no ano 2999 e "só a final" em 2001 PASSAM — quem copiasse
 * o "completar com hoje" do Painel derrubaria esses casos.
 */

type App = ReturnType<typeof buildTestApp>;

interface Familia {
  nome: string;
  rota: string;
  de: string;
  ate: string;
  /** O que a rota precisa para o período ser filtro (R-02: janela personalizada). */
  base?: Record<string, string>;
  /** Par obrigatório (quadro de produção): sem ponta, a recusa é do campo. */
  obrigatorio?: boolean;
  /** Tem `…/export.csv` com o mesmo schema. */
  csv?: boolean;
}

const FAMILIAS: Familia[] = [
  // Listas com campos De/Até na tela.
  { nome: "Faturamento", rota: "/billings", de: "dateFrom", ate: "dateTo", csv: true },
  { nome: "Recebimentos", rota: "/receipts", de: "dateFrom", ate: "dateTo", csv: true },
  { nome: "Ordens de Compra", rota: "/purchase-orders", de: "dateFrom", ate: "dateTo", csv: true },
  { nome: "Produto Acabado", rota: "/finished-goods", de: "dateFrom", ate: "dateTo", csv: true },
  // Listas com o par só na API.
  { nome: "Projetos (entrada)", rota: "/projects", de: "entryFrom", ate: "entryTo", csv: true },
  { nome: "Amostras (produção)", rota: "/project-samples", de: "producedFrom", ate: "producedTo", csv: true },
  // Planejamento: a tela manda janela calculada, nunca invertida.
  { nome: "Calendário — exceções", rota: "/production-calendar/exceptions", de: "from", ate: "to" },
  { nome: "Quadro de produção", rota: "/production-board", de: "from", ate: "to", obrigatorio: true },
  // Relatórios com De/até na tela.
  {
    nome: "R-02 Vencimentos (personalizado)",
    rota: "/reports/inventory/expiry",
    de: "from",
    ate: "to",
    base: { window: "CUSTOM" },
    csv: true,
  },
  { nome: "R-03 Movimentações", rota: "/reports/inventory/movements", de: "from", ate: "to", csv: true },
  { nome: "R-05 Planejado x Realizado", rota: "/reports/production/planned-actual", de: "from", ate: "to", csv: true },
  { nome: "R-07 Consumo", rota: "/reports/production/consumption", de: "from", ate: "to", csv: true },
  { nome: "R-08 Ordens de Compra", rota: "/reports/purchasing/orders", de: "from", ate: "to", csv: true },
  { nome: "R-09 Recebimentos", rota: "/reports/purchasing/receipts", de: "from", ate: "to", csv: true },
  { nome: "R-12 Pedidos", rota: "/reports/commercial/orders", de: "from", ate: "to", csv: true },
  { nome: "R-15 Faturamento", rota: "/reports/billing/period", de: "from", ate: "to", csv: true },
  // Relatórios com o par só na API.
  { nome: "R-13 Atendimento", rota: "/reports/commercial/fulfillment", de: "from", ate: "to", csv: true },
  {
    nome: "R-17 Pedido x Entregue x Faturado",
    rota: "/reports/billing/order-delivered-billed",
    de: "from",
    ate: "to",
    csv: true,
  },
  { nome: "R-20 Orçamento x Precificação", rota: "/reports/commercial/quote-pricing", de: "from", ate: "to", csv: true },
];

interface Caso {
  caso: string;
  pontas: (familia: Familia) => Record<string, string>;
  recusa: boolean;
  /** Sem ponta num par obrigatório: a recusa existe, mas é do campo. */
  exigePar?: boolean;
}

const CASOS: Caso[] = [
  { caso: "nenhuma ponta", pontas: () => ({}), recusa: false, exigePar: true },
  {
    caso: "só a inicial, no ano 2999 — aberta para frente",
    pontas: (f) => ({ [f.de]: "2999-01-01" }),
    recusa: false,
    exigePar: true,
  },
  {
    caso: "só a final, em 2001 — aberta para trás",
    pontas: (f) => ({ [f.ate]: "2001-01-01" }),
    recusa: false,
    exigePar: true,
  },
  { caso: "inicial antes da final", pontas: (f) => ({ [f.de]: "2026-09-12", [f.ate]: "2026-09-13" }), recusa: false },
  { caso: "o mesmo dia nas duas", pontas: (f) => ({ [f.de]: "2026-09-13", [f.ate]: "2026-09-13" }), recusa: false },
  { caso: "inicial depois da final", pontas: (f) => ({ [f.de]: "2026-09-13", [f.ate]: "2026-09-12" }), recusa: true },
];

let app: App;

beforeAll(async () => {
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function consultar(rota: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return app.inject({ method: "GET", url: query ? `${rota}?${query}` : rota });
}

async function conferir(rota: string, familia: Familia, { pontas, recusa, exigePar }: Caso, formato: "json" | "csv") {
  const response = await consultar(rota, { ...familia.base, ...pontas(familia) });
  const contexto = `${rota} ${JSON.stringify(pontas(familia))} → ${response.statusCode} ${response.body.slice(0, 200)}`;

  if (recusa) {
    expect(response.statusCode, contexto).toBe(400);
    expect(response.json(), contexto).toEqual({
      error: "validation_error",
      issues: [{ path: familia.de, message: MENSAGEM_DE_PERIODO_INVERTIDO }],
    });
    return;
  }
  if (familia.obrigatorio && exigePar) {
    // Recusa que já existia (as duas pontas são obrigatórias) — e não a do período.
    expect(response.statusCode, contexto).toBe(400);
    expect(JSON.stringify(response.json()), contexto).not.toContain(MENSAGEM_DE_PERIODO_INVERTIDO);
    return;
  }
  expect(response.statusCode, contexto).toBe(200);
  if (formato === "csv") expect(response.headers["content-type"], contexto).toContain("text/csv");
}

describe.each(FAMILIAS)("$nome — JSON", (familia) => {
  it.each(CASOS)("$caso", (caso) => conferir(familia.rota, familia, caso, "json"));
});

describe.each(FAMILIAS.filter((familia) => familia.csv))("$nome — CSV (também a fonte do PDF)", (familia) => {
  it.each(CASOS)("$caso", (caso) => conferir(`${familia.rota}/export.csv`, familia, caso, "csv"));
});

describe("R-02 fora da janela personalizada", () => {
  it("De/até invertidos numa janela pronta não são filtro, e não recusam", async () => {
    for (const rota of ["/reports/inventory/expiry", "/reports/inventory/expiry/export.csv"]) {
      const response = await consultar(rota, { window: "D30", from: "2026-09-13", to: "2026-09-12" });
      expect(response.statusCode, `${rota} ${response.body.slice(0, 200)}`).toBe(200);
    }
  });
});

describe("R-02 personalizado sem nenhuma ponta", () => {
  const criados = { itens: [] as string[], lotes: [] as string[] };

  afterAll(async () => {
    const prisma = getPrisma();
    await prisma.lot.deleteMany({ where: { id: { in: criados.lotes } } });
    await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  });

  it("aberto dos dois lados: todo lote COM validade, e o lote sem validade fora — nunca 500", async () => {
    // O filtro vazio (`expiryDate: {}`) trazia também o lote sem validade, e a
    // linha quebrava em `null.toISOString()`: 500 no JSON, no CSV e no PDF.
    const prisma = getPrisma();
    await prisma.unitOfMeasure.upsert({
      where: { code: "kg" },
      update: {},
      create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    });
    const m = `PRV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const item = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-${m}`,
        name: `Matéria-prima ${m}`,
        unitCode: "kg",
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
      },
    });
    criados.itens.push(item.id);
    const lotes = await prisma.lot.createManyAndReturn({
      data: [
        { code: `LT-${m}-VAL`, itemId: item.id, expiryDate: marcadorDoDiaCivil("2031-05-20"), initialReceivedQuantity: "0" },
        { code: `LT-${m}-SEM`, itemId: item.id, expiryDate: null, initialReceivedQuantity: "0" },
      ],
      select: { id: true },
    });
    criados.lotes.push(...lotes.map((lote) => lote.id));

    const filtro = { window: "CUSTOM", itemId: item.id, onlyWithBalance: "false" };
    const json = await consultar("/reports/inventory/expiry", filtro);
    expect(json.statusCode, json.body.slice(0, 200)).toBe(200);
    expect((json.json().rows as { lotCode: string }[]).map((linha) => linha.lotCode)).toEqual([`LT-${m}-VAL`]);

    const csv = await consultar("/reports/inventory/expiry/export.csv", filtro);
    expect(csv.statusCode, csv.body.slice(0, 200)).toBe(200);
    expect(csv.body).toContain(`LT-${m}-VAL`);
    expect(csv.body).not.toContain(`LT-${m}-SEM`);
  });
});

describe("guarda — toda exportação com par de datas está na matriz", () => {
  const PARES = [
    ["dateFrom", "dateTo"],
    ["from", "to"],
    ["entryFrom", "entryTo"],
    ["producedFrom", "producedTo"],
  ] as const;

  function campos(schema: ZodTypeAny): string[] {
    const objeto = schema instanceof ZodEffects ? (schema.innerType() as ZodTypeAny) : schema;
    return objeto instanceof ZodObject ? Object.keys(objeto.shape as Record<string, unknown>) : [];
  }

  it("o par de cada CSV é o da família, e a família declara o CSV", () => {
    const comPeriodo = [...listCsvExports, ...reportCsvExports].flatMap((exportacao) => {
      const chaves = campos(exportacao.schema);
      const par = PARES.find(([de, ate]) => chaves.includes(de) && chaves.includes(ate));
      return par ? [{ rota: exportacao.path.replace(/\/export\.csv$/, ""), de: par[0], ate: par[1] }] : [];
    });

    // Sem desembrulhar o schema a lista viria vazia e a guarda passaria sem olhar nada.
    expect(comPeriodo.length).toBeGreaterThanOrEqual(15);
    const matriz = FAMILIAS.filter((familia) => familia.csv).map(({ rota, de, ate }) => ({ rota, de, ate }));
    expect(comPeriodo.sort((a, b) => a.rota.localeCompare(b.rota))).toEqual(
      matriz.sort((a, b) => a.rota.localeCompare(b.rota)),
    );
  });
});
