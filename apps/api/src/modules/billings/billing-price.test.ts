import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

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
    expect(linha.agreedUnitPrice).toBe("9.48");
    expect(linha.unitPrice).toBe("9.48");
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

    expect(faturamento.lines[0].unitPrice).toBe("12.50");
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
   * O preço acordado guarda 4 casas; a tela mostra 2. Somar pelo valor
   * EXIBIDO dava outro total — a linha dizia R$ 1.677,27 e o rodapé do
   * rascunho R$ 1.677,00. Estes casos prendem o servidor como fonte: quem
   * exibe pode arredondar, quem calcula não.
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
    expect(faturamento.lines[0].agreedUnitPrice).toBe("9.48");

    // Uma renegociação futura — ou uma PREC nova a R$ 99 refletida no
    // Pedido — não atravessa para um faturamento já criado.
    await getPrisma().customerOrderLine.update({
      where: { id: lineId },
      data: { agreedUnitPrice: "99" },
    });

    const relido = (await app.inject({ method: "GET", url: `/billings/${faturamento.id}` })).json();
    expect(relido.lines[0].agreedUnitPrice).toBe("9.48");
    expect(relido.lines[0].unitPrice).toBe("9.48");

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
    expect(resposta.json().lines[0].unitPrice).toBe("7.50");

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
    expect(linha.agreedUnitPrice).toBe("9.48");
    expect(linha.unitPrice).toBe("9.20");
    expect(linha.priceOverridden).toBe(true);
    expect(linha.overrideReason).toBe("Desconto comercial autorizado nesta remessa");
    expect(linha.overriddenBy).toBeTruthy();
    expect(linha.overriddenAt).toBeTruthy();
    // O total segue o faturado, não o acordado.
    expect(resposta.json().totalAmount).toBe("92.00");

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
    expect(linha.unitPrice).toBe("9.48");
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
