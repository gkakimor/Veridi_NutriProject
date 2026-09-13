import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DashboardDTO } from "@veridi/shared";

/**
 * Dashboard — "OPs sem roteiro" (PRODUCTION-ROUTE-ASSIGNMENT-01).
 *
 * A contagem é derivada no servidor, e a linha leva à lista que resolve: a
 * lista de Ordens de Produção já filtrada pela pendência.
 */

vi.mock("../lib/dashboard-api", () => ({ getDashboard: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
}));

import { getDashboard } from "../lib/dashboard-api";
import { DashboardPage } from "./DashboardPage";

const DASHBOARD = {
  period: {
    from: "2026-09-12T03:00:00.000Z",
    to: "2026-09-13T02:59:59.999Z",
    customerOrdersCreated: 0,
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
      draft: 4,
      planned: 1,
      released: 0,
      inProduction: 0,
      withShortage: 0,
      completedWithIncompleteCost: 0,
      withoutRoute: 3,
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

describe("Dashboard — OPs sem roteiro", () => {
  it("mostra a contagem e leva à lista filtrada pela pendência", async () => {
    vi.mocked(getDashboard).mockResolvedValue(DASHBOARD);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: "OPs sem roteiro" });
    expect(link).toHaveAttribute("href", "/producao/ordens?semRoteiro=1");
    expect(link.closest(".dash-state__line")?.textContent).toContain("3");
  });
});
