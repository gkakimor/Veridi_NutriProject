import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * O contato do Cliente dentro do Projeto — PROJECT-CUSTOMER-CONTACT-01.
 *
 * Quem trabalha dentro de um Projeto precisa ligar para o cliente e saía da
 * tela para descobrir o número. O detalhe do Projeto passou a PROJETAR
 * telefone e e-mail do cadastro.
 *
 * A palavra é projetar, não copiar, e é isso que estes casos protegem: não
 * existe coluna de contato em `Project`, não existe snapshot e não existe
 * sincronização. Trocar o telefone no cadastro do Cliente muda o que o
 * Projeto responde na leitura seguinte — se um dia alguém "otimizar" isso
 * gravando o valor no Projeto, o caso da alteração reprova.
 *
 * O Customer inteiro já vem no `include` do detalhe, então nada disto custa
 * uma consulta a mais.
 */

const fixtureProjectIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

/** Cliente pela rota real — é ela que normaliza telefone e valida e-mail. */
async function criarCliente(app: App, contato: { phone?: string; email?: string } = {}) {
  const resposta = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Contato ${marker()}`, ...contato },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const cliente = resposta.json();
  fixtureCustomerIds.push(cliente.id);
  return cliente;
}

async function criarProjeto(app: App, customerId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { customerId, name: `Projeto Contato ${marker()}` },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const projeto = resposta.json();
  fixtureProjectIds.push(projeto.id);
  return projeto;
}

async function abrirProjeto(app: App, projectId: string) {
  const resposta = await app.inject({ method: "GET", url: `/projects/${projectId}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

describe("contato do Cliente no detalhe do Projeto", () => {
  it("o detalhe traz telefone e e-mail do cadastro atual", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const cliente = await criarCliente(app, {
      phone: "(15) 99999-8888",
      email: "contato@empresa.com.br",
    });
    const projeto = await criarProjeto(app, cliente.id);

    const detalhe = await abrirProjeto(app, projeto.id);
    // Guardado só com dígitos — a máscara é da tela, não da coluna.
    expect(detalhe.customerPhone).toBe("15999998888");
    expect(detalhe.customerEmail).toBe("contato@empresa.com.br");
    // O que já existia continua: identidade do Cliente e o link da tela.
    expect(detalhe.customerId).toBe(cliente.id);
    expect(detalhe.customerCode).toBe(cliente.code);
    expect(detalhe.customerName).toBe(cliente.legalName);
    await app.close();
  });

  it("alterar o Cliente muda o que o Projeto mostra — sem sincronizar nada", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const cliente = await criarCliente(app, {
      phone: "(15) 3333-4444",
      email: "antigo@empresa.com.br",
    });
    const projeto = await criarProjeto(app, cliente.id);

    expect((await abrirProjeto(app, projeto.id)).customerPhone).toBe("1533334444");

    const alteracao = await app.inject({
      method: "PATCH",
      url: `/customers/${cliente.id}`,
      payload: { phone: "(15) 98888-7777", email: "novo@empresa.com.br" },
    });
    expect(alteracao.statusCode, alteracao.body).toBe(200);

    // Nenhum job, nenhuma reindexação: a próxima leitura já é a nova.
    const depois = await abrirProjeto(app, projeto.id);
    expect(depois.customerPhone).toBe("15988887777");
    expect(depois.customerEmail).toBe("novo@empresa.com.br");
    await app.close();
  });

  it("Cliente sem telefone e sem e-mail: o Projeto abre, e os campos são nulos", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const cliente = await criarCliente(app);
    const projeto = await criarProjeto(app, cliente.id);

    const detalhe = await abrirProjeto(app, projeto.id);
    expect(detalhe.customerPhone).toBeNull();
    expect(detalhe.customerEmail).toBeNull();
    // Ausência não é erro: o campo não preenchido continua sendo um campo.
    expect(detalhe.customerName).toBe(cliente.legalName);
    await app.close();
  });

  it("a listagem de Projetos projeta o mesmo contato, do mesmo cadastro", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const cliente = await criarCliente(app, { phone: "(15) 97777-6666" });
    const projeto = await criarProjeto(app, cliente.id);

    const lista = await app.inject({
      method: "GET",
      url: `/projects?customerId=${cliente.id}`,
    });
    expect(lista.statusCode, lista.body).toBe(200);
    const linha = lista.json().projects.find((p: { id: string }) => p.id === projeto.id);
    expect(linha.customerPhone).toBe("15977776666");
    expect(linha.customerEmail).toBeNull();
    await app.close();
  });

  it("Project não guarda contato: a fonte é o Customer, e só ele", () => {
    const project = Prisma.dmmf.datamodel.models.find((model) => model.name === "Project");
    expect(project, "modelo Project não encontrado no schema").toBeTruthy();

    // Estrutural de propósito: um campo persistido em `Project` seria uma
    // segunda verdade sobre o mesmo fato, e a do Projeto envelheceria calada.
    const escalares = project!.fields
      .filter((field) => field.kind === "scalar")
      .map((field) => field.name);
    for (const proibido of ["customerPhone", "customerEmail", "customerContactName"]) {
      expect(escalares, `Project não pode persistir ${proibido}`).not.toContain(proibido);
    }
    // A única ligação com o Cliente continua sendo a chave estrangeira.
    expect(escalares).toContain("customerId");
    expect(escalares.filter((nome) => nome.startsWith("customer"))).toEqual(["customerId"]);
  });
});
