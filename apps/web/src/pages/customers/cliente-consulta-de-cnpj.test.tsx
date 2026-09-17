import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CnpjLookupCompany, CnpjLookupResult, CustomerDTO } from "@veridi/shared";

/**
 * Consulta assistida de CNPJ no cadastro do Cliente — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * O provedor é mockado: teste de tela não depende de internet nem de serviço
 * público de terceiro. O que importa aqui é o CONTRATO com o operador —
 * consultar não grava, o vazio da fonte não apaga nada, cancelar não muda
 * campo nenhum, e falha externa não impede o cadastro manual.
 */

vi.mock("../../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("../../lib/cep-api", async (original) => ({
  ...(await original<object>()),
  lookupCep: vi.fn(),
}));
vi.mock("../../lib/cnpj-lookup-api", () => ({ lookupCnpj: vi.fn() }));

import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { lookupCep } from "../../lib/cep-api";
import { lookupCnpj } from "../../lib/cnpj-lookup-api";
import type { CnpjLookupOutcome } from "../../lib/cnpj-lookup-api";
import { CustomerFormModal } from "./CustomerFormModal";

const CNPJ_NA_TELA = "11.444.777/0001-61";
const CNPJ_NORMALIZADO = "11444777000161";

function empresa(overrides: Partial<CnpjLookupCompany> = {}): CnpjLookupCompany {
  return {
    legalName: "VERIDI NUTRITION LTDA",
    tradeName: "VERIDI NUTRITION",
    registrationStatus: "Ativa",
    openedAt: "2019-03-08",
    postalCode: "01310100",
    street: "AVENIDA PAULISTA",
    number: "1000",
    complement: "CONJUNTO 12",
    neighborhood: "BELA VISTA",
    city: "SAO PAULO",
    state: "SP",
    phone: "11987654321",
    email: "CONTATO@VERIDI.COM.BR",
    mainCnaeCode: "1099699",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: "Empresa de Pequeno Porte (EPP)",
    ...overrides,
  };
}

function resultado(overrides: Partial<CnpjLookupCompany> = {}): CnpjLookupResult {
  return {
    provider: "OPEN_CNPJ",
    consultedAt: "2026-09-17T12:30:00.000Z",
    cnpj: CNPJ_NORMALIZADO,
    company: empresa(overrides),
  };
}

function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "VERIDI TESTE LTDA",
    tradeName: null,
    cnpj: CNPJ_NORMALIZADO,
    email: "antigo@veridi.com.br",
    phone: "1133334444",
    taxProfile: "LUCRO_PRESUMIDO",
    street: "Rua Antiga",
    number: "10",
    complement: null,
    district: "Centro",
    zipCode: "18270000",
    city: "Tatuí",
    state: "SP",
    notes: "Observação interna que ninguém de fora escreve.",
    businessLotSuffix: null,
    defaultPaymentInstrument: null,
    defaultPaymentMethod: null,
    defaultDownPaymentPercent: null,
    defaultInstallmentCount: null,
    defaultInstallmentIntervalDays: null,
    defaultMonthlyInterestPercent: null,
    active: true,
    blocked: false,
    status: "ACTIVE",
    block: null,
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: "João Silva",
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: "Maria Souza",
    ...overrides,
  };
}

const campo = (label: string) => screen.getByLabelText(label, { exact: false }) as HTMLInputElement;

function renderNovo() {
  return render(
    <MemoryRouter>
      <CustomerFormModal mode="create" customer={null} onClose={() => {}} onSaved={() => {}} />
    </MemoryRouter>,
  );
}

function renderEdicao(customer: CustomerDTO = cliente(), readOnly = false) {
  return render(
    <MemoryRouter>
      <CustomerFormModal
        mode="edit"
        customer={customer}
        onClose={() => {}}
        onSaved={() => {}}
        readOnly={readOnly}
      />
    </MemoryRouter>,
  );
}

/** Clica em "Consultar CNPJ" e, quando pedido, conclui a consulta. */
async function consultar({ esperarResultado = true } = {}) {
  fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));
  await screen.findByRole("button", { name: "Consultar" });
  fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
  if (esperarResultado) await screen.findByRole("button", { name: "Aplicar selecionados" });
}

/** A linha da tabela de comparação de um campo, pelo rótulo. */
function linha(rotulo: string): HTMLElement {
  const celula = screen.getByRole("cell", { name: rotulo });
  const tr = celula.closest("tr");
  if (!tr) throw new Error(`linha sem <tr>: ${rotulo}`);
  return tr;
}

const caixa = (rotulo: string) =>
  screen.getByRole("checkbox", { name: `Aplicar ${rotulo}` }) as HTMLInputElement;

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(lookupCep).mockReset();
  vi.mocked(lookupCnpj).mockReset();
  vi.mocked(lookupCnpj).mockResolvedValue({ status: "found", result: resultado() });
});

describe("A — o botão Consultar CNPJ", () => {
  it("aparece no cadastro, ao lado do CNPJ", () => {
    renderNovo();
    expect(screen.getByRole("button", { name: "Consultar CNPJ" })).toBeTruthy();
  });

  it("não aparece em consulta: quem não edita o cadastro não preenche nada", () => {
    renderEdicao(cliente(), true);
    expect(screen.queryByRole("button", { name: "Consultar CNPJ" })).toBeNull();
  });

  it("CNPJ vazio: responde no campo e não chama o provedor", async () => {
    renderNovo();

    fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));

    expect(await screen.findByText("Informe o CNPJ para consultar.")).toBeTruthy();
    expect(lookupCnpj).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Fonte da consulta")).toBeNull();
  });

  it("CNPJ inconsistente: a recusa é da tela, e nada sai para o provedor", async () => {
    renderNovo();

    // Dígitos verificadores errados — a MESMA validação do "Salvar".
    fireEvent.change(campo("CNPJ"), { target: { value: "11.444.777/0001-00" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));

    expect(await screen.findByText("CNPJ inválido.")).toBeTruthy();
    expect(lookupCnpj).not.toHaveBeenCalled();
  });
});

describe("B — a fonte da consulta", () => {
  it("o diálogo pede a fonte antes de consultar, e o OpenCNPJ é a que existe", async () => {
    renderNovo();
    fireEvent.change(campo("CNPJ"), { target: { value: CNPJ_NA_TELA } });

    fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));

    const fonte = (await screen.findByLabelText("Fonte da consulta")) as HTMLSelectElement;
    expect([...fonte.options].map((opcao) => opcao.value)).toEqual(["OPEN_CNPJ"]);
    expect([...fonte.options].map((opcao) => opcao.text)).toEqual(["OpenCNPJ"]);
    // Nada foi consultado só por abrir o diálogo.
    expect(lookupCnpj).not.toHaveBeenCalled();
  });

  it("consulta com a fonte escolhida e o CNPJ da tela", async () => {
    renderNovo();
    fireEvent.change(campo("CNPJ"), { target: { value: CNPJ_NA_TELA } });

    await consultar();

    expect(lookupCnpj).toHaveBeenCalledWith(CNPJ_NA_TELA, "OPEN_CNPJ");
  });

  it("mostra a proveniência do que está sendo lido", async () => {
    renderNovo();
    fireEvent.change(campo("CNPJ"), { target: { value: CNPJ_NA_TELA } });

    await consultar();

    expect(screen.getByText(/Fonte:/)).toBeTruthy();
    expect(screen.getByText(/Consultado em:/)).toBeTruthy();
    expect(
      screen.getAllByText("Dados obtidos de fonte pública. Confira as informações antes de salvar.")
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("C, D, L — a comparação e a seleção inicial", () => {
  it("mostra Atual × Retornado campo a campo", async () => {
    renderEdicao();
    await consultar();

    const razao = linha("Razão Social / Nome");
    expect(within(razao).getByText("VERIDI TESTE LTDA")).toBeTruthy();
    expect(within(razao).getByText("VERIDI NUTRITION LTDA")).toBeTruthy();
  });

  it("D — toda diferença começa marcada", async () => {
    renderEdicao();
    await consultar();

    expect(caixa("Razão Social / Nome").checked).toBe(true);
    expect(caixa("Nome Fantasia").checked).toBe(true);
    expect(caixa("Logradouro").checked).toBe(true);
  });

  it("L — valor equivalente aparece como 'Sem alteração' e não se aplica", async () => {
    renderEdicao();
    await consultar();

    // "Tatuí" no cadastro × "SAO PAULO" na fonte seria diferença; aqui o caso
    // é a UF, igual dos dois lados.
    const uf = linha("UF");
    expect(within(uf).getByText("Sem alteração")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Aplicar UF" })).toBeNull();
  });

  it("mostra a informação complementar sem transformá-la em campo do cadastro", async () => {
    renderEdicao();
    await consultar();

    expect(screen.getByText("Outras informações da fonte")).toBeTruthy();
    expect(screen.getByText("Empresa de Pequeno Porte (EPP)")).toBeTruthy();
    // Perfil tributário continua como estava: a fonte não o define (§83).
    expect((campo("Perfil tributário") as unknown as HTMLSelectElement).value).toBe(
      "LUCRO_PRESUMIDO",
    );
  });
});

describe("E, F — aplicar só o escolhido", () => {
  it("F — aplica os campos marcados e deixa o resto intacto", async () => {
    renderEdicao();
    await consultar();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar selecionados" }));

    await waitFor(() => expect(campo("Razão Social").value).toBe("VERIDI NUTRITION LTDA"));
    expect(campo("Nome Fantasia").value).toBe("VERIDI NUTRITION");
    expect(campo("Logradouro").value).toBe("AVENIDA PAULISTA");
    expect(campo("CEP").value).toBe("01310-100");
    expect(campo("Telefone").value).toBe("(11) 98765-4321");
    // A fonte não escreve nota interna, e nem poderia: o campo não é dela.
    expect((campo("Notas internas") as unknown as HTMLTextAreaElement).value).toBe(
      "Observação interna que ninguém de fora escreve.",
    );
  });

  it("E — desmarcar um campo o deixa exatamente como estava", async () => {
    renderEdicao();
    await consultar();

    // "Quero atualizar o endereço, mas não quero trocar o telefone."
    fireEvent.click(caixa("Telefone"));
    expect(caixa("Telefone").checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Aplicar selecionados" }));

    await waitFor(() => expect(campo("Logradouro").value).toBe("AVENIDA PAULISTA"));
    expect(campo("Telefone").value).toBe("(11) 3333-4444");
  });

  it("aplicar NÃO grava: o cadastro continua esperando o Salvar", async () => {
    renderEdicao();
    await consultar();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar selecionados" }));

    await waitFor(() => expect(campo("Razão Social").value).toBe("VERIDI NUTRITION LTDA"));
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
    // O botão que grava continua lá, e é ele quem persiste.
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeTruthy();
  });
});

describe("G — valor vazio da fonte nunca apaga o que existe", () => {
  it("campo nulo no retorno não aparece como substituição, e o cadastro fica de pé", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "found",
      result: resultado({ phone: null, email: null, complement: null }),
    });
    renderEdicao();
    await consultar();

    expect(screen.queryByRole("checkbox", { name: "Aplicar Telefone" })).toBeNull();
    expect(within(linha("Telefone")).getByText("Não informado pela fonte")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar selecionados" }));

    await waitFor(() => expect(campo("Logradouro").value).toBe("AVENIDA PAULISTA"));
    expect(campo("Telefone").value).toBe("(11) 3333-4444");
    expect(campo("Email").value).toBe("antigo@veridi.com.br");
  });
});

describe("H — cancelar", () => {
  it("fechar o diálogo não muda campo nenhum", async () => {
    renderEdicao();
    await consultar();

    const cancelar = screen.getAllByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelar[cancelar.length - 1]!);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Aplicar selecionados" })).toBeNull(),
    );
    expect(campo("Razão Social").value).toBe("VERIDI TESTE LTDA");
    expect(campo("Logradouro").value).toBe("Rua Antiga");
    expect(campo("Telefone").value).toBe("(11) 3333-4444");
    expect(campo("CEP").value).toBe("18270-000");
  });
});

describe("I — cliente novo, sem id", () => {
  it("consulta, aplica e o formulário fica pronto para salvar", async () => {
    renderNovo();
    fireEvent.change(campo("CNPJ"), { target: { value: CNPJ_NA_TELA } });

    await consultar();

    // Na criação não há "Atual": todo campo é "—".
    expect(within(linha("Razão Social / Nome")).getByText("—")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar selecionados" }));

    await waitFor(() => expect(campo("Razão Social").value).toBe("VERIDI NUTRITION LTDA"));
    expect(campo("Cidade").value).toBe("SAO PAULO");
    expect(createCustomer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Criar cliente" })).toBeTruthy();
  });
});

describe("J — a comparação enxerga o que foi digitado e ainda não foi salvo", () => {
  it("usa o estado do formulário, não o registro carregado", async () => {
    renderEdicao();

    // Editado à mão, sem salvar.
    fireEvent.change(campo("Razão Social"), { target: { value: "NOME QUE AINDA NAO FOI SALVO" } });
    fireEvent.change(campo("Cidade"), { target: { value: "SAO PAULO" } });

    await consultar();

    const razao = linha("Razão Social / Nome");
    expect(within(razao).getByText("NOME QUE AINDA NAO FOI SALVO")).toBeTruthy();
    // O valor SALVO não aparece na comparação — ele só sobrou no título do
    // modal, que é o nome do registro aberto, não o campo em edição.
    expect(within(razao).queryByText("VERIDI TESTE LTDA")).toBeNull();
    // A cidade digitada já é a da fonte: nada a aplicar nesta linha.
    expect(within(linha("Cidade")).getByText("Sem alteração")).toBeTruthy();
  });
});

describe("K — a fonte falhou", () => {
  it("CNPJ não encontrado: diz o que houve e o cadastro manual continua inteiro", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "not_found",
      message: "CNPJ não encontrado na fonte consultada. Você pode continuar o preenchimento manualmente.",
    });
    renderEdicao();

    await consultar({ esperarResultado: false });

    expect(await screen.findByText(/CNPJ não encontrado na fonte consultada/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aplicar selecionados" })).toBeNull();
  });

  it("provedor indisponível: mensagem amigável, e o formulário segue editável", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "unavailable",
      message: "Não foi possível consultar o CNPJ agora. Você pode continuar o preenchimento manualmente.",
    });
    renderEdicao();

    await consultar({ esperarResultado: false });
    expect(await screen.findByText(/Não foi possível consultar o CNPJ agora/)).toBeTruthy();

    // Fecha o diálogo e continua cadastrando à mão — que é a promessa da capacidade.
    const cancelar = screen.getAllByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelar[cancelar.length - 1]!);
    await waitFor(() => expect(screen.queryByLabelText("Fonte da consulta")).toBeNull());

    fireEvent.change(campo("Logradouro"), { target: { value: "Rua escrita à mão" } });
    expect(campo("Logradouro").value).toBe("Rua escrita à mão");
  });

  it("o botão não dispara duas consultas ao serviço público", async () => {
    // A consulta fica pendurada de propósito: é com ela em voo que o segundo
    // e o terceiro clique precisam não fazer nada.
    const pendente: { responder?: (valor: CnpjLookupOutcome) => void } = {};
    vi.mocked(lookupCnpj).mockImplementation(
      () => new Promise<CnpjLookupOutcome>((resolve) => { pendente.responder = resolve; }),
    );
    renderEdicao();

    fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));
    const botao = await screen.findByRole("button", { name: "Consultar" });
    fireEvent.click(botao);

    const consultando = await screen.findByRole("button", { name: "Consultando…" });
    fireEvent.click(consultando);
    fireEvent.click(consultando);

    expect(lookupCnpj).toHaveBeenCalledTimes(1);
    pendente.responder?.({ status: "unavailable", message: "fim" });
    await screen.findByText("fim");
  });
});
