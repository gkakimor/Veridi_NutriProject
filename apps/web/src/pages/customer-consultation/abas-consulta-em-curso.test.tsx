import { useCallback } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes } from "react-router-dom";
import type { CustomerConsultationSummaryDTO, ProjectDTO } from "@veridi/shared";

/**
 * Abas da Visão do Cliente — `useScopedList` com a consulta das listagens
 * (LISTS-LOADING-STALE-DATA-02).
 *
 * A guarda de ordem já existia: a resposta de uma busca abandonada não
 * sobrescrevia a atual. O que faltava:
 *
 *   - trocar de cliente deixava as linhas do anterior na tabela até o novo
 *     responder;
 *   - a página voltava à 1 por efeito — o cliente novo saía primeiro com a
 *     página do anterior, numa consulta a mais;
 *   - a falha zerava as linhas e deixava o "Nenhum … encontrado para este
 *     cliente" junto do alerta, e a contagem "0 projetos" com a paginação.
 */

vi.mock("../../lib/customer-consultation-api", async (original) => ({
  ...(await original<object>()),
  getConsultationSummary: vi.fn(),
}));
vi.mock("../../lib/projects-api", async (original) => ({ ...(await original<object>()), listProjects: vi.fn() }));

import { getConsultationSummary } from "../../lib/customer-consultation-api";
import { listProjects } from "../../lib/projects-api";
import { consultationRoutes } from "./routes";
import { useScopedList } from "./useScopedList";

interface Pedido {
  customerId: string;
  page: number;
  pageSize: number;
  responder: (r: { rows: string[]; total: number }) => void;
  recusar: (e: unknown) => void;
}

let pendentes: Pedido[];

function montar(customerId: string) {
  return renderHook(
    ({ customerId: cliente }: { customerId: string }) => {
      const load = useCallback(
        (page: number, pageSize: number) =>
          new Promise<{ rows: string[]; total: number }>((responder, recusar) => {
            pendentes.push({ customerId: cliente, page, pageSize, responder, recusar });
          }),
        [cliente],
      );
      return useScopedList(load, cliente);
    },
    { initialProps: { customerId } },
  );
}

async function responder(indice: number, rows: string[], total = 45) {
  await act(async () => pendentes[indice]!.responder({ rows, total }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pendentes = [];
});

describe("useScopedList", () => {
  it("primeira carga: carregando, sem linhas, contagem nem erro — uma consulta, página 1", async () => {
    const { result } = montar("cli-a");
    expect(pendentes.map(({ customerId, page }) => ({ customerId, page }))).toEqual([
      { customerId: "cli-a", page: 1 },
    ]);
    expect(result.current).toMatchObject({ data: null, rows: [], total: 0, loading: true, error: null, page: 1 });

    await responder(0, ["PROJ-A1"]);
    expect(result.current).toMatchObject({ rows: ["PROJ-A1"], total: 45, totalPages: 3, loading: false });
    expect(result.current.data).not.toBeNull();
  });

  it("outro cliente fora da primeira página: nada do anterior enquanto carrega, e uma consulta só, na página 1", async () => {
    const { result, rerender } = montar("cli-a");
    await responder(0, ["PROJ-A1"]);
    act(() => result.current.setPage(3));
    expect(pendentes[1]).toMatchObject({ customerId: "cli-a", page: 3 });
    // Mesmo cliente, outra página: a aberta fica até a próxima chegar.
    expect(result.current).toMatchObject({ rows: ["PROJ-A1"], loading: true, page: 3 });
    await responder(1, ["PROJ-A3"]);

    rerender({ customerId: "cli-b" });
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]).toMatchObject({ customerId: "cli-b", page: 1 });
    expect(result.current).toMatchObject({ data: null, rows: [], total: 0, loading: true, page: 1 });

    await responder(2, ["PROJ-B1"]);
    expect(result.current).toMatchObject({ rows: ["PROJ-B1"], loading: false, page: 1 });
    expect(pendentes).toHaveLength(3);
  });

  it("clientes A, B e C respondendo C, B, A: só C vira tela", async () => {
    const { result, rerender } = montar("cli-a");
    rerender({ customerId: "cli-b" });
    rerender({ customerId: "cli-c" });
    expect(pendentes.map((pedido) => pedido.customerId)).toEqual(["cli-a", "cli-b", "cli-c"]);

    await responder(2, ["PROJ-C1"]);
    await responder(1, ["PROJ-B1"]);
    await responder(0, ["PROJ-A1"]);
    expect(result.current).toMatchObject({ rows: ["PROJ-C1"], loading: false, error: null });
  });

  it("falha: o erro, sem resposta — nem linhas de outro cliente ou página", async () => {
    const { result, rerender } = montar("cli-a");
    await responder(0, ["PROJ-A1"]);
    rerender({ customerId: "cli-b" });
    await act(async () => pendentes[1]!.recusar(new Error("Serviço indisponível.")));
    expect(result.current).toMatchObject({
      data: null,
      rows: [],
      total: 0,
      loading: false,
      error: "Serviço indisponível.",
    });
  });
});

/* ---------- a aba na tela ---------- */

const CLIENTE = "cli-a";

const resumo = {
  customer: {
    id: CLIENTE, code: "CLI-000001", legalName: "Vida Saudável Alimentos LTDA", tradeName: "Vida Saudável",
    cnpj: null, email: null, phone: null, active: true,
  },
  counts: {},
  commercial: { status: "ACTIVE", reason: "", customerSince: null },
  projectSummary: { open: 0, standBy: 0, approved: 0, cancelled: 0 },
} as unknown as CustomerConsultationSummaryDTO;

function projeto(code: string): ProjectDTO {
  return {
    id: code, code, name: "Linha Detox", customerId: CLIENTE, status: "IN_PROGRESS",
    entryDate: "2026-07-01T00:00:00.000Z", productName: null,
  } as unknown as ProjectDTO;
}

let consultas: { params: { page?: number }; responder: (r: unknown) => void; recusar: (e: unknown) => void }[];

async function abrirAba() {
  vi.mocked(listProjects).mockImplementation(
    (params) =>
      new Promise((responder, recusar) => {
        consultas.push({ params: params ?? {}, responder, recusar });
      }) as never,
  );
  render(
    <MemoryRouter initialEntries={[`/consultas/clientes/${CLIENTE}/projetos`]}>
      <Routes>{consultationRoutes}</Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /Vida Saudável Alimentos LTDA/ });
  await waitFor(() => expect(consultas).toHaveLength(1));
}

async function responderAba(indice: number, codes: string[], total: number) {
  await act(async () =>
    consultas[indice]!.responder({ projects: codes.map(projeto), page: 1, pageSize: 20, total }),
  );
}

describe("aba Projetos da Visão do Cliente", () => {
  beforeEach(() => {
    consultas = [];
    vi.mocked(getConsultationSummary).mockResolvedValue(resumo);
  });

  it("antes da resposta: carregando, sem contagem, paginação nem vazio", async () => {
    await abrirAba();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum projeto encontrado/)).toBeNull();
    expect(screen.queryByText(/^\d+ projetos?$/)).toBeNull();
    expect(screen.queryByText(/Página \d+ de \d+/)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await responderAba(0, ["PROJ-000001"], 45);
    expect(screen.getByText("PROJ-000001")).toBeInTheDocument();
    expect(screen.getByText("45 projetos")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(consultas).toHaveLength(1);
  });

  it("outra página: a aberta fica até a próxima chegar, numa consulta", async () => {
    await abrirAba();
    await responderAba(0, ["PROJ-000001"], 45);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(consultas).toHaveLength(2);
    expect(consultas[1]!.params).toMatchObject({ customerId: CLIENTE, page: 2 });
    expect(screen.getByText("PROJ-000001")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).toBeNull();

    await responderAba(1, ["PROJ-000021"], 45);
    expect(screen.queryByText("PROJ-000001")).toBeNull();
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
  });

  it("falha: o alerta, sem o vazio do cliente, sem contagem e sem paginação", async () => {
    await abrirAba();
    await act(async () => consultas[0]!.recusar(new Error("Serviço indisponível.")));

    expect(screen.getByRole("alert")).toHaveTextContent("Serviço indisponível.");
    expect(screen.queryByText(/Nenhum projeto encontrado/)).toBeNull();
    expect(screen.queryByText(/^\d+ projetos?$/)).toBeNull();
    expect(screen.queryByText(/Página \d+ de \d+/)).toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();
  });

  it("vazio real: a frase do cliente com a contagem zero", async () => {
    await abrirAba();
    await responderAba(0, [], 0);
    expect(screen.getByText("Nenhum projeto encontrado para este cliente.")).toBeInTheDocument();
    expect(screen.getByText("0 projetos")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(consultas).toHaveLength(1);
  });
});
