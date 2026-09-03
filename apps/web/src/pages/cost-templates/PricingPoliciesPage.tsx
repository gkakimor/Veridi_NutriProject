import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PricingPolicySummaryDTO } from "@veridi/shared";
import { createPricingPolicy, listPricingPolicies } from "../../lib/cost-pricing-templates-api";
import { formatDate } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { LibraryPagination, LibraryStatus, LibraryToolbar } from "./TemplateLibraryTable";

/**
 * Gestão → Políticas de Precificação.
 *
 * "Políticas" e não "templates de preço" porque o nome precisa dizer o que
 * elas são: regra comercial reutilizável — faixas, margem alvo, comissão —,
 * nunca preços prontos. O preço nasce do custo de cada produto.
 */

const PAGE_SIZE = 20;

export function PricingPoliciesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "COMMERCIAL";

  const [policies, setPolicies] = useState<PricingPolicySummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);
  useEffect(() => setPage(1), [search, showArchived]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listPricingPolicies({
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(showArchived ? { archived: true } : {}),
    })
      .then((result) => {
        setPolicies(result.policies);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar as políticas"),
      )
      .finally(() => setLoading(false));
  }, [page, search, showArchived]);

  useEffect(() => reload(), [reload]);

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const policy = await createPricingPolicy({ name: newName.trim() });
      navigate(`/gestao/politicas-precificacao/${policy.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar a política");
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Políticas de Precificação</h1>
          <p className="page__subtitle">
            Templates comerciais reutilizáveis: faixas de quantidade, margem alvo e comissão. Uma
            política não guarda preço — o preço de cada faixa é calculado sobre o custo do produto
            no momento em que a política é aplicada.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn--accent" onClick={() => setCreating(true)}>
            Nova política
          </button>
        )}
      </div>

      <ContextHelp topic={helpTopics["politicaPreco.comoFunciona"]} />

      {creating && (
        <div className="inline-form">
          <label htmlFor="policy-name">Nome da política</label>
          <input
            id="policy-name"
            type="text"
            autoFocus
            placeholder="Ex.: Private Label — Padrão"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreate();
              if (event.key === "Escape") setCreating(false);
            }}
          />
          <button
            type="button"
            className="btn btn--accent btn--sm"
            disabled={!newName.trim()}
            onClick={() => void handleCreate()}
          >
            Criar
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setCreating(false)}
          >
            Cancelar
          </button>
        </div>
      )}

      <LibraryToolbar
        id="policies-search"
        label="Buscar políticas"
        placeholder="Buscar por código ou nome…"
        value={searchInput}
        onChange={setSearchInput}
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
      />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Versão ativa</th>
              <th className="is-numeric">Faixas</th>
              <th>Atualização</th>
              <th>Situação</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td>
                  <code>{policy.code}</code>
                </td>
                <td>
                  {policy.name}
                  {policy.tierQuantities.length > 0 && (
                    <span className="cell-sub">
                      {policy.tierQuantities.join(" · ")} unidades
                    </span>
                  )}
                </td>
                <td>
                  {policy.activeVersionNumber !== null ? `V${policy.activeVersionNumber}` : "—"}
                  {policy.hasDraft && <span className="cell-sub">Rascunho em edição</span>}
                </td>
                <td className="is-numeric">{policy.tierCount}</td>
                <td>{formatDate(policy.updatedAt)}</td>
                <td>
                  <LibraryStatus
                    archived={policy.archived}
                    activeVersionNumber={policy.activeVersionNumber}
                  />
                </td>
                <td>
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={`/gestao/politicas-precificacao/${policy.id}`}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && policies.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  {search
                    ? "Nenhuma política encontrada para esta busca."
                    : "A biblioteca ainda está vazia. Crie uma política ou salve uma precificação existente como política."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <LibraryPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onChange={setPage}
      />
    </>
  );
}
