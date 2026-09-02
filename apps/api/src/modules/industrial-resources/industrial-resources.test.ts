import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Capacidade 44 — recursos industriais.
 *
 * O que estes testes protegem: tarifa é histórica e imutável, a unidade
 * acompanha o tipo do recurso, potência desconhecida continua desconhecida,
 * e o snapshot econômico da estrutura ativa não muda quando a tarifa é
 * reajustada depois.
 */

const fixtureResourceIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
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
  if (fixtureProductIds.length > 0) {
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
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

async function createResource(
  app: App,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
  payload: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/industrial-resources",
    payload: { name: `Recurso ${type} ${marker()}`, type, ...payload },
  });
  if (response.statusCode === 201) fixtureResourceIds.push(response.json().id);
  return response;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-REC-${m}`,
      name: `Item Recurso ${m}`,
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

/** Produto com formulação ativa e estrutura de custos em rascunho. */
async function createCostDraft(app: App) {
  const m = marker();
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");
  const material = await createItem("RAW_MATERIAL");

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(),
        name: `Produto Recurso ${m}`,
        finishedProductItemId: finishedItem.id,
        unitsPerShippingBox: 12,
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
      components: [{ itemId: material.id, quantity: "0.5", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: "1000" },
    })
  ).json();

  return { product, version };
}

describe("Recursos industriais — cadastro e tarifas", () => {
  it("cria recurso com código próprio e unidade conforme o tipo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const labor = await createResource(app, "LABOR", { name: `Operador ${marker()}` });
    expect(labor.statusCode).toBe(201);
    expect(labor.json().code.startsWith("REC-")).toBe(true);
    // Mão de obra se mede em hora; energia em kWh.
    expect(labor.json().defaultUsageUom).toBe("HOUR");
    expect(labor.json().powerKw).toBeNull();

    const energy = await createResource(app, "ENERGY");
    expect(energy.json().defaultUsageUom).toBe("KWH");

    const equipment = await createResource(app, "EQUIPMENT", { powerKw: "4.5" });
    expect(equipment.json().powerKw).toBe("4.5");

    // Potência é atributo de equipamento — não se inventa para operador.
    const invalidPower = await createResource(app, "LABOR", { powerKw: "3" });
    expect(invalidPower.statusCode).toBe(400);
    expect(invalidPower.json().error).toBe("invalid_power");

    await app.close();
  });

  it("mantém o histórico de tarifas e resolve a vigente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const resource = (await createResource(app, "LABOR")).json();

    const past = new Date(Date.now() - 60 * 86_400_000).toISOString();
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${resource.id}/rates`,
      payload: { rateValue: "30", effectiveAt: past },
    });
    const second = await app.inject({
      method: "POST",
      url: `/industrial-resources/${resource.id}/rates`,
      payload: { rateValue: "32" },
    });

    expect(second.statusCode).toBe(201);
    const detail = second.json();
    // Reajuste é tarifa nova: a antiga continua no histórico.
    expect(detail.rates).toHaveLength(2);
    expect(detail.currentRate.rateValue).toBe("32");
    expect(detail.rates.some((rate: { rateValue: string }) => rate.rateValue === "30")).toBe(true);

    await app.close();
  });

  it("não expõe edição de tarifa — reajuste é registro novo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const resource = (await createResource(app, "LABOR")).json();
    const detail = (
      await app.inject({
        method: "POST",
        url: `/industrial-resources/${resource.id}/rates`,
        payload: { rateValue: "30" },
      })
    ).json();
    const rateId = detail.rates[0].id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/industrial-resource-rates/${rateId}`,
      payload: { rateValue: "99" },
    });
    expect(patch.statusCode).toBe(404);

    const prisma = getPrisma();
    const stored = await prisma.industrialResourceRate.findUniqueOrThrow({ where: { id: rateId } });
    expect(stored.rateValue.toString()).toBe("30");

    await app.close();
  });

  it("recusa unidade incompatível com o tipo do recurso", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const labor = (await createResource(app, "LABOR")).json();
    const energy = (await createResource(app, "ENERGY")).json();

    const laborInKwh = await app.inject({
      method: "POST",
      url: `/industrial-resources/${labor.id}/rates`,
      payload: { rateValue: "30", rateUom: "KWH" },
    });
    expect(laborInKwh.statusCode).toBe(400);
    expect(laborInKwh.json().error).toBe("invalid_rate_uom");

    const energyInHour = await app.inject({
      method: "POST",
      url: `/industrial-resources/${energy.id}/rates`,
      payload: { rateValue: "0.85", rateUom: "HOUR" },
    });
    expect(energyInHour.statusCode).toBe(400);

    await app.close();
  });

  it("tarifa legada sem vigência não vira tarifa vigente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const resource = (await createResource(app, "LABOR")).json();
    await prisma.industrialResourceRate.create({
      data: {
        industrialResourceId: resource.id,
        rateValue: "28",
        currencyCode: "BRL",
        rateUom: "HOUR",
        effectiveAt: null,
        source: "LEGACY_IMPORT",
      },
    });

    const reread = await app.inject({ method: "GET", url: `/industrial-resources/${resource.id}` });
    expect(reread.json().rates).toHaveLength(1);
    expect(reread.json().currentRate).toBeNull();

    await app.close();
  });

  it("só ADMIN escreve; os demais perfis consultam", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const commercial = buildTestApp("COMMERCIAL");
    await commercial.ready();

    const resource = (await createResource(admin, "LABOR")).json();

    const write = await commercial.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: "Tentativa", type: "LABOR" },
    });
    expect(write.statusCode).toBe(403);

    const read = await commercial.inject({
      method: "GET",
      url: `/industrial-resources/${resource.id}`,
    });
    expect(read.statusCode).toBe(200);

    await admin.close();
    await commercial.close();
  });
});

describe("Recursos na estrutura de custos", () => {
  it("registra uso planejado por recurso e recusa duplicidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { version } = await createCostDraft(app);
    const operator = (await createResource(app, "LABOR")).json();
    const encapsulator = (await createResource(app, "EQUIPMENT", { powerKw: "4" })).json();

    const withLabor = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: operator.id, usageQuantity: "2.5" },
    });
    expect(withLabor.statusCode).toBe(201);
    expect(withLabor.json().resourceUsages[0].usageUom).toBe("HOUR");
    expect(withLabor.json().resourceUsages[0].usageQuantity).toBe("2.5");

    const withEquipment = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: encapsulator.id, usageQuantity: "1.8" },
    });
    expect(withEquipment.json().resourceUsages).toHaveLength(2);

    // Uma linha por recurso: sem roteiro, o tempo é somado na existente.
    const duplicated = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: operator.id, usageQuantity: "1" },
    });
    expect(duplicated.statusCode).toBe(409);
    expect(duplicated.json().error).toBe("duplicated_resource");

    await app.close();
  });

  it("aceita energia direta só no modo direto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { version } = await createCostDraft(app);
    const energy = (await createResource(app, "ENERGY")).json();

    // Modo padrão é NONE: energia direta ainda não pode ser lançada.
    const beforeMode = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: energy.id, usageQuantity: "15" },
    });
    expect(beforeMode.statusCode).toBe(409);
    expect(beforeMode.json().error).toBe("energy_mode_conflict");

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    const direct = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: energy.id, usageQuantity: "15" },
    });
    expect(direct.statusCode).toBe(201);
    expect(direct.json().resourceUsages[0].usageUom).toBe("KWH");
    // Energia direta não deriva nada dos equipamentos.
    expect(direct.json().derivedEnergyKwh).toBeNull();

    // Trocar de modo com energia direta lançada contaria duas vezes.
    const switchMode = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT" },
    });
    expect(switchMode.statusCode).toBe(409);

    await app.close();
  });

  it("deriva energia dos equipamentos em Decimal exato", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { version } = await createCostDraft(app);
    const equipmentA = (await createResource(app, "EQUIPMENT", { powerKw: "4" })).json();
    const equipmentB = (await createResource(app, "EQUIPMENT", { powerKw: "2" })).json();

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: equipmentA.id, usageQuantity: "2" },
    });
    const result = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: equipmentB.id, usageQuantity: "0.5" },
    });

    // 2 h × 4 kW + 0,5 h × 2 kW = 9 kWh.
    expect(result.json().derivedEnergyKwh).toBe("9");

    // Um equipamento sem potência deixa o TOTAL em aberto: apresentar os
    // 9 kWh conhecidos seria tratar a potência desconhecida como zero.
    const unknownPower = (await createResource(app, "EQUIPMENT")).json();
    const withUnknown = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: unknownPower.id, usageQuantity: "1" },
    });
    expect(withUnknown.json().derivedEnergyKwh).toBeNull();

    await app.close();
  });

  it("marca incompleta quando falta potência ou tarifa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { version } = await createCostDraft(app);
    const equipment = (await createResource(app, "EQUIPMENT")).json();

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT" },
    });
    const withUsage = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: equipment.id, usageQuantity: "2" },
    });

    const codes = withUsage.json().pendencies.map((row: { code: string }) => row.code);
    // Potência desconhecida não vira zero: a energia derivada fica incompleta.
    expect(codes).toContain("EQUIPMENT_POWER_NOT_INFORMED");
    expect(codes).toContain("RESOURCE_RATE_NOT_INFORMED");
    expect(withUsage.json().complete).toBe(false);
    expect(withUsage.json().derivedEnergyKwh).toBeNull();

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
    // Snapshot econômico sem tarifa continua nulo — nunca zero.
    expect(confirmed.json().resourceUsages[0].rateValueSnapshot).toBeNull();

    await app.close();
  });

  it("congela tarifa e potência na ativação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { version } = await createCostDraft(app);
    const operator = (await createResource(app, "LABOR")).json();
    const equipment = (await createResource(app, "EQUIPMENT", { powerKw: "4" })).json();

    await app.inject({
      method: "POST",
      url: `/industrial-resources/${operator.id}/rates`,
      payload: { rateValue: "30" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: operator.id, usageQuantity: "2.5" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: equipment.id, usageQuantity: "1.5" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT" },
    });

    const activated = await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(activated.statusCode).toBe(200);

    const laborUsage = activated
      .json()
      .resourceUsages.find((usage: { resourceId: string }) => usage.resourceId === operator.id);
    expect(laborUsage.rateValueSnapshot).toBe("30");
    expect(laborUsage.rateUomSnapshot).toBe("HOUR");
    expect(laborUsage.resourceNameSnapshot).toBe(operator.name);

    // Reajuste posterior e mudança de potência não reescrevem o histórico.
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${operator.id}/rates`,
      payload: { rateValue: "35" },
    });
    await app.inject({
      method: "PATCH",
      url: `/industrial-resources/${equipment.id}`,
      payload: { powerKw: "5", name: "Encapsuladora renomeada" },
    });

    const reread = (
      await app.inject({ method: "GET", url: `/industrial-costs/${version.id}` })
    ).json();
    const laborAfter = reread.resourceUsages.find(
      (usage: { resourceId: string }) => usage.resourceId === operator.id,
    );
    const equipmentAfter = reread.resourceUsages.find(
      (usage: { resourceId: string }) => usage.resourceId === equipment.id,
    );
    expect(laborAfter.rateValueSnapshot).toBe("30");
    expect(laborAfter.currentRate.rateValue).toBe("35");
    expect(equipmentAfter.powerKwSnapshot).toBe("4");
    expect(equipmentAfter.derivedEnergyKwh).toBe("6");
    expect(equipmentAfter.resourceNameSnapshot).not.toBe("Encapsuladora renomeada");

    await app.close();
  });

  it("copia os usos para a nova versão e recusa recurso inativo na ativação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, version } = await createCostDraft(app);
    const operator = (await createResource(app, "LABOR")).json();
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${operator.id}/rates`,
      payload: { rateValue: "30" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: operator.id, usageQuantity: "2" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });

    const v2 = (
      await app.inject({ method: "POST", url: `/products/${product.id}/industrial-costs`, payload: {} })
    ).json();
    expect(v2.resourceUsages).toHaveLength(1);
    expect(v2.resourceUsages[0].usageQuantity).toBe("2");
    // Snapshots econômicos são da ativação, não são copiados.
    expect(v2.resourceUsages[0].rateValueSnapshot).toBeNull();

    await app.inject({
      method: "PATCH",
      url: `/industrial-resources/${operator.id}`,
      payload: { active: false },
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/industrial-costs/${v2.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("inactive_resource");

    // A versão ativa anterior continua íntegra.
    const v1 = (await app.inject({ method: "GET", url: `/industrial-costs/${version.id}` })).json();
    expect(v1.status).toBe("ACTIVE");
    expect(v1.resourceUsages[0].rateValueSnapshot).toBe("30");
    // Inativar o recurso hoje não cria pendência no documento já ativado.
    expect(v1.pendencies.map((row: { code: string }) => row.code)).not.toContain("RESOURCE_INACTIVE");

    await app.close();
  });

  it("não altera a Foundation of Costs", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { version } = await createCostDraft(app);
    const operator = (await createResource(app, "LABOR")).json();
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${operator.id}/rates`,
      payload: { rateValue: "30" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: operator.id, usageQuantity: "3" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/activate`,
      payload: { confirmIncomplete: true },
    });

    // Tarifa de recurso é premissa, não custo real: nem estoque, nem oferta
    // de fornecedor, nem custo de recebimento aparecem para estes itens. A
    // conferência é por item — contagem global mediria testes paralelos.
    expect(
      await prisma.inventoryMovement.count({ where: { lot: { itemId: { in: fixtureItemIds } } } }),
    ).toBe(0);
    expect(
      await prisma.supplierItemOffer.count({
        where: { supplierItem: { itemId: { in: fixtureItemIds } } },
      }),
    ).toBe(0);
    expect(
      await prisma.receiptLine.count({
        where: { itemId: { in: fixtureItemIds }, actualUnitCost: { not: null } },
      }),
    ).toBe(0);

    await app.close();
  });
});
