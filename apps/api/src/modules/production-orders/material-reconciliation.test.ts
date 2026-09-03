import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * RECONCILIAÇÃO DE MATERIAL — a regra que faltava para a OP concluir.
 *
 * O cenário central destes testes não é hipotético: é a `OP-000001` da rodada
 * de validação por interface, que ficou `COMPLETED` com seis requisitos e um
 * único consumo registrado. O lote de produto acabado nasceu declarando seis
 * componentes com registro de um, os outros cinco materiais nunca baixaram do
 * estoque, e o snapshot de custo congelou uma produção que, no papel, quase
 * não consumiu nada.
 *
 * O primeiro teste deste arquivo é escrito para FALHAR contra o código
 * anterior. Se algum dia ele voltar a passar sem o portão, o defeito voltou.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let supplierId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-REC-${m}`, legalName: `Fornecedor Reconciliacao ${m}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds }, replacesLineId: { not: null } },
      });
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
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
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-REC-${m}`,
      name: `Item Reconciliacao ${m}`,
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

async function receiveStock(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-REC-${marker()}`.toUpperCase(),
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

/**
 * OP liberada com N materiais — o formato do cenário real, onde a OP tem
 * vários requisitos e é possível consumir uns e esquecer outros.
 */
async function createOrderWithMaterials(app: App, quantidadeDeMateriais: number) {
  const finishedItem = await createItem("FINISHED_PRODUCT");
  const materiais = [];
  for (let i = 0; i < quantidadeDeMateriais; i += 1) {
    const material = await createItem("RAW_MATERIAL");
    await receiveStock(material.id, "1000");
    materiais.push(material);
  }

  const productResponse = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto Reconciliacao ${marker()}`,
      finishedProductItemId: finishedItem.id,
    },
  });
  const product = productResponse.json();
  fixtureProductIds.push(product.id);

  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: "10",
      components: materiais.map((material) => ({
        itemId: material.id,
        quantity: "2",
        unitCode: "kg",
      })),
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  const orderCreated = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId: product.id, plannedQuantity: "10" },
  });
  const orderId = orderCreated.json().id;
  fixtureProductionOrderIds.push(orderId);
  await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
  const released = await app.inject({ method: "POST", url: `/production-orders/${orderId}/release` });
  return { order: released.json(), materiais, finishedItem };
}

/** Confirma o picking e consome integralmente os `quantos` primeiros materiais. */
async function consumir(app: App, order: { id: string; requirements: any[] }, quantos: number) {
  for (const requirement of order.requirements.slice(0, quantos)) {
    for (const line of requirement.reservationLines) {
      await app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
        payload: line.lotCode ? { lotCode: line.lotCode } : {},
      });
      await app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/consumptions`,
        payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
      });
    }
  }
}

async function apontar(app: App, orderId: string, quantidade: string) {
  return app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/outputs`,
    payload: { quantity: quantidade, destination: "NEW_LOT", businessLotNumber: `VD-${marker()}` },
  });
}

async function getOrder(app: App, id: string) {
  const response = await app.inject({ method: "GET", url: `/production-orders/${id}` });
  return response.json();
}

describe("Ordem de Produção — reconciliação de material", () => {
  it("reproduz OP-000001: seis requisitos, um consumo, conclusão RECUSADA", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 6);
    await consumir(app, order, 1);
    await apontar(app, order.id, "10");

    const recusada = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: {},
    });

    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("unreconciled_materials");
    // A lista viaja no corpo: a tela precisa dizer QUAIS materiais faltam.
    expect(recusada.json().materials).toHaveLength(5);
    expect(recusada.json().message).toContain("Registre o consumo real ou justifique");

    // E a OP continua em produção — recusar nunca deixa estado pela metade.
    expect((await getOrder(app, order.id)).status).toBe("IN_PRODUCTION");

    await app.close();
  });

  it("seis de seis consumidos: conclusão permitida", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 6);
    await consumir(app, order, 6);
    await apontar(app, order.id, "10");

    const concluida = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: {},
    });

    expect(concluida.statusCode).toBe(200);
    expect(concluida.json().status).toBe("COMPLETED");
    expect(concluida.json().materialReconciliation.pendingRequirements).toBe(0);
    expect(concluida.json().materialReconciliation.reconciledRequirements).toBe(6);

    await app.close();
  });

  it("divergência justificada conclui; a mesma divergência sem justificativa não", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 3);
    await consumir(app, order, 2);
    await apontar(app, order.id, "10");

    const semJustificar = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: {},
    });
    expect(semJustificar.statusCode).toBe(400);

    const pendente = order.requirements[2];
    const justificada = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/requirements/${pendente.id}/variance`,
      payload: { reason: "Material substituído por sobra do lote anterior" },
    });
    expect(justificada.statusCode).toBe(200);

    const linha = justificada
      .json()
      .requirements.find((requirement: { id: string }) => requirement.id === pendente.id);
    expect(linha.reconciliationStatus).toBe("VARIANCE_ACCEPTED");
    expect(linha.varianceReason).toBe("Material substituído por sobra do lote anterior");
    expect(linha.varianceAcceptedBy).toBeTruthy();
    expect(linha.varianceAcceptedAt).toBeTruthy();

    const concluida = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: {},
    });
    expect(concluida.statusCode).toBe(200);

    await app.close();
  });

  it("justificativa de material não é o motivo de variação de quantidade produzida", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 2);
    await consumir(app, order, 1);
    // Produz menos que o planejado: exige `completionReason`. Isso NÃO pode
    // valer como justificativa do material que ficou sem consumo — são
    // perguntas diferentes.
    await apontar(app, order.id, "8");

    const comMotivoDeProducao = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: { completionReason: "Perda no envase" },
    });

    expect(comMotivoDeProducao.statusCode).toBe(400);
    expect(comMotivoDeProducao.json().error).toBe("unreconciled_materials");

    await app.close();
  });

  it("estoque só baixa por consumo real: material justificado permanece disponível", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order, materiais } = await createOrderWithMaterials(app, 2);
    const naoConsumido = materiais[1];

    await consumir(app, order, 1);
    await apontar(app, order.id, "10");
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/requirements/${order.requirements[1].id}/variance`,
      payload: { reason: "Não utilizado nesta produção" },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: {},
    });

    // Justificar a diferença explica; nunca baixa estoque por decreto.
    const estoque = await app.inject({ method: "GET", url: `/inventory/${naoConsumido.id}` });
    expect(estoque.json().onHand).toBe("1000");
    expect(estoque.json().reserved).toBe("0");
    expect(estoque.json().available).toBe("1000");

    await app.close();
  });

  it("o DTO expõe a diferença por linha e o progresso da ordem", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 3);
    await consumir(app, order, 1);

    const atual = await getOrder(app, order.id);
    expect(atual.materialReconciliation).toEqual({
      totalRequirements: 3,
      reconciledRequirements: 1,
      pendingRequirements: 2,
      canComplete: false,
    });

    const reconciliado = atual.requirements.find(
      (requirement: { reconciliationStatus: string }) =>
        requirement.reconciliationStatus === "RECONCILED",
    );
    expect(reconciliado.unreconciledQuantity).toBe("0");

    const pendentes = atual.requirements.filter(
      (requirement: { reconciliationStatus: string }) =>
        requirement.reconciliationStatus === "PENDING_NONE",
    );
    expect(pendentes).toHaveLength(2);
    // 2 kg por 10 de base, 10 planejadas: 2 kg por material.
    expect(pendentes[0].unreconciledQuantity).toBe("2");

    await app.close();
  });

  it("consumo parcial pende como PARTIAL, não como NONE", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 1);
    const linha = order.requirements[0].reservationLines[0];
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${linha.id}/confirm`,
      payload: linha.lotCode ? { lotCode: linha.lotCode } : {},
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: linha.id, quantity: "1" }] },
    });

    const atual = await getOrder(app, order.id);
    expect(atual.requirements[0].reconciliationStatus).toBe("PENDING_PARTIAL");
    expect(atual.requirements[0].unreconciledQuantity).toBe("1");

    await app.close();
  });

  it("justificar onde não há diferença é recusado", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 1);
    await consumir(app, order, 1);

    const recusada = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/requirements/${order.requirements[0].id}/variance`,
      payload: { reason: "Justificativa sem diferença" },
    });

    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("no_material_variance");

    await app.close();
  });

  it("justificativa vazia é recusada, e requisito de outra ordem não é encontrado", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 1);
    const outra = await createOrderWithMaterials(app, 1);

    const vazia = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/requirements/${order.requirements[0].id}/variance`,
      payload: { reason: "   " },
    });
    expect(vazia.statusCode).toBe(400);
    expect(vazia.json().error).toBe("validation_error");

    // Requisito existe, mas é de outra OP: escopo por ordem, sempre.
    const escapou = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/requirements/${outra.order.requirements[0].id}/variance`,
      payload: { reason: "Tentando justificar material de outra ordem" },
    });
    expect(escapou.statusCode).toBe(404);
    expect(escapou.json().error).toBe("requirement_not_found");

    await app.close();
  });

  it("ordem concluída não recebe justificativa nova", async () => {
    const app = buildTestApp();
    await app.ready();

    const { order } = await createOrderWithMaterials(app, 2);
    await consumir(app, order, 2);
    await apontar(app, order.id, "10");
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const tardia = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/requirements/${order.requirements[0].id}/variance`,
      payload: { reason: "Justificativa depois do fato" },
    });

    expect(tardia.statusCode).toBe(400);
    expect(tardia.json().error).toBe("invalid_transition");

    await app.close();
  });
});
