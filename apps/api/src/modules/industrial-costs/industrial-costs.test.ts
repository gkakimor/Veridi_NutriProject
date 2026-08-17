import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 43 — estrutura de custos industriais.
 *
 * Fixtures sintéticas. O que estes testes protegem: versionamento,
 * imutabilidade, o vínculo com a receita exata, e as três recusas que
 * sustentam o domínio — não inventar valor onde não há, não deixar
 * mão de obra/equipamento/energia virarem linha manual e não tocar na
 * Foundation of Costs.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
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
  if (fixtureProductIds.length > 0) {
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
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
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
      code: `${prefix}-EC-${m}`,
      name: `Item Custo ${m}`,
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

/** Produto com formulação (uma matéria-prima Veridi + uma do cliente). */
async function createProductWithFormulation(
  app: App,
  options: { unitsPerShippingBox?: number; minimumBatchQuantity?: string } = {},
) {
  const prisma = getPrisma();
  const m = marker();

  const finishedItem = await createItem("FINISHED_PRODUCT", "un");
  const veridiMaterial = await createItem("RAW_MATERIAL");
  const customerMaterial = await createItem("RAW_MATERIAL");
  const packaging = await createItem("PACKAGING", "un");

  const customer = await prisma.customer.create({
    data: { code: `CLI-EC-${m}`, legalName: `Cliente Custo ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto Custo ${m}`,
        finishedProductItemId: finishedItem.id,
        customerId: customer.id,
        ...(options.unitsPerShippingBox
          ? { unitsPerShippingBox: options.unitsPerShippingBox }
          : {}),
        ...(options.minimumBatchQuantity
          ? { minimumBatchQuantity: options.minimumBatchQuantity }
          : {}),
      },
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
    payload: {
      basisQuantity: "1",
      components: [
        { itemId: veridiMaterial.id, quantity: "0.5", unitCode: "kg" },
        {
          itemId: customerMaterial.id,
          quantity: "0.2",
          unitCode: "kg",
          supplyResponsibility: "CUSTOMER",
        },
        { itemId: packaging.id, quantity: "1", unitCode: "un" },
      ],
    },
  });

  return { product, formulationVersionId: version.id, veridiMaterial, customerMaterial, packaging };
}

async function activateFormulation(app: App, formulationVersionId: string) {
  return app.inject({ method: "POST", url: `/formulation-versions/${formulationVersionId}/activate` });
}

async function createCostVersion(
  app: App,
  productId: string,
  payload: Record<string, unknown> = {},
) {
  return app.inject({ method: "POST", url: `/products/${productId}/industrial-costs`, payload });
}

describe("Estrutura de custos — versionamento", () => {
  it("cria V1 em rascunho e devolve o mesmo rascunho na segunda chamada", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);

    const created = await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" });
    expect(created.statusCode).toBe(201);

    const version = created.json();
    expect(version.code.startsWith("EC-")).toBe(true);
    expect(version.versionNumber).toBe(1);
    expect(version.label).toBe(`${version.code} · V1`);
    expect(version.status).toBe("DRAFT");
    expect(version.referenceOutputQuantity).toBe("1000");

    // Clicar de novo em "nova versão" não gera V2 por acidente.
    const again = await createCostVersion(app, product.id);
    expect(again.json().id).toBe(version.id);

    await app.close();
  });

  it("não assume base de produção quando não há lote mínimo nem versão anterior", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);

    const response = await createCostVersion(app, product.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_reference_output");

    await app.close();
  });

  it("copia receita, base e premissas para a nova versão sem tocar na anterior", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);

    const v1 = (await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${v1.id}/lines`,
      payload: {
        category: "SECONDARY_PACKAGING",
        description: "Caixa de expedição",
        calculationBasis: "FIXED_PER_BATCH",
        rateValue: "150",
      },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${v1.id}/activate`,
      payload: {},
    });

    const v2 = (await createCostVersion(app, product.id)).json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe("DRAFT");
    expect(v2.formulationVersionId).toBe(formulationVersionId);
    expect(v2.referenceOutputQuantity).toBe("1000");
    expect(v2.lines).toHaveLength(1);
    expect(v2.lines[0].rateValue).toBe("150");
    // Auditoria de ativação não é copiada.
    expect(v2.activatedAt).toBeNull();

    const v1After = await app.inject({ method: "GET", url: `/industrial-costs/${v1.id}` });
    expect(v1After.json().status).toBe("ACTIVE");
    expect(v1After.json().lines).toHaveLength(1);

    await app.close();
  });

  it("mantém uma única versão ativa por produto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);

    const v1 = (await createCostVersion(app, product.id, { referenceOutputQuantity: "500" })).json();
    await app.inject({ method: "POST", url: `/industrial-costs/${v1.id}/activate`, payload: {} });

    const v2 = (await createCostVersion(app, product.id)).json();
    await app.inject({ method: "POST", url: `/industrial-costs/${v2.id}/activate`, payload: {} });

    const overview = (
      await app.inject({ method: "GET", url: `/products/${product.id}/industrial-costs` })
    ).json();
    expect(overview.current.id).toBe(v2.id);
    expect(
      overview.versions.filter((row: { status: string }) => row.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(
      overview.versions.find((row: { id: string }) => row.id === v1.id).status,
    ).toBe("INACTIVE");

    await app.close();
  });

  it("recusa edição de versão ativa — correção é nova versão", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);
    const v1 = (await createCostVersion(app, product.id, { referenceOutputQuantity: "800" })).json();
    const lineId = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${v1.id}/lines`,
        payload: {
          category: "OVERHEAD",
          description: "Rateio industrial",
          calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
          rateValue: "10",
        },
      })
    ).json().lines[0].id;

    await app.inject({ method: "POST", url: `/industrial-costs/${v1.id}/activate`, payload: {} });

    const patchVersion = await app.inject({
      method: "PATCH",
      url: `/industrial-costs/${v1.id}`,
      payload: { referenceOutputQuantity: "900" },
    });
    expect(patchVersion.statusCode).toBe(409);

    const patchLine = await app.inject({
      method: "PATCH",
      url: `/industrial-cost-lines/${lineId}`,
      payload: { rateValue: "12" },
    });
    expect(patchLine.statusCode).toBe(409);

    const deleteLine = await app.inject({ method: "DELETE", url: `/industrial-cost-lines/${lineId}` });
    expect(deleteLine.statusCode).toBe(409);

    await app.close();
  });
});

describe("Estrutura de custos — formulação vinculada", () => {
  it("permite rascunho sobre formulação rascunho, mas não ativar", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);

    const draft = (
      await createCostVersion(app, product.id, {
        formulationVersionId,
        referenceOutputQuantity: "1000",
      })
    ).json();
    expect(draft.formulationStatus).toBe("DRAFT");

    const blocked = await app.inject({
      method: "POST",
      url: `/industrial-costs/${draft.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("formulation_not_stable");

    await activateFormulation(app, formulationVersionId);
    const activated = await app.inject({
      method: "POST",
      url: `/industrial-costs/${draft.id}/activate`,
      payload: {},
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().status).toBe("ACTIVE");

    await app.close();
  });

  it("continua na formulação congelada quando outra versão vira ativa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { product, formulationVersionId, veridiMaterial } =
      await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);

    const cost = (await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })).json();
    await app.inject({ method: "POST", url: `/industrial-costs/${cost.id}/activate`, payload: {} });

    // Nova formulação ativa do produto (nova versão a partir da ativa).
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
        components: [{ itemId: veridiMaterial.id, quantity: "0.7", unitCode: "kg" }],
      },
    });
    const nextActivation = await activateFormulation(app, next.id);
    expect(nextActivation.statusCode, JSON.stringify(nextActivation.json())).toBe(200);

    const reread = (await app.inject({ method: "GET", url: `/industrial-costs/${cost.id}` })).json();
    expect(reread.formulationVersionId).toBe(formulationVersionId);
    expect(reread.activeFormulationVersionNumber).toBe(2);
    // A defasagem é informada, não corrigida automaticamente.
    expect(
      reread.pendencies.some((row: { code: string }) => row.code === "FORMULATION_OUTDATED"),
    ).toBe(true);

    const stored = await prisma.industrialCostVersion.findUniqueOrThrow({ where: { id: cost.id } });
    expect(stored.formulationVersionId).toBe(formulationVersionId);

    await app.close();
  });

  it("mostra material do cliente na estrutura física sem custo Veridi", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId, customerMaterial, veridiMaterial, packaging } =
      await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);

    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();

    const materials = version.materials as {
      itemId: string;
      customerSupplied: boolean;
      itemType: string;
    }[];
    expect(materials).toHaveLength(3);
    expect(materials.find((row) => row.itemId === veridiMaterial.id)!.customerSupplied).toBe(false);
    expect(materials.find((row) => row.itemId === customerMaterial.id)!.customerSupplied).toBe(true);
    expect(materials.find((row) => row.itemId === packaging.id)!.itemType).toBe("PACKAGING");

    // Nada da formulação vira linha manual.
    expect(version.lines).toHaveLength(0);

    await app.close();
  });
});

describe("Estrutura de custos — premissas manuais", () => {
  it("aceita as categorias da fase e recusa recursos industriais", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app, {
      unitsPerShippingBox: 12,
    });
    await activateFormulation(app, formulationVersionId);
    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();

    const box = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "SECONDARY_PACKAGING",
        description: "Caixa de expedição",
        calculationBasis: "PER_SHIPPING_BOX",
        rateValue: "3.50",
      },
    });
    expect(box.statusCode).toBe(201);
    expect(box.json().lines[0].rateValue).toBe("3.5");

    // Mão de obra, equipamento e energia entram com os recursos industriais.
    for (const category of ["LABOR", "EQUIPMENT", "ENERGY"]) {
      const refused = await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/lines`,
        payload: {
          category,
          description: "Operador",
          calculationBasis: "FIXED_PER_BATCH",
          rateValue: "100",
        },
      });
      expect(refused.statusCode).toBe(400);
    }

    await app.close();
  });

  it("guarda percentual como número inteiro de porcento e recusa exagero", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);
    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();

    const overhead = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "OVERHEAD",
        description: "Rateio industrial",
        calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
        rateValue: "10",
      },
    });
    // 10 = 10%, nunca 0.10.
    expect(overhead.json().lines[0].rateValue).toBe("10");

    const absurd = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "OVERHEAD",
        description: "Erro de digitação",
        calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
        rateValue: "5000",
      },
    });
    expect(absurd.statusCode).toBe(400);

    await app.close();
  });

  it("mantém valor não informado como nulo e marca a estrutura como incompleta", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);
    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();
    expect(version.complete).toBe(true);

    const withUnknown = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/lines`,
        payload: {
          category: "OVERHEAD",
          description: "Rateio a definir",
          calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
        },
      })
    ).json();

    // Desconhecido continua desconhecido: nunca vira zero.
    expect(withUnknown.lines[0].rateValue).toBeNull();
    expect(withUnknown.complete).toBe(false);
    expect(
      withUnknown.pendencies.some((row: { code: string }) => row.code === "RATE_NOT_INFORMED"),
    ).toBe(true);

    await app.close();
  });

  it("aponta pendência quando a caixa de expedição não está configurada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);
    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();

    const withBox = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/lines`,
        payload: {
          category: "SECONDARY_PACKAGING",
          description: "Caixa de expedição",
          calculationBasis: "PER_SHIPPING_BOX",
          rateValue: "3.50",
        },
      })
    ).json();

    expect(withBox.complete).toBe(false);
    expect(
      withBox.pendencies.some((row: { code: string }) => row.code === "SHIPPING_BOX_NOT_CONFIGURED"),
    ).toBe(true);

    await app.close();
  });

  it("só ativa estrutura incompleta com confirmação explícita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);
    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "OTHER",
        description: "Serviço a orçar",
        calculationBasis: "FIXED_PER_BATCH",
      },
    });

    const refused = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: {},
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("incomplete_structure");

    const confirmed = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("ACTIVE");
    // Ativar não preenche zeros no lugar do desconhecido.
    expect(confirmed.json().lines[0].rateValue).toBeNull();
    expect(confirmed.json().complete).toBe(false);

    await app.close();
  });
});

describe("Estrutura de custos — sem efeito colateral", () => {
  it("não altera custo real de aquisição nem ofertas de fornecedor", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const before = {
      receiptLinesWithCost: await prisma.receiptLine.count({
        where: { actualUnitCost: { not: null } },
      }),
      offers: await prisma.supplierItemOffer.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    const { product, formulationVersionId } = await createProductWithFormulation(app);
    await activateFormulation(app, formulationVersionId);
    const version = (
      await createCostVersion(app, product.id, { referenceOutputQuantity: "1000" })
    ).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "THIRD_PARTY_SERVICE",
        description: "Análise externa",
        calculationBasis: "FIXED_PER_BATCH",
        rateValue: "500",
      },
    });
    await app.inject({ method: "POST", url: `/industrial-costs/${version.id}/activate`, payload: {} });

    const after = {
      receiptLinesWithCost: await prisma.receiptLine.count({
        where: { actualUnitCost: { not: null } },
      }),
      offers: await prisma.supplierItemOffer.count(),
      movements: await prisma.inventoryMovement.count(),
    };
    // Estrutura de custo não é custo real: a Foundation não se mexe.
    expect(after).toEqual(before);

    await app.close();
  });

  it("perfis sem escrita apenas consultam", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const purchasing = buildTestApp("PURCHASING");
    await purchasing.ready();

    const { product, formulationVersionId } = await createProductWithFormulation(admin);
    await activateFormulation(admin, formulationVersionId);
    const version = (
      await createCostVersion(admin, product.id, { referenceOutputQuantity: "1000" })
    ).json();

    const write = await createCostVersion(purchasing, product.id, {
      referenceOutputQuantity: "1000",
    });
    expect(write.statusCode).toBe(403);

    const read = await purchasing.inject({
      method: "GET",
      url: `/industrial-costs/${version.id}`,
    });
    expect(read.statusCode).toBe(200);

    await admin.close();
    await purchasing.close();
  });
});
