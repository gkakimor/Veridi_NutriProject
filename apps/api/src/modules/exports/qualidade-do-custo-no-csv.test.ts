import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CostQuality,
  FinishedGoodRowDTO,
  PlannedActualRowDTO,
  ReceiptReportRowDTO,
} from "@veridi/shared";
import { COST_QUALITY_LABELS } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * "Qualidade do custo" no CSV — e no PDF, que lê o CSV — sai pelo rótulo da
 * tela, nunca pelo enum da API (REPORTS-PRESENTATION-WAVE-02).
 *
 * O R-05 e o R-09 escreviam `REAL`/`ESTIMATED` na coluna; o Produto Acabado,
 * a mesma coluna com o mesmo enum. O read model não muda: o JSON continua
 * devolvendo o enum, e só o arquivo escreve "Real", "Estimado", "Parcial" e
 * "Sem custo". As linhas vêm do serviço simulado para ter as quatro qualidades
 * lado a lado — o fluxo real de OP sem custo segue em `exports.test.ts`.
 */

const servicos = vi.hoisted(() => ({
  planejadoRealizado: vi.fn(),
  recebimentos: vi.fn(),
  produtoAcabado: vi.fn(),
}));

vi.mock("../reports/production-reports.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reports/production-reports.service.js")>()),
  getPlannedActualReport: (...args: unknown[]) => servicos.planejadoRealizado(...args),
}));
vi.mock("../reports/purchasing-reports.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reports/purchasing-reports.service.js")>()),
  getReceiptsReport: (...args: unknown[]) => servicos.recebimentos(...args),
}));
vi.mock("../finished-goods/finished-goods.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../finished-goods/finished-goods.service.js")>()),
  listFinishedGoods: (...args: unknown[]) => servicos.produtoAcabado(...args),
}));

const QUALIDADES: readonly CostQuality[] = ["REAL", "ESTIMATED", "PARTIAL", "NO_COST"];
const ROTULOS = ["Real", "Estimado", "Parcial", "Sem custo"];

function planejadoRealizado(costQuality: CostQuality, indice: number): PlannedActualRowDTO {
  return {
    productionOrderId: `op-${indice}`,
    productionOrderCode: `OP-00000${indice}`,
    productId: `prd-${indice}`,
    productCode: `PROD-00000${indice}`,
    productName: "Whey Protein 900 g",
    formulationVersionNumber: 2,
    plannedQuantity: "100",
    producedQuantity: "98",
    variance: "-2",
    yieldPercent: "98",
    unitCode: "un",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-11T12:00:00.000Z",
    status: "COMPLETED",
    materialUnitCost: costQuality === "REAL" || costQuality === "ESTIMATED" ? "1.25" : null,
    costQuality,
  };
}

function recebimento(costQuality: CostQuality, indice: number): ReceiptReportRowDTO {
  return {
    receiptLineId: `rl-${indice}`,
    receiptId: `rec-${indice}`,
    receiptCode: `REC-00000${indice}`,
    receivedAt: "2026-09-11T12:00:00.000Z",
    purchaseOrderId: `oc-${indice}`,
    purchaseOrderCode: `OC-00000${indice}`,
    supplierId: `for-${indice}`,
    supplierName: "Insumos Sul",
    ownerType: "VERIDI",
    ownerCustomerName: null,
    coaStatus: null,
    itemId: `item-${indice}`,
    itemCode: `MP-00000${indice}`,
    itemName: "Maltodextrina",
    lotId: `lote-${indice}`,
    lotCode: `LT-20260911-00000${indice}`,
    supplierLot: null,
    receivedQuantity: "500",
    unitCode: "kg",
    orderedUnitPrice: "10",
    actualUnitCost: costQuality === "REAL" ? "10.5" : null,
    costQuality,
  };
}

function produtoAcabado(costQuality: CostQuality, indice: number): FinishedGoodRowDTO {
  return {
    lotId: `lote-${indice}`,
    lotCode: `LT-20260911-00000${indice}`,
    businessLotNumber: null,
    productId: `prd-${indice}`,
    productCode: `PROD-00000${indice}`,
    productName: "Whey Protein 900 g",
    itemId: `item-${indice}`,
    itemCode: `PA-00000${indice}`,
    itemName: "Whey Protein 900 g",
    unitCode: "un",
    productionOrderId: `op-${indice}`,
    productionOrderCode: `OP-00000${indice}`,
    producedAt: "2026-09-11T12:00:00.000Z",
    producedQuantity: "98",
    onHand: "98",
    reserved: "0",
    available: "98",
    status: "AVAILABLE",
    isExpired: false,
    expiryDate: null,
    location: null,
    materialUnitCost: costQuality === "REAL" || costQuality === "ESTIMATED" ? "1.25" : null,
    costQuality,
    costSource: null,
  };
}

function pagina<T>(rows: T[]) {
  return { rows, page: 1, pageSize: rows.length, total: rows.length };
}

/** A coluna "Qualidade do custo" de cada linha, e o corpo inteiro para varrer enum. */
function qualidadesDoCsv(corpo: string): string[] {
  const [cabecalho, ...linhas] = corpo
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((linha) => linha.length > 0)
    .map((linha) => linha.split(";"));
  const coluna = cabecalho!.indexOf("Qualidade do custo");
  expect(coluna).toBeGreaterThanOrEqual(0);
  return linhas.map((celulas) => celulas[coluna]!);
}

type App = ReturnType<typeof buildTestApp>;
let app: App;

beforeAll(async () => {
  servicos.planejadoRealizado.mockResolvedValue(pagina(QUALIDADES.map(planejadoRealizado)));
  servicos.recebimentos.mockResolvedValue(pagina(QUALIDADES.map(recebimento)));
  servicos.produtoAcabado.mockResolvedValue(pagina(QUALIDADES.map(produtoAcabado)));
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("Qualidade do custo no CSV: rótulo da tela, nunca enum", () => {
  it("o rótulo esperado é o mapa canônico da tela", () => {
    expect(QUALIDADES.map((qualidade) => COST_QUALITY_LABELS[qualidade])).toEqual(ROTULOS);
  });

  it.each([
    ["R-05", "/reports/production/planned-actual/export.csv?includeCost=true&status=COMPLETED"],
    ["R-09", "/reports/purchasing/receipts/export.csv?from=2026-09-01&to=2026-09-30"],
    ["Produto Acabado", "/finished-goods/export.csv"],
  ])("%s: Real, Estimado, Parcial e Sem custo — nenhum REAL/ESTIMATED/PARTIAL/NO_COST", async (_nome, url) => {
    const resposta = await app.inject({ method: "GET", url });

    expect(resposta.statusCode).toBe(200);
    expect(qualidadesDoCsv(resposta.body)).toEqual(ROTULOS);
    for (const enumCru of QUALIDADES) expect(resposta.body, enumCru).not.toContain(enumCru);
  });

  it("o mesmo filtro chega ao serviço: só a apresentação do arquivo mudou", async () => {
    servicos.planejadoRealizado.mockClear();
    await app.inject({
      method: "GET",
      url: "/reports/production/planned-actual/export.csv?includeCost=true&status=COMPLETED",
    });

    const [filtros] = servicos.planejadoRealizado.mock.calls[0] as [{ includeCost: boolean; status: string }];
    expect(filtros.includeCost).toBe(true);
    expect(filtros.status).toBe("COMPLETED");
  });

  it.each([
    ["R-05", "/reports/production/planned-actual?includeCost=true"],
    ["R-09", "/reports/purchasing/receipts"],
    ["Produto Acabado", "/finished-goods"],
  ])("%s em JSON continua devolvendo o enum: contrato do read model intacto", async (_nome, url) => {
    const resposta = await app.inject({ method: "GET", url });

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json() as { rows: { costQuality: CostQuality }[] };
    expect(corpo.rows.map((linha) => linha.costQuality)).toEqual(QUALIDADES);
  });
});
