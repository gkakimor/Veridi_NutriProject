import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * FORMULATION-ADJUSTMENTS-UX-01 — o painel de ajustes ganhou um fim.
 *
 * Mexer no modo, na pureza, no overage e nas marcas mexe num RASCUNHO da
 * linha. "Aplicar ajustes" confirma — a linha muda, a conta segue e o painel
 * recolhe com um resumo —; "Cancelar" descarta só o que foi mexido desde que
 * o painel abriu. Nada disso salva a versão, e nada disso se perde em
 * silêncio: fechar, salvar ou ativar com alteração aberta é recusado com a
 * linha nomeada.
 *
 * E as duas grandezas da linha, "Equivalente estoque" e "Físico / unidade",
 * moram cada uma na SUA coluna, sob o seu cabeçalho.
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
    Promise.resolve([
      { code: "g", label: "grama", dimension: "MASS", toBaseFactor: "0.001" },
      { code: "kg", label: "quilograma", dimension: "MASS", toBaseFactor: "1" },
    ]),
}));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import {
  activateFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";
import { resumoDosAjustes } from "./AjustesDaQuantidade";

function componente(overrides: Partial<FormulationComponentDTO> = {}): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Ativo",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    // 220 g ÷ 0,98 = 0,22449 kg: a diferença do ajuste aparece a olho.
    quantity: "220",
    unitCode: "g",
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: "98",
    overagePercent: null,
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
    applyPurityAdjustment: true,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    stockUnitCode: "kg",
    notes: null,
    position: 0,
    ...overrides,
  } as FormulationComponentDTO;
}

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Produto de teste",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Produto de teste",
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

async function abrir(dto = versao()) {
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
  await waitFor(() =>
    expect(document.querySelectorAll("tbody tr select option").length).toBeGreaterThan(1),
  );
}

/** Valor de uma das duas colunas da linha do componente, pelo elemento que o carrega. */
function celula(qual: "equivalente" | "fisico"): string {
  return (document.querySelector(`tbody tr .estoque-valor--${qual}`)?.textContent ?? "").trim();
}

const painel = () => document.querySelector("tr.ajuste-quantidade__linha");
const aplicar = () => screen.getByRole("button", { name: "Aplicar ajustes" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateFormulationVersion).mockResolvedValue(versao());
  vi.mocked(activateFormulationVersion).mockResolvedValue(versao({ status: "ACTIVE" }));
});

describe("Painel de ajustes — rascunho, Aplicar e Cancelar", () => {
  it("editar o rascunho não muda a linha; Aplicar confirma, recolhe e resume", async () => {
    const user = userEvent.setup();
    await abrir();
    expect(screen.getByRole("button", { name: /Calculada · Pureza 98%/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Calculada · Pureza 98%/ }));
    await user.click(screen.getByRole("radio", { name: "Quantidade física informada" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Overage do componente" }), {
      target: { value: "2" },
    });

    // Rascunho: a linha e o resumo continuam os de antes.
    expect(celula("fisico")).toBe("0,22449 kg");
    expect(screen.getByRole("button", { name: /Calculada · Pureza 98%/ })).toBeInTheDocument();

    await user.click(aplicar());

    await waitFor(() => expect(celula("fisico")).toBe("0,22 kg"));
    expect(painel()).toBeNull();
    // Percentuais em física informada são registro — e o resumo diz isso.
    expect(
      screen.getByRole("button", { name: /Física informada · Pureza 98% · Overage 2% · só registro/ }),
    ).toBeInTheDocument();
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("Cancelar descarta só o que mudou desde que o painel abriu", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: /Calculada/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "95" },
    });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(painel()).toBeNull();
    expect(celula("fisico")).toBe("0,22449 kg");

    // Reaberto, o painel parte do que a linha tem — não do que foi cancelado.
    await user.click(screen.getByRole("button", { name: /Calculada/ }));
    expect(screen.getByRole("textbox", { name: "Pureza aplicada" })).toHaveValue("98");
  });

  it("Aplicar fica desabilitado sem alteração e com valor inválido", async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole("button", { name: /Calculada/ }));

    expect(aplicar()).toBeDisabled();

    const pureza = screen.getByRole("textbox", { name: "Pureza aplicada" });
    fireEvent.change(pureza, { target: { value: "abc" } });
    expect(aplicar()).toBeDisabled();
    expect(pureza).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/MP-000003 — Pureza %/)).toBeInTheDocument();

    fireEvent.change(pureza, { target: { value: "97" } });
    expect(aplicar()).toBeEnabled();
  });

  it("fechar pelo botão da linha com alteração aberta não descarta: o painel fica e avisa", async () => {
    const user = userEvent.setup();
    await abrir();
    const botaoDaLinha = screen.getByRole("button", { name: /Calculada/ });
    await user.click(botaoDaLinha);
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "95" },
    });

    await user.click(botaoDaLinha);

    expect(painel()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Há ajustes não aplicados nesta linha/);
    expect(screen.getByRole("textbox", { name: "Pureza aplicada" })).toHaveValue("95");
  });

  it("salvar com ajuste por aplicar é recusado e diz qual linha", async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole("button", { name: /Calculada/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "95" },
    });

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    expect(
      screen.getByText("Aplique ou cancele os ajustes de MP-000003 antes de salvar."),
    ).toBeInTheDocument();
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(aplicar()));
  });

  it("ativar com ajuste por aplicar também é recusado", async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole("button", { name: /Calculada/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "95" },
    });

    await user.click(screen.getByRole("button", { name: /Ativar versão/ }));

    expect(
      screen.getByText("Aplique ou cancele os ajustes de MP-000003 antes de ativar."),
    ).toBeInTheDocument();
    expect(vi.mocked(activateFormulationVersion)).not.toHaveBeenCalled();
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("aplicado e salvo, o servidor recebe a configuração normalizada", async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole("button", { name: /Calculada/ }));
    await user.click(screen.getByRole("checkbox", { name: "Aplicar overage" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Overage do componente" }), {
      target: { value: "2" },
    });
    await user.click(aplicar());
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalled());
    expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledWith(
      "fv-1",
      expect.objectContaining({
        components: [
          expect.objectContaining({
            quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
            applyPurityAdjustment: true,
            applyOverageAdjustment: true,
            purityPercentApplied: "98",
            overagePercent: "2",
          }),
        ],
      }),
    );
  });

  it("o painel serve para configurar: não repete a quantidade que a linha já mostra", async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole("button", { name: /Calculada/ }));

    expect(screen.queryByText(/Quantidade informada:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quantidade física por unidade:/)).not.toBeInTheDocument();
  });
});

describe("Resumo dos ajustes na linha", () => {
  const base = {
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS" as const,
    purityPercentApplied: "98",
    overagePercent: "2",
    applyPurityAdjustment: true,
    applyOverageAdjustment: true,
  };

  it("calculada com os dois ajustes", () => {
    expect(resumoDosAjustes(base)).toBe("Calculada · Pureza 98% · Overage 2%");
  });

  it("física informada: os percentuais são só registro", () => {
    expect(resumoDosAjustes({ ...base, quantityMode: "PHYSICAL_DIRECT" })).toBe(
      "Física informada · Pureza 98% · Overage 2% · só registro",
    );
  });

  it("marca desligada não se apresenta como aplicada", () => {
    expect(resumoDosAjustes({ ...base, applyOverageAdjustment: false })).toBe(
      "Calculada · Pureza 98% · Overage 2% não aplicado",
    );
  });

  it("calculada sem nada marcado não afirma correção", () => {
    expect(
      resumoDosAjustes({
        ...base,
        purityPercentApplied: "",
        overagePercent: "",
        applyPurityAdjustment: false,
        applyOverageAdjustment: false,
      }),
    ).toBe("Calculada · nenhum ajuste marcado");
  });

  it("pureza vazia não vira 0% nem 100%", () => {
    expect(resumoDosAjustes({ ...base, purityPercentApplied: "" })).toBe(
      "Calculada · Pureza não informada · Overage 2%",
    );
  });
});

describe("Colunas Equivalente estoque e Físico / unidade", () => {
  it("cada valor fica na sua coluna, sob o seu cabeçalho, alinhado à direita", async () => {
    await abrir();

    const cabecalhos = Array.from(document.querySelectorAll("thead th")).map(
      (th) => th.textContent?.trim() ?? "",
    );
    const equivalente = cabecalhos.findIndex((texto) => texto.startsWith("Equivalente estoque"));
    const fisico = cabecalhos.findIndex((texto) => texto.startsWith("Físico / unidade"));
    expect(equivalente).toBeGreaterThan(-1);
    expect(fisico).toBe(equivalente + 1);

    const celulas = document.querySelectorAll("tbody tr:first-child > td");
    expect(celulas[equivalente]!.querySelector(".estoque-valor--equivalente")?.textContent).toBe(
      "0,22 kg",
    );
    expect(celulas[fisico]!.querySelector(".estoque-valor--fisico")?.textContent).toBe(
      "0,22449 kg",
    );
    expect(celulas[equivalente]!.classList.contains("is-numeric")).toBe(true);
    expect(celulas[fisico]!.classList.contains("is-numeric")).toBe(true);
  });

  it("em tela estreita cada valor técnico leva o seu rótulo, para virar cartão", async () => {
    await abrir();

    const linha = document.querySelector("tbody tr")!;
    const rotulos = Array.from(linha.querySelectorAll("td[data-label]")).map((td) =>
      td.getAttribute("data-label"),
    );
    expect(rotulos).toEqual([
      "Base",
      "Fornecimento",
      "Quantidade · unidade",
      "Ajustes",
      "Equivalente estoque",
      "Físico / unidade",
    ]);
  });
});
