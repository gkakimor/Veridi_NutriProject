import { PrismaClient } from "@prisma/client";
import type { CoaStatus, QualityQueueResponse } from "@veridi/shared";
import { COA_STATUSES } from "@veridi/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { QUALITY_QUEUE_ALL_ROWS_LIMIT } from "./quality.service.js";

/**
 * Fila da Qualidade inteira num retrato só (PAGED-DOCUMENT-SNAPSHOT-01).
 *
 * A folha FO-03 lia a fila página por página por deslocamento: uma pendência
 * saindo antes do deslocamento e outra entrando depois dele mantinham o
 * `total`, nenhuma chave repetia e um lote ficava fora do papel. `all=true`
 * devolve o recorte inteiro de UMA leitura, dentro de uma transação
 * `RepeatableRead` (a lista e o saldo dos lotes enxergam o mesmo instante), e
 * recusa acima de `QUALITY_QUEUE_ALL_ROWS_LIMIT` em vez de cortar.
 *
 * Portão de consulta (receita de `dashboard-retrato-unico.test.ts`): armado,
 * segura a transação logo depois da leitura dos lotes, e uma SEGUNDA conexão
 * escreve no meio — sem `sleep`.
 */
const portao = vi.hoisted(() => {
  const estado = {
    armado: false,
    retidas: 0,
    soltar: () => {},
    liberado: Promise.resolve(),
    avisarLido: () => {},
    lido: Promise.resolve(),
  };
  return {
    estado,
    armar() {
      estado.retidas = 0;
      estado.liberado = new Promise<void>((resolve) => {
        estado.soltar = resolve;
      });
      estado.lido = new Promise<void>((resolve) => {
        estado.avisarLido = resolve;
      });
      estado.armado = true;
    },
    desarmar() {
      estado.armado = false;
      estado.soltar();
    },
  };
});

vi.mock("../../db/prisma.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/prisma.js")>();
  const cliente = real.getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const resultado = await query(args);
          const { estado } = portao;
          // A leitura do recorte inteiro: o `findMany` de lotes com teto + 1 (1.000 + 1).
          const recorteInteiro =
            model === "Lot" && operation === "findMany" && (args as { take?: number } | undefined)?.take === 1001;
          if (estado.armado && recorteInteiro) {
            estado.retidas += 1;
            estado.avisarLido();
            await estado.liberado;
          }
          return resultado;
        },
      },
    },
  });
  return { ...real, getPrisma: () => cliente };
});

type App = ReturnType<typeof buildTestApp>;

const m = `QAR${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const criados = { itens: [] as string[] };
const itemDe: Record<string, string> = {};

const PENDENCIAS: readonly CoaStatus[] = ["PENDING", "RECEIVED", "REJECTED"];
const FORA: readonly CoaStatus[] = ["NOT_REQUIRED", "APPROVED"];

/** A "segunda conexão": outro cliente, outro pool — nunca a transação da fila. */
const escritor = new PrismaClient();

let app: App;

async function criarItem(sufixo: string): Promise<string> {
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-${m}-${sufixo}`,
      name: `Insumo ${m} ${sufixo}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: true,
    },
  });
  criados.itens.push(item.id);
  itemDe[sufixo] = item.id;
  return item.id;
}

function dadosDoLote(itemId: string, codigo: string, coaStatus: CoaStatus) {
  return {
    code: codigo,
    itemId,
    initialReceivedQuantity: "10",
    status: coaStatus === "REJECTED" ? ("BLOCKED" as const) : ("AWAITING_RELEASE" as const),
    requiresCoaSnapshot: coaStatus !== "NOT_REQUIRED",
    coaStatus,
  };
}

/** `pendentes` pendências e `fora` lotes fora do recorte, gravados de trás para frente. */
async function criarLotes(sufixo: string, pendentes: number, fora: number) {
  const itemId = await criarItem(sufixo);
  const dados = [
    ...Array.from({ length: pendentes }, (_, i) =>
      dadosDoLote(itemId, `LT-${m}-${sufixo}-P${String(i).padStart(5, "0")}`, PENDENCIAS[i % PENDENCIAS.length]!),
    ),
    ...Array.from({ length: fora }, (_, i) =>
      dadosDoLote(itemId, `LT-${m}-${sufixo}-F${String(i).padStart(5, "0")}`, FORA[i % FORA.length]!),
    ),
  ].reverse();
  await getPrisma().lot.createMany({ data: dados });
  return dados;
}

/** A ordem do servidor: `coaStatus` na ordem do enum, depois o código. */
function ordemDoServidor(dados: { code: string; coaStatus: CoaStatus }[]): string[] {
  return dados
    .filter((lote) => PENDENCIAS.includes(lote.coaStatus))
    .sort((a, b) => {
      const porStatus = COA_STATUSES.indexOf(a.coaStatus) - COA_STATUSES.indexOf(b.coaStatus);
      return porStatus !== 0 ? porStatus : a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    })
    .map((lote) => lote.code);
}

async function fila(query: string) {
  return app.inject({ method: "GET", url: `/quality/coa-queue?${query}` });
}

const massas: Record<string, { code: string; coaStatus: CoaStatus }[]> = {};

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  for (const quantidade of [0, 1, 100, 101, 500]) {
    massas[String(quantidade)] = await criarLotes(`N${quantidade}`, quantidade, 20);
  }
  massas["TETO"] = await criarLotes("TETO", QUALITY_QUEUE_ALL_ROWS_LIMIT + 1, 5);
  app = buildTestApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  portao.desarmar();
  const prisma = getPrisma();
  if (criados.itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
    await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  }
  await escritor.$disconnect();
  await app?.close();
});

describe("GET /quality/coa-queue?all=true — o recorte inteiro, numa resposta", () => {
  it("o teto é o de um documento operacional", () => {
    expect(QUALITY_QUEUE_ALL_ROWS_LIMIT).toBe(1000);
  });

  it.each([0, 1, 100, 101, 500])("%i pendência(s) entre 20 fora do recorte: todas, na ordem do servidor", async (quantidade) => {
    const resposta = await fila(`itemId=${itemDe[`N${quantidade}`]}&onlyPending=true&all=true`);
    expect(resposta.statusCode, resposta.body.slice(0, 200)).toBe(200);
    const corpo = resposta.json() as QualityQueueResponse;

    expect(corpo.rows.map((row) => row.lotCode)).toEqual(ordemDoServidor(massas[String(quantidade)]!));
    expect(corpo).toMatchObject({ total: quantidade, page: 1, pageSize: quantidade });
    expect(corpo.rows.every((row) => PENDENCIAS.includes(row.coaStatus))).toBe(true);
  });

  it("page e pageSize não cortam o recorte inteiro; sem all, a paginação segue a de sempre", async () => {
    const inteira = (await fila(`itemId=${itemDe["N101"]}&onlyPending=true&all=true&page=3&pageSize=5`)).json();
    expect(inteira.rows).toHaveLength(101);
    expect(inteira.total).toBe(101);

    const segunda = (await fila(`itemId=${itemDe["N101"]}&onlyPending=true&page=2&pageSize=100`)).json();
    expect(segunda.rows.map((row: { lotCode: string }) => row.lotCode)).toEqual(ordemDoServidor(massas["101"]!).slice(100));
    expect(segunda.total).toBe(101);
  });

  it('all fora de "true"/"false" é 400', async () => {
    const resposta = await fila(`itemId=${itemDe["N1"]}&all=abc`);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });

  it("um acima do teto recusa com a frase, sem linha nenhuma; no teto exato, todas", async () => {
    const acima = await fila(`itemId=${itemDe["TETO"]}&onlyPending=true&all=true`);
    expect(acima.statusCode).toBe(400);
    expect(acima.json()).toEqual({
      error: "quality_queue_too_large",
      message:
        "A fila tem mais de 1.000 lotes neste recorte — acima do limite de um documento. Trate parte das pendências em Qualidade → Documentos / CoA e gere de novo.",
    });

    // Uma pendência tratada: o recorte volta ao teto e sai inteiro.
    const tratada = ordemDoServidor(massas["TETO"]!)[0]!;
    await getPrisma().lot.update({ where: { code: tratada }, data: { coaStatus: "APPROVED" } });
    const noTeto = await fila(`itemId=${itemDe["TETO"]}&onlyPending=true&all=true`);
    expect(noTeto.statusCode).toBe(200);
    const corpo = noTeto.json() as QualityQueueResponse;
    expect(corpo.total).toBe(QUALITY_QUEUE_ALL_ROWS_LIMIT);
    expect(corpo.rows.map((row) => row.lotCode)).toEqual(ordemDoServidor(massas["TETO"]!).slice(1));
  }, 30_000);
});

describe("GET /quality/coa-queue?all=true — um retrato só, com a fila mudando no meio", () => {
  it("pendência sai, outra entra e o saldo muda durante a leitura: a resposta é o instante da leitura, inteiro", async () => {
    const prisma = getPrisma();
    const itemId = await criarItem("RETRATO");
    const [a, b, c] = ["A", "B", "C"].map((letra) => dadosDoLote(itemId, `LT-${m}-RETRATO-${letra}`, "PENDING"));
    await prisma.lot.createMany({ data: [a!, b!, c!] });
    const loteA = await prisma.lot.findUniqueOrThrow({ where: { code: a!.code } });
    await prisma.inventoryMovement.create({
      data: { itemId, lotId: loteA.id, type: "RECEIPT_IN", quantity: "25", occurredAt: new Date(), sourceType: "RECEIPT" },
    });
    const url = `itemId=${itemId}&onlyPending=true&all=true`;
    const antes = (await fila(url)).json() as QualityQueueResponse;
    expect(antes.rows.map((row) => [row.lotCode, row.onHand])).toEqual([
      [a!.code, "25"],
      [b!.code, "0"],
      [c!.code, "0"],
    ]);

    portao.armar();
    const durante = fila(url);
    await portao.estado.lido;

    // Outra conexão, com a transação da fila parada entre a lista e o saldo:
    // B sai da fila, D entra, A recebe mais 10.
    await escritor.lot.update({ where: { code: b!.code }, data: { coaStatus: "APPROVED" } });
    await escritor.lot.create({ data: dadosDoLote(itemId, `LT-${m}-RETRATO-D`, "PENDING") });
    await escritor.inventoryMovement.create({
      data: { itemId, lotId: loteA.id, type: "RECEIPT_IN", quantity: "10", occurredAt: new Date(), sourceType: "RECEIPT" },
    });
    portao.desarmar();

    const resposta = await durante;
    expect(resposta.statusCode).toBe(200);
    expect(portao.estado.retidas).toBe(1);
    expect((resposta.json() as QualityQueueResponse).rows.map((row) => [row.lotCode, row.onHand])).toEqual(
      antes.rows.map((row) => [row.lotCode, row.onHand]),
    );

    // Depois da escrita, a próxima leitura já é o outro instante, inteiro.
    const depois = (await fila(url)).json() as QualityQueueResponse;
    expect(depois.rows.map((row) => [row.lotCode, row.onHand])).toEqual([
      [a!.code, "35"],
      [c!.code, "0"],
      [`LT-${m}-RETRATO-D`, "0"],
    ]);
  });
});
