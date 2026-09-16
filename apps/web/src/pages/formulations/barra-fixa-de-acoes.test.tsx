import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 2) — a BARRA FIXA de ações.
 *
 * As ações principais da versão moravam no fim do documento, depois do custo
 * estimado e das observações: quem editava a décima linha da receita não via
 * "Salvar rascunho" nem "Ativar versão" sem rolar a tela inteira. Agora elas
 * ficam numa barra que acompanha a rolagem.
 *
 * Três coisas importam aqui e nenhuma é decoração:
 *
 *   - as ações existem e continuam obedecendo a permissão, o estado da versão
 *     e o freio de clique duplo;
 *   - há UMA superfície: nem o topo nem o rodapé guardam uma segunda cópia;
 *   - a barra é o ÚLTIMO elemento do fluxo, então no fim da rolagem ela ocupa
 *     o lugar dela e não cobre a última linha do documento.
 *
 * "Salvar como modelo" mudou de LUGAR, não de contrato: o botão abre o mesmo
 * formulário de nome, na proveniência, com a mesma validação e o mesmo destino.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../lib/formulation-templates-api", () => ({
  applyTemplateToProduct: vi.fn(),
  compareFormulationWithTemplate: vi.fn(),
  createTemplateFromFormulation: vi.fn(),
  getTemplateUpdateAvailable: vi.fn(() => Promise.resolve(null)),
}));

let papel = "ADMIN";
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: papel } }) }));

import { getFormulationVersion, updateFormulationVersion } from "../../lib/formulations-api";
import { createTemplateFromFormulation } from "../../lib/formulation-templates-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

function componente(): FormulationComponentDTO {
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
    theoreticalPerUnit: null,
    physicalPerUnit: null,
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
  };
}

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Cafeína 60 cápsulas",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1000",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Cafeína 60 cápsulas",
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    ...overrides,
  } as FormulationVersionDTO;
}

async function abrir(dto: FormulationVersionDTO = versao()) {
  vi.mocked(getFormulationVersion).mockResolvedValue(dto);
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

const barra = () => document.querySelector(".sticky-action-bar") as HTMLElement;
const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });

beforeEach(() => {
  papel = "ADMIN";
  vi.clearAllMocks();
  vi.mocked(getFormulationVersion).mockResolvedValue(versao());
});

describe("Formulação — barra fixa de ações", () => {
  it("a barra reúne voltar, salvar como modelo, salvar rascunho e ativar", async () => {
    await abrir();

    const rodape = barra();
    expect(rodape).not.toBeNull();
    const inicio = rodape.querySelector(".sticky-action-bar__inicio") as HTMLElement;
    const fim = rodape.querySelector(".sticky-action-bar__fim") as HTMLElement;

    // Esquerda: sair e promover a receita a Modelo. Direita: gravar e ativar.
    expect(within(inicio).getByRole("link", { name: "← Voltar" })).toBeInTheDocument();
    expect(within(inicio).getByRole("button", { name: "Salvar como modelo" })).toBeInTheDocument();
    expect(within(fim).getByRole("button", { name: "Salvar rascunho" })).toBeInTheDocument();
    expect(within(fim).getByRole("button", { name: "Ativar versão" })).toBeInTheDocument();
  });

  it("uma superfície só: nada duplicado no topo nem no fim do documento", async () => {
    await abrir();

    for (const nome of ["Salvar rascunho", "Ativar versão", "Salvar como modelo"]) {
      expect(screen.getAllByRole("button", { name: nome })).toHaveLength(1);
    }
    expect(screen.getAllByRole("link", { name: "← Voltar" })).toHaveLength(1);
  });

  it("a barra é o ÚLTIMO bloco do fluxo — nada do documento fica atrás dela", async () => {
    await abrir();

    const corpo = document.querySelector(".doc-body") as HTMLElement;
    // `compareDocumentPosition`: a barra vem DEPOIS do corpo, então rolar até o
    // fim mostra a última seção acima dela em vez de sob ela.
    expect(corpo.compareDocumentPosition(barra()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // E o conteúdo final continua na tela: as observações são a última seção.
    expect(screen.getByLabelText("Notas técnicas")).toBeInTheDocument();
  });

  it("os dois lados da barra são grupos próprios — em tela estreita eles quebram, não somem", async () => {
    await abrir();

    const inicio = barra().querySelector(".sticky-action-bar__inicio") as HTMLElement;
    const fim = barra().querySelector(".sticky-action-bar__fim") as HTMLElement;
    // Cada ação mora num dos dois grupos: a quebra de linha reorganiza os
    // grupos, e nenhuma ação depende de caber na mesma linha que as outras.
    expect(within(inicio).getAllByRole("button").length).toBeGreaterThan(0);
    expect(within(fim).getAllByRole("button").length).toBeGreaterThan(0);
    expect(barra()).toHaveAttribute("role", "group");
    expect(barra()).toHaveAttribute("aria-label", "Ações da formulação");
  });

  it("o estado das ações continua o mesmo: freio de clique duplo e rótulo próprio", async () => {
    let gravar: (dto: FormulationVersionDTO) => void = () => {};
    vi.mocked(updateFormulationVersion).mockReturnValue(
      new Promise((resolve) => {
        gravar = resolve;
      }) as ReturnType<typeof updateFormulationVersion>,
    );
    await abrir();

    fireEvent.change(document.getElementById("version-basis") as HTMLInputElement, {
      target: { value: "2500" },
    });
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    // O vizinho recusa o clique, mas não rouba o rótulo.
    expect(botao("Ativar versão")).toBeDisabled();

    gravar(versao({ basisQuantity: "2500" }));
    await waitFor(() => expect(screen.getByText("Rascunho salvo.")).toBeInTheDocument());
  });

  it("versão ATIVA troca a ação primária, e não oferece salvar rascunho", async () => {
    await abrir(versao({ status: "ACTIVE" }));

    expect(botao("Criar nova versão")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ativar versão" })).toBeNull();
    expect(screen.getByRole("link", { name: "← Voltar" })).toBeInTheDocument();
  });

  it("quem não edita fórmula não ganha o Salvar como modelo na barra", async () => {
    papel = "COMMERCIAL";
    await abrir();

    expect(screen.queryByRole("button", { name: "Salvar como modelo" })).toBeNull();
    expect(screen.getByRole("link", { name: "← Voltar" })).toBeInTheDocument();
  });

  it("Salvar como modelo mudou de lugar, não de contrato", async () => {
    vi.mocked(createTemplateFromFormulation).mockResolvedValue({ id: "ft-novo" } as never);
    await abrir();

    fireEvent.click(botao("Salvar como modelo"));

    // O MESMO formulário de nome, com a mesma frase de que é cópia.
    expect(
      screen.getByText(/É uma cópia: esta formulação continua exatamente como está/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome do modelo"), {
      target: { value: "DEMO — Cafeína Base" },
    });
    fireEvent.click(botao("Criar modelo"));

    await waitFor(() =>
      expect(createTemplateFromFormulation).toHaveBeenCalledWith("fv-1", {
        name: "DEMO — Cafeína Base",
      }),
    );
    // Enquanto o formulário está aberto, o gatilho sai: uma ação, um lugar.
    expect(screen.queryByRole("button", { name: "Salvar como modelo" })).toBeNull();
  });
});
