import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * P2 — o login precisa dizer a verdade sobre o que deu errado.
 *
 * A tela respondia "E-mail ou senha inválidos" para qualquer falha, inclusive
 * API fora do ar. Isso é informação falsa: manda a pessoa trocar uma senha
 * que estava certa e esconde que o problema é do sistema.
 *
 * O que NÃO muda: o 401 continua genérico. Dizer se o e-mail existe entregaria
 * a lista de cadastrados a quem tenta adivinhar.
 */

const refresh = vi.fn();
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ refresh }),
}));

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  API_URL: "http://api.test",
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { LoginPage } from "./LoginPage";

function resposta(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

async function entrar() {
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "alguem@veridi.com" },
  });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo" } });
  fireEvent.click(screen.getByRole("button", { name: /Entrar/i }));
}

/** Nada técnico pode vazar para a tela. */
function semDetalheTecnico() {
  const texto = document.body.textContent ?? "";
  for (const proibido of ["http", "TypeError", "fetch", "500", "401", "stack", "api.test"]) {
    expect(texto).not.toContain(proibido);
  }
}

describe("Login — o que a tela diz quando falha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("entra quando as credenciais valem", async () => {
    apiFetch.mockResolvedValue(resposta(200, { id: "u1", name: "Admin", role: "ADMIN" }));
    await entrar();

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("401 continua genérico: não diz se o e-mail existe", async () => {
    apiFetch.mockResolvedValue(resposta(401, { error: "invalid_credentials" }));
    await entrar();

    await waitFor(() =>
      expect(screen.getByText("E-mail ou senha inválidos.")).toBeInTheDocument(),
    );
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/e-mail não encontrado|usuário não existe|senha incorreta/i);
    semDetalheTecnico();
  });

  it("API fora do ar não vira senha inválida", async () => {
    // `fetch` rejeita quando não houve resposta nenhuma.
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await entrar();

    await waitFor(() =>
      expect(
        screen.getByText("Não foi possível conectar ao sistema. Tente novamente em instantes."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/E-mail ou senha inválidos/)).not.toBeInTheDocument();
    semDetalheTecnico();
  });

  it("500 diz que o sistema falhou, não o usuário", async () => {
    apiFetch.mockResolvedValue(resposta(500, { error: "internal" }));
    await entrar();

    await waitFor(() =>
      expect(
        screen.getByText("Não foi possível acessar o sistema no momento. Tente novamente em instantes."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/E-mail ou senha inválidos/)).not.toBeInTheDocument();
    semDetalheTecnico();
  });

  it("503 durante um deploy também é falha de sistema", async () => {
    apiFetch.mockResolvedValue(resposta(503, {}));
    await entrar();

    await waitFor(() =>
      expect(screen.getByText(/Não foi possível acessar o sistema no momento/)).toBeInTheDocument(),
    );
    semDetalheTecnico();
  });

  it("403 não é tratado como credencial inválida", async () => {
    apiFetch.mockResolvedValue(resposta(403, { error: "forbidden", message: "Sem permissão." }));
    await entrar();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("E-mail ou senha inválidos.")).not.toBeInTheDocument();
    semDetalheTecnico();
  });

  it("o botão volta a ficar disponível depois da falha", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await entrar();

    await waitFor(() =>
      expect(screen.getByText(/Não foi possível conectar ao sistema/)).toBeInTheDocument(),
    );
    // Sem isso, a pessoa fica presa sem poder tentar de novo.
    expect(screen.getByRole("button", { name: /Entrar/i })).not.toBeDisabled();
  });
});
