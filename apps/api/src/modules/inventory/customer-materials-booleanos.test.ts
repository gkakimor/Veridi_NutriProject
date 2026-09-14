import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01 — `onlyWithBalance` de
 * Materiais de clientes é `"true"` ou `"false"`, exatos.
 *
 * O schema lia todo texto fora de `"true"` como `false`, calado:
 * `?onlyWithBalance=1` — "só com saldo" para quem escreve — listava também o
 * lote zerado, na lista e no CSV. Agora lê `booleanoDeConsultaSchema`
 * (`lib/boolean-schema.ts`); o resto é 400. Ausente continua sem filtro, como
 * a lista e o CSV sempre leram.
 */

type App = ReturnType<typeof buildTestApp>;
type Linha = { lotCode: string; onHand: string };

/** Nada disto é booleano de URL — nem o `1` que parecia "sim". */
const RECUSADOS = ["0", "1", "yes", "no", "on", "off", "abc", "", " ", "TRUE", " true", "false "];
const LISTA = "/inventory/customer-materials";
const CSV = "/inventory/customer-materials/export.csv";

let app: App;
let m: string;
const criados = { cliente: "", item: "" };
/** Dois lotes do MESMO cliente e item: um com saldo no ledger, outro zerado. */
let comSaldo: string;
let semSaldo: string;

/** Sempre recortado no cliente do teste; espaço vai como `%20`, nunca `+`. */
function url(caminho: string, query: Record<string, string>): string {
  const pares = Object.entries({ customerId: criados.cliente, ...query }).map(
    ([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`,
  );
  return `${caminho}?${pares.join("&")}`;
}

async function linhas(query: Record<string, string>): Promise<Linha[]> {
  const resposta = await app.inject({ method: "GET", url: url(LISTA, query) });
  expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
  return (resposta.json() as { rows: Linha[] }).rows;
}

const lotes = async (query: Record<string, string>) => (await linhas(query)).map((linha) => linha.lotCode);

/** Lotes do teste presentes no CSV. */
async function lotesDoCsv(query: Record<string, string>): Promise<string[]> {
  const resposta = await app.inject({ method: "GET", url: url(CSV, query) });
  expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
  return [comSaldo, semSaldo].filter((codigo) => resposta.body.includes(codigo));
}

/** O que a rota fez com o valor: o status e, com 200, os lotes devolvidos. É o que a falha mostra. */
function desfecho(resposta: { statusCode: number; body: string }): string {
  if (resposta.statusCode !== 200) return String(resposta.statusCode);
  const presentes = resposta.body.startsWith("{")
    ? (JSON.parse(resposta.body) as { rows: Linha[] }).rows.map((linha) => linha.lotCode)
    : [comSaldo, semSaldo].filter((codigo) => resposta.body.includes(codigo));
  return `200 com ${presentes.join(" e ") || "nenhum lote"}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });

  m = `QB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const cliente = await prisma.customer.create({
    data: { code: `CLI-${m}`, legalName: `Cliente Booleano ${m}`, active: true },
  });
  criados.cliente = cliente.id;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-${m}`,
      name: `Material do cliente ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  criados.item = item.id;

  const lote = (sufixo: string) =>
    prisma.lot.create({
      data: {
        code: `LT-${m}-${sufixo}`,
        origin: "RECEIPT",
        itemId: item.id,
        initialReceivedQuantity: "12.5",
        status: "AVAILABLE",
        ownerType: "CUSTOMER",
        ownerCustomerId: cliente.id,
      },
    });
  const loteComSaldo = await lote("A");
  const loteSemSaldo = await lote("B");
  comSaldo = loteComSaldo.code;
  semSaldo = loteSemSaldo.code;

  // Só o A tem movimento: o B existe, com saldo zero no ledger.
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: loteComSaldo.id,
      type: "ADJUSTMENT_IN",
      quantity: "12.5",
      occurredAt: new Date(),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Saldo de teste",
      createdBy: "Teste",
    },
  });

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (criados.item) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: criados.item } });
    // Lot.itemId é RESTRICT — sai antes do Item.
    await prisma.lot.deleteMany({ where: { itemId: criados.item } });
    await prisma.item.deleteMany({ where: { id: criados.item } });
  }
  if (criados.cliente) await prisma.customer.deleteMany({ where: { id: criados.cliente } });
  await app?.close();
});

describe("Materiais de clientes pela rota — onlyWithBalance", () => {
  it("true: só o lote com saldo, na lista e no CSV", async () => {
    expect(await lotes({ onlyWithBalance: "true" })).toEqual([comSaldo]);
    expect(await lotesDoCsv({ onlyWithBalance: "true" })).toEqual([comSaldo]);
  });

  it("false tira o filtro: o lote zerado volta, na lista e no CSV", async () => {
    const lista = await linhas({ onlyWithBalance: "false" });
    expect(lista.map((linha) => linha.lotCode)).toEqual([comSaldo, semSaldo]);
    expect(lista[1]?.onHand).toBe("0");
    expect(await lotesDoCsv({ onlyWithBalance: "false" })).toEqual([comSaldo, semSaldo]);
  });

  it("ausente continua sem filtro — como a lista e o CSV sempre leram", async () => {
    expect(await lotes({})).toEqual([comSaldo, semSaldo]);
    expect(await lotesDoCsv({})).toEqual([comSaldo, semSaldo]);
  });

  it.each([LISTA, CSV])("%s: texto fora de true/false é 400, nunca lista", async (caminho) => {
    const obtidos: [string, string][] = [];
    for (const valor of RECUSADOS) {
      const resposta = await app.inject({ method: "GET", url: url(caminho, { onlyWithBalance: valor }) });
      obtidos.push([valor, desfecho(resposta)]);
      if (resposta.statusCode === 400) {
        expect(resposta.json()).toMatchObject({ error: "validation_error", issues: [{ path: "onlyWithBalance" }] });
      }
    }
    expect(obtidos, `${caminho}?onlyWithBalance`).toEqual(RECUSADOS.map((valor) => [valor, "400"]));
  });
});
