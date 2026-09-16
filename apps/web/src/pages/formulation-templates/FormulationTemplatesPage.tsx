import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { FormulationTemplateSummaryDTO } from "@veridi/shared";
import { FORMULATION_CALCULATION_MODE_LABELS } from "@veridi/shared";
import { createFormulationTemplate, listFormulationTemplates } from "../../lib/formulation-templates-api";
import { ListStatusRow } from "../../components/ListStatusRow";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { formatDate } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/**
 * Cadastros e Configurações → Modelos de Formulação.
 *
 * A biblioteca técnica: matrizes reutilizáveis entre clientes. Nada aqui
 * pertence a um cliente — usar um template cria uma cópia independente na
 * formulação do produto.
 */

/** ⓘ de uma coluna, lido do registro central. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

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

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  /* A falha de criar é da ação, não da lista: não some quando a lista recarrega. */
  const [erroAoCriar, setErroAoCriar] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Recorte novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = { ...(search ? { search } : {}), ...(showArchived ? { archived: true } : {}) };
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listFormulationTemplates,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar os modelos" },
  );
  const templates: FormulationTemplateSummaryDTO[] = consulta.data?.templates ?? [];
  const total = consulta.data?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleCreate() {
    if (!newName.trim()) return;
    setErroAoCriar(null);
    try {
      const template = await createFormulationTemplate({ name: newName.trim() });
      navigate(`/producao/templates-formulacao/${template.id}`);
    } catch (err) {
      setErroAoCriar(err instanceof Error ? err.message : "Falha ao criar o modelo");
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Modelos de Formulação</h1>
          <p className="page__subtitle">
            Matrizes técnicas reutilizáveis entre clientes. Usar um modelo cria uma cópia
            independente na formulação do produto — alterar o modelo depois não muda nenhuma
            formulação já criada.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn--accent" onClick={() => setCreating(true)}>
            Novo modelo
          </button>
        )}
      </div>

      <ContextHelp topic={helpTopics["producao.templates"]} />

      {creating && (
        <div className="inline-form">
          <label htmlFor="template-name">Nome do modelo</label>
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
            Buscar modelos
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

      {erroAoCriar && <p className="form-alert" role="alert">{erroAoCriar}</p>}
      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>
                Versão ativa
                <DicaDaColuna id="producao.template.versaoAtiva" />
              </th>
              <th className="is-numeric">
                Base
                <DicaDaColuna id="producao.template.base" />
              </th>
              <th className="is-numeric">Componentes</th>
              <th>Atualização</th>
              <th>
                Situação
                <DicaDaColuna id="producao.template.situacao" />
              </th>
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
                    ? `${formatQuantity(template.basisQuantity)} ${template.outputUnitCode ?? ""}`.trim()
                    : "—"}
                  {template.calculationMode && (
                    <span className="cell-sub">
                      {FORMULATION_CALCULATION_MODE_LABELS[template.calculationMode]}
                    </span>
                  )}
                </td>
                <td className="is-numeric">{formatIntegerPtBr(template.componentCount)}</td>
                <td>{formatDate(template.updatedAt)}</td>
                <td>{situacao(template)}</td>
                <td>
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={`/producao/templates-formulacao/${template.id}`}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={8} query={consulta} rowCount={templates.length}>
              {search
                ? "Nenhum modelo encontrado para esta busca."
                : "A biblioteca ainda está vazia. Crie um modelo ou salve uma formulação existente como modelo."}
            </ListStatusRow>
          </tbody>
        </table>
      </div>

      {consulta.data && totalPages > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
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
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}
