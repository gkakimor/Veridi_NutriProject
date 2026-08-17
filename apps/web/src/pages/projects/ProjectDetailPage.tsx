import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ProjectDTO, ProjectSampleDTO } from "@veridi/shared";
import {
  PROJECT_ATTACHMENT_TYPES,
  PROJECT_SAMPLE_STATUS_LABELS,
  PROJECT_CANCEL_REASONS,
  PROJECT_CANCEL_REASON_LABELS,
  PROJECT_SOURCE_LABELS,
  PROJECT_STATUS_LABELS,
} from "@veridi/shared";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { FormSection } from "../../components/FormSection";
import { ProjectCostingSection } from "./ProjectCostingSection";
import { ProjectProductsSection } from "./ProjectProductsSection";
import { ApprovalPreviewDialog } from "./ApprovalPreviewDialog";
import { QuoteVersionsSection } from "./QuoteVersionsSection";
import { FlowContext } from "../../components/FlowContext";
import {
  approveProject,
  cancelProject,
  changeProjectStatus,
  getProject,
} from "../../lib/projects-api";
import { createSample, listSamples } from "../../lib/samples-api";
import { useAuth } from "../../app/AuthProvider";
import { ProjectFormModal } from "./ProjectFormModal";
import { EntityLink } from "../../components/EntityLink";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
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
  const [sampleProductId, setSampleProductId] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);

  // Criar amostra é ato de desenvolvimento: Comercial pede, Produção também
  // pode abrir. Quem consome material continua sendo só Produção/ADMIN.
  const canCreateSample =
    user?.role === "COMMERCIAL" || user?.role === "PRODUCTION" || user?.role === "ADMIN";
  // Preparar produto técnico e vincular precificação são atos comerciais.
  const canEdit = user?.role === "COMMERCIAL" || user?.role === "ADMIN";

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    getProject(id)
      .then(setProject)
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
            {/* Origem legada é informação, não alerta: o projeto veio da
                planilha e isso ajuda a reconhecer o dado antigo. */}
            {project.source === "LEGACY_IMPORT" && (
              <span className="badge badge--neutral">Importado do legado</span>
            )}
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

      <FlowContext
        steps={[
          { kind: "Projeto", code: project.code, detail: project.customerName, current: true },
          ...(project.productId && project.productCode
            ? [
                {
                  kind: "Produto",
                  code: project.productCode,
                  // Identidade, não texto: `?produto=` não era lido por tela
                  // nenhuma e levava à lista inteira sem avisar.
                  path: `/cadastros/produtos?productId=${project.productId}&open=${project.productId}`,
                },
              ]
            : []),
        ]}
      />

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Resumo">
          <dl className="definition-list">
            <dt>Cliente</dt>
            <dd>
              <EntityLink kind="customer" id={project.customerId} code={project.customerCode} name={project.customerName} />
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
                <EntityLink
                  kind="product"
                  id={project.productId}
                  code={project.productCode}
                  name={project.productName}
                />
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
                onClick={() => setApprovalOpen(true)}
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

        <ProjectProductsSection
          projectId={project.id}
          customerId={project.customerId}
          products={project.products}
          editable={canEdit}
          onChanged={load}
        />

        <ProjectCostingSection
          project={project}
          canEdit={canEdit}
          onChanged={load}
        />

        <QuoteVersionsSection project={project} canEdit={canEdit} onChanged={load} />

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
                      {/* O botão some em projeto aprovado/cancelado e para quem não
                          pode criar amostra — o texto não pode prometer uma ação
                          que não está na tela. */}
                      {canCreateSample &&
                      project.status !== "APPROVED" &&
                      project.status !== "CANCELLED"
                        ? "Nenhuma amostra registrada neste projeto — use “Nova amostra” para abrir o primeiro teste."
                        : "Nenhuma amostra registrada neste projeto."}
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
                {/* Com mais de um produto, qual deles a amostra testa não se
                    deduz depois — quem cria escolhe agora. */}
                {project.products.length > 1 && (
                  <div className="field field--narrow">
                    <label htmlFor="sample-product">Produto testado</label>
                    <select
                      id="sample-product"
                      value={sampleProductId}
                      onChange={(event) => setSampleProductId(event.target.value)}
                    >
                      <option value="">Selecione…</option>
                      {project.products.map((link) => (
                        <option key={link.id} value={link.id}>
                          {link.productCode} · {link.productName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving || (project.products.length > 1 && sampleProductId === "")}
                  onClick={() =>
                    void run(async () => {
                      const sample = await createSample(
                        id,
                        sampleProductId ? { projectProductId: sampleProductId } : {},
                      );
                      navigate(`/comercial/amostras/${sample.id}`);
                    })
                  }
                >
                  Nova amostra (T{samples.length > 0 ? Math.max(...samples.map((sample) => sample.testSequence)) + 1 : 1})
                </button>
              </div>
            )}
        </FormSection>

        {approvalOpen && (
          <ApprovalPreviewDialog
            project={project}
            onCancel={() => setApprovalOpen(false)}
            onConfirm={() =>
              void run(async () => {
                await approveProject(project.id);
                setApprovalOpen(false);
              })
            }
          />
        )}

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
