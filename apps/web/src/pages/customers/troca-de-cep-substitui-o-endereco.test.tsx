import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * Trocar o CEP substitui o endereço — CUSTOMER-CEP-02.
 *
 * O endereço na tela pertence a UM CEP. Enquanto o CEP não muda, o que o
 * operador digitou é dele e nada sobrescreve. No instante em que o CEP muda,
 * o bloco inteiro deixa de ser confiável: logradouro, NÚMERO, COMPLEMENTO,
 * bairro, cidade e UF vão embora antes da nova consulta. O que a Veridi
 * relatou era o contrário — campos do endereço anterior sobrevivendo debaixo
 * do CEP novo e formando um endereço híbrido que vai impresso assim.
 *
 * Número e complemento são o ponto fino: a consulta não os conhece, então
 * nunca eram tocados; mas eles pertencem ao endereço anterior tanto quanto a
 * rua, e o ViaCEP não prova que continuam válidos no CEP novo.
 *
 * A corrida tem suíte própria mais abaixo, com as promessas controladas à
 * mão: `sleep` provaria o relógio da máquina, não a regra.
 *
 * O ViaCEP é mockado — teste de tela não depende de internet.
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
import type { CepLookupResult } from "../../lib/cep-api";
import { CustomerFormModal } from "./CustomerFormModal";

const CEP_A = "04816100";
const CEP_B = "13010000";

const ENDERECO_A = {
  street: "Rua Vicente José de Almeida",
  district: "Cupecê",
  city: "São Paulo",
  state: "SP",
};

const ENDERECO_B = {
  street: "Avenida Francisco Glicério",
  district: "Centro",
  city: "Campinas",
  state: "SP",
};

const achou = (address: typeof ENDERECO_A): CepLookupResult => ({
  status: "found",
  address,
});

function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "IGEIA Suplementos LTDA",
    tradeName: "IGEIA",
    cnpj: "11222333000181",
    email: "contato@igeia.com.br",
    phone: "11999998888",
    taxProfile: "NOT_INFORMED",
    street: ENDERECO_A.street,
    number: "158",
    complement: "Sala 2",
    district: ENDERECO_A.district,
    zipCode: CEP_A,
    city: ENDERECO_A.city,
    state: ENDERECO_A.state,
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
      <CustomerFormModal mode="edit" customer={customer} onClose={() => {}} onSaved={() => {}} />
    </MemoryRouter>,
  );
}

const campo = (label: string) =>
  screen.getByLabelText(label, { exact: false }) as HTMLInputElement;

/** O bloco de endereço como a tela o mostra, para afirmar sobre ele de uma vez. */
function enderecoNaTela() {
  return {
    logradouro: campo("Logradouro").value,
    numero: campo("Número").value,
    complemento: campo("Complemento").value,
    bairro: campo("Bairro").value,
    cidade: campo("Cidade").value,
    uf: (screen.getByLabelText("UF", { exact: false }) as HTMLSelectElement).value,
  };
}

const VAZIO = {
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

/** Digita o CEP e sai do campo — que é quando a tela consulta. */
function digitarCep(valor: string) {
  const cep = campo("CEP");
  fireEvent.change(cep, { target: { value: valor } });
  fireEvent.blur(cep);
}

/**
 * Uma resposta de CEP que só chega quando esta suíte mandar.
 *
 * É o que permite afirmar sobre a ORDEM — B responde, A responde depois — sem
 * depender de tempo. `act` envolve a resolução porque quem a recebe atualiza
 * estado do React fora de um evento.
 */
function respostaControlada() {
  let entregar: (result: CepLookupResult) => void = () => {};
  const promessa = new Promise<CepLookupResult>((resolve) => {
    entregar = resolve;
  });
  return {
    promessa,
    responder: async (result: CepLookupResult) => {
      await act(async () => {
        entregar(result);
        await promessa;
      });
    },
  };
}

beforeEach(() => {
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(lookupCep).mockReset();
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
});

describe("Cliente — o endereço pertence ao CEP", () => {
  it("CEP A resolvido preenche o endereço de A", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);

    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    expect(enderecoNaTela()).toEqual({
      logradouro: ENDERECO_A.street,
      // A consulta não sabe número nem complemento: quem preenche é o operador.
      numero: "",
      complemento: "",
      bairro: ENDERECO_A.district,
      cidade: ENDERECO_A.city,
      uf: "SP",
    });
  });

  it("trocar A por B limpa TUDO de A — inclusive número e complemento", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    fireEvent.change(campo("Complemento"), { target: { value: "Sala 2" } });

    /*
     * A consulta de B fica pendente de propósito: o endereço de A tem de sumir
     * ANTES de a resposta de B chegar. Esperar a rede para parar de mostrar o
     * endereço errado é mostrar o endereço errado pelo tempo que a rede levar.
     */
    const b = respostaControlada();
    vi.mocked(lookupCep).mockReturnValue(b.promessa);
    fireEvent.change(campo("CEP"), { target: { value: CEP_B } });

    expect(enderecoNaTela()).toEqual(VAZIO);

    fireEvent.blur(campo("CEP"));
    await b.responder(achou(ENDERECO_B));
    expect(enderecoNaTela()).toEqual({
      logradouro: ENDERECO_B.street,
      numero: "",
      complemento: "",
      bairro: ENDERECO_B.district,
      cidade: ENDERECO_B.city,
      uf: "SP",
    });
  });

  it("o mesmo CEP em outra máscara não limpa nada", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    fireEvent.change(campo("Número"), { target: { value: "158" } });

    // `04816-100` e `04816100` são o mesmo CEP: mudar a máscara não é trocar
    // de endereço.
    fireEvent.change(campo("CEP"), { target: { value: "04816-100" } });
    fireEvent.blur(campo("CEP"));

    expect(campo("CEP").value).toBe("04816-100");
    expect(enderecoNaTela()).toEqual({
      logradouro: ENDERECO_A.street,
      numero: "158",
      complemento: "",
      bairro: ENDERECO_A.district,
      cidade: ENDERECO_A.city,
      uf: "SP",
    });
    // E não gastou uma segunda consulta com o CEP que já está na tela.
    expect(vi.mocked(lookupCep)).toHaveBeenCalledTimes(1);
  });

  it("CEP incompleto não consulta — e não restaura o endereço anterior", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    vi.mocked(lookupCep).mockClear();

    fireEvent.change(campo("CEP"), { target: { value: "1301" } });
    fireEvent.blur(campo("CEP"));

    expect(vi.mocked(lookupCep)).not.toHaveBeenCalled();
    // Enquanto o CEP novo está pela metade, o endereço de A já não vale.
    expect(enderecoNaTela()).toEqual(VAZIO);
  });

  it("CEP completo consulta uma vez, e sair do campo de novo não repete", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));

    fireEvent.blur(campo("CEP"));
    fireEvent.blur(campo("CEP"));

    expect(vi.mocked(lookupCep)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lookupCep)).toHaveBeenCalledWith(CEP_A);
  });

  it("campo que a resposta não traz fica vazio, não herda o do CEP anterior", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));

    // B é um CEP de município inteiro: o ViaCEP responde sem logradouro nem
    // bairro. Herdar os de A daria "Rua Vicente José de Almeida, Campinas".
    vi.mocked(lookupCep).mockResolvedValue(
      achou({ street: "", district: "", city: "Campinas", state: "SP" }),
    );
    digitarCep(CEP_B);

    await waitFor(() => expect(campo("Cidade").value).toBe("Campinas"));
    expect(enderecoNaTela()).toEqual({ ...VAZIO, cidade: "Campinas", uf: "SP" });
  });

  it("consulta indisponível não restaura A e deixa digitar à mão", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));

    vi.mocked(lookupCep).mockResolvedValue({ status: "unavailable" });
    digitarCep(CEP_B);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.",
        ),
      ).toBeTruthy(),
    );
    expect(enderecoNaTela()).toEqual(VAZIO);

    fireEvent.change(campo("Logradouro"), { target: { value: "Rua Digitada" } });
    fireEvent.change(campo("Número"), { target: { value: "900" } });
    expect(campo("Logradouro").value).toBe("Rua Digitada");
    expect(campo("Número").value).toBe("900");
  });

  it("CEP não encontrado não restaura A e deixa digitar à mão", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));

    vi.mocked(lookupCep).mockResolvedValue({ status: "not_found" });
    digitarCep("99999999");

    await waitFor(() =>
      expect(
        screen.getByText("CEP não encontrado. Preencha o endereço manualmente."),
      ).toBeTruthy(),
    );
    expect(enderecoNaTela()).toEqual(VAZIO);

    fireEvent.change(campo("Cidade"), { target: { value: "Cidade Digitada" } });
    expect(campo("Cidade").value).toBe("Cidade Digitada");
  });

  it("sob o MESMO CEP, a correção manual é preservada", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));

    fireEvent.change(campo("Logradouro"), { target: { value: "Rua Corrigida à Mão" } });
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    // Voltar ao campo do CEP e sair não pode reescrever o que o operador
    // acabou de corrigir.
    fireEvent.blur(campo("CEP"));

    await waitFor(() => expect(campo("Logradouro").value).toBe("Rua Corrigida à Mão"));
    expect(campo("Número").value).toBe("158");
    expect(vi.mocked(lookupCep)).toHaveBeenCalledTimes(1);
  });

  it("trocar o CEP DEPOIS da correção manual apaga a correção junto", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    fireEvent.change(campo("Logradouro"), { target: { value: "Rua Corrigida à Mão" } });
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    fireEvent.change(campo("Complemento"), { target: { value: "Sala 2" } });

    // A correção é do endereço de A. Sem CEP A, ela não prova nada.
    fireEvent.change(campo("CEP"), { target: { value: CEP_B } });

    expect(enderecoNaTela()).toEqual(VAZIO);
  });

  it("apagar o CEP não deixa o endereço órfão na tela", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    fireEvent.change(campo("Número"), { target: { value: "158" } });

    fireEvent.change(campo("CEP"), { target: { value: "" } });

    expect(enderecoNaTela()).toEqual(VAZIO);
    // E o cadastro manual sem CEP continua possível — não virou proibição.
    fireEvent.change(campo("Cidade"), { target: { value: "Sorocaba" } });
    expect(campo("Cidade").value).toBe("Sorocaba");
  });

  it("A → B → A não ressuscita número nem complemento de A", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    fireEvent.change(campo("Complemento"), { target: { value: "Sala 2" } });

    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_B));
    digitarCep(CEP_B);
    await waitFor(() => expect(campo("Cidade").value).toBe("Campinas"));

    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));

    // Os dados públicos de A voltam pela consulta; número e complemento, não:
    // eram do cadastro, não do CEP.
    expect(enderecoNaTela()).toEqual({
      logradouro: ENDERECO_A.street,
      numero: "",
      complemento: "",
      bairro: ENDERECO_A.district,
      cidade: ENDERECO_A.city,
      uf: "SP",
    });
  });
});

describe("Cliente — abrir e criar não disparam limpeza", () => {
  it("abrir um cliente salvo mostra o endereço dele, sem consultar nada", () => {
    renderEdicao(cliente());

    expect(campo("CEP").value).toBe("04816-100");
    expect(enderecoNaTela()).toEqual({
      logradouro: ENDERECO_A.street,
      numero: "158",
      complemento: "Sala 2",
      bairro: ENDERECO_A.district,
      cidade: ENDERECO_A.city,
      uf: "SP",
    });
    expect(vi.mocked(lookupCep)).not.toHaveBeenCalled();
  });

  it("sair do campo do CEP salvo não reconsulta nem reescreve o cadastro", async () => {
    renderEdicao(cliente());

    fireEvent.change(campo("Logradouro"), { target: { value: "Rua Corrigida no Cadastro" } });
    fireEvent.blur(campo("CEP"));

    await waitFor(() => expect(campo("Logradouro").value).toBe("Rua Corrigida no Cadastro"));
    expect(vi.mocked(lookupCep)).not.toHaveBeenCalled();
    expect(campo("Número").value).toBe("158");
  });

  it("na edição, trocar o CEP do cliente salvo apaga o endereço salvo", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_B));
    renderEdicao(cliente());

    fireEvent.change(campo("CEP"), { target: { value: CEP_B } });

    expect(enderecoNaTela()).toEqual(VAZIO);
  });

  it("na criação, o CEP completa o que está vazio sem apagar o que já foi digitado", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    // Ainda não há CEP dono: este endereço é manual, e o primeiro CEP apenas
    // completa o que falta.
    fireEvent.change(campo("Logradouro"), { target: { value: "Rua que eu digitei" } });
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    digitarCep(CEP_A);

    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    expect(campo("Logradouro").value).toBe("Rua que eu digitei");
    expect(campo("Número").value).toBe("158");
  });
});

describe("Cliente — corrida entre duas consultas de CEP", () => {
  it("A pendente, B responde, A responde depois: fica B", async () => {
    const a = respostaControlada();
    const b = respostaControlada();
    vi.mocked(lookupCep).mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);

    renderNovo();
    digitarCep(CEP_A);
    await waitFor(() => expect(screen.getByText("Buscando endereço…")).toBeTruthy());

    digitarCep(CEP_B);
    await b.responder(achou(ENDERECO_B));
    expect(campo("Cidade").value).toBe("Campinas");

    // A resposta atrasada de A chega para um CEP que não está mais na tela.
    await a.responder(achou(ENDERECO_A));

    expect(campo("CEP").value).toBe("13010-000");
    expect(enderecoNaTela()).toEqual({
      logradouro: ENDERECO_B.street,
      numero: "",
      complemento: "",
      bairro: ENDERECO_B.district,
      cidade: ENDERECO_B.city,
      uf: "SP",
    });
  });

  it("A responde depois que o operador já digitou B: A não preenche nada", async () => {
    const a = respostaControlada();
    vi.mocked(lookupCep).mockReturnValue(a.promessa);

    renderNovo();
    digitarCep(CEP_A);
    await waitFor(() => expect(screen.getByText("Buscando endereço…")).toBeTruthy());

    // B ainda nem foi consultado — o operador só terminou de digitar.
    fireEvent.change(campo("CEP"), { target: { value: CEP_B } });
    await a.responder(achou(ENDERECO_A));

    expect(campo("CEP").value).toBe("13010-000");
    expect(enderecoNaTela()).toEqual(VAZIO);
  });

  it("a FALHA de A também não fala na tela depois que o CEP virou B", async () => {
    const a = respostaControlada();
    vi.mocked(lookupCep).mockReturnValue(a.promessa);

    renderNovo();
    digitarCep(CEP_A);
    await waitFor(() => expect(screen.getByText("Buscando endereço…")).toBeTruthy());

    fireEvent.change(campo("CEP"), { target: { value: CEP_B } });
    await a.responder({ status: "not_found" });

    // O recado seria sobre um CEP que o operador já abandonou.
    expect(
      screen.queryByText("CEP não encontrado. Preencha o endereço manualmente."),
    ).toBeNull();
    expect(screen.queryByText("Buscando endereço…")).toBeNull();
  });
});

describe("Cliente — o que chega no save", () => {
  it("depois da troca, o payload leva o CEP B e o endereço de B — nada de A", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    renderNovo();

    fireEvent.change(campo("Razão Social"), { target: { value: "Cliente da Troca" } });
    digitarCep(CEP_A);
    await waitFor(() => expect(campo("Cidade").value).toBe("São Paulo"));
    fireEvent.change(campo("Número"), { target: { value: "158" } });
    fireEvent.change(campo("Complemento"), { target: { value: "Sala 2" } });

    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_B));
    digitarCep(CEP_B);
    await waitFor(() => expect(campo("Cidade").value).toBe("Campinas"));
    fireEvent.change(campo("Número"), { target: { value: "900" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    const payload = vi.mocked(createCustomer).mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      zipCode: "13010-000",
      street: ENDERECO_B.street,
      district: ENDERECO_B.district,
      city: ENDERECO_B.city,
      state: "SP",
      number: "900",
    });
    // No create, chave vazia não é enviada — o complemento de A não viaja de
    // jeito nenhum.
    expect(payload?.complement).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(ENDERECO_A.street);
    expect(JSON.stringify(payload)).not.toContain("Sala 2");
  });

  it("na edição, o endereço de A é apagado no servidor, não deixado para trás", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_B));
    renderEdicao(cliente());

    digitarCep(CEP_B);
    await waitFor(() => expect(campo("Cidade").value).toBe("Campinas"));

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalled());
    const payload = vi.mocked(updateCustomer).mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      zipCode: "13010-000",
      street: ENDERECO_B.street,
      city: ENDERECO_B.city,
      // O update manda a chave vazia de propósito: é assim que um valor
      // existente é REMOVIDO. Deixar de mandar manteria "158" e "Sala 2" do
      // endereço de A no banco.
      number: "",
      complement: "",
    });
  });
});
