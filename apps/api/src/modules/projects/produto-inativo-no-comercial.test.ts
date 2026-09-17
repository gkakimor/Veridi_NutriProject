import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Produto inativo não inicia compromisso comercial novo —
 * PRODUCT-INACTIVE-COMMERCIAL-GATE-01, `PRODUCT_RULES.md` §108 (D6 e D7).
 *
 * Cada porta de compromisso NOVO recusa: vincular ao Projeto, linha nova e
 * envio de Orçamento, aceite, aprovação do Projeto, geração do Pedido e Amostra.
 * O que já existe não é apagado nem cancelado: o rascunho abre marcado e edita,
 * a proposta enviada e o Pedido gerado ficam como estão, e reativar destrava o
 * mesmo passo, sem refazer nada. Produto e PA não têm cascata, e o PA inativo
 * recusa com mensagem própria — nunca "sem produto acabado".
 */

const clientes: string[] = [];
const projetos: string[] = [];
const produtos: string[] = [];
const pedidosAvulsos: string[] = [];

type App = ReturnType<typeof buildTestApp>;
type Resposta = Awaited<ReturnType<App["inject"]>>;

/** Longe o bastante para nenhuma execução futura reprovar por calendário. */
const VALIDADE_FUTURA = "2099-12-31";

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (pedidosAvulsos.length > 0) {
    await prisma.customerOrderLine.deleteMany({ where: { customerOrderId: { in: pedidosAvulsos } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidosAvulsos } } });
  }
  if (projetos.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrder: { sourceProjectId: { in: projetos } } },
    });
    await prisma.customerOrder.deleteMany({ where: { sourceProjectId: { in: projetos } } });
    await prisma.projectSample.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.quoteLine.deleteMany({ where: { quoteVersion: { projectId: { in: projetos } } } });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.projectProduct.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.project.deleteMany({ where: { id: { in: projetos } } });
  }
  if (produtos.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtos } } });
    const itens = await prisma.product.findMany({
      where: { id: { in: produtos } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: produtos } } });
    const ids = itens
      .map((produto) => produto.finishedProductItemId)
      .filter((id): id is string => id !== null);
    if (ids.length > 0) await prisma.item.deleteMany({ where: { id: { in: ids } } });
  }
  if (clientes.length > 0) await prisma.customer.deleteMany({ where: { id: { in: clientes } } });
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function corpo(resposta: Resposta, status: number) {
  expect(resposta.statusCode, resposta.body).toBe(status);
  return resposta.json();
}

/** A recusa de negócio, com o código e o que a mensagem precisa nomear. */
function recusa(resposta: Resposta, codigo: string, ...trechos: string[]) {
  expect(resposta.statusCode, resposta.body).toBe(400);
  const { error, message } = resposta.json() as { error: string; message: string };
  expect(error).toBe(codigo);
  for (const trecho of trechos) expect(message).toContain(trecho);
  return message;
}

async function ler(app: App, url: string) {
  return corpo(await app.inject({ method: "GET", url }), 200);
}

function situacao(app: App, tipo: "products" | "items", id: string, ativo: boolean) {
  return app.inject({ method: "POST", url: `/${tipo}/${id}/${ativo ? "activate" : "deactivate"}` });
}

async function mudar(app: App, tipo: "products" | "items", id: string, ativo: boolean) {
  corpo(await situacao(app, tipo, id, ativo), 200);
}

async function cliente() {
  const m = marca();
  const criado = await getPrisma().customer.create({
    data: { code: `CLI-PIN-${m}`, legalName: `Cliente produto inativo ${m}`, active: true },
  });
  clientes.push(criado.id);
  return criado.id;
}

/** Projeto com o produto técnico preparado — o caminho normal do Comercial. */
async function projetoComProduto(app: App, customerId?: string) {
  const clienteId = customerId ?? (await cliente());
  const projeto = corpo(
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: `Projeto produto inativo ${marca()}`, customerId: clienteId },
    }),
    201,
  );
  projetos.push(projeto.id);
  const preparado = corpo(
    await app.inject({
      method: "POST",
      url: `/projects/${projeto.id}/technical-product`,
      payload: { finishedUnitCode: "un" },
    }),
    201,
  );
  produtos.push(preparado.productId);
  const vinculo = preparado.products[0] as { id: string; productId: string; productCode: string };
  return {
    clienteId,
    projetoId: projeto.id as string,
    produtoId: vinculo.productId,
    produtoCodigo: vinculo.productCode,
    vinculoId: vinculo.id,
  };
}

/** Produto aprovado do cadastro, com o PA que nasce junto. */
async function produtoDoCadastro(app: App, customerId: string) {
  const produto = corpo(
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId, name: `Produto cadastro inativo ${marca()}` },
    }),
    201,
  );
  produtos.push(produto.id);
  return produto as {
    id: string;
    code: string;
    finishedProductItem: { id: string; code: string; active: boolean };
  };
}

/** Rascunho com a linha do vínculo precificada e com validade: pronto para enviar. */
async function rascunhoCompleto(app: App, projetoId: string, vinculoId: string) {
  const versao = corpo(
    await app.inject({ method: "POST", url: `/projects/${projetoId}/quote-versions` }),
    201,
  );
  let atual = versao;
  if (atual.lines.length === 0) {
    atual = corpo(
      await app.inject({
        method: "POST",
        url: `/quote-versions/${versao.id}/lines`,
        payload: { projectProductId: vinculoId },
      }),
      201,
    );
  }
  corpo(
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${atual.lines[0].id}`,
      payload: { quotedQuantity: "100", uomCode: "un", unitPrice: "20" },
    }),
    200,
  );
  corpo(
    await app.inject({
      method: "PATCH",
      url: `/quote-versions/${versao.id}`,
      payload: { validUntil: VALIDADE_FUTURA },
    }),
    200,
  );
  return ler(app, `/quote-versions/${versao.id}`);
}

function enviar(app: App, quoteId: string) {
  return app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/send`,
    payload: { confirmIncompleteCost: true },
  });
}

function aceitar(app: App, quoteId: string) {
  return app.inject({ method: "POST", url: `/quote-versions/${quoteId}/accept` });
}

function aprovar(app: App, projetoId: string) {
  return app.inject({ method: "POST", url: `/projects/${projetoId}/approve`, payload: {} });
}

function gerarPedido(app: App, quoteId: string) {
  return app.inject({ method: "POST", url: `/quote-versions/${quoteId}/create-order` });
}

/** Proposta enviada e aceita, projeto aprovado — o Pedido é o próximo passo. */
async function prontoParaPedido(app: App) {
  const base = await projetoComProduto(app);
  const versao = await rascunhoCompleto(app, base.projetoId, base.vinculoId);
  corpo(await enviar(app, versao.id), 200);
  corpo(await aceitar(app, versao.id), 200);
  expect(corpo(await aprovar(app, base.projetoId), 200).status).toBe("APPROVED");
  return { ...base, versaoId: versao.id as string };
}

describe("PRODUCT-INACTIVE-COMMERCIAL-GATE-01 — Projeto e Orçamento (D6)", () => {
  it("vincular produto inativo ao projeto é recusado, nada é vinculado, e reativado ele entra", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { clienteId, projetoId } = await projetoComProduto(app);
    const produto = await produtoDoCadastro(app, clienteId);

    await mudar(app, "products", produto.id, false);
    const pedirVinculo = () =>
      app.inject({
        method: "POST",
        url: `/projects/${projetoId}/products`,
        payload: { operation: "link", productId: produto.id },
      });
    recusa(await pedirVinculo(), "inactive_product", produto.code, "Reative o produto para vinculá-lo");
    const vinculados = (await ler(app, `/projects/${projetoId}/products`)).products as { productId: string }[];
    expect(vinculados.map((vinculo) => vinculo.productId)).not.toContain(produto.id);

    await mudar(app, "products", produto.id, true);
    expect(corpo(await pedirVinculo(), 201).productActive).toBe(true);

    await app.close();
  });

  it("rascunho: linha nova recusa; a linha que já estava abre marcada, edita e não envia; reativado, envia", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const base = await projetoComProduto(app);
    const outro = await produtoDoCadastro(app, base.clienteId);
    const outroVinculo = corpo(
      await app.inject({
        method: "POST",
        url: `/projects/${base.projetoId}/products`,
        payload: { operation: "link", productId: outro.id },
      }),
      201,
    );
    const versao = await rascunhoCompleto(app, base.projetoId, base.vinculoId);
    const linha = versao.lines[0] as { id: string; productActive: boolean };
    expect(linha.productActive).toBe(true);

    // Linha NOVA de produto inativo: recusada, e a proposta não muda.
    await mudar(app, "products", outro.id, false);
    recusa(
      await app.inject({
        method: "POST",
        url: `/quote-versions/${versao.id}/lines`,
        payload: { projectProductId: outroVinculo.id },
      }),
      "inactive_product",
      outro.code,
      "Reative o produto para incluí-lo na proposta.",
    );
    expect((await ler(app, `/quote-versions/${versao.id}`)).lines).toHaveLength(1);

    // O produto da linha que já estava é inativado: o rascunho abre, marcado.
    await mudar(app, "products", base.produtoId, false);
    const aberto = await ler(app, `/quote-versions/${versao.id}`);
    expect(aberto.status).toBe("DRAFT");
    expect(aberto.lines.map((l: { productActive: boolean }) => l.productActive)).toEqual([false]);
    const doProjeto = await ler(app, `/projects/${base.projetoId}`);
    expect(
      doProjeto.products.find((p: { productId: string }) => p.productId === base.produtoId).productActive,
    ).toBe(false);

    // Continua editável — e a precificação não é bloqueada por estar inativo.
    const editado = corpo(
      await app.inject({
        method: "PATCH",
        url: `/quote-lines/${linha.id}`,
        payload: { quotedQuantity: "150" },
      }),
      200,
    );
    expect(editado.lines[0].quotedQuantity).toBe("150");
    corpo(await app.inject({ method: "GET", url: `/quote-lines/${linha.id}/pricing-options` }), 200);
    corpo(
      await app.inject({
        method: "PATCH",
        url: `/quote-lines/${linha.id}`,
        payload: { unitPrice: "21" },
      }),
      200,
    );

    // Enviar é compromisso novo: recusado, e a versão segue rascunho.
    recusa(
      await enviar(app, versao.id),
      "inactive_product",
      base.produtoCodigo,
      "Reative o produto ou retire a linha para enviar a proposta.",
    );
    expect((await ler(app, `/quote-versions/${versao.id}`)).status).toBe("DRAFT");

    await mudar(app, "products", base.produtoId, true);
    expect(corpo(await enviar(app, versao.id), 200).status).toBe("SENT");

    await app.close();
  });

  it("versão nova e duplicar copiam a linha do produto inativo, e o envio da cópia recusa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // Versão nova a partir da enviada.
    const a = await projetoComProduto(app);
    const v1a = await rascunhoCompleto(app, a.projetoId, a.vinculoId);
    corpo(await enviar(app, v1a.id), 200);
    await mudar(app, "products", a.produtoId, false);
    const v2a = corpo(
      await app.inject({ method: "POST", url: `/projects/${a.projetoId}/quote-versions` }),
      201,
    );
    expect(v2a.versionNumber).toBe(2);
    expect(v2a.lines.map((l: { productId: string; productActive: boolean }) => [l.productId, l.productActive])).toEqual([
      [a.produtoId, false],
    ]);
    corpo(
      await app.inject({
        method: "PATCH",
        url: `/quote-lines/${v2a.lines[0].id}`,
        payload: { quotedQuantity: "100", uomCode: "un", unitPrice: "20" },
      }),
      200,
    );
    corpo(
      await app.inject({
        method: "PATCH",
        url: `/quote-versions/${v2a.id}`,
        payload: { validUntil: VALIDADE_FUTURA },
      }),
      200,
    );
    recusa(await enviar(app, v2a.id), "inactive_product", a.produtoCodigo);

    // Duplicar a enviada, mantendo os preços: o único impedimento é o produto.
    const b = await projetoComProduto(app);
    const v1b = await rascunhoCompleto(app, b.projetoId, b.vinculoId);
    corpo(await enviar(app, v1b.id), 200);
    await mudar(app, "products", b.produtoId, false);
    const v2b = corpo(
      await app.inject({
        method: "POST",
        url: `/quote-versions/${v1b.id}/duplicate`,
        payload: { priceStrategy: "KEEP_PRICES" },
      }),
      201,
    );
    expect(v2b.status).toBe("DRAFT");
    expect(v2b.lines).toHaveLength(1);
    expect(v2b.lines[0].productActive).toBe(false);
    expect(v2b.lines[0].unitPrice).not.toBeNull();
    recusa(await enviar(app, v2b.id), "inactive_product", b.produtoCodigo);
    // A origem da duplicação segue enviada.
    expect((await ler(app, `/quote-versions/${v1b.id}`)).status).toBe("SENT");

    await mudar(app, "products", b.produtoId, true);
    expect(corpo(await enviar(app, v2b.id), 200).status).toBe("SENT");

    await app.close();
  });

  it("aceite: produto inativado depois do envio não fecha acordo; a enviada fica intacta; reativado, aceita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const base = await projetoComProduto(app);
    const versao = await rascunhoCompleto(app, base.projetoId, base.vinculoId);
    corpo(await enviar(app, versao.id), 200);

    await mudar(app, "products", base.produtoId, false);
    recusa(
      await aceitar(app, versao.id),
      "inactive_product",
      base.produtoCodigo,
      "Reative o produto para registrar o aceite.",
    );
    const enviada = await ler(app, `/quote-versions/${versao.id}`);
    expect(enviada.status).toBe("SENT");
    expect(enviada.acceptedAt).toBeNull();
    expect(enviada.lines[0].productActive).toBe(false);

    await mudar(app, "products", base.produtoId, true);
    expect(corpo(await aceitar(app, versao.id), 200).status).toBe("ACCEPTED");

    await app.close();
  });

  it("aprovação: produto aceito e inativado não aprova, nada é promovido, e reativado aprova", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const base = await projetoComProduto(app);
    const versao = await rascunhoCompleto(app, base.projetoId, base.vinculoId);
    corpo(await enviar(app, versao.id), 200);
    corpo(await aceitar(app, versao.id), 200);
    const antes = await ler(app, `/projects/${base.projetoId}`);

    await mudar(app, "products", base.produtoId, false);
    recusa(
      await aprovar(app, base.projetoId),
      "inactive_product",
      base.produtoCodigo,
      "Reative o produto para aprovar o projeto.",
    );
    // A transação desfez tudo: status, escopo e lifecycle ficam como estavam.
    const recusado = await ler(app, `/projects/${base.projetoId}`);
    expect(recusado.status).toBe(antes.status);
    expect(recusado.approvedAt).toBeNull();
    expect(recusado.products.map((p: { status: string }) => p.status)).toEqual(["ACTIVE"]);
    expect((await ler(app, `/quote-versions/${versao.id}`)).status).toBe("ACCEPTED");
    const produto = await getPrisma().product.findUniqueOrThrow({ where: { id: base.produtoId } });
    expect(produto.lifecycle).toBe("DEVELOPMENT");
    const historico = await getPrisma().projectStatusHistory.count({
      where: { projectId: base.projetoId, toStatus: "APPROVED" },
    });
    expect(historico).toBe(0);

    await mudar(app, "products", base.produtoId, true);
    expect(corpo(await aprovar(app, base.projetoId), 200).status).toBe("APPROVED");

    await app.close();
  });

  it("gerar pedido: produto inativo não gera; PA inativo tem recusa própria; o Pedido gerado continua", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const base = await prontoParaPedido(app);
    const pa = await getPrisma().product.findUniqueOrThrow({
      where: { id: base.produtoId },
      select: { finishedProductItem: { select: { id: true, code: true } } },
    });
    const item = pa.finishedProductItem!;
    const pedidosDaVersao = () =>
      getPrisma().customerOrder.count({ where: { sourceQuoteVersionId: base.versaoId } });

    await mudar(app, "products", base.produtoId, false);
    recusa(
      await gerarPedido(app, base.versaoId),
      "inactive_product",
      base.produtoCodigo,
      "Reative o produto para gerar o pedido.",
    );
    expect(await pedidosDaVersao()).toBe(0);

    // Produto ativo, PA inativo: sem cascata, e a mensagem nomeia o item que existe.
    await mudar(app, "products", base.produtoId, true);
    await mudar(app, "items", item.id, false);
    const mensagem = recusa(
      await gerarPedido(app, base.versaoId),
      "inactive_finished_item",
      item.code,
      base.produtoCodigo,
      "Reative o item para gerar o pedido.",
    );
    expect(mensagem).not.toMatch(/válido|unidade/i);
    expect(await pedidosDaVersao()).toBe(0);

    await mudar(app, "items", item.id, true);
    const pedido = corpo(await gerarPedido(app, base.versaoId), 201);

    // Inativar depois não apaga nem cancela: o Pedido abre marcado, a proposta
    // segue aceita, e gerar de novo devolve o mesmo Pedido.
    await mudar(app, "products", base.produtoId, false);
    const gerado = await ler(app, `/customer-orders/${pedido.id}`);
    expect(gerado.status).toBe("DRAFT");
    expect(gerado.cancelledAt).toBeNull();
    expect(gerado.lines.map((l: { productActive: boolean }) => l.productActive)).toEqual([false]);
    expect((await ler(app, `/quote-versions/${base.versaoId}`)).status).toBe("ACCEPTED");
    expect(corpo(await gerarPedido(app, base.versaoId), 200).id).toBe(pedido.id);
    expect(await pedidosDaVersao()).toBe(1);

    await app.close();
  });

  it("histórico: proposta enviada, aceita e Pedido confirmado seguem legíveis e intactos com o produto inativo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const base = await prontoParaPedido(app);
    const pedido = corpo(await gerarPedido(app, base.versaoId), 201);
    corpo(await app.inject({ method: "POST", url: `/customer-orders/${pedido.id}/confirm` }), 200);

    await mudar(app, "products", base.produtoId, false);

    const projeto = await ler(app, `/projects/${base.projetoId}`);
    expect(projeto.status).toBe("APPROVED");
    expect(projeto.quoteVersions.map((q: { status: string }) => q.status)).toEqual(["ACCEPTED"]);
    const confirmado = await ler(app, `/customer-orders/${pedido.id}`);
    expect(confirmado.status).toBe("CONFIRMED");
    expect(confirmado.lines[0].productActive).toBe(false);
    // A linha congelada no envio não troca pelo cadastro: código e nome ficam.
    expect(confirmado.lines[0].productCode).toBe(base.produtoCodigo);

    await app.close();
  });
});

describe("PRODUCT-INACTIVE-COMMERCIAL-GATE-01 — Amostra (D6)", () => {
  it("amostra nova de produto inativo é recusada; a existente segue; reativado, cria", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const base = await projetoComProduto(app);

    const existente = corpo(
      await app.inject({ method: "POST", url: `/projects/${base.projetoId}/samples`, payload: {} }),
      201,
    );

    await mudar(app, "products", base.produtoId, false);
    // Projeto de um produto só: o vínculo automático não contorna a regra.
    recusa(
      await app.inject({ method: "POST", url: `/projects/${base.projetoId}/samples`, payload: {} }),
      "inactive_product",
      base.produtoCodigo,
      "Reative o produto para criar a amostra.",
    );
    expect(
      await getPrisma().projectSample.count({ where: { projectId: base.projetoId } }),
    ).toBe(1);
    const lida = await ler(app, `/project-samples/${existente.id}`);
    expect(lida.productCode).toBe(base.produtoCodigo);
    expect(lida.status).toBe(existente.status);

    // Com dois produtos, o ativo continua recebendo amostra.
    const outro = await produtoDoCadastro(app, base.clienteId);
    const outroVinculo = corpo(
      await app.inject({
        method: "POST",
        url: `/projects/${base.projetoId}/products`,
        payload: { operation: "link", productId: outro.id },
      }),
      201,
    );
    corpo(
      await app.inject({
        method: "POST",
        url: `/projects/${base.projetoId}/samples`,
        payload: { projectProductId: outroVinculo.id },
      }),
      201,
    );
    recusa(
      await app.inject({
        method: "POST",
        url: `/projects/${base.projetoId}/samples`,
        payload: { projectProductId: base.vinculoId },
      }),
      "inactive_product",
      base.produtoCodigo,
    );

    await mudar(app, "products", base.produtoId, true);
    corpo(
      await app.inject({
        method: "POST",
        url: `/projects/${base.projetoId}/samples`,
        payload: { projectProductId: base.vinculoId },
      }),
      201,
    );

    await app.close();
  });
});

describe("PRODUCT-INACTIVE-COMMERCIAL-GATE-01 — Produto × PA sem cascata (D7)", () => {
  it("inativar um não inativa o outro, reativar um não reativa o outro, e o cadastro mostra o PA inativo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const produto = await produtoDoCadastro(app, await cliente());
    const itemId = produto.finishedProductItem.id;
    expect(produto.finishedProductItem.active).toBe(true);

    await mudar(app, "products", produto.id, false);
    expect((await ler(app, `/items/${itemId}`)).active).toBe(true);
    expect((await ler(app, `/products/${produto.id}`)).finishedProductItem.active).toBe(true);

    await mudar(app, "items", itemId, false);
    await mudar(app, "products", produto.id, true);
    const lido = await ler(app, `/products/${produto.id}`);
    expect(lido.active).toBe(true);
    expect(lido.finishedProductItem.active).toBe(false);
    expect((await ler(app, `/items/${itemId}`)).active).toBe(false);

    await mudar(app, "items", itemId, true);
    expect((await ler(app, `/products/${produto.id}`)).finishedProductItem.active).toBe(true);

    await app.close();
  });

  it("Pedido: PA inativo recusa linha nova e confirmação com mensagem própria; produto inativo idem; reativados, confirma", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const clienteId = await cliente();
    const produto = await produtoDoCadastro(app, clienteId);
    const itemId = produto.finishedProductItem.id;
    const novoPedido = () =>
      app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: { customerId: clienteId, lines: [{ productId: produto.id, orderedQuantity: "10" }] },
      });

    // Linha nova com PA inativo: o item existe — nunca "sem produto acabado".
    await mudar(app, "items", itemId, false);
    const mensagem = recusa(
      await novoPedido(),
      "inactive_finished_item",
      produto.finishedProductItem.code,
      produto.code,
      "Reative o item ou retire a linha do pedido.",
    );
    expect(mensagem).not.toMatch(/válido/i);

    await mudar(app, "items", itemId, true);
    const rascunho = corpo(await novoPedido(), 201);
    pedidosAvulsos.push(rascunho.id);
    expect(rascunho.lines[0].productActive).toBe(true);
    expect(rascunho.lines[0].finishedItemActive).toBe(true);

    // Rascunho que já existia: abre marcado, e a confirmação recusa.
    await mudar(app, "items", itemId, false);
    const marcado = await ler(app, `/customer-orders/${rascunho.id}`);
    expect(marcado.lines[0].finishedItemActive).toBe(false);
    expect(marcado.lines[0].productActive).toBe(true);
    recusa(
      await app.inject({ method: "POST", url: `/customer-orders/${rascunho.id}/confirm` }),
      "inactive_finished_item",
      produto.finishedProductItem.code,
      "Reative o item para confirmar o pedido.",
    );

    await mudar(app, "items", itemId, true);
    await mudar(app, "products", produto.id, false);
    recusa(
      await app.inject({ method: "POST", url: `/customer-orders/${rascunho.id}/confirm` }),
      "inactive_product",
      produto.code,
      "Reative o produto ou retire a linha para confirmar o pedido.",
    );
    recusa(
      await novoPedido(),
      "inactive_product",
      produto.code,
      "Reative o produto ou retire a linha do pedido.",
    );
    expect((await ler(app, `/customer-orders/${rascunho.id}`)).status).toBe("DRAFT");

    await mudar(app, "products", produto.id, true);
    expect(
      corpo(await app.inject({ method: "POST", url: `/customer-orders/${rascunho.id}/confirm` }), 200)
        .status,
    ).toBe("CONFIRMED");

    await app.close();
  });
});
