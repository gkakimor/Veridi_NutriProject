import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CostSource, Item, UomDimension, User } from "@prisma/client";
import type {
  InternalConsumptionReportDTO,
  InternalConsumptionReportFilterOptionsDTO,
} from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS, diaCivilDeslocado, limitesDoDiaComercial } from "@veridi/shared";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { getConsumedLotCostReference } from "../../lib/cost-reference.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * R-21 — Uso e consumo (INTERNAL-CONSUMPTION-REPORT-01, Fatia 3).
 *
 * O que este arquivo prova, e por quê:
 *
 * - todo filtro corta linhas, resumo e agrupamentos com o MESMO `where` — um
 *   resumo de outro recorte seria um número sem pergunta;
 * - o valor total soma SÓ custo conhecido, e `null` nunca vira zero: um
 *   recorte só com consumo sem custo tem valor `null`, não "0", e um custo
 *   real de zero continua sendo custo conhecido;
 * - o custo é o SNAPSHOT do registro: o relatório não chama a hierarquia de
 *   custo, e o item sem compra nenhuma hoje continua mostrando o custo com que
 *   o consumo foi gravado;
 * - o CSV (e o PDF, que lê o CSV) leva o mesmo recorte, inteiro, sem página.
 *
 * Os consumos são gravados direto no banco, com custo escolhido, numa janela
 * de dias sorteada entre 2004 e 2012: outro arquivo rodando ao lado grava
 * consumo "hoje", e a janela o deixa de fora sem depender de ordem.
 */

type App = ReturnType<typeof buildTestApp>;

const MARCA = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const BASE = diaCivilDeslocado("2004-01-05", Math.floor(Math.random() * 3000));
const DIA = (deslocamento: number) => diaCivilDeslocado(BASE, deslocamento);
const DE = DIA(0);
const ATE = DIA(4);
const JANELA = `from=${DE}&to=${ATE}`;

const ESCRITORIO = `Escritório ${MARCA}`;
const LIMPEZA = `Limpeza ${MARCA}`;

/** Meio-dia em São Paulo — longe das bordas do dia comercial. */
function meioDia(dia: string): Date {
  return new Date(limitesDoDiaComercial(dia).inicio.getTime() + 12 * 60 * 60 * 1000);
}

/** `dd/mm/aaaa`, como o CSV escreve o dia. */
function diaNoCsv(dia: string): string {
  return dia.split("-").reverse().join("/");
}

const itens: string[] = [];
const consumos: string[] = [];

let luva: Item;
let detergente: Item;
let papel: Item;
let copo: Item;
let compras: User;
let producao: User;

async function criarItem(nome: string, unitCode: string): Promise<Item> {
  const item = await getPrisma().item.create({
    data: {
      type: "INTERNAL_CONSUMABLE",
      code: `UC-R21T-${MARCA}-${itens.length + 1}`,
      name: `${nome} R21 ${MARCA}`,
      unitCode,
      ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
      active: true,
    },
  });
  itens.push(item.id);
  return item;
}

async function consumo(dados: {
  n: number;
  item: Item;
  quantity: string;
  occurredAt: Date;
  purpose: string | null;
  unitCost: string | null;
  totalCost: string | null;
  costSource: CostSource;
  por: User;
  notes?: string;
}) {
  const registro = await getPrisma().internalConsumption.create({
    data: {
      code: `CI-R21T-${MARCA}-${String(dados.n).padStart(2, "0")}`,
      itemId: dados.item.id,
      quantity: dados.quantity,
      uomCode: dados.item.unitCode,
      occurredAt: dados.occurredAt,
      purpose: dados.purpose,
      notes: dados.notes ?? null,
      unitCost: dados.unitCost,
      totalCost: dados.totalCost,
      costSource: dados.costSource,
      registeredByUserId: dados.por.id,
      registeredByNameSnapshot: dados.por.name,
    },
  });
  consumos.push(registro.id);
  return registro;
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  compras = (await createAuthenticatedUser("PURCHASING")).user;
  producao = (await createAuthenticatedUser("PRODUCTION")).user;

  luva = await criarItem("Luva nitrílica", "un");
  detergente = await criarItem("Detergente neutro", "kg");
  copo = await criarItem("Copo descartável", "un");
  papel = await criarItem("Papel toalha", "un");

  // Dentro da janela DE..ATE — cinco consumos, três com custo.
  await consumo({ n: 1, item: luva, quantity: "10", occurredAt: meioDia(DIA(0)), purpose: ESCRITORIO,
    unitCost: "1.5", totalCost: "15", costSource: "REAL", por: compras, notes: "Reposição do armário" });
  await consumo({ n: 2, item: luva, quantity: "4", occurredAt: meioDia(DIA(1)), purpose: LIMPEZA,
    unitCost: "1.25", totalCost: "5", costSource: "ESTIMATED_30D", por: producao });
  await consumo({ n: 3, item: detergente, quantity: "2.5", occurredAt: meioDia(DIA(2)), purpose: LIMPEZA,
    unitCost: "9", totalCost: "22.5", costSource: "LAST_REAL_COST", por: compras });
  await consumo({ n: 4, item: copo, quantity: "3", occurredAt: meioDia(DIA(3)), purpose: null,
    unitCost: null, totalCost: null, costSource: "NO_COST", por: producao });
  // Registro de dia passado: o serviço grava o FIM daquele dia comercial.
  await consumo({ n: 5, item: detergente, quantity: "1", occurredAt: limitesDoDiaComercial(DIA(4)).fim,
    purpose: ESCRITORIO, unitCost: null, totalCost: null, costSource: "NO_COST", por: compras });

  // Fora da janela, dos dois lados, com valores grandes para aparecerem se vazassem.
  await consumo({ n: 6, item: luva, quantity: "100", occurredAt: limitesDoDiaComercial(DIA(-1)).fim,
    purpose: ESCRITORIO, unitCost: "9.99", totalCost: "999", costSource: "REAL", por: compras });
  await consumo({ n: 7, item: luva, quantity: "80", occurredAt: limitesDoDiaComercial(DIA(5)).inicio,
    purpose: ESCRITORIO, unitCost: "11.1", totalCost: "888", costSource: "REAL", por: compras });

  // Custo real ZERO, sozinho no seu dia: é custo conhecido, não ausência.
  await consumo({ n: 8, item: papel, quantity: "2", occurredAt: meioDia(DIA(10)), purpose: ESCRITORIO,
    unitCost: "0", totalCost: "0", costSource: "REAL", por: compras });
});

afterAll(async () => {
  const prisma = getPrisma();
  // Antes dos usuários do arquivo, que o ciclo de teste apaga depois.
  if (consumos.length > 0) await prisma.internalConsumption.deleteMany({ where: { id: { in: consumos } } });
  if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
});

async function relatorio(app: App, query: string): Promise<InternalConsumptionReportDTO> {
  const resposta = await app.inject({ method: "GET", url: `/reports/inventory/internal-consumption?${query}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as InternalConsumptionReportDTO;
}

function codigos(dados: InternalConsumptionReportDTO): string[] {
  return dados.rows.map((linha) => linha.code.replace(`CI-R21T-${MARCA}-`, ""));
}

/** CSV da API: BOM, `;`, uma linha por consumo. */
function lerCsv(corpo: string): { cabecalho: string[]; linhas: string[][] } {
  const [cabecalho = [], ...linhas] = corpo
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((linha) => linha.length > 0)
    .map((linha) => linha.split(";"));
  return { cabecalho, linhas };
}

describe("R-21 — resumo e agrupamentos do recorte", () => {
  it("KPIs: só custo conhecido entra no valor, e quantos ficaram de fora sai ao lado", async () => {
    const dados = await relatorio(buildTestApp(), JANELA);

    expect(codigos(dados)).toEqual(["05", "04", "03", "02", "01"]);
    expect(dados.total).toBe(5);
    expect(dados.summary).toEqual({
      consumptionCount: 5,
      knownCostCount: 3,
      missingCostCount: 2,
      // 15 + 5 + 22,5 — os dois sem custo não viram zero somado.
      knownCostTotal: "42.5",
      distinctItemCount: 3,
      reversedConsumptionCount: 0,
    });
  });

  it("resumo por Item: maior valor conhecido primeiro, quantidade na unidade do registro", async () => {
    const { byItem } = await relatorio(buildTestApp(), JANELA);

    expect(byItem).toEqual([
      {
        itemId: detergente.id, itemCode: detergente.code, itemName: detergente.name, uomCode: "kg",
        consumptionCount: 2, quantity: "3.5", knownCostTotal: "22.5", missingCostCount: 1,
      },
      {
        itemId: luva.id, itemCode: luva.code, itemName: luva.name, uomCode: "un",
        consumptionCount: 2, quantity: "14", knownCostTotal: "20", missingCostCount: 0,
      },
      {
        itemId: copo.id, itemCode: copo.code, itemName: copo.name, uomCode: "un",
        consumptionCount: 1, quantity: "3", knownCostTotal: null, missingCostCount: 1,
      },
    ]);
  });

  it("resumo por Destino/uso: pelo texto gravado, e o consumo sem destino tem linha própria", async () => {
    const { byPurpose } = await relatorio(buildTestApp(), JANELA);

    expect(byPurpose).toEqual([
      { purpose: LIMPEZA, consumptionCount: 2, knownCostTotal: "27.5", missingCostCount: 0 },
      { purpose: ESCRITORIO, consumptionCount: 2, knownCostTotal: "15", missingCostCount: 1 },
      { purpose: null, consumptionCount: 1, knownCostTotal: null, missingCostCount: 1 },
    ]);
  });

  it("recorte só com consumo sem custo: valor null, nunca \"0\"; custo real zero é conhecido", async () => {
    const app = buildTestApp();

    const semCusto = await relatorio(app, `${JANELA}&costSource=NO_COST`);
    expect(codigos(semCusto)).toEqual(["05", "04"]);
    expect(semCusto.summary).toMatchObject({ knownCostCount: 0, missingCostCount: 2, knownCostTotal: null });
    for (const linha of semCusto.rows) {
      expect(linha.unitCost).toBeNull();
      expect(linha.totalCost).toBeNull();
    }
    expect(semCusto.byItem.map((grupo) => grupo.knownCostTotal)).toEqual([null, null]);

    const zeroReal = await relatorio(app, `from=${DIA(10)}&to=${DIA(10)}`);
    expect(codigos(zeroReal)).toEqual(["08"]);
    expect(zeroReal.summary).toMatchObject({ knownCostCount: 1, missingCostCount: 0, knownCostTotal: "0" });
  });

  it("recorte vazio: zero consumos e valor null", async () => {
    const dados = await relatorio(buildTestApp(), `${JANELA}&search=nada-${MARCA}`);
    expect(dados.rows).toEqual([]);
    expect(dados.summary).toEqual({
      consumptionCount: 0,
      knownCostCount: 0,
      missingCostCount: 0,
      knownCostTotal: null,
      distinctItemCount: 0,
      reversedConsumptionCount: 0,
    });
    expect(dados.byItem).toEqual([]);
    expect(dados.byPurpose).toEqual([]);
  });

  it("custo é o do registro: o item sem compra nenhuma hoje segue com o custo gravado", async () => {
    // A hierarquia, perguntada HOJE, não acha custo para a luva...
    const hoje = await getConsumedLotCostReference(getPrisma(), {
      itemId: luva.id,
      lotId: null,
      consumedAt: new Date(),
    });
    expect(hoje.source).toBe("NO_COST");

    // ...e o relatório continua com o que foi congelado no consumo.
    const dados = await relatorio(buildTestApp(), `${JANELA}&itemId=${luva.id}`);
    const primeiro = dados.rows.find((linha) => linha.code.endsWith("-01"));
    expect(primeiro).toMatchObject({ unitCost: "1.5", totalCost: "15", costSource: "REAL" });
    expect(dados.summary.knownCostTotal).toBe("20");
  });
});

describe("R-21 — cada filtro corta linhas, resumo e agrupamentos juntos", () => {
  it("período por dia comercial: o consumo de dia passado, gravado no fim do dia, é do seu dia", async () => {
    const app = buildTestApp();

    expect(codigos(await relatorio(app, `from=${ATE}&to=${ATE}`))).toEqual(["05"]);
    expect(codigos(await relatorio(app, `from=${DE}&to=${DIA(3)}`))).toEqual(["04", "03", "02", "01"]);
    // O começo do dia seguinte não é do dia anterior.
    expect(codigos(await relatorio(app, `from=${DIA(5)}&to=${DIA(5)}`))).toEqual(["07"]);
    expect(codigos(await relatorio(app, `from=${DIA(-1)}&to=${DIA(-1)}`))).toEqual(["06"]);
  });

  it("Item", async () => {
    const dados = await relatorio(buildTestApp(), `${JANELA}&itemId=${detergente.id}`);
    expect(codigos(dados)).toEqual(["05", "03"]);
    expect(dados.summary).toMatchObject({ consumptionCount: 2, knownCostTotal: "22.5", missingCostCount: 1 });
    expect(dados.byItem.map((grupo) => grupo.itemId)).toEqual([detergente.id]);
  });

  it("Destino/uso: o texto exato", async () => {
    const app = buildTestApp();
    const dados = await relatorio(app, `${JANELA}&purpose=${encodeURIComponent(LIMPEZA)}`);
    expect(codigos(dados)).toEqual(["03", "02"]);
    expect(dados.summary).toMatchObject({ consumptionCount: 2, knownCostTotal: "27.5", distinctItemCount: 2 });
    expect(dados.byPurpose.map((grupo) => grupo.purpose)).toEqual([LIMPEZA]);

    // Parte do texto não é o destino: o filtro é exato, como o agrupamento.
    const parcial = await relatorio(app, `${JANELA}&purpose=${encodeURIComponent(`Limpeza`)}`);
    expect(codigos(parcial)).toEqual([]);
  });

  it("Usuário: quem registrou", async () => {
    const dados = await relatorio(buildTestApp(), `${JANELA}&registeredByUserId=${producao.id}`);
    expect(codigos(dados)).toEqual(["04", "02"]);
    expect(dados.rows.every((linha) => linha.registeredByUserId === producao.id)).toBe(true);
    expect(dados.summary).toMatchObject({ consumptionCount: 2, knownCostTotal: "5", missingCostCount: 1 });
  });

  it("Origem do custo", async () => {
    const dados = await relatorio(buildTestApp(), `${JANELA}&costSource=ESTIMATED_30D`);
    expect(codigos(dados)).toEqual(["02"]);
    expect(dados.summary).toMatchObject({ knownCostTotal: "5" });
  });

  it("com custo / sem custo", async () => {
    const app = buildTestApp();

    const comCusto = await relatorio(app, `${JANELA}&hasCost=true`);
    expect(codigos(comCusto)).toEqual(["03", "02", "01"]);
    expect(comCusto.summary).toMatchObject({ knownCostCount: 3, missingCostCount: 0, knownCostTotal: "42.5" });

    const semCusto = await relatorio(app, `${JANELA}&hasCost=false`);
    expect(codigos(semCusto)).toEqual(["05", "04"]);
    expect(semCusto.summary).toMatchObject({ knownCostCount: 0, missingCostCount: 2, knownCostTotal: null });
  });

  it("busca: código CI- e código/nome do Item, sem caixa — não o destino", async () => {
    const app = buildTestApp();

    expect(codigos(await relatorio(app, `${JANELA}&search=${`ci-r21t-${MARCA}-03`.toLowerCase()}`))).toEqual(["03"]);
    expect(codigos(await relatorio(app, `${JANELA}&search=${encodeURIComponent("detergente NEUTRO")}`))).toEqual([
      "05",
      "03",
    ]);
    expect(codigos(await relatorio(app, `${JANELA}&search=${copo.code}`))).toEqual(["04"]);
    expect(codigos(await relatorio(app, `${JANELA}&search=${encodeURIComponent(LIMPEZA)}`))).toEqual([]);
  });

  it("filtros compostos em AND", async () => {
    const dados = await relatorio(
      buildTestApp(),
      `${JANELA}&purpose=${encodeURIComponent(ESCRITORIO)}&registeredByUserId=${compras.id}&hasCost=false`,
    );
    expect(codigos(dados)).toEqual(["05"]);
  });

  it("valor fora do contrato é 400, não relatório vazio", async () => {
    const app = buildTestApp();
    for (const query of [
      `${JANELA}&costSource=CUSTO_INVENTADO`,
      `${JANELA}&hasCost=sim`,
      `from=${ATE}&to=${DE}`,
      `from=${DE}T00:00:00.000Z`,
    ]) {
      const resposta = await app.inject({ method: "GET", url: `/reports/inventory/internal-consumption?${query}` });
      expect(resposta.statusCode, query).toBe(400);
    }
  });
});

describe("R-21 — paginação", () => {
  it("a página muda as linhas; total, resumo e agrupamentos são do recorte inteiro", async () => {
    const app = buildTestApp();
    const paginas = await Promise.all(
      [1, 2, 3].map((page) => relatorio(app, `${JANELA}&page=${page}&pageSize=2`)),
    );

    expect(paginas.map(codigos)).toEqual([["05", "04"], ["03", "02"], ["01"]]);
    for (const pagina of paginas) {
      expect(pagina.total).toBe(5);
      expect(pagina.pageSize).toBe(2);
      expect(pagina.summary.knownCostTotal).toBe("42.5");
      expect(pagina.byItem).toHaveLength(3);
      expect(pagina.byPurpose).toHaveLength(3);
    }

    const tudo = await relatorio(app, `${JANELA}&pageSize=2&all=true`);
    expect(codigos(tudo)).toEqual(["05", "04", "03", "02", "01"]);
  });
});

describe("R-21 — CSV com o mesmo recorte", () => {
  it("mesmas linhas do JSON, inteiras (sem página), com o custo gravado e o sem custo vazio", async () => {
    const app = buildTestApp();
    const query = `${JANELA}&purpose=${encodeURIComponent(ESCRITORIO)}`;

    const json = await relatorio(app, query);
    const resposta = await app.inject({
      method: "GET",
      url: `/reports/inventory/internal-consumption/export.csv?${query}&page=2&pageSize=1`,
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-type"]).toContain("text/csv");
    expect(resposta.headers["content-disposition"]).toContain(`veridi_r21_uso_e_consumo_`);

    const { cabecalho, linhas } = lerCsv(resposta.body);
    expect(cabecalho).toEqual([
      "Data", "Consumo", "Item", "Descrição", "Lote", "Quantidade original", "Quantidade estornada",
      "Quantidade líquida", "Unidade", "Destino/uso", "Custo unitário", "Custo total", "Custo total líquido",
      "Origem do custo", "Situação", "Usuário", "Observação",
    ]);
    // Mesmo recorte do JSON, na mesma ordem — a página da tela não corta o arquivo.
    expect(linhas.map((linha) => linha[1])).toEqual(json.rows.map((linha) => linha.code));
    expect(linhas).toEqual([
      [diaNoCsv(DIA(4)), `CI-R21T-${MARCA}-05`, detergente.code, detergente.name, "", "1", "0", "1", "kg",
        ESCRITORIO, "", "", "", "Sem custo", "—", compras.name, ""],
      [diaNoCsv(DIA(0)), `CI-R21T-${MARCA}-01`, luva.code, luva.name, "", "10", "0", "10", "un", ESCRITORIO, "1,5",
        "15", "15", "Real", "—", compras.name, "Reposição do armário"],
    ]);
  });

  it("filtro recusado no JSON é recusado no CSV", async () => {
    const resposta = await buildTestApp().inject({
      method: "GET",
      url: `/reports/inventory/internal-consumption/export.csv?from=${ATE}&to=${DE}`,
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe("R-21 — leitura e permissões", () => {
  const ROTAS = [
    `/reports/inventory/internal-consumption?${JANELA}`,
    `/reports/inventory/internal-consumption/export.csv?${JANELA}`,
    "/reports/inventory/internal-consumption/filter-options",
  ];

  it("sem sessão, 401 nas três rotas", async () => {
    const app = buildApp();
    await app.ready();
    for (const url of ROTAS) {
      const resposta = await app.inject({ method: "GET", url });
      expect(resposta.statusCode, url).toBe(401);
    }
    await app.close();
  });

  it("perfil de consulta (VIEWER) lê o relatório, o CSV e as opções — como lê o histórico da Fatia 2", async () => {
    const app = buildTestApp("VIEWER");
    for (const url of ROTAS) {
      const resposta = await app.inject({ method: "GET", url });
      expect(resposta.statusCode, url).toBe(200);
    }
  });

  it("opções de filtro: destinos já escritos e quem já registrou", async () => {
    const resposta = await buildTestApp("COMMERCIAL").inject({
      method: "GET",
      url: "/reports/inventory/internal-consumption/filter-options",
    });
    expect(resposta.statusCode).toBe(200);
    const opcoes = resposta.json() as InternalConsumptionReportFilterOptionsDTO;

    expect(opcoes.purposes).toEqual(expect.arrayContaining([ESCRITORIO, LIMPEZA]));
    expect(opcoes.purposes).not.toContain(null);
    expect(opcoes.users).toEqual(
      expect.arrayContaining([
        { id: compras.id, name: compras.name },
        { id: producao.id, name: producao.name },
      ]),
    );
  });
});
