import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { InternalConsumptionDTO, InternalConsumptionReportDTO, ItemDTO } from "@veridi/shared";

/**
 * R-21 — Uso e consumo na tela (INTERNAL-CONSUMPTION-REPORT-01).
 *
 * A conta é do servidor (`api modules/reports/r21-uso-e-consumo.test.ts`). O
 * que cabe à tela: mandar cada filtro, escrever o custo desconhecido como
 * "Custo não disponível" — nunca R$ 0,00 —, dizer ao lado do valor total o que
 * ele não contém, e levar ao CSV e ao PDF o mesmo recorte da tabela.
 */

vi.mock("../../lib/reports-api", () => ({
  getInternalConsumptionReport: vi.fn(),
  getInternalConsumptionReportFilterOptions: vi.fn(),
}));
vi.mock("../../lib/items-api", async (original) => ({ ...(await original<object>()), listItems: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "VIEWER" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", name: "Ana", role: "VIEWER" } }),
}));

import { listItems } from "../../lib/items-api";
import { getInternalConsumptionReport, getInternalConsumptionReportFilterOptions } from "../../lib/reports-api";
import { InternalConsumptionReportPage } from "./InternalConsumptionReport";

const ITENS = [
  { id: "item-luva", code: "UC-000001", name: "Luva nitrílica", unitCode: "un", type: "INTERNAL_CONSUMABLE", active: true },
  { id: "item-copo", code: "UC-000002", name: "Copo descartável", unitCode: "un", type: "INTERNAL_CONSUMABLE", active: false },
] as unknown as ItemDTO[];

function consumo(extra: Partial<InternalConsumptionDTO>): InternalConsumptionDTO {
  return {
    id: "ci-1",
    code: "CI-000001",
    itemId: "item-luva",
    itemCode: "UC-000001",
    itemName: "Luva nitrílica",
    itemType: "INTERNAL_CONSUMABLE",
    lotId: null,
    lotCode: null,
    quantity: "10",
    uomCode: "un",
    occurredAt: "2026-09-10T15:00:00.000Z",
    purpose: "Escritório",
    notes: null,
    unitCost: "1.5",
    totalCost: "15",
    costSource: "REAL",
    costDetails: null,
    inventoryMovementId: "mov-1",
    registeredByUserId: "user-ana",
    registeredByName: "Ana Souza",
    createdAt: "2026-09-10T15:00:00.000Z",
    ...extra,
  };
}

const COM_E_SEM_CUSTO: InternalConsumptionReportDTO = {
  rows: [
    consumo({}),
    consumo({
      id: "ci-2",
      code: "CI-000002",
      itemId: "item-copo",
      itemCode: "UC-000002",
      itemName: "Copo descartável",
      quantity: "3",
      purpose: null,
      unitCost: null,
      totalCost: null,
      costSource: "NO_COST",
      registeredByUserId: "user-bruno",
      registeredByName: "Bruno Lima",
    }),
  ],
  page: 1,
  pageSize: 25,
  total: 2,
  summary: { consumptionCount: 2, knownCostCount: 1, missingCostCount: 1, knownCostTotal: "15", distinctItemCount: 2 },
  byItem: [
    {
      itemId: "item-luva", itemCode: "UC-000001", itemName: "Luva nitrílica", uomCode: "un",
      consumptionCount: 1, quantity: "10", knownCostTotal: "15", missingCostCount: 0,
    },
    {
      itemId: "item-copo", itemCode: "UC-000002", itemName: "Copo descartável", uomCode: "un",
      consumptionCount: 1, quantity: "3", knownCostTotal: null, missingCostCount: 1,
    },
  ],
  byPurpose: [
    { purpose: "Escritório", consumptionCount: 1, knownCostTotal: "15", missingCostCount: 0 },
    { purpose: null, consumptionCount: 1, knownCostTotal: null, missingCostCount: 1 },
  ],
};

function Destino() {
  const location = useLocation();
  return <p data-testid="destino">{`${location.pathname}${location.search}`}</p>;
}

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/relatorios/estoque/uso-e-consumo"]}>
      <Routes>
        <Route path="/relatorios/estoque/uso-e-consumo" element={<InternalConsumptionReportPage />} />
        <Route path="/print/relatorios/:code" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ultimaConsulta(): Record<string, unknown> {
  const chamadas = vi.mocked(getInternalConsumptionReport).mock.calls;
  return (chamadas[chamadas.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

/** Filtros de uma URL, sem paginação — o CSV e o PDF levam o recorte inteiro. */
function filtrosDa(url: string): Record<string, string> {
  const params = new URL(url, "http://exemplo.invalid").searchParams;
  return Object.fromEntries([...params.entries()].filter(([chave]) => chave !== "page" && chave !== "pageSize"));
}

/** Texto como se lê: o espaço fixo do "R$" vira espaço comum. */
function texto(no: Element | null | undefined): string {
  return (no?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** O valor de um KPI pelo rótulo dele. */
function kpi(rotulo: string): string {
  const item = screen.getByText(rotulo, { selector: ".report-summary__label" }).closest(".report-summary__item");
  return texto(item?.querySelector(".report-summary__value"));
}

/** Células de texto de cada linha do corpo da tabela de detalhe. */
function linhasDoDetalhe(): string[][] {
  const tabela = screen.getByRole("columnheader", { name: "Custo unitário" }).closest("table")!;
  return within(tabela)
    .getAllByRole("row")
    .slice(1)
    .map((linha) => within(linha).getAllByRole("cell").map(texto));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getInternalConsumptionReport).mockResolvedValue(COM_E_SEM_CUSTO);
  vi.mocked(getInternalConsumptionReportFilterOptions).mockResolvedValue({
    purposes: ["Escritório", "Limpeza"],
    users: [
      { id: "user-ana", name: "Ana Souza" },
      { id: "user-bruno", name: "Bruno Lima" },
    ],
  });
  vi.mocked(listItems).mockImplementation(async (filtro) => ({
    items: ITENS.filter(
      (item) => filtro?.type === item.type && (!filtro?.ids || filtro.ids.includes(item.id)),
    ),
    page: 1,
    pageSize: 50,
    total: ITENS.length,
  }));
});

describe("R-21 — KPIs, custo desconhecido e resumos", () => {
  it("KPIs do recorte, com o valor parcial dito ao lado do total", async () => {
    abrir();
    await screen.findByText("Valor total conhecido");

    expect(kpi("Consumos")).toBe("2");
    expect(kpi("Valor total conhecido")).toBe("R$ 15,00");
    expect(kpi("Consumos sem custo")).toBe("1");
    expect(kpi("Itens distintos")).toBe("2");
    expect(screen.getByRole("note")).toHaveTextContent(
      "Valor parcial: 1 consumo com custo não disponível não entra na soma.",
    );
    // Nenhum custo desconhecido virou zero em lugar nenhum da tela.
    expect(texto(document.body)).not.toContain("R$ 0,00");
  });

  it("recorte só sem custo: o total é \"Custo não disponível\" e o aviso diz que é desconhecido", async () => {
    vi.mocked(getInternalConsumptionReport).mockResolvedValue({
      ...COM_E_SEM_CUSTO,
      rows: [COM_E_SEM_CUSTO.rows[1]!],
      total: 1,
      summary: { consumptionCount: 1, knownCostCount: 0, missingCostCount: 1, knownCostTotal: null, distinctItemCount: 1 },
      byItem: [COM_E_SEM_CUSTO.byItem[1]!],
      byPurpose: [COM_E_SEM_CUSTO.byPurpose[1]!],
    });
    abrir();
    await screen.findByText("Valor total conhecido");

    expect(kpi("Valor total conhecido")).toBe("Custo não disponível");
    expect(screen.getByRole("note")).toHaveTextContent(
      "Nenhum consumo do recorte tem custo conhecido: o valor total é desconhecido, não R$ 0,00.",
    );
  });

  it("recorte todo com custo: nenhum aviso de valor parcial", async () => {
    vi.mocked(getInternalConsumptionReport).mockResolvedValue({
      ...COM_E_SEM_CUSTO,
      rows: [COM_E_SEM_CUSTO.rows[0]!],
      total: 1,
      summary: { consumptionCount: 1, knownCostCount: 1, missingCostCount: 0, knownCostTotal: "15", distinctItemCount: 1 },
    });
    abrir();
    await screen.findByText("Valor total conhecido");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("tabela: as colunas pedidas, e custo desconhecido escrito como \"Custo não disponível\"", async () => {
    abrir();
    await screen.findByText("CI-000002");

    expect(linhasDoDetalhe()).toEqual([
      ["10/09/2026", "CI-000001", expect.stringContaining("UC-000001"), "10", "un", "Escritório", "R$ 1,50",
        "R$ 15,00", "Real", "Ana Souza"],
      ["10/09/2026", "CI-000002", expect.stringContaining("UC-000002"), "3", "un", "—", "Custo não disponível",
        "Custo não disponível", "Sem custo", "Bruno Lima"],
    ]);
  });

  it("resumo por item e por destino/uso, com o destino vazio nomeado", async () => {
    abrir();
    const porItem = (await screen.findByRole("heading", { name: "Resumo por item" })).closest("section")!;
    const porDestino = screen.getByRole("heading", { name: "Resumo por destino/uso" }).closest("section")!;

    const linhas = (secao: HTMLElement) =>
      within(secao)
        .getAllByRole("row")
        .slice(1)
        .map((linha) => within(linha).getAllByRole("cell").map(texto));

    expect(linhas(porItem)).toEqual([
      [expect.stringContaining("UC-000001"), "1", "10 un", "R$ 15,00", "0"],
      [expect.stringContaining("UC-000002"), "1", "3 un", "Custo não disponível", "1"],
    ]);
    expect(linhas(porDestino)).toEqual([
      ["Escritório", "1", "R$ 15,00", "0"],
      ["Sem destino informado", "1", "Custo não disponível", "1"],
    ]);
  });

  it("sem consumo no recorte: nem KPIs nem resumos, só o vazio da tabela", async () => {
    vi.mocked(getInternalConsumptionReport).mockResolvedValue({
      rows: [],
      page: 1,
      pageSize: 25,
      total: 0,
      summary: { consumptionCount: 0, knownCostCount: 0, missingCostCount: 0, knownCostTotal: null, distinctItemCount: 0 },
      byItem: [],
      byPurpose: [],
    });
    abrir();
    await screen.findByText("Nenhum consumo para os filtros informados.");
    expect(screen.queryByText("Valor total conhecido")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Resumo por item" })).toBeNull();
  });
});

describe("R-21 — filtros e exportação", () => {
  it("cada filtro vai à consulta e volta à página 1; destino e usuário vêm dos próprios consumos", async () => {
    vi.mocked(getInternalConsumptionReport).mockImplementation(async (filtros) => ({
      ...COM_E_SEM_CUSTO,
      page: Number(filtros["page"] ?? 1),
      total: 60,
    }));
    abrir();
    await screen.findByText("CI-000002");

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ page: 2 }));

    const destino = screen.getByLabelText("Destino/uso");
    await within(destino).findByRole("option", { name: "Limpeza" });
    fireEvent.change(destino, { target: { value: "Limpeza" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ purpose: "Limpeza", page: 1 }));

    const usuario = screen.getByLabelText("Usuário");
    expect(within(usuario).getAllByRole("option").map((opcao) => opcao.textContent)).toEqual([
      "Todos os usuários",
      "Ana Souza",
      "Bruno Lima",
    ]);
    fireEvent.change(usuario, { target: { value: "user-bruno" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ registeredByUserId: "user-bruno", page: 1 }));

    fireEvent.change(screen.getByLabelText("Origem do custo"), { target: { value: "NO_COST" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ costSource: "NO_COST" }));

    fireEvent.change(screen.getByLabelText("Custo"), { target: { value: "false" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ hasCost: "false" }));

    // Item de uso e consumo: da primeira página do seletor, que pede o TIPO ao servidor.
    const campoDoItem = document.getElementById("ci-item")!;
    fireEvent.focus(campoDoItem);
    await act(async () => {});
    expect(vi.mocked(listItems)).toHaveBeenCalledWith(expect.objectContaining({ type: "INTERNAL_CONSUMABLE" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /^UC-000001/ }));
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ itemId: "item-luva", page: 1 }));

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar consumo" }), { target: { value: "CI-000002" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "CI-000002", page: 1 }));

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("até"), { target: { value: "2026-09-15" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ from: "2026-09-01", to: "2026-09-15" }));

    expect(ultimaConsulta()).toMatchObject({
      purpose: "Limpeza",
      registeredByUserId: "user-bruno",
      costSource: "NO_COST",
      hasCost: "false",
      itemId: "item-luva",
      search: "CI-000002",
    });
  });

  it("o CSV e o PDF levam o recorte da tabela, sem a página", async () => {
    abrir();
    await screen.findByText("CI-000002");
    const destino = screen.getByLabelText("Destino/uso");
    await within(destino).findByRole("option", { name: "Escritório" });

    fireEvent.change(destino, { target: { value: "Escritório" } });
    fireEvent.change(screen.getByLabelText("Custo"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("até"), { target: { value: "2026-09-30" } });
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ purpose: "Escritório", hasCost: "true", from: "2026-09-01", to: "2026-09-30" }),
    );

    const recorte = { purpose: "Escritório", hasCost: "true", from: "2026-09-01", to: "2026-09-30" };
    const csv = (await screen.findByRole("link", { name: "Exportar CSV" })).getAttribute("href") ?? "";
    expect(new URL(csv, "http://exemplo.invalid").pathname).toBe("/reports/inventory/internal-consumption/export.csv");
    expect(filtrosDa(csv)).toEqual(recorte);

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    const pdf = (await screen.findByTestId("destino")).textContent ?? "";
    expect(pdf.startsWith("/print/relatorios/R-21?")).toBe(true);
    expect(filtrosDa(pdf)).toEqual(recorte);
  });

  it("período invertido: nada é consultado e o CSV e o PDF não se oferecem", async () => {
    abrir();
    await screen.findByText("CI-000002");
    const consultas = vi.mocked(getInternalConsumptionReport).mock.calls.length;

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("até"), { target: { value: "2026-09-01" } });
    await screen.findByRole("alert");

    expect(vi.mocked(getInternalConsumptionReport).mock.calls.length).toBe(consultas);
    expect(screen.queryByRole("link", { name: "Exportar CSV" })).toBeNull();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
  });
});
