import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  ProductionOrderDTO,
  ProductionOrderPlanningDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";
import { planProductionProfileSnapshot } from "@veridi/shared";

/**
 * ROTEIRO DE PRODUÇÃO na tela da Ordem de Produção —
 * PLANNING-OP-SNAPSHOT-01 e PRODUCTION-ROUTE-ASSIGNMENT-01, §89.
 *
 * O que estes testes protegem:
 *
 * - com roteiro, a ordem mostra a cópia congelada, de onde veio e por quê;
 * - sem roteiro, o bloco diz que está PENDENTE, o que isso impede e oferece o
 *   caminho: o padrão atual do produto ou outro roteiro, escolhido com resumo;
 * - trocar pede motivo, e a programação existente só sai com confirmação;
 * - ordem planejada ou liberada sem roteiro é regularização, com confirmação;
 * - sucesso só aparece DEPOIS da resposta, e recusa vira alerta;
 * - quem não opera a ordem vê tudo e não recebe nenhuma ação.
 */

const sessao = vi.hoisted(() => ({ atual: null as null | { user: { role: string } } }));

vi.mock("../../app/AuthProvider", () => ({
  useOptionalAuth: () => sessao.atual,
  useAuth: () => sessao.atual ?? { user: null, loading: false, refresh: vi.fn(), signOut: vi.fn() },
}));
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
vi.mock("../../lib/production-profiles-api", () => ({
  listProductionProfiles: vi.fn(),
  getProductionProfileVersion: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ]),
}));
vi.mock("../../lib/production-schedules-api", () => ({
  getProductionOrderSchedule: vi.fn(async () => ({ schedule: null })),
  unscheduleProductionOrder: vi.fn(),
  previewProductionOrderSchedule: vi.fn(),
  scheduleProductionOrder: vi.fn(),
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
import {
  getProductionProfileVersion,
  listProductionProfiles,
} from "../../lib/production-profiles-api";
import { getProductionOrderSchedule } from "../../lib/production-schedules-api";
import { ProductionOrderPage } from "./ProductionOrderPage";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const applyProductionProfileMock = vi.mocked(applyProductionProfile);
const listProductionProfilesMock = vi.mocked(listProductionProfiles);
const getProductionProfileVersionMock = vi.mocked(getProductionProfileVersion);
const getProductionOrderScheduleMock = vi.mocked(getProductionOrderSchedule);

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

const UNIDADES = [
  { code: "un", dimension: "COUNT", toBaseFactor: "1" },
  { code: "g", dimension: "MASS", toBaseFactor: "1" },
  { code: "kg", dimension: "MASS", toBaseFactor: "1000" },
];

const PADRAO = {
  versionId: "ver-3",
  profileId: "ppr-1",
  profileCode: "PPR-000012",
  profileName: "Cápsulas 500 mg",
  versionNumber: 3,
  referenceQuantity: "1000",
  referenceUomCode: "un",
};

function planejamento(
  overrides: Partial<ProductionOrderPlanningDTO> = {},
  quantidade = "3000",
): ProductionOrderPlanningDTO {
  const snapshot = "snapshot" in overrides ? overrides.snapshot! : SNAPSHOT;
  return {
    snapshot,
    plan: snapshot ? planProductionProfileSnapshot(snapshot, quantidade) : null,
    quantityInReferenceUom: snapshot ? quantidade : null,
    conversionUnits: UNIDADES,
    planBlockedReason: null,
    appliedAt: snapshot ? "2026-09-12T13:00:00.000Z" : null,
    appliedBy: snapshot ? "Ana Produção" : null,
    applicationSource: snapshot ? "AUTO_PRODUCT_DEFAULT" : null,
    applicationReason: null,
    productDefaultProfile: null,
    productDefaultCompatible: false,
    availableProfile: null,
    canApply: false,
    canChoose: true,
    canUpdate: false,
    requiresLegacyRepair: false,
    routePending: snapshot === null,
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

const VERSAO_ALTERNATIVA: ProductionProfileVersionDTO = {
  id: "ver-9",
  productionProfileId: "ppr-9",
  profileCode: "PPR-000099",
  profileName: "Linha 2 — pó",
  versionNumber: 2,
  versionLabel: "V2",
  status: "ACTIVE",
  referenceQuantity: "500",
  referenceUomCode: "un",
  notes: null,
  steps: [
    {
      id: "st-1",
      sequence: 1,
      name: "Envase",
      description: null,
      setupDurationMinutes: 15,
      runDurationMinutes: 45,
      scalingMode: "PROPORTIONAL",
      resources: [],
    },
  ],
  createdAt: "2026-09-01T12:00:00.000Z",
  createdBy: null,
  activatedAt: "2026-09-02T12:00:00.000Z",
  activatedBy: null,
  archivedAt: null,
  sourceVersionId: null,
  sourceVersionNumber: null,
};

function renderizar(caminho = "/producao/ordens/op-1") {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Abre o campo de roteiro do diálogo e escolhe a versão alternativa. */
async function escolherAlternativa() {
  const dialogo = await screen.findByRole("dialog");
  const campo = within(dialogo).getByRole("combobox");
  fireEvent.focus(campo);
  fireEvent.mouseDown(await within(document.body).findByRole("option", { name: /PPR-000099 · V2/ }));
  await within(dialogo).findByRole("group", { name: "Resumo do roteiro escolhido" });
  return dialogo;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessao.atual = null;
  getProductionOrderScheduleMock.mockResolvedValue({ schedule: null });
  listProductionProfilesMock.mockResolvedValue({
    profiles: [
      {
        id: "ppr-9",
        code: "PPR-000099",
        name: "Linha 2 — pó",
        description: null,
        activeVersionId: "ver-9",
        activeVersionNumber: 2,
        referenceQuantity: "500",
        referenceUomCode: "un",
        stepNames: ["Envase"],
        hasDraft: false,
        defaultProductCount: 0,
        updatedAt: "2026-09-02T12:00:00.000Z",
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  getProductionProfileVersionMock.mockResolvedValue(VERSAO_ALTERNATIVA);
});

// ────────────────────────────────────────────────────────────────── testes

describe("Ordem de Produção — roteiro aplicado", () => {
  it("mostra roteiro, versão, origem, etapas, tempos e demanda de recursos", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem(planejamento({ applicationSource: "MANUAL_ORDER", applicationReason: "Linha 1 parada" })),
    );

    const { container } = renderizar();

    await screen.findByText("Roteiro de produção aplicado");
    expect(container.textContent).not.toContain("Planejamento previsto");

    expect(container.textContent).toContain("PPR-000012 · V3");
    expect(container.textContent).toContain("Cápsulas 500 mg");
    expect(container.textContent).toContain("por Ana Produção");
    expect(container.textContent).toContain("Escolhido para esta ordem — motivo: Linha 1 parada");

    expect(container.textContent).toContain("1. Pesagem");
    expect(container.textContent).toContain("2. Mistura");
    // Pesagem proporcional: 10 min × 3.000 ÷ 1.000 = 30 min, + 10 de preparação.
    expect(container.textContent).toContain("40 min");
    // Mistura por lote: 3 lotes × 60 min = 3 h, + 20 de preparação.
    expect(container.textContent).toContain("3 lotes");
    expect(container.textContent).toContain("3 h 20 min");
    expect(container.textContent).toContain("4 h");

    expect(container.textContent).toContain("Recursos necessários");
    expect(container.textContent).toContain("Misturador");
    expect(container.textContent).not.toContain("Custo do planejamento");
  });

  it("mudar a quantidade em rascunho refaz a projeção, sem recopiar o roteiro", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));

    const { container } = renderizar();
    await screen.findByText("Roteiro de produção aplicado");
    expect(container.textContent).toContain("3 lotes");

    fireEvent.change(screen.getByLabelText(/Quantidade planejada/), {
      target: { value: "1000" },
    });

    await waitFor(() => expect(container.textContent).toContain("1 lote"));
    expect(container.textContent).not.toContain("3 lotes");
    expect(container.textContent).toContain("PPR-000012 · V3");
    expect(applyProductionProfileMock).not.toHaveBeenCalled();
  });

  it("ordem em kg e roteiro em g: a tela converte a quantidade digitada antes da conta", async () => {
    const emGramas = {
      ...SNAPSHOT,
      referenceQuantity: "1000",
      referenceUomCode: "g",
      steps: [{ ...SNAPSHOT.steps[0]!, setupDurationMinutes: 0, runDurationMinutes: 60, resources: [] }],
    };
    getProductionOrderMock.mockResolvedValue(
      ordem(planejamento({ snapshot: emGramas, plan: null }), { plannedQuantity: "2", outputUnitCode: "kg" }),
    );

    const { container } = renderizar();
    await screen.findByText("Roteiro de produção aplicado");
    // 2 kg = 2000 g; 60 min por 1000 g são 2 h — nunca 0,12 min.
    await waitFor(() => expect(container.textContent).toContain("= 2000 g na unidade do roteiro"));
    expect(container.textContent).toContain("2 h");

    fireEvent.change(screen.getByLabelText(/Quantidade planejada/), { target: { value: "3" } });
    await waitFor(() => expect(container.textContent).toContain("= 3000 g na unidade do roteiro"));
    expect(container.textContent).toContain("3 h");
  });

  it("trocar em rascunho pede motivo e responde \"Roteiro atualizado.\" só depois do servidor", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));
    let concluir!: (valor: ProductionOrderDTO) => void;
    applyProductionProfileMock.mockReturnValue(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );

    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Alterar roteiro" }));
    const dialogo = await escolherAlternativa();

    // Resumo antes de aplicar: nome, versão, referência, unidade e etapas.
    expect(dialogo.textContent).toContain("PPR-000099 — Linha 2 — pó");
    expect(dialogo.textContent).toContain("V2");
    expect(dialogo.textContent).toContain("Envase");

    const aplicar = within(dialogo).getByRole("button", { name: "Aplicar somente nesta OP" });
    expect(aplicar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText(/Motivo \(obrigatório\)/), {
      target: { value: "Linha 1 em manutenção" },
    });
    expect(aplicar).toBeEnabled();
    fireEvent.click(aplicar);

    expect(await within(dialogo).findByRole("button", { name: "Alterando…" })).toBeDisabled();
    expect(screen.queryByText("Roteiro atualizado.")).toBeNull();
    expect(applyProductionProfileMock).toHaveBeenCalledWith("op-1", {
      productionProfileVersionId: "ver-9",
      reason: "Linha 1 em manutenção",
      expectedSourceVersionId: "ver-3",
    });

    concluir(
      ordem(
        planejamento({
          snapshot: { ...SNAPSHOT, sourceVersionId: "ver-9", sourceProfileCode: "PPR-000099", sourceVersionNumber: 2 },
          applicationSource: "MANUAL_ORDER",
          applicationReason: "Linha 1 em manutenção",
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Roteiro atualizado.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/PPR-000099 · V2/)).toBeInTheDocument();
  });

  it("com programação, a troca avisa que ela sai e só envia com a confirmação", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));
    getProductionOrderScheduleMock.mockResolvedValue({
      schedule: {
        productionOrderId: "op-1",
        productionOrderCode: "OP-000001",
        plannedStartAt: "2026-09-14T11:00:00.000Z",
        plannedEndAt: "2026-09-14T15:00:00.000Z",
        workingMinutes: 240,
        steps: [],
        scheduledAt: "2026-09-12T12:00:00.000Z",
        scheduledBy: "Ana",
        updatedAt: "2026-09-12T12:00:00.000Z",
        notes: null,
      },
    });
    applyProductionProfileMock.mockResolvedValue(ordem(planejamento()));

    renderizar();
    await screen.findByRole("group", { name: "Programação da ordem" });
    fireEvent.click(await screen.findByRole("button", { name: "Alterar roteiro" }));
    const dialogo = await escolherAlternativa();

    expect(dialogo.textContent).toContain(
      "Alterar o roteiro removerá a programação atual desta ordem, pois tempos e recursos podem mudar.",
    );
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: "Troca de linha" } });
    const aplicar = within(dialogo).getByRole("button", { name: "Aplicar somente nesta OP" });
    expect(aplicar).toBeDisabled();

    fireEvent.click(within(dialogo).getByLabelText("Remover a programação atual"));
    fireEvent.click(aplicar);
    await waitFor(() =>
      expect(applyProductionProfileMock).toHaveBeenCalledWith(
        "op-1",
        expect.objectContaining({ confirmScheduleRemoval: true, reason: "Troca de linha" }),
      ),
    );
  });

  it("fora do rascunho não há nenhuma ação de roteiro", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem(planejamento({ canChoose: false }), { status: "RELEASED" }),
    );

    const { container } = renderizar();

    await screen.findByText("Roteiro de produção aplicado");
    expect(container.textContent).toContain("PPR-000012 · V3");
    expect(screen.queryByRole("button", { name: "Alterar roteiro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar roteiro padrão atual" })).toBeNull();
  });
});

describe("Ordem de Produção — roteiro pendente", () => {
  it("diz o que falta, mostra produto e padrão, trava planejar, e aplica o padrão atual", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem(
        planejamento({
          snapshot: null,
          productDefaultProfile: PADRAO,
          productDefaultCompatible: true,
          availableProfile: PADRAO,
          canApply: true,
        }),
      ),
    );
    applyProductionProfileMock.mockResolvedValue(
      ordem(planejamento({ applicationSource: "PRODUCT_DEFAULT_APPLIED" })),
    );

    const { container } = renderizar();

    await screen.findByText("Roteiro de produção — Pendente");
    expect(container.textContent).toContain(
      "Esta ordem ainda não possui etapas, tempos e recursos de fabricação definidos. Aplique um roteiro antes de planejar, programar ou liberar a produção.",
    );
    const fatos = screen.getByRole("group", { name: "Roteiro do produto" });
    expect(fatos.textContent).toContain("PROD-000001 — Produto de Teste");
    expect(fatos.textContent).toContain("Cápsulas 500 mg · V3");
    // Nenhum zero disfarçado de tempo previsto.
    expect(container.textContent).not.toContain("Tempo sequencial previsto");

    expect(screen.getByRole("button", { name: "Planejar OP" })).toBeDisabled();
    expect(container.textContent).toContain("Aplique um roteiro de produção antes de planejar.");
    expect(screen.getByRole("button", { name: "Escolher outro roteiro" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar roteiro padrão atual" }));

    await waitFor(() =>
      expect(applyProductionProfileMock).toHaveBeenCalledWith("op-1", { expectedSourceVersionId: null }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Roteiro aplicado.");
    expect(await screen.findByText("Roteiro de produção aplicado")).toBeInTheDocument();
  });

  it("sem padrão: \"Não definido.\", escolher com resumo e definir como padrão do produto e aplicar", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento({ snapshot: null })));
    applyProductionProfileMock.mockResolvedValue(
      ordem(planejamento({ applicationSource: "DEFAULT_AND_APPLIED" })),
    );

    renderizar();

    await screen.findByText("Roteiro de produção — Pendente");
    expect(screen.getByRole("group", { name: "Roteiro do produto" }).textContent).toContain("Não definido.");
    expect(screen.queryByRole("button", { name: "Aplicar roteiro padrão atual" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Escolher roteiro para esta OP" }));
    const dialogo = await escolherAlternativa();
    expect(within(dialogo).getByRole("heading", { name: "Escolher roteiro para esta OP" })).toBeInTheDocument();
    // Primeira aplicação: motivo opcional.
    expect(within(dialogo).getByLabelText(/Motivo \(opcional\)/)).toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Definir como padrão do produto e aplicar" }));
    await waitFor(() =>
      expect(applyProductionProfileMock).toHaveBeenCalledWith("op-1", {
        productionProfileVersionId: "ver-9",
        setAsProductDefault: true,
        expectedSourceVersionId: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Roteiro aplicado.");
  });

  it("recusa do servidor vira alerta e nenhum sucesso é anunciado", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento({ snapshot: null })));
    applyProductionProfileMock.mockRejectedValue(
      new Error("A quantidade de referência do roteiro está em un e o produto é controlado em kg."),
    );

    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Escolher roteiro para esta OP" }));
    const dialogo = await escolherAlternativa();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aplicar somente nesta OP" }));

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("o produto é controlado em kg");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ordem planejada sem roteiro é regularização: confirmação e motivo, e liberar fica travado", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem(
        planejamento({
          snapshot: null,
          requiresLegacyRepair: true,
          productDefaultProfile: PADRAO,
          productDefaultCompatible: true,
          availableProfile: PADRAO,
          canApply: true,
        }),
        { status: "PLANNED" },
      ),
    );
    applyProductionProfileMock.mockResolvedValue(
      ordem(planejamento({ applicationSource: "LEGACY_REPAIR" }), { status: "PLANNED" }),
    );

    const { container } = renderizar();
    await screen.findByText("Roteiro de produção — Pendente");
    expect(screen.getByRole("button", { name: "Liberar OP" })).toBeDisabled();
    expect(container.textContent).toContain("Aplique um roteiro de produção antes de liberar.");

    // Mesmo o padrão atual passa pela confirmação: não há aplicação direta em legado.
    fireEvent.click(screen.getByRole("button", { name: "Aplicar roteiro padrão atual" }));
    const dialogo = await screen.findByRole("dialog");
    await within(dialogo).findByRole("group", { name: "Resumo do roteiro escolhido" });
    expect(applyProductionProfileMock).not.toHaveBeenCalled();

    const aplicar = within(dialogo).getByRole("button", { name: "Aplicar somente nesta OP" });
    fireEvent.change(within(dialogo).getByLabelText(/Motivo \(obrigatório\)/), {
      target: { value: "Planejada antes do roteiro obrigatório" },
    });
    expect(aplicar).toBeDisabled();
    fireEvent.click(within(dialogo).getByLabelText("Confirmo a regularização desta ordem"));
    fireEvent.click(aplicar);

    await waitFor(() =>
      expect(applyProductionProfileMock).toHaveBeenCalledWith("op-1", {
        productionProfileVersionId: "ver-9",
        reason: "Planejada antes do roteiro obrigatório",
        confirmLegacyRepair: true,
        expectedSourceVersionId: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Roteiro aplicado à ordem.");
  });

  it("Comercial vê a pendência e o roteiro padrão, mas não aplica, não escolhe, não planeja", async () => {
    sessao.atual = { user: { role: "COMMERCIAL" } };
    getProductionOrderMock.mockResolvedValue(
      ordem(
        planejamento({
          snapshot: null,
          productDefaultProfile: PADRAO,
          productDefaultCompatible: true,
          availableProfile: PADRAO,
          canApply: true,
        }),
      ),
    );

    const { container } = renderizar();
    await screen.findByText("Roteiro de produção — Pendente");
    expect(container.textContent).toContain("Cápsulas 500 mg · V3");
    for (const nome of [
      "Aplicar roteiro padrão atual",
      "Escolher outro roteiro",
      "Planejar OP",
      "Salvar rascunho",
      "Cancelar OP",
    ]) {
      expect(screen.queryByRole("button", { name: nome })).toBeNull();
    }
  });

  it("\"Resolver\" chega com ?foco=roteiro e o bloco do roteiro recebe o foco", async () => {
    getProductionOrderMock.mockResolvedValue(ordem(planejamento({ snapshot: null })));

    renderizar("/producao/ordens/op-1?foco=roteiro");

    await screen.findByText("Roteiro de produção — Pendente");
    await waitFor(() => expect(document.activeElement?.id).toBe("roteiro"));
  });
});

describe("Roteiro da OP — 390px", () => {
  it("os valores empilham, a etapa é cartão e as ações do seletor viram coluna", async () => {
    const css = readFileSync(join(process.cwd(), "src", "pages", "planning", "planning.css"), "utf8");
    const estreita = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(estreita).toContain(".profile-preview__values");
    expect(estreita).toContain("grid-template-columns: 1fr");
    const seletor = css.slice(css.indexOf("@media (max-width: 480px)"));
    expect(seletor).toContain(".route-chooser__actions");
    expect(seletor).toContain("flex-direction: column-reverse");
    expect(css).toContain(".confirm-dialog:has(.route-chooser)");

    getProductionOrderMock.mockResolvedValue(ordem(planejamento()));
    const { container } = renderizar();
    await screen.findByText("Roteiro de produção aplicado");

    expect(container.querySelectorAll(".profile-preview__steps > li")).toHaveLength(2);
    expect(container.querySelector(".profile-preview__steps table")).toBeNull();
    const demanda = container.querySelector(".table-container table");
    expect(demanda).not.toBeNull();
    expect(demanda!.querySelectorAll("thead th")).toHaveLength(2);
  });
});
