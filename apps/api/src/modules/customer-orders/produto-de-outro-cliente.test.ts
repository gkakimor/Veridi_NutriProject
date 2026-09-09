import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Produto pertence a um Cliente. Pedido pertence a um Cliente. Misturar os
 * dois era possível até aqui.
 *
 * O que existia: a tela oferecia o catálogo inteiro, o service não comparava
 * nada, e um Pedido do Cliente A com produto do Cliente B chegava a
 * CONFIRMADO sem uma única recusa. A primeira negativa vinha muito depois, em
 * `resolveOrderCustomerId`, quando alguém tentava gerar a Ordem de Produção —
 * com o compromisso comercial já assumido.
 *
 * Agora a recusa é na porta: incluir a linha, editar a linha, trocar o
 * cliente e confirmar o Pedido. Sempre `400 customer_mismatch`, nunca 500.
 */

const pedidos: string[] = [];
const produtos: string[] = [];
const itens: string[] = [];
const clientes: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: {
      code: "kg",
      label: "Quilograma",
      dimension: "MASS" as UomDimension,
      toBaseFactor: "1000",
    },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (pedidos.length > 0) {
    await prisma.customerOrderLine.deleteMany({ where: { customerOrderId: { in: pedidos } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidos } } });
  }
  if (produtos.length > 0) await prisma.product.deleteMany({ where: { id: { in: produtos } } });
  if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
  if (clientes.length > 0) await prisma.customer.deleteMany({ where: { id: { in: clientes } } });
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarCliente() {
  const m = marker();
  const cliente = await getPrisma().customer.create({
    data: { code: `CLI-PC-${m}`, legalName: `Cliente Propriedade ${m}`, active: true },
  });
  clientes.push(cliente.id);
  return cliente;
}

/** Produto DO cliente informado, com Finished Product Item próprio. */
async function criarProduto(app: App, customerId: string | null) {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-PC-${m}`,
      name: `Item Propriedade ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itens.push(item.id);

  /*
   * Produto SEM cliente não é construível pela API — a criação exige o
   * vínculo. O estado existe na base (importação do legado), então o teste o
   * monta onde ele realmente vem: direto no banco.
   */
  const dono = customerId ?? (await criarCliente()).id;
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: dono,
      name: `Produto Propriedade ${m}`,
      finishedProductItemId: item.id,
    },
  });
  const produto = response.json();
  produtos.push(produto.id);
  if (customerId === null) {
    await getPrisma().product.update({ where: { id: produto.id }, data: { customerId: null } });
  }
  return produto;
}

async function criarPedido(app: App, customerId: string, lines: { productId: string; orderedQuantity: string }[] = []) {
  const response = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId, lines },
  });
  if (response.statusCode === 201) pedidos.push(response.json().id);
  return response;
}

/**
 * Linha inconsistente gravada POR FORA do service.
 *
 * É como o dado legado chegou: escrito antes da regra existir. O runtime não
 * é enfraquecido para o teste — nenhuma flag, nenhum bypass em código de
 * produção. O que se escreve aqui é o que a base já tem.
 */
async function gravarLinhaLegada(customerOrderId: string, productId: string) {
  await getPrisma().customerOrderLine.create({
    data: { customerOrderId, productId, orderedQuantity: "10", unitCode: "kg", position: 0 },
  });
}

describe("Pedido do Cliente — produto tem de ser do cliente do pedido", () => {
  it("criar pedido com produto de outro cliente: 400 customer_mismatch e nada persistido", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const produtoDeB = await criarProduto(app, clienteB.id);

    const response = await criarPedido(app, clienteA.id, [
      { productId: produtoDeB.id, orderedQuantity: "10" },
    ]);

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("customer_mismatch");
    expect(response.json().message).toMatch(/Cliente inconsistente/i);
    expect(response.json().message).toContain(clienteB.legalName);
    expect(response.json().message).toContain(clienteA.legalName);
    // Contrato da API: só `error` e `message`, sem stack nem nome de classe.
    expect(Object.keys(response.json()).sort()).toEqual(["error", "message"]);
    expect(JSON.stringify(response.json())).not.toMatch(/CustomerMismatchError|Prisma|at .*\.ts:/);

    // Nenhum rascunho inconsistente nasceu.
    expect(
      await getPrisma().customerOrderLine.count({ where: { productId: produtoDeB.id } }),
    ).toBe(0);

    await app.close();
  });

  it("adicionar linha de outro cliente num rascunho existente: 400 e a linha não entra", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const produtoDeA = await criarProduto(app, clienteA.id);
    const produtoDeB = await criarProduto(app, clienteB.id);
    const pedido = (await criarPedido(app, clienteA.id, [
      { productId: produtoDeA.id, orderedQuantity: "10" },
    ])).json();

    const recusado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${pedido.id}`,
      payload: {
        lines: [
          { productId: produtoDeA.id, orderedQuantity: "10" },
          { productId: produtoDeB.id, orderedQuantity: "5" },
        ],
      },
    });

    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("customer_mismatch");

    // A linha antiga continua lá, e a nova não entrou: a substituição de
    // linhas do PATCH é transacional, e a validação acontece antes dela.
    const depois = await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}` });
    expect(depois.json().lines).toHaveLength(1);
    expect(depois.json().lines[0].productId).toBe(produtoDeA.id);

    await app.close();
  });

  it("trocar o produto da linha do rascunho por um de outro cliente: 400", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const produtoDeA = await criarProduto(app, clienteA.id);
    const produtoDeB = await criarProduto(app, clienteB.id);
    const pedido = (await criarPedido(app, clienteA.id, [
      { productId: produtoDeA.id, orderedQuantity: "10" },
    ])).json();

    const trocado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${pedido.id}`,
      payload: { lines: [{ productId: produtoDeB.id, orderedQuantity: "10" }] },
    });

    expect(trocado.statusCode).toBe(400);
    expect(trocado.json().error).toBe("customer_mismatch");

    const depois = await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}` });
    expect(depois.json().lines[0].productId).toBe(produtoDeA.id);

    await app.close();
  });

  it("trocar o cliente do rascunho mantendo as linhas: 400, sem apagar linha nenhuma", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const produtoDeA = await criarProduto(app, clienteA.id);
    const pedido = (await criarPedido(app, clienteA.id, [
      { productId: produtoDeA.id, orderedQuantity: "10" },
    ])).json();

    const trocaCliente = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${pedido.id}`,
      payload: { customerId: clienteB.id },
    });

    expect(trocaCliente.statusCode).toBe(400);
    expect(trocaCliente.json().error).toBe("customer_mismatch");

    // Nem cascade destrutivo, nem mistura: o pedido ficou como estava.
    const depois = await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}` });
    expect(depois.json().customerId).toBe(clienteA.id);
    expect(depois.json().lines).toHaveLength(1);

    await app.close();
  });

  it("trocar cliente E produtos na mesma requisição é válido quando o produto novo é do cliente novo", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const produtoDeA = await criarProduto(app, clienteA.id);
    const produtoDeB = await criarProduto(app, clienteB.id);
    const pedido = (await criarPedido(app, clienteA.id, [
      { productId: produtoDeA.id, orderedQuantity: "10" },
    ])).json();

    const trocado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${pedido.id}`,
      payload: {
        customerId: clienteB.id,
        lines: [{ productId: produtoDeB.id, orderedQuantity: "7" }],
      },
    });

    expect(trocado.statusCode).toBe(200);
    expect(trocado.json().customerId).toBe(clienteB.id);
    expect(trocado.json().lines[0].productId).toBe(produtoDeB.id);

    /*
     * A validação é contra o cliente COM QUE O PEDIDO FICA. Trocar para B
     * mantendo o produto de A na mesma requisição continua sendo recusa.
     */
    const misturado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${pedido.id}`,
      payload: {
        customerId: clienteA.id,
        lines: [{ productId: produtoDeB.id, orderedQuantity: "7" }],
      },
    });
    expect(misturado.statusCode).toBe(400);
    expect(misturado.json().error).toBe("customer_mismatch");

    await app.close();
  });

  it("confirmar pedido com linha legada inconsistente: 400 — e o mesmo pedido confirma quando o produto é do cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const produtoDeB = await criarProduto(app, clienteB.id);
    const pedido = (await criarPedido(app, clienteA.id)).json();
    await gravarLinhaLegada(pedido.id, produtoDeB.id);

    /*
     * O documento continua abrindo — pedido herdado não some da tela — e diz
     * qual linha está inconsistente.
     */
    const aberto = await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}` });
    expect(aberto.statusCode).toBe(200);
    expect(aberto.json().lines[0].productCustomerMismatch).toBe(true);

    const recusado = await app.inject({
      method: "POST",
      url: `/customer-orders/${pedido.id}/confirm`,
    });
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("customer_mismatch");
    expect(JSON.stringify(recusado.json())).not.toMatch(/CustomerMismatchError|Prisma|at .*\.ts:/);
    expect(
      (await getPrisma().customerOrder.findUnique({ where: { id: pedido.id } }))!.status,
    ).toBe("DRAFT");

    /*
     * A PROVA de que a recusa é a propriedade, e só ela: nada mais muda no
     * pedido — mesmas linhas, mesmo cliente ativo, mesmo produto aprovado com
     * item de produto acabado válido. Só o dono do produto passa a ser o
     * cliente do pedido, e a confirmação que era recusada passa. Antes desta
     * capacidade nada comparava os dois, então este mesmo pedido confirmava.
     */
    await getPrisma().product.update({
      where: { id: produtoDeB.id },
      data: { customerId: clienteA.id },
    });
    const confirmado = await app.inject({
      method: "POST",
      url: `/customer-orders/${pedido.id}/confirm`,
    });
    expect(confirmado.statusCode).toBe(200);
    expect(confirmado.json().status).toBe("CONFIRMED");
    expect(confirmado.json().lines[0].productCustomerMismatch).toBe(false);

    await app.close();
  });

  it("caminho feliz: produto do próprio cliente entra e o pedido confirma", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente();
    const produto = await criarProduto(app, cliente.id);

    const criado = await criarPedido(app, cliente.id, [
      { productId: produto.id, orderedQuantity: "12" },
    ]);
    expect(criado.statusCode).toBe(201);
    expect(criado.json().lines[0].productCustomerMismatch).toBe(false);

    const confirmado = await app.inject({
      method: "POST",
      url: `/customer-orders/${criado.json().id}/confirm`,
    });
    expect(confirmado.statusCode).toBe(200);
    expect(confirmado.json().status).toBe("CONFIRMED");

    await app.close();
  });

  it("produto sem cliente (legado importado) continua aceito em qualquer pedido", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente();
    const produtoSemDono = await criarProduto(app, null);

    const criado = await criarPedido(app, cliente.id, [
      { productId: produtoSemDono.id, orderedQuantity: "3" },
    ]);
    expect(criado.statusCode).toBe(201);
    expect(criado.json().lines[0].productCustomerMismatch).toBe(false);

    const confirmado = await app.inject({
      method: "POST",
      url: `/customer-orders/${criado.json().id}/confirm`,
    });
    expect(confirmado.statusCode).toBe(200);

    await app.close();
  });

  it("a API de Produtos filtra por cliente no banco, com busca e paginação — nunca vaza produto de outro", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const deA = [
      await criarProduto(app, clienteA.id),
      await criarProduto(app, clienteA.id),
      await criarProduto(app, clienteA.id),
    ];
    const deB = await criarProduto(app, clienteB.id);

    /*
     * Paginação de verdade: página 1 com um item por página não pode ser o
     * caminho por onde o produto elegível da página 3 desaparece. A busca por
     * código o encontra com o mesmo filtro de cliente aplicado.
     */
    const pagina1 = await app.inject({
      method: "GET",
      url: `/products?customerId=${clienteA.id}&active=true&page=1&pageSize=1`,
    });
    expect(pagina1.statusCode).toBe(200);
    expect(pagina1.json().products).toHaveLength(1);
    expect(pagina1.json().total).toBeGreaterThanOrEqual(3);

    const forteDaUltimaPagina = deA[deA.length - 1]!;
    const buscado = await app.inject({
      method: "GET",
      url: `/products?customerId=${clienteA.id}&search=${encodeURIComponent(forteDaUltimaPagina.code)}&pageSize=1`,
    });
    expect(buscado.json().products.map((p: { id: string }) => p.id)).toEqual([
      forteDaUltimaPagina.id,
    ]);

    // Produto de B nunca aparece sob o filtro de A — nem por busca pelo código.
    const vazamento = await app.inject({
      method: "GET",
      url: `/products?customerId=${clienteA.id}&search=${encodeURIComponent(deB.code)}`,
    });
    expect(vazamento.json().products).toHaveLength(0);

    // Cliente inexistente não devolve o catálogo inteiro.
    const clienteInvalido = await app.inject({
      method: "GET",
      url: "/products?customerId=nao-existe",
    });
    expect(clienteInvalido.statusCode).toBe(200);
    expect(clienteInvalido.json().products).toHaveLength(0);

    await app.close();
  });
});
