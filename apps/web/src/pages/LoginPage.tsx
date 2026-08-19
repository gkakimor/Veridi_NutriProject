import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../app/AuthProvider";
import { login } from "../lib/auth-api";
import {
  ApiServerError,
  ApiUnreachableError,
  InvalidCredentialsError,
} from "../lib/api-errors";

/**
 * Login. A sessão é aberta pelo backend em cookie HttpOnly — nada de token
 * em localStorage.
 *
 * O 401 é genérico de propósito: não revela se o e-mail existe. O que mudou é
 * que ele deixou de ser a resposta para tudo — API fora do ar e falha de
 * servidor agora dizem o que são. Antes, qualquer erro virava "e-mail ou
 * senha inválidos", e quem tentava entrar com o sistema fora ia trocar uma
 * senha que estava certa.
 *
 * Nada técnico chega à tela: sem status cru, sem host, sem stack.
 */
export function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      await refresh();
    } catch (err) {
      /*
       * Cada desfecho com sua própria mensagem. O erro tipado vem do
       * `auth-api`; qualquer coisa fora disso cai no genérico de sistema,
       * nunca em "senha inválida" — afirmar isso sem saber é informação
       * falsa, e manda a pessoa trocar uma senha que estava certa.
       */
      if (err instanceof InvalidCredentialsError || err instanceof ApiUnreachableError) {
        setError(err.message);
      } else if (err instanceof ApiServerError) {
        setError(err.message);
      } else {
        setError("Não foi possível acessar o sistema no momento. Tente novamente em instantes.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <div className="login__brand">
          <span className="login__mark" aria-hidden="true">
            V
          </span>
          <div>
            <strong>Veridi</strong> Nutrition
          </div>
        </div>

        <h1 className="login__title">Entrar</h1>

        {/* `alert` para o leitor de tela anunciar a falha sem que a pessoa
            precise procurá-la depois de enviar o formulário. */}
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}

        <div className="field">
          <label htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">Senha</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn btn--accent" disabled={submitting}>
          {submitting ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
