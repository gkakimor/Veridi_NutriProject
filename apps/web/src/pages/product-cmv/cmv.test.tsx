import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductCmvResponse } from "@veridi/shared";
import { ProductCmvPage } from "./ProductCmvPage";

/**
 * A tela de CMV pelo que ela responde, não pelo que ela chama.
 *
 * A pergunta é sempre a mesma: "quanto custa produzir esta quantidade?".
 * Estes testes protegem as três respostas que não podem sair erradas — o
 * custo quando ele existe, a ausência de custo quando ele não existe (nunca
 * R$ 0,00) e o preço vigente só quando existe faixa para exatamente aquela
 * quantidade.
 */

vi.mock("../../lib/product-cmv-api", () => ({ getProductCmv: vi.fn() }));
vi.mock("../../lib/pricing-api", () => ({ getProductPricing: vi.fn() }));
vi.mock("../../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: () => Promise.resolve({ current: null, draft: null }),
}));
vi.mock("../../components/ProjectOriginLink", () => ({ ProjectOriginLink: () => null }));

import { getProductCmv } from "../../lib/product-cmv-api";
import { getProductPricing } from "../../lib/pricing-api";

function cmv(overrides: Partial<ProductCmvResponse> = {}): ProductCmvResponse {
  return {
    productId: "prod-1",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    customerName: "NutriViva",
    outputUomCode: "un",
    formulationVersionId: "form-1",
    formulationVersionNumber: 1,
    basisFormulationVersionId: "form-1",
    basisFormulationVersionNumber: 1,
    industrialCostVersionId: "ec-1",
    industrialCostVersionLabel: "EC-000001 · V1",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    calculationId: "calc-1",
    calculationCode: "CALC-000001",
    calculationReferenceDate: "2026-08-18T00:00:00.000Z",
    referenceDate: "2026-08-18T00:00:00.000Z",
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
    ...overrides,
  };
}

function renderPage(url = "/produtos/prod-1/cmv") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/produtos/:productId/cmv" element={<ProductCmvPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductPricing).mockResolvedValue({
    productId: "prod-1",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    draft: null,
    current: null,
    versions: [],
  });
});

describe("Tela de CMV", () => {
  it("usa a quantidade do link e já calcula, sem pedir o clique de novo", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(cmv());
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await waitFor(() => expect(getProductCmv).toHaveBeenCalled());
    expect(vi.mocked(getProductCmv).mock.calls[0]![1].quantity).toBe("1000");
    expect((screen.getByLabelText("Quantidade a simular") as HTMLInputElement).value).toBe("1000");
  });

  it("envia a data de referência explicitamente — o domínio não escolhe o dia", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(cmv());
    renderPage("/produtos/prod-1/cmv?quantity=500&referenceDate=2026-08-18");

    await waitFor(() => expect(getProductCmv).toHaveBeenCalled());
    expect(vi.mocked(getProductCmv).mock.calls[0]![1].referenceDate).toBe("2026-08-18");
    expect((screen.getByLabelText("Data de referência") as HTMLInputElement).value).toBe(
      "2026-08-18",
    );
  });

  it("simular outra quantidade recalcula pela API", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(cmv());
    renderPage("/produtos/prod-1/cmv?quantity=1000");
    await waitFor(() => expect(getProductCmv).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Quantidade a simular"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular CMV" }));

    await waitFor(() => expect(getProductCmv).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getProductCmv).mock.calls[1]![1].quantity).toBe("3000");
  });

  it("custo completo: total, por unidade, por mil e lotes de referência", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: {
          ...cmv().simulation!,
          quantity: "3000",
          batchCount: "3",
          totalCost: "36130.8000",
          costPerUnit: "12.0436",
          costPer1000: "12043.6000",
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=3000");

    await screen.findByText("R$ 36.130,80");
    expect(screen.getAllByText("R$ 12,04").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 12.043,60").length).toBeGreaterThan(0);
    // Três lotes de referência: a UI conta, mas quem calcula é o motor.
    expect(screen.getByText("3 lotes de referência")).toBeInTheDocument();
    expect(screen.getAllByText("Completo — referências reais de compra").length).toBe(2);
  });

  it("custo parcial: total indisponível e subtotal conhecido explicado", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: {
          ...cmv().simulation!,
          totalCost: null,
          costPerUnit: null,
          costPer1000: null,
          knownSubtotal: "8000.0000",
          quality: "PARTIAL",
          warnings: [{ code: "MATERIAL_COST_UNKNOWN", message: "MP-000009: sem custo conhecido." }],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText("CMV indisponível");
    expect(screen.getByText("Subtotal conhecido: R$ 8.000,00")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Existem componentes sem custo conhecido. O subtotal conhecido não representa o CMV total.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("MP-000009: sem custo conhecido.")).toBeInTheDocument();
    // Nunca R$ 0,00 no lugar de desconhecido.
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("sem custo conhecido a tela diz isso — não mostra zero", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: {
          ...cmv().simulation!,
          totalCost: null,
          costPerUnit: null,
          costPer1000: null,
          knownSubtotal: "0.0000",
          quality: "NO_COST",
          warnings: [
            { code: "ENERGY_NOT_CONFIGURED", message: "A energia desta estrutura não foi configurada." },
          ],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText("CMV indisponível");
    expect(screen.getAllByText("Sem custo conhecido").length).toBe(2);
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
    expect(screen.queryByText("NO_COST")).not.toBeInTheDocument();
  });

  it("composição separa materiais, embalagem, material do cliente e recursos", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: {
          ...cmv().simulation!,
          hasCustomerSuppliedMaterials: true,
          components: [
            {
              group: "FORMULA_MATERIAL",
              itemId: "item-1",
              code: "MP-000004",
              name: "Proteína isolada",
              requiredQuantity: "150",
              unitCode: "kg",
              costSource: "WEIGHTED_AVG_30D",
              unitCost: "42.0000",
              totalCost: "6300.0000",
              customerSupplied: false,
            },
            {
              group: "PACKAGING",
              itemId: "item-2",
              code: "ME-000003",
              name: "Pote 900 g",
              requiredQuantity: "1000",
              unitCode: "un",
              costSource: "WEIGHTED_AVG_30D",
              unitCost: "1.8000",
              totalCost: "1800.0000",
              customerSupplied: false,
            },
            {
              group: "CUSTOMER_SUPPLIED",
              itemId: "item-3",
              code: "MP-000005",
              name: "Aroma exclusivo do cliente",
              requiredQuantity: "10",
              unitCode: "kg",
              costSource: null,
              unitCost: null,
              totalCost: null,
              customerSupplied: true,
            },
            {
              group: "INDUSTRIAL_RESOURCE",
              itemId: null,
              code: "LABOR",
              name: "DEMO — Mão de obra de produção",
              requiredQuantity: "6",
              unitCode: "HOUR",
              costSource: null,
              unitCost: "38.0000",
              totalCost: "228.0000",
              customerSupplied: false,
            },
          ],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText("Materiais da formulação");
    expect(screen.getByText("Embalagens")).toBeInTheDocument();
    expect(screen.getByText("Recursos industriais")).toBeInTheDocument();
    // Origem em português: enum cru nunca chega ao usuário.
    expect(screen.getAllByText("Média ponderada de compras (30 dias)").length).toBe(2);
    expect(screen.getByText("Mão de obra")).toBeInTheDocument();
    expect(screen.queryByText("WEIGHTED_AVG_30D")).not.toBeInTheDocument();
    expect(screen.queryByText("LABOR")).not.toBeInTheDocument();
  });

  it("material do cliente mantém quantidade física e não vira custo zero", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: {
          ...cmv().simulation!,
          hasCustomerSuppliedMaterials: true,
          components: [
            {
              group: "CUSTOMER_SUPPLIED",
              itemId: "item-3",
              code: "MP-000005",
              name: "Aroma exclusivo do cliente",
              requiredQuantity: "10",
              unitCode: "kg",
              costSource: null,
              unitCost: null,
              totalCost: null,
              customerSupplied: true,
            },
          ],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText("Materiais fornecidos pelo cliente");
    expect(
      screen.getByText(/Não compõe o custo de aquisição Veridi/),
    ).toBeInTheDocument();
    const linha = screen.getByText(/Aroma exclusivo do cliente/).closest("tr")!;
    expect(within(linha).getByText("10")).toBeInTheDocument();
    expect(within(linha).getByText("Cliente")).toBeInTheDocument();
    expect(within(linha).queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("faixa exata mostra o preço vigente", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        pricing: {
          pricingVersionId: "prec-1",
          pricingVersionLabel: "PREC-000001 · V1",
          tierId: "tier-1000",
          tierQuantity: "1000",
          unitPrice: "38.9000",
          availableQuantities: ["500", "1000", "3000"],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText("Precificação vigente");
    expect(screen.getAllByText("R$ 38,90").length).toBeGreaterThan(0);
  });

  it("sem faixa exata a tela recusa sugerir outra quantidade", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: { ...cmv().simulation!, quantity: "750" },
        pricing: {
          pricingVersionId: "prec-1",
          pricingVersionLabel: "PREC-000001 · V1",
          tierId: null,
          tierQuantity: null,
          unitPrice: null,
          availableQuantities: ["500", "1000", "3000"],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=750");

    await screen.findByText(/Não existe uma faixa de precificação ativa para 750 un/);
    // Preço nenhum é oferecido: nem o de 500, nem o de 1000, nem média.
    expect(screen.queryByText("R$ 38,90")).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 44,90")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir precificação" })).toBeInTheDocument();
  });

  it("sem permissão comercial nenhum bloco de preço aparece", async () => {
    // A API já devolve `pricing: null` para quem não pode ver economia
    // interna — a tela não tem gate próprio a divergir do backend.
    vi.mocked(getProductCmv).mockResolvedValue(cmv({ pricing: null }));
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await waitFor(() => expect(screen.getAllByText("R$ 12.043,60").length).toBe(2));
    expect(screen.queryByText("Precificação vigente")).not.toBeInTheDocument();
    expect(screen.queryByText("Preço vigente")).not.toBeInTheDocument();
  });

  it("vindo do orçamento, o caminho de volta é o orçamento", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(cmv());
    renderPage(
      "/produtos/prod-1/cmv?quantity=1000&projectId=prj-1&quoteVersionId=q-2&quoteLineId=l-9",
    );

    const voltar = await screen.findByRole("link", { name: /Voltar ao orçamento/ });
    expect(voltar).toHaveAttribute(
      "href",
      "/comercial/projetos/prj-1?quoteVersionId=q-2&quoteLineId=l-9",
    );
  });

  it("vindo do projeto, o caminho de volta é o projeto", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(cmv());
    renderPage("/produtos/prod-1/cmv?quantity=1000&projectId=prj-1");

    const voltar = await screen.findByRole("link", { name: /Voltar ao projeto/ });
    expect(voltar).toHaveAttribute("href", "/comercial/projetos/prj-1");
  });

  it("unidade de recurso aparece em português, não como enum de tarifa", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: {
          ...cmv().simulation!,
          components: [
            {
              group: "INDUSTRIAL_RESOURCE",
              itemId: null,
              code: "LABOR",
              name: "DEMO — Mão de obra de produção",
              requiredQuantity: "6",
              unitCode: "HOUR",
              costSource: null,
              unitCost: "38.0000",
              totalCost: "228.0000",
              customerSupplied: false,
            },
          ],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText("Recursos industriais");
    const linha = screen.getByText(/Mão de obra de produção/).closest("tr")!;
    expect(within(linha).getByText("hora")).toBeInTheDocument();
    expect(within(linha).queryByText("HOUR")).not.toBeInTheDocument();
  });

  it("erro de quantidade não faz a tela parecer outro produto", async () => {
    vi.mocked(getProductCmv).mockResolvedValueOnce(cmv());
    renderPage("/produtos/prod-1/cmv?quantity=1000");
    await screen.findByText(/PROD-000003/);

    vi.mocked(getProductCmv).mockRejectedValueOnce(
      new Error("Informe uma quantidade maior que zero para simular o CMV."),
    );
    fireEvent.change(screen.getByLabelText("Quantidade a simular"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular CMV" }));

    await screen.findByText("Informe uma quantidade maior que zero para simular o CMV.");
    // O produto continua sendo o mesmo: o que falhou foi a quantidade.
    expect(screen.getByText(/PROD-000003/)).toBeInTheDocument();
    expect(screen.queryByText("CMV total")).not.toBeInTheDocument();
  });

  it("avisa quando o preço vigente foi fechado sobre outra base de custo", async () => {
    vi.mocked(getProductPricing).mockResolvedValue({
      productId: "prod-1",
      productCode: "PROD-000003",
      productName: "Whey Protein DEMO",
      draft: null,
      current: {
        id: "prec-1",
        tiers: [
          {
            id: "tier-1000",
            quantity: "1000",
            uomCode: "un",
            costQuality: "PARTIAL",
            commissionPercent: "5",
            commissionPerUnit: null,
            contributionPerUnit: null,
            contributionMarginPercent: null,
            markupPercent: null,
          },
        ],
      },
      versions: [],
    } as never);
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        pricing: {
          pricingVersionId: "prec-1",
          pricingVersionLabel: "PREC-000001 · V1",
          tierId: "tier-1000",
          tierQuantity: "1000",
          unitPrice: "38.9000",
          availableQuantities: ["1000"],
        },
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    // Preço completo ao lado de custo completo passaria uma confiança que a
    // faixa — fechada sobre custo parcial — não tem.
    await screen.findByText(/Esta faixa foi definida sobre um custo industrial parcial/);
  });

  it("sem base de custo a tela explica em vez de mostrar número", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        simulation: null,
        calculationId: null,
        calculationCode: null,
        unavailableReason:
          "Não há cálculo de custo salvo até esta data de referência. Salve um cálculo na estrutura de custos para simular o CMV.",
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    await screen.findByText(/Não há cálculo de custo salvo até esta data de referência/);
    expect(screen.queryByText("CMV total")).not.toBeInTheDocument();
  });

  it("diz de qual formulação a composição fala e avisa quando ela ficou para trás", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(
      cmv({
        // Produto já publicou a V2; a estrutura ativa continua na V1.
        formulationVersionNumber: 2,
        basisFormulationVersionNumber: 1,
      }),
    );
    renderPage("/produtos/prod-1/cmv?quantity=1000");

    // Sem este aviso, um item removido na V2 aparecendo na composição vira
    // suspeita de bug em vez de base congelada.
    await screen.findByText(/Este CMV descreve a formulação V1, não a V2 que está ativa/);
    expect(screen.getByRole("link", { name: "V1" })).toHaveAttribute(
      "href",
      "/producao/formulacoes/prod-1",
    );
    expect(screen.getByRole("link", { name: "EC-000001 · V1" })).toHaveAttribute(
      "href",
      "/produtos/prod-1/custos",
    );
    expect(screen.getByRole("link", { name: "CALC-000001" })).toHaveAttribute(
      "href",
      "/calculos-custo/calc-1",
    );
  });
});
