import { randomUUID } from "node:crypto";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diaCivilDeslocado, hojeComercial } from "@veridi/shared";
import type {
  InventoryMovementListResponse,
  MovementReportRowDTO,
  StockCountDetailDTO,
  StockCountErrorBody,
  StockCountListResponse,
  StockCountPositionDTO,
  StockCountPositionMovementsDTO,
  StockCountPreviewDTO,
  StockCountResultDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Inventário Físico — o que as telas da Fatia 2B pedem da API
 * (INVENTORY-PHYSICAL-COUNT-01, Fatia 2B).
 *
 * A Fatia 1 provou recontagem, decisão, guardas de saldo e a Contagem rápida.
 * Aqui ficam só as leituras e guardas novas de que a tela depende: os
 * movimentos da posição depois da referência (com "depois da contagem" e
 * "retroativo"), o encerramento recusado quando os ajustes não são os que a
 * tela mostrou, o `INV-` nos movimentos (lista, R-03 e CSV), o resultado da
 * Contagem rápida na lista e os filtros de lote do escopo.
 *
 * Todo escopo é restrito a itens e lotes deste arquivo: outros arquivos
 * escrevem no mesmo banco de teste ao mesmo tempo.
 */

type App = ReturnType<typeof buildTestApp>;

const itensCriados: string[] = [];

function marca(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** O relógio do processo carimba referência e `createdAt`: um passo de milissegundos separa os instantes. */
function esperar(ms = 15): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (itensCriados.length === 0) return;
  const posicoes = await prisma.stockCountPosition.findMany({
    where: { itemId: { in: itensCriados } },
    select: { stockCountId: true },
  });
  const sessoes = [...new Set(posicoes.map((posicao) => posicao.stockCountId))];
  if (sessoes.length > 0) await prisma.stockCount.deleteMany({ where: { id: { in: sessoes } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itensCriados } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: itensCriados } } });
  await prisma.item.deleteMany({ where: { id: { in: itensCriados } } });
});

async function criarItem(opcoes: { controlsLot?: boolean } = {}) {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-INV2B-${m}`,
      name: `Insumo revisão do inventário ${m}`,
      unitCode: "kg",
      controlsLot: opcoes.controlsLot ?? false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itensCriados.push(item.id);
  return item;
}

function diaDeValidade(deslocamento: number): Date {
  return new Date(`${diaCivilDeslocado(hojeComercial(), deslocamento)}T00:00:00.000Z`);
}

async function criarLote(
  itemId: string,
  dados: { location?: string; status?: "AVAILABLE" | "BLOCKED" | "AWAITING_RELEASE"; validadeEmDias?: number } = {},
) {
  return getPrisma().lot.create({
    data: {
      code: `LT-INV2B-${marca()}`,
      itemId,
      initialReceivedQuantity: "0",
      status: dados.status ?? "AVAILABLE",
      location: dados.location ?? null,
      expiryDate: dados.validadeEmDias === undefined ? null : diaDeValidade(dados.validadeEmDias),
    },
  });
}

async function movimentar(
  itemId: string,
  lotId: string | null,
  type: "RECEIPT_IN" | "PRODUCTION_CONSUMPTION",
  quantity: string,
  occurredAt: Date = new Date(),
): Promise<string> {
  const movimento = await getPrisma().inventoryMovement.create({
    data: {
      itemId,
      lotId,
      type,
      quantity,
      occurredAt,
      sourceType: type === "RECEIPT_IN" ? "RECEIPT" : "PRODUCTION_CONSUMPTION",
      createdBy: "Teste",
    },
  });
  return movimento.id;
}

async function iniciar(app: App, corpo: Record<string, unknown>): Promise<StockCountDetailDTO> {
  const resposta = await app.inject({ method: "POST", url: "/stock-counts/sessions", payload: corpo });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json();
}

async function ler(app: App, id: string, view: "review" | "counting" = "review"): Promise<StockCountDetailDTO> {
  const resposta = await app.inject({ method: "GET", url: `/stock-counts/${id}?view=${view}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

async function contar(
  app: App,
  sessaoId: string,
  posicao: Pick<StockCountPositionDTO, "id" | "currentRound" | "lastEntryId">,
  countedQuantity: string,
): Promise<void> {
  const resposta = await app.inject({
    method: "POST",
    url: `/stock-counts/${sessaoId}/positions/${posicao.id}/entries`,
    payload: {
      round: posicao.currentRound,
      expectedLastEntryId: posicao.lastEntryId,
      countedQuantity,
      clientRequestId: randomUUID(),
    },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
}

function comando(app: App, sessaoId: string, acao: string, payload?: InjectOptions["payload"]) {
  const pedido: InjectOptions = { method: "POST", url: `/stock-counts/${sessaoId}/${acao}` };
  if (payload !== undefined) pedido.payload = payload;
  return app.inject(pedido);
}

async function movimentosDaPosicao(app: App, sessaoId: string, positionId: string) {
  const resposta = await app.inject({
    method: "GET",
    url: `/stock-counts/${sessaoId}/positions/${positionId}/movements`,
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json<StockCountPositionMovementsDTO>();
}

function posicaoDoLote(detalhe: StockCountDetailDTO, lotId: string) {
  const posicao = detalhe.positions.find((candidata) => candidata.lotId === lotId);
  if (!posicao) throw new Error("posição não encontrada");
  return posicao;
}

describe("Movimentos da posição depois da referência", { timeout: 30_000 }, () => {
  it("cega: nada antes da revelação; depois, o consumo antes da contagem e o lançamento retroativo depois dela", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    const vizinho = await criarLote(item.id);
    await movimentar(item.id, lote.id, "RECEIPT_IN", "10");
    await movimentar(item.id, vizinho.id, "RECEIPT_IN", "3");

    const sessao = await iniciar(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } });
    await esperar();
    const consumo = await movimentar(item.id, lote.id, "PRODUCTION_CONSUMPTION", "2");
    // Movimento de outro lote do mesmo item não é da posição.
    await movimentar(item.id, vizinho.id, "PRODUCTION_CONSUMPTION", "1");
    await esperar();

    await contar(app, sessao.id, posicaoDoLote(sessao, lote.id), "7");
    await esperar();
    // Chegou fisicamente antes da contagem, lançado depois dela: retroativo.
    const retroativo = await movimentar(item.id, lote.id, "RECEIPT_IN", "5", new Date(Date.now() - 60 * 60 * 1000));

    const antes = await movimentosDaPosicao(app, sessao.id, posicaoDoLote(sessao, lote.id).id);
    expect(antes.balancesHidden).toBe(true);
    expect(antes.movements).toEqual([]);
    expect(antes.total).toBe(0);

    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);
    const revisao = await ler(app, sessao.id);
    const posicao = posicaoDoLote(revisao, lote.id);
    expect(posicao.hasConcurrentMovement).toBe(true);

    const depois = await movimentosDaPosicao(app, sessao.id, posicao.id);
    expect(depois.balancesHidden).toBe(false);
    expect(depois.countedAt).not.toBeNull();
    expect(depois.total).toBe(2);
    expect(depois.movements.map((movimento) => [movimento.id, movimento.afterCount, movimento.retroactive])).toEqual([
      [consumo, false, false],
      [retroativo, true, true],
    ]);
    expect(depois.movements[0]).toMatchObject({ type: "PRODUCTION_CONSUMPTION", quantity: "2", lotId: lote.id });
  });

  it("posição de outro inventário é 404 com o código da recusa", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "4");
    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });

    const resposta = await app.inject({
      method: "GET",
      url: `/stock-counts/${randomUUID()}/positions/${sessao.positions[0]!.id}/movements`,
    });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json<StockCountErrorBody>().error).toBe("position_not_found");
    await comando(app, sessao.id, "cancel", { reason: "Limpeza do teste" });
  });
});

describe("Encerramento com os ajustes que a tela mostrou", { timeout: 30_000 }, () => {
  it("conjunto diferente recusa sem gravar nada; o mesmo conjunto encerra e o INV- aparece nos movimentos", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const ajustar = await criarLote(item.id);
    const naoAjustar = await criarLote(item.id);
    await movimentar(item.id, ajustar.id, "RECEIPT_IN", "10");
    await movimentar(item.id, naoAjustar.id, "RECEIPT_IN", "4");

    const sessao = await iniciar(app, {
      mode: "ASSISTED",
      scope: { balance: "WITH_BALANCE", lotIds: [ajustar.id, naoAjustar.id] },
    });
    await contar(app, sessao.id, posicaoDoLote(sessao, ajustar.id), "9");
    await contar(app, sessao.id, posicaoDoLote(sessao, naoAjustar.id), "6");
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);

    const revisao = await ler(app, sessao.id);
    const posicaoAjustada = posicaoDoLote(revisao, ajustar.id);
    const posicaoSemAjuste = posicaoDoLote(revisao, naoAjustar.id);
    const decisao = await comando(app, sessao.id, "decisions", {
      decisions: [
        { positionId: posicaoAjustada.id, decision: "ADJUST", reason: "Avaria na embalagem" },
        { positionId: posicaoSemAjuste.id, decision: "NO_ADJUSTMENT", reason: "Etiqueta trocada" },
      ],
    });
    expect(decisao.statusCode, decisao.body).toBe(200);

    // A tela abriu o encerramento antes da decisão de ajustar: mostrou nenhum ajuste.
    const recusa = await comando(app, sessao.id, "complete", { expectedAdjustments: [] });
    expect(recusa.statusCode, recusa.body).toBe(409);
    expect(recusa.json<StockCountErrorBody>().error).toBe("stock_count_changed");
    // Nada gravado: segue em revisão, sem movimento e com a posição retida.
    expect((await ler(app, sessao.id)).status).toBe("IN_REVIEW");
    expect(
      await getPrisma().inventoryMovement.count({ where: { itemId: item.id, sourceType: "STOCK_COUNT" } }),
    ).toBe(0);
    const previa = await app.inject({
      method: "POST",
      url: "/stock-counts/preview",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [ajustar.id] } },
    });
    expect(previa.json<StockCountPreviewDTO>().heldByOpenCounts.map((retida) => retida.stockCountCode)).toEqual([
      sessao.code,
    ]);

    // Registro trocado também é outro ajuste.
    const outroRegistro = await comando(app, sessao.id, "complete", {
      expectedAdjustments: [{ positionId: posicaoAjustada.id, entryId: randomUUID() }],
    });
    expect(outroRegistro.json<StockCountErrorBody>().error).toBe("stock_count_changed");

    const encerrado = await comando(app, sessao.id, "complete", {
      expectedAdjustments: [{ positionId: posicaoAjustada.id, entryId: posicaoAjustada.validEntryId }],
    });
    expect(encerrado.statusCode, encerrado.body).toBe(200);
    expect(encerrado.json<StockCountDetailDTO>().status).toBe("COMPLETED");

    const movimentos = await app.inject({ method: "GET", url: `/inventory-movements?itemId=${item.id}&pageSize=100` });
    const doInventario = movimentos
      .json<InventoryMovementListResponse>()
      .movements.filter((movimento) => movimento.sourceType === "STOCK_COUNT");
    expect(doInventario).toHaveLength(1);
    expect(doInventario[0]).toMatchObject({
      type: "ADJUSTMENT_OUT",
      quantity: "1",
      lotId: ajustar.id,
      stockCountId: sessao.id,
      stockCountCode: sessao.code,
    });
    // Movimento que não é de inventário continua sem documento de inventário.
    expect(
      movimentos
        .json<InventoryMovementListResponse>()
        .movements.filter((movimento) => movimento.sourceType === "RECEIPT")
        .every((movimento) => movimento.stockCountCode === null),
    ).toBe(true);

    const r03 = await app.inject({ method: "GET", url: `/reports/inventory/movements?itemId=${item.id}&pageSize=100` });
    expect(r03.statusCode, r03.body).toBe(200);
    const linhaDoAjuste = r03
      .json<{ rows: MovementReportRowDTO[] }>()
      .rows.find((linha) => linha.sourceType === "STOCK_COUNT");
    expect(linhaDoAjuste).toMatchObject({ documentKind: "STOCK_COUNT", documentCode: sessao.code, documentId: sessao.id });

    const csv = await app.inject({ method: "GET", url: `/inventory-movements/export.csv?itemId=${item.id}` });
    expect(csv.statusCode).toBe(200);
    const [cabecalho, ...linhas] = csv.body.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(cabecalho).toContain("Inventário");
    expect(linhas.some((linha) => linha.includes(sessao.code))).toBe(true);
  });
});

describe("Contagem rápida na lista e no detalhe", { timeout: 30_000 }, () => {
  it("o resultado traz item, lote, dono, contado, sistema, diferença, ajuste e autor", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    await movimentar(item.id, lote.id, "RECEIPT_IN", "12.5");

    const rapida = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: {
        itemId: item.id,
        lotId: lote.id,
        countedQuantity: "12",
        expectedSystemQuantity: "12.5",
        reason: "Quebra na separação",
      },
    });
    expect(rapida.statusCode, rapida.body).toBe(201);
    const resultado = rapida.json<StockCountResultDTO>();
    expect(resultado.movementCreated?.stockCountCode).toBe(resultado.stockCountCode);

    const lista = await app.inject({
      method: "GET",
      url: `/stock-counts?kind=QUICK&search=${resultado.stockCountCode}`,
    });
    expect(lista.statusCode, lista.body).toBe(200);
    const [linha] = lista.json<StockCountListResponse>().stockCounts;
    expect(linha?.quickResult).toMatchObject({
      itemId: item.id,
      itemCode: item.code,
      lotId: lote.id,
      lotCode: lote.code,
      ownerType: "VERIDI",
      countedQuantity: "12",
      systemQuantity: "12.5",
      difference: "-0.5",
      adjustmentMovementId: resultado.movementCreated?.id,
      adjustmentType: "ADJUSTMENT_OUT",
      adjustmentQuantity: "0.5",
      reason: "Quebra na separação",
    });
    expect(linha?.quickResult?.countedByName).toBeTruthy();

    const detalhe = await ler(app, resultado.stockCountId);
    expect(detalhe.quickResult).toEqual(linha?.quickResult);

    // Inventário em sessão não tem resultado de contagem rápida.
    const sessao = await app.inject({ method: "GET", url: "/stock-counts?kind=SESSION&pageSize=5" });
    expect(sessao.json<StockCountListResponse>().stockCounts.every((resumo) => resumo.quickResult === null)).toBe(true);
  });
});

describe("Filtros de lote no escopo: local, situação e validade", { timeout: 30_000 }, () => {
  it("cada filtro seleciona lotes, e a posição de item sem lote fica fora", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const semLote = await criarItem();
    const vencidoNaCamara = await criarLote(item.id, { location: "Câmara A-03", validadeEmDias: -5 });
    const bloqueadoVencendo = await criarLote(item.id, { location: "B-01", status: "BLOCKED", validadeEmDias: 10 });
    const longe = await criarLote(item.id, { location: "a-03 fundo", validadeEmDias: 100 });
    const hoje = await criarLote(item.id, { location: "C-07", validadeEmDias: 0 });
    for (const lote of [vencidoNaCamara, bloqueadoVencendo, longe, hoje]) {
      await movimentar(item.id, lote.id, "RECEIPT_IN", "1");
    }
    await movimentar(semLote.id, null, "RECEIPT_IN", "1");

    async function chaves(filtros: Record<string, unknown>): Promise<string[]> {
      const resposta = await app.inject({
        method: "POST",
        url: "/stock-counts/preview",
        payload: { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [item.id, semLote.id], ...filtros } },
      });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta
        .json<StockCountPreviewDTO>()
        .positions.map((posicao) => posicao.lotId ?? posicao.itemId)
        .sort();
    }

    expect(await chaves({})).toEqual(
      [vencidoNaCamara.id, bloqueadoVencendo.id, longe.id, hoje.id, semLote.id].sort(),
    );
    expect(await chaves({ locationContains: "A-03" })).toEqual([vencidoNaCamara.id, longe.id].sort());
    expect(await chaves({ lotStatuses: ["BLOCKED"] })).toEqual([bloqueadoVencendo.id]);
    expect(await chaves({ expiry: "EXPIRED" })).toEqual([vencidoNaCamara.id]);
    // O lote vale o dia da validade inteiro: vencendo hoje não está vencido.
    expect(await chaves({ expiry: "NOT_EXPIRED" })).toEqual([bloqueadoVencendo.id, longe.id, hoje.id].sort());
    expect(await chaves({ expiry: "EXPIRING", expiringWithinDays: 30 })).toEqual([bloqueadoVencendo.id, hoje.id].sort());
    expect(await chaves({ locationContains: "a-03", expiry: "NOT_EXPIRED" })).toEqual([longe.id]);

    for (const invalido of [{ expiry: "EXPIRING" }, { expiringWithinDays: 30 }, { expiry: "EXPIRING", expiringWithinDays: 0 }]) {
      const resposta = await app.inject({
        method: "POST",
        url: "/stock-counts/preview",
        payload: { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [item.id], ...invalido } },
      });
      expect(resposta.statusCode, JSON.stringify(invalido)).toBe(400);
    }

    // O início congela o mesmo recorte e o retrato guarda o filtro.
    const sessao = await iniciar(app, {
      mode: "BLIND",
      scope: { balance: "WITH_BALANCE", itemIds: [item.id, semLote.id], lotStatuses: ["BLOCKED"] },
    });
    expect(sessao.positions.map((posicao) => posicao.lotId)).toEqual([bloqueadoVencendo.id]);
    expect(sessao.scopeFilters).toMatchObject({ scope: { lotStatuses: ["BLOCKED"] } });
    await comando(app, sessao.id, "cancel", { reason: "Limpeza do teste" });
  });
});
