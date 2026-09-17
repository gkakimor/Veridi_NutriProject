import { describe, expect, it } from "vitest";
import {
  CADASTROS_MESTRE,
  ROTULO_DO_CADASTRO_MESTRE,
  mensagemDeNomeDuplicado,
  nomeDeCadastroNormalizado,
  nomesDeCadastroIguais,
} from "./master-data-names.js";

/**
 * A regra de duplicidade que o PO fixou em 2026-09-17
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01): `trim` + sem caixa, acento
 * preservado.
 */

describe("nomeDeCadastroNormalizado", () => {
  it("trata caixa diferente como o MESMO nome", () => {
    expect(nomeDeCadastroNormalizado("abc")).toBe("ABC");
    expect(nomeDeCadastroNormalizado("Abc")).toBe(nomeDeCadastroNormalizado("ABC"));
    expect(nomesDeCadastroIguais("Abc", "aBC")).toBe(true);
  });

  it("ignora espaço nas pontas", () => {
    expect(nomeDeCadastroNormalizado("  Goma xantana ")).toBe("GOMA XANTANA");
    expect(nomeDeCadastroNormalizado("\t Ácido \n")).toBe("ÁCIDO");
    expect(nomesDeCadastroIguais("  Goma xantana ", "goma xantana")).toBe(true);
  });

  it("PRESERVA acento: ACIDO e ÁCIDO não são o mesmo nome", () => {
    expect(nomesDeCadastroIguais("ACIDO", "ÁCIDO")).toBe(false);
    expect(nomesDeCadastroIguais("Acido nicotinico", "Ácido nicotínico")).toBe(false);
    expect(nomesDeCadastroIguais("Sachê Silica gel 5g", "SACHÊ SÍLICA GEL 5G")).toBe(false);
  });

  it("não junta espaço interno — a regra do PO é o mínimo, e ampliar funde o que ninguém mandou", () => {
    expect(nomesDeCadastroIguais("Goma  xantana", "Goma xantana")).toBe(false);
  });

  it("nome vazio normaliza para vazio, sem estourar", () => {
    expect(nomeDeCadastroNormalizado("   ")).toBe("");
  });
});

describe("mensagem da recusa", () => {
  it("nomeia o cadastro e o código existente quando ele é conhecido", () => {
    expect(mensagemDeNomeDuplicado("ITEM", "MP-000458")).toBe(
      "Já existe um cadastro com este nome: Item MP-000458.",
    );
  });

  it("sem código, fica a frase que o PO pediu", () => {
    expect(mensagemDeNomeDuplicado("CUSTOMER")).toBe("Já existe um cadastro com este nome.");
    expect(mensagemDeNomeDuplicado("SUPPLIER", null)).toBe("Já existe um cadastro com este nome.");
  });

  it("todo cadastro do escopo tem rótulo de tela", () => {
    expect(CADASTROS_MESTRE).toHaveLength(9);
    for (const cadastro of CADASTROS_MESTRE) {
      expect(ROTULO_DO_CADASTRO_MESTRE[cadastro].length).toBeGreaterThan(3);
    }
  });
});
