import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";
import {
  PROJECT_PRODUCT_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from "@veridi/shared";
import { getConsultationProject } from "../../lib/customer-consultation-api";
import { formatDate } from "../../lib/dates";
import { formatBRL } from "../../lib/currency";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationError, ConsultationLoading, ConsultationNotFound } from "./DetailStates";
import { useScopedDetail } from "./useScopedDetail";

/**
 * Detalhe CONSULTIVO de um Projeto, dentro do shell do Cliente.
 *
 * Não é a tela de Projeto: não edita, não aprova, não cancela e não repete o
 * formulário inteiro. Mostra o que responde "o que aconteceu com este
 * cliente" — situação, produtos, orçamentos, datas — e oferece uma única
 * saída deliberada para o módulo operacional.
 */
export function ProjectPage() {
  const { customerId } = useConsultationContext();
  const { projectId } = useParams<{ projectId: string }>();

  const load = useCallback(
    () => getConsultationProject(customerId, projectId ?? ""),
    [customerId, projectId],
  );
  const detail = useScopedDetail<ProjectDTO>(load, `${customerId}:${projectId}`);

  const listTo = consultationPath(customerId, "projetos");

  if (detail.notFound) {
    return <ConsultationNotFound noun="Projeto" listLabel="Projetos" listTo={listTo} />;
  }
  if (detail.error) {
    return <ConsultationError message={detail.error} listLabel="Projetos" listTo={listTo} />;
  }
  if (detail.loading || !detail.data) {
    return <ConsultationLoading listLabel="Projetos" listTo={listTo} />;
  }

  const project = detail.data;

  return (
    <>
      <ConsultationTrail steps={[{ label: "Projetos", to: listTo }, { label: project.code }]} />

      <div className="doc-header">
        <div>
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
        {/*
         * A ÚNICA porta de saída da Consulta. Clique comum em qualquer lugar
         * daqui continua dentro do Cliente; ir para o módulo operacional é
         * escolha explícita, com rótulo que diz para onde leva.
         */}
        <div className="table__actions">
          <Link className="btn btn--secondary" to={`/comercial/projetos/${project.id}`}>
            Abrir projeto completo ↗
          </Link>
        </div>
      </div>

      <section className="consult-section">
        <h2>Projeto</h2>
        <dl className="definition-list">
          <dt>Conceito / canal</dt>
          <dd>
            {project.concept ?? "—"} · {project.channel ?? "—"}
          </dd>
          <dt>Entrada</dt>
          <dd>{formatDate(project.entryDate)}</dd>
          <dt>Aprovado em</dt>
          <dd>{formatDate(project.approvedAt)}</dd>
          <dt>Responsável</dt>
          <dd>{project.responsibleUserName ?? "—"}</dd>
          <dt>Orçamento vigente</dt>
          <dd>{project.acceptedQuoteLabel ?? project.latestQuoteLabel ?? "—"}</dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Produtos</h2>
        {project.products.length === 0 ? (
          <p className="page__subtitle">Nenhum produto associado a este projeto.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Produto</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {project.products.map((product) => (
                  <tr key={product.id}>
                    <td className="is-code">{product.productCode}</td>
                    <td>{product.productName}</td>
                    <td>{PROJECT_PRODUCT_STATUS_LABELS[product.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="consult-section">
        <h2>Orçamentos</h2>
        {project.quoteVersions.length === 0 ? (
          <p className="page__subtitle">Nenhum orçamento neste projeto.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Data</th>
                  <th>Situação</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {project.quoteVersions.map((quote) => (
                  <tr key={quote.id}>
                    <td className="is-code">{quote.versionLabel}</td>
                    <td>{formatDate(quote.quoteDate)}</td>
                    <td>{QUOTE_STATUS_LABELS[quote.status]}</td>
                    <td>{formatBRL(quote.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
