import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Por que o disponível é menor que o físico.
 *
 * A tela mostrava `MP-000003` com Físico 5 e Disponível 0 e nada explicava
 * a diferença: a legenda dizia a regra geral, e justo a linha que destoava
 * ficava muda. A causa não é adivinhada a partir de `available === 0` — ela
 * vem do lote que a produz.
 *
 * Fixtures próprias, criadas direto no ledger para montar cada estado sem
 * arrastar meio ERP junto.
 */

const fixtureItemIds: string[] = [];
const fixtureLotIds: string[] = [];

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureLotIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: fixtureLotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: fixtureLotIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000);
const DAQUI_UM_ANO = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

type EstadoLote = {
  status: "AVAILABLE" | "AWAITING_RELEASE" | "BLOCKED";
  quantidade: string;
  expiry?: Date;
  requiresCoa?: boolean;
  coaStatus?: "PENDING" | "APPROVED" | "NOT_REQUIRED";
};

/** Item com controle de lote e os lotes pedidos, direto no ledger. */
async function criarCenario(lotes: EstadoLote[]) {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-UR-${m}`,
      name: `Item indisponibilidade ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
    },
  });
  fixtureItemIds.push(item.id);

  let i = 0;
  for (const estado of lotes) {
    i += 1;
    const lot = await prisma.lot.create({
      data: {
        code: `LT-UR-${m}-${i}`,
        origin: "RECEIPT",
        itemId: item.id,
        ownerType: "VERIDI",
        status: estado.status,
        ...(estado.expiry ? { expiryDate: estado.expiry } : {}),
        initialReceivedQuantity: new Prisma.Decimal(estado.quantidade),
        requiresCoaSnapshot: estado.requiresCoa ?? false,
        coaStatus: estado.coaStatus ?? (estado.requiresCoa ? "PENDING" : "NOT_REQUIRED"),
        createdBy: "teste",
      },
    });
    fixtureLotIds.push(lot.id);

    await prisma.inventoryMovement.create({
      data: {
        itemId: item.id,
        lotId: lot.id,
        type: "RECEIPT_IN",
        quantity: new Prisma.Decimal(estado.quantidade),
        occurredAt: ONTEM,
        sourceType: "MANUAL_ADJUSTMENT",
        reason: "fixture",
        createdBy: "teste",
      },
    });
  }
  return item;
}

describe("Estoque explica a indisponibilidade", () => {
  const app = buildTestApp();

  async function lerLinha(itemId: string) {
    const response = await app.inject({ method: "GET", url: `/inventory?search=MP-UR-` });
    const corpo = response.json();
    return corpo.items.find((linha: { itemId: string }) => linha.itemId === itemId);
  }

  it("lote aguardando a Qualidade aparece como causa, com quantidade", async () => {
    // O caso exato da auditoria: cafeína recebida, física, indisponível.
    const item = await criarCenario([
      { status: "AWAITING_RELEASE", quantidade: "5", expiry: DAQUI_UM_ANO },
    ]);
    const linha = await lerLinha(item.id);

    expect(linha.onHand).toBe("5");
    expect(linha.available).toBe("0");
    expect(linha.unavailable).toEqual([
      { reason: "AWAITING_QUALITY_RELEASE", quantity: "5" },
    ]);
  });

  it("lote vencido é vencido, não 'aguardando qualidade'", async () => {
    const item = await criarCenario([
      { status: "AVAILABLE", quantidade: "4", expiry: ONTEM },
    ]);
    const linha = await lerLinha(item.id);

    expect(linha.available).toBe("0");
    // Precedência: o vencimento manda, mesmo que outras condições existam.
    expect(linha.unavailable).toEqual([{ reason: "EXPIRED", quantity: "4" }]);
  });

  it("lote bloqueado diz que está bloqueado", async () => {
    const item = await criarCenario([
      { status: "BLOCKED", quantidade: "7", expiry: DAQUI_UM_ANO },
    ]);
    const linha = await lerLinha(item.id);
    expect(linha.unavailable).toEqual([{ reason: "BLOCKED", quantity: "7" }]);
  });

  it("laudo pendente é causa própria, separada da liberação operacional", async () => {
    const item = await criarCenario([
      {
        status: "AVAILABLE",
        quantidade: "3",
        expiry: DAQUI_UM_ANO,
        requiresCoa: true,
        coaStatus: "PENDING",
      },
    ]);
    const linha = await lerLinha(item.id);
    expect(linha.unavailable).toEqual([{ reason: "COA_PENDING", quantity: "3" }]);
  });

  it("lotes em estados diferentes rendem causas diferentes na mesma linha", async () => {
    const item = await criarCenario([
      { status: "AWAITING_RELEASE", quantidade: "5", expiry: DAQUI_UM_ANO },
      { status: "AVAILABLE", quantidade: "2", expiry: ONTEM },
      { status: "AVAILABLE", quantidade: "10", expiry: DAQUI_UM_ANO },
    ]);
    const linha = await lerLinha(item.id);

    expect(linha.onHand).toBe("17");
    expect(linha.available).toBe("10");
    expect(linha.unavailable).toEqual([
      { reason: "AWAITING_QUALITY_RELEASE", quantity: "5" },
      { reason: "EXPIRED", quantity: "2" },
    ]);
  });

  it("nada retido, nada a explicar", async () => {
    const item = await criarCenario([
      { status: "AVAILABLE", quantidade: "8", expiry: DAQUI_UM_ANO },
    ]);
    const linha = await lerLinha(item.id);

    expect(linha.available).toBe("8");
    // Lista vazia, e não uma causa inventada para justificar zero.
    expect(linha.unavailable).toEqual([]);
  });
});
