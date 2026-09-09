import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { buildAttentionList } from "../dashboard/attention.service.js";

/**
 * A validade inclusiva nas features, não só no helper — TZ-LOTE-01.
 *
 * O helper isolado já está provado em `lib/validade-de-lote.test.ts`. A
 * pergunta aqui é outra: disponibilidade, liberação e relatório passaram
 * mesmo a enxergar o dia civil, ou alguma delas ficou com a comparação
 * antiga? As três respondiam à mesma pergunta e as três erravam.
 *
 * O relógio é controlado com `toFake: ["Date"]`, como em
 * `lib/dia-comercial-em-uso.test.ts`. Os dois instantes usados distam **um
 * milissegundo** um do outro, e é de propósito: são os dois lados exatos da
 * meia-noite de São Paulo, o único ponto em que o lote deve mudar de estado.
 * Testar com "ontem" e "amanhã" não provaria nada — o defeito antigo também
 * acertava esses.
 *
 * Sob a implementação anterior (`expiryDate.getTime() < Date.now()`) todos os
 * casos "válido" abaixo reprovam: o marcador de 15/09 é a meia-noite UTC, que
 * em São Paulo são 21h de 14/09, então o lote nascia vencido para o sistema
 * quase um dia antes do que o rótulo dizia.
 */

/** 15/09/2026 23:59:59.999 em São Paulo — o último instante de validade. */
const FIM_DO_DIA_DA_VALIDADE = new Date("2026-09-16T02:59:59.999Z");
/** 16/09/2026 00:00:00.000 em São Paulo — o primeiro instante de vencido. */
const MEIA_NOITE_SEGUINTE = new Date("2026-09-16T03:00:00.000Z");

/** Como a coluna guarda 15/09/2026: o marcador do dia, meia-noite UTC. */
const VALIDADE_15_09 = new Date("2026-09-15T00:00:00.000Z");

const itemIds: string[] = [];
const lotIds: string[] = [];
const app = buildTestApp();

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Relógio parado no instante pedido, para o teste inteiro. */
function relogioEm(instante: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instante);
}

let itemId: string;
let itemCode: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const m = marca();
  itemCode = `MP-TZL-${m}`;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: itemCode,
      name: `Insumo validade civil ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
    },
  });
  itemId = item.id;
  itemIds.push(item.id);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (lotIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  await app.close();
});

/** Lote com saldo real no ledger — disponibilidade se mede em movimento. */
async function criarLote(
  status: "AVAILABLE" | "AWAITING_RELEASE",
  quantidade: string,
): Promise<{ id: string; code: string }> {
  const prisma = getPrisma();
  const m = marca();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-TZL-${m}`,
      origin: "RECEIPT",
      itemId,
      ownerType: "VERIDI",
      status,
      expiryDate: VALIDADE_15_09,
      initialReceivedQuantity: new Prisma.Decimal(quantidade),
      createdBy: "teste",
    },
  });
  lotIds.push(lot.id);

  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity: new Prisma.Decimal(quantidade),
      occurredAt: new Date("2026-01-05T12:00:00.000Z"),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "fixture TZ-LOTE-01",
      createdBy: "teste",
    },
  });
  return { id: lot.id, code: lot.code };
}

type LinhaDeEstoque = {
  onHand: string;
  available: string;
  unavailable: { reason: string; quantity: string }[];
};

async function linhaDoEstoque(): Promise<LinhaDeEstoque> {
  const resposta = await app.inject({ method: "GET", url: `/inventory?search=${itemCode}` });
  expect(resposta.statusCode).toBe(200);
  const items = resposta.json().items as ({ itemId: string } & LinhaDeEstoque)[];
  const linha = items.find((item) => item.itemId === itemId);
  expect(linha).toBeDefined();
  return linha!;
}

/* 1 · Disponibilidade e seleção de lote. */
describe("o lote continua disponível no próprio dia da validade", () => {
  it("23:59:59 de 15/09 em São Paulo: o saldo ainda é usável", async () => {
    relogioEm(FIM_DO_DIA_DA_VALIDADE);
    await criarLote("AVAILABLE", "10");

    const linha = await linhaDoEstoque();
    expect(linha.onHand).toBe("10");
    expect(linha.available).toBe("10");
    expect(linha.unavailable).toEqual([]);
  });

  it("00:00 de 16/09 em São Paulo: o mesmo lote deixa de estar disponível, por vencimento", async () => {
    relogioEm(MEIA_NOITE_SEGUINTE);

    const linha = await linhaDoEstoque();
    expect(linha.onHand).toBe("10");
    expect(linha.available).toBe("0");
    // O físico não some — o que muda é a elegibilidade, e ela diz o porquê.
    expect(linha.unavailable).toEqual([{ reason: "EXPIRED", quantity: "10" }]);
  });
});

/* 2 · Uma regra operacional que hoje recusa lote vencido. */
describe("a liberação de lote segue a mesma regra, sem exceção de módulo", () => {
  it("liberar no próprio dia da validade é aceito", async () => {
    relogioEm(FIM_DO_DIA_DA_VALIDADE);
    const lote = await criarLote("AWAITING_RELEASE", "4");

    const resposta = await app.inject({ method: "POST", url: `/lots/${lote.id}/release` });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().status).toBe("AVAILABLE");
    expect(resposta.json().isExpired).toBe(false);
  });

  it("liberar depois da meia-noite é recusado, e o estado não muda", async () => {
    relogioEm(MEIA_NOITE_SEGUINTE);
    const lote = await criarLote("AWAITING_RELEASE", "4");

    const resposta = await app.inject({ method: "POST", url: `/lots/${lote.id}/release` });

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    // O que prova a recusa é o estado, não a resposta.
    const depois = await getPrisma().lot.findUniqueOrThrow({ where: { id: lote.id } });
    expect(depois.status).toBe("AWAITING_RELEASE");
    expect(depois.releasedAt).toBeNull();
  });
});

/*
 * 3 · O painel de atenção, que classifica o mesmo lote.
 *
 * "Vencido" e "vence em breve" são atenções diferentes, com severidades
 * diferentes. O lote do dia pertence à segunda: chamá-lo de vencido manda a
 * operação descartar material que ainda pode ser consumido naquele dia.
 * `buildAttentionList` é lida direto, como em `dashboard.test.ts`, e a
 * asserção olha só o lote deste arquivo.
 */
describe("o painel de atenção separa 'vence hoje' de 'vencido'", () => {
  it("no dia da validade a atenção é de proximidade, não de vencimento", async () => {
    relogioEm(FIM_DO_DIA_DA_VALIDADE);
    const lote = await criarLote("AVAILABLE", "3");

    const atencoes = await buildAttentionList(getPrisma());
    const minha = atencoes.find((item) => item.code === lote.code);

    expect(minha).toBeDefined();
    expect(minha!.type).toBe("LOT_NEAR_EXPIRY");
  });

  it("passada a meia-noite, a mesma atenção vira vencimento", async () => {
    relogioEm(MEIA_NOITE_SEGUINTE);
    const lote = await criarLote("AVAILABLE", "3");

    const atencoes = await buildAttentionList(getPrisma());
    const minha = atencoes.find((item) => item.code === lote.code);

    expect(minha).toBeDefined();
    expect(minha!.type).toBe("LOT_EXPIRED");
    expect(minha!.severity).toBe("CRITICAL");
  });
});

/* 4 · O relatório que classifica o vencimento. */
describe("o relatório de validade classifica pelo dia civil", () => {
  type LinhaDoRelatorio = { lotCode: string; daysToExpiry: number; isExpired: boolean };

  async function relatorio(window: string): Promise<LinhaDoRelatorio[]> {
    const resposta = await app.inject({
      method: "GET",
      url: `/reports/inventory/expiry?window=${window}&search=${itemCode}&pageSize=100`,
    });
    expect(resposta.statusCode).toBe(200);
    return resposta.json().rows as LinhaDoRelatorio[];
  }

  it("às 23:59 de 15/09 o lote não entra em Vencidos — ele vence hoje", async () => {
    relogioEm(FIM_DO_DIA_DA_VALIDADE);
    const lote = await criarLote("AVAILABLE", "6");

    expect((await relatorio("EXPIRED")).map((linha) => linha.lotCode)).not.toContain(lote.code);

    const proximos = await relatorio("D7");
    const linha = proximos.find((item) => item.lotCode === lote.code);
    expect(linha).toBeDefined();
    // Zero é "vence hoje". Contra o relógio, esta conta dava −1 às 22h.
    expect(linha!.daysToExpiry).toBe(0);
    expect(linha!.isExpired).toBe(false);
  });

  it("um milissegundo depois, à meia-noite de 16/09, ele passa para Vencidos", async () => {
    relogioEm(MEIA_NOITE_SEGUINTE);
    const lote = await criarLote("AVAILABLE", "6");

    const vencidos = await relatorio("EXPIRED");
    const linha = vencidos.find((item) => item.lotCode === lote.code);
    expect(linha).toBeDefined();
    expect(linha!.isExpired).toBe(true);
    expect(linha!.daysToExpiry).toBe(-1);
  });
});
