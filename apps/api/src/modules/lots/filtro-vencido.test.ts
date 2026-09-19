import { Prisma } from "@prisma/client";
import { ATTENTION_LIST_PATH } from "@veridi/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { marcadorDoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * O filtro "Vencido" das listagens — VERIDI-AUDIT-QUICK-FIXES-01, D1.
 *
 * `EXPIRED` nunca é gravado: vencido é derivado da validade (`isLotExpired`,
 * dia comercial inclusivo). As listagens, porém, traduziam `status=EXPIRED`
 * para `where.status = "EXPIRED"` e voltavam vazias com lote vencido no
 * estoque — o "ver todos" de LOT_EXPIRED do Painel caía numa lista vazia.
 *
 * A régua é a mesma do Painel e do R-02: vencido é a validade ANTES do dia
 * comercial de hoje. O lote que vence hoje ainda vale o dia inteiro e não
 * entra; o lote bloqueado ou aguardando liberação que já venceu entra, porque
 * a própria lista o apresenta como "Vencido".
 */

const app = buildTestApp();
const itemIds: string[] = [];
const lotIds: string[] = [];

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

let itemCode: string;
let paCode: string;
let customerId: string;

const lotes = {} as Record<
  "vencidoLiberado" | "vencidoBloqueado" | "venceHoje" | "valido" | "vencidoDoCliente" | "paVencido" | "paValido",
  { id: string; code: string }
>;

async function criarLote(params: {
  itemId: string;
  validade: Date;
  status?: "AVAILABLE" | "BLOCKED" | "AWAITING_RELEASE";
  origin?: "RECEIPT" | "PRODUCTION";
  doCliente?: boolean;
}): Promise<{ id: string; code: string }> {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-D1V-${marca()}`,
      origin: params.origin ?? "RECEIPT",
      itemId: params.itemId,
      ownerType: params.doCliente ? "CUSTOMER" : "VERIDI",
      ownerCustomerId: params.doCliente ? customerId : null,
      status: params.status ?? "AVAILABLE",
      expiryDate: params.validade,
      initialReceivedQuantity: new Prisma.Decimal("10"),
      createdBy: "teste",
    },
  });
  lotIds.push(lot.id);
  await prisma.inventoryMovement.create({
    data: {
      itemId: params.itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity: new Prisma.Decimal("10"),
      occurredAt: new Date("2026-01-05T12:00:00.000Z"),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "fixture D1",
      createdBy: "teste",
    },
  });
  return { id: lot.id, code: lot.code };
}

beforeAll(async () => {
  const prisma = getPrisma();
  customerId = await fixtureCustomerId();
  const m = marca();
  itemCode = `MP-D1V-${m}`;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: itemCode,
      name: `Insumo filtro vencido ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
    },
  });
  itemIds.push(item.id);
  paCode = `PA-D1V-${m}`;
  const pa = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: paCode,
      name: `Produto filtro vencido ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
    },
  });
  itemIds.push(pa.id);

  const ontem = marcadorDoDiaComercialDeTeste(-1);
  const hoje = marcadorDoDiaComercialDeTeste(0);
  const daquiAUmMes = marcadorDoDiaComercialDeTeste(30);
  lotes.vencidoLiberado = await criarLote({ itemId: item.id, validade: ontem });
  lotes.vencidoBloqueado = await criarLote({ itemId: item.id, validade: ontem, status: "BLOCKED" });
  lotes.venceHoje = await criarLote({ itemId: item.id, validade: hoje });
  lotes.valido = await criarLote({ itemId: item.id, validade: daquiAUmMes });
  lotes.vencidoDoCliente = await criarLote({ itemId: item.id, validade: ontem, doCliente: true });
  lotes.paVencido = await criarLote({ itemId: pa.id, validade: ontem, origin: "PRODUCTION" });
  lotes.paValido = await criarLote({ itemId: pa.id, validade: daquiAUmMes, origin: "PRODUCTION" });
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: lotIds } } });
  await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await app.close();
});

async function ler<T>(url: string): Promise<T> {
  const resposta = await app.inject({ method: "GET", url });
  expect(resposta.statusCode, `${url}: ${resposta.body}`).toBe(200);
  return resposta.json() as T;
}

describe("filtro Vencido pela validade derivada, nunca pelo status gravado", () => {
  it("o 'ver todos' de LOT_EXPIRED do Painel é a lista de Lotes filtrada por EXPIRED", () => {
    expect(ATTENTION_LIST_PATH.LOT_EXPIRED).toBe("/estoque/lotes?status=EXPIRED");
  });

  it("Estoque › Lotes: traz os vencidos (qualquer situação gravada) e deixa de fora o que vence hoje", async () => {
    const corpo = await ler<{ lots: { id: string; isExpired: boolean }[] }>(
      `/lots?status=EXPIRED&search=${itemCode}&pageSize=100`,
    );
    const ids = corpo.lots.map((lot) => lot.id).sort();
    expect(ids).toEqual(
      [lotes.vencidoLiberado.id, lotes.vencidoBloqueado.id, lotes.vencidoDoCliente.id].sort(),
    );
    expect(corpo.lots.every((lot) => lot.isExpired)).toBe(true);
  });

  it("Produto Acabado: o lote de produção vencido aparece no filtro Vencido", async () => {
    const corpo = await ler<{ rows: { lotId: string; isExpired: boolean }[] }>(
      `/finished-goods?status=EXPIRED&search=${paCode}&pageSize=100`,
    );
    expect(corpo.rows.map((row) => row.lotId)).toEqual([lotes.paVencido.id]);
    expect(corpo.rows[0]!.isExpired).toBe(true);
  });

  it("R-01 Posição de Estoque: situação Vencido lista os lotes vencidos", async () => {
    const corpo = await ler<{ rows: { lotId: string | null; isExpired: boolean }[] }>(
      `/reports/inventory/position?status=EXPIRED&search=${itemCode}&pageSize=100`,
    );
    const ids = corpo.rows.map((row) => row.lotId).sort();
    expect(ids).toEqual(
      [lotes.vencidoLiberado.id, lotes.vencidoBloqueado.id, lotes.vencidoDoCliente.id].sort(),
    );
    expect(corpo.rows.every((row) => row.isExpired)).toBe(true);
  });

  it("Materiais de Clientes: situação Vencido lista o material do cliente vencido", async () => {
    const corpo = await ler<{ rows: { lotId: string }[] }>(
      `/inventory/customer-materials?status=EXPIRED&search=${itemCode}&pageSize=100`,
    );
    expect(corpo.rows.map((row) => row.lotId)).toEqual([lotes.vencidoDoCliente.id]);
  });

  it("Fila da Qualidade: lotStatus=EXPIRED segue a mesma régua", async () => {
    const corpo = await ler<{ rows: { lotId: string }[] }>(
      `/quality/coa-queue?lotStatus=EXPIRED&search=${itemCode}&pageSize=100`,
    );
    const ids = corpo.rows.map((row) => row.lotId).sort();
    expect(ids).toEqual(
      [lotes.vencidoLiberado.id, lotes.vencidoBloqueado.id, lotes.vencidoDoCliente.id].sort(),
    );
  });

  it("os outros filtros continuam pelo status gravado (Liberado não perde o lote que vence hoje)", async () => {
    const corpo = await ler<{ lots: { id: string }[] }>(
      `/lots?status=AVAILABLE&search=${itemCode}&pageSize=100`,
    );
    const ids = corpo.lots.map((lot) => lot.id);
    expect(ids).toContain(lotes.venceHoje.id);
    expect(ids).toContain(lotes.valido.id);
    expect(ids).not.toContain(lotes.vencidoBloqueado.id);
  });
});
