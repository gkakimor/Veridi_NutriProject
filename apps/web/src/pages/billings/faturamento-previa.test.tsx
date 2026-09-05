import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { BillingDTO, BillingLineDTO } from "@veridi/shared";

/**
 * Alterar o preço de faturamento mostra a consequência ANTES de confirmar
 * (BACKLOG #8D).
 *
 * Antes, digitar um preço novo não mostrava nada: o operador confirmava a
 * alteração sem ver o efeito na linha nem no documento, e só descobria o
 * total depois — quando desfazer já custava outra alteração, com outro
 * motivo, no histórico. Agora a prévia sai da mesma função que a API usa
 * para emitir, o gravado continua na tela com o próprio nome, e o preço
 * acordado no Pedido não é tocado.
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
    agreedUnitPrice: "12.5000",
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
  const lines = overrides.lines ?? [linha()];
  const totalAmount = lines.every((line) => line.lineTotal !== null)
    ? lines.reduce((sum, line) => sum + Number(line.lineTotal), 0).toFixed(2)
    : null;
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
    totalQuantity: lines.reduce((sum, line) => sum + Number(line.quantity), 0).toString(),
    totalAmount,
    hasCompletePricing: totalAmount !== null,
    issuedAt: null,
    issuedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
    lines,
  };
}

async function abrir(doc: BillingDTO) {
  vi.mocked(getBilling).mockResolvedValue(doc);
  render(
    <MemoryRouter initialEntries={["/comercial/faturamento/fat-1"]}>
      <Routes>
        <Route path="/comercial/faturamento/:id" element={<BillingPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "FAT-000001" });
}

/** `toLocaleString` separa R$ do número com espaço FINO — normalizar para ler. */
function texto(valor: string | null | undefined): string {
  return (valor ?? "").replace(/ /g, " ");
}

/** O valor ao lado de um rótulo em `<dl>` — o `<dd>` que segue aquele `<dt>`. */
function valorDe(rotulo: string): string {
  const dt = screen.getByText(rotulo, { selector: "dt" });
  return texto(dt.nextElementSibling?.textContent);
}

/** O rodapé da tabela de itens — onde vive o total do documento. */
function rodape(): string {
  return texto(document.querySelector(".table-foot")?.textContent);
}

async function abrirOverride(doc: BillingDTO) {
  await abrir(doc);
  fireEvent.click(screen.getAllByRole("button", { name: "Alterar preço de faturamento" })[0]!);
  await screen.findByRole("heading", { name: "Alterar preço de faturamento" });
}

beforeEach(() => {
  vi.mocked(getBilling).mockReset();
  vi.mocked(updateBilling).mockReset();
  vi.mocked(issueBilling).mockReset();
  vi.mocked(cancelBilling).mockReset();
  vi.mocked(overrideBillingPrice).mockReset();
});

describe("#8D — preço de faturamento em edição mostra o total resultante", () => {
  it("A. preço novo muda o subtotal da linha em prévia", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    // 100 × 13,2500 = 1.325,00.
    expect(valorDe("Total da linha (prévia)")).toContain("R$ 1.325,00");
  });

  it("B. o total do documento acompanha o subtotal da linha", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    expect(valorDe("Total do documento (prévia)")).toContain("R$ 1.325,00");
  });

  it("C. com várias linhas, o total soma a alterada com as gravadas", async () => {
    await abrirOverride(
      faturamento({
        lines: [
          linha(),
          linha({ id: "bl-2", productCode: "PROD-000002", quantity: "50", unitPrice: "3.0000", agreedUnitPrice: "3.0000", lineTotal: "150.00", position: 1 }),
        ],
      }),
    );
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    // 1.325,00 (alterada) + 150,00 (gravada) = 1.475,00.
    expect(valorDe("Total do documento (prévia)")).toContain("R$ 1.475,00");
  });

  it("D. preço de 4 casas entra inteiro na conta", async () => {
    await abrirOverride(faturamento({ lines: [linha({ quantity: "123" })] }));
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "4,0531" } });
    // 123 × 4,0531 = 498,5313 → R$ 498,53.
    expect(valorDe("Total da linha (prévia)")).toContain("R$ 498,53");
  });

  it("E. o preço acordado e os totais gravados continuam à vista e nomeados", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    expect(valorDe("Preço acordado")).toContain("R$ 12,50");
    expect(valorDe("Total da linha gravado")).toContain("R$ 1.250,00");
    expect(valorDe("Total do documento gravado")).toContain("R$ 1.250,00");
  });

  it("F. digitar o preço não grava nada", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Desconto acordado" } });
    expect(overrideBillingPrice).not.toHaveBeenCalled();
    expect(updateBilling).not.toHaveBeenCalled();
    expect(issueBilling).not.toHaveBeenCalled();
  });

  it("G. cancelar fecha sem gravar e o documento segue com o valor salvo", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Alterar preço de faturamento" })).toBeNull(),
    );
    expect(overrideBillingPrice).not.toHaveBeenCalled();
    expect(rodape()).toContain("Valor total (prévia): R$ 1.250,00");
  });

  it("H. confirmar envia o preço que gerou a prévia, com motivo", async () => {
    vi.mocked(overrideBillingPrice).mockResolvedValue(
      faturamento({
        lines: [linha({ unitPrice: "13.2500", lineTotal: "1325.00", priceOverridden: true })],
      }),
    );
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Desconto acordado" } });
    fireEvent.click(screen.getByRole("button", { name: "Alterar preço" }));

    await waitFor(() => expect(overrideBillingPrice).toHaveBeenCalled());
    const [, , payload] = vi.mocked(overrideBillingPrice).mock.calls[0]!;
    expect(payload.unitPrice).toBe("13.25");
    // O documento passa a valer o que a prévia mostrava.
    await waitFor(() => expect(rodape()).toContain("Valor total (prévia): R$ 1.325,00"));
  });

  it("I. erro do servidor mantém a prévia separada do salvo", async () => {
    vi.mocked(overrideBillingPrice).mockRejectedValue(new Error("Falha de rede"));
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "13,25" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Desconto acordado" } });
    fireEvent.click(screen.getByRole("button", { name: "Alterar preço" }));

    await screen.findByText("Falha de rede");
    expect(valorDe("Total da linha (prévia)")).toContain("R$ 1.325,00");
    expect(valorDe("Total da linha gravado")).toContain("R$ 1.250,00");
  });

  it("J. faturamento emitido não oferece alteração de preço", async () => {
    await abrir(faturamento({ status: "ISSUED", issuedAt: "2026-09-02T00:00:00.000Z" }));
    expect(screen.queryByRole("button", { name: "Alterar preço de faturamento" })).toBeNull();
    // Fora do rascunho o rodapé é o valor do documento, não uma prévia.
    expect(rodape()).not.toContain("prévia");
    expect(rodape()).toContain("Valor total: R$ 1.250,00");
  });

  it("K. preço inválido não vira total falso e trava a confirmação", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "1.2.3" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Desconto acordado" } });

    expect(screen.getByText(/Preço faturado: informe um valor numérico/)).toBeTruthy();
    expect(valorDe("Total da linha (prévia)")).not.toContain("R$");
    expect(valorDe("Total do documento (prévia)")).not.toContain("R$");
    expect(
      (screen.getByRole("button", { name: "Alterar preço" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("L. preço negativo é recusado como ilegível, sem produzir total", async () => {
    await abrirOverride(faturamento());
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "-5" } });
    expect(valorDe("Total da linha (prévia)")).not.toContain("R$");
    expect(
      (screen.getByRole("button", { name: "Alterar preço" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("#8D — rodapé do faturamento diz prévia ou gravado", () => {
  it("em rascunho o rodapé é a prévia dos preços que estão na tela", async () => {
    await abrir(
      faturamento({
        lines: [linha({ agreedUnitPrice: null, unitPrice: null, lineTotal: null })],
      }),
    );
    expect(rodape()).toContain("Valor total (prévia): Valores incompletos");

    fireEvent.change(screen.getByLabelText(/Preço faturado de PROD-000001/), {
      target: { value: "13,25" },
    });
    expect(rodape()).toContain("Valor total (prévia): R$ 1.325,00");
  });

  it("prévia diferente do salvo mostra o gravado, nomeado", async () => {
    await abrir(
      faturamento({
        lines: [linha({ agreedUnitPrice: null })],
      }),
    );
    fireEvent.change(screen.getByLabelText(/Preço faturado de PROD-000001/), {
      target: { value: "13,25" },
    });
    expect(screen.getByText(/Valor total gravado: R\$ 1\.250,00/)).toBeTruthy();
  });

  it("preço ilegível não vira zero: o rodapé fica sem total", async () => {
    await abrir(
      faturamento({
        lines: [linha({ agreedUnitPrice: null })],
      }),
    );
    fireEvent.change(screen.getByLabelText(/Preço faturado de PROD-000001/), {
      target: { value: "1.2.3" },
    });
    expect(rodape()).toContain("Valor total (prévia): Valores incompletos");
    expect(
      (screen.getByRole("button", { name: "Emitir faturamento" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
