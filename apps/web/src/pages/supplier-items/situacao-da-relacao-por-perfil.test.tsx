import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { SupplierItemDetailDTO } from "@veridi/shared";

/**
 * Situação da relação Item × Fornecedor por perfil, do lado da tela —
 * ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01.
 *
 * Na criação, quem não decide a homologação não vê seletor de situação: a tela
 * diz "Situação inicial: Pendente" e não pede situação, observação da decisão
 * nem preferencial — a API recusaria Homologado e Bloqueado com 403. O
 * Administrador segue o contrato da API e escolhe os três. No detalhe,
 * Homologar e Bloquear seguem a mesma lista; "Voltar para pendente" continua
 * com Compras, Qualidade e Administrador.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});
vi.mock("../../lib/supplier-items-api", () => ({
  createSupplierItem: vi.fn(),
  getSupplierItem: vi.fn(),
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
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: vi.fn(async () => ({ suppliers: [], page: 1, pageSize: 20, total: 0 })),
}));

import { createSupplierItem, getSupplierItem } from "../../lib/supplier-items-api";
import { PARAM_RETOMAR, finishContextualCreate, startContextualCreate } from "../../lib/contextual-create";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { SupplierItemFormModal } from "./SupplierItemFormModal";

const TODOS = ["ADMIN", "PURCHASING", "QUALITY", "PRODUCTION", "COMMERCIAL", "VIEWER"];
const DECIDEM = ["QUALITY", "ADMIN"];
const DEVOLVEM_PARA_PENDENTE = ["PURCHASING", "QUALITY", "ADMIN"];

const ITENS = [
  { id: "item-1", code: "MP-000003", name: "Cafeína", type: "RAW_MATERIAL" as const, unitCode: "kg" },
];
const FORNECEDORES = [{ id: "for-1", code: "FOR-000003", legalName: "SWEETMIX" }];

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(createSupplierItem).mockReset();
  sessao.role = "ADMIN";
});

function abrirFormulario() {
  render(
    <MemoryRouter>
      <SupplierItemFormModal
        items={ITENS as never}
        suppliers={FORNECEDORES as never}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

/** Digita no seletor e escolhe o primeiro RESULTADO — "+ Novo …" encabeça a lista. */
function escolher(placeholder: RegExp, termo: string) {
  const campo = screen.getByPlaceholderText(placeholder);
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  const lista = screen.getAllByRole("listbox").at(-1)!;
  const resultado = within(lista)
    .getAllByRole("option")
    .find((opcao) => !opcao.classList.contains("entity-select__create"));
  fireEvent.mouseDown(resultado!);
}

/** Item, fornecedor e preço; devolve o que a tela mandou para a API. */
async function criarComPreco() {
  vi.mocked(createSupplierItem).mockResolvedValue({ id: "si-1" } as never);
  escolher(/Digite código ou nome do item/, "MP-000003");
  escolher(/Digite código ou nome do fornecedor/, "SWEETMIX");
  fireEvent.change(screen.getByLabelText(/^Preço$/), { target: { value: "272" } });
  fireEvent.click(screen.getByRole("button", { name: /Criar relação/ }));
  await waitFor(() => expect(createSupplierItem).toHaveBeenCalledTimes(1));
  return vi.mocked(createSupplierItem).mock.calls[0]![0];
}

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — nova relação", () => {
  it.each(TODOS)("%s: situação, observação da decisão e preferencial só para quem decide a homologação", (role) => {
    sessao.role = role;
    abrirFormulario();

    const decide = DECIDEM.includes(role);
    expect(Boolean(screen.queryByLabelText(/^Situação$/)), role).toBe(decide);
    expect(Boolean(screen.queryByLabelText(/Observação da decisão/)), role).toBe(decide);
    expect(Boolean(screen.queryByLabelText(/Fornecedor preferencial/)), role).toBe(decide);
    expect(Boolean(screen.queryByText("Situação inicial")), role).toBe(!decide);
  });

  it("Compras: a relação nasce Pendente — a tela diz, não oferece, e não pede situação", async () => {
    sessao.role = "PURCHASING";
    abrirFormulario();

    expect(screen.queryByRole("option", { name: "Homologado" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Bloqueado" })).toBeNull();
    const situacaoInicial = screen.getByText("Situação inicial");
    expect(situacaoInicial.nextElementSibling).toHaveTextContent(/^Pendente$/);
    expect(
      screen.getByText(
        "Homologar ou bloquear é decisão de Qualidade ou Administrador, no detalhe da relação. O preferencial só pode ser marcado depois da homologação.",
      ),
    ).toBeInTheDocument();

    const pedido = await criarComPreco();
    expect(pedido).not.toHaveProperty("qualificationStatus");
    expect(pedido).not.toHaveProperty("qualificationNote");
    expect(pedido).not.toHaveProperty("preferred");
    // A primeira oferta continua indo junto com a relação.
    expect(pedido.initialOffer).toMatchObject({ unitPrice: "272", priceUomCode: "kg" });
  });

  it("Compras: rascunho retomado com Homologado e preferencial não vira pedido de situação", async () => {
    sessao.role = "PURCHASING";
    // O rascunho mora na aba: pode ter sido guardado por outro perfil na mesma sessão do navegador.
    const token = startContextualCreate({
      originRoute: "/compras/item-fornecedor?nova=1",
      fieldKey: "supplierId",
      entityType: "supplier",
      draft: {
        itemId: "item-1",
        supplierId: "",
        supplierItemCode: "",
        commercialNotes: "",
        qualificationStatus: "APPROVED",
        qualificationNote: "Auditoria 2026",
        preferred: true,
        unitPrice: "272",
        priceUomCode: "kg",
        minimumOrderQuantity: "",
        minimumOrderUomCode: "",
        effectiveAt: "2026-09-16",
        validUntil: "",
        offerNotes: "",
      },
    })!;
    finishContextualCreate(token, { entityType: "supplier", entityId: "for-1", label: "FOR-000003 · SWEETMIX" });
    vi.mocked(createSupplierItem).mockResolvedValue({ id: "si-1" } as never);

    render(
      <MemoryRouter initialEntries={[`/compras/item-fornecedor?nova=1&${PARAM_RETOMAR}=${token}`]}>
        <Routes>
          <Route
            path="/compras/item-fornecedor"
            element={
              <SupplierItemFormModal
                items={ITENS as never}
                suppliers={FORNECEDORES as never}
                onClose={() => {}}
                onSaved={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const criar = screen.getByRole("button", { name: /Criar relação/ });
    await waitFor(() => expect(criar).not.toBeDisabled());
    expect(screen.getByText("Situação inicial").nextElementSibling).toHaveTextContent(/^Pendente$/);
    fireEvent.click(criar);

    await waitFor(() => expect(createSupplierItem).toHaveBeenCalledTimes(1));
    const pedido = vi.mocked(createSupplierItem).mock.calls[0]![0];
    expect(pedido).toMatchObject({ itemId: "item-1", supplierId: "for-1", initialOffer: { unitPrice: "272" } });
    expect(pedido).not.toHaveProperty("qualificationStatus");
    expect(pedido).not.toHaveProperty("qualificationNote");
    expect(pedido).not.toHaveProperty("preferred");
  });

  it("Administrador: segue o contrato da API — escolhe situação, observação e preferencial", async () => {
    sessao.role = "ADMIN";
    abrirFormulario();

    const situacao = screen.getByLabelText(/^Situação$/) as HTMLSelectElement;
    expect([...situacao.options].map((opcao) => [opcao.value, opcao.text])).toEqual([
      ["PENDING", "Pendente"],
      ["APPROVED", "Homologado"],
      ["BLOCKED", "Bloqueado"],
    ]);
    // Preferencial continua exigindo a relação homologada.
    expect((screen.getByLabelText(/Fornecedor preferencial/) as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(situacao, { target: { value: "APPROVED" } });
    fireEvent.change(screen.getByLabelText(/Observação da decisão/), {
      target: { value: "Auditoria 2026" },
    });
    fireEvent.click(screen.getByLabelText(/Fornecedor preferencial/));

    const pedido = await criarComPreco();
    expect(pedido).toMatchObject({
      qualificationStatus: "APPROVED",
      qualificationNote: "Auditoria 2026",
      preferred: true,
      initialOffer: { unitPrice: "272" },
    });
  });
});

function relacao(overrides: Partial<SupplierItemDetailDTO> = {}): SupplierItemDetailDTO {
  return {
    id: "si-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    itemUnitCode: "kg",
    itemExternalCode: null,
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierActive: true,
    supplierItemCode: null,
    commercialNotes: null,
    qualificationStatus: "PENDING",
    preferred: false,
    active: true,
    offers: [],
    offerCount: 0,
    qualificationHistory: [],
    currentOffer: null,
    latestLegacyOffer: null,
    costSourceAmbiguous: false,
    costSourceToday: {
      source: "NO_COST",
      unitCost: null,
      unitCode: "kg",
      details: null,
      referenceDate: "2026-09-16T12:00:00.000Z",
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: "Compras",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedByName: "Compras",
    ...overrides,
  };
}

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
  await screen.findByText(/Vitamina C · Fornecedor Teste/);
}

describe("ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 — detalhe da relação", () => {
  it.each(TODOS)(
    "%s: Homologar e Bloquear só para quem decide; Voltar para pendente com os perfis de antes",
    async (role) => {
      sessao.role = role;
      await abrirDetalhe(relacao({ qualificationStatus: "APPROVED" }));

      const decide = DECIDEM.includes(role);
      expect(Boolean(screen.queryByRole("button", { name: "Homologar" })), role).toBe(decide);
      expect(Boolean(screen.queryByRole("button", { name: "Bloquear" })), role).toBe(decide);
      expect(Boolean(screen.queryByRole("button", { name: "Voltar para pendente" })), role).toBe(
        DEVOLVEM_PARA_PENDENTE.includes(role),
      );
    },
  );
});
