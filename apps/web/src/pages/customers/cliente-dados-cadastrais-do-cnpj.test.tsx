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
  CustomerCnpjRegistrationEventDTO,
  CustomerDTO,
} from "@veridi/shared";

/**
 * Dados cadastrais do CNPJ no cadastro do Cliente — §119 e §122
 * (CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Provedor e API mockados: nenhum teste toca a internet. O que se prova é o
 * contrato da TELA — a seção logo antes de Observações, os dez campos
 * editáveis, a última consulta como texto do sistema, a consulta aditiva
 * (completa o vazio, troca só por escolha, confirma o equivalente, nunca apaga
 * com o vazio da fonte), a origem por campo no Salvar, a consulta sem
 * diferença que ainda leva a data, a troca de CNPJ e o diálogo do histórico.
 */

vi.mock("../../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  getCustomerCnpjRegistrationHistory: vi.fn(),
}));
vi.mock("../../lib/cep-api", async (original) => ({
  ...(await original<object>()),
  lookupCep: vi.fn(),
}));
vi.mock("../../lib/cnpj-lookup-api", () => ({ lookupCnpj: vi.fn() }));

import { createCustomer, getCustomerCnpjRegistrationHistory, updateCustomer } from "../../lib/customers-api";
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

/** O que o cadastro tem gravado — igual ao que a fonte devolve, por padrão. */
function dadosGravados(overrides: Partial<CustomerCnpjRegistration> = {}): CustomerCnpjRegistration {
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
    lastConsultedAt: CONSULTA_ANTERIOR,
    ...overrides,
  };
}

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

function resultado(overrides: Partial<CnpjLookupCompany> = {}, cnpj = CNPJ): CnpjLookupResult {
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
    cnpjRegistration: dadosGravados(),
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

const campo = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const selecao = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

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

/** A seção "Dados cadastrais do CNPJ" do cadastro (não a tabela do diálogo). */
function secao(): HTMLElement {
  const titulo = screen
    .getAllByRole("heading", { name: "Dados cadastrais do CNPJ" })
    .find((h) => h.closest(".form-section"));
  const elemento = titulo?.closest(".form-section");
  if (!(elemento instanceof HTMLElement)) throw new Error("seção ausente");
  return elemento;
}

/** Os títulos das seções do formulário, na ordem da tela. */
function ordemDasSecoes(): string[] {
  return [...document.querySelectorAll(".form-section > h3")].map((h) => h.textContent ?? "");
}

async function consultar() {
  fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));
  fireEvent.click(await screen.findByRole("button", { name: "Consultar" }));
  await screen.findByRole("button", { name: "Aplicar consulta ao cadastro" });
}

async function aplicar() {
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

const escolha = (verbo: string, rotulo: string) =>
  screen.getByRole("checkbox", { name: `${verbo} ${rotulo}` }) as HTMLInputElement;

async function salvar() {
  fireEvent.click(screen.getByRole("button", { name: /Salvar alterações|Criar cliente/ }));
  await waitFor(() =>
    expect(vi.mocked(updateCustomer).mock.calls.length + vi.mocked(createCustomer).mock.calls.length).toBe(1),
  );
}

/** Os dados cadastrais que foram no corpo do último POST/PATCH. */
function blocoEnviado(): Record<string, unknown> | undefined {
  const update = vi.mocked(updateCustomer).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
  const create = vi.mocked(createCustomer).mock.calls.at(-1)?.[0] as unknown as Record<string, unknown> | undefined;
  return (update ?? create)?.["cnpjRegistration"] as Record<string, unknown> | undefined;
}

function corpoEnviado(): Record<string, unknown> {
  const update = vi.mocked(updateCustomer).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
  const create = vi.mocked(createCustomer).mock.calls.at(-1)?.[0] as unknown as Record<string, unknown> | undefined;
  const corpo = update ?? create;
  if (!corpo) throw new Error("nada foi enviado");
  return corpo;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(createCustomer).mockReset();
  vi.mocked(updateCustomer).mockReset();
  vi.mocked(getCustomerCnpjRegistrationHistory).mockReset();
  vi.mocked(lookupCnpj).mockReset();
  vi.mocked(lookupCnpj).mockResolvedValue({ status: "found", result: resultado() });
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
  vi.mocked(getCustomerCnpjRegistrationHistory).mockResolvedValue({ events: [] });
});

describe("a seção no formulário", () => {
  it("fica logo antes de Observações, no fluxo normal do cadastro", () => {
    renderEdicao();

    const ordem = ordemDasSecoes();
    const posicao = ordem.indexOf("Dados cadastrais do CNPJ");
    expect(posicao).toBeGreaterThan(ordem.indexOf("Pagamento padrão"));
    expect(ordem[posicao + 1]).toBe("Observações");
  });

  it("na consulta (perfil que não edita) fica no mesmo lugar", () => {
    renderEdicao(cliente(), true);

    const ordem = ordemDasSecoes();
    expect(ordem[ordem.indexOf("Dados cadastrais do CNPJ") + 1]).toBe("Observações");
  });

  it("os dez campos são editáveis, com o componente do tipo", () => {
    renderEdicao();

    expect(campo("CNAE principal").value).toBe("1099-6/99");
    expect(campo("Descrição do CNAE").value).toBe("Fabricação de outros produtos alimentícios");
    expect(campo("Natureza jurídica").value).toBe("Sociedade Empresária Limitada");
    expect(campo("Porte").value).toBe("Empresa de Pequeno Porte (EPP)");
    expect(campo("Data de abertura")).toMatchObject({ type: "date", value: "2019-03-08" });
    expect(campo("Data da situação")).toMatchObject({ type: "date", value: "2020-01-15" });
    expect(campo("Situação na RFB").value).toBe("Ativa");
    // Matriz/Filial, Simples e MEI: três estados, com "Não informado" explícito.
    expect([...selecao("Matriz/Filial").options].map((opcao) => opcao.text)).toEqual([
      "Não informado",
      "Matriz",
      "Filial",
    ]);
    expect([...selecao("Simples").options].map((opcao) => opcao.text)).toEqual(["Não informado", "Sim", "Não"]);
    expect(selecao("Simples").value).toBe("true");
    expect(selecao("MEI").value).toBe("false");

    fireEvent.change(campo("Porte"), { target: { value: "Demais" } });
    expect(campo("Porte").value).toBe("Demais");
  });

  it("vazio aparece vazio: sem dados, campos em branco e 'Não informado' — nunca 'Não'", () => {
    renderEdicao(cliente({ cnpjRegistration: null }));

    expect(campo("CNAE principal").value).toBe("");
    expect(campo("Porte").value).toBe("");
    expect(selecao("Simples").value).toBe("");
    expect(selecao("Simples").selectedOptions[0]?.text).toBe("Não informado");
    expect(selecao("MEI").selectedOptions[0]?.text).toBe("Não informado");
    expect(within(secao()).getByText("Nenhuma consulta de CNPJ aplicada.")).toBeTruthy();
  });

  it("a última consulta é do sistema: texto no rodapé, não campo", () => {
    renderEdicao();

    expect(within(secao()).getByText(`Última consulta: ${formatDateTime(CONSULTA_ANTERIOR)}`)).toBeTruthy();
    expect(screen.queryByLabelText(/Última consulta/)).toBeNull();
  });
});

describe("a consulta é aditiva", () => {
  it("completa o vazio: o que faltava vem marcado e vai para os campos", async () => {
    renderEdicao(cliente({ cnpjRegistration: null }));
    await consultar();

    expect(escolha("Aplicar", "Porte").checked).toBe(true);
    await aplicar();

    expect(campo("Porte").value).toBe("Empresa de Pequeno Porte (EPP)");
    expect(campo("CNAE principal").value).toBe("1099-6/99");
    expect(selecao("Matriz/Filial").value).toBe("HEADQUARTERS");
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it("valor existente diferente: 'Substituir' desmarcado — sem marcar, fica", async () => {
    renderEdicao(cliente({ cnpjRegistration: dadosGravados({ companySize: "Microempresa (ME)" }) }));
    await consultar();

    const porte = linha("Porte");
    expect(within(porte).getByText("Microempresa (ME)")).toBeTruthy();
    expect(within(porte).getByText("Empresa de Pequeno Porte (EPP)")).toBeTruthy();
    expect(escolha("Substituir", "Porte").checked).toBe(false);

    await aplicar();
    expect(campo("Porte").value).toBe("Microempresa (ME)");
  });

  it("substituição explícita: marcado, troca", async () => {
    renderEdicao(cliente({ cnpjRegistration: dadosGravados({ companySize: "Microempresa (ME)" }) }));
    await consultar();

    fireEvent.click(escolha("Substituir", "Porte"));
    await aplicar();

    expect(campo("Porte").value).toBe("Empresa de Pequeno Porte (EPP)");
  });

  it("equivalente: continua à vista e pode ser confirmado", async () => {
    renderEdicao();
    await consultar();

    const matriz = linha("Matriz/Filial");
    expect(within(matriz).getAllByText("Matriz")).toHaveLength(2);
    expect(escolha("Confirmar", "Matriz/Filial").checked).toBe(false);
  });

  it("vazio da fonte não apaga: '—' e nenhuma operação", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({ status: "found", result: resultado({ meiOptIn: null }) });
    renderEdicao(cliente({ cnpjRegistration: dadosGravados({ meiOptIn: true }) }));
    await consultar();

    const mei = linha("MEI");
    expect(within(mei).queryByRole("checkbox")).toBeNull();
    expect(within(mei).getByText("—")).toBeTruthy();
    await aplicar();
    expect(selecao("MEI").value).toBe("true");
  });
});

describe("origem por campo e última consulta no Salvar", () => {
  it("aplicado da consulta vai como OpenCNPJ, com a data da consulta", async () => {
    renderEdicao(cliente({ cnpjRegistration: dadosGravados({ companySize: null }) }));
    await consultar();
    await aplicar();

    await salvar();
    expect(blocoEnviado()).toMatchObject({
      cnpj: CNPJ,
      companySize: "Empresa de Pequeno Porte (EPP)",
      consultedAt: CONSULTA_NOVA,
      sources: { companySize: "OPEN_CNPJ" },
    });
  });

  it("aplicado e editado à mão antes de salvar vai como Manual; o resto da consulta segue OpenCNPJ", async () => {
    renderEdicao(cliente({ cnpjRegistration: dadosGravados({ companySize: null, legalNature: null }) }));
    await consultar();
    await aplicar();

    fireEvent.change(campo("Natureza jurídica"), { target: { value: "Sociedade Limitada" } });
    await salvar();

    expect(blocoEnviado()).toMatchObject({
      legalNature: "Sociedade Limitada",
      companySize: "Empresa de Pequeno Porte (EPP)",
      sources: { legalNature: "MANUAL", companySize: "OPEN_CNPJ" },
    });
  });

  it("edição manual sem consulta: Manual, e sem data de consulta", async () => {
    renderEdicao();

    fireEvent.change(campo("Natureza jurídica"), { target: { value: "Empresário Individual" } });
    fireEvent.change(selecao("Simples"), { target: { value: "" } });
    await salvar();

    const bloco = blocoEnviado();
    expect(bloco).toMatchObject({
      legalNature: "Empresário Individual",
      simplesOptIn: null,
      sources: { legalNature: "MANUAL", simplesOptIn: "MANUAL" },
    });
    expect(bloco).not.toHaveProperty("consultedAt");
  });

  it("consulta SEM diferença, aplicada: o Salvar leva a data e nenhuma mudança de valor", async () => {
    renderEdicao();
    await consultar();
    await aplicar();

    expect(within(secao()).getByText(/só fica registrada quando você salvar/)).toBeTruthy();
    expect(within(secao()).getByText(new RegExp(formatDateTime(CONSULTA_NOVA)))).toBeTruthy();
    await salvar();

    expect(blocoEnviado()).toMatchObject({ cnpj: CNPJ, consultedAt: CONSULTA_NOVA, sources: {} });
  });

  it("cancelar a consulta não muda nada — nem a data — e o Salvar não leva o bloco", async () => {
    renderEdicao();
    await consultar();

    const cancelar = screen.getAllByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelar[cancelar.length - 1]!);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Aplicar consulta ao cadastro" })).toBeNull(),
    );
    expect(within(secao()).getByText(`Última consulta: ${formatDateTime(CONSULTA_ANTERIOR)}`)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Notas internas"), { target: { value: "Outra nota." } });
    await salvar();
    expect(corpoEnviado()).not.toHaveProperty("cnpjRegistration");
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
    await consultar();
    await aplicar();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));

    await waitFor(() => expect(fechou).toBe(true));
    expect(updateCustomer).not.toHaveBeenCalled();
  });
});

describe("troca de CNPJ", () => {
  it("limpa os dados do CNPJ anterior, com aviso, e o Salvar leva a limpeza", async () => {
    renderEdicao();

    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: OUTRO_CNPJ_NA_TELA } });

    expect(within(secao()).getByText(/os dados cadastrais do CNPJ anterior/)).toBeTruthy();
    expect(campo("Porte").value).toBe("");
    expect(selecao("Simples").value).toBe("");
    expect(within(secao()).getByText("Nenhuma consulta de CNPJ aplicada.")).toBeTruthy();

    await salvar();
    const corpo = corpoEnviado();
    expect(corpo["cnpj"]).toBe(OUTRO_CNPJ);
    expect(corpo["cnpjRegistration"]).toMatchObject({
      cnpj: OUTRO_CNPJ,
      companySize: null,
      simplesOptIn: null,
      mainCnaeCode: null,
    });
    // O que não pertence ao CNPJ segue como estava.
    expect(corpo).toMatchObject({ legalName: "VERIDI NUTRITION LTDA", notes: "Nota interna." });
  });

  it("digitando o CNPJ pela metade nada é limpo; voltar ao número devolve os dados", () => {
    renderEdicao();

    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: "11.444.777/0001-6" } });
    expect(campo("Porte").value).toBe("Empresa de Pequeno Porte (EPP)");

    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: OUTRO_CNPJ_NA_TELA } });
    expect(campo("Porte").value).toBe("");

    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: CNPJ_NA_TELA } });
    expect(campo("Porte").value).toBe("Empresa de Pequeno Porte (EPP)");
    expect(within(secao()).queryByText(/os dados cadastrais do CNPJ anterior/)).toBeNull();
  });

  it("CNPJ novo consultado e aplicado: os dados passam a ser do número novo", async () => {
    vi.mocked(lookupCnpj).mockResolvedValue({
      status: "found",
      result: resultado({ establishmentType: "BRANCH" }, OUTRO_CNPJ),
    });
    renderEdicao();

    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: OUTRO_CNPJ_NA_TELA } });
    await consultar();
    // Na comparação, o "Atual" dos dados cadastrais é vazio: os do CNPJ anterior foram limpos.
    expect(escolha("Aplicar", "Matriz/Filial").checked).toBe(true);
    await aplicar();

    expect(selecao("Matriz/Filial").value).toBe("BRANCH");
    await salvar();
    expect(blocoEnviado()).toMatchObject({
      cnpj: OUTRO_CNPJ,
      establishmentType: "BRANCH",
      consultedAt: CONSULTA_NOVA,
      sources: { establishmentType: "OPEN_CNPJ" },
    });
  });
});

describe("criar", () => {
  it("novo Cliente: consulta → aplicar → criar leva os dados com o CNPJ, a data e a origem", async () => {
    renderNovo();
    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: CNPJ_NA_TELA } });

    await consultar();
    await aplicar();
    expect(campo("Porte").value).toBe("Empresa de Pequeno Porte (EPP)");

    await salvar();
    expect(blocoEnviado()).toMatchObject({
      cnpj: CNPJ,
      mainCnaeCode: "1099699",
      simplesOptIn: true,
      meiOptIn: false,
      consultedAt: CONSULTA_NOVA,
      sources: { mainCnaeCode: "OPEN_CNPJ", meiOptIn: "OPEN_CNPJ" },
    });
  });

  it("novo Cliente sem dado nenhum não manda bloco", async () => {
    renderNovo();
    fireEvent.change(screen.getByLabelText(/Razão Social/), { target: { value: "CLIENTE MANUAL LTDA" } });

    await salvar();
    expect(corpoEnviado()).not.toHaveProperty("cnpjRegistration");
  });

  it("dado cadastral sem CNPJ é recusado na tela, no campo CNPJ", async () => {
    renderNovo();
    fireEvent.change(screen.getByLabelText(/Razão Social/), { target: { value: "CLIENTE SEM CNPJ LTDA" } });
    fireEvent.change(campo("Porte"), { target: { value: "Demais" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar cliente" }));

    expect(await screen.findByText("Informe o CNPJ para registrar os dados cadastrais do CNPJ.")).toBeTruthy();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("CNAE incompleto é recusado na tela", async () => {
    renderEdicao();
    fireEvent.change(campo("CNAE principal"), { target: { value: "1099-6" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("CNAE deve ter 7 dígitos.")).toBeTruthy();
    expect(updateCustomer).not.toHaveBeenCalled();
  });
});

describe("o histórico", () => {
  const eventos: CustomerCnpjRegistrationEventDTO[] = [
    {
      id: "e3",
      kind: "CONSULTATION",
      occurredAt: "2026-09-17T15:00:00.000Z",
      userName: "Maria Souza",
      cnpj: CNPJ,
      previousCnpj: null,
      consultedAt: CONSULTA_NOVA,
      changes: [],
    },
    {
      id: "e2",
      kind: "EDIT",
      occurredAt: "2026-09-16T15:00:00.000Z",
      userName: "João Silva",
      cnpj: CNPJ,
      previousCnpj: null,
      consultedAt: null,
      changes: [
        { field: "legalNature", before: "Empresário Individual", after: "Sociedade Limitada", source: "MANUAL" },
      ],
    },
    {
      id: "e1",
      kind: "EDIT",
      occurredAt: "2026-09-15T15:00:00.000Z",
      userName: "João Silva",
      cnpj: CNPJ,
      previousCnpj: null,
      consultedAt: CONSULTA_ANTERIOR,
      changes: [{ field: "companySize", before: null, after: "Microempresa (ME)", source: "OPEN_CNPJ" }],
    },
  ];

  it("'Ver histórico' abre o diálogo: do mais recente ao mais antigo, com origem por linha", async () => {
    vi.mocked(getCustomerCnpjRegistrationHistory).mockResolvedValue({ events: eventos });
    renderEdicao();

    fireEvent.click(within(secao()).getByRole("button", { name: "Ver histórico" }));

    const dialogo = await screen.findByRole("dialog", { name: /Histórico dos dados cadastrais do CNPJ/ });
    await within(dialogo).findByText("Sociedade Limitada");
    expect(getCustomerCnpjRegistrationHistory).toHaveBeenCalledWith("cli-1");

    const linhas = within(dialogo).getAllByRole("row").slice(1);
    const texto = linhas.map((tr) => tr.textContent ?? "");
    // Conferência sem mudança: "Dados conferidos via OpenCNPJ" com a data da consulta.
    expect(texto[0]).toContain("Dados conferidos via OpenCNPJ");
    expect(texto[0]).toContain(formatDateTime(CONSULTA_NOVA));
    // Edição manual: campo, anterior, novo e origem.
    expect(texto[1]).toContain("Natureza jurídica");
    expect(texto[1]).toContain("Empresário Individual");
    expect(texto[1]).toContain("Manual");
    // Da consulta: vazio → valor, origem OpenCNPJ.
    expect(texto[2]).toContain("Porte");
    expect(texto[2]).toContain("—");
    expect(texto[2]).toContain("OpenCNPJ");
  });

  it("troca de CNPJ aparece como 'CNPJ alterado', com os dois números e o que foi limpo", async () => {
    vi.mocked(getCustomerCnpjRegistrationHistory).mockResolvedValue({
      events: [
        {
          id: "t1",
          kind: "CNPJ_CHANGED",
          occurredAt: "2026-09-17T15:00:00.000Z",
          userName: "Maria Souza",
          cnpj: OUTRO_CNPJ,
          previousCnpj: CNPJ,
          consultedAt: null,
          changes: [{ field: "simplesOptIn", before: true, after: null, source: "CNPJ_CHANGED" }],
        },
      ],
    });
    renderEdicao();

    fireEvent.click(within(secao()).getByRole("button", { name: "Ver histórico" }));

    const dialogo = await screen.findByRole("dialog", { name: /Histórico dos dados cadastrais do CNPJ/ });
    const cnpj = await within(dialogo).findByText(OUTRO_CNPJ_NA_TELA);
    expect(cnpj.closest("tr")?.textContent).toContain(CNPJ_NA_TELA);
    const simples = within(dialogo).getByText("Simples").closest("tr");
    expect(simples?.textContent).toContain("CNPJ alterado");
    expect(simples?.textContent).toContain("Sim");
  });

  it("sem histórico: diz que começa nas gravações a partir desta versão", async () => {
    renderEdicao();
    fireEvent.click(within(secao()).getByRole("button", { name: "Ver histórico" }));

    expect(await screen.findByText(/Nenhuma alteração registrada/)).toBeTruthy();
  });

  it("cliente novo ainda não tem histórico a ver", () => {
    renderNovo();
    expect(within(secao()).queryByRole("button", { name: "Ver histórico" })).toBeNull();
  });
});
