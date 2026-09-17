import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, PurchaseOrderDTO, ReceiptDTO } from "@veridi/shared";
import { USER_ROLES } from "@veridi/shared";

/**
 * Custo efetivo de aquisição por perfil, na tela — ACQUISITION-COST-PERMISSION-01.
 *
 * A API recusa o custo de quem não é Compras nem Administrador, no documento
 * do recebimento e já na criação. A tela não oferece o que terminaria em 403:
 * no documento, "Definir custo" e "Atualizar custo" só aparecem para quem
 * informa, e o valor continua à vista de todos; em "Receber OC", quem não
 * informa recebe sem o campo de custo, lê a quem ele cabe, e o envio não leva
 * custo nenhum.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

vi.mock("../../lib/receiving-api", () => ({
  getReceipt: vi.fn(),
  createReceipt: vi.fn(),
  createCustomerSuppliedReceipt: vi.fn(),
  listReceipts: vi.fn(),
}));
vi.mock("../../lib/costs-api", () => ({ setAcquisitionCost: vi.fn() }));
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  listPurchaseOrders: vi.fn(async () => ({ purchaseOrders: [], total: 0 })),
}));
vi.mock("../../lib/items-api", () => ({
  getItem: vi.fn(),
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
}));

import { createReceipt, getReceipt } from "../../lib/receiving-api";
import { setAcquisitionCost } from "../../lib/costs-api";
import { getPurchaseOrder } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { ReceiptDetailPage } from "./ReceiptDetailPage";
import { ReceivePurchaseOrderPage } from "./ReceivePurchaseOrderPage";

/** Escrita por extenso: trocar a lista do shared sem trocar a regra derruba este arquivo. */
const AUTORIZADOS = ["PURCHASING", "ADMIN"];
const RECUSADOS = ["PRODUCTION", "QUALITY", "COMMERCIAL", "VIEWER"];

const FRASE_DE_QUEM_INFORMA =
  "O custo efetivo de aquisição é informado por Compras ou Administrador, no documento do recebimento.";

type LinhaDoRecebimento = ReceiptDTO["lines"][number];

function linhaDoRecebimento(overrides: Partial<LinhaDoRecebimento> = {}): LinhaDoRecebimento {
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
  } as LinhaDoRecebimento;
}

/** Um recebimento com uma linha sem custo e outra com custo gravado. */
function recebimento(): ReceiptDTO {
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
    lines: [
      linhaDoRecebimento(),
      linhaDoRecebimento({
        id: "rl-2",
        purchaseOrderLineId: "pol-2",
        itemId: "item-2",
        itemCode: "MP-000002",
        itemName: "Vitamina D",
        lotId: "lot-2",
        lotCode: "LT-20260901-000002",
        actualUnitCost: "9.37000000",
        costUpdatedAt: "2026-09-02T00:00:00.000Z",
        costUpdatedBy: "Compras",
      }),
    ],
  } as ReceiptDTO;
}

async function abrirDocumento() {
  vi.mocked(getReceipt).mockResolvedValue(recebimento());
  render(
    <MemoryRouter initialEntries={["/compras/recebimentos/rec-1"]}>
      <Routes>
        <Route path="/compras/recebimentos/:id" element={<ReceiptDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "REC-000001" });
}

function ordemDeCompra(): PurchaseOrderDTO {
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
    lines: [
      {
        id: "poline-a",
        itemId: "item-a",
        itemCode: "MP-000120",
        itemName: "Material MP-000120",
        unitCode: "kg",
        orderedQuantity: "50",
        receivedQuantity: "0",
        openQuantity: "50",
        unitPrice: "12.50000000",
        lineTotal: null,
      },
    ],
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

function abrirRecebimento() {
  render(
    <MemoryRouter initialEntries={["/compras/recebimentos/novo?purchaseOrderId=po-1"]}>
      <Routes>
        <Route path="/compras/recebimentos/novo" element={<ReceivePurchaseOrderPage />} />
        <Route path="/compras/recebimentos/:id" element={<p>Recebimento gravado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function secaoDoItem(itemCode: string): Promise<HTMLElement> {
  const titulo = await screen.findByText(new RegExp(`^${itemCode} —`));
  const secao = titulo.closest("section");
  if (!secao) throw new Error(`seção do item ${itemCode} não encontrada`);
  return secao as HTMLElement;
}

/** Recebe 30 kg e confirma no diálogo; devolve a linha que a tela mandou para a API. */
async function receberTrinta(usuario: ReturnType<typeof userEvent.setup>, secao: HTMLElement) {
  await usuario.type(within(secao).getByLabelText(/Receber agora/), "30");
  await usuario.click(screen.getByRole("button", { name: /Confirmar recebimento/ }));
  await usuario.click(await screen.findByRole("button", { name: "Confirmar" }));
  await waitFor(() => expect(createReceipt).toHaveBeenCalledTimes(1));
  const [, payload] = vi.mocked(createReceipt).mock.calls[0]!;
  return payload.lines[0]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessao.role = "ADMIN";
  vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
  vi.mocked(getItem).mockImplementation(
    async (id: string) =>
      ({
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
      }) as unknown as ItemDTO,
  );
  vi.mocked(createReceipt).mockResolvedValue({ id: "rec-1" } as Awaited<ReturnType<typeof createReceipt>>);
});

it("a matriz cobre os seis perfis", () => {
  expect([...AUTORIZADOS, ...RECUSADOS].sort()).toEqual([...USER_ROLES].sort());
});

describe("documento do recebimento", () => {
  it.each(AUTORIZADOS)("%s vê \"Definir custo\" e \"Atualizar custo\"", async (role) => {
    sessao.role = role;
    await abrirDocumento();

    expect(screen.getByRole("button", { name: "Definir custo" }), role).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar custo" }), role).toBeInTheDocument();
  });

  it.each(RECUSADOS)("%s consulta o custo, sem ação de custo", async (role) => {
    sessao.role = role;
    await abrirDocumento();

    expect(screen.queryByRole("button", { name: /Definir custo|Atualizar custo/ }), role).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Custo efetivo de aquisição/ }), role).toBeNull();
    // A consulta é a mesma: o desconhecido e o gravado continuam à vista.
    expect(screen.getByText("Sem custo informado"), role).toBeInTheDocument();
    expect(screen.getByText(/9,37/), role).toBeInTheDocument();
    expect(setAcquisitionCost, role).not.toHaveBeenCalled();
  });
});

describe("Receber OC", () => {
  it.each(AUTORIZADOS)("%s vê o campo de custo e \"Usar preço da OC\", e o custo vai no envio", async (role) => {
    sessao.role = role;
    const usuario = userEvent.setup();
    abrirRecebimento();
    const secao = await secaoDoItem("MP-000120");

    expect(within(secao).getByRole("textbox", { name: /^Custo efetivo de aquisição/ }), role).toBeInTheDocument();
    expect(screen.queryByText(FRASE_DE_QUEM_INFORMA), role).toBeNull();

    await usuario.click(within(secao).getByRole("button", { name: "Usar preço da OC" }));
    const enviada = await receberTrinta(usuario, secao);

    expect(enviada.actualUnitCost, role).toMatch(/^12\.50*$/);
  });

  it.each(RECUSADOS)(
    "%s recebe sem o campo de custo, lê a quem ele cabe, e o envio não leva custo",
    async (role) => {
      sessao.role = role;
      const usuario = userEvent.setup();
      abrirRecebimento();
      const secao = await secaoDoItem("MP-000120");

      expect(within(secao).queryByRole("textbox", { name: /^Custo efetivo de aquisição/ }), role).toBeNull();
      expect(within(secao).queryByRole("button", { name: /Custo efetivo de aquisição/ }), role).toBeNull();
      expect(within(secao).queryByRole("button", { name: "Usar preço da OC" }), role).toBeNull();
      expect(screen.getByText(FRASE_DE_QUEM_INFORMA), role).toBeInTheDocument();

      const enviada = await receberTrinta(usuario, secao);

      expect(enviada, role).not.toHaveProperty("actualUnitCost");
      expect(enviada.receivedQuantity, role).toBe("30");
    },
  );
});
