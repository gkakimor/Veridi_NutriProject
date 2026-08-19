import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  CostTemplateDTO,
  CostTemplateSummaryDTO,
  CostTemplateVersionDTO,
  IndustrialCostVersionDTO,
} from "@veridi/shared";

/**
 * Biblioteca de estruturas de custo — o que a tela precisa deixar claro.
 *
 * Dois assuntos se repetem porque são a promessa da capacidade: o template
 * NÃO carrega tarifa, e aplicá-lo COPIA. Se a tela sugerir o contrário em
 * qualquer canto, alguém vai orçar com a hora de máquina de outro semestre.
 */

const listCostTemplates = vi.fn();
const getCostTemplate = vi.fn();
const createCostTemplate = vi.fn();
const updateCostTemplate = vi.fn();
const setCostTemplateArchived = vi.fn();
const updateCostTemplateVersion = vi.fn();
const activateCostTemplateVersion = vi.fn();
const createCostTemplateVersionFrom = vi.fn();
const compareCostTemplateVersions = vi.fn();
const applyCostTemplateToProduct = vi.fn();
const getCostTemplateUpdate = vi.fn();
const compareCostVersionWithTemplate = vi.fn();
const createCostTemplateFromVersion = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  listCostTemplates: (...a: unknown[]) => listCostTemplates(...a),
  getCostTemplate: (...a: unknown[]) => getCostTemplate(...a),
  createCostTemplate: (...a: unknown[]) => createCostTemplate(...a),
  updateCostTemplate: (...a: unknown[]) => updateCostTemplate(...a),
  setCostTemplateArchived: (...a: unknown[]) => setCostTemplateArchived(...a),
  updateCostTemplateVersion: (...a: unknown[]) => updateCostTemplateVersion(...a),
  activateCostTemplateVersion: (...a: unknown[]) => activateCostTemplateVersion(...a),
  createCostTemplateVersionFrom: (...a: unknown[]) => createCostTemplateVersionFrom(...a),
  compareCostTemplateVersions: (...a: unknown[]) => compareCostTemplateVersions(...a),
  applyCostTemplateToProduct: (...a: unknown[]) => applyCostTemplateToProduct(...a),
  getCostTemplateUpdate: (...a: unknown[]) => getCostTemplateUpdate(...a),
  compareCostVersionWithTemplate: (...a: unknown[]) => compareCostVersionWithTemplate(...a),
  createCostTemplateFromVersion: (...a: unknown[]) => createCostTemplateFromVersion(...a),
  listPricingPolicies: vi.fn(),
  previewPricingPolicy: vi.fn(),
  applyPricingPolicyToProduct: vi.fn(),
  getPricingPolicyUpdate: vi.fn(),
  comparePricingPolicyVersions: vi.fn(),
  createPolicyFromPricingVersion: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () => Promise.resolve({ resources: [] }),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => navigate, useParams: () => ({ templateId: "tec-1" }) };
});

import { CostTemplatesPage } from "./CostTemplatesPage";
import { CostTemplateDetailPage } from "./CostTemplateDetailPage";
import { UseCostTemplateDialog } from "./UseCostTemplateDialog";
import { CostTemplateOrigin } from "./CostTemplateOrigin";

function resumo(overrides: Partial<CostTemplateSummaryDTO> = {}): CostTemplateSummaryDTO {
  return {
    id: "tec-1",
    code: "TEC-000004",
    name: "Cápsulas — Linha padrão",
    description: null,
    archived: false,
    activeVersionId: "tecv-2",
    activeVersionNumber: 2,
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    resourceCount: 2,
    additionalCostCount: 1,
    resourceNames: ["Encapsuladora", "Energia elétrica"],
    hasDraft: false,
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function versao(overrides: Partial<CostTemplateVersionDTO> = {}): CostTemplateVersionDTO {
  return {
    id: "tecv-2",
    industrialCostTemplateId: "tec-1",
    templateCode: "TEC-000004",
    templateName: "Cápsulas — Linha padrão",
    versionNumber: 2,
    versionLabel: "TEC-000004 V2",
    status: "ACTIVE",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    energyCalculationMode: "FROM_EQUIPMENT",
    energyResourceId: "res-energia",
    energyResourceName: "Energia elétrica",
    notes: null,
    resourceUsages: [
      {
        id: "u1",
        industrialResourceId: "res-enc",
        resourceCode: "REC-001",
        resourceName: "Encapsuladora",
        resourceType: "EQUIPMENT",
        usageBasis: "PER_BATCH",
        usageQuantity: "4",
        usageUom: "HOUR",
        notes: null,
        sortOrder: 0,
      },
    ],
    additionalCosts: [
      {
        id: "c1",
        category: "SECONDARY_PACKAGING",
        description: "Caixa de embarque",
        calculationBasis: "FIXED_PER_BATCH",
        rateValue: "180.0000",
        notes: null,
        sortOrder: 0,
      },
    ],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: "2026-07-02T12:00:00.000Z",
    activatedBy: "Admin",
    archivedAt: null,
    sourceVersionId: "tecv-1",
    sourceVersionNumber: 1,
    usageCount: 3,
    ...overrides,
  };
}

function template(overrides: Partial<CostTemplateDTO> = {}): CostTemplateDTO {
  const ativa = versao();
  return {
    id: "tec-1",
    code: "TEC-000004",
    name: "Cápsulas — Linha padrão",
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

function estrutura(overrides: Partial<IndustrialCostVersionDTO> = {}): IndustrialCostVersionDTO {
  return {
    id: "ec-1",
    label: "EC-000010 V1",
    originCostTemplateVersionId: "tecv-1",
    originCostTemplateCode: "TEC-000004",
    originCostTemplateVersionNumber: 1,
    originCostTemplateName: "Cápsulas — Linha padrão",
    ...overrides,
  } as IndustrialCostVersionDTO;
}

function renderizar(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  listCostTemplates.mockResolvedValue({ templates: [resumo()], page: 1, pageSize: 20, total: 1 });
  getCostTemplate.mockResolvedValue(template());
  getCostTemplateUpdate.mockResolvedValue(null);
});

describe("Biblioteca de estruturas de custo", () => {
  it("lista o template com base, recursos e versão ativa", async () => {
    renderizar(<CostTemplatesPage />);
    expect(await screen.findByText("TEC-000004")).toBeInTheDocument();
    expect(screen.getByText("Cápsulas — Linha padrão")).toBeInTheDocument();
    expect(screen.getByText("V2")).toBeInTheDocument();
    expect(screen.getByText("1000 un")).toBeInTheDocument();
  });

  it("busca também pelo recurso configurado", async () => {
    renderizar(<CostTemplatesPage />);
    await screen.findByText("TEC-000004");
    fireEvent.change(screen.getByPlaceholderText(/Buscar por código, nome ou recurso/), {
      target: { value: "Encapsuladora" },
    });
    await waitFor(() =>
      expect(listCostTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Encapsuladora" }),
      ),
    );
  });

  it("promete cópia independente e tarifa resolvida na data, não congelada", async () => {
    renderizar(<CostTemplatesPage />);
    const texto = (await screen.findByText(/Aplicar um template cria uma estrutura independente/))
      .textContent;
    expect(texto).toMatch(/independente/);
    expect(texto).toMatch(/tarifas continuam sendo resolvidas na data do cálculo/);
  });
});

describe("Detalhe do template de estrutura", () => {
  it("mostra o uso do recurso sem nenhum valor de tarifa", async () => {
    renderizar(<CostTemplateDetailPage />);
    await screen.findByText("Cápsulas — Linha padrão");

    expect(screen.getAllByText(/Encapsuladora/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);

    // Preço da hora não pode aparecer em lugar nenhum da tela do template.
    expect(screen.queryByText(/R\$\s*88/)).toBeNull();
    expect(screen.queryByText(/por hora/i)).toBeNull();
  });

  it("diz que a versão ativa é histórica e que a tarifa vem da data do cálculo", async () => {
    renderizar(<CostTemplateDetailPage />);
    expect(
      await screen.findByText(/As tarifas dos recursos não fazem parte do template/),
    ).toBeInTheDocument();
  });

  it("avisa que as estruturas já criadas não mudam quando o template muda", async () => {
    renderizar(<CostTemplateDetailPage />);
    expect(
      await screen.findByText(/Nenhuma delas muda quando este template muda/),
    ).toBeInTheDocument();
  });

  it("não oferece edição da versão ativa — só criar nova versão", async () => {
    renderizar(<CostTemplateDetailPage />);
    expect(await screen.findByRole("button", { name: "Criar nova versão" })).toBeInTheDocument();
  });
});

describe("Usar template numa estrutura de custos", () => {
  it("lista só template com versão ativa", async () => {
    listCostTemplates.mockResolvedValue({
      templates: [resumo(), resumo({ id: "tec-2", code: "TEC-000005", activeVersionId: null, activeVersionNumber: null })],
      page: 1,
      pageSize: 30,
      total: 2,
    });
    renderizar(<UseCostTemplateDialog saving={false} onCancel={vi.fn()} onApply={vi.fn()} />);
    expect(await screen.findByText("TEC-000004")).toBeInTheDocument();
    expect(screen.queryByText("TEC-000005")).toBeNull();
  });

  it("a prévia mostra configuração e nenhuma tarifa", async () => {
    renderizar(<UseCostTemplateDialog saving={false} onCancel={vi.fn()} onApply={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));

    await screen.findByText(/REC-001 — Encapsuladora/);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(
      screen.getByText(/As tarifas — valor da hora, da energia — vêm do cadastro na data/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it("aplicar entrega a versão escolhida, e não o template", async () => {
    const onApply = vi.fn();
    renderizar(<UseCostTemplateDialog saving={false} onCancel={vi.fn()} onApply={onApply} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usar este template" }));
    expect(onApply).toHaveBeenCalledWith("tecv-2");
  });
});

describe("Origem da estrutura de custos", () => {
  it("mostra de qual template a estrutura nasceu", async () => {
    renderizar(
      <CostTemplateOrigin
        version={estrutura()}
        productId="p-1"
        canEdit
        onChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText(/TEC-000004 · V1/)).toBeInTheDocument();
  });

  it("versão nova do template não atualiza a estrutura — cria outra versão", async () => {
    getCostTemplateUpdate.mockResolvedValue({
      templateId: "tec-1",
      templateCode: "TEC-000004",
      templateName: "Cápsulas — Linha padrão",
      originVersionId: "tecv-1",
      originVersionNumber: 1,
      latestVersionId: "tecv-2",
      latestVersionNumber: 2,
    });
    renderizar(
      <CostTemplateOrigin version={estrutura()} productId="p-1" canEdit onChanged={vi.fn()} />,
    );

    expect(await screen.findByText(/não muda sozinha/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Criar nova versão a partir da V2" }),
    ).toBeInTheDocument();
    // Não existe atalho para sobrescrever o que já virou custo e preço.
    expect(screen.queryByRole("button", { name: /Atualizar esta estrutura/i })).toBeNull();
  });

  it("salvar como template avisa que a tarifa não vai junto", async () => {
    renderizar(
      <CostTemplateOrigin
        version={estrutura({ originCostTemplateVersionId: null, originCostTemplateCode: null })}
        productId="p-1"
        canEdit
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salvar como template" }));
    expect(
      screen.getByText(/recursos, uso, energia e premissas —, nunca as\s+tarifas/),
    ).toBeInTheDocument();
  });

  it("quem não edita não vê salvar como template", async () => {
    renderizar(
      <CostTemplateOrigin
        version={estrutura()}
        productId="p-1"
        canEdit={false}
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText(/TEC-000004 · V1/);
    expect(screen.queryByRole("button", { name: "Salvar como template" })).toBeNull();
  });
});
