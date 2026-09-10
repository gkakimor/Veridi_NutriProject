import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../db/prisma.js";
import { buildTestApp } from "../test-support/authenticated-app.js";
import { getItemCostReference, limitesDaJanelaDeCusto } from "./cost-reference.js";
import { selectItemCostSource } from "./cost-source-selection.js";

/**
 * O DIA COMERCIAL dentro do motor de custo — COST-COMMERCIAL-DAY-01.
 *
 * Duas perguntas diferentes moram no mesmo cálculo, e confundi-las custava
 * três horas de custo errado por dia:
 *
 * - `referenceDate` é DATA CIVIL: "qual era o custo no dia 09/09?".
 * - `Receipt.receivedAt` é INSTANTE: o momento em que a carga entrou.
 *
 * A ponte entre as duas é o dia comercial de São Paulo. O dia 09/09 termina
 * às 23:59:59.999 em São Paulo — `2026-09-10T02:59:59.999Z` —, não às
 * 23:59:59.999 UTC. Enquanto o limite era o fim do dia UTC, todo recebimento
 * lançado entre 21:00 e 23:59 de São Paulo caía FORA do próprio dia: o CMV
 * respondia com uma fonte antiga (ou `NO_COST`) para uma compra que já estava
 * gravada no banco.
 *
 * Nada aqui depende do relógio da máquina. Todo instante é absoluto e escrito
 * em UTC, e o único teste que precisa de "hoje" congela o relógio — por isso a
 * prova vale idêntica em UTC, America/Vancouver, America/Sao_Paulo ou
 * Asia/Tokyo.
 */

const DIA_REF = "2026-09-09";
/** O marcador que a coluna de data civil guarda para 09/09. */
const REFERENCE_DATE = new Date(`${DIA_REF}T00:00:00.000Z`);
/** 10/09 no relógio UTC, mas ainda 09/09 às 22:30 em São Paulo. */
const NOITE_DO_DIA = new Date("2026-09-10T01:30:00.000Z");
/** 00:30 de 10/09 em São Paulo — o dia comercial SEGUINTE. */
const MADRUGADA_SEGUINTE = new Date("2026-09-10T03:30:00.000Z");
/** Marcador civil de 10/09. */
const DIA_SEGUINTE = new Date("2026-09-10T00:00:00.000Z");

/** 20/08 ao meio-dia — bem dentro da janela de 30 dias, longe de qualquer borda. */
const COMPRA_ANTIGA_30D = new Date("2026-08-20T15:00:00.000Z");
/** 01/07 — dentro de 90 dias, fora de 30. */
const COMPRA_ANTIGA_90D = new Date("2026-07-01T15:00:00.000Z");
/** Primeiro instante do dia comercial 11/06 — o dia D-90 exato. */
const PRIMEIRO_INSTANTE_D90 = new Date("2026-06-11T03:00:00.000Z");
/** Último instante do dia comercial 10/06 — o dia D-91, um milissegundo antes. */
const ULTIMO_INSTANTE_D91 = new Date("2026-06-11T02:59:59.999Z");
/** 09/06 às 22:30 em São Paulo — D-91, fim do dia comercial, fora das duas janelas. */
const NOITE_MUITO_ANTIGA = new Date("2026-06-10T01:30:00.000Z");

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
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterEach(() => {
  vi.useRealTimers();
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
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createItem() {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-DIA-${m}`,
      name: `Item Dia Comercial ${m}`,
      unitCode: "kg",
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
    data: { code: `FOR-DIA-${m}`, legalName: `Fornecedor Dia ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

/**
 * Uma compra REAL, recebida num INSTANTE exato.
 *
 * Passa pela rota de recebimento de verdade — preço de OC nunca vira custo, e
 * o que alimenta a média é `ReceiptLine.actualUnitCost`. `receivedAt` é
 * absoluto e escrito à mão: é justamente o instante que este teste discute.
 */
async function receberEm(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost: string; receivedAt: Date },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: params.receivedAt.toISOString(),
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
        receivedAt: params.receivedAt.toISOString(),
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

async function selecionar(itemId: string, referenceDate: Date) {
  const prisma = getPrisma();
  const units = await prisma.unitOfMeasure.findMany();
  return selectItemCostSource(prisma, { itemId, itemUnitCode: "kg", referenceDate }, units);
}

describe("as bordas da janela de custo", () => {
  it("são dias comerciais inteiros, nas duas pontas", () => {
    const janela30 = limitesDaJanelaDeCusto(REFERENCE_DATE, 30);
    const janela90 = limitesDaJanelaDeCusto(REFERENCE_DATE, 90);

    // Fim: 23:59:59.999 de 09/09 em São Paulo. O limite antigo era
    // `2026-09-09T23:59:59.999Z` — 20:59:59 de São Paulo, três horas cedo.
    expect(janela30.fim.toISOString()).toBe("2026-09-10T02:59:59.999Z");
    expect(janela90.fim.toISOString()).toBe("2026-09-10T02:59:59.999Z");

    // Início: 00:00 de 10/08 e de 11/06 em São Paulo. Os limites antigos eram
    // as meia-noites UTC dos mesmos dias — três horas cedo demais, deixando
    // entrar a noite do dia anterior à janela.
    expect(janela30.inicio.toISOString()).toBe("2026-08-10T03:00:00.000Z");
    expect(janela90.inicio.toISOString()).toBe("2026-06-11T03:00:00.000Z");

    // A contagem de dias não mudou: 30 e 90 dias de calendário para trás.
    expect(janela30.inicio.toISOString().slice(0, 10)).toBe("2026-08-10");
    expect(janela90.inicio.toISOString().slice(0, 10)).toBe("2026-06-11");
  });

  it("o deslocamento do fuso sai da base do Intl, e não de -03:00 escrito à mão", () => {
    // 05/11/2018: o Brasil estava em horário de verão, e o dia comercial
    // começava às 02:00Z. Um "+3 horas" fixo erraria por uma hora.
    const janela = limitesDaJanelaDeCusto(new Date("2018-11-05T00:00:00.000Z"), 0);
    expect(janela.inicio.toISOString()).toBe("2018-11-05T02:00:00.000Z");
    expect(janela.fim.toISOString()).toBe("2018-11-06T01:59:59.999Z");
  });
});

describe("independência do fuso da máquina", () => {
  /** A hora de parede de um instante, lida em São Paulo. */
  function horaEmSaoPaulo(instante: Date): string {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(instante);
  }

  it("as bordas são meia-noite e 23:59:59 em São Paulo, qualquer que seja o fuso local", () => {
    // A leitura é feita com `timeZone` explícito, então este invariante não
    // muda em UTC, America/Vancouver, America/Sao_Paulo ou Asia/Tokyo: o que
    // o motor calcula não passa em nenhum momento pelo relógio da máquina.
    for (const dias of [0, 30, 90]) {
      const janela = limitesDaJanelaDeCusto(REFERENCE_DATE, dias);
      expect(horaEmSaoPaulo(janela.inicio)).toBe("00:00:00");
      expect(horaEmSaoPaulo(janela.fim)).toBe("23:59:59");
      expect(janela.fim.getUTCMilliseconds()).toBe(999);
    }
  });

  it("nenhum arquivo do caminho de custo lê o relógio local", async () => {
    const { readFile } = await import("node:fs/promises");
    const arquivos = [
      new URL("./cost-reference.ts", import.meta.url),
      new URL("./cost-source-selection.ts", import.meta.url),
      new URL("./business-day.ts", import.meta.url),
      new URL("../modules/items/item-cost-references.service.ts", import.meta.url),
    ];
    // `setHours`/`getHours` leem o fuso da máquina; um deslocamento escrito à
    // mão ignora o horário de verão. Quem decide o deslocamento é o `Intl`, e
    // só dentro da fundação temporal. Comentário não é código: a prosa que
    // PROÍBE o offset fixo não pode disparar o próprio guarda.
    const semComentarios = (fonte: string) =>
      fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const proibidos = [/\.setHours\(/, /\.getHours\(/, /-03:00/, /UTC-3/];
    for (const arquivo of arquivos) {
      const codigo = semComentarios(await readFile(arquivo, "utf8"));
      for (const proibido of proibidos) {
        expect(proibido.test(codigo), `${arquivo.pathname} contém ${proibido}`).toBe(false);
      }
    }
  });
});

describe("compra do próprio dia comercial", () => {
  it("recebimento das 22:30 de São Paulo entra na média de 30 dias do PRÓPRIO dia", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();

    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "10",
      receivedAt: COMPRA_ANTIGA_30D,
    });
    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "300",
      unitCost: "20",
      receivedAt: NOITE_DO_DIA,
    });

    const resultado = await selecionar(item.id, REFERENCE_DATE);

    // (100 x 10 + 300 x 20) / 400 = 7000 / 400 = 17,5. Sem a compra das 22:30
    // o número seria 10 — o custo de três semanas antes.
    expect(resultado.source).toBe("WEIGHTED_AVG_30D");
    expect(resultado.unitCost?.toString()).toBe("17.5");
    expect(resultado.details).toContain("2 recebimento(s)");
    await app.close();
  });

  it("recebimento das 00:30 do dia seguinte NÃO entra no dia anterior", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();

    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "10",
      receivedAt: COMPRA_ANTIGA_30D,
    });
    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "300",
      unitCost: "20",
      receivedAt: MADRUGADA_SEGUINTE,
    });

    // Corrigir a borda de cima não pode virar "abrir a janela mais um pouco".
    const noDia = await selecionar(item.id, REFERENCE_DATE);
    expect(noDia.source).toBe("WEIGHTED_AVG_30D");
    expect(noDia.unitCost?.toString()).toBe("10");
    expect(noDia.details).toContain("1 recebimento(s)");

    // No dia seguinte ela conta, e o número muda.
    const noDiaSeguinte = await selecionar(item.id, DIA_SEGUINTE);
    expect(noDiaSeguinte.source).toBe("WEIGHTED_AVG_30D");
    expect(noDiaSeguinte.unitCost?.toString()).toBe("17.5");
    await app.close();
  });
});

describe("bordas da janela de 90 dias", () => {
  it("o primeiro instante do dia D-90 entra; o último do dia D-91 fica fora", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();

    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "30",
      receivedAt: PRIMEIRO_INSTANTE_D90,
    });
    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "90",
      receivedAt: ULTIMO_INSTANTE_D91,
    });

    // Só a de 11/06 é elegível: a de 10/06 às 23:59:59.999 pertence ao dia
    // comercial anterior à janela. Média das duas daria 60.
    const resultado = await selecionar(item.id, REFERENCE_DATE);
    expect(resultado.source).toBe("WEIGHTED_AVG_90D");
    expect(resultado.unitCost?.toString()).toBe("30");
    expect(resultado.details).toContain("1 recebimento(s)");
    await app.close();
  });

  it("a borda de cima da janela de 90 dias é o fim do dia comercial da pergunta", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();

    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "40",
      receivedAt: COMPRA_ANTIGA_90D,
    });
    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "900",
      unitCost: "80",
      receivedAt: MADRUGADA_SEGUINTE,
    });

    // A compra de 10/09 00:30 São Paulo é do dia seguinte: se vazasse para
    // dentro do dia 09/09, a fonte seria a janela de 30 dias, não a de 90.
    const resultado = await selecionar(item.id, REFERENCE_DATE);
    expect(resultado.source).toBe("WEIGHTED_AVG_90D");
    expect(resultado.unitCost?.toString()).toBe("40");
    await app.close();
  });
});

describe("última compra real", () => {
  it("compra no fim do dia comercial é elegível, mesmo velha demais para as janelas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();

    // 09/06 às 22:30 de São Paulo: dia comercial D-91, fora de 30 e de 90.
    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "50",
      unitCost: "55",
      receivedAt: NOITE_MUITO_ANTIGA,
    });

    const resultado = await selecionar(item.id, REFERENCE_DATE);
    expect(resultado.source).toBe("LAST_REAL");
    expect(resultado.unitCost?.toString()).toBe("55");
    // O texto mostra o dia comercial da compra — 09/06, não 10/06.
    expect(resultado.details).toContain("09/06/2026");
    await app.close();
  });

  it("a última compra real nunca enxerga o dia comercial seguinte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await createItem();
    const supplier = await createSupplier();

    await receberEm(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "50",
      unitCost: "55",
      receivedAt: MADRUGADA_SEGUINTE,
    });

    const noDia = await getItemCostReference(getPrisma(), item.id, REFERENCE_DATE);
    expect(noDia.source).toBe("NO_COST");
    expect(noDia.unitCost).toBeNull();

    const noDiaSeguinte = await getItemCostReference(getPrisma(), item.id, DIA_SEGUINTE);
    expect(noDiaSeguinte.source).toBe("ESTIMATED_30D");
    await app.close();
  });
});

describe("referência manual criada hoje", () => {
  it('às 22:30 de São Paulo, "hoje" é o dia comercial de hoje — não o dia UTC de amanhã', async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOITE_DO_DIA);

    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const item = await createItem();

    const criada = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "42", note: "Cotação de balcão às 22:30" },
    });
    expect(criada.statusCode, criada.body).toBe(201);

    // O que ficou GRAVADO é o marcador civil de 09/09. Antes virava 10/09,
    // porque o instante das 22:30 em São Paulo já é 10/09 em UTC.
    expect(criada.json().current.effectiveFrom).toBe(`${DIA_REF}T00:00:00.000Z`);

    // E o custo do dia 09/09 já encontra a referência criada no dia 09/09.
    const resultado = await selecionar(item.id, REFERENCE_DATE);
    expect(resultado.source).toBe("MANUAL_REFERENCE");
    expect(resultado.unitCost?.toString()).toBe("42");
    await app.close();
  });

  it("vigência explícita para amanhã continua valendo só amanhã", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOITE_DO_DIA);

    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const item = await createItem();

    const criada = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "77", effectiveFrom: "2026-09-10" },
    });
    expect(criada.statusCode, criada.body).toBe(201);
    // Data civil explícita é preservada como veio, sem releitura pelo relógio.
    expect(criada.json().history[0].effectiveFrom).toBe("2026-09-10T00:00:00.000Z");
    // E ainda não é a vigência atual: hoje, na Veridi, ainda é 09/09.
    expect(criada.json().current).toBeNull();

    const hoje = await selecionar(item.id, REFERENCE_DATE);
    expect(hoje.source).toBe("NO_COST");

    const amanha = await selecionar(item.id, DIA_SEGUINTE);
    expect(amanha.source).toBe("MANUAL_REFERENCE");
    expect(amanha.unitCost?.toString()).toBe("77");
    await app.close();
  });

  it('sem data de referência, o motor pergunta pelo dia comercial — e não antecipa a vigência de amanhã', async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOITE_DO_DIA);

    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const item = await createItem();

    await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "77", effectiveFrom: "2026-09-10" },
    });

    // "Hoje" implícito às 22:30 de São Paulo é 09/09. A vigência de 10/09
    // ainda não vale: o dia comercial não virou.
    const implicito = await getItemCostReference(getPrisma(), item.id);
    expect(implicito.referenceDate.toISOString()).toBe(`${DIA_REF}T00:00:00.000Z`);

    const listagem = await app.inject({ method: "GET", url: `/items/${item.id}/cost-references` });
    expect(listagem.json().automatic.source).toBe("NO_COST");
    expect(listagem.json().automatic.referenceDate).toBe(`${DIA_REF}T00:00:00.000Z`);
    await app.close();
  });
});
