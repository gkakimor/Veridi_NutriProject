import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import "./reports.css";

/**
 * Estrutura comum dos relatórios: título, filtros, resumo e tabela — nesta
 * ordem, semanticamente limpa, para a futura impressão/PDF ser um recorte
 * direto da página. Não é um framework de relatórios: é só o esqueleto que
 * todos repetiriam.
 */
export function ReportPage({
  title,
  subtitle,
  filters,
  summary,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle: string;
  filters: ReactNode;
  summary?: ReactNode;
  loading: boolean;
  error: string | null;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <>
      <div className="page__header">
        <div>
          <div className="doc-crumb">Gestão / Relatórios</div>
          <h1 className="page__title">{title}</h1>
          <p className="page__subtitle">{subtitle}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/relatorios")}>
          ← Relatórios
        </button>
      </div>

      <div className="toolbar report-filters">{filters}</div>

      {error && <p className="form-alert">Não foi possível carregar o relatório: {error}</p>}
      {loading && <p className="muted">Carregando…</p>}

      {summary && <div className="report-summary">{summary}</div>}

      {children}
    </>
  );
}

export function ReportSummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="report-summary__item">
      <span className="report-summary__label">{label}</span>
      <strong className="report-summary__value">{value}</strong>
    </div>
  );
}

/** Tabela densa padrão + estado vazio específico de cada relatório. */
export function ReportTable({
  columns,
  rows,
  emptyMessage,
  footer,
}: {
  columns: string[];
  rows: ReactNode;
  emptyMessage: string;
  footer?: ReactNode;
}) {
  const isEmpty = Array.isArray(rows) ? rows.length === 0 : rows === null;
  return (
    <div className="table-container">
      <table className="table report-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows}
          {isEmpty && (
            <tr>
              <td colSpan={columns.length} className="table__empty">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {footer && <div className="table-foot">{footer}</div>}
    </div>
  );
}

export function ReportPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        Página {page} de {totalPages} · {total} {total === 1 ? "registro" : "registros"}
      </span>
      <div className="table__actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

/** Código de documento clicável — ajuda o usuário a investigar. */
export function DocLink({ code, to }: { code: string | null; to: string | null }) {
  const navigate = useNavigate();
  if (!code) return <>—</>;
  if (!to) return <span className="code">{code}</span>;
  return (
    <button type="button" className="btn btn--ghost btn--sm report-link" onClick={() => navigate(to)}>
      {code}
    </button>
  );
}
