import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";
import { ProductIndustrialCostSummary } from "./ProductIndustrialCostSummary";
import { ProductsPage } from "./ProductsPage";

/**
 * O CMV a partir do produto.
 *
 * Duas entradas, e nenhuma exige saber que existe estrutura de custos: o
 * resumo dentro do cadastro (que já responde "quanto custa a base de
 * referência") e a ação na lista, para quem chegou pela busca.
 */

vi.mock("../../lib/industrial-costs-api", () => ({ getProductIndustrialCosts: vi.fn() }));
vi.mock("../../lib/pricing-api", () => ({ getProductPricing: vi.fn() }));
vi.mock("../../lib/product-cmv-api", () => ({ getProductCmv: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn(), setProductActive: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({
  listCustomers: () => Promise.resolve({ customers: [], total: 0 }),
}));

import { getProductIndustrialCosts } from "../../lib/industrial-costs-api";
import { getProductPricing } from "../../lib/pricing-api";
import { getProductCmv } from "../../lib/product-cmv-api";
import { listProducts } from "../../lib/products-api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Resumo de CMV no produto", () => {
  it("mostra o CMV da base de referência e leva à simulação", async () => {
    vi.mocked(getProductIndustrialCosts).mockResolvedValue({
      productId: "prod-1",
      current: {
        id: "ec-1",
        label: "EC-000001 · V1",
        status: "ACTIVE",
        complete: true,
        formulationVersionNumber: 1,
        referenceOutputQuantity: "1000",
        referenceOutputUomCode: "un",
        pendencies: [],
      },
      draft: null,
      versions: [{ id: "ec-1" }],
    } as never);
    vi.mocked(getProductPricing).mockResolvedValue({
      productId: "prod-1",
      current: { id: "prec-1", label: "PREC-000001 · V1", tiers: [{ id: "t1" }, { id: "t2" }] },
      draft: null,
      versions: [],
    } as never);
    vi.mocked(getProductCmv).mockResolvedValue({
      productId: "prod-1",
      calculationCode: "CALC-000001",
      calculationReferenceDate: "2026-08-18T00:00:00.000Z",
      simulation: {
        quantity: "1000",
        uomCode: "un",
        batchCount: "1",
        totalCost: "12043.6000",
        costPerUnit: "12.0436",
        costPer1000: "12043.6000",
        knownSubtotal: "12043.6000",
        quality: "COMPLETE_REAL_REFERENCE",
        warnings: [],
        hasCustomerSuppliedMaterials: false,
        components: [],
      },
      unavailableReason: null,
      pricing: null,
    } as never);

    render(
      <MemoryRouter>
        <ProductIndustrialCostSummary productId="prod-1" />
      </MemoryRouter>,
    );

    await screen.findByText(/R\$ 12\.043,60/);
    expect(screen.getByText(/12,04 por unidade/)).toBeInTheDocument();
    expect(screen.getByText("Completo — referências reais de compra")).toBeInTheDocument();
    expect(screen.getByText("CALC-000001")).toBeInTheDocument();
    expect(screen.getByText(/Precificação ativa: PREC-000001/)).toBeInTheDocument();

    // A quantidade do resumo é a base declarada pela estrutura — nunca 1000
    // escolhido pela tela.
    expect(vi.mocked(getProductCmv).mock.calls[0]![1].quantity).toBe("1000");
    expect(screen.getByRole("link", { name: "Abrir CMV" })).toHaveAttribute(
      "href",
      "/produtos/prod-1/cmv",
    );
  });

  it("sem base econômica diz o motivo em vez de mostrar um número", async () => {
    vi.mocked(getProductIndustrialCosts).mockResolvedValue({
      productId: "prod-1",
      current: {
        id: "ec-1",
        label: "EC-000001 · V1",
        status: "ACTIVE",
        complete: false,
        formulationVersionNumber: 1,
        referenceOutputQuantity: "1000",
        referenceOutputUomCode: "un",
        pendencies: [
          {
            code: "ENERGY_RESOURCE_MISSING",
            description: "Energia derivada dos equipamentos, mas nenhum equipamento foi planejado.",
            severity: "BLOCKING",
            target: "SELF",
            resourceId: null,
          },
        ],
      },
      draft: null,
      versions: [{ id: "ec-1" }],
    } as never);
    vi.mocked(getProductPricing).mockRejectedValue(new Error("sem permissão"));
    vi.mocked(getProductCmv).mockResolvedValue({
      productId: "prod-1",
      calculationCode: null,
      calculationReferenceDate: null,
      simulation: null,
      unavailableReason: "Não há cálculo de custo salvo até esta data de referência.",
      pricing: null,
    } as never);

    render(
      <MemoryRouter>
        <ProductIndustrialCostSummary productId="prod-1" />
      </MemoryRouter>,
    );

    await screen.findByText("CMV indisponível");
    expect(
      screen.getByText(/Não há cálculo de custo salvo até esta data de referência/),
    ).toBeInTheDocument();
    // O motivo de não haver número aparece na mesma tela, com saída: era
    // exatamente o "CMV indisponível" sem explicação que mandava o usuário
    // procurar a pendência duas telas adiante.
    expect(
      screen.getByText(/Falta 1 configuração para ativar esta estrutura/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nenhum equipamento foi planejado/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir a estrutura de custos" })).toHaveAttribute(
      "href",
      "/produtos/prod-1/custos",
    );
    // Sem permissão comercial, nenhuma linha de preço aparece.
    expect(screen.queryByText(/Precificação ativa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$ 0,00/)).not.toBeInTheDocument();
  });
});

describe("Acesso ao CMV pela lista de produtos", () => {
  it("a ação existe sem alargar a tabela", async () => {
    const produto = {
      id: "prod-1",
      code: "PROD-000003",
      name: "Whey Protein DEMO",
      customer: null,
      finishedProductItem: null,
      dosageForm: null,
      presentationType: null,
      shelfLifeMonths: null,
      activeFormulationVersionLabel: "V1",
      lifecycle: "APPROVED",
      active: true,
    } as unknown as ProductDTO;
    vi.mocked(listProducts).mockResolvedValue({ products: [produto], total: 1 } as never);

    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );

    await screen.findByText("PROD-000003");
    fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "CMV" })).toBeInTheDocument(),
    );
  });
});
