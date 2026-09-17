import { describe, expect, it } from "vitest";
import { apiErrorMessage, parseJsonOrThrow } from "./api-errors";

/**
 * Nome de cadastro repetido chega à tela com a frase do PO
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * A API é a autoridade e manda a frase pronta, com o código do cadastro que
 * já usa o nome. O que este teste protege é o trecho que a pessoa lê: nunca
 * "Falha na requisição (409)", nunca `duplicate_name` cru.
 */

function resposta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const capturar = (promessa: Promise<unknown>): Promise<unknown> =>
  promessa.then(
    () => null,
    (erro: unknown) => erro,
  );

describe("409 duplicate_name", () => {
  it("a tela mostra a frase da API, com o código do cadastro existente", async () => {
    const erro = await capturar(
      parseJsonOrThrow(
        resposta(409, {
          error: "duplicate_name",
          message: "Já existe um cadastro com este nome: Item MP-000458.",
          existingCode: "MP-000458",
        }),
      ),
    );

    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe("Já existe um cadastro com este nome: Item MP-000458.");
    expect(apiErrorMessage(erro, "Falha ao salvar item")).toBe(
      "Já existe um cadastro com este nome: Item MP-000458.",
    );
  });

  it("resposta sem `message` ainda diz o que aconteceu, e não o status", async () => {
    const erro = await capturar(parseJsonOrThrow(resposta(409, { error: "duplicate_name" })));

    expect((erro as Error).message).toBe("Já existe um cadastro com este nome.");
    expect((erro as Error).message).not.toMatch(/409/);
  });

  it("não vira erro de validação de campo — é recusa de regra, com faixa própria", async () => {
    const erro = await capturar(
      parseJsonOrThrow(
        resposta(409, { error: "duplicate_name", message: "Já existe um cadastro com este nome." }),
      ),
    );

    expect((erro as Error).name).not.toBe("ApiValidationError");
    expect(apiErrorMessage(erro, "x")).not.toBe("Erro de validação");
  });
});
