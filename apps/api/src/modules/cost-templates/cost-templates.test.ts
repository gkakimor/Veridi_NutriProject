import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Bibliotecas de Estrutura de Custos e de Política de Precificação.
 *
 * Duas promessas sob teste, e elas são o motivo destas bibliotecas existirem:
 *
 * 1. O template de custo guarda CONFIGURAÇÃO, nunca tarifa. Se congelasse
 *    R$/hora, um produto criado hoje nasceria com o preço de energia do dia em
 *    que a matriz foi escrita — e ninguém notaria até comparar dois cálculos.
 * 2. A política guarda REGRA, nunca preço. A mesma política em dois produtos
 *    com custos diferentes precisa dar preços diferentes; se der o mesmo, ela
 *    está carregando o custo de um produto para dentro do outro.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureCostTemplateIds: string[] = [];
const fixturePolicyIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

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
   * compartilhado com o app local.
   */
  if (fixtureProductIds.length > 0) {
    await prisma.pricingTier.deleteMany({
      where: { pricingVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.pricingVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
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
  if (fixturePolicyIds.length > 0) {
    await prisma.pricingPolicyTemplate.deleteMany({ where: { id: { in: fixturePolicyIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

/** Compra recebida com custo informado — é daí que nasce o custo do material. */
async function receberComCusto(app: App, itemId: string, unitCost: string) {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-TEC-${m}`, legalName: `Fornecedor TEC ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);

  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: new Date().toISOString(),
        lines: [{ itemId, orderedQuantity: "1000" }],
      },
    })
  ).json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: "1000",
            supplierLot: `SUP-${m}`,
            actualUnitCost: unitCost,
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
}

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarRecurso(
  app: App,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
  rateValue: string,
  extras: { powerKw?: string } = {},
) {
  const recurso = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: {
        name: `DEMO ${type} ${marker()}`,
        type,
        ...(extras.powerKw ? { powerKw: extras.powerKw } : {}),
      },
    })
  ).json();
  fixtureResourceIds.push(recurso.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${recurso.id}/rates`,
    payload: { rateValue },
  });
  return recurso;
}

/** Produto com formulação ativa — a estrutura precisa de uma receita. */
async function criarProduto(app: App) {
  const prisma = getPrisma();
  const m = marker();
  const acabado = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-TEC-${m}`,
      name: `Acabado TEC ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(acabado.id);

  const material = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-TEC-${m}`,
      name: `Insumo TEC ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(material.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Produto TEC ${m}`, finishedProductItemId: acabado.id },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const formulacao = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulacao.id}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulacao.id}/activate` });
  // Custo do material nasce de compra recebida — nunca digitado no item.
  await receberComCusto(app, material.id, "10");

  return { product, material, acabado };
}

async function criarTemplateCusto(
  app: App,
  recursos: { id: string; horas: string }[],
  options: { energyResourceId?: string; overhead?: string } = {},
) {
  const template = (
    await app.inject({
      method: "POST",
      url: "/cost-templates",
      payload: {
        name: `DEMO Cápsulas ${marker()}`,
        referenceOutputQuantity: "1000",
        referenceOutputUomCode: "un",
      },
    })
  ).json();
  fixtureCostTemplateIds.push(template.id);

  await app.inject({
    method: "PATCH",
    url: `/cost-template-versions/${template.draftVersion.id}`,
    payload: {
      ...(options.energyResourceId
        ? { energyCalculationMode: "FROM_EQUIPMENT", energyResourceId: options.energyResourceId }
        : {}),
      resourceUsages: recursos.map((r) => ({
        industrialResourceId: r.id,
        usageQuantity: r.horas,
        usageUom: "HOUR",
      })),
      ...(options.overhead
        ? {
            additionalCosts: [
              {
                category: "OVERHEAD",
                description: "Rateio fabril",
                calculationBasis: "PER_1000_OUTPUT_UNITS",
                rateValue: options.overhead,
              },
            ],
          }
        : {}),
    },
  });
  const ativa = await app.inject({
    method: "POST",
    url: `/cost-template-versions/${template.draftVersion.id}/activate`,
  });
  expect(ativa.statusCode, ativa.body).toBe(200);
  return { template, activeVersion: ativa.json() };
}

const aplicarTEC = (app: App, productId: string, versionId: string) =>
  app.inject({
    method: "POST",
    url: `/products/${productId}/industrial-costs/from-template`,
    payload: { costTemplateVersionId: versionId },
  });

describe("Biblioteca de estruturas de custo", () => {
  it("cria com código TEC e V1 em rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/cost-templates",
      payload: { name: `DEMO Base ${marker()}` },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const template = resposta.json();
    fixtureCostTemplateIds.push(template.id);

    expect(template.code.startsWith("TEC-")).toBe(true);
    expect(template.draftVersion.versionNumber).toBe(1);
    expect(template.activeVersion).toBeNull();
    // Base sugerida existe desde o começo: 1.000 é o lote típico.
    expect(template.draftVersion.referenceOutputQuantity).toBe("1000");

    await app.close();
  });

  it("guarda recursos, energia e premissas; ativa e vira histórico", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const energia = await criarRecurso(app, "ENERGY", "0.92");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }], {
      energyResourceId: energia.id,
      overhead: "450",
    });

    expect(activeVersion.status).toBe("ACTIVE");
    expect(activeVersion.resourceUsages).toHaveLength(1);
    expect(activeVersion.resourceUsages[0].usageQuantity).toBe("6");
    expect(activeVersion.energyCalculationMode).toBe("FROM_EQUIPMENT");
    expect(activeVersion.additionalCosts[0].rateValue).toBe("450");

    const editar = await app.inject({
      method: "PATCH",
      url: `/cost-template-versions/${activeVersion.id}`,
      payload: { referenceOutputQuantity: "9" },
    });
    expect(editar.statusCode).toBe(409);
    expect(editar.json().error).toBe("template_not_draft");

    await app.close();
  });

  it("energia derivada exige recurso de energia declarado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const template = (
      await app.inject({
        method: "POST",
        url: "/cost-templates",
        payload: { name: `DEMO Energia ${marker()}` },
      })
    ).json();
    fixtureCostTemplateIds.push(template.id);

    const recusado = await app.inject({
      method: "PATCH",
      url: `/cost-template-versions/${template.draftVersion.id}`,
      payload: { energyCalculationMode: "FROM_EQUIPMENT" },
    });
    // Escolher sozinho entre vários cadastros seria inventar premissa.
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("energy_resource_required");

    await app.close();
  });

  it("recusa ativar versão sem recurso nem premissa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const template = (
      await app.inject({
        method: "POST",
        url: "/cost-templates",
        payload: { name: `DEMO Vazio ${marker()}` },
      })
    ).json();
    fixtureCostTemplateIds.push(template.id);

    const recusado = await app.inject({
      method: "POST",
      url: `/cost-template-versions/${template.draftVersion.id}/activate`,
    });
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_empty");

    await app.close();
  });

  it("nova versão copia a ativa; só uma fica ativa e um rascunho por vez", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { template, activeVersion } = await criarTemplateCusto(app, [
      { id: mao.id, horas: "6" },
    ]);

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/cost-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.sourceVersionNumber).toBe(1);
    expect(v2.resourceUsages).toHaveLength(1);

    const segundo = await app.inject({
      method: "POST",
      url: `/cost-template-versions/${activeVersion.id}/new-version`,
    });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().error).toBe("template_draft_exists");

    await app.inject({ method: "POST", url: `/cost-template-versions/${v2.id}/activate` });
    const ativas = await prisma.industrialCostTemplateVersion.count({
      where: { industrialCostTemplateId: template.id, status: "ACTIVE" },
    });
    expect(ativas).toBe(1);
    const anterior = await prisma.industrialCostTemplateVersion.findUniqueOrThrow({
      where: { id: activeVersion.id },
    });
    expect(anterior.status).toBe("ARCHIVED");

    await app.close();
  });
});

describe("Aplicar template de estrutura — configuração, nunca tarifa", () => {
  it("preenche a EC em rascunho vazia e registra a origem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { template, activeVersion } = await criarTemplateCusto(
      app,
      [{ id: mao.id, horas: "6" }],
      { overhead: "450" },
    );
    const { product } = await criarProduto(app);

    // EC em rascunho vazia, criada pelo fluxo normal.
    const vazia = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "500" },
      })
    ).json();

    const resposta = await aplicarTEC(app, product.id, activeVersion.id);
    expect(resposta.statusCode, resposta.body).toBe(201);
    const ec = resposta.json();

    expect(ec.id).toBe(vazia.id);
    expect(ec.status).toBe("DRAFT");
    expect(ec.referenceOutputQuantity).toBe("1000");
    expect(ec.resourceUsages).toHaveLength(1);
    expect(ec.lines).toHaveLength(1);
    expect(ec.originCostTemplateVersionId).toBe(activeVersion.id);
    expect(ec.originCostTemplateCode).toBe(template.code);
    expect(ec.originCostTemplateVersionNumber).toBe(1);

    await app.close();
  });

  it("cópia profunda: nenhuma linha compartilhada com o template", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }]);
    const { product } = await criarProduto(app);
    const ec = (await aplicarTEC(app, product.id, activeVersion.id)).json();

    const doTemplate = await prisma.industrialCostTemplateResourceUsage.findMany({
      where: { industrialCostTemplateVersionId: activeVersion.id },
      select: { id: true },
    });
    const daEstrutura = await prisma.industrialCostResourceUsage.findMany({
      where: { industrialCostVersionId: ec.id },
      select: { id: true },
    });
    const ids = new Set(doTemplate.map((linha) => linha.id));
    for (const linha of daEstrutura) expect(ids.has(linha.id)).toBe(false);

    await app.close();
  });

  it("NÃO congela tarifa: a estrutura copiada nasce sem snapshot econômico", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const mist = await criarRecurso(app, "EQUIPMENT", "20");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mist.id, horas: "4" }]);
    const { product } = await criarProduto(app);
    const ec = (await aplicarTEC(app, product.id, activeVersion.id)).json();

    const uso = await prisma.industrialCostResourceUsage.findFirstOrThrow({
      where: { industrialCostVersionId: ec.id },
    });
    /*
     * Os campos `rate*Snapshot` existem para congelar economia NA ATIVAÇÃO da
     * estrutura. Preenchê-los na cópia faria um produto novo nascer com a
     * tarifa do dia em que a matriz foi escrita.
     */
    expect(uso.rateValueSnapshot).toBeNull();
    expect(uso.rateIdSnapshot).toBeNull();
    expect(uso.powerKwSnapshot).toBeNull();
    expect(uso.rateEffectiveAtSnapshot).toBeNull();
    // O que interessa viajou: quatro horas de misturador.
    expect(uso.usageQuantity.toString()).toBe("4");

    await app.close();
  });

  it("tarifa é resolvida na data, não congelada pelo template", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const mist = await criarRecurso(app, "EQUIPMENT", "20");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mist.id, horas: "4" }]);
    const { product } = await criarProduto(app);
    const ec = (await aplicarTEC(app, product.id, activeVersion.id)).json();

    const custoDe = async (data: Date) => {
      const resultado = (
        await app.inject({
          method: "GET",
          url: `/industrial-costs/${ec.id}/calculate?referenceDate=${data.toISOString()}`,
        })
      ).json();
      const linha = resultado.resources?.find(
        (r: { resourceId: string }) => r.resourceId === mist.id,
      );
      return Number(linha?.subtotal ?? 0);
    };

    const hoje = new Date();
    const antes = await custoDe(hoje);
    // 4 h × R$ 20 = R$ 80.
    expect(antes).toBe(80);

    // Tarifa sobe para 25 a partir de amanhã.
    const amanha = new Date(Date.now() + 86400000);
    await app.inject({
      method: "POST",
      url: `/industrial-resources/${mist.id}/rates`,
      payload: { rateValue: "25", effectiveAt: amanha.toISOString() },
    });

    const depois = await custoDe(new Date(Date.now() + 2 * 86400000));
    /*
     * O mesmo template, a mesma estrutura, outra data: 4 h × R$ 25 = R$ 100.
     * Se a tarifa tivesse sido congelada na cópia, este número continuaria 80
     * para sempre — e um produto criado hoje nasceria com o preço de ontem.
     */
    expect(depois).toBe(100);

    const noTemplate = await prisma.industrialCostTemplateResourceUsage.findFirstOrThrow({
      where: { industrialCostTemplateVersionId: activeVersion.id },
    });
    // O template continua dizendo só "4 horas".
    expect(noTemplate.usageQuantity.toString()).toBe("4");

    await app.close();
  });

  it("energia derivada continua sendo calculada pelo motor, sem duplicar", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const energia = await criarRecurso(app, "ENERGY", "0.92");
    const equipamento = await criarRecurso(app, "EQUIPMENT", "22", { powerKw: "7.5" });
    const { activeVersion } = await criarTemplateCusto(
      app,
      [{ id: equipamento.id, horas: "4" }],
      { energyResourceId: energia.id },
    );
    const { product } = await criarProduto(app);
    const ec = (await aplicarTEC(app, product.id, activeVersion.id)).json();

    expect(ec.energyCalculationMode).toBe("FROM_EQUIPMENT");
    expect(ec.energyResourceId).toBe(energia.id);
    // Nenhum kWh nem valor de energia veio congelado do template.
    const texto = JSON.stringify(activeVersion);
    expect(texto).not.toContain("kwh");
    expect(texto).not.toContain("derivedEnergy");

    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    const calc = (
      await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/calculations`, payload: {} })
    ).json();
    // 4 h × 7,5 kW × 0,92 = 27,60 — resolvido agora, não copiado.
    expect(calc.code.startsWith("CALC-")).toBe(true);

    await app.close();
  });

  it("EC em rascunho com configuração não é sobrescrita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const outro = await criarRecurso(app, "LABOR", "40");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }]);
    const { product } = await criarProduto(app);

    const primeira = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "500" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${primeira.id}/resource-usages`,
      payload: { resourceId: outro.id, usageQuantity: "2", usageBasis: "FIXED_PER_REFERENCE_BATCH" },
    });

    /*
     * O domínio admite um rascunho de estrutura por produto. Com o rascunho
     * ocupado, aplicar teria de sobrescrever — a operação para e explica em
     * vez de apagar o que alguém montou.
     */
    const recusado = await aplicarTEC(app, product.id, activeVersion.id);
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("cost_draft_in_use");

    const anterior = (
      await app.inject({ method: "GET", url: `/industrial-costs/${primeira.id}` })
    ).json();
    expect(anterior.resourceUsages).toHaveLength(1);
    expect(anterior.originCostTemplateVersionId).toBeNull();

    // Ativada a anterior, o rascunho libera e o template entra numa V2.
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${primeira.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    const criada = (await aplicarTEC(app, product.id, activeVersion.id)).json();
    expect(criada.id).not.toBe(primeira.id);
    expect(criada.versionNumber).toBe(2);
    expect(criada.originCostTemplateVersionId).toBe(activeVersion.id);

    await app.close();
  });

  it("só versão ATIVA de template vira estrutura", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }]);
    const rascunho = (
      await app.inject({
        method: "POST",
        url: `/cost-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    const { product } = await criarProduto(app);

    const recusado = await aplicarTEC(app, product.id, rascunho.id);
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_not_active");

    await app.close();
  });
});

describe("Isolamento — estrutura de custos", () => {
  it("template V2 não altera estruturas existentes", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }]);
    const a = await criarProduto(app);
    const b = await criarProduto(app);
    const ecA = (await aplicarTEC(app, a.product.id, activeVersion.id)).json();
    const ecB = (await aplicarTEC(app, b.product.id, activeVersion.id)).json();

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/cost-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/cost-template-versions/${v2.id}`,
      payload: {
        referenceOutputQuantity: "2000",
        resourceUsages: [
          { industrialResourceId: mao.id, usageQuantity: "12", usageUom: "HOUR" },
        ],
      },
    });
    await app.inject({ method: "POST", url: `/cost-template-versions/${v2.id}/activate` });

    for (const ec of [ecA, ecB]) {
      const depois = (
        await app.inject({ method: "GET", url: `/industrial-costs/${ec.id}` })
      ).json();
      expect(depois.referenceOutputQuantity).toBe("1000");
      expect(depois.resourceUsages[0].usageQuantity).toBe("6");
      expect(depois.originCostTemplateVersionNumber).toBe(1);
    }

    await app.close();
  });

  it("alterar a estrutura de A não muda B nem o template", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }]);
    const a = await criarProduto(app);
    const b = await criarProduto(app);
    const ecA = (await aplicarTEC(app, a.product.id, activeVersion.id)).json();
    const ecB = (await aplicarTEC(app, b.product.id, activeVersion.id)).json();

    await app.inject({
      method: "PATCH",
      url: `/industrial-costs/${ecA.id}`,
      payload: { referenceOutputQuantity: "5000" },
    });

    const bDepois = (await app.inject({ method: "GET", url: `/industrial-costs/${ecB.id}` })).json();
    expect(bDepois.referenceOutputQuantity).toBe("1000");
    const templateDepois = (
      await app.inject({ method: "GET", url: `/cost-template-versions/${activeVersion.id}` })
    ).json();
    expect(templateDepois.referenceOutputQuantity).toBe("1000");

    await app.close();
  });

  it("avisa versão nova e compara, sem oferecer sobrescrever", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { activeVersion } = await criarTemplateCusto(app, [{ id: mao.id, horas: "6" }]);
    const { product } = await criarProduto(app);
    const ec = (await aplicarTEC(app, product.id, activeVersion.id)).json();

    const semNovidade = (
      await app.inject({ method: "GET", url: `/industrial-costs/${ec.id}/template-update` })
    ).json();
    expect(semNovidade.update).toBeNull();

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/cost-template-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/cost-template-versions/${v2.id}`,
      payload: {
        resourceUsages: [{ industrialResourceId: mao.id, usageQuantity: "10", usageUom: "HOUR" }],
      },
    });
    await app.inject({ method: "POST", url: `/cost-template-versions/${v2.id}/activate` });

    const aviso = (
      await app.inject({ method: "GET", url: `/industrial-costs/${ec.id}/template-update` })
    ).json().update;
    expect(aviso.latestVersionNumber).toBe(2);

    const diff = (
      await app.inject({ method: "GET", url: `/industrial-costs/${ec.id}/template-diff` })
    ).json();
    const uso = diff.entries.find((e: { field: string | null }) => e.field === "Uso");
    expect(uso.from).toContain("6");
    expect(uso.to).toContain("10");
    // Diff de configuração, nunca de dinheiro resolvido por tarifa.
    expect(JSON.stringify(diff)).not.toMatch(/R\$/);

    // Avisar não é atualizar.
    const inalterada = (
      await app.inject({ method: "GET", url: `/industrial-costs/${ec.id}` })
    ).json();
    expect(inalterada.resourceUsages[0].usageQuantity).toBe("6");

    await app.close();
  });

  it("salva a estrutura como template, sem levar tarifa nem cálculo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const mao = await criarRecurso(app, "LABOR", "38");
    const { product } = await criarProduto(app);
    const ec = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "800" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/resource-usages`,
      payload: { resourceId: mao.id, usageQuantity: "7", usageBasis: "FIXED_PER_REFERENCE_BATCH" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/calculations`, payload: {} });

    const resposta = await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/save-as-template`,
      payload: { name: `DEMO Salvo ${marker()}` },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const template = resposta.json();
    fixtureCostTemplateIds.push(template.id);

    expect(template.activeVersion).toBeNull();
    expect(template.draftVersion.referenceOutputQuantity).toBe("800");
    expect(template.draftVersion.resourceUsages).toHaveLength(1);
    expect(template.draftVersion.resourceUsages[0].usageQuantity).toBe("7");

    // Nada econômico atravessou: nem tarifa congelada, nem cálculo, nem qualidade.
    const texto = JSON.stringify(template);
    for (const proibido of ["rateValueSnapshot", "CALC-", "costQuality", "referenceDate"]) {
      expect(texto).not.toContain(proibido);
    }

    // A estrutura de origem não se moveu.
    const original = (await app.inject({ method: "GET", url: `/industrial-costs/${ec.id}` })).json();
    expect(original.status).toBe("ACTIVE");
    expect(original.originCostTemplateVersionId).toBeNull();

    await app.close();
  });

  it("estruturas antigas seguem válidas com origem nula", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product } = await criarProduto(app);
    const ec = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "1000" },
      })
    ).json();

    expect(ec.originCostTemplateVersionId).toBeNull();
    expect(ec.originCostTemplateCode).toBeNull();

    await app.close();
  });

  it("papel comercial não configura estrutura industrial", async () => {
    const comercial = buildTestApp("COMMERCIAL");
    await comercial.ready();

    expect((await comercial.inject({ method: "GET", url: "/cost-templates" })).statusCode).toBe(200);
    const criar = await comercial.inject({
      method: "POST",
      url: "/cost-templates",
      payload: { name: "DEMO Não autorizado" },
    });
    // Gate por domínio, não por uniformidade: quem configura produção é
    // produção/administração.
    expect(criar.statusCode).toBe(403);

    await comercial.close();
  });
});

describe("Biblioteca de políticas de precificação", () => {
  async function criarPolitica(
    app: App,
    faixas: { quantity: string; margem: string; comissao?: string }[],
  ) {
    const policy = (
      await app.inject({
        method: "POST",
        url: "/pricing-policies",
        payload: { name: `DEMO Private Label ${marker()}` },
      })
    ).json();
    fixturePolicyIds.push(policy.id);

    await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${policy.draftVersion.id}`,
      payload: {
        tiers: faixas.map((f) => ({
          quantity: f.quantity,
          targetContributionMarginPercent: f.margem,
          commissionPercent: f.comissao ?? "5",
        })),
      },
    });
    const ativa = await app.inject({
      method: "POST",
      url: `/pricing-policy-versions/${policy.draftVersion.id}/activate`,
    });
    expect(ativa.statusCode, ativa.body).toBe(200);
    return { policy, activeVersion: ativa.json() };
  }

  it("cria com código TPP e V1 em rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const resposta = await app.inject({
      method: "POST",
      url: "/pricing-policies",
      payload: { name: `DEMO Política ${marker()}` },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const policy = resposta.json();
    fixturePolicyIds.push(policy.id);

    expect(policy.code.startsWith("TPP-")).toBe(true);
    expect(policy.draftVersion.versionNumber).toBe(1);
    expect(policy.activeVersion).toBeNull();

    await app.close();
  });

  it("guarda faixas com margem e comissão — e nenhum preço", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [
      { quantity: "500", margem: "35" },
      { quantity: "1000", margem: "32" },
      { quantity: "3000", margem: "28" },
    ]);

    expect(activeVersion.tiers).toHaveLength(3);
    expect(activeVersion.tiers.map((t: { quantity: string }) => t.quantity)).toEqual([
      "500",
      "1000",
      "3000",
    ]);
    expect(Number(activeVersion.tiers[0].targetContributionMarginPercent)).toBe(35);
    expect(Number(activeVersion.tiers[0].commissionPercent)).toBe(5);

    /*
     * A prova de que é política e não tabela de preço: nenhum valor monetário
     * atravessa. Preço depende do custo do produto, e um número aqui seria o
     * custo de outro produto disfarçado de decisão comercial.
     */
    const texto = JSON.stringify(activeVersion);
    for (const proibido of [
      "unitPrice",
      "suggestedPrice",
      "manualUnitPrice",
      "costPerUnit",
      "contribution",
      "markup",
    ]) {
      expect(texto).not.toContain(proibido);
    }

    await app.close();
  });

  it("ativa e vira histórica; nova versão copia para rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { policy, activeVersion } = await criarPolitica(app, [
      { quantity: "1000", margem: "32" },
    ]);

    const editar = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${activeVersion.id}`,
      payload: { notes: "não deveria" },
    });
    expect(editar.statusCode).toBe(409);
    expect(editar.json().error).toBe("template_not_draft");

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/pricing-policy-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.tiers).toHaveLength(1);
    expect(v2.sourceVersionNumber).toBe(1);

    await app.inject({ method: "POST", url: `/pricing-policy-versions/${v2.id}/activate` });
    const ativas = await prisma.pricingPolicyTemplateVersion.count({
      where: { pricingPolicyTemplateId: policy.id, status: "ACTIVE" },
    });
    expect(ativas).toBe(1);

    await app.close();
  });

  it("recusa ativar política sem faixas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const policy = (
      await app.inject({
        method: "POST",
        url: "/pricing-policies",
        payload: { name: `DEMO Vazia ${marker()}` },
      })
    ).json();
    fixturePolicyIds.push(policy.id);

    const recusado = await app.inject({
      method: "POST",
      url: `/pricing-policy-versions/${policy.draftVersion.id}/activate`,
    });
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_empty");

    await app.close();
  });
});

describe("Aplicar política — o preço nasce do custo do produto", () => {
  async function criarPolitica(
    app: App,
    faixas: { quantity: string; margem: string; comissao?: string }[],
  ) {
    const policy = (
      await app.inject({
        method: "POST",
        url: "/pricing-policies",
        payload: { name: `DEMO Política ${marker()}` },
      })
    ).json();
    fixturePolicyIds.push(policy.id);
    await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${policy.draftVersion.id}`,
      payload: {
        tiers: faixas.map((f) => ({
          quantity: f.quantity,
          targetContributionMarginPercent: f.margem,
          commissionPercent: f.comissao ?? "5",
        })),
      },
    });
    const ativa = await app.inject({
      method: "POST",
      url: `/pricing-policy-versions/${policy.draftVersion.id}/activate`,
    });
    return { policy, activeVersion: ativa.json() };
  }

  async function produtoComCusto(app: App, horas: string) {
    const mao = await criarRecurso(app, "LABOR", "40");
    const energia = await criarRecurso(app, "ENERGY", "0.92");
    const { product } = await criarProduto(app);
    const ec = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "1000" },
      })
    ).json();
    // Energia precisa estar estruturada: não configurada significa custo
    // DESCONHECIDO, e custo desconhecido não vira preço pela margem.
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/resource-usages`,
      payload: {
        resourceId: energia.id,
        usageQuantity: "50",
        usageBasis: "FIXED_PER_REFERENCE_BATCH",
      },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/resource-usages`,
      payload: { resourceId: mao.id, usageQuantity: horas, usageBasis: "FIXED_PER_REFERENCE_BATCH" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    const calc = (
      await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/calculations`, payload: {} })
    ).json();
    return { product, ec, calc };
  }

  it("A MESMA política em produtos com custos diferentes gera preços diferentes", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [{ quantity: "1000", margem: "35" }]);
    // Dois produtos idênticos, exceto pelo esforço industrial.
    const a = await produtoComCusto(app, "4");
    const b = await produtoComCusto(app, "20");

    const previaA = (
      await app.inject({
        method: "POST",
        url: `/products/${a.product.id}/pricing/policy-preview`,
        payload: {
          pricingPolicyVersionId: activeVersion.id,
          industrialCostCalculationId: a.calc.id,
        },
      })
    ).json();
    const previaB = (
      await app.inject({
        method: "POST",
        url: `/products/${b.product.id}/pricing/policy-preview`,
        payload: {
          pricingPolicyVersionId: activeVersion.id,
          industrialCostCalculationId: b.calc.id,
        },
      })
    ).json();

    /*
     * ESTE é o teste que define a capacidade. A política diz "margem de 35%";
     * o preço sai do custo de cada produto. Se os dois números fossem iguais,
     * a política estaria carregando o custo de um produto para dentro do
     * outro — exatamente o que copiar preço faria.
     */

    expect(Number(previaA.tiers[0].costPerUnit)).toBeLessThan(
      Number(previaB.tiers[0].costPerUnit),
    );
    expect(Number(previaA.tiers[0].suggestedUnitPrice)).toBeLessThan(
      Number(previaB.tiers[0].suggestedUnitPrice),
    );
    // A regra, essa sim, é a mesma nos dois.
    expect(previaA.tiers[0].targetContributionMarginPercent).toBe(
      previaB.tiers[0].targetContributionMarginPercent,
    );

    await app.close();
  });

  it("aplicar cria precificação em rascunho com as faixas calculadas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { policy, activeVersion } = await criarPolitica(app, [
      { quantity: "500", margem: "35" },
      { quantity: "1000", margem: "32" },
      { quantity: "3000", margem: "28" },
    ]);
    const { product, calc } = await produtoComCusto(app, "6");

    const resposta = await app.inject({
      method: "POST",
      url: `/products/${product.id}/pricing/from-policy`,
      payload: { pricingPolicyVersionId: activeVersion.id, industrialCostCalculationId: calc.id },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const pricing = resposta.json();

    expect(pricing.status).toBe("DRAFT");
    expect(pricing.calculationCode).toBe(calc.code);
    expect(pricing.originPricingPolicyVersionId).toBe(activeVersion.id);
    expect(pricing.originPricingPolicyCode).toBe(policy.code);

    /*
     * Exatamente as faixas da política — sem interpolar. Inventar 750 criaria
     * uma faixa que ninguém aprovou, e o orçamento exige quantidade exata.
     */
    expect(pricing.tiers.map((t: { quantity: string }) => Number(t.quantity)).sort((x: number, y: number) => x - y)).toEqual([
      500, 1000, 3000,
    ]);

    // Preço calculado agora, para este produto.
    for (const tier of pricing.tiers) {
      expect(tier.priceMode).toBe("TARGET_MARGIN");
      expect(tier.suggestedUnitPrice).not.toBeNull();
    }

    await app.close();
  });

  it("aplicar exige base de custo — o preço nasce dela", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [{ quantity: "1000", margem: "35" }]);
    const { product } = await criarProduto(app);

    const recusado = await app.inject({
      method: "POST",
      url: `/products/${product.id}/pricing/from-policy`,
      payload: { pricingPolicyVersionId: activeVersion.id, industrialCostCalculationId: "nada" },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("calculation_required");

    await app.close();
  });

  it("custo incompleto continua sem preço sugerido — a política não contorna a regra", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [{ quantity: "1000", margem: "35" }]);
    // Sem recurso nem material com custo: cálculo parcial.
    const { product } = await criarProduto(app);
    const ec = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: "1000" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/lines`,
      payload: {
        category: "OVERHEAD",
        description: "Rateio",
        calculationBasis: "PER_1000_OUTPUT_UNITS",
        rateValue: "100",
      },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/activate`,
      payload: { confirmIncomplete: true },
    });
    const calc = (
      await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/calculations`, payload: {} })
    ).json();

    const previa = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/pricing/policy-preview`,
        payload: {
          pricingPolicyVersionId: activeVersion.id,
          industrialCostCalculationId: calc.id,
        },
      })
    ).json();

    if (calc.quality !== "COMPLETE_REAL_REFERENCE") {
      // Margem sobre subtotal conhecido pareceria segura e não seria.
      expect(previa.tiers[0].suggestedUnitPrice).toBeNull();
      expect(previa.tiers[0].warning).toBeTruthy();
    }

    await app.close();
  });

  it("política V2 não altera precificações existentes", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [{ quantity: "1000", margem: "35" }]);
    const { product, calc } = await produtoComCusto(app, "6");
    const pricing = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/pricing/from-policy`,
        payload: { pricingPolicyVersionId: activeVersion.id, industrialCostCalculationId: calc.id },
      })
    ).json();
    const precoAntes = pricing.tiers[0].suggestedUnitPrice;

    const v2 = (
      await app.inject({
        method: "POST",
        url: `/pricing-policy-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${v2.id}`,
      payload: {
        tiers: [{ quantity: "1000", targetContributionMarginPercent: "50", commissionPercent: "5" }],
      },
    });
    await app.inject({ method: "POST", url: `/pricing-policy-versions/${v2.id}/activate` });

    const depois = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}` })
    ).json();
    expect(depois.tiers[0].suggestedUnitPrice).toBe(precoAntes);
    expect(Number(depois.tiers[0].targetContributionMarginPercent)).toBe(35);
    expect(depois.originPricingPolicyVersionNumber).toBe(1);

    // E o aviso aparece, sem nunca aplicar sozinho.
    const aviso = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}/policy-update` })
    ).json().update;
    expect(aviso.latestVersionNumber).toBe(2);

    await app.close();
  });

  it("alterar a precificação não muda a política", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [{ quantity: "1000", margem: "35" }]);
    const { product, calc } = await produtoComCusto(app, "6");
    const pricing = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/pricing/from-policy`,
        payload: { pricingPolicyVersionId: activeVersion.id, industrialCostCalculationId: calc.id },
      })
    ).json();

    await app.inject({
      method: "PATCH",
      url: `/pricing-tiers/${pricing.tiers[0].id}`,
      payload: { targetContributionMarginPercent: "60" },
    });

    const politica = (
      await app.inject({ method: "GET", url: `/pricing-policy-versions/${activeVersion.id}` })
    ).json();
    expect(Number(politica.tiers[0].targetContributionMarginPercent)).toBe(35);

    await app.close();
  });

  it("compara duas versões de política — regra, nunca preço", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [
      { quantity: "500", margem: "35" },
      { quantity: "1000", margem: "32" },
    ]);
    const v2 = (
      await app.inject({
        method: "POST",
        url: `/pricing-policy-versions/${activeVersion.id}/new-version`,
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${v2.id}`,
      payload: {
        tiers: [
          { quantity: "500", targetContributionMarginPercent: "30", commissionPercent: "5" },
          { quantity: "3000", targetContributionMarginPercent: "28", commissionPercent: "5" },
        ],
      },
    });

    const diff = (
      await app.inject({
        method: "GET",
        url: `/pricing-policy-versions/${activeVersion.id}/compare?against=${v2.id}`,
      })
    ).json();
    const tipos = diff.entries.map((e: { kind: string }) => e.kind);
    expect(tipos).toContain("TIER_ADDED");
    expect(tipos).toContain("TIER_REMOVED");
    expect(tipos).toContain("TIER_CHANGED");
    // Nada de dinheiro no diff: o preço muda com o produto, não com a política.
    expect(JSON.stringify(diff)).not.toMatch(/R\$/);

    await app.close();
  });

  it("salva a precificação como política, sem levar preço", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { activeVersion } = await criarPolitica(app, [{ quantity: "1000", margem: "35" }]);
    const { product, calc } = await produtoComCusto(app, "6");
    const pricing = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/pricing/from-policy`,
        payload: { pricingPolicyVersionId: activeVersion.id, industrialCostCalculationId: calc.id },
      })
    ).json();

    const resposta = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/save-as-policy`,
      payload: { name: `DEMO Salva ${marker()}` },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const nova = resposta.json();
    fixturePolicyIds.push(nova.id);

    expect(nova.activeVersion).toBeNull();
    expect(nova.draftVersion.tiers).toHaveLength(1);
    expect(Number(nova.draftVersion.tiers[0].targetContributionMarginPercent)).toBe(35);

    // Nem preço, nem custo, nem cálculo, nem produto, nem cliente.
    const texto = JSON.stringify(nova);
    for (const proibido of ["unitPrice", "CALC-", product.id, "costPerUnit", "customer"]) {
      expect(texto).not.toContain(proibido);
    }

    // A precificação de origem não se moveu.
    const original = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}` })
    ).json();
    expect(original.tiers).toHaveLength(1);

    await app.close();
  });

  it("faixa de preço manual não vira regra de política", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calc } = await produtoComCusto(app, "6");
    const pricing = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/pricing`,
        payload: { industrialCostCalculationId: calc.id },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/tiers`,
      payload: {
        quantity: "1000",
        priceMode: "MANUAL_PRICE",
        manualUnitPrice: "44.90",
        commissionPercent: "5",
      },
    });

    const recusado = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/save-as-policy`,
      payload: { name: `DEMO Manual ${marker()}` },
    });
    /*
     * Preço informado à mão é decisão de UMA negociação sobre UM custo. Não há
     * regra a extrair dele, e transportá-lo levaria o acordo de um cliente
     * para outro sem que ninguém tivesse decidido isso.
     */
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("template_empty");

    await app.close();
  });

  it("precificações antigas seguem válidas com origem nula", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calc } = await produtoComCusto(app, "6");
    const pricing = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/pricing`,
        payload: { industrialCostCalculationId: calc.id },
      })
    ).json();

    expect(pricing.originPricingPolicyVersionId).toBeNull();
    expect(pricing.originPricingPolicyCode).toBeNull();

    await app.close();
  });

  it("produção não define política comercial", async () => {
    const producao = buildTestApp("PRODUCTION");
    await producao.ready();

    expect((await producao.inject({ method: "GET", url: "/pricing-policies" })).statusCode).toBe(200);
    const criar = await producao.inject({
      method: "POST",
      url: "/pricing-policies",
      payload: { name: "DEMO Não autorizado" },
    });
    // Gate do domínio comercial — não se uniformiza concedendo acesso.
    expect(criar.statusCode).toBe(403);

    await producao.close();
  });
});

describe("Nenhum documento operacional aponta para as matrizes", () => {
  it("nem custo, nem preço, nem orçamento, nem pedido citam template", async () => {
    const prisma = getPrisma();
    const referencias = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT DISTINCT tc.table_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name IN (
            'industrial_cost_templates', 'industrial_cost_template_versions',
            'pricing_policy_templates', 'pricing_policy_template_versions'
          )`,
    );
    const tabelas = new Set(referencias.map((linha) => linha.table_name));

    /*
     * O motor de custo lê Produto → Formulação → Estrutura. O orçamento lê
     * PricingTier. Se algum dia alguém pendurar um desses direto na matriz,
     * este teste cai antes de o problema chegar num pedido.
     */
    for (const proibida of [
      "industrial_cost_calculations",
      "pricing_tiers",
      "quote_lines",
      "quote_versions",
      "customer_orders",
      "customer_order_lines",
      "production_orders",
      "formulation_versions",
    ]) {
      expect(tabelas.has(proibida), `${proibida} não pode citar template`).toBe(false);
    }
    // Só a estrutura e a precificação do produto guardam a proveniência.
    expect(tabelas.has("industrial_cost_versions")).toBe(true);
    expect(tabelas.has("pricing_versions")).toBe(true);
  });
});
