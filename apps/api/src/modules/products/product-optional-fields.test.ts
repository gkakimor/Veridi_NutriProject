import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Campo numérico opcional VAZIO é limpeza, não zero.
 *
 * `optionalPositiveInt` unia `z.coerce.number()` com o literal `""`, e a
 * coerção resolvia primeiro: `Number("")` é `0`, reprovado por "maior que
 * zero". Um produto criado pelo Projeto nasce sem Unidades por caixa, o
 * formulário devolvia o campo vazio como veio, e a partir dali NENHUM outro
 * campo do produto podia mais ser editado — o erro falava de um campo que o
 * usuário nem tinha tocado.
 */

const fixtureProductIds: string[] = [];

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarProdutoSemUnidadesPorCaixa(app: ReturnType<typeof buildTestApp>) {
  const criado = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto opcional ${marca()}` },
  });
  const product = criado.json();
  fixtureProductIds.push(product.id);
  expect(product.unitsPerShippingBox).toBeNull();
  return product;
}

describe("Produto — campos numéricos opcionais", () => {
  it("edita outro campo com Unidades por caixa nula, e ela continua nula", async () => {
    const app = buildTestApp();
    await app.ready();

    const product = await criarProdutoSemUnidadesPorCaixa(app);
    const atualizado = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { dosesPerPackage: 30 },
    });

    expect(atualizado.statusCode).toBe(200);
    expect(atualizado.json().dosesPerPackage).toBe(30);
    expect(atualizado.json().unitsPerShippingBox).toBeNull();

    await app.close();
  });

  it("o caso da auditoria: o formulário devolve o campo vazio como veio e a edição passa", async () => {
    const app = buildTestApp();
    await app.ready();

    const product = await criarProdutoSemUnidadesPorCaixa(app);
    const atualizado = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { name: `Renomeado ${marca()}`, unitsPerShippingBox: "" },
    });

    expect(atualizado.statusCode).toBe(200);
    expect(atualizado.json().unitsPerShippingBox).toBeNull();

    await app.close();
  });

  it("null limpa explicitamente", async () => {
    const app = buildTestApp();
    await app.ready();

    const product = await criarProdutoSemUnidadesPorCaixa(app);
    await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { unitsPerShippingBox: 60 },
    });
    const limpo = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { unitsPerShippingBox: null },
    });

    expect(limpo.statusCode).toBe(200);
    expect(limpo.json().unitsPerShippingBox).toBeNull();

    await app.close();
  });

  it("valor positivo grava", async () => {
    const app = buildTestApp();
    await app.ready();

    const product = await criarProdutoSemUnidadesPorCaixa(app);
    const atualizado = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { unitsPerShippingBox: 60 },
    });

    expect(atualizado.statusCode).toBe(200);
    expect(atualizado.json().unitsPerShippingBox).toBe(60);

    await app.close();
  });

  it("zero explícito continua inválido — não é 'não informado'", async () => {
    const app = buildTestApp();
    await app.ready();

    const product = await criarProdutoSemUnidadesPorCaixa(app);
    const recusado = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { unitsPerShippingBox: 0 },
    });

    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().error).toBe("validation_error");

    await app.close();
  });

  it("negativo e fracionário continuam inválidos", async () => {
    const app = buildTestApp();
    await app.ready();

    const product = await criarProdutoSemUnidadesPorCaixa(app);

    const negativo = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { unitsPerShippingBox: -5 },
    });
    expect(negativo.statusCode).toBe(400);

    const fracionario = await app.inject({
      method: "PATCH",
      url: `/products/${product.id}`,
      payload: { unitsPerShippingBox: 1.5 },
    });
    expect(fracionario.statusCode).toBe(400);
    expect(JSON.stringify(fracionario.json())).toContain("inteiro");

    await app.close();
  });
});
