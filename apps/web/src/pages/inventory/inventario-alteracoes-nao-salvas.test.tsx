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
 * UNSAVED-CHANGES-WAVE-02 no Inventário Físico.
 *
 * A contagem é digitada depois de alguém percorrer o estoque com a folha na
 * mão: sair da tela antes de confirmar joga fora esse percurso, e a diferença
 * é justamente o que ninguém quer redescobrir.
 *
 * O que se protege aqui: o que a pessoa DIGITA pesa; o que a tela calcula —
 * saldo do sistema, diferença, "há divergência" — não pesa, porque já é
 * consequência da digitação; e confirmar, que cria o ajuste rastreável, encerra
 * a pendência sem trocar de tela.
 */

vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(),
  getItem: vi.fn(),
}));
vi.mock("../../lib/inventory-api", () => ({
  getInventoryItem: vi.fn(),
  createStockCount: vi.fn(),
}));

import { listItems } from "../../lib/items-api";
import { createStockCount, getInventoryItem } from "../../lib/inventory-api";
import { StockCountPage } from "./StockCountPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const ITEM = {
  id: "item-1",
  code: "MP-000001",
  name: "Vitamina C",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  controlsLot: false,
  active: true,
} as unknown as ItemDTO;

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
        <Route path="/estoque/inventario" element={<StockCountPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
        <Route path="/print/contagem-fisica" element={<h1>Folha de contagem</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Escolhe o item — é ESCOPO da contagem, e escolher ainda não é contar. */
async function escolherItem() {
  const campo = document.getElementById("count-item") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: "MP-000001" } });
  fireEvent.mouseDown(screen.getAllByRole("option", { name: /MP-000001/ })[0]!);
  // O campo da contagem só libera quando o saldo do sistema chega.
  await waitFor(() => expect(contagem()).toBeEnabled());
}

async function abrir(entradas = ["/estoque/inventario"], indice?: number) {
  const router = montar(entradas, indice);
  await screen.findByRole("heading", { name: "Inventário Físico" });
  await waitFor(() => expect(document.getElementById("count-item")).toBeInTheDocument());
  return router;
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const contagem = () => document.getElementById("count-quantity") as HTMLInputElement;
const motivo = () => document.getElementById("count-reason") as HTMLInputElement;

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listItems).mockResolvedValue({ items: [ITEM], total: 1 } as never);
  vi.mocked(getInventoryItem).mockResolvedValue({
    itemId: ITEM.id,
    controlsLot: false,
    onHand: "10.000000",
    lots: [],
  } as never);
});

describe("Inventário Físico — guarda de alterações não salvas", () => {
  it("tela aberta sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("escolher o item é escopo, não contagem: ainda sai livre", async () => {
    const user = userEvent.setup();
    await abrir();

    await escolherItem();
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("contagem digitada pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    await escolherItem();
    fireEvent.change(contagem(), { target: { value: "8" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta contagem/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("a diferença calculada não é uma segunda pendência", async () => {
    const user = userEvent.setup();
    await abrir();

    await escolherItem();
    fireEvent.change(contagem(), { target: { value: "8" } });
    // Saldo 10, contagem 8: a tela calculou a divergência — o campo Motivo,
    // que só existe quando há diferença, é a prova disso na tela.
    expect(motivo()).toBeInTheDocument();

    await user.click(menuEstoque());

    /*
     * A diferença é consequência da contagem, não outra digitação. Se ela
     * fosse fonte própria, a mesma edição contaria duas vezes e a foundation
     * responderia com dois diálogos sobre a mesma decisão.
     */
    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
  });

  it("o motivo da divergência também pergunta, e Continuar mantém tudo", async () => {
    const user = userEvent.setup();
    await abrir();

    await escolherItem();
    fireEvent.change(contagem(), { target: { value: "8" } });
    fireEvent.change(motivo(), { target: { value: "Quebra na separação" } });

    await user.click(menuEstoque());
    await user.click(await screen.findByRole("button", { name: "Continuar editando" }));

    await waitFor(() => expect(pergunta()).toBeNull());
    expect(contagem()).toHaveValue("8");
    expect(motivo()).toHaveValue("Quebra na separação");
  });

  it("confirmar a contagem encerra a pendência sem sair da tela", async () => {
    const user = userEvent.setup();
    vi.mocked(createStockCount).mockResolvedValue({
      countedQuantity: "8",
      systemQuantity: "10.000000",
      difference: "-2",
      adjustmentCreated: true,
    } as never);
    await abrir();

    await escolherItem();
    fireEvent.change(contagem(), { target: { value: "8" } });
    fireEvent.change(motivo(), { target: { value: "Quebra na separação" } });
    await user.click(screen.getByRole("button", { name: /Confirmar contagem/ }));

    await waitFor(() => expect(createStockCount).toHaveBeenCalledTimes(1));

    // A contagem virou documento e ajuste: não há mais o que descartar.
    await user.click(menuEstoque());
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com contagem digitada também pergunta", async () => {
    const user = userEvent.setup();
    const router = await abrir(["/estoque", "/estoque/inventario"], 1);

    await escolherItem();
    fireEvent.change(contagem(), { target: { value: "8" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a contagem", async () => {
    await abrir();
    await escolherItem();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(contagem(), { target: { value: "8" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(contagem(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});
