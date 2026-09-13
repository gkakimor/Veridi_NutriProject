import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ItemType } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Receber material do cliente sem corte silencioso (CUSTOMER-MATERIAL-ITEM-CUTOFF-01).
 *
 * O seletor de item da tela pedia duas listas de 1000 — `type=RAW_MATERIAL` e
 * `type=PACKAGING`, só ativos — e somava as duas num `<select>`. Do item 1001
 * de cada tipo em diante o material existia, o servidor aceitaria o
 * recebimento, e a tela não o oferecia.
 *
 * O seletor passou a perguntar `customerSupplied=true`, com primeira página de
 * 20, busca e resolução por id. Aqui se prova o lado do servidor com volume
 * ACIMA do antigo teto: 1000 matérias-primas ativas nascem com código menor
 * que o do alvo, então o alvo é, no mínimo, o item #1001 da lista antiga —
 * esteja o resto do banco onde estiver, ele não cabe nas 1000.
 *
 * Item não tem dono; dono é o LOTE, que o servidor grava com o cliente do
 * recebimento. O isolamento entre clientes se prova onde ele mora: o mesmo
 * item #1001, recebido para A e para B com o MESMO lote do fabricante, e cada
 * cliente só enxerga o próprio lote, com o mesmo texto de busca.
 *
 * O catálogo nasce por `createManyAndReturn`: o assunto é volume e recorte.
 * Os lotes nascem por recebimento real.
 */

type App = ReturnType<typeof buildTestApp>;
type ItemResumo = { id: string; code: string };
type LinhaDeMaterial = { customerId: string; itemId: string; lotId: string; supplierLot: string | null };

/** Matérias-primas ativas com código menor que o do alvo — o antigo teto. */
const RUIDO = 1000;
/** No lote do marcador, o que o seletor pode oferecer: ruído + alvo + embalagem + sem lote. */
const ELEGIVEIS = RUIDO + 3;

const criados = { itens: [] as string[], clientes: [] as string[] };

let app: App;
let m: string;
let clienteA: { id: string };
let clienteB: { id: string };
/** Matéria-prima #1001: código logo depois das 1000 do ruído. */
let alvo: ItemResumo & { name: string };
let embalagem: ItemResumo;
let produtoAcabado: ItemResumo;
let inativo: ItemResumo & { name: string };
let semLote: ItemResumo;

/** O que o seletor da tela manda em toda pergunta. */
const DO_SELETOR = { customerSupplied: "true", active: "true" };

const codigo = (prefixo: string, numero: number) => `${prefixo}-${m}-${String(numero).padStart(4, "0")}`;

async function listar(query: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: `/items?${new URLSearchParams(query).toString()}`,
  });
  expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
  const corpo = response.json() as { items: ItemResumo[]; total: number };
  return { ...corpo, codes: corpo.items.map((item) => item.code) };
}

async function receber(
  customerId: string,
  itemId: string,
  linha: { supplierLot: string } & Record<string, string>,
) {
  return app.inject({
    method: "POST",
    url: "/receipts/customer-supplied",
    payload: {
      customerId,
      receivedAt: "2026-09-10T15:00:00.000Z",
      documentReference: `REM-${m}`,
      lines: [{ itemId, receivedQuantity: "12.5", ...linha }],
    },
  });
}

async function materiaisDoCliente(query: Record<string, string>): Promise<LinhaDeMaterial[]> {
  const response = await app.inject({
    method: "GET",
    url: `/inventory/customer-materials?${new URLSearchParams(query).toString()}`,
  });
  expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
  return (response.json() as { rows: LinhaDeMaterial[] }).rows;
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

  m = `CM${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

  const clientes = await prisma.customer.createManyAndReturn({
    data: [
      { code: `CLI-${m}-A`, legalName: `Cliente Doca ${m} A`, active: true },
      { code: `CLI-${m}-B`, legalName: `Cliente Doca ${m} B`, active: true },
    ],
  });
  criados.clientes.push(...clientes.map((cliente) => cliente.id));
  clienteA = clientes.find((cliente) => cliente.code.endsWith("-A"))!;
  clienteB = clientes.find((cliente) => cliente.code.endsWith("-B"))!;

  // Sem validade e sem Qualidade: o que se mede aqui é recorte e dono.
  const base = { unitCode: "kg", controlsLot: true, controlsExpiry: false, requiresQualityRelease: false };
  const item = (type: ItemType, code: string, name: string, extra: Record<string, boolean> = {}) => ({
    ...base,
    type,
    code,
    name,
    ...extra,
  });

  const itens = await prisma.item.createManyAndReturn({
    data: [
      ...Array.from({ length: RUIDO }, (_, indice) =>
        item("RAW_MATERIAL", codigo("MP", indice + 1), `Excipiente Doca ${m} ${indice + 1}`),
      ),
      item("RAW_MATERIAL", codigo("MP", RUIDO + 1), `Beta-Alanina Doca ${m}`, { controlsExpiry: true }),
      item("RAW_MATERIAL", codigo("MP", RUIDO + 2), `Colageno Inativo Doca ${m}`, { active: false }),
      item("RAW_MATERIAL", codigo("MP", RUIDO + 3), `Sal Sem Lote Doca ${m}`, { controlsLot: false }),
      item("PACKAGING", codigo("ME", 1), `Pote Doca ${m}`),
      item("FINISHED_PRODUCT", codigo("PA", 1), `Produto Acabado Doca ${m}`),
    ],
  });
  criados.itens.push(...itens.map((registro) => registro.id));
  const porCodigo = (code: string) => itens.find((registro) => registro.code === code)!;
  alvo = porCodigo(codigo("MP", RUIDO + 1));
  inativo = porCodigo(codigo("MP", RUIDO + 2));
  semLote = porCodigo(codigo("MP", RUIDO + 3));
  embalagem = porCodigo(codigo("ME", 1));
  produtoAcabado = porCodigo(codigo("PA", 1));
}, 120_000);

afterAll(async () => {
  const prisma = getPrisma();
  if (criados.itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itens } } });
    await prisma.receiptLine.deleteMany({ where: { itemId: { in: criados.itens } } });
    // Lot.itemId é RESTRICT — sai antes do Item.
    await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
  }
  if (criados.clientes.length > 0) {
    await prisma.receipt.deleteMany({ where: { customerId: { in: criados.clientes } } });
  }
  if (criados.itens.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  }
  if (criados.clientes.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  }
  await app?.close();
});

describe("Material do cliente sem corte — o seletor de item", () => {
  it("a lista antiga de 1000 matérias-primas ativas não traz o item #1001", async () => {
    const antiga = await listar({ type: "RAW_MATERIAL", active: "true", page: "1", pageSize: "1000" });

    expect(antiga.items).toHaveLength(1000);
    expect(antiga.total).toBeGreaterThan(1000);
    expect(antiga.codes).not.toContain(alvo.code);
  });

  it("a primeira página é de 20, e o total conta todo o elegível — mais de 1000", async () => {
    const semBusca = await listar({ ...DO_SELETOR, pageSize: "20" });
    expect(semBusca.items).toHaveLength(20);
    expect(semBusca.total).toBeGreaterThan(1000);

    const doLote = await listar({ ...DO_SELETOR, search: m, pageSize: "20" });
    expect(doLote.items).toHaveLength(20);
    expect(doLote.total).toBe(ELEGIVEIS);
  });

  it("paginando, a fila elegível traz o lote inteiro — e nada de fora dele", async () => {
    const codigos = new Set<string>();
    for (let pagina = 1; pagina <= 10; pagina += 1) {
      const resposta = await listar({ ...DO_SELETOR, search: m, page: String(pagina), pageSize: "250" });
      for (const code of resposta.codes) codigos.add(code);
      if (resposta.items.length < 250) break;
    }

    expect(codigos.size).toBe(ELEGIVEIS);
    expect(codigos.has(alvo.code)).toBe(true);
    expect(codigos.has(embalagem.code)).toBe(true);
    expect(codigos.has(produtoAcabado.code)).toBe(false);
    expect(codigos.has(inativo.code)).toBe(false);
  });

  it("a busca por código acha o item #1001", async () => {
    const achado = await listar({ ...DO_SELETOR, search: alvo.code, pageSize: "20" });
    expect(achado.codes).toEqual([alvo.code]);
  });

  it("a busca por nome acha o item #1001", async () => {
    const achado = await listar({ ...DO_SELETOR, search: `Beta-Alanina Doca ${m}`, pageSize: "20" });
    expect(achado.codes).toEqual([alvo.code]);
  });

  it("pelo id resolve o item #1001 direto, sem página nenhuma — e não resolve quem não entra", async () => {
    expect((await listar({ ...DO_SELETOR, ids: alvo.id, pageSize: "1" })).codes).toEqual([alvo.code]);
    expect((await listar({ ...DO_SELETOR, ids: produtoAcabado.id, pageSize: "1" })).total).toBe(0);
    expect((await listar({ ...DO_SELETOR, ids: inativo.id, pageSize: "1" })).total).toBe(0);
  });

  it("com `type` junto vale a interseção; `false` ou ausente não restringe", async () => {
    expect((await listar({ customerSupplied: "true", type: "FINISHED_PRODUCT", search: m })).total).toBe(0);
    expect((await listar({ customerSupplied: "true", type: "PACKAGING", search: m })).codes).toEqual([
      embalagem.code,
    ]);

    // O Cadastro de Itens e as outras telas não mudam: sem o parâmetro, tudo segue listável.
    expect((await listar({ type: "FINISHED_PRODUCT", search: m })).codes).toEqual([produtoAcabado.code]);
    expect((await listar({ customerSupplied: "false", search: m, pageSize: "1" })).total).toBe(RUIDO + 5);
  });

  it("inativo fica fora da busca da tela, como sempre ficou fora do seletor", async () => {
    expect((await listar({ ...DO_SELETOR, search: inativo.name })).total).toBe(0);
    // O recorte é o `active=true` que a tela manda — o tipo dele entra.
    expect((await listar({ customerSupplied: "true", search: inativo.name })).codes).toEqual([inativo.code]);
  });

  it("o que o seletor oferece por tipo é o que o recebimento aceita, tipo por tipo", async () => {
    const casos = [
      { item: alvo, oferecido: true, extra: { expiryDate: "2027-12-31T12:00:00.000Z" }, status: 201 },
      { item: embalagem, oferecido: true, extra: {}, status: 201 },
      { item: produtoAcabado, oferecido: false, extra: {}, status: 400, erro: "invalid_item_type" },
    ];

    for (const caso of casos) {
      const oferecido = await listar({ customerSupplied: "true", ids: caso.item.id, pageSize: "1" });
      expect(oferecido.total, caso.item.code).toBe(caso.oferecido ? 1 : 0);

      const resposta = await receber(clienteA.id, caso.item.id, {
        supplierLot: `MATRIZ-${m}`,
        ...caso.extra,
      });
      expect(resposta.statusCode, `${caso.item.code}: ${resposta.body.slice(0, 200)}`).toBe(caso.status);
      if (caso.erro) expect(resposta.json().error).toBe(caso.erro);
    }
  });

  it("item sem controle de lote continua oferecido e continua recusado ao gravar", async () => {
    // A tela explica na linha como resolver; esconder o item faria ele sumir sem motivo.
    expect((await listar({ ...DO_SELETOR, ids: semLote.id, pageSize: "1" })).total).toBe(1);

    const resposta = await receber(clienteA.id, semLote.id, { supplierLot: `SEMLOTE-${m}` });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("lot_control_required");
  });
});

describe("Material do cliente sem corte — recebimento do item #1001", () => {
  it("recebe com quantidade, unidade, lote, dono, movimento e rastreio de sempre", async () => {
    const resposta = await receber(clienteA.id, alvo.id, {
      supplierLot: `FAB-${m}`,
      expiryDate: "2027-12-31T12:00:00.000Z",
      location: "DOCA-1",
    });
    expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(201);

    const recebimento = resposta.json();
    expect(recebimento.sourceType).toBe("CUSTOMER_SUPPLIED");
    expect(recebimento.customerId).toBe(clienteA.id);
    expect(recebimento.purchaseOrderId).toBeNull();
    expect(recebimento.lines).toHaveLength(1);

    const linha = recebimento.lines[0];
    expect(linha).toMatchObject({
      itemId: alvo.id,
      itemCode: alvo.code,
      unitCode: "kg",
      supplierLot: `FAB-${m}`,
      location: "DOCA-1",
      ownerType: "CUSTOMER",
      purchaseOrderLineId: null,
      actualUnitCost: null,
    });
    expect(Number(linha.receivedQuantity)).toBe(12.5);
    expect(linha.lotId).toBeTruthy();
    expect(linha.lotCode).toBeTruthy();

    const prisma = getPrisma();
    const lote = await prisma.lot.findUniqueOrThrow({ where: { id: linha.lotId } });
    expect(lote).toMatchObject({
      itemId: alvo.id,
      ownerType: "CUSTOMER",
      ownerCustomerId: clienteA.id,
      supplierId: null,
      supplierLot: `FAB-${m}`,
    });
    expect(lote.expiryDate?.toISOString()).toBe("2027-12-31T12:00:00.000Z");
    expect(lote.initialReceivedQuantity.toString()).toBe("12.5");

    const movimentos = await prisma.inventoryMovement.findMany({ where: { receiptLineId: linha.id } });
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]).toMatchObject({
      type: "RECEIPT_IN",
      itemId: alvo.id,
      lotId: lote.id,
      sourceType: "RECEIPT",
      sourceId: linha.id,
    });
    expect(movimentos[0]!.quantity.toString()).toBe("12.5");
  });

  it("Cliente A e Cliente B, mesmo item #1001 e mesmo lote do fabricante: cada um só vê o seu", async () => {
    const loteComum = `COMUM-${m}`;
    for (const cliente of [clienteA, clienteB]) {
      const resposta = await receber(cliente.id, alvo.id, {
        supplierLot: loteComum,
        expiryDate: "2027-12-31T12:00:00.000Z",
      });
      expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(201);
    }

    // Sem cliente, o mesmo texto traz os dois — o recorte é o dono, não a busca.
    const semCliente = await materiaisDoCliente({ search: loteComum });
    expect(new Set(semCliente.map((linha) => linha.customerId))).toEqual(
      new Set([clienteA.id, clienteB.id]),
    );

    for (const [cliente, outro] of [
      [clienteA, clienteB],
      [clienteB, clienteA],
    ] as const) {
      for (const termo of [loteComum, alvo.code, alvo.name]) {
        const linhas = await materiaisDoCliente({ customerId: cliente.id, search: termo });
        expect(linhas.length, termo).toBeGreaterThan(0);
        expect(linhas.every((linha) => linha.customerId === cliente.id), termo).toBe(true);
        expect(linhas.some((linha) => linha.customerId === outro.id), termo).toBe(false);
      }
    }

    // E o lote de cada recebimento nasceu com o dono do próprio recebimento.
    const lotes = await getPrisma().lot.findMany({
      where: { itemId: alvo.id, supplierLot: loteComum },
      select: { ownerType: true, ownerCustomerId: true },
    });
    expect(lotes).toHaveLength(2);
    expect(lotes.every((lote) => lote.ownerType === "CUSTOMER")).toBe(true);
    expect(new Set(lotes.map((lote) => lote.ownerCustomerId))).toEqual(new Set([clienteA.id, clienteB.id]));
  });
});
