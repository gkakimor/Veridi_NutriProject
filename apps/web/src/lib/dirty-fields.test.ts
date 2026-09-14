import { describe, expect, it } from "vitest";
import {
  assinaturaDoDocumento,
  assinaturaDoFormulario,
  decimalComparavel,
  decimalDaApiComparavel,
  inteiroComparavel,
  textoComparavel,
} from "./dirty-fields";

/**
 * A normalização que separa alteração de reescrita.
 *
 * A guarda de alterações não salvas compara o documento na tela com o
 * documento de referência. Sem isto ela pergunta onde não há perda — o
 * servidor devolve `10.000000`, a pessoa redigita `10`, e a tela anuncia
 * risco de perder o que é exatamente o mesmo número. Guarda que pergunta à
 * toa ensina a ignorar a pergunta que importa.
 *
 * O outro lado também é regra: normalizar não afrouxa. `10` e `10,5` seguem
 * diferentes, e o que a tela não sabe ler não é igual a nada.
 */

describe("decimal comparável", () => {
  it("a mesma quantidade escrita de vários jeitos é a mesma coisa", () => {
    const canonico = decimalComparavel("10");
    expect(decimalComparavel("10,0")).toBe(canonico);
    expect(decimalComparavel("10.0")).toBe(canonico);
    expect(decimalComparavel("10.000000")).toBe(canonico);
    expect(decimalComparavel(" 10 ")).toBe(canonico);
  });

  it("quantidade diferente continua diferente", () => {
    expect(decimalComparavel("10,5")).not.toBe(decimalComparavel("10"));
    expect(decimalComparavel("0,1")).not.toBe(decimalComparavel("0,10001"));
  });

  it("ausência e vazio são a mesma coisa: não informado", () => {
    expect(decimalComparavel("")).toBeNull();
    expect(decimalComparavel("   ")).toBeNull();
    expect(decimalComparavel(null)).toBeNull();
    expect(decimalComparavel(undefined)).toBeNull();
  });

  it("ilegível não é igual a nada — nem a zero, nem a vazio", () => {
    const ilegivel = decimalComparavel("abc");
    expect(ilegivel).not.toBeNull();
    expect(ilegivel).not.toBe(decimalComparavel("0"));
    expect(ilegivel).not.toBe(decimalComparavel(""));
    // O que a tela não sabe ler ela não sabe comparar: é pendência por definição.
    expect(decimalComparavel("abc")).toBe(ilegivel);
  });

  it("a leitura é a do campo: milhar com vírgula é mil, 1.234 sozinho é ambíguo e pendência", () => {
    // PTBR-NUMERIC-INPUT-ROLLOUT-01: o texto do campo se lê como o campo lê.
    expect(decimalComparavel("1.234,5")).toBe(decimalComparavel("1234,5"));
    expect(decimalComparavel("1234.5")).toBe(decimalComparavel("1234,5"));
    const ambiguo = decimalComparavel("1.234");
    expect(ambiguo).not.toBe(decimalComparavel("1,234"));
    expect(ambiguo).not.toBe(decimalComparavel("1234"));
    expect(ambiguo).toMatch(/^ilegível:/);
  });

  it("vírgula e casas zeradas não são alteração: 250,50 é 250,5", () => {
    expect(decimalComparavel("250,50")).toBe(decimalComparavel("250,5"));
    expect(decimalComparavel("0,00")).toBe(decimalComparavel("0"));
  });
});

describe("decimal vindo da API", () => {
  it("o valor canônico da API e o texto do campo dão o mesmo — servidor 250.5, campo 250,5", () => {
    expect(decimalDaApiComparavel("250.5")).toBe(decimalComparavel("250,5"));
    expect(decimalDaApiComparavel("1000.000000000000")).toBe(decimalComparavel("1.000,0"));
  });

  it("ponto da API é sempre casa decimal: 1.234 da API é um vírgula duzentos e trinta e quatro", () => {
    expect(decimalDaApiComparavel("1.234")).toBe(decimalComparavel("1,234"));
    expect(decimalDaApiComparavel("1.234")).not.toMatch(/^ilegível:/);
  });

  it("ausência é null; notação científica da API é o mesmo número", () => {
    expect(decimalDaApiComparavel(null)).toBeNull();
    expect(decimalDaApiComparavel("")).toBeNull();
    expect(decimalDaApiComparavel("9.79592e-7")).toBe(decimalComparavel("0,000000979592"));
  });
});

describe("texto comparável", () => {
  it("ausência, vazio e só espaço são a mesma coisa", () => {
    expect(textoComparavel(null)).toBeNull();
    expect(textoComparavel("")).toBeNull();
    expect(textoComparavel("   ")).toBeNull();
  });

  it("espaço nas pontas não é conteúdo; no meio, é", () => {
    expect(textoComparavel(" Lote A ")).toBe(textoComparavel("Lote A"));
    expect(textoComparavel("Lote  A")).not.toBe(textoComparavel("Lote A"));
  });
});

describe("inteiro comparável", () => {
  it("o número do servidor e o texto do campo dão o mesmo", () => {
    expect(inteiroComparavel(3)).toBe(inteiroComparavel("3"));
    expect(inteiroComparavel(1)).not.toBe(inteiroComparavel("2"));
    // Zero à esquerda e milhar não são alteração; vazio é ausência.
    expect(inteiroComparavel("030")).toBe(inteiroComparavel(30));
    expect(inteiroComparavel("1.234")).toBe(inteiroComparavel(1234));
    expect(inteiroComparavel("")).toBeNull();
  });
});

describe("assinatura do documento", () => {
  it("mesmo conteúdo dá a mesma assinatura; um campo a mais muda tudo", () => {
    const a = assinaturaDoDocumento({ nome: "X", quantidade: decimalComparavel("10,0") });
    const b = assinaturaDoDocumento({ nome: "X", quantidade: decimalComparavel("10") });
    expect(a).toBe(b);

    const c = assinaturaDoDocumento({ nome: "X", quantidade: decimalComparavel("11") });
    expect(c).not.toBe(a);
  });

  it("a ordem das linhas é parte do documento", () => {
    const subir = assinaturaDoDocumento({ lines: [{ id: "a" }, { id: "b" }] });
    const descer = assinaturaDoDocumento({ lines: [{ id: "b" }, { id: "a" }] });
    expect(subir).not.toBe(descer);
  });
});

describe("assinatura de formulário", () => {
  it("marca de sim/não conta, e a ordem de declaração não", () => {
    expect(assinaturaDoFormulario({ nome: "X", ativo: true })).toBe(
      assinaturaDoFormulario({ ativo: true, nome: "X" }),
    );
    expect(assinaturaDoFormulario({ nome: "X", ativo: true })).not.toBe(
      assinaturaDoFormulario({ nome: "X", ativo: false }),
    );
  });

  it("o campo listado como decimal compara por valor; os outros, por texto", () => {
    const decimais = ["pureza"];
    expect(assinaturaDoFormulario({ pureza: "98" }, decimais)).toBe(
      assinaturaDoFormulario({ pureza: "98,0" }, decimais),
    );
    // Sem a lista, o mesmo par vira alteração — é o que a lista existe para evitar.
    expect(assinaturaDoFormulario({ pureza: "98" })).not.toBe(
      assinaturaDoFormulario({ pureza: "98,0" }),
    );
  });

  it("ausência, vazio e só espaço não diferenciam um cadastro do outro", () => {
    const vazio = assinaturaDoFormulario({ notas: "" });
    expect(assinaturaDoFormulario({ notas: null })).toBe(vazio);
    expect(assinaturaDoFormulario({ notas: "   " })).toBe(vazio);
    expect(assinaturaDoFormulario({ notas: "x" })).not.toBe(vazio);
  });
});
