import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Referência manual forçada num cálculo (PRODUCT_RULES §53).
 *
 * O que se protege: a substituição é por CÁLCULO e por COMPONENTE (o item
 * não ganha nenhuma marca, e o próximo cálculo volta ao automático); exige
 * motivo ao salvar; congela no documento a fonte usada E a que teria sido
 * usada; e o cálculo salvo não muda quando a referência muda nem quando uma
 * compra nova entra. Material do cliente nunca ganha custo, mesmo com
 * referência manual no item.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];
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
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
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

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-OVR-${m}`,
      name: `Item Override ${m}`,
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
    data: { code: `FOR-OVR-${m}`, legalName: `Fornecedor Override ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost: string; daysAgo?: number },
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
        receivedAt: new Date(Date.now() - (params.daysAgo ?? 1) * DAY_MS).toISOString(),
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

async function setManualReference(app: App, itemId: string, unitCost: string) {
  const response = await app.inject({
    method: "POST",
    url: `/items/${itemId}/cost-references`,
    payload: { unitCost },
  });
  expect(response.statusCode, response.body).toBe(201);
}

/** Produto + formulação ativa + estrutura ATIVA com energia direta (custo fechado). */
async function createActiveStructure(
  app: App,
  components: { itemId: string; quantity: string; customer?: boolean }[],
) {
  const prisma = getPrisma();
  const m = marker();
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");
  const customer = components.some((c) => c.customer)
    ? await prisma.customer.create({
        data: { code: `CLI-OVR-${m}`, legalName: `Cliente Override ${m}`, active: true },
      })
    : null;
  if (customer) fixtureCustomerIds.push(customer.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto Override ${m}`,
        finishedProductItemId: finishedItem.id,
        customerId: customer?.id ?? (await fixtureCustomerId()),
      },
    })
  ).json();
  expect(product.id, JSON.stringify(product)).toBeTruthy();
  fixtureProductIds.push(product.id);

  const formulation = (
    await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulation.id}`,
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
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: "1" },
    })
  ).json();
  expect(version.id, JSON.stringify(version)).toBeTruthy();

  // Energia direta: o único componente de recurso obrigatório para fechar.
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  const energy = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Energia ${marker()}`, type: "ENERGY" },
    })
  ).json();
  fixtureResourceIds.push(energy.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${energy.id}/rates`,
    payload: { rateValue: "1" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/resource-usages`,
    payload: { resourceId: energy.id, usageQuantity: "1" },
  });
  const ativada = await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/activate`,
    payload: { confirmIncomplete: true },
  });
  expect(ativada.statusCode, ativada.body).toBe(200);

  return { product, version };
}

async function preview(app: App, versionId: string, overrides?: { itemId: string; reason?: string }[]) {
  const response = await app.inject({
    method: "POST",
    url: `/industrial-costs/${versionId}/calculate`,
    payload: overrides ? { materialOverrides: overrides } : {},
  });
  return { status: response.statusCode, body: response.json() };
}

describe("Referência manual forçada — por cálculo e por componente", () => {
  it("H/I. forçar usa a referência, preserva a fonte automática e exige motivo só ao salvar", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await setManualReference(app, material.id, "1200");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: material.id, quantity: "10", unitCost: "1050" });
    const { version } = await createActiveStructure(app, [{ itemId: material.id, quantity: "2" }]);

    // Padrão: automático. A referência manual aparece como DISPONÍVEL, não usada.
    const automatico = await preview(app, version.id);
    expect(automatico.status).toBe(200);
    const linha = automatico.body.materials[0];
    expect(linha.costSource).toBe("WEIGHTED_AVG_30D");
    expect(linha.unitCost).toBe("1050.000000");
    expect(linha.manualReference?.unitCost).toBe("1200.000000");
    expect(linha.override).toBeNull();

    // Prévia forçada sem motivo: permitida, para ver o impacto antes de justificar.
    const forcado = await preview(app, version.id, [{ itemId: material.id }]);
    expect(forcado.status, JSON.stringify(forcado.body)).toBe(200);
    const forcada = forcado.body.materials[0];
    expect(forcada.costSource).toBe("MANUAL_REFERENCE_FORCED");
    expect(forcada.unitCost).toBe("1200.000000");
    expect(forcada.subtotal).toBe("2400.00");
    expect(forcada.override.automaticSource).toBe("WEIGHTED_AVG_30D");
    expect(forcada.override.automaticUnitCost).toBe("1050.000000");
    expect(forcada.override.automaticSubtotal).toBe("2100.00");
    // (1200 − 1050) × 2 — mesma aritmética da linha, sem segundo motor.
    expect(forcada.override.impact).toBe("300.00");
    expect(forcado.body.quality).toBe("COMPLETE_WITH_ESTIMATES");

    // Salvar sem motivo é recusado.
    const semMotivo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: { materialOverrides: [{ itemId: material.id, reason: "  " }] },
    });
    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json().error).toBe("override_reason_required");

    const salvo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: { materialOverrides: [{ itemId: material.id, reason: "Compra de 30 dias foi lote promocional" }] },
    });
    expect(salvo.statusCode, salvo.body).toBe(201);
    const doc = salvo.json();
    expect(doc.materials[0].costSource).toBe("MANUAL_REFERENCE_FORCED");
    expect(doc.materials[0].override.reason).toBe("Compra de 30 dias foi lote promocional");
    expect(doc.materials[0].override.forcedByName).toBeTruthy();
    expect(doc.materials[0].override.forcedAt).toBeTruthy();
    expect(doc.quality).toBe("COMPLETE_WITH_ESTIMATES");

    // A substituição NÃO gruda no item: o próximo cálculo volta ao automático.
    const depois = await preview(app, version.id);
    expect(depois.body.materials[0].costSource).toBe("WEIGHTED_AVG_30D");
    await app.close();
  });

  it("J/K. cálculo salvo não muda quando a referência muda nem quando entra compra nova", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await setManualReference(app, material.id, "1200");
    const { version } = await createActiveStructure(app, [{ itemId: material.id, quantity: "1" }]);

    // Sem compra: o automático já é a referência manual (passo 5).
    const salvo = (
      await app.inject({ method: "POST", url: `/industrial-costs/${version.id}/calculations`, payload: {} })
    ).json();
    expect(salvo.materials[0].costSource).toBe("MANUAL_REFERENCE");
    expect(salvo.materials[0].unitCost).toBe("1200.000000");

    // J. Referência muda depois.
    await setManualReference(app, material.id, "9999");
    // K. Compra real entra depois.
    await receiveWithCost(app, { supplierId: supplier.id, itemId: material.id, quantity: "5", unitCost: "800" });

    const relido = (
      await app.inject({ method: "GET", url: `/industrial-cost-calculations/${salvo.id}` })
    ).json();
    expect(relido.materials[0].costSource).toBe("MANUAL_REFERENCE");
    expect(relido.materials[0].unitCost).toBe("1200.000000");
    expect(relido.totalIndustrialCost).toBe(salvo.totalIndustrialCost);

    // Um cálculo NOVO pode usar a fonte nova — a compra real vence.
    const novo = await preview(app, version.id);
    expect(novo.body.materials[0].costSource).toBe("WEIGHTED_AVG_30D");
    expect(novo.body.materials[0].unitCost).toBe("800.000000");
    await app.close();
  });

  it("L. material do cliente não ganha custo Veridi, mesmo com referência manual no item — e não aceita substituição", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const material = await createItem("RAW_MATERIAL");
    await setManualReference(app, material.id, "1200");
    const { version } = await createActiveStructure(app, [{ itemId: material.id, quantity: "1", customer: true }]);

    const automatico = await preview(app, version.id);
    expect(automatico.status).toBe(200);
    expect(automatico.body.materials[0].customerSupplied).toBe(true);
    expect(automatico.body.materials[0].costSource).toBe("EXCLUDED_CUSTOMER_SUPPLIED");
    expect(automatico.body.materials[0].unitCost).toBeNull();

    const forcado = await preview(app, version.id, [{ itemId: material.id, reason: "x" }]);
    expect(forcado.status).toBe(400);
    expect(forcado.body.error).toBe("override_not_applicable");
    await app.close();
  });

  it("forçar exige referência manual existente; item fora da formulação é recusado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const supplier = await createSupplier();
    const material = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: material.id, quantity: "1", unitCost: "10" });
    const { version } = await createActiveStructure(app, [{ itemId: material.id, quantity: "1" }]);

    const semReferencia = await preview(app, version.id, [{ itemId: material.id, reason: "x" }]);
    expect(semReferencia.status).toBe(409);
    expect(semReferencia.body.error).toBe("manual_reference_missing");

    const outro = await createItem("RAW_MATERIAL");
    const foraDaFormula = await preview(app, version.id, [{ itemId: outro.id, reason: "x" }]);
    expect(foraDaFormula.status).toBe(400);
    expect(foraDaFormula.body.error).toBe("override_not_applicable");
    await app.close();
  });
});
