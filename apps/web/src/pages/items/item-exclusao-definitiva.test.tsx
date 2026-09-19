import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ItemDTO, MasterDataDeletionCheckDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";

/**
 * "Excluir definitivamente" na lista de Itens — MASTER-DATA-HARD-DELETE-02.
 *
 * Só o Administrador recebe a ação, no menu da linha, e ela sempre pergunta à
 * prévia antes. Liberada, pede o motivo, exclui e recarrega a lista;
 * bloqueada (estoque, PA, fornecedor…), mostra o porquê e a saída é o Inativar
 * de sempre, com a mesma confirmação.
 */

vi.mock("../../lib/items-api", async (original) => ({
  ...(await original<object>()),
  listItems: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
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

import { listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { consultarExclusaoDefinitiva, excluirDefinitivamente } from "../../lib/master-data-deletion-api";
import { ItemsPage } from "./ItemsPage";

const UNIDADE: UnitOfMeasureDTO = { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" };

function item(extra: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000001",
    type: "RAW_MATERIAL",
    name: "ITEM CRIADO POR ENGANO",
    unitCode: "kg",
    unit: UNIDADE,
    ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: null,
    consumedInProduction: false,
    externalBarcode: null,
    externalCode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    ...extra,
  };
}

function previa(extra: Partial<MasterDataDeletionCheckDTO> = {}): MasterDataDeletionCheckDTO {
  return {
    entityType: "ITEM",
    entityId: "item-1",
    entityCode: "MP-000001",
    entityName: "ITEM CRIADO POR ENGANO",
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
    <MemoryRouter initialEntries={["/cadastros/itens"]}>
      <ItemsPage />
    </MemoryRouter>,
  );
}

async function abrirMenu() {
  await screen.findByText("MP-000001");
  fireEvent.click(screen.getByLabelText("Mais ações de MP-000001"));
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listItems).mockReset();
  vi.mocked(listUnits).mockReset();
  vi.mocked(consultarExclusaoDefinitiva).mockReset();
  vi.mocked(excluirDefinitivamente).mockReset();
  vi.mocked(listUnits).mockResolvedValue([UNIDADE]);
  vi.mocked(listItems).mockResolvedValue({ items: [item()], page: 1, pageSize: 20, total: 1 });
});

describe("quem vê", () => {
  it("Administrador: o menu da linha tem Excluir definitivamente, além de Inativar", async () => {
    abrir();
    await abrirMenu();
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Excluir definitivamente" })).toBeInTheDocument();
  });

  it.each(["PURCHASING", "QUALITY"])("%s inativa o Item, mas não exclui definitivamente", async (role) => {
    sessao.role = role;
    abrir();
    await abrirMenu();
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Excluir definitivamente" })).toBeNull();
  });

  it.each(["PRODUCTION", "COMMERCIAL", "VIEWER"])("%s não recebe Excluir definitivamente em lugar nenhum da linha", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("MP-000001");
    const menu = screen.queryByLabelText("Mais ações de MP-000001");
    if (menu) fireEvent.click(menu);
    expect(screen.queryByText("Excluir definitivamente")).toBeNull();
  });
});

describe("Administrador", () => {
  it("liberado pela prévia: motivo, exclusão, aviso e lista recarregada", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(previa());
    vi.mocked(excluirDefinitivamente).mockResolvedValue({
      historyId: "h-1",
      entityType: "ITEM",
      entityId: "item-1",
      entityCode: "MP-000001",
      entityName: "ITEM CRIADO POR ENGANO",
      deletedAt: "2026-09-19T12:00:00.000Z",
    });
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("Excluir definitivamente o item?")).toBeInTheDocument();
    expect(consultarExclusaoDefinitiva).toHaveBeenCalledWith("ITEM", "item-1");
    fireEvent.change(await within(dialogo).findByLabelText("Motivo da exclusão *"), {
      target: { value: "Cadastrado com o tipo errado" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));

    const aviso = await screen.findByText("MP-000001 — ITEM CRIADO POR ENGANO foi excluído definitivamente.");
    expect(aviso).toHaveAttribute("role", "status");
    expect(excluirDefinitivamente).toHaveBeenCalledWith("ITEM", "item-1", "Cadastrado com o tipo errado");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(vi.mocked(listItems).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("bloqueado (estoque): mostra o porquê, sem o botão de excluir, e a saída abre o Inativar de sempre", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(
      previa({
        canDelete: false,
        references: [
          { source: "Movimentos de estoque", count: 3, reason: "O item já teve movimento de estoque — o histórico do estoque é permanente." },
          { source: "Lotes", count: 1, reason: "Há lote deste item — rastreabilidade." },
        ],
      }),
    );
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Movimentos de estoque")).toBeInTheDocument();
    expect(within(dialogo).getByText("Lotes")).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Inativar" }));

    expect(await screen.findByText("Inativar item?")).toBeInTheDocument();
    expect(excluirDefinitivamente).not.toHaveBeenCalled();
  });

  it("PA pela tela de Itens: a prévia recusa e diz que ele só sai com o produto", async () => {
    vi.mocked(listItems).mockResolvedValue({
      items: [item({ type: "FINISHED_PRODUCT", ...ITEM_TYPE_DEFAULTS.FINISHED_PRODUCT })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(
      previa({
        canDelete: false,
        references: [
          {
            source: "Item de produto acabado",
            count: 1,
            reason: "Item de produto acabado (PA) nasce com o produto e só sai junto com ele, pela exclusão do produto — nunca sozinho.",
          },
        ],
      }),
    );
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText(/só sai junto com ele, pela exclusão do produto/)).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  });
});
