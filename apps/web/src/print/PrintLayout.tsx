import type { ReactNode } from "react";
import "./print.css";

/**
 * Esqueleto de impressão (documentos e relatórios).
 *
 * FAST MVP não gera PDF no backend: a página é HTML + CSS `@media print` e o
 * navegador imprime ou salva como PDF. O layout mostra apenas conteúdo
 * read-only — topbar, sidebar, botões, inputs e paginação somem no papel.
 */
export function PrintLayout({
  kind,
  code,
  status,
  isDraft,
  notice,
  meta,
  children,
  generatedFor,
}: {
  /** Tipo do documento/relatório: "ORDEM DE COMPRA", "R-01 · Posição de Estoque"… */
  kind: string;
  code: string;
  status?: string;
  isDraft?: boolean;
  /** Aviso obrigatório em alguns documentos (ex.: faturamento não é NF). */
  notice?: string;
  meta?: { label: string; value: ReactNode }[];
  children: ReactNode;
  /** Complemento do rodapé (ex.: total de registros do relatório). */
  generatedFor?: string;
}) {
  return (
    <article className="print-doc">
      <header className="print-doc__header">
        <div>
          <div className="print-doc__brand">Veridi Nutrition</div>
          <div className="print-doc__kind">{kind}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="print-doc__code">{code}</div>
          {status && <div className="print-doc__status">{status}</div>}
          {isDraft && <div className="print-doc__draft">Rascunho</div>}
        </div>
      </header>

      {notice && <p className="print-doc__notice">{notice}</p>}

      {meta && meta.length > 0 && (
        <dl className="print-doc__meta">
          {meta.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      <footer className="print-doc__foot">
        Gerado em {new Date().toLocaleString("pt-BR")}
        {generatedFor ? ` · ${generatedFor}` : ""}
        {/* Sem autenticação no MVP: não se inventa nome de usuário aqui. */}
      </footer>
    </article>
  );
}

export function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-doc__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function PrintTable({
  columns,
  children,
  emptyMessage,
  isEmpty,
}: {
  columns: string[];
  children: ReactNode;
  emptyMessage: string;
  isEmpty: boolean;
}) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {children}
        {isEmpty && (
          <tr>
            <td colSpan={columns.length}>{emptyMessage}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Barra de ações da página de impressão — nunca aparece no papel. */
export function PrintActions({ onBack }: { onBack: () => void }) {
  return (
    <div className="print-actions">
      <button type="button" className="btn btn--ghost" onClick={onBack}>
        ← Voltar
      </button>
      <button type="button" className="btn btn--primary" onClick={() => window.print()}>
        Imprimir / Salvar PDF
      </button>
    </div>
  );
}

export function formatPrintDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export function formatPrintDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

/** Valor ausente aparece como "—"; custo/preço desconhecido nunca vira zero. */
export function printOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : value;
}
