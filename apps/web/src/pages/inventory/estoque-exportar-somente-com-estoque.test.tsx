import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * INVENTORY-EXPORT-ONLY-WITH-STOCK-01 — o pedido que o "Exportar CSV" do
 * Estoque monta. A caixa desmarcada viaja como `onlyWithStock=false`, e é a
 * API que precisa ler isso como falso (`booleanoDeConsultaSchema`); a tela já
 * mandava o literal certo e não mudou.
 */

vi.mock("../../lib/inventory-api", () => ({ listInventory: vi.fn() }));

import { listInventory } from "../../lib/inventory-api";
import { InventoryOverviewPage } from "./InventoryOverviewPage";

function parametrosDoCsv(): URLSearchParams {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  const url = new URL(link.getAttribute("href")!, "http://exemplo.invalid");
  expect(url.pathname).toMatch(/\/inventory\/export\.csv$/);
  return url.searchParams;
}

describe("Estoque — Exportar CSV com e sem 'Somente com estoque'", () => {
  it("desmarcada manda false, marcada manda true, e nunca paginação", async () => {
    vi.mocked(listInventory).mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(
      <MemoryRouter>
        <InventoryOverviewPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listInventory).toHaveBeenCalled());

    expect(parametrosDoCsv().get("onlyWithStock")).toBe("false");

    fireEvent.click(screen.getByRole("checkbox", { name: "Somente com estoque" }));
    await waitFor(() => expect(parametrosDoCsv().get("onlyWithStock")).toBe("true"));
    const marcada = parametrosDoCsv();
    expect(marcada.has("page")).toBe(false);
    expect(marcada.has("pageSize")).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Somente com estoque" }));
    await waitFor(() => expect(parametrosDoCsv().get("onlyWithStock")).toBe("false"));
  });
});
