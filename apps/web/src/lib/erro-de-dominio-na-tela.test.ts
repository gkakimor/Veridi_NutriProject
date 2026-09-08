import { describe, expect, it } from "vitest";
import { apiErrorMessage, parseJsonOrThrow } from "./api-errors";

/**
 * Recusa de regra de negócio chega à tela com as palavras do domínio.
 *
 * `CustomerMismatchError` escapava de `apply-fulfillment-plan` sem
 * mapeamento e voltava como 500. A mensagem certa aparecia por acidente — o
 * handler genérico do Fastify também carrega `message` —, e o preço era um
 * erro de servidor no console para uma recusa que o próprio pedido causou.
 *
 * Com o status corrigido para 400, o que precisa continuar verdadeiro é o
 * texto: a faixa da tela mostra "Cliente inconsistente…", nunca "Erro de
 * validação" (que é a string fixa de `ApiValidationError`) nem o genérico
 * por status. Este teste protege esse trecho do contrato, que é o único que
 * a pessoa lê.
 */

function resposta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MENSAGEM =
  "Cliente inconsistente: o produto pertence a G S TEZOTTO e o pedido a VERIDI NUTRITION SUPLEMENTOS ALIMENTARES LTDA.";

describe("erro de domínio 400 com `message`", () => {
  it("a tela recebe a mensagem do domínio, não um texto por status", async () => {
    const erro = await parseJsonOrThrow(
      resposta(400, { error: "customer_mismatch", message: MENSAGEM }),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe(MENSAGEM);
    expect(apiErrorMessage(erro, "Falha ao aplicar o Plano de Atendimento")).toBe(MENSAGEM);
  });

  it("não vira 'Erro de validação' nem cai no fallback da tela", async () => {
    const erro = await parseJsonOrThrow(
      resposta(400, { error: "customer_mismatch", message: MENSAGEM }),
    ).catch((e: unknown) => e);

    const texto = apiErrorMessage(erro, "Falha ao aplicar o Plano de Atendimento");
    expect(texto).not.toMatch(/Erro de validação/i);
    expect(texto).not.toMatch(/Erro interno do servidor/i);
    expect(texto).not.toMatch(/Falha na requisição/i);
    expect(texto).not.toBe("Falha ao aplicar o Plano de Atendimento");
  });
});
