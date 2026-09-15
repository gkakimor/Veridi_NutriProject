import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  listItems: vi.fn(() => Promise.resolve({ items: [] })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve(UNIDADES) }));
vi.mock("../../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

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

    fireEvent.change(screen.getByLabelText(/Cápsulas por dose/), { target: { value: "2" } });

    await waitFor(() => expect(screen.getByTestId("doses-derivadas").textContent).toBe("60"));
    const mp = linha("MP-000030");
    // A dose continua 0,571429 mg; cada uma das duas cápsulas leva metade.
    expect(mp.textContent).toContain("0,285714");
  });

  it("pureza editada na coluna muda a quantidade física na hora", async () => {
    await abrir(versao());
    fireEvent.change(screen.getByLabelText(/Pureza de MP-000030/), { target: { value: "100" } });
    await waitFor(() => expect(linha("MP-000030").textContent).toContain("0,4 mg"));
    expect(linha("MP-000030").textContent).not.toContain("0,571429");
  });

  it("cápsulas por embalagem que não fecham dose inteira são recusadas antes de salvar", async () => {
    await abrir(versao());
    fireEvent.change(screen.getByLabelText(/Cápsulas por dose/), { target: { value: "7" } });
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

  it("a linha traz fonte, família e o estado da pureza do cadastro", async () => {
    await abrir(versao());
    const mp = linha("MP-000030");
    expect(mp.textContent).toContain("L-metilfolato de cálcio");
    expect(mp.textContent).toContain("Vitamina");
    expect(mp.textContent).toContain("aplicada");
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

  it("embalagem não tem coluna por dose nem pureza — pote não tem pureza", async () => {
    await abrir(versao());
    const embalagens = secao(/^Embalagem$/);
    expect(within(embalagens).queryByText("Física por dose")).toBeNull();
    expect(within(embalagens).queryByText("Pureza")).toBeNull();
    expect(within(embalagens).getByText(/Quantidade · unidade/)).toBeTruthy();
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
    expect(screen.getByLabelText(/^Dose$/)).toBeTruthy();
    expect(screen.getByLabelText(/Conteúdo da embalagem/)).toBeTruthy();
  });

  it("não fala em cápsula, e a física por dose é a da planilha", async () => {
    await abrirPo();
    expect(screen.queryByText("Por cápsula")).toBeNull();
    expect(screen.queryByLabelText(/Cápsulas por dose/)).toBeNull();
    expect(linha("MP-000628").textContent).toContain("27.368,421053");
  });

  it("conteúdo que não dá doses inteiras é recusado, não arredondado", async () => {
    await abrirPo();
    fireEvent.change(screen.getByLabelText(/^Dose$/), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText(/Unidade da dose/), { target: { value: "g" } });

    await waitFor(() => expect(screen.getByTestId("doses-derivadas").textContent).toBe("—"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(screen.getByText(/número inteiro de doses/i)).toBeTruthy(),
    );
  });
});
