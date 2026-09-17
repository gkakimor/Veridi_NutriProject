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
