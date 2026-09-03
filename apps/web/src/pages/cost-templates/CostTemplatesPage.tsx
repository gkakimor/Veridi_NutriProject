import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CostTemplateSummaryDTO } from "@veridi/shared";
import { createCostTemplate, listCostTemplates } from "../../lib/cost-pricing-templates-api";
import { formatDate } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { LibraryPagination, LibraryStatus, LibraryToolbar } from "./TemplateLibraryTable";

/**
 * Gestão → Templates de Estrutura de Custos.
 *
 * Configurações industriais reutilizáveis. Aplicar um template cria uma
 * estrutura própria do produto — e o template nunca carrega tarifa: o que
 * vale cada hora continua sendo resolvido na data do cálculo.
 */

const PAGE_SIZE = 20;

export function CostTemplatesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [templates, setTemplates] = useState<CostTemplateSummaryDTO[]>([]);
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
    listCostTemplates({
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(showArchived ? { archived: true } : {}),
    })
      .then((result) => {
        setTemplates(result.templates);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar os templates"),
      )
      .finally(() => setLoading(false));
  }, [page, search, showArchived]);

  useEffect(() => reload(), [reload]);

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const template = await createCostTemplate({ name: newName.trim() });
      navigate(`/gestao/templates-estrutura/${template.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar o template");
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Templates de Estrutura de Custos</h1>
          <p className="page__subtitle">
            Configurações industriais reutilizáveis: base de produção, recursos e premissas.
            Aplicar um template cria uma estrutura independente no produto — e as tarifas
            continuam sendo resolvidas na data do cálculo, nunca congeladas aqui.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn--accent" onClick={() => setCreating(true)}>
            Novo template
          </button>
        )}
      </div>

      <ContextHelp topic={helpTopics["templateCusto.comoFunciona"]} />

      {creating && (
        <div className="inline-form">
          <label htmlFor="cost-template-name">Nome do template</label>
          <input
            id="cost-template-name"
            type="text"
            autoFocus
            placeholder="Ex.: Cápsulas — Linha padrão"
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
        id="cost-templates-search"
        label="Buscar templates de estrutura"
        placeholder="Buscar por código, nome ou recurso…"
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
              <th className="is-numeric">Base</th>
              <th className="is-numeric">Recursos</th>
              <th>Atualização</th>
              <th>Situação</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <td>
                  <code>{template.code}</code>
                </td>
                <td>
                  {template.name}
                  {template.resourceNames.length > 0 && (
                    <span className="cell-sub">{template.resourceNames.join(" · ")}</span>
                  )}
                </td>
                <td>
                  {template.activeVersionNumber !== null ? `V${template.activeVersionNumber}` : "—"}
                  {template.hasDraft && <span className="cell-sub">Rascunho em edição</span>}
                </td>
                <td className="is-numeric">
                  {template.referenceOutputQuantity
                    ? `${formatQuantity(template.referenceOutputQuantity)} ${template.referenceOutputUomCode ?? ""}`.trim()
                    : "—"}
                </td>
                <td className="is-numeric">
                  {template.resourceCount}
                  {template.additionalCostCount > 0 && (
                    <span className="cell-sub">
                      + {template.additionalCostCount} premissa
                      {template.additionalCostCount > 1 ? "s" : ""}
                    </span>
                  )}
                </td>
                <td>{formatDate(template.updatedAt)}</td>
                <td>
                  <LibraryStatus
                    archived={template.archived}
                    activeVersionNumber={template.activeVersionNumber}
                  />
                </td>
                <td>
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={`/gestao/templates-estrutura/${template.id}`}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && templates.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  {search
                    ? "Nenhum template encontrado para esta busca."
                    : "A biblioteca ainda está vazia. Crie um template ou salve uma estrutura existente como template."}
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
