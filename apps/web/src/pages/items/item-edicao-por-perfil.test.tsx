import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ItemCostReferencesResponse, ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";

/**
 * Quem faz o quê no cadastro do Item, na tela — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Compras, Qualidade, Produção e Administrador criam e editam; Comercial e
 * Consulta abrem o Item em consulta, sem campo editável nem "Salvar". Dentro
 * do cadastro, os controles só se alteram por Qualidade e Administrador, a
 * marca "Consumido na produção" por Produção e Administrador, e o custo de
 * referência inicial só aparece para quem define custo. Inativar e reativar
 * seguem listas próprias. A tela usa as mesmas listas que a API aplica.
 */

vi.mock("../../lib/items-api", async (original) => ({
  ...(await original<object>()),
  listItems: vi.fn(),
  setItemActive: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  getItemCostReferences: vi.fn(),
  createItemCostReference: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../supplier-items/FornecedoresDoItem", () => ({ FornecedoresDoItemSection: () => null }));

/** O perfil da sessão, trocado por caso — a lista e o formulário leem a mesma sessão. */
const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { createItem, getItemCostReferences, listItems, updateItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ItemsPage } from "./ItemsPage";
import { ItemCreatePage } from "./ItemCreatePage";

const EDITAM = ["PURCHASING", "QUALITY", "PRODUCTION", "ADMIN"];
const SO_CONSULTAM = ["COMMERCIAL", "VIEWER"];
const TODOS = [...EDITAM, ...SO_CONSULTAM];

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(extra: Partial<ItemDTO>): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000001",
    type: "RAW_MATERIAL",
    name: "Cloridrato de tiamina",
    unitCode: "kg",
    unit: UNIDADES[0]!,
    ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL,
    requiresCoa: true,
    sourceName: "Cloridrato de tiamina",
    declaredNutrient: "Vitamina B1",
    family: "VITAMIN",
    defaultPurityPercent: "98.5",
    packagingSubtype: null,
    consumedInProduction: false,
    externalBarcode: "7891234567890",
    externalCode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
    ...extra,
  };
}

const ATIVO = item({});
const INATIVO = item({ id: "item-2", code: "MP-000002", name: "Ácido ascórbico", active: false });
const CAPSULA = item({
  id: "item-3",
  code: "ME-000003",
  type: "PACKAGING",
  name: "Cápsula vazia",
  unitCode: "un",
  unit: UNIDADES[1]!,
  ...ITEM_TYPE_DEFAULTS.PACKAGING,
  sourceName: null,
  declaredNutrient: null,
  family: "PACKAGING",
  defaultPurityPercent: null,
  packagingSubtype: "OTHER",
  consumedInProduction: true,
});

const SEM_REFERENCIA: ItemCostReferencesResponse = {
  itemId: "item-1",
  itemCode: "MP-000001",
  itemName: "Cloridrato de tiamina",
  itemUnitCode: "kg",
  current: null,
  history: [],
  automatic: {
    unitCost: null,
    unitCode: "kg",
    source: "NO_COST",
    details: null,
    referenceDate: "2026-09-04T12:00:00.000Z",
  },
} as unknown as ItemCostReferencesResponse;

function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname}</span>;
}

function abrir(entrada = "/cadastros/itens") {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/itens" element={<ItemsPage />} />
        <Route path="/cadastros/itens/novo" element={<ItemCreatePage />} />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
}

/** Tudo o que aceitaria digitação ou escolha dentro de um elemento. */
function camposEditaveis(elemento: HTMLElement) {
  return elemento.querySelectorAll("input, select, textarea, [contenteditable='true']");
}

function valorDe(elemento: HTMLElement, rotulo: string): string {
  const termo = within(elemento).getAllByText(rotulo, { selector: "dt" }).at(0);
  if (!termo) throw new Error(`Sem rótulo ${rotulo}`);
  return termo.nextElementSibling?.textContent ?? "";
}

const toggle = (id: string) => document.getElementById(id) as HTMLInputElement;
const CONTROLES = [
  "item-controls-lot",
  "item-controls-expiry",
  "item-requires-quality-release",
  "item-requires-coa",
];

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  vi.mocked(listItems).mockReset();
  vi.mocked(createItem).mockReset();
  vi.mocked(updateItem).mockReset();
  vi.mocked(listItems).mockResolvedValue({
    items: [ATIVO, INATIVO, CAPSULA],
    page: 1,
    pageSize: 20,
    total: 3,
  });
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
  vi.mocked(getItemCostReferences).mockResolvedValue(SEM_REFERENCIA);
  vi.mocked(updateItem).mockResolvedValue(ATIVO);
});

async function abrirItem(codigo: string, botao: "Editar" | "Ver") {
  abrir();
  await screen.findByText(codigo);
  const linha = screen.getByText(codigo).closest("tr") as HTMLElement;
  fireEvent.click(within(linha).getByRole("button", { name: botao }));
  return screen.findByRole("dialog");
}

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — lista de Itens", () => {
  it.each(EDITAM)("%s: + Novo item de estoque e Editar", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("MP-000001");
    expect(screen.getByRole("link", { name: "+ Novo item de estoque" })).toHaveAttribute(
      "href",
      "/cadastros/itens/novo",
    );
    expect(screen.getAllByRole("button", { name: "Editar" }), role).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Ver" }), role).toBeNull();
  });

  it.each(SO_CONSULTAM)("%s: sem + Novo item de estoque; cada linha oferece Ver", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("MP-000001");
    expect(screen.queryByRole("link", { name: /Novo item/ }), role).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" }), role).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ver" }), role).toHaveLength(3);
  });

  it.each(TODOS)("%s: Inativar e Reativar seguem as listas próprias", async (role) => {
    sessao.role = role;
    abrir();
    await screen.findByText("MP-000001");

    const inativa = ["PURCHASING", "QUALITY", "ADMIN"].includes(role);
    const reativa = ["QUALITY", "ADMIN"].includes(role);

    const menuDoAtivo = screen.queryByLabelText("Mais ações de MP-000001");
    expect(Boolean(menuDoAtivo), `${role} menu do ativo`).toBe(inativa);
    if (menuDoAtivo) {
      fireEvent.click(menuDoAtivo);
      expect(screen.getByRole("menuitem", { name: "Inativar" }), role).toBeInTheDocument();
      fireEvent.click(menuDoAtivo);
    }

    const menuDoInativo = screen.queryByLabelText("Mais ações de MP-000002");
    expect(Boolean(menuDoInativo), `${role} menu do inativo`).toBe(reativa);
    if (menuDoInativo) {
      fireEvent.click(menuDoInativo);
      expect(screen.getByRole("menuitem", { name: "Reativar" }), role).toBeInTheDocument();
    }
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Item em consulta", () => {
  it.each(SO_CONSULTAM)(
    "%s: o mesmo modal, sem campo editável e sem Salvar, com o cadastro inteiro formatado",
    async (role) => {
      sessao.role = role;
      const modal = await abrirItem("MP-000001", "Ver");

      expect(modal, role).toHaveTextContent("Cadastros / Itens de estoque / Consulta");
      expect(modal, role).toHaveTextContent(
        "Consulta. Só os perfis Compras, Qualidade, Produção e Administrador alteram o cadastro do item.",
      );
      expect(camposEditaveis(modal), role).toHaveLength(0);
      expect(within(modal).queryByRole("button", { name: /Salvar/ }), role).toBeNull();

      expect(valorDe(modal, "Tipo"), role).toBe("Matéria-prima");
      expect(valorDe(modal, "Unidade"), role).toBe("kg — Quilograma");
      expect(valorDe(modal, "Nutriente declarado"), role).toBe("Vitamina B1");
      expect(valorDe(modal, "Família"), role).toBe("Vitamina");
      expect(valorDe(modal, "Pureza padrão (%)"), role).toBe("98,5");
      expect(valorDe(modal, "Controla lote"), role).toBe("Sim");
      expect(valorDe(modal, "Exige CoA / Laudo"), role).toBe("Sim");
      expect(valorDe(modal, "Barcode externo"), role).toBe("7891234567890");
      expect(within(modal).getByRole("link", { name: /Lotes/ }), role).toBeInTheDocument();

      fireEvent.click(within(modal).getAllByRole("button", { name: /Fechar/ }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole("dialog"), role).toBeNull());
      expect(updateItem, role).not.toHaveBeenCalled();
    },
  );

  it("COMMERCIAL: não edita o Item, mas define a referência de custo dele", async () => {
    sessao.role = "COMMERCIAL";
    const modal = await abrirItem("MP-000001", "Ver");
    expect(await within(modal).findByRole("button", { name: "Definir referência" })).toBeInTheDocument();
  });

  it("VIEWER: consulta sem definir referência de custo", async () => {
    sessao.role = "VIEWER";
    const modal = await abrirItem("MP-000001", "Ver");
    await waitFor(() => expect(getItemCostReferences).toHaveBeenCalled());
    expect(within(modal).queryByRole("button", { name: "Definir referência" })).toBeNull();
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — controles e marca de consumo na edição", () => {
  it.each(["PURCHASING", "PRODUCTION"])(
    "%s: os quatro controles aparecem travados, e salvar manda os valores gravados",
    async (role) => {
      sessao.role = role;
      const modal = await abrirItem("MP-000001", "Editar");
      for (const id of CONTROLES) expect(toggle(id).disabled, `${role} ${id}`).toBe(true);
      expect(modal).toHaveTextContent(
        "Só Qualidade ou Administrador alteram os controles de rastreabilidade.",
      );

      fireEvent.change(within(modal).getByLabelText(/Nome/), { target: { value: "Tiamina HCl" } });
      fireEvent.click(within(modal).getByRole("button", { name: "Salvar alterações" }));
      await waitFor(() =>
        expect(updateItem).toHaveBeenCalledWith(
          "item-1",
          expect.objectContaining({
            name: "Tiamina HCl",
            controlsLot: true,
            controlsExpiry: true,
            requiresQualityRelease: true,
            requiresCoa: true,
          }),
        ),
      );
    },
  );

  it.each(["QUALITY", "ADMIN"])("%s: altera os controles", async (role) => {
    sessao.role = role;
    const modal = await abrirItem("MP-000001", "Editar");
    for (const id of CONTROLES) expect(toggle(id).disabled, `${role} ${id}`).toBe(false);
    expect(modal).not.toHaveTextContent("alteram os controles de rastreabilidade");
  });

  it.each(["PURCHASING", "QUALITY"])(
    "%s: Consumido na produção aparece travado, com a quem cabe",
    async (role) => {
      sessao.role = role;
      const modal = await abrirItem("ME-000003", "Editar");
      expect(toggle("item-consumed-in-production").disabled, role).toBe(true);
      expect(modal).toHaveTextContent('Só Produção ou Administrador alteram "Consumido na produção".');
    },
  );

  it.each(["PRODUCTION", "ADMIN"])("%s: marca e desmarca Consumido na produção", async (role) => {
    sessao.role = role;
    const modal = await abrirItem("ME-000003", "Editar");
    expect(toggle("item-consumed-in-production").disabled, role).toBe(false);
    expect(modal).not.toHaveTextContent("alteram \"Consumido na produção\"");
  });
});

describe("MASTER-DATA-EDIT-PERMISSIONS-01 — Novo item de estoque", () => {
  it.each(SO_CONSULTAM)("%s: o endereço não abre formulário — diz a quem pedir e volta", async (role) => {
    sessao.role = role;
    abrir("/cadastros/itens/novo");

    expect(await screen.findByRole("alert"), role).toHaveTextContent(
      "Seu perfil não permite cadastrar itens. Solicite a Compras, Qualidade, Produção ou Administrador o cadastro do item.",
    );
    expect(document.querySelectorAll("input, select, textarea"), role).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Criar item/ }), role).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "← Voltar para Itens de estoque" }));
    await screen.findByText("MP-000001");
    expect(screen.getByTestId("url").textContent, role).toBe("/cadastros/itens");
    expect(createItem, role).not.toHaveBeenCalled();
  });

  it.each(["PURCHASING", "PRODUCTION"])(
    "%s: cria com os controles padrão do tipo, travados, e sem custo de referência",
    async (role) => {
      sessao.role = role;
      vi.mocked(createItem).mockResolvedValue({ ...ATIVO, id: "item-novo" });
      abrir("/cadastros/itens/novo");

      const tipo = (await screen.findByLabelText(/Tipo/)) as HTMLSelectElement;
      fireEvent.change(tipo, { target: { value: "RAW_MATERIAL" } });
      await screen.findByRole("option", { name: "kg — Quilograma" });
      fireEvent.change(screen.getByLabelText(/Unidade/), { target: { value: "kg" } });
      fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Colina" } });

      for (const id of CONTROLES) expect(toggle(id).disabled, `${role} ${id}`).toBe(true);
      expect(
        screen.getByText(
          "O item nasce com os controles padrão do tipo. Só Qualidade ou Administrador alteram os controles de rastreabilidade.",
        ),
      ).toBeInTheDocument();
      expect(document.getElementById("item-initial-cost-reference"), role).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Criar item" }));
      await waitFor(() => expect(createItem).toHaveBeenCalled());
      const enviado = vi.mocked(createItem).mock.calls[0]![0];
      expect(enviado, role).toMatchObject({ type: "RAW_MATERIAL", ...ITEM_TYPE_DEFAULTS.RAW_MATERIAL });
      expect(enviado, role).not.toHaveProperty("initialCostReference");
    },
  );

  it("QUALITY: controles livres, mas sem custo de referência inicial", async () => {
    sessao.role = "QUALITY";
    abrir("/cadastros/itens/novo");
    fireEvent.change(await screen.findByLabelText(/Tipo/), { target: { value: "RAW_MATERIAL" } });
    for (const id of CONTROLES) expect(toggle(id).disabled, id).toBe(false);
    expect(document.getElementById("item-initial-cost-reference")).toBeNull();
  });

  it("ADMIN: controles livres e custo de referência inicial", async () => {
    sessao.role = "ADMIN";
    abrir("/cadastros/itens/novo");
    fireEvent.change(await screen.findByLabelText(/Tipo/), { target: { value: "RAW_MATERIAL" } });
    for (const id of CONTROLES) expect(toggle(id).disabled, id).toBe(false);
    expect(document.getElementById("item-initial-cost-reference")).not.toBeNull();
  });
});
