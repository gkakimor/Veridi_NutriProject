import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiValidationError } from "./api-errors";
import {
  StockCountApiError,
  StockCountSendFailedError,
  getStockCount,
  isStockCountApiError,
  registerStockCountEntry,
  startStockCount,
} from "./stock-counts-api";
import { posicaoContada } from "../pages/inventory/testing/inventario-fixtures";

/**
 * Recusas do Inventário Físico com o corpo inteiro — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * `parseJsonOrThrow` entrega só a frase. A tela do inventário precisa do delta
 * do escopo, da posição atual no conflito e de quantas faltam; e precisa saber
 * quando a contagem pode não ter chegado ao servidor — para reenviar com o
 * mesmo identificador, e não recusar.
 */

function responder(status: number, corpo: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ENTRADA = { round: 1, expectedLastEntryId: null, countedQuantity: "5", clientRequestId: "0f8fad5b-d9cb-469f-a165-70867728950e" };

describe("erro tipado do Inventário Físico", () => {
  it("409 do escopo que mudou preserva status, código e o delta", async () => {
    vi.stubGlobal(
      "fetch",
      responder(409, { error: "scope_changed", message: "As posições mudaram.", added: ["a"], removed: ["b", "c"] }),
    );
    const falha = await startStockCount({ mode: "BLIND", scope: { balance: "WITH_BALANCE" } }).catch((erro: unknown) => erro);
    expect(falha).toBeInstanceOf(StockCountApiError);
    expect(isStockCountApiError(falha, "scope_changed")).toBe(true);
    const erro = falha as StockCountApiError;
    expect(erro.status).toBe(409);
    expect(erro.message).toBe("As posições mudaram.");
    expect(erro.body.added).toEqual(["a"]);
    expect(erro.body.removed).toEqual(["b", "c"]);
  });

  it("409 de conflito de registro traz a posição atual", async () => {
    const atual = posicaoContada({}, { id: "e-bruno", countedByName: "Bruno Produção", countedQuantity: "7" });
    vi.stubGlobal("fetch", responder(409, { error: "stock_count_entry_conflict", message: "A posição mudou.", position: atual }));
    const falha = await registerStockCountEntry("inv-1", "p-1", ENTRADA).catch((erro: unknown) => erro);
    expect(isStockCountApiError(falha, "stock_count_entry_conflict")).toBe(true);
    expect((falha as StockCountApiError).body.position?.entries[0]?.countedByName).toBe("Bruno Produção");
  });

  it("validação continua sendo ApiValidationError, com as issues", async () => {
    vi.stubGlobal(
      "fetch",
      responder(400, { error: "validation_error", issues: [{ path: "clientRequestId", message: "Identificador do envio inválido" }] }),
    );
    const falha = await registerStockCountEntry("inv-1", "p-1", ENTRADA).catch((erro: unknown) => erro);
    expect(falha).toBeInstanceOf(ApiValidationError);
    expect(falha).not.toBeInstanceOf(StockCountApiError);
  });

  it("rede caída e servidor fora viram falha de envio — reenviar é seguro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const semRede = await registerStockCountEntry("inv-1", "p-1", ENTRADA).catch((erro: unknown) => erro);
    expect(semRede).toBeInstanceOf(StockCountSendFailedError);
    expect((semRede as StockCountSendFailedError).status).toBeNull();

    vi.stubGlobal("fetch", responder(503, { error: "unavailable" }));
    const foraDoAr = await registerStockCountEntry("inv-1", "p-1", ENTRADA).catch((erro: unknown) => erro);
    expect(foraDoAr).toBeInstanceOf(StockCountSendFailedError);
    expect((foraDoAr as StockCountSendFailedError).status).toBe(503);
  });

  it("a leitura pedida vai no endereço, sem padrão escondido", async () => {
    const fetch = responder(200, {});
    vi.stubGlobal("fetch", fetch);
    await getStockCount("inv-1", "counting");
    expect(String((fetch.mock.calls[0] as unknown[] | undefined)?.[0])).toMatch(/\/stock-counts\/inv-1\?view=counting$/);
  });
});
