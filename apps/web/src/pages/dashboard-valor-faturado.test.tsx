import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DashboardDTO } from "@veridi/shared";

/**
 * Painel — "Valor faturado" sem faturamento no período (REPORTS-PRESENTATION-WAVE-01).
 *
 * O servidor manda `billedAmount: null` quando o período não tem documento: o
 * total só existe com TODOS completos, e nenhum documento não é "todos
 * completos". A tela lia esse `null` como preço faltando e dizia "Valores
 * incompletos · 0 de 0 documentos com preço completo". O DTO e a conta são os
 * mesmos; a tela é que separa "nenhum documento" de "documento sem preço".
 */

vi.mock("../lib/dashboard-api", () => ({ getDashboard: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
}));

import { getDashboard } from "../lib/dashboard-api";
import { DashboardPage } from "./DashboardPage";

type Faturamento = Pick<DashboardDTO["period"], "billingsIssued" | "billedAmount" | "billingsWithCompletePricing">;

function painel(faturamento: Faturamento): DashboardDTO {
  return {
    period: {
      from: "2026-09-12T03:00:00.000Z",
      to: "2026-09-13T02:59:59.999Z",
      customerOrdersCreated: 0,
      receiptsCompleted: 0,
      productionOrdersCompleted: 0,
      shipmentsConfirmed: 0,
      ...faturamento,
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
        draft: 0,
        planned: 0,
        released: 0,
        inProduction: 0,
        withShortage: 0,
        completedWithIncompleteCost: 0,
        withoutRoute: 0,
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
}

/** O cartão "Valor faturado": valor e nota, como a tela os escreve. */
async function cartao(faturamento: Faturamento) {
  vi.mocked(getDashboard).mockResolvedValue(painel(faturamento));
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  const rotulo = await screen.findByText("Valor faturado");
  const card = rotulo.closest(".dash-card") as HTMLElement;
  return {
    card,
    valor: card.querySelector(".dash-card__value"),
    nota: card.querySelector(".dash-card__note")?.textContent,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Painel — Valor faturado", () => {
  it("0 faturamentos: estado neutro, sem 'Valores incompletos' nem '0 de 0'", async () => {
    const { card, valor, nota } = await cartao({ billingsIssued: 0, billedAmount: null, billingsWithCompletePricing: 0 });

    expect(valor?.textContent).toBe("—");
    // Neutro: nada de cor de aviso para o que não é problema.
    expect(valor).not.toHaveClass("dash-card__value--unavailable");
    expect(nota).toBe("Sem faturamentos no período.");
    expect(card.textContent).not.toContain("Valores incompletos");
    expect(card.textContent).not.toContain("0 de 0");
  });

  it("1 faturamento sem preço completo: 'Valores incompletos', no singular", async () => {
    const { valor, nota } = await cartao({ billingsIssued: 1, billedAmount: null, billingsWithCompletePricing: 0 });

    expect(valor?.textContent).toBe("Valores incompletos");
    expect(valor).toHaveClass("dash-card__value--unavailable");
    expect(nota).toBe("0 de 1 documento com preço completo.");
  });

  it("parte sem preço completo: quantos estão completos, no plural", async () => {
    const { valor, nota } = await cartao({ billingsIssued: 3, billedAmount: null, billingsWithCompletePricing: 2 });

    expect(valor?.textContent).toBe("Valores incompletos");
    expect(nota).toBe("2 de 3 documentos com preço completo.");
  });

  it("todos completos: o total, e quantos documentos o formam", async () => {
    const { card, valor, nota } = await cartao({
      billingsIssued: 2,
      billedAmount: "1325.50",
      billingsWithCompletePricing: 2,
    });

    expect(valor?.textContent).toContain("1.325,50");
    expect(valor).not.toHaveClass("dash-card__value--unavailable");
    expect(nota).toBe("2 documentos, todos com preço completo.");
    expect(card.textContent).not.toContain("Valores incompletos");
  });

  it("um documento completo: singular, sem 'todos'", async () => {
    const { valor, nota } = await cartao({ billingsIssued: 1, billedAmount: "300.00", billingsWithCompletePricing: 1 });

    expect(valor?.textContent).toContain("300,00");
    expect(nota).toBe("1 documento, com preço completo.");
  });
});
