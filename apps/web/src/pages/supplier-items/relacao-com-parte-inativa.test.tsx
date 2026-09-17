import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  ItemDTO,
  SupplierItemDTO,
  SupplierItemDetailDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";

/**
 * Item ou fornecedor inativo na relação, do lado da tela —
 * SUPPLIER-ITEM-INACTIVE-GATE-01, `PRODUCT_RULES.md` §112 (decisão D8 do PO).
 *
 * A autoridade é a API (`apps/api/src/modules/supplier-items/supplier-item-inactive-gate.test.ts`):
 * homologar, preferencial, oferta e reativar são 400 `inactive_reference`. Aqui
 * a prova é a da tela: ela não oferece o que terminaria em recusa, diz por quê,
 * e continua oferecendo o que a regra libera — bloquear, voltar para pendente,
 * inativar a relação e remover o preferencial.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: vi.fn(),
  getSupplierItem: vi.fn(),
  createSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ]),
}));
vi.mock("../../lib/items-api", async (original) => ({
  ...(await original<object>()),
  listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", async (original) => ({
  ...(await original<object>()),
  listSuppliers: vi.fn(async () => ({ suppliers: [], page: 1, pageSize: 20, total: 0 })),
}));

import { getSupplierItem, listSupplierItems } from "../../lib/supplier-items-api";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { FornecedoresDoItemSection } from "./FornecedoresDoItem";

const KG: UnitOfMeasureDTO = {
  code: "kg",
  label: "Quilograma",
  dimension: "MASS",
  toBaseFactor: "1000",
};

const AVISO_DO_ITEM =
  /Reativar a relação, homologar, definir o preferencial e registrar oferta voltam quando o item for reativado/;
const AVISO_DO_FORNECEDOR =
  /Reativar a relação, homologar, definir o preferencial e registrar oferta voltam quando o fornecedor for reativado/;

function relacaoLinha(overrides: Partial<SupplierItemDTO> = {}): SupplierItemDTO {
  return {
    id: "si-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemExternalCode: null,
    itemUnitCode: "kg",
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    itemActive: true,
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "PURIFARMA",
    supplierActive: true,
    supplierItemCode: null,
    qualificationStatus: "APPROVED",
    preferred: false,
    active: true,
    commercialNotes: null,
    currentOffer: null,
    latestLegacyOffer: null,
    offerCount: 0,
    costSourceAmbiguous: false,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdByName: "Compras",
    updatedAt: "2026-09-01T12:00:00.000Z",
    updatedByName: "Compras",
    ...overrides,
  };
}

function detalhe(overrides: Partial<SupplierItemDetailDTO> = {}): SupplierItemDetailDTO {
  return {
    ...relacaoLinha(),
    qualificationStatus: "PENDING",
    offers: [],
    qualificationHistory: [],
    costSourceToday: {
      source: "NO_COST",
      unitCost: null,
      unitCode: "kg",
      details: null,
      referenceDate: "2026-09-17T12:00:00.000Z",
    },
    ...overrides,
  };
}

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000003",
    type: "RAW_MATERIAL",
    name: "Cafeína",
    unitCode: "kg",
    unit: KG,
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    requiresCoa: false,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: null,
    consumedInProduction: false,
    externalBarcode: null,
    externalCode: null,
    active: true,
    operationallyUsed: true,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  sessao.role = "ADMIN";
  vi.mocked(getSupplierItem).mockReset();
  vi.mocked(listSupplierItems).mockReset();
});

async function abrirDetalhe(dto: SupplierItemDetailDTO) {
  vi.mocked(getSupplierItem).mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route
          path="/compras/item-fornecedor"
          element={<SupplierItemDetailModal supplierItemId="si-1" onClose={() => {}} />}
        />
      </Route>,
    ),
    { initialEntries: ["/compras/item-fornecedor"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText(/Cafeína · PURIFARMA/);
}

function botao(nome: RegExp | string): HTMLElement {
  return screen.getByRole("button", { name: nome });
}

/** O preço preenchido: sem ele "Registrar preço" já estaria desabilitado por falta de valor. */
function preencherPreco() {
  fireEvent.change(screen.getByLabelText(/^Preço$/), { target: { value: "10" } });
}

describe("detalhe da relação com item ou fornecedor inativo", () => {
  it("as duas partes ativas: homologar, preferencial e registrar preço são oferecidos, sem aviso de inativo", async () => {
    await abrirDetalhe(detalhe({ qualificationStatus: "APPROVED" }));
    preencherPreco();

    expect(botao("Marcar como preferencial")).toBeEnabled();
    expect(botao("Registrar preço")).toBeEnabled();
    expect(botao("Bloquear")).toBeEnabled();
    expect(screen.queryByText(AVISO_DO_ITEM)).toBeNull();
    expect(screen.queryByText(AVISO_DO_FORNECEDOR)).toBeNull();
    expect(screen.queryByText("Item inativo")).toBeNull();
  });

  it("item inativo: homologar, preferencial e registrar preço saem; bloquear e inativar a relação seguem", async () => {
    await abrirDetalhe(detalhe({ itemActive: false }));
    preencherPreco();

    expect(botao("Homologar"), "homologar é compromisso novo").toBeDisabled();
    expect(botao("Marcar como preferencial")).toBeDisabled();
    expect(botao("Registrar preço")).toBeDisabled();
    expect(botao("Bloquear"), "tirar autorização não depende de reativar").toBeEnabled();
    expect(botao("Inativar relação")).toBeEnabled();
    expect(screen.getByText("Item inativo")).toBeInTheDocument();
    expect(screen.getByText(AVISO_DO_ITEM)).toBeInTheDocument();
  });

  it("fornecedor inativo e relação bloqueada: voltar para pendente segue, homologar não", async () => {
    await abrirDetalhe(detalhe({ supplierActive: false, qualificationStatus: "BLOCKED" }));

    expect(botao("Homologar")).toBeDisabled();
    expect(botao("Voltar para pendente")).toBeEnabled();
    expect(screen.getByText("Fornecedor inativo")).toBeInTheDocument();
    expect(screen.getByText(AVISO_DO_FORNECEDOR)).toBeInTheDocument();
  });

  it("relação inativa com item inativo: reativar a relação não é oferecido", async () => {
    await abrirDetalhe(detalhe({ itemActive: false, active: false }));

    expect(botao("Reativar relação")).toBeDisabled();
  });

  it("relação inativa com as duas partes ativas: reativar segue oferecido", async () => {
    await abrirDetalhe(detalhe({ active: false }));

    expect(botao("Reativar relação")).toBeEnabled();
  });

  it("preferencial de fornecedor inativado depois: remover o preferencial continua oferecido", async () => {
    await abrirDetalhe(
      detalhe({ supplierActive: false, qualificationStatus: "APPROVED", preferred: true }),
    );

    expect(
      botao("Remover preferencial"),
      "desfazer é o que resolve o item apontando para quem ninguém pode escolher",
    ).toBeEnabled();
  });
});

async function abrirSecaoDoItem(doItem: ItemDTO, relacoes: SupplierItemDTO[]) {
  vi.mocked(listSupplierItems).mockResolvedValue({
    supplierItems: relacoes,
    page: 1,
    pageSize: 100,
    total: relacoes.length,
  });
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route path="/cadastros/itens" element={<FornecedoresDoItemSection item={doItem} />} />
      </Route>,
    ),
    { initialEntries: ["/cadastros/itens"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(listSupplierItems).toHaveBeenCalled());
  await screen.findByText("PURIFARMA");
}

/** A linha da relação, pelo nome do fornecedor — nunca a tabela inteira. */
function linhaDe(nome: string): HTMLElement {
  return screen.getByText(nome).closest("tr")!;
}

describe("seção Fornecedores do Item com parte inativa", () => {
  it("relação homologada e ativa: a linha oferece definir como preferencial", async () => {
    await abrirSecaoDoItem(item(), [relacaoLinha()]);

    expect(
      within(linhaDe("PURIFARMA")).getByRole("button", { name: "Definir como preferencial" }),
    ).toBeInTheDocument();
  });

  it("fornecedor inativo: a linha continua listada e marcada, sem oferecer o preferencial", async () => {
    await abrirSecaoDoItem(item(), [relacaoLinha({ supplierActive: false })]);

    const linha = linhaDe("PURIFARMA");
    expect(within(linha).getByText("Fornecedor inativo")).toBeInTheDocument();
    expect(
      within(linha).queryByRole("button", { name: "Definir como preferencial" }),
      "marcar preferencial terminaria em 400 inactive_reference",
    ).toBeNull();
  });

  it("item inativo: nem com fornecedor ativo a linha oferece o preferencial", async () => {
    await abrirSecaoDoItem(item({ active: false }), [relacaoLinha({ itemActive: false })]);

    expect(
      within(linhaDe("PURIFARMA")).queryByRole("button", { name: "Definir como preferencial" }),
    ).toBeNull();
  });
});
