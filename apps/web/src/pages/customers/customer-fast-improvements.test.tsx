import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * Tela de Cliente: validação inline, máscaras, preenchimento por CEP e o
 * bloco de informações do cadastro.
 *
 * O ViaCEP é mockado — teste de tela não depende de internet, e o que
 * importa aqui é o que a tela faz com cada resposta possível.
 *
 * O cadastro tem duas portas — o modal e a página `/cadastros/clientes/novo`
 * — e os campos vêm do mesmo módulo (`customer-form`). Os blocos do fim
 * cobrem o que difere entre elas, e repetem PELA PÁGINA as validações que já
 * eram cobertas pelo modal: é a prova de que a extração não deixou uma das
 * portas mais permissiva que a outra.
 */

vi.mock("../../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("../../lib/cep-api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/cep-api")>(
    "../../lib/cep-api",
  );
  return { ...actual, lookupCep: vi.fn() };
});

import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { lookupCep } from "../../lib/cep-api";
import {
  discardContextualCreate,
  readContextualCreate,
  startContextualCreate,
} from "../../lib/contextual-create";
import { CustomerFormModal } from "./CustomerFormModal";
import { CustomerCreatePage } from "./CustomerCreatePage";

const ENDERECO_SAO_PAULO = {
  street: "Rua Vicente José de Almeida",
  district: "Cupecê",
  city: "São Paulo",
  state: "SP",
};

function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "IGEIA Suplementos LTDA",
    tradeName: "IGEIA",
    cnpj: "11222333000181",
    email: "contato@igeia.com.br",
    phone: "11999998888",
    street: "Rua das Acácias",
    number: "158",
    complement: "Sala 2",
    district: "Cupecê",
    zipCode: "04816100",
    city: "São Paulo",
    state: "SP",
    notes: null,
    businessLotSuffix: null,
    active: true,
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: "João Silva",
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: "Maria Souza",
    ...overrides,
  };
}

function renderNovo() {
  return render(
    <MemoryRouter>
      <CustomerFormModal mode="create" customer={null} onClose={() => {}} onSaved={() => {}} />
    </MemoryRouter>,
  );
}

function renderEdicao(customer: CustomerDTO) {
  return render(
    <MemoryRouter>
      <CustomerFormModal
        mode="edit"
        customer={customer}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

/**
 * A página com as rotas que ela pode alcançar: a lista, para onde o caminho
 * direto termina, e uma tela de origem, para onde a criação contextual volta.
 */
function renderPagina(entrada = "/cadastros/clientes/novo") {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/cadastros/clientes/novo" element={<CustomerCreatePage />} />
        <Route path="/cadastros/clientes" element={<p>lista de clientes</p>} />
        <Route path="/comercial/pedidos" element={<p>tela de origem</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const campo = (label: string) => screen.getByLabelText(label, { exact: false });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(lookupCep).mockReset();
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
});

describe("Cliente — erros inline", () => {
  it("mostra o erro de e-mail junto ao campo, não só em toast", () => {
    renderNovo();

    const email = campo("Email");
    fireEvent.change(email, { target: { value: "contato@" } });
    fireEvent.blur(email);

    const erro = screen.getByText("E-mail inválido.");
    expect(erro).toBeTruthy();
    // A mensagem é anunciada junto do campo, não solta na página.
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(erro.id);
  });

  it("mostra o erro de telefone curto com a mensagem combinada", () => {
    renderNovo();

    const telefone = campo("Telefone");
    fireEvent.change(telefone, { target: { value: "123232" } });
    fireEvent.blur(telefone);

    expect(screen.getByText("Informe um telefone com DDD.")).toBeTruthy();
    expect(telefone.getAttribute("aria-invalid")).toBe("true");
  });

  it("mostra o erro de CNPJ inválido", () => {
    renderNovo();

    const cnpj = campo("CNPJ");
    fireEvent.change(cnpj, { target: { value: "11222333000180" } });
    fireEvent.blur(cnpj);

    expect(screen.getByText("CNPJ inválido.")).toBeTruthy();
  });

  it("o erro some assim que o operador começa a corrigir", () => {
    renderNovo();

    const email = campo("Email");
    fireEvent.change(email, { target: { value: "contato@" } });
    fireEvent.blur(email);
    expect(screen.queryByText("E-mail inválido.")).toBeTruthy();

    fireEvent.change(email, { target: { value: "contato@veridi.com.br" } });
    expect(screen.queryByText("E-mail inválido.")).toBeNull();
  });

  it("não envia ao servidor enquanto houver campo inválido", async () => {
    renderNovo();

    fireEvent.change(campo("Razão Social"), { target: { value: "Cliente X" } });
    fireEvent.change(campo("Telefone"), { target: { value: "123232" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => {
      expect(screen.getByText("Corrija os campos destacados.")).toBeTruthy();
    });
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

describe("Cliente — máscaras", () => {
  it("formata o telefone durante a digitação", () => {
    renderNovo();

    const telefone = campo("Telefone") as HTMLInputElement;
    fireEvent.change(telefone, { target: { value: "11999998888" } });

    expect(telefone.value).toBe("(11) 99999-8888");
  });

  it("mascara o CNPJ sem destruir as letras do formato alfanumérico", () => {
    renderNovo();

    const cnpj = campo("CNPJ") as HTMLInputElement;
    fireEvent.change(cnpj, { target: { value: "00000000e08g12" } });

    expect(cnpj.value).toBe("00.000.000/E08G-12");
    // O campo é texto: `type="number"` descartaria as letras.
    expect(cnpj.getAttribute("type")).toBe("text");
  });

  it("aceita o CNPJ alfanumérico como válido e envia normalizado", async () => {
    renderNovo();

    fireEvent.change(campo("Razão Social"), { target: { value: "Cliente Alfa" } });
    const cnpj = campo("CNPJ");
    fireEvent.change(cnpj, { target: { value: "00000000e08g12" } });
    fireEvent.blur(cnpj);

    expect(screen.queryByText("CNPJ inválido.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(vi.mocked(createCustomer).mock.calls[0]?.[0]).toMatchObject({
      cnpj: "00000000E08G12",
    });
  });

  it("formata o CEP durante a digitação", () => {
    renderNovo();

    const cep = campo("CEP") as HTMLInputElement;
    fireEvent.change(cep, { target: { value: "04816100" } });

    expect(cep.value).toBe("04816-100");
  });
});

describe("Cliente — CEP automático", () => {
  it("mostra o estado de carregamento durante a consulta", async () => {
    let resolver: (value: { status: "not_found" }) => void = () => {};
    vi.mocked(lookupCep).mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    renderNovo();
    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "04816100" } });
    fireEvent.blur(cep);

    await waitFor(() => expect(screen.getByText("Buscando endereço…")).toBeTruthy());
    resolver({ status: "not_found" });
  });

  it("preenche logradouro, bairro, cidade e UF — e nunca o número", async () => {
    vi.mocked(lookupCep).mockResolvedValue({
      status: "found",
      address: ENDERECO_SAO_PAULO,
    });

    renderNovo();
    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "04816100" } });
    fireEvent.blur(cep);

    await waitFor(() => {
      expect((campo("Logradouro") as HTMLInputElement).value).toBe(
        ENDERECO_SAO_PAULO.street,
      );
    });
    expect((campo("Bairro") as HTMLInputElement).value).toBe(ENDERECO_SAO_PAULO.district);
    expect((campo("Cidade") as HTMLInputElement).value).toBe(ENDERECO_SAO_PAULO.city);
    expect((campo("UF") as HTMLSelectElement).value).toBe("SP");
    // Número é do operador: a consulta não sabe qual é.
    expect((campo("Número") as HTMLInputElement).value).toBe("");
  });

  it("CEP inexistente: avisa e deixa o cadastro seguir manualmente", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ status: "not_found" });

    renderNovo();
    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "99999999" } });
    fireEvent.blur(cep);

    await waitFor(() => {
      expect(
        screen.getByText("CEP não encontrado. Preencha o endereço manualmente."),
      ).toBeTruthy();
    });

    // O formulário continua utilizável.
    fireEvent.change(campo("Logradouro"), { target: { value: "Rua Digitada" } });
    expect((campo("Logradouro") as HTMLInputElement).value).toBe("Rua Digitada");
  });

  it("serviço indisponível: avisa e não bloqueia o cadastro", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ status: "unavailable" });

    renderNovo();
    fireEvent.change(campo("Razão Social"), { target: { value: "Cliente Offline" } });
    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "04816100" } });
    fireEvent.blur(cep);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.",
        ),
      ).toBeTruthy();
    });

    fireEvent.change(campo("Logradouro"), { target: { value: "Rua Manual" } });
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(vi.mocked(createCustomer).mock.calls[0]?.[0]).toMatchObject({
      street: "Rua Manual",
      number: "158",
    });
  });

  it("não sobrescreve o que o operador digitou", async () => {
    vi.mocked(lookupCep).mockResolvedValue({
      status: "found",
      address: ENDERECO_SAO_PAULO,
    });

    renderNovo();
    fireEvent.change(campo("Logradouro"), { target: { value: "Rua que eu digitei" } });
    fireEvent.change(campo("Complemento"), { target: { value: "Bloco B" } });

    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "04816100" } });
    fireEvent.blur(cep);

    await waitFor(() => {
      expect((campo("Cidade") as HTMLInputElement).value).toBe(ENDERECO_SAO_PAULO.city);
    });
    // O que era do operador continua sendo dele.
    expect((campo("Logradouro") as HTMLInputElement).value).toBe("Rua que eu digitei");
    expect((campo("Complemento") as HTMLInputElement).value).toBe("Bloco B");
  });

  it("troca de CEP atualiza o que a consulta anterior tinha preenchido", async () => {
    vi.mocked(lookupCep).mockResolvedValueOnce({
      status: "found",
      address: ENDERECO_SAO_PAULO,
    });

    renderNovo();
    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "04816100" } });
    fireEvent.blur(cep);
    await waitFor(() => {
      expect((campo("Cidade") as HTMLInputElement).value).toBe("São Paulo");
    });

    vi.mocked(lookupCep).mockResolvedValueOnce({
      status: "found",
      address: {
        street: "Avenida Paulista",
        district: "Bela Vista",
        city: "Campinas",
        state: "SP",
      },
    });
    fireEvent.change(cep, { target: { value: "13010000" } });
    fireEvent.blur(cep);

    await waitFor(() => {
      expect((campo("Cidade") as HTMLInputElement).value).toBe("Campinas");
    });
    expect((campo("Logradouro") as HTMLInputElement).value).toBe("Avenida Paulista");
  });
});

describe("Cliente — informações do cadastro", () => {
  it("mostra data e autor de criação e da última alteração", () => {
    renderEdicao(cliente());

    expect(screen.getByText("Informações do cadastro")).toBeTruthy();
    expect(screen.getByText("João Silva")).toBeTruthy();
    expect(screen.getByText("Maria Souza")).toBeTruthy();
    expect(screen.getByText("Cadastrado em")).toBeTruthy();
    expect(screen.getByText("Última alteração")).toBeTruthy();
  });

  it("registro sem autoria conhecida diz \"Não disponível\", sem atribuir a ninguém", () => {
    renderEdicao(cliente({ createdByName: null, updatedByName: null }));

    expect(screen.getAllByText("Não disponível").length).toBe(2);
    expect(screen.getByText(/importado do sistema anterior/)).toBeTruthy();
  });

  it("não mostra o bloco em cliente ainda não salvo", () => {
    renderNovo();

    expect(screen.queryByText("Informações do cadastro")).toBeNull();
  });

  it("exibe telefone e CEP já mascarados ao abrir a edição", () => {
    renderEdicao(cliente());

    expect((campo("Telefone") as HTMLInputElement).value).toBe("(11) 99999-8888");
    expect((campo("CEP") as HTMLInputElement).value).toBe("04816-100");
  });
});

describe("Cliente — página oficial de criação", () => {
  it("acesso direto: salva e termina na lista", async () => {
    renderPagina();

    fireEvent.change(campo("Razão Social"), { target: { value: "Nutrição Viva Ltda" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(vi.mocked(createCustomer).mock.calls[0]?.[0]).toMatchObject({
      legalName: "Nutrição Viva Ltda",
    });
    expect(await screen.findByText("lista de clientes")).toBeTruthy();
  });

  it("acesso direto: cancelar volta para a lista sem salvar", async () => {
    renderPagina();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("lista de clientes")).toBeTruthy();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("a trilha é a canônica, não o caminho de volta", () => {
    renderPagina();

    const trilha = screen.getByRole("navigation", { name: "Trilha da página" });
    expect(trilha.textContent).toContain("Cadastros");
    expect(trilha.textContent).toContain("Clientes");
    expect(trilha.textContent).toContain("Novo cliente");
    // Fora do modo contextual não há para onde voltar além da lista.
    expect(screen.queryByRole("button", { name: /Voltar para/ })).toBeNull();
  });

  it("os blocos que só existem em edição continuam fora da criação", () => {
    renderPagina();

    expect(screen.queryByText("Informações do cadastro")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Consulta completa")).toBeNull();
  });
});

describe("Cliente — a página recusa o que o modal recusa", () => {
  /*
   * Mesmas três validações já cobertas pelo modal, agora exercidas pela
   * página. Não é repetição ociosa: elas são o motivo de o formulário ter
   * virado módulo compartilhado, e uma porta que aceitasse um CNPJ inválido
   * só apareceria no dia em que o registro entrasse por ela.
   */
  it("e-mail inválido é recusado na tela, junto do campo", () => {
    renderPagina();

    const email = campo("Email");
    fireEvent.change(email, { target: { value: "contato@" } });
    fireEvent.blur(email);

    const erro = screen.getByText("E-mail inválido.");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(erro.id);
  });

  it("telefone sem DDD é recusado na tela", () => {
    renderPagina();

    const telefone = campo("Telefone");
    fireEvent.change(telefone, { target: { value: "123232" } });
    fireEvent.blur(telefone);

    expect(screen.getByText("Informe um telefone com DDD.")).toBeTruthy();
    expect(telefone.getAttribute("aria-invalid")).toBe("true");
  });

  it("CNPJ inválido é recusado na tela, e o alfanumérico continua passando", () => {
    renderPagina();

    const cnpj = campo("CNPJ");
    fireEvent.change(cnpj, { target: { value: "11222333000180" } });
    fireEvent.blur(cnpj);
    expect(screen.getByText("CNPJ inválido.")).toBeTruthy();

    fireEvent.change(cnpj, { target: { value: "00000000e08g12" } });
    fireEvent.blur(cnpj);
    expect(screen.queryByText("CNPJ inválido.")).toBeNull();
    expect((cnpj as HTMLInputElement).value).toBe("00.000.000/E08G-12");
  });

  it("campo inválido segura o envio e a pessoa continua na tela", async () => {
    renderPagina();

    fireEvent.change(campo("Razão Social"), { target: { value: "Cliente X" } });
    fireEvent.change(campo("Telefone"), { target: { value: "123232" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => {
      expect(screen.getByText("Corrija os campos destacados.")).toBeTruthy();
    });
    expect(createCustomer).not.toHaveBeenCalled();
    // Nada de navegar: o formulário fica onde está, com o que foi digitado.
    expect(screen.queryByText("lista de clientes")).toBeNull();
    expect((campo("Razão Social") as HTMLInputElement).value).toBe("Cliente X");
  });

  it("o CEP continua preenchendo o endereço pela página", async () => {
    vi.mocked(lookupCep).mockResolvedValue({
      status: "found",
      address: ENDERECO_SAO_PAULO,
    });

    renderPagina();
    const cep = campo("CEP");
    fireEvent.change(cep, { target: { value: "04816100" } });
    fireEvent.blur(cep);

    await waitFor(() => {
      expect((campo("Cidade") as HTMLInputElement).value).toBe(ENDERECO_SAO_PAULO.city);
    });
    // Número é do operador: a consulta não sabe qual é.
    expect((campo("Número") as HTMLInputElement).value).toBe("");
  });
});

describe("Cliente — criação contextual", () => {
  function abrirComContexto() {
    const token = startContextualCreate({
      originRoute: "/comercial/pedidos",
      fieldKey: "customerId",
      entityType: "customer",
      draft: { observacao: "pedido pela metade" },
    })!;
    renderPagina(`/cadastros/clientes/novo?origem=${token}`);
    return token;
  }

  it("salvar devolve à origem com o cliente registrado, em vez de ir para a lista", async () => {
    const token = abrirComContexto();

    // O botão diz PARA ONDE volta — quem saiu do meio de um documento
    // precisa saber disso antes de clicar.
    expect(screen.getByRole("button", { name: "← Voltar para Pedido" })).toBeTruthy();

    fireEvent.change(campo("Razão Social"), { target: { value: "Nutrição Viva Ltda" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    expect(await screen.findByText("tela de origem")).toBeTruthy();
    expect(screen.queryByText("lista de clientes")).toBeNull();
    // O registro criado viaja pelo id: casar por nome escolheria outro.
    expect(readContextualCreate(token)?.result).toMatchObject({
      entityType: "customer",
      entityId: "cli-1",
      label: "IGEIA Suplementos LTDA",
    });
  });

  it("cancelar também devolve à origem — sem resultado, com o rascunho de pé", async () => {
    const token = abrirComContexto();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("tela de origem")).toBeTruthy();
    expect(screen.queryByText("lista de clientes")).toBeNull();
    const registro = readContextualCreate(token);
    // Sem `result` a origem entende cancelamento; o rascunho ainda é dela.
    expect(registro?.result).toBeUndefined();
    expect(registro?.draft).toMatchObject({ observacao: "pedido pela metade" });
    discardContextualCreate(token);
  });

  it("a trilha continua canônica mesmo vindo de um documento", () => {
    abrirComContexto();

    const trilha = screen.getByRole("navigation", { name: "Trilha da página" });
    // De onde a pessoa veio é caminho de volta, não hierarquia: "Pedido" só
    // aparece no botão de retorno.
    expect(trilha.textContent).toContain("Cadastros");
    expect(trilha.textContent).toContain("Clientes");
    expect(trilha.textContent).not.toContain("Pedido");
  });

  it("contexto de outro tipo de entidade não sequestra a tela", async () => {
    const token = startContextualCreate({
      originRoute: "/comercial/pedidos",
      fieldKey: "supplierId",
      entityType: "supplier",
      draft: {},
    })!;
    renderPagina(`/cadastros/clientes/novo?origem=${token}`);

    expect(screen.queryByRole("button", { name: /Voltar para/ })).toBeNull();

    fireEvent.change(campo("Razão Social"), { target: { value: "Nutrição Viva Ltda" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    // Comporta-se como criação normal: a lista, não a origem alheia.
    expect(await screen.findByText("lista de clientes")).toBeTruthy();
  });
});
