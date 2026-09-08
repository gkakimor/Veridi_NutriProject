import { describe, expect, it } from "vitest";
import { formatQuantity } from "./quantity";
import { excedeLimiteExibido, resolverQuantidadeContraLimite } from "./quantity-limit";

/**
 * O caso que originou o helper (F-08-1).
 *
 * A reserva vale doze casas; a tela mostra seis, arredondadas para CIMA. Antes
 * disto, o único número que o operador não podia digitar era o que estava
 * escrito na frente dele.
 */
const RESERVA = "6.122448979592";
const EXIBIDO = "6,122449";

describe("resolverQuantidadeContraLimite — round-trip do valor exibido", () => {
  it("a tela exibe o teto arredondado PARA CIMA — é a premissa do defeito", () => {
    expect(formatQuantity(RESERVA)).toBe(EXIBIDO);
    // Exibido > real: é isto que fazia a validação recusar o próprio texto.
    expect(Number(EXIBIDO.replace(",", "."))).toBeGreaterThan(Number(RESERVA));
  });

  it("digitar o valor exibido envia o teto CANÔNICO, com as doze casas", () => {
    const resultado = resolverQuantidadeContraLimite(EXIBIDO, RESERVA);
    expect(resultado).toEqual({
      status: "ok",
      valorCanonico: RESERVA,
      usouTodoOLimite: true,
    });
  });

  it("digitar o valor exibido com ponto vale igual — o contrato aceita os dois", () => {
    const resultado = resolverQuantidadeContraLimite("6.122449", RESERVA);
    expect(resultado).toMatchObject({ status: "ok", valorCanonico: RESERVA });
  });

  it("digitar o valor cru completo envia exatamente ele", () => {
    expect(resolverQuantidadeContraLimite(RESERVA, RESERVA)).toEqual({
      status: "ok",
      valorCanonico: RESERVA,
      usouTodoOLimite: true,
    });
  });

  it("digitar menos é consumo parcial legítimo e NÃO vira o máximo", () => {
    const resultado = resolverQuantidadeContraLimite("6,122448", RESERVA);
    expect(resultado).toEqual({
      status: "ok",
      valorCanonico: "6.122448",
      usouTodoOLimite: false,
    });
  });

  it("digitar bem menos vai como foi digitado", () => {
    expect(resolverQuantidadeContraLimite("6,0", RESERVA)).toMatchObject({
      status: "ok",
      valorCanonico: "6.0",
    });
  });

  it("acima do valor exibido continua recusado", () => {
    expect(resolverQuantidadeContraLimite("6,122450", RESERVA)).toEqual({ status: "acima" });
  });

  it("uma casa de 10^-12 acima do teto é recusada — não há tolerância", () => {
    expect(resolverQuantidadeContraLimite("6.122448979593", RESERVA)).toEqual({ status: "acima" });
  });

  it("uma casa de 10^-12 abaixo do teto passa como foi digitada", () => {
    expect(resolverQuantidadeContraLimite("6.122448979591", RESERVA)).toEqual({
      status: "ok",
      valorCanonico: "6.122448979591",
      usouTodoOLimite: false,
    });
  });

  it("vazio é ausência, não zero", () => {
    expect(resolverQuantidadeContraLimite("", RESERVA)).toEqual({ status: "vazio" });
    expect(resolverQuantidadeContraLimite("   ", RESERVA)).toEqual({ status: "vazio" });
  });

  it("ilegível não vira palpite", () => {
    expect(resolverQuantidadeContraLimite("abc", RESERVA)).toEqual({ status: "ilegivel" });
    // Separador de milhar continua recusado, como manda `parseDecimalInput`.
    expect(resolverQuantidadeContraLimite("1.234,5", RESERVA)).toEqual({ status: "ilegivel" });
  });

  it("zero é quantidade válida — quem decide se serve é a tela", () => {
    expect(resolverQuantidadeContraLimite("0", RESERVA)).toMatchObject({
      status: "ok",
      valorCanonico: "0",
    });
  });
});

describe("resolverQuantidadeContraLimite — teto arredondado para BAIXO", () => {
  /* O outro lado do mesmo problema: quando a sétima casa é menor que 5, o
     exibido fica ABAIXO do real. Sem o round-trip, digitar o que a tela mostra
     consumiria menos que a reserva e deixaria resíduo — que é exatamente o que
     `reconciliation.ts` recusa. */
  const RESERVA_BAIXA = "2.5000004";

  it("a tela exibe menos do que o teto real", () => {
    expect(formatQuantity(RESERVA_BAIXA)).toBe("2,5");
    expect(Number("2.5")).toBeLessThan(Number(RESERVA_BAIXA));
  });

  it("digitar o exibido ainda significa 'usar tudo' e envia o canônico", () => {
    expect(resolverQuantidadeContraLimite("2,5", RESERVA_BAIXA)).toEqual({
      status: "ok",
      valorCanonico: RESERVA_BAIXA,
      usouTodoOLimite: true,
    });
  });
});

describe("resolverQuantidadeContraLimite — teto que já cabe na exibição", () => {
  it("valor redondo funciona como sempre funcionou", () => {
    expect(resolverQuantidadeContraLimite("12", "12")).toEqual({
      status: "ok",
      valorCanonico: "12",
      usouTodoOLimite: true,
    });
    expect(resolverQuantidadeContraLimite("11,5", "12")).toEqual({
      status: "ok",
      valorCanonico: "11.5",
      usouTodoOLimite: false,
    });
    expect(resolverQuantidadeContraLimite("12,5", "12")).toEqual({ status: "acima" });
  });

  it("teto zero recusa qualquer quantidade positiva", () => {
    expect(resolverQuantidadeContraLimite("0", "0")).toMatchObject({ status: "ok" });
    expect(resolverQuantidadeContraLimite("0,000001", "0")).toEqual({ status: "acima" });
  });
});

describe("excedeLimiteExibido", () => {
  it("não acusa excesso no valor que a tela mostra", () => {
    expect(excedeLimiteExibido(EXIBIDO, RESERVA)).toBe(false);
  });

  it("acusa excesso acima dele", () => {
    expect(excedeLimiteExibido("6,122450", RESERVA)).toBe(true);
  });

  it("campo vazio ou ilegível não é excesso — a mensagem daquele caso é outra", () => {
    expect(excedeLimiteExibido("", RESERVA)).toBe(false);
    expect(excedeLimiteExibido("abc", RESERVA)).toBe(false);
  });
});

describe("resolverQuantidadeContraLimite — notação do que vai no payload", () => {
  /* A API serializa Decimal pequeno em notação exponencial (`9.79592e-7` foi
     medido em `unreconciledQuantity`). O servidor, do outro lado, recusa
     exponencial por regex. O valor canônico não pode sair daqui nesse
     formato. */
  it("teto exponencial vira decimal comum no valor canônico", () => {
    // `1.23e-5` é `0,0000123`: exibido com seis casas vira `0,000012`.
    const LIMITE_EXPONENCIAL = "1.23e-5";
    expect(formatQuantity(LIMITE_EXPONENCIAL)).toBe("0,000012");

    const resultado = resolverQuantidadeContraLimite("0,000012", LIMITE_EXPONENCIAL);
    expect(resultado).toMatchObject({ status: "ok", usouTodoOLimite: true });
    if (resultado.status !== "ok") throw new Error("esperado ok");
    expect(resultado.valorCanonico).toBe("0.0000123");
    expect(resultado.valorCanonico).toMatch(/^\d+(\.\d+)?$/);
  });

  it("teto comum continua saindo como sempre saiu", () => {
    expect(resolverQuantidadeContraLimite(EXIBIDO, RESERVA)).toMatchObject({
      valorCanonico: RESERVA,
    });
  });
});
