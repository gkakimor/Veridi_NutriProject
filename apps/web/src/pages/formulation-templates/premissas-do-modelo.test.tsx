import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 1) — a bancada do Modelo edita as
 * premissas técnicas, e só as da forma escolhida.
 *
 * O Modelo passou a guardar forma, apresentação, cápsulas por dose, dose e
 * conteúdo e perda prevista. O que esta suíte prova na tela:
 *
 *   - a forma decide quais campos existem — cápsula não pede dose em gramas;
 *   - doses por embalagem é RESULTADO, mostrado, nunca um segundo campo;
 *   - a gravação leva as premissas, e o campo vazio vai como `null`;
 *   - a recusa do servidor pousa NO CAMPO que não fechou;
 *   - versão legada, com tudo nulo, abre sem inventar forma nenhuma;
 *   - escolher a matéria-prima traz a pureza do cadastro como ponto de partida.
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
          type: "RAW_MATERIAL",
          unitCode: "kg",
          unit: { code: "kg", dimension: "MASS" },
          defaultPurityPercent: "98,5",
          active: true,
        },
        {
          id: "i2",
          code: "EM-000001",
          name: "Pote 300 g",
          type: "PACKAGING",
          unitCode: "un",
          unit: { code: "un", dimension: "COUNT" },
          defaultPurityPercent: null,
          active: true,
        },
      ],
    }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
      { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    ]),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";
import { ApiValidationError } from "../../lib/api-errors";

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
    itemDefaultPurityPercent: "98.5",
    itemExternalCode: null,
    quantity: "0.5",
    unitCode: "g",
    basis: "PER_DOSE",
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

function template(rascunho: FormulationTemplateVersionDTO): FormulationTemplateDTO {
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
  };
}

async function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        path="/producao/modelos-formulacao/:templateId"
        element={<FormulationTemplateDetailPage />}
      />,
    ),
    { initialEntries: ["/producao/modelos-formulacao/ft-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText(/^Rascunho —/)).toBeInTheDocument());
}

/** A ⓘ de ajuda repete o rótulo: o campo é o `input`/`select`, nunca o botão. */
const CAMPO = { selector: "input, select, textarea" } as const;
const forma = () => screen.getByLabelText(/Forma do produto/, CAMPO) as HTMLSelectElement;
const apresentacao = () =>
  screen.getByLabelText(/Apresentação comercial/, CAMPO) as HTMLSelectElement;
const salvar = () => screen.getByRole("button", { name: "Salvar rascunho" });

beforeEach(() => {
  vi.clearAllMocks();
  getFormulationTemplate.mockResolvedValue(template(versao()));
  updateFormulationTemplateVersion.mockResolvedValue(undefined);
});

describe("Modelo de Formulação — premissas técnicas na bancada", () => {
  it("1 · versão legada abre com a forma em branco e sem campo de forma nenhuma", async () => {
    await abrir();

    expect(forma().value).toBe("");
    expect(apresentacao().value).toBe("");
    expect(screen.queryByLabelText(/Cápsulas por dose/, CAMPO)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Dose/, CAMPO)).not.toBeInTheDocument();
    expect(screen.queryByTestId("modelo-doses-derivadas")).not.toBeInTheDocument();
    // Perda prevista existe sempre, e vazia é NÃO INFORMADA — nunca 0%.
    expect(
      (screen.getByLabelText(/Perda prevista de produção/, CAMPO) as HTMLInputElement).value,
    ).toBe("");
  });

  it("2 · cápsula mostra cápsulas por dose e por embalagem e DERIVA as doses", async () => {
    const usuario = userEvent.setup();
    await abrir();

    await usuario.selectOptions(forma(), "CAPSULE");
    expect(screen.queryByLabelText(/^Dose/, CAMPO)).not.toBeInTheDocument();

    await usuario.type(screen.getByLabelText(/Cápsulas por dose/, CAMPO), "2");
    await usuario.type(screen.getByLabelText(/Cápsulas por embalagem/, CAMPO), "120");

    // 120 ÷ 2 = 60 doses, calculado na tela pela mesma função da API.
    await waitFor(() =>
      expect(screen.getByTestId("modelo-doses-derivadas")).toHaveTextContent("60"),
    );
  });

  it("3 · pó mostra dose e conteúdo em massa e DERIVA as doses convertendo unidade", async () => {
    const usuario = userEvent.setup();
    await abrir();

    await usuario.selectOptions(forma(), "POWDER");
    expect(screen.queryByLabelText(/Cápsulas por dose/, CAMPO)).not.toBeInTheDocument();

    await usuario.type(screen.getByLabelText(/^Dose/, CAMPO), "5");
    await usuario.selectOptions(screen.getByLabelText("Unidade da dose"), "g");
    await usuario.type(screen.getByLabelText(/Conteúdo da embalagem/, CAMPO), "0,3");
    await usuario.selectOptions(screen.getByLabelText("Unidade do conteúdo da embalagem"), "kg");

    // 0,3 kg = 300 g; 300 ÷ 5 = 60 doses.
    await waitFor(() =>
      expect(screen.getByTestId("modelo-doses-derivadas")).toHaveTextContent("60"),
    );
  });

  it("4 · salvar leva as premissas; campo vazio vai como null", async () => {
    const usuario = userEvent.setup();
    await abrir();

    await usuario.selectOptions(forma(), "CAPSULE");
    await usuario.selectOptions(apresentacao(), "POT");
    await usuario.type(screen.getByLabelText(/Cápsulas por dose/, CAMPO), "2");
    await usuario.type(screen.getByLabelText(/Cápsulas por embalagem/, CAMPO), "60");
    await usuario.type(screen.getByLabelText(/Perda prevista de produção/, CAMPO), "4,5");

    await usuario.click(salvar());

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalled());
    const [, payload] = updateFormulationTemplateVersion.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload["dosageForm"]).toBe("CAPSULE");
    expect(payload["presentationType"]).toBe("POT");
    expect(payload["capsulesPerDose"]).toBe(2);
    expect(payload["capsulesPerPackage"]).toBe(60);
    expect(payload["expectedLossPercent"]).toBe("4.5");
    // O que a forma não usa vai NULO — e não omitido: omitir deixaria o valor
    // antigo gravado depois de a pessoa ter apagado o campo.
    expect(payload["doseAmount"]).toBeNull();
    expect(payload["doseUomCode"]).toBeNull();
    expect(payload["packageContentAmount"]).toBeNull();
  });

  it("5 · a recusa do servidor pousa no campo que não fechou", async () => {
    const usuario = userEvent.setup();
    updateFormulationTemplateVersion.mockRejectedValue(
      new ApiValidationError([
        {
          path: "capsulesPerPackage",
          message:
            "Cápsulas por embalagem precisa ser múltiplo de cápsulas por dose: cada dose leva um número inteiro de cápsulas.",
        },
      ]),
    );
    await abrir();

    await usuario.selectOptions(forma(), "CAPSULE");
    await usuario.type(screen.getByLabelText(/Cápsulas por dose/, CAMPO), "3");
    await usuario.type(screen.getByLabelText(/Cápsulas por embalagem/, CAMPO), "100");
    await usuario.click(salvar());

    const campo = await screen.findByLabelText(/Cápsulas por embalagem/, CAMPO);
    await waitFor(() => expect(campo).toHaveAttribute("aria-invalid", "true"));
    /*
     * A frase fica NO CAMPO, ligada por `aria-describedby` — a faixa do topo
     * também a repete, e procurar pelo texto solto encontraria as duas.
     */
    const erro = document.getElementById("template-capsulesPerPackage-error");
    expect(erro?.textContent).toMatch(/precisa ser múltiplo de cápsulas por dose/);
    expect(campo).toHaveAttribute("aria-describedby", "template-capsulesPerPackage-error");
  });

  it("6 · escolher a matéria-prima traz a pureza do cadastro como ponto de partida", async () => {
    const usuario = userEvent.setup();
    getFormulationTemplate.mockResolvedValue(
      template(versao({ components: [componente({ itemId: "", itemCode: "", itemName: "" })] })),
    );
    await abrir();

    const campoDoItem = document.querySelector<HTMLInputElement>('input[id^="componente-"]')!;
    await usuario.click(campoDoItem);
    await usuario.type(campoDoItem, "Biotina");
    await usuario.click(await screen.findByRole("option", { name: /MP-000001/ }));

    /* Pureza do cadastro entra como a APLICADA — snapshot, não vínculo. Na
       bancada ela é COLUNA: o número fica no campo da linha, editável. */
    const pureza = await screen.findByRole("textbox", { name: "Pureza de MP-000001" });
    expect(pureza).toHaveValue("98,5");
  });
});
