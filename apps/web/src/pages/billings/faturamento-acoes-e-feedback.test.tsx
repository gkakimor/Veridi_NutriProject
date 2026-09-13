import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { BillingDTO, BillingLineDTO } from "@veridi/shared";

/**
 * SAVE-FEEDBACK-REMAINING-01 no Faturamento.
 *
 * "Salvar rascunho" dizia "Salvando…" e voltava ao normal sem dizer que gravou,
 * e o mesmo `saving` punha "Salvando…" no botão de salvar enquanto o
 * faturamento era emitido ou cancelado. A tela não calcula pendência: a frase
 * sai na próxima edição ou na próxima ação, em vez de afirmar "salvo" sobre um
 * formulário que já mudou.
 */

vi.mock("../../lib/billings-api", () => ({
  getBilling: vi.fn(),
  updateBilling: vi.fn(),
  issueBilling: vi.fn(),
  cancelBilling: vi.fn(),
  overrideBillingPrice: vi.fn(),
}));

import {
  cancelBilling,
  getBilling,
  issueBilling,
  overrideBillingPrice,
  updateBilling,
} from "../../lib/billings-api";
import { BillingPage } from "./BillingPage";

function linha(overrides: Partial<BillingLineDTO> = {}): BillingLineDTO {
  return {
    id: "bl-1",
    shipmentLineId: "sl-1",
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Produto A",
    itemId: "item-1",
    itemCode: "PA-000001",
    itemName: "Produto A",
    lotId: "lot-1",
    lotCode: "LT-20260901-000001",
    businessLotNumber: null,
    quantity: "100",
    unitCode: "un",
    agreedUnitPrice: null,
    unitPrice: "12.5000",
    lineTotal: "1250.00",
    priceOverridden: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    position: 0,
    ...overrides,
  };
}

function faturamento(overrides: Partial<BillingDTO> = {}): BillingDTO {
  return {
    id: "fat-1",
    code: "FAT-000001",
    customerOrderId: "co-1",
    customerOrderCode: "PED-000001",
    shipmentId: "sh-1",
    shipmentCode: "EXP-000001",
    shipmentDate: "2026-09-01T00:00:00.000Z",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    customerTradeName: null,
    customerCnpj: null,
    status: "DRAFT",
    externalReference: null,
    notes: null,
    totalQuantity: "100",
    grossAmount: "1250.00",
    discountPercentSnapshot: null,
    discountAmount: null,
    commercialAdjustmentAmount: null,
    totalAmount: "1250.00",
    hasCompletePricing: true,
    issuedAt: null,
    issuedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    lines: [linha()],
    ...overrides,
  };
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

async function abrir(dto = faturamento()) {
  vi.mocked(getBilling).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/comercial/faturamento/fat-1"]}>
      <Routes>
        <Route path="/comercial/faturamento/:id" element={<BillingPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "FAT-000001" });
}

const botao = (nome: string) => screen.getByRole("button", { name: nome });
const preco = () => screen.getByLabelText("Preço faturado de PROD-000001") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Faturamento — Salvar rascunho responde", () => {
  it("\"Salvando…\" só no botão de salvar e \"Rascunho salvo.\" só com a resposta", async () => {
    const gravacao = pendente<BillingDTO>();
    vi.mocked(updateBilling).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(preco(), { target: { value: "13,25" } });
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    // O vizinho recusa o clique, mas não rouba o rótulo.
    expect(botao("Emitir faturamento")).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    gravacao.resolver(faturamento({ lines: [linha({ unitPrice: "13.2500", lineTotal: "1325.00" })] }));

    const frase = await screen.findByText("Rascunho salvo.");
    expect(frase).toHaveAttribute("role", "status");
    expect(frase.closest(".doc-actions__primary")).toContainElement(botao("Salvar rascunho"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(updateBilling).toHaveBeenCalledTimes(1);
  });

  it("clique duplo grava uma vez só", async () => {
    const gravacao = pendente<BillingDTO>();
    vi.mocked(updateBilling).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.click(botao("Salvar rascunho"));
    fireEvent.click(botao("Salvando…"));

    expect(updateBilling).toHaveBeenCalledTimes(1);
    gravacao.resolver(faturamento());
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
  });

  it("recusa fica em role=alert com a mensagem da API; nada de sucesso, e o digitado fica", async () => {
    const gravacao = pendente<BillingDTO>();
    vi.mocked(updateBilling).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(preco(), { target: { value: "13,25" } });
    fireEvent.click(botao("Salvar rascunho"));
    await screen.findByRole("button", { name: "Salvando…" });
    gravacao.recusar(new Error("Faturamento já emitido não aceita alteração."));

    expect(await screen.findByRole("alert")).toHaveTextContent("Faturamento já emitido não aceita alteração.");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(preco()).toHaveValue("13,25");
    expect(botao("Salvar rascunho")).toBeEnabled();
  });

  it("editar de novo — preço, referência ou notas — tira a frase antiga", async () => {
    vi.mocked(updateBilling).mockResolvedValue(faturamento());
    await abrir();

    const salvar = async () => {
      fireEvent.click(botao("Salvar rascunho"));
      expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    };

    await salvar();
    fireEvent.change(preco(), { target: { value: "13" } });
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    await salvar();
    fireEvent.change(screen.getByLabelText("Referência externa"), { target: { value: "NF 123" } });
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    await salvar();
    fireEvent.change(screen.getByLabelText("Notas internas"), { target: { value: "Conferido" } });
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });
});

describe("Faturamento — ações de domínio não herdam o salvamento", () => {
  it("emitir diz \"Emitindo…\" no próprio botão e não anuncia \"Rascunho salvo.\"", async () => {
    vi.mocked(updateBilling).mockResolvedValue(faturamento());
    const emissao = pendente<BillingDTO>();
    vi.mocked(issueBilling).mockReturnValue(emissao.promessa);
    await abrir();

    // Uma frase de salvamento anterior não sobrevive à ação seguinte.
    fireEvent.click(botao("Salvar rascunho"));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();

    fireEvent.click(botao("Emitir faturamento"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Emitir" }));

    expect(await screen.findByRole("button", { name: "Emitindo…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    emissao.resolver(faturamento({ status: "ISSUED", issuedAt: "2026-09-02T00:00:00.000Z" }));

    expect(await screen.findByText("Emitido em")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("emitir que grava e depois é recusado não mostra \"Rascunho salvo.\"", async () => {
    vi.mocked(updateBilling).mockResolvedValue(faturamento());
    vi.mocked(issueBilling).mockRejectedValue(new Error("Expedição cancelada não pode ser faturada."));
    await abrir();

    fireEvent.click(botao("Emitir faturamento"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Emitir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Expedição cancelada não pode ser faturada.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(botao("Emitir faturamento")).toBeEnabled();
  });

  it("cancelar diz \"Cancelando…\" no diálogo, e o salvar não diz \"Salvando…\"", async () => {
    const cancelamento = pendente<BillingDTO>();
    vi.mocked(cancelBilling).mockReturnValue(cancelamento.promessa);
    await abrir();

    fireEvent.click(botao("Cancelar faturamento"));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialogo).getByLabelText(/Motivo do cancelamento/), {
      target: { value: "Preço renegociado" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar faturamento" }));

    expect(await within(dialogo).findByRole("button", { name: "Cancelando…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();

    cancelamento.resolver(faturamento({ status: "CANCELLED", cancelReason: "Preço renegociado" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("alterar o preço acordado é outra gravação: a frase do rascunho sai", async () => {
    vi.mocked(updateBilling).mockResolvedValue(faturamento({ lines: [linha({ agreedUnitPrice: "12.5000" })] }));
    vi.mocked(overrideBillingPrice).mockResolvedValue(
      faturamento({
        lines: [linha({ agreedUnitPrice: "12.5000", unitPrice: "13.2500", lineTotal: "1325.00", priceOverridden: true })],
      }),
    );
    await abrir(faturamento({ lines: [linha({ agreedUnitPrice: "12.5000" })] }));

    fireEvent.click(botao("Salvar rascunho"));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();

    fireEvent.click(botao("Alterar preço de faturamento"));
    await screen.findByRole("heading", { name: "Alterar preço de faturamento" });
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Desconto acordado" } });
    fireEvent.click(botao("Alterar preço"));

    await waitFor(() => expect(overrideBillingPrice).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Alterar preço de faturamento" })).toBeNull(),
    );
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });
});
