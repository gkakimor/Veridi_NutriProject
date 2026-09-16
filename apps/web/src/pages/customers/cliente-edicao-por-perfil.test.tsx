import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * Quem cria e edita o cadastro do Cliente, na tela — CUSTOMER-EDIT-PERMISSIONS-01.
 *
 * Comercial e Administrador: a experiência de sempre — "+ Novo cliente",
 * "Editar" e "Salvar alterações". Produção, Qualidade, Compras e Consulta
 * abrem o MESMO modal em consulta: tudo o que o cadastro mostra, nenhum campo
 * que aceite digitação, nenhum "Salvar" que terminaria em 403, e nenhum
 * "+ Novo cliente". O link de Cliente de outras telas continua abrindo o
 * registro — em consulta, nunca num erro.
 */

vi.mock("../../lib/customers-api", () => ({
  listCustomers: vi.fn(),
  changeCustomerStatus: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("../../lib/cep-api", async (original) => ({
  ...(await original<object>()),
  lookupCep: vi.fn(),
}));

/** O perfil da sessão, trocado por caso — a lista usa `useAuth`, o cadastro `useOptionalAuth`. */
const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({
    user: sessao.role ? { id: "u-1", name: "Sessão de teste", role: sessao.role } : null,
  });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createCustomer, listCustomers, updateCustomer } from "../../lib/customers-api";
import { lookupCep } from "../../lib/cep-api";
import { PARAM_ORIGEM, PARAM_RETOMAR, startContextualCreate } from "../../lib/contextual-create";
import { entityHref } from "../../components/EntityLink";
import { CustomersPage } from "./CustomersPage";
import { CustomerCreatePage } from "./CustomerCreatePage";

const PODEM_EDITAR = ["ADMIN", "COMMERCIAL"];
const SO_CONSULTAM = ["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"];

const CLIENTE: CustomerDTO = {
  id: "cli-1",
  code: "CLI-000001",
  legalName: "IGEIA Suplementos LTDA",
  tradeName: "IGEIA",
  cnpj: "11222333000181",
  email: "compras@igeia.com.br",
  phone: "11987654321",
  taxProfile: "LUCRO_PRESUMIDO",
  street: "Avenida Paulista",
  number: "1000",
  complement: null,
  district: "Bela Vista",
  zipCode: "01310100",
  city: "São Paulo",
  state: "SP",
  notes: "Entrega só pela manhã\nPortaria exige agendamento",
  businessLotSuffix: "A3",
  active: true,
  blocked: true,
  status: "BLOCKED",
  block: {
    reason: "Inadimplência desde março",
    blockedAt: "2026-09-01T12:00:00.000Z",
    blockedByName: "Ana",
  },
  createdAt: "2026-08-31T17:32:00.000Z",
  createdByName: "Ana",
  updatedAt: "2026-08-31T19:14:00.000Z",
  updatedByName: "Ana",
};

function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

const urlAtual = () => screen.getByTestId("url").textContent ?? "";

function abrir(entrada = "/cadastros/clientes") {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/clientes" element={<CustomersPage />} />
        <Route path="/cadastros/clientes/novo" element={<CustomerCreatePage />} />
        <Route path="/compras/recebimentos/material-do-cliente" element={<p>recebimento em edição</p>} />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
}

/** Tudo o que aceitaria digitação ou escolha dentro de um elemento. */
function camposEditaveis(elemento: HTMLElement) {
  return elemento.querySelectorAll("input, select, textarea, [contenteditable='true']");
}

/** O valor que a consulta mostra ao lado de um rótulo. */
function valorDe(elemento: HTMLElement, rotulo: string): string {
  const termo = within(elemento)
    .getAllByText(rotulo, { selector: "dt" })
    .at(0);
  if (!termo) throw new Error(`Sem rótulo ${rotulo}`);
  return termo.nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listCustomers).mockReset();
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(lookupCep).mockReset();
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [CLIENTE],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(updateCustomer).mockResolvedValue(CLIENTE);
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — Comercial e Administrador editam", () => {
  it.each(PODEM_EDITAR)("%s: vê + Novo cliente, abre em edição e salva", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("CLI-000001");

    expect(screen.getByRole("link", { name: "+ Novo cliente" })).toHaveAttribute(
      "href",
      "/cadastros/clientes/novo",
    );
    expect(screen.queryByRole("button", { name: "Ver" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    const modal = await screen.findByRole("dialog");
    expect(modal).toHaveTextContent("Cadastros / Clientes / Editar");
    expect(within(modal).getByLabelText(/Razão Social \/ Nome/)).toHaveValue(CLIENTE.legalName);
    expect(camposEditaveis(modal).length).toBeGreaterThan(10);

    fireEvent.change(within(modal).getByLabelText("Notas internas"), {
      target: { value: "Nota revisada" },
    });
    fireEvent.click(within(modal).getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() =>
      expect(updateCustomer).toHaveBeenCalledWith(
        "cli-1",
        expect.objectContaining({ legalName: CLIENTE.legalName, notes: "Nota revisada" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each(PODEM_EDITAR)("%s: Novo cliente abre o formulário e cria", async (role) => {
    sessao.role = role;
    vi.mocked(createCustomer).mockResolvedValue({ ...CLIENTE, id: "cli-novo" });
    abrir("/cadastros/clientes/novo");

    const razaoSocial = await screen.findByLabelText(/Razão Social \/ Nome/);
    fireEvent.change(razaoSocial, { target: { value: "Nutrição Viva Ltda" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() =>
      expect(createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ legalName: "Nutrição Viva Ltda" }),
      ),
    );
    await waitFor(() => expect(urlAtual()).toBe("/cadastros/clientes?ids=cli-novo"));
  });
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — os demais perfis consultam", () => {
  it.each(SO_CONSULTAM)(
    "%s: sem Novo cliente; o Cliente abre em consulta, sem campo editável e sem Salvar",
    async (role) => {
      sessao.role = role;
      abrir();
      await screen.findByText("CLI-000001");

      expect(screen.queryByRole("link", { name: /Novo cliente/ }), role).toBeNull();
      expect(screen.queryByRole("button", { name: "Editar" }), role).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Ver" }));

      const modal = await screen.findByRole("dialog");
      expect(modal, role).toHaveTextContent("Cadastros / Clientes / Consulta");
      expect(modal, role).toHaveTextContent(
        "Consulta. Só os perfis Comercial e Administrador alteram o cadastro do cliente.",
      );
      // Nenhuma caixa que aceite digitação, e nada para gravar.
      expect(camposEditaveis(modal), role).toHaveLength(0);
      expect(within(modal).queryByRole("button", { name: /Salvar/ }), role).toBeNull();
      expect(within(modal).queryByRole("button", { name: /Criar/ }), role).toBeNull();

      // O que o cadastro mostra, por inteiro e formatado.
      expect(within(modal).getByRole("heading", { name: CLIENTE.legalName }), role).toBeInTheDocument();
      expect(valorDe(modal, "Nome Fantasia"), role).toBe("IGEIA");
      expect(valorDe(modal, "CNPJ"), role).toBe("11.222.333/0001-81");
      expect(valorDe(modal, "Perfil tributário"), role).toBe("Lucro Presumido");
      expect(valorDe(modal, "Email"), role).toBe("compras@igeia.com.br");
      expect(valorDe(modal, "Telefone"), role).toBe("(11) 98765-4321");
      expect(valorDe(modal, "CEP"), role).toBe("01310-100");
      expect(valorDe(modal, "Logradouro"), role).toBe("Avenida Paulista");
      expect(valorDe(modal, "Complemento"), role).toBe("—");
      expect(valorDe(modal, "UF"), role).toBe("SP");
      expect(valorDe(modal, "Notas internas"), role).toBe(
        "Entrega só pela manhã\nPortaria exige agendamento",
      );
      // Situação, motivo e autoria continuam à vista.
      const situacao = within(modal)
        .getByRole("heading", { name: "Situação cadastral" })
        .closest("section") as HTMLElement;
      expect(within(situacao).getByText("Bloqueado"), role).toBeInTheDocument();
      expect(situacao, role).toHaveTextContent("Motivo do bloqueio: Inadimplência desde março");
      expect(within(modal).getByRole("heading", { name: "Informações do cadastro" }), role).toBeInTheDocument();
      expect(within(modal).getByRole("link", { name: /Visão do Cliente/ }), role).toHaveAttribute(
        "href",
        "/consultas/clientes/cli-1/resumo",
      );

      // Fechar sai sem perguntar nada — não houve o que alterar.
      fireEvent.click(within(modal).getAllByRole("button", { name: /Fechar/ }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole("dialog"), role).toBeNull());
      expect(updateCustomer, role).not.toHaveBeenCalled();
      expect(createCustomer, role).not.toHaveBeenCalled();
      expect(lookupCep, role).not.toHaveBeenCalled();
    },
  );

  it.each(SO_CONSULTAM)("%s: clicar na linha também abre em consulta", async (role) => {
    sessao.role = role;
    abrir();
    fireEvent.click(await screen.findByText("IGEIA Suplementos LTDA"));

    const modal = await screen.findByRole("dialog");
    expect(camposEditaveis(modal), role).toHaveLength(0);
    expect(within(modal).queryByRole("button", { name: "Salvar alterações" }), role).toBeNull();
  });

  it.each(SO_CONSULTAM)(
    "%s: o endereço de Novo cliente não abre formulário — diz a quem pedir e volta",
    async (role) => {
      sessao.role = role;
      abrir("/cadastros/clientes/novo");

      expect(await screen.findByRole("alert"), role).toHaveTextContent(
        "Seu perfil não permite cadastrar clientes. Solicite ao Comercial ou Administrador o cadastro do cliente.",
      );
      expect(document.querySelectorAll("input, select, textarea"), role).toHaveLength(0);
      expect(screen.queryByRole("button", { name: /Criar cliente/ }), role).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "← Voltar para Clientes" }));
      await screen.findByText("CLI-000001");
      expect(urlAtual(), role).toBe("/cadastros/clientes");
      expect(createCustomer, role).not.toHaveBeenCalled();
    },
  );
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — link de Cliente vindo de outra tela", () => {
  it.each(SO_CONSULTAM)("%s: o EntityLink abre o Cliente em consulta, sem erro", async (role) => {
    sessao.role = role;
    abrir(entityHref("customer", "cli-1"));

    const modal = await screen.findByRole("dialog");
    expect(modal, role).toHaveTextContent("Cadastros / Clientes / Consulta");
    expect(within(modal).getByRole("heading", { name: CLIENTE.legalName }), role).toBeInTheDocument();
    expect(camposEditaveis(modal), role).toHaveLength(0);
    expect(screen.queryByRole("alert"), role).toBeNull();
  });

  it.each(PODEM_EDITAR)("%s: o mesmo link abre o Cliente para edição", async (role) => {
    sessao.role = role;
    abrir(entityHref("customer", "cli-1"));

    const modal = await screen.findByRole("dialog");
    expect(modal, role).toHaveTextContent("Cadastros / Clientes / Editar");
    expect(within(modal).getByRole("button", { name: "Salvar alterações" }), role).toBeInTheDocument();
  });
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — sem cliente cadastrado", () => {
  async function listaVazia(role: string) {
    sessao.role = role;
    vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 });
    abrir();
    await waitFor(() => expect(listCustomers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filtrar por situação cadastral"), {
      target: { value: "ALL" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por situação comercial"), {
      target: { value: "ALL" },
    });
    return screen.findByText(/Nenhum cliente cadastrado ainda/);
  }

  it("quem não cadastra lê a quem pedir, e não um convite a começar", async () => {
    const vazio = await listaVazia("VIEWER");
    expect(vazio).toHaveTextContent(
      "Nenhum cliente cadastrado ainda. Solicite ao Comercial ou Administrador o cadastro do cliente.",
    );
  });

  it("quem cadastra continua convidado a começar pelo cliente", async () => {
    const vazio = await listaVazia("COMMERCIAL");
    expect(vazio).toHaveTextContent("comece por ele");
  });
});

describe("CUSTOMER-EDIT-PERMISSIONS-01 — volta da recusa para o documento de origem", () => {
  it("quem chega pelo cadastro contextual volta para a origem, não para a lista", async () => {
    const user = userEvent.setup();
    sessao.role = "PURCHASING";
    const token = startContextualCreate({
      originRoute: "/compras/recebimentos/material-do-cliente",
      fieldKey: "customerId",
      entityType: "customer",
      draft: { customerId: "" },
    })!;
    abrir(`/cadastros/clientes/novo?${PARAM_ORIGEM}=${encodeURIComponent(token)}`);

    await user.click(await screen.findByRole("button", { name: "← Voltar para Recebimento" }));
    expect(await screen.findByText("recebimento em edição")).toBeInTheDocument();
    expect(urlAtual()).toBe(
      `/compras/recebimentos/material-do-cliente?${PARAM_RETOMAR}=${encodeURIComponent(token)}`,
    );
  });
});
