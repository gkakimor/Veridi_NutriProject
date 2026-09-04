import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureCustomerOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let supplierId: string;
let supplierName: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const m = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  supplierName = `Fornecedor Rastreabilidade Teste ${m}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-TRACE-${m}`, legalName: supplierName },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  /*
   * Ordem de remoção segue as chaves estrangeiras, do documento mais externo
   * para o mais interno: Faturamento aponta para Expedição, Expedição para o
   * Pedido, reserva para a linha do Pedido, e a OP também para o Pedido.
   *
   * Sem esta cadeia, o caso do lote expedido em outro Pedido deixava a
   * Expedição para trás, o `deleteMany` do Pedido falhava por chave
   * estrangeira e a massa sobrevivia à suíte — e o relatório comercial, que
   * agrega o banco inteiro, passava a somar documentos de teste.
   */
  if (fixtureCustomerOrderIds.length > 0) {
    const expedicoes = await prisma.shipment.findMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      select: { id: true },
    });
    const expedicaoIds = expedicoes.map((e) => e.id);
    if (expedicaoIds.length > 0) {
      await prisma.billing.deleteMany({ where: { shipmentId: { in: expedicaoIds } } });
      await prisma.shipmentLine.deleteMany({ where: { shipmentId: { in: expedicaoIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: expedicaoIds } } });
    }
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.productionOrder.updateMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      data: { customerOrderId: null },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
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
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds }, replacesLineId: { not: null } },
      });
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
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

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-TRC-${m}`,
      name: `Item Rastreabilidade Teste ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createProduct(app: App, finishedProductItemId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId: await fixtureCustomerId(), name: `Produto Rastreabilidade Teste ${marker()}`, finishedProductItemId },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

async function receiveStock(itemId: string, quantity: string, supplierLot: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-TRC-${marker()}`.toUpperCase(),
      itemId,
      supplierId,
      supplierLot,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

async function createReleasedOrder(
  app: App,
  finishedItemId: string,
  rawMaterialId: string,
  rawQuantityPerBasis: string,
  plannedQuantity: string,
) {
  const product = await createProduct(app, finishedItemId);
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
      basisQuantity: plannedQuantity,
      components: [{ itemId: rawMaterialId, quantity: rawQuantityPerBasis, unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  const orderCreated = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId: product.id, plannedQuantity },
  });
  fixtureProductionOrderIds.push(orderCreated.json().id);
  await app.inject({ method: "POST", url: `/production-orders/${orderCreated.json().id}/plan` });
  const released = await app.inject({
    method: "POST",
    url: `/production-orders/${orderCreated.json().id}/release`,
  });
  return released.json();
}

describe("Rastreabilidade bidirecional (backward/forward)", () => {
  it("backward: lote de produto acabado mostra a OP e os materiais REALMENTE consumidos", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const rawLot = await receiveStock(rawMaterial.id, "50", "FORN-LOTE-X");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "20", "1");
    const line = order.requirements[0].reservationLines[0];
    expect(line.lotId).toBe(rawLot.id);

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: rawLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "20" }] },
    });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-BACKWARD" },
    });
    const finishedLotId = output.json().outputs[0].lotId;
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const traceability = await app.inject({ method: "GET", url: `/lots/${finishedLotId}/traceability` });
    expect(traceability.statusCode).toBe(200);
    const body = traceability.json();
    expect(body.kind).toBe("FINISHED_GOOD");
    expect(body.productionOrderId).toBe(order.id);
    expect(body.producedQuantity).toBe("1");
    expect(body.consumedMaterials).toHaveLength(1);
    expect(body.consumedMaterials[0].lotId).toBe(rawLot.id);
    expect(body.consumedMaterials[0].lotCode).toBe(rawLot.code);
    expect(body.consumedMaterials[0].supplierLot).toBe("FORN-LOTE-X");
    expect(body.consumedMaterials[0].supplierName).toBe(supplierName);
    expect(body.consumedMaterials[0].quantity).toBe("20");
    /*
     * Produção para estoque: não há pedido, e nada é inventado — os campos de
     * origem vêm `null` e a lista de saídas vem vazia.
     *
     * A seção em si EXISTE. Devolver `null` fazia ela sumir da tela e do
     * papel, e um lote que nunca saiu deixava de dizer que nunca saiu: quem
     * procurasse por onde ele foi encontrava silêncio, que não é resposta para
     * a pergunta de recall.
     */
    expect(body.commercialDestination).not.toBeNull();
    expect(body.commercialDestination.customerOrderId).toBeNull();
    expect(body.commercialDestination.customerOrderCode).toBeNull();
    expect(body.commercialDestination.customerName).toBeNull();
    expect(body.commercialDestination.shipments).toEqual([]);

    await app.close();
  });

  it("ordem nascida de Pedido expõe o destino comercial, fora da genealogia", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const rawLot = await receiveStock(rawMaterial.id, "50", "FORN-LOTE-DEST");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "20", "1");

    // A OP passa a apontar para um Pedido — é o que a aplicação do Plano
    // faz; aqui a fixture grava o mesmo vínculo, porque o que se testa é
    // a leitura da genealogia, não como o Pedido nasce.
    const prisma = getPrisma();
    const marcador = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const customer = await prisma.customer.create({
      data: { code: `CLI-TRC-${marcador}`, legalName: `Cliente Rastreio ${marcador}` },
    });
    fixtureCustomerIds.push(customer.id);
    const customerOrder = await prisma.customerOrder.create({
      data: {
        code: `PED-TRC-${marcador}`,
        customerId: customer.id,
        orderDate: new Date(),
        status: "IN_FULFILLMENT",
      },
    });
    fixtureCustomerOrderIds.push(customerOrder.id);
    await prisma.productionOrder.update({
      where: { id: order.id },
      data: { customerOrderId: customerOrder.id },
    });

    const line = order.requirements[0].reservationLines[0];
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: rawLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "20" }] },
    });
    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: `VD-DEST-${marcador}` },
    });
    const finishedLotId = output.json().outputs[0].lotId;

    const body = (
      await app.inject({ method: "GET", url: `/lots/${finishedLotId}/traceability` })
    ).json();

    // A cadeia fornecedor → cliente fecha num documento só.
    expect(body.consumedMaterials[0].supplierName).toBe(supplierName);
    expect(body.commercialDestination).toBeTruthy();
    expect(body.commercialDestination.customerOrderCode).toBe(customerOrder.code);
    expect(body.commercialDestination.customerName).toBe(customer.legalName);
    // Ainda não expedido — a seção existe, a lista está vazia.
    expect(body.commercialDestination.shipments).toEqual([]);
    // E o cliente NÃO aparece como origem de material.
    expect(body.consumedMaterials.some((m: { supplierName: string | null }) =>
      m.supplierName === customer.legalName,
    )).toBe(false);

    await app.close();
  });

  it("forward: lote de matéria-prima mostra a OP e o(s) lote(s) de produto acabado gerados", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const rawLot = await receiveStock(rawMaterial.id, "50", "FORN-LOTE-Y");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "15", "1");
    const line = order.requirements[0].reservationLines[0];

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: rawLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "15" }] },
    });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-FORWARD" },
    });
    const finishedLotId = output.json().outputs[0].lotId;
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const traceability = await app.inject({ method: "GET", url: `/lots/${rawLot.id}/traceability` });
    expect(traceability.statusCode).toBe(200);
    const body = traceability.json();
    expect(body.kind).toBe("RAW_MATERIAL");
    expect(body.usedIn).toHaveLength(1);
    expect(body.usedIn[0].productionOrderId).toBe(order.id);
    expect(body.usedIn[0].consumedQuantity).toBe("15");
    expect(body.usedIn[0].finishedLots).toHaveLength(1);
    expect(body.usedIn[0].finishedLots[0].lotId).toBe(finishedLotId);
    expect(body.usedIn[0].finishedLots[0].producedQuantity).toBe("1");

    await app.close();
  });

  it("CRÍTICO: lote apenas reservado e NUNCA consumido não aparece como matéria-prima utilizada", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30", "FORN-ORIGINAL");
    const alternateLot = await receiveStock(rawMaterial.id, "30", "FORN-ALTERNATIVO");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "20", "1");
    const originalLine = order.requirements[0].reservationLines[0];
    expect(originalLine.lotId).toBe(originalLot.id);

    // Substitui ANTES de qualquer Picking/Consumo — o lote original nunca
    // e fisicamente tocado, so o alternativo e realmente consumido.
    const substituted = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: alternateLot.code },
    });
    const newLine = substituted.json().requirements[0].reservationLines.find(
      (l: { replacesLineId: string | null }) => l.replacesLineId === originalLine.id,
    );
    expect(newLine.lotId).toBe(alternateLot.id);
    expect(newLine.pickingStatus).toBe("CONFIRMED");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: newLine.id, quantity: "20" }] },
    });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-CRITICO" },
    });
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    // O lote original: so reservado, jamais consumido — usedIn vazio.
    const originalTraceability = (
      await app.inject({ method: "GET", url: `/lots/${originalLot.id}/traceability` })
    ).json();
    expect(originalTraceability.kind).toBe("RAW_MATERIAL");
    expect(originalTraceability.usedIn).toHaveLength(0);

    // O lote alternativo: realmente consumido — aparece corretamente.
    const alternateTraceability = (
      await app.inject({ method: "GET", url: `/lots/${alternateLot.id}/traceability` })
    ).json();
    expect(alternateTraceability.usedIn).toHaveLength(1);
    expect(alternateTraceability.usedIn[0].consumedQuantity).toBe("20");

    // Genealogia do lote de produto acabado tambem so cita o lote realmente
    // consumido (alternativo) — nunca o originalmente reservado.
    const finishedLotId = output.json().outputs[0].lotId;
    const finishedTraceability = (
      await app.inject({ method: "GET", url: `/lots/${finishedLotId}/traceability` })
    ).json();
    expect(finishedTraceability.consumedMaterials).toHaveLength(1);
    expect(finishedTraceability.consumedMaterials[0].lotId).toBe(alternateLot.id);

    await app.close();
  });

  /*
   * ESTOQUE ACABADO E FUNGIVEL: o lote sai por quem o RESERVOU, nao por quem o
   * encomendou.
   *
   * Era um HIGH da rodada adversarial. A busca do destino filtrava tambem pelo
   * `customerOrderId` da Ordem de Producao, o que confunde a ORIGEM da producao
   * com o DESTINO do lote. Um lote produzido para o Pedido A e expedido no
   * Pedido B tinha o vinculo gravado em `ShipmentLine.lotId`, o fisico caia, e
   * a tela respondia "este lote ainda nao foi expedido" — a resposta errada
   * para a pergunta de recall.
   *
   * Este teste substitui o E2E adversarial que provava a mesma coisa em vinte
   * minutos de navegador.
   */
  it("CRITICO: lote produzido para um Pedido e expedido em OUTRO aparece na saida", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();
    const marcador = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const rawMaterial = await createItem("RAW_MATERIAL");
    const rawLot = await receiveStock(rawMaterial.id, "50", "FORN-LOTE-FUNG");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const ordem = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "20", "1");

    // ── Pedido A: a ORIGEM. A OP nasce dele. ──────────────────────────────
    const clienteA = await prisma.customer.create({
      data: { code: `CLI-TA-${marcador}`, legalName: `Cliente Origem ${marcador}` },
    });
    fixtureCustomerIds.push(clienteA.id);
    const pedidoA = await prisma.customerOrder.create({
      data: {
        code: `PED-TA-${marcador}`,
        customerId: clienteA.id,
        orderDate: new Date(),
        status: "IN_FULFILLMENT",
      },
    });
    fixtureCustomerOrderIds.push(pedidoA.id);
    await prisma.productionOrder.update({
      where: { id: ordem.id },
      data: { customerOrderId: pedidoA.id },
    });

    // Produz o lote acabado.
    const linha = ordem.requirements[0].reservationLines[0];
    await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/picking/${linha.id}/confirm`,
      payload: { lotCode: rawLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/consumptions`,
      payload: { entries: [{ reservationLineId: linha.id, quantity: "20" }] },
    });
    const saida = await app.inject({
      method: "POST",
      url: `/production-orders/${ordem.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: `VD-FUNG-${marcador}` },
    });
    const loteAcabadoId = saida.json().outputs[0].lotId;

    // ── Pedido B: o DESTINO. Reserva o mesmo lote e expede. ───────────────
    const clienteB = await prisma.customer.create({
      data: { code: `CLI-TB-${marcador}`, legalName: `Cliente Destino ${marcador}` },
    });
    fixtureCustomerIds.push(clienteB.id);

    const pedidoB = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: {
          customerId: clienteB.id,
          lines: [{ productId: ordem.productId, orderedQuantity: "1" }],
        },
      })
    ).json();
    fixtureCustomerOrderIds.push(pedidoB.id);
    const confirmado = await app.inject({
      method: "POST",
      url: `/customer-orders/${pedidoB.id}/confirm`,
    });
    const linhaPedido = confirmado.json().lines[0];

    const planoAplicado = await app.inject({
      method: "POST",
      url: `/customer-orders/${pedidoB.id}/apply-fulfillment-plan`,
      payload: {
        lines: [
          { customerOrderLineId: linhaPedido.id, reserveQuantity: "1", produceQuantity: "0" },
        ],
      },
    });
    expect(
      planoAplicado.statusCode,
      `plano do Pedido B falhou: ${planoAplicado.body}`,
    ).toBeLessThan(400);

    const reservas = await prisma.customerOrderReservationLine.findMany({
      where: { customerOrderLineId: linhaPedido.id, lotId: loteAcabadoId },
    });
    expect(reservas.length, "o Pedido B precisa ter reservado o lote produzido").toBeGreaterThan(0);

    const expedicao = (
      await app.inject({ method: "POST", url: `/customer-orders/${pedidoB.id}/shipments` })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/shipments/${expedicao.id}`,
      payload: {
        lines: [{ customerOrderReservationLineId: reservas[0]!.id, quantity: "1" }],
      },
    });
    /*
     * Conferência de lote antes de confirmar: a expedição recusa sair com
     * linha não conferida, e é assim que a fábrica opera de verdade.
     */
    const comLinhas = (
      await app.inject({ method: "GET", url: `/shipments/${expedicao.id}` })
    ).json();
    for (const l of comLinhas.lines) {
      if (!l.requiresVerification) continue;
      await app.inject({
        method: "POST",
        url: `/shipments/${expedicao.id}/lines/${l.id}/verify`,
        payload: { lotCode: l.lotCode },
      });
    }

    const confirmada = await app.inject({
      method: "POST",
      url: `/shipments/${expedicao.id}/confirm`,
    });
    expect(
      confirmada.statusCode,
      `confirmação da expedição falhou: ${confirmada.body}`,
    ).toBeLessThan(400);

    // ── A regra ───────────────────────────────────────────────────────────
    const corpo = (
      await app.inject({ method: "GET", url: `/lots/${loteAcabadoId}/traceability` })
    ).json();

    // A saída física existe, e é a do Pedido B — não a do Pedido da OP.
    expect(corpo.commercialDestination.shipments.length).toBe(1);
    const saidaLida = corpo.commercialDestination.shipments[0];
    expect(saidaLida.customerOrderCode).toBe(confirmado.json().code);
    expect(saidaLida.customerName).toBe(clienteB.legalName);

    // E a ORIGEM continua sendo o Pedido A: origem e destino são campos
    // diferentes, e trocá-los foi exatamente o defeito.
    expect(corpo.commercialDestination.customerOrderCode).toBe(pedidoA.code);
    expect(corpo.commercialDestination.customerName).toBe(clienteA.legalName);

    await app.close();
  });

  it("404 para lote inexistente", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: `/lots/00000000-0000-0000-0000-000000000000/traceability` });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
