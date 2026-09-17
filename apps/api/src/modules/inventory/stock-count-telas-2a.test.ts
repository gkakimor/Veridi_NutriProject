import { randomUUID } from "node:crypto";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  STOCK_COUNT_MAX_POSITIONS,
  STOCK_COUNT_WRITE_ROLES,
  USER_ROLES,
  diaCivilDeslocado,
  hojeComercial,
} from "@veridi/shared";
import type {
  StockCountDetailDTO,
  StockCountErrorBody,
  StockCountListResponse,
  StockCountPositionDTO,
  StockCountPreviewDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Inventário Físico — o que as telas da Fatia 2A pedem da API
 * (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * A Fatia 1 provou o domínio. Aqui ficam as respostas de que a tela depende
 * para não mentir: o delta do escopo que mudou, o teto do escopo, a posição
 * adicionada em revisão sem o saldo para quem conta, o conflito com o registro
 * atual, as recusas de registro, o envio reaproveitado, as retiradas da prévia
 * e a lista com "Em aberto", busca, modo e período.
 *
 * Todo escopo é restrito a itens e lotes deste arquivo: outros arquivos
 * escrevem no mesmo banco de teste ao mesmo tempo.
 */

type App = ReturnType<typeof buildTestApp>;

const itensCriados: string[] = [];

function marca(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
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
      code: `MP-INV2A-${m}`,
      name: `Insumo telas do inventário ${m}`,
      unitCode: "kg",
      controlsLot: opcoes.controlsLot ?? false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itensCriados.push(item.id);
  return item;
}

async function criarLote(itemId: string) {
  return getPrisma().lot.create({
    data: { code: `LT-INV2A-${marca()}`, itemId, initialReceivedQuantity: "0", status: "AVAILABLE" },
  });
}

async function movimentar(
  itemId: string,
  lotId: string | null,
  type: "RECEIPT_IN" | "PRODUCTION_CONSUMPTION",
  quantity: string,
): Promise<void> {
  await getPrisma().inventoryMovement.create({
    data: {
      itemId,
      lotId,
      type,
      quantity,
      occurredAt: new Date(),
      sourceType: type === "RECEIPT_IN" ? "RECEIPT" : "PRODUCTION_CONSUMPTION",
      createdBy: "Teste",
    },
  });
}

async function iniciar(app: App, corpo: Record<string, unknown>): Promise<StockCountDetailDTO> {
  const resposta = await app.inject({ method: "POST", url: "/stock-counts/sessions", payload: corpo });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json();
}

async function ler(app: App, id: string, view: "review" | "counting"): Promise<StockCountDetailDTO> {
  const resposta = await app.inject({ method: "GET", url: `/stock-counts/${id}?view=${view}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

function registrar(
  app: App,
  sessaoId: string,
  posicao: Pick<StockCountPositionDTO, "id" | "currentRound" | "lastEntryId">,
  countedQuantity: string,
  clientRequestId: string = randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: `/stock-counts/${sessaoId}/positions/${posicao.id}/entries`,
    payload: {
      round: posicao.currentRound,
      expectedLastEntryId: posicao.lastEntryId,
      countedQuantity,
      clientRequestId,
    },
  });
}

function comando(app: App, sessaoId: string, acao: string, payload?: InjectOptions["payload"]) {
  const pedido: InjectOptions = { method: "POST", url: `/stock-counts/${sessaoId}/${acao}` };
  if (payload !== undefined) pedido.payload = payload;
  return app.inject(pedido);
}

function preview(app: App, corpo: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/stock-counts/preview", payload: corpo });
}

function posicaoDoItem(detalhe: StockCountDetailDTO, itemId: string, lotId: string | null = null) {
  const posicao = detalhe.positions.find((candidata) => candidata.itemId === itemId && candidata.lotId === lotId);
  if (!posicao) throw new Error("posição não encontrada");
  return posicao;
}

describe("Posição adicionada em revisão não revela o saldo a quem conta", { timeout: 30_000 }, () => {
  it("contagem cega em revisão: a resposta de adicionar vem na leitura de quem conta, sem saldo", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const contado = await criarLote(item.id);
    const novo = await criarLote(item.id);
    await movimentar(item.id, contado.id, "RECEIPT_IN", "137.25");
    const SALDO_DA_NOVA = "91.375";
    await movimentar(item.id, novo.id, "RECEIPT_IN", SALDO_DA_NOVA);

    const sessao = await iniciar(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [contado.id] } });
    const [primeira] = sessao.positions;
    expect((await registrar(app, sessao.id, primeira!, "130")).statusCode).toBe(201);
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);

    const adicionada = await comando(app, sessao.id, "positions", {
      itemId: item.id,
      lotId: novo.id,
      reason: "Lote achado na doca durante a revisão",
    });
    expect(adicionada.statusCode, adicionada.body).toBe(201);
    expect(adicionada.body).not.toContain(SALDO_DA_NOVA);
    const posicao: StockCountPositionDTO = adicionada.json();
    expect(posicao.referenceQuantity).toBeNull();
    expect(posicao.finalDifference).toBeNull();
    expect(posicao.hasConcurrentMovement).toBeNull();
    expect(posicao.situation).toBe("PENDING");
    expect(posicao.origin).toBe("ADDED");

    // Quem conta relê pela leitura dele e continua sem o número; a revisão, já revelada, mostra.
    expect(JSON.stringify(await ler(app, sessao.id, "counting"))).not.toContain(SALDO_DA_NOVA);
    expect(posicaoDoItem(await ler(app, sessao.id, "review"), item.id, novo.id).referenceQuantity).toBe(
      SALDO_DA_NOVA,
    );

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste de vazamento" });
    await app.close();
  });

  it("contagem com saldo em revisão: a mesma resposta continua trazendo o saldo", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const contado = await criarLote(item.id);
    const novo = await criarLote(item.id);
    await movimentar(item.id, contado.id, "RECEIPT_IN", "4");
    await movimentar(item.id, novo.id, "RECEIPT_IN", "7.5");

    const sessao = await iniciar(app, { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [contado.id] } });
    expect((await registrar(app, sessao.id, sessao.positions[0]!, "4")).statusCode).toBe(201);
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);

    const adicionada = await comando(app, sessao.id, "positions", {
      itemId: item.id,
      lotId: novo.id,
      reason: "Lote achado na doca",
    });
    expect(adicionada.statusCode, adicionada.body).toBe(201);
    expect(adicionada.json().referenceQuantity).toBe("7.5");

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste" });
    await app.close();
  });
});

describe("Escopo que mudou desde a prévia", { timeout: 30_000 }, () => {
  it("iniciar com as posições vistas responde 409 com o que entrou e o que saiu, e não grava nada", async () => {
    const app = buildTestApp();
    await app.ready();
    const fica = await criarItem();
    const sai = await criarItem();
    const entra = await criarItem();
    await movimentar(fica.id, null, "RECEIPT_IN", "3");
    await movimentar(sai.id, null, "RECEIPT_IN", "2");
    const escopo = { balance: "WITH_BALANCE", itemIds: [fica.id, sai.id, entra.id] };

    const vista = await preview(app, { mode: "BLIND", scope: escopo });
    expect(vista.statusCode, vista.body).toBe(200);
    const chavesVistas = (vista.json() as StockCountPreviewDTO).positions.map((posicao) => posicao.positionKey);
    expect(chavesVistas.sort()).toEqual([fica.id, sai.id].sort());

    // Entre a prévia e o iniciar, a fábrica andou: um item zerou e outro recebeu.
    await movimentar(sai.id, null, "PRODUCTION_CONSUMPTION", "2");
    await movimentar(entra.id, null, "RECEIPT_IN", "5");

    const recusa = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "BLIND", scope: escopo, expectedPositionKeys: chavesVistas },
    });
    expect(recusa.statusCode, recusa.body).toBe(409);
    const corpo: StockCountErrorBody = recusa.json();
    expect(corpo.error).toBe("scope_changed");
    expect(corpo.added).toEqual([entra.id]);
    expect(corpo.removed).toEqual([sai.id]);
    expect(
      await getPrisma().stockCountPosition.count({ where: { itemId: { in: [fica.id, sai.id, entra.id] } } }),
    ).toBe(0);

    // Confirmado de novo sobre o conjunto atual, inicia.
    const atual = (await preview(app, { mode: "BLIND", scope: escopo })).json() as StockCountPreviewDTO;
    const sessao = await iniciar(app, {
      mode: "BLIND",
      scope: escopo,
      expectedPositionKeys: atual.positions.map((posicao) => posicao.positionKey),
    });
    expect(sessao.positions.map((posicao) => posicao.itemId).sort()).toEqual([fica.id, entra.id].sort());

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste de escopo" });
    await app.close();
  });

  it("escopo acima do teto é recusado na prévia e no início com o número real; retirar uma posição cabe", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const m = marca();
    const total = STOCK_COUNT_MAX_POSITIONS + 1;
    await getPrisma().lot.createMany({
      data: Array.from({ length: total }, (_, indice) => ({
        code: `LT-TETO-${m}-${String(indice).padStart(4, "0")}`,
        itemId: item.id,
        initialReceivedQuantity: "0",
        status: "AVAILABLE" as const,
      })),
    });
    // "Com ou sem saldo" inclui o lote zerado de item ativo (P5): são 3.001 posições.
    const escopo = { balance: "ANY", itemIds: [item.id] };

    const grande = await preview(app, { mode: "BLIND", scope: escopo });
    expect(grande.statusCode, grande.body.slice(0, 300)).toBe(400);
    expect(grande.json()).toMatchObject({
      error: "scope_too_large",
      positionCount: total,
      maxPositions: STOCK_COUNT_MAX_POSITIONS,
    });

    const inicio = await app.inject({ method: "POST", url: "/stock-counts/sessions", payload: { mode: "BLIND", scope: escopo } });
    expect(inicio.statusCode).toBe(400);
    expect(inicio.json()).toMatchObject({ error: "scope_too_large", positionCount: total });
    expect(await getPrisma().stockCountPosition.count({ where: { itemId: item.id } })).toBe(0);

    const umLote = await getPrisma().lot.findFirstOrThrow({ where: { itemId: item.id }, select: { id: true } });
    const cabe = await preview(app, {
      mode: "BLIND",
      scope: escopo,
      excludedPositionKeys: [`${item.id}:${umLote.id}`],
    });
    expect(cabe.statusCode).toBe(200);
    expect(cabe.json().positions).toHaveLength(STOCK_COUNT_MAX_POSITIONS);
    expect(cabe.json().excludedCount).toBe(1);

    await app.close();
  });
});

describe("Retiradas da prévia", { timeout: 30_000 }, () => {
  it("a prévia devolve as retiradas que continuam no escopo, sem número e sem saldo na cega; o início não as congela", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const [a, b, c] = [await criarLote(item.id), await criarLote(item.id), await criarLote(item.id)];
    await movimentar(item.id, a.id, "RECEIPT_IN", "1");
    await movimentar(item.id, b.id, "RECEIPT_IN", "2.5");
    await movimentar(item.id, c.id, "RECEIPT_IN", "3");
    const escopo = { balance: "WITH_BALANCE", itemIds: [item.id] };
    const chave = (loteId: string) => `${item.id}:${loteId}`;

    const cega = await preview(app, {
      mode: "BLIND",
      scope: escopo,
      // A chave de fora do escopo não conta como retirada.
      excludedPositionKeys: [chave(b.id), `${item.id}:${randomUUID()}`],
    });
    expect(cega.statusCode, cega.body).toBe(200);
    const leituraCega: StockCountPreviewDTO = cega.json();
    expect(leituraCega.positions.map((posicao) => posicao.lotId).sort()).toEqual([a.id, c.id].sort());
    expect(leituraCega.positions.map((posicao) => posicao.sequence)).toEqual([1, 2]);
    expect(leituraCega.excludedCount).toBe(1);
    expect(leituraCega.excludedPositions).toHaveLength(1);
    expect(leituraCega.excludedPositions[0]).toMatchObject({
      positionKey: chave(b.id),
      lotId: b.id,
      lotCode: b.code,
      itemCode: item.code,
      balance: null,
    });
    expect(leituraCega.excludedPositions[0]).not.toHaveProperty("sequence");

    const comSaldo = (
      await preview(app, { mode: "ASSISTED", scope: escopo, excludedPositionKeys: [chave(b.id)] })
    ).json() as StockCountPreviewDTO;
    expect(comSaldo.excludedPositions[0]?.balance).toBe("2.5");

    const sessao = await iniciar(app, {
      mode: "BLIND",
      scope: escopo,
      excludedPositionKeys: [chave(b.id)],
      expectedPositionKeys: leituraCega.positions.map((posicao) => posicao.positionKey),
    });
    expect(sessao.positions.map((posicao) => posicao.lotId).sort()).toEqual([a.id, c.id].sort());
    expect(sessao.scopeFilters).toMatchObject({ excludedPositionKeys: [chave(b.id)], excludedCount: 1 });

    // A retirada ficou livre: outro inventário a vê, sem retenção.
    const outra = (
      await preview(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [b.id] } })
    ).json() as StockCountPreviewDTO;
    expect(outra.positions.map((posicao) => posicao.lotId)).toEqual([b.id]);
    expect(outra.heldByOpenCounts).toEqual([]);

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste de retiradas" });
    await app.close();
  });
});

describe("Registro de contagem: conflito e recusas que a tela trata", { timeout: 30_000 }, () => {
  it("conflito na contagem cega devolve quem registrou, o valor e a hora — e nenhum saldo", async () => {
    const ana = buildTestApp("ADMIN");
    const bruno = buildTestApp("QUALITY");
    await ana.ready();
    await bruno.ready();
    const item = await criarItem();
    const SALDO = "48.125";
    await movimentar(item.id, null, "RECEIPT_IN", SALDO);

    const sessao = await iniciar(ana, { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
    const vista = sessao.positions[0]!;
    const deAna = await registrar(ana, sessao.id, vista, "47");
    expect(deAna.statusCode).toBe(201);

    const conflito = await registrar(bruno, sessao.id, vista, "46");
    expect(conflito.statusCode).toBe(409);
    expect(conflito.body).not.toContain(SALDO);
    const corpo: StockCountErrorBody = conflito.json();
    expect(corpo.error).toBe("stock_count_entry_conflict");
    expect(corpo.position?.lastEntryId).toBe(deAna.json().entry.id);
    expect(corpo.position?.referenceQuantity).toBeNull();
    expect(corpo.position?.entries).toEqual([
      expect.objectContaining({
        countedQuantity: "47",
        countedByName: deAna.json().entry.countedByName,
        countedAt: deAna.json().entry.countedAt,
        expectedQuantity: null,
        difference: null,
      }),
    ]);

    await comando(ana, sessao.id, "cancel", { reason: "Fim do teste de conflito" });
    await ana.close();
    await bruno.close();
  });

  it("posição retirada, primeira contagem concluída e inventário cancelado recusam registro com o código de cada caso", async () => {
    const app = buildTestApp();
    await app.ready();
    const contado = await criarItem();
    const retirado = await criarItem();
    await movimentar(contado.id, null, "RECEIPT_IN", "2");
    await movimentar(retirado.id, null, "RECEIPT_IN", "2");
    const sessao = await iniciar(app, {
      mode: "ASSISTED",
      scope: { balance: "WITH_BALANCE", itemIds: [contado.id, retirado.id] },
    });
    const posicaoRetirada = posicaoDoItem(sessao, retirado.id);
    const posicaoContada = posicaoDoItem(sessao, contado.id);

    const retirada = await comando(app, sessao.id, `positions/${posicaoRetirada.id}/remove`, { reason: "Fora do escopo" });
    expect(retirada.statusCode, retirada.body).toBe(200);
    const naRetirada = await registrar(app, sessao.id, posicaoRetirada, "1");
    expect(naRetirada.statusCode).toBe(409);
    expect(naRetirada.json().error).toBe("entry_not_allowed");

    expect((await registrar(app, sessao.id, posicaoContada, "2")).statusCode).toBe(201);
    expect((await comando(app, sessao.id, "close-first-round")).statusCode).toBe(200);
    const atual = posicaoDoItem(await ler(app, sessao.id, "counting"), contado.id);
    const depoisDaRodada = await registrar(app, sessao.id, atual, "3");
    expect(depoisDaRodada.statusCode).toBe(409);
    expect(depoisDaRodada.json().error).toBe("entry_not_allowed");

    expect((await comando(app, sessao.id, "cancel", { reason: "Fim do teste" })).statusCode).toBe(200);
    const cancelado = await registrar(app, sessao.id, atual, "3");
    expect(cancelado.statusCode).toBe(409);
    expect(cancelado.json()).toMatchObject({ error: "invalid_stock_count_status", status: "CANCELLED" });

    await app.close();
  });

  it("o mesmo envio em outra posição é recusado e não grava nada nela", async () => {
    const app = buildTestApp();
    await app.ready();
    const um = await criarItem();
    const outro = await criarItem();
    await movimentar(um.id, null, "RECEIPT_IN", "1");
    await movimentar(outro.id, null, "RECEIPT_IN", "1");
    const sessao = await iniciar(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [um.id, outro.id] } });
    const envio = randomUUID();

    expect((await registrar(app, sessao.id, posicaoDoItem(sessao, um.id), "1", envio)).statusCode).toBe(201);
    const reaproveitado = await registrar(app, sessao.id, posicaoDoItem(sessao, outro.id), "1", envio);
    expect(reaproveitado.statusCode).toBe(409);
    expect(reaproveitado.json().error).toBe("client_request_reused");
    expect(posicaoDoItem(await ler(app, sessao.id, "counting"), outro.id).entries).toEqual([]);

    // O identificador que não é UUID nem chega ao domínio.
    const invalido = await app.inject({
      method: "POST",
      url: `/stock-counts/${sessao.id}/positions/${posicaoDoItem(sessao, outro.id).id}/entries`,
      payload: { round: 1, expectedLastEntryId: null, countedQuantity: "1", clientRequestId: "envio-1" },
    });
    expect(invalido.statusCode).toBe(400);

    await comando(app, sessao.id, "cancel", { reason: "Fim do teste" });
    await app.close();
  });
});

describe("Lista dos inventários: Em aberto, busca, modo e período", { timeout: 30_000 }, () => {
  it("filtros novos compõem com os de antes, sem mudar a paginação", async () => {
    const app = buildTestApp();
    await app.ready();
    const m = marca();
    const [i1, i2, i3] = [await criarItem(), await criarItem(), await criarItem()];
    for (const item of [i1, i2, i3]) await movimentar(item.id, null, "RECEIPT_IN", "1");

    const cega = await iniciar(app, {
      mode: "BLIND",
      description: `Matérias-primas ${m}`,
      scope: { balance: "WITH_BALANCE", itemIds: [i1.id] },
    });
    const emRevisao = await iniciar(app, {
      mode: "ASSISTED",
      description: `Embalagens ${m}`,
      scope: { balance: "WITH_BALANCE", itemIds: [i2.id] },
    });
    expect((await registrar(app, emRevisao.id, emRevisao.positions[0]!, "1")).statusCode).toBe(201);
    expect((await comando(app, emRevisao.id, "close-first-round")).statusCode).toBe(200);
    const cancelada = await iniciar(app, {
      mode: "BLIND",
      description: `Cancelado ${m}`,
      scope: { balance: "WITH_BALANCE", itemIds: [i3.id] },
    });
    expect((await comando(app, cancelada.id, "cancel", { reason: "Escopo errado" })).statusCode).toBe(200);

    async function listar(params: Record<string, string>): Promise<StockCountListResponse> {
      const resposta = await app.inject({ method: "GET", url: `/stock-counts?${new URLSearchParams(params)}` });
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json();
    }
    const codigos = (lista: StockCountListResponse) => lista.stockCounts.map((linha) => linha.code).sort();

    expect(codigos(await listar({ search: m, pageSize: "100" }))).toEqual(
      [cega.code, emRevisao.code, cancelada.code].sort(),
    );
    // Em aberto = em contagem + em revisão.
    expect(codigos(await listar({ search: m, status: "IN_PROGRESS,IN_REVIEW", kind: "SESSION" }))).toEqual(
      [cega.code, emRevisao.code].sort(),
    );
    // Um status só continua valendo como antes.
    expect(codigos(await listar({ search: m, status: "IN_REVIEW" }))).toEqual([emRevisao.code]);
    expect(codigos(await listar({ search: m, mode: "BLIND" }))).toEqual([cega.code, cancelada.code].sort());
    // Busca pelo código INV-, sem diferenciar caixa.
    expect(codigos(await listar({ search: cega.code.toLowerCase() }))).toEqual([cega.code]);

    const hoje = hojeComercial();
    expect(codigos(await listar({ search: m, dateFrom: hoje, dateTo: hoje }))).toHaveLength(3);
    expect(codigos(await listar({ search: m, dateFrom: diaCivilDeslocado(hoje, 1) }))).toEqual([]);
    expect(codigos(await listar({ search: m, dateTo: diaCivilDeslocado(hoje, -1) }))).toEqual([]);
    const invertido = await app.inject({
      method: "GET",
      url: `/stock-counts?dateFrom=${hoje}&dateTo=${diaCivilDeslocado(hoje, -1)}`,
    });
    expect(invertido.statusCode).toBe(400);

    const pagina = await listar({ search: m, pageSize: "1", page: "2" });
    expect(pagina).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(pagina.stockCounts).toHaveLength(1);

    for (const invalida of ["status=OPEN", "mode=CEGA", "status="]) {
      const resposta = await app.inject({ method: "GET", url: `/stock-counts?${invalida}` });
      expect(resposta.statusCode, invalida).toBe(400);
    }

    await comando(app, cega.id, "cancel", { reason: "Fim do teste" });
    await comando(app, emRevisao.id, "cancel", { reason: "Fim do teste" });
    await app.close();
  });
});

describe("Papéis: a lista do shared é a que a API aplica", { timeout: 30_000 }, () => {
  it.each(USER_ROLES.map((role) => ({ role, opera: STOCK_COUNT_WRITE_ROLES.includes(role) })))(
    "$role — opera: $opera; consulta sempre",
    async ({ role, opera }) => {
      const app = buildTestApp(role);
      await app.ready();
      const item = await criarItem();
      await movimentar(item.id, null, "RECEIPT_IN", "1");

      const previa = await preview(app, { mode: "BLIND", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } });
      expect(previa.statusCode).toBe(opera ? 200 : 403);
      const rapida = await app.inject({
        method: "POST",
        url: "/stock-counts",
        payload: { itemId: item.id, countedQuantity: "1" },
      });
      expect(rapida.statusCode).toBe(opera ? 201 : 403);
      const lista = await app.inject({ method: "GET", url: "/stock-counts?pageSize=1" });
      expect(lista.statusCode).toBe(200);

      await app.close();
    },
  );
});
