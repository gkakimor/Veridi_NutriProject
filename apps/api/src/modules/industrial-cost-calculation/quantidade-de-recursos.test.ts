import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { diaComercialDeTeste } from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { plannedUsageQuantity, scaledUsageQuantity } from "./calculation.service.js";

/**
 * COST-RESOURCE-MULTIPLIER-01 — quantidade de recursos equivalentes (§87).
 *
 * Decisão do PO de 2026-09-11: a quantidade é de CUSTO e multiplica; vale para
 * mão de obra e equipamento; entra na energia derivada; é inteiro ≥ 1; e a
 * linha continua uma por recurso. O que fica provado, com número:
 *
 *   - linha sem quantidade é 1 × uso — o custo de antes;
 *   - 2 operadores × 2 h × R$ 25 = R$ 100, e refazer a linha com 3 dá R$ 150;
 *   - 3 equipamentos × 2 h × R$ 85 = R$ 510, e a MESMA hora efetiva deriva
 *     3 × 2 h × 5 kW = 30 kWh × R$ 0,80 = R$ 24 — nunca 10 kWh;
 *   - energia direta continua kWh × tarifa, e recusa quantidade acima de 1;
 *   - zero, negativo, fração, texto e `null` são 400 antes do domínio;
 *   - Modelo guarda e aplica a quantidade; nova versão e "salvar como
 *     Modelo" a preservam;
 *   - o CMV — o motor da faixa de precificação — usa a quantidade, e a
 *     escala por lote multiplica uma vez só.
 */

/** Conta independente, em Decimal — nunca Number (§59). */
const D = (value: string | number) => new Prisma.Decimal(value);

type App = ReturnType<typeof buildTestApp>;

interface UsoDTO {
  id: string;
  resourceId: string;
  usageQuantity: string;
  resourceCount: number;
  totalUsageQuantity: string;
  derivedEnergyKwh: string | null;
}

interface LinhaDeRecurso {
  resourceId: string;
  quantity: string;
  resourceCount?: number;
  quantityPerResource?: string;
  subtotal: string | null;
}

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureCostTemplateIds: string[] = [];

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
    await prisma.industrialCostCalculation.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
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
  if (fixtureCostTemplateIds.length > 0) {
    await prisma.industrialCostTemplate.deleteMany({
      where: { id: { in: fixtureCostTemplateIds } },
    });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode: string) {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-QRC-${m}`,
      name: `Item Quantidade de Recursos ${m}`,
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

async function createResource(
  app: App,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
  rate: string,
  extras: { powerKw?: string } = {},
): Promise<{ id: string; name: string }> {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: {
        name: `Recurso ${type} ${marker()}`,
        type,
        ...(extras.powerKw ? { powerKw: extras.powerKw } : {}),
      },
    })
  ).json();
  fixtureResourceIds.push(resource.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${resource.id}/rates`,
    payload: { rateValue: rate },
  });
  return resource;
}

/** Produto com formulação ativa — o material não tem custo, e não precisa. */
async function createProduct(app: App): Promise<{ id: string }> {
  const m = marker();
  const acabado = await createItem("FINISHED_PRODUCT", "un");
  const material = await createItem("RAW_MATERIAL", "kg");
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto Quantidade de Recursos ${m}`,
        finishedProductItemId: acabado.id,
      },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const formulation = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulation.id}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
    },
  });
  const ativa = await app.inject({
    method: "POST",
    url: `/formulation-versions/${formulation.id}/activate`,
  });
  expect(ativa.statusCode, ativa.body).toBeLessThan(300);
  return product;
}

/** Estrutura de custos em rascunho, sobre base de referência de 100 un. */
async function createStructure(app: App) {
  const product = await createProduct(app);
  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: "100", referenceOutputUomCode: "un" },
    })
  ).json();
  expect(version.id, JSON.stringify(version)).toBeTruthy();
  return { product, version: version as { id: string } };
}

const addUsage = (app: App, versionId: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/industrial-costs/${versionId}/resource-usages`, payload });

function usoDe(version: { resourceUsages: UsoDTO[] }, resourceId: string): UsoDTO {
  const uso = version.resourceUsages.find((row) => row.resourceId === resourceId);
  expect(uso, JSON.stringify(version.resourceUsages)).toBeTruthy();
  return uso!;
}

async function calculate(app: App, versionId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/industrial-costs/${versionId}/calculate`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

function linhaDe(calculo: { resources: LinhaDeRecurso[] }, resourceId: string): LinhaDeRecurso {
  const linha = calculo.resources.find((row) => row.resourceId === resourceId);
  expect(linha, JSON.stringify(calculo.resources)).toBeTruthy();
  return linha!;
}

describe("helper canônico — a quantidade multiplica uma vez, e o lote fica na escala", () => {
  it("linha antiga: 1 × 4 h é o uso de antes", () => {
    expect(plannedUsageQuantity({ usageQuantity: D(4), resourceCount: 1 }).toString()).toBe("4");
  });

  it("por lote: 2 × 2 h em dois lotes são 8 h — nem 16, nem 4", () => {
    const uso = { usageBasis: "FIXED_PER_REFERENCE_BATCH", usageQuantity: D(2), resourceCount: 2 };
    expect(scaledUsageQuantity(uso, D(200), D(100), "BATCH_AWARE").toString()).toBe("8");
    // 150 un sobre base 100 ainda são dois lotes inteiros na leitura comercial…
    expect(scaledUsageQuantity(uso, D(150), D(100), "BATCH_AWARE").toString()).toBe("8");
    // …e 1,5 lote na leitura proporcional da produção realizada.
    expect(scaledUsageQuantity(uso, D(150), D(100)).toString()).toBe("6");
  });

  it("por unidade e por mil também multiplicam uma vez", () => {
    expect(
      scaledUsageQuantity(
        { usageBasis: "PER_OUTPUT_UNIT", usageQuantity: D("0.01"), resourceCount: 3 },
        D(100),
        D(100),
      ).toString(),
    ).toBe("3");
    expect(
      scaledUsageQuantity(
        { usageBasis: "PER_1000_OUTPUT_UNITS", usageQuantity: D(5), resourceCount: 2 },
        D(500),
        D(100),
      ).toString(),
    ).toBe("5");
  });
});

describe("Estrutura de custos — quantidade de recursos na conta (§87)", () => {
  it("linha sem quantidade informada é 1 × uso: 4 h × R$ 25 continua R$ 100", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    const operador = await createResource(app, "LABOR", "25");

    const criado = await addUsage(app, version.id, { resourceId: operador.id, usageQuantity: "4" });
    expect(criado.statusCode, criado.body).toBe(201);
    const uso = usoDe(criado.json(), operador.id);
    expect(uso.resourceCount).toBe(1);
    expect(uso.usageQuantity).toBe("4");
    expect(uso.totalUsageQuantity).toBe("4");

    const linha = linhaDe(await calculate(app, version.id), operador.id);
    expect(linha.quantity).toBe("4");
    expect(linha.resourceCount).toBe(1);
    expect(linha.subtotal).toBe("100.00");
    await app.close();
  });

  it("mão de obra: 2 operadores × 2 h × R$ 25 = R$ 100, e a leitura guarda o 2 × 2", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    const operador = await createResource(app, "LABOR", "25");

    const criado = await addUsage(app, version.id, {
      resourceId: operador.id,
      usageQuantity: "2",
      resourceCount: 2,
    });
    expect(criado.statusCode, criado.body).toBe(201);
    const uso = usoDe(criado.json(), operador.id);
    expect(uso.resourceCount).toBe(2);
    expect(uso.usageQuantity).toBe("2");
    expect(uso.totalUsageQuantity).toBe("4");

    const calculo = await calculate(app, version.id);
    const linha = linhaDe(calculo, operador.id);
    expect(linha.resourceCount).toBe(2);
    expect(linha.quantityPerResource).toBe("2");
    expect(linha.quantity).toBe("4");
    expect(linha.subtotal).toBe("100.00");
    expect(calculo.laborSubtotalKnown).toBe("100.00");
    await app.close();
  });

  it("replanejar é trocar só a quantidade: a linha refeita com 3 × 2 h dá R$ 150", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    const operador = await createResource(app, "LABOR", "25");

    const dois = await addUsage(app, version.id, {
      resourceId: operador.id,
      usageQuantity: "2",
      resourceCount: 2,
    });
    expect(linhaDe(await calculate(app, version.id), operador.id).subtotal).toBe("100.00");

    // Sem edição de linha nesta fase: remover e declarar de novo, como com as horas.
    const removido = await app.inject({
      method: "DELETE",
      url: `/industrial-cost-resource-usages/${usoDe(dois.json(), operador.id).id}`,
    });
    expect(removido.statusCode, removido.body).toBe(200);
    const tres = await addUsage(app, version.id, {
      resourceId: operador.id,
      usageQuantity: "2",
      resourceCount: 3,
    });
    expect(tres.statusCode, tres.body).toBe(201);

    const linha = linhaDe(await calculate(app, version.id), operador.id);
    expect(linha.quantity).toBe("6");
    expect(linha.subtotal).toBe("150.00");
    await app.close();
  });

  it("equipamento: 3 × 2 h × R$ 85 = R$ 510, e a energia derivada conta os três: 30 kWh = R$ 24", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    const encapsuladora = await createResource(app, "EQUIPMENT", "85", { powerKw: "5" });
    const energia = await createResource(app, "ENERGY", "0.80");

    const criado = await addUsage(app, version.id, {
      resourceId: encapsuladora.id,
      usageQuantity: "2",
      resourceCount: 3,
    });
    expect(criado.statusCode, criado.body).toBe(201);
    const modo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT", energyResourceId: energia.id },
    });
    expect(modo.statusCode, modo.body).toBe(200);

    // A estrutura mostra a energia da linha e da versão com a mesma hora efetiva.
    const estrutura = (
      await app.inject({ method: "GET", url: `/industrial-costs/${version.id}` })
    ).json();
    const uso = usoDe(estrutura, encapsuladora.id);
    expect(uso.totalUsageQuantity).toBe("6");
    expect(uso.derivedEnergyKwh).toBe("30");
    expect(estrutura.derivedEnergyKwh).toBe("30");

    const calculo = await calculate(app, version.id);
    expect(linhaDe(calculo, encapsuladora.id).subtotal).toBe("510.00");
    expect(calculo.equipmentSubtotalKnown).toBe("510.00");
    // O bug que não pode existir: equipamento com 3 e energia com 1 (10 kWh, R$ 8).
    expect(calculo.derivedEnergyKwh).toBe("30");
    expect(calculo.energySubtotal).toBe("24.00");
    await app.close();
  });

  it("energia direta continua kWh × tarifa: 50 kWh × R$ 0,80 = R$ 40, com quantidade 1", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    const energia = await createResource(app, "ENERGY", "0.80");

    const criado = await addUsage(app, version.id, { resourceId: energia.id, usageQuantity: "50" });
    expect(criado.statusCode, criado.body).toBe(201);
    const uso = usoDe(criado.json(), energia.id);
    expect(uso.resourceCount).toBe(1);
    expect(uso.totalUsageQuantity).toBe("50");

    expect((await calculate(app, version.id)).energySubtotal).toBe("40.00");
    await app.close();
  });

  it("energia direta recusa quantidade de recursos acima de 1 — 400, e nada é gravado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    const energia = await createResource(app, "ENERGY", "0.80");

    const recusado = await addUsage(app, version.id, {
      resourceId: energia.id,
      usageQuantity: "50",
      resourceCount: 2,
    });
    expect(recusado.statusCode, recusado.body).toBe(400);
    expect(recusado.json().error).toBe("invalid_resource_count");
    expect(recusado.json().message).toContain("quantidade de recursos vale só para mão de obra e equipamento");
    expect(
      await getPrisma().industrialCostResourceUsage.count({
        where: { industrialCostVersionId: version.id },
      }),
    ).toBe(0);
    await app.close();
  });

  describe("quantidade inválida é 400 antes do domínio, sem coerção", () => {
    const app = buildTestApp("ADMIN");
    let versionId = "";
    let operadorId = "";

    beforeAll(async () => {
      await app.ready();
      versionId = (await createStructure(app)).version.id;
      operadorId = (await createResource(app, "LABOR", "25")).id;
    });
    afterAll(async () => {
      await app.close();
    });

    it.each([
      ["zero", 0],
      ["negativa", -1],
      ["fracionada", 1.5],
      ["em texto", "2"],
      ["nula", null],
    ])("quantidade %s", async (_nome, valor) => {
      const recusado = await addUsage(app, versionId, {
        resourceId: operadorId,
        usageQuantity: "2",
        resourceCount: valor,
      });
      expect(recusado.statusCode, recusado.body).toBe(400);
      expect(recusado.json().error).toBe("validation_error");
      expect(
        await getPrisma().industrialCostResourceUsage.count({
          where: { industrialCostVersionId: versionId },
        }),
      ).toBe(0);
    });
  });
});

describe("Modelo de Estrutura e versionamento guardam a quantidade", () => {
  async function templateComRecursos(
    app: App,
    usos: { industrialResourceId: string; usageQuantity: string; usageUom: string; resourceCount?: number }[],
  ) {
    const template = (
      await app.inject({
        method: "POST",
        url: "/cost-templates",
        payload: {
          name: `Modelo Quantidade ${marker()}`,
          referenceOutputQuantity: "100",
          referenceOutputUomCode: "un",
        },
      })
    ).json();
    fixtureCostTemplateIds.push(template.id);
    const salvo = await app.inject({
      method: "PATCH",
      url: `/cost-template-versions/${template.draftVersion.id}`,
      payload: { resourceUsages: usos },
    });
    return { template, salvo };
  }

  it("o Modelo guarda a quantidade, e aplicar o Modelo a copia: 3 × 2 h × R$ 25 = R$ 150", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const operador = await createResource(app, "LABOR", "25");

    const { template, salvo } = await templateComRecursos(app, [
      { industrialResourceId: operador.id, usageQuantity: "2", usageUom: "HOUR", resourceCount: 3 },
    ]);
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(salvo.json().resourceUsages[0].resourceCount).toBe(3);
    expect(salvo.json().resourceUsages[0].totalUsageQuantity).toBe("6");
    const ativa = await app.inject({
      method: "POST",
      url: `/cost-template-versions/${template.draftVersion.id}/activate`,
    });
    expect(ativa.statusCode, ativa.body).toBe(200);

    const product = await createProduct(app);
    const aplicado = await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs/from-template`,
      payload: { costTemplateVersionId: template.draftVersion.id },
    });
    expect(aplicado.statusCode, aplicado.body).toBeLessThan(300);

    const versao = await getPrisma().industrialCostVersion.findFirstOrThrow({
      where: { productId: product.id },
      include: { resourceUsages: true },
    });
    expect(versao.resourceUsages).toHaveLength(1);
    expect(versao.resourceUsages[0]!.resourceCount).toBe(3);
    expect(versao.resourceUsages[0]!.usageQuantity.toString()).toBe("2");
    expect(linhaDe(await calculate(app, versao.id), operador.id).subtotal).toBe("150.00");
    await app.close();
  });

  it("o Modelo recusa energia com quantidade de recursos acima de 1", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const energia = await createResource(app, "ENERGY", "0.80");

    const { salvo } = await templateComRecursos(app, [
      { industrialResourceId: energia.id, usageQuantity: "50", usageUom: "KWH", resourceCount: 2 },
    ]);
    expect(salvo.statusCode, salvo.body).toBe(400);
    expect(salvo.json().error).toBe("invalid_resource_count");
    await app.close();
  });

  it("nova versão da estrutura preserva a quantidade de recursos", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product, version } = await createStructure(app);
    const operador = await createResource(app, "LABOR", "25");
    await addUsage(app, version.id, { resourceId: operador.id, usageQuantity: "2", resourceCount: 2 });
    const ativada = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(ativada.statusCode, ativada.body).toBe(200);

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: {},
      })
    ).json();
    expect(v2.id, JSON.stringify(v2)).toBeTruthy();
    const uso = usoDe(v2, operador.id);
    expect(uso.resourceCount).toBe(2);
    expect(uso.usageQuantity).toBe("2");
    expect(uso.totalUsageQuantity).toBe("4");
    await app.close();
  });

  it("salvar a estrutura como Modelo leva a quantidade junto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { version } = await createStructure(app);
    const operador = await createResource(app, "LABOR", "25");
    await addUsage(app, version.id, { resourceId: operador.id, usageQuantity: "2", resourceCount: 3 });

    const salvo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/save-as-template`,
      payload: { name: `Modelo da estrutura ${marker()}` },
    });
    expect(salvo.statusCode, salvo.body).toBeLessThan(300);
    const template = salvo.json();
    fixtureCostTemplateIds.push(template.id);
    expect(template.draftVersion.resourceUsages[0].resourceCount).toBe(3);
    expect(template.draftVersion.resourceUsages[0].usageQuantity).toBe("2");
    await app.close();
  });
});

describe("CMV e precificação usam a quantidade (costForOutputQuantity)", () => {
  it("200 un sobre base 100 são dois lotes: 2 × 2 h × 2 = 8 h × R$ 25 = R$ 200", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product, version } = await createStructure(app);
    const operador = await createResource(app, "LABOR", "25");
    await addUsage(app, version.id, { resourceId: operador.id, usageQuantity: "2", resourceCount: 2 });
    const ativada = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(ativada.statusCode, ativada.body).toBe(200);
    const salvo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: {},
    });
    expect(salvo.json().id, salvo.body).toBeTruthy();

    const maoDeObra = async (quantity: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/products/${product.id}/cmv?quantity=${quantity}&referenceDate=${diaComercialDeTeste()}`,
      });
      expect(response.statusCode, response.body).toBe(200);
      const componente = response
        .json()
        .simulation.components.find(
          (c: { group: string; code: string }) => c.group === "INDUSTRIAL_RESOURCE" && c.code === "LABOR",
        );
      expect(componente, response.body).toBeTruthy();
      return componente;
    };

    const umLote = await maoDeObra("100");
    expect(D(umLote.requiredQuantity).equals(4)).toBe(true);
    expect(D(umLote.totalCost).equals(100)).toBe(true);

    const doisLotes = await maoDeObra("200");
    expect(doisLotes.resourceCount).toBe(2);
    expect(D(doisLotes.quantityPerResource).equals(4)).toBe(true);
    // Uma multiplicação só: 8 h, nem 16 (contagem dobrada) nem 4 (lote esquecido).
    expect(D(doisLotes.requiredQuantity).equals(8)).toBe(true);
    expect(D(doisLotes.totalCost).equals(200)).toBe(true);
    await app.close();
  });
});
