import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Exclusividade de posição sob concorrência real.
 *
 * A checagem prévia ("já está num inventário aberto?") lê o que está
 * confirmado. Uma transação que ainda não confirmou a posição é invisível para
 * ela — e é exatamente o caso de dois inícios simultâneos. Quem segura é o
 * índice único de `openPositionKey`: a segunda inserção ESPERA a primeira
 * transação e, quando ela confirma, falha. Estes testes seguram a primeira
 * transação aberta, provam pelo `pg_stat_activity` onde a segunda parou,
 * soltam, e conferem que a segunda saiu com 409 sem gravar nada.
 *
 * A contagem rápida para antes do índice: ela trava a linha do lote logo no
 * começo, e a inserção concorrente da posição já segura essa linha pela chave
 * estrangeira (`FOR KEY SHARE`). Ela espera a outra transação terminar e só
 * então checa — e aí a posição aberta já está confirmada.
 */

const itensCriados: string[] = [];
const sessoesCriadas: string[] = [];

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (itensCriados.length > 0) {
    const posicoes = await prisma.stockCountPosition.findMany({
      where: { itemId: { in: itensCriados } },
      select: { stockCountId: true },
    });
    sessoesCriadas.push(...posicoes.map((posicao) => posicao.stockCountId));
  }
  if (sessoesCriadas.length > 0) {
    await prisma.stockCount.deleteMany({ where: { id: { in: [...new Set(sessoesCriadas)] } } });
  }
  if (itensCriados.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itensCriados } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itensCriados } } });
    await prisma.item.deleteMany({ where: { id: { in: itensCriados } } });
  }
});

async function loteComSaldo() {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-INVC-${m}`,
      name: `Insumo corrida ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itensCriados.push(item.id);
  const lote = await prisma.lot.create({
    data: { code: `LT-INVC-${m}`, itemId: item.id, initialReceivedQuantity: "0", status: "AVAILABLE" },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: lote.id,
      type: "RECEIPT_IN",
      quantity: "10",
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return { item, lote };
}

/**
 * Abre uma transação que põe a posição num inventário aberto e NÃO confirma
 * até `soltar()`. Para a checagem prévia de qualquer outra conexão, a posição
 * ainda está livre.
 */
async function segurarPosicaoAberta(
  item: { id: string; code: string; name: string; unitCode: string },
  lote: { id: string; code: string },
) {
  let soltar!: () => void;
  const segurando = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  let avisarAberta!: (codigo: string) => void;
  const aberta = new Promise<string>((resolve) => {
    avisarAberta = resolve;
  });
  const chave = `${item.id}:${lote.id}`;

  const confirmada = getPrisma().$transaction(
    async (tx) => {
      const sessao = await tx.stockCount.create({
        data: {
          code: `INV-CORRIDA-${marca()}`,
          kind: "SESSION",
          mode: "BLIND",
          status: "IN_PROGRESS",
          referenceAt: new Date(),
          createdByName: "Transação concorrente",
        },
      });
      sessoesCriadas.push(sessao.id);
      await tx.stockCountPosition.create({
        data: {
          stockCountId: sessao.id,
          sequence: 1,
          positionKey: chave,
          openPositionKey: chave,
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          itemType: "RAW_MATERIAL",
          unitCode: item.unitCode,
          lotId: lote.id,
          lotCode: lote.code,
          origin: "SCOPE",
          referenceQuantity: "10",
          referenceAt: new Date(),
        },
      });
      avisarAberta(sessao.code);
      await segurando;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  const codigo = await aberta;
  return { codigo, soltar, confirmada };
}

/** Outra conexão parou esperando trava, numa consulta que casa `padrao`. */
async function paradaNaTrava(padrao: string): Promise<boolean> {
  const prisma = getPrisma();
  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const [linha] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE ${padrao}`;
    if ((linha?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("Exclusividade de posição com transações simultâneas", () => {
  it("início de inventário simultâneo na mesma posição espera o índice único e sai com 409", async () => {
    const app = buildTestApp();
    await app.ready();
    const { item, lote } = await loteComSaldo();
    const { codigo, soltar, confirmada } = await segurarPosicaoAberta(item, lote);

    const inicio = app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "BLIND", scope: { balance: "WITH_BALANCE", lotIds: [lote.id] } },
    });
    // Parou no índice único: a checagem prévia não enxergou a posição não confirmada.
    const parou = await paradaNaTrava("%INSERT INTO%stock_count_positions%");
    soltar();
    await confirmada;
    const resposta = await inicio;

    expect(parou).toBe(true);
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("position_in_open_count");
    expect(resposta.json().held).toEqual([expect.objectContaining({ stockCountCode: codigo })]);
    // Nenhuma segunda posição, aberta ou não, e nenhuma sessão nova do início recusado.
    expect(await getPrisma().stockCountPosition.count({ where: { lotId: lote.id } })).toBe(1);

    await app.close();
  }, 30_000);

  it("contagem rápida simultânea a um inventário na mesma posição espera a outra transação e sai com 409, sem ajuste", async () => {
    const app = buildTestApp();
    await app.ready();
    const { item, lote } = await loteComSaldo();
    const { codigo, soltar, confirmada } = await segurarPosicaoAberta(item, lote);

    const rapida = app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, lotId: lote.id, countedQuantity: "7", reason: "Contagem por fora" },
    });
    // Parou na trava do lote, que a inserção concorrente segura pela chave estrangeira.
    const parou = await paradaNaTrava("%FROM lots%FOR UPDATE%");
    soltar();
    await confirmada;
    const resposta = await rapida;

    expect(parou).toBe(true);
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("position_in_open_count");
    expect(resposta.json().held).toEqual([expect.objectContaining({ stockCountCode: codigo })]);
    expect(await getPrisma().inventoryMovement.count({ where: { lotId: lote.id } })).toBe(1);
    expect(await getPrisma().stockCountPosition.count({ where: { lotId: lote.id } })).toBe(1);

    await app.close();
  }, 30_000);
});
