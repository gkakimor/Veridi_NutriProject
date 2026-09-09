import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../db/prisma.js";
import { buildTestApp } from "../test-support/authenticated-app.js";
import { selectItemCostSource } from "./cost-source-selection.js";

/**
 * Regra canônica da seleção automática da fonte de custo (PRODUCT_RULES §53):
 *
 *   30 dias → 90 dias → última compra → oferta válida → referência manual
 *   → desconhecido.
 *
 * Cada caso abaixo monta UM item com exatamente as fontes que o caso quer e
 * pergunta à função canônica. A referência manual é criada pela rota real,
 * porque é ela que a tela usa; a compra passa pelo recebimento real, porque
 * preço de OC nunca vira custo.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItem: { itemId: { in: fixtureItemIds } } },
    });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    // A referência manual sai em cascata com o item.
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createItem(unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-SEL-${m}`,
      name: `Item Seleção ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-SEL-${m}`, legalName: `Fornecedor Seleção ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost: string; daysAgo: number },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date(Date.now() - params.daysAgo * DAY_MS).toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marker()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  expect(receipt.id, JSON.stringify(receipt)).toBeTruthy();
  fixtureReceiptIds.push(receipt.id);
}

/** Marcador de um dia civil — a mesma forma que a coluna guarda. */
function dia(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function approveSupplierWithOffer(
  itemId: string,
  params: {
    supplierId: string;
    unitPrice: string;
    priceUomCode?: string;
    preferred?: boolean;
    currencyCode?: string;
    /** `null` reproduz a oferta legada: preço sem data comercial. */
    effectiveAt?: Date | null;
    validUntil?: Date | null;
    qualificationStatus?: "PENDING" | "APPROVED" | "BLOCKED";
  },
) {
  const prisma = getPrisma();
  const supplierItem = await prisma.supplierItem.create({
    data: {
      itemId,
      supplierId: params.supplierId,
      qualificationStatus: params.qualificationStatus ?? "APPROVED",
      preferred: params.preferred ?? false,
      active: true,
    },
  });
  await prisma.supplierItemOffer.create({
    data: {
      supplierItemId: supplierItem.id,
      unitPrice: params.unitPrice,
      currencyCode: params.currencyCode ?? "BRL",
      priceUomCode: params.priceUomCode ?? "kg",
      effectiveAt:
        params.effectiveAt === undefined ? new Date(Date.now() - DAY_MS) : params.effectiveAt,
      validUntil: params.validUntil ?? null,
      source: "MANUAL",
    },
  });
  return supplierItem;
}

async function setManualReference(
  app: App,
  itemId: string,
  payload: { unitCost: string; uomCode?: string; effectiveFrom?: string; note?: string },
) {
  const response = await app.inject({
    method: "POST",
    url: `/items/${itemId}/cost-references`,
    payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

async function select(itemId: string, itemUnitCode: string, referenceDate = new Date()) {
  const prisma = getPrisma();
  const units = await prisma.unitOfMeasure.findMany();
  return selectItemCostSource(prisma, { itemId, itemUnitCode, referenceDate }, units);
}

describe("Seleção automática da fonte de custo — ordem canônica", () => {
  it("A. compra real nos últimos 30 dias vence tudo, inclusive referência manual (G)", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "1200" });
    await approveSupplierWithOffer(item.id, { supplierId: supplier.id, unitPrice: "900" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "1050", daysAgo: 10 });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("WEIGHTED_AVG_30D");
    expect(result.unitCost?.toString()).toBe("1050");
    await app.close();
  });

  it("B. sem compra em 30 dias, a média de 90 dias é a fonte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "1200" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "800", daysAgo: 60 });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("WEIGHTED_AVG_90D");
    expect(result.unitCost?.toString()).toBe("800");
    await app.close();
  });

  it("C. sem compra nas janelas, a última compra real é a fonte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "1200" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "700", daysAgo: 200 });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("LAST_REAL");
    expect(result.unitCost?.toString()).toBe("700");
    await app.close();
  });

  it("D. sem compra, a oferta válida de fornecedor homologado vence a referência manual", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "1200" });
    await approveSupplierWithOffer(item.id, { supplierId: supplier.id, unitPrice: "950" });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(result.unitCost?.toString()).toBe("950");
    await app.close();
  });

  it("E. sem compra nem oferta, a referência manual é usada — convertida para a unidade do item", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    // Item em gramas, referência declarada por quilo.
    const item = await createItem("g");
    await setManualReference(app, item.id, { unitCost: "1200", uomCode: "kg", note: "Cotação verbal" });

    const result = await select(item.id, "g");
    expect(result.source).toBe("MANUAL_REFERENCE");
    expect(result.unitCost?.toFixed(4)).toBe("1.2000");
    expect(result.details).toContain("Referência manual");
    expect(result.details).toContain("estimativa");
    await app.close();
  });

  it("F/M. sem fonte nenhuma o custo é DESCONHECIDO — null, nunca zero", async () => {
    const item = await createItem();
    const result = await select(item.id, "kg");
    expect(result.source).toBe("NO_COST");
    expect(result.unitCost).toBeNull();
    expect(result.unitCost).not.toEqual(new Prisma.Decimal(0));
  });

  it("B. várias ofertas válidas e exatamente um preferencial: usa o preferencial", async () => {
    const item = await createItem();
    const a = await createSupplier();
    const b = await createSupplier();
    await approveSupplierWithOffer(item.id, { supplierId: a.id, unitPrice: "900" });
    await approveSupplierWithOffer(item.id, { supplierId: b.id, unitPrice: "910", preferred: true });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("SUPPLIER_OFFER_PREFERRED");
    // O preferencial vence mesmo sendo o mais caro: preferência é decisão, não preço.
    expect(result.unitCost?.toString()).toBe("910");
  });

  it("C/D. várias ofertas válidas sem preferencial: seleção necessária — e a referência manual NÃO entra sozinha", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const a = await createSupplier();
    const b = await createSupplier();
    await approveSupplierWithOffer(item.id, { supplierId: a.id, unitPrice: "900" });
    await approveSupplierWithOffer(item.id, { supplierId: b.id, unitPrice: "910" });

    const semManual = await select(item.id, "kg");
    expect(semManual.source).toBe("AMBIGUOUS_SUPPLIER_REFERENCE");
    expect(semManual.unitCost).toBeNull();
    expect(semManual.details).toContain("nenhuma está definida como preferencial");
    expect(semManual.details).toContain("Defina a oferta preferencial");

    // A categoria "oferta válida" existe; ambiguidade dentro dela não pula
    // para a categoria seguinte.
    await setManualReference(app, item.id, { unitCost: "1000" });
    const comManual = await select(item.id, "kg");
    expect(comManual.source).toBe("AMBIGUOUS_SUPPLIER_REFERENCE");
    expect(comManual.unitCost).toBeNull();
    await app.close();
  });

  it("F. mais de um preferencial é inconsistência: o banco recusa a colisão, e a seleção continua com um só", async () => {
    const item = await createItem();
    const a = await createSupplier();
    const b = await createSupplier();
    await approveSupplierWithOffer(item.id, { supplierId: a.id, unitPrice: "900", preferred: true });

    // A colisão é impedida na origem: índice parcial único de preferencial
    // por item (`supplier_items_preferred_per_item_key`). O segundo
    // preferencial nem chega a existir — fail-closed no dado, não na leitura.
    await expect(
      approveSupplierWithOffer(item.id, { supplierId: b.id, unitPrice: "910", preferred: true }),
    ).rejects.toThrow(/Unique constraint|unique/i);

    // Sobrou uma relação só — e uma oferta só é a oferta única, preferencial ou não.
    const result = await select(item.id, "kg");
    expect(result.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(result.unitCost?.toString()).toBe("900");
  });

  it("duas referências com o mesmo válido desde: a criada por último vence, e o empate total é estável", async () => {
    const prisma = getPrisma();
    const item = await createItem();
    const dia = new Date(Date.UTC(2026, 7, 1));
    const antes = new Date("2026-08-01T10:00:00.000Z");
    const depois = new Date("2026-08-01T10:00:01.000Z");
    await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "100", uomCode: "kg", effectiveFrom: dia, createdAt: antes },
    });
    await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "120", uomCode: "kg", effectiveFrom: dia, createdAt: depois },
    });
    // Correção do mesmo dia: vale a última gravada.
    expect((await select(item.id, "kg")).unitCost?.toString()).toBe("120");

    // Empate até no instante de criação: o desempate por id é arbitrário,
    // mas estável — cinco leituras, uma resposta.
    const mesmoInstante = new Date("2026-08-01T11:00:00.000Z");
    const x = await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "130", uomCode: "kg", effectiveFrom: dia, createdAt: mesmoInstante },
    });
    const y = await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "140", uomCode: "kg", effectiveFrom: dia, createdAt: mesmoInstante },
    });
    const esperado = x.id > y.id ? "130" : "140";
    for (let i = 0; i < 5; i += 1) {
      expect((await select(item.id, "kg")).unitCost?.toString()).toBe(esperado);
    }
  });

  it("respeita a data de referência: a vigência que valia naquele dia, não a de hoje", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const antiga = new Date(Date.now() - 60 * DAY_MS).toISOString();
    await setManualReference(app, item.id, { unitCost: "500", effectiveFrom: antiga });
    // Alterar cria vigência nova; a anterior continua no histórico.
    await setManualReference(app, item.id, { unitCost: "650" });

    const hoje = await select(item.id, "kg");
    expect(hoje.unitCost?.toString()).toBe("650");

    const haDezDias = await select(item.id, "kg", new Date(Date.now() - 10 * DAY_MS));
    expect(haDezDias.source).toBe("MANUAL_REFERENCE");
    expect(haDezDias.unitCost?.toString()).toBe("500");

    // Antes de qualquer vigência: desconhecido, não a referência mais antiga.
    const antes = await select(item.id, "kg", new Date(Date.now() - 90 * DAY_MS));
    expect(antes.source).toBe("NO_COST");
    expect(antes.unitCost).toBeNull();

    const historico = await getPrisma().itemCostReference.findMany({ where: { itemId: item.id } });
    expect(historico).toHaveLength(2);
    await app.close();
  });

  it("referência em unidade incompatível com a do item não vira custo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem("kg");
    const recusada = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "10", uomCode: "un" },
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("cost_reference_unit_incompatible");

    const result = await select(item.id, "kg");
    expect(result.source).toBe("NO_COST");
    await app.close();
  });
});

/**
 * A oferta de fornecedor como fonte OPERACIONAL de custo — COST-SOURCE-01.
 *
 * O degrau 4 da hierarquia existia e nunca tinha sido exercitado por data:
 * todas as ofertas dos testes nasciam válidas desde ontem e sem fim. As 602
 * ofertas reais são o oposto — importadas, sem vigência nenhuma —, e o que
 * decide se uma delas participa do custo é exatamente a vigência. Estes
 * casos cobrem a condição inteira: dia civil nas duas bordas, moeda, e as
 * ausências que precisam continuar sendo ausência.
 */
describe("Oferta de fornecedor: vigência, moeda e ambiguidade", () => {
  it("E. oferta sem vigência é histórico, nunca custo — mesmo sendo o único número existente", async () => {
    const item = await createItem();
    const supplier = await createSupplier();
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "900",
      effectiveAt: null,
    });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("NO_COST");
    expect(result.unitCost).toBeNull();
  });

  it("F. a oferta substituída em 01/10: 30/09 usa a antiga, 01/10 usa a nova", async () => {
    const item = await createItem();
    const antigo = await createSupplier();
    const novo = await createSupplier();
    await approveSupplierWithOffer(item.id, {
      supplierId: antigo.id,
      unitPrice: "800",
      effectiveAt: dia("2026-09-01"),
      validUntil: dia("2026-09-30"),
    });
    await approveSupplierWithOffer(item.id, {
      supplierId: novo.id,
      unitPrice: "1000",
      effectiveAt: dia("2026-10-01"),
    });

    // Em 30/09 só a antiga está no ar — a nova ainda não começou, e por isso
    // não existe ambiguidade nenhuma para resolver.
    const emTrinta = await select(item.id, "kg", dia("2026-09-30"));
    expect(emTrinta.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(emTrinta.unitCost?.toString()).toBe("800");

    // Em 01/10 a antiga já venceu e a nova entrou. A troca é limpa: continua
    // havendo exatamente uma candidata.
    const emPrimeiro = await select(item.id, "kg", dia("2026-10-01"));
    expect(emPrimeiro.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(emPrimeiro.unitCost?.toString()).toBe("1000");
  });

  it("F. o dia inteiro conta nas DUAS bordas — a hora do instante perguntado não muda a resposta", async () => {
    const item = await createItem();
    const supplier = await createSupplier();
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "640",
      effectiveAt: dia("2026-09-15"),
      validUntil: dia("2026-09-20"),
    });

    // Primeiro instante do primeiro dia, último instante do último dia, e um
    // horário qualquer no meio: os três perguntam pelo mesmo DIA.
    for (const instante of [
      new Date("2026-09-15T00:00:00.000Z"),
      new Date("2026-09-15T23:59:59.999Z"),
      new Date("2026-09-20T00:00:00.000Z"),
      new Date("2026-09-20T18:30:00.000Z"),
      new Date("2026-09-20T23:59:59.999Z"),
    ]) {
      const result = await select(item.id, "kg", instante);
      expect(result.source, instante.toISOString()).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
      expect(result.unitCost?.toString(), instante.toISOString()).toBe("640");
    }

    // Um dia antes e um dia depois, a oferta não existe.
    expect((await select(item.id, "kg", dia("2026-09-14"))).source).toBe("NO_COST");
    expect((await select(item.id, "kg", dia("2026-09-21"))).source).toBe("NO_COST");
  });

  it("F. oferta com vigência futura não é usada hoje, e é usada na data futura — previsão sem motor novo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "500" });
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "1400",
      effectiveAt: new Date(Date.now() + 30 * DAY_MS),
    });

    // Hoje a oferta futura não existe: cai para a referência manual.
    const hoje = await select(item.id, "kg");
    expect(hoje.source).toBe("MANUAL_REFERENCE");
    expect(hoje.unitCost?.toString()).toBe("500");

    // Na data em que ela passa a valer, o CMV daquele dia já a enxerga.
    const futuro = await select(item.id, "kg", new Date(Date.now() + 31 * DAY_MS));
    expect(futuro.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(futuro.unitCost?.toString()).toBe("1400");
    await app.close();
  });

  it("G. oferta vencida é ignorada e o motor cai para a referência manual — nunca para a oferta anterior", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "500" });
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "1400",
      effectiveAt: new Date(Date.now() - 60 * DAY_MS),
      validUntil: new Date(Date.now() - 5 * DAY_MS),
    });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("MANUAL_REFERENCE");
    expect(result.unitCost?.toString()).toBe("500");
    await app.close();
  });

  it("H. oferta em moeda estrangeira não vira custo em reais — não existe câmbio", async () => {
    const item = await createItem();
    const supplier = await createSupplier();
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "120",
      currencyCode: "USD",
    });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("NO_COST");
    expect(result.unitCost).toBeNull();
  });

  it("H. USD ao lado de BRL: a oferta em real é a única candidata, e não há ambiguidade", async () => {
    const item = await createItem();
    const gringo = await createSupplier();
    const local = await createSupplier();
    await approveSupplierWithOffer(item.id, { supplierId: gringo.id, unitPrice: "120", currencyCode: "USD" });
    await approveSupplierWithOffer(item.id, { supplierId: local.id, unitPrice: "780" });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("SUPPLIER_OFFER_SINGLE_APPROVED");
    expect(result.unitCost?.toString()).toBe("780");
  });

  it("D. fornecedor preferencial SEM oferta vigente não cria custo — o motor segue o fallback", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    await setManualReference(app, item.id, { unitCost: "410" });
    // Preferencial é decisão da relação; vigência é condição da oferta. As
    // duas são independentes, e marcar uma não supre a outra.
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "999",
      preferred: true,
      effectiveAt: null,
    });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("MANUAL_REFERENCE");
    expect(result.unitCost?.toString()).toBe("410");
    await app.close();
  });

  it("relação não homologada com oferta válida não entra — homologação é condição, não detalhe", async () => {
    const item = await createItem();
    const supplier = await createSupplier();
    await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "700",
      qualificationStatus: "PENDING",
    });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("NO_COST");
  });

  it("vigências sobrepostas do MESMO fornecedor: vale a de início mais recente", async () => {
    const item = await createItem();
    const supplier = await createSupplier();
    const relacao = await approveSupplierWithOffer(item.id, {
      supplierId: supplier.id,
      unitPrice: "500",
      effectiveAt: dia("2026-09-01"),
      validUntil: dia("2026-12-31"),
    });
    // Correção de preço no meio da vigência anterior: oferta NOVA, sem
    // encerrar a antiga. O comportamento hoje é determinístico e é este.
    await getPrisma().supplierItemOffer.create({
      data: {
        supplierItemId: relacao.id,
        unitPrice: "560",
        currencyCode: "BRL",
        priceUomCode: "kg",
        effectiveAt: dia("2026-09-10"),
        source: "MANUAL",
      },
    });

    const antes = await select(item.id, "kg", dia("2026-09-05"));
    expect(antes.unitCost?.toString()).toBe("500");

    const depois = await select(item.id, "kg", dia("2026-09-20"));
    expect(depois.unitCost?.toString()).toBe("560");
  });

  it("I/J. referência manual em moeda estrangeira é ignorada, e a em real vence", async () => {
    const item = await createItem();
    const prisma = getPrisma();
    // Escrita direta: a rota só grava BRL, e o cenário a proteger é o de uma
    // referência não-BRL chegar ao banco por importação ou capacidade futura.
    await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "80", currencyCode: "USD", uomCode: "kg", effectiveFrom: dia("2026-09-01") },
    });

    // Só a referência em dólar: custo DESCONHECIDO. Tratá-la como real
    // devolveria 80 — um número plausível e errado, o pior tipo de erro de
    // custo, porque ninguém confere o que parece certo.
    const soDolar = await select(item.id, "kg", dia("2026-09-05"));
    expect(soDolar.source).toBe("NO_COST");
    expect(soDolar.unitCost).toBeNull();

    await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "430", currencyCode: "BRL", uomCode: "kg", effectiveFrom: dia("2026-09-02") },
    });

    const comReal = await select(item.id, "kg", dia("2026-09-05"));
    expect(comReal.source).toBe("MANUAL_REFERENCE");
    expect(comReal.unitCost?.toString()).toBe("430");
  });

  it("a referência em dólar mais NOVA não esconde a em real mais antiga", async () => {
    const item = await createItem();
    const prisma = getPrisma();
    await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "300", currencyCode: "BRL", uomCode: "kg", effectiveFrom: dia("2026-09-01") },
    });
    await prisma.itemCostReference.create({
      data: { itemId: item.id, unitCost: "90", currencyCode: "USD", uomCode: "kg", effectiveFrom: dia("2026-09-10") },
    });

    // A vigência mais recente é a de dólar. Filtrar DEPOIS de escolher a
    // vigente devolveria "sem custo"; o filtro é parte da escolha.
    const result = await select(item.id, "kg", dia("2026-09-20"));
    expect(result.source).toBe("MANUAL_REFERENCE");
    expect(result.unitCost?.toString()).toBe("300");
  });

  it("compra real recente continua vencendo a oferta válida — a hierarquia não mudou", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();
    const outro = await createSupplier();
    await approveSupplierWithOffer(item.id, { supplierId: outro.id, unitPrice: "300" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "1050", daysAgo: 3 });

    const result = await select(item.id, "kg");
    expect(result.source).toBe("WEIGHTED_AVG_30D");
    expect(result.unitCost?.toString()).toBe("1050");
    await app.close();
  });
});
