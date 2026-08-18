import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Projeto multiproduto e orçamento multilinha.
 *
 * Uma negociação real cobre mais de um produto: a mesma linha em três sabores
 * nasce de um briefing só e vira uma proposta só. O que estes testes protegem
 * é a consequência disso — o que a aprovação promove é o que o cliente
 * aceitou, e nada além.
 */

const fixtureProjectIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

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
    const links = await prisma.projectProduct.findMany({
      where: { projectId: { in: fixtureProjectIds } },
      select: { productId: true },
    });
    const productIds = links.map((link) => link.productId);

    await prisma.quoteLine.deleteMany({ where: { quoteVersion: { projectId: { in: fixtureProjectIds } } } });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectProduct.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.updateMany({
      where: { id: { in: fixtureProjectIds } },
      data: { productId: null },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, finishedProductItemId: true },
      });
      await prisma.formulationComponent.deleteMany({
        where: { formulationVersion: { productId: { in: productIds } } },
      });
      await prisma.formulationVersion.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      const itemIds = products
        .map((product) => product.finishedProductItemId)
        .filter((id): id is string => Boolean(id));
      if (itemIds.length > 0) {
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
    }
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function createCustomer() {
  const prisma = getPrisma();
  const customer = await prisma.customer.create({
    data: { code: `CLI-MP-${marker()}`, legalName: `Cliente MP ${marker()}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createProject(app: App, customerId: string) {
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { customerId, name: `Linha ${marker()}` },
    })
  ).json();
  fixtureProjectIds.push(project.id);
  return project;
}

async function addProduct(app: App, projectId: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: `/projects/${projectId}/products`,
    payload: { operation: "create", name, finishedUnitCode: "un" },
  });
  return response;
}

async function createQuoteWithLines(
  app: App,
  projectId: string,
  lines: { projectProductId: string; quotedQuantity?: string; unitPrice?: string }[],
) {
  let quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();

  for (const line of lines) {
    quote = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: line.projectProductId },
      })
    ).json();
    const created = quote.lines[quote.lines.length - 1];
    if (line.quotedQuantity !== undefined || line.unitPrice !== undefined) {
      quote = (
        await app.inject({
          method: "PATCH",
          url: `/quote-lines/${created.id}`,
          payload: {
            uomCode: "un",
            ...(line.quotedQuantity !== undefined ? { quotedQuantity: line.quotedQuantity } : {}),
            ...(line.unitPrice !== undefined ? { unitPrice: line.unitPrice } : {}),
          },
        })
      ).json();
    }
  }

  return quote;
}

describe("Projeto com vários produtos", () => {
  it("aceita três produtos no mesmo projeto, cada um com nome próprio", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);

    const morango = (await addProduct(app, project.id, "Pré-Treino Morango")).json();
    const chocolate = (await addProduct(app, project.id, "Pré-Treino Chocolate")).json();
    const baunilha = (await addProduct(app, project.id, "Pré-Treino Baunilha")).json();

    expect(morango.status).toBe("ACTIVE");
    expect(morango.productLifecycle).toBe("DEVELOPMENT");
    // Três sabores com o nome do projeto seriam indistinguíveis na operação.
    expect(new Set([morango.productName, chocolate.productName, baunilha.productName]).size).toBe(3);
    expect(new Set([morango.productCode, chocolate.productCode, baunilha.productCode]).size).toBe(3);

    const detail = (await app.inject({ method: "GET", url: `/projects/${project.id}` })).json();
    expect(detail.products).toHaveLength(3);
    expect(detail.products.map((link: { sequence: number }) => link.sequence)).toEqual([1, 2, 3]);

    await app.close();
  });

  it("recusa o mesmo produto duas vezes no projeto", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const link = (await addProduct(app, project.id, "Produto único")).json();

    const duplicate = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/products`,
      payload: { operation: "link", productId: link.productId },
    });

    expect(duplicate.statusCode).toBe(409);
    const detail = (await app.inject({ method: "GET", url: `/projects/${project.id}` })).json();
    expect(detail.products).toHaveLength(1);

    await app.close();
  });

  it("recusa produto de outro cliente", async () => {
    // Private label é propriedade de quem encomendou: vincular em silêncio
    // misturaria produto de clientes diferentes.
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const outro = await createCustomer();
    const projetoDoOutro = await createProject(app, outro.id);
    const alheio = (await addProduct(app, projetoDoOutro.id, "Produto do outro cliente")).json();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);

    const response = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/products`,
      payload: { operation: "link", productId: alheio.productId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("customer_mismatch");

    await app.close();
  });
});

describe("Orçamento multilinha", () => {
  it("soma as linhas e trata quantidade × preço em Decimal", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Produto A")).json();
    const b = (await addProduct(app, project.id, "Produto B")).json();

    const quote = await createQuoteWithLines(app, project.id, [
      { projectProductId: a.id, quotedQuantity: "1000", unitPrice: "10" },
      { projectProductId: b.id, quotedQuantity: "500", unitPrice: "20" },
    ]);

    expect(quote.lines).toHaveLength(2);
    expect(quote.lines[0].total).toBe("10000.00");
    expect(quote.lines[1].total).toBe("10000.00");
    expect(quote.total).toBe("20000.00");

    await app.close();
  });

  it("sem preço em alguma linha, não existe total", async () => {
    // Somar o que está precificado e ignorar o resto entregaria um número
    // menor que a proposta, com cara de total.
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Com preço")).json();
    const b = (await addProduct(app, project.id, "Sem preço")).json();

    const quote = await createQuoteWithLines(app, project.id, [
      { projectProductId: a.id, quotedQuantity: "1000", unitPrice: "10" },
      { projectProductId: b.id, quotedQuantity: "500" },
    ]);

    expect(quote.lines[0].total).toBe("10000.00");
    expect(quote.lines[1].total).toBeNull();
    expect(quote.total).toBeNull();

    const send = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: {},
    });
    expect(send.statusCode).toBe(400);
    expect(send.json().error).toBe("incomplete_quote");

    await app.close();
  });

  it("a linha nasce com a unidade do produto — o sistema já sabe qual é", async () => {
    // Pedir que a pessoa digite a unidade que o cadastro já conhece é
    // atrito, e a linha sem unidade só denuncia o problema no envio.
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Produto com unidade")).json();

    const quote = await createQuoteWithLines(app, project.id, [{ projectProductId: a.id }]);

    expect(quote.lines[0].uomCode).toBe("un");

    await app.close();
  });

  it("recusa o mesmo produto duas vezes na proposta", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Produto repetido")).json();

    const quote = await createQuoteWithLines(app, project.id, [
      { projectProductId: a.id, quotedQuantity: "10", unitPrice: "1" },
    ]);
    const again = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: a.id },
    });

    expect(again.statusCode).toBe(409);

    await app.close();
  });

  it("recusa produto que não é do projeto", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const outro = await createProject(app, customer.id);
    const alheio = (await addProduct(app, outro.id, "Produto de outro projeto")).json();

    const quote = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    const response = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: alheio.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("product_not_in_project");

    await app.close();
  });

  it("linha só muda enquanto a proposta é rascunho", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Produto enviado")).json();
    const b = (await addProduct(app, project.id, "Produto extra")).json();

    const quote = await createQuoteWithLines(app, project.id, [
      { projectProductId: a.id, quotedQuantity: "100", unitPrice: "5" },
    ]);
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send`, payload: {} });

    const lineId = quote.lines[0].id;
    const edit = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${lineId}`,
      payload: { unitPrice: "9" },
    });
    const remove = await app.inject({ method: "DELETE", url: `/quote-lines/${lineId}` });
    const add = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: b.id },
    });

    // Proposta apresentada é história: renegociar cria versão nova.
    expect(edit.statusCode).toBe(409);
    expect(remove.statusCode).toBe(409);
    expect(add.statusCode).toBe(409);

    await app.close();
  });

  it("nova versão copia as linhas e nasce sem proveniência de precificação", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Produto A")).json();
    const b = (await addProduct(app, project.id, "Produto B")).json();

    const v1 = await createQuoteWithLines(app, project.id, [
      { projectProductId: a.id, quotedQuantity: "1000", unitPrice: "10" },
      { projectProductId: b.id, quotedQuantity: "500", unitPrice: "20" },
    ]);
    await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/send`, payload: {} });

    const v2 = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();

    expect(v2.status).toBe("DRAFT");
    expect(v2.lines).toHaveLength(2);
    expect(v2.lines[0].quotedQuantity).toBe("1000");
    expect(v2.lines[0].unitPrice).toBe("10.0000");
    // Herdar o vínculo afirmaria que este preço veio de um cálculo que
    // ninguém conferiu nesta versão.
    expect(v2.lines.every((line: { priceSource: string }) => line.priceSource === "MANUAL")).toBe(
      true,
    );

    await app.close();
  });
});

describe("Amostra e produto", () => {
  it("exige escolher o produto quando o projeto tem mais de um", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Sabor A")).json();
    await addProduct(app, project.id, "Sabor B");

    const semProduto = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/samples`,
      payload: { description: "Teste sem produto" },
    });
    expect(semProduto.statusCode).toBe(400);
    expect(semProduto.json().error).toBe("sample_product_required");

    const comProduto = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/samples`,
      payload: { projectProductId: a.id, description: "Teste do sabor A" },
    });
    expect(comProduto.statusCode).toBe(201);

    const prisma = getPrisma();
    const sample = await prisma.projectSample.findUniqueOrThrow({
      where: { id: comProduto.json().id },
    });
    expect(sample.projectProductId).toBe(a.id);
    // Tn continua sequencial por PROJETO, não por produto.
    expect(sample.testSequence).toBe(1);

    await app.close();
  });

  it("com um produto só, associa sozinho", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const unico = (await addProduct(app, project.id, "Produto único")).json();

    const created = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/samples`,
      payload: { description: "Sem ambiguidade" },
    });

    expect(created.statusCode).toBe(201);
    const prisma = getPrisma();
    const sample = await prisma.projectSample.findUniqueOrThrow({
      where: { id: created.json().id },
    });
    expect(sample.projectProductId).toBe(unico.id);

    await app.close();
  });
});

describe("Aprovação com escopo comercial", () => {
  it("promove só os produtos do orçamento aceito e tira os demais do escopo", async () => {
    // O cliente desenvolveu três sabores e fechou dois. O terceiro não vira
    // produto operacional por consequência indireta.
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const a = (await addProduct(app, project.id, "Aceito A")).json();
    const b = (await addProduct(app, project.id, "Aceito B")).json();
    const c = (await addProduct(app, project.id, "Fora do escopo C")).json();

    const quote = await createQuoteWithLines(app, project.id, [
      { projectProductId: a.id, quotedQuantity: "1000", unitPrice: "10" },
      { projectProductId: b.id, quotedQuantity: "500", unitPrice: "20" },
    ]);
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send`, payload: {} });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });

    const approved = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} })
    ).json();
    expect(approved.status).toBe("APPROVED");

    const links = await prisma.projectProduct.findMany({
      where: { projectId: project.id },
      include: { product: true },
      orderBy: { sequence: "asc" },
    });

    expect(links[0]!.status).toBe("APPROVED");
    expect(links[0]!.product.lifecycle).toBe("APPROVED");
    expect(links[1]!.status).toBe("APPROVED");
    expect(links[1]!.product.lifecycle).toBe("APPROVED");

    // Fora do escopo comercial, mas a história técnica fica inteira.
    expect(links[2]!.status).toBe("OUT_OF_SCOPE");
    expect(links[2]!.product.lifecycle).toBe("DEVELOPMENT");
    expect(links[2]!.productId).toBe(c.productId);
    expect(await prisma.product.count({ where: { id: c.productId } })).toBe(1);

    await app.close();
  });

  it("produto fora do escopo não entra em pedido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const customer = await createCustomer();
    const project = await createProject(app, customer.id);
    const aceito = (await addProduct(app, project.id, "Operacional")).json();
    const fora = (await addProduct(app, project.id, "Não aceito")).json();

    const quote = await createQuoteWithLines(app, project.id, [
      { projectProductId: aceito.id, quotedQuantity: "100", unitPrice: "5" },
    ]);
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send`, payload: {} });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });
    await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} });

    const order = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: [{ productId: fora.productId, orderedQuantity: "10", unitCode: "un" }],
      },
    });

    // O portão operacional continua sendo o ciclo de vida do produto.
    expect(order.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });
});
