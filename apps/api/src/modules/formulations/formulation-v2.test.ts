import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { applyPurityAndOverage, computeComponentRequirement } from "../../lib/formulation-math.js";

/**
 * Capacidade 34 — Formulação Industrial v2.
 *
 * Fixtures sintéticas: a suíte nunca depende do corpus real da Veridi nem
 * do conteúdo da base de desenvolvimento.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createItem(
  app: App,
  overrides: { type?: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT"; unitCode?: string; purity?: string } = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/items",
    payload: {
      type: overrides.type ?? "RAW_MATERIAL",
      name: `Item F2 ${marker()}`,
      unitCode: overrides.unitCode ?? "kg",
      ...(overrides.purity ? { defaultPurityPercent: overrides.purity } : {}),
    },
  });
  const item = response.json();
  fixtureItemIds.push(item.id);
  return item;
}

async function createProduct(app: App, finishedItemId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto F2 ${marker()}`, finishedProductItemId: finishedItemId },
  });
  const product = response.json();
  fixtureProductIds.push(product.id);
  return product;
}

async function createDraftVersion(app: App, productId: string) {
  return (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/formulation-versions`,
      payload: {},
    })
  ).json();
}

describe("Formulação v2 — matemática", () => {
  it("pureza exige mais massa e overage acrescenta a perda de processo", () => {
    const theoretical = new Prisma.Decimal("0.9");

    // 98% de pureza: para entregar 0,9 kg de ativo precisa de mais massa.
    expect(
      applyPurityAndOverage(theoretical, new Prisma.Decimal("98"), null).toFixed(8),
    ).toBe("0.91836735");

    // 20% de overage sobre o teórico.
    expect(applyPurityAndOverage(theoretical, null, new Prisma.Decimal("20")).toFixed(8)).toBe(
      "1.08000000",
    );

    // Os dois juntos, exatamente como a planilha histórica calcula.
    expect(
      applyPurityAndOverage(theoretical, new Prisma.Decimal("98"), new Prisma.Decimal("20")).toFixed(8),
    ).toBe("1.10204082");
  });

  it("pureza desconhecida não vira 100% e overage ausente não vira zero implícito", () => {
    const theoretical = new Prisma.Decimal("10");
    // Sem pureza e sem overage o número permanece o teórico — nenhuma
    // correção silenciosa é aplicada.
    expect(applyPurityAndOverage(theoretical, null, null).toString()).toBe("10");
    // Overage 0 declarado é diferente de "não informado" apenas na
    // intenção; o resultado numérico é o mesmo.
    expect(applyPurityAndOverage(theoretical, null, new Prisma.Decimal("0")).toString()).toBe("10");
  });

  it("PER_DOSE reproduz o total histórico da planilha", () => {
    const units = [
      { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("1000") },
      { code: "mg", label: "Miligrama", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("0.001") },
    ];

    // Caso real do corpus: CoQ10 100 mg/dose, 30 doses, lote de 300
    // unidades, pureza 98%, overage 20% → 1,10204082 kg.
    const requirement = computeComponentRequirement(
      {
        basis: "PER_DOSE",
        quantity: new Prisma.Decimal("100"),
        unitCode: "mg",
        stockUnitCode: "kg",
        purityPercentApplied: new Prisma.Decimal("98"),
        overagePercent: new Prisma.Decimal("20"),
      },
      new Prisma.Decimal("300"),
      { basisQuantity: new Prisma.Decimal("1"), dosesPerPackage: 30 },
      units as never,
    );

    expect(requirement.theoreticalQuantity.toFixed(8)).toBe("0.90000000");
    expect(requirement.requiredQuantity.toFixed(8)).toBe("1.10204082");
  });

  it("embalagem é por unidade acabada, nunca por dose", () => {
    const units = [
      { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: new Prisma.Decimal("1") },
    ];

    const requirement = computeComponentRequirement(
      {
        basis: "PER_FINISHED_UNIT",
        quantity: new Prisma.Decimal("1"),
        unitCode: "un",
        stockUnitCode: "un",
        purityPercentApplied: null,
        overagePercent: null,
      },
      new Prisma.Decimal("300"),
      // Mesmo com 30 doses por embalagem, uma tampa por pote.
      { basisQuantity: new Prisma.Decimal("1"), dosesPerPackage: 30 },
      units as never,
    );

    expect(requirement.requiredQuantity.toString()).toBe("300");
  });

  it("FIXED_BASIS mantém exatamente o comportamento anterior", () => {
    const units = [
      { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("1000") },
    ];

    const requirement = computeComponentRequirement(
      {
        basis: "FIXED_BASIS",
        quantity: new Prisma.Decimal("2"),
        unitCode: "kg",
        stockUnitCode: "kg",
        purityPercentApplied: null,
        overagePercent: null,
      },
      new Prisma.Decimal("50"),
      { basisQuantity: new Prisma.Decimal("10"), dosesPerPackage: null },
      units as never,
    );

    expect(requirement.requiredQuantity.toString()).toBe("10");
  });
});

describe("Formulação v2 — versão e Ordem de Produção", () => {
  it("versão PER_DOSE calcula a necessidade da OP com pureza e overage congelados", async () => {
    const app = buildTestApp();
    await app.ready();

    const activeIngredient = await createItem(app, { purity: "98" });
    const capsule = await createItem(app, { type: "PACKAGING", unitCode: "un" });
    const finishedItem = await createItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);

    const version = await createDraftVersion(app, product.id);
    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/formulation-versions/${version.id}`,
        payload: {
          basisQuantity: "1",
          calculationMode: "PER_DOSE",
          dosesPerPackage: 30,
          components: [
            {
              itemId: activeIngredient.id,
              quantity: "100",
              unitCode: "mg",
              basis: "PER_DOSE",
              purityPercentApplied: "98",
              overagePercent: "20",
            },
            {
              itemId: capsule.id,
              quantity: "1",
              unitCode: "un",
              basis: "PER_FINISHED_UNIT",
            },
          ],
        },
      })
    ).json();

    expect(updated.calculationMode).toBe("PER_DOSE");
    expect(updated.dosesPerPackage).toBe(30);
    const ingredient = updated.components.find((c: { itemId: string }) => c.itemId === activeIngredient.id);
    expect(ingredient.basis).toBe("PER_DOSE");
    expect(ingredient.purityPercentApplied).toBe("98");
    expect(ingredient.overagePercent).toBe("20");
    // Prévia por unidade acabada: 100 mg × 30 doses = 3 g = 0,003 kg.
    expect(new Prisma.Decimal(ingredient.theoreticalPerUnit).toFixed(6)).toBe("0.003000");
    expect(new Prisma.Decimal(ingredient.physicalPerUnit).toFixed(8)).toBe("0.00367347");

    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const order = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: product.id, plannedQuantity: "300" },
      })
    ).json();
    fixtureProductionOrderIds.push(order.id);
    const planned = (
      await app.inject({ method: "POST", url: `/production-orders/${order.id}/plan` })
    ).json();

    const ingredientRequirement = planned.requirements.find(
      (row: { itemId: string }) => row.itemId === activeIngredient.id,
    );
    const capsuleRequirement = planned.requirements.find(
      (row: { itemId: string }) => row.itemId === capsule.id,
    );

    // Mesma conta do histórico: 1,10204082 kg para 300 unidades. A OP grava
    // em Decimal(18,6) como todo quantitativo do sistema — 1 mg de resolução.
    expect(new Prisma.Decimal(ingredientRequirement.requiredQuantity).toFixed(6)).toBe("1.102041");
    // Embalagem: 300 unidades, sem pureza/overage.
    expect(new Prisma.Decimal(capsuleRequirement.requiredQuantity).toString()).toBe("300");

    // O documento congela também o teórico e os fatores aplicados.
    const frozen = await getPrisma().productionOrderRequirement.findFirstOrThrow({
      where: { productionOrderId: order.id, itemId: activeIngredient.id },
    });
    expect(frozen.theoreticalQuantity!.toFixed(6)).toBe("0.900000");
    expect(frozen.purityPercentApplied!.toString()).toBe("98");
    expect(frozen.overagePercent!.toString()).toBe("20");

    await app.close();
  });

  it("alterar a pureza do Item depois NÃO altera a formulação nem a OP", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingredient = await createItem(app, { purity: "90" });
    const finishedItem = await createItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);

    const version = await createDraftVersion(app, product.id);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${version.id}`,
      payload: {
        basisQuantity: "1",
        calculationMode: "PER_DOSE",
        dosesPerPackage: 10,
        components: [
          {
            itemId: ingredient.id,
            quantity: "1000",
            unitCode: "mg",
            basis: "PER_DOSE",
            purityPercentApplied: "90",
          },
        ],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const order = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: product.id, plannedQuantity: "100" },
      })
    ).json();
    fixtureProductionOrderIds.push(order.id);
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/plan` });

    // Cadastro muda depois — snapshot da formulação não pode acompanhar.
    await app.inject({
      method: "PATCH",
      url: `/items/${ingredient.id}`,
      payload: { defaultPurityPercent: "50" },
    });

    const rereadVersion = (
      await app.inject({ method: "GET", url: `/formulation-versions/${version.id}` })
    ).json();
    expect(rereadVersion.components[0].purityPercentApplied).toBe("90");

    const rereadOrder = (
      await app.inject({ method: "GET", url: `/production-orders/${order.id}` })
    ).json();
    // 1000 mg × 10 doses × 100 un = 1 kg ÷ 0,90 = 1,111111 kg (Decimal(18,6)).
    expect(new Prisma.Decimal(rereadOrder.requirements[0].requiredQuantity).toFixed(6)).toBe(
      "1.111111",
    );

    await app.close();
  });

  it("versão sem pureza informada não aplica correção nenhuma", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingredient = await createItem(app);
    const finishedItem = await createItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);

    const version = await createDraftVersion(app, product.id);
    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/formulation-versions/${version.id}`,
        payload: {
          basisQuantity: "1",
          calculationMode: "PER_DOSE",
          dosesPerPackage: 2,
          components: [{ itemId: ingredient.id, quantity: "500", unitCode: "mg", basis: "PER_DOSE" }],
        },
      })
    ).json();

    expect(updated.components[0].purityPercentApplied).toBeNull();
    // 500 mg × 2 doses = 1 g = 0,001 kg — sem inflar por pureza fictícia.
    expect(new Prisma.Decimal(updated.components[0].physicalPerUnit).toFixed(6)).toBe("0.001000");

    await app.close();
  });

  it("rejeita pureza fora da faixa e overage negativo", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingredient = await createItem(app);
    const finishedItem = await createItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);
    const version = await createDraftVersion(app, product.id);

    const base = { itemId: ingredient.id, quantity: "1", unitCode: "kg", basis: "PER_DOSE" };
    for (const invalid of [
      { ...base, purityPercentApplied: "0" },
      { ...base, purityPercentApplied: "100.5" },
      { ...base, overagePercent: "-5" },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/formulation-versions/${version.id}`,
        payload: { components: [invalid] },
      });
      expect(response.statusCode).toBe(400);
    }

    await app.close();
  });

  it("versões antigas continuam FIXED_BASIS e com o mesmo resultado", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingredient = await createItem(app);
    const finishedItem = await createItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);

    const version = await createDraftVersion(app, product.id);
    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/formulation-versions/${version.id}`,
        payload: {
          basisQuantity: "10",
          components: [{ itemId: ingredient.id, quantity: "2", unitCode: "kg" }],
        },
      })
    ).json();

    // Default preservado: quem não pediu PER_DOSE continua como antes.
    expect(updated.calculationMode).toBe("FIXED_BASIS");
    expect(updated.dosesPerPackage).toBeNull();
    expect(updated.components[0].basis).toBe("FIXED_BASIS");
    expect(updated.components[0].purityPercentApplied).toBeNull();

    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });
    const order = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: product.id, plannedQuantity: "50" },
      })
    ).json();
    fixtureProductionOrderIds.push(order.id);
    const planned = (
      await app.inject({ method: "POST", url: `/production-orders/${order.id}/plan` })
    ).json();

    // 2 kg para cada 10 unidades → 10 kg para 50.
    expect(new Prisma.Decimal(planned.requirements[0].requiredQuantity).toString()).toBe("10");

    await app.close();
  });

  it("nova versão a partir da ativa preserva modo de cálculo, doses e snapshots", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingredient = await createItem(app, { purity: "95" });
    const finishedItem = await createItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);

    const version = await createDraftVersion(app, product.id);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${version.id}`,
      payload: {
        basisQuantity: "1",
        calculationMode: "PER_DOSE",
        dosesPerPackage: 60,
        components: [
          {
            itemId: ingredient.id,
            quantity: "500",
            unitCode: "mg",
            basis: "PER_DOSE",
            purityPercentApplied: "95",
            overagePercent: "10",
          },
        ],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const copy = (
      await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/new-version` })
    ).json();

    // Copiar só os componentes deixaria linhas por dose numa versão de base
    // fixa e sem doses — fórmula quebrada no primeiro cálculo.
    expect(copy.calculationMode).toBe("PER_DOSE");
    expect(copy.dosesPerPackage).toBe(60);
    expect(copy.components[0].basis).toBe("PER_DOSE");
    expect(copy.components[0].purityPercentApplied).toBe("95");
    expect(copy.components[0].overagePercent).toBe("10");

    await app.close();
  });
});
