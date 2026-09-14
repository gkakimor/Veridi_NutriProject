import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ContextHelp } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { helpTopics } from "../../help/help-content";
import { useOptionalAuth } from "../../app/AuthProvider";
import type { ReportFilters } from "../../lib/reports-api";
import "./reports.css";
import "../../print/print.css";
import { formatDateTime } from "../../lib/dates";
import { TABELA_COM_PERIODO_RECUSADO } from "../../lib/list-period";
import { ID_DA_RECUSA_DO_PERIODO } from "./report-period";
import { TableEmptyRow } from "../../components/TableEmptyRow";

/**
 * Consulta em curso, lida pela tabela do relatório: antes da resposta, tabela
 * sem linhas não é "nenhum registro" — ainda não se sabe.
 */
const ReportLoadingContext = createContext(false);

/**
 * Período recusado, lido pela tabela: sem consulta, tabela sem linhas também
 * não é "nenhum registro" — a pergunta é que não vale.
 */
const ReportPeriodRefusedContext = createContext(false);

/**
 * Consulta que falhou, lida pela tabela: sem resposta, tabela sem linhas não é
 * "nenhum registro" — o alerta diz o que houve (REPORTS-SEARCH-UX-01).
 */
const ReportErrorContext = createContext(false);

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
  appliedFilters,
  summary,
  loading,
  error,
  csvPath,
  csvFilters,
  reportCode,
  printFilters,
  total,
  periodRefusal = null,
  filtersPending = false,
  children,
}: {
  title: string;
  subtitle: string;
  filters: ReactNode;
  /**
   * Por que o período da tela não se consulta (`recusaDoPeriodo`,
   * PERIOD-RANGE-VALIDATION-WAVE-01). Com ela, a frase fica embaixo dos
   * filtros, a tabela não diz "nenhum registro", e CSV e PDF — que perguntariam
   * o mesmo período ao servidor — não se oferecem.
   */
  periodRefusal?: string | null;
  /**
   * Texto digitado ainda não aplicado (`useFiltrosDigitados`). CSV e PDF levam o
   * filtro APLICADO: enquanto o campo mostra um valor que a consulta ainda não
   * recebeu, eles não se oferecem — o arquivo não sai com "ab" diante de "abc".
   */
  filtersPending?: boolean;
  /** Filtros realmente aplicados — impressos no cabeçalho do papel. */
  appliedFilters?: { label: string; value: string }[];
  summary?: ReactNode;
  loading: boolean;
  error: string | null;
  /** Rota `.../export.csv` do mesmo read model. */
  csvPath?: string;
  csvFilters?: ReportFilters;
  /** Código do relatório — abre `/print/relatorios/:code` com os filtros. */
  reportCode?: string;
  /** Filtros levados para a rota de impressão (o padrão são os do CSV). */
  printFilters?: ReportFilters;
  total?: number | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const user = useOptionalAuth()?.user ?? null;

  const printParams = new URLSearchParams();
  for (const [key, value] of Object.entries(printFilters ?? csvFilters ?? {})) {
    if (value !== undefined && value !== "") printParams.set(key, String(value));
  }
  const printQuery = printParams.toString() ? `?${printParams.toString()}` : "";
  const semExportacao = periodRefusal !== null || filtersPending;

  return (
    <>
      <div className="page__header">
        <div>
          <PageBreadcrumbs items={[{ label: "Relatórios", href: "/relatorios" }, { label: "Relatório" }]} />
          <h1 className="page__title">{title}</h1>
          <p className="page__subtitle">{subtitle}</p>
        </div>
        <div className="table__actions">
          {csvPath && <ExportCsvButton path={csvPath} filters={csvFilters ?? {}} disabled={semExportacao} />}
          {reportCode && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={semExportacao}
              // O PDF nasce em rota dedicada: a tela operacional nunca vai
              // para o papel.
              onClick={() => navigate(`/print/relatorios/${reportCode}${printQuery}`)}
            >
              PDF
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate("/relatorios")}>
            ← Relatórios
          </button>
        </div>
      </div>

      {/* A explicação é do FORMATO relatório, não de cada assunto: filtro
          define o recorte, página só mostra um pedaço, e o documento vence o
          relatório quando os dois discordam. Vale igual nos vinte, e é por
          isso que mora no esqueleto em vez de repetida em cada um. */}
      <ContextHelp topic={helpTopics["relatorio.comoFunciona"]} />

      {/* Cabeçalho do papel: identidade, relatório, filtros aplicados e data.
          Aparece só na impressão. */}
      <div className="print-only print-doc__header">
        <div>
          <div className="print-doc__brand">Veridi Nutrition</div>
          <div className="print-doc__kind">{title}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="print-doc__status">Gerado em {formatDateTime(new Date().toISOString())}</div>
          {/* Quem gerou a IMPRESSÃO — não substitui os snapshots de quem
              executou cada ato no sistema. */}
          <div className="print-doc__status">Gerado por {user?.name ?? "—"}</div>
          {total !== undefined && (
            <div className="print-doc__status">
              {formatIntegerPtBr(total)} {total === 1 ? "registro" : "registros"}
            </div>
          )}
        </div>
      </div>
      {appliedFilters && appliedFilters.length > 0 && (
        <dl className="print-only print-doc__meta">
          {appliedFilters.map((applied) => (
            <div key={applied.label}>
              <dt>{applied.label}</dt>
              <dd>{applied.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="toolbar report-filters">{filters}</div>

      {periodRefusal && (
        <p id={ID_DA_RECUSA_DO_PERIODO} className="form-alert" role="alert">
          {periodRefusal}
        </p>
      )}
      {error && <p className="form-alert" role="alert">Não foi possível carregar o relatório: {error}</p>}
      {loading && <p className="muted">Carregando…</p>}

      {summary && <div className="report-summary">{summary}</div>}

      <ReportPeriodRefusedContext.Provider value={periodRefusal !== null}>
        <ReportErrorContext.Provider value={error !== null}>
          <ReportLoadingContext.Provider value={loading}>{children}</ReportLoadingContext.Provider>
        </ReportErrorContext.Provider>
      </ReportPeriodRefusedContext.Provider>
    </>
  );
}

/**
 * Relatório restrito aberto por um perfil que a API recusaria (URL direta):
 * título, aviso e volta — nenhuma consulta, CSV ou PDF. A recusa de verdade é
 * do servidor; aqui só não se oferece o que seria negado.
 */
export function ReportForbidden({ title, subtitle }: { title: string; subtitle: string }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="page__header">
        <div>
          <PageBreadcrumbs items={[{ label: "Relatórios", href: "/relatorios" }, { label: "Relatório" }]} />
          <h1 className="page__title">{title}</h1>
          <p className="page__subtitle">{subtitle}</p>
        </div>
        <div className="table__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate("/relatorios")}>
            ← Relatórios
          </button>
        </div>
      </div>
      <p className="form-alert" role="alert">
        Seu perfil não permite ver este relatório.
      </p>
    </>
  );
}

export function ReportSummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="report-summary__item">
      <span className="report-summary__label">{label}</span>
      <strong className="report-summary__value">
        {typeof value === "number" ? formatIntegerPtBr(value) : value}
      </strong>
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
  const loading = useContext(ReportLoadingContext);
  const periodoRecusado = useContext(ReportPeriodRefusedContext);
  const falhou = useContext(ReportErrorContext);
  const isEmpty = Array.isArray(rows) ? rows.length === 0 : rows === null;
  return (
    <div className="table-container" aria-busy={loading || undefined}>
      <table className="table report-table">
        <thead>
          <tr>
            {/* Índice como chave: dois relatórios legítimos repetem um rótulo
                (ex.: código do pedido e quantidade pedida) e o título não é
                identidade de coluna. */}
            {columns.map((column, index) => (
              <th key={`${index}-${column}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows}
          {isEmpty && !loading && !falhou && (
            <TableEmptyRow colSpan={columns.length}>
              {periodoRecusado ? TABELA_COM_PERIODO_RECUSADO : emptyMessage}
            </TableEmptyRow>
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
        Página {page} de {totalPages} · {formatIntegerPtBr(total)} {total === 1 ? "registro" : "registros"}
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
