import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, useNavigate } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import type { CustomerConsultationSummaryDTO } from "@veridi/shared";

/**
 * Visão do Cliente: trocar de cliente pela mesma rota consulta a aba uma vez
 * (CONSULTATION-CUSTOMER-SWITCH-QUERY-01).
 *
 * O shell apagava o resumo por efeito. No render da rota nova a aba ainda
 * montava com o resumo antigo e consultava o cliente novo; o shell a tirava
 * para carregar e ela consultava de novo ao voltar — duas consultas por troca.
 */

vi.mock("../../lib/customer-consultation-api", async (original) => ({
  ...(await original<object>()),
  getConsultationSummary: vi.fn(),
}));
vi.mock("../../lib/projects-api", async (original) => ({ ...(await original<object>()), listProjects: vi.fn() }));

import { getConsultationSummary } from "../../lib/customer-consultation-api";
import { listProjects } from "../../lib/projects-api";
import { consultationRoutes } from "./routes";

function resumo(id: string, legalName: string) {
  return {
    customer: { id, code: `CLI-${id}`, legalName, tradeName: null, cnpj: null, email: null, phone: null, active: true },
    counts: {},
    commercial: { status: "ACTIVE", reason: "", customerSince: null },
    projectSummary: { open: 0, standBy: 0, approved: 0, cancelled: 0 },
  } as unknown as CustomerConsultationSummaryDTO;
}

let navegar: NavigateFunction;
function Navegador() {
  navegar = useNavigate();
  return null;
}

let resumos: Record<string, (r: CustomerConsultationSummaryDTO) => void>;

beforeEach(() => {
  vi.clearAllMocks();
  resumos = {};
  vi.mocked(getConsultationSummary).mockImplementation(
    (id: string) => new Promise((responder) => (resumos[id] = responder)),
  );
  vi.mocked(listProjects).mockImplementation(() => new Promise(() => {}) as never);
});

const clientesConsultados = () => vi.mocked(listProjects).mock.calls.map(([params]) => params?.customerId);

describe("Visão do Cliente — troca de cliente", () => {
  it("de A para B pela mesma aba: uma consulta de B, só depois do resumo de B", async () => {
    render(
      <MemoryRouter initialEntries={["/consultas/clientes/cli-a/projetos"]}>
        <Navegador />
        <Routes>{consultationRoutes}</Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(resumos["cli-a"]).toBeDefined());
    await act(async () => resumos["cli-a"]!(resumo("cli-a", "Alfa Nutrição LTDA")));
    await screen.findByRole("heading", { level: 1, name: "Alfa Nutrição LTDA" });
    expect(clientesConsultados()).toEqual(["cli-a"]);

    act(() => navegar("/consultas/clientes/cli-b/projetos"));

    // Resumo de B pendente: nada de A à vista, e a aba não consultou B.
    expect(screen.queryByRole("heading", { level: 1, name: "Alfa Nutrição LTDA" })).toBeNull();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    await waitFor(() => expect(resumos["cli-b"]).toBeDefined());
    expect(clientesConsultados()).toEqual(["cli-a"]);

    await act(async () => resumos["cli-b"]!(resumo("cli-b", "Beta Suplementos LTDA")));
    await screen.findByRole("heading", { level: 1, name: "Beta Suplementos LTDA" });
    await act(async () => {});
    expect(clientesConsultados()).toEqual(["cli-a", "cli-b"]);
  });

  it("resposta atrasada do cliente que saiu não vira o cabeçalho do atual", async () => {
    render(
      <MemoryRouter initialEntries={["/consultas/clientes/cli-a/projetos"]}>
        <Navegador />
        <Routes>{consultationRoutes}</Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(resumos["cli-a"]).toBeDefined());
    act(() => navegar("/consultas/clientes/cli-b/projetos"));
    await waitFor(() => expect(resumos["cli-b"]).toBeDefined());

    await act(async () => resumos["cli-b"]!(resumo("cli-b", "Beta Suplementos LTDA")));
    await act(async () => resumos["cli-a"]!(resumo("cli-a", "Alfa Nutrição LTDA")));

    expect(screen.getByRole("heading", { level: 1, name: "Beta Suplementos LTDA" })).toBeInTheDocument();
    expect(screen.queryByText("Alfa Nutrição LTDA")).toBeNull();
    expect(clientesConsultados()).toEqual(["cli-b"]);
  });
});
