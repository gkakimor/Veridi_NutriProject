import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationVersionDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * PREMISSAS DE PRODUÇÃO e o refinamento final da bancada
 * (FORMULATION-WORKBENCH-01).
 *
 * O que esta suíte protege é o contrato de tela da última rodada de UX:
 *
 * - a perda prevista é da VERSÃO, fica fora da grade de matérias-primas e o
 *   rendimento sai dela, calculado e não digitado;
 * - digitar perda NÃO muda a física por dose nem por cápsula;
 * - a embalagem não tem pureza nem reserva de matéria-prima;
 * - a apresentação comercial só oferece o que combina com a forma;
 * - a explicação mora no ⓘ, não em frase permanente sob o campo;
 * - a base da formulação só é campo quando decide material.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(() => Promise.resolve({ items: [] })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve(UNIDADES) }));
vi.mock("../../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion, updateFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

/** O campo, nunca o ⓘ que o explica: os dois respondem pelo mesmo nome. */
const CAMPO_DO_FORMULARIO = { selector: "input, select, textarea" } as const;

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

/** A linha real do Ácido Fólico: 0,4 mg de alvo, 70% de pureza, 10% de reserva. */
function acidoFolico(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmp-mp",
    itemId: "item-mp",
    itemCode: "MP-000030",
    itemName: "L-metilfolato de cálcio",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity: "0.4",
    unitCode: "mg",
    basis: "PER_DOSE" as const,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: "70",
    overagePercent: "10",
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS" as const,
    applyPurityAdjustment: true,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: "0.000048",
    physicalPerUnit: "0.00006857142857142857",
    stockUnitCode: "kg",
    itemSourceName: "L-metilfolato de cálcio",
    itemDeclaredNutrient: "Ácido Fólico",
    itemFamily: "VITAMIN" as const,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: "70",
    itemExternalCode: null,
    theoreticalPerDose: "0.4",
    physicalPerDose: "0.571428571428571428",
    physicalPerCapsule: "0.571428571428571428",
    notes: null,
    position: 0,
    ...overrides,
  };
}

function pote(overrides: Record<string, unknown> = {}) {
  return {
    ...acidoFolico(),
    id: "cmp-emb",
    itemId: "item-emb",
    itemCode: "ME-000455",
    itemName: "Pote R220",
    itemType: "PACKAGING" as const,
    quantity: "1",
    unitCode: "un",
    basis: "PER_FINISHED_UNIT" as const,
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT" as const,
    applyPurityAdjustment: false,
    stockUnitCode: "un",
    itemSourceName: null,
    itemDeclaredNutrient: null,
    itemFamily: null,
    itemPackagingSubtype: "POT" as const,
    itemDefaultPurityPercent: null,
    itemExternalCode: null,
    theoreticalPerDose: null,
    physicalPerDose: null,
    physicalPerCapsule: null,
    position: 1,
    ...overrides,
  };
}

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000174",
    productName: "Exemplo - Ácido Fólico PT 120 Caps",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "PER_DOSE",
    dosesPerPackage: 120,
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 1,
    capsulesPerPackage: 120,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    productProfile: {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      doseAmount: null,
      doseUomCode: null,
      dosesPerPackage: 120,
      targetAgeGroup: null,
      minimumBatchQuantity: "1000",
      unitsPerShippingBox: 24,
    },
    outputItemId: "pa-1",
    outputItemCode: "PA-000174",
    outputItemName: "Exemplo - Ácido Fólico PT 120 Caps",
    outputUnitCode: "un",
    notes: null,
    components: [acidoFolico(), pote()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    ...overrides,
  } as FormulationVersionDTO;
}

/** A versão do Beef Protein: pó, 30 g de dose, 900 g de conteúdo, 2% de reserva. */
function versaoDoBeef(): FormulationVersionDTO {
  return versao({
    productCode: "PROD-000175",
    productName: "Exemplo - Beef Protein Abacaxi 900g Pote",
    dosageForm: "POWDER",
    capsulesPerDose: null,
    capsulesPerPackage: null,
    doseAmount: "30000",
    doseUomCode: "mg",
    packageContentAmount: "900000",
    packageContentUomCode: "mg",
    dosesPerPackage: 30,
    components: [
      acidoFolico({
        itemCode: "MP-000498",
        itemName: "Proteína bovina hidrolisada",
        quantity: "26000",
        purityPercentApplied: "95",
        overagePercent: "2",
        itemDefaultPurityPercent: "95",
        itemExternalCode: null,
        theoreticalPerDose: "26000",
        physicalPerDose: "27368.421052631578947",
        physicalPerCapsule: null,
      }),
      pote({ itemCode: "ME-000136", itemName: "Pote 1 kg" }),
    ],
  });
}

async function abrir(dto: FormulationVersionDTO) {
  vi.mocked(getFormulationVersion).mockResolvedValue(dto);
  const view = render(
    <MemoryRouter initialEntries={["/producao/formulacoes/prod-1/versoes/fv-1"]}>
      <Routes>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText(/PROD-000/).length).toBeGreaterThan(0));
  return view;
}

function secao(titulo: RegExp): HTMLElement {
  const cabecalho = screen.getByRole("heading", { name: titulo });
  const bloco = cabecalho.closest("section") ?? cabecalho.parentElement;
  expect(bloco, `seção ${titulo} não encontrada`).toBeTruthy();
  return bloco as HTMLElement;
}

const perda = () =>
  screen.getByLabelText(/Perda prevista de produção/, CAMPO_DO_FORMULARIO) as HTMLInputElement;

const rendimento = () => screen.getByTestId("rendimento-esperado");

describe("Premissas de produção — perda e rendimento", () => {
  it("o rendimento é 100% menos a perda e acompanha a digitação, sem salvar", async () => {
    await abrir(versao());

    // Sem premissa declarada não há rendimento presumido.
    expect(rendimento().textContent).toBe("—");

    fireEvent.change(perda(), { target: { value: "1" } });
    await waitFor(() => expect(rendimento().textContent).toBe("99%"));

    fireEvent.change(perda(), { target: { value: "2,5" } });
    await waitFor(() => expect(rendimento().textContent).toBe("97,5%"));

    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("o rendimento é resultado, não campo: não existe input com esse nome", async () => {
    await abrir(versao({ expectedLossPercent: "1" }));
    expect(rendimento().textContent).toBe("99%");
    expect(
      screen.queryByLabelText(/Rendimento esperado/, CAMPO_DO_FORMULARIO),
    ).toBeNull();
  });

  it("a perda mora em Premissas de produção, fora da grade de matérias-primas", async () => {
    await abrir(versao());
    // O campo existe uma vez só na tela, e não dentro da tabela da composição.
    expect(screen.getAllByLabelText(/Perda prevista de produção/, CAMPO_DO_FORMULARIO)).toHaveLength(
      1,
    );
    const composicao = secao(/Composição/);
    expect(
      within(composicao).queryByLabelText(/Perda prevista/, CAMPO_DO_FORMULARIO),
    ).toBeNull();
    expect(screen.getByText("Premissas de produção")).toBeTruthy();
  });

  it("digitar a perda NÃO muda a física por dose nem a por cápsula", async () => {
    await abrir(versao());

    const doses = () =>
      screen.getAllByText("0,571429 mg").map((no) => no.textContent);
    const antes = doses();
    // O mesmo número em três lugares, todos lendo o mesmo motor: física por
    // dose, por cápsula e a massa da dose no resumo.
    expect(antes.length).toBe(3);

    fireEvent.change(perda(), { target: { value: "1" } });
    await waitFor(() => expect(rendimento().textContent).toBe("99%"));

    expect(doses()).toEqual(antes);
  });

  it("a perda vai no payload da versão, e a reserva continua por linha", async () => {
    vi.mocked(updateFormulationVersion).mockResolvedValue(versao({ expectedLossPercent: "1" }));
    await abrir(versao());

    fireEvent.change(perda(), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalled());
    const [, payload] = vi.mocked(updateFormulationVersion).mock.calls[0]!;
    expect(payload.expectedLossPercent).toBe("1");
    // A reserva de matéria-prima NÃO virou premissa global: continua na linha.
    expect(payload.components?.[0]?.overagePercent).toBe("10");
    expect(
      Object.prototype.hasOwnProperty.call(payload, "overagePercent"),
      "reserva de matéria-prima não pode subir para a versão",
    ).toBe(false);
  });
});

describe("Setas de passo nos percentuais", () => {
  const seta = (campo: string, direcao: "Aumentar" | "Diminuir") =>
    screen.getByRole("button", { name: `${direcao} ${campo}` });

  it("o passo é a casa escrita: 70 vira 71, e 1,1 vira 1,2", async () => {
    await abrir(versao());
    const pureza = screen.getByRole("textbox", { name: "Pureza de MP-000030" });

    fireEvent.click(seta("Pureza de MP-000030", "Aumentar"));
    await waitFor(() => expect(pureza).toHaveValue("71"));

    fireEvent.change(pureza, { target: { value: "1,1" } });
    fireEvent.click(seta("Pureza de MP-000030", "Aumentar"));
    await waitFor(() => expect(pureza).toHaveValue("1,2"));

    fireEvent.click(seta("Pureza de MP-000030", "Diminuir"));
    await waitFor(() => expect(pureza).toHaveValue("1,1"));
  });

  it("ArrowUp e ArrowDown no campo dão o mesmo passo da seta", async () => {
    await abrir(versao());
    const reserva = screen.getByRole("textbox", { name: "Reserva % de MP-000030" });

    fireEvent.keyDown(reserva, { key: "ArrowUp" });
    await waitFor(() => expect(reserva).toHaveValue("11"));

    fireEvent.keyDown(reserva, { key: "ArrowDown" });
    await waitFor(() => expect(reserva).toHaveValue("10"));
  });

  it("a seta para onde a validação pararia — pureza não passa de 100", async () => {
    await abrir(versao());
    const pureza = screen.getByRole("textbox", { name: "Pureza de MP-000030" });

    fireEvent.change(pureza, { target: { value: "100" } });
    fireEvent.click(seta("Pureza de MP-000030", "Aumentar"));
    await waitFor(() => expect(pureza).toHaveValue("100"));
  });

  it("a perda prevista também tem as setas, e o rendimento acompanha", async () => {
    await abrir(versao({ expectedLossPercent: "1" }));
    fireEvent.click(seta("Perda prevista de produção", "Aumentar"));
    await waitFor(() => expect(rendimento().textContent).toBe("98%"));
  });
});

describe("Refinamento da grade", () => {
  it("a embalagem não tem pureza nem reserva de matéria-prima", async () => {
    await abrir(versao());
    const embalagem = secao(/^Embalagem$/);
    const cabecalhos = within(embalagem)
      .getAllByRole("columnheader")
      .map((th) => th.textContent ?? "");

    expect(cabecalhos.some((texto) => texto.includes("Pureza"))).toBe(false);
    expect(cabecalhos.some((texto) => texto.includes("Reserva"))).toBe(false);
    expect(
      within(embalagem).queryByRole("textbox", { name: /Pureza de ME-000455/ }),
    ).toBeNull();
    expect(
      within(embalagem).queryByRole("textbox", { name: /Reserva % de ME-000455/ }),
    ).toBeNull();
  });

  it("embalagem não pergunta a unidade: `un` é a única da dimensão e vem do Item", async () => {
    await abrir(versao());
    const embalagem = secao(/^Embalagem$/);

    // Escolher entre uma opção não é escolha: o seletor sai e a unidade fica
    // escrita ao lado do número, no mesmo lugar.
    expect(
      within(embalagem).queryByRole("combobox", { name: /Unidade de ME-000455/ }),
    ).toBeNull();
    const quantidade = within(embalagem).getByRole("textbox", { name: /Quantidade de ME-000455/ });
    expect(quantidade.closest(".quantidade-unidade")?.textContent).toContain("un");
    expect(within(embalagem).getByRole("columnheader", { name: "Quantidade" })).toBeTruthy();
  });

  it("matéria-prima em massa continua escolhendo a unidade — mg, g e kg são três", async () => {
    await abrir(versao());
    const composicao = secao(/Composição/);
    const unidade = within(composicao).getByRole("combobox", {
      name: /Unidade de MP-000030/,
    }) as HTMLSelectElement;
    // As três de massa, e nenhuma de contagem ou volume — a ordem é a do cadastro.
    expect([...unidade.options].map((o) => o.value).sort()).toEqual(["", "g", "kg", "mg"]);
  });

  it("no modo Por dose a base não é campo, e a coluna da linha é só Fornecimento", async () => {
    await abrir(versao());

    // Nenhuma linha por base fixa: a base não multiplica material e aparece
    // como referência, sem deixar de existir.
    expect(document.querySelector("#version-basis")).toBeNull();
    expect(screen.getByText(/Base da formulação/)).toBeTruthy();

    const composicao = secao(/Composição/);
    expect(
      within(composicao).queryByRole("combobox", { name: "Base de cálculo do componente" }),
    ).toBeNull();
    expect(
      within(composicao).getByRole("combobox", { name: "Responsabilidade de fornecimento" }),
    ).toBeTruthy();
  });

  it("com componente por base fixa a base volta a ser campo e o seletor da linha reaparece", async () => {
    await abrir(
      versao({ components: [acidoFolico({ basis: "FIXED_BASIS" }), pote()] }),
    );

    expect(document.querySelector("#version-basis")).toBeTruthy();
    const composicao = secao(/Composição/);
    expect(
      within(composicao).getByRole("combobox", { name: "Base de cálculo do componente" }),
    ).toBeTruthy();
  });
});

describe("Código legado do Item", () => {
  it("aparece junto da unidade de estoque quando o Item tem legado", async () => {
    await abrir(
      versao({
        components: [acidoFolico({ itemExternalCode: "1042" }), pote()],
      } as Partial<FormulationVersionDTO>),
    );
    const composicao = secao(/Composição/);
    expect(within(composicao).getByText(/Estoque em kg · legado 1042/)).toBeTruthy();
  });

  it("item sem legado não ganha rótulo vazio nem travessão", async () => {
    await abrir(versao());
    const composicao = secao(/Composição/);
    expect(within(composicao).queryByText(/legado/)).toBeNull();
    expect(within(composicao).getByText("Estoque em kg")).toBeTruthy();
  });
});

describe("Apresentação comercial", () => {
  it("chama-se Apresentação comercial e, na cápsula, oferece frasco", async () => {
    await abrir(versao());
    const apresentacao = screen.getByLabelText(
      /Apresentação comercial/,
      CAMPO_DO_FORMULARIO,
    ) as HTMLSelectElement;
    const opcoes = [...apresentacao.options].map((opcao) => opcao.textContent);
    expect(opcoes).toContain("Frasco");
    expect(opcoes).toContain("Pote");
  });

  it("no pó a lista não oferece frasco", async () => {
    await abrir(versaoDoBeef());
    const apresentacao = screen.getByLabelText(
      /Apresentação comercial/,
      CAMPO_DO_FORMULARIO,
    ) as HTMLSelectElement;
    expect([...apresentacao.options].map((o) => o.textContent)).not.toContain("Frasco");
  });

  it("pó com frasco gravado mantém a opção, para não apagar a premissa ao salvar", async () => {
    const beef = versaoDoBeef();
    await abrir({ ...beef, presentationType: "BOTTLE" } as FormulationVersionDTO);
    const apresentacao = screen.getByLabelText(
      /Apresentação comercial/,
      CAMPO_DO_FORMULARIO,
    ) as HTMLSelectElement;
    expect([...apresentacao.options].map((o) => o.textContent)).toContain("Frasco");
    expect(apresentacao.value).toBe("BOTTLE");
  });
});

describe("Explicações no ⓘ", () => {
  it("a perda se explica no ícone, sem frase permanente ocupando a tela", async () => {
    await abrir(versao());
    expect(screen.queryByText(/Percentual estimado de perda normal/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ajuda sobre Perda prevista de produção (%)" }));
    const dica = screen.getByText(/Percentual estimado de perda normal/);
    expect(dica.textContent).toMatch(/sem alterar a quantidade comercial vendida ao cliente/);
  });

  it("o modo de cálculo mostra a matemática no ícone", async () => {
    await abrir(versao());
    fireEvent.click(screen.getByRole("button", { name: "Ajuda sobre Modo de cálculo" }));
    const dica = screen.getByText(/quantidade física por dose = alvo por dose/);
    expect(dica.textContent).toMatch(/quantidade por cápsula = quantidade física por dose ÷ cápsulas por dose/);
    expect(dica.textContent).toMatch(/conteúdo da embalagem ÷ dose no pó/);
  });

  it("lote mínimo e caixa de embarque dizem no ícone que vêm do cadastro do Produto", async () => {
    await abrir(versao());

    fireEvent.click(screen.getByRole("button", { name: "Ajuda sobre Lote mínimo" }));
    expect(screen.getByText(/Valor herdado do cadastro do Produto/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ajuda sobre Caixa de embarque" }));
    expect(screen.getByText(/Informação logística herdada do cadastro do Produto/)).toBeTruthy();
  });
});

describe("Golden — as duas versões de homologação", () => {
  it("Ácido Fólico: cápsula, pote, 1 cápsula por dose, 120 por embalagem, 0,571428… mg", async () => {
    await abrir(versao({ expectedLossPercent: "1" }));

    expect(
      (screen.getByLabelText(/Forma do produto/, CAMPO_DO_FORMULARIO) as HTMLSelectElement).value,
    ).toBe("CAPSULE");
    expect(
      (screen.getByLabelText(/Apresentação comercial/, CAMPO_DO_FORMULARIO) as HTMLSelectElement)
        .value,
    ).toBe("POT");
    expect(
      (screen.getByLabelText(/Cápsulas por dose/, CAMPO_DO_FORMULARIO) as HTMLInputElement).value,
    ).toBe("1");
    expect(
      (screen.getByLabelText(/Cápsulas por embalagem/, CAMPO_DO_FORMULARIO) as HTMLInputElement)
        .value,
    ).toBe("120");
    expect(screen.getByTestId("doses-derivadas").textContent).toBe("120");
    // A perda de 1% está declarada e a dose continua a da planilha.
    expect(rendimento().textContent).toBe("99%");
    expect(screen.getAllByText("0,571429 mg").length).toBe(3);
    expect(
      (screen.getByRole("textbox", { name: /Reserva % de MP-000030/ }) as HTMLInputElement)
        .value,
    ).toBe("10");
  });

  it("Beef Protein: pó, 30 g por dose, 900 g de conteúdo, 27.368,421053 mg e sem Por cápsula", async () => {
    await abrir(versaoDoBeef());

    expect(
      (screen.getByLabelText(/Forma do produto/, CAMPO_DO_FORMULARIO) as HTMLSelectElement).value,
    ).toBe("POWDER");
    expect(screen.getByTestId("doses-derivadas").textContent).toBe("30");
    expect(screen.getAllByText("27.368,421053 mg").length).toBeGreaterThan(0);

    const composicao = secao(/Composição/);
    const cabecalhos = within(composicao)
      .getAllByRole("columnheader")
      .map((th) => th.textContent ?? "");
    expect(cabecalhos.some((texto) => texto.includes("Por cápsula"))).toBe(false);
    expect(
      (screen.getByRole("textbox", { name: /Reserva % de MP-000498/ }) as HTMLInputElement)
        .value,
    ).toBe("2");
  });
});
