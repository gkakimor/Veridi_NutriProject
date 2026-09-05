import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * A estimativa de custo da Formulação usa a MESMA seleção canônica de fonte
 * que o cálculo de custo industrial e o CMV (PRODUCT_RULES §53):
 *
 *   compra real 30d → 90d → última compra → oferta válida → referência
 *   manual → desconhecido; ambiguidade em categoria superior é fail-closed.
 *
 * Antes desta rodada ela lia só a fundação de compras, e Formulação e CMV
 * podiam responder custos diferentes para o mesmo item na mesma data. O
 * invariante protegido aqui (caso L) é: mesma fonte e mesmo custo unitário
 * de origem entre a estimativa e o motor de custo.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

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
  if (fixtureProductIds.length > 0) {
    await prisma.industrialCostCalculation.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({ where: { industrialResourceId: { in: fixtureResourceIds } } });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: fixturePurchaseOrderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.supplierItemOffer.deleteMany({ where: { supplierItem: { itemId: { in: fixtureItemIds } } } });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT" = "RAW_MATERIAL", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-EST-${m}`,
      name: `Item Estimativa ${m}`,
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
    data: { code: `FOR-EST-${m}`, legalName: `Fornecedor Estimativa ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost: string; daysAgo: number },
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
        receivedAt: new Date(Date.now() - params.daysAgo * DAY_MS).toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marker()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  expect(receipt.id, JSON.stringify(receipt)).toBeTruthy();
  fixtureReceiptIds.push(receipt.id);
}

async function approveSupplierWithOffer(
  itemId: string,
  params: { supplierId: string; unitPrice: string; preferred?: boolean },
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
      priceUomCode: "kg",
      effectiveAt: new Date(Date.now() - DAY_MS),
      source: "MANUAL",
    },
  });
}

async function setManualReference(app: App, itemId: string, unitCost: string, effectiveFrom?: string) {
  const response = await app.inject({
    method: "POST",
    url: `/items/${itemId}/cost-references`,
    payload: { unitCost, ...(effectiveFrom ? { effectiveFrom } : {}) },
  });
  expect(response.statusCode, response.body).toBe(201);
}

/** Produto + formulação em RASCUNHO com os componentes dados (kg, base 1). */
async function createFormulation(
  app: App,
  components: { itemId: string; quantity: string; customer?: boolean }[],
) {
  const m = marker();
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto Estimativa ${m}`,
        finishedProductItemId: finishedItem.id,
        customerId: await fixtureCustomerId(),
      },
    })
  ).json();
  expect(product.id, JSON.stringify(product)).toBeTruthy();
  fixtureProductIds.push(product.id);

  const version = (
    await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
  ).json();
  const patched = await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${version.id}`,
    payload: {
      basisQuantity: "1",
      components: components.map((c) => ({
        itemId: c.itemId,
        quantity: c.quantity,
        unitCode: "kg",
        ...(c.customer ? { supplyResponsibility: "CUSTOMER" } : {}),
      })),
    },
  });
  expect(patched.statusCode, patched.body).toBe(200);
  return { productId: product.id as string, versionId: version.id as string };
}

async function estimate(app: App, versionId: string, referenceDate?: Date) {
  const query = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate.toISOString())}` : "";
  const response = await app.inject({
    method: "GET",
    url: `/formulation-versions/${versionId}/cost-estimate${query}`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

interface ComponenteDaEstimativa {
  itemId: string;
  unitCost: string | null;
  costSource: string;
  costSourceDetails: string | null;
  customerSupplied: boolean;
  estimatedComponentCost: string | null;
}

function componentOf(dto: { components: ComponenteDaEstimativa[] }, itemId: string) {
  const component = dto.components.find((c) => c.itemId === itemId);
  expect(component, `componente ${itemId} ausente`).toBeTruthy();
  return component!;
}

describe("Custo estimado da Formulação — seleção canônica da fonte", () => {
  it("A. compra real dos últimos 30 dias, ponderada por quantidade, vence tudo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const item = await createItem();
    await setManualReference(app, item.id, "999");
    await approveSupplierWithOffer(item.id, { supplierId: supplier.id, unitPrice: "500" });
    // 10 kg a 100 + 30 kg a 200 = 175 ponderado, não 150 simples.
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "100", daysAgo: 10 });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "30", unitCost: "200", daysAgo: 5 });
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "2" }]);

    const dto = await estimate(app, versionId);
    const linha = componentOf(dto, item.id);
    expect(linha.costSource).toBe("WEIGHTED_AVG_30D");
    expect(linha.unitCost).toBe("175.0000");
    expect(linha.estimatedComponentCost).toBe("350.00");
    expect(dto.quality).toBe("ESTIMATED");
    expect(dto.estimatedMaterialCost).toBe("350.00");
    await app.close();
  });

  it("B. sem compra em 30 dias, a média de 90 dias é a fonte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const item = await createItem();
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "5", unitCost: "80", daysAgo: 60 });
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const linha = componentOf(await estimate(app, versionId), item.id);
    expect(linha.costSource).toBe("WEIGHTED_AVG_90D");
    expect(linha.unitCost).toBe("80.0000");
    await app.close();
  });

  it("C. sem compra nas janelas, a última compra real é a fonte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const item = await createItem();
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "5", unitCost: "70", daysAgo: 200 });
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const linha = componentOf(await estimate(app, versionId), item.id);
    expect(linha.costSource).toBe("LAST_REAL");
    expect(linha.unitCost).toBe("70.0000");
    await app.close();
  });

  it("D. sem compra, a única oferta válida de fornecedor homologado é a fonte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const item = await createItem();
    await approveSupplierWithOffer(item.id, { supplierId: supplier.id, unitPrice: "50" });
    await setManualReference(app, item.id, "45");
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "3" }]);

    const linha = componentOf(await estimate(app, versionId), item.id);
    expect(linha.costSource).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(linha.unitCost).toBe("50.0000");
    expect(linha.estimatedComponentCost).toBe("150.00");
    await app.close();
  });

  it("E. várias ofertas válidas e exatamente um preferencial: usa o preferencial", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const barato = await createSupplier();
    const preferido = await createSupplier();
    const item = await createItem();
    await approveSupplierWithOffer(item.id, { supplierId: barato.id, unitPrice: "40" });
    await approveSupplierWithOffer(item.id, { supplierId: preferido.id, unitPrice: "55", preferred: true });
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const linha = componentOf(await estimate(app, versionId), item.id);
    expect(linha.costSource).toBe("SUPPLIER_OFFER_PREFERRED");
    // Nunca o mais barato por conta própria.
    expect(linha.unitCost).toBe("55.0000");
    await app.close();
  });

  it("F. várias ofertas válidas sem preferencial: seleção necessária, custo desconhecido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const um = await createSupplier();
    const outro = await createSupplier();
    const item = await createItem();
    await approveSupplierWithOffer(item.id, { supplierId: um.id, unitPrice: "40" });
    await approveSupplierWithOffer(item.id, { supplierId: outro.id, unitPrice: "42" });
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const dto = await estimate(app, versionId);
    const linha = componentOf(dto, item.id);
    expect(linha.costSource).toBe("AMBIGUOUS_SUPPLIER_REFERENCE");
    expect(linha.unitCost).toBeNull();
    expect(linha.estimatedComponentCost).toBeNull();
    expect(linha.costSourceDetails).toMatch(/nenhuma está definida como preferencial/);
    expect(dto.quality).toBe("NO_COST");
    expect(dto.ambiguousCostItems).toEqual([item.code]);
    expect(dto.missingCostItems).toEqual([]);
    await app.close();
  });

  it("G. oferta ambígua + referência manual no item: continua ambígua — a manual NÃO entra sozinha", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const um = await createSupplier();
    const outro = await createSupplier();
    const item = await createItem();
    await approveSupplierWithOffer(item.id, { supplierId: um.id, unitPrice: "40" });
    await approveSupplierWithOffer(item.id, { supplierId: outro.id, unitPrice: "42" });
    await setManualReference(app, item.id, "38");
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const dto = await estimate(app, versionId);
    const linha = componentOf(dto, item.id);
    expect(linha.costSource).toBe("AMBIGUOUS_SUPPLIER_REFERENCE");
    expect(linha.unitCost).toBeNull();
    expect(dto.estimatedMaterialCost).toBeNull();
    expect(dto.ambiguousCostItems).toEqual([item.code]);
    await app.close();
  });

  it("H. sem compra nem oferta, a referência manual vigente é a fonte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    await setManualReference(app, item.id, "80");
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "2.5" }]);

    const dto = await estimate(app, versionId);
    const linha = componentOf(dto, item.id);
    expect(linha.costSource).toBe("MANUAL_REFERENCE");
    expect(linha.unitCost).toBe("80.0000");
    expect(linha.estimatedComponentCost).toBe("200.00");
    expect(linha.costSourceDetails).toMatch(/Referência manual de custo/);
    expect(dto.quality).toBe("ESTIMATED");
    await app.close();
  });

  it("I. sem fonte nenhuma, o custo é desconhecido — null, nunca zero", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const dto = await estimate(app, versionId);
    const linha = componentOf(dto, item.id);
    expect(linha.costSource).toBe("NO_COST");
    expect(linha.unitCost).toBeNull();
    expect(linha.estimatedComponentCost).toBeNull();
    expect(dto.quality).toBe("NO_COST");
    expect(dto.estimatedMaterialCost).toBeNull();
    expect(dto.knownCostSubtotal).toBeNull();
    expect(dto.missingCostItems).toEqual([item.code]);
    await app.close();
  });

  it("J. material do cliente: custo Veridi NÃO APLICÁVEL, mesmo com compra e referência manual no item", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const doCliente = await createItem();
    const daVeridi = await createItem();
    await receiveWithCost(app, { supplierId: supplier.id, itemId: doCliente.id, quantity: "10", unitCost: "100", daysAgo: 3 });
    await setManualReference(app, doCliente.id, "90");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: daVeridi.id, quantity: "10", unitCost: "20", daysAgo: 3 });
    const { versionId } = await createFormulation(app, [
      { itemId: doCliente.id, quantity: "1", customer: true },
      { itemId: daVeridi.id, quantity: "2" },
    ]);

    const dto = await estimate(app, versionId);
    const cliente = componentOf(dto, doCliente.id);
    expect(cliente.customerSupplied).toBe(true);
    expect(cliente.costSource).toBe("EXCLUDED_CUSTOMER_SUPPLIED");
    expect(cliente.unitCost).toBeNull();
    expect(cliente.estimatedComponentCost).toBeNull();
    // O material do cliente não rebaixa a qualidade nem entra na lista de faltantes.
    expect(dto.quality).toBe("ESTIMATED");
    expect(dto.estimatedMaterialCost).toBe("40.00");
    expect(dto.missingCostItems).toEqual([]);
    expect(dto.hasCustomerSuppliedMaterials).toBe(true);
    await app.close();
  });

  it("K. respeita a data de referência: compra posterior ao dia pedido não entra", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const item = await createItem();
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "10", daysAgo: 20 });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "99", daysAgo: 2 });
    const { versionId } = await createFormulation(app, [{ itemId: item.id, quantity: "1" }]);

    const historico = componentOf(await estimate(app, versionId, new Date(Date.now() - 10 * DAY_MS)), item.id);
    expect(historico.costSource).toBe("WEIGHTED_AVG_30D");
    expect(historico.unitCost).toBe("10.0000");

    const hoje = componentOf(await estimate(app, versionId), item.id);
    expect(hoje.unitCost).toBe("54.5000");
    await app.close();
  });

  it("L. Formulação e cálculo de custo (motor do CMV) selecionam a MESMA fonte e o MESMO custo unitário", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();
    const supplier = await createSupplier();
    const comprado = await createItem();
    const referenciado = await createItem();
    const ofertado = await createItem();
    const doCliente = await createItem();
    await receiveWithCost(app, { supplierId: supplier.id, itemId: comprado.id, quantity: "10", unitCost: "1050", daysAgo: 4 });
    await setManualReference(app, referenciado.id, "1200");
    await approveSupplierWithOffer(ofertado.id, { supplierId: supplier.id, unitPrice: "77" });
    await setManualReference(app, doCliente.id, "500");
    const { productId, versionId } = await createFormulation(app, [
      { itemId: comprado.id, quantity: "2" },
      { itemId: referenciado.id, quantity: "1" },
      { itemId: ofertado.id, quantity: "0.5" },
      { itemId: doCliente.id, quantity: "1", customer: true },
    ]);
    const ativada = await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });
    expect(ativada.statusCode, ativada.body).toBe(200);

    // Estrutura de custo mínima (energia direta) para o motor rodar.
    const estrutura = (
      await app.inject({
        method: "POST",
        url: `/products/${productId}/industrial-costs`,
        payload: { referenceOutputQuantity: "1" },
      })
    ).json();
    expect(estrutura.id, JSON.stringify(estrutura)).toBeTruthy();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${estrutura.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    const energia = (
      await app.inject({ method: "POST", url: "/industrial-resources", payload: { name: `Energia ${marker()}`, type: "ENERGY" } })
    ).json();
    fixtureResourceIds.push(energia.id);
    await app.inject({ method: "POST", url: `/industrial-resources/${energia.id}/rates`, payload: { rateValue: "1" } });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${estrutura.id}/resource-usages`,
      payload: { resourceId: energia.id, usageQuantity: "1" },
    });

    const calculo = await app.inject({ method: "POST", url: `/industrial-costs/${estrutura.id}/calculate`, payload: {} });
    expect(calculo.statusCode, calculo.body).toBe(200);
    const materiais = calculo.json().materials as { itemId: string; costSource: string; unitCost: string | null }[];
    const dto = await estimate(app, versionId, new Date(calculo.json().costReferenceDate));

    for (const item of [comprado, referenciado, ofertado, doCliente]) {
      const daFormulacao = componentOf(dto, item.id);
      const doCalculo = materiais.find((m) => m.itemId === item.id);
      expect(doCalculo, `material ${item.code} ausente no cálculo`).toBeTruthy();
      expect(daFormulacao.costSource, item.code).toBe(doCalculo!.costSource);
      if (doCalculo!.unitCost === null) {
        expect(daFormulacao.unitCost, item.code).toBeNull();
      } else {
        expect(Number(daFormulacao.unitCost), item.code).toBeCloseTo(Number(doCalculo!.unitCost), 4);
      }
    }
    expect(componentOf(dto, comprado.id).costSource).toBe("WEIGHTED_AVG_30D");
    expect(componentOf(dto, referenciado.id).costSource).toBe("MANUAL_REFERENCE");
    expect(componentOf(dto, ofertado.id).costSource).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(componentOf(dto, doCliente.id).costSource).toBe("EXCLUDED_CUSTOMER_SUPPLIED");

    // Nenhum segundo seletor: a estimativa não guarda hierarquia própria.
    expect(await prisma.industrialCostCalculation.count({ where: { productId } })).toBe(0);
    await app.close();
  });
});
