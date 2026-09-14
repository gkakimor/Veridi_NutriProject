import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductionBoardResponse } from "@veridi/shared";

/**
 * Planejamento de Produção — o quadro é do recorte que o pediu
 * (LISTS-LOADING-STALE-DATA-02).
 *
 * O quadro vivia em `useState` solto. As seções já sumiam enquanto carregava,
 * mas: a resposta que CHEGAVA por último virava a tela, mesmo de um período ou
 * filtro já trocado; a primeira consulta a terminar tirava o "Carregando…" com
 * a outra ainda pendente; a falha deixava o quadro anterior à vista, debaixo do
 * alerta; e o aviso de calendário do quadro anterior ficava no topo enquanto o
 * novo carregava. Não é lista paginada — a consulta é a mesma das listagens
 * (`useListQuery`), com a tela de antes: seções só com a resposta, e a recarga
 * depois de programar esconde o quadro até a nova chegar.
 */

vi.mock("../../lib/production-schedules-api", () => ({
  getProductionBoard: vi.fn(),
  getProductionOrderSchedule: vi.fn(),
  previewProductionOrderSchedule: vi.fn(),
  scheduleProductionOrder: vi.fn(),
  unscheduleProductionOrder: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [], page: 1, pageSize: 20, total: 0 }),
}));
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () => Promise.resolve({ resources: [], page: 1, pageSize: 50, total: 0 }),
  getIndustrialResource: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Usuário", role: "ADMIN" } }),
}));

import { ApiValidationError } from "../../lib/api-errors";
import {
  getProductionBoard,
  previewProductionOrderSchedule,
  scheduleProductionOrder,
} from "../../lib/production-schedules-api";
import { ProductionBoardPage } from "./ProductionBoardPage";

interface Pedido {
  params: Record<string, unknown>;
  responder: (r: ProductionBoardResponse) => void;
  recusar: (e: unknown) => void;
}

let pedidos: Pedido[];

function ordem(code: string, programada: boolean) {
  return {
    productionOrderId: code,
    code,
    productCode: "PROD-1",
    productName: "Cápsulas A",
    plannedQuantity: "1000",
    outputUnitCode: "un",
    status: "PLANNED",
    plannedStartAt: programada ? "2026-09-08T11:00:00.000Z" : null,
    plannedEndAt: programada ? "2026-09-08T15:00:00.000Z" : null,
    workingMinutes: programada ? 180 : null,
    warnings: [],
  };
}

/** Um quadro identificado pela OP programada e pela sem programação. */
function quadro(codigo: string, extra: Partial<ProductionBoardResponse> = {}): ProductionBoardResponse {
  return {
    from: "2026-09-07",
    to: "2026-09-13",
    view: "WEEK",
    calendarWarning: null,
    orders: [ordem(codigo, true)],
    unscheduled: [ordem(`${codigo}-S`, false)],
    resources: [],
    conflicts: [],
    pendencies: [],
    pendenciesTotal: 0,
    ...extra,
  } as ProductionBoardResponse;
}

async function abrir(rota = "/planejamento/quadro?view=WEEK&dia=2026-09-10") {
  render(
    <MemoryRouter initialEntries={[rota]}>
      <ProductionBoardPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(pedidos).toHaveLength(1));
}

async function responder(indice: number, resposta: ProductionBoardResponse) {
  await act(async () => pedidos[indice]!.responder(resposta));
}

const naTela = (texto: string) => (document.body.textContent ?? "").includes(texto);
const secoes = () => screen.queryByRole("region", { name: "Ordens programadas" });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  pedidos = [];
  vi.mocked(getProductionBoard).mockImplementation(
    (params) =>
      new Promise((responder, recusar) => {
        pedidos.push({ params: params as unknown as Record<string, unknown>, responder, recusar });
      }),
  );
});

describe("Quadro de Produção — consulta em curso", () => {
  it("primeira carga: carregando, sem seções; a resposta monta o quadro numa consulta", async () => {
    await abrir();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(secoes()).toBeNull();

    await responder(0, quadro("OP-900001"));
    expect(secoes()).not.toBeNull();
    expect(naTela("OP-900001")).toBe(true);
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(pedidos).toHaveLength(1);
  });

  it("filtro novo: nada do quadro anterior — nem o aviso de calendário — enquanto carrega, uma consulta", async () => {
    await abrir();
    await responder(0, quadro("OP-900001", { calendarWarning: "Aviso do quadro anterior." }));
    expect(screen.getByText("Aviso do quadro anterior.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "RELEASED" } });
    await waitFor(() => expect(pedidos).toHaveLength(2));
    expect(pedidos[1]!.params).toMatchObject({ status: "RELEASED", from: "2026-09-07", to: "2026-09-13" });
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(secoes()).toBeNull();
    expect(naTela("OP-900001")).toBe(false);
    expect(screen.queryByText("Aviso do quadro anterior.")).toBeNull();

    await responder(1, quadro("OP-900002"));
    expect(naTela("OP-900002")).toBe(true);
    expect(pedidos).toHaveLength(2);
  });

  it("período seguinte: uma consulta com a semana nova, e o quadro da semana anterior some", async () => {
    await abrir();
    await responder(0, quadro("OP-900001"));

    fireEvent.click(screen.getByRole("button", { name: "Próximo →" }));
    await waitFor(() => expect(pedidos).toHaveLength(2));
    expect(pedidos[1]!.params).toMatchObject({ from: "2026-09-14", to: "2026-09-20" });
    expect(naTela("OP-900001")).toBe(false);
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
  });

  it("respostas fora de ordem: A, B e C respondendo C, B, A — só C vira quadro, e o carregando só sai com ela", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "PLANNED" } });
    await waitFor(() => expect(pedidos).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "RELEASED" } });
    await waitFor(() => expect(pedidos).toHaveLength(3));

    // A primeira a terminar não é a atual: o carregando não sai por ela.
    await responder(0, quadro("OP-900001"));
    expect(naTela("OP-900001")).toBe(false);
    expect(screen.getByText("Carregando…")).toBeInTheDocument();

    await responder(2, quadro("OP-900003"));
    expect(naTela("OP-900003")).toBe(true);
    await responder(1, quadro("OP-900002"));
    expect(naTela("OP-900002")).toBe(false);
    expect(naTela("OP-900003")).toBe(true);
  });

  it("falha: o alerta sem o quadro anterior e sem vazio falso; a recusa de validação fala as issues", async () => {
    await abrir();
    await responder(0, quadro("OP-900001"));

    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "RELEASED" } });
    await waitFor(() => expect(pedidos).toHaveLength(2));
    await act(async () => pedidos[1]!.recusar(new Error("Serviço indisponível.")));

    expect(screen.getByRole("alert")).toHaveTextContent("Serviço indisponível.");
    expect(naTela("OP-900001")).toBe(false);
    expect(secoes()).toBeNull();
    expect(screen.queryByText("Nenhuma ordem programada neste período.")).toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();

    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "PLANNED" } });
    await waitFor(() => expect(pedidos).toHaveLength(3));
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () =>
      pedidos[2]!.recusar(new ApiValidationError([{ path: "status", message: "Situação inválida." }])),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Situação inválida.");
    expect(screen.queryByText("Erro de validação")).toBeNull();
  });

  it("vazio real: só com a resposta do recorte", async () => {
    await abrir();
    expect(screen.queryByText("Nenhuma ordem programada neste período.")).toBeNull();
    await responder(0, quadro("OP-900001", { orders: [], unscheduled: [] }));
    expect(screen.getByText("Nenhuma ordem programada neste período.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma ordem aberta esperando programação.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("programar recarrega o MESMO recorte uma vez; o quadro some até a resposta nova, como antes", async () => {
    vi.mocked(previewProductionOrderSchedule).mockResolvedValue({
      schedule: {
        plannedStartAt: "2026-09-10T11:00:00.000Z",
        plannedEndAt: "2026-09-10T12:00:00.000Z",
        workingMinutes: 60,
        steps: [],
      },
      warnings: [],
    } as never);
    vi.mocked(scheduleProductionOrder).mockResolvedValue({} as never);

    await abrir();
    await responder(0, quadro("OP-900001"));

    fireEvent.click(screen.getByRole("button", { name: "Definir início previsto" }));
    fireEvent.change(screen.getByLabelText("Início previsto"), { target: { value: "2026-09-10T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    const confirmar = await screen.findByRole("button", { name: "Confirmar programação" });
    await waitFor(() => expect(confirmar).toBeEnabled());
    fireEvent.click(confirmar);

    await screen.findByText("Programação salva.");
    await waitFor(() => expect(pedidos).toHaveLength(2));
    expect(pedidos[1]!.params).toEqual(pedidos[0]!.params);
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(secoes()).toBeNull();

    await responder(1, quadro("OP-900009"));
    expect(naTela("OP-900009")).toBe(true);
    expect(naTela("OP-900001")).toBe(false);
    expect(pedidos).toHaveLength(2);
  });
});
