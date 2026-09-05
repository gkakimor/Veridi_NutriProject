import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";
import { calcularTotaisFaturamento } from "@veridi/shared";

/**
 * O preço do faturamento vem do Pedido.
 *
 * No VAL-LEG-01 a cadeia comercial inteira existia e estava correta —
 * PREC-000001 · faixa 100 un → ORC-000003 aceito → PED-000001 com
 * R$ 9,48 congelado — e o último passo pedia o número de novo, num campo
 * vazio. Redigitar um valor que o sistema já conhece não é conveniência
 * ruim: é a única forma de o faturado divergir do acordado sem ninguém
 * perceber.
 *
 * Aqui se prova o par: `agreedUnitPrice` é o que o cliente aceitou,
 * `unitPrice` é o que se faturou, e eles só se separam por um ato
 * explícito, com permissão e motivo.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.productionOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrderReservationLine.deleteMany({
      where: {
        reservation: { customerOrderId: { in: fixtureCustomerOrderIds } },
        replacesLineId: { not: null },
      },
    });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarCliente() {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-PRE-${m}`, legalName: `Cliente Preço ${m}` },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function criarItemAcabadoComEstoque(quantidade: string) {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-PRE-${m}`,
      name: `PA Preço ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(item.id);

  const lot = await prisma.lot.create({
    data: {
      code: `LT-PRE-${m}`.toUpperCase(),
      itemId: item.id,
      origin: "PRODUCTION",
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
      createdBy: "Teste",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity: quantidade,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });
  return item;
}

/**
 * Pedido em atendimento com preço acordado.
 *
 * O acordo normalmente chega pelo aceite de um orçamento; aqui ele é
 * gravado direto na linha da própria fixture, que é exatamente o estado
 * que o aceite produz. O que este arquivo testa é o que o Faturamento faz
 * com esse acordo, não como ele nasce.
 */
async function pedidoComPrecoAcordado(
  app: App,
  { quantidade, preco }: { quantidade: string; preco: string | null },
) {
  const item = await criarItemAcabadoComEstoque(quantidade);
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto Preço ${marca()}`, finishedProductItemId: item.id },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const customer = await criarCliente();
  const criado = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: customer.id, lines: [{ productId: product.id, orderedQuantity: quantidade }] },
    })
  ).json();
  fixtureCustomerOrderIds.push(criado.id);

  const confirmado = (
    await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })
  ).json();
  const lineId = confirmado.lines[0].id as string;

  if (preco !== null) {
    await getPrisma().customerOrderLine.update({
      where: { id: lineId },
      data: { agreedUnitPrice: preco, agreedPriceSource: "PRICING_TIER" },
    });
  }

  await app.inject({
    method: "POST",
    url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
    payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: quantidade, produceQuantity: "0" }] },
  });

  return { orderId: criado.id as string, lineId, product, item };
}

async function expedir(app: App, orderId: string, quantidade?: string) {
  const rascunho = (
    await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })
  ).json();
  if (quantidade) {
    await app.inject({
      method: "PATCH",
      url: `/shipments/${rascunho.id}`,
      payload: {
        lines: [
          {
            customerOrderReservationLineId: rascunho.lines[0].customerOrderReservationLineId,
            quantity: quantidade,
          },
        ],
      },
    });
  }
  const atual = (await app.inject({ method: "GET", url: `/shipments/${rascunho.id}` })).json();
  for (const linha of atual.lines) {
    if (!linha.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${rascunho.id}/lines/${linha.id}/verify`,
      payload: { lotCode: linha.lotCode },
    });
  }
  return (await app.inject({ method: "POST", url: `/shipments/${rascunho.id}/confirm` })).json();
}

describe("Faturamento herda o preço acordado", () => {
  it("o caso da auditoria: 100 × R$ 9,48, expede 98, fatura 98 × 9,48 = R$ 929,04", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "100", preco: "9.48" });
    const expedicao = await expedir(app, orderId, "98");

    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const linha = faturamento.lines[0];
    // Nenhuma digitação: o preço já está lá, e é o do Pedido.
    expect(linha.agreedUnitPrice).toBe("9.4800");
    expect(linha.unitPrice).toBe("9.4800");
    expect(linha.priceOverridden).toBe(false);
    expect(linha.quantity).toBe("98");
    expect(linha.lineTotal).toBe("929.04");
    expect(faturamento.totalAmount).toBe("929.04");
    expect(faturamento.hasCompletePricing).toBe(true);

    await app.close();
  });

  it("faturamento parcial mantém o preço unitário — quem muda é a quantidade", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "10", preco: "12.5" });
    const expedicao = await expedir(app, orderId, "4");
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    expect(faturamento.lines[0].unitPrice).toBe("12.5000");
    expect(faturamento.lines[0].quantity).toBe("4");
    expect(faturamento.totalAmount).toBe("50.00");

    await app.close();
  });

  it("pedido sem preço acordado continua faturando por quantidade", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "5", preco: null });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    // Sem acordo não se inventa preço: o documento quantitativo vale.
    expect(faturamento.lines[0].agreedUnitPrice).toBeNull();
    expect(faturamento.lines[0].unitPrice).toBeNull();
    expect(faturamento.hasCompletePricing).toBe(false);
    expect(faturamento.totalQuantity).toBe("5");

    await app.close();
  });
});

describe("Precisão do preço acordado", () => {
  /*
   * O preço acordado guarda 4 casas. Somar pelo valor EXIBIDO dava outro
   * total — a linha dizia R$ 1.677,27 e o rodapé do rascunho R$ 1.677,00.
   * Estes casos prendem o servidor como fonte do cálculo.
   *
   * O que estava escrito aqui antes — "quem exibe pode arredondar, quem
   * calcula não" — é metade da regra, e a metade que falta custou um HIGH.
   * A rodada adversarial mostrou o outro lado: com o preço exibido em 2
   * casas ao lado de um total calculado com 4, o operador confere
   * `R$ 4,05 × 123` e chega a R$ 498,15 num documento que diz R$ 498,53. O
   * cálculo estava certo o tempo todo; o documento é que não se sustentava.
   * Quem exibe NÃO pode arredondar preço unitário — ver o bloco seguinte.
   */
  it("os dois casos das auditorias: 9,7203 × 147 e 5,5909 × 300", async () => {
    const app = buildTestApp();
    await app.ready();

    const primeiro = await pedidoComPrecoAcordado(app, { quantidade: "147", preco: "9.7203" });
    const expedicaoA = await expedir(app, primeiro.orderId);
    const faturaA = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicaoA.id } })
    ).json();
    expect(faturaA.lines[0].lineTotal).toBe("1428.88");
    expect(faturaA.totalAmount).toBe("1428.88");

    const segundo = await pedidoComPrecoAcordado(app, { quantidade: "300", preco: "5.5909" });
    const expedicaoB = await expedir(app, segundo.orderId);
    const faturaB = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicaoB.id } })
    ).json();
    expect(faturaB.lines[0].lineTotal).toBe("1677.27");
    expect(faturaB.totalAmount).toBe("1677.27");

    await app.close();
  });

  it("total do documento é a soma das linhas, não quantidade × preço exibido", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "300", preco: "5.5909" });
    const expedicao = await expedir(app, orderId);
    const fatura = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const somaDasLinhas = fatura.lines.reduce(
      (soma: number, linha: { lineTotal: string }) => soma + Number(linha.lineTotal),
      0,
    );
    expect(Number(fatura.totalAmount)).toBeCloseTo(somaDasLinhas, 2);
    // O arredondamento de exibição daria 1.677,00 — 27 centavos a menos.
    expect(Number(fatura.totalAmount)).not.toBe(300 * 5.59);

    await app.close();
  });

  /*
   * O documento tem de fechar na mão de quem confere.
   *
   * Caso da rodada adversarial: `PED-000491`, 123 un a R$ 4,0531. A API
   * devolvia `unitPrice: "4.05"` e `lineTotal: "498.53"`. Nenhuma conta
   * possível com os números impressos chegava a 498,53 — 4,05 × 123 dá
   * 498,15, e os R$ 0,38 de diferença não tinham origem no papel.
   *
   * Arredondar o preço no banco resolveria a aparência e falsificaria o
   * acordo: o pedido foi fechado a 4,0531. A saída é entregar o preço com a
   * precisão que ele tem.
   */
  it("o caso adversarial: 4,0531 × 123 sai com o preço inteiro, e o total fecha", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "123", preco: "4.0531" });
    const expedicao = await expedir(app, orderId);
    const fatura = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const linha = fatura.lines[0];
    expect(linha.agreedUnitPrice).toBe("4.0531");
    expect(linha.unitPrice).toBe("4.0531");
    expect(linha.lineTotal).toBe("498.53");
    expect(fatura.totalAmount).toBe("498.53");

    // A conta que o operador faz com o que está impresso tem de bater com o
    // total do documento. Era exatamente isto que falhava.
    expect(Number(linha.unitPrice) * Number(linha.quantity)).toBeCloseTo(Number(linha.lineTotal), 2);

    await app.close();
  });

  it("preço redondo não ganha zeros: 4,05 continua 4,05 na conta", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "123", preco: "4.05" });
    const expedicao = await expedir(app, orderId);
    const fatura = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const linha = fatura.lines[0];
    expect(Number(linha.unitPrice)).toBe(4.05);
    expect(linha.lineTotal).toBe("498.15");
    expect(Number(linha.unitPrice) * Number(linha.quantity)).toBeCloseTo(Number(linha.lineTotal), 2);

    await app.close();
  });

  /*
   * Invariante, não caso: para toda linha faturada, o total exibido é o
   * produto do preço exibido pela quantidade exibida, arredondado a 2 casas.
   * Enquanto o preço saía cortado, esta afirmação era falsa e ninguém a
   * tinha escrito.
   */
  it("invariante: lineTotal é sempre round(unitPrice × quantity, 2) com o preço que a API entrega", async () => {
    const app = buildTestApp();
    await app.ready();

    for (const [quantidade, preco] of [
      ["123", "4.0531"],
      ["147", "9.7203"],
      ["300", "5.5909"],
      ["100", "4.05"],
    ] as const) {
      const { orderId } = await pedidoComPrecoAcordado(app, { quantidade, preco });
      const expedicao = await expedir(app, orderId);
      const fatura = (
        await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
      ).json();

      for (const linha of fatura.lines) {
        const esperado = (Number(linha.unitPrice) * Number(linha.quantity)).toFixed(2);
        expect(`${linha.lineTotal} (${quantidade} × ${preco})`).toBe(`${esperado} (${quantidade} × ${preco})`);
      }
    }

    await app.close();
  });

  /*
   * Drift de somatório entre linhas — a hipótese que a rodada adversarial
   * NÃO conseguiu exercitar pela interface.
   *
   * Um faturamento tem uma linha por linha de expedição, que vem de uma
   * linha de reserva, e um orçamento aceita cada produto uma única vez; com
   * um lote livre no substrato não havia caminho de tela para montar duas
   * linhas no mesmo documento. Não ter caminho pela tela não é prova de que
   * o modelo está certo, então fica provado aqui.
   *
   * O risco real é `Σ round(linha)` ≠ `round(Σ linha)`: o total do documento
   * soma os produtos não arredondados e arredonda uma vez no fim, enquanto
   * cada linha impressa já vem arredondada. Com preços de quatro casas em
   * várias linhas, a diferença pode chegar a um centavo por linha.
   */
  it("com duas linhas de preço quebrado, o total do documento fecha com as linhas", async () => {
    const app = buildTestApp();
    await app.ready();

    const primeiro = await criarItemAcabadoComEstoque("123");
    const segundo = await criarItemAcabadoComEstoque("147");
    const customer = await criarCliente();

    const produtos = [];
    for (const [item, sufixo] of [
      [primeiro, "A"],
      [segundo, "B"],
    ] as const) {
      const product = (
        await app.inject({
          method: "POST",
          url: "/products",
          payload: {
            customerId: customer.id,
            name: `Produto Multi ${sufixo} ${marca()}`,
            finishedProductItemId: item.id,
          },
        })
      ).json();
      fixtureProductIds.push(product.id);
      produtos.push(product);
    }

    const criado = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: {
          customerId: customer.id,
          lines: [
            { productId: produtos[0].id, orderedQuantity: "123" },
            { productId: produtos[1].id, orderedQuantity: "147" },
          ],
        },
      })
    ).json();
    fixtureCustomerOrderIds.push(criado.id);

    const confirmado = (
      await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })
    ).json();

    // Dois preços de quatro casas diferentes: é a combinação que produz
    // fração de centavo em ambas as linhas ao mesmo tempo.
    const precos = ["4.0531", "9.7203"] as const;
    for (const [indice, linha] of confirmado.lines.entries()) {
      await getPrisma().customerOrderLine.update({
        where: { id: linha.id },
        data: {
          agreedUnitPrice: precos[indice % precos.length]!,
          agreedPriceSource: "PRICING_TIER",
        },
      });
    }

    await app.inject({
      method: "POST",
      url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
      payload: {
        lines: confirmado.lines.map((linha: { id: string; orderedQuantity: string }) => ({
          customerOrderLineId: linha.id,
          reserveQuantity: linha.orderedQuantity,
          produceQuantity: "0",
        })),
      },
    });

    const expedicao = await expedir(app, criado.id);
    const fatura = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    expect(fatura.lines.length).toBe(2);

    const somaDasLinhasImpressas = fatura.lines
      .reduce((soma: number, linha: { lineTotal: string }) => soma + Number(linha.lineTotal), 0)
      .toFixed(2);

    // Se divergirem, o documento impresso não fecha com o próprio rodapé —
    // que é a forma multilinha do mesmo defeito já corrigido na linha.
    expect(fatura.totalAmount).toBe(somaDasLinhasImpressas);

    await app.close();
  });

  it("emitir não recalcula: o total emitido é o mesmo do rascunho", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "300", preco: "5.5909" });
    const expedicao = await expedir(app, orderId);
    const rascunho = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    const emitido = (
      await app.inject({ method: "POST", url: `/billings/${rascunho.id}/issue` })
    ).json();

    expect(emitido.totalAmount).toBe(rascunho.totalAmount);
    expect(emitido.lines[0].lineTotal).toBe(rascunho.lines[0].lineTotal);

    await app.close();
  });
});

describe("O acordo não é reescrito pelo presente", () => {
  it("preço acordado é snapshot — mudar o Pedido depois não muda o faturamento", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId, lineId } = await pedidoComPrecoAcordado(app, { quantidade: "10", preco: "9.48" });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    expect(faturamento.lines[0].agreedUnitPrice).toBe("9.4800");

    // Uma renegociação futura — ou uma PREC nova a R$ 99 refletida no
    // Pedido — não atravessa para um faturamento já criado.
    await getPrisma().customerOrderLine.update({
      where: { id: lineId },
      data: { agreedUnitPrice: "99" },
    });

    const relido = (await app.inject({ method: "GET", url: `/billings/${faturamento.id}` })).json();
    expect(relido.lines[0].agreedUnitPrice).toBe("9.4800");
    expect(relido.lines[0].unitPrice).toBe("9.4800");

    await app.close();
  });

  it("o preço acordado não se redigita pelo formulário", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "10", preco: "9.48" });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const resposta = await app.inject({
      method: "PATCH",
      url: `/billings/${faturamento.id}`,
      payload: { lines: [{ billingLineId: faturamento.lines[0].id, unitPrice: "1" }] },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("agreed_price_not_editable");

    await app.close();
  });

  it("linha sem acordo continua editável pelo formulário", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "5", preco: null });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const resposta = await app.inject({
      method: "PATCH",
      url: `/billings/${faturamento.id}`,
      payload: { lines: [{ billingLineId: faturamento.lines[0].id, unitPrice: "7.5" }] },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().lines[0].unitPrice).toBe("7.5000");

    await app.close();
  });
});

describe("Alterar o preço de faturamento", () => {
  async function cenarioComOverride(app: App) {
    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "10", preco: "9.48" });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    return { faturamento, lineId: faturamento.lines[0].id as string };
  }

  it("guarda os dois preços — o acordado não é substituído", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const { faturamento, lineId } = await cenarioComOverride(app);

    const resposta = await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${lineId}/price-override`,
      payload: { unitPrice: "9.20", reason: "Desconto comercial autorizado nesta remessa" },
    });
    expect(resposta.statusCode).toBe(200);

    const linha = resposta.json().lines[0];
    expect(linha.agreedUnitPrice).toBe("9.4800");
    expect(linha.unitPrice).toBe("9.2000");
    expect(linha.priceOverridden).toBe(true);
    expect(linha.overrideReason).toBe("Desconto comercial autorizado nesta remessa");
    expect(linha.overriddenBy).toBeTruthy();
    expect(linha.overriddenAt).toBeTruthy();
    // O total segue o faturado, não o acordado.
    expect(resposta.json().totalAmount).toBe("92.00");

    await app.close();
  });

  it("o que a tela previu é o que a API grava (#8D)", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "100", preco: "12.50" });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    const linha = faturamento.lines[0];

    // A prévia da tela: MESMA função, com o preço que está sendo digitado.
    const previa = calcularTotaisFaturamento([
      { quantity: linha.quantity, unitPrice: "13.25" },
    ]);
    expect(previa.lineTotals[0]).toBe("1325.00");
    expect(previa.totalAmount).toBe("1325.00");

    // Antes de confirmar, o documento gravado continua valendo o acordado.
    expect(faturamento.totalAmount).toBe("1250.00");

    const depois = (
      await app.inject({
        method: "POST",
        url: `/billings/${faturamento.id}/lines/${linha.id}/price-override`,
        payload: { unitPrice: "13.25", reason: "Reajuste acordado nesta remessa" },
      })
    ).json();

    expect(depois.lines[0].lineTotal).toBe(previa.lineTotals[0]);
    expect(depois.totalAmount).toBe(previa.totalAmount);
    // E o acordado do Pedido não foi tocado pela prévia nem pela confirmação.
    expect(depois.lines[0].agreedUnitPrice).toBe("12.5000");

    await app.close();
  });

  it("sem motivo, não altera", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const { faturamento, lineId } = await cenarioComOverride(app);

    const resposta = await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${lineId}/price-override`,
      payload: { unitPrice: "9.20", reason: "  " },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");

    await app.close();
  });

  it("voltar ao preço acordado desfaz a marca de divergência", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { faturamento, lineId } = await cenarioComOverride(app);

    await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${lineId}/price-override`,
      payload: { unitPrice: "9.20", reason: "Desconto" },
    });
    const voltou = await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${lineId}/price-override`,
      payload: { unitPrice: "9.48", reason: "Desconto cancelado" },
    });

    const linha = voltou.json().lines[0];
    expect(linha.unitPrice).toBe("9.4800");
    // Faturar exatamente o acordado não é divergir dele.
    expect(linha.priceOverridden).toBe(false);
    expect(linha.overrideReason).toBeNull();

    await app.close();
  });

  it("linha sem acordo não tem o que sobrepor", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { orderId } = await pedidoComPrecoAcordado(app, { quantidade: "5", preco: null });
    const expedicao = await expedir(app, orderId);
    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    const resposta = await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${faturamento.lines[0].id}/price-override`,
      payload: { unitPrice: "3", reason: "Tentativa" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("no_agreed_price_to_override");

    await app.close();
  });

  it("faturamento emitido é histórico — nem override o altera", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { faturamento, lineId } = await cenarioComOverride(app);

    await app.inject({ method: "POST", url: `/billings/${faturamento.id}/issue` });

    const resposta = await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${lineId}/price-override`,
      payload: { unitPrice: "1", reason: "Tarde demais" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("billing_not_draft");

    await app.close();
  });
});

describe("Quem pode alterar o preço faturado", () => {
  it.each(["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"] as const)(
    "%s não altera preço de faturamento",
    async (role) => {
      const app = buildTestApp(role);
      await app.ready();

      // O cenário precisa de um pedido pronto; quem o monta é ADMIN,
      // porque o teste é sobre o override, não sobre criar o pedido.
      const admin = buildTestApp("ADMIN");
      await admin.ready();
      const { orderId } = await pedidoComPrecoAcordado(admin, { quantidade: "10", preco: "9.48" });
      const expedicao = await expedir(admin, orderId);
      const faturamento = (
        await admin.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
      ).json();
      await admin.close();

      const resposta = await app.inject({
        method: "POST",
        url: `/billings/${faturamento.id}/lines/${faturamento.lines[0].id}/price-override`,
        payload: { unitPrice: "1", reason: "Sem permissão" },
      });
      expect(resposta.statusCode).toBe(403);

      await app.close();
    },
  );
});
