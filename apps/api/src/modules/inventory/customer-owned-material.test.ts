import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Capacidade 35 — material de propriedade do cliente.
 *
 * Testes sintéticos: nunca dependem do corpus real. O corpus não identifica
 * quais lotes históricos eram do cliente, e nada aqui infere isso.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixtureCustomerOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  // Maiúsculo: códigos de lote são normalizados para maiúsculo na busca por
  // QR/código, então um marcador minúsculo tornaria o lote não localizável.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    const reservations = await prisma.customerOrderReservation.findMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      select: { id: true },
    });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservationId: { in: reservations.map((row) => row.id) } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
  }
  if (fixtureProductionOrderIds.length > 0) {
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((row) => row.id);
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    const versions = await prisma.formulationVersion.findMany({
      where: { productId: { in: fixtureProductIds } },
      select: { id: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersionId: { in: versions.map((version) => version.id) } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.receiptLine.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.receipt.deleteMany({ where: { customerId: { in: fixtureCustomerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function createCustomer(name: string) {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-OWN-${m}`, legalName: `${name} ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; controlsLot?: boolean; requiresQualityRelease?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-OWN-${m}`,
      name: `Item Owner Teste ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: false,
      requiresQualityRelease: overrides.requiresQualityRelease ?? false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/** Lote com dono explícito + entrada no ledger — mesma matemática do sistema. */
async function receiveOwnedStock(
  itemId: string,
  quantity: string,
  owner: { ownerType: "VERIDI" } | { ownerType: "CUSTOMER"; customerId: string },
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-OWN-${marker()}`,
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
      ownerType: owner.ownerType,
      ...(owner.ownerType === "CUSTOMER" ? { ownerCustomerId: owner.customerId } : {}),
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

async function createProductWithFormulation(
  app: App,
  customerId: string | null,
  components: {
    itemId: string;
    quantity: string;
    unitCode: string;
    supplyResponsibility?: "VERIDI" | "CUSTOMER";
  }[],
) {
  const finishedItem = await createItem("FINISHED_PRODUCT", { unitCode: "un" });
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto Owner Teste ${marker()}`,
        finishedProductItemId: finishedItem.id,
        ...(customerId ? { customerId } : {}),
      },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const version = (
    await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${version.id}`,
    payload: { basisQuantity: "1", components },
  });
  const activation = await app.inject({
    method: "POST",
    url: `/formulation-versions/${version.id}/activate`,
  });

  return { product, finishedItem, versionId: version.id, activation };
}

async function createPlannedOrder(app: App, productId: string, plannedQuantity: string) {
  const created = (
    await app.inject({ method: "POST", url: "/production-orders", payload: { productId, plannedQuantity } })
  ).json();
  fixtureProductionOrderIds.push(created.id);
  const planned = await app.inject({ method: "POST", url: `/production-orders/${created.id}/plan` });
  return planned.json();
}

describe("Material de propriedade do cliente — integridade do dono", () => {
  it("lote VERIDI com cliente e lote CUSTOMER sem cliente são rejeitados pelo banco", async () => {
    const prisma = getPrisma();
    const customer = await createCustomer("Cliente Integridade");
    const item = await createItem("RAW_MATERIAL");

    await expect(
      prisma.lot.create({
        data: {
          code: `LT-BAD-${marker()}`,
          itemId: item.id,
          initialReceivedQuantity: "1",
          ownerType: "VERIDI",
          ownerCustomerId: customer.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.lot.create({
        data: {
          code: `LT-BAD-${marker()}`,
          itemId: item.id,
          initialReceivedQuantity: "1",
          ownerType: "CUSTOMER",
        },
      }),
    ).rejects.toThrow();
  });

  it("mesmo Item tem lotes de donos diferentes, cada um com seu saldo", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A Saldo");
    const customerB = await createCustomer("Cliente B Saldo");
    const item = await createItem("RAW_MATERIAL");

    await receiveOwnedStock(item.id, "20", { ownerType: "VERIDI" });
    const lotA = await receiveOwnedStock(item.id, "100", {
      ownerType: "CUSTOMER",
      customerId: customerA.id,
    });
    await receiveOwnedStock(item.id, "200", { ownerType: "CUSTOMER", customerId: customerB.id });

    // Visão física global continua enxergando tudo — visibilidade não é
    // elegibilidade.
    const lots = (await app.inject({ method: "GET", url: `/lots?itemId=${item.id}&pageSize=100` })).json();
    expect(lots.lots).toHaveLength(3);

    const onlyA = (
      await app.inject({
        method: "GET",
        url: `/lots?itemId=${item.id}&ownerType=CUSTOMER&ownerCustomerId=${customerA.id}`,
      })
    ).json();
    expect(onlyA.lots).toHaveLength(1);
    expect(onlyA.lots[0].lotCode ?? onlyA.lots[0].code).toBe(lotA.code);
    expect(onlyA.lots[0].ownerCustomerName).toBe(customerA.legalName);

    await app.close();
  });
});

describe("Material de propriedade do cliente — FEFO e reserva", () => {
  it("necessidade VERIDI não é coberta por estoque de cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A FEFO");
    const ingredient = await createItem("RAW_MATERIAL");
    await receiveOwnedStock(ingredient.id, "10", { ownerType: "VERIDI" });
    await receiveOwnedStock(ingredient.id, "50", {
      ownerType: "CUSTOMER",
      customerId: customerA.id,
    });

    const { product } = await createProductWithFormulation(app, null, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "20");

    const requirement = planned.requirements[0];
    expect(requirement.supplyResponsibility).toBe("VERIDI");
    // Os 50 kg do cliente não podem reduzir a falta.
    expect(requirement.available).toBe("10");
    expect(requirement.shortage).toBe("10");

    await app.close();
  });

  it("necessidade CUSTOMER só enxerga o estoque do cliente da própria OP", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A Escopo");
    const customerB = await createCustomer("Cliente B Escopo");
    const capsule = await createItem("PACKAGING", { unitCode: "kg" });

    await receiveOwnedStock(capsule.id, "6", { ownerType: "CUSTOMER", customerId: customerA.id });
    await receiveOwnedStock(capsule.id, "20", { ownerType: "CUSTOMER", customerId: customerB.id });
    await receiveOwnedStock(capsule.id, "50", { ownerType: "VERIDI" });

    const { product } = await createProductWithFormulation(app, customerA.id, [
      { itemId: capsule.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "10");

    const requirement = planned.requirements[0];
    expect(requirement.supplyResponsibility).toBe("CUSTOMER");
    expect(requirement.eligibleOwnerCustomerId).toBe(customerA.id);
    expect(requirement.available).toBe("6");
    expect(requirement.shortage).toBe("4");

    await app.close();
  });

  it("reserva do RELEASE usa apenas lotes do cliente da OP", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A Reserva");
    const customerB = await createCustomer("Cliente B Reserva");
    const capsule = await createItem("PACKAGING", { unitCode: "kg" });

    const lotA = await receiveOwnedStock(capsule.id, "30", {
      ownerType: "CUSTOMER",
      customerId: customerA.id,
    });
    await receiveOwnedStock(capsule.id, "30", { ownerType: "CUSTOMER", customerId: customerB.id });
    await receiveOwnedStock(capsule.id, "30", { ownerType: "VERIDI" });

    const { product } = await createProductWithFormulation(app, customerA.id, [
      { itemId: capsule.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "10");
    const released = (
      await app.inject({ method: "POST", url: `/production-orders/${planned.id}/release` })
    ).json();

    const lines = released.reservation.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].lotId).toBe(lotA.id);

    await app.close();
  });

  it("OP com material do cliente sem cliente definido não libera", async () => {
    const app = buildTestApp();
    await app.ready();

    const capsule = await createItem("PACKAGING", { unitCode: "kg" });
    await receiveOwnedStock(capsule.id, "100", { ownerType: "VERIDI" });

    // Produto sem cliente: a ativação da formulação já barra o componente
    // CUSTOMER, então o cenário é montado direto no banco (formulação
    // histórica que perdeu o cliente do produto).
    const { product, versionId } = await createProductWithFormulation(app, null, [
      { itemId: capsule.id, quantity: "1", unitCode: "kg" },
    ]);
    const prisma = getPrisma();
    await prisma.formulationComponent.updateMany({
      where: { formulationVersionId: versionId },
      data: { supplyResponsibility: "CUSTOMER" },
    });

    const planned = await createPlannedOrder(app, product.id, "10");
    const release = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });

    expect(release.statusCode).toBe(400);
    expect(release.json().message).toContain("não possui cliente definido");

    await app.close();
  });

  it("ativar formulação com componente do cliente exige produto com cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const capsule = await createItem("PACKAGING", { unitCode: "kg" });
    const { activation } = await createProductWithFormulation(app, null, [
      { itemId: capsule.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);

    expect(activation.statusCode).toBe(400);
    expect(activation.json().message).toContain("não está vinculado a um cliente");

    await app.close();
  });
});

describe("Material de propriedade do cliente — recebimento sem Ordem de Compra", () => {
  it("cria Receipt/Lot/RECEIPT_IN com dono CUSTOMER e sem OC", async () => {
    const app = buildTestApp();
    await app.ready();

    const customer = await createCustomer("Cliente Recebimento");
    const item = await createItem("RAW_MATERIAL");

    const response = await app.inject({
      method: "POST",
      url: "/receipts/customer-supplied",
      payload: {
        customerId: customer.id,
        receivedAt: new Date().toISOString(),
        lines: [{ itemId: item.id, receivedQuantity: "10", supplierLot: "FAB-123" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const receipt = response.json();
    expect(receipt.sourceType).toBe("CUSTOMER_SUPPLIED");
    expect(receipt.purchaseOrderId).toBeNull();
    expect(receipt.supplierId).toBeNull();
    expect(receipt.customerName).toBe(customer.legalName);
    expect(receipt.lines[0].ownerType).toBe("CUSTOMER");

    const prisma = getPrisma();
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: receipt.lines[0].lotId } });
    expect(lot.ownerType).toBe("CUSTOMER");
    expect(lot.ownerCustomerId).toBe(customer.id);
    expect(lot.origin).toBe("RECEIPT");
    expect(lot.supplierId).toBeNull();
    // Lote do fabricante informado pelo cliente é preservado — nunca
    // confundido com o dono.
    expect(lot.supplierLot).toBe("FAB-123");

    const movements = await prisma.inventoryMovement.findMany({ where: { lotId: lot.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe("RECEIPT_IN");
    expect(movements[0]!.quantity.toString()).toBe("10");

    await app.close();
  });

  it("item sem controle de lote é rejeitado com mensagem explícita", async () => {
    const app = buildTestApp();
    await app.ready();

    const customer = await createCustomer("Cliente Sem Lote");
    const item = await createItem("RAW_MATERIAL", { controlsLot: false });

    const response = await app.inject({
      method: "POST",
      url: "/receipts/customer-supplied",
      payload: {
        customerId: customer.id,
        receivedAt: new Date().toISOString(),
        lines: [{ itemId: item.id, receivedQuantity: "10" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("lot_control_required");

    await app.close();
  });

  it("qualidade continua valendo: item com liberação entra AWAITING_RELEASE e só depois fica disponível", async () => {
    const app = buildTestApp();
    await app.ready();

    const customer = await createCustomer("Cliente Qualidade");
    const item = await createItem("RAW_MATERIAL", { requiresQualityRelease: true });

    const receipt = (
      await app.inject({
        method: "POST",
        url: "/receipts/customer-supplied",
        payload: {
          customerId: customer.id,
          receivedAt: new Date().toISOString(),
          lines: [{ itemId: item.id, receivedQuantity: "10" }],
        },
      })
    ).json();

    const lotId = receipt.lines[0].lotId as string;
    const beforeRelease = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(beforeRelease.status).toBe("AWAITING_RELEASE");
    expect(beforeRelease.onHand).toBe("10");
    expect(beforeRelease.available).toBe("0");

    await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    const afterRelease = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(afterRelease.status).toBe("AVAILABLE");
    expect(afterRelease.available).toBe("10");

    await app.close();
  });
});

describe("Material de propriedade do cliente — consulta operacional", () => {
  it("visão de materiais de clientes lista só material de cliente, com saldo do ledger", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A Visão");
    const item = await createItem("RAW_MATERIAL");
    await receiveOwnedStock(item.id, "40", { ownerType: "VERIDI" });
    await receiveOwnedStock(item.id, "100", { ownerType: "CUSTOMER", customerId: customerA.id });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/customer-materials?customerId=${customerA.id}`,
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].customerName).toBe(customerA.legalName);
    expect(rows[0].onHand).toBe("100");
    expect(rows[0].available).toBe("100");

    // CSV respeita o mesmo filtro do read model.
    const csv = await app.inject({
      method: "GET",
      url: `/inventory/customer-materials/export.csv?customerId=${customerA.id}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(customerA.legalName);
    // A visão é só de material de cliente: a coluna Cliente já identifica o
    // dono, não existe linha da Veridi para desambiguar.
    expect(csv.body).toContain("Cliente;");

    await app.close();
  });

  it("R-01 traz o proprietário e filtra por cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A R01");
    const item = await createItem("RAW_MATERIAL");
    await receiveOwnedStock(item.id, "5", { ownerType: "VERIDI" });
    await receiveOwnedStock(item.id, "7", { ownerType: "CUSTOMER", customerId: customerA.id });

    const all = (
      await app.inject({ method: "GET", url: `/reports/inventory/position?itemId=${item.id}` })
    ).json();
    expect(all.rows).toHaveLength(2);
    expect(all.rows.filter((row: { ownerType: string }) => row.ownerType === "CUSTOMER")).toHaveLength(1);

    const filtered = (
      await app.inject({
        method: "GET",
        url: `/reports/inventory/position?itemId=${item.id}&ownerCustomerId=${customerA.id}`,
      })
    ).json();
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].ownerCustomerName).toBe(customerA.legalName);

    await app.close();
  });
});

describe("Material de propriedade do cliente — picking, consumo e custo", () => {
  it("substituição rejeita lote de outro cliente e da Veridi, e aceita outro lote do mesmo cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const customerA = await createCustomer("Cliente A Substituição");
    const customerB = await createCustomer("Cliente B Substituição");
    const capsule = await createItem("PACKAGING", { unitCode: "kg" });

    await receiveOwnedStock(capsule.id, "10", { ownerType: "CUSTOMER", customerId: customerA.id });
    const lotA2 = await receiveOwnedStock(capsule.id, "10", {
      ownerType: "CUSTOMER",
      customerId: customerA.id,
    });
    const lotB = await receiveOwnedStock(capsule.id, "10", {
      ownerType: "CUSTOMER",
      customerId: customerB.id,
    });
    const lotVeridi = await receiveOwnedStock(capsule.id, "10", { ownerType: "VERIDI" });

    const { product } = await createProductWithFormulation(app, customerA.id, [
      { itemId: capsule.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "10");
    const released = (
      await app.inject({ method: "POST", url: `/production-orders/${planned.id}/release` })
    ).json();
    const lineId = released.reservation.lines[0].id as string;

    const toOtherCustomer = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/picking/${lineId}/substitute`,
      payload: { lotCode: lotB.code },
    });
    expect(toOtherCustomer.statusCode).toBe(400);
    expect(toOtherCustomer.json().error).toBe("alternate_lot_owner_mismatch");

    const toVeridi = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/picking/${lineId}/substitute`,
      payload: { lotCode: lotVeridi.code },
    });
    expect(toVeridi.statusCode).toBe(400);
    expect(toVeridi.json().error).toBe("alternate_lot_owner_mismatch");

    const toSameCustomer = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/picking/${lineId}/substitute`,
      payload: { lotCode: lotA2.code },
    });
    expect(toSameCustomer.statusCode).toBe(200);

    await app.close();
  });

  it("consumo de lote do cliente baixa estoque normalmente e fica fora do custo Veridi", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const customerA = await createCustomer("Cliente A Custo");
    const veridiItem = await createItem("RAW_MATERIAL");
    const customerItem = await createItem("PACKAGING", { unitCode: "kg" });

    // Custo real da Veridi vem do lote consumido; material do cliente não
    // tem custo de aquisição nenhum.
    const veridiLot = await receiveOwnedStock(veridiItem.id, "10", { ownerType: "VERIDI" });
    const customerLot = await receiveOwnedStock(customerItem.id, "10", {
      ownerType: "CUSTOMER",
      customerId: customerA.id,
    });
    await prisma.receiptLine.create({
      data: {
        receipt: {
          create: {
            code: `REC-OWN-${marker()}`,
            sourceType: "CUSTOMER_SUPPLIED",
            customer: { connect: { id: customerA.id } },
            receivedAt: new Date(),
          },
        },
        item: { connect: { id: veridiItem.id } },
        itemCode: veridiItem.code,
        itemName: veridiItem.name,
        receivedQuantity: "10",
        unitCode: "kg",
        lot: { connect: { id: veridiLot.id } },
        actualUnitCost: "10",
      },
    });

    const { product } = await createProductWithFormulation(app, customerA.id, [
      { itemId: veridiItem.id, quantity: "1", unitCode: "kg" },
      { itemId: customerItem.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "10");
    const released = (
      await app.inject({ method: "POST", url: `/production-orders/${planned.id}/release` })
    ).json();

    for (const line of released.reservation.lines) {
      await app.inject({
        method: "POST",
        url: `/production-orders/${planned.id}/picking/${line.id}/confirm`,
        payload: { lotCode: line.lotCode },
      });
    }
    const consumption = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/consumptions`,
      payload: {
        entries: released.reservation.lines.map((line: { id: string }) => ({
          reservationLineId: line.id,
          quantity: "10",
        })),
      },
    });
    expect(consumption.statusCode).toBe(201);

    // Estoque do cliente baixou de verdade, e o dono do lote não mudou.
    const consumedLot = await prisma.lot.findUniqueOrThrow({ where: { id: customerLot.id } });
    expect(consumedLot.ownerType).toBe("CUSTOMER");
    expect(consumedLot.ownerCustomerId).toBe(customerA.id);
    const lotAfter = (await app.inject({ method: "GET", url: `/lots/${customerLot.id}` })).json();
    expect(lotAfter.onHand).toBe("0");

    const cost = (
      await app.inject({ method: "GET", url: `/production-orders/${planned.id}/material-cost` })
    ).json();
    // R$ 100 de material Veridi; o material do cliente não vira R$ 0 nem
    // rebaixa a qualidade para PARTIAL.
    expect(cost.totalMaterialCost).toBe("100.00");
    expect(cost.quality).toBe("REAL");
    expect(cost.hasCustomerSuppliedMaterials).toBe(true);
    expect(cost.customerSuppliedConsumptionCount).toBe(1);
    const customerConsumption = cost.consumptions.find(
      (row: { ownerType: string }) => row.ownerType === "CUSTOMER",
    );
    expect(customerConsumption.materialCost).toBeNull();
    expect(customerConsumption.ownerCustomerName).toBe(customerA.legalName);

    await app.close();
  });
});

describe("Material de propriedade do cliente — sugestão de compra", () => {
  it("falta de material do cliente não vira Ordem de Compra: aparece como aguardando cliente", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const customerA = await createCustomer("Cliente A Compra");
    const veridiItem = await createItem("RAW_MATERIAL");
    const customerItem = await createItem("PACKAGING", { unitCode: "kg" });

    // Veridi tem 5 kg (falta 5); o cliente enviou 0 (falta 10).
    await receiveOwnedStock(veridiItem.id, "5", { ownerType: "VERIDI" });

    const { product } = await createProductWithFormulation(app, customerA.id, [
      { itemId: veridiItem.id, quantity: "1", unitCode: "kg" },
      { itemId: customerItem.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);

    const order = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: { customerId: customerA.id, lines: [{ productId: product.id, orderedQuantity: "10" }] },
      })
    ).json();
    fixtureCustomerOrderIds.push(order.id);
    const confirmed = (
      await app.inject({ method: "POST", url: `/customer-orders/${order.id}/confirm` })
    ).json();
    const applied = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: {
        lines: [
          {
            customerOrderLineId: confirmed.lines[0].id,
            reserveQuantity: "0",
            produceQuantity: "10",
          },
        ],
      },
    });
    expect(applied.statusCode).toBe(200);
    const createdOrders = await prisma.productionOrder.findMany({
      where: { customerOrderId: order.id },
      select: { id: true },
    });
    fixtureProductionOrderIds.push(...createdOrders.map((row) => row.id));

    const suggestion = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}/purchase-suggestion` })
    ).json();

    // Só o material da Veridi vira sugestão de compra.
    expect(suggestion.rows).toHaveLength(1);
    expect(suggestion.rows[0].itemId).toBe(veridiItem.id);
    expect(suggestion.rows[0].operationalShortage).toBe("5");

    expect(suggestion.customerSuppliedRows).toHaveLength(1);
    const customerRow = suggestion.customerSuppliedRows[0];
    expect(customerRow.itemId).toBe(customerItem.id);
    expect(customerRow.customerId).toBe(customerA.id);
    expect(customerRow.available).toBe("0");
    expect(customerRow.shortage).toBe("10");

    // Nem mesmo um payload explícito compra material do cliente.
    const drafts = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: customerItem.id, supplierId: veridiItem.id, quantity: "10" }] },
    });
    expect(drafts.statusCode).toBe(400);
    expect(drafts.json().error).toBe("customer_supplied_item");

    await app.close();
  });
});
