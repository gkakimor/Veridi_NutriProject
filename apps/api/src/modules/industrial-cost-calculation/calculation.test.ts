import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 45 — cálculo do custo industrial.
 *
 * O que estes testes protegem: média ponderada (nunca simples), a
 * hierarquia 30d → 90d → último real → oferta elegível → sem custo, oferta
 * como estimativa e nunca como custo real, ausência de escolha automática
 * entre fornecedores, material do cliente excluído (não zerado), total
 * parcial inexistente, snapshot imutável e a separação entre material
 * realizado e custo padrão aplicado numa OP.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();

  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOrderCostSnapshot.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
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
    if (reservations.length > 0) {
      const reservationIds = reservations.map((row) => row.id);
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.productionOrderPart.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }

  if (fixtureProductIds.length > 0) {
    // Precificação cita cálculo: sai primeiro, senão a FK barra.
    await prisma.pricingTier.deleteMany({
      where: { pricingVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.pricingVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.industrialCostCalculation.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }

  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }

  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItem: { itemId: { in: fixtureItemIds } } },
    });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  unitCode = "kg",
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-CAL-${m}`,
      name: `Item Cálculo ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-CAL-${m}`, legalName: `Fornecedor Cálculo ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function receiveWithCost(
  app: App,
  params: {
    supplierId: string;
    itemId: string;
    quantity: string;
    unitCost?: string;
    receivedAt?: Date;
  },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: (params.receivedAt ?? new Date()).toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marker()}`,
            ...(params.unitCost ? { actualUnitCost: params.unitCost } : {}),
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
  return receipt;
}

/** Relação homologada com oferta vigente em BRL. */
async function approveSupplierWithOffer(
  itemId: string,
  params: {
    supplierId: string;
    unitPrice: string;
    priceUomCode?: string;
    preferred?: boolean;
    effectiveAt?: Date | null;
  },
) {
  const prisma = getPrisma();
  const supplierItem = await prisma.supplierItem.create({
    data: {
      itemId,
      supplierId: params.supplierId,
      qualificationStatus: "APPROVED",
      preferred: params.preferred ?? false,
      active: true,
    },
  });
  await prisma.supplierItemOffer.create({
    data: {
      supplierItemId: supplierItem.id,
      unitPrice: params.unitPrice,
      currencyCode: "BRL",
      priceUomCode: params.priceUomCode ?? "kg",
      effectiveAt: params.effectiveAt === undefined ? new Date(Date.now() - DAY_MS) : params.effectiveAt,
      source: params.effectiveAt === null ? "LEGACY_IMPORT" : "MANUAL",
    },
  });
  return supplierItem;
}

async function createResource(
  app: App,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
  payload: Record<string, unknown> = {},
  rate?: string,
) {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Recurso ${type} ${marker()}`, type, ...payload },
    })
  ).json();
  fixtureResourceIds.push(resource.id);
  if (rate) {
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${resource.id}/rates`,
      payload: { rateValue: rate },
    });
  }
  return resource;
}

interface StructureOptions {
  components: { itemId: string; quantity: string; unitCode: string; customer?: boolean }[];
  referenceOutputQuantity?: string;
  unitsPerShippingBox?: number;
  basisQuantity?: string;
}

/** Produto + formulação ativa + estrutura de custos em rascunho. */
async function createStructure(app: App, options: StructureOptions) {
  const prisma = getPrisma();
  const m = marker();
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");

  // Material do cliente só existe em produto que tem cliente.
  const customer = options.components.some((component) => component.customer)
    ? await prisma.customer.create({
        data: { code: `CLI-CAL-${m}`, legalName: `Cliente Cálculo ${m}`, active: true },
      })
    : null;
  if (customer) fixtureCustomerIds.push(customer.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto Cálculo ${m}`,
        finishedProductItemId: finishedItem.id,
        ...(customer ? { customerId: customer.id } : {}),
        ...(options.unitsPerShippingBox
          ? { unitsPerShippingBox: options.unitsPerShippingBox }
          : {}),
      },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const formulation = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulation.id}`,
    payload: {
      basisQuantity: options.basisQuantity ?? "1",
      components: options.components.map((component) => ({
        itemId: component.itemId,
        quantity: component.quantity,
        unitCode: component.unitCode,
        ...(component.customer ? { supplyResponsibility: "CUSTOMER" } : {}),
      })),
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: options.referenceOutputQuantity ?? "1000" },
    })
  ).json();

  return { product, formulationVersionId: formulation.id, version, finishedItem };
}

/** Energia informada diretamente — o caminho mais simples de fechar o custo. */
async function configureDirectEnergy(
  app: App,
  versionId: string,
  kwh: string,
  rate: string,
) {
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${versionId}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  const energy = await createResource(app, "ENERGY", {}, rate);
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${versionId}/resource-usages`,
    payload: { resourceId: energy.id, usageQuantity: kwh },
  });
  return energy;
}

async function calculate(app: App, versionId: string, referenceDate?: Date) {
  const query = referenceDate ? `?referenceDate=${referenceDate.toISOString()}` : "";
  return (
    await app.inject({ method: "GET", url: `/industrial-costs/${versionId}/calculate${query}` })
  ).json();
}


/** OP planejada, liberada, com picking/consumo confirmados e output. */
async function produceOrder(
  app: App,
  params: { productId: string; plannedQuantity: string; outputQuantity?: string },
) {
  const order = (
    await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: params.productId, plannedQuantity: params.plannedQuantity },
    })
  ).json();
  fixtureProductionOrderIds.push(order.id);

  await app.inject({ method: "POST", url: `/production-orders/${order.id}/plan` });
  const released = (
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/release` })
  ).json();

  for (const requirement of released.requirements ?? []) {
    for (const line of requirement.reservationLines ?? []) {
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

  if (params.outputQuantity) {
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: {
        quantity: params.outputQuantity,
        destination: "NEW_LOT",
        businessLotNumber: `VD-CAL-${marker()}`.slice(0, 20),
      },
    });
  }

  return order.id as string;
}

async function orderCost(app: App, orderId: string) {
  return (await app.inject({ method: "GET", url: `/production-orders/${orderId}/cost` })).json();
}


describe("Descartar cálculo salvo", () => {
  it("descarta o que ninguém cita e recusa o que é base de uma precificação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    /*
     * O alvo é criado aqui. Procurar no banco um cálculo "que ninguém cita"
     * e apagá-lo achava dado real: este banco é o mesmo do app local, e o
     * cálculo recém-salvo de um produto em definição é exatamente o que
     * ainda não tem precificação apontando para ele. Teste destrutivo só
     * apaga o que o próprio teste criou.
     */
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: (await createSupplier()).id,
      itemId: material.id,
      quantity: "100",
      unitCost: "10",
    });
    const criada = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
      referenceOutputQuantity: "100",
    });
    const { product, version } = criada;
    expect(version.id, JSON.stringify(version)).toBeTruthy();
    // Só estrutura ativa produz cálculo salvo.
    const ativada = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(ativada.statusCode, ativada.body).toBe(200);

    const alvo = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: {},
      })
    ).json();
    expect(alvo.id, JSON.stringify(alvo)).toBeTruthy();

    const apagado = await app.inject({
      method: "DELETE",
      url: `/industrial-cost-calculations/${alvo.id}`,
    });
    expect(apagado.statusCode, apagado.body).toBe(204);
    expect(
      await prisma.industrialCostCalculation.findUnique({ where: { id: alvo.id } }),
    ).toBeNull();

    // Base de um preço não é descartável: apagá-la deixaria a faixa sem
    // origem verificável.
    const citado = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: {},
      })
    ).json();
    const precificacao = await app.inject({
      method: "POST",
      url: `/products/${product.id}/pricing`,
      payload: { industrialCostCalculationId: citado.id },
    });
    expect(precificacao.statusCode, precificacao.body).toBe(201);

    const recusado = await app.inject({
      method: "DELETE",
      url: `/industrial-cost-calculations/${citado.id}`,
    });
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("calculation_in_use");
    expect(
      await prisma.industrialCostCalculation.findUnique({ where: { id: citado.id } }),
    ).not.toBeNull();

    await app.close();
  });
});

describe("Custo padrão — referência de material", () => {
  it("usa média PONDERADA por quantidade nos últimos 30 dias", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "10",
      unitCost: "100",
    });
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "20",
      unitCost: "130",
    });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
      referenceOutputQuantity: "1000",
    });
    const result = await calculate(app, version.id);

    // (10×100 + 20×130) / 30 = 120 — nunca a média simples 115.
    expect(result.materials[0].unitCost).toBe("120.000000");
    expect(result.materials[0].costSource).toBe("WEIGHTED_AVG_30D");
    // 1 kg por unidade × 1000 unidades × 120.
    expect(result.materials[0].subtotal).toBe("120000.00");

    await app.close();
  });

  it("cai para 90 dias e depois para o último custo real", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const only90 = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: only90.id,
      quantity: "10",
      unitCost: "50",
      receivedAt: new Date(Date.now() - 45 * DAY_MS),
    });

    const structure90 = await createStructure(app, {
      components: [{ itemId: only90.id, quantity: "1", unitCode: "kg" }],
    });
    const result90 = await calculate(app, structure90.version.id);
    expect(result90.materials[0].costSource).toBe("WEIGHTED_AVG_90D");
    expect(result90.materials[0].unitCost).toBe("50.000000");

    const old = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: old.id,
      quantity: "10",
      unitCost: "70",
      receivedAt: new Date(Date.now() - 200 * DAY_MS),
    });
    const structureOld = await createStructure(app, {
      components: [{ itemId: old.id, quantity: "1", unitCode: "kg" }],
    });
    const resultOld = await calculate(app, structureOld.version.id);
    expect(resultOld.materials[0].costSource).toBe("LAST_REAL");
    expect(resultOld.materials[0].unitCost).toBe("70.000000");

    await app.close();
  });

  it("respeita a data de referência — compra posterior não valoriza o passado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "10",
      unitCost: "80",
      receivedAt: new Date(Date.now() - 10 * DAY_MS),
    });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });

    const before = await calculate(app, version.id, new Date(Date.now() - 20 * DAY_MS));
    expect(before.materials[0].unitCost).toBeNull();
    expect(before.materials[0].costSource).toBe("NO_COST");

    const after = await calculate(app, version.id);
    expect(after.materials[0].unitCost).toBe("80.000000");

    await app.close();
  });
});

describe("Custo padrão — oferta de fornecedor como estimativa", () => {
  it("usa a oferta do fornecedor preferencial quando não há compra real", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const material = await createItem("RAW_MATERIAL");
    const preferred = await createSupplier();
    const other = await createSupplier();
    await approveSupplierWithOffer(material.id, {
      supplierId: preferred.id,
      unitPrice: "40",
      preferred: true,
    });
    await approveSupplierWithOffer(material.id, { supplierId: other.id, unitPrice: "35" });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });
    await configureDirectEnergy(app, version.id, "10", "1");
    const result = await calculate(app, version.id);

    // Preferencial vence o mais barato: homologação é decisão comercial.
    expect(result.materials[0].costSource).toBe("SUPPLIER_OFFER_PREFERRED");
    expect(result.materials[0].unitCost).toBe("40.000000");
    expect(result.quality).toBe("COMPLETE_WITH_ESTIMATES");

    await app.close();
  });

  it("usa a oferta quando existe exatamente um homologado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const material = await createItem("RAW_MATERIAL");
    const supplier = await createSupplier();
    await approveSupplierWithOffer(material.id, { supplierId: supplier.id, unitPrice: "25" });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });
    const result = await calculate(app, version.id);
    expect(result.materials[0].costSource).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(result.materials[0].unitCost).toBe("25.000000");

    await app.close();
  });

  it("não escolhe o menor preço entre vários homologados sem preferencial", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const material = await createItem("RAW_MATERIAL");
    const a = await createSupplier();
    const b = await createSupplier();
    await approveSupplierWithOffer(material.id, { supplierId: a.id, unitPrice: "40" });
    await approveSupplierWithOffer(material.id, { supplierId: b.id, unitPrice: "30" });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });
    const result = await calculate(app, version.id);

    expect(result.materials[0].costSource).toBe("AMBIGUOUS_SUPPLIER_REFERENCE");
    expect(result.materials[0].unitCost).toBeNull();
    expect(result.totalIndustrialCost).toBeNull();
    expect(
      result.warnings.some(
        (warning: { code: string }) => warning.code === "AMBIGUOUS_SUPPLIER_REFERENCE",
      ),
    ).toBe(true);

    await app.close();
  });

  it("ignora oferta legada sem vigência", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const material = await createItem("RAW_MATERIAL");
    const supplier = await createSupplier();
    await approveSupplierWithOffer(material.id, {
      supplierId: supplier.id,
      unitPrice: "18",
      effectiveAt: null,
    });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });
    const result = await calculate(app, version.id);

    // Ser o único número disponível não transforma histórico em custo.
    expect(result.materials[0].costSource).toBe("NO_COST");
    expect(result.materials[0].unitCost).toBeNull();

    await app.close();
  });
});

describe("Custo padrão — composição", () => {
  it("exclui material do cliente sem zerar nem degradar a qualidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const veridi = await createItem("RAW_MATERIAL");
    const fromCustomer = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: veridi.id,
      quantity: "100",
      unitCost: "10",
    });

    const { version } = await createStructure(app, {
      components: [
        { itemId: veridi.id, quantity: "0.5", unitCode: "kg" },
        { itemId: fromCustomer.id, quantity: "0.2", unitCode: "kg", customer: true },
      ],
      referenceOutputQuantity: "1000",
    });
    await configureDirectEnergy(app, version.id, "10", "1");

    const result = await calculate(app, version.id);
    const customerLine = result.materials.find(
      (line: { customerSupplied: boolean }) => line.customerSupplied,
    );

    expect(customerLine.costSource).toBe("EXCLUDED_CUSTOMER_SUPPLIED");
    expect(customerLine.subtotal).toBeNull();
    expect(result.hasCustomerSuppliedMaterials).toBe(true);
    expect(result.customerSuppliedMaterials).toHaveLength(1);
    // 0,5 kg × 1000 × R$ 10 — o material do cliente não entra e não estraga.
    expect(result.materialsSubtotalKnown).toBe("5000.00");
    expect(result.quality).toBe("COMPLETE_REAL_REFERENCE");

    await app.close();
  });

  it("calcula mão de obra, equipamento e energia derivada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "100",
      unitCost: "1",
    });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.001", unitCode: "kg" }],
      referenceOutputQuantity: "1000",
    });

    const labor = await createResource(app, "LABOR", {}, "30");
    const equipment = await createResource(app, "EQUIPMENT", { powerKw: "4" }, "85");
    const energy = await createResource(app, "ENERGY", {}, "1");

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: labor.id, usageQuantity: "2.5" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: equipment.id, usageQuantity: "1.8" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      // A tarifa do kWh derivado é ESCOLHIDA: o sistema nunca elege um
      // recurso de energia sozinho.
      payload: { energyCalculationMode: "FROM_EQUIPMENT", energyResourceId: energy.id },
    });

    const result = await calculate(app, version.id);

    expect(result.laborSubtotalKnown).toBe("75.00"); // 2,5 h × 30
    expect(result.equipmentSubtotalKnown).toBe("153.00"); // 1,8 h × 85
    // 1,8 h × 4 kW = 7,2 kWh × R$ 1,00.
    expect(result.derivedEnergyKwh).toBe("7.2");
    expect(result.energySubtotal).toBe("7.20");

    await app.close();
  });

  it("energia não configurada deixa o custo parcial — nunca zero", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "100",
      unitCost: "2",
    });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.01", unitCode: "kg" }],
    });
    const result = await calculate(app, version.id);

    expect(result.energySubtotal).toBeNull();
    expect(result.quality).toBe("PARTIAL");
    expect(result.totalIndustrialCost).toBeNull();
    expect(Number(result.knownSubtotal)).toBeGreaterThan(0);
    expect(
      result.warnings.some((warning: { code: string }) => warning.code === "ENERGY_NOT_CONFIGURED"),
    ).toBe(true);

    await app.close();
  });

  it("conta caixas inteiras, aplica percentual sobre o custo direto e fecha o total", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "1000",
      unitCost: "1",
    });

    // 25 unidades, 12 por caixa → 3 caixas (ninguém expede 2,08 caixas).
    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.02", unitCode: "kg" }],
      referenceOutputQuantity: "25",
      unitsPerShippingBox: 12,
    });

    await configureDirectEnergy(app, version.id, "10", "1");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "SECONDARY_PACKAGING",
        description: "Caixa de expedição",
        calculationBasis: "PER_SHIPPING_BOX",
        rateValue: "5",
      },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "OVERHEAD",
        description: "Rateio industrial",
        calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
        rateValue: "10",
      },
    });

    const result = await calculate(app, version.id);
    const boxLine = result.manualLines.find(
      (line: { calculationBasis: string }) => line.calculationBasis === "PER_SHIPPING_BOX",
    );

    expect(boxLine.computedUnits).toBe("3");
    expect(boxLine.subtotal).toBe("15.00");
    // material 0,02 × 25 × 1 = 0,50 + energia 10 + caixas 15 = 25,50.
    expect(result.directIndustrialCost).toBe("25.50");
    expect(result.overheadSubtotalKnown).toBe("2.55");
    expect(result.totalIndustrialCost).toBe("28.05");
    expect(result.costPerUnit).toBe("1.122000");
    expect(result.costPer1000).toBe("1122.00");
    expect(result.quality).toBe("COMPLETE_REAL_REFERENCE");

    await app.close();
  });

  it("mantém o subtotal conhecido quando algo falta, sem chamá-lo de total", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const known = await createItem("RAW_MATERIAL");
    const unknown = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: known.id,
      quantity: "100",
      unitCost: "10",
    });

    const { version } = await createStructure(app, {
      components: [
        { itemId: known.id, quantity: "0.1", unitCode: "kg" },
        { itemId: unknown.id, quantity: "0.1", unitCode: "kg" },
      ],
      referenceOutputQuantity: "100",
    });

    const result = await calculate(app, version.id);
    expect(result.totalIndustrialCost).toBeNull();
    expect(result.directIndustrialCost).toBeNull();
    expect(result.knownSubtotal).toBe("100.00");
    expect(result.costPerUnit).toBeNull();
    expect(result.quality).toBe("PARTIAL");

    await app.close();
  });
});

describe("Cálculos salvos", () => {
  it("congela o resultado — recalcular depois pode mudar, o snapshot não", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "100",
      unitCost: "10",
    });

    const { product, version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
      referenceOutputQuantity: "10",
    });

    const saved = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: {},
      })
    ).json();
    expect(saved.code.startsWith("CALC-")).toBe(true);
    expect(saved.materials[0].unitCost).toBe("10.000000");
    expect(saved.structureStatusAtCalculation).toBe("DRAFT");

    // Nova compra muda a referência de hoje em diante.
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "100",
      unitCost: "30",
    });

    const reread = (
      await app.inject({ method: "GET", url: `/industrial-cost-calculations/${saved.id}` })
    ).json();
    expect(reread.materials[0].unitCost).toBe("10.000000");

    const recalculated = await calculate(app, version.id);
    expect(recalculated.materials[0].unitCost).toBe("20.000000");

    const history = (
      await app.inject({ method: "GET", url: `/products/${product.id}/cost-calculations` })
    ).json();
    expect(history.calculations).toHaveLength(1);
    expect(history.calculations[0].code).toBe(saved.code);

    await app.close();
  });

  it("perfis sem escrita não salvam cálculo, mas consultam", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const production = buildTestApp("PRODUCTION");
    await production.ready();

    const material = await createItem("RAW_MATERIAL");
    const { version } = await createStructure(admin, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });

    const blocked = await production.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: {},
    });
    expect(blocked.statusCode).toBe(403);

    const read = await production.inject({
      method: "GET",
      url: `/industrial-costs/${version.id}/calculate`,
    });
    expect(read.statusCode).toBe(200);

    await admin.close();
    await production.close();
  });
});

describe("Custo industrial da produção", () => {
  it("vincula a EC compatível no release e separa material realizado de custo padrão aplicado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "500",
      unitCost: "10",
    });

    const { product, version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
      referenceOutputQuantity: "1000",
    });
    const labor = await createResource(app, "LABOR", {}, "30");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: labor.id, usageQuantity: "10" },
    });
    await configureDirectEnergy(app, version.id, "100", "1");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: {},
    });

    const orderId = await produceOrder(app, {
      productId: product.id,
      plannedQuantity: "500",
      outputQuantity: "500",
    });
    const cost = await orderCost(app, orderId);

    expect(cost.industrialCostVersionId).toBe(version.id);
    // Produzido 500 sobre base 1000: os custos padrão entram pela metade.
    expect(cost.allocationFactor).toBe("0.5");
    expect(cost.standardAppliedLaborKnown).toBe("150.00"); // 10 h × 0,5 × 30
    expect(cost.standardAppliedEnergy).toBe("50.00"); // 100 kWh × 0,5 × 1
    // 500 un × 0,1 kg × R$ 10 = R$ 500 de material realmente consumido.
    expect(cost.actualMaterialCostKnown).toBe("500.00");
    expect(cost.totalIndustrialCost).toBe("700.00");
    expect(cost.costPerProducedUnit).toBe("1.400000");
    expect(cost.hybrid).toBe(true);
    expect(cost.status).toBe("PROVISIONAL");
    expect(cost.materials[0].costSource).toBe("REAL");

    await app.close();
  });

  it("não vincula EC de outra formulação e mantém a produção possível", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "500",
      unitCost: "4",
    });

    const { product, version, formulationVersionId } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
      referenceOutputQuantity: "1000",
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });

    // Nova formulação ativa: a EC ativa continua apontando para a anterior.
    const next = (
      await app.inject({
        method: "POST",
        url: `/formulation-versions/${formulationVersionId}/new-version`,
        payload: {},
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${next.id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: material.id, quantity: "0.2", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${next.id}/activate` });

    const orderId = await produceOrder(app, {
      productId: product.id,
      plannedQuantity: "100",
      outputQuantity: "100",
    });
    const cost = await orderCost(app, orderId);

    // Custo material existe; os industriais ficam declaradamente ausentes.
    expect(cost.industrialCostVersionId).toBeNull();
    expect(Number(cost.actualMaterialCostKnown)).toBeGreaterThan(0);
    expect(cost.totalIndustrialCost).toBeNull();
    expect(cost.quality).toBe("PARTIAL");
    expect(
      cost.warnings.some((warning: { code: string }) => warning.code === "NO_COST_STRUCTURE"),
    ).toBe(true);

    await app.close();
  });

  it("congela o custo na conclusão e não recalcula depois", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "500",
      unitCost: "10",
    });

    const { product, version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
      referenceOutputQuantity: "100",
    });
    const labor = await createResource(app, "LABOR", {}, "20");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: labor.id, usageQuantity: "2" },
    });
    await configureDirectEnergy(app, version.id, "10", "1");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: {},
    });

    const orderId = await produceOrder(app, {
      productId: product.id,
      plannedQuantity: "100",
      outputQuantity: "100",
    });
    const completed = await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/complete`,
      payload: {},
    });
    expect(completed.statusCode).toBe(200);

    const cost = await orderCost(app, orderId);
    expect(cost.status).toBe("FINAL");
    expect(cost.snapshotId).toBeTruthy();
    const frozenTotal = cost.totalIndustrialCost;

    // Reajustar a tarifa e informar novos custos de compra depois NÃO
    // reescreve o que esta produção custou.
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${labor.id}/rates`,
      payload: { rateValue: "90" },
    });
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "500",
      unitCost: "99",
    });

    const reread = await orderCost(app, orderId);
    expect(reread.totalIndustrialCost).toBe(frozenTotal);

    // Concluir de novo (retry) nunca cria um segundo snapshot.
    await app.inject({ method: "POST", url: `/production-orders/${orderId}/complete`, payload: {} });
    expect(
      await prisma.productionOrderCostSnapshot.count({ where: { productionOrderId: orderId } }),
    ).toBe(1);

    await app.close();
  });

  it("sem produção confirmada não existe custo por unidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "500",
      unitCost: "10",
    });

    const { product } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
      referenceOutputQuantity: "100",
    });
    const orderId = await produceOrder(app, { productId: product.id, plannedQuantity: "100" });
    const cost = await orderCost(app, orderId);

    expect(cost.producedQuantity).toBe("0");
    expect(Number(cost.actualMaterialCostKnown)).toBeGreaterThan(0);
    expect(cost.costPerProducedUnit).toBeNull();

    await app.close();
  });

  it("não altera a Foundation of Costs nem preços comerciais", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "100",
      unitCost: "10",
    });

    const { version } = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
    });
    await configureDirectEnergy(app, version.id, "10", "1");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: {},
    });

    // Calcular custo não cria oferta, não mexe em estoque e não precifica.
    // Conferência por item deste teste — contagem global mediria os outros
    // testes rodando em paralelo.
    expect(
      await prisma.supplierItemOffer.count({
        where: { supplierItem: { itemId: material.id } },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.count({
        where: { itemId: material.id, type: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] } },
      }),
    ).toBe(0);
    expect(
      await prisma.receiptLine.count({
        where: { itemId: material.id, actualUnitCost: { not: null } },
      }),
    ).toBe(1);

    await app.close();
  });
});

describe("R-18 — custo industrial por produto", () => {
  it("usa o último cálculo salvo e mostra ausência como ausência", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "100",
      unitCost: "10",
    });

    const withCalculation = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
      referenceOutputQuantity: "10",
    });
    await configureDirectEnergy(app, withCalculation.version.id, "5", "1");
    const saved = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${withCalculation.version.id}/calculations`,
        payload: {},
      })
    ).json();

    const withoutCalculation = await createStructure(app, {
      components: [{ itemId: material.id, quantity: "1", unitCode: "kg" }],
    });

    const rowFor = async (code: string) => {
      const report = (
        await app.inject({
          method: "GET",
          url: `/reports/costs/industrial-by-product?search=${encodeURIComponent(code)}`,
        })
      ).json();
      return report.rows[0];
    };

    const calculated = await rowFor(withCalculation.product.code);
    const pending = await rowFor(withoutCalculation.product.code);

    expect(calculated.calculationCode).toBe(saved.code);
    expect(calculated.totalIndustrialCost).toBe(saved.totalIndustrialCost);
    expect(calculated.costPerUnit).toBe(saved.costPerUnit);
    // Produto sem cálculo salvo não é custo zero: é ausência de análise.
    expect(pending.calculationCode).toBeNull();
    expect(pending.totalIndustrialCost).toBeNull();
    expect(pending.costPerUnit).toBeNull();

    const csv = await app.inject({
      method: "GET",
      url: `/reports/costs/industrial-by-product/export.csv?search=${encodeURIComponent(withCalculation.product.code)}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("Custo industrial total");
    expect(csv.body).toContain(saved.code);

    await app.close();
  });
});
