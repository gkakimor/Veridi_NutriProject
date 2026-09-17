import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import type { RegisterStockCountEntryResultDTO, StockCountDetailDTO, UserRole } from "@veridi/shared";
import { chaveDaFila, lerFila } from "./fila-de-contagem";
import {
  SALDO_SENTINELA,
  SALDO_SENTINELA_NA_TELA,
  detalhe,
  emularCelular,
  posicao,
  posicaoContada,
  registro,
} from "./testing/inventario-fixtures";

/**
 * Estoque → Inventário Físico → Contagem (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * A tela de quem conta. O que estes testes seguram:
 *
 * - a leitura é SEMPRE `counting`, e numa contagem cega nada que revele saldo
 *   aparece — nem se a resposta do servidor o trouxesse;
 * - Enter grava e leva à próxima pendente; vazio não grava, 0 grava; unidade
 *   de contagem só aceita inteiro; Esc descarta a edição;
 * - a fila local é de um usuário, sobrevive à queda de rede e reenvia com o
 *   MESMO identificador;
 * - conflito com outro operador é decisão explícita; estado que mudou pede
 *   recarga; abaixo de 640px a contagem é um cartão por vez;
 * - quem não opera inventário não recebe campo nenhum.
 */

let usuario: { id: string; role: UserRole } = { id: "u-ana", role: "PRODUCTION" };

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: usuario }),
  useOptionalAuth: () => ({ user: usuario }),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ]),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })),
}));
vi.mock("../../lib/stock-counts-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/stock-counts-api")>();
  return { ...original, getStockCount: vi.fn(), registerStockCountEntry: vi.fn() };
});

import {
  StockCountApiError,
  StockCountSendFailedError,
  getStockCount,
  registerStockCountEntry,
} from "../../lib/stock-counts-api";
import { StockCountCountingPage } from "./StockCountCountingPage";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/estoque/inventario/inv-1/contagem"]}>
      <Routes>
        <Route path="/estoque/inventario/:id/contagem" element={<StockCountCountingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const campo = (sequencia: number) => screen.getByLabelText(new RegExp(`^Contagem da posição ${sequencia} —`));
const envios = () => vi.mocked(registerStockCountEntry).mock.calls;

/** A resposta que o servidor daria ao registro: a posição contada com aquele número. */
function aceitar(inventario: StockCountDetailDTO) {
  vi.mocked(registerStockCountEntry).mockImplementation(async (_id, positionId, corpo) => {
    const base = inventario.positions.find((p) => p.id === positionId) ?? posicao({ id: positionId });
    const entry = registro({ id: `e-${corpo.clientRequestId.slice(0, 8)}`, countedQuantity: corpo.countedQuantity });
    const resultado: RegisterStockCountEntryResultDTO = {
      created: true,
      entry,
      position: { ...base, situation: "COUNTED", lastEntryId: entry.id, validEntryId: entry.id, entries: [entry] },
    };
    return resultado;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  usuario = { id: "u-ana", role: "PRODUCTION" };
  emularCelular(false);
  const inventario = detalhe();
  vi.mocked(getStockCount).mockResolvedValue(inventario);
  aceitar(inventario);
});

afterEach(() => {
  emularCelular(false);
});

describe("contagem — leitura cega", () => {
  it("lê a leitura de quem conta, nunca a de revisão", async () => {
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    expect(getStockCount).toHaveBeenCalledWith("inv-1", "counting");
    expect(vi.mocked(getStockCount).mock.calls.every(([, view]) => view === "counting")).toBe(true);
  });

  it("numa contagem cega nada revela saldo, esperado ou diferença — nem se a resposta trouxer", async () => {
    // Simula um servidor vazando: a tela é a segunda barreira.
    vi.mocked(getStockCount).mockResolvedValue(
      detalhe({
        mode: "BLIND",
        balancesHidden: false,
        positions: [
          posicao({ referenceQuantity: SALDO_SENTINELA, hasConcurrentMovement: true }),
          posicaoContada(
            { id: "p-2", sequence: 2, positionKey: "item-1:lote-2", situation: "DIVERGENT", referenceQuantity: SALDO_SENTINELA, finalDifference: "-4316.5" },
            { id: "e-2", countedQuantity: "5", expectedQuantity: SALDO_SENTINELA, difference: "-4316.5" },
          ),
        ],
      }),
    );
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));

    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain(SALDO_SENTINELA_NA_TELA);
    expect(texto).not.toContain("4.316,5");
    expect(texto).not.toMatch(/Divergente|Confere/);
    expect(screen.queryByRole("columnheader", { name: /Saldo|Esperado|Diferença/ })).toBeNull();
    for (const entrada of screen.getAllByRole("textbox", { name: /^Contagem da posição/ })) {
      expect(entrada).not.toHaveAttribute("placeholder");
    }
    expect(document.querySelector(".calc-hint, [data-calc-hint]")).toBeNull();
  });

  it("contagem com saldo mostra o saldo de referência a quem conta", async () => {
    vi.mocked(getStockCount).mockResolvedValue(
      detalhe({ mode: "ASSISTED", balancesHidden: false, positions: [posicao({ referenceQuantity: "12.5" })] }),
    );
    abrir();
    expect(await screen.findByRole("columnheader", { name: "Saldo de referência" })).toBeInTheDocument();
    expect(screen.getByText("12,5 kg")).toBeInTheDocument();
  });
});

describe("contagem — digitar e seguir", () => {
  it("Enter grava com rodada, trava e id novo, e leva à próxima pendente", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    await user.click(campo(1));
    await user.keyboard("12,5{Enter}");

    await waitFor(() => expect(envios()).toHaveLength(1));
    const [id, positionId, corpo] = envios()[0]!;
    expect([id, positionId]).toEqual(["inv-1", "p-1"]);
    expect(corpo).toMatchObject({ round: 1, expectedLastEntryId: null, countedQuantity: "12.5" });
    expect(corpo.clientRequestId).toMatch(UUID_V4);
    expect(document.activeElement).toBe(campo(2));
    expect(await screen.findByText("Salvo")).toBeInTheDocument();
    // Sair do campo depois do Enter não manda de novo.
    await user.tab();
    expect(envios()).toHaveLength(1);
  });

  it("vazio não grava; zero é contagem e grava", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    // Campo intocado e campo apagado: nos dois, vazio não é contagem.
    await user.click(campo(1));
    await user.keyboard("{Enter}");
    await user.click(campo(1));
    await user.keyboard("5{Backspace}{Enter}");
    await user.click(campo(1));
    await user.tab();
    expect(envios()).toHaveLength(0);

    await user.click(campo(1));
    await user.keyboard("0{Enter}");
    await waitFor(() => expect(envios()).toHaveLength(1));
    expect(envios()[0]![2]).toMatchObject({ countedQuantity: "0" });
  });

  it("unidade de contagem aceita só inteiro: a vírgula não entra", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("ME-000077", { selector: "span" });
    expect(campo(3)).toHaveAttribute("inputmode", "numeric");
    expect(campo(1)).toHaveAttribute("inputmode", "decimal");
    await user.click(campo(3));
    await user.keyboard("2,5{Enter}");
    await waitFor(() => expect(envios()).toHaveLength(1));
    expect(envios()[0]![2]).toMatchObject({ countedQuantity: "25" });
  });

  it("Esc descarta a edição da linha e nada é enviado", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    await user.click(campo(1));
    await user.keyboard("7");
    expect(campo(1)).toHaveValue("7");
    await user.keyboard("{Escape}");
    expect(campo(1)).toHaveValue("");
    await user.tab();
    expect(envios()).toHaveLength(0);
  });
});

describe("contagem — fila local e rede", () => {
  const ENVIO_GUARDADO = {
    positionId: "p-1",
    round: 1,
    expectedLastEntryId: null,
    countedQuantity: "12.5",
    clientRequestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  };

  it("a fila de Ana volta para Ana e reenvia com o MESMO id", async () => {
    window.localStorage.setItem(chaveDaFila("u-ana", "inv-1"), JSON.stringify([ENVIO_GUARDADO]));
    abrir();
    expect(await screen.findByText("1 contagem não enviada")).toBeInTheDocument();
    expect(campo(1)).toHaveValue("12,5");
    expect(envios()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(envios()).toHaveLength(1));
    expect(envios()[0]![2]).toMatchObject({ clientRequestId: ENVIO_GUARDADO.clientRequestId, countedQuantity: "12.5" });
    await waitFor(() => expect(screen.queryByText("1 contagem não enviada")).toBeNull());
    expect(lerFila("u-ana", "inv-1")).toEqual([]);
  });

  it("outro usuário no mesmo navegador não vê nem reenvia a fila alheia", async () => {
    window.localStorage.setItem(chaveDaFila("u-ana", "inv-1"), JSON.stringify([ENVIO_GUARDADO]));
    usuario = { id: "u-bruno", role: "QUALITY" };
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    expect(screen.queryByText(/não enviada/)).toBeNull();
    expect(campo(1)).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Reenviar" })).toBeNull();
    expect(lerFila("u-ana", "inv-1")).toEqual([ENVIO_GUARDADO]);
  });

  it("rede caída deixa Não enviado na fila; reenviar usa o mesmo id e limpa ao confirmar", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    vi.mocked(registerStockCountEntry).mockRejectedValueOnce(new StockCountSendFailedError(null));
    await user.click(campo(1));
    await user.keyboard("8{Enter}");

    expect(await screen.findByText("Não enviado")).toBeInTheDocument();
    expect(screen.getByText("1 contagem não enviada")).toBeInTheDocument();
    const [guardado] = lerFila("u-ana", "inv-1");
    expect(guardado).toMatchObject({ positionId: "p-1", countedQuantity: "8" });

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(envios()).toHaveLength(2));
    expect(envios()[1]![2].clientRequestId).toBe(guardado?.clientRequestId);
    await waitFor(() => expect(lerFila("u-ana", "inv-1")).toEqual([]));
    expect(screen.queryByText("1 contagem não enviada")).toBeNull();
  });
});

describe("contagem — conflito e estado que mudou", () => {
  function conflito() {
    return new StockCountApiError(409, {
      error: "stock_count_entry_conflict",
      message: "A posição mudou desde que você a abriu.",
      position: posicaoContada(
        { id: "p-1", lastEntryId: "e-bruno", validEntryId: "e-bruno" },
        { id: "e-bruno", countedByName: "Bruno Produção", countedQuantity: "7", countedAt: "2026-09-15T12:10:00.000Z" },
      ),
    });
  }

  it("mostra quem, quanto e quando; nunca sobrescreve sozinho; Usar a minha é envio novo sobre o registro de lá", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    vi.mocked(registerStockCountEntry).mockRejectedValueOnce(conflito());
    await user.click(campo(1));
    await user.keyboard("8{Enter}");

    const painel = (await screen.findByText("Bruno Produção")).closest(".inv-conflito") as HTMLElement;
    expect(painel).toHaveTextContent(/Bruno Produção registrou 7 kg às 15\/09\/2026/);
    expect(painel).toHaveTextContent("(8 kg)");
    // A decisão é da linha: o aviso de não enviadas não oferece um Reenviar que não resolve o conflito.
    expect(screen.queryByText("1 contagem não enviada")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(envios()).toHaveLength(1);

    fireEvent.click(within(painel).getByRole("button", { name: "Usar a minha contagem" }));
    await waitFor(() => expect(envios()).toHaveLength(2));
    const [primeiro, segundo] = [envios()[0]![2], envios()[1]![2]];
    expect(segundo).toMatchObject({ countedQuantity: "8", expectedLastEntryId: "e-bruno", round: 1 });
    expect(segundo.clientRequestId).not.toBe(primeiro.clientRequestId);
    expect(segundo.clientRequestId).toMatch(UUID_V4);
  });

  it("Manter a registrada tira a minha da fila e mostra o número de lá, sem enviar nada", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    vi.mocked(registerStockCountEntry).mockRejectedValueOnce(conflito());
    await user.click(campo(1));
    await user.keyboard("8{Enter}");
    const painel = (await screen.findByText("Bruno Produção")).closest(".inv-conflito") as HTMLElement;

    fireEvent.click(within(painel).getByRole("button", { name: "Manter a registrada" }));
    await waitFor(() => expect(screen.queryByText("Bruno Produção registrou", { exact: false })).toBeNull());
    expect(envios()).toHaveLength(1);
    expect(lerFila("u-ana", "inv-1")).toEqual([]);
    expect(campo(1)).toHaveValue("7");
  });

  it("estado que mudou pede recarga, e a contagem não aceita continua à vista", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    vi.mocked(registerStockCountEntry).mockRejectedValueOnce(
      new StockCountApiError(409, {
        error: "invalid_stock_count_status",
        message: "Não é possível registrar contagem: o inventário está cancelado.",
        status: "CANCELLED",
      }),
    );
    await user.click(campo(1));
    await user.keyboard("8{Enter}");

    const alerta = await screen.findByText(/O inventário mudou enquanto você contava/);
    expect(alerta).toHaveTextContent("o inventário está cancelado");
    expect(screen.getByText("1 contagem não enviada")).toBeInTheDocument();

    vi.mocked(getStockCount).mockResolvedValue(detalhe({ status: "CANCELLED" }));
    const leiturasAntes = vi.mocked(getStockCount).mock.calls.length;
    fireEvent.click(within(alerta).getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(vi.mocked(getStockCount).mock.calls.length).toBe(leiturasAntes + 1));
    expect(await screen.findByText(/não recebe\s+contagem/)).toBeInTheDocument();
    expect(lerFila("u-ana", "inv-1")).toHaveLength(1);
  });
});

describe("contagem — celular e papéis", () => {
  it("abaixo de 640px: um cartão por vez, campo grande e navegação Anterior/Próxima", async () => {
    emularCelular(true);
    const user = userEvent.setup();
    abrir();
    const cartao = (await screen.findByText("MP-000431 · Vitamina C")).closest(".inv-cartao") as HTMLElement;
    expect(document.querySelector("table")).toBeNull();
    expect(within(cartao).getByText("LT-20260902-000118")).toBeInTheDocument();
    expect(within(cartao).getByText("A-03")).toBeInTheDocument();
    const entrada = within(cartao).getByLabelText("Contagem (kg)");
    expect(entrada).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("1 de 3")).toBeInTheDocument();

    await user.click(entrada);
    await user.keyboard("3");
    await user.click(within(cartao).getByRole("button", { name: "Gravar e ir para a próxima" }));
    await waitFor(() => expect(envios()).toHaveLength(1));
    expect(envios()[0]![2]).toMatchObject({ countedQuantity: "3" });
    expect(await screen.findByText("2 de 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("ME-000077 · Pote PET 500 ml")).toBeInTheDocument();
    expect(screen.getByLabelText("Contagem (un)")).toHaveAttribute("inputmode", "numeric");
  });

  it.each(["VIEWER", "COMMERCIAL", "PURCHASING"] as const)("%s consulta a contagem sem campo nenhum", async (role) => {
    usuario = { id: "u-vera", role };
    abrir();
    await screen.findAllByText("MP-000431", { selector: "span" });
    expect(screen.queryAllByRole("textbox", { name: /^Contagem da posição/ })).toHaveLength(0);
    expect(screen.getByText(/Seu perfil consulta este inventário, mas não registra contagem/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Adicionar posição" })).toBeNull();
  });

  it("contagem não enviada segura a saída: o aviso do navegador acompanha a fila", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<UnsavedChangesProvider><Outlet /></UnsavedChangesProvider>}>
          <Route path="/estoque/inventario/:id/contagem" element={<StockCountCountingPage />} />
        </Route>,
      ),
      { initialEntries: ["/estoque/inventario/inv-1/contagem"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findAllByText("MP-000431", { selector: "span" });
    const avisaAoFechar = () => {
      const evento = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    };
    expect(avisaAoFechar()).toBe(false);

    vi.mocked(registerStockCountEntry).mockRejectedValueOnce(new StockCountSendFailedError(null));
    await user.click(campo(1));
    await user.keyboard("8{Enter}");
    await screen.findByText("1 contagem não enviada");
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(screen.queryByText("1 contagem não enviada")).toBeNull());
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});
