import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * QUERY-BOOLEAN-PERMISSIVE-REMAINING-01 — `onlyPending` e `onlyWithBalance`
 * da fila da Qualidade são `"true"` ou `"false"`, exatos.
 *
 * O schema lia todo texto fora de `"true"` como `false`, calado:
 * `?onlyPending=1` mostrava a fila inteira, com o laudo já aprovado, e
 * `?onlyWithBalance=1` trazia o lote zerado. Agora os dois leem
 * `booleanoDeConsultaSchema` (`lib/boolean-schema.ts`); o resto é 400.
 * Ausente continua sem recorte — o "Todos" da tela.
 */

type App = ReturnType<typeof buildTestApp>;
type Resposta = { statusCode: number; body: string };

/** Nada disto é booleano de URL — nem o `1` que parecia "sim". */
const RECUSADOS = ["0", "1", "yes", "no", "on", "off", "abc", "", " ", "TRUE", " true", "false "];
const CAMPOS = ["onlyPending", "onlyWithBalance"] as const;

const PENDENTE = "pendente sem saldo";
const COM_SALDO = "aprovado com saldo";

let app: App;
const criados = { item: "" };
/** id do lote → rótulo legível na falha. */
const rotulos = new Map<string, string>();

/** Sempre recortado no item do teste; espaço vai como `%20`, nunca `+`. */
function url(query: Record<string, string>): string {
  const pares = Object.entries({ itemId: criados.item, pageSize: "100", ...query }).map(
    ([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`,
  );
  return `/quality/coa-queue?${pares.join("&")}`;
}

function lotesDe(corpo: string): string[] {
  return (JSON.parse(corpo) as { rows: { lotId: string }[] }).rows
    .map((linha) => rotulos.get(linha.lotId) ?? linha.lotId)
    .sort();
}

async function fila(query: Record<string, string>): Promise<string[]> {
  const resposta = await app.inject({ method: "GET", url: url(query) });
  expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
  return lotesDe(resposta.body);
}

/** O que a rota fez com o valor: o status e, com 200, os lotes devolvidos. É o que a falha mostra. */
function desfecho(resposta: Resposta): string {
  if (resposta.statusCode !== 200) return String(resposta.statusCode);
  return `200 com ${lotesDe(resposta.body).join(" e ") || "nenhum lote"}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });

  const m = `QB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-${m}`,
      name: `Material da fila ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  criados.item = item.id;

  // Cada filtro escolhe um lote diferente: trocar um campo pelo outro também cai.
  const pendente = await prisma.lot.create({
    data: {
      code: `LT-${m}-A`,
      origin: "RECEIPT",
      itemId: item.id,
      initialReceivedQuantity: "10",
      status: "AVAILABLE",
      requiresCoaSnapshot: true,
      coaStatus: "PENDING",
    },
  });
  const comSaldo = await prisma.lot.create({
    data: {
      code: `LT-${m}-B`,
      origin: "RECEIPT",
      itemId: item.id,
      initialReceivedQuantity: "10",
      status: "AVAILABLE",
      requiresCoaSnapshot: true,
      coaStatus: "APPROVED",
    },
  });
  rotulos.set(pendente.id, PENDENTE);
  rotulos.set(comSaldo.id, COM_SALDO);

  // Só o aprovado tem movimento: o pendente existe, com saldo zero no ledger.
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: comSaldo.id,
      type: "ADJUSTMENT_IN",
      quantity: "10",
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
  await app?.close();
});

describe("Fila da Qualidade pela rota — onlyPending", () => {
  it("true: só o laudo que exige ação", async () => {
    expect(await fila({ onlyPending: "true" })).toEqual([PENDENTE]);
  });

  it("false: a fila inteira, com o laudo aprovado", async () => {
    expect(await fila({ onlyPending: "false" })).toEqual([COM_SALDO, PENDENTE]);
  });

  it("ausente: a fila inteira — o Todos da tela", async () => {
    expect(await fila({})).toEqual([COM_SALDO, PENDENTE]);
  });
});

describe("Fila da Qualidade pela rota — onlyWithBalance", () => {
  it("true: só o lote com saldo", async () => {
    expect(await fila({ onlyWithBalance: "true" })).toEqual([COM_SALDO]);
  });

  it("false: o lote zerado volta", async () => {
    expect(await fila({ onlyWithBalance: "false" })).toEqual([COM_SALDO, PENDENTE]);
  });

  it("ausente: sem filtro de saldo", async () => {
    expect(await fila({})).toEqual([COM_SALDO, PENDENTE]);
  });
});

describe("Fila da Qualidade pela rota — texto fora de true/false", () => {
  it.each(CAMPOS)("%s: é 400, nunca fila", async (campo) => {
    const obtidos: [string, string][] = [];
    for (const valor of RECUSADOS) {
      const resposta = await app.inject({ method: "GET", url: url({ [campo]: valor }) });
      obtidos.push([valor, desfecho(resposta)]);
      if (resposta.statusCode === 400) {
        expect(resposta.json()).toMatchObject({ error: "validation_error", issues: [{ path: campo }] });
      }
    }
    expect(obtidos, `/quality/coa-queue?${campo}`).toEqual(RECUSADOS.map((valor) => [valor, "400"]));
  });
});
