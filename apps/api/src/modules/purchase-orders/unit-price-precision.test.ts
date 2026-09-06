import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { calcularTotaisOrdemCompra } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * Preço unitário da Ordem de Compra em alta precisão — PREC-MIG-P / PREC-P-01.
 *
 * Insumo cotado por grama, por miligrama ou por dose tem preço unitário
 * legitimamente longo: `4,05318764`. Enquanto a coluna guardava quatro casas,
 * o operador digitava esse número e o banco gravava `4,0532` sem dizer nada —
 * e o DTO servia quatro casas de volta, então abrir a OC e salvar sem editar
 * bastava para transformar o valor cortado no valor oficial.
 *
 * O que este arquivo prova, e o que ele deliberadamente NÃO prova:
 *
 * - preço unitário preserva até oito casas, e acima disso a fronteira recusa;
 * - abrir sem editar e salvar preserva a casa oculta;
 * - o TOTAL do documento continua fechando pela regra ATUAL da OC. Precisão do
 *   operando não é precisão do total: `10 × 4,05318764 = 40,53187640` fecha em
 *   `40,53` e isso não autoriza reduzir o preço armazenado. A regra de
 *   fechamento da OC (BACKLOG #18) NÃO muda aqui — é caracterizada, não
 *   corrigida.
 *
 * Caminho REAL, pela API: um `prisma.create` direto provaria que o PostgreSQL
 * guarda oito casas e nada sobre o caminho que o operador percorre.
 *
 * A massa leva o prefixo `PREC-P` e é removida ao final.
 */

/** O preço de 8 casas do acceptance: não pode virar 4,0532 em lugar nenhum. */
const PRECO_8_CASAS = "4.05318764";

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
    data: { code: `FOR-PREC-P-${m}`, legalName: `Fornecedor PREC-P ${m}`, active: true },
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
      code: `MP-PREC-P-${m}`,
      name: `Item PREC-P ${m}`,
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

/** OC DRAFT pela API, com as linhas pedidas. */
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
  return { statusCode: resposta.statusCode, oc, body: resposta };
}

async function linhaDaOrdem(purchaseOrderId: string) {
  return getPrisma().purchaseOrderLine.findFirstOrThrow({
    where: { purchaseOrderId },
    select: { id: true, unitPrice: true, orderedQuantity: true },
  });
}

describe("preço unitário da OC preserva 8 casas", () => {
  it("grava, serializa e relê 4,05318764 sem virar 4,0532", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    ]);

    // API → o DTO devolve o scale da coluna, não menos.
    expect(oc.lines[0].unitPrice).toBe("4.05318764");

    // Banco → o valor íntegro.
    const linha = await linhaDaOrdem(oc.id);
    expect(linha.unitPrice!.equals(new Prisma.Decimal(PRECO_8_CASAS))).toBe(true);
    // A prova de que a coluna antiga perdia: com quatro casas isto era 4,0532.
    expect(linha.unitPrice!.toFixed(4)).toBe("4.0532");

    await app.close();
  });

  it.each([
    ["4 casas", "4.0531"],
    ["6 casas", "4.053187"],
    ["8 casas", PRECO_8_CASAS],
    ["8 casas de valor pequeno", "0.00000001"],
    ["zero explícito", "0"],
  ])("preserva %s — %s", async (_nome, valor) => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "1", unitPrice: valor },
    ]);

    const linha = await linhaDaOrdem(oc.id);
    expect(linha.unitPrice!.equals(new Prisma.Decimal(valor))).toBe(true);

    await app.close();
  });

  it("acima de 8 casas a API recusa — não deixa o banco arredondar em silêncio", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { statusCode, body } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "1", unitPrice: "4.053187641" },
    ]);
    expect(statusCode).toBe(400);
    expect(JSON.stringify(body.json())).toContain("8 casas decimais");

    // Recusa não é gravação parcial: a OC não foi criada.
    const criadas = await getPrisma().purchaseOrder.count({
      where: { supplierId: fornecedor.id },
    });
    expect(criadas).toBe(0);

    await app.close();
  });

  it("acima de 8 casas a edição da OC também recusa, e não grava nada", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "1", unitPrice: PRECO_8_CASAS },
    ]);

    const recusa = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${oc.id}`,
      payload: {
        lines: [{ itemId: item.id, orderedQuantity: "1", unitPrice: "4.053187641" }],
      },
    });
    expect(recusa.statusCode).toBe(400);
    expect(JSON.stringify(recusa.json())).toContain("8 casas decimais");

    const linha = await linhaDaOrdem(oc.id);
    expect(linha.unitPrice!.equals(new Prisma.Decimal(PRECO_8_CASAS))).toBe(true);

    await app.close();
  });

  it("abrir, não alterar e salvar preserva o valor — casa oculta sobrevive", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    ]);

    // O que a tela recebe é exatamente o que ela devolve ao salvar sem editar.
    const doDto = oc.lines[0].unitPrice as string;
    const regravada = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${oc.id}`,
      payload: {
        lines: [{ itemId: item.id, orderedQuantity: "10", unitPrice: doDto }],
      },
    });
    expect(regravada.statusCode).toBe(200);

    const linha = await linhaDaOrdem(oc.id);
    expect(linha.unitPrice!.equals(new Prisma.Decimal(PRECO_8_CASAS))).toBe(true);

    await app.close();
  });

  it("round-trip completo: banco → Prisma → API → web → API → banco", async () => {
    const app = buildTestApp();
    await app.ready();

    for (const valor of ["4.05", "4.0531", "4.053187", PRECO_8_CASAS, "0.00000001"]) {
      const fornecedor = await criarFornecedor();
      const item = await criarItem();

      const { oc } = await criarOrdem(app, fornecedor.id, [
        { itemId: item.id, orderedQuantity: "1", unitPrice: valor },
      ]);
      // A ida: o DTO carrega o valor íntegro, como string.
      const servido = oc.lines[0].unitPrice as string;
      expect(typeof servido).toBe("string");
      expect(new Prisma.Decimal(servido).equals(new Prisma.Decimal(valor))).toBe(true);

      // A volta: o mesmo texto do DTO, sem reinterpretação da tela.
      await app.inject({
        method: "PATCH",
        url: `/purchase-orders/${oc.id}`,
        payload: { lines: [{ itemId: item.id, orderedQuantity: "1", unitPrice: servido }] },
      });

      const linha = await linhaDaOrdem(oc.id);
      expect(
        linha.unitPrice!.equals(new Prisma.Decimal(valor)),
        `${valor} não sobreviveu ao round-trip`,
      ).toBe(true);

      // E a releitura serve de novo o mesmo valor matemático.
      const relida = (
        await app.inject({ method: "GET", url: `/purchase-orders/${oc.id}` })
      ).json();
      expect(
        new Prisma.Decimal(relida.lines[0].unitPrice).equals(new Prisma.Decimal(valor)),
      ).toBe(true);
    }

    await app.close();
  });

  it("o preço viaja como string no JSON — nunca como number", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    ]);

    const cru = (await app.inject({ method: "GET", url: `/purchase-orders/${oc.id}` })).body;
    // Um JSON number carregaria o valor sem aspas e ficaria à mercê do
    // `double` de quem lê. O contrato é texto.
    expect(cru).toContain('"unitPrice":"4.05318764"');
    expect(cru).not.toContain('"unitPrice":4.05318764');

    await app.close();
  });
});

describe("preço preciso e total documental são independentes", () => {
  /**
   * A caracterização do acceptance: quantidade 10, preço `4,05318764`.
   *
   * O bruto é `40,53187640`; o documento fecha em `40,53`. O fechamento NÃO
   * volta a ser operando — o preço armazenado continua com as oito casas.
   */
  it("quantity=10 × 4,05318764 fecha em 40,53 e o preço continua 4,05318764", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    ]);

    // O bruto, em precisão cheia, antes de qualquer arredondamento.
    expect(new Prisma.Decimal("10").times(PRECO_8_CASAS).toFixed(8)).toBe("40.53187640");

    // O documento, pela REGRA ATUAL da OC — nada aqui muda o #18.
    expect(oc.lines[0].lineTotal).toBe("40.53");
    expect(oc.orderTotal).toBe("40.53");

    // E o operando continua íntegro depois do cálculo do total.
    expect(oc.lines[0].unitPrice).toBe("4.05318764");
    const linha = await linhaDaOrdem(oc.id);
    expect(linha.unitPrice!.equals(new Prisma.Decimal(PRECO_8_CASAS))).toBe(true);

    await app.close();
  });

  /**
   * Caracterização de MÚLTIPLAS linhas — a regra atual da OC, sem correção.
   *
   * `calcularTotaisOrdemCompra` soma as linhas em precisão CHEIA e arredonda
   * só no fim; os `lineTotal` exibidos já vêm arredondados. Com preços de
   * oito casas os dois caminhos divergem em centavos, e é exatamente a
   * divergência registrada em BACKLOG #18 — apresentação, não gravação.
   *
   * O teste NÃO exige o comportamento futuro do #18: ele congela o atual,
   * para que implementá-lo depois seja uma mudança visível e deliberada.
   */
  it("três linhas: o rodapé soma em precisão cheia, as linhas já vêm arredondadas", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const itemA = await criarItem();
    const itemB = await criarItem();
    const itemC = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: itemA.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
      { itemId: itemB.id, orderedQuantity: "1", unitPrice: "0.12500000" },
      { itemId: itemC.id, orderedQuantity: "5", unitPrice: "0.02500000" },
    ]);

    // A ordem das linhas não é contratada; o conjunto é.
    const totaisDeLinha = oc.lines
      .map((l: { lineTotal: string | null }) => l.lineTotal)
      .sort();
    expect(totaisDeLinha).toEqual(["0.13", "0.13", "40.53"]);

    // Σ das linhas JÁ ARREDONDADAS daria 40,79 — a regra de #15, dos
    // documentos comerciais. A OC usa a outra: soma cheia, arredonda no fim.
    const somaDasLinhasArredondadas = new Prisma.Decimal("40.53")
      .plus("0.13")
      .plus("0.13")
      .toFixed(2);
    expect(somaDasLinhasArredondadas).toBe("40.79");

    const somaCheia = new Prisma.Decimal("10")
      .times(PRECO_8_CASAS)
      .plus(new Prisma.Decimal("1").times("0.125"))
      .plus(new Prisma.Decimal("5").times("0.025"));
    expect(somaCheia.toFixed(8)).toBe("40.78187640");

    // O rodapé da OC segue a soma cheia e fecha um centavo abaixo da soma das
    // linhas impressas. Divergência REGISTRADA — é o BACKLOG #18, e esta
    // capability não o implementa.
    expect(oc.orderTotal).toBe("40.78");
    expect(oc.orderTotal).not.toBe(somaDasLinhasArredondadas);

    // E nenhum dos preços foi tocado pelo fechamento do documento.
    const linhas = await getPrisma().purchaseOrderLine.findMany({
      where: { purchaseOrderId: oc.id },
      select: { unitPrice: true },
    });
    const gravados = linhas.map((l) => l.unitPrice!.toFixed(8)).sort();
    expect(gravados).toEqual(["0.02500000", "0.12500000", "4.05318764"]);

    await app.close();
  });

  it("a função canônica da OC não mudou — mesma conta, com 8 casas no operando", () => {
    // A prova de que o widening não redefiniu `calcularTotaisOrdemCompra`:
    // a regra continua "soma cheia, arredonda no fim", agora com um operando
    // que antes não cabia na coluna.
    const totais = calcularTotaisOrdemCompra([
      { orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
      { orderedQuantity: "1", unitPrice: "0.12500000" },
      { orderedQuantity: "5", unitPrice: "0.02500000" },
    ]);
    expect(totais.lineTotals).toEqual(["40.53", "0.13", "0.13"]);
    expect(totais.orderTotal).toBe("40.78");
  });
});

describe("widening não recalcula histórico nem muda semântica de custo", () => {
  it("preço de 4 casas continua matematicamente igual depois da coluna alargar", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    // Uma OC "antiga": preço com as quatro casas que a coluna guardava.
    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "10", unitPrice: "4.0531" },
    ]);

    const linha = await linhaDaOrdem(oc.id);
    // Continua `4,0531`; só a representação ganhou zeros à direita.
    expect(linha.unitPrice!.equals(new Prisma.Decimal("4.0531"))).toBe(true);
    expect(linha.unitPrice!.toFixed(8)).toBe("4.05310000");
    // E o total do documento é o mesmo de antes do widening.
    expect(oc.orderTotal).toBe("40.53");

    await app.close();
  });

  it("o preço da OC continua sendo referência no Recebimento, servido em 8 casas", async () => {
    const app = buildTestApp();
    await app.ready();
    const fornecedor = await criarFornecedor();
    const item = await criarItem();

    const { oc } = await criarOrdem(app, fornecedor.id, [
      { itemId: item.id, orderedQuantity: "10", unitPrice: PRECO_8_CASAS },
    ]);
    await app.inject({ method: "POST", url: `/purchase-orders/${oc.id}/confirm` });

    // Recebimento SEM custo informado: o preço da OC não vira custo sozinho.
    const recebimento = (
      await app.inject({
        method: "POST",
        url: `/purchase-orders/${oc.id}/receipts`,
        payload: {
          receivedAt: new Date().toISOString(),
          lines: [
            {
              purchaseOrderLineId: oc.lines[0].id,
              receivedQuantity: "10",
              supplierLot: `SUP-${marca()}`,
            },
          ],
        },
      })
    ).json();
    recebimentos.push(recebimento.id);

    // A referência chega íntegra — é ela que o atalho "Usar preço da OC"
    // copia para `actualUnitCost`, que é DECIMAL(20,8).
    expect(recebimento.lines[0].purchaseUnitPrice).toBe("4.05318764");
    // E o custo efetivo continua desconhecido: preço não é custo.
    expect(recebimento.lines[0].actualUnitCost).toBeNull();

    await app.close();
  });
});
