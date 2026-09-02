import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Consumo além do reservado — a ampliação explícita.
 *
 * O VAL-LEG-01 pesou 1,33 kg de cafeína contra 1,333333 planejados e
 * quis registrar o desvio contrário: um pouco a MAIS. O sistema recusou,
 * e não havia caminho nenhum — nem no consumo, nem na tela dedicada de
 * Picking. Um evento corriqueiro de chão de fábrica simplesmente não
 * cabia no registro, e as saídas que sobravam falsificavam o histórico.
 *
 * O limite continua onde estava: consumo nunca passa do reservado. O que
 * passou a existir é o ato de ampliar a reserva, com motivo, saldo
 * conferido e autoria — e só então consumir.
 *
 * O caso da auditoria é o primeiro teste aqui, com os números reais.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let supplierId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const m = marca();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-EXTRA-${m}`, legalName: `Fornecedor Extra ${m}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((row) => row.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds }, replacesLineId: { not: null } },
      });
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    // O apontamento de produção deixa lote de PA, movimento e snapshot de
    // custo pendurados na OP — a ordem de remoção segue as dependências.
    const lotesPA = await prisma.productionOutput.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { lotId: true },
    });
    const lotePAIds = lotesPA.map((row) => row.lotId).filter((id): id is string => id !== null);
    await prisma.productionOrderCostSnapshot.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    if (lotePAIds.length > 0) {
      await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: lotePAIds } } });
      await prisma.lot.deleteMany({ where: { id: { in: lotePAIds } } });
    }
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarItem(overrides: { controlsLot?: boolean } = {}) {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-EXTRA-${m}`,
      name: `Material Extra ${m}`,
      unitCode: "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function receber(
  itemId: string,
  quantity: string,
  overrides: { status?: LotStatus; expiryDate?: Date | null; ownerCustomerId?: string } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-EXTRA-${marca()}`.toUpperCase(),
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate !== undefined ? { expiryDate: overrides.expiryDate } : {}),
      ...(overrides.ownerCustomerId
        ? { ownerType: "CUSTOMER" as const, ownerCustomerId: overrides.ownerCustomerId }
        : {}),
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

async function criarProdutoComFormulacao(
  app: App,
  componentes: { itemId: string; quantity: string; unitCode: string }[],
) {
  const prisma = getPrisma();
  const m = marca();
  const acabado = await prisma.item.create({
    data: { type: "FINISHED_PRODUCT", code: `PA-EXTRA-${m}`, name: `PA Extra ${m}`, unitCode: "un" },
  });
  fixtureItemIds.push(acabado.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto Extra ${m}`, finishedProductItemId: acabado.id },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const versao = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.id}`,
    payload: { basisQuantity: "1", components: componentes },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versao.id}/activate` });
  return product;
}

async function criarOrdemLiberada(app: App, productId: string, plannedQuantity = "1") {
  const criadaResp = await app.inject({ method: "POST", url: "/production-orders", payload: { productId, plannedQuantity } });
  if (criadaResp.statusCode >= 400) throw new Error(`create OP ${criadaResp.statusCode}: ${criadaResp.body}`);
  const criada = criadaResp.json();
  fixtureProductionOrderIds.push(criada.id);
  const plan = await app.inject({ method: "POST", url: `/production-orders/${criada.id}/plan` });
  if (plan.statusCode >= 400) throw new Error(`plan ${plan.statusCode}: ${plan.body}`);
  const rel = await app.inject({ method: "POST", url: `/production-orders/${criada.id}/release` });
  if (rel.statusCode >= 400) throw new Error(`release ${rel.statusCode}: ${rel.body}`);
  return rel.json();
}

/**
 * O cenário do VAL-LEG-01, com os números da auditoria: a formulação pede
 * 1,333333 kg e o lote tem 5 kg no total — 3,666667 kg livres depois da
 * reserva.
 */
async function cenarioAuditoria(app: App) {
  const material = await criarItem();
  const lote = await receber(material.id, "5");
  const product = await criarProdutoComFormulacao(app, [
    { itemId: material.id, quantity: "1.333333", unitCode: "kg" },
  ]);
  const order = await criarOrdemLiberada(app, product.id);
  const linha = order.requirements[0].reservationLines[0];
  await app.inject({
    method: "POST",
    url: `/production-orders/${order.id}/picking/${linha.id}/confirm`,
    payload: { lotCode: lote.code },
  });
  return { material, lote, order, linhaId: linha.id as string };
}

const url = (orderId: string, lineId: string) =>
  `/production-orders/${orderId}/picking/${lineId}/extra`;

describe("Ampliação explícita da reserva", () => {
  it("o caso da auditoria: 1,333333 reservado, amplia 0,006667, consome 1,34", async () => {
    const app = buildTestApp();
    await app.ready();
    const { material, lote, order, linhaId } = await cenarioAuditoria(app);

    const ampliacao = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.006667", reason: "Ajuste de consumo durante produção" },
    });
    expect(ampliacao.statusCode).toBe(201);

    const requisito = ampliacao.json().requirements[0];
    // A linha original permanece intacta ao lado da nova.
    expect(requisito.allocatedQuantity).toBe("1.34");
    const linhas = requisito.reservationLines as {
      id: string;
      quantity: string;
      extraReason: string | null;
    }[];
    expect(linhas).toHaveLength(2);
    const original = linhas.find((linha) => linha.id === linhaId)!;
    expect(original.quantity).toBe("1.333333");
    expect(original.extraReason).toBeNull();
    const extra = linhas.find((linha) => linha.id !== linhaId)!;
    expect(extra.quantity).toBe("0.006667");
    expect(extra.extraReason).toBe("Ajuste de consumo durante produção");

    // E agora o consumo real de 1,34 kg passa — nas duas linhas.
    const consumo = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: {
        entries: [
          { reservationLineId: original.id, quantity: "1.333333" },
          { reservationLineId: extra.id, quantity: "0.006667" },
        ],
      },
    });
    expect(consumo.statusCode).toBe(201);

    // Estoque: 5 − 1,34 = 3,66.
    const posicao = await app.inject({ method: "GET", url: `/inventory?search=${material.code}` });
    const linhaEstoque = posicao.json().items[0];
    expect(linhaEstoque.onHand).toBe("3.66");

    // E a baixa saiu do lote que o Picking apontou, não de um lote
    // qualquer do item.
    const movimentos = await getPrisma().inventoryMovement.aggregate({
      where: { lotId: lote.id, type: "PRODUCTION_CONSUMPTION" },
      _sum: { quantity: true },
    });
    expect(movimentos._sum.quantity?.toString()).toBe("1.34");

    await app.close();
  });

  it("a ampliação já nasce conferida — não pede um segundo Picking", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "Perda no transporte interno" },
    });
    const extra = (resposta.json().requirements[0].reservationLines as { id: string; pickingStatus: string }[]).find(
      (linha) => linha.id !== linhaId,
    )!;
    expect(extra.pickingStatus).toBe("CONFIRMED");

    await app.close();
  });

  it("registra motivo, autor e data — a evidência não é opcional", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.25", reason: "Reprocesso de batelada" },
    });
    const extra = (
      resposta.json().requirements[0].reservationLines as {
        id: string;
        extraReason: string | null;
        extraRequestedBy: string | null;
        extraRequestedAt: string | null;
      }[]
    ).find((linha) => linha.id !== linhaId)!;

    expect(extra.extraReason).toBe("Reprocesso de batelada");
    expect(extra.extraRequestedBy).toBeTruthy();
    expect(extra.extraRequestedAt).toBeTruthy();

    await app.close();
  });

  it("sem motivo, não amplia", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "   " },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");

    await app.close();
  });

  it("quantidade zero ou negativa não é ampliação", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    for (const quantity of ["0", "-1"]) {
      const resposta = await app.inject({
        method: "POST",
        url: url(order.id, linhaId),
        payload: { quantity, reason: "Teste" },
      });
      expect(resposta.statusCode).toBe(400);
    }

    await app.close();
  });
});

describe("O que a ampliação nunca pode tomar", () => {
  it("não passa do saldo livre do lote", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    // Livre = 5 − 1,333333 = 3,666667. Pedir 4 é pedir o que não existe.
    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "4", reason: "Tentativa acima do livre" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("no_unreserved_stock");
    expect(resposta.json().message).toContain("3.666667");

    await app.close();
  });

  it("estoque reservado por OUTRA OP é intocável", async () => {
    const app = buildTestApp();
    await app.ready();

    const material = await criarItem();
    const lote = await receber(material.id, "10");

    // Duas OPs do mesmo material, no mesmo lote: A reserva 2, B reserva 7.
    const produtoA = await criarProdutoComFormulacao(app, [
      { itemId: material.id, quantity: "2", unitCode: "kg" },
    ]);
    const produtoB = await criarProdutoComFormulacao(app, [
      { itemId: material.id, quantity: "7", unitCode: "kg" },
    ]);
    const ordemA = await criarOrdemLiberada(app, produtoA.id);
    await criarOrdemLiberada(app, produtoB.id);

    const linhaA = ordemA.requirements[0].reservationLines[0].id;
    await app.inject({
      method: "POST",
      url: `/production-orders/${ordemA.id}/picking/${linhaA}/confirm`,
      payload: { lotCode: lote.code },
    });

    // Fisicamente há 10 e A só usa 2 — mas 7 pertencem a B. Livre: 1.
    const resposta = await app.inject({
      method: "POST",
      url: url(ordemA.id, linhaA),
      payload: { quantity: "3", reason: "Tentando puxar o que é da outra ordem" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("no_unreserved_stock");
    expect(resposta.json().message).toContain("1");

    // E 1 kg, que é realmente livre, passa.
    const dentroDoLimite = await app.inject({
      method: "POST",
      url: url(ordemA.id, linhaA),
      payload: { quantity: "1", reason: "Dentro do saldo livre" },
    });
    expect(dentroDoLimite.statusCode).toBe(201);

    await app.close();
  });

  it("lote bloqueado não vira reserva", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId, lote } = await cenarioAuditoria(app);

    await getPrisma().lot.update({ where: { id: lote.id }, data: { status: "BLOCKED" } });

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "Lote bloqueado" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("lot_not_eligible");

    await app.close();
  });

  it("lote que venceu DEPOIS da liberação não pode ser ampliado", async () => {
    const app = buildTestApp();
    await app.ready();
    // Um lote vencido nunca chega a ser reservado. O caso real é o outro:
    // a OP reservou um lote válido e ele venceu enquanto a produção
    // corria. Ampliar nele seria reservar o que ninguém pode usar.
    const { order, linhaId, lote } = await cenarioAuditoria(app);

    await getPrisma().lot.update({
      where: { id: lote.id },
      data: { expiryDate: new Date(Date.now() - 864e5) },
    });

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "Lote vencido durante a produção" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("lot_not_eligible");

    await app.close();
  });

  it("lote de outro item é recusado", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    const outroMaterial = await criarItem();
    const outroLote = await receber(outroMaterial.id, "50");

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "1", reason: "Lote errado", lotCode: outroLote.code },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("extra_reservation_lot_item_mismatch");

    await app.close();
  });

  it("lote de propriedade de cliente não entra em OP da Veridi", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId, material } = await cenarioAuditoria(app);

    const prisma = getPrisma();
    const cliente = await prisma.customer.create({
      data: { code: `CLI-EXTRA-${marca()}`, legalName: `Cliente Extra ${marca()}` },
    });
    fixtureCustomerIds.push(cliente.id);
    const loteDoCliente = await receber(material.id, "20", { ownerCustomerId: cliente.id });

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "1", reason: "Material de cliente", lotCode: loteDoCliente.code },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("alternate_lot_owner_mismatch");

    await app.close();
  });
});

describe("Ampliação em outro lote", () => {
  it("quando o lote original não tem saldo, outro lote elegível serve", async () => {
    const app = buildTestApp();
    await app.ready();

    const material = await criarItem();
    // Primeiro lote justo: a OP reserva tudo o que ele tem.
    const loteJusto = await receber(material.id, "2");
    const product = await criarProdutoComFormulacao(app, [
      { itemId: material.id, quantity: "2", unitCode: "kg" },
    ]);
    const order = await criarOrdemLiberada(app, product.id);
    const linhaId = order.requirements[0].reservationLines[0].id;
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${linhaId}/confirm`,
      payload: { lotCode: loteJusto.code },
    });

    // No lote original não há nada livre.
    const semSaldo = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "Sem saldo no lote original" },
    });
    expect(semSaldo.statusCode).toBe(400);
    expect(semSaldo.json().error).toBe("no_unreserved_stock");

    // Com um segundo lote, o operador escolhe explicitamente — o sistema
    // nunca troca de lote por conta própria.
    const segundoLote = await receber(material.id, "8");
    const comLote = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "Complemento do segundo lote", lotCode: segundoLote.code },
    });
    expect(comLote.statusCode).toBe(201);

    const extra = (
      comLote.json().requirements[0].reservationLines as { id: string; lotCode: string }[]
    ).find((linha) => linha.id !== linhaId)!;
    expect(extra.lotCode).toBe(segundoLote.code);

    await app.close();
  });
});

describe("Ampliação e o resto do domínio", () => {
  it("concluir a OP libera a reserva ampliada não consumida — sem estoque preso", async () => {
    const app = buildTestApp();
    await app.ready();
    const { material, order, linhaId } = await cenarioAuditoria(app);

    await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "1", reason: "Ampliação que não será consumida" },
    });

    // Consome só a linha original e conclui.
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: linhaId, quantity: "1.333333" }] },
    });
    const out = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: {
        quantity: "1",
        destination: "NEW_LOT",
        businessLotNumber: `L-${marca()}`,
        expiryDate: new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10),
      },
    });
    if (out.statusCode >= 400) throw new Error(`outputs ${out.statusCode}: ${out.body}`);
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: { completionReason: "Concluída com ampliação não consumida" },
    });

    const posicao = await app.inject({ method: "GET", url: `/inventory?search=${material.code}` });
    const linha = posicao.json().items[0];
    // 5 − 1,333333 consumidos = 3,666667 físicos, nada mais reservado.
    expect(linha.reserved).toBe("0");
    expect(linha.available).toBe("3.666667");

    await app.close();
  });

  it("o consumo da ampliação entra no custo realizado da OP", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.666667", reason: "Ampliação com custo" },
    });
    const extraId = (resposta.json().requirements[0].reservationLines as { id: string }[]).find(
      (linha) => linha.id !== linhaId,
    )!.id;

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: {
        entries: [
          { reservationLineId: linhaId, quantity: "1.333333" },
          { reservationLineId: extraId, quantity: "0.666667" },
        ],
      },
    });

    const custo = await app.inject({ method: "GET", url: `/production-orders/${order.id}/material-cost` });
    const consumos = custo.json().consumptions as { quantity: string }[];
    const total = consumos.reduce((soma, linha) => soma + Number(linha.quantity), 0);
    // 1,333333 + 0,666667 = 2 — o custo lê o consumo real, incluindo a
    // ampliação, sem uma lógica paralela para "material extra".
    expect(total).toBeCloseTo(2, 6);

    await app.close();
  });

  it("OP concluída não aceita mais ampliação", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, linhaId } = await cenarioAuditoria(app);

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: linhaId, quantity: "1.333333" }] },
    });
    const out = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: {
        quantity: "1",
        destination: "NEW_LOT",
        businessLotNumber: `L-${marca()}`,
        expiryDate: new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10),
      },
    });
    if (out.statusCode >= 400) throw new Error(`outputs ${out.statusCode}: ${out.body}`);
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: { completionReason: "Concluída" },
    });

    const resposta = await app.inject({
      method: "POST",
      url: url(order.id, linhaId),
      payload: { quantity: "0.5", reason: "Tarde demais" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("order_not_released");

    await app.close();
  });
});
