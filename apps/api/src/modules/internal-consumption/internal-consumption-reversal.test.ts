import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, Lot, UomDimension, UserRole } from "@prisma/client";
import type {
  InternalConsumptionDetailDTO,
  InternalConsumptionReportDTO,
  InternalConsumptionReversalDTO,
  InventoryMovementListResponse,
  MovementReportRowDTO,
} from "@veridi/shared";
import { INTERNAL_CONSUMPTION_REVERSAL_ROLES, ITEM_TYPE_DEFAULTS, USER_ROLES } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { Decimal } from "../../lib/decimal.js";
import { getOnHand } from "../../lib/inventory-ledger.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { custoTotalDoEstorno } from "./internal-consumption-reversal.service.js";

/**
 * ESTORNO DE CONSUMO INTERNO — INTERNAL-CONSUMPTION-REVERSAL-01.
 *
 * O que este arquivo prova, e por quê:
 *
 * - o estorno é uma ENTRADA própria do ledger, no mesmo escopo do CI, datada
 *   no instante do estorno; o CI e a baixa original nunca mudam;
 * - estornado e saldo estornável são SOMA: total, parcial e vários estornos,
 *   nunca além da quantidade do CI — nem com dois estornos ao mesmo tempo;
 * - o custo é CÓPIA do snapshot do CI (um custo de recebimento corrigido
 *   depois não muda nada), `null` quando o CI não tem custo, e o estorno que
 *   zera o saldo leva o resto — o integral fecha o total original;
 * - volta ao MESMO lote, mesmo bloqueado ou vencido, sem mudar a situação;
 * - inventário aberto ou contagem encerrada depois do CI recusam (a contagem
 *   já acertou o saldo); inventário anterior, cancelado ou posição retirada não;
 * - só ADMIN e QUALITY estornam, com 403 antes do corpo; o autor é a sessão;
 * - extrato, R-03 e R-21 reconhecem o estorno.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

const itens: string[] = [];
const fornecedores: string[] = [];
const pedidosDeCompra: string[] = [];
const recebimentos: string[] = [];
const sessoes: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const admin = () => buildTestApp("ADMIN");

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (itens.length > 0) {
    // Estorno antes do CI (FK RESTRICT) e antes dos usuários do arquivo.
    await prisma.internalConsumptionReversal.deleteMany({
      where: { originalConsumption: { is: { itemId: { in: itens } } } },
    });
    const posicoes = await prisma.stockCountPosition.findMany({
      where: { itemId: { in: itens } },
      select: { stockCountId: true },
    });
    const todas = [...new Set([...sessoes, ...posicoes.map((posicao) => posicao.stockCountId)])];
    if (todas.length > 0) await prisma.stockCount.deleteMany({ where: { id: { in: todas } } });
    await prisma.internalConsumption.deleteMany({ where: { itemId: { in: itens } } });
  }
  if (recebimentos.length > 0) {
    await prisma.inventoryMovement.deleteMany({
      where: { receiptLine: { is: { receiptId: { in: recebimentos } } } },
    });
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: recebimentos } } });
    await prisma.receipt.deleteMany({ where: { id: { in: recebimentos } } });
  }
  if (pedidosDeCompra.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: pedidosDeCompra } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: pedidosDeCompra } } });
  }
  if (itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fornecedores.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
});

async function criarItem(extra: Record<string, unknown> = {}): Promise<Item> {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type: "INTERNAL_CONSUMABLE",
      code: `UC-ECI-${m}`,
      name: `Uso e consumo estorno ${m}`,
      unitCode: "un",
      ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
      active: true,
      ...extra,
    },
  });
  itens.push(item.id);
  return item;
}

async function criarLote(itemId: string, extra: Record<string, unknown> = {}): Promise<Lot> {
  return getPrisma().lot.create({
    data: { code: `LT-ECI-${marca()}`, itemId, initialReceivedQuantity: "0", status: "AVAILABLE", ...extra },
  });
}

/** Saldo SEM custo — entrada de ajuste direto no ledger. */
async function entradaSemCusto(itemId: string, quantity: string, lotId: string | null = null) {
  await getPrisma().inventoryMovement.create({
    data: {
      itemId,
      lotId,
      type: "ADJUSTMENT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Saldo de teste",
    },
  });
}

async function criarFornecedor() {
  const m = marca();
  const supplier = await getPrisma().supplier.create({
    data: { code: `FOR-ECI-${m}`, legalName: `Fornecedor ECI ${m}`, active: true },
  });
  fornecedores.push(supplier.id);
  return supplier;
}

/** Uma compra REAL recebida num instante, com custo efetivo informado. */
async function receber(app: App, params: { itemId: string; quantity: string; unitCost: string; receivedAt: Date }) {
  const supplier = await criarFornecedor();
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: params.receivedAt.toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  expect(po.id, JSON.stringify(po)).toBeTruthy();
  pedidosDeCompra.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: params.receivedAt.toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marca()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  expect(receipt.id, JSON.stringify(receipt)).toBeTruthy();
  recebimentos.push(receipt.id);
  return receipt;
}

async function consumir(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/internal-consumptions", payload });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json() as { id: string; code: string; createdAt: string };
}

function estornar(app: App, consumoId: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/internal-consumptions/${consumoId}/reversals`, payload });
}

async function detalhe(app: App, consumoId: string): Promise<InternalConsumptionDetailDTO> {
  const resposta = await app.inject({ method: "GET", url: `/internal-consumptions/${consumoId}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as InternalConsumptionDetailDTO;
}

async function estornosDoConsumo(consumoId: string) {
  return getPrisma().internalConsumptionReversal.findMany({
    where: { originalConsumptionId: consumoId },
    orderBy: { createdAt: "asc" },
  });
}

/** Inventário gravado direto — o estado exato que a guarda precisa ler. */
async function inventario(params: {
  item: Item;
  lot?: Lot | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  contadoEm?: Date;
  retirada?: boolean;
}) {
  const prisma = getPrisma();
  const lote = params.lot ?? null;
  const chave = lote ? `${params.item.id}:${lote.id}` : params.item.id;
  const agora = new Date();
  const sessao = await prisma.stockCount.create({
    data: {
      code: `INV-ECI-${marca()}`,
      kind: "SESSION",
      mode: "ASSISTED",
      status: params.status,
      referenceAt: agora,
      createdByName: "Teste",
      ...(params.status === "COMPLETED" ? { completedAt: agora, completedByName: "Teste" } : {}),
      ...(params.status === "CANCELLED" ? { cancelledAt: agora, cancelledByName: "Teste", cancelReason: "teste" } : {}),
    },
  });
  sessoes.push(sessao.id);
  const posicao = await prisma.stockCountPosition.create({
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
      referenceQuantity: "0",
      referenceAt: agora,
      ...(params.retirada ? { removedAt: agora, removedByName: "Teste", removeReason: "retirada no teste" } : {}),
    },
  });
  if (params.contadoEm) {
    const registro = await prisma.stockCountEntry.create({
      data: {
        positionId: posicao.id,
        round: 1,
        countedQuantity: "0",
        expectedQuantity: "0",
        countedAt: params.contadoEm,
        countedByName: "Teste",
        source: "GRID",
      },
    });
    await prisma.stockCountPosition.update({ where: { id: posicao.id }, data: { validEntryId: registro.id } });
  }
  return sessao;
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

describe("estorno — a operação no ledger", () => {
  it("estorno total: uma entrada própria no mesmo escopo, o saldo volta, o CI e a baixa ficam intactos", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "50");
    const consumo = await consumir(app, { itemId: item.id, quantity: "12", purpose: "Limpeza" });
    expect((await getOnHand(prisma, { itemId: item.id })).toString()).toBe("38");
    const ciAntes = await prisma.internalConsumption.findUniqueOrThrow({ where: { id: consumo.id } });
    const baixaAntes = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: ciAntes.inventoryMovementId! } });

    const resposta = await estornar(app, consumo.id, {
      quantity: "12",
      reason: "  Quantidade digitada errada  ",
      expectedReversedQuantity: "0",
    });

    expect(resposta.statusCode, resposta.body).toBe(201);
    const estorno = resposta.json() as InternalConsumptionReversalDTO;
    expect(estorno.code).toMatch(/^ECI-\d{6}$/);
    expect(estorno.originalConsumptionId).toBe(consumo.id);
    expect(estorno.originalConsumptionCode).toBe(consumo.code);
    expect(estorno.quantity).toBe("12");
    expect(estorno.uomCode).toBe("un");
    expect(estorno.reason).toBe("Quantidade digitada errada");
    expect(estorno.registeredByName).toBe("Usuário de Teste ADMIN");

    const entradas = await prisma.inventoryMovement.findMany({
      where: { itemId: item.id, type: "INTERNAL_CONSUMPTION_REVERSAL" },
    });
    expect(entradas).toHaveLength(1);
    const entrada = entradas[0]!;
    expect(entrada.sourceType).toBe("INTERNAL_CONSUMPTION_REVERSAL");
    expect(entrada.sourceId).toBe(estorno.id);
    expect(entrada.lotId).toBeNull();
    // Magnitude positiva: quem diz que é entrada é o tipo.
    expect(entrada.quantity.toString()).toBe("12");
    expect(entrada.reason).toBe("Quantidade digitada errada");
    expect(entrada.createdBy).toBe("Usuário de Teste ADMIN");
    expect(estorno.inventoryMovementId).toBe(entrada.id);
    // Datado no instante do estorno — nunca retroativo à data do consumo.
    expect(entrada.occurredAt.getTime()).toBeGreaterThanOrEqual(ciAntes.createdAt.getTime());
    expect(entrada.occurredAt.toISOString()).toBe(estorno.createdAt);

    expect((await getOnHand(prisma, { itemId: item.id })).toString()).toBe("50");
    // O ledger continua só de acréscimo: o CI e a baixa não mudaram um campo.
    expect(await prisma.internalConsumption.findUniqueOrThrow({ where: { id: consumo.id } })).toEqual(ciAntes);
    expect(await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: baixaAntes.id } })).toEqual(baixaAntes);

    const lido = await detalhe(app, consumo.id);
    expect(lido).toMatchObject({
      quantity: "12",
      reversedQuantity: "12",
      reversibleQuantity: "0",
      reversalStatus: "REVERSED",
      reversalCount: 1,
    });
    expect(lido.reversals.map((registro) => registro.code)).toEqual([estorno.code]);

    await app.close();
  });

  it("parcial e vários estornos até o saldo; o excedente e o saldo zero recusam sem gravar", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "30");
    const consumo = await consumir(app, { itemId: item.id, quantity: "10" });

    expect((await estornar(app, consumo.id, { quantity: "3", reason: "Devolvido ao armário", expectedReversedQuantity: "0" })).statusCode).toBe(201);
    expect((await estornar(app, consumo.id, { quantity: "4", reason: "Devolvido ao armário", expectedReversedQuantity: "3" })).statusCode).toBe(201);
    expect(await detalhe(app, consumo.id)).toMatchObject({
      reversedQuantity: "7",
      reversibleQuantity: "3",
      reversalStatus: "PARTIALLY_REVERSED",
      reversalCount: 2,
    });

    const excedente = await estornar(app, consumo.id, {
      quantity: "3.001",
      reason: "Devolvido ao armário",
      expectedReversedQuantity: "7",
    });
    expect(excedente.statusCode).toBe(400);
    expect(excedente.json()).toMatchObject({ error: "reversal_exceeds_balance" });
    expect(excedente.json().message).toBe(
      `Quantidade a estornar (3,001) maior que o saldo estornável de ${consumo.code} (3).`,
    );
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(2);
    expect((await getOnHand(prisma, { itemId: item.id })).toString()).toBe("27");

    expect((await estornar(app, consumo.id, { quantity: "3", reason: "Devolvido ao armário", expectedReversedQuantity: "7" })).statusCode).toBe(201);
    expect(await detalhe(app, consumo.id)).toMatchObject({ reversibleQuantity: "0", reversalStatus: "REVERSED" });

    const zerado = await estornar(app, consumo.id, { quantity: "1", reason: "De novo", expectedReversedQuantity: "10" });
    expect(zerado.statusCode).toBe(400);
    expect(zerado.json()).toEqual({ error: "nothing_to_reverse", message: "Não há quantidade a estornar." });
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(3);
    expect((await getOnHand(prisma, { itemId: item.id })).toString()).toBe("30");

    await app.close();
  });

  it("o detalhe traz os estornos do mais recente para o mais antigo", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "6" });
    const primeiro = (await estornar(app, consumo.id, { quantity: "1", reason: "Primeiro", expectedReversedQuantity: "0" })).json();
    const segundo = (await estornar(app, consumo.id, { quantity: "2", reason: "Segundo", expectedReversedQuantity: "1" })).json();

    const lido = await detalhe(app, consumo.id);
    expect(lido.reversals.map((registro) => registro.code)).toEqual([segundo.code, primeiro.code]);
    expect(lido.reversals[1]).toMatchObject({ reason: "Primeiro", quantity: "1", uomCode: "un" });

    await app.close();
  });

  it("consumo inexistente é 404; quantidade zero, negativa ou ilegível é 400 de validação", async () => {
    const app = admin();
    await app.ready();
    const naoExiste = await estornar(app, "00000000-0000-0000-0000-000000000000", {
      quantity: "1",
      reason: "Qualquer",
      expectedReversedQuantity: "0",
    });
    expect(naoExiste.statusCode).toBe(404);
    expect(naoExiste.json().error).toBe("not_found");

    const item = await criarItem();
    await entradaSemCusto(item.id, "5");
    const consumo = await consumir(app, { itemId: item.id, quantity: "2" });
    for (const quantity of ["0", "-1", "abc", ""]) {
      const resposta = await estornar(app, consumo.id, { quantity, reason: "Qualquer", expectedReversedQuantity: "0" });
      expect(resposta.statusCode, quantity).toBe(400);
      expect(resposta.json().error, quantity).toBe("validation_error");
    }
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(0);

    await app.close();
  });
});

describe("estorno — o que a tela mostrou e a concorrência", () => {
  it("expectedReversedQuantity diferente do já estornado recusa com 409, sem gravar", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "20");
    const consumo = await consumir(app, { itemId: item.id, quantity: "10" });
    expect((await estornar(app, consumo.id, { quantity: "3", reason: "Primeiro", expectedReversedQuantity: "0" })).statusCode).toBe(201);

    // Aba velha: a tela ainda mostrava "já estornado 0".
    const velha = await estornar(app, consumo.id, { quantity: "2", reason: "Aba velha", expectedReversedQuantity: "0" });
    expect(velha.statusCode).toBe(409);
    expect(velha.json()).toMatchObject({
      error: "reversal_state_changed",
      shownReversedQuantity: "0",
      currentReversedQuantity: "3",
    });
    expect(velha.json().message).toBe(
      `O consumo ${consumo.code} mudou desde que você abriu: o já estornado era 0 e agora é 3. Confira antes de estornar.`,
    );
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(1);

    expect((await estornar(app, consumo.id, { quantity: "2", reason: "Aba nova", expectedReversedQuantity: "3" })).statusCode).toBe(201);

    await app.close();
  });

  it("dois estornos do saldo inteiro ao mesmo tempo: um passa, o outro recusa, e a soma nunca passa do CI", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "10" });

    const corpo = { quantity: "10", reason: "Duplo clique", expectedReversedQuantity: "0" };
    const respostas = await Promise.all([estornar(app, consumo.id, corpo), estornar(app, consumo.id, corpo)]);

    expect(respostas.map((resposta) => resposta.statusCode).sort()).toEqual([201, 409]);
    expect(respostas.find((resposta) => resposta.statusCode === 409)!.json().error).toBe("reversal_state_changed");
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(1);
    expect((await getOnHand(prisma, { itemId: item.id })).toString()).toBe("10");

    await app.close();
  });

  it("o estorno espera a trava do CI e relê a soma depois dela — nunca estorna o que acabou de ser estornado", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "10" });
    const { user } = await createAuthenticatedUser("QUALITY");

    /*
     * O "primeiro estorno" é a transação do teste, aberta e sem commit: trava
     * a linha do CI e grava um estorno do saldo inteiro. A entrada dele é de
     * OUTRO item, para a FK do movimento não travar a linha do item do CI —
     * a única trava no caminho do POST é a do CI.
     */
    const outro = await criarItem();
    const entradaAlheia = await prisma.inventoryMovement.create({
      data: {
        itemId: outro.id,
        type: "INTERNAL_CONSUMPTION_REVERSAL",
        quantity: "10",
        occurredAt: new Date(),
        sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
      },
    });
    let abriu!: () => void;
    const aberta = new Promise<void>((resolve) => (abriu = resolve));
    let soltar!: () => void;
    const segurando = new Promise<void>((resolve) => (soltar = resolve));
    const transacao = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM internal_consumptions WHERE id = ${consumo.id} FOR UPDATE`;
        await tx.internalConsumptionReversal.create({
          data: {
            code: `ECI-T-${marca()}`,
            originalConsumptionId: consumo.id,
            quantity: "10",
            reason: "Estorno concorrente do teste",
            costSource: "NO_COST",
            inventoryMovementId: entradaAlheia.id,
            registeredByUserId: user.id,
            registeredByNameSnapshot: user.name,
          },
        });
        abriu();
        await segurando;
      },
      { timeout: 30_000 },
    );
    await aberta;

    const post = estornar(app, consumo.id, { quantity: "10", reason: "Segunda aba", expectedReversedQuantity: "0" });
    // Parado NA TRAVA DO CI — sem ela o POST leria soma zero e gravaria.
    await esperarTrava("%FROM internal_consumptions%FOR UPDATE%");
    soltar();
    await transacao;

    const resposta = await post;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("reversal_state_changed");
    const soma = await prisma.internalConsumptionReversal.aggregate({
      where: { originalConsumptionId: consumo.id },
      _sum: { quantity: true },
    });
    expect(soma._sum.quantity!.toString()).toBe("10");
    expect(await prisma.inventoryMovement.count({ where: { itemId: item.id, type: "INTERNAL_CONSUMPTION_REVERSAL" } })).toBe(0);

    await app.close();
  });
});

describe("estorno — o custo é o snapshot do CI", () => {
  it("copia unitário, origem e detalhes; o total é pró-rata e o último leva o resto — o integral fecha o total", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    // 1 a 1,00 e 2 a 2,00: média ponderada 5/3 = 1,6666…
    await receber(app, { itemId: item.id, quantity: "1", unitCost: "1", receivedAt: new Date(Date.now() - 5 * DIA_MS) });
    await receber(app, { itemId: item.id, quantity: "2", unitCost: "2", receivedAt: new Date(Date.now() - 4 * DIA_MS) });
    const consumo = await consumir(app, { itemId: item.id, quantity: "3" });
    const ci = await detalhe(app, consumo.id);
    expect(ci).toMatchObject({ costSource: "ESTIMATED_30D", unitCost: "1.66666667", totalCost: "5" });

    const totais: string[] = [];
    for (const [quantity, esperado] of [["1", "0"], ["1", "1"], ["1", "2"]] as const) {
      const estorno = (
        await estornar(app, consumo.id, { quantity, reason: "Devolução", expectedReversedQuantity: esperado })
      ).json() as InternalConsumptionReversalDTO;
      expect(estorno).toMatchObject({ unitCost: ci.unitCost, costSource: ci.costSource, costDetails: ci.costDetails });
      totais.push(estorno.totalCost!);
    }
    // round4(5 × 1/3) = 1,6667 duas vezes; o último leva 5 − 3,3334.
    expect(totais).toEqual(["1.6667", "1.6667", "1.6666"]);
    expect(await detalhe(app, consumo.id)).toMatchObject({ reversedTotalCost: "5", netTotalCost: "0" });

    await app.close();
  });

  it("quantidade grande: o total vem do total do CI, nunca do unitário de 8 casas × quantidade", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await receber(app, { itemId: item.id, quantity: "10000", unitCost: "1", receivedAt: new Date(Date.now() - 5 * DIA_MS) });
    await receber(app, { itemId: item.id, quantity: "20000", unitCost: "2", receivedAt: new Date(Date.now() - 4 * DIA_MS) });
    const consumo = await consumir(app, { itemId: item.id, quantity: "30000" });
    const ci = await detalhe(app, consumo.id);
    // 1,66666667 × 30000 = 50000,0001 — o CI guardou 50000,0000.
    expect(ci).toMatchObject({ unitCost: "1.66666667", totalCost: "50000" });

    const parcial = (
      await estornar(app, consumo.id, { quantity: "10000", reason: "Parte", expectedReversedQuantity: "0" })
    ).json() as InternalConsumptionReversalDTO;
    const resto = (
      await estornar(app, consumo.id, { quantity: "20000", reason: "Resto", expectedReversedQuantity: "10000" })
    ).json() as InternalConsumptionReversalDTO;
    expect(parcial.totalCost).toBe("16666.6667");
    expect(resto.totalCost).toBe("33333.3333");
    expect(new Decimal(parcial.totalCost!).plus(resto.totalCost!).toString()).toBe("50000");

    await app.close();
  });

  it("o custo do recebimento corrigido depois do consumo não muda o estorno", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const recebimento = await receber(app, {
      itemId: item.id,
      quantity: "20",
      unitCost: "3.50",
      receivedAt: new Date(Date.now() - 3 * DIA_MS),
    });
    const lote = (await getPrisma().lot.findFirst({ where: { itemId: item.id } }))!;
    const consumo = await consumir(app, { itemId: item.id, lotId: lote.id, quantity: "4" });

    const correcao = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${recebimento.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "9" },
    });
    expect(correcao.statusCode, correcao.body).toBe(200);

    const estorno = (
      await estornar(app, consumo.id, { quantity: "2", reason: "Sobrou", expectedReversedQuantity: "0" })
    ).json() as InternalConsumptionReversalDTO;
    expect(estorno).toMatchObject({ unitCost: "3.5", totalCost: "7", costSource: "REAL" });
    expect(await detalhe(app, consumo.id)).toMatchObject({ unitCost: "3.5", totalCost: "14", netTotalCost: "7" });

    await app.close();
  });

  it("CI sem custo: estorno sem custo — null na resposta e na coluna, nunca zero", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "4" });

    const estorno = (
      await estornar(app, consumo.id, { quantity: "4", reason: "Lançado no item errado", expectedReversedQuantity: "0" })
    ).json() as InternalConsumptionReversalDTO;
    expect(estorno).toMatchObject({ unitCost: null, totalCost: null, costSource: "NO_COST" });
    const gravado = await getPrisma().internalConsumptionReversal.findUniqueOrThrow({ where: { id: estorno.id } });
    expect(gravado.unitCost).toBeNull();
    expect(gravado.totalCost).toBeNull();
    expect(await detalhe(app, consumo.id)).toMatchObject({ reversedTotalCost: null, netTotalCost: null });

    await app.close();
  });

  it("parcial nunca passa do que resta do total: total ínfimo em muitos parciais não deixa o último negativo", () => {
    const total = new Decimal("0.0003");
    const quantidade = new Decimal("5");
    let estornado = new Decimal(0);
    const totais: string[] = [];
    for (let vez = 1; vez <= 5; vez += 1) {
      const custo = custoTotalDoEstorno({
        totalDoConsumo: total,
        quantidadeDoConsumo: quantidade,
        quantidade: new Decimal(1),
        custoJaEstornado: estornado,
        zeraOSaldo: vez === 5,
      })!;
      totais.push(custo.toString());
      estornado = estornado.plus(custo);
    }
    // round4(0,0003 / 5) = 0,0001 nos três primeiros; o quarto já não tem de onde tirar.
    expect(totais).toEqual(["0.0001", "0.0001", "0.0001", "0", "0"]);
    expect(estornado.toString()).toBe("0.0003");
    expect(
      custoTotalDoEstorno({
        totalDoConsumo: null,
        quantidadeDoConsumo: quantidade,
        quantidade: new Decimal(1),
        custoJaEstornado: new Decimal(0),
        zeraOSaldo: true,
      }),
    ).toBeNull();
  });
});

describe("estorno — lote e item", () => {
  it("volta ao MESMO lote do consumo; o corpo não escolhe outro", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem({ controlsLot: true });
    const loteA = await criarLote(item.id);
    const loteB = await criarLote(item.id);
    await entradaSemCusto(item.id, "10", loteA.id);
    await entradaSemCusto(item.id, "10", loteB.id);
    const consumo = await consumir(app, { itemId: item.id, lotId: loteA.id, quantity: "6" });

    const resposta = await estornar(app, consumo.id, {
      quantity: "6",
      reason: "Voltou para a prateleira",
      expectedReversedQuantity: "0",
      lotId: loteB.id,
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const entrada = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: (resposta.json() as InternalConsumptionReversalDTO).inventoryMovementId },
    });
    expect(entrada.lotId).toBe(loteA.id);
    expect((await getOnHand(prisma, { itemId: item.id, lotId: loteA.id })).toString()).toBe("10");
    expect((await getOnHand(prisma, { itemId: item.id, lotId: loteB.id })).toString()).toBe("10");

    await app.close();
  });

  it("lote bloqueado: aceita, volta ao lote, a situação não muda e o disponível não sobe", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id);
    await entradaSemCusto(item.id, "8", lote.id);
    const consumo = await consumir(app, { itemId: item.id, lotId: lote.id, quantity: "5" });
    await prisma.lot.update({ where: { id: lote.id }, data: { status: "BLOCKED" } });

    const resposta = await estornar(app, consumo.id, { quantity: "5", reason: "Erro de digitação", expectedReversedQuantity: "0" });
    expect(resposta.statusCode, resposta.body).toBe(201);

    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lote.id } })).status).toBe("BLOCKED");
    expect((await getOnHand(prisma, { itemId: item.id, lotId: lote.id })).toString()).toBe("8");
    const saldo = (
      await app.inject({ method: "GET", url: `/internal-consumptions/availability/${item.id}` })
    ).json();
    expect(saldo.available).toBe("0");
    expect(await detalhe(app, consumo.id)).toMatchObject({ lotStatus: "BLOCKED", lotExpired: false });

    await app.close();
  });

  it("lote vencido: aceita, volta ao lote vencido e o detalhe avisa", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem({ controlsLot: true });
    const lote = await criarLote(item.id, { expiryDate: new Date(Date.now() + 90 * DIA_MS) });
    await entradaSemCusto(item.id, "8", lote.id);
    const consumo = await consumir(app, { itemId: item.id, lotId: lote.id, quantity: "3" });
    await prisma.lot.update({ where: { id: lote.id }, data: { expiryDate: new Date(Date.now() - 10 * DIA_MS) } });

    const resposta = await estornar(app, consumo.id, { quantity: "3", reason: "Erro de digitação", expectedReversedQuantity: "0" });
    expect(resposta.statusCode, resposta.body).toBe(201);
    expect((await getOnHand(prisma, { itemId: item.id, lotId: lote.id })).toString()).toBe("8");
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lote.id } })).status).toBe("AVAILABLE");
    expect(await detalhe(app, consumo.id)).toMatchObject({ lotStatus: "AVAILABLE", lotExpired: true });

    await app.close();
  });

  it("item inativo pode ser estornado: é a anulação de uma saída, não uma entrada nova", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "9");
    const consumo = await consumir(app, { itemId: item.id, quantity: "9" });
    await prisma.item.update({ where: { id: item.id }, data: { active: false } });

    const resposta = await estornar(app, consumo.id, { quantity: "9", reason: "Consumo lançado no item errado", expectedReversedQuantity: "0" });
    expect(resposta.statusCode, resposta.body).toBe(201);
    expect((await getOnHand(prisma, { itemId: item.id })).toString()).toBe("9");
    expect(await detalhe(app, consumo.id)).toMatchObject({ itemActive: false, lotStatus: null, lotExpired: false });

    await app.close();
  });

  it("ajuste manual de entrada depois do consumo: o detalhe mostra, o estorno não é bloqueado", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "4" });
    const ajuste = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_IN", quantity: "2", reason: "Achado no armário" },
    });
    expect(ajuste.statusCode, ajuste.body).toBe(201);

    const lido = await detalhe(app, consumo.id);
    expect(lido.laterManualAdjustmentCount).toBe(1);
    expect(lido.laterManualAdjustments).toEqual([
      expect.objectContaining({ quantity: "2", reason: "Achado no armário", createdBy: "Usuário de Teste ADMIN" }),
    ]);
    expect((await estornar(app, consumo.id, { quantity: "4", reason: "Erro", expectedReversedQuantity: "0" })).statusCode).toBe(201);

    await app.close();
  });
});

describe("estorno — guardas de inventário", () => {
  it("posição em Inventário Físico aberto recusa, citando o código do inventário", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "5" });
    const aberto = await inventario({ item, status: "IN_PROGRESS" });

    const resposta = await estornar(app, consumo.id, { quantity: "5", reason: "Erro", expectedReversedQuantity: "0" });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({ error: "position_in_open_count", stockCountCode: aberto.code });
    expect(resposta.json().message).toContain(aberto.code);
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(0);

    await app.close();
  });

  it("inventário encerrado com contagem DEPOIS do registro do CI recusa, citando o código", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "5" });
    // 1 ms depois do registro do CI, lido do próprio CI: o `new Date()` do Node
    // no Windows anda 1–3 ms atrás do relógio do `createdAt`, e "agora" podia
    // cair antes do registro (caía 2 em 6 na base cf8d353e).
    const depoisDoRegistro = new Date(new Date(consumo.createdAt).getTime() + 1);
    const encerrado = await inventario({ item, status: "COMPLETED", contadoEm: depoisDoRegistro });

    const resposta = await estornar(app, consumo.id, { quantity: "5", reason: "Erro", expectedReversedQuantity: "0" });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({ error: "position_counted_after_consumption", stockCountCode: encerrado.code });
    expect(resposta.json().message).toBe(
      `A posição de ${consumo.code} foi contada no inventário ${encerrado.code} depois do registro do consumo: a contagem já acertou o saldo, e estornar agora corrigiria duas vezes.`,
    );
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(0);

    await app.close();
  });

  it("Contagem rápida depois do CI também recusa: ela é um inventário encerrado", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "5" });
    const rapida = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "5" },
    });
    expect(rapida.statusCode, rapida.body).toBe(201);

    const resposta = await estornar(app, consumo.id, { quantity: "5", reason: "Erro", expectedReversedQuantity: "0" });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({
      error: "position_counted_after_consumption",
      stockCountCode: rapida.json().stockCountCode,
    });

    await app.close();
  });

  it("inventário ANTERIOR ao CI não bloqueia", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const rapida = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "10" },
    });
    expect(rapida.statusCode, rapida.body).toBe(201);
    const consumo = await consumir(app, { itemId: item.id, quantity: "5" });

    const resposta = await estornar(app, consumo.id, { quantity: "5", reason: "Erro", expectedReversedQuantity: "0" });
    expect(resposta.statusCode, resposta.body).toBe(201);

    await app.close();
  });

  it("inventário cancelado e posição retirada não bloqueiam, mesmo contados depois do CI", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "6" });
    await inventario({ item, status: "CANCELLED", contadoEm: new Date() });
    await inventario({ item, status: "COMPLETED", contadoEm: new Date(), retirada: true });

    const resposta = await estornar(app, consumo.id, { quantity: "6", reason: "Erro", expectedReversedQuantity: "0" });
    expect(resposta.statusCode, resposta.body).toBe(201);

    await app.close();
  });

  it("a guarda é da posição: inventário de OUTRO lote do mesmo item não bloqueia", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem({ controlsLot: true });
    const loteA = await criarLote(item.id);
    const loteB = await criarLote(item.id);
    await entradaSemCusto(item.id, "10", loteA.id);
    const consumo = await consumir(app, { itemId: item.id, lotId: loteA.id, quantity: "4" });
    await inventario({ item, lot: loteB, status: "IN_PROGRESS" });
    await inventario({ item, lot: loteB, status: "COMPLETED", contadoEm: new Date() });

    const resposta = await estornar(app, consumo.id, { quantity: "4", reason: "Erro", expectedReversedQuantity: "0" });
    expect(resposta.statusCode, resposta.body).toBe(201);

    await app.close();
  });
});

describe("estorno — permissões e autoria", () => {
  it.each(USER_ROLES.map((role) => [role, INTERNAL_CONSUMPTION_REVERSAL_ROLES.includes(role)] as const))(
    "%s estorna? %s",
    async (role: UserRole, estorna: boolean) => {
      const dono = admin();
      await dono.ready();
      const item = await criarItem();
      await entradaSemCusto(item.id, "5");
      const consumo = await consumir(dono, { itemId: item.id, quantity: "2" });
      const app = buildTestApp(role);
      await app.ready();

      const resposta = await estornar(app, consumo.id, { quantity: "2", reason: "Erro de lançamento", expectedReversedQuantity: "0" });

      if (estorna) {
        expect(resposta.statusCode, resposta.body).toBe(201);
        expect(resposta.json().registeredByName).toBe(`Usuário de Teste ${role}`);
      } else {
        expect(resposta.statusCode, resposta.body).toBe(403);
        expect(resposta.json().error).toBe("forbidden");
        // 403 antes do corpo e da existência: corpo inválido e CI inexistente dão o mesmo 403.
        expect((await estornar(app, consumo.id, {})).statusCode).toBe(403);
        expect((await estornar(app, "nao-existe", {})).statusCode).toBe(403);
        expect(await estornosDoConsumo(consumo.id)).toHaveLength(0);
      }
      // Leitura de todo autenticado: o detalhe com os estornos.
      const leitura = await app.inject({ method: "GET", url: `/internal-consumptions/${consumo.id}` });
      expect(leitura.statusCode).toBe(200);
      expect(leitura.json().reversals).toHaveLength(estorna ? 1 : 0);

      await app.close();
      await dono.close();
    },
  );

  it("motivo obrigatório: ausente, curto depois do trim ou acima de 500 recusa; 500 passa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "10");
    const consumo = await consumir(app, { itemId: item.id, quantity: "10" });

    for (const corpo of [
      { quantity: "1", expectedReversedQuantity: "0" },
      { quantity: "1", reason: "   ", expectedReversedQuantity: "0" },
      { quantity: "1", reason: "  ab  ", expectedReversedQuantity: "0" },
      { quantity: "1", reason: "x".repeat(501), expectedReversedQuantity: "0" },
    ]) {
      const resposta = await estornar(app, consumo.id, corpo);
      expect(resposta.statusCode, JSON.stringify(corpo)).toBe(400);
      expect(resposta.json().error).toBe("validation_error");
      expect(resposta.json().issues.map((issue: { path: string }) => issue.path)).toContain("reason");
    }
    expect(await estornosDoConsumo(consumo.id)).toHaveLength(0);
    expect((await estornar(app, consumo.id, { quantity: "1", reason: "x".repeat(500), expectedReversedQuantity: "0" })).statusCode).toBe(201);

    await app.close();
  });

  it("autor é o usuário da sessão: campo de usuário no corpo é ignorado", async () => {
    const dono = admin();
    await dono.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "5");
    const consumo = await consumir(dono, { itemId: item.id, quantity: "3" });
    const outro = (await createAuthenticatedUser("ADMIN")).user;
    const qualidade = (await createAuthenticatedUser("QUALITY")).user;
    const app = buildTestApp("QUALITY");
    await app.ready();

    const resposta = await estornar(app, consumo.id, {
      quantity: "3",
      reason: "Erro de lançamento",
      expectedReversedQuantity: "0",
      registeredByUserId: outro.id,
      registeredByName: "Outra pessoa",
      createdBy: "Outra pessoa",
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const gravado = await prisma.internalConsumptionReversal.findUniqueOrThrow({
      where: { id: (resposta.json() as InternalConsumptionReversalDTO).id },
      include: { inventoryMovement: true },
    });
    expect(gravado.registeredByUserId).toBe(qualidade.id);
    expect(gravado.registeredByNameSnapshot).toBe("Usuário de Teste QUALITY");
    expect(gravado.inventoryMovement.createdBy).toBe("Usuário de Teste QUALITY");

    await app.close();
    await dono.close();
  });
});

describe("estorno — o banco", () => {
  it("FK RESTRICT: consumo com estorno não se apaga", async () => {
    const app = admin();
    await app.ready();
    const prisma = getPrisma();
    const item = await criarItem();
    await entradaSemCusto(item.id, "5");
    const consumo = await consumir(app, { itemId: item.id, quantity: "2" });
    expect((await estornar(app, consumo.id, { quantity: "1", reason: "Erro", expectedReversedQuantity: "0" })).statusCode).toBe(201);

    const [chave] = await prisma.$queryRaw<{ confdeltype: string }[]>`
      SELECT confdeltype FROM pg_constraint WHERE conname = 'internal_consumption_reversals_originalConsumptionId_fkey'`;
    expect(chave?.confdeltype).toBe("r");
    await expect(prisma.internalConsumption.delete({ where: { id: consumo.id } })).rejects.toThrow();
    expect(await prisma.internalConsumption.count({ where: { id: consumo.id } })).toBe(1);

    await app.close();
  });

  it("a sequence existe e numera: dois estornos seguidos, códigos ECI- em sequência", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "5");
    const consumo = await consumir(app, { itemId: item.id, quantity: "4" });
    const primeiro = (await estornar(app, consumo.id, { quantity: "1", reason: "Primeiro", expectedReversedQuantity: "0" })).json();
    const segundo = (await estornar(app, consumo.id, { quantity: "1", reason: "Segundo", expectedReversedQuantity: "1" })).json();

    const numero = (codigo: string) => Number(codigo.replace("ECI-", ""));
    expect(primeiro.code).toMatch(/^ECI-\d{6}$/);
    expect(numero(segundo.code)).toBeGreaterThan(numero(primeiro.code));

    await app.close();
  });
});

describe("estorno — extrato, R-03 e R-21", () => {
  it("extrato: Estorno de consumo interno, com o ECI- e o CI- que ele anula", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "9");
    const consumo = await consumir(app, { itemId: item.id, quantity: "5" });
    const estorno = (
      await estornar(app, consumo.id, { quantity: "2", reason: "Devolvido", expectedReversedQuantity: "0" })
    ).json() as InternalConsumptionReversalDTO;

    const extrato = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${item.id}&type=INTERNAL_CONSUMPTION_REVERSAL` })
    ).json() as InventoryMovementListResponse;
    expect(extrato.total).toBe(1);
    expect(extrato.movements[0]).toMatchObject({
      type: "INTERNAL_CONSUMPTION_REVERSAL",
      sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
      quantity: "2",
      internalConsumptionReversalId: estorno.id,
      internalConsumptionReversalCode: estorno.code,
      internalConsumptionId: consumo.id,
      internalConsumptionCode: consumo.code,
      reason: "Devolvido",
    });

    const baixa = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${item.id}&type=INTERNAL_CONSUMPTION` })
    ).json() as InventoryMovementListResponse;
    expect(baixa.movements[0]).toMatchObject({
      internalConsumptionCode: consumo.code,
      internalConsumptionReversalId: null,
      internalConsumptionReversalCode: null,
    });

    await app.close();
  });

  it("R-03: consumo e estorno com tipo, sentido, origem e documento próprios — no JSON e no CSV", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await entradaSemCusto(item.id, "9");
    const consumo = await consumir(app, { itemId: item.id, quantity: "5" });
    const estorno = (
      await estornar(app, consumo.id, { quantity: "2", reason: "Devolvido", expectedReversedQuantity: "0" })
    ).json() as InternalConsumptionReversalDTO;

    const r03 = (
      await app.inject({ method: "GET", url: `/reports/inventory/movements?itemId=${item.id}` })
    ).json() as { rows: MovementReportRowDTO[] };
    const porTipo = new Map(r03.rows.map((linha) => [linha.type, linha]));
    expect(porTipo.get("INTERNAL_CONSUMPTION")).toMatchObject({
      sourceType: "INTERNAL_CONSUMPTION",
      documentKind: "INTERNAL_CONSUMPTION",
      documentCode: consumo.code,
      documentId: consumo.id,
    });
    expect(porTipo.get("INTERNAL_CONSUMPTION_REVERSAL")).toMatchObject({
      sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
      documentKind: "INTERNAL_CONSUMPTION_REVERSAL",
      documentCode: `${estorno.code} (estorno de ${consumo.code})`,
      documentId: estorno.id,
      reason: "Devolvido",
    });

    const csv = await app.inject({ method: "GET", url: `/reports/inventory/movements/export.csv?itemId=${item.id}` });
    expect(csv.statusCode).toBe(200);
    const [cabecalho = [], ...linhas] = csv.body
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((linha) => linha.length > 0)
      .map((linha) => linha.split(";"));
    expect(cabecalho.slice(0, 3)).toEqual(["Data/Hora", "Tipo", "Entrada/Saída"]);
    const coluna = (nome: string) => cabecalho.indexOf(nome);
    const doEstorno = linhas.find((linha) => linha[coluna("Tipo")] === "Estorno de consumo interno")!;
    const daBaixa = linhas.find((linha) => linha[coluna("Tipo")] === "Consumo interno")!;
    expect(doEstorno[coluna("Entrada/Saída")]).toBe("Entrada");
    expect(doEstorno[coluna("Documento")]).toBe(`${estorno.code} (estorno de ${consumo.code})`);
    expect(daBaixa[coluna("Entrada/Saída")]).toBe("Saída");
    expect(daBaixa[coluna("Documento")]).toBe(consumo.code);

    await app.close();
  });

  it("R-21: a linha do CI traz original, estornado, líquido e situação; o resumo é líquido", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem();
    await receber(app, { itemId: item.id, quantity: "10", unitCost: "2", receivedAt: new Date(Date.now() - 2 * DIA_MS) });
    const consumo = await consumir(app, { itemId: item.id, quantity: "10" });
    expect((await estornar(app, consumo.id, { quantity: "4", reason: "Sobrou", expectedReversedQuantity: "0" })).statusCode).toBe(201);

    const r21 = (
      await app.inject({ method: "GET", url: `/reports/inventory/internal-consumption?itemId=${item.id}` })
    ).json() as InternalConsumptionReportDTO;
    expect(r21.rows).toHaveLength(1);
    expect(r21.rows[0]).toMatchObject({
      quantity: "10",
      reversedQuantity: "4",
      reversibleQuantity: "6",
      totalCost: "20",
      netTotalCost: "12",
      reversalStatus: "PARTIALLY_REVERSED",
    });
    expect(r21.summary).toMatchObject({
      consumptionCount: 1,
      knownCostTotal: "12",
      reversedConsumptionCount: 1,
    });
    expect(r21.byItem).toEqual([expect.objectContaining({ itemId: item.id, quantity: "6", knownCostTotal: "12" })]);

    await app.close();
  });
});
