import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";

/**
 * Uso e consumo no formulário do Item — INTERNAL-CONSUMABLE-ITEM-TYPE-01.
 *
 * O tipo entra na arquitetura por tipo de ITEM-FORM-BY-TYPE-01: a criação
 * manual o oferece, ele ganha a SEÇÃO própria ("Dados de uso e consumo") e não
 * vê nenhum campo dos outros tipos — fonte, nutriente declarado, família,
 * pureza, subtipo de embalagem, "Consumido na produção" e o arquivo do rótulo.
 *
 * O que a tela esconde não pode viajar no envio: trocar de tipo depois de
 * preencher os campos de outro tipo limpa o que ficou para trás.
 */

vi.mock("../../lib/items-api", () => ({ createItem: vi.fn(), updateItem: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../lib/item-label-files-api", () => ({
  getItemLabelFile: vi.fn(),
  uploadItemLabelFileVersion: vi.fn(),
  voidItemLabelFileVersion: vi.fn(),
  restoreItemLabelFileVersion: vi.fn(),
  itemLabelFileDownloadUrl: () => "http://api.teste/label-file",
}));
vi.mock("../supplier-items/FornecedoresDoItem", () => ({ FornecedoresDoItemSection: () => null }));
vi.mock("../../components/ItemCostReferenceSection", () => ({
  ItemCostReferenceSection: () => null,
}));

vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: "ADMIN" } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ItemCreatePage } from "./ItemCreatePage";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function consumivelCriado(): ItemDTO {
  return {
    id: "uc-1",
    code: "UC-000001",
    type: "INTERNAL_CONSUMABLE",
    name: "Luva de procedimento",
    unitCode: "un",
    unit: UNIDADES[1]!,
    ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: null,
    consumedInProduction: false,
    externalBarcode: null,
    externalCode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-09-17T10:00:00.000Z",
    updatedAt: "2026-09-17T10:00:00.000Z",
  };
}

const seletor = (id: string) => document.getElementById(id) as HTMLSelectElement;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const secao = (titulo: string) => screen.queryByRole("heading", { name: titulo });
const payloadCriado = () => vi.mocked(createItem).mock.calls[0]![0];

function renderPagina() {
  return render(
    <MemoryRouter initialEntries={["/cadastros/itens/novo"]}>
      <Routes>
        <Route path="/cadastros/itens/novo" element={<ItemCreatePage />} />
        <Route path="/cadastros/itens" element={<p>lista de itens</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function unidadesCarregadas() {
  await waitFor(() => expect(seletor("item-unit").options.length).toBeGreaterThan(1));
}

async function escolherTipo(tipo: string) {
  await unidadesCarregadas();
  fireEvent.change(seletor("item-type"), { target: { value: tipo } });
}

const criar = () => fireEvent.click(screen.getByRole("button", { name: "Criar item" }));

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(createItem).mockReset();
  vi.mocked(listUnits).mockReset();
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
  vi.mocked(createItem).mockResolvedValue(consumivelCriado());
});

describe("Uso e consumo — formulário do Item", () => {
  it("é oferecido na criação manual, com o rótulo em português", async () => {
    renderPagina();
    await unidadesCarregadas();

    const opcoes = [...seletor("item-type").options].map((opcao) => opcao.value);
    expect(opcoes).toContain("INTERNAL_CONSUMABLE");
    // Produto acabado continua fora: ele nasce junto com o Produto.
    expect(opcoes).not.toContain("FINISHED_PRODUCT");
    expect(screen.getByRole("option", { name: "Uso e consumo" })).toBeInTheDocument();
  });

  it("mostra a seção própria e nenhum campo dos outros tipos", async () => {
    renderPagina();
    await escolherTipo("INTERNAL_CONSUMABLE");

    expect(secao("Dados de uso e consumo")).toBeInTheDocument();
    expect(screen.getByText("Não entra em")).toBeInTheDocument();

    expect(secao("Classificação industrial")).toBeNull();
    expect(screen.queryByLabelText("Fonte")).toBeNull();
    expect(screen.queryByLabelText("Família")).toBeNull();
    expect(screen.queryByLabelText("Nutriente declarado")).toBeNull();
    expect(screen.queryByLabelText("Pureza padrão (%)")).toBeNull();

    expect(secao("Dados da embalagem")).toBeNull();
    expect(campo("item-packaging-subtype")).toBeNull();
    expect(campo("item-consumed-in-production")).toBeNull();

    expect(secao("Arquivo do rótulo")).toBeNull();
    expect(campo("item-label-file")).toBeNull();
  });

  it("nasce com os quatro controles desmarcados", async () => {
    renderPagina();
    await escolherTipo("INTERNAL_CONSUMABLE");

    expect(campo("item-controls-lot")!.checked).toBe(false);
    expect(campo("item-controls-expiry")!.checked).toBe(false);
    expect(campo("item-requires-quality-release")!.checked).toBe(false);
    expect(campo("item-requires-coa")!.checked).toBe(false);
  });

  it("envia só o que é do tipo — nada da matéria-prima escolhida antes", async () => {
    renderPagina();

    // A pessoa começa em matéria-prima e preenche a classificação industrial.
    await escolherTipo("RAW_MATERIAL");
    fireEvent.change(screen.getByLabelText("Fonte"), { target: { value: "Látex" } });
    fireEvent.change(seletor("item-family"), { target: { value: "EXCIPIENT" } });

    // Depois percebe que é uso e consumo e troca o tipo.
    fireEvent.change(seletor("item-type"), { target: { value: "INTERNAL_CONSUMABLE" } });
    fireEvent.change(seletor("item-unit"), { target: { value: "un" } });
    fireEvent.change(campo("item-name")!, { target: { value: "Luva de procedimento" } });

    criar();
    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));

    const payload = payloadCriado();
    expect(payload).toMatchObject({
      type: "INTERNAL_CONSUMABLE",
      name: "Luva de procedimento",
      unitCode: "un",
      ...ITEM_TYPE_DEFAULTS.INTERNAL_CONSUMABLE,
    });
    // O campo que a tela escondeu não viaja — nem com o valor que ficou no
    // estado, nem como chave vazia.
    expect(payload).not.toHaveProperty("sourceName");
    expect(payload).not.toHaveProperty("family");
    expect(payload).not.toHaveProperty("declaredNutrient");
    expect(payload).not.toHaveProperty("defaultPurityPercent");
    expect(payload).not.toHaveProperty("packagingSubtype");
    expect(payload).not.toHaveProperty("consumedInProduction");
  });
});
