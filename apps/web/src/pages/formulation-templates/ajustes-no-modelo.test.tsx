import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";

/**
 * FORMULATION-ADJUSTMENTS-UX-01 — o Modelo configura os ajustes como a
 * Formulação.
 *
 * O Modelo guardava pureza e overage mas não dizia o que a quantidade
 * significa, e a tela nem mostrava os campos: salvar pela tela devolvia ao
 * padrão tudo o que a linha não carregava. Agora a linha tem o mesmo painel da
 * Formulação — modo, pureza, overage e marcas, com rascunho, "Aplicar ajustes"
 * e "Cancelar" — e salvar leva a configuração inteira, sem perder base nem
 * notas.
 */

const getFormulationTemplate = vi.fn();
const updateFormulationTemplateVersion = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  listFormulationTemplates: vi.fn(),
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  createFormulationTemplate: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  updateFormulationTemplateVersion: (...a: unknown[]) => updateFormulationTemplateVersion(...a),
  updateFormulationTemplate: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () =>
    Promise.resolve({
      items: [
        {
          id: "i1",
          code: "MP-000001",
          name: "Biotina",
          unitCode: "kg",
          unit: { code: "kg", dimension: "MASS" },
          active: true,
        },
      ],
    }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => vi.fn(), useParams: () => ({ templateId: "ft-1" }) };
});

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";

function componente(
  overrides: Partial<FormulationTemplateComponentDTO> = {},
): FormulationTemplateComponentDTO {
  return {
    id: "c1",
    itemId: "i1",
    itemCode: "MP-000001",
    itemName: "Biotina",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "0.5",
    unitCode: "g",
    basis: "PER_FINISHED_UNIT",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    notes: "observação técnica",
    position: 0,
    ...overrides,
  };
}

function versao(overrides: Partial<FormulationTemplateVersionDTO> = {}): FormulationTemplateVersionDTO {
  return {
    id: "ftv-3",
    formulationTemplateId: "ft-1",
    templateCode: "FT-000008",
    templateName: "Biotina — Cápsulas Base",
    versionNumber: 3,
    versionLabel: "V3",
    status: "ACTIVE",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: "2026-08-20T00:00:00.000Z",
    activatedBy: "Admin",
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    ...overrides,
  };
}

function template(overrides: Partial<FormulationTemplateDTO> = {}): FormulationTemplateDTO {
  const ativa = versao();
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: ativa,
    draftVersion: null,
    versions: [ativa],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function comRascunho(componenteDoRascunho = componente()) {
  const rascunho = versao({
    id: "ftv-4",
    versionNumber: 4,
    versionLabel: "V4",
    status: "DRAFT",
    components: [componenteDoRascunho],
  });
  getFormulationTemplate.mockResolvedValue(template({ draftVersion: rascunho, versions: [versao(), rascunho] }));
  updateFormulationTemplateVersion.mockResolvedValue(rascunho);
  return rascunho;
}

async function abrir() {
  render(
    <MemoryRouter>
      <FormulationTemplateDetailPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("FT-000008")).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Ajustes da quantidade no Modelo", () => {
  it("a linha do Modelo abre os mesmos controles da Formulação", async () => {
    const user = userEvent.setup();
    comRascunho();
    await abrir();

    await user.click(await screen.findByRole("button", { name: /Física informada/ }));

    expect(screen.getByRole("radio", { name: "Quantidade física informada" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Calcular quantidade física" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Pureza aplicada" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Overage do componente" })).toBeInTheDocument();
    // Física informada: pureza e overage são registro — sem caixa de aplicar.
    expect(screen.queryByRole("checkbox", { name: "Corrigir pela pureza" })).not.toBeInTheDocument();
    expect(screen.getByText(/registro de auditoria/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Calcular quantidade física" }));
    expect(screen.getByRole("checkbox", { name: "Corrigir pela pureza" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Aplicar overage" })).toBeInTheDocument();
  });

  it("Aplicar resume na linha, e salvar leva modo, marcas e percentuais sem perder base nem notas", async () => {
    const user = userEvent.setup();
    comRascunho();
    await abrir();

    await user.click(await screen.findByRole("button", { name: /Física informada/ }));
    await user.click(screen.getByRole("radio", { name: "Calcular quantidade física" }));
    await user.click(screen.getByRole("checkbox", { name: "Corrigir pela pureza" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "98,5" },
    });
    await user.click(screen.getByRole("button", { name: "Aplicar ajustes" }));

    expect(screen.getByRole("button", { name: /Calculada · Pureza 98,5%/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalled());
    expect(updateFormulationTemplateVersion).toHaveBeenCalledWith(
      "ftv-4",
      expect.objectContaining({
        components: [
          expect.objectContaining({
            itemId: "i1",
            basis: "PER_FINISHED_UNIT",
            notes: "observação técnica",
            quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
            applyPurityAdjustment: true,
            applyOverageAdjustment: false,
            // Vírgula decimal vira ponto; vazio vira null — nunca 0.
            purityPercentApplied: "98.5",
            overagePercent: null,
          }),
        ],
      }),
    );
  });

  it("Cancelar no Modelo descarta o rascunho do painel", async () => {
    const user = userEvent.setup();
    comRascunho();
    await abrir();

    await user.click(await screen.findByRole("button", { name: /Física informada/ }));
    await user.click(screen.getByRole("radio", { name: "Calcular quantidade física" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByRole("button", { name: /^▸ Física informada|Física informada/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Calcular quantidade física" })).not.toBeInTheDocument();
  });

  it("salvar o Modelo com ajuste por aplicar é recusado", async () => {
    const user = userEvent.setup();
    comRascunho();
    await abrir();

    await user.click(await screen.findByRole("button", { name: /Física informada/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "98" },
    });
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(
      screen.getByText("Aplique ou cancele os ajustes de MP-000001 antes de salvar."),
    ).toBeInTheDocument();
    expect(updateFormulationTemplateVersion).not.toHaveBeenCalled();
  });

  it("a composição da versão ativa mostra o resumo dos ajustes", async () => {
    getFormulationTemplate.mockResolvedValue(
      template({
        activeVersion: versao({
          components: [
            componente({
              quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
              purityPercentApplied: "98",
              overagePercent: "2",
              applyPurityAdjustment: true,
              applyOverageAdjustment: true,
            }),
          ],
        }),
      }),
    );
    await abrir();

    expect(await screen.findByText("Calculada · Pureza 98% · Overage 2%")).toBeInTheDocument();
  });
});
