import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Produto e seu Item de produto acabado.
 *
 * O que este arquivo protege é o vínculo: o produto nasce com o item, o item
 * é dele e de mais ninguém, e nenhuma falha no meio do caminho deixa um dos
 * dois sozinho. Antes eram dois cadastros manuais, e a base ficou com 54
 * itens de produto acabado sem produto nenhum apontando para eles.
 */

const createdProductIds: string[] = [];
const createdItemIds: string[] = [];

afterAll(async () => {
  const prisma = getPrisma();
  if (createdProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  if (createdItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  }
});

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createProduct(app: App, payload: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url: "/products", payload });
  if (response.statusCode === 201) {
    const body = response.json();
    createdProductIds.push(body.id);
    if (body.finishedProductItemId) createdItemIds.push(body.finishedProductItemId);
  }
  return response;
}

/** Item avulso, para os casos de vínculo explícito. */
async function createItem(type: "FINISHED_PRODUCT" | "RAW_MATERIAL") {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "FINISHED_PRODUCT" ? "PA" : "MP"}-VINC-${marker()}`,
      name: `Item de vínculo ${marker()}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  createdItemIds.push(item.id);
  return item;
}

describe("Produto — item de produto acabado automático", () => {
  it("cria o item junto com o produto, vinculado e do tipo certo", async () => {
    const app = buildTestApp();
    await app.ready();
    const customerId = await fixtureCustomerId();

    const response = await createProduct(app, {
      customerId,
      name: `Coenzima Q10 ${marker()}`,
      finishedUnitCode: "un",
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.customerId).toBe(customerId);
    expect(body.finishedProductItemId).not.toBeNull();
    // Código pela sequence oficial — nunca derivado do código do produto.
    expect(body.finishedProductItem.code).toMatch(/^PA-\d{6}$/);

    const item = await getPrisma().item.findUnique({
      where: { id: body.finishedProductItemId },
    });
    expect(item?.type).toBe("FINISHED_PRODUCT");
    expect(item?.unitCode).toBe("un");
    // Produto acabado da casa tem lote, validade e passa pela Qualidade.
    expect(item?.controlsLot).toBe(true);
    expect(item?.controlsExpiry).toBe(true);
    expect(item?.requiresQualityRelease).toBe(true);
    // Laudo não é padrão: exigir CoA sem ninguém ter pedido travaria a
    // liberação de todo lote produzido.
    expect(item?.requiresCoa).toBe(false);

    // Os controles viajam no resumo: a tela do produto responde "como o
    // estoque deste produto é controlado?" sem abrir o cadastro de Itens.
    expect(body.finishedProductItem).toMatchObject({
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
      requiresCoa: false,
    });

    await app.close();
  });

  it("liga a exigência de laudo quando o produto pede", async () => {
    const app = buildTestApp();
    await app.ready();
    const customerId = await fixtureCustomerId();

    const response = await createProduct(app, {
      customerId,
      name: `Vitamina D3 com laudo ${marker()}`,
      finishedUnitCode: "un",
      finishedRequiresCoa: true,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    const item = await getPrisma().item.findUnique({
      where: { id: body.finishedProductItemId },
    });
    expect(item?.requiresCoa).toBe(true);
    // Os outros três não mudam: são padrão da casa, e o formulário do
    // produto não os oferece.
    expect(item?.controlsLot).toBe(true);
    expect(item?.controlsExpiry).toBe(true);
    expect(item?.requiresQualityRelease).toBe(true);
    expect(body.finishedProductItem.requiresCoa).toBe(true);

    await app.close();
  });

  /*
   * Atomicidade. A unidade inexistente é recusada ANTES da transação, então
   * o teste prova o que interessa de verdade: nenhum item ficou para trás e
   * a sequence não foi consumida por um produto que não existe.
   */
  it("falha na criação não deixa item órfão", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    /*
     * Conta os itens DESTE nome, nao todos os `FINISHED_PRODUCT` do banco.
     *
     * A contagem global media o banco inteiro durante a janela do teste, entao
     * qualquer arquivo rodando em paralelo que criasse um produto acabado
     * reprovava este aqui — e, pior, um orfao real passaria despercebido se
     * outro teste apagasse um item no mesmo intervalo. O item acabado nasce com
     * o nome do produto, entao o nome unico e a chave exata do que este teste
     * afirma: a criacao que falhou nao deixou item para tras.
     */
    const nome = `Produto com unidade inválida ${marker()}`;
    const response = await createProduct(app, {
      customerId: await fixtureCustomerId(),
      name: nome,
      finishedUnitCode: "xyz",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("finished_unit_not_found");

    const orfaos = await prisma.item.count({ where: { type: "FINISHED_PRODUCT", name: nome } });
    expect(orfaos).toBe(0);

    await app.close();
  });

  it("atualizar o produto não cria um segundo item", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = (
      await createProduct(app, {
        customerId: await fixtureCustomerId(),
        name: `Produto para renomear ${marker()}`,
      })
    ).json();

    const updated = await app.inject({
      method: "PATCH",
      url: `/products/${created.id}`,
      payload: { name: `Renomeado ${marker()}` },
    });

    expect(updated.statusCode).toBe(200);
    // Mesmo item: renomear o produto não reescreve a identidade do estoque.
    expect(updated.json().finishedProductItemId).toBe(created.finishedProductItemId);
    expect(
      await getPrisma().product.count({
        where: { finishedProductItemId: created.finishedProductItemId },
      }),
    ).toBe(1);

    await app.close();
  });
});

describe("Produto — item de produto acabado explícito", () => {
  it("aceita item válido e livre", async () => {
    const app = buildTestApp();
    await app.ready();
    const item = await createItem("FINISHED_PRODUCT");

    const response = await createProduct(app, {
      customerId: await fixtureCustomerId(),
      name: `Produto com item explícito ${marker()}`,
      finishedProductItemId: item.id,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().finishedProductItemId).toBe(item.id);

    await app.close();
  });

  it("recusa item já usado por outro produto", async () => {
    const app = buildTestApp();
    await app.ready();
    const customerId = await fixtureCustomerId();
    const item = await createItem("FINISHED_PRODUCT");

    const primeiro = await createProduct(app, {
      customerId,
      name: `Primeiro dono ${marker()}`,
      finishedProductItemId: item.id,
    });
    expect(primeiro.statusCode).toBe(201);

    const segundo = await createProduct(app, {
      customerId,
      name: `Segundo dono ${marker()}`,
      finishedProductItemId: item.id,
    });
    expect(segundo.statusCode).toBe(400);
    expect(segundo.json().error).toBe("duplicate_finished_item");

    await app.close();
  });

  it("recusa item que não é produto acabado", async () => {
    const app = buildTestApp();
    await app.ready();
    const materiaPrima = await createItem("RAW_MATERIAL");

    const response = await createProduct(app, {
      customerId: await fixtureCustomerId(),
      name: `Produto com matéria-prima ${marker()}`,
      finishedProductItemId: materiaPrima.id,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_item_type");

    await app.close();
  });
});

describe("Produto — cliente", () => {
  it("recusa produto sem cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Sem dono ${marker()}` },
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  /*
   * O caso que a regra existe para impedir: mover um produto já usado para
   * outro cliente reescreveria, sem deixar rastro, de quem era o histórico.
   */
  it("produto em uso não muda de cliente", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();
    const customerId = await fixtureCustomerId();

    const produto = (
      await createProduct(app, { customerId, name: `Produto em uso ${marker()}` })
    ).json();

    const outroCliente = await prisma.customer.create({
      data: { code: `CLI-MOVE-${marker()}`, legalName: `Outro dono ${marker()}`, active: true },
    });

    // Sem uso ainda: corrigir um cliente escolhido errado é legítimo.
    const livre = await app.inject({
      method: "PATCH",
      url: `/products/${produto.id}`,
      payload: { customerId: outroCliente.id },
    });
    expect(livre.statusCode).toBe(200);

    // Passa a existir uma ordem de produção com este produto.
    await prisma.productionOrder.create({
      data: {
        code: `OP-MOVE-${marker()}`,
        productId: produto.id,
        productCode: produto.code,
        productName: produto.name,
        plannedQuantity: "1",
        outputUnitCode: "un",
        status: "DRAFT",
      },
    });

    const bloqueado = await app.inject({
      method: "PATCH",
      url: `/products/${produto.id}`,
      payload: { customerId },
    });
    expect(bloqueado.statusCode).toBe(409);
    expect(bloqueado.json().error).toBe("product_customer_locked");

    await prisma.productionOrder.deleteMany({ where: { productId: produto.id } });
    await prisma.customer.delete({ where: { id: outroCliente.id } });
    await app.close();
  });
});

describe("Produto — nascido de projeto", () => {
  it("herda o cliente do projeto e ganha item próprio", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();
    const customerId = await fixtureCustomerId();

    const projeto = (
      await app.inject({
        method: "POST",
        url: "/projects",
        payload: { customerId, name: `Projeto do produto ${marker()}` },
      })
    ).json();

    const preparado = (
      await app.inject({
        method: "POST",
        url: `/projects/${projeto.id}/technical-product`,
        payload: { finishedUnitCode: "un" },
      })
    ).json();

    const produto = await prisma.product.findUnique({
      where: { id: preparado.productId },
      include: { finishedProductItem: true },
    });
    createdProductIds.push(produto!.id);
    if (produto?.finishedProductItemId) createdItemIds.push(produto.finishedProductItemId);

    // Cliente vem do projeto — sem segunda escolha, sem chance de divergir.
    expect(produto?.customerId).toBe(customerId);
    expect(produto?.finishedProductItem?.type).toBe("FINISHED_PRODUCT");
    expect(produto?.finishedProductItem?.code).toMatch(/^PA-\d{6}$/);

    await prisma.projectStatusHistory.deleteMany({ where: { projectId: projeto.id } });
    await prisma.project.deleteMany({ where: { id: projeto.id } });
    await app.close();
  });
});
