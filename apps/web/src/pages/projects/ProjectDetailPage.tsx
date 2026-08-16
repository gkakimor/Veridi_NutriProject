import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ProjectDTO, ProjectSampleDTO, QuoteVersionDTO } from "@veridi/shared";
import {
  PROJECT_ATTACHMENT_TYPES,
  PROJECT_SAMPLE_STATUS_LABELS,
  PROJECT_CANCEL_REASONS,
  PROJECT_CANCEL_REASON_LABELS,
  PROJECT_SOURCE_LABELS,
  PROJECT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from "@veridi/shared";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { FormSection } from "../../components/FormSection";
import {
  acceptQuoteVersion,
  approveProject,
  cancelProject,
  changeProjectStatus,
  createQuoteVersion,
  getProject,
  rejectQuoteVersion,
  sendQuoteVersion,
  updateQuoteVersion,
} from "../../lib/projects-api";
import { createSample, listSamples } from "../../lib/samples-api";
import { useAuth } from "../../app/AuthProvider";
import { formatBRL } from "../../lib/currency";
import { ProjectFormModal } from "./ProjectFormModal";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function quoteBadgeClass(status: QuoteVersionDTO["status"]): string {
  switch (status) {
    case "ACCEPTED":
      return "badge badge--active";
    case "REJECTED":
      return "badge badge--err";
    case "SENT":
      return "badge badge--warn";
    default:
      return "badge badge--neutral";
  }
}

/**
 * Documento do projeto: resumo, pipeline, orçamentos versionados,
 * documentos, histórico e o produto resultante.
 *
 * Só o rascunho de orçamento é editável; enviado congela o snapshot e vira
 * histórico. Aprovar o projeto é o momento em que ele vira Product.
 */
export function ProjectDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [samples, setSamples] = useState<ProjectSampleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [draftQuantity, setDraftQuantity] = useState("");
  const [draftUom, setDraftUom] = useState("un");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftValidUntil, setDraftValidUntil] = useState("");
  const [draftPaymentTerms, setDraftPaymentTerms] = useState("");
  const [draftLeadTime, setDraftLeadTime] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  const draft = project?.quoteVersions.find((quote) => quote.status === "DRAFT") ?? null;

  // Criar amostra é ato de desenvolvimento: Comercial pede, Produção também
  // pode abrir. Quem consome material continua sendo só Produção/ADMIN.
  const canCreateSample =
    user?.role === "COMMERCIAL" || user?.role === "PRODUCTION" || user?.role === "ADMIN";

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    getProject(id)
      .then((result) => {
        setProject(result);
        const currentDraft = result.quoteVersions.find((quote) => quote.status === "DRAFT");
        if (currentDraft) {
          setDraftQuantity(currentDraft.quotedQuantity ?? "");
          setDraftUom(currentDraft.uomCode ?? "un");
          setDraftPrice(currentDraft.unitPrice ?? "");
          setDraftValidUntil(currentDraft.validUntil ? currentDraft.validUntil.slice(0, 10) : "");
          setDraftPaymentTerms(currentDraft.paymentTerms ?? "");
          setDraftLeadTime(currentDraft.leadTimeDays ? String(currentDraft.leadTimeDays) : "");
          setDraftNotes(currentDraft.commercialNotes ?? "");
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const loadSamples = useCallback(() => {
    if (!id) return;
    listSamples({ projectId: id, pageSize: 100 })
      .then((result) => setSamples(result.samples))
      .catch(() => setSamples([]));
  }, [id]);

  useEffect(() => {
    load();
    loadSamples();
  }, [load, loadSamples]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na operação");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !project) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Projeto</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Projeto não encontrado</h1>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/comercial/projetos")}
          >
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  const editable = project.status !== "APPROVED" && project.status !== "CANCELLED";

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Comercial / Projetos / {project.customerName}</div>
          <div className="doc-title">
            <h1>
              {project.code} · {project.name}
            </h1>
            <span
              className={
                project.status === "APPROVED"
                  ? "badge badge--active"
                  : project.status === "CANCELLED"
                    ? "badge badge--err"
                    : "badge badge--neutral"
              }
            >
              {PROJECT_STATUS_LABELS[project.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          {editable && (
            <button type="button" className="btn btn--secondary" onClick={() => setEditOpen(true)}>
              Editar
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/comercial/projetos")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Resumo">
          <dl className="definition-list">
            <dt>Cliente</dt>
            <dd>
              <span className="code">{project.customerCode}</span> {project.customerName}
            </dd>
            <dt>Conceito / canal</dt>
            <dd>
              {project.concept ?? "—"} · {project.channel ?? "—"}
            </dd>
            <dt>Entrada</dt>
            <dd>{formatDate(project.entryDate)}</dd>
            <dt>Responsável</dt>
            <dd>{project.responsibleUserName ?? "—"}</dd>
            <dt>Código legado</dt>
            <dd>{project.externalCode ?? "—"}</dd>
            <dt>Origem do registro</dt>
            <dd>{PROJECT_SOURCE_LABELS[project.source]}</dd>
            <dt>Produto resultante</dt>
            <dd>
              {project.productId ? (
                <span className="code">{project.productCode}</span>
              ) : (
                "— (nasce na aprovação)"
              )}
            </dd>
            {project.cancelReason && (
              <>
                <dt>Motivo do cancelamento</dt>
                <dd>
                  {PROJECT_CANCEL_REASON_LABELS[project.cancelReason]}
                  {project.cancelReasonDetails ? ` — ${project.cancelReasonDetails}` : ""}
                </dd>
              </>
            )}
          </dl>

          {editable && (
            <div className="line-actions">
              {project.status !== "SAMPLE" && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(() => changeProjectStatus(project.id, { status: "SAMPLE" }))
                  }
                >
                  Mudar para Amostra
                </button>
              )}
              {project.status !== "STAND_BY" && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(() => changeProjectStatus(project.id, { status: "STAND_BY" }))
                  }
                >
                  Stand-by
                </button>
              )}
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={saving}
                onClick={() => void run(() => approveProject(project.id))}
              >
                Aprovar projeto
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={saving}
                onClick={() => {
                  const reason = window.prompt(
                    `Motivo do cancelamento (${PROJECT_CANCEL_REASONS.map(
                      (option) => `${option}=${PROJECT_CANCEL_REASON_LABELS[option]}`,
                    ).join(", ")}):`,
                    "PRICE",
                  );
                  if (!reason) return;
                  const details =
                    reason === "OTHER" ? window.prompt("Descreva o motivo:") ?? "" : undefined;
                  void run(() =>
                    cancelProject(project.id, {
                      cancelReason: reason as never,
                      ...(details ? { cancelReasonDetails: details } : {}),
                    }),
                  );
                }}
              >
                Cancelar projeto
              </button>
            </div>
          )}
        </FormSection>

        <FormSection
          title="Orçamentos"
          subtitle="Cada negociação é uma versão. Enviado congela o snapshot do cliente e vira histórico."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Data</th>
                  <th>Quantidade</th>
                  <th>Preço unitário</th>
                  <th>Total</th>
                  <th>Validade</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {project.quoteVersions.map((quote) => (
                  <tr key={quote.id}>
                    <td className="is-code">{quote.versionLabel}</td>
                    <td>{formatDate(quote.quoteDate)}</td>
                    <td>
                      {quote.quotedQuantity ?? "—"} {quote.uomCode ?? ""}
                    </td>
                    <td>{quote.unitPrice ? formatBRL(quote.unitPrice) : "—"}</td>
                    <td>{quote.total ? formatBRL(quote.total) : "—"}</td>
                    <td>{formatDate(quote.validUntil)}</td>
                    <td>
                      <span className={quoteBadgeClass(quote.status)}>
                        {QUOTE_STATUS_LABELS[quote.status]}
                      </span>
                    </td>
                    <td>
                      <div className="table__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            window.open(`/comercial/orcamentos/${quote.id}/imprimir`, "_blank")
                          }
                        >
                          Imprimir
                        </button>
                        {quote.status === "SENT" && (
                          <>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={saving}
                              onClick={() => void run(() => acceptQuoteVersion(quote.id))}
                            >
                              Aceitar
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={saving}
                              onClick={() => {
                                const reason = window.prompt("Motivo da recusa (opcional):") ?? "";
                                void run(() =>
                                  rejectQuoteVersion(
                                    quote.id,
                                    reason.trim() ? { reason: reason.trim() } : {},
                                  ),
                                );
                              }}
                            >
                              Recusar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {project.quoteVersions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table__empty">
                      Nenhuma versão de orçamento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editable && (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving}
                onClick={() => void run(() => createQuoteVersion(project.id))}
              >
                {draft ? "Abrir rascunho" : "Nova versão"}
              </button>
            </div>
          )}

          {draft && (
            <>
              <h4>Rascunho {draft.versionLabel}</h4>
              <div className="field field--narrow">
                <label htmlFor="quote-quantity">Quantidade</label>
                <input
                  id="quote-quantity"
                  type="text"
                  inputMode="decimal"
                  value={draftQuantity}
                  onChange={(event) => setDraftQuantity(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-uom">Unidade</label>
                <input
                  id="quote-uom"
                  type="text"
                  value={draftUom}
                  onChange={(event) => setDraftUom(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-price">Preço unitário</label>
                <input
                  id="quote-price"
                  type="text"
                  inputMode="decimal"
                  value={draftPrice}
                  onChange={(event) => setDraftPrice(event.target.value)}
                />
                <p className="field__hint">Vazio = ainda não precificado; 0 é preço zero real.</p>
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-valid-until">Validade da proposta</label>
                <input
                  id="quote-valid-until"
                  type="date"
                  value={draftValidUntil}
                  onChange={(event) => setDraftValidUntil(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-payment-terms">Condições de pagamento</label>
                <input
                  id="quote-payment-terms"
                  type="text"
                  value={draftPaymentTerms}
                  onChange={(event) => setDraftPaymentTerms(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-lead-time">Prazo de entrega (dias)</label>
                <input
                  id="quote-lead-time"
                  type="text"
                  inputMode="numeric"
                  value={draftLeadTime}
                  onChange={(event) => setDraftLeadTime(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="quote-notes">Observações comerciais</label>
                <textarea
                  id="quote-notes"
                  rows={2}
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                />
              </div>

              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={saving}
                  onClick={() =>
                    void run(() =>
                      updateQuoteVersion(draft.id, {
                        quotedQuantity: draftQuantity.trim() || null,
                        uomCode: draftUom.trim() || null,
                        unitPrice: draftPrice.trim() || null,
                        validUntil: draftValidUntil
                          ? new Date(`${draftValidUntil}T12:00:00`).toISOString()
                          : null,
                        paymentTerms: draftPaymentTerms.trim() || null,
                        leadTimeDays: draftLeadTime.trim() ? Number(draftLeadTime) : null,
                        commercialNotes: draftNotes.trim() || null,
                      }),
                    )
                  }
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={saving}
                  onClick={() => void run(() => sendQuoteVersion(draft.id))}
                >
                  Marcar como enviado
                </button>
              </div>
            </>
          )}
        </FormSection>

        <FormSection
          title="Amostras / testes"
          subtitle="Cada teste Tn é uma amostra própria: não é lote nem ordem de produção, e aprovar uma amostra não aprova o projeto."
        >
          <div className="table-container">
            <table className="table table--clickable-rows">
              <thead>
                <tr>
                  <th>Amostra</th>
                  <th>Teste</th>
                  <th>Descrição</th>
                  <th>Status</th>
                  <th>Consumos</th>
                  <th>Produzida em</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((sample) => (
                  <tr
                    key={sample.id}
                    tabIndex={0}
                    onClick={() => navigate(`/comercial/amostras/${sample.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") navigate(`/comercial/amostras/${sample.id}`);
                    }}
                  >
                    <td className="is-code">{sample.code}</td>
                    <td className="is-code">{sample.testLabel}</td>
                    <td>{sample.description ?? "—"}</td>
                    <td>{PROJECT_SAMPLE_STATUS_LABELS[sample.status]}</td>
                    <td>{sample.consumptions.length}</td>
                    <td>{formatDateTime(sample.producedAt)}</td>
                  </tr>
                ))}
                {samples.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      Nenhuma amostra registrada neste projeto.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {id &&
            canCreateSample &&
            project.status !== "APPROVED" &&
            project.status !== "CANCELLED" && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(async () => {
                      const sample = await createSample(id);
                      navigate(`/comercial/amostras/${sample.id}`);
                    })
                  }
                >
                  Nova amostra (T{samples.length > 0 ? Math.max(...samples.map((sample) => sample.testSequence)) + 1 : 1})
                </button>
              </div>
            )}
        </FormSection>

        {id && (
          <AttachmentsSection
            context="projects"
            contextId={id}
            title="Documentos do projeto"
            subtitle="Briefing, arte e ficha técnica. Documentação de referência — não trava operação."
            types={PROJECT_ATTACHMENT_TYPES}
          />
        )}

        <FormSection title="Histórico do pipeline">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>De</th>
                  <th>Para</th>
                  <th>Motivo</th>
                  <th>Quando</th>
                  <th>Por</th>
                </tr>
              </thead>
              <tbody>
                {project.statusHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.fromStatus ? PROJECT_STATUS_LABELS[entry.fromStatus] : "—"}</td>
                    <td>{PROJECT_STATUS_LABELS[entry.toStatus]}</td>
                    <td>{entry.reason ?? "—"}</td>
                    <td>{formatDateTime(entry.changedAt)}</td>
                    <td>{entry.changedByName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      </div>

      {editOpen && (
        <ProjectFormModal
          project={project}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
