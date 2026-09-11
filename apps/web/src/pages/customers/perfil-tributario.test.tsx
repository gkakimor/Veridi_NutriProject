import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { CUSTOMER_TAX_PROFILES } from "@veridi/shared";

/**
 * Perfil tributário no cadastro do Cliente — CUSTOMER-TAX-PROFILE-01, §83.
 *
 * O campo é um `<select>` nativo na Identificação, logo depois do CNPJ. O que
 * estes casos protegem é o que a tela MANDA: cadastro novo sem mexer não envia
 * o campo (o servidor aplica "Não informado"), edição só envia o perfil quando
 * ele muda, e retirar uma classificação é escolher "Não informado" — nunca
 * `null`. A regra do servidor está em `customer-tax-profile.test.ts`.
 */

vi.mock("../../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("../../lib/cep-api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/cep-api")>(
    "../../lib/cep-api",
  );
  return { ...actual, lookupCep: vi.fn() };
});

import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { CustomerFormModal } from "./CustomerFormModal";
import { CustomerCreatePage } from "./CustomerCreatePage";

const ROTULOS = [
  "Não informado",
  "MEI",
  "Simples Nacional",
  "Lucro Presumido",
  "Lucro Real",
  "Outro",
];

const DICA = "Classificação informada pela empresa. Não calcula impostos automaticamente.";

function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "IGEIA Suplementos LTDA",
    tradeName: "IGEIA",
    cnpj: "11222333000181",
    email: "contato@igeia.com.br",
    phone: "11999998888",
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
    active: true,
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: "João Silva",
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: "Maria Souza",
    ...overrides,
  };
}

function renderNovo() {
  return render(
    <MemoryRouter>
      <CustomerFormModal mode="create" customer={null} onClose={() => {}} onSaved={() => {}} />
    </MemoryRouter>,
  );
}

function renderEdicao(customer: CustomerDTO) {
  return render(
    <MemoryRouter>
      <CustomerFormModal mode="edit" customer={customer} onClose={() => {}} onSaved={() => {}} />
    </MemoryRouter>,
  );
}

function renderPagina() {
  return render(
    <MemoryRouter initialEntries={["/cadastros/clientes/novo"]}>
      <Routes>
        <Route path="/cadastros/clientes/novo" element={<CustomerCreatePage />} />
        <Route path="/cadastros/clientes" element={<p>lista de clientes</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const seletor = () => screen.getByLabelText("Perfil tributário") as HTMLSelectElement;
const rotuloMarcado = () => seletor().selectedOptions[0]?.textContent;

/** O que de fato viajou na última gravação. */
function enviadoNaCriacao(): Record<string, unknown> {
  const chamadas = vi.mocked(createCustomer).mock.calls;
  return chamadas[chamadas.length - 1]?.[0] as unknown as Record<string, unknown>;
}
function enviadoNaEdicao(): Record<string, unknown> {
  const chamadas = vi.mocked(updateCustomer).mock.calls;
  return chamadas[chamadas.length - 1]?.[1] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
});

describe("Perfil tributário — o campo", () => {
  it("é um <select> nativo, com rótulo associado e as seis opções em português, na ordem", () => {
    renderNovo();

    const select = seletor();
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((opcao) => opcao.textContent)).toEqual(ROTULOS);
    expect([...select.options].map((opcao) => opcao.value)).toEqual([...CUSTOMER_TAX_PROFILES]);
  });

  it("vem logo depois do CNPJ: o Tab sai do CNPJ e chega nele", async () => {
    const user = userEvent.setup();
    renderNovo();

    screen.getByLabelText("CNPJ", { exact: false }).focus();
    await user.tab();

    expect(document.activeElement).toBe(seletor());
  });

  it("a dica diz o que o campo não faz, e o leitor de tela a lê junto do campo", () => {
    renderNovo();

    const dica = screen.getByText(DICA);
    expect(seletor().getAttribute("aria-describedby")).toBe(dica.id);
  });
});

describe("Perfil tributário — cadastro novo", () => {
  it("nasce em Não informado", () => {
    renderNovo();

    expect(seletor().value).toBe("NOT_INFORMED");
    expect(rotuloMarcado()).toBe("Não informado");
  });

  it("salvar sem mexer não envia o campo — o servidor aplica Não informado", async () => {
    const user = userEvent.setup();
    renderNovo();

    await user.type(screen.getByLabelText("Razão Social", { exact: false }), "Cliente Sem Perfil");
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaCriacao()).not.toHaveProperty("taxProfile");
  });

  it("escolher um perfil envia o código escolhido", async () => {
    const user = userEvent.setup();
    renderNovo();

    await user.type(screen.getByLabelText("Razão Social", { exact: false }), "Cliente MEI");
    await user.selectOptions(seletor(), "MEI");
    expect(rotuloMarcado()).toBe("MEI");
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaCriacao()).toMatchObject({ taxProfile: "MEI" });
  });

  it("a página oficial de cadastro tem o mesmo campo, no mesmo estado inicial", async () => {
    const user = userEvent.setup();
    renderPagina();

    expect(seletor().value).toBe("NOT_INFORMED");
    await user.type(screen.getByLabelText("Razão Social", { exact: false }), "Cliente Pela Página");
    await user.selectOptions(seletor(), "Simples Nacional");
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaCriacao()).toMatchObject({ taxProfile: "SIMPLES_NACIONAL" });
    expect(await screen.findByText("lista de clientes")).toBeTruthy();
  });
});

describe("Perfil tributário — edição", () => {
  it("carrega o perfil gravado", () => {
    renderEdicao(cliente({ taxProfile: "LUCRO_REAL" }));

    expect(seletor().value).toBe("LUCRO_REAL");
    expect(rotuloMarcado()).toBe("Lucro Real");
  });

  it("trocar o perfil envia a mudança", async () => {
    const user = userEvent.setup();
    renderEdicao(cliente({ taxProfile: "SIMPLES_NACIONAL" }));

    await user.selectOptions(seletor(), "Lucro Presumido");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateCustomer).mock.calls[0]?.[0]).toBe("cli-1");
    expect(enviadoNaEdicao()).toMatchObject({ taxProfile: "LUCRO_PRESUMIDO" });
  });

  it("salvar sem mexer no perfil não o envia — o gravado fica como está", async () => {
    const user = userEvent.setup();
    renderEdicao(cliente({ taxProfile: "SIMPLES_NACIONAL" }));

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaEdicao()).not.toHaveProperty("taxProfile");
  });

  it("retirar a classificação é escolher Não informado, e isso viaja como valor, nunca null", async () => {
    const user = userEvent.setup();
    renderEdicao(cliente({ taxProfile: "LUCRO_REAL" }));

    await user.selectOptions(seletor(), "Não informado");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(enviadoNaEdicao()).toMatchObject({ taxProfile: "NOT_INFORMED" });
  });
});
