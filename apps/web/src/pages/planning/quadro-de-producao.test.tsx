import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductionBoardResponse } from "@veridi/shared";

/**
 * Planejamento de Produção na tela — PLANNING-CAPACITY-BOARD-01.
 *
 * O que está protegido aqui é a LEITURA do quadro: o recorte vive na URL, o
 * que falta configurar é dito em vez de virar tela vazia, e "capacidade não
 * cadastrada" nunca aparece como sobrecarga nem como zero.
 */

const getProductionBoard = vi.fn();
vi.mock("../../lib/production-schedules-api", () => ({
  getProductionBoard: (...a: unknown[]) => getProductionBoard(...a),
  getProductionOrderSchedule: vi.fn(),
  previewProductionOrderSchedule: vi.fn(),
  scheduleProductionOrder: vi.fn(),
  unscheduleProductionOrder: vi.fn(),
}));

vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [], page: 1, pageSize: 20, total: 0 }),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () =>
    Promise.resolve({ resources: [], page: 1, pageSize: 50, total: 0 }),
}));

const papel = vi.hoisted(() => ({ atual: "ADMIN" }));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Usuário", role: papel.atual } }),
}));

import { ProductionBoardPage } from "./ProductionBoardPage";

const QUADRO: ProductionBoardResponse = {
  from: "2026-09-07",
  to: "2026-09-13",
  view: "WEEK",
  calendarWarning: null,
  orders: [
    {
      productionOrderId: "op-1",
      code: "OP-000001",
      productCode: "PROD-1",
      productName: "Cápsulas A",
      plannedQuantity: "1000",
      outputUnitCode: "un",
      status: "PLANNED",
      plannedStartAt: "2026-09-07T11:00:00.000Z",
      plannedEndAt: "2026-09-07T15:00:00.000Z",
      workingMinutes: 180,
      warnings: [{ tipo: "SOBRECARGA", texto: "Mão de obra: 4 para capacidade 2." }],
    },
  ],
  unscheduled: [
    {
      productionOrderId: "op-2",
      code: "OP-000002",
      productCode: "PROD-2",
      productName: "Cápsulas B",
      plannedQuantity: "500",
      outputUnitCode: "un",
      status: "DRAFT",
      plannedStartAt: null,
      plannedEndAt: null,
      workingMinutes: null,
      warnings: [],
    },
  ],
  resources: [
    {
      industrialResourceId: "op",
      resourceCode: "RIN-000001",
      resourceName: "Mão de obra — Produção",
      resourceType: "LABOR",
      capacityQuantity: 2,
      plannedMinutes: 360,
      availableMinutes: 4800,
      situacao: "SOBRECARGA",
    },
    {
      industrialResourceId: "enc",
      resourceCode: "RIN-000002",
      resourceName: "Encapsuladora",
      resourceType: "EQUIPMENT",
      capacityQuantity: null,
      plannedMinutes: 120,
      availableMinutes: null,
      situacao: "CAPACIDADE_NAO_CADASTRADA",
    },
  ],
  conflicts: [
    {
      industrialResourceId: "op",
      resourceName: "Mão de obra — Produção",
      capacityQuantity: 2,
      demanda: 4,
      startAt: "2026-09-07T12:00:00.000Z",
      endAt: "2026-09-07T13:00:00.000Z",
      ordens: [{ productionOrderId: "op-1", productionOrderCode: "OP-000001" }],
    },
  ],
  pendencies: [
    {
      tipo: "SEM_ROTEIRO",
      productionOrderId: "op-7",
      code: "OP-000007",
      productCode: "PROD-7",
      productName: "Pó sabor limão",
      plannedQuantity: "2",
      outputUnitCode: "kg",
      status: "DRAFT",
      customerOrderId: "ped-3",
      customerOrderCode: "PED-000003",
      customerPromiseAt: "2026-09-20T00:00:00.000Z",
    },
  ],
  pendenciesTotal: 3,
};

function montar(rota = "/planejamento/quadro") {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <ProductionBoardPage />
    </MemoryRouter>,
  );
}

const css = () =>
  readFileSync(join(process.cwd(), "src", "pages", "planning", "planning.css"), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  papel.atual = "ADMIN";
  getProductionBoard.mockResolvedValue(QUADRO);
});

describe("Quadro de Planejamento de Produção", () => {
  it("abre na semana e mostra o que está previsto", async () => {
    montar();
    expect(
      await screen.findByRole("heading", { name: "Planejamento de Produção" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(getProductionBoard).toHaveBeenCalled());
    expect(getProductionBoard.mock.calls[0]![0]).toMatchObject({ view: "WEEK" });

    const programadas = screen.getByRole("region", { name: "Ordens programadas" });
    expect(within(programadas).getByText("OP-000001")).toBeInTheDocument();
    expect(within(programadas).getByText("Cápsulas A")).toBeInTheDocument();
  });

  it("capacidade não cadastrada é dita assim — nunca como zero nem sobrecarga", async () => {
    montar();
    const recursos = await screen.findByRole("region", { name: "Capacidade por recurso" });
    const linha = within(recursos).getByText("Encapsuladora").closest("tr") as HTMLElement;
    expect(within(linha).getAllByText("Capacidade não cadastrada").length).toBeGreaterThan(0);
    expect(within(linha).queryByText("Sobrecarga")).toBeNull();
    expect(linha.textContent).not.toContain("Sem capacidade");
  });

  it("sobrecarga aparece como aviso, com as ordens envolvidas", async () => {
    montar();
    const conflitos = await screen.findByRole("region", { name: "Conflitos de capacidade" });
    expect(within(conflitos).getByText(/4 em uso para capacidade 2/)).toBeInTheDocument();
    expect(within(conflitos).getByText(/OP-000001/)).toBeInTheDocument();
  });

  it("pendências de planejamento: OP sem roteiro com pedido, prazo e situação — Resolver leva ao roteiro da ordem", async () => {
    montar();
    const pendencias = await screen.findByRole("region", { name: "Pendências de planejamento" });
    const linha = within(pendencias).getByText("OP-000007").closest("tr") as HTMLElement;
    expect(within(linha).getByText("Sem roteiro")).toBeInTheDocument();
    expect(linha.textContent).toContain("Pó sabor limão");
    expect(linha.textContent).toContain("2 kg");
    expect(within(linha).getByRole("link", { name: "PED-000003" })).toHaveAttribute("href", "/comercial/pedidos/ped-3");
    expect(linha.textContent).toContain("20/09/2026");
    expect(linha.textContent).toContain("Rascunho");
    expect(within(linha).getByRole("link", { name: "Resolver" })).toHaveAttribute(
      "href",
      "/producao/ordens/op-7?foco=roteiro",
    );
    // Há mais do que as mostradas: o caminho para a lista inteira, já filtrada.
    expect(within(pendencias).getByRole("link", { name: /Ver todas/ })).toHaveAttribute(
      "href",
      "/producao/ordens?semRoteiro=1",
    );
  });

  it("Comercial vê as pendências, e não recebe a ação de resolver", async () => {
    papel.atual = "COMMERCIAL";
    montar();
    const pendencias = await screen.findByRole("region", { name: "Pendências de planejamento" });
    expect(within(pendencias).getByText("OP-000007")).toBeInTheDocument();
    expect(within(pendencias).queryByRole("link", { name: "Resolver" })).toBeNull();
  });

  it("ordem sem programação fica numa faixa própria, com a ação de programar", async () => {
    montar();
    const sem = await screen.findByRole("region", { name: "Sem programação" });
    expect(within(sem).getByText("OP-000002")).toBeInTheDocument();
    expect(
      within(sem).getByRole("button", { name: "Definir início previsto" }),
    ).toBeInTheDocument();
  });

  it("o recorte e os filtros vivem na URL — o quadro é compartilhável", async () => {
    montar("/planejamento/quadro?view=DAY&dia=2026-09-10&status=PLANNED");
    await waitFor(() => expect(getProductionBoard).toHaveBeenCalled());
    expect(getProductionBoard.mock.calls[0]![0]).toMatchObject({
      view: "DAY",
      from: "2026-09-10",
      to: "2026-09-10",
      status: "PLANNED",
    });

    // Trocar a visão recarrega com o novo recorte, sem inventar outro dia.
    getProductionBoard.mockClear();
    fireEvent.change(screen.getByLabelText("Visão"), { target: { value: "WEEK" } });
    await waitFor(() => expect(getProductionBoard).toHaveBeenCalled());
    expect(getProductionBoard.mock.calls[0]![0]).toMatchObject({
      view: "WEEK",
      from: "2026-09-07",
      to: "2026-09-13",
    });
  });

  it("calendário incompleto é dito, e o quadro continua mostrando o que há", async () => {
    getProductionBoard.mockResolvedValue({
      ...QUADRO,
      calendarWarning: "Defina o horário do intervalo antes de calcular horários de produção.",
    });
    montar();
    expect(
      await screen.findByText(/Defina o horário do intervalo/),
    ).toBeInTheDocument();
    expect(screen.getByText("OP-000001")).toBeInTheDocument();
  });

  it("em tela estreita o seletor de período empilha, sem rolagem lateral", () => {
    const folha = css();
    const estreita = folha.slice(folha.lastIndexOf("@media (max-width: 720px)"));
    expect(estreita).toContain(".board-period");
    expect(estreita).toContain("width: 100%");
    // As tabelas do quadro ficam dentro do próprio container de rolagem.
    const { container } = montar();
    for (const tabela of container.querySelectorAll("table")) {
      expect(tabela.closest(".table-container")).not.toBeNull();
    }
  });
});
