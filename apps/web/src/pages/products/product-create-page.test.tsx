import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { CustomerDTO, ProductDTO } from "@veridi/shared";

/**
 * A tela oficial de cadastro de Produto — `/cadastros/produtos/novo`.
 *
 * Produto é a única entidade que é os DOIS lados da criação contextual: alvo,
 * quando alguém saiu de um Pedido para cadastrar o produto que faltava, e
 * origem, porque ele exige Cliente e o cliente pode não existir ainda. O que
 * estes testes protegem é que os dois caminhos não se atrapalhem — e que o
 * acesso direto continue sendo um cadastro comum, que salva e volta para a
 * lista.
 */

vi.mock("../../lib/products-api", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));
// Só aparecem na edição e batem na API por conta própria.
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("./ProductIndustrialCostSummary", () => ({ ProductIndustrialCostSummary: () => null }));

import { createProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listUnits } from "../../lib/units-api";
import { useAuth } from "../../app/AuthProvider";
import {
  PARAM_ORIGEM,
  PARAM_RETOMAR,
  finishContextualCreate,
  readContextualCreate,
  startContextualCreate,
} from "../../lib/contextual-create";
import { ProductCreatePage } from "./ProductCreatePage";

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

const PRODUTO_SALVO = {
  id: "prod-1",
  code: "PROD-000042",
  name: "Coenzima Q10 60 cápsulas",
  customerId: CLIENTE.id,
  finishedProductItemId: "item-1",
  active: true,
} as unknown as ProductDTO;

/** A URL corrente, para provar navegação em vez de camada por cima. */
function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function renderPage(entrada = "/cadastros/produtos/novo") {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/produtos/novo" element={<ProductCreatePage />} />
        <Route path="/cadastros/produtos" element={<p>listagem de produtos</p>} />
        <Route path="/cadastros/clientes/novo" element={<p>cadastro de cliente</p>} />
        <Route path="/comercial/pedidos/novo" element={<p>pedido em edição</p>} />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
}

async function escolherCliente(user: ReturnType<typeof userEvent.setup>) {
  const campo = await screen.findByLabelText(/Cliente/);
  await user.type(campo, "THE KING");
  await user.click(await screen.findByText(/THIAGO LUZ DE SOUZA/));
}

function urlAtual() {
  return screen.getByTestId("url").textContent ?? "";
}

beforeEach(() => {
  sessionStorage.clear();
  // O rascunho e as chamadas de API não podem vazar de um teste para o
  // seguinte: metade destes casos afirma que algo NÃO aconteceu.
  vi.clearAllMocks();
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

describe("Produto — acesso direto", () => {
  it("renderiza o cadastro com trilha canônica", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Novo produto" })).toBeInTheDocument();
    // A trilha diz onde o registro MORA, não por onde a pessoa passou.
    expect(screen.getByRole("link", { name: "Produtos" })).toHaveAttribute(
      "href",
      "/cadastros/produtos",
    );
    // Sem origem não há para onde voltar além da lista.
    expect(screen.queryByRole("button", { name: /Voltar para/ })).not.toBeInTheDocument();
  });

  it("salva e vai para a lista", async () => {
    const user = userEvent.setup();
    renderPage();

    await escolherCliente(user);
    await user.type(screen.getByLabelText(/^Nome/), "Coenzima Q10 60 cápsulas");
    await user.click(screen.getByRole("button", { name: /Criar produto/ }));

    await waitFor(() => {
      expect(vi.mocked(createProduct)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Coenzima Q10 60 cápsulas",
          customerId: CLIENTE.id,
        }),
      );
    });
    expect(await screen.findByText("listagem de produtos")).toBeInTheDocument();
  });

  it("cancelar vai para a lista", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("listagem de produtos")).toBeInTheDocument();
    expect(vi.mocked(createProduct)).not.toHaveBeenCalled();
  });
});

describe("Produto — item de produto acabado na página", () => {
  it("o item nasce com o produto, e os três controles não têm interruptor", async () => {
    renderPage();
    await screen.findByLabelText(/Cliente/);

    // Não se escolhe um item existente: ele é criado na mesma transação.
    expect(screen.queryByLabelText(/Item de produto acabado/)).not.toBeInTheDocument();
    expect(screen.getByText(/criado automaticamente ao salvar/i)).toBeInTheDocument();

    // Lote, validade e liberação da Qualidade são padrão da casa: oferecer
    // um interruptor daria a impressão de que dá para produzir acabado sem
    // lote, o que o sistema não permite. O laudo é o único que varia.
    expect(screen.getByLabelText(/Exige CoA \/ Laudo/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Controla lote/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Controla validade/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/liberação da Qualidade/)).not.toBeInTheDocument();
  });

  it("unidade de estoque e exigência de laudo vão no payload", async () => {
    const user = userEvent.setup();
    renderPage();

    await escolherCliente(user);
    await user.type(screen.getByLabelText(/^Nome/), "Coenzima Q10");
    await user.selectOptions(screen.getByLabelText(/Unidade de estoque/), "kg");
    await user.click(screen.getByLabelText(/Exige CoA \/ Laudo/));
    await user.click(screen.getByRole("button", { name: /Criar produto/ }));

    await waitFor(() => {
      expect(vi.mocked(createProduct)).toHaveBeenCalledWith(
        expect.objectContaining({ finishedUnitCode: "kg", finishedRequiresCoa: true }),
      );
    });
  });
});

describe("Produto — alvo da criação contextual", () => {
  function contextoDePedido(context?: Record<string, unknown>) {
    return startContextualCreate({
      originRoute: "/comercial/pedidos/novo",
      fieldKey: "productId",
      entityType: "product",
      draft: { lines: "rascunho do pedido" },
      ...(context ? { context } : {}),
    })!;
  }

  it("salvar devolve à origem em vez de ir para a lista", async () => {
    const user = userEvent.setup();
    const token = contextoDePedido();
    renderPage(`/cadastros/produtos/novo?${PARAM_ORIGEM}=${token}`);

    // A tela diz PARA ONDE volta — "Voltar" sozinho não informa nada.
    expect(await screen.findByRole("button", { name: /Voltar para Pedido/ })).toBeInTheDocument();

    await escolherCliente(user);
    await user.type(screen.getByLabelText(/^Nome/), "Coenzima Q10 60 cápsulas");
    await user.click(screen.getByRole("button", { name: /Criar produto/ }));

    expect(await screen.findByText("pedido em edição")).toBeInTheDocument();
    expect(screen.queryByText("listagem de produtos")).not.toBeInTheDocument();
    expect(urlAtual()).toBe(`/comercial/pedidos/novo?${PARAM_RETOMAR}=${token}`);
    // Pelo id, sempre: casar por nome selecionaria o registro errado.
    expect(readContextualCreate(token)?.result).toEqual({
      entityType: "product",
      entityId: PRODUTO_SALVO.id,
      label: PRODUTO_SALVO.name,
    });
  });

  it("cancelar devolve à origem sem resultado", async () => {
    const user = userEvent.setup();
    const token = contextoDePedido();
    renderPage(`/cadastros/produtos/novo?${PARAM_ORIGEM}=${token}`);

    await user.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("pedido em edição")).toBeInTheDocument();
    expect(readContextualCreate(token)?.result).toBeUndefined();
  });

  it("cliente mandado pela origem é fato, não campo", async () => {
    const user = userEvent.setup();
    const token = contextoDePedido({
      customerId: CLIENTE.id,
      customerLabel: CLIENTE.legalName,
    });
    renderPage(`/cadastros/produtos/novo?${PARAM_ORIGEM}=${token}`);

    // Sem campo não há divergência possível: o pedido já é deste cliente.
    expect(await screen.findByText(/THIAGO LUZ DE SOUZA/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Cliente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Novo cliente/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Nome/), "Coenzima Q10");
    await user.click(screen.getByRole("button", { name: /Criar produto/ }));

    await waitFor(() => {
      expect(vi.mocked(createProduct)).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CLIENTE.id }),
      );
    });
  });

  it("contexto de outro tipo de entidade é ignorado — vira cadastro normal", async () => {
    const token = startContextualCreate({
      originRoute: "/compras/ordens/nova",
      fieldKey: "supplierId",
      entityType: "supplier",
      draft: {},
    })!;
    renderPage(`/cadastros/produtos/novo?${PARAM_ORIGEM}=${token}`);

    await screen.findByLabelText(/Cliente/);
    expect(screen.queryByRole("button", { name: /Voltar para/ })).not.toBeInTheDocument();
  });
});

describe("Produto — origem da criação contextual de Cliente", () => {
  it("'+ Novo cliente' NAVEGA e guarda o rascunho", async () => {
    const user = userEvent.setup();
    renderPage();

    const nome = await screen.findByLabelText(/^Nome/);
    await user.type(nome, "Produto em andamento");

    const campo = screen.getByLabelText(/Cliente/);
    await user.type(campo, "Cliente que ainda não existe");
    await user.click(await screen.findByRole("option", { name: /Novo cliente/ }));

    // Navegou de verdade: a tela de cliente é outra ROTA, não uma camada por
    // cima. Fora do modal não existe `<form>` de cliente para aninhar no
    // `<form>` de produto — o motivo do modal hospedar o cadastro some aqui.
    expect(await screen.findByText("cadastro de cliente")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Nome/)).not.toBeInTheDocument();

    const url = urlAtual();
    expect(url.startsWith(`/cadastros/clientes/novo?${PARAM_ORIGEM}=`)).toBe(true);

    const token = new URLSearchParams(url.split("?")[1]).get(PARAM_ORIGEM)!;
    const registro = readContextualCreate(token);
    expect(registro?.fieldKey).toBe("customerId");
    expect(registro?.entityType).toBe("customer");
    expect(registro?.originRoute).toBe("/cadastros/produtos/novo");
    expect(registro?.draft).toMatchObject({ name: "Produto em andamento" });
    // Só o formulário: lista carregada do servidor não é rascunho.
    expect(registro?.draft).not.toHaveProperty("units");
    expect(registro?.draft).not.toHaveProperty("customerOptions");
  });

  it("volta com o rascunho intacto e o cliente novo selecionado", async () => {
    const token = startContextualCreate({
      originRoute: "/cadastros/produtos/novo",
      fieldKey: "customerId",
      entityType: "customer",
      draft: { name: "Produto em andamento", notes: "amostra para validação" },
    })!;
    // Foi o que a tela oficial de Cliente registrou ao salvar.
    finishContextualCreate(token, {
      entityType: "customer",
      entityId: "cli-2",
      label: "Nutri Nova Ltda",
    });

    renderPage(`/cadastros/produtos/novo?${PARAM_RETOMAR}=${token}`);

    expect(await screen.findByDisplayValue("Produto em andamento")).toBeInTheDocument();
    expect(screen.getByDisplayValue("amostra para validação")).toBeInTheDocument();
    // Selecionado pelo id; o rótulo só ocupa o campo até a busca devolver o
    // registro real.
    expect(await screen.findByDisplayValue(/Nutri Nova Ltda/)).toBeInTheDocument();

    // O `?retomar=` some da URL: um F5 não pode tentar retomar de novo.
    await waitFor(() => expect(urlAtual()).toBe("/cadastros/produtos/novo"));
    expect(readContextualCreate(token)).toBeNull();
  });

  it("voltar sem cadastrar devolve o rascunho e não seleciona ninguém", async () => {
    const token = startContextualCreate({
      originRoute: "/cadastros/produtos/novo",
      fieldKey: "customerId",
      entityType: "customer",
      draft: { name: "Produto em andamento" },
    })!;

    renderPage(`/cadastros/produtos/novo?${PARAM_RETOMAR}=${token}`);

    expect(await screen.findByDisplayValue("Produto em andamento")).toBeInTheDocument();
    // Sem resultado no registro, o campo continua vazio — nada foi escolhido.
    expect(screen.getByLabelText(/Cliente/)).toHaveValue("");
  });
});
