import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ControlledDocumentRevisionDTO, UserRole } from "@veridi/shared";

vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../../lib/auth-api", () => ({
  listControlledDocuments: vi.fn(),
  createControlledDocumentRevision: vi.fn(),
  activateControlledDocumentRevision: vi.fn(),
}));

import { useAuth } from "../../app/AuthProvider";
import { activateControlledDocumentRevision, listControlledDocuments } from "../../lib/auth-api";
import { ControlledDocumentsPage } from "./ControlledDocumentsPage";

/**
 * QUALITY-DOC-WRITE-01 — a tela oferece registrar e ativar revisão só a quem a
 * API deixa: Qualidade e ADMIN. Os demais perfis leem a lista, sem ação que
 * terminaria em 403.
 */

function revisao(overrides: Partial<ControlledDocumentRevisionDTO> = {}): ControlledDocumentRevisionDTO {
  return {
    id: "rev-3",
    type: "PRODUCTION_ORDER",
    documentCode: "R.PRO.002",
    title: "Ordem de Produção",
    revision: "03",
    revisionDate: null,
    preparedByUserId: null,
    preparedByName: "Ana Qualidade",
    approvedByUserId: null,
    approvedByName: null,
    active: true,
    createdAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function renderComo(role: UserRole) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", code: "USR-000001", name: "Pessoa", email: "pessoa@veridi.local", role },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
  return render(
    <MemoryRouter>
      <ControlledDocumentsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listControlledDocuments).mockResolvedValue({
    revisions: [revisao(), revisao({ id: "rev-2", revision: "02", active: false })],
  });
  vi.mocked(activateControlledDocumentRevision).mockResolvedValue(
    revisao({ id: "rev-2", revision: "02" }),
  );
});

describe("Documentos controlados — quem administra revisão", () => {
  it.each(["QUALITY", "ADMIN"] as const)(
    "%s vê Nova revisão e Ativar; ativar chama a API",
    async (role) => {
      const user = userEvent.setup();
      renderComo(role);

      await screen.findByText("02");
      expect(screen.getByRole("button", { name: "Nova revisão" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Ativar" }));
      await waitFor(() => expect(activateControlledDocumentRevision).toHaveBeenCalledWith("rev-2"));
    },
  );

  it.each(["COMMERCIAL", "PURCHASING", "PRODUCTION", "VIEWER"] as const)(
    "%s só consulta: a lista aparece, as ações não",
    async (role) => {
      renderComo(role);

      await screen.findByText("02");
      expect(screen.queryByRole("button", { name: "Nova revisão" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Ativar" })).toBeNull();
      expect(
        screen.getByText(/registrar e ativar revisão é da Qualidade e do Administrador/),
      ).toBeInTheDocument();
    },
  );

  it("o formulário de revisão diz que a tela mora em Qualidade", async () => {
    const user = userEvent.setup();
    renderComo("QUALITY");

    await user.click(await screen.findByRole("button", { name: "Nova revisão" }));
    // A trilha junta texto e <b>: confere o texto inteiro do elemento.
    expect(screen.getByRole("dialog").querySelector(".modal-fullscreen__crumb")).toHaveTextContent(
      "Qualidade / Documentos controlados",
    );
  });
});
