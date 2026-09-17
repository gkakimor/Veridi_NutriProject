import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ItemType, UomDimension, UserRole } from "@prisma/client";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getOnHand } from "../../lib/inventory-ledger.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * CONSUMO INTERNO — Uso e consumo, Fatia 2 (INTERNAL-CONSUMPTION-01).
 *
 * O que este arquivo prova, e por quê:
 *
 * - a saída é do LEDGER, com tipo próprio. Se o consumo virasse
 *   `ADJUSTMENT_OUT`, nenhum relatório separaria "o estoque estava errado" de
 *   "a empresa usou o material";
 * - só Item de uso e consumo sai por aqui. Matéria-prima, embalagem e produto
 *   acabado têm saída própria, e uma segunda porta para elas baixaria material
 *   de receita sem OP nenhuma;
 * - o custo é o da hierarquia REAL → 30d → 90d → último real → `NO_COST`, e
 *   fica CONGELADO. Uma compra posterior não pode reescrever a despesa;
 * - ausência de custo é `null`. **Nunca R$ 0,00** — zero é custo real zero, e
 *   confundir os dois inventa despesa que não houve.
 *
 * Nada aqui depende do relógio da máquina para o resultado: as compras são
 * posicionadas por deslocamento em dias a partir de agora, bem longe das
 * bordas das janelas de 30 e 90 dias (COST-COMMERCIAL-DAY-01 já prova as
 * bordas em si).
 */

const DIA_MS = 24 * 60 * 60 * 1000;

const itens: string[] = [];
const fornecedores: string[] = [];
const pedidosDeCompra: string[] = [];
const recebimentos: string[] = [];
const consumos: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const admin = () => buildTestApp("ADMIN");

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (consumos.length > 0) {
    await prisma.internalConsumption.deleteMany({ where: { id: { in: consumos } } });
  }
  if (recebimentos.length > 0) {
    await prisma.inventoryMovement.deleteMany({
      where: { receiptLine: { is: { receiptId: { in: recebimentos } } } },
    });
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: recebimentos } } });
    await prisma.receipt.deleteMany({ where: { id: { in: recebimentos } } });
  }
  if (pedidosDeCompra.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: pedidosDeCompra } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: pedidosDeCompra } } });
  }
  if (itens.length > 0) {
    await prisma.internalConsumption.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
});

async function criarItem(type: ItemType, extra: Record<string, unknown> = {}) {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `CI-${type.slice(0, 2)}-${m}`,
      name: `Item ${type} ${m}`,
      unitCode: "un",
      ...ITEM_TYPE_DEFAULTS[type],
      active: true,
      ...extra,
    },
  });
  itens.push(item.id);
  return item;
}

async function criarFornecedor() {
  const m = marca();
  const supplier = await getPrisma().supplier.create({
    data: { code: `FOR-CI-${m}`, legalName: `Fornecedor CI ${m}`, active: true },
  });
  fornecedores.push(supplier.id);
  return supplier;
}

/**
 * Saldo SEM custo nenhum — entrada de ajuste direto no ledger.
 *
 * É o cenário de `NO_COST`: material no depósito e nenhuma compra com custo
 * real por trás. Ele não passa por recebimento de propósito: recebimento com
 * `actualUnitCost` é justamente o que cria custo.
 */
async function entradaSemCusto(itemId: string, quantity: string) {
  await getPrisma().inventoryMovement.create({
    data: {
      itemId,
      type: "ADJUSTMENT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Saldo de teste",
    },
  });
}

/** Uma compra REAL recebida num instante, com custo efetivo informado. */
async function receber(
  app: App,
  params: { itemId: string; quantity: string; unitCost: string; receivedAt: Date },
) {
  const supplier = await criarFornecedor();
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: params.receivedAt.toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  expect(po.id, JSON.stringify(po)).toBeTruthy();
  pedidosDeCompra.push(po.id);
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
            supplierLot: `SUP-${marca()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  expect(receipt.id, JSON.stringify(receipt)).toBeTruthy();
  recebimentos.push(receipt.id);
  return receipt;
}

async function consumir(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/internal-consumptions", payload });
  if (resposta.statusCode === 201) consumos.push(resposta.json().id as string);
  return resposta;
}

describe("consumo interno — a operação", () => {
  it("baixa o estoque de um item de uso e consumo com saldo", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "50");

    const resposta = await consumir(app, {
      itemId: item.id,
      quantity: "12",
      purpose: "Escritório",
      notes: "Reposição do armário",
    });

    expect(resposta.statusCode, resposta.body).toBe(201);
    const consumo = resposta.json();
    expect(consumo.code).toMatch(/^CI-\d{6}$/);
    expect(consumo.itemId).toBe(item.id);
    expect(consumo.quantity).toBe("12");
    expect(consumo.uomCode).toBe("un");
    expect(consumo.purpose).toBe("Escritório");
    expect(consumo.notes).toBe("Reposição do armário");
    expect(consumo.lotId).toBeNull();
    expect(consumo.registeredByName).toBe("Usuário de Teste ADMIN");

    await app.close();
  });

  it("cria UM movimento do ledger, do tipo do consumo interno", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "30");

    const consumo = (await consumir(app, { itemId: item.id, quantity: "7" })).json();

    const movimentos = await getPrisma().inventoryMovement.findMany({
      where: { itemId: item.id, type: "INTERNAL_CONSUMPTION" },
    });
    expect(movimentos).toHaveLength(1);
    const movimento = movimentos[0]!;
    expect(movimento.sourceType).toBe("INTERNAL_CONSUMPTION");
    expect(movimento.sourceId).toBe(consumo.id);
    // Magnitude positiva — o sinal vem do tipo, nunca de um valor negativo.
    expect(movimento.quantity.toString()).toBe("7");
    expect(movimento.createdBy).toBe("Usuário de Teste ADMIN");
    expect(consumo.inventoryMovementId).toBe(movimento.id);

    await app.close();
  });

  it("reduz o saldo exatamente pela quantidade consumida", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "40");

    await consumir(app, { itemId: item.id, quantity: "15" });

    const saldo = await getOnHand(getPrisma(), { itemId: item.id });
    expect(saldo.toString()).toBe("25");

    await app.close();
  });

  it("recusa quantidade acima do saldo disponível, sem gravar nada", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "5");

    const resposta = await consumir(app, { itemId: item.id, quantity: "5.001" });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("insufficient_stock");
    expect(await getPrisma().internalConsumption.count({ where: { itemId: item.id } })).toBe(0);
    expect((await getOnHand(getPrisma(), { itemId: item.id })).toString()).toBe("5");

    await app.close();
  });

  it("recusa data de consumo no futuro", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "10");
    const amanha = new Date(Date.now() + 2 * DIA_MS).toISOString().slice(0, 10);

    const resposta = await consumir(app, { itemId: item.id, quantity: "1", occurredOn: amanha });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("future_date");

    await app.close();
  });
});

describe("consumo interno — o escopo do tipo de Item", () => {
  /*
   * Lista de PERMISSÃO: cada recusa é provada onde ela mora. Que o shared
   * tenha a lista certa não prova que o serviço a consulta.
   */
  const recusados: [ItemType, string][] = [
    ["RAW_MATERIAL", "matéria-prima"],
    ["PACKAGING", "embalagem"],
    ["FINISHED_PRODUCT", "produto acabado"],
  ];

  for (const [type, rotulo] of recusados) {
    it(`recusa ${rotulo}, mesmo com saldo`, async () => {
      const app = admin();
      await app.ready();
      const item = await criarItem(type, { controlsLot: false, controlsExpiry: false });
      await entradaSemCusto(item.id, "100");

      const resposta = await consumir(app, { itemId: item.id, quantity: "1" });

      expect(resposta.statusCode, `${type}: ${resposta.body}`).toBe(400);
      expect(resposta.json().error, type).toBe("invalid_item_type");
      expect(await getPrisma().internalConsumption.count({ where: { itemId: item.id } })).toBe(0);

      await app.close();
    });
  }
});

describe("consumo interno — permissões", () => {
  const registram: UserRole[] = ["ADMIN", "PURCHASING", "PRODUCTION", "QUALITY"];

  for (const role of registram) {
    it(`${role} registra consumo`, async () => {
      const app = buildTestApp(role);
      await app.ready();
      const item = await criarItem("INTERNAL_CONSUMABLE");
      await entradaSemCusto(item.id, "10");

      const resposta = await consumir(app, { itemId: item.id, quantity: "2" });

      expect(resposta.statusCode, `${role}: ${resposta.body}`).toBe(201);

      await app.close();
    });
  }

  it("COMMERCIAL não registra — 403 antes da validação do corpo", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    // Corpo inválido de propósito: a recusa tem de ser por PERFIL (403), não
    // o 400 da validação, que diria que a rota aceitaria a operação.
    const resposta = await app.inject({
      method: "POST",
      url: "/internal-consumptions",
      payload: { quantity: "" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().error).toBe("forbidden");

    await app.close();
  });

  it("VIEWER lê o histórico, mas não registra", async () => {
    const app = buildTestApp("VIEWER");
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "10");

    const escrita = await app.inject({
      method: "POST",
      url: "/internal-consumptions",
      payload: { itemId: item.id, quantity: "1" },
    });
    expect(escrita.statusCode).toBe(403);

    const leitura = await app.inject({ method: "GET", url: "/internal-consumptions" });
    expect(leitura.statusCode).toBe(200);
    expect(Array.isArray(leitura.json().consumptions)).toBe(true);

    await app.close();
  });
});

describe("consumo interno — o custo congelado", () => {
  it("usa o custo REAL do lote efetivamente consumido", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE", { controlsLot: true });
    await receber(app, {
      itemId: item.id,
      quantity: "20",
      unitCost: "3.50",
      receivedAt: new Date(Date.now() - 3 * DIA_MS),
    });
    const lote = (await getPrisma().lot.findFirst({ where: { itemId: item.id } }))!;

    const consumo = (
      await consumir(app, { itemId: item.id, lotId: lote.id, quantity: "4" })
    ).json();

    expect(consumo.costSource).toBe("REAL");
    expect(Number(consumo.unitCost)).toBe(3.5);
    expect(Number(consumo.totalCost)).toBe(14);
    expect(consumo.costDetails).toContain(lote.code);

    await app.close();
  });

  it("cai na média ponderada dos últimos 30 dias quando não há custo de lote", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    // 10 a 10,00 e 90 a 20,00 = 19,00 ponderado; a média simples daria 15,00.
    await receber(app, {
      itemId: item.id,
      quantity: "10",
      unitCost: "10",
      receivedAt: new Date(Date.now() - 5 * DIA_MS),
    });
    await receber(app, {
      itemId: item.id,
      quantity: "90",
      unitCost: "20",
      receivedAt: new Date(Date.now() - 4 * DIA_MS),
    });

    const consumo = (await consumir(app, { itemId: item.id, quantity: "2" })).json();

    expect(consumo.costSource).toBe("ESTIMATED_30D");
    expect(Number(consumo.unitCost)).toBe(19);
    expect(Number(consumo.totalCost)).toBe(38);

    await app.close();
  });

  it("cai nos 90 dias quando a janela de 30 está vazia", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await receber(app, {
      itemId: item.id,
      quantity: "8",
      unitCost: "7.25",
      receivedAt: new Date(Date.now() - 45 * DIA_MS),
    });

    const consumo = (await consumir(app, { itemId: item.id, quantity: "3" })).json();

    expect(consumo.costSource).toBe("ESTIMATED_90D");
    expect(Number(consumo.unitCost)).toBe(7.25);
    expect(Number(consumo.totalCost)).toBe(21.75);

    await app.close();
  });

  it("cai no último custo real conhecido quando as duas janelas estão vazias", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await receber(app, {
      itemId: item.id,
      quantity: "6",
      unitCost: "2.40",
      receivedAt: new Date(Date.now() - 200 * DIA_MS),
    });

    const consumo = (await consumir(app, { itemId: item.id, quantity: "5" })).json();

    expect(consumo.costSource).toBe("LAST_REAL_COST");
    expect(Number(consumo.unitCost)).toBe(2.4);
    expect(Number(consumo.totalCost)).toBe(12);

    await app.close();
  });

  it("sem custo real nenhum grava NO_COST com valor nulo — nunca zero", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "10");

    const consumo = (await consumir(app, { itemId: item.id, quantity: "3" })).json();

    expect(consumo.costSource).toBe("NO_COST");
    expect(consumo.unitCost).toBeNull();
    expect(consumo.totalCost).toBeNull();

    // A ausência também é nula NA COLUNA: um zero gravado viraria despesa
    // real de R$ 0,00 em qualquer soma futura, e ninguém saberia a diferença.
    const gravado = (await getPrisma().internalConsumption.findUnique({
      where: { id: consumo.id },
    }))!;
    expect(gravado.unitCost).toBeNull();
    expect(gravado.totalCost).toBeNull();

    await app.close();
  });

  it("uma compra posterior não reescreve o custo do consumo já registrado", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await receber(app, {
      itemId: item.id,
      quantity: "100",
      unitCost: "5",
      receivedAt: new Date(Date.now() - 6 * DIA_MS),
    });

    const consumo = (await consumir(app, { itemId: item.id, quantity: "10" })).json();
    expect(Number(consumo.unitCost)).toBe(5);

    // Compra nova, muito mais cara, depois do consumo.
    await receber(app, {
      itemId: item.id,
      quantity: "900",
      unitCost: "80",
      receivedAt: new Date(Date.now() - 1 * DIA_MS),
    });

    const relido = (
      await app.inject({ method: "GET", url: `/internal-consumptions/${consumo.id}` })
    ).json();
    expect(relido.costSource).toBe("ESTIMATED_30D");
    expect(Number(relido.unitCost)).toBe(5);
    expect(Number(relido.totalCost)).toBe(50);

    await app.close();
  });
});

describe("consumo interno — histórico e disponibilidade", () => {
  it("o histórico traz quem, quando, o quê, quanto, destino e custo", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "20");
    await consumir(app, { itemId: item.id, quantity: "4", purpose: "Limpeza" });

    const lista = (
      await app.inject({ method: "GET", url: `/internal-consumptions?itemId=${item.id}` })
    ).json();

    expect(lista.total).toBe(1);
    const linha = lista.consumptions[0];
    expect(linha.itemCode).toBe(item.code);
    expect(linha.quantity).toBe("4");
    expect(linha.purpose).toBe("Limpeza");
    expect(linha.registeredByName).toBe("Usuário de Teste ADMIN");
    expect(linha.occurredAt).toBeTruthy();
    expect(linha.costSource).toBe("NO_COST");

    await app.close();
  });

  it("a disponibilidade da tela é a mesma que a gravação confere", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "18");

    const saldo = (
      await app.inject({ method: "GET", url: `/internal-consumptions/availability/${item.id}` })
    ).json();

    expect(saldo.itemCode).toBe(item.code);
    expect(saldo.onHand).toBe("18");
    expect(saldo.available).toBe("18");
    expect(saldo.controlsLot).toBe(false);
    expect(saldo.lots).toEqual([]);

    await app.close();
  });

  it("a movimentação mostra o CI- na origem da baixa", async () => {
    const app = admin();
    await app.ready();
    const item = await criarItem("INTERNAL_CONSUMABLE");
    await entradaSemCusto(item.id, "9");
    const consumo = (await consumir(app, { itemId: item.id, quantity: "2" })).json();

    const extrato = (
      await app.inject({
        method: "GET",
        url: `/inventory-movements?itemId=${item.id}&type=INTERNAL_CONSUMPTION`,
      })
    ).json();

    expect(extrato.total).toBe(1);
    expect(extrato.movements[0].internalConsumptionId).toBe(consumo.id);
    expect(extrato.movements[0].internalConsumptionCode).toBe(consumo.code);

    await app.close();
  });
});
