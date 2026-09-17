import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * Formulação com os campos numéricos pt-BR — PTBR-NUMERIC-INPUT-ROLLOUT-01.
 *
 * A tela de maior precisão do produto: base e quantidade com as doze casas da
 * coluna, pureza com seis, doses por embalagem inteiro. O que se fixa aqui é o
 * caminho inteiro de cada família — carga da API em português, digitação e
 * colagem pela regra do campo, pendência pelo VALOR, e o pedido à API com a
 * representação canônica de sempre.
 *
 * FORMULATION-DOSES-INPUT-01: doses era texto cru no envio e `Number()` na
 * prévia (`1e2` gravava 100). Agora é `IntegerField` com leitura estrita.
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
      { code: "mg", label: "miligrama", dimension: "MASS", toBaseFactor: "0.000001" },
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


function componente(overrides: Partial<FormulationComponentDTO> = {}): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "0.000000000001",
    unitCode: "mg",
    basis: "PER_DOSE",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: "99.9995",
    overagePercent: null,
    // Contrato da bancada: pureza preenchida corrige. Uma versão gravada com
    // pureza e sem a correção ligada seria rascunho do contrato ANTIGO, e a
    // tela o normaliza ao abrir — aqui o assunto é outro: a representação.
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
    productName: "Cafeína 60 cápsulas",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    // Canônico da API, com ponto — `1.234`-like não pode virar ambíguo na carga.
    basisQuantity: "250.5",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: 60,
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

const base = () => document.getElementById("version-basis") as HTMLInputElement;
const doses = () => screen.getByLabelText(/Doses por embalagem/, CAMPO_DO_FORMULARIO) as HTMLInputElement;
const quantidade = () =>
  screen.getByRole("textbox", { name: "Quantidade de MP-000003" }) as HTMLInputElement;
const pendente = () => screen.queryByText("Alterações não salvas");

async function salvar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Salvar rascunho/i }));
}

function enviado() {
  const [, payload] = vi.mocked(updateFormulationVersion).mock.calls.at(-1)!;
  return payload as {
    basisQuantity: string;
    dosesPerPackage: string | null;
    components: { quantity: string; purityPercentApplied: string | null }[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateFormulationVersion).mockResolvedValue(versao());
});

describe("Formulação — carga, pendência e envio sem mudar a representação", () => {
  it("o valor da API aparece em português e não é pendência — nem ao passar pelo campo", async () => {
    await abrir();

    expect(base().value).toBe("250,5");
    expect(quantidade().value).toBe("0,000000000001");
    expect(doses().value).toBe("60");
    expect(pendente()).toBeNull();

    // Servidor "250.5", campo "250,5": entrar e sair normaliza o texto, sem pendência.
    fireEvent.focus(base());
    fireEvent.blur(base());
    fireEvent.focus(quantidade());
    fireEvent.blur(quantidade());
    expect(pendente()).toBeNull();
  });

  it("salvar sem editar devolve à API exatamente a precisão que ela mandou", async () => {
    const user = userEvent.setup();
    await abrir();

    await salvar(user);

    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().basisQuantity).toBe("250.5");
    expect(enviado().dosesPerPackage).toBe("60");
    expect(enviado().components[0]).toMatchObject({
      quantity: "0.000000000001",
      purityPercentApplied: "99.9995",
    });
  });

  it("1.234 da API é um vírgula duzentos e trinta e quatro: carrega 1,234, sem ambiguidade", async () => {
    const user = userEvent.setup();
    // `Decimal.toString` da API tira os zeros: 1,234 g chega como "1.234".
    await abrir(versao({ components: [componente({ quantity: "1.234", unitCode: "g" })] }));

    expect(quantidade().value).toBe("1,234");
    expect(quantidade()).not.toHaveAttribute("aria-invalid");
    expect(pendente()).toBeNull();

    await salvar(user);
    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().components[0]?.quantity).toBe("1.234");
  });

  it("250,50 sobre 250,5 gravado é o mesmo valor: nada pendente", async () => {
    await abrir();

    fireEvent.change(base(), { target: { value: "250,50" } });

    expect(pendente()).toBeNull();
  });
});

describe("Formulação — alta precisão: base e quantidade com doze casas", () => {
  it("a 13ª casa não entra; 1.234,567890123456 vai como 1234.567890123456", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(quantidade(), { target: { value: "0,0000000000001" } });
    expect(quantidade().value).toBe("0,000000000001");

    fireEvent.change(quantidade(), { target: { value: "1.234,567890123456" } });
    expect(pendente()).not.toBeNull();
    await salvar(user);

    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    // Nada passou por `Number`: as doze casas chegam inteiras.
    expect(enviado().components[0]?.quantity).toBe("1234.567890123456");
  });

  it("colar 1.234,56 na base dá 1234,56 e o envio canônico 1234.56", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "" } });
    await user.click(base());
    await user.paste("1.234,56");
    expect(base().value).toBe("1234,56");

    await salvar(user);
    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().basisQuantity).toBe("1234.56");
  });

  it("letra não entra na base; zero continua zero; vazio não vira zero e não sai", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.clear(base());
    await user.type(base(), "a0");
    expect(base()).toHaveValue("0");
    await salvar(user);
    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().basisQuantity).toBe("0");

    fireEvent.change(base(), { target: { value: "" } });
    await salvar(user);
    expect(await screen.findByText("Base da formulação é obrigatória.")).toBeInTheDocument();
    expect(updateFormulationVersion).toHaveBeenCalledTimes(1);
  });
});

describe("Formulação — doses por embalagem, inteiro (FORMULATION-DOSES-INPUT-01)", () => {
  it("1e2 não entra como número: o e é recusado e fica 12", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.clear(doses());
    await user.type(doses(), "1e2");
    expect(doses()).toHaveValue("12");

    await salvar(user);
    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().dosesPerPackage).toBe("12");
  });

  it("vírgula não entra; colar 1.234 dá o inteiro 1234, enviado como sempre foi (texto)", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(doses(), { target: { value: "60,5" } });
    expect(doses()).toHaveValue("60");

    fireEvent.change(doses(), { target: { value: "" } });
    await user.click(doses());
    await user.paste("1.234");
    await salvar(user);

    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().dosesPerPackage).toBe("1234");
  });

  it("apagar é limpar: vai null, nunca zero", async () => {
    const user = userEvent.setup();
    await abrir(versao({ components: [componente({ basis: "FIXED_BASIS" })] }));

    fireEvent.change(doses(), { target: { value: "" } });
    await salvar(user);

    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().dosesPerPackage).toBeNull();
  });
});

describe("Formulação — percentual técnico com seis casas", () => {
  it("pureza: a 7ª casa não entra; 12,5 é doze e meio por cento, nunca 0,125", async () => {
    const user = userEvent.setup();
    await abrir();

    // A pureza é coluna da linha desde FORMULATION-WORKBENCH-01: o campo está à
    // vista, e o que ele recusa continua sendo o mesmo.
    const pureza = screen.getByRole("textbox", {
      name: "Pureza de MP-000003",
    }) as HTMLInputElement;

    fireEvent.change(pureza, { target: { value: "99,9999999" } });
    expect(pureza.value).not.toBe("99,9999999");

    fireEvent.change(pureza, { target: { value: "12,5" } });
    await salvar(user);

    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalledTimes(1));
    expect(enviado().components[0]?.purityPercentApplied).toBe("12.5");
  });
});
