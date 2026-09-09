import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationCostEstimateDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * O custo estimado acompanha o salvamento — F-03-1.
 *
 * O bloco "Custo estimado de materiais" é buscado no servidor, e o efeito que
 * o buscava dependia de `version?.components.length`. Alterar a quantidade de
 * um componente e salvar não muda o tamanho da lista: o efeito não
 * reexecutava, e a tela seguia mostrando o custo do estado ANTERIOR até
 * recarregar a página. Quem conferisse o custo logo depois de salvar conferia
 * o número errado, sem nenhum aviso — a situação que §54 proíbe.
 *
 * Duas coisas ficam fixadas aqui:
 *
 * 1. **Convergência.** Depois de um salvamento bem-sucedido a tela mostra o
 *    custo do estado persistido, sem F5, sem trocar de aba, sem sair e voltar.
 *    O número continua vindo do servidor: nada é recalculado no navegador.
 * 2. **Identidade (§54).** Enquanto houver edição não salva, o bloco diz que
 *    é o custo do último salvamento. Salvar que FALHA não promove custo
 *    nenhum: o número na tela continua sendo o do que está gravado.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([{ code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" }]),
}));
vi.mock("../../lib/costs-api", () => ({ getFormulationCostEstimate: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import {
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { getFormulationCostEstimate } from "../../lib/costs-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

/*
 * Conferência numérica da rodada, base 1 kg de acabado:
 *
 *   0,010 kg × R$ 100,00/kg = R$ 1,00   (antes)
 *   0,025 kg × R$ 100,00/kg = R$ 2,50   (depois de salvar)
 *   0,040 kg × R$ 100,00/kg = R$ 4,00   (segunda edição)
 *
 * O custo unitário não muda em nenhum momento: o que muda é a quantidade.
 */
const CUSTO_UNITARIO = "100";
const QTD_A = "0.010";
const QTD_B = "0.025";
const QTD_C = "0.040";
const CUSTO_A = "1.00";
const CUSTO_B = "2.50";
const CUSTO_C = "4.00";

function componente(quantity: string) {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity,
    unitCode: "kg",
    basis: "PER_BATCH" as const,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT" as const,
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: quantity,
    physicalPerUnit: quantity,
    stockUnitCode: "kg",
    notes: null,
    position: 0,
  };
}

function versao(quantity: string): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Produto Teste",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Produto Teste",
    outputUnitCode: "kg",
    notes: null,
    components: [componente(quantity)],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
  } as unknown as FormulationVersionDTO;
}

/** A estimativa como o SERVIDOR a devolve para a versão já persistida. */
function estimativa(quantity: string, custo: string): FormulationCostEstimateDTO {
  return {
    formulationVersionId: "fv-1",
    basisQuantity: "1",
    outputUnitCode: "kg",
    referenceDate: "2026-09-08T12:00:00.000Z",
    components: [
      {
        itemId: "item-1",
        itemCode: "MP-000003",
        itemName: "Cafeína",
        formulaQuantity: quantity,
        formulaUnitCode: "kg",
        requiredQuantity: quantity,
        stockUnitCode: "kg",
        unitCost: CUSTO_UNITARIO,
        costSource: "REAL_PURCHASE_30D",
        costSourceDetails: null,
        customerSupplied: false,
        estimatedComponentCost: custo,
      },
    ],
    quality: "ESTIMATED",
    estimatedMaterialCost: custo,
    estimatedMaterialUnitCost: custo,
    knownCostSubtotal: custo,
    missingCostItems: [],
    ambiguousCostItems: [],
    hasCustomerSuppliedMaterials: false,
    missingContext: null,
  } as unknown as FormulationCostEstimateDTO;
}

async function abrir() {
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
  await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
}

/** O texto do bloco "Custo estimado de materiais" — o que a pessoa confere. */
function blocoDeCusto(): string {
  const tabela = document.querySelector(".table--custo-estimado");
  expect(tabela, "bloco de custo estimado não encontrado").toBeTruthy();
  return tabela!.closest("section")?.textContent ?? tabela!.textContent ?? "";
}

function digitarQuantidade(valor: string) {
  fireEvent.change(screen.getByLabelText("Quantidade de MP-000003"), {
    target: { value: valor },
  });
}

async function salvar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFormulationVersion).mockResolvedValue(versao(QTD_A));
  vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_A, CUSTO_A));
});

describe("F-03-1 — o custo estimado acompanha o salvamento", () => {
  it("salvar uma quantidade nova troca o custo na tela, sem recarregar a página", async () => {
    const user = userEvent.setup();
    await abrir();

    // Antes: 0,010 kg × R$ 100,00 = R$ 1,00.
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s1,00/));

    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_B));
    vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_B, CUSTO_B));

    digitarQuantidade("0,025");
    await salvar(user);

    // Depois: 0,025 kg × R$ 100,00 = R$ 2,50 — na mesma montagem da página.
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s2,50/));
    expect(blocoDeCusto()).not.toMatch(/R\$\s1,00/);
  });

  it("a estimativa é pedida ao servidor a cada salvamento — nada é recalculado aqui", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(vi.mocked(getFormulationCostEstimate)).toHaveBeenCalledTimes(1));

    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_B));
    vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_B, CUSTO_B));

    digitarQuantidade("0,025");
    await salvar(user);

    await waitFor(() => expect(vi.mocked(getFormulationCostEstimate)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getFormulationCostEstimate)).toHaveBeenLastCalledWith("fv-1");
  });

  it("a segunda alteração também aparece — a tela não trava na primeira", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s1,00/));

    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_B));
    vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_B, CUSTO_B));
    digitarQuantidade("0,025");
    await salvar(user);
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s2,50/));

    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_C));
    vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_C, CUSTO_C));
    digitarQuantidade("0,040");
    await salvar(user);

    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s4,00/));
    expect(blocoDeCusto()).not.toMatch(/R\$\s2,50/);
  });

  it("resposta atrasada da estimativa anterior não sobrescreve a mais nova", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s1,00/));

    // A busca do primeiro salvamento fica pendurada; a do segundo responde já.
    let liberarAntiga: (dto: FormulationCostEstimateDTO) => void = () => {};
    const antiga = new Promise<FormulationCostEstimateDTO>((resolve) => {
      liberarAntiga = resolve;
    });
    vi.mocked(getFormulationCostEstimate).mockReturnValueOnce(
      antiga as ReturnType<typeof getFormulationCostEstimate>,
    );
    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_B));
    digitarQuantidade("0,025");
    await salvar(user);

    vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_C, CUSTO_C));
    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_C));
    digitarQuantidade("0,040");
    await salvar(user);
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s4,00/));

    // Só agora a antiga volta — e perde, porque saiu antes.
    liberarAntiga(estimativa(QTD_B, CUSTO_B));
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s4,00/));
    expect(blocoDeCusto()).not.toMatch(/R\$\s2,50/);
  });

  it("salvar que falha não promove custo nenhum, e o erro fica na tela", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s1,00/));

    vi.mocked(updateFormulationVersion).mockRejectedValue(new Error("Falha ao salvar rascunho"));
    digitarQuantidade("0,025");
    await salvar(user);

    expect(await screen.findByText(/Falha ao salvar rascunho/)).toBeTruthy();
    // O custo continua sendo o do que está GRAVADO: 0,025 não persistiu.
    expect(blocoDeCusto()).toMatch(/R\$\s1,00/);
    expect(blocoDeCusto()).not.toMatch(/R\$\s2,50/);
    expect(vi.mocked(getFormulationCostEstimate)).toHaveBeenCalledTimes(1);
  });

  it("§54: com edição pendente o bloco se identifica como o último salvamento", async () => {
    await abrir();
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s1,00/));

    // Sem edição pendente não há o que desambiguar.
    expect(blocoDeCusto()).not.toMatch(/último salvamento/i);

    digitarQuantidade("0,025");

    await waitFor(() => expect(blocoDeCusto()).toMatch(/Custo do último salvamento/i));
    expect(blocoDeCusto()).toMatch(/Salve o rascunho para atualizar/i);
  });

  it("depois de salvar, o aviso de pendência sai — o número volta a ser o do estado atual", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s1,00/));

    digitarQuantidade("0,025");
    await waitFor(() => expect(blocoDeCusto()).toMatch(/último salvamento/i));

    vi.mocked(updateFormulationVersion).mockResolvedValue(versao(QTD_B));
    vi.mocked(getFormulationCostEstimate).mockResolvedValue(estimativa(QTD_B, CUSTO_B));
    await salvar(user);

    await waitFor(() => expect(blocoDeCusto()).toMatch(/R\$\s2,50/));
    expect(blocoDeCusto()).not.toMatch(/último salvamento/i);
  });
});
