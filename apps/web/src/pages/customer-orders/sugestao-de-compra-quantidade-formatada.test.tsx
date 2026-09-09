import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  CustomerOrderDTO,
  CustomerSuppliedMaterialRowDTO,
  PurchaseSuggestionRowDTO,
} from "@veridi/shared";

/**
 * Quantidade na Sugestão de Compra sai pelo formatador canônico — F-07-1.
 *
 * A necessidade da Taurina aparecia como `6.122448979592`: doze casas e PONTO
 * decimal, ao lado do MESMO número escrito `6,122449 kg` na tabela logo acima
 * da mesma página. Para um leitor brasileiro o ponto sugere "6 mil", e quem
 * compra lê o número errado.
 *
 * A causa é literal: as células imprimiam a string da API direto no JSX. A API
 * entrega `DECIMAL(24,12)` como texto, e texto no JSX é texto na tela.
 *
 * O que estes testes fixam: a tela usa `formatQuantity` — o mesmo das demais
 * colunas —, o dado cru continua íntegro no DTO (formatador nunca alimenta
 * escrita), e a unidade continua colada na quantidade que já a tinha.
 */

vi.mock("../../lib/customer-orders-api", () => ({
  applyFulfillmentPlan: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  getCustomerOrder: vi.fn(),
  getFulfillmentPlan: vi.fn(),
  getPlanPurchaseSourcing: vi.fn(),
  getPurchaseSuggestion: vi.fn(),
  updateCustomerOrder: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/supplier-items-api", () => ({ listSupplierItems: vi.fn() }));
vi.mock("../../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

import {
  getCustomerOrder,
  getFulfillmentPlan,
  getPlanPurchaseSourcing,
  getPurchaseSuggestion,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { listItems } from "../../lib/items-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { getReservationStatus } from "../../lib/shipments-api";
import { CustomerOrderPage } from "./CustomerOrderPage";

/** O valor exato da auditoria: pureza aplicada, doze casas guardadas. */
const CRU = "6.122448979592";
const FORMATADO = "6,122449";

function pedido(): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    customerTradeName: "Cliente Teste",
    customerCnpj: null,
    customerAddress: {
      street: "Rua das Palmeiras",
      number: "120",
      complement: null,
      district: "Centro",
      zipCode: "13010-000",
      city: "Campinas",
      state: "SP",
    },
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "IN_FULFILLMENT",
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: "prod-1",
        productCode: "PROD-000215",
        productName: "Produto Teste",
        unitCode: "un",
        orderedQuantity: "1000",
        shippedQuantity: "0",
        outstandingQuantity: "1000",
        billedQuantity: "0",
        unbilledShippedQuantity: "0",
        reservedRemaining: "0",
        pendingProductionQuantity: "0",
        agreedPrice: null,
      },
    ],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: [],
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "NOT_BILLED",
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
  } as unknown as CustomerOrderDTO;
}

function linhaDeCompra(
  overrides: Partial<PurchaseSuggestionRowDTO> = {},
): PurchaseSuggestionRowDTO {
  return {
    itemId: "item-1",
    itemCode: "MP-000167",
    itemName: "Taurina",
    unitCode: "kg",
    remainingRequired: CRU,
    ownReserved: "0",
    globalReserved: "0",
    available: "0",
    onOrder: "0",
    operationalShortage: CRU,
    draftPurchaseQuantity: "0",
    suggestedAdditionalPurchase: CRU,
    newSuggestedPurchase: CRU,
    supplierCandidates: [],
    recommendedSupplierItemId: null,
    ...overrides,
  };
}

function linhaDoCliente(
  overrides: Partial<CustomerSuppliedMaterialRowDTO> = {},
): CustomerSuppliedMaterialRowDTO {
  return {
    itemId: "item-2",
    itemCode: "MP-000200",
    itemName: "Material do cliente",
    unitCode: "kg",
    customerId: "cli-1",
    customerName: "Cliente Teste",
    remainingRequired: CRU,
    ownReserved: "0",
    available: "0",
    shortage: "0",
    ...overrides,
  };
}

function sugestao(
  rows: PurchaseSuggestionRowDTO[],
  customerSuppliedRows: CustomerSuppliedMaterialRowDTO[] = [],
) {
  return {
    customerOrderId: "co-1",
    rows,
    customerSuppliedRows,
    pendingProductionOrders: [],
  };
}

function abrirPedido() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * A linha inteira da tabela, como texto — é nela que o cru aparecia.
 *
 * A busca é pelo `<tr>`, e não por um texto: o código do item vive dentro de
 * um `EntityLink`, que o quebra em mais de um nó.
 */
async function textoDaLinha(itemCode: string): Promise<string> {
  let texto = "";
  await waitFor(() => {
    const linha = Array.from(document.querySelectorAll("tr")).find((tr) =>
      (tr.textContent ?? "").includes(itemCode),
    );
    expect(linha, `linha de ${itemCode} não encontrada`).toBeTruthy();
    texto = linha!.textContent ?? "";
  });
  return texto;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [] } as never);
  vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({ rows: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getReservationStatus).mockResolvedValue({
    customerOrderId: "co-1",
    lines: [],
  } as never);
  vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
});

describe("F-07-1 — quantidade da Sugestão de Compra sai formatada", () => {
  it("6.122448979592 vira 6,122449 — nenhuma célula imprime o decimal cru", async () => {
    vi.mocked(getPurchaseSuggestion).mockResolvedValue(sugestao([linhaDeCompra()]) as never);

    abrirPedido();

    const linha = await textoDaLinha("MP-000167");
    expect(linha).toContain(FORMATADO);
    // Nem a string crua, nem o ponto decimal, em nenhuma das quatro células.
    expect(linha).not.toContain(CRU);
    expect(linha).not.toMatch(/\d\.\d/);
  });

  it("a unidade continua colada na quantidade que já a tinha", async () => {
    vi.mocked(getPurchaseSuggestion).mockResolvedValue(sugestao([linhaDeCompra()]) as never);

    abrirPedido();

    expect(await textoDaLinha("MP-000167")).toContain(`${FORMATADO} kg`);
  });

  it("inteiro continua inteiro — o formatador não inventa casas decimais", async () => {
    vi.mocked(getPurchaseSuggestion).mockResolvedValue(
      sugestao([
        linhaDeCompra({
          itemCode: "MP-000900",
          remainingRequired: "12.000000000000",
          operationalShortage: "12",
          suggestedAdditionalPurchase: "12",
          newSuggestedPurchase: "12",
        }),
      ]) as never,
    );

    abrirPedido();

    const linha = await textoDaLinha("MP-000900");
    expect(linha).toContain("12 kg");
    expect(linha).not.toContain("12,000000");
    expect(linha).not.toContain("12.000000000000");
  });

  it("quantidade menor que a menor casa exibida vira ≈ 0, nunca 0", async () => {
    vi.mocked(getPurchaseSuggestion).mockResolvedValue(
      sugestao([
        linhaDeCompra({
          itemCode: "MP-000901",
          remainingRequired: "0.000000400000",
          operationalShortage: "0.000000400000",
          suggestedAdditionalPurchase: "0.000000400000",
          newSuggestedPurchase: "0.000000400000",
        }),
      ]) as never,
    );

    abrirPedido();

    const linha = await textoDaLinha("MP-000901");
    // "0 kg" diria "não precisa de material" sobre material que existe.
    expect(linha).toContain("≈ 0");
    expect(linha).not.toContain("0.0000004");
  });

  it("a tabela de material do cliente segue a mesma regra", async () => {
    vi.mocked(getPurchaseSuggestion).mockResolvedValue(
      sugestao([], [linhaDoCliente()]) as never,
    );

    abrirPedido();

    const linha = await textoDaLinha("MP-000200");
    expect(linha).toContain(`${FORMATADO} kg`);
    expect(linha).not.toContain(CRU);
  });

  it("o dado cru chega intacto à tela — o formatador é só apresentação", async () => {
    const dto = sugestao([linhaDeCompra()]);
    vi.mocked(getPurchaseSuggestion).mockResolvedValue(dto as never);

    abrirPedido();

    await waitFor(() => expect(vi.mocked(getPurchaseSuggestion)).toHaveBeenCalled());
    await textoDaLinha("MP-000167");
    // Nada da tela reescreve o DTO: quem for gerar OC parte das doze casas.
    expect(dto.rows[0]!.remainingRequired).toBe(CRU);
    expect(dto.rows[0]!.newSuggestedPurchase).toBe(CRU);
  });
});
