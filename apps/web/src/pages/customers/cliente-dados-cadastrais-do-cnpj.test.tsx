import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  CnpjLookupCompany,
  CnpjLookupResult,
  CustomerCnpjRegistration,
  CustomerDTO,
} from "@veridi/shared";

/**
 * Dados cadastrais do CNPJ no cadastro do Cliente — CUSTOMER-CNPJ-PERSISTED-DATA-01, §119.
 *
 * O provedor é mockado (nenhum teste toca a internet) e a API também: o que se
 * prova aqui é o contrato da TELA — a seção somente leitura, Sim/Não/Não
 * informado, datas em pt-BR, Atual × Retornado, aplicar sem gravar, a data da
 * consulta preparada mesmo sem diferença, cancelar sem efeito, a troca de CNPJ
 * que descarta o bloco do número anterior, e o que vai no POST/PATCH.
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
import { lookupCnpj } from "../../lib/cnpj-lookup-api";
import { formatDateTime } from "../../lib/dates";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { CustomerFormModal } from "./CustomerFormModal";

const CNPJ = "11444777000161";
const CNPJ_NA_TELA = "11.444.777/0001-61";
/** Outro CNPJ válido — a troca de empresa. */
const OUTRO_CNPJ = "11222333000181";
const OUTRO_CNPJ_NA_TELA = "11.222.333/0001-81";

const CONSULTA_ANTERIOR = "2026-01-10T13:00:00.000Z";
const CONSULTA_NOVA = "2026-09-17T12:30:00.000Z";

/** O bloco salvo no cadastro — o retrato da consulta anterior. */
function dadosSalvos(overrides: Partial<CustomerCnpjRegistration> = {}): CustomerCnpjRegistration {
  return {
    mainCnaeCode: "1099699",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: "Empresa de Pequeno Porte (EPP)",
    openedAt: "2019-03-08",
    establishmentType: "HEADQUARTERS",
    simplesOptIn: true,
    meiOptIn: false,
    registrationStatus: "Ativa",
    registrationStatusDate: "2020-01-15",
    consultedAt: CONSULTA_ANTERIOR,
    ...overrides,
  };
}

/** A empresa como a fonte devolve — por padrão, IGUAL ao cadastro abaixo. */
function empresa(overrides: Partial<CnpjLookupCompany> = {}): CnpjLookupCompany {
  return {
    legalName: "VERIDI NUTRITION LTDA",
    tradeName: "VERIDI NUTRITION",
    registrationStatus: "Ativa",
    registrationStatusDate: "2020-01-15",
    openedAt: "2019-03-08",
    establishmentType: "HEADQUARTERS",
    simplesOptIn: true,
    meiOptIn: false,
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

function resultado(
  overrides: Partial<CnpjLookupCompany> = {},
  cnpj = CNPJ,
): CnpjLookupResult {
  return { provider: "OPEN_CNPJ", consultedAt: CONSULTA_NOVA, cnpj, company: empresa(overrides) };
}

/** Cliente cujos campos comerciais já são os da fonte: a consulta não traz diferença neles. */
function cliente(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "VERIDI NUTRITION LTDA",
    tradeName: "VERIDI NUTRITION",
    cnpj: CNPJ,
    email: "contato@veridi.com.br",
    phone: "11987654321",
    taxProfile: "LUCRO_PRESUMIDO",
    cnpjRegistration: dadosSalvos(),
    street: "AVENIDA PAULISTA",
    number: "1000",
    complement: "CONJUNTO 12",
    district: "BELA VISTA",
    zipCode: "01310100",
    city: "SAO PAULO",
    state: "SP",
    notes: "Nota interna.",
    businessLotSuffix: null,
    defaultPaymentInstrument: "BOLETO",
    defaultPaymentMethod: "CASH",
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

/** A seção "Dados cadastrais do CNPJ" do cadastro (não a do diálogo). */
function secao(): HTMLElement {
  const titulo = screen
    .getAllByRole("heading", { name: "Dados cadastrais do CNPJ" })
    .find((h) => h.closest(".form-section"));
  const elemento = titulo?.closest(".form-section");
  if (!(elemento instanceof HTMLElement)) throw new Error("seção ausente");
  return elemento;
}

/** O valor de um rótulo na seção: o `dd` depois do `dt`. */
function valorNaSecao(rotulo: string): string {
  const dt = within(secao()).getByText(rotulo, { selector: "dt" });
  return dt.nextElementSibling?.textContent ?? "";
}

async function consultar() {
  fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));
  fireEvent.click(await screen.findByRole("button", { name: "Consultar" }));
  await screen.findByRole("button", { name: "Aplicar consulta ao cadastro" });
}

async function consultarEAplicar() {
  await consultar();
  fireEvent.click(screen.getByRole("button", { name: "Aplicar consulta ao cadastro" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Aplicar consulta ao cadastro" })).toBeNull(),
  );
}

/** A linha da comparação de um campo, pelo rótulo. */
function linha(rotulo: string): HTMLElement {
  const tr = screen.getByRole("cell", { name: rotulo }).closest("tr");
  if (!tr) throw new Error(`linha sem <tr>: ${rotulo}`);
  return tr;
}

/** O corpo do último PATCH/POST. */
function corpoDoUpdate(): Record<string, unknown> {
  const chamada = vi.mocked(updateCustomer).mock.calls.at(-1);
  if (!chamada) throw new Error("updateCustomer não foi chamado");
  return chamada[1] as Record<string, unknown>;
}

function corpoDoCreate(): Record<string, unknown> {
  const chamada = vi.mocked(createCustomer).mock.calls.at(-1);
  if (!chamada) throw new Error("createCustomer não foi chamado");
  return chamada[0] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(lookupCnpj).mockReset();
  vi.mocked(lookupCnpj).mockResolvedValue({ status: "found", result: resultado() });
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
});

describe("A seção Dados cadastrais do CNPJ", () => {
  it("mostra os valores gravados, somente leitura, datas em pt-BR", () => {
    renderEdicao();

    expect(valorNaSecao("CNAE principal")).toBe("1099-6/99");
    expect(valorNaSecao("Descrição do CNAE")).toBe("Fabricação de outros produtos alimentícios");
    expect(valorNaSecao("Natureza jurídica")).toBe("Sociedade Empresária Limitada");
    expect(valorNaSecao("Porte")).toBe("Empresa de Pequeno Porte (EPP)");
    expect(valorNaSecao("Data de abertura")).toBe("08/03/2019");
    expect(valorNaSecao("Matriz/Filial")).toBe("Matriz");
    expect(valorNaSecao("Simples")).toBe("Sim");
    expect(valorNaSecao("MEI")).toBe("Não");
    expect(valorNaSecao("Situação na RFB")).toBe("Ativa");
    expect(valorNaSecao("Data da situação")).toBe("15/01/2020");
    expect(valorNaSecao("Última consulta CNPJ")).toBe(formatDateTime(CONSULTA_ANTERIOR));

    // Somente leitura: nenhuma caixa de edição dentro da seção.
    expect(within(secao()).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(secao()).queryAllByRole("combobox")).toHaveLength(0);
  });

  it("Simples e MEI não informados dizem 'Não informado' — nunca 'Não'", () => {
    renderEdicao(cliente({ cnpjRegistration: dadosSalvos({ simplesOptIn: null, meiOptIn: null }) }));

    expect(valorNaSecao("Simples")).toBe("Não informado");
    expect(valorNaSecao("MEI")).toBe("Não informado");
  });

  it("sem consulta aplicada tudo fica '—' e a seção diz por quê", () => {
    renderEdicao(cliente({ cnpjRegistration: null }));

    for (const rotulo of ["CNAE principal", "Porte", "Simples", "MEI", "Última consulta CNPJ"]) {
      expect(valorNaSecao(rotulo), rotulo).toBe("—");
    }
    expect(within(secao()).getByText("Nenhuma consulta de CNPJ aplicada a este cadastro.")).toBeTruthy();
  });

  it("em consulta (perfil que não edita) a seção aparece com os mesmos valores", () => {
    renderEdicao(cliente(), true);

    expect(valorNaSecao("Matriz/Filial")).toBe("Matriz");
    expect(valorNaSecao("Data da situação")).toBe("15/01/2020");
    expect(screen.queryByRole("button", { name: "Consultar CNPJ" })).toBeNull();
  });
});

describe("Atual × Retornado dos dados cadastrais", () => {
  it("Sim/Não/Não informado na comparação, com as regras de sempre", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "found",
      result: resultado({ simplesOptIn: false, meiOptIn: null, companySize: "Demais" }),
    });
    renderEdicao();
    await consultar();

    // Diferença útil: marcada.
    expect(within(linha("Simples")).getByText("Sim")).toBeTruthy();
    expect(within(linha("Simples")).getByText("Não")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Aplicar Simples" }) as HTMLInputElement).checked,
    ).toBe(true);
    // A fonte não informou o MEI: não apaga o "Não" que está lá.
    expect(within(linha("MEI")).getByText("Não informado pela fonte")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Aplicar MEI" })).toBeNull();
    // Equivalente: "Sem alteração", datas em pt-BR dos dois lados.
    expect(within(linha("Data de abertura")).getAllByText("08/03/2019").length).toBeGreaterThan(0);
    expect(within(linha("Data de abertura")).getByText("Sem alteração")).toBeTruthy();
  });

  it("aplicar muda o formulário, NÃO grava, e avisa que falta salvar", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "found",
      result: resultado({ simplesOptIn: false, companySize: "Demais" }),
    });
    renderEdicao();
    await consultarEAplicar();

    expect(valorNaSecao("Simples")).toBe("Não");
    expect(valorNaSecao("Porte")).toBe("Demais");
    expect(valorNaSecao("Última consulta CNPJ")).toBe(formatDateTime(CONSULTA_NOVA));
    expect(within(secao()).getByText(/só ficam registrados quando você salvar/)).toBeTruthy();
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

describe("Última consulta CNPJ", () => {
  it("consulta SEM alteração ainda prepara a data — e o Salvar a leva", async () => {
    renderEdicao();
    await consultar();

    // Nada diferente em lugar nenhum, e mesmo assim dá para aplicar.
    expect(screen.getByText(/Nenhuma diferença/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar consulta ao cadastro" }));

    await waitFor(() =>
      expect(valorNaSecao("Última consulta CNPJ")).toBe(formatDateTime(CONSULTA_NOVA)),
    );
    expect(updateCustomer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));

    expect(corpoDoUpdate()["cnpjRegistration"]).toEqual({
      ...dadosSalvos(),
      consultedAt: CONSULTA_NOVA,
      cnpj: CNPJ,
    });
  });

  it("cancelar a consulta não muda nada — nem a data — e o Salvar não leva o bloco", async () => {
    renderEdicao();
    await consultar();

    const cancelar = screen.getAllByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelar[cancelar.length - 1]!);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Aplicar consulta ao cadastro" })).toBeNull(),
    );

    expect(valorNaSecao("Última consulta CNPJ")).toBe(formatDateTime(CONSULTA_ANTERIOR));

    fireEvent.change(campo("Notas internas"), { target: { value: "Outra nota." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(corpoDoUpdate()).not.toHaveProperty("cnpjRegistration");
  });

  it("aplicar e sair sem salvar não grava: a saída pergunta, e sair descarta", async () => {
    const user = userEvent.setup();
    let fechou = false;
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
            path="/cadastros/clientes"
            element={
              <CustomerFormModal
                mode="edit"
                customer={cliente()}
                onClose={() => {
                  fechou = true;
                }}
                onSaved={() => {}}
              />
            }
          />
        </Route>,
      ),
      { initialEntries: ["/cadastros/clientes"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("button", { name: "Consultar CNPJ" });

    // Sem diferença nenhuma: o que ficou pendente é só a data da consulta.
    await consultarEAplicar();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));

    await waitFor(() => expect(fechou).toBe(true));
    expect(updateCustomer).not.toHaveBeenCalled();
  });
});

describe("Troca de CNPJ", () => {
  it("o bloco do CNPJ anterior deixa de valer, com aviso, e o Salvar o descarta", async () => {
    renderEdicao();

    fireEvent.change(campo("CNPJ"), { target: { value: OUTRO_CNPJ_NA_TELA } });

    expect(within(secao()).getByText(/O CNPJ foi alterado/)).toBeTruthy();
    for (const rotulo of ["CNAE principal", "Porte", "Matriz/Filial", "Simples", "MEI", "Última consulta CNPJ"]) {
      expect(valorNaSecao(rotulo), rotulo).toBe("—");
    }

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));

    const corpo = corpoDoUpdate();
    expect(corpo["cnpj"]).toBe(OUTRO_CNPJ);
    expect(corpo["cnpjRegistration"]).toBeNull();
    // Os dados comerciais NÃO pertencem ao CNPJ e seguem no corpo como estavam.
    expect(corpo).toMatchObject({
      legalName: "VERIDI NUTRITION LTDA",
      tradeName: "VERIDI NUTRITION",
      email: "contato@veridi.com.br",
      street: "AVENIDA PAULISTA",
      city: "SAO PAULO",
      notes: "Nota interna.",
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
    });
    // Perfil tributário igual ao gravado não viaja — e não foi mexido.
    expect(corpo).not.toHaveProperty("taxProfile");
  });

  it("voltar ao CNPJ do bloco o devolve: digitação desfeita não é troca de empresa", async () => {
    renderEdicao();

    fireEvent.change(campo("CNPJ"), { target: { value: "11.444.777/0001-6" } });
    expect(within(secao()).getByText(/O CNPJ foi alterado/)).toBeTruthy();

    fireEvent.change(campo("CNPJ"), { target: { value: CNPJ_NA_TELA } });
    expect(within(secao()).queryByText(/O CNPJ foi alterado/)).toBeNull();
    expect(valorNaSecao("Porte")).toBe("Empresa de Pequeno Porte (EPP)");

    fireEvent.change(campo("Notas internas"), { target: { value: "Outra nota." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(corpoDoUpdate()).not.toHaveProperty("cnpjRegistration");
  });

  it("CNPJ novo consultado e aplicado: o bloco passa a ser do número novo", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "found",
      result: resultado({ establishmentType: "BRANCH", simplesOptIn: null }, OUTRO_CNPJ),
    });
    renderEdicao();

    fireEvent.change(campo("CNPJ"), { target: { value: OUTRO_CNPJ_NA_TELA } });
    await consultar();
    // Na comparação o "Atual" dos dados cadastrais é vazio: os do CNPJ anterior não contam.
    expect(within(linha("Matriz/Filial")).getByText("—")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar consulta ao cadastro" }));

    await waitFor(() => expect(valorNaSecao("Matriz/Filial")).toBe("Filial"));
    expect(within(secao()).queryByText(/O CNPJ foi alterado/)).toBeNull();
    expect(valorNaSecao("Simples")).toBe("Não informado");

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(corpoDoUpdate()).toMatchObject({
      cnpj: OUTRO_CNPJ,
      cnpjRegistration: {
        cnpj: OUTRO_CNPJ,
        establishmentType: "BRANCH",
        simplesOptIn: null,
        consultedAt: CONSULTA_NOVA,
      },
    });
  });
});

describe("Criar e editar", () => {
  it("novo Cliente: consulta → aplicar → criar leva o bloco com o CNPJ e a data", async () => {
    renderNovo();
    fireEvent.change(campo("CNPJ"), { target: { value: CNPJ_NA_TELA } });

    await consultarEAplicar();
    expect(valorNaSecao("MEI")).toBe("Não");
    expect(createCustomer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));

    expect(corpoDoCreate()["cnpjRegistration"]).toEqual({
      cnpj: CNPJ,
      mainCnaeCode: "1099699",
      mainCnaeDescription: "Fabricação de outros produtos alimentícios",
      legalNature: "Sociedade Empresária Limitada",
      companySize: "Empresa de Pequeno Porte (EPP)",
      openedAt: "2019-03-08",
      establishmentType: "HEADQUARTERS",
      simplesOptIn: true,
      meiOptIn: false,
      registrationStatus: "Ativa",
      registrationStatusDate: "2020-01-15",
      consultedAt: CONSULTA_NOVA,
    });
  });

  it("novo Cliente sem consulta não manda bloco nenhum", async () => {
    renderNovo();
    fireEvent.change(campo("Razão Social"), { target: { value: "CLIENTE MANUAL LTDA" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));

    expect(corpoDoCreate()).not.toHaveProperty("cnpjRegistration");
  });

  it("edição: consulta com diferença → aplicar → salvar leva o bloco novo, e só ele muda", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "found",
      result: resultado({ registrationStatus: "Baixada", registrationStatusDate: "2026-08-01" }),
    });
    renderEdicao(cliente({ cnpjRegistration: null }));

    await consultarEAplicar();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));

    const corpo = corpoDoUpdate();
    expect(corpo["cnpjRegistration"]).toMatchObject({
      cnpj: CNPJ,
      registrationStatus: "Baixada",
      registrationStatusDate: "2026-08-01",
      consultedAt: CONSULTA_NOVA,
    });
    // Pagamento, notas e perfil ficam como estavam (perfil igual nem viaja).
    expect(corpo).toMatchObject({
      notes: "Nota interna.",
      defaultPaymentInstrument: "BOLETO",
      defaultPaymentMethod: "CASH",
    });
    expect(corpo).not.toHaveProperty("taxProfile");
  });
});
