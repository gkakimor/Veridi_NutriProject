import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PricingVersionDTO } from "@veridi/shared";

/**
 * Ausência de precificação vigente é ESTADO, não recurso ausente (BACKLOG #16).
 *
 * A consulta respondia 404 para um produto sem precificação ativa. A tela
 * tratava a ausência certo, mas o navegador registrava um erro de console a
 * cada consulta de uma tela sã. Agora a ausência chega em 200, dentro do
 * envelope, e 404 volta a significar só o que deve: a linha não existe.
 */

vi.mock("./api", () => ({
  API_URL: "http://api.test",
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./api";
import { getQuotePricingOptions } from "./projects-api";

function resposta(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("#16 — opções de precificação da linha do orçamento", () => {
  it("ausência de precificação vigente é 200 e vira ausência, sem erro", async () => {
    vi.mocked(apiFetch).mockResolvedValue(resposta(200, { pricing: null }));

    await expect(getQuotePricingOptions("ql-1")).resolves.toBeNull();
  });

  it("precificação vigente chega dentro do envelope", async () => {
    const pricing = { id: "prec-1", code: "PREC-000001", tiers: [] } as unknown as PricingVersionDTO;
    vi.mocked(apiFetch).mockResolvedValue(resposta(200, { pricing }));

    await expect(getQuotePricingOptions("ql-1")).resolves.toBe(pricing);
  });

  it("linha inexistente continua sendo erro — 404 não vira 'sem preço'", async () => {
    vi.mocked(apiFetch).mockResolvedValue(resposta(404, { error: "not_found" }));

    // Mascarar recurso ausente como ausência de precificação esconderia o
    // defeito real: a linha que a tela consultou não existe.
    await expect(getQuotePricingOptions("ql-inexistente")).rejects.toThrow();
  });

  it("erro do servidor não é confundido com ausência de precificação", async () => {
    vi.mocked(apiFetch).mockResolvedValue(resposta(500, { error: "internal_error" }));

    await expect(getQuotePricingOptions("ql-1")).rejects.toThrow();
  });
});
