import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { getOnHand } from "../../lib/inventory-ledger.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Contagem rápida (INVENTORY-PHYSICAL-COUNT-01).
 *
 * Antes, a contagem que conferia não deixava rastro e o ajuste apontava para
 * `sourceId = null`. Agora toda contagem rápida grava o documento INV- (kind
 * QUICK) com posição e registro, e o ajuste nasce ligado à posição. O contrato
 * da tela atual (`POST /stock-counts`) é o mesmo, só acrescido.
 *
 * E ela respeita a exclusividade: posição em inventário aberto não é contada
 * por fora.
 */

const itensCriados: string[] = [];

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

async function criarItem(opcoes: { controlsLot?: boolean; unitCode?: string } = {}) {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-INVQ-${m}`,
      name: `Insumo contagem rápida ${m}`,
      unitCode: opcoes.unitCode ?? "kg",
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
    data: { code: `LT-INVQ-${marca()}`, itemId, initialReceivedQuantity: "0", status: "AVAILABLE" },
  });
}

async function receber(itemId: string, lotId: string | null, quantity: string): Promise<void> {
  await getPrisma().inventoryMovement.create({
    data: { itemId, lotId, type: "RECEIPT_IN", quantity, occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
  });
}

describe("Contagem rápida grava o documento INV-", () => {
  it("sem diferença: documento QUICK encerrado, com posição e registro, e nenhum movimento", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await receber(item.id, null, "20");

    const resposta = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "20" },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const corpo = resposta.json();
    // Contrato da tela atual.
    expect(corpo).toMatchObject({ itemId: item.id, lotId: null, systemQuantity: "20", countedQuantity: "20", difference: "0" });
    expect(corpo.movementCreated).toBeNull();
    expect(corpo.stockCountCode).toMatch(/^INV-\d{6}$/);

    const prisma = getPrisma();
    const documento = await prisma.stockCount.findUniqueOrThrow({
      where: { id: corpo.stockCountId },
      include: { positions: { include: { entries: true } } },
    });
    expect(documento).toMatchObject({ kind: "QUICK", mode: "ASSISTED", status: "COMPLETED", code: corpo.stockCountCode });
    expect(documento.completedAt).not.toBeNull();
    expect(documento.positions).toHaveLength(1);
    const [posicao] = documento.positions;
    expect(posicao?.openPositionKey).toBeNull();
    expect(posicao?.validEntryId).toBe(corpo.entryId);
    expect(posicao?.adjustmentMovementId).toBeNull();
    expect(posicao?.entries).toHaveLength(1);
    expect(posicao?.entries[0]?.source).toBe("QUICK");
    expect(posicao?.entries[0]?.expectedQuantity.toString()).toBe("20");
    expect(await prisma.inventoryMovement.count({ where: { itemId: item.id } })).toBe(1);

    const leitura = await app.inject({ method: "GET", url: `/stock-counts/${corpo.stockCountId}` });
    expect(leitura.json().positions[0].situation).toBe("MATCHES");

    await app.close();
  });

  it("com diferença: o ajuste nasce ligado à posição do documento", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    await receber(item.id, lote.id, "10");

    const resposta = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, lotId: lote.id, countedQuantity: "7", reason: "Quebra no manuseio" },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const corpo = resposta.json();
    expect(corpo.difference).toBe("-3");
    expect(corpo.movementCreated).toMatchObject({
      type: "ADJUSTMENT_OUT",
      quantity: "3",
      sourceType: "STOCK_COUNT",
      sourceId: corpo.positionId,
      reason: "Quebra no manuseio",
    });

    const posicao = await getPrisma().stockCountPosition.findUniqueOrThrow({ where: { id: corpo.positionId } });
    expect(posicao.adjustmentMovementId).toBe(corpo.movementCreated.id);
    expect(posicao.decision).toBe("ADJUST");
    expect(posicao.decisionReason).toBe("Quebra no manuseio");
    expect((await getOnHand(getPrisma(), { itemId: item.id, lotId: lote.id })).toString()).toBe("7");

    await app.close();
  });

  it("saldo mostrado diferente do saldo no confirmar volta 409 e não grava nada", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();
    await receber(item.id, null, "10");

    const mudou = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "9", reason: "Contagem", expectedSystemQuantity: "8" },
    });
    expect(mudou.statusCode).toBe(409);
    expect(mudou.json()).toMatchObject({ error: "system_quantity_changed", shownQuantity: "8", currentQuantity: "10" });
    expect(await getPrisma().stockCountPosition.count({ where: { itemId: item.id } })).toBe(0);
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: item.id } })).toBe(1);

    const confere = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "9", reason: "Contagem", expectedSystemQuantity: "10" },
    });
    expect(confere.statusCode, confere.body).toBe(201);

    await app.close();
  });

  it("unidade COUNT recusa fração também na contagem rápida", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ unitCode: "un" });
    await receber(item.id, null, "5");

    const resposta = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "4,5", reason: "Contagem" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("fractional_count_quantity");
    expect(await getPrisma().stockCountPosition.count({ where: { itemId: item.id } })).toBe(0);

    await app.close();
  });
});

describe("Exclusividade de posição entre inventários abertos", { timeout: 30_000 }, () => {
  it("posição em inventário aberto fica fora do preview e do início, e recusa contagem rápida e adição", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const loteA = await criarLote(item.id);
    const loteB = await criarLote(item.id);
    await receber(item.id, loteA.id, "10");
    await receber(item.id, loteB.id, "4");
    const chaveA = `${item.id}:${loteA.id}`;

    const inicioA = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [loteA.id] } },
    });
    expect(inicioA.statusCode, inicioA.body).toBe(201);
    const sessaoA = inicioA.json();

    const preview = await app.inject({
      method: "POST",
      url: "/stock-counts/preview",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [loteA.id, loteB.id] } },
    });
    expect(preview.json().positions.map((posicao: { lotId: string }) => posicao.lotId)).toEqual([loteB.id]);
    expect(preview.json().heldByOpenCounts).toEqual([
      expect.objectContaining({ positionKey: chaveA, stockCountCode: sessaoA.code }),
    ]);

    const inicioB = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [loteA.id, loteB.id] } },
    });
    expect(inicioB.statusCode, inicioB.body).toBe(201);
    const sessaoB = inicioB.json();
    expect(sessaoB.positions.map((posicao: { lotId: string }) => posicao.lotId)).toEqual([loteB.id]);
    expect(sessaoB.scopeFilters.heldByOpenCounts).toEqual([{ positionKey: chaveA, stockCountCode: sessaoA.code }]);

    const soA = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", lotIds: [loteA.id] } },
    });
    expect(soA.statusCode).toBe(400);
    expect(soA.json().error).toBe("empty_scope");

    const rapida = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, lotId: loteA.id, countedQuantity: "8", reason: "Contagem por fora" },
    });
    expect(rapida.statusCode).toBe(409);
    expect(rapida.json().error).toBe("position_in_open_count");
    expect(rapida.json().held[0].stockCountCode).toBe(sessaoA.code);
    expect(await getPrisma().inventoryMovement.count({ where: { lotId: loteA.id } })).toBe(1);
    expect(
      await getPrisma().stockCountPosition.count({ where: { lotId: loteA.id, stockCount: { kind: "QUICK" } } }),
    ).toBe(0);

    const adicao = await app.inject({
      method: "POST",
      url: `/stock-counts/${sessaoB.id}/positions`,
      payload: { itemId: item.id, lotId: loteA.id, reason: "Achado na prateleira" },
    });
    expect(adicao.statusCode).toBe(409);
    expect(adicao.json().error).toBe("position_in_open_count");

    // Cancelar libera a posição.
    await app.inject({ method: "POST", url: `/stock-counts/${sessaoA.id}/cancel`, payload: { reason: "Liberar" } });
    const depois = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, lotId: loteA.id, countedQuantity: "10" },
    });
    expect(depois.statusCode, depois.body).toBe(201);

    await app.inject({ method: "POST", url: `/stock-counts/${sessaoB.id}/cancel`, payload: { reason: "Fim do teste" } });
    await app.close();
  });
});
