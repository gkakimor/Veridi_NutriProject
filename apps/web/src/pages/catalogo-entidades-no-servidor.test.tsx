import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";

/**
 * Busca no servidor para CLIENTE e PRODUTO nos campos de formulário.
 *
 * A rodada anterior levou a busca às telas de ITEM, onde o catálogo já tinha
 * estourado o teto e escondia 1.729 registros. O mesmo padrão continuava nos
 * campos de cliente, fornecedor, produto e recurso: carga fixa, filtro no
 * navegador. Acima do teto o registro existe e não aparece, e o campo oferece
 * "+ Novo" logo acima — o caminho natural vira cadastrar de novo o que já
 * existe.
 *
 * O que estes testes protegem é a REGRA de elegibilidade, não a busca em si:
 * achar não é o mesmo que poder usar. A chamada de busca tem de carregar
 * exatamente os filtros da carga inicial — `active`, `lifecycle` — porque uma
 * busca que os perdesse passaria a oferecer produto em desenvolvimento numa
 * Ordem de Produção.
 */

vi.mock("../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
  getProductionOrder: vi.fn(async () => null),
  createProductionOrder: vi.fn(),
  updateProductionOrder: vi.fn(),
  planProductionOrder: vi.fn(),
  releaseProductionOrder: vi.fn(),
  cancelProductionOrder: vi.fn(),
  confirmPicking: vi.fn(),
  substituteReservationLine: vi.fn(),
  recordConsumption: vi.fn(),
  registerProductionOutput: vi.fn(),
  acceptMaterialVariance: vi.fn(),
  completeProductionOrder: vi.fn(),
  addExtraReservation: vi.fn(),
}));
vi.mock("../lib/products-api", () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductActive: vi.fn(),
}));
vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  getItem: vi.fn(async () => null),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../lib/units-api", () => ({
  listUnits: vi.fn(async () => [{ code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" }]),
}));
vi.mock("../lib/formulations-api", () => ({
  listFormulations: vi.fn(),
  listFormulationVersionsByProduct: vi.fn(async () => []),
  getFormulationVersion: vi.fn(),
  createFirstFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(),
  createNewFormulationVersion: vi.fn(),
}));
vi.mock("../lib/costs-api", () => ({
  setAcquisitionCost: vi.fn(),
  getItemCostReference: vi.fn(),
  getFormulationCostEstimate: vi.fn(),
  getProductionOrderMaterialCost: vi.fn(async () => null),
}));
vi.mock("../lib/cost-calculation-api", () => ({
  calculateIndustrialCost: vi.fn(),
  saveIndustrialCostCalculation: vi.fn(),
  getIndustrialCostCalculation: vi.fn(),
  listProductCostCalculations: vi.fn(),
  getProductionOrderCost: vi.fn(async () => null),
  discardIndustrialCostCalculation: vi.fn(),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { useAuth } from "../app/AuthProvider";
import { listCustomers } from "../lib/customers-api";
import { listProducts } from "../lib/products-api";
import { ProductionOrderPage } from "./production-orders/ProductionOrderPage";
import { ProductCreatePage } from "./products/ProductCreatePage";

const listProductsMock = vi.mocked(listProducts);
const listCustomersMock = vi.mocked(listCustomers);

function produto(id: string, code: string, name: string): ProductDTO {
  return { id, code, name, active: true, lifecycle: "APPROVED" } as unknown as ProductDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u-1", name: "Admin", email: "a@v.com", role: "ADMIN" },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

describe("Ordem de Produção — produto fora da primeira página", () => {
  it("a busca vai ao servidor com os mesmos filtros da carga inicial e o achado aparece", async () => {
    // Carga inicial: só o primeiro. O que a pessoa procura NÃO está nela.
    listProductsMock.mockImplementation(async (params) => {
      if (params?.search === "Beta") {
        return { products: [produto("p-2500", "PROD-002500", "Beta Complexo")], total: 1 } as never;
      }
      return { products: [produto("p-1", "PROD-000001", "Alfa Ômega")], total: 1 } as never;
    });

    render(
      <MemoryRouter initialEntries={["/producao/ordens/nova"]}>
        <Routes>
          <Route path="/producao/ordens/nova" element={<ProductionOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const campo = await screen.findByRole("combobox", { name: /produto/i });
    fireEvent.change(campo, { target: { value: "Beta" } });

    expect(await screen.findByRole("option", { name: /PROD-002500/ })).toBeInTheDocument();

    // A REGRA: a busca carrega `active` e `lifecycle: "APPROVED"`, os mesmos
    // filtros da carga inicial. Perdê-los ofereceria produto em desenvolvimento
    // numa OP — achar não é o mesmo que poder usar.
    const chamadaDeBusca = listProductsMock.mock.calls.find(([params]) => params?.search === "Beta");
    expect(chamadaDeBusca?.[0]).toMatchObject({ active: true, lifecycle: "APPROVED", search: "Beta" });
  });
});

describe("Produto — cliente fora da primeira página", () => {
  it("a busca de cliente carrega o filtro de ativo e o achado aparece", async () => {
    listCustomersMock.mockImplementation(async (params) => {
      if (params?.search === "Gama") {
        return {
          customers: [{ id: "c-900", code: "CLI-000900", legalName: "Gama Nutrição LTDA", tradeName: null }],
          total: 1,
        } as never;
      }
      return {
        customers: [{ id: "c-1", code: "CLI-000001", legalName: "Alfa LTDA", tradeName: "Alfa" }],
        total: 1,
      } as never;
    });

    render(
      <MemoryRouter initialEntries={["/cadastros/produtos/novo"]}>
        <Routes>
          <Route path="/cadastros/produtos/novo" element={<ProductCreatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    const campo = await screen.findByRole("combobox", { name: /cliente/i });
    fireEvent.change(campo, { target: { value: "Gama" } });

    expect(await screen.findByRole("option", { name: /CLI-000900/ })).toBeInTheDocument();
    await waitFor(() => {
      const busca = listCustomersMock.mock.calls.find(([params]) => params?.search === "Gama");
      expect(busca?.[0]).toMatchObject({ active: true, search: "Gama" });
    });
  });
});
