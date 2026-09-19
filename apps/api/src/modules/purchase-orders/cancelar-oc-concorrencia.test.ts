import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import {
  abrirTransacaoDoTeste,
  esperarAte,
  esperarParadaEm,
  paradasEm,
} from "../../test-support/corrida-sob-trava.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Cancelar OC sob concorrência (DOCUMENT-TRANSITION-CONCURRENCY-01, risco R-P1
 * do discovery).
 *
 * O recebimento já travava a OC e relia o status sob a trava. O cancelamento
 * não: lia CONFIRMADA sem trava e esperava só no UPDATE — que, depois do commit
 * do recebimento, gravava CANCELADA por cima de uma OC com Receipt e RECEIPT_IN.
 */

type App = ReturnType<typeof buildTestApp>;

const criados = { ordens: [] as string[], fornecedores: [] as string[], itens: [] as string[] };

let app: App;
let m: string;
let fornecedor: { id: string; code: string; legalName: string };
let itemId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  app = buildTestApp();
  await app.ready();

  m = `CC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  fornecedor = await prisma.supplier.create({
    data: { code: `FOR-${m}`, legalName: `Fornecedor Corrida ${m}` },
  });
  criados.fornecedores.push(fornecedor.id);
  // Sem lote e sem validade: o assunto é o status da OC, não a rastreabilidade.
  const item = await prisma.item.create({
    data: {
      type: "PACKAGING",
      code: `ME-${m}`,
      name: `Embalagem Corrida ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itemId = item.id;
  criados.itens.push(item.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  // Recebimento leva linhas e movimentos em cascata; a OC leva as linhas dela.
  await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: criados.ordens } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await app?.close();
});

let sequencia = 0;

/** OC CONFIRMADA com uma linha de 10 kg. */
async function ocConfirmada() {
  sequencia += 1;
  const ordem = await getPrisma().purchaseOrder.create({
    data: {
      code: `OC-${m}-${String(sequencia).padStart(3, "0")}`,
      supplierId: fornecedor.id,
      supplierCode: fornecedor.code,
      supplierName: fornecedor.legalName,
      orderDate: new Date("2026-09-01T00:00:00.000Z"),
      status: "ORDERED",
      lines: {
        create: [
          {
            itemId,
            itemCode: `ME-${m}`,
            itemName: `Embalagem Corrida ${m}`,
            unitCode: "kg",
            orderedQuantity: "10",
          },
        ],
      },
    },
    include: { lines: true },
  });
  criados.ordens.push(ordem.id);
  return { orderId: ordem.id, lineId: ordem.lines[0]!.id };
}

function receber(orderId: string, lineId: string) {
  return app.inject({
    method: "POST",
    url: `/purchase-orders/${orderId}/receipts`,
    payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ purchaseOrderLineId: lineId, receivedQuantity: "4" }],
    },
  });
}

function cancelar(orderId: string) {
  return app.inject({
    method: "POST",
    url: `/purchase-orders/${orderId}/cancel`,
    payload: { reason: "Fornecedor não entrega mais" },
  });
}

/**
 * A OC e o que entrou por ela, lidos do banco. Invariante que nenhuma
 * intercalação pode quebrar: OC CANCELADA não tem recebimento nem RECEIPT_IN;
 * OC com recebimento está PARCIAL ou RECEBIDA.
 */
async function conferirInvariantes(orderId: string) {
  const prisma = getPrisma();
  const ordem = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
  const recebimentos = await prisma.receipt.findMany({ where: { purchaseOrderId: orderId } });
  const entradas = await prisma.inventoryMovement.findMany({
    where: { type: "RECEIPT_IN", receiptLine: { receipt: { purchaseOrderId: orderId } } },
  });
  if (ordem.status === "CANCELLED") {
    expect(recebimentos, "OC CANCELADA com recebimento").toHaveLength(0);
    expect(entradas, "OC CANCELADA com RECEIPT_IN").toHaveLength(0);
  }
  if (recebimentos.length > 0) {
    expect(["PARTIALLY_RECEIVED", "RECEIVED"], "OC com recebimento").toContain(ordem.status);
  }
  return { ordem, recebimentos, entradas };
}

describe("OC — receber × cancelar (R-P1)", () => {
  it("o cancelamento espera o recebimento, relê e recusa: Receipt e RECEIPT_IN ficam, OC não cancela", async () => {
    const f = await ocConfirmada();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let recebimento!: ReturnType<typeof receber>;
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      // O recebimento trava a OC e depois grava a linha do recebimento, que
      // aponta para a linha da OC: o teste segura a linha da OC, e ele para
      // ali com a OC já travada.
      await t0.tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE id = ${f.lineId} FOR UPDATE`;
      recebimento = receber(f.orderId, f.lineId);
      disparadas.push(recebimento);
      const pidRecebimento = await esperarParadaEm(t0.pid, "o recebimento parar na linha da OC");

      cancelamento = cancelar(f.orderId);
      disparadas.push(cancelamento);
      await esperarParadaEm(pidRecebimento, "o cancelamento parar na OC do recebimento");
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { ordem, recebimentos, entradas } = await conferirInvariantes(f.orderId);
    expect(ordem.status).toBe("PARTIALLY_RECEIVED");
    expect(ordem.cancelledAt).toBeNull();
    expect(ordem.cancelReason).toBeNull();
    expect(recebimentos).toHaveLength(1);
    expect(entradas.map((entrada) => entrada.quantity.toString())).toEqual(["4"]);

    const recebida = await recebimento;
    const cancelada = await cancelamento;
    expect(recebida.statusCode, recebida.body).toBe(201);
    expect(cancelada.statusCode, cancelada.body).toBe(400);
    expect(cancelada.json().error).toBe("invalid_transition");
  });

  it("cancelar vence primeiro: o recebimento espera, relê CANCELADA e recusa — nenhum Receipt", async () => {
    const f = await ocConfirmada();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let cancelamento!: ReturnType<typeof cancelar>;
    let recebimento!: ReturnType<typeof receber>;
    try {
      // O teste segura a própria OC: o cancelamento chega primeiro à fila e o
      // recebimento entra atrás dele.
      await t0.tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${f.orderId} FOR UPDATE`;
      cancelamento = cancelar(f.orderId);
      disparadas.push(cancelamento);
      const pidCancelamento = await esperarParadaEm(t0.pid, "o cancelamento parar na OC");

      recebimento = receber(f.orderId, f.lineId);
      disparadas.push(recebimento);
      await esperarAte("o recebimento entrar na fila da OC", async () => {
        const paradas = new Set([...(await paradasEm(t0.pid)), ...(await paradasEm(pidCancelamento))]);
        paradas.delete(pidCancelamento);
        return paradas.size > 0;
      });
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { ordem, recebimentos, entradas } = await conferirInvariantes(f.orderId);
    expect(ordem.status).toBe("CANCELLED");
    expect(ordem.cancelReason).toBe("Fornecedor não entrega mais");
    expect(recebimentos).toHaveLength(0);
    expect(entradas).toHaveLength(0);

    const cancelada = await cancelamento;
    const recebida = await recebimento;
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect(recebida.statusCode, recebida.body).toBe(400);
    expect(recebida.json().error).toBe("invalid_purchase_order_status");
  });
});

describe("OC — conflito de concorrência vira 409", () => {
  it("o cancelamento cuja transação expira esperando a trava devolve 409 concurrent_write e não grava nada", async () => {
    const f = await ocConfirmada();

    const t0 = await abrirTransacaoDoTeste();
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      await t0.tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${f.orderId} FOR UPDATE`;
      cancelamento = cancelar(f.orderId);
      await esperarParadaEm(t0.pid, "o cancelamento parar na OC");
      // A transação interativa do serviço vale 5 s. Segurar além disso é o que
      // produz o P2028 — a espera aqui é o gatilho, não a prova de ordem.
      await new Promise((resolve) => setTimeout(resolve, 5_500));
    } finally {
      await t0.soltar();
    }

    const { ordem } = await conferirInvariantes(f.orderId);
    expect(ordem.status).toBe("ORDERED");
    expect(ordem.cancelledAt).toBeNull();
    expect(ordem.cancelReason).toBeNull();

    const resposta = await cancelamento;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("concurrent_write");
  }, 20_000);
});
