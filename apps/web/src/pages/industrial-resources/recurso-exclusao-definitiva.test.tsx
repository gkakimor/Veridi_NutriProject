import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IndustrialResourceDetailDTO, MasterDataDeletionCheckDTO } from "@veridi/shared";

/**
 * "Excluir definitivamente" no detalhe do Recurso industrial —
 * MASTER-DATA-HARD-DELETE-02.
 *
 * Só o Administrador vê o botão. Liberado pela prévia, exclui e volta à lista;
 * bloqueado (tarifa, roteiro, custo, cópia na OP), mostra o porquê e a saída é
 * o "Inativar este recurso?" de sempre.
 */

vi.mock("../../lib/industrial-resources-api", () => ({
  getIndustrialResource: vi.fn(),
  updateIndustrialResource: vi.fn(),
  createIndustrialResourceRate: vi.fn(),
}));
vi.mock("../../lib/master-data-deletion-api", async (original) => ({
  ...(await original<object>()),
  consultarExclusaoDefinitiva: vi.fn(),
  excluirDefinitivamente: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { getIndustrialResource } from "../../lib/industrial-resources-api";
import { consultarExclusaoDefinitiva, excluirDefinitivamente } from "../../lib/master-data-deletion-api";
import { useAuth } from "../../app/AuthProvider";
import { IndustrialResourceDetailPage } from "./IndustrialResourceDetailPage";

const RECURSO = {
  id: "res-1",
  code: "REC-000001",
  name: "Operador criado por engano",
  type: "LABOR",
  description: null,
  defaultUsageUom: "HOUR",
  powerKw: null,
  capacityQuantity: null,
  notes: null,
  active: true,
  currentRate: null,
  rateCount: 0,
  createdAt: "2026-09-19T10:00:00.000Z",
  createdByName: "Administrador",
  updatedAt: "2026-09-19T10:00:00.000Z",
  updatedByName: "Administrador",
  rates: [],
} as unknown as IndustrialResourceDetailDTO;

function previa(extra: Partial<MasterDataDeletionCheckDTO> = {}): MasterDataDeletionCheckDTO {
  return {
    entityType: "INDUSTRIAL_RESOURCE",
    entityId: "res-1",
    entityCode: "REC-000001",
    entityName: "Operador criado por engano",
    canDelete: true,
    references: [],
    removedTogether: [],
    alternative: "INACTIVATE",
    alternativeAvailable: true,
    ...extra,
  };
}

function abrir() {
  render(
    <MemoryRouter initialEntries={["/gestao/recursos-industriais/res-1"]}>
      <Routes>
        <Route path="/gestao/recursos-industriais/:id" element={<IndustrialResourceDetailPage />} />
        <Route path="/gestao/recursos-industriais" element={<p>Lista de recursos</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function comPerfil(role: string) {
  vi.mocked(useAuth).mockReturnValue({ user: { id: "u-1", name: "Sessão de teste", role } } as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  vi.mocked(getIndustrialResource).mockReset();
  vi.mocked(consultarExclusaoDefinitiva).mockReset();
  vi.mocked(excluirDefinitivamente).mockReset();
  vi.mocked(getIndustrialResource).mockResolvedValue(RECURSO);
  comPerfil("ADMIN");
});

describe("quem vê", () => {
  it("Administrador: Excluir definitivamente ao lado de Inativar recurso", async () => {
    abrir();
    expect(await screen.findByRole("button", { name: "Excluir definitivamente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inativar recurso" })).toBeInTheDocument();
  });

  it.each(["PRODUCTION", "COMMERCIAL", "VIEWER"])("%s consulta o recurso, sem excluir", async (role) => {
    comPerfil(role);
    abrir();
    expect(await screen.findByText("REC-000001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  });
});

describe("Administrador", () => {
  it("liberado pela prévia: motivo, exclusão e volta à lista", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(previa());
    vi.mocked(excluirDefinitivamente).mockResolvedValue({
      historyId: "h-1",
      entityType: "INDUSTRIAL_RESOURCE",
      entityId: "res-1",
      entityCode: "REC-000001",
      entityName: "Operador criado por engano",
      deletedAt: "2026-09-19T12:00:00.000Z",
    });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("Excluir definitivamente o recurso industrial?")).toBeInTheDocument();
    fireEvent.change(await within(dialogo).findByLabelText("Motivo da exclusão *"), {
      target: { value: "Recurso cadastrado duas vezes" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));

    expect(await screen.findByText("Lista de recursos")).toBeInTheDocument();
    expect(excluirDefinitivamente).toHaveBeenCalledWith("INDUSTRIAL_RESOURCE", "res-1", "Recurso cadastrado duas vezes");
  });

  it("bloqueado (tarifa): mostra o porquê, sem excluir, e a saída abre o Inativar de sempre", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(
      previa({
        canDelete: false,
        references: [
          {
            source: "Tarifas",
            count: 2,
            reason: "O recurso tem tarifa registrada — tarifa é histórico e explica o custo das estruturas.",
          },
        ],
      }),
    );
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Tarifas")).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Inativar" }));

    expect(await screen.findByText("Inativar este recurso?")).toBeInTheDocument();
    expect(excluirDefinitivamente).not.toHaveBeenCalled();
  });
});
