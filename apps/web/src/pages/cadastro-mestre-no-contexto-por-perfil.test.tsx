import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * Cadastro de Item, Fornecedor e Produto no meio de outro documento —
 * MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * A Ordem de Compra oferece "+ Novo fornecedor" (Compras e Administrador) e
 * "+ Novo item de estoque" (Compras, Qualidade, Produção e Administrador); a
 * Formulação oferece "+ Novo item de estoque" pela mesma lista; o Pedido
 * oferece "+ Novo produto" (Comercial e Administrador); Item × Fornecedor
 * oferece "Nova relação" (Compras e Administrador). Quem não pode não vê a
 * oferta — e a busca sem resultado diz a quem pedir o cadastro. Escolher o
 * registro que já existe continua livre.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

vi.mock("../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  confirmPurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
}));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../lib/supplier-items-api", () => ({
  listSupplierItems: vi.fn(),
  createSupplierItem: vi.fn(),
  getSupplierItem: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../lib/units-api", () => ({ listUnits: vi.fn(async () => []) }));
vi.mock("../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: () => Promise.resolve(null),
}));
vi.mock("../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));
vi.mock("../lib/customer-orders-api", () => ({
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
vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
vi.mock("../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

import { listSuppliers } from "../lib/suppliers-api";
import { listSupplierItems } from "../lib/supplier-items-api";
import { listItems } from "../lib/items-api";
import { getFormulationVersion, updateFormulationVersion } from "../lib/formulations-api";
import { getCustomerOrder, getFulfillmentPlan } from "../lib/customer-orders-api";
import { listCustomers } from "../lib/customers-api";
import { getProduct, listProducts } from "../lib/products-api";
import { getReservationStatus } from "../lib/shipments-api";
import { PurchaseOrderPage } from "./purchase-orders/PurchaseOrderPage";
import { SupplierItemsPage } from "./supplier-items/SupplierItemsPage";
import { FormulationVersionPage } from "./formulations/FormulationVersionPage";
import { CustomerOrderPage } from "./customer-orders/CustomerOrderPage";

const TODOS = ["ADMIN", "PURCHASING", "QUALITY", "PRODUCTION", "COMMERCIAL", "VIEWER"];
const CADASTRAM_ITEM = ["ADMIN", "PURCHASING", "QUALITY", "PRODUCTION"];
const CADASTRAM_FORNECEDOR = ["ADMIN", "PURCHASING"];
const CADASTRAM_PRODUTO = ["ADMIN", "COMMERCIAL"];

const AJUDA_ITEM =
  "Nenhum item encontrado. Solicite a Compras, Qualidade, Produção ou Administrador o cadastro do item.";
const AJUDA_FORNECEDOR =
  "Nenhum fornecedor encontrado. Solicite a Compras ou Administrador o cadastro do fornecedor.";
const AJUDA_PRODUTO =
  "Nenhum produto encontrado. Solicite ao Comercial ou Administrador o cadastro do produto.";

const TERMO = "cadastro que ainda nao existe";

const FORNECEDOR = { id: "for-1", code: "FOR-000001", legalName: "Purifarma Ltda", tradeName: null, active: true };
const ITEM = {
  id: "it-1",
  code: "MP-000001",
  name: "Colina",
  type: "RAW_MATERIAL",
  active: true,
  controlsLot: false,
  unitCode: "kg",
  unit: { code: "kg", dimension: "MASS" },
};
const CLIENTE = { id: "cli-a", code: "CLI-000001", legalName: "Alfa Suplementos Ltda", tradeName: "Alfa" };
const PRODUTO = {
  id: "prod-a",
  code: "PROD-000101",
  name: "Whey Alfa 900g",
  customerId: CLIENTE.id,
  finishedProductItem: { id: "pa-a", code: "PA-000101", name: "Whey Alfa 900g" },
};

function filtrarPorBusca<T extends { code: string }>(linhas: T[], nome: (linha: T) => string, termo?: string) {
  if (!termo) return linhas;
  const busca = termo.toLowerCase();
  return linhas.filter((linha) => `${linha.code} ${nome(linha)}`.toLowerCase().includes(busca));
}

/** A lista aberta — sai por portal; a última é a do campo em foco. */
function lista(): HTMLElement {
  return screen.getAllByRole("listbox").at(-1)!;
}

async function buscaFeita(mock: ReturnType<typeof vi.fn>, termo: string) {
  await waitFor(() =>
    expect(
      mock.mock.calls.some(([params]) => (params as { search?: string } | undefined)?.search === termo),
    ).toBe(true),
  );
  await waitFor(() => expect(within(lista()).queryByText("Procurando…")).toBeNull());
}

async function conferirOferta(
  campo: HTMLInputElement,
  mock: ReturnType<typeof vi.fn>,
  opcao: RegExp,
  ajuda: string,
  pode: boolean,
  rotulo: string,
) {
  const user = userEvent.setup();
  await user.click(campo);
  await user.clear(campo);
  await user.type(campo, TERMO);
  await buscaFeita(mock, TERMO);
  if (pode) {
    expect(within(lista()).getByRole("option", { name: opcao }), rotulo).toBeInTheDocument();
    expect(within(lista()).queryByText(ajuda), rotulo).toBeNull();
  } else {
    expect(within(lista()).queryByRole("option", { name: opcao }), rotulo).toBeNull();
    expect(within(lista()).getByText(ajuda), rotulo).toBeInTheDocument();
  }
}

function versaoRascunho(): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Beta-Alanina 60 cápsulas",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    capsulesPerPackage: null,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    productProfile: {
      dosageForm: null,
      presentationType: null,
      capsulesPerDose: null,
      doseAmount: null,
      doseUomCode: null,
      dosesPerPackage: null,
      targetAgeGroup: null,
      minimumBatchQuantity: null,
      unitsPerShippingBox: null,
    },
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Beta-Alanina 60 cápsulas",
    outputUnitCode: "un",
    notes: null,
    components: [],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    activatedBy: null,
    inactivatedAt: null,
    inactivatedBy: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    originTemplateVersionId: null,
    originTemplateCode: null,
    originTemplateVersionNumber: null,
    originTemplateName: null,
  } as unknown as FormulationVersionDTO;
}

function pedidoRascunho(): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: CLIENTE.id,
    customerCode: null,
    customerName: null,
    customerTradeName: null,
    customerCnpj: null,
    customerAddress: {
      street: null,
      number: null,
      complement: null,
      district: null,
      zipCode: null,
      city: null,
      state: null,
    },
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: PRODUTO.id,
        productCode: PRODUTO.code,
        productName: PRODUTO.name,
        unitCode: "un",
        orderedQuantity: "10",
        shippedQuantity: "0",
        outstandingQuantity: "10",
        billedQuantity: "0",
        unbilledShippedQuantity: "0",
        pendingProductionQuantity: "0",
        agreedPrice: null,
        productCustomerMismatch: false,
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

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessao.role = "ADMIN";
  vi.mocked(listSuppliers).mockImplementation(async (params) => {
    const suppliers = filtrarPorBusca([FORNECEDOR], (linha) => linha.legalName, params?.search);
    return { suppliers, page: 1, pageSize: 20, total: suppliers.length } as never;
  });
  vi.mocked(listItems).mockImplementation(async (params) => {
    const items = filtrarPorBusca([ITEM], (linha) => linha.name, params?.search).filter(
      (linha) => !params?.type || linha.type === params.type,
    );
    return { items, page: 1, pageSize: 50, total: items.length } as never;
  });
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(getFormulationVersion).mockResolvedValue(versaoRascunho());
  vi.mocked(updateFormulationVersion).mockResolvedValue(versaoRascunho());
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE], total: 1 } as never);
  vi.mocked(listProducts).mockImplementation(async (params) => {
    const products = filtrarPorBusca([PRODUTO], (linha) => linha.name, params?.search);
    return { products, total: products.length, page: 1, pageSize: 50 } as never;
  });
  vi.mocked(getProduct).mockResolvedValue({ ...PRODUTO, originProjectId: null } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getReservationStatus).mockResolvedValue({ lines: [] } as never);
  vi.mocked(getCustomerOrder).mockResolvedValue(pedidoRascunho());
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Ordem de Compra", () => {
  function abrirOc() {
    render(
      <MemoryRouter initialEntries={["/compras/ordens/nova"]}>
        <Routes>
          <Route path="/compras/ordens/nova" element={<PurchaseOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it.each(TODOS)("%s: Novo fornecedor e Novo item de estoque seguem as listas do cadastro", async (role) => {
    sessao.role = role;
    abrirOc();
    await screen.findByRole("heading", { name: "Nova ordem de compra" });

    const fornecedor = document.getElementById("po-supplier") as HTMLInputElement;
    await conferirOferta(
      fornecedor,
      vi.mocked(listSuppliers),
      /\+ Novo fornecedor/,
      AJUDA_FORNECEDOR,
      CADASTRAM_FORNECEDOR.includes(role),
      `${role} fornecedor`,
    );
    fireEvent.keyDown(fornecedor, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar item" }));
    const item = await waitFor(() => {
      const campo = document.querySelector<HTMLInputElement>('input[id^="po-line-item-"]');
      if (!campo) throw new Error("sem linha");
      return campo;
    });
    await conferirOferta(
      item,
      vi.mocked(listItems),
      /\+ Novo item de estoque/,
      AJUDA_ITEM,
      CADASTRAM_ITEM.includes(role),
      `${role} item`,
    );
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Formulação", () => {
  it.each(TODOS)("%s: Novo item de estoque na linha segue a lista do Item", async (role) => {
    sessao.role = role;
    render(
      <MemoryRouter initialEntries={["/producao/formulacoes/prod-1/versoes/fv-1"]}>
        <Routes>
          <Route
            path="/producao/formulacoes/:productId/versoes/:versionId"
            element={<FormulationVersionPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar matéria-prima/ }));
    const campo = screen.getByPlaceholderText("Buscar matéria-prima por código ou nome…") as HTMLInputElement;

    await conferirOferta(
      campo,
      vi.mocked(listItems),
      /\+ Novo item de estoque/,
      AJUDA_ITEM,
      CADASTRAM_ITEM.includes(role),
      role,
    );
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Pedido", () => {
  it.each(TODOS)("%s: Novo produto segue a lista do Produto; o existente continua escolhível", async (role) => {
    sessao.role = role;
    render(
      <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
        <Routes>
          <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const campo = await waitFor(() => {
      const elemento = document.querySelector<HTMLInputElement>('input[id^="pedido-produto-"]');
      if (!elemento || elemento.disabled) throw new Error("campo de produto ainda não disponível");
      return elemento;
    });

    await conferirOferta(
      campo,
      vi.mocked(listProducts),
      /\+ Novo produto/,
      AJUDA_PRODUTO,
      CADASTRAM_PRODUTO.includes(role),
      role,
    );

    // O produto que já existe continua na busca.
    const user = userEvent.setup();
    await user.clear(campo);
    await user.type(campo, "Whey");
    await buscaFeita(vi.mocked(listProducts), "Whey");
    expect(within(lista()).getByRole("option", { name: /^PROD-000101/ }), role).toBeInTheDocument();
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Item × Fornecedor", () => {
  function abrirRelacoes(endereco = "/compras/item-fornecedor") {
    render(
      <MemoryRouter initialEntries={[endereco]}>
        <Routes>
          <Route path="/compras/item-fornecedor" element={<SupplierItemsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it.each(TODOS)("%s: Nova relação só para Compras e Administrador — nem pelo endereço", async (role) => {
    sessao.role = role;
    abrirRelacoes("/compras/item-fornecedor?nova=1");
    await waitFor(() => expect(listSupplierItems).toHaveBeenCalled());

    const pode = CADASTRAM_FORNECEDOR.includes(role);
    if (pode) {
      expect(await screen.findByRole("dialog"), role).toHaveTextContent("Nova relação item × fornecedor");
    } else {
      expect(screen.queryByRole("dialog"), role).toBeNull();
      expect(screen.queryByRole("button", { name: "Nova relação" }), role).toBeNull();
    }
  });

  it.each(TODOS)("%s: o botão Nova relação aparece para quem cria relação", async (role) => {
    sessao.role = role;
    abrirRelacoes();
    await waitFor(() => expect(listSupplierItems).toHaveBeenCalled());
    expect(Boolean(screen.queryByRole("button", { name: "Nova relação" })), role).toBe(
      CADASTRAM_FORNECEDOR.includes(role),
    );
  });
});
