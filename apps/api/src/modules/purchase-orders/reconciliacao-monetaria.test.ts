import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { calcularTotaisOrdemCompra } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * Reconciliação monetária da Ordem de Compra — BACKLOG #18,
 * `PRODUCT_RULES.md` §61.
 *
 * O rodapé da OC somava as linhas em precisão CHEIA e arredondava no fim,
 * enquanto a página imprimia cada linha já fechada em dois centavos. Com preço
 * de oito casas as duas contas divergem: a coluna somava `40,79` e o rodapé
 * dizia `40,78`. Quem confere o papel estava certo, e um rodapé que não bate
 * com a soma da página destrói a confiança no documento inteiro.
 *
 * O que este arquivo prova, pelo caminho REAL da API:
 *
 * - o rodapé é a soma das linhas impressas, em todas as superfícies que
 *   mostram o total da OC — documento, relatório de compras e a OC vinculada
 *   dentro do Pedido do Cliente;
 * - o OPERANDO não foi tocado: o preço continua com as oito casas e a
 *   quantidade com a precisão que a coluna guarda;
 * - o total documental NÃO alimenta custo técnico — sem recebimento o item
 *   continua sem custo, e o preço da OC nunca vira `actualUnitCost`.
 *
 * A massa leva o prefixo `OC18` e é removida ao final.
 */

/** O preço de oito casas do acceptance. */
const PRECO_8_CASAS = "4.05318764";

type App = ReturnType<typeof buildTestApp>;

const itens: string[] = [];
const fornecedores: string[] = [];
const ordens: string[] = [];
const clientes: string[] = [];
const produtos: string[] = [];
const pedidos: string[] = [];

let contador = 0;
const marca = () => `${Date.now().toString(36)}${(contador += 1)}`.toUpperCase();

beforeAll(async () => {
  const prisma = getPrisma();
  const unidades: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] =
    [
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    ];
  for (const u of unidades) {
    await prisma.unitOfMeasure.upsert({ where: { code: u.code }, update: {}, create: u });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // A OC sai ANTES do Pedido: quando há vínculo, é ela quem aponta para ele.
  if (ordens.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: ordens } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ordens } } });
  }
  if (pedidos.length > 0) {
    await prisma.customerOrderLine.deleteMany({ where: { customerOrderId: { in: pedidos } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidos } } });
  }
  if (produtos.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: produtos } } });
  }
  if (itens.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
  if (clientes.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: clientes } } });
  }
});

async function criarFornecedor() {
  const prisma = getPrisma();
  const m = marca();
  const f = await prisma.supplier.create({
    data: { code: `FOR-OC18-${m}`, legalName: `Fornecedor OC18 ${m}`, active: true },
  });
  fornecedores.push(f.id);
  return f;
}

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT" = "RAW_MATERIAL") {
  const prisma = getPrisma();
  const m = marca();
  const i = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-OC18-${m}`,
      name: `Item OC18 ${m}`,
      unitCode: type === "RAW_MATERIAL" ? "kg" : "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itens.push(i.id);
  return i;
}

async function criarOrdem(
  app: App,
  supplierId: string,
  lines: { itemId: string; orderedQuantity: string; unitPrice?: string }[],
) {
  const resposta = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: { supplierId, orderDate: new Date().toISOString(), lines },
  });
  const oc = resposta.json();
  if (resposta.statusCode === 201) ordens.push(oc.id);
  return oc;
}

/** As três linhas do acceptance, sempre na mesma ordem de valores. */
async function ordemCanonica(app: App) {
  const fornecedor = await criarFornecedor();
  const a = await criarItem();
  const b = await criarItem();
  const c = await criarItem();
  const oc = await criarOrdem(app, fornecedor.id, [
    { itemId: a.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    { itemId: b.id, orderedQuantity: "1", unitPrice: "0.125" },
    { itemId: c.id, orderedQuantity: "5", unitPrice: "0.025" },
  ]);
  return { oc, fornecedor, itens: [a, b, c] };
}

const somaDaColuna = (totais: (string | null)[]) =>
  totais
    .filter((t): t is string => t !== null)
    .reduce((soma, t) => soma.plus(t), new Prisma.Decimal(0))
    .toFixed(2);

describe("o rodapé da OC fecha com as linhas impressas", () => {
  it("o acceptance: 40,53 + 0,13 + 0,13 = 40,79 no documento da API", async () => {
    const app = buildTestApp();
    await app.ready();

    const { oc } = await ordemCanonica(app);

    const totaisDeLinha = oc.lines.map((l: { lineTotal: string | null }) => l.lineTotal).sort();
    expect(totaisDeLinha).toEqual(["0.13", "0.13", "40.53"]);
    expect(oc.orderTotal).toBe("40.79");
    expect(oc.orderTotal).toBe(somaDaColuna(totaisDeLinha));

    // A conta antiga fecharia 40,78 — a diferença que o #18 corrige.
    expect(oc.orderTotal).not.toBe("40.78");

    await app.close();
  });

  it("o operando não é tocado pelo fechamento do documento", async () => {
    const app = buildTestApp();
    await app.ready();

    const { oc } = await ordemCanonica(app);

    // O DTO devolve o scale da coluna: oito casas, PREC-MIG-P.
    const servidos = oc.lines.map((l: { unitPrice: string }) => l.unitPrice).sort();
    expect(servidos).toEqual(["0.02500000", "0.12500000", "4.05318764"]);

    const gravados = await getPrisma().purchaseOrderLine.findMany({
      where: { purchaseOrderId: oc.id },
      select: { unitPrice: true, orderedQuantity: true },
    });
    expect(gravados.map((l) => l.unitPrice!.toFixed(8)).sort()).toEqual([
      "0.02500000",
      "0.12500000",
      "4.05318764",
    ]);
    // E a quantidade continua com a precisão da coluna.
    expect(gravados.map((l) => l.orderedQuantity.toString()).sort()).toEqual(["1", "10", "5"]);

    await app.close();
  });

  it("quantidade de alta precisão entra inteira na multiplicação", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    // 0,000000048 kg × R$ 1.000.000 = R$ 0,048 → R$ 0,05. Reduzir a
    // quantidade antes da conta zeraria a linha.
    const oc = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "0.000000048", unitPrice: "1000000" },
    ]);
    expect(oc.lines[0].lineTotal).toBe("0.05");
    expect(oc.orderTotal).toBe("0.05");

    await app.close();
  });

  it("linha sem preço não vira zero, e o rodapé soma o que tem preço", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const comPreco = await criarItem();
    const semPreco = await criarItem();

    const oc = await criarOrdem(app, fornecedor.id, [
      { itemId: comPreco.id, orderedQuantity: "1", unitPrice: "0.125" },
      { itemId: semPreco.id, orderedQuantity: "3" },
    ]);
    const totais = oc.lines.map((l: { lineTotal: string | null }) => l.lineTotal);
    expect(totais.filter((t: string | null) => t === null)).toHaveLength(1);
    expect(oc.orderTotal).toBe("0.13");

    await app.close();
  });

  it("INVARIANTE: em toda OC lida pela API, rodapé = Σ linhas", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();

    const conjuntos: { orderedQuantity: string; unitPrice?: string }[][] = [
      [{ orderedQuantity: "10", unitPrice: "12.5" }],
      [
        { orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
        { orderedQuantity: "1", unitPrice: "0.125" },
        { orderedQuantity: "5", unitPrice: "0.025" },
      ],
      [
        { orderedQuantity: "1", unitPrice: "0.114" },
        { orderedQuantity: "1", unitPrice: "0.115" },
        { orderedQuantity: "1", unitPrice: "0.116" },
        { orderedQuantity: "3", unitPrice: "0.3333" },
        { orderedQuantity: "2", unitPrice: "0" },
        { orderedQuantity: "4" },
      ],
      Array.from({ length: 12 }, (_, i) => ({
        orderedQuantity: String(i + 1),
        unitPrice: "0.00500001",
      })),
    ];

    for (const conjunto of conjuntos) {
      const lines = [];
      for (const linha of conjunto) {
        const item = await criarItem();
        lines.push({ itemId: item.id, ...linha });
      }
      const oc = await criarOrdem(app, fornecedor.id, lines);
      const totais = oc.lines.map((l: { lineTotal: string | null }) => l.lineTotal);
      expect(oc.orderTotal, `OC ${oc.code} não fecha com as linhas`).toBe(somaDaColuna(totais));
    }

    await app.close();
  });
});

describe("toda superfície que mostra o total da OC usa a mesma conta", () => {
  it("o relatório de Compras mostra 40,79 como valor previsto", async () => {
    const app = buildTestApp();
    await app.ready();

    const { oc } = await ordemCanonica(app);
    const relatorio = (
      await app.inject({
        method: "GET",
        url: `/reports/purchasing/orders?search=${oc.code}&page=1&pageSize=5`,
      })
    ).json();

    const linha = relatorio.rows.find((r: { code: string }) => r.code === oc.code);
    expect(linha).toBeTruthy();
    expect(linha.expectedAmount).toBe("40.79");

    await app.close();
  });

  it("o relatório continua sem valor previsto quando alguma linha não tem preço", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const comPreco = await criarItem();
    const semPreco = await criarItem();

    const oc = await criarOrdem(app, fornecedor.id, [
      { itemId: comPreco.id, orderedQuantity: "1", unitPrice: "0.125" },
      { itemId: semPreco.id, orderedQuantity: "3" },
    ]);
    const relatorio = (
      await app.inject({
        method: "GET",
        url: `/reports/purchasing/orders?search=${oc.code}&page=1&pageSize=5`,
      })
    ).json();

    const linha = relatorio.rows.find((r: { code: string }) => r.code === oc.code);
    // A regra de AUSÊNCIA do relatório não mudou: valor previsto parcial seria
    // menor que o previsto, com cara de total. O documento, esse, soma o que
    // tem preço — as duas leituras respondem perguntas diferentes.
    expect(linha.expectedAmount).toBeNull();
    expect(oc.orderTotal).toBe("0.13");

    await app.close();
  });

  it("a OC vinculada dentro do Pedido do Cliente mostra o mesmo 40,79", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const { oc } = await ordemCanonica(app);

    const m = marca();
    const cliente = await prisma.customer.create({
      data: { code: `CLI-OC18-${m}`, legalName: `Cliente OC18 ${m}`, active: true },
    });
    clientes.push(cliente.id);
    const acabado = await criarItem("FINISHED_PRODUCT");
    const produto = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: {
          customerId: cliente.id,
          name: `Produto OC18 ${m}`,
          finishedProductItemId: acabado.id,
        },
      })
    ).json();
    produtos.push(produto.id);

    const pedido = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: {
          customerId: cliente.id,
          lines: [{ productId: produto.id, orderedQuantity: "10" }],
        },
      })
    ).json();
    pedidos.push(pedido.id);

    // O vínculo que a Sugestão de Compra cria — aqui gravado direto, porque o
    // que se testa é o DTO da OC vinculada, não como o vínculo nasce.
    await prisma.purchaseOrder.update({
      where: { id: oc.id },
      data: { customerOrderId: pedido.id, origin: "CUSTOMER_ORDER" },
    });

    const relido = (
      await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}` })
    ).json();
    const vinculada = relido.linkedPurchaseOrders.find(
      (p: { code: string }) => p.code === oc.code,
    );
    expect(vinculada).toBeTruthy();
    expect(vinculada.orderTotal).toBe("40.79");

    await app.close();
  });
});

describe("total documental não é custo técnico", () => {
  it("o preço da OC não vira custo do item: sem recebimento, o item segue sem custo", async () => {
    const app = buildTestApp();
    await app.ready();

    const { itens: itensDaOc } = await ordemCanonica(app);
    const referencia = (
      await app.inject({ method: "GET", url: `/items/${itensDaOc[0]!.id}/cost-reference` })
    ).json();

    /*
     * O custo de aquisição vem de `ReceiptLine.actualUnitCost`, informado por
     * pessoa no Recebimento. O seletor canônico recusa explicitamente o preço
     * da OC como fallback: sem custo real o resultado é ausência, nunca o
     * preço da compra — e muito menos o total documental arredondado.
     */
    expect(referencia.unitCost).toBeNull();
    expect(referencia.source).toBe("NO_COST");

    await app.close();
  });

  it("a conta canônica não arredonda o operando — só a linha", () => {
    // `10 × 4,05318764` fecha `40,53` no documento, e o preço continua
    // `4,05318764`. Fechar antes da multiplicação daria `40,50` (preço em 2
    // casas) ou `40,53` por outro caminho — o teste crava qual é.
    const totais = calcularTotaisOrdemCompra([
      { orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    ]);
    expect(totais.lineTotals).toEqual(["40.53"]);
    expect(new Prisma.Decimal("10").times("4.05").toFixed(2)).toBe("40.50");
    expect(totais.orderTotal).not.toBe("40.50");
  });
});
