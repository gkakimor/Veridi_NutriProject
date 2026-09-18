import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CnpjEstablishmentType } from "@prisma/client";
import type { CnpjLookupResult, CustomerCnpjRegistrationInput, CustomerDTO } from "@veridi/shared";
import { CNPJ_ESTABLISHMENT_TYPES } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { maskCnpj, uniqueCnpj } from "../../test-support/br-documents.js";
import { DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE } from "./customer-cnpj-registration.js";

/**
 * Dados cadastrais do CNPJ no Cliente — CUSTOMER-CNPJ-PERSISTED-DATA-01, §119.
 *
 * O que estes casos fixam é a fronteira do cadastro: o bloco só entra pelo
 * POST/PATCH (consultar não grava), entra inteiro, pertence ao CNPJ que o
 * Cliente tem, e trocar o CNPJ descarta o do número anterior. Simples e MEI
 * guardam três estados — Sim, Não e não informado — e `null` nunca vira `false`.
 */

const clientes: string[] = [];

afterAll(async () => {
  if (clientes.length === 0) return;
  await getPrisma().customer.deleteMany({ where: { id: { in: clientes } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type App = ReturnType<typeof buildTestApp>;

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** O bloco como a Web o manda depois de "Aplicar": dados da fonte + CNPJ consultado + instante. */
function bloco(
  cnpj: string,
  extra: Partial<CustomerCnpjRegistrationInput> = {},
): CustomerCnpjRegistrationInput {
  return {
    cnpj,
    mainCnaeCode: "1099699",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: "Empresa de Pequeno Porte (EPP)",
    openedAt: "2019-03-08",
    establishmentType: "HEADQUARTERS",
    simplesOptIn: true,
    meiOptIn: false,
    registrationStatus: "Ativa",
    registrationStatusDate: "2020-01-15",
    consultedAt: "2026-09-17T12:30:00.000Z",
    ...extra,
  };
}

/** O bloco como a DTO o devolve: sem o `cnpj` (é o do próprio Cliente). */
function lido(entrada: CustomerCnpjRegistrationInput) {
  const { cnpj: _cnpj, ...resto } = entrada;
  return resto;
}

async function criar(app: App, extra: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente CNPJ ${marca()}`, ...extra },
  });
  if (resposta.statusCode === 201) clientes.push(resposta.json().id);
  return resposta;
}

async function criado(app: App, extra: Record<string, unknown> = {}): Promise<CustomerDTO> {
  const resposta = await criar(app, extra);
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json() as CustomerDTO;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/customers/${id}`, payload });
}

async function lerCliente(app: App, id: string): Promise<CustomerDTO> {
  const resposta = await app.inject({ method: "GET", url: `/customers/${id}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as CustomerDTO;
}

/** As onze colunas, direto do banco — a prova de que o bloco foi gravado (ou não). */
async function colunas(id: string) {
  return getPrisma().customer.findUniqueOrThrow({
    where: { id },
    select: {
      cnpj: true,
      cnpjMainCnaeCode: true,
      cnpjMainCnaeDescription: true,
      cnpjLegalNature: true,
      cnpjCompanySize: true,
      cnpjOpenedAt: true,
      cnpjEstablishmentType: true,
      cnpjSimplesOptIn: true,
      cnpjMeiOptIn: true,
      cnpjRegistrationStatus: true,
      cnpjRegistrationStatusDate: true,
      cnpjLastConsultedAt: true,
      updatedAt: true,
    },
  });
}

const COLUNAS_VAZIAS = {
  cnpjMainCnaeCode: null,
  cnpjMainCnaeDescription: null,
  cnpjLegalNature: null,
  cnpjCompanySize: null,
  cnpjOpenedAt: null,
  cnpjEstablishmentType: null,
  cnpjSimplesOptIn: null,
  cnpjMeiOptIn: null,
  cnpjRegistrationStatus: null,
  cnpjRegistrationStatusDate: null,
  cnpjLastConsultedAt: null,
};

describe("Dados cadastrais do CNPJ — o contrato", () => {
  it("o enum do banco e a lista do contrato têm os mesmos dois valores", () => {
    expect(Object.values(CnpjEstablishmentType)).toEqual([...CNPJ_ESTABLISHMENT_TYPES]);
  });
});

describe("Criar com a consulta aplicada", () => {
  const app = buildTestApp("COMMERCIAL");

  it("sem consulta aplicada o bloco nasce null, e nada é inventado do CNPJ", async () => {
    const cliente = await criado(app, { cnpj: uniqueCnpj() });
    expect(cliente.cnpjRegistration).toBeNull();
    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toBeNull();
    expect(await colunas(cliente.id)).toMatchObject(COLUNAS_VAZIAS);
  });

  it("consulta → aplicar → criar: o bloco inteiro é gravado com o instante da consulta", async () => {
    const cnpj = uniqueCnpj();
    const entrada = bloco(cnpj);
    const cliente = await criado(app, { cnpj, cnpjRegistration: entrada });

    expect(cliente.cnpjRegistration).toEqual(lido(entrada));
    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toEqual(lido(entrada));

    const banco = await colunas(cliente.id);
    // Datas civis como a meia-noite UTC do dia; a consulta como o instante dela.
    expect(banco.cnpjOpenedAt?.toISOString()).toBe("2019-03-08T00:00:00.000Z");
    expect(banco.cnpjRegistrationStatusDate?.toISOString()).toBe("2020-01-15T00:00:00.000Z");
    expect(banco.cnpjLastConsultedAt?.toISOString()).toBe("2026-09-17T12:30:00.000Z");
    expect(banco.cnpjEstablishmentType).toBe("HEADQUARTERS");
  });

  it("o CNPJ do cadastro pode vir mascarado: é o mesmo número do bloco", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj: maskCnpj(cnpj), cnpjRegistration: bloco(cnpj) });
    expect(cliente.cnpj).toBe(cnpj);
    expect(cliente.cnpjRegistration?.mainCnaeCode).toBe("1099699");
  });

  it("bloco de outro CNPJ é recusado no campo CNPJ, e o cliente não nasce", async () => {
    const legalName = `Cliente Divergente ${marca()}`;
    const resposta = await criar(app, {
      legalName,
      cnpj: uniqueCnpj(),
      cnpjRegistration: bloco(uniqueCnpj()),
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({
      error: "validation_error",
      issues: [{ path: "cnpj", message: DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE }],
    });
    expect(await getPrisma().customer.count({ where: { legalName } })).toBe(0);
  });

  it("bloco sem CNPJ no cadastro também é recusado: dado cadastral pertence a um número", async () => {
    const resposta = await criar(app, { cnpjRegistration: bloco(uniqueCnpj()) });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().issues[0].path).toBe("cnpj");
  });

  it.each([
    [true, "Sim"],
    [false, "Não"],
    [null, "não informado"],
  ] as const)("Simples %j (%s) volta exatamente assim — null não é false", async (valor, _rotulo) => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, {
      cnpj,
      cnpjRegistration: bloco(cnpj, { simplesOptIn: valor }),
    });
    expect(cliente.cnpjRegistration?.simplesOptIn, `simplesOptIn=${String(valor)}`).toBe(valor);
    expect((await colunas(cliente.id)).cnpjSimplesOptIn, `coluna=${String(valor)}`).toBe(valor);
  });

  it.each([
    [true, "Sim"],
    [false, "Não"],
    [null, "não informado"],
  ] as const)("MEI %j (%s) volta exatamente assim — null não é false", async (valor, _rotulo) => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, {
      cnpj,
      cnpjRegistration: bloco(cnpj, { meiOptIn: valor }),
    });
    expect(cliente.cnpjRegistration?.meiOptIn, `meiOptIn=${String(valor)}`).toBe(valor);
    expect((await colunas(cliente.id)).cnpjMeiOptIn, `coluna=${String(valor)}`).toBe(valor);
  });

  it("consulta parcial: o que a fonte não informou fica null, e a data da consulta fica", async () => {
    const cnpj = uniqueCnpj();
    const parcial = bloco(cnpj, {
      mainCnaeCode: null,
      mainCnaeDescription: null,
      legalNature: null,
      companySize: null,
      openedAt: null,
      establishmentType: null,
      simplesOptIn: null,
      meiOptIn: null,
      registrationStatus: "Ativa",
      registrationStatusDate: null,
    });
    const cliente = await criado(app, { cnpj, cnpjRegistration: parcial });

    expect(cliente.cnpjRegistration).toEqual(lido(parcial));
    expect(cliente.cnpjRegistration?.consultedAt).toBe("2026-09-17T12:30:00.000Z");
  });
});

describe("Editar com a consulta aplicada", () => {
  const app = buildTestApp("COMMERCIAL");

  it("consulta → aplicar → salvar alterações: o bloco é gravado no cliente existente", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });
    expect(cliente.cnpjRegistration).toBeNull();

    const resposta = await alterar(app, cliente.id, { cnpj, cnpjRegistration: bloco(cnpj) });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect((resposta.json() as CustomerDTO).cnpjRegistration).toEqual(lido(bloco(cnpj)));
    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toEqual(lido(bloco(cnpj)));
  });

  it("a consulta seguinte troca o bloco INTEIRO — nenhuma coluna da anterior sobra", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj) });

    const nova = bloco(cnpj, {
      companySize: "Demais",
      simplesOptIn: false,
      registrationStatus: "Baixada",
      registrationStatusDate: "2026-08-01",
      mainCnaeDescription: null,
      consultedAt: "2026-09-17T15:00:00.000Z",
    });
    const resposta = await alterar(app, cliente.id, { cnpjRegistration: nova });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toEqual(lido(nova));
  });

  it("PATCH sem bloco e sem trocar CNPJ não mexe nos dados cadastrais", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj) });

    // A tela manda o CNPJ sempre, igual ao gravado — e com máscara, às vezes.
    const resposta = await alterar(app, cliente.id, {
      legalName: `Renomeado ${marca()}`,
      cnpj: maskCnpj(cnpj),
    });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toEqual(lido(bloco(cnpj)));
  });

  it("TROCA DE CNPJ sem consulta nova descarta o bloco do CNPJ anterior — só ele", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, {
      cnpj,
      tradeName: "FANTASIA QUE FICA",
      email: "contato@cliente.com.br",
      city: "Tatuí",
      state: "SP",
      notes: "Nota interna que fica.",
      taxProfile: "LUCRO_PRESUMIDO",
      defaultPaymentInstrument: "PIX",
      cnpjRegistration: bloco(cnpj),
    });

    const outro = uniqueCnpj();
    const resposta = await alterar(app, cliente.id, { cnpj: outro });

    expect(resposta.statusCode, resposta.body).toBe(200);
    const depois = await lerCliente(app, cliente.id);
    expect(depois.cnpj).toBe(outro);
    expect(depois.cnpjRegistration).toBeNull();
    expect(await colunas(cliente.id)).toMatchObject({ cnpj: outro, ...COLUNAS_VAZIAS });
    // Os dados comerciais não pertencem ao CNPJ e ficam onde estavam.
    expect(depois).toMatchObject({
      tradeName: "FANTASIA QUE FICA",
      email: "contato@cliente.com.br",
      city: "Tatuí",
      state: "SP",
      notes: "Nota interna que fica.",
      taxProfile: "LUCRO_PRESUMIDO",
      defaultPaymentInstrument: "PIX",
    });
  });

  it("troca de CNPJ COM a consulta do número novo aplicada grava o bloco novo", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj) });

    const novo = uniqueCnpj();
    const doNovo = bloco(novo, { establishmentType: "BRANCH", consultedAt: "2026-09-17T16:00:00.000Z" });
    const resposta = await alterar(app, cliente.id, { cnpj: novo, cnpjRegistration: doNovo });

    expect(resposta.statusCode, resposta.body).toBe(200);
    const depois = await lerCliente(app, cliente.id);
    expect(depois.cnpj).toBe(novo);
    expect(depois.cnpjRegistration).toEqual(lido(doNovo));
  });

  it("troca de CNPJ levando o bloco do número ANTIGO é recusada, e nada muda", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj) });
    const antes = await colunas(cliente.id);

    const resposta = await alterar(app, cliente.id, {
      cnpj: uniqueCnpj(),
      cnpjRegistration: bloco(cnpj, { consultedAt: "2026-09-17T17:00:00.000Z" }),
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().issues).toEqual([
      { path: "cnpj", message: DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE },
    ]);
    expect(await colunas(cliente.id)).toEqual(antes);
  });

  it("bloco de outro número sem trocar o CNPJ do cadastro também é recusado", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    const resposta = await alterar(app, cliente.id, { cnpjRegistration: bloco(uniqueCnpj()) });

    expect(resposta.statusCode).toBe(400);
    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toBeNull();
  });

  it("apagar o CNPJ descarta o bloco", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj) });

    const resposta = await alterar(app, cliente.id, { cnpj: "" });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await colunas(cliente.id)).toMatchObject({ cnpj: null, ...COLUNAS_VAZIAS });
  });

  it("`cnpjRegistration: null` limpa o bloco e mantém o CNPJ", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj) });

    const resposta = await alterar(app, cliente.id, { cnpjRegistration: null });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await colunas(cliente.id)).toMatchObject({ cnpj, ...COLUNAS_VAZIAS });
  });

  it("aplicar a consulta não mexe em perfil tributário, pagamento, notas nem situação", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, {
      cnpj,
      taxProfile: "SIMPLES_NACIONAL",
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
      notes: "Nota interna.",
    });

    // O Simples da fonte diz "Não" e o porte diz "Demais": o perfil informado fica.
    const resposta = await alterar(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { simplesOptIn: false, companySize: "Demais" }),
    });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await lerCliente(app, cliente.id)).toMatchObject({
      taxProfile: "SIMPLES_NACIONAL",
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
      notes: "Nota interna.",
      status: "ACTIVE",
      active: true,
      blocked: false,
    });
  });
});

describe("Consultar não grava; a última consulta só existe depois do Salvar", () => {
  const app = buildTestApp("COMMERCIAL");

  function fingirOpenCnpj(cnpj: string) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          cnpj,
          razao_social: "EMPRESA CONSULTADA LTDA",
          situacao_cadastral: "Ativa",
          data_situacao_cadastral: "2021-04-01",
          matriz_filial: "Filial",
          data_inicio_atividade: "2018-01-10",
          cnae_principal: "4632001",
          natureza_juridica: "Sociedade Empresária Limitada",
          porte_empresa: "Microempresa (ME)",
          opcao_simples: "S",
          opcao_mei: "",
        }),
        { status: 200 },
      ),
    );
  }

  it("a consulta sozinha não toca o cadastro — nem dado, nem data, nem updatedAt", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });
    const antes = await colunas(cliente.id);
    fingirOpenCnpj(cnpj);

    const consulta = await app.inject({ url: `/cnpj-lookup/${cnpj}` });

    expect(consulta.statusCode, consulta.body).toBe(200);
    expect(await colunas(cliente.id)).toEqual(antes);
    expect(antes.cnpjLastConsultedAt).toBeNull();
  });

  it("o `consultedAt` da consulta vira a Última consulta CNPJ só quando o cadastro é salvo", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });
    fingirOpenCnpj(cnpj);

    const consulta = (await app.inject({ url: `/cnpj-lookup/${cnpj}` })).json() as CnpjLookupResult;
    expect((await colunas(cliente.id)).cnpjLastConsultedAt).toBeNull();

    // O que a Web monta ao aplicar: a empresa normalizada, o CNPJ e o instante.
    const { company } = consulta;
    const aplicado: CustomerCnpjRegistrationInput = {
      cnpj: consulta.cnpj,
      mainCnaeCode: company.mainCnaeCode,
      mainCnaeDescription: company.mainCnaeDescription,
      legalNature: company.legalNature,
      companySize: company.companySize,
      openedAt: company.openedAt,
      establishmentType: company.establishmentType,
      simplesOptIn: company.simplesOptIn,
      meiOptIn: company.meiOptIn,
      registrationStatus: company.registrationStatus,
      registrationStatusDate: company.registrationStatusDate,
      consultedAt: consulta.consultedAt,
    };
    const salvo = await alterar(app, cliente.id, { cnpj, cnpjRegistration: aplicado });

    expect(salvo.statusCode, salvo.body).toBe(200);
    const depois = await lerCliente(app, cliente.id);
    expect(depois.cnpjRegistration?.consultedAt).toBe(consulta.consultedAt);
    expect(depois.cnpjRegistration).toMatchObject({
      establishmentType: "BRANCH",
      simplesOptIn: true,
      // `opcao_mei: ""` — não informado, e continua não informado depois de salvo.
      meiOptIn: null,
      openedAt: "2018-01-10",
      registrationStatusDate: "2021-04-01",
      companySize: "Microempresa (ME)",
    });
  });
});

describe("O bloco é validado inteiro", () => {
  const app = buildTestApp("COMMERCIAL");

  it.each([
    ["Simples em texto", { simplesOptIn: "S" }],
    ["MEI em número", { meiOptIn: 1 }],
    ["data que não existe", { openedAt: "2024-02-30" }],
    ["data com hora", { registrationStatusDate: "2024-05-09T10:00:00Z" }],
    ["CNAE fora de sete dígitos", { mainCnaeCode: "12345" }],
    ["Matriz/Filial fora do enum", { establishmentType: "MATRIZ" }],
    ["porte acima do teto", { companySize: "P".repeat(101) }],
    ["consulta sem data", { consultedAt: undefined }],
    ["consulta com data ilegível", { consultedAt: "ontem" }],
    ["consulta no futuro", { consultedAt: "2999-01-01T00:00:00.000Z" }],
  ])("%s é 400, e o bloco não é gravado", async (caso, extra) => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    const resposta = await alterar(app, cliente.id, {
      cnpjRegistration: { ...bloco(cnpj), ...extra },
    });

    expect(resposta.statusCode, `${caso}: ${resposta.body}`).toBe(400);
    expect(resposta.json().error, caso).toBe("validation_error");
    expect((await colunas(cliente.id)).cnpjLastConsultedAt, caso).toBeNull();
  });

  it("chave faltando no bloco é recusa — ausente não é 'não informado'", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });
    const { meiOptIn: _fora, ...semMei } = bloco(cnpj);

    const resposta = await alterar(app, cliente.id, { cnpjRegistration: semMei });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().issues[0].path).toBe("cnpjRegistration.meiOptIn");
  });

  it("chave crua do provedor dentro do bloco é descartada: não chega ao banco nem à resposta", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    const resposta = await alterar(app, cliente.id, {
      cnpjRegistration: { ...bloco(cnpj), opcao_simples: "S", matriz_filial: "Matriz" },
    });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(resposta.body).not.toContain("opcao_simples");
    expect(resposta.body).not.toContain("matriz_filial");
  });
});

describe("Quem grava o bloco", () => {
  it("perfil que não edita o cadastro recebe 403 e o bloco não é gravado", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(buildTestApp("COMMERCIAL"), { cnpj });

    const resposta = await alterar(buildTestApp("PRODUCTION"), cliente.id, {
      cnpjRegistration: bloco(cnpj),
    });

    expect(resposta.statusCode).toBe(403);
    expect((await colunas(cliente.id)).cnpjLastConsultedAt).toBeNull();
  });
});
