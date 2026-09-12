import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  IndustrialResourceDTO,
  ProductionProfileDTO,
  ProductionProfileStepDTO,
  ProductionProfileStepResourceDTO,
  ProductionProfileSummaryDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";

/**
 * Perfis de Produção na tela — PLANNING-PRODUCTION-PROFILE-01 (§89).
 *
 * O que a tela precisa garantir: o rascunho se monta em cartões (nome, modo
 * de escala, preparação, execução, recursos), a ordem das etapas é a da
 * lista, a simulação usa o motor canônico sem gravar nada, a versão ativa só
 * se lê, e energia nem aparece como recurso de etapa.
 */

const listProductionProfiles = vi.fn();
const getProductionProfile = vi.fn();
const createProductionProfile = vi.fn();
const updateProductionProfile = vi.fn();
const updateProductionProfileVersion = vi.fn();
const activateProductionProfileVersion = vi.fn();
const createProductionProfileVersionFrom = vi.fn();
const setProductProductionProfile = vi.fn();

vi.mock("../../lib/production-profiles-api", () => ({
  listProductionProfiles: (...a: unknown[]) => listProductionProfiles(...a),
  getProductionProfile: (...a: unknown[]) => getProductionProfile(...a),
  createProductionProfile: (...a: unknown[]) => createProductionProfile(...a),
  updateProductionProfile: (...a: unknown[]) => updateProductionProfile(...a),
  updateProductionProfileVersion: (...a: unknown[]) => updateProductionProfileVersion(...a),
  activateProductionProfileVersion: (...a: unknown[]) => activateProductionProfileVersion(...a),
  createProductionProfileVersionFrom: (...a: unknown[]) => createProductionProfileVersionFrom(...a),
  setProductProductionProfile: (...a: unknown[]) => setProductProductionProfile(...a),
}));

const listIndustrialResources = vi.fn();
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: (...a: unknown[]) => listIndustrialResources(...a),
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

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => navigate, useParams: () => ({ profileId: "ppr-1" }) };
});

import { ProductionProfilesPage } from "./ProductionProfilesPage";
import { ProductionProfileDetailPage } from "./ProductionProfileDetailPage";

function recursoDoCatalogo(
  id: string,
  name: string,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
): IndustrialResourceDTO {
  return {
    id,
    code: `RIN-${id}`,
    name,
    type,
    description: null,
    defaultUsageUom: type === "ENERGY" ? "KWH" : "HOUR",
    powerKw: null,
    capacityQuantity: null,
    notes: null,
    active: true,
    currentRate: null,
    rateCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedByName: null,
  };
}

function operadores(quantidade: number): ProductionProfileStepResourceDTO {
  return {
    id: "sr-1",
    industrialResourceId: "op",
    resourceCode: "RIN-op",
    resourceName: "Mão de obra — Produção",
    resourceType: "LABOR",
    resourceActive: true,
    resourceQuantity: quantidade,
    notes: null,
    sortOrder: 0,
  };
}

function passo(sobre: Partial<ProductionProfileStepDTO> = {}): ProductionProfileStepDTO {
  return {
    id: "st-1",
    sequence: 1,
    name: "Mistura",
    description: null,
    setupDurationMinutes: 0,
    runDurationMinutes: 120,
    scalingMode: "PROPORTIONAL",
    resources: [],
    ...sobre,
  };
}

function versao(sobre: Partial<ProductionProfileVersionDTO> = {}): ProductionProfileVersionDTO {
  return {
    id: "ppv-1",
    productionProfileId: "ppr-1",
    profileCode: "PPR-000001",
    profileName: "Cápsulas — linha padrão",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    referenceQuantity: "1000",
    referenceUomCode: "un",
    notes: null,
    steps: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    ...sobre,
  };
}

function perfil(sobre: Partial<ProductionProfileDTO> = {}): ProductionProfileDTO {
  const rascunho = sobre.draftVersion === undefined ? versao() : sobre.draftVersion;
  return {
    id: "ppr-1",
    code: "PPR-000001",
    name: "Cápsulas — linha padrão",
    description: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: rascunho ? [rascunho] : [],
    defaultProducts: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-11T12:00:00.000Z",
    ...sobre,
  };
}

async function abrirDetalhe(dto: ProductionProfileDTO) {
  getProductionProfile.mockResolvedValue(dto);
  const utils = render(
    <MemoryRouter>
      <ProductionProfileDetailPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: /PPR-000001/ });
  return utils;
}

const escritas = () => [
  createProductionProfile,
  updateProductionProfile,
  updateProductionProfileVersion,
  activateProductionProfileVersion,
  createProductionProfileVersionFrom,
  setProductProductionProfile,
];

beforeEach(() => {
  vi.clearAllMocks();
  listIndustrialResources.mockResolvedValue({
    resources: [
      recursoDoCatalogo("op", "Mão de obra — Produção", "LABOR"),
      recursoDoCatalogo("enc", "Encapsuladora", "EQUIPMENT"),
      recursoDoCatalogo("en", "Energia elétrica", "ENERGY"),
    ],
    page: 1,
    pageSize: 100,
    total: 3,
  });
  updateProductionProfileVersion.mockResolvedValue(versao());
  createProductionProfileVersionFrom.mockResolvedValue(versao({ id: "ppv-2", versionNumber: 2 }));
  setProductProductionProfile.mockResolvedValue({});
});

describe("Roteiros de Produção — lista", () => {
  it("cria um Roteiro e abre o detalhe dele", async () => {
    listProductionProfiles.mockResolvedValue({ profiles: [], page: 1, pageSize: 20, total: 0 });
    createProductionProfile.mockResolvedValue(perfil({ id: "ppr-9" }));
    render(
      <MemoryRouter>
        <ProductionProfilesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Nenhum Roteiro de Produção ainda/);

    fireEvent.click(screen.getByRole("button", { name: "Novo roteiro" }));
    fireEvent.change(screen.getByLabelText("Nome do roteiro"), {
      target: { value: "Cápsulas — linha padrão" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/planejamento/perfis-producao/ppr-9"),
    );
    expect(createProductionProfile).toHaveBeenCalledWith({ name: "Cápsulas — linha padrão" });
  });

  it("mostra versão ativa, quantidade de referência e as etapas em ordem", async () => {
    const resumo: ProductionProfileSummaryDTO = {
      id: "ppr-1",
      code: "PPR-000001",
      name: "Cápsulas",
      description: null,
      activeVersionId: "ppv-1",
      activeVersionNumber: 1,
      referenceQuantity: "1000",
      referenceUomCode: "un",
      stepNames: ["Pesagem", "Mistura", "Encapsulamento"],
      hasDraft: true,
      defaultProductCount: 2,
      updatedAt: "2026-09-11T12:00:00.000Z",
    };
    listProductionProfiles.mockResolvedValue({ profiles: [resumo], page: 1, pageSize: 20, total: 1 });
    render(
      <MemoryRouter>
        <ProductionProfilesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Pesagem → Mistura → Encapsulamento")).toBeInTheDocument();
    // Quantidade sem separador de milhar — é o que a pessoa copia de volta num campo.
    expect(screen.getByText("1000 un")).toBeInTheDocument();
    expect(screen.getByText("Rascunho em edição")).toBeInTheDocument();
  });
});

describe("Roteiro de Produção — rascunho", () => {
  it("quantidade de referência e etapas: adiciona, preenche, reordena com ↑ ↓ e salva na ordem da lista", async () => {
    await abrirDetalhe(perfil());

    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar etapa" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar etapa" }));

    const nomes = screen.getAllByLabelText("Nome da etapa");
    fireEvent.change(nomes[0]!, { target: { value: "Pesagem" } });
    fireEvent.change(nomes[1]!, { target: { value: "Mistura" } });
    const execucoes = screen.getAllByLabelText("Execução da base (min)");
    fireEvent.change(execucoes[0]!, { target: { value: "30" } });
    fireEvent.change(execucoes[1]!, { target: { value: "120" } });

    fireEvent.click(screen.getByRole("button", { name: "Mover etapa 2 para cima" }));
    expect(
      (screen.getAllByLabelText("Nome da etapa") as HTMLInputElement[]).map((campo) => campo.value),
    ).toEqual(["Mistura", "Pesagem"]);

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateProductionProfileVersion).toHaveBeenCalledTimes(1));
    expect(updateProductionProfileVersion).toHaveBeenCalledWith("ppv-1", {
      referenceQuantity: "500",
      referenceUomCode: "un",
      steps: [
        {
          name: "Mistura",
          description: null,
          setupDurationMinutes: 0,
          runDurationMinutes: 120,
          scalingMode: "PROPORTIONAL",
          resources: [],
        },
        {
          name: "Pesagem",
          description: null,
          setupDurationMinutes: 0,
          runDurationMinutes: 30,
          scalingMode: "PROPORTIONAL",
          resources: [],
        },
      ],
    });
  });

  it("proporcional × por lote, com preparação que não escala, na simulação ao vivo", async () => {
    await abrirDetalhe(
      perfil({
        draftVersion: versao({
          steps: [passo({ name: "Encapsulamento", setupDurationMinutes: 30, runDurationMinutes: 120 })],
        }),
      }),
    );
    const simulacao = screen.getByRole("region", { name: "Simulação do roteiro" });
    fireEvent.change(within(simulacao).getByLabelText(/Quantidade para simular/), {
      target: { value: "1500" },
    });

    // Proporcional: 120 min × 1.500 ÷ 1.000 = 3 h; mais 30 min de preparação.
    expect(within(simulacao).getByText("3 h")).toBeInTheDocument();
    expect(within(simulacao).getAllByText("3 h 30 min").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Modo de escala"), { target: { value: "BY_BATCH" } });

    // Por lote: 1.500 em lotes de 1.000 = 2 lotes × 2 h = 4 h — nunca 3 h.
    expect(within(simulacao).getByText(/2 lotes/)).toBeInTheDocument();
    expect(within(simulacao).getByText("4 h")).toBeInTheDocument();
    expect(within(simulacao).getAllByText("4 h 30 min").length).toBeGreaterThan(0);
    expect(within(simulacao).getByText("30 min")).toBeInTheDocument();
  });

  it("recursos: o catálogo não oferece energia, e 2 operadores por 2 h são 4 horas-recurso", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar recurso" }));
    const recurso = screen.getByLabelText("Recurso") as HTMLSelectElement;
    await waitFor(() => expect(within(recurso).getAllByRole("option")).toHaveLength(3));
    expect(within(recurso).queryByRole("option", { name: /Energia/ })).toBeNull();

    fireEvent.change(recurso, { target: { value: "op" } });
    fireEvent.change(screen.getByLabelText("Quantidade necessária"), { target: { value: "2" } });

    const simulacao = screen.getByRole("region", { name: "Simulação do roteiro" });
    // A etapa continua durando 2 h: os dois trabalham juntos.
    expect(within(simulacao).getAllByText("2 h").length).toBeGreaterThan(0);
    expect(
      within(simulacao).getByText(/2 × Mão de obra — Produção: 4 h de recurso/),
    ).toBeInTheDocument();
  });

  it("quantidade necessária fracionária é recusada na tela, antes do servidor", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo({ resources: [operadores(2)] })] }) }));

    fireEvent.change(screen.getByLabelText("Quantidade necessária"), { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/quantidade necessária/);
    expect(updateProductionProfileVersion).not.toHaveBeenCalled();
  });

  it("ativar fica indisponível enquanto há alteração não salva", async () => {
    await abrirDetalhe(perfil({ draftVersion: versao({ steps: [passo()] }) }));
    expect(screen.getByRole("button", { name: "Ativar versão" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Nome da etapa"), { target: { value: "Mistura lenta" } });

    expect(screen.getByRole("button", { name: "Ativar versão" })).toBeDisabled();
    expect(screen.getByText(/Salve o rascunho antes de ativar a versão/)).toBeInTheDocument();
  });
});

describe("Roteiro de Produção — versão ativa", () => {
  const ativa = versao({
    status: "ACTIVE",
    activatedAt: "2026-09-11T12:10:00.000Z",
    activatedBy: "Admin",
    steps: [passo({ resources: [operadores(2)] })],
  });

  it("é somente leitura, e mudar o roteiro exige nova versão", async () => {
    await abrirDetalhe(perfil({ activeVersion: ativa, draftVersion: null, versions: [ativa] }));

    expect(screen.queryByLabelText("Nome da etapa")).toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull();
    expect(screen.getByText("2 × Mão de obra — Produção")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Criar nova versão" }));
    await waitFor(() => expect(createProductionProfileVersionFrom).toHaveBeenCalledWith("ppv-1"));
  });

  it("a simulação calcula e não grava nada", async () => {
    await abrirDetalhe(perfil({ activeVersion: ativa, draftVersion: null, versions: [ativa] }));
    const simulacao = screen.getByRole("region", { name: "Simulação do roteiro" });

    fireEvent.change(within(simulacao).getByLabelText(/Quantidade para simular/), {
      target: { value: "3000" },
    });

    expect(within(simulacao).getAllByText("6 h").length).toBeGreaterThan(0);
    expect(
      within(simulacao).getByText(/2 × Mão de obra — Produção: 12 h de recurso/),
    ).toBeInTheDocument();
    for (const escrita of escritas()) expect(escrita).not.toHaveBeenCalled();
  });

  it("o produto aparece na versão ativa que usa — sem ação de trocar versão à mão", async () => {
    const v1 = versao({ status: "ARCHIVED", steps: [passo()] });
    const v2 = versao({
      id: "ppv-2",
      versionNumber: 2,
      versionLabel: "V2",
      status: "ACTIVE",
      steps: [passo()],
    });
    await abrirDetalhe(
      perfil({
        activeVersion: v2,
        draftVersion: null,
        versions: [v1, v2],
        defaultProducts: [
          {
            productId: "prod-1",
            productCode: "PROD-000001",
            productName: "Vitamina C",
            versionId: "ppv-2",
            versionNumber: 2,
            versionStatus: "ACTIVE",
          },
        ],
      }),
    );

    // Ativar a V2 já levou junto quem usava a V1: não há o que clicar para trocar.
    const linha = screen.getByText("PROD-000001").closest("tr") as HTMLElement;
    expect(within(linha).getByText("V2 · Ativa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Usar V/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tirar padrão" }));
    await waitFor(() => expect(setProductProductionProfile).toHaveBeenCalledWith("prod-1", null));
  });
});

describe("Roteiro de Produção — 390px", () => {
  it("etapa é cartão com rótulo em cada valor, e o CSS empilha tudo em tela estreita", async () => {
    const css = readFileSync(join(process.cwd(), "src", "pages", "planning", "planning.css"), "utf8");
    const estreita = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(estreita.length).toBeLessThan(css.length);
    for (const bloco of [".profile-step__fields", ".profile-step__resource", ".profile-preview__values"]) {
      expect(estreita).toContain(bloco);
    }
    expect(estreita).toContain("grid-template-columns: 1fr");

    const { container } = await abrirDetalhe(
      perfil({
        draftVersion: versao({
          steps: [
            passo({ resources: [operadores(2)] }),
            passo({ id: "st-2", sequence: 2, name: "Embalagem" }),
          ],
        }),
      }),
    );

    // Nenhuma tabela larga no editor: cada etapa é um cartão.
    expect(container.querySelector(".profile-steps table")).toBeNull();
    expect(container.querySelectorAll(".profile-steps > li.profile-step")).toHaveLength(2);
    for (const rotulo of ["Nome da etapa", "Modo de escala", "Preparação (min)", "Execução da base (min)"]) {
      expect(screen.getAllByLabelText(rotulo)).toHaveLength(2);
    }
    expect(screen.getAllByLabelText("Quantidade necessária")).toHaveLength(1);
  });
});
