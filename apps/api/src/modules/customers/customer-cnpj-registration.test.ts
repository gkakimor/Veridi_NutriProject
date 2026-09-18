import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CnpjEstablishmentType, CustomerCnpjRegistrationEventKind } from "@prisma/client";
import type {
  CnpjLookupResult,
  CustomerCnpjRegistrationEventDTO,
  CustomerCnpjRegistrationInput,
  CustomerDTO,
} from "@veridi/shared";
import { CNPJ_ESTABLISHMENT_TYPES, CNPJ_REGISTRATION_EVENT_KINDS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { maskCnpj, uniqueCnpj } from "../../test-support/br-documents.js";
import { DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE } from "./customer-cnpj-registration.js";

/**
 * Dados cadastrais do CNPJ no Cliente — §119 e §122 (CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * O que estes casos fixam é a fronteira do cadastro: os dez campos são
 * editáveis e só o POST/PATCH os grava; o servidor compara com o GRAVADO e só
 * o que muda vira mudança — com a origem de cada campo (Manual, OpenCNPJ ou
 * CNPJ alterado); a consulta aplicada sem mudança atualiza a última consulta e
 * vira evento de conferência, nunca "A → A"; trocar o CNPJ limpa os dados do
 * número anterior e registra isso; o histórico é append-only e não guarda
 * payload do provedor. Simples e MEI guardam três estados — `null` nunca é `false`.
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

const USUARIO = "Usuário de Teste COMMERCIAL";
const CONSULTA = "2026-09-17T12:30:00.000Z";

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Os dez campos vazios — o formulário de um cliente sem dado nenhum. */
const VAZIO = {
  mainCnaeCode: null,
  mainCnaeDescription: null,
  legalNature: null,
  companySize: null,
  openedAt: null,
  establishmentType: null,
  simplesOptIn: null,
  meiOptIn: null,
  registrationStatus: null,
  registrationStatusDate: null,
} as const;

/** O que a consulta traz para um CNPJ, e o que o formulário manda depois de aplicar tudo. */
const DA_FONTE = {
  mainCnaeCode: "1099699",
  mainCnaeDescription: "Fabricação de outros produtos alimentícios",
  legalNature: "Sociedade Empresária Limitada",
  companySize: "Empresa de Pequeno Porte (EPP)",
  openedAt: "2019-03-08",
  establishmentType: "HEADQUARTERS" as const,
  simplesOptIn: true,
  meiOptIn: false,
  registrationStatus: "Ativa",
  registrationStatusDate: "2020-01-15",
};

const TODOS_OPEN_CNPJ = Object.fromEntries(
  Object.keys(DA_FONTE).map((campo) => [campo, "OPEN_CNPJ"]),
) as NonNullable<CustomerCnpjRegistrationInput["sources"]>;

function bloco(cnpj: string, extra: Partial<CustomerCnpjRegistrationInput> = {}): CustomerCnpjRegistrationInput {
  return { cnpj, ...VAZIO, ...extra };
}

/** Consulta aplicada inteira: os dez campos da fonte, todos OpenCNPJ. */
function blocoDaConsulta(cnpj: string, extra: Partial<CustomerCnpjRegistrationInput> = {}) {
  return bloco(cnpj, { ...DA_FONTE, consultedAt: CONSULTA, sources: TODOS_OPEN_CNPJ, ...extra });
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

async function alterado(app: App, id: string, payload: Record<string, unknown>): Promise<CustomerDTO> {
  const resposta = await alterar(app, id, payload);
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as CustomerDTO;
}

async function lerCliente(app: App, id: string): Promise<CustomerDTO> {
  const resposta = await app.inject({ method: "GET", url: `/customers/${id}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as CustomerDTO;
}

async function historico(app: App, id: string): Promise<CustomerCnpjRegistrationEventDTO[]> {
  const resposta = await app.inject({ method: "GET", url: `/customers/${id}/cnpj-registration-history` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return (resposta.json() as { events: CustomerCnpjRegistrationEventDTO[] }).events;
}

/** As linhas cruas do histórico — a prova do que o banco guarda. */
function linhasDoHistorico(customerId: string) {
  return getPrisma().customerCnpjRegistrationHistory.findMany({
    where: { customerId },
    orderBy: { changedAt: "asc" },
  });
}

describe("o contrato", () => {
  it("os enums do banco e as listas do contrato são os mesmos", () => {
    expect(Object.values(CnpjEstablishmentType)).toEqual([...CNPJ_ESTABLISHMENT_TYPES]);
    expect(Object.values(CustomerCnpjRegistrationEventKind)).toEqual([...CNPJ_REGISTRATION_EVENT_KINDS]);
  });
});

describe("criar", () => {
  const app = buildTestApp("COMMERCIAL");

  it("sem dado nenhum: nada é inventado do CNPJ e não há histórico", async () => {
    const cliente = await criado(app, { cnpj: uniqueCnpj() });
    expect(cliente.cnpjRegistration).toBeNull();
    expect(await historico(app, cliente.id)).toEqual([]);
  });

  it("consulta aplicada na criação: grava os dados e o primeiro evento, tudo OpenCNPJ", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    expect(cliente.cnpjRegistration).toEqual({ ...DA_FONTE, lastConsultedAt: CONSULTA });
    const [evento, ...resto] = await historico(app, cliente.id);
    expect(resto).toEqual([]);
    expect(evento).toMatchObject({ kind: "EDIT", cnpj, previousCnpj: null, consultedAt: CONSULTA, userName: USUARIO });
    expect(evento!.changes).toHaveLength(10);
    expect(evento!.changes.every((mudanca) => mudanca.source === "OPEN_CNPJ" && mudanca.before === null)).toBe(true);
  });

  it("digitado à mão na criação: origem Manual, e sem consulta não há última consulta", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, {
      cnpj,
      cnpjRegistration: bloco(cnpj, { legalNature: "Empresário Individual", simplesOptIn: false }),
    });

    expect(cliente.cnpjRegistration).toMatchObject({
      legalNature: "Empresário Individual",
      simplesOptIn: false,
      meiOptIn: null,
      lastConsultedAt: null,
    });
    const [evento] = await historico(app, cliente.id);
    expect(evento!.changes).toEqual([
      { field: "legalNature", before: null, after: "Empresário Individual", source: "MANUAL" },
      { field: "simplesOptIn", before: null, after: false, source: "MANUAL" },
    ]);
  });

  it("bloco de outro CNPJ é recusado no campo CNPJ, e o cliente não nasce", async () => {
    const legalName = `Cliente Divergente ${marca()}`;
    const resposta = await criar(app, { legalName, cnpj: uniqueCnpj(), cnpjRegistration: bloco(uniqueCnpj()) });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({
      error: "validation_error",
      issues: [{ path: "cnpj", message: DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE }],
    });
    expect(await getPrisma().customer.count({ where: { legalName } })).toBe(0);
  });
});

describe("editar à mão", () => {
  const app = buildTestApp("COMMERCIAL");

  it("corrigir um campo grava só ele, com anterior, novo, origem Manual, usuário e data", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    const antes = Date.now();

    const depois = await alterado(app, cliente.id, {
      cnpj,
      cnpjRegistration: bloco(cnpj, { ...DA_FONTE, legalNature: "Sociedade Limitada" }),
    });

    expect(depois.cnpjRegistration).toMatchObject({ legalNature: "Sociedade Limitada", lastConsultedAt: CONSULTA });
    const [evento] = await historico(app, cliente.id);
    expect(evento).toMatchObject({ kind: "EDIT", consultedAt: null, userName: USUARIO });
    expect(evento!.changes).toEqual([
      {
        field: "legalNature",
        before: "Sociedade Empresária Limitada",
        after: "Sociedade Limitada",
        source: "MANUAL",
      },
    ]);
    // Data do evento é a do Salvar (tolerância para o relógio grosso do Windows).
    expect(Date.parse(evento!.occurredAt)).toBeGreaterThanOrEqual(antes - 1000);
  });

  it("apagar um campo é mudança Manual para vazio", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    await alterado(app, cliente.id, { cnpjRegistration: bloco(cnpj, { ...DA_FONTE, companySize: null }) });

    const [evento] = await historico(app, cliente.id);
    expect(evento!.changes).toEqual([
      { field: "companySize", before: "Empresa de Pequeno Porte (EPP)", after: null, source: "MANUAL" },
    ]);
  });

  it("Simples e MEI guardam Sim, Não e Não informado — null não é false", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj, { simplesOptIn: true, meiOptIn: null }) });

    const depois = await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { simplesOptIn: false, meiOptIn: null }),
    });

    expect(depois.cnpjRegistration).toMatchObject({ simplesOptIn: false, meiOptIn: null });
    const [evento] = await historico(app, cliente.id);
    expect(evento!.changes).toEqual([{ field: "simplesOptIn", before: true, after: false, source: "MANUAL" }]);
  });

  it("gravar os mesmos valores, sem consulta, não cria evento", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    await alterado(app, cliente.id, { cnpj: maskCnpj(cnpj), cnpjRegistration: bloco(cnpj, DA_FONTE) });

    expect(await historico(app, cliente.id)).toHaveLength(1);
  });

  it("PATCH sem os dados do CNPJ não mexe neles nem no histórico", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    const depois = await alterado(app, cliente.id, { legalName: `Renomeado ${marca()}`, cnpj });

    expect(depois.cnpjRegistration).toEqual({ ...DA_FONTE, lastConsultedAt: CONSULTA });
    expect(await historico(app, cliente.id)).toHaveLength(1);
  });
});

describe("a consulta é aditiva", () => {
  const app = buildTestApp("COMMERCIAL");

  it("preenche o vazio: o que faltava vem da fonte, origem OpenCNPJ", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj, { legalNature: "Sociedade Limitada" }) });

    // A tela aplica só o que estava vazio: a natureza jurídica já preenchida
    // vai com o valor atual, e a fonte completa o resto.
    await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, {
        ...DA_FONTE,
        legalNature: "Sociedade Limitada",
        consultedAt: CONSULTA,
        sources: { companySize: "OPEN_CNPJ", mainCnaeCode: "OPEN_CNPJ", openedAt: "OPEN_CNPJ" },
      }),
    });

    const depois = await lerCliente(app, cliente.id);
    expect(depois.cnpjRegistration?.legalNature).toBe("Sociedade Limitada");
    const [evento] = await historico(app, cliente.id);
    expect(evento!.consultedAt).toBe(CONSULTA);
    const origem = Object.fromEntries(evento!.changes.map((mudanca) => [mudanca.field, mudanca.source]));
    expect(origem).toMatchObject({ companySize: "OPEN_CNPJ", mainCnaeCode: "OPEN_CNPJ", openedAt: "OPEN_CNPJ" });
    // Sem origem declarada, o valor que mudou é Manual — e o que ficou não aparece.
    expect(origem["legalNature"]).toBeUndefined();
  });

  it("valor existente não selecionado não é substituído: fica, e não vira mudança", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj, { companySize: "Microempresa (ME)" }) });

    // A fonte diz "EPP"; a pessoa não marcou "Substituir": vai o valor atual.
    await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { companySize: "Microempresa (ME)", consultedAt: CONSULTA }),
    });

    expect((await lerCliente(app, cliente.id)).cnpjRegistration?.companySize).toBe("Microempresa (ME)");
  });

  it("substituição explícita troca o valor, com anterior e novo, origem OpenCNPJ", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj, { companySize: "Microempresa (ME)" }) });

    await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, {
        companySize: "Empresa de Pequeno Porte (EPP)",
        consultedAt: CONSULTA,
        sources: { companySize: "OPEN_CNPJ" },
      }),
    });

    const [evento] = await historico(app, cliente.id);
    expect(evento!.changes).toEqual([
      {
        field: "companySize",
        before: "Microempresa (ME)",
        after: "Empresa de Pequeno Porte (EPP)",
        source: "OPEN_CNPJ",
      },
    ]);
  });

  it("fonte vazia não apaga: o campo vai com o valor atual e continua gravado", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: bloco(cnpj, { meiOptIn: true }) });

    // A fonte não informou o MEI: a tela não oferece apagar, manda o atual.
    await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { meiOptIn: true, consultedAt: CONSULTA }),
    });

    expect((await lerCliente(app, cliente.id)).cnpjRegistration?.meiOptIn).toBe(true);
  });

  it("aplicação mista: a origem é POR CAMPO, não do evento inteiro", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    // Porte e CNAE aplicados da consulta; natureza jurídica aplicada e depois
    // corrigida à mão antes do Salvar — é Manual.
    await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, {
        companySize: "Demais",
        mainCnaeCode: "4632001",
        legalNature: "Sociedade Anônima Fechada",
        consultedAt: CONSULTA,
        sources: { companySize: "OPEN_CNPJ", mainCnaeCode: "OPEN_CNPJ", legalNature: "MANUAL" },
      }),
    });

    const [evento] = await historico(app, cliente.id);
    expect(evento!.changes).toEqual([
      { field: "mainCnaeCode", before: null, after: "4632001", source: "OPEN_CNPJ" },
      { field: "legalNature", before: null, after: "Sociedade Anônima Fechada", source: "MANUAL" },
      { field: "companySize", before: null, after: "Demais", source: "OPEN_CNPJ" },
    ]);
  });

  it("origem OpenCNPJ sem consulta aplicada é recusa: não se declara sem a consulta", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    const resposta = await alterar(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { companySize: "Demais", sources: { companySize: "OPEN_CNPJ" } }),
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().issues[0].path).toBe("cnpjRegistration.sources");
    expect(await historico(app, cliente.id)).toEqual([]);
  });
});

describe("consulta sem diferença", () => {
  const app = buildTestApp("COMMERCIAL");

  it("atualiza a última consulta e vira evento de conferência, sem nenhuma linha 'A → A'", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    const nova = "2026-09-17T18:45:00.000Z";

    const depois = await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { ...DA_FONTE, consultedAt: nova, sources: TODOS_OPEN_CNPJ }),
    });

    expect(depois.cnpjRegistration?.lastConsultedAt).toBe(nova);
    const [evento] = await historico(app, cliente.id);
    expect(evento).toMatchObject({ kind: "CONSULTATION", consultedAt: nova, changes: [] });
  });

  it("consulta mais antiga que a última registrada não faz a data andar para trás", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    const depois = await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, { ...DA_FONTE, consultedAt: "2026-01-01T00:00:00.000Z" }),
    });

    expect(depois.cnpjRegistration?.lastConsultedAt).toBe(CONSULTA);
  });
});

describe("troca de CNPJ", () => {
  const app = buildTestApp("COMMERCIAL");

  it("sem dados novos: limpa os do número anterior e registra CNPJ alterado — não é edição manual", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, {
      cnpj,
      tradeName: "FANTASIA QUE FICA",
      email: "contato@cliente.com.br",
      notes: "Nota interna que fica.",
      taxProfile: "LUCRO_PRESUMIDO",
      defaultPaymentInstrument: "PIX",
      cnpjRegistration: blocoDaConsulta(cnpj, { companySize: null, sources: { mainCnaeCode: "OPEN_CNPJ" } }),
    });
    const outro = uniqueCnpj();

    const depois = await alterado(app, cliente.id, { cnpj: outro });

    expect(depois.cnpj).toBe(outro);
    expect(depois.cnpjRegistration).toBeNull();
    const [evento] = await historico(app, cliente.id);
    expect(evento).toMatchObject({ kind: "CNPJ_CHANGED", cnpj: outro, previousCnpj: cnpj, consultedAt: null });
    // Nove campos tinham valor (o porte estava vazio): nove limpezas, todas "CNPJ alterado".
    expect(evento!.changes).toHaveLength(9);
    expect(evento!.changes.every((mudanca) => mudanca.source === "CNPJ_CHANGED" && mudanca.after === null)).toBe(true);
    // O que não pertence ao CNPJ fica.
    expect(depois).toMatchObject({
      tradeName: "FANTASIA QUE FICA",
      email: "contato@cliente.com.br",
      notes: "Nota interna que fica.",
      taxProfile: "LUCRO_PRESUMIDO",
      defaultPaymentInstrument: "PIX",
    });
  });

  it("com a consulta do número novo no mesmo Salvar: um evento, limpeza e dados novos com a origem de cada um", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    const novo = uniqueCnpj();

    await alterado(app, cliente.id, {
      cnpj: novo,
      cnpjRegistration: bloco(novo, {
        establishmentType: "BRANCH",
        registrationStatus: "Ativa",
        consultedAt: "2026-09-17T16:00:00.000Z",
        sources: { establishmentType: "OPEN_CNPJ", registrationStatus: "OPEN_CNPJ" },
      }),
    });

    const [evento, anterior] = await historico(app, cliente.id);
    expect(anterior!.kind).toBe("EDIT");
    expect(evento).toMatchObject({ kind: "CNPJ_CHANGED", cnpj: novo, previousCnpj: cnpj });
    const porCampo = Object.fromEntries(evento!.changes.map((mudanca) => [mudanca.field, mudanca]));
    // Matriz → Filial veio da fonte do número novo; a situação é a mesma: sem linha.
    expect(porCampo["establishmentType"]).toEqual({
      field: "establishmentType",
      before: "HEADQUARTERS",
      after: "BRANCH",
      source: "OPEN_CNPJ",
    });
    expect(porCampo["registrationStatus"]).toBeUndefined();
    expect(porCampo["companySize"]).toMatchObject({ after: null, source: "CNPJ_CHANGED" });
    expect((await lerCliente(app, cliente.id)).cnpjRegistration?.lastConsultedAt).toBe("2026-09-17T16:00:00.000Z");
  });

  it("o bloco do número antigo junto do CNPJ novo é recusado, e nada muda", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    const antes = await linhasDoHistorico(cliente.id);

    const resposta = await alterar(app, cliente.id, { cnpj: uniqueCnpj(), cnpjRegistration: blocoDaConsulta(cnpj) });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().issues).toEqual([{ path: "cnpj", message: DADOS_DO_CNPJ_DE_OUTRO_NUMERO_MESSAGE }]);
    expect((await lerCliente(app, cliente.id)).cnpj).toBe(cnpj);
    expect(await linhasDoHistorico(cliente.id)).toEqual(antes);
  });

  it("apagar o CNPJ limpa os dados e registra a troca para nenhum número", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    const depois = await alterado(app, cliente.id, { cnpj: "" });

    expect(depois.cnpjRegistration).toBeNull();
    const [evento] = await historico(app, cliente.id);
    expect(evento).toMatchObject({ kind: "CNPJ_CHANGED", cnpj: null, previousCnpj: cnpj });
  });

  it("trocar o CNPJ de quem não tinha dados não cria evento", async () => {
    const cliente = await criado(app, { cnpj: uniqueCnpj() });

    await alterado(app, cliente.id, { cnpj: uniqueCnpj() });

    expect(await historico(app, cliente.id)).toEqual([]);
  });
});

describe("o histórico", () => {
  const app = buildTestApp("COMMERCIAL");

  it("é append-only: cada Salvar acrescenta, e nenhuma linha anterior muda", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    const primeira = await linhasDoHistorico(cliente.id);

    await alterado(app, cliente.id, { cnpjRegistration: bloco(cnpj, { ...DA_FONTE, companySize: "Demais" }) });
    await alterado(app, cliente.id, { cnpj: uniqueCnpj() });

    const todas = await linhasDoHistorico(cliente.id);
    expect(todas).toHaveLength(3);
    expect(todas[0]).toEqual(primeira[0]);
    // Do mais recente para o mais antigo na API.
    expect((await historico(app, cliente.id)).map((evento) => evento.kind)).toEqual([
      "CNPJ_CHANGED",
      "EDIT",
      "EDIT",
    ]);
  });

  it("não existe rota para alterar ou apagar evento", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    const url = `/customers/${cliente.id}/cnpj-registration-history`;

    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const resposta = await app.inject({ method, url, payload: {} });
      expect(resposta.statusCode, method).toBe(404);
    }
    expect(await linhasDoHistorico(cliente.id)).toHaveLength(1);
  });

  it("guarda usuário, data e a mudança tipada — nunca o payload do provedor", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    await alterado(app, cliente.id, {
      cnpjRegistration: {
        ...blocoDaConsulta(cnpj),
        // Chaves cruas do OpenCNPJ que uma tela descuidada deixasse passar.
        opcao_simples: "S",
        matriz_filial: "Matriz",
        QSA: [{ nome: "SÓCIO" }],
      },
    });

    const [linha] = await linhasDoHistorico(cliente.id);
    expect(linha!.changedByNameSnapshot).toBe(USUARIO);
    expect(linha!.changedAt).toBeInstanceOf(Date);
    const cru = JSON.stringify(linha!.changes);
    for (const chave of ["opcao_simples", "matriz_filial", "QSA", "SÓCIO"]) expect(cru, chave).not.toContain(chave);
    for (const mudanca of linha!.changes as Record<string, unknown>[]) {
      expect(Object.keys(mudanca).sort()).toEqual(["after", "before", "field", "source"]);
    }
  });

  it("cliente com dados de antes desta versão não ganha histórico retroativo", async () => {
    const cnpj = uniqueCnpj();
    const legado = await getPrisma().customer.create({
      data: {
        code: `CLI-CNPJ-${marca()}`,
        legalName: `Cliente Legado ${marca()}`,
        cnpj,
        cnpjCompanySize: "Demais",
        cnpjLastConsultedAt: new Date(CONSULTA),
      },
    });
    clientes.push(legado.id);

    expect(await historico(app, legado.id)).toEqual([]);
    expect((await lerCliente(app, legado.id)).cnpjRegistration).toMatchObject({
      companySize: "Demais",
      lastConsultedAt: CONSULTA,
    });

    // A primeira gravação depois começa o histórico com o que mudou, e só isso.
    await alterado(app, legado.id, { cnpjRegistration: bloco(cnpj, { companySize: "Demais", meiOptIn: false }) });
    const [evento, ...resto] = await historico(app, legado.id);
    expect(resto).toEqual([]);
    expect(evento!.changes).toEqual([{ field: "meiOptIn", before: null, after: false, source: "MANUAL" }]);
  });

  it("cliente inexistente é 404; perfil só de leitura lê o histórico", async () => {
    const naoExiste = await app.inject({
      method: "GET",
      url: "/customers/00000000-0000-0000-0000-000000000000/cnpj-registration-history",
    });
    expect(naoExiste.statusCode).toBe(404);

    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });
    expect(await historico(buildTestApp("VIEWER"), cliente.id)).toHaveLength(1);
  });
});

describe("consultar não grava", () => {
  const app = buildTestApp("COMMERCIAL");

  it("a consulta sozinha não toca o cadastro nem o histórico; o consultedAt só vale no Salvar", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ cnpj, razao_social: "EMPRESA LTDA", porte_empresa: "Demais", opcao_mei: "" }), {
        status: 200,
      }),
    );

    const consulta = (await app.inject({ url: `/cnpj-lookup/${cnpj}` })).json() as CnpjLookupResult;

    expect((await lerCliente(app, cliente.id)).cnpjRegistration).toBeNull();
    expect(await historico(app, cliente.id)).toEqual([]);

    await alterado(app, cliente.id, {
      cnpjRegistration: bloco(cnpj, {
        companySize: consulta.company.companySize,
        consultedAt: consulta.consultedAt,
        sources: { companySize: "OPEN_CNPJ" },
      }),
    });
    const depois = await lerCliente(app, cliente.id);
    expect(depois.cnpjRegistration).toMatchObject({ companySize: "Demais", meiOptIn: null });
    expect(depois.cnpjRegistration?.lastConsultedAt).toBe(consulta.consultedAt);
  });
});

describe("o bloco é validado inteiro", () => {
  const app = buildTestApp("COMMERCIAL");

  it.each([
    ["Simples em texto", { simplesOptIn: "S" }],
    ["MEI em número", { meiOptIn: 1 }],
    ["data que não existe", { openedAt: "2024-02-30" }],
    ["data com hora", { registrationStatusDate: "2024-05-09T10:00:00Z" }],
    ["CNAE fora de sete dígitos", { mainCnaeCode: "12345" }],
    ["Matriz/Filial fora do enum", { establishmentType: "MATRIZ" }],
    ["porte acima do teto", { companySize: "P".repeat(101) }],
    ["consulta com data ilegível", { consultedAt: "ontem" }],
    ["consulta no futuro", { consultedAt: "2999-01-01T00:00:00.000Z" }],
    ["origem desconhecida", { sources: { companySize: "PLANILHA" } }],
    ["campo desconhecido na origem", { sources: { capitalSocial: "MANUAL" } }],
  ])("%s é 400, e nada é gravado", async (caso, extra) => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });

    const resposta = await alterar(app, cliente.id, { cnpjRegistration: { ...bloco(cnpj), ...extra } });

    expect(resposta.statusCode, `${caso}: ${resposta.body}`).toBe(400);
    expect(resposta.json().error, caso).toBe("validation_error");
    expect(await historico(app, cliente.id), caso).toEqual([]);
  });

  it("chave faltando no bloco é recusa — ausente não é 'vazio'", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj });
    const { meiOptIn: _fora, ...semMei } = bloco(cnpj);

    const resposta = await alterar(app, cliente.id, { cnpjRegistration: semMei });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().issues[0].path).toBe("cnpjRegistration.meiOptIn");
  });

  it("`cnpjRegistration: null` não existe mais: limpar é mandar os campos vazios", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(app, { cnpj, cnpjRegistration: blocoDaConsulta(cnpj) });

    const resposta = await alterar(app, cliente.id, { cnpjRegistration: null });

    expect(resposta.statusCode).toBe(400);
    expect(await historico(app, cliente.id)).toHaveLength(1);
  });
});

describe("quem grava", () => {
  it("perfil que não edita o cadastro recebe 403 e nada é gravado", async () => {
    const cnpj = uniqueCnpj();
    const cliente = await criado(buildTestApp("COMMERCIAL"), { cnpj });

    const resposta = await alterar(buildTestApp("PRODUCTION"), cliente.id, { cnpjRegistration: blocoDaConsulta(cnpj) });

    expect(resposta.statusCode).toBe(403);
    expect(await linhasDoHistorico(cliente.id)).toEqual([]);
  });
});
