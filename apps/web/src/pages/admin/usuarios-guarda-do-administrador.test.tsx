import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { UserDTO } from "@veridi/shared";

vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn(), useOptionalAuth: () => null }));

import { useAuth } from "../../app/AuthProvider";
import { parseJsonOrThrow } from "../../lib/api-errors";
import { UsersPage } from "./UsersPage";

/**
 * USER-LAST-ADMIN-GUARD-01 (§120) na tela de Usuários.
 *
 * A API é a autoridade: recusa inativar ou rebaixar o último ADMIN ativo, e
 * recusa quem tenta isso consigo mesmo. A tela não oferece o que sabe que será
 * recusado, diz por quê, e mostra a frase da API quando a recusa vem mesmo
 * assim (corrida com outro administrador).
 *
 * `fetch` falso, e não mock de `auth-api`: a recusa percorre o cliente HTTP
 * real (`parseJsonOrThrow`) até a faixa do formulário.
 */

const MENSAGEM_ULTIMO =
  "Não é possível concluir. O sistema precisa manter pelo menos um administrador ativo.";
const MENSAGEM_INATIVAR_A_SI =
  "Não é possível concluir. Você não pode inativar o próprio usuário — outro administrador deve fazer isso.";
const MENSAGEM_REBAIXAR_A_SI =
  "Não é possível concluir. Você não pode retirar de si mesmo o perfil Administrador — outro administrador deve fazer isso.";

function usuario(id: string, name: string, role: UserDTO["role"], active = true): UserDTO {
  return {
    id,
    code: `USR-${id}`,
    name,
    email: `${id}@veridi.local`,
    role,
    active,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

const EU = usuario("eu", "Ana Administradora", "ADMIN");
const OUTRO_ADMIN = usuario("outro", "Bruno Administrador", "ADMIN");
const ADMIN_INATIVO = usuario("inativo", "Davi Antigo", "ADMIN", false);
const OPERADOR = usuario("operador", "Carla Operadora", "PRODUCTION");

interface Chamada {
  metodo: string;
  url: string;
  corpo: unknown;
}

function responder(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** API falsa: a lista devolve o que recebe; o PATCH aplica o corpo, ou devolve a recusa pedida. */
function api(
  usuarios: UserDTO[],
  opcoes: { total?: number; recusa?: { status: number; corpo: unknown } } = {},
): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      const metodo = init?.method ?? "GET";
      const corpo: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      chamadas.push({ metodo, url, corpo });

      if (metodo === "GET" && url.includes("/users?")) {
        return responder(200, {
          users: usuarios,
          page: 1,
          pageSize: 100,
          total: opcoes.total ?? usuarios.length,
        });
      }
      if (metodo === "PATCH") {
        if (opcoes.recusa) return responder(opcoes.recusa.status, opcoes.recusa.corpo);
        const alvo = usuarios.find((u) => url.endsWith(`/users/${u.id}`));
        return alvo
          ? responder(200, { ...alvo, ...(corpo as object) })
          : responder(404, { error: "not_found" });
      }
      return responder(404, { error: "not_found" });
    }),
  );
  return chamadas;
}

const patches = (chamadas: Chamada[]) => chamadas.filter((chamada) => chamada.metodo === "PATCH");

function montar() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

async function abrirEdicao(nome: string) {
  const user = userEvent.setup();
  const linha = (await screen.findByText(nome)).closest("tr");
  if (!linha) throw new Error(`linha de ${nome} não encontrada`);
  await user.click(within(linha).getByRole("button", { name: "Editar" }));
  return { user, dialogo: screen.getByRole("dialog", { name: nome }) };
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: EU.id, code: EU.code, name: EU.name, email: EU.email, role: "ADMIN" },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("o próprio usuário", () => {
  it("perfil e situação travados, com o motivo; o nome segue editável e salva sem sair do conjunto", async () => {
    const chamadas = api([EU, OUTRO_ADMIN, OPERADOR]);
    montar();
    const { user, dialogo } = await abrirEdicao(EU.name);

    const perfil = within(dialogo).getByLabelText("Perfil");
    const situacao = within(dialogo).getByRole("checkbox", { name: "Usuário ativo" });
    expect(perfil).toBeDisabled();
    expect(situacao).toBeDisabled();
    expect(situacao).toBeChecked();
    expect(perfil).toHaveAccessibleDescription(
      /Você não pode inativar o próprio usuário nem retirar de si o perfil Administrador/,
    );
    expect(situacao).toHaveAccessibleDescription(/outro administrador faz isso/);
    // Há outro ADMIN ativo: o motivo é só o "a si mesmo".
    expect(within(dialogo).queryByText(/Único administrador ativo/)).toBeNull();

    const nome = within(dialogo).getByLabelText(/^Nome/);
    await user.clear(nome);
    await user.type(nome, "Ana Administradora Silva");
    await user.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patches(chamadas)).toHaveLength(1);
    expect(patches(chamadas)[0]!.url).toMatch(/\/users\/eu$/);
    expect(patches(chamadas)[0]!.corpo).toMatchObject({
      name: "Ana Administradora Silva",
      role: "ADMIN",
      active: true,
    });
  });
});

describe("o último ADMIN ativo", () => {
  it("a tela explica que o sistema precisa manter um administrador ativo, e como sair disso", async () => {
    api([EU, ADMIN_INATIVO, OPERADOR]);
    montar();
    const { dialogo } = await abrirEdicao(EU.name);

    expect(within(dialogo).getByLabelText("Perfil")).toBeDisabled();
    expect(within(dialogo).getByRole("checkbox", { name: "Usuário ativo" })).toBeDisabled();
    expect(within(dialogo).getByText(/Único administrador ativo\./)).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/primeiro cadastre ou promova outro administrador/),
    ).toBeInTheDocument();
    // Sendo também o próprio usuário, os dois motivos aparecem.
    expect(within(dialogo).getByText(/Este é o seu usuário\./)).toBeInTheDocument();
  });

  it("com a lista cortada, a tela não afirma que é o último — quem conta é a API", async () => {
    api([EU, ADMIN_INATIVO, OPERADOR], { total: 150 });
    montar();
    const { dialogo } = await abrirEdicao(EU.name);

    expect(within(dialogo).queryByText(/Único administrador ativo/)).toBeNull();
    // O "a si mesmo" não depende de contagem.
    expect(within(dialogo).getByText(/Este é o seu usuário\./)).toBeInTheDocument();
  });

  it("recusa da API na corrida: a frase dela aparece inteira, e o modal segue aberto", async () => {
    // A tela via dois ADMIN ativos; o outro saiu do conjunto antes de salvar.
    const chamadas = api([EU, OUTRO_ADMIN], {
      recusa: { status: 409, corpo: { error: "last_active_admin", message: MENSAGEM_ULTIMO } },
    });
    montar();
    const { user, dialogo } = await abrirEdicao(OUTRO_ADMIN.name);

    await user.selectOptions(within(dialogo).getByLabelText("Perfil"), "PRODUCTION");
    await user.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(MENSAGEM_ULTIMO);
    expect(screen.getByRole("dialog", { name: OUTRO_ADMIN.name })).toBeInTheDocument();
    expect(patches(chamadas)).toHaveLength(1);
  });
});

describe("recusa sem frase: o piso da tela é o da regra, não um erro genérico", () => {
  it.each([
    ["last_active_admin", MENSAGEM_ULTIMO],
    ["self_deactivation", MENSAGEM_INATIVAR_A_SI],
    ["self_demotion", MENSAGEM_REBAIXAR_A_SI],
  ])("%s", async (codigo, frase) => {
    await expect(parseJsonOrThrow(responder(409, { error: codigo }))).rejects.toThrow(frase);
  });
});

describe("edição normal fora da guarda", () => {
  it("outro ADMIN: perfil e situação editáveis, sem aviso, e inativar vai para a API", async () => {
    const chamadas = api([EU, OUTRO_ADMIN, OPERADOR]);
    montar();
    const { user, dialogo } = await abrirEdicao(OUTRO_ADMIN.name);

    const perfil = within(dialogo).getByLabelText("Perfil");
    const situacao = within(dialogo).getByRole("checkbox", { name: "Usuário ativo" });
    expect(perfil).toBeEnabled();
    expect(situacao).toBeEnabled();
    expect(within(dialogo).queryByText(/Este é o seu usuário/)).toBeNull();
    expect(within(dialogo).queryByText(/Único administrador ativo/)).toBeNull();

    await user.click(situacao);
    await user.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patches(chamadas)).toHaveLength(1);
    expect(patches(chamadas)[0]!.corpo).toMatchObject({ role: "ADMIN", active: false });
  });

  it("demais perfis: com um ADMIN só, trocar o perfil e inativar seguem livres", async () => {
    const chamadas = api([EU, OPERADOR]);
    montar();
    const { user, dialogo } = await abrirEdicao(OPERADOR.name);

    const perfil = within(dialogo).getByLabelText("Perfil");
    const situacao = within(dialogo).getByRole("checkbox", { name: "Usuário ativo" });
    expect(perfil).toBeEnabled();
    expect(situacao).toBeEnabled();

    await user.selectOptions(perfil, "QUALITY");
    await user.click(situacao);
    await user.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patches(chamadas)[0]!.corpo).toMatchObject({ role: "QUALITY", active: false });
  });
});
