import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupplierDTO } from "@veridi/shared";

/**
 * "Excluir definitivamente" na lista de Fornecedores — MASTER-DATA-HARD-DELETE-01.
 *
 * Só o Administrador recebe a ação, no menu da linha. Liberada pela prévia,
 * pede o motivo, exclui e recarrega a lista; bloqueada, a saída é o Inativar
 * de sempre, com a mesma confirmação.
 */

vi.mock("../../lib/suppliers-api", async (original) => ({
  ...(await original<object>()),
  listSuppliers: vi.fn(),
  setSupplierActive: vi.fn(),
}));
vi.mock("../../lib/master-data-deletion-api", async (original) => ({
  ...(await original<object>()),
  consultarExclusaoDefinitiva: vi.fn(),
  excluirDefinitivamente: vi.fn(),
}));

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { listSuppliers } from "../../lib/suppliers-api";
import { consultarExclusaoDefinitiva, excluirDefinitivamente } from "../../lib/master-data-deletion-api";
import { SuppliersPage } from "./SuppliersPage";

function fornecedor(extra: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "for-1",
    code: "FOR-000001",
    legalName: "FORNECEDOR CRIADO POR ENGANO LTDA",
    tradeName: null,
    cnpj: null,
    email: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    district: null,
    zipCode: null,
    city: null,
    state: null,
    notes: null,
    active: true,
    createdAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
    ...extra,
  };
}

function abrir() {
  render(
    <MemoryRouter initialEntries={["/cadastros/fornecedores"]}>
      <SuppliersPage />
    </MemoryRouter>,
  );
}

async function abrirMenu() {
  await screen.findByText("FOR-000001");
  fireEvent.click(screen.getByLabelText("Mais ações de FOR-000001"));
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listSuppliers).mockReset();
  vi.mocked(consultarExclusaoDefinitiva).mockReset();
  vi.mocked(excluirDefinitivamente).mockReset();
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [fornecedor()], page: 1, pageSize: 20, total: 1 });
});

describe("quem vê", () => {
  it("Administrador: o menu da linha tem Excluir definitivamente, além de Inativar", async () => {
    abrir();
    await abrirMenu();
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Excluir definitivamente" })).toBeInTheDocument();
  });

  it("Compras mantém o Fornecedor, mas não exclui definitivamente", async () => {
    sessao.role = "PURCHASING";
    abrir();
    await abrirMenu();
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Excluir definitivamente" })).toBeNull();
  });
});

describe("Administrador", () => {
  it("liberado: motivo, exclusão, aviso e lista recarregada", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({
      entityType: "SUPPLIER",
      entityId: "for-1",
      entityCode: "FOR-000001",
      entityName: "FORNECEDOR CRIADO POR ENGANO LTDA",
      canDelete: true,
      references: [],
      removedTogether: [],
      alternative: "INACTIVATE",
      alternativeAvailable: true,
    });
    vi.mocked(excluirDefinitivamente).mockResolvedValue({
      historyId: "h-1",
      entityType: "SUPPLIER",
      entityId: "for-1",
      entityCode: "FOR-000001",
      entityName: "FORNECEDOR CRIADO POR ENGANO LTDA",
      deletedAt: "2026-09-18T12:00:00.000Z",
    });
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Esta ação remove definitivamente um cadastro criado por engano.")).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText("Motivo da exclusão *"), {
      target: { value: "Cadastrado em duplicidade" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));

    const aviso = await screen.findByText("FOR-000001 — FORNECEDOR CRIADO POR ENGANO LTDA foi excluído definitivamente.");
    expect(aviso).toHaveAttribute("role", "status");
    expect(excluirDefinitivamente).toHaveBeenCalledWith("SUPPLIER", "for-1", "Cadastrado em duplicidade");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(vi.mocked(listSuppliers).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("bloqueado: mostra o porquê e a saída abre o Inativar de sempre", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({
      entityType: "SUPPLIER",
      entityId: "for-1",
      entityCode: "FOR-000001",
      entityName: "FORNECEDOR CRIADO POR ENGANO LTDA",
      canDelete: false,
      references: [{ source: "Ordens de compra", count: 2, reason: "O fornecedor já foi usado em ordem de compra." }],
      removedTogether: [],
      alternative: "INACTIVATE",
      alternativeAvailable: true,
    });
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Ordens de compra")).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Inativar" }));

    expect(await screen.findByText("Inativar fornecedor?")).toBeInTheDocument();
    expect(excluirDefinitivamente).not.toHaveBeenCalled();
  });
});
