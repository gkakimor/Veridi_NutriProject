import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import {
  diaComercialDeTeste,
  instanteNoDiaComercialDeTeste,
} from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * COST-BASIS-UX-01 — o que "por 1.000" significa, provado com número.
 *
 * Durante o walkthrough real a base de produção era 300 unidades e a tela
 * destacava "custo por 1.000". A dúvida da usuária — o sistema calculou 300
 * ou 1.000? — só se responde no motor, nunca no rótulo.
 *
 * Estes casos rodam o MOTOR REAL (`GET /products/:id/cmv`, que é
 * `costForOutputQuantity`) sobre uma estrutura de base 300 que reúne, de
 * propósito, todas as formas de escala que o domínio conhece:
 *
 *   - material proporcional à quantidade;
 *   - mão de obra FIXA por lote de referência;
 *   - equipamento fixo por lote, com potência;
 *   - energia DERIVADA do equipamento (Σ horas × kW × tarifa);
 *   - premissa fixa por lote;
 *   - premissa por unidade;
 *   - premissa por 1.000 unidades;
 *   - caixa de expedição, que é inteira.
 *
 * O que fica provado: `perUnit = total ÷ quantidade` e
 * `per1000 = perUnit × 1000` são NORMALIZAÇÃO da execução pedida, e o custo
 * real de produzir 1.000 é outro número — porque 1.000 sobre base 300 são
 * quatro lotes e nem custo fixo, nem caixa inteira, diluem linearmente.
 */

const REFERENCE_OUTPUT = "300";
const UNITS_PER_BOX = 120;

/** Conta independente, em Decimal — nunca Number, nunca epsilon (§59). */
const D = (value: string | number) => new Prisma.Decimal(value);

const MATERIAL_PER_UNIT = D("0.10"); // 0,01 kg/un × R$ 10,00/kg
const LABOR_PER_BATCH = D("60"); // 2 h × R$ 30,00/h
const EQUIPMENT_PER_BATCH = D("30"); // 1,5 h × R$ 20,00/h
const ENERGY_PER_BATCH = D("12"); // 1,5 h × 10 kW × R$ 0,80/kWh
const FIXED_LINE_PER_BATCH = D("45");
const LINE_PER_UNIT = D("0.05");
const LINE_PER_1000 = D("20"); // R$ 0,02/un
const BOX_LINE = D("1");

/** Lotes de referência para uma quantidade — no mínimo um. */
function lotesEsperados(quantity: Prisma.Decimal): Prisma.Decimal {
  const b = quantity.dividedBy(D(REFERENCE_OUTPUT)).ceil();
  return b.lessThan(1) ? D(1) : b;
}

/** Caixas de expedição — inteiras: ninguém expede 2,08 caixas. */
function caixasEsperadas(quantity: Prisma.Decimal): Prisma.Decimal {
  return quantity.dividedBy(D(UNITS_PER_BOX)).ceil();
}

/**
 * Custo total esperado para uma quantidade, recomposto à mão.
 *
 * Não é uma segunda implementação do motor: é a conta que uma pessoa faria
 * no papel a partir das premissas da fixture, escrita para discordar do
 * motor quando ele errar.
 */
function contaIndependente(quantity: Prisma.Decimal) {
  const batches = lotesEsperados(quantity);
  const boxes = caixasEsperadas(quantity);

  const materiais = MATERIAL_PER_UNIT.times(quantity);
  const maoDeObra = LABOR_PER_BATCH.times(batches);
  const equipamento = EQUIPMENT_PER_BATCH.times(batches);
  const energia = ENERGY_PER_BATCH.times(batches);
  const fixo = FIXED_LINE_PER_BATCH.times(batches);
  const porUnidade = LINE_PER_UNIT.times(quantity);
  const porMil = LINE_PER_1000.times(quantity.dividedBy(D(1000)));
  const caixas = BOX_LINE.times(boxes);

  const total = materiais
    .plus(maoDeObra)
    .plus(equipamento)
    .plus(energia)
    .plus(fixo)
    .plus(porUnidade)
    .plus(porMil)
    .plus(caixas);

  const perUnit = total.dividedBy(quantity);

  return {
    batches,
    boxes,
    materiais,
    industrial: maoDeObra.plus(equipamento).plus(energia).plus(fixo).plus(porUnidade).plus(porMil).plus(caixas),
    total,
    perUnit,
    per1000: perUnit.times(D(1000)),
  };
}

/**
 * Componente da composição do CMV, na taxonomia que a API devolve.
 *
 * Recurso industrial carrega o TIPO no `code`; linha manual carrega a BASE
 * de cálculo. É por aí que cada caso abaixo isola a parcela que quer provar.
 */
interface Componente {
  group: string;
  code: string;
  totalCost: string | null;
}

const ehMaoDeObra = (c: Componente) => c.group === "INDUSTRIAL_RESOURCE" && c.code === "LABOR";
const ehEnergia = (c: Componente) => c.group === "INDUSTRIAL_RESOURCE" && c.code === "ENERGY";
const ehMaterialDaFormula = (c: Componente) => c.group === "FORMULA_MATERIAL";
const ehCaixaDeExpedicao = (c: Componente) => c.code === "PER_SHIPPING_BOX";

function somaDe(
  simulacao: { components: Componente[] },
  filtro: (c: Componente) => boolean,
): Prisma.Decimal {
  return simulacao.components
    .filter(filtro)
    .reduce((soma, component) => soma.plus(D(component.totalCost ?? "0")), D(0));
}

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

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
});

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-CBS-${m}`,
      name: `Item Base ${m}`,
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

async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost: string },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
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
        receivedAt: instanteNoDiaComercialDeTeste().toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marker()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
  return receipt;
}

async function createResource(
  app: App,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
  rate: string,
  payload: Record<string, unknown> = {},
) {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Recurso ${type} ${marker()}`, type, ...payload },
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

/**
 * Estrutura de base 300 com todas as formas de escala do domínio ativas.
 *
 * O objetivo é justamente NÃO ser linear: se o motor fosse linear, todos os
 * casos abaixo dariam o mesmo custo unitário, e a diferença entre "por 1.000"
 * e "produzir 1.000" desapareceria.
 */
async function estruturaBase300(app: App) {
  const m = marker();
  const prisma = getPrisma();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-CBS-${m}`, legalName: `Fornecedor Base ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);

  const material = await createItem("RAW_MATERIAL");
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");

  await receiveWithCost(app, {
    supplierId: supplier.id,
    itemId: material.id,
    quantity: "1000",
    unitCost: "10",
  });

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto Base 300 ${m}`,
        finishedProductItemId: finishedItem.id,
        unitsPerShippingBox: UNITS_PER_BOX,
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
      components: [{ itemId: material.id, quantity: "0.01", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: REFERENCE_OUTPUT, referenceOutputUomCode: "un" },
    })
  ).json();

  // Mão de obra: fixa por lote de referência.
  const labor = await createResource(app, "LABOR", "30");
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/resource-usages`,
    payload: { resourceId: labor.id, usageQuantity: "2", usageBasis: "FIXED_PER_REFERENCE_BATCH" },
  });

  // Equipamento: fixo por lote, com potência — é dele que a energia deriva.
  const equipment = await createResource(app, "EQUIPMENT", "20", { powerKw: "10" });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/resource-usages`,
    payload: {
      resourceId: equipment.id,
      usageQuantity: "1.5",
      usageBasis: "FIXED_PER_REFERENCE_BATCH",
    },
  });

  const energy = await createResource(app, "ENERGY", "0.80");
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/energy-mode`,
    payload: { energyCalculationMode: "FROM_EQUIPMENT", energyResourceId: energy.id },
  });

  for (const [basis, rate, category, description] of [
    ["FIXED_PER_BATCH", "45", "THIRD_PARTY_SERVICE", "Setup de linha por lote"],
    ["PER_OUTPUT_UNIT", "0.05", "THIRD_PARTY_SERVICE", "Serviço por unidade"],
    ["PER_1000_OUTPUT_UNITS", "20", "THIRD_PARTY_SERVICE", "Serviço por 1.000 unidades"],
    ["PER_SHIPPING_BOX", "1", "SECONDARY_PACKAGING", "Caixa de expedição"],
  ] as const) {
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: { category, description, calculationBasis: basis, rateValue: rate },
    });
  }

  await app.inject({ method: "POST", url: `/industrial-costs/${version.id}/activate` });

  // O CMV lê uma base econômica CONGELADA: sem cálculo salvo não há o que
  // simular, e é exatamente esse documento que a tela do walkthrough abriu.
  const calculation = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: {},
    })
  ).json();

  return { product, version, material, calculation };
}

/** O DIA da pergunta — o comercial, não o do relógio UTC (D-17). */
function hoje(): string {
  return diaComercialDeTeste();
}

async function cmvPara(app: App, productId: string, quantity: string) {
  const response = await app.inject({
    method: "GET",
    url: `/products/${productId}/cmv?quantity=${quantity}&referenceDate=${hoje()}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json().simulation;
}

describe("COST-BASIS-UX-01 — base calculada × equivalente por 1.000", () => {
  it("escala 200, 300, 500 e 1.000 sobre base 300 batendo com a conta independente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product } = await estruturaBase300(app);

    for (const quantity of ["200", "300", "500", "1000"]) {
      const esperado = contaIndependente(D(quantity));
      const simulacao = await cmvPara(app, product.id, quantity);

      expect(simulacao.quality).toBe("COMPLETE_REAL_REFERENCE");
      expect(simulacao.quantity).toBe(quantity);
      expect(simulacao.batchCount).toBe(esperado.batches.toString());
      expect(D(simulacao.totalCost).equals(esperado.total)).toBe(true);
      // Custo por unidade sai em resultado técnico; a conta é total ÷ quantidade.
      expect(D(simulacao.costPerUnit).equals(esperado.perUnit)).toBe(true);
      expect(D(simulacao.costPer1000).equals(esperado.per1000)).toBe(true);
      // A normalização é exatamente unitário × 1.000, nunca um novo cálculo.
      expect(D(simulacao.costPer1000).equals(D(simulacao.costPerUnit).times(1000))).toBe(true);
    }
  });

  it("recurso FIXO por lote não dilui abaixo de um lote e acompanha a contagem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product } = await estruturaBase300(app);

    const c200 = await cmvPara(app, product.id, "200");
    const c300 = await cmvPara(app, product.id, "300");
    const c1000 = await cmvPara(app, product.id, "1000");

    // 200 e 300 são UM lote: a mão de obra fixa é a mesma nos dois.
    expect(c200.batchCount).toBe("1");
    expect(c300.batchCount).toBe("1");
    const maoDeObra = (simulacao: { components: Componente[] }) => somaDe(simulacao, ehMaoDeObra);
    expect(maoDeObra(c200).equals(LABOR_PER_BATCH)).toBe(true);
    expect(maoDeObra(c300).equals(LABOR_PER_BATCH)).toBe(true);

    // 1.000 sobre base 300 são quatro lotes — quatro vezes o custo fixo.
    expect(c1000.batchCount).toBe("4");
    expect(maoDeObra(c1000).equals(LABOR_PER_BATCH.times(4))).toBe(true);
  });

  it("recurso proporcional escala com a quantidade, não com o lote", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product } = await estruturaBase300(app);

    for (const quantity of ["200", "300", "500", "1000"]) {
      const simulacao = await cmvPara(app, product.id, quantity);
      const materiais = somaDe(simulacao, ehMaterialDaFormula);
      expect(materiais.equals(MATERIAL_PER_UNIT.times(D(quantity)))).toBe(true);
    }
  });

  it("energia derivada do equipamento acompanha o lote, não a unidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product } = await estruturaBase300(app);

    const energia = (simulacao: { components: Componente[] }) => somaDe(simulacao, ehEnergia);

    // 1,5 h × 10 kW = 15 kWh por lote, a R$ 0,80 = R$ 12,00 por lote.
    expect(energia(await cmvPara(app, product.id, "200")).equals(ENERGY_PER_BATCH)).toBe(true);
    expect(energia(await cmvPara(app, product.id, "300")).equals(ENERGY_PER_BATCH)).toBe(true);
    expect(energia(await cmvPara(app, product.id, "500")).equals(ENERGY_PER_BATCH.times(2))).toBe(
      true,
    );
    expect(energia(await cmvPara(app, product.id, "1000")).equals(ENERGY_PER_BATCH.times(4))).toBe(
      true,
    );
  });

  it("caixa de expedição é inteira em toda quantidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product } = await estruturaBase300(app);

    for (const quantity of ["200", "300", "500", "1000"]) {
      const simulacao = await cmvPara(app, product.id, quantity);
      const embalagem = somaDe(simulacao, ehCaixaDeExpedicao);
      const caixas = caixasEsperadas(D(quantity));
      expect(caixas.isInteger()).toBe(true);
      expect(embalagem.equals(BOX_LINE.times(caixas))).toBe(true);
    }
  });

  it("equivalente por 1.000 da execução de 300 NÃO é o custo real de produzir 1.000", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product } = await estruturaBase300(app);

    const execucao300 = await cmvPara(app, product.id, "300");
    const execucao1000 = await cmvPara(app, product.id, "1000");

    // A normalização da execução de 300.
    const equivalentePorMil = D(execucao300.costPer1000);
    // O cálculo REAL de 1.000 — quatro lotes.
    const custoRealDeMil = D(execucao1000.totalCost);

    expect(execucao300.batchCount).toBe("1");
    expect(execucao1000.batchCount).toBe("4");
    expect(equivalentePorMil.equals(custoRealDeMil)).toBe(false);
    // E o real é MAIOR: custo fixo por lote e caixa inteira não diluem.
    expect(custoRealDeMil.greaterThan(equivalentePorMil)).toBe(true);
  });

  it("o CALC salvo responde pela base de referência, e o por 1.000 dele é a mesma normalização", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { product, calculation: calculo } = await estruturaBase300(app);

    const esperado = contaIndependente(D(REFERENCE_OUTPUT));
    expect(calculo.referenceOutputQuantity).toBe(REFERENCE_OUTPUT);
    expect(D(calculo.totalIndustrialCost).equals(esperado.total)).toBe(true);
    expect(D(calculo.costPerUnit).equals(esperado.perUnit)).toBe(true);
    expect(D(calculo.costPer1000).equals(esperado.per1000)).toBe(true);
    expect(D(calculo.costPer1000).equals(D(calculo.costPerUnit).times(1000))).toBe(true);

    // O CALC calcula a BASE, não 1.000: a simulação de 300 dá o mesmo total.
    const simulacao300 = await cmvPara(app, product.id, REFERENCE_OUTPUT);
    expect(D(simulacao300.totalCost).equals(D(calculo.totalIndustrialCost))).toBe(true);
  });
});
