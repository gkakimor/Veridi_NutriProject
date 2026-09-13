import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProductProductionProfileDTO,
  ProductionPlan,
  ProductionProfileDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * Perfil de Produção — PLANNING-PRODUCTION-PROFILE-01, `PRODUCT_RULES.md` §89.
 *
 * Três promessas sob teste:
 *
 * 1. versão ativa é CONGELADA — mudar o roteiro é versão nova, que copia tudo;
 * 2. quantidade de recursos é CAPACIDADE: 2 operadores por 2 h são etapa de
 *    2 h e 4 horas-recurso, e energia não entra em etapa;
 * 3. a prévia calcula e não grava; o produto só APONTA para uma versão ativa
 *    e compatível, e ativar versão nova do MESMO perfil leva o ponteiro junto.
 */

type App = ReturnType<typeof buildTestApp>;
const app: App = buildTestApp("ADMIN");
const leitor: App = buildTestApp("VIEWER");

const fixtureProfileIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

interface Recurso {
  id: string;
  name: string;
}
let operador: Recurso;
let misturador: Recurso;
let encapsuladora: Recurso;
let energia: Recurso;
let inativo: Recurso;

beforeAll(async () => {
  await app.ready();
  await leitor.ready();
  const prisma = getPrisma();
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const recurso = async (
    nome: string,
    type: "LABOR" | "EQUIPMENT" | "ENERGY",
    active = true,
  ): Promise<Recurso> => {
    const criado = await prisma.industrialResource.create({
      data: {
        code: `RIN-PPR-${proximo()}`,
        name: `${nome} ${marca}`,
        type,
        defaultUsageUom: type === "ENERGY" ? "KWH" : "HOUR",
        active,
      },
    });
    fixtureResourceIds.push(criado.id);
    return { id: criado.id, name: criado.name };
  };
  operador = await recurso("Mão de obra — Produção", "LABOR");
  misturador = await recurso("Misturador", "EQUIPMENT");
  encapsuladora = await recurso("Encapsuladora", "EQUIPMENT");
  energia = await recurso("Energia elétrica", "ENERGY");
  inativo = await recurso("Blister desativado", "EQUIPMENT", false);
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que ESTE arquivo criou. O produto sai antes: ele aponta para versões.
  if (fixtureProductIds.length > 0) {
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
  await leitor.close();
});

async function criarPerfil(body: Record<string, unknown> = {}): Promise<ProductionProfileDTO> {
  const resposta = await app.inject({
    method: "POST",
    url: "/production-profiles",
    payload: { name: `Cápsulas ${proximo()}`, ...body },
  });
  expect(resposta.statusCode).toBe(201);
  const perfil = resposta.json() as ProductionProfileDTO;
  fixtureProfileIds.push(perfil.id);
  return perfil;
}

const etapa = (name: string, sobre: Record<string, unknown> = {}) => ({
  name,
  setupDurationMinutes: 0,
  runDurationMinutes: 120,
  scalingMode: "PROPORTIONAL",
  resources: [],
  ...sobre,
});

function salvar(versionId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/production-profile-versions/${versionId}`,
    payload,
  });
}

async function ativar(versionId: string): Promise<ProductionProfileVersionDTO> {
  const resposta = await app.inject({
    method: "POST",
    url: `/production-profile-versions/${versionId}/activate`,
  });
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as ProductionProfileVersionDTO;
}

async function versao(versionId: string): Promise<ProductionProfileVersionDTO> {
  return (await app.inject(`/production-profile-versions/${versionId}`)).json() as ProductionProfileVersionDTO;
}

async function previa(versionId: string, quantity: string): Promise<ProductionPlan> {
  const resposta = await app.inject(
    `/production-profile-versions/${versionId}/preview?quantity=${quantity}`,
  );
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as ProductionPlan;
}

/** Perfil com a V1 ATIVA — o ponto de partida de quem vai usar o perfil. */
async function perfilAtivo(steps: unknown[], body: Record<string, unknown> = {}) {
  const perfil = await criarPerfil(body);
  const salvo = await salvar(perfil.draftVersion!.id, { steps });
  expect(salvo.statusCode).toBe(200);
  const ativa = await ativar(perfil.draftVersion!.id);
  return { perfil, ativa };
}

async function produto(unitCode: string | null) {
  const prisma = getPrisma();
  let finishedProductItemId: string | undefined;
  if (unitCode) {
    const item = await prisma.item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-PPR-${proximo()}`,
        name: `Produto acabado ${marca}`,
        unitCode,
      },
    });
    fixtureItemIds.push(item.id);
    finishedProductItemId = item.id;
  }
  const criado = await prisma.product.create({
    data: {
      code: `PROD-PPR-${proximo()}`,
      name: `Produto ${marca}`,
      ...(finishedProductItemId ? { finishedProductItemId } : {}),
    },
  });
  fixtureProductIds.push(criado.id);
  return criado;
}

function definirPadrao(productId: string, productionProfileVersionId: string | null) {
  return app.inject({
    method: "PUT",
    url: `/products/${productId}/production-profile`,
    payload: { productionProfileVersionId },
  });
}

describe("Perfil de Produção — versão, etapas e congelamento", () => {
  it("nasce com a V1 em rascunho, com a quantidade-base informada, e o rascunho se edita", async () => {
    const perfil = await criarPerfil({ referenceQuantity: "1000", referenceUomCode: "un" });

    expect(perfil.code).toMatch(/^PPR-\d{6}$/);
    expect(perfil.activeVersion).toBeNull();
    expect(perfil.draftVersion).toMatchObject({
      versionNumber: 1,
      status: "DRAFT",
      referenceQuantity: "1000",
      referenceUomCode: "un",
      steps: [],
    });

    const salvo = await salvar(perfil.draftVersion!.id, {
      referenceQuantity: "500",
      steps: [etapa("Pesagem", { setupDurationMinutes: 10 })],
    });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json()).toMatchObject({
      status: "DRAFT",
      referenceQuantity: "500",
      steps: [{ sequence: 1, name: "Pesagem", setupDurationMinutes: 10, runDurationMinutes: 120 }],
    });
  });

  it("quantidade-base zero e unidade desconhecida são recusadas", async () => {
    const perfil = await criarPerfil();
    const zero = await salvar(perfil.draftVersion!.id, { referenceQuantity: "0" });
    expect(zero.statusCode).toBe(400);
    expect(zero.json().error).toBe("validation_error");

    const unidade = await salvar(perfil.draftVersion!.id, { referenceUomCode: "caixa-x" });
    expect(unidade.statusCode).toBe(400);
    expect(unidade.json().error).toBe("invalid_uom");
  });

  it("as etapas ficam na ordem enviada: a posição vira a sequência, e reordenar regrava", async () => {
    const perfil = await criarPerfil();
    const id = perfil.draftVersion!.id;

    const primeira = await salvar(id, {
      steps: [etapa("Pesagem"), etapa("Mistura"), etapa("Encapsulamento")],
    });
    expect(
      (primeira.json() as ProductionProfileVersionDTO).steps.map((s) => [s.sequence, s.name]),
    ).toEqual([
      [1, "Pesagem"],
      [2, "Mistura"],
      [3, "Encapsulamento"],
    ]);

    const reordenada = await salvar(id, {
      steps: [etapa("Mistura"), etapa("Pesagem"), etapa("Encapsulamento")],
    });
    expect(
      (reordenada.json() as ProductionProfileVersionDTO).steps.map((s) => [s.sequence, s.name]),
    ).toEqual([
      [1, "Mistura"],
      [2, "Pesagem"],
      [3, "Encapsulamento"],
    ]);
  });

  it("ativar congela: a ativa recusa edição, e mudar exige versão nova que copia tudo", async () => {
    const perfil = await criarPerfil();
    const v1 = perfil.draftVersion!.id;
    await salvar(v1, {
      steps: [
        etapa("Mistura", {
          setupDurationMinutes: 15,
          scalingMode: "BY_BATCH",
          description: "Até homogeneizar",
          resources: [{ industrialResourceId: operador.id, resourceQuantity: 2 }],
        }),
      ],
    });
    expect((await ativar(v1)).status).toBe("ACTIVE");

    const editar = await salvar(v1, { steps: [etapa("Outra")] });
    expect(editar.statusCode).toBe(409);
    expect(editar.json().error).toBe("profile_version_not_draft");
    expect((await versao(v1)).steps.map((s) => s.name)).toEqual(["Mistura"]);

    const nova = await app.inject({
      method: "POST",
      url: `/production-profile-versions/${v1}/new-version`,
    });
    expect(nova.statusCode).toBe(201);
    const v2 = nova.json() as ProductionProfileVersionDTO;
    expect(v2).toMatchObject({ versionNumber: 2, status: "DRAFT", sourceVersionNumber: 1 });
    expect(v2.steps).toEqual([
      expect.objectContaining({
        sequence: 1,
        name: "Mistura",
        description: "Até homogeneizar",
        setupDurationMinutes: 15,
        runDurationMinutes: 120,
        scalingMode: "BY_BATCH",
        resources: [
          expect.objectContaining({ industrialResourceId: operador.id, resourceQuantity: 2 }),
        ],
      }),
    ]);

    // Um rascunho por perfil.
    const outra = await app.inject({
      method: "POST",
      url: `/production-profile-versions/${v1}/new-version`,
    });
    expect(outra.statusCode).toBe(409);
    expect(outra.json().error).toBe("profile_draft_exists");

    await ativar(v2.id);
    const final = (await app.inject(`/production-profiles/${perfil.id}`)).json() as ProductionProfileDTO;
    expect(final.activeVersion?.versionNumber).toBe(2);
    expect(final.draftVersion).toBeNull();
    expect(final.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [1, "ARCHIVED"],
      [2, "ACTIVE"],
    ]);
  });

  it("versão sem etapa não é ativada", async () => {
    const perfil = await criarPerfil();
    const resposta = await app.inject({
      method: "POST",
      url: `/production-profile-versions/${perfil.draftVersion!.id}/activate`,
    });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("profile_empty");
  });

  it("só Administração e Produção editam; os demais perfis leem", async () => {
    const criar = await leitor.inject({
      method: "POST",
      url: "/production-profiles",
      payload: { name: "Sem permissão" },
    });
    expect(criar.statusCode).toBe(403);
    expect((await leitor.inject("/production-profiles")).statusCode).toBe(200);
  });
});

describe("Recursos da etapa — capacidade, não custo", () => {
  it("energia é recusada como recurso de etapa, nomeando o recurso — e nada é gravado", async () => {
    const perfil = await criarPerfil();
    const resposta = await salvar(perfil.draftVersion!.id, {
      steps: [etapa("Mistura", { resources: [{ industrialResourceId: energia.id, resourceQuantity: 1 }] })],
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("resource_not_capacity");
    expect(resposta.json().message).toContain(energia.name);
    expect((await versao(perfil.draftVersion!.id)).steps).toEqual([]);
  });

  it.each([
    ["zero", 0],
    ["fracionária", 1.5],
    ["negativa", -2],
    ["texto", "2"],
    ["nula", null],
  ])("quantidade de recursos %s é 400 antes do domínio", async (_rotulo, quantidade) => {
    const perfil = await criarPerfil();
    const resposta = await salvar(perfil.draftVersion!.id, {
      steps: [
        etapa("Mistura", {
          resources: [{ industrialResourceId: operador.id, resourceQuantity: quantidade }],
        }),
      ],
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });

  it("recurso inativo e o mesmo recurso duas vezes na etapa são recusados", async () => {
    const perfil = await criarPerfil();
    const desativado = await salvar(perfil.draftVersion!.id, {
      steps: [etapa("Blister", { resources: [{ industrialResourceId: inativo.id, resourceQuantity: 1 }] })],
    });
    expect(desativado.statusCode).toBe(400);
    expect(desativado.json().error).toBe("resource_inactive");

    const repetido = await salvar(perfil.draftVersion!.id, {
      steps: [
        etapa("Mistura", {
          resources: [
            { industrialResourceId: operador.id, resourceQuantity: 1 },
            { industrialResourceId: operador.id, resourceQuantity: 2 },
          ],
        }),
      ],
    });
    expect(repetido.statusCode).toBe(400);
    expect(repetido.json().error).toBe("duplicate_step_resource");
  });

  it("etapa sem tempo nenhum, e minuto fracionário, são recusados", async () => {
    const perfil = await criarPerfil();
    const semTempo = await salvar(perfil.draftVersion!.id, {
      steps: [etapa("Nada", { setupDurationMinutes: 0, runDurationMinutes: 0 })],
    });
    expect(semTempo.statusCode).toBe(400);

    const fracao = await salvar(perfil.draftVersion!.id, {
      steps: [etapa("Mistura", { runDurationMinutes: 1.5 })],
    });
    expect(fracao.statusCode).toBe(400);
  });
});

describe("Prévia — a conta para uma quantidade, sem gravar nada", () => {
  let perfilId: string;
  let versaoId: string;

  beforeAll(async () => {
    // Base 1.000 un. Mistura proporcional com 2 operadores e 1 misturador;
    // Encapsulamento por lote com 3 encapsuladoras; Embalagem com 30 min de
    // preparação.
    const { perfil, ativa } = await perfilAtivo(
      [
        etapa("Mistura", {
          resources: [
            { industrialResourceId: operador.id, resourceQuantity: 2 },
            { industrialResourceId: misturador.id, resourceQuantity: 1 },
          ],
        }),
        etapa("Encapsulamento", {
          scalingMode: "BY_BATCH",
          resources: [{ industrialResourceId: encapsuladora.id, resourceQuantity: 3 }],
        }),
        etapa("Embalagem", { setupDurationMinutes: 30 }),
      ],
      { referenceQuantity: "1000", referenceUomCode: "un" },
    );
    perfilId = perfil.id;
    versaoId = ativa.id;
  });

  it("na base: 2 operadores × 2 h são etapa de 2 h e 4 h-recurso; 3 máquinas × 2 h, etapa de 2 h e 6 h-recurso", async () => {
    const plano = await previa(versaoId, "1000");
    const [mistura, encapsulamento] = plano.steps;

    expect(mistura!.durationMinutes).toBe("120");
    expect(mistura!.resources.find((r) => r.industrialResourceId === operador.id)?.demandMinutes).toBe(
      "240",
    );
    expect(encapsulamento!.durationMinutes).toBe("120");
    expect(encapsulamento!.resources[0]!.demandMinutes).toBe("360");
  });

  it("proporcional 1.000 → 3.000: 2 h viram 6 h; a preparação continua 30 min", async () => {
    const plano = await previa(versaoId, "3000");
    expect(plano.steps.map((s) => [s.name, s.setupMinutes, s.runMinutes, s.durationMinutes])).toEqual([
      ["Mistura", "0", "360", "360"],
      ["Encapsulamento", "0", "360", "360"],
      ["Embalagem", "30", "360", "390"],
    ]);
    expect(plano.totalDurationMinutes).toBe("1110");
  });

  it("1.500 un: proporcional dá 3 h; por lote são 2 lotes e 4 h — nunca regra de três", async () => {
    const plano = await previa(versaoId, "1500");
    expect(plano.steps[0]).toMatchObject({ runMinutes: "180", batches: null });
    expect(plano.steps[1]).toMatchObject({ batches: 2, runMinutes: "240" });
    expect(plano.resources.map((r) => [r.industrialResourceId, r.demandMinutes])).toEqual([
      [operador.id, "360"],
      [misturador.id, "180"],
      [encapsuladora.id, "720"],
    ]);
  });

  it("a prévia não grava nada — nem simulação, nem carimbo de atualização", async () => {
    const prisma = getPrisma();
    /*
     * Contagem DO PERFIL prevista, não do banco inteiro: outros arquivos da
     * suíte criam roteiros em paralelo, e o total global media o vizinho em
     * vez da prévia. O que a prévia poderia gravar mora neste perfil.
     */
    const contar = () =>
      Promise.all([
        prisma.productionProfileVersion.count({ where: { productionProfileId: perfilId } }),
        prisma.productionProfileStep.count({
          where: { productionProfileVersion: { productionProfileId: perfilId } },
        }),
        prisma.productionProfileStepResource.count({
          where: { productionProfileStep: { productionProfileVersion: { productionProfileId: perfilId } } },
        }),
      ]);
    const antes = await contar();
    const perfilAntes = await prisma.productionProfile.findUniqueOrThrow({ where: { id: perfilId } });

    await previa(versaoId, "3000");
    await previa(versaoId, "1500");

    expect(await contar()).toEqual(antes);
    const perfilDepois = await prisma.productionProfile.findUniqueOrThrow({ where: { id: perfilId } });
    expect(perfilDepois.updatedAt.getTime()).toBe(perfilAntes.updatedAt.getTime());
  });

  it("o recurso fica ocupado também na preparação: 30 + 120 min com 2 recursos são 300 min-recurso", async () => {
    const { ativa } = await perfilAtivo(
      [
        etapa("Envase", {
          setupDurationMinutes: 30,
          runDurationMinutes: 120,
          resources: [{ industrialResourceId: operador.id, resourceQuantity: 2 }],
        }),
      ],
      { referenceQuantity: "1000", referenceUomCode: "un" },
    );

    const plano = await previa(ativa.id, "1000");
    expect(plano.steps[0]).toMatchObject({
      setupMinutes: "30",
      runMinutes: "120",
      durationMinutes: "150",
    });
    // 2 × 150 min = 300 min-recurso (5 horas-recurso) — e a etapa continua em 150 min.
    expect(plano.steps[0]!.resources[0]!.demandMinutes).toBe("300");
    expect(plano.resources[0]!.demandMinutes).toBe("300");
    expect(plano.totalDurationMinutes).toBe("150");
  });

  it("a quantidade de recursos não muda a duração da etapa", async () => {
    const um = await perfilAtivo([etapa("Mistura", { resources: [{ industrialResourceId: operador.id, resourceQuantity: 1 }] })]);
    const tres = await perfilAtivo([etapa("Mistura", { resources: [{ industrialResourceId: operador.id, resourceQuantity: 3 }] })]);

    const planoUm = await previa(um.ativa.id, "2000");
    const planoTres = await previa(tres.ativa.id, "2000");
    expect(planoUm.steps[0]!.durationMinutes).toBe(planoTres.steps[0]!.durationMinutes);
    expect(planoTres.resources[0]!.demandMinutes).toBe("720");
  });

  it("quantidade zero ou ilegível na prévia é 400", async () => {
    for (const ruim of ["0", "abc", "-5"]) {
      const resposta = await app.inject(
        `/production-profile-versions/${versaoId}/preview?quantity=${ruim}`,
      );
      expect(resposta.statusCode).toBe(400);
    }
  });
});

describe("Produto → Perfil de Produção padrão", () => {
  it("produto sem perfil continua válido", async () => {
    const semPerfil = await produto("un");

    const perfilDoProduto = await app.inject(`/products/${semPerfil.id}/production-profile`);
    expect(perfilDoProduto.statusCode).toBe(200);
    expect(perfilDoProduto.json()).toMatchObject({
      productId: semPerfil.id,
      productUomCode: "un",
      version: null,
    });
    expect((await app.inject(`/products/${semPerfil.id}`)).statusCode).toBe(200);
  });

  it("versão ativa vira o padrão; rascunho, unidade de outra dimensão e produto sem unidade são recusados", async () => {
    const { perfil, ativa } = await perfilAtivo([etapa("Mistura")], {
      referenceQuantity: "1000",
      referenceUomCode: "un",
    });
    const alvo = await produto("un");

    const definido = await definirPadrao(alvo.id, ativa.id);
    expect(definido.statusCode).toBe(200);
    expect((definido.json() as ProductProductionProfileDTO).version).toMatchObject({
      id: ativa.id,
      profileCode: perfil.code,
      versionNumber: 1,
      status: "ACTIVE",
    });
    const noPerfil = (await app.inject(`/production-profiles/${perfil.id}`)).json() as ProductionProfileDTO;
    expect(noPerfil.defaultProducts).toEqual([
      expect.objectContaining({ productId: alvo.id, versionNumber: 1, versionStatus: "ACTIVE" }),
    ]);

    const rascunho = await criarPerfil();
    const naoAtiva = await definirPadrao(alvo.id, rascunho.draftVersion!.id);
    expect(naoAtiva.statusCode).toBe(409);
    expect(naoAtiva.json().error).toBe("profile_version_not_active");

    const emQuilo = await produto("kg");
    const incompativel = await definirPadrao(emQuilo.id, ativa.id);
    expect(incompativel.statusCode).toBe(400);
    expect(incompativel.json().error).toBe("incompatible_uom");

    const semItem = await produto(null);
    const semUnidade = await definirPadrao(semItem.id, ativa.id);
    expect(semUnidade.statusCode).toBe(400);
    expect(semUnidade.json().error).toBe("product_without_unit");

    // Nenhuma recusa mexeu no padrão que já existia.
    const intacto = (await app.inject(`/products/${alvo.id}/production-profile`)).json();
    expect(intacto.version.id).toBe(ativa.id);
  });

  it("ativar a V2 leva junto todos os produtos que usavam a V1 do mesmo perfil", async () => {
    const { perfil, ativa: v1 } = await perfilAtivo([etapa("Mistura")]);
    const primeiro = await produto("un");
    const segundo = await produto("un");
    expect((await definirPadrao(primeiro.id, v1.id)).statusCode).toBe(200);
    expect((await definirPadrao(segundo.id, v1.id)).statusCode).toBe(200);

    const v2 = (
      await app.inject({ method: "POST", url: `/production-profile-versions/${v1.id}/new-version` })
    ).json() as ProductionProfileVersionDTO;
    await ativar(v2.id);

    for (const alvo of [primeiro, segundo]) {
      const depois = (await app.inject(`/products/${alvo.id}/production-profile`)).json() as ProductProductionProfileDTO;
      expect(depois.version).toMatchObject({ id: v2.id, versionNumber: 2, status: "ACTIVE" });
    }
    const versoes = (await app.inject(`/production-profiles/${perfil.id}`)).json() as ProductionProfileDTO;
    expect(versoes.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [1, "ARCHIVED"],
      [2, "ACTIVE"],
    ]);
    expect(versoes.defaultProducts.map((p) => p.versionNumber)).toEqual([2, 2]);
  });

  it("produto de outro perfil e produto sem perfil não são tocados pela ativação", async () => {
    const { ativa: outraAtiva } = await perfilAtivo([etapa("Mistura")]);
    const doOutroPerfil = await produto("un");
    await definirPadrao(doOutroPerfil.id, outraAtiva.id);
    const semPerfil = await produto("un");

    const { ativa: v1 } = await perfilAtivo([etapa("Pesagem")]);
    const doPerfil = await produto("un");
    await definirPadrao(doPerfil.id, v1.id);

    const v2 = (
      await app.inject({ method: "POST", url: `/production-profile-versions/${v1.id}/new-version` })
    ).json() as ProductionProfileVersionDTO;
    await ativar(v2.id);

    const outro = (await app.inject(`/products/${doOutroPerfil.id}/production-profile`)).json() as ProductProductionProfileDTO;
    expect(outro.version?.id).toBe(outraAtiva.id);
    const sem = (await app.inject(`/products/${semPerfil.id}/production-profile`)).json() as ProductProductionProfileDTO;
    expect(sem.version).toBeNull();
    const movido = (await app.inject(`/products/${doPerfil.id}/production-profile`)).json() as ProductProductionProfileDTO;
    expect(movido.version?.id).toBe(v2.id);
  });

  it("ativação recusada não move nada: versão e ponteiro ficam como estavam", async () => {
    const prisma = getPrisma();
    const recurso = await prisma.industrialResource.create({
      data: { code: `RIN-PPR-${proximo()}`, name: `Encapsuladora temporária ${marca}`, type: "EQUIPMENT", defaultUsageUom: "HOUR" },
    });
    fixtureResourceIds.push(recurso.id);

    const { ativa: v1 } = await perfilAtivo([
      etapa("Encapsulamento", { resources: [{ industrialResourceId: recurso.id, resourceQuantity: 1 }] }),
    ]);
    const alvo = await produto("un");
    await definirPadrao(alvo.id, v1.id);

    const v2 = (
      await app.inject({ method: "POST", url: `/production-profile-versions/${v1.id}/new-version` })
    ).json() as ProductionProfileVersionDTO;
    // O cadastro mudou entre copiar e ativar: a ativação inteira é recusada.
    await prisma.industrialResource.update({ where: { id: recurso.id }, data: { active: false } });

    const recusada = await app.inject({
      method: "POST",
      url: `/production-profile-versions/${v2.id}/activate`,
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("resource_inactive");

    expect((await versao(v1.id)).status).toBe("ACTIVE");
    expect((await versao(v2.id)).status).toBe("DRAFT");
    const depois = (await app.inject(`/products/${alvo.id}/production-profile`)).json() as ProductProductionProfileDTO;
    expect(depois.version?.id).toBe(v1.id);
  });

  it("duas ativações ao mesmo tempo: uma vence, e o ponteiro do produto não fica pela metade", async () => {
    const { ativa: v1 } = await perfilAtivo([etapa("Mistura")]);
    const alvo = await produto("un");
    await definirPadrao(alvo.id, v1.id);
    const v2 = (
      await app.inject({ method: "POST", url: `/production-profile-versions/${v1.id}/new-version` })
    ).json() as ProductionProfileVersionDTO;

    const [uma, outra] = await Promise.all([
      app.inject({ method: "POST", url: `/production-profile-versions/${v2.id}/activate` }),
      app.inject({ method: "POST", url: `/production-profile-versions/${v2.id}/activate` }),
    ]);
    expect([uma.statusCode, outra.statusCode].sort()).toEqual([200, 409]);

    const depois = (await app.inject(`/products/${alvo.id}/production-profile`)).json() as ProductProductionProfileDTO;
    expect(depois.version).toMatchObject({ id: v2.id, versionNumber: 2, status: "ACTIVE" });
  });

  it("mesma dimensão converte: roteiro em g serve para produto em kg; só VIEWER não grava", async () => {
    const { ativa } = await perfilAtivo([etapa("Mistura")], { referenceQuantity: "1000", referenceUomCode: "g" });
    const emKg = await produto("kg");

    const definido = await definirPadrao(emKg.id, ativa.id);
    expect(definido.statusCode).toBe(200);
    expect((definido.json() as ProductProductionProfileDTO).version).toMatchObject({ id: ativa.id, referenceUomCode: "g" });

    const semPermissao = await leitor.inject({
      method: "PUT",
      url: `/products/${emKg.id}/production-profile`,
      payload: { productionProfileVersionId: null },
    });
    expect(semPermissao.statusCode).toBe(403);
    expect((await leitor.inject(`/products/${emKg.id}/production-profile`)).statusCode).toBe(200);
  });

  it("a busca de roteiro escolhível traz só quem tem versão ativa, pelo servidor", async () => {
    const nome = `Escolhivel ${proximo()}`;
    const { perfil: comAtiva } = await perfilAtivo([etapa("Mistura")], { name: `${nome} ativo` });
    const soRascunho = await criarPerfil({ name: `${nome} rascunho` });

    const todos = (await app.inject(`/production-profiles?search=${encodeURIComponent(nome)}`)).json();
    expect(todos.profiles.map((p: { id: string }) => p.id).sort()).toEqual([comAtiva.id, soRascunho.id].sort());

    const escolhiveis = (await app.inject(`/production-profiles?search=${encodeURIComponent(nome)}&activeOnly=true`)).json();
    expect(escolhiveis.total).toBe(1);
    expect(escolhiveis.profiles[0].id).toBe(comAtiva.id);
    expect(escolhiveis.profiles[0].activeVersionId).not.toBeNull();
  });

  it("tirar o padrão devolve o produto a \"sem perfil\"", async () => {
    const { ativa } = await perfilAtivo([etapa("Mistura")]);
    const alvo = await produto("un");
    await definirPadrao(alvo.id, ativa.id);

    const tirado = await definirPadrao(alvo.id, null);
    expect(tirado.statusCode).toBe(200);
    expect((tirado.json() as ProductProductionProfileDTO).version).toBeNull();
  });
});
