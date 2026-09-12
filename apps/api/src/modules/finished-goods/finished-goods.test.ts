import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

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
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
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
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-FG-${m}`, legalName: `Fornecedor PA Teste ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-FG-${m}`,
      name: `Item PA Teste ${m}`,
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

/** Recebimento real com custo — alimenta o custo material da OP. */
async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost?: string },
) {
  const poResponse = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId: params.supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
    },
  });
  const po = poResponse.json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receiptResponse = await app.inject({
    method: "POST",
    url: `/purchase-orders/${po.id}/receipts`,
    payload: {
      receivedAt: new Date().toISOString(),
      lines: [
        {
          purchaseOrderLineId: po.lines[0].id,
          receivedQuantity: params.quantity,
          supplierLot: `SUP-${marker()}`,
          ...(params.unitCost ? { actualUnitCost: params.unitCost } : {}),
        },
      ],
    },
  });
  const receipt = receiptResponse.json();
  fixtureReceiptIds.push(receipt.id);
  return receipt;
}

async function createProductWithFormulation(
  app: App,
  rawMaterialId: string,
  quantityPerBasis: string,
  finishedItemOverride?: { requiresQualityRelease?: boolean },
) {
  const prisma = getPrisma();
  const m = marker();
  const finishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-FG-${m}`,
      name: `Produto Acabado Teste ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: finishedItemOverride?.requiresQualityRelease ?? false,
      active: true,
    },
  });
  fixtureItemIds.push(finishedItem.id);

  const productResponse = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId: await fixtureCustomerId(), name: `Produto PA Teste ${m}`, finishedProductItemId: finishedItem.id },
  });
  const product = productResponse.json();
  fixtureProductIds.push(product.id);

  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: rawMaterialId, quantity: quantityPerBasis, unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  return { product, finishedItem };
}

/** OP completa: plan → release → picking/consumo → output. */
async function produceLot(
  app: App,
  productId: string,
  plannedQuantity: string,
  outputQuantity: string,
  businessLotNumber: string,
) {
  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity },
  });
  const orderId = created.json().id;
  fixtureProductionOrderIds.push(orderId);

  await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
  const released = (await app.inject({ method: "POST", url: `/production-orders/${orderId}/release` })).json();

  for (const requirement of released.requirements) {
    for (const line of requirement.reservationLines) {
      await app.inject({
        method: "POST",
        url: `/production-orders/${orderId}/picking/${line.id}/confirm`,
        payload: line.lotCode ? { lotCode: line.lotCode } : {},
      });
      await app.inject({
        method: "POST",
        url: `/production-orders/${orderId}/consumptions`,
        payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
      });
    }
  }

  const output = await app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/outputs`,
    payload: { quantity: outputQuantity, destination: "NEW_LOT", businessLotNumber },
  });
  const orderDetail = output.json();
  return { orderId, orderCode: orderDetail.code, lotId: orderDetail.outputs[0].lotId };
}

async function listFinishedGoods(app: App, query = "") {
  return (await app.inject({ method: "GET", url: `/finished-goods${query}` })).json();
}

describe("Produto Acabado — visão operacional", () => {
  it("lista apenas lotes origin PRODUCTION, nunca lotes de recebimento", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });
    const receiptLotId = receipt.lines[0].lotId;

    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const produced = await produceLot(app, product.id, "5", "5", "VD-FG-1");

    /*
     * Filtra pelo produto do próprio teste. Sem isso a asserção dependia de o
     * lote recém-produzido caber nos cem primeiros da base inteira — e no
     * banco de desenvolvimento, com mais de cem lotes de produção
     * acumulados, ele não cabia. O que se mede é a origem do lote, nunca o
     * tamanho da base.
     */
    const result = await listFinishedGoods(app, `?productId=${product.id}&pageSize=100`);
    const lotIds = result.rows.map((row: { lotId: string }) => row.lotId);
    expect(lotIds).toContain(produced.lotId);
    // Lote de recebimento nunca aparece nesta tela.
    expect(lotIds).not.toContain(receiptLotId);

    await app.close();
  });

  it("produzido vem do ProductionOutput e nunca é usado como saldo; On Hand/Reserved/Available vêm do ledger", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });

    const { product, finishedItem } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const produced = await produceLot(app, product.id, "10", "10", "VD-FG-2");

    // Consome parte do produto acabado por um ajuste de saída, para que
    // produzido (10) e On Hand (7) fiquem propositalmente diferentes.
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: {
        itemId: finishedItem.id,
        lotId: produced.lotId,
        type: "ADJUSTMENT_OUT",
        quantity: "3",
        reason: "Amostra de laboratório",
      },
    });

    const result = await listFinishedGoods(app, `?pageSize=100&productionOrderId=${produced.orderId}`);
    const row = result.rows.find((r: { lotId: string }) => r.lotId === produced.lotId);
    expect(row).toBeDefined();
    expect(row.producedQuantity).toBe("10");
    expect(row.onHand).toBe("7");
    expect(row.reserved).toBe("0");
    expect(row.available).toBe("7");
    expect(row.productionOrderCode).toBe(produced.orderCode);
    expect(row.businessLotNumber).toBe("VD-FG-2");
    expect(row.productId).toBe(product.id);
    expect(row.itemId).toBe(finishedItem.id);
    expect(row.producedAt).not.toBeNull();

    await app.close();
  });

  it("qualidade reflete o status efetivo e a liberação altera Available", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });

    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10", {
      requiresQualityRelease: true,
    });
    const produced = await produceLot(app, product.id, "8", "8", "VD-FG-3");

    const before = await listFinishedGoods(app, `?productionOrderId=${produced.orderId}`);
    const beforeRow = before.rows[0];
    expect(beforeRow.status).toBe("AWAITING_RELEASE");
    expect(beforeRow.onHand).toBe("8");
    // Aguardando Qualidade: existe fisicamente mas não está disponível.
    expect(beforeRow.available).toBe("0");

    // Reutiliza a ação de Qualidade já existente do Lote — sem duplicar.
    await app.inject({ method: "POST", url: `/lots/${produced.lotId}/release` });

    const after = await listFinishedGoods(app, `?productionOrderId=${produced.orderId}`);
    expect(after.rows[0].status).toBe("AVAILABLE");
    expect(after.rows[0].available).toBe("8");

    await app.close();
  });

  it("custo material vem da Fundação de Custos com a qualidade correta", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();

    // Cenário com custo real: matéria-prima recebida com custo informado.
    const comCusto = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: comCusto.id,
      quantity: "1000",
      unitCost: "2",
    });
    const withCost = await createProductWithFormulation(app, comCusto.id, "10");
    // 10 un × 10 kg/un = 100 kg × R$ 2/kg = R$ 200 de material;
    // 10 un produzidas = R$ 20,0000 por unidade.
    const producedReal = await produceLot(app, withCost.product.id, "10", "10", "VD-FG-4");

    const realResult = await listFinishedGoods(app, `?productionOrderId=${producedReal.orderId}`);
    expect(realResult.rows[0].costQuality).toBe("REAL");
    expect(realResult.rows[0].materialUnitCost).toBe("20.00000000");
    expect(realResult.rows[0].costSource).toBe("REAL");

    // Cenário sem custo: matéria-prima recebida sem custo informado.
    const semCusto = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: semCusto.id, quantity: "1000" });
    const withoutCost = await createProductWithFormulation(app, semCusto.id, "10");
    const producedNoCost = await produceLot(app, withoutCost.product.id, "10", "10", "VD-FG-5");

    const noCostResult = await listFinishedGoods(app, `?productionOrderId=${producedNoCost.orderId}`);
    expect(noCostResult.rows[0].costQuality).toBe("NO_COST");
    // Custo indisponível nunca é apresentado como valor completo.
    expect(noCostResult.rows[0].materialUnitCost).toBeNull();

    await app.close();
  });

  it("filtra por status de qualidade e por busca de lote Veridi", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });

    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const marca = `VD-BUSCA-${marker()}`;
    const produced = await produceLot(app, product.id, "6", "6", marca);

    const bySearch = await listFinishedGoods(app, `?search=${encodeURIComponent(marca)}`);
    expect(bySearch.rows).toHaveLength(1);
    expect(bySearch.rows[0].lotId).toBe(produced.lotId);

    const byStatus = await listFinishedGoods(app, "?status=AVAILABLE&pageSize=100");
    expect(byStatus.rows.every((row: { status: string }) => row.status === "AVAILABLE")).toBe(true);

    const byBlocked = await listFinishedGoods(app, "?status=BLOCKED&pageSize=100");
    expect(byBlocked.rows.some((row: { lotId: string }) => row.lotId === produced.lotId)).toBe(false);

    await app.close();
  });

  /*
   * A tela lista a tabela INTEIRA de lotes de produção e só depois resolve o
   * custo de cada OP — duas leituras separadas no tempo. Entre elas, uma OP
   * lida na primeira pode ter deixado de existir (na suíte, o `afterAll` de
   * outro arquivo; em produção, qualquer remoção de massa). A listagem tratava
   * isso como 404 e devolvia 500 — a tela inteira caía por uma linha obsoleta
   * de outra pessoa, e quem lia via `rows` indefinido.
   *
   * A janela é forçada de propósito: a OP some exatamente entre a leitura dos
   * lotes e a do custo. O que se prova é a resposta, não o instante.
   */
  it("a listagem sobrevive a uma OP que some entre a leitura dos lotes e a do custo", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });
    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const efemera = await produceLot(app, product.id, "5", "5", "VD-FG-SUMICO");

    const prisma = getPrisma();
    // A janela real: depois de a listagem ler os lotes, antes de resolver o
    // custo por OP. O saldo do ledger é lido exatamente aí.
    // O tipo genérico de `groupBy` não se reescreve à mão, e aqui ele nem
    // importa: o que se faz é ENVELOPAR a chamada. A troca atravessa uma vista
    // mínima do delegate, e o original volta no `finally`.
    type LeituraDoLedger = { groupBy: (args: unknown) => Promise<unknown> };
    const ledger = prisma.inventoryMovement as unknown as LeituraDoLedger;
    const original = ledger.groupBy.bind(prisma.inventoryMovement);
    let jaApagou = false;
    ledger.groupBy = async (args: unknown) => {
      const resultado = await original(args);
      if (!jaApagou) {
        jaApagou = true;
        // Mesma ordem de limpeza do `afterAll` deste arquivo — é o cleanup de
        // um vizinho que se está simulando, não uma remoção inventada.
        await prisma.productionOutput.deleteMany({
          where: { productionOrderId: efemera.orderId },
        });
        await prisma.productionConsumption.deleteMany({
          where: { productionOrderId: efemera.orderId },
        });
        const reservas = await prisma.materialReservation.findMany({
          where: { productionOrderId: efemera.orderId },
          select: { id: true },
        });
        const reservaIds = reservas.map((r) => r.id);
        if (reservaIds.length > 0) {
          await prisma.materialReservationLine.deleteMany({
            where: { reservationId: { in: reservaIds } },
          });
          await prisma.materialReservation.deleteMany({ where: { id: { in: reservaIds } } });
        }
        await prisma.lot.deleteMany({ where: { productionOrderId: efemera.orderId } });
        await prisma.productionOrder.deleteMany({ where: { id: efemera.orderId } });
      }
      return resultado;
    };

    try {
      // Consulta escopada na própria massa: o que se prova é a resposta, e ela
      // não pode depender de quantos lotes o banco tem no momento.
      const resposta = await app.inject({
        method: "GET",
        url: `/finished-goods?productionOrderId=${efemera.orderId}`,
      });
      expect(resposta.statusCode).toBe(200);
      const corpo = resposta.json();
      // A linha obsoleta ainda aparece — ela existia no retrato lido — e sai
      // sem custo, como qualquer lote cuja OP não responde por um.
      expect(corpo.rows).toHaveLength(1);
      expect(corpo.rows[0].lotId).toBe(efemera.lotId);
      expect(corpo.rows[0].costQuality).toBe("NO_COST");
      expect(corpo.rows[0].materialUnitCost).toBeNull();
    } finally {
      ledger.groupBy = original;
    }

    await app.close();
  });
});

/**
 * FILTER-OPERATIONS-WAVE-01 — o período de Produto Acabado é DIA COMERCIAL.
 *
 * Dois defeitos no mesmo filtro. No servidor, `requiredDateSchema` (=
 * `z.coerce.date`) com `lte`: "até 10/09" terminava às 21h do dia 09 em São
 * Paulo. Na tela, `new Date(`${dia}T00:00:00`)` e `...T23:59:59.999` —
 * componentes LOCAIS do navegador —, então o mesmo filtro devolvia conjuntos
 * diferentes em fusos diferentes. E o CSV não levava período nenhum: a tela
 * mostrava um recorte e o arquivo exportava a produção inteira.
 */
describe("Produto Acabado — filtro por dia comercial", () => {
  /** Produz um lote e crava o `producedAt` do apontamento no instante pedido. */
  async function produzidoEm(app: App, productId: string, marca: string, instante: Date) {
    const produced = await produceLot(app, productId, "1", "1", marca);
    await getPrisma().productionOutput.updateMany({
      where: { lotId: produced.lotId },
      data: { producedAt: instante },
    });
    return produced;
  }

  async function lotesDoPeriodo(app: App, productId: string, dateFrom: string, dateTo: string) {
    const result = await listFinishedGoods(
      app,
      `?productId=${productId}&dateFrom=${dateFrom}&dateTo=${dateTo}&pageSize=100`,
    );
    return (result.rows as { lotId: string }[]).map((row) => row.lotId);
  }

  it("o mesmo dia nas duas pontas cobre o dia comercial inteiro, e a fronteira é real", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });
    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");

    // 23:30 de 10/09 em São Paulo — em UTC já é 11/09 às 02:30.
    const noiteDoDia10 = await produzidoEm(
      app,
      product.id,
      `VD-FG-DIA-A-${Date.now()}`,
      new Date("2026-09-11T02:30:00.000Z"),
    );
    // Meio do dia 11 — fica FORA do filtro do dia 10.
    const dia11 = await produzidoEm(
      app,
      product.id,
      `VD-FG-DIA-B-${Date.now()}`,
      new Date("2026-09-11T15:00:00.000Z"),
    );

    const dia10 = await lotesDoPeriodo(app, product.id, "2026-09-10", "2026-09-10");
    expect(dia10).toContain(noiteDoDia10.lotId);
    expect(dia10).not.toContain(dia11.lotId);

    // E o dia 11 traz o dia 11, não o 10.
    const onze = await lotesDoPeriodo(app, product.id, "2026-09-11", "2026-09-11");
    expect(onze).toContain(dia11.lotId);
    expect(onze).not.toContain(noiteDoDia10.lotId);

    // Período cruzando o mês inclui os dois.
    const janela = await lotesDoPeriodo(app, product.id, "2026-08-25", "2026-09-11");
    expect(janela).toContain(noiteDoDia10.lotId);
    expect(janela).toContain(dia11.lotId);

    await app.close();
  });

  it("o CSV exporta o MESMO período da tela", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });
    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");

    const marcaDia10 = `VD-FG-CSV-A-${Date.now()}`;
    const marcaDia11 = `VD-FG-CSV-B-${Date.now()}`;
    await produzidoEm(app, product.id, marcaDia10, new Date("2026-09-11T02:30:00.000Z"));
    await produzidoEm(app, product.id, marcaDia11, new Date("2026-09-11T15:00:00.000Z"));

    const csv = await app.inject({
      method: "GET",
      url: `/finished-goods/export.csv?productId=${product.id}&dateFrom=2026-09-10&dateTo=2026-09-10`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(marcaDia10);
    expect(csv.body).not.toContain(marcaDia11);

    await app.close();
  });

  it("data que não é dia civil é recusada em vez de virar outro dia", async () => {
    const app = buildTestApp();
    await app.ready();

    for (const valor of ["10/09/2026", "2026-02-30", "2026-09-10T00:00:00.000Z"]) {
      const resposta = await app.inject({
        method: "GET",
        url: `/finished-goods?dateTo=${encodeURIComponent(valor)}`,
      });
      expect(resposta.statusCode).toBe(400);
    }

    const vazio = await app.inject({ method: "GET", url: "/finished-goods?dateFrom=&dateTo=" });
    expect(vazio.statusCode).toBe(200);

    await app.close();
  });
});
