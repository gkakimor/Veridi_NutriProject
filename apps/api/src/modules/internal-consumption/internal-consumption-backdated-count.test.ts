import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, Lot, Prisma } from "@prisma/client";
import type { StockCountDetailDTO, StockCountPositionDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS, diaCivilDeslocado, hojeComercial, inicioDoDiaComercial } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getOnHand } from "../../lib/inventory-ledger.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * CONSUMO DE DATA PASSADA × INVENTÁRIO — INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01.
 *
 * O cenário do handoff: dia 15 o material sai e ninguém lança; dia 17 o
 * inventário encontra a falta e ajusta; dia 19 alguém lança o consumo com data
 * de 15. Sem guarda, a baixa acontecia duas vezes (reproduzido na `main`
 * cf8d353e: Contagem rápida −3, saldo 7 = físico; CI de anteontem 201, saldo 4).
 *
 * O que este arquivo prova:
 * - consumo de DIA PASSADO recusa (409, nada gravado) quando um inventário
 *   encerrado — sessão ou Contagem rápida — reconciliou a posição numa contagem
 *   do dia do consumo ou posterior (ajustou, ou conferiu sem diferença);
 * - a fronteira é o INÍCIO do dia comercial do consumo contra o `countedAt`:
 *   mesmo dia recusa (o dia não tem hora), um milissegundo antes passa;
 * - inventário aberto que já contou a posição nesse período recusa; posição
 *   aberta ainda não contada passa, e a contagem seguinte lê o consumo;
 * - consumo de hoje, outro lote, inventário cancelado, posição retirada e
 *   "Não ajustar" não bloqueiam;
 * - concorrência: Contagem rápida, registro de contagem e encerramento em
 *   curso seguram o consumo, que relê depois da trava e recusa.
 */

type App = ReturnType<typeof buildTestApp>;
type Db = ReturnType<typeof getPrisma> | Prisma.TransactionClient;

const itens: string[] = [];

/** O exemplo do handoff, em datas fixas: 15/09 sai, 17/09 às 10:30 conta, 10:32 encerra. */
const DIA_DO_CONSUMO = "2026-09-15";
const CONTADO_EM = new Date("2026-09-17T13:30:00.000Z");
const ENCERRADO_EM = new Date("2026-09-17T13:32:00.000Z");

const admin = () => buildTestApp("ADMIN");

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** Anteontem no dia comercial — um dia passado antes de toda contagem feita agora. */
function anteontem(): string {
  return diaCivilDeslocado(hojeComercial(), -2);
}

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (itens.length === 0) return;
  const posicoes = await prisma.stockCountPosition.findMany({
    where: { itemId: { in: itens } },
    select: { stockCountId: true },
  });
  const sessoes = [...new Set(posicoes.map((posicao) => posicao.stockCountId))];
  if (sessoes.length > 0) await prisma.stockCount.deleteMany({ where: { id: { in: sessoes } } });
  await prisma.internalConsumption.deleteMany({ where: { itemId: { in: itens } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
  await prisma.item.deleteMany({ where: { id: { in: itens } } });
});

async function criarItem(extra: Record<string, unknown> = {}): Promise<Item> {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "INTERNAL_CONSUMABLE",
      code: `UC-CIR-${m}`,
      name: `Uso e consumo retroativo ${m}`,
      unitCode: "un",
      ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
      active: true,
      ...extra,
    },
  });
  itens.push(item.id);
  return item;
}

async function criarLote(itemId: string): Promise<Lot> {
  return getPrisma().lot.create({
    data: { code: `LT-CIR-${marca()}`, itemId, initialReceivedQuantity: "0", status: "AVAILABLE" },
  });
}

/**
 * Saldo de partida, carimbado um minuto antes. O `createdAt` do Prisma sai do
 * relógio do sistema, e o `new Date()` do Node no Windows anda 1–3 ms atrás
 * dele: carimbado "agora", o saldo inicial podia cair depois da referência de
 * uma sessão iniciada em seguida e virar "movimentação durante o inventário".
 */
async function entrada(itemId: string, quantity: string, lotId: string | null = null): Promise<void> {
  const umMinutoAntes = new Date(Date.now() - 60_000);
  await getPrisma().inventoryMovement.create({
    data: {
      itemId,
      lotId,
      type: "ADJUSTMENT_IN",
      quantity,
      occurredAt: umMinutoAntes,
      createdAt: umMinutoAntes,
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Saldo de teste",
    },
  });
}

async function saldo(itemId: string, lotId: string | null = null): Promise<string> {
  return (await getOnHand(getPrisma(), { itemId, lotId })).toString();
}

function consumir(app: App, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/internal-consumptions", payload });
}

async function contagemRapida(
  app: App,
  payload: { itemId: string; lotId?: string; countedQuantity: string; reason?: string },
): Promise<{ stockCountId: string; stockCountCode: string }> {
  const resposta = await app.inject({ method: "POST", url: "/stock-counts", payload });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json();
}

/** Nada do consumo recusado ficou: nem registro CI-, nem baixa no ledger. */
async function semConsumoGravado(itemId: string): Promise<void> {
  const prisma = getPrisma();
  expect(await prisma.internalConsumption.count({ where: { itemId } })).toBe(0);
  expect(await prisma.inventoryMovement.count({ where: { itemId, type: "INTERNAL_CONSUMPTION" } })).toBe(0);
}

/** Inventário gravado direto — o estado exato que a guarda precisa ler. */
async function inventario(
  params: {
    item: Item;
    lot?: Lot | null;
    status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    contadoEm?: Date;
    encerradoEm?: Date;
    contado?: string;
    esperado?: string;
    decisao?: "ADJUST" | "NO_ADJUSTMENT";
    retirada?: boolean;
  },
  db: Db = getPrisma(),
) {
  const lote = params.lot ?? null;
  const chave = lote ? `${params.item.id}:${lote.id}` : params.item.id;
  const agora = new Date();
  const sessao = await db.stockCount.create({
    data: {
      code: `INV-CIR-${marca()}`,
      kind: "SESSION",
      mode: "ASSISTED",
      status: params.status,
      referenceAt: params.contadoEm ?? agora,
      createdByName: "Teste",
      ...(params.status === "COMPLETED"
        ? { completedAt: params.encerradoEm ?? agora, completedByName: "Teste" }
        : {}),
      ...(params.status === "CANCELLED"
        ? { cancelledAt: agora, cancelledByName: "Teste", cancelReason: "teste" }
        : {}),
    },
  });
  const posicao = await db.stockCountPosition.create({
    data: {
      stockCountId: sessao.id,
      sequence: 1,
      positionKey: chave,
      openPositionKey: params.status === "IN_PROGRESS" && !params.retirada ? chave : null,
      itemId: params.item.id,
      lotId: lote?.id ?? null,
      itemCode: params.item.code,
      itemName: params.item.name,
      itemType: params.item.type,
      unitCode: params.item.unitCode,
      lotCode: lote?.code ?? null,
      origin: "SCOPE",
      referenceQuantity: params.esperado ?? "10",
      referenceAt: params.contadoEm ?? agora,
      ...(params.retirada ? { removedAt: agora, removedByName: "Teste", removeReason: "retirada no teste" } : {}),
    },
  });
  if (params.contadoEm) {
    const registro = await db.stockCountEntry.create({
      data: {
        positionId: posicao.id,
        round: 1,
        countedQuantity: params.contado ?? "7",
        expectedQuantity: params.esperado ?? "10",
        countedAt: params.contadoEm,
        countedByName: "Teste",
        source: "GRID",
      },
    });
    await db.stockCountPosition.update({
      where: { id: posicao.id },
      data: {
        validEntryId: registro.id,
        ...(params.decisao
          ? { decision: params.decisao, decisionReason: "Decisão do teste", decidedAt: params.contadoEm, decidedByName: "Teste" }
          : {}),
      },
    });
  }
  return { sessao, posicao };
}

/** Espera uma consulta de outra conexão parar numa trava — prova de que a trava existe. */
async function esperarTrava(padrao: string): Promise<void> {
  const prisma = getPrisma();
  for (let tentativa = 0; tentativa < 80; tentativa += 1) {
    const linhas = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query ILIKE ${padrao}
        AND pid <> pg_backend_pid() AND datname = current_database()`;
    if (Number(linhas[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`nenhuma consulta parada na trava: ${padrao}`);
}

/** Uma transação do teste aberta, sem commit, até `soltar()`. */
async function segurar(trabalho: (tx: Prisma.TransactionClient) => Promise<void>) {
  let abriu!: () => void;
  const aberta = new Promise<void>((resolve) => (abriu = resolve));
  let soltar!: () => void;
  const segurando = new Promise<void>((resolve) => (soltar = resolve));
  const transacao = getPrisma().$transaction(
    async (tx) => {
      await trabalho(tx);
      abriu();
      await segurando;
    },
    { timeout: 30_000 },
  );
  await aberta;
  return { soltar, transacao };
}

describe("consumo de data passada × inventário encerrado", () => {
  it("dupla baixa: a Contagem rápida acertou a falta, e o consumo de anteontem lançado depois recusa sem gravar", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    // Anteontem 3 un saíram e ninguém lançou; hoje a contagem encontra 7 e ajusta.
    const rapida = await contagemRapida(app, { itemId: item.id, countedQuantity: "7", reason: "Falta na contagem" });
    expect(await saldo(item.id)).toBe("7");

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: anteontem() });

    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json()).toMatchObject({
      error: "backdated_consumption_after_count",
      stockCountId: rapida.stockCountId,
      stockCountCode: rapida.stockCountCode,
      consumptionDate: anteontem(),
    });
    // O saldo segue o contado — a saída não foi baixada de novo.
    expect(await saldo(item.id)).toBe("7");
    await semConsumoGravado(item.id);
    // Só a entrada e o ajuste da contagem no ledger.
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: item.id } })).toBe(2);

    await app.close();
  });

  it("consumo de HOJE depois do inventário concluído passa — sem data e com a data de hoje", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    await contagemRapida(app, { itemId: item.id, countedQuantity: "7", reason: "Falta na contagem" });

    const semData = await consumir(app, { itemId: item.id, quantity: "1" });
    expect(semData.statusCode, semData.body).toBe(201);
    const comHoje = await consumir(app, { itemId: item.id, quantity: "1", occurredOn: hojeComercial() });
    expect(comHoje.statusCode, comHoje.body).toBe(201);
    expect(await saldo(item.id)).toBe("5");

    await app.close();
  });

  it("sessão de Inventário Físico encerrada com ajuste recusa o consumo de data anterior à contagem", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");

    const iniciada = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } },
    });
    expect(iniciada.statusCode, iniciada.body).toBe(201);
    const sessao = iniciada.json() as StockCountDetailDTO;
    const posicao = sessao.positions[0] as StockCountPositionDTO;
    const contada = await app.inject({
      method: "POST",
      url: `/stock-counts/${sessao.id}/positions/${posicao.id}/entries`,
      payload: {
        round: posicao.currentRound,
        expectedLastEntryId: posicao.lastEntryId,
        countedQuantity: "7",
        clientRequestId: randomUUID(),
      },
    });
    expect(contada.statusCode, contada.body).toBe(201);
    expect((await app.inject({ method: "POST", url: `/stock-counts/${sessao.id}/close-first-round` })).statusCode).toBe(200);
    const decidida = await app.inject({
      method: "POST",
      url: `/stock-counts/${sessao.id}/decisions`,
      payload: { decisions: [{ positionId: posicao.id, decision: "ADJUST", reason: "Falta confirmada" }] },
    });
    expect(decidida.statusCode, decidida.body).toBe(200);
    const encerrada = await app.inject({ method: "POST", url: `/stock-counts/${sessao.id}/complete` });
    expect(encerrada.statusCode, encerrada.body).toBe(200);
    expect(await saldo(item.id)).toBe("7");

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: anteontem() });

    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json()).toMatchObject({
      error: "backdated_consumption_after_count",
      stockCountId: sessao.id,
      stockCountCode: sessao.code,
    });
    expect(await saldo(item.id)).toBe("7");
    await semConsumoGravado(item.id);

    await app.close();
  });

  it("Contagem rápida que CONFERE também reconciliou a posição: o consumo de antes dela recusa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    const rapida = await contagemRapida(app, { itemId: item.id, countedQuantity: "10" });

    const resposta = await consumir(app, { itemId: item.id, quantity: "2", occurredOn: anteontem() });

    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json()).toMatchObject({
      error: "backdated_consumption_after_count",
      stockCountCode: rapida.stockCountCode,
    });
    expect(await saldo(item.id)).toBe("10");
    await semConsumoGravado(item.id);

    await app.close();
  });
});

describe("consumo de data passada — a fronteira temporal e a mensagem", () => {
  it("contagem de dia posterior ao consumo: 409 com o inventário, o encerramento, a contagem e o caminho", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    const { sessao } = await inventario({
      item,
      status: "COMPLETED",
      contadoEm: CONTADO_EM,
      encerradoEm: ENCERRADO_EM,
      decisao: "ADJUST",
    });

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({
      error: "backdated_consumption_after_count",
      message:
        `Consumo com data de 15/09/2026 recusado: o saldo de ${item.code} já foi reconciliado pelo inventário ` +
        `${sessao.code}, encerrado em 17/09/2026 às 10:32. A contagem, de 17/09/2026 às 10:30, é posterior ao dia ` +
        `do consumo e já refletiu a saída do material — lançar este consumo agora baixaria o material duas vezes. ` +
        `Revise a data e a quantidade do lançamento; se o saldo estiver errado, faça uma nova contagem.`,
      stockCountId: sessao.id,
      stockCountCode: sessao.code,
      consumptionDate: DIA_DO_CONSUMO,
      countedAt: CONTADO_EM.toISOString(),
      completedAt: ENCERRADO_EM.toISOString(),
    });
    await semConsumoGravado(item.id);

    await app.close();
  });

  it("contagem do MESMO dia do consumo recusa — o dia não tem hora; a partir do primeiro instante do dia", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    await inventario({ item, status: "COMPLETED", contadoEm: inicioDoDiaComercial(DIA_DO_CONSUMO), decisao: "ADJUST" });

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("backdated_consumption_after_count");
    expect(resposta.json().message).toContain(
      "A contagem, de 15/09/2026 às 00:00, é do mesmo dia do consumo e pode já ter refletido a saída do material",
    );
    await semConsumoGravado(item.id);

    await app.close();
  });

  it("contagem até o fim do dia ANTERIOR ao consumo não bloqueia — o consumo do dia seguinte à contagem passa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    // 14/09 às 23:59:59.999 em São Paulo: um milissegundo antes do dia do consumo.
    const umMsAntes = new Date(inicioDoDiaComercial(DIA_DO_CONSUMO).getTime() - 1);
    await inventario({ item, status: "COMPLETED", contadoEm: umMsAntes, decisao: "ADJUST" });

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });

    expect(resposta.statusCode, resposta.body).toBe(201);
    expect(await saldo(item.id)).toBe("7");

    await app.close();
  });
});

describe("consumo de data passada — a posição", () => {
  it("item com lote: a contagem do lote recusa o consumo daquele lote; o de OUTRO lote do mesmo item passa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const loteA = await criarLote(item.id);
    const loteB = await criarLote(item.id);
    await entrada(item.id, "10", loteA.id);
    await entrada(item.id, "10", loteB.id);
    const rapida = await contagemRapida(app, {
      itemId: item.id,
      lotId: loteA.id,
      countedQuantity: "6",
      reason: "Falta no lote",
    });

    const doLoteContado = await consumir(app, {
      itemId: item.id,
      lotId: loteA.id,
      quantity: "4",
      occurredOn: anteontem(),
    });
    expect(doLoteContado.statusCode, doLoteContado.body).toBe(409);
    expect(doLoteContado.json()).toMatchObject({
      error: "backdated_consumption_after_count",
      stockCountCode: rapida.stockCountCode,
    });
    expect(doLoteContado.json().message).toContain(`o saldo de ${item.code}, lote ${loteA.code} já foi reconciliado`);
    expect(await saldo(item.id, loteA.id)).toBe("6");

    const doOutroLote = await consumir(app, {
      itemId: item.id,
      lotId: loteB.id,
      quantity: "4",
      occurredOn: anteontem(),
    });
    expect(doOutroLote.statusCode, doOutroLote.body).toBe(201);
    expect(await saldo(item.id, loteB.id)).toBe("6");

    await app.close();
  });

  it("inventário cancelado e posição retirada não bloqueiam, mesmo contados depois do dia do consumo", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    await inventario({ item, status: "CANCELLED", contadoEm: CONTADO_EM });
    await inventario({ item, status: "COMPLETED", contadoEm: CONTADO_EM, decisao: "ADJUST", retirada: true });

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });

    expect(resposta.statusCode, resposta.body).toBe(201);

    await app.close();
  });

  it("'Não ajustar' não reconciliou: o saldo ficou o do sistema, e o consumo lançado depois é a baixa única", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    // Contou 7 contra 10 e decidiu não ajustar — "consumo ainda não lançado".
    await inventario({
      item,
      status: "COMPLETED",
      contadoEm: CONTADO_EM,
      contado: "7",
      esperado: "10",
      decisao: "NO_ADJUSTMENT",
    });

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });

    expect(resposta.statusCode, resposta.body).toBe(201);
    expect(await saldo(item.id)).toBe("7");

    await app.close();
  });
});

describe("consumo de data passada × inventário aberto", () => {
  it("posição já contada no dia do consumo ou depois, num inventário aberto, recusa citando o inventário", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    const { sessao } = await inventario({ item, status: "IN_PROGRESS", contadoEm: CONTADO_EM });

    const resposta = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({
      error: "backdated_consumption_in_open_count",
      message:
        `Consumo com data de 15/09/2026 recusado: ${item.code} está no inventário ${sessao.code}, ainda aberto, e já ` +
        `foi contado em 17/09/2026 às 10:30, depois do dia do consumo. A contagem já refletiu a saída do material, e ` +
        `o encerramento acertaria o saldo pela diferença — lançar este consumo agora baixaria o material duas vezes. ` +
        `Revise o lançamento e trate a diferença na revisão do inventário ${sessao.code}.`,
      stockCountId: sessao.id,
      stockCountCode: sessao.code,
      consumptionDate: DIA_DO_CONSUMO,
      countedAt: CONTADO_EM.toISOString(),
    });
    await semConsumoGravado(item.id);

    await app.close();
  });

  it("posição aberta ainda NÃO contada passa, e a contagem seguinte lê o consumo no esperado — sem dupla baixa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    const iniciada = await app.inject({
      method: "POST",
      url: "/stock-counts/sessions",
      payload: { mode: "ASSISTED", scope: { balance: "WITH_BALANCE", itemIds: [item.id] } },
    });
    expect(iniciada.statusCode, iniciada.body).toBe(201);
    const sessao = iniciada.json() as StockCountDetailDTO;
    const posicao = sessao.positions[0] as StockCountPositionDTO;

    const consumo = await consumir(app, { itemId: item.id, quantity: "3", occurredOn: anteontem() });
    expect(consumo.statusCode, consumo.body).toBe(201);

    const contada = await app.inject({
      method: "POST",
      url: `/stock-counts/${sessao.id}/positions/${posicao.id}/entries`,
      payload: {
        round: posicao.currentRound,
        expectedLastEntryId: posicao.lastEntryId,
        countedQuantity: "7",
        clientRequestId: randomUUID(),
      },
    });
    expect(contada.statusCode, contada.body).toBe(201);
    expect(contada.json().entry.expectedQuantity).toBe("7");
    expect(contada.json().entry.difference).toBe("0");
    expect(await saldo(item.id)).toBe("7");

    await app.close();
  });

  it("posição aberta contada ANTES do dia do consumo passa; consumo de hoje nunca é barrado pelo aberto", async () => {
    const app = admin();
    await app.ready();
    const antes = await criarItem();
    await entrada(antes.id, "10");
    const umMsAntes = new Date(inicioDoDiaComercial(DIA_DO_CONSUMO).getTime() - 1);
    await inventario({ item: antes, status: "IN_PROGRESS", contadoEm: umMsAntes });
    const retroativo = await consumir(app, { itemId: antes.id, quantity: "3", occurredOn: DIA_DO_CONSUMO });
    expect(retroativo.statusCode, retroativo.body).toBe(201);

    const hoje = await criarItem();
    await entrada(hoje.id, "10");
    await inventario({ item: hoje, status: "IN_PROGRESS", contadoEm: new Date() });
    const deHoje = await consumir(app, { itemId: hoje.id, quantity: "3" });
    expect(deHoje.statusCode, deHoje.body).toBe(201);

    await app.close();
  });
});

describe("consumo de data passada — concorrência", () => {
  it("Contagem rápida em curso: o consumo espera a trava do escopo, relê e recusa — nada gravado", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");

    // A "Contagem rápida" é a transação do teste: trava o escopo como ela e
    // grava o INV- encerrado, sem commit.
    const { soltar, transacao } = await segurar(async (tx) => {
      await tx.$queryRaw`SELECT id FROM items WHERE id = ${item.id} FOR UPDATE`;
      await inventario({ item, status: "COMPLETED", contadoEm: new Date(), decisao: "ADJUST" }, tx);
    });

    const post = consumir(app, { itemId: item.id, quantity: "3", occurredOn: anteontem() });
    // Parado NA TRAVA DO ESCOPO — a guarda roda depois dela, e por isso vê a contagem.
    await esperarTrava("%FROM items%FOR UPDATE%");
    soltar();
    await transacao;

    const resposta = await post;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("backdated_consumption_after_count");
    await semConsumoGravado(item.id);

    await app.close();
  });

  it("registro de contagem em curso na sessão aberta: o consumo espera a trava da posição, relê e recusa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    const { posicao } = await inventario({ item, status: "IN_PROGRESS" });

    // O registro da contagem é a transação do teste: trava a posição como o
    // serviço e grava o registro que vale, sem commit.
    const { soltar, transacao } = await segurar(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_count_positions WHERE id = ${posicao.id} FOR UPDATE`;
      const registro = await tx.stockCountEntry.create({
        data: {
          positionId: posicao.id,
          round: 1,
          countedQuantity: "7",
          expectedQuantity: "10",
          countedAt: new Date(),
          countedByName: "Teste",
          source: "GRID",
        },
      });
      await tx.stockCountPosition.update({ where: { id: posicao.id }, data: { validEntryId: registro.id } });
    });

    const post = consumir(app, { itemId: item.id, quantity: "3", occurredOn: anteontem() });
    // Sem a trava da posição, o consumo leria a posição ainda sem contagem e gravaria.
    await esperarTrava("%stock_count_positions%FOR SHARE%");
    soltar();
    await transacao;

    const resposta = await post;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("backdated_consumption_in_open_count");
    await semConsumoGravado(item.id);

    await app.close();
  });

  it("encerramento em curso: o consumo espera a posição sair do aberto e recusa pelo inventário já encerrado", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entrada(item.id, "10");
    const { sessao } = await inventario({ item, status: "IN_PROGRESS", contadoEm: new Date(), decisao: "ADJUST" });

    // O encerramento é a transação do teste: tira as posições do aberto e
    // encerra, sem commit.
    const { soltar, transacao } = await segurar(async (tx) => {
      await tx.stockCountPosition.updateMany({ where: { stockCountId: sessao.id }, data: { openPositionKey: null } });
      await tx.stockCount.update({
        where: { id: sessao.id },
        data: { status: "COMPLETED", completedAt: new Date(), completedByName: "Teste" },
      });
    });

    const post = consumir(app, { itemId: item.id, quantity: "3", occurredOn: anteontem() });
    await esperarTrava("%stock_count_positions%FOR SHARE%");
    soltar();
    await transacao;

    const resposta = await post;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json()).toMatchObject({ error: "backdated_consumption_after_count", stockCountId: sessao.id });
    expect(resposta.json().completedAt).toBeDefined();
    await semConsumoGravado(item.id);

    await app.close();
  });
});
