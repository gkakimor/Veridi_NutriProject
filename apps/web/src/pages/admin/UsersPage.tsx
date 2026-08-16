import { useCallback, useEffect, useState } from "react";
import type { UserDTO, UserRole } from "@veridi/shared";
import { USER_ROLES, USER_ROLE_LABELS } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { ApiValidationError } from "../../lib/api-errors";
import { createUser, listUsers, resetUserPassword, updateUser } from "../../lib/auth-api";
import { useAuth } from "../../app/AuthProvider";

type Mode = { kind: "closed" } | { kind: "create" } | { kind: "edit"; user: UserDTO };

/**
 * Administração → Usuários. Usuário nunca é excluído: com registros GMP
 * atrás dele, apagar seria perder rastreabilidade. Inativa-se.
 */
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "closed" });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("PRODUCTION");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listUsers({ pageSize: 100 })
      .then((result) => setUsers(result.users))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar usuários"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function openCreate() {
    setName("");
    setEmail("");
    setPassword("");
    setRole("PRODUCTION");
    setActive(true);
    setFormError(null);
    setMode({ kind: "create" });
  }

  function openEdit(user: UserDTO) {
    setName(user.name);
    setEmail(user.email);
    setPassword("");
    setRole(user.role);
    setActive(user.active);
    setFormError(null);
    setMode({ kind: "edit", user });
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    try {
      if (mode.kind === "create") {
        await createUser({ name: name.trim(), email: email.trim(), password, role });
      } else if (mode.kind === "edit") {
        await updateUser(mode.user.id, { name: name.trim(), email: email.trim(), role, active });
        // Troca de senha é ação explícita — nunca efeito colateral da edição.
        if (password.trim()) await resetUserPassword(mode.user.id, { password });
      }
      setMode({ kind: "closed" });
      reload();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        setFormError(err.issues.map((issue) => issue.message).join("; "));
      } else {
        setFormError(err instanceof Error ? err.message : "Falha ao salvar usuário");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Usuários</h1>
          <p className="page__subtitle">
            Identidade real para os registros GMP: quem executou cada ação vem da sessão do usuário.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={openCreate}>
          Novo usuário
        </button>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Perfil</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="is-code">{user.code}</td>
                <td>
                  {user.name}
                  {user.id === currentUser?.id && <span className="field__hint"> (você)</span>}
                </td>
                <td>{user.email}</td>
                <td>{USER_ROLE_LABELS[user.role]}</td>
                <td>
                  <span className={user.active ? "badge badge--active" : "badge badge--neutral"}>
                    {user.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => openEdit(user)}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}

            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="table__empty">
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mode.kind !== "closed" && (
        <FullWorkspaceModal
          open
          crumb="Administração"
          crumbActive="Usuários"
          title={mode.kind === "create" ? "Novo usuário" : mode.user.name}
          {...(mode.kind === "edit" ? { codeChip: mode.user.code } : {})}
          onClose={() => setMode({ kind: "closed" })}
          footer={
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setMode({ kind: "closed" })}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </>
          }
        >
          {formError && <p className="form-alert">{formError}</p>}

          <FormSection title="Identificação">
            <div className="field">
              <label htmlFor="user-name">
                Nome <span className="req">*</span>
              </label>
              <input
                id="user-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="user-email">
                E-mail <span className="req">*</span>
              </label>
              <input
                id="user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field field--narrow">
              <label htmlFor="user-role">Perfil</label>
              <select
                id="user-role"
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
              >
                {USER_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {USER_ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            {mode.kind === "edit" && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                />
                Usuário ativo
              </label>
            )}
          </FormSection>

          <FormSection
            title="Senha"
            subtitle={
              mode.kind === "create"
                ? "Mínimo de 10 caracteres."
                : "Preencha somente para redefinir a senha deste usuário."
            }
          >
            <div className="field">
              <label htmlFor="user-password">
                {mode.kind === "create" ? "Senha" : "Nova senha"}
                {mode.kind === "create" && <span className="req"> *</span>}
              </label>
              <input
                id="user-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </FormSection>
        </FullWorkspaceModal>
      )}
    </>
  );
}
