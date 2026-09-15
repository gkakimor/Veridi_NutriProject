import { randomUUID } from "node:crypto";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StockCountDetailDTO, StockCountPositionDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getOnHand, getReservedByItems } from "../../lib/inventory-ledger.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";

/**
 * Inventário Físico em sessão (INVENTORY-PHYSICAL-COUNT-01, Fatia 1).
 *
 * O que estes testes seguram é o que decide se o inventário produz saldo
 * certo: o esperado congelado em cada registro, o ajuste aplicado como delta
 * no encerramento, a cegueira feita pelo servidor, o registro que só acrescenta
 * e o conflito explícito entre operadores.
 *
 * Todo escopo é restrito a itens e lotes deste arquivo (`itemIds`/`lotIds`):
 * outros arquivos escrevem no mesmo banco de teste ao mesmo tempo.
 */

type App = ReturnType<typeof buildTestApp>;

const itensCriados: string[] = [];
const clientesCriados: string[] = [];
const produtosCriados: string[] = [];
const ordensCriadas: string[] = [];

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
  await prisma.unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: 1 },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (itensCriados.length > 0) {
    const posicoes = await prisma.stockCountPosition.findMany({
      where: { itemId: { in: itensCriados } },
      select: { stockCountId: true },
    });
    const sessoes = [...new Set(posicoes.map((posicao) => posicao.stockCountId))];
    if (sessoes.length > 0) await prisma.stockCount.deleteMany({ where: { id: { in: sessoes } } });
  }
  if (ordensCriadas.length > 0) {
    const reservas = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: ordensCriadas } },
      select: { id: true },
    });
    const reservaIds = reservas.map((reserva) => reserva.id);
    if (reservaIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservaIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservaIds } } });
    }
    await prisma.productionOrder.deleteMany({ where: { id: { in: ordensCriadas } } });
  }
  if (produtosCriados.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtosCriados } } });
    await prisma.product.deleteMany({ where: { id: { in: produtosCriados } } });
  }
  if (itensCriados.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itensCriados } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itensCriados } } });
    await prisma.item.deleteMany({ where: { id: { in: itensCriados } } });
  }
  if (clientesCriados.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: clientesCriados } } });
  }
});

async function criarItem(opcoes: { controlsLot?: boolean; unitCode?: string } = {}) {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-INVF-${m}`,
      name: `Insumo inventário ${m}`,
      unitCode: opcoes.unitCode ?? "kg",
      controlsLot: opcoes.controlsLot ?? false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itensCriados.push(item.id);
  return item;
}

async function criarCliente() {
  const m = marca();
  const cliente = await getPrisma().customer.create({
    data: { code: `CLI-INVF-${m}`, legalName: `Cliente inventário ${m}`, active: true },
  });
  clientesCriados.push(cliente.id);
  return cliente;
}

async function criarLote(itemId: string, dono?: { customerId: string }) {
  return getPrisma().lot.create({
    data: {
      code: `LT-INVF-${marca()}`,
      itemId,
      initialReceivedQuantity: "0",
      status: "AVAILABLE",
      ...(dono ? { ownerType: "CUSTOMER" as const, ownerCustomerId: dono.customerId } : {}),
    },
  });
}

const ORIGEM = {
  RECEIPT_IN: "RECEIPT",
  PRODUCTION_CONSUMPTION: "PRODUCTION_CONSUMPTION",
} as const;

/** Lançamento de outro módulo no ledger — o inventário nunca bloqueia nenhum deles. */
async function movimentar(
  itemId: string,
  lotId: string | null,
  type: keyof typeof ORIGEM,
  quantity: string,
): Promise<void> {
  await getPrisma().inventoryMovement.create({
    data: { itemId, lotId, type, quantity, occurredAt: new Date(), sourceType: ORIGEM[type], createdBy: "Teste" },
  });
}

async function saldoDe(itemId: string, lotId: string | null = null): Promise<string> {
  return (await getOnHand(getPrisma(), { itemId, lotId })).toString();
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

function registrar(
  app: App,
  sessaoId: string,
  posicao: Pick<StockCountPositionDTO, "id" | "currentRound" | "lastEntryId">,
  countedQuantity: string,
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/stock-counts/${sessaoId}/positions/${posicao.id}/entries`,
    payload: {
      round: posicao.currentRound,
      expectedLastEntryId: posicao.lastEntryId,
      countedQuantity,
      clientRequestId: randomUUID(),
      ...extra,
    },
  });
}

function comando(app: App, sessaoId: string, acao: string, payload?: InjectOptions["payload"]) {
  const pedido: InjectOptions = { method: "POST", url: `/stock-counts/${sessaoId}/${acao}` };
  if (payload !== undefined) pedido.payload = payload;
  return app.inject(pedido);
}

function primeira(detalhe: StockCountDetailDTO): StockCountPositionDTO {
  const [posicao] = detalhe.positions;
  if (!posicao) throw new Error("sessão sem posição");
  return posicao;
}

/** Reserva `quantity` do item pelo ciclo real de OP (produto, formulação, plano, liberação). */
async function reservarPorOrdemDeProducao(app: App, itemId: string, quantity: string): Promise<void> {
  const prisma = getPrisma();
  const acabado = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-INVF-${marca()}`,
      name: `Acabado reserva inventário ${marca()}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itensCriados.push(acabado.id);
  const cliente = await criarCliente();
  const produto = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId: cliente.id, name: `Produto reserva ${marca()}`, finishedProductItemId: acabado.id },
  });
  produtosCriados.push(produto.json().id);
  const versao = await app.inject({
    method: "POST",
    url: `/products/${produto.json().id}/formulation-versions`,
    payload: {},
  });
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.json().id}`,
    payload: { basisQuantity: "1", components: [{ itemId, quantity, unitCode: "kg" }] },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versao.json().id}/activate` });
  const ordem = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId: produto.json().id, plannedQuantity: "1" },
  });
  ordensCriadas.push(ordem.json().id);
  await aplicarRoteiroDeTeste(ordem.json().id);
  await app.inject({ method: "POST", url: `/production-orders/${ordem.json().id}/plan` });
  await app.inject({ method: "POST", url: `/production-orders/${ordem.json().id}/release` });
  const reservado = (await getReservedByItems(getPrisma(), [itemId])).get(itemId);
  expect(reservado?.toString()).toBe(quantity);
}

describe("Saldo esperado congelado por registro e ajuste como delta", { timeout: 30_000 }, () => {
  it("saldo 10, consumo −2, contagem 8: esperado 8, diferença 0, encerramento sem ajuste", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "10");

    const sessao = await iniciar(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    expect(sessao.code).toMatch(/^INV-\d{6}$/);
    expect(sessao.kind).toBe("SESSION");
    expect(sessao.status).toBe("IN_PROGRESS");

    // A produção consome durante o inventário, antes da contagem.
    await movimentar(item.id, null, "PRODUCTION_CONSUMPTION", "2");

    const contagem = await registrar(app, sessao.id, primeira(sessao), "8");
    expect(contagem.statusCode, contagem.body).toBe(201);

    const revisao = await comando(app, sessao.id, "close-first-round");
    expect(revisao.statusCode, revisao.body).toBe(200);
    const posicao = primeira(revisao.json());
    expect(posicao.referenceQuantity).toBe("10");
    expect(posicao.entries).toHaveLength(1);
    expect(posicao.entries[0]?.expectedQuantity).toBe("8");
    expect(posicao.entries[0]?.difference).toBe("0");
    expect(posicao.finalDifference).toBe("0");
    expect(posicao.situation).toBe("MATCHES");
    expect(posicao.hasConcurrentMovement).toBe(true);

    const encerrada = await comando(app, sessao.id, "complete");
    expect(encerrada.statusCode, encerrada.body).toBe(200);
    expect(encerrada.json().status).toBe("COMPLETED");
    expect(encerrada.json().completedByCounter).toBe(true);
    expect(primeira(encerrada.json()).adjustmentMovementId).toBeNull();

    // Nenhum movimento quantitativo: só o recebimento e o consumo.
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: item.id } })).toBe(2);
    expect(await saldoDe(item.id)).toBe("8");
    // A contagem que confere fica registrada no documento.
    expect(await getPrisma().stockCountEntry.count({ where: { positionId: posicao.id } })).toBe(1);

    await app.close();
  });

  it("esperado 8, contagem 7, recebimento +5 depois da contagem: o encerramento aplica −1 e o saldo fica 12", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "10");

    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    await movimentar(item.id, null, "PRODUCTION_CONSUMPTION", "2");

    const contagem = await registrar(app, sessao.id, primeira(sessao), "7");
    expect(contagem.statusCode, contagem.body).toBe(201);
    // Contagem com saldo mostra o esperado desde a primeira rodada.
    expect(contagem.json().entry.expectedQuantity).toBe("8");
    expect(contagem.json().entry.difference).toBe("-1");

    // Depois da contagem, o recebimento entra no ledger e continua valendo.
    await movimentar(item.id, null, "RECEIPT_IN", "5");
    expect(await saldoDe(item.id)).toBe("13");

    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);
    const posicaoId = primeira(sessao).id;

    const semDecisao = await comando(app, sessao.id, "complete");
    expect(semDecisao.statusCode).toBe(409);
    expect(semDecisao.json().issues.map((problema: { issue: string }) => problema.issue)).toEqual(["UNDECIDED"]);

    await comando(app, sessao.id, "decisions", {
      decisions: [{ positionId: posicaoId, decision: "ADJUST", reason: "Avaria na embalagem" }],
    });
    // Divergência com movimentação durante o inventário só fecha recontada ou confirmada.
    const semConfirmacao = await comando(app, sessao.id, "complete");
    expect(semConfirmacao.statusCode).toBe(409);
    expect(semConfirmacao.json().issues[0].issue).toBe("CONCURRENT_MOVEMENT_UNCONFIRMED");

    const decisao = await comando(app, sessao.id, "decisions", {
      decisions: [
        { positionId: posicaoId, decision: "ADJUST", reason: "Avaria na embalagem", confirmConcurrentMovement: true },
      ],
    });
    expect(decisao.statusCode, decisao.body).toBe(200);

    const encerrada = await comando(app, sessao.id, "complete");
    expect(encerrada.statusCode, encerrada.body).toBe(200);

    expect(await saldoDe(item.id)).toBe("12");
    const ajustes = await getPrisma().inventoryMovement.findMany({
      where: { itemId: item.id, sourceType: "STOCK_COUNT" },
    });
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0]?.type).toBe("ADJUSTMENT_OUT");
    expect(ajustes[0]?.quantity.toString()).toBe("1");
    expect(ajustes[0]?.sourceId).toBe(posicaoId);
    expect(ajustes[0]?.reason).toBe("Avaria na embalagem");
    expect(primeira(encerrada.json()).adjustmentMovementId).toBe(ajustes[0]?.id);

    // Encerrado não reabre: nem encerrar de novo, nem cancelar, nem contar.
    expect((await comando(app, sessao.id, "complete")).statusCode).toBe(409);
    expect((await comando(app, sessao.id, "cancel", { reason: "Tentativa depois do fim" })).statusCode).toBe(409);
    const depoisDoFim = await registrar(app, sessao.id, primeira(encerrada.json()), "12");
    expect(depoisDoFim.statusCode).toBe(409);
    expect(depoisDoFim.json().error).toBe("invalid_stock_count_status");
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: item.id, sourceType: "STOCK_COUNT" } })).toBe(
      1,
    );

    await app.close();
  });

  it("ajuste que deixaria o saldo negativo é recusado no encerramento, sem movimento", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "10");

    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    const posicaoId = primeira(sessao).id;
    expect((await registrar(app, sessao.id, primeira(sessao), "2")).statusCode).toBe(201);
    // Consumo depois da contagem: saldo 5, ajuste congelado −8.
    await movimentar(item.id, null, "PRODUCTION_CONSUMPTION", "5");
    await comando(app, sessao.id, "close-first-round");
    await comando(app, sessao.id, "decisions", {
      decisions: [{ positionId: posicaoId, decision: "ADJUST", reason: "Contagem física", confirmConcurrentMovement: true }],
    });

    const recusado = await comando(app, sessao.id, "complete");
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("stock_count_close_blocked");
    expect(recusado.json().issues).toEqual([
      expect.objectContaining({ issue: "NEGATIVE_BALANCE", balance: "5", adjustment: "-8", positionId: posicaoId }),
    ]);
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: item.id, sourceType: "STOCK_COUNT" } })).toBe(
      0,
    );
    expect((await ler(app, sessao.id)).status).toBe("IN_REVIEW");

    // "Não ajustar" com motivo encerra sem mexer no saldo. A posição teve
    // movimentação durante o inventário: fecha recontada ou confirmada, qualquer
    // que seja a decisão.
    await comando(app, sessao.id, "decisions", {
      decisions: [
        {
          positionId: posicaoId,
          decision: "NO_ADJUSTMENT",
          reason: "Separação ainda não lançada",
          confirmConcurrentMovement: true,
        },
      ],
    });
    expect((await comando(app, sessao.id, "complete")).statusCode).toBe(200);
    expect(await saldoDe(item.id)).toBe("5");

    await app.close();
  });

  it("ajuste de saída que deixaria o saldo abaixo do reservado é recusado", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "100");
    await reservarPorOrdemDeProducao(app, item.id, "80");

    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    const posicaoId = primeira(sessao).id;
    expect((await registrar(app, sessao.id, primeira(sessao), "70")).statusCode).toBe(201);
    await comando(app, sessao.id, "close-first-round");
    await comando(app, sessao.id, "decisions", {
      decisions: [{ positionId: posicaoId, decision: "ADJUST", reason: "Contagem física" }],
    });

    const recusado = await comando(app, sessao.id, "complete");
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().issues).toEqual([
      expect.objectContaining({ issue: "BELOW_RESERVED", balance: "100", adjustment: "-30", reserved: "80" }),
    ]);
    expect(await saldoDe(item.id)).toBe("100");

    await app.close();
  });
});

describe("Recontagem só acrescenta", { timeout: 30_000 }, () => {
  it("cada rodada congela o próprio esperado; a primeira contagem fica intacta e vale a última", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    await movimentar(item.id, lote.id, "RECEIPT_IN", "10");

    const sessao = await iniciar(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } });
    const primeiraContagem = await registrar(app, sessao.id, primeira(sessao), "8");
    expect(primeiraContagem.statusCode).toBe(201);
    const primeiroRegistro = await getPrisma().stockCountEntry.findUniqueOrThrow({
      where: { id: primeiraContagem.json().entry.id },
    });
    await comando(app, sessao.id, "close-first-round");

    const pedido = await comando(app, sessao.id, "recounts", { positionIds: [primeira(sessao).id] });
    expect(pedido.statusCode, pedido.body).toBe(200);
    expect(primeira(pedido.json()).situation).toBe("RECOUNT_REQUESTED");

    // Movimento entre as rodadas: a recontagem compara com o saldo DELA.
    await movimentar(item.id, lote.id, "PRODUCTION_CONSUMPTION", "1");

    // Quem reconta às cegas não vê a primeira contagem, o esperado nem a diferença.
    const paraRecontar = primeira(await ler(app, sessao.id, "counting"));
    expect(paraRecontar.currentRound).toBe(2);
    expect(paraRecontar.lastEntryId).toBeNull();
    expect(paraRecontar.entries).toEqual([]);
    expect(paraRecontar.referenceQuantity).toBeNull();

    const recontagem = await registrar(app, sessao.id, paraRecontar, "9");
    expect(recontagem.statusCode, recontagem.body).toBe(201);
    expect(recontagem.json().entry.round).toBe(2);
    expect(recontagem.json().entry.expectedQuantity).toBeNull();

    const revisao = primeira(await ler(app, sessao.id));
    expect(revisao.entries.map((registro) => [registro.round, registro.countedQuantity, registro.expectedQuantity])).toEqual([
      [1, "8", "10"],
      [2, "9", "9"],
    ]);
    expect(revisao.validEntryId).toBe(recontagem.json().entry.id);
    expect(revisao.finalDifference).toBe("0");
    expect(revisao.situation).toBe("MATCHES");
    expect(revisao.recountedByRequester).toBe(true);

    // A primeira contagem não foi editada.
    const primeiroDepois = await getPrisma().stockCountEntry.findUniqueOrThrow({ where: { id: primeiroRegistro.id } });
    expect(primeiroDepois).toEqual(primeiroRegistro);
    expect(await getPrisma().stockCountEntry.count({ where: { positionId: revisao.id } })).toBe(2);

    // A recontagem eliminou a divergência: encerra sem ajuste.
    expect((await comando(app, sessao.id, "complete")).statusCode).toBe(200);
    expect(await saldoDe(item.id, lote.id)).toBe("9");
    expect(await getPrisma().inventoryMovement.count({ where: { lotId: lote.id, sourceType: "STOCK_COUNT" } })).toBe(0);

    await app.close();
  });
});

describe("Contagem cega: a cegueira é do servidor", { timeout: 30_000 }, () => {
  it("nenhuma resposta da primeira rodada traz saldo, esperado ou diferença", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    await movimentar(item.id, lote.id, "RECEIPT_IN", "137.25");
    const SALDO = "137.25";

    const preview = await app.inject({
      method: "POST",
      url: "/stock-counts/preview",
      payload: { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().positions).toHaveLength(1);
    expect(preview.json().positions[0].balance).toBeNull();
    expect(preview.body).not.toContain(SALDO);

    const inicio = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } },
    });
    expect(inicio.statusCode).toBe(201);
    expect(inicio.body).not.toContain(SALDO);
    const sessao: StockCountDetailDTO = inicio.json();
    expect(sessao.balancesHidden).toBe(true);
    expect(primeira(sessao).referenceQuantity).toBeNull();

    const contagem = await registrar(app, sessao.id, primeira(sessao), "100");
    expect(contagem.statusCode).toBe(201);
    expect(contagem.body).not.toContain(SALDO);
    expect(contagem.json().entry.expectedQuantity).toBeNull();
    expect(contagem.json().entry.difference).toBeNull();
    expect(contagem.json().position.situation).toBe("COUNTED");
    expect(contagem.json().position.finalDifference).toBeNull();

    for (const view of ["review", "counting"] as const) {
      const leitura = await app.inject({ method: "GET", url: `/stock-counts/${sessao.id}?view=${view}` });
      expect(leitura.body, view).not.toContain(SALDO);
      expect(leitura.json().divergentCount, view).toBeNull();
    }
    const lista = await app.inject({ method: "GET", url: "/stock-counts?kind=SESSION&status=IN_PROGRESS&pageSize=100" });
    const naLista = lista.json().stockCounts.find((linha: { id: string }) => linha.id === sessao.id);
    expect(naLista.divergentCount).toBeNull();
    expect(naLista.countedCount).toBe(1);

    // Concluída a primeira rodada, a revisão revela; a leitura de quem conta, não.
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);
    const revisao = await ler(app, sessao.id);
    expect(primeira(revisao).referenceQuantity).toBe(SALDO);
    expect(primeira(revisao).entries[0]?.difference).toBe("-37.25");
    expect(revisao.divergentCount).toBe(1);
    const contando = await app.inject({ method: "GET", url: `/stock-counts/${sessao.id}?view=counting` });
    expect(contando.body).not.toContain(SALDO);

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste de cegueira" });
    await app.close();
  });
});

describe("Multiusuário: conflito explícito, nunca último-write silencioso", { timeout: 30_000 }, () => {
  it("registro sobre posição que mudou volta 409 com o registro atual; mesmo valor e reenvio não duplicam", async () => {
    const ana = buildTestApp("ADMIN");
    const bruno = buildTestApp("PRODUCTION");
    await ana.ready();
    await bruno.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "6");

    const sessao = await iniciar(ana, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    const vistaPorBruno = primeira(sessao);

    const deAna = await registrar(ana, sessao.id, vistaPorBruno, "5");
    expect(deAna.statusCode).toBe(201);
    const registroDeAna = deAna.json().entry;

    const conflito = await registrar(bruno, sessao.id, vistaPorBruno, "6");
    expect(conflito.statusCode).toBe(409);
    expect(conflito.json().error).toBe("stock_count_entry_conflict");
    expect(conflito.json().position.lastEntryId).toBe(registroDeAna.id);
    expect(conflito.json().position.entries).toEqual([
      expect.objectContaining({ id: registroDeAna.id, countedQuantity: "5", countedByName: registroDeAna.countedByName }),
    ]);

    // Mesmo valor que já está lá: nada a decidir, nada duplicado.
    const mesmoValor = await registrar(bruno, sessao.id, vistaPorBruno, "5");
    expect(mesmoValor.statusCode).toBe(200);
    expect(mesmoValor.json().created).toBe(false);
    expect(mesmoValor.json().entry.id).toBe(registroDeAna.id);

    // Decisão explícita: Bruno substitui sabendo do registro de Ana.
    const envio = randomUUID();
    const substitui = await registrar(bruno, sessao.id, conflito.json().position, "6", { clientRequestId: envio });
    expect(substitui.statusCode, substitui.body).toBe(201);
    // Reenvio do mesmo envio (rede caiu depois de gravar): devolve o registro, não duplica.
    const reenvio = await registrar(bruno, sessao.id, conflito.json().position, "6", { clientRequestId: envio });
    expect(reenvio.statusCode).toBe(200);
    expect(reenvio.json().created).toBe(false);
    expect(reenvio.json().entry.id).toBe(substitui.json().entry.id);

    const posicao = primeira(await ler(ana, sessao.id));
    expect(posicao.entries.map((registro) => registro.countedQuantity)).toEqual(["5", "6"]);
    expect(posicao.validEntryId).toBe(substitui.json().entry.id);

    await comando(ana, sessao.id, "cancel", { reason: "Fim do teste de conflito" });
    await ana.close();
    await bruno.close();
  });
});

describe("Cancelamento preserva o histórico", { timeout: 30_000 }, () => {
  it("cancela com motivo, mantém posições, registros e ocorrências, não cria movimento e libera a posição", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    await movimentar(item.id, lote.id, "RECEIPT_IN", "4");

    const sessao = await iniciar(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } });
    expect((await registrar(app, sessao.id, primeira(sessao), "3")).statusCode).toBe(201);
    const ocorrencia = await comando(app, sessao.id, "findings", {
      kind: "UNREGISTERED_LOT",
      itemId: item.id,
      identification: "Etiqueta do fornecedor FOR-99",
      quantity: "2",
    });
    expect(ocorrencia.statusCode, ocorrencia.body).toBe(201);

    expect((await comando(app, sessao.id, "cancel", {})).statusCode).toBe(400);
    const cancelada = await comando(app, sessao.id, "cancel", { reason: "Escopo errado" });
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect(cancelada.json().status).toBe("CANCELLED");
    expect(cancelada.json().cancelReason).toBe("Escopo errado");
    expect(cancelada.json().positions).toHaveLength(1);
    expect(primeira(cancelada.json()).entries).toHaveLength(1);
    expect(cancelada.json().findings).toHaveLength(1);
    // Cancelada na primeira rodada, a contagem cega continua sem revelar saldo.
    expect(primeira(cancelada.json()).referenceQuantity).toBeNull();

    expect(await getPrisma().inventoryMovement.count({ where: { itemId: item.id } })).toBe(1);
    expect(await getPrisma().lot.count({ where: { itemId: item.id } })).toBe(1);
    const posicao = await getPrisma().stockCountPosition.findUniqueOrThrow({ where: { id: primeira(sessao).id } });
    expect(posicao.openPositionKey).toBeNull();

    // Cancelado não reabre.
    expect((await comando(app, sessao.id, "cancel", { reason: "De novo" })).statusCode).toBe(409);
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(409);

    // A posição ficou livre para outro inventário.
    const outra = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } });
    expect(outra.positions).toHaveLength(1);
    await comando(app, outra.id, "cancel", { reason: "Fim do teste" });

    await app.close();
  });
});

describe("Posições, ocorrências e primeira rodada", { timeout: 30_000 }, () => {
  it("adiciona posição existente com motivo, registra ocorrência sem criar cadastro e exige toda posição contada ou retirada", async () => {
    const app = buildTestApp();
    await app.ready();
    const contado = await criarItem();
    const zerado = await criarItem();
    const comLote = await criarItem({ controlsLot: true });
    const lote = await criarLote(comLote.id);
    await movimentar(contado.id, null, "RECEIPT_IN", "4");
    await movimentar(comLote.id, lote.id, "RECEIPT_IN", "3");

    // "Com ou sem saldo" inclui a posição zerada (P5).
    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "ANY", itemIds: [contado.id, zerado.id] } });
    expect(sessao.positions.map((posicao) => posicao.itemId).sort()).toEqual([contado.id, zerado.id].sort());

    const adicionada = await comando(app, sessao.id, "positions", {
      itemId: comLote.id,
      lotId: lote.id,
      reason: "Achado na doca",
    });
    expect(adicionada.statusCode, adicionada.body).toBe(201);
    expect(adicionada.json().origin).toBe("ADDED");
    expect(adicionada.json().referenceQuantity).toBe("3");
    expect(adicionada.json().sequence).toBe(3);
    const repetida = await comando(app, sessao.id, "positions", { itemId: comLote.id, lotId: lote.id, reason: "De novo" });
    expect(repetida.statusCode).toBe(409);

    const loteSemCadastro = await comando(app, sessao.id, "findings", {
      kind: "UNREGISTERED_LOT",
      itemId: comLote.id,
      identification: "Lote do fabricante ABC-123",
      quantity: "2",
    });
    expect(loteSemCadastro.statusCode, loteSemCadastro.body).toBe(201);
    expect(loteSemCadastro.json().unitCode).toBe("kg");
    expect(await getPrisma().lot.count({ where: { itemId: comLote.id } })).toBe(1);
    const itemApontado = await comando(app, sessao.id, "findings", {
      kind: "UNREGISTERED_ITEM",
      itemId: comLote.id,
      identification: "Caixa sem etiqueta",
    });
    expect(itemApontado.statusCode).toBe(400);

    const zeradaId = sessao.positions.find((posicao) => posicao.itemId === zerado.id)?.id;
    const retirada = await comando(app, sessao.id, `positions/${zeradaId}/remove`, { reason: "Item descontinuado" });
    expect(retirada.statusCode, retirada.body).toBe(200);
    expect(retirada.json().situation).toBe("REMOVED");

    const incompleta = await comando(app, sessao.id, "close-first-round");
    expect(incompleta.statusCode).toBe(409);
    expect(incompleta.json()).toMatchObject({ error: "first_round_incomplete", pendingCount: 2 });

    const atual = await ler(app, sessao.id);
    for (const posicao of atual.positions.filter((candidata) => candidata.situation === "PENDING")) {
      const quantidade = posicao.itemId === contado.id ? "4" : "3";
      expect((await registrar(app, sessao.id, posicao, quantidade)).statusCode).toBe(201);
    }
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);
    const naRevisao = await registrar(app, sessao.id, { id: zeradaId ?? "", currentRound: 1, lastEntryId: null }, "1");
    expect(naRevisao.statusCode).toBe(409);

    const encerrada = await comando(app, sessao.id, "complete");
    expect(encerrada.statusCode, encerrada.body).toBe(200);
    expect(encerrada.json().findings).toHaveLength(1);
    expect(encerrada.json().positionCount).toBe(2);
    expect(encerrada.json().removedCount).toBe(1);

    await app.close();
  });
});

describe("Unidade de contagem inteira", { timeout: 30_000 }, () => {
  it("unidade COUNT recusa fração; unidade de massa aceita", async () => {
    const app = buildTestApp();
    await app.ready();
    const unidade = await getPrisma().unitOfMeasure.findUniqueOrThrow({ where: { code: "un" } });
    expect(unidade.dimension).toBe("COUNT");
    const caixas = await criarItem({ unitCode: "un" });
    const po = await criarItem({ unitCode: "kg" });
    await movimentar(caixas.id, null, "RECEIPT_IN", "10");
    await movimentar(po.id, null, "RECEIPT_IN", "10");

    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [caixas.id, po.id] } });
    const deCaixas = sessao.positions.find((posicao) => posicao.itemId === caixas.id);
    const dePo = sessao.positions.find((posicao) => posicao.itemId === po.id);
    if (!deCaixas || !dePo) throw new Error("posições do teste ausentes");

    const fracao = await registrar(app, sessao.id, deCaixas, "2,5");
    expect(fracao.statusCode).toBe(400);
    expect(fracao.json().error).toBe("fractional_count_quantity");
    expect((await registrar(app, sessao.id, deCaixas, "2")).statusCode).toBe(201);
    expect((await registrar(app, sessao.id, dePo, "2,5")).statusCode).toBe(201);

    const ocorrencia = await comando(app, sessao.id, "findings", {
      kind: "OTHER",
      identification: "Caixas avulsas",
      quantity: "1.5",
      unitCode: "un",
    });
    expect(ocorrencia.statusCode).toBe(400);

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste de unidade" });
    await app.close();
  });
});

describe("Material de cliente isolado", { timeout: 30_000 }, () => {
  it("escopo de um cliente conta e ajusta só os lotes dele", async () => {
    const app = buildTestApp();
    await app.ready();
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const item = await criarItem({ controlsLot: true });
    const semLote = await criarItem();
    const loteVeridi = await criarLote(item.id);
    const loteA = await criarLote(item.id, { customerId: clienteA.id });
    const loteB = await criarLote(item.id, { customerId: clienteB.id });
    await movimentar(item.id, loteVeridi.id, "RECEIPT_IN", "5");
    await movimentar(item.id, loteA.id, "RECEIPT_IN", "7");
    await movimentar(item.id, loteB.id, "RECEIPT_IN", "9");
    await movimentar(semLote.id, null, "RECEIPT_IN", "3");

    const doA = await app.inject({
      method: "POST",
      url: "/stock-counts/preview",
      payload: {
        mode: "ASSISTED",
        scope: { balance: "WITH_BALANCE", owner: "CUSTOMER", customerId: clienteA.id, itemIds: [item.id, semLote.id] },
      },
    });
    expect(doA.statusCode, doA.body).toBe(200);
    expect(doA.json().positions).toEqual([
      expect.objectContaining({
        lotId: loteA.id,
        ownerType: "CUSTOMER",
        ownerCustomerId: clienteA.id,
        ownerCustomerCode: clienteA.code,
        balance: "7",
      }),
    ]);

    const daVeridi = await app.inject({
      method: "POST",
      url: "/stock-counts/preview",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", owner: "VERIDI", itemIds: [item.id, semLote.id] } },
    });
    expect(daVeridi.json().positions.map((posicao: { positionKey: string }) => posicao.positionKey).sort()).toEqual(
      [`${item.id}:${loteVeridi.id}`, semLote.id].sort(),
    );

    const sessao = await iniciar(app, {
      mode: "ASSISTED",
      scope: { balance: "WITH_BALANCE", owner: "CUSTOMER", customerId: clienteA.id, itemIds: [item.id] },
    });
    expect(primeira(sessao).ownerCustomerName).toBe(clienteA.legalName);
    await registrar(app, sessao.id, primeira(sessao), "6");
    await comando(app, sessao.id, "close-first-round");
    await comando(app, sessao.id, "decisions", {
      decisions: [{ positionId: primeira(sessao).id, decision: "ADJUST", reason: "Quebra no manuseio" }],
    });
    expect((await comando(app, sessao.id, "complete")).statusCode).toBe(200);

    expect(await saldoDe(item.id, loteA.id)).toBe("6");
    expect(await saldoDe(item.id, loteB.id)).toBe("9");
    expect(await saldoDe(item.id, loteVeridi.id)).toBe("5");
    expect(await saldoDe(semLote.id)).toBe("3");

    await app.close();
  });
});

describe("Permissões no servidor (D4)", { timeout: 30_000 }, () => {
  it("PRODUCTION inicia e conta, QUALITY revisa e encerra — cada passo com o autor", async () => {
    const producao = buildTestApp("PRODUCTION");
    const qualidade = buildTestApp("QUALITY");
    await producao.ready();
    await qualidade.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "2");

    const sessao = await iniciar(producao, { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    expect((await registrar(producao, sessao.id, primeira(sessao), "2")).statusCode).toBe(201);
    expect((await comando(qualidade, sessao.id, "close-first-round")).statusCode).toBe(200);
    const encerrada = await comando(qualidade, sessao.id, "complete");
    expect(encerrada.statusCode, encerrada.body).toBe(200);
    expect(encerrada.json().createdByName).toBe("Usuário de Teste PRODUCTION");
    expect(encerrada.json().firstRoundClosedByName).toBe("Usuário de Teste QUALITY");
    expect(encerrada.json().completedByName).toBe("Usuário de Teste QUALITY");
    expect(encerrada.json().completedByCounter).toBe(false);
    expect(primeira(encerrada.json()).entries[0]?.countedByName).toBe("Usuário de Teste PRODUCTION");

    await producao.close();
    await qualidade.close();
  });

  it.each(["VIEWER", "PURCHASING", "COMMERCIAL"] as const)("%s consulta, mas não escreve", async (papel) => {
    const admin = buildTestApp("ADMIN");
    const semPermissao = buildTestApp(papel);
    await admin.ready();
    await semPermissao.ready();
    const item = await criarItem();
    await movimentar(item.id, null, "RECEIPT_IN", "1");
    const sessao = await iniciar(admin, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    const posicao = primeira(sessao);

    expect((await semPermissao.inject({ method: "GET", url: "/stock-counts" })).statusCode).toBe(200);
    expect((await semPermissao.inject({ method: "GET", url: `/stock-counts/${sessao.id}` })).statusCode).toBe(200);

    const escritas: [string, NonNullable<InjectOptions["payload"]>][] = [
      ["preview", { mode: "BLIND", scope: { balance: "ANY", itemIds: [item.id] } }],
      ["sessions", { mode: "BLIND", scope: { balance: "ANY", itemIds: [item.id] } }],
    ];
    for (const [rota, payload] of escritas) {
      const resposta = await semPermissao.inject({ method: "POST", url: `/stock-counts/${rota}`, payload });
      expect(resposta.statusCode, `${papel} ${rota}`).toBe(403);
    }
    const naSessao: [string, InjectOptions["payload"] | undefined][] = [
      [`positions/${posicao.id}/entries`, { round: 1, expectedLastEntryId: null, countedQuantity: "1", clientRequestId: randomUUID() }],
      [`positions/${posicao.id}/remove`, { reason: "Tentativa" }],
      ["positions", { itemId: item.id, reason: "Tentativa" }],
      ["findings", { kind: "OTHER", identification: "Tentativa" }],
      ["close-first-round", undefined],
      ["recounts", { positionIds: [posicao.id] }],
      ["decisions", { decisions: [{ positionId: posicao.id, decision: "ADJUST", reason: "Tentativa" }] }],
      ["complete", undefined],
      ["cancel", { reason: "Tentativa" }],
    ];
    for (const [acao, payload] of naSessao) {
      const resposta = await comando(semPermissao, sessao.id, acao, payload);
      expect(resposta.statusCode, `${papel} ${acao}`).toBe(403);
    }
    const rapida = await semPermissao.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "1" },
    });
    expect(rapida.statusCode, `${papel} contagem rápida`).toBe(403);

    expect((await ler(admin, sessao.id)).positions[0]?.entries).toEqual([]);
    await comando(admin, sessao.id, "cancel", { reason: "Fim do teste de permissão" });
    await admin.close();
    await semPermissao.close();
  });
});
