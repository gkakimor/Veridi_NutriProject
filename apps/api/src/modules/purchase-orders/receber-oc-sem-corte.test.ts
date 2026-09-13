import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PurchaseOrderStatus } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Receber OC sem corte silencioso (RECEIVING-OPEN-PO-CUTOFF-01).
 *
 * O seletor do Recebimento pedia duas listas de 100 — `status=ORDERED` e
 * `status=PARTIALLY_RECEIVED` — e somava as duas num `<select>`. Da 101ª OC
 * de cada status em diante a ordem estava aberta, o servidor aceitaria o
 * recebimento, e a tela não a oferecia.
 *
 * O seletor passou a perguntar `receivable=true`, com primeira página curta e
 * busca. Aqui se prova o lado do servidor com volume acima do antigo teto:
 * a fila tem TODAS as abertas, pagina de verdade, acha pela busca o que está
 * fora das 100, e responde com a MESMA regra que o recebimento aplica ao
 * gravar — status por status.
 *
 * A fila nasce por `createManyAndReturn`, com o status gravado direto: o
 * assunto é volume e recorte. As OCs cujo saldo importa (a parcial e a
 * finalizada) chegam lá por recebimento real.
 */

type App = ReturnType<typeof buildTestApp>;
type Resumo = { id: string; code: string; status: PurchaseOrderStatus; supplierName: string };

/**
 * A fila, na ordem do servidor (código decrescente; posição 1 = mais recente).
 *
 * Montada para que as duas listas de 100 de antes percam os três alvos:
 * - posição 150 é CONFIRMADA e tem 100 confirmadas acima — a OC #150;
 * - posição 202 é PARCIAL e tem 100 parciais acima;
 * - posição 205 é CONFIRMADA, do fornecedor B, com 103 confirmadas acima.
 */
const FILA = 210;
const POSICAO_OC_150 = 150;
const POSICAO_PARCIAL = 202;
const POSICAO_FORNECEDOR_B = 205;

function statusNaPosicao(posicao: number): PurchaseOrderStatus {
  if (posicao <= 100) return "ORDERED";
  if (posicao < POSICAO_OC_150) return "PARTIALLY_RECEIVED";
  if (posicao === POSICAO_OC_150) return "ORDERED";
  if (posicao <= POSICAO_PARCIAL) return "PARTIALLY_RECEIVED";
  return "ORDERED";
}

const criados = { ordens: [] as string[], fornecedores: [] as string[], itens: [] as string[] };

let app: App;
let m: string;
let fornecedorA: { id: string; code: string; legalName: string };
let fornecedorB: { id: string; code: string; legalName: string };
let itemId: string;
/** Número no código a partir da posição na fila: a mais recente tem o maior. */
const numeroDaPosicao = (posicao: number) => FILA + 1 - posicao;
const codigo = (numero: number) => `OC-${m}-${String(numero).padStart(4, "0")}`;

/** OC com uma linha de 10 kg do item da fixture, no status pedido. */
async function criarOrdens(numeros: number[], status: (numero: number) => PurchaseOrderStatus) {
  const prisma = getPrisma();
  const ordens = await prisma.purchaseOrder.createManyAndReturn({
    data: numeros.map((numero) => {
      const fornecedor = numero === numeroDaPosicao(POSICAO_FORNECEDOR_B) ? fornecedorB : fornecedorA;
      return {
        code: codigo(numero),
        supplierId: fornecedor.id,
        supplierCode: fornecedor.code,
        supplierName: fornecedor.legalName,
        orderDate: new Date("2026-09-01T00:00:00.000Z"),
        status: status(numero),
      };
    }),
  });
  criados.ordens.push(...ordens.map((ordem) => ordem.id));
  await prisma.purchaseOrderLine.createMany({
    data: ordens.map((ordem) => ({
      purchaseOrderId: ordem.id,
      itemId,
      itemCode: `ME-${m}`,
      itemName: `Embalagem Fila ${m}`,
      unitCode: "kg",
      orderedQuantity: "10",
    })),
  });
  return ordens;
}

async function consulta(query: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: `/purchase-orders?${new URLSearchParams(query).toString()}`,
  });
  expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
  const corpo = response.json() as { purchaseOrders: Resumo[]; total: number; page: number; pageSize: number };
  return { ...corpo, codes: corpo.purchaseOrders.map((ordem) => ordem.code) };
}

async function receber(purchaseOrderId: string, quantidade: string) {
  const ordem = (await app.inject({ method: "GET", url: `/purchase-orders/${purchaseOrderId}` })).json();
  return app.inject({
    method: "POST",
    url: `/purchase-orders/${purchaseOrderId}/receipts`,
    payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ purchaseOrderLineId: ordem.lines[0].id, receivedQuantity: quantidade }],
    },
  });
}

async function idDe(code: string): Promise<string> {
  const achada = await consulta({ search: code });
  expect(achada.codes).toEqual([code]);
  return achada.purchaseOrders[0]!.id;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  app = buildTestApp();
  await app.ready();

  m = `RQ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  fornecedorA = await prisma.supplier.create({
    data: { code: `FOR-${m}-A`, legalName: `Fornecedor Doca ${m}` },
  });
  fornecedorB = await prisma.supplier.create({
    data: { code: `FOR-${m}-B`, legalName: `Distribuidora Omega ${m}` },
  });
  criados.fornecedores.push(fornecedorA.id, fornecedorB.id);
  // Sem lote e sem validade: o recebimento aqui é saldo, não rastreabilidade.
  const item = await prisma.item.create({
    data: {
      type: "PACKAGING",
      code: `ME-${m}`,
      name: `Embalagem Fila ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itemId = item.id;
  criados.itens.push(item.id);

  const numerosDaFila = Array.from({ length: FILA }, (_, indice) => numeroDaPosicao(indice + 1));
  // A parcial-alvo nasce confirmada e chega a parcial por recebimento real.
  await criarOrdens(numerosDaFila, (numero) =>
    numero === numeroDaPosicao(POSICAO_PARCIAL) ? "ORDERED" : statusNaPosicao(FILA + 1 - numero),
  );
  // Fora da fila — e com códigos acima de todos, então primeiro na lista geral.
  await criarOrdens([901], () => "ORDERED");
  await criarOrdens([902], () => "CANCELLED");
  await criarOrdens([903], () => "DRAFT");

  const parcial = await receber(await idDe(codigo(numeroDaPosicao(POSICAO_PARCIAL))), "4");
  expect(parcial.statusCode, parcial.body).toBe(201);
  const finalizada = await receber(await idDe(codigo(901)), "10");
  expect(finalizada.statusCode, finalizada.body).toBe(201);
}, 60_000);

afterAll(async () => {
  const prisma = getPrisma();
  // Recebimento leva linhas e movimentos em cascata; a OC leva as linhas dela.
  await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: criados.ordens } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await app?.close();
});

describe("Receber OC — fila de OCs abertas sem corte", () => {
  it("as duas listas de 100 de antes não alcançavam a OC #150, a 101ª parcial nem a OC do fornecedor B", async () => {
    const confirmadas = await consulta({ status: "ORDERED", search: m, pageSize: "100" });
    const parciais = await consulta({ status: "PARTIALLY_RECEIVED", search: m, pageSize: "100" });
    const antigas = new Set([...confirmadas.codes, ...parciais.codes]);

    expect(antigas.size).toBe(200);
    expect(confirmadas.total + parciais.total).toBe(FILA);
    for (const posicao of [POSICAO_OC_150, POSICAO_PARCIAL, POSICAO_FORNECEDOR_B]) {
      expect(antigas.has(codigo(numeroDaPosicao(posicao))), `posição ${posicao}`).toBe(false);
    }
  });

  it("a fila tem as 210 abertas: primeira página de 20, a OC #150 na página 8, e as páginas cobrem tudo", async () => {
    const primeira = await consulta({ receivable: "true", search: m, pageSize: "20" });
    expect(primeira.total).toBe(FILA);
    expect(primeira.codes).toHaveLength(20);
    expect(primeira.codes[0]).toBe(codigo(FILA));
    expect(primeira.codes).not.toContain(codigo(numeroDaPosicao(POSICAO_OC_150)));

    const oitava = await consulta({ receivable: "true", search: m, pageSize: "20", page: "8" });
    expect(oitava.codes.indexOf(codigo(numeroDaPosicao(POSICAO_OC_150)))).toBe(POSICAO_OC_150 - 141);

    const todas: Resumo[] = [];
    for (const page of ["1", "2", "3"]) {
      todas.push(...(await consulta({ receivable: "true", search: m, pageSize: "100", page })).purchaseOrders);
    }
    expect(new Set(todas.map((ordem) => ordem.code)).size).toBe(FILA);
    expect(todas.every((ordem) => ordem.status === "ORDERED" || ordem.status === "PARTIALLY_RECEIVED")).toBe(true);
    for (const fora of [901, 902, 903]) expect(todas.map((ordem) => ordem.code)).not.toContain(codigo(fora));
  });

  it("OC #150: achada pelo código, lida pelo id e recebida — e segue na fila com o saldo", async () => {
    const code = codigo(numeroDaPosicao(POSICAO_OC_150));
    const achada = await consulta({ receivable: "true", search: code, pageSize: "20" });
    expect(achada.codes).toEqual([code]);
    const id = achada.purchaseOrders[0]!.id;

    const lida = (await app.inject({ method: "GET", url: `/purchase-orders/${id}` })).json();
    expect(lida.supplierName).toBe(fornecedorA.legalName);
    expect(lida.lines).toHaveLength(1);
    expect(lida.lines[0].openQuantity).toBe("10");

    const recebida = await receber(id, "3");
    expect(recebida.statusCode, recebida.body).toBe(201);

    const depois = await consulta({ receivable: "true", search: code, pageSize: "20" });
    expect(depois.purchaseOrders.map((ordem) => [ordem.code, ordem.status])).toEqual([[code, "PARTIALLY_RECEIVED"]]);
    const relida = (await app.inject({ method: "GET", url: `/purchase-orders/${id}` })).json();
    expect(relida.lines[0].openQuantity).toBe("7");
  });

  it("fornecedor fora das 100: a busca pelo nome acha a OC, sem diferenciar caixa", async () => {
    const code = codigo(numeroDaPosicao(POSICAO_FORNECEDOR_B));
    const cem = await consulta({ receivable: "true", search: m, pageSize: "100" });
    expect(cem.codes).not.toContain(code);

    const pelaRazao = await consulta({ receivable: "true", search: fornecedorB.legalName, pageSize: "20" });
    expect(pelaRazao.codes).toEqual([code]);
    expect(pelaRazao.purchaseOrders[0]!.supplierName).toBe(fornecedorB.legalName);

    const minusculas = await consulta({ receivable: "true", search: `distribuidora omega ${m.toLowerCase()}` });
    expect(minusculas.codes).toEqual([code]);
  });

  it("PARTIALLY_RECEIVED fora do antigo corte: na fila, com o saldo recebível preservado até fechar", async () => {
    const code = codigo(numeroDaPosicao(POSICAO_PARCIAL));
    const achada = await consulta({ receivable: "true", search: code, pageSize: "20" });
    expect(achada.purchaseOrders.map((ordem) => [ordem.code, ordem.status])).toEqual([[code, "PARTIALLY_RECEIVED"]]);
    const id = achada.purchaseOrders[0]!.id;

    const lida = (await app.inject({ method: "GET", url: `/purchase-orders/${id}` })).json();
    expect(lida.lines[0].receivedQuantity).toBe("4");
    expect(lida.lines[0].openQuantity).toBe("6");

    const acima = await receber(id, "7");
    expect(acima.statusCode).toBe(400);
    expect(acima.json().error).toBe("over_receipt");

    const resto = await receber(id, "6");
    expect(resto.statusCode, resto.body).toBe(201);
    // Sem saldo, ela sai da fila — pela regra de sempre, não por filtro da tela.
    expect((await consulta({ receivable: "true", search: code })).total).toBe(0);
    expect((await consulta({ search: code })).purchaseOrders[0]!.status).toBe("RECEIVED");
  });

  it("finalizada, cancelada e rascunho nunca entram na fila — nem pela busca exata do código", async () => {
    for (const [numero, status] of [
      [901, "RECEIVED"],
      [902, "CANCELLED"],
      [903, "DRAFT"],
    ] as const) {
      const existe = await consulta({ search: codigo(numero) });
      expect(existe.purchaseOrders.map((ordem) => ordem.status)).toEqual([status]);
      expect((await consulta({ receivable: "true", search: codigo(numero) })).total, status).toBe(0);
    }
    const finalizada = (await app.inject({ method: "GET", url: `/purchase-orders/${await idDe(codigo(901))}` })).json();
    expect(finalizada.lines[0].openQuantity).toBe("0");
  });

  it("a fila e o recebimento respondem a mesma regra, status por status", async () => {
    const todos: PurchaseOrderStatus[] = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];
    const ordens = await criarOrdens(
      todos.map((_, indice) => 950 + indice),
      (numero) => todos[numero - 950]!,
    );

    for (const ordem of ordens) {
      const naFila = (await consulta({ receivable: "true", search: ordem.code })).total === 1;
      const resposta = await receber(ordem.id, "1");
      expect(naFila, `${ordem.status}: fila × recebimento`).toBe(resposta.statusCode === 201);
      if (!naFila) expect(resposta.json().error, ordem.status).toBe("invalid_purchase_order_status");
    }
    expect(ordens.filter((ordem) => ordem.status === "ORDERED" || ordem.status === "PARTIALLY_RECEIVED")).toHaveLength(2);
  });

  it("receivable compõe com status pela interseção e recusa o que não é booleano", async () => {
    expect((await consulta({ receivable: "true", status: "DRAFT", search: m })).total).toBe(0);

    const parciais = await consulta({ receivable: "true", status: "PARTIALLY_RECEIVED", search: m, pageSize: "100" });
    expect(parciais.total).toBeGreaterThan(100);
    expect(parciais.purchaseOrders.every((ordem) => ordem.status === "PARTIALLY_RECEIVED")).toBe(true);

    // `false` não restringe: é a lista de sempre.
    expect((await consulta({ receivable: "false", search: codigo(903) })).codes).toEqual([codigo(903)]);

    const invalido = await app.inject({ method: "GET", url: "/purchase-orders?receivable=talvez" });
    expect(invalido.statusCode).toBe(400);
  });
});
