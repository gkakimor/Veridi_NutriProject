import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { SupplierDTO } from "@veridi/shared";

/**
 * Quem faz o quê no cadastro do Fornecedor, na tela — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Compras e Administrador: "+ Novo fornecedor", "Editar", "Inativar/Reativar".
 * Qualidade, Produção, Comercial e Consulta abrem o MESMO modal em consulta,
 * sem campo editável, sem consulta de CEP e sem "Salvar" que terminaria em 403.
 */

vi.mock("../../lib/suppliers-api", async (original) => ({
  ...(await original<object>()),
  listSuppliers: vi.fn(),
  setSupplierActive: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));
vi.mock("../../lib/cep-api", async (original) => ({
  ...(await original<object>()),
  lookupCep: vi.fn(),
}));
vi.mock("../../components/SupplierItemsSection", () => ({
  SupplierItemsSection: () => <p>Itens fornecidos (seção própria)</p>,
}));

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createSupplier, listSuppliers, updateSupplier } from "../../lib/suppliers-api";
import { lookupCep } from "../../lib/cep-api";
import { SuppliersPage } from "./SuppliersPage";
import { SupplierCreatePage } from "./SupplierCreatePage";

const EDITAM = ["PURCHASING", "ADMIN"];
const SO_CONSULTAM = ["QUALITY", "PRODUCTION", "COMMERCIAL", "VIEWER"];

function fornecedor(extra: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "for-1",
    code: "FOR-000001",
    legalName: "PURIFARMA DISTRIBUIDORA LTDA",
    tradeName: "PURIFARMA",
    cnpj: "11222333000181",
    email: "compras@purifarma.com.br",
    phone: "11987654321",
    street: "Avenida Paulista",
    number: "1000",
    complement: null,
    district: "Bela Vista",
    zipCode: "01310100",
    city: "São Paulo",
    state: "SP",
    notes: "Entrega às terças\nPortaria exige agendamento",
    active: true,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
    ...extra,
  };
}

function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname}</span>;
}

function abrir(entrada = "/cadastros/fornecedores") {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/fornecedores" element={<SuppliersPage />} />
        <Route path="/cadastros/fornecedores/novo" element={<SupplierCreatePage />} />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
}

function camposEditaveis(elemento: HTMLElement) {
  return elemento.querySelectorAll("input, select, textarea, [contenteditable='true']");
}

function valorDe(elemento: HTMLElement, rotulo: string): string {
  const termo = within(elemento).getAllByText(rotulo, { selector: "dt" }).at(0);
  if (!termo) throw new Error(`Sem rótulo ${rotulo}`);
  return termo.nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listSuppliers).mockReset();
  vi.mocked(updateSupplier).mockReset();
  vi.mocked(createSupplier).mockReset();
  vi.mocked(lookupCep).mockReset();
  vi.mocked(listSuppliers).mockResolvedValue({
    suppliers: [fornecedor(), fornecedor({ id: "for-2", code: "FOR-000002", legalName: "INATIVA LTDA", active: false })],
    page: 1,
    pageSize: 20,
    total: 2,
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Compras e Administrador mantêm o Fornecedor", () => {
  it.each(EDITAM)("%s: + Novo fornecedor, Editar e Inativar/Reativar", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("FOR-000001");

    expect(screen.getByRole("link", { name: "+ Novo fornecedor" })).toHaveAttribute(
      "href",
      "/cadastros/fornecedores/novo",
    );
    expect(screen.getAllByRole("button", { name: "Editar" }), role).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Mais ações de FOR-000001"));
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Mais ações de FOR-000001"));
    fireEvent.click(screen.getByLabelText("Mais ações de FOR-000002"));
    expect(screen.getByRole("menuitem", { name: "Reativar" })).toBeInTheDocument();
  });

  it.each(EDITAM)("%s: o modal abre em edição e salva", async (role) => {
    sessao.role = role;
    vi.mocked(updateSupplier).mockResolvedValue(fornecedor());
    abrir();
    await screen.findByText("FOR-000001");
    fireEvent.click(within(screen.getByText("FOR-000001").closest("tr")!).getByRole("button", { name: "Editar" }));

    const modal = await screen.findByRole("dialog");
    expect(modal).toHaveTextContent("Cadastros / Fornecedores / Editar");
    fireEvent.change(within(modal).getByLabelText("Notas internas"), { target: { value: "Nova nota" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(updateSupplier).toHaveBeenCalledWith("for-1", expect.objectContaining({ notes: "Nova nota" })),
    );
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — os demais perfis consultam o Fornecedor", () => {
  it.each(SO_CONSULTAM)(
    "%s: sem + Novo, sem Inativar/Reativar; o Fornecedor abre em consulta",
    async (role) => {
      sessao.role = role;
      abrir();
      await screen.findByText("FOR-000001");

      expect(screen.queryByRole("link", { name: /Novo fornecedor/ }), role).toBeNull();
      expect(screen.queryByRole("button", { name: "Editar" }), role).toBeNull();
      expect(screen.queryByLabelText("Mais ações de FOR-000001"), role).toBeNull();
      expect(screen.queryByLabelText("Mais ações de FOR-000002"), role).toBeNull();

      fireEvent.click(within(screen.getByText("FOR-000001").closest("tr")!).getByRole("button", { name: "Ver" }));
      const modal = await screen.findByRole("dialog");
      expect(modal, role).toHaveTextContent("Cadastros / Fornecedores / Consulta");
      expect(modal, role).toHaveTextContent(
        "Consulta. Só os perfis Compras e Administrador alteram o cadastro do fornecedor.",
      );
      expect(camposEditaveis(modal), role).toHaveLength(0);
      expect(within(modal).queryByRole("button", { name: /Salvar/ }), role).toBeNull();

      expect(valorDe(modal, "Nome Fantasia"), role).toBe("PURIFARMA");
      expect(valorDe(modal, "CNPJ"), role).toBe("11.222.333/0001-81");
      expect(valorDe(modal, "Telefone"), role).toBe("(11) 98765-4321");
      expect(valorDe(modal, "CEP"), role).toBe("01310-100");
      expect(valorDe(modal, "Complemento"), role).toBe("—");
      expect(valorDe(modal, "Notas internas"), role).toBe("Entrega às terças\nPortaria exige agendamento");
      // A seção de relações continua, com a regra dela.
      expect(within(modal).getByText("Itens fornecidos (seção própria)"), role).toBeInTheDocument();

      fireEvent.click(within(modal).getAllByRole("button", { name: /Fechar/ }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole("dialog"), role).toBeNull());
      expect(updateSupplier, role).not.toHaveBeenCalled();
      expect(lookupCep, role).not.toHaveBeenCalled();
    },
  );

  it.each(SO_CONSULTAM)("%s: o endereço de Novo fornecedor diz a quem pedir e volta", async (role) => {
    sessao.role = role;
    abrir("/cadastros/fornecedores/novo");

    expect(await screen.findByRole("alert"), role).toHaveTextContent(
      "Seu perfil não permite cadastrar fornecedores. Solicite a Compras ou Administrador o cadastro do fornecedor.",
    );
    expect(document.querySelectorAll("input, select, textarea"), role).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "← Voltar para Fornecedores" }));
    await screen.findByText("FOR-000001");
    expect(screen.getByTestId("url").textContent, role).toBe("/cadastros/fornecedores");
    expect(createSupplier, role).not.toHaveBeenCalled();
  });
});
