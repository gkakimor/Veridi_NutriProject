import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { buildAttentionList } from "./attention.service.js";
import { getProductionOrdersWithShortage } from "./dashboard.queries.js";

/**
 * "OP com falta" do Painel respeita o dono do estoque —
 * VERIDI-AUDIT-QUICK-FIXES-01, D4.
 *
 * A OP e o R-04 medem a falta com `computeRequirementAvailability` e o escopo
 * de propriedade da necessidade: material da Veridi só olha lote da Veridi,
 * material do cliente só olha lote DAQUELE cliente. A liberação reserva pela
 * mesma régua. O Painel somava o estoque de todos os donos: material do
 * cliente "coberto" por estoque da Veridi (e o inverso) sumia do Painel, e a
 * liberação da mesma OP era recusada por falta.
 *
 * Painel e liberação precisam concordar, nos dois sentidos.
 */

const app = buildTestApp();
const itemIds: string[] = [];
const produtoIds: string[] = [];
const opIds: string[] = [];
const clienteIds: string[] = [];

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const unidades: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unidade of unidades) {
    await getPrisma().unitOfMeasure.upsert({ where: { code: unidade.code }, update: {}, create: unidade });
  }
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (opIds.length > 0) {
    const reservas = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: opIds } },
      select: { id: true },
    });
    const reservaIds = reservas.map((reserva) => reserva.id);
    if (reservaIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservaIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservaIds } } });
    }
    await prisma.productionOrderRequirement.deleteMany({ where: { productionOrderId: { in: opIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: opIds } } });
  }
  if (produtoIds.length > 0) {
    const versoes = await prisma.formulationVersion.findMany({
      where: { productId: { in: produtoIds } },
      select: { id: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersionId: { in: versoes.map((versao) => versao.id) } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.product.deleteMany({ where: { id: { in: produtoIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (clienteIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: clienteIds } } });
  }
  await app.close();
});

async function criarCliente() {
  const m = marca();
  const cliente = await getPrisma().customer.create({
    data: { code: `CLI-D4P-${m}`, legalName: `Cliente D4 ${m}`, active: true },
  });
  clienteIds.push(cliente.id);
  return cliente;
}

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode: string) {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-D4P-${m}`,
      name: `Item D4 ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itemIds.push(item.id);
  return item;
}

async function estoque(
  itemId: string,
  quantidade: string,
  dono: { ownerType: "VERIDI" } | { ownerType: "CUSTOMER"; customerId: string },
) {
  const prisma = getPrisma();
  const lote = await prisma.lot.create({
    data: {
      code: `LT-D4P-${marca()}`,
      itemId,
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
      ownerType: dono.ownerType,
      ...(dono.ownerType === "CUSTOMER" ? { ownerCustomerId: dono.customerId } : {}),
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lote.id,
      type: "RECEIPT_IN",
      quantity: quantidade,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
}

/** OP planejada de 10 un, uma necessidade de 1 kg por unidade do material. */
async function opPlanejada(clienteId: string, materialId: string, responsabilidade: "VERIDI" | "CUSTOMER") {
  const acabado = await criarItem("FINISHED_PRODUCT", "un");
  const produto = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Produto D4 ${marca()}`, finishedProductItemId: acabado.id, customerId: clienteId },
    })
  ).json();
  produtoIds.push(produto.id);
  const versao = (
    await app.inject({ method: "POST", url: `/products/${produto.id}/formulation-versions`, payload: {} })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.id}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: materialId, quantity: "1", unitCode: "kg", supplyResponsibility: responsabilidade }],
    },
  });
  const ativada = await app.inject({ method: "POST", url: `/formulation-versions/${versao.id}/activate` });
  expect(ativada.statusCode, ativada.body).toBe(200);

  const criada = (
    await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: produto.id, plannedQuantity: "10" },
    })
  ).json();
  opIds.push(criada.id);
  await aplicarRoteiroDeTeste(criada.id);
  const planejada = await app.inject({ method: "POST", url: `/production-orders/${criada.id}/plan` });
  expect(planejada.statusCode, planejada.body).toBe(200);
  return planejada.json() as { id: string; requirements: { shortage: string; supplyResponsibility: string }[] };
}

/** O que o Painel diz da OP — contador e lista de atenção. */
async function noPainel(opId: string): Promise<{ contador: boolean; atencao: boolean }> {
  const agora = new Date();
  const comFalta = await getProductionOrdersWithShortage(getPrisma(), agora);
  const atencao = await buildAttentionList(getPrisma(), agora);
  return {
    contador: comFalta.some((op) => op.id === opId),
    atencao: atencao.some((item) => item.type === "PRODUCTION_ORDER_SHORTAGE" && item.targetId === opId),
  };
}

async function liberar(opId: string) {
  return app.inject({ method: "POST", url: `/production-orders/${opId}/release` });
}

describe("D4 — Painel e liberação da OP medem a falta pelo mesmo dono", () => {
  it("1. estoque só da Veridi e a OP exige material do cliente: o Painel acusa a falta", async () => {
    const cliente = await criarCliente();
    const material = await criarItem("RAW_MATERIAL", "kg");
    await estoque(material.id, "50", { ownerType: "VERIDI" });

    const op = await opPlanejada(cliente.id, material.id, "CUSTOMER");
    expect(op.requirements[0]!.shortage).toBe("10");

    expect(await noPainel(op.id), "Painel da OP com material do cliente").toEqual({ contador: true, atencao: true });
    expect((await liberar(op.id)).statusCode).toBe(400);
  });

  it("2. estoque só do cliente e a OP exige material da Veridi: o Painel acusa a falta", async () => {
    const cliente = await criarCliente();
    const material = await criarItem("RAW_MATERIAL", "kg");
    await estoque(material.id, "50", { ownerType: "CUSTOMER", customerId: cliente.id });

    const op = await opPlanejada(cliente.id, material.id, "VERIDI");
    expect(op.requirements[0]!.shortage).toBe("10");

    expect(await noPainel(op.id), "Painel da OP com material da Veridi").toEqual({ contador: true, atencao: true });
    expect((await liberar(op.id)).statusCode).toBe(400);
  });

  it("3. o dono certo tem o suficiente: nem o Painel acusa, e a OP libera", async () => {
    const cliente = await criarCliente();
    const doCliente = await criarItem("RAW_MATERIAL", "kg");
    await estoque(doCliente.id, "50", { ownerType: "CUSTOMER", customerId: cliente.id });
    const daVeridi = await criarItem("RAW_MATERIAL", "kg");
    await estoque(daVeridi.id, "50", { ownerType: "VERIDI" });

    const opCliente = await opPlanejada(cliente.id, doCliente.id, "CUSTOMER");
    const opVeridi = await opPlanejada(cliente.id, daVeridi.id, "VERIDI");
    expect(opCliente.requirements[0]!.shortage).toBe("0");
    expect(opVeridi.requirements[0]!.shortage).toBe("0");

    expect(await noPainel(opCliente.id)).toEqual({ contador: false, atencao: false });
    expect(await noPainel(opVeridi.id)).toEqual({ contador: false, atencao: false });
    expect((await liberar(opCliente.id)).statusCode).toBe(200);
    expect((await liberar(opVeridi.id)).statusCode).toBe(200);
  });
});
