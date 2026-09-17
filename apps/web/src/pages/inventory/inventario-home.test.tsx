import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { UserRole } from "@veridi/shared";
import { USER_ROLES } from "@veridi/shared";
import { resumo } from "./testing/inventario-fixtures";

/**
 * Estoque → Inventário Físico — a lista (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * Abre em "Em aberto" (em contagem + em revisão), só inventários; Divergências
 * sem revelação é "—", nunca zero; e as ações de escrita — Novo inventário,
 * Contagem rápida, Contar — existem só para quem opera inventário, pela mesma
 * lista que a API aplica.
 */

let papel: UserRole = "ADMIN";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/stock-counts-api", () => ({ listStockCounts: vi.fn() }));

import { listStockCounts } from "../../lib/stock-counts-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { StockCountsHomePage } from "./StockCountsHomePage";

const OPERAM: UserRole[] = ["ADMIN", "PRODUCTION", "QUALITY"];

function abrir(url = "/estoque/inventario") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/estoque/inventario" element={<StockCountsHomePage />} />
        <Route path="/estoque/inventario/novo" element={<h1>Novo inventário (tela)</h1>} />
        <Route path="/estoque/inventario/:id/contagem" element={<h1>Contagem (tela)</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const ultimaConsulta = () => vi.mocked(listStockCounts).mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  // A aba e o recorte são lembrados por usuário na sessão: cada caso começa do padrão.
  clearStoredFilters("u-1", "stock-counts");
  papel = "ADMIN";
  vi.mocked(listStockCounts).mockResolvedValue({
    stockCounts: [
      resumo({ countedCount: 51, positionCount: 91, divergentCount: null }),
      resumo({
        id: "inv-2",
        code: "INV-000013",
        mode: "ASSISTED",
        status: "IN_REVIEW",
        description: "Embalagens",
        countedCount: 40,
        positionCount: 40,
        divergentCount: 3,
      }),
    ],
    page: 1,
    pageSize: 20,
    total: 2,
  });
});

describe("lista de inventários", () => {
  it("abre em Em aberto: em contagem e em revisão, só inventários de sessão", async () => {
    abrir();
    await screen.findByText("INV-000014");
    expect(ultimaConsulta()).toMatchObject({ kind: "SESSION", status: ["IN_PROGRESS", "IN_REVIEW"], page: 1 });
    expect(screen.getByLabelText("Filtrar por situação")).toHaveValue("em-aberto");
  });

  it("progresso por contagem e divergências escondidas como —, nunca zero", async () => {
    abrir();
    const linhaCega = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    expect(within(linhaCega).getByText("51 / 91 · 56%")).toBeInTheDocument();
    expect(within(linhaCega).getByText("—")).toBeInTheDocument();
    expect(within(linhaCega).queryByText("0")).toBeNull();
    const linhaRevelada = screen.getByText("INV-000013").closest("tr") as HTMLElement;
    expect(within(linhaRevelada).getByText("3")).toBeInTheDocument();
    expect(within(linhaRevelada).getByText("Em revisão")).toBeInTheDocument();
  });

  it("a aba de contagens rápidas consulta o documento QUICK, sem recorte de situação", async () => {
    abrir();
    await screen.findByText("INV-000014");
    fireEvent.click(screen.getByRole("tab", { name: "Contagens rápidas" }));
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ kind: "QUICK" }));
    expect(ultimaConsulta()).not.toHaveProperty("status");
  });

  it("contagem rápida em uma linha: INV-, data, item, lote, dono, contado, sistema, diferença, ajuste e autor (Fatia 2B)", async () => {
    const rapida = (codigo: string, sobre: Partial<NonNullable<ReturnType<typeof resumo>["quickResult"]>>) =>
      resumo({
        id: codigo,
        code: codigo,
        kind: "QUICK",
        mode: "ASSISTED",
        status: "COMPLETED",
        description: null,
        quickResult: {
          positionId: `pos-${codigo}`,
          itemId: "item-1",
          itemCode: "MP-000431",
          itemName: "Vitamina C",
          unitCode: "kg",
          lotId: "lote-1",
          lotCode: "LT-000118",
          ownerType: "CUSTOMER",
          ownerCustomerCode: "CLI-000003",
          ownerCustomerName: "Nutrifarm",
          countedQuantity: "12",
          systemQuantity: "12.5",
          difference: "-0.5",
          adjustmentMovementId: "mov-1",
          adjustmentType: "ADJUSTMENT_OUT",
          adjustmentQuantity: "0.5",
          reason: "Quebra",
          countedByName: "Bruno Produção",
          ...sobre,
        },
      });
    vi.mocked(listStockCounts).mockResolvedValue({
      stockCounts: [
        rapida("INV-000120", {}),
        rapida("INV-000121", {
          lotId: null,
          lotCode: null,
          ownerType: "VERIDI",
          ownerCustomerCode: null,
          ownerCustomerName: null,
          countedQuantity: "3",
          systemQuantity: "3",
          difference: "0",
          adjustmentMovementId: null,
          adjustmentType: null,
          adjustmentQuantity: null,
          countedByName: "Carla Qualidade",
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    abrir();
    fireEvent.click(await screen.findByRole("tab", { name: "Contagens rápidas" }));
    const cabecalho = await screen.findByRole("columnheader", { name: "Ajuste" });
    const titulos = within(cabecalho.closest("tr") as HTMLElement)
      .getAllByRole("columnheader")
      .map((coluna) => coluna.textContent);
    expect(titulos).toEqual(["Código", "Data", "Item", "Lote", "Proprietário", "Contado", "Sistema", "Diferença", "Ajuste", "Autor", ""]);

    const comAjuste = screen.getByText("INV-000120").closest("tr") as HTMLElement;
    for (const texto of ["MP-000431", "LT-000118", "CLI-000003", "12 kg", "12,5 kg", "-0,5", "Saída 0,5 kg", "Bruno Produção"]) {
      expect(within(comAjuste).getByText(texto)).toBeInTheDocument();
    }
    const confere = screen.getByText("INV-000121").closest("tr") as HTMLElement;
    expect(within(confere).getByText("Veridi")).toBeInTheDocument();
    expect(within(confere).getByText("Nenhum — confere")).toBeInTheDocument();
    expect(within(confere).getByText("Carla Qualidade")).toBeInTheDocument();
  });

  it.each(USER_ROLES.map((role) => ({ role, opera: OPERAM.includes(role) })))(
    "$role — ações de escrita: $opera",
    async ({ role, opera }) => {
      papel = role;
      abrir();
      const linha = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
      // Consultar e abrir são de todos.
      expect(screen.getByRole("button", { name: "Folha de contagem (FO-01)" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "+ Novo inventário" }) !== null).toBe(opera);
      expect(screen.queryByRole("link", { name: "Contagem rápida" }) !== null).toBe(opera);
      expect(within(linha).queryByRole("link", { name: "Contar INV-000014" }) !== null).toBe(opera);
      if (!opera) expect(within(linha).getByRole("link", { name: "Abrir INV-000014" })).toBeInTheDocument();
    },
  );

  it("Contar leva à contagem do inventário", async () => {
    abrir();
    const linha = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(linha).getByRole("link", { name: "Contar INV-000014" }));
    expect(await screen.findByRole("heading", { name: "Contagem (tela)" })).toBeInTheDocument();
  });
});
