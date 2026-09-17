import { describe, expect, it, vi } from "vitest";
import { novoIdDeEnvio, uuidV4DeBytes } from "./id-de-envio";

/**
 * O identificador do envio da contagem — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * O tablet do depósito abre o sistema por `http://<IP da rede local>`, fora de
 * contexto seguro, e ali `crypto.randomUUID` não existe (ou recusa a chamada).
 * O id sai de `crypto.getRandomValues` e tem de passar no schema da API:
 * `z.string().uuid()`, cuja expressão está copiada abaixo.
 */

/** A expressão de UUID do zod 3 (`z.string().uuid()`), a mesma que a API aplica. */
const UUID_DO_ZOD = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function aleatorio(): Pick<Crypto, "getRandomValues"> {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(destino: T): T => {
      const bytes = destino as unknown as Uint8Array;
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
      return destino;
    },
  };
}

describe("identificador do envio da contagem", () => {
  it("em contexto seguro usa o randomUUID do navegador", () => {
    const randomUUID = vi.fn(() => "0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(novoIdDeEnvio({ ...aleatorio(), randomUUID })).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("sem randomUUID (http na rede local) gera UUID v4 que a API aceita", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = novoIdDeEnvio(aleatorio());
      expect(id).toMatch(UUID_DO_ZOD);
      expect(id).toMatch(UUID_V4);
      vistos.add(id);
    }
    expect(vistos.size).toBe(200);
  });

  it("randomUUID presente mas recusado fora de contexto seguro também cai no gerador próprio", () => {
    const id = novoIdDeEnvio({
      ...aleatorio(),
      randomUUID: () => {
        throw new DOMException("insecure", "SecurityError");
      },
    });
    expect(id).toMatch(UUID_V4);
  });

  it("versão e variante ficam nos bits certos mesmo com bytes extremos", () => {
    expect(uuidV4DeBytes(new Uint8Array(16).fill(0xff))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuidV4DeBytes(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
    expect(() => uuidV4DeBytes(new Uint8Array(15))).toThrow();
  });
});
