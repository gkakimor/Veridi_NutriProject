import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CostSource, InternalConsumption, Item, UomDimension, User } from "@prisma/client";
import type { InternalConsumptionReportDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS, diaCivilDeslocado, hojeComercial, limitesDoDiaComercial } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * R-21 LÍQUIDO DOS ESTORNOS — INTERNAL-CONSUMPTION-REVERSAL-01 (decisão R21-a).
 *
 * O estorno abate o consumo NA DATA DO CI: a linha continua sendo o CI, com
 * quantidade original, estornada e líquida, custo total original e líquido e
 * a situação; indicadores e agrupamentos são líquidos; o CI estornado por
 * inteiro continua listado mas não conta em Consumos, Sem custo nem Itens
 * distintos; "N consumos com estorno" sai no resumo.
 *
 * Consumos e estornos gravados direto no banco, com custo escolhido, numa
 * janela de dias sorteada entre 2013 e 2019 — longe da janela do outro
 * arquivo do R-21 (2004–2012) e de todo consumo "hoje". O estorno é de HOJE:
 * é isso que prova que ele vale na data do CI, não na dele.
 */

type App = ReturnType<typeof buildTestApp>;

const MARCA = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const BASE = diaCivilDeslocado("2013-01-07", Math.floor(Math.random() * 2500));
const DIA = (deslocamento: number) => diaCivilDeslocado(BASE, deslocamento);
const JANELA = `from=${DIA(0)}&to=${DIA(4)}`;
const ESCRITORIO = `Escritório ${MARCA}`;
const LIMPEZA = `Limpeza ${MARCA}`;

function meioDia(dia: string): Date {
  return new Date(limitesDoDiaComercial(dia).inicio.getTime() + 12 * 60 * 60 * 1000);
}

const itens: string[] = [];
const consumos: string[] = [];

let luva: Item;
let detergente: Item;
let copo: Item;
let quem: User;
const ci: Record<"A" | "B" | "C" | "D" | "E", InternalConsumption> = {} as never;
let sequencia = 0;

async function criarItem(nome: string, unitCode: string): Promise<Item> {
  const item = await getPrisma().item.create({
    data: {
      type: "INTERNAL_CONSUMABLE",
      code: `UC-R21E-${MARCA}-${itens.length + 1}`,
      name: `${nome} R21E ${MARCA}`,
      unitCode,
      ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
      active: true,
    },
  });
  itens.push(item.id);
  return item;
}

async function consumo(dados: {
  letra: "A" | "B" | "C" | "D" | "E";
  item: Item;
  quantity: string;
  dia: string;
  purpose: string | null;
  unitCost: string | null;
  totalCost: string | null;
  costSource: CostSource;
}) {
  const registro = await getPrisma().internalConsumption.create({
    data: {
      code: `CI-R21E-${MARCA}-${dados.letra}`,
      itemId: dados.item.id,
      quantity: dados.quantity,
      uomCode: dados.item.unitCode,
      occurredAt: meioDia(dados.dia),
      purpose: dados.purpose,
      unitCost: dados.unitCost,
      totalCost: dados.totalCost,
      costSource: dados.costSource,
      registeredByUserId: quem.id,
      registeredByNameSnapshot: quem.name,
    },
  });
  consumos.push(registro.id);
  ci[dados.letra] = registro;
  return registro;
}

/** Um estorno de HOJE, com a entrada dele no ledger — a FK 1:1 é obrigatória. */
async function estorno(consumo: InternalConsumption, quantity: string, totalCost: string | null) {
  const prisma = getPrisma();
  sequencia += 1;
  const entrada = await prisma.inventoryMovement.create({
    data: {
      itemId: consumo.itemId,
      type: "INTERNAL_CONSUMPTION_REVERSAL",
      quantity,
      occurredAt: new Date(),
      sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
      reason: "Estorno do teste",
    },
  });
  await prisma.internalConsumptionReversal.create({
    data: {
      code: `ECI-R21E-${MARCA}-${sequencia}`,
      originalConsumptionId: consumo.id,
      quantity,
      reason: "Estorno do teste",
      unitCost: consumo.unitCost,
      totalCost,
      costSource: consumo.costSource,
      costDetails: consumo.costDetails,
      inventoryMovementId: entrada.id,
      registeredByUserId: quem.id,
      registeredByNameSnapshot: quem.name,
    },
  });
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
  quem = (await createAuthenticatedUser("QUALITY")).user;
  luva = await criarItem("Luva", "un");
  detergente = await criarItem("Detergente", "kg");
  copo = await criarItem("Copo", "un");

  // A: parcial — 4 de 10 (6 de 15).
  await consumo({ letra: "A", item: luva, quantity: "10", dia: DIA(0), purpose: ESCRITORIO,
    unitCost: "1.5", totalCost: "15", costSource: "REAL" });
  await estorno(ci.A, "4", "6");
  // B: estornado por inteiro, com custo.
  await consumo({ letra: "B", item: luva, quantity: "4", dia: DIA(1), purpose: LIMPEZA,
    unitCost: "1.25", totalCost: "5", costSource: "ESTIMATED_30D" });
  await estorno(ci.B, "1", "1.25");
  await estorno(ci.B, "3", "3.75");
  // C: estornado por inteiro, sem custo, sem destino.
  await consumo({ letra: "C", item: copo, quantity: "3", dia: DIA(2), purpose: null,
    unitCost: null, totalCost: null, costSource: "NO_COST" });
  await estorno(ci.C, "3", null);
  // D: sem estorno.
  await consumo({ letra: "D", item: detergente, quantity: "2.5", dia: DIA(3), purpose: LIMPEZA,
    unitCost: "9", totalCost: "22.5", costSource: "LAST_REAL_COST" });
  // E: parcial, sem custo.
  await consumo({ letra: "E", item: copo, quantity: "2", dia: DIA(4), purpose: ESCRITORIO,
    unitCost: null, totalCost: null, costSource: "NO_COST" });
  await estorno(ci.E, "1", null);
});

afterAll(async () => {
  const prisma = getPrisma();
  // Estorno antes do CI (RESTRICT) e antes dos usuários do arquivo.
  if (consumos.length > 0) {
    await prisma.internalConsumptionReversal.deleteMany({ where: { originalConsumptionId: { in: consumos } } });
    await prisma.internalConsumption.deleteMany({ where: { id: { in: consumos } } });
  }
  if (itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
});

async function relatorio(app: App, query: string): Promise<InternalConsumptionReportDTO> {
  const resposta = await app.inject({ method: "GET", url: `/reports/inventory/internal-consumption?${query}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as InternalConsumptionReportDTO;
}

const letra = (codigo: string) => codigo.replace(`CI-R21E-${MARCA}-`, "");

describe("R-21 líquido — a linha é o CI, com o estorno ao lado", () => {
  it("todas as linhas continuam listadas — inclusive as estornadas por inteiro — com original, estornado, líquido e situação", async () => {
    const dados = await relatorio(buildTestApp("VIEWER"), JANELA);

    expect(dados.rows.map((linha) => letra(linha.code))).toEqual(["E", "D", "C", "B", "A"]);
    expect(dados.total).toBe(5);
    const porLetra = new Map(dados.rows.map((linha) => [letra(linha.code), linha]));
    expect(porLetra.get("A")).toMatchObject({
      quantity: "10", reversedQuantity: "4", reversibleQuantity: "6",
      totalCost: "15", reversedTotalCost: "6", netTotalCost: "9",
      reversalStatus: "PARTIALLY_REVERSED", reversalCount: 1,
    });
    expect(porLetra.get("B")).toMatchObject({
      quantity: "4", reversedQuantity: "4", reversibleQuantity: "0",
      totalCost: "5", reversedTotalCost: "5", netTotalCost: "0",
      reversalStatus: "REVERSED", reversalCount: 2,
    });
    expect(porLetra.get("C")).toMatchObject({
      reversedQuantity: "3", reversibleQuantity: "0",
      totalCost: null, reversedTotalCost: null, netTotalCost: null,
      reversalStatus: "REVERSED",
    });
    expect(porLetra.get("D")).toMatchObject({
      reversedQuantity: "0", reversibleQuantity: "2.5",
      totalCost: "22.5", reversedTotalCost: "0", netTotalCost: "22.5",
      reversalStatus: "NOT_REVERSED", reversalCount: 0,
    });
    expect(porLetra.get("E")).toMatchObject({
      reversedQuantity: "1", reversibleQuantity: "1", netTotalCost: null, reversalStatus: "PARTIALLY_REVERSED",
    });
  });
});

describe("R-21 líquido — indicadores e agrupamentos", () => {
  it("KPIs líquidos: estornado por inteiro não conta; N consumos com estorno", async () => {
    const dados = await relatorio(buildTestApp(), JANELA);

    expect(dados.summary).toEqual({
      // A, D e E — B e C foram estornados por inteiro.
      consumptionCount: 3,
      knownCostCount: 2,
      missingCostCount: 1,
      // A líquido (9) + D (22,5); B estornado fecha em zero.
      knownCostTotal: "31.5",
      // luva (A), detergente (D) e copo (E).
      distinctItemCount: 3,
      reversedConsumptionCount: 4,
    });
  });

  it("resumo por Item: quantidade e valor líquidos; grupo todo estornado sai", async () => {
    const { byItem } = await relatorio(buildTestApp(), JANELA);

    expect(byItem).toEqual([
      {
        itemId: detergente.id, itemCode: detergente.code, itemName: detergente.name, uomCode: "kg",
        consumptionCount: 1, quantity: "2.5", knownCostTotal: "22.5", missingCostCount: 0,
      },
      {
        itemId: luva.id, itemCode: luva.code, itemName: luva.name, uomCode: "un",
        consumptionCount: 1, quantity: "6", knownCostTotal: "9", missingCostCount: 0,
      },
      {
        itemId: copo.id, itemCode: copo.code, itemName: copo.name, uomCode: "un",
        consumptionCount: 1, quantity: "1", knownCostTotal: null, missingCostCount: 1,
      },
    ]);
  });

  it("resumo por Destino/uso: líquido; o destino só com consumo estornado por inteiro sai", async () => {
    const { byPurpose } = await relatorio(buildTestApp(), JANELA);

    expect(byPurpose).toEqual([
      { purpose: LIMPEZA, consumptionCount: 1, knownCostTotal: "22.5", missingCostCount: 0 },
      { purpose: ESCRITORIO, consumptionCount: 2, knownCostTotal: "9", missingCostCount: 1 },
    ]);
  });

  it("recorte só com consumo estornado por inteiro: listado, e nada a somar", async () => {
    const dados = await relatorio(buildTestApp(), `${JANELA}&search=${encodeURIComponent(ci.B.code)}`);

    expect(dados.rows.map((linha) => letra(linha.code))).toEqual(["B"]);
    expect(dados.total).toBe(1);
    expect(dados.summary).toEqual({
      consumptionCount: 0,
      knownCostCount: 0,
      missingCostCount: 0,
      knownCostTotal: null,
      distinctItemCount: 0,
      reversedConsumptionCount: 1,
    });
    expect(dados.byItem).toEqual([]);
    expect(dados.byPurpose).toEqual([]);
  });

  it("os filtros continuam pelo CI: sem custo traz C e E, e só E conta", async () => {
    const dados = await relatorio(buildTestApp(), `${JANELA}&hasCost=false`);

    expect(dados.rows.map((linha) => letra(linha.code))).toEqual(["E", "C"]);
    expect(dados.summary).toMatchObject({
      consumptionCount: 1,
      knownCostCount: 0,
      missingCostCount: 1,
      knownCostTotal: null,
      reversedConsumptionCount: 2,
    });
  });

  it("o estorno vale na data do CI: o período de hoje não o mostra, e a página não muda os números", async () => {
    const app = buildTestApp();
    const hoje = hojeComercial();
    const deHoje = await relatorio(app, `from=${hoje}&to=${hoje}&search=${encodeURIComponent(`R21E-${MARCA}`)}`);
    expect(deHoje.rows).toEqual([]);

    const paginas = await Promise.all([1, 2, 3].map((page) => relatorio(app, `${JANELA}&page=${page}&pageSize=2`)));
    expect(paginas.map((pagina) => pagina.rows.map((linha) => letra(linha.code)))).toEqual([
      ["E", "D"],
      ["C", "B"],
      ["A"],
    ]);
    for (const pagina of paginas) {
      expect(pagina.total).toBe(5);
      expect(pagina.summary.knownCostTotal).toBe("31.5");
      expect(pagina.summary.reversedConsumptionCount).toBe(4);
    }
  });
});

describe("R-21 líquido — CSV", () => {
  it("as colunas novas acompanham, e a soma do custo líquido é o valor da tela", async () => {
    const resposta = await buildTestApp().inject({
      method: "GET",
      url: `/reports/inventory/internal-consumption/export.csv?${JANELA}`,
    });
    expect(resposta.statusCode).toBe(200);
    const [cabecalho = [], ...linhas] = resposta.body
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((linha) => linha.length > 0)
      .map((linha) => linha.split(";"));
    const coluna = (nome: string) => {
      const indice = cabecalho.indexOf(nome);
      expect(indice, nome).toBeGreaterThanOrEqual(0);
      return indice;
    };
    const daLetra = (valor: string) => linhas.find((linha) => linha[coluna("Consumo")] === `CI-R21E-${MARCA}-${valor}`)!;

    expect(
      ["Quantidade original", "Quantidade estornada", "Quantidade líquida", "Custo total", "Custo total líquido", "Situação"].map(
        (nome) => daLetra("A")[coluna(nome)],
      ),
    ).toEqual(["10", "4", "6", "15", "9", "Estornado parcialmente"]);
    expect(daLetra("B")[coluna("Situação")]).toBe("Estornado");
    expect(daLetra("B")[coluna("Custo total líquido")]).toBe("0");
    expect(daLetra("C")[coluna("Custo total líquido")]).toBe("");
    expect(daLetra("D")[coluna("Situação")]).toBe("—");

    const somaLiquida = linhas
      .map((linha) => linha[coluna("Custo total líquido")] ?? "")
      .filter((valor) => valor !== "")
      .reduce((soma, valor) => soma + Number(valor.replace(",", ".")), 0);
    expect(somaLiquida).toBe(31.5);
  });
});
