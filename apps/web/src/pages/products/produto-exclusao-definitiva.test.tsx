import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MasterDataDeletionCheckDTO, ProductDTO } from "@veridi/shared";

/**
 * "Excluir definitivamente" na lista de Produtos — MASTER-DATA-HARD-DELETE-02.
 *
 * Só o Administrador recebe a ação. Liberada, a prévia lista o Item de produto
 * acabado (PA) em "sai junto" e a tela explica que ele é excluído junto — para
 * não ficar item órfão. Bloqueada por uso do PA, o motivo vem com o código dele
 * e a saída é o Inativar de sempre.
 */

vi.mock("../../lib/products-api", async (original) => ({
  ...(await original<object>()),
  listProducts: vi.fn(),
  setProductActive: vi.fn(),
}));
vi.mock("../../lib/customers-api", async (original) => ({
  ...(await original<object>()),
  listCustomers: vi.fn(),
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

import { listProducts } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { consultarExclusaoDefinitiva, excluirDefinitivamente } from "../../lib/master-data-deletion-api";
import { ProductsPage } from "./ProductsPage";

function produto(extra: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "prod-1",
    code: "PROD-000001",
    name: "PRODUTO CRIADO POR ENGANO",
    customerId: "cli-1",
    lifecycle: "APPROVED",
    originProjectId: null,
    originProjectCode: null,
    customer: { id: "cli-1", code: "CLI-000001", legalName: "Vida Saudável Ltda", tradeName: "Vida" },
    finishedProductItemId: "pa-1",
    finishedProductItem: {
      id: "pa-1",
      code: "PA-000001",
      name: "PRODUTO CRIADO POR ENGANO",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
      requiresCoa: false,
    },
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    doseAmount: null,
    doseUomCode: null,
    dosesPerPackage: null,
    unitsPerShippingBox: null,
    targetAgeGroup: null,
    shelfLifeMonths: null,
    businessLotCode: null,
    minimumBatchQuantity: null,
    activeFormulationVersionId: null,
    activeFormulationVersionLabel: null,
    externalCode: null,
    notes: null,
    active: true,
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    ...extra,
  } as ProductDTO;
}

function previa(extra: Partial<MasterDataDeletionCheckDTO> = {}): MasterDataDeletionCheckDTO {
  return {
    entityType: "PRODUCT",
    entityId: "prod-1",
    entityCode: "PROD-000001",
    entityName: "PRODUTO CRIADO POR ENGANO",
    canDelete: true,
    references: [],
    removedTogether: [{ source: "Item de produto acabado PA-000001 — PRODUTO CRIADO POR ENGANO", count: 1 }],
    alternative: "INACTIVATE",
    alternativeAvailable: true,
    ...extra,
  };
}

function abrir() {
  render(
    <MemoryRouter initialEntries={["/cadastros/produtos"]}>
      <ProductsPage />
    </MemoryRouter>,
  );
}

async function abrirMenu() {
  await screen.findByText("PROD-000001");
  fireEvent.click(screen.getByLabelText("Mais ações de PROD-000001"));
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listProducts).mockReset();
  vi.mocked(listCustomers).mockReset();
  vi.mocked(consultarExclusaoDefinitiva).mockReset();
  vi.mocked(excluirDefinitivamente).mockReset();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 });
  vi.mocked(listProducts).mockResolvedValue({ products: [produto()], page: 1, pageSize: 20, total: 1 });
});

describe("quem vê", () => {
  it("Administrador: o menu da linha tem Excluir definitivamente, além de Inativar", async () => {
    abrir();
    await abrirMenu();
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Excluir definitivamente" })).toBeInTheDocument();
  });

  it("Comercial mantém o Produto, mas não exclui definitivamente", async () => {
    sessao.role = "COMMERCIAL";
    abrir();
    await abrirMenu();
    expect(screen.getByRole("menuitem", { name: "Inativar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Excluir definitivamente" })).toBeNull();
  });
});

describe("Administrador", () => {
  it("liberado: diz que o PA sai junto e por quê; motivo, exclusão, aviso e lista recarregada", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(previa());
    vi.mocked(excluirDefinitivamente).mockResolvedValue({
      historyId: "h-1",
      entityType: "PRODUCT",
      entityId: "prod-1",
      entityCode: "PROD-000001",
      entityName: "PRODUTO CRIADO POR ENGANO",
      deletedAt: "2026-09-19T12:00:00.000Z",
    });
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Item de produto acabado PA-000001 — PRODUTO CRIADO POR ENGANO")).toBeInTheDocument();
    expect(dialogo).toHaveTextContent("Sai junto:");
    expect(dialogo).toHaveTextContent(/criado junto com este produto e nunca foi usado/);
    expect(dialogo).toHaveTextContent(/para não ficar um item órfão no estoque/);

    fireEvent.change(within(dialogo).getByLabelText("Motivo da exclusão *"), {
      target: { value: "Produto cadastrado em duplicidade" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));

    const aviso = await screen.findByText("PROD-000001 — PRODUTO CRIADO POR ENGANO foi excluído definitivamente.");
    expect(aviso).toHaveAttribute("role", "status");
    expect(excluirDefinitivamente).toHaveBeenCalledWith("PRODUCT", "prod-1", "Produto cadastrado em duplicidade");
    await waitFor(() => expect(vi.mocked(listProducts).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("bloqueado pelo uso do PA: o motivo vem com o código dele, sem excluir — a saída abre o Inativar de sempre", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue(
      previa({
        canDelete: false,
        removedTogether: [],
        references: [
          { source: "Item de produto acabado PA-000001 — Lotes", count: 1, reason: "Há lote deste item — rastreabilidade." },
        ],
      }),
    );
    abrir();
    await abrirMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excluir definitivamente" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Item de produto acabado PA-000001 — Lotes")).toBeInTheDocument();
    expect(dialogo).not.toHaveTextContent(/item órfão/);
    expect(within(dialogo).queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Inativar" }));

    expect(await screen.findByText("Inativar produto?")).toBeInTheDocument();
    expect(excluirDefinitivamente).not.toHaveBeenCalled();
  });
});
