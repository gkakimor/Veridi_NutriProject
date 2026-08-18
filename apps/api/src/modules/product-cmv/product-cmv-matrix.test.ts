import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getProductCmv } from "./product-cmv.service.js";

/**
 * Matriz do CMV — cenários próprios, nenhum apoiado no dataset DEMO.
 *
 * O arquivo irmão prova que o CMV e a precificação são o MESMO motor sobre
 * os dados que existirem no banco. Aqui é o contrário: cada caso constrói a
 * situação econômica exata que quer provar — custo fixo por lote, caixa
 * inteira, percentual sobre o direto, custo parcial, custo inexistente,
 * proveniência de compra real e escolha da base pela data — sem depender de
 * nenhum produto pré-existente. Um cenário que só passa porque o DEMO está
 * do jeito certo não prova regra nenhuma.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

const HOJE = new Date();

/** Dia de calendário deslocado — a base econômica é escolhida por data. */
function dia(offset: number): Date {
  const data = new Date(HOJE);
  data.setUTCDate(data.getUTCDate() + offset);
  data.setUTCHours(0, 0, 0, 0);
  return data;
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
});

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
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

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-CMV-${m}`, legalName: `Fornecedor CMV ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

/** Compra real: é o que faz o custo do material existir de verdade. */
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
        receivedAt: new Date().toISOString(),
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

async function createResource(app: App, type: "LABOR" | "ENERGY", rate: string) {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Recurso CMV ${type} ${marker()}`, type },
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

interface ScenarioOptions {
  /** Ausente deixa o material sem custo conhecido — nunca custo zero. */
  materialUnitCost?: string;
  materialQuantityPerUnit?: string;
  referenceOutputQuantity?: string;
  unitsPerShippingBox?: number;
  fixedPerBatch?: string;
  perShippingBox?: string;
  percentOfDirect?: string;
  laborHoursPerBatch?: string;
  laborRate?: string;
  /** Sem energia estruturada o custo nunca fecha — é assim que se faz NO_COST. */
  withEnergy?: boolean;
  /** Premissa informada COM valor zero — decisão registrada, não lacuna. */
  zeroPerOutputUnit?: boolean;
}

/** Produto + formulação ativa + estrutura ativa + cálculo salvo. */
async function createScenario(app: App, options: ScenarioOptions = {}) {
  const supplier = await createSupplier();
  const material = await createItem("RAW_MATERIAL");
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");

  if (options.materialUnitCost) {
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "1000",
      unitCost: options.materialUnitCost,
    });
  }

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto CMV ${marker()}`,
        finishedProductItemId: finishedItem.id,
        ...(options.unitsPerShippingBox
          ? { unitsPerShippingBox: options.unitsPerShippingBox }
          : {}),
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
      components: [
        {
          itemId: material.id,
          quantity: options.materialQuantityPerUnit ?? "0.01",
          unitCode: "kg",
        },
      ],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: options.referenceOutputQuantity ?? "1000" },
    })
  ).json();

  if (options.withEnergy !== false) {
    // Energia direta por unidade: fecha o custo sem interferir nas escalas
    // que cada caso quer medir.
    const energy = await createResource(app, "ENERGY", "1");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/energy-mode`,
      payload: { energyCalculationMode: "DIRECT" },
    });
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: { resourceId: energy.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
    });
  }

  if (options.laborHoursPerBatch) {
    const labor = await createResource(app, "LABOR", options.laborRate ?? "30");
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

  if (options.fixedPerBatch) {
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "THIRD_PARTY_SERVICE",
        description: "Setup e limpeza de linha",
        calculationBasis: "FIXED_PER_BATCH",
        rateValue: options.fixedPerBatch,
      },
    });
  }

  if (options.perShippingBox) {
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "SECONDARY_PACKAGING",
        description: "Caixa de expedição",
        calculationBasis: "PER_SHIPPING_BOX",
        rateValue: options.perShippingBox,
      },
    });
  }

  if (options.zeroPerOutputUnit) {
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "OTHER",
        description: "Frete incluso na negociação",
        calculationBasis: "PER_OUTPUT_UNIT",
        rateValue: "0",
      },
    });
  }

  if (options.percentOfDirect) {
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "OVERHEAD",
        description: "Overhead industrial",
        calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
        rateValue: options.percentOfDirect,
      },
    });
  }

  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/activate`,
    payload: { confirmIncomplete: true },
  });

  const calculation = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: {},
    })
  ).json();

  return { product, version, calculation, material, supplier };
}

async function cmv(productId: string, quantity: string, referenceDate = dia(1)) {
  return getProductCmv({
    productId,
    quantity: new Prisma.Decimal(quantity),
    referenceDate,
    includePricing: true,
  });
}

/** Soma dos componentes de um grupo — `null` quando nenhum é conhecido. */
function totalDoGrupo(
  response: Awaited<ReturnType<typeof cmv>>,
  predicado: (code: string, name: string) => boolean,
): Prisma.Decimal {
  return (response.simulation?.components ?? [])
    .filter((component) => predicado(component.code, component.name))
    .reduce(
      (soma, component) => soma.plus(new Prisma.Decimal(component.totalCost ?? 0)),
      new Prisma.Decimal(0),
    );
}

describe("CMV — matriz de composição e base econômica", () => {
  it("custo fixo por lote não se dilui abaixo de um lote e acompanha a contagem", async () => {
    const app = buildTestApp();
    const { product } = await createScenario(app, {
      materialUnitCost: "10",
      fixedPerBatch: "500",
      referenceOutputQuantity: "1000",
    });

    const setup = (response: Awaited<ReturnType<typeof cmv>>) =>
      totalDoGrupo(response, (_code, name) => name === "Setup e limpeza de linha");

    const q500 = await cmv(product.id, "500");
    const q750 = await cmv(product.id, "750");
    const q1000 = await cmv(product.id, "1000");
    const q3000 = await cmv(product.id, "3000");

    // Meio lote e três quartos de lote continuam sendo UM lote: o setup da
    // linha acontece inteiro, independente de quanto se produz nele.
    expect(q500.simulation?.batchCount).toBe("1");
    expect(q750.simulation?.batchCount).toBe("1");
    expect(q1000.simulation?.batchCount).toBe("1");
    expect(q3000.simulation?.batchCount).toBe("3");

    expect(setup(q500).toString()).toBe("500");
    expect(setup(q750).toString()).toBe("500");
    expect(setup(q1000).toString()).toBe("500");
    expect(setup(q3000).toString()).toBe("1500");
  });

  it("caixa de expedição é inteira — a regra é a do motor, não um arredondamento novo", async () => {
    const app = buildTestApp();
    const { product } = await createScenario(app, {
      materialUnitCost: "10",
      unitsPerShippingBox: 12,
      perShippingBox: "2",
      referenceOutputQuantity: "1000",
    });

    const caixa = (response: Awaited<ReturnType<typeof cmv>>) =>
      totalDoGrupo(response, (_code, name) => name === "Caixa de expedição");

    // 1000 / 12 = 83,33 caixas: paga-se 84, porque a 84ª caixa existe
    // fisicamente para caber o resto.
    expect(caixa(await cmv(product.id, "1000")).toString()).toBe("168");
    // 100 / 12 = 8,33 → 9 caixas.
    expect(caixa(await cmv(product.id, "100")).toString()).toBe("18");
    // Múltiplo exato não arredonda para cima: 120 / 12 = 10 caixas.
    expect(caixa(await cmv(product.id, "120")).toString()).toBe("20");
  });

  it("percentual incide sobre o custo direto e aparece na composição", async () => {
    const app = buildTestApp();
    const { product } = await createScenario(app, {
      materialUnitCost: "10",
      percentOfDirect: "10",
      referenceOutputQuantity: "1000",
    });

    const overhead = (response: Awaited<ReturnType<typeof cmv>>) =>
      totalDoGrupo(response, (_code, name) => name === "Overhead industrial");

    const q1000 = await cmv(product.id, "1000");
    const q2000 = await cmv(product.id, "2000");

    expect(q1000.simulation?.quality).toBe("COMPLETE_REAL_REFERENCE");

    // O total já contém o overhead: 10% sobre o direto significa que o
    // direto é 10/11 do total.
    const total1000 = new Prisma.Decimal(q1000.simulation!.totalCost!);
    const direto1000 = total1000.minus(overhead(q1000));
    expect(overhead(q1000).toFixed(4)).toBe(direto1000.times(10).dividedBy(100).toFixed(4));

    // Dobrar a quantidade dobra o direto, e o percentual acompanha — não é
    // um valor fixo disfarçado.
    const total2000 = new Prisma.Decimal(q2000.simulation!.totalCost!);
    const direto2000 = total2000.minus(overhead(q2000));
    expect(overhead(q2000).toFixed(4)).toBe(direto2000.times(10).dividedBy(100).toFixed(4));
    expect(overhead(q2000).greaterThan(overhead(q1000))).toBe(true);
  });

  it("custo parcial: total indisponível, subtotal conhecido presente", async () => {
    const app = buildTestApp();
    // Material sem nenhuma compra real, mas com mão de obra tarifada: parte
    // se sabe, parte não.
    const { product } = await createScenario(app, {
      laborHoursPerBatch: "4",
      laborRate: "50",
      referenceOutputQuantity: "1000",
    });

    const response = await cmv(product.id, "1000");
    expect(response.simulation?.quality).toBe("PARTIAL");
    expect(response.simulation?.totalCost).toBeNull();
    expect(response.simulation?.costPerUnit).toBeNull();
    expect(response.simulation?.costPer1000).toBeNull();
    // O que se sabe continua sendo dito — e não é o CMV.
    expect(new Prisma.Decimal(response.simulation!.knownSubtotal).greaterThan(0)).toBe(true);
    expect(
      response.simulation?.warnings.some((warning) => warning.code === "MATERIAL_COST_UNKNOWN"),
    ).toBe(true);
  });

  it("sem nenhuma fonte válida o custo é desconhecido, nunca zero", async () => {
    const app = buildTestApp();
    // Nada conhecido: material sem compra, sem recurso, sem premissa e sem
    // energia estruturada.
    const { product } = await createScenario(app, {
      withEnergy: false,
      referenceOutputQuantity: "1000",
    });

    const response = await cmv(product.id, "1000");
    expect(response.simulation?.quality).toBe("NO_COST");
    expect(response.simulation?.totalCost).toBeNull();
    expect(response.simulation?.costPerUnit).toBeNull();
    expect(response.simulation?.knownSubtotal).toBe("0.0000");
    // Zero conhecido e desconhecido são coisas diferentes: o total é `null`,
    // e o subtotal zero é o zero verdadeiro de "nada se sabe somar".
    expect(response.simulation?.components.every((c) => c.totalCost === null)).toBe(true);
  });

  it("proveniência: material com compra real resolve por média ponderada de 30 dias", async () => {
    const app = buildTestApp();
    const { product, material } = await createScenario(app, {
      materialUnitCost: "42",
      materialQuantityPerUnit: "0.1",
      referenceOutputQuantity: "1000",
    });

    const response = await cmv(product.id, "1000");
    const linha = response.simulation?.components.find(
      (component) => component.itemId === material.id,
    );
    expect(linha).toBeDefined();
    expect(linha!.costSource).toBe("WEIGHTED_AVG_30D");
    expect(linha!.unitCost).toBe("42.0000");
    expect(Number(linha!.requiredQuantity)).toBe(100);
    expect(linha!.totalCost).toBe("4200.0000");
  });

  it("referenceDate antiga não pode escolher um cálculo posterior", async () => {
    const app = buildTestApp();
    const { product, version, material, supplier } = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
      referenceOutputQuantity: "1000",
    });

    // Primeiro cálculo, com o custo que existia: é a base do dia anterior.
    const ontem = dia(-1);
    const calculoAntigo = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: { costReferenceDate: ontem.toISOString() },
      })
    ).json();

    // Uma compra cara muda a realidade econômica — e um cálculo novo a
    // congela num dia posterior.
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "1000",
      unitCost: "100",
    });
    const amanha = dia(1);
    const calculoNovo = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: { costReferenceDate: amanha.toISOString() },
      })
    ).json();
    expect(calculoNovo.id).not.toBe(calculoAntigo.id);

    const antes = await cmv(product.id, "1000", ontem);
    const depois = await cmv(product.id, "1000", amanha);

    // Naquele dia ninguém podia conhecer a compra que ainda não tinha
    // acontecido: a base é o cálculo vigente, não o mais recente.
    expect(antes.calculationId).toBe(calculoAntigo.id);
    expect(depois.calculationId).toBe(calculoNovo.id);

    const custoAntes = antes.simulation!.components.find((c) => c.itemId === material.id)!.unitCost;
    const custoDepois = depois.simulation!.components.find(
      (c) => c.itemId === material.id,
    )!.unitCost;
    expect(custoAntes).not.toBe(custoDepois);
  });

  it("referenceDate é dia de calendário: o cálculo salvo durante o dia pertence a ele", async () => {
    const app = buildTestApp();
    const { product, version } = await createScenario(app, {
      materialUnitCost: "10",
      referenceOutputQuantity: "1000",
    });

    // Um dia fechado no passado, para que nenhum outro cálculo dispute a
    // escolha: o único daquele dia foi salvo às 10h da manhã.
    const aquelaManha = dia(-3);
    aquelaManha.setUTCHours(10, 0, 0, 0);
    const calculo = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: { costReferenceDate: aquelaManha.toISOString() },
      })
    ).json();

    // Pedir aquele dia precisa alcançar o cálculo salvo às 10h: data de
    // referência é dia de calendário, não o instante da meia-noite.
    const response = await cmv(product.id, "1000", dia(-3));
    expect(response.calculationId).toBe(calculo.id);

    // E o dia anterior continua sem base: a regra é "até o dia pedido",
    // não "o cálculo mais próximo".
    const vespera = await cmv(product.id, "1000", dia(-4));
    expect(vespera.simulation).toBeNull();
    expect(vespera.unavailableReason).toMatch(/cálculo de custo salvo até esta data/i);
  });

  it("a rota exige quantidade e data e recusa produto inexistente", async () => {
    const app = buildTestApp();
    const { product } = await createScenario(app, {
      materialUnitCost: "10",
      referenceOutputQuantity: "1000",
    });
    const hoje = dia(0).toISOString().slice(0, 10);

    const semQuantidade = await app.inject({
      method: "GET",
      url: `/products/${product.id}/cmv?referenceDate=${hoje}`,
    });
    expect(semQuantidade.statusCode).toBe(400);

    const quantidadeZero = await app.inject({
      method: "GET",
      url: `/products/${product.id}/cmv?quantity=0&referenceDate=${hoje}`,
    });
    expect(quantidadeZero.statusCode).toBe(400);

    // A data nunca é inferida: o domínio não decide de qual dia se fala.
    const semData = await app.inject({
      method: "GET",
      url: `/products/${product.id}/cmv?quantity=1000`,
    });
    expect(semData.statusCode).toBe(400);

    const inexistente = await app.inject({
      method: "GET",
      url: `/products/00000000-0000-0000-0000-000000000000/cmv?quantity=1000&referenceDate=${hoje}`,
    });
    expect(inexistente.statusCode).toBe(404);
  });

  it("papel sem economia interna recebe custo, nunca preço", async () => {
    const admin = buildTestApp();
    const { product } = await createScenario(admin, {
      materialUnitCost: "10",
      referenceOutputQuantity: "1000",
    });
    const hoje = dia(0).toISOString().slice(0, 10);

    const producao = buildTestApp("PRODUCTION");
    const resposta = await producao.inject({
      method: "GET",
      url: `/products/${product.id}/cmv?quantity=1000&referenceDate=${hoje}`,
    });
    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();
    // Quem produz precisa do custo; preço e faixa são economia interna.
    expect(corpo.simulation).not.toBeNull();
    expect(corpo.pricing).toBeNull();
  });

  it("zero explícito é um valor; desconhecido continua sendo null", async () => {
    const app = buildTestApp();
    // Premissa informada com valor zero: é uma decisão, não uma lacuna.
    const { product } = await createScenario(app, {
      materialUnitCost: "10",
      referenceOutputQuantity: "1000",
      zeroPerOutputUnit: true,
    });

    const response = await cmv(product.id, "1000");
    const linha = response.simulation?.components.find(
      (component) => component.name === "Frete incluso na negociação",
    );
    // A linha existe com zero — e não some nem vira desconhecida.
    expect(linha?.totalCost).toBe("0.0000");
    expect(response.simulation?.quality).not.toBe("PARTIAL");
  });
});
