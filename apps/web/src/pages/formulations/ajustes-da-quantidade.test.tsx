import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * FORMULATION-WORKBENCH-01 (homologação) — o painel de ajustes saiu da
 * Formulação.
 *
 * Pureza e reserva de produção são COLUNAS da linha de matéria-prima. A pureza
 * informada corrige a quantidade física na hora, sem modo para escolher nem
 * caixa para marcar; a reserva fica registrada para o lote e nunca multiplica a
 * dose. "Overage" não é palavra desta tela.
 *
 * `resumoDosAjustes` continua testada aqui porque continua viva — quem a usa
 * agora é o Modelo de Formulação, que mantém o painel.
 *
 * E as duas grandezas por embalagem, equivalente e físico, seguem na mesma
 * célula, sob o cabeçalho que diz de que embalagem se fala.
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
  // As unidades chegam depois da versao: so o rascunho tem seletor na linha,
  // e a versao fechada e' so leitura.
  if (dto.status === "DRAFT") {
    await waitFor(() =>
      expect(document.querySelectorAll("tbody tr select option").length).toBeGreaterThan(1),
    );
  }
}

/** Valor de uma das duas colunas da linha do componente, pelo elemento que o carrega. */
function celula(qual: "equivalente" | "fisico"): string {
  return (document.querySelector(`tbody tr .estoque-valor--${qual}`)?.textContent ?? "").trim();
}

const painel = () => document.querySelector("tr.ajuste-quantidade__linha");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateFormulationVersion).mockResolvedValue(versao());
  vi.mocked(activateFormulationVersion).mockResolvedValue(versao({ status: "ACTIVE" }));
});

describe("Pureza e reserva de produção — colunas da linha", () => {
  it("o painel de ajustes não existe mais na Formulação", async () => {
    await abrir();

    /*
     * A homologação da bancada tirou daqui o expansível "O que a quantidade
     * informada significa". Ele não foi escondido: não há botão de linha, nem
     * linha de painel, nem modo para escolher, nem caixa para marcar, nem
     * "Aplicar ajustes" a confirmar. O que a pureza faz está na coluna.
     */
    expect(painel()).toBeNull();
    expect(screen.queryByRole("button", { name: /Calculada/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Física informada/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar ajustes" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Quantidade física informada" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Corrigir pela pureza" })).toBeNull();
    expect(screen.queryByText(/O que a quantidade informada significa/)).toBeNull();
  });

  it("o termo Overage não aparece na tela — é Reserva de produção", async () => {
    await abrir();

    expect(document.body.textContent ?? "").not.toMatch(/overage/i);
    expect(
      screen.getByRole("textbox", { name: "Reserva de produção de MP-000003" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Reserva de produção/ })).toBeInTheDocument();
  });

  it("pureza digitada na coluna corrige a quantidade física na hora", async () => {
    await abrir();
    expect(celula("fisico")).toBe("0,22449 kg");

    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000003" }), {
      target: { value: "50" },
    });

    // 220 g ÷ 0,50 = 0,44 kg. Sem painel, sem marca, sem confirmar.
    await waitFor(() => expect(celula("fisico")).toBe("0,44 kg"));
    expect(painel()).toBeNull();
  });

  it("pureza apagada devolve a quantidade informada — vazio não é 100% nem 0%", async () => {
    await abrir();

    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000003" }), {
      target: { value: "" },
    });

    await waitFor(() => expect(celula("fisico")).toBe("0,22 kg"));
    expect(celula("equivalente")).toBe("0,22 kg");
  });

  it("reserva de produção NÃO altera a quantidade física", async () => {
    await abrir();
    const antes = celula("fisico");

    fireEvent.change(screen.getByRole("textbox", { name: "Reserva de produção de MP-000003" }), {
      target: { value: "10" },
    });

    // O número tem de continuar o MESMO: a reserva é previsão de lote, e
    // multiplicá-la pela dose inflaria a receita em silêncio.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Reserva de produção de MP-000003" })).toHaveValue(
        "10",
      ),
    );
    expect(celula("fisico")).toBe(antes);
    expect(celula("fisico")).toBe("0,22449 kg");
  });

  it("o servidor recebe a pureza aplicada e a reserva apenas registrada", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(screen.getByRole("textbox", { name: "Reserva de produção de MP-000003" }), {
      target: { value: "10" },
    });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalled());
    expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledWith(
      "fv-1",
      expect.objectContaining({
        components: [
          expect.objectContaining({
            quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
            applyPurityAdjustment: true,
            applyOverageAdjustment: false,
            purityPercentApplied: "98",
            overagePercent: "10",
          }),
        ],
      }),
    );
  });

  it("salvar não exige mais aplicar ajuste nenhum antes", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000003" }), {
      target: { value: "70" },
    });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Aplique ou cancele os ajustes/)).toBeNull();
  });

  it("rascunho do contrato antigo entra corrigido, e a tela diz qual linha mudou", async () => {
    /*
     * A versão herdada guarda pureza SEM a correção ligada — estado que o
     * contrato de hoje não produz mais. Abrir o rascunho passa a aplicá-la, e
     * isso muda material: a tela avisa em vez de deixar a diferença aparecer
     * só depois de salvar.
     */
    await abrir(
      versao({
        components: [componente({ quantityMode: "PHYSICAL_DIRECT", applyPurityAdjustment: false })],
      }),
    );

    await waitFor(() => expect(celula("fisico")).toBe("0,22449 kg"));
    expect(
      screen.getByText(/a pureza de MP-000003 estava gravada sem corrigir/i),
    ).toBeInTheDocument();
  });

  it("versão ATIVA é documento fechado: pureza registrada e não aplicada continua dizendo isso", async () => {
    await abrir(
      versao({
        status: "ACTIVE",
        components: [
          componente({
            quantityMode: "PHYSICAL_DIRECT",
            applyPurityAdjustment: false,
            theoreticalPerUnit: "0.22",
            physicalPerUnit: "0.22",
          }),
        ],
      }),
    );

    expect(celula("fisico")).toBe("0,22 kg");
    expect(screen.getByText("registrada, não aplicada")).toBeInTheDocument();
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

describe("Coluna Por embalagem — físico e equivalente na mesma célula", () => {
  it("os dois números ficam sob o mesmo cabeçalho, alinhados à direita", async () => {
    await abrir();

    /*
     * A bancada trouxe as grandezas por DOSE e por CÁPSULA para a linha
     * (FORMULATION-WORKBENCH-01), e o par equivalente/físico por embalagem
     * passou a dividir uma célula: continuam nomeados e juntos, sob o cabeçalho
     * que diz de que embalagem se fala.
     */
    const tabela = document.querySelector("table.table--formulacao")!;
    const cabecalhos = Array.from(tabela.querySelectorAll("thead th")).map(
      (th) => th.textContent?.trim() ?? "",
    );
    const porEmbalagem = cabecalhos.findIndex((texto) => texto.startsWith("Por embalagem"));
    expect(porEmbalagem).toBeGreaterThan(-1);

    const celulas = tabela.querySelectorAll("tbody tr:first-child > td");
    const doEstoque = celulas[porEmbalagem]!;
    expect(doEstoque.querySelector(".estoque-valor--fisico")?.textContent).toBe("0,22449 kg");
    expect(doEstoque.querySelector(".estoque-valor--equivalente")?.textContent).toBe("0,22 kg");
    expect(doEstoque.classList.contains("is-numeric")).toBe(true);
  });

  it("em tela estreita cada valor técnico leva o seu rótulo, para virar cartão", async () => {
    await abrir();

    const linha = document.querySelector("table.table--formulacao tbody tr")!;
    const rotulos = Array.from(linha.querySelectorAll("td[data-label]")).map((td) =>
      td.getAttribute("data-label"),
    );
    expect(rotulos).toEqual([
      "Fonte / Função",
      "Pureza",
      "Alvo por dose",
      "Física por dose",
      "Base · Fornecimento",
      "Reserva de produção",
      "Por embalagem",
    ]);
  });
});
