import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  CostTemplateDTO,
  CostTemplateVersionDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";

/**
 * UX-ACTIONS-FEEDBACK-WAVE-02 — os dois Modelos com a barra da Política de
 * Precificação.
 *
 * Estrutura de Custos e Formulação tinham as mesmas três ações do rascunho
 * que a Precificação tinha antes da onda 01: coladas, "+ Adicionar" com o
 * mesmo peso de "Salvar rascunho", e nenhum sinal de que gravar gravou. O
 * que está protegido aqui é a LEITURA da barra — grupos, pesos e a frase de
 * estado —, não a regra do rascunho, que as suítes de sempre continuam
 * cobrindo.
 */

const getCostTemplate = vi.fn();
const updateCostTemplate = vi.fn();
const updateCostTemplateVersion = vi.fn();
const activateCostTemplateVersion = vi.fn();
const setCostTemplateArchived = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getCostTemplate: (...a: unknown[]) => getCostTemplate(...a),
  updateCostTemplate: (...a: unknown[]) => updateCostTemplate(...a),
  updateCostTemplateVersion: (...a: unknown[]) => updateCostTemplateVersion(...a),
  activateCostTemplateVersion: (...a: unknown[]) => activateCostTemplateVersion(...a),
  setCostTemplateArchived: (...a: unknown[]) => setCostTemplateArchived(...a),
  createCostTemplateVersionFrom: vi.fn(),
  compareCostTemplateVersions: vi.fn(),
}));

const getFormulationTemplate = vi.fn();
const updateFormulationTemplateVersion = vi.fn();
const activateFormulationTemplateVersion = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  updateFormulationTemplateVersion: (...a: unknown[]) => updateFormulationTemplateVersion(...a),
  activateFormulationTemplateVersion: (...a: unknown[]) =>
    activateFormulationTemplateVersion(...a),
  updateFormulationTemplate: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () =>
    Promise.resolve({
      resources: [
        {
          id: "res-enc",
          code: "REC-001",
          name: "Encapsuladora",
          type: "EQUIPMENT",
          defaultUsageUom: "HOUR",
          active: true,
        },
      ],
    }),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { CostTemplateDetailPage } from "./CostTemplateDetailPage";
import { FormulationTemplateDetailPage } from "../formulation-templates/FormulationTemplateDetailPage";

function rascunhoDeEstrutura(overrides: Partial<CostTemplateVersionDTO> = {}): CostTemplateVersionDTO {
  return {
    id: "tecv-3",
    industrialCostTemplateId: "tec-1",
    templateCode: "TEC-000004",
    templateName: "Cápsulas — Linha padrão",
    versionNumber: 3,
    versionLabel: "TEC-000004 V3",
    status: "DRAFT",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    energyCalculationMode: "NONE",
    energyResourceId: null,
    energyResourceName: null,
    notes: null,
    resourceUsages: [
      {
        id: "u1",
        industrialResourceId: "res-enc",
        resourceCode: "REC-001",
        resourceName: "Encapsuladora",
        resourceType: "EQUIPMENT",
        usageBasis: "FIXED_PER_REFERENCE_BATCH",
        usageQuantity: "4",
        usageUom: "HOUR",
        resourceCount: 1,
        totalUsageQuantity: "4",
        notes: null,
        sortOrder: 0,
      },
    ],
    additionalCosts: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    ...overrides,
  };
}

function estrutura(overrides: Partial<CostTemplateDTO> = {}): CostTemplateDTO {
  const draft = rascunhoDeEstrutura();
  return {
    id: "tec-1",
    code: "TEC-000004",
    name: "Cápsulas — Linha padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: draft,
    versions: [draft],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

async function abrirEstrutura() {
  const { container } = render(
    <MemoryRouter initialEntries={["/gestao/templates-estrutura/tec-1"]}>
      <Routes>
        <Route path="/gestao/templates-estrutura/:templateId" element={<CostTemplateDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByLabelText("Base de produção")).toHaveValue("1000"));
  return container;
}

function rascunhoDeFormulacao(
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  return {
    id: "ftv-4",
    formulationTemplateId: "ft-1",
    templateCode: "FT-000008",
    templateName: "Biotina — Cápsulas Base",
    versionNumber: 4,
    versionLabel: "V4",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputUnitCode: "un",
    notes: null,
    components: [],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    ...overrides,
  };
}

function modeloDeFormulacao(overrides: Partial<FormulationTemplateDTO> = {}): FormulationTemplateDTO {
  const draft = rascunhoDeFormulacao();
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: draft,
    versions: [draft],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

async function abrirFormulacao() {
  const container = render(
    <MemoryRouter initialEntries={["/producao/templates-formulacao/ft-1"]}>
      <Routes>
        <Route
          path="/producao/templates-formulacao/:templateId"
          element={<FormulationTemplateDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  ).container;
  await waitFor(() => expect(screen.getByText(/Rascunho — V4/)).toBeInTheDocument());
  return container;
}

const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });
const base = () => screen.getByLabelText("Base de produção");

/** A leitura seguinte já traz a base gravada — é o que o servidor devolve depois de salvar. */
function comBaseGravada(valor: string) {
  getCostTemplate.mockResolvedValue(
    estrutura({ draftVersion: rascunhoDeEstrutura({ referenceOutputQuantity: valor }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCostTemplate.mockResolvedValue(estrutura());
  updateCostTemplate.mockResolvedValue(undefined);
  updateCostTemplateVersion.mockResolvedValue(undefined);
  activateCostTemplateVersion.mockResolvedValue(undefined);
  getFormulationTemplate.mockResolvedValue(modeloDeFormulacao());
  updateFormulationTemplateVersion.mockResolvedValue(undefined);
  activateFormulationTemplateVersion.mockResolvedValue(undefined);
});

describe("Modelos — a barra do rascunho é a da Precificação", () => {
  it("Estrutura de Custos: adicionar de um lado; gravar e ativar do outro, com três pesos", async () => {
    const container = await abrirEstrutura();

    const barra = botao("Salvar rascunho").closest(".form-actions") as HTMLElement;
    expect(barra).toHaveClass("form-actions--split");
    const grupos = barra.querySelectorAll(".form-actions__group");
    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toContainElement(botao("+ Adicionar recurso"));
    expect(grupos[1]).toContainElement(botao("Salvar rascunho"));
    expect(grupos[1]).toContainElement(botao("Ativar versão"));

    // Terciária, secundária e commit — nunca três botões equivalentes.
    expect(botao("+ Adicionar recurso")).toHaveClass("btn--ghost");
    expect(botao("Salvar rascunho")).toHaveClass("btn--secondary");
    expect(botao("Ativar versão")).toHaveClass("btn--accent");

    // A tela não guarda nenhuma barra antiga, sem gap.
    expect(container.querySelectorAll(".line-actions")).toHaveLength(0);
  });

  it("Modelo de Formulação: a mesma hierarquia, e ativar confirma com frase própria", async () => {
    const user = userEvent.setup();
    // Rascunho com componente, para a ativação ficar disponível.
    const comComponente = rascunhoDeFormulacao({
      components: [
        {
          id: "c1",
          itemId: "i1",
          itemCode: "MP-000001",
          itemName: "Biotina",
          itemType: "RAW_MATERIAL",
          itemActive: true,
          quantity: "0.5",
          unitCode: "g",
          basis: "FIXED_BASIS",
          supplyResponsibility: "VERIDI",
          purityPercentApplied: null,
          overagePercent: null,
          quantityMode: "PHYSICAL_DIRECT",
          applyPurityAdjustment: false,
          applyOverageAdjustment: false,
          notes: null,
          position: 0,
        },
      ],
    });
    getFormulationTemplate.mockResolvedValue(
      modeloDeFormulacao({ draftVersion: comComponente, versions: [comComponente] }),
    );
    const container = await abrirFormulacao();

    const barra = botao("Salvar rascunho").closest(".form-actions") as HTMLElement;
    expect(barra).toHaveClass("form-actions--split");
    const grupos = barra.querySelectorAll(".form-actions__group");
    expect(grupos[0]).toContainElement(botao("+ Adicionar componente"));
    expect(grupos[1]).toContainElement(botao("Ativar versão"));
    expect(botao("+ Adicionar componente")).toHaveClass("btn--ghost");
    expect(botao("Salvar rascunho")).toHaveClass("btn--secondary");
    expect(botao("Ativar versão")).toHaveClass("btn--accent");
    expect(container.querySelectorAll(".line-actions")).toHaveLength(0);
    // Sem pendência, gravar não tem o que fazer — ativar tem.
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(botao("Ativar versão")).toBeEnabled();

    const ativa = { ...comComponente, status: "ACTIVE" as const };
    getFormulationTemplate.mockResolvedValue(
      modeloDeFormulacao({ activeVersion: ativa, draftVersion: null, versions: [ativa] }),
    );
    await user.click(botao("Ativar versão"));

    expect(activateFormulationTemplateVersion).toHaveBeenCalledWith("ftv-4");
    expect(await screen.findByText("Versão ativada.")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });

  it("identificação e arquivar em grupos separados; arquivar continua discreto", async () => {
    await abrirEstrutura();

    const barra = botao("Salvar identificação").closest(".form-actions") as HTMLElement;
    expect(barra).toHaveClass("form-actions--split");
    const grupoSalvar = botao("Salvar identificação").closest(".form-actions__group");
    const grupoArquivar = botao("Arquivar").closest(".form-actions__group");
    expect(grupoSalvar).not.toBe(grupoArquivar);
    expect(botao("Arquivar")).toHaveClass("btn--ghost");
  });
});

describe("Modelo de Estrutura — gravar responde, e só depois da API", () => {
  it("sem alteração pendente não há o que gravar; ativar não depende disso", async () => {
    await abrirEstrutura();

    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(botao("Ativar versão")).toBeEnabled();
  });

  it("Salvando… no botão clicado, clique duplo recusado, e Rascunho salvo. só com a resposta", async () => {
    const user = userEvent.setup();
    let liberar: () => void = () => {};
    updateCostTemplateVersion.mockImplementation(
      () => new Promise<void>((resolve) => (liberar = () => resolve())),
    );
    await abrirEstrutura();

    fireEvent.change(base(), { target: { value: "2000" } });
    await user.click(botao("Salvar rascunho"));

    const emCurso = await screen.findByRole("button", { name: "Salvando…" });
    expect(emCurso).toBeDisabled();
    // Os vizinhos também não aceitam clique enquanto a gravação está no ar,
    // e nenhum deles rouba o rótulo.
    expect(botao("Ativar versão")).toBeDisabled();
    expect(botao("Salvar identificação")).toBeDisabled();
    fireEvent.click(emCurso);
    expect(updateCostTemplateVersion).toHaveBeenCalledTimes(1);
    // Com a requisição no ar, nada diz "salvo".
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    comBaseGravada("2000");
    liberar();

    expect(await screen.findByText("Rascunho salvo.")).toHaveAttribute("role", "status");
    expect(screen.getAllByText("Rascunho salvo.")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sem pendência na tela para encobrir: no ar, nada diz salva; recusada, nunca vira salva", async () => {
    // "Salvar identificação" aceita gravar o que já está lá. Sem "Alterações
    // não salvas" ocupando o lugar, uma confirmação adiantada apareceria.
    const user = userEvent.setup();
    let recusar: (motivo: Error) => void = () => {};
    updateCostTemplate.mockImplementation(
      () => new Promise<void>((_resolve, reject) => (recusar = reject)),
    );
    await abrirEstrutura();

    await user.click(botao("Salvar identificação"));
    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.queryByText("Identificação salva.")).toBeNull();

    recusar(new Error("Nome já usado por outro modelo"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nome já usado por outro modelo");
    expect(screen.queryByText("Identificação salva.")).toBeNull();
    expect(botao("Salvar identificação")).toBeEnabled();
  });

  it("erro fica em role=alert, a pendência continua, e nunca vira sucesso", async () => {
    const user = userEvent.setup();
    updateCostTemplateVersion.mockRejectedValue(new Error("Base de produção inválida"));
    await abrirEstrutura();

    fireEvent.change(base(), { target: { value: "2000" } });
    await user.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de produção inválida");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(screen.getByText("Alterações não salvas")).toHaveAttribute("role", "status");
    expect(botao("Salvar rascunho")).toBeEnabled();
  });

  it("gravar de novo substitui a frase: pendência, depois uma confirmação só", async () => {
    const user = userEvent.setup();
    await abrirEstrutura();

    fireEvent.change(base(), { target: { value: "2000" } });
    comBaseGravada("2000");
    await user.click(botao("Salvar rascunho"));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();

    // Mexeu de novo: a confirmação anterior não pode continuar dizendo "salvo".
    fireEvent.change(base(), { target: { value: "3000" } });
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    comBaseGravada("3000");
    await user.click(botao("Salvar rascunho"));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    expect(screen.getAllByText("Rascunho salvo.")).toHaveLength(1);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
  });

  it("save parcial: gravar o rascunho limpa a pendência dele e deixa a identificação em paz", async () => {
    const user = userEvent.setup();
    await abrirEstrutura();

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Cápsulas — Linha nova" } });
    fireEvent.change(base(), { target: { value: "2000" } });
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(2);

    comBaseGravada("2000");
    await user.click(botao("Salvar rascunho"));

    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    // O nome digitado continua no campo, e continua pendente — no bloco dele.
    expect(screen.getByLabelText("Nome")).toHaveValue("Cápsulas — Linha nova");
    const pendencia = screen.getByText("Alterações não salvas");
    expect(pendencia.closest(".form-actions__group")).toContainElement(
      botao("Salvar identificação"),
    );
    expect(botao("Salvar rascunho")).toBeDisabled();
  });

  it("ativar confirma com Versão ativada., na versão ativa — nunca como Rascunho salvo.", async () => {
    const user = userEvent.setup();
    await abrirEstrutura();

    const ativa = rascunhoDeEstrutura({ status: "ACTIVE" });
    getCostTemplate.mockResolvedValue(
      estrutura({ activeVersion: ativa, draftVersion: null, versions: [ativa] }),
    );
    await user.click(botao("Ativar versão"));

    expect(activateCostTemplateVersion).toHaveBeenCalledWith("tecv-3");
    const frase = await screen.findByText("Versão ativada.");
    // A frase mora ao lado de "Criar nova versão": o bloco do rascunho sumiu.
    expect(within(frase.closest(".form-actions") as HTMLElement).getByRole("button")).toHaveTextContent(
      "Criar nova versão",
    );
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });
});
