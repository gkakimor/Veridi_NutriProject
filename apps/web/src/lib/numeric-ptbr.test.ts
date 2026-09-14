import { describe, expect, it } from "vitest";
import { formatBRL, formatUnitPriceBRL } from "./currency";
import { ESPACO_MOEDA } from "./decimal-format";
import { formatPercent } from "./percent";
import {
  formatDecimalPtBr,
  formatIntegerPtBr,
  formatMoneyPtBr,
  formatPercentPtBr,
  isPtBrNumberDraft,
  normalizePastedNumber,
  numericInvalidMessage,
  parsePtBrNumber,
  toPtBrEditText,
} from "./numeric-ptbr";
import type { NumericInvalidReason, NumericOptions } from "./numeric-ptbr";

/**
 * Parser, guarda de digitação, colagem, carga e formatadores da foundation
 * numérica pt-BR — PTBR-NUMERIC-INPUT-FOUNDATION-01.
 *
 * O que protege: `1.234,56`, `1234,56` e `1234.56` são o mesmo número; `1.234`
 * sozinho em campo decimal não é adivinhado; nada passa por float; zero é
 * valor e vazio não é zero; casa além do `scale` não é arredondada em
 * silêncio.
 */

const DUAS: NumericOptions = { scale: 2 };
const QUATRO: NumericOptions = { scale: 4 };
const DOZE: NumericOptions = { scale: 12 };
const INTEIRO: NumericOptions = { scale: 0 };
const NEGATIVO: NumericOptions = { scale: 2, allowNegative: true };

const valido = (valor: string) => ({ tipo: "valido", valor });
const invalido = (motivo: NumericInvalidReason) => ({ tipo: "invalido", motivo });

describe("parsePtBrNumber — o parser canônico", () => {
  it("vazio é vazio: nem zero, nem erro", () => {
    expect(parsePtBrNumber("", DUAS)).toEqual({ tipo: "vazio" });
    expect(parsePtBrNumber("   ", DUAS)).toEqual({ tipo: "vazio" });
  });

  it("zero é valor, com as casas que foram escritas", () => {
    expect(parsePtBrNumber("0", DUAS)).toEqual(valido("0"));
    expect(parsePtBrNumber("0,00", DUAS)).toEqual(valido("0.00"));
    expect(parsePtBrNumber("0,0000", QUATRO)).toEqual(valido("0.0000"));
    expect(parsePtBrNumber("000", DUAS)).toEqual(valido("0"));
  });

  it("os estados de digitação que viram número", () => {
    expect(parsePtBrNumber("1", DUAS)).toEqual(valido("1"));
    expect(parsePtBrNumber("1,", DUAS)).toEqual(valido("1"));
    expect(parsePtBrNumber("1,2", DUAS)).toEqual(valido("1.2"));
    expect(parsePtBrNumber("1,2345", QUATRO)).toEqual(valido("1.2345"));
    expect(parsePtBrNumber(",5", DUAS)).toEqual(valido("0.5"));
    expect(parsePtBrNumber("00,50", DUAS)).toEqual(valido("0.50"));
    expect(parsePtBrNumber("007", DUAS)).toEqual(valido("7"));
  });

  it("1234,56 · 1.234,56 · 1234.56 são o mesmo número", () => {
    expect(parsePtBrNumber("1234,56", DUAS)).toEqual(valido("1234.56"));
    expect(parsePtBrNumber("1.234,56", DUAS)).toEqual(valido("1234.56"));
    expect(parsePtBrNumber("1234.56", DUAS)).toEqual(valido("1234.56"));
    expect(parsePtBrNumber(" 1.234,56 ", DUAS)).toEqual(valido("1234.56"));
  });

  it("milhar com vários grupos, com e sem decimal", () => {
    expect(parsePtBrNumber("1.234.567", DUAS)).toEqual(valido("1234567"));
    expect(parsePtBrNumber("1.234.567,8", DUAS)).toEqual(valido("1234567.8"));
    expect(parsePtBrNumber("12.345.678,90", DUAS)).toEqual(valido("12345678.90"));
  });

  it("um ponto que não forma milhar é casa decimal — formato de planilha em inglês", () => {
    expect(parsePtBrNumber("12.5", DUAS)).toEqual(valido("12.5"));
    expect(parsePtBrNumber("1.23", DUAS)).toEqual(valido("1.23"));
    expect(parsePtBrNumber("1.2345", QUATRO)).toEqual(valido("1.2345"));
    expect(parsePtBrNumber("0.125", QUATRO)).toEqual(valido("0.125"));
    expect(parsePtBrNumber("1234.567", QUATRO)).toEqual(valido("1234.567"));
    expect(parsePtBrNumber(".5", DUAS)).toEqual(valido("0.5"));
    expect(parsePtBrNumber("12.", DUAS)).toEqual(valido("12"));
  });

  it("1.234 sozinho é ambíguo em campo decimal, de qualquer scale", () => {
    for (const opcoes of [DUAS, QUATRO, DOZE, { scale: 1 }]) {
      expect(parsePtBrNumber("1.234", opcoes)).toEqual(invalido("ambiguo"));
      expect(parsePtBrNumber("12.345", opcoes)).toEqual(invalido("ambiguo"));
      expect(parsePtBrNumber("123.456", opcoes)).toEqual(invalido("ambiguo"));
      expect(parsePtBrNumber("1.200", opcoes)).toEqual(invalido("ambiguo"));
    }
    // Com zero à esquerda não existe milhar: é decimal.
    expect(parsePtBrNumber("0.123", QUATRO)).toEqual(valido("0.123"));
    // Com a vírgula, o ponto só pode ser milhar.
    expect(parsePtBrNumber("1.234,0", DUAS)).toEqual(valido("1234.0"));
  });

  it("campo inteiro: ponto é milhar, vírgula só com zeros", () => {
    expect(parsePtBrNumber("1234", INTEIRO)).toEqual(valido("1234"));
    expect(parsePtBrNumber("1.234", INTEIRO)).toEqual(valido("1234"));
    expect(parsePtBrNumber("1.234.567", INTEIRO)).toEqual(valido("1234567"));
    expect(parsePtBrNumber("1.234,00", INTEIRO)).toEqual(valido("1234"));
    expect(parsePtBrNumber("12,5", INTEIRO)).toEqual(invalido("casas"));
    expect(parsePtBrNumber("12.5", INTEIRO)).toEqual(invalido("casas"));
    expect(parsePtBrNumber("1.2.3", INTEIRO)).toEqual(invalido("agrupamento"));
  });

  it("casa além do scale: zero sai, qualquer outro dígito é recusado — nunca arredondado", () => {
    expect(parsePtBrNumber("12,340", DUAS)).toEqual(valido("12.34"));
    expect(parsePtBrNumber("12,34000000", DUAS)).toEqual(valido("12.34"));
    expect(parsePtBrNumber("12,345", DUAS)).toEqual(invalido("casas"));
    expect(parsePtBrNumber("12,3456", QUATRO)).toEqual(valido("12.3456"));
    expect(parsePtBrNumber("12,34561", QUATRO)).toEqual(invalido("casas"));
    expect(parsePtBrNumber("1234.567", DUAS)).toEqual(invalido("casas"));
  });

  it("valores grandes e pequenos atravessam sem float", () => {
    // 2^53 + 1: um `double` já não guarda este número.
    expect(parsePtBrNumber("9007199254740993,12", DUAS)).toEqual(valido("9007199254740993.12"));
    expect(parsePtBrNumber("999.999.999.999,999999999999", DOZE)).toEqual(
      valido("999999999999.999999999999"),
    );
    expect(parsePtBrNumber("123456789012345678901234567890,1", DUAS)).toEqual(
      valido("123456789012345678901234567890.1"),
    );
    expect(parsePtBrNumber("0,000000000001", DOZE)).toEqual(valido("0.000000000001"));
    expect(parsePtBrNumber("0,0000000000001", DOZE)).toEqual(invalido("casas"));
    expect(parsePtBrNumber("4,053187640000", DOZE)).toEqual(valido("4.053187640000"));
  });

  it("negativo só com allowNegative, e zero não tem sinal", () => {
    expect(parsePtBrNumber("-12,5", DUAS)).toEqual(invalido("negativo"));
    expect(parsePtBrNumber("-12,5", NEGATIVO)).toEqual(valido("-12.5"));
    expect(parsePtBrNumber("-1.234,56", NEGATIVO)).toEqual(valido("-1234.56"));
    expect(parsePtBrNumber("-0,00", NEGATIVO)).toEqual(valido("0.00"));
    expect(parsePtBrNumber("-0", NEGATIVO)).toEqual(valido("0"));
    expect(parsePtBrNumber("12-", NEGATIVO)).toEqual(invalido("caractere"));
    expect(parsePtBrNumber("--1", NEGATIVO)).toEqual(invalido("caractere"));
    expect(parsePtBrNumber("-", NEGATIVO)).toEqual(invalido("caractere"));
  });

  it("letras, símbolos e espaço no meio são recusados", () => {
    for (const texto of ["abc", "12abc", "R$ 12,00", "12%", "1e5", "12 345", "+12", "1_000", ",", "."]) {
      expect(parsePtBrNumber(texto, DUAS), texto).toEqual(invalido("caractere"));
    }
  });

  it("dois separadores decimais, ou formato inglês com milhar, são recusados", () => {
    expect(parsePtBrNumber("1,2,3", DUAS)).toEqual(invalido("separador"));
    expect(parsePtBrNumber("1,234.56", DUAS)).toEqual(invalido("separador"));
    expect(parsePtBrNumber("1.23,45", DUAS)).toEqual(invalido("agrupamento"));
    expect(parsePtBrNumber("1.2.3", DUAS)).toEqual(invalido("agrupamento"));
    expect(parsePtBrNumber("0.123.456", DUAS)).toEqual(invalido("agrupamento"));
    expect(parsePtBrNumber("1234.567,8", DUAS)).toEqual(invalido("agrupamento"));
  });

  it("scale inválido é erro de programação, não leitura", () => {
    expect(() => parsePtBrNumber("1", { scale: -1 })).toThrow(/scale inválido/);
    expect(() => parsePtBrNumber("1", { scale: 2.5 })).toThrow(/scale inválido/);
  });
});

describe("isPtBrNumberDraft — a guarda de cada tecla", () => {
  it("aceita a digitação natural, tecla a tecla", () => {
    for (const texto of ["", "1", "12", "12,", "12,3", "12,34"]) {
      expect(isPtBrNumberDraft(texto, DUAS), texto).toBe(true);
    }
  });

  it("aceita o que ainda pode virar número", () => {
    for (const texto of [",", ",5", "1.", "1.2", "1.23", "1.234", "1.234,", "1.234,5", "1.234.5", "12.5", "0.5", "."]) {
      expect(isPtBrNumberDraft(texto, DUAS), texto).toBe(true);
    }
  });

  it("recusa o que nenhuma tecla a mais conserta", () => {
    for (const texto of ["a", "12a", "R$", " 12", "12,345", "12,3,", "1,2.", "1.23,", "1234.567", "-1", "1-", "12%"]) {
      expect(isPtBrNumberDraft(texto, DUAS), texto).toBe(false);
    }
  });

  it("scale 4 e alta precisão contam as casas depois da vírgula", () => {
    expect(isPtBrNumberDraft("12,3456", QUATRO)).toBe(true);
    expect(isPtBrNumberDraft("12,34567", QUATRO)).toBe(false);
    expect(isPtBrNumberDraft("0,000000000001", DOZE)).toBe(true);
    expect(isPtBrNumberDraft("0,0000000000001", DOZE)).toBe(false);
  });

  it("negativo só no começo e só com allowNegative", () => {
    expect(isPtBrNumberDraft("-", NEGATIVO)).toBe(true);
    expect(isPtBrNumberDraft("-12,5", NEGATIVO)).toBe(true);
    expect(isPtBrNumberDraft("-,", NEGATIVO)).toBe(true);
    expect(isPtBrNumberDraft("1-", NEGATIVO)).toBe(false);
    expect(isPtBrNumberDraft("--", NEGATIVO)).toBe(false);
    expect(isPtBrNumberDraft("-", DUAS)).toBe(false);
  });

  it("campo inteiro aceita só dígitos", () => {
    expect(isPtBrNumberDraft("1234", INTEIRO)).toBe(true);
    expect(isPtBrNumberDraft("12,", INTEIRO)).toBe(false);
    expect(isPtBrNumberDraft("1.", INTEIRO)).toBe(false);
    expect(isPtBrNumberDraft("-1", INTEIRO)).toBe(false);
    expect(isPtBrNumberDraft("-1", { scale: 0, allowNegative: true })).toBe(true);
  });
});

describe("normalizePastedNumber — colar de planilha ou de outro sistema", () => {
  const MOEDA = { ...DUAS, simbolo: "moeda" } as const;

  it("vírgula, ponto de milhar e ponto decimal chegam no mesmo texto", () => {
    expect(normalizePastedNumber("1234,56", MOEDA)).toBe("1234,56");
    expect(normalizePastedNumber("1.234,56", MOEDA)).toBe("1234,56");
    expect(normalizePastedNumber("1234.56", MOEDA)).toBe("1234,56");
    expect(normalizePastedNumber("1.234.567,89", MOEDA)).toBe("1234567,89");
  });

  it("a sobra da célula copiada sai: espaços, quebra de linha, tabulação", () => {
    expect(normalizePastedNumber(" 1.234,56\r\n", MOEDA)).toBe("1234,56");
    expect(normalizePastedNumber("\t12,5\t", MOEDA)).toBe("12,5");
  });

  it("R$ sai só em campo de moeda, % só em percentual", () => {
    expect(normalizePastedNumber("R$ 1.234,56", MOEDA)).toBe("1234,56");
    expect(normalizePastedNumber(`R$${ESPACO_MOEDA}1.234,56`, MOEDA)).toBe("1234,56");
    expect(normalizePastedNumber("12,5%", { ...DUAS, simbolo: "percentual" })).toBe("12,5");
    expect(normalizePastedNumber("12,5 %", { ...DUAS, simbolo: "percentual" })).toBe("12,5");
    expect(normalizePastedNumber("R$ 12", DUAS)).toBe("R$ 12");
    expect(normalizePastedNumber("12%", MOEDA)).toBe("12%");
  });

  it("negativo colado: vira texto só onde é aceito", () => {
    expect(normalizePastedNumber("-R$ 1.234,56", { ...MOEDA, allowNegative: true })).toBe("-1234,56");
    expect(normalizePastedNumber("R$ -1.234,56", { ...MOEDA, allowNegative: true })).toBe("-1234,56");
    const recusado = normalizePastedNumber("-1.234,56", MOEDA);
    expect(isPtBrNumberDraft(recusado, MOEDA)).toBe(false);
  });

  it("ambíguo e absurdo não são reinterpretados", () => {
    expect(normalizePastedNumber("1.234", QUATRO)).toBe("1.234");
    expect(normalizePastedNumber("abc", DUAS)).toBe("abc");
    expect(normalizePastedNumber("1,234.56", DUAS)).toBe("1,234.56");
    expect(isPtBrNumberDraft(normalizePastedNumber("1,234.56", DUAS), DUAS)).toBe(false);
    expect(isPtBrNumberDraft(normalizePastedNumber("12\t34", DUAS), DUAS)).toBe(false);
  });

  it("campo inteiro: milhar colado vira dígitos", () => {
    expect(normalizePastedNumber("1.234", INTEIRO)).toBe("1234");
    expect(normalizePastedNumber("1.234,00", INTEIRO)).toBe("1234");
    expect(isPtBrNumberDraft(normalizePastedNumber("1,5", INTEIRO), INTEIRO)).toBe(false);
  });

  it("colar com mais casas que o scale só passa se a sobra for zero", () => {
    expect(normalizePastedNumber("12,340", DUAS)).toBe("12,34");
    expect(isPtBrNumberDraft(normalizePastedNumber("12,345", DUAS), DUAS)).toBe(false);
  });
});

describe("toPtBrEditText — o valor da API no campo", () => {
  it("troca o ponto pela vírgula e preserva os dígitos", () => {
    expect(toPtBrEditText("1234.56", DUAS)).toBe("1234,56");
    expect(toPtBrEditText("1234.50", DUAS)).toBe("1234,50");
    expect(toPtBrEditText("0", DUAS)).toBe("0");
    expect(toPtBrEditText("0.00", DUAS)).toBe("0,00");
    expect(toPtBrEditText("-12.5", NEGATIVO)).toBe("-12,5");
  });

  it("ausência é campo vazio, não zero", () => {
    expect(toPtBrEditText(null, DUAS)).toBe("");
    expect(toPtBrEditText(undefined, DUAS)).toBe("");
    expect(toPtBrEditText("", DUAS)).toBe("");
  });

  it("zeros além do scale saem; dígito além do scale fica, e o campo acusa", () => {
    expect(toPtBrEditText("12.50000000", QUATRO)).toBe("12,5000");
    const sobra = toPtBrEditText("12.50000001", QUATRO);
    expect(sobra).toBe("12,50000001");
    expect(parsePtBrNumber(sobra, QUATRO)).toEqual(invalido("casas"));
  });

  it("notação científica vira dígitos", () => {
    expect(toPtBrEditText("9.79592e-7", DOZE)).toBe("0,000000979592");
    expect(toPtBrEditText("1e-12", DOZE)).toBe("0,000000000001");
  });

  it("abrir e salvar sem editar devolve o texto da API, byte a byte", () => {
    for (const [valor, opcoes] of [
      ["4.053187640000", DOZE],
      ["0.123456789012", DOZE],
      ["999999999999.999999999999", DOZE],
      ["1234.56", DUAS],
      ["0.00", DUAS],
      ["12.3456", QUATRO],
      ["1234", INTEIRO],
    ] as const) {
      expect(parsePtBrNumber(toPtBrEditText(valor, opcoes), opcoes), valor).toEqual(valido(valor));
    }
  });
});

describe("formatadores de leitura", () => {
  it("inteiro agrupa milhar", () => {
    expect(formatIntegerPtBr("1234")).toBe("1.234");
    expect(formatIntegerPtBr("1234567")).toBe("1.234.567");
    expect(formatIntegerPtBr("0")).toBe("0");
    expect(formatIntegerPtBr(null)).toBe("—");
    expect(formatIntegerPtBr("")).toBe("—");
    expect(formatIntegerPtBr("abc")).toBe("—");
  });

  it("decimal com scale e mínimo configuráveis", () => {
    expect(formatDecimalPtBr("1234.56", DUAS)).toBe("1.234,56");
    expect(formatDecimalPtBr("1234.5", { scale: 2, minFractionDigits: 2 })).toBe("1.234,50");
    expect(formatDecimalPtBr("1234", { scale: 6 })).toBe("1.234");
    expect(formatDecimalPtBr("0.000000000001", DOZE)).toBe("0,000000000001");
    expect(formatDecimalPtBr("9007199254740993.12", DUAS)).toBe("9.007.199.254.740.993,12");
    expect(formatDecimalPtBr(undefined, DUAS)).toBe("—");
  });

  it("dinheiro: total em 2 casas é o formatBRL; preço unitário em 4 é o formatUnitPriceBRL", () => {
    for (const valor of ["1234.56", "0", "0.005", "-1234.5", "9007199254740993.12"]) {
      expect(formatMoneyPtBr(valor, DUAS), valor).toBe(formatBRL(valor));
    }
    for (const valor of ["12.3456", "12.5", "4.0530", "0.00005"]) {
      expect(formatMoneyPtBr(valor, { scale: 4 }), valor).toBe(formatUnitPriceBRL(valor));
    }
    expect(formatMoneyPtBr("12.3456", { scale: 4 })).toBe(`R$${ESPACO_MOEDA}12,3456`);
    expect(formatMoneyPtBr("1234.56", DUAS)).toBe(`R$${ESPACO_MOEDA}1.234,56`);
    expect(formatMoneyPtBr(null, DUAS)).toBe("—");
  });

  it("dinheiro com precisão de custo, sem cortar em 2 casas", () => {
    expect(formatMoneyPtBr("1.23456789", { scale: 8 })).toBe(`R$${ESPACO_MOEDA}1,23456789`);
  });

  it("percentual: o número como veio, com as casas pedidas", () => {
    expect(formatPercentPtBr("12.5", { scale: 2, minFractionDigits: 2 })).toBe("12,50%");
    expect(formatPercentPtBr("12.5", DUAS)).toBe("12,5%");
    expect(formatPercentPtBr("5.0000", DUAS)).toBe(formatPercent("5.0000"));
    expect(formatPercentPtBr("99.9995", { scale: 6 })).toBe("99,9995%");
    expect(formatPercentPtBr(null, DUAS)).toBe("—");
  });
});

describe("numericInvalidMessage", () => {
  it("cada motivo diz o que escrever, com o rótulo", () => {
    const motivos: NumericInvalidReason[] = ["caractere", "negativo", "separador", "agrupamento", "ambiguo", "casas"];
    for (const motivo of motivos) {
      expect(numericInvalidMessage("Preço", motivo, QUATRO), motivo).toMatch(/^Preço: /);
      expect(numericInvalidMessage("Parcelas", motivo, INTEIRO), motivo).toMatch(/^Parcelas: /);
    }
    expect(numericInvalidMessage("Preço", "casas", QUATRO)).toContain("4 casas decimais");
    expect(numericInvalidMessage("Fator", "casas", { scale: 1 })).toContain("1 casa decimal");
    expect(numericInvalidMessage("Parcelas", "casas", INTEIRO)).toContain("número inteiro");
    expect(numericInvalidMessage("Preço", "ambiguo", QUATRO)).toContain("(1234)");
    expect(numericInvalidMessage("Preço", "ambiguo", QUATRO)).toContain("(1,234)");
  });
});
