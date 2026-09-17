import { afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../db/prisma.js";
import { buildTestApp } from "../test-support/authenticated-app.js";
import { cadastroComOMesmoNome, exigirNomeDeCadastroLivre } from "./nome-de-cadastro-mestre.js";

/**
 * Guarda de nome duplicado nos cadastros mestre
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * A API é a autoridade: o teste bate nas rotas, não no service. Cada caso
 * cobre a criação e o renome, porque as duas portas gravam o mesmo nome.
 */

const criados = {
  fornecedores: [] as string[],
  clientes: [] as string[],
  recursos: [] as string[],
  itens: [] as string[],
  produtos: [] as string[],
  perfis: [] as string[],
};

afterEach(async () => {
  const prisma = getPrisma();
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.productionProfile.deleteMany({ where: { id: { in: criados.perfis } } });
  await prisma.industrialResource.deleteMany({ where: { id: { in: criados.recursos } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  for (const chave of Object.keys(criados) as (keyof typeof criados)[]) criados[chave] = [];
});

const marca = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("POST — criar cadastro com nome que já existe", () => {
  it("Fornecedor: só a caixa diferente é recusa 409 com o código existente", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Fornecedor ${marca()}`;

    const primeiro = await app.inject({ method: "POST", url: "/suppliers", payload: { legalName: nome } });
    expect(primeiro.statusCode).toBe(201);
    criados.fornecedores.push(primeiro.json().id);

    const segundo = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: nome.toUpperCase() },
    });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json()).toMatchObject({
      error: "duplicate_name",
      message: `Já existe um cadastro com este nome: Fornecedor ${primeiro.json().code}.`,
      existingCode: primeiro.json().code,
    });

    await app.close();
  });

  it("Fornecedor: espaço nas pontas também é o mesmo nome", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Fornecedor ${marca()}`;

    const primeiro = await app.inject({ method: "POST", url: "/suppliers", payload: { legalName: nome } });
    criados.fornecedores.push(primeiro.json().id);

    const segundo = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `  ${nome} ` },
    });
    expect(segundo.statusCode).toBe(409);

    await app.close();
  });

  it("Fornecedor: acento diferente PASSA — a regra preserva acento", async () => {
    const app = buildTestApp();
    await app.ready();
    const sufixo = marca();

    const comAcento = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `Química ${sufixo}` },
    });
    expect(comAcento.statusCode).toBe(201);
    criados.fornecedores.push(comAcento.json().id);

    const semAcento = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `Quimica ${sufixo}` },
    });
    expect(semAcento.statusCode).toBe(201);
    criados.fornecedores.push(semAcento.json().id);

    await app.close();
  });

  it("Cliente: razão social repetida é recusa", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Cliente ${marca()}`;

    const primeiro = await app.inject({ method: "POST", url: "/customers", payload: { legalName: nome } });
    expect(primeiro.statusCode).toBe(201);
    criados.clientes.push(primeiro.json().id);

    const segundo = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName: nome.toLowerCase() },
    });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().message).toMatch(/^Já existe um cadastro com este nome: Cliente CLI-/);

    await app.close();
  });

  it("Item: os QUATRO tipos dividem o mesmo espaço de nomes", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Insumo ${marca()}`;

    const primeiro = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: nome, unitCode: "kg" },
    });
    expect(primeiro.statusCode).toBe(201);
    criados.itens.push(primeiro.json().id);

    const mesmoTipo = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: nome.toUpperCase(), unitCode: "kg" },
    });
    expect(mesmoTipo.statusCode).toBe(409);
    expect(mesmoTipo.json().error).toBe("duplicate_name");

    // Decisão do PO (2026-09-17): o cadastro é Item, não "Item de
    // matéria-prima". RAW_MATERIAL, PACKAGING, FINISHED_PRODUCT e
    // INTERNAL_CONSUMABLE dividem UM espaço de nomes, e é sobre a tabela
    // inteira que o índice de MASTER-DATA-NAME-UNIQUENESS-01 vai nascer.
    for (const type of ["PACKAGING", "FINISHED_PRODUCT", "INTERNAL_CONSUMABLE"]) {
      const outroTipo = await app.inject({
        method: "POST",
        url: "/items",
        payload: { type, name: nome.toLowerCase(), unitCode: "un" },
      });
      expect(outroTipo.statusCode, `${type}: ${outroTipo.body}`).toBe(409);
      expect(outroTipo.json().error).toBe("duplicate_name");
    }

    await app.close();
  });

  it("Recurso industrial: nome repetido é recusa", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Recurso ${marca()}`;
    const payload = { name: nome, type: "EQUIPMENT", defaultUsageUom: "HOUR" };

    const primeiro = await app.inject({ method: "POST", url: "/industrial-resources", payload });
    expect(primeiro.statusCode).toBe(201);
    criados.recursos.push(primeiro.json().id);

    const segundo = await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { ...payload, name: nome.toUpperCase() },
    });
    expect(segundo.statusCode).toBe(409);

    await app.close();
  });

  it("Perfil de produção: nome repetido é recusa e não consome código", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Perfil ${marca()}`;

    const primeiro = await app.inject({ method: "POST", url: "/production-profiles", payload: { name: nome } });
    expect(primeiro.statusCode).toBe(201);
    criados.perfis.push(primeiro.json().id);

    const segundo = await app.inject({
      method: "POST",
      url: "/production-profiles",
      payload: { name: nome.toUpperCase() },
    });
    expect(segundo.statusCode).toBe(409);

    await app.close();
  });
});

describe("PATCH — renomear para um nome que já existe", () => {
  it("Fornecedor: renomear para o nome de outro é recusa", async () => {
    const app = buildTestApp();
    await app.ready();
    const ocupado = `Fornecedor ${marca()}`;

    const dono = await app.inject({ method: "POST", url: "/suppliers", payload: { legalName: ocupado } });
    criados.fornecedores.push(dono.json().id);
    const outro = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `Fornecedor ${marca()}` },
    });
    criados.fornecedores.push(outro.json().id);

    const renomeado = await app.inject({
      method: "PATCH",
      url: `/suppliers/${outro.json().id}`,
      payload: { legalName: ocupado.toUpperCase() },
    });
    expect(renomeado.statusCode).toBe(409);
    expect(renomeado.json().existingCode).toBe(dono.json().code);

    await app.close();
  });

  it("trocar a CAIXA do próprio nome é permitido — é o mesmo cadastro", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Fornecedor ${marca()}`;

    const criado = await app.inject({ method: "POST", url: "/suppliers", payload: { legalName: nome } });
    criados.fornecedores.push(criado.json().id);

    const renomeado = await app.inject({
      method: "PATCH",
      url: `/suppliers/${criado.json().id}`,
      payload: { legalName: nome.toUpperCase() },
    });
    expect(renomeado.statusCode).toBe(200);
    expect(renomeado.json().legalName).toBe(nome.toUpperCase());

    await app.close();
  });

  it("PATCH sem mexer no nome não é barrado pelo próprio nome", async () => {
    const app = buildTestApp();
    await app.ready();

    const criado = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `Fornecedor ${marca()}` },
    });
    criados.fornecedores.push(criado.json().id);

    const patched = await app.inject({
      method: "PATCH",
      url: `/suppliers/${criado.json().id}`,
      payload: { email: "contato@exemplo.com" },
    });
    expect(patched.statusCode).toBe(200);

    await app.close();
  });

  it("Item: renomear para o nome de outro Item é recusa", async () => {
    const app = buildTestApp();
    await app.ready();
    const ocupado = `Insumo ${marca()}`;

    const dono = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: ocupado, unitCode: "kg" },
    });
    criados.itens.push(dono.json().id);
    const outro = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: `Insumo ${marca()}`, unitCode: "kg" },
    });
    criados.itens.push(outro.json().id);

    const renomeado = await app.inject({
      method: "PATCH",
      url: `/items/${outro.json().id}`,
      payload: { name: `  ${ocupado.toLowerCase()} ` },
    });
    expect(renomeado.statusCode).toBe(409);

    await app.close();
  });
});

describe("Produto e o Item de produto acabado que nasce com ele", () => {
  /** Produto exige Cliente na criação. */
  async function criarCliente(app: ReturnType<typeof buildTestApp>): Promise<string> {
    const cliente = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName: `Cliente do produto ${marca()}` },
    });
    criados.clientes.push(cliente.json().id);
    return cliente.json().id;
  }

  it("Produto com nome repetido é recusa", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Produto ${marca()}`;
    const customerId = await criarCliente(app);

    const primeiro = await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: nome, customerId, finishedUnitCode: "un" },
    });
    expect(primeiro.statusCode).toBe(201);
    criados.produtos.push(primeiro.json().id);
    if (primeiro.json().finishedProductItemId) criados.itens.push(primeiro.json().finishedProductItemId);

    const segundo = await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: nome.toUpperCase(), customerId, finishedUnitCode: "un" },
    });
    expect(segundo.statusCode).toBe(409);

    await app.close();
  });

  it("Produto cujo PA colidiria com um Item existente é recusado — o nome é do catálogo de Itens", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Colágeno ${marca()}`;
    const customerId = await criarCliente(app);

    const item = await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: nome, unitCode: "kg" },
    });
    expect(item.statusCode).toBe(201);
    criados.itens.push(item.json().id);

    const produto = await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: nome, customerId, finishedUnitCode: "un" },
    });
    expect(produto.statusCode).toBe(409);
    expect(produto.json().existingCode).toBe(item.json().code);

    await app.close();
  });
});

describe("a função do guarda", () => {
  it("acha o cadastro existente sem caixa e sem espaço nas pontas", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Fornecedor ${marca()}`;
    const criado = await app.inject({ method: "POST", url: "/suppliers", payload: { legalName: nome } });
    criados.fornecedores.push(criado.json().id);

    expect(await cadastroComOMesmoNome("SUPPLIER", `  ${nome.toUpperCase()}  `)).toBe(criado.json().code);
    expect(await cadastroComOMesmoNome("SUPPLIER", nome, criado.json().id)).toBeNull();
    expect(await cadastroComOMesmoNome("SUPPLIER", `${nome} outro`)).toBeNull();

    await app.close();
  });

  it("não trata o nome como padrão de busca: % e _ são literais", async () => {
    const app = buildTestApp();
    await app.ready();
    const criado = await app.inject({
      method: "POST",
      url: "/suppliers",
      payload: { legalName: `Fornecedor ${marca()}` },
    });
    criados.fornecedores.push(criado.json().id);

    // Com `ILIKE`, "%" casaria com qualquer nome e a recusa seria geral.
    expect(await cadastroComOMesmoNome("SUPPLIER", "%")).toBeNull();
    expect(await cadastroComOMesmoNome("SUPPLIER", "_".repeat(40))).toBeNull();
    await expect(exigirNomeDeCadastroLivre("SUPPLIER", "%")).resolves.toBeUndefined();

    await app.close();
  });
});
