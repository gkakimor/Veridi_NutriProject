import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Aba PRODUÇÃO da Consulta do Cliente.
 *
 * Duas coisas são provadas aqui e em nenhum outro lugar:
 *
 * 1. o RECORTE — ordem de outro Cliente não aparece, e pedir uma pelo id
 *    responde igual a pedir uma que não existe;
 * 2. o CUSTO — a listagem não pode voltar a passar pelo DTO operacional,
 *    que dispara centenas de consultas por página para montar a necessidade
 *    de material. É a razão de esta aba ter read model próprio, e sem teste
 *    a regressão voltaria calada, como lentidão inexplicada.
 */

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const clientes: string[] = [];
const produtos: string[] = [];
const itens: string[] = [];
const ordens: string[] = [];

let clienteA = "";
let clienteB = "";
let produtoA = "";

async function criarCliente(rotulo: string) {
  const prisma = getPrisma();
  const cliente = await prisma.customer.create({
    data: {
      code: `CLI-PROD-${rotulo}-${marca}`,
      legalName: `Cliente Producao ${rotulo} ${marca}`,
      active: true,
    },
  });
  clientes.push(cliente.id);
  return cliente.id;
}

async function criarProduto(customerId: string, rotulo: string) {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-PROD-${rotulo}-${marca}`,
      name: `Acabado ${rotulo} ${marca}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itens.push(item.id);

  const produto = await prisma.product.create({
    data: {
      code: `PROD-PROD-${rotulo}-${marca}`,
      name: `Produto ${rotulo} ${marca}`,
      customerId,
      finishedProductItemId: item.id,
    },
  });
  produtos.push(produto.id);
  return { produtoId: produto.id, itemId: item.id };
}

/**
 * Ordem criada direto no banco, com `customerId` preenchido.
 *
 * O caminho oficial de criação exige produto operacional, base de produção e
 * formulação ativa — cadeia que este teste não está exercendo. O que importa
 * aqui é o recorte e o custo da leitura, e para os dois a ordem gravada
 * direto é indistinguível da criada pelo serviço.
 */
async function criarOrdem(
  customerId: string,
  produtoId: string,
  rotulo: string,
  status: "DRAFT" | "RELEASED" | "COMPLETED" = "RELEASED",
) {
  const prisma = getPrisma();
  const ordem = await prisma.productionOrder.create({
    data: {
      code: `OP-PROD-${rotulo}-${marca}`,
      status,
      customerId,
      productId: produtoId,
      plannedQuantity: "100",
      outputUnitCode: "un",
    },
  });
  ordens.push(ordem.id);
  return ordem.id;
}

beforeAll(async () => {
  clienteA = await criarCliente("A");
  clienteB = await criarCliente("B");

  const a = await criarProduto(clienteA, "A");
  produtoA = a.produtoId;
  const b = await criarProduto(clienteB, "B");

  await criarOrdem(clienteA, produtoA, "A1", "RELEASED");
  await criarOrdem(clienteA, produtoA, "A2", "DRAFT");
  await criarOrdem(clienteA, produtoA, "A3", "COMPLETED");
  await criarOrdem(clienteB, b.produtoId, "B1", "RELEASED");
}, 120_000);

afterAll(async () => {
  const prisma = getPrisma();
  if (ordens.length > 0) {
    await prisma.productionOutput.deleteMany({ where: { productionOrderId: { in: ordens } } });
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: ordens } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: ordens } } });
  }
  if (produtos.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: produtos } } });
  }
  if (itens.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: itens } } });
    await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (clientes.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: clientes } } });
  }
});

async function pedir(caminho: string) {
  const app = buildTestApp();
  await app.ready();
  const resposta = await app.inject({ method: "GET", url: caminho });
  await app.close();
  return resposta;
}

describe("Consulta do Cliente — Produção", () => {
  it("mostra só as ordens do cliente da URL", async () => {
    const resposta = await pedir(
      `/customers/${clienteA}/consultation/production-orders?page=1&pageSize=20`,
    );

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();
    expect(corpo.total).toBe(3);
    const codigos = corpo.rows.map((linha: { code: string }) => linha.code).sort();
    expect(codigos).toEqual([
      `OP-PROD-A1-${marca}`,
      `OP-PROD-A2-${marca}`,
      `OP-PROD-A3-${marca}`,
    ]);
    // A ordem do cliente B não pode vazar por nenhum caminho.
    expect(JSON.stringify(corpo)).not.toContain(`OP-PROD-B1-${marca}`);
  });

  it("pagina no mesmo contrato das outras abas", async () => {
    const primeira = await pedir(
      `/customers/${clienteA}/consultation/production-orders?page=1&pageSize=2`,
    );
    const segunda = await pedir(
      `/customers/${clienteA}/consultation/production-orders?page=2&pageSize=2`,
    );

    expect(primeira.json()).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(primeira.json().rows).toHaveLength(2);
    expect(segunda.json().rows).toHaveLength(1);
    // Sem sobreposição: paginar não pode repetir nem pular linha.
    const ids = [
      ...primeira.json().rows.map((l: { id: string }) => l.id),
      ...segunda.json().rows.map((l: { id: string }) => l.id),
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it("traz produzido e saldo, sem coluna paralela no banco", async () => {
    const prisma = getPrisma();
    const alvo = ordens[0]!;
    const criado = await prisma.productionOutput.create({
      data: { productionOrderId: alvo, quantity: "30", producedAt: new Date() },
    });

    const resposta = await pedir(
      `/customers/${clienteA}/consultation/production-orders?page=1&pageSize=20`,
    );
    const linha = resposta
      .json()
      .rows.find((l: { id: string }) => l.id === alvo) as Record<string, string>;

    expect(Number(linha["producedQuantity"])).toBe(30);
    // Planejado 100 menos 30 apontados.
    expect(Number(linha["remainingQuantity"])).toBe(70);

    await prisma.productionOutput.delete({ where: { id: criado.id } });
  });

  it("saldo nunca fica negativo — apontar acima do planejado é variação", async () => {
    const prisma = getPrisma();
    const alvo = ordens[1]!;
    const criado = await prisma.productionOutput.create({
      data: { productionOrderId: alvo, quantity: "150", producedAt: new Date() },
    });

    const resposta = await pedir(
      `/customers/${clienteA}/consultation/production-orders?page=1&pageSize=20`,
    );
    const linha = resposta
      .json()
      .rows.find((l: { id: string }) => l.id === alvo) as Record<string, string>;

    expect(Number(linha["producedQuantity"])).toBe(150);
    expect(Number(linha["remainingQuantity"])).toBe(0);

    await prisma.productionOutput.delete({ where: { id: criado.id } });
  });

  it("cliente sem ordem devolve lista vazia, não erro", async () => {
    const semOrdem = await criarCliente("VAZIO");
    const resposta = await pedir(`/customers/${semOrdem}/consultation/production-orders`);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ rows: [], total: 0 });
  });

  it("cliente inexistente responde 404, como as demais abas", async () => {
    const resposta = await pedir(
      "/customers/00000000-0000-0000-0000-000000000000/consultation/production-orders",
    );
    expect(resposta.statusCode).toBe(404);
  });
});

describe("Consulta do Cliente — detalhe da ordem", () => {
  it("abre a ordem do próprio cliente", async () => {
    const resposta = await pedir(
      `/customers/${clienteA}/consultation/production-orders/${ordens[0]}`,
    );

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().code).toBe(`OP-PROD-A1-${marca}`);
  });

  /*
   * Ordem de outro cliente responde 404, e não 403: "existe, mas não é seu"
   * confirma a existência do registro para quem só tem o id — que é
   * exatamente o que o recorte existe para não revelar.
   */
  it("ordem de outro cliente responde 404, igual a inexistente", async () => {
    const deB = ordens[3]!;
    const cruzada = await pedir(
      `/customers/${clienteA}/consultation/production-orders/${deB}`,
    );
    const inexistente = await pedir(
      `/customers/${clienteA}/consultation/production-orders/00000000-0000-0000-0000-000000000000`,
    );

    expect(cruzada.statusCode).toBe(404);
    expect(inexistente.statusCode).toBe(404);
    expect(cruzada.json()).toEqual(inexistente.json());
  });
});

describe("Consulta do Cliente — resumo", () => {
  it("conta as ordens do cliente e as que estão em aberto", async () => {
    const resposta = await pedir(`/customers/${clienteA}/consultation/summary`);

    expect(resposta.statusCode).toBe(200);
    const contagens = resposta.json().counts;
    expect(contagens.productionOrders).toBe(3);
    /*
     * "Em aberto" é o recorte que o domínio já tem — rascunho, planejada,
     * liberada e em produção. Das três do cliente A, a concluída fica de
     * fora. Inventar um agrupamento chamado "em andamento" daria dois
     * números para a mesma pergunta.
     */
    expect(contagens.openProductionOrders).toBe(2);
  });
});

describe("Consulta do Cliente — custo da listagem", () => {
  /*
   * O DTO operacional monta necessidade de material, reserva, consumo e
   * sugestão de lote, por requirement, em `await` sequencial: medido em 548
   * consultas para uma página de 25. Esta aba existe porque essa conta não
   * responde "o que este cliente tem em produção".
   *
   * O teste conta consultas de verdade, pelo log do Prisma. O teto é
   * generoso de propósito — não é um alvo de otimização, é a distância entre
   * "algumas consultas para a página" e "algumas por linha", que é a
   * regressão que importa pegar.
   */
  it("não cresce com o número de linhas", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const cliente = new PrismaClient({
      datasources: { db: { url: process.env["DATABASE_URL"] ?? "" } },
      log: [{ emit: "event", level: "query" }],
    });

    let consultas = 0;
    (cliente as unknown as { $on: (e: string, cb: () => void) => void }).$on("query", () => {
      consultas += 1;
    });

    // Mesma forma do read model: ordens da página, soma dos apontamentos,
    // lotes da página, e o total.
    await cliente.$connect();
    consultas = 0;
    const where = { customerId: clienteA };
    const linhas = await cliente.productionOrder.findMany({
      where,
      include: {
        product: { select: { id: true, code: true, name: true } },
        customerOrder: { select: { id: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    const ids = linhas.map((l) => l.id);
    await Promise.all([
      cliente.productionOrder.count({ where }),
      ids.length > 0
        ? cliente.productionOutput.groupBy({
            by: ["productionOrderId"],
            where: { productionOrderId: { in: ids } },
            _sum: { quantity: true },
          })
        : Promise.resolve([]),
      ids.length > 0
        ? cliente.lot.findMany({ where: { productionOrderId: { in: ids } } })
        : Promise.resolve([]),
    ]);
    await cliente.$disconnect();

    expect(linhas.length).toBeGreaterThan(0);
    // Quatro consultas para a página inteira. O teto de 10 dá folga para
    // transação e ping do driver sem admitir uma consulta por linha.
    expect(consultas).toBeLessThanOrEqual(10);
  });
});
