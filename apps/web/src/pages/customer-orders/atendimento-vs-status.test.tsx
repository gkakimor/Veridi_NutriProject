import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";

/**
 * Duas colunas não podem discordar sobre o mesmo fato.
 *
 * A coluna "Atendimento" recalculava a situação de expedição por conta
 * própria: bastava UMA expedição confirmada para dizer "Expedido", sem olhar
 * se ela cobria o pedido. `PED-000001` embarcou 980 de 1000 e a linha dizia
 * "Expedido" numa coluna e "Parcialmente expedido" na coluna ao lado.
 *
 * Quem passa o olho numa lista acredita na primeira coluna que lê. A situação
 * de expedição é derivada no servidor a partir das expedições confirmadas
 * reais — a tela lê, não recalcula.
 */

vi.mock("../../lib/customer-orders-api", () => ({ listCustomerOrders: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({
  listCustomers: vi.fn(async () => ({ customers: [], total: 0 })),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { listCustomerOrders } from "../../lib/customer-orders-api";
import { useAuth } from "../../app/AuthProvider";
import { CustomerOrdersPage } from "./CustomerOrdersPage";

function pedido(overrides: Partial<CustomerOrderDTO>): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: "cli-1",
    customerName: "Cliente de Teste",
    orderDate: new Date().toISOString(),
    requestedDeliveryDate: null,
    status: "PARTIALLY_SHIPPED",
    billingStatus: "NOT_BILLED",
    lines: [{ id: "l1", quantity: "1000" }],
    shipments: [{ id: "s1", status: "CONFIRMED" }],
    reservation: null,
    generatedProductionOrders: [],
    ...overrides,
  } as unknown as CustomerOrderDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u-1", name: "Admin", email: "a@v.com", role: "ADMIN" },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

async function renderizar(pedidos: CustomerOrderDTO[]) {
  vi.mocked(listCustomerOrders).mockResolvedValue({
    customerOrders: pedidos,
    total: pedidos.length,
  } as never);
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos"]}>
      <CustomerOrdersPage />
    </MemoryRouter>,
  );
  return await screen.findByRole("row", { name: /PED-000001/ });
}

describe("Pedidos — Atendimento não contradiz Status", () => {
  it("expedição parcial não vira 'Expedido' na coluna ao lado", async () => {
    // Uma expedição CONFIRMED, mas o pedido não fechou: era exatamente aqui
    // que a coluna mentia.
    const linha = await renderizar([
      pedido({ status: "PARTIALLY_SHIPPED", shipments: [{ id: "s1", status: "CONFIRMED" }] as never }),
    ]);

    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent?.trim());
    const quantas = celulas.filter((t) => t === "Parcialmente expedido").length;
    expect(quantas).toBe(2);
    expect(celulas).not.toContain("Expedido");
  });

  it("pedido realmente expedido diz 'Expedido' nas duas", async () => {
    const linha = await renderizar([
      pedido({ status: "SHIPPED", shipments: [{ id: "s1", status: "CONFIRMED" }] as never }),
    ]);

    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent?.trim());
    expect(celulas.filter((t) => t === "Expedido").length).toBe(2);
  });

  it("sem plano aplicado, Atendimento diz que ninguém analisou", async () => {
    const linha = await renderizar([
      pedido({ status: "CONFIRMED", shipments: [] as never, reservation: null }),
    ]);

    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent?.trim());
    expect(celulas).toContain("Não analisado");
  });

  it("com reserva aplicada, Atendimento diz em atendimento", async () => {
    const linha = await renderizar([
      pedido({
        status: "IN_FULFILLMENT",
        shipments: [] as never,
        reservation: { id: "r1" } as never,
      }),
    ]);

    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent?.trim());
    await waitFor(() => expect(celulas.filter((t) => t === "Em atendimento").length).toBe(2));
  });
});
