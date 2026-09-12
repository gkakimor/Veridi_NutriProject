import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-03 no cadastro de Cliente.
 *
 * Duas portas, um controller (`useCustomerForm`) — a guarda mora nele.
 *
 * A SITUAÇÃO COMERCIAL fica fora do dirty de propósito: ela é derivada do
 * histórico do cliente pelo servidor e muda sozinha. Se entrasse na
 * comparação, a tela se declararia alterada sem ninguém ter tocado em nada, e
 * a pergunta de descarte cobraria por trabalho que não existe.
 */

vi.mock("../../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));
vi.mock("../../lib/cep-api", () => ({ lookupCep: vi.fn(async () => null) }));

import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { CustomerCreatePage } from "./CustomerCreatePage";
import { CustomerFormModal } from "./CustomerFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { startContextualCreate } from "../../lib/contextual-create";


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

let fechou = false;

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/painel">Painel</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(elemento: React.ReactNode, entradas: string[], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/cadastros/clientes/novo" element={elemento} />
        <Route path="/cadastros/clientes" element={elemento} />
        <Route path="/comercial/projetos" element={<h1>Projetos</h1>} />
        <Route path="/painel" element={<h1>Painel</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirPagina(entradas = ["/cadastros/clientes/novo"], indice?: number) {
  const router = montar(<CustomerCreatePage />, entradas, indice);
  await screen.findByRole("heading", { name: "Novo cliente" });
  return router;
}

async function abrirModalDeEdicao(dto = cliente()) {
  montar(
    <CustomerFormModal
      mode="edit"
      customer={dto}
      onClose={() => {
        fechou = true;
      }}
      onSaved={() => undefined}
    />,
    ["/cadastros/clientes"],
  );
  await screen.findByText(dto.legalName);
}

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const pergunta = () => screen.queryByRole("alertdialog");
const menu = () => screen.getByRole("link", { name: "Painel" });
const razaoSocial = () => campo("customer-legal-name");
const notas = () => campo("customer-notes");

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  fechou = false;
  vi.mocked(createCustomer).mockResolvedValue(cliente());
  vi.mocked(updateCustomer).mockResolvedValue(cliente());
});

describe("Cliente novo — guarda de alterações não salvas", () => {
  it("aberto com os defaults, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    await user.click(menu());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("razão social digitada pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(razaoSocial(), { target: { value: "IGEIA Suplementos LTDA" } });
    await user.click(menu());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste cliente/i)).toBeInTheDocument();
  });

  it("salvar limpa a pendência antes de voltar para a lista", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(razaoSocial(), { target: { value: "IGEIA Suplementos LTDA" } });
    await user.click(screen.getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
  });

  it("criação contextual: o rascunho que volta continua sendo alteração", async () => {
    const user = userEvent.setup();
    /*
     * Quem estava montando um projeto e precisou de um cliente novo chega
     * aqui pelo contexto. A volta devolve o documento de origem — e o que foi
     * digitado AQUI é edição de verdade: nem o contexto nem a guarda podem
     * fingir que a tela está limpa.
     */
    const token = startContextualCreate({
      entityType: "customer",
      originRoute: "/comercial/projetos",
      fieldKey: "customerId",
      draft: {},
    })!;
    await abrirPagina([`/cadastros/clientes/novo?origem=${token}`]);

    fireEvent.change(razaoSocial(), { target: { value: "IGEIA Suplementos LTDA" } });

    // O caminho de volta do contexto continua na tela, e continua protegido.
    await user.click(screen.getByRole("button", { name: /^← Voltar para / }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Projetos" })).toBeInTheDocument();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    const router = await abrirPagina(["/painel", "/cadastros/clientes/novo"], 1);

    fireEvent.change(razaoSocial(), { target: { value: "IGEIA" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a digitação", async () => {
    await abrirPagina();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(razaoSocial(), { target: { value: "IGEIA" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(razaoSocial(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});

describe("Cliente — modal de edição", () => {
  it("carregado e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    await user.click(menu());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("a situação comercial do servidor não gera pendência", async () => {
    const user = userEvent.setup();
    /*
     * Dois clientes idênticos no formulário, com situação comercial diferente:
     * ela é derivada e nem aparece nos campos. A tela tem de continuar limpa.
     */
    await abrirModalDeEdicao(cliente({ commercialStatus: "PROSPECT" } as Partial<CustomerDTO>));

    await user.click(menu());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("Cancelar, ✕ e Esc com alteração passam pela mesma pergunta", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fechou).toBe(true);

    fechou = false;
    fireEvent.change(notas(), { target: { value: "Cliente pediu contato mensal" } });

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    await user.click(screen.getByRole("button", { name: /Fechar/ }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    await user.keyboard("{Escape}");
    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(fechou).toBe(false);
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    // Sem contato nem CEP: a tela valida formato antes de chamar a API, e o
    // que se prova aqui é a guarda, não a validação.
    await abrirModalDeEdicao(
      cliente({ email: null, phone: null, cnpj: null, zipCode: null }),
    );

    fireEvent.change(notas(), { target: { value: "Cliente pediu contato mensal" } });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));

    await user.click(menu());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
