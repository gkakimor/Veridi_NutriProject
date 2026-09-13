import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  CustomerOrderDTO,
  PurchaseSuggestionRowDTO,
  PurchaseSupplierCandidateDTO,
  SupplierDTO,
} from "@veridi/shared";
import type { ListSuppliersParams } from "../../lib/suppliers-api";

/**
 * Sugestão de Compra do Pedido — fornecedor sem corte (SELECTOR-CUTOFF-WAVE-01).
 *
 * O fornecedor de cada material era um `<select>` com dois grupos:
 * "Homologados" (os candidatos do item) e "Demais fornecedores ativos", este
 * alimentado por `listSuppliers({ active: true, pageSize: 1000 })`. Do
 * fornecedor ativo 1001 em diante a compra emergencial não tinha a quem ir.
 *
 * Agora é o combobox com busca no servidor: homologados primeiro, marcados na
 * dica; os demais ativos numa primeira página de 20 e na busca. O servidor
 * aqui guarda 1002 fornecedores e filtra, ordena e pagina o universo inteiro.
 * Reserva, plano, quantidade recomendada e a geração continuam as mesmas.
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
  generatePurchaseDrafts,
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

const PAGINA = 20;
const RUIDO = 1000;

function fornecedor(numero: number, extra: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: `for-${numero}`,
    code: `FOR-${String(numero).padStart(6, "0")}`,
    legalName: `Fornecedor de Volume ${String(numero).padStart(4, "0")} Ltda`,
    tradeName: null,
    cnpj: null,
    active: true,
    ...extra,
  } as unknown as SupplierDTO;
}

/** Homologado do material — está no universo e na primeira página. */
const HOMOLOGADO = fornecedor(7, { legalName: "Zeta Homologada Ltda" });
const ALVO = fornecedor(RUIDO + 1, { legalName: "Zeta Insumos Alvo Ltda", tradeName: "Zeta Insumos" });
const INATIVO = fornecedor(RUIDO + 2, { legalName: "Zeta Insumos Inativa Ltda", active: false });
const UNIVERSO = [
  ...Array.from({ length: RUIDO }, (_, indice) => (indice + 1 === 7 ? HOMOLOGADO : fornecedor(indice + 1))),
  ALVO,
  INATIVO,
];

function servidor(params: ListSuppliersParams = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !params.ids?.length || params.ids.includes(registro.id))
    .filter(
      (registro) =>
        !termo ||
        [registro.code, registro.legalName, registro.tradeName ?? ""].some((campo) => campo.toLowerCase().includes(termo)),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { suppliers: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

function candidato(supplier: SupplierDTO): PurchaseSupplierCandidateDTO {
  return {
    supplierItemId: `si-${supplier.id}`,
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.legalName,
    supplierItemCode: null,
    preferred: false,
    referenceUnitPrice: null,
    referenceCurrencyCode: null,
    referencePriceUomCode: null,
    referencePriceInItemUom: null,
    minimumOrderQuantity: null,
    minimumOrderUomCode: null,
    minimumOrderInItemUom: null,
    recommendedPurchaseQuantity: "10",
    moqRaisedQuantity: false,
    hasLegacyPriceReference: false,
  };
}

function linhaDeCompra(): PurchaseSuggestionRowDTO {
  return {
    itemId: "item-1",
    itemCode: "MP-000167",
    itemName: "Taurina",
    unitCode: "kg",
    remainingRequired: "10",
    ownReserved: "0",
    globalReserved: "0",
    available: "0",
    onOrder: "0",
    operationalShortage: "10",
    draftPurchaseQuantity: "0",
    suggestedAdditionalPurchase: "10",
    newSuggestedPurchase: "10",
    // Um homologado sem preferencial e com outro caminho possível: nada vem escolhido.
    supplierCandidates: [candidato(HOMOLOGADO), { ...candidato(fornecedor(8)), supplierItemId: "si-8" }],
    recommendedSupplierItemId: null,
  };
}

function pedido(linkedPurchaseOrders: CustomerOrderDTO["linkedPurchaseOrders"] = []): CustomerOrderDTO {
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
    linkedPurchaseOrders,
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

function abrirPedido() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const campo = () => screen.getByRole("combobox", { name: "Fornecedor de MP-000167" }) as HTMLInputElement;
const opcaoDe = (codigo: string) => ({ name: new RegExp(`^${codigo}`) });
const chamadas = () => vi.mocked(listSuppliers).mock.calls.map(([params]) => params ?? {});

function nenhumaConsultaAlemDaPagina() {
  expect(chamadas().length).toBeGreaterThan(0);
  for (const params of chamadas()) {
    expect(params.pageSize ?? 20).toBeLessThanOrEqual(PAGINA);
    expect(params.active).toBe(true);
  }
}

async function buscar(termo: string) {
  await waitFor(() => expect(listSuppliers).toHaveBeenCalled());
  fireEvent.focus(campo());
  fireEvent.change(campo(), { target: { value: termo } });
  await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ active: true, search: termo, pageSize: PAGINA }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSuppliers).mockImplementation(async (params) => servidor(params) as never);
  vi.mocked(listCustomers).mockResolvedValue({ customers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [] } as never);
  vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({ rows: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getReservationStatus).mockResolvedValue({ customerOrderId: "co-1", lines: [] } as never);
  vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
  vi.mocked(getPurchaseSuggestion).mockResolvedValue({
    customerOrderId: "co-1",
    rows: [linhaDeCompra()],
    customerSuppliedRows: [],
    pendingProductionOrders: [],
  } as never);
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("os 1000 ativos do grupo 'Demais fornecedores ativos' não alcançavam o #1001", () => {
    const antigos = servidor({ active: true, pageSize: 1000 }).suppliers;
    expect(antigos).toHaveLength(RUIDO);
    expect(antigos.some((registro) => registro.id === ALVO.id)).toBe(false);
  });
});

describe("Sugestão de Compra — fornecedor com busca no servidor", () => {
  it("abre com os homologados primeiro e a primeira página de ativos — 20, uma vez para a seção", async () => {
    abrirPedido();
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith({ active: true, pageSize: PAGINA }));

    fireEvent.focus(campo());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option").length).toBeGreaterThan(2));
    const opcoes = within(lista).getAllByRole("option");
    // Os dois homologados na frente, com a marca; nenhum repetido entre os demais.
    expect(opcoes[0]).toHaveTextContent(HOMOLOGADO.code);
    expect(opcoes[0]).toHaveTextContent("Homologado");
    expect(opcoes[1]).toHaveTextContent("FOR-000008");
    expect(opcoes.filter((opcao) => (opcao.textContent ?? "").startsWith(HOMOLOGADO.code))).toHaveLength(1);
    expect(opcoes).toHaveLength(PAGINA);
    expect(within(lista).queryByRole("option", opcaoDe(ALVO.code))).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();
    expect(listSuppliers).toHaveBeenCalledTimes(1);
    nenhumaConsultaAlemDaPagina();
  });

  it("fornecedor #1001 achado pelo código, escolhido, e as OCs em rascunho saem com ele", async () => {
    vi.mocked(generatePurchaseDrafts).mockResolvedValue(
      pedido([
        { id: "po-1", code: "OC-000321", supplierId: ALVO.id, supplierName: ALVO.tradeName!, lineCount: 1, status: "DRAFT", orderTotal: null },
      ]),
    );
    abrirPedido();
    await buscar(ALVO.code);
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(ALVO.code)));
    await waitFor(() => expect(campo()).toHaveValue(`${ALVO.code} · ${ALVO.tradeName}`));

    const gerar = screen.getByRole("button", { name: "Gerar OCs em rascunho" }) as HTMLButtonElement;
    await waitFor(() => expect(gerar.disabled).toBe(false));
    fireEvent.click(gerar);
    const botoes = await screen.findAllByRole("button", { name: "Gerar OCs em rascunho" });
    fireEvent.click(botoes[botoes.length - 1]!);

    await waitFor(() =>
      expect(generatePurchaseDrafts).toHaveBeenCalledWith("co-1", {
        lines: [{ itemId: "item-1", quantity: "10", supplierId: ALVO.id }],
      }),
    );
    // A OC gerada volta do servidor com o fornecedor — e o campo da linha mantém o nome.
    expect(await screen.findByText("OC-000321")).toBeInTheDocument();
    await waitFor(() => expect(getPurchaseSuggestion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(campo()).toHaveValue(`${ALVO.code} · ${ALVO.tradeName}`));
    nenhumaConsultaAlemDaPagina();
  });

  it("a busca continua só entre ativos, e o homologado que casa vem primeiro, sem repetir", async () => {
    abrirPedido();
    await buscar("Zeta");
    expect(await screen.findByRole("option", opcaoDe(ALVO.code))).toBeInTheDocument();
    expect(screen.queryByRole("option", opcaoDe(INATIVO.code))).toBeNull();

    const opcoes = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(opcoes[0]).toHaveTextContent(HOMOLOGADO.code);
    expect(opcoes[0]).toHaveTextContent("Homologado");
    expect(opcoes.filter((opcao) => (opcao.textContent ?? "").startsWith(HOMOLOGADO.code))).toHaveLength(1);
    nenhumaConsultaAlemDaPagina();
  });

  it("escolher um homologado continua trazendo a quantidade recomendada dele", async () => {
    abrirPedido();
    await waitFor(() => expect(listSuppliers).toHaveBeenCalled());
    const quantidade = await screen.findByLabelText("Comprar de MP-000167");
    fireEvent.change(quantidade, { target: { value: "3" } });
    fireEvent.focus(campo());
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(HOMOLOGADO.code)));
    await waitFor(() => expect(quantidade).toHaveValue("10"));
  });
});

describe("guarda estrutural", () => {
  it("o Pedido não carrega fornecedores com teto nem monta `<select>` de catálogo", () => {
    const fonte = readFileSync(join(process.cwd(), "src", "pages", "customer-orders", "CustomerOrderPage.tsx"), "utf8");
    expect(fonte).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(fonte).not.toMatch(/Demais fornecedores ativos">/);
    expect(fonte).toMatch(/onSearch=\{\(termo\) => buscarFornecedoresDaCompra\(row, termo\)\}/);
  });
});
