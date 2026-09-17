import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";

/**
 * EDITING-INTEGRITY-WAVE-01 — linha começada e não terminada no Modelo de Formulação.
 *
 * O payload do "Salvar rascunho" filtrava item sem quantidade e quantidade sem
 * item: a linha ficava na tela, a pendência continuava acesa e nada dizia por
 * que ela não foi gravada. Agora a linha incompleta prende o salvar e diz, nela
 * mesma, o que falta. Nenhum valor é inventado; a linha em branco continua não
 * sendo trabalho e não vai ao servidor.
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
vi.mock("../../app/AuthProvider", () => ({ useOptionalAuth: () => null,
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

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
    stockUnitCode: "kg",
    itemSourceName: null,
    itemDeclaredNutrient: null,
    itemFamily: null,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: null,
    itemExternalCode: null,
    quantity: "0.5",
    unitCode: "g",
    basis: "PER_FINISHED_UNIT",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    notes: null,
    position: 0,
    ...overrides,
  };
}

function versao(
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
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    capsulesPerPackage: null,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    componentIssues: [],
    ...overrides,
  };
}

function template(overrides: Partial<FormulationTemplateDTO> = {}): FormulationTemplateDTO {
  const rascunho = versao();
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: [rascunho],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

async function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route path="/producao/modelos-formulacao/:templateId" element={<FormulationTemplateDetailPage />} />,
    ),
    { initialEntries: ["/producao/modelos-formulacao/ft-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText(/^Rascunho —/)).toBeInTheDocument());
}

const base = () => screen.getByLabelText(/Base da formulação/, { selector: "input" });
/** As quantidades das linhas, na ordem da tabela. */
const quantidades = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('table input[aria-label^="Quantidade de"]'),
  );
/** Os campos de item das linhas — unidade e fornecimento também são combobox. */
const itens = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('table input[id^="componente-"]'));
const salvar = () => screen.getByRole("button", { name: "Salvar rascunho" });
const FALTA_QUANTIDADE = "Informe a quantidade deste componente ou remova a linha.";
const FALTA_ITEM = "Escolha o item deste componente ou remova a linha.";

beforeEach(() => {
  vi.clearAllMocks();
  getFormulationTemplate.mockResolvedValue(template());
  updateFormulationTemplateVersion.mockResolvedValue(undefined);
});

describe("Modelo de Formulação — linha incompleta não some ao salvar", () => {
  it("item sem quantidade: salvar para, a linha fica, o campo diz o que falta e recebe o foco", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidades()[0]!, { target: { value: "" } });
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    await user.click(salvar());

    expect(updateFormulationTemplateVersion).not.toHaveBeenCalled();
    const mensagem = screen.getByText(FALTA_QUANTIDADE);
    const campo = quantidades()[0]!;
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAttribute("aria-describedby", mensagem.id);
    await waitFor(() => expect(campo).toHaveFocus());
    // A linha continua na tela, com o item, e a pendência continua acesa.
    expect(itens()).toHaveLength(1);
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    // Corrigir a linha apaga o aviso e deixa salvar — com a linha no payload.
    fireEvent.change(quantidades()[0]!, { target: { value: "0,8" } });
    expect(screen.queryByText(FALTA_QUANTIDADE)).toBeNull();
    getFormulationTemplate.mockResolvedValue(
      template({ draftVersion: versao({ components: [componente({ quantity: "0.8" })] }) }),
    );
    await user.click(salvar());

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    const corpo = updateFormulationTemplateVersion.mock.calls[0]![1] as {
      components: { itemId: string; quantity: string }[];
    };
    expect(corpo.components).toHaveLength(1);
    expect(corpo.components[0]).toMatchObject({ itemId: "i1", quantity: "0.8" });
  });

  it("quantidade sem item: salvar para e o item é o que falta, sem escolher nada pela pessoa", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "+ Adicionar matéria-prima" }));
    fireEvent.change(quantidades()[1]!, { target: { value: "2" } });
    await user.click(salvar());

    expect(updateFormulationTemplateVersion).not.toHaveBeenCalled();
    const mensagem = screen.getByText(FALTA_ITEM);
    const campoDoItem = itens()[1]!;
    expect(campoDoItem).toHaveAttribute("aria-invalid", "true");
    expect(campoDoItem).toHaveAttribute("aria-describedby", mensagem.id);
    await waitFor(() => expect(campoDoItem).toHaveFocus());
    expect(campoDoItem).toHaveValue("");
    expect(quantidades()[1]).toHaveValue("2");
    // A linha completa não ganhou aviso.
    expect(screen.queryByText(FALTA_QUANTIDADE)).toBeNull();
    expect(screen.getAllByText(FALTA_ITEM)).toHaveLength(1);

    // Remover a linha também resolve: sem aviso, e nada a salvar.
    /* A linha sem Item chama-se "componente" no rótulo de remover; a que já
       tem Item é nomeada pelo código dele. */
    await user.click(screen.getByRole("button", { name: "Remover componente" }));
    expect(screen.queryByText(FALTA_ITEM)).toBeNull();
    expect(salvar()).toBeDisabled();
  });

  it("linha em branco não prende o salvar e não vai ao servidor", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "+ Adicionar matéria-prima" }));
    fireEvent.change(base(), { target: { value: "1000" } });
    getFormulationTemplate.mockResolvedValue(template({ draftVersion: versao({ basisQuantity: "1000" }) }));
    await user.click(salvar());

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    const corpo = updateFormulationTemplateVersion.mock.calls[0]![1] as { components: unknown[] };
    expect(corpo.components).toHaveLength(1);
    expect(screen.queryByText(FALTA_ITEM)).toBeNull();
    expect(screen.queryByText(FALTA_QUANTIDADE)).toBeNull();
  });
});
