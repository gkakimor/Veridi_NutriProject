import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getProductCmv } from "./product-cmv.service.js";
import { costForOutputQuantity, pricingVersionInclude } from "../pricing/pricing-cost.js";
import type { CostVersionForPricing } from "../pricing/pricing-cost.js";
import { getIndustrialCostCalculation } from "../industrial-cost-calculation/snapshot.service.js";

/**
 * CMV e faixa de precificação precisam responder o MESMO número.
 *
 * São duas superfícies da mesma pergunta econômica. Se um dia alguém
 * "otimizar" o CMV com uma conta própria, este teste quebra — que é
 * exatamente o ponto: existe um motor só.
 *
 * Cada caso monta o próprio cenário.
 *
 * Antes, este arquivo garimpava o banco compartilhado: "a estrutura ativa
 * mais recente", "algum produto com custo", "alguma precificação com
 * faixas". Custou duas coisas. O resultado dependia de quem tinha rodado o
 * quê — a mesma suíte passava e falhava sem nenhuma mudança de código. E os
 * `if (!x) return` espalhados transformavam banco vazio em aprovação
 * silenciosa: um teste que não achou cenário reportava verde. Com fixture
 * própria as duas bases são conhecidas, as asserções valem sempre e ninguém
 * lê nem apaga dado alheio.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

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
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-CMV-${m}`,
      name: `Item CMV ${m}`,
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

/** Custo de material nasce de compra recebida — nunca digitado no item. */
async function receberComCusto(app: App, itemId: string, unitCost: string) {
  const m = marker();
  const supplier = await getPrisma().supplier.create({
    data: { code: `FOR-CMV-${m}`, legalName: `Fornecedor CMV ${m}`, active: true },
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
            supplierLot: `SUP-CMV-${m}`,
            actualUnitCost: unitCost,
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
}

async function criarRecurso(app: App, type: "LABOR" | "ENERGY", rate: string) {
  const recurso = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Recurso CMV ${type} ${marker()}`, type },
    })
  ).json();
  fixtureResourceIds.push(recurso.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${recurso.id}/rates`,
    payload: { rateValue: rate },
  });
  return recurso;
}

interface CenarioOptions {
  /** Horas de mão de obra por lote de referência — recurso que não dilui. */
  laborHoursPerBatch?: string;
  laborRate?: string;
  /** Segundo componente fornecido pelo cliente. */
  comMaterialDoCliente?: boolean;
  referenceOutputQuantity?: string;
}

/**
 * Produto + formulação ativa + estrutura ativa + CALC salvo.
 *
 * Devolve também a data de referência do cálculo. É ela que os casos usam:
 * uma data constante mentiria assim que o relógio do ambiente mudasse.
 */
async function criarCenario(app: App, options: CenarioOptions = {}) {
  const m = marker();
  const acabado = await criarItem("FINISHED_PRODUCT", "un");
  const material = await criarItem("RAW_MATERIAL");
  const doCliente = options.comMaterialDoCliente ? await criarItem("RAW_MATERIAL") : null;

  /*
   * Material do cliente exige produto com cliente: a regra recusa ativar a
   * formulação sem ele, e é a regra que manda — não o teste.
   */
  let customerId: string | undefined;
  if (options.comMaterialDoCliente) {
    const customer = (
      await app.inject({
        method: "POST",
        url: "/customers",
        payload: { legalName: `Cliente CMV ${m}` },
      })
    ).json();
    fixtureCustomerIds.push(customer.id);
    customerId = customer.id;
  }

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto CMV ${m}`,
        finishedProductItemId: acabado.id,
        customerId: customerId ?? (await fixtureCustomerId()),
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
  const patchForm = await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulation.id}`,
    payload: {
      basisQuantity: "1",
      components: [
        { itemId: material.id, quantity: "0.01", unitCode: "kg" },
        ...(doCliente
          ? [
              {
                itemId: doCliente.id,
                quantity: "0.005",
                unitCode: "kg",
                supplyResponsibility: "CUSTOMER",
              },
            ]
          : []),
      ],
    },
  });
  if (patchForm.statusCode >= 300) {
    throw new Error(`PATCH FORM ${patchForm.statusCode}: ${patchForm.body}`);
  }
  /*
   * Cada passo da montagem confere o status.
   *
   * Sem isso um passo que falha só reaparece muito depois, como "Invalid
   * time value" ou "estrutura não encontrada: undefined", e o teste parece
   * quebrado por outro motivo. Falhar onde falhou é mais barato.
   */
  const ativacao = await app.inject({
    method: "POST",
    url: `/formulation-versions/${formulation.id}/activate`,
  });
  if (ativacao.statusCode >= 300) {
    throw new Error(`ATIVAR FORM ${ativacao.statusCode}: ${ativacao.body}`);
  }

  await receberComCusto(app, material.id, "10");
  // Material do cliente também tem compra: o teste precisa provar que o CMV
  // o mantém fora da aquisição Veridi mesmo havendo custo conhecido.
  if (doCliente) await receberComCusto(app, doCliente.id, "40");

  const respostaVersao = await app.inject({
    method: "POST",
    url: `/products/${product.id}/industrial-costs`,
    payload: { referenceOutputQuantity: options.referenceOutputQuantity ?? "1000" },
  });
  if (respostaVersao.statusCode >= 300) {
    throw new Error(`EC ${respostaVersao.statusCode}: ${respostaVersao.body}`);
  }
  const version = respostaVersao.json();

  // Energia informada diretamente por unidade: fecha o custo sem interferir
  // na aritmética de lote que alguns casos verificam.
  const energia = await criarRecurso(app, "ENERGY", "1");
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/resource-usages`,
    payload: { resourceId: energia.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
  });

  if (options.laborHoursPerBatch) {
    const labor = await criarRecurso(app, "LABOR", options.laborRate ?? "30");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: {
        resourceId: labor.id,
        usageQuantity: options.laborHoursPerBatch,
        usageBasis: "FIXED_PER_REFERENCE_BATCH",
      },
    });
  }

  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/activate`,
    payload: { confirmIncomplete: true },
  });

  const respostaCalculo = await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/calculations`,
    payload: {},
  });
  if (respostaCalculo.statusCode >= 300) {
    throw new Error(`CALC ${respostaCalculo.statusCode}: ${respostaCalculo.body}`);
  }
  const calculation = respostaCalculo.json();

  return {
    product,
    version,
    calculation,
    material,
    materialDoCliente: doCliente,
    referenceDate: new Date(calculation.costReferenceDate),
  };
}

async function criarPrecificacaoComFaixas(
  app: App,
  productId: string,
  calculationId: string,
  quantidades: string[],
) {
  const pricing = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/pricing`,
      payload: { industrialCostCalculationId: calculationId },
    })
  ).json();
  for (const quantity of quantidades) {
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/tiers`,
      payload: {
        quantity,
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: "30",
        commissionPercent: "5",
      },
    });
  }
  await app.inject({ method: "POST", url: `/pricing-versions/${pricing.id}/activate` });
  return (await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}` })).json();
}

describe("CMV — motor único", () => {
  it("simulação do CMV e motor da precificação dão o mesmo custo para a mesma base", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const cenario = await criarCenario(app);

    const costVersion = (await prisma.industrialCostVersion.findUniqueOrThrow({
      where: { id: cenario.version.id },
      include: pricingVersionInclude,
    })) as unknown as CostVersionForPricing;

    const quantity = new Prisma.Decimal(1000);
    const calculation = await getIndustrialCostCalculation(cenario.calculation.id);
    const direto = await costForOutputQuantity(prisma, {
      costVersion,
      calculation,
      quantity,
      quantityUomCode: "un",
    });

    const via = await getProductCmv({
      productId: cenario.product.id,
      quantity,
      referenceDate: cenario.referenceDate,
      includePricing: true,
    });

    expect(via.simulation).not.toBeNull();
    expect(via.simulation!.quality).toBe(direto.quality);
    expect(via.simulation!.knownSubtotal).toBe(direto.knownSubtotal.toFixed(4));
    expect(via.simulation!.totalCost).toBe(direto.total ? direto.total.toFixed(4) : null);
    expect(via.simulation!.costPerUnit).toBe(direto.perUnit ? direto.perUnit.toFixed(4) : null);
    expect(via.simulation!.batchCount).toBe(direto.batchCount.toString());

    await app.close();
  });

  it("simular não persiste nada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const cenario = await criarCenario(app);
    // Contagem do PRÓPRIO produto: um total global mudaria por causa de
    // qualquer outro teste rodando ao lado, e o caso viraria loteria.
    const escopo = { productId: cenario.product.id };
    const antes = await prisma.industrialCostCalculation.count({ where: escopo });

    await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(777),
      referenceDate: cenario.referenceDate,
      includePricing: true,
    });

    expect(await prisma.industrialCostCalculation.count({ where: escopo })).toBe(antes);
    await app.close();
  });

  it("faixa vigente só casa por quantidade exata — nunca interpola", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cenario = await criarCenario(app);
    const pricing = await criarPrecificacaoComFaixas(
      app,
      cenario.product.id,
      cenario.calculation.id,
      ["500", "3000"],
    );
    expect(pricing.tiers).toHaveLength(2);

    const exata = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(500),
      referenceDate: cenario.referenceDate,
      includePricing: true,
    });
    expect(exata.pricing?.tierQuantity).toBe("500");

    // 1750 está entre 500 e 3000 e não é faixa: não existe preço vigente.
    const semFaixa = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1750),
      referenceDate: cenario.referenceDate,
      includePricing: true,
    });
    expect(semFaixa.pricing?.tierId).toBeNull();
    expect(semFaixa.pricing?.unitPrice).toBeNull();
    // O CMV segue calculável, e a tela sabe quais quantidades têm preço.
    expect(semFaixa.pricing?.availableQuantities).toEqual(["500", "3000"]);
    expect(semFaixa.simulation).not.toBeNull();

    await app.close();
  });

  it("material do cliente mantém quantidade física e fica fora da aquisição Veridi", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cenario = await criarCenario(app, { comMaterialDoCliente: true });
    const cmv = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1000),
      referenceDate: cenario.referenceDate,
      includePricing: false,
    });

    const doCliente = (cmv.simulation?.components ?? []).filter((c) => c.customerSupplied);
    // O cenário tem exatamente um: garimpar deixava a lista vazia passar.
    expect(doCliente).toHaveLength(1);
    expect(doCliente[0]!.itemId).toBe(cenario.materialDoCliente!.id);
    for (const componente of doCliente) {
      expect(componente.requiredQuantity).not.toBeNull();
      // Tem custo de compra conhecido e ainda assim não entra: o material é
      // do cliente, Veridi não o adquire.
      expect(componente.totalCost).toBeNull();
      expect(componente.group).toBe("CUSTOMER_SUPPLIED");
    }

    await app.close();
  });

  it("economia interna só chega a quem pode ver", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cenario = await criarCenario(app);
    await criarPrecificacaoComFaixas(app, cenario.product.id, cenario.calculation.id, ["1000"]);

    const semPermissao = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1000),
      referenceDate: cenario.referenceDate,
      includePricing: false,
    });
    expect(semPermissao.pricing).toBeNull();
    // O custo industrial continua visível: quem produz precisa dele.
    expect(semPermissao.simulation).not.toBeNull();

    // E com permissão o preço aparece — senão o caso acima provaria só que
    // a precificação não existe.
    const comPermissao = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1000),
      referenceDate: cenario.referenceDate,
      includePricing: true,
    });
    expect(comPermissao.pricing).not.toBeNull();

    await app.close();
  });

  it("referenceDate escolhe a base: antes de existir cálculo, não há CMV", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cenario = await criarCenario(app);

    const antes = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1000),
      // Anterior a qualquer cálculo salvo: naquele dia ninguém sabia o custo.
      referenceDate: new Date("2020-01-01T00:00:00.000Z"),
      includePricing: true,
    });
    expect(antes.simulation).toBeNull();
    expect(antes.unavailableReason).toMatch(/cálculo de custo salvo até esta data/i);

    const hoje = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1000),
      referenceDate: cenario.referenceDate,
      includePricing: true,
    });
    expect(hoje.simulation).not.toBeNull();
    expect(hoje.calculationCode).toBe(cenario.calculation.code);

    await app.close();
  });

  it("recurso por lote não se dilui abaixo de um lote e acompanha a contagem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // 2 h × R$ 30 = R$ 60 por lote de 1.000 — valor conhecido, não garimpado.
    const cenario = await criarCenario(app, { laborHoursPerBatch: "2", laborRate: "30" });
    const base = new Prisma.Decimal(1000);

    const um = await getProductCmv({
      productId: cenario.product.id,
      quantity: base,
      referenceDate: cenario.referenceDate,
      includePricing: false,
    });
    const tres = await getProductCmv({
      productId: cenario.product.id,
      quantity: base.times(3),
      referenceDate: cenario.referenceDate,
      includePricing: false,
    });
    expect(um.simulation).not.toBeNull();
    expect(tres.simulation).not.toBeNull();

    expect(um.simulation!.batchCount).toBe("1");
    expect(tres.simulation!.batchCount).toBe("3");

    const recursos = (r: typeof um) =>
      (r.simulation?.components ?? [])
        .filter((c) => c.group === "INDUSTRIAL_RESOURCE")
        .reduce(
          (total, c) => total.plus(new Prisma.Decimal(c.totalCost ?? 0)),
          new Prisma.Decimal(0),
        );

    // Três lotes custam três vezes o recurso de um lote — nunca o de um só.
    expect(recursos(tres).equals(recursos(um).times(3))).toBe(true);
    expect(recursos(um).greaterThan(0)).toBe(true);

    await app.close();
  });

  it("quantidade inválida e zero explícito são coisas diferentes de desconhecido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cenario = await criarCenario(app);
    const cmv = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(1000),
      referenceDate: cenario.referenceDate,
      includePricing: false,
    });

    expect(cmv.simulation?.components.length).toBeGreaterThan(0);
    for (const componente of cmv.simulation?.components ?? []) {
      // Custo desconhecido é `null`. Zero, quando existir, é um valor.
      if (componente.totalCost !== null) expect(componente.totalCost).toMatch(/^\d+\.\d{4}$/);
    }
    // Subtotal conhecido existe mesmo quando o total não existe.
    expect(cmv.simulation?.knownSubtotal).toMatch(/^\d+\.\d{4}$/);

    await app.close();
  });
});

/**
 * O divisor do CMV por unidade é a QUANTIDADE SIMULADA (BACKLOG #9).
 *
 * `costForOutputQuantity` faz `perUnit = total / quantity`. A tela explicava
 * "÷ lote de referência" — errado sempre que a quantidade simulada não
 * coincide com o lote, e invisível porque a conferência do CalcHint estava
 * desligada ali. Este caso fixa a fórmula real com um custo fixo por lote no
 * meio, que é exatamente quando os dois divisores divergem.
 */
describe("CMV por unidade — o divisor é a quantidade simulada", () => {
  it("custo por unidade = CMV total ÷ quantidade simulada, não ÷ lote de referência", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cenario = await criarCenario(app, {
      referenceOutputQuantity: "1000",
      laborHoursPerBatch: "2",
      laborRate: "30",
    });
    const via = await getProductCmv({
      productId: cenario.product.id,
      quantity: new Prisma.Decimal(500),
      referenceDate: cenario.referenceDate,
      includePricing: false,
    });

    const simulacao = via.simulation!;
    expect(simulacao.totalCost).not.toBeNull();
    const total = Number(simulacao.totalCost);
    const porUnidade = Number(simulacao.costPerUnit);
    expect(porUnidade).toBeCloseTo(total / 500, 4);
    // Mão de obra fixa por lote não dilui: dividir pelo lote de referência
    // (1000) daria outro número — e é esse que a tela não pode explicar.
    expect(Math.abs(porUnidade - total / 1000)).toBeGreaterThan(0.001);
    expect(Number(simulacao.costPer1000)).toBeCloseTo(porUnidade * 1000, 3);

    await app.close();
  });
});
