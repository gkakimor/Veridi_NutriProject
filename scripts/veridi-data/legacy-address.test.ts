import { describe, expect, it } from "vitest";
import { parseLegacyAddress } from "./legacy-address.js";

/**
 * Parser de endereço legado.
 *
 * O que estes testes protegem não é a taxa de acerto: é a recusa em
 * inventar. Um cadastro de cliente com "S/N" e bairro "desconhecido" parece
 * completo e nunca mais é revisado — a falsa precisão custa mais caro que o
 * campo vazio.
 */

describe("Endereço legado", () => {
  it("decompõe o formato mais comum do corpus", () => {
    // O endereço real do cliente CLI-000004 da auditoria.
    const parsed = parseLegacyAddress("Rua Vicente José de Almeida, n° 158, bairro Cupece");
    expect(parsed.street).toBe("Rua Vicente José de Almeida");
    expect(parsed.number).toBe("158");
    expect(parsed.district).toBe("Cupece");
    expect(parsed.needsReview).toBe(false);
  });

  it("aceita as grafias de número que a planilha usa", () => {
    for (const grafia of ["n° 158", "nº 158", "no 158", "n 158", "nº158", "número 158"]) {
      const parsed = parseLegacyAddress(`Rua das Flores, ${grafia}, bairro Centro`);
      expect(parsed.number, grafia).toBe("158");
    }
  });

  it("aceita número sem rótulo quando a parte é só o número", () => {
    const parsed = parseLegacyAddress("Avenida Brasil, 1500, bairro Jardim");
    expect(parsed.street).toBe("Avenida Brasil");
    expect(parsed.number).toBe("1500");
    expect(parsed.district).toBe("Jardim");
  });

  it("preserva a letra do número", () => {
    expect(parseLegacyAddress("Rua A, n° 45B, bairro Centro").number).toBe("45B");
  });

  it("marca revisão quando o número não existe", () => {
    const parsed = parseLegacyAddress("Rua Sem Número, bairro Centro");
    expect(parsed.street).toBe("Rua Sem Número");
    expect(parsed.district).toBe("Centro");
    // Nada de "S/N": quem revisa é que decide.
    expect(parsed.number).toBeNull();
    expect(parsed.needsReview).toBe(true);
    expect(parsed.reviewReason).toContain("número");
  });

  it("não chuta bairro quando ele não vem rotulado", () => {
    // "Sala 4" seria capturado como bairro por qualquer heurística
    // posicional — e complemento é justamente o que aparece no legado.
    const parsed = parseLegacyAddress("Rua das Palmeiras, 200, Sala 4");
    expect(parsed.street).toBe("Rua das Palmeiras");
    expect(parsed.number).toBe("200");
    expect(parsed.district).toBeNull();
    expect(parsed.needsReview).toBe(true);
  });

  it("não confunde complemento numerado com número de porta", () => {
    const parsed = parseLegacyAddress("Rodovia BR-101, Km 13, bairro Industrial");
    // "Km 13" não é número de porta, e 13 sozinho não aparece como parte.
    expect(parsed.number).toBeNull();
    expect(parsed.district).toBe("Industrial");
    expect(parsed.needsReview).toBe(true);
  });

  it("recusa logradouro quando o texto não parece um", () => {
    const parsed = parseLegacyAddress("Contato pelo escritório central");
    expect(parsed.street).toBeNull();
    expect(parsed.needsReview).toBe(true);
  });

  it("vazio não é revisão — é ausência", () => {
    for (const entrada of [null, undefined, "", "   "]) {
      const parsed = parseLegacyAddress(entrada);
      expect(parsed.street).toBeNull();
      expect(parsed.needsReview).toBe(false);
    }
  });

  it("aceita bairro abreviado", () => {
    expect(parseLegacyAddress("Rua X, 10, b. Vila Nova").district).toBe("Vila Nova");
  });

  it("nunca devolve string vazia no lugar de null", () => {
    const parsed = parseLegacyAddress("Rua Y, n° 1, bairro:");
    expect(parsed.district).toBeNull();
  });
});
