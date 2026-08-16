import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Capacidade 40 — Sugestão de Compra com fornecedores homologados.
 *
 * A análise da Sugestão (capacidade 26) não muda: o que entra aqui é
 * QUEM pode fornecer, a que preço de referência e com que pedido mínimo.
 * Homologação orienta; nunca vira trava do módulo de compras.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
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
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.purchaseOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
      select: { id: true },
    });
    const reservationIds = reservations.map((row) => row.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.productionOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItem: { itemId: { in: fixtureItemIds } } },
    });
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItem: { itemId: { in: fixtureItemIds } } },
    });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: fixtureSupplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-SRC-${m}`, legalName: `Cliente Sourcing ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-SRC-${m}`, legalName: `Fornecedor Sourcing ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createRawMaterial() {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-SRC-${m}`,
      name: `Insumo Sourcing ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/**
 * Relação homologada com oferta vigente. `preferred` é decisão explícita —
 * nunca consequência de ter o menor preço.
 */
async function approvedSupplierFor(
  itemId: string,
  options: {
    preferred?: boolean;
    unitPrice?: string;
    currencyCode?: string;
    priceUomCode?: string;
    moq?: { quantity: string; uomCode: string };
    withOffer?: boolean;
    status?: "PENDING" | "APPROVED" | "BLOCKED";
  } = {},
) {
  const prisma = getPrisma();
  const supplier = await createSupplier();
  const supplierItem = await prisma.supplierItem.create({
    data: {
      itemId,
      supplierId: supplier.id,
      qualificationStatus: options.status ?? "APPROVED",
      preferred: options.preferred ?? false,
      active: true,
    },
  });

  if (options.withOffer !== false) {
    await prisma.supplierItemOffer.create({
      data: {
        supplierItemId: supplierItem.id,
        unitPrice: options.unitPrice ?? "100",
        currencyCode: options.currencyCode ?? "BRL",
        priceUomCode: options.priceUomCode ?? "kg",
        ...(options.moq
          ? { minimumOrderQuantity: options.moq.quantity, minimumOrderUomCode: options.moq.uomCode }
          : {}),
        effectiveAt: new Date(Date.now() - 86_400_000),
        source: "MANUAL",
      },
    });
  }

  return { supplier, supplierItem };
}

async function createProductWithFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
) {
  const prisma = getPrisma();
  const m = marker();
  const finishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-SRC-${m}`,
      name: `Produto Sourcing ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(finishedItem.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Produto Sourcing ${m}`, finishedProductItemId: finishedItem.id },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${version.id}`,
    payload: { basisQuantity: "1", components },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

  return product;
}

/** Pedido confirmado + plano aplicado — gera a falta usada pela sugestão. */
async function shortageScenario(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
) {
  const product = await createProductWithFormulation(app, components);
  const customer = await createCustomer();

  const created = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: customer.id, lines: [{ productId: product.id, orderedQuantity: "1" }] },
    })
  ).json();
  fixtureCustomerOrderIds.push(created.id);

  const order = (
    await app.inject({ method: "POST", url: `/customer-orders/${created.id}/confirm` })
  ).json();
  await app.inject({
    method: "POST",
    url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
    payload: {
      lines: [
        { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
      ],
    },
  });

  return order;
}

async function suggestionRow(app: App, orderId: string, itemId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/customer-orders/${orderId}/purchase-suggestion`,
  });
  return response
    .json()
    .rows.find((row: { itemId: string }) => row.itemId === itemId) as {
    newSuggestedPurchase: string;
    recommendedSupplierItemId: string | null;
    supplierCandidates: {
      supplierItemId: string;
      supplierId: string;
      preferred: boolean;
      referenceUnitPrice: string | null;
      referenceCurrencyCode: string | null;
      referencePriceInItemUom: string | null;
      minimumOrderInItemUom: string | null;
      recommendedPurchaseQuantity: string;
      moqRaisedQuantity: boolean;
    }[];
  };
}

describe("Sugestão de Compra — fornecedores homologados", () => {
  it("recomenda o preferencial e eleva a quantidade até o pedido mínimo", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await createRawMaterial();
    const { supplierItem } = await approvedSupplierFor(item.id, {
      preferred: true,
      unitPrice: "100",
      moq: { quantity: "25", uomCode: "kg" },
    });

    const order = await shortageScenario(app, [
      { itemId: item.id, quantity: "8", unitCode: "kg" },
    ]);
    const row = await suggestionRow(app, order.id, item.id);

    expect(row.newSuggestedPurchase).toBe("8");
    expect(row.recommendedSupplierItemId).toBe(supplierItem.id);

    const candidate = row.supplierCandidates[0]!;
    expect(candidate.preferred).toBe(true);
    expect(candidate.referenceUnitPrice).toBe("100");
    // MOQ maior que a falta: recomendação sobe, mas nada é bloqueado.
    expect(candidate.recommendedPurchaseQuantity).toBe("25");
    expect(candidate.moqRaisedQuantity).toBe(true);

    await app.close();
  });

  it("com vários homologados e nenhum preferencial não escolhe sozinho", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await createRawMaterial();
    await approvedSupplierFor(item.id, { unitPrice: "100" });
    await approvedSupplierFor(item.id, { unitPrice: "80" });

    const order = await shortageScenario(app, [
      { itemId: item.id, quantity: "10", unitCode: "kg" },
    ]);
    const row = await suggestionRow(app, order.id, item.id);

    expect(row.supplierCandidates).toHaveLength(2);
    // O mais barato NÃO é escolhido automaticamente.
    expect(row.recommendedSupplierItemId).toBeNull();

    await app.close();
  });

  it("ignora relação bloqueada e avisa quando não há homologado", async () => {
    const app = buildTestApp();
    await app.ready();

    const blockedItem = await createRawMaterial();
    await approvedSupplierFor(blockedItem.id, { status: "BLOCKED" });

    const pendingItem = await createRawMaterial();
    await approvedSupplierFor(pendingItem.id, { status: "PENDING" });

    const order = await shortageScenario(app, [
      { itemId: blockedItem.id, quantity: "5", unitCode: "kg" },
      { itemId: pendingItem.id, quantity: "5", unitCode: "kg" },
    ]);

    expect((await suggestionRow(app, order.id, blockedItem.id)).supplierCandidates).toHaveLength(0);
    const pendingRow = await suggestionRow(app, order.id, pendingItem.id);
    expect(pendingRow.supplierCandidates).toHaveLength(0);
    expect(pendingRow.recommendedSupplierItemId).toBeNull();

    await app.close();
  });

  it("converte preço e MOQ entre unidades compatíveis", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await createRawMaterial();
    await approvedSupplierFor(item.id, {
      preferred: true,
      unitPrice: "0.10",
      priceUomCode: "g",
      moq: { quantity: "20000", uomCode: "g" },
    });

    const order = await shortageScenario(app, [
      { itemId: item.id, quantity: "5", unitCode: "kg" },
    ]);
    const candidate = (await suggestionRow(app, order.id, item.id)).supplierCandidates[0]!;

    // R$ 0,10/g é R$ 100,00/kg; 20000 g é 20 kg.
    expect(candidate.referencePriceInItemUom).toBe("100");
    expect(candidate.minimumOrderInItemUom).toBe("20");
    expect(candidate.recommendedPurchaseQuantity).toBe("20");

    await app.close();
  });

  it("material do cliente nunca consulta fornecedor nem vira compra", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const item = await createRawMaterial();
    await approvedSupplierFor(item.id, { preferred: true });

    const order = await shortageScenario(app, [
      { itemId: item.id, quantity: "12", unitCode: "kg" },
    ]);

    // O requisito passa a ser de responsabilidade do cliente.
    await prisma.productionOrderRequirement.updateMany({
      where: { itemId: item.id, productionOrder: { customerOrderId: order.id } },
      data: { supplyResponsibility: "CUSTOMER" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/customer-orders/${order.id}/purchase-suggestion`,
    });
    const body = response.json();
    expect(body.rows).toHaveLength(0);
    expect(body.customerSuppliedRows).toHaveLength(1);
    expect(body.customerSuppliedRows[0].itemId).toBe(item.id);

    await app.close();
  });
});

describe("Sugestão de Compra — preço na OC rascunho", () => {
  it("pré-preenche o preço em BRL e congela o valor na OC", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const item = await createRawMaterial();
    const { supplier, supplierItem } = await approvedSupplierFor(item.id, {
      preferred: true,
      unitPrice: "100",
    });

    const order = await shortageScenario(app, [
      { itemId: item.id, quantity: "10", unitCode: "kg" },
    ]);

    const generated = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: item.id, supplierId: supplier.id, quantity: "10" }] },
    });
    expect(generated.statusCode).toBe(201);

    const line = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { itemId: item.id, purchaseOrder: { customerOrderId: order.id } },
    });
    expect(line.unitPrice?.toString()).toBe("100");

    // Oferta nova não reescreve OC existente: o preço da linha é snapshot.
    await prisma.supplierItemOffer.create({
      data: {
        supplierItemId: supplierItem.id,
        unitPrice: "180",
        currencyCode: "BRL",
        priceUomCode: "kg",
        effectiveAt: new Date(),
        source: "MANUAL",
      },
    });
    const reread = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reread.unitPrice?.toString()).toBe("100");

    await app.close();
  });

  it("não converte USD em BRL nem preço em unidade incompatível", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const usdItem = await createRawMaterial();
    const usdSupplier = (
      await approvedSupplierFor(usdItem.id, { preferred: true, unitPrice: "20", currencyCode: "USD" })
    ).supplier;

    const legacyItem = await createRawMaterial();
    const legacySupplier = (await approvedSupplierFor(legacyItem.id, { withOffer: false })).supplier;
    const legacyRelation = await prisma.supplierItem.findFirstOrThrow({
      where: { itemId: legacyItem.id },
    });
    // Referência histórica sem vigência — nunca é preço atual.
    await prisma.supplierItemOffer.create({
      data: {
        supplierItemId: legacyRelation.id,
        unitPrice: "77",
        currencyCode: "BRL",
        priceUomCode: "kg",
        effectiveAt: null,
        source: "LEGACY_IMPORT",
        sourceKey: `test-${marker()}`,
      },
    });

    const order = await shortageScenario(app, [
      { itemId: usdItem.id, quantity: "4", unitCode: "kg" },
      { itemId: legacyItem.id, quantity: "6", unitCode: "kg" },
    ]);

    await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: {
        lines: [
          { itemId: usdItem.id, supplierId: usdSupplier.id, quantity: "4" },
          { itemId: legacyItem.id, supplierId: legacySupplier.id, quantity: "6" },
        ],
      },
    });

    const usdLine = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { itemId: usdItem.id, purchaseOrder: { customerOrderId: order.id } },
    });
    expect(usdLine.unitPrice).toBeNull();

    const legacyLine = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { itemId: legacyItem.id, purchaseOrder: { customerOrderId: order.id } },
    });
    expect(legacyLine.unitPrice).toBeNull();

    // A oferta em USD continua visível como referência na análise.
    const usdRow = await suggestionRow(app, order.id, usdItem.id);
    expect(usdRow.supplierCandidates[0]!.referenceCurrencyCode).toBe("USD");

    await app.close();
  });
});
