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
import type { PurchaseOrderDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-01 na Ordem de Compra.
 *
 * A OC é página, não modal: sair dela é trocar de endereço, e quem faz isso é
 * o menu, a trilha, um link ou o Voltar do navegador. O que se protege aqui é
 * a assinatura do documento não inventar pendência — decimal reescrito,
 * ausência contra vazio, defaults da abertura — nem perder uma: cabeçalho e
 * linha pesam igual.
 */

vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  confirmPurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: () =>
    Promise.resolve({
      suppliers: [
        {
          id: "for-1",
          code: "FOR-000001",
          legalName: "Fornecedor Teste",
          tradeName: null,
          active: true,
        },
      ],
    }),
}));
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: () => Promise.resolve({ supplierItems: [] }),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
  getItem: vi.fn(),
}));

import { createPurchaseOrder, getPurchaseOrder, updatePurchaseOrder } from "../../lib/purchase-orders-api";
import { PurchaseOrderPage } from "./PurchaseOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function linha(overrides: Partial<PurchaseOrderDTO["lines"][number]> = {}) {
  return {
    id: "pol-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    unitCode: "kg",
    orderedQuantity: "10.000000",
    unitPrice: "12.5000",
    lineTotal: "125.00",
    receivedQuantity: "0",
    openQuantity: "10",
    ...overrides,
  };
}

function ordem(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "oc-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierCnpj: null,
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [linha()],
    orderTotal: "125.00",
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    ...overrides,
  } as PurchaseOrderDTO;
}

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

function montar(entradas: string[], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/compras/ordens/nova" element={<PurchaseOrderPage />} />
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirNova() {
  montar(["/compras/ordens/nova"]);
  await screen.findByRole("heading", { name: "Nova ordem de compra" });
}

async function abrirGravada(dto = ordem()) {
  vi.mocked(getPurchaseOrder).mockResolvedValue(dto);
  montar(["/compras/ordens/oc-1"]);
  await screen.findByRole("heading", { name: "OC-000001" });
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Quantidade de MP-000001" })).toHaveValue("10.000000"),
  );
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const observacoes = () => screen.getByLabelText("Notas internas");
const quantidade = () => screen.getByRole("textbox", { name: "Quantidade de MP-000001" });

/** Sem fornecedor a OC nem é criada: o salvamento para antes de chamar a API. */
function escolherFornecedor() {
  const campo = document.getElementById("po-supplier") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: "Fornecedor Teste" } });
  // A escolha é confirmada no `mousedown`, antes de o campo perder o foco.
  fireEvent.mouseDown(screen.getAllByRole("option", { name: /Fornecedor Teste/ })[0]!);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OC nova — guarda de alterações não salvas", () => {
  it("aberta e não tocada, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirNova();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar o cabeçalho pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrirNova();

    fireEvent.change(observacoes(), { target: { value: "Compra urgente" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta ordem de compra/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("salvar limpa a pendência antes de trocar de endereço", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchaseOrder).mockResolvedValue(ordem());
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordem());
    await abrirNova();

    escolherFornecedor();
    fireEvent.change(observacoes(), { target: { value: "Compra urgente" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalledTimes(1));
    /*
     * Criar troca o endereço (`/nova` → `/:id`) dentro da MESMA função que
     * salvou, antes de qualquer renderização. Sem limpar a referência ali, a
     * guarda leria a pendência de antes do salvamento e perguntaria se a
     * pessoa quer descartar o que ela acabou de gravar.
     */
    expect(pergunta()).toBeNull();
    await screen.findByRole("heading", { name: "OC-000001" });
  });
});

describe("OC gravada — guarda de alterações não salvas", () => {
  it("carregada e não tocada, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a quantidade de uma linha pergunta", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    fireEvent.change(quantidade(), { target: { value: "12" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("reescrever o MESMO decimal não é alteração", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    /*
     * O servidor devolve `10.000000` e a pessoa redigita `10,0`. É o mesmo
     * número: perguntar aqui seria a guarda avisando de uma perda que não
     * existe, e quem aprende a ignorar essa pergunta ignora a próxima.
     */
    fireEvent.change(quantidade(), { target: { value: "10,0" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    const salva = ordem({ notes: "Conferir com o fornecedor" });
    vi.mocked(updatePurchaseOrder).mockResolvedValue(salva);
    await abrirGravada();

    fireEvent.change(observacoes(), { target: { value: "Conferir com o fornecedor" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalledTimes(1));

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordem());
    const router = montar(["/estoque", "/compras/ordens/oc-1"], 1);
    await screen.findByRole("heading", { name: "OC-000001" });

    fireEvent.change(observacoes(), { target: { value: "Compra urgente" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("desfazer a alteração devolve a saída livre", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    fireEvent.change(observacoes(), { target: { value: "rascunho" } });
    fireEvent.change(observacoes(), { target: { value: "" } });

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});

describe("diálogo com campo digitável — o foco fica onde a pessoa está", () => {
  /*
   * O mesmo defeito que a foundation achou no modal de workspace, agora no
   * `ModalDialog`: `onClose={() => setAberto(false)}` nasce de novo a cada
   * renderização, a tecla re-renderiza a tela de trás, o efeito de foco e
   * trap se desmonta e remonta, e a remontagem devolve o foco ao primeiro
   * botão. O motivo do cancelamento não recebia uma letra sequer.
   */
  it("o motivo do cancelamento aceita a frase inteira", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    await user.click(screen.getByRole("button", { name: "Cancelar OC" }));
    const motivo = await screen.findByLabelText(/Motivo do cancelamento/);
    await user.type(motivo, "Fornecedor desistiu");

    expect(motivo).toHaveValue("Fornecedor desistiu");
    expect(motivo).toHaveFocus();
  });
});
