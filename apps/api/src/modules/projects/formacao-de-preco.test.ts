import type { UomDimension } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Como o preço do orçamento novo é FORMADO — COM-PRICE, §74.
 *
 * Um projeto aprovado volta a comprar, e o preço da proposta nova precisa vir
 * de uma decisão: manter a condição acordada, reajustá-la, aplicar a
 * precificação atual ou digitar. Antes desta capability o sistema fazia a
 * primeira em silêncio — `createQuoteVersion` copiava `unitPrice` da versão
 * anterior com `priceSource = MANUAL`, e nada no banco dizia de onde aquele
 * número tinha saído.
 *
 * O que esses testes protegem não é a cópia: é a PROVENIÊNCIA. Depois deles,
 * "por que R$ 12,50 apareceu aqui?" tem resposta gravada — de qual linha veio,
 * se foi reajustada, em quanto, e por que a exceção foi aceita quando foi.
 *
 * Os dois casos perigosos têm nome: quantidade diferente e condição vencida.
 * Nenhum dos dois é proibido — quem negocia decide —, e nenhum dos dois pode
 * acontecer sem alguém dizer por quê.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

/** Longe o bastante para nenhuma execução futura reprovar por calendário. */
const VALIDADE_FUTURA = "2099-12-31";
/** Já passou em qualquer execução — condição vencida para negociação nova. */
const VALIDADE_VENCIDA = "2020-01-31";

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "0.001" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrder: { sourceProjectId: { in: fixtureProjectIds } } },
    });
    await prisma.customerOrder.deleteMany({ where: { sourceProjectId: { in: fixtureProjectIds } } });
    // A herança é uma FK entre linhas: soltar o vínculo antes de apagar evita
    // que a ordem de remoção dependa de sorte.
    await prisma.quoteLine.updateMany({
      where: { quoteVersion: { projectId: { in: fixtureProjectIds } } },
      data: { inheritedFromQuoteLineId: null },
    });
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

async function criarProjeto(app: App, unidade = "un") {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-PRC-${m}`, legalName: `Cliente Preço ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);

  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto Preço ${m}`,
        customerId: customer.id,
        entryDate: new Date().toISOString(),
      },
    })
  ).json();
  fixtureProjectIds.push(project.id);

  const preparado = (
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/technical-product`,
      payload: { finishedUnitCode: unidade },
    })
  ).json();
  fixtureProductIds.push(preparado.productId);

  return { projectId: project.id as string, productId: preparado.productId as string };
}

async function abrirOrcamento(app: App, projectId: string) {
  const quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();
  if (quote.lines.length > 0) return quote;

  const produtos = (
    await app.inject({ method: "GET", url: `/projects/${projectId}/products` })
  ).json().products as { id: string; status: string }[];
  const alvo = produtos.find((produto) => produto.status !== "OUT_OF_SCOPE") ?? produtos[0]!;
  return (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: alvo.id },
    })
  ).json();
}

async function definirLinha(
  app: App,
  lineId: string,
  campos: { quotedQuantity?: string; uomCode?: string; unitPrice?: string },
) {
  return app.inject({ method: "PATCH", url: `/quote-lines/${lineId}`, payload: campos });
}

async function lerOrcamento(app: App, quoteId: string) {
  return (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
}

async function opcoesDePreco(app: App, lineId: string) {
  const resposta = await app.inject({ method: "GET", url: `/quote-lines/${lineId}/pricing-options` });
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as {
    pricing: { tiers: { id: string; quantity: string }[] } | null;
    agreement: {
      sourceQuoteLineId: string;
      quoteCode: string;
      unitPrice: string;
      quotedQuantity: string | null;
      uomCode: string | null;
      expired: boolean;
      sameQuantity: boolean;
      requiresReason: boolean;
      safeDefault: boolean;
    } | null;
  };
}

/**
 * Um ciclo comercial fechado: proposta enviada, aceita e projeto aprovado.
 *
 * É o estado a partir do qual toda recompra acontece — e a condição acordada
 * que os testes reutilizam nasce daqui.
 */
async function cicloFechado(
  app: App,
  {
    preco = "12.50",
    quantidade = "1000",
    unidade = "un",
    validade = VALIDADE_FUTURA,
  }: { preco?: string; quantidade?: string; unidade?: string; validade?: string } = {},
) {
  /*
   * O aceite recusa proposta vencida (§71), e é assim que tem que ser. Uma
   * condição VENCIDA no mundo real nasce do calendário: a proposta foi aceita
   * dentro do prazo e o prazo passou. O teste reproduz isso escrevendo a
   * validade passada DEPOIS do aceite — é a passagem do tempo, não um atalho
   * para burlar a regra de aceite.
   */
  const venceDepois = validade === VALIDADE_VENCIDA;
  const { projectId, productId } = await criarProjeto(app, unidade);
  const quote = await abrirOrcamento(app, projectId);
  const lineId = quote.lines[0].id as string;

  await definirLinha(app, lineId, { quotedQuantity: quantidade, uomCode: unidade, unitPrice: preco });
  await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quote.id}`,
    payload: { validUntil: venceDepois ? VALIDADE_FUTURA : validade },
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/send`,
        payload: { confirmIncompleteCost: true },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` })).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/projects/${projectId}/approve`,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  /*
   * O Pedido é parte do ciclo, não decoração. Sem ele a proposta aceita ainda
   * é oferta em aberto, e a versão seguinte a SUPERA (COM-CORE) — deixando de
   * ser condição acordada. A recompra que este arquivo testa parte sempre de
   * um Pedido já gerado.
   */
  expect(
    (await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/create-order` }))
      .statusCode,
  ).toBe(201);

  if (venceDepois) {
    await getPrisma().quoteVersion.update({
      where: { id: quote.id },
      data: { validUntil: new Date(`${VALIDADE_VENCIDA}T00:00:00.000Z`) },
    });
  }

  return { projectId, productId, quoteId: quote.id as string, lineId };
}

describe("A · primeira compra não inventa condição anterior", () => {
  it("sem proposta aceita, a linha não oferece 'manter condição' e nasce sem preço", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { projectId } = await criarProjeto(app);
    const quote = await abrirOrcamento(app, projectId);
    const lineId = quote.lines[0].id as string;
    await definirLinha(app, lineId, { quotedQuantity: "1000", uomCode: "un" });

    const opcoes = await opcoesDePreco(app, lineId);
    // Oferecer "manter condição" aqui seria oferecer um acordo que não existe.
    expect(opcoes.agreement).toBeNull();

    const linha = (await lerOrcamento(app, quote.id)).lines[0];
    expect(linha.unitPrice).toBeNull();
    expect(linha.priceOrigin).toBeNull();

    await app.close();
  });
});

describe("B · condição vigente e mesma quantidade é o happy path da recompra", () => {
  it("a versão nova nasce com o preço acordado E com a proveniência", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app);
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const linha = nova.lines[0];

    expect(linha.unitPrice).toBe("12.5000");
    // Antes desta capability o preço vinha igual — e sozinho. É a origem que
    // faz a diferença entre acordo reutilizado e número copiado.
    expect(linha.priceOrigin).toBe("INHERITED_AGREEMENT");
    expect(linha.inheritedFromQuoteLineId).toBe(primeiro.lineId);
    expect(linha.priceOriginReason).toBeNull();
    expect(linha.adjustmentPercent).toBeNull();

    const opcoes = await opcoesDePreco(app, linha.id);
    expect(opcoes.agreement).not.toBeNull();
    expect(opcoes.agreement!.safeDefault).toBe(true);
    expect(opcoes.agreement!.requiresReason).toBe(false);
    expect(opcoes.agreement!.expired).toBe(false);
    expect(opcoes.agreement!.unitPrice).toBe("12.5000");

    await app.close();
  });

  it("a validade da condição vigente vem sugerida no documento novo", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app);
    const nova = await abrirOrcamento(app, primeiro.projectId);

    // Sugestão, não imposição: o campo continua sendo do documento novo.
    expect(nova.validUntil?.slice(0, 10)).toBe(VALIDADE_FUTURA);

    await app.close();
  });
});

describe("C · quantidade equivalente em outra unidade é a MESMA condição (§68)", () => {
  it("1 kg acordado atende uma linha de 1000 g", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { quantidade: "1", unidade: "kg", preco: "40.00" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    await definirLinha(app, lineId, { quotedQuantity: "1000", uomCode: "g" });

    const opcoes = await opcoesDePreco(app, lineId);
    expect(opcoes.agreement).not.toBeNull();
    // Mesma quantidade FÍSICA: a unidade escrita não cria uma condição nova.
    expect(opcoes.agreement!.sameQuantity).toBe(true);
    expect(opcoes.agreement!.requiresReason).toBe(false);

    const aplicado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/inherit-price`,
      payload: { sourceQuoteLineId: opcoes.agreement!.sourceQuoteLineId },
    });
    expect(aplicado.statusCode, aplicado.body).toBe(200);
    expect(aplicado.json().lines[0].unitPrice).toBe("40.0000");

    await app.close();
  });
});

describe("D e E · quantidade diferente não herda em silêncio", () => {
  it("reajustar sobre quantidade diferente não exige motivo — é preço novo", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { quantidade: "10000", preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    await definirLinha(app, lineId, { quotedQuantity: "500", uomCode: "un" });

    const reajustado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      payload: { sourceQuoteLineId: primeiro.lineId, adjustmentPercent: "8" },
    });
    expect(reajustado.statusCode, reajustado.body).toBe(200);
    expect(reajustado.json().lines[0].unitPrice).toBe("13.5000");
    expect(reajustado.json().lines[0].priceOrigin).toBe("ADJUSTED_AGREEMENT");

    await app.close();
  });

  it("a condição continua visível, mas não vem selecionada nem sem motivo", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { quantidade: "10000", preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    await definirLinha(app, lineId, { quotedQuantity: "500", uomCode: "un" });

    const opcoes = await opcoesDePreco(app, lineId);
    expect(opcoes.agreement!.sameQuantity).toBe(false);
    expect(opcoes.agreement!.safeDefault).toBe(false);
    expect(opcoes.agreement!.requiresReason).toBe(true);

    const semMotivo = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/inherit-price`,
      payload: { sourceQuoteLineId: opcoes.agreement!.sourceQuoteLineId },
    });
    expect(semMotivo.statusCode).toBe(409);
    expect(semMotivo.json().error).toBe("agreement_reason_required");
    // A mensagem diz as duas quantidades: quem decide precisa ver o que muda.
    expect(semMotivo.json().message).toContain("10000");
    expect(semMotivo.json().message).toContain("500");

    await app.close();
  });

  it("com motivo, a decisão comercial passa — e o motivo fica gravado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { quantidade: "10000", preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    await definirLinha(app, lineId, { quotedQuantity: "500", uomCode: "un" });
    const opcoes = await opcoesDePreco(app, lineId);

    const aceito = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/inherit-price`,
      payload: {
        sourceQuoteLineId: opcoes.agreement!.sourceQuoteLineId,
        reason: "Cliente estratégico — condição mantida na recompra menor.",
      },
    });
    expect(aceito.statusCode, aceito.body).toBe(200);

    const linha = aceito.json().lines[0];
    expect(linha.unitPrice).toBe("12.5000");
    expect(linha.priceOrigin).toBe("INHERITED_AGREEMENT");
    expect(linha.priceOriginReason).toContain("Cliente estratégico");

    await app.close();
  });
});

describe("F, G e H · condição vencida", () => {
  it("F · vencida não vem selecionada e a versão nova nasce sem preço", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { validade: VALIDADE_VENCIDA });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const linha = nova.lines[0];

    expect(linha.unitPrice).toBeNull();
    expect(linha.priceOrigin).toBeNull();

    const opcoes = await opcoesDePreco(app, linha.id);
    // O acordo continua existindo como histórico — o que venceu foi a sua
    // utilidade como condição para uma negociação NOVA.
    expect(opcoes.agreement).not.toBeNull();
    expect(opcoes.agreement!.expired).toBe(true);
    expect(opcoes.agreement!.safeDefault).toBe(false);
    expect(opcoes.agreement!.requiresReason).toBe(true);

    await app.close();
  });

  it("G · manter exatamente a condição vencida exige motivo, e então é aceita", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { validade: VALIDADE_VENCIDA });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    const opcoes = await opcoesDePreco(app, lineId);

    const semMotivo = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/inherit-price`,
      payload: { sourceQuoteLineId: opcoes.agreement!.sourceQuoteLineId },
    });
    expect(semMotivo.statusCode).toBe(409);
    expect(semMotivo.json().error).toBe("agreement_reason_required");

    const comMotivo = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/inherit-price`,
      payload: {
        sourceQuoteLineId: opcoes.agreement!.sourceQuoteLineId,
        reason: "Cliente já havia aprovado verbalmente antes do vencimento.",
      },
    });
    expect(comMotivo.statusCode, comMotivo.body).toBe(200);
    expect(comMotivo.json().lines[0].unitPrice).toBe("12.5000");
    // A proposta anterior NÃO é reativada: o que existe é um preço novo, num
    // documento novo, apontando para a condição que o originou.
    const anterior = await lerOrcamento(app, primeiro.quoteId);
    expect(anterior.status).toBe("ACCEPTED");

    await app.close();
  });

  it("H · reajustar uma condição vencida é permitido, e SEM motivo: é preço novo", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { validade: VALIDADE_VENCIDA });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    const opcoes = await opcoesDePreco(app, lineId);

    const reajustado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      // Sem `reason` de propósito: manter EXATAMENTE a condição vencida é que
      // exige justificativa. Reajustar cria um preço novo e usa a condição só
      // como base de cálculo — não afirma que o acordo antigo vale hoje.
      payload: { sourceQuoteLineId: opcoes.agreement!.sourceQuoteLineId, adjustmentPercent: "8" },
    });
    expect(reajustado.statusCode, reajustado.body).toBe(200);

    const linha = reajustado.json().lines[0];
    expect(linha.unitPrice).toBe("13.5000");
    expect(linha.priceOrigin).toBe("ADJUSTED_AGREEMENT");
    expect(linha.inheritedFromQuoteLineId).toBe(primeiro.lineId);

    await app.close();
  });
});

describe("I, J e K · reajuste percentual", () => {
  it("I · 8% sobre 12,50 fecha em 13,5000 — quatro casas, HALF_UP, no servidor", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;

    const reajustado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      payload: { sourceQuoteLineId: primeiro.lineId, adjustmentPercent: "8" },
    });
    expect(reajustado.statusCode, reajustado.body).toBe(200);

    const linha = reajustado.json().lines[0];
    expect(linha.unitPrice).toBe("13.5000");
    expect(linha.priceOrigin).toBe("ADJUSTED_AGREEMENT");
    expect(linha.adjustmentPercent).toBe("8.0000");
    // Reajustar apaga o vínculo com precificação: o preço não veio de faixa.
    expect(linha.priceSource).toBe("MANUAL");

    await app.close();
  });

  it("I · o arredondamento é do domínio, não do banco: 7,77% sobre 12,3456", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { preco: "12.3456" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;

    const reajustado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      payload: { sourceQuoteLineId: primeiro.lineId, adjustmentPercent: "7.77" },
    });
    expect(reajustado.statusCode, reajustado.body).toBe(200);
    // 12,3456 × 1,0777 = 13,30485312 → 13,3049 (HALF_UP em quatro casas). O
    // corte é do domínio: a conta corre em alta precisão e o fechamento
    // comercial acontece uma vez, com nome, e não na escala da coluna.
    expect(reajustado.json().lines[0].unitPrice).toBe("13.3049");

    await app.close();
  });

  it("J · percentual negativo é recusado, e a mensagem diz o que usar", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app);
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;

    const recusado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      payload: { sourceQuoteLineId: primeiro.lineId, adjustmentPercent: "-5" },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("adjustment_negative");
    expect(recusado.json().message).toContain("desconto");

    await app.close();
  });

  it("K · zero por cento é aceito e devolve o mesmo preço", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;

    const reajustado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      payload: { sourceQuoteLineId: primeiro.lineId, adjustmentPercent: "0" },
    });
    expect(reajustado.statusCode, reajustado.body).toBe(200);
    expect(reajustado.json().lines[0].unitPrice).toBe("12.5000");
    expect(reajustado.json().lines[0].priceOrigin).toBe("ADJUSTED_AGREEMENT");

    await app.close();
  });
});

describe("L · preço manual registra a decisão como manual", () => {
  it("digitar o preço numa linha herdada troca a origem — a proveniência não mente", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    expect(nova.lines[0].priceOrigin).toBe("INHERITED_AGREEMENT");

    const editada = await definirLinha(app, lineId, { unitPrice: "15.00" });
    expect(editada.statusCode, editada.body).toBe(200);

    const linha = editada.json().lines[0];
    expect(linha.unitPrice).toBe("15.0000");
    // 15,00 não é o acordo: continuar dizendo "herdado de ORC-…" seria falso.
    expect(linha.priceOrigin).toBe("MANUAL");
    expect(linha.inheritedFromQuoteLineId).toBeNull();

    await app.close();
  });

  it("assumir o preço à mão explicitamente também registra MANUAL", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app);
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;

    const manual = await app.inject({ method: "POST", url: `/quote-lines/${lineId}/manual-price` });
    expect(manual.statusCode, manual.body).toBe(200);
    expect(manual.json().lines[0].priceOrigin).toBe("MANUAL");
    expect(manual.json().lines[0].inheritedFromQuoteLineId).toBeNull();

    await app.close();
  });
});

describe("M · mudar a quantidade depois invalida a origem", () => {
  it("o preço herdado cai junto com o vínculo, e a linha volta a pedir decisão", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { quantidade: "1000", preco: "12.50" });
    const nova = await abrirOrcamento(app, primeiro.projectId);
    const lineId = nova.lines[0].id as string;
    expect(nova.lines[0].priceOrigin).toBe("INHERITED_AGREEMENT");

    const alterada = await definirLinha(app, lineId, { quotedQuantity: "500" });
    expect(alterada.statusCode, alterada.body).toBe(200);

    const linha = alterada.json().lines[0];
    expect(linha.quotedQuantity).toBe("500");
    // O acordo era de 1000 un. Mantê-lo aqui faria a proposta afirmar que o
    // cliente acordou este preço para 500 — e o envio recusa linha sem preço,
    // então a decisão volta a ser pedida.
    expect(linha.unitPrice).toBeNull();
    expect(linha.priceOrigin).toBeNull();
    expect(linha.inheritedFromQuoteLineId).toBeNull();

    await app.close();
  });

  it("preço MANUAL não é afetado por mudar a quantidade — aquele número foi digitado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { projectId } = await criarProjeto(app);
    const quote = await abrirOrcamento(app, projectId);
    const lineId = quote.lines[0].id as string;
    await definirLinha(app, lineId, { quotedQuantity: "1000", uomCode: "un", unitPrice: "9.00" });

    const alterada = await definirLinha(app, lineId, { quotedQuantity: "500" });
    expect(alterada.json().lines[0].unitPrice).toBe("9.0000");
    expect(alterada.json().lines[0].priceOrigin).toBe("MANUAL");

    await app.close();
  });
});

describe("N · a condição nunca atravessa produtos", () => {
  it("a linha de outro produto não recebe a condição, e o backend recusa o id", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const prisma = getPrisma();

    const primeiro = await cicloFechado(app, { preco: "12.50" });

    // Segundo produto no MESMO projeto aprovado, dentro do escopo.
    const m = marca();
    const item = await prisma.item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-PRC-${m}`,
        name: `Acabado ${m}`,
        unitCode: "un",
        controlsLot: true,
      },
    });
    const outro = await prisma.product.create({
      data: {
        code: `PRD-PRC-${m}`,
        name: `Produto B ${m}`,
        lifecycle: "APPROVED",
        finishedProductItemId: item.id,
      },
    });
    fixtureProductIds.push(outro.id);
    const vinculo = await prisma.projectProduct.create({
      data: {
        projectId: primeiro.projectId,
        productId: outro.id,
        sequence: 2,
        status: "APPROVED",
      },
    });

    const nova = await abrirOrcamento(app, primeiro.projectId);
    const comSegundo = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${nova.id}/lines`,
        payload: { projectProductId: vinculo.id },
      })
    ).json();
    const linhaB = comSegundo.lines.find(
      (linha: { productId: string }) => linha.productId === outro.id,
    );

    // Produto novo, história nenhuma: nada a manter.
    expect(linhaB.priceOrigin).toBeNull();
    expect(linhaB.unitPrice).toBeNull();
    expect((await opcoesDePreco(app, linhaB.id)).agreement).toBeNull();

    // E o id de outro produto não passa nem quando a tela insiste.
    const recusado = await app.inject({
      method: "POST",
      url: `/quote-lines/${linhaB.id}/inherit-price`,
      payload: { sourceQuoteLineId: primeiro.lineId },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("invalid_agreement_source");
    expect(recusado.json().message).toContain("outro produto");

    await app.close();
  });
});

describe("O · origens diferentes convivem no mesmo orçamento", () => {
  it("uma linha herda e a outra é manual, sem escolha global", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const prisma = getPrisma();

    const primeiro = await cicloFechado(app, { preco: "12.50" });

    const m = marca();
    const item = await prisma.item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-MIX-${m}`,
        name: `Acabado mix ${m}`,
        unitCode: "un",
        controlsLot: true,
      },
    });
    const outro = await prisma.product.create({
      data: {
        code: `PRD-MIX-${m}`,
        name: `Produto mix ${m}`,
        lifecycle: "APPROVED",
        finishedProductItemId: item.id,
      },
    });
    fixtureProductIds.push(outro.id);
    const vinculo = await prisma.projectProduct.create({
      data: {
        projectId: primeiro.projectId,
        productId: outro.id,
        sequence: 2,
        status: "APPROVED",
      },
    });

    const nova = await abrirOrcamento(app, primeiro.projectId);
    const comSegundo = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${nova.id}/lines`,
        payload: { projectProductId: vinculo.id },
      })
    ).json();
    const linhaB = comSegundo.lines.find(
      (linha: { productId: string }) => linha.productId === outro.id,
    );
    await definirLinha(app, linhaB.id, {
      quotedQuantity: "200",
      uomCode: "un",
      unitPrice: "30.00",
    });

    const final = await lerOrcamento(app, nova.id);
    const porProduto = new Map<string, { priceOrigin: string | null; unitPrice: string | null }>(
      final.lines.map((linha: { productId: string; priceOrigin: string | null; unitPrice: string | null }) => [
        linha.productId,
        linha,
      ]),
    );

    expect(porProduto.get(primeiro.productId)?.priceOrigin).toBe("INHERITED_AGREEMENT");
    expect(porProduto.get(primeiro.productId)?.unitPrice).toBe("12.5000");
    expect(porProduto.get(outro.id)?.priceOrigin).toBe("MANUAL");
    expect(porProduto.get(outro.id)?.unitPrice).toBe("30.0000");

    await app.close();
  });
});

/**
 * §37 — a proveniência tem que resistir a um id inventado.
 *
 * O `sourceQuoteLineId` chega do navegador. Um id que passa sem conferência
 * grava no banco uma frase falsa: "este preço veio do acordo ORC-000010",
 * apontando para um documento de outro cliente. Cada recusa abaixo é uma
 * frase que o sistema não vai deixar ninguém escrever.
 */
describe("Proveniência recusa fonte inválida", () => {
  it("fonte de OUTRO projeto (e outro cliente) não serve", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const alheio = await cicloFechado(app, { preco: "99.00" });
    const meu = await cicloFechado(app, { preco: "12.50" });
    const nova = await abrirOrcamento(app, meu.projectId);

    const recusado = await app.inject({
      method: "POST",
      url: `/quote-lines/${nova.lines[0].id}/inherit-price`,
      payload: { sourceQuoteLineId: alheio.lineId },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().message).toContain("outro projeto");

    await app.close();
  });

  it("fonte em rascunho ou apenas enviada não é acordo", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app, { preco: "12.50" });

    // Um rascunho novo, com preço, mas sem aceite: não é condição acordada.
    const rascunho = await abrirOrcamento(app, primeiro.projectId);
    const linhaDoRascunho = rascunho.lines[0].id as string;

    const outroProjeto = await cicloFechado(app);
    const destino = await abrirOrcamento(app, outroProjeto.projectId);

    const recusado = await app.inject({
      method: "POST",
      url: `/quote-lines/${destino.lines[0].id}/inherit-price`,
      payload: { sourceQuoteLineId: linhaDoRascunho },
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("invalid_agreement_source");

    await app.close();
  });

  it("id inexistente é 404, não proveniência vazia", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app);
    const nova = await abrirOrcamento(app, primeiro.projectId);

    const recusado = await app.inject({
      method: "POST",
      url: `/quote-lines/${nova.lines[0].id}/inherit-price`,
      payload: { sourceQuoteLineId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(recusado.statusCode).toBe(404);

    await app.close();
  });

  it("a cadeia aponta para a condição efetivamente reutilizada, não para a origem da origem", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    // V1 acordada; V2 herda de V1 e é aceita; V3 herda de V2.
    const v1 = await cicloFechado(app, { preco: "12.50" });
    const v2 = await abrirOrcamento(app, v1.projectId);
    const linhaV2 = v2.lines[0].id as string;
    expect(v2.lines[0].inheritedFromQuoteLineId).toBe(v1.lineId);

    await app.inject({
      method: "PATCH",
      url: `/quote-versions/${v2.id}`,
      payload: { validUntil: VALIDADE_FUTURA },
    });
    await app.inject({
      method: "POST",
      url: `/quote-versions/${v2.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${v2.id}/accept` });

    const v3 = await abrirOrcamento(app, v1.projectId);
    // A V2 é a condição comercial mais recente — e é ela que fica registrada.
    // Resolver até a V1 apagaria a negociação do meio.
    expect(v3.lines[0].inheritedFromQuoteLineId).toBe(linhaV2);

    await app.close();
  });
});
