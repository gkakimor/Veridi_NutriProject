import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { buildApp } from "./app.js";
import { DuplicateMasterDataNameError } from "./lib/nome-de-cadastro-mestre.js";
import { createAuthenticatedUser } from "./test-support/authenticated-app.js";

/**
 * Tratador global de erros da API (API-GLOBAL-ERROR-HANDLER-01).
 *
 * `app.ts` especializa UM erro — nome de cadastro mestre repetido vira 409
 * `duplicate_name` — e todo o resto tem de chegar ao tratador padrão do
 * Fastify como se não houvesse tratador nenhum: o status do erro (ou 500), a
 * mensagem original no corpo e UM log, o do erro original.
 *
 * As rotas `/__teste/*` existem só neste arquivo e lançam o erro que cada caso
 * pede. O JSON inválido vai a uma rota real: quem o recusa é o parser do
 * Fastify, antes do handler. `buildApp()` direto, e não `buildTestApp()`,
 * porque rota e gancho só entram antes do `ready()` — a sessão é a mesma, real.
 */

const app = buildApp();
let cookie = "";
let erroLancado: Error | undefined;
/** `log.error` de cada requisição do caso: o tratador padrão loga no logger da requisição. */
let logsDeErro: MockInstance[] = [];

beforeAll(async () => {
  app.addHook("onRequest", async (request) => {
    logsDeErro.push(vi.spyOn(request.log, "error"));
  });
  app.get("/__teste/erro-generico", async () => {
    erroLancado = new Error("erro original de teste");
    throw erroLancado;
  });
  app.get("/__teste/erro-com-status", async () => {
    throw Object.assign(new Error("carga acima do limite de teste"), { statusCode: 413 });
  });
  app.get("/__teste/nome-duplicado", async () => {
    throw new DuplicateMasterDataNameError("SUPPLIER", "Fornecedor Repetido", "FOR-0001");
  });
  await app.ready();
  ({ cookie } = await createAuthenticatedUser());
});

beforeEach(() => {
  logsDeErro = [];
  erroLancado = undefined;
});

afterAll(async () => {
  await app.close();
});

/** O `err` de cada `log.error` das requisições do caso, na ordem. */
const errosLogados = (): unknown[] =>
  logsDeErro.flatMap((espiao) =>
    espiao.mock.calls.map((chamada) => (chamada[0] as { err?: unknown } | undefined)?.err),
  );

describe("erro sem tratamento próprio segue o tratador padrão do Fastify", () => {
  it("erro genérico: 500 com a mensagem ORIGINAL e um log só, do erro original", async () => {
    const resposta = await app.inject({ method: "GET", url: "/__teste/erro-generico", headers: { cookie } });

    expect(resposta.statusCode, resposta.body).toBe(500);
    expect(resposta.json()).toEqual({
      statusCode: 500,
      error: "Internal Server Error",
      message: "erro original de teste",
    });
    expect(erroLancado).toBeInstanceOf(Error);
    const logados = errosLogados();
    expect(logados, String(logados)).toHaveLength(1);
    expect(logados[0]).toBe(erroLancado);
  });

  it("erro com statusCode próprio: o status (413) e a mensagem são preservados", async () => {
    const resposta = await app.inject({ method: "GET", url: "/__teste/erro-com-status", headers: { cookie } });

    expect(resposta.statusCode, resposta.body).toBe(413);
    expect(resposta.json()).toEqual({
      statusCode: 413,
      error: "Payload Too Large",
      message: "carga acima do limite de teste",
    });
  });

  it("JSON malformado numa rota que espera JSON: 400 do parser do Fastify, nunca 500", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/suppliers",
      headers: { cookie, "content-type": "application/json" },
      payload: '{"legalName": ',
    });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual({
      statusCode: 400,
      code: "FST_ERR_CTP_INVALID_JSON_BODY",
      error: "Bad Request",
      message: "Body is not valid JSON but content-type is set to 'application/json'",
    });
  });
});

describe("nome de cadastro mestre repetido continua especializado", () => {
  it("DuplicateMasterDataNameError: 409 duplicate_name com a frase e o código existente", async () => {
    const resposta = await app.inject({ method: "GET", url: "/__teste/nome-duplicado", headers: { cookie } });
    const esperado = new DuplicateMasterDataNameError("SUPPLIER", "Fornecedor Repetido", "FOR-0001");

    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json()).toEqual({
      error: "duplicate_name",
      message: esperado.message,
      existingCode: "FOR-0001",
    });
  });
});
