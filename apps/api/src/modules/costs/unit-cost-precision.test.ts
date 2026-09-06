import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { getItemCostReference } from "../../lib/cost-reference.js";
import "../../lib/decimal.js";

/**
 * Custo unitário de alta precisão, do banco até o motor — PREC-MIG-B.
 *
 * `ReceiptLine.actualUnitCost` é a origem de TODO custo real do sistema: a
 * média ponderada 30d/90d, o último custo real e o custo do lote consumido
 * saem dele. Enquanto a coluna guardava quatro casas, um custo por grama de
 * insumo caro chegava ao CMV já grosseiro, e nenhum teste de aritmética
 * perceberia — o motor sempre esteve certo, a gravação é que cortava.
 *
 * Por isso o caminho aqui é o REAL: Ordem de Compra, confirmação e
 * recebimento pela API, como em `costs.test.ts`. Um `prisma.create` direto
 * provaria que o PostgreSQL guarda oito casas e nada sobre o caminho que o
 * operador percorre.
 *
 * A massa leva o prefixo `PREC-B` e é removida ao final.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** O custo de 8 casas do acceptance: não pode virar 4,0532 em lugar nenhum. */
const CUSTO_8_CASAS = "4.05318764";

type App = ReturnType<typeof buildTestApp>;

const itens: string[] = [];
const fornecedores: string[] = [];
const ordens: string[] = [];
const recebimentos: string[] = [];

let contador = 0;
const marca = () => `${Date.now().toString(36)}${(contador += 1)}`;

beforeAll(async () => {
  const prisma = getPrisma();
  const unidades: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] =
    [
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    ];
  for (const u of unidades) {
    await prisma.unitOfMeasure.upsert({ where: { code: u.code }, update: {}, create: u });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (recebimentos.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: recebimentos } } });
    await prisma.receipt.deleteMany({ where: { id: { in: recebimentos } } });
  }
  if (ordens.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: ordens } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ordens } } });
  }
  if (itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.itemCostReference.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
});

async function criarFornecedor() {
  const prisma = getPrisma();
  const m = marca();
  const f = await prisma.supplier.create({
    data: { code: `FOR-PREC-B-${m}`, legalName: `Fornecedor PREC-B ${m}`, active: true },
  });
  fornecedores.push(f.id);
  return f;
}

async function criarItem() {
  const prisma = getPrisma();
  const m = marca();
  const i = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-PREC-B-${m}`,
      name: `Item PREC-B ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itens.push(i.id);
  return i;
}

/** Recebimento real: OC, confirmação e recebimento com custo efetivo. */
async function receberComCusto(
  app: App,
  params: {
    supplierId: string;
    itemId: string;
    quantity: string;
    unitCost: string;
    recebidoEm?: Date;
  },
) {
  const oc = (
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
  ordens.push(oc.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${oc.id}/confirm` });

  const recebimento = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${oc.id}/receipts`,
      payload: {
        receivedAt: (params.recebidoEm ?? new Date()).toISOString(),
        lines: [
          {
            purchaseOrderLineId: oc.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marca()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  recebimentos.push(recebimento.id);
  return recebimento;
}

async function linhaDoRecebimento(receiptId: string) {
  return getPrisma().receiptLine.findFirstOrThrow({
    where: { receiptId },
    select: { id: true, actualUnitCost: true },
  });
}

describe("custo efetivo de aquisição preserva 8 casas", () => {
  it("grava, serializa e relê 4,05318764 sem virar 4,0532", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const recebimento = await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "10",
      unitCost: CUSTO_8_CASAS,
    });

    // API → o DTO devolve o scale da coluna, não menos.
    expect(recebimento.lines[0].actualUnitCost).toBe("4.05318764");

    // Banco → o valor íntegro.
    const linha = await linhaDoRecebimento(recebimento.id);
    expect(linha.actualUnitCost!.equals(new Prisma.Decimal(CUSTO_8_CASAS))).toBe(true);
    // A prova de que a coluna antiga perdia: com quatro casas isto era 4,0532.
    expect(linha.actualUnitCost!.toFixed(4)).toBe("4.0532");

    await app.close();
  });

  it.each([
    ["4 casas", "4.0531"],
    ["6 casas", "4.053187"],
    ["8 casas", CUSTO_8_CASAS],
    ["8 casas de valor pequeno", "0.00381726"],
  ])("preserva %s — %s", async (_nome, valor) => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const recebimento = await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: valor,
    });

    const linha = await linhaDoRecebimento(recebimento.id);
    expect(linha.actualUnitCost!.equals(new Prisma.Decimal(valor))).toBe(true);

    await app.close();
  });

  it("abrir, não alterar e salvar preserva o valor — casa oculta sobrevive", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const recebimento = await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: CUSTO_8_CASAS,
    });
    const linha = await linhaDoRecebimento(recebimento.id);

    // O que a tela recebe é o que ela devolve ao salvar sem editar.
    const doDto = recebimento.lines[0].actualUnitCost as string;
    const regravado = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${linha.id}/acquisition-cost`,
      payload: { unitCost: doDto },
    });
    expect(regravado.statusCode).toBe(200);

    const depois = await getPrisma().receiptLine.findUniqueOrThrow({
      where: { id: linha.id },
      select: { actualUnitCost: true },
    });
    expect(depois.actualUnitCost!.equals(new Prisma.Decimal(CUSTO_8_CASAS))).toBe(true);

    await app.close();
  });

  it("acima de 8 casas a API recusa — não deixa o banco arredondar em silêncio", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const recebimento = await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: "1",
    });
    const linha = await linhaDoRecebimento(recebimento.id);

    const recusa = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${linha.id}/acquisition-cost`,
      payload: { unitCost: "4.053187641" },
    });
    expect(recusa.statusCode).toBe(400);
    expect(JSON.stringify(recusa.json())).toContain("8 casas decimais");

    // Recusa não é gravação parcial: o valor anterior continua intacto.
    const depois = await getPrisma().receiptLine.findUniqueOrThrow({
      where: { id: linha.id },
      select: { actualUnitCost: true },
    });
    expect(depois.actualUnitCost!.equals(new Prisma.Decimal("1"))).toBe(true);

    await app.close();
  });

  it("limpar o custo devolve desconhecido, nunca zero", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const recebimento = await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: CUSTO_8_CASAS,
    });
    const linha = await linhaDoRecebimento(recebimento.id);

    await app.inject({
      method: "PUT",
      url: `/receipt-lines/${linha.id}/acquisition-cost`,
      payload: { unitCost: "" },
    });
    const depois = await getPrisma().receiptLine.findUniqueOrThrow({
      where: { id: linha.id },
      select: { actualUnitCost: true },
    });
    expect(depois.actualUnitCost).toBeNull();

    await app.close();
  });
});

describe("seletor canônico de custo preserva a precisão da fonte", () => {
  it("compra única na janela de 30 dias chega ao seletor com 8 casas", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: CUSTO_8_CASAS,
      recebidoEm: new Date(Date.now() - 5 * DIA_MS),
    });

    const r = await getItemCostReference(getPrisma(), item.id);
    expect(r.source).toBe("ESTIMATED_30D");
    expect(r.unitCost!.equals(new Prisma.Decimal(CUSTO_8_CASAS))).toBe(true);

    // E o DTO da API entrega as mesmas 8 casas.
    const dto = (
      await app.inject({ method: "GET", url: `/items/${item.id}/cost-reference` })
    ).json();
    expect(dto.unitCost).toBe("4.05318764");

    await app.close();
  });

  it("média ponderada 30d soma sem corte intermediário", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: CUSTO_8_CASAS,
      recebidoEm: new Date(Date.now() - 5 * DIA_MS),
    });
    await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "3.5",
      unitCost: "9.87654321",
      recebidoEm: new Date(Date.now() - 10 * DIA_MS),
    });

    // 1 × 4,05318764 + 3,5 × 9,87654321 = 38,62109887 ; ÷ 4,5 é dízima.
    const esperado = new Prisma.Decimal("1")
      .times(CUSTO_8_CASAS)
      .plus(new Prisma.Decimal("3.5").times("9.87654321"))
      .dividedBy(new Prisma.Decimal("4.5"));

    const r = await getItemCostReference(getPrisma(), item.id);
    expect(r.source).toBe("ESTIMATED_30D");
    expect(r.unitCost!.equals(esperado)).toBe(true);
    // O motor canônico de 40 dígitos carrega a dízima inteira; o corte só
    // acontece na saída. Com 4 casas na coluna, o OPERANDO já seria outro.
    expect(r.unitCost!.toString().replace(/[^0-9]/g, "").length).toBeGreaterThan(20);
    expect(r.unitCost!.toFixed(8)).toBe("8.58246419");

    await app.close();
  });

  it("média ponderada 90d preserva igual — mesmo motor, outra janela", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "2",
      unitCost: "1.23456789",
      recebidoEm: new Date(Date.now() - 45 * DIA_MS),
    });
    await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: CUSTO_8_CASAS,
      recebidoEm: new Date(Date.now() - 60 * DIA_MS),
    });

    const esperado = new Prisma.Decimal("2")
      .times("1.23456789")
      .plus(new Prisma.Decimal("1").times(CUSTO_8_CASAS))
      .dividedBy(new Prisma.Decimal("3"));

    const r = await getItemCostReference(getPrisma(), item.id);
    expect(r.source).toBe("ESTIMATED_90D");
    expect(r.unitCost!.equals(esperado)).toBe(true);

    await app.close();
  });

  it("último custo real entrega as 8 casas exatas da compra", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    await receberComCusto(app, {
      supplierId: fornecedor.id,
      itemId: item.id,
      quantity: "1",
      unitCost: CUSTO_8_CASAS,
      recebidoEm: new Date(Date.now() - 200 * DIA_MS),
    });

    const r = await getItemCostReference(getPrisma(), item.id);
    expect(r.source).toBe("LAST_REAL_COST");
    expect(r.unitCost!.equals(new Prisma.Decimal(CUSTO_8_CASAS))).toBe(true);

    await app.close();
  });

  it("sem custo conhecido devolve null — desconhecido nunca é zero", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();

    const r = await getItemCostReference(getPrisma(), item.id);
    expect(r.source).toBe("NO_COST");
    expect(r.unitCost).toBeNull();

    await app.close();
  });
});

describe("referência manual de custo preserva 8 casas", () => {
  it("grava e relê 0,00381726 sem cortar", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();

    const criada = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "0.00381726", uomCode: "kg" },
    });
    expect(criada.statusCode).toBe(201);

    const linha = await getPrisma().itemCostReference.findFirstOrThrow({
      where: { itemId: item.id },
      select: { unitCost: true },
    });
    expect(linha.unitCost.equals(new Prisma.Decimal("0.00381726"))).toBe(true);

    await app.close();
  });

  it("acima de 8 casas a referência manual é recusada na fronteira", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await criarItem();

    const recusa = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost: "0.003817261", uomCode: "kg" },
    });
    expect(recusa.statusCode).toBe(400);
    expect(JSON.stringify(recusa.json())).toContain("8 casas decimais");

    await app.close();
  });
});
