import type { CadastroMestre } from "@veridi/shared";
import { afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../db/prisma.js";
import { buildTestApp } from "../test-support/authenticated-app.js";
import {
  cadastroComOMesmoNome,
  exigirNomeDeCadastroLivre,
  mantemONomeGravado,
} from "./nome-de-cadastro-mestre.js";

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
  modelosDeFormulacao: [] as string[],
  modelosDeCusto: [] as string[],
  politicasDePreco: [] as string[],
};

afterEach(async () => {
  const prisma = getPrisma();
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.productionProfile.deleteMany({ where: { id: { in: criados.perfis } } });
  await prisma.industrialResource.deleteMany({ where: { id: { in: criados.recursos } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await prisma.formulationTemplate.deleteMany({ where: { id: { in: criados.modelosDeFormulacao } } });
  await prisma.industrialCostTemplate.deleteMany({ where: { id: { in: criados.modelosDeCusto } } });
  await prisma.pricingPolicyTemplate.deleteMany({ where: { id: { in: criados.politicasDePreco } } });
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

/**
 * Cadastro que JÁ nasceu duplicado (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01).
 *
 * PROD tem 21 grupos / 45 Itens com o mesmo nome, anteriores ao guarda, e o
 * formulário do Item manda `name` em todo Salvar. O guarda impede duplicidade
 * NOVA — criar, ou renomear para o nome de outro — e não prende a que já
 * existe. A API recusa criar o par hoje, então ele nasce aqui como nasceu lá:
 * dois cadastros pela API e o nome do segundo igualado por baixo dela.
 */

type App = ReturnType<typeof buildTestApp>;
type Resposta = { statusCode: number; body: string };
type Criado = { id: string; code: string; finishedProductItemId?: string | null };

interface CasoDeCadastro {
  cadastro: CadastroMestre;
  rota: string;
  campoDoNome: "name" | "legalName";
  /** O POST da tela, sem julgar a resposta. */
  tentarCriar: (app: App, nome: string) => Promise<Resposta>;
  /** Para onde vai o id do que o POST criou — e do que nasce junto. */
  guardar: (criado: Criado) => void;
  /** Um campo qualquer que o mesmo Salvar grava junto com o nome. */
  outroCampo: string;
  ler: (id: string) => Promise<{ nome: string; outro: string | null } | null>;
  /** Iguala o nome por baixo da API: é assim que a duplicata de PROD existe. */
  gravarNomeLegado: (id: string, nome: string) => Promise<unknown>;
}

const post = (app: App, url: string, payload: Record<string, unknown>): Promise<Resposta> =>
  app.inject({ method: "POST", url, payload });

const CASOS: CasoDeCadastro[] = [
  {
    cadastro: "ITEM",
    rota: "/items",
    campoDoNome: "name",
    tentarCriar: (app, nome) => post(app, "/items", { type: "RAW_MATERIAL", name: nome, unitCode: "kg" }),
    guardar: ({ id }) => criados.itens.push(id),
    outroCampo: "sourceName",
    ler: async (id) => {
      const item = await getPrisma().item.findUnique({ where: { id } });
      return item && { nome: item.name, outro: item.sourceName };
    },
    gravarNomeLegado: (id, nome) => getPrisma().item.update({ where: { id }, data: { name: nome } }),
  },
  {
    cadastro: "CUSTOMER",
    rota: "/customers",
    campoDoNome: "legalName",
    tentarCriar: (app, nome) => post(app, "/customers", { legalName: nome }),
    guardar: ({ id }) => criados.clientes.push(id),
    outroCampo: "tradeName",
    ler: async (id) => {
      const cliente = await getPrisma().customer.findUnique({ where: { id } });
      return cliente && { nome: cliente.legalName, outro: cliente.tradeName };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().customer.update({ where: { id }, data: { legalName: nome } }),
  },
  {
    cadastro: "SUPPLIER",
    rota: "/suppliers",
    campoDoNome: "legalName",
    tentarCriar: (app, nome) => post(app, "/suppliers", { legalName: nome }),
    guardar: ({ id }) => criados.fornecedores.push(id),
    outroCampo: "tradeName",
    ler: async (id) => {
      const fornecedor = await getPrisma().supplier.findUnique({ where: { id } });
      return fornecedor && { nome: fornecedor.legalName, outro: fornecedor.tradeName };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().supplier.update({ where: { id }, data: { legalName: nome } }),
  },
  {
    cadastro: "PRODUCT",
    rota: "/products",
    campoDoNome: "name",
    tentarCriar: async (app, nome) => {
      // Produto exige Cliente, e nasce com o seu Item de produto acabado.
      const cliente = await post(app, "/customers", { legalName: `Cliente do produto ${marca()}` });
      expect(cliente.statusCode, cliente.body).toBe(201);
      const customerId = (JSON.parse(cliente.body) as Criado).id;
      criados.clientes.push(customerId);
      return post(app, "/products", { name: nome, customerId, finishedUnitCode: "un" });
    },
    guardar: ({ id, finishedProductItemId }) => {
      criados.produtos.push(id);
      if (finishedProductItemId) criados.itens.push(finishedProductItemId);
    },
    outroCampo: "notes",
    ler: async (id) => {
      const produto = await getPrisma().product.findUnique({ where: { id } });
      return produto && { nome: produto.name, outro: produto.notes };
    },
    gravarNomeLegado: (id, nome) => getPrisma().product.update({ where: { id }, data: { name: nome } }),
  },
  {
    cadastro: "INDUSTRIAL_RESOURCE",
    rota: "/industrial-resources",
    campoDoNome: "name",
    tentarCriar: (app, nome) =>
      post(app, "/industrial-resources", { name: nome, type: "EQUIPMENT", defaultUsageUom: "HOUR" }),
    guardar: ({ id }) => criados.recursos.push(id),
    outroCampo: "description",
    ler: async (id) => {
      const recurso = await getPrisma().industrialResource.findUnique({ where: { id } });
      return recurso && { nome: recurso.name, outro: recurso.description };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().industrialResource.update({ where: { id }, data: { name: nome } }),
  },
  {
    cadastro: "FORMULATION_TEMPLATE",
    rota: "/formulation-templates",
    campoDoNome: "name",
    tentarCriar: (app, nome) => post(app, "/formulation-templates", { name: nome }),
    guardar: ({ id }) => criados.modelosDeFormulacao.push(id),
    outroCampo: "description",
    ler: async (id) => {
      const modelo = await getPrisma().formulationTemplate.findUnique({ where: { id } });
      return modelo && { nome: modelo.name, outro: modelo.description };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().formulationTemplate.update({ where: { id }, data: { name: nome } }),
  },
  {
    cadastro: "INDUSTRIAL_COST_TEMPLATE",
    rota: "/cost-templates",
    campoDoNome: "name",
    tentarCriar: (app, nome) => post(app, "/cost-templates", { name: nome }),
    guardar: ({ id }) => criados.modelosDeCusto.push(id),
    outroCampo: "description",
    ler: async (id) => {
      const modelo = await getPrisma().industrialCostTemplate.findUnique({ where: { id } });
      return modelo && { nome: modelo.name, outro: modelo.description };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().industrialCostTemplate.update({ where: { id }, data: { name: nome } }),
  },
  {
    cadastro: "PRICING_POLICY_TEMPLATE",
    rota: "/pricing-policies",
    campoDoNome: "name",
    tentarCriar: (app, nome) => post(app, "/pricing-policies", { name: nome }),
    guardar: ({ id }) => criados.politicasDePreco.push(id),
    outroCampo: "description",
    ler: async (id) => {
      const politica = await getPrisma().pricingPolicyTemplate.findUnique({ where: { id } });
      return politica && { nome: politica.name, outro: politica.description };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().pricingPolicyTemplate.update({ where: { id }, data: { name: nome } }),
  },
  {
    cadastro: "PRODUCTION_PROFILE",
    rota: "/production-profiles",
    campoDoNome: "name",
    tentarCriar: (app, nome) => post(app, "/production-profiles", { name: nome }),
    guardar: ({ id }) => criados.perfis.push(id),
    outroCampo: "description",
    ler: async (id) => {
      const perfil = await getPrisma().productionProfile.findUnique({ where: { id } });
      return perfil && { nome: perfil.name, outro: perfil.description };
    },
    gravarNomeLegado: (id, nome) =>
      getPrisma().productionProfile.update({ where: { id }, data: { name: nome } }),
  },
];

/** Cria pela API e guarda para a limpeza; o POST tem de passar. */
async function criar(app: App, caso: CasoDeCadastro, nome: string): Promise<Criado> {
  const resposta = await caso.tentarCriar(app, nome);
  expect(resposta.statusCode, `POST ${caso.rota}: ${resposta.body}`).toBe(201);
  const criado = JSON.parse(resposta.body) as Criado;
  caso.guardar(criado);
  return criado;
}

/** A e B com o mesmo nome efetivo, como os grupos de PROD. */
async function parLegado(
  app: App,
  caso: CasoDeCadastro,
  nomeDeA: string,
  nomeDeB: string = nomeDeA,
): Promise<{ a: Criado; b: Criado }> {
  const a = await criar(app, caso, nomeDeA);
  const b = await criar(app, caso, `${nomeDeA} provisório`);
  await caso.gravarNomeLegado(b.id, nomeDeB);
  // A premissa do teste: para o guarda, B já usa o nome de A.
  expect(await cadastroComOMesmoNome(caso.cadastro, nomeDeA, a.id)).toBe(b.code);
  return { a, b };
}

describe.each(CASOS)("$cadastro que já nasceu duplicado", (caso) => {
  const patch = (app: App, id: string, payload: Record<string, unknown>): Promise<Resposta> =>
    app.inject({ method: "PATCH", url: `${caso.rota}/${id}`, payload });

  it("par duplicado existente + PATCH com o MESMO nome e outro campo: salva", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Legado ${marca()}`;
    const { a } = await parLegado(app, caso, nome);
    const valor = `Outro campo ${marca()}`;

    const salvo = await patch(app, a.id, { [caso.campoDoNome]: nome, [caso.outroCampo]: valor });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(await caso.ler(a.id)).toEqual({ nome, outro: valor });

    await app.close();
  });

  it("PATCH sem o nome: salva", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Legado ${marca()}`;
    const { a } = await parLegado(app, caso, nome);
    const valor = `Outro campo ${marca()}`;

    const salvo = await patch(app, a.id, { [caso.outroCampo]: valor });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(await caso.ler(a.id)).toEqual({ nome, outro: valor });

    await app.close();
  });

  it("o mesmo nome com OUTRA CAIXA não é renome: salva", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Legado ${marca()}`;
    const { a } = await parLegado(app, caso, nome);

    const salvo = await patch(app, a.id, { [caso.campoDoNome]: nome.toUpperCase() });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect((await caso.ler(a.id))?.nome).toBe(nome.toUpperCase());

    await app.close();
  });

  it("o mesmo nome com ESPAÇO NAS PONTAS não é renome: salva", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Legado ${marca()}`;
    const { a } = await parLegado(app, caso, nome);
    // O gravado também pode ter o espaço que a carga trouxe: `btrim` dos dois lados.
    await caso.gravarNomeLegado(a.id, ` ${nome}  `);

    const salvo = await patch(app, a.id, { [caso.campoDoNome]: `  ${nome} ` });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect((await caso.ler(a.id))?.nome).toBe(nome);

    await app.close();
  });

  it("renomear para o nome de OUTRO cadastro: 409 com o código dele", async () => {
    const app = buildTestApp();
    await app.ready();
    const { a } = await parLegado(app, caso, `Legado ${marca()}`);
    const ocupado = `Ocupado ${marca()}`;
    const dono = await criar(app, caso, ocupado);

    const recusado = await patch(app, a.id, { [caso.campoDoNome]: ` ${ocupado.toLowerCase()} ` });
    expect(recusado.statusCode, recusado.body).toBe(409);
    expect(JSON.parse(recusado.body)).toMatchObject({
      error: "duplicate_name",
      existingCode: dono.code,
    });

    await app.close();
  });

  it("renomear para um nome livre: salva — é assim que o par se desfaz", async () => {
    const app = buildTestApp();
    await app.ready();
    const { a } = await parLegado(app, caso, `Legado ${marca()}`);
    const livre = `Livre ${marca()}`;

    const salvo = await patch(app, a.id, { [caso.campoDoNome]: livre });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect((await caso.ler(a.id))?.nome).toBe(livre);

    await app.close();
  });

  it("criar um terceiro com o nome do par: 409 — a criação confere sempre", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Legado ${marca()}`;
    await parLegado(app, caso, nome);

    const terceiro = await caso.tentarCriar(app, nome.toUpperCase());
    if (terceiro.statusCode === 201) caso.guardar(JSON.parse(terceiro.body) as Criado);
    expect(terceiro.statusCode, terceiro.body).toBe(409);
    expect(JSON.parse(terceiro.body).error).toBe("duplicate_name");

    await app.close();
  });
});

describe("Item: o caso do preflight de PROD", () => {
  const ITEM = CASOS.find((caso) => caso.cadastro === "ITEM")!;
  const criarItem = async (app: App, type: string, nome: string): Promise<Criado> => {
    const unitCode = type === "RAW_MATERIAL" ? "kg" : "un";
    const resposta = await post(app, "/items", { type, name: nome, unitCode });
    expect(resposta.statusCode, `${type}: ${resposta.body}`).toBe(201);
    const criado = JSON.parse(resposta.body) as Criado;
    criados.itens.push(criado.id);
    return criado;
  };

  it("Item A e Item B com o mesmo nome: A salva com o próprio nome e não entra no nome de um terceiro", async () => {
    const app = buildTestApp();
    await app.ready();
    const x = `Vitamina C ${marca()}`;
    // O par de PROD não é idêntico byte a byte: a caixa já difere.
    const { a, b } = await parLegado(app, ITEM, x, x.toUpperCase());

    const mesmoNome = await app.inject({
      method: "PATCH",
      url: `/items/${a.id}`,
      payload: { name: ` ${x.toLowerCase()} `, sourceName: "Ácido ascórbico" },
    });
    expect(mesmoNome.statusCode, mesmoNome.body).toBe(200);
    expect(await ITEM.ler(a.id)).toEqual({ nome: x.toLowerCase(), outro: "Ácido ascórbico" });
    // O par continua: a edição não fundiu, não renomeou nem inativou o outro.
    expect(await ITEM.ler(b.id)).toEqual({ nome: x.toUpperCase(), outro: null });

    const y = `Vitamina D ${marca()}`;
    const itemY = await criar(app, ITEM, y);
    const renome = await app.inject({ method: "PATCH", url: `/items/${a.id}`, payload: { name: y } });
    expect(renome.statusCode, renome.body).toBe(409);
    expect(JSON.parse(renome.body)).toMatchObject({ error: "duplicate_name", existingCode: itemY.code });

    await app.close();
  });

  it("acento diferente continua sendo outro nome: é renome, e o renome confere", async () => {
    const app = buildTestApp();
    await app.ready();
    const sufixo = marca();
    const comAcento = `Ácido cítrico ${sufixo}`;
    const { a } = await parLegado(app, ITEM, comAcento);
    // Criar sem acento passa: pela regra, é outro nome.
    const semAcento = await criar(app, ITEM, `Acido citrico ${sufixo}`);

    const renome = await app.inject({
      method: "PATCH",
      url: `/items/${a.id}`,
      payload: { name: `Acido citrico ${sufixo}` },
    });
    expect(renome.statusCode, renome.body).toBe(409);
    expect(JSON.parse(renome.body).existingCode).toBe(semAcento.code);

    const mesmoNome = await app.inject({
      method: "PATCH",
      url: `/items/${a.id}`,
      payload: { name: comAcento },
    });
    expect(mesmoNome.statusCode, mesmoNome.body).toBe(200);

    await app.close();
  });

  it("o par pode atravessar tipos (MP × ME), e o espaço de nomes MP/ME/PA/UC continua um só", async () => {
    const app = buildTestApp();
    await app.ready();
    const nome = `Tampa ${marca()}`;
    const mp = await criarItem(app, "RAW_MATERIAL", nome);
    const me = await criarItem(app, "PACKAGING", `${nome} provisório`);
    await ITEM.gravarNomeLegado(me.id, nome.toLowerCase());

    for (const { id } of [mp, me]) {
      const salvo = await app.inject({ method: "PATCH", url: `/items/${id}`, payload: { name: nome } });
      expect(salvo.statusCode, salvo.body).toBe(200);
    }

    // Uso e consumo entrando no nome do par é renome de verdade.
    const uc = await criarItem(app, "INTERNAL_CONSUMABLE", `Uso ${marca()}`);
    const renome = await app.inject({
      method: "PATCH",
      url: `/items/${uc.id}`,
      payload: { name: nome.toUpperCase() },
    });
    expect(renome.statusCode, renome.body).toBe(409);
    expect([mp.code, me.code]).toContain(JSON.parse(renome.body).existingCode);

    // Produto acabado novo com o nome do par: a criação confere sempre.
    const pa = await post(app, "/items", { type: "FINISHED_PRODUCT", name: nome, unitCode: "un" });
    if (pa.statusCode === 201) criados.itens.push((JSON.parse(pa.body) as Criado).id);
    expect(pa.statusCode, pa.body).toBe(409);

    await app.close();
  });
});

describe("a função do guarda na edição", () => {
  type Executor = NonNullable<Parameters<typeof exigirNomeDeCadastroLivre>[3]>;
  /** Um executor que só anota o SQL e responde o que o teste mandar. */
  const executorQueAnota = (resposta: unknown[]) => {
    const consultas: string[] = [];
    const db = {
      $queryRawUnsafe: async (sql: string) => {
        consultas.push(sql);
        return resposta;
      },
    } as unknown as Executor;
    return { db, consultas };
  };

  it("nome efetivo igual ao gravado: a busca de conflito nem roda", async () => {
    const { db, consultas } = executorQueAnota([{ mesmo: true }]);

    await expect(exigirNomeDeCadastroLivre("ITEM", "Vitamina C", "id-em-edicao", db)).resolves.toBeUndefined();
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain("AS mesmo");
  });

  it("criação não pergunta pelo gravado: vai direto à busca", async () => {
    const { db, consultas } = executorQueAnota([]);

    await exigirNomeDeCadastroLivre("ITEM", "Vitamina C", undefined, db);
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain("AS codigo");
  });

  it("mantemONomeGravado: caixa e espaço nas pontas mantêm; acento e outro texto mudam", async () => {
    const app = buildTestApp();
    await app.ready();
    const sufixo = marca();
    const criado = await criar(app, CASOS.find((caso) => caso.cadastro === "SUPPLIER")!, `Química ${sufixo}`);

    expect(await mantemONomeGravado("SUPPLIER", criado.id, `  Química ${sufixo.toUpperCase()} `)).toBe(true);
    expect(await mantemONomeGravado("SUPPLIER", criado.id, `Quimica ${sufixo}`)).toBe(false);
    expect(await mantemONomeGravado("SUPPLIER", criado.id, `Química ${sufixo} Ltda`)).toBe(false);
    expect(await mantemONomeGravado("SUPPLIER", "00000000-0000-0000-0000-000000000000", `Química ${sufixo}`)).toBe(
      false,
    );

    await app.close();
  });
});
