import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../app/AuthProvider";
import { login } from "../lib/auth-api";

/**
 * Login. A sessão é aberta pelo backend em cookie HttpOnly — nada de token
 * em localStorage. Mensagem de erro é sempre genérica: não revela se o
 * e-mail existe.
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
    } catch {
      setError("E-mail ou senha inválidos.");
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

        {error && <p className="form-alert">{error}</p>}

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
