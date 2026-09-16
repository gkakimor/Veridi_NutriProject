import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationVersionDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * FORMULATION-WORKBENCH-01 — a bancada como a pessoa a usa.
 *
 * O motor é provado em `@veridi/shared` contra as planilhas reais, e a gravação
 * na suíte da API. Aqui a pergunta é a da TELA: a formulação responde enquanto
 * se digita (cápsulas por dose, pureza, dose do pó), matéria-prima e embalagem
 * aparecem separadas pelo tipo real do Item, e o que o cadastro do Item já sabe
 * chega na linha sem ninguém redigitar.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({
  // A tela pede matéria-prima e embalagem em chamadas separadas: o falso
  // respeita o filtro, senão o mesmo item entra duas vezes no catálogo da tela.
  listItems: vi.fn((filtro?: { type?: string }) =>
    Promise.resolve({
      items: CATALOGO.filter((item) => !filtro?.type || item.type === filtro.type),
    }),
  ),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve(UNIDADES) }));
vi.mock("../../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

/**
 * A busca por rótulo precisa achar o CAMPO, não o ícone de ajuda.
 *
 * As premissas da bancada passaram a explicar-se num ⓘ dentro do próprio
 * `<label>` (FORMULATION-WORKBENCH-01), e o gatilho da dica é um `<button>`
 * chamado "Ajuda sobre Cápsulas por dose". Para `getByLabelText` os dois
 * respondem pelo mesmo nome, e a busca passou a achar dois elementos. O
 * seletor prende a resposta ao controle de formulário — o ⓘ continua
 * acessível, e continua fora desta pergunta.
 */
const CAMPO_DO_FORMULARIO = { selector: "input, select, textarea" } as const;


/**
 * O catálogo que o seletor de item oferece.
 *
 * `MP-000030` tem pureza de referência no cadastro (88,7%) — é dele que a linha
 * nova herda o número, e é contra ele que a versão mostra a divergência quando
 * alguém sobrescreve.
 */
const CATALOGO = [
  {
    id: "item-mp",
    code: "MP-000030",
    name: "L-metilfolato de cálcio",
    type: "RAW_MATERIAL",
    unitCode: "kg",
    unit: { code: "kg", dimension: "MASS" },
    active: true,
    sourceName: "Metilfolato",
    declaredNutrient: "Folato",
    family: "VITAMIN",
    packagingSubtype: null,
    defaultPurityPercent: "88.7",
  },
  {
    id: "item-sem-pureza",
    code: "MP-000499",
    name: "Proteína bovina",
    type: "RAW_MATERIAL",
    unitCode: "kg",
    unit: { code: "kg", dimension: "MASS" },
    active: true,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    packagingSubtype: null,
    defaultPurityPercent: null,
  },
];

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

/** Matéria-prima por dose, como a bancada a cria: alvo ativo + pureza aplicada. */
function materiaPrima(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmp-mp",
    itemId: "item-mp",
    itemCode: "MP-000030",
    itemName: "Ácido Fólico",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity: "0.4",
    unitCode: "mg",
    basis: "PER_DOSE" as const,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: "70",
    overagePercent: null,
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

function embalagem(overrides: Record<string, unknown> = {}) {
  return {
    ...materiaPrima(),
    id: "cmp-emb",
    itemId: "item-emb",
    itemCode: "ME-000455",
    itemName: "Pote R220",
    itemType: "PACKAGING" as const,
    quantity: "1",
    unitCode: "un",
    basis: "PER_FINISHED_UNIT" as const,
    purityPercentApplied: null,
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
    productCode: "PROD-000030",
    productName: "Ácido Fólico PT 120 caps",
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
    productProfile: {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      doseAmount: null,
      doseUomCode: null,
      dosesPerPackage: 120,
      targetAgeGroup: null,
      minimumBatchQuantity: null,
      unitsPerShippingBox: null,
    },
    outputItemId: "pa-1",
    outputItemCode: "PA-000030",
    outputItemName: "Ácido Fólico PT 120 caps",
    outputUnitCode: "un",
    notes: null,
    components: [materiaPrima(), embalagem()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    ...overrides,
  } as FormulationVersionDTO;
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
  await waitFor(() => expect(screen.getAllByText(/PROD-000030/).length).toBeGreaterThan(0));
  return view;
}

/** A seção pelo título — é assim que a tela separa composição de embalagem. */
function secao(titulo: RegExp): HTMLElement {
  const cabecalho = screen.getByRole("heading", { name: titulo });
  const bloco = cabecalho.closest("section") ?? cabecalho.parentElement;
  expect(bloco, `seção ${titulo} não encontrada`).toBeTruthy();
  return bloco as HTMLElement;
}

/**
 * A opção do seletor, pelo início do código.
 *
 * A lista vai ao `document.body` por portal, e o jsdom pode guardar mais de uma
 * renderização dela ao mesmo tempo — a última é a que está na tela. "+ Novo item
 * de estoque" também é `option`, e por isso a busca casa pelo INÍCIO do nome.
 */
function opcao(codigo: string): HTMLElement {
  const listas = document.querySelectorAll("ul[role='listbox']");
  const ultima = listas[listas.length - 1] as HTMLElement;
  expect(ultima, "lista do seletor não está aberta").toBeTruthy();
  return within(ultima).getByRole("option", { name: new RegExp(`^${codigo}`) });
}

/**
 * A linha pelo campo de quantidade dela.
 *
 * Em rascunho o código do item vive no SELETOR (o seletor mostra "MP-000030 ·
 * Ácido Fólico" como placeholder do campo), então procurar o código como texto
 * não acha a linha. O rótulo do campo de quantidade nomeia o componente e existe
 * nos dois estados.
 */
function linha(codigo: string): HTMLElement {
  const campo = screen.getByLabelText(new RegExp(`Quantidade de ${codigo}`));
  const tr = campo.closest("tr");
  expect(tr, `linha de ${codigo} não encontrada`).toBeTruthy();
  return tr as HTMLElement;
}

describe("Bancada — cápsula responde ao vivo", () => {
  it("mostra a quantidade física por dose e por cápsula da linha", async () => {
    await abrir(versao());
    const mp = linha("MP-000030");
    // 0,400 mg de alvo ativo a 70% = 0,571429 mg — o número da planilha.
    expect(mp.textContent).toContain("0,571429");
    expect(within(mp).getAllByText(/0,571429 mg/).length).toBeGreaterThanOrEqual(2);
  });

  it("2 cápsulas por dose refazem doses por embalagem e a massa da cápsula, sem salvar", async () => {
    await abrir(versao());
    expect(screen.getByTestId("doses-derivadas").textContent).toBe("120");

    fireEvent.change(screen.getByLabelText(/Cápsulas por dose/, CAMPO_DO_FORMULARIO), { target: { value: "2" } });

    await waitFor(() => expect(screen.getByTestId("doses-derivadas").textContent).toBe("60"));
    const mp = linha("MP-000030");
    // A dose continua 0,571429 mg; cada uma das duas cápsulas leva metade.
    expect(mp.textContent).toContain("0,285714");
  });

  it("pureza editada na coluna muda a quantidade física na hora", async () => {
    await abrir(versao());
    fireEvent.change(screen.getByLabelText(/Pureza de MP-000030/, CAMPO_DO_FORMULARIO), {
      target: { value: "100" },
    });
    await waitFor(() => expect(linha("MP-000030").textContent).toContain("0,4 mg"));
    expect(linha("MP-000030").textContent).not.toContain("0,571429");
  });

  it("cápsulas por embalagem que não fecham dose inteira são recusadas antes de salvar", async () => {
    await abrir(versao());
    fireEvent.change(screen.getByLabelText(/Cápsulas por dose/, CAMPO_DO_FORMULARIO), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() =>
      expect(screen.getByText(/múltiplo de cápsulas por dose/i)).toBeTruthy(),
    );
    expect(screen.getByTestId("doses-derivadas").textContent).toBe("—");
  });

  it("o resumo diz o que a dose pesa e o que cada cápsula leva", async () => {
    await abrir(versao());
    const resumo = secao(/Resumo da formulação/);
    expect(resumo.textContent).toContain("Cápsula");
    expect(resumo.textContent).toContain("Pote");
    expect(resumo.textContent).toContain("0,571429 mg");
  });
});

describe("Bancada — separação e dados do Item", () => {
  it("matéria-prima e embalagem ficam em seções próprias, pelo tipo real do Item", async () => {
    await abrir(versao());
    const composicao = secao(/Composição — matérias-primas/);
    const embalagens = secao(/^Embalagem$/);
    expect(within(composicao).getByLabelText(/Quantidade de MP-000030/)).toBeTruthy();
    expect(within(composicao).queryByLabelText(/Quantidade de ME-000455/)).toBeNull();
    expect(within(embalagens).getByLabelText(/Quantidade de ME-000455/)).toBeTruthy();
    expect(within(embalagens).queryByLabelText(/Quantidade de MP-000030/)).toBeNull();
  });

  it("a linha traz fonte e família do cadastro, sem discurso sobre a pureza", async () => {
    await abrir(versao());
    const mp = linha("MP-000030");
    expect(mp.textContent).toContain("L-metilfolato de cálcio");
    expect(mp.textContent).toContain("Vitamina");
    // A coluna Pureza é o próprio valor: sob o contrato da bancada não há
    // "aplicada" x "registrada" para desambiguar num rascunho.
    expect(mp.textContent).not.toContain("registrada, não aplicada");
  });

  it("a busca de item diz que procura por código ou nome, em cada seção", async () => {
    await abrir(versao());
    // A linha JÁ preenchida mostra o item escolhido; o texto de busca pertence
    // à linha nova — que é onde alguém vai procurar.
    fireEvent.click(screen.getByRole("button", { name: /Adicionar matéria-prima/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar embalagem/ }));

    expect(screen.getByPlaceholderText(/Buscar matéria-prima por código ou nome/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Buscar embalagem por código ou nome/i)).toBeTruthy();
  });

  it("item escolhido traz a pureza do cadastro como default da linha nova", async () => {
    await abrir(versao({ components: [embalagem()] }));

    fireEvent.click(screen.getByRole("button", { name: /Adicionar matéria-prima/ }));
    const seletor = screen.getByPlaceholderText(/Buscar matéria-prima por código ou nome/i);
    fireEvent.focus(seletor);
    await act(async () => {});
    // "+ Novo item de estoque" também é `option` e leva o termo digitado: casar
    // pelo INÍCIO do nome é o que separa a opção real da de criar.
    fireEvent.mouseDown(opcao("MP-000030"));
    await act(async () => {});

    // 88,7% do cadastro entra sozinha, e já corrige: 0 é o alvo em branco, mas
    // a coluna precisa nascer preenchida para ninguém redigitar o que já existe.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /Pureza de MP-000030/ })).toHaveValue("88,7"),
    );
  });

  it("pureza sobrescrita vale, e o cadastro de hoje aparece como referência discreta", async () => {
    await abrir(versao({ components: [materiaPrima({ itemDefaultPurityPercent: "88.7" })] }));
    const mp = linha("MP-000030");

    // A versão usa 70%; o Item cadastra 88,7% HOJE. A linha mostra os dois sem
    // trocar um pelo outro: o snapshot é da versão.
    expect(within(mp).getByRole("textbox", { name: /Pureza de MP-000030/ })).toHaveValue("70");
    expect(mp.textContent).toContain("referência atual do cadastro");
    expect(mp.textContent).toContain("88,7%");
    expect(mp.textContent).toContain("0,571429");
  });

  it("item sem pureza de referência nasce com a coluna vazia — nunca 100%", async () => {
    await abrir(versao({ components: [embalagem()] }));

    fireEvent.click(screen.getByRole("button", { name: /Adicionar matéria-prima/ }));
    const seletor = screen.getByPlaceholderText(/Buscar matéria-prima por código ou nome/i);
    fireEvent.focus(seletor);
    await act(async () => {});
    // "+ Novo item de estoque" também é `option` e leva o termo digitado: casar
    // pelo INÍCIO do nome é o que separa a opção real da de criar.
    fireEvent.mouseDown(opcao("MP-000499"));
    await act(async () => {});

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /Pureza de MP-000499/ })).toHaveValue(""),
    );
  });

  it("reserva de produção digitada não mexe na física por dose", async () => {
    await abrir(versao());
    const antes = linha("MP-000030").textContent ?? "";
    expect(antes).toContain("0,571429");

    fireEvent.change(screen.getByRole("textbox", { name: /Reserva % de MP-000030/ }), {
      target: { value: "10" },
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /Reserva % de MP-000030/ })).toHaveValue(
        "10",
      ),
    );
    expect(linha("MP-000030").textContent).toContain("0,571429");
  });

  it("a cápsula mostra a coluna Por cápsula e os campos de cápsula, e não os do pó", async () => {
    await abrir(versao());

    const tabela = document.querySelector("table.table--formulacao")!;
    const cabecalhos = Array.from(tabela.querySelectorAll("thead th")).map(
      (th) => th.textContent?.trim() ?? "",
    );
    expect(cabecalhos.some((texto) => texto.startsWith("Por cápsula"))).toBe(true);
    expect(screen.getByLabelText(/Cápsulas por dose/, CAMPO_DO_FORMULARIO)).toBeTruthy();
    expect(screen.getByLabelText(/Cápsulas por embalagem/, CAMPO_DO_FORMULARIO)).toBeTruthy();
    // Dose e conteúdo são premissas do pó: na cápsula quem manda são as cápsulas.
    expect(screen.queryByLabelText(/^Dose$/, CAMPO_DO_FORMULARIO)).toBeNull();
    expect(screen.queryByLabelText(/Conteúdo da embalagem/, CAMPO_DO_FORMULARIO)).toBeNull();
  });

  it("a forma do produto oferece só Pó e Cápsula", async () => {
    await abrir(versao());

    const forma = screen.getByLabelText(/Forma do produto/, CAMPO_DO_FORMULARIO) as HTMLSelectElement;
    expect(Array.from(forma.options).map((opcao) => opcao.textContent)).toEqual([
      "—",
      "Cápsula",
      "Pó",
    ]);
  });

  it("forma histórica fora das duas continua na lista enquanto for a da versão", async () => {
    // Tirar a opção de um valor JÁ gravado faria o seletor cair no traço e
    // apagar a premissa da versão no primeiro salvamento.
    await abrir(versao({ dosageForm: "TABLET", capsulesPerDose: null } as Partial<FormulationVersionDTO>));

    const forma = screen.getByLabelText(/Forma do produto/, CAMPO_DO_FORMULARIO) as HTMLSelectElement;
    expect(forma.value).toBe("TABLET");
    expect(Array.from(forma.options).map((opcao) => opcao.textContent)).toContain("Comprimido");
  });

  it("o topo resume as premissas que a Formulação não edita", async () => {
    await abrir(
      versao({
        productProfile: {
          dosageForm: "CAPSULE",
          presentationType: "POT",
          capsulesPerDose: 1,
          doseAmount: null,
          doseUomCode: null,
          dosesPerPackage: 120,
          targetAgeGroup: "ADULT",
          minimumBatchQuantity: "5000",
          unitsPerShippingBox: 60,
        },
        components: [materiaPrima({ overagePercent: "10" })],
      } as Partial<FormulationVersionDTO>),
    );

    const premissas = screen.getByRole("heading", { name: /Produto e apresentação/ }).closest("section")!;
    expect(premissas.textContent).toContain("Faixa etária");
    expect(premissas.textContent).toContain("Adulto");
    expect(premissas.textContent).toContain("Lote mínimo");
    expect(premissas.textContent).toContain("Caixa de embarque");
    // A reserva de referência sai das LINHAS, e só quando todas concordam.
    expect(premissas.textContent).toContain("Reserva");
    expect(premissas.textContent).toContain("10%");
  });

  it("embalagem não tem coluna por dose nem pureza — pote não tem pureza", async () => {
    await abrir(versao());
    const embalagens = secao(/^Embalagem$/);
    expect(within(embalagens).queryByText("Física por dose")).toBeNull();
    expect(within(embalagens).queryByText("Pureza")).toBeNull();
    // A unidade saiu do cabeçalho junto com o seletor: `un` é a única unidade
    // da dimensão de contagem, e ela vem do Item.
    expect(within(embalagens).getByRole("columnheader", { name: "Quantidade" })).toBeTruthy();
  });
});

describe("Bancada — pó", () => {
  const doPo = versao({
    productName: "Beef Protein Abacaxi 900 g",
    productCode: "PROD-000628",
    dosageForm: "POWDER",
    capsulesPerDose: null,
    capsulesPerPackage: null,
    dosesPerPackage: 30,
    doseAmount: "30000",
    doseUomCode: "mg",
    packageContentAmount: "900",
    packageContentUomCode: "g",
    components: [
      materiaPrima({
        itemCode: "MP-000628",
        itemName: "Beef Protein",
        quantity: "26000",
        purityPercentApplied: "95",
        itemDefaultPurityPercent: "95",
        itemExternalCode: null,
        physicalPerDose: "27368.421052631578947",
        physicalPerCapsule: null,
      }),
    ],
  } as Partial<FormulationVersionDTO>);

  async function abrirPo() {
    vi.mocked(getFormulationVersion).mockResolvedValue(doPo);
    render(
      <MemoryRouter initialEntries={["/producao/formulacoes/prod-1/versoes/fv-1"]}>
        <Routes>
          <Route
            path="/producao/formulacoes/:productId/versoes/:versionId"
            element={<FormulationVersionPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText(/PROD-000628/).length).toBeGreaterThan(0));
  }

  it("dose e conteúdo fecham as doses da embalagem", async () => {
    await abrirPo();
    expect(screen.getByTestId("doses-derivadas").textContent).toBe("30");
    expect(screen.getByLabelText(/^Dose$/, CAMPO_DO_FORMULARIO)).toBeTruthy();
    expect(screen.getByLabelText(/Conteúdo da embalagem/, CAMPO_DO_FORMULARIO)).toBeTruthy();
  });

  it("não fala em cápsula, e a física por dose é a da planilha", async () => {
    await abrirPo();
    expect(screen.queryByText("Por cápsula")).toBeNull();
    expect(screen.queryByLabelText(/Cápsulas por dose/, CAMPO_DO_FORMULARIO)).toBeNull();
    expect(linha("MP-000628").textContent).toContain("27.368,421053");
  });

  it("o pó não mostra coluna Por cápsula nem campos de cápsula", async () => {
    await abrirPo();

    const tabela = document.querySelector("table.table--formulacao")!;
    const cabecalhos = Array.from(tabela.querySelectorAll("thead th")).map(
      (th) => th.textContent?.trim() ?? "",
    );
    // Coluna inútil com valor zero é pior que coluna ausente: no pó não existe
    // "por cápsula", e a tabela não finge que existe.
    expect(cabecalhos.some((texto) => texto.startsWith("Por cápsula"))).toBe(false);
    expect(cabecalhos.some((texto) => texto.startsWith("Reserva %"))).toBe(true);
    expect(screen.queryByLabelText(/Cápsulas por embalagem/, CAMPO_DO_FORMULARIO)).toBeNull();
    expect(screen.getByLabelText(/^Dose$/, CAMPO_DO_FORMULARIO)).toBeTruthy();
  });

  it("conteúdo que não dá doses inteiras é recusado, não arredondado", async () => {
    await abrirPo();
    fireEvent.change(screen.getByLabelText(/^Dose$/, CAMPO_DO_FORMULARIO), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText(/Unidade da dose/), { target: { value: "g" } });

    await waitFor(() => expect(screen.getByTestId("doses-derivadas").textContent).toBe("—"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(screen.getByText(/número inteiro de doses/i)).toBeTruthy(),
    );
  });
});
