import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { InventoryMovementDTO } from "@veridi/shared";

/**
 * Estoque → Movimentações: o ajuste de inventário aponta o `INV-`
 * (INVENTORY-PHYSICAL-COUNT-01, Fatia 2B).
 *
 * O ajuste gerado pelo encerramento ou pela Contagem rápida mostra o documento
 * com link; o ajuste `STOCK_COUNT` anterior às sessões, sem documento, segue
 * como "Inventário físico". O extrato continua somente leitura.
 */

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));
vi.mock("../../lib/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/inventory-api")>()),
  listInventoryMovements: vi.fn(),
}));

import { listInventoryMovements } from "../../lib/inventory-api";
import { InventoryMovementsPage } from "./InventoryMovementsPage";

function movimento(sobre: Partial<InventoryMovementDTO>): InventoryMovementDTO {
  return {
    id: "m-1",
    itemId: "item-1",
    itemCode: "MP-000431",
    itemName: "Vitamina C",
    unitCode: "kg",
    lotId: null,
    lotCode: null,
    type: "ADJUSTMENT_OUT",
    quantity: "1",
    occurredAt: "2026-09-15T18:00:00.000Z",
    sourceType: "STOCK_COUNT",
    sourceId: "pos-1",
    receiptId: null,
    receiptCode: null,
    purchaseOrderId: null,
    purchaseOrderCode: null,
    shipmentId: null,
    shipmentCode: null,
    productionOrderId: null,
    productionOrderCode: null,
    projectSampleId: null,
    projectSampleCode: null,
    stockCountId: null,
    stockCountCode: null,
    internalConsumptionId: null,
    internalConsumptionCode: null,
    internalConsumptionReversalId: null,
    internalConsumptionReversalCode: null,
    reason: "Avaria",
    createdBy: "Carla Qualidade",
    createdAt: "2026-09-15T18:00:00.000Z",
    ...sobre,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listInventoryMovements).mockResolvedValue({
    movements: [
      movimento({ id: "m-1", stockCountId: "inv-14", stockCountCode: "INV-000014" }),
      movimento({ id: "m-2", itemCode: "MP-000077", sourceId: null }),
    ],
    page: 1,
    pageSize: 20,
    total: 2,
  });
});

describe("Movimentações — origem do ajuste de inventário", () => {
  it("o INV- é link para o inventário; o ajuste antigo sem documento segue como Inventário físico", async () => {
    render(
      <MemoryRouter>
        <InventoryMovementsPage />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "INV-000014" });
    expect(link).toHaveAttribute("href", "/estoque/inventario/inv-14");

    const antigo = screen.getByRole("link", { name: /MP-000077/ }).closest("tr") as HTMLElement;
    expect(within(antigo).getByText("Inventário físico")).toBeInTheDocument();
    expect(within(antigo).queryByRole("link", { name: /INV-/ })).toBeNull();
    // Somente leitura: nenhuma ação de editar ou excluir movimento.
    expect(screen.queryByRole("button", { name: /Editar|Excluir|Estornar/ })).toBeNull();
  });
});

describe("Movimentações — consumo interno e o estorno dele (INTERNAL-CONSUMPTION-REVERSAL-01)", () => {
  it("a baixa é Saída com o CI-; o estorno é Entrada com o ECI- e o CI- que ele anula", async () => {
    vi.mocked(listInventoryMovements).mockResolvedValue({
      movements: [
        movimento({
          id: "m-est",
          itemCode: "UC-000004",
          type: "INTERNAL_CONSUMPTION_REVERSAL",
          sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
          sourceId: "eci-1",
          internalConsumptionId: "ci-123",
          internalConsumptionCode: "CI-000123",
          internalConsumptionReversalId: "eci-1",
          internalConsumptionReversalCode: "ECI-000001",
          reason: "Quantidade digitada errada",
        }),
        movimento({
          id: "m-ci",
          itemCode: "UC-000005",
          type: "INTERNAL_CONSUMPTION",
          sourceType: "INTERNAL_CONSUMPTION",
          sourceId: "ci-123",
          internalConsumptionId: "ci-123",
          internalConsumptionCode: "CI-000123",
          reason: null,
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    render(
      <MemoryRouter>
        <InventoryMovementsPage />
      </MemoryRouter>,
    );

    const estorno = (await screen.findByRole("link", { name: /UC-000004/ })).closest("tr") as HTMLElement;
    expect(within(estorno).getByText("Estorno de consumo interno")).toBeInTheDocument();
    expect(within(estorno).getByText("Entrada")).toBeInTheDocument();
    expect(within(estorno).getByText("ECI-000001 (estorno de CI-000123)")).toBeInTheDocument();

    const baixa = screen.getByRole("link", { name: /UC-000005/ }).closest("tr") as HTMLElement;
    expect(within(baixa).getByText("Consumo interno")).toBeInTheDocument();
    expect(within(baixa).getByText("Saída")).toBeInTheDocument();
    expect(within(baixa).getByText("CI-000123")).toBeInTheDocument();
    // O extrato continua só de leitura: estornar é em Uso e consumo.
    expect(screen.queryByRole("button", { name: /Estornar/ })).toBeNull();
  });
});
