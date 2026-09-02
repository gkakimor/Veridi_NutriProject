import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { addMonths, suggestedExpiryDate } from "../../lib/date-months.js";
import { splitDecimal } from "../../lib/part-split.js";
import { suggestBusinessLotNumber } from "../../lib/business-lot.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Capacidade 36 — documentos controlados, numeração oficial, produção
 * fracionada e Folha de Receita. Fixtures sintéticas: nada depende do
 * corpus real.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixtureRevisionIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** Revisão tem no máximo 20 caracteres — marcador curto. */
function shortMarker(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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
  if (fixtureProductionOrderIds.length > 0) {
    const parts = await prisma.productionOrderPart.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    await prisma.recipeWeighing.deleteMany({
      where: { productionOrderPartId: { in: parts.map((row) => row.id) } },
    });
    await prisma.productionOrderPart.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { productionConsumption: { productionOrderId: { in: fixtureProductionOrderIds } } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.materialReservationLine.deleteMany({
      where: { reservationId: { in: reservations.map((row) => row.id) } },
    });
    await prisma.materialReservation.deleteMany({
      where: { id: { in: reservations.map((row) => row.id) } },
    });
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    const versions = await prisma.formulationVersion.findMany({
      where: { productId: { in: fixtureProductIds } },
      select: { id: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersionId: { in: versions.map((row) => row.id) } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureRevisionIds.length > 0) {
    await prisma.controlledDocumentRevision.deleteMany({
      where: { id: { in: fixtureRevisionIds } },
    });
  }
});

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-GMP-${m}`,
      name: `Item GMP ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createCustomer(overrides: { businessLotSuffix?: string } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: {
      code: `CLI-GMP-${m}`,
      legalName: `Cliente GMP ${m}`,
      tradeName: "Alpha",
      // CNPJ nulo: a fixture não precisa de documento válido e dois
      // clientes de teste não podem colidir.
      cnpj: null,
      zipCode: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      ...(overrides.businessLotSuffix ? { businessLotSuffix: overrides.businessLotSuffix } : {}),
      active: true,
    },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function receiveStock(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-GMP-${marker()}`,
      itemId,
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

async function createProductWithFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { customerId?: string; shelfLifeMonths?: number; businessLotCode?: string } = {},
) {
  const finishedItem = await createItem("FINISHED_PRODUCT", { unitCode: "un", controlsExpiry: true });
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto GMP ${marker()}`,
        finishedProductItemId: finishedItem.id,
        customerId: overrides.customerId ?? (await fixtureCustomerId()),
        ...(overrides.shelfLifeMonths ? { shelfLifeMonths: overrides.shelfLifeMonths } : {}),
        ...(overrides.businessLotCode ? { businessLotCode: overrides.businessLotCode } : {}),
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
  await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

  return { product, finishedItem };
}

async function createReleasedOrder(
  app: App,
  productId: string,
  plannedQuantity: string,
  numberOfParts = 1,
) {
  const created = (
    await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId, plannedQuantity, numberOfParts },
    })
  ).json();
  fixtureProductionOrderIds.push(created.id);
  await app.inject({ method: "POST", url: `/production-orders/${created.id}/plan` });
  const released = await app.inject({ method: "POST", url: `/production-orders/${created.id}/release` });
  return released.json();
}

async function createRevision(app: App, type: "PRODUCTION_ORDER" | "RECIPE_SHEET", revision: string) {
  const created = (
    await app.inject({
      method: "POST",
      url: "/controlled-documents",
      payload: { type, revision, activate: true },
    })
  ).json();
  fixtureRevisionIds.push(created.id);
  return created;
}

describe("Helpers determinísticos", () => {
  it("divide a quantidade em partes que somam exatamente o total", () => {
    const parts = splitDecimal(new Prisma.Decimal("10"), 3);
    expect(parts.map((part) => part.toString())).toEqual(["3.333333", "3.333333", "3.333334"]);
    expect(parts.reduce((sum, part) => sum.plus(part), new Prisma.Decimal(0)).toString()).toBe("10");
  });

  it("soma meses respeitando o fim do mês", () => {
    // 31/01 + 1 mês nunca vira 03/03: usa o último dia válido de fevereiro.
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2028-02-29",
    );
    expect(
      suggestedExpiryDate(new Date("2026-08-16T00:00:00Z"), 24)!.toISOString().slice(0, 10),
    ).toBe("2028-08-16");
    // Sem vida útil cadastrada o sistema não inventa validade.
    expect(suggestedExpiryDate(new Date("2026-08-16T00:00:00Z"), null)).toBeNull();
  });

  it("sugere o lote comercial pela máscara configurada", () => {
    expect(
      suggestBusinessLotNumber({
        producedAt: new Date("2026-03-10T00:00:00Z"),
        productBusinessLotCode: "0340",
        customerBusinessLotSuffix: "A3",
      }),
    ).toBe("26030340A3");
    // Sem configuração de produto não existe sugestão — o usuário informa.
    expect(
      suggestBusinessLotNumber({
        producedAt: new Date("2026-03-10T00:00:00Z"),
        productBusinessLotCode: null,
        customerBusinessLotSuffix: "A3",
      }),
    ).toBeNull();
  });
});

describe("Documentos controlados", () => {
  it("nova revisão inativa a anterior e não reescreve OP já liberada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const revision1 = await createRevision(app, "PRODUCTION_ORDER", `R1-${shortMarker()}`);
    expect(revision1.documentCode).toBe("R.PRO.002");
    expect(revision1.active).toBe(true);

    const ingredient = await createItem("RAW_MATERIAL");
    await receiveStock(ingredient.id, "100");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10");
    expect(order.productionOrderRevision.id).toBe(revision1.id);

    const revision2 = await createRevision(app, "PRODUCTION_ORDER", `R2-${shortMarker()}`);
    const reread = (
      await app.inject({ method: "GET", url: `/production-orders/${order.id}` })
    ).json();
    // OP liberada continua na revisão da época.
    expect(reread.productionOrderRevision.id).toBe(revision1.id);

    const { product: product2 } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order2 = await createReleasedOrder(app, product2.id, "10");
    expect(order2.productionOrderRevision.id).toBe(revision2.id);

    // Revisão antiga continua existindo, apenas inativa.
    const revisions = (await app.inject({ method: "GET", url: "/controlled-documents" })).json();
    const stored = revisions.revisions.find(
      (row: { id: string }) => row.id === revision1.id,
    );
    expect(stored.active).toBe(false);

    await app.close();
  });
});

describe("Ordem de Produção industrial", () => {
  it("numeração oficial é sequencial por ano e só nasce no RELEASE", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const ingredient = await createItem("RAW_MATERIAL");
    await receiveStock(ingredient.id, "1000");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);

    const draft = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: product.id, plannedQuantity: "10" },
      })
    ).json();
    fixtureProductionOrderIds.push(draft.id);
    // Rascunho não gasta numeração oficial.
    expect(draft.officialNumber).toBeNull();

    await app.inject({ method: "POST", url: `/production-orders/${draft.id}/plan` });
    const releasedA = (
      await app.inject({ method: "POST", url: `/production-orders/${draft.id}/release` })
    ).json();

    const { product: productB } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const releasedB = await createReleasedOrder(app, productB.id, "10");

    // O contador é global do ano (outros arquivos da suíte também liberam
    // OPs em paralelo): o que se garante é o formato, o ano e a ordem.
    const suffix = String(new Date().getFullYear()).slice(-2);
    const pattern = /^(\d{3,})\/(\d{2})$/;
    const matchA = pattern.exec(releasedA.officialNumber as string);
    const matchB = pattern.exec(releasedB.officialNumber as string);
    expect(matchA).not.toBeNull();
    expect(matchB).not.toBeNull();
    expect(matchA![2]).toBe(suffix);
    expect(Number(matchB![1])).toBeGreaterThan(Number(matchA![1]));

    await app.close();
  });

  it("duas liberações concorrentes nunca recebem o mesmo número", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const ingredient = await createItem("RAW_MATERIAL");
    await receiveStock(ingredient.id, "1000");

    const orders = await Promise.all(
      [1, 2, 3].map(async () => {
        const { product } = await createProductWithFormulation(app, [
          { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
        ]);
        const created = (
          await app.inject({
            method: "POST",
            url: "/production-orders",
            payload: { productId: product.id, plannedQuantity: "5" },
          })
        ).json();
        fixtureProductionOrderIds.push(created.id);
        await app.inject({ method: "POST", url: `/production-orders/${created.id}/plan` });
        return created.id;
      }),
    );

    const released = await Promise.all(
      orders.map((id) => app.inject({ method: "POST", url: `/production-orders/${id}/release` })),
    );
    const numbers = released.map((response) => response.json().officialNumber);
    expect(new Set(numbers).size).toBe(numbers.length);

    await app.close();
  });

  it("congela o snapshot do cliente: editar o cadastro depois não muda a OP", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const customer = await createCustomer();
    const ingredient = await createItem("RAW_MATERIAL");
    await receiveStock(ingredient.id, "100");
    const { product } = await createProductWithFormulation(
      app,
      [{ itemId: ingredient.id, quantity: "1", unitCode: "kg" }],
      { customerId: customer.id },
    );
    const order = await createReleasedOrder(app, product.id, "10");

    expect(order.customerStreet).toBe("Avenida Paulista");
    expect(order.customerCity).toBe("São Paulo");

    await app.inject({
      method: "PATCH",
      url: `/customers/${customer.id}`,
      payload: { street: "Rua Nova", number: "42", city: "Campinas" },
    });

    const reread = (await app.inject({ method: "GET", url: `/production-orders/${order.id}` })).json();
    expect(reread.customerStreet).toBe("Avenida Paulista");
    expect(reread.customerCity).toBe("São Paulo");

    await app.close();
  });

  it("partes e instruções de rótulo congelam no RELEASE", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const ingredient = await createItem("RAW_MATERIAL");
    await receiveStock(ingredient.id, "100");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);

    const created = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: {
          productId: product.id,
          plannedQuantity: "30",
          numberOfParts: 3,
          labelInstructions: "Rótulo azul, lote em duas linhas",
        },
      })
    ).json();
    fixtureProductionOrderIds.push(created.id);
    expect(created.numberOfParts).toBe(3);

    await app.inject({ method: "POST", url: `/production-orders/${created.id}/plan` });
    await app.inject({ method: "POST", url: `/production-orders/${created.id}/release` });

    const changeParts = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.id}`,
      payload: { numberOfParts: 5 },
    });
    expect(changeParts.statusCode).toBe(400);

    const changeLabel = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.id}`,
      payload: { labelInstructions: "outro texto" },
    });
    expect(changeLabel.statusCode).toBe(400);

    const recipe = (await app.inject({ method: "GET", url: `/production-orders/${created.id}/recipe` })).json();
    expect(recipe.parts).toHaveLength(3);
    // Matéria-prima é fracionada; a soma das partes fecha o total.
    const planned = recipe.parts.map((part: { requirements: { plannedQuantity: string }[] }) =>
      new Prisma.Decimal(part.requirements[0]!.plannedQuantity),
    );
    expect(planned.reduce((sum: Prisma.Decimal, value: Prisma.Decimal) => sum.plus(value), new Prisma.Decimal(0)).toString()).toBe("30");

    await app.close();
  });
});

describe("Folha de Receita", () => {
  it("pesagem registra usuário da sessão, gera consumo e baixa estoque uma única vez", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const prisma = getPrisma();
    const { user } = await createAuthenticatedUser("PRODUCTION");

    const ingredient = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(ingredient.id, "50");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10", 2);

    const recipe = (await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })).json();
    const part1 = recipe.parts[0];
    expect(part1.requirements[0].plannedQuantity).toBe("5");

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: {
        requirementId: part1.requirements[0].requirementId,
        lotCode: lot.code,
        actualQuantity: "5",
        // Tentativa de forjar o operador: o backend ignora o que vem do
        // cliente e usa a sessão.
        executedByUserId: "outro-usuario",
        executedBy: "Administrador",
      },
    });
    expect(response.statusCode).toBe(201);

    const weighing = await prisma.recipeWeighing.findFirstOrThrow({
      where: { productionOrderPart: { productionOrderId: order.id } },
    });
    expect(weighing.executedByUserId).toBe(user.id);
    expect(weighing.executedByNameSnapshot).toBe(user.name);
    expect(weighing.productionConsumptionId).not.toBeNull();

    const movements = await prisma.inventoryMovement.findMany({
      where: { lotId: lot.id, type: "PRODUCTION_CONSUMPTION" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantity.toString()).toBe("5");

    // Confirmar de novo a MESMA pesagem não gera segunda baixa.
    const confirmAgain = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/weighings/${weighing.id}/confirm`,
    });
    expect(confirmAgain.statusCode).toBe(200);
    expect(
      await prisma.inventoryMovement.count({ where: { lotId: lot.id, type: "PRODUCTION_CONSUMPTION" } }),
    ).toBe(1);
    expect(
      await prisma.recipeWeighing.count({
        where: { productionOrderPart: { productionOrderId: order.id } },
      }),
    ).toBe(1);

    await app.close();
  });

  it("uma parte aceita vários lotes do mesmo material", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const ingredient = await createItem("RAW_MATERIAL");
    const lotA = await receiveStock(ingredient.id, "3");
    const lotB = await receiveStock(ingredient.id, "7");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10", 2);

    const recipe = (await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })).json();
    const requirementId = recipe.parts[0].requirements[0].requirementId;

    const first = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lotA.code, actualQuantity: "3" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lotB.code, actualQuantity: "2" },
    });
    expect(second.statusCode).toBe(201);

    const sheet = second.json();
    expect(sheet.parts[0].weighings).toHaveLength(2);
    expect(sheet.parts[0].requirements[0].weighedQuantity).toBe("5");
    expect(sheet.parts[0].requirements[0].differenceQuantity).toBe("0");

    await app.close();
  });

  it("lote bloqueado/aguardando liberação é recusado na pesagem", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const prisma = getPrisma();

    const ingredient = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(ingredient.id, "50");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10");
    const recipe = (await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })).json();
    const requirementId = recipe.parts[0].requirements[0].requirementId;

    await prisma.lot.update({ where: { id: lot.id }, data: { status: "BLOCKED" } });
    const blocked = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lot.code, actualQuantity: "5" },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe("lot_not_eligible");

    await prisma.lot.update({ where: { id: lot.id }, data: { status: "AVAILABLE" } });
    const allowed = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lot.code, actualQuantity: "5" },
    });
    expect(allowed.statusCode).toBe(201);

    await app.close();
  });

  it("material do cliente só aceita lote do próprio cliente", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const prisma = getPrisma();

    const customerA = await createCustomer();
    const customerB = await createCustomer();
    const ingredient = await createItem("RAW_MATERIAL");

    const lotA = await receiveStock(ingredient.id, "50");
    const lotB = await receiveStock(ingredient.id, "50");
    await prisma.lot.update({
      where: { id: lotA.id },
      data: { ownerType: "CUSTOMER", ownerCustomerId: customerA.id },
    });
    await prisma.lot.update({
      where: { id: lotB.id },
      data: { ownerType: "CUSTOMER", ownerCustomerId: customerB.id },
    });

    const finishedItem = await createItem("FINISHED_PRODUCT", { unitCode: "un", controlsExpiry: true });
    const product = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: {
          name: `Produto Cliente GMP ${marker()}`,
          finishedProductItemId: finishedItem.id,
          customerId: customerA.id,
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
      payload: {
        basisQuantity: "1",
        components: [
          {
            itemId: ingredient.id,
            quantity: "1",
            unitCode: "kg",
            supplyResponsibility: "CUSTOMER",
          },
        ],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const order = await createReleasedOrder(app, product.id, "10");
    const recipe = (await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })).json();
    const requirementId = recipe.parts[0].requirements[0].requirementId;

    const wrongOwner = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lotB.code, actualQuantity: "5" },
    });
    expect(wrongOwner.statusCode).toBe(400);
    expect(wrongOwner.json().error).toBe("lot_owner_mismatch");

    const rightOwner = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lotA.code, actualQuantity: "5" },
    });
    expect(rightOwner.statusCode).toBe(201);

    await app.close();
  });

  it("parte sem pesagem não conclui; com pesagem conclui registrando o usuário", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();
    const { user } = await createAuthenticatedUser("PRODUCTION");

    const ingredient = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(ingredient.id, "50");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10", 2);
    const recipe = (await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })).json();
    const requirementId = recipe.parts[0].requirements[0].requirementId;

    const tooEarly = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/complete`,
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json().error).toBe("unweighed_requirement");

    // Pesagem com diferença: 4,8 em vez de 5 — registrada, não bloqueada.
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/weighings`,
      payload: { requirementId, lotCode: lot.code, actualQuantity: "4.8" },
    });

    const completed = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/parts/1/complete`,
    });
    expect(completed.statusCode).toBe(200);
    const part = completed.json().parts[0];
    expect(part.status).toBe("COMPLETED");
    expect(part.completedByName).toBe(user.name);
    expect(part.requirements[0].differenceQuantity).toBe("-0.2");

    await app.close();
  });

  it("OP de 1 parte sem folha de receita continua no fluxo antigo", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const ingredient = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(ingredient.id, "50");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10");
    expect(order.numberOfParts).toBe(1);

    const line = order.reservation.lines[0];
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: lot.code },
    });
    const consumption = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "10" }] },
    });
    expect(consumption.statusCode).toBe(201);
    expect(consumption.json().status).toBe("IN_PRODUCTION");

    await app.close();
  });

  it("folha de receita informa o saldo reservado que sobrou depois do Consumo Real", async () => {
    const app = buildTestApp("PRODUCTION");
    await app.ready();

    const ingredient = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(ingredient.id, "50");
    const { product } = await createProductWithFormulation(app, [
      { itemId: ingredient.id, quantity: "1", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "10");
    const line = order.reservation.lines[0];

    const before = (
      await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })
    ).json();
    expect(before.parts[0].requirements[0].reservedLots[0].remainingQuantity).toBe("10");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: lot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "10" }] },
    });

    // A linha reservada continua listada — é ela que o papel mostra. O que
    // muda é o saldo: sem `remainingQuantity` a tela só descobria que não
    // havia mais reserva depois de a pesagem ser recusada.
    const after = (
      await app.inject({ method: "GET", url: `/production-orders/${order.id}/recipe` })
    ).json();
    const reserved = after.parts[0].requirements[0].reservedLots[0];
    expect(reserved.quantity).toBe("10");
    expect(Number(reserved.remainingQuantity)).toBe(0);

    await app.close();
  });
});
