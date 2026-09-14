import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { instanteNoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";

/**
 * O envio do Orçamento pede confirmação de custo incompleto pela qualidade do
 * custo que FORMOU o preço — QUOTE-SEND-CONFIRM-QUALITY-01.
 *
 * A faixa ativa congela duas qualidades, e são fatos diferentes:
 * `costQualitySnapshot` é a do cálculo (o CMV da quantidade) e
 * `pricingCostQualitySnapshot` é a da base que o Modelo de Precificação usou
 * para formar o preço (§84). No Modelo padrão coincidem; num Modelo que ignora
 * a conversão do ERP, cálculo parcial convive com base de preço completa — e o
 * envio pedia confirmação pela do cálculo: confirmação falsa.
 *
 * Regra: o envio pesa `pricingCostQuality ?? costQuality`. Faixa ativada antes
 * do campo fica com ele nulo (sem backfill) e se lê como sempre se leu.
 */

const VALIDADE_DA_PROPOSTA = "2099-12-31";
const COMPLETAS = ["COMPLETE_REAL_REFERENCE", "COMPLETE_WITH_ESTIMATES"];
const INCOMPLETAS = ["PARTIAL", "NO_COST"];

type App = ReturnType<typeof buildTestApp>;

interface Alvo {
  projectId: string;
  productId: string;
  formulacaoId: string;
  material: { id: string };
  mao: { id: string };
  ecId: string;
  calc: { id: string; quality: string };
}

const ids = {
  projects: [] as string[],
  products: [] as string[],
  items: [] as string[],
  customers: [] as string[],
  suppliers: [] as string[],
  resources: [] as string[],
  purchaseOrders: [] as string[],
  receipts: [] as string[],
  policies: [] as string[],
};

let app: App;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  for (const unit of [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  app = buildTestApp("ADMIN");
  await app.ready();
});

afterAll(async () => {
  await app.close();
  const prisma = getPrisma();

  // Só o que ESTE arquivo criou, pelos ids das próprias fixtures.
  if (ids.projects.length > 0) {
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: ids.projects } } });
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: ids.projects } } });
  }

  const products = await prisma.product.findMany({
    where: { OR: [{ id: { in: ids.products } }, { originProjectId: { in: ids.projects } }] },
    select: { id: true, finishedProductItemId: true },
  });
  const productIds = products.map((product) => product.id);
  const finishedItemIds = products
    .map((product) => product.finishedProductItemId)
    .filter((id): id is string => id !== null);

  if (productIds.length > 0) {
    const doProduto = { productId: { in: productIds } };
    await prisma.pricingTier.deleteMany({ where: { pricingVersion: doProduto } });
    await prisma.pricingVersion.deleteMany({ where: doProduto });
    await prisma.industrialCostCalculation.deleteMany({ where: doProduto });
    await prisma.industrialCostResourceUsage.deleteMany({ where: { industrialCostVersion: doProduto } });
    await prisma.industrialCostLine.deleteMany({ where: { industrialCostVersion: doProduto } });
    await prisma.industrialCostVersion.deleteMany({ where: doProduto });
    await prisma.formulationComponent.deleteMany({ where: { formulationVersion: doProduto } });
    await prisma.formulationVersion.deleteMany({ where: doProduto });
    await prisma.quoteLine.deleteMany({ where: doProduto });
    await prisma.projectProduct.deleteMany({ where: doProduto });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  if (ids.projects.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: ids.projects } } });
  }
  if (ids.policies.length > 0) {
    await prisma.pricingPolicyTemplate.deleteMany({ where: { id: { in: ids.policies } } });
  }
  if (ids.resources.length > 0) {
    await prisma.industrialResourceRate.deleteMany({ where: { industrialResourceId: { in: ids.resources } } });
    await prisma.industrialResource.deleteMany({ where: { id: { in: ids.resources } } });
  }
  if (ids.receipts.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: ids.receipts } } });
    await prisma.receipt.deleteMany({ where: { id: { in: ids.receipts } } });
  }
  if (ids.purchaseOrders.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: ids.purchaseOrders } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ids.purchaseOrders } } });
  }
  const itemIds = [...ids.items, ...finishedItemIds];
  if (itemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (ids.suppliers.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: ids.suppliers } } });
  }
  if (ids.customers.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  }
});

async function criarMaterial() {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-ENV-${m}`,
      name: `Insumo Envio ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  ids.items.push(item.id);
  return item;
}

/** Compra recebida com custo informado — é daí que nasce o custo do material. */
async function receberComCusto(itemId: string, unitCost: string) {
  const m = marker();
  const supplier = await getPrisma().supplier.create({
    data: { code: `FOR-ENV-${m}`, legalName: `Fornecedor Envio ${m}`, active: true },
  });
  ids.suppliers.push(supplier.id);
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
  ids.purchaseOrders.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: instanteNoDiaComercialDeTeste().toISOString(),
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
  ids.receipts.push(receipt.id);
}

async function criarRecurso(type: "LABOR" | "ENERGY", rateValue: string) {
  const recurso = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Envio ${type} ${marker()}`, type },
    })
  ).json();
  ids.resources.push(recurso.id);
  await app.inject({ method: "POST", url: `/industrial-resources/${recurso.id}/rates`, payload: { rateValue } });
  return recurso as { id: string };
}

/**
 * Projeto com produto técnico, formulação ativa (0,1 kg de insumo a R$ 10/kg
 * por unidade), Estrutura de Custos com mão de obra — e energia, quando pedida:
 * sem energia o cálculo é parcial — e o cálculo.
 */
async function produtoCalculado(opcoes: { energia: boolean }): Promise<Alvo> {
  const customer = await getPrisma().customer.create({
    data: { code: `CLI-ENV-${marker()}`, legalName: `Cliente Envio ${marker()}`, active: true },
  });
  ids.customers.push(customer.id);
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: `Projeto Envio ${marker()}`, customerId: customer.id, entryDate: new Date().toISOString() },
    })
  ).json();
  ids.projects.push(project.id);
  const preparado = (
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/technical-product`,
      payload: { finishedUnitCode: "un" },
    })
  ).json();
  const productId = preparado.productId as string;
  ids.products.push(productId);

  const material = await criarMaterial();
  await receberComCusto(material.id, "10");
  const formulacoes = (await app.inject({ method: "GET", url: `/products/${productId}/formulations` })).json();
  const formulacaoId = formulacoes.versions[0].id as string;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulacaoId}`,
    payload: { basisQuantity: "1", components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }] },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulacaoId}/activate` });

  const mao = await criarRecurso("LABOR", "40");
  const ec = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/industrial-costs`,
      payload: { referenceOutputQuantity: "1000" },
    })
  ).json();
  if (opcoes.energia) {
    const energia = await criarRecurso("ENERGY", "0.92");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${ec.id}/resource-usages`,
      payload: { resourceId: energia.id, usageQuantity: "50", usageBasis: "FIXED_PER_REFERENCE_BATCH" },
    });
  }
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${ec.id}/resource-usages`,
    payload: { resourceId: mao.id, usageQuantity: "4", usageBasis: "FIXED_PER_REFERENCE_BATCH" },
  });
  await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/activate`, payload: { confirmIncomplete: true } });
  const calc = (
    await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/calculations`, payload: {} })
  ).json();

  return { projectId: project.id, productId, formulacaoId, material, mao, ecId: ec.id, calc };
}

/** Modelo padrão (sem política): faixa de 1000 com preço manual — ativa com custo completo ou não. */
async function precificacaoPadrao(alvo: Alvo, opcoes: { confirmar: boolean }) {
  const pricing = (
    await app.inject({
      method: "POST",
      url: `/products/${alvo.productId}/pricing`,
      payload: { industrialCostCalculationId: alvo.calc.id },
    })
  ).json();
  const faixa = await app.inject({
    method: "POST",
    url: `/pricing-versions/${pricing.id}/tiers`,
    payload: { quantity: "1000", priceMode: "MANUAL_PRICE", manualUnitPrice: "20", commissionPercent: "5" },
  });
  expect(faixa.statusCode, faixa.body).toBe(201);
  const ativada = await app.inject({
    method: "POST",
    url: `/pricing-versions/${pricing.id}/activate`,
    payload: opcoes.confirmar ? { confirmIncompleteCost: true } : {},
  });
  expect(ativada.statusCode, ativada.body).toBe(200);
  return ativada.json();
}

/** Política ativa cujo Modelo deixa a conversão do ERP fora do custo do preço. */
async function modeloQueIgnoraConversao(): Promise<string> {
  const policy = (
    await app.inject({ method: "POST", url: "/pricing-policies", payload: { name: `DEMO Modelo envio ${marker()}` } })
  ).json();
  ids.policies.push(policy.id);
  const versionId = policy.draftVersion.id as string;
  const salvo = await app.inject({
    method: "PATCH",
    url: `/pricing-policy-versions/${versionId}`,
    payload: {
      tiers: [{ quantity: "1000", targetContributionMarginPercent: "35", commissionPercent: "5" }],
      pricingModel: { industrialCostMode: "IGNORE" },
    },
  });
  expect(salvo.statusCode, salvo.body).toBe(200);
  const ativa = await app.inject({ method: "POST", url: `/pricing-policy-versions/${versionId}/activate` });
  expect(ativa.statusCode, ativa.body).toBe(200);
  return versionId;
}

/** Precificação aplicada pela política e ativada SEM confirmar custo incompleto. */
async function precificacaoPeloModelo(alvo: Alvo, pricingPolicyVersionId: string) {
  const aplicada = await app.inject({
    method: "POST",
    url: `/products/${alvo.productId}/pricing/from-policy`,
    payload: { pricingPolicyVersionId, industrialCostCalculationId: alvo.calc.id },
  });
  expect(aplicada.statusCode, aplicada.body).toBe(201);
  const ativada = await app.inject({
    method: "POST",
    url: `/pricing-versions/${aplicada.json().id}/activate`,
    payload: {},
  });
  expect(ativada.statusCode, ativada.body).toBe(200);
  return ativada.json();
}

/** Versão de orçamento em rascunho com a linha do produto precificada pela faixa. */
async function orcamentoComFaixa(projectId: string, pricingTierId: string): Promise<string> {
  const produtos = (await app.inject({ method: "GET", url: `/projects/${projectId}/products` })).json()
    .products as { id: string }[];
  let quote = (await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })).json();
  if (quote.lines.length === 0) {
    quote = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: produtos[0]?.id },
      })
    ).json();
  }
  const aplicada = await app.inject({
    method: "POST",
    url: `/quote-lines/${quote.lines[0].id}/apply-pricing`,
    payload: { pricingTierId },
  });
  expect(aplicada.statusCode, aplicada.body).toBe(200);
  return quote.id;
}

async function enviar(quoteId: string, payload: Record<string, unknown> = {}) {
  await app.inject({ method: "PATCH", url: `/quote-versions/${quoteId}`, payload: { validUntil: VALIDADE_DA_PROPOSTA } });
  return app.inject({ method: "POST", url: `/quote-versions/${quoteId}/send`, payload });
}

async function proveniencia(quoteId: string) {
  const detalhe = (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
  return detalhe.lines[0].pricing as Record<string, unknown>;
}

function qualidadesCongeladas(tierId: string) {
  return getPrisma().pricingTier.findUniqueOrThrow({
    where: { id: tierId },
    select: { costQualitySnapshot: true, pricingCostQualitySnapshot: true, selectedPriceSnapshot: true },
  });
}

describe("QUOTE-SEND-CONFIRM-QUALITY-01 — a faixa congela a qualidade do custo do preço, e o envio pesa por ela", () => {
  it("Modelo padrão com custo completo: as duas qualidades iguais e completas; envia sem confirmação", async () => {
    const alvo = await produtoCalculado({ energia: true });
    expect(COMPLETAS).toContain(alvo.calc.quality);
    const tier = (await precificacaoPadrao(alvo, { confirmar: false })).tiers[0];

    expect(COMPLETAS).toContain(tier.costQuality);
    expect(tier.pricingCostQuality).toBe(tier.costQuality);
    expect(await qualidadesCongeladas(tier.id)).toMatchObject({
      costQualitySnapshot: tier.costQuality,
      pricingCostQualitySnapshot: tier.costQuality,
    });

    const quoteId = await orcamentoComFaixa(alvo.projectId, tier.id);
    expect(await proveniencia(quoteId)).toMatchObject({
      frozen: false,
      costQuality: tier.costQuality,
      pricingCostQuality: tier.costQuality,
    });
    const enviado = await enviar(quoteId);
    expect(enviado.statusCode, enviado.body).toBe(200);
  }, 30_000);

  it("Modelo padrão com custo parcial: as duas qualidades parciais; o envio pede confirmação e, confirmado, envia", async () => {
    const alvo = await produtoCalculado({ energia: false });
    expect(INCOMPLETAS).toContain(alvo.calc.quality);
    const tier = (await precificacaoPadrao(alvo, { confirmar: true })).tiers[0];

    expect(INCOMPLETAS).toContain(tier.pricingCostQuality);
    expect(tier.pricingCostQuality).toBe(tier.costQuality);
    expect(await qualidadesCongeladas(tier.id)).toMatchObject({
      costQualitySnapshot: tier.costQuality,
      pricingCostQualitySnapshot: tier.costQuality,
    });

    const quoteId = await orcamentoComFaixa(alvo.projectId, tier.id);
    const recusado = await enviar(quoteId);
    expect(recusado.statusCode, recusado.body).toBe(409);
    expect(recusado.json().error).toBe("incomplete_cost");
    const confirmado = await enviar(quoteId, { confirmIncompleteCost: true });
    expect(confirmado.statusCode, confirmado.body).toBe(200);
  }, 30_000);

  it("Modelo que ignora a conversão: cálculo parcial, base do preço completa — envia sem confirmação falsa, e a do cálculo continua dita", async () => {
    const alvo = await produtoCalculado({ energia: false });
    expect(INCOMPLETAS).toContain(alvo.calc.quality);
    const prec = await precificacaoPeloModelo(alvo, await modeloQueIgnoraConversao());
    expect(prec.pricingModel.industrialCostMode).toBe("IGNORE");
    const tier = prec.tiers[0];

    expect(INCOMPLETAS).toContain(tier.costQuality);
    expect(COMPLETAS).toContain(tier.pricingCostQuality);
    expect(await qualidadesCongeladas(tier.id)).toMatchObject({
      costQualitySnapshot: tier.costQuality,
      pricingCostQualitySnapshot: tier.pricingCostQuality,
    });

    const quoteId = await orcamentoComFaixa(alvo.projectId, tier.id);
    expect(await proveniencia(quoteId)).toMatchObject({
      costQuality: tier.costQuality,
      pricingCostQuality: tier.pricingCostQuality,
    });
    const enviado = await enviar(quoteId);
    expect(enviado.statusCode, enviado.body).toBe(200);

    // A linha enviada congela a qualidade do CÁLCULO, como sempre: os dois fatos não se fundem.
    const enviada = await proveniencia(quoteId);
    expect(enviada.frozen).toBe(true);
    expect(enviada.costQuality).toBe(tier.costQuality);
    expect(enviada).not.toHaveProperty("pricingCostQuality");
  }, 30_000);

  it("depois de ativa, Modelo, custo, referência e materiais novos não mudam a qualidade congelada — e o envio segue sem confirmação", async () => {
    const alvo = await produtoCalculado({ energia: false });
    const modelo = await modeloQueIgnoraConversao();
    const prec = await precificacaoPeloModelo(alvo, modelo);
    const tier = prec.tiers[0];
    const congelado = await qualidadesCongeladas(tier.id);
    expect(COMPLETAS).toContain(congelado.pricingCostQualitySnapshot);

    // Modelo: a política ganha versão nova, que usa o cálculo do ERP.
    const v2 = (await app.inject({ method: "POST", url: `/pricing-policy-versions/${modelo}/new-version` })).json();
    const modeloNovo = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${v2.id}`,
      payload: { pricingModel: { industrialCostMode: "CALCULATED" } },
    });
    expect(modeloNovo.statusCode, modeloNovo.body).toBe(200);
    const v2Ativa = await app.inject({ method: "POST", url: `/pricing-policy-versions/${v2.id}/activate` });
    expect(v2Ativa.statusCode, v2Ativa.body).toBe(200);

    // Custo: compra nova do insumo, mais cara.
    await receberComCusto(alvo.material.id, "25");

    // Referência: tarifa nova da mão de obra e cálculo novo.
    await app.inject({ method: "POST", url: `/industrial-resources/${alvo.mao.id}/rates`, payload: { rateValue: "80" } });
    const calcNovo = (
      await app.inject({ method: "POST", url: `/industrial-costs/${alvo.ecId}/calculations`, payload: {} })
    ).json();

    // Materiais: formulação nova com um insumo sem custo nenhum.
    const semCusto = await criarMaterial();
    const novaFormulacao = await app.inject({ method: "POST", url: `/formulation-versions/${alvo.formulacaoId}/new-version` });
    expect(novaFormulacao.statusCode, novaFormulacao.body).toBe(201);
    const editada = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${novaFormulacao.json().id}`,
      payload: {
        basisQuantity: "1",
        components: [
          { itemId: alvo.material.id, quantity: "0.1", unitCode: "kg" },
          { itemId: semCusto.id, quantity: "0.05", unitCode: "kg" },
        ],
      },
    });
    expect(editada.statusCode, editada.body).toBe(200);
    const ativada = await app.inject({ method: "POST", url: `/formulation-versions/${novaFormulacao.json().id}/activate` });
    expect(ativada.statusCode, ativada.body).toBe(200);

    // O mundo mudou: o mesmo produto, precificado AGORA pela política nova, forma o preço sobre base incompleta.
    const agora = await app.inject({
      method: "POST",
      url: `/products/${alvo.productId}/pricing/policy-preview`,
      payload: { pricingPolicyVersionId: v2.id, industrialCostCalculationId: calcNovo.id },
    });
    expect(agora.statusCode, agora.body).toBe(200);
    expect(INCOMPLETAS).toContain(agora.json().tiers[0].costQuality);

    // A faixa ativa não: nem no banco, nem na leitura, nem no envio.
    const depois = await qualidadesCongeladas(tier.id);
    expect(depois.pricingCostQualitySnapshot).toBe(congelado.pricingCostQualitySnapshot);
    expect(depois.costQualitySnapshot).toBe(congelado.costQualitySnapshot);
    expect(depois.selectedPriceSnapshot?.toString()).toBe(congelado.selectedPriceSnapshot?.toString());
    const leitura = (await app.inject({ method: "GET", url: `/pricing-versions/${prec.id}` })).json().tiers[0];
    expect(leitura.pricingCostQuality).toBe(tier.pricingCostQuality);
    expect(leitura.costQuality).toBe(tier.costQuality);

    const quoteId = await orcamentoComFaixa(alvo.projectId, tier.id);
    expect(await proveniencia(quoteId)).toMatchObject({ pricingCostQuality: tier.pricingCostQuality });
    const enviado = await enviar(quoteId);
    expect(enviado.statusCode, enviado.body).toBe(200);
  }, 60_000);

  describe("a qualidade do custo do preço manda; nula (faixa antiga), vale a do cálculo", () => {
    let alvo: Alvo;
    let pricingVersionId: string;
    let tierId: string;

    beforeAll(async () => {
      alvo = await produtoCalculado({ energia: true });
      const prec = await precificacaoPadrao(alvo, { confirmar: false });
      pricingVersionId = prec.id;
      tierId = prec.tiers[0].id;
    }, 30_000);

    it.each([
      ["preço completo, cálculo parcial", "COMPLETE_REAL_REFERENCE", "PARTIAL", false],
      ["preço com estimativas, cálculo sem custo", "COMPLETE_WITH_ESTIMATES", "NO_COST", false],
      ["preço parcial, cálculo completo", "PARTIAL", "COMPLETE_REAL_REFERENCE", true],
      ["preço sem custo, cálculo completo", "NO_COST", "COMPLETE_REAL_REFERENCE", true],
      ["faixa antiga (nula), cálculo parcial", null, "PARTIAL", true],
      ["faixa antiga (nula), cálculo sem custo", null, "NO_COST", true],
      ["faixa antiga (nula), cálculo completo", null, "COMPLETE_REAL_REFERENCE", false],
    ] as const)("%s", async (_caso, doPreco, doCalculo, pedeConfirmacao) => {
      // A faixa ativa com as qualidades do caso; nula é como a migration deixou as de antes.
      await getPrisma().pricingTier.update({
        where: { id: tierId },
        data: { pricingCostQualitySnapshot: doPreco, costQualitySnapshot: doCalculo },
      });

      const leitura = (await app.inject({ method: "GET", url: `/pricing-versions/${pricingVersionId}` })).json()
        .tiers[0];
      expect(leitura.costQuality).toBe(doCalculo);
      if (doPreco === null) expect(leitura).not.toHaveProperty("pricingCostQuality");
      else expect(leitura.pricingCostQuality).toBe(doPreco);

      const quoteId = await orcamentoComFaixa(alvo.projectId, tierId);
      expect(await proveniencia(quoteId)).toMatchObject({ pricingCostQuality: doPreco, costQuality: doCalculo });

      const semConfirmar = await enviar(quoteId);
      if (pedeConfirmacao) {
        expect(semConfirmar.statusCode, semConfirmar.body).toBe(409);
        expect(semConfirmar.json().error).toBe("incomplete_cost");
        const confirmado = await enviar(quoteId, { confirmIncompleteCost: true });
        expect(confirmado.statusCode, confirmado.body).toBe(200);
      } else {
        expect(semConfirmar.statusCode, semConfirmar.body).toBe(200);
      }
    });
  });
});
