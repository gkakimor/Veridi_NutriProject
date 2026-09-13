import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  CustomerDTO,
  CustomerOrderDTO,
  ProductionOrderDTO,
  SupplierDTO,
} from "@veridi/shared";

/**
 * Relatórios sem corte silencioso (REPORTS-PAGINATION-01).
 *
 * O read model dos relatórios já paginava no servidor — `count` com o mesmo
 * `where`, resumo sobre o filtro inteiro, CSV e PDF pelo resultado completo.
 * O corte estava nos SELETORES das telas: R-06 carregava 100 OPs, R-14 100
 * Pedidos, e os filtros de Cliente e Fornecedor mil registros cada, todos num
 * `<select>` que se apresentava como o universo inteiro. Da OP 101 em diante a
 * genealogia não era consultável pela tela, e o cliente 1001 não existia para
 * o filtro — sem aviso nenhum.
 *
 * Os seletores passaram à foundation dos filtros (`EntityFilterSelect` +
 * `filter-sources`): primeira página curta, busca no servidor, rótulo por id.
 * O que se prova aqui é que o registro de FORA da primeira página é
 * alcançável, que escolhê-lo chega à consulta do relatório com os mesmos
 * filtros (e volta à página 1), e que o número mostrado é o do servidor.
 */

vi.mock("../../lib/reports-api", () => ({
  getRequirementsReport: vi.fn(),
  getPlannedActualReport: vi.fn(),
  getProductionTraceabilityReport: vi.fn(),
  getConsumptionReport: vi.fn(),
  getCustomerOrdersReport: vi.fn(),
  getFulfillmentReport: vi.fn(),
  getOrderOperationReport: vi.fn(),
  getBillingPeriodReport: vi.fn(),
  getAwaitingBillingReport: vi.fn(),
  getOrderDeliveredBilledReport: vi.fn(),
  getPurchaseOrdersReport: vi.fn(),
  getReceiptsReport: vi.fn(),
  getOnOrderReport: vi.fn(),
  getLatePurchaseOrdersReport: vi.fn(),
}));
vi.mock("../../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
  getProductionOrder: vi.fn(),
}));
vi.mock("../../lib/customer-orders-api", () => ({
  listCustomerOrders: vi.fn(),
  getCustomerOrder: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => null,
}));

import {
  getAwaitingBillingReport,
  getBillingPeriodReport,
  getCustomerOrdersReport,
  getFulfillmentReport,
  getLatePurchaseOrdersReport,
  getOnOrderReport,
  getOrderDeliveredBilledReport,
  getOrderOperationReport,
  getProductionTraceabilityReport,
  getPurchaseOrdersReport,
  getReceiptsReport,
} from "../../lib/reports-api";
import { getProductionOrder, listProductionOrders } from "../../lib/production-orders-api";
import { getCustomerOrder, listCustomerOrders } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { ProductionTraceabilityReportPage } from "./ProductionReports";
import {
  CustomerOrdersReportPage,
  FulfillmentReportPage,
  OrderOperationReportPage,
} from "./CommercialReports";
import {
  AwaitingBillingReportPage,
  BillingPeriodReportPage,
  OrderDeliveredBilledReportPage,
} from "./BillingReports";
import {
  LatePurchaseOrdersReportPage,
  OnOrderReportPage,
  PurchaseOrdersReportPage,
  ReceiptsReportPage,
} from "./PurchasingReports";

/** 137 registros no universo; a primeira página do seletor traz 20. */
const UNIVERSO = 137;
const PAGINA_DO_SELETOR = 20;

function ordem(n: number): ProductionOrderDTO {
  const code = `OP-${String(n).padStart(6, "0")}`;
  return { id: `op-${n}`, code, productName: `Produto ${n}` } as unknown as ProductionOrderDTO;
}

function pedido(n: number): CustomerOrderDTO {
  const code = `PED-${String(n).padStart(6, "0")}`;
  return { id: `co-${n}`, code, customerName: `Cliente ${n}` } as unknown as CustomerOrderDTO;
}

function cliente(n: number, legalName = `Cliente ${n}`): CustomerDTO {
  const code = `CLI-${String(n).padStart(6, "0")}`;
  return { id: `cli-${n}`, code, legalName, tradeName: null, cnpj: null } as unknown as CustomerDTO;
}

function fornecedor(n: number, legalName = `Fornecedor ${n}`): SupplierDTO {
  const code = `FOR-${String(n).padStart(6, "0")}`;
  return { id: `for-${n}`, code, legalName, tradeName: null } as unknown as SupplierDTO;
}

/** Os mais recentes primeiro — a mesma ordem da listagem do servidor. */
function recentes<T>(fabrica: (n: number) => T, total: number): T[] {
  return Array.from({ length: PAGINA_DO_SELETOR }, (_, indice) => fabrica(total - indice));
}

/** Página vazia de relatório, com os metadados ecoando o pedido. */
function paginaDeRelatorio(total: number) {
  return async (filters: Record<string, unknown>) => ({
    rows: [],
    page: Number(filters["page"] ?? 1),
    pageSize: 25,
    total,
  });
}

function ultimaChamada(mock: unknown): Record<string, unknown> {
  const chamadas = vi.mocked(mock as (filters: Record<string, unknown>) => unknown).mock.calls;
  return (chamadas[chamadas.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

/** Onde o botão PDF levou — a rota de impressão recebe os filtros pela URL. */
function Destino() {
  const location = useLocation();
  return <p data-testid="destino">{`${location.pathname}${location.search}`}</p>;
}

function abrir(tela: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/relatorio"]}>
      <Routes>
        <Route path="/relatorio" element={tela} />
        <Route path="/print/relatorios/:code" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Digita no seletor e escolhe a opção que o SERVIDOR devolveu. */
async function escolherPelaBusca(nome: string, termo: string, opcao: RegExp) {
  const campo = screen.getByRole("combobox", { name: nome });
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: opcao }));
}

function nenhumaCargaAlemDaPagina(mock: unknown) {
  const chamadas = vi.mocked(mock as (params?: { pageSize?: number }) => unknown).mock.calls;
  expect(chamadas.length).toBeGreaterThan(0);
  for (const [params] of chamadas) {
    expect(params?.pageSize ?? PAGINA_DO_SELETOR).toBeLessThanOrEqual(PAGINA_DO_SELETOR);
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(listProductionOrders).mockImplementation(async (params) => {
    if (params?.search === "OP-000001") {
      return { productionOrders: [ordem(1)], page: 1, pageSize: 20, total: 1 } as never;
    }
    return { productionOrders: recentes(ordem, UNIVERSO), page: 1, pageSize: 20, total: UNIVERSO } as never;
  });
  vi.mocked(getProductionOrder).mockImplementation(async (id) => ordem(Number(id.replace("op-", ""))));

  vi.mocked(listCustomerOrders).mockImplementation(async (params) => {
    if (params?.search === "PED-000001") {
      return { customerOrders: [pedido(1)], page: 1, pageSize: 20, total: 1 } as never;
    }
    return { customerOrders: recentes(pedido, UNIVERSO), page: 1, pageSize: 20, total: UNIVERSO } as never;
  });
  vi.mocked(getCustomerOrder).mockImplementation(async (id) => pedido(Number(id.replace("co-", ""))));

  // 1.001 clientes: o que se procura é o de número 1.001, fora dos antigos mil.
  vi.mocked(listCustomers).mockImplementation(async (params) => {
    if (params?.search === "Zeta") {
      return { customers: [cliente(1001, "Zeta Nutrição")], page: 1, pageSize: 20, total: 1 } as never;
    }
    return { customers: recentes(cliente, 1001), page: 1, pageSize: 20, total: 1001 } as never;
  });
  vi.mocked(listSuppliers).mockImplementation(async (params) => {
    if (params?.search === "Ômega") {
      return { suppliers: [fornecedor(1001, "Ômega Insumos")], page: 1, pageSize: 20, total: 1 } as never;
    }
    return { suppliers: recentes(fornecedor, 1001), page: 1, pageSize: 20, total: 1001 } as never;
  });

  vi.mocked(getProductionTraceabilityReport).mockImplementation(async (filters) => {
    const n = Number(String(filters["productionOrderId"]).replace("op-", ""));
    const op = ordem(n);
    return {
      productionOrderId: op.id,
      productionOrderCode: op.code,
      productId: "p-1",
      productCode: "PROD-000001",
      productName: op.productName,
      plannedQuantity: "10",
      producedQuantity: "10",
      unitCode: "kg",
      completedAt: null,
      consumed: [],
      produced: [],
    } as never;
  });
  vi.mocked(getOrderOperationReport).mockImplementation(async (filters) => {
    const n = Number(String(filters["customerOrderId"]).replace("co-", ""));
    const doc = pedido(n);
    return {
      customerOrderId: doc.id,
      code: doc.code,
      customerName: doc.customerName,
      status: "CONFIRMED",
      orderDate: "2026-01-05T12:00:00.000Z",
      requestedDeliveryDate: null,
      lines: [],
      reservations: [],
      productionOrders: [],
      purchaseOrders: [],
      shipments: [],
      billings: [],
    } as never;
  });

  for (const mock of [
    getCustomerOrdersReport,
    getFulfillmentReport,
    getAwaitingBillingReport,
    getOrderDeliveredBilledReport,
    getPurchaseOrdersReport,
    getReceiptsReport,
    getOnOrderReport,
    getLatePurchaseOrdersReport,
  ]) {
    vi.mocked(mock).mockImplementation(paginaDeRelatorio(UNIVERSO) as never);
  }
  vi.mocked(getBillingPeriodReport).mockImplementation(async (filters) => {
    // O servidor responde pelo FILTRO: 137 documentos no geral, 12 do cliente.
    const doCliente = filters["customerId"] === "cli-1001";
    const total = doCliente ? 12 : UNIVERSO;
    return {
      rows: [],
      page: Number(filters["page"] ?? 1),
      pageSize: 25,
      total,
      summary: {
        billingCount: total,
        billingsWithCompletePricing: total,
        totalAmount: doCliente ? "120.00" : "1370.00",
      },
    } as never;
  });
});

describe("R-06 — OP fora da primeira página", () => {
  it("a OP mais antiga é achada no servidor e abre a genealogia", async () => {
    abrir(<ProductionTraceabilityReportPage />);
    await waitFor(() => expect(listProductionOrders).toHaveBeenCalled());

    await escolherPelaBusca("Ordem de Produção", "OP-000001", /OP-000001/);

    await waitFor(() =>
      expect(getProductionTraceabilityReport).toHaveBeenCalledWith({ productionOrderId: "op-1" }),
    );
    expect(await screen.findByRole("button", { name: "OP-000001" })).toBeInTheDocument();
    expect(listProductionOrders).toHaveBeenCalledWith({ search: "OP-000001", pageSize: PAGINA_DO_SELETOR });
    nenhumaCargaAlemDaPagina(listProductionOrders);
  });

  it("limpar a escolha volta ao estado vazio, sem a genealogia anterior", async () => {
    abrir(<ProductionTraceabilityReportPage />);
    await escolherPelaBusca("Ordem de Produção", "OP-000001", /OP-000001/);
    expect(await screen.findByRole("button", { name: "OP-000001" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));

    expect(await screen.findByText(/Selecione uma Ordem de Produção/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OP-000001" })).toBeNull();
  });
});

describe("R-14 — Pedido fora da primeira página", () => {
  it("o pedido mais antigo é achado no servidor, abre a cadeia e vai ao PDF", async () => {
    abrir(<OrderOperationReportPage />);
    await waitFor(() => expect(listCustomerOrders).toHaveBeenCalled());

    await escolherPelaBusca("Pedido", "PED-000001", /PED-000001/);

    await waitFor(() =>
      expect(getOrderOperationReport).toHaveBeenCalledWith({ customerOrderId: "co-1" }),
    );
    expect(listCustomerOrders).toHaveBeenCalledWith({ search: "PED-000001", pageSize: PAGINA_DO_SELETOR });
    nenhumaCargaAlemDaPagina(listCustomerOrders);

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByTestId("destino")).toHaveTextContent(
      "/print/relatorios/R-14?customerOrderId=co-1",
    );
  });
});

describe("Filtro de Cliente — do milésimo em diante", () => {
  it("R-12: cliente 1.001 pela busca; volta à página 1; CSV leva o mesmo filtro", async () => {
    abrir(<CustomerOrdersReportPage />);
    expect(await screen.findByText(`Página 1 de 6 · ${UNIVERSO} registros`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaChamada(getCustomerOrdersReport)["page"]).toBe(2));
    expect(await screen.findByText(`Página 2 de 6 · ${UNIVERSO} registros`)).toBeInTheDocument();

    await escolherPelaBusca("Cliente", "Zeta", /CLI-001001/);

    await waitFor(() =>
      expect(ultimaChamada(getCustomerOrdersReport)).toMatchObject({ customerId: "cli-1001", page: 1 }),
    );
    const csv = new URL(
      screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href") ?? "",
      "http://exemplo.invalid",
    );
    expect(csv.searchParams.get("customerId")).toBe("cli-1001");
    expect(csv.searchParams.get("page")).toBeNull();
    expect(csv.searchParams.get("pageSize")).toBeNull();
    nenhumaCargaAlemDaPagina(listCustomers);
  });

  it("R-15: o resumo é o do servidor para o filtro inteiro, nunca da página", async () => {
    const { container } = abrir(<BillingPeriodReportPage />);
    const resumo = () => container.querySelector(".report-summary") as HTMLElement;

    await waitFor(() => expect(resumo()).not.toBeNull());
    expect(within(resumo()).getByText(String(UNIVERSO))).toBeInTheDocument();
    expect(within(resumo()).getByText("R$ 1.370,00")).toBeInTheDocument();

    await escolherPelaBusca("Cliente", "Zeta", /CLI-001001/);

    await waitFor(() => expect(within(resumo()).getByText("R$ 120,00")).toBeInTheDocument());
    expect(ultimaChamada(getBillingPeriodReport)).toMatchObject({ customerId: "cli-1001", page: 1 });
    expect(screen.getByText("Página 1 de 1 · 12 registros")).toBeInTheDocument();
    nenhumaCargaAlemDaPagina(listCustomers);
  });

  it.each([
    ["R-13", FulfillmentReportPage, getFulfillmentReport],
    ["R-16", AwaitingBillingReportPage, getAwaitingBillingReport],
    ["R-17", OrderDeliveredBilledReportPage, getOrderDeliveredBilledReport],
  ])("%s filtra pelo cliente achado no servidor", async (_codigo, Tela, consulta) => {
    abrir(<Tela />);
    await waitFor(() => expect(consulta).toHaveBeenCalled());
    await escolherPelaBusca("Cliente", "Zeta", /CLI-001001/);
    await waitFor(() => expect(ultimaChamada(consulta)).toMatchObject({ customerId: "cli-1001", page: 1 }));
    nenhumaCargaAlemDaPagina(listCustomers);
  });
});

describe("Filtro de Fornecedor — do milésimo em diante", () => {
  it.each([
    ["R-08", PurchaseOrdersReportPage, getPurchaseOrdersReport],
    ["R-09", ReceiptsReportPage, getReceiptsReport],
    ["R-10", OnOrderReportPage, getOnOrderReport],
    ["R-11", LatePurchaseOrdersReportPage, getLatePurchaseOrdersReport],
  ])("%s filtra pelo fornecedor achado no servidor, na página 1", async (_codigo, Tela, consulta) => {
    abrir(<Tela />);
    expect(await screen.findByText(`Página 1 de 6 · ${UNIVERSO} registros`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaChamada(consulta)["page"]).toBe(2));

    await escolherPelaBusca("Fornecedor", "Ômega", /FOR-001001/);

    await waitFor(() => expect(ultimaChamada(consulta)).toMatchObject({ supplierId: "for-1001", page: 1 }));
    expect(listSuppliers).toHaveBeenCalledWith({ search: "Ômega", pageSize: PAGINA_DO_SELETOR });
    nenhumaCargaAlemDaPagina(listSuppliers);
  });
});

describe("guarda estrutural", () => {
  it("nenhuma tela de relatório carrega catálogo por conta própria", () => {
    const pasta = join(process.cwd(), "src", "pages", "reports");
    for (const arquivo of [
      "ProductionReports.tsx",
      "CommercialReports.tsx",
      "BillingReports.tsx",
      "PurchasingReports.tsx",
      "InventoryReports.tsx",
      "CostReports.tsx",
    ]) {
      const fonte = readFileSync(join(pasta, arquivo), "utf8");
      // Opção de filtro vem de `filter-sources` (primeira página + busca no
      // servidor), nunca de `listX({ pageSize: N })` apresentado como tudo.
      expect(fonte, arquivo).not.toMatch(/\blist[A-Z]\w*\(/);
      expect(fonte, arquivo).not.toMatch(/pageSize:\s*\d{3,}/);
    }
  });

  it.each([
    ["R-06", ProductionTraceabilityReportPage],
    ["R-14", OrderOperationReportPage],
    ["R-12", CustomerOrdersReportPage],
    ["R-13", FulfillmentReportPage],
    ["R-15", BillingPeriodReportPage],
    ["R-16", AwaitingBillingReportPage],
    ["R-17", OrderDeliveredBilledReportPage],
    ["R-08", PurchaseOrdersReportPage],
    ["R-09", ReceiptsReportPage],
    ["R-10", OnOrderReportPage],
    ["R-11", LatePurchaseOrdersReportPage],
  ])("%s em 390px: seletor na regra de tela estreita, sem largura em pixel", async (_codigo, Tela) => {
    const { container } = abrir(<Tela />);
    const barra = container.querySelector(".report-filters") as HTMLElement;
    expect(barra).not.toBeNull();
    // `.toolbar__entity` ocupa a linha inteira abaixo de 640px (components.css).
    await waitFor(() => expect(barra.querySelector(".toolbar__entity [role='combobox']")).not.toBeNull());
    expect(barra.querySelector("select#customer-filter, select#supplier-filter, select#trace-op")).toBeNull();
    for (const elemento of barra.querySelectorAll<HTMLElement>("[style]")) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }
    for (const tabela of container.querySelectorAll("table")) {
      expect(tabela.closest(".table-container")).not.toBeNull();
    }
  });
});
