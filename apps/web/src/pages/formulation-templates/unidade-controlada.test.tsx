import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
  ItemDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";

/**
 * Unidade controlada no Modelo de Formulação — FORM-UOM-01.
 *
 * A Formulação real escolhe a unidade numa lista do catálogo, filtrada pela
 * dimensão do Item; o Modelo deixava digitar qualquer texto, na base e no
 * componente. Estes casos são o Modelo alcançando a Formulação: a unidade vem
 * do catálogo `UnitOfMeasure`, o componente só oferece as unidades da dimensão
 * do seu Item, e o que já estava gravado fora disso aparece como tal — nunca
 * trocado em silêncio.
 */

const getFormulationTemplate = vi.fn();
const updateFormulationTemplateVersion = vi.fn();
const listItems = vi.fn();
const getItem = vi.fn();
const listUnits = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  updateFormulationTemplateVersion: (...a: unknown[]) => updateFormulationTemplateVersion(...a),
  activateFormulationTemplateVersion: vi.fn(),
  compareTemplateVersions: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  updateFormulationTemplate: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: (...a: unknown[]) => listItems(...a),
  getItem: (...a: unknown[]) => getItem(...a),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: (...a: unknown[]) => listUnits(...a) }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => vi.fn(), useParams: () => ({ templateId: "ft-1" }) };
});

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";

/** O catálogo das fixtures — o teste lê as dimensões daqui, não de uma lista fixa. */
const CATALOGO: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  { code: "cx", label: "Caixa", dimension: "COUNT", toBaseFactor: "1" },
  { code: "L", label: "Litro", dimension: "VOLUME", toBaseFactor: "1000" },
];
const daDimensao = (dimensao: string) =>
  CATALOGO.filter((unit) => unit.dimension === dimensao).map((unit) => unit.code);

function item(id: string, code: string, name: string, unitCode: string): ItemDTO {
  const unit = CATALOGO.find((candidata) => candidata.code === unitCode);
  return { id, code, name, type: "RAW_MATERIAL", unitCode, unit, active: true } as ItemDTO;
}
const VITAMINA = item("i-vit", "MP-000010", "Vitamina C", "kg");
const ZINCO = item("i-zin", "MP-000011", "Zinco", "g");
const CAPSULA = item("i-cap", "EMB-000001", "Cápsula", "un");

function componente(de: ItemDTO, unitCode: string, quantity = "1"): FormulationTemplateComponentDTO {
  return {
    id: `c-${de.id}`,
    itemId: de.id,
    itemCode: de.code,
    itemName: de.name,
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity,
    unitCode,
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    notes: null,
    position: 0,
  } as FormulationTemplateComponentDTO;
}

function comRascunho(componentes: FormulationTemplateComponentDTO[] = []): FormulationTemplateDTO {
  const rascunho = {
    id: "ftv-1",
    formulationTemplateId: "ft-1",
    templateCode: "FT-000001",
    templateName: "Modelo",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputUnitCode: "un",
    notes: null,
    components: componentes,
    createdAt: "2026-09-10T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
  } as FormulationTemplateVersionDTO;
  return {
    id: "ft-1",
    code: "FT-000001",
    name: "Modelo",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: [rascunho],
    createdAt: "2026-09-10T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-10T00:00:00.000Z",
  } as FormulationTemplateDTO;
}

async function abrir(template: FormulationTemplateDTO) {
  getFormulationTemplate.mockResolvedValue(template);
  render(
    <MemoryRouter>
      <FormulationTemplateDetailPage />
    </MemoryRouter>,
  );
  await screen.findByText(/Rascunho — V1/);
  await waitFor(() => expect(listUnits).toHaveBeenCalled());
}

function opcoes(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((opcao) => (opcao as HTMLOptionElement).value);
}

function valor(elemento: HTMLElement): string {
  return (elemento as HTMLSelectElement | HTMLInputElement).value;
}

/**
 * Escolhe o Item da linha pelo seletor da própria tela. O campo de Item é o
 * único `<input>` com papel de combobox — base, unidade e fornecimento são
 * `<select>` —, e depois da primeira escolha o placeholder vira o rótulo do
 * Item, então é pelo papel que ele se acha.
 */
async function escolherItem(linha: number, termo: string, nome: RegExp) {
  const campo = screen
    .getAllByRole("combobox")
    .filter((elemento) => elemento.tagName === "INPUT")[linha];
  if (!campo) throw new Error(`linha ${linha} sem campo de Item`);
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  // A lista local e o resultado da busca no servidor podem trazer o mesmo Item.
  const [opcao] = await screen.findAllByRole("option", { name: nome });
  if (!opcao) throw new Error(`sem opção para ${termo}`);
  fireEvent.mouseDown(opcao);
}

function salvarRascunho() {
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
}

function componentesEnviados() {
  const [, input] = updateFormulationTemplateVersion.mock.calls[0] ?? [];
  return (input as { components: Record<string, unknown>[] }).components;
}

beforeEach(() => {
  vi.clearAllMocks();
  listUnits.mockResolvedValue(CATALOGO);
  listItems.mockResolvedValue({ items: [VITAMINA, ZINCO, CAPSULA] });
  getItem.mockImplementation(async (id: string) =>
    [VITAMINA, ZINCO, CAPSULA].find((candidato) => candidato.id === id),
  );
  updateFormulationTemplateVersion.mockResolvedValue({});
});

describe("FORM-UOM-01 — unidade da base", () => {
  it("é uma escolha do catálogo, não uma caixa de texto — e salvar manda o código escolhido", async () => {
    await abrir(comRascunho());

    const base = screen.getByRole("combobox", { name: "Unidade da base" });
    expect(base.tagName).toBe("SELECT");
    expect(screen.queryByRole("textbox", { name: "Unidade da base" })).toBeNull();
    await waitFor(() => expect(opcoes(base)).toEqual(CATALOGO.map((unit) => unit.code)));
    expect(valor(base)).toBe("un");

    fireEvent.change(base, { target: { value: "kg" } });
    salvarRascunho();

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    expect(updateFormulationTemplateVersion).toHaveBeenCalledWith(
      "ftv-1",
      expect.objectContaining({ outputUnitCode: "kg" }),
    );
  });
});

describe("FORM-UOM-01 — unidade do componente", () => {
  it("sem Item escolhido, a unidade fica indisponível", async () => {
    await abrir(comRascunho());

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar componente" }));

    const unidade = screen.getByRole("combobox", { name: "Unidade" });
    expect(unidade.tagName).toBe("SELECT");
    expect(unidade).toBeDisabled();
    expect(valor(unidade)).toBe("");
  });

  it("escolher o Item traz a unidade dele, e a lista só tem a dimensão dele", async () => {
    await abrir(comRascunho());
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar componente" }));

    await escolherItem(0, "Vitamina", /Vitamina C/);

    const unidade = await screen.findByRole("combobox", { name: "Unidade de MP-000010" });
    expect(unidade).toBeEnabled();
    expect(valor(unidade)).toBe("kg");
    expect(opcoes(unidade).filter(Boolean)).toEqual(daDimensao("MASS"));
  });

  it("outra unidade da mesma dimensão salva com o código do catálogo", async () => {
    await abrir(comRascunho());
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar componente" }));
    await escolherItem(0, "Vitamina", /Vitamina C/);
    const unidade = await screen.findByRole("combobox", { name: "Unidade de MP-000010" });

    fireEvent.change(unidade, { target: { value: "g" } });
    const linha = unidade.closest("tr");
    if (!linha) throw new Error("unidade fora da linha");
    fireEvent.change(within(linha).getByRole("textbox"), { target: { value: "0,5" } });
    salvarRascunho();

    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    expect(componentesEnviados()).toEqual([
      expect.objectContaining({ itemId: "i-vit", quantity: "0.5", unitCode: "g" }),
    ]);
  });

  it("trocar para um Item de contagem: a unidade de massa não fica", async () => {
    await abrir(comRascunho());
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar componente" }));
    await escolherItem(0, "Vitamina", /Vitamina C/);
    fireEvent.change(await screen.findByRole("combobox", { name: "Unidade de MP-000010" }), {
      target: { value: "g" },
    });

    await escolherItem(0, "Cápsula", /Cápsula/);

    const unidade = await screen.findByRole("combobox", { name: "Unidade de EMB-000001" });
    expect(valor(unidade)).toBe("un");
    expect(opcoes(unidade).filter(Boolean)).toEqual(daDimensao("COUNT"));
  });

  it("trocar para outro Item de massa: a unidade escolhida continua valendo, e a quantidade não muda", async () => {
    await abrir(comRascunho());
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar componente" }));
    await escolherItem(0, "Vitamina", /Vitamina C/);
    const unidade = await screen.findByRole("combobox", { name: "Unidade de MP-000010" });
    fireEvent.change(unidade, { target: { value: "mg" } });
    const linha = unidade.closest("tr");
    if (!linha) throw new Error("unidade fora da linha");
    fireEvent.change(within(linha).getByRole("textbox"), { target: { value: "500" } });

    await escolherItem(0, "Zinco", /Zinco/);

    const depois = await screen.findByRole("combobox", { name: "Unidade de MP-000011" });
    expect(valor(depois)).toBe("mg");
    const linhaDepois = depois.closest("tr");
    if (!linhaDepois) throw new Error("unidade fora da linha");
    expect(valor(within(linhaDepois).getByRole("textbox"))).toBe("500");
  });

  it.each([
    ["fora do catálogo", "abc"],
    ["de outra dimensão", "un"],
  ])("unidade gravada %s aparece como legada, e salvar exige uma válida", async (_caso, codigo) => {
    await abrir(comRascunho([componente(VITAMINA, codigo)]));

    const unidade = await screen.findByRole("combobox", { name: "Unidade de MP-000010" });
    const aviso = await screen.findByText(
      `Unidade inválida ou legada: ${codigo}. Escolha uma unidade da lista.`,
    );
    // Não é trocada em silêncio: o gravado continua o que se vê.
    expect(valor(unidade)).toBe(codigo);
    expect(unidade).toHaveAttribute("aria-invalid", "true");
    expect(unidade).toHaveAttribute("aria-describedby", aviso.id);
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    salvarRascunho();
    expect(updateFormulationTemplateVersion).not.toHaveBeenCalled();

    fireEvent.change(unidade, { target: { value: "g" } });

    expect(screen.queryByText(/Unidade inválida ou legada/)).toBeNull();
    salvarRascunho();
    await waitFor(() => expect(updateFormulationTemplateVersion).toHaveBeenCalledTimes(1));
    expect(componentesEnviados()).toEqual([expect.objectContaining({ unitCode: "g" })]);
  });

  it("o catálogo de unidades chega uma vez, para todas as linhas", async () => {
    await abrir(
      comRascunho([componente(VITAMINA, "kg"), componente(ZINCO, "g"), componente(CAPSULA, "un")]),
    );

    await screen.findByRole("combobox", { name: "Unidade de EMB-000001" });
    expect(listUnits).toHaveBeenCalledTimes(1);
  });
});
