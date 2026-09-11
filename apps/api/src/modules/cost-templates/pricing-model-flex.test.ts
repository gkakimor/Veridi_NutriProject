import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { instanteNoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * Modelo de Precificação flexível — PRICING-TEMPLATE-FLEX-01, `PRODUCT_RULES.md` §84.
 *
 * Produto de referência: lote de 1.000 un, 0,1 kg de insumo a R$ 10/kg por
 * unidade (materiais) e mão de obra + energia na Estrutura de Custos
 * (conversão). Cada Modelo muda SÓ o que entra no custo que forma o preço — e
 * o custo de materiais e o do cálculo inteiro são lidos pelo próprio motor,
 * não copiados para o teste.
 */

type App = ReturnType<typeof buildTestApp>;
interface Alvo {
  product: { id: string };
  calc: { id: string; quality: string };
}
interface PreviaFaixa {
  costPerUnit: string | null;
  suggestedUnitPrice: string | null;
  estimatedTaxPercent: string | null;
  costQuality: string;
  warning: string | null;
}

const D = (valor: string | number) => new Prisma.Decimal(valor);

/** Igual até a oitava casa — o preço técnico tem oito; o custo servido, doze. */
function perto(valor: string | Prisma.Decimal | null, esperado: string | Prisma.Decimal) {
  expect(valor, `esperado ${esperado.toString()}`).not.toBeNull();
  const diferenca = D(valor!.toString()).minus(D(esperado.toString())).abs();
  expect(diferenca.lessThan("0.00000002"), `${valor!.toString()} ≈ ${esperado.toString()}`).toBe(true);
}

const ids = {
  products: [] as string[],
  items: [] as string[],
  resources: [] as string[],
  policies: [] as string[],
  suppliers: [] as string[],
  purchaseOrders: [] as string[],
  receipts: [] as string[],
  customers: [] as string[],
};

let app: App;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  // Só o que ESTE arquivo criou — o banco é compartilhado com o app local.
  if (ids.products.length > 0) {
    const doProduto = { productId: { in: ids.products } };
    await prisma.pricingTier.deleteMany({ where: { pricingVersion: doProduto } });
    await prisma.pricingVersion.deleteMany({ where: doProduto });
    await prisma.industrialCostCalculation.deleteMany({ where: doProduto });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: doProduto },
    });
    await prisma.industrialCostLine.deleteMany({ where: { industrialCostVersion: doProduto } });
    await prisma.industrialCostVersion.deleteMany({ where: doProduto });
    await prisma.formulationComponent.deleteMany({ where: { formulationVersion: doProduto } });
    await prisma.formulationVersion.deleteMany({ where: doProduto });
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  }
  if (ids.policies.length > 0) {
    await prisma.pricingPolicyTemplate.deleteMany({ where: { id: { in: ids.policies } } });
  }
  if (ids.resources.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: ids.resources } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: ids.resources } } });
  }
  if (ids.receipts.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: ids.receipts } } });
    await prisma.receipt.deleteMany({ where: { id: { in: ids.receipts } } });
  }
  if (ids.purchaseOrders.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: ids.purchaseOrders } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ids.purchaseOrders } } });
  }
  if (ids.items.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids.items } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: ids.items } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  }
  if (ids.suppliers.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: ids.suppliers } } });
  }
  if (ids.customers.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  }
});

/** Compra recebida com custo informado — é daí que nasce o custo do material. */
async function receberComCusto(itemId: string, unitCost: string) {
  const m = marker();
  const supplier = await getPrisma().supplier.create({
    data: { code: `FOR-FLEX-${m}`, legalName: `Fornecedor FLEX ${m}`, active: true },
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
      payload: { name: `DEMO FLEX ${type} ${marker()}`, type },
    })
  ).json();
  ids.resources.push(recurso.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${recurso.id}/rates`,
    payload: { rateValue },
  });
  return recurso;
}

/** Produto com formulação ativa: 0,1 kg de insumo por unidade, insumo a R$ 10/kg. */
async function criarProduto(customerId?: string) {
  const prisma = getPrisma();
  const m = marker();
  const item = (type: "FINISHED_PRODUCT" | "RAW_MATERIAL", code: string, unitCode: string) =>
    prisma.item.create({
      data: {
        type,
        code,
        name: `${code} FLEX`,
        unitCode,
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
        active: true,
      },
    });
  const acabado = await item("FINISHED_PRODUCT", `PA-FLEX-${m}`, "un");
  const material = await item("RAW_MATERIAL", `MP-FLEX-${m}`, "kg");
  ids.items.push(acabado.id, material.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: customerId ?? (await fixtureCustomerId()),
        name: `Produto FLEX ${m}`,
        finishedProductItemId: acabado.id,
      },
    })
  ).json();
  ids.products.push(product.id);

  const formulacao = (
    await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulacao.id}`,
    payload: { basisQuantity: "1", components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }] },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulacao.id}/activate` });
  await receberComCusto(material.id, "10");
  return { product };
}

/** Estrutura com mão de obra — e energia, quando pedida. Sem energia o cálculo é PARCIAL. */
async function produtoComCusto(opcoes: { energia: boolean }): Promise<Alvo> {
  const mao = await criarRecurso("LABOR", "40");
  const { product } = await criarProduto();
  const ec = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
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
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${ec.id}/activate`,
    payload: { confirmIncomplete: true },
  });
  const calc = (
    await app.inject({ method: "POST", url: `/industrial-costs/${ec.id}/calculations`, payload: {} })
  ).json();
  return { product, calc };
}

async function criarModelo(
  opcoes: {
    nome?: string;
    faixas?: { quantity: string; margem: string; comissao?: string }[];
    pricingModel?: Record<string, unknown>;
    applicableTaxProfiles?: string[];
    ativar?: boolean;
  } = {},
) {
  const policy = (
    await app.inject({
      method: "POST",
      url: "/pricing-policies",
      payload: { name: opcoes.nome ?? `DEMO Modelo flex ${marker()}` },
    })
  ).json();
  ids.policies.push(policy.id);
  const versionId = policy.draftVersion.id as string;
  const salvo = await app.inject({
    method: "PATCH",
    url: `/pricing-policy-versions/${versionId}`,
    payload: {
      tiers: (opcoes.faixas ?? [{ quantity: "1000", margem: "35" }]).map((faixa) => ({
        quantity: faixa.quantity,
        targetContributionMarginPercent: faixa.margem,
        commissionPercent: faixa.comissao ?? "5",
      })),
      ...(opcoes.pricingModel ? { pricingModel: opcoes.pricingModel } : {}),
      ...(opcoes.applicableTaxProfiles ? { applicableTaxProfiles: opcoes.applicableTaxProfiles } : {}),
    },
  });
  expect(salvo.statusCode, salvo.body).toBe(200);
  if (opcoes.ativar === false) return { versionId, version: salvo.json() };
  const ativa = await app.inject({ method: "POST", url: `/pricing-policy-versions/${versionId}/activate` });
  expect(ativa.statusCode, ativa.body).toBe(200);
  return { versionId, version: ativa.json() };
}

/** A primeira faixa da prévia: o que o Modelo produziria NESTE produto. */
async function faixa(versionId: string, alvo: Alvo): Promise<PreviaFaixa> {
  const resposta = await app.inject({
    method: "POST",
    url: `/products/${alvo.product.id}/pricing/policy-preview`,
    payload: { pricingPolicyVersionId: versionId, industrialCostCalculationId: alvo.calc.id },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json().tiers[0];
}

describe("Modelo de Precificação flexível — PRICING-TEMPLATE-FLEX-01", () => {
  let base: Alvo;
  /** Custo por unidade dos materiais e do cálculo inteiro, lidos pelo motor. */
  let materiais: Prisma.Decimal;
  let calculado: Prisma.Decimal;

  beforeAll(async () => {
    base = await produtoComCusto({ energia: true });
    const ignorar = await criarModelo({ pricingModel: { industrialCostMode: "IGNORE" } });
    materiais = D((await faixa(ignorar.versionId, base)).costPerUnit!);
    const padrao = await criarModelo();
    calculado = D((await faixa(padrao.versionId, base)).costPerUnit!);
  });

  it("regressão: Modelo sem configuração = custo do cálculo e o MESMO preço de antes", async () => {
    const { versionId, version } = await criarModelo();
    expect(version.pricingModel).toEqual({
      industrialCostMode: "CALCULATED",
      industrialCostPercentOfMaterials: null,
      industrialCostAmountPerUnit: null,
      industrialCostAmountTotal: null,
      estimatedTaxMode: "IGNORE",
      estimatedTaxPercentOfSalePrice: null,
      estimatedTaxAmountPerUnit: null,
      estimatedTaxAmountTotal: null,
      externalAdditionalCosts: false,
    });
    expect(version.applicableTaxProfiles).toEqual([]);

    const aplicada = await app.inject({
      method: "POST",
      url: `/products/${base.product.id}/pricing/from-policy`,
      payload: { pricingPolicyVersionId: versionId, industrialCostCalculationId: base.calc.id },
    });
    expect(aplicada.statusCode, aplicada.body).toBe(201);
    expect(aplicada.json().pricingModel.industrialCostMode).toBe("CALCULATED");
    const tier = aplicada.json().tiers[0];
    // O custo que forma o preço É o custo do cálculo, e o preço é o de sempre.
    expect(tier.pricingCostPerUnit).toBe(tier.industrialCostPerUnit);
    expect(tier.estimatedTaxPercent).toBeNull();
    perto(tier.suggestedUnitPrice, D(tier.industrialCostPerUnit).dividedBy("0.6"));
  });

  it("custo industrial: IGNORE, % sobre materiais, R$ por unidade e R$ total", async () => {
    expect(materiais.greaterThan(0)).toBe(true);
    expect(calculado.greaterThan(materiais)).toBe(true);

    const percentual = await criarModelo({
      pricingModel: { industrialCostMode: "PERCENT_MATERIAL_COST", industrialCostPercentOfMaterials: "12" },
    });
    // Vírgula aceita na fronteira, como no resto do ERP.
    const porUnidade = await criarModelo({
      pricingModel: { industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: "0,5" },
    });
    const total = await criarModelo({
      pricingModel: { industrialCostMode: "TOTAL", industrialCostAmountTotal: "300" },
    });

    const comPercentual = await faixa(percentual.versionId, base);
    perto(comPercentual.costPerUnit, materiais.times("1.12"));
    perto(comPercentual.suggestedUnitPrice, D(comPercentual.costPerUnit!).dividedBy("0.6"));
    perto((await faixa(porUnidade.versionId, base)).costPerUnit, materiais.plus("0.5"));
    // R$ 300 uma vez sobre 1.000 un: R$ 0,30 por unidade.
    perto((await faixa(total.versionId, base)).costPerUnit, materiais.plus("0.3"));
  });

  it("impostos: IGNORE, % sobre a venda no divisor, R$ por unidade e R$ total no custo", async () => {
    const percentual = await criarModelo({
      pricingModel: { estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "10" },
    });
    const porUnidade = await criarModelo({
      pricingModel: { estimatedTaxMode: "PER_UNIT", estimatedTaxAmountPerUnit: "0.2" },
    });
    const total = await criarModelo({
      pricingModel: { estimatedTaxMode: "TOTAL", estimatedTaxAmountTotal: "100" },
    });
    // Valor guardado em modo desligado não entra.
    const ignorar = await criarModelo({
      pricingModel: { estimatedTaxMode: "IGNORE", estimatedTaxAmountPerUnit: "9" },
    });

    const comPercentual = await faixa(percentual.versionId, base);
    perto(comPercentual.costPerUnit, calculado);
    expect(comPercentual.estimatedTaxPercent).toBe("10.0000");
    // P = C ÷ (1 − 35% − 5% − 10%).
    perto(comPercentual.suggestedUnitPrice, calculado.dividedBy("0.5"));

    perto((await faixa(porUnidade.versionId, base)).costPerUnit, calculado.plus("0.2"));
    perto((await faixa(total.versionId, base)).costPerUnit, calculado.plus("0.1"));
    const semImposto = await faixa(ignorar.versionId, base);
    perto(semImposto.costPerUnit, calculado);
    expect(semImposto.estimatedTaxPercent).toBeNull();
  });

  it("gestão externa: valores ficam fora da conta; desligada, voltam — nada é apagado", async () => {
    const configurado = {
      industrialCostMode: "PERCENT_MATERIAL_COST",
      industrialCostPercentOfMaterials: "12",
      estimatedTaxMode: "PERCENT_SALE_PRICE",
      estimatedTaxPercentOfSalePrice: "10",
    };
    const externo = await criarModelo({ pricingModel: { ...configurado, externalAdditionalCosts: true } });
    const fora = await faixa(externo.versionId, base);
    perto(fora.costPerUnit, materiais);
    expect(fora.estimatedTaxPercent).toBeNull();
    // Margem e comissão continuam no preço.
    perto(fora.suggestedUnitPrice, materiais.dividedBy("0.6"));

    const guardado = (
      await app.inject({ method: "GET", url: `/pricing-policy-versions/${externo.versionId}` })
    ).json();
    expect(guardado.pricingModel).toMatchObject({
      industrialCostPercentOfMaterials: "12",
      estimatedTaxPercentOfSalePrice: "10",
      externalAdditionalCosts: true,
    });

    // A versão nova parte do Modelo inteiro; desligar a gestão externa devolve os valores à conta.
    const v2 = (
      await app.inject({ method: "POST", url: `/pricing-policy-versions/${externo.versionId}/new-version` })
    ).json();
    expect(v2.pricingModel).toMatchObject({
      industrialCostPercentOfMaterials: "12",
      estimatedTaxPercentOfSalePrice: "10",
      externalAdditionalCosts: true,
    });
    const desligado = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${v2.id}`,
      payload: { pricingModel: { externalAdditionalCosts: false } },
    });
    expect(desligado.statusCode, desligado.body).toBe(200);
    await app.inject({ method: "POST", url: `/pricing-policy-versions/${v2.id}/activate` });

    const dentro = await faixa(v2.id, base);
    perto(dentro.costPerUnit, materiais.times("1.12"));
    expect(dentro.estimatedTaxPercent).toBe("10.0000");
    perto(dentro.suggestedUnitPrice, materiais.times("1.12").dividedBy("0.5"));
  });

  it("valores preservados: trocar de modo não apaga o valor do modo anterior", async () => {
    const { versionId } = await criarModelo({
      pricingModel: { industrialCostMode: "PERCENT_MATERIAL_COST", industrialCostPercentOfMaterials: "12" },
      ativar: false,
    });
    const trocado = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${versionId}`,
      payload: { pricingModel: { industrialCostMode: "IGNORE" } },
    });
    expect(trocado.statusCode, trocado.body).toBe(200);
    expect(trocado.json().pricingModel).toMatchObject({
      industrialCostMode: "IGNORE",
      industrialCostPercentOfMaterials: "12",
    });
    const religado = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${versionId}`,
      payload: { pricingModel: { industrialCostMode: "PERCENT_MATERIAL_COST" } },
    });
    expect(religado.statusCode, religado.body).toBe(200);
    expect(religado.json().pricingModel).toMatchObject({
      industrialCostMode: "PERCENT_MATERIAL_COST",
      industrialCostPercentOfMaterials: "12",
    });
  });

  it("validação: modo sem valor, NaN, Infinity, texto, sinal e casas demais → 400", async () => {
    const { versionId } = await criarModelo({ ativar: false });
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: "PATCH", url: `/pricing-policy-versions/${versionId}`, payload });

    const semValor = await patch({ pricingModel: { industrialCostMode: "PER_UNIT" } });
    expect(semValor.statusCode).toBe(400);
    expect(semValor.json().error).toBe("invalid_pricing_model");
    expect(semValor.json().message).toMatch(/informe o valor/);

    for (const valor of ["NaN", "Infinity", "abc", "-1", "1e3"]) {
      const recusado = await patch({ pricingModel: { industrialCostAmountPerUnit: valor } });
      expect(recusado.statusCode, `${valor}: ${recusado.body}`).toBe(400);
    }
    expect((await patch({ pricingModel: { estimatedTaxPercentOfSalePrice: "12.12345" } })).statusCode).toBe(400);
    const cem = await patch({ pricingModel: { estimatedTaxPercentOfSalePrice: "100" } });
    expect(cem.statusCode).toBe(400);
    expect(cem.json().message).toMatch(/abaixo de 100%/);
    expect((await patch({ pricingModel: { desconhecido: "1" } })).statusCode).toBe(400);
    expect((await patch({ applicableTaxProfiles: ["NOT_INFORMED"] })).statusCode).toBe(400);

    // Nada disso gravou: o Modelo continua o padrão.
    const intacto = (
      await app.inject({ method: "GET", url: `/pricing-policy-versions/${versionId}` })
    ).json();
    expect(intacto.pricingModel).toMatchObject({
      industrialCostMode: "CALCULATED",
      industrialCostAmountPerUnit: null,
      estimatedTaxPercentOfSalePrice: null,
    });
    expect(intacto.applicableTaxProfiles).toEqual([]);
  });

  it("denominador: margem + comissão + imposto sobre a venda ≥ 100% é recusado ao salvar", async () => {
    const { versionId } = await criarModelo({
      faixas: [{ quantity: "1000", margem: "60", comissao: "5" }],
      ativar: false,
    });
    const recusado = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${versionId}`,
      payload: {
        pricingModel: { estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "35" },
      },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("invalid_pricing_model");
    expect(recusado.json().message).toMatch(/Faixa de 1000: .*somam 100% ou mais/);

    const aceito = await app.inject({
      method: "PATCH",
      url: `/pricing-policy-versions/${versionId}`,
      payload: {
        pricingModel: { estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "34.9999" },
      },
    });
    expect(aceito.statusCode, aceito.body).toBe(200);
  });

  it("fora da conta não trava: IGNORE forma preço com energia sem tarifa e ativa sem confirmação", async () => {
    const semEnergia = await produtoComCusto({ energia: false });
    expect(["PARTIAL", "NO_COST"]).toContain(semEnergia.calc.quality);

    // A regra de sempre continua: custo do cálculo incompleto não vira preço.
    const padrao = await criarModelo();
    expect((await faixa(padrao.versionId, semEnergia)).suggestedUnitPrice).toBeNull();

    const ignorar = await criarModelo({ pricingModel: { industrialCostMode: "IGNORE" } });
    const previa = await faixa(ignorar.versionId, semEnergia);
    expect(previa.suggestedUnitPrice).not.toBeNull();
    expect(previa.costQuality).not.toBe("PARTIAL");

    const aplicada = await app.inject({
      method: "POST",
      url: `/products/${semEnergia.product.id}/pricing/from-policy`,
      payload: { pricingPolicyVersionId: ignorar.versionId, industrialCostCalculationId: semEnergia.calc.id },
    });
    expect(aplicada.statusCode, aplicada.body).toBe(201);
    expect(aplicada.json().pricingModel.industrialCostMode).toBe("IGNORE");

    const ativada = await app.inject({
      method: "POST",
      url: `/pricing-versions/${aplicada.json().id}/activate`,
      payload: {},
    });
    expect(ativada.statusCode, ativada.body).toBe(200);
    const tier = ativada.json().tiers[0];
    // Congelado com o custo que formou o preço; o do cálculo continua dizendo que é incompleto.
    perto(tier.pricingCostPerUnit, D(previa.costPerUnit!));
    expect(tier.industrialCostPerUnit).toBeNull();
    expect(tier.estimatedTaxPercent).toBeNull();
    perto(tier.selectedUnitPrice, D(previa.costPerUnit!).dividedBy("0.6"));
  });

  it("perfil tributário: a lista para um produto diz a compatibilidade e não esconde nenhuma", async () => {
    const tag = marker();
    const cliente = await getPrisma().customer.create({
      data: {
        code: `CLI-FLEX-${tag}`,
        legalName: `Cliente Simples ${tag}`,
        active: true,
        taxProfile: "SIMPLES_NACIONAL",
      },
    });
    ids.customers.push(cliente.id);
    const { product } = await criarProduto(cliente.id);
    await criarModelo({ nome: `DEMO Perfil ${tag} A`, applicableTaxProfiles: ["SIMPLES_NACIONAL"] });
    await criarModelo({ nome: `DEMO Perfil ${tag} B`, applicableTaxProfiles: ["LUCRO_REAL"] });
    await criarModelo({ nome: `DEMO Perfil ${tag} C` });

    const busca = encodeURIComponent(`DEMO Perfil ${tag}`);
    const lista = await app.inject({
      method: "GET",
      url: `/pricing-policies?search=${busca}&productId=${product.id}`,
    });
    expect(lista.statusCode, lista.body).toBe(200);
    expect(lista.json().customerTaxProfile).toBe("SIMPLES_NACIONAL");
    const indicacao = Object.fromEntries(
      lista.json().policies.map((policy: { name: string; taxProfileFit: string }) => [
        policy.name.slice(-1),
        policy.taxProfileFit,
      ]),
    );
    expect(indicacao).toEqual({ A: "COMPATIBLE", B: "NOT_RECOMMENDED", C: "UNRESTRICTED" });

    // Sem produto, a lista não opina.
    const semProduto = (
      await app.inject({ method: "GET", url: `/pricing-policies?search=${busca}` })
    ).json();
    expect(semProduto.customerTaxProfile).toBeNull();
    expect(
      semProduto.policies.every((policy: { taxProfileFit: string | null }) => policy.taxProfileFit === null),
    ).toBe(true);
  });
});
