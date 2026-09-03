import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { InventoryPositionRowDTO } from "@veridi/shared";
import { InventoryPositionSheetPage } from "./OperationalSheets";
import { getInventoryPositionReport } from "../../lib/reports-api";

vi.mock("../../lib/reports-api", () => ({
  getInventoryPositionReport: vi.fn(),
}));

const lotEmEspera = {
  itemId: "item-1",
  itemCode: "MP-000001",
  itemName: "Coenzima Q10",
  itemType: "RAW_MATERIAL",
  unitCode: "kg",
  lotId: "lot-1",
  lotCode: "LT-20260810-000001",
  lotOrigin: "RECEIPT",
  supplierLot: "F-778",
  businessLotNumber: null,
  supplierName: "Insumos Ltda",
  ownerType: "VERIDI",
  ownerCustomerId: null,
  ownerCustomerName: null,
  coaStatus: "PENDING",
  expiryDate: "2027-01-31T00:00:00.000Z",
  location: "A-01",
  onHand: "500",
  reserved: "0",
  available: "0",
  status: "AWAITING_RELEASE",
  isExpired: false,
} as unknown as InventoryPositionRowDTO;

function renderFO02() {
  return render(
    <MemoryRouter>
      <InventoryPositionSheetPage />
    </MemoryRouter>,
  );
}

/**
 * FO-02 saía com Físico 500, Reservado 0 e Disponível 0 sem dizer por quê.
 * Quem faz a contagem está no estoque com o papel na mão: se a folha não
 * explica o bloqueio, o número zerado parece erro do sistema — ou pior,
 * parece material que sumiu.
 */
describe("FO-02 — posição de estoque impressa", () => {
  it("explica por que o lote em espera da Qualidade tem disponível zero", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue({
      rows: [lotEmEspera],
      page: 1,
      pageSize: 25,
      total: 1,
    } as Awaited<ReturnType<typeof getInventoryPositionReport>>);

    const { container } = renderFO02();

    // A situação do lote vira coluna: quem lê a linha vê o motivo ao lado do
    // número, não precisa deduzir.
    expect(await screen.findByText("Aguardando liberação")).toBeTruthy();
    expect(screen.getByText("Situação do lote")).toBeTruthy();

    // E a regra fica escrita no papel, não só implícita na coluna.
    const aviso = container.querySelector(".print-doc__notice");
    expect(aviso).toBeTruthy();
    expect(aviso?.textContent).toMatch(/Disponível = Físico/);
    expect(aviso?.textContent).toMatch(/Aguardando liberação/);
    expect(aviso?.textContent).toMatch(/conta zero no disponível/);
  });

  it("mostra o físico bloqueado sem apagá-lo do estoque", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue({
      rows: [{ ...lotEmEspera, status: "BLOCKED" }],
      page: 1,
      pageSize: 25,
      total: 1,
    } as Awaited<ReturnType<typeof getInventoryPositionReport>>);

    renderFO02();

    // Material bloqueado continua contando no Físico — a folha de contagem
    // precisa dele para bater com o que está na prateleira.
    expect(await screen.findByText("Bloqueado")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
  });

  it("vencimento manda sobre o estado gravado", async () => {
    vi.mocked(getInventoryPositionReport).mockResolvedValue({
      rows: [{ ...lotEmEspera, status: "AVAILABLE", isExpired: true }],
      page: 1,
      pageSize: 25,
      total: 1,
    } as Awaited<ReturnType<typeof getInventoryPositionReport>>);

    renderFO02();

    // Lote fora da validade não pode aparecer no papel como disponível.
    const linha = (await screen.findByText("LT-20260810-000001")).closest("tr")!;
    expect(linha.textContent).toContain("Vencido");
    expect(linha.textContent).not.toContain("Disponível");
  });
});
