import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormulationTemplateSummaryDTO } from "@veridi/shared";
import { FORMULATION_CALCULATION_MODE_LABELS } from "@veridi/shared";
import { createFormulationTemplate, listFormulationTemplates } from "../../lib/formulation-templates-api";
import { formatDate } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";

/**
 * Produção → Templates de Formulação.
 *
 * A biblioteca técnica: matrizes reutilizáveis entre clientes. Nada aqui
 * pertence a um cliente — usar um template cria uma cópia independente na
 * formulação do produto.
 */

const PAGE_SIZE = 20;

function situacao(template: FormulationTemplateSummaryDTO) {
  if (template.archived) return <span className="badge badge--neutral">Arquivado</span>;
  if (template.activeVersionNumber !== null) {
    return <span className="badge badge--active">Ativa (V{template.activeVersionNumber})</span>;
  }
  return <span className="badge badge--warn">Rascunho, sem versão ativa</span>;
}

export function FormulationTemplatesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [templates, setTemplates] = useState<FormulationTemplateSummaryDTO[]>([]);
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
    const params: Parameters<typeof listFormulationTemplates>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (showArchived) params.archived = true;
    listFormulationTemplates(params)
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleCreate() {
    if (!newName.trim()) return;
    setError(null);
    try {
      const template = await createFormulationTemplate({ name: newName.trim() });
      navigate(`/producao/templates-formulacao/${template.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar o template");
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Templates de Formulação</h1>
          <p className="page__subtitle">
            Matrizes técnicas reutilizáveis entre clientes. Usar um template cria uma cópia
            independente na formulação do produto — alterar o template depois não muda nenhuma
            formulação já criada.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn--accent" onClick={() => setCreating(true)}>
            Novo template
          </button>
        )}
      </div>

      {creating && (
        <div className="inline-form">
          <label htmlFor="template-name">Nome do template</label>
          <input
            id="template-name"
            type="text"
            value={newName}
            placeholder="Ex.: Biotina — Cápsulas Base"
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
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="templates-search">
            Buscar templates
          </label>
          <input
            id="templates-search"
            type="search"
            placeholder="Buscar por código, nome ou componente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <label className="toolbar__checkbox">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Mostrar arquivados
        </label>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Versão ativa</th>
              <th className="is-numeric">Base</th>
              <th className="is-numeric">Componentes</th>
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
                  {template.description && (
                    <span className="cell-sub">{template.description}</span>
                  )}
                </td>
                <td>
                  {template.activeVersionNumber !== null ? `V${template.activeVersionNumber}` : "—"}
                  {template.hasDraft && <span className="cell-sub">Rascunho em edição</span>}
                </td>
                <td className="is-numeric">
                  {template.basisQuantity
                    ? `${template.basisQuantity} ${template.outputUnitCode ?? ""}`.trim()
                    : "—"}
                  {template.calculationMode && (
                    <span className="cell-sub">
                      {FORMULATION_CALCULATION_MODE_LABELS[template.calculationMode]}
                    </span>
                  )}
                </td>
                <td className="is-numeric">{template.componentCount}</td>
                <td>{formatDate(template.updatedAt)}</td>
                <td>{situacao(template)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => navigate(`/producao/templates-formulacao/${template.id}`)}
                  >
                    Abrir
                  </button>
                </td>
              </tr>
            ))}

            {!loading && templates.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  {search
                    ? "Nenhum template encontrado para esta busca."
                    : "A biblioteca ainda está vazia. Crie um template ou salve uma formulação existente como template."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <span className="field__hint">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}
