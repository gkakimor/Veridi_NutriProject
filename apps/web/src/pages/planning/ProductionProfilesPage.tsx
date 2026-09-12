import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProductionProfileSummaryDTO } from "@veridi/shared";
import { createProductionProfile, listProductionProfiles } from "../../lib/production-profiles-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatQuantity } from "../../lib/quantity";
import { formatDate } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { LibraryPagination } from "../cost-templates/TemplateLibraryTable";
import "./planning.css";

/**
 * Planejamento → Roteiros de Produção.
 *
 * Roteiros reutilizáveis de COMO se produz (`PRODUCT_RULES.md` §89). Não é
 * Formulação nem Estrutura de Custos — nada aqui move estoque, custo ou
 * ordem de produção. O nome técnico continua `ProductionProfile`: só a
 * palavra que o usuário lê mudou (PRODUCTION-ROUTE-UX-01).
 */

const PAGE_SIZE = 20;

export function ProductionProfilesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [profiles, setProfiles] = useState<ProductionProfileSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);
  useEffect(() => setPage(1), [search]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listProductionProfiles({ page, pageSize: PAGE_SIZE, ...(search ? { search } : {}) })
      .then((result) => {
        setProfiles(result.profiles);
        setTotal(result.total);
      })
      .catch((err: unknown) => setError(apiErrorMessage(err, "Falha ao carregar os roteiros")))
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => reload(), [reload]);

  async function handleCreate() {
    const nome = newName.trim();
    if (!nome) return;
    setSaving(true);
    setError(null);
    try {
      const perfil = await createProductionProfile({ name: nome });
      navigate(`/planejamento/perfis-producao/${perfil.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao criar o roteiro"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Roteiros de Produção</h1>
          <p className="page__subtitle">
            Como o produto é fabricado: as etapas em ordem, os tempos e os recursos que cada etapa
            ocupa ao mesmo tempo. A Formulação diz o que entra no produto; o roteiro diz como a
            fabricação acontece. O mesmo roteiro serve a vários produtos.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn--accent" onClick={() => setCreating(true)}>
            Novo roteiro
          </button>
        )}
      </div>

      <ContextHelp topic={helpTopics["planejamento.perfisProducao"]} />

      {creating && (
        <div className="inline-form">
          <label htmlFor="production-profile-name">Nome do roteiro</label>
          <input
            id="production-profile-name"
            type="text"
            autoFocus
            placeholder="Ex.: Cápsulas — linha padrão"
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
            disabled={!newName.trim() || saving}
            onClick={() => void handleCreate()}
          >
            Criar
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>
            Cancelar
          </button>
        </div>
      )}

      <div className="field planning-search">
        <label htmlFor="production-profiles-search">Buscar roteiros</label>
        <input
          id="production-profiles-search"
          type="search"
          placeholder="Buscar por código ou nome…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Versão ativa</th>
              <th className="is-numeric">Quantidade de referência</th>
              <th className="is-numeric">Etapas</th>
              <th className="is-numeric">Produtos</th>
              <th>Atualização</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td>
                  <code>{profile.code}</code>
                </td>
                <td>
                  {profile.name}
                  {profile.stepNames.length > 0 && (
                    <span className="cell-sub">{profile.stepNames.join(" → ")}</span>
                  )}
                </td>
                <td>
                  {profile.activeVersionNumber !== null ? `V${profile.activeVersionNumber}` : "—"}
                  {profile.hasDraft && <span className="cell-sub">Rascunho em edição</span>}
                </td>
                <td className="is-numeric">
                  {profile.referenceQuantity
                    ? `${formatQuantity(profile.referenceQuantity)} ${profile.referenceUomCode ?? ""}`.trim()
                    : "—"}
                </td>
                <td className="is-numeric">
                  {profile.activeVersionId ? profile.stepNames.length : "—"}
                </td>
                <td className="is-numeric">{profile.defaultProductCount}</td>
                <td>{formatDate(profile.updatedAt)}</td>
                <td>
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={`/planejamento/perfis-producao/${profile.id}`}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && profiles.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  {search
                    ? "Nenhum roteiro encontrado para esta busca."
                    : "Nenhum Roteiro de Produção ainda. Crie o primeiro."}
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
