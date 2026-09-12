import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ItemDTO, PurchaseOrderDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-02 no Recebimento de OC.
 *
 * A doca é o lugar onde mais se digita de uma vez: quantidade, lote do
 * fornecedor, validade, localização e custo, linha por linha, com o documento
 * do transportador na mão. Sair sem querer dali custa a conferência inteira.
 *
 * O que se protege aqui: escolher a OC CARREGA a tela e não é digitação;
 * o que o operador escreve pesa; o que o servidor manda (pedido, recebido,
 * saldo, preço da OC) e o que a tela calcula não pesam; e confirmar o
 * recebimento — que grava documento e movimento de estoque — solta a guarda
 * antes de trocar de endereço.
 */

vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  listPurchaseOrders: vi.fn(async () => ({ purchaseOrders: [], total: 0 })),
  createPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  getItem: vi.fn(),
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../../lib/receiving-api", () => ({
  createReceipt: vi.fn(),
  createCustomerSuppliedReceipt: vi.fn(),
  getReceipt: vi.fn(),
  listReceipts: vi.fn(),
}));

import { getPurchaseOrder } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { createReceipt } from "../../lib/receiving-api";
import { ReceivePurchaseOrderPage } from "./ReceivePurchaseOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function item(): ItemDTO {
  return {
    id: "item-a",
    code: "MP-000120",
    name: "Material MP-000120",
    type: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: false,
    requiresCoa: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as ItemDTO;
}

function ordemDeCompra(): PurchaseOrderDTO {
  return {
    id: "po-1",
    code: "OC-000001",
    supplierId: "sup-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor de Teste",
    supplierCnpj: null,
    orderDate: new Date().toISOString(),
    expectedDeliveryDate: null,
    status: "ORDERED",
    notes: null,
    lines: [
      {
        id: "poline-a",
        itemId: "item-a",
        itemCode: "MP-000120",
        itemName: "Material MP-000120",
        unitCode: "kg",
        orderedQuantity: "50",
        receivedQuantity: "0",
        openQuantity: "50.000000",
        unitPrice: null,
        lineTotal: null,
      },
    ],
    orderTotal: null,
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: new Date().toISOString(),
    orderedBy: "Teste",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as PurchaseOrderDTO;
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
        <Route path="/compras/recebimentos/novo" element={<ReceivePurchaseOrderPage />} />
        <Route path="/compras/recebimentos/:id" element={<h1>Recebimento gravado</h1>} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrir() {
  montar(["/compras/recebimentos/novo?purchaseOrderId=po-1"]);
  await screen.findByText(/^MP-000120 —/);
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });

/** Um campo da linha do item, achado pelo rótulo que a pessoa lê. */
function campoDaLinha(rotulo: RegExp): HTMLInputElement {
  const secao = screen.getByText(/^MP-000120 —/).closest("section");
  if (!secao) throw new Error("seção do item não encontrada");
  return within(secao as HTMLElement).getByLabelText(rotulo) as HTMLInputElement;
}

const quantidade = () => campoDaLinha(/Receber agora/);
/* Pelo `id`: o rótulo carrega o ⓘ de ajuda, e o texto dele bate em mais de um nó. */
const loteDoFornecedor = () =>
  document.getElementById("supplier-lot-poline-a") as HTMLInputElement;

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
  vi.mocked(getItem).mockResolvedValue(item());
});

describe("Recebimento de OC — guarda de alterações não salvas", () => {
  it("OC carregada e nada digitado: sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("quantidade recebida digitada pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "20" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste recebimento/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("lote do fornecedor digitado também pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(loteDoFornecedor(), { target: { value: "LT-2026-09" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("apagar o que foi digitado devolve a saída livre", async () => {
    const user = userEvent.setup();
    await abrir();

    /*
     * A tela nasce com os campos da linha em branco: o recebimento é digitado
     * do zero, não carregado. Voltar exatamente ao ponto de partida é não ter
     * mais nada a perder, e a guarda tem de perceber isso — senão ela aprende
     * a perguntar para sempre depois da primeira tecla.
     */
    fireEvent.change(quantidade(), { target: { value: "50,0" } });
    fireEvent.change(quantidade(), { target: { value: "" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("Continuar editando mantém a conferência; Sair vai ao destino pedido", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "20" } });
    fireEvent.change(loteDoFornecedor(), { target: { value: "LT-2026-09" } });
    await user.click(menuEstoque());
    await user.click(await screen.findByRole("button", { name: "Continuar editando" }));

    await waitFor(() => expect(pergunta()).toBeNull());
    expect(quantidade()).toHaveValue("20");
    expect(loteDoFornecedor()).toHaveValue("LT-2026-09");

    await user.click(menuEstoque());
    await user.click(await screen.findByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("confirmar o recebimento solta a guarda antes de trocar de endereço", async () => {
    const user = userEvent.setup();
    vi.mocked(createReceipt).mockResolvedValue({ id: "rec-1" } as never);
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "20" } });
    await user.click(screen.getByRole("button", { name: /Confirmar recebimento/ }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(createReceipt).toHaveBeenCalledTimes(1));
    /*
     * O recebimento já está persistido: perguntar "sair sem salvar?" depois
     * disso trocaria a ordem dos fatos.
     */
    expect(await screen.findByRole("heading", { name: "Recebimento gravado" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com conferência digitada também pergunta", async () => {
    const user = userEvent.setup();
    const router = montar(
      ["/estoque", "/compras/recebimentos/novo?purchaseOrderId=po-1"],
      1,
    );
    await screen.findByText(/^MP-000120 —/);

    fireEvent.change(quantidade(), { target: { value: "20" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a conferência", async () => {
    await abrir();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(quantidade(), { target: { value: "20" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(quantidade(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});
