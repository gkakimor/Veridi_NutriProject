import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductionOrderDTO, ProductionOrderListResponse } from "@veridi/shared";

/**
 * Ordens de Produção — pendência de roteiro na lista
 * (PRODUCTION-ROUTE-ASSIGNMENT-01).
 *
 * O filtro é derivado e mora na URL (`?semRoteiro=1`, o destino do Dashboard);
 * a linha diz "Sem roteiro"; e quem não opera a OP não recebe "+ Nova OP".
 */

const papel = vi.hoisted(() => ({ atual: "ADMIN" }));

vi.mock("../../lib/production-orders-api", () => ({ listProductionOrders: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn(async () => ({ products: [], total: 0 })) }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-rot", role: papel.atual } }),
}));

import { listProductionOrders } from "../../lib/production-orders-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { ProductionOrdersPage } from "./ProductionOrdersPage";

function ordem(n: number, routePending: boolean): ProductionOrderDTO {
  return {
    id: `op-${n}`,
    code: `OP-00000${n}`,
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey Isolado",
    customerId: null,
    customerCode: null,
    customerName: null,
    customerOrderId: null,
    customerOrderCode: null,
    formulationVersionLabel: "V1",
    plannedQuantity: "100",
    outputUnitCode: "un",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    status: "DRAFT",
    planning: { routePending },
    createdAt: "2026-09-10T12:00:00.000Z",
  } as unknown as ProductionOrderDTO;
}

type Consulta = NonNullable<Parameters<typeof listProductionOrders>[0]>;
const ultima = () => vi.mocked(listProductionOrders).mock.calls.at(-1)?.[0] as Consulta | undefined;

function abrir(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ProductionOrdersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  papel.atual = "ADMIN";
  clearStoredFilters("u-rot", "production-orders");
  vi.mocked(listProductionOrders).mockReset();
  vi.mocked(listProductionOrders).mockResolvedValue({
    productionOrders: [ordem(1, true), ordem(2, false)],
    page: 1,
    pageSize: 20,
    total: 2,
  } as ProductionOrderListResponse);
});

describe("Ordens de Produção — roteiro de produção", () => {
  it("?semRoteiro=1 vira filtro da consulta, chip e controle; tirar o chip volta a todas", async () => {
    abrir("/producao/ordens?semRoteiro=1");

    await waitFor(() => expect(ultima()?.semRoteiro).toBe(true));
    expect((screen.getByLabelText("Filtrar por roteiro de produção") as HTMLSelectElement).value).toBe("1");
    const chips = screen.getByRole("button", { name: "Remover filtro Roteiro" }).closest("div") as HTMLElement;
    expect(chips.textContent).toContain("Sem roteiro");

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Roteiro" }));
    await waitFor(() => expect(ultima()?.semRoteiro).toBeUndefined());
  });

  it("\"Com roteiro\" pede o contrário ao servidor", async () => {
    abrir("/producao/ordens");
    await waitFor(() => expect(listProductionOrders).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filtrar por roteiro de produção"), { target: { value: "0" } });
    await waitFor(() => expect(ultima()?.semRoteiro).toBe(false));
  });

  it("a linha pendente mostra \"Sem roteiro\"; a que tem roteiro, não", async () => {
    abrir("/producao/ordens");
    const pendente = (await screen.findByRole("link", { name: /OP-000001/ })).closest("tr") as HTMLElement;
    const comRoteiro = screen.getByRole("link", { name: /OP-000002/ }).closest("tr") as HTMLElement;
    expect(within(pendente).getByText("Sem roteiro")).toBeInTheDocument();
    expect(within(comRoteiro).queryByText("Sem roteiro")).toBeNull();
  });

  it("Comercial lê a lista e não recebe \"+ Nova OP\"", async () => {
    papel.atual = "COMMERCIAL";
    abrir("/producao/ordens");
    await screen.findByRole("link", { name: /OP-000001/ });
    expect(screen.queryByRole("button", { name: "+ Nova OP" })).toBeNull();
  });
});
