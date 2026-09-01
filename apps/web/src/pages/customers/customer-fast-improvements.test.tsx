import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * Tela de Cliente: validação inline, máscaras, preenchimento por CEP e o
 * bloco de informações do cadastro.
 *
 * O ViaCEP é mockado — teste de tela não depende de internet, e o que
 * importa aqui é o que a tela faz com cada resposta possível.
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
import { CustomerFormModal } from "./CustomerFormModal";

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

const campo = (label: string) => screen.getByLabelText(label, { exact: false });

beforeEach(() => {
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
