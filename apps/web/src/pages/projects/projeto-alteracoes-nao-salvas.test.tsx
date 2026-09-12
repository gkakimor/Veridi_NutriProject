import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-FOUNDATION-01 no cadastro de Projeto — o caso que originou
 * a capability.
 *
 * Com "Novo projeto" aberto, clicar em Pedidos no menu trocava a tela por
 * baixo do modal e levava junto tudo o que estava preenchido. Agora:
 *
 * - modal sem nenhuma alteração navega na hora, SEM confirmação — perguntar
 *   ali era o outro extremo do mesmo defeito;
 * - modal com alteração real pergunta, e respeita a resposta;
 * - Cancelar, ✕ e Esc, que o router nem vê, passam pela MESMA pergunta;
 * - salvar limpa a pendência antes de navegar: ninguém é perguntado se quer
 *   descartar o que acabou de gravar.
 */

vi.mock("../../lib/projects-api", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  getProjectVocabulary: vi.fn(() => Promise.resolve({ concepts: [], channels: [] })),
}));
vi.mock("../../lib/customers-api", () => ({
  listCustomers: vi.fn(() =>
    Promise.resolve({
      customers: [
        {
          id: "cli-1",
          code: "CLI-000001",
          legalName: "Cliente Teste LTDA",
          tradeName: null,
          cnpj: null,
        },
      ],
    }),
  ),
}));

import { updateProject } from "../../lib/projects-api";
import { ProjectFormModal } from "./ProjectFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const GRAVADO = {
  id: "prj-1",
  code: "PROJ-000001",
  customerId: "cli-1",
  name: "Projeto Gravado",
  concept: null,
  channel: null,
  externalCode: null,
  entryDate: "2026-09-01T12:00:00.000Z",
  notes: null,
  dosageForm: null,
  presentationType: null,
  doseAmount: null,
  dosesPerPackage: 60,
  targetAgeGroup: null,
  minimumBatchQuantity: null,
  shelfLifeMonths: 24,
} as ProjectDTO;

let fechou = false;
let salvou: ProjectDTO | null = null;

function Listagem({ project }: { project: ProjectDTO | null }) {
  return (
    <>
      <h1>Projetos</h1>
      <ProjectFormModal
        project={project}
        onClose={() => {
          fechou = true;
        }}
        onSaved={(salvo) => {
          salvou = salvo;
        }}
      />
    </>
  );
}

/** O shell reduzido ao essencial: a guarda, o menu e o workspace. */
function Raiz() {
  return (
    <UnsavedChangesProvider>
      {/* `id="sidebar"` porque é o que o modal de workspace deixa de fora do
          `inert`: a navegação lateral é saída, por decisão do PO. */}
      <nav id="sidebar">
        <Link to="/comercial/pedidos">Pedidos</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function abrir(project: ProjectDTO | null = null) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/projetos" element={<Listagem project={project} />} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/comercial/projetos?novo=1"] },
  );
  render(<RouterProvider router={router} />);
}

const nome = () => screen.getByLabelText(/Nome do projeto/);
const pergunta = () => screen.queryByRole("alertdialog");
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });

beforeEach(() => {
  vi.clearAllMocks();
  fechou = false;
  salvou = null;
});

describe("Novo projeto — navegação pelo menu", () => {
  it("sem alterar nada, clicar em Pedidos navega na hora", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("com alteração real, clicar em Pedidos pergunta antes", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.type(nome(), "Whey Protein");
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste projeto/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("Continuar editando mantém o modal e o que foi digitado", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.type(nome(), "Whey Protein");
    await user.click(menuPedidos());
    await user.click(await screen.findByRole("button", { name: "Continuar editando" }));

    await waitFor(() => expect(pergunta()).toBeNull());
    expect(nome()).toHaveValue("Whey Protein");
    expect(screen.getByText("Novo projeto")).toBeInTheDocument();
  });

  it("Sair sem salvar fecha o contexto e vai exatamente para Pedidos", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.type(nome(), "Whey Protein");
    await user.click(menuPedidos());
    await user.click(await screen.findByRole("button", { name: "Sair sem salvar" }));

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(screen.queryByText("Novo projeto")).toBeNull();
  });
});

describe("Novo projeto — Cancelar, ✕ e Esc", () => {
  it("Cancelar sem alteração fecha direto", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fechou).toBe(true);
    expect(pergunta()).toBeNull();
  });

  it("Cancelar com alteração pergunta", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.type(nome(), "Whey Protein");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(fechou).toBe(true);
  });

  it("✕ com alteração pergunta", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.type(nome(), "Whey Protein");
    await user.click(screen.getByRole("button", { name: /Fechar/ }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);
  });

  it("Esc com alteração pergunta — e uma pergunta só", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Novo projeto");

    await user.type(nome(), "Whey Protein");
    await user.keyboard("{Escape}");

    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(fechou).toBe(false);
  });
});

describe("Projeto — o que NÃO conta como alteração", () => {
  it("editar um projeto e não tocar em nada navega sem perguntar", async () => {
    const user = userEvent.setup();
    abrir(GRAVADO);
    await screen.findByText("Projeto Gravado");

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar limpa a pendência antes de fechar e navegar", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProject).mockResolvedValue({ ...GRAVADO, name: "Projeto Renomeado" });
    abrir(GRAVADO);
    await screen.findByText("Projeto Gravado");

    await user.clear(nome());
    await user.type(nome(), "Projeto Renomeado");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(salvou).not.toBeNull());
    // Salvou e ninguém perguntou se queria descartar o que acabou de gravar.
    expect(pergunta()).toBeNull();
  });
});
