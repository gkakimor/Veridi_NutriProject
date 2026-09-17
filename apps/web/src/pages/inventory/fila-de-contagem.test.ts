import { beforeEach, describe, expect, it } from "vitest";
import type { EnvioDeContagem } from "./fila-de-contagem";
import { chaveDaFila, guardarEnvio, lerFila, tirarEnvio } from "./fila-de-contagem";

/**
 * Fila local de contagens — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * Por usuário e por inventário, só com o que a contagem precisa: nunca saldo,
 * esperado ou diferença, nem quando o objeto chega com eles por engano.
 */

const ANA = "user-ana";
const BRUNO = "user-bruno";
const INV = "inv-1";

function envio(overrides: Partial<EnvioDeContagem> = {}): EnvioDeContagem {
  return {
    positionId: "p-1",
    round: 1,
    expectedLastEntryId: null,
    countedQuantity: "12.5",
    clientRequestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("fila local de contagens", () => {
  it("é de um usuário num inventário: a fila de Ana não aparece para Bruno nem noutro inventário", () => {
    guardarEnvio(ANA, INV, envio());
    expect(lerFila(ANA, INV)).toHaveLength(1);
    expect(lerFila(BRUNO, INV)).toEqual([]);
    expect(lerFila(ANA, "inv-2")).toEqual([]);
    expect(window.localStorage.getItem(chaveDaFila(ANA, INV))).not.toBeNull();
  });

  it("guarda só posição, rodada, trava, quantidade, id e nota — nada de saldo", () => {
    const comSaldo = { ...envio({ note: "caixa amassada" }), expectedQuantity: "13", referenceQuantity: "13", difference: "-0.5" };
    guardarEnvio(ANA, INV, comSaldo as EnvioDeContagem);
    const bruto = JSON.parse(window.localStorage.getItem(chaveDaFila(ANA, INV)) ?? "[]") as Record<string, unknown>[];
    expect(Object.keys(bruto[0] ?? {}).sort()).toEqual(
      ["clientRequestId", "countedQuantity", "expectedLastEntryId", "note", "positionId", "round"].sort(),
    );
  });

  it("uma pendência por posição: contar de novo substitui; tirar tira só aquele envio", () => {
    guardarEnvio(ANA, INV, envio());
    guardarEnvio(ANA, INV, envio({ countedQuantity: "13", clientRequestId: "a4f4f6f2-1111-4c4c-8d8d-000000000001" }));
    guardarEnvio(ANA, INV, envio({ positionId: "p-2", clientRequestId: "a4f4f6f2-1111-4c4c-8d8d-000000000002" }));
    expect(lerFila(ANA, INV).map((item) => [item.positionId, item.countedQuantity])).toEqual([
      ["p-1", "13"],
      ["p-2", "12.5"],
    ]);

    tirarEnvio(ANA, INV, "0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(lerFila(ANA, INV)).toHaveLength(2);
    tirarEnvio(ANA, INV, "a4f4f6f2-1111-4c4c-8d8d-000000000001");
    tirarEnvio(ANA, INV, "a4f4f6f2-1111-4c4c-8d8d-000000000002");
    expect(lerFila(ANA, INV)).toEqual([]);
    expect(window.localStorage.getItem(chaveDaFila(ANA, INV))).toBeNull();
  });

  it("conteúdo estragado no armazenamento não derruba a tela", () => {
    window.localStorage.setItem(chaveDaFila(ANA, INV), "{não é json");
    expect(lerFila(ANA, INV)).toEqual([]);
    window.localStorage.setItem(chaveDaFila(ANA, INV), JSON.stringify([{ positionId: 1 }, envio()]));
    expect(lerFila(ANA, INV)).toEqual([envio()]);
  });
});
