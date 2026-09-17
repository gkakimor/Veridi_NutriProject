import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * COMPONENTE INATIVO NÃO INICIA COMPROMISSO NOVO DE PRODUÇÃO —
 * PRODUCTION-INACTIVE-COMPONENT-GATE-01, `PRODUCT_RULES.md` §116.
 *
 * A formulação foi ativada com o item ativo — a guarda da ativação (§ da
 * bancada) olhou e deixou passar. Depois o item foi inativado no cadastro, e a
 * formulação continua ACTIVE, com os mesmos componentes: inativar item não
 * reescreve receita histórica.
 *
 * O que estes testes protegem é o outro lado: a Produção não assume compromisso
 * NOVO com essa composição. Planejar e liberar recusam, nomeando todos os itens
 * inativos de uma vez; e recusar nunca deixa efeito pela metade — nenhuma
 * reserva, nenhuma parte, nenhuma numeração gasta. O que já foi assumido segue:
 * ordem liberada separa, consome e conclui com o item inativo.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
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
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-CIG-${m}`, legalName: `Fornecedor Componente Inativo ${m}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
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
    const reservationIds = reservations.map((reservation) => reservation.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds }, replacesLineId: { not: null } },
      });
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
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
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-CIG-${m}`,
      name: `Item Componente Inativo ${m}`,
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

async function receiveStock(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-CIG-${marker()}`.toUpperCase(),
      itemId,
      supplierId,
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

/** Produto com PA próprio e formulação V1 ACTIVE de N matérias-primas, todas com estoque. */
async function createCenario(app: App, quantidadeDeMateriais: number) {
  const finishedItem = await createItem("FINISHED_PRODUCT");
  const materiais = [];
  for (let indice = 0; indice < quantidadeDeMateriais; indice += 1) {
    const material = await createItem("RAW_MATERIAL");
    await receiveStock(material.id, "1000");
    materiais.push(material);
  }

  const productResponse = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto Componente Inativo ${marker()}`,
      finishedProductItemId: finishedItem.id,
    },
  });
  const product = productResponse.json();
  fixtureProductIds.push(product.id);

  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const formulationVersionId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulationVersionId}`,
    payload: {
      basisQuantity: "10",
      components: materiais.map((material) => ({
        itemId: material.id,
        quantity: "2",
        unitCode: "kg",
      })),
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulationVersionId}/activate` });

  return { product, finishedItem, materiais, formulationVersionId };
}

/** OP em DRAFT, já com roteiro — pronta para `/plan`. */
async function createDraftOrder(app: App, productId: string) {
  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity: "10" },
  });
  const orderId = created.json().id;
  fixtureProductionOrderIds.push(orderId);
  await aplicarRoteiroDeTeste(orderId);
  return orderId;
}

const planejar = (app: App, orderId: string) =>
  app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });

const liberar = (app: App, orderId: string) =>
  app.inject({ method: "POST", url: `/production-orders/${orderId}/release` });

const inativar = (app: App, itemId: string) =>
  app.inject({ method: "POST", url: `/items/${itemId}/deactivate` });

const reativar = (app: App, itemId: string) =>
  app.inject({ method: "POST", url: `/items/${itemId}/activate` });

async function getOrder(app: App, orderId: string) {
  return (await app.inject({ method: "GET", url: `/production-orders/${orderId}` })).json();
}

/** Confirma o picking e consome integralmente todas as linhas reservadas da ordem. */
async function separarEConsumir(app: App, order: { id: string; requirements: any[] }) {
  for (const requirement of order.requirements) {
    for (const line of requirement.reservationLines) {
      const separada = await app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
        payload: line.lotCode ? { lotCode: line.lotCode } : {},
      });
      expect(separada.statusCode).toBe(200);
      const consumida = await app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/consumptions`,
        payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
      });
      expect(consumida.statusCode).toBe(201);
    }
  }
}

describe("Ordem de Produção — componente inativo não inicia compromisso novo (§116)", () => {
  it("todos os componentes ativos: planeja e libera como antes", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product } = await createCenario(app, 2);
    const orderId = await createDraftOrder(app, product.id);

    const planejada = await planejar(app, orderId);
    expect(planejada.statusCode).toBe(200);
    expect(planejada.json().status).toBe("PLANNED");

    const liberada = await liberar(app, orderId);
    expect(liberada.statusCode).toBe(200);
    expect(liberada.json().status).toBe("RELEASED");
    expect(liberada.json().reservation.status).toBe("ACTIVE");
    // A situação lida agora viaja na necessidade — e é a verdadeira.
    expect(liberada.json().requirements.map((r: { itemActive: boolean }) => r.itemActive)).toEqual([
      true,
      true,
    ]);

    await app.close();
  });

  it("um componente inativado depois: PLANEJAR recusa nomeando item, nome e versão", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product, materiais } = await createCenario(app, 2);
    const orderId = await createDraftOrder(app, product.id);
    expect((await inativar(app, materiais[0]!.id)).statusCode).toBe(200);

    const recusada = await planejar(app, orderId);
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("inactive_component");
    const mensagem: string = recusada.json().message;
    expect(mensagem).toContain(`a formulação V1 do produto ${product.code}`);
    expect(mensagem).toContain(`${materiais[0]!.code} — ${materiais[0]!.name}`);
    expect(mensagem).toContain("que está inativo");
    expect(mensagem).toContain("Reative o item no cadastro para planejar a ordem.");
    // Genérica seria "produto inativo": o item está inativo, e a frase diz qual.
    expect(mensagem).not.toContain(materiais[1]!.code);

    // Nada mudou: a ordem continua rascunho, sem congelar o planejamento.
    const ordem = await getOrder(app, orderId);
    expect(ordem.status).toBe("DRAFT");
    expect(ordem.plannedAt).toBeNull();
    expect(ordem.plannedBy).toBeNull();
    // A tela vê a situação real de cada componente, todos numa leitura só.
    expect(ordem.requirements).toHaveLength(2);
    expect(ordem.requirements[0].itemActive).toBe(false);
    expect(ordem.requirements[1].itemActive).toBe(true);

    await app.close();
  });

  it("componente inativado depois do planejamento: LIBERAR recusa, e nenhum efeito físico nasce", async () => {
    const app = buildTestApp();
    await app.ready();

    const prisma = getPrisma();
    const { product, materiais } = await createCenario(app, 2);
    const orderId = await createDraftOrder(app, product.id);
    expect((await planejar(app, orderId)).statusCode).toBe(200);

    // A inativação acontece DEPOIS do planejamento: a liberação relê.
    expect((await inativar(app, materiais[1]!.id)).statusCode).toBe(200);

    const recusada = await liberar(app, orderId);
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("inactive_component");
    expect(recusada.json().message).toContain(`${materiais[1]!.code} — ${materiais[1]!.name}`);
    expect(recusada.json().message).toContain("Reative o item no cadastro para liberar a ordem.");

    const ordem = await getOrder(app, orderId);
    expect(ordem.status).toBe("PLANNED");
    expect(ordem.reservation).toBeNull();
    expect(ordem.officialNumber).toBeNull();
    expect(ordem.releasedAt).toBeNull();

    // Nem no banco: recusar não deixa reserva parcial do componente ativo.
    expect(await prisma.materialReservation.count({ where: { productionOrderId: orderId } })).toBe(0);
    expect(await prisma.productionOrderPart.count({ where: { productionOrderId: orderId } })).toBe(0);

    // E o estoque do componente ativo continua todo disponível.
    const inventario = await app.inject({ method: "GET", url: `/inventory/${materiais[0]!.id}` });
    expect(inventario.json().reserved).toBe("0");

    await app.close();
  });

  it("mais de um componente inativo: a recusa identifica todos de uma vez", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product, materiais } = await createCenario(app, 3);
    const orderId = await createDraftOrder(app, product.id);
    await inativar(app, materiais[0]!.id);
    await inativar(app, materiais[2]!.id);

    const recusada = await planejar(app, orderId);
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("inactive_component");
    const mensagem: string = recusada.json().message;
    expect(mensagem).toContain("usa 2 itens inativos:");
    expect(mensagem).toContain(`${materiais[0]!.code} — ${materiais[0]!.name}`);
    expect(mensagem).toContain(`${materiais[2]!.code} — ${materiais[2]!.name}`);
    expect(mensagem).not.toContain(materiais[1]!.code);
    expect(mensagem).toContain("Reative os itens no cadastro para planejar a ordem.");

    // Ninguém precisa regularizar um para descobrir o outro: a leitura da
    // ordem traz a situação das três necessidades juntas.
    const ordem = await getOrder(app, orderId);
    expect(ordem.requirements.map((r: { itemActive: boolean }) => r.itemActive)).toEqual([
      false,
      true,
      false,
    ]);

    await app.close();
  });

  it("item reativado antes de começar o compromisso: a operação volta a ser permitida", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product, materiais } = await createCenario(app, 2);
    const orderId = await createDraftOrder(app, product.id);

    await inativar(app, materiais[0]!.id);
    expect((await planejar(app, orderId)).statusCode).toBe(400);

    expect((await reativar(app, materiais[0]!.id)).statusCode).toBe(200);
    const planejada = await planejar(app, orderId);
    expect(planejada.statusCode).toBe(200);
    expect(planejada.json().status).toBe("PLANNED");

    // E o mesmo vale entre planejar e liberar.
    await inativar(app, materiais[1]!.id);
    expect((await liberar(app, orderId)).statusCode).toBe(400);
    await reativar(app, materiais[1]!.id);
    const liberada = await liberar(app, orderId);
    expect(liberada.statusCode).toBe(200);
    expect(liberada.json().status).toBe("RELEASED");

    await app.close();
  });

  it("OP já liberada: inativar o componente depois não cancela, não apaga reserva e não impede separar nem consumir", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product, materiais, formulationVersionId } = await createCenario(app, 2);
    const orderId = await createDraftOrder(app, product.id);
    await planejar(app, orderId);
    const liberada = (await liberar(app, orderId)).json();
    expect(liberada.status).toBe("RELEASED");
    const reservaAntes = liberada.reservation.id;

    // O compromisso já foi assumido — a inativação chega depois dele.
    await inativar(app, materiais[0]!.id);

    const depois = await getOrder(app, orderId);
    expect(depois.status).toBe("RELEASED");
    expect(depois.reservation.id).toBe(reservaAntes);
    expect(depois.reservation.status).toBe("ACTIVE");
    expect(depois.cancelledAt).toBeNull();
    expect(depois.officialNumber).not.toBeNull();
    // A leitura diz a verdade sobre o cadastro, sem parar a operação.
    expect(depois.requirements[0].itemActive).toBe(false);

    // Consultar a formulação continua liberado, e ela segue ACTIVE com os
    // mesmos componentes: a guarda é da Produção, não da receita.
    const versao = await app.inject({
      method: "GET",
      url: `/formulation-versions/${formulationVersionId}`,
    });
    expect(versao.statusCode).toBe(200);
    expect(versao.json().status).toBe("ACTIVE");
    expect(versao.json().components).toHaveLength(2);

    // Separação e consumo autorizados seguem.
    await separarEConsumir(app, depois);
    expect((await getOrder(app, orderId)).status).toBe("IN_PRODUCTION");

    await app.close();
  });

  it("OP em execução: apontar e concluir seguem com o componente inativo", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product, materiais } = await createCenario(app, 2);
    const orderId = await createDraftOrder(app, product.id);
    await planejar(app, orderId);
    const liberada = (await liberar(app, orderId)).json();
    await separarEConsumir(app, liberada);
    expect((await getOrder(app, orderId)).status).toBe("IN_PRODUCTION");

    // Só agora o item é inativado — a OP já está em execução.
    await inativar(app, materiais[0]!.id);

    const apontada = await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/outputs`,
      payload: { quantity: "10", destination: "NEW_LOT", businessLotNumber: `VD-${marker()}` },
    });
    expect(apontada.statusCode).toBe(201);

    const concluida = await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/complete`,
      payload: {},
    });
    expect(concluida.statusCode).toBe(200);
    expect(concluida.json().status).toBe("COMPLETED");

    await app.close();
  });
});
