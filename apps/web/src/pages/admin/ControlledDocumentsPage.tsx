import { useCallback, useEffect, useState } from "react";
import type { ControlledDocumentRevisionDTO, ControlledDocumentType } from "@veridi/shared";
import {
  CONTROLLED_DOCUMENT_CODES,
  CONTROLLED_DOCUMENT_TYPES,
  CONTROLLED_DOCUMENT_TYPE_LABELS,
} from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { ApiValidationError } from "../../lib/api-errors";
import {
  activateControlledDocumentRevision,
  createControlledDocumentRevision,
  listControlledDocuments,
} from "../../lib/auth-api";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

/**
 * Administração → Documentos controlados.
 *
 * Só o cabeçalho de revisão que os documentos impressos precisam: não é
 * GED, não há editor de template (o layout é código do sistema) e o
 * sistema não declara conformidade GMP/ANVISA em lugar nenhum.
 */
export function ControlledDocumentsPage() {
  const [revisions, setRevisions] = useState<ControlledDocumentRevisionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ControlledDocumentType>("PRODUCTION_ORDER");
  const [revision, setRevision] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listControlledDocuments()
      .then((result) => setRevisions(result.revisions))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar documentos"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleCreate() {
    setSaving(true);
    setFormError(null);
    try {
      await createControlledDocumentRevision({
        type,
        revision: revision.trim(),
        // Data da revisão é opcional: quando não se conhece a data real do
        // documento, não se inventa uma.
        ...(revisionDate ? { revisionDate: new Date(`${revisionDate}T12:00:00`).toISOString() } : {}),
        activate: true,
      });
      setOpen(false);
      setRevision("");
      setRevisionDate("");
      reload();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        setFormError(err.issues.map((issue) => issue.message).join("; "));
      } else {
        setFormError(err instanceof Error ? err.message : "Falha ao criar revisão");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: string) {
    await activateControlledDocumentRevision(id);
    reload();
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Documentos controlados</h1>
          <p className="page__subtitle">
            Revisões de {CONTROLLED_DOCUMENT_CODES.PRODUCTION_ORDER} e{" "}
            {CONTROLLED_DOCUMENT_CODES.RECIPE_SHEET}. Uma OP liberada guarda a revisão vigente na
            época — mudar a revisão ativa nunca reescreve documento já emitido.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
          Nova revisão
        </button>
      </div>

      {/* A tela é pequena e o alcance dela não é: é o cabeçalho de todo papel
          impresso daqui em diante. Também é onde se descobre que revisão não
          se edita — corrigir é criar outra. */}
      <ContextHelp topic={helpTopics["documentoControlado.comoFunciona"]} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Código</th>
              <th>
                Revisão
                <DicaDaColuna id="documentoControlado.revisao" />
              </th>
              <th>Data da revisão</th>
              <th>Elaborado por</th>
              <th>Aprovado por</th>
              <th>
                Situação
                <DicaDaColuna id="documentoControlado.vigente" />
              </th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {revisions.map((row) => (
              <tr key={row.id}>
                <td>{CONTROLLED_DOCUMENT_TYPE_LABELS[row.type]}</td>
                <td className="is-code">{row.documentCode}</td>
                <td>{row.revision}</td>
                <td>{formatDate(row.revisionDate)}</td>
                <td>{row.preparedByName ?? "—"}</td>
                <td>{row.approvedByName ?? "—"}</td>
                <td>
                  <span className={row.active ? "badge badge--active" : "badge badge--neutral"}>
                    {row.active ? "Ativa" : "Histórica"}
                  </span>
                </td>
                <td>
                  {!row.active && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void handleActivate(row.id)}
                    >
                      Ativar
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {!loading && revisions.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhuma revisão cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <FullWorkspaceModal
          open
          crumb="Administração"
          crumbActive="Documentos controlados"
          title="Nova revisão"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving || !revision.trim()}
                onClick={() => void handleCreate()}
              >
                {saving ? "Salvando…" : "Criar e ativar"}
              </button>
            </>
          }
        >
          {formError && <p className="form-alert" role="alert">{formError}</p>}

          <FormSection
            title="Documento"
            subtitle="A revisão anterior do mesmo documento passa a ser histórica — nunca é apagada."
          >
            <div className="field field--narrow">
              <label htmlFor="doc-type">Documento</label>
              <select
                id="doc-type"
                value={type}
                onChange={(event) => setType(event.target.value as ControlledDocumentType)}
              >
                {CONTROLLED_DOCUMENT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {CONTROLLED_DOCUMENT_CODES[option]} — {CONTROLLED_DOCUMENT_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field--narrow">
              <label htmlFor="doc-revision">
                Revisão <span className="req">*</span>
              </label>
              <input
                id="doc-revision"
                type="text"
                placeholder="01"
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
              />
            </div>

            <div className="field field--narrow">
              <label htmlFor="doc-revision-date">Data da revisão</label>
              <input
                id="doc-revision-date"
                type="date"
                value={revisionDate}
                onChange={(event) => setRevisionDate(event.target.value)}
              />
              <p className="field__hint">
                Opcional — sem a data real do documento em mãos, deixe em branco.
              </p>
            </div>
          </FormSection>
        </FullWorkspaceModal>
      )}
    </>
  );
}
