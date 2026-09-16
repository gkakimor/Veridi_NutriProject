import { afterAll, describe, expect, it } from "vitest";
import { PaymentInstrument } from "@prisma/client";
import type { UserRole } from "@prisma/client";
import {
  PARCELADO_SEM_PARCELAS_MESSAGE,
  PAYMENT_INSTRUMENTS,
  PAYMENT_INSTRUMENT_LABELS,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Pagamento padrão do Cliente — CUSTOMER-PAYMENT-DEFAULTS-01.
 *
 * O Cliente guarda forma e condição de pagamento OPCIONAIS, como sugestão para
 * orçamentos novos. O que estes casos fixam é o contrato do cadastro: tudo nasce
 * `null` e nada é inventado; o PATCH só mexe no que pede; condição à vista ou não
 * informada não guarda parcelamento; parcelado sem parcelas não se grava; os
 * limites são os das condições do Orçamento; e só Comercial e Administrador
 * alteram — os outros perfis leem.
 */

const clientes: string[] = [];

afterAll(async () => {
  if (clientes.length === 0) return;
  await getPrisma().customer.deleteMany({ where: { id: { in: clientes } } });
});

type App = ReturnType<typeof buildTestApp>;

const CAMPOS = [
  "defaultPaymentInstrument",
  "defaultPaymentMethod",
  "defaultDownPaymentPercent",
  "defaultInstallmentCount",
  "defaultInstallmentIntervalDays",
  "defaultMonthlyInterestPercent",
] as const;

const SEM_PADRAO = Object.fromEntries(CAMPOS.map((campo) => [campo, null]));

const PARCELADO_COMPLETO = {
  defaultPaymentInstrument: "BOLETO",
  defaultPaymentMethod: "INSTALLMENTS",
  defaultDownPaymentPercent: "30",
  defaultInstallmentCount: 3,
  defaultInstallmentIntervalDays: 45,
  defaultMonthlyInterestPercent: "1.5",
};

/** Como o parcelado completo volta da API — percentuais com quatro casas. */
const PARCELADO_LIDO = {
  defaultPaymentInstrument: "BOLETO",
  defaultPaymentMethod: "INSTALLMENTS",
  defaultDownPaymentPercent: "30.0000",
  defaultInstallmentCount: 3,
  defaultInstallmentIntervalDays: 45,
  defaultMonthlyInterestPercent: "1.5000",
};

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criar(app: App, extra: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Pagamento ${marca()}`, ...extra },
  });
  if (resposta.statusCode === 201) clientes.push(resposta.json().id);
  return resposta;
}

async function criado(app: App, extra: Record<string, unknown> = {}): Promise<string> {
  const resposta = await criar(app, extra);
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json().id;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/customers/${id}`, payload });
}

async function padraoLido(app: App, id: string) {
  const resposta = await app.inject({ method: "GET", url: `/customers/${id}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  const cliente = resposta.json();
  return Object.fromEntries(CAMPOS.map((campo) => [campo, cliente[campo]]));
}

describe("Pagamento padrão — o contrato", () => {
  it("o enum do banco, a lista do contrato e os rótulos têm as mesmas cinco formas", () => {
    expect(Object.values(PaymentInstrument)).toEqual([...PAYMENT_INSTRUMENTS]);
    expect(PAYMENT_INSTRUMENT_LABELS).toEqual({
      PIX: "PIX",
      BOLETO: "Boleto",
      BANK_TRANSFER: "Transferência",
      CARD: "Cartão",
      OTHER: "Outro",
    });
  });
});

describe("Pagamento padrão — nada é inventado", () => {
  const app = buildTestApp("COMMERCIAL");

  it("cliente criado sem padrão: os seis campos nascem null, no POST e no GET", async () => {
    const resposta = await criar(app);
    expect(resposta.statusCode, resposta.body).toBe(201);
    const corpo = resposta.json();
    for (const campo of CAMPOS) expect(corpo[campo], campo).toBeNull();
    expect(await padraoLido(app, corpo.id)).toEqual(SEM_PADRAO);
  });

  it("cliente que já existia (sem as colunas preenchidas) é lido inteiro em null", async () => {
    const prisma = getPrisma();
    const legado = await prisma.customer.create({
      data: { code: `CLI-PAG-${marca()}`, legalName: `Cliente Legado ${marca()}` },
    });
    clientes.push(legado.id);
    expect(await padraoLido(app, legado.id)).toEqual(SEM_PADRAO);
  });

  it("alterar outro campo do cadastro não mexe no padrão gravado", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { notes: "Só a nota" });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual(PARCELADO_LIDO);
  });
});

describe("Pagamento padrão — definir, limpar e PATCH parcial", () => {
  const app = buildTestApp("COMMERCIAL");

  it("criar com forma e condição parcelada completa grava o bloco inteiro", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    expect(await padraoLido(app, id)).toEqual(PARCELADO_LIDO);
  });

  it("definir depois, por PATCH, grava o bloco inteiro", async () => {
    const id = await criado(app);
    const resposta = await alterar(app, id, PARCELADO_COMPLETO);
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual(PARCELADO_LIDO);
  });

  it("null limpa: forma e condição voltam a não informadas, e o parcelamento sai junto", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, {
      defaultPaymentInstrument: null,
      defaultPaymentMethod: null,
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual(SEM_PADRAO);
  });

  it("PATCH só da forma não mexe na condição", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { defaultPaymentInstrument: "PIX" });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual({ ...PARCELADO_LIDO, defaultPaymentInstrument: "PIX" });
  });

  it("PATCH só das parcelas mantém o parcelado e os outros campos do bloco", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { defaultInstallmentCount: 6 });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual({ ...PARCELADO_LIDO, defaultInstallmentCount: 6 });
  });

  it("PATCH só da condição à vista mantém a forma", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { defaultPaymentMethod: "CASH" });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect((await padraoLido(app, id)).defaultPaymentInstrument).toBe("BOLETO");
  });
});

describe("Pagamento padrão — à vista não guarda parcelamento", () => {
  const app = buildTestApp("COMMERCIAL");

  it("trocar para à vista limpa entrada, parcelas, intervalo e juros", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { defaultPaymentMethod: "CASH" });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual({
      ...SEM_PADRAO,
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
    });
  });

  it("criar à vista com parcelamento no corpo: o parcelamento não é gravado", async () => {
    const id = await criado(app, { ...PARCELADO_COMPLETO, defaultPaymentMethod: "CASH" });
    expect(await padraoLido(app, id)).toEqual({
      ...SEM_PADRAO,
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
    });
  });

  it("parcelas sem condição informada não são gravadas", async () => {
    const id = await criado(app);
    const resposta = await alterar(app, id, { defaultInstallmentCount: 4 });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual(SEM_PADRAO);
  });
});

describe("Pagamento padrão — parcelado exige parcelas", () => {
  const app = buildTestApp("COMMERCIAL");
  const RECUSA = {
    error: "validation_error",
    message: PARCELADO_SEM_PARCELAS_MESSAGE,
    issues: [{ path: "defaultInstallmentCount", message: PARCELADO_SEM_PARCELAS_MESSAGE }],
  };

  it("criar parcelado sem parcelas é recusado, e nenhum cliente nasce", async () => {
    const legalName = `Cliente Parcelado Vazio ${marca()}`;
    const resposta = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName, defaultPaymentMethod: "INSTALLMENTS", defaultDownPaymentPercent: "20" },
    });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
    expect(await getPrisma().customer.count({ where: { legalName } })).toBe(0);
  });

  it("PATCH para parcelado sobre condição à vista, sem parcelas, é recusado e o gravado fica", async () => {
    const id = await criado(app, { defaultPaymentMethod: "CASH", defaultPaymentInstrument: "PIX" });
    const antes = await padraoLido(app, id);
    const resposta = await alterar(app, id, { defaultPaymentMethod: "INSTALLMENTS" });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
    expect(await padraoLido(app, id)).toEqual(antes);
  });

  it("PATCH que apaga as parcelas de um parcelado é recusado e o gravado fica", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { defaultInstallmentCount: null });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual(RECUSA);
    expect(await padraoLido(app, id)).toEqual(PARCELADO_LIDO);
  });

  it("a recusa desfaz o PATCH inteiro — outro campo do mesmo corpo também não grava", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { notes: "Não pode gravar", defaultInstallmentCount: null });
    expect(resposta.statusCode, resposta.body).toBe(400);
    const lido = (await app.inject({ method: "GET", url: `/customers/${id}` })).json();
    expect(lido.notes).toBeNull();
  });
});

describe("Pagamento padrão — os limites das condições do Orçamento", () => {
  const app = buildTestApp("COMMERCIAL");

  it.each([
    ["defaultInstallmentCount", 121],
    ["defaultInstallmentCount", 0],
    ["defaultInstallmentCount", "abc"],
    ["defaultInstallmentIntervalDays", 366],
    ["defaultInstallmentIntervalDays", -1],
    ["defaultDownPaymentPercent", "100"],
    ["defaultDownPaymentPercent", "abc"],
    ["defaultMonthlyInterestPercent", "100.01"],
    ["defaultPaymentInstrument", "CHEQUE"],
    ["defaultPaymentMethod", "FIADO"],
  ] as const)("%s = %j: 400 no campo, e o gravado fica", async (campo, valor) => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, { [campo]: valor });
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json().issues.map((issue: { path: string }) => issue.path)).toContain(campo);
    expect(await padraoLido(app, id)).toEqual(PARCELADO_LIDO);
  });

  it("nos limites passa: 120 parcelas a cada 365 dias, entrada de 99,99% e juros de 100%", async () => {
    const id = await criado(app, PARCELADO_COMPLETO);
    const resposta = await alterar(app, id, {
      defaultInstallmentCount: 120,
      defaultInstallmentIntervalDays: 365,
      defaultDownPaymentPercent: "99,99",
      defaultMonthlyInterestPercent: "100",
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await padraoLido(app, id)).toEqual({
      ...PARCELADO_LIDO,
      defaultInstallmentCount: 120,
      defaultInstallmentIntervalDays: 365,
      defaultDownPaymentPercent: "99.9900",
      defaultMonthlyInterestPercent: "100.0000",
    });
  });
});

describe("Pagamento padrão — quem altera e quem lê", () => {
  const PODEM_EDITAR = ["ADMIN", "COMMERCIAL"] as const satisfies readonly UserRole[];
  const SO_CONSULTAM = ["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"] as const satisfies readonly UserRole[];

  it.each(PODEM_EDITAR)("%s define o padrão", async (perfil) => {
    const app = buildTestApp(perfil);
    const id = await criado(app);
    const resposta = await alterar(app, id, PARCELADO_COMPLETO);
    expect(resposta.statusCode, resposta.body).toBe(200);
  });

  it.each(SO_CONSULTAM)("%s não define nem cria com padrão (403), mas lê o padrão", async (perfil) => {
    const comercial = buildTestApp("COMMERCIAL");
    const id = await criado(comercial, PARCELADO_COMPLETO);
    const app = buildTestApp(perfil);

    const alteracao = await alterar(app, id, { defaultPaymentInstrument: "PIX" });
    expect(alteracao.statusCode, alteracao.body).toBe(403);
    const criacao = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName: `Recusado ${marca()}`, ...PARCELADO_COMPLETO },
    });
    expect(criacao.statusCode, criacao.body).toBe(403);

    expect(await padraoLido(app, id)).toEqual(PARCELADO_LIDO);
  });
});
