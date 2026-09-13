import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ItemType } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Item INATIVO não recebe material novo do cliente
 * (CUSTOMER-MATERIAL-INACTIVE-GATE-01).
 *
 * A tela só oferece item ativo (`active=true` + `customerSupplied=true`), mas
 * `POST /receipts/customer-supplied` aceitava o inativo chamado direto. A
 * autoridade é o servidor, no estado de AGORA: a checagem acontece na chamada
 * e de novo dentro da transação, sob trava, antes de qualquer escrita. As
 * regras que já existiam — cliente ativo, tipo pelo conjunto
 * `TIPOS_DE_MATERIAL_DO_CLIENTE`, controle de lote, quantidade — continuam.
 */

type App = ReturnType<typeof buildTestApp>;
type Item = { id: string; code: string };

const m = `CMI${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const criados = { itens: [] as string[], cliente: "" };
const itens = {} as Record<
  "mpAtivo" | "meAtivo" | "mpInativadoDepois" | "mpInativo" | "meInativo" | "paAtivo" | "semLote" | "mpDaTela" | "mpDaTrava",
  Item
>;

let app: App;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  const cliente = await prisma.customer.create({
    data: { code: `CLI-${m}`, legalName: `Cliente Inativo ${m}`, active: true },
  });
  criados.cliente = cliente.id;

  // Sem validade e sem Qualidade: o assunto é item ativo, tipo e lote.
  const item = (chave: keyof typeof itens, type: ItemType, extra: Record<string, boolean> = {}) => ({
    chave,
    data: {
      type,
      code: `${type === "PACKAGING" ? "ME" : type === "FINISHED_PRODUCT" ? "PA" : "MP"}-${m}-${chave}`,
      name: `Material ${m} ${chave}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      ...extra,
    },
  });
  for (const { chave, data } of [
    item("mpAtivo", "RAW_MATERIAL"),
    item("meAtivo", "PACKAGING"),
    item("mpInativadoDepois", "RAW_MATERIAL"),
    item("mpInativo", "RAW_MATERIAL", { active: false }),
    item("meInativo", "PACKAGING", { active: false }),
    item("paAtivo", "FINISHED_PRODUCT"),
    item("semLote", "RAW_MATERIAL", { controlsLot: false }),
    item("mpDaTela", "RAW_MATERIAL"),
    item("mpDaTrava", "RAW_MATERIAL"),
  ]) {
    const criado = await prisma.item.create({ data, select: { id: true, code: true } });
    itens[chave] = criado;
    criados.itens.push(criado.id);
  }

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.receiptLine.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
  if (criados.cliente) await prisma.receipt.deleteMany({ where: { customerId: criados.cliente } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  if (criados.cliente) await prisma.customer.delete({ where: { id: criados.cliente } });
  await app?.close();
});

function receber(documento: string, ...linhas: Item[]) {
  return app.inject({
    method: "POST",
    url: "/receipts/customer-supplied",
    payload: {
      customerId: criados.cliente,
      receivedAt: "2026-09-12T15:00:00.000Z",
      documentReference: `REM-${m}-${documento}`,
      lines: linhas.map((linha) => ({ itemId: linha.id, receivedQuantity: "12.5", supplierLot: `FAB-${m}` })),
    },
  });
}

/** O que um recebimento escreve, contado: documento, linha, lote e movimento. */
async function escritas(documento: string, ...linhas: Item[]) {
  const prisma = getPrisma();
  const ids = linhas.map((linha) => linha.id);
  const [recebimentos, linhasDeRecebimento, lotes, movimentos] = await Promise.all([
    prisma.receipt.count({ where: { documentReference: `REM-${m}-${documento}` } }),
    prisma.receiptLine.count({ where: { itemId: { in: ids } } }),
    prisma.lot.count({ where: { itemId: { in: ids } } }),
    prisma.inventoryMovement.count({ where: { itemId: { in: ids } } }),
  ]);
  return { recebimentos, linhasDeRecebimento, lotes, movimentos };
}

const NADA = { recebimentos: 0, linhasDeRecebimento: 0, lotes: 0, movimentos: 0 };

function recusaDeInativo(item: Item) {
  return { error: "item_inactive", message: `O item ${item.code} está inativo e não pode receber novo material.` };
}

describe("material do cliente — item precisa estar ativo", () => {
  it("item ativo elegível recebe: matéria-prima e embalagem, lote do cliente", async () => {
    for (const [documento, item] of [["mp", itens.mpAtivo], ["me", itens.meAtivo]] as const) {
      const resposta = await receber(documento, item);
      expect(resposta.statusCode, resposta.body.slice(0, 200)).toBe(201);
      expect(await escritas(documento, item)).toEqual({ recebimentos: 1, linhasDeRecebimento: 1, lotes: 1, movimentos: 1 });
      // Dono continua no lote, não no item.
      const lote = await getPrisma().lot.findFirstOrThrow({ where: { itemId: item.id } });
      expect({ ownerType: lote.ownerType, ownerCustomerId: lote.ownerCustomerId }).toEqual({
        ownerType: "CUSTOMER",
        ownerCustomerId: criados.cliente,
      });
    }
  });

  it("chamada direta com item inativo, tipo, lote e dados válidos: erro de negócio e nenhuma escrita", async () => {
    const resposta = await receber("direto", itens.mpInativo);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual(recusaDeInativo(itens.mpInativo));
    expect(await escritas("direto", itens.mpInativo)).toEqual(NADA);
  });

  it("o mesmo item: ativo recebe; inativado, é recusado e nada novo é escrito", async () => {
    const item = itens.mpInativadoDepois;
    expect((await receber("antes", item)).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/items/${item.id}/deactivate` })).statusCode).toBe(200);

    const resposta = await receber("depois", item);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual(recusaDeInativo(item));
    expect(await escritas("depois", item)).toEqual({ recebimentos: 0, linhasDeRecebimento: 1, lotes: 1, movimentos: 1 });
  });

  it("embalagem inativa também é recusada", async () => {
    const resposta = await receber("me-inativa", itens.meInativo);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual(recusaDeInativo(itens.meInativo));
    expect(await escritas("me-inativa", itens.meInativo)).toEqual(NADA);
  });

  it("uma linha inativa derruba o recebimento inteiro — a linha válida também não entra", async () => {
    const resposta = await receber("misto", itens.mpDaTela, itens.mpInativo);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("item_inactive");
    expect(await escritas("misto", itens.mpDaTela, itens.mpInativo)).toEqual(NADA);
  });

  it("regras que já existiam continuam: produto acabado e item sem controle de lote", async () => {
    const acabado = await receber("pa", itens.paAtivo);
    expect(acabado.statusCode).toBe(400);
    expect(acabado.json().error).toBe("invalid_item_type");

    const semLote = await receber("sem-lote", itens.semLote);
    expect(semLote.statusCode).toBe(400);
    expect(semLote.json().error).toBe("lot_control_required");

    expect(await escritas("pa", itens.paAtivo)).toEqual(NADA);
    expect(await escritas("sem-lote", itens.semLote)).toEqual(NADA);
  });
});

describe("material do cliente — corrida: vale o estado de agora", () => {
  it("o seletor ofereceu o item ativo; inativado antes do POST, o POST é recusado", async () => {
    const item = itens.mpDaTela;
    const seletor = await app.inject({
      method: "GET",
      url: `/items?customerSupplied=true&active=true&ids=${item.id}`,
    });
    expect(seletor.json().total).toBe(1);

    expect((await app.inject({ method: "POST", url: `/items/${item.id}/deactivate` })).statusCode).toBe(200);

    const resposta = await receber("tela", item);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual(recusaDeInativo(item));
    expect(await escritas("tela", item)).toEqual(NADA);
  });

  it(
    "inativação em curso durante o POST: a transação espera a trava, lê o item inativo e não escreve nada",
    { timeout: 60_000 },
    async () => {
      const prisma = getPrisma();
      const item = itens.mpDaTrava;
      let soltar!: () => void;
      const segurando = new Promise<void>((resolve) => (soltar = resolve));
      let aberta!: () => void;
      const inativacaoAberta = new Promise<void>((resolve) => (aberta = resolve));

      // Inativação que ainda não confirmou: a checagem fora da transação lê o item ativo.
      const inativacao = prisma.$transaction(
        async (tx) => {
          await tx.item.update({ where: { id: item.id }, data: { active: false } });
          aberta();
          await segurando;
        },
        { timeout: 30_000 },
      );
      await inativacaoAberta;

      const post = receber("trava", item);
      let parouNaTrava = false;
      for (let tentativa = 0; tentativa < 50 && !parouNaTrava; tentativa += 1) {
        const [linha] = await prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE '%FROM items%FOR SHARE%' AND pid <> pg_backend_pid()
        `;
        parouNaTrava = (linha?.n ?? 0) > 0;
        if (!parouNaTrava) await new Promise((resolve) => setTimeout(resolve, 100));
      }

      soltar();
      await inativacao;
      const resposta = await post;

      expect(parouNaTrava).toBe(true);
      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toEqual(recusaDeInativo(item));
      expect(await escritas("trava", item)).toEqual(NADA);
    },
  );
});
