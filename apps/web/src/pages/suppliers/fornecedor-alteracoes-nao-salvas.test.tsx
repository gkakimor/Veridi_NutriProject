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
import type { SupplierDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-03 no cadastro de Fornecedor.
 *
 * Duas portas, um controller (`useSupplierForm`) — a guarda mora nele.
 *
 * São os campos que o cadastro tem HOJE: razão social, nome fantasia, CNPJ,
 * e-mail, telefone, ENDEREÇO (SUPPLIER-ADDRESS-01) e notas. O endereço é
 * opcional no domínio e isso não o tira da guarda: campo opcional digitado e
 * perdido na saída é perdido do mesmo jeito.
 */

vi.mock("../../lib/suppliers-api", () => ({
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));

import { createSupplier, updateSupplier } from "../../lib/suppliers-api";
import { SupplierCreatePage } from "./SupplierCreatePage";
import { SupplierFormModal } from "./SupplierFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function fornecedor(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "for-1",
    code: "FOR-000001",
    legalName: "PURIFARMA DISTRIBUIDORA LTDA",
    tradeName: "PURIFARMA",
    cnpj: null,
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
    active: true,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
    ...overrides,
  } as unknown as SupplierDTO;
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
        <Route path="/cadastros/fornecedores/novo" element={elemento} />
        <Route path="/cadastros/fornecedores" element={elemento} />
        <Route path="/painel" element={<h1>Painel</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirPagina(entradas = ["/cadastros/fornecedores/novo"], indice?: number) {
  const router = montar(<SupplierCreatePage />, entradas, indice);
  await screen.findByRole("heading", { name: "Novo fornecedor" });
  return router;
}

async function abrirModalDeEdicao(dto = fornecedor()) {
  montar(
    <SupplierFormModal
      mode="edit"
      supplier={dto}
      onClose={() => {
        fechou = true;
      }}
      onSaved={() => undefined}
    />,
    ["/cadastros/fornecedores"],
  );
  await screen.findByText(dto.legalName);
}

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const pergunta = () => screen.queryByRole("alertdialog");
const menu = () => screen.getByRole("link", { name: "Painel" });
const razaoSocial = () => campo("supplier-legal-name");
const notas = () => campo("supplier-notes");
const logradouro = () => campo("supplier-street");
const cidade = () => campo("supplier-city");

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
  vi.mocked(createSupplier).mockResolvedValue(fornecedor());
  vi.mocked(updateSupplier).mockResolvedValue(fornecedor());
});

describe("Fornecedor novo — guarda de alterações não salvas", () => {
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

    fireEvent.change(razaoSocial(), { target: { value: "PURIFARMA" } });
    await user.click(menu());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste fornecedor/i)).toBeInTheDocument();
  });

  it("salvar limpa a pendência antes de voltar para a lista", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(razaoSocial(), { target: { value: "PURIFARMA DISTRIBUIDORA LTDA" } });
    await user.click(screen.getByRole("button", { name: "Criar fornecedor" }));

    await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    const router = await abrirPagina(["/painel", "/cadastros/fornecedores/novo"], 1);

    fireEvent.change(razaoSocial(), { target: { value: "PURIFARMA" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
  });

  it("endereço digitado marca alteração pendente, e revertido volta a limpo", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(logradouro(), { target: { value: "Rua Vicente José de Almeida" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    // Apagar de volta é voltar ao formulário como ele abriu — e abrir não é
    // alterar.
    fireEvent.change(logradouro(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));

    fireEvent.change(cidade(), { target: { value: "São Paulo" } });
    await user.click(menu());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a digitação", async () => {
    await abrirPagina();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(razaoSocial(), { target: { value: "PURIFARMA" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(razaoSocial(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});

describe("Fornecedor — modal de edição", () => {
  it("carregado e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

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
    fireEvent.change(notas(), { target: { value: "Entrega só às terças" } });

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

  it("endereço carregado abre limpo e alterado passa pela pergunta", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao(
      fornecedor({
        zipCode: "04816100",
        street: "Rua Vicente José de Almeida",
        city: "São Paulo",
        state: "SP",
      }),
    );

    // O CEP entra com máscara e o resto vem do registro: nada disso é edição.
    expect(campo("supplier-zip").value).toBe("04816-100");
    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(cidade(), { target: { value: "Campinas" } });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("salvar limpa a pendência do endereço", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(cidade(), { target: { value: "Campinas" } });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateSupplier).toHaveBeenCalledTimes(1));

    await user.click(menu());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(notas(), { target: { value: "Entrega só às terças" } });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateSupplier).toHaveBeenCalledTimes(1));

    await user.click(menu());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
