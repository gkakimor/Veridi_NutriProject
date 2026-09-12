import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { SupplierItemDetailDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-02 no detalhe de Item × Fornecedor.
 *
 * Esta tela tem TRÊS salvamentos independentes: "Salvar dados comerciais"
 * grava código e observações; homologar/bloquear gravam a nota da qualidade;
 * "Registrar preço" cria a oferta. Gravar um não limpa os outros.
 *
 * A pendência, então, é a soma do que continua por gravar — e cada parcela
 * some sozinha quando o seu botão grava. Uma guarda que zerasse tudo no
 * primeiro salvamento deixaria a oferta digitada sair em silêncio, que é
 * exatamente o defeito que ela existe para impedir.
 */

vi.mock("../../lib/supplier-items-api", () => ({
  getSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  createSupplierItemOffer: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  listSupplierItems: vi.fn(),
  createSupplierItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  ]),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { getSupplierItem, updateSupplierItem } from "../../lib/supplier-items-api";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function relacao(overrides: Partial<SupplierItemDetailDTO> = {}): SupplierItemDetailDTO {
  return {
    id: "si-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    itemUnitCode: "kg",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierItemCode: "COD-ORIGINAL",
    commercialNotes: null,
    qualificationStatus: "PENDING",
    qualificationNote: null,
    qualifiedAt: null,
    qualifiedByName: null,
    preferred: false,
    active: true,
    itemExternalCode: null,
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    supplierActive: true,
    offers: [],
    offerCount: 0,
    qualificationHistory: [],
    currentOffer: null,
    latestLegacyOffer: null,
    costSourceAmbiguous: false,
    createdByName: "Admin",
    updatedByName: "Admin",
    costSourceToday: {
      source: "SUPPLIER_OFFER_SINGLE_APPROVED",
      unitCost: "12.50000000",
      unitCode: "kg",
      details: "Oferta válida do Fornecedor Teste.",
      referenceDate: "2026-09-09T12:00:00.000Z",
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as unknown as SupplierItemDetailDTO;
}

let fechou = false;

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/estoque">Estoque</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

async function abrir(dto = relacao()) {
  vi.mocked(getSupplierItem).mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/compras/item-fornecedor"
          element={
            <SupplierItemDetailModal
              supplierItemId="si-1"
              onClose={() => {
                fechou = true;
              }}
            />
          }
        />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: ["/compras/item-fornecedor"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText(/Vitamina C · Fornecedor Teste/);
  return router;
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const codigo = () => document.getElementById("detail-supplier-item-code") as HTMLInputElement;
const precoDaOferta = () => document.getElementById("offer-price") as HTMLInputElement;
const notaDaQualidade = () => document.getElementById("qualification-note") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  fechou = false;
});

describe("detalhe de Item × Fornecedor — pendência por bloco", () => {
  it("carregado e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("dado comercial alterado pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(codigo(), { target: { value: "COD-NOVO" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta relação/i)).toBeInTheDocument();
  });

  it("nota da qualidade escrita pergunta — ela some quando a decisão grava", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(notaDaQualidade(), { target: { value: "Laudo conferido" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("oferta digitada pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(precoDaOferta(), { target: { value: "12,50" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("salvar os dados comerciais NÃO limpa a oferta ainda digitada", async () => {
    const user = userEvent.setup();
    vi.mocked(updateSupplierItem).mockResolvedValue(
      relacao({ supplierItemCode: "COD-NOVO" }),
    );
    await abrir();

    fireEvent.change(codigo(), { target: { value: "COD-NOVO" } });
    fireEvent.change(precoDaOferta(), { target: { value: "12,50" } });

    await user.click(screen.getByRole("button", { name: "Salvar dados comerciais" }));
    await waitFor(() => expect(updateSupplierItem).toHaveBeenCalledTimes(1));
    // Gravar responde, no bloco que gravou (UX-ACTIONS-FEEDBACK-WAVE-02).
    expect(await screen.findByText("Dados comerciais salvos.")).toHaveAttribute("role", "status");

    // O código já está no servidor; o preço continua só na tela.
    await user.click(menuEstoque());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    fireEvent.change(precoDaOferta(), { target: { value: "" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("Cancelar com pendência pergunta; sem pendência fecha direto", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: /Fechar/ }));
    expect(fechou).toBe(true);

    fechou = false;
    fireEvent.change(codigo(), { target: { value: "COD-NOVO" } });
    await user.click(screen.getByRole("button", { name: /Fechar/ }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);
  });
});
