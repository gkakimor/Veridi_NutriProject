import { describe, expect, it, vi } from "vitest";
import {
  AlreadyExistsApiError,
  ConsumptionAlreadyCountedApiError,
  apiErrorMessage,
  parseJsonOrThrow,
} from "./api-errors";

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

/*
 * O cadastro do Item leva à relação Item × Fornecedor que já existe
 * (ITEM-SUPPLIER-UX-01): precisa distinguir a recusa de duplicidade sem comparar
 * texto, e quem só mostra a mensagem continua lendo a mesma frase.
 */
describe("409 `already_exists`", () => {
  const DUPLICADA = "Este fornecedor já está cadastrado para o item.";

  it("vira AlreadyExistsApiError com a mensagem da API", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const erro = await parseJsonOrThrow(
      resposta(409, { error: "already_exists", message: DUPLICADA }),
    ).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(AlreadyExistsApiError);
    expect(apiErrorMessage(erro, "Falha ao criar a relação")).toBe(DUPLICADA);
  });

  it("outro 409 continua erro comum", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const erro = await parseJsonOrThrow(
      resposta(409, {
        error: "not_eligible_preferred",
        message: "Só um fornecedor homologado e ativo pode ser o preferencial do item.",
      }),
    ).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(AlreadyExistsApiError);
  });
});

/*
 * Consumo interno de data passada que um inventário já contou
 * (INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01): a tela mostra a frase da API
 * e leva ao inventário — precisa do id sem comparar texto.
 */
describe("409 do consumo de data passada já contado", () => {
  it.each(["backdated_consumption_after_count", "backdated_consumption_in_open_count"])(
    "%s vira ConsumptionAlreadyCountedApiError com a mensagem e o inventário",
    async (codigo) => {
      const mensagem = `Consumo com data de 15/09/2026 recusado (${codigo}).`;
      const erro = await parseJsonOrThrow(
        resposta(409, { error: codigo, message: mensagem, stockCountId: "inv-12", stockCountCode: "INV-000012" }),
      ).catch((e: unknown) => e);

      expect(erro, codigo).toBeInstanceOf(ConsumptionAlreadyCountedApiError);
      expect(apiErrorMessage(erro, "Falha ao registrar o consumo"), codigo).toBe(mensagem);
      expect((erro as ConsumptionAlreadyCountedApiError).stockCountId, codigo).toBe("inv-12");
      expect((erro as ConsumptionAlreadyCountedApiError).stockCountCode, codigo).toBe("INV-000012");
    },
  );

  it("o 409 de estorno com inventário continua erro comum", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const erro = await parseJsonOrThrow(
      resposta(409, { error: "position_in_open_count", message: "Posição em inventário aberto.", stockCountCode: "INV-1" }),
    ).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(ConsumptionAlreadyCountedApiError);
  });
});
