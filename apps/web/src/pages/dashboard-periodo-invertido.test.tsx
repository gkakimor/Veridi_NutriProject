import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DashboardDTO } from "@veridi/shared";

/**
 * Painel — período invertido é aviso, não "zero resultados"
 * (DASHBOARD-INVERTED-PERIOD-01).
 *
 * "De" vazio com "Até" no passado ia à API como `from=` e `to=<passado>`; o
 * servidor lia a ponta vazia como hoje e devolvia 200 com todos os KPIs em zero.
 * Agora a tela compara as pontas com a mesma regra do servidor
 * (`recusaDoPeriodoDoPainel`, com o hoje comercial): período recusado não vira
 * pedido, a frase aparece junto dos campos, e os blocos do período saem da tela
 * — o estado atual, que não depende do período, fica. Se ainda assim o servidor
 * recusar, a frase dele chega à faixa de erro. A recusa na API está em
 * `api modules/dashboard/dashboard-periodo-invertido.test.ts`.
 */

vi.mock("../lib/dashboard-api", () => ({ getDashboard: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
}));

import { getDashboard } from "../lib/dashboard-api";
import { ApiValidationError } from "../lib/api-errors";
import { DashboardPage } from "./DashboardPage";

const DATA_INICIAL_DEPOIS = "A data inicial não pode ser posterior à data final.";
const SEM_DATA_INICIAL = "Sem data inicial, o período começa hoje — a data final não pode ser anterior a hoje.";
const SEM_DATA_FINAL = "Sem data final, o período termina hoje — a data inicial não pode ser posterior a hoje.";

/** 12:00 de 13/09 em São Paulo: o Personalizado abre em 07/09 a 13/09. */
const AGORA = new Date("2026-09-13T15:00:00.000Z");

const DASHBOARD = {
  period: {
    from: "2026-09-07T03:00:00.000Z",
    to: "2026-09-14T02:59:59.999Z",
    customerOrdersCreated: 4,
    receiptsCompleted: 0,
    productionOrdersCompleted: 0,
    shipmentsConfirmed: 0,
    billingsIssued: 0,
    billedAmount: null,
    billingsWithCompletePricing: 0,
  },
  currentState: {
    commercial: {
      confirmedOrders: 0,
      inFulfillmentOrders: 0,
      partiallyShippedOrders: 0,
      ordersAwaitingShipment: 0,
      shipmentsAwaitingBilling: 0,
    },
    production: {
      draft: 0,
      planned: 0,
      released: 0,
      inProduction: 0,
      withShortage: 0,
      completedWithIncompleteCost: 0,
      withoutRoute: 0,
    },
    purchasing: { openOrders: 0, partiallyReceived: 0, lateOrders: 0, itemsOnOrder: 0 },
    inventory: { lotsAwaitingQuality: 0, lotsBlocked: 0, lotsExpired: 0, lotsNearExpiry: 0 },
  },
  attention: [],
  attentionGroups: [],
  attentionTotal: 0,
  attentionLimit: 20,
  movementSummary: {
    receiptIn: 0,
    productionConsumption: 0,
    sampleConsumption: 0,
    finishedGoodProduction: 0,
    shipmentOut: 0,
    adjustments: 0,
    loss: 0,
  },
  recentMovements: [],
  movementActivity: [],
} as unknown as DashboardDTO;

function pedidos(): [string, string][] {
  return vi.mocked(getDashboard).mock.calls.map(([from, to]) => [from, to]);
}

/** Abre o Painel já no Personalizado, com os dados da primeira consulta na tela. */
async function abrirPersonalizado() {
  const tela = render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
  await waitFor(() => expect(pedidos().at(-1)).toEqual(["2026-09-07", "2026-09-13"]));
  expect(await screen.findByRole("heading", { name: "No período" })).toBeInTheDocument();
  return tela;
}

function datas(de: string, ate: string) {
  fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: de } });
  fireEvent.change(screen.getByLabelText("Data final"), { target: { value: ate } });
}

/** Deixa efeitos e promessas pendentes terminarem — para afirmar que um pedido NÃO saiu. */
async function assentar() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Período aceito: pediu à API o par, sem aviso, com os blocos do período na tela. */
async function esperarConsulta(par: [string, string]) {
  await waitFor(() => expect(pedidos().at(-1)).toEqual(par));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Data inicial")).not.toHaveAttribute("aria-invalid");
  expect(await screen.findByRole("heading", { name: "No período" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Movimentações" })).toBeInTheDocument();
}

/** Período recusado: nenhum pedido novo, a frase junto dos campos, blocos do período fora. */
async function esperarRecusa(frase: string, pedidosAntes: number) {
  await assentar();
  expect(pedidos()).toHaveLength(pedidosAntes);
  expect(screen.getByRole("alert")).toHaveTextContent(frase);
  for (const campo of ["Data inicial", "Data final"]) {
    expect(screen.getByLabelText(campo)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(campo)).toHaveAccessibleDescription(frase);
  }
  expect(screen.queryByRole("heading", { name: "No período" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Movimentações" })).not.toBeInTheDocument();
  expect(screen.queryByText(/— contagem de documentos/)).not.toBeInTheDocument();
  // O estado atual não depende do período e continua.
  expect(screen.getByRole("heading", { name: "Precisa de atenção" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Operação atual" })).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboard).mockResolvedValue(DASHBOARD);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("as duas datas preenchidas", () => {
  it("De antes de Até e o mesmo dia: consulta, sem aviso", async () => {
    await abrirPersonalizado();
    datas("2026-09-12", "2026-09-13");
    await esperarConsulta(["2026-09-12", "2026-09-13"]);
    datas("2026-09-12", "2026-09-12");
    await esperarConsulta(["2026-09-12", "2026-09-12"]);
  });

  it("De depois de Até: aviso, nenhuma consulta, e corrigir volta a consultar", async () => {
    await abrirPersonalizado();
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-09-13" } });
    await waitFor(() => expect(pedidos().at(-1)).toEqual(["2026-09-13", "2026-09-13"]));
    const antes = pedidos().length;

    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-09-12" } });
    await esperarRecusa(DATA_INICIAL_DEPOIS, antes);

    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-09-11" } });
    await esperarConsulta(["2026-09-11", "2026-09-12"]);
  });
});

describe("campos vazios — ponta vazia é hoje, e com ele se compara", () => {
  it("as duas vazias: hoje a hoje, sem aviso", async () => {
    await abrirPersonalizado();
    datas("", "");
    await esperarConsulta(["", ""]);
  });

  it("De vazio e Até hoje: consulta", async () => {
    await abrirPersonalizado();
    datas("", "2026-09-13");
    await esperarConsulta(["", "2026-09-13"]);
  });

  it("De vazio e Até no passado: aviso que conta de onde veio o hoje, e nenhuma consulta", async () => {
    await abrirPersonalizado();
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "" } });
    await waitFor(() => expect(pedidos().at(-1)).toEqual(["", "2026-09-13"]));
    const antes = pedidos().length;

    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-09-12" } });
    await esperarRecusa(SEM_DATA_INICIAL, antes);
  });

  it("De no passado e Até vazio: consulta até hoje", async () => {
    await abrirPersonalizado();
    datas("2026-09-01", "");
    await esperarConsulta(["2026-09-01", ""]);
  });

  it("De no futuro e Até vazio: aviso da data final", async () => {
    await abrirPersonalizado();
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "" } });
    await waitFor(() => expect(pedidos().at(-1)).toEqual(["2026-09-07", ""]));
    const antes = pedidos().length;

    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-09-14" } });
    await esperarRecusa(SEM_DATA_FINAL, antes);
  });

  it("às 01:30 UTC hoje ainda é 12/09 — De vazio e Até 12/09 consulta em UTC, UTC-07 e São Paulo; Até 11/09 é aviso", async () => {
    vi.setSystemTime(new Date("2026-09-13T01:30:00.000Z"));
    const original = process.env.TZ;
    try {
      for (const [fuso, deslocamento] of [["UTC", 0], ["Etc/GMT+7", 420], ["America/Sao_Paulo", 180]] as const) {
        process.env.TZ = fuso;
        // Sem isto o teste passaria sem nunca ter mudado de fuso.
        expect(new Date("2026-09-12T12:00:00.000Z").getTimezoneOffset()).toBe(deslocamento);
        vi.mocked(getDashboard).mockClear();
        const { unmount } = render(
          <MemoryRouter>
            <DashboardPage />
          </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
        // Pelo dia do navegador em UTC (13/09), "Até 12/09" seria aviso.
        datas("", "2026-09-12");
        await esperarConsulta(["", "2026-09-12"]);
        const antes = pedidos().length;
        fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-09-11" } });
        await esperarRecusa(SEM_DATA_INICIAL, antes);
        unmount();
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("o servidor é a autoridade", () => {
  it("se ele recusar o período, a faixa mostra a frase dele — não \"Erro de validação\"", async () => {
    await abrirPersonalizado();
    vi.mocked(getDashboard).mockRejectedValueOnce(
      new ApiValidationError([{ path: "to", message: SEM_DATA_INICIAL }]),
    );
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(SEM_DATA_INICIAL);
    expect(screen.queryByText("Erro de validação")).not.toBeInTheDocument();
  });
});
