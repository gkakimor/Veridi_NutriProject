import type { AttentionItemDTO, DashboardDTO } from "@veridi/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { buildAttentionList } from "./attention.service.js";
import {
  getOrdersAwaitingShipmentIds,
  getProductionOrdersWithIncompleteCost,
  getProductionOrdersWithShortage,
} from "./dashboard.queries.js";
import { dashboardQuerySchemaEm } from "./dashboard.schemas.js";
import { getDashboard } from "./dashboard.service.js";

/*
 * Os três conjuntos caros do Painel saem uma vez por requisição
 * (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * O estado atual e a lista de atenção calculavam, cada um, os pedidos aguardando
 * expedição, as OPs com falta de material e as OPs concluídas com custo
 * incompleto — no mesmo retrato e com o mesmo `now`, duas vezes o mesmo
 * resultado. O custo incompleto resolve o custo de cada OP concluída: numa base
 * de 200 OPs com dois consumos, 5.262 SQL por requisição, metade repetida.
 *
 * O cliente da aplicação ganha uma extensão que só anota as operações enquanto
 * o teste pede. Faixa serial: os contadores são agregado do banco inteiro, e o
 * teste compara o Painel com cada conjunto calculado à parte logo em seguida.
 */
const registro = vi.hoisted(() => ({
  ligado: false,
  operacoes: [] as { model: string; operation: string; where: Record<string, unknown> }[],
}));

vi.mock("../../db/prisma.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/prisma.js")>();
  const cliente = real.getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (registro.ligado) {
            const where = ((args as { where?: Record<string, unknown> } | undefined)?.where ?? {}) as Record<string, unknown>;
            registro.operacoes.push({ model, operation, where });
          }
          return query(args);
        },
      },
    },
  });
  return { ...real, getPrisma: () => cliente };
});

async function anotando<T>(fn: () => Promise<T>) {
  registro.operacoes = [];
  registro.ligado = true;
  try {
    const resultado = await fn();
    return { resultado, operacoes: [...registro.operacoes] };
  } finally {
    registro.ligado = false;
  }
}

type Operacao = (typeof registro.operacoes)[number];

/** A consulta-raiz de cada conjunto, reconhecida pela forma do filtro. */
const RAIZES = {
  custoIncompleto: (op: Operacao) => op.model === "ProductionOrder" && op.operation === "findMany" && op.where["status"] === "COMPLETED",
  faltaDeMaterial: (op: Operacao) =>
    op.model === "ProductionOrder" &&
    op.operation === "findMany" &&
    JSON.stringify(op.where["status"]) === JSON.stringify({ in: ["DRAFT", "PLANNED"] }),
  aguardandoExpedicao: (op: Operacao) =>
    op.model === "CustomerOrderReservationLine" && op.operation === "findMany" && "reservation" in op.where && !("itemId" in op.where),
};

/** O que só a resolução do custo das OPs concluídas consulta no Painel. */
const doCusto = (op: Operacao) =>
  (op.model === "ProductionOrder" && op.operation === "findUnique") || op.model === "ReceiptLine";

const criados = { ordens: [] as string[], itens: [] as string[], pedidos: [] as string[], produtos: [] as string[] };

let fixture: { opConcluida: string; opComFalta: string; pedido: string };

function marcador(): string {
  return `CJ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const m = marcador();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  const item = (codigo: string, type: "RAW_MATERIAL" | "FINISHED_PRODUCT") => ({
    type,
    code: `${codigo}-${m}`,
    name: `Item ${codigo} ${m}`,
    unitCode: "kg",
    controlsLot: type === "RAW_MATERIAL",
    controlsExpiry: false,
    requiresQualityRelease: false,
    active: true,
  });
  const [consumida, emFalta, acabado] = await prisma.item.createManyAndReturn({
    data: [item("MP-CUSTO", "RAW_MATERIAL"), item("MP-FALTA", "RAW_MATERIAL"), item("PA", "FINISHED_PRODUCT")],
    select: { id: true, code: true, name: true },
  });
  criados.itens.push(consumida!.id, emFalta!.id, acabado!.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-${m}`, name: `Produto ${m}`, customerId: await fixtureCustomerId(), finishedProductItemId: acabado!.id },
  });
  criados.produtos.push(produto.id);

  const requisito = (ordemId: string, mp: { id: string; code: string; name: string }, quantidade: string) => ({
    productionOrderId: ordemId,
    itemId: mp.id,
    itemCode: mp.code,
    itemName: mp.name,
    itemType: "RAW_MATERIAL" as const,
    formulaQuantity: "1",
    formulaUnitCode: "kg",
    requiredQuantity: quantidade,
    stockUnitCode: "kg",
    position: 0,
  });

  // OP concluída que consumiu um lote sem custo de recebimento: custo incompleto.
  const lote = await prisma.lot.create({
    data: { code: `LT-${m}`, origin: "OPENING_BALANCE", itemId: consumida!.id, initialReceivedQuantity: "10", status: "AVAILABLE" },
  });
  const concluida = await prisma.productionOrder.create({
    data: {
      code: `OP-${m}-C`,
      productId: produto.id,
      productCode: produto.code,
      productName: produto.name,
      plannedQuantity: "10",
      outputUnitCode: "kg",
      status: "COMPLETED",
      // Mais recente que qualquer OP de outro arquivo: entra nas 200 lidas.
      completedAt: new Date(Date.UTC(2099, 0, 1)),
    },
  });
  criados.ordens.push(concluida.id);
  const requisitoConsumido = await prisma.productionOrderRequirement.create({ data: requisito(concluida.id, consumida!, "10") });
  const reserva = await prisma.materialReservation.create({ data: { productionOrderId: concluida.id, status: "RELEASED" } });
  const linhaDaReserva = await prisma.materialReservationLine.create({
    data: {
      reservationId: reserva.id,
      productionOrderRequirementId: requisitoConsumido.id,
      itemId: consumida!.id,
      lotId: lote.id,
      quantity: "10",
    },
  });
  await prisma.productionConsumption.create({
    data: {
      productionOrderId: concluida.id,
      productionOrderRequirementId: requisitoConsumido.id,
      reservationLineId: linhaDaReserva.id,
      itemId: consumida!.id,
      lotId: lote.id,
      quantity: "10",
      consumedAt: new Date(),
    },
  });

  // OP em rascunho pedindo matéria-prima sem estoque nenhum: falta de material.
  const comFalta = await prisma.productionOrder.create({
    data: {
      code: `OP-${m}-F`,
      productId: produto.id,
      productCode: produto.code,
      productName: produto.name,
      plannedQuantity: "50",
      outputUnitCode: "kg",
      status: "DRAFT",
    },
  });
  criados.ordens.push(comFalta.id);
  await prisma.productionOrderRequirement.create({ data: requisito(comFalta.id, emFalta!, "50") });

  // Pedido em atendimento com produto acabado reservado: aguardando expedição.
  const pedido = await prisma.customerOrder.create({
    data: { code: `PED-${m}`, customerId: await fixtureCustomerId(), status: "IN_FULFILLMENT" },
  });
  criados.pedidos.push(pedido.id);
  const linhaDoPedido = await prisma.customerOrderLine.create({
    data: { customerOrderId: pedido.id, productId: produto.id, orderedQuantity: "5", unitCode: "kg", position: 0 },
  });
  const reservaDoPedido = await prisma.customerOrderReservation.create({ data: { customerOrderId: pedido.id } });
  await prisma.customerOrderReservationLine.create({
    data: { reservationId: reservaDoPedido.id, customerOrderLineId: linhaDoPedido.id, productId: produto.id, itemId: acabado!.id, quantity: "5" },
  });

  fixture = { opConcluida: concluida.id, opComFalta: comFalta.id, pedido: pedido.id };
});

afterAll(async () => {
  const prisma = getPrisma();
  const ordens = { productionOrderId: { in: criados.ordens } };
  await prisma.productionConsumption.deleteMany({ where: ordens });
  await prisma.materialReservationLine.deleteMany({ where: { reservation: ordens } });
  await prisma.materialReservation.deleteMany({ where: ordens });
  await prisma.productionOrderRequirement.deleteMany({ where: ordens });
  await prisma.productionOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  const pedidos = { customerOrderId: { in: criados.pedidos } };
  await prisma.customerOrderReservationLine.deleteMany({ where: { reservation: pedidos } });
  await prisma.customerOrderReservation.deleteMany({ where: pedidos });
  await prisma.customerOrderLine.deleteMany({ where: pedidos });
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
});

/** Contagem por tipo, na ordem em que os grupos aparecem. */
function porTipo(itens: AttentionItemDTO[]) {
  const contagem = new Map<string, number>();
  for (const item of itens) contagem.set(item.type, (contagem.get(item.type) ?? 0) + 1);
  return [...contagem.entries()];
}

describe("Painel — os conjuntos comuns ao estado atual e à atenção saem uma vez", () => {
  it("cada consulta-raiz sai uma vez, e o custo das OPs é resolvido uma vez por OP", { timeout: 60_000 }, async () => {
    const agora = new Date();
    const consulta = dashboardQuerySchemaEm(agora).parse({});

    const avulso = await anotando(() => getProductionOrdersWithIncompleteCost(getPrisma()));
    const painel = await anotando(() => getDashboard(consulta, agora));

    for (const [conjunto, raiz] of Object.entries(RAIZES)) {
      expect(painel.operacoes.filter(raiz), conjunto).toHaveLength(1);
    }
    // A resolução do custo inteira — uma leitura da OP e as do custo de cada
    // consumo — é a mesma de uma chamada avulsa. Antes, o dobro.
    const custoDoPainel = painel.operacoes.filter(doCusto).length;
    expect(custoDoPainel).toBeGreaterThan(0);
    expect(custoDoPainel).toBe(avulso.operacoes.filter(doCusto).length);
    expect(painel.operacoes.filter((op) => op.model === "ProductionOrder" && op.operation === "findUnique")).toHaveLength(
      Math.min(200, await getPrisma().productionOrder.count({ where: { status: "COMPLETED", consumptions: { some: {} } } })),
    );
  });

  it("o que o Painel mostra é o que cada conjunto dá calculado à parte, no contador e na atenção", { timeout: 60_000 }, async () => {
    const agora = new Date();
    const painel: DashboardDTO = await getDashboard(dashboardQuerySchemaEm(agora).parse({}), agora);

    const custo = await getProductionOrdersWithIncompleteCost(getPrisma());
    const falta = await getProductionOrdersWithShortage(getPrisma(), agora);
    const expedicao = await getOrdersAwaitingShipmentIds(getPrisma());
    // A atenção sem conjuntos recebidos carrega os três por conta própria.
    const atencao = await buildAttentionList(getPrisma(), agora);

    // As fixtures estão nos conjuntos: a comparação não é vazia.
    expect(custo.map((op) => op.id)).toContain(fixture.opConcluida);
    expect(falta.map((op) => op.id)).toContain(fixture.opComFalta);
    expect(expedicao).toContain(fixture.pedido);

    expect(painel.currentState.production.completedWithIncompleteCost).toBe(custo.length);
    expect(painel.currentState.production.withShortage).toBe(falta.length);
    expect(painel.currentState.commercial.ordersAwaitingShipment).toBe(expedicao.length);

    expect(painel.attentionTotal).toBe(atencao.length);
    expect(painel.attention).toEqual(atencao.slice(0, painel.attentionLimit));
    expect(painel.attentionGroups.map((grupo) => [grupo.type, grupo.count])).toEqual(porTipo(atencao));
    const alvos = (tipo: AttentionItemDTO["type"]) => atencao.filter((item) => item.type === tipo).map((item) => item.targetId);
    expect(alvos("PRODUCTION_ORDER_INCOMPLETE_COST")).toContain(fixture.opConcluida);
    expect(alvos("PRODUCTION_ORDER_SHORTAGE")).toContain(fixture.opComFalta);
    expect(alvos("ORDER_AWAITING_SHIPMENT")).toContain(fixture.pedido);
    // Contador e atenção contam o mesmo conjunto.
    expect(painel.attentionGroups.find((grupo) => grupo.type === "PRODUCTION_ORDER_INCOMPLETE_COST")?.count).toBe(custo.length);
    expect(painel.attentionGroups.find((grupo) => grupo.type === "PRODUCTION_ORDER_SHORTAGE")?.count).toBe(falta.length);
  });
});
