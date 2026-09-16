import { afterAll, describe, expect, it } from "vitest";
import type { Customer, UserRole } from "@prisma/client";
import type {
  CreateCustomerInput as ContratoDeCriacao,
  UpdateCustomerInput as ContratoDeAlteracao,
} from "@veridi/shared";
import { CUSTOMER_EDIT_ROLES, CUSTOMER_STATUS_CHANGE_ROLES, USER_ROLES } from "@veridi/shared";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { uniqueCnpj } from "../../test-support/br-documents.js";
import { getPrisma } from "../../db/prisma.js";
import type {
  CreateCustomerInput as CorpoDeCriacao,
  UpdateCustomerInput as CorpoDeAlteracao,
} from "./customers.schemas.js";

/**
 * Quem cria e edita o cadastro do Cliente — CUSTOMER-EDIT-PERMISSIONS-01.
 *
 * Decisão do PO: Comercial e Administrador criam e editam; Produção,
 * Qualidade, Compras e Consulta leem o Cliente e não gravam nada nele. A
 * recusa é da API — 403 com a frase dos gates, antes do corpo e antes de
 * olhar se o cliente existe —, não só um botão escondido.
 */

/*
 * O contrato compartilhado declara exatamente o corpo que a API aceita, nos
 * dois sentidos. Era aqui que `UpdateCustomerInput` não tinha CEP,
 * logradouro, número, complemento e bairro — campos que a tela sempre enviou
 * e a API sempre gravou. Se um lado ganhar ou perder uma chave, o typecheck
 * da API reprova esta linha.
 */
type ChavesSemPar<A, B> = Exclude<keyof A, keyof B>;
type MesmasChaves<A, B> = [ChavesSemPar<A, B>, ChavesSemPar<B, A>] extends [never, never]
  ? true
  : false;
const criacaoDeclaraOCorpo: MesmasChaves<CorpoDeCriacao, ContratoDeCriacao> = true;
const alteracaoDeclaraOCorpo: MesmasChaves<CorpoDeAlteracao, ContratoDeAlteracao> = true;

const clientes: string[] = [];

afterAll(async () => {
  if (clientes.length === 0) return;
  // O histórico de situação sai junto (cascade) — Cliente não tem exclusão no app.
  await getPrisma().customer.deleteMany({ where: { id: { in: clientes } } });
});

type App = ReturnType<typeof buildTestApp>;

const PODEM_EDITAR = ["ADMIN", "COMMERCIAL"] as const satisfies readonly UserRole[];
const SO_CONSULTAM = ["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"] as const satisfies readonly UserRole[];
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
const RECUSA = { error: "forbidden", message: "Seu perfil não permite esta ação." };

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** O cadastro inteiro que a tela conhece, mais o sufixo de lote que ela não mostra. */
function cadastroCompleto(rotulo: string) {
  return {
    legalName: `Cliente permissão ${rotulo}`,
    tradeName: `Fantasia ${rotulo}`,
    cnpj: uniqueCnpj(),
    taxProfile: "LUCRO_PRESUMIDO",
    email: "compras@cliente-permissao.com.br",
    phone: "11987654321",
    zipCode: "01310100",
    street: "Avenida Paulista",
    number: "1000",
    complement: "Conjunto 12",
    district: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    notes: "Nota interna",
    businessLotSuffix: "A3",
  };
}

async function postar(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "POST", url: "/customers", payload });
  // Se um dia a recusa falhar, o cliente criado não fica para trás.
  if (resposta.statusCode === 201) clientes.push(resposta.json().id as string);
  return resposta;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/customers/${id}`, payload });
}

async function ler(app: App, url: string) {
  const resposta = await app.inject({ method: "GET", url });
  expect(resposta.statusCode, `GET ${url}`).toBe(200);
  return resposta.json();
}

async function clienteDoAdmin(): Promise<Customer> {
  const admin = buildTestApp("ADMIN");
  await admin.ready();
  const resposta = await postar(admin, cadastroCompleto(`base ${marca()}`));
  await admin.close();
  expect(resposta.statusCode).toBe(201);
  return getPrisma().customer.findUniqueOrThrow({ where: { id: resposta.json().id } });
}

/** A linha do banco, inteira: recusa que gravasse qualquer coisa mudaria algo aqui. */
function linha(id: string) {
  return getPrisma().customer.findUniqueOrThrow({ where: { id } });
}

describe("CUSTOMER-EDIT-PERMISSIONS-01 — a lista de quem edita o cadastro", () => {
  it("é Comercial e Administrador, e só eles", () => {
    expect([...CUSTOMER_EDIT_ROLES].sort()).toEqual([...PODEM_EDITAR].sort());
    expect(USER_ROLES.filter((role) => !CUSTOMER_EDIT_ROLES.includes(role)).sort()).toEqual(
      [...SO_CONSULTAM].sort(),
    );
  });

  it("é uma lista própria — não a da situação cadastral, mesmo com os mesmos perfis hoje", () => {
    expect(CUSTOMER_EDIT_ROLES).not.toBe(CUSTOMER_STATUS_CHANGE_ROLES);
    expect([...CUSTOMER_EDIT_ROLES].sort()).toEqual([...CUSTOMER_STATUS_CHANGE_ROLES].sort());
  });

  it("o contrato compartilhado declara o corpo que a API aceita (criação e alteração)", () => {
    expect(criacaoDeclaraOCorpo).toBe(true);
    expect(alteracaoDeclaraOCorpo).toBe(true);
  });
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — Comercial e Administrador criam e editam", () => {
  it.each(PODEM_EDITAR)("%s: POST 201 e PATCH 200 com o cadastro inteiro, e a autoria é dele", async (role) => {
    const app = buildTestApp(role);
    await app.ready();
    const { user } = await createAuthenticatedUser(role);

    const criado = await postar(app, cadastroCompleto(`${role} ${marca()}`));
    expect(criado.statusCode, `${role} POST: ${criado.body}`).toBe(201);
    const id = criado.json().id as string;
    expect(criado.json(), role).toMatchObject({
      taxProfile: "LUCRO_PRESUMIDO",
      zipCode: "01310100",
      businessLotSuffix: "A3",
      status: "ACTIVE",
      createdByName: user.name,
      updatedByName: user.name,
    });

    const novoCnpj = uniqueCnpj();
    const alterado = await alterar(app, id, {
      legalName: `Cliente alterado ${role} ${marca()}`,
      tradeName: "Fantasia nova",
      cnpj: novoCnpj,
      taxProfile: "SIMPLES_NACIONAL",
      email: "financeiro@cliente-permissao.com.br",
      phone: "1133334444",
      zipCode: "04816100",
      street: "Rua Vicente José de Almeida",
      number: "42",
      complement: "",
      district: "Jardim Novo",
      city: "São Paulo",
      state: "SP",
      notes: "Nota revisada",
      businessLotSuffix: "B7",
      // A situação não entra pelo cadastro, nem para quem pode editá-lo.
      active: false,
      blocked: true,
      status: "BLOCKED",
    });
    expect(alterado.statusCode, `${role} PATCH: ${alterado.body}`).toBe(200);
    expect(alterado.json(), role).toMatchObject({
      tradeName: "Fantasia nova",
      cnpj: novoCnpj,
      taxProfile: "SIMPLES_NACIONAL",
      zipCode: "04816100",
      street: "Rua Vicente José de Almeida",
      number: "42",
      complement: null,
      district: "Jardim Novo",
      notes: "Nota revisada",
      businessLotSuffix: "B7",
      active: true,
      blocked: false,
      status: "ACTIVE",
      updatedByName: user.name,
    });

    const gravado = await linha(id);
    expect(gravado.updatedByUserId, role).toBe(user.id);
    expect(await getPrisma().customerStatusHistory.count({ where: { customerId: id } }), role).toBe(0);

    await app.close();
  });

  it.each(PODEM_EDITAR)("%s: cliente inexistente continua 404 e corpo inválido continua 400", async (role) => {
    const app = buildTestApp(role);
    await app.ready();

    const inexistente = await alterar(app, ID_INEXISTENTE, { notes: "Qualquer" });
    expect(inexistente.statusCode, role).toBe(404);

    const semRazaoSocial = await postar(app, {});
    expect(semRazaoSocial.statusCode, role).toBe(400);
    expect(semRazaoSocial.json().error, role).toBe("validation_error");

    await app.close();
  });
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — os demais perfis consultam e não gravam", () => {
  it.each(SO_CONSULTAM)("%s: POST e PATCH recebem 403, antes do corpo e da existência, e nada muda", async (role) => {
    const existente = await clienteDoAdmin();
    const antes = await linha(existente.id);

    const app = buildTestApp(role);
    await app.ready();

    // Criar: com cadastro válido, e com corpo que a validação recusaria.
    const rotulo = `recusado ${role} ${marca()}`;
    const criar = await postar(app, cadastroCompleto(rotulo));
    expect(criar.statusCode, `${role} POST`).toBe(403);
    expect(criar.json(), `${role} POST`).toEqual(RECUSA);
    const criarSemCorpo = await postar(app, {});
    expect(criarSemCorpo.statusCode, `${role} POST sem corpo`).toBe(403);
    expect(criarSemCorpo.json(), `${role} POST sem corpo`).toEqual(RECUSA);

    // Editar: válido, inválido e cliente que não existe — a mesma resposta.
    const editar = await alterar(app, existente.id, {
      legalName: "Razão social trocada sem permissão",
      cnpj: uniqueCnpj(),
      taxProfile: "MEI",
      zipCode: "04816100",
      businessLotSuffix: "Z9",
    });
    expect(editar.statusCode, `${role} PATCH`).toBe(403);
    expect(editar.json(), `${role} PATCH`).toEqual(RECUSA);
    const editarInvalido = await alterar(app, existente.id, { cnpj: "123", legalName: "" });
    expect(editarInvalido.statusCode, `${role} PATCH inválido`).toBe(403);
    expect(editarInvalido.json(), `${role} PATCH inválido`).toEqual(RECUSA);
    const editarInexistente = await alterar(app, ID_INEXISTENTE, { notes: "Qualquer" });
    expect(editarInexistente.statusCode, `${role} PATCH inexistente`).toBe(403);
    expect(editarInexistente.json(), `${role} PATCH inexistente`).toEqual(RECUSA);

    // Nada gravado: nenhum cliente com o nome recusado, e a linha existente
    // idêntica. Pelo nome, não pelo total: arquivos vizinhos gravam clientes
    // em paralelo.
    expect(
      await getPrisma().customer.count({ where: { legalName: { contains: rotulo } } }),
      role,
    ).toBe(0);
    expect(await linha(existente.id), role).toEqual(antes);

    // E a consulta segue aberta.
    const detalhe = await ler(app, `/customers/${existente.id}`);
    expect(detalhe.legalName, role).toBe(existente.legalName);
    const lista = await ler(app, `/customers?ids=${existente.id}`);
    expect(lista.customers.map((c: { id: string }) => c.id), role).toEqual([existente.id]);

    await app.close();
  });

  it("VIEWER é só leitura: lê Cliente, situação e histórico; não cria, não edita, não muda a situação", async () => {
    const admin = buildTestApp("ADMIN");
    const consulta = buildTestApp("VIEWER");
    await admin.ready();
    await consulta.ready();

    const existente = await clienteDoAdmin();
    const bloqueio = await admin.inject({
      method: "POST",
      url: `/customers/${existente.id}/block`,
      payload: { reason: "Inadimplência desde março" },
    });
    expect(bloqueio.statusCode).toBe(200);
    const antes = await linha(existente.id);

    // Lê.
    const detalhe = await ler(consulta, `/customers/${existente.id}`);
    expect(detalhe).toMatchObject({
      id: existente.id,
      cnpj: existente.cnpj,
      taxProfile: "LUCRO_PRESUMIDO",
      businessLotSuffix: "A3",
      status: "BLOCKED",
      block: { reason: "Inadimplência desde março" },
    });
    const lista = await ler(consulta, `/customers?ids=${existente.id}&status=BLOCKED`);
    expect(lista.customers).toHaveLength(1);
    const historico = await ler(consulta, `/customers/${existente.id}/status-history`);
    expect(historico.events).toHaveLength(1);
    expect(historico.events[0]).toMatchObject({ fromStatus: "ACTIVE", toStatus: "BLOCKED" });
    const visao = await ler(consulta, `/customers/${existente.id}/consultation/summary`);
    expect(visao.customer.status).toBe("BLOCKED");

    // Não grava.
    const criar = await postar(consulta, cadastroCompleto(`viewer ${marca()}`));
    expect(criar.statusCode).toBe(403);
    const editar = await alterar(consulta, existente.id, { notes: "Consulta tentando editar" });
    expect(editar.statusCode).toBe(403);
    const desbloquear = await consulta.inject({
      method: "POST",
      url: `/customers/${existente.id}/unblock`,
      payload: { reason: "Consulta tentando desbloquear" },
    });
    expect(desbloquear.statusCode).toBe(403);

    expect(await linha(existente.id)).toEqual(antes);
    expect(await getPrisma().customerStatusHistory.count({ where: { customerId: existente.id } })).toBe(1);

    await admin.close();
    await consulta.close();
  });
});
