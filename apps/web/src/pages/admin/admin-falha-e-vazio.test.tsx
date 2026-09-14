import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Usuários e Documentos controlados: falha e vazio se excluem
 * (LISTS-ERROR-FALSE-EMPTY-ADMIN-01). A condição do vazio não olhava o erro, e
 * a carga que falhou mostrava "Nenhum … cadastrado" junto do alerta.
 */

vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../../lib/auth-api", () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  listControlledDocuments: vi.fn(),
  createControlledDocumentRevision: vi.fn(),
  activateControlledDocumentRevision: vi.fn(),
}));

import { useAuth } from "../../app/AuthProvider";
import { listControlledDocuments, listUsers } from "../../lib/auth-api";
import { ControlledDocumentsPage } from "./ControlledDocumentsPage";
import { UsersPage } from "./UsersPage";

function montar(tela: React.ReactNode) {
  return render(<MemoryRouter>{tela}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", code: "USR-000001", name: "Admin", email: "admin@veridi.local", role: "ADMIN" },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
});

describe("Usuários", () => {
  it("falha: o alerta, sem o vazio", async () => {
    vi.mocked(listUsers).mockRejectedValue(new Error("Serviço indisponível."));
    montar(<UsersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço indisponível.");
    expect(screen.queryByText("Nenhum usuário cadastrado.")).toBeNull();
  });

  it("vazio real: a frase, sem alerta", async () => {
    vi.mocked(listUsers).mockResolvedValue({ users: [] } as never);
    montar(<UsersPage />);

    expect(await screen.findByText("Nenhum usuário cadastrado.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Documentos controlados", () => {
  it("falha: o alerta, sem o vazio", async () => {
    vi.mocked(listControlledDocuments).mockRejectedValue(new Error("Serviço indisponível."));
    montar(<ControlledDocumentsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço indisponível.");
    expect(screen.queryByText("Nenhuma revisão cadastrada.")).toBeNull();
  });

  it("vazio real: a frase, sem alerta", async () => {
    vi.mocked(listControlledDocuments).mockResolvedValue({ revisions: [] } as never);
    montar(<ControlledDocumentsPage />);

    expect(await screen.findByText("Nenhuma revisão cadastrada.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
