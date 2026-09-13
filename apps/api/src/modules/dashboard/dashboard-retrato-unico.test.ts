import { PrismaClient } from "@prisma/client";
import type { AttentionType, DashboardDTO } from "@veridi/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { findProductionOrderMaterialCost } from "../costs/costs.service.js";
import { dashboardQuerySchemaEm } from "./dashboard.schemas.js";
import { getDashboard } from "./dashboard.service.js";

/*
 * Portão de consulta (DASHBOARD-SNAPSHOT-CONSISTENCY-01).
 *
 * O Painel é montado por dezenas de consultas. Para provar que todas enxergam
 * o MESMO instante do banco, o teste precisa escrever no meio da montagem — e
 * num ponto exato, sem `sleep`: depois que o contador de lotes bloqueados já
 * leu, antes que a lista de atenção leia os lotes e antes que o custo das OPs
 * concluídas seja resolvido.
 *
 * O cliente do Prisma da aplicação ganha uma extensão de consulta que, armada,
 * segura essas leituras numa promise até o teste soltar. Desarmada, só repassa.
 * O mesmo cliente passa por dentro da transação do Painel, então o portão pega
 * a leitura esteja ela no retrato ou fora dele.
 */
const portao = vi.hoisted(() => {
  const estado = {
    armado: false,
    retidas: [] as string[],
    soltar: () => {},
    liberado: Promise.resolve(),
    avisarRetencao: () => {},
    retencao: Promise.resolve(),
    avisarContador: () => {},
    contadorLido: Promise.resolve(),
  };
  return {
    estado,
    armar() {
      estado.retidas = [];
      estado.liberado = new Promise<void>((resolve) => {
        estado.soltar = resolve;
      });
      estado.retencao = new Promise<void>((resolve) => {
        estado.avisarRetencao = resolve;
      });
      estado.contadorLido = new Promise<void>((resolve) => {
        estado.avisarContador = resolve;
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
          const { estado } = portao;
          if (!estado.armado) return query(args);

          const where = ((args as { where?: Record<string, unknown> } | undefined)?.where ?? {}) as Record<
            string,
            unknown
          >;
          // A lista de atenção lê os lotes-problema num único findMany com OR.
          const lotesDaAtencao = model === "Lot" && operation === "findMany" && "OR" in where;
          // As OPs concluídas cujo custo vai ser resolvido — no contador e na atenção.
          const opsDoCusto = model === "ProductionOrder" && operation === "findMany" && where["status"] === "COMPLETED";
          if (lotesDaAtencao || opsDoCusto) {
            estado.retidas.push(`${model}.${operation}`);
            estado.avisarRetencao();
            await estado.liberado;
            return query(args);
          }

          const resultado = await query(args);
          if (model === "Lot" && operation === "findMany" && where["status"] === "BLOCKED") estado.avisarContador();
          return resultado;
        },
      },
    },
  });
  return { ...real, getPrisma: () => cliente };
});

type App = ReturnType<typeof buildTestApp>;

const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];

/** A "segunda conexão": outro cliente, outro pool — nunca a conexão do Painel. */
const escritor = new PrismaClient();

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
});

afterAll(async () => {
  portao.desarmar();
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionConsumption.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.materialReservationLine.deleteMany({
      where: { reservation: { productionOrderId: { in: fixtureProductionOrderIds } } },
    });
    await prisma.materialReservation.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: fixturePurchaseOrderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
  await escritor.$disconnect();
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function injectOk(app: App, method: "POST" | "PATCH", url: string, payload?: object) {
  const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
  expect(response.statusCode, `${method} ${url}: ${response.body.slice(0, 300)}`).toBeLessThan(300);
  return response.json();
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-RETRATO-${m}`,
      name: `Item Retrato ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/**
 * Pano de fundo inteiro pelas rotas: recebimento SEM custo, formulação ativa e
 * uma OP concluída que consumiu o lote recebido — custo de material incompleto.
 * Mais um lote bloqueado com saldo, de outro item.
 */
async function montarFixtures(app: App) {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-RETRATO-${m}`, legalName: `Fornecedor Retrato ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);

  const rawMaterial = await createItem("RAW_MATERIAL");
  const po = await injectOk(app, "POST", "/purchase-orders", {
    supplierId: supplier.id,
    orderDate: new Date().toISOString(),
    lines: [{ itemId: rawMaterial.id, orderedQuantity: "100" }],
  });
  fixturePurchaseOrderIds.push(po.id);
  await injectOk(app, "POST", `/purchase-orders/${po.id}/confirm`);
  const receipt = await injectOk(app, "POST", `/purchase-orders/${po.id}/receipts`, {
    receivedAt: new Date().toISOString(),
    lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: "100", supplierLot: `SUP-${marker()}` }],
  });
  fixtureReceiptIds.push(receipt.id);

  const finishedItem = await createItem("FINISHED_PRODUCT");
  const product = await injectOk(app, "POST", "/products", {
    customerId: await fixtureCustomerId(),
    name: `Produto Retrato ${marker()}`,
    finishedProductItemId: finishedItem.id,
  });
  fixtureProductIds.push(product.id);
  const versionId = (await injectOk(app, "POST", `/products/${product.id}/formulation-versions`, {})).id;
  await injectOk(app, "PATCH", `/formulation-versions/${versionId}`, {
    basisQuantity: "1",
    components: [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
  });
  await injectOk(app, "POST", `/formulation-versions/${versionId}/activate`);

  const orderId = (await injectOk(app, "POST", "/production-orders", { productId: product.id, plannedQuantity: "10" })).id;
  fixtureProductionOrderIds.push(orderId);
  await aplicarRoteiroDeTeste(orderId);
  await injectOk(app, "POST", `/production-orders/${orderId}/plan`);
  const released = await injectOk(app, "POST", `/production-orders/${orderId}/release`);
  for (const requirement of released.requirements) {
    for (const line of requirement.reservationLines) {
      await injectOk(app, "POST", `/production-orders/${orderId}/picking/${line.id}/confirm`, line.lotCode ? { lotCode: line.lotCode } : {});
      await injectOk(app, "POST", `/production-orders/${orderId}/consumptions`, {
        entries: [{ reservationLineId: line.id, quantity: line.quantity }],
      });
    }
  }
  await injectOk(app, "POST", `/production-orders/${orderId}/outputs`, {
    quantity: "10",
    destination: "NEW_LOT",
    businessLotNumber: `VD-RETRATO-${marker()}`,
  });
  await injectOk(app, "POST", `/production-orders/${orderId}/complete`);

  const blockedItem = await createItem("RAW_MATERIAL");
  const blockedLot = await prisma.lot.create({
    data: {
      code: `LT-RETRATO-${marker()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId: blockedItem.id,
      initialReceivedQuantity: "10",
      status: "BLOCKED",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId: blockedItem.id,
      lotId: blockedLot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity: "10",
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });

  return { orderId, consumedLotId: receipt.lines[0].lotId as string, blockedLotId: blockedLot.id };
}

/** Os dois pares que a escrita do teste mexe: contador do estado atual e grupo da atenção. */
function contasDo(painel: DashboardDTO) {
  const naLista = (tipo: AttentionType) => painel.attentionGroups.find((grupo) => grupo.type === tipo)?.count ?? 0;
  return {
    contador: {
      lotesBloqueados: painel.currentState.inventory.lotsBlocked,
      custoIncompleto: painel.currentState.production.completedWithIncompleteCost,
    },
    atencao: {
      lotesBloqueados: naLista("LOT_BLOCKED"),
      custoIncompleto: naLista("PRODUCTION_ORDER_INCOMPLETE_COST"),
    },
    total: painel.attentionTotal,
  };
}

/**
 * Tudo do retrato menos os movimentos recentes: empatam no instante, e o LIMIT
 * não fixa a ordem do empate entre duas execuções. A escrita do teste não toca
 * movimento nenhum.
 */
function semMovimentosRecentes(painel: DashboardDTO): Omit<DashboardDTO, "recentMovements"> {
  const copia: Partial<DashboardDTO> = { ...painel };
  delete copia.recentMovements;
  return copia as Omit<DashboardDTO, "recentMovements">;
}

async function comPrazo<T>(promessa: Promise<T>, mensagem: string): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, reject) => {
    relogio = setTimeout(() => reject(new Error(mensagem)), 30_000);
  });
  try {
    return await Promise.race([promessa, prazo]);
  } finally {
    clearTimeout(relogio);
  }
}

describe("Painel — um retrato do banco por requisição (DASHBOARD-SNAPSHOT-CONSISTENCY-01)", () => {
  /*
   * O contador de lotes bloqueados, a lista de atenção e o custo das OPs
   * concluídas saíam cada um do instante em que a sua consulta rodou. Uma
   * escrita no meio da montagem — outra pessoa desbloqueando um lote e
   * informando o custo do lote consumido — partia a resposta: o contador com
   * o lote, a lista sem ele; e o custo, lido pelo cliente global, fora da
   * transação do retrato.
   *
   * Os contadores são agregado do banco inteiro: por isso a faixa serial, e as
   * três respostas (antes, durante, depois) com o mesmo `now`.
   */
  it("escrita de outra conexão no meio da montagem não parte a resposta em antes e depois", { timeout: 180_000 }, async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, consumedLotId, blockedLotId } = await montarFixtures(app);

    // As fixtures são o que dizem ser: a OP concluída está sem custo e o lote, bloqueado.
    expect((await findProductionOrderMaterialCost(orderId))?.quality).toBe("NO_COST");
    expect((await getPrisma().lot.findUniqueOrThrow({ where: { id: blockedLotId } })).status).toBe("BLOCKED");

    const agora = new Date();
    const consulta = dashboardQuerySchemaEm(agora).parse({});
    const antes = await getDashboard(consulta, agora);

    portao.armar();
    const emMontagem = getDashboard(consulta, agora);
    // O contador de lotes bloqueados já leu; a lista de atenção e o custo esperam.
    await comPrazo(
      Promise.all([portao.estado.retencao, portao.estado.contadorLido]),
      "o Painel não chegou ao ponto da escrita — a forma das consultas mudou?",
    );

    await escritor.$transaction([
      escritor.lot.update({ where: { id: blockedLotId }, data: { status: "AVAILABLE" } }),
      escritor.receiptLine.updateMany({ where: { lotId: consumedLotId }, data: { actualUnitCost: "2.5" } }),
    ]);
    // Confirmada: qualquer leitura nova já vê o lote liberado e o custo real.
    expect((await escritor.lot.findUniqueOrThrow({ where: { id: blockedLotId } })).status).toBe("AVAILABLE");

    portao.estado.soltar();
    const durante = await comPrazo(emMontagem, "o Painel não terminou depois de solto");
    const retidas = [...portao.estado.retidas].sort();
    portao.desarmar();

    const depois = await getDashboard(consulta, agora);

    // As leituras seguradas rodaram DEPOIS da escrita: a lista de lotes da
    // atenção e as OPs do custo, nas duas metades do retrato.
    expect(retidas).toEqual(["Lot.findMany", "ProductionOrder.findMany", "ProductionOrder.findMany"]);

    // A escrita mexe exatamente nestas contas — o teste não é vazio.
    expect((await findProductionOrderMaterialCost(orderId))?.quality).toBe("REAL");
    const [a, d] = [contasDo(antes), contasDo(depois)];
    expect({
      contador: {
        lotesBloqueados: a.contador.lotesBloqueados - d.contador.lotesBloqueados,
        custoIncompleto: a.contador.custoIncompleto - d.contador.custoIncompleto,
      },
      atencao: {
        lotesBloqueados: a.atencao.lotesBloqueados - d.atencao.lotesBloqueados,
        custoIncompleto: a.atencao.custoIncompleto - d.atencao.custoIncompleto,
      },
      total: a.total - d.total,
    }).toEqual({ contador: { lotesBloqueados: 1, custoIncompleto: 1 }, atencao: { lotesBloqueados: 1, custoIncompleto: 1 }, total: 2 });

    // A resposta montada durante a escrita é inteira do retrato de antes:
    // contador e lista juntos, e o custo lido no mesmo instante que o resto.
    expect(contasDo(durante)).toEqual(contasDo(antes));
    expect(semMovimentosRecentes(durante)).toEqual(semMovimentosRecentes(antes));

    await app.close();
  });
});
