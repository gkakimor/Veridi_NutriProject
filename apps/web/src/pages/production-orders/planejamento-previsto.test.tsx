import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductionOrderDTO, ProductionOrderPlanningDTO } from "@veridi/shared";
import { planProductionProfileSnapshot } from "@veridi/shared";

/**
 * PLANEJAMENTO PREVISTO na tela da Ordem de Produção —
 * PLANNING-OP-SNAPSHOT-01, §89.
 *
 * O que estes testes protegem: a ordem mostra a CÓPIA que congelou, com a
 * versão de origem à vista; aplicar e atualizar são ações de RASCUNHO e
 * somem fora dele; e OP sem perfil diz isso em vez de mostrar zero.
 */

vi.mock("../../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
  getProductionOrder: vi.fn(),
  createProductionOrder: vi.fn(),
  updateProductionOrder: vi.fn(),
  applyProductionProfile: vi.fn(),
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
vi.mock("../../lib/products-api", () => ({
  listProducts: vi.fn(async () => ({ products: [], total: 0 })),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductActive: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  getItem: vi.fn(async () => null),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../../lib/formulations-api", () => ({
  listFormulations: vi.fn(),
  listFormulationVersionsByProduct: vi.fn(async () => []),
  getFormulationVersion: vi.fn(),
  createFirstFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(),
  createNewFormulationVersion: vi.fn(),
}));
vi.mock("../../lib/costs-api", () => ({
  setAcquisitionCost: vi.fn(),
  getItemCostReference: vi.fn(),
  getFormulationCostEstimate: vi.fn(),
  getProductionOrderMaterialCost: vi.fn(async () => null),
}));
vi.mock("../../lib/cost-calculation-api", () => ({
  calculateIndustrialCost: vi.fn(),
  saveIndustrialCostCalculation: vi.fn(),
  getIndustrialCostCalculation: vi.fn(),
  listProductCostCalculations: vi.fn(),
  getProductionOrderCost: vi.fn(async () => null),
  discardIndustrialCostCalculation: vi.fn(),
}));

import { applyProductionProfile, getProductionOrder } from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const applyProductionProfileMock = vi.mocked(applyProductionProfile);

// ─────────────────────────────────────────────────────────────── fixtures

const OPERADOR = "res-operador";
const MISTURADOR = "res-misturador";

/** A cópia congelada: 1.000 un de base, pesagem proporcional + mistura por lote. */
const SNAPSHOT: NonNullable<ProductionOrderPlanningDTO["snapshot"]> = {
  sourceProfileId: "ppr-1",
  sourceProfileCode: "PPR-000012",
  sourceProfileName: "Cápsulas 500 mg",
  sourceVersionId: "ver-3",
  sourceVersionNumber: 3,
  referenceQuantity: "1000",
  referenceUomCode: "un",
  steps: [
    {
      sequence: 1,
      name: "Pesagem",
      description: null,
      setupDurationMinutes: 10,
      runDurationMinutes: 10,
      scalingMode: "PROPORTIONAL",
      resources: [
        {
          industrialResourceId: OPERADOR,
          resourceCode: "RIN-000001",
          resourceName: "Mão de obra — Produção",
          resourceType: "LABOR",
          resourceQuantity: 1,
        },
      ],
    },
    {
      sequence: 2,
      name: "Mistura",
      description: null,
      setupDurationMinutes: 20,
      runDurationMinutes: 60,
      scalingMode: "BY_BATCH",
      resources: [
        {
          industrialResourceId: OPERADOR,
          resourceCode: "RIN-000001",
          resourceName: "Mão de obra — Produção",
          resourceType: "LABOR",
          resourceQuantity: 2,
        },
        {
          industrialResourceId: MISTURADOR,
          resourceCode: "RIN-000002",
          resourceName: "Misturador",
          resourceType: "EQUIPMENT",
          resourceQuantity: 1,
        },
      ],
    },
  ],
};

function planejamento(
  overrides: Partial<ProductionOrderPlanningDTO> = {},
  quantidade = "3000",
): ProductionOrderPlanningDTO {
  const snapshot = "snapshot" in overrides ? overrides.snapshot! : SNAPSHOT;
  return {
    snapshot,
    plan: snapshot ? planProductionProfileSnapshot(snapshot, quantidade) : null,
    appliedAt: snapshot ? new Date().toISOString() : null,
    appliedBy: snapshot ? "Ambiente local" : null,
    availableProfile: null,
    canApply: false,
    canUpdate: false,
    ...overrides,
  };
}

function ordem(
  planning: ProductionOrderPlanningDTO,
  overrides: Partial<ProductionOrderDTO> = {},
): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Produto de Teste",
    finishedItemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Produto acabado",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationVersionLabel: "V1",
    plannedQuantity: "3000",
    outputUnitCode: "un",
    productionFactor: "3",
    status: "DRAFT",
    origin: "MANUAL",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: 0,
      reconciledRequirements: 0,
      pendingRequirements: 0,
      canComplete: true,
    },
    planning,
    notes: null,
    customerId: null,
    customerCode: null,
    customerName: null,
    customerCnpj: null,
    customerTradeName: null,
    customerZipCode: null,
    customerStreet: null,
    customerNumber: null,
    customerComplement: null,
    customerDistrict: null,
    customerCity: null,
    customerState: null,
    hasCustomerSuppliedRequirements: false,
    numberOfParts: 1,
    labelInstructions: null,
    requirements: [],
    outputs: [],
    consumptions: [],
    eligibleFinishedLots: [],
    producedQuantity: "0",
    remainingQuantity: "3000",
    reservation: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as ProductionOrderDTO;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={["/producao/ordens/op-1"]}>
      <Routes>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────── testes

describe("Ordem de Produção — Planejamento previsto", () => {
  it("mostra perfil, versão, etapas, tempos e demanda de recursos", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));

    const { container } = renderizar();

    await screen.findByText("Planejamento previsto");

    // Perfil e versão de ORIGEM, à vista: a OP diz de onde a cópia veio.
    expect(container.textContent).toContain("PPR-000012 · V3");
    expect(container.textContent).toContain("Cápsulas 500 mg");

    // Etapas, em ordem, com preparação/execução/duração próprias.
    expect(container.textContent).toContain("1. Pesagem");
    expect(container.textContent).toContain("2. Mistura");
    // Pesagem proporcional: 10 min × 3.000 ÷ 1.000 = 30 min, + 10 de preparação.
    expect(container.textContent).toContain("40 min");
    // Mistura por lote: 3 lotes × 60 min = 3 h, + 20 de preparação.
    expect(container.textContent).toContain("3 lotes");
    expect(container.textContent).toContain("3 h 20 min");
    // Total sequencial: 40 + 200 minutos.
    expect(container.textContent).toContain("4 h");

    // Demanda de capacidade — dois operadores na mistura ocupam o dobro.
    expect(container.textContent).toContain("Recursos necessários");
    expect(container.textContent).toContain("Misturador");
    expect(container.textContent).toContain("Demanda de capacidade");
    // Nunca chamada de custo.
    expect(container.textContent).not.toContain("Custo do planejamento");
  });

  it("OP sem perfil diz isso, e oferece aplicar quando o produto tem padrão", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem(
        planejamento({
          snapshot: null,
          availableProfile: {
            versionId: "ver-3",
            profileId: "ppr-1",
            profileCode: "PPR-000012",
            profileName: "Cápsulas 500 mg",
            versionNumber: 3,
          },
          canApply: true,
        }),
      ),
    );
    applyProductionProfileMock.mockResolvedValue(ordem(planejamento()));

    const { container } = renderizar();

    await screen.findByText("Sem perfil de produção aplicado.");
    // Nenhum zero disfarçado de tempo previsto.
    expect(container.textContent).not.toContain("Tempo sequencial previsto");

    fireEvent.click(await screen.findByRole("button", { name: "Aplicar perfil de produção" }));

    await waitFor(() => expect(applyProductionProfileMock).toHaveBeenCalledWith("op-1"));
    await waitFor(() => expect(screen.getByText(/PPR-000012 · V3/)).toBeInTheDocument());
  });

  it("OP legada sem perfil, e produto também sem padrão: só a frase, sem botão", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento({ snapshot: null })));

    renderizar();

    await screen.findByText("Sem perfil de produção aplicado.");
    expect(screen.queryByRole("button", { name: "Aplicar perfil de produção" })).toBeNull();
  });

  it("avisa da versão mais recente e atualiza o perfil com confirmação", async () => {
    const comV1 = planejamento({
      snapshot: { ...SNAPSHOT, sourceVersionId: "ver-1", sourceVersionNumber: 1 },
      availableProfile: {
        versionId: "ver-3",
        profileId: "ppr-1",
        profileCode: "PPR-000012",
        profileName: "Cápsulas 500 mg",
        versionNumber: 3,
      },
      canUpdate: true,
    });
    getProductionOrderMock.mockResolvedValue(ordem(comV1));
    applyProductionProfileMock.mockResolvedValue(ordem(planejamento()));

    const { container } = renderizar();

    await screen.findByText(/Há uma versão mais recente do perfil disponível/);
    expect(container.textContent).toContain("PPR-000012 · V1");

    fireEvent.click(screen.getByRole("button", { name: "Atualizar perfil" }));
    // Confirmação simples antes de trocar o roteiro inteiro.
    await screen.findByText("Atualizar perfil de produção?");

    fireEvent.click(screen.getByRole("button", { name: "Atualizar perfil de produção" }));
    await waitFor(() => expect(applyProductionProfileMock).toHaveBeenCalledWith("op-1"));
    await waitFor(() => expect(screen.getByText(/PPR-000012 · V3/)).toBeInTheDocument());
  });

  it("fora do rascunho não há nenhuma ação de alteração do perfil", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem(planejamento(), { status: "RELEASED" }),
    );

    const { container } = renderizar();

    await screen.findByText("Planejamento previsto");
    expect(container.textContent).toContain("PPR-000012 · V3");
    expect(screen.queryByRole("button", { name: "Aplicar perfil de produção" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Atualizar perfil" })).toBeNull();
    expect(container.textContent).not.toContain("Há uma versão mais recente");
  });

  it("mudar a quantidade em rascunho refaz a projeção, sem recopiar o perfil", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));

    const { container } = renderizar();
    await screen.findByText("Planejamento previsto");
    expect(container.textContent).toContain("3 lotes");

    fireEvent.change(screen.getByLabelText(/Quantidade planejada/), {
      target: { value: "1000" },
    });

    // 1.000 un: um lote na mistura, e a pesagem cai para a base.
    await waitFor(() => expect(container.textContent).toContain("1 lote"));
    expect(container.textContent).not.toContain("3 lotes");
    // A cópia não foi tocada: mesma versão de origem, sem chamada ao servidor.
    expect(container.textContent).toContain("PPR-000012 · V3");
    expect(applyProductionProfileMock).not.toHaveBeenCalled();
  });
});

describe("Planejamento previsto — 390px", () => {
  it("os valores empilham em tela estreita, e nenhuma tabela larga entra na seção", async () => {
    const css = readFileSync(join(process.cwd(), "src", "pages", "planning", "planning.css"), "utf8");
    const estreita = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(estreita).toContain(".profile-preview__values");
    expect(estreita).toContain("grid-template-columns: 1fr");

    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));
    const { container } = renderizar();
    await screen.findByText("Planejamento previsto");

    // Etapa é cartão com rótulo em cada valor, nunca linha de tabela.
    expect(container.querySelectorAll(".profile-preview__steps > li")).toHaveLength(2);
    expect(container.querySelector(".profile-preview__steps table")).toBeNull();
    // A única tabela é a de demanda, com duas colunas e rolagem própria.
    const demanda = container.querySelector(".table-container table");
    expect(demanda).not.toBeNull();
    expect(demanda!.querySelectorAll("thead th")).toHaveLength(2);
  });
});
