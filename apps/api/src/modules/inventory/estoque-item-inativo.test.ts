import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { getOnHand } from "../../lib/inventory-ledger.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * INVENTORY-INACTIVE-ITEM-VISIBILITY-01 (§107) — item inativo não some do
 * estoque físico.
 *
 * - D1: inativo COM posição (saldo, reservado ou em compra > 0) aparece na
 *   visão de Estoque, com `itemActive: false`;
 * - D2: inativo SEM posição fica fora por padrão e entra com
 *   `includeInactiveWithoutPosition=true`; o CSV devolve o mesmo recorte;
 * - D3: contagem rápida, saída e perda aceitam inativo; entrada manual recusa.
 *
 * Cada critério de posição tem um item só com ele: saldo por lote, reserva de
 * Pedido sem saldo nenhum, compra aberta sem saldo nenhum.
 */

const criados = {
  itens: [] as string[],
  produtos: [] as string[],
  pedidos: [] as string[],
  ordensDeCompra: [] as string[],
  fornecedores: [] as string[],
};

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  const pedidos = { customerOrderId: { in: criados.pedidos } };
  await prisma.customerOrderReservationLine.deleteMany({ where: { reservation: pedidos } });
  await prisma.customerOrderReservation.deleteMany({ where: pedidos });
  await prisma.customerOrderLine.deleteMany({ where: pedidos });
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ordensDeCompra } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  const posicoes = await prisma.stockCountPosition.findMany({
    where: { itemId: { in: criados.itens } },
    select: { stockCountId: true },
  });
  const sessoes = [...new Set(posicoes.map((posicao) => posicao.stockCountId))];
  if (sessoes.length > 0) await prisma.stockCount.deleteMany({ where: { id: { in: sessoes } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
});

async function criarItem(
  code: string,
  opcoes: { active: boolean; controlsLot?: boolean; type?: "RAW_MATERIAL" | "FINISHED_PRODUCT" },
) {
  const item = await getPrisma().item.create({
    data: {
      type: opcoes.type ?? "RAW_MATERIAL",
      code,
      name: `Item da visão de estoque ${code}`,
      unitCode: "kg",
      controlsLot: opcoes.controlsLot ?? false,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: opcoes.active,
    },
  });
  criados.itens.push(item.id);
  return item;
}

async function receber(itemId: string, lotId: string | null, quantity: string) {
  await getPrisma().inventoryMovement.create({
    data: { itemId, lotId, type: "RECEIPT_IN", quantity, occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
  });
}

async function inativar(itemId: string) {
  await getPrisma().item.update({ where: { id: itemId }, data: { active: false } });
}

/** Reserva de Pedido de 5 kg sobre o item, sem movimento de estoque: reservado sem saldo. */
async function reservarPorPedido(itemId: string, m: string) {
  const prisma = getPrisma();
  const produto = await prisma.product.create({
    data: { code: `PROD-INA-${m}`, name: `Produto ${m}`, customerId: await fixtureCustomerId(), finishedProductItemId: itemId },
  });
  criados.produtos.push(produto.id);
  const pedido = await prisma.customerOrder.create({
    data: { code: `PED-INA-${m}`, customerId: await fixtureCustomerId(), status: "IN_FULFILLMENT" },
  });
  criados.pedidos.push(pedido.id);
  const linha = await prisma.customerOrderLine.create({
    data: { customerOrderId: pedido.id, productId: produto.id, orderedQuantity: "5", unitCode: "kg", position: 0 },
  });
  const reserva = await prisma.customerOrderReservation.create({ data: { customerOrderId: pedido.id } });
  await prisma.customerOrderReservationLine.create({
    data: { reservationId: reserva.id, customerOrderLineId: linha.id, productId: produto.id, itemId, quantity: "5" },
  });
}

/** OC confirmada com 30 kg do item e nada recebido: em compra sem saldo. */
async function comprar(item: { id: string; code: string; name: string }, m: string) {
  const prisma = getPrisma();
  const fornecedor = await prisma.supplier.create({ data: { code: `FOR-INA-${m}`, legalName: `Fornecedor ${m}` } });
  criados.fornecedores.push(fornecedor.id);
  const ordem = await prisma.purchaseOrder.create({
    data: {
      code: `OC-INA-${m}`,
      supplierId: fornecedor.id,
      supplierCode: fornecedor.code,
      supplierName: fornecedor.legalName,
      orderDate: new Date(),
      status: "ORDERED",
      lines: {
        create: [{ itemId: item.id, itemCode: item.code, itemName: item.name, unitCode: "kg", orderedQuantity: "30" }],
      },
    },
  });
  criados.ordensDeCompra.push(ordem.id);
}

interface Cenario {
  busca: string;
  ativoSemPosicao: string;
  inativoComSaldo: { id: string; code: string };
  inativoComReserva: { id: string; code: string };
  inativoEmCompra: string;
  inativoSemPosicao: string;
}

let cenario: Cenario;

beforeAll(async () => {
  const m = marca();
  const busca = `INA-${m}`;

  const ativoSemPosicao = await criarItem(`MP-${busca}-A`, { active: true });

  const inativoComSaldo = await criarItem(`MP-${busca}-B`, { active: true, controlsLot: true });
  const lote = await getPrisma().lot.create({
    data: { code: `LT-${busca}-B`, itemId: inativoComSaldo.id, initialReceivedQuantity: "40", status: "AVAILABLE" },
  });
  await receber(inativoComSaldo.id, lote.id, "40");
  await inativar(inativoComSaldo.id);

  const inativoComReserva = await criarItem(`PA-${busca}-C`, { active: true, type: "FINISHED_PRODUCT" });
  await reservarPorPedido(inativoComReserva.id, m);
  await inativar(inativoComReserva.id);

  const inativoEmCompra = await criarItem(`MP-${busca}-D`, { active: true });
  await comprar(inativoEmCompra, m);
  await inativar(inativoEmCompra.id);

  const inativoSemPosicao = await criarItem(`MP-${busca}-E`, { active: false });

  cenario = {
    busca,
    ativoSemPosicao: ativoSemPosicao.code,
    inativoComSaldo: { id: inativoComSaldo.id, code: inativoComSaldo.code },
    inativoComReserva: { id: inativoComReserva.id, code: inativoComReserva.code },
    inativoEmCompra: inativoEmCompra.code,
    inativoSemPosicao: inativoSemPosicao.code,
  };
});

type App = ReturnType<typeof buildTestApp>;

interface LinhaDaLista {
  itemCode: string;
  itemActive: boolean;
  onHand: string;
  reserved: string;
  onOrder: string;
}

async function daLista(app: App, filtros: Record<string, string> = {}): Promise<LinhaDaLista[]> {
  const qs = new URLSearchParams({ search: cenario.busca, pageSize: "100", ...filtros }).toString();
  const resposta = await app.inject({ method: "GET", url: `/inventory?${qs}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json().items as LinhaDaLista[];
}

/** Código (1ª coluna) e "Item ativo" de cada linha do CSV, lidos pelo cabeçalho. */
async function doCsv(app: App, filtros: Record<string, string> = {}): Promise<{ code: string; ativo: string }[]> {
  const qs = new URLSearchParams({ search: cenario.busca, ...filtros }).toString();
  const resposta = await app.inject({ method: "GET", url: `/inventory/export.csv?${qs}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  const [cabecalho, ...linhas] = resposta.body
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((linha) => linha.length > 0);
  const colunas = (cabecalho ?? "").split(";");
  const coluna = colunas.indexOf("Item ativo");
  expect(coluna, cabecalho ?? "").toBeGreaterThan(0);
  return linhas.map((linha) => {
    const campos = linha.split(";");
    return { code: campos[0]!, ativo: campos[coluna]! };
  });
}

const codigos = (linhas: { itemCode: string }[]) => linhas.map((linha) => linha.itemCode).sort();

describe("Estoque — D1: inativo com posição aparece, marcado", () => {
  it("saldo, reservado e em compra, cada um sozinho, mantêm o inativo na visão padrão", async () => {
    const app = buildTestApp();
    await app.ready();

    const lista = await daLista(app);
    const porCodigo = new Map(lista.map((linha) => [linha.itemCode, linha]));

    expect(porCodigo.get(cenario.inativoComSaldo.code)).toMatchObject({ itemActive: false, onHand: "40", reserved: "0", onOrder: "0" });
    expect(porCodigo.get(cenario.inativoComReserva.code)).toMatchObject({ itemActive: false, onHand: "0", reserved: "5", onOrder: "0" });
    expect(porCodigo.get(cenario.inativoEmCompra)).toMatchObject({ itemActive: false, onHand: "0", reserved: "0", onOrder: "30" });
    expect(porCodigo.get(cenario.ativoSemPosicao)).toMatchObject({ itemActive: true, onHand: "0", reserved: "0", onOrder: "0" });

    await app.close();
  });
});

describe("Estoque — D2: inativo sem posição só a pedido, e o CSV igual à lista", () => {
  it("fora por padrão; `includeInactiveWithoutPosition=true` traz, marcado", async () => {
    const app = buildTestApp();
    await app.ready();

    const comPosicao = [
      cenario.ativoSemPosicao,
      cenario.inativoComSaldo.code,
      cenario.inativoComReserva.code,
      cenario.inativoEmCompra,
    ].sort();
    expect(codigos(await daLista(app))).toEqual(comPosicao);
    expect(codigos(await daLista(app, { includeInactiveWithoutPosition: "false" }))).toEqual(comPosicao);

    const comFiltro = await daLista(app, { includeInactiveWithoutPosition: "true" });
    expect(codigos(comFiltro)).toEqual([...comPosicao, cenario.inativoSemPosicao].sort());
    expect(comFiltro.find((linha) => linha.itemCode === cenario.inativoSemPosicao)?.itemActive).toBe(false);

    await app.close();
  });

  it("`onlyWithStock` continua só com saldo físico, com e sem o filtro de inativos", async () => {
    const app = buildTestApp();
    await app.ready();

    expect(codigos(await daLista(app, { onlyWithStock: "true" }))).toEqual([cenario.inativoComSaldo.code]);
    expect(
      codigos(await daLista(app, { onlyWithStock: "true", includeInactiveWithoutPosition: "true" })),
    ).toEqual([cenario.inativoComSaldo.code]);

    await app.close();
  });

  const RECORTES: [string, Record<string, string>][] = [
    ["padrão", {}],
    ["com inativos sem posição", { includeInactiveWithoutPosition: "true" }],
    ["somente com estoque", { onlyWithStock: "true" }],
    ["os dois filtros", { onlyWithStock: "true", includeInactiveWithoutPosition: "true" }],
  ];

  it.each(RECORTES)("CSV %s: mesmas linhas da lista, com a situação do item", async (_nome, filtros) => {
    const app = buildTestApp();
    await app.ready();

    const lista = await daLista(app, filtros);
    const csv = await doCsv(app, filtros);
    expect(csv.map((linha) => linha.code).sort()).toEqual(codigos(lista));
    for (const linha of csv) {
      const daTela = lista.find((item) => item.itemCode === linha.code);
      expect(linha.ativo, linha.code).toBe(daTela?.itemActive ? "Sim" : "Não");
    }

    await app.close();
  });

  it.each(["0", "1", "yes", "", "TRUE"])("includeInactiveWithoutPosition=%j é 400 na lista e no CSV", async (valor) => {
    const app = buildTestApp();
    await app.ready();
    const qs = new URLSearchParams({ includeInactiveWithoutPosition: valor }).toString();
    for (const url of [`/inventory?${qs}`, `/inventory/export.csv?${qs}`]) {
      const resposta = await app.inject({ method: "GET", url });
      expect(resposta.statusCode, url).toBe(400);
      expect(resposta.json().error).toBe("validation_error");
    }
    await app.close();
  });
});

describe("Estoque — detalhe do inativo", () => {
  it("devolve a situação e não esconde lote, reserva nem movimento", async () => {
    const app = buildTestApp();
    await app.ready();

    const comSaldo = await app.inject({ method: "GET", url: `/inventory/${cenario.inativoComSaldo.id}` });
    expect(comSaldo.statusCode).toBe(200);
    expect(comSaldo.json()).toMatchObject({ itemActive: false, onHand: "40" });
    expect(comSaldo.json().lots).toHaveLength(1);
    expect(comSaldo.json().lots[0]).toMatchObject({ lotCode: `LT-${cenario.busca}-B`, onHand: "40" });

    const movimentos = await app.inject({
      method: "GET",
      url: `/inventory-movements?itemId=${cenario.inativoComSaldo.id}`,
    });
    expect(movimentos.json().total).toBe(1);

    const comReserva = await app.inject({ method: "GET", url: `/inventory/${cenario.inativoComReserva.id}` });
    expect(comReserva.json()).toMatchObject({ itemActive: false, reserved: "5" });

    await app.close();
  });
});

describe("Estoque — D3: operação física do inativo", () => {
  async function inativoComDez() {
    const item = await criarItem(`MP-INA-OP-${marca()}`, { active: true });
    await receber(item.id, null, "10");
    await inativar(item.id);
    return item;
  }

  it("contagem rápida aceita, e a sobra entra pela contagem", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await inativoComDez();

    const resposta = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "12", reason: "Sobra encontrada na contagem", expectedSystemQuantity: "10" },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    expect(resposta.json()).toMatchObject({ systemQuantity: "10", countedQuantity: "12", difference: "2" });
    expect(resposta.json().movementCreated).toMatchObject({ type: "ADJUSTMENT_IN", quantity: "2" });
    expect((await getOnHand(getPrisma(), { itemId: item.id, lotId: null })).toString()).toBe("12");

    await app.close();
  });

  it("saída e perda aceitam; entrada manual recusa sem criar movimento", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await inativoComDez();
    const ajustar = (type: string, quantity: string) =>
      app.inject({
        method: "POST",
        url: "/inventory-adjustments",
        payload: { itemId: item.id, type, quantity, reason: "Ajuste do inativo" },
      });

    expect((await ajustar("ADJUSTMENT_OUT", "2")).statusCode).toBe(201);
    expect((await ajustar("LOSS", "1")).statusCode).toBe(201);

    const entrada = await ajustar("ADJUSTMENT_IN", "5");
    expect(entrada.statusCode).toBe(400);
    expect(entrada.json().error).toBe("inactive_item");
    expect(entrada.json().message).toContain(item.code);

    const prisma = getPrisma();
    expect((await getOnHand(prisma, { itemId: item.id, lotId: null })).toString()).toBe("7");
    expect(await prisma.inventoryMovement.count({ where: { itemId: item.id, type: "ADJUSTMENT_IN" } })).toBe(0);

    await app.close();
  });

  it("item ativo segue recebendo entrada manual", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem(`MP-INA-AT-${marca()}`, { active: true });

    const resposta = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_IN", quantity: "5", reason: "Sobra do ativo" },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);

    await app.close();
  });
});
