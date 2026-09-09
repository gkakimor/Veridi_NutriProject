import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Um projeto aprovado continua vendendo — COM-CORE.
 *
 * A regra antiga dizia que projeto `APPROVED` era histórico e não recebia
 * proposta nova, e o desenho todo saía disso: `createQuoteVersion` recusava,
 * `acceptQuoteVersion` superava TODA aceita anterior, e a tela mandava criar
 * um projeto novo para o mesmo cliente. Isso descrevia um ciclo comercial
 * único por projeto.
 *
 * A regra do PO agora é outra: `APPROVED` significa que o desenvolvimento
 * técnico e comercial inicial foi aprovado, e todo NOVO compromisso de compra
 * é uma proposta nova — dentro do mesmo projeto, com os mesmos produtos
 * aprovados. Recompra não abre projeto.
 *
 * O que muda no invariante: uma proposta aceita que JÁ GEROU PEDIDO nunca é
 * superada, porque ela é a origem daquele Pedido. Aceita que ainda não virou
 * Pedido continua caindo — é oferta em aberto.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

/** Longe o bastante para nenhuma execução futura reprovar por calendário. */
const VALIDADE_FUTURA = "2099-12-31";
const VALIDADE_VENCIDA = "2020-01-31";

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
  if (fixtureProjectIds.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrder: { sourceProjectId: { in: fixtureProjectIds } } },
    });
    await prisma.customerOrder.deleteMany({
      where: { sourceProjectId: { in: fixtureProjectIds } },
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
      .map((p) => p.finishedProductItemId)
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

async function criarProjeto(app: App) {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-COM-${m}`, legalName: `Cliente Ciclo ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);

  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto Ciclo ${m}`,
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
      payload: { finishedUnitCode: "un" },
    })
  ).json();
  fixtureProductIds.push(preparado.productId);

  return { project, customer, productId: preparado.productId as string };
}

/** Rascunho com uma linha precificada — o mínimo para ser um documento. */
async function criarOrcamento(
  app: App,
  projectId: string,
  { preco = "20", quantidade = "100" }: { preco?: string; quantidade?: string } = {},
) {
  const produtos = (await app.inject({ method: "GET", url: `/projects/${projectId}/products` })).json()
    .products as { id: string; status: string }[];

  const quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();

  let atual = quote;
  if (atual.lines.length === 0) {
    const alvo = produtos.find((p) => p.status !== "OUT_OF_SCOPE") ?? produtos[0]!;
    atual = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: alvo.id },
      })
    ).json();
  }

  await app.inject({
    method: "PATCH",
    url: `/quote-lines/${atual.lines[0].id}`,
    payload: { quotedQuantity: quantidade, uomCode: "un", unitPrice: preco },
  });

  return (await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })).json();
}

async function definirValidade(app: App, quoteId: string, validUntil: string | null) {
  return app.inject({
    method: "PATCH",
    url: `/quote-versions/${quoteId}`,
    payload: { validUntil: validUntil ?? "" },
  });
}

async function enviar(app: App, quoteId: string) {
  return app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/send`,
    payload: { confirmIncompleteCost: true },
  });
}

async function aceitar(app: App, quoteId: string) {
  return app.inject({ method: "POST", url: `/quote-versions/${quoteId}/accept` });
}

async function gerarPedido(app: App, quoteId: string) {
  return app.inject({ method: "POST", url: `/quote-versions/${quoteId}/create-order` });
}

async function lerOrcamento(app: App, quoteId: string) {
  return (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
}

/** Primeiro ciclo inteiro, do rascunho ao Pedido — o fluxo que já existia. */
async function primeiroCiclo(app: App, opcoes: { preco?: string } = {}) {
  const { project, productId } = await criarProjeto(app);
  const quote = await criarOrcamento(app, project.id, opcoes);

  await definirValidade(app, quote.id, VALIDADE_FUTURA);
  expect((await enviar(app, quote.id)).statusCode).toBe(200);
  expect((await aceitar(app, quote.id)).statusCode).toBe(200);

  const aprovado = await app.inject({
    method: "POST",
    url: `/projects/${project.id}/approve`,
    payload: {},
  });
  expect(aprovado.statusCode, aprovado.body).toBe(200);
  expect(aprovado.json().status).toBe("APPROVED");

  const pedido = await gerarPedido(app, quote.id);
  expect(pedido.statusCode, pedido.body).toBe(201);

  return { project, productId, quote, order: pedido.json() };
}

describe("COM-01 — o projeto aprovado recebe novos ciclos comerciais", () => {
  it("A · o primeiro ciclo continua igual: rascunho → enviado → aceito → aprovado → Pedido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, order } = await primeiroCiclo(app);

    expect(order.code).toMatch(/^PED-\d{6}$/);
    expect(order.commercialOrigin.projectId).toBe(project.id);

    await app.close();
  });

  it("B · projeto APROVADO cria um orçamento novo, em rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, quote: v1 } = await primeiroCiclo(app);

    const v2 = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/quote-versions`,
    });
    expect(v2.statusCode, v2.body).toBe(201);
    expect(v2.json().status).toBe("DRAFT");
    expect(v2.json().versionNumber).toBe(v1.versionNumber + 1);
    // Mesmo projeto: recompra não abre cadastro novo.
    expect(v2.json().projectId).toBe(project.id);

    await app.close();
  });

  it("C · projeto CANCELADO continua recusando proposta nova", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await criarProjeto(app);
    const cancelado = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/cancel`,
      payload: { cancelReason: "OTHER", cancelReasonDetails: "Encerrado no teste" },
    });
    expect(cancelado.statusCode, cancelado.body).toBe(200);

    const recusado = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/quote-versions`,
    });
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("project_locked");

    await app.close();
  });

  it("D · aceita que já virou Pedido NÃO é superada quando a seguinte é aceita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, quote: v1, order: ped1 } = await primeiroCiclo(app, { preco: "20" });

    const v2 = await criarOrcamento(app, project.id, { preco: "22" });
    await definirValidade(app, v2.id, VALIDADE_FUTURA);
    expect((await enviar(app, v2.id)).statusCode).toBe(200);
    expect((await aceitar(app, v2.id)).statusCode).toBe(200);

    // O acordo que originou PED-001 continua sendo o acordo que originou PED-001.
    const v1Depois = await lerOrcamento(app, v1.id);
    expect(v1Depois.status).toBe("ACCEPTED");
    expect(v1Depois.sourcedOrder.code).toBe(ped1.code);

    const v2Depois = await lerOrcamento(app, v2.id);
    expect(v2Depois.status).toBe("ACCEPTED");

    await app.close();
  });

  it("E · aceita SEM Pedido continua sendo superada pela versão aceita seguinte", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await primeiroCiclo(app);

    // V2 aceita e deixada em aberto: nenhum Pedido gerado a partir dela.
    const v2 = await criarOrcamento(app, project.id, { preco: "22" });
    await definirValidade(app, v2.id, VALIDADE_FUTURA);
    await enviar(app, v2.id);
    expect((await aceitar(app, v2.id)).statusCode).toBe(200);
    expect((await lerOrcamento(app, v2.id)).sourcedOrder).toBeNull();

    const v3 = await criarOrcamento(app, project.id, { preco: "25" });
    await definirValidade(app, v3.id, VALIDADE_FUTURA);
    await enviar(app, v3.id);
    expect((await aceitar(app, v3.id)).statusCode).toBe(200);

    // Oferta em aberto substituída pela nova: isso não mudou.
    expect((await lerOrcamento(app, v2.id)).status).toBe("SUPERSEDED");
    expect((await lerOrcamento(app, v3.id)).status).toBe("ACCEPTED");

    await app.close();
  });

  it("F · o segundo ciclo gera o SEU Pedido, e cada Pedido aponta para a sua proposta", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, quote: v1, order: ped1 } = await primeiroCiclo(app, { preco: "20" });

    const v2 = await criarOrcamento(app, project.id, { preco: "22" });
    await definirValidade(app, v2.id, VALIDADE_FUTURA);
    await enviar(app, v2.id);
    await aceitar(app, v2.id);

    const criado = await gerarPedido(app, v2.id);
    expect(criado.statusCode, criado.body).toBe(201);
    const ped2 = criado.json();

    expect(ped2.id).not.toBe(ped1.id);
    expect(ped2.code).not.toBe(ped1.code);
    expect(ped2.commercialOrigin.quoteVersionId).toBe(v2.id);
    expect((await lerOrcamento(app, v1.id)).sourcedOrder.id).toBe(ped1.id);
    expect((await lerOrcamento(app, v2.id)).sourcedOrder.id).toBe(ped2.id);

    // Cada Pedido carrega o preço da SUA proposta.
    expect(ped1.lines[0].agreedPrice.unitPrice).toBe("20.0000");
    expect(ped2.lines[0].agreedPrice.unitPrice).toBe("22.0000");

    await app.close();
  });

  it("G · gerar o Pedido duas vezes da mesma proposta devolve o mesmo Pedido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote, order } = await primeiroCiclo(app);

    const segunda = await gerarPedido(app, quote.id);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().id).toBe(order.id);

    await app.close();
  });

  it("produto fora do escopo aprovado não volta por um orçamento novo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await primeiroCiclo(app);
    const prisma = getPrisma();
    const aprovado = await prisma.projectProduct.findFirstOrThrow({
      where: { projectId: project.id },
    });
    // O que a aprovação teria marcado se o cliente não tivesse fechado este item.
    await prisma.projectProduct.update({
      where: { id: aprovado.id },
      data: { status: "OUT_OF_SCOPE" },
    });

    const nova = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    // A versão nova nasce com as linhas da anterior; a linha sai para que o
    // teste meça a recusa de ESCOPO, e não a de duplicidade.
    await app.inject({ method: "DELETE", url: `/quote-lines/${nova.lines[0].id}` });

    const recusado = await app.inject({
      method: "POST",
      url: `/quote-versions/${nova.id}/lines`,
      payload: { projectProductId: aprovado.id },
    });

    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("product_out_of_approved_scope");

    await app.close();
  });
});

describe("COM-02 — a validade da proposta passa a valer", () => {
  it("H · rascunho sem validade continua salvando", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await criarProjeto(app);
    const quote = await criarOrcamento(app, project.id);

    expect(quote.status).toBe("DRAFT");
    expect(quote.validUntil).toBeNull();
    // E continua editável: trabalho em andamento não exige prazo.
    const salvo = await app.inject({
      method: "PATCH",
      url: `/quote-versions/${quote.id}`,
      payload: { commercialNotes: "Em negociação" },
    });
    expect(salvo.statusCode).toBe(200);

    await app.close();
  });

  it("I · enviar sem validade é recusado com erro de domínio, não 500", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await criarProjeto(app);
    const quote = await criarOrcamento(app, project.id);

    const recusado = await enviar(app, quote.id);
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("quote_without_valid_until");
    expect(recusado.json().message).toMatch(/validade da proposta antes de enviar/i);
    expect(Object.keys(recusado.json()).sort()).toEqual(["error", "message"]);
    // Nada foi enviado: a proposta continua rascunho.
    expect((await lerOrcamento(app, quote.id)).status).toBe("DRAFT");

    await app.close();
  });

  it("J · enviada dentro da validade é aceita normalmente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await criarProjeto(app);
    const quote = await criarOrcamento(app, project.id);
    await definirValidade(app, quote.id, VALIDADE_FUTURA);
    await enviar(app, quote.id);

    const enviada = await lerOrcamento(app, quote.id);
    expect(enviada.status).toBe("SENT");
    expect(enviada.expired).toBe(false);
    expect((await aceitar(app, quote.id)).statusCode).toBe(200);

    await app.close();
  });

  it("K · enviada e vencida não é aceita — e o documento continua no histórico", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await criarProjeto(app);
    const quote = await criarOrcamento(app, project.id);
    await definirValidade(app, quote.id, VALIDADE_VENCIDA);
    expect((await enviar(app, quote.id)).statusCode).toBe(200);

    const vencida = await lerOrcamento(app, quote.id);
    // Vencida é derivado: o status gravado continua SENT, sem `EXPIRED` nenhum.
    expect(vencida.status).toBe("SENT");
    expect(vencida.expired).toBe(true);

    const recusado = await aceitar(app, quote.id);
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("quote_expired");
    expect(recusado.json().message).toMatch(/vencida em 31\/01\/2020/i);
    expect((await lerOrcamento(app, quote.id)).status).toBe("SENT");

    await app.close();
  });

  it("N · aceita dentro da validade vira Pedido mesmo depois de a data passar, com o preço intacto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project } = await criarProjeto(app);
    const quote = await criarOrcamento(app, project.id, { preco: "17.5" });
    await definirValidade(app, quote.id, VALIDADE_FUTURA);
    await enviar(app, quote.id);
    expect((await aceitar(app, quote.id)).statusCode).toBe(200);
    await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} });

    /*
     * O tempo é a única coisa que a API não oferece: a validade recua na
     * fixture para simular a passagem dos dias entre o "sim" do cliente e a
     * emissão do Pedido. Nenhum estado de negócio é fabricado aqui — a
     * proposta já estava aceita pelo fluxo normal.
     */
    await getPrisma().quoteVersion.update({
      where: { id: quote.id },
      data: { validUntil: new Date("2020-01-31T00:00:00.000Z") },
    });

    const pedido = await gerarPedido(app, quote.id);
    expect(pedido.statusCode, pedido.body).toBe(201);
    // A validade fecha a janela de ACEITE, não o prazo do acordo já aceito.
    expect(pedido.json().lines[0].agreedPrice.unitPrice).toBe("17.5000");

    // E a aceita não passa a se dizer vencida por causa do calendário.
    expect((await lerOrcamento(app, quote.id)).expired).toBe(false);

    await app.close();
  });
});
