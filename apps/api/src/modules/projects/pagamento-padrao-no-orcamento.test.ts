import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { PARCELADO_SEM_PARCELAS_MESSAGE } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * O pagamento padrão do Cliente chega ao Orçamento como CÓPIA, nunca como
 * autoridade viva — CUSTOMER-PAYMENT-DEFAULTS-01.
 *
 * 1. **V1 copia.** A primeira proposta real do projeto (sem anterior MANUAL — a
 *    V1, ou a primeira depois de só haver legado) grava forma e condição do
 *    cliente na própria versão. Cliente sem padrão: a versão nasce como nascia.
 * 2. **Depois disso, a versão é dela.** Mudar o cliente, trocar o cliente do
 *    projeto, criar a V2, recomprar ou duplicar nunca relê o padrão; a V2 e a
 *    recompra partem da anterior, a duplicação parte da origem.
 * 3. **Parcelado exige parcelas** no Orçamento também: salvar, simular e
 *    enviar recusam.
 * 4. **O Pedido congela a forma** da proposta aceita.
 */

const fixtureCustomerIds: string[] = [];
const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const VALIDADE_FUTURA = "2099-12-31";

beforeAll(async () => {
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await getPrisma().unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    const pedidos = await prisma.customerOrder.findMany({
      where: { sourceProjectId: { in: fixtureProjectIds } },
      select: { id: true },
    });
    const pedidoIds = pedidos.map((pedido) => pedido.id);
    if (pedidoIds.length > 0) {
      await prisma.customerOrderLine.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: pedidoIds } } });
    }
    await prisma.quoteLine.deleteMany({
      where: { quoteVersion: { projectId: { in: fixtureProjectIds } } },
    });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectProduct.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    const produtos = await prisma.product.findMany({
      where: { id: { in: fixtureProductIds } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
    const itens = produtos
      .map((produto) => produto.finishedProductItemId)
      .filter((id): id is string => id !== null);
    if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

const PARCELADO_BOLETO = {
  defaultPaymentInstrument: "BOLETO",
  defaultPaymentMethod: "INSTALLMENTS",
  defaultDownPaymentPercent: "30",
  defaultInstallmentCount: 3,
  defaultInstallmentIntervalDays: 45,
  defaultMonthlyInterestPercent: "1.5",
};

/** A V1 que o PARCELADO_BOLETO produz. */
const CONDICAO_BOLETO = {
  paymentInstrument: "BOLETO",
  paymentMethod: "INSTALLMENTS",
  downPaymentPercent: "30.0000",
  installmentCount: 3,
  installmentIntervalDays: 45,
  monthlyInterestPercent: "1.5000",
};

const A_VISTA_SEM_FORMA = {
  paymentInstrument: null,
  paymentMethod: "CASH",
  downPaymentPercent: null,
  installmentCount: null,
  installmentIntervalDays: null,
  monthlyInterestPercent: null,
};

async function cliente(app: App, padrao: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Padrão ${marca()}`, ...padrao },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const id = resposta.json().id as string;
  fixtureCustomerIds.push(id);
  return id;
}

async function mudarPadrao(app: App, customerId: string, padrao: Record<string, unknown>) {
  const resposta = await app.inject({ method: "PATCH", url: `/customers/${customerId}`, payload: padrao });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

async function projeto(app: App, customerId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: `Projeto Pagamento ${marca()}`, customerId, entryDate: new Date().toISOString() },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const id = resposta.json().id as string;
  fixtureProjectIds.push(id);
  return id;
}

async function novaVersao(app: App, projectId: string) {
  const resposta = await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` });
  expect([200, 201], resposta.body).toContain(resposta.statusCode);
  return resposta.json();
}

async function lerVersao(app: App, id: string) {
  const resposta = await app.inject({ method: "GET", url: `/quote-versions/${id}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

function condicaoDe(versao: Record<string, unknown>) {
  return {
    paymentInstrument: versao.paymentInstrument,
    paymentMethod: versao.paymentMethod,
    downPaymentPercent: versao.downPaymentPercent,
    installmentCount: versao.installmentCount,
    installmentIntervalDays: versao.installmentIntervalDays,
    monthlyInterestPercent: versao.monthlyInterestPercent,
  };
}

async function patchVersao(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/quote-versions/${id}`, payload });
}

/** Fecha a versão sem passar pelo fluxo de envio — o que importa aqui é a cópia. */
async function marcarStatus(id: string, status: "SENT" | "ACCEPTED") {
  await getPrisma().quoteVersion.update({ where: { id }, data: { status } });
}

describe("V1 — a primeira proposta copia o padrão do cliente", () => {
  const app = buildTestApp("COMMERCIAL");

  it("forma e condição parcelada inteira são gravadas na própria V1", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const v1 = await novaVersao(app, await projeto(app, customerId));

    expect(v1.versionNumber).toBe(1);
    expect(condicaoDe(v1)).toEqual(CONDICAO_BOLETO);
    // Gravado na versão, não só desenhado na resposta.
    const gravada = await getPrisma().quoteVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(gravada.paymentInstrument).toBe("BOLETO");
    expect(gravada.paymentMethod).toBe("INSTALLMENTS");
    expect(gravada.installmentCount).toBe(3);
  });

  it("cliente sem padrão: a V1 nasce como sempre nasceu — à vista, sem forma", async () => {
    const customerId = await cliente(app);
    const v1 = await novaVersao(app, await projeto(app, customerId));
    expect(condicaoDe(v1)).toEqual(A_VISTA_SEM_FORMA);
  });

  it("cliente só com forma: a V1 recebe a forma e continua à vista", async () => {
    const customerId = await cliente(app, { defaultPaymentInstrument: "PIX" });
    const v1 = await novaVersao(app, await projeto(app, customerId));
    expect(condicaoDe(v1)).toEqual({ ...A_VISTA_SEM_FORMA, paymentInstrument: "PIX" });
  });

  it("cliente só com condição: a V1 recebe a condição e fica sem forma", async () => {
    const customerId = await cliente(app, { ...PARCELADO_BOLETO, defaultPaymentInstrument: null });
    const v1 = await novaVersao(app, await projeto(app, customerId));
    expect(condicaoDe(v1)).toEqual({ ...CONDICAO_BOLETO, paymentInstrument: null });
  });

  it("projeto só com versão legada: a primeira proposta real recebe o padrão, e o legado não muda", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const projectId = await projeto(app, customerId);
    const legado = await getPrisma().quoteVersion.create({
      data: {
        code: `ORC-LEG-${marca()}`,
        projectId,
        versionNumber: 1,
        status: "ARCHIVED",
        source: "LEGACY_IMPORT",
        quoteDate: new Date("2024-03-01T00:00:00.000Z"),
      },
    });

    const real = await novaVersao(app, projectId);

    expect(real.versionNumber).toBe(2);
    expect(condicaoDe(real)).toEqual(CONDICAO_BOLETO);
    const legadoDepois = await getPrisma().quoteVersion.findUniqueOrThrow({ where: { id: legado.id } });
    expect(legadoDepois.status).toBe("ARCHIVED");
    expect(legadoDepois.paymentInstrument).toBeNull();
    expect(legadoDepois.paymentMethod).toBe("CASH");
    expect(legadoDepois.installmentCount).toBeNull();
    expect(legadoDepois.updatedAt.getTime()).toBe(legado.updatedAt.getTime());
  });

  it("rascunho aberto é devolvido como está — pedir versão nova não reaplica o padrão", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const projectId = await projeto(app, customerId);
    const v1 = await novaVersao(app, projectId);
    await mudarPadrao(app, customerId, { defaultPaymentInstrument: "PIX", defaultPaymentMethod: "CASH" });

    const deNovo = await novaVersao(app, projectId);

    expect(deNovo.id).toBe(v1.id);
    expect(condicaoDe(deNovo)).toEqual(CONDICAO_BOLETO);
  });
});

describe("V2, recompra e duplicação — partem da versão, nunca do padrão atual", () => {
  const app = buildTestApp("COMMERCIAL");

  it("V2 copia a condição negociada na V1, não o padrão novo do cliente", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const projectId = await projeto(app, customerId);
    const v1 = await novaVersao(app, projectId);
    // Negociado na V1: PIX à vista.
    const negociado = await patchVersao(app, v1.id, { paymentInstrument: "PIX", paymentMethod: "CASH" });
    expect(negociado.statusCode, negociado.body).toBe(200);
    await marcarStatus(v1.id, "SENT");
    await mudarPadrao(app, customerId, {
      defaultPaymentInstrument: "CARD",
      defaultPaymentMethod: "INSTALLMENTS",
      defaultInstallmentCount: 6,
    });

    const v2 = await novaVersao(app, projectId);

    expect(v2.versionNumber).toBe(2);
    expect(condicaoDe(v2)).toEqual({ ...A_VISTA_SEM_FORMA, paymentInstrument: "PIX" });
  });

  it("recompra em projeto aprovado parte da versão anterior", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const projectId = await projeto(app, customerId);
    const v1 = await novaVersao(app, projectId);
    await marcarStatus(v1.id, "ACCEPTED");
    await getPrisma().project.update({ where: { id: projectId }, data: { status: "APPROVED" } });
    await mudarPadrao(app, customerId, { defaultPaymentInstrument: "PIX", defaultPaymentMethod: "CASH" });

    const recompra = await novaVersao(app, projectId);

    expect(recompra.versionNumber).toBe(2);
    expect(condicaoDe(recompra)).toEqual(CONDICAO_BOLETO);
  });

  it("duplicar copia forma e condição da ORIGEM escolhida — nem da mais recente, nem do cliente", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const projectId = await projeto(app, customerId);
    const v1 = await novaVersao(app, projectId);
    const naV1 = await patchVersao(app, v1.id, {
      paymentInstrument: "BANK_TRANSFER",
      paymentMethod: "INSTALLMENTS",
      installmentCount: 2,
      downPaymentPercent: null,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    });
    expect(naV1.statusCode, naV1.body).toBe(200);
    await marcarStatus(v1.id, "SENT");
    const v2 = await novaVersao(app, projectId);
    await patchVersao(app, v2.id, { paymentInstrument: "OTHER", paymentMethod: "CASH" });
    await marcarStatus(v2.id, "SENT");
    await mudarPadrao(app, customerId, { defaultPaymentInstrument: "PIX", defaultPaymentMethod: "CASH" });

    const resposta = await app.inject({
      method: "POST",
      url: `/quote-versions/${v1.id}/duplicate`,
      payload: { priceStrategy: "REVIEW_PRICES" },
    });

    expect(resposta.statusCode, resposta.body).toBe(201);
    const v3 = resposta.json();
    expect(v3.versionNumber).toBe(3);
    expect(condicaoDe(v3)).toEqual({
      ...A_VISTA_SEM_FORMA,
      paymentInstrument: "BANK_TRANSFER",
      paymentMethod: "INSTALLMENTS",
      installmentCount: 2,
    });
  });
});

describe("sem autoridade viva — o cliente muda, a versão não", () => {
  const app = buildTestApp("COMMERCIAL");

  it("cliente sem padrão ganha padrão depois: a V1 continua sem forma e à vista", async () => {
    const customerId = await cliente(app);
    const projectId = await projeto(app, customerId);
    const v1 = await novaVersao(app, projectId);
    await mudarPadrao(app, customerId, PARCELADO_BOLETO);

    const lida = await lerVersao(app, v1.id);

    // Nenhum campo da versão cai para o padrão do cliente.
    expect(condicaoDe(lida)).toEqual(A_VISTA_SEM_FORMA);
    // O padrão atual aparece à parte, só para a ação explícita do rascunho.
    expect(lida.customerPaymentDefaults).toEqual({
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "INSTALLMENTS",
      defaultDownPaymentPercent: "30.0000",
      defaultInstallmentCount: 3,
      defaultInstallmentIntervalDays: 45,
      defaultMonthlyInterestPercent: "1.5000",
    });
    // E também pela leitura do Projeto, que monta as versões pelo outro caminho.
    const doProjeto = (await app.inject({ method: "GET", url: `/projects/${projectId}` })).json();
    const naLista = doProjeto.quoteVersions.find((versao: { id: string }) => versao.id === v1.id);
    expect(condicaoDe(naLista)).toEqual(A_VISTA_SEM_FORMA);
  });

  it("padrão alterado ou limpo depois da V1: a versão enviada não muda, e não oferece padrão", async () => {
    const customerId = await cliente(app, PARCELADO_BOLETO);
    const projectId = await projeto(app, customerId);
    const v1 = await novaVersao(app, projectId);
    await marcarStatus(v1.id, "SENT");
    await mudarPadrao(app, customerId, { defaultPaymentInstrument: null, defaultPaymentMethod: null });

    const lida = await lerVersao(app, v1.id);

    expect(condicaoDe(lida)).toEqual(CONDICAO_BOLETO);
    expect(lida.customerPaymentDefaults).toBeNull();
  });

  it("trocar o cliente do projeto não sobrescreve o rascunho — só passa a oferecer o padrão do novo", async () => {
    const clienteA = await cliente(app, PARCELADO_BOLETO);
    const clienteB = await cliente(app, { defaultPaymentInstrument: "PIX", defaultPaymentMethod: "CASH" });
    const projectId = await projeto(app, clienteA);
    const v1 = await novaVersao(app, projectId);

    const troca = await app.inject({
      method: "PATCH",
      url: `/projects/${projectId}`,
      payload: { customerId: clienteB },
    });
    expect(troca.statusCode, troca.body).toBe(200);

    const lida = await lerVersao(app, v1.id);
    expect(condicaoDe(lida)).toEqual(CONDICAO_BOLETO);
    expect(lida.customerPaymentDefaults).toMatchObject({
      defaultPaymentInstrument: "PIX",
      defaultPaymentMethod: "CASH",
    });
  });
});

describe("forma de pagamento no Orçamento", () => {
  const app = buildTestApp("COMMERCIAL");

  async function rascunho() {
    const customerId = await cliente(app);
    return (await novaVersao(app, await projeto(app, customerId))).id as string;
  }

  it("grava, ausente não mexe, null limpa", async () => {
    const id = await rascunho();

    expect((await patchVersao(app, id, { paymentInstrument: "CARD" })).statusCode).toBe(200);
    expect((await lerVersao(app, id)).paymentInstrument).toBe("CARD");

    expect((await patchVersao(app, id, { leadTimeDays: 20 })).statusCode).toBe(200);
    expect((await lerVersao(app, id)).paymentInstrument).toBe("CARD");

    expect((await patchVersao(app, id, { paymentInstrument: null })).statusCode).toBe(200);
    expect((await lerVersao(app, id)).paymentInstrument).toBeNull();
  });

  it("forma desconhecida é 400 no campo, e a gravada fica", async () => {
    const id = await rascunho();
    await patchVersao(app, id, { paymentInstrument: "PIX" });

    const resposta = await patchVersao(app, id, { paymentInstrument: "CHEQUE" });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json().issues).toEqual([
      { path: "paymentInstrument", message: "Forma de pagamento inválida" },
    ]);
    expect((await lerVersao(app, id)).paymentInstrument).toBe("PIX");
  });

  it("fora de rascunho, a forma não se altera", async () => {
    const id = await rascunho();
    await marcarStatus(id, "SENT");
    const resposta = await patchVersao(app, id, { paymentInstrument: "PIX" });
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect((await lerVersao(app, id)).paymentInstrument).toBeNull();
  });
});

describe("Orçamento — parcelado exige parcelas", () => {
  const app = buildTestApp("COMMERCIAL");
  const RECUSA = {
    error: "validation_error",
    message: PARCELADO_SEM_PARCELAS_MESSAGE,
    issues: [{ path: "installmentCount", message: PARCELADO_SEM_PARCELAS_MESSAGE }],
  };

  async function rascunho() {
    const customerId = await cliente(app);
    return (await novaVersao(app, await projeto(app, customerId))).id as string;
  }

  it("parcelado sem parcelas sobre uma versão à vista: 400, e nada é gravado", async () => {
    const id = await rascunho();
    const resposta = await patchVersao(app, id, { paymentMethod: "INSTALLMENTS", paymentInstrument: "PIX" });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
    expect(condicaoDe(await lerVersao(app, id))).toEqual(A_VISTA_SEM_FORMA);
  });

  it("apagar as parcelas de um parcelado: 400, e as parcelas ficam", async () => {
    const id = await rascunho();
    expect(
      (await patchVersao(app, id, { paymentMethod: "INSTALLMENTS", installmentCount: 4 })).statusCode,
    ).toBe(200);
    const resposta = await patchVersao(app, id, { installmentCount: null });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
    expect((await lerVersao(app, id)).installmentCount).toBe(4);
  });

  it("voltar para à vista sem parcelas é legítimo", async () => {
    const id = await rascunho();
    await patchVersao(app, id, { paymentMethod: "INSTALLMENTS", installmentCount: 4 });
    const resposta = await patchVersao(app, id, { paymentMethod: "CASH", installmentCount: null });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(condicaoDe(await lerVersao(app, id))).toEqual(A_VISTA_SEM_FORMA);
  });

  it("simular parcelado sem parcelas: 400 — a simulação não mostra à vista chamado de parcelado", async () => {
    const id = await rascunho();
    const resposta = await app.inject({
      method: "POST",
      url: `/quote-versions/${id}/payment-preview`,
      payload: { paymentMethod: "INSTALLMENTS" },
    });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
  });

  it("rascunho que já estava parcelado sem parcelas não é enviado", async () => {
    const id = await rascunho();
    await patchVersao(app, id, { validUntil: VALIDADE_FUTURA });
    // Estado anterior à regra: gravado direto, como o legado o deixaria.
    await getPrisma().quoteVersion.update({
      where: { id },
      data: { paymentMethod: "INSTALLMENTS", installmentCount: null },
    });

    const resposta = await app.inject({
      method: "POST",
      url: `/quote-versions/${id}/send`,
      payload: { confirmIncompleteCost: true },
    });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
    expect((await lerVersao(app, id)).status).toBe("DRAFT");
  });
});

describe("Pedido — a forma da proposta aceita, congelada", () => {
  const app = buildTestApp("ADMIN");

  /** Proposta com forma → enviada → aceita → projeto aprovado → Pedido. */
  async function pedidoDaProposta(padrao: Record<string, unknown>) {
    const customerId = await cliente(app, padrao);
    const projectId = await projeto(app, customerId);
    const preparado = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/technical-product`,
      payload: { finishedUnitCode: "un" },
    });
    expect(preparado.statusCode, preparado.body).toBe(201);
    fixtureProductIds.push(preparado.json().productId);
    const produtos = (await app.inject({ method: "GET", url: `/projects/${projectId}/products` })).json()
      .products as { id: string }[];

    const v1 = await novaVersao(app, projectId);
    const comLinha = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${v1.id}/lines`,
        payload: { projectProductId: produtos[0]!.id },
      })
    ).json();
    const linha = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${comLinha.lines[0].id}`,
      payload: { quotedQuantity: "100", uomCode: "un", unitPrice: "10" },
    });
    expect(linha.statusCode, linha.body).toBe(200);
    expect((await patchVersao(app, v1.id, { validUntil: VALIDADE_FUTURA })).statusCode).toBe(200);

    const enviado = await app.inject({
      method: "POST",
      url: `/quote-versions/${v1.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    expect(enviado.statusCode, enviado.body).toBe(200);
    const aceito = await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/accept` });
    expect(aceito.statusCode, aceito.body).toBe(200);
    const aprovado = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/approve`,
      payload: {},
    });
    expect(aprovado.statusCode, aprovado.body).toBe(200);
    const pedido = await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/create-order` });
    expect(pedido.statusCode, pedido.body).toBe(201);
    return { customerId, orderId: pedido.json().id as string };
  }

  it("o Pedido nasce com a forma da proposta, e mudar o cliente depois não a muda", async () => {
    const { customerId, orderId } = await pedidoDaProposta({
      defaultPaymentInstrument: "PIX",
      defaultPaymentMethod: "INSTALLMENTS",
      defaultInstallmentCount: 2,
    });

    const lido = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
    expect(lido.commercialOrigin.paymentInstrument).toBe("PIX");
    expect(lido.commercialOrigin.paymentSchedule.method).toBe("INSTALLMENTS");
    expect(lido.commercialOrigin.paymentSchedule.installments).toHaveLength(2);
    const gravado = await getPrisma().customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(gravado.agreedPaymentInstrument).toBe("PIX");

    await mudarPadrao(app, customerId, { defaultPaymentInstrument: "BOLETO", defaultPaymentMethod: "CASH" });

    const depois = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
    expect(depois.commercialOrigin.paymentInstrument).toBe("PIX");
    expect(depois.commercialOrigin.paymentSchedule).toEqual(lido.commercialOrigin.paymentSchedule);
  });

  it("proposta sem forma: o Pedido fica sem forma — o cliente não é lido na conversão", async () => {
    const { orderId } = await pedidoDaProposta({});
    const lido = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
    expect(lido.commercialOrigin.paymentInstrument).toBeNull();
  });
});
