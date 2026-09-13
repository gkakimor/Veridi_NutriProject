import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReceiptDTO } from "@veridi/shared";

/**
 * SAVE-FEEDBACK-REMAINING-01 no detalhe do Recebimento.
 *
 * "Salvar custo" dizia "Salvando…", fechava o campo e mostrava o valor — o
 * mesmo desfecho visual de Cancelar. Agora a linha que gravou diz "Custo
 * salvo.", só com a resposta; a recusa nunca vira sucesso e o campo continua
 * aberto com o digitado.
 */

vi.mock("../../lib/receiving-api", () => ({ getReceipt: vi.fn() }));
vi.mock("../../lib/costs-api", () => ({ setAcquisitionCost: vi.fn() }));
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));

import { getReceipt } from "../../lib/receiving-api";
import { setAcquisitionCost } from "../../lib/costs-api";
import { ReceiptDetailPage } from "./ReceiptDetailPage";

type Linha = ReceiptDTO["lines"][number];

function linha(overrides: Partial<Linha> = {}): Linha {
  return {
    id: "rl-1",
    purchaseOrderLineId: "pol-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    receivedQuantity: "10",
    unitCode: "kg",
    supplierLot: "F-123",
    expiryDate: "2028-01-31",
    location: "Almoxarifado",
    lotId: "lot-1",
    lotCode: "LT-20260901-000001",
    ownerType: "VERIDI",
    coaStatus: "NOT_REQUIRED",
    purchaseUnitPrice: "12.5000",
    actualUnitCost: null,
    costUpdatedAt: null,
    costUpdatedBy: null,
    costNote: null,
    ...overrides,
  } as Linha;
}

function recebimento(lines: Linha[] = [linha()]): ReceiptDTO {
  return {
    id: "rec-1",
    code: "REC-000001",
    sourceType: "PURCHASE_ORDER",
    purchaseOrderId: "oc-1",
    purchaseOrderCode: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    customerId: null,
    customerCode: null,
    customerName: null,
    receivedAt: "2026-09-01T00:00:00.000Z",
    invoiceNumber: "NF 10",
    documentReference: null,
    notes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "Admin",
    lines,
  } as ReceiptDTO;
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

async function abrir(dto = recebimento()) {
  vi.mocked(getReceipt).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/compras/recebimentos/rec-1"]}>
      <Routes>
        <Route path="/compras/recebimentos/:id" element={<ReceiptDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "REC-000001" });
}

const botao = (nome: string) => screen.getByRole("button", { name: nome });
const campoDoCusto = (codigo = "MP-000001") =>
  screen.getByRole("textbox", { name: `Custo efetivo de aquisição de ${codigo}` }) as HTMLInputElement;

function editar(valor: string, botaoDaLinha = botao("Definir custo")) {
  fireEvent.click(botaoDaLinha);
  fireEvent.change(campoDoCusto(), { target: { value: valor } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Recebimento — Salvar custo responde", () => {
  it("\"Salvando…\" enquanto espera e \"Custo salvo.\" só com a resposta, na linha que gravou", async () => {
    const gravacao = pendente<ReceiptDTO>();
    vi.mocked(setAcquisitionCost).mockReturnValue(gravacao.promessa);
    await abrir();

    editar("12,75");
    fireEvent.click(botao("Salvar custo"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    gravacao.resolver(recebimento([linha({ actualUnitCost: "12.7500" })]));

    const frase = await screen.findByText("Custo salvo.");
    expect(frase).toHaveAttribute("role", "status");
    // Na célula de ação da mesma linha, junto do botão que reabre o campo.
    expect(frase.closest("td")).toContainElement(botao("Atualizar custo"));
    expect(vi.mocked(setAcquisitionCost)).toHaveBeenCalledWith("rl-1", { unitCost: "12.75" });
  });

  it("clique duplo grava uma vez só", async () => {
    const gravacao = pendente<ReceiptDTO>();
    vi.mocked(setAcquisitionCost).mockReturnValue(gravacao.promessa);
    await abrir();

    editar("12,75");
    fireEvent.click(botao("Salvar custo"));
    fireEvent.click(botao("Salvando…"));

    expect(setAcquisitionCost).toHaveBeenCalledTimes(1);
    gravacao.resolver(recebimento([linha({ actualUnitCost: "12.7500" })]));
    expect(await screen.findByText("Custo salvo.")).toBeInTheDocument();
  });

  it("recusa fica em role=alert com a mensagem da API; nada de sucesso, e o campo segue aberto", async () => {
    const gravacao = pendente<ReceiptDTO>();
    vi.mocked(setAcquisitionCost).mockReturnValue(gravacao.promessa);
    await abrir();

    editar("12,75");
    fireEvent.click(botao("Salvar custo"));
    await screen.findByRole("button", { name: "Salvando…" });
    gravacao.recusar(new Error("Custo de aquisição exige permissão de compras."));

    expect(await screen.findByRole("alert")).toHaveTextContent("Custo de aquisição exige permissão de compras.");
    expect(screen.queryByText("Custo salvo.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(campoDoCusto()).toHaveValue("12,75");
    expect(botao("Salvar custo")).toBeEnabled();

    /* Com o campo aberto a frase nem tem onde aparecer; fechá-lo é o que
       mostraria uma confirmação posta antes da resposta. */
    fireEvent.click(botao("Cancelar"));
    expect(screen.queryByText("Custo salvo.")).toBeNull();
  });

  it("voltar a editar — esta ou outra linha — tira a frase antiga", async () => {
    const duasLinhas = [
      linha(),
      linha({ id: "rl-2", purchaseOrderLineId: "pol-2", itemId: "item-2", itemCode: "MP-000002", lotId: "lot-2" }),
    ];
    vi.mocked(setAcquisitionCost).mockResolvedValue(
      recebimento([linha({ actualUnitCost: "12.7500" }), duasLinhas[1]!]),
    );
    await abrir(recebimento(duasLinhas));

    // Linha 0 é o cabeçalho; as do corpo seguem a ordem do recebimento.
    const linhaDoCorpo = (indice: number) => screen.getAllByRole("row")[indice + 1]!;

    editar("12,75", within(linhaDoCorpo(0)).getByRole("button", { name: "Definir custo" }));
    fireEvent.click(botao("Salvar custo"));
    expect(await screen.findByText("Custo salvo.")).toBeInTheDocument();
    expect(within(linhaDoCorpo(0)).getByRole("status")).toHaveTextContent("Custo salvo.");

    // Abrir o campo de OUTRA linha: a frase não fala do que está sendo editado.
    fireEvent.click(within(linhaDoCorpo(1)).getByRole("button", { name: "Definir custo" }));
    expect(screen.queryByText("Custo salvo.")).toBeNull();
  });
});
