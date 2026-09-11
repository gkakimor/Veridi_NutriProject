import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProductionOrderDTO, ProductionProfileDTO } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * PLANEJAMENTO PREVISTO da OP — PLANNING-OP-SNAPSHOT-01, `PRODUCT_RULES.md` §89.
 *
 * Três promessas sob teste:
 *
 * 1. a OP recebe uma CÓPIA do Perfil na criação, e é dona dela: ativar V2
 *    depois não alcança a ordem que já levou a V1, nem em rascunho;
 * 2. a quantidade refaz a PROJEÇÃO, nunca a cópia — e a cópia sobrevive a
 *    renomear ou desativar o recurso;
 * 3. aplicar/atualizar o perfil é ação de RASCUNHO. Fora dele, congelado.
 */

type App = ReturnType<typeof buildTestApp>;
const app: App = buildTestApp("ADMIN");

const fixtureProfileIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureOrderIds: string[] = [];

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

let operadorId: string;
let misturadorId: string;

beforeAll(async () => {
  await app.ready();
  const prisma = getPrisma();
  for (const unit of [
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const recurso = async (nome: string, type: "LABOR" | "EQUIPMENT") => {
    const criado = await prisma.industrialResource.create({
      data: {
        code: `RIN-OPS-${proximo()}`,
        name: `${nome} ${marca}`,
        type,
        defaultUsageUom: "HOUR",
      },
    });
    fixtureResourceIds.push(criado.id);
    return criado.id;
  };
  operadorId = await recurso("Mão de obra — Produção", "LABOR");
  misturadorId = await recurso("Misturador", "EQUIPMENT");
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureOrderIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureProfileIds.length > 0) {
    await prisma.productionProfile.deleteMany({ where: { id: { in: fixtureProfileIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  await app.close();
});

// ─────────────────────────────────────────────────────────────── fixtures

const etapa = (name: string, sobre: Record<string, unknown> = {}) => ({
  name,
  setupDurationMinutes: 0,
  runDurationMinutes: 120,
  scalingMode: "PROPORTIONAL",
  resources: [],
  ...sobre,
});

/** Perfil com a V1 ATIVA — o ponto de partida de quem já pode usar o perfil. */
async function perfilAtivo(steps: unknown[], referenceQuantity = "1000") {
  const criado = await app.inject({
    method: "POST",
    url: "/production-profiles",
    payload: { name: `Cápsulas ${proximo()}`, referenceQuantity, referenceUomCode: "un" },
  });
  expect(criado.statusCode).toBe(201);
  const perfil = criado.json() as ProductionProfileDTO;
  fixtureProfileIds.push(perfil.id);

  const rascunho = perfil.draftVersion!.id;
  expect((await app.inject({ method: "PATCH", url: `/production-profile-versions/${rascunho}`, payload: { steps } })).statusCode).toBe(200);
  const ativa = await app.inject({ method: "POST", url: `/production-profile-versions/${rascunho}/activate` });
  expect(ativa.statusCode).toBe(200);

  return { perfilId: perfil.id, versionId: rascunho };
}

/** Nova versão a partir da ativa, com outras etapas, já ATIVA. */
async function proximaVersaoAtiva(sourceVersionId: string, steps: unknown[]) {
  const nova = await app.inject({
    method: "POST",
    url: `/production-profile-versions/${sourceVersionId}/new-version`,
  });
  expect(nova.statusCode).toBe(201);
  const rascunho = nova.json().id as string;
  expect((await app.inject({ method: "PATCH", url: `/production-profile-versions/${rascunho}`, payload: { steps } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `/production-profile-versions/${rascunho}/activate` })).statusCode).toBe(200);
  return rascunho;
}

async function produto(unitCode = "un") {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-OPS-${proximo()}`,
      name: `Produto acabado ${marca}`,
      unitCode,
    },
  });
  fixtureItemIds.push(item.id);
  const criado = await prisma.product.create({
    data: {
      code: `PROD-OPS-${proximo()}`,
      name: `Produto ${marca}`,
      finishedProductItemId: item.id,
    },
  });
  fixtureProductIds.push(criado.id);
  return criado;
}

/**
 * O mesmo produto, com formulação V1 ATIVA de um componente — o mínimo para
 * a OP passar no gate de planejamento. Aqui é meio, não objeto de teste: o
 * que interessa é a OP sair de DRAFT.
 */
async function produtoPlanejavel() {
  const prisma = getPrisma();
  const item = await produto();
  const materia = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-OPS-${proximo()}`,
      name: `Matéria-prima ${marca}`,
      unitCode: "kg",
    },
  });
  fixtureItemIds.push(materia.id);

  const criada = await app.inject({
    method: "POST",
    url: `/products/${item.id}/formulation-versions`,
    payload: {},
  });
  const versionId = criada.json().id as string;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: "1000",
      components: [{ itemId: materia.id, quantity: "10", unitCode: "kg" }],
    },
  });
  expect((await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` })).statusCode).toBe(200);
  return item;
}

function definirPadrao(productId: string, productionProfileVersionId: string | null) {
  return app.inject({
    method: "PUT",
    url: `/products/${productId}/production-profile`,
    payload: { productionProfileVersionId },
  });
}

async function criarOP(productId: string, plannedQuantity = "3000"): Promise<ProductionOrderDTO> {
  const resposta = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity },
  });
  expect(resposta.statusCode).toBe(201);
  const ordem = resposta.json() as ProductionOrderDTO;
  fixtureOrderIds.push(ordem.id);
  return ordem;
}

const ler = async (id: string) =>
  (await app.inject(`/production-orders/${id}`)).json() as ProductionOrderDTO;

// ────────────────────────────────────────────────────────────────── testes

describe("Cópia do Perfil de Produção na criação da OP", () => {
  it("copia o perfil padrão do produto e guarda a versão de origem", async () => {
    const { perfilId, versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const item = await produto();
    expect((await definirPadrao(item.id, versionId)).statusCode).toBe(200);

    const ordem = await criarOP(item.id);

    expect(ordem.planning.snapshot).not.toBeNull();
    expect(ordem.planning.snapshot!.sourceProfileId).toBe(perfilId);
    expect(ordem.planning.snapshot!.sourceVersionId).toBe(versionId);
    expect(ordem.planning.snapshot!.sourceVersionNumber).toBe(1);
    expect(ordem.planning.snapshot!.sourceProfileCode).toMatch(/^PPR-\d{6}$/);
    expect(ordem.planning.snapshot!.steps.map((passo) => passo.name)).toEqual(["Pesagem"]);
    // Cópia tirada, nada a aplicar nem a atualizar.
    expect(ordem.planning.canApply).toBe(false);
    expect(ordem.planning.canUpdate).toBe(false);
  });

  it("produto sem perfil padrão: a OP nasce válida, e sem planejamento previsto", async () => {
    const item = await produtoPlanejavel();
    const ordem = await criarOP(item.id);

    expect(ordem.planning.snapshot).toBeNull();
    expect(ordem.planning.plan).toBeNull();
    expect(ordem.status).toBe("DRAFT");
    // Não bloqueia planejar: a OP segue o fluxo normal sem perfil.
    expect((await app.inject({ method: "POST", url: `/production-orders/${ordem.id}/plan` })).statusCode).toBe(200);
  });

  it("ativar a V2 depois não muda a OP que já copiou a V1 — e a OP nova recebe a V2", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const item = await produto();
    await definirPadrao(item.id, versionId);

    const antiga = await criarOP(item.id);
    expect(antiga.planning.snapshot!.sourceVersionNumber).toBe(1);

    const v2 = await proximaVersaoAtiva(versionId, [
      etapa("Pesagem", { runDurationMinutes: 30 }),
      etapa("Mistura", { runDurationMinutes: 180 }),
    ]);

    // A OP antiga continua na V1, mesmo em rascunho.
    const relida = await ler(antiga.id);
    expect(relida.status).toBe("DRAFT");
    expect(relida.planning.snapshot!.sourceVersionId).toBe(versionId);
    expect(relida.planning.snapshot!.steps.map((passo) => passo.name)).toEqual(["Pesagem"]);
    // E o aviso discreto aparece: há versão mais recente.
    expect(relida.planning.canUpdate).toBe(true);
    expect(relida.planning.availableProfile!.versionNumber).toBe(2);

    const nova = await criarOP(item.id);
    expect(nova.planning.snapshot!.sourceVersionId).toBe(v2);
    expect(nova.planning.snapshot!.steps.map((passo) => passo.name)).toEqual(["Pesagem", "Mistura"]);
    expect(nova.planning.canUpdate).toBe(false);
  });
});

describe("Projeção para a quantidade da OP", () => {
  it("proporcional: 2 h por 1.000 un viram 6 h para 3.000 un, com a preparação somada uma vez", async () => {
    const { versionId } = await perfilAtivo([
      etapa("Mistura", { setupDurationMinutes: 30, runDurationMinutes: 120 }),
    ]);
    const item = await produto();
    await definirPadrao(item.id, versionId);

    const ordem = await criarOP(item.id, "3000");

    const passo = ordem.planning.plan!.steps[0]!;
    expect(passo.runMinutes).toBe("360");
    expect(passo.setupMinutes).toBe("30");
    // Setup não escala, e a etapa é preparação + execução.
    expect(passo.durationMinutes).toBe("390");
    expect(ordem.planning.plan!.totalDurationMinutes).toBe("390");
  });

  it("por lote: lote começado é lote inteiro, e a preparação não se multiplica", async () => {
    const { versionId } = await perfilAtivo([
      etapa("Encapsulagem", {
        setupDurationMinutes: 30,
        runDurationMinutes: 120,
        scalingMode: "BY_BATCH",
      }),
    ]);
    const item = await produto();
    await definirPadrao(item.id, versionId);

    const ordem = await criarOP(item.id, "1500");

    const passo = ordem.planning.plan!.steps[0]!;
    expect(passo.batches).toBe(2);
    expect(passo.runMinutes).toBe("240");
    expect(passo.durationMinutes).toBe("270");
  });

  it("quantidade de recursos é demanda de capacidade, não duração da etapa", async () => {
    const { versionId } = await perfilAtivo([
      etapa("Mistura", {
        setupDurationMinutes: 30,
        runDurationMinutes: 120,
        resources: [
          { industrialResourceId: operadorId, resourceQuantity: 2 },
          { industrialResourceId: misturadorId, resourceQuantity: 1 },
        ],
      }),
    ]);
    const item = await produto();
    await definirPadrao(item.id, versionId);

    const ordem = await criarOP(item.id, "1000");

    const passo = ordem.planning.plan!.steps[0]!;
    // 30 + 120: dois operadores não encurtam nem alongam a etapa.
    expect(passo.durationMinutes).toBe("150");
    const demanda = Object.fromEntries(
      ordem.planning.plan!.resources.map((recurso) => [recurso.industrialResourceId, recurso.demandMinutes]),
    );
    // Setup incluído: o recurso fica ocupado também na preparação.
    expect(demanda[operadorId]).toBe("300");
    expect(demanda[misturadorId]).toBe("150");
  });

  it("mudar a quantidade em rascunho recalcula sem recopiar o perfil", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 120 })]);
    const item = await produto();
    await definirPadrao(item.id, versionId);

    const ordem = await criarOP(item.id, "1000");
    expect(ordem.planning.plan!.totalDurationMinutes).toBe("120");
    const copiadoEm = ordem.planning.appliedAt;

    // Versão nova ativa no meio do caminho: a OP não pode escorregar para ela.
    await proximaVersaoAtiva(versionId, [etapa("Outra", { runDurationMinutes: 999 })]);

    const alterada = await app.inject({
      method: "PATCH",
      url: `/production-orders/${ordem.id}`,
      payload: { plannedQuantity: "3000" },
    });
    expect(alterada.statusCode).toBe(200);
    const depois = alterada.json() as ProductionOrderDTO;

    expect(depois.planning.snapshot!.sourceVersionId).toBe(versionId);
    expect(depois.planning.appliedAt).toBe(copiadoEm);
    expect(depois.planning.plan!.totalDurationMinutes).toBe("360");
  });

  it("renomear ou desativar o recurso não muda a visualização histórica da OP", async () => {
    const { versionId } = await perfilAtivo([
      etapa("Mistura", {
        runDurationMinutes: 60,
        resources: [{ industrialResourceId: misturadorId, resourceQuantity: 1 }],
      }),
    ]);
    const item = await produto();
    await definirPadrao(item.id, versionId);
    const ordem = await criarOP(item.id, "1000");
    const nomeCongelado = ordem.planning.snapshot!.steps[0]!.resources[0]!.resourceName;

    await getPrisma().industrialResource.update({
      where: { id: misturadorId },
      data: { name: `Misturador RENOMEADO ${marca}`, active: false },
    });

    const relida = await ler(ordem.id);
    const recurso = relida.planning.snapshot!.steps[0]!.resources[0]!;
    expect(recurso.resourceName).toBe(nomeCongelado);
    expect(recurso.industrialResourceId).toBe(misturadorId);
    expect(relida.planning.plan!.resources[0]!.resourceName).toBe(nomeCongelado);

    // Devolve o cadastro, que outros casos deste arquivo usam.
    await getPrisma().industrialResource.update({
      where: { id: misturadorId },
      data: { name: `Misturador ${marca}`, active: true },
    });
  });
});

describe("Aplicar e atualizar o perfil", () => {
  it("OP rascunho sem cópia aplica o perfil atual do produto", async () => {
    const item = await produto();
    const ordem = await criarOP(item.id, "2000");
    expect(ordem.planning.snapshot).toBeNull();
    expect(ordem.planning.canApply).toBe(false);

    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 120 })]);
    await definirPadrao(item.id, versionId);

    // Agora o produto tem padrão: a ação é oferecida.
    expect((await ler(ordem.id)).planning.canApply).toBe(true);

    const aplicada = await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/production-profile`,
    });
    expect(aplicada.statusCode).toBe(200);
    const depois = aplicada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(versionId);
    expect(depois.planning.plan!.totalDurationMinutes).toBe("240");
    expect(depois.planning.canApply).toBe(false);
  });

  it("produto sem perfil padrão recusa a aplicação, com mensagem própria", async () => {
    const item = await produto();
    const ordem = await criarOP(item.id);

    const recusada = await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/production-profile`,
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("no_production_profile");
    expect((await ler(ordem.id)).planning.snapshot).toBeNull();
  });

  it("OP rascunho com a V1 atualiza explicitamente para a V2", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const item = await produto();
    await definirPadrao(item.id, versionId);
    const ordem = await criarOP(item.id, "1000");
    expect(ordem.planning.snapshot!.sourceVersionNumber).toBe(1);

    const v2 = await proximaVersaoAtiva(versionId, [
      etapa("Pesagem", { runDurationMinutes: 30 }),
      etapa("Mistura", { runDurationMinutes: 180 }),
    ]);

    const atualizada = await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/production-profile`,
    });
    expect(atualizada.statusCode).toBe(200);
    const depois = atualizada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(v2);
    expect(depois.planning.snapshot!.sourceVersionNumber).toBe(2);
    expect(depois.planning.snapshot!.steps).toHaveLength(2);
    expect(depois.planning.canUpdate).toBe(false);
  });

  it("fora do rascunho a cópia é imutável, mesmo com versão mais nova disponível", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const item = await produtoPlanejavel();
    await definirPadrao(item.id, versionId);
    const ordem = await criarOP(item.id, "1000");

    expect((await app.inject({ method: "POST", url: `/production-orders/${ordem.id}/plan` })).statusCode).toBe(200);
    await proximaVersaoAtiva(versionId, [etapa("Outra", { runDurationMinutes: 999 })]);

    const recusada = await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/production-profile`,
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("order_locked");

    const relida = await ler(ordem.id);
    expect(relida.status).toBe("PLANNED");
    expect(relida.planning.snapshot!.sourceVersionId).toBe(versionId);
    // Sem ação possível: a tela nem recebe o padrão atual do produto.
    expect(relida.planning.availableProfile).toBeNull();
    expect(relida.planning.canApply).toBe(false);
    expect(relida.planning.canUpdate).toBe(false);
  });

  it("trocar o produto em rascunho troca a cópia inteira — e some quando o novo não tem perfil", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const comPerfil = await produto();
    await definirPadrao(comPerfil.id, versionId);
    const ordem = await criarOP(comPerfil.id, "1000");
    expect(ordem.planning.snapshot!.sourceVersionId).toBe(versionId);

    const { versionId: outraVersao } = await perfilAtivo([
      etapa("Encapsulagem", { runDurationMinutes: 60 }),
    ]);
    const outro = await produto();
    await definirPadrao(outro.id, outraVersao);

    const trocada = await app.inject({
      method: "PATCH",
      url: `/production-orders/${ordem.id}`,
      payload: { productId: outro.id },
    });
    expect(trocada.statusCode).toBe(200);
    const depois = trocada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(outraVersao);
    expect(depois.planning.snapshot!.steps.map((passo) => passo.name)).toEqual(["Encapsulagem"]);

    // Produto sem perfil: a cópia sai, e nunca fica a do produto anterior.
    const semPerfil = await produto();
    const semCopia = await app.inject({
      method: "PATCH",
      url: `/production-orders/${ordem.id}`,
      payload: { productId: semPerfil.id },
    });
    expect(semCopia.statusCode).toBe(200);
    expect((semCopia.json() as ProductionOrderDTO).planning.snapshot).toBeNull();
  });
});
