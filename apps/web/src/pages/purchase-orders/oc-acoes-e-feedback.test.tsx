import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type { PurchaseOrderDTO } from "@veridi/shared";

/**
 * SAVE-FEEDBACK-REMAINING-01 na Ordem de Compra.
 *
 * "Salvando…" aparecia nos dois botões de salvar também durante confirmar e
 * cancelar (um `saving` só), e nenhum salvamento dizia que gravou. O que se
 * protege: o rótulo é da ação em curso, a frase nomeia o que gravou e só chega
 * com a resposta, a recusa nunca vira sucesso, e a pendência da guarda vem
 * antes da frase.
 */

vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  confirmPurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: () => Promise.resolve({ suppliers: [] }),
}));
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: () => Promise.resolve({ supplierItems: [] }),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
  getItem: vi.fn(),
}));

import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  getPurchaseOrder,
  updatePurchaseOrder,
} from "../../lib/purchase-orders-api";
import { PurchaseOrderPage } from "./PurchaseOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function ordem(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "oc-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierCnpj: null,
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [
      {
        id: "pol-1",
        itemId: "item-1",
        itemCode: "MP-000001",
        itemName: "Vitamina C",
        unitCode: "kg",
        orderedQuantity: "10.000000",
        unitPrice: "12.5000",
        lineTotal: "125.00",
        receivedQuantity: "0",
        openQuantity: "10",
      },
    ],
    orderTotal: "125.00",
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    ...overrides,
  } as PurchaseOrderDTO;
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

async function abrir(dto = ordem()) {
  vi.mocked(getPurchaseOrder).mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
      </Route>,
    ),
    { initialEntries: ["/compras/ordens/oc-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "OC-000001" });
  await waitFor(() => expect(observacoes()).toHaveValue(dto.notes ?? ""));
}

const botao = (nome: string) => screen.getByRole("button", { name: nome });
const observacoes = () => document.getElementById("po-notes") as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OC em rascunho — Salvar rascunho responde", () => {
  it("\"Salvando…\" só no botão de salvar e \"Rascunho salvo.\" só com a resposta", async () => {
    /* O botão só acorda com pendência (SAVE-FLOW-HARDENING-01), e a pendência
       ocupa o lugar da frase. Desfazer a edição durante a requisição tira a
       pendência da tela: uma confirmação adiantada para antes do `await`
       apareceria aqui. */
    const gravacao = pendente<PurchaseOrderDTO>();
    vi.mocked(updatePurchaseOrder).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(observacoes(), { target: { value: "Entregar pela manhã" } });
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    // O vizinho recusa o clique, mas não rouba o rótulo.
    expect(botao("Confirmar OC")).toBeDisabled();
    fireEvent.change(observacoes(), { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();

    gravacao.resolver(ordem({ notes: "Entregar pela manhã" }));

    const frase = await screen.findByText("Rascunho salvo.");
    expect(frase).toHaveAttribute("role", "status");
    expect(frase.closest(".doc-actions__primary")).toContainElement(botao("Salvar rascunho"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("clique duplo grava uma vez só", async () => {
    const gravacao = pendente<PurchaseOrderDTO>();
    vi.mocked(updatePurchaseOrder).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(observacoes(), { target: { value: "Entregar pela manhã" } });
    fireEvent.click(botao("Salvar rascunho"));
    fireEvent.click(botao("Salvando…"));

    expect(updatePurchaseOrder).toHaveBeenCalledTimes(1);
    gravacao.resolver(ordem({ notes: "Entregar pela manhã" }));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    expect(updatePurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("recusa fica em role=alert com a mensagem da API e nunca vira sucesso", async () => {
    const gravacao = pendente<PurchaseOrderDTO>();
    vi.mocked(updatePurchaseOrder).mockReturnValue(gravacao.promessa);
    await abrir();

    fireEvent.change(observacoes(), { target: { value: "Entregar pela manhã" } });
    fireEvent.click(botao("Salvar rascunho"));
    await screen.findByRole("button", { name: "Salvando…" });
    gravacao.recusar(new Error("Fornecedor inativo não pode receber OC."));

    expect(await screen.findByRole("alert")).toHaveTextContent("Fornecedor inativo não pode receber OC.");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(botao("Salvar rascunho")).toBeEnabled();

    // Sem a pendência na frente, nenhuma confirmação escondida aparece.
    fireEvent.change(observacoes(), { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(botao("Salvar rascunho")).toBeDisabled();
  });

  it("recusa com edição pendente: a edição e a pendência ficam", async () => {
    vi.mocked(updatePurchaseOrder).mockRejectedValue(new Error("Falha de rede"));
    await abrir();

    fireEvent.change(observacoes(), { target: { value: "Entregar pela manhã" } });
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    expect(observacoes()).toHaveValue("Entregar pela manhã");
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });

  it("gravou: a pendência some; editar de novo troca a frase pela pendência", async () => {
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordem({ notes: "Entregar pela manhã" }));
    await abrir();

    expect(botao("Salvar rascunho")).toBeDisabled();
    fireEvent.change(observacoes(), { target: { value: "Entregar pela manhã" } });
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(botao("Salvar rascunho")).toBeEnabled();
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("status")).toHaveTextContent("Rascunho salvo.");
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(botao("Salvar rascunho")).toBeDisabled();

    fireEvent.change(observacoes(), { target: { value: "Entregar à tarde" } });

    // Uma faixa só: a frase antiga não fica afirmando "salvo" ao lado da pendência.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });
});

describe("OC — ações de domínio não herdam o salvamento", () => {
  it("confirmar diz \"Confirmando…\" no próprio botão e não anuncia salvamento", async () => {
    const user = userEvent.setup();
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordem({ notes: "Entregar pela manhã" }));
    const confirmacao = pendente<PurchaseOrderDTO>();
    vi.mocked(confirmPurchaseOrder).mockReturnValue(confirmacao.promessa);
    await abrir();

    // Uma frase de salvamento anterior não sobrevive à ação seguinte.
    fireEvent.change(observacoes(), { target: { value: "Entregar pela manhã" } });
    fireEvent.click(botao("Salvar rascunho"));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();

    await user.click(botao("Confirmar OC"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("button", { name: "Confirmando…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    confirmacao.resolver(ordem({ status: "ORDERED", notes: "Entregar pela manhã" }));

    // Confirmada sem nada pendente: o salvar de previsão existe e descansa.
    expect(await screen.findByRole("button", { name: "Salvar previsão e observações" })).toBeDisabled();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(screen.queryByText("Previsão e observações salvas.")).toBeNull();
  });

  it("cancelar diz \"Cancelando…\" no diálogo, e o salvar não diz \"Salvando…\"", async () => {
    const user = userEvent.setup();
    const cancelamento = pendente<PurchaseOrderDTO>();
    vi.mocked(cancelPurchaseOrder).mockReturnValue(cancelamento.promessa);
    await abrir();

    await user.click(botao("Cancelar OC"));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialogo).getByLabelText(/Motivo do cancelamento/), {
      target: { value: "Fornecedor desistiu" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar OC" }));

    expect(await within(dialogo).findByRole("button", { name: "Cancelando…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();

    cancelamento.resolver(ordem({ status: "CANCELLED", cancelReason: "Fornecedor desistiu" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("OC confirmada — Salvar previsão e observações", () => {
  it("frase própria, só com a resposta — nunca \"Rascunho salvo.\"", async () => {
    const gravacao = pendente<PurchaseOrderDTO>();
    vi.mocked(updatePurchaseOrder).mockReturnValue(gravacao.promessa);
    await abrir(ordem({ status: "ORDERED" }));

    expect(botao("Salvar previsão e observações")).toBeDisabled();
    fireEvent.change(observacoes(), { target: { value: "Conferir laudo" } });
    fireEvent.click(botao("Salvar previsão e observações"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    // Desfazer a edição tira a pendência: uma frase adiantada apareceria aqui.
    fireEvent.change(observacoes(), { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();

    gravacao.resolver(ordem({ status: "ORDERED", notes: "Conferir laudo" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Previsão e observações salvas.");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(botao("Salvar previsão e observações")).toBeDisabled();
    expect(vi.mocked(updatePurchaseOrder).mock.calls[0]![1]).toEqual({
      expectedDeliveryDate: "",
      notes: "Conferir laudo",
    });
  });
});
