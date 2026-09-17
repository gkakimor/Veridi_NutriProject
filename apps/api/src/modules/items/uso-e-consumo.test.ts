import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Uso e consumo — INTERNAL-CONSUMABLE-ITEM-TYPE-01.
 *
 * O tipo novo é material COMPRADO e ESTOCADO que não entra em receita: luva,
 * detergente, filme. Duas metades, e as duas precisam de prova.
 *
 * O que ele FAZ: nasce com código próprio (`UC-000001`), numerado por uma
 * sequence só dele, aparece nos filtros de Item e de Estoque, tem fornecedor e
 * entra em Pedido de Compra.
 *
 * O que ele NÃO faz: Formulação, Modelo de Formulação, Produto acabado,
 * Amostra e material fornecido pelo cliente. Cada recusa é testada onde ela
 * mora — a lista do shared não prova que o serviço a consulta.
 */

const itens: string[] = [];
const fornecedores: string[] = [];
const pedidosDeCompra: string[] = [];
const produtos: string[] = [];
const projetos: string[] = [];
const amostras: string[] = [];
const modelos: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marca(): string {
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
  if (amostras.length > 0) {
    await prisma.sampleConsumption.deleteMany({ where: { projectSampleId: { in: amostras } } });
    await prisma.projectSample.deleteMany({ where: { id: { in: amostras } } });
  }
  if (projetos.length > 0) {
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.project.deleteMany({ where: { id: { in: projetos } } });
  }
  if (modelos.length > 0) {
    await prisma.formulationTemplateVersion.deleteMany({
      where: { formulationTemplateId: { in: modelos } },
    });
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: modelos } } });
  }
  if (pedidosDeCompra.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: pedidosDeCompra } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: pedidosDeCompra } } });
  }
  if (produtos.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtos } } });
    await prisma.product.deleteMany({ where: { id: { in: produtos } } });
  }
  if (itens.length > 0) {
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
});

/** Cria pela API — é o caminho que gera o código e aplica os defaults do tipo. */
async function criarItem(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/items", payload });
  if (resposta.statusCode === 201) itens.push(resposta.json().id as string);
  return resposta;
}

function usoEConsumo(rotulo: string, extra: Record<string, unknown> = {}) {
  return {
    type: "INTERNAL_CONSUMABLE",
    name: `Luva de procedimento ${rotulo}`,
    unitCode: "un",
    ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
    ...extra,
  };
}

/** Item direto no banco — para as recusas, em que o interesse é o tipo, não a criação. */
async function itemDireto(type: "RAW_MATERIAL" | "INTERNAL_CONSUMABLE", unitCode = "un") {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "UC"}-UC-${m}`,
      name: `Item ${type} ${m}`,
      unitCode,
      ...ITEM_TYPE_DEFAULTS[type],
      active: true,
    },
  });
  itens.push(item.id);
  return item;
}

async function criarFornecedor() {
  const m = marca();
  const fornecedor = await getPrisma().supplier.create({
    data: { code: `FOR-UC-${m}`, legalName: `Fornecedor UC ${m}`, active: true },
  });
  fornecedores.push(fornecedor.id);
  return fornecedor;
}

describe("Uso e consumo — identidade e código", () => {
  it("cria pela API com código UC próprio e sem controle nenhum", async () => {
    const app = buildTestApp();
    await app.ready();

    const resposta = await criarItem(app, usoEConsumo(marca()));

    expect(resposta.statusCode).toBe(201);
    const item = resposta.json();
    expect(item.type).toBe("INTERNAL_CONSUMABLE");
    // UC-000001: o prefixo do tipo, seis dígitos, como MP/ME/PA.
    expect(item.code).toMatch(/^UC-\d{6}$/);
    expect(item).toMatchObject({
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
      requiresCoa: false,
      packagingSubtype: null,
      consumedInProduction: false,
      active: true,
    });
  });

  it("numera por uma sequence própria — nunca a da matéria-prima", async () => {
    const app = buildTestApp();
    await app.ready();

    const primeiro = (await criarItem(app, usoEConsumo(marca()))).json();
    const materiaPrima = (
      await criarItem(app, {
        type: "RAW_MATERIAL",
        name: `Insumo entre dois UC ${marca()}`,
        unitCode: "kg",
        ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
      })
    ).json();
    const segundo = (await criarItem(app, usoEConsumo(marca()))).json();

    const numero = (code: string) => Number(code.split("-")[1]);
    // A matéria-prima criada no meio não avança a numeração do UC: se as duas
    // dividissem a sequence, o segundo UC pularia um número.
    expect(numero(segundo.code)).toBe(numero(primeiro.code) + 1);
    expect(materiaPrima.code).toMatch(/^MP-\d{6}$/);
  });

  it("recusa subtipo de embalagem — o campo não é do tipo", async () => {
    const app = buildTestApp();
    await app.ready();

    const resposta = await criarItem(app, usoEConsumo(marca(), { packagingSubtype: "POT" }));

    expect(resposta.statusCode).toBe(400);
  });
});

describe("Uso e consumo — listagens e filtros", () => {
  it("aparece no filtro por tipo do cadastro e fica fora do filtro dos outros", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = (await criarItem(app, usoEConsumo(marca()))).json();

    const porTipo = await app.inject({
      method: "GET",
      url: `/items?type=INTERNAL_CONSUMABLE&search=${item.code}`,
    });
    expect(porTipo.statusCode).toBe(200);
    expect(porTipo.json().items.map((linha: { id: string }) => linha.id)).toContain(item.id);

    const comoMateriaPrima = await app.inject({
      method: "GET",
      url: `/items?type=RAW_MATERIAL&search=${item.code}`,
    });
    expect(comoMateriaPrima.json().items).toHaveLength(0);
  });

  it("fica fora do recorte de material do cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = (await criarItem(app, usoEConsumo(marca()))).json();

    const resposta = await app.inject({
      method: "GET",
      url: `/items?customerSupplied=true&search=${item.code}`,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().items).toHaveLength(0);
  });

  it("o filtro de Estoque aceita o tipo novo", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await itemDireto("INTERNAL_CONSUMABLE");
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: item.id,
        type: "RECEIPT_IN",
        quantity: "10",
        occurredAt: new Date(),
        sourceType: "RECEIPT",
        createdBy: "Teste",
      },
    });

    const resposta = await app.inject({
      method: "GET",
      url: `/inventory?type=INTERNAL_CONSUMABLE&search=${item.code}`,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().items.map((linha: { itemId: string }) => linha.itemId)).toContain(
      item.id,
    );
  });
});

describe("Uso e consumo — compra e fornecedor", () => {
  it("aceita relação Item × Fornecedor", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await itemDireto("INTERNAL_CONSUMABLE");
    const fornecedor = await criarFornecedor();

    const resposta = await app.inject({
      method: "POST",
      url: "/supplier-items",
      payload: { itemId: item.id, supplierId: fornecedor.id },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().itemId).toBe(item.id);
  });

  it("entra como linha de Pedido de Compra", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await itemDireto("INTERNAL_CONSUMABLE");
    const fornecedor = await criarFornecedor();

    const resposta = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: fornecedor.id,
        orderDate: "2026-09-17",
        lines: [{ itemId: item.id, orderedQuantity: "100", unitPrice: "2.50" }],
      },
    });

    expect(resposta.statusCode).toBe(201);
    pedidosDeCompra.push(resposta.json().id as string);
    expect(resposta.json().lines).toHaveLength(1);
    expect(resposta.json().lines[0].itemId).toBe(item.id);
  });
});

describe("Uso e consumo — o que o tipo NÃO faz", () => {
  it("não entra como componente de Formulação", async () => {
    const app = buildTestApp();
    await app.ready();

    const acabado = await getPrisma().item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-UC-${marca()}`,
        name: `Acabado UC ${marca()}`,
        unitCode: "kg",
        ...ITEM_TYPE_DEFAULTS.FINISHED_PRODUCT,
        active: true,
      },
    });
    itens.push(acabado.id);

    const produto = await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto UC ${marca()}`,
        finishedProductItemId: acabado.id,
      },
    });
    expect(produto.statusCode).toBe(201);
    produtos.push(produto.json().id as string);

    const versao = await app.inject({
      method: "POST",
      url: `/products/${produto.json().id}/formulation-versions`,
      payload: {},
    });
    expect(versao.statusCode).toBe(201);

    const consumivel = await itemDireto("INTERNAL_CONSUMABLE");
    const resposta = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${versao.json().id}`,
      payload: {
        components: [{ itemId: consumivel.id, quantity: "1", unitCode: "un" }],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain(consumivel.code);
  });

  it("não entra como componente de Modelo de Formulação", async () => {
    const app = buildTestApp();
    await app.ready();

    const modelo = await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `Modelo UC ${marca()}`, basisQuantity: "1", outputUnitCode: "kg" },
    });
    expect(modelo.statusCode).toBe(201);
    modelos.push(modelo.json().id as string);

    const consumivel = await itemDireto("INTERNAL_CONSUMABLE");
    const resposta = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${modelo.json().draftVersion.id}`,
      payload: {
        components: [{ itemId: consumivel.id, quantity: "1", unitCode: "un" }],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().message).toContain(consumivel.code);
  });

  it("não vira o item de saída de um Produto", async () => {
    const app = buildTestApp();
    await app.ready();

    const consumivel = await itemDireto("INTERNAL_CONSUMABLE");
    const resposta = await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto inválido UC ${marca()}`,
        finishedProductItemId: consumivel.id,
      },
    });

    expect(resposta.statusCode).toBe(400);
    if (resposta.statusCode === 201) produtos.push(resposta.json().id as string);
  });

  it("não é consumido por Amostra de projeto", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const projeto = await prisma.project.create({
      data: {
        code: `PROJ-UC-${marca()}`,
        customerId: await fixtureCustomerId(),
        name: `Projeto UC ${marca()}`,
        status: "WAITING",
        source: "MANUAL",
        entryDate: new Date(),
      },
    });
    projetos.push(projeto.id);

    const amostra = await app.inject({
      method: "POST",
      url: `/projects/${projeto.id}/samples`,
      payload: { description: "Piloto uso e consumo" },
    });
    expect(amostra.statusCode).toBe(201);
    amostras.push(amostra.json().id as string);

    // Com saldo real: a recusa tem de ser pelo TIPO, nunca por falta de estoque.
    const consumivel = await itemDireto("INTERNAL_CONSUMABLE");
    await prisma.inventoryMovement.create({
      data: {
        itemId: consumivel.id,
        type: "RECEIPT_IN",
        quantity: "50",
        occurredAt: new Date(),
        sourceType: "RECEIPT",
        createdBy: "Teste",
      },
    });

    const resposta = await app.inject({
      method: "POST",
      url: `/project-samples/${amostra.json().id}/consumptions`,
      payload: { itemId: consumivel.id, quantity: "1" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("invalid_item_type");
    expect(await prisma.sampleConsumption.count({ where: { itemId: consumivel.id } })).toBe(0);
  });
});
