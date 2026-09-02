import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
  await prisma.unitOfMeasure.upsert({
    where: { code: "g" },
    update: {},
    create: { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: 1 },
  });
  await prisma.unitOfMeasure.upsert({
    where: { code: "mg" },
    update: {},
    create: { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: 0.001 },
  });
  await prisma.unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: 1 },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
    // Estrutura de custos referencia a versão de formulação: sai primeiro,
    // senão a limpeza esbarra na FK e derruba o arquivo inteiro no `afterAll`.
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
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
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; active?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-FORM-${m}`,
      name: `Item Formulação Teste ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: overrides.active ?? true,
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
      name: `Produto Formulação Teste ${marker()}`,
      ...(finishedProductItemId ? { finishedProductItemId } : {}),
    },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

describe("Formulations — versionamento", () => {
  it("cria V1 DRAFT quando o produto ainda não tem formulação", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);

    const response = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.versionNumber).toBe(1);
    expect(body.versionLabel).toBe("V1");
    expect(body.status).toBe("DRAFT");
    expect(body.outputItemId).toBe(finishedItem.id);
    expect(body.outputUnitCode).toBe(finishedItem.unitCode);
    expect(body.components).toEqual([]);

    await app.close();
  });

  it("produto sem Finished Product Item não pode criar formulação", async () => {
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
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("missing_finished_item");

    await app.close();
  });

  it("concorrência: criação simultânea de V1 só permite uma", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);

    const attempt = () =>
      app.inject({
        method: "POST",
        url: `/products/${product.id}/formulation-versions`,
        payload: {},
      });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    await app.close();
  });

  it("adiciona componente RAW_MATERIAL e PACKAGING, calcula equivalente de estoque (g → kg)", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const versionId = created.json().id;

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg" });
    const packaging = await createItem("PACKAGING", { unitCode: "un" });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${versionId}`,
      payload: {
        basisQuantity: "1000",
        components: [
          { itemId: rawMaterial.id, quantity: "500", unitCode: "g" },
          { itemId: packaging.id, quantity: "1000", unitCode: "un" },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.components).toHaveLength(2);

    const rawComponent = body.components.find((c: { itemId: string }) => c.itemId === rawMaterial.id);
    expect(rawComponent.quantity).toBe("500");
    expect(rawComponent.unitCode).toBe("g");
    expect(rawComponent.stockEquivalentQuantity).toBe("0.5");
    expect(rawComponent.stockUnitCode).toBe("kg");

    const packagingComponent = body.components.find(
      (c: { itemId: string }) => c.itemId === packaging.id,
    );
    expect(packagingComponent.stockEquivalentQuantity).toBe("1000");

    await app.close();
  });

  it("conversão mg → kg correta (precisão decimal)", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const versionId = created.json().id;

    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg" });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${versionId}`,
      payload: { components: [{ itemId: rawMaterial.id, quantity: "250000", unitCode: "mg" }] },
    });

    expect(response.json().components[0].stockEquivalentQuantity).toBe("0.25");

    await app.close();
  });

  it("rejeita FINISHED_PRODUCT como componente", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const otherFinished = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { components: [{ itemId: otherFinished.id, quantity: "1", unitCode: "kg" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_component_type");

    await app.close();
  });

  it("rejeita componente duplicado na mesma versão", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: {
        components: [
          { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
          { itemId: rawMaterial.id, quantity: "2", unitCode: "kg" },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("duplicate_component");

    await app.close();
  });

  it("rejeita quantidade <= 0", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { components: [{ itemId: rawMaterial.id, quantity: "0", unitCode: "kg" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");

    await app.close();
  });

  it("rejeita basisQuantity <= 0", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { basisQuantity: "0" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");

    await app.close();
  });

  it("rejeita dimensão de unidade incompatível", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL", { unitCode: "kg" });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { components: [{ itemId: rawMaterial.id, quantity: "1", unitCode: "un" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("incompatible_component_unit");

    await app.close();
  });

  it("DRAFT pode ser salva incompleta (sem componentes)", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { notes: "Ainda montando" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().components).toEqual([]);

    await app.close();
  });

  it("ativação bloqueia versão sem componentes", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });

    const response = await app.inject({
      method: "POST",
      url: `/formulation-versions/${created.json().id}/activate`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("activation_blocked");

    await app.close();
  });

  it("fluxo completo: DRAFT → ACTIVE, versão fica imutável", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      },
    });

    const activated = await app.inject({
      method: "POST",
      url: `/formulation-versions/${created.json().id}/activate`,
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().status).toBe("ACTIVE");
    expect(activated.json().activatedAt).not.toBeNull();
    expect(activated.json().activatedBy).not.toBeNull();

    const editAttempt = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { basisQuantity: "2000" },
    });
    expect(editAttempt.statusCode).toBe(400);
    expect(editAttempt.json().error).toBe("version_not_draft");

    const reactivateAttempt = await app.inject({
      method: "POST",
      url: `/formulation-versions/${created.json().id}/activate`,
    });
    expect(reactivateAttempt.statusCode).toBe(400);
    expect(reactivateAttempt.json().error).toBe("version_not_draft");

    await app.close();
  });

  it("nova versão copia dados da ACTIVE; V1 continua ativa enquanto V2 é DRAFT", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: rawMaterial.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });
    expect(v2.statusCode).toBe(201);
    expect(v2.json().versionNumber).toBe(2);
    expect(v2.json().status).toBe("DRAFT");
    expect(v2.json().basisQuantity).toBe("1000");
    expect(v2.json().components).toHaveLength(1);
    expect(v2.json().components[0].itemId).toBe(rawMaterial.id);

    const v1Fetched = await app.inject({ method: "GET", url: `/formulation-versions/${v1.json().id}` });
    expect(v1Fetched.json().status).toBe("ACTIVE");

    await app.close();
  });

  it("volta a uma receita antiga criando versão a partir dela, sem reativar nada", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const original = await createItem("RAW_MATERIAL");
    const substituto = await createItem("RAW_MATERIAL");

    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: original.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    // V2 troca o componente e passa a valer; a V1 vira histórica.
    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v2.json().id}`,
      payload: { components: [{ itemId: substituto.id, quantity: "5", unitCode: "kg" }] },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v2.json().id}/activate` });

    const v1Historica = await app.inject({
      method: "GET",
      url: `/formulation-versions/${v1.json().id}`,
    });
    expect(v1Historica.json().status).toBe("INACTIVE");

    // Arrependimento: voltar para a receita da V1. Reativar seria reescrever
    // o significado de uma versão que já serviu de base para custo; a volta
    // acontece para frente, como V3.
    const v3 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });
    expect(v3.statusCode, v3.body).toBe(201);
    expect(v3.json().versionNumber).toBe(3);
    expect(v3.json().status).toBe("DRAFT");
    expect(v3.json().components).toHaveLength(1);
    expect(v3.json().components[0].itemId).toBe(original.id);
    // Sem a origem declarada, o salto de custo entre V2 e V3 não teria
    // explicação possível meses depois.
    expect(v3.json().sourceVersionNumber).toBe(1);
    expect(v3.json().sourceVersionId).toBe(v1.json().id);

    // Nada do passado se moveu: a V2 continua sendo a ativa até a V3 ser.
    const v2Depois = await app.inject({
      method: "GET",
      url: `/formulation-versions/${v2.json().id}`,
    });
    expect(v2Depois.json().status).toBe("ACTIVE");
    const v1Depois = await app.inject({
      method: "GET",
      url: `/formulation-versions/${v1.json().id}`,
    });
    expect(v1Depois.json().status).toBe("INACTIVE");

    await app.close();
  });

  it("ativar a receita nova arrasta rascunho de custo, e nunca versão ativa nem rascunho fixado", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT", { unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);
    const material = await createItem("RAW_MATERIAL");
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: material.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    const criarEstrutura = async (payload: Record<string, unknown>) =>
      (
        await app.inject({
          method: "POST",
          url: `/products/${product.id}/industrial-costs`,
          payload: { referenceOutputQuantity: "1000", ...payload },
        })
      ).json();

    // Uma estrutura vira ATIVA na V1 — ela é base econômica e não se move.
    const ativa = await criarEstrutura({});
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ativa.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    // Um rascunho por produto: nasce seguindo a ativa.
    const rascunho = await criarEstrutura({});
    expect(rascunho.formulationPinned).toBe(false);

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-versions/${v1.json().id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v2.id}`,
      payload: { components: [{ itemId: material.id, quantity: "7", unitCode: "kg" }] },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v2.id}/activate` });

    const ler = async (id: string) =>
      (await app.inject({ method: "GET", url: `/industrial-costs/${id}` })).json();

    // Rascunho sem compromisso acompanha — e a receita nova é LIDA da
    // formulação, não copiada.
    expect((await ler(rascunho.id)).formulationVersionNumber).toBe(2);
    expect((await ler(rascunho.id)).materials[0].quantity).toBe("7");
    // Base econômica jamais se move.
    expect((await ler(ativa.id)).formulationVersionNumber).toBe(1);
    expect((await ler(ativa.id)).status).toBe("ACTIVE");

    // Ficar na V1 agora é distinguível de "usar a ativa" — e vira decisão.
    const preso = await app.inject({
      method: "PATCH",
      url: `/industrial-costs/${rascunho.id}`,
      payload: { formulationVersionId: v1.json().id },
    });
    expect(preso.json().formulationPinned).toBe(true);

    // Uma V3 ativa não arrasta o que foi fixado.
    const v3 = (
      await app.inject({ method: "POST", url: `/formulation-versions/${v2.id}/new-version` })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v3.id}`,
      payload: { components: [{ itemId: material.id, quantity: "9", unitCode: "kg" }] },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v3.id}/activate` });
    expect((await ler(rascunho.id)).formulationVersionNumber).toBe(1);

    // Voltar para a ativa desfixa, e o rascunho volta a acompanhar.
    const solto = await app.inject({
      method: "PATCH",
      url: `/industrial-costs/${rascunho.id}`,
      payload: { formulationVersionId: v3.id },
    });
    expect(solto.json().formulationPinned).toBe(false);
    expect((await ler(rascunho.id)).formulationVersionNumber).toBe(3);

    await app.close();
  });

  it("o raio de impacto de ativar lista o que fica defasado — e nada além disso", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT", { unitCode: "un" });
    const product = await createProduct(app, finishedItem.id);
    const material = await createItem("RAW_MATERIAL");
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: material.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    // Estrutura de custos nasce na V1 e é ativada.
    const estrutura = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "1000" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${estrutura.id}/activate`,
      payload: { confirmIncomplete: true },
    });

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-versions/${v1.json().id}/new-version`,
      })
    ).json();

    const impacto = await app.inject({
      method: "GET",
      url: `/formulation-versions/${v2.id}/activation-impact`,
    });
    expect(impacto.statusCode, impacto.body).toBe(200);
    expect(impacto.json().costStructures).toHaveLength(1);
    expect(impacto.json().costStructures[0].id).toBe(estrutura.id);
    expect(impacto.json().costStructures[0].status).toBe("ACTIVE");
    expect(impacto.json().costStructures[0].formulationVersionNumber).toBe(1);
    expect(impacto.json().productionOrders).toEqual([]);

    // Consultar o impacto é leitura: nada se moveu por perguntar.
    const estruturaDepois = await app.inject({
      method: "GET",
      url: `/industrial-costs/${estrutura.id}`,
    });
    expect(estruturaDepois.json().status).toBe("ACTIVE");
    expect(estruturaDepois.json().formulationVersionNumber).toBe(1);

    // A própria versão que está sendo ativada nunca aparece como defasada.
    const daV1 = await app.inject({
      method: "GET",
      url: `/formulation-versions/${v1.json().id}/activation-impact`,
    });
    expect(daV1.json().costStructures).toEqual([]);

    await app.close();
  });

  it("rascunho não serve de origem, e a cópia declara o que vai barrar a ativação", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const material = await createItem("RAW_MATERIAL");
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: material.id, quantity: "5", unitCode: "kg" }],
      },
    });

    // Rascunho ainda é editável: duplicá-lo deixaria dois documentos abertos
    // dizendo a mesma coisa.
    const deRascunho = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });
    expect(deRascunho.statusCode).toBe(400);
    expect(deRascunho.json().error).toBe("version_is_draft_source");

    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });
    // O item some do catálogo DEPOIS de a receita existir.
    await getPrisma().item.update({ where: { id: material.id }, data: { active: false } });

    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });
    expect(v2.statusCode, v2.body).toBe(201);
    // A cópia é fiel — alterar a receita em silêncio para caber nas regras de
    // hoje seria inventar fórmula.
    expect(v2.json().components).toHaveLength(1);
    // ...e diz o que vai barrar, antes do clique de ativar.
    expect(v2.json().componentIssues).toHaveLength(1);
    expect(v2.json().componentIssues[0].code).toBe("ITEM_INACTIVE");
    expect(v2.json().componentIssues[0].itemId).toBe(material.id);

    const ativacao = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v2.json().id}/activate`,
    });
    expect(ativacao.statusCode).toBe(400);

    // Versão fechada não lista problema: não há edição possível nela.
    const v1Fetched = await app.inject({
      method: "GET",
      url: `/formulation-versions/${v1.json().id}`,
    });
    expect(v1Fetched.json().componentIssues).toEqual([]);

    await app.close();
  });

  it("ativar V2 torna V1 INACTIVE atomicamente; produto tem no máximo uma ACTIVE", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: rawMaterial.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });
    const v2Activated = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v2.json().id}/activate`,
    });
    expect(v2Activated.statusCode).toBe(200);
    expect(v2Activated.json().status).toBe("ACTIVE");

    const v1Fetched = await app.inject({ method: "GET", url: `/formulation-versions/${v1.json().id}` });
    expect(v1Fetched.json().status).toBe("INACTIVE");
    expect(v1Fetched.json().inactivatedAt).not.toBeNull();
    // conteudo historico da V1 nao muda
    expect(v1Fetched.json().basisQuantity).toBe("1000");
    expect(v1Fetched.json().components).toHaveLength(1);

    const list = await app.inject({ method: "GET", url: `/products/${product.id}/formulations` });
    const activeCount = list
      .json()
      .versions.filter((v: { status: string }) => v.status === "ACTIVE").length;
    expect(activeCount).toBe(1);

    await app.close();
  });

  it("item inativo histórico continua visível na versão", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: rawMaterial.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    await getPrisma().item.update({ where: { id: rawMaterial.id }, data: { active: false } });

    const fetched = await app.inject({ method: "GET", url: `/formulation-versions/${v1.json().id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().components[0].itemActive).toBe(false);
    expect(fetched.json().components[0].itemId).toBe(rawMaterial.id);

    await app.close();
  });

  it("componente inativo bloqueia ativação de nova versão copiada", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const v1 = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: rawMaterial.id, quantity: "5", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${v1.json().id}/activate` });

    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.json().id}/new-version`,
    });

    await getPrisma().item.update({ where: { id: rawMaterial.id }, data: { active: false } });

    const activateAttempt = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v2.json().id}/activate`,
    });
    expect(activateAttempt.statusCode).toBe(400);
    expect(activateAttempt.json().error).toBe("activation_blocked");
    expect(activateAttempt.json().message).toContain(rawMaterial.code);

    await app.close();
  });

  it("Finished Product Item inativo bloqueia ativação", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: {
        basisQuantity: "1000",
        components: [{ itemId: rawMaterial.id, quantity: "5", unitCode: "kg" }],
      },
    });

    await getPrisma().item.update({ where: { id: finishedItem.id }, data: { active: false } });

    const activateAttempt = await app.inject({
      method: "POST",
      url: `/formulation-versions/${created.json().id}/activate`,
    });
    expect(activateAttempt.statusCode).toBe(400);
    expect(activateAttempt.json().error).toBe("activation_blocked");

    await app.close();
  });

  it("adicionar item inativo como componente NOVO é rejeitado", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const inactiveRaw = await createItem("RAW_MATERIAL", { active: false });

    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { components: [{ itemId: inactiveRaw.id, quantity: "1", unitCode: "kg" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_component");

    await app.close();
  });

  it("componente já existente na versão (herdado) continua editável mesmo se o item foi inativado depois", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    });
    const rawMaterial = await createItem("RAW_MATERIAL");
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: { components: [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }] },
    });

    await getPrisma().item.update({ where: { id: rawMaterial.id }, data: { active: false } });

    // Reenvia a MESMA linha (ja existente) com quantidade alterada — deve
    // continuar permitido, mesmo com o item agora inativo.
    const response = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${created.json().id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: rawMaterial.id, quantity: "3", unitCode: "kg" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().components[0].quantity).toBe("3");

    await app.close();
  });
});
