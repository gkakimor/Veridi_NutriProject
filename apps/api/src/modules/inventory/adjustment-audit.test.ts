import { beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Ajuste de estoque grava QUEM ajustou, e nem todo mundo ajusta.
 *
 * O histórico de estoque registrava `createdBy = "Ambiente local"` — uma
 * constante de sistema — no único movimento que nasce de uma decisão humana
 * direta, enquanto recebimento, consumo, produção e expedição já gravavam o
 * nome de quem operou. E as duas rotas que mudam quantidade, ajuste e
 * contagem, não tinham gate de papel algum, quando bloquear um lote já
 * exigia QUALITY ou ADMIN: a operação que muda a quantidade estava mais
 * aberta que a que muda o status.
 *
 * `CLAUDE.md`: "Inventory history is auditable." Um histórico que não diz
 * quem agiu não é auditável — é um registro de que algo aconteceu.
 */

let itemId: string;
let lotId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const marca = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-AUD-${marca}`,
      name: `Insumo auditoria ${marca}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itemId = item.id;

  const lot = await prisma.lot.create({
    data: {
      code: `LT-AUD-${marca}`,
      itemId: item.id,
      initialReceivedQuantity: "100",
      status: "AVAILABLE",
    },
  });
  lotId = lot.id;

  // Saldo de partida por recebimento — o ajuste sob teste precisa ter de
  // onde sair, e a entrada em si não é o que está sendo medido aqui.
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity: "100",
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
});

describe("Ajuste de estoque é auditável", () => {
  it("grava o nome real de quem ajustou, não a constante de sistema", async () => {
    const app = buildTestApp();
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId, lotId, type: "ADJUSTMENT_OUT", quantity: "5", reason: "Quebra no manuseio" },
    });

    expect(resposta.statusCode).toBe(201);
    const movimento = resposta.json();
    expect(movimento.createdBy).not.toBe("Ambiente local");
    expect(movimento.createdBy).toBeTruthy();

    await app.close();
  });

  it("contagem de inventário também grava quem contou", async () => {
    const app = buildTestApp();
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId, lotId, countedQuantity: "90", reason: "Contagem cíclica" },
    });

    expect(resposta.statusCode).toBe(201);
    const movimentos = await getPrisma().inventoryMovement.findMany({
      where: { lotId, sourceType: "STOCK_COUNT" },
      orderBy: { occurredAt: "desc" },
      take: 1,
    });
    expect(movimentos[0]?.createdBy).not.toBe("Ambiente local");

    await app.close();
  });
});

describe("Quem muda a quantidade precisa de papel", () => {
  it("VIEWER não ajusta estoque", async () => {
    const app = buildTestApp("VIEWER");
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId, lotId, type: "ADJUSTMENT_OUT", quantity: "1", reason: "Tentativa" },
    });

    expect(resposta.statusCode).toBe(403);
    await app.close();
  });

  it("VIEWER não registra contagem", async () => {
    const app = buildTestApp("VIEWER");
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId, lotId, countedQuantity: "1", reason: "Tentativa" },
    });

    expect(resposta.statusCode).toBe(403);
    await app.close();
  });

  it("PRODUCTION ajusta — é quem opera o estoque", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId, lotId, type: "ADJUSTMENT_IN", quantity: "2", reason: "Sobra devolvida" },
    });

    expect(resposta.statusCode).toBe(201);
    await app.close();
  });
});
