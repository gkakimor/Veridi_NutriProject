import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CalcHint } from "./CalcHint";

/**
 * A explicação mostra a conta desta linha — e confere a si mesma.
 *
 * O caso que originou o componente: um documento de faturamento exibia
 * `R$ 4,05` ao lado de um total de `R$ 498,53` calculado sobre `4,0531`. Quem
 * conferia com a calculadora chegava a R$ 498,15 e não tinha como descobrir de
 * onde vinha a diferença. Fórmula abstrata não resolveria isso: o operador não
 * quer saber que total é preço vezes quantidade, quer saber por que ESTE total
 * é este.
 *
 * E uma ajuda que afirma uma aritmética falsa é pior que ajuda nenhuma, porque
 * convence. Por isso o componente compara o resultado da operação com o valor
 * exibido e diz quando os dois não fecham.
 */

function abrir(nome: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(nome, "i") }));
}

describe("CalcHint", () => {
  it("mostra a conta com os números da linha, não a fórmula", () => {
    render(
      <CalcHint
        label="Total da linha"
        operandos={[
          { valor: "R$ 4,0531", papel: "preço faturado" },
          { valor: "123", papel: "quantidade em un" },
        ]}
        resultado="R$ 498,53"
        esperado={4.0531 * 123}
      />,
    );
    abrir("Total da linha");

    expect(screen.getByText("R$ 4,0531")).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.getByText("R$ 498,53")).toBeInTheDocument();
    expect(screen.getByText(/preço faturado/)).toBeInTheDocument();
  });

  it("cala quando a conta fecha", () => {
    render(
      <CalcHint
        label="Total da linha"
        operandos={[
          { valor: "R$ 4,0531", papel: "preço" },
          { valor: "123", papel: "quantidade" },
        ]}
        resultado="R$ 498,53"
        esperado={498.5313}
      />,
    );
    abrir("Total da linha");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("avisa quando a conta NÃO fecha com o valor exibido", () => {
    // Exatamente o defeito antigo: preço cortado em duas casas ao lado de um
    // total calculado com quatro.
    render(
      <CalcHint
        label="Total da linha"
        operandos={[
          { valor: "R$ 4,05", papel: "preço" },
          { valor: "123", papel: "quantidade" },
        ]}
        resultado="R$ 498,53"
        esperado={4.05 * 123}
      />,
    );
    abrir("Total da linha");
    expect(screen.getByRole("alert")).toHaveTextContent(/não fecha com o valor exibido/i);
  });

  it("sem `esperado` não inventa conferência", () => {
    render(
      <CalcHint
        label="Lotes de referência"
        operandos={[
          { valor: "1.100", papel: "quantidade pedida" },
          { valor: "1.000", papel: "lote de referência", operador: "÷" },
        ]}
        resultado="2 (arredondado para cima)"
      />,
    );
    abrir("Lotes de referência");
    // Um lote parcial custa um lote inteiro: a divisão não fecha, e não deve
    // ser conferida como se fechasse.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/arredondado para cima/)).toBeInTheDocument();
  });

  it("aceita resultado que não é número — “não aplicável” nunca vira zero", () => {
    render(
      <CalcHint
        label="Custo de MP-000001"
        operandos={[{ valor: "3 kg", papel: "quantidade" }]}
        resultado="não aplicável"
        nota="Material fornecido pelo cliente: a Veridi não o comprou."
      />,
    );
    abrir("Custo de MP-000001");
    expect(screen.getByText("não aplicável")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("A conferência não depende de ninguém lembrar dela", () => {
  /*
   * `esperado` era opcional, e omitir desligava a checagem em silêncio. Foi o
   * que aconteceu na Formulação: a explicação da quantidade física mostrava
   * `22 kg × (1 + 23%) ÷ 99%` — que dá 27,33 — ao lado do valor exibido de
   * 0,091111 kg, porque faltava a divisão pela base de 300. O motor estava
   * certo; a explicação, não. E o alarme escrito para exatamente esse caso
   * estava dormindo.
   */
  it("um fator esquecido na explicação acusa divergência, sem `esperado`", () => {
    render(
      <CalcHint
        label="Quantidade física"
        operandos={[
          { valor: "22 kg", papel: "quantidade teórica", numero: 22 },
          { valor: "99%", papel: "pureza", operador: "÷", numero: 0.99 },
          { valor: "(1 + 23%)", papel: "overage", numero: 1.23 },
        ]}
        resultado="0,091111 kg"
      />,
    );
    abrir("Quantidade física");

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("com todos os fatores, a mesma conta fecha e não acusa nada", () => {
    render(
      <CalcHint
        label="Quantidade física"
        operandos={[
          { valor: "22 kg", papel: "quantidade teórica", numero: 22 },
          { valor: "300", papel: "base da fórmula", operador: "÷", numero: 300 },
          { valor: "99%", papel: "pureza", operador: "÷", numero: 0.99 },
          { valor: "(1 + 23%)", papel: "overage", numero: 1.23 },
        ]}
        resultado="0,091111 kg"
      />,
    );
    abrir("Quantidade física");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a folga sai da precisão exibida, não de meio centavo fixo", () => {
    /*
     * Meio centavo sobre 0,091111 kg seria 5% do valor — folga larga o
     * bastante para deixar passar erro nenhum. Aqui a conta dá 0,0911111 e a
     * tela mostraria 0,0916: divergência de 0,0005, invisível para a folga
     * antiga e visível para a que vem das seis casas exibidas.
     */
    render(
      <CalcHint
        label="Quantidade física"
        operandos={[
          { valor: "22 kg", papel: "quantidade teórica", numero: 22 },
          { valor: "300", papel: "base da fórmula", operador: "÷", numero: 300 },
          { valor: "99%", papel: "pureza", operador: "÷", numero: 0.99 },
          { valor: "(1 + 23%)", papel: "overage", numero: 1.23 },
        ]}
        resultado="0,091600 kg"
      />,
    );
    abrir("Quantidade física");

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("sem `numero` em algum operando, a conferência fica desligada como antes", () => {
    render(
      <CalcHint
        label="Total da linha"
        operandos={[
          { valor: "R$ 4,0531", papel: "preço faturado" },
          { valor: "123", papel: "quantidade em un" },
        ]}
        resultado="R$ 1,00"
      />,
    );
    abrir("Total da linha");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
