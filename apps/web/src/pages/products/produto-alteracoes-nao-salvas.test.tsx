import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { CustomerDTO, ProductDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-03 no cadastro de Produto Acabado.
 *
 * Duas portas, um controller (`useProductForm`) — a guarda mora nele.
 *
 * Só o formulário do Produto entra na comparação. Formulação, CMV, custo
 * industrial, estoque e o Perfil de Produção padrão ficam fora porque não se
 * editam aqui: são documentos próprios, com tela e salvamento próprios, e o
 * cadastro apenas os mostra. Contá-los faria o Produto se declarar alterado
 * porque outro documento mudou.
 */

vi.mock("../../lib/products-api", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("./ProductIndustrialCostSummary", () => ({ ProductIndustrialCostSummary: () => null }));

import { createProduct, updateProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listUnits } from "../../lib/units-api";
import { useAuth } from "../../app/AuthProvider";
import { ProductCreatePage } from "./ProductCreatePage";
import { ProductFormModal } from "./ProductFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const CLIENTE = {
  id: "cli-1",
  code: "CLI-000007",
  legalName: "35.301.394 THIAGO LUZ DE SOUZA",
  tradeName: "THE KING",
  cnpj: "11222333000181",
  email: null,
  phone: null,
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
  createdAt: "2026-08-01T12:00:00.000Z",
  createdByName: null,
  updatedAt: "2026-08-01T12:00:00.000Z",
  updatedByName: null,
} as CustomerDTO;

function produto(overrides: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "prod-1",
    code: "PROD-000042",
    name: "Coenzima Q10 60 cápsulas",
    externalCode: null,
    customerId: CLIENTE.id,
    customerName: CLIENTE.legalName,
    finishedProductItemId: "item-1",
    finishedProductItem: { id: "item-1", code: "PA-000042", name: "Coenzima Q10", requiresCoa: false },
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    doseAmount: null,
    doseUomCode: null,
    dosesPerPackage: 60,
    unitsPerShippingBox: null,
    targetAgeGroup: null,
    shelfLifeMonths: 24,
    minimumBatchQuantity: "1000.000000",
    notes: null,
    active: true,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  } as unknown as ProductDTO;
}

let fechou = false;

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/painel">Painel</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(elemento: React.ReactNode, entradas: string[], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/cadastros/produtos/novo" element={elemento} />
        <Route path="/cadastros/produtos" element={elemento} />
        <Route path="/painel" element={<h1>Painel</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirPagina(entradas = ["/cadastros/produtos/novo"], indice?: number) {
  const router = montar(<ProductCreatePage />, entradas, indice);
  await screen.findByRole("heading", { name: "Novo produto" });
  await waitFor(() => expect(listCustomers).toHaveBeenCalled());
  return router;
}

async function abrirModalDeEdicao(dto = produto()) {
  montar(
    <ProductFormModal
      mode="edit"
      product={dto}
      onClose={() => {
        fechou = true;
      }}
      onSaved={() => undefined}
    />,
    ["/cadastros/produtos"],
  );
  await screen.findByText(dto.name);
  await waitFor(() => expect(listCustomers).toHaveBeenCalled());
}

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const pergunta = () => screen.queryByRole("alertdialog");
const menu = () => screen.getByRole("link", { name: "Painel" });
const nome = () => campo("product-name");
const loteMinimo = () => campo("product-minimum-batch");
const notas = () => document.getElementById("product-notes") as HTMLTextAreaElement;

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  fechou = false;
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", name: "Admin", email: "a@b.c", role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(listUnits).mockResolvedValue([
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ] as never);
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [CLIENTE],
    page: 1,
    pageSize: 20,
    total: 1,
  } as never);
  vi.mocked(createProduct).mockResolvedValue(produto());
  vi.mocked(updateProduct).mockResolvedValue(produto());
});

describe("Produto novo — guarda de alterações não salvas", () => {
  it("aberto com os defaults, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    await user.click(menu());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("nome digitado pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(nome(), { target: { value: "Coenzima Q10 60 cápsulas" } });
    await user.click(menu());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste produto/i)).toBeInTheDocument();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    const router = await abrirPagina(["/painel", "/cadastros/produtos/novo"], 1);

    fireEvent.change(nome(), { target: { value: "Coenzima Q10" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a digitação", async () => {
    await abrirPagina();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(nome(), { target: { value: "Coenzima Q10" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(nome(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});

describe("Produto — modal de edição", () => {
  it("carregado e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    await user.click(menu());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("reescrever o MESMO lote mínimo não é alteração", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    // O servidor devolve `1000.000000` e a pessoa redigita `1000,0`.
    fireEvent.change(loteMinimo(), { target: { value: "1000,0" } });
    await user.click(menu());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("campo editável alterado pergunta", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(loteMinimo(), { target: { value: "2000" } });
    await user.click(menu());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("Cancelar, ✕ e Esc com alteração passam pela mesma pergunta", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fechou).toBe(true);

    fechou = false;
    fireEvent.change(notas(), { target: { value: "Rótulo com selo vegano" } });

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    await user.click(screen.getByRole("button", { name: /Fechar/ }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    await user.keyboard("{Escape}");
    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(fechou).toBe(false);
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(notas(), { target: { value: "Rótulo com selo vegano" } });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));

    await user.click(menu());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
