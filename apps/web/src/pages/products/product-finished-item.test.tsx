import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO, ProductDTO } from "@veridi/shared";

/**
 * Cadastro de Produto: cliente e item de produto acabado.
 *
 * O que estes testes protegem é a promessa da tela — quem cadastra um
 * produto não precisa saber que existe um Item de estoque por trás, e não
 * consegue mais criar um produto sem dono. Ambos eram possíveis antes, e o
 * resultado está na base: 348 produtos importados sem cliente e 54 itens de
 * produto acabado sem produto nenhum apontando para eles.
 */

vi.mock("../../lib/products-api", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));
// Só aparecem na edição e batem na API por conta própria.
vi.mock("../../components/AttachmentsSection", () => ({
  AttachmentsSection: () => null,
}));
vi.mock("./ProductIndustrialCostSummary", () => ({
  ProductIndustrialCostSummary: () => null,
}));
/*
 * O formulário de Cliente já tem suíte própria (CNPJ, telefone, CEP). O que
 * importa aqui é a INTEGRAÇÃO: que ele seja reusado e que o cliente criado
 * volte selecionado sem levar junto o que já foi digitado no produto.
 */
vi.mock("../customers/CustomerFormModal", () => ({
  CustomerFormModal: ({ onSaved }: { onSaved: (c: unknown) => void }) => (
    <button type="button" onClick={() => onSaved(CLIENTE_NOVO)}>
      simular-cadastro-de-cliente
    </button>
  ),
}));

import { createProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listUnits } from "../../lib/units-api";
import { useAuth } from "../../app/AuthProvider";
import { ProductFormModal } from "./ProductFormModal";

const CLIENTE: CustomerDTO = {
  id: "cli-1",
  code: "CLI-000007",
  legalName: "35.301.394 THIAGO LUZ DE SOUZA",
  tradeName: "THE KING",
  cnpj: "11222333000181",
  email: null,
  phone: null,
  street: null,
  number: null,
  complement: null,
  district: null,
  zipCode: null,
  city: null,
  state: null,
  notes: null,
  businessLotSuffix: null,
  active: true,
  createdAt: "2026-08-01T12:00:00.000Z",
  createdByName: null,
  updatedAt: "2026-08-01T12:00:00.000Z",
  updatedByName: null,
};

const CLIENTE_NOVO: CustomerDTO = {
  ...CLIENTE,
  id: "cli-2",
  code: "CLI-000099",
  legalName: "Nutri Nova Ltda",
  tradeName: "Nutri Nova",
  cnpj: null,
};

const PRODUTO_SALVO = {
  id: "prod-1",
  code: "PROD-000042",
  name: "Coenzima Q10 60 cápsulas",
  customerId: CLIENTE.id,
  customer: { id: CLIENTE.id, code: CLIENTE.code, legalName: CLIENTE.legalName },
  finishedProductItemId: "item-1",
  finishedProductItem: { id: "item-1", code: "PA-000008", name: "Coenzima Q10 60 cápsulas" },
  originProjectId: null,
  active: true,
} as unknown as ProductDTO;

function renderModal(props: Partial<Parameters<typeof ProductFormModal>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProductFormModal
        mode="create"
        product={null}
        onClose={() => {}}
        onSaved={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", name: "Admin", email: "a@b.c", role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(listUnits).mockResolvedValue([
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ] as never);
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [CLIENTE],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(createProduct).mockResolvedValue(PRODUTO_SALVO);
});

describe("Produto — cliente", () => {
  /*
   * O caso da auditoria VAL-LEG-01: a razão social é "35.301.394 THIAGO LUZ
   * DE SOUZA" e o nome fantasia é "THE KING". Quem cadastra digita "THE
   * KING". Antes, o campo só casava com o nome exibido.
   */
  it("encontra o cliente pelo nome fantasia e pelo CNPJ", async () => {
    const user = userEvent.setup();
    renderModal();

    const campo = await screen.findByLabelText(/Cliente/);
    await user.type(campo, "THE KING");
    expect(await screen.findByText(/THIAGO LUZ DE SOUZA/)).toBeInTheDocument();

    await user.clear(campo);
    await user.type(campo, "11222333000181");
    expect(await screen.findByText(/THIAGO LUZ DE SOUZA/)).toBeInTheDocument();
  });

  it("cliente é obrigatório e vai no payload", async () => {
    const user = userEvent.setup();
    renderModal();

    const campo = await screen.findByLabelText(/Cliente/);
    await user.type(campo, "THE KING");
    await user.click(await screen.findByText(/THIAGO LUZ DE SOUZA/));

    await user.type(screen.getByLabelText(/^Nome/), "Coenzima Q10 60 cápsulas");
    await user.click(screen.getByRole("button", { name: /Criar produto|Salvar/ }));

    await waitFor(() => {
      expect(vi.mocked(createProduct)).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CLIENTE.id }),
      );
    });
  });
});

describe("Produto — item de produto acabado", () => {
  it("não existe seletor de item de produto acabado na criação", async () => {
    renderModal();
    await screen.findByLabelText(/Cliente/);

    expect(screen.queryByLabelText(/Item de produto acabado/)).not.toBeInTheDocument();
    // No lugar dele, a tela diz o que vai acontecer ao salvar.
    expect(screen.getByText(/criado automaticamente ao salvar/i)).toBeInTheDocument();
  });

  it("a unidade de estoque vai no payload", async () => {
    const user = userEvent.setup();
    renderModal();

    const campo = await screen.findByLabelText(/Cliente/);
    await user.type(campo, "THE KING");
    await user.click(await screen.findByText(/THIAGO LUZ DE SOUZA/));
    await user.type(screen.getByLabelText(/^Nome/), "Coenzima Q10");
    await user.selectOptions(screen.getByLabelText(/Unidade de estoque/), "kg");
    await user.click(screen.getByRole("button", { name: /Criar produto|Salvar/ }));

    await waitFor(() => {
      expect(vi.mocked(createProduct)).toHaveBeenCalledWith(
        expect.objectContaining({ finishedUnitCode: "kg" }),
      );
    });
  });

  it("produto salvo mostra o item e o caminho para o estoque", async () => {
    renderModal({ mode: "edit", product: PRODUTO_SALVO });

    expect(await screen.findByText("PA-000008")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Ver estoque e lotes/ });
    expect(link).toHaveAttribute("href", "/estoque/item-1");
    // Trocar o item de um produto com histórico não é operação de formulário.
    expect(screen.queryByLabelText(/Item de produto acabado/)).not.toBeInTheDocument();
  });
});

describe("Produto — cadastrar cliente no contexto", () => {
  it("cliente criado volta selecionado sem perder o formulário", async () => {
    const user = userEvent.setup();
    renderModal();

    // O que já foi digitado precisa sobreviver ao cadastro do cliente.
    const nome = await screen.findByLabelText(/^Nome/);
    await user.type(nome, "Produto em andamento");

    const campo = screen.getByLabelText(/Cliente/);
    await user.type(campo, "Cliente que ainda não existe");
    // "+ Cadastrar novo" encabeça a lista justamente quando não há resultado.
    await user.click(await screen.findByRole("option", { name: /Cadastrar novo cliente/ }));

    await user.click(await screen.findByRole("button", { name: "simular-cadastro-de-cliente" }));

    // Volta selecionado…
    expect(await screen.findByDisplayValue(/Nutri Nova/)).toBeInTheDocument();
    // …e o produto continua como estava.
    expect(nome).toHaveValue("Produto em andamento");
    expect(
      screen.queryByRole("button", { name: "simular-cadastro-de-cliente" }),
    ).not.toBeInTheDocument();
  });
});
