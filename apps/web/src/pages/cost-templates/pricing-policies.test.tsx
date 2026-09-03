import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  PricingPolicyDTO,
  PricingPolicyPreviewDTO,
  PricingPolicySummaryDTO,
  PricingPolicyVersionDTO,
  PricingVersionDTO,
} from "@veridi/shared";

/**
 * Biblioteca de políticas de precificação — o que a tela precisa deixar claro.
 *
 * A política guarda REGRA, nunca preço. O preço aparece uma única vez: na
 * prévia calculada sobre o custo DESTE produto, antes de confirmar. Se a tela
 * mostrasse um preço guardado na política, alguém venderia com o custo de
 * outro produto.
 */

const listPricingPolicies = vi.fn();
const getPricingPolicy = vi.fn();
const createPricingPolicy = vi.fn();
const updatePricingPolicy = vi.fn();
const setPricingPolicyArchived = vi.fn();
const updatePricingPolicyVersion = vi.fn();
const activatePricingPolicyVersion = vi.fn();
const createPolicyVersionFrom = vi.fn();
const comparePricingPolicyVersions = vi.fn();
const previewPricingPolicy = vi.fn();
const applyPricingPolicyToProduct = vi.fn();
const getPricingPolicyUpdate = vi.fn();
const createPolicyFromPricingVersion = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  listPricingPolicies: (...a: unknown[]) => listPricingPolicies(...a),
  getPricingPolicy: (...a: unknown[]) => getPricingPolicy(...a),
  createPricingPolicy: (...a: unknown[]) => createPricingPolicy(...a),
  updatePricingPolicy: (...a: unknown[]) => updatePricingPolicy(...a),
  setPricingPolicyArchived: (...a: unknown[]) => setPricingPolicyArchived(...a),
  updatePricingPolicyVersion: (...a: unknown[]) => updatePricingPolicyVersion(...a),
  activatePricingPolicyVersion: (...a: unknown[]) => activatePricingPolicyVersion(...a),
  createPolicyVersionFrom: (...a: unknown[]) => createPolicyVersionFrom(...a),
  comparePricingPolicyVersions: (...a: unknown[]) => comparePricingPolicyVersions(...a),
  previewPricingPolicy: (...a: unknown[]) => previewPricingPolicy(...a),
  applyPricingPolicyToProduct: (...a: unknown[]) => applyPricingPolicyToProduct(...a),
  getPricingPolicyUpdate: (...a: unknown[]) => getPricingPolicyUpdate(...a),
  createPolicyFromPricingVersion: (...a: unknown[]) => createPolicyFromPricingVersion(...a),
  listCostTemplates: vi.fn(),
  getCostTemplate: vi.fn(),
  applyCostTemplateToProduct: vi.fn(),
  getCostTemplateUpdate: vi.fn(),
  compareCostVersionWithTemplate: vi.fn(),
  createCostTemplateFromVersion: vi.fn(),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => navigate, useParams: () => ({ policyId: "tpp-1" }) };
});

import { PricingPoliciesPage } from "./PricingPoliciesPage";
import { PricingPolicyDetailPage } from "./PricingPolicyDetailPage";
import { UsePricingPolicyDialog } from "./UsePricingPolicyDialog";
import { PricingPolicyOrigin } from "./PricingPolicyOrigin";

function resumo(overrides: Partial<PricingPolicySummaryDTO> = {}): PricingPolicySummaryDTO {
  return {
    id: "tpp-1",
    code: "TPP-000002",
    name: "Private Label — Padrão",
    description: null,
    archived: false,
    activeVersionId: "tppv-1",
    activeVersionNumber: 1,
    tierCount: 3,
    tierQuantities: ["500", "1000", "3000"],
    hasDraft: false,
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function versao(overrides: Partial<PricingPolicyVersionDTO> = {}): PricingPolicyVersionDTO {
  return {
    id: "tppv-1",
    pricingPolicyTemplateId: "tpp-1",
    templateCode: "TPP-000002",
    templateName: "Private Label — Padrão",
    versionNumber: 1,
    versionLabel: "TPP-000002 V1",
    status: "ACTIVE",
    notes: null,
    tiers: [
      {
        id: "t1",
        quantity: "500",
        uomCode: "un",
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: "35.0000",
        commissionPercent: "5.0000",
        notes: null,
        sortOrder: 0,
      },
      {
        id: "t2",
        quantity: "3000",
        uomCode: "un",
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: "28.0000",
        commissionPercent: "5.0000",
        notes: null,
        sortOrder: 1,
      },
    ],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: "2026-07-02T12:00:00.000Z",
    activatedBy: "Admin",
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 2,
    ...overrides,
  };
}

function policy(overrides: Partial<PricingPolicyDTO> = {}): PricingPolicyDTO {
  const ativa = versao();
  return {
    id: "tpp-1",
    code: "TPP-000002",
    name: "Private Label — Padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: ativa,
    draftVersion: null,
    versions: [ativa],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function previa(overrides: Partial<PricingPolicyPreviewDTO> = {}): PricingPolicyPreviewDTO {
  return {
    policyCode: "TPP-000002",
    policyVersionLabel: "TPP-000002 V1",
    productId: "p-1",
    productCode: "PRD-000031",
    calculationId: "calc-1",
    calculationCode: "CALC-001640",
    costReferenceDate: "2026-08-01T12:00:00.000Z",
    costQuality: "COMPLETE_REAL_REFERENCE",
    tiers: [
      {
        quantity: "500",
        uomCode: "un",
        targetContributionMarginPercent: "35.0000",
        commissionPercent: "5.0000",
        costPerUnit: "3.2000",
        suggestedUnitPrice: "5.3333",
        costQuality: "COMPLETE_REAL_REFERENCE",
        warning: null,
      },
      {
        quantity: "3000",
        uomCode: "un",
        targetContributionMarginPercent: "28.0000",
        commissionPercent: "5.0000",
        costPerUnit: "2.8000",
        suggestedUnitPrice: "4.1791",
        costQuality: "COMPLETE_REAL_REFERENCE",
        warning: null,
      },
    ],
    ...overrides,
  };
}

function precificacao(overrides: Partial<PricingVersionDTO> = {}): PricingVersionDTO {
  return {
    id: "prec-1",
    productId: "p-1",
    industrialCostCalculationId: "calc-1",
    calculationCode: "CALC-001640",
    originPricingPolicyVersionId: "tppv-1",
    originPricingPolicyCode: "TPP-000002",
    originPricingPolicyVersionNumber: 1,
    originPricingPolicyName: "Private Label — Padrão",
    tiers: [],
    ...overrides,
  } as PricingVersionDTO;
}

function renderizar(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  listPricingPolicies.mockResolvedValue({
    policies: [resumo()],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  getPricingPolicy.mockResolvedValue(policy());
  previewPricingPolicy.mockResolvedValue(previa());
  getPricingPolicyUpdate.mockResolvedValue(null);
});

describe("Biblioteca de políticas", () => {
  it("lista a política pelas faixas, sem nenhum preço", async () => {
    renderizar(<PricingPoliciesPage />);
    expect(await screen.findByText("TPP-000002")).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).toBeNull();
  });
});

describe("Detalhe da política", () => {
  it("mostra margem e comissão por faixa, nunca preço", async () => {
    renderizar(<PricingPolicyDetailPage />);
    await screen.findByText("Private Label — Padrão");
    expect(screen.getAllByText("35%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it("diz que o preço é calculado sobre o custo do produto no momento da aplicação", async () => {
    renderizar(<PricingPolicyDetailPage />);
    expect(
      await screen.findByText(
        /o preço de cada faixa é calculado sobre o custo do produto no momento da aplicação/,
      ),
    ).toBeInTheDocument();
  });

  it("avisa que as precificações já criadas não mudam quando a política muda", async () => {
    renderizar(<PricingPolicyDetailPage />);
    expect(
      await screen.findByText(/Nenhuma delas muda quando esta política muda/),
    ).toBeInTheDocument();
  });
});

describe("Usar política num cálculo de custo", () => {
  const props = {
    productId: "p-1",
    calculationId: "calc-1",
    calculationCode: "CALC-001640",
    saving: false,
  };

  it("nomeia a base de custo antes de escolher", async () => {
    renderizar(<UsePricingPolicyDialog {...props} onCancel={vi.fn()} onApply={vi.fn()} />);
    expect(await screen.findByText("CALC-001640")).toBeInTheDocument();
  });

  it("a prévia calcula o preço deste produto e não persiste nada", async () => {
    const onApply = vi.fn();
    renderizar(<UsePricingPolicyDialog {...props} onCancel={vi.fn()} onApply={onApply} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver prévia" }));

    await waitFor(() =>
      expect(previewPricingPolicy).toHaveBeenCalledWith("p-1", "tppv-1", "calc-1"),
    );
    // Preço unitário mostra até quatro casas: `5.3333` cortado em `R$ 5,33`
    // era o que fazia o documento de faturamento não fechar na conferência.
    expect(await screen.findByText("R$ 5,3333")).toBeInTheDocument();
    expect(screen.getByText("R$ 4,1791")).toBeInTheDocument();
    // Ver a prévia não aplica: nada foi gravado ainda.
    expect(applyPricingPolicyToProduct).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("deixa explícito que o preço é desta aplicação, não da política", async () => {
    renderizar(<UsePricingPolicyDialog {...props} onCancel={vi.fn()} onApply={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver prévia" }));
    expect(
      await screen.findByText(/A política guarda margem e comissão; recalcular\s+sobre outro/),
    ).toBeInTheDocument();
  });

  it("faixa sem preço explica o motivo em vez de mostrar zero", async () => {
    previewPricingPolicy.mockResolvedValue(
      previa({
        costQuality: "PARTIAL",
        tiers: [
          {
            quantity: "500",
            uomCode: "un",
            targetContributionMarginPercent: "35.0000",
            commissionPercent: "5.0000",
            costPerUnit: null,
            suggestedUnitPrice: null,
            costQuality: "PARTIAL",
            warning: "Custo de energia não configurado",
          },
        ],
      }),
    );
    renderizar(<UsePricingPolicyDialog {...props} onCancel={vi.fn()} onApply={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver prévia" }));

    expect(await screen.findByText("Custo de energia não configurado")).toBeInTheDocument();
    expect(screen.queryByText("R$ 0,00")).toBeNull();
  });

  it("só confirma depois da prévia, e entrega a versão da política", async () => {
    const onApply = vi.fn();
    renderizar(<UsePricingPolicyDialog {...props} onCancel={vi.fn()} onApply={onApply} />);
    // Sem escolher política, não existe botão de aplicar.
    await screen.findByText("TPP-000002");
    expect(screen.queryByRole("button", { name: /Aplicar e criar precificação/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar e criar precificação" }));
    expect(onApply).toHaveBeenCalledWith("tppv-1");
  });
});

describe("Origem da precificação", () => {
  it("mostra de qual política a precificação nasceu", async () => {
    renderizar(<PricingPolicyOrigin version={precificacao()} canEdit onChanged={vi.fn()} />);
    expect(await screen.findByText(/TPP-000002 · V1/)).toBeInTheDocument();
  });

  it("política nova cria outra precificação sobre o mesmo custo, sem mexer nesta", async () => {
    getPricingPolicyUpdate.mockResolvedValue({
      templateId: "tpp-1",
      templateCode: "TPP-000002",
      templateName: "Private Label — Padrão",
      originVersionId: "tppv-1",
      originVersionNumber: 1,
      latestVersionId: "tppv-2",
      latestVersionNumber: 2,
    });
    applyPricingPolicyToProduct.mockResolvedValue({ id: "prec-2" });

    renderizar(<PricingPolicyOrigin version={precificacao()} canEdit onChanged={vi.fn()} />);
    expect(await screen.findByText(/não muda sozinha/)).toBeInTheDocument();
    expect(screen.getByText(/mesmo cálculo de custo \(\s*CALC-001640/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Criar precificação a partir da V2" }));
    await waitFor(() =>
      expect(applyPricingPolicyToProduct).toHaveBeenCalledWith("p-1", "tppv-2", "calc-1"),
    );
  });

  it("salvar como política avisa que preço à mão fica de fora", async () => {
    renderizar(
      <PricingPolicyOrigin
        version={precificacao({
          originPricingPolicyVersionId: null,
          originPricingPolicyCode: null,
          tiers: [
            { id: "x", priceMode: "MANUAL_PRICE" },
            { id: "y", priceMode: "TARGET_MARGIN" },
          ] as PricingVersionDTO["tiers"],
        })}
        canEdit
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salvar como política" }));
    expect(screen.getByText(/nunca preço/)).toBeInTheDocument();
    expect(
      screen.getByText(/As faixas com preço informado à mão ficam de fora/),
    ).toBeInTheDocument();
  });

  it("sem faixa manual, não fala de exclusão que não vai acontecer", async () => {
    renderizar(
      <PricingPolicyOrigin
        version={precificacao({
          originPricingPolicyVersionId: null,
          originPricingPolicyCode: null,
          tiers: [{ id: "y", priceMode: "TARGET_MARGIN" }] as PricingVersionDTO["tiers"],
        })}
        canEdit
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salvar como política" }));
    expect(screen.queryByText(/ficam de fora/)).toBeNull();
  });
});
