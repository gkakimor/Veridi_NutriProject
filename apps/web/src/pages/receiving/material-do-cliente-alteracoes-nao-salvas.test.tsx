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
import type { ItemDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-02 no recebimento de material do cliente.
 *
 * Mesma doca, mesmo documento na mão, e aqui o cliente é parte do registro.
 * A tela nasce com a data de hoje e uma linha em branco — defaults, não
 * edição —, então abrir e sair não pode perguntar nada. Confirmar grava
 * documento e movimento de estoque: depois disso não há o que descartar.
 */

vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(),
  getItem: vi.fn(),
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

import { listCustomers } from "../../lib/customers-api";
import { listItems } from "../../lib/items-api";
import { createCustomerSuppliedReceipt } from "../../lib/receiving-api";
import { ReceiveCustomerMaterialPage } from "./ReceiveCustomerMaterialPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const CLIENTE = {
  id: "cli-1",
  code: "CLI-000001",
  legalName: "Alfa Suplementos Ltda",
  tradeName: "Alfa",
  cnpj: null,
};

function item(): ItemDTO {
  return {
    id: "item-a",
    code: "MP-000120",
    name: "Material do cliente",
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
        <Route
          path="/compras/recebimentos/material-do-cliente"
          element={<ReceiveCustomerMaterialPage />}
        />
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
  montar(["/compras/recebimentos/material-do-cliente"]);
  await screen.findByRole("heading", { name: "Material enviado pelo cliente" });
  await waitFor(() => expect(screen.getByLabelText("Item recebido")).toBeInTheDocument());
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const observacoes = () => document.getElementById("customer-receipt-notes") as HTMLTextAreaElement;
const loteDaLinha = () => screen.getByLabelText("Lote do fabricante") as HTMLInputElement;

/** Escolhe o item da linha no seletor com busca — a opção vem da primeira página. */
async function escolherItemDaLinha() {
  const campo = screen.getByRole("combobox", { name: "Item recebido" });
  fireEvent.focus(campo);
  fireEvent.mouseDown(await screen.findByRole("option", { name: /MP-000120/ }));
  await waitFor(() => expect(campo).toHaveValue("MP-000120 · Material do cliente"));
}

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE], total: 1 } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [item()], total: 1 } as never);
});

describe("Material do cliente — guarda de alterações não salvas", () => {
  it("aberta com os defaults, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("dado de cabeçalho digitado pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(observacoes(), { target: { value: "Chegou em dois paletes" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste recebimento/i)).toBeInTheDocument();
  });

  it("linha preenchida pergunta, e Continuar mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    await abrir();

    await escolherItemDaLinha();
    fireEvent.change(loteDaLinha(), { target: { value: "LT-2026-09" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());
    expect(loteDaLinha()).toHaveValue("LT-2026-09");
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("confirmar o recebimento solta a guarda antes de trocar de endereço", async () => {
    const user = userEvent.setup();
    vi.mocked(createCustomerSuppliedReceipt).mockResolvedValue({ id: "rec-1" } as never);
    await abrir();

    await user.click(document.getElementById("customer-receipt-customer") as HTMLInputElement);
    await user.click(await screen.findByText(CLIENTE.tradeName));
    await escolherItemDaLinha();
    fireEvent.change(screen.getByLabelText(/Quantidade recebida/), { target: { value: "10" } });

    await user.click(screen.getByRole("button", { name: /Confirmar recebimento/ }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(createCustomerSuppliedReceipt).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Recebimento gravado" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com dado digitado também pergunta", async () => {
    const user = userEvent.setup();
    const router = montar(["/estoque", "/compras/recebimentos/material-do-cliente"], 1);
    await screen.findByRole("heading", { name: "Material enviado pelo cliente" });

    fireEvent.change(observacoes(), { target: { value: "Chegou em dois paletes" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha o que está digitado", async () => {
    await abrir();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(observacoes(), { target: { value: "Chegou em dois paletes" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(observacoes(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});
