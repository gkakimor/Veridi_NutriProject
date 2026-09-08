import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, PurchaseOrderDTO } from "@veridi/shared";

/**
 * Validação viva da quantidade no Recebimento.
 *
 * A tela já escreve "Pedido: 50 kg · Recebido: 0 kg · Aberto: 50 kg" logo acima
 * do campo — e mesmo assim digitar 80 não produzia aviso nenhum. A pessoa
 * preenchia lote, validade e custo, passava pelo diálogo de irreversibilidade e
 * só então era recusada pelo servidor (F-06-1). Depois da recusa, corrigir a
 * quantidade não limpava o alerta: ele ficava na tela contando uma história que
 * já não era verdade, até a submissão seguinte (F-06-2).
 *
 * O que estes testes protegem: a tela antecipa o que ela já sabe, o erro
 * responde à edição, e a limpeza é escopada — corrigir uma linha não apaga o
 * problema da outra. O servidor continua sendo a autoridade final; isto é
 * prevenção e explicação, não transferência de autoridade.
 */

vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  listPurchaseOrders: vi.fn(async () => ({ purchaseOrders: [], total: 0 })),
  createPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  getItem: vi.fn(),
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../../lib/receiving-api", () => ({
  createReceipt: vi.fn(),
  createCustomerSuppliedReceipt: vi.fn(),
  getReceipt: vi.fn(),
  listReceipts: vi.fn(),
}));

import { getPurchaseOrder } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { createReceipt } from "../../lib/receiving-api";
import { ReceivePurchaseOrderPage } from "./ReceivePurchaseOrderPage";

const getPurchaseOrderMock = vi.mocked(getPurchaseOrder);
const getItemMock = vi.mocked(getItem);
const createReceiptMock = vi.mocked(createReceipt);

/** O saldo real tem doze casas; a tela mostra seis. É a diferença que importa. */
const SALDO_LONGO = "6.122448979592";
const SALDO_LONGO_EXIBIDO = "6,122449";

function item(id: string): ItemDTO {
  return {
    id,
    code: id.toUpperCase(),
    name: `Item ${id}`,
    type: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: false,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as ItemDTO;
}

function linha(overrides: {
  id: string;
  itemCode: string;
  orderedQuantity: string;
  receivedQuantity: string;
  openQuantity: string;
}) {
  return {
    itemId: `item-${overrides.id}`,
    itemName: `Material ${overrides.itemCode}`,
    unitCode: "kg",
    unitPrice: null,
    lineTotal: null,
    ...overrides,
  };
}

function ordemDeCompra(
  linhas: ReturnType<typeof linha>[] = [
    linha({
      id: "poline-a",
      itemCode: "MP-000120",
      orderedQuantity: "50",
      receivedQuantity: "0",
      openQuantity: "50",
    }),
  ],
): PurchaseOrderDTO {
  return {
    id: "po-1",
    code: "OC-000001",
    supplierId: "sup-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor de Teste",
    supplierCnpj: null,
    orderDate: new Date().toISOString(),
    expectedDeliveryDate: null,
    status: "ORDERED",
    notes: null,
    lines: linhas,
    orderTotal: null,
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: new Date().toISOString(),
    orderedBy: "Teste",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as PurchaseOrderDTO;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={["/compras/recebimentos/novo?purchaseOrderId=po-1"]}>
      <Routes>
        <Route path="/compras/recebimentos/novo" element={<ReceivePurchaseOrderPage />} />
        <Route path="/compras/recebimentos/:id" element={<p>Recebimento gravado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** O campo "Receber agora" de um item, achado pelo rótulo que a pessoa lê. */
function campoQuantidade(itemCode: string): HTMLInputElement {
  const secao = screen.getByText(new RegExp(`^${itemCode} —`)).closest("section");
  if (!secao) throw new Error(`seção do item ${itemCode} não encontrada`);
  return within(secao as HTMLElement).getByLabelText(/Receber agora/) as HTMLInputElement;
}

function botaoConfirmar(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Confirmar recebimento/ }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getItemMock.mockImplementation(async (id: string) => item(id));
  getPurchaseOrderMock.mockResolvedValue(ordemDeCompra());
});

describe("Recebimento — a tela antecipa o que já sabe (F-06-1)", () => {
  it("quantidade acima do saldo aberto avisa antes de qualquer envio", async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "80");

    expect(await screen.findByText(/Máximo 50 kg/)).toBeTruthy();
    expect(createReceiptMock).not.toHaveBeenCalled();
  });

  it("ação de confirmar fica bloqueada enquanto houver linha inválida", async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "80");

    await waitFor(() => expect(botaoConfirmar().disabled).toBe(true));
  });

  it("nenhuma requisição sai na tentativa inválida", async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "80");
    await screen.findByText(/Máximo 50 kg/);
    await usuario.click(botaoConfirmar());

    expect(createReceiptMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirmar recebimento?")).toBeNull();
  });

  it("quantidade parcial é válida e libera a ação", async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "30");

    await waitFor(() => expect(botaoConfirmar().disabled).toBe(false));
    expect(screen.queryByText(/Máximo 50 kg/)).toBeNull();
  });

  it("receber exatamente o saldo é válido — sem falso positivo de arredondamento", async () => {
    getPurchaseOrderMock.mockResolvedValue(
      ordemDeCompra([
        linha({
          id: "poline-a",
          itemCode: "MP-000120",
          orderedQuantity: "10",
          receivedQuantity: "3.877551020408",
          openQuantity: SALDO_LONGO,
        }),
      ]),
    );
    const usuario = userEvent.setup();
    renderizar();

    // O que a tela escreve é o que a pessoa digita de volta: digitar o teto
    // exibido é pedir o saldo inteiro, não passar dele.
    await usuario.type(await encontrarCampo("MP-000120"), SALDO_LONGO_EXIBIDO);

    await waitFor(() => expect(botaoConfirmar().disabled).toBe(false));
    expect(screen.queryByText(/Máximo/)).toBeNull();
  });

  it("uma casa decimal acima do saldo é recusada, sem tolerância", async () => {
    getPurchaseOrderMock.mockResolvedValue(
      ordemDeCompra([
        linha({
          id: "poline-a",
          itemCode: "MP-000120",
          orderedQuantity: "10",
          receivedQuantity: "3.877551020408",
          openQuantity: SALDO_LONGO,
        }),
      ]),
    );
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "6,122448979593");

    expect(await screen.findByText(/Máximo 6,122449 kg/)).toBeTruthy();
    await waitFor(() => expect(botaoConfirmar().disabled).toBe(true));
  });

  it("texto ilegível — vírgula dupla, sinal negativo — nomeia o formato aceito", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await encontrarCampo("MP-000120");
    await usuario.type(campo, "-5");
    expect(await screen.findByText(/valor numérico válido/)).toBeTruthy();
    await waitFor(() => expect(botaoConfirmar().disabled).toBe(true));

    await usuario.clear(campo);
    await usuario.type(campo, "1.234,5");
    expect(await screen.findByText(/valor numérico válido/)).toBeTruthy();
  });

  it("zero não recebe a linha, e a tela diz por quê", async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "0");

    expect(await screen.findByText(/maior que zero/)).toBeTruthy();
    await waitFor(() => expect(botaoConfirmar().disabled).toBe(true));
  });

  it("campo em branco não é erro — é linha que não entra", async () => {
    renderizar();

    await encontrarCampo("MP-000120");
    expect(screen.queryByText(/Máximo/)).toBeNull();
    expect(screen.queryByText(/valor numérico válido/)).toBeNull();
    expect(botaoConfirmar().disabled).toBe(true);
  });

  it("o envio usa a mesma validação: o teto vai canônico, com as doze casas", async () => {
    getPurchaseOrderMock.mockResolvedValue(
      ordemDeCompra([
        linha({
          id: "poline-a",
          itemCode: "MP-000120",
          orderedQuantity: "10",
          receivedQuantity: "3.877551020408",
          openQuantity: SALDO_LONGO,
        }),
      ]),
    );
    createReceiptMock.mockResolvedValue({ id: "rec-1" } as Awaited<ReturnType<typeof createReceipt>>);
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), SALDO_LONGO_EXIBIDO);
    await waitFor(() => expect(botaoConfirmar().disabled).toBe(false));
    await usuario.click(botaoConfirmar());
    await usuario.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(createReceiptMock).toHaveBeenCalled());
    const payload = createReceiptMock.mock.calls[0]?.[1] as {
      lines: { receivedQuantity: string }[];
    };
    expect(payload.lines[0]?.receivedQuantity).toBe(SALDO_LONGO);
  });
});

describe("Recebimento — o erro responde à edição (F-06-2)", () => {
  it("o alerta do servidor some assim que a quantidade é corrigida", async () => {
    createReceiptMock.mockRejectedValue(
      new Error("Quantidade recebida excede o saldo em aberto da linha: MP-000120"),
    );
    const usuario = userEvent.setup();
    renderizar();

    // 50 passa na validação local; o servidor recusa por um recebimento
    // concorrente que a tela não viu.
    const campo = await encontrarCampo("MP-000120");
    await usuario.type(campo, "50");
    await usuario.click(botaoConfirmar());
    await usuario.click(await screen.findByRole("button", { name: "Confirmar" }));

    const alerta = await screen.findByText(/excede o saldo em aberto/);
    expect(alerta).toBeTruthy();

    await usuario.clear(campo);
    await usuario.type(campo, "30");

    await waitFor(() => expect(screen.queryByText(/excede o saldo em aberto/)).toBeNull());
  });

  it("corrigir uma linha não apaga o problema da outra", async () => {
    getPurchaseOrderMock.mockResolvedValue(
      ordemDeCompra([
        linha({
          id: "poline-a",
          itemCode: "MP-000120",
          orderedQuantity: "50",
          receivedQuantity: "0",
          openQuantity: "50",
        }),
        linha({
          id: "poline-b",
          itemCode: "MP-000365",
          orderedQuantity: "10",
          receivedQuantity: "4",
          openQuantity: "6",
        }),
      ]),
    );
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000120"), "80");
    await usuario.type(campoQuantidade("MP-000365"), "9");

    expect(await screen.findByText(/Máximo 50 kg/)).toBeTruthy();
    expect(await screen.findByText(/Máximo 6 kg/)).toBeTruthy();

    const campoA = campoQuantidade("MP-000120");
    await usuario.clear(campoA);
    await usuario.type(campoA, "30");

    await waitFor(() => expect(screen.queryByText(/Máximo 50 kg/)).toBeNull());
    // O problema da outra linha continua na tela, e continua bloqueando.
    expect(screen.getByText(/Máximo 6 kg/)).toBeTruthy();
    expect(botaoConfirmar().disabled).toBe(true);

    const campoB = campoQuantidade("MP-000365");
    await usuario.clear(campoB);
    await usuario.type(campoB, "6");

    await waitFor(() => expect(screen.queryByText(/Máximo 6 kg/)).toBeNull());
    expect(botaoConfirmar().disabled).toBe(false);
  });

  it("erro de campo do servidor pousa na linha certa mesmo com linha em branco antes", async () => {
    getPurchaseOrderMock.mockResolvedValue(
      ordemDeCompra([
        linha({
          id: "poline-a",
          itemCode: "MP-000120",
          orderedQuantity: "50",
          receivedQuantity: "0",
          openQuantity: "50",
        }),
        linha({
          id: "poline-b",
          itemCode: "MP-000365",
          orderedQuantity: "10",
          receivedQuantity: "4",
          openQuantity: "6",
        }),
      ]),
    );
    const { ApiValidationError } = await import("../../lib/api-errors");
    createReceiptMock.mockRejectedValue(
      // A primeira linha do PAYLOAD é a MP-000365: a MP-000120 ficou em branco.
      new ApiValidationError([
        { path: "lines.0.receivedQuantity", message: "Valor com precisão acima do suportado." },
      ]),
    );
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(await encontrarCampo("MP-000365"), "5");
    await usuario.click(botaoConfirmar());
    await usuario.click(await screen.findByRole("button", { name: "Confirmar" }));

    const secaoB = (await screen.findByText(/^MP-000365 —/)).closest("section") as HTMLElement;
    expect(
      await within(secaoB).findByText("Valor com precisão acima do suportado."),
    ).toBeTruthy();

    const secaoA = screen.getByText(/^MP-000120 —/).closest("section") as HTMLElement;
    expect(within(secaoA).queryByText("Valor com precisão acima do suportado.")).toBeNull();
  });
});

/** Espera a OC carregar e devolve o campo de quantidade daquele item. */
async function encontrarCampo(itemCode: string): Promise<HTMLInputElement> {
  await screen.findByText(new RegExp(`^${itemCode} —`));
  return campoQuantidade(itemCode);
}
