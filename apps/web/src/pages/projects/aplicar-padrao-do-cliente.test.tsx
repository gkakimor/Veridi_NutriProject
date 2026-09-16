import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  CustomerPaymentDefaultsDTO,
  QuoteVersionDTO,
  UpdateQuoteVersionInput,
} from "@veridi/shared";
import { PARCELADO_SEM_PARCELAS_MESSAGE } from "@veridi/shared";

/**
 * Forma de pagamento e "Aplicar padrão do cliente" no Orçamento —
 * CUSTOMER-PAYMENT-DEFAULTS-01.
 *
 * O padrão do cliente é SUGESTÃO: a V1 já nasce com ele, e depois disso o
 * rascunho só o recebe por ação explícita. O que estes casos fixam:
 *
 * 1. a ação aparece só no rascunho de quem negocia, com cliente que tem padrão
 *    e padrão diferente do que está nos campos;
 * 2. aplicar escreve forma e condição NA TELA — nada é gravado, e vira a mesma
 *    pendência de "Alterações não salvas", que Salvar grava e Descartar desfaz;
 * 3. o que o cliente não tem padrão não é tocado, e validade, prazo, desconto e
 *    observações nunca são;
 * 4. forma de pagamento é campo opcional ("Não informada" vai `null`);
 * 5. parcelado sem parcelas trava salvar e simular, com a frase do servidor.
 */

vi.mock("../../lib/projects-api", () => ({
  previewQuotePaymentSchedule: vi.fn(),
}));

import { previewQuotePaymentSchedule } from "../../lib/projects-api";
import { QuoteConditionsForm } from "./QuoteConditionsForm";

const PADRAO_PARCELADO: CustomerPaymentDefaultsDTO = {
  defaultPaymentInstrument: "PIX",
  defaultPaymentMethod: "INSTALLMENTS",
  defaultDownPaymentPercent: "30.0000",
  defaultInstallmentCount: 3,
  defaultInstallmentIntervalDays: 45,
  defaultMonthlyInterestPercent: "1.5000",
};

const SEM_PADRAO: CustomerPaymentDefaultsDTO = {
  defaultPaymentInstrument: null,
  defaultPaymentMethod: null,
  defaultDownPaymentPercent: null,
  defaultInstallmentCount: null,
  defaultInstallmentIntervalDays: null,
  defaultMonthlyInterestPercent: null,
};

function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    status: "DRAFT",
    lines: [],
    validUntil: "2026-09-15T00:00:00.000Z",
    leadTimeDays: 20,
    commercialNotes: "Frete FOB",
    discountPercent: "5.0000",
    paymentInstrument: null,
    paymentMethod: "CASH",
    downPaymentPercent: null,
    installmentCount: null,
    installmentIntervalDays: null,
    monthlyInterestPercent: null,
    paymentSchedule: null,
    customerPaymentDefaults: PADRAO_PARCELADO,
    ...overrides,
  } as QuoteVersionDTO;
}

function montar(quote: QuoteVersionDTO, { editable = true } = {}) {
  const onSave = vi.fn<(input: UpdateQuoteVersionInput) => void>();
  const onPendenciaChange = vi.fn<(pendente: boolean) => void>();
  render(
    <StrictMode>
      <QuoteConditionsForm
        quote={quote}
        editable={editable}
        saving={false}
        onSave={onSave}
        onPendenciaChange={onPendenciaChange}
      />
    </StrictMode>,
  );
  return { onSave, onPendenciaChange };
}

const botaoAplicar = () => screen.queryByRole("button", { name: "Aplicar padrão do cliente" });
const botao = (nome: string) => screen.getByRole("button", { name: nome }) as HTMLButtonElement;
const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;
const situacao = () =>
  screen
    .getAllByRole("status")
    .find((elemento) => /^(Alterações não salvas|Tudo salvo)$/.test(elemento.textContent ?? ""))
    ?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Aplicar padrão do cliente — quando aparece", () => {
  it("rascunho editável, cliente com padrão diferente dos campos: aparece, com o padrão descrito", () => {
    montar(versao());
    expect(botaoAplicar()).not.toBeNull();
    expect(document.getElementById("quote-customer-default-hint")?.textContent).toBe(
      "Padrão do cliente: PIX · Parcelado — entrada de 30% e 3× a cada 45 dias, juros de 1,5% ao mês. Aplicar só preenche forma e condição na tela — nada é gravado até salvar.",
    );
  });

  it("quem não edita a versão não vê a ação", () => {
    montar(versao(), { editable: false });
    expect(botaoAplicar()).toBeNull();
  });

  it.each([
    ["sem padrão na resposta (versão fora de rascunho)", null],
    ["cliente sem nenhum padrão", SEM_PADRAO],
  ] as const)("%s: não aparece", (_caso, padrao) => {
    montar(versao({ customerPaymentDefaults: padrao }));
    expect(botaoAplicar()).toBeNull();
  });

  it("campos já iguais ao padrão: não aparece — aplicar não mudaria nada", () => {
    montar(
      versao({
        paymentInstrument: "PIX",
        paymentMethod: "INSTALLMENTS",
        downPaymentPercent: "30.0000",
        installmentCount: 3,
        installmentIntervalDays: 45,
        monthlyInterestPercent: "1.5000",
      }),
    );
    expect(botaoAplicar()).toBeNull();
  });

  it("texto escondido no parcelamento de uma condição à vista não faz a ação aparecer", () => {
    montar(
      versao({
        paymentInstrument: "BOLETO",
        customerPaymentDefaults: { ...SEM_PADRAO, defaultPaymentInstrument: "BOLETO", defaultPaymentMethod: "CASH" },
      }),
    );
    expect(botaoAplicar()).toBeNull();
    fireEvent.change(campo("Condição de pagamento"), { target: { value: "INSTALLMENTS" } });
    fireEvent.change(campo("Parcelas"), { target: { value: "4" } });
    fireEvent.change(campo("Condição de pagamento"), { target: { value: "CASH" } });
    expect(botaoAplicar()).toBeNull();
  });
});

describe("Aplicar padrão do cliente — preenche a tela, não grava", () => {
  it("forma e condição inteiras nos campos; o resto fica; vira pendência sem chamar o servidor", () => {
    const { onSave, onPendenciaChange } = montar(versao());
    expect(situacao()).toBe("Tudo salvo");

    fireEvent.click(botaoAplicar()!);

    expect(campo("Forma de pagamento").value).toBe("PIX");
    expect(campo("Condição de pagamento").value).toBe("INSTALLMENTS");
    expect(campo("Entrada (%)").value).toBe("30");
    expect(campo("Parcelas").value).toBe("3");
    expect(campo("Intervalo (dias)").value).toBe("45");
    expect(campo("Juros ao mês (%)").value).toBe("1,5");
    // Validade, prazo, desconto e observações não são do padrão.
    expect(campo("Validade da proposta").value).toBe("2026-09-15");
    expect(campo("Prazo de entrega (dias)").value).toBe("20");
    expect(campo("Desconto (%)").value).toBe("5");
    expect(campo("Observações comerciais").value).toBe("Frete FOB");

    expect(situacao()).toBe("Alterações não salvas");
    expect(onPendenciaChange).toHaveBeenLastCalledWith(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(previewQuotePaymentSchedule).not.toHaveBeenCalled();
    // Aplicado, não há mais o que aplicar.
    expect(botaoAplicar()).toBeNull();
  });

  it("Descartar volta ao gravado, e a ação volta a ser oferecida", () => {
    const { onSave, onPendenciaChange } = montar(versao());
    fireEvent.click(botaoAplicar()!);

    fireEvent.click(botao("Descartar alterações"));

    expect(campo("Forma de pagamento").value).toBe("");
    expect(campo("Condição de pagamento").value).toBe("CASH");
    expect(situacao()).toBe("Tudo salvo");
    expect(onPendenciaChange).toHaveBeenLastCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(botaoAplicar()).not.toBeNull();
  });

  it("Salvar condições grava o padrão aplicado — e só então", () => {
    const { onSave } = montar(versao());
    fireEvent.click(botaoAplicar()!);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(botao("Salvar condições"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      validUntil: "2026-09-15",
      leadTimeDays: 20,
      commercialNotes: "Frete FOB",
      discountPercent: "5",
      paymentInstrument: "PIX",
      paymentMethod: "INSTALLMENTS",
      downPaymentPercent: "30",
      installmentCount: 3,
      installmentIntervalDays: 45,
      monthlyInterestPercent: "1.5",
    });
  });

  it("cliente só com forma: aplicar troca a forma e deixa a condição negociada", () => {
    const { onSave } = montar(
      versao({
        paymentInstrument: "BOLETO",
        paymentMethod: "INSTALLMENTS",
        installmentCount: 2,
        customerPaymentDefaults: { ...SEM_PADRAO, defaultPaymentInstrument: "PIX" },
      }),
    );

    fireEvent.click(botaoAplicar()!);
    fireEvent.click(botao("Salvar condições"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ paymentInstrument: "PIX", paymentMethod: "INSTALLMENTS", installmentCount: 2 }),
    );
  });

  it("cliente à vista: aplicar tira o parcelamento do rascunho, e a forma do rascunho fica", () => {
    const { onSave } = montar(
      versao({
        paymentInstrument: "CARD",
        paymentMethod: "INSTALLMENTS",
        installmentCount: 2,
        monthlyInterestPercent: "2.0000",
        customerPaymentDefaults: { ...SEM_PADRAO, defaultPaymentMethod: "CASH" },
      }),
    );

    fireEvent.click(botaoAplicar()!);
    expect(screen.queryByLabelText("Parcelas")).toBeNull();
    fireEvent.click(botao("Salvar condições"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentInstrument: "CARD",
        paymentMethod: "CASH",
        installmentCount: null,
        monthlyInterestPercent: null,
      }),
    );
  });
});

describe("forma de pagamento no formulário do Orçamento", () => {
  it("a forma é opcional: Não informada vai null, escolhida vai o valor", () => {
    const { onSave } = montar(versao({ paymentInstrument: "BOLETO", customerPaymentDefaults: null }));
    expect(campo("Forma de pagamento").value).toBe("BOLETO");

    fireEvent.change(campo("Forma de pagamento"), { target: { value: "" } });
    expect(situacao()).toBe("Alterações não salvas");
    fireEvent.click(botao("Salvar condições"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ paymentInstrument: null }));
  });

  it("parcelado sem parcelas trava salvar e simular, com a frase ao lado de Parcelas", () => {
    const { onSave } = montar(versao({ customerPaymentDefaults: null }));

    fireEvent.change(campo("Condição de pagamento"), { target: { value: "INSTALLMENTS" } });

    expect(document.getElementById("quote-installments-error")?.textContent).toBe(
      PARCELADO_SEM_PARCELAS_MESSAGE,
    );
    expect(campo("Parcelas")).toHaveAttribute("aria-invalid", "true");
    expect(botao("Salvar condições").disabled).toBe(true);
    expect(botao("Simular").disabled).toBe(true);
    fireEvent.click(botao("Salvar condições"));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(campo("Parcelas"), { target: { value: "3" } });

    expect(document.getElementById("quote-installments-error")).toBeNull();
    expect(botao("Salvar condições").disabled).toBe(false);
  });

  it("versão que não se edita lê forma e condição em duas linhas", () => {
    montar(versao({ status: "SENT", paymentInstrument: "BANK_TRANSFER", customerPaymentDefaults: null }), {
      editable: false,
    });
    const lido = (rotulo: string) =>
      [...document.querySelectorAll("dt")].find((dt) => dt.textContent === rotulo)?.nextElementSibling
        ?.textContent;
    expect(lido("Forma de pagamento")).toBe("Transferência");
    expect(lido("Condição de pagamento")).toBe("À vista");
  });
});
