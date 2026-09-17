import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * O físico enquanto se digita, e o modo que viaja junto com ele.
 *
 * Duas regras que se sustentam uma na outra:
 *
 * 1. A coluna do físico mostrava travessão até a versão ser salva. Quem estava
 *    decidindo a quantidade só via o efeito depois de gravar — descobrir o
 *    número errado depois de confirmar é descobrir tarde.
 *
 * 2. O modo do componente (`PHYSICAL_DIRECT` ou `THEORETICAL_WITH_ADJUSTMENTS`)
 *    precisa chegar ao servidor. Ele saía da tela e não entrava no payload, e o
 *    servidor então reaplicava o padrão: um componente marcado como teórico
 *    voltava a físico direto ao salvar qualquer outra edição, e a necessidade
 *    de material caía pelo fator de pureza. Ninguém veria — a tela mostra o que
 *    o servidor devolve.
 *
 * A prévia chama a MESMA função de `@veridi/shared` que a API chama. Não é uma
 * cópia sincronizada da fórmula: é a mesma função, e é por isso que os dois
 * números não podem divergir.
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
vi.mock("../../app/AuthProvider", () => ({ useOptionalAuth: () => null, useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion, updateFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

function componente(overrides: Partial<FormulationComponentDTO> = {}): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Ativo",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    // 220 g com pureza 98% dá 0,22449 kg físicos — número escolhido para a
    // diferença ser visível a olho, não perdida na sexta casa.
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
  /*
   * A prévia depende do catálogo de unidades, que chega por outra promessa.
   * Esperar pelo NÚMERO na célula seria esperar pelo que o teste quer provar —
   * e o caso da premissa faltando, cujo resultado certo é o travessão, ficaria
   * esperando para sempre. O sinal honesto é o catálogo ter chegado.
   */
  await waitFor(() =>
    expect(document.querySelectorAll("tbody tr select option").length).toBeGreaterThan(1),
  );
}

/**
 * Lê o equivalente ou o físico da linha do componente pelo elemento que os
 * carrega, não por texto: o mesmo número aparece duas vezes na linha — na
 * coluna e dentro do disclosure de ajustes — e buscar pelo texto acharia os
 * dois, provando menos do que parece.
 */
function celula(qual: "equivalente" | "fisico"): string {
  const alvo = document.querySelector(`tbody tr .estoque-valor--${qual}`);
  return (alvo?.textContent ?? "").trim();
}

function editarQuantidade(valor: string) {
  const campos = document.querySelectorAll<HTMLInputElement>("tbody tr input[inputmode]");
  const campo = Array.from(campos).find((c) => c.value === "220" || c.value === valor);
  if (!campo) throw new Error("Campo de quantidade não está na tela.");
  fireEvent.change(campo, { target: { value: valor } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateFormulationVersion).mockResolvedValue(versao());
});

describe("Prévia da quantidade física", () => {
  it("mostra o físico corrigido sem que nada tenha sido salvo", async () => {
    await abrir();

    // 220 g ÷ 0,98 = 224,489… g = 0,22449 kg.
    expect(celula("fisico")).toBe("0,22449 kg");
    // O teórico é o que foi digitado, convertido: 0,22 kg.
    expect(celula("equivalente")).toBe("0,22 kg");
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("recalcula a cada tecla, não só ao salvar", async () => {
    await abrir();

    editarQuantidade("440");

    await waitFor(() => expect(celula("fisico")).toBe("0,44898 kg"));
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("apagar a pureza na coluna muda o número na tela, sem salvar", async () => {
    await abrir();
    expect(celula("fisico")).toBe("0,22449 kg");

    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000003" }), {
      target: { value: "" },
    });

    // Sem pureza não há correção, e o físico é o digitado: 220 g = 0,22 kg.
    await waitFor(() => expect(celula("fisico")).toBe("0,22 kg"));
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });

  it("premissa faltando não vira zero", async () => {
    // `PER_DOSE` sem doses por embalagem é conta impossível. Zero seria uma
    // resposta plausível e errada — "não precisa de material".
    await abrir(
      versao({
        calculationMode: "PER_DOSE",
        components: [componente({ basis: "PER_DOSE" })],
        dosesPerPackage: null,
      }),
    );

    expect(celula("fisico")).toBe("—");
    expect(celula("equivalente")).toBe("—");
  });
});

describe("O modo do componente chega ao servidor", () => {
  it("o modo e as flags viajam no payload de gravação", async () => {
    const user = userEvent.setup();
    await abrir();

    editarQuantidade("300");
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalled());
    expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledWith(
      "fv-1",
      expect.objectContaining({
        components: [
          expect.objectContaining({
            quantity: "300",
            quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
            applyPurityAdjustment: true,
            applyOverageAdjustment: false,
          }),
        ],
      }),
    );
  });

  it("a coluna Pureza é o que decide o modo que o servidor recebe", async () => {
    const user = userEvent.setup();
    await abrir();

    /*
     * Sem pureza não há o que corrigir, e o modo do componente acompanha: a
     * pessoa não escolhe `PHYSICAL_DIRECT` num seletor escondido, ela apaga o
     * número que não conhece. A quantidade informada passa a ser a física.
     */
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000003" }), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    await waitFor(() => expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalled());
    expect(vi.mocked(updateFormulationVersion)).toHaveBeenCalledWith(
      "fv-1",
      expect.objectContaining({
        components: [
          expect.objectContaining({
            quantityMode: "PHYSICAL_DIRECT",
            applyPurityAdjustment: false,
            purityPercentApplied: null,
          }),
        ],
      }),
    );
  });
});

describe("A coluna Pureza não mente sobre o que está ligado", () => {
  it("rascunho legado com pureza registrada passa a corrigir, e a tela diz", async () => {
    /*
     * O caso legado: pureza gravada com o modo físico direto. Sob o contrato
     * antigo isso era "registrada, não aplicada"; sob o da bancada a coluna
     * preenchida corrige. A conversão é o que a tela mostra — e ela avisa que
     * o número desta linha mudou, porque mudou material.
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
    // E nenhum vocabulário de autorização sobrou na linha do rascunho.
    expect(screen.queryByText("registrada, não aplicada")).toBeNull();
  });

  it("a pureza trocada acompanha o número na hora, sem confirmar nada", async () => {
    await abrir();

    fireEvent.change(screen.getByRole("textbox", { name: "Pureza de MP-000003" }), {
      target: { value: "50" },
    });

    await waitFor(() => expect(celula("fisico")).toBe("0,44 kg"));
    expect(document.querySelector("tr.ajuste-quantidade__linha")).toBeNull();
  });

  it("a conta do físico por embalagem fica na própria célula do número", async () => {
    await abrir();

    /*
     * A explicação vivia dentro do painel de ajustes. Longe do resultado ela
     * obriga a confiar no número em vez de conferi-lo: agora mora na célula
     * que o mostra.
     */
    const porEmbalagem = document
      .querySelector("tbody tr .estoque-valor--fisico")!
      .closest("td")!;
    const explicacao = porEmbalagem.querySelector("button");
    expect(explicacao).not.toBeNull();
    expect(explicacao!.getAttribute("aria-label")).toContain("Quantidade física");
    expect(porEmbalagem.textContent).toContain("0,22449 kg");
  });
});

describe("Erro de decimal aponta a linha", () => {
  it("a mensagem diz qual componente tem o valor inválido", async () => {
    const user = userEvent.setup();
    await abrir();

    // A pureza é coluna da linha: não precisa abrir painel nenhum para errá-la.
    const pureza = screen.getByRole("textbox", { name: /^Pureza de / });
    fireEvent.change(pureza, { target: { value: "1.234" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));

    /*
     * "Pureza %: informe um valor válido" numa receita de doze linhas manda
     * conferir doze linhas — e se o painel da linha estiver fechado, não há
     * pista de onde procurar. O código do item é como a pessoa acha a linha.
     */
    await waitFor(() =>
      expect(screen.getByText(/MP-000003 — Pureza %/)).toBeInTheDocument(),
    );
    expect(vi.mocked(updateFormulationVersion)).not.toHaveBeenCalled();
  });
});
