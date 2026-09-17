import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import type { ListCustomersParams } from "../lib/customers-api";

/**
 * "+ Novo cliente" nos fluxos contextuais — CUSTOMER-EDIT-PERMISSIONS-01.
 *
 * Pedido, recebimento de material do cliente, Projeto e Produto (página e
 * modal) oferecem cadastrar o Cliente que falta. Depois da decisão do PO, só
 * Comercial e Administrador recebem essa oferta. Os demais perfis continuam
 * escolhendo Cliente existente no mesmo campo — o fluxo não é bloqueado —, e
 * quando a busca não acha nada a lista diz a quem pedir o cadastro, em vez de
 * terminar num beco sem saída.
 */

vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../lib/receiving-api", () => ({ createCustomerSuppliedReceipt: vi.fn() }));
vi.mock("../lib/products-api", () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("../lib/projects-api", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  getProjectVocabulary: vi.fn(() => Promise.resolve({ concepts: [], channels: [] })),
}));
vi.mock("../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));
vi.mock("../lib/customer-orders-api", () => ({
  applyFulfillmentPlan: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  getCustomerOrder: vi.fn(),
  getFulfillmentPlan: vi.fn(),
  getPlanPurchaseSourcing: vi.fn(),
  getPurchaseSuggestion: vi.fn(),
  updateCustomerOrder: vi.fn(),
}));

/** O perfil da sessão, trocado por caso. */
const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { listCustomers } from "../lib/customers-api";
import { listItems } from "../lib/items-api";
import { listUnits } from "../lib/units-api";
import { listSuppliers } from "../lib/suppliers-api";
import { listProducts } from "../lib/products-api";
import { CustomerOrderPage } from "./customer-orders/CustomerOrderPage";
import { ReceiveCustomerMaterialPage } from "./receiving/ReceiveCustomerMaterialPage";
import { ProjectFormModal } from "./projects/ProjectFormModal";
import { ProductCreatePage } from "./products/ProductCreatePage";
import { ProductFormModal } from "./products/ProductFormModal";

const PODEM_CADASTRAR = ["ADMIN", "COMMERCIAL"];
const NAO_CADASTRAM = ["PRODUCTION", "QUALITY", "PURCHASING", "VIEWER"];
const AJUDA =
  "Nenhum cliente encontrado. Solicite ao Comercial ou Administrador o cadastro do cliente.";

const CLIENTE = {
  id: "cli-1",
  code: "CLI-000001",
  legalName: "Vida Saudável Ltda",
  tradeName: "Vida Saudável",
  cnpj: null,
  active: true,
  status: "ACTIVE",
} as unknown as CustomerDTO;

interface Hospedeiro {
  nome: string;
  rota: string;
  campo: string;
  tela: () => ReactElement;
  /**
   * A tela só abre para quem cadastra Produto — Comercial e Administrador
   * (MASTER-DATA-EDIT-PERMISSIONS-01), que também cadastram Cliente. Para os
   * demais perfis ela recusa antes do campo existir: o caso "sem + Novo
   * cliente" não acontece ali, e a recusa é provada na suíte do Produto.
   */
  soQuemCadastraProduto?: boolean;
}

const nada = () => undefined;

const HOSPEDEIROS: Hospedeiro[] = [
  { nome: "Pedido", rota: "/comercial/pedidos/novo", campo: "co-customer", tela: () => <CustomerOrderPage /> },
  {
    nome: "Recebimento de material do cliente",
    rota: "/compras/recebimentos/material-do-cliente",
    campo: "customer-receipt-customer",
    tela: () => <ReceiveCustomerMaterialPage />,
  },
  {
    nome: "Projeto",
    rota: "/comercial/projetos",
    campo: "project-customer",
    tela: () => <ProjectFormModal project={null} onClose={nada} onSaved={nada} />,
  },
  {
    nome: "Produto (página)",
    rota: "/cadastros/produtos/novo",
    campo: "product-customer",
    tela: () => <ProductCreatePage />,
    soQuemCadastraProduto: true,
  },
  {
    nome: "Produto (modal)",
    rota: "/cadastros/produtos",
    campo: "product-customer",
    tela: () => <ProductFormModal mode="create" product={null} onClose={nada} onSaved={nada} />,
  },
];

function abrir(hospedeiro: Hospedeiro) {
  render(
    <MemoryRouter initialEntries={[hospedeiro.rota]}>
      <Routes>
        <Route path={hospedeiro.rota} element={hospedeiro.tela()} />
        <Route path="/cadastros/clientes/novo" element={<p>cadastro de cliente</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** O campo pelo `id`: o rótulo do Cliente hospeda o ⓘ de ajuda em algumas telas. */
async function campoDeCliente(id: string): Promise<HTMLInputElement> {
  return waitFor(() => {
    const elemento = document.getElementById(id);
    if (!elemento) throw new Error(`Campo #${id} não está na tela.`);
    return elemento as HTMLInputElement;
  });
}

/** A lista aberta — sai por portal; a última é a do campo em foco. */
function lista(): HTMLElement {
  return screen.getAllByRole("listbox").at(-1)!;
}

/** Espera a busca no servidor pelo termo terminar. */
async function buscaFeita(termo: string) {
  await waitFor(() =>
    expect(
      vi.mocked(listCustomers).mock.calls.some(([params]) => params?.search === termo),
    ).toBe(true),
  );
  await waitFor(() => expect(within(lista()).queryByText("Procurando…")).toBeNull());
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessao.role = "ADMIN";
  vi.mocked(listCustomers).mockImplementation(async (params?: ListCustomersParams) => {
    const termo = params?.search?.toLowerCase();
    const customers = termo
      ? [CLIENTE].filter((cliente) =>
          `${cliente.code} ${cliente.legalName} ${cliente.tradeName}`.toLowerCase().includes(termo),
        )
      : [CLIENTE];
    return { customers, page: 1, pageSize: 50, total: customers.length };
  });
  vi.mocked(listUnits).mockResolvedValue([
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ] as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
});

describe.each(HOSPEDEIROS)("CUSTOMER-EDIT-PERMISSIONS-01 — Cliente no $nome", (hospedeiro) => {
  it.each(PODEM_CADASTRAR)("%s: a lista oferece + Novo cliente", async (role) => {
    sessao.role = role;
    const user = userEvent.setup();
    abrir(hospedeiro);

    const termo = "cliente que ainda nao existe";
    await user.type(await campoDeCliente(hospedeiro.campo), termo);
    await buscaFeita(termo);

    expect(
      within(lista()).getByRole("option", { name: `+ Novo cliente: “${termo}”` }),
      `${hospedeiro.nome} ${role}`,
    ).toBeInTheDocument();
    expect(within(lista()).queryByText(AJUDA), `${hospedeiro.nome} ${role}`).toBeNull();
  });
});

describe.each(HOSPEDEIROS.filter((hospedeiro) => !hospedeiro.soQuemCadastraProduto))(
  "CUSTOMER-EDIT-PERMISSIONS-01 — Cliente no $nome, para quem não cadastra",
  (hospedeiro) => {
    it.each(NAO_CADASTRAM)(
      "%s: sem + Novo cliente, a busca vazia diz a quem pedir, e o Cliente existente continua escolhível",
      async (role) => {
        sessao.role = role;
        const user = userEvent.setup();
        abrir(hospedeiro);
        const campo = await campoDeCliente(hospedeiro.campo);

        const termo = "cliente que ainda nao existe";
        await user.type(campo, termo);
        await buscaFeita(termo);

        expect(within(lista()).getByText(AJUDA), `${hospedeiro.nome} ${role}`).toBeInTheDocument();
        expect(
          within(lista()).queryByRole("option", { name: /Novo cliente/ }),
          `${hospedeiro.nome} ${role}`,
        ).toBeNull();
        expect(screen.queryByText("cadastro de cliente"), `${hospedeiro.nome} ${role}`).toBeNull();

        // O mesmo campo escolhe o Cliente que já existe.
        await user.clear(campo);
        await user.type(campo, "Vida");
        await buscaFeita("Vida");
        const opcoes = within(lista()).getAllByRole("option");
        expect(opcoes, `${hospedeiro.nome} ${role}`).toHaveLength(1);
        await user.click(opcoes[0]!);
        await waitFor(() => expect(campo.value, `${hospedeiro.nome} ${role}`).toContain("CLI-000001"));
      },
    );
  },
);
