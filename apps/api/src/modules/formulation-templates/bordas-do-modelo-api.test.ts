import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 3) — as BORDAS do Modelo.
 *
 * O cadastro do Item muda depois que a receita foi gravada: o item é inativado,
 * vira produto acabado, troca de unidade. O que fica provado, com número:
 *
 *   - ativar o Modelo RELÊ o cadastro e recusa, nomeando cada item e o motivo;
 *     a versão continua rascunho, e a ativa anterior continua ativa;
 *   - o rascunho do Modelo diz o que vai barrar a ativação (`componentIssues`),
 *     e a versão ativa diz o mesmo para quem vai aplicá-la; a arquivada cala;
 *   - aplicar um Modelo com aviso GERA a Formulação em rascunho (decisão D-6),
 *     e a ativação dela continua fechada até a correção;
 *   - aplicar recusado não deixa nada pela metade;
 *   - o diff explica as premissas técnicas e a ordem, com rótulos da tela;
 *   - Formulação → Modelo → Formulação é ida e volta: premissas, pureza,
 *     reserva, fornecimento, base, ordem e embalagem atravessam, nada comercial
 *     atravessa, e a cópia é independente;
 *   - salvar como Modelo é UMA escrita: recusa não deixa Modelo vazio, e item
 *     inativado atravessa como pendência em vez de derrubar a cópia.
 */

/** Conta independente, em Decimal — nunca Number (§59). */
const D = (value: string | number) => new Prisma.Decimal(value);

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;
type Issue = { itemId: string; itemCode: string; code: string; description: string };
type Entrada = { kind: string; label: string; field: string | null; from: string | null; to: string | null };

beforeAll(async () => {
  const prisma = getPrisma();
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS" as const, toBaseFactor: "0.001" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que ESTE arquivo criou, pelos ids das próprias fixtures.
  if (fixtureProductIds.length > 0) {
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureTemplateIds.length > 0) {
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: fixtureTemplateIds } } });
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
  unitCode: string,
  nome = "Item Bordas",
) {
  const m = marker();
  const prefixo = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "EM" : "PA";
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${prefixo}-BRD-${m}`,
      name: `${nome} ${m}`,
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

/** Produto com item acabado próprio e a V1 em rascunho, vazia. */
async function createProduct(app: App) {
  const acabado = await createItem("FINISHED_PRODUCT", "un", "Acabado Bordas");
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto Bordas ${marker()}`,
        finishedProductItemId: acabado.id,
      },
    })
  ).json();
  fixtureProductIds.push(product.id);
  const v1 = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  expect(v1.statusCode, v1.body).toBe(201);
  return { product: product as { id: string }, v1: v1.json() as { id: string } };
}

async function criarModelo(app: App) {
  const template = (
    await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `Modelo Bordas ${marker()}`, basisQuantity: "1", outputUnitCode: "un" },
    })
  ).json();
  fixtureTemplateIds.push(template.id);
  return { templateId: template.id as string, draftId: template.draftVersion.id as string };
}

async function gravar(app: App, versionId: string, payload: Record<string, unknown>) {
  const resposta = await app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${versionId}`,
    payload,
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

const ativar = (app: App, versionId: string) =>
  app.inject({ method: "POST", url: `/formulation-template-versions/${versionId}/activate` });

const lerVersao = async (app: App, versionId: string) =>
  (await app.inject({ method: "GET", url: `/formulation-template-versions/${versionId}` })).json();

const aplicar = (app: App, productId: string, templateVersionId: string) =>
  app.inject({
    method: "POST",
    url: `/products/${productId}/formulation-versions/from-template`,
    payload: { formulationTemplateVersionId: templateVersionId },
  });

async function novaVersao(app: App, versionId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/formulation-template-versions/${versionId}/new-version`,
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json();
}

/** Modelo ATIVO com uma matéria-prima e um pote — a matriz mínima das bordas. */
async function modeloAtivo(app: App) {
  const insumo = await createItem("RAW_MATERIAL", "kg", "Vitamina Bordas");
  const pote = await createItem("PACKAGING", "un", "Pote Bordas");
  const { templateId, draftId } = await criarModelo(app);
  await gravar(app, draftId, {
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 2,
    capsulesPerPackage: 60,
    components: [
      { itemId: insumo.id, quantity: "250", unitCode: "mg", basis: "PER_DOSE" },
      { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
    ],
  });
  const ativa = await ativar(app, draftId);
  expect(ativa.statusCode, ativa.body).toBe(200);
  return { templateId, versaoId: draftId, insumo, pote };
}

describe("Ativar o Modelo relê o cadastro do Item", () => {
  it("item inativado depois da gravação: recusa nomeada, e o rascunho continua rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { versaoId, insumo } = await modeloAtivo(app);
    const v2 = await novaVersao(app, versaoId);

    // O cadastro muda DEPOIS de a linha estar no rascunho.
    await getPrisma().item.update({ where: { id: insumo.id }, data: { active: false } });

    const rascunho = await lerVersao(app, v2.id);
    expect(rascunho.componentIssues).toHaveLength(1);
    expect(rascunho.componentIssues[0]).toMatchObject({
      itemId: insumo.id,
      itemCode: insumo.code,
      code: "ITEM_INACTIVE",
    });

    const recusa = await ativar(app, v2.id);
    expect(recusa.statusCode, recusa.body).toBe(400);
    expect(recusa.json().error).toBe("invalid_component");
    expect(recusa.json().message).toContain(`${insumo.code} (inativo)`);
    expect(recusa.json().message).toMatch(/modelo/i);
    expect(recusa.json().message).not.toMatch(/template/i);
    expect(recusa.json().componentIssues.map((issue: Issue) => issue.code)).toEqual([
      "ITEM_INACTIVE",
    ]);

    // Nada foi reescrito: V2 segue rascunho, V1 segue ativa.
    const prisma = getPrisma();
    expect((await prisma.formulationTemplateVersion.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe(
      "DRAFT",
    );
    expect((await prisma.formulationTemplateVersion.findUniqueOrThrow({ where: { id: versaoId } })).status).toBe(
      "ACTIVE",
    );

    // O rascunho continua editável COM a linha herdada — é onde se corrige.
    const substituto = await createItem("RAW_MATERIAL", "kg", "Vitamina Nova");
    const [linhaInsumo, linhaPote] = rascunho.components as { itemId: string; unitCode: string; basis: string }[];
    const mantida = await gravar(app, v2.id, {
      components: [
        { itemId: linhaInsumo!.itemId, quantity: "300", unitCode: "mg", basis: "PER_DOSE" },
        { itemId: linhaPote!.itemId, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
      ],
    });
    expect(mantida.componentIssues).toHaveLength(1);

    // Trocar o item resolve, e aí a ativação passa.
    const corrigida = await gravar(app, v2.id, {
      components: [
        { itemId: substituto.id, quantity: "300", unitCode: "mg", basis: "PER_DOSE" },
        { itemId: linhaPote!.itemId, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
      ],
    });
    expect(corrigida.componentIssues).toEqual([]);
    const ativada = await ativar(app, v2.id);
    expect(ativada.statusCode, ativada.body).toBe(200);
    await app.close();
  });

  it("item que virou produto acabado e item que perdeu a unidade: os dois nomeados na mesma recusa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const acabado = await createItem("RAW_MATERIAL", "kg", "Vira Acabado");
    const semUnidade = await createItem("RAW_MATERIAL", "kg", "Muda Unidade");
    const { draftId } = await criarModelo(app);
    await gravar(app, draftId, {
      components: [
        { itemId: acabado.id, quantity: "2", unitCode: "kg" },
        { itemId: semUnidade.id, quantity: "3", unitCode: "g" },
      ],
    });

    const prisma = getPrisma();
    await prisma.item.update({ where: { id: acabado.id }, data: { type: "FINISHED_PRODUCT" } });
    // Massa → contagem: "3 g" deixa de ser compatível com o estoque do Item.
    await prisma.item.update({ where: { id: semUnidade.id }, data: { unitCode: "un" } });

    const rascunho = await lerVersao(app, draftId);
    const codigos = rascunho.componentIssues.map((issue: Issue) => `${issue.itemCode}:${issue.code}`);
    expect(codigos).toEqual([
      `${acabado.code}:ITEM_IS_FINISHED_PRODUCT`,
      `${semUnidade.code}:UOM_INCOMPATIBLE`,
    ]);

    const recusa = await ativar(app, draftId);
    expect(recusa.statusCode, recusa.body).toBe(400);
    const mensagem: string = recusa.json().message;
    expect(mensagem).toContain(`${acabado.code} (produto acabado)`);
    expect(mensagem).toContain(`${semUnidade.code} (unidade incompatível)`);
    expect(
      (await prisma.formulationTemplateVersion.findUniqueOrThrow({ where: { id: draftId } })).status,
    ).toBe("DRAFT");
    await app.close();
  });

  it("quantidade inválida gravada por fora da API também barra a ativação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", "Quantidade Zero");
    const { draftId } = await criarModelo(app);
    await gravar(app, draftId, { components: [{ itemId: insumo.id, quantity: "2", unitCode: "kg" }] });

    // Dado legado: a API nunca aceitaria zero.
    await getPrisma().formulationTemplateComponent.updateMany({
      where: { formulationTemplateVersionId: draftId },
      data: { quantity: D("0") },
    });

    const rascunho = await lerVersao(app, draftId);
    expect(rascunho.componentIssues.map((issue: Issue) => issue.code)).toEqual(["INVALID_QUANTITY"]);
    const recusa = await ativar(app, draftId);
    expect(recusa.statusCode, recusa.body).toBe(400);
    expect(recusa.json().message).toContain(`${insumo.code} (quantidade inválida)`);
    await app.close();
  });

  it("a versão ATIVA avisa quem vai aplicá-la; a arquivada não aponta nada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { templateId, versaoId, insumo } = await modeloAtivo(app);
    const v2 = await novaVersao(app, versaoId);
    expect((await ativar(app, v2.id)).statusCode).toBe(200);
    // V1 arquivada, V2 ativa. Agora o item sai do cadastro ativo.
    await getPrisma().item.update({ where: { id: insumo.id }, data: { active: false } });

    const modelo = (await app.inject({ method: "GET", url: `/formulation-templates/${templateId}` })).json();
    expect(modelo.activeVersion.id).toBe(v2.id);
    expect(modelo.activeVersion.componentIssues.map((issue: Issue) => issue.code)).toEqual([
      "ITEM_INACTIVE",
    ]);
    const arquivada = modelo.versions.find((versao: { id: string }) => versao.id === versaoId);
    expect(arquivada.status).toBe("ARCHIVED");
    expect(arquivada.componentIssues).toEqual([]);
    await app.close();
  });
});

describe("Aplicar o Modelo com aviso — decisão D-6", () => {
  it("gera a Formulação em rascunho com a receita inteira, e a ativação dela fica fechada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { versaoId, insumo, pote } = await modeloAtivo(app);
    await getPrisma().item.update({ where: { id: insumo.id }, data: { active: false } });

    // O aviso existe ANTES de aplicar.
    const ativa = await lerVersao(app, versaoId);
    expect(ativa.componentIssues.map((issue: Issue) => issue.itemCode)).toEqual([insumo.code]);

    const { product } = await createProduct(app);
    const aplicada = await aplicar(app, product.id, versaoId);
    expect(aplicada.statusCode, aplicada.body).toBe(201);
    const formulacao = aplicada.json();
    expect(formulacao.status).toBe("DRAFT");
    // Snapshot inteiro: o item com aviso atravessa, junto do pote.
    expect(formulacao.components.map((c: { itemId: string }) => c.itemId)).toEqual([
      insumo.id,
      pote.id,
    ]);
    expect(formulacao.componentIssues.map((issue: Issue) => `${issue.itemId}:${issue.code}`)).toEqual([
      `${insumo.id}:ITEM_INACTIVE`,
    ]);

    // O aviso NÃO é autorização: a ativação da Formulação recusa, e nada muda.
    const recusa = await app.inject({
      method: "POST",
      url: `/formulation-versions/${formulacao.id}/activate`,
    });
    expect(recusa.statusCode, recusa.body).toBe(400);
    expect(recusa.json().message).toContain(`${insumo.code} (inativo)`);
    const depois = await getPrisma().formulationVersion.findUniqueOrThrow({
      where: { id: formulacao.id },
    });
    expect(depois.status).toBe("DRAFT");

    // No rascunho se corrige: troca o item, e aí ativa.
    const substituto = await createItem("RAW_MATERIAL", "kg", "Substituto D6");
    const corrigida = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${formulacao.id}`,
      payload: {
        components: [
          { itemId: substituto.id, quantity: "250", unitCode: "mg", basis: "PER_DOSE" },
          { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
        ],
      },
    });
    expect(corrigida.statusCode, corrigida.body).toBe(200);
    expect(corrigida.json().componentIssues).toEqual([]);
    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-versions/${formulacao.id}/activate`,
    });
    expect(ativada.statusCode, ativada.body).toBe(200);
    await app.close();
  });

  it("recusa na aplicação não deixa nada pela metade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { templateId, versaoId } = await modeloAtivo(app);
    const { product, v1 } = await createProduct(app);

    // Arquivado entre abrir o diálogo e clicar: recusa, e a V1 vazia fica vazia.
    await app.inject({
      method: "POST",
      url: `/formulation-templates/${templateId}/archive`,
      payload: { archived: true },
    });
    const recusa = await aplicar(app, product.id, versaoId);
    expect(recusa.statusCode, recusa.body).toBe(409);

    const prisma = getPrisma();
    const versoes = await prisma.formulationVersion.findMany({
      where: { productId: product.id },
      include: { components: true },
    });
    expect(versoes.map((versao) => versao.id)).toEqual([v1.id]);
    expect(versoes[0]!.components).toHaveLength(0);
    expect(versoes[0]!.originTemplateVersionId).toBeNull();
    await app.close();
  });
});

describe("Diff das versões do Modelo explica as premissas", () => {
  it("forma, apresentação, cápsulas, dose, conteúdo, doses e perda — com rótulos da tela", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", "Diff Premissas");
    const { draftId } = await criarModelo(app);
    await gravar(app, draftId, {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 2,
      capsulesPerPackage: 120,
      expectedLossPercent: "3",
      components: [{ itemId: insumo.id, quantity: "250", unitCode: "mg", basis: "PER_DOSE" }],
    });
    expect((await ativar(app, draftId)).statusCode).toBe(200);
    const v2 = await novaVersao(app, draftId);
    await gravar(app, v2.id, {
      dosageForm: "POWDER",
      presentationType: "POUCH",
      doseAmount: "5",
      doseUomCode: "g",
      packageContentAmount: "150",
      packageContentUomCode: "g",
      expectedLossPercent: "5",
    });

    const diff = (
      await app.inject({
        method: "GET",
        url: `/formulation-template-versions/${draftId}/compare?against=${v2.id}`,
      })
    ).json();
    const por = (kind: string) => diff.entries.find((entrada: Entrada) => entrada.kind === kind);

    expect(por("DOSAGE_FORM")).toMatchObject({ label: "Forma do produto", from: "Cápsula", to: "Pó" });
    expect(por("PRESENTATION")).toMatchObject({
      label: "Apresentação comercial",
      from: "Pote",
      to: "Sachê/Pouch",
    });
    expect(por("CAPSULES_PER_DOSE")).toMatchObject({ from: "2", to: "Não informada" });
    expect(por("DOSE")).toMatchObject({ label: "Dose", from: "Não informada", to: "5 g" });
    expect(por("PACKAGE_CONTENT")).toMatchObject({
      label: "Conteúdo da embalagem",
      from: "Não informada",
      to: "150 g",
    });
    // 120 cápsulas ÷ 2 = 60 doses; 150 g ÷ 5 g = 30 doses. A derivação mudou.
    expect(por("DOSES")).toMatchObject({ label: "Doses por embalagem", from: "60", to: "30" });
    expect(por("EXPECTED_LOSS")).toMatchObject({
      label: "Perda prevista de produção (%)",
      from: "3",
      to: "5",
    });

    /*
     * Nenhum nome interno chega ao que a tela mostra: o `kind` é chave de
     * tradução, e rótulo, campo e valores são texto de gente.
     */
    const visivel = diff.entries
      .flatMap(({ label, field, from, to }: Entrada) => [label, field, from, to])
      .filter((texto: string | null): texto is string => texto !== null)
      .join(" | ");
    for (const interno of [
      "CAPSULE",
      "POWDER",
      "POT",
      "POUCH",
      "dosageForm",
      "presentationType",
      "doseAmount",
      "packageContent",
      "expectedLoss",
      "capsulesPerDose",
      "null",
    ]) {
      expect(visivel, interno).not.toContain(interno);
    }
    await app.close();
  });

  it("só a unidade da dose mudou: a entrada mostra quantidade e unidade juntas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", "Diff Unidade");
    const { draftId } = await criarModelo(app);
    await gravar(app, draftId, {
      dosageForm: "POWDER",
      doseAmount: "5",
      doseUomCode: "g",
      packageContentAmount: "150",
      packageContentUomCode: "g",
      components: [{ itemId: insumo.id, quantity: "800", unitCode: "mg", basis: "PER_DOSE" }],
    });
    expect((await ativar(app, draftId)).statusCode).toBe(200);
    const v2 = await novaVersao(app, draftId);
    await gravar(app, v2.id, { doseAmount: "5000", doseUomCode: "mg" });

    const diff = (
      await app.inject({
        method: "GET",
        url: `/formulation-template-versions/${draftId}/compare?against=${v2.id}`,
      })
    ).json();
    const dose = diff.entries.filter((entrada: Entrada) => entrada.kind === "DOSE");
    expect(dose).toHaveLength(1);
    expect(dose[0]).toMatchObject({ from: "5 g", to: "5000 mg" });
    // A mesma massa: as doses por embalagem não mudam, e o diff não inventa.
    expect(diff.entries.some((entrada: Entrada) => entrada.kind === "DOSES")).toBe(false);
    await app.close();
  });

  it("componentes: pureza, reserva, fornecimento, base e ordem com os nomes da bancada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const a = await createItem("RAW_MATERIAL", "kg", "Ordem A");
    const b = await createItem("RAW_MATERIAL", "kg", "Ordem B");
    const c = await createItem("RAW_MATERIAL", "kg", "Ordem C");
    const pote = await createItem("PACKAGING", "un", "Ordem Pote");
    const { draftId } = await criarModelo(app);
    await gravar(app, draftId, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 1,
      capsulesPerPackage: 30,
      components: [
        { itemId: a.id, quantity: "100", unitCode: "mg", basis: "PER_DOSE" },
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
        { itemId: b.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" },
        { itemId: c.id, quantity: "300", unitCode: "mg", basis: "PER_DOSE" },
      ],
    });
    expect((await ativar(app, draftId)).statusCode).toBe(200);
    const v2 = await novaVersao(app, draftId);
    const novo = await createItem("RAW_MATERIAL", "kg", "Ordem Novo");
    // Um item novo entra no TOPO da composição; A desce para depois de B; C só
    // ganha pureza e reserva. O pote vem PRIMEIRO na lista e continua na
    // embalagem.
    await gravar(app, v2.id, {
      components: [
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
        { itemId: novo.id, quantity: "50", unitCode: "mg", basis: "PER_DOSE" },
        { itemId: b.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" },
        {
          itemId: a.id,
          quantity: "100",
          unitCode: "mg",
          basis: "PER_DOSE",
          supplyResponsibility: "CUSTOMER",
        },
        {
          itemId: c.id,
          quantity: "300",
          unitCode: "mg",
          basis: "PER_DOSE",
          purityPercentApplied: "98",
          overagePercent: "2",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: true,
        },
      ],
    });

    const diff = (
      await app.inject({
        method: "GET",
        url: `/formulation-template-versions/${draftId}/compare?against=${v2.id}`,
      })
    ).json();
    const doItem = (codigo: string) =>
      diff.entries.filter(
        (entrada: Entrada) => entrada.kind === "COMPONENT_CHANGED" && entrada.label.includes(codigo),
      );
    const campos = (codigo: string) => doItem(codigo).map((entrada: Entrada) => entrada.field);

    /*
     * Ordem. Antes: A, B, C. Depois: Novo, B, A, C. A foi MOVIDA (1ª → 3ª).
     * B passou para cima de A, mas continua na 2ª linha da tela — uma entrada
     * "2ª → 2ª" não diria nada. C só desceu porque o Novo entrou em cima: não
     * foi movida, e não ganha entrada. O pote não mudou de lugar na embalagem.
     */
    expect(doItem(a.code).find((e: Entrada) => e.field === "Posição na composição")).toMatchObject({
      from: "1ª linha",
      to: "3ª linha",
    });
    expect(campos(b.code)).toEqual([]);
    expect(campos(c.code)).not.toContain("Posição na composição");
    expect(campos(pote.code)).toEqual([]);

    expect(doItem(a.code).find((e: Entrada) => e.field === "Fornecimento")).toMatchObject({
      from: "Veridi",
      to: "Cliente",
    });
    expect(doItem(c.code).find((e: Entrada) => e.field === "Pureza (%)")).toMatchObject({
      from: "—",
      to: "98",
    });
    expect(doItem(c.code).find((e: Entrada) => e.field === "Reserva (%)")).toMatchObject({
      from: "—",
      to: "2",
    });
    // Nenhum rótulo em inglês sobrou.
    expect(JSON.stringify(diff.entries)).not.toMatch(/overage/i);
    expect(
      diff.entries.filter((entrada: Entrada) => entrada.kind === "COMPONENT_ADDED").map((e: Entrada) => e.label),
    ).toEqual([`${novo.name} (${novo.code})`]);
    await app.close();
  });

  it("subir uma linha na bancada: as duas linhas trocadas dizem de onde para onde", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const a = await createItem("RAW_MATERIAL", "kg", "Troca A");
    const b = await createItem("RAW_MATERIAL", "kg", "Troca B");
    const { draftId } = await criarModelo(app);
    const linha = (itemId: string) => ({ itemId, quantity: "2", unitCode: "kg" });
    await gravar(app, draftId, { components: [linha(a.id), linha(b.id)] });
    expect((await ativar(app, draftId)).statusCode).toBe(200);
    const v2 = await novaVersao(app, draftId);
    await gravar(app, v2.id, { components: [linha(b.id), linha(a.id)] });

    const diff = (
      await app.inject({
        method: "GET",
        url: `/formulation-template-versions/${draftId}/compare?against=${v2.id}`,
      })
    ).json();
    const posicoes = diff.entries
      .filter((entrada: Entrada) => entrada.field === "Posição na composição")
      .map((entrada: Entrada) => `${entrada.label}: ${entrada.from} → ${entrada.to}`);
    expect(posicoes).toEqual([
      `${b.name} (${b.code}): 2ª linha → 1ª linha`,
      `${a.name} (${a.code}): 1ª linha → 2ª linha`,
    ]);
    // Só a ordem mudou: nenhuma outra entrada.
    expect(diff.entries).toHaveLength(2);
    await app.close();
  });

  it("Formulação × versão nova do Modelo também compara as premissas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { versaoId } = await modeloAtivo(app);
    const { product } = await createProduct(app);
    const formulacao = (await aplicar(app, product.id, versaoId)).json();

    const v2 = await novaVersao(app, versaoId);
    await gravar(app, v2.id, { capsulesPerDose: 3, capsulesPerPackage: 90, expectedLossPercent: "4" });
    expect((await ativar(app, v2.id)).statusCode).toBe(200);

    const diff = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}/template-diff` })
    ).json();
    const tipos = diff.entries.map((entrada: Entrada) => entrada.kind);
    const por = (kind: string) => diff.entries.find((entrada: Entrada) => entrada.kind === kind);
    // O lado da Formulação é lido pelo mesmo leitor: valores reais, nunca vazios.
    expect(por("CAPSULES_PER_DOSE")).toMatchObject({ from: "2", to: "3" });
    expect(por("EXPECTED_LOSS")).toMatchObject({ from: "Não informada", to: "4" });
    // Forma e apresentação iguais dos dois lados: nenhuma entrada inventada.
    expect(tipos).not.toContain("DOSAGE_FORM");
    expect(tipos).not.toContain("PRESENTATION");
    // 60 ÷ 2 = 30 doses antes; 90 ÷ 3 = 30 depois: a derivação não mudou.
    expect(tipos).not.toContain("DOSES");
    expect(diff.fromLabel).toBe(`Formulação V${formulacao.versionNumber}`);
    await app.close();
  });
});

describe("Formulação → Modelo → Formulação: ida e volta", () => {
  it("premissas, pureza, reserva, fornecimento, base, ordem e embalagem atravessam; a cópia é independente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const b = await createItem("RAW_MATERIAL", "kg", "Ida B");
    const a = await createItem("RAW_MATERIAL", "kg", "Ida A");
    const pote = await createItem("PACKAGING", "un", "Ida Pote");
    const tampa = await createItem("PACKAGING", "un", "Ida Tampa");
    const { product: origem, v1 } = await createProduct(app);

    const receita = {
      dosageForm: "CAPSULE",
      presentationType: "BOTTLE",
      capsulesPerDose: 2,
      capsulesPerPackage: 60,
      expectedLossPercent: "2.5",
      notes: "Receita homologada",
      components: [
        {
          itemId: b.id,
          quantity: "300",
          unitCode: "mg",
          basis: "PER_DOSE",
          supplyResponsibility: "CUSTOMER",
          purityPercentApplied: "97.5",
          overagePercent: "10",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: true,
        },
        {
          itemId: a.id,
          quantity: "150",
          unitCode: "mg",
          basis: "PER_DOSE",
          overagePercent: "2",
        },
        { itemId: tampa.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
      ],
    };
    const gravada = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: receita,
    });
    expect(gravada.statusCode, gravada.body).toBe(200);
    // Homologada: a Formulação é ATIVADA antes de virar Modelo.
    const homologada = await app.inject({ method: "POST", url: `/formulation-versions/${v1.id}/activate` });
    expect(homologada.statusCode, homologada.body).toBe(200);

    const salvo = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.id}/save-as-template`,
      payload: { name: `Ida e volta ${marker()}` },
    });
    expect(salvo.statusCode, salvo.body).toBe(201);
    const modelo = salvo.json();
    fixtureTemplateIds.push(modelo.id);
    expect(modelo.activeVersion).toBeNull();
    expect(modelo.draftVersion.status).toBe("DRAFT");
    expect(modelo.draftVersion.componentIssues).toEqual([]);

    const ativado = await ativar(app, modelo.draftVersion.id);
    expect(ativado.statusCode, ativado.body).toBe(200);

    const { product: destino } = await createProduct(app);
    const aplicada = await aplicar(app, destino.id, modelo.draftVersion.id);
    expect(aplicada.statusCode, aplicada.body).toBe(201);
    const copia = aplicada.json();
    const original = (
      await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` })
    ).json();

    // As premissas voltam iguais.
    for (const campo of [
      "dosageForm",
      "presentationType",
      "capsulesPerDose",
      "capsulesPerPackage",
      "dosesPerPackage",
      "calculationMode",
      "notes",
    ]) {
      expect(copia[campo], campo).toEqual(original[campo]);
    }
    expect(D(copia.expectedLossPercent).equals(D(original.expectedLossPercent))).toBe(true);
    expect(D(copia.basisQuantity).equals(D(original.basisQuantity))).toBe(true);

    // A receita volta igual, NA MESMA ORDEM, embalagem incluída.
    type Linha = {
      itemId: string;
      quantity: string;
      unitCode: string;
      basis: string;
      supplyResponsibility: string;
      purityPercentApplied: string | null;
      overagePercent: string | null;
      quantityMode: string;
      applyPurityAdjustment: boolean;
      applyOverageAdjustment: boolean;
      position: number;
    };
    const resumo = (linha: Linha) => ({
      itemId: linha.itemId,
      quantity: D(linha.quantity).toString(),
      unitCode: linha.unitCode,
      basis: linha.basis,
      supply: linha.supplyResponsibility,
      pureza: linha.purityPercentApplied === null ? null : D(linha.purityPercentApplied).toString(),
      reserva: linha.overagePercent === null ? null : D(linha.overagePercent).toString(),
      modo: linha.quantityMode,
      aplicaPureza: linha.applyPurityAdjustment,
      aplicaReserva: linha.applyOverageAdjustment,
      position: linha.position,
    });
    expect(copia.components.map(resumo)).toEqual(original.components.map(resumo));
    expect(copia.components.map((linha: Linha) => linha.itemId)).toEqual([b.id, a.id, tampa.id, pote.id]);
    expect(resumo(copia.components[0])).toMatchObject({
      supply: "CUSTOMER",
      pureza: "97.5",
      reserva: "10",
      aplicaPureza: true,
    });

    // Nada comercial atravessa: nem o Produto nem o Cliente de origem.
    const texto = JSON.stringify(modelo);
    expect(texto).not.toContain(origem.id);
    expect(texto).not.toContain("customerId");
    expect(copia.productId).toBe(destino.id);
    expect(copia.originTemplateVersionId).toBe(modelo.draftVersion.id);

    // INDEPENDÊNCIA: a V2 do Modelo muda tudo, e a cópia da V1 não se move.
    const v2 = await novaVersao(app, modelo.draftVersion.id);
    await gravar(app, v2.id, {
      capsulesPerDose: 1,
      capsulesPerPackage: 60,
      expectedLossPercent: "9",
      components: [
        { itemId: a.id, quantity: "999", unitCode: "mg", basis: "PER_DOSE", purityPercentApplied: "50" },
      ],
    });
    expect((await ativar(app, v2.id)).statusCode).toBe(200);
    const relida = (
      await app.inject({ method: "GET", url: `/formulation-versions/${copia.id}` })
    ).json();
    expect(relida.components.map(resumo)).toEqual(copia.components.map(resumo));
    expect(relida.capsulesPerDose).toBe(2);
    expect(D(relida.expectedLossPercent).equals(D("2.5"))).toBe(true);
    // E a Formulação de origem também não.
    const origemRelida = (
      await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` })
    ).json();
    expect(origemRelida.components.map(resumo)).toEqual(original.components.map(resumo));
    await app.close();
  });

  it("item inativado depois da homologação atravessa como pendência — a cópia não cai", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", "Inativado Depois");
    const { v1 } = await createProduct(app);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        components: [{ itemId: insumo.id, quantity: "0.7", unitCode: "g", basis: "FIXED_BASIS" }],
      },
    });
    expect(
      (await app.inject({ method: "POST", url: `/formulation-versions/${v1.id}/activate` })).statusCode,
    ).toBe(200);
    await getPrisma().item.update({ where: { id: insumo.id }, data: { active: false } });

    const nome = `Com pendência ${marker()}`;
    const salvo = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.id}/save-as-template`,
      payload: { name: nome },
    });
    expect(salvo.statusCode, salvo.body).toBe(201);
    const modelo = salvo.json();
    fixtureTemplateIds.push(modelo.id);
    expect(modelo.draftVersion.components.map((c: { itemId: string }) => c.itemId)).toEqual([insumo.id]);
    expect(modelo.draftVersion.componentIssues.map((issue: Issue) => issue.code)).toEqual([
      "ITEM_INACTIVE",
    ]);
    // Um Modelo só, e a ativação dele continua fechada.
    expect(await getPrisma().formulationTemplate.count({ where: { name: nome } })).toBe(1);
    const recusa = await ativar(app, modelo.draftVersion.id);
    expect(recusa.statusCode, recusa.body).toBe(400);
    expect(recusa.json().message).toContain(`${insumo.code} (inativo)`);
    await app.close();
  });

  it("recusa ao salvar como Modelo não deixa Modelo vazio na biblioteca", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", "Sem Doses");
    const { v1 } = await createProduct(app);
    // Rascunho por dose sem doses: a Formulação aceita incompleto; o Modelo não.
    const gravada = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        calculationMode: "PER_DOSE",
        components: [{ itemId: insumo.id, quantity: "100", unitCode: "mg", basis: "PER_DOSE" }],
      },
    });
    expect(gravada.statusCode, gravada.body).toBe(200);
    expect(gravada.json().dosesPerPackage).toBeNull();

    const nome = `Recusado ${marker()}`;
    const recusa = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.id}/save-as-template`,
      payload: { name: nome },
    });
    expect(recusa.statusCode, recusa.body).toBe(400);
    expect(await getPrisma().formulationTemplate.count({ where: { name: nome } })).toBe(0);
    await app.close();
  });
});
