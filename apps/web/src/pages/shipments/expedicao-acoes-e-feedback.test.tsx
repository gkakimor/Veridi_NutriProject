import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ShipmentDTO, ShipmentLineDTO, ShipmentProductGroupDTO } from "@veridi/shared";

/**
 * SAVE-FEEDBACK-REMAINING-01 na Expedição.
 *
 * "Salvar separação" dizia "Salvando…" e voltava ao normal sem dizer que
 * gravou, e o mesmo `saving` punha "Salvando…" no botão de salvar enquanto a
 * expedição era confirmada ou cancelada. A tela não calcula pendência: a frase
 * sai na próxima edição ou na próxima ação. Conferir lote continua com o
 * próprio estado e o próprio resultado (o selo "Conferido").
 */

vi.mock("../../lib/shipments-api", () => ({
  getShipment: vi.fn(),
  updateShipment: vi.fn(),
  confirmShipment: vi.fn(),
  cancelShipment: vi.fn(),
  verifyShipmentLine: vi.fn(),
}));
vi.mock("../../lib/billings-api", () => ({ createBilling: vi.fn() }));

import {
  cancelShipment,
  confirmShipment,
  getShipment,
  updateShipment,
  verifyShipmentLine,
} from "../../lib/shipments-api";
import { ShipmentPage } from "./ShipmentPage";

function linha(overrides: Partial<ShipmentLineDTO> = {}): ShipmentLineDTO {
  return {
    id: "sl-a",
    customerOrderLineId: "col-1",
    customerOrderReservationLineId: "res-a",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    itemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Whey 900 g",
    lotId: "lot-a",
    lotCode: "LT-000010",
    businessLotNumber: null,
    expiryDate: null,
    location: null,
    quantity: "20",
    unitCode: "kg",
    position: 0,
    reservedRemaining: "30.5",
    requiresVerification: false,
    verifiedAt: null,
    verifiedBy: null,
    deliverySequence: null,
    deliveryScheduledDate: null,
    ...overrides,
  };
}

function grupo(overrides: Partial<ShipmentProductGroupDTO> = {}): ShipmentProductGroupDTO {
  return {
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    itemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Whey 900 g",
    unitCode: "kg",
    orderedQuantity: "100",
    shippedQuantity: "60",
    outstandingQuantity: "40",
    reservedRemaining: "30.5",
    shippingNow: "20",
    lotsRequired: 0,
    lotsVerified: 0,
    status: "READY",
    ...overrides,
  };
}

function expedicao(overrides: Partial<ShipmentDTO> = {}): ShipmentDTO {
  return {
    id: "exp-1",
    code: "EXP-000001",
    customerOrderId: "co-1",
    customerOrderCode: "PED-000001",
    customerId: "cli-1",
    customerName: "NutriViva",
    status: "DRAFT",
    shipmentDate: null,
    notes: null,
    lines: [linha()],
    products: [grupo()],
    verification: { productCount: 1, lotsRequired: 0, lotsVerified: 0, allLotsVerified: true },
    totalQuantity: "20",
    billingStatus: "NONE",
    billingId: null,
    billingCode: null,
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "Teste",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as ShipmentDTO;
}

/** Uma promessa que o teste resolve ou recusa quando quiser. */
function pendente<T>() {
  let resolver!: (valor: T) => void;
  let recusar!: (erro: Error) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    recusar = rej;
  });
  return { promessa, resolver, recusar };
}

async function abrir(dto = expedicao()) {
  vi.mocked(getShipment).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/comercial/expedicoes/exp-1"]}>
      <Routes>
        <Route path="/comercial/expedicoes/:id" element={<ShipmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "EXP-000001" });
}

const botao = (nome: string) => screen.getByRole("button", { name: nome });
const quantidade = () => screen.getByRole("textbox", { name: "Quantidade do lote LT-000010" }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Expedição — Salvar separação responde", () => {
  it("\"Salvando…\" só no botão de salvar e \"Separação salva.\" só com a resposta", async () => {
    const gravacao = pendente<ShipmentDTO>();
    vi.mocked(updateShipment).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "25" } });
    fireEvent.click(botao("Salvar separação"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    // O vizinho recusa o clique, mas não rouba o rótulo.
    expect(botao("Confirmar expedição")).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    gravacao.resolver(expedicao({ lines: [linha({ quantity: "25" })], products: [grupo({ shippingNow: "25" })] }));

    const frase = await screen.findByText("Separação salva.");
    expect(frase).toHaveAttribute("role", "status");
    expect(frase.closest(".doc-actions__primary")).toContainElement(botao("Salvar separação"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("clique duplo grava uma vez só", async () => {
    const gravacao = pendente<ShipmentDTO>();
    vi.mocked(updateShipment).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.click(botao("Salvar separação"));
    fireEvent.click(botao("Salvando…"));

    expect(updateShipment).toHaveBeenCalledTimes(1);
    gravacao.resolver(expedicao());
    expect(await screen.findByText("Separação salva.")).toBeInTheDocument();
  });

  it("recusa fica em role=alert com a mensagem da API; nada de sucesso, e o digitado fica", async () => {
    const gravacao = pendente<ShipmentDTO>();
    vi.mocked(updateShipment).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "25" } });
    fireEvent.click(botao("Salvar separação"));
    await screen.findByRole("button", { name: "Salvando…" });
    gravacao.recusar(new Error("A reserva deste lote foi liberada."));

    expect(await screen.findByRole("alert")).toHaveTextContent("A reserva deste lote foi liberada.");
    expect(screen.queryByText("Separação salva.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(quantidade()).toHaveValue("25");
    expect(botao("Salvar separação")).toBeEnabled();
  });

  it("editar de novo — quantidade ou notas — tira a frase antiga", async () => {
    vi.mocked(updateShipment).mockResolvedValue(expedicao());
    await abrir();

    fireEvent.click(botao("Salvar separação"));
    expect(await screen.findByText("Separação salva.")).toBeInTheDocument();
    fireEvent.change(quantidade(), { target: { value: "18" } });
    expect(screen.queryByText("Separação salva.")).toBeNull();

    fireEvent.click(botao("Salvar separação"));
    expect(await screen.findByText("Separação salva.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Notas internas"), { target: { value: "Doca 2" } });
    expect(screen.queryByText("Separação salva.")).toBeNull();
  });
});

describe("Expedição — ações vizinhas não herdam o salvamento", () => {
  it("conferir lote é outra ação: a frase da separação sai e o resultado é o selo", async () => {
    const aConferir = expedicao({
      lines: [linha({ requiresVerification: true })],
      products: [grupo({ lotsRequired: 1 })],
      verification: { productCount: 1, lotsRequired: 1, lotsVerified: 0, allLotsVerified: false },
    });
    vi.mocked(updateShipment).mockResolvedValue(aConferir);
    vi.mocked(verifyShipmentLine).mockResolvedValue(
      expedicao({
        lines: [linha({ requiresVerification: true, verifiedAt: "2026-09-02T10:00:00.000Z", verifiedBy: "Ana" })],
        products: [grupo({ lotsRequired: 1, lotsVerified: 1 })],
        verification: { productCount: 1, lotsRequired: 1, lotsVerified: 1, allLotsVerified: true },
      }),
    );
    await abrir(aConferir);

    fireEvent.click(botao("Salvar separação"));
    expect(await screen.findByText("Separação salva.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Lote conferido da linha LT-000010" }), {
      target: { value: "LT-000010" },
    });
    fireEvent.click(botao("Conferir lote"));

    expect(await screen.findByText("Conferido")).toBeInTheDocument();
    expect(verifyShipmentLine).toHaveBeenCalledWith("exp-1", "sl-a", { lotCode: "LT-000010" });
    expect(screen.queryByText("Separação salva.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();
  });

  it("confirmar diz \"Confirmando…\" no próprio botão e não anuncia \"Separação salva.\"", async () => {
    vi.mocked(updateShipment).mockResolvedValue(expedicao());
    const confirmacao = pendente<ShipmentDTO>();
    vi.mocked(confirmShipment).mockReturnValue(confirmacao.promessa);
    await abrir();

    fireEvent.click(botao("Salvar separação"));
    expect(await screen.findByText("Separação salva.")).toBeInTheDocument();

    fireEvent.click(botao("Confirmar expedição"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("button", { name: "Confirmando…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();
    expect(botao("Salvar separação")).toBeDisabled();
    expect(screen.queryByText("Separação salva.")).toBeNull();

    confirmacao.resolver(
      expedicao({ status: "CONFIRMED", confirmedAt: "2026-09-02T00:00:00.000Z", confirmedBy: "Teste" }),
    );

    expect(await screen.findByText("Confirmada em")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("cancelar diz \"Cancelando…\" no diálogo, e o salvar não diz \"Salvando…\"", async () => {
    const cancelamento = pendente<ShipmentDTO>();
    vi.mocked(cancelShipment).mockReturnValue(cancelamento.promessa);
    await abrir();

    fireEvent.click(botao("Cancelar expedição"));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialogo).getByLabelText(/Motivo do cancelamento/), {
      target: { value: "Cliente adiou" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar expedição" }));

    expect(await within(dialogo).findByRole("button", { name: "Cancelando…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();

    cancelamento.resolver(expedicao({ status: "CANCELLED", cancelReason: "Cliente adiou" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
