import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Nova versão da Estrutura de Custos: o que ela leva junto.
 *
 * Encontrado durante o próprio deploy do hotfix per-dose: a versão nova
 * copiava base, recursos e modo de energia, mas não o recurso que valoriza
 * o kWh derivado. Ela nascia "Completa", o cálculo saía PARTIAL com energia
 * "—", e o operador precisava criar mais uma versão só para reescolher o
 * mesmo recurso.
 *
 * Premissa se copia; resultado, não. Tarifa continua sendo resolvida pela
 * data do cálculo.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureCostVersionIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
  if (fixtureCostVersionIds.length > 0) {
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersionId: { in: fixtureCostVersionIds } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersionId: { in: fixtureCostVersionIds } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { id: { in: fixtureCostVersionIds } },
    });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
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

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarRecurso(
  app: App,
  type: "EQUIPMENT" | "ENERGY",
  rate: string,
  powerKw?: string,
) {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: {
        name: `${type} EC ${marca()}`,
        type,
        ...(powerKw ? { powerKw } : {}),
      },
    })
  ).json();
  fixtureResourceIds.push(resource.id);

  await app.inject({
    method: "POST",
    url: `/industrial-resources/${resource.id}/rates`,
    payload: { rateValue: rate, effectiveAt: ONTEM.toISOString() },
  });
  return resource;
}

/** Produto com formulação ativa simples — o foco é a estrutura, não a receita. */
async function criarProdutoComFormulacao(app: App) {
  const materia = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: `MP EC ${marca()}`, unitCode: "kg" },
    })
  ).json();
  fixtureItemIds.push(materia.id);

  const acabado = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "FINISHED_PRODUCT", name: `PA EC ${marca()}`, unitCode: "un" },
    })
  ).json();
  fixtureItemIds.push(acabado.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Produto EC ${marca()}`, finishedProductItemId: acabado.id },
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
      basisQuantity: "100",
      components: [{ itemId: materia.id, quantity: "2", unitCode: "kg", basis: "FIXED_BASIS" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });
  return product;
}

describe("Nova versão da estrutura de custos", () => {
  const app = buildTestApp();

  /** V1 no arranjo do caso real: energia derivada de equipamento. */
  async function cenario() {
    const product = await criarProdutoComFormulacao(app);
    const equipamento = await criarRecurso(app, "EQUIPMENT", "45", "3");
    const energia = await criarRecurso(app, "ENERGY", "0.92");

    const v1 = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "100", referenceOutputUomCode: "un" },
      })
    ).json();
    fixtureCostVersionIds.push(v1.id);

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${v1.id}/resource-usages`,
      payload: { resourceId: equipamento.id, usageQuantity: "2" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${v1.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT", energyResourceId: energia.id },
    });

    return { product, equipamento, energia, v1 };
  }

  it("V2 herda modo de energia, recurso tarifário e consumo de recurso", async () => {
    const { product, equipamento, energia, v1 } = await cenario();
    await app.inject({ method: "POST", url: `/industrial-costs/${v1.id}/activate` });

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: {},
      })
    ).json();
    fixtureCostVersionIds.push(v2.id);

    expect(v2.energyCalculationMode).toBe("FROM_EQUIPMENT");
    // O que faltava: sem isto o kWh derivado não vira dinheiro.
    expect(v2.energyResourceId).toBe(energia.id);
    expect(v2.referenceOutputQuantity).toBe("100");
    expect(v2.resourceUsages).toHaveLength(1);
    expect(v2.resourceUsages[0].resourceId).toBe(equipamento.id);
    expect(v2.resourceUsages[0].usageQuantity).toBe("2");
  });

  it("nenhum snapshot econômico é copiado — a tarifa é da data do cálculo", async () => {
    const { product, v1 } = await cenario();
    await app.inject({ method: "POST", url: `/industrial-costs/${v1.id}/activate` });

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: {},
      })
    ).json();
    fixtureCostVersionIds.push(v2.id);

    // Rascunho lê a tarifa vigente; o snapshot só existe a partir da ativação.
    expect(v2.status).toBe("DRAFT");
    expect(v2.resourceUsages[0].rateValueSnapshot).toBeNull();
    expect(v2.resourceUsages[0].powerKwSnapshot).toBeNull();
  });

  it("V2 nasce completa e calcula energia sem passo extra", async () => {
    const { product, v1 } = await cenario();
    await app.inject({ method: "POST", url: `/industrial-costs/${v1.id}/activate` });

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: {},
      })
    ).json();
    fixtureCostVersionIds.push(v2.id);

    const calculo = (
      await app.inject({ method: "GET", url: `/industrial-costs/${v2.id}/calculate` })
    ).json();

    // 2 h × 3 kW = 6 kWh × R$ 0,92 = R$ 5,52 — na primeira versão nova.
    expect(calculo.derivedEnergyKwh).toBe("6");
    expect(calculo.energySubtotal).toBe("5.52");
  });

  it("energia derivada sem recurso tarifário não deixa a estrutura completa", async () => {
    const product = await criarProdutoComFormulacao(app);
    const equipamento = await criarRecurso(app, "EQUIPMENT", "45", "3");

    const v1 = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "100", referenceOutputUomCode: "un" },
      })
    ).json();
    fixtureCostVersionIds.push(v1.id);

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${v1.id}/resource-usages`,
      payload: { resourceId: equipamento.id, usageQuantity: "2" },
    });
    // Modo derivado SEM escolher quem tarifa o kWh.
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${v1.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT" },
    });

    const lida = (
      await app.inject({ method: "GET", url: `/products/${product.id}/industrial-costs` })
    ).json();
    const versao = lida.draft ?? lida.versions.find((row: { id: string }) => row.id === v1.id);

    // kWh sem tarifa é quantidade, não custo — e a estrutura diz isso ANTES
    // de ser ativada, em vez de deixar o cálculo descobrir.
    expect(versao.complete).toBe(false);
    const pendencia = versao.pendencies.find(
      (row: { code: string }) => row.code === "ENERGY_RATE_NOT_INFORMED",
    );
    expect(pendencia).toBeTruthy();
    expect(pendencia.severity).toBe("BLOCKING");
  });
});
