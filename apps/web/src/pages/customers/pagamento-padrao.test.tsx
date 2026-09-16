import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { PARCELADO_SEM_PARCELAS_MESSAGE } from "@veridi/shared";

/**
 * Pagamento padrão no cadastro do Cliente — CUSTOMER-PAYMENT-DEFAULTS-01.
 *
 * Seção própria, "Pagamento padrão", com forma e condição opcionais e o
 * parcelamento das condições do Orçamento. O que estes casos fixam é o que a
 * tela MOSTRA e MANDA: tudo nasce "Não informada"; o parcelamento só aparece no
 * parcelado; o cadastro novo só envia o que foi escolhido e a edição envia o
 * bloco inteiro (é assim que "Não informada" limpa); parcelado sem parcelas
 * não sai da tela; e quem não edita o cadastro lê o padrão, sem campo. A regra
 * do servidor está em `customer-payment-defaults.test.ts` (API).
 */

vi.mock("../../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("../../lib/cep-api", async (original) => ({
  ...(await original<object>()),
  lookupCep: vi.fn(),
}));

const sessao = vi.hoisted(() => ({ role: "COMMERCIAL" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { CustomerFormModal } from "./CustomerFormModal";

const SUBTITULO =
  "Sugestão para novos orçamentos deste cliente. Alterar aqui não muda orçamentos já criados.";

function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "IGEIA Suplementos LTDA",
    tradeName: null,
    cnpj: null,
    email: null,
    phone: null,
    taxProfile: "NOT_INFORMED",
    street: null,
    number: null,
    complement: null,
    district: null,
    zipCode: null,
    city: null,
    state: null,
    notes: null,
    businessLotSuffix: null,
    defaultPaymentInstrument: null,
    defaultPaymentMethod: null,
    defaultDownPaymentPercent: null,
    defaultInstallmentCount: null,
    defaultInstallmentIntervalDays: null,
    defaultMonthlyInterestPercent: null,
    active: true,
    blocked: false,
    status: "ACTIVE",
    block: null,
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: "João Silva",
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: "Maria Souza",
    ...overrides,
  };
}

const PARCELADO: Partial<CustomerDTO> = {
  defaultPaymentInstrument: "BOLETO",
  defaultPaymentMethod: "INSTALLMENTS",
  defaultDownPaymentPercent: "30.0000",
  defaultInstallmentCount: 3,
  defaultInstallmentIntervalDays: 45,
  defaultMonthlyInterestPercent: "1.5000",
};

function renderNovo() {
  return render(
    <MemoryRouter>
      <CustomerFormModal mode="create" customer={null} onClose={() => {}} onSaved={() => {}} />
    </MemoryRouter>,
  );
}

function renderEdicao(customer: CustomerDTO, readOnly = false) {
  return render(
    <MemoryRouter>
      <CustomerFormModal
        mode="edit"
        customer={customer}
        readOnly={readOnly}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;
const forma = () => screen.getByLabelText("Forma de pagamento padrão") as HTMLSelectElement;
const condicao = () => screen.getByLabelText("Condição de pagamento padrão") as HTMLSelectElement;

function enviadoNaCriacao(): Record<string, unknown> {
  const chamadas = vi.mocked(createCustomer).mock.calls;
  return chamadas[chamadas.length - 1]?.[0] as unknown as Record<string, unknown>;
}
function enviadoNaEdicao(): Record<string, unknown> {
  const chamadas = vi.mocked(updateCustomer).mock.calls;
  return chamadas[chamadas.length - 1]?.[1] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  sessao.role = "COMMERCIAL";
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
});

describe("Pagamento padrão — a seção", () => {
  it("tem título, a frase de sugestão e os dois seletores nativos, em Não informada", () => {
    renderNovo();

    const secao = screen.getByRole("heading", { name: "Pagamento padrão" }).closest("section")!;
    expect(within(secao).getByText(SUBTITULO)).toBeInTheDocument();
    expect(forma().tagName).toBe("SELECT");
    expect([...forma().options].map((opcao) => opcao.textContent)).toEqual([
      "Não informada",
      "PIX",
      "Boleto",
      "Transferência",
      "Cartão",
      "Outro",
    ]);
    expect([...condicao().options].map((opcao) => opcao.textContent)).toEqual([
      "Não informada",
      "À vista",
      "Parcelado",
    ]);
    expect(forma().value).toBe("");
    expect(condicao().value).toBe("");
  });

  it("o parcelamento só aparece no parcelado, com os campos e as dicas do Orçamento", () => {
    renderNovo();
    expect(screen.queryByLabelText("Parcelas")).toBeNull();

    fireEvent.change(condicao(), { target: { value: "INSTALLMENTS" } });
    for (const rotulo of ["Entrada (%)", "Parcelas", "Intervalo (dias)", "Juros ao mês (%)"]) {
      expect(screen.getByLabelText(rotulo)).toBeInTheDocument();
    }
    expect(screen.getByText("Vazio = 30 dias.")).toBeInTheDocument();

    fireEvent.change(condicao(), { target: { value: "CASH" } });
    expect(screen.queryByLabelText("Parcelas")).toBeNull();
  });
});

describe("Pagamento padrão — cadastro novo", () => {
  it("sem escolher nada, nenhum campo de pagamento viaja", async () => {
    const user = userEvent.setup();
    renderNovo();

    await user.type(screen.getByLabelText("Razão Social", { exact: false }), "Cliente Sem Padrão");
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    for (const chave of Object.keys(PARCELADO)) expect(enviadoNaCriacao()).not.toHaveProperty(chave);
  });

  it("forma e condição parcelada vão como escolhidas, percentual em ponto e inteiro em número", async () => {
    const user = userEvent.setup();
    renderNovo();

    await user.type(screen.getByLabelText("Razão Social", { exact: false }), "Cliente Parcelado");
    await user.selectOptions(forma(), "Boleto");
    await user.selectOptions(condicao(), "Parcelado");
    await user.type(campo("Entrada (%)"), "30");
    await user.type(campo("Parcelas"), "3");
    await user.type(campo("Juros ao mês (%)"), "1,5");
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaCriacao()).toMatchObject({
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "INSTALLMENTS",
      defaultDownPaymentPercent: "30",
      defaultInstallmentCount: 3,
      defaultMonthlyInterestPercent: "1.5",
    });
    expect(enviadoNaCriacao()).not.toHaveProperty("defaultInstallmentIntervalDays");
  });

  it("parcelado sem parcelas não sai da tela: a frase fica ao lado de Parcelas", async () => {
    const user = userEvent.setup();
    renderNovo();

    await user.type(screen.getByLabelText("Razão Social", { exact: false }), "Cliente Incompleto");
    await user.selectOptions(condicao(), "Parcelado");
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    expect(await screen.findByText(PARCELADO_SEM_PARCELAS_MESSAGE)).toBeInTheDocument();
    expect(campo("Parcelas")).toHaveAttribute("aria-invalid", "true");
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

describe("Pagamento padrão — edição", () => {
  it("carrega o padrão gravado nos campos", () => {
    renderEdicao(cliente(PARCELADO));

    expect(forma().value).toBe("BOLETO");
    expect(condicao().value).toBe("INSTALLMENTS");
    expect(campo("Entrada (%)").value).toBe("30");
    expect(campo("Parcelas").value).toBe("3");
    expect(campo("Intervalo (dias)").value).toBe("45");
    expect(campo("Juros ao mês (%)").value).toBe("1,5");
  });

  it("salvar envia o bloco inteiro — e à vista manda o parcelamento vazio", async () => {
    const user = userEvent.setup();
    renderEdicao(cliente(PARCELADO));

    await user.selectOptions(condicao(), "À vista");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaEdicao()).toMatchObject({
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
      defaultDownPaymentPercent: null,
      defaultInstallmentCount: null,
      defaultInstallmentIntervalDays: null,
      defaultMonthlyInterestPercent: null,
    });
  });

  it("Não informada limpa: forma e condição viajam null", async () => {
    const user = userEvent.setup();
    renderEdicao(cliente(PARCELADO));

    await user.selectOptions(forma(), "Não informada");
    await user.selectOptions(condicao(), "Não informada");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaEdicao()).toMatchObject({
      defaultPaymentInstrument: null,
      defaultPaymentMethod: null,
      defaultInstallmentCount: null,
    });
  });

  it("apagar as parcelas de um padrão parcelado é recusado na tela", async () => {
    const user = userEvent.setup();
    renderEdicao(cliente(PARCELADO));

    await user.clear(campo("Parcelas"));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText(PARCELADO_SEM_PARCELAS_MESSAGE)).toBeInTheDocument();
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it("recusa da API no campo aparece ao lado dele", async () => {
    const { ApiValidationError } = await import("../../lib/api-errors");
    vi.mocked(updateCustomer).mockRejectedValue(
      new ApiValidationError([{ path: "defaultInstallmentCount", message: "No máximo 120 parcelas" }]),
    );
    const user = userEvent.setup();
    renderEdicao(cliente(PARCELADO));

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("No máximo 120 parcelas")).toBeInTheDocument();
    expect(campo("Parcelas")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Pagamento padrão — consulta", () => {
  it.each(["VIEWER", "PRODUCTION"])("%s lê forma e condição do padrão, sem campo", (perfil) => {
    sessao.role = perfil;
    // Quem abre o Cliente decide a consulta pelo perfil (usePodeEditarCliente).
    renderEdicao(cliente(PARCELADO), true);

    const secao = screen.getByRole("heading", { name: "Pagamento padrão" }).closest("section")!;
    expect(within(secao).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(secao).queryAllByRole("textbox")).toHaveLength(0);
    const lido = (rotulo: string) =>
      [...secao.querySelectorAll("dt")].find((dt) => dt.textContent === rotulo)?.nextElementSibling
        ?.textContent;
    expect(lido("Forma de pagamento padrão")).toBe("Boleto");
    expect(lido("Condição de pagamento padrão")).toBe(
      "Parcelado — entrada de 30% e 3× a cada 45 dias, juros de 1,5% ao mês",
    );
  });

  it("cliente sem padrão, em consulta: Não informada nas duas", () => {
    sessao.role = "VIEWER";
    renderEdicao(cliente(), true);

    const secao = screen.getByRole("heading", { name: "Pagamento padrão" }).closest("section")!;
    expect(within(secao).getAllByText("Não informada")).toHaveLength(2);
  });
});
