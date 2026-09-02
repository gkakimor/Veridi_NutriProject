import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let supplierId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "mL", label: "Mililitro", dimension: "VOLUME", toBaseFactor: "0.001" },
    { code: "L", label: "Litro", dimension: "VOLUME", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-OP-${marker}`, legalName: `Fornecedor OP Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: fixturePurchaseOrderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureProductionOrderIds.length > 0) {
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

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; controlsLot?: boolean; controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-OP-${m}`,
      name: `Item OP Teste ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createProduct(app: App, finishedProductItemId?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId: await fixtureCustomerId(),
      name: `Produto OP Teste ${marker()}`,
      ...(finishedProductItemId ? { finishedProductItemId } : {}),
    },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

/** Cria um produto com Finished Product Item + formulação V1 ACTIVE com os componentes informados. */
async function createProductWithActiveFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { basisQuantity?: string; finishedUnitCode?: string } = {},
) {
  const finishedItem = await createItem(
    "FINISHED_PRODUCT",
    overrides.finishedUnitCode !== undefined ? { unitCode: overrides.finishedUnitCode } : {},
  );
  const product = await createProduct(app, finishedItem.id);

  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = created.json().id;

  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: { basisQuantity: overrides.basisQuantity ?? "1000", components },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  return { product, finishedItem, formulationVersionId: versionId };
}

async function receiveStock(
  itemId: string,
  quantity: string,
  overrides: { status?: LotStatus; expiryDate?: Date | null } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-OP-${m}`,
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate !== undefined ? { expiryDate: overrides.expiryDate } : {}),
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

/** Cria e confirma uma OC (→ ORDERED) para gerar On Order de um item. */
async function createOnOrder(app: App, itemId: string, orderedQuantity: string) {
  const created = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ itemId, orderedQuantity }],
    },
  });
  fixturePurchaseOrderIds.push(created.json().id);
  await app.inject({ method: "POST", url: `/purchase-orders/${created.json().id}/confirm` });
}

describe("Production Orders — ciclo de vida DRAFT/PLANNED/CANCELLED", () => {
  it("cria DRAFT com código OP-000001..., imutável", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);

    const response = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    fixtureProductionOrderIds.push(body.id);
    expect(body.code).toMatch(/^OP-\d{6}$/);
    expect(body.status).toBe("DRAFT");

    const patched = await app.inject({
      method: "PATCH",
      url: `/production-orders/${body.id}`,
      payload: { notes: "Ajuste" },
    });
    expect(patched.json().code).toBe(body.code);

    await app.close();
  });

  it("concorrência: geração de código nunca duplica sob criação simultânea", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);

    const attempt = () =>
      app.inject({ method: "POST", url: "/production-orders", payload: { productId: product.id } });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    fixtureProductionOrderIds.push(first.json().id, second.json().id);
    expect(first.json().code).not.toBe(second.json().code);

    await app.close();
  });

  it("produto sem Finished Product Item não cria OP", async () => {
    const app = buildTestApp();
    await app.ready();

    /*
     * Produto SEM item de produto acabado não é mais criável pela API — todo
     * produto novo nasce com o seu. O estado existe na base (importados do
     * legado), então é montado direto no banco, que é de onde ele vem.
     */
    const product = await createProduct(app);
    await getPrisma().product.update({
      where: { id: product.id },
      data: { finishedProductItemId: null },
    });
    const response = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("missing_finished_item");

    await app.close();
  });

  it("produto inativo não cria OP", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await app.inject({ method: "POST", url: `/products/${product.id}/deactivate` });

    const response = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_product");

    await app.close();
  });

  it("formulação informada precisa pertencer ao produto", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product: productA } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    const otherFinished = await createItem("FINISHED_PRODUCT");
    const productB = await createProduct(app, otherFinished.id);

    const versionOfA = await app.inject({ method: "GET", url: `/products/${productA.id}/formulations` });
    const versionId = versionOfA.json().versions[0].id;

    const response = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: productB.id, formulationVersionId: versionId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("version_product_mismatch");

    await app.close();
  });

  it("DRAFT editável: Produto/Formulação/Quantidade/Observações", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const response = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.json().id}`,
      payload: { plannedQuantity: "3000", notes: "Rodada especial" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().plannedQuantity).toBe("3000");
    expect(response.json().notes).toBe("Rodada especial");

    await app.close();
  });

  it("planeja quantidade <= 0 é rejeitado no PLAN", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "1000" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    // Zod barra plannedQuantity "0" via decimalStringSchema no update — força
    // o estado invalido diretamente para exercer o gate do PLAN.
    await getPrisma().productionOrder.update({
      where: { id: created.json().id },
      data: { plannedQuantity: "0" },
    });

    const plan = await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });
    expect(plan.statusCode).toBe(400);
    expect(plan.json().error).toBe("plan_validation_failed");
    expect(plan.json().message).toContain("quantidade planejada");

    await app.close();
  });

  it("produto sem formulação ativa não planeja", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "10" },
    });
    fixtureProductionOrderIds.push(created.json().id);
    expect(created.json().formulationVersionId).toBeNull();

    const plan = await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });
    expect(plan.statusCode).toBe(400);
    expect(plan.json().error).toBe("plan_validation_failed");
    expect(plan.json().message).toContain("nenhuma formulação selecionada");

    await app.close();
  });

  it("DRAFT com V1 obsoleta (V2 ativada depois) não planeja silenciosamente", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, formulationVersionId: v1Id } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, formulationVersionId: v1Id, plannedQuantity: "1000" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const v2 = await app.inject({ method: "POST", url: `/formulation-versions/${v1Id}/new-version` });
    await app.inject({ method: "POST", url: `/formulation-versions/${v2.json().id}/activate` });

    const plan = await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });
    expect(plan.statusCode).toBe(400);
    expect(plan.json().error).toBe("plan_validation_failed");
    expect(plan.json().message).toContain("não está mais ativa");

    await app.close();
  });

  it("fluxo completo DRAFT → PLANNED: congela campos estruturais e Requirements", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, formulationVersionId } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "500", unitCode: "g" },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "5000" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const planned = await app.inject({
      method: "POST",
      url: `/production-orders/${created.json().id}/plan`,
    });
    expect(planned.statusCode).toBe(200);
    const body = planned.json();
    expect(body.status).toBe("PLANNED");
    expect(body.plannedAt).not.toBeNull();
    expect(body.plannedBy).not.toBeNull();
    expect(body.productionFactor).toBe("5");
    expect(body.formulationVersionId).toBe(formulationVersionId);
    expect(body.requirements).toHaveLength(1);
    expect(body.requirements[0].requiredQuantity).toBe("2.5");
    expect(body.requirements[0].stockUnitCode).toBe("kg");

    // Estrutural travado — só notes editável.
    const blockedProductChange = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.json().id}`,
      payload: { plannedQuantity: "9999" },
    });
    expect(blockedProductChange.statusCode).toBe(400);
    expect(blockedProductChange.json().error).toBe("order_locked");

    const allowedNotesChange = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.json().id}`,
      payload: { notes: "Observação pós-planejamento" },
    });
    expect(allowedNotesChange.statusCode).toBe(200);
    expect(allowedNotesChange.json().notes).toBe("Observação pós-planejamento");
    // Requirements preservados após o PATCH de notes.
    expect(allowedNotesChange.json().requirements).toHaveLength(1);

    await app.close();
  });

  it("PLANNED pode existir com shortage (não bloqueia o PLAN)", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "100", unitCode: "kg" },
    ]);
    // Sem estoque nenhum recebido — Available = 0, Required = 100kg.

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "1000" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const planned = await app.inject({
      method: "POST",
      url: `/production-orders/${created.json().id}/plan`,
    });
    expect(planned.statusCode).toBe(200);
    expect(planned.json().status).toBe("PLANNED");
    expect(planned.json().materialsStatus).toBe("MATERIAL_SHORTAGE");
    expect(planned.json().requirements[0].shortage).toBe("100");

    await app.close();
  });

  it("cancelamento exige motivo; DRAFT e PLANNED podem ser cancelados; CANCELLED é somente leitura", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const missingReason = await app.inject({
      method: "POST",
      url: `/production-orders/${created.json().id}/cancel`,
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json().error).toBe("validation_error");

    const cancelled = await app.inject({
      method: "POST",
      url: `/production-orders/${created.json().id}/cancel`,
      payload: { reason: "Pedido do cliente cancelado" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(cancelled.json().cancelReason).toBe("Pedido do cliente cancelado");
    expect(cancelled.json().cancelledAt).not.toBeNull();

    const editAttempt = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.json().id}`,
      payload: { notes: "tentativa" },
    });
    expect(editAttempt.statusCode).toBe(400);
    expect(editAttempt.json().error).toBe("order_locked");

    await app.close();
  });

  it("cancela OP PLANNED", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "10" },
    });
    fixtureProductionOrderIds.push(created.json().id);
    await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });

    const cancelled = await app.inject({
      method: "POST",
      url: `/production-orders/${created.json().id}/cancel`,
      payload: { reason: "Reformulação necessária" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    // Requirements históricos preservados, não apagados.
    expect(cancelled.json().requirements).toHaveLength(1);

    await app.close();
  });
});

describe("Production Orders — cálculo de Requirements e UOM", () => {
  it("fator de produção e necessidade: basis 1000 / planned 5000 = fator 5", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const { product } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "10", unitCode: "kg" }],
      { basisQuantity: "1000" },
    );

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "5000" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    expect(created.json().productionFactor).toBe("5");
    expect(created.json().requirements[0].requiredQuantity).toBe("50");

    await app.close();
  });

  it("conversões de unidade: g→kg, mg→kg, mL→L, contagem", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawG = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const rawMg = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const liquid = await createItem("RAW_MATERIAL", { unitCode: "L" });
    const packaging = await createItem("PACKAGING", { unitCode: "un" });

    const { product } = await createProductWithActiveFormulation(
      app,
      [
        { itemId: rawG.id, quantity: "500", unitCode: "g" },
        { itemId: rawMg.id, quantity: "250000", unitCode: "mg" },
        { itemId: liquid.id, quantity: "750", unitCode: "mL" },
        { itemId: packaging.id, quantity: "1000", unitCode: "un" },
      ],
      { basisQuantity: "1000" },
    );

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "5000" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const requirements = created.json().requirements as {
      itemId: string;
      requiredQuantity: string;
      stockUnitCode: string;
    }[];

    const byItem = (id: string) => requirements.find((r) => r.itemId === id)!;
    expect(byItem(rawG.id).requiredQuantity).toBe("2.5");
    expect(byItem(rawG.id).stockUnitCode).toBe("kg");
    expect(byItem(rawMg.id).requiredQuantity).toBe("1.25");
    expect(byItem(liquid.id).requiredQuantity).toBe("3.75");
    expect(byItem(liquid.id).stockUnitCode).toBe("L");
    expect(byItem(packaging.id).requiredQuantity).toBe("5000");

    await app.close();
  });

  it("regenera Requirements ao alterar plannedQuantity em DRAFT", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const { product } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      { basisQuantity: "1000" },
    );

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "1000" },
    });
    fixtureProductionOrderIds.push(created.json().id);
    expect(created.json().requirements[0].requiredQuantity).toBe("1");

    const updated = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.json().id}`,
      payload: { plannedQuantity: "4000" },
    });
    expect(updated.json().requirements).toHaveLength(1);
    expect(updated.json().requirements[0].requiredQuantity).toBe("4");

    await app.close();
  });

  it("troca de Produto em DRAFT limpa Requirements antigos e usa a formulação ACTIVE do novo produto", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawA = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const { product: productA } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawA.id, quantity: "1", unitCode: "kg" }],
      { basisQuantity: "1000" },
    );

    const rawB = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const { product: productB } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawB.id, quantity: "2", unitCode: "kg" }],
      { basisQuantity: "1000" },
    );

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: productA.id, plannedQuantity: "1000" },
    });
    fixtureProductionOrderIds.push(created.json().id);
    expect(created.json().requirements[0].itemId).toBe(rawA.id);

    const updated = await app.inject({
      method: "PATCH",
      url: `/production-orders/${created.json().id}`,
      payload: { productId: productB.id },
    });
    expect(updated.json().productId).toBe(productB.id);
    expect(updated.json().requirements).toHaveLength(1);
    expect(updated.json().requirements[0].itemId).toBe(rawB.id);
    expect(updated.json().requirements[0].requiredQuantity).toBe("2");

    await app.close();
  });

  it("precisão decimal: quantidade fracionária não é arredondada automaticamente", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "un", controlsLot: false });
    const { product } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "9", unitCode: "un" }],
      { basisQuantity: "20" },
    );

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "10" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    // 9 * (10/20) = 4.5 — precisa continuar 4.5, nunca 5 nem 4.
    expect(created.json().requirements[0].requiredQuantity).toBe("4.5");

    await app.close();
  });
});

describe("Production Orders — disponibilidade, On Order, shortage e FEFO", () => {
  it("Reserved sempre 0; Available considera só lote AVAILABLE e não vencido", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg", controlsLot: true, controlsExpiry: true });
    const { product } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      { basisQuantity: "1" },
    );

    await receiveStock(rawMaterial.id, "100", { status: "AVAILABLE" });
    await receiveStock(rawMaterial.id, "40", { status: "BLOCKED" });
    await receiveStock(rawMaterial.id, "30", {
      status: "AVAILABLE",
      expiryDate: new Date("2020-01-01"),
    });

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "70" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const requirement = created.json().requirements[0];
    expect(requirement.onHand).toBe("170");
    expect(requirement.reserved).toBe("0");
    expect(requirement.available).toBe("100");
    expect(requirement.requiredQuantity).toBe("70");
    expect(requirement.shortage).toBe("0");
    expect(requirement.availabilityStatus).toBe("AVAILABLE");

    await app.close();
  });

  it("shortage = max(required - available, 0); On Order não reduz shortage, aparece separado", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const { product } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      { basisQuantity: "1" },
    );

    await receiveStock(rawMaterial.id, "70", { status: "AVAILABLE" });
    await createOnOrder(app, rawMaterial.id, "50");

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "100" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const requirement = created.json().requirements[0];
    expect(requirement.available).toBe("70");
    expect(requirement.onOrder).toBe("50");
    expect(requirement.shortage).toBe("30");
    expect(requirement.availabilityStatus).toBe("SHORTAGE");

    await app.close();
  });

  it("retorna sugestão FEFO por Requirement sem persistir nem reservar", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", {
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
    });
    const { product } = await createProductWithActiveFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      { basisQuantity: "1" },
    );

    const earlierLot = await receiveStock(rawMaterial.id, "30", {
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    await receiveStock(rawMaterial.id, "40", {
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "50" },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const requirement = created.json().requirements[0];
    expect(requirement.suggestedAllocations.length).toBeGreaterThan(0);
    expect(requirement.suggestedAllocations[0].lotId).toBe(earlierLot.id);
    expect(requirement.suggestedAllocations[0].suggestedQuantity).toBe("30");

    // Não persiste nem altera saldo: On Hand continua íntegro.
    const inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().onHand).toBe("70");

    await app.close();
  });
});
