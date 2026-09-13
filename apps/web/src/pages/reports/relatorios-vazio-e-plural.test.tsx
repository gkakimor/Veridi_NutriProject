import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  AwaitingBillingReportRowDTO,
  BillingPeriodRowDTO,
  ExpiryRowDTO,
  LatePurchaseOrderRowDTO,
} from "@veridi/shared";

/**
 * Relatórios — o que a tela diz quando não há documento, e quando é um dia só
 * (SMALL-UX-CLEANUP-WAVE-01).
 *
 * R-15 sem faturamento no recorte mostrava "Valores incompletos": o servidor
 * manda `totalAmount: null` quando o recorte não tem documento (o total só
 * existe com TODOS completos, e nenhum documento não é "todos completos"), e a
 * tela lia o `null` como preço faltando. O cálculo continua o mesmo; a tela é
 * que separa "nenhum documento" de "documento sem preço".
 *
 * R-11 dizia "1 dias"; R-02 e R-16 também (REPORTS-PRESENTATION-WAVE-01). A
 * contagem continua a da API — só a palavra muda.
 */

vi.mock("../../lib/reports-api", () => ({
  getBillingPeriodReport: vi.fn(),
  getLatePurchaseOrdersReport: vi.fn(),
  getExpiryReport: vi.fn(),
  getAwaitingBillingReport: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => null,
}));

import {
  getAwaitingBillingReport,
  getBillingPeriodReport,
  getExpiryReport,
  getLatePurchaseOrdersReport,
} from "../../lib/reports-api";
import { listCustomers } from "../../lib/customers-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { AwaitingBillingReportPage, BillingPeriodReportPage } from "./BillingReports";
import { ExpiryReportPage } from "./InventoryReports";
import { LatePurchaseOrdersReportPage } from "./PurchasingReports";

const VAZIO = "Nenhum faturamento para os filtros informados.";

function faturamento(n: number, precoCompleto: boolean): BillingPeriodRowDTO {
  return {
    billingId: `fat-${n}`,
    code: `FAT-${String(n).padStart(6, "0")}`,
    issuedAt: "2026-09-10T15:00:00.000Z",
    customerOrderId: `co-${n}`,
    customerOrderCode: null,
    shipmentId: `exp-${n}`,
    shipmentCode: null,
    customerId: "cli-1",
    customerName: "NutriViva",
    lineCount: 1,
    totalAmount: precoCompleto ? "100.00" : null,
    hasCompletePricing: precoCompleto,
    externalReference: null,
  };
}

function atrasada(n: number, daysLate: number): LatePurchaseOrderRowDTO {
  return {
    purchaseOrderId: `oc-${n}`,
    purchaseOrderCode: `OC-${String(n).padStart(6, "0")}`,
    purchaseOrderLineId: `ocl-${n}`,
    supplierId: "for-1",
    supplierName: "Insumos Sul",
    itemId: `item-${n}`,
    itemCode: `MP-${String(n).padStart(6, "0")}`,
    itemName: `Matéria-prima ${n}`,
    orderedQuantity: "10",
    receivedQuantity: "0",
    openQuantity: "10",
    unitCode: "kg",
    expectedDeliveryDate: "2026-09-01T00:00:00.000Z",
    status: "ORDERED",
    customerOrderId: null,
    customerOrderCode: null,
    daysLate,
  };
}

function lote(n: number, daysToExpiry: number): ExpiryRowDTO {
  return {
    itemId: `item-${n}`,
    itemCode: `MP-${String(n).padStart(6, "0")}`,
    itemName: `Matéria-prima ${n}`,
    unitCode: "kg",
    lotId: `lote-${n}`,
    lotCode: `LT-20260901-${String(n).padStart(6, "0")}`,
    lotOrigin: "RECEIPT",
    businessLotNumber: null,
    supplierLot: null,
    expiryDate: "2026-09-13T00:00:00.000Z",
    daysToExpiry,
    onHand: "10",
    reserved: "0",
    available: "10",
    status: "AVAILABLE",
    isExpired: daysToExpiry < 0,
    location: null,
  };
}

function aguardando(n: number, daysWaiting: number): AwaitingBillingReportRowDTO {
  return {
    shipmentId: `exp-${n}`,
    shipmentCode: `EXP-${String(n).padStart(6, "0")}`,
    confirmedAt: "2026-09-10T15:00:00.000Z",
    customerOrderId: `ped-${n}`,
    customerOrderCode: `PED-${String(n).padStart(6, "0")}`,
    customerId: "cli-1",
    customerName: "NutriViva",
    lineCount: 1,
    productCodes: ["PROD-000001"],
    situation: "PENDING",
    billingId: null,
    billingCode: null,
    daysWaiting,
  };
}

function abrir(tela: ReactElement) {
  return render(<MemoryRouter>{tela}</MemoryRouter>);
}

/** Texto da coluna `coluna` na linha do documento `codigo`. */
function celula(codigo: string, coluna: string): string | null | undefined {
  const linha = screen.getByRole("button", { name: codigo }).closest("tr") as HTMLElement;
  const indice = screen.getAllByRole("columnheader").findIndex((th) => th.textContent === coluna);
  return within(linha).getAllByRole("cell")[indice]?.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [], page: 1, pageSize: 20, total: 0 } as never);
});

describe("R-15 — nenhum documento não é valor incompleto", () => {
  it("zero documentos: estado vazio pelos filtros, sem 'Valores incompletos' nem '0 de 0'", async () => {
    vi.mocked(getBillingPeriodReport).mockResolvedValue({
      rows: [],
      page: 1,
      pageSize: 25,
      total: 0,
      summary: { billingCount: 0, billingsWithCompletePricing: 0, totalAmount: null },
    });
    const { container } = abrir(<BillingPeriodReportPage />);

    expect(await screen.findByText(VAZIO)).toBeInTheDocument();
    expect(container.querySelector(".report-summary")).toBeNull();
    expect(screen.queryByText("Valores incompletos")).toBeNull();
    expect(screen.queryByText("0 de 0")).toBeNull();
    expect(screen.getByText("Página 1 de 1 · 0 registros")).toBeInTheDocument();
  });

  it("documento sem preço completo: 'Valores incompletos' continua, com quantos estão completos", async () => {
    vi.mocked(getBillingPeriodReport).mockResolvedValue({
      rows: [faturamento(1, true), faturamento(2, false)],
      page: 1,
      pageSize: 25,
      total: 2,
      summary: { billingCount: 2, billingsWithCompletePricing: 1, totalAmount: null },
    });
    const { container } = abrir(<BillingPeriodReportPage />);

    await waitFor(() => expect(container.querySelector(".report-summary")).not.toBeNull());
    const resumo = within(container.querySelector<HTMLElement>(".report-summary")!);
    expect(resumo.getByText("2")).toBeInTheDocument();
    expect(resumo.getByText("1 de 2")).toBeInTheDocument();
    expect(resumo.getByText("Valores incompletos")).toBeInTheDocument();
    expect(screen.getByText("Incompleta")).toBeInTheDocument();
    expect(screen.queryByText(VAZIO)).toBeNull();
  });
});

describe("R-11 — atraso no singular e no plural", () => {
  it("1 dia, 2 dias, 0 dias", async () => {
    vi.mocked(getLatePurchaseOrdersReport).mockResolvedValue({
      rows: [atrasada(1, 1), atrasada(2, 2), atrasada(3, 0)],
      page: 1,
      pageSize: 25,
      total: 3,
    });
    abrir(<LatePurchaseOrdersReportPage />);

    await screen.findByRole("button", { name: "OC-000001" });
    const atraso = (codigo: string) => {
      const linha = screen.getByRole("button", { name: codigo }).closest("tr") as HTMLElement;
      const coluna = screen.getAllByRole("columnheader").findIndex((th) => th.textContent === "Atraso");
      return within(linha).getAllByRole("cell")[coluna]?.textContent;
    };
    expect(atraso("OC-000001")).toBe("1 dia");
    expect(atraso("OC-000002")).toBe("2 dias");
    expect(atraso("OC-000003")).toBe("0 dias");
    expect(screen.queryByText(/\b1 dias\b/)).toBeNull();
  });
});

describe("R-02 — vencimento no singular e no plural", () => {
  it("Vence em 1 dia / 2 dias, Vencido há 1 dia / 2 dias, Vence hoje", async () => {
    vi.mocked(getExpiryReport).mockResolvedValue({
      rows: [lote(1, 1), lote(2, 2), lote(3, -1), lote(4, -2), lote(5, 0)],
      page: 1,
      pageSize: 25,
      total: 5,
    });
    abrir(<ExpiryReportPage />);

    await screen.findByRole("button", { name: "LT-20260901-000001" });
    expect(celula("LT-20260901-000001", "Situação")).toBe("Vence em 1 dia");
    expect(celula("LT-20260901-000002", "Situação")).toBe("Vence em 2 dias");
    expect(celula("LT-20260901-000003", "Situação")).toBe("Vencido há 1 dia");
    expect(celula("LT-20260901-000004", "Situação")).toBe("Vencido há 2 dias");
    expect(celula("LT-20260901-000005", "Situação")).toBe("Vence hoje");
    expect(screen.queryByText(/\b1 dias\b/)).toBeNull();
  });

  it("a janela continua a mesma lista, agora de um mapa só com o PDF", async () => {
    vi.mocked(getExpiryReport).mockResolvedValue({ rows: [], page: 1, pageSize: 25, total: 0 });
    abrir(<ExpiryReportPage />);

    const janela = screen.getByRole("combobox", { name: "Janela de vencimento" }) as HTMLSelectElement;
    expect([...janela.options].map((opcao) => [opcao.value, opcao.textContent])).toEqual([
      ["EXPIRED", "Vencidos"],
      ["D7", "Próximos 7 dias"],
      ["D30", "Próximos 30 dias"],
      ["D60", "Próximos 60 dias"],
      ["CUSTOM", "Período personalizado"],
    ]);
    expect(janela.value).toBe("D30");
    await screen.findByText("Nenhum lote nesta janela de vencimento.");
  });
});

describe("R-16 — aguardando no singular e no plural", () => {
  it("Aguardando há 1 dia / 2 dias / 0 dias", async () => {
    vi.mocked(getAwaitingBillingReport).mockResolvedValue({
      rows: [aguardando(1, 1), aguardando(2, 2), aguardando(3, 0)],
      page: 1,
      pageSize: 25,
      total: 3,
    });
    abrir(<AwaitingBillingReportPage />);

    await screen.findByRole("button", { name: "EXP-000001" });
    expect(celula("EXP-000001", "Aguardando há")).toBe("1 dia");
    expect(celula("EXP-000002", "Aguardando há")).toBe("2 dias");
    expect(celula("EXP-000003", "Aguardando há")).toBe("0 dias");
    expect(screen.queryByText(/\b1 dias\b/)).toBeNull();
  });
});
