import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Biblioteca técnica de Formulações.
 *
 * O que estes testes protegem é uma promessa: usar um template é COPIAR. Dois
 * clientes podem partir da mesma matriz e nada que um faça alcança o outro —
 * nem por dentro do template, nem por fora dele.
 *
 * Se essa promessa quebrar, a descoberta acontece na produção de um lote
 * errado. Por isso o isolamento tem teste em três direções: template → produto,
 * produto → produto e produto → template.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  /*
   * Só o que ESTE arquivo criou, pelos ids das próprias fixtures. Este banco é
   * compartilhado com o app local: procurar "qualquer template" para limpar
   * seria o começo de um teste que apaga trabalho alheio.
   */
  if (fixtureProductIds.length > 0) {
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureTemplateIds.length > 0) {
    // Formulações que citam estas versões já saíram acima; o resto cascateia.
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: fixtureTemplateIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createItem(unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-TPL-${m}`,
      name: `Insumo Template ${m}`,
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

/** Produto técnico com item acabado próprio e a V1 em rascunho vazia. */
async function createProduct(app: App) {
  const prisma = getPrisma();
  const m = marker();
  const finished = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-TPL-${m}`,
      name: `Acabado Template ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(finished.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto Template ${m}`, finishedProductItemId: finished.id },
    })
  ).json();
  fixtureProductIds.push(product.id);
  return product;
}

/** A V1 em rascunho, vazia — o estado em que um produto técnico chega aqui. */
async function criarV1Vazia(app: App, productId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/products/${productId}/formulation-versions`,
    payload: {},
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json();
}

async function criarTemplate(app: App, componentes: { itemId: string; quantity: string }[]) {
  const template = (
    await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `DEMO Matriz ${marker()}`, basisQuantity: "1", outputUnitCode: "un" },
    })
  ).json();
  fixtureTemplateIds.push(template.id);

  const draftId = template.draftVersion.id as string;
  await app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${draftId}`,
    payload: {
      components: componentes.map((c) => ({ ...c, unitCode: "g" })),
    },
  });
  const ativa = await app.inject({
    method: "POST",
    url: `/formulation-template-versions/${draftId}/activate`,
  });
  expect(ativa.statusCode, ativa.body).toBe(200);
  return { template, activeVersion: ativa.json() };
}

const aplicar = (app: App, productId: string, templateVersionId: string) =>
  app.inject({
    method: "POST",
    url: `/products/${productId}/formulation-versions/from-template`,
    payload: { formulationTemplateVersionId: templateVersionId },
  });

describe("Biblioteca de templates de formulação", () => {
  it("cria o template com código FT e a V1 em rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `DEMO Base ${marker()}`, description: "Matriz de teste" },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const template = resposta.json();
    fixtureTemplateIds.push(template.id);

    expect(template.code.startsWith("FT-")).toBe(true);
    expect(template.archived).toBe(false);
    // A matriz nasce com uma versão: um template sem versão é pasta vazia.
    expect(template.draftVersion.versionNumber).toBe(1);
    expect(template.draftVersion.status).toBe("DRAFT");
    expect(template.activeVersion).toBeNull();

    await app.close();
  });

  it("ativa a versão e a partir daí ela é histórica", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    expect(activeVersion.status).toBe("ACTIVE");
    expect(activeVersion.components).toHaveLength(1);

    const editar = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${activeVersion.id}`,
      payload: { basisQuantity: "9" },
    });
    expect(editar.statusCode).toBe(409);
    expect(editar.json().error).toBe("template_version_not_draft");

    await app.close();
  });

  it("recusa ativar versão sem componentes", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const template = (
      await app.inject({
        method: "POST",
        url: "/formulation-templates",
        payload: { name: `DEMO Vazia ${marker()}` },
      })
    ).json();
    fixtureTemplateIds.push(template.id);

    const recusado = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${template.draftVersion.id}/activate`,
    });
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_without_components");

    await app.close();
  });

  it("nova versão copia a ativa para rascunho, e só uma fica ativa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const item = await createItem();
    const { template, activeVersion } = await criarTemplate(app, [
      { itemId: item.id, quantity: "0.5" },
    ]);

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe("DRAFT");
    expect(v2.sourceVersionNumber).toBe(1);
    expect(v2.components).toHaveLength(1);

    // Um rascunho por template: dois seriam duas verdades em edição.
    const segundo = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${activeVersion.id}/new-version`,
    });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().error).toBe("template_draft_exists");

    await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: { components: [{ itemId: item.id, quantity: "0.9", unitCode: "g" }] },
    });
    await app.inject({ method: "POST", url: `/formulation-template-versions/${v2.id}/activate` });

    const ativas = await prisma.formulationTemplateVersion.count({
      where: { formulationTemplateId: template.id, status: "ACTIVE" },
    });
    expect(ativas).toBe(1);
    const anterior = await prisma.formulationTemplateVersion.findUniqueOrThrow({
      where: { id: activeVersion.id },
    });
    // A anterior é ARQUIVADA, não apagada: formulações apontam para ela.
    expect(anterior.status).toBe("ARCHIVED");

    await app.close();
  });
});

describe("Usar template em produto — cópia, nunca vínculo", () => {
  it("preenche a V1 vazia e registra a origem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { template, activeVersion } = await criarTemplate(app, [
      { itemId: item.id, quantity: "0.5" },
    ]);
    const product = await createProduct(app);

    const resposta = await aplicar(app, product.id, activeVersion.id);
    expect(resposta.statusCode, resposta.body).toBe(201);
    const formulacao = resposta.json();

    // Produto técnico nasce com V1 em branco: usá-la evita uma V1 órfã.
    expect(formulacao.versionNumber).toBe(1);
    expect(formulacao.status).toBe("DRAFT");
    expect(formulacao.components).toHaveLength(1);
    expect(formulacao.originTemplateVersionId).toBe(activeVersion.id);
    expect(formulacao.originTemplateCode).toBe(template.code);
    expect(formulacao.originTemplateVersionNumber).toBe(1);
    expect(formulacao.originTemplateName).toBe(template.name);

    await app.close();
  });

  it("cópia profunda: nenhuma linha é compartilhada com o template", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const product = await createProduct(app);
    const formulacao = (await aplicar(app, product.id, activeVersion.id)).json();

    const linhasDoTemplate = await prisma.formulationTemplateComponent.findMany({
      where: { formulationTemplateVersionId: activeVersion.id },
      select: { id: true },
    });
    const linhasDoProduto = await prisma.formulationComponent.findMany({
      where: { formulationVersionId: formulacao.id },
      select: { id: true },
    });
    const idsTemplate = new Set(linhasDoTemplate.map((linha) => linha.id));
    for (const linha of linhasDoProduto) {
      expect(idsTemplate.has(linha.id)).toBe(false);
    }
    expect(linhasDoProduto).toHaveLength(linhasDoTemplate.length);

    await app.close();
  });

  it("não sobrescreve formulação que já tem conteúdo: nasce versão nova", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const outro = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const product = await createProduct(app);

    // V1 recebe trabalho próprio antes de qualquer template.
    const v1 = await criarV1Vazia(app, product.id);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: outro.id, quantity: "0.3", unitCode: "g" }],
      },
    });

    const criada = (await aplicar(app, product.id, activeVersion.id)).json();
    expect(criada.versionNumber).toBe(2);
    expect(criada.status).toBe("DRAFT");

    // A V1 continua exatamente como estava.
    const v1Depois = (
      await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` })
    ).json();
    expect(v1Depois.components).toHaveLength(1);
    expect(v1Depois.components[0].itemId).toBe(outro.id);
    expect(v1Depois.originTemplateVersionId).toBeNull();

    await app.close();
  });

  it("só versão ATIVA de template vira formulação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const rascunho = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    const product = await createProduct(app);

    const recusado = await aplicar(app, product.id, rascunho.id);
    // Rascunho é trabalho em curso: ninguém revisou aquela matriz ainda.
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_version_not_active");

    await app.close();
  });

  it("template arquivado sai da escolha", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { template, activeVersion } = await criarTemplate(app, [
      { itemId: item.id, quantity: "0.5" },
    ]);
    await app.inject({
      method: "POST",
      url: `/formulation-templates/${template.id}/archive`,
      payload: { archived: true },
    });
    const product = await createProduct(app);

    const recusado = await aplicar(app, product.id, activeVersion.id);
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_archived");

    await app.close();
  });

  it("responsabilidade de fornecimento é sugestão: o produto altera sem tocar no template", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    expect(activeVersion.components[0].supplyResponsibility).toBe("VERIDI");

    const product = await createProduct(app);
    const formulacao = (await aplicar(app, product.id, activeVersion.id)).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${formulacao.id}`,
      payload: {
        basisQuantity: formulacao.basisQuantity,
        components: [
          {
            itemId: item.id,
            quantity: "0.5",
            unitCode: "g",
            supplyResponsibility: "CUSTOMER",
          },
        ],
      },
    });

    const depois = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}` })
    ).json();
    expect(depois.components[0].supplyResponsibility).toBe("CUSTOMER");

    // O template segue como estava — outro cliente ainda recebe VERIDI.
    const template = (
      await app.inject({ method: "GET", url: `/formulation-template-versions/${activeVersion.id}` })
    ).json();
    expect(template.components[0].supplyResponsibility).toBe("VERIDI");

    await app.close();
  });
});

describe("Isolamento — a promessa da biblioteca", () => {
  it("dois clientes usam a mesma matriz sem se alcançarem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const produtoA = await createProduct(app);
    const produtoB = await createProduct(app);

    const formulaA = (await aplicar(app, produtoA.id, activeVersion.id)).json();
    const formulaB = (await aplicar(app, produtoB.id, activeVersion.id)).json();

    expect(formulaA.id).not.toBe(formulaB.id);
    expect(formulaA.components[0].id).not.toBe(formulaB.components[0].id);
    expect(formulaA.originTemplateVersionId).toBe(activeVersion.id);
    expect(formulaB.originTemplateVersionId).toBe(activeVersion.id);

    // A muda; B não sente.
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${formulaA.id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: item.id, quantity: "0.99", unitCode: "g" }],
      },
    });

    const bDepois = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulaB.id}` })
    ).json();
    expect(bDepois.components[0].quantity).toBe("0.5");

    // E o template também não sentiu.
    const templateDepois = (
      await app.inject({ method: "GET", url: `/formulation-template-versions/${activeVersion.id}` })
    ).json();
    expect(templateDepois.components[0].quantity).toBe("0.5");

    await app.close();
  });

  it("template ganha V2 e as formulações existentes não mudam", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const produtoA = await createProduct(app);
    const produtoB = await createProduct(app);
    const formulaA = (await aplicar(app, produtoA.id, activeVersion.id)).json();
    const formulaB = (await aplicar(app, produtoB.id, activeVersion.id)).json();

    // Template evolui: V2 com outra quantidade, ativada.
    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: { basisQuantity: "2", components: [{ itemId: item.id, quantity: "1.5", unitCode: "g" }] },
    });
    await app.inject({ method: "POST", url: `/formulation-template-versions/${v2.id}/activate` });

    for (const formula of [formulaA, formulaB]) {
      const depois = (
        await app.inject({ method: "GET", url: `/formulation-versions/${formula.id}` })
      ).json();
      // Nada se sincroniza. Nenhum cliente teve a receita mudada porque
      // outro pediu alteração na matriz.
      expect(depois.components[0].quantity).toBe("0.5");
      expect(depois.basisQuantity).toBe("1");
      expect(depois.originTemplateVersionNumber).toBe(1);
    }

    await app.close();
  });

  it("avisa que existe versão nova, sem nunca atualizar sozinho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { template, activeVersion } = await criarTemplate(app, [
      { itemId: item.id, quantity: "0.5" },
    ]);
    const product = await createProduct(app);
    const formulacao = (await aplicar(app, product.id, activeVersion.id)).json();

    const semNovidade = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}/template-update` })
    ).json();
    expect(semNovidade.update).toBeNull();

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: { components: [{ itemId: item.id, quantity: "1.5", unitCode: "g" }] },
    });
    await app.inject({ method: "POST", url: `/formulation-template-versions/${v2.id}/activate` });

    const aviso = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}/template-update` })
    ).json().update;
    expect(aviso).not.toBeNull();
    expect(aviso.templateCode).toBe(template.code);
    expect(aviso.originVersionNumber).toBe(1);
    expect(aviso.latestVersionNumber).toBe(2);

    // Avisar não é atualizar: a formulação segue idêntica.
    const inalterada = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}` })
    ).json();
    expect(inalterada.components[0].quantity).toBe("0.5");

    await app.close();
  });

  it("compara a formulação com a versão nova do template", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const extra = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const product = await createProduct(app);
    const formulacao = (await aplicar(app, product.id, activeVersion.id)).json();

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: {
        basisQuantity: "2",
        components: [
          { itemId: item.id, quantity: "0.8", unitCode: "g" },
          { itemId: extra.id, quantity: "0.1", unitCode: "g" },
        ],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-template-versions/${v2.id}/activate` });

    const diff = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}/template-diff` })
    ).json();
    const tipos = diff.entries.map((entrada: { kind: string }) => entrada.kind);
    expect(tipos).toContain("BASIS");
    expect(tipos).toContain("COMPONENT_ADDED");
    expect(tipos).toContain("COMPONENT_CHANGED");
    const quantidade = diff.entries.find(
      (entrada: { field: string | null }) => entrada.field === "Quantidade",
    );
    expect(quantidade.from).toBe("0.5");
    expect(quantidade.to).toBe("0.8");

    await app.close();
  });

  it("nova formulação a partir da versão nova, com a anterior intacta", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const product = await createProduct(app);
    const primeira = (await aplicar(app, product.id, activeVersion.id)).json();
    await app.inject({ method: "POST", url: `/formulation-versions/${primeira.id}/activate` });

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: { components: [{ itemId: item.id, quantity: "1.5", unitCode: "g" }] },
    });
    const v2Ativa = (
      await app.inject({ method: "POST", url: `/formulation-template-versions/${v2.id}/activate` })
    ).json();

    const nova = (await aplicar(app, product.id, v2Ativa.id)).json();
    expect(nova.id).not.toBe(primeira.id);
    expect(nova.versionNumber).toBe(2);
    expect(nova.status).toBe("DRAFT");
    expect(nova.originTemplateVersionNumber).toBe(2);
    expect(nova.components[0].quantity).toBe("1.5");

    // A anterior continua histórica e ativa — nada ativou sozinho.
    const anterior = (
      await app.inject({ method: "GET", url: `/formulation-versions/${primeira.id}` })
    ).json();
    expect(anterior.status).toBe("ACTIVE");
    expect(anterior.components[0].quantity).toBe("0.5");

    await app.close();
  });
});

describe("Salvar formulação como template", () => {
  it("copia a técnica, nasce em rascunho e não move a formulação original", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const product = await createProduct(app);
    const v1 = await criarV1Vazia(app, product.id);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        basisQuantity: "1",
        components: [
          { itemId: item.id, quantity: "0.7", unitCode: "g", supplyResponsibility: "CUSTOMER" },
        ],
      },
    });

    const resposta = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.id}/save-as-template`,
      payload: { name: `DEMO Salvo ${marker()}`, description: "A partir do produto" },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const template = resposta.json();
    fixtureTemplateIds.push(template.id);

    // Nasce em RASCUNHO: quem vai reutilizar revisa antes.
    expect(template.activeVersion).toBeNull();
    expect(template.draftVersion.status).toBe("DRAFT");
    expect(template.draftVersion.components).toHaveLength(1);
    expect(template.draftVersion.components[0].quantity).toBe("0.7");
    expect(template.draftVersion.components[0].supplyResponsibility).toBe("CUSTOMER");

    // A formulação de origem não se moveu, não se converteu, não mudou de dono.
    const original = (
      await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` })
    ).json();
    expect(original.productId).toBe(product.id);
    expect(original.components).toHaveLength(1);
    expect(original.originTemplateVersionId).toBeNull();

    await app.close();
  });

  it("editar o template salvo não volta para a formulação de origem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const product = await createProduct(app);
    const v1 = await criarV1Vazia(app, product.id);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: item.id, quantity: "0.7", unitCode: "g" }],
      },
    });

    const template = (
      await app.inject({
        method: "POST",
        url: `/formulation-versions/${v1.id}/save-as-template`,
        payload: { name: `DEMO Independente ${marker()}` },
      })
    ).json();
    fixtureTemplateIds.push(template.id);

    await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${template.draftVersion.id}`,
      payload: { components: [{ itemId: item.id, quantity: "2.2", unitCode: "g" }] },
    });

    const original = (
      await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` })
    ).json();
    expect(original.components[0].quantity).toBe("0.7");

    await app.close();
  });

  it("o template não carrega nada comercial do produto de origem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const product = await createProduct(app);
    const v1 = await criarV1Vazia(app, product.id);
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: item.id, quantity: "0.7", unitCode: "g" }],
      },
    });

    const template = (
      await app.inject({
        method: "POST",
        url: `/formulation-versions/${v1.id}/save-as-template`,
        payload: { name: `DEMO Limpo ${marker()}` },
      })
    ).json();
    fixtureTemplateIds.push(template.id);

    /*
     * Uma matriz reutilizável entre clientes não pode carregar o nome de um
     * deles. Nem cliente, nem projeto, nem produto, nem preço.
     */
    const texto = JSON.stringify(template);
    expect(texto).not.toContain(product.id);
    expect(texto).not.toContain("customerId");
    expect(texto).not.toContain("projectId");
    expect(texto).not.toContain("pricing");
    expect(texto).not.toContain("productId");

    await app.close();
  });
});

describe("Template não é entrada de nenhum documento operacional", () => {
  it("formulações antigas seguem válidas com origem nula", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const product = await createProduct(app);
    const v1 = await criarV1Vazia(app, product.id);

    // Nenhum backfill inventado: quem nasceu sem template continua sem.
    expect(v1.originTemplateVersionId).toBeNull();
    expect(v1.originTemplateCode).toBeNull();
    expect(v1.originTemplateVersionNumber).toBeNull();

    await app.close();
  });

  it("nenhum documento de custo, preço ou pedido aponta para template", async () => {
    const prisma = getPrisma();
    /*
     * O motor de custo lê Produto → Formulação. Se algum dia alguém pendurar
     * uma estrutura de custos direto no template, este teste cai antes de o
     * problema chegar num orçamento.
     */
    const referencias = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT DISTINCT tc.table_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name IN ('formulation_templates', 'formulation_template_versions')`,
    );
    const tabelas = new Set(referencias.map((linha) => linha.table_name));
    for (const proibida of [
      "industrial_cost_versions",
      "industrial_cost_calculations",
      "pricing_versions",
      "pricing_tiers",
      "quote_lines",
      "quote_versions",
      "customer_orders",
      "customer_order_lines",
      "production_orders",
    ]) {
      expect(tabelas.has(proibida), `${proibida} não pode citar template`).toBe(false);
    }
    // Só a formulação do produto guarda a proveniência.
    expect(tabelas.has("formulation_versions")).toBe(true);
  });
});

describe("Autorização", () => {
  it("quem não pode escrever fórmula não cria nem ativa template", async () => {
    const viewer = buildTestApp("VIEWER");
    await viewer.ready();

    const criar = await viewer.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: "DEMO Não autorizado" },
    });
    expect(criar.statusCode).toBe(403);

    // Mas consegue LER a biblioteca: saber o que existe é trabalho normal.
    const listar = await viewer.inject({ method: "GET", url: "/formulation-templates" });
    expect(listar.statusCode).toBe(200);

    await viewer.close();
  });

  it("papel comercial lê a biblioteca mas não a edita", async () => {
    const comercial = buildTestApp("COMMERCIAL");
    await comercial.ready();

    expect((await comercial.inject({ method: "GET", url: "/formulation-templates" })).statusCode).toBe(
      200,
    );
    const criar = await comercial.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: "DEMO Comercial" },
    });
    expect(criar.statusCode).toBe(403);

    await comercial.close();
  });
});

describe("Transação", () => {
  it("componente inválido não deixa versão pela metade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const item = await createItem();
    const { activeVersion } = await criarTemplate(app, [{ itemId: item.id, quantity: "0.5" }]);
    const v2 = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();

    const antes = await prisma.formulationTemplateComponent.count({
      where: { formulationTemplateVersionId: v2.id },
    });

    // Unidade incompatível com a do item: a edição inteira precisa parar.
    const recusado = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: {
        basisQuantity: "5",
        components: [{ itemId: item.id, quantity: "1", unitCode: "un" }],
      },
    });
    expect(recusado.statusCode).toBe(400);

    const depois = await prisma.formulationTemplateVersion.findUniqueOrThrow({
      where: { id: v2.id },
      include: { components: true },
    });
    expect(depois.components).toHaveLength(antes);
    // A base também não pode ter mudado: ou tudo, ou nada.
    expect(depois.basisQuantity.toString()).toBe("1");

    await app.close();
  });
});
