import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  ProductProductionProfileDTO,
  ProductionOrderDTO,
  ProductionOrderPlanningDTO,
  ProductionProfileDTO,
  ProductionProfileSummaryDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";
import { PLANEJAMENTO_VAZIO } from "../production-orders/planejamento-vazio";

/**
 * Roteiro de Produção arquivado na tela — PRODUCTION-PROFILE-ARCHIVE-01 (§89).
 *
 * O que a tela precisa garantir: Arquivar (com confirmação que diz o efeito nos
 * produtos) e Desarquivar só para quem configura; a marca "Arquivado" na
 * consulta; a lista sem arquivados por padrão e com "Mostrar arquivados";
 * seletores que só pedem roteiros ativos; o aviso no Produto cujo padrão foi
 * arquivado; e o histórico — versões, produtos, a cópia na OP — ainda à vista.
 * A API é a autoridade: aqui só se prova o que a tela oferece e o que ela diz.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));

const listProductionProfiles = vi.fn();
const getProductionProfile = vi.fn();
const getProductionProfileVersion = vi.fn();
const getProductProductionProfile = vi.fn();
const setProductionProfileArchived = vi.fn();
const setProductProductionProfile = vi.fn();

vi.mock("../../lib/production-profiles-api", () => ({
  listProductionProfiles: (...a: unknown[]) => listProductionProfiles(...a),
  getProductionProfile: (...a: unknown[]) => getProductionProfile(...a),
  getProductionProfileVersion: (...a: unknown[]) => getProductionProfileVersion(...a),
  getProductProductionProfile: (...a: unknown[]) => getProductProductionProfile(...a),
  setProductionProfileArchived: (...a: unknown[]) => setProductionProfileArchived(...a),
  setProductProductionProfile: (...a: unknown[]) => setProductProductionProfile(...a),
  createProductionProfile: vi.fn(),
  updateProductionProfile: vi.fn(),
  updateProductionProfileVersion: vi.fn(),
  activateProductionProfileVersion: vi.fn(),
  createProductionProfileVersionFrom: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () => Promise.resolve({ resources: [], page: 1, pageSize: 20, total: 0 }),
}));

vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    ]),
}));

vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [], page: 1, pageSize: 20, total: 0 }),
}));

const applyProductionProfile = vi.fn();
vi.mock("../../lib/production-orders-api", () => ({
  applyProductionProfile: (...a: unknown[]) => applyProductionProfile(...a),
}));

vi.mock("../../lib/production-schedules-api", () => ({
  getProductionOrderSchedule: () => Promise.resolve({ schedule: null }),
  unscheduleProductionOrder: vi.fn(),
  previewProductionOrderSchedule: vi.fn(),
  scheduleProductionOrder: vi.fn(),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Ana Produção", role: sessao.role } }),
  useOptionalAuth: () => ({ user: { id: "u-1", name: "Ana Produção", role: sessao.role } }),
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => vi.fn(), useParams: () => ({ profileId: "ppr-1" }) };
});

import { ProductionProfilesPage } from "./ProductionProfilesPage";
import { ProductionProfileDetailPage } from "./ProductionProfileDetailPage";
import { ProductDefaultRouteSection } from "../products/ProductDefaultRouteSection";
import { ProductionPlanningSection } from "../production-orders/ProductionPlanningSection";
import { RouteChooserDialog } from "../production-orders/RouteChooserDialog";

// ─────────────────────────────────────────────────────────────── fixtures

function versao(sobre: Partial<ProductionProfileVersionDTO> = {}): ProductionProfileVersionDTO {
  return {
    id: "ppv-1",
    productionProfileId: "ppr-1",
    profileCode: "PPR-000001",
    profileName: "Cápsulas — linha padrão",
    versionNumber: 1,
    versionLabel: "V1",
    status: "ACTIVE",
    referenceQuantity: "1000",
    referenceUomCode: "un",
    notes: null,
    steps: [
      {
        id: "st-1",
        sequence: 1,
        name: "Mistura",
        description: null,
        setupDurationMinutes: 10,
        runDurationMinutes: 120,
        scalingMode: "PROPORTIONAL",
        resources: [],
      },
    ],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: "2026-09-11T13:00:00.000Z",
    activatedBy: "Admin",
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    profileArchived: false,
    ...sobre,
  };
}

function perfil(sobre: Partial<ProductionProfileDTO> = {}): ProductionProfileDTO {
  const ativa = versao({ profileArchived: sobre.archived === true });
  return {
    id: "ppr-1",
    code: "PPR-000001",
    name: "Cápsulas — linha padrão",
    description: null,
    archived: false,
    archivedAt: null,
    archivedBy: null,
    activeVersion: ativa,
    draftVersion: null,
    versions: [ativa],
    defaultProducts: [
      {
        productId: "prod-1",
        productCode: "PROD-000001",
        productName: "Whey Isolado",
        versionId: "ppv-1",
        versionNumber: 1,
        versionStatus: "ACTIVE",
      },
    ],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-11T12:00:00.000Z",
    ...sobre,
  };
}

const arquivado = () =>
  perfil({ archived: true, archivedAt: "2026-09-17T15:30:00.000Z", archivedBy: "Ana Produção" });

function resumo(sobre: Partial<ProductionProfileSummaryDTO>): ProductionProfileSummaryDTO {
  return {
    id: "ppr-1",
    code: "PPR-000001",
    name: "Cápsulas — linha padrão",
    description: null,
    archived: false,
    activeVersionId: "ppv-1",
    activeVersionNumber: 1,
    referenceQuantity: "1000",
    referenceUomCode: "un",
    stepNames: ["Mistura"],
    hasDraft: false,
    defaultProductCount: 1,
    updatedAt: "2026-09-11T12:00:00.000Z",
    ...sobre,
  };
}

const pagina = (profiles: ProductionProfileSummaryDTO[]) => ({ profiles, page: 1, pageSize: 20, total: profiles.length });

async function abrirDetalhe() {
  const utils = render(
    <MemoryRouter>
      <ProductionProfileDetailPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: /PPR-000001/ });
  return utils;
}

const titulo = () => screen.getByRole("heading", { level: 1 });

function ordem(planning: Partial<ProductionOrderPlanningDTO>): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey Isolado",
    status: "DRAFT",
    plannedQuantity: "3000",
    outputUnitCode: "un",
    updatedAt: "2026-09-17T12:00:00.000Z",
    planning: { ...PLANEJAMENTO_VAZIO, ...planning },
  } as unknown as ProductionOrderDTO;
}

const PADRAO_ARQUIVADO = {
  versionId: "ppv-1",
  profileId: "ppr-1",
  profileCode: "PPR-000001",
  profileName: "Cápsulas — linha padrão",
  versionNumber: 1,
  referenceQuantity: "1000",
  referenceUomCode: "un",
  profileArchived: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  sessao.role = "ADMIN";
  listProductionProfiles.mockResolvedValue(pagina([]));
});

// ────────────────────────────────────────────────────────────────── testes

describe("Roteiros de Produção — lista e arquivados", () => {
  it("o recorte padrão não pede arquivados; \"Mostrar arquivados\" pede só eles e marca a linha", async () => {
    listProductionProfiles.mockImplementation(async (params: { archived?: boolean }) =>
      params.archived
        ? pagina([resumo({ id: "ppr-2", code: "PPR-000002", name: "Linha antiga", archived: true })])
        : pagina([resumo({})]),
    );
    render(
      <MemoryRouter>
        <ProductionProfilesPage />
      </MemoryRouter>,
    );

    const vivo = (await screen.findByText("Cápsulas — linha padrão")).closest("tr") as HTMLElement;
    expect(within(vivo).queryByText("Arquivado")).toBeNull();
    expect(listProductionProfiles.mock.calls[0]![0]).not.toHaveProperty("archived");

    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar arquivados" }));

    const antigo = (await screen.findByText("Linha antiga")).closest("tr") as HTMLElement;
    expect(within(antigo).getByText("Arquivado")).toBeInTheDocument();
    expect(listProductionProfiles).toHaveBeenLastCalledWith(expect.objectContaining({ archived: true, page: 1 }));
    expect(screen.queryByText("Cápsulas — linha padrão")).toBeNull();
  });

  it("sem arquivados, a lista diz isso — e não sugere criar", async () => {
    render(
      <MemoryRouter>
        <ProductionProfilesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Nenhum Roteiro de Produção ainda/);

    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar arquivados" }));

    expect(await screen.findByText("Nenhum roteiro arquivado.")).toBeInTheDocument();
  });
});

describe("Roteiro de Produção — Arquivar e Desarquivar", () => {
  it("Arquivar confirma dizendo o efeito nos produtos, grava e marca \"Arquivado\"", async () => {
    getProductionProfile.mockResolvedValueOnce(perfil()).mockResolvedValue(arquivado());
    setProductionProfileArchived.mockResolvedValue(arquivado());
    await abrirDetalhe();
    expect(within(titulo()).queryByText("Arquivado")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }));

    const dialogo = screen.getByRole("alertdialog", { name: "Arquivar este roteiro?" });
    expect(dialogo.textContent).toContain("1 produto tem este roteiro como padrão.");
    expect(dialogo.textContent).toContain("as novas ordens desses produtos vão nascer sem roteiro");
    expect(dialogo.textContent).toContain("Nada é apagado");
    expect(setProductionProfileArchived).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Arquivar" }));

    await waitFor(() => expect(setProductionProfileArchived).toHaveBeenCalledWith("ppr-1", true));
    expect(await screen.findByText("Roteiro arquivado.")).toBeInTheDocument();
    expect(within(titulo()).getByText("Arquivado")).toBeInTheDocument();
    expect(screen.getByText(/Arquivado em .* por Ana Produção\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desarquivar" })).toBeInTheDocument();
    expect(setProductionProfileArchived).toHaveBeenCalledTimes(1);
  });

  it("cancelar a confirmação não grava nada", async () => {
    getProductionProfile.mockResolvedValue(perfil());
    await abrirDetalhe();

    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(setProductionProfileArchived).not.toHaveBeenCalled();
  });

  it("Desarquivar grava direto e devolve o roteiro às escolhas de padrão", async () => {
    getProductionProfile.mockResolvedValueOnce(arquivado()).mockResolvedValue(perfil());
    setProductionProfileArchived.mockResolvedValue(perfil());
    await abrirDetalhe();
    expect(screen.queryByRole("button", { name: "Definir V1 como padrão" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Desarquivar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(setProductionProfileArchived).toHaveBeenCalledWith("ppr-1", false));
    expect(await screen.findByText("Roteiro desarquivado.")).toBeInTheDocument();
    expect(within(titulo()).queryByText("Arquivado")).toBeNull();
    expect(screen.getByRole("button", { name: "Definir V1 como padrão" })).toBeInTheDocument();
  });

  it("arquivado continua consultável: versões, etapas e produtos à vista; só não vira padrão novo", async () => {
    getProductionProfile.mockResolvedValue(arquivado());
    await abrirDetalhe();

    expect(within(titulo()).getByText("Arquivado")).toBeInTheDocument();
    expect(screen.getByText("Roteiro arquivado")).toBeInTheDocument();
    expect(screen.getByText("Versão ativa — V1")).toBeInTheDocument();
    expect(screen.getAllByText("Mistura").length).toBeGreaterThan(0);
    expect(screen.getByText("PROD-000001")).toBeInTheDocument();
    // Tirar o padrão de quem já usa não é compromisso novo.
    expect(screen.getByRole("button", { name: "Tirar padrão" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Definir V1 como padrão" })).toBeNull();
    expect(screen.getByText(/Roteiro arquivado não é definido como padrão de produto/)).toBeInTheDocument();
  });

  it.each(["QUALITY", "COMMERCIAL", "PURCHASING", "VIEWER"])(
    "%s lê o roteiro arquivado, sem Arquivar nem Desarquivar",
    async (role) => {
      sessao.role = role;
      getProductionProfile.mockResolvedValue(arquivado());
      await abrirDetalhe();

      expect(within(titulo()).getByText("Arquivado")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Desarquivar" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Arquivar" })).toBeNull();
    },
  );
});

describe("Produto com o roteiro padrão arquivado", () => {
  const padrao = (profileArchived: boolean): ProductProductionProfileDTO => ({
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey Isolado",
    productUomCode: "un",
    version: {
      id: "ppv-1",
      productionProfileId: "ppr-1",
      profileCode: "PPR-000001",
      profileName: "Cápsulas — linha padrão",
      versionNumber: 1,
      status: "ACTIVE",
      referenceQuantity: "1000",
      referenceUomCode: "un",
      profileArchived,
    },
  });

  it("mostra o aviso e a marca, mantém o apontamento, e o seletor só pede roteiros ativos", async () => {
    getProductProductionProfile.mockResolvedValue(padrao(true));
    render(<ProductDefaultRouteSection productId="prod-1" />);

    expect(await screen.findByText("Roteiro de Produção arquivado")).toBeInTheDocument();
    expect(screen.getByText(/as novas ordens deste produto nascem sem roteiro/)).toBeInTheDocument();
    const retrato = screen.getByRole("group", { name: "Roteiro padrão do produto" });
    expect(within(retrato).getByText("Arquivado")).toBeInTheDocument();
    expect(within(retrato).getByText(/Cápsulas — linha padrão/)).toBeInTheDocument();

    await waitFor(() => expect(listProductionProfiles).toHaveBeenCalled());
    for (const [params] of listProductionProfiles.mock.calls) {
      expect(params).toMatchObject({ activeOnly: true });
      expect(params).not.toHaveProperty("archived");
    }
  });

  it("padrão vivo não mostra aviso nenhum", async () => {
    getProductProductionProfile.mockResolvedValue(padrao(false));
    render(<ProductDefaultRouteSection productId="prod-1" />);

    await screen.findByRole("group", { name: "Roteiro padrão do produto" });
    expect(screen.queryByText("Roteiro de Produção arquivado")).toBeNull();
    expect(screen.queryByText("Arquivado")).toBeNull();
  });
});

describe("Ordem de Produção e o roteiro arquivado", () => {
  it("OP sem roteiro diz que o padrão do Produto está arquivado, não oferece aplicá-lo, e escolher só lista ativos", async () => {
    render(
      <ProductionPlanningSection
        order={ordem({
          routePending: true,
          canChoose: true,
          productDefaultProfile: PADRAO_ARQUIVADO,
          productDefaultCompatible: false,
          canApply: false,
        })}
        quantityDraft="3000"
        onApplied={vi.fn()}
        canOperate
      />,
    );

    const fatos = await screen.findByRole("group", { name: "Roteiro do produto" });
    expect(fatos.textContent).toContain("Cápsulas — linha padrão · V1");
    expect(fatos.textContent).toContain("roteiro arquivado: não se aplica a esta ordem");
    expect(fatos.textContent).not.toContain("não converte");
    expect(screen.queryByRole("button", { name: "Aplicar roteiro padrão atual" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Escolher roteiro para esta OP" }));

    await waitFor(() => expect(listProductionProfiles).toHaveBeenCalledWith({ activeOnly: true, pageSize: 20 }));
    for (const [params] of listProductionProfiles.mock.calls) expect(params).not.toHaveProperty("archived");
  });

  it("o diálogo recusa, com a frase certa, uma versão de roteiro arquivado", async () => {
    getProductionProfileVersion.mockResolvedValue(versao({ profileArchived: true }));
    render(
      <RouteChooserDialog
        order={ordem({ routePending: true, canChoose: true })}
        mode="primeira"
        initialVersionId="ppv-1"
        hasSchedule={false}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este roteiro está arquivado e não é aplicado a ordem nova. Escolha um roteiro ativo.",
    );
    expect(screen.getByRole("button", { name: "Aplicar somente nesta OP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Definir como padrão do produto e aplicar" })).toBeDisabled();
    expect(applyProductionProfile).not.toHaveBeenCalled();
  });

  it("OP com a cópia de um roteiro depois arquivado continua mostrando a cópia inteira", async () => {
    render(
      <ProductionPlanningSection
        order={ordem({
          snapshot: {
            sourceProfileId: "ppr-1",
            sourceProfileCode: "PPR-000001",
            sourceProfileName: "Cápsulas — linha padrão",
            sourceVersionId: "ppv-1",
            sourceVersionNumber: 1,
            referenceQuantity: "1000",
            referenceUomCode: "un",
            steps: [
              {
                sequence: 1,
                name: "Mistura",
                description: null,
                setupDurationMinutes: 10,
                runDurationMinutes: 120,
                scalingMode: "PROPORTIONAL",
                resources: [],
              },
            ],
          },
          conversionUnits: [{ code: "un", dimension: "COUNT", toBaseFactor: "1" }],
          appliedAt: "2026-09-12T12:00:00.000Z",
          appliedBy: "Admin",
          applicationSource: "AUTO_PRODUCT_DEFAULT",
          productDefaultProfile: PADRAO_ARQUIVADO,
          canChoose: true,
        })}
        quantityDraft="3000"
        onApplied={vi.fn()}
        canOperate
      />,
    );

    expect(await screen.findByText("Roteiro de produção aplicado")).toBeInTheDocument();
    expect(screen.getByText(/PPR-000001 · V1/)).toBeInTheDocument();
    expect(screen.getByText("1. Mistura", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/roteiro arquivado/)).toBeNull();
  });
});
