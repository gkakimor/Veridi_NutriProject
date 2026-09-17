import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * FORMULATION-COMPONENT-BASIS-AUTOMATION-01 — a bancada sem escolha de base.
 *
 * Decisão de PO: a base de cálculo da linha é consequência da seção e do modo
 * da receita, e o sistema a define. Na tela isso é:
 *
 *   - nenhuma coluna nem seletor de Base na edição; Fornecimento continua;
 *   - trocar o modo muda a prévia na hora, e "Salvar" envia sem base — o
 *     servidor a deriva (provado em `base-derivada-do-componente.test.ts`);
 *   - rascunho gravado com base fora da regra é avisado ANTES de gravar, e
 *     conta como alteração pendente;
 *   - versão fechada é lida pela base GRAVADA, explicada na ajuda do cálculo.
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
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    ]),
}));
vi.mock("../../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));
vi.mock("../../app/AuthProvider", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({ user: { role: "ADMIN" } }),
}));

import { getFormulationVersion, updateFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

/** 200 mg de cafeína: 0,0002 kg sobre a base 1; 0,012 kg por dose × 60 doses. */
function cafeina(overrides: Partial<FormulationComponentDTO> = {}): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "200",
    unitCode: "mg",
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: "0.0002",
    physicalPerUnit: "0.0002",
    stockUnitCode: "kg",
    itemSourceName: null,
    itemDeclaredNutrient: null,
    itemFamily: null,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: null,
    itemExternalCode: null,
    theoreticalPerDose: null,
    physicalPerDose: null,
    physicalPerCapsule: null,
    notes: null,
    position: 0,
    ...overrides,
  } as FormulationComponentDTO;
}

function pote(): FormulationComponentDTO {
  return cafeina({
    id: "cmp-2",
    itemId: "item-2",
    itemCode: "ME-000010",
    itemName: "Pote 60 cápsulas",
    itemType: "PACKAGING",
    quantity: "1",
    unitCode: "un",
    basis: "PER_FINISHED_UNIT",
    theoreticalPerUnit: "1",
    physicalPerUnit: "1",
    stockUnitCode: "un",
    position: 1,
  });
}

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Cafeína 60 doses",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    // Gravado: o campo fica à vista, e a troca para Por dose tem as doses.
    dosesPerPackage: 60,
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    capsulesPerPackage: null,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Cafeína 60 doses",
    outputUnitCode: "un",
    notes: null,
    components: [cafeina()],
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
  await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
  return view;
}

/** O equivalente por embalagem da cafeína — a linha da composição. */
function equivalenteDaCafeina(container: HTMLElement): string {
  const celula = container.querySelector("table.table--formulacao-composicao .estoque-valor--equivalente");
  expect(celula, "célula do equivalente não encontrada").toBeTruthy();
  return celula!.textContent!.trim();
}

function enviado() {
  const [, payload] = vi.mocked(updateFormulationVersion).mock.calls.at(-1)!;
  return payload as unknown as { calculationMode: string; components: Record<string, unknown>[] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Bancada da Formulação — a base é do sistema", () => {
  it("edição em Base fixa: nenhuma coluna nem seletor de Base, e Fornecimento em cada linha", async () => {
    const { container } = await abrir(versao({ components: [cafeina(), pote()] }));
    await waitFor(() => expect(equivalenteDaCafeina(container)).toBe("0,0002 kg"));

    expect(screen.queryByRole("combobox", { name: "Base de cálculo do componente" })).toBeNull();
    const cabecalhos = Array.from(container.querySelectorAll("table.table--formulacao thead th")).map(
      (th) => th.textContent?.trim() ?? "",
    );
    expect(cabecalhos.some((texto) => /^Base\b/.test(texto))).toBe(false);
    expect(cabecalhos.filter((texto) => texto.startsWith("Fornecimento"))).toHaveLength(2);
    expect(
      screen.getAllByRole("combobox", { name: "Responsabilidade de fornecimento" }),
    ).toHaveLength(2);
    // Nada pendente numa receita coerente, e nenhum aviso de base.
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(screen.queryByText(/base de cálculo ajustada/)).toBeNull();
  });

  it("linha nova também nasce sem seletor de Base, com Fornecimento", async () => {
    await abrir(versao());
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar embalagem" }));

    const embalagem = screen.getByText("Embalagem").closest("section") ?? document.body;
    expect(
      within(embalagem as HTMLElement).getAllByRole("combobox", {
        name: "Responsabilidade de fornecimento",
      }),
    ).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Base de cálculo do componente" })).toBeNull();
  });

  it("trocar para Por dose muda a prévia na hora, e Salvar envia o modo sem base nenhuma", async () => {
    const user = userEvent.setup();
    const dto = versao();
    vi.mocked(updateFormulationVersion).mockResolvedValue(dto);
    const { container } = await abrir(dto);
    await waitFor(() => expect(equivalenteDaCafeina(container)).toBe("0,0002 kg"));

    fireEvent.change(document.getElementById("version-mode") as HTMLSelectElement, {
      target: { value: "PER_DOSE" },
    });
    // 200 mg por dose × 60 doses = 0,012 kg — a mesma conta que o servidor fará.
    await waitFor(() => expect(equivalenteDaCafeina(container)).toBe("0,012 kg"));

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));
    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().calculationMode).toBe("PER_DOSE");
    expect(enviado().components).toHaveLength(1);
    for (const linha of enviado().components) expect(linha).not.toHaveProperty("basis");
  });

  it("rascunho gravado com base fora da regra: avisa antes, conta como pendente, e a tela já segue a regra", async () => {
    // Linha por dose numa receita Base fixa — gravada antes da regra.
    const { container } = await abrir(
      versao({ components: [cafeina({ basis: "PER_DOSE", theoreticalPerUnit: "0.012", physicalPerUnit: "0.012" })] }),
    );

    expect(await screen.findByText("1 linha terá a base de cálculo ajustada ao salvar")).toBeTruthy();
    expect(screen.getByText(/MP-000003 — Cafeína: gravada como “Por dose”/)).toBeTruthy();
    expect(screen.getByText(/A base de cálculo é definida automaticamente pela configuração da formulação/)).toBeTruthy();
    expect(screen.getAllByText("Alterações não salvas").length).toBeGreaterThan(0);
    // A prévia é a da base que a gravação vai gravar: sobre a base 1.
    await waitFor(() => expect(equivalenteDaCafeina(container)).toBe("0,0002 kg"));
  });

  it("versão ativa com base fora da regra: lida pelo gravado e explicada na ajuda do cálculo", async () => {
    const { container } = await abrir(
      versao({
        status: "ACTIVE",
        activatedAt: new Date().toISOString(),
        components: [cafeina({ basis: "PER_DOSE", theoreticalPerUnit: "0.012", physicalPerUnit: "0.012" })],
      }),
    );

    // O número do servidor, calculado pela base gravada — nada reinterpretado.
    await waitFor(() => expect(equivalenteDaCafeina(container)).toBe("0,012 kg"));
    expect(screen.queryByText(/base de cálculo ajustada/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Base de cálculo do componente" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ajuda sobre Quantidade física" }));
    expect(
      await screen.findByText(/Base de cálculo gravada nesta versão: Por dose/),
    ).toBeTruthy();
  });
});
