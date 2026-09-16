import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 2) — o Modelo edita a receita na
 * MESMA bancada da Formulação de produto.
 *
 * O que esta suíte prova é que a matriz deixou de ter uma tela pior: composição
 * e embalagem separadas pelo TIPO do Item, pureza e reserva como COLUNAS, a
 * prévia do cálculo pelo motor canônico, os totais da dose no rodapé da
 * composição, a ordenação dentro da seção e a barra fixa com as ações do
 * Modelo — e só as dele.
 *
 * O painel "O que a quantidade informada significa" não existe mais em tela
 * nenhuma: a coluna preenchida É a resposta.
 */

const getFormulationTemplate = vi.fn();
const updateFormulationTemplateVersion = vi.fn();
const activateFormulationTemplateVersion = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  listFormulationTemplates: vi.fn(),
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  createFormulationTemplate: vi.fn(),
  activateFormulationTemplateVersion: (...a: unknown[]) => activateFormulationTemplateVersion(...a),
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
          defaultPurityPercent: "98.5",
          active: true,
          sourceName: null,
          declaredNutrient: null,
          family: null,
          packagingSubtype: null,
          externalCode: null,
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
          sourceName: null,
          declaredNutrient: null,
          family: null,
          packagingSubtype: null,
          externalCode: null,
        },
      ],
    }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
      { code: "cx", label: "Caixa", dimension: "COUNT", toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
      { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    ]),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";

function materiaPrima(
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

function embalagem(
  overrides: Partial<FormulationTemplateComponentDTO> = {},
): FormulationTemplateComponentDTO {
  return materiaPrima({
    id: "c2",
    itemId: "i2",
    itemCode: "EM-000001",
    itemName: "Pote 300 g",
    itemType: "PACKAGING",
    stockUnitCode: "un",
    itemDefaultPurityPercent: null,
    quantity: "1",
    unitCode: "un",
    basis: "PER_FINISHED_UNIT",
    position: 1,
    ...overrides,
  });
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
    calculationMode: "PER_DOSE",
    dosesPerPackage: null,
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 1,
    capsulesPerPackage: 120,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    outputUnitCode: "un",
    notes: null,
    components: [materiaPrima(), embalagem()],
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

function template(rascunho: FormulationTemplateVersionDTO | null): FormulationTemplateDTO {
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: rascunho ? [rascunho] : [],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

async function abrir(dto: FormulationTemplateDTO = template(versao())) {
  getFormulationTemplate.mockResolvedValue(dto);
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
  // O catálogo de unidades chega depois: sem ele a linha não tem seletor.
  await screen.findByRole("textbox", { name: "Quantidade de MP-000001" });
}

/** A seção pelo título — composição e embalagem são tabelas diferentes. */
function secao(titulo: RegExp) {
  const cabecalho = screen.getByRole("heading", { name: titulo });
  const bloco = cabecalho.closest("section") ?? cabecalho.parentElement?.parentElement;
  if (!bloco) throw new Error(`seção ${titulo} sem bloco`);
  return bloco as HTMLElement;
}

const composicao = () => secao(/^Composição/);
const embalagemSecao = () => secao(/^Embalagem$/);
const salvar = () => screen.getByRole("button", { name: /^Salvar rascunho/ });
const ativar = () => screen.getByRole("button", { name: /^Ativar versão/ });

function corpoEnviado() {
  const [, input] = updateFormulationTemplateVersion.mock.calls[0] ?? [];
  return input as {
    components: Record<string, unknown>[];
    expectedLossPercent: string | null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateFormulationTemplateVersion.mockResolvedValue(undefined);
  activateFormulationTemplateVersion.mockResolvedValue(undefined);
});

describe("Bancada do Modelo — composição e embalagem", () => {
  it("as duas seções são separadas pelo TIPO do Item, não pelo nome", async () => {
    await abrir();

    /* A matéria-prima está na composição; o pote, na embalagem. Cada linha é
       encontrada pelo rótulo do próprio campo, que carrega o código do Item. */
    expect(
      within(composicao()).getByRole("textbox", { name: "Quantidade de MP-000001" }),
    ).toBeInTheDocument();
    expect(
      within(composicao()).queryByRole("textbox", { name: "Quantidade de EM-000001" }),
    ).toBeNull();
    expect(
      within(embalagemSecao()).getByRole("textbox", { name: "Quantidade de EM-000001" }),
    ).toBeInTheDocument();
    expect(
      within(embalagemSecao()).queryByRole("textbox", { name: "Quantidade de MP-000001" }),
    ).toBeNull();
  });

  it("a embalagem não tem pureza nem reserva de matéria-prima", async () => {
    await abrir();

    expect(within(embalagemSecao()).queryByRole("columnheader", { name: /Pureza/ })).toBeNull();
    expect(within(embalagemSecao()).queryByRole("columnheader", { name: /Reserva/ })).toBeNull();
    expect(within(composicao()).getByRole("columnheader", { name: /Pureza/ })).toBeInTheDocument();
    expect(within(composicao()).getByRole("columnheader", { name: /Reserva/ })).toBeInTheDocument();
  });

  it("cada seção acrescenta a SUA linha, e a base dela vem da seção", async () => {
    await abrir();

    expect(
      within(composicao()).getByRole("button", { name: "+ Adicionar matéria-prima" }),
    ).toBeInTheDocument();
    expect(
      within(embalagemSecao()).getByRole("button", { name: "+ Adicionar embalagem" }),
    ).toBeInTheDocument();
  });
});

describe("Bancada do Modelo — cápsula", () => {
  it("mostra Por cápsula, deriva as doses por embalagem e calcula a física", async () => {
    await abrir();

    expect(screen.getByTestId("modelo-doses-derivadas").textContent).toBe("120");
    expect(
      within(composicao()).getByRole("columnheader", { name: "Por cápsula" }),
    ).toBeInTheDocument();
    // 0,5 g por dose, 1 cápsula por dose: a cápsula leva a dose inteira.
    expect(within(composicao()).getAllByText("0,5 g").length).toBeGreaterThan(0);
  });

  it("o rodapé da composição fecha a soma da dose, sob cada coluna", async () => {
    await abrir();

    const rodape = composicao().querySelector("tfoot");
    expect(rodape).not.toBeNull();
    // `resumirDoses` soma em mg: 0,5 g = 500 mg, e a cápsula leva o mesmo.
    expect(within(rodape as HTMLElement).getAllByText("500 mg").length).toBe(3);
    expect(within(rodape as HTMLElement).getByText("Total por dose")).toBeInTheDocument();
  });
});

describe("Bancada do Modelo — pó", () => {
  const emPo = () =>
    template(
      versao({
        dosageForm: "POWDER",
        capsulesPerDose: null,
        capsulesPerPackage: null,
        doseAmount: "30",
        doseUomCode: "g",
        packageContentAmount: "900",
        packageContentUomCode: "g",
      }),
    );

  it("não mostra Por cápsula e deriva as doses de conteúdo ÷ dose", async () => {
    await abrir(emPo());

    expect(screen.getByTestId("modelo-doses-derivadas").textContent).toBe("30");
    expect(within(composicao()).queryByRole("columnheader", { name: "Por cápsula" })).toBeNull();
    // Dose e conteúdo do pó são campos; cápsulas por dose não existe.
    expect(screen.getByLabelText(/^Dose/, { selector: "input" })).toHaveValue("30");
    expect(
      screen.queryByLabelText(/Cápsulas por dose/, { selector: "input" }),
    ).toBeNull();
  });
});

describe("Bancada do Modelo — pureza e reserva são colunas", () => {
  it("a pureza digitada corrige a física por dose na hora", async () => {
    await abrir();

    const pureza = screen.getByRole("textbox", { name: "Pureza de MP-000001" });
    fireEvent.change(pureza, { target: { value: "50" } });

    // 0,5 g de alvo com 50% de pureza pedem 1 g físico.
    await waitFor(() =>
      expect(within(composicao()).getAllByText("1 g").length).toBeGreaterThan(0),
    );
  });

  it("a reserva NÃO entra na dose, e o termo Overage não aparece na tela", async () => {
    await abrir();

    const reserva = screen.getByRole("textbox", { name: "Reserva % de MP-000001" });
    fireEvent.change(reserva, { target: { value: "10" } });

    // A física por dose continua a mesma: reserva é do lote, não da dose.
    await waitFor(() => expect(reserva).toHaveValue("10"));
    expect(within(composicao()).getAllByText("0,5 g").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/overage/i);
  });

  it("salvar leva pureza, reserva e o modo que a coluna declarou", async () => {
    await abrir();

    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000001" }), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Reserva % de MP-000001" }), {
      target: { value: "10" },
    });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    expect(corpoEnviado().components[0]).toMatchObject({
      itemId: "i1",
      purityPercentApplied: "70",
      overagePercent: "10",
      // Pureza preenchida CORRIGE — é o contrato da bancada, sem painel.
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
      applyPurityAdjustment: true,
      applyOverageAdjustment: false,
    });
  });
});

describe("Bancada do Modelo — perda prevista e rendimento", () => {
  it("o rendimento é 100% menos a perda, e acompanha a digitação", async () => {
    await abrir();

    const perda = screen.getByRole("textbox", { name: /Perda prevista de produção/ });
    fireEvent.change(perda, { target: { value: "4" } });

    await waitFor(() =>
      expect(screen.getByTestId("rendimento-esperado").textContent).toBe("96%"),
    );
  });

  it("a perda vai no payload da versão", async () => {
    await abrir();

    fireEvent.change(screen.getByRole("textbox", { name: /Perda prevista de produção/ }), {
      target: { value: "4" },
    });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    expect(corpoEnviado().expectedLossPercent).toBe("4");
  });
});

describe("Bancada do Modelo — ordenação das linhas", () => {
  it("descer troca com a linha seguinte da MESMA seção, e a ordem vai ao servidor", async () => {
    await abrir(
      template(
        versao({
          components: [
            materiaPrima(),
            materiaPrima({ id: "c3", itemId: "i3", itemCode: "MP-000002", itemName: "Zinco", position: 1 }),
            embalagem({ position: 2 }),
          ],
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Descer MP-000001" }));

    fireEvent.click(salvar());
    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    // A ordem do array É a `position` que o servidor grava.
    expect(corpoEnviado().components.map((c) => c["itemId"])).toEqual(["i3", "i1", "i2"]);
  });

  it("a matéria-prima não atravessa para a embalagem", async () => {
    await abrir();

    // Linha única da composição: não sobe nem desce.
    expect(screen.getByRole("button", { name: "Subir MP-000001" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descer MP-000001" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Subir EM-000001" })).toBeDisabled();
  });
});

describe("Bancada do Modelo — fornecimento", () => {
  it("continua sendo Veridi ou Cliente, e a escolha vai ao servidor", async () => {
    await abrir();

    const seletores = screen.getAllByRole("combobox", { name: "Responsabilidade de fornecimento" });
    fireEvent.change(seletores[0]!, { target: { value: "CUSTOMER" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    expect(corpoEnviado().components[0]).toMatchObject({ supplyResponsibility: "CUSTOMER" });
  });

  it("na base fixa, Base e Fornecimento dividem a mesma célula, a Base primeiro", async () => {
    await abrir(
      template(
        versao({
          calculationMode: "FIXED_BASIS",
          components: [materiaPrima({ basis: "FIXED_BASIS" }), embalagem()],
        }),
      ),
    );

    const fornecimentos = screen.getAllByRole("combobox", {
      name: "Responsabilidade de fornecimento",
    });
    expect(fornecimentos).toHaveLength(2);
    for (const fornecimento of fornecimentos) {
      const celula = fornecimento.closest("td") as HTMLElement;
      expect(celula.classList.contains("col-regras")).toBe(true);
      // É este par que `workbench.css` empilha (`select + select`), na mesma
      // folha da Formulação; a guarda da folha está em
      // `formulations/premissas-de-producao.test.tsx`.
      expect(
        within(celula).getByRole("combobox", { name: "Base de cálculo do componente" })
          .nextElementSibling,
      ).toBe(fornecimento);
    }
  });
});

describe("Bancada do Modelo — versão legada sem forma", () => {
  it("abre sem crash, sem campos de forma e sem inventar premissa", async () => {
    await abrir(
      template(
        versao({
          dosageForm: null,
          presentationType: null,
          capsulesPerDose: null,
          capsulesPerPackage: null,
          calculationMode: "FIXED_BASIS",
          dosesPerPackage: null,
        }),
      ),
    );

    expect(
      (screen.getByLabelText(/Forma do produto/, { selector: "select" }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(screen.queryByLabelText(/Cápsulas por dose/, { selector: "input" })).toBeNull();
    expect(screen.queryByLabelText(/^Dose/, { selector: "input" })).toBeNull();
    // Sem forma não há doses derivadas: o resultado nem aparece.
    expect(screen.queryByTestId("modelo-doses-derivadas")).toBeNull();
    // E a receita continua editável.
    expect(screen.getByRole("textbox", { name: "Quantidade de MP-000001" })).toHaveValue("0,5");
  });
});

describe("Bancada do Modelo — barra fixa de ações", () => {
  it("tem as ações do MODELO, e nenhuma da Formulação", async () => {
    await abrir();

    const barra = salvar().closest(".sticky-action-bar");
    expect(barra).not.toBeNull();
    expect(within(barra as HTMLElement).getByRole("button", { name: /^Ativar versão/ })).toBeInTheDocument();
    expect(within(barra as HTMLElement).getByRole("button", { name: "← Voltar" })).toBeInTheDocument();
    // "Salvar como template" é ação da Formulação: promover a matriz a partir
    // dela mesma não significa nada.
    expect(screen.queryByRole("button", { name: /Salvar como template/ })).toBeNull();
    // A Ficha técnica do Modelo é ação de DOCUMENTO: mora no cabeçalho e no
    // histórico (`ficha-tecnica-do-modelo.test.tsx`), nunca na barra de edição.
    expect(within(barra as HTMLElement).queryByRole("button", { name: /Ficha técnica/ })).toBeNull();
  });

  it("os botões continuam aparecendo com a página inteira rolada — a barra é a única superfície", async () => {
    await abrir();

    // Uma superfície só: nenhum segundo "Salvar rascunho" no corpo do documento.
    expect(screen.getAllByRole("button", { name: /^Salvar rascunho/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Ativar versão/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "← Voltar" })).toHaveLength(1);
  });

  it("sem alteração pendente o salvar recusa, e ativar continua disponível", async () => {
    await abrir();

    expect(salvar()).toBeDisabled();
    expect(ativar()).toBeEnabled();
  });
});
