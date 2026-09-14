import { createRef, useState } from "react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ESPACO_MOEDA } from "../lib/decimal-format";
import { parsePtBrNumber, toPtBrEditText } from "../lib/numeric-ptbr";
import { DecimalField, IntegerField, MoneyField, PercentField } from "./NumericField";
import type { DecimalFieldProps } from "./NumericField";

/**
 * Campos numéricos pt-BR — PTBR-NUMERIC-INPUT-FOUNDATION-01.
 *
 * O campo guarda o texto digitado e deixa a pessoa digitar como escreve em
 * português: nenhuma tecla válida é reescrita, nenhuma inválida entra, apagar
 * e selecionar são nativos. Fora do foco o número aparece formatado; no foco,
 * o texto editável; na saída, normalizado uma vez.
 *
 * jsdom não mede layout nem abre teclado de celular: a largura em 390px e o
 * cursor posto por clique real ficam com o smoke em navegador.
 */

type CampoDecimal = ComponentType<DecimalFieldProps>;

interface HarnessProps extends Partial<DecimalFieldProps> {
  Campo?: CampoDecimal;
  inicial?: string;
  aoMudar?: (valor: string) => void;
}

function Harness({ Campo = MoneyField, inicial = "", aoMudar, scale = 2, ...props }: HarnessProps) {
  const [valor, setValor] = useState(inicial);
  return (
    <form>
      <div className="field">
        <label htmlFor="campo">Preço</label>
        <Campo
          id="campo"
          scale={scale}
          value={valor}
          onChangeValue={(novo) => {
            aoMudar?.(novo);
            setValor(novo);
          }}
          {...props}
        />
      </div>
      <input aria-label="Outro campo" />
      <output data-testid="guardado">{valor}</output>
    </form>
  );
}

function montar(props: HarnessProps = {}) {
  const aoMudar = vi.fn();
  const user = userEvent.setup();
  render(<Harness aoMudar={aoMudar} {...props} />);
  const campo = screen.getByLabelText("Preço") as HTMLInputElement;
  const guardado = () => screen.getByTestId("guardado").textContent;
  return { user, campo, aoMudar, guardado };
}

describe("contrato do elemento", () => {
  it("é texto com o teclado certo no celular, nunca type=number", () => {
    render(
      <>
        <IntegerField aria-label="Inteiro" value="" onChangeValue={() => {}} />
        <DecimalField aria-label="Decimal" scale={6} value="" onChangeValue={() => {}} />
        <MoneyField aria-label="Dinheiro" scale={2} value="" onChangeValue={() => {}} />
        <PercentField aria-label="Percentual" scale={2} value="" onChangeValue={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Inteiro")).toHaveAttribute("inputmode", "numeric");
    for (const rotulo of ["Decimal", "Dinheiro", "Percentual"]) {
      expect(screen.getByLabelText(rotulo), rotulo).toHaveAttribute("inputmode", "decimal");
    }
    for (const rotulo of ["Inteiro", "Decimal", "Dinheiro", "Percentual"]) {
      expect(screen.getByLabelText(rotulo), rotulo).toHaveAttribute("type", "text");
    }
  });

  it("repassa rótulo, name, placeholder, required, aria-describedby e ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <>
        <label htmlFor="preco">Preço unitário</label>
        <MoneyField
          id="preco"
          ref={ref}
          name="unitPrice"
          placeholder="0,00"
          required
          aria-describedby="preco-ajuda"
          scale={4}
          value=""
          onChangeValue={() => {}}
        />
        <p id="preco-ajuda">Até 4 casas.</p>
      </>,
    );
    const campo = screen.getByLabelText("Preço unitário");
    expect(campo).toBe(ref.current);
    expect(campo).toHaveAttribute("name", "unitPrice");
    expect(campo).toHaveAttribute("placeholder", "0,00");
    expect(campo).toBeRequired();
    expect(campo).toHaveAccessibleDescription("Até 4 casas.");
    expect(campo).toHaveAttribute("autocomplete", "off");
  });

  it("inputMode pode ser trocado por quem sabe o teclado que precisa", () => {
    render(<DecimalField aria-label="Ajuste" scale={2} allowNegative inputMode="text" value="" onChangeValue={() => {}} />);
    expect(screen.getByLabelText("Ajuste")).toHaveAttribute("inputmode", "text");
  });
});

describe("digitação", () => {
  it("1 · 12 · 12, · 12,3 · 12,34 — nada é reescrito e o cursor acompanha", async () => {
    const { user, campo, aoMudar } = montar();
    await user.click(campo);
    for (const [tecla, esperado] of [
      ["1", "1"],
      ["2", "12"],
      [",", "12,"],
      ["3", "12,3"],
      ["4", "12,34"],
    ] as const) {
      await user.keyboard(tecla);
      expect(campo).toHaveValue(esperado);
      expect(campo.selectionStart).toBe(esperado.length);
      expect(campo.selectionEnd).toBe(esperado.length);
    }
    expect(aoMudar.mock.calls.map(([valor]) => valor)).toEqual(["1", "12", "12,", "12,3", "12,34"]);
  });

  it("letras e símbolos não entram, e nada é avisado ao formulário", async () => {
    const { user, campo, aoMudar } = montar();
    await user.type(campo, "abcR$%");
    expect(campo).toHaveValue("");
    expect(aoMudar).not.toHaveBeenCalled();
    await user.type(campo, "12abc");
    expect(campo).toHaveValue("12");
    expect(aoMudar.mock.calls.map(([valor]) => valor)).toEqual(["1", "12"]);
  });

  it("tecla recusada no meio do texto deixa o cursor onde estava", async () => {
    const { user, campo } = montar({ inicial: "1234" });
    await user.click(campo);
    await user.type(campo, "x", { initialSelectionStart: 2, initialSelectionEnd: 2 });
    expect(campo).toHaveValue("1234");
    expect(campo.selectionStart).toBe(2);
    await user.keyboard("5");
    expect(campo).toHaveValue("12534");
    expect(campo.selectionStart).toBe(3);
  });

  it("tecla recusada sobre uma seleção mantém a seleção", async () => {
    const { user, campo } = montar({ inicial: "1234" });
    await user.click(campo);
    await user.type(campo, "x", { initialSelectionStart: 1, initialSelectionEnd: 3 });
    expect(campo).toHaveValue("1234");
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([1, 3]);
  });

  it("segunda vírgula não entra", async () => {
    const { user, campo } = montar();
    await user.type(campo, "12,3,4");
    expect(campo).toHaveValue("12,34");
  });

  it("scale 2: a terceira casa não entra", async () => {
    const { user, campo } = montar({ scale: 2 });
    await user.type(campo, "12,345");
    expect(campo).toHaveValue("12,34");
  });

  it("scale 4: preço unitário com 4 casas, a quinta não entra", async () => {
    const { user, campo } = montar({ scale: 4 });
    await user.type(campo, "12,34567");
    expect(campo).toHaveValue("12,3456");
    await user.tab();
    expect(campo).toHaveValue("12,3456");
  });

  it("alta precisão: 12 casas entram, a décima terceira não", async () => {
    const { user, campo } = montar({ Campo: DecimalField, scale: 12 });
    await user.type(campo, "0,0000000000019");
    expect(campo).toHaveValue("0,000000000001");
    await user.tab();
    expect(campo).toHaveValue("0,000000000001");
    expect(parsePtBrNumber(campo.value, { scale: 12 })).toEqual({ tipo: "valido", valor: "0.000000000001" });
  });

  it("ponto também entra: milhar digitado ou decimal de teclado sem vírgula", async () => {
    const { user, campo } = montar({ Campo: DecimalField, scale: 2 });
    await user.type(campo, "12.5");
    expect(campo).toHaveValue("12.5");
  });

  it("sinal de menos não entra em campo sem negativo", async () => {
    const { user, campo } = montar();
    await user.type(campo, "-12");
    expect(campo).toHaveValue("12");
  });

  it("com allowNegative, o sinal entra só no começo", async () => {
    const { user, campo } = montar({ Campo: DecimalField, allowNegative: true });
    await user.type(campo, "-12,5");
    expect(campo).toHaveValue("-12,5");
    await user.keyboard("-");
    expect(campo).toHaveValue("-12,5");
  });

  it("campo inteiro aceita só dígitos", async () => {
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    function Inteiro() {
      const [valor, setValor] = useState("");
      return (
        <IntegerField
          aria-label="Parcelas"
          value={valor}
          onChangeValue={(novo) => {
            aoMudar(novo);
            setValor(novo);
          }}
        />
      );
    }
    render(<Inteiro />);
    const campo = screen.getByLabelText("Parcelas");
    await user.type(campo, "-1,2.3a4");
    expect(campo).toHaveValue("1234");
    await user.tab();
    expect(campo).toHaveValue("1.234");
    expect(aoMudar).toHaveBeenLastCalledWith("1234");
  });

  it("mudança que não passa por beforeinput (arrastar, autopreenchimento) tem a mesma guarda", () => {
    const aoMudar = vi.fn();
    render(<DecimalField aria-label="Qtd" scale={2} value="12" onChangeValue={aoMudar} />);
    const campo = screen.getByLabelText("Qtd") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "12a" } });
    expect(aoMudar).not.toHaveBeenCalled();
    expect(campo).toHaveValue("12");
    fireEvent.change(campo, { target: { value: "12,5" } });
    expect(aoMudar).toHaveBeenCalledWith("12,5");
  });
});

describe("apagar, selecionar, copiar", () => {
  it("Backspace e Delete funcionam", async () => {
    const { user, campo } = montar({ inicial: "1234,5" });
    await user.click(campo);
    await user.keyboard("{End}{Backspace}");
    expect(campo).toHaveValue("1234,");
    await user.keyboard("{Backspace}{Backspace}");
    expect(campo).toHaveValue("123");
    await user.keyboard("{Home}{Delete}");
    expect(campo).toHaveValue("23");
    expect(campo.selectionStart).toBe(0);
  });

  it("apagar nunca é bloqueado, nem quando o que sobra ainda não é número", async () => {
    const { user, campo } = montar({ Campo: DecimalField, scale: 2 });
    await user.type(campo, "1.234,5");
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{Backspace}");
    expect(campo).toHaveValue("1.34,5");
    await user.tab();
    expect(campo).toHaveAttribute("aria-invalid", "true");
  });

  it("Ctrl+A seleciona tudo e a tecla seguinte substitui", async () => {
    const { user, campo } = montar({ inicial: "1234,5" });
    await user.click(campo);
    await user.keyboard("{Control>}a{/Control}");
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([0, 6]);
    await user.keyboard("9");
    expect(campo).toHaveValue("9");
  });

  it("setas movem o cursor e a digitação entra no lugar", async () => {
    const { user, campo } = montar({ inicial: "125" });
    await user.click(campo);
    await user.keyboard("{End}{ArrowLeft}{ArrowLeft}4");
    expect(campo).toHaveValue("1425");
  });

  it("Ctrl+C copia o texto do campo sem alterá-lo", async () => {
    const { user, campo, aoMudar } = montar({ inicial: "1234,5" });
    await user.click(campo);
    await user.keyboard("{Control>}a{/Control}");
    const copiado = await user.copy();
    expect(copiado?.getData("text/plain")).toBe("1234,5");
    expect(campo).toHaveValue("1234,5");
    expect(aoMudar).not.toHaveBeenCalled();
  });
});

describe("colar", () => {
  it.each([
    ["1234,56", "1234,56"],
    ["1.234,56", "1234,56"],
    ["1234.56", "1234,56"],
    ["R$ 1.234,56", "1234,56"],
    [" 1.234,56\r\n", "1234,56"],
  ])("colar %j num campo de moeda vazio guarda %j", async (colado, esperado) => {
    const { user, campo, aoMudar } = montar();
    await user.click(campo);
    await user.paste(colado);
    expect(campo).toHaveValue(esperado);
    expect(campo.selectionStart).toBe(esperado.length);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(campo).toHaveValue("1.234,56");
  });

  it("texto que não é número não entra, inteiro", async () => {
    const { user, campo, aoMudar } = montar({ inicial: "12" });
    await user.click(campo);
    for (const colado of ["abc", "12abc", "1,234.56", "12\t34", "-5"]) {
      await user.paste(colado);
      expect(campo, colado).toHaveValue("12");
    }
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("colar no meio insere no cursor e o cursor fica depois do trecho", async () => {
    const { user, campo } = montar({ inicial: "12" });
    await user.click(campo);
    await user.keyboard("{Home}{ArrowRight}");
    await user.paste("5");
    expect(campo).toHaveValue("152");
    expect(campo.selectionStart).toBe(2);
  });

  it("colar que quebraria o número não entra", async () => {
    const { user, campo } = montar({ inicial: "12,3" });
    await user.click(campo);
    await user.paste("4,5");
    expect(campo).toHaveValue("12,3");
  });

  it("colar sobre a seleção substitui", async () => {
    const { user, campo } = montar({ inicial: "99,99" });
    await user.click(campo);
    await user.keyboard("{Control>}a{/Control}");
    await user.paste("1.500,00");
    expect(campo).toHaveValue("1500,00");
  });

  it("o ambíguo colado entra como veio e é acusado na saída — nunca vira 1,234 nem 1234", async () => {
    const { user, campo, guardado } = montar({ Campo: DecimalField, scale: 4 });
    await user.click(campo);
    await user.paste("1.234");
    expect(campo).toHaveValue("1.234");
    await user.tab();
    expect(campo).toHaveValue("1.234");
    expect(guardado()).toBe("1.234");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveClass("is-invalid");
    expect(parsePtBrNumber(guardado() ?? "", { scale: 4 })).toEqual({ tipo: "invalido", motivo: "ambiguo" });
  });

  it("percentual colado com % e campo inteiro colado com milhar", async () => {
    const { user, campo } = montar({ Campo: PercentField, scale: 2 });
    await user.click(campo);
    await user.paste("12,5%");
    expect(campo).toHaveValue("12,5");

    const aoMudarDias = vi.fn();
    render(<IntegerField aria-label="Dias" value="" onChangeValue={aoMudarDias} />);
    await user.click(screen.getByLabelText("Dias"));
    await user.paste("1.234");
    expect(aoMudarDias).toHaveBeenCalledWith("1234");
  });
});

describe("foco e saída", () => {
  it("fora do foco formatado; no foco, o texto editável; sem avisar mudança nenhuma", async () => {
    const { user, campo, aoMudar } = montar({ inicial: "1234,5" });
    expect(campo).toHaveValue("1.234,50");
    await user.click(campo);
    expect(campo).toHaveValue("1234,5");
    await user.tab();
    expect(campo).toHaveValue("1.234,50");
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("entrar pelo teclado seleciona o texto todo, e digitar substitui", async () => {
    const { user, campo } = montar({ inicial: "1234,5" });
    await user.click(screen.getByLabelText("Outro campo"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(campo);
    expect(campo).toHaveValue("1234,5");
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([0, 6]);
    await user.keyboard("7");
    expect(campo).toHaveValue("7");
  });

  it("foco sem ponteiro (teclado ou código): a troca do texto não deixa o cursor perdido no fim", () => {
    const { campo } = montar({ inicial: "1234,5" });
    // Sem o user-event por trás: ele mesmo selecionaria tudo no Tab e esconderia a troca.
    act(() => campo.focus());
    expect(campo).toHaveValue("1234,5");
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([0, 6]);
  });

  it.each([
    ["1.500,00", "1500,00", "1.500,00"],
    ["12.5", "12,5", "12,50"],
    ["007", "7", "7,00"],
    ["12,", "12", "12,00"],
    [",5", "0,5", "0,50"],
  ])("na saída, %j é normalizado uma vez para %j e aparece %j", async (digitado, normalizado, exibido) => {
    const { user, campo, aoMudar, guardado } = montar();
    await user.type(campo, digitado);
    await user.tab();
    expect(guardado()).toBe(normalizado);
    expect(aoMudar).toHaveBeenLastCalledWith(normalizado);
    expect(campo).toHaveValue(exibido);
  });

  it("onFocus, onBlur e onPaste de quem usa continuam sendo chamados", async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onPaste = vi.fn();
    const { user, campo } = montar({ onFocus, onBlur, onPaste });
    await user.click(campo);
    await user.paste("1");
    await user.tab();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe("zero, vazio e negativo", () => {
  it("zero carregado continua zero, nunca vazio", async () => {
    const { user, campo, aoMudar, guardado } = montar({ inicial: "0" });
    expect(campo).toHaveValue("0,00");
    await user.click(campo);
    expect(campo).toHaveValue("0");
    await user.tab();
    expect(guardado()).toBe("0");
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("0 e 0,00 digitados continuam zero, com as casas escritas", async () => {
    const { user, campo, guardado } = montar({ Campo: DecimalField, scale: 2 });
    await user.type(campo, "0,00");
    await user.tab();
    expect(guardado()).toBe("0,00");
    // Sem mínimo de casas a exibição corta os zeros à direita — e continua zero.
    expect(campo).toHaveValue("0");
    expect(parsePtBrNumber(guardado() ?? "", { scale: 2 })).toEqual({ tipo: "valido", valor: "0.00" });
  });

  it("vazio continua vazio: sair do campo não inventa zero", async () => {
    const { user, campo, aoMudar, guardado } = montar();
    await user.click(campo);
    await user.tab();
    expect(campo).toHaveValue("");
    expect(guardado()).toBe("");
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("apagar tudo volta a vazio", async () => {
    const { user, campo, guardado } = montar({ inicial: "12" });
    await user.click(campo);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.tab();
    expect(guardado()).toBe("");
    expect(campo).toHaveValue("");
  });

  it("negativo permitido: formatado fora do foco e zero sem sinal", async () => {
    const { user, campo, guardado } = montar({ Campo: DecimalField, allowNegative: true, minFractionDigits: 2 });
    await user.type(campo, "-1234,5");
    await user.tab();
    expect(campo).toHaveValue("-1.234,50");
    await user.click(campo);
    await user.keyboard("{Control>}a{/Control}-0");
    await user.tab();
    expect(guardado()).toBe("0");
  });
});

describe("desabilitado, somente leitura e aria-invalid", () => {
  it("desabilitado: formatado, sem símbolo e sem edição", async () => {
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<MoneyField aria-label="Total" scale={2} disabled value="1234,5" onChangeValue={aoMudar} />);
    const campo = screen.getByLabelText("Total");
    expect(campo).toBeDisabled();
    expect(campo).toHaveValue("1.234,50");
    await user.type(campo, "9");
    expect(campo).toHaveValue("1.234,50");
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("somente leitura: apresentação com R$ e %, o foco não troca o texto", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MoneyField aria-label="Total" scale={2} readOnly value="1234,5" onChangeValue={() => {}} />
        <MoneyField aria-label="Preço" scale={4} readOnly value="12,3456" onChangeValue={() => {}} />
        <PercentField aria-label="Margem" scale={2} minFractionDigits={2} readOnly value="12,5" onChangeValue={() => {}} />
        <MoneyField aria-label="Estorno" scale={2} allowNegative readOnly value="-10" onChangeValue={() => {}} />
      </>,
    );
    const total = screen.getByLabelText("Total");
    expect(total).toHaveAttribute("readonly");
    expect(total).toHaveValue(`R$${ESPACO_MOEDA}1.234,50`);
    expect(screen.getByLabelText("Preço")).toHaveValue(`R$${ESPACO_MOEDA}12,3456`);
    expect(screen.getByLabelText("Margem")).toHaveValue("12,50%");
    expect(screen.getByLabelText("Estorno")).toHaveValue(`-R$${ESPACO_MOEDA}10,00`);
    await user.click(total);
    expect(total).toHaveValue(`R$${ESPACO_MOEDA}1.234,50`);
    await user.keyboard("9");
    expect(total).toHaveValue(`R$${ESPACO_MOEDA}1.234,50`);
  });

  it("editável: o símbolo fica no rótulo, não no campo", () => {
    render(<PercentField aria-label="Comissão (%)" scale={2} minFractionDigits={2} value="12,5" onChangeValue={() => {}} />);
    expect(screen.getByLabelText("Comissão (%)")).toHaveValue("12,50");
  });

  it("aria-invalid: acusado sozinho só fora do foco; o de quem usa vence", async () => {
    const { user, campo } = montar({ Campo: DecimalField, scale: 4 });
    await user.type(campo, "1.234");
    expect(campo).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(campo).toHaveAttribute("aria-invalid", "true");

    render(
      <>
        <DecimalField aria-label="Obrigatório" aria-invalid scale={2} value="" onChangeValue={() => {}} />
        <DecimalField aria-label="Silenciado" aria-invalid={false} scale={2} value="1.234" onChangeValue={() => {}} />
        <DecimalField aria-label="Bom" scale={2} value="12,5" onChangeValue={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Obrigatório")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Obrigatório")).toHaveClass("is-invalid");
    expect(screen.getByLabelText("Silenciado")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByLabelText("Silenciado")).not.toHaveClass("is-invalid");
    expect(screen.getByLabelText("Bom")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Bom")).not.toHaveClass("is-invalid");
  });
});

describe("precisão de domínio", () => {
  it("preço unitário scale 4: carga, exibição e gravação sem arredondar para 2 casas", async () => {
    const { user, campo, guardado } = montar({ scale: 4, inicial: toPtBrEditText("12.3456", { scale: 4 }) });
    expect(campo).toHaveValue("12,3456");
    await user.click(campo);
    await user.tab();
    expect(parsePtBrNumber(guardado() ?? "", { scale: 4 })).toEqual({ tipo: "valido", valor: "12.3456" });
  });

  it("preço redondo em scale 4 aparece com 2 casas e grava o que veio", async () => {
    const { user, campo, aoMudar, guardado } = montar({ scale: 4, inicial: toPtBrEditText("12.5000", { scale: 4 }) });
    expect(campo).toHaveValue("12,50");
    await user.click(campo);
    expect(campo).toHaveValue("12,5000");
    await user.tab();
    expect(aoMudar).not.toHaveBeenCalled();
    expect(parsePtBrNumber(guardado() ?? "", { scale: 4 })).toEqual({ tipo: "valido", valor: "12.5000" });
  });

  it("alta precisão: abrir e sair sem editar devolve a string da API byte a byte", async () => {
    const valorDaApi = "999999999999.999999999999";
    const { user, campo, aoMudar, guardado } = montar({
      Campo: DecimalField,
      scale: 12,
      inicial: toPtBrEditText(valorDaApi, { scale: 12 }),
    });
    expect(campo).toHaveValue("999.999.999.999,999999999999");
    await user.click(campo);
    await user.tab();
    expect(aoMudar).not.toHaveBeenCalled();
    expect(parsePtBrNumber(guardado() ?? "", { scale: 12 })).toEqual({ tipo: "valido", valor: valorDaApi });
  });

  it("colar valor grande em alta precisão", async () => {
    const { user, campo, guardado } = montar({ Campo: DecimalField, scale: 12 });
    await user.click(campo);
    await user.paste("999.999.999.999,999999999999");
    await user.tab();
    expect(guardado()).toBe("999999999999,999999999999");
    expect(campo).toHaveValue("999.999.999.999,999999999999");
  });
});
