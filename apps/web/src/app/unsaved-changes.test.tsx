import { useState } from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

/**
 * UNSAVED-CHANGES-FOUNDATION-01 — a guarda de alterações não salvas.
 *
 * O defeito original: com "Novo projeto" aberto, clicar em Pedidos no menu
 * trocava a tela por baixo do modal e o que estava preenchido ia embora sem
 * uma palavra. A guarda pergunta — e só pergunta quando há o que perder.
 *
 * Aqui se protege a FOUNDATION, com um formulário de mentira: navegar limpo
 * passa direto, navegar sujo pergunta, "Continuar editando" preserva o que
 * estava digitado, "Sair sem salvar" vai para o destino que a pessoa pediu,
 * duas fontes sujas dão UMA pergunta, e o aviso do navegador existe
 * exatamente enquanto há pendência. As telas de verdade têm os seus testes.
 */

function Formulario({
  substantivo = "projeto",
  rotulo = "Nome",
}: {
  substantivo?: string;
  rotulo?: string;
}) {
  const [valor, setValor] = useState("");
  useUnsavedChangesGuard({ isDirty: valor !== "", substantivo });
  return (
    <label>
      {rotulo}
      <input value={valor} onChange={(evento) => setValor(evento.target.value)} />
    </label>
  );
}

/** Duas fontes na mesma tela — formulário e subformulário. */
function TelaComDuasFontes() {
  return (
    <>
      <Formulario rotulo="Nome" />
      <Formulario rotulo="Ajuste" substantivo="ajuste" />
    </>
  );
}

/** O modal que fecha sozinho: Cancelar passa pela guarda, não pelo router. */
function ModalComCancelar({ aoFechar }: { aoFechar: () => void }) {
  const [valor, setValor] = useState("");
  const { confirmarDescarte } = useUnsavedChangesGuard({
    isDirty: valor !== "",
    substantivo: "projeto",
  });
  return (
    <div>
      <label>
        Nome
        <input value={valor} onChange={(evento) => setValor(evento.target.value)} />
      </label>
      <button type="button" onClick={() => confirmarDescarte(aoFechar)}>
        Cancelar
      </button>
    </div>
  );
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav>
        <Link to="/pedidos">Pedidos</Link>
        <Link to="/estoque">Estoque</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(tela: ReactNode, entradas: string[] = ["/projetos"], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/projetos" element={tela} />
        <Route path="/pedidos" element={<h1>Pedidos</h1>} />
        <Route path="/estoque" element={<h1>Estoque</h1>} />
      </Route>,
    ),
    {
      initialEntries: entradas,
      ...(indice === undefined ? {} : { initialIndex: indice }),
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const pergunta = () => screen.queryByRole("alertdialog");
const campo = (rotulo = "Nome") => screen.getByLabelText(rotulo);

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function navegadorAvisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

describe("guarda de alterações não salvas — navegação", () => {
  it("formulário limpo navega sem perguntar", async () => {
    const user = userEvent.setup();
    montar(<Formulario />);

    await user.click(screen.getByRole("link", { name: "Pedidos" }));

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alteração pendente bloqueia a saída e pergunta", async () => {
    const user = userEvent.setup();
    montar(<Formulario />);

    await user.type(campo(), "Whey");
    await user.click(screen.getByRole("link", { name: "Pedidos" }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste projeto/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("Continuar editando mantém a tela e o que estava digitado", async () => {
    const user = userEvent.setup();
    montar(<Formulario />);

    await user.type(campo(), "Whey");
    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    await user.click(await screen.findByRole("button", { name: "Continuar editando" }));

    await waitFor(() => expect(pergunta()).toBeNull());
    expect(campo()).toHaveValue("Whey");
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("Sair sem salvar vai para o destino pedido, não para um genérico", async () => {
    const user = userEvent.setup();
    montar(<Formulario />);

    await user.type(campo(), "Whey");
    // Estoque, não Pedidos: o destino original é o que foi clicado.
    await user.click(screen.getByRole("link", { name: "Estoque" }));
    await user.click(await screen.findByRole("button", { name: "Sair sem salvar" }));

    expect(await screen.findByRole("heading", { name: "Estoque" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("a saída segura é o primeiro controle da pergunta, e Esc equivale a ela", async () => {
    const user = userEvent.setup();
    montar(<Formulario />);

    await user.type(campo(), "Whey");
    await user.click(screen.getByRole("link", { name: "Pedidos" }));

    /*
     * O foco inicial vai para o primeiro controle do diálogo, e ele tem de
     * ser "Continuar editando": quem abriu a pergunta sem querer não descarta
     * o trabalho com um Enter.
     *
     * A verificação é a ORDEM, não o `toHaveFocus`. Quem escolhe o alvo do
     * foco filtra por `offsetParent`, e no jsdom, que não faz layout, ele é
     * sempre nulo — o foco não se move ali, e se moveria no navegador.
     */
    const dialogo = await screen.findByRole("alertdialog");
    const botoes = within(dialogo).getAllByRole("button");
    expect(botoes[0]).toHaveAccessibleName("Continuar editando");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(pergunta()).toBeNull());
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    const router = montar(<Formulario />, ["/pedidos", "/projetos"], 1);

    await user.type(campo(), "Whey");
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
  });

  it("duas fontes sujas na mesma tela dão UMA pergunta", async () => {
    const user = userEvent.setup();
    montar(<TelaComDuasFontes />);

    await user.type(campo("Nome"), "Whey");
    await user.type(campo("Ajuste"), "10");
    await user.click(screen.getByRole("link", { name: "Pedidos" }));

    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  });
});

describe("guarda de alterações não salvas — fechamento local", () => {
  it("Cancelar sem alteração fecha na hora", async () => {
    const user = userEvent.setup();
    let fechou = false;
    montar(
      <ModalComCancelar
        aoFechar={() => {
          fechou = true;
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fechou).toBe(true);
    expect(pergunta()).toBeNull();
  });

  it("Cancelar com alteração pergunta antes, e só fecha em Sair sem salvar", async () => {
    const user = userEvent.setup();
    let fechou = false;
    montar(
      <ModalComCancelar
        aoFechar={() => {
          fechou = true;
        }}
      />,
    );

    await user.type(campo(), "Whey");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());
    expect(fechou).toBe(false);
    expect(campo()).toHaveValue("Whey");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(await screen.findByRole("button", { name: "Sair sem salvar" }));
    expect(fechou).toBe(true);
  });
});

describe("guarda de alterações não salvas — F5 e fechar aba", () => {
  it("o aviso do navegador existe exatamente enquanto há pendência", async () => {
    const user = userEvent.setup();
    montar(<Formulario />);

    expect(navegadorAvisaAoFechar()).toBe(false);

    await user.type(campo(), "Whey");
    await waitFor(() => expect(navegadorAvisaAoFechar()).toBe(true));

    await user.clear(campo());
    await waitFor(() => expect(navegadorAvisaAoFechar()).toBe(false));
  });
});
