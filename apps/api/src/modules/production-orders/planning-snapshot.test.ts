import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProductionBoardResponse,
  ProductionOrderDTO,
  ProductionOrderListResponse,
  ProductionProfileDTO,
} from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * ROTEIRO DE PRODUÇÃO da OP — PLANNING-OP-SNAPSHOT-01 e
 * PRODUCTION-ROUTE-ASSIGNMENT-01, `PRODUCT_RULES.md` §89.
 *
 * O que está sob teste:
 *
 * 1. a OP recebe uma CÓPIA do roteiro e é dona dela: ativar V2/V3 depois não
 *    alcança a ordem que já levou a V1, nem em rascunho;
 * 2. a quantidade refaz a PROJEÇÃO, nunca a cópia — CONVERTIDA para a unidade
 *    de referência do roteiro (kg ↔ g), e unidade sem conversão recusa;
 * 3. sem roteiro a OP existe, mas não planeja nem libera;
 * 4. aplicar, escolher, definir padrão e aplicar, trocar com motivo e
 *    regularizar legado — com origem e motivo gravados, trava da ordem e 409
 *    para decisão tomada sobre tela velha;
 * 5. a pendência de roteiro é derivada: aparece, some ao aplicar, e mudar só o
 *    padrão do Produto não a resolve.
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
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
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

/** Roteiro com a V1 ATIVA — o ponto de partida de quem já pode usá-lo. */
async function perfilAtivo(steps: unknown[], referenceQuantity = "1000", referenceUomCode = "un") {
  const criado = await app.inject({
    method: "POST",
    url: "/production-profiles",
    payload: { name: `Cápsulas ${proximo()}`, referenceQuantity, referenceUomCode },
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
 * a OP passar no portão de planejamento. Aqui é meio, não objeto de teste.
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

const aplicar = (id: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: `/production-orders/${id}/production-profile`, payload });

const planejar = (id: string) => app.inject({ method: "POST", url: `/production-orders/${id}/plan` });

/** Situação gravada à mão: o legado que existe no banco e não passou pelos portões novos. */
const forcarSituacao = (id: string, status: "PLANNED" | "RELEASED" | "IN_PRODUCTION") =>
  getPrisma().productionOrder.update({ where: { id }, data: { status } });

/** Programação gravada à mão — o que importa aqui é ela existir. */
const programacaoExistente = (productionOrderId: string) =>
  getPrisma().productionOrderSchedule.create({
    data: {
      productionOrderId,
      plannedStartAt: new Date("2033-03-07T11:00:00.000Z"),
      plannedEndAt: new Date("2033-03-07T13:00:00.000Z"),
      workingMinutes: 120,
      steps: [],
    },
  });

// ────────────────────────────────────────────────────────────────── testes

describe("Cópia do roteiro na criação da OP", () => {
  it("copia o roteiro padrão do produto, guarda a versão de origem e a origem automática", async () => {
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
    expect(ordem.planning.applicationSource).toBe("AUTO_PRODUCT_DEFAULT");
    expect(ordem.planning.applicationReason).toBeNull();
    expect(ordem.planning.appliedBy).toBe("Usuário de Teste ADMIN");
    expect(ordem.planning.appliedAt).not.toBeNull();
    // Cópia tirada: nada a aplicar, nada pendente — só a troca em rascunho.
    expect(ordem.planning.canApply).toBe(false);
    expect(ordem.planning.canUpdate).toBe(false);
    expect(ordem.planning.routePending).toBe(false);
    expect(ordem.planning.canChoose).toBe(true);
  });

  it("produto sem roteiro padrão: a OP nasce em rascunho, sem roteiro — e não planeja até receber um", async () => {
    const item = await produtoPlanejavel();
    const ordem = await criarOP(item.id);

    expect(ordem.status).toBe("DRAFT");
    expect(ordem.planning.snapshot).toBeNull();
    expect(ordem.planning.plan).toBeNull();
    expect(ordem.planning.routePending).toBe(true);
    expect(ordem.planning.productDefaultProfile).toBeNull();
    expect(ordem.planning.canApply).toBe(false);
    expect(ordem.planning.canChoose).toBe(true);

    const recusada = await planejar(ordem.id);
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("route_required");
    expect(recusada.json().message).toBe(
      "Esta ordem precisa de um roteiro de produção antes de ser planejada.",
    );
    expect((await ler(ordem.id)).status).toBe("DRAFT");

    const { versionId } = await perfilAtivo([etapa("Mistura")]);
    expect((await aplicar(ordem.id, { productionProfileVersionId: versionId })).statusCode).toBe(200);
    expect((await planejar(ordem.id)).statusCode).toBe(200);
  });

  it("ativar V2 e V3 depois não muda a OP que copiou a V1 — e cada OP nova recebe a versão do momento", async () => {
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
    // E o aviso discreto aparece: há versão mais recente do padrão.
    expect(relida.planning.canUpdate).toBe(true);
    expect(relida.planning.availableProfile!.versionNumber).toBe(2);

    const doMeio = await criarOP(item.id);
    expect(doMeio.planning.snapshot!.sourceVersionId).toBe(v2);

    const v3 = await proximaVersaoAtiva(v2, [etapa("Encapsulagem", { runDurationMinutes: 45 })]);
    // O Produto avançou com a ativação; nenhuma OP existente se mexeu.
    expect((await app.inject(`/products/${item.id}/production-profile`)).json().version.id).toBe(v3);
    expect((await ler(antiga.id)).planning.snapshot!.sourceVersionId).toBe(versionId);
    expect((await ler(doMeio.id)).planning.snapshot!.sourceVersionId).toBe(v2);

    const nova = await criarOP(item.id);
    expect(nova.planning.snapshot!.sourceVersionId).toBe(v3);
    expect(nova.planning.snapshot!.steps.map((passo) => passo.name)).toEqual(["Encapsulagem"]);
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
    expect(passo.durationMinutes).toBe("150");
    const demanda = Object.fromEntries(
      ordem.planning.plan!.resources.map((recurso) => [recurso.industrialResourceId, recurso.demandMinutes]),
    );
    expect(demanda[operadorId]).toBe("300");
    expect(demanda[misturadorId]).toBe("150");
  });

  it("mudar a quantidade em rascunho recalcula sem recopiar o roteiro", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 120 })]);
    const item = await produto();
    await definirPadrao(item.id, versionId);

    const ordem = await criarOP(item.id, "1000");
    expect(ordem.planning.plan!.totalDurationMinutes).toBe("120");
    const copiadoEm = ordem.planning.appliedAt;

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

    await getPrisma().industrialResource.update({
      where: { id: misturadorId },
      data: { name: `Misturador ${marca}`, active: true },
    });
  });
});

describe("Unidade da ordem × unidade de referência do roteiro", () => {
  it("roteiro em g e produto em kg: 2 kg são 2000 g — 60 min por 1000 g viram 120 min", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 60 })], "1000", "g");
    const item = await produto("kg");
    expect((await definirPadrao(item.id, versionId)).statusCode).toBe(200);

    const ordem = await criarOP(item.id, "2");

    // Sem conversão, "2" contra 1000 g daria 0,12 min — mil vezes menos.
    expect(ordem.planning.quantityInReferenceUom).toBe("2000");
    expect(ordem.planning.plan!.quantity).toBe("2000");
    expect(ordem.planning.plan!.totalDurationMinutes).toBe("120");
    expect(ordem.planning.planBlockedReason).toBeNull();
  });

  it("roteiro em kg e produto em g: 500 g são 0,5 kg — 60 min por 1 kg viram 30 min", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 60 })], "1", "kg");
    const item = await produto("g");
    expect((await definirPadrao(item.id, versionId)).statusCode).toBe(200);

    const ordem = await criarOP(item.id, "500");

    expect(ordem.planning.quantityInReferenceUom).toBe("0.5");
    expect(ordem.planning.plan!.totalDurationMinutes).toBe("30");
  });

  it("mesma unidade não converte nada", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 60 })], "10", "kg");
    const item = await produto("kg");
    await definirPadrao(item.id, versionId);

    const ordem = await criarOP(item.id, "25");

    expect(ordem.planning.quantityInReferenceUom).toBe("25");
    expect(ordem.planning.plan!.totalDurationMinutes).toBe("150");
  });

  it("dimensão incompatível é recusada na escolha da ordem e no padrão do produto — nada é gravado", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 60 })], "1000", "un");
    const item = await produto("kg");

    const padrao = await definirPadrao(item.id, versionId);
    expect(padrao.statusCode).toBe(400);
    expect(padrao.json().error).toBe("incompatible_uom");

    const ordem = await criarOP(item.id, "2");
    const escolha = await aplicar(ordem.id, { productionProfileVersionId: versionId });
    expect(escolha.statusCode).toBe(400);
    expect(escolha.json().error).toBe("incompatible_uom");
    expect((await ler(ordem.id)).planning.snapshot).toBeNull();
  });
});

describe("Aplicar o roteiro numa OP sem roteiro", () => {
  it("padrão atual do produto: PRODUCT_DEFAULT_APPLIED, sem motivo, e o Produto não muda", async () => {
    const item = await produto();
    const ordem = await criarOP(item.id, "2000");
    expect(ordem.planning.snapshot).toBeNull();
    expect(ordem.planning.canApply).toBe(false);

    const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 120 })]);
    await definirPadrao(item.id, versionId);

    // Mudar só o padrão do Produto não resolve a ordem que já existia.
    const antes = await ler(ordem.id);
    expect(antes.planning.snapshot).toBeNull();
    expect(antes.planning.routePending).toBe(true);
    expect(antes.planning.canApply).toBe(true);
    expect(antes.planning.productDefaultProfile!.versionId).toBe(versionId);

    const aplicada = await aplicar(ordem.id);
    expect(aplicada.statusCode).toBe(200);
    const depois = aplicada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(versionId);
    expect(depois.planning.plan!.totalDurationMinutes).toBe("240");
    expect(depois.planning.applicationSource).toBe("PRODUCT_DEFAULT_APPLIED");
    expect(depois.planning.applicationReason).toBeNull();
    expect(depois.planning.appliedBy).toBe("Usuário de Teste ADMIN");
    expect(depois.planning.routePending).toBe(false);
  });

  it("padrão atual inexistente recusa, com mensagem própria", async () => {
    const item = await produto();
    const ordem = await criarOP(item.id);

    const recusada = await aplicar(ordem.id);
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("no_production_profile");
    expect((await ler(ordem.id)).planning.snapshot).toBeNull();
  });

  it("escolhido só para esta OP: MANUAL_ORDER, e o padrão do Produto continua o mesmo", async () => {
    const { versionId: padrao } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const { versionId: escolhido } = await perfilAtivo([etapa("Encapsulagem", { runDurationMinutes: 60 })]);
    const item = await produto();
    const ordem = await criarOP(item.id, "1000");
    await definirPadrao(item.id, padrao);

    const aplicada = await aplicar(ordem.id, { productionProfileVersionId: escolhido, reason: "Linha 2" });
    expect(aplicada.statusCode).toBe(200);
    const depois = aplicada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(escolhido);
    expect(depois.planning.applicationSource).toBe("MANUAL_ORDER");
    // Primeira aplicação aceita motivo, sem exigir.
    expect(depois.planning.applicationReason).toBe("Linha 2");
    expect((await app.inject(`/products/${item.id}/production-profile`)).json().version.id).toBe(padrao);
  });

  it("definir como padrão do produto e aplicar: uma transação, DEFAULT_AND_APPLIED, e as outras OPs não mudam", async () => {
    const { versionId: antigo } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const { versionId: novo } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 90 })]);
    const item = await produto();
    await definirPadrao(item.id, antigo);
    const outra = await criarOP(item.id, "1000");
    expect(outra.planning.snapshot!.sourceVersionId).toBe(antigo);

    // Ordem sem roteiro do mesmo produto: o padrão foi tirado antes dela nascer.
    await definirPadrao(item.id, null);
    const ordem = await criarOP(item.id, "1000");
    expect(ordem.planning.snapshot).toBeNull();

    const aplicada = await aplicar(ordem.id, { productionProfileVersionId: novo, setAsProductDefault: true });
    expect(aplicada.statusCode).toBe(200);
    const depois = aplicada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(novo);
    expect(depois.planning.applicationSource).toBe("DEFAULT_AND_APPLIED");
    expect(depois.planning.applicationReason).toBeNull();
    expect((await app.inject(`/products/${item.id}/production-profile`)).json().version.id).toBe(novo);
    expect((await ler(outra.id)).planning.snapshot!.sourceVersionId).toBe(antigo);
  });

  it("definir padrão e aplicar com unidade incompatível desfaz tudo — nem Produto, nem OP", async () => {
    const { versionId: bom } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })], "1", "kg");
    const { versionId: incompativel } = await perfilAtivo([etapa("Mistura")], "1000", "un");
    const item = await produto("kg");
    const ordem = await criarOP(item.id, "5");
    await definirPadrao(item.id, bom);

    const recusada = await aplicar(ordem.id, {
      productionProfileVersionId: incompativel,
      setAsProductDefault: true,
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("incompatible_uom");
    expect((await app.inject(`/products/${item.id}/production-profile`)).json().version.id).toBe(bom);
    expect((await ler(ordem.id)).planning.snapshot).toBeNull();
  });
});

describe("Trocar o roteiro em rascunho", () => {
  it("exige motivo; com motivo troca a cópia inteira e grava o motivo final", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const item = await produto();
    await definirPadrao(item.id, versionId);
    const ordem = await criarOP(item.id, "1000");
    expect(ordem.planning.snapshot!.sourceVersionNumber).toBe(1);

    const v2 = await proximaVersaoAtiva(versionId, [
      etapa("Pesagem", { runDurationMinutes: 30 }),
      etapa("Mistura", { runDurationMinutes: 180 }),
    ]);

    const semMotivo = await aplicar(ordem.id);
    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json().error).toBe("reason_required");
    const soEspacos = await aplicar(ordem.id, { reason: "   " });
    expect(soEspacos.json().error).toBe("reason_required");
    expect((await ler(ordem.id)).planning.snapshot!.sourceVersionId).toBe(versionId);

    const trocada = await aplicar(ordem.id, { reason: "Versão nova do padrão" });
    expect(trocada.statusCode).toBe(200);
    const depois = trocada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(v2);
    expect(depois.planning.snapshot!.steps).toHaveLength(2);
    expect(depois.planning.applicationSource).toBe("PRODUCT_DEFAULT_APPLIED");
    expect(depois.planning.applicationReason).toBe("Versão nova do padrão");
    expect(depois.planning.canUpdate).toBe(false);
  });

  it("com programação: sem confirmação nada muda; confirmando, a programação sai e o roteiro troca na mesma operação", async () => {
    const { versionId: primeiro } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const { versionId: segundo } = await perfilAtivo([etapa("Encapsulagem", { runDurationMinutes: 60 })]);
    const item = await produto();
    await definirPadrao(item.id, primeiro);
    const ordem = await criarOP(item.id, "1000");
    await programacaoExistente(ordem.id);

    const semConfirmar = await aplicar(ordem.id, {
      productionProfileVersionId: segundo,
      reason: "Encapsuladora nova",
    });
    expect(semConfirmar.statusCode).toBe(409);
    expect(semConfirmar.json().error).toBe("schedule_removal_needs_confirmation");
    expect(await getPrisma().productionOrderSchedule.count({ where: { productionOrderId: ordem.id } })).toBe(1);
    expect((await ler(ordem.id)).planning.snapshot!.sourceVersionId).toBe(primeiro);

    const confirmada = await aplicar(ordem.id, {
      productionProfileVersionId: segundo,
      reason: "Encapsuladora nova",
      confirmScheduleRemoval: true,
    });
    expect(confirmada.statusCode).toBe(200);
    expect(await getPrisma().productionOrderSchedule.count({ where: { productionOrderId: ordem.id } })).toBe(0);
    const depois = confirmada.json() as ProductionOrderDTO;
    expect(depois.planning.snapshot!.sourceVersionId).toBe(segundo);
    expect(depois.planning.applicationSource).toBe("MANUAL_ORDER");
  });

  it("fora do rascunho a cópia é imutável, mesmo com versão mais nova disponível", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const item = await produtoPlanejavel();
    await definirPadrao(item.id, versionId);
    const ordem = await criarOP(item.id, "1000");

    expect((await planejar(ordem.id)).statusCode).toBe(200);
    await proximaVersaoAtiva(versionId, [etapa("Outra", { runDurationMinutes: 999 })]);

    const recusada = await aplicar(ordem.id, { reason: "Tentar trocar", confirmLegacyRepair: true });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("order_locked");

    const relida = await ler(ordem.id);
    expect(relida.status).toBe("PLANNED");
    expect(relida.planning.snapshot!.sourceVersionId).toBe(versionId);
    expect(relida.planning.availableProfile).toBeNull();
    expect(relida.planning.canApply).toBe(false);
    expect(relida.planning.canChoose).toBe(false);
    expect(relida.planning.canUpdate).toBe(false);
  });

  it("trocar o produto em rascunho troca a cópia, some quando o novo não tem roteiro, e leva a programação junto", async () => {
    const { versionId } = await perfilAtivo([etapa("Pesagem", { runDurationMinutes: 30 })]);
    const comPerfil = await produto();
    await definirPadrao(comPerfil.id, versionId);
    const ordem = await criarOP(comPerfil.id, "1000");
    expect(ordem.planning.snapshot!.sourceVersionId).toBe(versionId);
    await programacaoExistente(ordem.id);

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
    expect(depois.planning.applicationSource).toBe("AUTO_PRODUCT_DEFAULT");
    expect(await getPrisma().productionOrderSchedule.count({ where: { productionOrderId: ordem.id } })).toBe(0);

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

describe("Regularização de legado — PLANNED e RELEASED sem roteiro", () => {
  for (const situacao of ["PLANNED", "RELEASED"] as const) {
    it(`${situacao}: exige confirmação e motivo, grava LEGACY_REPAIR, e depois congela`, async () => {
      const { versionId } = await perfilAtivo([etapa("Mistura", { runDurationMinutes: 60 })]);
      const item = await produto();
      const ordem = await criarOP(item.id, "1000");
      await forcarSituacao(ordem.id, situacao);

      const legado = await ler(ordem.id);
      expect(legado.planning.routePending).toBe(true);
      expect(legado.planning.requiresLegacyRepair).toBe(true);
      expect(legado.planning.canChoose).toBe(true);

      const semConfirmar = await aplicar(ordem.id, { productionProfileVersionId: versionId, reason: "Legado" });
      expect(semConfirmar.statusCode).toBe(409);
      expect(semConfirmar.json().error).toBe("legacy_repair_needs_confirmation");

      const semMotivo = await aplicar(ordem.id, {
        productionProfileVersionId: versionId,
        confirmLegacyRepair: true,
      });
      expect(semMotivo.statusCode).toBe(400);
      expect(semMotivo.json().error).toBe("reason_required");
      expect((await ler(ordem.id)).planning.snapshot).toBeNull();

      const regularizada = await aplicar(ordem.id, {
        productionProfileVersionId: versionId,
        confirmLegacyRepair: true,
        reason: "Ordem planejada antes do roteiro obrigatório",
      });
      expect(regularizada.statusCode).toBe(200);
      const depois = regularizada.json() as ProductionOrderDTO;
      expect(depois.status).toBe(situacao);
      expect(depois.planning.applicationSource).toBe("LEGACY_REPAIR");
      expect(depois.planning.applicationReason).toBe("Ordem planejada antes do roteiro obrigatório");
      expect(depois.planning.routePending).toBe(false);

      // Segunda troca fora do rascunho: congelado.
      const { versionId: outro } = await perfilAtivo([etapa("Outra")]);
      const segunda = await aplicar(ordem.id, {
        productionProfileVersionId: outro,
        confirmLegacyRepair: true,
        reason: "Trocar de novo",
      });
      expect(segunda.statusCode).toBe(400);
      expect(segunda.json().error).toBe("order_locked");
    });
  }

  it("IN_PRODUCTION não recebe roteiro — o histórico fica como está", async () => {
    const { versionId } = await perfilAtivo([etapa("Mistura")]);
    const item = await produto();
    const ordem = await criarOP(item.id, "1000");
    await forcarSituacao(ordem.id, "IN_PRODUCTION");

    const recusada = await aplicar(ordem.id, {
      productionProfileVersionId: versionId,
      confirmLegacyRepair: true,
      reason: "Tentar",
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("order_locked");
    const relida = await ler(ordem.id);
    expect(relida.planning.snapshot).toBeNull();
    expect(relida.planning.routePending).toBe(false);
    expect(relida.planning.canChoose).toBe(false);
  });

  it("RELEASE de ordem planejada sem roteiro é recusado antes de qualquer reserva", async () => {
    const item = await produtoPlanejavel();
    const ordem = await criarOP(item.id, "1000");
    await forcarSituacao(ordem.id, "PLANNED");

    const recusada = await app.inject({ method: "POST", url: `/production-orders/${ordem.id}/release` });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("route_required");
    expect(recusada.json().message).toBe(
      "Esta ordem precisa de um roteiro de produção antes de ser liberada.",
    );
    expect(await getPrisma().materialReservation.count({ where: { productionOrderId: ordem.id } })).toBe(0);
    expect((await ler(ordem.id)).status).toBe("PLANNED");
  });
});

describe("Concorrência — a decisão é tomada sobre a ordem travada", () => {
  it("tela velha: a versão que a pessoa via mudou, e o servidor recusa com 409", async () => {
    const { versionId: primeiro } = await perfilAtivo([etapa("Pesagem")]);
    const { versionId: segundo } = await perfilAtivo([etapa("Mistura")]);
    const item = await produto();
    const ordem = await criarOP(item.id, "1000");

    expect((await aplicar(ordem.id, { productionProfileVersionId: primeiro, expectedSourceVersionId: null })).statusCode).toBe(200);

    const atrasada = await aplicar(ordem.id, {
      productionProfileVersionId: segundo,
      expectedSourceVersionId: null,
      reason: "Outra pessoa",
    });
    expect(atrasada.statusCode).toBe(409);
    expect(atrasada.json().error).toBe("route_changed");
    expect((await ler(ordem.id)).planning.snapshot!.sourceVersionId).toBe(primeiro);
  });

  it("duas aplicações ao mesmo tempo: uma vence, a outra recebe 409 — nunca 500, nunca duas cópias", async () => {
    const { versionId: primeiro } = await perfilAtivo([etapa("Pesagem")]);
    const { versionId: segundo } = await perfilAtivo([etapa("Mistura")]);
    const item = await produto();
    const ordem = await criarOP(item.id, "1000");

    const respostas = await Promise.all([
      aplicar(ordem.id, { productionProfileVersionId: primeiro, expectedSourceVersionId: null }),
      aplicar(ordem.id, { productionProfileVersionId: segundo, expectedSourceVersionId: null }),
    ]);
    expect(respostas.map((resposta) => resposta.statusCode).sort()).toEqual([200, 409]);
    expect(
      await getPrisma().productionOrderPlanningSnapshot.count({ where: { productionOrderId: ordem.id } }),
    ).toBe(1);
  });
});

describe("Pendência de roteiro — derivada, nunca gravada", () => {
  it("aparece na lista e no quadro; mudar só o padrão do Produto não a resolve; aplicar a remove", async () => {
    const item = await produto();
    const semRoteiro = await criarOP(item.id, "1000");

    const { versionId } = await perfilAtivo([etapa("Mistura")]);
    await definirPadrao(item.id, versionId);
    const comRoteiro = await criarOP(item.id, "1000");
    expect(comRoteiro.planning.snapshot).not.toBeNull();

    const pendentes = async () =>
      (
        (await app.inject(`/production-orders?semRoteiro=1&productId=${item.id}&status=DRAFT,PLANNED,RELEASED`)).json() as ProductionOrderListResponse
      ).productionOrders.map((op) => op.id);
    const comRoteiroNaLista = async () =>
      (
        (await app.inject(`/production-orders?semRoteiro=0&productId=${item.id}`)).json() as ProductionOrderListResponse
      ).productionOrders.map((op) => op.id);
    const noQuadro = async () =>
      (
        (await app.inject(`/production-board?from=2033-03-07&to=2033-03-13&productId=${item.id}`)).json() as ProductionBoardResponse
      ).pendencies.map((pendencia) => pendencia.productionOrderId);

    expect(await pendentes()).toEqual([semRoteiro.id]);
    expect(await comRoteiroNaLista()).toEqual([comRoteiro.id]);
    expect(await noQuadro()).toEqual([semRoteiro.id]);

    // Ordem em produção sem roteiro é histórico, não pendência.
    const historica = await criarOP(item.id, "1000");
    await getPrisma().productionOrderPlanningSnapshot.deleteMany({ where: { productionOrderId: historica.id } });
    await forcarSituacao(historica.id, "IN_PRODUCTION");
    expect(await pendentes()).toEqual([semRoteiro.id]);

    expect((await aplicar(semRoteiro.id)).statusCode).toBe(200);
    expect(await pendentes()).toEqual([]);
    expect(await noQuadro()).toEqual([]);
  });

  it("CSV da lista respeita o mesmo filtro", async () => {
    const item = await produto();
    const ordem = await criarOP(item.id, "1000");

    const csv = await app.inject(`/production-orders/export.csv?semRoteiro=1&productId=${item.id}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(ordem.code);
    const csvComRoteiro = await app.inject(`/production-orders/export.csv?semRoteiro=0&productId=${item.id}`);
    expect(csvComRoteiro.body).not.toContain(ordem.code);
  });
});
