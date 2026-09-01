import { describe, expect, it } from "vitest";
import {
  formatBrPhone,
  formatCnpj,
  isValidBrPhone,
  isValidCnpj,
  isValidEmail,
  maskCnpjInput,
  maskPhoneInput,
  normalizeCnpj,
  normalizePhone,
} from "@veridi/shared";
import { optionalCnpjSchema } from "./cnpj-schema.js";
import { optionalBrPhoneSchema, optionalEmailSchema } from "./contact-schema.js";

/**
 * Validação pura de CNPJ, e-mail e telefone. Sem banco e sem HTTP: o que se
 * afirma aqui é a regra, não a rota.
 */

describe("CNPJ", () => {
  it("valida o CNPJ numérico de sempre", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("rejeita CNPJ numérico com dígito verificador errado", () => {
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("11222333000191")).toBe(false);
  });

  it("valida o CNPJ alfanumérico do exemplo oficial", () => {
    // 00.000.000/E08G-12 — formato divulgado pela Receita Federal.
    expect(isValidCnpj("00000000E08G12")).toBe(true);
    expect(isValidCnpj("00.000.000/E08G-12")).toBe(true);
  });

  it("rejeita CNPJ alfanumérico com dígito verificador errado", () => {
    expect(isValidCnpj("00000000E08G13")).toBe(false);
    expect(isValidCnpj("00000000E08G11")).toBe(false);
  });

  it("rejeita dígito verificador com letra — o DV é sempre numérico", () => {
    expect(isValidCnpj("00000000E08GA2")).toBe(false);
  });

  it("rejeita comprimento errado e repetição total", () => {
    expect(isValidCnpj("123456")).toBe(false);
    expect(isValidCnpj("112223330001811")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });

  it("normaliza sem destruir as letras", () => {
    expect(normalizeCnpj("00.000.000/e08g-12")).toBe("00000000E08G12");
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("formata as duas formas", () => {
    expect(formatCnpj("00000000E08G12")).toBe("00.000.000/E08G-12");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("mascara enquanto o operador digita, sem exigir o valor completo", () => {
    expect(maskCnpjInput("11")).toBe("11");
    expect(maskCnpjInput("11222")).toBe("11.222");
    expect(maskCnpjInput("11222333")).toBe("11.222.333");
    expect(maskCnpjInput("00000000e08g")).toBe("00.000.000/E08G");
    expect(maskCnpjInput("00000000e08g12")).toBe("00.000.000/E08G-12");
  });
});

describe("optionalCnpjSchema", () => {
  it("aceita vazio e ausente — o campo é opcional", () => {
    expect(optionalCnpjSchema.parse(undefined)).toBeUndefined();
    expect(optionalCnpjSchema.parse("")).toBeNull();
  });

  it("aceita numérico e alfanumérico, guardando normalizado", () => {
    expect(optionalCnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181");
    expect(optionalCnpjSchema.parse("00.000.000/e08g-12")).toBe("00000000E08G12");
  });

  it("recusa dígito verificador inválido", () => {
    expect(optionalCnpjSchema.safeParse("11222333000180").success).toBe(false);
    expect(optionalCnpjSchema.safeParse("00000000E08G13").success).toBe(false);
  });

  it("recusa comprimento errado com mensagem própria", () => {
    const result = optionalCnpjSchema.safeParse("123456");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("14");
    }
  });
});

describe("E-mail", () => {
  it("aceita endereços comuns", () => {
    expect(isValidEmail("contato@veridi.com.br")).toBe(true);
    expect(isValidEmail("maria.souza+erp@empresa.io")).toBe(true);
  });

  it("recusa o que não tem formato de e-mail", () => {
    expect(isValidEmail("contato")).toBe(false);
    expect(isValidEmail("contato@")).toBe(false);
    expect(isValidEmail("@empresa.com")).toBe(false);
    expect(isValidEmail("contato@empresa")).toBe(false);
    expect(isValidEmail("contato empresa@x.com")).toBe(false);
  });

  it("no schema: vazio limpa, preenchido precisa ser válido", () => {
    expect(optionalEmailSchema.parse("")).toBeNull();
    expect(optionalEmailSchema.parse(null)).toBeNull();
    expect(optionalEmailSchema.parse("  contato@veridi.com.br ")).toBe(
      "contato@veridi.com.br",
    );
    const result = optionalEmailSchema.safeParse("contato@");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("E-mail inválido.");
    }
  });
});

describe("Telefone brasileiro", () => {
  it("aceita fixo com DDD (10 dígitos)", () => {
    expect(isValidBrPhone("1133334444")).toBe(true);
    expect(isValidBrPhone("(11) 3333-4444")).toBe(true);
  });

  it("aceita celular com DDD (11 dígitos)", () => {
    expect(isValidBrPhone("11999998888")).toBe(true);
    expect(isValidBrPhone("(11) 99999-8888")).toBe(true);
  });

  it("recusa número curto — o caso visto na tela", () => {
    expect(isValidBrPhone("123232")).toBe(false);
    expect(isValidBrPhone("33334444")).toBe(false);
  });

  it("recusa DDD inexistente", () => {
    expect(isValidBrPhone("1033334444")).toBe(false);
    expect(isValidBrPhone("2033334444")).toBe(false);
  });

  it("recusa celular de 11 dígitos que não começa com 9", () => {
    expect(isValidBrPhone("11833334444")).toBe(false);
  });

  it("normaliza e formata", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("11999998888");
    expect(formatBrPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatBrPhone("11999998888")).toBe("(11) 99999-8888");
  });

  it("mascara durante a digitação", () => {
    expect(maskPhoneInput("11")).toBe("(11");
    expect(maskPhoneInput("113333")).toBe("(11) 3333");
    expect(maskPhoneInput("1133334444")).toBe("(11) 3333-4444");
    expect(maskPhoneInput("11999998888")).toBe("(11) 99999-8888");
  });

  it("no schema: guarda só dígitos e exige DDD", () => {
    expect(optionalBrPhoneSchema.parse("")).toBeNull();
    expect(optionalBrPhoneSchema.parse("(11) 99999-8888")).toBe("11999998888");
    const result = optionalBrPhoneSchema.safeParse("123232");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Informe um telefone com DDD.");
    }
  });
});
